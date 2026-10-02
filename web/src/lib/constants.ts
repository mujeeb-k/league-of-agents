// Card size and layout spacing on the map; MAXL is the most lines a card's code shows.
export const CW = 420,
  CH = 300,
  GAP = 28,
  PAD = 28,
  SIB = 180,
  COLGAP = 180,
  MAXL = 16;
/**
 * Zoom levels: code cards from NEAR up; below it, file tiles with their names (structure); below
 * OVER, tiles without names and folders with file counts (overview).
 */
export const NEAR = 0.34,
  OVER = 0.12,
  /** Below this, tile names drop their icon and shrink a size, so a short name still shows in full. */
  TIGHT = 0.2;
/** The oldest bridge this app works with; an older one gets the update banner. */
export const MIN_BRIDGE = '0.1.0';
/** Whether a bridge version is older than `min`; a bridge that sends none is older than every version. */
export function olderThan(version: string | null, min: string) {
  if (!version) return true;
  const a = version.split('.').map(Number),
    b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
}
/** Characters per line in a code card: (card 420 - gutter 38 - padding 12) / 6.6px per IBM Plex Mono character at 11px. */
export const CODE_COLS = 56;

export interface AgentStyle {
  name: string;
  c: string;
  /** Not yet verified with a real run: labelled "Beta" wherever the agent is named. */
  beta?: true;
}
export const AGENTS: Record<string, AgentStyle> = {
  claude: { name: 'Claude Code', c: 'var(--a-claude)' },
  hermes: { name: 'Hermes', c: 'var(--a-hermes)' },
  codex: { name: 'Codex', c: 'var(--a-codex)', beta: true },
  cursor: { name: 'Cursor', c: 'var(--a-cursor)', beta: true },
  detected: { name: 'Watch mode', c: 'var(--a-detected)' },
  you: { name: 'You', c: 'var(--ink2)' },
  'claude-terminal': { name: 'Claude Code (terminal)', c: 'var(--a-claude)' },
  'codex-terminal': { name: 'Codex (terminal)', c: 'var(--a-codex)', beta: true },
  'cursor-editor': { name: 'Cursor (editor)', c: 'var(--a-cursor)', beta: true },
};
export const agentOf = (k: string): AgentStyle => AGENTS[k] || { name: k, c: 'var(--ink3)' };
