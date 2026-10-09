// Sidebar: Files and Runs.
import { Bell, ChevronRight, Pin, Square } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { flyAll, flyDir, flyFile } from '../lib/camera';
import { agentOf } from '../lib/constants';
import { drawMap, filesPrint, footprintKey } from '../lib/minimap';
import { fileKind } from '../lib/fileKind';
import { dirStat, existsNow, fileStat, needsYou, runStats } from '../lib/model';
import type { DirNode, Run, Tab } from '../lib/types';
import { S, dom, st } from '../state/app';
import { drafts, openEditor } from '../state/editing';
import { panels, setPinned, sideVisibleAt } from '../state/panels';
import { isOffline, runAction, selectRun, stopSessions, toggleSel } from '../state/actions';
import { renderSel, renderSide, useRegion } from '../state/render';
import { endedAs, sessionColour, sessionsCost, workingRuns } from '../state/sessions';
import { money } from '../lib/util';
import { notifying, toggleNotifying } from '../state/notices';
import { cn } from '@/lib/utils';
import { BetaTag, CheckBadge, Dot, Stat } from './bits';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { FileIcon } from './FileIcon';
import { Tip } from './TopBar';
import { Button } from './ui/button';
import { t, tn } from '../i18n';

const row =
  'ti relative flex h-6 cursor-pointer items-center gap-1 pr-3 font-mono text-xs whitespace-nowrap text-foreground transition-colors outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset';
const selected =
  'sel bg-sel-soft hover:bg-sel-soft before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-sel';

/** Root, first-level folders, and every folder above a selected, current or changed file start expanded. */
function syncOpen() {
  const root = S.ROOT!;
  if (st.openRepo !== S.repoName) {
    st.openRepo = S.repoName;
    st.open = new Set(['', ...root.dirs.map(d => d.path)]);
    st.treeFocus = 'd:';
  }
  const reveal = [...st.sel].filter(k => !k.startsWith('d:'));
  if (st.cur) reveal.push(st.cur);
  if (st.run) reveal.push(...st.run.changes.keys());
  let added = false;
  for (const p of reveal)
    for (let d = S.FILES.get(p)?.dir ?? null; d; d = d.parent)
      if (!st.open.has(d.path)) {
        st.open.add(d.path);
        added = true;
      }
  return added;
}

/** A folder's chevron and icon. Empty folders get no chevron. */
const FolderMark = ({ open, empty }: { open: boolean; empty?: boolean }) => (
  <>
    {empty ? (
      <span className="size-3.5 shrink-0" />
    ) : (
      <ChevronRight
        data-toggle=""
        aria-hidden="true"
        className={cn('size-3.5 shrink-0 text-ink3 transition-transform duration-150', open && 'rotate-90')}
      />
    )}
    <FileIcon kind={open && !empty ? 'folder-open' : 'folder'} />
  </>
);

function tree(d: DirNode, depth: number): ReactNode[] {
  const h: ReactNode[] = [];
  const indent = (n: number) =>
    ({ paddingLeft: `${8 + n * 12}px`, '--depth': n }) as React.CSSProperties & Record<string, string | number>;
  for (const c of d.dirs) {
    const ds = st.run && dirStat(st.run, c),
      open = st.open.has(c.path),
      key = 'd:' + c.path,
      empty = !c.dirs.length && !c.files.length;
    h.push(
      <div
        key={key}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={empty ? undefined : open}
        aria-selected={st.sel.has(key)}
        tabIndex={st.treeFocus === key ? 0 : -1}
        className={cn(row, 'dir guides', st.sel.has(key) && selected)}
        data-dir={c.path}
        style={indent(depth)}
      >
        <FolderMark open={open} empty={empty} />
        <span className="nm max-w-full shrink-0 truncate">{c.name + '/'}</span>
        {c.note ? (
          <small className="min-w-0 truncate pl-1 font-sans text-[11px] text-muted-foreground">{c.note}</small>
        ) : null}
        {ds ? (
          <span className="ml-auto pl-2 text-[11px]">
            <Stat a={ds.a} d={ds.d} />
          </span>
        ) : null}
      </div>,
    );
    if (open) h.push(...tree(c, depth + 1));
  }
  for (const f of d.files) {
    const s = st.run && fileStat(st.run, f.path);
    if (!existsNow(f) && !s) continue;
    h.push(
      <div
        key={f.path}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={st.sel.has(f.path)}
        tabIndex={st.treeFocus === f.path ? 0 : -1}
        className={cn(
          row,
          'file guides',
          s && 'k-' + s.kind,
          st.sel.has(f.path) && selected,
          st.run && st.cur === f.path && 'cur',
        )}
        data-path={f.path}
        style={indent(depth)}
      >
        <span className="size-3.5 shrink-0" />
        <FileIcon kind={fileKind(f.name)} />
        <span className={cn('nm truncate', s?.kind === 'add' && 'text-add', s?.kind === 'mod' && 'text-mod')}>
          {f.name}
        </span>
        {drafts.has(f.path) ? (
          <span className="dirty size-1.5 shrink-0 rounded-full bg-mod" aria-label={t('Unsaved changes')} />
        ) : null}
        {s ? (
          <span className="ml-auto pl-2 text-[11px]">
            <Stat a={s.a} d={s.d} />
          </span>
        ) : null}
      </div>,
    );
  }
  return h;
}

const tag = 'rounded px-2 text-[11px] leading-[18px] whitespace-nowrap';

function RunRow({ r }: { r: Run }) {
  const s = runStats(r),
    a = agentOf(r.agent),
    running = r.status === 'running',
    status = r.reverted ? t('Reverted') : (endedAs(r) ?? (needsYou(r) ? t('Needs you') : r.kept ? t('Kept') : null));
  const putBack = r.putBack?.filter(k => !k.restored).length ?? 0;
  // A session at work is marked in the colour its section has on the map.
  const zone = running && workingRuns().includes(r) ? sessionColour(r) : null;
  return (
    <div
      data-run={r.id}
      style={zone ? ({ '--zone': zone } as React.CSSProperties) : undefined}
      // A run at work opens once it ends; until then its card isn't a control, and its stop button is.
      role={running ? undefined : 'button'}
      tabIndex={running ? undefined : 0}
      aria-pressed={running ? undefined : st.run === r}
      onKeyDown={e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.click();
      }}
      className={cn(
        'run grid grid-cols-[64px_minmax(0,1fr)] gap-3 border-b px-3 py-2 transition-colors outline-none',
        !running &&
          'cursor-pointer hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset active:bg-accent',
        zone && 'shadow-[inset_3px_0_0_var(--zone)]',
        st.run === r && 'sel bg-sel-soft shadow-[inset_2px_0_0_var(--sel)] hover:bg-sel-soft',
        running && 'running',
      )}
    >
      <canvas data-fp={r.id} aria-hidden="true" className="h-11 w-16 rounded-md bg-card ring-1 ring-border" />
      <div className="min-w-0">
        <div className="flex items-start gap-1">
          <div className="t min-w-0 flex-1 leading-snug font-medium text-pretty [overflow-wrap:anywhere]">
            {r.title}
          </div>
          {running ? (
            <Tip label={t('Stop run {id}', { id: r.id })}>
              <Button
                variant="ghost"
                size="icon-xs"
                data-stop
                aria-label={t('Stop run {id}', { id: r.id })}
                disabled={isOffline()}
                className="-mt-0.5 -mr-1 shrink-0 text-ink2"
                onClick={() => void runAction('cancel', r)}
              >
                <Square className="size-3 fill-current" />
              </Button>
            </Tip>
          ) : null}
        </div>
        <div className="m mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <Dot c={a.c} className={cn('size-1.5', running && 'animate-pulse')} />
          {/* The model is in the inspector; here, in the row's tooltip, so the time stays readable. */}
          <span className="truncate" title={r.model ? `${a.name} · ${r.model}` : undefined}>
            {running ? t('{agent} is working', { agent: a.name }) : `${a.name} · ${r.when}`}
          </span>
          {r.cost != null ? <span className="cost shrink-0 tabular-nums">{money(r.cost)}</span> : null}
          {/* While it works, the stop button takes the room: "Beta" shows once it ends. */}
          {a.beta && !running ? <BetaTag /> : null}
        </div>
        {running ? null : (
          <>
            {/* One line per idea: what changed, then tags that never break inside. */}
            <div className="m mt-1 flex items-center gap-2 text-xs whitespace-nowrap text-muted-foreground">
              {s.n ? (
                <>
                  <Stat a={s.a} d={s.d} />
                  <span>{tn(s.n, 'in {n} file', 'in {n} files')}</span>
                </>
              ) : (
                <span>{t('No changes')}</span>
              )}
            </div>
            {status || putBack || r.checks?.length || r.checksRunning ? (
              <div className="m tags mt-2 flex flex-wrap items-center gap-1">
                {status ? <span className={tag + ' bg-muted text-ink2'}>{status}</span> : null}
                {putBack ? (
                  <span className={tag + ' bg-muted text-ink2'}>
                    {tn(putBack, 'Put back {n} file', 'Put back {n} files')}
                  </span>
                ) : null}
                <CheckBadge r={r} />
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/** Selects a file or folder and flies to it, as a click on the canvas does; with add, toggles it in the scope. */
function pick(key: string, add: boolean) {
  if (add) {
    toggleSel(key, true);
    return;
  }
  st.sel.clear();
  st.sel.add(key);
  renderSel();
  if (!key.startsWith('d:')) flyFile(key);
  else if (key === 'd:') flyAll();
  else flyDir(key.slice(2));
}

const keyOf = (el: HTMLElement) => (el.dataset.path !== undefined ? el.dataset.path : 'd:' + el.dataset.dir);

/** Moves keyboard focus between rows without re-rendering the tree. */
function focusRow(tree: HTMLElement, el: HTMLElement | null | undefined) {
  if (!el) return;
  tree.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')?.setAttribute('tabindex', '-1');
  el.setAttribute('tabindex', '0');
  st.treeFocus = keyOf(el);
  el.focus();
  el.scrollIntoView({ block: 'nearest' });
}

function setOpen(path: string, open: boolean) {
  if (open) st.open.add(path);
  else st.open.delete(path);
  renderSide();
}

function onTreeKey(e: React.KeyboardEvent<HTMLDivElement>) {
  const tree = e.currentTarget,
    el = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
  if (!el) return;
  const rows = [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')],
    i = rows.indexOf(el),
    dir = el.dataset.dir,
    open = el.getAttribute('aria-expanded') === 'true';
  const parent = () => {
    const level = +(el.getAttribute('aria-level') ?? '1');
    for (let j = i - 1; j >= 0; j--) if (+(rows[j]!.getAttribute('aria-level') ?? '1') < level) return rows[j];
    return null;
  };
  const handled = (() => {
    switch (e.key) {
      case 'ArrowDown':
        return (focusRow(tree, rows[i + 1]), true);
      case 'ArrowUp':
        return (focusRow(tree, rows[i - 1]), true);
      case 'Home':
        return (focusRow(tree, rows[0]), true);
      case 'End':
        return (focusRow(tree, rows[rows.length - 1]), true);
      case 'ArrowRight':
        if (dir !== undefined && !open) setOpen(dir, true);
        else if (dir !== undefined) focusRow(tree, rows[i + 1]);
        return true;
      case 'ArrowLeft':
        if (dir !== undefined && open && dir !== '') setOpen(dir, false);
        else focusRow(tree, parent());
        return true;
      case 'Enter':
        // A file opens in the editor; a folder is selected and shown.
        if (el.dataset.path !== undefined && !e.shiftKey) return (void openEditor(el.dataset.path), true);
        return (pick(keyOf(el), e.shiftKey), true);
      default:
        return false;
    }
  })();
  if (handled) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function FileTree() {
  const rev = useRegion('side');
  const ref = useRef<HTMLDivElement>(null);
  // Expand to the selection, the file under review and the run's changes, then bring the row into view.
  useLayoutEffect(() => {
    if (!S.ROOT) return;
    if (syncOpen()) {
      renderSide();
      return;
    }
    const key = st.run && st.cur ? st.cur : [...st.sel].at(-1);
    if (!key) return;
    const target = ref.current!.querySelector<HTMLElement>(
      key.startsWith('d:') ? `[data-dir="${CSS.escape(key.slice(2))}"]` : `[data-path="${CSS.escape(key)}"]`,
    );
    target?.scrollIntoView({ block: 'nearest' });
  }, [rev]);
  useEffect(() => {
    const el = ref.current!;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element;
      const r = t.closest<HTMLElement>('[role="treeitem"]');
      if (!r) return;
      st.treeFocus = keyOf(r);
      if (r.dataset.dir !== undefined && t.closest('[data-toggle]')) {
        setOpen(r.dataset.dir, r.getAttribute('aria-expanded') !== 'true');
        return;
      }
      if (r.dataset.dir !== undefined) st.open.add(r.dataset.dir);
      // Shift or ⌘ adds to the scope (or removes from it), as on the canvas.
      pick(keyOf(r), e.shiftKey || e.metaKey);
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, []);
  const root = S.ROOT;
  if (root && st.openRepo !== S.repoName) syncOpen();
  return (
    <div role="tree" aria-label={t('Files')} ref={ref} onKeyDown={onTreeKey} className="pt-1">
      {root ? (
        <>
          <div
            role="treeitem"
            aria-level={1}
            aria-expanded
            aria-selected={st.sel.has('d:')}
            tabIndex={st.treeFocus === 'd:' ? 0 : -1}
            className={cn(row, 'dir', st.sel.has('d:') && selected)}
            data-dir=""
            style={{ paddingLeft: '8px' }}
          >
            <FolderMark open />
            <span className="nm truncate font-medium">{root.name + '/'}</span>
          </div>
          {tree(root, 1)}
        </>
      ) : null}
    </div>
  );
}

function RunList() {
  const rev = useRegion('side');
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const at = filesPrint();
    ref.current!.querySelectorAll<HTMLCanvasElement>('canvas[data-fp]').forEach(cv => {
      const run = S.RUNS.find(r => r.id === +(cv.dataset.fp ?? ''));
      const key = footprintKey(cv, run, at);
      if (cv.dataset.drawn === key) return;
      cv.dataset.drawn = key;
      drawMap(cv, run);
    });
  }, [rev]);
  useEffect(() => {
    const el = ref.current!;
    const onClick = (e: MouseEvent) => {
      const r = (e.target as Element).closest<HTMLElement>('[data-run]');
      if (!r) return;
      const run = S.RUNS.find(x => x.id === +(r.dataset.run ?? ''));
      if (run && run.status !== 'running') selectRun(st.run === run ? null : run);
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, []);
  const atWork = workingRuns().length;
  const cost = atWork ? sessionsCost() : null;
  return (
    <div ref={ref}>
      {atWork > 1 || cost?.counted ? (
        <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
          <span>{tn(atWork, '{n} session at work', '{n} sessions at work')}</span>
          {cost?.counted ? (
            <span
              id="sessionsCost"
              className="tabular-nums"
              title={
                cost.missing
                  ? tn(
                      cost.missing,
                      'Not counted: {n} session whose agent reports no cost, or not yet (Claude Code says it as it finishes).',
                      'Not counted: {n} sessions whose agents report no cost, or not yet (Claude Code says it as it finishes).',
                    )
                  : undefined
              }
            >
              {t('{cost} so far', { cost: money(cost.total) })}
            </span>
          ) : null}
          {atWork > 1 ? (
            <Button
              id="stopAll"
              variant="outline"
              size="xs"
              className="ml-auto"
              disabled={isOffline()}
              onClick={stopSessions}
            >
              {t('Stop all')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {S.RUNS.length ? (
        [...S.RUNS].reverse().map(r => <RunRow key={r.id} r={r} />)
      ) : (
        <div className="empty p-4 text-[13px] text-pretty text-muted-foreground">
          {S.LIVE && !Object.values(S.LIVE_AGENTS ?? {}).some(a => a.available)
            ? t('No runs yet. Edit any file and it shows up here.')
            : t('No runs yet. Select code on the canvas and describe a change.')}
        </div>
      )}
    </div>
  );
}

/** Notifications when a session finishes or needs you while you look elsewhere (state/notices.ts). */
function NotifyButton() {
  if (!S.CONN) return null;
  const on = notifying();
  return (
    <Tip label={on ? t('Stop notifying me') : t('Notify me when a session finishes or needs me')}>
      <Button
        variant="ghost"
        size="icon-sm"
        id="notifyBtn"
        aria-label={t('Notify me when a session finishes or needs me')}
        aria-pressed={on}
        className="shrink-0 text-ink3 aria-pressed:text-foreground"
        onClick={() => void toggleNotifying()}
      >
        {on ? <Bell className="fill-current" /> : <Bell />}
      </Button>
    </Tip>
  );
}

function PinButton() {
  const pinned = panels.side === 'pinned';
  return (
    <Tip label={pinned ? t('Let the sidebar step aside when zoomed out') : t('Keep the sidebar open')}>
      <Button
        variant="ghost"
        size="icon-sm"
        id="pinSide"
        aria-label={t('Keep the sidebar open')}
        aria-pressed={pinned}
        className="shrink-0 text-ink3 aria-pressed:text-foreground"
        onClick={() => setPinned(!pinned)}
      >
        {pinned ? <Pin className="fill-current" /> : <Pin />}
      </Button>
    </Tip>
  );
}

export function Sidebar() {
  useRegion('side');
  const away = !sideVisibleAt(st.v.s);
  // Floats over the canvas, so stepping aside moves only opacity and position (panels.ts keeps this in sync).
  return (
    <aside
      id="side"
      inert={away}
      className={cn(
        'z-10 col-start-1 row-start-2 flex min-h-0 w-(--side-w) flex-col border-r bg-panel transition-[opacity,translate] duration-200 ease-(--ease) max-[860px]:hidden [&.away]:-translate-x-3 [&.away]:opacity-0',
        away && 'away',
      )}
      ref={el => {
        if (el) dom.side = el;
      }}
    >
      <Tabs
        value={st.tab}
        onValueChange={v => {
          st.tab = v as Tab;
          renderSide();
        }}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="flex items-center gap-1 p-2">
          <TabsList className="flex-1">
            <TabsTrigger value="files" data-tab="files" className="flex-1">
              {t('Files')}
            </TabsTrigger>
            <TabsTrigger value="runs" data-tab="runs" className="flex-1 gap-2">
              {t('Runs')}
              <span id="runCount" className="num text-muted-foreground tabular-nums">
                {S.RUNS.length || ''}
              </span>
            </TabsTrigger>
          </TabsList>
          <NotifyButton />
          <PinButton />
        </div>
        <div id="sideList" className="min-h-0 flex-1 overflow-auto pb-4">
          <TabsContent value="files">
            <FileTree />
          </TabsContent>
          <TabsContent value="runs">
            <RunList />
          </TabsContent>
        </div>
      </Tabs>
    </aside>
  );
}
