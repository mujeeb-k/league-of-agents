// Small shared pieces: change stats, agent dots, and the checks badge.
import { Loader2 } from 'lucide-react';
import { Fragment } from 'react';
import type { Check } from '../api/types';
import type { Run } from '../lib/types';
import { cn } from '@/lib/utils';
import { locale, t, tn } from '../i18n';

/** `+a −d` stat. The space before the deletion count is part of the markup. */
export const Stat = ({ a, d }: { a: number; d: number }) => (
  <span className="stat whitespace-nowrap text-ink2 tabular-nums">
    <ins className="text-add no-underline">{`+${a}`}</ins>
    {d ? (
      <>
        {' '}
        <del className="text-del no-underline">{`−${d}`}</del>
      </>
    ) : null}
  </span>
);

export const Dot = ({ c, style, className }: { c: string; style?: React.CSSProperties; className?: string }) => (
  <span
    className={cn('dot inline-block size-2 shrink-0 rounded-full', className)}
    style={{ background: c, ...style }}
  />
);

/** A small spinner for work in progress. Stops under reduced motion. */
export const Spinner = ({ className }: { className?: string }) => (
  <Loader2 aria-hidden="true" className={cn('spin size-3.5 shrink-0 animate-spin text-ink3', className)} />
);

export function CheckBadge({ r }: { r: Run }) {
  if (r.checksRunning) return <Spinner />;
  if (!r.checks?.length) return null;
  // One kind of result says it in words; a mix counts each kind. A failure sets the colour, then a check that
  // couldn't run here; skipped checks (a port in use) count for neither.
  const n = (f: (c: Check) => boolean) => r.checks!.filter(f).length;
  const passed = n(c => c.ok === true),
    failed = n(c => c.ok === false),
    notRun = n(c => !!c.couldNotRun);
  const kinds = [
    [passed, tn(passed, '{n} passed', '{n} passed')],
    [failed, tn(failed, '{n} failed', '{n} failed')],
    [notRun, tn(notRun, "{n} couldn't run", "{n} couldn't run")],
  ].filter(([k]) => k) as [number, string][];
  if (!kinds.length) return null;
  const label =
    kinds.length > 1
      ? kinds.map(([, t]) => t).join(' · ')
      : failed
        ? t('Checks failed')
        : notRun
          ? t("Checks couldn't run")
          : t('Checks passed');
  // A small tinted tag: warm colour only as a marker.
  return (
    <span
      className={cn(
        'rounded px-2 text-[11px] leading-[18px] whitespace-nowrap',
        failed ? 'bg-del/12 text-del' : notRun ? 'bg-muted text-ink2' : 'bg-add/12 text-add',
      )}
    >
      {label}
    </span>
  );
}

/** An agent connection not yet verified with a real run. */
export const BetaTag = () => (
  <span className="beta shrink-0 rounded px-1 text-[10px] leading-4 font-medium tracking-wide text-muted-foreground ring-1 ring-border">
    {t('Beta')}
  </span>
);

/** A translated sentence with elements in it: each `{name}` in the text becomes `nodes.name`, in the language's order. */
export function Phrase({ text, nodes }: { text: string; nodes: Record<string, React.ReactNode> }) {
  return (
    <>
      {text.split(/(\{\w+\})/).map((part, i) => {
        const name = /^\{(\w+)\}$/.exec(part)?.[1];
        return name && name in nodes ? <Fragment key={i}>{nodes[name]}</Fragment> : part;
      })}
    </>
  );
}

/**
 * Under words that stay exactly as written in every language (the tagline, the privacy pair): their translation,
 * when the page is in another language.
 */
export function Translation({ of, className }: { of: string; className?: string }) {
  if (locale() === 'en') return null;
  return (
    <span lang={locale()} className={cn('translation block text-muted-foreground', className)}>
      {t(of)}
    </span>
  );
}

/**
 * A file or folder named in a list: its name, never broken, then the folder it is in dimmed, cut short when the row
 * is narrow.
 */
export function FilePath({ path }: { path: string }) {
  const bare = path.replace(/\/$/, ''),
    cut = bare.lastIndexOf('/');
  return (
    <span className="flex max-w-full min-w-0 items-baseline font-mono" title={path}>
      {/* The folder gives way first, its space with it; a name longer than the whole row is cut at its end. */}
      <span className="max-w-full shrink-0 truncate text-foreground">{path.slice(cut + 1)}</span>
      {cut > 0 ? (
        <span className="w-0 min-w-0 grow truncate text-muted-foreground">{`\u00a0${bare.slice(0, cut)}`}</span>
      ) : null}
    </span>
  );
}

/** What a step or tool call did, as words: "Read estimator.py", "Edited prefix.py", "Ran pytest". */
export function StepText({
  act,
  path,
  cmd,
  refused,
}: {
  act?: string;
  path?: string;
  cmd?: string;
  refused?: boolean;
}) {
  const verb = refused
    ? t('Blocked')
    : act === 'read'
      ? t('Read')
      : act === 'edit'
        ? t('Edited')
        : act === 'run'
          ? path || cmd
            ? t('Ran')
            : t('Ran a command')
          : null;
  if (!verb) return null;
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className={cn('shrink-0 font-sans', refused ? 'text-mod' : 'text-ink2')}>{verb}</span>
      {path ? (
        <FilePath path={path} />
      ) : cmd ? (
        <span className="min-w-0 truncate font-mono" title={cmd}>
          {cmd}
        </span>
      ) : null}
    </span>
  );
}

/** A command's write the sandbox refused, in words: outside the selection, or for a run on the whole repository. */
export const commandBlockedText = (scoped: boolean) =>
  scoped
    ? t('A command tried to write outside your selection. Blocked.')
    : t('A command tried to write a protected file or outside this repo. Blocked.');

/** Where a session on the whole repository can change files, when the system keeps it inside the repo. */
export const containedText = () => t("Can change any file in this repo. Can't touch the rest of your computer.");
