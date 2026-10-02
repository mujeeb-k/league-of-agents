// The canvas stage: its markup and input handlers.
import { useEffect, useRef } from 'react';
import { applyView, flyDir, flyFile, flyTo, zoomAt } from '../lib/camera';
import { CH, CW } from '../lib/constants';
import { existsNow } from '../lib/model';
import { updateEdgeFocus } from '../lib/scene';
import { clamp, plural } from '../lib/util';
import { S, dom, st } from '../state/app';
import { toggleSel } from '../state/actions';
import { openEditor } from '../state/editing';
import { Editor } from './Editor';
import { renderInspector, renderSel } from '../state/render';
import { toast } from '../ui/toast';
import { Composer } from './Composer';
import { Minimap } from './Minimap';
import { StageState } from './StageState';
import { UpdateBanner } from './UpdateBanner';
import { Kbd } from './ui/kbd';
import { useScene } from './Scene';

interface Drag {
  sx: number;
  sy: number;
  vx: number;
  vy: number;
  moved: boolean;
  marquee: boolean;
  target: Element;
  shift: boolean;
}

/** A tile's name shortens to fit; hovering it shows the full name just above the tile, at screen size. */
function showTileName(tile: HTMLElement | null) {
  const el = dom.tileName,
    f = tile && S.FILES.get(tile.dataset.path!);
  if (!f) {
    el.hidden = true;
    return;
  }
  const r = tile.getBoundingClientRect(),
    s = dom.stage.getBoundingClientRect();
  el.textContent = f.name;
  el.style.left = `${r.left - s.left}px`;
  el.style.top = `${r.top - s.top - 6}px`;
  el.hidden = false;
}

const inChrome = (t: Element) => t.closest('#nav,#composer,#tip,#updateBanner,#stageState,#editorLayer');
const hideTip = () => dom.tip.classList.add('gone');

function bindStage(stage: HTMLElement) {
  let drag: Drag | null = null;
  const marquee = dom.marquee;
  const down = (e: PointerEvent) => {
    const target = e.target as Element;
    if ((e.button !== 0 && e.button !== 1) || inChrome(target)) return;
    const onItem = target.closest('.card,.fr');
    drag = {
      sx: e.clientX,
      sy: e.clientY,
      vx: st.v.x,
      vy: st.v.y,
      moved: false,
      marquee: e.shiftKey && !onItem,
      target,
      shift: e.shiftKey || e.metaKey,
    };
    stage.setPointerCapture(e.pointerId);
  };
  // The pointer left the canvas, so no card is hovered any more.
  const leave = () => {
    if (st.hover === null) return;
    st.hover = null;
    showTileName(null);
    updateEdgeFocus(dom.links);
  };
  const move = (e: PointerEvent) => {
    if (!drag) {
      const c = (e.target as Element).closest?.<HTMLElement>('.card,.fr');
      const h = c ? (c.dataset.path ?? null) : null;
      if (h !== st.hover) {
        st.hover = h;
        updateEdgeFocus(dom.links);
      }
      // Also after a pan or zoom, which hides the label until the pointer moves again.
      showTileName(c?.classList.contains('fr') ? c : null);
      return;
    }
    const dx = e.clientX - drag.sx,
      dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) > 4) {
      drag.moved = true;
      hideTip();
    }
    if (!drag.moved) return;
    if (drag.marquee) {
      const r = stage.getBoundingClientRect();
      Object.assign(marquee.style, {
        display: 'block',
        left: Math.min(e.clientX, drag.sx) - r.left + 'px',
        top: Math.min(e.clientY, drag.sy) - r.top + 'px',
        width: Math.abs(dx) + 'px',
        height: Math.abs(dy) + 'px',
      });
    } else {
      stage.classList.add('panning');
      st.v.x = drag.vx + dx;
      st.v.y = drag.vy + dy;
      applyView();
    }
  };
  let lastClick: { key: string; t: number } | null = null;
  const up = (e: PointerEvent) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    stage.classList.remove('panning');
    if (d.marquee && d.moved) {
      marquee.style.display = 'none';
      const r = stage.getBoundingClientRect(),
        { x, y, s } = st.v;
      const x1 = (Math.min(e.clientX, d.sx) - r.left - x) / s,
        y1 = (Math.min(e.clientY, d.sy) - r.top - y) / s;
      const x2 = (Math.max(e.clientX, d.sx) - r.left - x) / s,
        y2 = (Math.max(e.clientY, d.sy) - r.top - y) / s;
      let n = 0;
      for (const f of S.FILES.values())
        if (existsNow(f) && f.x < x2 && f.x + CW > x1 && f.y < y2 && f.y + CH > y1) {
          st.sel.add(f.path);
          n++;
        }
      renderSel();
      if (n) toast(`${plural(n, 'file')} added to scope`);
      return;
    }
    if (d.moved) return;
    const fe = d.target.closest<HTMLElement>('[data-path]'),
      de = d.target.closest<HTMLElement>('[data-dir]');
    // The second click of a double click keeps the selection; the double click then zooms to it.
    // A file's tile and its card are different targets: a tile click then a card click isn't a double click.
    const key = fe ? (fe.classList.contains('card') ? 'c:' : '') + fe.dataset.path! : de ? 'd:' + de.dataset.dir : null,
      now = performance.now(),
      second = key !== null && lastClick?.key === key && now - lastClick.t < 400;
    lastClick = key === null ? null : { key, t: now };
    if (second) return;
    if (fe) {
      const p = fe.dataset.path!;
      toggleSel(p, d.shift);
      if (st.run && st.run.changes.has(p)) {
        st.cur = p;
        renderInspector();
      }
    } else if (de) toggleSel('d:' + de.dataset.dir, d.shift);
    else if (!d.shift && st.sel.size) {
      st.sel.clear();
      renderSel();
    }
  };
  const dbl = (e: MouseEvent) => {
    // The canvas captures the pointer on press, so the event targets the canvas; look up what is under it.
    const target = document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element);
    if (inChrome(target)) return;
    const fe = target.closest<HTMLElement>('[data-path]'),
      fl = target.closest('.flabel');
    const key = fe ? fe.dataset.path! : fl ? 'd:' + (fl.parentElement as HTMLElement).dataset.dir : null;
    // A code box opens in the editor (Figma's convention: double-click to edit); a tile zooms to its file.
    if (fe?.classList.contains('card') && !fe.classList.contains('ghost')) {
      void openEditor(fe.dataset.path!);
      return;
    }
    if (key && !st.sel.has(key)) toggleSel(key, false);
    if (fe) flyFile(fe.dataset.path!);
    else if (fl) flyDir((fl.parentElement as HTMLElement).dataset.dir!);
    else {
      const r = stage.getBoundingClientRect(),
        { s } = st.v,
        ns = clamp(s * 2, 0.04, 2.5),
        px = e.clientX - r.left,
        py = e.clientY - r.top;
      flyTo({ s: ns, x: px - ((px - st.v.x) / s) * ns, y: py - ((py - st.v.y) / s) * ns });
    }
  };
  const wheel = (e: WheelEvent) => {
    if (inChrome(e.target as Element)) return;
    e.preventDefault();
    hideTip();
    const k = e.deltaMode === 1 ? 16 : 1;
    if (e.ctrlKey || e.metaKey) {
      const r = stage.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * k * 0.01));
    } else {
      st.v.x -= e.deltaX * k;
      st.v.y -= e.deltaY * k;
      applyView();
    }
  };
  stage.addEventListener('pointerdown', down);
  stage.addEventListener('pointermove', move);
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointerleave', leave);
  stage.addEventListener('dblclick', dbl);
  stage.addEventListener('wheel', wheel, { passive: false });
  return () => {
    stage.removeEventListener('pointerdown', down);
    stage.removeEventListener('pointermove', move);
    stage.removeEventListener('pointerup', up);
    stage.removeEventListener('pointerleave', leave);
    stage.removeEventListener('dblclick', dbl);
    stage.removeEventListener('wheel', wheel);
  };
}

/** #world. Only this part re-renders with the scene; the camera writes its transform directly. */
function World() {
  const { wires, nodes, sels } = useScene();
  return (
    <div id="world" ref={setWorld}>
      <svg id="wires" ref={setWires}>
        {wires}
      </svg>
      <div id="nodes">{nodes}</div>
      {/* Import lines: drawn on focus by updateEdgeFocus (lib/scene.ts), not by React. */}
      <svg id="links" ref={setLinks} />
      <div id="sels">{sels}</div>
    </div>
  );
}
const setWorld = (el: HTMLDivElement | null) => {
  if (el) dom.world = el;
};
const setWires = (el: SVGSVGElement | null) => {
  if (el) dom.wires = el;
};
const setLinks = (el: SVGSVGElement | null) => {
  if (el) dom.links = el;
};

export function Stage() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => bindStage(ref.current!), []);
  return (
    <main
      id="stage"
      aria-label="Code canvas"
      className="col-start-1 row-start-2"
      ref={el => {
        if (el) dom.stage = el;
        ref.current = el;
      }}
    >
      <World />
      <Editor />
      <div
        id="marquee"
        ref={el => {
          if (el) dom.marquee = el;
        }}
      />
      <div
        id="tileName"
        hidden
        className="pointer-events-none absolute z-10 -translate-y-full rounded-md bg-foreground px-2 py-1 font-mono text-xs whitespace-nowrap text-background"
        ref={el => {
          if (el) dom.tileName = el;
        }}
      />
      {/* The hint and the composer move clear of the sidebar (--inset, set by panels.ts), by translate only. */}
      <div
        data-inset=""
        className="pointer-events-none absolute inset-0 translate-x-(--inset,0px) transition-[translate] duration-200 ease-(--ease)"
      >
        <div
          id="tip"
          className="absolute top-3 left-3 rounded-lg bg-popover px-3 py-2 text-xs text-ink2 shadow-[var(--e1)] transition-[opacity,translate] duration-300 ease-(--ease) max-[860px]:hidden [&.gone]:-translate-y-1 [&.gone]:opacity-0"
          ref={el => {
            if (el) dom.tip = el;
          }}
        >
          Scroll to pan. Pinch or <Kbd>⌘</Kbd> scroll to zoom. Shift-drag to select.
        </div>
      </div>
      <UpdateBanner />
      <div
        data-inset=""
        className="pointer-events-none absolute inset-0 translate-x-[calc(var(--inset,0px)/2)] transition-[translate] duration-200 ease-(--ease)"
      >
        <Composer />
      </div>
      <StageState />
      <Minimap />
    </main>
  );
}
