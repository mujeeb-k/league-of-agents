// The agents at work: each run's session, started with its scope, cancelled on request, and its run finished when
// the agent stops. Every agent is handled this way (agents/registry.mjs connectorOf).
import fs from 'node:fs';
import path from 'node:path';
import { logError, refused, serial } from './util.mjs';
import { inScope, scopeEntry } from './scope.mjs';
import { ROOT, LOA } from './repo.mjs';
import { finishRun, push, saveRun, working } from './runs.mjs';
import { emitRun } from './events.mjs';
import { forgetSandbox, lockOfRun, prepareSandbox } from './sandbox.mjs';
import { forgetShell } from './shell.mjs';
import { connectorOf, lockOf } from './agents/registry.mjs';

/** Each run's agent at work, and its run finishing once the agent stops. */
/** @type {Map<number, { cancel(): void; finished: Promise<void> }>} */
const sessions = new Map();

/**
 * The scope, written above the prompt, and the sections other sessions are working on. A session whose writes outside
 * its scope are refused (macOS's sandbox, Claude Code's scope lock, a harness that asks) is told it may try one: the
 * person is asked, and it is told to carry on if they allow it. Any other is told its changes outside are reported.
 */
function scopePreamble(run) {
  const { scope } = run;
  const others = [...working.values()]
    .filter(r => r !== run)
    .flatMap(r => (r.scope ?? []).map(s => scopeEntry(s).path));
  const parallel = others.length
    ? `Other sessions are working at the same time on: ${[...new Set(others)].join(', ')}. Leave their files as they are.\n`
    : '';
  if (!scope?.length) return parallel && parallel + '\n';
  const line = s => {
    const e = scopeEntry(s);
    return e.from
      ? `- ${e.path}, lines ${e.from} to ${e.to} only: keep every other line of this file as it is`
      : '- ' + s;
  };
  const asked = lockOfRun(run) === 'sandbox' || lockOf(run.agent) !== 'none';
  const outside = asked
    ? 'A write outside it is refused, and the user is asked whether you may make it. If you need a file outside it, ' +
      "try the edit once, then carry on inside the scope; you'll be told if they allow it."
    : 'Changes outside it are reported to the user and can be undone.';
  return `Scope for this task:\n${scope.map(line).join('\n')}\nEdit only inside this scope. ${outside}\n${parallel}\n`;
}
const scopeFileOf = run => path.join(LOA, `scope-${run.id}.json`);
/**
 * Starts the run's agent on its prompt, with the scope above it. The scope lock's file holds the scope, and for line
 * ranges each file as the run found it (`read`: as read when its lines were found).
 */
export async function startSession(run, read = {}) {
  const ranges = {};
  for (const e of (run.scope || []).map(scopeEntry))
    if (e.from)
      ranges[e.path] = {
        from: e.from,
        to: e.to,
        before: read[e.path] ?? fs.readFileSync(path.join(ROOT, e.path), 'utf8'),
      };
  // Each run's own: Claude Code's hooks find it by the environment the run starts them with.
  fs.writeFileSync(scopeFileOf(run), JSON.stringify({ scope: run.scope || [], ranges }));
  await turn(run, scopePreamble(run) + run.prompt);
}
/**
 * One turn of the run's agent. When it stops, the run carries on if the person allowed a file it asked for, waits if
 * one is still asked, and otherwise is finished: as cancelled or interrupted if it was stopped so, or as the agent's
 * outcome.
 */
async function turn(run, prompt) {
  if (lockOfRun(run) === 'sandbox')
    try {
      await prepareSandbox(run);
    } catch (e) {
      push(run, { t: 'err', text: `The sandbox for this section couldn't be set up: ${e.message}` });
      await end(run, 'failed');
      return;
    }
  const { cancel, done } = connectorOf(run.agent).start(run, prompt, scopeFileOf(run));
  const session = { cancel, finished: Promise.resolve() };
  session.finished = done
    .then(outcome => {
      if (sessions.get(run.id) === session) sessions.delete(run.id);
      if (['cancelled', 'interrupted'].includes(run.status)) return end(run, run.status);
      if (outcome === 'failed' && limitedBy(run)) run.limited = true;
      return afterAnswers(run, outcome);
    })
    .catch(logError);
  sessions.set(run.id, session);
}
/**
 * With its agent stopped: the run carries on once the person allowed a file it asked for, waits while one is still
 * asked, and is finished once every one is answered and none allowed.
 */
function afterAnswers(run, outcome) {
  const wants = run.wants ?? [];
  if (wants.some(w => w.answer === 'allowed' && !w.told)) return carryOn(run);
  if (wants.some(w => !w.answer)) {
    run.waiting = outcome;
    saveRun(run);
    emitRun(run);
    return;
  }
  return end(run, outcome);
}
/** The same session, resumed: told which files it may now change and which it may not, and to carry on. */
function carryOn(run) {
  const told = (answer, words) => {
    const files = run.wants.filter(w => w.answer === answer && !w.told);
    for (const w of files) w.told = true;
    return files.length ? words(files.map(w => w.path).join(', ')) : '';
  };
  const allowed = told('allowed', f => `You may now change ${f}. `);
  const left = told('refused', f => `Leave ${f} as it is. `);
  run.waiting = null;
  saveRun(run);
  emitRun(run);
  return turn(run, scopePreamble(run) + allowed + left + 'Carry on where you stopped.');
}
async function end(run, status) {
  fs.rmSync(scopeFileOf(run), { force: true });
  forgetSandbox(run);
  forgetShell(run);
  await finishRun(run, status);
}
/**
 * The person answers a write the run asked to make outside its section. Allowed, the file joins its section (the
 * whole file, for one it had lines of), unless another session at work holds it; refused, it stays out. A run waiting
 * on it carries on, waits for the rest, or is finished.
 */
export async function answerWant(run, file, allow) {
  await serial(async () => {
    const want = run.status === 'running' && run.wants?.find(w => w.path === file && !w.answer);
    if (!want) throw refused('answered', 'That was already answered.');
    if (allow) {
      const holder = [...working.values()].find(r => r !== run && r.scope?.length && inScope(r.scope, file));
      if (holder) throw refused('held', `Run ${holder.id} is working on ${file}.`, { id: holder.id, path: file });
      run.scope = [...run.scope.filter(s => scopeEntry(s).path !== file), file];
      const scopeFile = scopeFileOf(run);
      const lock = JSON.parse(fs.readFileSync(scopeFile, 'utf8'));
      delete lock.ranges[file];
      fs.writeFileSync(scopeFile, JSON.stringify({ ...lock, scope: run.scope }));
    }
    want.answer = allow ? 'allowed' : 'refused';
    saveRun(run);
    emitRun(run);
  });
  if (run.waiting && !sessions.has(run.id)) await afterAnswers(run, run.waiting);
}
/** What an agent says when its provider stopped it for its rate or usage limit: told apart from other failures. */
const LIMITED = /\b429\b|rate[ _-]?limit|usage limit|quota exceeded|too many requests/i;
const limitedBy = run =>
  LIMITED.test([run.summary, ...run.stream.filter(e => e.t === 'err').map(e => e.text)].join('\n'));
/**
 * Stops a run's agent at the person's request, or a run waiting for the person; false when no agent is at work on it
 * (a captured turn).
 */
export function cancelSession(run) {
  const session = sessions.get(run.id);
  if (!session && !run.waiting) return false;
  run.status = 'cancelled';
  if (session) session.cancel();
  else end(run, 'cancelled').catch(logError);
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
