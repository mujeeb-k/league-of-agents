// Sessions at work: runs under way at the same time, each on a section of its own (lib/sections.ts).
import type { Run } from '../lib/types';
import type { Want } from '../api/types';
import { covers } from '../lib/sections';
import { t } from '../i18n';
import { agentOf } from '../lib/constants';
import { S, st } from './app';

/** Most sessions started at once from one prompt; each gets a colour of its own (theme.css, --session-1 to 5). */
export const MAX_SESSIONS = 5;

/** The runs at work: as the bridge last said, or in the demo, those still running. */
export function workingRuns(): Run[] {
  if (!S.CONN) return S.RUNS.filter(r => r.status === 'running');
  return S.WORKING.map(id => S.RUNS.find(r => r.id === id)).filter(r => !!r);
}

/**
 * Where a session on a section can change files: kept inside by the system; asked before each edit outside, its
 * commands not held; or anywhere, each change outside flagged.
 */
export const reachOf = (stays: boolean, asks = false) =>
  stays
    ? t('Stays inside your selection')
    : asks
      ? t('Asks before editing outside your selection; its commands can still change files there.')
      : t("Can change files outside your selection. You'll see each one flagged.");

/** Whether a session about to start on `scope` is locked to it: the person's choice, where the agent can be. */
export const lockChoice = (scope: string[]) =>
  scope.length && S.LIVE_AGENTS?.[st.agent]?.lockable ? !st.lockOff : undefined;

/** The writes a session at work asked to make outside its section, not yet answered. */
export const asking = (r: Run) => (r.status === 'running' ? (r.wants ?? []).filter(w => !w.answer) : []);
/**
 * What a session asks, in a line: a file to change, a command to run, or a tool to use. With which session asks it,
 * on its card and in a notice; on the map, under the label that already names the session, without (`named` false).
 */
export const wantSaid = (r: Run, w: Want, named = true) => {
  const who = { agent: agentOf(r.agent).name, id: r.id };
  const change = !w.ask || (w.path && w.tool !== 'Bash');
  if (!named)
    return change
      ? t('Wants to change {file}', { file: w.path })
      : w.tool === 'Bash'
        ? t('Wants to run {command}', { command: w.said ?? '' })
        : t('Wants to use {tool}', { tool: w.tool ?? '' });
  return change
    ? t('{agent} in run {id} wants to change {file}', { ...who, file: w.path })
    : w.tool === 'Bash'
      ? t('{agent} in run {id} wants to run {command}', { ...who, command: w.said ?? '' })
      : t('{agent} in run {id} wants to use {tool}', { ...who, tool: w.tool ?? '' });
};

/** The other session at work whose section holds a file: until it ends, the file can't join another section. */
export const holderOf = (r: Run, path: string) =>
  workingRuns().find(o => o !== r && !!o.scope?.length && covers(o.scope, path));

/** A session's colour, 1 to 5 (theme.css --session-1 to 5). */
export const sessionSlot = (run: Run) => ((run.slot ?? run.id) % MAX_SESSIONS) + 1;
export const sessionColour = (run: Run) => `var(--session-${sessionSlot(run)})`;

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
/** Each run's status as the app last saw it: a run seen at work that has since ended without finishing is marked. */
const lastStatus = new Map<number, string>();
/** Another repository, or the demo again: its runs of the same numbers are other runs. */
export function forgetSessions() {
  ended.clear();
  noted.clear();
  lastStatus.clear();
}
/** Marks a session as ended, once. */
export function markEnded(id: number) {
  if (noted.has(id)) return;
  noted.add(id);
  ended.add(id);
}
/** The person looked at a run: its mark goes, and isn't brought back by a state event that arrives later. */
export function seen(id: number) {
  noted.add(id);
  ended.delete(id);
}
/**
 * Notes the sessions that ended without finishing since the app last saw them at work, from each run's own status:
 * never from the list of sessions at work, which can change before or after the run's status does.
 */
export function noteEnded(runs: Pick<Run, 'id' | 'status' | 'limited'>[]) {
  for (const r of runs) {
    if (lastStatus.get(r.id) === 'running' && endedAs(r)) markEnded(r.id);
    lastStatus.set(r.id, r.status);
  }
}
