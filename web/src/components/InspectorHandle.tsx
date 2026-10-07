// Drag the inspector's left edge to resize it, or focus the edge and use the arrow keys.
import { useRef } from 'react';
import { dom } from '../state/app';
import { INSP_MAX, INSP_MIN, panels, setInspW } from '../state/panels';
import { useRegion } from '../state/render';
import { t } from '../i18n';

export function InspectorHandle() {
  useRegion('top');
  const drag = useRef(false);
  if (!panels.insp) return null;
  return (
    <div
      id="inspHandle"
      role="separator"
      aria-orientation="vertical"
      aria-label={t('Resize inspector')}
      aria-valuemin={INSP_MIN}
      aria-valuemax={INSP_MAX}
      aria-valuenow={panels.inspW}
      tabIndex={0}
      className="z-20 col-start-2 row-start-2 -ml-1 w-2 cursor-col-resize justify-self-start outline-none after:mx-auto after:block after:h-full after:w-px after:transition-colors hover:after:bg-sel focus-visible:after:bg-sel max-[1100px]:hidden"
      onPointerDown={e => {
        drag.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={e => {
        if (drag.current) setInspW(dom.app.getBoundingClientRect().right - e.clientX, false);
      }}
      onPointerUp={() => {
        drag.current = false;
        setInspW(panels.inspW);
      }}
      onKeyDown={e => {
        const step = e.key === 'ArrowLeft' ? 16 : e.key === 'ArrowRight' ? -16 : 0;
        if (!step) return;
        e.preventDefault();
        e.stopPropagation();
        setInspW(panels.inspW + step);
        e.currentTarget.setAttribute('aria-valuenow', String(panels.inspW));
      }}
    />
  );
}
