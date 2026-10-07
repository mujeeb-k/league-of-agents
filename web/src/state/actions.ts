// User actions.
import { bridge } from '../api/client';
import { explain } from '../api/errors';
import { showConflict } from '../components/ConflictDialog';
import { live, liveAction, saveLayoutSoon } from '../api/live';
import { applyView, flyAll, flyFile, flyRun, openingView } from '../lib/camera';
import { agentOf } from '../lib/constants';
import { buildModel, diffRows, existsNow, filesUnder, layout, linesAt, parseSample } from '../lib/model';
import type { FileNode, Mode, Run } from '../lib/types';
import { clamp, plural } from '../lib/util';
import { DEMO_AGENTS, SAMPLE_BRANCH, SAMPLE_REPO, SAMPLE_RUNS, SAMPLE_TREE } from '../demo/sample';
import { SAMPLE_TEXT } from '../demo/sampleText';
import { toast } from '../ui/toast';
import { S, dom, st } from './app';
import { checkSelection, ed, rangeScope, sending } from './editing';
import {
  renderAll,
  renderComposer,
  renderCrumb,
  renderInspector,
  renderScene,
  renderSel,
  renderSide,
  renderTop,
} from './render';

export function selectRun(run: Run | null, fly = true) {
  st.run = run;
  st.cur = null;
  if (!run) st.mode = 'after';
  renderAll();
  if (run && fly) flyRun(run);
}

export function toggleSel(k: string, add: boolean) {
  if (add) {
    if (st.sel.has(k)) st.sel.delete(k);
    else st.sel.add(k);
  } else {
    const only = st.sel.size === 1 && st.sel.has(k);
    st.sel.clear();
    if (!only) st.sel.add(k);
  }
  renderSel();
}

export function stepReview(dir: number) {
  // A run that changed nothing has nothing to step through.
  if (!st.run?.changes.size) return;
  const files = [...st.run.changes.keys()];
  let i = st.cur === null ? -1 : files.indexOf(st.cur);
  i = i < 0 ? (dir > 0 ? 0 : files.length - 1) : clamp(i + dir, 0, files.length - 1);
  viewFile(files[i] ?? null);
}

/** Review navigation: view a changed file without touching the selection, which is the composer's scope. */
export function viewFile(p: string | null) {
  st.cur = p;
  renderScene();
  renderInspector();
  if (p !== null) flyFile(p);
}

export function toggleReviewed(p: string | null) {
  if (!st.run || !p) return;
  if (st.run.reviewed.has(p)) st.run.reviewed.delete(p);
  else st.run.reviewed.add(p);
  renderInspector();
}

/**
 * Demo-mode revert, as live mode does it: the run stays, marked reverted, and later views skip its
 * changes. A later run that changed the same files has to be reverted first.
 */
export function revertDemoRun(run: Run) {
  const i = S.RUNS.indexOf(run);
  if (i < 0 || run.reverted) return;
  const later = S.RUNS.slice(i + 1).find(r => !r.reverted && [...r.changes.keys()].some(p => run.changes.has(p)));
  if (later) {
    showConflict({ run, later, files: [...later.changes.keys()].filter(p => run.changes.has(p)) });
    return;
  }
  run.reverted = true;
  for (const p of run.changes.keys()) if (!existsNow(S.FILES.get(p)!)) st.sel.delete(p);
  renderAll();
  toast(`Reverted run ${run.id}`);
}

export function keepDemoRun(run: Run) {
  run.kept = true;
  renderInspector();
  toast(`Kept run ${run.id}`);
}

/** The selection as a run scope: file paths, and folders ending in /. The whole repository is an empty scope. */
export function scopeFromSelection(): string[] {
  const range = rangeScope();
  if (range) return [range];
  return [...st.sel].map(k => (k.startsWith('d:') ? (k.slice(2) ? k.slice(2) + '/' : '/') : k)).filter(s => s !== '/');
}

export function simulateRun(prompt: string) {
  const scoped = st.sel.size > 0;
  let targets: FileNode[] = [];
  for (const k of st.sel) {
    if (k.startsWith('d:')) targets.push(...filesUnder(S.DIRMAP.get(k.slice(2))!).slice(0, 3));
    else {
      const f = S.FILES.get(k);
      if (f) targets.push(f);
    }
  }
  targets = [...new Set(targets)].filter(existsNow);
  if (!targets.length)
    targets = [...S.FILES.values()]
      .filter(f => existsNow(f) && f.base.length)
      .sort(() => Math.random() - 0.5)
      .slice(0, 2);
  targets = targets.slice(0, 4);
  // Lines selected in the editor: the change goes inside them, after the last selected line.
  const range = rangeScope() && ed.range;
  if (range) targets = [S.FILES.get(ed.path!)!];
  if (!targets.length) {
    toast('Open a folder with code first.');
    return;
  }
  const last = S.RUNS[S.RUNS.length - 1];
  const id = (last ? last.id : 0) + 1,
    upto = S.RUNS.length;
  const run: Run = {
    id,
    agent: st.agent,
    title: prompt.length > 64 ? prompt.slice(0, 62) + '…' : prompt,
    prompt,
    summary: '',
    scope: scopeFromSelection(),
    when: 'Just now',
    dur: '',
    status: 'running',
    changes: new Map(),
    reviewed: new Set(),
  };
  S.RUNS.push(run);
  st.tab = 'runs';
  renderSide();
  toast(`${agentOf(run.agent).name} started run ${id}`);
  const words = (prompt.toLowerCase().match(/[a-z]+/g) || []).filter(w => w.length > 2).slice(0, 3);
  const fn = words.map((w, i) => (i ? w[0]!.toUpperCase() + w.slice(1) : w)).join('') || 'change';
  setTimeout(() => {
    for (const f of targets) {
      const { L } = linesAt(f, upto);
      let at = 0;
      if (range) at = range[1];
      else
        L.forEach((t, i) => {
          if (/^\s*(import |from |use |#include)|require\(/.test(t)) at = i + 1;
        });
      run.changes.set(f.path, {
        created: false,
        deleted: false,
        pre: null,
        lines: [],
        hunks: [
          {
            at,
            del: 0,
            add: [
              '',
              `// ${prompt.slice(0, 72)}`,
              `export function ${fn}(input: unknown) {`,
              `  if (input == null) throw new Error('${f.name}: ${fn} needs input');`,
              '  return input;',
              '}',
            ],
          },
        ],
      });
    }
    run.status = 'done';
    run.dur = '1.4s';
    const names = [...run.changes.keys()].map(p => p.split('/').pop()).join(', ');
    run.summary = scoped
      ? `Changed ${plural(run.changes.size, 'file')} inside the scope: ${names}. Nothing outside it was touched.`
      : `Changed ${plural(run.changes.size, 'file')}: ${names}.`;
    st.mode = 'diff';
    selectRun(run);
    toast(`Run ${id} finished`);
  }, 1400);
}

/**
 * The run a new prompt would continue, or null. A reverted run is never continued:
 * its session still believes its edits exist, so a retry starts a fresh session.
 */
export function followTarget(): Run | null {
  const r = st.run;
  if (
    !S.LIVE ||
    !r ||
    r.status === 'running' ||
    r.reverted ||
    !r.sessionId ||
    st.noFollow === r.id ||
    r.agent !== st.agent
  )
    return null;
  return r;
}

/** Connected to a bridge that stopped answering. The last state stays on screen; nothing acts on it. */
export const isOffline = () => !!S.CONN && !S.LIVE;
const OFFLINE = 'The bridge is offline. Reconnect first.';

/** Keep, revert, cancel or stop a run, on the bridge or in the demo. */
export function runAction(act: string, run: Run) {
  if (isOffline()) toast(OFFLINE);
  else if (S.LIVE) void liveAction(act, run);
  else if (act === 'keep') keepDemoRun(run);
  else if (act === 'revert') revertDemoRun(run);
}

function clearPrompt() {
  dom.prompt.value = '';
  dom.prompt.style.height = 'auto';
}

export async function send() {
  const v = dom.prompt.value.trim();
  if (isOffline()) {
    toast(OFFLINE);
    return;
  }
  if (S.LIVE && S.CONN) {
    const conn = S.CONN;
    if (S.ACTIVE) {
      toast(`Run ${S.ACTIVE.id} is still active`);
      return;
    }
    if (!v) return;
    const fu = followTarget();
    if (st.busy === 'send') return;
    st.busy = 'send';
    renderComposer();
    try {
      // Selected lines are checked against the file as it is now, and sent with their text.
      const why = await checkSelection(conn);
      if (why) {
        toast(why);
        return;
      }
      const scope = scopeFromSelection();
      const held = rangeScope() && ed.path && ed.anchor ? { path: ed.path, anchor: ed.anchor } : null;
      const lines = held ? { [held.path]: held.anchor.text.join('\n') } : undefined;
      const context = held
        ? { [held.path]: { before: held.anchor.before, after: held.anchor.after, twin: held.anchor.twin } }
        : undefined;
      if (lines) sending();
      const r = await bridge.startRun(conn, {
        agent: st.agent,
        prompt: v,
        scope,
        resumeFrom: fu ? fu.id : null,
        lines,
        context,
      });
      if (lines && ed.sent) ed.sent.id = r.id;
      clearPrompt();
      dom.prompt.blur();
      live.pendingSelect = r.id;
      st.tab = 'runs';
      toast(`${agentOf(st.agent).name} started run ${r.id}`);
    } catch (e) {
      ed.sent = null;
      toast(explain(e));
    } finally {
      st.busy = null;
      renderComposer();
    }
    return;
  }
  if (!v) return;
  simulateRun(v);
  clearPrompt();
  dom.sendBtn.disabled = true;
  dom.prompt.blur();
}

export function loadDemo() {
  st.unreachable = null;
  S.REVIEWED.clear();
  S.ACTIVE = null;
  S.LIVE_AGENTS = null;
  if (!DEMO_AGENTS.includes(st.agent)) st.agent = 'claude';
  S.LAYOUT = null; // a new repository is laid out afresh
  buildModel(SAMPLE_TREE, parseSample(SAMPLE_TEXT), SAMPLE_RUNS);
  st.run = S.RUNS[S.RUNS.length - 1] ?? null;
  st.sel.clear();
  // The demo opens on its latest run's changes.
  st.mode = 'diff';
  S.repoName = SAMPLE_REPO;
  S.repoRoot = '';
  S.TOTALS = new Map();
  S.branch = SAMPLE_BRANCH;
  renderCrumb();
  renderAll();
  st.v = openingView();
  applyView(true);
}

let switching = 0;
/** Before, after or diff. Lines that appear because of the switch fade in (Scene.tsx, markFresh). */
export function setMode(m: Mode) {
  if (m === st.mode) return;
  st.mode = m;
  clearTimeout(switching);
  dom.world.dataset.switching = '';
  switching = window.setTimeout(() => delete dom.world.dataset.switching, 250);
  renderScene();
  renderTop();
}

/** Lays the map out afresh, for the current canvas, and fits it. */
export function tidyLayout() {
  layout(true);
  renderAll();
  saveLayoutSoon();
  flyAll();
  toast('Layout tidied');
}

/** A run's changed lines as text: removed lines with -, added lines with +, under each file's path. */
function diffText(run: Run): string {
  const out: string[] = [];
  for (const [path, ch] of run.changes) {
    const pre = S.CONN ? (ch.pre ?? []) : linesAt(S.FILES.get(path)!, S.RUNS.indexOf(run)).L;
    out.push(`--- ${path}`);
    for (const r of diffRows(pre, ch.hunks)) if (r.k) out.push((r.k === 'add' ? '+ ' : '- ') + r.t);
  }
  return out.slice(0, 200).join('\n');
}

/**
 * Propagate: after a save, the agent updates everything that depends on it, across the
 * repository. In the demo, identifiers the save renamed are renamed in the files that import it.
 */
export async function propagate(run: Run) {
  const files = [...run.changes.keys()].map(p => p.split('/').pop()).join(', ');
  const prompt = `Update what depends on my change to ${files}.\n\nThis is my change:\n\n${diffText(run)}\n\nUpdate every caller, import, test and type in the repository that depends on it, so the code stays consistent. Keep my change as it is.`;
  if (!S.LIVE || !S.CONN) return propagateInDemo(run, files);
  if (st.busy) return;
  st.busy = 'send';
  renderComposer();
  try {
    const r = await bridge.startRun(S.CONN, { agent: st.agent, prompt, scope: [], resumeFrom: null });
    live.pendingSelect = r.id;
    toast(`${agentOf(st.agent).name} started run ${r.id}`);
  } catch (e) {
    toast(explain(e));
  } finally {
    st.busy = null;
    renderComposer();
  }
}

function propagateInDemo(run: Run, files: string) {
  const removed: string[] = [],
    added: string[] = [];
  for (const [path, ch] of run.changes)
    for (const r of diffRows(linesAt(S.FILES.get(path)!, S.RUNS.indexOf(run)).L, ch.hunks))
      if (r.k) (r.k === 'del' ? removed : added).push(r.t);
  const words = (lines: string[]) => new Set(lines.join(' ').match(/[A-Za-z_]\w*/g));
  const before = words(removed),
    after = words(added);
  const olds = [...before].filter(w => !after.has(w)),
    news = [...after].filter(w => !before.has(w));
  const renames = olds.length === news.length ? olds.map((o, i) => [o, news[i]!] as const) : [];
  const last = S.RUNS[S.RUNS.length - 1]!;
  const next: Run = {
    id: last.id + 1,
    agent: st.agent,
    title: `Update what depends on my change to ${files}`,
    prompt: `Update what depends on my change to ${files}.`,
    summary: '',
    when: 'Just now',
    dur: '1.4s',
    status: 'done',
    changes: new Map(),
    reviewed: new Set(),
  };
  for (const path of run.changes.keys())
    for (const user of S.GRAPH.in.get(path) ?? []) {
      const L = linesAt(S.FILES.get(user)!, S.RUNS.length).L;
      const hunks = L.flatMap((line, at) => {
        const now = renames.reduce((l, [o, n]) => l.replace(new RegExp(`\\b${o}\\b`, 'g'), n), line);
        return now === line ? [] : [{ at, del: 1, add: [now] }];
      });
      if (hunks.length) next.changes.set(user, { created: false, deleted: false, pre: null, lines: [], hunks });
    }
  const names = [...next.changes.keys()].map(p => p.split('/').pop()).join(', ');
  next.summary = next.changes.size
    ? `Updated ${plural(next.changes.size, 'file')} that use${next.changes.size === 1 ? 's' : ''} your change: ${names}.`
    : 'Nothing else depends on this change.';
  S.RUNS.push(next);
  st.mode = 'diff';
  selectRun(next);
  toast(`Run ${next.id} finished`);
}
