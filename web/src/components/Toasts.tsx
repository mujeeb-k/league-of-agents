// Toasts sit at the top left of the visible canvas, clear of the sidebar, where the canvas hint was:
// they never cover other UI. They follow the sidebar as it shows and steps aside.
import { dom, st } from '../state/app';
import { sideInset } from '../state/panels';
import { useRegion } from '../state/render';
import { Toaster } from './ui/sonner';

export function Toasts() {
  useRegion('top');
  const offset = { top: 56, left: 12 + (dom.side ? sideInset(st.v.s) : 0) };
  return <Toaster position="top-left" offset={offset} mobileOffset={offset} />;
}
