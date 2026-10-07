// Live connection to the local bridge.
import { applyView, flyRun, openingView } from '../lib/camera';
import { buildModel, specFromPaths } from '../lib/model';
import type { Run } from '../lib/types';
import { fmtDur, relTime } from '../lib/util';
import { S, st } from '../state/app';
import { loadDemo } from '../state/actions';
import { refreshEditor } from '../state/editing';
import { renderAll, renderCrumb, renderInspector, renderSide, setConnUI } from '../state/render';
import { toast } from '../ui/toast';
import { bridge } from './client';
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
  for (const c of r.changes || [])
    changes.set(c.path, {
      created: c.created,
      deleted: c.deleted,
      pre: c.pre,
      hunks: c.hunks,
      lines: c.created ? c.hunks.flatMap(h => h.add) : [],
    });
  if (!S.REVIEWED.has(r.id)) S.REVIEWED.set(r.id, new Set());
  return {
    ...r,
    when: relTime(r.startedAt),
    dur: fmtDur(r.startedAt, r.endedAt),
    changes,
    reviewed: S.REVIEWED.get(r.id)!,
  };
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
    s = { ...s, tree, runs, active: d.active, seq };
  }
  return s;
}

function applyState(s: StateResponse, first: boolean) {
  last = s;
  S.LIVE_AGENTS = s.agents;
  S.suggestedChecks = s.suggestedChecks ?? [];
  S.checksFromRepo = s.suggestedChecksFrom === 'repo';
  S.checksOn = s.checksOn ?? [];
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
  const gone = new Set<string>();
  for (const r of s.runs)
    for (const c of r.changes || [])
      if (!present.has(c.path)) {
        paths.push(c.path);
        gone.add(c.path);
      }
  const keepRun = st.run && st.run.id,
    keepSel = [...st.sel];
  buildModel(specFromPaths(s.repo.name, paths), code, []);
  for (const p of gone) {
    const f = S.FILES.get(p);
    if (f) f.gone = true;
  }
  S.RUNS = s.runs.map(liveRun);
  S.ACTIVE = S.RUNS.find(r => r.id === s.active) || null;
  st.run = S.RUNS.find(r => r.id === (live.pendingSelect || keepRun)) || null;
  if (live.pendingSelect && st.run) live.pendingSelect = null;
  st.sel = new Set(keepSel.filter(k => (k.startsWith('d:') ? S.DIRMAP.has(k.slice(2)) : S.FILES.has(k))));
  S.repoName = s.repo.name;
  S.repoRoot = s.repo.root;
  S.branch = s.repo.branch || '';
  renderCrumb();
  renderAll();
  void refreshEditor();
  if (first) {
    st.v = openingView();
    applyView(true);
  } else if (
    st.run &&
    st.run.status !== 'running' &&
    st.run._flewTo !== true &&
    st.run.changes.size &&
    st.run === S.RUNS[S.RUNS.length - 1] &&
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
        const prevActive = S.ACTIVE && S.ACTIVE.id;
        const s = needState ? await bridge.state(conn()) : withDeltas(last!, deltas, r.seq);
        // A run started elsewhere is opened, and flown to when it finishes; a save from the editor is not,
        // so the person keeps their place.
        const follow = (id: number) => s.runs.find(r => r.id === id)?.agent !== 'you';
        if (prevActive && s.active !== prevActive && follow(prevActive)) {
          justFinished.add(prevActive);
          live.pendingSelect = prevActive;
        }
        if (!prevActive && s.active && follow(s.active)) live.pendingSelect = s.active;
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
    S.LAYOUT = null; // a new repository is laid out afresh; later state events keep this layout
    applyState(s, true);
    toast(`Connected to ${s.repo.name}`);
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
  toast('Lost the bridge connection. Showing the last state.');
  setTimeout(async () => {
    if (!S.LIVE && S.CONN) {
      const c = S.CONN;
      if ((await connect(c, true)) === null) toast('Reconnected');
    }
  }, 3000);
}

export function disconnect() {
  S.LIVE = false;
  S.CONN = null;
  clearConn();
  setConnUI();
  loadDemo();
  toast('Disconnected');
}

/** Revert even though the files changed again since the run; their later edits are lost. */
export async function forceRevert(run: Run) {
  if (st.busy) return;
  st.busy = `revert:${run.id}`;
  renderInspector();
  try {
    await bridge.revert(conn(), run.id, true);
    toast(`Reverted run ${run.id}`);
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
    toast(`Checks on: ${r.checks.map(c => c.name).join(', ')}`);
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
    toast(`Turned off ${name}`);
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
      toast(`Kept run ${run.id}`);
    } else if (act === 'revert') {
      const r = await bridge.revert(c, run.id, false);
      // Files changed again since the run: ask in the conflict dialog, which may call forceRevert.
      if ('conflict' in r) showConflict({ run, files: r.conflict });
      else toast(`Reverted run ${run.id}`);
    }
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
