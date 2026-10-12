// Before and after every Playwright run: one temp folder for the run, and a failure when it isn't left empty or a
// bridge the tests started is still running (leftovers.ts).
import { begin, endOrFail } from './leftovers';

export default function setup() {
  const root = begin();
  return () => endOrFail(root);
}
