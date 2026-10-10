// Wire types for the local bridge (bridge/loa.mjs). Keep in step with the bridge.

export type RunStatus = 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted';

/** One line of run activity: text, tool, err, warn (blocked by the scope lock), or deny (needs approval). */
export interface StreamEntry {
  t: 'text' | 'tool' | 'err' | 'warn' | 'deny';
  text: string;
  /** A write refused outside the section: the file, worded by the app (bridges from 0.2.0). */
  file?: string;
  /** What the entry says, worded by the app (bridges from 0.2.0): 'command-blocked'. */
  say?: string;
  /** A tool call: what it does, the repo file it names, the command it runs (bridges from 0.2.0). */
  act?: 'read' | 'edit' | 'run' | 'other';
  path?: string;
  cmd?: string;
}

/**
 * Result of one configured check. `ok` is null when the check was skipped or couldn't run on this machine
 * (`couldNotRun`, with the error's own line as the summary).
 */
export interface Check {
  name: string;
  ok: boolean | null;
  couldNotRun?: boolean;
  summary: string;
  ms?: number;
  tail?: string;
}

export interface AgentInfo {
  name: string;
  available: boolean;
  /** Why Claude Code can't run: not installed, or not logged in (bridges before 0.1.0 don't send it). */
  problem?: 'missing' | 'loggedOut' | null;
  /**
   * On a section, whether the system keeps it inside (macOS's sandbox) or its changes outside are flagged after it
   * (bridges before 0.2.0 don't send it).
   */
  stays?: boolean;
}

/**
 * A write a session was refused outside its section, asked of the person (bridges from 0.2.0): allowed, it joins the
 * section and the session carries on; refused, it stays out.
 */
export interface Want {
  path: string;
  answer?: 'allowed' | 'refused';
}

export interface HunkDTO {
  at: number;
  del: number;
  add: string[];
}

/** computeChanges() output. `pre` is the file at the before snapshot, `at` a 0-based index into it. */
export interface ChangeDTO {
  path: string;
  created: boolean;
  deleted: boolean;
  /**
   * The file as the run found it. Bridges from 0.2.0 leave it out of the state's runs (GET /api/runs/:id has it);
   * earlier ones send it always.
   */
  pre?: string[];
  hunks: HunkDTO[];
  /** For a created file, the file it was renamed from, as git finds renames (bridges from 0.2.0). */
  renamedFrom?: string;
}

/**
 * publicRun(): a stored run. In the state, bridges from 0.2.0 leave out its stream and each file as it found it
 * (GET /api/runs/:id has them); earlier ones send the stream's last 60 entries.
 */
export interface RunDTO {
  id: number;
  agent: string;
  title: string;
  prompt: string;
  scope: string[];
  resumeFrom: number | null;
  sessionId: string | null;
  /**
   * The added lines the agent wrote through its edit tools, per file: [from, to] line indexes in the file after the
   * run. Claude Code only; bridges before 0.2.0 don't send it.
   */
  agentLines?: Record<string, [number, number][]>;
  /** The model the agent reported (bridges before 0.2.0 don't send it). */
  model?: string | null;
  status: RunStatus;
  startedAt: number;
  endedAt: number | null;
  before: string | null;
  after: string | null;
  changes: ChangeDTO[];
  checks: Check[];
  summary: string;
  stream?: StreamEntry[];
  cost: number | null;
  kept: boolean;
  reverted: boolean;
  outOfScope?: string[];
  /**
   * Without a sandbox, files a shell command changed outside the section, put back at once; what it wrote is kept
   * under `ref`, to restore (POST /api/runs/:id/put-back).
   */
  putBack?: { path: string; ref: string; put: string | null; restored: boolean }[];
  /** Files it changed that the map doesn't show (binary files, the skip list's): reverted and committed with it. */
  unseen?: { path: string; created: boolean; deleted: boolean }[];
  committed?: { sha: string; at: number; files: string[] };
  limited?: boolean;
  slot?: number;
  checksRunning?: boolean;
  turn?: TurnSummary;
  wants?: Want[];
  /** Its agent stopped, waiting for the person to answer a want: how the agent's last turn ended. */
  waiting?: 'done' | 'failed' | null;
  /** On a section: whether the system kept it inside, as AgentInfo.stays said when it started. */
  stays?: boolean;
  /** A shell command of it tried to write outside its section, and the sandbox refused. */
  commandBlocked?: boolean;
}

/** Claude Code's verdict on its last turn (post_turn_summary): completed or blocked, and what it needs. */
export interface TurnSummary {
  status: string;
  detail: string;
  needs: string;
}

/** GET /api/authors: a line of a file at HEAD, and who wrote it as git records it (bridges from 0.2.0). */
export interface RecordedLine {
  text: string;
  author: 'agent' | 'human' | 'mixed' | 'unknown';
  /** A Git AI note on the commit, or a Co-authored-by trailer naming an agent. */
  source?: 'git-ai' | 'trailer';
  /** The agent and model, the person, or the co-author named. */
  by?: string;
  commit: string;
}

/** A file on the map: its length and first 400 lines. */
export interface TreeFile {
  path: string;
  total: number;
  lines: string[];
}

/**
 * GET /api/state(?root=folder/). `tree` lists the map's files with their first 400 lines, or, for a map of over 1,500
 * files, with none (POST /api/heads has them).
 */
export interface StateResponse {
  /** The folder the map is of, '' for the whole repository (bridges from 0.2.0). */
  root?: string;
  /** Code files in the whole repository, on the map or not (bridges from 0.2.0). */
  codeFiles?: number;
  /** Whether a map was ever asked for in this repository (bridges from 0.2.0). */
  rootChosen?: boolean;
  /** Code files in the folder mapped, and the most a map holds: the map is full when they're more (0.2.0 on). */
  mapFiles?: number;
  mapMax?: number;
  /** root: the repository's absolute path on this computer, for opening files in another editor. */
  repo: { name: string; branch: string; root: string };
  agents: Record<string, AgentInfo>;
  tree: TreeFile[];
  runs: RunDTO[];
  /** The first run under way (bridges before 0.2.0 run one at a time); `working` names them all. */
  active: number | null;
  working?: number[];
  seq: number;
  /** The bridge's version; bridges before 0.1.0 don't send it. */
  version?: string | null;
  /** Checks found in the repo, offered while none are set up (bridges before 0.1.0 don't send it). */
  suggestedChecks?: { name: string; run: string }[];
  /** 'repo' when the suggested checks are the repo's own loa.config.json, waiting for approval in this clone. */
  suggestedChecksFrom?: 'repo';
  /** The checks set up now, by name (bridges before 0.1.0 don't send it). */
  checksOn?: string[];
  /** Why watch mode is off, or null (bridges before 0.2.0 don't send it). */
  watchOff?: string | null;
}

/**
 * A tool call of a run's agent (bridges from 0.2.0): what it did, the file it named, when; `text` when the file as an
 * edit left it is kept (GET /api/runs/:id/steps/:i).
 */
export interface StepDTO {
  i: number;
  at: number;
  act: 'read' | 'edit' | 'run' | 'other';
  tool: string;
  file?: string;
  text?: boolean;
  refused?: boolean;
}

/** Progress payload carried by `progress` events (bridge emit()). */
export interface RunProgress {
  id: number;
  status: RunStatus;
  stream: StreamEntry[];
  summary: string;
  sessionId: string | null;
  checks: Check[];
  checksRunning: boolean;
  cost: number | null;
  turn?: TurnSummary;
  /** Bridges from 0.2.0: the model, and the steps added or changed since its last progress event. */
  model?: string | null;
  steps?: StepDTO[];
}

export interface BridgeEvent {
  seq: number;
  type: 'state' | 'progress';
  run?: RunProgress;
  /** On a state event for a run, to apps that ask (`delta=1`; bridges before 0.2.0 never send it). */
  delta?: StateDelta;
}

/** A run that finished or changed, and its files as the map shows them now (null: no longer on the map). */
export interface StateDelta {
  run: RunDTO;
  files: Record<string, TreeFile | null>;
  active: number | null;
  working?: number[];
}

/** GET /api/events?since=N */
export interface EventsResponse {
  seq: number;
  events: BridgeEvent[];
}

/** POST /api/runs body. */
export interface StartRunBody {
  agent: string;
  prompt: string;
  scope: string[];
  resumeFrom: number | null;
  /** For each file scoped to lines, the text of those lines: the bridge finds them by it (bridges before 0.1.2 ignore it). */
  lines?: Record<string, string>;
  /**
   * For the same files, the lines around them that tell them apart from identical copies, and whether a copy
   * existed (web/src/lib/anchor.ts). Without it, the bridge takes lines only where their numbers say.
   */
  context?: Record<string, { before: string[]; after: string[]; twin: boolean }>;
}

/** POST /api/runs/:id/revert. 409 carries `conflict`. */
export type RevertResponse = { ok: true } | { conflict: string[] };

export interface OkResponse {
  ok: true;
}
export interface ErrorBody {
  error?: string;
  /** Which error, for the app to word it (bridge 0.2.0 and later); `args` fills its sentence. */
  code?: string;
  args?: Record<string, string | number>;
  conflict?: string[];
  /** POST /api/save, 409: the file as it is on disk now. */
  text?: string;
  hash?: string;
}
/** GET /api/file: a file's full text, and the hash a save names as its base. */
export interface FileResponse {
  path: string;
  text: string;
  hash: string;
}
export interface SaveBody {
  path: string;
  text: string;
  base: string;
}
/** POST /api/save: the run the save became, or nothing when the text is unchanged. */
export type SaveResponse = RunDTO | { unchanged: true };

/** A bridge connection: base URL and token. */
export interface Conn {
  base: string;
  token: string;
}

/** What committing a run would hold (GET /api/runs/:id/commit). */
export interface CommitPreview {
  /** The run's own files. */
  files: string[];
  /** Files it changed that the person had changed too before it started: left out unless ticked. */
  yours: string[];
  /** Files changed since the run ended: nothing commits until they are reviewed again. */
  changed: string[];
  /** The branch HEAD is on, or null when detached. */
  branch: string | null;
}
