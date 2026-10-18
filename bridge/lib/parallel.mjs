// Sessions at once. Runs whose sections don't overlap work at the same time, and a run on the whole repository works
// alone. From the first of them starting to the last ending (an epoch), the baseline stays where it was. A file a
// session wrote (its edit tools named it, unrefused, or its shell commands changed it: shell.mjs) is that run's
// change, wherever the file is: inside another session's section, it is said on both runs. A file two sessions wrote
// is shared: said on both, each run's change only what its own writes did (writes.mjs), and left out of either's
// revert and commit unless the person chooses it. Whatever else changed in a run's own section while it worked is
// its own too, where no other session wrote it. When the last one ends, whatever changed that no run owns (an edit by
// hand, a command no hook bracketed) is recorded as a run of its own, credited to none of them.
import { line, refused, serial } from './util.mjs';
import { inScope, scopeEntry } from './scope.mjs';
import { CONF } from './repo.mjs';
import { runChecks } from './checks.mjs';
import { blobAt, commitWith, computeChanges, pin, snapshotNow } from './snapshots.mjs';
import { UNSEEN, changeOf, takeOut } from './writes.mjs';
import { runs, working, newRun, finishRun, saveRun } from './runs.mjs';
import { base, setBase, settle } from './watch.mjs';
import { emit, emitRun } from './events.mjs';
import { stepsOf } from './steps.mjs';

/**
 * The epoch under way: its baseline, whether runs overlapped in it, its runs, what each file should hold at its end
 * (`expected`, by the run's after that has it), and runs whose checks wait for its end. Nothing else writes the files
 * meanwhile: Commit and Revert wait until no session is working.
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

/** The other sessions of the epoch a run is in: those at work beside it, and those that were. */
export const peersOf = run => (epoch?.runs.includes(run) ? epoch.runs.filter(r => r !== run) : []);

/** Sessions that overlap leave the baseline where it was until the last one ends. */
export const keepsBaseline = run => !!run.overlapped;

/**
 * The files a run wrote: those its edit tools named and that were seen made, not refused or failed (steps.mjs), and
 * those its shell commands changed and kept (shell.mjs).
 */
const reported = run =>
  new Set([
    ...stepsOf(run).flatMap(s => (s?.act === 'edit' && s.file && s.blob && !s.refused ? [s.file] : [])),
    ...(run.wrote ?? []).map(w => w.file),
  ]);
/** A run's writes to a file as they were seen: its edit steps (a refused one is none) and its shell commands'. */
const seenWrites = (run, file) =>
  [
    ...stepsOf(run).flatMap(s =>
      s?.act === 'edit' && s.file === file && s.blob && !s.refused ? [{ at: s.at, from: s.from, to: s.blob }] : [],
    ),
    ...(run.wrote ?? []).filter(w => w.file === file).map(w => ({ at: w.at, from: w.from, to: w.to, start: w.start })),
  ].sort((a, b) => a.at - b.at);
/**
 * A run's own writes to a file, as [from, to, at] (writes.mjs). An edit whose start wasn't seen keeps it unseen
 * (UNSEEN): what it found is not guessed, so it is never taken out over another's lines.
 */
async function ownWrites(run, file) {
  const all = epoch.runs
    .flatMap(r => seenWrites(r, file).map(w => ({ ...w, from: w.from === undefined ? UNSEEN : w.from, run: r })))
    .sort((a, b) => a.at - b.at);
  /** @type {import('./writes.mjs').Write[]} */
  const own = [];
  for (const w of all) {
    if (w.run !== run) continue;
    // A shell command's write holds whatever changed while it ran (a test run, a build): another session's edits
    // made meanwhile are taken out of it. Where they can't be, what the command left isn't known apart from them.
    /** @type {import('./writes.mjs').Write[]} */
    const meanwhile = w.start
      ? all.filter(o => o.run !== run && o.at > w.start && o.at <= w.at).map(o => [o.from, o.to, o.at])
      : [];
    const to = meanwhile.length ? await takeOut(meanwhile, w.to) : { blob: w.to };
    own.push([w.from, 'blob' in to ? to.blob : UNSEEN, w.at]);
  }
  return own;
}
/** The other session of the epoch whose section holds a file. */
const holder = (run, file) => epoch.runs.find(r => r !== run && r.scope?.length && inScope(r.scope, file));

/**
 * The run's own changes, from all that changed while it worked. A run that worked alone owns them all: nothing
 * else writes the files meanwhile, Commit and Revert waiting until no session works. A run that overlapped owns the files it wrote (its edit steps, its bracketed
 * shell commands), wherever they are, and whatever else changed in its own section while it worked, unless another
 * session wrote that file: then it is that session's. Where another session wrote the file too, or it is in another's
 * section, the run's change is its own writes alone (writes.mjs). A file of its own inside another session's section
 * is said on both runs. What changed outside every section and no session wrote is said, and left for the epoch's
 * end.
 */
export async function ownChanges(run, changes) {
  if (!epoch || !run.overlapped) return changes;
  const sections = epoch.runs.flatMap(r => r.scope ?? []);
  // Each session's reported files, read once: an ended session's steps are read from disk.
  const names = new Map(epoch.runs.map(r => [r, reported(r)]));
  const named = names.get(run) ?? reported(run);
  const byAnother = file => epoch.runs.some(r => r !== run && names.get(r).has(file));
  // A reverted session no longer holds a file, but for the shared ones its revert left as they are.
  const holds = (r, file) => !r.reverted || !!r.left?.includes(file);
  const own = [],
    outside = [];
  /** Files of this run's inside another session's section, by that session. */
  const crossed = new Map();
  for (const c of changes) {
    // In its own section, what changed is its at least in part: what another session wrote there is taken out below.
    const mine = named.has(c.path) || inScope(run.scope, c.path);
    if (!mine) {
      if (!inScope(sections, c.path) && !byAnother(c.path)) outside.push(c.path);
    } else {
      // Another session wrote it too, or it is in another's section, where what changed besides isn't this run's: the
      // run's change is what its own writes did, on the file as the others left it, and those writes are kept for
      // its revert and its commit (runs.mjs, commit.mjs).
      if (named.has(c.path) && (byAnother(c.path) || !inScope(run.scope, c.path)) && !c.unseen) {
        const writes = await ownWrites(run, c.path);
        (run.writes ??= {})[c.path] = writes;
        const after = await blobAt(run.after, c.path);
        const base = await takeOut(writes, after);
        // Where a later write overlaps its own, or one wasn't seen whole, it is drawn from the file as its first write
        // found it, or as the run found it.
        const first = writes[0]?.[0];
        const from =
          'blob' in base
            ? base.blob
            : first === UNSEEN || first === undefined
              ? await blobAt(run.before, c.path)
              : first;
        if (from === after) continue;
        own.push(await changeOf(c.path, from, after));
      } else if (!named.has(c.path) && byAnother(c.path) && !c.unseen) {
        // In its section, changed by writes of its not seen (a command no hook brackets) and by another session's that
        // were: its change is the file as it left it without the other's writes. Where they can't be taken out, it
        // isn't known apart from them.
        const before = await blobAt(run.before, c.path),
          after = await blobAt(run.after, c.path);
        const others = epoch.runs
          .filter(r => r !== run)
          .flatMap(r => seenWrites(r, c.path))
          .map(w => /** @type {import('./writes.mjs').Write} */ ([w.from === undefined ? UNSEEN : w.from, w.to, w.at]));
        const mineOnly = await takeOut(others, after);
        const left = 'blob' in mineOnly ? mineOnly.blob : UNSEEN;
        if (left === before) continue;
        (run.writes ??= {})[c.path] = [[before, left, run.endedAt ?? Date.now()]];
        own.push(left === UNSEEN ? c : await changeOf(c.path, before, left));
        for (const r of epoch.runs)
          if (r !== run && names.get(r).has(c.path) && holds(r, c.path)) share(run, r, c.path);
      } else own.push(c);
      epoch.expected.set(c.path, run.after);
      const other = !inScope(run.scope, c.path) && holder(run, c.path);
      if (other) crossed.set(other, [...(crossed.get(other) ?? []), c.path]);
      if (named.has(c.path))
        for (const r of epoch.runs)
          if (r !== run && names.get(r).has(c.path) && holds(r, c.path)) share(run, r, c.path);
    }
  }
  for (const [other, files] of crossed) crossing(run, other, files.join(', '));
  if (outside.length)
    run.stream.push(
      line('warn', 'outside-sections', `Changed outside every section while others worked: ${outside.join(', ')}`, {
        files: outside.join(', '),
      }),
    );
  return own;
}

/**
 * A session changed files inside another session's section: said on both. The other may have ended already; its
 * record is saved again and sent.
 */
function crossing(run, other, files) {
  run.stream.push(
    line('warn', 'in-section-of', `Changed in run ${other.id}'s section: ${files}`, { id: other.id, files }),
  );
  other.stream.push(
    line('warn', 'by-session', `Run ${run.id} changed ${files} in this section. Those changes are run ${run.id}'s.`, {
      id: run.id,
      files,
    }),
  );
  if (other.status !== 'running') {
    saveRun(other);
    emitRun(other);
  }
}

/**
 * Two sessions wrote the same file (an edit step or a bracketed command each): shared, said on both, each naming the
 * other. Either may have ended already; its record is saved again and sent.
 */
function share(run, other, file) {
  for (const [r, o] of [
    [run, other],
    [other, run],
  ]) {
    r.shared ??= [];
    const entry = r.shared.find(s => s.path === file) ?? r.shared[r.shared.push({ path: file, with: [] }) - 1];
    if (entry.with.includes(o.id)) continue;
    entry.with.push(o.id);
    r.stream.push(line('warn', 'shared-file', `Run ${o.id} edited ${file} too.`, { id: o.id, files: file }));
    if (r !== run && r.status !== 'running') {
      saveRun(r);
      emitRun(r);
    }
  }
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
