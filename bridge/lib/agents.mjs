// The agents a run can use: which are on this machine, how each is started, and what it reports as it works.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { VERSION } from './paths.mjs';
import { readJson, logError, onPath } from './util.mjs';
import { inScope, scopeEntry } from './scope.mjs';
import { ROOT, LOA, RUNS_DIR } from './repo.mjs';
import { active, finishRun, push } from './runs.mjs';
import { emit } from './events.mjs';
import { HOOKS } from './serve.mjs';

export const BIN = {
  claude: process.env.LOA_CLAUDE_BIN || 'claude',
  cursor: process.env.LOA_CURSOR_BIN || 'cursor-agent',
  codex: process.env.LOA_CODEX_BIN || 'codex',
};
export const AGENTS = {
  // `problem` says why Claude Code can't run: 'missing' (not installed) or 'loggedOut' (checkClaude).
  claude: { name: 'Claude Code', available: false, problem: null },
  cursor: { name: 'Cursor', available: false },
  codex: { name: 'Codex', available: false },
  detected: { name: 'Watch mode', available: false },
  you: { name: 'You', available: false },
  'claude-terminal': { name: 'Claude Code (terminal)', available: false },
  'codex-terminal': { name: 'Codex (terminal)', available: false },
  'cursor-editor': { name: 'Cursor (editor)', available: false },
};
/**
 * Harnesses that speak the Agent Client Protocol (agentclientprotocol.com), run by startAcp: Hermes Agent and
 * DeepSeek Harness when found, and any the person adds in their own ~/.config/league-of-agents/agents.json, as
 * [{ "id": "goose", "name": "Goose", "command": ["goose", "acp"] }]. Never from the repo, so a cloned repo can't
 * name a command to run. Keys, providers and models stay in each harness's own settings.
 */
const AGENTS_FILE = path.join(os.homedir(), '.config', 'league-of-agents', 'agents.json');
export const ACP = {
  // Hermes speaks ACP only with its optional extra installed: it counts as found once `hermes acp --check` passes.
  hermes: {
    name: 'Hermes',
    command: [process.env.LOA_HERMES_BIN || 'hermes', 'acp'],
    check: [process.env.LOA_HERMES_BIN || 'hermes', 'acp', '--check'],
  },
  // In its read-only mode DeepSeek Harness asks before every write (its sandbox denies the write, and it asks to
  // escalate), so its edits outside the scope can be refused. Without it, it writes without asking.
  dsh: {
    name: 'DeepSeek Harness',
    command: [process.env.LOA_DSH_BIN || 'dsh', '--profile', 'acp'],
    env: { DSH_PERMISSION_MODE: 'read-only' },
  },
};
/** Which agents are on this machine, and the harnesses the person added. */
export function loadAgents() {
  AGENTS.claude.available = onPath(BIN.claude);
  AGENTS.claude.problem = onPath(BIN.claude) ? null : 'missing';
  AGENTS.cursor.available = onPath(BIN.cursor);
  AGENTS.codex.available = onPath(BIN.codex);
  for (const a of [readJson(AGENTS_FILE, [])].flat())
    if (
      /^[a-z0-9-]+$/.test(a?.id) &&
      !AGENTS[a.id] &&
      Array.isArray(a.command) &&
      a.command.length &&
      a.command.every(s => typeof s === 'string' && s)
    )
      ACP[a.id] = { name: typeof a.name === 'string' && a.name ? a.name : a.id, command: a.command };
  for (const [id, a] of Object.entries(ACP)) AGENTS[id] = { name: a.name, available: !a.check && onPath(a.command[0]) };
}
/**
 * Whether Claude Code is installed and logged in, asked of `claude auth status` without blocking. Only an
 * explicit "loggedIn": false counts as logged out: an older Claude Code without the command, or an answer that
 * isn't JSON, leaves it runnable. Asked before each Claude Code run, and every 15 s while there is a problem,
 * so installing or logging in clears it without a restart.
 */
export const CLAUDE_RECHECK_MS = Number(process.env.LOA_CLAUDE_RECHECK_MS) || 15000;
let claudeAsked = 0;
const loggedOut = out => {
  try {
    return JSON.parse(out).loggedIn === false;
  } catch {
    return false;
  }
};
/** What to tell the person when Claude Code can't run, with the command that fixes it. */
export const CLAUDE_FIX = {
  missing: "Claude Code isn't installed. To run it from the map: curl -fsSL https://claude.ai/install.sh | bash",
  loggedOut: "Claude Code isn't logged in. To run it from the map: claude auth login",
};
/** The same check, waited for: `start` says it before it hands over the link. */
export function claudeProblemNow() {
  if (!onPath(BIN.claude)) return 'missing';
  let out = '';
  try {
    out = execFileSync(BIN.claude, ['auth', 'status', '--json'], {
      cwd: ROOT,
      timeout: 10000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (e) {
    out = String(e.stdout || '');
  }
  return loggedOut(out) ? 'loggedOut' : null;
}
export function checkClaude(then) {
  const done = () => then?.();
  if (Date.now() - claudeAsked < CLAUDE_RECHECK_MS) return done();
  claudeAsked = Date.now();
  const setProblem = problem => {
    const was = AGENTS.claude.problem;
    AGENTS.claude.problem = problem;
    AGENTS.claude.available = !problem;
    if (was !== problem) emit('state');
  };
  if (!onPath(BIN.claude)) {
    setProblem('missing');
    return done();
  }
  execFile(BIN.claude, ['auth', 'status', '--json'], { cwd: ROOT, timeout: 10000 }, (_, out) => {
    setProblem(loggedOut(out) ? 'loggedOut' : null);
    done();
  });
}
/**
 * The scope, written above the prompt. What it says holds for every agent: changes outside the scope are reported
 * and can be undone. Only Claude Code's edit tools are blocked outside it, by the scope lock (runHook 'pre'), which
 * is one of the hooks: without them, Claude Code isn't told it is blocked.
 */
export function scopePreamble(scope, agent) {
  if (!scope?.length) return '';
  const line = s => {
    const e = scopeEntry(s);
    return e.from
      ? `- ${e.path}, lines ${e.from} to ${e.to} only: keep every other line of this file as it is`
      : '- ' + s;
  };
  const blocked = agent === 'claude' && HOOKS ? '\nEdits outside it made with edit tools are blocked.' : '';
  return `Scope for this task:\n${scope.map(line).join('\n')}\nEdit only inside this scope. Changes outside it are reported to the user and can be undone.${blocked}\n\n`;
}
export function startAgent(run, read = {}) {
  const prompt = scopePreamble(run.scope, run.agent) + run.prompt;
  const scopeFile = path.join(LOA, 'scope.json');
  // For line ranges, the hook needs each file as it was when the run started: as read when its lines were found.
  const ranges = {};
  for (const e of (run.scope || []).map(scopeEntry))
    if (e.from)
      ranges[e.path] = {
        from: e.from,
        to: e.to,
        before: read[e.path] ?? fs.readFileSync(path.join(ROOT, e.path), 'utf8'),
      };
  fs.writeFileSync(scopeFile, JSON.stringify({ scope: run.scope || [], ranges }));
  if (ACP[run.agent]) return startAcp(run, prompt, scopeFile);
  let cmd, args;
  if (run.agent === 'claude') {
    cmd = BIN.claude;
    args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits'];
    if (run.sessionId) args.push('--resume', run.sessionId);
  } else if (run.agent === 'cursor') {
    cmd = BIN.cursor;
    args = [
      '-p',
      '--force',
      '--output-format',
      'stream-json',
      ...(run.sessionId ? ['--resume', run.sessionId] : []),
      prompt,
    ];
  } else if (run.agent === 'codex') {
    cmd = BIN.codex;
    args = [
      'exec',
      '--json',
      '--sandbox',
      'workspace-write',
      ...(run.sessionId ? ['resume', run.sessionId] : []),
      prompt,
    ];
  } else throw new Error('Unknown agent ' + run.agent);
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, LOA_MANAGED: '1', LOA_SCOPE_FILE: scopeFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  active.child = child;
  // Raw agent output, kept as-is for fixtures and debugging.
  const rawOut = fs.createWriteStream(path.join(RUNS_DIR, `${run.id}.stream.jsonl`));
  const rawErr = fs.createWriteStream(path.join(RUNS_DIR, `${run.id}.stderr.log`));
  let buf = '';
  child.stdout.on('data', d => {
    rawOut.write(d);
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onAgentLine(run, line);
    }
  });
  child.stderr.on('data', d => {
    rawErr.write(d);
    const t = String(d).trim();
    if (t) push(run, { t: 'err', text: t.slice(0, 500) });
  });
  child.on('error', e => {
    push(run, { t: 'err', text: `Could not start ${cmd}: ${e.message}` });
  });
  child.on('close', code => {
    rawOut.end();
    rawErr.end();
    try {
      fs.rmSync(scopeFile);
    } catch {}
    if (code && run.status === 'running')
      push(run, { t: 'err', text: `${AGENTS[run.agent].name} exited with code ${code}` });
    const ended = ['cancelled', 'interrupted'].includes(run.status) ? run.status : code ? 'failed' : 'done';
    finishRun(run, ended).catch(logError);
  });
}
/**
 * The lines Claude Code wrote itself, per file, from its edit tools' input: what Edit, MultiEdit and Write put
 * in. Kept for the run's attribution; lines it changed any other way (shell commands, scripts) aren't here.
 */
const writes = new Map();
function noteWrites(run, name, input) {
  if (!/^claude/.test(run.agent) || !input?.file_path) return;
  const texts =
    name === 'Write'
      ? [input.content]
      : name === 'Edit'
        ? [input.new_string]
        : name === 'MultiEdit'
          ? (input.edits || []).map(e => e.new_string)
          : [];
  noteLines(run, input.file_path, texts);
}
/** Lines an agent wrote into a file, by the path it named, kept for the run's attribution (agentLinesOf). */
function noteLines(run, file, texts) {
  // Agents name files by the path they were given, which may run through a symlink (macOS's /var is /private/var).
  let abs = path.resolve(ROOT, file);
  try {
    abs = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
  } catch {}
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  if (!writes.has(run.id)) writes.set(run.id, new Map());
  const files = writes.get(run.id);
  for (const t of texts) if (typeof t === 'string') files.set(rel, [...(files.get(rel) || []), ...t.split('\n')]);
}
/**
 * The run's added lines its agent wrote through its edit tools, per file, as [from, to] ranges of line indexes
 * in the file after the run; absent for agents that don't report their edits.
 */
export function agentLinesOf(run) {
  const files = writes.get(run.id);
  writes.delete(run.id);
  if (!files) return undefined;
  const out = {};
  for (const c of run.changes) {
    const wrote = new Map();
    for (const l of files.get(c.path) || []) wrote.set(l, (wrote.get(l) || 0) + 1);
    const ranges = [];
    let shift = 0;
    for (const h of c.hunks) {
      h.add.forEach((l, i) => {
        if (!wrote.get(l)) return;
        wrote.set(l, wrote.get(l) - 1);
        const at = h.at + shift + i,
          last = ranges.at(-1);
        if (last && last[1] === at - 1) last[1] = at;
        else ranges.push([at, at]);
      });
      shift += h.add.length - h.del;
    }
    if (ranges.length) out[c.path] = ranges;
  }
  return out;
}
export function onAgentLine(run, line) {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    push(run, { t: 'text', text: line.slice(0, 500) });
    return;
  }
  if (m.session_id && !run.sessionId) run.sessionId = m.session_id;
  if (m.sessionId && !run.sessionId) run.sessionId = m.sessionId;
  if (m.type === 'thread.started' && m.thread_id && !run.sessionId) run.sessionId = m.thread_id;
  // The model, as the agent names it: Claude Code's and Cursor's first event, and each of Claude Code's replies.
  // Codex doesn't say. Claude Code marks its own made-up messages "<synthetic>".
  const model =
    m.type === 'system' && m.subtype === 'init' ? m.model : m.type === 'assistant' ? m.message?.model : null;
  if (typeof model === 'string' && model && !model.startsWith('<') && !run.model) run.model = model;
  // Logged out mid-session: Claude Code answers every prompt with "Not logged in".
  if (run.agent === 'claude' && m.type === 'assistant' && m.error === 'authentication_failed') {
    AGENTS.claude.problem = 'loggedOut';
    AGENTS.claude.available = false;
    claudeAsked = Date.now();
    emit('state');
  }
  if (m.type === 'assistant' && m.message?.content) {
    for (const c of m.message.content) {
      if (c.type === 'text' && c.text?.trim()) push(run, { t: 'text', text: c.text.trim() });
      if (c.type === 'tool_use') {
        push(run, { t: 'tool', text: toolLabel(c.name, c.input) });
        noteWrites(run, c.name, c.input);
      }
    }
  } else if (m.type === 'user' && Array.isArray(m.message?.content)) {
    for (const c of m.message.content) if (c.type === 'tool_result' && c.is_error) push(run, toolError(c.content));
  } else if (m.type === 'system' && m.subtype === 'post_turn_summary') {
    // Claude Code's own verdict on the turn: completed or blocked, and what it needs from you. A later
    // turn's verdict replaces an earlier one.
    run.turn = {
      status: String(m.status_category || ''),
      detail: relPaths(String(m.status_detail || '')),
      needs: relPaths(String(m.needs_action || '')),
    };
    emit('progress', run);
  } else if (m.type === 'result') {
    if (typeof m.result === 'string') run.summary = m.result.trim();
    if (m.total_cost_usd != null) run.cost = m.total_cost_usd;
    emit('progress', run);
  } else if (m.type === 'tool_call' || m.type === 'item.completed' || m.type === 'item.started') {
    const it = m.item || m.tool_call || m;
    push(run, { t: 'tool', text: it.type || it.name || m.type });
    if (it.text && m.type === 'item.completed' && /message/.test(it.type || '')) run.summary = it.text;
  }
}
/**
 * A run by an ACP harness: JSON-RPC 2.0 over its stdin and stdout, one message a line. No file system or terminal
 * is offered: the bridge reads what changed from its own snapshots. The harness's reply becomes the run's summary,
 * its tool calls the activity, and the edits it shows as diffs count as its lines. A follow-up resumes the same
 * session. What it asks before doing is answered by permitAcp. When the turn ends, the harness is stopped.
 */
function startAcp(run, prompt, scopeFile) {
  const { name, command, env } = ACP[run.agent];
  const child = spawn(command[0], command.slice(1), {
    cwd: ROOT,
    env: { ...process.env, LOA_MANAGED: '1', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  active.child = child;
  const rawOut = fs.createWriteStream(path.join(RUNS_DIR, `${run.id}.stream.jsonl`));
  const rawErr = fs.createWriteStream(path.join(RUNS_DIR, `${run.id}.stderr.log`));
  // Each tool call as told so far: a permission request may name only the call (DeepSeek Harness does).
  const waiting = new Map(),
    calls = new Map(),
    diffsSeen = new Set();
  let next = 1,
    buf = '',
    said = '',
    lastErr = '',
    prompted = false,
    outcome = null;
  const send = m => child.stdin.writable && child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = next++;
      waiting.set(id, { resolve, reject });
      send({ id, method, params });
    });
  // The reply so far, as one entry each time the harness turns to something else; the last one is the summary.
  const flush = () => {
    const text = said.trim();
    said = '';
    if (!text) return;
    push(run, { t: 'text', text });
    run.summary = text;
  };
  // The lines a tool call writes, once per call and file: from the diffs it shows (Hermes, in the request to edit
  // and again as it completes), or from an edit's own arguments (DeepSeek Harness's edit and write).
  const noteEdit = (id, tool) => {
    const raw = tool?.rawInput || {};
    const texts = [
      ...(tool?.content || []).filter(c => c?.type === 'diff').map(c => [c.path, c.newText]),
      [raw.file_path, raw.new_string ?? raw.content],
    ];
    for (const [file, text] of texts)
      if (typeof file === 'string' && typeof text === 'string' && !diffsSeen.has(`${id} ${file}`)) {
        diffsSeen.add(`${id} ${file}`);
        noteLines(run, file, [text]);
      }
  };
  const onUpdate = u => {
    if (u.sessionUpdate === 'agent_message_chunk') {
      if (u.content?.type === 'text') said += u.content.text;
      return;
    }
    if (u.sessionUpdate === 'tool_call') {
      flush();
      calls.set(u.toolCallId, u);
      push(run, { t: 'tool', text: acpToolLabel(u) });
      if (u.kind === 'edit') noteEdit(u.toolCallId, { content: u.content });
    } else if (u.sessionUpdate === 'tool_call_update') {
      const tool = { ...calls.get(u.toolCallId), ...u };
      calls.set(u.toolCallId, tool);
      if (tool.kind === 'edit') noteEdit(u.toolCallId, { content: u.content });
      if (u.status === 'failed') {
        const said = (u.content || []).map(c => c?.content?.text || '').join(' ');
        // DeepSeek Harness's read-only mode denies each write until it asks (dsh-sandbox-policy): expected.
        push(
          run,
          /\[sandbox: file access denied/.test(said)
            ? { t: 'warn', text: `Needs permission: ${acpToolLabel(tool)}` }
            : { t: 'err', text: `${acpToolLabel(tool)} failed` },
        );
      }
    } else if (u.sessionUpdate === 'config_option_update') {
      run.model = acpModel(u) ?? run.model;
      emit('progress', run);
    }
  };
  const onMessage = m => {
    if (m.id !== undefined && !m.method) {
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      if (w) m.error ? w.reject(new Error(m.error.message || 'error')) : w.resolve(m.result ?? {});
    } else if (m.method === 'session/update') {
      // A resumed session may be replayed first (Hermes does): only what comes once the prompt is sent is this run's.
      const u = m.params?.update || {};
      if (prompted || u.sessionUpdate === 'config_option_update') onUpdate(u);
    } else if (m.method === 'session/request_permission') {
      const req = m.params || {},
        id = req.toolCall?.toolCallId;
      const tool = { ...calls.get(id), ...req.toolCall };
      const answer = permitAcp(run, tool, req.options || []);
      if (answer.optionId && /^allow/.test(req.options.find(o => o.optionId === answer.optionId)?.kind))
        noteEdit(id, tool);
      send({ id: m.id, result: { outcome: answer } });
    } else if (m.id !== undefined) send({ id: m.id, error: { code: -32601, message: 'Not offered' } });
  };
  child.stdout.on('data', d => {
    rawOut.write(d);
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        onMessage(JSON.parse(line));
      } catch {}
    }
  });
  // Harnesses log freely to stderr: kept in the raw log, and its last line said only if the run fails.
  child.stderr.on('data', d => {
    rawErr.write(d);
    lastErr = String(d).trim().split('\n').at(-1) || lastErr;
  });
  child.on('error', e => push(run, { t: 'err', text: `Could not start ${command[0]}: ${e.message}` }));
  // Cancel: the harness is asked to stop the turn, and stopped if it hasn't within 3 s.
  active.cancel = () => {
    send({ method: 'session/cancel', params: { sessionId: run.sessionId } });
    setTimeout(() => child.kill('SIGTERM'), 3000).unref();
  };
  (async () => {
    const init = await call('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'league-of-agents', version: VERSION },
    });
    const where = { cwd: ROOT, mcpServers: [] };
    let session;
    if (run.sessionId && init.agentCapabilities?.sessionCapabilities?.resume)
      session = await call('session/resume', { sessionId: run.sessionId, ...where });
    else {
      if (run.sessionId) push(run, { t: 'warn', text: `${name} can't resume a session: this run starts a new one` });
      session = await call('session/new', where);
      run.sessionId = session.sessionId;
    }
    run.model = acpModel(session) ?? run.model;
    emit('progress', run);
    prompted = true;
    const r = await call('session/prompt', { sessionId: run.sessionId, prompt: [{ type: 'text', text: prompt }] });
    flush();
    if (r.stopReason === 'refusal') push(run, { t: 'err', text: `${name} refused the task` });
    if (r.stopReason === 'max_tokens' || r.stopReason === 'max_turn_requests')
      push(run, { t: 'warn', text: `${name} stopped at its limit before finishing` });
    outcome = r.stopReason === 'cancelled' ? 'cancelled' : r.stopReason === 'refusal' ? 'failed' : 'done';
  })()
    .catch(e => {
      flush();
      push(run, { t: 'err', text: `${name}: ${e.message}`.slice(0, 500) });
      outcome = 'failed';
    })
    .finally(() => {
      child.stdin.end();
      setTimeout(() => child.kill('SIGTERM'), 2000).unref();
    });
  child.on('close', code => {
    rawOut.end();
    rawErr.end();
    waiting.clear();
    try {
      fs.rmSync(scopeFile);
    } catch {}
    if (!outcome && run.status === 'running')
      push(run, { t: 'err', text: `${name} exited with code ${code}${lastErr ? `: ${lastErr.slice(0, 300)}` : ''}` });
    const ended = ['cancelled', 'interrupted'].includes(run.status) ? run.status : outcome || 'failed';
    finishRun(run, ended).catch(logError);
  });
}
/**
 * What an ACP harness asks before doing it (the tool call, as told so far): an edit is allowed when every file it
 * names is in the repo (not its .git or .loa) and in the run's scope, if it has one. Anything else is refused, and
 * the run says what. An edit is a call of kind "edit" (Hermes), or DeepSeek Harness's edit or write tool, which it
 * sends as kind "other" with the file in its arguments.
 */
function permitAcp(run, tool, options) {
  const files = [
    ...(tool.locations || []).map(l => l?.path),
    ...(tool.content || []).filter(c => c?.type === 'diff').map(c => c.path),
    tool.rawInput?.file_path,
  ].filter(f => typeof f === 'string');
  const rel = files.map(f => repoRelative(f).split(path.sep).join('/'));
  const inRepo = rel.every(
    r => r && !r.startsWith('../') && r !== '..' && !path.isAbsolute(r) && !/^\.(git|loa)\//.test(r),
  );
  const edit = tool.kind === 'edit' || (tool.kind === 'other' && ['edit', 'write'].includes(tool.title));
  const ok = edit && rel.length > 0 && inRepo && (!run.scope?.length || rel.every(r => inScope(run.scope, r)));
  const option = options.find(o => (ok ? /^allow/ : /^reject/).test(o.kind));
  if (!ok) {
    const what = acpToolLabel({ title: 'a request', ...tool });
    push(run, { t: 'deny', text: rel.length && inRepo ? `Refused, outside the scope: ${what}` : `Refused: ${what}` });
  }
  return option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' };
}
/** A tool call as an activity entry: its title, with the file or command it names when the title doesn't. */
function acpToolLabel(u) {
  const title = relPaths(String(u.title || u.kind || 'tool')).slice(0, 120);
  const f = u.locations?.[0]?.path || u.rawInput?.file_path || u.rawInput?.path;
  if (typeof f === 'string') return title.includes(path.basename(f)) ? title : `${title} ${repoRelative(f)}`;
  const cmd = u.rawInput?.command;
  return typeof cmd === 'string' && !title.includes(cmd) ? `${title} ${relPaths(cmd).slice(0, 80)}` : title;
}
/**
 * The model an ACP session runs, by the name its harness gives it: its "model" config option (DeepSeek Harness),
 * or its current model (Hermes). Null when it reports neither: never a guess.
 */
function acpModel(s) {
  const opt = (s.configOptions || []).find(o => o?.category === 'model');
  if (opt) {
    const named = (opt.options || []).flatMap(o => o.options || [o]).find(o => o.value === opt.currentValue)?.name;
    return named || (typeof opt.currentValue === 'string' ? opt.currentValue : null);
  }
  const m = s.models;
  if (typeof m?.currentModelId !== 'string') return null;
  return m.availableModels?.find(a => a.modelId === m.currentModelId)?.name || m.currentModelId;
}
/** A failed tool call, as an activity entry: blocked by the scope lock, denied, or an error. */
function toolError(content) {
  const text = relPaths(Array.isArray(content) ? content.map(c => c.text || '').join(' ') : content || '');
  const lock =
    text.match(/League of Agents scope lock: (\S+) is outside the selected scope/) ||
    text.match(/League of Agents scope lock: this edit changes (\S+ outside lines \S+)\./);
  if (lock) return { t: 'warn', text: `Blocked by the scope lock: ${lock[1]}` };
  const line = text.split('\n')[0].slice(0, 300);
  return /requires approval|permission/i.test(line) ? { t: 'deny', text: line } : { t: 'err', text: line };
}
/** Absolute paths inside the repo become repo-relative, in any text. */
function relPaths(text) {
  return String(text)
    .split(ROOT + path.sep)
    .join('')
    .split(ROOT)
    .join('.');
}
/** A path as the repo sees it, following symlinks (macOS /var is /private/var) before making it relative. */
function repoRelative(f) {
  let abs = path.resolve(ROOT, f);
  try {
    abs = fs.realpathSync(abs);
  } catch {
    try {
      abs = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
    } catch {
      /* neither the file nor its folder exists: keep the path as given */
    }
  }
  return path.relative(ROOT, abs);
}
function toolLabel(name, input = {}) {
  const f = input.file_path || input.notebook_path || input.path;
  if (f) return `${name} ${repoRelative(f)}`;
  if (input.command) return `${name} ${relPaths(input.command).slice(0, 80)}`;
  if (input.pattern) return `${name} ${input.pattern}`;
  return name;
}
