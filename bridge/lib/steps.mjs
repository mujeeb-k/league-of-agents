// A run's steps: each tool call its agent makes, as it makes it: what it does (reads, edits, runs a command), the
// file it names, and when. The map shows where each session is from them, and its timeline lists them. They are kept
// whole in <id>.steps.jsonl in the runs folder, past the activity's last 400 lines and any restart. An edit's file, as
// the edit left it, is kept as a git blob, so the map can show it at that moment; at the run's end the blobs are
// pinned in the store under refs/loa/runs/<id>/steps. The file as the edit found it is kept too (`from`): what changed between the two is what
// that agent wrote, whatever else changed the file before or after (agents/lines.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, RUNS_DIR, gitAsync, keep } from './repo.mjs';
import { MAX_BYTES } from './files.mjs';
import { secretSpecs } from './snapshots.mjs';
import { emit } from './events.mjs';

/**
 * @typedef {{ i: number; at: number; act: 'read' | 'edit' | 'run' | 'other'; file?: string; tool: string;
 *   refused?: true; blob?: string; from?: string | null; late?: true }} Step
 * `from`: the file as the edit found it, a blob, or null for a file that wasn't there. `late`: the edit had landed
 * before the bridge heard of the call, so its start wasn't seen: it is taken to start from the file as last known.
 */

/** The steps of each run at work, by run. A finished run's are read from its file. */
const live = new Map();
/** Each run's steps added or changed since its last progress event (takeSteps). */
const unsent = new Map();

const fileOf = id => path.join(RUNS_DIR, `${id}.steps.jsonl`);

/** A run's steps: kept in memory while it works, read from its file after. Later lines for a step replace it. */
export function stepsOf(run) {
  if (live.has(run.id)) return live.get(run.id);
  /** @type {Step[]} */
  const steps = [];
  try {
    for (const line of fs.readFileSync(fileOf(run.id), 'utf8').split('\n'))
      if (line) {
        const s = JSON.parse(line);
        steps[s.i] = s;
      }
  } catch {}
  return steps;
}

/** Writes a step as it is now, and sends it with the run's next progress event. */
function record(run, s) {
  fs.appendFileSync(fileOf(run.id), JSON.stringify(s) + '\n');
  if (!unsent.has(run.id)) unsent.set(run.id, new Map());
  unsent.get(run.id).set(s.i, s);
  emit('progress', run);
}

/** The steps to send with a run's progress event: added or changed since the last one (events.mjs). */
export function takeSteps(run) {
  const changed = unsent.get(run.id);
  unsent.delete(run.id);
  return changed ? [...changed.values()].map(publicStep) : undefined;
}

/** A step as the app gets it: whether its file's text is kept, not where. */
export const publicStep = ({ blob, from, late, ...s }) => (blob ? { ...s, text: true } : s);

/** Each edit step's file as the bridge first heard of the call: read at once, before the edit can land. */
const found = new Map();
const read = file => {
  try {
    const abs = path.join(ROOT, file);
    return fs.statSync(abs).size > MAX_BYTES ? undefined : fs.readFileSync(abs);
  } catch {
    // Not there yet: a file the edit creates.
    return null;
  }
};

/**
 * A tool call the agent just made: a new step, its index returned. `file` is repo-relative, for a call that names
 * one.
 * @param {Step['act']} act
 */
export function step(run, act, tool, file) {
  if (!live.has(run.id)) live.set(run.id, stepsOf(run));
  const steps = live.get(run.id);
  /** @type {Step} */
  const s = { i: steps.length, at: Date.now(), act, tool, ...(file ? { file } : {}) };
  if (act === 'edit' && file) found.set(`${run.id} ${s.i}`, read(file));
  steps.push(s);
  record(run, s);
  return s.i;
}

/** A step's call was refused (an edit outside the section). */
export function stepRefused(run, i) {
  const s = live.get(run.id)?.[i];
  if (!s) return;
  s.refused = true;
  record(run, s);
}

/** Edits whose file is being kept, by run and file: the next waits for the one before (one file, one at a time). */
const keeping = new Map();

/**
 * An edit step done: its file, as the edit left it, kept as a blob. Read at once, before the agent's next edit can
 * change it, and kept only if git would snapshot it: not a file git ignores or an untracked one that usually holds
 * secrets, nor one over the size the map opens. An agent that says what the file was before and after its edit
 * (`exact`: Cursor) is taken at its word: what changed besides, before or after, isn't the edit's.
 * @param {{ before?: string; after?: string }} [exact]
 */
export function stepDone(run, i, exact = {}) {
  const s = live.get(run.id)?.[i];
  if (!s?.file) return;
  let text;
  try {
    const abs = path.join(ROOT, s.file);
    if (fs.statSync(abs).size > MAX_BYTES) return;
    text = typeof exact.after === 'string' ? Buffer.from(exact.after) : fs.readFileSync(abs);
  } catch {
    return;
  }
  const key = `${run.id} ${s.file}`;
  const seen = found.get(`${run.id} ${i}`);
  // A file the edit created: Cursor may say it was empty before, where it wasn't there.
  const start =
    typeof exact.before === 'string' && !(exact.before === '' && seen === null) ? Buffer.from(exact.before) : seen;
  found.delete(`${run.id} ${i}`);
  const kept = (keeping.get(key) ?? Promise.resolve()).then(async () => {
    if (!(await keepable(s.file))) return;
    // As git would keep the file at its path (its line-ending and clean filters), like a snapshot does.
    const hash = async bytes =>
      (await gitAsync(['hash-object', '-w', '--stdin', '--path', s.file], { input: bytes })).trim();
    s.blob = await hash(text);
    // The file as the edit found it. Read the same as it left it, the edit had landed before the call was heard
    // of (or changed nothing): its start wasn't seen.
    if (start === null) s.from = null;
    else if (start !== undefined) {
      const from = await hash(start);
      if (from === s.blob) s.late = true;
      else s.from = from;
    }
    record(run, s);
  });
  keeping.set(
    key,
    kept.catch(() => {}),
  );
}

/** Whether a file's text may be kept: not ignored, and not an untracked file that usually holds secrets. */
async function keepable(file) {
  const [ignored, secret] = await Promise.all([
    gitAsync(['ls-files', '--others', '--ignored', '--exclude-standard', '--', file]),
    gitAsync(['ls-files', '--others', '--exclude-standard', '--', ...secretSpecs([file])]),
  ]);
  return !ignored.trim() && !secret.split('\n').includes(file);
}

/** The text of a step's file as its edit left it, or null for a step that kept none. */
export async function stepText(run, i) {
  const s = stepsOf(run)[i];
  return s?.blob ? gitAsync(['cat-file', 'blob', s.blob]) : null;
}

/** Every edit of a run so far has its file kept: awaited before its lines are worked out. */
export const stepsKept = run =>
  Promise.all([...keeping.entries()].filter(([k]) => k.startsWith(`${run.id} `)).map(([, p]) => p));

/**
 * The run ended: once every edit's file is kept, the blobs are pinned in the store under refs/loa/runs/<id>/steps (a
 * tree of them, named by step), so they are kept as long as the run.
 */
export async function pinSteps(run) {
  // A run closed after a restart has no steps in memory: those in its file.
  const steps = live.get(run.id) ?? stepsOf(run);
  live.delete(run.id);
  await Promise.all([...keeping.entries()].filter(([k]) => k.startsWith(`${run.id} `)).map(([, p]) => p));
  for (const k of [...keeping.keys()]) if (k.startsWith(`${run.id} `)) keeping.delete(k);
  // Each edit's file as it found it and as it left it, and each shell command's (run.wrote, shell.mjs): what the
  // run's writes are taken out against (writes.mjs).
  const blobs = [
    ...steps.flatMap(s => [...(s.blob ? [[s.blob, `${s.i}`]] : []), ...(s.from ? [[s.from, `${s.i}-from`]] : [])]),
    ...(run.wrote ?? []).flatMap((w, k) =>
      [w.from, w.to].flatMap((b, j) => (b ? [[b, `command-${k}-${j ? 'to' : 'from'}`]] : [])),
    ),
  ];
  if (!blobs.length) return;
  const tree = (
    await gitAsync(['mktree'], { input: blobs.map(([b, name]) => `100644 blob ${b}\t${name}`).join('\n') + '\n' })
  ).trim();
  await keep(`refs/loa/runs/${run.id}/steps`, tree);
}
