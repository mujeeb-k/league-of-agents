// The editor. A code card expands in place into an editor that fills the canvas beside the sidebar, over the dimmed
// map, and Esc collapses it back to its spot. Only transform and opacity animate. While a run that changed the file is
// open, it shows the run's Before, After or Diff on the whole file, read only.
import { ChevronDown, X } from 'lucide-react';
import { EDITORS, editorUrl } from '../lib/openIn';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CH, CW } from '../lib/constants';
import type { Editor as CodeEditor } from '../lib/editor';
import { sideInset } from '../state/panels';
import { S, dom, st } from '../state/app';
import {
  openEditor,
  closeEditor,
  discardDraft,
  drafts,
  ed,
  edited,
  editingBlocked,
  inlineDiff,
  instruct,
  refreshEditor,
  reviewRun,
  runInView,
  runView,
  saveEditor,
  selectLines,
  useDiskVersion,
} from '../state/editing';
import { runAction } from '../state/actions';
import { agentOf } from '../lib/constants';
import type { Run } from '../lib/types';
import { bump, useRegion } from '../state/render';
import { Spinner } from './bits';
import { FileIcon } from './FileIcon';
import { fileKind } from '../lib/fileKind';
import { Tip } from './TopBar';
import { Button } from './ui/button';
import { changedBlock } from '../lib/textdiff';
import { t } from '../i18n';

const DUR = 240;
const MODE_NAMES = { before: 'Before', after: 'After', diff: 'Diff' } as const;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The files a file imports, and the files that use it (scene.ts builds the graph). */
const related = (path: string) => ({
  imports: S.GRAPH.out.get(path) ?? [],
  usedBy: S.GRAPH.in.get(path) ?? [],
});

const MARGIN = 12;
/** Room kept below the editor for the composer, which takes the selected lines as its scope. */
const COMPOSER = 128;

/** Where the editor sits: across the part of the canvas the sidebar leaves free, above the composer. */
function frame() {
  const W = dom.stage.clientWidth,
    H = dom.stage.clientHeight,
    inset = sideInset(st.v.s);
  return { left: inset + MARGIN, top: MARGIN, width: W - inset - 2 * MARGIN, height: H - MARGIN - COMPOSER };
}

/** The files this one imports, and the files that use it: a row of chips under the header, each opening that file. */
function RelatedRow({ path }: { path: string }) {
  const r = related(path);
  if (!r.imports.length && !r.usedBy.length) return null;
  const chips = (paths: string[], label: (p: string) => string) =>
    paths.map(p => {
      const f = S.FILES.get(p);
      return f ? (
        <button
          key={p}
          type="button"
          className="rel-chip flex h-7 max-w-56 shrink-0 items-center gap-1.5 rounded-md border bg-popover px-2 font-mono text-xs text-ink2 hover:text-foreground"
          data-path={p}
          aria-label={label(p)}
          title={p}
          onClick={() => void openEditor(p)}
        >
          <FileIcon kind={fileKind(f.name)} />
          <span className="truncate">{f.name}</span>
        </button>
      ) : null;
    });
  return (
    <div id="editorRelated" className="flex shrink-0 items-center gap-2 overflow-x-auto border-b px-4 py-2">
      {r.imports.length ? (
        <>
          <span className="shrink-0 text-xs text-muted-foreground">{t('Imports')}</span>
          {chips(r.imports, p => t('Imports {path}. Open it', { path: p }))}
        </>
      ) : null}
      {r.usedBy.length ? (
        <>
          <span className="ml-2 shrink-0 text-xs text-muted-foreground">{t('Used by')}</span>
          {chips(r.usedBy, p => t('Used by {path}. Open it', { path: p }))}
        </>
      ) : null}
    </div>
  );
}

/** The transform that puts the editor over its card on the map, for the expand and collapse. */
function fromCard(path: string, box: ReturnType<typeof frame>) {
  const f = S.FILES.get(path);
  if (!f) return 'none';
  const { x, y, s } = st.v;
  const cx = f.x * s + x,
    cy = f.y * s + y;
  return `translate(${cx - box.left}px, ${cy - box.top}px) scale(${(CW * s) / box.width}, ${(CH * s) / box.height})`;
}

const lines = (t: string) => t.split('\n');
/** The line the cursor is on, for opening the file there in another editor. */
const cursorLine = (e: CodeEditor | undefined) =>
  e ? e.view.state.doc.lineAt(e.view.state.selection.main.head).number : 1;

/** Open this file at the cursor's line in Cursor or VS Code. */
function OpenIn({ path, line }: { path: string; line: () => number }) {
  const [at, setAt] = useState(1);
  return (
    <DropdownMenu onOpenChange={open => open && setAt(line())}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" id="openIn" className="text-ink2">
          {t('Open in')}
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent id="openInMenu" align="end">
        {EDITORS.map(e => (
          <DropdownMenuItem key={e.id} asChild>
            <a href={editorUrl(e.id, S.repoRoot, path, at)} data-editor={e.id} className="no-underline">
              {e.name}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The lines a run was limited to in this file, as "6–9". */
const reviewLines = (run: Run, path: string) =>
  run.scope
    ?.find(s => s.startsWith(path + ':'))
    ?.slice(path.length + 1)
    .replace('-', '–') ?? '';

/** What changed on disk since the file was opened: the changed block, removed and added lines. */
function DiskChange({ before, now }: { before: string; now: string }) {
  const h = changedBlock(lines(before), lines(now));
  if (!h) return null;
  const removed = lines(before).slice(h.at, h.at + h.del);
  return (
    <pre className="mt-2 max-h-28 overflow-auto rounded-md bg-muted p-2 font-mono text-xs leading-5">
      {removed.map((l, i) => (
        <div key={'d' + i} className="text-del">{`− ${h.at + i + 1}  ${l}`}</div>
      ))}
      {h.add.map((l, i) => (
        <div key={'a' + i} className="text-add">{`+ ${h.at + i + 1}  ${l}`}</div>
      ))}
    </pre>
  );
}

export function Editor() {
  useRegion('editor');
  // Keep and revert show in the inspector, and runs starting in the run list: the editor follows both.
  useRegion('inspector');
  useRegion('side');
  const sceneRev = useRegion('scene');
  // The path in the DOM: it outlives ed.path while the editor collapses.
  const [shown, setShown] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null),
    host = useRef<HTMLDivElement>(null),
    shade = useRef<HTMLDivElement>(null),
    cm = useRef<{ path: string; editor: CodeEditor } | null>(null);
  const path = ed.path;
  if (path && path !== shown) setShown(path);
  const blocked = editingBlocked();
  // A run that changed the file is open: its change, whole, in the run's mode; null while it loads.
  const inRun = runInView(),
    view = inRun && path ? runView(inRun, path, st.mode) : null,
    readOnly = !!blocked || !!inRun;

  // Expand: start over the card, then move to the editor's place. Opening another file from inside the
  // editor expands from that file's card.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el || !shown || !path) return;
    if (reduced()) return;
    el.style.transition = 'none';
    el.style.transform = fromCard(shown, frame());
    el.style.opacity = '0';
    shade.current!.style.opacity = '0';
    void el.offsetWidth;
    el.style.transition = `transform ${DUR}ms var(--ease), opacity ${DUR}ms var(--ease)`;
    el.style.transform = 'none';
    el.style.opacity = '1';
    shade.current!.style.opacity = '1';
  }, [shown, path]);

  // Collapse: back over the card, fading, then gone.
  useEffect(() => {
    if (path || !shown) return;
    const el = panel.current;
    const done = () => {
      cm.current?.editor.view.destroy();
      cm.current = null;
      setShown(null);
    };
    if (!el || reduced()) return done();
    el.style.transform = fromCard(shown, frame());
    el.style.opacity = '0';
    shade.current!.style.opacity = '0';
    const t = setTimeout(done, DUR);
    return () => clearTimeout(t);
  }, [path, shown]);

  // The code editor, once the text is loaded: one per file, kept through the collapse. Its text follows the
  // saved text when there is no draft, as when watch mode or an agent changed the file.
  useEffect(() => {
    if (!path || ed.loading || !host.current || (inRun && !view)) return;
    const text = view ? view.text : (drafts.get(path)?.text ?? ed.saved);
    if (cm.current && cm.current.path !== path) {
      cm.current.editor.view.destroy();
      cm.current = null;
    }
    if (!cm.current) {
      void import('../lib/editor').then(({ createEditor }) => {
        if (ed.path !== path || cm.current || !host.current) return;
        // It starts from the saved text, with a draft applied as one change, so undo goes back to the saved text.
        const editor = createEditor(host.current, view ? view.text : ed.saved, readOnly, {
          onChange: t => edited(path, t),
          onSelect: selectLines,
          onInstruct: instruct,
          onSave: () => void saveEditor(),
          onClose: closeEditor,
        });
        cm.current = { path, editor };
        if (!view && text !== ed.saved)
          editor.view.dispatch({ changes: { from: 0, to: ed.saved.length, insert: text } });
        editor.view.focus();
        // Render again now that the code editor exists, so an agent's change shows inline at once.
        bump('editor');
      });
    } else if (cm.current.editor.view.state.doc.toString() !== text) {
      cm.current.editor.reset(text);
      cm.current.editor.setReadOnly(readOnly);
      // Selected lines follow their code to where it is now (refreshEditor); a stale selection stays unselected.
      if (ed.range && !ed.stale) cm.current.editor.select(ed.range);
    }
  });

  useEffect(() => {
    cm.current?.editor.setReadOnly(readOnly);
  }, [readOnly]);

  // An agent's change to lines of this file shows inline until it is kept or reverted; a draft hides it. In an open
  // run, the run's change shows instead.
  const review = path && !inRun && !drafts.has(path) ? reviewRun(path) : null;
  const shownDiff = useRef('');
  useEffect(() => {
    const key = view && inRun ? `run|${inRun.id}|${st.mode}` : review && path ? `${review.id}|${ed.saved}` : '';
    if (!cm.current || key === shownDiff.current) return;
    shownDiff.current = key;
    cm.current.editor.showDiff(view ? view.diff : review && path ? inlineDiff(review, path) : null);
  });

  // A control that just went away, such as the conflict's buttons, leaves focus nowhere: back to the code.
  useEffect(() => {
    if (path && !ed.saving && document.activeElement === document.body) cm.current?.editor.view.focus();
  });

  // In the demo, a run can change the open file; live, state events do the same (refreshEditor).
  useEffect(() => {
    if (!S.CONN) void refreshEditor();
  }, [sceneRev]);

  if (!shown) return null;
  const f = S.FILES.get(shown),
    name = f?.name ?? shown,
    dirty = drafts.has(shown),
    b = frame();
  return (
    <div id="editorLayer" className="absolute inset-0">
      <div
        ref={shade}
        className="absolute inset-0 bg-canvas/75 transition-opacity duration-200"
        onPointerDown={closeEditor}
      />
      <section
        id="editor"
        ref={panel}
        role="dialog"
        aria-label={t('Editing {name}', { name })}
        className="absolute flex origin-top-left flex-col overflow-hidden rounded-xl border bg-card shadow-[var(--e2)] will-change-transform"
        style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
        onKeyDown={e => {
          if (e.key === 'Escape') closeEditor();
        }}
      >
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <FileIcon kind={fileKind(name)} />
          <span className="shrink-0 font-mono text-[13px] font-medium whitespace-nowrap">{name}</span>
          {dirty ? <span className="dirty size-2 rounded-full bg-mod" aria-label={t('Unsaved changes')} /> : null}
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{shown}</span>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {blocked ? (
              <span id="editorBlocked" className="text-xs text-ink2">
                {t('Run {id} is working. Editing waits until it finishes.', { id: blocked.id })}
              </span>
            ) : null}
            {S.repoRoot ? <OpenIn path={shown} line={() => cursorLine(cm.current?.editor)} /> : null}
            {inRun ? (
              <>
                <span id="editorRunView" className="text-xs text-ink2">
                  {t('Run {id}', { id: inRun.id })} · {t(MODE_NAMES[st.mode])}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  id="editFile"
                  onClick={() => {
                    ed.asEdit = true;
                    bump('editor');
                  }}
                >
                  {t('Edit file')}
                </Button>
              </>
            ) : null}
            {dirty && !blocked ? (
              <Button variant="ghost" size="sm" id="discardDraft" onClick={discardDraft}>
                {t('Discard changes')}
              </Button>
            ) : null}
            {inRun ? null : (
              <Tip label={t('Save')} keys="⌘S">
                <Button
                  size="sm"
                  id="saveFile"
                  disabled={!dirty || !!blocked || ed.saving}
                  onClick={() => void saveEditor()}
                >
                  {ed.saving ? <Spinner className="text-current" /> : null}
                  {t('Save')}
                </Button>
              </Tip>
            )}
            <Tip label={t('Close')} keys="Esc">
              <Button
                variant="ghost"
                size="icon-sm"
                id="closeEditor"
                aria-label={t('Close the editor')}
                onClick={closeEditor}
              >
                <X />
              </Button>
            </Tip>
          </span>
        </header>
        <RelatedRow path={shown} />
        {review ? (
          <div id="editorReview" className="flex shrink-0 items-center gap-3 border-b bg-card px-4 py-2">
            <span className="min-w-0 flex-1 text-ink2 text-pretty">
              {t('{agent} changed lines {lines}. Keep the change, or revert it.', {
                agent: agentOf(review.agent).name,
                lines: reviewLines(review, shown),
              })}
            </span>
            <Button variant="outline" size="sm" id="rejectChange" onClick={() => runAction('revert', review)}>
              {t('Revert')}
            </Button>
            <Button size="sm" id="acceptChange" onClick={() => runAction('keep', review)}>
              {t('Keep')}
            </Button>
          </div>
        ) : null}
        {ed.conflict ? (
          <div id="editorConflict" className="shrink-0 border-b border-l-2 border-l-mod bg-card px-4 py-3">
            <div className="font-medium">{t('This file changed on disk since you opened it')}</div>
            <p className="text-ink2">{t('Saving now would replace these lines with yours:')}</p>
            <DiskChange before={ed.saved} now={ed.conflict.text} />
            <div className="mt-3 flex gap-2">
              <Button variant="outline" size="sm" id="useDisk" onClick={useDiskVersion}>
                {t('Use the file on disk')}
              </Button>
              <Button size="sm" id="overwrite" onClick={() => void saveEditor(true)}>
                {t('Save mine anyway')}
              </Button>
            </div>
          </div>
        ) : null}
        {ed.loading || (inRun && !view) ? (
          <div className="flex flex-1 items-center justify-center text-ink2">
            <Spinner />
          </div>
        ) : null}
        <div ref={host} className="cm-host min-h-0 flex-1" hidden={ed.loading || (!!inRun && !view)} />
      </section>
    </div>
  );
}
