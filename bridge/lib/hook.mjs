// What the agents' own hooks run (bridge/loa.mjs hook ...): the scope lock before an edit, and a terminal or editor
// turn recorded as a run. It loads without starting anything: it runs on every tool call, so it must start fast.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readJson, splitLines } from './util.mjs';
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
  if (kind === 'pre') {
    const scopeFile = process.env.LOA_SCOPE_FILE;
    if (!scopeFile || !fs.existsSync(scopeFile)) process.exit(0);
    const { scope, ranges } = JSON.parse(fs.readFileSync(scopeFile, 'utf8'));
    if (!scope.length) process.exit(0);
    const input = data.tool_input || {};
    const f = input.file_path || input.notebook_path;
    if (!f) process.exit(0);
    let root = cwd;
    try {
      root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
    } catch {}
    // Real paths on both sides: the repo may sit behind a symlink (macOS's /tmp is /private/tmp).
    const real = p => {
      try {
        return fs.realpathSync(p);
      } catch {
        return path.join(real(path.dirname(p)), path.basename(p));
      }
    };
    const rel = path
      .relative(real(root), real(path.resolve(cwd, f)))
      .split(path.sep)
      .join('/');
    const block = why => {
      process.stderr.write(`League of Agents scope lock: ${why}`);
      process.exit(2);
    };
    // The person is asked whether it may (runs.mjs blocked), and the session told to carry on if they allow it.
    const asked = " The user is asked whether you may; you'll be told if they allow it. Carry on inside the scope.";
    if (!inScope(scope, rel)) block(`${rel} is outside the selected scope. Only edit: ${scope.join(', ')}.${asked}`);
    const range = ranges[rel];
    if (range) {
      // The file as this edit would leave it, held against the file as the run found it.
      let text = fs.existsSync(path.resolve(cwd, f)) ? fs.readFileSync(path.resolve(cwd, f), 'utf8') : '';
      const edits = input.edits || (input.old_string !== undefined ? [input] : []);
      if (input.content !== undefined) text = input.content;
      for (const e of edits)
        text = e.replace_all
          ? text.split(e.old_string).join(e.new_string)
          : text.replace(e.old_string, () => e.new_string);
      if (!rangeKept(splitLines(range.before), splitLines(text), range))
        block(
          `this edit changes ${rel} outside lines ${range.from}–${range.to}. Only edit those lines; keep every other line as it is.${asked}`,
        );
    }
    process.exit(0);
  }
  // Cursor reads an answer from every hook; its run goes on either way.
  const done = () => {
    if (agent === 'cursor') process.stdout.write(kind === 'start' ? '{"continue":true}\n' : '{}\n');
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

/**
 * A shell command of a session with a section, bracketed: the bridge snapshots before and after it (lib/shell.mjs).
 * What it changed outside the section is put back, and Claude Code is told so (exit 2). Anything else, a terminal
 * session among them, passes at once.
 */
async function shellBracket(kind, data) {
  const scopeFile = process.env.LOA_SCOPE_FILE || '';
  const id = /scope-(\d+)\.json$/.exec(scopeFile)?.[1];
  const scope = id ? (readJson(scopeFile, null)?.scope ?? []) : [];
  // The run's own port and token, from the bridge that started it (lib/shell.mjs shellAccess).
  const { LOA_BRIDGE_PORT: port, LOA_SHELL_TOKEN: token } = process.env;
  if (!scope.length || !port || !token) process.exit(0);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/runs/${id}/shell`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ phase: kind === 'pre' ? 'start' : 'end', tool: data.tool_use_id }),
      signal: AbortSignal.timeout(60000),
    });
    const { undone = [] } = /** @type {{ undone?: string[] }} */ (await res.json());
    if (undone.length) {
      process.stderr.write(
        `League of Agents scope lock: a shell command changed ${undone.join(', ')} outside the selected scope, so it ` +
          `was put back. Only edit: ${scope.join(', ')}`,
      );
      process.exit(2);
    }
  } catch {}
  process.exit(0);
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
  const b = readJson(path.join(root, '.loa', 'bridge.json'), null);
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
          .filter(e => e.isDirectory() && fs.existsSync(path.join(w, e.name, '.loa', 'bridge.json')))
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
