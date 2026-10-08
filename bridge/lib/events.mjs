// Events, by long polling (it works where WebSockets get blocked): a run's progress, and state changes.
import { listFiles, treeEntry } from './files.mjs';
import { active, publicRun } from './runs.mjs';

export let seq = 0;
export const events = [];
export const waiters = new Set();
/**
 * A run finished or changed: a state event that also carries the run and its files as the map shows them now
 * (null for one no longer on it), so an app that asks for deltas updates without fetching the whole state.
 */
export function emitRun(run) {
  const shown = new Set(listFiles());
  const files = Object.fromEntries(run.changes.map(c => [c.path, shown.has(c.path) ? treeEntry(c.path) : null]));
  emit('state', undefined, { run: publicRun(run), files, active: active?.run.id ?? null });
}
export function emit(type, run, delta) {
  events.push({
    seq: ++seq,
    type,
    ...(delta ? { delta } : {}),
    run: run
      ? {
          id: run.id,
          status: run.status,
          stream: (run.stream || []).slice(-60),
          summary: run.summary,
          sessionId: run.sessionId,
          checks: run.checks,
          checksRunning: !!run.checksRunning,
          cost: run.cost,
          turn: run.turn,
        }
      : undefined,
  });
  if (events.length > 500) events.splice(0, events.length - 500);
  for (const w of waiters) w();
  waiters.clear();
}
