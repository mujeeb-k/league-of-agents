// The agents at work: each run's session, started with its scope, cancelled on request, and its run finished when
// the agent stops. Every agent is handled this way (agents/registry.mjs connectorOf).
import fs from 'node:fs';
import path from 'node:path';
import { logError } from './util.mjs';
import { scopeEntry } from './scope.mjs';
import { ROOT, LOA } from './repo.mjs';
import { finishRun } from './runs.mjs';
import { connectorOf, lockOf } from './agents/registry.mjs';

/** Each run's agent at work, and its run finishing once the agent stops. */
/** @type {Map<number, { cancel(): void; finished: Promise<void> }>} */
const sessions = new Map();

/**
 * The scope, written above the prompt. What it says holds for every agent: changes outside the scope are reported
 * and can be undone. Only Claude Code's edit tools are blocked outside it, by the scope lock (runHook 'pre'), which
 * is one of the hooks: without them, Claude Code isn't told it is blocked.
 */
function scopePreamble(scope, agent) {
  if (!scope?.length) return '';
  const line = s => {
    const e = scopeEntry(s);
    return e.from
      ? `- ${e.path}, lines ${e.from} to ${e.to} only: keep every other line of this file as it is`
      : '- ' + s;
  };
  const blocked = lockOf(agent) === 'hooks' ? '\nEdits outside it made with edit tools are blocked.' : '';
  return `Scope for this task:\n${scope.map(line).join('\n')}\nEdit only inside this scope. Changes outside it are reported to the user and can be undone.${blocked}\n\n`;
}
/**
 * Starts the run's agent on its prompt, with the scope above it. The scope lock's file holds the scope, and for line
 * ranges each file as the run found it (`read`: as read when its lines were found). When the agent stops, its run is
 * finished, as cancelled or interrupted if it was stopped so, or as the agent's outcome.
 */
export function startSession(run, read = {}) {
  const prompt = scopePreamble(run.scope, run.agent) + run.prompt;
  const scopeFile = path.join(LOA, 'scope.json');
  const ranges = {};
  for (const e of (run.scope || []).map(scopeEntry))
    if (e.from)
      ranges[e.path] = {
        from: e.from,
        to: e.to,
        before: read[e.path] ?? fs.readFileSync(path.join(ROOT, e.path), 'utf8'),
      };
  fs.writeFileSync(scopeFile, JSON.stringify({ scope: run.scope || [], ranges }));
  const { cancel, done } = connectorOf(run.agent).start(run, prompt, scopeFile);
  const finished = done
    .then(outcome => {
      fs.rmSync(scopeFile, { force: true });
      return finishRun(run, ['cancelled', 'interrupted'].includes(run.status) ? run.status : outcome);
    })
    .catch(logError)
    .finally(() => sessions.delete(run.id));
  sessions.set(run.id, { cancel, finished });
}
/** Stops a run's agent at the person's request; false when no agent is at work on it (a captured turn). */
export function cancelSession(run) {
  const session = sessions.get(run.id);
  if (!session) return false;
  run.status = 'cancelled';
  session.cancel();
  return true;
}
/**
 * Stops every agent at work as the bridge stops, and waits up to 5 s for their runs to be finished. False when no
 * agent was at work.
 */
export async function stopSessions() {
  const finished = [...sessions.values()].map(s => {
    s.cancel();
    return s.finished;
  });
  await Promise.race([Promise.all(finished), new Promise(r => setTimeout(r, 5000))]);
  return finished.length > 0;
}
