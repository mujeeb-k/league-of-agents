// Who wrote each line of the files a run changed, kept for the run's attribution (web/src/lib/attribution.ts): by
// what changed on disk while each session worked, whatever the tool (linesOf). What an agent's edit tools put in is
// noted too, to tell its edit tools' lines from those of its commands.
import path from 'node:path';
import { ROOT, gitAsync } from '../repo.mjs';
import { realish } from '../util.mjs';

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
 * Who wrote the lines of each file a run changed, in the file as the run left it, by what changed on disk while each
 * session worked, whatever the tool. Every write seen to the file is its session's: an edit step (from the file as it
 * found it to the file as it left it, steps.mjs) or a shell command the hooks bracketed (shell.mjs). What changed
 * where no write was seen is the one session's at work then; with more than one at work nobody can say, and it is
 * nobody's, whatever their sections. Of a run's own lines,
 * those its edit tools' text doesn't hold are marked as written by a command.
 * Returns `agent`, the run's lines as [from, to] ranges; `command`, those of them not by its edit tools; `other`,
 * another session's lines, as [from, to, run], with a fourth 1 where by a command. `stepsOf` gives a run's steps,
 * each edit's file already kept, and `blobAt` a file's blob in a snapshot: handed in by runs.mjs.
 */
export async function linesOf(run, peers, { stepsOf, blobAt }) {
  const texts = agentLinesOf(run);
  // Runs no agent made (watch mode's, saves from the map's editor) are no session: none of their lines is an agent's.
  const agentRun = r => r.agent !== 'detected' && r.agent !== 'you';
  if (!agentRun(run)) return { agent: {} };
  const sessions = [run, ...peers.filter(agentRun)];
  const made = r => stepsOf(r).filter(s => s?.act === 'edit' && s.file && s.blob && !s.refused);
  const agent = {},
    command = {},
    other = {};
  for (const c of run.changes) {
    if (c.deleted) continue;
    // Its writes from when this run began: before that, others' lines are in the file as it found it.
    const writes = sessions
      .flatMap(r => [
        ...made(r)
          .filter(s => s.file === c.path && s.at >= run.startedAt)
          .map(s => ({ start: s.at, end: s.at, from: s.late ? undefined : s.from, to: s.blob, run: r.id, edit: true })),
        ...(r.wrote ?? [])
          .filter(w => w.file === c.path && w.at >= run.startedAt)
          .map(w => ({ start: w.start ?? w.at, end: w.at, from: w.from, to: w.to, run: r.id, edit: false })),
      ])
      .sort((x, y) => x.start - y.start || x.run - y.run);
    /**
     * Who was writing the file between two moments, where no write of it was seen: the one session at work then, or
     * 0. A section says nothing of who wrote a file: in the owner's run Cursor wrote into Claude Code's.
     */
    const writer = (t0, t1) => {
      const at = sessions.filter(r => r.startedAt <= t1 && (r.endedAt ?? Infinity) >= t0);
      return at.length === 1 ? at[0].id : 0;
    };
    // A line's writer: the run's id, negative where not by an edit tool, or 0.
    let state = (await blobAt(run.before, c.path)) ?? EMPTY,
      t = run.startedAt;
    let owners = Array(await linesIn(state)).fill(0);
    for (const w of writes) {
      const to = w.to ?? EMPTY;
      if (w.from === undefined) {
        // An edit whose start wasn't seen: its session's only if no one else could have been writing the file.
        const who = writer(t, w.end);
        owners = await carry(owners, state, to, who === w.run ? w.run : 0);
      } else {
        owners = await carry(owners, state, w.from ?? EMPTY, -writer(t, w.start));
        owners = await carry(owners, w.from ?? EMPTY, to, w.edit ? w.run : -w.run);
      }
      state = to;
      t = w.end;
    }
    owners = await carry(owners, state, (await blobAt(run.after, c.path)) ?? EMPTY, -writer(t, Date.now()));
    // What its edit tools' own text holds is by its edit tools, though the step that wrote it wasn't seen whole.
    const said = new Set(
      (texts?.[c.path] ?? []).flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, k) => a + k)),
    );
    owners = owners.map((o, i) => (o === -run.id && said.has(i) ? run.id : o || 0));
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
    // Its own lines, by its edit tools or not, as one range where they meet.
    const own = ranges(
      o => Math.abs(o) === run.id,
      () => true,
    ).map(([a, b]) => [a, b]);
    if (own.length) agent[c.path] = own;
    const byCommand = ranges(o => o === -run.id).map(([a, b]) => [a, b]);
    if (byCommand.length) command[c.path] = byCommand;
    const theirs = ranges(o => o !== 0 && Math.abs(o) !== run.id).map(([a, b, o]) =>
      o < 0 ? [a, b, -o, 1] : [a, b, o],
    );
    if (theirs.length) other[c.path] = theirs;
  }
  return {
    agent,
    ...(Object.keys(command).length ? { command } : {}),
    ...(Object.keys(other).length ? { other } : {}),
  };
}

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
