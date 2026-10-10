// The launch check on a large, real public repository. Not part of `npm test`:
// it needs a clone and runs the real Claude Code. Run alone with
//   LOA_LARGE_REPO=/path/to/clone npm run large
// The zoom-level checks run at every level, then one real agent run; screenshots, the run's
// before, after and `git diff` go to test-results/large/.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { StateResponse } from '../../src/api/types';
import { git, linkFor, startBridge } from '../support/live';
import { ZOOMS, checkLevel, zoomTo } from '../support/zoom';

const REPO = process.env.LOA_LARGE_REPO ?? '';
const OUT = path.resolve('test-results/large');
/** The one file the run may change, and what it is asked. */
const FILE = process.env.LOA_LARGE_FILE ?? 'mealie/core/settings/directories.py';
const PROMPT = 'Add a one-line module docstring at the top of this file that says what it is for. Change nothing else.';

test.skip(!REPO, 'Set LOA_LARGE_REPO to a clone of a large public repository.');
test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

test('a large public repository: every zoom level, then a real run', async ({ page }) => {
  test.setTimeout(600_000);
  fs.mkdirSync(OUT, { recursive: true });
  const claude = execFileSync('which', ['claude'], { encoding: 'utf8' }).trim();
  // Claude Code signs in from the real home folder; no hooks are installed.
  const b = await startBridge(REPO, claude, { HOME: os.homedir() }, ['--no-hooks']);
  const shot = async (name: string) => {
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({ path: path.join(OUT, `${name}-${theme}.png`) });
    }
  };
  try {
    const files = git(REPO, 'ls-files').trim().split('\n');
    // Binary files and files over 400 kB are not drawn (bridge readTree).
    const state = (await (
      await fetch(`http://127.0.0.1:${b.port}/api/state`, { headers: { authorization: 'Bearer ' + b.token } })
    ).json()) as StateResponse;
    const drawn = state.tree.length;
    expect(drawn).toBeGreaterThan(1000);
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await expect(page.locator('.fr')).toHaveCount(drawn, { timeout: 30_000 });
    await shot('first-view');
    // Each level zooms toward the middle of the whole map.
    await page.keyboard.press('0');
    const levels: string[] = [];
    for (const z of ZOOMS) {
      await zoomTo(page, z);
      const r = await checkLevel(page);
      levels.push(`${z}%: ${r.labels} folder labels, no overlaps, no wrapped names, no bare folders`);
      await shot(`zoom-${String(z).padStart(3, '0')}`);
    }

    // A real run, scoped to one file.
    await page.keyboard.press('Control+p');
    await page.keyboard.type(FILE);
    await page.keyboard.press('Enter');
    await expect(page.locator('#scopeRow .chip:not(.all) > span')).toHaveText([path.basename(FILE)]);
    await page.locator('#prompt').fill(PROMPT);
    await page.locator('#prompt').press('Enter');
    await expect(page.locator('#runbar b')).toHaveText('Run 1', { timeout: 30_000 });
    const status = async () => {
      const s = (await (
        await fetch(`http://127.0.0.1:${b.port}/api/state`, { headers: { authorization: 'Bearer ' + b.token } })
      ).json()) as StateResponse;
      return s.runs[0]?.status;
    };
    await expect.poll(status, { timeout: 540_000, intervals: [2000] }).not.toMatch(/^(running|checking)$/);
    expect(await status()).toBe('done');
    const t0 = Date.now();
    await expect(page.locator('[data-mode="diff"]')).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });
    const shown = Date.now() - t0;
    await shot('run-diff');
    const diff = git(REPO, 'diff', 'refs/loa/runs/1/before', 'refs/loa/runs/1/after');
    fs.writeFileSync(path.join(OUT, 'run.diff'), diff);
    fs.writeFileSync(
      path.join(OUT, 'run.txt'),
      [
        `repo: ${git(REPO, 'remote', 'get-url', 'origin').trim()} at ${git(REPO, 'rev-parse', '--short', 'HEAD').trim()}`,
        `files: ${files.length} tracked, ${drawn} on the map (the rest are binary or over 400 kB)`,
        ...levels,
        `run: "${PROMPT}" on ${FILE}`,
        `before: ${git(REPO, 'rev-parse', 'refs/loa/runs/1/before').trim()}`,
        `after: ${git(REPO, 'rev-parse', 'refs/loa/runs/1/after').trim()}`,
        `the app showed the finished run in diff ${shown} ms after the bridge reported it done`,
        `changed: ${git(REPO, 'diff', '--name-status', 'refs/loa/runs/1/before', 'refs/loa/runs/1/after').trim()}`,
      ].join('\n') + '\n',
    );
    expect(git(REPO, 'diff', '--name-only', 'refs/loa/runs/1/before', 'refs/loa/runs/1/after').trim()).toBe(FILE);
  } finally {
    b.stop();
  }
});
