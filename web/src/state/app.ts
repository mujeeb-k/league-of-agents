// The app's mutable state, as plain module-level objects. React components read it
// while rendering; actions change it and then call the render functions in
// state/render.ts (renderScene(), renderSide() and so on).
import type { Conn, RecordedLine } from '../api/types';
import type { Owner } from '../lib/attribution';
import type { SavedLayout } from '../lib/layout';
import type { AgentMap, Box, Conflict, DirNode, FileNode, Mode, Run, Tab, View } from '../lib/types';

export interface Graph {
  out: Map<string, string[]>;
  in: Map<string, string[]>;
}

export const S = {
  LIVE: false,
  CONN: null as Conn | null,
  LIVE_AGENTS: null as AgentMap | null,
  EVSEQ: 0,
  /** The runs at work on the bridge, by id: several at once on sections apart (state/sessions.ts). */
  WORKING: [] as number[],
  REVIEWED: new Map<number, Set<string>>(),
  ROOT: null as DirNode | null,
  FILES: new Map<string, FileNode>(),
  DIRMAP: new Map<string, DirNode>(),
  RUNS: [] as Run[],
  WB: { x: 0, y: 0, w: 1, h: 1 } as Box,
  /** The layout in use, kept between changes and, live, saved per repo (api/live.ts saveLayoutSoon). */
  LAYOUT: null as SavedLayout | null,
  /** Bumped whenever the layout changes, so routed lines are found again. */
  LAYOUT_REV: 0,
  GRAPH: { out: new Map(), in: new Map() } as Graph,
  /** Who wrote each line of each file, while the map is coloured by author (lib/attribution.ts). */
  AUTHORS: new Map<string, Owner[]>(),
  /** What git records about who wrote each line at HEAD, for files looked at while coloured by author. */
  RECORDED: new Map<string, RecordedLine[]>(),
  /** Each file's full length when live; the bridge sends only the first 400 lines of each. */
  TOTALS: new Map<string, number>(),
  /** The connected bridge's version, or null when it is too old to say. */
  bridgeVersion: null as string | null,
  /** Checks the bridge found in a repo with none set up, to offer turning on. */
  suggestedChecks: [] as { name: string; run: string }[],
  /** True when the suggested checks come from the repo's loa.config.json: approved here before they run. */
  checksFromRepo: false,
  /** The checks set up now, by name: a check that couldn't run can be turned off while it is one. */
  checksOn: [] as string[],
  /** Why the bridge's watch mode is off, if it is. */
  watchOff: null as string | null,
  /** Shown in the top bar crumb. */
  repoName: '',
  /** The repository's absolute path when live; empty in the demo. */
  repoRoot: '',
  branch: '',
};

export const st = {
  run: null as Run | null,
  /** The map coloured by who wrote each line (lib/attribution.ts), on the latest state. */
  byAuthor: false,
  /** Attribution about to be written to a git note, while the export dialog asks (ExportDialog). */
  exportFormat: null as 'agent-trace' | 'git-ai' | null,
  /** The line whose authorship the inspector shows, clicked while coloured by author. */
  authorLine: null as { path: string; line: number } | null,
  mode: 'after' as Mode,
  sel: new Set<string>(),
  agent: 'claude',
  v: { x: 0, y: 0, s: 0.2 } as View,
  hover: null as string | null,
  tab: 'files' as Tab,
  cur: null as string | null,
  near: undefined as boolean | undefined,
  /** A file is open in the editor; in auto mode the sidebar steps aside for it (panels.ts). */
  editing: false,
  noFollow: null as number | null,
  connectOpen: false,
  /** Opening with a bridge link or a saved connection: nothing is shown until the bridge answers. */
  starting: false,
  /** The bridge a link or saved connection pointed at did not answer; the canvas says so (StageState). */
  unreachable: null as { conn: Conn; why: string } | null,
  /** A bridge to connect to once the person has read why the browser is about to ask (localAccess). */
  asking: null as Conn | null,
  /** Work in progress with the bridge: 'connect', 'send', or an action and run id such as 'keep:3'. */
  busy: null as string | null,
  /** A revert that would undo later edits, shown as a dialog (ConflictDialog.tsx). */
  conflict: null as Conflict | null,
  /** Quick open (⌘P) or the command menu (⌘K), when one is open. */
  palette: null as 'files' | 'commands' | null,
  /** Expanded folders in the explorer, and the repo they belong to. */
  open: new Set<string>(),
  openRepo: null as string | null,
  /** The explorer row that holds keyboard focus: a file path, or 'd:' + a folder path. */
  treeFocus: 'd:',
  /** The update banner was closed for this connection. */
  updateDismissed: false,
  /** The demo's introduction card (under 860 px) was closed. */
  introClosed: false,
  /** Runs whose agent reply was opened in full with "Show all". */
  openReplies: new Set<number>(),
};

/** Persistent elements the controller touches directly, outside React. */
export const dom = {} as {
  app: HTMLElement;
  side: HTMLElement;
  insp: HTMLElement;
  stage: HTMLElement;
  world: HTMLElement;
  wires: SVGSVGElement;
  links: SVGSVGElement;
  mini: HTMLCanvasElement;
  marquee: HTMLElement;
  tip: HTMLElement;
  /** The full name of the hovered file tile, whose own name may be shortened (Stage.tsx). */
  tileName: HTMLElement;
  zPct: HTMLElement;
  prompt: HTMLTextAreaElement;
  sendBtn: HTMLButtonElement;
  connectBtn: HTMLButtonElement;
};
