// When a session finishes or needs the person while they look elsewhere: a count in the tab's title until they come
// back, and, once they turn it on, a browser notification. The browser asks for permission only then, never on load.
import type { Run } from '../lib/types';
import { needsYou } from '../lib/model';
import { t } from '../i18n';
import { S, st } from './app';
import { bump } from './render';

const KEY = 'loa.notify';
/** The page's own title, without the count. */
let base: string | null = null;
let unseen = 0;

const away = () => document.hidden || !document.hasFocus();
const supported = () => typeof window !== 'undefined' && 'Notification' in window;

/** Whether notifications are on: asked for, and allowed by the browser. */
export function notifying(): boolean {
  try {
    return supported() && Notification.permission === 'granted' && localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

/** Turns notifications on (asking the browser, the first time) or off. */
export async function toggleNotifying() {
  const on = !notifying();
  if (on && supported() && Notification.permission !== 'granted') await Notification.requestPermission();
  try {
    localStorage.setItem(KEY, on && Notification.permission === 'granted' ? 'on' : 'off');
  } catch {
    // Storage refused (a private window): notifications stay off.
  }
  bump('side');
}

/** What the person is told of a session that ended: finished, failed or needing them; nothing if they stopped it. */
function noticeOf(r: Pick<Run, 'id' | 'status' | 'turn'>): string | null {
  if (needsYou(r as Run)) return t('Run {id} needs you', { id: r.id });
  if (r.status === 'done') return t('Run {id} finished', { id: r.id });
  if (r.status === 'failed' || r.status === 'interrupted') return t('Run {id} failed', { id: r.id });
  return null;
}

/**
 * The sessions that just stopped working, told to a person who isn't looking: a count in the title, and a
 * notification that opens the run when clicked.
 */
export function noticeEnded(
  before: number[],
  now: number[],
  runs: Pick<Run, 'id' | 'agent' | 'status' | 'turn' | 'title'>[],
  open: (id: number) => void,
) {
  if (!away()) return;
  for (const id of before) {
    const r = runs.find(x => x.id === id);
    // Sessions started from the map: not a save, watch mode, or a turn the person ran in their terminal or editor.
    const fromMap = r && !['you', 'detected'].includes(r.agent) && !/-(terminal|editor)$/.test(r.agent);
    const what = r && fromMap && !now.includes(id) ? noticeOf(r) : null;
    if (!r || !what) continue;
    unseen++;
    base ??= document.title;
    document.title = `(${unseen}) ${base}`;
    if (!notifying()) continue;
    const n = new Notification(what, { body: r.title, tag: `loa-run-${S.repoRoot}-${id}` });
    n.onclick = () => {
      window.focus();
      open(id);
    };
  }
}

/** Each write already told, by run and file: told once. */
const told = new Set<string>();
/** Another repository, or the demo again: nothing of it was told yet. */
export const forgetTold = () => told.clear();

/**
 * A session that asks to change a file outside its section, told to a person who isn't looking, as a session that
 * ended is: a count in the title, and a notification that shows the runs, where its card asks.
 */
export function noticeAsks(runs: Run[]) {
  for (const r of runs)
    for (const w of r.status === 'running' ? (r.wants ?? []) : []) {
      const key = `${r.id} ${w.path}`;
      if (w.answer || told.has(key)) continue;
      told.add(key);
      if (!away()) continue;
      unseen++;
      base ??= document.title;
      document.title = `(${unseen}) ${base}`;
      if (!notifying()) continue;
      const n = new Notification(t('Run {id} needs you', { id: r.id }), {
        body: t('Wants to change {file}', { file: w.path }),
        tag: `loa-want-${S.repoRoot}-${r.id}-${w.path}`,
      });
      n.onclick = () => {
        window.focus();
        st.tab = 'runs';
        bump('side');
      };
    }
}

/** Back on the page: the count goes. */
function seenAll() {
  if (away() || base === null) return;
  unseen = 0;
  document.title = base;
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', seenAll);
  window.addEventListener('focus', seenAll);
}
