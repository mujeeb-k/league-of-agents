import type { AgentInfo, Check, RunStatus, StreamEntry, TurnSummary } from '../api/types';

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
  title: string;
  when: string;
  dur: string;
  prompt: string;
  summary: string;
  scope: string[];
  ch: Record<string, 'CREATE' | [number, number, string[]][]>;
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
  /** Files and folders (ending in /) the run was limited to. Empty means the whole repository. */
  scope?: string[];
  /** Claude Code's verdict on its last turn: blocked, or what it needs from you. */
  turn?: TurnSummary;
  startedAt?: number;
  endedAt?: number | null;
  _flewTo?: boolean;
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
}
