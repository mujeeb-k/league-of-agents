import { toast as show } from 'sonner';
import { dom } from '../state/app';

/** The message on screen, which the next one takes the place of. */
let last: string | number | null = null;
// One message at a time: a new one dismisses the one before. Each has its own id: a message given the id of one
// already timing out was removed with it, and never shown.
// Toasts take the canvas hint's place, so the hint goes for good once one shows.
export function toast(msg: string) {
  dom.tip?.classList.add('gone');
  if (last !== null) show.dismiss(last);
  last = show(msg, { duration: 2200 });
}
