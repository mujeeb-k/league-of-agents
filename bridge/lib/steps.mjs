// A run's steps: each tool call its agent makes, as it makes it: what it does (reads, edits, runs a command), the
// file it names, and when. The map shows where each session is from them, and its timeline lists them. They are kept
// whole in .loa/runs/<id>.steps.jsonl, past the activity's last 400 lines and any restart. An edit's file, as the edit
// left it, is kept as a git blob, so the map can show it at that moment; at the run's end the blobs are pinned under
// refs/loa/runs/<id>/steps.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, RUNS_DIR, gitAsync } from './repo.mjs';
import { MAX_BYTES } from './files.mjs';
import { SECRET_FILES } from './snapshots.mjs';
import { emit } from './events.mjs';

/**
 * @typedef {{ i: number; at: number; act: 'read' | 'edit' | 'run' | 'other'; file?: string; tool: string;
 *   refused?: true; blob?: string }} Step
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
export const publicStep = ({ blob, ...s }) => (blob ? { ...s, text: true } : s);

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
 * secrets, nor one over the size the map opens.
 */
export function stepDone(run, i) {
  const s = live.get(run.id)?.[i];
  if (!s?.file) return;
  let text;
  try {
    const abs = path.join(ROOT, s.file);
    if (fs.statSync(abs).size > MAX_BYTES) return;
    text = fs.readFileSync(abs);
  } catch {
    return;
  }
  const key = `${run.id} ${s.file}`;
  const kept = (keeping.get(key) ?? Promise.resolve()).then(async () => {
    if (!(await keepable(s.file))) return;
    s.blob = (await gitAsync(['hash-object', '-w', '--stdin'], { input: text })).trim();
    record(run, s);
  });
  keeping.set(
    key,
    kept.catch(() => {}),
  );
}

/** Whether a file's text may be kept: not ignored, and not an untracked file that usually holds secrets. */
async function keepable(file) {
  const dir = path.posix.dirname(file) === '.' ? '' : `${path.posix.dirname(file)}/`;
  const [ignored, secret] = await Promise.all([
    gitAsync(['ls-files', '--others', '--ignored', '--exclude-standard', '--', file]),
    gitAsync(['ls-files', '--others', '--exclude-standard', '--', ...SECRET_FILES.map(g => `:(glob)${dir}${g}`)]),
  ]);
  return !ignored.trim() && !secret.split('\n').includes(file);
}

/** The text of a step's file as its edit left it, or null for a step that kept none. */
export async function stepText(run, i) {
  const s = stepsOf(run)[i];
  return s?.blob ? gitAsync(['cat-file', 'blob', s.blob]) : null;
}

/**
 * The run ended: once every edit's file is kept, the blobs are pinned under refs/loa/runs/<id>/steps (a tree of
 * them, named by step), so git keeps them as long as the run.
 */
export async function pinSteps(run) {
  // A run closed after a restart has no steps in memory: those in its file.
  const steps = live.get(run.id) ?? stepsOf(run);
  live.delete(run.id);
  await Promise.all([...keeping.entries()].filter(([k]) => k.startsWith(`${run.id} `)).map(([, p]) => p));
  for (const k of [...keeping.keys()]) if (k.startsWith(`${run.id} `)) keeping.delete(k);
  const blobs = steps.filter(s => s.blob);
  if (!blobs.length) return;
  const tree = (
    await gitAsync(['mktree'], { input: blobs.map(s => `100644 blob ${s.blob}\t${s.i}`).join('\n') + '\n' })
  ).trim();
  await gitAsync(['update-ref', `refs/loa/runs/${run.id}/steps`, tree]);
}
