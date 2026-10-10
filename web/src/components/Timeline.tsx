// A run's steps, in order (bridge/lib/steps.mjs): when, what its agent did, and the file it named. A click takes the
// map to that file as the step left it. Only the rows in view are drawn, so a run of thousands of steps scrolls freely.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ensureSteps, openStep } from '../api/live';
import { momentOf, stepsOf, touched } from '../lib/live';
import type { Run } from '../lib/types';
import { cn } from '@/lib/utils';
import { useRegion } from '../state/render';
import { Label } from './Inspector';
import { FilePath, StepText } from './bits';
import { t } from '../i18n';

/** Each row's height, and how many show before the list scrolls. */
const ROW = 24,
  SHOWN = 12;

/** Time since the run started, as m:ss. */
const since = (ms: number) => {
  const sec = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

export function Timeline({ run }: { run: Run }) {
  useRegion('watch');
  const list = stepsOf(run.id).filter(Boolean);
  const box = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  useEffect(() => void ensureSteps(run.id), [run.id]);
  // While it works, the list keeps to its newest step, unless the person scrolled up to read.
  const atEnd = useRef(true);
  useLayoutEffect(() => {
    const el = box.current;
    if (el && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [list.length]);
  if (!list.length) return null;
  const start = run.startedAt ?? list[0]!.at;
  const from = Math.max(0, Math.floor(top / ROW) - 4),
    to = Math.min(list.length, Math.floor(top / ROW) + SHOWN + 4);
  return (
    <section className="steps border-b p-4">
      <Label>{t('Steps')}</Label>
      <p id="touched" className="mb-2 text-xs text-ink2 text-pretty">
        {touched(list)}
      </p>
      <div
        id="timeline"
        ref={box}
        role="group"
        aria-label={t('Steps')}
        className="relative overflow-y-auto rounded-lg border bg-card"
        style={{ height: Math.min(list.length, SHOWN) * ROW + 2 }}
        onScroll={e => {
          const el = e.currentTarget;
          atEnd.current = el.scrollTop + el.clientHeight >= el.scrollHeight - ROW;
          setTop(el.scrollTop);
        }}
      >
        <div style={{ height: list.length * ROW }}>
          {list.slice(from, to).map((s, k) => {
            const picked = s.file ? momentOf(s.file)?.i === s.i : false;
            return (
              <button
                type="button"
                key={s.i}
                data-step={s.i}
                aria-current={picked || undefined}
                disabled={!s.file}
                onClick={() => void openStep(run, s)}
                className={cn(
                  'absolute inset-x-0 flex items-center gap-2 px-2 text-left text-xs outline-none',
                  'enabled:hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset',
                  'disabled:cursor-default aria-[current]:bg-sel-soft',
                )}
                style={{ top: (from + k) * ROW, height: ROW }}
              >
                <span className="w-8 shrink-0 text-muted-foreground tabular-nums">{since(s.at - start)}</span>
                {s.refused || s.act !== 'other' ? (
                  <StepText act={s.act} path={s.file} refused={s.refused} />
                ) : (
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="shrink-0 text-ink2">{s.tool}</span>
                    {s.file ? <FilePath path={s.file} /> : null}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
