// Before and after every Playwright run: one temp folder for the run, and a failure when it isn't left empty or a
// bridge the tests started is still running (leftovers.ts).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { begin, endOrFail } from './leftovers';

export default function setup() {
  // The bridges' records an earlier run's failed tests kept (live.ts keepRecords).
  fs.rmSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../test-results/records'), {
    recursive: true,
    force: true,
  });
  const root = begin();
  return () => endOrFail(root);
}
