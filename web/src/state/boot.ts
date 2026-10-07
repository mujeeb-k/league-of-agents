// Global listeners and startup.
import { localAccess } from '../api/access';
import { BLOCKED, UNREACHABLE } from '../api/errors';
import { connect, tickTimes } from '../api/live';
import { loadConn, parseConn } from '../api/conn';
import { startAnalytics } from '../lib/analytics';
import type { Conn } from '../api/types';
import { applyView, flyAll, flyRun, flySelection, viewCenter, zoomAt } from '../lib/camera';
import { readCss } from '../lib/minimap';
import { openPalette } from '../components/Palette';
import { retheme } from '../components/TopBar';
import { S, dom, st } from './app';
import { loadDemo, selectRun, setMode, stepReview, toggleByAuthor, toggleReviewed } from './actions';
import { closeEditor, ed, openEditor } from './editing';
import { renderAll, renderSel, renderSide, setConnUI } from './render';
import { applyPanels, toggleInsp, toggleSide } from './panels';
import { watchSystemTheme } from './theme';

function onKey(e: KeyboardEvent) {
  // Handled already, as by the code editor (⌘K on selected lines writes an instruction).
  if (e.defaultPrevented) return;
  // ⌘P and ⌘K (Ctrl on Windows and Linux) work everywhere, the prompt included.
  const mod = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
  if (mod && (e.key === 'p' || e.key === 'k')) {
    e.preventDefault();
    openPalette(e.key === 'p' ? 'files' : 'commands');
    return;
  }
  // An open menu or dialog handles its own keys; Escape there closes only that menu or dialog.
  if ((e.target as Element).closest?.('[role="menu"],[role="dialog"]')) return;
  const t = e.target as HTMLElement;
  // The code editor handles its own keys.
  if (t.isContentEditable) return;
  if (/TEXTAREA|INPUT/.test(t.tagName)) {
    if (e.key === 'Escape') t.blur();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const center = (f: number) => zoomAt(...viewCenter(), f);
  if (st.run && 'bad'.includes(k) && k.length === 1) {
    setMode(({ b: 'before', a: 'after', d: 'diff' } as const)[k as 'b' | 'a' | 'd']);
  } else if (st.run && (k === 'j' || k === 'arrowdown')) {
    e.preventDefault();
    stepReview(1);
  } else if (st.run && (k === 'k' || k === 'arrowup')) {
    e.preventDefault();
    stepReview(-1);
  } else if (st.run && k === 'r') toggleReviewed(st.cur);
  else if (k === 'escape') {
    if (ed.path) closeEditor();
    else if (st.sel.size) {
      st.sel.clear();
      renderSel();
    } else if (st.run) selectRun(null);
  } else if (
    k === 'enter' &&
    (t === document.body || t === dom.stage) &&
    st.sel.size === 1 &&
    S.FILES.has([...st.sel][0]!)
  ) {
    e.preventDefault();
    void openEditor([...st.sel][0]!);
  } else if (k === 'c' && S.ROOT) toggleByAuthor();
  else if (k === '0') flyAll();
  else if (k === 'f') {
    if (st.sel.size) flySelection();
    else if (st.run) flyRun(st.run);
    else flyAll();
  } else if (k === '=' || k === '+') center(1.4);
  else if (k === '-') center(1 / 1.4);
  else if (k === '[') toggleSide();
  else if (k === ']') toggleInsp();
  else if (k === '/') {
    e.preventDefault();
    dom.prompt.focus();
  }
}

/**
 * Connects to the bridge a link or saved connection points at. "Connecting" shows instead of flashing the
 * demo first, and a bridge that doesn't answer is said so on the canvas: the app never falls back to the
 * demo on its own, so a live repository is never mistaken for sample data.
 */
export function startConnect(target: Conn, explained = false) {
  st.starting = true;
  st.unreachable = null;
  st.asking = null;
  renderAll();
  void (async () => {
    const access = await localAccess(target);
    // The browser is about to ask: say what it will ask, and why, before it does (StageState).
    if (access === 'prompt' && !explained) {
      st.starting = false;
      st.asking = target;
      renderAll();
      setConnUI();
      return;
    }
    let why = access === 'denied' ? BLOCKED : await connect(target, true);
    // Refused at the prompt just now: say so, rather than that nothing answered.
    if (why === UNREACHABLE && (await localAccess(target)) === 'denied') why = BLOCKED;
    st.starting = false;
    if (why && !S.ROOT) st.unreachable = { conn: target, why };
    renderAll();
    setConnUI();
  })();
}

let booted = false;
export function boot() {
  if (booted) return;
  booted = true;
  document.addEventListener('keydown', onKey);
  dom.app = document.getElementById('app')!;
  // The canvas changes size with the window and with the inspector.
  new ResizeObserver(() => {
    applyView();
    applyPanels();
    renderSide();
  }).observe(dom.stage);
  watchSystemTheme(retheme);
  readCss();
  applyPanels();
  const fromHash = parseConn(location.href);
  if (fromHash) history.replaceState(null, '', location.pathname + location.search);
  startAnalytics();
  const target = fromHash ?? loadConn();
  if (!target) loadDemo();
  else startConnect(target);
  setConnUI();
  setInterval(tickTimes, 60000);
}
