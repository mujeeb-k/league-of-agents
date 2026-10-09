// Live connection to the local bridge.
import { applyView, flyRun, openingView } from '../lib/camera';
import { buildModel, specFromPaths } from '../lib/model';
import { authorsOf, rangesOf } from '../lib/attribution';
import { carryRenames, type SavedLayout } from '../lib/layout';
import { renamesOf } from '../lib/renames';
import { bridgeNames } from '../lib/constants';
import { changedBlock } from '../lib/textdiff';
import type { Run } from '../lib/types';
import { t, tn } from '../i18n';
import { fmtDur, relTime } from '../lib/util';
import { S, st } from '../state/app';
import { opensOnFinish } from '../state/sessions';
import { loadDemo } from '../state/actions';
import { refreshEditor } from '../state/editing';
import { renderAll, renderCrumb, renderInspector, renderSide, setConnUI } from '../state/render';
import { toast } from '../ui/toast';
import { BridgeError, bridge } from './client';
import { explain } from './errors';
import { showConflict } from '../components/ConflictDialog';
import { clearConn, saveConn } from './conn';
import type { Conn, RunDTO, StateDelta, StateResponse } from './types';

export const live = { pendingSelect: null as number | null };
let refreshTimer = 0,
  polling = false;
const justFinished = new Set<number>();

/** The active connection. Throws when there is none. */
function conn(): Conn {
  if (!S.CONN) throw new Error('Not connected');
  return S.CONN;
}

function liveRun(r: RunDTO): Run {
  const changes: Run['changes'] = new Map();
  const renames = renamesOf(r.changes || []),
    renamed = new Set(renames.values());
  for (const c of r.changes || []) {
    if (renamed.has(c.path)) continue;
    const from = renames.get(c.path);
    // A renamed file is one change: from its old text to its new one, under its new name.
    const pre = from ? r.changes.find(x => x.path === from)!.pre : null;
    const block =
      pre &&
      changedBlock(
        pre,
        c.hunks.flatMap(h => h.add),
      );
    changes.set(
      c.path,
      pre
        ? { created: false, deleted: false, pre, hunks: block ? [block] : [], lines: [], renamedFrom: from }
        : {
            created: c.created,
            deleted: c.deleted,
            pre: c.pre,
            hunks: c.hunks,
            lines: c.created ? c.hunks.flatMap(h => h.add) : [],
          },
    );
  }
  if (!S.REVIEWED.has(r.id)) S.REVIEWED.set(r.id, new Set());
  return {
    ...r,
    when: relTime(r.startedAt),
    dur: fmtDur(r.startedAt, r.endedAt),
    changes,
    reviewed: S.REVIEWED.get(r.id)!,
  };
}

// The layout is kept per repo: by the bridge in .loa/layout.json, or in this browser when the bridge is older
// than 0.2.0 and has no layout route.
const layoutKey = (root: string) => 'loa.layout:' + root;
const isLayout = (v: unknown): v is SavedLayout =>
  !!v && typeof v === 'object' && (v as { v?: unknown }).v === 1 && 'dirs' in v && 'files' in v;
let layoutInBrowser = false,
  savedLayout = '',
  layoutTimer = 0;

async function loadLayout(c: Conn, root: string): Promise<SavedLayout | null> {
  layoutInBrowser = false;
  try {
    const { layout } = await bridge.layout(c);
    savedLayout = JSON.stringify(layout);
    return isLayout(layout) ? layout : null;
  } catch (e) {
    if (!(e instanceof BridgeError && e.status === 404)) return null;
    layoutInBrowser = true;
    try {
      const v: unknown = JSON.parse(localStorage.getItem(layoutKey(root)) ?? 'null');
      savedLayout = JSON.stringify(v);
      return isLayout(v) ? v : null;
    } catch {
      return null;
    }
  }
}

/** Saves the layout once it has stayed the same for a second, and only when it changed. */
export function saveLayoutSoon() {
  clearTimeout(layoutTimer);
  layoutTimer = window.setTimeout(() => {
    const c = S.CONN,
      layout = S.LAYOUT;
    if (!c || !layout || JSON.stringify(layout) === savedLayout) return;
    savedLayout = JSON.stringify(layout);
    if (layoutInBrowser) {
      try {
        localStorage.setItem(layoutKey(S.repoRoot), savedLayout);
      } catch {
        // Storage full or blocked: the layout still holds until the page closes.
      }
    } else void bridge.saveLayout(c, layout).catch(() => (savedLayout = ''));
  }, 1000);
}

/** Writes who wrote each line to a git note on the last commit, once the person has said yes (ExportDialog). */
export async function exportAttribution(format: 'agent-trace' | 'git-ai') {
  const c = S.CONN;
  if (!c) return;
  const now = new Map([...S.FILES.values()].filter(f => !f.gone).map(f => [f.path, f.base]));
  const files = Object.fromEntries([...authorsOf(S.RUNS, now, S.RECORDED)].map(([p, o]) => [p, rangesOf(o)]));
  try {
    const r = await bridge.exportAttribution(c, format, files);
    toast(
      tn(
        r.files,
        'Wrote attribution for {n} file to {ref} on {commit}',
        'Wrote attribution for {n} files to {ref} on {commit}',
        {
          ref: r.ref,
          commit: r.commit.slice(0, 8),
        },
      ),
    );
  } catch (e) {
    toast(explain(e));
  }
}

/** The last state applied, which run deltas are applied to. */
let last: StateResponse | null = null;

/** The state with run deltas applied: each run and its files replaced, in the bridge's order. */
function withDeltas(s: StateResponse, deltas: StateDelta[], seq: number): StateResponse {
  for (const d of deltas) {
    const tree = s.tree.filter(f => !(f.path in d.files));
    for (const f of Object.values(d.files)) if (f) tree.push(f);
    tree.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const runs = s.runs.filter(r => r.id !== d.run.id).concat(d.run);
    runs.sort((a, b) => a.id - b.id);
    s = { ...s, tree, runs, active: d.active, working: d.working, seq };
  }
  return s;
}

/** The runs at work. A bridge before 0.2.0 runs one at a time and names only that one. */
const workingOf = (s: StateResponse) => s.working ?? (s.active ? [s.active] : []);

/**
 * A run started elsewhere is opened, and flown to when it finishes; a save from the editor is not, so the person
 * keeps their place. Nor is a session that ends while the person reviews another that worked beside it.
 */
function followSessions(before: number[], now: number[], s: StateResponse) {
  const follow = (id: number) => s.runs.find(r => r.id === id)?.agent !== 'you';
  const ended = s.runs.find(r => before.includes(r.id) && !now.includes(r.id) && follow(r.id));
  const started = before.length ? undefined : now.find(follow);
  if (ended && opensOnFinish(ended)) {
    justFinished.add(ended.id);
    live.pendingSelect = ended.id;
  } else if (started !== undefined) live.pendingSelect = started;
}

function applyState(s: StateResponse, first: boolean) {
  last = s;
  S.LIVE_AGENTS = s.agents;
  for (const [k, a] of Object.entries(s.agents)) bridgeNames.set(k, a.name);
  S.suggestedChecks = s.suggestedChecks ?? [];
  S.checksFromRepo = s.suggestedChecksFrom === 'repo';
  S.checksOn = s.checksOn ?? [];
  S.watchOff = s.watchOff ?? null;
  // HEAD may have moved: what git records is read again when a file is looked at.
  S.RECORDED.clear();
  const avail = Object.keys(s.agents).filter(k => s.agents[k]!.available);
  if (!avail.includes(st.agent) && avail[0]) st.agent = avail[0];
  const code: Record<string, string> = {},
    present = new Set<string>(),
    paths: string[] = [];
  S.TOTALS = new Map(s.tree.map(f => [f.path, f.total]));
  for (const f of s.tree) {
    paths.push(f.path);
    code[f.path] = f.lines.join('\n');
    present.add(f.path);
  }
  // A file a run removed stays on the map, marked gone, while a run lists it; a renamed one is under its new name.
  const runs = s.runs.map(liveRun);
  const gone = new Set<string>(),
    renames = new Map<string, string>();
  for (const r of runs)
    for (const [p, c] of r.changes) {
      if (c.renamedFrom) renames.set(p, c.renamedFrom);
      if (!present.has(p) && !gone.has(p)) {
        paths.push(p);
        gone.add(p);
      }
    }
  const keepRun = st.run && st.run.id,
    keepSel = [...st.sel];
  S.LAYOUT = carryRenames(S.LAYOUT, renames, present);
  buildModel(specFromPaths(s.repo.name, paths), code, []);
  for (const p of gone) {
    const f = S.FILES.get(p);
    if (f) f.gone = true;
  }
  S.RUNS = runs;
  S.WORKING = workingOf(s);
  st.run = S.RUNS.find(r => r.id === (live.pendingSelect || keepRun)) || null;
  if (live.pendingSelect && st.run) live.pendingSelect = null;
  st.sel = new Set(keepSel.filter(k => (k.startsWith('d:') ? S.DIRMAP.has(k.slice(2)) : S.FILES.has(k))));
  S.repoName = s.repo.name;
  S.repoRoot = s.repo.root;
  S.branch = s.repo.branch || '';
  renderCrumb();
  renderAll();
  saveLayoutSoon();
  void refreshEditor();
  if (first) {
    st.v = openingView();
    applyView(true);
  } else if (
    st.run &&
    st.run.status !== 'running' &&
    st.run._flewTo !== true &&
    st.run.changes.size &&
    justFinished.has(st.run.id)
  ) {
    st.run._flewTo = true;
    justFinished.delete(st.run.id);
    st.mode = 'diff';
    renderAll();
    flyRun(st.run);
  }
}

async function refresh() {
  try {
    applyState(await bridge.state(conn()), false);
  } catch (e) {
    onDisconnect(e);
  }
}
const queueRefresh = () => {
  clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refresh, 120);
};

async function poll() {
  if (polling) return;
  polling = true;
  while (S.LIVE) {
    try {
      const r = await bridge.events(conn(), S.EVSEQ);
      S.EVSEQ = r.seq;
      let needState = false;
      const deltas: StateDelta[] = [];
      for (const e of r.events) {
        if (e.type === 'state' && e.delta) deltas.push(e.delta);
        else if (e.type === 'state') needState = true;
        else if (e.type === 'progress' && e.run) {
          const p = e.run,
            run = S.RUNS.find(x => x.id === p.id);
          if (run) {
            const wasRunning = run.status === 'running';
            Object.assign(run, {
              status: p.status,
              stream: p.stream,
              summary: p.summary,
              sessionId: p.sessionId,
              checks: p.checks,
              checksRunning: p.checksRunning,
              cost: p.cost,
              turn: p.turn,
            });
            // A run that just ended needs the whole state, unless its delta came with it.
            if (wasRunning && run.status !== 'running' && !deltas.some(d => d.run.id === run.id)) needState = true;
            if (st.run === run) renderInspector();
          } else needState = true;
        }
      }
      // Runs alone changed: their deltas update the state already here. Anything else fetches it whole.
      if (deltas.length && !last) needState = true;
      if (needState || deltas.length) {
        const s = needState ? await bridge.state(conn()) : withDeltas(last!, deltas, r.seq);
        followSessions(S.WORKING, workingOf(s), s);
        applyState(s, false);
        S.EVSEQ = Math.max(S.EVSEQ, s.seq || 0);
      } else renderSide();
    } catch (e) {
      onDisconnect(e);
      break;
    }
  }
  polling = false;
}

/**
 * Connects to a bridge and loads its state. Returns null when connected, or what went wrong in plain words;
 * unless quiet, the problem is also shown as a toast.
 */
export async function connect(c: Conn, quiet = false): Promise<string | null> {
  st.busy = 'connect';
  setConnUI();
  try {
    const s = await bridge.state(c);
    // S.CONN marks the data as live; it is set only once the bridge has answered, and kept when a
    // reconnect fails, so a lost bridge reads as offline rather than as the demo.
    S.CONN = c;
    S.LIVE = true;
    S.EVSEQ = s.seq || 0;
    S.bridgeVersion = s.version ?? null;
    st.updateDismissed = false;
    st.unreachable = null;
    saveConn(c);
    st.run = null;
    st.sel.clear();
    st.mode = 'after';
    st.tab = 'runs';
    // A repository is laid out as it was last time, or afresh; later state events keep this layout.
    S.LAYOUT = await loadLayout(c, s.repo.root);
    applyState(s, true);
    toast(t('Connected to {repo}', { repo: s.repo.name }));
    void poll();
    return null;
  } catch (e) {
    const why = explain(e);
    if (!quiet) toast(why);
    return why;
  } finally {
    st.busy = null;
    setConnUI();
  }
}

// Retries once after 3 seconds, so a brief drop reconnects on its own.
function onDisconnect(_e: unknown) {
  if (!S.LIVE) return;
  S.LIVE = false;
  setConnUI();
  renderInspector();
  toast(t('Lost the bridge connection. Showing the last state.'));
  setTimeout(async () => {
    if (!S.LIVE && S.CONN) {
      const c = S.CONN;
      if ((await connect(c, true)) === null) toast(t('Reconnected'));
    }
  }, 3000);
}

export function disconnect() {
  S.LIVE = false;
  S.CONN = null;
  clearConn();
  setConnUI();
  loadDemo();
  toast(t('Disconnected'));
}

/** Revert even though the files changed again since the run; their later edits are lost. */
export async function forceRevert(run: Run) {
  if (st.busy) return;
  st.busy = `revert:${run.id}`;
  renderInspector();
  try {
    await bridge.revert(conn(), run.id, true);
    toast(t('Reverted run {id}', { id: run.id }));
    queueRefresh();
  } catch (e) {
    toast(explain(e));
  } finally {
    st.busy = null;
    renderInspector();
  }
}

/** Turns on the checks the bridge found; they run after each run from then on, never before. */
export async function enableChecks(share: boolean) {
  if (st.busy || !S.CONN) return;
  st.busy = 'checks';
  renderInspector();
  try {
    const r = await bridge.enableChecks(
      S.CONN,
      S.suggestedChecks.map(c => c.name),
      share,
    );
    S.suggestedChecks = [];
    toast(t('Checks on: {names}', { names: r.checks.map(c => c.name).join(', ') }));
  } catch (e) {
    toast(explain(e));
  } finally {
    st.busy = null;
    renderInspector();
  }
}

/** Turns off a check that couldn't run here; it stays in the runs it already ran in. */
export async function turnOffCheck(name: string) {
  if (st.busy || !S.CONN) return;
  st.busy = `checkoff:${name}`;
  renderInspector();
  try {
    await bridge.turnOffCheck(S.CONN, name);
    S.checksOn = S.checksOn.filter(n => n !== name);
    toast(t('Turned off {name}', { name }));
  } catch (e) {
    toast(explain(e));
  } finally {
    st.busy = null;
    renderInspector();
  }
}

export async function liveAction(act: string, run: Run) {
  if (st.busy) return;
  st.busy = `${act}:${run.id}`;
  renderInspector();
  try {
    const c = conn();
    if (act === 'cancel') await bridge.cancel(c, run.id);
    else if (act === 'keep') {
      await bridge.keep(c, run.id);
      toast(t('Kept run {id}', { id: run.id }));
    } else if (act === 'revert') {
      const r = await bridge.revert(c, run.id, false);
      // Files changed again since the run: ask in the conflict dialog, which may call forceRevert.
      if ('conflict' in r) showConflict({ run, files: r.conflict });
      else toast(t('Reverted run {id}', { id: run.id }));
    }
    queueRefresh();
  } catch (e) {
    toast(explain(e));
  } finally {
    st.busy = null;
    renderInspector();
  }
}

/** Restores a file the bridge put back after the run's shell command changed it outside the section. */
export async function restorePutBack(run: Run, path: string) {
  if (st.busy) return;
  st.busy = `restore:${run.id}`;
  renderInspector();
  try {
    await bridge.restorePutBack(conn(), run.id, path);
    const kept = run.putBack?.find(k => k.path === path);
    if (kept) kept.restored = true;
    toast(t('Restored {name}', { name: path }));
    queueRefresh();
  } catch (e) {
    toast(explain(e));
  } finally {
    st.busy = null;
    renderInspector();
  }
}

/** Minute tick for relative run times. */
export function tickTimes() {
  if (S.LIVE) {
    S.RUNS.forEach(r => {
      r.when = relTime(r.startedAt);
    });
    renderSide();
  }
}
