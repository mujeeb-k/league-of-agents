// The demo's sessions at work as it opens: their steps appear one by one, and each finishes with its changes and
// reply, as a live session does. `?still` in the address holds them at work, part way, for screenshots and tests.
import { applyChanges } from '../lib/model';
import type { Run, SampleRunDef } from '../lib/types';
import { toast } from '../ui/toast';
import { t } from '../i18n';
import { S, st } from '../state/app';
import { selectRun } from '../state/actions';
import { renderAll, renderInspector, renderSide } from '../state/render';
import { markEnded, opensOnFinish } from '../state/sessions';
import { DEMO_STAYS, SAMPLE_RUNS } from './sample';

/** Each session's timers, by run: its steps, then its end. */
const timers = new Map<number, number[]>();

/** Starts the demo's sessions at work: steps spread over their time, then their end. */
export function startDemoSessions() {
  stopDemoTimers();
  const still = new URLSearchParams(location.search).has('still');
  for (const def of SAMPLE_RUNS) {
    const run = def.working && S.RUNS.find(r => r.id === def.id);
    if (!run || !def.working) continue;
    run.stays = DEMO_STAYS.includes(run.agent);
    const { after, steps } = def.working;
    if (still) {
      for (const text of steps.slice(0, Math.ceil(steps.length / 2))) step(run, text);
      continue;
    }
    timers.set(run.id, [
      ...steps.map((text, i) => window.setTimeout(() => step(run, text), ((i + 1) * after) / (steps.length + 1))),
      window.setTimeout(() => finish(run, def), after),
    ]);
  }
}

function step(run: Run, text: string) {
  run.stream = [...(run.stream ?? []), { t: 'tool', text }];
  renderSide();
  if (st.run === run) renderInspector();
}

/** A session ends with its changes and reply; it opens unless the person reviews one that worked beside it. */
function finish(run: Run, def: SampleRunDef) {
  timers.delete(run.id);
  applyChanges(run, def);
  Object.assign(run, { status: 'done', summary: t(def.summary), dur: def.dur, endedAt: Date.now() });
  toast(t('Run {id} finished', { id: run.id }));
  if (opensOnFinish(run)) {
    st.mode = 'diff';
    selectRun(run);
  } else renderAll();
}

/** Stops one of the demo's sessions: no changes, marked on its section as stopped. */
export function stopDemoSession(run: Run) {
  for (const id of timers.get(run.id) ?? []) clearTimeout(id);
  timers.delete(run.id);
  Object.assign(run, { status: 'cancelled', endedAt: Date.now() });
  markEnded(run.id);
  toast(t('Stopped run {id}', { id: run.id }));
  renderAll();
}

/** No session moves on: the demo is left, or loaded again. */
export function stopDemoTimers() {
  for (const ids of timers.values()) for (const id of ids) clearTimeout(id);
  timers.clear();
}
