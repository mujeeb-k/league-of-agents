import type { AgentInfo, Check, RunStatus, StreamEntry, TurnSummary, Want } from '../api/types';

export type Mode = 'before' | 'after' | 'diff';
export type Tab = 'files' | 'runs';
export type ChangeKind = 'add' | 'mod';
export type RowKind = '' | 'add' | 'del';

/** Folder spec used to build the model: name, note and children, as built by D(n, note, c). */
export interface TreeSpec {
  n: string;
  note: string;
  c: (string | TreeSpec)[];
}

export interface Hunk {
  at: number;
  del: number;
  add: string[];
}

/** Demo run definition. Hunks are [at, del, add]. */
export interface SampleRunDef {
  id: number;
  agent: string;
  /** The model the agent reported, as a live run shows it. */
  model?: string;
  /** Every line it added came through its edit tools, as a live Claude Code run reports them (agentLines). */
  toolWritten?: true;
  title: string;
  when: string;
  dur: string;
  prompt: string;
  summary: string;
  scope: string[];
  ch: Record<string, 'CREATE' | [number, number, string[]][]>;
  /**
   * A session still at work as the demo opens: its steps appear one by one, and it finishes `after` ms in, with its
   * changes, reply and duration (`dur`). Its changes edit files; none creates one.
   */
  working?: { after: number; steps: string[] };
}

export interface DirNode {
  type: 'dir';
  name: string;
  note: string;
  path: string;
  parent: DirNode | null;
  depth: number;
  dirs: DirNode[];
  files: FileNode[];
  cols: number;
  rows: number;
  w: number;
  h: number;
  x: number;
  y: number;
}

export interface FileNode {
  type: 'file';
  name: string;
  path: string;
  dir: DirNode;
  base: string[];
  createdBy: number | null;
  gone: boolean;
  x: number;
  y: number;
}

/**
 * A change to one file in a run. Demo changes carry either `lines` (created) or `hunks`.
 * Live changes also carry `pre`, the file at the run's before snapshot.
 */
export interface Change {
  created: boolean;
  deleted: boolean;
  pre: string[] | null;
  hunks: Hunk[];
  lines: string[];
  /** For a renamed file, its old path: the run deleted that file and created this one (lib/renames.ts). */
  renamedFrom?: string;
}

export interface Run {
  id: number;
  agent: string;
  title: string;
  when: string;
  dur: string;
  prompt: string;
  summary: string;
  status: RunStatus;
  changes: Map<string, Change>;
  /** The lines its session wrote: [from, to] indexes in each file after the run (RunDTO.agentLines). */
  agentLines?: Record<string, [number, number][]>;
  /** Of those, the lines its edit tools didn't write: by a command. */
  commandLines?: Record<string, [number, number][]>;
  /** Lines of its files another session wrote while it worked: [from, to, that run, 1 where by a command]. */
  otherLines?: Record<string, ([number, number, number] | [number, number, number, number])[]>;
  /** Lines of its files written while two writers wrote the file at once: [from, to, their runs, 0 for the person]. */
  sharedLines?: Record<string, [number, number, number[]][]>;
  reviewed: Set<string>;
  kept?: boolean;
  reverted?: boolean;
  stream?: StreamEntry[];
  checks?: Check[];
  checksRunning?: boolean;
  cost?: number | null;
  sessionId?: string | null;
  /** The model the agent reported, if it did. */
  model?: string | null;
  outOfScope?: string[];
  /** Files another session's edits named too, with those sessions: left out of its revert and commit unless chosen. */
  shared?: { path: string; with: number[] }[];
  /** Files it changed that the map doesn't show (binary, or skipped): still its own, in its revert and commit. */
  unseen?: { path: string }[];
  /** Reverted, but for these: shared files the person left as they are. */
  left?: string[];
  /** Without a sandbox, files a shell command changed outside the section and the bridge put back (bridge/lib/shell.mjs). */
  putBack?: { path: string; restored: boolean }[];
  /** Its colour on the map while it works (theme.css --session-1 to 5), given as it starts. */
  slot?: number;
  /** Failed because the agent's provider stopped it at its rate or usage limit. */
  limited?: boolean;
  /** The commit the person made of the run's files, from the app (bridge/lib/commit.mjs). */
  committed?: { sha: string; at: number; files: string[]; hook?: string[] };
  /** Files and folders (ending in /) the run was limited to. Empty means the whole repository. */
  scope?: string[];
  /** Claude Code's verdict on its last turn: blocked, or what it needs from you. */
  turn?: TurnSummary;
  /** Writes refused outside its section, asked of the person. */
  wants?: Want[];
  /** Its agent stopped, waiting for the person to answer a want. */
  waiting?: 'done' | 'failed' | null;
  /** On a section: whether the system kept it inside. */
  stays?: boolean;
  /** On a section: its edits outside asked first. */
  asks?: boolean;
  /** A shell command of it tried to write outside its section, and the sandbox refused. */
  commandBlocked?: boolean;
  /** Started with the lock off, by the person's choice. */
  lock?: boolean;
  /** The lock refused something no answer could allow. */
  lockRefused?: boolean;
  blockedPaths?: string[];
  startedAt?: number;
  endedAt?: number | null;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface View {
  x: number;
  y: number;
  s: number;
}

export interface Row {
  t: string;
  k: RowKind;
  /** Changed word ranges within an added or removed line. */
  wd?: [number, number][];
  n?: number;
  na?: number;
  nb?: number;
}
export interface FileView {
  exists: boolean;
  ghost?: boolean;
  kind: ChangeKind | '';
  a?: number;
  d?: number;
  rows: Row[];
  lines: string[];
}
export interface Stat {
  a: number;
  d: number;
  kind: ChangeKind;
}

export type AgentMap = Record<string, AgentInfo>;

/** A revert that would undo later edits: the files involved, and in the demo the later run that made them. */
export interface Conflict {
  run: Run;
  files: string[];
  later?: Run;
  /** The files another session edited too that the person chose to revert with the run. */
  shared?: string[];
}
