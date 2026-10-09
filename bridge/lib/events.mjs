// Events, by long polling (it works where WebSockets get blocked): a run's progress, and state changes.
import { codeFiles, forgetFiles, isCode, treeEntry } from './files.mjs';
import { working, publicRun } from './runs.mjs';
import { takeSteps } from './steps.mjs';

export let seq = 0;
export const events = [];
export const waiters = new Set();
/**
 * A run finished or changed: a state event that also carries the run and its files as the map shows them now
 * (null for one no longer on it), so an app that asks for deltas updates without fetching the whole state.
 */
export function emitRun(run) {
  const { set } = codeFiles();
  // A code file the run made or removed: the list is made again (the watcher may be off, or not yet heard of it).
  if (run.changes.some(c => isCode(c.path) && c.deleted === set.has(c.path))) forgetFiles();
  const files = Object.fromEntries(
    run.changes.map(c => [c.path, isCode(c.path) && !c.deleted ? treeEntry(c.path) : null]),
  );
  const ids = [...working.keys()];
  emit('state', undefined, { run: publicRun(run), files, active: ids[0] ?? null, working: ids });
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
          model: run.model,
          // Its steps added or changed since its last progress event (steps.mjs).
          steps: takeSteps(run),
        }
      : undefined,
  });
  if (events.length > 500) events.splice(0, events.length - 500);
  for (const w of waiters) w();
  waiters.clear();
}
