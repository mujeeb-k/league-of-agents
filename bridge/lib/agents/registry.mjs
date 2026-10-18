// The agents a run can use, which are on this machine, and the connector that starts each.
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { readJson, onPath } from '../util.mjs';
import { HOOKS, LOA } from '../repo.mjs';
import { acpConnector } from './acp.mjs';
import { saidHeld, setClaudeHeld } from '../sandbox.mjs';
import { streamConnector } from './stream.mjs';

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
 * Harnesses that speak the Agent Client Protocol (agentclientprotocol.com), run by acpConnector: Hermes Agent and
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
  // On a section, in the sandbox (sandbox.mjs), it runs in its full-access mode: its own sandbox can't start inside
  // the bridge's, which holds it to the section. Elsewhere, in its read-only mode, it asks before every write (its
  // sandbox denies the write, and it asks to escalate), so its edits outside the scope can be refused.
  dsh: {
    name: 'DeepSeek Harness',
    command: [process.env.LOA_DSH_BIN || 'dsh', '--profile', 'acp'],
    env: sandboxed => ({ DSH_PERMISSION_MODE: sandboxed ? 'danger-full-access' : 'read-only' }),
  },
};
/**
 * Cursor's command-line agent: `cursor-agent`, or `agent`, the name its newer installs give it. `agent` is a name
 * any program could have, so it counts only once its own help says it is Cursor's (its `--version` prints a date and
 * a build, with no name). LOA_CURSOR_BIN names another.
 */
function cursorCommand() {
  if (process.env.LOA_CURSOR_BIN) return process.env.LOA_CURSOR_BIN;
  if (onPath('cursor-agent') || !onPath('agent')) return 'cursor-agent';
  try {
    const help = execFileSync('agent', ['--help'], {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return /\bCursor\b/.test(help) ? 'agent' : 'cursor-agent';
  } catch {
    return 'cursor-agent';
  }
}
/** Which agents are on this machine, and the harnesses the person added. */
export function loadAgents() {
  const claude = onPath(BIN.claude);
  AGENTS.claude.available = claude;
  AGENTS.claude.problem = claude ? null : 'missing';
  BIN.cursor = cursorCommand();
  AGENTS.cursor.available = onPath(BIN.cursor);
  AGENTS.codex.available = onPath(BIN.codex);
  for (const a of [readJson(AGENTS_FILE, [])].flat())
    if (
      /^[a-z0-9-]+$/.test(a?.id) &&
      !AGENTS[a.id] &&
      !Object.hasOwn(ACP, a.id) &&
      Array.isArray(a.command) &&
      a.command.length &&
      a.command.every(s => typeof s === 'string' && s)
    )
      ACP[a.id] = { name: typeof a.name === 'string' && a.name ? a.name : a.id, command: a.command };
  for (const [id, a] of Object.entries(ACP)) AGENTS[id] = { name: a.name, available: !a.check && onPath(a.command[0]) };
  markHeld();
}
/**
 * What the app says before a run on a section: whether the system keeps each agent the bridge starts inside it.
 */
function markHeld() {
  for (const id of [...Object.keys(STREAMED), ...Object.keys(ACP)]) {
    AGENTS[id].stays = saidHeld({ agent: id, scope: ['/'] });
  }
}
/**
 * Claude Code's version, as `claude --version` printed it. From 2.1.295 it refuses a tool call when a hook marked so
 * can't run (`onFailure`); before that it lets the call through, and a session that lost its hook would be held by
 * nothing. So only from then are its sessions held (sandbox.mjs); older ones are flagged after the run.
 */
export function claudeVersion(out) {
  const [major, minor, patch] = /^(\d+)\.(\d+)\.(\d+)/.exec(String(out).trim())?.slice(1).map(Number) ?? [0, 0, 0];
  setClaudeHeld(major > 2 || (major === 2 && (minor > 1 || (minor === 1 && patch >= 295))));
  markHeld();
}
/**
 * One of the bridge's hooks for a Claude Code run, before or after its tool calls (those `matcher` names, or all):
 * passed on its command line, so nothing is written to the repo or to the person's settings. A call the hook can't
 * check is refused (`onFailure`, which Claude Code honours from 2.1.295).
 */
const hookFor = (matcher, kind) => ({
  ...(matcher ? { matcher } : {}),
  hooks: [
    {
      type: 'command',
      command: `"${process.execPath}" "${path.join(LOA, 'bridge.mjs')}" hook ${kind}`,
      timeout: 60,
      onFailure: 'block',
    },
  ],
});
/**
 * For a run the sandbox holds: before every tool call, the hook that runs its commands inside the sandbox and holds
 * its file tools (hook.mjs hold). Its own sandbox stays off: its commands already start inside one, and one sandbox
 * can't start another.
 */
const held = () => ({
  sandbox: { enabled: false },
  disableAllHooks: false,
  hooks: { PreToolUse: [hookFor(null, 'hold'), ...bracket().pre], ...bracket().post },
});
/** With the hooks on, each shell command is bracketed (shell.mjs): what it changed is told apart, line for line. */
const bracket = () =>
  HOOKS ? { pre: [hookFor('Bash', 'pre')], post: { PostToolUse: [hookFor('Bash', 'post')] } } : { pre: [], post: {} };
/**
 * For a run nothing holds, on a selection: its edit tools are refused outside it (hook.mjs pre) and, with the hooks
 * on, each shell command is bracketed so what it changed outside is put back (shell.mjs). These come with the run:
 * the repo's own hook file may hold none of them (the hooks off, or the file in git). Where it does, the same check
 * runs twice and a command's two brackets are one (shellStarts keeps the later, shellEnds the first).
 */
const unheld = run =>
  run.scope?.length
    ? {
        disableAllHooks: false,
        hooks: {
          PreToolUse: [hookFor('Edit|Write|MultiEdit|NotebookEdit', 'pre'), ...bracket().pre],
          ...bracket().post,
        },
      }
    : {};
/**
 * @typedef {'done' | 'failed' | 'cancelled'} Outcome
 * @typedef {{ cancel(): void; done: Promise<Outcome> }} Session  An agent at work on one run.
 * @typedef {{ start(run: any, prompt: string, scopeFile: string): Session }} Connector
 */
/** @type {Record<string, Connector>} */
const STREAMED = {
  claude: streamConnector(
    () => BIN.claude,
    (prompt, run, sandboxed) => [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      // Held by the sandbox: the repo's own settings don't load, as their hooks and MCP servers would run outside
      // it, on files the session may have just written; the bridge's hook answers every call (hook.mjs hold), and
      // one the hook never saw is refused, as the hook couldn't check it. Anywhere else its settings load as in a
      // terminal, and nothing it would ask about is refused unasked: no one is there to answer, so it runs as
      // allowed, held only to its section, where it has one, by the hook (hook.mjs pre).
      ...(sandboxed ? ['--setting-sources', 'user'] : []),
      '--permission-mode',
      sandboxed ? 'dontAsk' : 'bypassPermissions',
      '--settings',
      JSON.stringify(sandboxed ? held() : unheld(run)),
      ...(run.sessionId ? ['--resume', run.sessionId] : []),
    ],
  ),
  cursor: streamConnector(
    () => BIN.cursor,
    (prompt, { sessionId }) => [
      '-p',
      '--force',
      '--output-format',
      'stream-json',
      ...(sessionId ? ['--resume', sessionId] : []),
      prompt,
    ],
  ),
  codex: streamConnector(
    () => BIN.codex,
    (prompt, { sessionId }) => [
      'exec',
      '--json',
      '--sandbox',
      'workspace-write',
      ...(sessionId ? ['resume', sessionId] : []),
      prompt,
    ],
  ),
};
/** What starts an agent's run, or undefined for one the bridge doesn't start (watch mode, a captured terminal). */
export const connectorOf = id => STREAMED[id] ?? (ACP[id] ? acpConnector(ACP[id]) : undefined);
/**
 * How an agent is kept to its scope while it works, where the sandbox doesn't hold it: 'hooks', Claude Code's edit
 * tools refused outside it by the hook each run is started with; 'asks', a harness that asks before editing and is
 * refused outside the scope (Hermes, DeepSeek Harness in its read-only mode); or 'none', its edits outside flagged
 * after the run.
 * @returns {'hooks' | 'asks' | 'none'}
 */
export function lockOf(id) {
  if (id === 'claude') return 'hooks';
  return id === 'hermes' || id === 'dsh' ? 'asks' : 'none';
}
