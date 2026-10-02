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
import { useEffect, useRef, useState } from 'react';
import { enableChecks, turnOffCheck } from '../api/live';
import { flyFile } from '../lib/camera';
import { agentOf } from '../lib/constants';
import { existsNow, fileStat, linesAt, needsYou, runStats, viewOf } from '../lib/model';
import type { Run } from '../lib/types';
import { plural } from '../lib/util';
import { S, dom, st } from '../state/app';
import { panels } from '../state/panels';
import { isOffline, propagate, runAction, selectRun, toggleReviewed, viewFile } from '../state/actions';
import { renderSel, useRegion } from '../state/render';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { CopyCommand, SETUP_PROMPT, setConnectOpen } from './ConnectDialog';
import { Kbd, KbdGroup } from './ui/kbd';
import { Markdown } from './Markdown';
import { ScopeChip } from './ScopeChip';
import { BetaTag, Dot, Spinner, Stat } from './bits';

const Section = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <section className={cn('border-b p-4', className)}>{children}</section>
);

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

function RunView({ run }: { run: Run }) {
  const s = runStats(run),
    a = agentOf(run.agent),
    files = [...run.changes.keys()];
  const done = files.filter(p => run.reviewed.has(p)).length,
    running = run.status === 'running';
  const reply =
    run.summary ||
    [...(run.stream || [])].reverse().find(e => e.t === 'text')?.text ||
    (running ? 'Working…' : 'No reply recorded.');
  // While running, notes show progress; a note that is already the reply above is not repeated.
  const acts = (run.stream || [])
    .filter(e => (e.t !== 'text' || running) && !(e.t === 'text' && e.text === reply))
    .slice(-10);
  const checksFailed = !!run.checks?.some(c => c.ok === false);
  // Watch mode's runs and saves from the editor have no prompt, reply or scope.
  const detected = run.agent === 'detected' || run.agent === 'you';
  const meta = [`Run ${run.id}`, run.when, run.dur, run.cost != null ? '$' + run.cost.toFixed(3) : '']
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
          {a.name}
          {a.beta ? <BetaTag /> : null}
          <span className="quiet text-muted-foreground tabular-nums">{meta}</span>
        </div>
        {detected ? null : (
          <div className="runscope mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">Scope</span>
            {run.scope?.length ? (
              run.scope.map(s => <ScopeChip key={s} label={s} title={s} />)
            ) : (
              <ScopeChip label="Whole repository" tone="neutral" className="all font-sans" />
            )}
          </div>
        )}
      </Section>
      {detected ? (
        <Section>
          <p className="text-ink2 text-pretty">
            {run.agent === 'you'
              ? 'Saved in the editor on the map.'
              : 'Changed outside a run, in an editor or by another agent.'}
          </p>
          {run.agent === 'you' && !run.reverted ? (
            // Propagate: the agent updates whatever depends on this save.
            <Button variant="outline" size="sm" className="mt-3" id="propagate" onClick={() => void propagate(run)}>
              Update what depends on this
            </Button>
          ) : null}
        </Section>
      ) : (
        <Section>
          <div className="who mb-1 text-xs text-muted-foreground">You</div>
          <div className="bubble me mb-3 max-h-72 overflow-auto rounded-lg bg-muted px-3 py-2 leading-relaxed whitespace-pre-line text-pretty">
            {run.prompt || run.title}
          </div>
          <div className="who mb-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Dot c={a.c} className="size-1.5" />
            {a.name}
            {running ? <Spinner /> : null}
          </div>
          <div className="bubble md rounded-lg border bg-card px-3 py-2 leading-relaxed text-pretty">
            <Markdown text={reply} />
          </div>
          {needsYou(run) ? (
            // What the agent needs before it can finish: a neutral card with an amber edge, like warnings.
            <div className="needs mt-3 flex gap-2 rounded-lg border border-l-2 border-l-mod bg-card px-3 py-2">
              <span className="flex h-5 shrink-0 items-center">
                <Hand className="size-4 text-mod" />
              </span>
              <div className="min-w-0">
                <div className="font-medium">{`${a.name} needs you`}</div>
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
                Cancel run
              </ActButton>
            </div>
          ) : null}
        </Section>
      )}
      {run.checks?.length || run.checksRunning ? (
        <Section>
          <Label>Checks</Label>
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
                <span className="sm text-ink2">Running checks…</span>
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
            <span>Review</span>
            {files.length ? (
              <span className="num font-normal tracking-normal normal-case tabular-nums">{`${done} of ${files.length}`}</span>
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
                        aria-label={rv ? 'Mark as not reviewed' : 'Mark as reviewed'}
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
                step through files
                <Kbd>R</Kbd>
                mark reviewed
              </div>
            </>
          ) : (
            <div className="quiet flex items-center gap-2 text-muted-foreground">
              <CircleDashed className="size-4 text-ink3" />
              No changes. No files were edited in this run.
            </div>
          )}
          {run.outOfScope?.length ? (
            // Warnings: a neutral surface with an amber icon and a thin amber edge, never an amber fill.
            <div className="warnbox mt-3 flex gap-2 rounded-lg border border-l-2 border-l-mod bg-card px-3 py-2 text-pretty">
              <span className="flex h-5 shrink-0 items-center">
                <TriangleAlert className="size-4 text-mod" />
              </span>
              <span>
                Changed outside the scope:{' '}
                <span className="font-mono text-xs [overflow-wrap:anywhere]">{run.outOfScope.join(', ')}</span>
              </span>
            </div>
          ) : null}
          {run.reverted ? (
            <div className="outcome mt-4 flex items-center gap-2 text-ink2">
              <Undo2 className="size-4 text-ink3" />
              Reverted. Its changes are gone from your working tree.
            </div>
          ) : files.length ? (
            <>
              {run.kept ? (
                // A kept run shows that it was kept; revert stays available.
                <div className="outcome mt-4 flex items-center gap-2">
                  <CircleCheck className="size-4 text-add" />
                  <span className="font-medium">Kept</span>
                  <span className="text-muted-foreground">Changes stay in your working tree.</span>
                  <ActButton run={run} act="revert" variant="outline" size="sm" className="ml-auto">
                    Revert
                  </ActButton>
                </div>
              ) : (
                <div className="actions mt-4 flex gap-2">
                  {/* The evidence picks the primary action: failed checks make Revert primary, Keep secondary. */}
                  <ActButton run={run} act="revert" variant={checksFailed ? 'default' : 'outline'} className="flex-1">
                    Revert run
                  </ActButton>
                  <ActButton run={run} act="keep" variant={checksFailed ? 'outline' : 'default'} className="flex-1">
                    {done === files.length ? 'Keep changes' : 'Keep anyway'}
                  </ActButton>
                </div>
              )}
              <div className="hintline mt-3 flex items-center gap-1 text-xs text-muted-foreground">
                <Stat a={s.a} d={s.d} />
                {` across ${plural(s.n, 'file')}`}
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
                  {`Open in ${e.name}`}
                </a>
              </Button>
            ))}
          </div>
        ) : null}
      </Section>
      <Section>
        <dl className="kv grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
          <dt className="text-muted-foreground">Lines</dt>
          <dd className="tabular-nums">
            {(st.run ? v.lines.length : (S.TOTALS.get(f.path) ?? v.lines.length)).toLocaleString()}
          </dd>
          <dt className="text-muted-foreground">Imports</dt>
          <dd className="tabular-nums">{outs.length}</dd>
          <dt className="text-muted-foreground">Used by</dt>
          <dd className="tabular-nums">{ins.length}</dd>
        </dl>
      </Section>
      {outs.length ? (
        <Section>
          <Label>Imports</Label>
          <div className="links flex flex-col gap-1">{outs.map(link)}</div>
        </Section>
      ) : null}
      {ins.length ? (
        <Section>
          <Label>Used by</Label>
          <div className="links flex flex-col gap-1">{ins.map(link)}</div>
        </Section>
      ) : null}
      {touched.length ? (
        <Section>
          <Label>Changed in</Label>
          <div className="links flex flex-col gap-1">
            {touched.map(r => (
              <button key={r.id} data-openrun={r.id} className={cn(linkClass, 'font-sans text-[13px]')}>
                <Dot c={agentOf(r.agent).c} />
                <span className="truncate">{`Run ${r.id}: ${r.title}`}</span>
              </button>
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}

const KEYS: [string, string][] = [
  ['Scroll', 'Pan the canvas'],
  ['⌘ Scroll', 'Zoom toward the pointer'],
  ['Click', 'Add a file or folder to scope'],
  ['Double click', 'Edit a code box, or zoom in'],
  ['Enter', 'Edit the selected file'],
  ['Shift drag', 'Select an area'],
  ['F', 'Zoom to selection'],
  ['0', 'Fit everything'],
  ['/', 'Write a prompt'],
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
          <span className="text-xs text-ink2">Couldn't run</span>
        </div>
        <div className="sm mt-1 line-clamp-3 font-mono text-xs text-ink2 [overflow-wrap:anywhere]" title={error}>
          {error}
        </div>
        <p className="mt-1 text-xs text-muted-foreground text-pretty">
          {on ? 'Something this check needs is missing on this machine.' : 'Turned off.'}
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
          Turn off
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
      <Label>Checks</Label>
      <p className="mb-2 text-ink2 text-pretty">
        No checks are set up. League of Agents found these and can run them after each run:
      </p>
      <ul id="suggestedChecks" className="mb-3 flex flex-col gap-1">
        {S.suggestedChecks.map(c => (
          <li key={c.name} className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 font-medium">{c.name}</span>
            <code className="truncate font-mono text-xs text-ink2" title={c.run}>
              {c.run}
            </code>
          </li>
        ))}
      </ul>
      <Button
        variant="outline"
        size="sm"
        id="enableChecks"
        disabled={!!st.busy}
        onClick={() => void enableChecks(share)}
      >
        {st.busy === 'checks' ? <Spinner className="text-current" /> : null}
        Run these after each run
      </Button>
      <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-ink2">
        <input
          type="checkbox"
          id="shareChecks"
          checked={share}
          onChange={e => setShare(e.target.checked)}
          className="mt-px size-3.5 shrink-0 cursor-pointer accent-[var(--sel)]"
        />
        <span className="text-pretty">Also save them in loa.config.json, to share with your team</span>
      </label>
      <p className="mt-2 text-xs text-muted-foreground text-pretty">
        Nothing runs until you turn them on. Unless you share them, they stay in .loa/, out of your repo.
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
        <div className="meta quiet mt-2 text-muted-foreground tabular-nums">{`${plural(nFiles, 'file')}, ${nLines.toLocaleString()} lines, ${plural(S.RUNS.length, 'run')}`}</div>
      </Section>
      <ChecksOffer />
      {S.CONN ? null : (
        // The demo invites you to try it on your own code: the command, a copy button, the requirements.
        <Section>
          <Label>Try it on your code</Label>
          <p className="mb-3 text-ink2 text-pretty">
            This is a demo. To use it on your repo, paste this into your coding agent:
          </p>
          <CopyCommand ids={['trySetup', 'trySetupCopy']} text={SETUP_PROMPT} compact />
          <p className="mt-3 mb-2 text-xs text-muted-foreground">Or run it yourself in the repo:</p>
          <CopyCommand ids={['tryCommand', 'tryCopy']} compact />
          <ul className="mt-3 flex list-disc flex-col gap-1 pl-4 text-xs text-muted-foreground">
            <li>macOS, Node 20 or later, and a git repo. Windows coming soon.</li>
            <li>Claude Code or Cursor to run from the canvas. Changes made in any editor show up as runs.</li>
          </ul>
          <Button variant="outline" size="sm" className="mt-3" id="tryConnect" onClick={() => setConnectOpen(true)}>
            I have a link to paste
          </Button>
        </Section>
      )}
      <Section>
        <Label>Get around</Label>
        <div className="keys grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-[13px] text-ink2">
          {KEYS.map(([k, d]) => (
            <div key={k} className="contents">
              <Kbd className="justify-self-start">{k}</Kbd>
              <span>{d}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section>
        <Label>Latest run</Label>
        {last ? (
          <div className="links">
            <button data-openrun={last.id} className={cn(linkClass, 'font-sans text-[13px]')}>
              <Dot c={agentOf(last.agent).c} />
              <span className="truncate">{`Run ${last.id}: ${last.title}`}</span>
            </button>
          </div>
        ) : (
          <div className="quiet text-muted-foreground">None yet.</div>
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
        Waiting for the bridge
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
      aria-label="Inspector"
      inert={!panels.insp}
      ref={el => {
        ref.current = el;
        if (el) dom.insp = el;
      }}
      className="col-start-2 row-start-2 overflow-auto border-l bg-panel max-[860px]:col-start-1 max-[860px]:row-start-3 max-[860px]:max-h-[38vh] max-[860px]:border-t max-[860px]:border-l-0 [&[inert]]:invisible"
    >
      {body}
    </aside>
  );
}
