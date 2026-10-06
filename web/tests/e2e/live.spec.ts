// Live mode end to end: a real bridge in a temp git repo, with tests/fixtures/fake-claude.mjs as Claude Code.
import { execFile, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { RunDTO, StateResponse } from '../../src/api/types';
import {
  AGENT_FIXTURES,
  BRIDGE,
  FAKE_CLAUDE,
  FAKE_CODEX,
  REPLAY_AGENT,
  REPO_ROOT,
  SEED,
  SLOW_AGENT,
  git,
  homeOf,
  makeRepo,
  startBridge,
  type Bridge,
} from '../support/live';
import { APP, TOAST } from '../support/targets';
import { ZOOMS, checkLevel, zoomTo } from '../support/zoom';

const SUMMARY = 'Violation errors now name the action and origin. Added isEmpty and a policy cache.';

const linkFor = (b: Bridge) => `http://127.0.0.1:${b.port}/#t=${b.token}`;

/** Rows shown on the canvas for one file card, as +line / -line, blank lines dropped. */
async function cardRows(page: Page, file: string) {
  return page.locator(`.card[data-path="${file}"] .ln`).evaluateAll(els =>
    els
      .map(el => ({
        k: el.classList.contains('add') ? '+' : el.classList.contains('del') ? '-' : ' ',
        t: (el.querySelector('span')?.textContent ?? '').replace(/\s+$/, ''),
      }))
      .filter(r => r.k !== ' ' && r.t !== '')
      .map(r => r.k + r.t),
  );
}
/** The same, from git. */
function gitRows(repo: string, file: string) {
  return git(repo, 'diff', '--no-color', '-U0', 'refs/loa/runs/1/before', 'refs/loa/runs/1/after', '--', file)
    .split('\n')
    .filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l))
    .map(l => l.replace(/\s+$/, ''))
    .filter(l => l.length > 1);
}

// Keep the sidebar open: these tests use it at every zoom.
test.beforeEach(({ page }) =>
  page.addInitScript(() => localStorage.setItem('loa.panels', JSON.stringify({ side: 'pinned' }))),
);

test('live run, review and revert', async ({ page }) => {
  const repo = makeRepo(),
    b = await startBridge(repo);
  try {
    const head = git(repo, 'rev-parse', 'HEAD').trim();
    await page.goto(linkFor(b));

    // Connected: live pill, repo and branch, token removed from the address bar.
    await expect(page.locator('#conn')).toHaveText('Live');
    await expect(page.locator('#repoName')).toHaveText('sample-repo');
    await expect(page.locator('.crumb .br')).toHaveText('main');
    expect(page.url()).not.toContain('t=');
    await expect(page.locator('#connectBtn')).toHaveText('Disconnect');
    await expect(page.locator('#sideList .empty')).toHaveText(
      'No runs yet. Select code on the canvas and describe a change.',
    );
    await page.locator('#agentBtn').click();
    await expect(page.locator('#agentMenu [data-agent]')).toHaveText(['Claude Code']);
    await page.keyboard.press('Escape');

    // Select a folder and run.
    await page.locator('.frame[data-dir="shared"] > .flabel b').click();
    await expect(page.locator('#scopeRow .chip:not(.all) > span')).toHaveText(['shared/']);
    await page.locator('#prompt').fill('Name the action and origin in allowlist errors');
    await page.locator('#prompt').press('Enter');
    await expect(page.locator(TOAST)).toHaveText('Claude Code started run 1');

    // Finished run: diff mode, the agent's reply, checks.
    await expect(page.locator('#insp .bubble').nth(1)).toHaveText(SUMMARY, { timeout: 15_000 });
    await expect(page.locator('#runbar b')).toHaveText('Run 1');
    await expect(page.locator('#insp .runscope .chip')).toHaveText(['shared/']);
    await expect(page.locator('[data-mode="diff"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.check .ok')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator('.check .nm')).toHaveText('tests');
    await expect(page.locator('.check .sm')).toHaveText('3 passed');
    await expect(page.locator('#sideList .run .tags')).toContainText('Checks passed');
    await expect(page.locator('.flist li .p')).toHaveText(['allowlist.ts', 'policy-cache.ts']);
    await expect(page.locator('#insp .acts li')).toHaveText(['toolEdit shared/allowlist.ts']);

    // Diff rows on the canvas match git exactly.
    await expect(page.locator('#world')).toHaveClass(/near/);
    await expect(page.locator('.card[data-path="shared/allowlist.ts"] .ln.del span')).toHaveText([
      "    throw new Error('ALLOWLIST_VIOLATION');",
    ]);
    await expect(page.locator('.card[data-path="shared/allowlist.ts"] .ln.add span').first()).toHaveText(
      '    throw new Error(`ALLOWLIST_VIOLATION: ${action} on ${origin}`);',
    );
    await expect(page.locator('.card[data-path="shared/policy-cache.ts"]')).toHaveClass(/k-add/);
    for (const f of ['shared/allowlist.ts', 'shared/policy-cache.ts'])
      expect(await cardRows(page, f)).toEqual(gitRows(repo, f));

    // Reload reconnects from the saved token.
    await page.reload();
    await expect(page.locator('#conn')).toHaveText('Live');
    await page.locator('#sideList [data-run="1"]').click();
    // A finished run offers a follow-up in the same session.
    await expect(page.locator('#scopeRow .chip.fu > span')).toHaveText('Follow-up to run 1');

    // Revert, then prove the repo is exactly as seeded and nothing was staged or committed.
    await page.locator('[data-act="revert"]').click();
    await expect(page.locator(TOAST)).toHaveText('Reverted run 1');
    await expect(page.locator('#insp .outcome')).toContainText('Reverted');
    await expect(page.locator('#sideList .run .m').last()).toContainText('Reverted');
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('');
    expect(git(repo, 'rev-parse', 'HEAD').trim()).toBe(head);
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
    for (const [p, text] of Object.entries(SEED)) expect(fs.readFileSync(path.join(repo, p), 'utf8')).toBe(text);
    expect(fs.existsSync(path.join(repo, 'shared/policy-cache.ts'))).toBe(false);

    // A reverted run is never continued: no follow-up chip, and the next run starts a fresh session.
    await expect(page.locator('#scopeRow .chip.fu')).toHaveCount(0);

    // Drift: a second run, then the file changes again before revert. Revert asks first.
    await page.locator('#prompt').fill('Same change again');
    await page.locator('#prompt').press('Enter');
    await expect(page.locator('#runbar b')).toHaveText('Run 2', { timeout: 15_000 });
    const run2 = JSON.parse(fs.readFileSync(path.join(repo, '.loa/runs/2.json'), 'utf8')) as RunDTO;
    expect(run2.resumeFrom).toBeNull();
    await expect(page.locator('#insp .bubble').nth(1)).toHaveText(SUMMARY, { timeout: 15_000 });
    // Removing the follow-up chip on a finished run starts the next prompt fresh.
    await expect(page.locator('#scopeRow .chip.fu > span')).toHaveText('Follow-up to run 2');
    await page.locator('[data-nofollow="2"]').click();
    await expect(page.locator('#scopeRow .chip.fu')).toHaveCount(0);
    fs.appendFileSync(path.join(repo, 'shared/allowlist.ts'), '// edited after the run\n');
    // Watch mode records the later edit as a run of its own.
    await expect(page.locator('#sideList [data-run="3"]')).toContainText('Edited allowlist.ts', { timeout: 15_000 });
    // A new run does not take over the run being reviewed.
    await expect(page.locator('#runbar b')).toHaveText('Run 2');
    // The conflict dialog lists the files. Keeping the later edits changes nothing.
    await page.locator('[data-act="revert"]').click();
    await expect(page.locator('#conflictDlg')).toContainText('These files changed after run 2');
    await expect(page.locator('#conflictFiles')).toContainText('shared/allowlist.ts');
    await page.locator('#conflictKeep').click();
    await expect(page.locator('#conflictDlg')).toHaveCount(0);
    expect(fs.readFileSync(path.join(repo, 'shared/allowlist.ts'), 'utf8')).toContain('// edited after the run');
    // Revert anyway restores the file as it was before the run.
    await page.locator('[data-act="revert"]').click();
    await page.locator('#conflictRevert').click();
    await expect(page.locator(TOAST)).toHaveText('Reverted run 2');
    expect(fs.readFileSync(path.join(repo, 'shared/allowlist.ts'), 'utf8')).toBe(SEED['shared/allowlist.ts']);
    expect(git(repo, 'status', '--porcelain')).toBe('');

    // An edit made outside a run, in any editor, becomes a run once the files are quiet (watch mode).
    fs.writeFileSync(
      path.join(repo, 'shared/log.ts'),
      'export const log = (msg: string) => console.log(`[relay] ${msg}`);\n',
    );
    await expect(page.locator('#sideList [data-run="4"]')).toContainText('Edited log.ts', { timeout: 15_000 });
    await page.locator('#sideList [data-run="4"]').click();
    await expect(page.locator('#runbar b')).toHaveText('Run 4');
    await expect(page.locator('#insp')).toContainText('Changed outside a run, in an editor or by another agent.');
    await expect(page.locator('.flist li .p')).toHaveText(['log.ts']);

    // Keep.
    await page.locator('[data-act="keep"]').click();
    await expect(page.locator(TOAST)).toHaveText('Kept run 4');
    await expect(page.locator('#insp .outcome')).toContainText('Kept');
    await expect(page.locator('#sideList [data-run="4"]')).toContainText('Kept');
    // Keep reaches the bridge and is saved with the run.
    const saved = JSON.parse(fs.readFileSync(path.join(repo, '.loa/runs/4.json'), 'utf8')) as { kept?: boolean };
    expect(saved.kept).toBe(true);

    // Disconnect returns to the demo.
    await page.locator('#connectBtn').click();
    await expect(page.locator('#conn')).toHaveText('Demo');
    await expect(page.locator('#repoName')).toHaveText('relay');
    await expect(page.locator(TOAST)).toHaveText('Disconnected');
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('loading states: connecting, starting a run, and keep show progress and block repeats', async ({ page }) => {
  const repo = makeRepo(),
    b = await startBridge(repo);
  const slow = (pattern: string, method = 'POST') =>
    page.route(pattern, async route => {
      if (route.request().method() === method) await new Promise(r => setTimeout(r, 700));
      await route.continue();
    });
  try {
    await slow('**/api/state', 'GET');
    await page.goto(APP);
    await page.locator('#connectBtn').click();
    await page.locator('#connectInput').fill(`http://127.0.0.1:${b.port}/#t=${b.token}`);
    await page.locator('#connectInput').press('Enter');
    // "Connecting" shows once in the top bar: the badge says it, and the button steps aside.
    await expect(page.locator('#conn')).toHaveText('Connecting');
    await expect(page.locator('#connectBtn')).toHaveCount(0);
    await expect(page.locator('#connectGo')).toHaveText('Connecting');
    await expect(page.locator('#conn')).toHaveText('Live');
    await expect(page.locator('#connectBtn')).toHaveText('Disconnect');
    // A successful connect closes the dialog and does not reopen it.
    await expect(page.locator('#connectDlg')).toBeHidden();
    await expect(page.locator('#connectBtn')).toBeFocused();
    await page.unroute('**/api/state');

    await slow('**/api/runs');
    await page.locator('#prompt').fill('Name the action and origin in allowlist errors');
    await page.locator('#prompt').press('Enter');
    await expect(page.locator('#sendBtn .spin')).toBeVisible();
    await expect(page.locator('#sendBtn')).toBeDisabled();
    await expect(page.locator(TOAST)).toHaveText('Claude Code started run 1');
    await expect(page.locator('#sendBtn .spin')).toHaveCount(0);

    await slow('**/api/runs/1/keep');
    await expect(page.locator('[data-act="keep"]')).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-act="keep"]').click();
    await expect(page.locator('[data-act="keep"]')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('[data-act="revert"]')).toBeDisabled();
    await expect(page.locator('#insp .outcome')).toContainText('Kept');
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('offline: when the bridge stops answering, the last state stays and nothing acts on it', async ({ page }) => {
  const repo = makeRepo(),
    b = await startBridge(repo);
  try {
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await page.locator('#prompt').fill('Name the action and origin in allowlist errors');
    await page.locator('#prompt').press('Enter');
    await expect(page.locator('[data-act="keep"]')).toBeVisible({ timeout: 15_000 });
    b.stop();
    await expect(page.locator('#conn')).toHaveText('Offline', { timeout: 15_000 });
    await expect(page.locator('#connectBtn')).toHaveText('Reconnect');
    await expect(page.locator('#prompt')).toHaveAttribute('placeholder', 'Reconnect to run agents');
    // The last state stays: the run, its diff, its files.
    await expect(page.locator('#runbar b')).toHaveText('Run 1');
    await expect(page.locator('.card[data-path="shared/policy-cache.ts"]')).toHaveCount(1);
    // Nothing acts on it, and nothing falls back to the demo.
    await expect(page.locator('[data-act="keep"]')).toBeDisabled();
    await expect(page.locator('#prompt')).toBeDisabled();
    await expect(page.locator('#sendBtn')).toBeDisabled();
    await expect(page.locator('#runCount')).toHaveText('1');
    await page.keyboard.press('ControlOrMeta+k');
    await page.keyboard.type('keep run');
    await page.keyboard.press('Enter');
    await expect(page.locator(TOAST)).toHaveText('The bridge is offline. Reconnect first.');
    await expect(page.locator('#insp .outcome')).toHaveCount(0);
    await expect(page.locator('#repoName')).toHaveText('sample-repo');
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test("a repository never shows the demo's introduction, not even before the app starts", async ({ page }) => {
  const repo = makeRepo(),
    b = await startBridge(repo, undefined, {}, ['--no-hooks']);
  // What the introduction looks like as the page is parsed, before the app's script runs.
  await page.addInitScript(() => {
    document.addEventListener('readystatechange', () => {
      if (document.readyState !== 'interactive') return;
      const el = document.getElementById('introStatic');
      (window as unknown as { early: unknown }).early = el && {
        display: getComputedStyle(el).display,
        height: el.getBoundingClientRect().height,
      };
    });
  });
  const early = () => page.evaluate(() => (window as unknown as { early: unknown }).early);
  try {
    for (const link of [linkFor(b), `${APP}/#bridge=${b.port}&t=${b.token}`]) {
      await page.goto(link);
      expect(await early()).toEqual({ display: 'none', height: 0 });
      await expect(page.locator('#conn')).toHaveText('Live');
      await expect(page.locator('#intro, #introStatic, h1')).toHaveCount(0);
    }
    // A saved connection, with nothing in the address: the same.
    await page.reload();
    expect(await early()).toEqual({ display: 'none', height: 0 });
    await expect(page.locator('#conn')).toHaveText('Live');
    await expect(page.locator('#intro, #introStatic, h1')).toHaveCount(0);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('startup: a link shows "Connecting", never the demo first, and offers the demo as a way out', async ({ page }) => {
  const repo = makeRepo(),
    b = await startBridge(repo);
  let release = () => {};
  const gate = new Promise<void>(r => (release = r));
  await page.route('**/api/state', async route => {
    await gate;
    await route.continue();
  });
  try {
    await page.goto(`${APP}/#bridge=${b.port}&t=${b.token}`);
    await expect(page.locator('#stageState')).toContainText('Connecting to your repo');
    await expect(page.locator('#conn')).toHaveText('Connecting');
    await expect(page.locator('#insp')).toContainText('Waiting for the bridge');
    // Nothing that needs a repo: no breadcrumb, no run hint, and the composer says why it is off.
    await expect(page.locator('.crumb')).toHaveCount(0);
    await expect(page.locator('#runbar .quiet')).toHaveCount(0);
    await expect(page.locator('#prompt')).toBeDisabled();
    await expect(page.locator('#prompt')).toHaveAttribute('placeholder', 'Connect a repo to run agents');
    await expect(page.locator('#nav')).toBeHidden();
    await expect(page.locator('.fr')).toHaveCount(0);
    await page.locator('#showDemo').click();
    await expect(page.locator('#repoName')).toHaveText('relay');
    await expect(page.locator('#prompt')).toBeFocused();
    await expect(page.locator('#stageState')).toHaveCount(0);
    release();
    await expect(page.locator('#conn')).toHaveText('Live');
    await expect(page.locator('#repoName')).toHaveText('sample-repo');
  } finally {
    release();
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// A link to a bridge that doesn't answer never falls back to the demo silently.
test('startup: a link to a bridge that does not answer says so, and shows the demo only when asked', async ({
  page,
}) => {
  await page.goto(`${APP}/#bridge=1&t=gone`);
  await expect(page.locator('#stageState')).toContainText("Can't reach your bridge");
  await expect(page.locator('#stageState')).toContainText('Nothing answered at 127.0.0.1:1.');
  await expect(page.locator('#conn')).toHaveText('Not connected');
  await expect(page.locator('#localLink')).toHaveAttribute('href', 'http://127.0.0.1:1/#t=gone');
  await expect(page.locator('#unreachableCommand')).toHaveText('npx leagueofagents-cli@latest');
  // Nothing of the demo is shown, and nothing can be run.
  await expect(page.locator('.fr, .card')).toHaveCount(0);
  await expect(page.locator('#prompt')).toBeDisabled();
  await expect(page.locator(TOAST)).toHaveCount(0);
  await page.locator('#showDemo').click();
  await expect(page.locator('#repoName')).toHaveText('relay');
  await expect(page.locator('#conn')).toHaveText('Demo');
  await expect(page.locator('#stageState')).toHaveCount(0);
});

test('startup: a saved connection whose bridge is gone says so; a restarted bridge rejects the old link', async ({
  page,
}) => {
  const repo = makeRepo(),
    b = await startBridge(repo);
  b.stop();
  await new Promise(r => setTimeout(r, 300));
  await page.addInitScript(
    ([base, token]) => localStorage.setItem('loa.conn', JSON.stringify({ base, token })),
    [`http://127.0.0.1:${b.port}`, b.token],
  );
  await page.goto(APP);
  await expect(page.locator('#stageState')).toContainText("Can't reach your bridge");
  await expect(page.locator('#conn')).toHaveText('Not connected');
  // Every start makes a fresh token: the saved one no longer works, and the canvas says so.
  const again = await startBridge(repo, undefined, {}, ['--port', String(b.port)]);
  try {
    expect(again.token).not.toBe(b.token);
    await page.locator('#retryConnect').click();
    await expect(page.locator('#stageState')).toContainText("Your bridge didn't accept this link");
    await expect(page.locator('#conn')).toHaveText('Not connected');
  } finally {
    again.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('startup: a link the bridge rejects says so, without the demo', async ({ page }) => {
  const repo = makeRepo(),
    b = await startBridge(repo);
  try {
    await page.goto(`${APP}/#bridge=${b.port}&t=wrong-token`);
    await expect(page.locator('#stageState')).toContainText("Your bridge didn't accept this link");
    await expect(page.locator('#stageState')).toContainText('The bridge rejected that link.');
    await expect(page.locator('#conn')).toHaveText('Not connected');
    await expect(page.locator('.fr, .card')).toHaveCount(0);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('a connected repository with no files says so', async ({ page }) => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loa-e2e-')), 'empty-repo');
  fs.mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(
    dir,
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@example.test',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'empty',
  );
  const b = await startBridge(dir);
  try {
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await expect(page.locator('#stageState')).toContainText('This repository has no files yet');
    await expect(page.locator('#nav')).toBeHidden();
  } finally {
    b.stop();
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  }
});

test('a blocked Claude Code turn shows "Needs you" in the inspector and on the run card', async ({ page }) => {
  const repo = makeRepo(),
    b = await startBridge(repo, REPLAY_AGENT, {
      LOA_FIXTURE: path.join(AGENT_FIXTURES, 'claude-scope-lock-blocked.jsonl'),
    });
  try {
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await page.locator('#prompt').fill('Replay');
    await page.locator('#prompt').press('Enter');
    await expect(page.locator('#insp .needs')).toContainText('Claude Code needs you', { timeout: 15_000 });
    await expect(page.locator('#sideList [data-run="1"]')).toContainText('Needs you');
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('failed checks make Revert the primary action and Keep the secondary one', async ({ page }) => {
  const repo = makeRepo();
  fs.writeFileSync(
    path.join(repo, 'loa.config.json'),
    JSON.stringify({ checks: [{ name: 'tests', run: 'node -e "console.log(\'1 failed\'); process.exit(1)"' }] }),
  );
  git(repo, 'commit', '-qam', 'failing check');
  const b = await startBridge(repo);
  try {
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await page.locator('#prompt').fill('Name the action and origin in allowlist errors');
    await page.locator('#prompt').press('Enter');
    await expect(page.locator('.check .bad')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator('[data-act="revert"]')).toHaveAttribute('data-variant', 'default');
    await expect(page.locator('[data-act="keep"]')).toHaveAttribute('data-variant', 'outline');
    await expect(page.locator('#sideList .run .tags')).toContainText('Checks failed');
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('logged out of Claude Code: the composer says how to log in, and it clears once logged in', async ({ page }) => {
  const repo = makeRepo();
  const flag = path.join(path.dirname(repo), 'logged-out');
  fs.writeFileSync(flag, '');
  const missing = '/nonexistent/agent';
  const b = await startBridge(repo, FAKE_CLAUDE, {
    FAKE_CLAUDE_LOGGED_OUT: flag,
    LOA_CURSOR_BIN: missing,
    LOA_CODEX_BIN: missing,
    LOA_CLAUDE_RECHECK_MS: '500',
  });
  try {
    expect(b.output()).toContain("Claude Code isn't logged in. To run it from the map: claude auth login");
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await expect(page.locator('#claudeProblem')).toContainText("Claude Code isn't logged in");
    await expect(page.locator('#claudeFix')).toHaveText('claude auth login');
    await expect(page.locator('#prompt')).toHaveAttribute('placeholder', 'Log in to Claude Code to run it from here');
    await expect(page.locator('#prompt')).toBeDisabled();
    // Logging in clears it without a restart.
    fs.rmSync(flag);
    await expect(page.locator('#claudeProblem')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('#prompt')).toBeEnabled();
    // Logged out between the check and the run: the run's own "Not logged in" brings the notice back.
    fs.writeFileSync(flag, '');
    await page.locator('#prompt').fill('Name the action and origin in allowlist errors');
    await page.locator('#prompt').press('Enter');
    await expect(page.locator('#claudeProblem')).toContainText("Claude Code isn't logged in", { timeout: 15_000 });
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test("a check that can't run on this machine says so, apart from a real failure, and turns off in one click", async ({
  page,
}) => {
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo, 'tools'));
  fs.writeFileSync(path.join(repo, 'tools/__init__.py'), '');
  const checks = [
    { name: 'lint', run: 'definitely-not-installed-xyz --check' },
    { name: 'pytest', run: 'python3 -c "import not_installed_pkg_xyz"' },
    // The repo's own module missing is a real break, not a setup problem.
    { name: 'imports', run: 'python3 -c "import tools.gone"' },
  ];
  fs.writeFileSync(path.join(repo, 'loa.config.json'), JSON.stringify({ checks, keep: 'this setting' }));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'checks');
  const b = await startBridge(repo);
  try {
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await page.locator('#prompt').fill('Name the action and origin in allowlist errors');
    await page.locator('#prompt').press('Enter');
    await expect(page.locator('.check')).toHaveCount(3, { timeout: 15_000 });
    const notRun = page.locator('.check.notrun');
    await expect(notRun).toHaveCount(2);
    await expect(notRun.nth(0)).toContainText("lintCouldn't run");
    await expect(notRun.nth(0).locator('.sm')).toContainText('definitely-not-installed-xyz');
    await expect(notRun.nth(0).locator('.sm')).toContainText('not found');
    await expect(notRun.nth(1).locator('.sm')).toHaveText(
      "ModuleNotFoundError: No module named 'not_installed_pkg_xyz'",
    );
    await expect(page.locator('.check .bad')).toHaveCount(1);
    await expect(page.locator('.check:has(.bad)')).toContainText('imports');
    await expect(page.locator('#sideList .run .tags')).toContainText("1 failed · 2 couldn't run");
    await notRun.nth(1).locator('.checkOff').click();
    await expect(page.locator(TOAST)).toHaveText('Turned off pytest');
    await expect(notRun.nth(1)).toContainText('Turned off.');
    await expect(notRun.nth(1).locator('.checkOff')).toHaveCount(0);
    const conf = JSON.parse(fs.readFileSync(path.join(repo, 'loa.config.json'), 'utf8'));
    expect(conf).toEqual({ checks: [checks[0], checks[2]], keep: 'this setting' });
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test("checks that couldn't run are counted, never tagged as passed", async ({ page }) => {
  const repo = makeRepo();
  fs.writeFileSync(
    path.join(repo, 'loa.config.json'),
    JSON.stringify({
      checks: [
        { name: 'tests', run: 'node -e "console.log(\'3 passed\')"' },
        { name: 'lint', run: 'definitely-not-installed-xyz' },
      ],
    }),
  );
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'checks');
  const b = await startBridge(repo);
  try {
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await page.locator('#prompt').fill('Name the action and origin in allowlist errors');
    await page.locator('#prompt').press('Enter');
    await expect(page.locator('#sideList .run .tags')).toContainText("1 passed · 1 couldn't run", { timeout: 15_000 });
    await expect(page.locator('[data-act="keep"]')).toHaveAttribute('data-variant', 'default');
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('a run that creates a file moves no existing file on the map', async ({ page }) => {
  const repo = makeRepo(),
    b = await startBridge(repo);
  const where = () =>
    page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll<HTMLElement>('.card[data-path]')].map(c => [
          c.dataset.path!,
          `${c.style.left},${c.style.top}`,
        ]),
      ),
    );
  try {
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    const before = await where();
    expect(Object.keys(before).length).toBeGreaterThan(2);
    await page.locator('#prompt').fill('Name the action and origin in allowlist errors');
    await page.locator('#prompt').press('Enter');
    await expect(page.locator('.card[data-path="shared/policy-cache.ts"]')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator('.check .ok')).toHaveCount(1, { timeout: 15_000 });
    const after = await where();
    for (const [p, xy] of Object.entries(before)) expect(after[p], p).toBe(xy);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('cancel a running agent', async ({ page }) => {
  const repo = makeRepo(),
    b = await startBridge(repo, SLOW_AGENT);
  try {
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await page.locator('#prompt').fill('Take your time');
    await page.locator('#prompt').press('Enter');
    await expect(page.locator('#sideList .run.running .m')).toHaveText('Claude Code is working');
    // A running run cannot be opened: its card is disabled, and a click does nothing.
    await expect(page.locator('#sideList .run.running')).toHaveAttribute('aria-disabled', 'true');
    await page.locator('#sideList .run.running').click({ force: true });
    await expect(page.locator('#runbar b')).toHaveText('Run 1');
    await expect(page.locator('#insp .spin').first()).toBeVisible();
    // The agent's latest note is the reply; it is not repeated in the activity list.
    await expect(page.locator('#insp .bubble.md')).toHaveText('Reading the policy module.');
    await expect(page.locator('#insp .acts li')).toHaveCount(0);
    await page.locator('#prompt').fill('Another');
    await page.locator('#prompt').press('Enter');
    await expect(page.locator(TOAST)).toHaveText('Run 1 is still active');
    await page.locator('[data-act="cancel"]').click();
    await expect(page.locator('#sideList .run .m').last()).toContainText('Cancelled', { timeout: 10_000 });
    expect(git(repo, 'status', '--porcelain')).toBe('');
    // The cancelled run changed nothing: J and K have nothing to step through.
    await expect(page.locator('#runbar b')).toHaveText('Run 1');
    await expect(page.locator('#insp .quiet').last()).toHaveText('No changes. No files were edited in this run.');
    await expect(page.locator('#sideList [data-run="1"]')).toContainText('No changes');
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.keyboard.press('j');
    await page.keyboard.press('k');
    await expect(page.locator('#runbar b')).toHaveText('Run 1');
    expect(errors).toEqual([]);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('hosted link: the app on another origin connects with #bridge=PORT', async ({ page }) => {
  const repo = makeRepo(),
    b = await startBridge(repo);
  try {
    await page.goto(`${APP}/#bridge=${b.port}&t=${b.token}`);
    await expect(page.locator('#conn')).toHaveText('Live');
    await expect(page.locator(TOAST)).toHaveText('Connected to sample-repo');
    await page.locator('.frame[data-dir="shared"] > .flabel b').click();
    await page.locator('#prompt').fill('Name the action and origin');
    await page.locator('#prompt').press('Enter');
    await expect(page.locator('#insp .bubble').nth(1)).toHaveText(SUMMARY, { timeout: 15_000 });
    // Bridge down: the last state stays on screen, and the app says it is offline.
    b.stop();
    await expect(page.locator(TOAST)).toHaveText('Lost the bridge connection. Showing the last state.', {
      timeout: 30_000,
    });
    await expect(page.locator('#conn')).toHaveText('Offline');
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

async function runToEnd(b: Bridge, body: object) {
  const api = (p: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${b.port}${p}`, {
      ...init,
      headers: { authorization: 'Bearer ' + b.token, 'content-type': 'application/json' },
    }).then(r => r.json());
  const run = (await api('/api/runs', { method: 'POST', body: JSON.stringify(body) })) as { id: number };
  await expect
    .poll(async () => ((await api('/api/state')) as StateResponse).runs.find(r => r.id === run.id)?.status, {
      timeout: 15_000,
    })
    .toBe('done');
  return ((await api('/api/state')) as StateResponse).runs.find(r => r.id === run.id)!;
}

test('bridge keeps deny rules, records raw agent output, and keeps .env files out of snapshots', async () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, '.env'), 'SECRET=do-not-store\n');
  fs.writeFileSync(path.join(repo, 'shared/.env.local'), 'SECRET=do-not-store\n');
  // A committed template is ordinary repo content and stays in snapshots.
  fs.writeFileSync(path.join(repo, '.env.example'), 'SECRET=\n');
  git(repo, 'add', '.env.example');
  git(repo, '-c', 'user.name=test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'template');
  const deny = ['Read(./.env)', 'Read(./.env.*)', 'Read(./**/.env)', 'Read(./**/.env.*)'];
  fs.mkdirSync(path.join(repo, '.claude'));
  fs.writeFileSync(path.join(repo, '.claude/settings.local.json'), JSON.stringify({ permissions: { deny } }));
  const b = await startBridge(repo);
  try {
    // The bridge adds its hooks and keeps the repo's own deny rules.
    const settings = JSON.parse(fs.readFileSync(path.join(repo, '.claude/settings.local.json'), 'utf8')) as {
      permissions: { deny: string[] };
      hooks: Record<string, unknown>;
    };
    expect(settings.permissions.deny).toEqual(deny);
    expect(Object.keys(settings.hooks).sort()).toEqual(['PreToolUse', 'SessionEnd', 'Stop', 'UserPromptSubmit']);
    // Hooks run the bridge's copy inside the repo, so they survive npx clearing its cache.
    const commands = JSON.stringify(settings.hooks);
    expect(commands).toContain(path.join(repo, '.loa', 'bridge.mjs').replace(/\\/g, '\\\\'));
    expect(fs.existsSync(path.join(repo, '.loa', 'bridge.mjs'))).toBe(true);
    await runToEnd(b, { agent: 'claude', prompt: 'Name the action and origin', scope: ['shared/'], resumeFrom: null });
    const raw = fs.readFileSync(path.join(repo, '.loa/runs/1.stream.jsonl'), 'utf8').trim().split('\n');
    expect(raw.map(l => (JSON.parse(l) as { type: string }).type)).toEqual(['system', 'assistant', 'result']);
    expect(fs.existsSync(path.join(repo, '.loa/runs/1.stderr.log'))).toBe(true);
    for (const which of ['before', 'after']) {
      const files = git(repo, 'ls-tree', '-r', '--name-only', `refs/loa/runs/1/${which}`);
      expect(files.split('\n').filter(f => /(^|\/)\.env/.test(f))).toEqual(['.env.example']);
      expect(files).toContain('shared/allowlist.ts');
    }
    expect(fs.readFileSync(path.join(repo, '.env'), 'utf8')).toBe('SECRET=do-not-store\n');
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('bridge runs Codex with a workspace-write sandbox and resumes by thread id', async () => {
  const repo = makeRepo(),
    argsFile = path.join(path.dirname(repo), 'codex-args.jsonl');
  const b = await startBridge(repo, FAKE_CLAUDE, { LOA_CODEX_BIN: FAKE_CODEX, FAKE_CODEX_ARGS: argsFile });
  try {
    const first = await runToEnd(b, { agent: 'codex', prompt: 'Change the log prefix', scope: [], resumeFrom: null });
    expect(first.sessionId).toBe('thr-fake-1');
    expect(first.summary).toBe('Changed the log prefix.');
    expect(first.changes.map(c => c.path)).toEqual(['shared/log.ts']);
    await runToEnd(b, { agent: 'codex', prompt: 'Again', scope: [], resumeFrom: first.id });
    const calls = fs
      .readFileSync(argsFile, 'utf8')
      .trim()
      .split('\n')
      .map(l => JSON.parse(l) as string[]);
    expect(calls[0]).toEqual(['exec', '--json', '--sandbox', 'workspace-write', 'Change the log prefix']);
    expect(calls[1]).toEqual(['exec', '--json', '--sandbox', 'workspace-write', 'resume', 'thr-fake-1', 'Again']);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('bridge prints the leagueofagents.dev link by default, and --web overrides it', async () => {
  const repo = makeRepo();
  for (const [args, site] of [
    [[], 'https://leagueofagents.dev'],
    [['--web', 'https://example.test/'], 'https://example.test'],
  ] as const) {
    const b = await startBridge(repo, FAKE_CLAUDE, { LOA_WEB_URL: '' }, [...args]);
    try {
      expect(b.output()).toContain(`Open    http://127.0.0.1:${b.port}/#t=${b.token}`);
      await expect.poll(() => b.output()).toContain(`or      ${site}/#bridge=${b.port}&t=${b.token}`);
    } finally {
      b.stop();
    }
  }
  fs.rmSync(path.dirname(repo), { recursive: true, force: true });
});

// Real Claude Code streams, recorded and redacted, replayed through the bridge's parser.
const fixture = (name: string) =>
  fs
    .readFileSync(path.join(AGENT_FIXTURES, name), 'utf8')
    .trim()
    .split('\n')
    .map(
      l =>
        JSON.parse(l) as {
          type: string;
          subtype?: string;
          session_id?: string;
          total_cost_usd?: number;
          result?: string;
          status_category?: string;
          needs_action?: string;
        },
    );

for (const name of fs.readdirSync(AGENT_FIXTURES).filter(f => f.endsWith('.jsonl'))) {
  test(`recorded Claude Code stream parses: ${name}`, async () => {
    const repo = makeRepo();
    const b = await startBridge(repo, REPLAY_AGENT, { LOA_FIXTURE: path.join(AGENT_FIXTURES, name) });
    try {
      const run = await runToEnd(b, { agent: 'claude', prompt: 'Replay', scope: [], resumeFrom: null });
      const events = fixture(name);
      const result = events.find(e => e.type === 'result')!;
      expect(run.sessionId).toBe(events.find(e => e.session_id)!.session_id);
      expect(run.summary).toBe(result.result);
      expect(run.cost).toBe(result.total_cost_usd);
      // Every label is relative to the repo: no absolute paths, no /repo placeholder.
      for (const e of run.stream) {
        expect(e.text).not.toContain(repo);
        expect(e.text).not.toContain('/repo');
      }
      // Claude Code's verdict on the turn: the last post_turn_summary in the recording wins.
      const verdict = events.filter(e => e.type === 'system' && e.subtype === 'post_turn_summary').at(-1);
      if (verdict) {
        expect(run.turn?.status).toBe(verdict.status_category);
        expect(run.turn?.needs === '').toBe(verdict.needs_action === '');
      }
      const lines = run.stream.map(e => `${e.t}: ${e.text}`);
      if (name === 'claude-scope-lock-blocked.jsonl') {
        expect(run.turn?.status).toBe('blocked');
        expect(run.turn?.needs).not.toBe('');
        expect(lines).toContain('tool: Edit backend/app/main.py');
        expect(lines).toContain('warn: Blocked by the scope lock: backend/app/main.py');
      }
      if (name === 'claude-canvas-permission-denied.jsonl')
        expect(lines.some(l => l.startsWith('deny: This Bash command contains multiple operations.'))).toBe(true);
      if (name === 'claude-canvas-run.jsonl') {
        expect(lines).toContain('tool: Edit backend/app/main.py');
        expect(lines).toContain('tool: Edit frontend/lib/api.ts');
      }
    } finally {
      b.stop();
      fs.rmSync(path.dirname(repo), { recursive: true, force: true });
    }
  });
}

test('terminal Claude Code: hooks record the turn, with its reply and tool calls', async () => {
  const repo = makeRepo(),
    b = await startBridge(repo, undefined, { LOA_QUIET_MS: String(QUIET) });
  // Run a hook the way Claude Code does: JSON on stdin, from inside the repo, not as a managed run.
  const hook = (kind: string, input: object) =>
    execFileSync(process.execPath, [BRIDGE, 'hook', kind], {
      cwd: repo,
      input: JSON.stringify(input),
      env: { ...process.env, LOA_MANAGED: '' },
    });
  try {
    hook('start', { prompt: 'Tag log lines with the app name', session_id: 'sess-term', cwd: repo });
    // A second set of hooks (a plugin's) sends the same prompt: still one run.
    hook('start', { prompt: 'Tag log lines with the app name', session_id: 'sess-term', cwd: repo });
    // Claude Code's own notices arrive as prompts too; they never start a run.
    hook('start', {
      prompt: '<task-notification>\n<task-id>b1</task-id>\n</task-notification>',
      session_id: 'sess-term',
      cwd: repo,
    });
    fs.writeFileSync(
      path.join(repo, 'shared/log.ts'),
      'export const log = (msg: string) => console.log(`[app] ${msg}`);\n',
    );
    const transcript = path.join(path.dirname(repo), 'transcript.jsonl');
    const entries = [
      { type: 'user', message: { role: 'user', content: 'Tag log lines with the app name' } },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Read', input: { file_path: path.join(repo, 'shared/log.ts') } }],
        },
      },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'export const log = …' }] } },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Edit', input: { file_path: path.join(repo, 'shared/log.ts') } }],
        },
      },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Log lines now start with `[app]`.' }] } },
    ];
    fs.writeFileSync(transcript, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
    hook('stop', { session_id: 'sess-term', transcript_path: transcript, cwd: repo });
    const run = JSON.parse(fs.readFileSync(path.join(repo, '.loa/runs/1.json'), 'utf8')) as RunDTO;
    expect(run.agent).toBe('claude-terminal');
    expect(run.status).toBe('done');
    expect(run.sessionId).toBe('sess-term');
    expect(run.summary).toBe('Log lines now start with `[app]`.');
    expect(run.stream.filter(e => e.t === 'tool').map(e => e.text)).toEqual([
      'Read shared/log.ts',
      'Edit shared/log.ts',
    ]);
    expect(run.changes.map(c => c.path)).toEqual(['shared/log.ts']);
    // Watch mode saw the same edit and stayed quiet: the hook run is the only run.
    await new Promise(r => setTimeout(r, QUIET * 4));
    expect((await runsOf(b)).map(r => r.agent)).toEqual(['claude-terminal']);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// Watch mode. A short quiet period keeps these tests fast; the bridge's default is 3 seconds.
const QUIET = 300;
const settled = () => new Promise(r => setTimeout(r, QUIET * 5));
async function runsOf(b: Bridge) {
  const res = await fetch(`http://127.0.0.1:${b.port}/api/state`, { headers: { authorization: 'Bearer ' + b.token } });
  return ((await res.json()) as StateResponse).runs;
}
async function watching(fn: (repo: string, b: Bridge) => Promise<void>) {
  const repo = makeRepo(),
    b = await startBridge(repo, undefined, { LOA_QUIET_MS: String(QUIET) }, ['--no-hooks']);
  try {
    await fn(repo, b);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
}

test('watch mode: a save from any editor becomes one run once the files are quiet', () =>
  watching(async (repo, b) => {
    // Saved the way TextEdit saves: a temporary file renamed over the original, then a second quick save.
    const file = path.join(repo, 'shared/log.ts');
    fs.writeFileSync(file + '.sb-tmp', 'export const log = (msg: string) => console.log(`[edited] ${msg}`);\n');
    fs.renameSync(file + '.sb-tmp', file);
    await new Promise(r => setTimeout(r, QUIET / 3));
    fs.appendFileSync(file, '// saved again\n');
    await expect.poll(async () => (await runsOf(b)).length, { timeout: 10_000 }).toBe(1);
    await settled();
    const runs = await runsOf(b);
    expect(runs).toHaveLength(1);
    expect(runs[0]!).toMatchObject({ agent: 'detected', title: 'Edited log.ts', status: 'done', prompt: '' });
    expect(runs[0]!.changes.map(c => c.path)).toEqual(['shared/log.ts']);
    expect(git(repo, 'diff', '--name-only', `refs/loa/runs/1/before`, `refs/loa/runs/1/after`).trim()).toBe(
      'shared/log.ts',
    );
    // Nothing was staged or committed.
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('');
    expect(git(repo, 'log', '--oneline').trim().split('\n')).toHaveLength(1);
    // Reverting it restores the file, and the bridge's own write is not another run.
    const res = await fetch(`http://127.0.0.1:${b.port}/api/runs/1/revert`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + b.token, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(200);
    expect(fs.readFileSync(file, 'utf8')).toBe(SEED['shared/log.ts']);
    await settled();
    expect((await runsOf(b)).map(r => r.reverted)).toEqual([true]);
  }));

test('watch mode: ignored folders, untracked .env files and git bookkeeping make no runs', () =>
  watching(async (repo, b) => {
    fs.writeFileSync(path.join(repo, '.gitignore'), 'out/\n.cache/\n');
    git(repo, 'add', '.gitignore');
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'ignore build output');
    await settled();
    // A dev server writing its output over and over.
    for (let i = 0; i < 10; i++) {
      fs.mkdirSync(path.join(repo, 'out/chunks'), { recursive: true });
      fs.writeFileSync(path.join(repo, `out/chunks/page-${i}.js`), `console.log(${i});\n`);
      fs.mkdirSync(path.join(repo, '.cache'), { recursive: true });
      fs.writeFileSync(path.join(repo, '.cache/state.json'), JSON.stringify({ i }));
      await new Promise(r => setTimeout(r, QUIET / 2));
    }
    fs.writeFileSync(path.join(repo, '.env'), 'SECRET=never-recorded\n');
    git(repo, 'status', '--porcelain');
    await settled();
    expect(await runsOf(b)).toEqual([]);
  }));

test('watch mode: a branch switch or pull resets the baseline and is never a run', () =>
  watching(async (repo, b) => {
    const commit = (msg: string) =>
      git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qam', msg);
    git(repo, 'switch', '-qc', 'feature');
    fs.writeFileSync(path.join(repo, 'shared/log.ts'), 'export const log = (msg: string) => msg;\n');
    fs.writeFileSync(path.join(repo, 'apps/console/extra.ts'), 'export const extra = 1;\n');
    git(repo, 'add', '-A');
    commit('feature work');
    git(repo, 'switch', '-q', 'main');
    await settled();
    git(repo, 'switch', '-q', 'feature');
    await settled();
    // A pull, as a fast-forward merge of new commits.
    git(repo, 'switch', '-q', 'main');
    git(repo, 'merge', '-q', '--ff-only', 'feature');
    await settled();
    expect(await runsOf(b)).toEqual([]);
    // After the switches, an edit is still recorded against the new baseline, and only the edit.
    fs.appendFileSync(path.join(repo, 'apps/console/extra.ts'), 'export const more = 2;\n');
    await expect.poll(async () => (await runsOf(b)).length, { timeout: 10_000 }).toBe(1);
    const [run] = await runsOf(b);
    expect(run!.changes.map(c => c.path)).toEqual(['apps/console/extra.ts']);
    expect(run!.changes[0]!.hunks.flatMap(h => h.add)).toEqual(['export const more = 2;']);
  }));

test('watch mode: an edit made just before an agent run is its own run, not the agent’s', () =>
  watching(async (repo, b) => {
    fs.appendFileSync(path.join(repo, 'apps/console/main.ts'), "log('edited by hand');\n");
    // The run starts before watch mode's quiet period ends.
    const res = await fetch(`http://127.0.0.1:${b.port}/api/runs`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + b.token, 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'claude', prompt: 'Name the action and origin', scope: [] }),
    });
    expect(res.ok).toBe(true);
    await expect.poll(async () => (await runsOf(b)).map(r => r.status), { timeout: 15_000 }).toEqual(['done', 'done']);
    await settled();
    const runs = await runsOf(b);
    expect(runs.map(r => [r.agent, r.changes.map(c => c.path)])).toEqual([
      ['detected', ['apps/console/main.ts']],
      ['claude', ['shared/allowlist.ts', 'shared/policy-cache.ts']],
    ]);
  }));

test('watch mode: a terminal turn interrupted before Stop is closed by the next prompt or the session ending', () =>
  watching(async (repo, b) => {
    const hook = (kind: string, input: object) =>
      execFileSync(process.execPath, [BRIDGE, 'hook', kind], {
        cwd: repo,
        input: JSON.stringify(input),
        env: { ...process.env, LOA_MANAGED: '' },
      });
    const edit = (line: string) => fs.appendFileSync(path.join(repo, 'shared/log.ts'), line + '\n');
    // Esc interrupts the first turn, so Claude Code never sends Stop. The next prompt closes it.
    hook('start', { prompt: 'First turn', session_id: 's1', cwd: repo });
    edit('// first turn');
    hook('start', { prompt: 'Second turn', session_id: 's1', cwd: repo });
    edit('// second turn');
    // The second turn is interrupted too; then the session ends (SessionEnd runs the same hook as Stop).
    hook('stop', { session_id: 's1', reason: 'prompt_input_exit', cwd: repo });
    // Watch mode is back on: a later hand edit is a run of its own.
    edit('// by hand');
    await expect.poll(async () => (await runsOf(b)).length, { timeout: 10_000 }).toBe(3);
    const runs = await runsOf(b);
    expect(runs.map(r => [r.agent, r.status, r.title, r.changes[0]!.hunks.flatMap(h => h.add)])).toEqual([
      ['claude-terminal', 'interrupted', 'First turn', ['// first turn']],
      ['claude-terminal', 'done', 'Second turn', ['// second turn']],
      ['detected', 'done', 'Edited log.ts', ['// by hand']],
    ]);
  }));

test('with no agent installed, the composer says how to install Claude Code and edits still become runs', async ({
  page,
}) => {
  const missing = '/nonexistent/agent';
  const repo = makeRepo(),
    b = await startBridge(repo, missing, { LOA_CURSOR_BIN: missing, LOA_CODEX_BIN: missing, LOA_QUIET_MS: '300' });
  try {
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await expect(page.locator('#prompt')).toBeDisabled();
    await expect(page.locator('#prompt')).toHaveAttribute('placeholder', 'Install Claude Code to run it from here');
    await expect(page.locator('#claudeProblem')).toContainText("Claude Code isn't installed");
    await expect(page.locator('#claudeFix')).toHaveText('curl -fsSL https://claude.ai/install.sh | bash');
    await expect(page.locator('#sendBtn')).toBeDisabled();
    await expect(page.locator('#agentBtn')).toHaveCount(0);
    await expect(page.locator('#sideList .empty')).toHaveText('No runs yet. Edit any file and it shows up here.');
    fs.appendFileSync(path.join(repo, 'shared/log.ts'), '// by hand\n');
    await expect(page.locator('#sideList [data-run="1"]')).toContainText('Edited log.ts', { timeout: 10_000 });
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('watch mode: a run is named for what changed', () =>
  watching(async (repo, b) => {
    fs.appendFileSync(path.join(repo, 'apps/console/main.ts'), "log('one');\n");
    fs.appendFileSync(path.join(repo, 'shared/log.ts'), '// two\n');
    fs.writeFileSync(path.join(repo, 'shared/new-helper.ts'), 'export const three = 3;\n');
    await expect
      .poll(async () => (await runsOf(b)).map(r => r.title), { timeout: 10_000 })
      .toEqual(['Edited main.ts and 2 more']);
  }));

// Zoom levels on a real repository's shape: averroes-public's tree, with stand-in contents.
test('zoom levels on averroes-public: labels never overlap, names never wrap, every folder draws its files', async ({
  page,
}) => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loa-e2e-')), 'averroes-public');
  const paths = fs.readFileSync(path.join(REPO_ROOT, 'tests/fixtures/averroes-paths.txt'), 'utf8').trim().split('\n');
  paths.forEach((p, i) => {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    const lines = Array.from({ length: 8 + ((i * 7) % 40) }, (_, j) => '  '.repeat(j % 3) + `line ${j} of ${p}`);
    fs.writeFileSync(path.join(dir, p), lines.join('\n') + '\n');
  });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'tree');
  const b = await startBridge(dir, undefined, {}, ['--no-hooks']);
  try {
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    for (const z of ZOOMS) {
      await zoomTo(page, z);
      await checkLevel(page);
    }
  } finally {
    b.stop();
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  }
});

// The editor's file routes. A save is a run by "You".
async function call(b: Bridge, route: string, body?: object) {
  const res = await fetch(`http://127.0.0.1:${b.port}${route}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: 'Bearer ' + b.token, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

test('file routes serve only files on the map, inside the repo', () =>
  watching(async (repo, b) => {
    const ok = await call(b, '/api/file?path=shared/log.ts');
    expect(ok.status).toBe(200);
    expect(ok.body.text).toBe(SEED['shared/log.ts']);
    expect(ok.body.hash).toMatch(/^[0-9a-f]{40}$/);
    fs.writeFileSync(path.join(repo, '.env'), 'SECRET=never-served\n');
    fs.writeFileSync(path.join(path.dirname(repo), 'outside.ts'), 'export const outside = 1;\n');
    fs.symlinkSync(path.join(path.dirname(repo), 'outside.ts'), path.join(repo, 'shared/link.ts'));
    for (const p of ['../outside.ts', 'shared/../../outside.ts', '.env', 'shared/link.ts', 'nope.ts', '.git/config'])
      for (const r of [
        await call(b, '/api/file?path=' + encodeURIComponent(p)),
        await call(b, '/api/save', { path: p, text: 'x', base: '' }),
      ]) {
        expect(r.status, p).toBe(404);
        expect(JSON.stringify(r.body)).not.toContain('SECRET');
      }
    expect(fs.readFileSync(path.join(path.dirname(repo), 'outside.ts'), 'utf8')).toBe('export const outside = 1;\n');
  }));

test('a save is a run by You that reverts cleanly; a file changed on disk is never overwritten', () =>
  watching(async (repo, b) => {
    const file = path.join(repo, 'shared/log.ts');
    const { body } = await call(b, '/api/file?path=shared/log.ts');
    const text = 'export const log = (msg: string) => console.log(`[saved] ${msg}`);\n';
    const saved = await call(b, '/api/save', { path: 'shared/log.ts', text, base: body.hash });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ agent: 'you', title: 'Edited log.ts', status: 'done' });
    expect(fs.readFileSync(file, 'utf8')).toBe(text);
    await settled();
    // One run: watch mode stayed quiet, and nothing was staged or committed.
    expect((await runsOf(b)).map(r => r.agent)).toEqual(['you']);
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('');
    // Saving the same text again changes nothing.
    const sha = crypto.createHash('sha1').update(text).digest('hex');
    const again = await call(b, '/api/save', { path: 'shared/log.ts', text, base: sha });
    expect(again.body).toEqual({ unchanged: true });
    // Revert restores the file exactly.
    expect((await call(b, '/api/runs/1/revert', {})).status).toBe(200);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(git(repo, 'diff', 'refs/loa/runs/1/before', '--', 'shared/log.ts')).toBe('');
    // Changed on disk after opening: 409 with the current text; the file keeps the other edit.
    const opened = await call(b, '/api/file?path=shared/log.ts');
    fs.appendFileSync(file, '// edited elsewhere\n');
    const conflict = await call(b, '/api/save', { path: 'shared/log.ts', text: 'mine\n', base: opened.body.hash });
    expect(conflict.status).toBe(409);
    expect(conflict.body.text).toBe(SEED['shared/log.ts'] + '// edited elsewhere\n');
    expect(fs.readFileSync(file, 'utf8')).toBe(SEED['shared/log.ts'] + '// edited elsewhere\n');
  }));

test('terminal hooks never end a save; a save during a run is refused', () =>
  watching(async (repo, b) => {
    const hookAsync = (kind: string, input: object) =>
      new Promise<void>(resolve => {
        const c = execFile(
          process.execPath,
          [BRIDGE, 'hook', kind],
          { cwd: repo, env: { ...process.env, LOA_MANAGED: '' } },
          () => resolve(),
        );
        c.stdin!.end(JSON.stringify(input));
      });
    const { body } = await call(b, '/api/file?path=shared/log.ts');
    const text = 'export const log = (msg: string) => msg;\n';
    // A terminal prompt and stop fire while the save is in flight.
    const [saved] = await Promise.all([
      call(b, '/api/save', { path: 'shared/log.ts', text, base: body.hash }),
      hookAsync('start', { prompt: 'Meanwhile in the terminal', session_id: 's', cwd: repo }),
      hookAsync('stop', { session_id: 's', cwd: repo }),
    ]);
    expect(saved.status).toBe(200);
    const runs = await runsOf(b);
    const you = runs.find(r => r.agent === 'you')!;
    expect(you.status).toBe('done');
    expect(you.changes.map(c => c.path)).toEqual(['shared/log.ts']);
    expect(you.changes[0]!.hunks.flatMap(h => h.add)).toEqual(['export const log = (msg: string) => msg;']);
    // During an active run, a save is refused and the file is untouched.
    await hookAsync('start', { prompt: 'Working', session_id: 't', cwd: repo });
    const now = await call(b, '/api/file?path=shared/log.ts');
    const refused = await call(b, '/api/save', { path: 'shared/log.ts', text: 'other\n', base: now.body.hash });
    expect(refused.status).toBe(409);
    expect(fs.readFileSync(path.join(repo, 'shared/log.ts'), 'utf8')).toBe(text);
  }));

test('the editor on a live repo: save is a You run that reverts cleanly; disk changes and runs are respected', async ({
  page,
}) => {
  const repo = makeRepo(),
    b = await startBridge(repo, SLOW_AGENT, { LOA_QUIET_MS: String(QUIET) }, ['--no-hooks']);
  const file = path.join(repo, 'shared/log.ts');
  const open = async () => {
    // Select it unless it already is (a click on a selected tile deselects it), then Enter.
    const tile = page.locator('.fr[data-path="shared/log.ts"]');
    if (!/(^|\s)sel(\s|$)/.test((await tile.getAttribute('class')) ?? '')) await tile.click();
    await page.keyboard.press('Enter');
    await expect(page.locator('#editor .cm-content')).toBeFocused();
  };
  try {
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await page.keyboard.press('0');
    await open();
    // An outside change, with no draft, shows in the open editor.
    fs.appendFileSync(file, '// from outside\n');
    await expect(page.locator('#editor .cm-content')).toContainText('// from outside', { timeout: 10_000 });
    // Save: a run by You, written to disk.
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('// saved from the map');
    await page.keyboard.press('ControlOrMeta+s');
    await expect(page.locator(TOAST)).toHaveText(/^Saved as run \d+$/);
    // Saving keeps the person's place: the editor stays focused.
    await expect(page.locator('#editor .cm-content')).toBeFocused();
    expect(fs.readFileSync(file, 'utf8')).toBe(SEED['shared/log.ts'] + '// from outside\n// saved from the map');
    const runs = await runsOf(b);
    const you = runs.find(r => r.agent === 'you')!;
    expect(you.title).toBe('Edited log.ts');
    // A draft, then the file changes on disk: saving warns and shows the change; nothing is overwritten.
    await page.keyboard.type('\n// my draft');
    fs.writeFileSync(file, SEED['shared/log.ts'] + '// someone else\n');
    await page.locator('#saveFile').click();
    await expect(page.locator('#editorConflict')).toContainText('This file changed on disk since you opened it');
    await expect(page.locator('#editorConflict pre')).toContainText('someone else');
    expect(fs.readFileSync(file, 'utf8')).toBe(SEED['shared/log.ts'] + '// someone else\n');
    await page.locator('#overwrite').click();
    await expect(page.locator('#editorConflict')).toHaveCount(0);
    expect(fs.readFileSync(file, 'utf8')).toContain('// my draft');
    // Revert the You run: the file is as it was before it.
    await page.keyboard.press('Escape');
    await expect(page.locator('#editor')).toHaveCount(0);
    const last = (await runsOf(b)).filter(r => r.agent === 'you').at(-1)!;
    expect((await call(b, `/api/runs/${last.id}/revert`, {})).status).toBe(200);
    expect(git(repo, 'diff', `refs/loa/runs/${last.id}/before`, '--', 'shared/log.ts')).toBe('');
    // While an agent works, the editor is read-only and says why.
    await page.locator('#prompt').fill('Take your time');
    await page.locator('#prompt').press('Enter');
    await expect(page.locator('#sideList .run.running')).toHaveCount(1);
    await open();
    await expect(page.locator('#editorBlocked')).toHaveText(/^Run \d+ is working\. Editing waits until it finishes\.$/);
    await expect(page.locator('#editor .cm-content')).toHaveAttribute('aria-readonly', 'true');
    const before = await page.locator('#editor .cm-content').textContent();
    await page.keyboard.type('nope');
    await expect(page.locator('#editor .cm-content')).toHaveText(before!);
    await expect(page.locator('#saveFile')).toBeDisabled();
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// A run limited to lines of a file. The range is held by its surroundings.
test('scope lock on a line range: edits inside pass, any change outside is blocked', () => {
  const repo = makeRepo();
  const scopeFile = path.join(path.dirname(repo), 'scope.json');
  // Lines 7 to 11 of allowlist.ts: assertAllowed, through the end of the file.
  fs.writeFileSync(
    scopeFile,
    JSON.stringify({
      scope: ['shared/allowlist.ts:7-10'],
      ranges: { 'shared/allowlist.ts': { from: 7, to: 10, before: SEED['shared/allowlist.ts'] } },
    }),
  );
  const pre = (tool_input: object) => {
    try {
      execFileSync(process.execPath, [BRIDGE, 'hook', 'pre'], {
        cwd: repo,
        input: JSON.stringify({
          cwd: repo,
          tool_input: { file_path: path.join(repo, 'shared/allowlist.ts'), ...tool_input },
        }),
        env: { ...process.env, LOA_SCOPE_FILE: scopeFile },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return 'allowed';
    } catch (e) {
      const err = e as { status: number; stderr: Buffer };
      return err.status === 2 ? 'blocked: ' + String(err.stderr) : 'error ' + err.status;
    }
  };
  const inside = "throw new Error('ALLOWLIST_VIOLATION');";
  expect(pre({ old_string: inside, new_string: 'throw new Error(`denied: ${action}`);' })).toBe('allowed');
  // Growing the range is fine: the lines around it stay as they were.
  expect(pre({ old_string: inside, new_string: "log('denied');\n    throw new Error('ALLOWLIST_VIOLATION');" })).toBe(
    'allowed',
  );
  expect(pre({ old_string: 'export type Policy', new_string: 'export type Rules' })).toMatch(
    /^blocked: League of Agents scope lock: this edit changes shared\/allowlist\.ts outside lines 7–10\./,
  );
  expect(pre({ old_string: 'Policy', new_string: 'Rules', replace_all: true })).toMatch(/^blocked/);
  expect(
    pre({
      edits: [
        { old_string: inside, new_string: "throw new Error('denied');" },
        { old_string: "actions: ['read', 'submit']", new_string: "actions: ['read']" },
      ],
    }),
  ).toMatch(/^blocked/);
  const insideOnly = SEED['shared/allowlist.ts']!.replace(inside, "throw new Error('denied');");
  expect(pre({ content: insideOnly })).toBe('allowed');
  expect(pre({ content: '// rewritten\n' + insideOnly })).toMatch(/^blocked/);
  expect(pre({ file_path: path.join(repo, 'shared/log.ts'), old_string: 'x', new_string: 'y' })).toMatch(
    /^blocked: League of Agents scope lock: shared\/log\.ts is outside the selected scope/,
  );
  fs.rmSync(path.dirname(repo), { recursive: true, force: true });
});

test('a run limited to lines flags changes outside them, for any agent', () =>
  watching(async (repo, b) => {
    // The stand-in agent changes line 9 of allowlist.ts, appends to it, and creates policy-cache.ts.
    const start = await call(b, '/api/runs', {
      agent: 'claude',
      prompt: 'Only touch loadPolicy',
      scope: ['shared/allowlist.ts:3-5'],
    });
    expect(start.status).toBe(200);
    await expect.poll(async () => (await runsOf(b))[0]?.status, { timeout: 15_000 }).toBe('done');
    const [run] = await runsOf(b);
    expect(run!.outOfScope).toEqual(['shared/allowlist.ts outside lines 3–5', 'shared/policy-cache.ts']);
    expect(run!.stream.map(e => e.text)).toContain(
      'Changed outside scope: shared/allowlist.ts outside lines 3–5, shared/policy-cache.ts',
    );
  }));

test('lines selected in the editor scope a live run; changes outside them are flagged; revert is exact', async ({
  page,
}) => {
  const repo = makeRepo(),
    b = await startBridge(repo, undefined, { LOA_QUIET_MS: String(QUIET) }, ['--no-hooks']);
  try {
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await page.keyboard.press('0');
    await page.locator('.fr[data-path="shared/allowlist.ts"]').click();
    await page.keyboard.press('Enter');
    await expect(page.locator('#editor .cm-content')).toBeFocused();
    // Lines 3 to 5: loadPolicy.
    await page.locator('#editor .cm-line').nth(2).click();
    await page.keyboard.press('Home');
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowDown');
    await expect(page.locator('#scopeRow .chip:not(.all) > span')).toHaveText(['allowlist.ts:3–5']);
    await page.keyboard.press('ControlOrMeta+k');
    await page.keyboard.type('Load the policy from the environment');
    await page.keyboard.press('Enter');
    await expect(page.locator('#editorReview')).toBeVisible({ timeout: 15_000 });
    const [run] = (await runsOf(b)).filter(r => r.agent === 'claude');
    expect(run!.scope).toEqual(['shared/allowlist.ts:3-5']);
    // The stand-in agent changed line 9 and created a file: both are flagged, on the run and in its review.
    expect(run!.outOfScope).toEqual(['shared/allowlist.ts outside lines 3–5', 'shared/policy-cache.ts']);
    await expect(page.locator('#editor .cm-added').first()).toBeVisible();
    await expect(page.locator('#editor .cm-removed')).toContainText(["    throw new Error('ALLOWLIST_VIOLATION');"]);
    await page.locator('#rejectChange').click();
    await expect(page.locator('#editorReview')).toHaveCount(0);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(fs.readFileSync(path.join(repo, 'shared/allowlist.ts'), 'utf8')).toBe(SEED['shared/allowlist.ts']);
    await expect(page.locator('#editor .cm-content')).not.toContainText('isEmpty');
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('open in Cursor or VS Code at the cursor line, from the editor and the inspector', async ({ page }) => {
  const repo = makeRepo(),
    b = await startBridge(repo, undefined, {}, ['--no-hooks']);
  const root = fs.realpathSync(repo);
  try {
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await page.keyboard.press('0');
    await page.locator('.fr[data-path="shared/allowlist.ts"]').click();
    await expect(page.locator('#insp [data-editor="cursor"]')).toHaveAttribute(
      'href',
      `cursor://file${root}/shared/allowlist.ts:1`,
    );
    await expect(page.locator('#insp [data-editor="vscode"]')).toHaveAttribute(
      'href',
      `vscode://file${root}/shared/allowlist.ts:1`,
    );
    await page.keyboard.press('Enter');
    await expect(page.locator('#editor .cm-content')).toBeFocused();
    await page.locator('#editor .cm-line').nth(8).click();
    await page.locator('#openIn').click();
    await expect(page.locator('#openInMenu [data-editor="cursor"]')).toHaveAttribute(
      'href',
      `cursor://file${root}/shared/allowlist.ts:9`,
    );
    await expect(page.locator('#openInMenu [data-editor="vscode"]')).toHaveAttribute(
      'href',
      `vscode://file${root}/shared/allowlist.ts:9`,
    );
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// Hooks for Claude Code, Codex and Cursor, installed only with consent, removed exactly.
test('hooks go in only with consent, and removing them restores every file byte for byte', async () => {
  const repo = makeRepo();
  const files = {
    '.claude/settings.local.json':
      '{\n    "permissions": { "deny": ["Read(./.env)"] },\n    "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "say done" } ] } ] }\n}',
    '.codex/hooks.json':
      '{"hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command","command":"python3 mine.py","timeout":5}]}]}}\n',
  };
  for (const [p, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, p)), { recursive: true });
    fs.writeFileSync(path.join(repo, p), text);
  }
  // Without consent (no terminal to ask in, no --hooks), nothing is touched.
  let b = await startBridge(repo, undefined, {}, ['--ask']);
  b.stop();
  for (const [p, text] of Object.entries(files)) expect(fs.readFileSync(path.join(repo, p), 'utf8')).toBe(text);
  expect(fs.existsSync(path.join(homeOf(repo), '.cursor'))).toBe(false);
  // With consent: ours are added next to theirs, in each agent's own file.
  b = await startBridge(repo, undefined, {}, []);
  b.stop();
  type HookFile = {
    version?: number;
    permissions?: unknown;
    hooks: Record<string, { command?: string; hooks?: { command: string }[] }[]>;
  };
  const read = (p: string, dir = repo) => JSON.parse(fs.readFileSync(path.join(dir, p), 'utf8')) as HookFile;
  const claude = read('.claude/settings.local.json');
  expect(claude.permissions).toEqual({ deny: ['Read(./.env)'] });
  expect(claude.hooks.Stop![0]!.hooks![0]!.command).toBe('say done');
  expect(Object.keys(claude.hooks).sort()).toEqual(['PreToolUse', 'SessionEnd', 'Stop', 'UserPromptSubmit']);
  const codex = read('.codex/hooks.json');
  expect(codex.hooks.UserPromptSubmit![0]!.hooks![0]!.command).toBe('python3 mine.py');
  expect(codex.hooks.UserPromptSubmit![1]!.hooks![0]!.command).toMatch(/\.loa\/bridge\.mjs" hook start codex$/);
  expect(codex.hooks.Stop![0]!.hooks![0]!.command).toMatch(/hook stop codex$/);
  // Cursor's go in the person's own Cursor settings: it reads project hooks only from the workspace folder.
  expect(fs.existsSync(path.join(repo, '.cursor'))).toBe(false);
  const cursor = read('.cursor/hooks.json', homeOf(repo));
  expect(cursor.version).toBe(1);
  expect(cursor.hooks.beforeSubmitPrompt![0]!.command).toMatch(/hook start cursor$/);
  expect(cursor.hooks.stop![0]!.command).toMatch(/hook stop cursor$/);
  // The choice is remembered: a later start installs again without asking.
  b = await startBridge(repo, undefined, {}, ['--ask']);
  b.stop();
  expect(read('.codex/hooks.json').hooks.Stop).toHaveLength(1);
  // Removing: every file is back exactly as it was; the file and folder we created are gone.
  execFileSync(process.execPath, [BRIDGE, 'hooks', 'remove'], {
    cwd: repo,
    env: { ...process.env, HOME: homeOf(repo) },
  });
  for (const [p, text] of Object.entries(files)) expect(fs.readFileSync(path.join(repo, p), 'utf8')).toBe(text);
  expect(fs.existsSync(path.join(homeOf(repo), '.cursor'))).toBe(false);
  fs.rmSync(path.dirname(repo), { recursive: true, force: true });
});

test('Codex and Cursor hook payloads become runs with the prompt as the title, labelled beta', ({ page }) =>
  watching(async (repo, b) => {
    const hook = (args: string[], input: object) =>
      execFileSync(process.execPath, [BRIDGE, 'hook', ...args], {
        cwd: repo,
        input: JSON.stringify(input),
        env: { ...process.env, LOA_MANAGED: '' },
        encoding: 'utf8',
      });
    // Codex's documented UserPromptSubmit and Stop payloads.
    hook(['start', 'codex'], {
      session_id: 'thr_abc123',
      turn_id: 'turn_xyz789',
      cwd: repo,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'Tag log lines with the app name',
      transcript_path: null,
      permission_mode: 'default',
      model: 'gpt-5-codex',
    });
    fs.writeFileSync(path.join(repo, 'shared/log.ts'), 'export const log = (msg: string) => `[app] ${msg}`;\n');
    hook(['stop', 'codex'], {
      session_id: 'thr_abc123',
      turn_id: 'turn_xyz789',
      cwd: repo,
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'Log lines now start with [app].',
      transcript_path: null,
      permission_mode: 'default',
      model: 'gpt-5-codex',
    });
    // Cursor's documented beforeSubmitPrompt and stop payloads; Cursor reads an answer from each hook.
    const common = {
      conversation_id: '668320d2-2fd8-4888-b33c-2a466fec86e7',
      generation_id: '490b90b7-a2ce-4c2c-bb76-cb77b125df2f',
      model: 'claude-sonnet',
      cursor_version: '2.1.6',
      workspace_roots: [repo],
      user_email: null,
      transcript_path: null,
    };
    expect(
      JSON.parse(
        hook(['start', 'cursor'], {
          ...common,
          hook_event_name: 'beforeSubmitPrompt',
          prompt: 'Name the action in allowlist errors',
          attachments: [],
        }),
      ),
    ).toEqual({ continue: true });
    fs.appendFileSync(path.join(repo, 'shared/allowlist.ts'), '// cursor\n');
    expect(
      JSON.parse(hook(['stop', 'cursor'], { ...common, hook_event_name: 'stop', status: 'aborted', loop_count: 0 })),
    ).toEqual({});
    await settled();
    const runs = await runsOf(b);
    expect(runs.map(r => [r.agent, r.title, r.status, r.sessionId, r.summary, r.changes.map(c => c.path)])).toEqual([
      [
        'codex-terminal',
        'Tag log lines with the app name',
        'done',
        'thr_abc123',
        'Log lines now start with [app].',
        ['shared/log.ts'],
      ],
      [
        'cursor-editor',
        'Name the action in allowlist errors',
        'cancelled',
        '668320d2-2fd8-4888-b33c-2a466fec86e7',
        '',
        ['shared/allowlist.ts'],
      ],
    ]);
    // Not yet verified with a real run: labelled beta on the run card and in the inspector.
    await page.goto(linkFor(b));
    await expect(page.locator('#sideList [data-run="1"]')).toContainText('Codex (terminal)');
    await expect(page.locator('#sideList [data-run="1"] .beta')).toHaveText('Beta');
    await page.locator('#sideList [data-run="2"]').click();
    await expect(page.locator('#insp .meta .beta')).toHaveText('Beta');
  }));

test("Cursor's hooks are shared: the repo that installed them last removes them", async () => {
  const a = makeRepo(),
    b = path.join(path.dirname(a), 'second-repo'),
    home = homeOf(a),
    file = path.join(home, '.cursor/hooks.json');
  fs.cpSync(a, b, { recursive: true });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const theirs = '{"version":1,"hooks":{"stop":[{"command":"say done"}]}}\n';
  fs.writeFileSync(file, theirs);
  const loa = (repo: string, ...args: string[]) =>
    execFileSync(process.execPath, [BRIDGE, ...args], { cwd: repo, env: { ...process.env, HOME: home } });
  try {
    for (const repo of [a, b]) (await startBridge(repo)).stop();
    const commands = () => fs.readFileSync(file, 'utf8');
    expect(commands()).toContain(path.join(b, '.loa/bridge.mjs'));
    expect(commands()).not.toContain(path.join(a, '.loa/bridge.mjs'));
    // The first repo no longer owns them: removing its hooks leaves Cursor's file to the second.
    loa(a, 'hooks', 'remove');
    expect(commands()).toContain(path.join(b, '.loa/bridge.mjs'));
    // Back to the person's own hooks (as JSON: the file the second repo found already held the first's).
    loa(b, 'hooks', 'remove');
    expect(JSON.parse(commands())).toEqual(JSON.parse(theirs));
  } finally {
    fs.rmSync(path.dirname(a), { recursive: true, force: true });
  }
});

// Cursor opens a folder as its workspace, often the folder holding the repo, and reads hooks only from there or
// from the person's own settings. The hook finds the repo from the workspace and the files attached.
test('Cursor hooks find the repo inside the workspace, and only their own conversation closes a run', async () => {
  const repo = makeRepo(),
    workspace = path.dirname(repo),
    other = path.join(workspace, 'other-repo');
  const b = await startBridge(repo, undefined, { LOA_QUIET_MS: String(QUIET) }, ['--no-hooks']);
  let b2: Bridge | null = null;
  const hook = (args: string[], input: object) =>
    execFileSync(process.execPath, [BRIDGE, 'hook', ...args], {
      cwd: workspace,
      input: JSON.stringify({ cursor_version: '2.1.6', workspace_roots: [workspace], transcript_path: null, ...input }),
      env: { ...process.env, LOA_MANAGED: '' },
      encoding: 'utf8',
    });
  const summary = async (x: Bridge) => (await runsOf(x)).map(r => [r.agent, r.title, r.status, r.sessionId]);
  try {
    // Cursor's own hook, and Cursor running Claude Code's hook file for the same prompt: one Cursor run.
    const prompt = { conversation_id: 'conv-a', prompt: 'Name the action in allowlist errors', attachments: [] };
    hook(['start', 'cursor'], { ...prompt, hook_event_name: 'beforeSubmitPrompt' });
    hook(['start'], { ...prompt, hook_event_name: 'UserPromptSubmit' });
    fs.appendFileSync(path.join(repo, 'shared/allowlist.ts'), '// cursor\n');
    // Another conversation's stop leaves it running; its own closes it.
    hook(['stop', 'cursor'], { conversation_id: 'conv-b', hook_event_name: 'stop', status: 'completed' });
    expect(await summary(b)).toEqual([['cursor-editor', 'Name the action in allowlist errors', 'running', 'conv-a']]);
    hook(['stop', 'cursor'], { conversation_id: 'conv-a', hook_event_name: 'stop', status: 'completed' });
    await settled();
    const runs = await runsOf(b);
    expect(runs.map(r => [r.status, r.changes.map(c => c.path)])).toEqual([['done', ['shared/allowlist.ts']]]);

    // A second repo with a running bridge in the same workspace: a prompt with nothing attached is not
    // recorded, since it could be either; one with a file attached goes to that file's repo.
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, 'notes.md'), '# Notes\n');
    git(other, 'init', '-q', '-b', 'main');
    git(other, 'add', '-A');
    git(other, '-c', 'user.name=test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'seed');
    b2 = await startBridge(other, undefined, { LOA_QUIET_MS: String(QUIET) }, ['--no-hooks']);
    hook(['start', 'cursor'], { conversation_id: 'conv-c', prompt: 'Which repo is this', attachments: [] });
    hook(['stop', 'cursor'], { conversation_id: 'conv-c', status: 'completed' });
    const attached = [{ type: 'file', filePath: path.join(other, 'notes.md') }];
    hook(['start', 'cursor'], {
      conversation_id: 'conv-d',
      prompt: 'Add a heading to the notes',
      attachments: attached,
    });
    hook(['stop', 'cursor'], { conversation_id: 'conv-d', status: 'completed' });
    expect(await summary(b)).toHaveLength(1);
    expect(await summary(b2)).toEqual([['cursor-editor', 'Add a heading to the notes', 'done', 'conv-d']]);
  } finally {
    b.stop();
    b2?.stop();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

// Who may reach the bridge (docs/THREAT-MODEL.md). Only pages it trusts may call it from a browser, only by its own address,
// and only with the token in the Authorization header; guessing the token locks it until a restart.
test('bridge security: foreign origins and rebinding hosts get 403 and change nothing', async ({ page }) => {
  const repo = makeRepo(),
    b = await startBridge(repo, undefined, {}, ['--no-hooks']);
  const api = (p: string, headers: Record<string, string> = {}, method = 'GET') =>
    new Promise<{ status: number; cors: string | undefined }>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: b.port,
          path: p,
          method,
          headers: { authorization: 'Bearer ' + b.token, 'content-type': 'application/json', ...headers },
        },
        res => {
          res.resume();
          resolve({ status: res.statusCode!, cors: res.headers['access-control-allow-origin'] as string | undefined });
        },
      );
      req.on('error', reject);
      req.end(method === 'POST' ? JSON.stringify({ agent: 'claude', prompt: 'Delete everything', scope: [] }) : '');
    });
  try {
    // Allowed: no Origin (hooks, the CLI), the bridge's own page, and the hosted app it links to (here, APP).
    for (const origin of [undefined, `http://127.0.0.1:${b.port}`, `http://localhost:${b.port}`, APP])
      expect(await api('/api/state', origin ? { origin } : {}), String(origin)).toEqual({
        status: 200,
        cors: origin,
      });
    // Refused before the token is even read, preflights included; nothing runs.
    for (const origin of [
      'https://evil.example',
      'null',
      'http://127.0.0.1:1',
      'https://leagueofagents.dev.evil.example',
      'https://leagueofagents.dev',
      'https://some-project.vercel.app',
    ]) {
      expect(await api('/api/state', { origin }), origin).toEqual({ status: 403, cors: undefined });
      expect((await api('/api/runs', { origin }, 'POST')).status, origin).toBe(403);
      expect((await api('/api/runs', { origin, 'access-control-request-method': 'POST' }, 'OPTIONS')).status).toBe(403);
    }
    // DNS rebinding: a page on another name that resolves to 127.0.0.1 sends its own Host.
    for (const host of [`evil.example:${b.port}`, 'evil.example', `127.0.0.1:${b.port + 1}`])
      expect((await api('/api/state', { host })).status, host).toBe(403);
    expect((await api('/', { host: `evil.example:${b.port}` })).status).toBe(403);
    // Another site's image, link or form sends no Origin, but the browser marks it cross-site.
    expect((await api('/api/state', { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    // The token goes only in the Authorization header, never in a URL.
    expect((await api(`/api/state?t=${b.token}`, { authorization: '' })).status).toBe(401);
    expect(await runsOf(b)).toEqual([]);

    // In a browser: the app on a foreign site can't connect, even with the right link.
    const dist = path.resolve('dist');
    await page.route('https://evil.example/**', route => {
      const p = new URL(route.request().url()).pathname;
      const file = path.join(dist, p === '/' ? 'index.html' : p);
      return route.fulfill({ path: fs.existsSync(file) ? file : path.join(dist, 'index.html') });
    });
    await page.goto(`https://evil.example/#bridge=${b.port}&t=${b.token}`);
    // The browser would ask first, and says which site is asking.
    await expect(page.locator('#stageState')).toContainText('let evil.example reach apps on this device');
    await page.locator('#askContinue').click();
    await expect(page.locator('#stageState')).toContainText("Can't reach your bridge");
    await expect(page.locator('#conn')).toHaveText('Not connected');
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('bridge security: wrong tokens slow down, then lock it until a restart', async ({ page }) => {
  const repo = makeRepo();
  const port = String(43000 + Math.floor(Math.random() * 900));
  const loa = (...args: string[]) =>
    execFileSync(process.execPath, [BRIDGE, ...args], {
      cwd: repo,
      env: { ...process.env, HOME: homeOf(repo), LOA_WEB_URL: APP },
      encoding: 'utf8',
      timeout: 20_000,
    });
  const token = () => (JSON.parse(fs.readFileSync(path.join(repo, '.loa/bridge.json'), 'utf8')) as Bridge).token;
  const state = (t: string | null) =>
    fetch(`http://127.0.0.1:${port}/api/state`, t === null ? {} : { headers: { authorization: 'Bearer ' + t } });
  try {
    loa('start', '--port', port, '--no-open', '--no-hooks');
    const first = token();
    // The token's folder is closed to other accounts on this machine.
    expect(fs.statSync(path.join(repo, '.loa')).mode & 0o077).toBe(0);
    // A missing token is turned away at once and counts for nothing.
    for (let i = 0; i < 20; i++) expect((await state(null)).status).toBe(401);
    // Each wrong token waits longer than the last.
    const t0 = Date.now();
    expect((await state('wrong-1')).status).toBe(401);
    const one = Date.now() - t0;
    expect((await state('wrong-2')).status).toBe(401);
    expect(Date.now() - t0 - one).toBeGreaterThan(one);
    // The right token still works between wrong ones.
    expect((await state(first)).status).toBe(200);
    const rest = await Promise.all(Array.from({ length: 48 }, (_, i) => state(`wrong-${i + 3}`)));
    expect(rest.map(r => r.status)).toEqual(Array(48).fill(401));
    // Locked: even the right token is refused, and the bridge says so in its log, in status and in the app.
    expect((await state(first)).status).toBe(423);
    expect(fs.readFileSync(path.join(repo, '.loa/bridge.log'), 'utf8')).toContain(
      'Locked after too many wrong tokens. Restart it: npx leagueofagents-cli@latest start',
    );
    expect(loa('status')).toContain('League of Agents is locked for sample-repo: too many wrong tokens.');
    await page.goto(`http://127.0.0.1:${port}/#t=${first}`);
    await expect(page.locator('#stageState')).toContainText('The bridge locked itself after too many wrong links.');
    // start replaces it with a fresh bridge and a new token.
    loa('start', '--port', port, '--no-open', '--no-hooks');
    const second = token();
    expect(second).not.toBe(first);
    // (A pooled connection to the old process may be reset once.)
    await expect
      .poll(() =>
        state(second).then(
          r => r.status,
          () => 0,
        ),
      )
      .toBe(200);
  } finally {
    try {
      loa('stop');
    } catch {
      /* already stopped */
    }
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// A bridge older than the app asks to be updated. An old bridge is stood in for by changing the
// version its state reports; 0.0.1 sent none.
test('version check: an old bridge shows the update banner, a current one does not', async ({ page }) => {
  const repo = makeRepo(),
    b = await startBridge(repo, undefined, {}, ['--no-hooks']);
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as { version: string };
  const reporting = async (version: string | null | undefined) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    if (version !== undefined)
      await page.route('**/api/state', async route => {
        const res = await route.fetch();
        const json = (await res.json()) as StateResponse;
        if (version === null) delete json.version;
        else json.version = version;
        await route.fulfill({ response: res, json });
      });
    await page.goto(`http://127.0.0.1:${b.port}/#t=${b.token}`);
    await page.reload();
    await expect(page.locator('#conn')).toHaveText('Live');
  };
  const banner = page.locator('#updateBanner');
  try {
    expect((await runsOf(b)).length).toBe(0);
    const state = (await (
      await fetch(`http://127.0.0.1:${b.port}/api/state`, { headers: { authorization: 'Bearer ' + b.token } })
    ).json()) as StateResponse;
    expect(state.version).toBe(pkg.version);
    await reporting(undefined);
    await expect(page.locator('#tip')).toBeVisible();
    await expect(banner).toHaveCount(0);
    await reporting(null);
    await expect(banner).toContainText(
      "Update your bridge. It's an older version. It still works; 0.1.2 or later has fixes.",
    );
    await reporting('0.1.1');
    await expect(banner).toContainText("It's version 0.1.1. It still works; 0.1.2 or later has fixes.");
    await expect(page.locator('#updateCommand')).toHaveText('npx leagueofagents-cli@latest');
    // It takes the hint's place, and closes for this connection.
    await expect(page.locator('#tip')).toBeHidden();
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({ path: test.info().outputPath(`update-banner-${theme}.png`) });
    }
    await page.locator('#closeUpdate').click();
    await expect(banner).toHaveCount(0);
    await reporting('0.1.2');
    await expect(banner).toHaveCount(0);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// Uninstall leaves the repo, and every agent's settings, as if the bridge had never run.
test('uninstall: stops the bridge and leaves the repo and agent settings as before', async () => {
  const repo = makeRepo(),
    home = homeOf(repo);
  const own = {
    claude: path.join(repo, '.claude/settings.local.json'),
    cursor: path.join(home, '.cursor/hooks.json'),
  };
  fs.mkdirSync(path.dirname(own.claude), { recursive: true });
  fs.writeFileSync(own.claude, '{ "permissions": { "deny": ["Read(./.env)"] } }\n');
  fs.mkdirSync(path.dirname(own.cursor), { recursive: true });
  fs.writeFileSync(own.cursor, '{"version":1,"hooks":{"stop":[{"command":"say done"}]}}\n');
  const exclude = path.join(repo, '.git/info/exclude');
  const before = {
    status: git(repo, 'status', '--porcelain'),
    exclude: fs.readFileSync(exclude, 'utf8'),
    claude: fs.readFileSync(own.claude, 'utf8'),
    cursor: fs.readFileSync(own.cursor, 'utf8'),
  };
  const b = await startBridge(repo, undefined, { LOA_QUIET_MS: String(QUIET) });
  try {
    // A run, so there are snapshot refs; then the file is put back.
    const log = path.join(repo, 'shared/log.ts');
    const text = fs.readFileSync(log, 'utf8');
    fs.appendFileSync(log, '// edited\n');
    await expect.poll(async () => (await runsOf(b)).length, { timeout: 10_000 }).toBe(1);
    fs.writeFileSync(log, text);
    expect(git(repo, 'for-each-ref', 'refs/loa/')).not.toBe('');
    expect(fs.readFileSync(own.cursor, 'utf8')).toContain('.loa/bridge.mjs');
    expect(fs.existsSync(path.join(repo, '.codex/hooks.json'))).toBe(true);

    const out = execFileSync(process.execPath, [BRIDGE, 'uninstall'], {
      cwd: repo,
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
    });
    expect(out).toContain('Removed League of Agents from sample-repo:');
    expect(out).toMatch(/- \d+ snapshot refs \(refs\/loa\/\)/);
    expect(out).toContain('- .loa/');
    expect(out).toContain('/plugin uninstall league-of-agents');
    await expect.poll(() => b.proc.exitCode !== null || b.proc.signalCode !== null).toBe(true);
    expect(git(repo, 'for-each-ref', 'refs/loa/')).toBe('');
    expect(fs.existsSync(path.join(repo, '.loa'))).toBe(false);
    expect(fs.existsSync(path.join(repo, '.codex'))).toBe(false);
    expect({
      status: git(repo, 'status', '--porcelain'),
      exclude: fs.readFileSync(exclude, 'utf8'),
      claude: fs.readFileSync(own.claude, 'utf8'),
      cursor: fs.readFileSync(own.cursor, 'utf8'),
    }).toEqual(before);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// Switching branches mid-session. Runs keep their own snapshots, so each run's before, after and
// revert stay right on any branch; the switch itself is not a run; the map follows the branch.
test('branch switch mid-session: runs, snapshots and reverts stay right, and the map follows', async ({ page }) => {
  const repo = makeRepo();
  git(repo, 'switch', '-qc', 'feature');
  fs.writeFileSync(path.join(repo, 'shared/feature.ts'), 'export const feature = true;\n');
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'feature');
  git(repo, 'switch', '-q', 'main');
  const original = Object.fromEntries(
    ['shared/allowlist.ts', 'shared/log.ts'].map(f => [f, fs.readFileSync(path.join(repo, f), 'utf8')]),
  );
  const b = await startBridge(repo, undefined, { LOA_QUIET_MS: String(QUIET) }, ['--no-hooks']);
  const branch = async () => ((await call(b, '/api/state')).body.repo as { branch: string }).branch;
  const diffOf = (id: number) =>
    git(repo, 'diff', '--name-status', `refs/loa/runs/${id}/before`, `refs/loa/runs/${id}/after`);
  try {
    await page.goto(linkFor(b));
    await expect(page.locator('.crumb .br')).toHaveText('main');
    // Run 1, by the agent, on main.
    expect((await call(b, '/api/runs', { agent: 'claude', prompt: 'Name the action', scope: [] })).status).toBe(200);
    await expect.poll(async () => (await runsOf(b))[0]?.status, { timeout: 15_000 }).toBe('done');
    const run1 = diffOf(1);
    expect(run1).toBe('M\tshared/allowlist.ts\nA\tshared/policy-cache.ts\n');

    // Switch, carrying run 1's uncommitted changes. Not a run; the map shows the branch and its files.
    git(repo, 'switch', '-q', 'feature');
    await expect.poll(branch).toBe('feature');
    await expect(page.locator('.crumb .br')).toHaveText('feature', { timeout: 10_000 });
    await expect(page.locator('[data-path="shared/feature.ts"]').first()).toBeAttached();
    await settled();
    expect((await runsOf(b)).length).toBe(1);

    // Run 2, an edit on the new branch, recorded by watch mode.
    fs.appendFileSync(path.join(repo, 'shared/log.ts'), '// on feature\n');
    await expect.poll(async () => (await runsOf(b)).length, { timeout: 10_000 }).toBe(2);
    expect(diffOf(2)).toBe('M\tshared/log.ts\n');
    expect(diffOf(1)).toBe(run1);

    // Reverting run 1 on the other branch undoes exactly its changes; then run 2.
    expect((await call(b, '/api/runs/1/revert', {})).status).toBe(200);
    expect(fs.readFileSync(path.join(repo, 'shared/allowlist.ts'), 'utf8')).toBe(original['shared/allowlist.ts']);
    expect(fs.existsSync(path.join(repo, 'shared/policy-cache.ts'))).toBe(false);
    expect(fs.readFileSync(path.join(repo, 'shared/log.ts'), 'utf8')).toContain('// on feature');
    expect((await call(b, '/api/runs/2/revert', {})).status).toBe(200);
    expect(fs.readFileSync(path.join(repo, 'shared/log.ts'), 'utf8')).toBe(original['shared/log.ts']);
    // The branch, HEAD and staging are as they were; nothing is left over.
    expect(git(repo, 'branch', '--show-current').trim()).toBe('feature');
    expect(git(repo, 'status', '--porcelain')).toBe('');
    await settled();
    expect((await runsOf(b)).map(r => [r.id, r.reverted])).toEqual([
      [1, true],
      [2, true],
    ]);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// Page views are counted on leagueofagents.dev only, never with the connect token.
test('analytics: only on leagueofagents.dev, and never with the connect token', async ({ page }) => {
  const dist = path.resolve('dist');
  const loaded: string[] = [];
  await page.route('https://leagueofagents.dev/**', route => {
    const p = new URL(route.request().url()).pathname;
    // Vercel's script, stood in for: it notes the address it finds.
    if (p === '/_vercel/insights/script.js')
      return route.fulfill({ contentType: 'text/javascript', body: 'window.__seen = location.href;' });
    const file = path.join(dist, p === '/' ? 'index.html' : p);
    return route.fulfill({ path: fs.existsSync(file) ? file : path.join(dist, 'index.html') });
  });
  page.on('request', r => {
    if (r.url().includes('/_vercel/insights/')) loaded.push(r.url());
  });
  await page.goto('https://leagueofagents.dev/#bridge=1&t=secret-token');
  await expect
    .poll(() => page.evaluate(() => (window as { __seen?: string }).__seen))
    .toBe('https://leagueofagents.dev/');
  expect(loaded).toEqual(['https://leagueofagents.dev/_vercel/insights/script.js']);
  // Every event passes through scrub first.
  const sent = await page.evaluate(() => {
    const before = window.vaq?.find(([k]) => k === 'beforeSend')?.[1] as
      ((e: { type: string; url: string }) => { url: string }) | undefined;
    return before?.({ type: 'pageview', url: 'https://leagueofagents.dev/?t=secret-token#t=secret-token' }).url;
  });
  expect(sent).toBe('https://leagueofagents.dev/');
  // Not on any other host: the app a bridge serves, or a preview.
  loaded.length = 0;
  await page.goto(`${APP}/#bridge=1&t=secret-token`);
  await expect(page.locator('#stageState')).toBeVisible();
  expect(loaded).toEqual([]);
  // The privacy page says so, and the Connect dialog links to it.
  await expect(page.locator('#privacyLink')).toHaveCount(0);
  await page.locator('#showDemo').click();
  await page.locator('#connectBtn').click();
  await expect(page.locator('#privacyLink')).toHaveAttribute('href', 'https://leagueofagents.dev/privacy');
  await page.goto(`${APP}/privacy.html`);
  await expect(page.locator('h1')).toHaveText('Privacy');
  await expect(page.locator('main')).toContainText('never sent');
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.screenshot({ path: test.info().outputPath(`privacy-${theme}.png`), fullPage: true });
  }
});

// The bridge in the background. start returns at once and leaves it running in its own process
// A connected repo with no runs yet says how to start, with an example prompt for the selected file. It goes
// away after the first run.
test('first run: a hint to select, then an example prompt for the selected file, gone after the first run', async ({
  page,
}) => {
  const repo = makeRepo(),
    b = await startBridge(repo, undefined, {}, ['--no-hooks']);
  try {
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await expect(page.locator('#selectHint')).toHaveText(
      'Select a file or lines on the map, or describe a change for the whole repository.',
    );
    await expect(page.locator('#firstRun')).toHaveCount(0);
    await page.keyboard.press('0');
    await page.locator('.fr[data-path="shared/log.ts"]').click();
    const example = page.locator('#firstRunExample');
    await expect(example).toHaveText('Add a short comment at the top of log.ts that says what the file is for.');
    await expect(page.locator('#selectHint')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('first-run.png') });
    await example.click();
    await expect(page.locator('#prompt')).toHaveValue(
      'Add a short comment at the top of log.ts that says what the file is for.',
    );
    await expect(page.locator('#prompt')).toBeFocused();
    await expect(page.locator('#sendBtn')).toBeEnabled();
    await page.locator('#prompt').press('Enter');
    await expect(page.locator('#runbar b')).toHaveText('Run 1');
    await expect(page.locator('#firstRun')).toHaveCount(0);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// A repo without checks: the bridge finds likely ones and offers them; nothing runs until they are turned on,
// and a page can only turn on what the bridge found, never send its own command.
test('hooks removed while the bridge runs are not recorded as a run, and the repo is as it was', async () => {
  const repo = makeRepo();
  // The person's own Codex hooks, committed: ours go in beside them, then come out.
  const own = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }, null, 2);
  fs.mkdirSync(path.join(repo, '.codex'));
  fs.writeFileSync(path.join(repo, '.codex/hooks.json'), own);
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'own hooks');
  const b = await startBridge(repo, undefined, { LOA_QUIET_MS: String(QUIET) });
  try {
    expect(fs.readFileSync(path.join(repo, '.codex/hooks.json'), 'utf8')).not.toBe(own);
    const out = execFileSync(process.execPath, [BRIDGE, 'hooks', 'remove'], {
      cwd: repo,
      env: { ...process.env, HOME: homeOf(repo) },
      encoding: 'utf8',
    });
    expect(out).toContain('Removed the League of Agents hooks.');
    expect(fs.readFileSync(path.join(repo, '.codex/hooks.json'), 'utf8')).toBe(own);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    await settled();
    expect(await runsOf(b)).toEqual([]);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

/** A repo with no checks set up and three the bridge can find. */
function repoWithFoundChecks() {
  const repo = makeRepo();
  fs.rmSync(path.join(repo, 'loa.config.json'));
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'x', scripts: { test: 'node -e "console.log(\'4 passed\')"', typecheck: 'tsc' } }),
  );
  fs.writeFileSync(path.join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  fs.mkdirSync(path.join(repo, 'backend/tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'backend/tests/test_app.py'), 'def test_ok():\n    assert True\n');
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'scripts');
  return repo;
}

test('checks for new users: found, offered, turned on in one click, never run before', async ({ page }) => {
  const repo = repoWithFoundChecks();
  const b = await startBridge(repo, undefined, { LOA_QUIET_MS: String(QUIET) }, ['--no-hooks']);
  try {
    const found = (await call(b, '/api/state')).body.suggestedChecks;
    expect(found).toEqual([
      { name: 'tests', run: 'pnpm test' },
      { name: 'typecheck', run: 'pnpm run typecheck' },
      { name: 'backend pytest', run: 'cd backend && python3 -m pytest -q' },
    ]);
    // Only names the bridge found are accepted; the command is always the bridge's own.
    expect((await call(b, '/api/checks', { names: ['rm -rf /'] })).status).toBe(400);
    expect(fs.existsSync(path.join(repo, 'loa.config.json'))).toBe(false);
    await page.goto(linkFor(b));
    await expect(page.locator('#suggestedChecks li')).toHaveCount(3);
    await page.screenshot({ path: test.info().outputPath('checks-offer.png') });
    expect(await runsOf(b)).toEqual([]);
    await page.locator('#enableChecks').click();
    await expect(page.locator('#suggestedChecks')).toHaveCount(0);
    // Kept in .loa/, out of the repo: nothing to commit, and no run.
    expect(JSON.parse(fs.readFileSync(path.join(repo, '.loa/checks.json'), 'utf8'))).toEqual(found);
    expect(fs.existsSync(path.join(repo, 'loa.config.json'))).toBe(false);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect((await call(b, '/api/state')).body.suggestedChecks).toEqual([]);
    await settled();
    expect(await runsOf(b)).toEqual([]);
    // They run after the next run, which holds only the agent's own changes.
    await page.locator('#prompt').fill('Name the action and origin in allowlist errors');
    await page.locator('#prompt').press('Enter');
    await expect(page.locator('.check')).toHaveCount(3, { timeout: 30_000 });
    const runs = await runsOf(b);
    expect(runs.map(r => r.changes.map(c => c.path).sort())).toEqual([
      ['shared/allowlist.ts', 'shared/policy-cache.ts'],
    ]);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('checks shared with the team: written to loa.config.json, and never recorded as a run', async ({ page }) => {
  const repo = repoWithFoundChecks();
  const b = await startBridge(repo, undefined, { LOA_QUIET_MS: String(QUIET) }, ['--no-hooks']);
  try {
    const found = (await call(b, '/api/state')).body.suggestedChecks;
    await page.goto(linkFor(b));
    await page.locator('#shareChecks').check();
    await page.locator('#enableChecks').click();
    await expect(page.locator('#suggestedChecks')).toHaveCount(0);
    expect(JSON.parse(fs.readFileSync(path.join(repo, 'loa.config.json'), 'utf8'))).toEqual({ checks: found });
    expect(fs.existsSync(path.join(repo, '.loa/checks.json'))).toBe(false);
    expect(git(repo, 'status', '--porcelain')).toBe('?? loa.config.json\n');
    await settled();
    expect(await runsOf(b)).toEqual([]);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// The default browser decides the link start opens: the site, connected, in the Chrome family; the local app
// in any other, or when it can't be told.
test('start opens leagueofagents.dev in a Chrome-family default browser, and the local app otherwise', () => {
  const repo = makeRepo();
  const SITE = 'https://leagueofagents.dev';
  const start = (browser: string) =>
    execFileSync(process.execPath, [BRIDGE, 'start', '--no-open', '--no-hooks'], {
      cwd: repo,
      env: { ...process.env, HOME: homeOf(repo), LOA_WEB_URL: SITE, LOA_BROWSER: browser },
      encoding: 'utf8',
      timeout: 20_000,
    });
  try {
    const first = start('com.google.Chrome');
    const b = JSON.parse(fs.readFileSync(path.join(repo, '.loa/bridge.json'), 'utf8')) as Bridge;
    const site = `${SITE}/#bridge=${b.port}&t=${b.token}`,
      local = `http://127.0.0.1:${b.port}/#t=${b.token}`;
    // Opened, with the local app beside it for any browser.
    expect(first).toContain(`Open    ${site}`);
    expect(first).toContain(`or      ${local}`);
    for (const id of ['com.microsoft.edgemac', 'com.brave.Browser', 'company.thebrowser.Browser'])
      expect(start(id)).toContain(`Open    ${site}`);
    for (const id of ['com.apple.Safari', 'org.mozilla.firefox', '']) {
      const out = start(id);
      expect(out).toContain(`Open    ${local}`);
      expect(out).not.toContain(SITE);
    }
    // Read from the Mac's own settings, shaped as macOS writes them: each handler holds a dict of versions.
    const prefs = path.join(homeOf(repo), 'Library/Preferences/com.apple.LaunchServices');
    fs.mkdirSync(prefs, { recursive: true });
    const handler = (key: string, value: string, app: string) =>
      `<dict><key>LSHandlerPreferredVersions</key><dict><key>LSHandlerRoleAll</key><string>-</string></dict>` +
      `<key>LSHandlerRoleAll</key><string>${app}</string><key>${key}</key><string>${value}</string></dict>`;
    const plist = (app: string) =>
      fs.writeFileSync(
        path.join(prefs, 'com.apple.launchservices.secure.plist'),
        `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>LSHandlers</key><array>` +
          handler('LSHandlerContentType', 'public.html', 'com.apple.safari') +
          handler('LSHandlerURLScheme', 'https', app) +
          `</array></dict></plist>`,
      );
    if (process.platform === 'darwin') {
      plist('com.google.chrome');
      expect(start('')).toContain(`Open    ${site}`);
      plist('com.apple.safari');
      expect(start('')).toContain(`Open    ${local}`);
    }
  } finally {
    execFileSync(process.execPath, [BRIDGE, 'stop'], { cwd: repo, env: { ...process.env, HOME: homeOf(repo) } });
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// Without --port the bridge takes the first free port from 43210, so a second repo's bridge just works.
test('without --port, a busy 43210 moves the bridge to the next free port', async () => {
  const repo = makeRepo();
  const blocker = http.createServer();
  // Hold 43210 for the test (if something already holds it, that does the same job).
  await new Promise<void>(resolve => blocker.once('error', () => resolve()).listen(43210, '127.0.0.1', resolve));
  const loa = (...args: string[]) =>
    execFileSync(process.execPath, [BRIDGE, ...args], {
      cwd: repo,
      env: { ...process.env, HOME: homeOf(repo), LOA_WEB_URL: APP, LOA_PORT: '' },
      encoding: 'utf8',
      timeout: 20_000,
    });
  try {
    const out = loa('start', '--no-open', '--no-hooks');
    const b = JSON.parse(fs.readFileSync(path.join(repo, '.loa/bridge.json'), 'utf8')) as Bridge;
    expect(b.port).toBeGreaterThan(43210);
    expect(out).toContain(`http://127.0.0.1:${b.port}/#t=${b.token}`);
    expect(
      (await fetch(`http://127.0.0.1:${b.port}/api/state`, { headers: { authorization: 'Bearer ' + b.token } })).status,
    ).toBe(200);
  } finally {
    try {
      loa('stop');
    } catch {
      /* already stopped */
    }
    blocker.close();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// One bridge per repo: a second start opens the running one, so the hooks, which find the bridge through
// .loa/bridge.json, always reach the bridge that holds the run.
test('one bridge per repo: a second start or serve finds the running bridge instead of starting another', async () => {
  const repo = makeRepo(),
    b = await startBridge(repo, undefined, {}, ['--no-hooks']);
  const other = String(b.port + 1);
  const loa = (...args: string[]) =>
    execFileSync(process.execPath, [BRIDGE, ...args], {
      cwd: repo,
      env: { ...process.env, HOME: homeOf(repo), LOA_WEB_URL: APP },
      encoding: 'utf8',
      timeout: 20_000,
    });
  const info = () => JSON.parse(fs.readFileSync(path.join(repo, '.loa/bridge.json'), 'utf8')) as Bridge;
  try {
    expect(loa('start', '--port', other, '--no-open', '--no-hooks')).toContain(
      `League of Agents is running for sample-repo.\n  Open    http://127.0.0.1:${b.port}/#t=${b.token}`,
    );
    expect(loa('serve', '--port', other, '--no-hooks')).toContain(
      `League of Agents is already running for sample-repo: http://127.0.0.1:${b.port}/#t=${b.token}`,
    );
    // Nothing listens on the other port, and the running bridge still owns .loa/bridge.json.
    await expect(fetch(`http://127.0.0.1:${other}/`)).rejects.toThrow();
    expect([info().port, info().token]).toEqual([b.port, b.token]);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// A hook run whose Stop never arrives still records what it changed: when the bridge stops, when it comes back
// after a crash, and after a long quiet spell.
test('an interrupted run always records the changes it made', async () => {
  const repo = makeRepo();
  const start = async (b: Bridge, prompt: string) =>
    expect((await call(b, '/api/capture/start', { agent: 'cursor-editor', prompt, sessionId: prompt })).status).toBe(
      200,
    );
  const edit = (f: string) => fs.appendFileSync(path.join(repo, f), `// ${f}\n`);
  const last = async (b: Bridge) => {
    const r = (await runsOf(b)).at(-1)!;
    return [r.title, r.status, r.changes.map(c => c.path)];
  };
  try {
    // A crash mid-run: the next start closes the run with everything between its before and now.
    let b = await startBridge(repo, undefined, {}, ['--no-hooks']);
    await start(b, 'Crash mid-run');
    edit('shared/log.ts');
    edit('apps/console/main.ts');
    process.kill(-b.proc.pid!, 'SIGKILL');
    await new Promise(r => b.proc.once('exit', r));
    b = await startBridge(repo, undefined, {}, ['--no-hooks']);
    expect(await last(b)).toEqual(['Crash mid-run', 'interrupted', ['apps/console/main.ts', 'shared/log.ts']]);
    // Stopped mid-run: the bridge closes it before it exits.
    await start(b, 'Stopped mid-run');
    edit('shared/allowlist.ts');
    b.stop();
    await new Promise(r => b.proc.once('exit', r));
    b = await startBridge(repo, undefined, { LOA_HOOK_IDLE_MS: '1500' }, ['--no-hooks']);
    expect(await last(b)).toEqual(['Stopped mid-run', 'interrupted', ['shared/allowlist.ts']]);
    // No Stop and no more changes: closed after the quiet spell, and watch mode records again.
    await start(b, 'Never stopped');
    edit('shared/log.ts');
    await expect.poll(() => last(b), { timeout: 10_000 }).toEqual(['Never stopped', 'interrupted', ['shared/log.ts']]);
    edit('apps/console/main.ts');
    await expect.poll(async () => (await runsOf(b)).at(-1)!.agent, { timeout: 15_000 }).toBe('detected');
    b.stop();
  } finally {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// group; status and stop find it again; every start makes a fresh token and the old one is rejected.
test('start, status, restart and stop the bridge in the background', async () => {
  const repo = makeRepo();
  const port = String(43000 + Math.floor(Math.random() * 900));
  const loa = (...args: string[]) =>
    execFileSync(process.execPath, [BRIDGE, ...args], {
      cwd: repo,
      env: { ...process.env, HOME: homeOf(repo) },
      encoding: 'utf8',
      timeout: 20_000,
    });
  const info = () =>
    JSON.parse(fs.readFileSync(path.join(repo, '.loa/bridge.json'), 'utf8')) as Bridge & { pid: number };
  const state = (token: string) =>
    fetch(`http://127.0.0.1:${port}/api/state`, { headers: { authorization: 'Bearer ' + token } }).then(r => r.status);
  try {
    const started = loa('start', '--port', port, '--no-open', '--no-hooks');
    const first = info();
    expect(started).toContain(`http://127.0.0.1:${port}/#t=${first.token}`);
    // start has exited; the bridge runs on, as its own process group's leader.
    expect(await state(first.token)).toBe(200);
    expect(execFileSync('ps', ['-o', 'pgid=', '-p', String(first.pid)], { encoding: 'utf8' }).trim()).toBe(
      String(first.pid),
    );
    expect(loa('status')).toContain(`running for sample-repo: http://127.0.0.1:${port}/#t=${first.token}`);
    // A second start finds it running and doesn't start another.
    loa('start', '--port', port, '--no-open');
    expect(info().pid).toBe(first.pid);
    // Restart: a fresh token, and the old one is rejected.
    expect(loa('stop')).toContain('Stopped League of Agents.');
    loa('start', '--port', port, '--no-open', '--no-hooks');
    const second = info();
    expect(second.token).not.toBe(first.token);
    expect(await state(first.token)).toBe(401);
    expect(await state(second.token)).toBe(200);
    expect(loa('stop')).toContain('Stopped League of Agents.');
    expect(loa('status')).toContain('not running');
    await expect(state(second.token)).rejects.toThrow();
  } finally {
    try {
      loa('stop');
    } catch {
      /* already stopped */
    }
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// The app's path is set in one place, so it can move to /app/ when the site gets a homepage.
test('the app path is configurable: served there, and every link points there', async ({ page }) => {
  const repo = makeRepo(),
    b = await startBridge(repo, undefined, {}, ['--no-hooks', '--app-path', 'app']);
  try {
    expect(b.output()).toContain(`http://127.0.0.1:${b.port}/app/#t=${b.token}`);
    expect(b.output()).toContain(`/app/#bridge=${b.port}&t=${b.token}`);
    const root = await fetch(`http://127.0.0.1:${b.port}/`, { redirect: 'manual' });
    expect([root.status, root.headers.get('location')]).toEqual([302, '/app/']);
    await page.goto(`http://127.0.0.1:${b.port}/app/#t=${b.token}`);
    await expect(page.locator('#conn')).toHaveText('Live');
    await expect(page.locator('#repoName')).toHaveText('sample-repo');
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});
