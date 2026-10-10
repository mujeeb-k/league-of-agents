// Harnesses that speak the Agent Client Protocol: Hermes, DeepSeek Harness, and any the person adds.
import path from 'node:path';
import { VERSION } from '../paths.mjs';
import { inScope } from '../scope.mjs';
import { ROOT } from '../repo.mjs';
import { line } from '../util.mjs';
import { blocked, push, refusedBySandbox } from '../runs.mjs';
import { step, stepDone, stepRefused, stepsOf } from '../steps.mjs';
import { lockOfRun } from '../sandbox.mjs';
import { emit } from '../events.mjs';
import { noteLines } from './lines.mjs';
import { refusedWrite, relPaths, repoRelative, toolSaid } from './labels.mjs';
import { launch } from './process.mjs';

/**
 * A connector for an ACP harness: each run is JSON-RPC 2.0 over its stdin and stdout, one message a line. No file
 * system or terminal is offered: the bridge reads what changed from its own snapshots. The harness's reply becomes
 * the run's summary, its tool calls the activity, and the edits it shows as diffs count as its lines. A follow-up
 * resumes the same session. What it asks before doing is answered by permitAcp. When the turn ends, the harness is
 * stopped.
 * @returns {import('./registry.mjs').Connector}
 */
export function acpConnector({ name, command, env }) {
  return { start: (run, prompt) => startAcp(run, prompt, name, command, env) };
}
/** What a call still waiting for its answer is rejected with when the harness exits. */
const EXITED = new Error('exited');

/** @returns {import('./registry.mjs').Session} */
function startAcp(run, prompt, name, command, env) {
  // Each tool call as told so far: a permission request may name only the call (DeepSeek Harness does).
  const waiting = new Map(),
    calls = new Map(),
    // Each tool call's steps (steps.mjs), by its id.
    steps = new Map(),
    diffsSeen = new Set();
  let next = 1,
    said = '',
    lastErr = '',
    prompted = false,
    outcome = null;
  // Harnesses log freely to stderr: kept in the raw log, and its last line said only if the run fails.
  const { child, closed } = launch(run, () => command, {
    env: sandboxed => (typeof env === 'function' ? env(sandboxed) : (env ?? {})),
    stdin: true,
    onLine: line => {
      try {
        onMessage(JSON.parse(line));
      } catch {}
    },
    onStderr: d => (lastErr = d.trim().split('\n').at(-1) || lastErr),
  });
  // A write can race the harness's exit (a cancel as it ends): the pipe's error is that exit, said when it closes.
  child.stdin.on('error', () => {});
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
  // The steps a request to edit is about: its call's, or, as Hermes asks under an id of its own, the newest edit step
  // of each file it names.
  const stepsAsked = (id, tool) =>
    steps.get(id) ??
    filesOf(tool).flatMap(f => {
      const i = stepsOf(run).findLastIndex(s => s?.act === 'edit' && s.file === f);
      return i < 0 ? [] : [i];
    });
  // Edit steps allowed and not yet said to be done: Hermes says nothing after writing, so its next update, or the
  // turn's end, says the edit is done.
  const allowed = new Set();
  const settle = () => {
    for (const i of allowed) stepDone(run, i);
    allowed.clear();
  };
  const onUpdate = u => {
    if (u.sessionUpdate !== 'usage_update' && u.sessionUpdate !== 'config_option_update') settle();
    // A harness may say what the turn has cost so far (ACP usage_update); Hermes and DeepSeek Harness don't.
    if (u.sessionUpdate === 'usage_update') {
      if (u.cost?.currency === 'USD' && typeof u.cost.amount === 'number') {
        run.cost = u.cost.amount;
        emit('progress', run);
      }
      return;
    }
    if (u.sessionUpdate === 'agent_message_chunk') {
      if (u.content?.type === 'text') said += u.content.text;
      return;
    }
    if (u.sessionUpdate === 'tool_call') {
      flush();
      calls.set(u.toolCallId, u);
      const files = filesOf(u).filter(insideRepo);
      const act = isEdit(u) ? 'edit' : u.kind === 'read' ? 'read' : u.kind === 'execute' ? 'run' : 'other';
      const cmd = u.rawInput?.command ?? /^terminal: (.*)$/s.exec(String(u.title))?.[1];
      push(run, { t: 'tool', text: acpToolLabel(u), ...toolSaid(act, files[0], cmd) });
      const label = relPaths(String(u.title || u.kind)).slice(0, 120);
      steps.set(
        u.toolCallId,
        (files.length ? files : [undefined]).map(f => step(run, act, label, f)),
      );
      if (u.kind === 'edit') noteEdit(u.toolCallId, { content: u.content });
    } else if (u.sessionUpdate === 'tool_call_update') {
      const tool = { ...calls.get(u.toolCallId), ...u };
      calls.set(u.toolCallId, tool);
      if (tool.kind === 'edit') noteEdit(u.toolCallId, { content: u.content });
      // A command whose write the sandbox refused, failed or not (Hermes's terminal tool, DeepSeek Harness's bash).
      else if (!isEdit(tool) && lockOfRun(run) === 'sandbox' && refusedWrite(textOf(u), true))
        refusedBySandbox(run, textOf(u));
      // DeepSeek Harness's edit or write, done without asking (its full-access mode, in the sandbox): its arguments.
      else if (isEdit(tool) && u.status === 'completed') noteEdit(u.toolCallId, tool);
      if (isEdit(tool) && u.status === 'completed')
        for (const i of steps.get(u.toolCallId) ?? []) {
          allowed.delete(i);
          stepDone(run, i);
        }
      if (u.status === 'failed') {
        const text = textOf(u);
        const outside = isEdit(tool) ? filesOf(tool).filter(f => run.scope?.length && !inScope(run.scope, f)) : [];
        // DeepSeek Harness's read-only mode denies each write until it asks (dsh-sandbox-policy): expected.
        if (/\[sandbox: file access denied/.test(text))
          push(
            run,
            line('warn', 'needs-permission', `Needs permission: ${acpToolLabel(tool)}`, { what: acpToolLabel(tool) }),
          );
        // An edit outside the section the system refused (DeepSeek Harness's full-access mode, in the sandbox).
        else if (outside.length && refusedWrite(text, lockOfRun(run) === 'sandbox')) {
          for (const i of steps.get(u.toolCallId) ?? []) stepRefused(run, i);
          for (const f of outside) blocked(run, f);
        } else push(run, line('err', 'tool-failed', `${acpToolLabel(tool)} failed`, { what: acpToolLabel(tool) }));
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
      if (answer.optionId && /^allow/.test(req.options.find(o => o.optionId === answer.optionId)?.kind)) {
        noteEdit(id, tool);
        if (isEdit(tool)) for (const i of stepsAsked(id, tool)) allowed.add(i);
      } else if (isEdit(tool)) for (const i of stepsAsked(id, tool)) stepRefused(run, i);
      send({ id: m.id, result: { outcome: answer } });
    } else if (m.id !== undefined) send({ id: m.id, error: { code: -32601, message: 'Not offered' } });
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
      if (run.sessionId)
        push(
          run,
          line('warn', 'no-resume', `${name} can't resume a session: this run starts a new one`, { agent: name }),
        );
      session = await call('session/new', where);
      run.sessionId = session.sessionId;
    }
    run.model = acpModel(session) ?? run.model;
    emit('progress', run);
    prompted = true;
    const r = await call('session/prompt', { sessionId: run.sessionId, prompt: [{ type: 'text', text: prompt }] });
    flush();
    settle();
    if (r.stopReason === 'refusal') push(run, line('err', 'refused-task', `${name} refused the task`, { agent: name }));
    if (r.stopReason === 'max_tokens' || r.stopReason === 'max_turn_requests')
      push(run, line('warn', 'hit-limit', `${name} stopped at its limit before finishing`, { agent: name }));
    outcome = r.stopReason === 'cancelled' ? 'cancelled' : r.stopReason === 'refusal' ? 'failed' : 'done';
  })()
    .catch(e => {
      // The harness exited mid-call: said once, as it closes (done).
      if (e === EXITED) return;
      flush();
      push(
        run,
        line('err', 'agent-error', `${name}: ${e.message}`.slice(0, 500), {
          agent: name,
          why: e.message.slice(0, 400),
        }),
      );
      outcome = 'failed';
    })
    .finally(() => {
      child.stdin.end();
      setTimeout(() => child.kill('SIGTERM'), 2000).unref();
    });
  const done = closed.then(code => {
    for (const w of waiting.values()) w.reject(EXITED);
    waiting.clear();
    if (!outcome && run.status === 'running')
      push(
        run,
        lastErr
          ? line('err', 'exited-why', `${name} exited with code ${code}: ${lastErr.slice(0, 300)}`, {
              agent: name,
              code: String(code),
              why: lastErr.slice(0, 300),
            })
          : line('err', 'exited', `${name} exited with code ${code}`, { agent: name, code: String(code) }),
      );
    return outcome || 'failed';
  });
  return {
    // The harness is asked to stop its turn, and stopped if it hasn't within 3 s.
    cancel() {
      send({ method: 'session/cancel', params: { sessionId: run.sessionId } });
      setTimeout(() => child.kill('SIGTERM'), 3000).unref();
    },
    done,
  };
}
/** What a tool call update says: the text of its content. */
const textOf = u => (u.content || []).map(c => c?.content?.text || '').join(' ');
/** An edit: a call of kind "edit" (Hermes), or DeepSeek Harness's edit or write tool, sent as kind "other". */
const isEdit = tool => tool.kind === 'edit' || (tool.kind === 'other' && ['edit', 'write'].includes(tool.title));
/**
 * What an ACP harness asks before doing it (the tool call, as told so far): an edit is allowed when every file it
 * names is in the repo (not its .git or .loa) and in the run's scope, if it has one. Anything else is refused, and
 * the run says what; an edit outside the scope is asked of the person.
 */
function permitAcp(run, tool, options) {
  const rel = filesOf(tool);
  // Any case: macOS's disk doesn't tell .GIT from .git.
  const inRepo = rel.every(r => insideRepo(r) && !/^\.(git|loa)(\/|$)/i.test(r));
  const outside = run.scope?.length ? rel.filter(r => !inScope(run.scope, r)) : [];
  const ok = isEdit(tool) && rel.length > 0 && inRepo && !outside.length;
  const option = options.find(o => (ok ? /^allow/ : /^reject/).test(o.kind));
  // An edit outside the section: the person is asked (runs.mjs blocked).
  if (!ok && isEdit(tool) && inRepo && outside.length) for (const f of outside) blocked(run, f);
  else if (!ok) {
    const what = acpToolLabel({ title: 'a request', ...tool });
    push(run, line('deny', 'refused-request', `Refused: ${what}`, { what }));
  }
  return option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' };
}
/** A path inside the repo: not above it, nor elsewhere on the machine. */
const insideRepo = r => !!r && r !== '..' && !r.startsWith('../') && !path.isAbsolute(r);
/** The files a tool call names, as the repo names them. */
const filesOf = tool =>
  [
    ...(tool.locations || []).map(l => l?.path),
    ...(tool.content || []).filter(c => c?.type === 'diff').map(c => c.path),
    tool.rawInput?.file_path,
  ]
    .filter(f => typeof f === 'string')
    .map(f => repoRelative(f).split(path.sep).join('/'));
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
