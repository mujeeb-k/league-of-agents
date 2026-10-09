// Each run's steps (bridge/lib/steps.mjs), and what sessions at work have changed so far, drawn on the map as each
// edit lands (lib/model.ts viewOf). Data only: the watching itself, which needs the browser, is state/watch.ts.
import type { StepDTO } from '../api/types';
import type { Change } from './types';
import { S, st } from '../state/app';
import { changedBlock } from './textdiff';

const steps = new Map<number, StepDTO[]>();

/** A run's steps so far, in order (holes where one is still to be fetched). */
export const stepsOf = (id: number): StepDTO[] => steps.get(id) ?? [];

/**
 * Steps of a run as they arrive, added or replacing those with the same index. True when one came before the steps
 * ahead of it did (a progress event was missed): the caller fetches them.
 */
export function addSteps(id: number, list: StepDTO[]): boolean {
  const known = steps.get(id) ?? [];
  for (const s of list) known[s.i] = s;
  steps.set(id, known);
  return known.length !== known.filter(Boolean).length;
}

/** The files a run's steps read and never edited: the places it looked at, shown with its changes. */
export function readOnly(id: number): Set<string> {
  const read = new Set<string>(),
    edited = new Set<string>();
  for (const s of stepsOf(id)) {
    if (s?.file && s.act === 'edit') edited.add(s.file);
    else if (s?.file && s.act === 'read') read.add(s.file);
  }
  for (const f of edited) read.delete(f);
  return read;
}

/** Whether a run is still at work, live or in the demo. */
const working = (id: number) => S.RUNS.find(r => r.id === id)?.status === 'running';

/**
 * Each file a session at work has edited, as its latest edit left it against the file as the run found it: drawn on
 * the map as it lands, until the run ends with its changes.
 */
const live = new Map<string, { run: number; i: number; change: Change }>();

/** A step picked in the open run's timeline: its file as that step left it, against the file as the run found it. */
let moment: { run: number; i: number; path: string; change: Change } | null = null;

/** The step picked for a file of the open run, if one is. */
export const momentOf = (path: string) => (moment?.path === path && st.run?.id === moment.run ? moment : null);

/** Shows a file of a run as one of its steps left it (`before` and `now`), or, with null, as the run left it. */
export function setMoment(run: number, i: number, path: string, before: string[], now: string[]): void;
export function setMoment(none: null): void;
export function setMoment(run: number | null, i = 0, path = '', before: string[] = [], now: string[] = []) {
  if (run === null) {
    moment = null;
    return;
  }
  const hunk = changedBlock(before, now);
  moment = {
    run,
    i,
    path,
    change: { created: false, deleted: false, pre: before, hunks: hunk ? [hunk] : [], lines: [] },
  };
}

/**
 * What to draw for a file besides an open run's changes: a step picked in its timeline, or what a session at work
 * has changed so far (on the map, or with that session open).
 */
export function liveChange(path: string): Change | undefined {
  const m = momentOf(path);
  if (m) return m.change;
  const l = live.get(path);
  if (!l || !working(l.run) || (st.run && st.run.id !== l.run)) return undefined;
  return l.change;
}

/** An edit of step i landed: drawn unless a later edit of the file got there first. False when nothing changed. */
export function setLive(run: number, i: number, path: string, before: string[], now: string[]): boolean {
  const was = live.get(path);
  if (was && was.run === run && was.i > i) return false;
  const hunk = changedBlock(before, now);
  if (hunk)
    live.set(path, { run, i, change: { created: false, deleted: false, pre: before, hunks: [hunk], lines: [] } });
  else live.delete(path);
  return true;
}

/** The runs that ended: what their sessions drew goes, their changes take its place. */
export function forgetEnded() {
  for (const [p, l] of live) if (!working(l.run)) live.delete(p);
}

/** Another repository, or the demo again: runs of the same number are other runs, so what was kept of them goes. */
export function forgetAll() {
  steps.clear();
  live.clear();
  moment = null;
}
