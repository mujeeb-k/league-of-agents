// Who wrote each line of the files a run changed, kept for the run's attribution (web/src/lib/attribution.ts): by
// what changed on disk while each session worked, whatever the tool (linesOf). What an agent's edit tools put in is
// noted too, to tell its edit tools' lines from those of its commands.
import path from 'node:path';
import { ROOT, gitAsync } from '../repo.mjs';
import { realish } from '../util.mjs';
import { inScope } from '../scope.mjs';

/**
 * The lines Claude Code wrote itself, per file, from its edit tools' input: what Edit, MultiEdit and Write put
 * in. Kept for the run's attribution; lines it changed any other way (shell commands, scripts) aren't here.
 */
const writes = new Map();
export function noteWrites(run, name, input) {
  if (!/^claude/.test(run.agent) || !input?.file_path) return;
  const texts =
    name === 'Write'
      ? [input.content]
      : name === 'Edit'
        ? [input.new_string]
        : name === 'MultiEdit'
          ? (input.edits || []).map(e => e.new_string)
          : [];
  noteLines(run, input.file_path, texts);
}
/** Lines an agent wrote into a file, by the path it named, kept for the run's attribution (agentLinesOf). */
export function noteLines(run, file, texts) {
  // Agents name files by the path they were given, which may run through a symlink (macOS's /var is /private/var).
  const rel = path
    .relative(ROOT, realish(path.resolve(ROOT, file)))
    .split(path.sep)
    .join('/');
  if (!writes.has(run.id)) writes.set(run.id, new Map());
  const files = writes.get(run.id);
  // Named even when it added no line: a file it emptied or deleted is still its own.
  if (!files.has(rel)) files.set(rel, []);
  for (const t of texts) if (typeof t === 'string') files.set(rel, [...(files.get(rel) || []), ...t.split('\n')]);
}
/** Above every run id: a line an unseen-start edit of run (o - MAYBE) may have written. */
const MAYBE = 1e9;
/** git's empty blob, standing for a file that isn't there. */
const EMPTY = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
/** The hunks from one blob to another, as [old start, old count, new count], 0-based. None for binary files. */
async function hunksBetween(a, b) {
  if (a === b) return [];
  let out;
  try {
    out = await gitAsync(['diff', '--no-color', '--no-ext-diff', '--diff-algorithm=myers', '-U0', a, b]);
  } catch {
    return [];
  }
  const hunks = [];
  for (const m of out.matchAll(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@/gm)) {
    const del = Number(m[2] ?? 1);
    // "-N,0" names the line an addition comes after; "-N,k" the first line removed.
    hunks.push([del ? Number(m[1]) - 1 : Number(m[1]), del, Number(m[3] ?? 1)]);
  }
  return hunks;
}
/** How many lines a blob has. */
const linesIn = async blob => {
  if (blob === EMPTY) return 0;
  const text = await gitAsync(['cat-file', 'blob', blob]);
  return text ? (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n').length : 0;
};
/** Each line's writer carried from one version of a file to the next: lines the change added are `who`'s. */
async function carry(owners, a, b, who) {
  // From nothing, every line is new; to nothing, none is left. (The empty blob may not be in the repo to diff.)
  if (a === b) return owners;
  if (a === EMPTY) return Array(await linesIn(b)).fill(who);
  if (b === EMPTY) return [];
  const hunks = await hunksBetween(a, b);
  if (!hunks.length) return owners;
  const out = [];
  let i = 0;
  for (const [at, del, add] of hunks) {
    out.push(...owners.slice(i, at));
    for (let k = 0; k < add; k++) out.push(who);
    i = at + del;
  }
  out.push(...owners.slice(i));
  return out;
}

/**
 * Who wrote the lines of each file a run changed, in the file as the run left it (VISION 31):
 * - an edit seen, with its own text, always wins: its lines are its session's (steps.mjs);
 * - a command the hooks bracketed (shell.mjs) gets the lines no seen edit explains, by a command, when no other
 *   writer touched the file while it ran; when one did, those lines are shared between them;
 * - a change no write seen explains is the one session's that could have written the file then (a session the sandbox
 *   keeps outside it couldn't), by a command; with more than one, or none, nobody can say: unknown.
 * A save from the map's editor is a write seen, and no session's.
 * Returns `agent`, the run's lines as [from, to] ranges; `command`, those of them not by its edit tools; `other`,
 * another session's lines, as [from, to, run], with a fourth 1 where by a command; `shared`, lines shared between
 * writers, as [from, to, runs] (0 for the person). `stepsOf` gives a run's steps, each edit's file already kept,
 * `blobAt` a file's blob in a snapshot, and `held` whether the sandbox holds a run to its section: from runs.mjs.
 */
export async function linesOf(run, peers, { stepsOf, blobAt, held }) {
  const texts = agentLinesOf(run);
  // Runs no agent made (watch mode's, saves from the map's editor) are no session: none of their lines is an agent's.
  const agentRun = r => r.agent !== 'detected' && r.agent !== 'you';
  if (!agentRun(run)) return { agent: {} };
  const sessions = [run, ...peers.filter(agentRun)];
  const made = r => stepsOf(r).filter(s => s?.act === 'edit' && s.file && s.blob && !s.refused);
  const agent = {},
    command = {},
    other = {},
    shared = {};
  for (const c of run.changes) {
    if (c.deleted) continue;
    // Its writes from when this run began: before that, others' lines are in the file as it found it.
    const writes = sessions
      .flatMap(r => [
        ...made(r)
          .filter(s => s.file === c.path && s.at >= run.startedAt)
          // From its call to its result: the edit landed somewhere between (steps.mjs stepDone).
          .map(s => ({
            start: s.at,
            end: s.end ?? s.at,
            from: s.late ? undefined : s.from,
            to: s.blob,
            run: r.id,
            edit: true,
          })),
        ...(r.wrote ?? [])
          .filter(w => w.file === c.path && w.at >= run.startedAt)
          .map(w => ({ start: w.start ?? w.at, end: w.at, from: w.from, to: w.to, run: r.id, edit: false })),
      ])
      // A save from the map's editor is a write seen too, and the person's.
      .concat(
        await Promise.all(
          peers
            .filter(r => r.agent === 'you' && r.endedAt && r.changes?.some(x => x.path === c.path))
            .map(async r => ({
              start: r.startedAt,
              end: r.endedAt,
              from: await blobAt(r.before, c.path),
              to: await blobAt(r.after, c.path),
              run: 0,
              edit: true,
            })),
        ),
      )
      // In the order each left the file: a command's end is after any write made while it ran.
      .sort((x, y) => x.end - y.end || x.run - y.run);
    const commands = writes.filter(w => !w.edit);
    /** A command's lines: its session's when no other writer touched the file while it ran; otherwise shared. */
    const byCommand = w => {
      const with_ = new Set(
        writes.filter(o => o.run !== w.run && o.end >= w.start && o.start <= w.end).map(o => o.run),
      );
      return with_.size ? sharedBy([w.run, ...with_]) : -w.run;
    };
    /**
     * Who wrote what changed between two moments with no write seen: a command of the file's running then, by its
     * rule; otherwise the one session that could have written the file then, by a command; otherwise nobody.
     */
    const unexplained = (t0, t1) => {
      const running = commands.filter(w => w.start < t1 && w.end >= t1);
      if (running.length === 1) return byCommand(running[0]);
      if (running.length) return sharedBy(running.map(w => w.run));
      const could = sessions.filter(
        r =>
          r.startedAt <= t1 &&
          (r.endedAt ?? Infinity) >= t0 &&
          // The sandbox keeps a held session's every write inside its section.
          !(held(r) && !inScope(r.scope ?? [], c.path)),
      );
      return could.length === 1 ? -could[0].id : 0;
    };
    // A line's writer: a run's id for its edit's line, the negative for its command's, MAYBE above a run's id for an
    // edit of its whose start wasn't seen, a shared mark, or 0 for nobody.
    let state = (await blobAt(run.before, c.path)) ?? EMPTY,
      t = run.startedAt;
    let owners = Array(await linesIn(state)).fill(0);
    for (const w of writes) {
      const to = w.to ?? EMPTY;
      if (w.edit && w.from === undefined) {
        // An edit whose start wasn't seen: what it found isn't known, so only its own text is surely its (below).
        owners = await carry(owners, state, to, MAYBE + w.run);
      } else if (w.edit) {
        owners = await carry(owners, state, w.from ?? EMPTY, unexplained(t, w.start));
        owners = await carry(owners, w.from ?? EMPTY, to, w.run);
      } else if (t <= w.start) {
        owners = await carry(owners, state, w.from ?? EMPTY, unexplained(t, w.start));
        owners = await carry(owners, w.from ?? EMPTY, to, byCommand(w));
      } else {
        // Other writes landed while it ran: its own is what changed from the file as they left it to its end.
        owners = await carry(owners, state, to, byCommand(w));
      }
      state = to;
      t = w.end;
    }
    owners = await carry(owners, state, (await blobAt(run.after, c.path)) ?? EMPTY, unexplained(t, Date.now()));
    // What its edit tools' own text holds is by its edit tools, whatever else could have written it then.
    const said = new Set(
      (texts?.[c.path] ?? []).flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, k) => a + k)),
    );
    owners = owners.map((o, i) => {
      if (
        said.has(i) &&
        (o === -run.id || o === MAYBE + run.id || (typeof o === 'string' && runsOf(o).includes(run.id)))
      )
        return run.id;
      return typeof o === 'number' && o >= MAYBE ? 0 : o || 0;
    });
    // Runs of lines `who` takes, each [from, to, writer]; `same` says when two neighbours are one range.
    const ranges = (who, same = (x, y) => x === y) => {
      const out = [];
      owners.forEach((o, i) => {
        if (!who(o)) return;
        const last = out.at(-1);
        if (last && last[1] === i - 1 && same(last[2], o)) last[1] = i;
        else out.push([i, i, o]);
      });
      return out;
    };
    const num = o => typeof o === 'number';
    // Its own lines, by its edit tools or not, as one range where they meet.
    const own = ranges(
      o => num(o) && Math.abs(o) === run.id,
      () => true,
    ).map(([a, b]) => [a, b]);
    if (own.length) agent[c.path] = own;
    const mineByCommand = ranges(o => o === -run.id).map(([a, b]) => [a, b]);
    if (mineByCommand.length) command[c.path] = mineByCommand;
    const theirs = ranges(o => num(o) && o !== 0 && Math.abs(o) !== run.id).map(([a, b, o]) =>
      o < 0 ? [a, b, -o, 1] : [a, b, o],
    );
    if (theirs.length) other[c.path] = theirs;
    const both = ranges(o => !num(o)).map(([a, b, o]) => [a, b, runsOf(o)]);
    if (both.length) shared[c.path] = both;
  }
  return {
    agent,
    ...(Object.keys(command).length ? { command } : {}),
    ...(Object.keys(other).length ? { other } : {}),
    ...(Object.keys(shared).length ? { shared } : {}),
  };
}

/** A mark for lines shared between writers (runs' ids, 0 for the person), and the writers it names. */
const sharedBy = ids => 'S' + [...new Set(ids)].sort((a, b) => a - b).join(',');
const runsOf = mark => mark.slice(1).split(',').map(Number);

/**
 * The run's added lines whose text its agent put in through its edit tools, per file, as [from, to] ranges of line
 * indexes in the file after the run; absent for agents whose tool input isn't read. The fallback of linesOf.
 */
function agentLinesOf(run) {
  const files = writes.get(run.id);
  writes.delete(run.id);
  if (!files) return undefined;
  const out = {};
  for (const c of run.changes) {
    const wrote = new Map();
    for (const l of files.get(c.path) || []) wrote.set(l, (wrote.get(l) || 0) + 1);
    const ranges = [];
    let shift = 0;
    for (const h of c.hunks) {
      h.add.forEach((l, i) => {
        if (!wrote.get(l)) return;
        wrote.set(l, wrote.get(l) - 1);
        const at = h.at + shift + i,
          last = ranges.at(-1);
        if (last && last[1] === at - 1) last[1] = at;
        else ranges.push([at, at]);
      });
      shift += h.add.length - h.del;
    }
    if (ranges.length) out[c.path] = ranges;
  }
  return out;
}
/** The files the run's agent named in its own edits so far. */
