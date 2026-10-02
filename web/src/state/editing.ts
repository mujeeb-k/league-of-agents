// Editing on the map: the file open in the editor, unsaved drafts, and saving. A save is a run by
// "You", with the same history, review and revert as an agent's run; in the demo it stays in the browser.
import { bridge } from '../api/client';
import { explain } from '../api/errors';
import type { InlineDiff } from '../lib/editor';
import { diffRows, linesAt } from '../lib/model';
import { changedBlock } from '../lib/textdiff';
import type { Run } from '../lib/types';
import { toast } from '../ui/toast';
import { S, dom, st } from './app';
import { applyPanels } from './panels';
import { bump, renderAll, renderComposer, renderSel } from './render';

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
};

/** The scope while lines are selected in the open file: "path:12-18", or null. */
export function rangeScope(): string | null {
  const { path, range } = ed;
  if (!path || !range || st.sel.size !== 1 || !st.sel.has(path)) return null;
  return `${path}:${range[0]}-${range[1]}`;
}

/** The selection inside the editor changed; the composer's scope follows it. */
export function selectLines(lines: [number, number] | null) {
  if (lines?.[0] === ed.range?.[0] && lines?.[1] === ed.range?.[1]) return;
  ed.range = lines;
  renderComposer();
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
  ed.loading = true;
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
    if (ed.path !== path || drafts.has(path) || r.text === ed.saved) return;
    ed.saved = r.text;
    ed.hash = r.hash;
    bump('editor');
  } catch {
    // The bridge stopped answering; the offline state says so.
  }
}

export function closeEditor() {
  if (!ed.path) return;
  ed.path = null;
  ed.conflict = null;
  ed.range = null;
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
      toast('id' in r ? `Saved as run ${r.id}` : 'No changes to save');
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
    title: `Edited ${path.split('/').pop()}`,
    prompt: '',
    summary: '',
    when: 'Just now',
    dur: '',
    status: 'done',
    changes: new Map([[path, { created: false, deleted: false, pre: null, lines: [], hunks: [hunk] }]]),
    reviewed: new Set(),
  });
  toast(`Saved as run ${id}`);
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
  const rows = ch.created ? ch.lines.map((t, i) => ({ t, k: 'add' as const, na: i + 1 })) : diffRows(pre, ch.hunks);
  const added: number[] = [],
    removed = new Map<number, string[]>();
  let gone: string[] = [],
    next = 1;
  for (const r of rows) {
    if (r.k === 'del') {
      gone.push(r.t);
      continue;
    }
    next = r.na! + 1;
    if (gone.length) removed.set(r.na!, gone);
    gone = [];
    if (r.k === 'add') added.push(r.na!);
  }
  if (gone.length) removed.set(next, gone);
  return { added, removed };
}

/** Leaving the page with unsaved edits asks first. */
addEventListener('beforeunload', e => {
  if (drafts.size) e.preventDefault();
});
