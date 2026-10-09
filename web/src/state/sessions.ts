// Sessions at work: runs under way at the same time, each on a section of its own (lib/sections.ts).
import type { Run } from '../lib/types';
import { t } from '../i18n';
import { S, st } from './app';

/** Most sessions started at once from one prompt; each gets a colour of its own (theme.css, --session-1 to 5). */
export const MAX_SESSIONS = 5;

/** The runs at work: as the bridge last said, or in the demo, those still running. */
export function workingRuns(): Run[] {
  if (!S.CONN) return S.RUNS.filter(r => r.status === 'running');
  return S.WORKING.map(id => S.RUNS.find(r => r.id === id)).filter(r => !!r);
}

/** A session's colour: the one it was given as it started, the same in every window and after a reload. */
export const sessionColour = (run: Run) => `var(--session-${((run.slot ?? run.id) % MAX_SESSIONS) + 1})`;

/**
 * The sessions at work and those that worked beside them: what their costs add up to, where their harnesses report
 * one, and how many don't (yet: Claude Code says its cost as it finishes).
 */
export function sessionsCost() {
  const working = workingRuns();
  const group = S.RUNS.filter(r => working.includes(r) || working.some(w => workedTogether(w, r)));
  const known = group.filter(r => r.cost != null);
  return { total: known.reduce((a, r) => a + r.cost!, 0), counted: known.length, missing: group.length - known.length };
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

/** How a run ended when it didn't finish its work, in words: null when it did. */
export function endedAs(r: Pick<Run, 'status' | 'limited'>): string | null {
  if (r.limited) return t('Rate limited');
  if (r.status === 'failed') return t('Failed');
  if (r.status === 'cancelled') return t('Cancelled');
  if (r.status === 'interrupted') return t('Interrupted');
  return null;
}

/**
 * Sessions that ended without finishing (stopped, failed, rate limited): their sections stay drawn, marked so, until
 * the run is opened or another session starts there. Their sections are free at once.
 */
export const ended = new Set<number>();
/** Every session noted as ended: once its mark is gone, a later state event never brings it back. */
const noted = new Set<number>();
/** The person looked at a run: its mark goes, and isn't brought back by a state event that arrives later. */
export function seen(id: number) {
  noted.add(id);
  ended.delete(id);
}
/** Notes the sessions that just stopped working and ended without finishing, from the runs as they are now. */
export function noteEnded(before: number[], now: number[], runs: Pick<Run, 'id' | 'status' | 'limited'>[]) {
  for (const id of before) {
    const r = runs.find(x => x.id === id);
    if (!now.includes(id) && r && endedAs(r) && !noted.has(id)) {
      noted.add(id);
      ended.add(id);
    }
  }
}
