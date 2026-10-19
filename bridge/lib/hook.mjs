// What the agents' own hooks run (bridge/loa.mjs hook ...): the scope lock before an edit, and a terminal or editor
// turn recorded as a run. It loads without starting anything: it runs on every tool call, so it must start fast.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loaOf, readJson, realish, splitLines } from './util.mjs';
import { inScope, rangeKept } from './scope.mjs';

/** Runs started by an agent's own hooks, by agent: Claude Code and Codex in a terminal, Cursor in its editor. */
export const HOOK_AGENT = { claude: 'claude-terminal', codex: 'codex-terminal', cursor: 'cursor-editor' };

export async function runHook(kind, agent = 'claude') {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const d of process.stdin) input += d;
  let data = {};
  try {
    data = JSON.parse(input || '{}');
  } catch {}
  // Cursor also runs Claude Code's hook files; its payload says it is Cursor's.
  if (data.cursor_version) agent = 'cursor';
  const cwd = data.cwd || data.workspace_roots?.[0] || process.cwd();
  if (kind === 'post' || (kind === 'pre' && data.tool_name === 'Bash')) await shellBracket(kind, data);
  if (kind === 'hold') hold(data, cwd);
  if (kind === 'pre') {
    const why = editRefused(data, cwd);
    if (why) block(why);
    process.exit(0);
  }
  // Cursor reads an answer from every hook; its run goes on either way.
  const done = () => {
    if (agent === 'cursor') say(kind === 'start' ? '{"continue":true}\n' : '{}\n');
    process.exit(0);
  };
  if (process.env.LOA_MANAGED) done();
  // Claude Code also sends its own notices (a background task finishing) as prompts: they are not the person's.
  if (kind === 'start' && /^\s*<task-notification>/.test(data.prompt || '')) done();
  const repos = agent === 'cursor' ? cursorRepos(data, kind) : [repoOf(cwd)].filter(Boolean);
  const sessionId = data.session_id ?? data.conversation_id ?? null;
  // Each agent's payload, as a run: the prompt and session at the start; the reply and outcome at the end.
  const body =
    kind === 'start'
      ? { agent: HOOK_AGENT[agent], prompt: data.prompt, sessionId }
      : {
          sessionId,
          ...(agent === 'codex'
            ? { summary: data.last_assistant_message || '' }
            : agent === 'cursor'
              ? { summary: '', status: data.status }
              : lastTurn(data.transcript_path)),
        };
  await Promise.all(
    repos.map(async root => {
      const b = liveBridge(root);
      if (!b) return;
      try {
        await fetch(`http://127.0.0.1:${b.port}/api/capture/${kind === 'start' ? 'start' : 'stop'}`, {
          method: 'POST',
          headers: { authorization: 'Bearer ' + b.token, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(kind === 'stop' ? 60000 : 3000),
        });
      } catch {}
    }),
  );
  done();
}

/** Refuses a tool call, in words Claude Code hands to the session. */
function block(why) {
  process.stderr.write(`League of Agents scope lock: ${why}`);
  process.exit(2);
}

/** A path as the repo names it: real on both sides, since the repo may sit behind a symlink (/tmp is /private/tmp). */
const relTo = (root, cwd, f) =>
  path
    .relative(realish(root), realish(path.resolve(cwd, f)))
    .split(path.sep)
    .join('/');

/**
 * Why an edit tool's call is outside its session's selection, or null: the file is outside it, or the edit changes
 * lines outside the ones selected. A session on the whole repository has no selection to be outside of.
 */
function editRefused(data, cwd) {
  const scopeFile = process.env.LOA_SCOPE_FILE;
  if (!scopeFile) return null;
  const { scope, ranges } = selectionOf(scopeFile);
  const input = data.tool_input || {};
  const f = input.file_path || input.notebook_path;
  if (!scope.length || !f) return null;
  const rel = relTo(repoOf(cwd) ?? cwd, cwd, f);
  // The person is asked whether it may (runs.mjs blocked), and the session told to carry on if they allow it.
  const asked = " The user is asked whether you may; you'll be told if they allow it. Carry on inside the scope.";
  if (!inScope(scope, rel)) return `${rel} is outside the selected scope. Only edit: ${scope.join(', ')}.${asked}`;
  const range = ranges[rel];
  if (!range) return null;
  // The file as this edit would leave it, held against the file as the run found it.
  let text = fs.existsSync(path.resolve(cwd, f)) ? fs.readFileSync(path.resolve(cwd, f), 'utf8') : '';
  const edits = input.edits || (input.old_string !== undefined ? [input] : []);
  if (input.content !== undefined) text = input.content;
  for (const e of edits)
    text = e.replace_all ? text.split(e.old_string).join(e.new_string) : text.replace(e.old_string, () => e.new_string);
  return rangeKept(splitLines(range.before), splitLines(text), range)
    ? null
    : `this edit changes ${rel} outside lines ${range.from}–${range.to}. Only edit those lines; keep every other line as it is.${asked}`;
}

/** Claude Code's tools that write the file they name, and those that read files or list them. */
const EDITS = /^(Edit|Write|MultiEdit|NotebookEdit)$/,
  READS = /^(Read|Glob|Grep|LS)$/;
/** Its tools that touch no file and run no program on this machine. */
const FREE =
  /^(Agent|Task|TaskCreate|TaskGet|TaskList|TaskOutput|TaskStop|TaskUpdate|TodoWrite|WebFetch|WebSearch|BashOutput|KillBash|KillShell|Skill|ToolSearch|ExitPlanMode|AskUserQuestion)$/;
const quoted = s => `'${String(s).replace(/'/g, "'\\''")}'`;
/**
 * A bridge's key, in its settings or its log, where a bridge before this one kept them, in any case (macOS's disk
 * reads .LOA as .loa).
 */
const TOKEN = /[\\/]\.loa[\\/]bridge\.(json|log)$/i;
/** The repos of the bridges running on this computer, as they registered (hooks-install.mjs markRunning). */
function runningRoots(home) {
  const dir = path.join(home, '.config/league-of-agents/running');
  try {
    return fs.readdirSync(dir).flatMap(f => {
      const root = readJson(path.join(dir, f), {}).root;
      return typeof root === 'string' ? [realish(root)] : [];
    });
  } catch {
    return [];
  }
}

/**
 * A tool call of a Claude Code session the bridge holds (sandbox.mjs). Claude Code itself runs outside the sandbox;
 * this is what keeps what it does inside. A shell command is rewritten to run inside the run's sandbox: its text goes
 * to a file, untouched, and the command line names only that file, so nothing in the text is read by a shell outside
 * the sandbox. A file tool's writes are held to the selection, never to what runs later outside the sandbox, and it
 * never reads a bridge's key. A tool that touches no file runs; any other (an MCP server's, Monitor) would run outside
 * the sandbox, so it is refused, and said. Whatever goes wrong here, the call is refused.
 */
/**
 * Writes the hook's answer whole. To a pipe, `process.stdout.write` returns before a long answer is written, and
 * the `process.exit` that follows cuts it at what the pipe took at once: 8,192 bytes on some Macs, 65,536 on
 * others. The answer that holds a command with the sandbox's rules is longer than the first.
 */
function say(text) {
  const bytes = Buffer.from(text);
  for (let at = 0; at < bytes.length;) {
    try {
      at += fs.writeSync(1, bytes, at);
    } catch (e) {
      // The pipe is full until its reader takes some: tried again.
      if (e.code !== 'EAGAIN') throw e;
    }
  }
}
function hold(data, cwd) {
  // Said in so many words: the session runs in the mode where Claude Code does only what is allowed (registry.mjs),
  // so a call this hook never saw is left to Claude Code's own check, not run.
  const allow = updatedInput => {
    say(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          ...(updatedInput ? { updatedInput } : {}),
        },
      }),
    );
    process.exit(0);
  };
  try {
    const dir = process.env.LOA_HOLD_DIR;
    const h = JSON.parse(fs.readFileSync(path.join(dir, 'hold.json'), 'utf8'));
    const tool = String(data.tool_name),
      input = data.tool_input || {};
    if (tool === 'Bash') {
      if (typeof input.command !== 'string') throw new Error('no command');
      const id = String(data.tool_use_id ?? '').replace(/[^A-Za-z0-9_-]/g, '') || `${Date.now()}-${process.pid}`;
      const file = path.join(dir, 'commands', `${id}.sh`);
      fs.writeFileSync(file, input.command);
      const command = [...h.args, '/bin/bash', file].map(quoted).join(' ');
      allow({ ...input, command });
    }
    if (FREE.test(tool)) allow();
    // Any other tool runs in Claude Code's own process, outside the sandbox, so it could write past the section (an
    // MCP server's, Monitor): refused, and said on the run.
    if (!EDITS.test(tool) && !READS.test(tool)) block(`${tool} can't be used in a session on a section.`);
    const under = (p, d) => p === d || p.startsWith(d + path.sep);
    // What the call names: a file, a folder to search, and for Glob the part of its pattern before any wildcard.
    const named = [
      input.file_path,
      input.notebook_path,
      input.path ?? (READS.test(tool) && tool !== 'Read' ? cwd : null),
    ];
    if (tool === 'Glob' && typeof input.pattern === 'string')
      named.push(path.resolve(input.path ?? cwd, input.pattern.split(/[*?[{]/)[0]));
    const paths = named.filter(p => typeof p === 'string').map(p => realish(path.resolve(cwd, p)));
    if (!paths.length) throw new Error('no path');
    for (const p of paths) {
      const rel = path.relative(h.root, p);
      // A bridge's token, this repo's or another's: a session that read it could have a bridge write for it, outside its
      // section. And a search of a folder that holds another running bridge's repo, which Grep would read.
      if (TOKEN.test(p)) block(`${rel} holds League of Agents' key, which a session never reads.`);
      if (tool === 'Grep' && runningRoots(h.home).some(root => root !== h.root && under(root, p)))
        block(`${p} holds another repo that League of Agents works in, whose key a session never reads.`);
      // League of Agents' records, every repo's runs and each bridge's key (util.mjs loaOf), and a search of a folder
      // that holds them.
      const records = path.join(h.home, '.config/league-of-agents/repos');
      if (under(p, records) || (tool !== 'Read' && READS.test(tool) && under(records, p)))
        block(`${p} holds League of Agents' records and keys, which a session never reads.`);
      // The Keychain's files, and a search of a folder that holds them (Grep and Glob read outside the sandbox).
      const keychain = path.join(h.home, 'Library/Keychains');
      if (under(p, keychain) || (tool !== 'Read' && READS.test(tool) && under(keychain, p)))
        block(`${p} holds the Keychain's files, which a session started from the map never reads.`);
      if (!EDITS.test(tool)) continue;
      const held =
        h.git.some(d => under(p, d)) || h.never.some(([kind, at]) => (kind === 'subpath' ? under(p, at) : p === at));
      if (held) block(`${rel} is never changed by a session: it runs later, outside the session.`);
    }
    const why = EDITS.test(tool) ? editRefused(data, cwd) : null;
    if (why) block(why);
    allow();
  } catch (e) {
    block(`this tool call couldn't be checked (${e.message}), so it was not run.`);
  }
}

/**
 * A shell command of a session with a section, bracketed: the bridge snapshots before and after it (lib/shell.mjs).
 * What it changed outside the section is put back, and Claude Code is told so (exit 2). Anything else, a terminal
 * session among them, passes at once.
 */
async function shellBracket(kind, data) {
  const scopeFile = process.env.LOA_SCOPE_FILE || '';
  const id = /scope-(\d+)\.json$/.exec(scopeFile)?.[1];
  // The run's own port and token, from the bridge that started it (lib/shell.mjs shellAccess).
  const { LOA_BRIDGE_PORT: port, LOA_SHELL_TOKEN: token } = process.env;
  if (!id || !port || !token) process.exit(0);
  const { scope } = kind === 'pre' ? selectionOf(scopeFile) : { scope: readJson(scopeFile, null)?.scope ?? [] };
  if (!scope.length) process.exit(0);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/runs/${id}/shell`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ phase: kind === 'pre' ? 'start' : 'end', tool: data.tool_use_id }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`the bridge answered ${res.status}`);
    const { undone = [] } = /** @type {{ undone?: string[] }} */ (await res.json());
    if (undone.length) {
      process.stderr.write(
        `League of Agents scope lock: a shell command changed ${undone.join(', ')} outside the selected scope, so it ` +
          `was put back. Only edit: ${scope.join(', ')}`,
      );
      process.exit(2);
    }
  } catch {
    // Without its snapshot before, what the command changes outside the section couldn't be put back: it doesn't run.
    if (kind === 'pre') {
      process.stderr.write(
        "League of Agents scope lock: the bridge didn't answer, so this command can't be checked and was not run.",
      );
      process.exit(2);
    }
  }
  process.exit(0);
}

/**
 * A session's selection, from the file its bridge wrote. One that can't be read blocks the tool call: the lock fails
 * closed.
 */
function selectionOf(scopeFile) {
  try {
    const { scope, ranges = {} } = JSON.parse(fs.readFileSync(scopeFile, 'utf8'));
    if (!Array.isArray(scope)) throw new Error('no scope');
    return { scope, ranges };
  } catch {
    process.stderr.write(
      "League of Agents scope lock: this session's selection can't be read, so nothing may be changed. Stop here.",
    );
    process.exit(2);
  }
}

/** The git repo a folder is in, or null. */
function repoOf(dir) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}

/** A repo's bridge, if one is running there. */
function liveBridge(root) {
  // Or, for a bridge before this one, the file it kept in the repo.
  const b =
    readJson(path.join(loaOf(root), 'bridge.json'), null) ?? readJson(path.join(root, '.loa', 'bridge.json'), null);
  if (!b?.token || !b.pid) return null;
  try {
    process.kill(b.pid, 0);
    return b;
  } catch {
    return null;
  }
}

/**
 * The repos a Cursor turn belongs to. Cursor's workspace may be the repo, or a folder holding it: each
 * workspace root counts if it is in a repo, and otherwise each folder directly in it that has a running
 * bridge. Files attached to the prompt narrow it down. A prompt records only when one repo is left; watch
 * mode still sees the change otherwise. A stop goes to all of them: each bridge closes only the run of the
 * same conversation.
 */
function cursorRepos(data, kind) {
  const live = roots => [...new Set(roots.filter(Boolean))].filter(liveBridge);
  const inWorkspace = live(
    (data.workspace_roots || []).flatMap(w => {
      const r = repoOf(w);
      if (r) return [r];
      try {
        return fs
          .readdirSync(w, { withFileTypes: true })
          .filter(e => e.isDirectory() && liveBridge(path.join(w, e.name)))
          .map(e => path.join(w, e.name));
      } catch {
        return [];
      }
    }),
  );
  const attached = live(
    (data.attachments || []).map(a => {
      const f = a?.filePath || a?.file_path;
      return f && repoOf(path.dirname(f));
    }),
  );
  if (kind !== 'start') return [...new Set([...inWorkspace, ...attached])];
  const pick = attached.length ? attached : inWorkspace;
  return pick.length === 1 ? pick : [];
}

/**
 * The turn that just ended in a terminal session, read from Claude Code's transcript: the messages after
 * the last prompt, in stream-json shape, and the final reply as the summary. Successful tool output is
 * dropped to keep the request small; failed results are kept so blocks and denials show in the activity.
 */
function lastTurn(transcriptPath) {
  let lines = [];
  try {
    lines = fs
      .readFileSync(transcriptPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l))
      .filter(m => (m.type === 'user' || m.type === 'assistant') && !m.isSidechain && m.message);
  } catch {
    return { summary: '' };
  }
  const isPrompt = m =>
    m.type === 'user' &&
    (typeof m.message.content === 'string' || m.message.content.every(c => c.type !== 'tool_result'));
  let start = lines.length - 1;
  while (start >= 0 && !isPrompt(lines[start])) start--;
  const turn = lines.slice(start + 1);
  const events = turn
    .map(m =>
      m.type === 'assistant'
        ? { type: 'assistant', message: { content: m.message.content, model: m.message.model } }
        : {
            type: 'user',
            message: {
              content: Array.isArray(m.message.content) ? m.message.content.filter(c => c.is_error) : [],
            },
          },
    )
    // The last 200 for the stream; every edit-tool call, which attribution reads, however long the turn.
    .filter(
      (e, i, all) =>
        i >= all.length - 200 ||
        (e.type === 'assistant' && e.message.content.some?.(c => /^(Edit|Write|MultiEdit)$/.test(c.name))),
    );
  const last = [...turn]
    .reverse()
    .find(m => m.type === 'assistant' && m.message.content.some?.(c => c.type === 'text'));
  const summary = last
    ? last.message.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n')
        .trim()
    : '';
  return { summary, events };
}
