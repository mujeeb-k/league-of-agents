// Watching the work: each run's steps as its agent makes them (bridge/lib/steps.mjs), where each session at work is
// (the file its latest step names), and the session the map follows. A step changes only the markers and the
// minimap's dots, never the scene.
import type { Run } from '../lib/types';
import { centreOn, fileBox } from '../lib/camera';
import { drawMini } from '../lib/minimap';
import { S, st } from './app';
import { bump, renderScene } from './render';
import { setLive, stepsOf } from '../lib/live';
import { workingRuns } from './sessions';

/** Where a session is: its latest step that names a file on the map. */
export function hereOf(run: Run) {
  const list = stepsOf(run.id);
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    if (s?.file && S.FILES.has(s.file)) return s;
  }
  return null;
}

/** Each session at work: the file it is on, and its latest step, which may name none (a command it runs). */
export const markers = () =>
  workingRuns().flatMap(run => {
    const at = hereOf(run),
      now = stepsOf(run.id).at(-1);
    return at && now ? [{ run, at, now }] : [];
  });

/** A step arrived or changed for a run: the markers move, and a followed session takes the map with it. */
export function stepped(run: Run) {
  bump('watch');
  drawMini();
  if (st.following === run.id) centreOnHere(run);
}

/** An edit landed: its step's file against the file as the run found it, drawn on the map. */
export function landed(run: Run, i: number, path: string, before: string[], now: string[]) {
  if (setLive(run.id, i, path, before, now)) redraw();
}

let pending = 0;
/** Edits that land together are drawn in one frame. */
const redraw = () => {
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(renderScene);
};

/** The map follows a session from file to file, or stops. */
export function follow(run: Run | null) {
  st.following = run?.id ?? null;
  bump('watch');
  bump('side');
  if (run) centreOnHere(run);
}

/** The person moved the map: it stops following. */
export function stopFollowing() {
  if (st.following !== null) follow(null);
}

/** The file a session is on, in the middle of the stage, at the zoom the person chose. */
function centreOnHere(run: Run) {
  const f = hereOf(run)?.file;
  const at = f ? S.FILES.get(f) : null;
  if (at) centreOn(fileBox(at));
}
