// Editing on the map: the file open in the editor, unsaved drafts, and saving. A save is a run by
// "You", with the same history, review and revert as an agent's run; in the demo it stays in the browser.
import { BridgeError, bridge } from '../api/client';
import type { Conn } from '../api/types';
import { anchorAt, grown, relocate, toLines, type Anchor } from '../lib/anchor';
import { explain } from '../api/errors';
import type { InlineDiff } from '../lib/editor';
import { applyHunks, diffRows, linesAt } from '../lib/model';
import { changedBlock } from '../lib/textdiff';
import type { Change, Mode, Run } from '../lib/types';
import { toast } from '../ui/toast';
import { S, dom, st } from './app';
import { applyPanels } from './panels';
import { bump, renderAll, renderComposer, renderSel } from './render';
import { t } from '../i18n';

export interface Draft {
  text: string;
}
/** Unsaved edits, by path. They outlive the editor: Esc collapses it and keeps the draft. */
export const drafts = new Map<string, Draft>();

export const ed = {
  /** The file open in the editor. */
  path: null as string | null,
  /** The saved text, and its hash on disk as the bridge reported it ('' in the demo). */
  saved: '',
  hash: '',
  loading: false,
  saving: false,
  /** The file changed on disk since it was opened: its text there now. */
  conflict: null as { text: string; hash: string } | null,
  /** The lines selected in the editor (1-based, inclusive): the composer's scope while the editor is open. */
  range: null as [number, number] | null,
  /** What the selection is held by: its text and the lines around it (lib/anchor), taken again after each move. */
  anchor: null as Anchor | null,
  /**
   * The selected lines can't be found as they were: 'changed', or 'removed' by the run started on them. Nothing
   * runs on them until lines are selected again or the selection is cleared.
   */
  stale: null as 'changed' | 'removed' | null,
  /**
   * The run started on the selected lines, with the file and the lines as it started: its edits inside them
   * grow or shrink the selection rather than leave it changed. Set as the run is asked for (its id comes with the
   * answer); cleared once it ends, fails to start, or the selection changes.
   */
  sent: null as { id: number | null; path: string; before: string[]; range: [number, number] } | null,
  /** Edit the file as it is now, though a run that changed it is open (which shows the run's change instead). */
  asEdit: false,
};

/** Said when the selected lines can't be found as they were. */
export const staleSelection = (path: string) =>
  ed.stale === 'removed'
    ? t('The lines you selected in {name} were removed. Select lines again.', { name: path.split('/').pop()! })
    : t('The lines you selected in {name} changed. Select them again.', { name: path.split('/').pop()! });

/** The scope while lines are selected in the open file: "path:12-18", or null. */
export function rangeScope(): string | null {
  const { path, range } = ed;
  if (!path || !range || st.sel.size !== 1 || !st.sel.has(path)) return null;
  return `${path}:${range[0]}-${range[1]}`;
}

/** The selection inside the editor changed; the composer's scope follows it. */
export function selectLines(lines: [number, number] | null) {
  const same = lines?.[0] === ed.range?.[0] && lines?.[1] === ed.range?.[1];
  const doc = ed.path ? (drafts.get(ed.path)?.text ?? ed.saved) : '';
  ed.anchor = lines ? anchorAt(toLines(doc), lines[0], lines[1]) : null;
  if (same && !ed.stale) return;
  ed.sent = null;
  ed.range = lines;
  ed.stale = null;
  renderComposer();
}

/** Clears the selected lines, keeping their file in scope: the next prompt goes out on the whole file. */
export function clearLines() {
  ed.range = null;
  ed.anchor = null;
  ed.stale = null;
  ed.sent = null;
  renderComposer();
}

/**
 * Moves the selection to where its lines are in `text`: the run started on them takes it to the lines it left
 * there, or marks it removed when it took them all out (never to a copy elsewhere); otherwise it follows its
 * anchor, and is stale when that can't tell where they are. After a keep or a move, the anchor is taken again.
 */
function follow(text: string) {
  if (!ed.range || !ed.anchor || ed.stale) return;
  const lines = toLines(text);
  const run = ed.sent && ed.sent.path === ed.path ? grown(ed.sent.before, lines, ed.sent.range) : null;
  const at = run ? null : relocate(lines, ed.anchor, ed.range[0]);
  if (run === 'removed') ed.stale = 'removed';
  else if (run) ed.range = run;
  else if (at === null) ed.stale = 'changed';
  else ed.range = [at, at + ed.anchor.text.length - 1];
  if (!ed.stale) ed.anchor = anchorAt(lines, ed.range[0], ed.range[1]);
  renderComposer();
}

/** A run is asked for on the selected lines: the selection takes the lines it leaves there (follow). */
export function sending() {
  ed.sent = ed.path && ed.range ? { id: null, path: ed.path, before: toLines(ed.saved), range: ed.range } : null;
}

/**
 * Before a run on selected lines: the agent works on the file as it is on disk, so the selection is checked
 * against it now. Returns why the run can't go ahead, or null, with the selection moved if its lines moved.
 */
export async function checkSelection(conn: Conn): Promise<string | null> {
  const path = ed.path;
  if (!path || !ed.range || !rangeScope()) return null;
  if (drafts.has(path))
    return t('Save your changes to {name} first: the agent works on the saved file.', { name: path.split('/').pop()! });
  if (ed.stale) return staleSelection(path);
  const r = await bridge.file(conn, path);
  if (ed.path !== path) return null;
  follow(r.text);
  if (ed.stale) return staleSelection(path);
  if (r.text !== ed.saved) {
    ed.saved = r.text;
    ed.hash = r.hash;
    bump('editor');
  }
  return null;
}

/** ⌘K with lines selected: write the instruction in the composer, scoped to those lines. */
export function instruct() {
  dom.prompt.focus();
}

const splitText = (t: string) => {
  const l = t.split('\n');
  if (l.length && l[l.length - 1] === '') l.pop();
  return l;
};

/** The file's text as it is now: from the bridge in live mode (full length), from the model in the demo. */
async function load(path: string) {
  if (S.CONN) return bridge.file(S.CONN, path);
  const f = S.FILES.get(path)!;
  const { L } = linesAt(f, S.RUNS.length);
  return { path, text: L.length ? L.join('\n') + '\n' : '', hash: '' };
}

export async function openEditor(path: string) {
  if (!S.FILES.has(path)) return;
  st.sel = new Set([path]);
  st.editing = true;
  applyPanels();
  ed.path = path;
  ed.conflict = null;
  ed.range = null;
  ed.anchor = null;
  ed.stale = null;
  ed.sent = null;
  // Opened with a run open, it shows the run's change; opened to edit, it stays so when a run is selected later.
  ed.asEdit = !st.run;
  ed.loading = true;
  // The hovered tile's name would float over the editor until the pointer moves.
  dom.tileName.hidden = true;
  renderSel();
  bump('editor');
  try {
    const r = await load(path);
    if (ed.path !== path) return;
    ed.saved = r.text;
    ed.hash = r.hash;
  } catch (e) {
    toast(explain(e));
    ed.path = null;
  } finally {
    ed.loading = false;
    bump('editor');
  }
}

/**
 * The open file changed, by watch mode, an agent or a run: with no draft, the editor shows it as it is now.
 * A draft is kept; saving it then warns that the file changed on disk.
 */
export async function refreshEditor() {
  const path = ed.path;
  if (!path || ed.loading || ed.saving || drafts.has(path)) return;
  try {
    const r = await load(path);
    if (ed.path !== path || drafts.has(path)) return;
    if (r.text !== ed.saved) {
      ed.saved = r.text;
      ed.hash = r.hash;
      follow(r.text);
      bump('editor');
    }
    const sent = ed.sent && S.RUNS.find(x => x.id === ed.sent!.id);
    if (sent && sent.status !== 'running') ed.sent = null;
  } catch {
    // The bridge stopped answering; the offline state says so.
  }
}

export function closeEditor() {
  if (!ed.path) return;
  ed.path = null;
  ed.conflict = null;
  ed.range = null;
  ed.anchor = null;
  ed.stale = null;
  ed.sent = null;
  st.editing = false;
  applyPanels();
  bump('editor');
}

/** The text in the editor changed: track the draft, and show or hide the file's dirty dot when that flips. */
export function edited(path: string, text: string) {
  const was = drafts.has(path);
  if (text === ed.saved) drafts.delete(path);
  else drafts.set(path, { text });
  if (was !== drafts.has(path)) {
    renderAll();
    bump('editor');
  }
}

export function discardDraft() {
  if (!ed.path) return;
  drafts.delete(ed.path);
  renderAll();
  bump('editor');
}

/** An agent is working; the editor waits until it finishes. A save's own run never blocks it. */
export const editingBlocked = (): Run | null => {
  const r = S.CONN ? S.ACTIVE : S.RUNS.find(x => x.status === 'running');
  return r && r.agent !== 'you' ? r : null;
};

export async function saveEditor(force = false) {
  const path = ed.path,
    d = path && drafts.get(path);
  if (!path || !d || ed.saving || editingBlocked()) return;
  ed.saving = true;
  bump('editor');
  try {
    if (S.CONN) {
      const base = force && ed.conflict ? ed.conflict.hash : ed.hash;
      const r = await bridge.save(S.CONN, { path, text: d.text, base });
      if ('changed' in r) {
        ed.conflict = r.changed;
        return;
      }
      const now = await bridge.file(S.CONN, path);
      ed.saved = now.text;
      ed.hash = now.hash;
      ed.conflict = null;
      drafts.delete(path);
      toast('id' in r ? t('Saved as run {id}', { id: r.id }) : t('No changes to save'));
    } else saveInDemo(path, d.text);
    renderAll();
  } catch (e) {
    toast(explain(e));
  } finally {
    ed.saving = false;
    bump('editor');
  }
}

/** Keeps the file on disk and drops the draft: the editor shows the file as it is now. */
export function useDiskVersion() {
  if (!ed.path || !ed.conflict) return;
  ed.saved = ed.conflict.text;
  ed.hash = ed.conflict.hash;
  ed.conflict = null;
  drafts.delete(ed.path);
  renderAll();
  bump('editor');
}

/** The demo has no bridge: a save becomes a run by You in the browser. */
function saveInDemo(path: string, text: string) {
  const hunk = changedBlock(splitText(ed.saved), splitText(text));
  drafts.delete(path);
  ed.saved = text;
  if (!hunk) return;
  const last = S.RUNS[S.RUNS.length - 1];
  const id = (last ? last.id : 0) + 1;
  S.RUNS.push({
    id,
    agent: 'you',
    title: t('Edited {name}', { name: path.split('/').pop()! }),
    prompt: '',
    summary: '',
    when: t('Just now'),
    dur: '',
    status: 'done',
    changes: new Map([[path, { created: false, deleted: false, pre: null, lines: [], hunks: [hunk] }]]),
    reviewed: new Set(),
  });
  toast(t('Saved as run {id}', { id }));
}

/**
 * The agent run whose change to this file the editor shows inline, to accept or reject: the latest run that
 * changed it, made by an agent limited to lines of it, and not yet kept or reverted.
 */
export function reviewRun(path: string): Run | null {
  const last = [...S.RUNS].reverse().find(r => r.changes.has(path) && !r.reverted);
  if (!last || last.agent === 'you' || last.status !== 'done' || last.kept) return null;
  return last.scope?.some(s => s.startsWith(path + ':')) ? last : null;
}

/** That run's change to the file, as line numbers in the file now: added lines, and removed lines by position. */
export function inlineDiff(run: Run, path: string): InlineDiff {
  const ch = run.changes.get(path)!;
  const pre = S.CONN ? (ch.pre ?? []) : linesAt(S.FILES.get(path)!, S.RUNS.indexOf(run)).L;
  const { added, removed } = changeLines(pre, ch);
  return { added, removed };
}

/**
 * A change as line numbers: lines added and lines removed (by the line they preceded) in the text after it, and the
 * lines it replaced in the text before it.
 */
function changeLines(pre: string[], ch: Change): Required<InlineDiff> {
  const rows = ch.created ? ch.lines.map((t, i) => ({ t, k: 'add' as const, na: i + 1 })) : diffRows(pre, ch.hunks);
  const added: number[] = [],
    deleted: number[] = [],
    removed = new Map<number, string[]>();
  let gone: string[] = [],
    next = 1;
  for (const r of rows) {
    if (r.k === 'del') {
      gone.push(r.t);
      deleted.push(r.nb!);
      continue;
    }
    next = r.na! + 1;
    if (gone.length) removed.set(r.na!, gone);
    gone = [];
    if (r.k === 'add') added.push(r.na!);
  }
  if (gone.length) removed.set(next, gone);
  return { added, removed, deleted };
}

/** The run whose change to the open file it shows, read only, in Before, After or Diff; null to edit the file. */
export function runInView(): Run | null {
  const run = st.run;
  return ed.path && !ed.asEdit && run?.changes.has(ed.path) ? run : null;
}

type RunView = { text: string; diff: InlineDiff };
/** Each file a run changed, whole, once loaded: its text and marks in each mode. Null while it loads. */
const runViews = new Map<string, Record<Mode, RunView> | null>();

/**
 * The file as the run found it, whole (the state keeps only its first 4,000 lines), and as the run left it, in
 * each mode: Before marks the lines the run replaced, After the lines it added, Diff both.
 */
async function loadRunView(run: Run, path: string, key: string) {
  runViews.set(key, null);
  const ch = run.changes.get(path)!;
  let before = ch.created ? [] : (ch.pre ?? []);
  if (!S.CONN) before = linesAt(S.FILES.get(path)!, S.RUNS.indexOf(run)).L;
  else if (!ch.created)
    try {
      before = toLines((await bridge.runBefore(S.CONN, run.id, path)).text);
    } catch (e) {
      // Bridges before 0.2.0 don't hand the whole file over: the lines the run kept stand in for it.
      if (!(e instanceof BridgeError && e.status === 404)) toast(explain(e));
    }
  const after = ch.deleted ? [] : ch.created && !ch.hunks.length ? ch.lines : applyHunks(before, ch.hunks);
  const { added, removed, deleted } = changeLines(before, ch);
  runViews.set(key, {
    before: { text: before.join('\n'), diff: { added: [], removed: new Map(), deleted } },
    after: { text: after.join('\n'), diff: { added, removed: new Map() } },
    diff: { text: after.join('\n'), diff: { added, removed } },
  });
  bump('editor');
}

/** What the open file shows in a run's mode, loading it the first time; null while it loads. */
export function runView(run: Run, path: string, mode: Mode): RunView | null {
  const key = `${run.id}|${path}`;
  if (!runViews.has(key)) void loadRunView(run, path, key);
  return runViews.get(key)?.[mode] ?? null;
}

/** Leaving the page with unsaved edits asks first. */
addEventListener('beforeunload', e => {
  if (drafts.size) e.preventDefault();
});
