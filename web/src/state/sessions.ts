// Sessions at work: runs under way at the same time, each on a section of its own (lib/sections.ts).
import type { Run } from '../lib/types';
import { S, st } from './app';

/** Most sessions started at once from one prompt; each gets a colour of its own (theme.css, --session-1 to 5). */
export const MAX_SESSIONS = 5;

/** The runs at work: as the bridge last said, or in the demo, those still running. */
export function workingRuns(): Run[] {
  if (!S.CONN) return S.RUNS.filter(r => r.status === 'running');
  return S.WORKING.map(id => S.RUNS.find(r => r.id === id)).filter(r => !!r);
}

const slots = new Map<number, number>();
/** A session's colour. It keeps it while it works, so another ending never changes it. */
export function sessionColour(run: Run): string {
  const at = new Set(workingRuns().map(r => r.id));
  for (const id of slots.keys()) if (!at.has(id)) slots.delete(id);
  let slot = slots.get(run.id);
  if (slot === undefined) {
    const taken = new Set(slots.values());
    slot = [...Array(MAX_SESSIONS).keys()].find(i => !taken.has(i)) ?? run.id % MAX_SESSIONS;
    slots.set(run.id, slot);
  }
  return `var(--session-${slot + 1})`;
}

/** Whether two runs worked at the same time: sessions, one beside the other. */
export function workedTogether(a: Pick<Run, 'startedAt' | 'endedAt'>, b: Pick<Run, 'startedAt' | 'endedAt'>) {
  if (a.startedAt === undefined || b.startedAt === undefined) return false;
  return a.startedAt < (b.endedAt ?? Infinity) && b.startedAt < (a.endedAt ?? Infinity);
}

/**
 * Whether a session that just ended opens: not while the person reviews another that worked beside it, so the
 * view stays where it is.
 */
export const opensOnFinish = (ended: Pick<Run, 'id' | 'startedAt' | 'endedAt'>) =>
  !st.run || st.run.id === ended.id || st.run.status === 'running' || !workedTogether(st.run, ended);
