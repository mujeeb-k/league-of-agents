// Top bar: brand, repo and branch, the run bar with Before, After and Diff, connection and theme.
// Built on shadcn/ui.
import { Moon, PanelLeft, PanelRight, Sun, Users, X } from 'lucide-react';
import { connect, disconnect } from '../api/live';
import { agentOf } from '../lib/constants';
import { cn } from '../lib/utils';
import { drawMini, readCss } from '../lib/minimap';
import type { Mode } from '../lib/types';
import { S, dom, st } from '../state/app';
import { selectRun, setMode, toggleByAuthor } from '../state/actions';
import { renderSide, useRegion } from '../state/render';
import { panels, sideVisibleAt, toggleInsp, toggleSide } from '../state/panels';
import { toggleTheme, useResolvedTheme } from '../state/theme';
import { setConnectOpen } from './ConnectDialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Kbd } from './ui/kbd';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { Dot, Spinner } from './bits';

export const retheme = () => {
  readCss();
  drawMini();
  renderSide();
};

/** A tooltip naming what a control does and its shortcut. */
export function Tip({ label, keys, children }: { label: string; keys?: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        {label}
        {keys ? <Kbd>{keys}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}

const MODES: { mode: Mode; label: string; key: string }[] = [
  { mode: 'before', label: 'Before', key: 'B' },
  { mode: 'after', label: 'After', key: 'A' },
  { mode: 'diff', label: 'Diff', key: 'D' },
];

function RunBar() {
  useRegion('top');
  const r = st.run;
  if (!r)
    return !S.ROOT ? (
      <div id="runbar" className="flex-1" />
    ) : (
      <div
        id="runbar"
        className="flex min-w-0 flex-1 items-center justify-center gap-3 max-[700px]:order-last max-[700px]:basis-full"
      >
        <span className="quiet truncate text-muted-foreground">
          {st.byAuthor
            ? 'Latest state, colored by who wrote each line.'
            : 'Latest state. Open a run to compare before and after.'}
        </span>
        <Tip label={st.byAuthor ? 'Stop coloring by author' : 'Color by author'} keys="C">
          <Button
            variant={st.byAuthor ? 'secondary' : 'ghost'}
            size="sm"
            id="byAuthor"
            aria-pressed={st.byAuthor}
            className="shrink-0"
            onClick={toggleByAuthor}
          >
            <Users />
            By author
          </Button>
        </Tip>
      </div>
    );
  const a = agentOf(r.agent);
  const onMode = (m: string) => {
    if (m) setMode(m as Mode);
  };
  return (
    <div
      id="runbar"
      className="flex min-w-0 flex-1 items-center justify-center gap-3 max-[700px]:order-last max-[700px]:basis-full"
    >
      <div className="flex min-w-0 items-center gap-2 max-[700px]:mr-auto">
        <Dot c={a.c} />
        <b className="font-semibold whitespace-nowrap">{`Run ${r.id}`}</b>
        <span className="truncate text-ink2 max-[860px]:hidden">{r.title}</span>
      </div>
      <ToggleGroup
        type="single"
        value={st.mode}
        onValueChange={onMode}
        aria-label="Compare"
        spacing={2}
        className="shrink-0 gap-1 rounded-lg bg-muted p-1"
      >
        {MODES.map(m => (
          // The tooltip sits inside the item, so the toggle keeps its own state and arrow-key focus.
          <ToggleGroupItem
            key={m.mode}
            value={m.mode}
            data-mode={m.mode}
            className="h-7 rounded-md p-0 text-ink2 hover:bg-transparent hover:text-foreground aria-checked:bg-background aria-checked:text-foreground aria-checked:shadow-xs"
          >
            <Tip label={`Show ${m.label.toLowerCase()}`} keys={m.key}>
              <span className="flex h-full items-center gap-2 px-3">
                {m.label}
                <Kbd className="max-[1100px]:hidden">{m.key}</Kbd>
              </span>
            </Tip>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Tip label="Close run" keys="Esc">
        <Button
          variant="ghost"
          size="icon-sm"
          data-act="closeRun"
          aria-label="Close run"
          onClick={() => selectRun(null)}
        >
          <X />
        </Button>
      </Tip>
    </div>
  );
}

function Crumb() {
  useRegion('crumb');
  useRegion('conn');
  if (!S.repoName) return null;
  return (
    <div className="crumb flex min-w-0 items-center gap-2 whitespace-nowrap text-muted-foreground max-[860px]:hidden">
      <span aria-hidden="true">/</span>
      <b id="repoName" className="font-medium text-foreground">
        {S.repoName}
      </b>
      <span className="br font-mono text-xs text-ink2">{S.branch}</span>
    </div>
  );
}

function ConnControls() {
  useRegion('conn');
  const theme = useResolvedTheme();
  const offline = !!S.CONN && !S.LIVE,
    connecting = st.busy === 'connect' || st.starting;
  const onConnect = () => {
    if (S.LIVE) disconnect();
    else if (offline) void connect(S.CONN!);
    else setConnectOpen(true);
  };
  const onTheme = () => {
    toggleTheme();
    retheme();
  };
  const demo = !S.CONN && !connecting && !st.unreachable && !st.asking;
  return (
    <div className="flex shrink-0 items-center gap-2 max-[700px]:ml-auto">
      <Badge
        id="conn"
        variant="secondary"
        className={cn(
          S.LIVE ? 'gap-2 bg-add/12 font-normal text-add' : 'gap-2 bg-muted font-normal text-muted-foreground',
          // Under 700 px the demo's badge steps aside: the intro and the button say what this is.
          demo && 'max-[700px]:hidden',
        )}
        title={offline ? 'The bridge stopped answering. The last state stays on screen.' : undefined}
      >
        {connecting ? (
          <Spinner className="size-3 text-current" />
        ) : (
          <span
            className={
              'size-1.5 rounded-full ' +
              (S.LIVE ? 'bg-add' : offline || st.unreachable || st.asking ? 'bg-mod' : 'bg-muted-foreground')
            }
          />
        )}
        {S.LIVE
          ? 'Live'
          : offline
            ? 'Offline'
            : connecting
              ? 'Connecting'
              : st.unreachable || st.asking
                ? 'Not connected'
                : 'Demo'}
      </Badge>
      {/* While connecting, the badge says so; the button steps aside rather than repeat it. */}
      {connecting ? null : (
        <Button
          variant="outline"
          size="sm"
          id="connectBtn"
          onClick={onConnect}
          ref={el => {
            if (el) dom.connectBtn = el;
          }}
        >
          {/* In the demo, the button names the next step: connecting your own repo. */}
          {S.LIVE ? 'Disconnect' : offline ? 'Reconnect' : 'Try it on your code'}
        </Button>
      )}
      <Tip label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
        <Button variant="ghost" size="icon-sm" id="themeBtn" aria-label="Toggle theme" onClick={onTheme}>
          {theme === 'dark' ? <Sun /> : <Moon />}
        </Button>
      </Tip>
    </div>
  );
}

/** Show or hide the sidebar and the inspector. Pressed means shown. */
function PanelButtons() {
  useRegion('top');
  const side = sideVisibleAt(st.v.s);
  return (
    <div className="flex shrink-0 items-center max-[860px]:hidden">
      <Tip label={side ? 'Hide sidebar' : 'Show sidebar'} keys="[">
        <Button
          variant="ghost"
          size="icon-sm"
          id="sideBtn"
          aria-label="Sidebar"
          aria-pressed={side}
          className="text-ink3 aria-pressed:text-foreground"
          onClick={toggleSide}
        >
          <PanelLeft />
        </Button>
      </Tip>
      <Tip label={panels.insp ? 'Hide inspector' : 'Show inspector'} keys="]">
        <Button
          variant="ghost"
          size="icon-sm"
          id="inspBtn"
          aria-label="Inspector"
          aria-pressed={panels.insp}
          className="text-ink3 aria-pressed:text-foreground"
          onClick={toggleInsp}
        >
          <PanelRight />
        </Button>
      </Tip>
    </div>
  );
}

export function TopBar() {
  return (
    <header
      id="top"
      className="col-span-full flex h-12 min-w-0 items-center gap-3 border-b bg-background px-3 max-[700px]:h-auto max-[700px]:flex-wrap max-[700px]:gap-y-1.5 max-[700px]:py-1.5"
    >
      {/* The mark and wordmark reload the page, as a site's logo does. */}
      <Tip label="Reload">
        <a
          href="./"
          id="brand"
          onClick={e => {
            e.preventDefault();
            location.reload();
          }}
          className="flex shrink-0 items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <img src="./brand/mark-80.png" width={26} height={26} alt="" className="rounded-[6px]" />
          {/* The wordmark in deeper purples on the light theme, where its own pale ones wash out. */}
          <img
            src="./brand/wordmark-on-light-60.png"
            srcSet="./brand/wordmark-on-light-60.png 2x, ./brand/wordmark-on-light-90.png 3x"
            width={66}
            height={30}
            alt="League of Agents"
            className="dark:hidden max-[700px]:hidden"
          />
          <img
            src="./brand/wordmark-60.png"
            srcSet="./brand/wordmark-60.png 2x, ./brand/wordmark-90.png 3x"
            width={66}
            height={30}
            alt="League of Agents"
            className="hidden dark:block max-[700px]:dark:hidden"
          />
        </a>
      </Tip>
      <Crumb />
      <RunBar />
      <PanelButtons />
      <ConnControls />
    </header>
  );
}
