import { toast as show } from 'sonner';
import { dom } from '../state/app';

// One message at a time, replaced in place.
// Toasts take the canvas hint's place, so the hint goes for good once one shows.
export function toast(msg: string) {
  dom.tip?.classList.add('gone');
  show(msg, { id: 'loa', duration: 2200 });
}
