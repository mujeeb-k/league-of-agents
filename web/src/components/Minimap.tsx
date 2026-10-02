// Minimap with zoom controls, built on shadcn/ui.
import { Minus, Plus } from 'lucide-react';
import { useEffect } from 'react';
import { applyView, flyAll, viewCenter, zoomAt } from '../lib/camera';
import { drawMap } from '../lib/minimap';
import { S, dom, st } from '../state/app';
import { useRegion } from '../state/render';
import { cn } from '@/lib/utils';
import { Tip } from './TopBar';
import { Button } from './ui/button';

function miniJump(e: PointerEvent) {
  const mini = dom.mini,
    r = mini.getBoundingClientRect(),
    g = drawMap(mini, st.run, true);
  if (!g) return;
  const wx = (e.clientX - r.left - g.ox) / g.k,
    wy = (e.clientY - r.top - g.oy) / g.k,
    s = st.v.s,
    [cx, cy] = viewCenter();
  st.v = { s, x: cx - wx * s, y: cy - wy * s };
  applyView();
}

const zoomCenter = (f: number) => zoomAt(...viewCenter(), f);

export function Minimap() {
  useRegion('scene');
  // Nothing to map (connecting, or a repository with no files): no empty frame.
  const empty = !S.ROOT || S.FILES.size === 0;
  useEffect(() => {
    const mini = dom.mini;
    let miniDrag = false;
    const down = (e: PointerEvent) => {
      miniDrag = true;
      mini.setPointerCapture(e.pointerId);
      miniJump(e);
    };
    const move = (e: PointerEvent) => {
      if (miniDrag) miniJump(e);
    };
    const up = () => {
      miniDrag = false;
    };
    mini.addEventListener('pointerdown', down);
    mini.addEventListener('pointermove', move);
    mini.addEventListener('pointerup', up);
    return () => {
      mini.removeEventListener('pointerdown', down);
      mini.removeEventListener('pointermove', move);
      mini.removeEventListener('pointerup', up);
    };
  }, []);
  return (
    <div
      id="nav"
      className={cn(
        'absolute right-3 bottom-3 w-56 overflow-hidden rounded-xl border bg-popover shadow-[var(--e2)] max-[1280px]:w-42 max-[860px]:top-3 max-[860px]:bottom-auto',
        empty && 'invisible',
      )}
    >
      <div className="flex items-center justify-between p-1">
        <Tip label="Zoom out" keys="−">
          <Button variant="ghost" size="icon-sm" id="zOut" aria-label="Zoom out" onClick={() => zoomCenter(1 / 1.4)}>
            <Minus />
          </Button>
        </Tip>
        <Tip label="Fit everything" keys="0">
          <Button
            variant="ghost"
            size="sm"
            id="zPct"
            className="px-2 font-normal text-ink2 tabular-nums"
            onClick={flyAll}
            ref={el => {
              if (el) dom.zPct = el;
            }}
          >
            20%
          </Button>
        </Tip>
        <Tip label="Zoom in" keys="+">
          <Button variant="ghost" size="icon-sm" id="zIn" aria-label="Zoom in" onClick={() => zoomCenter(1.4)}>
            <Plus />
          </Button>
        </Tip>
      </div>
      <canvas
        id="mini"
        aria-label="Minimap"
        className="block h-35 w-full cursor-crosshair border-t max-[1280px]:h-24"
        ref={el => {
          if (el) dom.mini = el;
        }}
      />
    </div>
  );
}
