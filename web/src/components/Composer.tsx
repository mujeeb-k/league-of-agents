// Floating composer: scope chips, agent picker, prompt. Built on shadcn/ui.
import { ArrowUp, ChevronDown } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { agentOf } from '../lib/constants';
import { examplePrompt } from '../lib/examplePrompt';
import { DEMO_AGENTS, DEMO_STAYS } from '../demo/sample';
import { S, dom, st } from '../state/app';
import { eachSection, followTarget, isOffline, selectRun, send, sendEach } from '../state/actions';
import type { Run } from '../lib/types';
import { cn } from '@/lib/utils';
import { clearLines, ed, rangeScope, staleSelection } from '../state/editing';
import { renderComposer, renderSel, useRegion } from '../state/render';
import { reachOf } from '../state/sessions';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Textarea } from './ui/textarea';
import { BetaTag, Dot, Spinner } from './bits';
import { Tip } from './TopBar';
import { CopyCommand } from './ConnectDialog';
import { ScopeChip } from './ScopeChip';
import { t } from '../i18n';

function ScopeRow() {
  const root = S.ROOT;
  // Lines selected in the editor narrow the file to those lines.
  const range = rangeScope();
  const items = [...st.sel].map(k =>
    k.startsWith('d:')
      ? { k, label: (k.slice(2) || root?.name || '') + '/' }
      : { k, label: (S.FILES.get(k)?.name || k) + (range ? `:${range.split(':').pop()!.replace('-', '–')}` : '') },
  );
  const fu = followTarget();
  // Nothing selected, a follow-up works on its session's own section (actions.ts send).
  const from = !items.length && fu?.scope?.length ? fu.scope : null;
  return (
    <>
      <span className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">{t('Scope')}</span>
      {from ? (
        from.map(s => <ScopeChip key={s} label={s} className="from" title={t('Run {id}’s section', { id: fu!.id })} />)
      ) : items.length ? (
        items.map(i => (
          <ScopeChip
            key={i.k}
            label={range && ed.stale ? `${i.label} · ${ed.stale}` : i.label}
            tone={range && ed.stale ? 'stale' : 'scope'}
            title={
              range && ed.stale && ed.path ? staleSelection(ed.path) : (range ?? (i.k.replace(/^d:/, '') || root?.name))
            }
            removeLabel={
              range && ed.stale ? t('Clear the selected lines') : t('Remove {name} from scope', { name: i.label })
            }
            removeData={{ 'data-unsel': i.k }}
            onRemove={() => {
              // Lines that changed or were removed clear in one click, leaving their file in scope.
              if (range && ed.stale) return clearLines();
              st.sel.delete(i.k);
              renderSel();
            }}
          />
        ))
      ) : (
        <ScopeChip label={t('Whole repository')} tone="neutral" className="all font-sans" />
      )}
      <FollowChip fu={fu} />
    </>
  );
}

/**
 * Which session a prompt replies to: the open run's, or a new one. With several sessions, the menu lists the ones a
 * prompt can continue (finished, not reverted, their agent here), newest first, to switch between.
 */
function FollowChip({ fu }: { fu: Run | null }) {
  const runs = S.LIVE
    ? S.RUNS.filter(r => r.status !== 'running' && !r.reverted && r.sessionId && S.LIVE_AGENTS?.[r.agent]?.available)
        .reverse()
        .slice(0, 8)
    : [];
  if (!runs.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          id="followChip"
          title={fu ? t('Continues the same {agent} session', { agent: agentOf(fu.agent).name }) : undefined}
          className={cn(
            'chip inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-muted px-2 font-mono text-xs text-ink2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
            fu ? 'fu' : 'new',
          )}
        >
          <span className="truncate">{fu ? t('Follow-up to run {id}', { id: fu.id }) : t('New session')}</span>
          <ChevronDown className="size-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent id="followMenu" align="start" side="top" sideOffset={8} className="w-80">
        {runs.map(r => (
          <DropdownMenuItem
            key={r.id}
            data-follow={r.id}
            className="gap-2"
            onSelect={() => {
              st.agent = r.agent;
              st.noFollow = null;
              selectRun(r, false);
            }}
          >
            <Dot c={agentOf(r.agent).c} />
            <span className="truncate">
              {t('Run {id} · {agent}', { id: r.id, agent: agentOf(r.agent).name })} · {r.title}
            </span>
          </DropdownMenuItem>
        ))}
        {fu ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-follow="new"
              onSelect={() => {
                st.noFollow = fu.id;
                renderComposer();
              }}
            >
              {t('Start a new session instead')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AgentPicker() {
  const a = agentOf(st.agent);
  const keys =
    S.CONN && S.LIVE_AGENTS ? Object.keys(S.LIVE_AGENTS).filter(k => S.LIVE_AGENTS![k]!.available) : DEMO_AGENTS;
  // No agent on this machine: the prompt says so, and there is nothing to pick.
  if (!keys.length) return null;
  // Found, its check still running (a few seconds after the bridge starts): listed, and not yet to pick.
  const checking = S.CONN && S.LIVE_AGENTS ? Object.keys(S.LIVE_AGENTS).filter(k => S.LIVE_AGENTS![k]!.checking) : [];
  // Claude Code installed elsewhere but not runnable here: listed, with why.
  const claudeOff = S.CONN ? S.LIVE_AGENTS?.claude?.problem : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          id="agentBtn"
          disabled={!S.ROOT || isOffline()}
          className="shrink-0 gap-2 px-2 text-ink2"
        >
          <Dot c={a.c} />
          {a.name}
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent id="agentMenu" align="end" side="top" sideOffset={8} className="w-64">
        <DropdownMenuRadioGroup
          value={st.agent}
          onValueChange={v => {
            st.agent = v;
            renderComposer();
          }}
        >
          {keys.map(k => {
            const v = agentOf(k);
            return (
              <DropdownMenuRadioItem key={k} value={k} data-agent={k} className="gap-2">
                <Dot c={v.c} />
                {v.name}
                {v.beta ? (
                  <span className="ml-auto">
                    <BetaTag />
                  </span>
                ) : null}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        {checking.map(k => (
          <div key={k} data-checking={k} className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
            <Dot c={agentOf(k).c} />
            {agentOf(k).name}
            <span className="ml-auto text-xs">{t('Checking…')}</span>
          </div>
        ))}
        {claudeOff ? (
          <div id="claudeOff" className="flex flex-col gap-1 px-2 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-2 text-sm">
              <Dot c={agentOf('claude').c} />

              {t('Claude Code')}
              <span className="ml-auto text-xs">
                {claudeOff === 'missing' ? t('Not installed') : t('Not logged in')}
              </span>
            </span>
            <code className="font-mono">{claudeFix()[claudeOff].command}</code>
          </div>
        ) : null}
        <DropdownMenuSeparator />
        <p className="px-2 py-2 text-xs text-muted-foreground">
          {S.CONN
            ? t('Agents found on this machine. Changes made in any editor or other agent show up as runs on their own.')
            : t('Demo data. Connect a repo to run real agents.')}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Why Claude Code can't run here, and the command that fixes it: worded when shown, in the language then set. */
const claudeFix = () => ({
  missing: {
    title: t("Claude Code isn't installed"),
    body: t('Install it to run it from here. Changes from any editor still show up as runs.'),
    command: 'curl -fsSL https://claude.ai/install.sh | bash',
  },
  loggedOut: {
    title: t("Claude Code isn't logged in"),
    body: t('Log in from a terminal. This clears on its own once you have.'),
    command: 'claude auth login',
  },
});

/** Claude Code can't run and no other agent can: what to do about it, instead of a prompt that can't send. */
function ClaudeProblem({ problem }: { problem: 'missing' | 'loggedOut' }) {
  const fix = claudeFix()[problem];
  return (
    <div id="claudeProblem" data-problem={problem} className="px-1 pb-2">
      <p className="text-[13px] font-medium">{fix.title}</p>
      <p className="mt-1 mb-2 text-xs text-muted-foreground text-pretty">{fix.body}</p>
      <CopyCommand ids={['claudeFix', 'copyClaudeFix']} text={fix.command} command />
    </div>
  );
}

/**
 * Before a connected repo's first run: how to start, and an example prompt for the selected file to try. It
 * goes away once the repo has a run.
 */
function FirstRun() {
  const example = examplePrompt([...st.sel]);
  const use = (text: string) => {
    dom.prompt.value = text;
    dom.prompt.dispatchEvent(new Event('input', { bubbles: true }));
    dom.prompt.focus();
  };
  return (
    <div id="firstRun" className="flex min-w-0 items-center gap-2 px-1 pb-2 text-xs text-muted-foreground">
      {example ? (
        <>
          <span className="shrink-0">{t('Try')}</span>
          <button
            type="button"
            id="firstRunExample"
            onClick={() => use(example)}
            className="min-w-0 truncate rounded-md border px-2 py-1 text-left text-ink2 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            {example}
          </button>
        </>
      ) : (
        <span>{t('Select a file, then describe a change.')}</span>
      )}
    </div>
  );
}

export function Composer() {
  useRegion('composer');
  useRegion('conn');
  // Written with the send button's state, which the input handler sets without a render.
  const eachBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prompt = dom.prompt,
      sendBtn = dom.sendBtn;
    const onInput = () => {
      sendBtn.disabled = !prompt.value.trim() || (!!rangeScope() && !!ed.stale);
      if (eachBtn.current) eachBtn.current.disabled = sendBtn.disabled;
      prompt.style.height = 'auto';
      prompt.style.height = Math.min(120, prompt.scrollHeight) + 'px';
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        // ⌘↵ with several sections selected: a session on each.
        void ((e.metaKey || e.ctrlKey) && eachSection() ? sendEach() : send());
      }
    };
    prompt.addEventListener('input', onInput);
    prompt.addEventListener('keydown', onKey);
    return () => {
      prompt.removeEventListener('input', onInput);
      prompt.removeEventListener('keydown', onKey);
    };
  }, []);

  const claudeProblem =
    S.LIVE && S.LIVE_AGENTS && !Object.values(S.LIVE_AGENTS).some(a => a.available)
      ? (S.LIVE_AGENTS.claude?.problem ?? null)
      : null;
  // Nothing to run against: connecting or not yet connected, the bridge is offline, or no agent is installed.
  const blocked = claudeProblem
    ? claudeProblem === 'missing'
      ? t('Install Claude Code to run it from here')
      : t('Log in to Claude Code to run it from here')
    : !S.ROOT
      ? t('Connect a repo to run agents')
      : isOffline()
        ? t('Reconnect to run agents')
        : S.LIVE && !S.LIVE_AGENTS?.[st.agent]?.available
          ? t('No agent found. Changes made in any editor still show up as runs.')
          : null;
  const placeholder = blocked ?? t('Describe a change');
  // Written on every render, as renderComposer() did. The input handler also writes it directly,
  // so a React prop would go stale (React only writes props that changed since its last render).
  // Selected lines that changed under the selection: nothing runs on them until they are selected again.
  const stale = !!rangeScope() && ed.stale && ed.path ? staleSelection(ed.path) : null;
  useLayoutEffect(() => {
    dom.sendBtn.disabled = !!blocked || !!stale || st.busy === 'send' || !dom.prompt.value.trim();
    if (eachBtn.current) eachBtn.current.disabled = dom.sendBtn.disabled;
  });
  const each = !blocked && eachSection();
  const stays = S.CONN ? S.LIVE_AGENTS?.[st.agent]?.stays : DEMO_STAYS.includes(st.agent);
  return (
    <div
      id="composer"
      className="pointer-events-auto absolute bottom-4 left-[calc((100%-var(--map))/2)] w-[min(600px,calc(100%-var(--side-w)-var(--map)-24px))] min-w-[280px] -translate-x-1/2 rounded-2xl border bg-popover p-2 shadow-[var(--e2)] [--map:248px] max-[1280px]:[--map:192px] max-[860px]:right-3 max-[860px]:bottom-3 max-[860px]:left-3 max-[860px]:w-auto max-[860px]:min-w-0 max-[860px]:translate-x-0"
    >
      <div className="flex items-start gap-2 pb-2">
        <div id="scopeRow" className="flex min-h-8 min-w-0 flex-1 flex-wrap items-center gap-2">
          {S.ROOT ? <ScopeRow /> : null}
        </div>
        <AgentPicker />
      </div>
      {/* With a selection: whether the agent picked stays inside it. */}
      {!blocked && st.sel.size && stays !== undefined ? (
        <p id="reach" className="px-1 pb-2 text-right text-xs text-muted-foreground text-pretty">
          {reachOf(stays)}
        </p>
      ) : null}
      {claudeProblem ? <ClaudeProblem problem={claudeProblem} /> : null}
      {stale ? (
        <p id="staleSelection" role="status" className="px-1 pb-2 text-xs text-ink2 text-pretty">
          {stale}
        </p>
      ) : null}
      {/* With nothing selected, a prompt runs on the whole repository: say so, and how to narrow it. */}
      {blocked ? null : !st.sel.size ? (
        <p id="selectHint" className="px-1 pb-2 text-xs text-muted-foreground text-pretty">
          {t('Select a file or lines on the map, or describe a change for the whole repository.')}
        </p>
      ) : S.LIVE && !S.RUNS.length ? (
        <FirstRun />
      ) : null}
      <div className="flex items-end gap-2 rounded-lg bg-muted py-1 pr-1 pl-3 focus-within:ring-2 focus-within:ring-ring/40">
        <Textarea
          id="prompt"
          disabled={!!blocked}
          rows={1}
          placeholder={placeholder}
          className="max-h-[120px] min-h-8 flex-1 resize-none rounded-none border-0 bg-transparent px-0 py-2 leading-5 shadow-none [field-sizing:fixed] focus-visible:ring-0 dark:bg-transparent disabled:cursor-not-allowed disabled:opacity-100"
          ref={el => {
            if (el) dom.prompt = el;
          }}
        />
        {each ? (
          <Tip label={t('Start a session on each of the {n} sections', { n: each.length })} keys="⌘↵">
            <Button variant="ghost" size="sm" id="eachBtn" ref={eachBtn} onClick={() => void sendEach()}>
              {t('A session each')}
            </Button>
          </Tip>
        ) : null}
        <Tip label={t('Run')} keys="↵">
          <Button
            size="icon-sm"
            id="sendBtn"
            aria-label={t('Run agent')}
            onClick={() => void send()}
            ref={el => {
              if (el) dom.sendBtn = el;
            }}
          >
            {st.busy === 'send' ? <Spinner className="text-current" /> : <ArrowUp />}
          </Button>
        </Tip>
      </div>
    </div>
  );
}
