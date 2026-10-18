// The lines an agent wrote itself, by its edit tools, kept for the run's attribution (web/src/lib/attribution.ts).
// A line is an agent's when it changed during an edit step that agent reported: between the file as the step found
// it and as it left it (steps.mjs keeps both). So it holds for every agent that reports its edits, and a change made
// between two steps, by another session, a command or a person, is never counted as the agent's. Where a run's edits
// were not seen as steps (a terminal turn captured afterwards), the text its edit tools put in is matched instead.
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
 * Who wrote the lines of each file a run changed, in the file as the run left it: `agent`, the run's own lines, as
 * [from, to] ranges; `other`, the lines another session's edit steps wrote while it worked, as [from, to, run].
 * From each edit step on the file, the run's and those of the sessions at work beside it (`peers`), in the order
 * they were made. A file with no step seen falls back to the text the run's edit tools put in (Claude Code's).
 * `agent` is absent for a run whose agent reported no edit at all. `stepsOf` gives a run's steps, each edit's file
 * already kept, and `blobAt` a file's blob in a snapshot: handed in by runs.mjs, which this module is imported by.
 */
export async function linesOf(run, peers, { stepsOf, blobAt }) {
  const texts = agentLinesOf(run);
  const made = r => stepsOf(r).filter(s => s?.act === 'edit' && s.file && s.blob && !s.refused);
  const mine = made(run);
  if (!texts && !mine.length) return {};
  const agent = {},
    other = {};
  for (const c of run.changes) {
    if (c.deleted) continue;
    // Peers' steps count from when this run began: before that, their lines are in the file as it found it.
    // A shell command's write (shell.mjs) is in the order too, credited to nobody: an agent's lines are only those an
    // edit step of its wrote.
    const commands = r =>
      (r.wrote ?? [])
        .filter(w => w.file === c.path && w.at >= run.startedAt)
        .map((w, i) => ({ at: w.at, i, from: w.from, blob: w.to ?? EMPTY, run: 0 }));
    const steps = [
      ...mine.filter(s => s.file === c.path).map(s => ({ ...s, run: run.id })),
      ...peers.flatMap(p =>
        made(p)
          .filter(s => s.file === c.path && s.at >= run.startedAt)
          .map(s => ({ ...s, run: p.id })),
      ),
      ...[run, ...peers].flatMap(commands),
    ].sort((x, y) => x.at - y.at || x.run - y.run || x.i - y.i);
    if (!steps.some(s => s.run === run.id)) {
      if (texts?.[c.path]) agent[c.path] = texts[c.path];
      if (!steps.length) continue;
    }
    let at = (await blobAt(run.before, c.path)) ?? EMPTY;
    let owners = Array(await linesIn(at)).fill(0);
    for (const s of steps) {
      // An edit whose start wasn't seen: what changed up to its end may be another's too. Of it, the run's are only
      // the lines its edit tool's own text holds (marked by the run's id, negative, until that is known below).
      if (s.late || s.from === undefined) {
        owners = await carry(owners, at, s.blob, s.run ? -s.run : 0);
        at = s.blob;
        continue;
      }
      const from = s.from ?? EMPTY;
      // What changed outside any step is nobody's.
      owners = await carry(owners, at, from, 0);
      owners = await carry(owners, from, s.blob, s.run);
      at = s.blob;
    }
    owners = await carry(owners, at, (await blobAt(run.after, c.path)) ?? EMPTY, 0);
    const said = new Set(
      (texts?.[c.path] ?? []).flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, k) => a + k)),
    );
    owners = owners.map((o, i) => (o < 0 ? (o === -run.id && said.has(i) ? run.id : 0) : o));
    const ranges = who => {
      const out = [];
      owners.forEach((o, i) => {
        if (!who(o)) return;
        const last = out.at(-1);
        if (last && last[1] === i - 1 && last[2] === o) last[1] = i;
        else out.push([i, i, o]);
      });
      return out;
    };
    const own = ranges(o => o === run.id).map(([a, b]) => [a, b]);
    if (steps.some(s => s.run === run.id)) {
      if (own.length) agent[c.path] = own;
    }
    const theirs = ranges(o => o !== 0 && o !== run.id);
    if (theirs.length) other[c.path] = theirs;
  }
  return { agent, ...(Object.keys(other).length ? { other } : {}) };
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
