// ⌘P quick open and the ⌘K command menu, on shadcn's Command (cmdk).
import {
  CircleCheck,
  Columns2,
  FileSearch,
  Focus,
  FolderOpen,
  GitCommitHorizontal,
  LayoutGrid,
  Users,
  Maximize,
  MessageSquareText,
  Monitor,
  Moon,
  PanelLeft,
  PanelRight,
  Pin,
  RefreshCw,
  Sun,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { connect, disconnect } from '../api/live';
import { flyAll, flyFile, flyRun, flySelection, viewCenter, zoomAt } from '../lib/camera';
import { agentOf } from '../lib/constants';
import { fileKind } from '../lib/fileKind';
import { searchFiles } from '../lib/fileSearch';
import { existsNow } from '../lib/model';
import { S, dom, st } from '../state/app';
import { showExport } from './ExportDialog';
import { runAction, selectRun, setMode, tidyLayout, toggleByAuthor } from '../state/actions';
import { panels, setPinned, toggleInsp, toggleSide } from '../state/panels';
import { bump, renderSel, useRegion } from '../state/render';
import { setTheme } from '../state/theme';
import { Dot } from './bits';
import { setConnectOpen } from './ConnectDialog';
import { FileIcon } from './FileIcon';
import { retheme } from './TopBar';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from './ui/command';
import { Kbd } from './ui/kbd';

let returnFocus: HTMLElement | null = null;
export function openPalette(kind: 'files' | 'commands') {
  if (!st.palette) returnFocus = document.activeElement as HTMLElement | null;
  st.palette = kind;
  bump('palette');
}
function close() {
  st.palette = null;
  bump('palette');
}
/** Closes the menu, then runs the command, so focus and rendering settle first. */
const run = (f: () => void) => () => {
  close();
  f();
};

function goToFile(path: string) {
  st.sel.clear();
  st.sel.add(path);
  renderSel();
  flyFile(path);
}

function QuickOpen() {
  const [query, setQuery] = useState('');
  const files = useMemo(() => [...S.FILES.values()].filter(existsNow), []);
  // Ranked here and capped, so 1,000-file repos stay fast; cmdk only handles the keyboard.
  const shown = useMemo(() => searchFiles(files, query), [files, query]);
  return (
    <>
      <CommandInput autoFocus placeholder="Go to a file" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No file matches.</CommandEmpty>
        <CommandGroup heading={query ? 'Best matches' : 'Files'}>
          {shown.map(f => (
            <CommandItem key={f.path} value={f.path} data-path={f.path} onSelect={run(() => goToFile(f.path))}>
              <FileIcon kind={fileKind(f.name)} />
              <span className="font-mono text-xs">{f.name}</span>
              <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{f.dir.path}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </>
  );
}

const Item = ({
  label,
  icon,
  keys,
  onSelect,
  stay,
}: {
  label: string;
  icon?: ReactNode;
  keys?: string;
  onSelect: () => void;
  /** Keep the menu open, for commands that switch what it shows. */
  stay?: boolean;
}) => (
  <CommandItem value={label} onSelect={stay ? onSelect : run(onSelect)}>
    {icon}
    {label}
    {keys ? (
      <CommandShortcut>
        <Kbd>{keys}</Kbd>
      </CommandShortcut>
    ) : null}
  </CommandItem>
);

const zoom = (f: number) => zoomAt(...viewCenter(), f);

function Commands() {
  const r = st.run;
  return (
    <>
      <CommandInput autoFocus placeholder="Type a command" />
      <CommandList>
        <CommandEmpty>No command matches.</CommandEmpty>
        <CommandGroup heading="Go to">
          <Item label="Go to a file" icon={<FileSearch />} keys="⌘P" stay onSelect={() => openPalette('files')} />
          <Item label="Fit everything" icon={<Maximize />} keys="0" onSelect={flyAll} />
          <Item
            label="Zoom to selection"
            icon={<Focus />}
            keys="F"
            onSelect={() => (st.sel.size ? flySelection() : r ? flyRun(r) : flyAll())}
          />
          <Item label="Zoom in" icon={<ZoomIn />} keys="+" onSelect={() => zoom(1.4)} />
          <Item label="Zoom out" icon={<ZoomOut />} keys="−" onSelect={() => zoom(1 / 1.4)} />
          <Item label="Tidy layout" icon={<LayoutGrid />} onSelect={tidyLayout} />
          <Item
            label={st.byAuthor ? 'Stop coloring by author' : 'Color by author'}
            icon={<Users />}
            keys="C"
            onSelect={toggleByAuthor}
          />
          <Item label="Write a prompt" icon={<MessageSquareText />} keys="/" onSelect={() => dom.prompt.focus()} />
        </CommandGroup>
        {r ? (
          <CommandGroup heading={`Run ${r.id}`}>
            <Item label="Show before" icon={<Columns2 />} keys="B" onSelect={() => setMode('before')} />
            <Item label="Show after" icon={<Columns2 />} keys="A" onSelect={() => setMode('after')} />
            <Item label="Show diff" icon={<Columns2 />} keys="D" onSelect={() => setMode('diff')} />
            {r.changes.size && !r.reverted && r.status !== 'running' ? (
              <>
                {r.kept ? null : <Item label="Keep run" icon={<CircleCheck />} onSelect={() => runAction('keep', r)} />}
                <Item label="Revert run" icon={<Undo2 />} onSelect={() => runAction('revert', r)} />
              </>
            ) : null}
            <Item label="Close run" icon={<X />} keys="Esc" onSelect={() => selectRun(null)} />
          </CommandGroup>
        ) : null}
        {S.CONN ? (
          <CommandGroup heading="Attribution">
            <Item
              label="Write attribution for the last commit as Agent Trace"
              icon={<GitCommitHorizontal />}
              onSelect={() => showExport('agent-trace')}
            />
            <Item
              label="Write attribution for the last commit as a Git AI note"
              icon={<GitCommitHorizontal />}
              onSelect={() => showExport('git-ai')}
            />
          </CommandGroup>
        ) : null}
        {S.RUNS.length ? (
          <CommandGroup heading="Runs">
            {[...S.RUNS].reverse().map(x => (
              <Item
                key={x.id}
                label={`Open run ${x.id}: ${x.title}`}
                icon={<Dot c={agentOf(x.agent).c} className="mx-1" />}
                onSelect={() => selectRun(x)}
              />
            ))}
          </CommandGroup>
        ) : null}
        <CommandGroup heading="Panels">
          <Item label="Show or hide the sidebar" icon={<PanelLeft />} keys="[" onSelect={toggleSide} />
          <Item label="Show or hide the inspector" icon={<PanelRight />} keys="]" onSelect={toggleInsp} />
          <Item
            label={panels.side === 'pinned' ? 'Let the sidebar step aside when zoomed out' : 'Keep the sidebar open'}
            icon={<Pin />}
            onSelect={() => setPinned(panels.side !== 'pinned')}
          />
        </CommandGroup>
        <CommandGroup heading="Theme">
          <Item label="Light theme" icon={<Sun />} onSelect={() => (setTheme('light'), retheme())} />
          <Item label="Dark theme" icon={<Moon />} onSelect={() => (setTheme('dark'), retheme())} />
          <Item label="Match the system theme" icon={<Monitor />} onSelect={() => (setTheme('system'), retheme())} />
        </CommandGroup>
        <CommandGroup heading="Bridge">
          {S.CONN ? (
            <>
              {S.LIVE ? null : <Item label="Reconnect" icon={<RefreshCw />} onSelect={() => void connect(S.CONN!)} />}
              <Item label="Disconnect" icon={<X />} onSelect={disconnect} />
            </>
          ) : (
            <Item label="Connect a repo" icon={<FolderOpen />} onSelect={() => setConnectOpen(true)} />
          )}
        </CommandGroup>
      </CommandList>
    </>
  );
}

export function Palette() {
  useRegion('palette');
  const kind = st.palette;
  return (
    <CommandDialog
      open={kind !== null}
      onOpenChange={open => {
        if (!open) close();
      }}
      title={kind === 'files' ? 'Go to a file' : 'Commands'}
      description={kind === 'files' ? 'Search the repository by file name or path' : 'Search for a command to run'}
      showCloseButton={false}
      commandProps={{ shouldFilter: kind !== 'files' }}
      className="top-[18%] translate-y-0 sm:max-w-xl"
      contentProps={{
        id: 'palette',
        onCloseAutoFocus: e => {
          // Opened by a shortcut, not a trigger, so return focus where it was.
          e.preventDefault();
          if (returnFocus?.isConnected) returnFocus.focus();
        },
      }}
    >
      {kind === 'files' ? <QuickOpen key="files" /> : kind === 'commands' ? <Commands key="commands" /> : null}
    </CommandDialog>
  );
}
