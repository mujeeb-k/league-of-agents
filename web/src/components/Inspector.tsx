// Inspector: the open run, the selected file, or the repo. Built on shadcn/ui.
import { EDITORS, editorUrl } from '../lib/openIn';
import {
  Check,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Hand,
  Minus,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { enableChecks, restorePutBack, turnOffCheck } from '../api/live';
import { flyFile } from '../lib/camera';
import { shareOf, type Author, type Owner } from '../lib/attribution';
import { runsRepoCode } from '../lib/checks';
import { agentOf, modelOf } from '../lib/constants';
import { existsNow, fileStat, linesAt, needsYou, runStats, viewOf } from '../lib/model';
import type { Run } from '../lib/types';
import { S, dom, st } from '../state/app';
import { panels } from '../state/panels';
import { isOffline, propagate, runAction, selectRun, toggleReviewed, viewFile } from '../state/actions';
import { bump, renderInspector, renderScene, renderSel, useRegion } from '../state/render';
import { bridge } from '../api/client';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { CopyCommand, SETUP_PROMPT, setConnectOpen } from './ConnectDialog';
import { Kbd, KbdGroup } from './ui/kbd';
import { Markdown } from './Markdown';
import { ScopeChip } from './ScopeChip';
import { BetaTag, Dot, Spinner, Stat } from './bits';
import { IntroSection } from './Intro';
import { locale, t, tn } from '../i18n';

const Section = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <section className={cn('border-b p-4', className)}>{children}</section>
);

/** Lines a long agent reply shows before "Show all"; a reply at most one line longer shows in full. */
const REPLY_LINES = 5;

/** Where each rendered line of text ends, from the top of `el`: parts of a line that overlap count as one. */
function lineBottoms(el: HTMLElement): number[] {
  const top = el.getBoundingClientRect().top;
  const rects: DOMRect[] = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!n.textContent?.trim()) continue;
    range.selectNodeContents(n);
    rects.push(...[...range.getClientRects()].filter(r => r.height > 0));
  }
  rects.sort((a, b) => a.top - b.top);
  const lines: { top: number; bottom: number }[] = [];
  for (const r of rects) {
    const last = lines[lines.length - 1];
    if (last && r.top < last.bottom - 2) last.bottom = Math.max(last.bottom, r.bottom);
    else lines.push({ top: r.top, bottom: r.bottom });
  }
  return lines.map(l => l.bottom - top);
}

/**
 * The agent's reply. A long one shows its first lines, cut between two lines, and "Show all" opens it for the
 * rest of this run's visit; a reply still being written shows in full.
 */
function Reply({ run, text, open }: { run: Run; text: string; open: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [cut, setCut] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || open) return setCut(null);
    const measure = () => {
      el.style.maxHeight = '';
      const lines = lineBottoms(el);
      const at = lines.length > REPLY_LINES + 1 ? Math.ceil(lines[REPLY_LINES - 1]!) : null;
      el.style.maxHeight = at === null ? '' : at + 'px';
      setCut(at);
    };
    measure();
    // Measured again whenever the lines wrap differently: the panel's width, a scrollbar, the fonts arriving.
    const ro = new ResizeObserver(measure);
    ro.observe(el.parentElement!);
    for (const child of el.children) ro.observe(child);
    document.fonts.addEventListener('loadingdone', measure);
    return () => {
      ro.disconnect();
      document.fonts.removeEventListener('loadingdone', measure);
    };
  }, [open, text]);
  return (
    <>
      <div className="bubble md rounded-lg border bg-card px-3 py-2 leading-relaxed text-pretty">
        {/* The clip ends at a line's bottom; the bubble's padding stays outside it. */}
        <div ref={box} className="overflow-hidden" style={cut === null ? undefined : { maxHeight: cut }}>
          <Markdown text={text} />
        </div>
      </div>
      {cut === null ? null : (
        <button
          type="button"
          id="replyMore"
          className="mt-1.5 rounded-sm text-xs text-ink2 underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          onClick={() => {
            st.openReplies.add(run.id);
            bump('inspector');
          }}
        >
          {t('Show all')}
        </button>
      )}
    </>
  );
}

/** A small, quiet uppercase label (DESIGN.md product rules). */
export const Label = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <h3 className={cn('mb-3 text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase', className)}>
    {children}
  </h3>
);

const ACT: Record<string, { label: string; tone: string }> = {
  tool: { label: 'tool', tone: 'bg-muted text-ink2' },
  err: { label: 'error', tone: 'bg-del/12 text-del' },
  warn: { label: 'scope', tone: 'bg-mod/12 text-mod' },
  deny: { label: 'denied', tone: 'bg-mod/12 text-mod' },
  text: { label: 'note', tone: 'bg-muted text-ink2' },
};

const linkClass =
  'flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 -mx-2 text-left font-mono text-xs text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring';

/** A run action button: disabled while the bridge works on any action, with a spinner on the one in progress. */
function ActButton({ run, act, children, ...props }: React.ComponentProps<typeof Button> & { run: Run; act: string }) {
  const mine = st.busy === `${act}:${run.id}`;
  return (
    <Button data-act={act} disabled={!!st.busy || isOffline()} aria-busy={mine || undefined} {...props}>
      {mine ? <Spinner className="text-current" /> : null}
      {children}
    </Button>
  );
}

/**
 * Without a sandbox, files the run's shell commands changed outside its section were put back at once. What the
 * command wrote is kept: each file restores in one click.
 */
function PutBack({ run }: { run: Run }) {
  return (
    <div id="putBack" className="warnbox mt-3 flex gap-2 rounded-lg border border-l-2 border-l-mod bg-card px-3 py-2">
      <span className="flex h-5 shrink-0 items-center">
        <TriangleAlert className="size-4 text-mod" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-pretty">
          {t(
            'A shell command changed these files outside the section. They were put back as they were; what it wrote is kept.',
          )}
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {run.putBack!.map(k => (
            <li key={k.path} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 font-mono text-xs [overflow-wrap:anywhere]">{k.path}</span>
              {k.restored ? (
                <span className="text-xs text-muted-foreground">{t('Restored')}</span>
              ) : (
                <Button
                  variant="outline"
                  size="xs"
                  data-restore={k.path}
                  disabled={!!st.busy || isOffline()}
                  title={t('Write {name} back as the shell command left it', { name: k.path })}
                  onClick={() => void restorePutBack(run, k.path)}
                >
                  {t('Restore')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function RunView({ run }: { run: Run }) {
  const s = runStats(run),
    a = agentOf(run.agent),
    model = modelOf(run.agent, run.model),
    files = [...run.changes.keys()];
  const done = files.filter(p => run.reviewed.has(p)).length,
    running = run.status === 'running';
  const reply =
    run.summary ||
    [...(run.stream || [])].reverse().find(e => e.t === 'text')?.text ||
    (running ? t('Working…') : t('No reply recorded.'));
  // While running, notes show progress; a note that is already the reply above is not repeated.
  const acts = (run.stream || [])
    .filter(e => (e.t !== 'text' || running) && !(e.t === 'text' && e.text === reply))
    .slice(-10);
  const checksFailed = !!run.checks?.some(c => c.ok === false);
  // Watch mode's runs and saves from the editor have no prompt, reply or scope.
  const detected = run.agent === 'detected' || run.agent === 'you';
  const meta = [t('Run {id}', { id: run.id }), run.when, run.dur, run.cost != null ? '$' + run.cost.toFixed(3) : '']
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <Section>
        <h2 className="text-[15px] leading-snug font-semibold tracking-[-0.005em] text-balance [overflow-wrap:anywhere]">
          {run.title}
        </h2>
        <div className="meta mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink2">
          <Dot c={a.c} />
          <span id="runAgent">{model ? `${a.name} · ${model}` : a.name}</span>
          {a.beta ? <BetaTag /> : null}
          <span className="quiet text-muted-foreground tabular-nums">{meta}</span>
        </div>
        {detected ? null : (
          <div className="runscope mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
              {t('Scope')}
            </span>
            {run.scope?.length ? (
              run.scope.map(s => <ScopeChip key={s} label={s} title={s} />)
            ) : (
              <ScopeChip label={t('Whole repository')} tone="neutral" className="all font-sans" />
            )}
          </div>
        )}
      </Section>
      {detected ? (
        <Section>
          <p className="text-ink2 text-pretty">
            {run.agent === 'you'
              ? t('Saved in the editor on the map.')
              : t('Changed outside a run, in an editor or by another agent.')}
          </p>
          {run.agent === 'you' && !run.reverted ? (
            // Propagate: the agent updates whatever depends on this save.
            <>
              <Button variant="outline" size="sm" className="mt-3" id="propagate" onClick={() => void propagate(run)}>
                {t('Update what depends on this')}
              </Button>
              <p className="mt-2 text-xs text-muted-foreground text-pretty">
                {t("The diff of your change goes into the agent's prompt.")}
              </p>
            </>
          ) : null}
        </Section>
      ) : (
        <Section>
          <div className="who mb-1 text-xs text-muted-foreground">{t('You')}</div>
          <div className="bubble me mb-3 max-h-72 overflow-auto rounded-lg bg-muted px-3 py-2 leading-relaxed whitespace-pre-line text-pretty">
            {run.prompt || run.title}
          </div>
          <div className="who mb-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Dot c={a.c} className="size-1.5" />
            {a.name}
            {running ? <Spinner /> : null}
          </div>
          <Reply run={run} text={reply} open={running || st.openReplies.has(run.id)} />
          {needsYou(run) ? (
            // What the agent needs before it can finish: a neutral card with an amber edge, like warnings.
            <div className="needs mt-3 flex gap-2 rounded-lg border border-l-2 border-l-mod bg-card px-3 py-2">
              <span className="flex h-5 shrink-0 items-center">
                <Hand className="size-4 text-mod" />
              </span>
              <div className="min-w-0">
                <div className="font-medium">{t('{agent} needs you', { agent: a.name })}</div>
                <p className="text-ink2 text-pretty [overflow-wrap:anywhere]">{run.turn!.needs || run.turn!.detail}</p>
              </div>
            </div>
          ) : null}
          {acts.length ? (
            <ul className="acts mt-3 flex flex-col gap-1">
              {acts.map((e, i) => {
                const k = ACT[e.t] ?? ACT.text!;
                return (
                  <li key={i} className={cn(e.t, 'flex min-w-0 items-start gap-2 font-mono text-xs text-ink2')}>
                    <b
                      className={cn(
                        'w-12 shrink-0 rounded px-1 text-center font-sans text-[11px] leading-[18px] font-medium',
                        k.tone,
                      )}
                    >
                      {k.label}
                    </b>
                    <span className="min-w-0 leading-[18px] [overflow-wrap:anywhere]">{e.text}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {running ? (
            <div className="actions mt-3 flex gap-2">
              <ActButton run={run} act="cancel" variant="outline" className="flex-1">
                {t('Cancel run')}
              </ActButton>
            </div>
          ) : null}
        </Section>
      )}
      {run.checks?.length || run.checksRunning ? (
        <Section>
          <Label>{t('Checks')}</Label>
          <div className="checks flex flex-col gap-2">
            {(run.checks || []).map((c, i) =>
              c.couldNotRun ? (
                <CouldNotRun key={i} name={c.name} error={c.summary} />
              ) : (
                <div key={i} className="check flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      c.ok === true ? 'ok text-add' : c.ok === false ? 'bad text-del' : 'skip text-ink3',
                      '[&_svg]:size-4',
                    )}
                  >
                    {c.ok === true ? <Check /> : c.ok === false ? <X /> : <Minus />}
                  </span>
                  <span className="nm font-medium">{c.name}</span>
                  <span className="sm truncate font-mono text-xs text-ink2 tabular-nums" title={c.summary}>
                    {c.summary}
                  </span>
                </div>
              ),
            )}
            {run.checksRunning ? (
              <div className="check flex items-center gap-2">
                <Spinner />
                <span className="sm text-ink2">{t('Running checks…')}</span>
              </div>
            ) : null}
          </div>
        </Section>
      ) : running ? null : (
        <ChecksOffer />
      )}
      {running ? null : (
        <Section>
          <h3 className="mb-3 flex items-center justify-between text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
            <span>{t('Review')}</span>
            {files.length ? (
              <span className="num font-normal tracking-normal normal-case tabular-nums">
                {t('{done} of {total}', { done, total: files.length })}
              </span>
            ) : null}
          </h3>
          {files.length ? (
            <>
              <div className="prog mb-3 flex gap-1">
                {files.map(p => (
                  <i
                    key={p}
                    className={cn('h-1 flex-1 rounded-full', run.reviewed.has(p) ? 'on bg-foreground/80' : 'bg-border')}
                  />
                ))}
              </div>
              <ul className="flist overflow-hidden rounded-lg border bg-card">
                {files.map(p => {
                  const fs = fileStat(run, p)!,
                    rv = run.reviewed.has(p),
                    cur = st.cur === p;
                  return (
                    <li
                      key={p}
                      data-fly={p}
                      title={p}
                      className={cn(
                        'flex h-9 cursor-pointer items-center gap-2 border-t pr-3 pl-1 font-mono text-xs transition-colors first:border-t-0 hover:bg-accent/60',
                        cur && 'cur bg-sel-soft shadow-[inset_2px_0_0_var(--sel)] hover:bg-sel-soft',
                      )}
                    >
                      <button
                        data-rev={p}
                        aria-label={rv ? t('Mark as not reviewed') : t('Mark as reviewed')}
                        className={cn(
                          'chk inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-4',
                          rv ? 'on text-add' : 'text-ink3 hover:text-foreground',
                        )}
                      >
                        {rv ? <CircleCheck /> : <Circle />}
                      </button>
                      <button
                        type="button"
                        data-fly={p}
                        aria-current={cur || undefined}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 self-stretch rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        <span
                          className={cn('kind size-1.5 shrink-0 rounded-full', fs.kind === 'add' ? 'bg-add' : 'bg-mod')}
                        />
                        <span className="p min-w-0 truncate">{p.split('/').pop()}</span>
                        <span className="ml-auto pl-2">
                          <Stat a={fs.a} d={fs.d} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="hintline mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <KbdGroup>
                  <Kbd>J</Kbd>
                  <Kbd>K</Kbd>
                </KbdGroup>
                {t('step through files')}
                <Kbd>R</Kbd>
                {t('mark reviewed')}
              </div>
            </>
          ) : (
            <div className="quiet flex items-center gap-2 text-muted-foreground">
              <CircleDashed className="size-4 text-ink3" />

              {t('No changes. No files were edited in this run.')}
            </div>
          )}
          {run.outOfScope?.length ? (
            // Warnings: a neutral surface with an amber icon and a thin amber edge, never an amber fill.
            <div className="warnbox mt-3 flex gap-2 rounded-lg border border-l-2 border-l-mod bg-card px-3 py-2 text-pretty">
              <span className="flex h-5 shrink-0 items-center">
                <TriangleAlert className="size-4 text-mod" />
              </span>
              <span>
                {t('Changed outside the scope:')}{' '}
                <span className="font-mono text-xs [overflow-wrap:anywhere]">{run.outOfScope.join(', ')}</span>
              </span>
            </div>
          ) : null}
          {run.putBack?.length ? <PutBack run={run} /> : null}
          {run.reverted ? (
            <div className="outcome mt-4 flex items-center gap-2 text-ink2">
              <Undo2 className="size-4 text-ink3" />

              {t('Reverted. Its changes are gone from your working tree.')}
            </div>
          ) : files.length ? (
            <>
              {run.kept ? (
                // A kept run shows that it was kept; revert stays available.
                <div className="outcome mt-4 flex items-center gap-2">
                  <CircleCheck className="size-4 text-add" />
                  <span className="font-medium">{t('Kept')}</span>
                  <span className="text-muted-foreground">{t('Changes stay in your working tree.')}</span>
                  <ActButton run={run} act="revert" variant="outline" size="sm" className="ml-auto">
                    {t('Revert')}
                  </ActButton>
                </div>
              ) : (
                <div className="actions mt-4 flex gap-2">
                  {/* The evidence picks the primary action: failed checks make Revert primary, Keep secondary. */}
                  <ActButton run={run} act="revert" variant={checksFailed ? 'default' : 'outline'} className="flex-1">
                    {t('Revert run')}
                  </ActButton>
                  <ActButton run={run} act="keep" variant={checksFailed ? 'outline' : 'default'} className="flex-1">
                    {done === files.length ? t('Keep changes') : t('Keep anyway')}
                  </ActButton>
                </div>
              )}
              <div className="hintline mt-3 flex items-center gap-1 text-xs text-muted-foreground">
                <Stat a={s.a} d={s.d} />
                {tn(s.n, 'across {n} file', 'across {n} files')}
              </div>
            </>
          ) : null}
        </Section>
      )}
    </>
  );
}

/** The first changed line of a file in the run on screen, or its first line. */
const firstChange = (v: ReturnType<typeof viewOf>) => v.rows.find(r => r.k)?.n ?? 1;

const authorName = (a: Author) =>
  ({ agent: t('Agent'), human: t('Human'), mixed: t('Mixed'), unknown: t('Unknown') })[a];

/** What the clicked line's label means, in words, given the run that last wrote it, if any. */
function authorText(o: Owner, run: Run | null): string {
  const { author } = o,
    who = run ? agentOf(run.agent).name : '';
  if (o.source === 'git-ai')
    return author === 'human'
      ? t("Git AI's note on commit {commit} says {who} wrote it.", {
          commit: o.commit ?? '',
          who: o.by || t('a person'),
        })
      : o.by
        ? t("Git AI's note on commit {commit} says an agent wrote it: {who}.", { commit: o.commit ?? '', who: o.by })
        : t("Git AI's note on commit {commit} says an agent wrote it.", { commit: o.commit ?? '' });
  if (o.source === 'trailer')
    return t(
      "Commit {commit} names an agent as co-author ({who}). It covers the whole commit, not lines, so this line is at most partly the agent's.",
      { commit: o.commit ?? '', who: o.by ?? '' },
    );
  if (author === 'agent') return t('{agent} wrote it with its edit tools.', { agent: who });
  if (author === 'human') return t('Saved in the editor on the map.');
  if (author === 'mixed') return t('Rewritten in part after an agent wrote it.');
  return run
    ? t("Changed in run {id}, by {agent}. Who typed it isn't known: the agent didn't write it with its edit tools.", {
        id: run.id,
        agent: who,
      })
    : t("No run kept on this computer changed it, so who wrote it isn't known.");
}

/** Coloured by author: the file's lines by who wrote them, and the clicked line's run and prompt. */
function Authors({ path }: { path: string }) {
  // What git records about the file, read once it's looked at (bridges before 0.2.0 have no route: nothing).
  useEffect(() => {
    const c = S.CONN;
    if (!c || !st.byAuthor || st.run || S.RECORDED.has(path)) return;
    S.RECORDED.set(path, []);
    void bridge
      .authors(c, path)
      .then(r => {
        S.RECORDED.set(path, r.lines);
        renderScene();
        renderInspector();
      })
      .catch(() => {});
  });
  const owners = S.AUTHORS.get(path);
  if (!st.byAuthor || st.run || !owners) return null;
  const n = shareOf(owners);
  const line = st.authorLine?.path === path ? st.authorLine.line : null;
  const o = line ? owners[line - 1] : undefined;
  const run = o?.run ? (S.RUNS.find(r => r.id === o.run) ?? null) : null;
  return (
    <Section>
      <Label>{t('Authors')}</Label>
      <div id="authorShare" className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] tabular-nums">
        {(['agent', 'mixed', 'human', 'unknown'] as const).map(a => (
          <span key={a} className={`au-${a} text-[var(--au,var(--ink2))]`}>{`${authorName(a)} ${n[a]}`}</span>
        ))}
      </div>
      {o ? (
        <div id="authorLine" className="mt-3 border-t pt-3">
          <div className="font-medium">
            {t('Line {n}:', { n: line ?? '' })}{' '}
            <span className={`au-${o.author} text-[var(--au,var(--ink2))]`}>{authorName(o.author)}</span>
          </div>
          <p className="mt-1 text-ink2 text-pretty">{authorText(o, run)}</p>
          {run ? (
            <>
              <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <Dot c={agentOf(run.agent).c} />
                <span className="min-w-0 truncate">
                  {[agentOf(run.agent).name, modelOf(run.agent, run.model), t('Run {id}', { id: run.id }), run.when]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              {run.prompt ? <p className="mt-2 line-clamp-3 text-pretty">{run.prompt}</p> : null}
              <Button variant="outline" size="sm" className="mt-3" id="openAuthorRun" onClick={() => selectRun(run)}>
                {t('Open run')}
              </Button>
            </>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{t('Click a line to see who wrote it, in which run.')}</p>
      )}
    </Section>
  );
}

function FileView({ path }: { path: string }) {
  const f = S.FILES.get(path)!,
    v = viewOf(f),
    outs = S.GRAPH.out.get(f.path) || [],
    ins = S.GRAPH.in.get(f.path) || [];
  const touched = S.RUNS.filter(r => r.changes.has(f.path));
  const link = (p: string) => (
    <button key={p} data-fly={p} data-pick={p} title={p} className={linkClass}>
      <span className="truncate">{p}</span>
    </button>
  );
  return (
    <>
      <Section>
        <h2 className="font-mono text-[15px] font-medium">{f.name}</h2>
        <div className="path mt-1 font-mono text-xs break-all text-muted-foreground">{f.path}</div>
        {S.repoRoot ? (
          // Heavy editing belongs in a full editor: open the file there, at its first changed line.
          <div className="mt-3 flex gap-2">
            {EDITORS.map(e => (
              <Button key={e.id} asChild variant="outline" size="sm">
                <a
                  href={editorUrl(e.id, S.repoRoot, f.path, firstChange(v))}
                  data-editor={e.id}
                  className="no-underline"
                >
                  {t('Open in {editor}', { editor: e.name })}
                </a>
              </Button>
            ))}
          </div>
        ) : null}
      </Section>
      <Authors path={path} />
      <Section>
        <dl className="kv grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
          <dt className="text-muted-foreground">{t('Lines')}</dt>
          <dd className="tabular-nums">
            {(st.run ? v.lines.length : (S.TOTALS.get(f.path) ?? v.lines.length)).toLocaleString(locale())}
          </dd>
          <dt className="text-muted-foreground">{t('Imports')}</dt>
          <dd className="tabular-nums">{outs.length}</dd>
          <dt className="text-muted-foreground">{t('Used by')}</dt>
          <dd className="tabular-nums">{ins.length}</dd>
        </dl>
      </Section>
      {outs.length ? (
        <Section>
          <Label>{t('Imports')}</Label>
          <div className="links flex flex-col gap-1">{outs.map(link)}</div>
        </Section>
      ) : null}
      {ins.length ? (
        <Section>
          <Label>{t('Used by')}</Label>
          <div className="links flex flex-col gap-1">{ins.map(link)}</div>
        </Section>
      ) : null}
      {touched.length ? (
        <Section>
          <Label>{t('Changed in')}</Label>
          <div className="links flex flex-col gap-1">
            {touched.map(r => (
              <button key={r.id} data-openrun={r.id} className={cn(linkClass, 'font-sans text-[13px]')}>
                <Dot c={agentOf(r.agent).c} />
                <span className="truncate">{t('Run {id}: {title}', { id: r.id, title: r.title })}</span>
              </button>
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}

/** The canvas's gestures and keys, in the person's language when shown. */
const keys = (): [string, string][] => [
  [t('Scroll'), t('Pan the canvas')],
  [t('⌘ Scroll'), t('Zoom toward the pointer')],
  [t('Click'), t('Add a file or folder to scope')],
  [t('Double click'), t('Edit a code box, or zoom in')],
  ['Enter', t('Edit the selected file')],
  [t('Shift drag'), t('Select an area')],
  ['F', t('Zoom to selection')],
  ['0', t('Fit everything')],
  ['/', t('Write a prompt')],
];

/** A repo with no checks: the checks found in it, turned on with one click. Nothing runs before that. */
/**
 * A check that couldn't run on this machine (not installed, or a package missing): not a test failure. It
 * shows the error's own line, and can be turned off while it is still set up.
 */
function CouldNotRun({ name, error }: { name: string; error: string }) {
  const on = S.checksOn.includes(name);
  return (
    <div className="check notrun flex min-w-0 items-start gap-2">
      <span className="mt-px text-ink3 [&_svg]:size-4">
        <CircleSlash />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="nm font-medium">{name}</span>
          <span className="text-xs text-ink2">{t("Couldn't run")}</span>
        </div>
        <div className="sm mt-1 line-clamp-3 font-mono text-xs text-ink2 [overflow-wrap:anywhere]" title={error}>
          {error}
        </div>
        <p className="mt-1 text-xs text-muted-foreground text-pretty">
          {on ? t('Something this check needs is missing on this machine.') : t('Turned off.')}
        </p>
      </div>
      {on ? (
        <Button
          variant="outline"
          size="xs"
          className="checkOff shrink-0"
          disabled={!!st.busy}
          onClick={() => void turnOffCheck(name)}
        >
          {st.busy === `checkoff:${name}` ? <Spinner className="text-current" /> : null}
          {t('Turn off')}
        </Button>
      ) : null}
    </div>
  );
}

function ChecksOffer() {
  const [share, setShare] = useState(false);
  if (!S.LIVE || !S.suggestedChecks.length) return null;
  return (
    <Section>
      <Label>{t('Checks')}</Label>
      <p className="mb-2 text-ink2 text-pretty">
        {S.checksFromRepo
          ? t("This repo's loa.config.json asks to run these commands after each run:")
          : t('No checks are set up. League of Agents found these and can run them after each run:')}
      </p>
      <ul id="suggestedChecks" className="mb-3 flex flex-col gap-1">
        {S.suggestedChecks.map(c => {
          const repoCode = runsRepoCode(c.run);
          return (
            <li key={c.name} className="min-w-0">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 font-medium">{c.name}</span>
                {/* A repo's own command is read in full before it's approved; found ones are the bridge's own. */}
                <code
                  className={cn(
                    'font-mono text-xs text-ink2',
                    S.checksFromRepo ? 'min-w-0 break-all whitespace-pre-wrap' : 'truncate',
                  )}
                  title={c.run}
                >
                  {c.run}
                </code>
              </div>
              {repoCode ? (
                <p className="repoCode mt-0.5 text-xs text-muted-foreground text-pretty">{repoCode}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Button
        variant="outline"
        size="sm"
        id="enableChecks"
        disabled={!!st.busy}
        onClick={() => void enableChecks(share)}
      >
        {st.busy === 'checks' ? <Spinner className="text-current" /> : null}
        {t('Run these after each run')}
      </Button>
      {S.checksFromRepo ? null : (
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-ink2">
          <input
            type="checkbox"
            id="shareChecks"
            checked={share}
            onChange={e => setShare(e.target.checked)}
            className="mt-px size-3.5 shrink-0 cursor-pointer accent-[var(--sel)]"
          />
          <span className="text-pretty">{t('Also save them in loa.config.json, to share with your team')}</span>
        </label>
      )}
      <p className="mt-2 text-xs text-muted-foreground text-pretty">
        {S.checksFromRepo
          ? t('Nothing runs until you turn them on here. Read the commands first: they run on your computer.')
          : t('Nothing runs until you turn them on. Unless you share them, they stay in .loa/, out of your repo.')}
      </p>
    </Section>
  );
}

function RepoView() {
  const root = S.ROOT!;
  const nFiles = [...S.FILES.values()].filter(existsNow).length;
  const nLines = [...S.FILES.values()]
    .filter(existsNow)
    .reduce((a, f) => a + (S.TOTALS.get(f.path) ?? linesAt(f, S.RUNS.length).L.length), 0);
  const last = S.RUNS[S.RUNS.length - 1];
  return (
    <>
      <Section>
        <h2 className="text-[15px] font-semibold tracking-[-0.005em]">{root.name}</h2>
        <div className="meta quiet mt-2 text-muted-foreground tabular-nums">
          {[
            tn(nFiles, '{n} file', '{n} files'),
            tn(nLines, '{n} line', '{n} lines'),
            tn(S.RUNS.length, '{n} run', '{n} runs'),
          ].join(', ')}
        </div>
      </Section>
      {S.CONN && S.watchOff ? (
        <Section>
          <Label>{t('Watch mode is off')}</Label>
          <p id="watchOff" className="text-ink2 text-pretty">
            {t("Edits made outside a run aren't recorded: {why}.", { why: S.watchOff })}
          </p>
          {/limit on watched folders/.test(S.watchOff) ? (
            <p className="mt-2 text-xs text-muted-foreground text-pretty">
              {t('On Linux, raise it, then restart League of Agents:')}{' '}
              <code className="font-mono">sudo sysctl fs.inotify.max_user_watches=524288</code>
            </p>
          ) : null}
        </Section>
      ) : null}
      <ChecksOffer />
      {S.CONN ? null : (
        // The demo invites you to try it on your own code: the command, a copy button, the requirements.
        <Section>
          <Label>{t('Try it on your code')}</Label>
          <p className="mb-3 text-ink2 text-pretty">
            {t('This is a demo. To use it on your repo, paste this into your coding agent:')}
          </p>
          <CopyCommand ids={['trySetup', 'trySetupCopy']} text={SETUP_PROMPT} compact />
          <p className="mt-3 mb-2 text-xs text-muted-foreground">{t('Or run it yourself in the repo:')}</p>
          <CopyCommand ids={['tryCommand', 'tryCopy']} compact />
          <ul className="mt-3 flex list-disc flex-col gap-1 pl-4 text-xs text-muted-foreground">
            <li>{t("macOS, Node 20 or later, and a git repo. Linux is in testing; Windows isn't supported yet.")}</li>
            <li>{t('Claude Code or Cursor to run from the canvas. Changes made in any editor show up as runs.')}</li>
          </ul>
          <Button variant="outline" size="sm" className="mt-3" id="tryConnect" onClick={() => setConnectOpen(true)}>
            {t('I have a link to paste')}
          </Button>
        </Section>
      )}
      <Section>
        <Label>{t('Get around')}</Label>
        <div className="keys grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-[13px] text-ink2">
          {keys().map(([k, d]) => (
            <div key={k} className="contents">
              <Kbd className="justify-self-start">{k}</Kbd>
              <span>{d}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section>
        <Label>{t('Latest run')}</Label>
        {last ? (
          <div className="links">
            <button data-openrun={last.id} className={cn(linkClass, 'font-sans text-[13px]')}>
              <Dot c={agentOf(last.agent).c} />
              <span className="truncate">{t('Run {id}: {title}', { id: last.id, title: last.title })}</span>
            </button>
          </div>
        ) : (
          <div className="quiet text-muted-foreground">{t('None yet.')}</div>
        )}
      </Section>
    </>
  );
}

export function Inspector() {
  useRegion('inspector');
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element;
      const rv = t.closest<HTMLElement>('[data-rev]');
      if (rv) {
        e.stopPropagation();
        toggleReviewed(rv.dataset.rev!);
        return;
      }
      const or = t.closest<HTMLElement>('[data-openrun]');
      if (or) {
        const run = S.RUNS.find(x => x.id === +(or.dataset.openrun ?? ''));
        if (run) selectRun(run);
        return;
      }
      const pk = t.closest<HTMLElement>('[data-pick]');
      if (pk) {
        st.sel.clear();
        st.sel.add(pk.dataset.pick!);
        renderSel();
        flyFile(pk.dataset.pick!);
        return;
      }
      const fl = t.closest<HTMLElement>('[data-fly]');
      if (fl) {
        viewFile(fl.dataset.fly!);
        return;
      }
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act && st.run) runAction(act, st.run);
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, []);
  let body: React.ReactNode = st.starting ? (
    <Section>
      <div className="quiet flex items-center gap-2 text-muted-foreground">
        <Spinner />

        {t('Waiting for the bridge')}
      </div>
    </Section>
  ) : null;
  if (S.ROOT) {
    const fsel = [...st.sel].filter(k => !k.startsWith('d:'));
    body = st.run ? (
      <RunView run={st.run} />
    ) : fsel.length === 1 && S.FILES.has(fsel[0]!) ? (
      <FileView path={fsel[0]!} />
    ) : (
      <RepoView />
    );
  }
  return (
    <aside
      id="insp"
      aria-label={t('Inspector')}
      inert={!panels.insp}
      ref={el => {
        ref.current = el;
        if (el) dom.insp = el;
      }}
      className="col-start-2 row-start-2 overflow-auto border-l bg-panel max-[860px]:col-start-1 max-[860px]:row-start-3 max-[860px]:max-h-[38vh] max-[860px]:border-t max-[860px]:border-l-0 [&[inert]]:invisible"
    >
      <IntroSection />
      {body}
    </aside>
  );
}
