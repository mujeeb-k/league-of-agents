// The agents a run can use, which are on this machine, and the connector that starts each.
import os from 'node:os';
import path from 'node:path';
import { readJson, onPath } from '../util.mjs';
import { HOOKS } from '../repo.mjs';
import { acpConnector } from './acp.mjs';
import { lockOfRun } from '../sandbox.mjs';
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
/** Which agents are on this machine, and the harnesses the person added. */
export function loadAgents() {
  const claude = onPath(BIN.claude);
  AGENTS.claude.available = claude;
  AGENTS.claude.problem = claude ? null : 'missing';
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
  // On a section, whether the system keeps each agent the bridge starts inside it (the app says so before a run).
  for (const id of [...Object.keys(STREAMED), ...Object.keys(ACP)])
    AGENTS[id].stays = lockOfRun({ agent: id, scope: ['/'] }) === 'sandbox';
  // On the whole repository, whether the system keeps each inside the repo.
  for (const id of [...Object.keys(STREAMED), ...Object.keys(ACP)])
    AGENTS[id].contained = lockOfRun({ agent: id, scope: [] }) === 'sandbox';
}
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
      // Inside the sandbox, the sandbox is the limit: Claude Code runs commands without its own permission check,
      // which refused harmless ones (pipes, loops, its own verification). Anywhere else, it keeps that check.
      '--permission-mode',
      sandboxed ? 'bypassPermissions' : 'acceptEdits',
      // Inside the section's sandbox, Claude Code's own can't start (one sandbox can't start another).
      ...(sandboxed ? ['--settings', '{"sandbox":{"enabled":false}}'] : []),
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
/** The command an agent the bridge starts is run by. */
export const commandOf = id => BIN[id] ?? ACP[id]?.command[0];
/** What starts an agent's run, or undefined for one the bridge doesn't start (watch mode, a captured terminal). */
export const connectorOf = id => STREAMED[id] ?? (ACP[id] ? acpConnector(ACP[id]) : undefined);
/**
 * How an agent is kept to its scope while it works: 'hooks', Claude Code's edit tools blocked by the scope lock
 * (only with the hooks on); 'asks', a harness that asks before editing and is refused outside the scope (Hermes,
 * DeepSeek Harness in its read-only mode); or 'none', its edits outside flagged after the run.
 * @returns {'hooks' | 'asks' | 'none'}
 */
export function lockOf(id) {
  if (id === 'claude') return HOOKS ? 'hooks' : 'none';
  return id === 'hermes' || id === 'dsh' ? 'asks' : 'none';
}
/** Agents that report each edit they make (edit tools, or diffs when they ask), so their files can be told apart. */
export const reportsEdits = id => id === 'claude' || id === 'hermes' || id === 'dsh';
