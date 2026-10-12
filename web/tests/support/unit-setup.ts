// Before and after the unit tests: the same check as the Playwright suites' (leftovers.ts).
import { begin, endOrFail } from './leftovers';

let root: string;
export function setup() {
  root = begin();
}
export function teardown() {
  endOrFail(root);
}
