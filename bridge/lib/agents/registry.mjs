// The agents a run can use, which are on this machine, and the connector that starts each.
import os from 'node:os';
import path from 'node:path';
import { readJson, onPath } from '../util.mjs';
import { HOOKS } from '../serve.mjs';
import { acpConnector } from './acp.mjs';
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
 * @typedef {'done' | 'failed' | 'cancelled'} Outcome
 * @typedef {{ cancel(): void; done: Promise<Outcome> }} Session  An agent at work on one run.
 * @typedef {{ start(run: any, prompt: string, scopeFile: string): Session }} Connector
 */
/** @type {Record<string, Connector>} */
const STREAMED = {
  claude: streamConnector(
    () => BIN.claude,
    (prompt, sessionId) => [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'acceptEdits',
      ...(sessionId ? ['--resume', sessionId] : []),
    ],
  ),
  cursor: streamConnector(
    () => BIN.cursor,
    (prompt, sessionId) => [
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
    (prompt, sessionId) => [
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
