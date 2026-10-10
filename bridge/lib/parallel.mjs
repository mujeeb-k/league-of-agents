// Sessions at once. Runs whose sections don't overlap work at the same time, and a run on the whole repository works
// alone. From the first of them starting to the last ending (an epoch), the baseline stays where it was. Each run owns
// the changes in its own section, and, for an agent that reports its edits, only the files those edits named. When
// the last one ends, whatever changed that no run owns (an edit by hand, an agent outside its section) is recorded as
// a run of its own, credited to none of them.
import { line, refused, serial } from './util.mjs';
import { inScope, scopeEntry } from './scope.mjs';
import { CONF } from './repo.mjs';
import { runChecks } from './checks.mjs';
import { blobAt, commitWith, computeChanges, pin, snapshotNow } from './snapshots.mjs';
import { runs, working, newRun, finishRun, saveRun } from './runs.mjs';
import { base, setBase, settle } from './watch.mjs';
import { emit, emitRun } from './events.mjs';
import { filesWritten } from './agents/lines.mjs';
import { reportsEdits } from './agents/registry.mjs';

/**
 * The epoch under way: its baseline, whether runs overlapped in it, its runs, what each file should hold at its end
 * (by the commit that has it: a run's after, or a reverted run's before), and runs whose checks wait for its end.
 * @type {{ base: any; overlapped: boolean; runs: any[]; expected: Map<string, string>; checks: any[] } | null}
 */
let epoch = null;

const area = s => scopeEntry(s).path;
/** Two sections overlap when one holds the other: "/" holds everything, a folder (ends in /) what is under it. */
const overlap = (a, b) =>
  a === '/' || b === '/' || a === b || (a.endsWith('/') && b.startsWith(a)) || (b.endsWith('/') && a.startsWith(b));
/** Why a run on this scope can't start now, as the error the app words, or null. */
export function clash(scope) {
  for (const r of working.values()) {
    if (!scope.length || !r.scope?.length) return refused('run-active', `Run ${r.id} is still active`, { id: r.id });
    for (const a of scope.map(area))
      for (const b of r.scope.map(area))
        if (overlap(a, b))
          return refused(
            'sections-overlap',
            `Run ${r.id} is working on ${b}. Pick a section outside it, or wait for it to finish.`,
            { id: r.id, path: b },
          );
  }
  return null;
}

/**
 * Where a run starting now begins. Alone, changes made before it are recorded on their own (`settle`), so they never
 * count as its agent's, and it begins on the baseline. With others at work, the baseline stays: it begins on a
 * snapshot of now.
 */
export async function startingPoint() {
  return working.size ? (await snapshotNow('run before')).commit : settle();
}
/** A run started: alone, it opens an epoch; with others at work, it joins theirs and every run in it overlaps. */
export function joinEpoch(run) {
  if (!working.size) {
    epoch = { base, overlapped: false, runs: [run], expected: new Map(), checks: [] };
    return;
  }
  epoch.overlapped = true;
  epoch.runs.push(run);
  for (const r of epoch.runs) r.overlapped = true;
}

/** Sessions that overlap leave the baseline where it was until the last one ends. */
export const keepsBaseline = run => !!run.overlapped;

/**
 * The run's own changes, from all that changed while it worked. A run that worked alone owns them all,
 * except what a revert during it wrote. A run that overlapped owns those in its own section and, if its agent reports
 * its edits, that those edits named; the rest is said, and left for the epoch's end.
 */
export async function ownChanges(run, changes) {
  if (!epoch) return changes;
  const reverted = async c =>
    epoch.expected.has(c.path) &&
    (await blobAt(epoch.expected.get(c.path), c.path)) === (await blobAt(run.after, c.path));
  if (!run.overlapped) {
    const own = [];
    for (const c of changes) if (!(await reverted(c))) own.push(c);
    return own;
  }
  const named = reportsEdits(run.agent) ? filesWritten(run) : null;
  const sections = epoch.runs.flatMap(r => r.scope ?? []);
  const own = [],
    notByAgent = [],
    outside = [];
  for (const c of changes) {
    if (!inScope(run.scope, c.path)) {
      if (!inScope(sections, c.path)) outside.push(c.path);
    } else if (named && !named.has(c.path)) notByAgent.push(c.path);
    else if (!(await reverted(c))) {
      own.push(c);
      epoch.expected.set(c.path, run.after);
    }
  }
  if (notByAgent.length)
    run.stream.push(
      line('warn', 'not-by-agent', `Changed in this section, not by its agent: ${notByAgent.join(', ')}`, {
        files: notByAgent.join(', '),
      }),
    );
  if (outside.length)
    run.stream.push(
      line('warn', 'outside-sections', `Changed outside every section while others worked: ${outside.join(', ')}`, {
        files: outside.join(', '),
      }),
    );
  return own;
}

/** A revert while runs work: what it wrote is the revert's, not theirs, and not left over at the epoch's end. */
export function noteRevert(run) {
  if (epoch) for (const c of [...run.changes, ...(run.unseen ?? [])]) epoch.expected.set(c.path, run.before);
}

/** A run's checks: now, or once the epoch ends when it overlapped others still at work. */
export function checksFor(run) {
  if (!run.changes.length || !CONF.checks?.length) return;
  if (run.overlapped) epoch.checks.push(run);
  else checkRuns([run]);
}
/** Runs the checks once and gives each run the same results. */
function checkRuns(list) {
  const [first] = list;
  for (const r of list) {
    r.checksRunning = true;
    emit('progress', r);
  }
  runChecks(first)
    .catch(e => first.checks.push({ name: 'checks', ok: false, summary: e.message }))
    .finally(() => {
      for (const r of list) {
        if (r !== first) r.checks = first.checks;
        r.checksRunning = false;
        saveRun(r);
        emitRun(r);
      }
    });
}

/** A run ended: an epoch ends with its last run. Its leftovers are worked out in the serial lane, with the snapshots. */
export function leaveEpoch() {
  if (!epoch || working.size) return;
  const e = epoch;
  epoch = null;
  if (e.overlapped) return serial(() => closeEpoch(e));
}
async function closeEpoch(e) {
  const now = await snapshotNow('after the sessions');
  const left = [];
  for (const c of await computeChanges(e.base.commit, now.commit)) {
    const from = e.expected.get(c.path);
    if (!from || (await blobAt(from, c.path)) !== (await blobAt(now.commit, c.path)))
      left.push([c.path, from ?? e.base.commit]);
  }
  setBase(now);
  if (left.length) {
    const leftover = newRun({ agent: 'detected' });
    leftover.before = await commitWith(now.commit, left, 'before what no session made');
    leftover.after = now.commit;
    const ids = e.runs.map(r => r.id).join(', ');
    leftover.stream.push(line('text', 'by-none', `Changed while runs ${ids} worked, by none of them.`, { runs: ids }));
    await pin(leftover.id, 'before', leftover.before);
    runs.set(leftover.id, leftover);
    await finishRun(leftover, 'done', { checks: false });
    if (leftover.changes.length && CONF.checks?.length) e.checks.push(leftover);
  }
  if (e.checks.length) checkRuns(e.checks);
}
