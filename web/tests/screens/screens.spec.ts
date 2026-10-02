// Every designed screen state at 1440×900 and 1280×800, in both themes, into test-results/screens/.
// Connecting, the empty repository and the first-run screen are also shot at 1024×768 and 1920×1080.
// Run with `npm run screens`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { AGENT_FIXTURES, REPLAY_AGENT, SLOW_AGENT, git, makeRepo, startBridge, type Bridge } from '../support/live';
import { APP } from '../support/targets';

const OUT = path.resolve('test-results/screens');
const SIZES = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
];
const WIDE = [...SIZES, { width: 1024, height: 768 }, { width: 1920, height: 1080 }];

async function shoot(page: Page, name: string, sizes = SIZES) {
  for (const size of sizes)
    for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize(size);
      await page.emulateMedia({ colorScheme: theme });
      await page.mouse.move(size.width - 2, 22);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}-${theme}.png`) });
    }
  await page.setViewportSize(SIZES[0]!);
}

/** Holds the bridge's answers to matching requests until released. */
function hold(page: Page, pattern: string, method = 'POST') {
  let release = () => {};
  const gate = new Promise<void>(r => (release = r));
  void page.route(pattern, async route => {
    if (route.request().method() === method) await gate;
    await route.continue();
  });
  return release;
}

const withConfig = (checks: { name: string; run: string }[]) => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, 'loa.config.json'), JSON.stringify({ checks }));
  git(repo, 'commit', '-qam', 'checks');
  return repo;
};
const prompt = async (page: Page, text = 'Name the action and origin in allowlist errors') => {
  await page.locator('#prompt').fill(text);
  await page.locator('#prompt').press('Enter');
};

test.describe.configure({ mode: 'serial' });
test.use({ viewport: SIZES[0], reducedMotion: 'reduce' });
fs.mkdirSync(OUT, { recursive: true });

test('demo screens', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(APP);
  await page.locator('#insp section').first().waitFor();
  await shoot(page, 'demo-run');
  await page.keyboard.press('Escape');
  await shoot(page, 'demo-try-it');
  await page.locator('#connectBtn').click();
  await shoot(page, 'first-run-connect', WIDE);
  await page.locator('#connectInput').fill('http://127.0.0.1:1/#t=nope');
  await page.locator('#connectInput').press('Enter');
  await expect(page.locator('#connectError')).toBeVisible();
  await shoot(page, 'connect-error');
  await page.keyboard.press('Escape');
  // The demo opens on its latest run's code; tiles show from fit-all.
  await page.keyboard.press('0');
  await page.locator('.fr[data-path="server/delivery/dead-letter.ts"]').click();
  await prompt(page, 'Log the reason');
  await expect(page.locator('#runbar b')).toHaveText('Run 15', { timeout: 5000 });
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('open run 14');
  await page.keyboard.press('Enter');
  await page.locator('[data-act="revert"]').click();
  await expect(page.locator('#conflictDlg')).toBeVisible();
  await shoot(page, 'demo-revert-conflict');
});

test('live screens', async ({ page }) => {
  test.setTimeout(300_000);
  const stop: Bridge[] = [];
  const open = async (repo: string, agent?: string, env: Record<string, string> = {}) => {
    const b = await startBridge(repo, agent, env, ['--no-hooks']);
    stop.push(b);
    await page.goto(`http://127.0.0.1:${b.port}/#t=${b.token}`);
    await expect(page.locator('#conn')).toHaveText('Live');
    return b;
  };
  try {
    // Connecting at startup, from the hosted app with a link.
    {
      const repo = makeRepo();
      const b = await startBridge(repo);
      stop.push(b);
      const release = hold(page, '**/api/state', 'GET');
      await page.goto(`${APP}/#bridge=${b.port}&t=${b.token}`);
      await expect(page.locator('#stageState')).toBeVisible();
      await shoot(page, 'connecting', WIDE);
      release();
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
    // A repository with no files.
    {
      const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loa-screens-')), 'empty-repo');
      fs.mkdirSync(dir);
      git(dir, 'init', '-q', '-b', 'main');
      git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '--allow-empty', '-m', 'empty');
      await open(dir);
      await expect(page.locator('#stageState')).toBeVisible();
      await shoot(page, 'empty-repo', WIDE);
    }
    // An agent running, then cancelled with nothing changed.
    {
      await open(makeRepo(), SLOW_AGENT);
      await prompt(page, 'Take your time');
      await expect(page.locator('#sideList .run.running')).toHaveCount(1);
      await shoot(page, 'agent-running');
      await page.locator('[data-act="cancel"]').click();
      await expect(page.locator('#insp .quiet').last()).toContainText('No changes');
      await shoot(page, 'nothing-changed');
    }
    // Checks running, then checks failed.
    {
      await open(
        withConfig([
          {
            name: 'tests',
            run: 'node -e "setTimeout(() => { console.log(\'2 passed, 1 failed\'); process.exit(1) }, 4000)"',
          },
        ]),
      );
      await prompt(page);
      await expect(page.locator('#insp .checks')).toBeVisible({ timeout: 15_000 });
      await shoot(page, 'checks-running');
      await expect(page.locator('.check .bad')).toHaveCount(1, { timeout: 15_000 });
      await shoot(page, 'checks-failed');
      // Reverted, then offline.
      await page.locator('[data-act="revert"]').click();
      await expect(page.locator('#insp .outcome')).toContainText('Reverted');
      await shoot(page, 'reverted');
      stop.at(-1)!.stop();
      await expect(page.locator('#conn')).toHaveText('Offline', { timeout: 15_000 });
      await shoot(page, 'offline');
    }
    // A check that couldn't run on this machine, beside one that passed.
    {
      await open(
        withConfig([
          { name: 'tests', run: 'node -e "console.log(\'3 passed\')"' },
          { name: 'pytest', run: 'python3 -c "import not_installed_pkg_xyz"' },
        ]),
      );
      await prompt(page);
      await expect(page.locator('.check.notrun')).toHaveCount(1, { timeout: 15_000 });
      await shoot(page, 'check-could-not-run');
    }
    // Claude Code not installed, then not logged in, with no other agent.
    {
      const missing = '/nonexistent/agent';
      const none = { LOA_CURSOR_BIN: missing, LOA_CODEX_BIN: missing };
      await open(makeRepo(), missing, none);
      await expect(page.locator('#claudeProblem')).toBeVisible();
      await shoot(page, 'claude-not-installed');
      const repo = makeRepo();
      const flag = path.join(path.dirname(repo), 'logged-out');
      fs.writeFileSync(flag, '');
      await open(repo, undefined, { ...none, FAKE_CLAUDE_LOGGED_OUT: flag });
      await expect(page.locator('#claudeProblem')).toBeVisible();
      await shoot(page, 'claude-logged-out');
    }
    // A revert conflict in live mode.
    {
      const repo = makeRepo();
      await open(repo);
      await prompt(page);
      await expect(page.locator('[data-act="revert"]')).toBeVisible({ timeout: 15_000 });
      fs.appendFileSync(path.join(repo, 'shared/allowlist.ts'), '// edited after the run\n');
      // Watch mode records the later edit as run 2; run 1 stays open, and the conflict is on run 1.
      await expect(page.locator('#sideList [data-run="2"]')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('#runbar b')).toHaveText('Run 1');
      await page.locator('[data-act="revert"]').click();
      await expect(page.locator('#conflictDlg')).toBeVisible();
      await shoot(page, 'live-revert-conflict');
      await page.locator('#conflictKeep').click();
    }
    // Claude Code stopped blocked: "Needs you".
    {
      await open(makeRepo(), REPLAY_AGENT, {
        LOA_FIXTURE: path.join(AGENT_FIXTURES, 'claude-scope-lock-blocked.jsonl'),
      });
      await prompt(page, 'Replay');
      await expect(page.locator('#insp .needs')).toBeVisible({ timeout: 15_000 });
      await shoot(page, 'needs-you');
    }
  } finally {
    for (const b of stop) b.stop();
  }
});
