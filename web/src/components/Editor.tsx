// The editor. A code card expands in place into a large editor centred on
// the canvas, over the dimmed map, and Esc collapses it back to its spot. Only transform and opacity animate.
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

const DUR = 240;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The files a file imports, and the files that use it (scene.ts builds the graph). */
const related = (path: string) => ({
  imports: S.GRAPH.out.get(path) ?? [],
  usedBy: S.GRAPH.in.get(path) ?? [],
});

/** Room on each side of the editor for its import lines (Related), when the file has any. */
const SIDE = 176;

/**
 * Where the editor sits: centred in the part of the canvas the sidebar leaves free, clear of the composer,
 * with room at its sides for the file's import lines.
 */
function frame(path: string) {
  const W = dom.stage.clientWidth,
    H = dom.stage.clientHeight,
    inset = sideInset(st.v.s),
    r = related(path);
  // The editor keeps at least 600 px for code; the sides give way first.
  const side = r.imports.length || r.usedBy.length ? Math.min(SIDE, Math.max(32, (W - inset - 600) / 2)) : 32;
  const w = Math.min(1040, W - inset - 2 * side),
    top = 56,
    h = H - top - 128;
  return { left: inset + (W - inset - w) / 2, top, width: w, height: h };
}
type Frame = ReturnType<typeof frame>;

/**
 * The file's import lines stay visible while it is open: a line from the editor's edge to each related
 * card that is on screen, outlined above the dimmed map; a related file off screen is a chip beside the
 * editor instead, imports on the right and users on the left. Either opens that file.
 */
function Related({ path, box }: { path: string; box: Frame }) {
  const W = dom.stage.clientWidth,
    H = dom.stage.clientHeight,
    { x, y, s } = st.v;
  const lines: React.ReactNode[] = [],
    chips: React.ReactNode[] = [];
  const r = related(path);
  for (const [side, paths] of [
    ['right', r.imports],
    ['left', r.usedBy],
  ] as const) {
    let row = 0;
    for (const p of paths) {
      const f = S.FILES.get(p);
      if (!f) continue;
      const c = { l: f.x * s + x, t: f.y * s + y, w: CW * s, h: CH * s };
      const onScreen =
        c.l >= 0 &&
        c.t >= 0 &&
        c.l + c.w <= W &&
        c.t + c.h <= H - 128 &&
        (c.l + c.w < box.left || c.l > box.left + box.width);
      const edge = side === 'right' ? box.left + box.width : box.left;
      if (onScreen) {
        const toX = c.l > edge ? c.l : c.l + c.w,
          cy = c.t + c.h / 2,
          fromY = Math.min(Math.max(cy, box.top + 24), box.top + box.height - 24),
          mid = (edge + toX) / 2;
        lines.push(
          <g key={p} className="rel" data-path={p} onClick={() => void openEditor(p)}>
            <path d={`M${edge} ${fromY}H${mid}V${cy}H${toX}`} />
            <rect x={c.l} y={c.t} width={c.w} height={c.h} rx={6} />
          </g>,
        );
        continue;
      }
      const room = side === 'right' ? W - edge : edge - sideInset(s);
      const top = box.top + 12 + row * 40;
      if (room < 120 || top > box.top + box.height - 40) continue;
      row++;
      const chipW = Math.min(SIDE, room) - 32,
        chipX = side === 'right' ? edge + 16 : edge - 16 - chipW;
      lines.push(<path key={p} d={`M${edge} ${top + 14}H${side === 'right' ? edge + 16 : edge - 16}`} />);
      chips.push(
        <button
          key={p}
          type="button"
          className="rel-chip absolute flex h-7 items-center gap-1.5 truncate rounded-md border bg-popover px-2 font-mono text-xs text-ink2 shadow-[var(--e1)] hover:text-foreground"
          style={{ left: chipX, top, width: chipW }}
          data-path={p}
          aria-label={`${side === 'right' ? 'Imports' : 'Used by'} ${p}. Open it`}
          title={p}
          onClick={() => void openEditor(p)}
        >
          <FileIcon kind={fileKind(f.name)} />
          <span className="truncate">{f.name}</span>
        </button>,
      );
    }
  }
  return (
    <>
      <svg id="editorLinks" className="pointer-events-none absolute inset-0 size-full overflow-visible">
        {lines}
      </svg>
      {chips}
    </>
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
          Open in
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

  // Expand: start over the card, then move to the editor's place. Opening another file from inside the
  // editor expands from that file's card.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el || !shown || !path) return;
    if (reduced()) return;
    el.style.transition = 'none';
    el.style.transform = fromCard(shown, frame(shown));
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
    el.style.transform = fromCard(shown, frame(shown));
    el.style.opacity = '0';
    shade.current!.style.opacity = '0';
    const t = setTimeout(done, DUR);
    return () => clearTimeout(t);
  }, [path, shown]);

  // The code editor, once the text is loaded: one per file, kept through the collapse. Its text follows the
  // saved text when there is no draft, as when watch mode or an agent changed the file.
  useEffect(() => {
    if (!path || ed.loading || !host.current) return;
    const text = drafts.get(path)?.text ?? ed.saved;
    if (cm.current && cm.current.path !== path) {
      cm.current.editor.view.destroy();
      cm.current = null;
    }
    if (!cm.current) {
      void import('../lib/editor').then(({ createEditor }) => {
        if (ed.path !== path || cm.current || !host.current) return;
        // It starts from the saved text, with a draft applied as one change, so undo goes back to the saved text.
        const editor = createEditor(host.current, ed.saved, !!editingBlocked(), {
          onChange: t => edited(path, t),
          onSelect: selectLines,
          onInstruct: instruct,
          onSave: () => void saveEditor(),
          onClose: closeEditor,
        });
        cm.current = { path, editor };
        if (text !== ed.saved) editor.view.dispatch({ changes: { from: 0, to: ed.saved.length, insert: text } });
        editor.view.focus();
        // Render again now that the code editor exists, so an agent's change shows inline at once.
        bump('editor');
      });
    } else if (cm.current.editor.view.state.doc.toString() !== text) {
      cm.current.editor.reset(text);
      cm.current.editor.setReadOnly(!!editingBlocked());
    }
  });

  useEffect(() => {
    cm.current?.editor.setReadOnly(!!blocked);
  }, [blocked]);

  // An agent's change to lines of this file shows inline until it is kept or reverted; a draft hides it.
  const review = path && !drafts.has(path) ? reviewRun(path) : null;
  const shownDiff = useRef('');
  useEffect(() => {
    const key = review && path ? `${review.id}|${ed.saved}` : '';
    if (!cm.current || key === shownDiff.current) return;
    shownDiff.current = key;
    cm.current.editor.showDiff(review && path ? inlineDiff(review, path) : null);
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
    b = frame(shown);
  return (
    <div id="editorLayer" className="absolute inset-0">
      <div
        ref={shade}
        className="absolute inset-0 bg-canvas/75 transition-opacity duration-200"
        onPointerDown={closeEditor}
      />
      {path ? <Related path={shown} box={b} /> : null}
      <section
        id="editor"
        ref={panel}
        role="dialog"
        aria-label={`Editing ${name}`}
        className="absolute flex origin-top-left flex-col overflow-hidden rounded-xl border bg-card shadow-[var(--e2)] will-change-transform"
        style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
        onKeyDown={e => {
          if (e.key === 'Escape') closeEditor();
        }}
      >
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <FileIcon kind={fileKind(name)} />
          <span className="shrink-0 font-mono text-[13px] font-medium whitespace-nowrap">{name}</span>
          {dirty ? <span className="dirty size-2 rounded-full bg-mod" aria-label="Unsaved changes" /> : null}
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{shown}</span>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {blocked ? (
              <span id="editorBlocked" className="text-xs text-ink2">
                {`Run ${blocked.id} is working. Editing waits until it finishes.`}
              </span>
            ) : null}
            {S.repoRoot ? <OpenIn path={shown} line={() => cursorLine(cm.current?.editor)} /> : null}
            {dirty && !blocked ? (
              <Button variant="ghost" size="sm" id="discardDraft" onClick={discardDraft}>
                Discard changes
              </Button>
            ) : null}
            <Tip label="Save" keys="⌘S">
              <Button
                size="sm"
                id="saveFile"
                disabled={!dirty || !!blocked || ed.saving}
                onClick={() => void saveEditor()}
              >
                {ed.saving ? <Spinner className="text-current" /> : null}
                Save
              </Button>
            </Tip>
            <Tip label="Close" keys="Esc">
              <Button
                variant="ghost"
                size="icon-sm"
                id="closeEditor"
                aria-label="Close the editor"
                onClick={closeEditor}
              >
                <X />
              </Button>
            </Tip>
          </span>
        </header>
        {review ? (
          <div id="editorReview" className="flex shrink-0 items-center gap-3 border-b bg-card px-4 py-2">
            <span className="min-w-0 flex-1 text-ink2 text-pretty">
              {`${agentOf(review.agent).name} changed lines ${reviewLines(review, shown)}. Keep the change, or revert it.`}
            </span>
            <Button variant="outline" size="sm" id="rejectChange" onClick={() => runAction('revert', review)}>
              Revert
            </Button>
            <Button size="sm" id="acceptChange" onClick={() => runAction('keep', review)}>
              Keep
            </Button>
          </div>
        ) : null}
        {ed.conflict ? (
          <div id="editorConflict" className="shrink-0 border-b border-l-2 border-l-mod bg-card px-4 py-3">
            <div className="font-medium">This file changed on disk since you opened it</div>
            <p className="text-ink2">Saving now would replace these lines with yours:</p>
            <DiskChange before={ed.saved} now={ed.conflict.text} />
            <div className="mt-3 flex gap-2">
              <Button variant="outline" size="sm" id="useDisk" onClick={useDiskVersion}>
                Use the file on disk
              </Button>
              <Button size="sm" id="overwrite" onClick={() => void saveEditor(true)}>
                Save mine anyway
              </Button>
            </div>
          </div>
        ) : null}
        {ed.loading ? (
          <div className="flex flex-1 items-center justify-center text-ink2">
            <Spinner />
          </div>
        ) : null}
        <div ref={host} className="cm-host min-h-0 flex-1" hidden={ed.loading} />
      </section>
    </div>
  );
}
