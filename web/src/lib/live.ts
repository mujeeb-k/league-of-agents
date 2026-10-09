// What sessions at work have changed so far, drawn on the map as each edit lands (state/watch.ts fills it from the
// steps' files; lib/model.ts viewOf draws it). Kept apart from the watching itself, which needs the browser.
import type { Change } from './types';
import { S, st } from '../state/app';
import { changedBlock } from './textdiff';

/**
 * Each file a session at work has edited, as its latest edit left it against the file as the run found it: drawn on
 * the map as it lands, until the run ends with its changes.
 */
const live = new Map<string, { run: number; i: number; change: Change }>();

/** What a session at work has changed in a file so far, to draw: on the map, or with that session open. */
export function liveChange(path: string): Change | undefined {
  const l = live.get(path);
  if (!l || !S.WORKING.includes(l.run) || (st.run && st.run.id !== l.run)) return undefined;
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
  for (const [p, l] of live) if (!S.WORKING.includes(l.run)) live.delete(p);
}
