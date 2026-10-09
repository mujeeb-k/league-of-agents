// Live mode end to end: a real bridge in a temp git repo, with tests/fixtures/fake-claude.mjs as Claude Code.
import { execFile, execFileSync, spawnSync } from 'node:child_process';
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
  FAKE_ACP,
  FAKE_CLAUDE,
  FAKE_CODEX,
  REPLAY_AGENT,
  REPO_ROOT,
  SEED,
  SLOW_AGENT,
  allowedChecksFile,
  approveChecks,
  call,
  git,
  homeOf,
  makeRepo,
  publishedBridge,
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

/** The section lock's sandbox is macOS's own (bridge/lib/sandbox.mjs): its tests run on a Mac. */
const SANDBOX = process.platform === 'darwin';
const onMac = SANDBOX ? test : test.skip;

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
    await expect(page.locator('#runAgent')).toHaveText('Claude Code · claude-sonnet-5-5');
    await expect(page.locator('#sideList .run .m span[title]').first()).toHaveAttribute(
      'title',
      'Claude Code · claude-sonnet-5-5',
    );
    await expect(page.locator('#insp .runscope .chip')).toHaveText(['shared/']);
    await expect(page.locator('[data-mode="diff"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.check .ok')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator('.check .nm')).toHaveText('tests');
    await expect(page.locator('.check .sm')).toHaveText('3 passed');
    await expect(page.locator('#sideList .run .tags')).toContainText('Checks passed');
    // Its cost, as Claude Code reported it at the end.
    await expect(page.locator('#sideList [data-run="1"] .cost')).toHaveText('$0.012');
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
    await page.locator('#followChip').click();
    await page.locator('#followMenu [data-follow="new"]').click();
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
    await slow('**/api/state?*', 'GET');
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
    await page.unroute('**/api/state?*');

    await slow('**/api/runs');
    await page.locator('#prompt').fill('Name the action and origin in allowlist errors');
    await page.locator('#prompt').press('Enter');
    await expect(page.locator('#sendBtn .spin')).toBeVisible();
    await expect(page.locator('#sendBtn')).toBeDisabled();
    // The prompt is taken at once: the box is free for the next one while this one is sent.
    await expect(page.locator('#prompt')).toHaveValue('');
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

test('on a narrow screen, a repository keeps its connection badge in the top bar', async ({ page }) => {
  const repo = makeRepo(),
    b = await startBridge(repo, undefined, {}, ['--no-hooks']);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await expect(page.locator('#conn')).toBeVisible();
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
  await page.route('**/api/state?*', async route => {
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
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qam', 'failing check');
  approveChecks(repo);
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
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'checks');
  approveChecks(repo);
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
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'checks');
  approveChecks(repo);
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
    await expect(page.locator('#sideList .run.running')).not.toHaveAttribute('role', 'button');
    await expect(page.locator('#sideList .run.running [data-stop]')).toBeVisible();
    await page.locator('#sideList .run.running').click({ force: true });
    await expect(page.locator('#runbar b')).toHaveText('Run 1');
    await expect(page.locator('#insp .spin').first()).toBeVisible();
    // The agent's latest note is the reply; it is not repeated in the activity list.
    await expect(page.locator('#insp .bubble.md')).toHaveText('Reading the policy module.');
    await expect(page.locator('#insp .acts li')).toHaveCount(0);
    await page.locator('#prompt').fill('Another');
    await page.locator('#prompt').press('Enter');
    await expect(page.locator(TOAST)).toHaveText(
      'A run on the whole repository works alone. Wait for run 1 to finish.',
    );
    // The bridge refuses one too, with a code the app words in the person's language (api/errors.ts).
    expect(await call(b, '/api/runs', { agent: 'claude', prompt: 'Another', scope: [] })).toEqual({
      status: 409,
      body: { error: 'Run 1 is still active', code: 'run-active', args: { id: 1 } },
    });
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

/** Counts the app's fetches of the whole state. */
function stateFetches(page: Page) {
  let n = 0;
  page.on('request', r => {
    if (new URL(r.url()).pathname === '/api/state') n++;
  });
  return () => n;
}

// A run that finishes reaches the canvas from its delta: the run and its files, not the whole state again.
test('run deltas: a finished run reaches the canvas without fetching the whole state', async ({ page }) => {
  const repo = makeRepo(),
    b = await startBridge(repo);
  try {
    const fetches = stateFetches(page);
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    const before = fetches();
    await page.locator('.frame[data-dir="shared"] > .flabel b').click();
    await page.locator('#prompt').fill('Name the action and origin in allowlist errors');
    await page.locator('#prompt').press('Enter');
    await expect(page.locator('#insp .bubble').nth(1)).toHaveText(SUMMARY, { timeout: 15_000 });
    await expect(page.locator('#runbar b')).toHaveText('Run 1');
    await expect(page.locator('[data-mode="diff"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.card.k-mod[data-path="shared/allowlist.ts"]')).toHaveCount(1);
    await expect(page.locator('.card.k-add[data-path="shared/policy-cache.ts"]')).toHaveCount(1);
    // As a list: for a moment the check's result shows while checks are still said to run.
    await expect(page.locator('.check .sm')).toHaveText(['3 passed'], { timeout: 15_000 });
    // The run's start fetches the state once (the bridge's own state event); its end and its checks don't.
    expect(fetches() - before).toBeLessThanOrEqual(1);
    const atEnd = fetches();
    await page.waitForTimeout(1000);
    expect(fetches()).toBe(atEnd);
    // The same events, to an app that doesn't ask for deltas: plain state events, so it fetches as before.
    const plain = (await call(b, '/api/events?since=0')).body.events as { type: string; delta?: unknown }[];
    const asked = (await call(b, '/api/events?since=0&delta=1')).body.events as { type: string; delta?: unknown }[];
    expect(plain.some(e => e.delta)).toBe(false);
    expect(asked.filter(e => e.delta).length).toBeGreaterThan(0);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// The site ships before the bridge does: this app on the published 0.1.2 bridge, which sends no deltas.
test('the app on a 0.1.2 bridge: a finished run reaches the canvas through the whole state', async ({ page }) => {
  const repo = makeRepo(),
    b = await startBridge(repo, FAKE_CLAUDE, {}, [], publishedBridge('0.1.2'));
  try {
    const fetches = stateFetches(page);
    await page.goto(`${APP}/#bridge=${b.port}&t=${b.token}`);
    await expect(page.locator('#conn')).toHaveText('Live');
    const before = fetches();
    await page.locator('.frame[data-dir="shared"] > .flabel b').click();
    await page.locator('#prompt').fill('Name the action and origin in allowlist errors');
    await page.locator('#prompt').press('Enter');
    await expect(page.locator('#insp .bubble').nth(1)).toHaveText(SUMMARY, { timeout: 15_000 });
    await expect(page.locator('#runbar b')).toHaveText('Run 1');
    await expect(page.locator('[data-mode="diff"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.card.k-mod[data-path="shared/allowlist.ts"]')).toHaveCount(1);
    expect(fetches() - before).toBeGreaterThan(1);
    // A 0.1.2 bridge reads no model: the run names its agent alone, and the run list has no model tooltip.
    await expect(page.locator('#runAgent')).toHaveText('Claude Code');
    await expect(page.locator('#sideList .run .m span[title]')).toHaveCount(0);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

/** A repo with enough folders that a fresh layout depends on the window's shape. */
function repoWithFolders() {
  const repo = makeRepo();
  for (let i = 0; i < 40; i++) {
    const p = path.join(repo, `src/area${i % 5}/part${i % 3}/file${i}.ts`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    // A few lines each: git finds a rename by half the content in common (git diff -M).
    fs.writeFileSync(p, [0, 1, 2, 3].map(k => `export const v${i}_${k} = ${i * k};\n`).join(''));
  }
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'folders');
  return repo;
}
/** Every folder's and file's place on the map. */
const placesOf = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>('.frame[data-dir], .card[data-path]')].map(e => [
        e.dataset.dir ?? e.dataset.path,
        `${e.style.left},${e.style.top}`,
      ]),
    ),
  );

test('the layout is kept: another window, another size, every folder and file where it was', async ({ browser }) => {
  const repo = repoWithFolders(),
    b = await startBridge(repo, FAKE_CLAUDE, {}, ['--no-hooks']);
  try {
    const open = async (viewport: { width: number; height: number }) => {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      await page.goto(linkFor(b));
      await expect(page.locator('#conn')).toHaveText('Live');
      return { ctx, places: await placesOf(page) };
    };
    const first = await open({ width: 1440, height: 900 });
    // Saved once it has held for a second, in .loa/, by the bridge.
    await expect.poll(() => fs.existsSync(path.join(repo, '.loa/layout.json')), { timeout: 5000 }).toBe(true);
    await first.ctx.close();
    const second = await open({ width: 900, height: 1100 });
    expect(Object.keys(second.places).length).toBeGreaterThan(20);
    expect(second.places).toEqual(first.places);
    await second.ctx.close();
    // Without the saved layout, that window lays the repo out differently: what the test above guards.
    fs.rmSync(path.join(repo, '.loa/layout.json'));
    const fresh = await open({ width: 900, height: 1100 });
    expect(fresh.places).not.toEqual(first.places);
    await fresh.ctx.close();
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('a renamed file keeps its place, shows as one file renamed, and leaves no ghost', async ({ page }) => {
  const repo = repoWithFolders(),
    b = await startBridge(repo, FAKE_CLAUDE, { LOA_QUIET_MS: String(QUIET) }, ['--no-hooks']);
  try {
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    const before = await placesOf(page);
    // Renamed in an editor, with one line changed on the way.
    fs.renameSync(path.join(repo, 'src/area0/part0/file0.ts'), path.join(repo, 'src/area0/part0/renamed.ts'));
    fs.appendFileSync(path.join(repo, 'src/area0/part0/renamed.ts'), 'export const more = 1;\n');
    await expect.poll(async () => (await runsOf(b)).length, { timeout: 10_000 }).toBe(1);
    await expect(page.locator('#sideList .run')).toHaveCount(1);
    const after = await placesOf(page);
    expect(after['src/area0/part0/renamed.ts']).toBe(before['src/area0/part0/file0.ts']);
    expect(after['src/area0/part0/file0.ts']).toBeUndefined();
    for (const [p, xy] of Object.entries(before)) if (p !== 'src/area0/part0/file0.ts') expect(after[p], p).toBe(xy);
    // The run: one file, renamed, its one added line, and the old name on its card.
    await page.locator('#sideList .run').click();
    await expect(page.locator('.flist li .p')).toHaveText(['renamed.ts']);
    const card = page.locator('.card[data-path="src/area0/part0/renamed.ts"]');
    await expect(card.locator('header .from')).toHaveText('renamed from file0.ts');
    await expect(card.locator('header .stat')).toHaveText('+1');
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('the layout is kept on a 0.1.2 bridge, in the browser', async ({ page }) => {
  const repo = repoWithFolders(),
    b = await startBridge(repo, FAKE_CLAUDE, {}, [], publishedBridge('0.1.2'));
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${APP}/#bridge=${b.port}&t=${b.token}`);
    await expect(page.locator('#conn')).toHaveText('Live');
    const before = await placesOf(page);
    await expect
      .poll(() => page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('loa.layout:'))), {
        timeout: 5000,
      })
      .toBe(true);
    await page.setViewportSize({ width: 900, height: 1100 });
    await page.reload();
    await expect(page.locator('#conn')).toHaveText('Live');
    expect(await placesOf(page)).toEqual(before);
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
  // With its details: each file as it found it, and its activity.
  return (await api(`/api/runs/${run.id}`)) as RunDTO;
}

/** Waits for a run to ask to change files outside its section, answers each, and waits for it to end. */
async function answered(b: Bridge, id: number, allow: boolean) {
  const now = async () => (await call(b, `/api/runs/${id}`)).body as unknown as RunDTO;
  await expect.poll(async () => (await now()).waiting, { timeout: 15_000 }).toBeTruthy();
  for (const w of (await now()).wants ?? [])
    if (!w.answer) expect((await call(b, `/api/runs/${id}/wants`, { path: w.path, allow })).status).toBe(200);
  await expect.poll(async () => (await now()).status, { timeout: 15_000 }).toBe('done');
  return now();
}

test("a start's first snapshot: from git's own index the first time, the same tree as from scratch; kept after, unless an ignore rule changed", async () => {
  const repo = makeRepo();
  const put = (p: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, p)), { recursive: true });
    fs.writeFileSync(path.join(repo, p), text);
  };
  // Staged and unstaged edits, a new file, an ignored one, an untracked secret and a tracked template.
  put('.gitignore', 'dist/\n');
  put('.env.example', 'KEY=\n');
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@e.t', 'commit', '-qm', 'seed');
  put('shared/log.ts', 'staged\n');
  git(repo, 'add', 'shared/log.ts');
  put('shared/log.ts', 'staged, then changed\n');
  put('apps/new.ts', 'new\n');
  put('dist/out.js', 'built\n');
  put('.env', 'SECRET=1\n');
  put('out/x.log', 'log\n');
  // The tree as git would snapshot it from scratch: HEAD, then everything but ignored files and untracked secrets.
  const scratch = path.join(path.dirname(repo), 'scratch.index');
  const env = { ...process.env, GIT_INDEX_FILE: scratch };
  execFileSync('git', ['read-tree', 'HEAD'], { cwd: repo, env });
  execFileSync('git', ['add', '-A'], { cwd: repo, env });
  execFileSync('git', ['rm', '--cached', '-q', '.env'], { cwd: repo, env });
  const expected = execFileSync('git', ['write-tree'], { cwd: repo, env, encoding: 'utf8' }).trim();
  const beforeOf = async (b: Bridge) => {
    const r = await runToEnd(b, { agent: 'claude', prompt: 'Probe', scope: [], resumeFrom: null });
    return git(repo, 'rev-parse', `refs/loa/runs/${r.id}/before^{tree}`).trim();
  };
  let b = await startBridge(repo, FAKE_CLAUDE);
  try {
    expect(await beforeOf(b)).toBe(expected);
  } finally {
    b.stop();
  }
  // A rule now ignores a file the kept index holds: the next start begins again, and leaves it out.
  put('.gitignore', 'dist/\nout/\n');
  git(repo, 'add', '.gitignore');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@e.t', 'commit', '-qm', 'ignore out');
  b = await startBridge(repo, FAKE_CLAUDE);
  try {
    const tree = await beforeOf(b);
    expect(git(repo, 'ls-tree', '-r', '--name-only', tree)).not.toContain('out/x.log');
    expect(git(repo, 'ls-tree', '-r', '--name-only', tree)).toContain('apps/new.ts');
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test("a folder as the map: the state holds its files; the repo's folders are listed with their counts; any code file opens", async () => {
  const repo = makeRepo();
  for (let i = 0; i < 3; i++) {
    fs.mkdirSync(path.join(repo, 'apps/web'), { recursive: true });
    fs.writeFileSync(path.join(repo, `apps/web/page${i}.ts`), `export const page${i} = ${i};\n`);
  }
  const b = await startBridge(repo);
  try {
    const whole = (await call(b, '/api/state')).body as unknown as StateResponse;
    expect(whole.root).toBe('');
    expect(whole.codeFiles).toBe(whole.tree.length);
    // The app may ask for fewer files a map than the bridge's most: then the map holds that many.
    expect(((await call(b, '/api/state?root=&max=2')).body as unknown as StateResponse).tree).toHaveLength(2);
    const apps = (await call(b, '/api/state?root=apps/')).body as unknown as StateResponse;
    expect(apps.root).toBe('apps/');
    expect(apps.tree.map(f => f.path)).toEqual([
      'apps/console/main.ts',
      'apps/web/page0.ts',
      'apps/web/page1.ts',
      'apps/web/page2.ts',
    ]);
    expect(apps.codeFiles).toBe(whole.codeFiles);
    // Folders to pick a map from: every folder holding code files, with how many are in it and under it.
    const { folders } = (await call(b, '/api/folders')).body as unknown as {
      folders: { path: string; files: number }[];
    };
    expect(folders).toEqual(
      expect.arrayContaining([
        { path: '', files: whole.codeFiles },
        { path: 'apps/', files: 4 },
        { path: 'apps/web/', files: 3 },
        { path: 'shared/', files: 2 },
      ]),
    );
    // The folder last mapped is the map the next time, until another is asked for; '' is the whole repository.
    expect(((await call(b, '/api/state')).body as unknown as StateResponse).root).toBe('apps/');
    expect(((await call(b, '/api/state?root=')).body as unknown as StateResponse).root).toBe('');
    expect(((await call(b, '/api/state')).body as unknown as StateResponse).root).toBe('');
    // A file outside the map still opens: the map is a view, not a limit.
    const shared = await call(b, '/api/file?path=shared/log.ts');
    expect(shared.status).toBe(200);
    expect((await call(b, '/api/state?root=../')).status).toBe(400);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test("a map of over 1,500 files: names and lengths in the state, each file's first lines asked for when shown", async () => {
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo, 'big'), { recursive: true });
  for (let i = 0; i < 1600; i++)
    fs.writeFileSync(path.join(repo, `big/f${String(i).padStart(4, '0')}.ts`), `export const v = ${i};\nexport {};\n`);
  const b = await startBridge(repo);
  try {
    const s = (await call(b, '/api/state?root=big/')).body as unknown as StateResponse;
    expect(s.tree).toHaveLength(1600);
    expect(s.tree[0]).toEqual({ path: 'big/f0000.ts', total: 2, lines: [] });
    const heads = (await call(b, '/api/heads', { paths: ['big/f0007.ts', 'shared/log.ts', '../x', 'nope.ts'] }))
      .body as unknown as { files: { path: string; total: number; lines: string[] }[] };
    expect(heads.files).toEqual([
      { path: 'big/f0007.ts', total: 2, lines: ['export const v = 7;', 'export {};'] },
      { path: 'shared/log.ts', total: 1, lines: [SEED['shared/log.ts']!.trimEnd()] },
    ]);
    // Under the line, the state carries the lines as before.
    expect(
      ((await call(b, '/api/state?root=shared/')).body as unknown as StateResponse).tree[0]!.lines.length,
    ).toBeGreaterThan(0);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test("a run's details on demand: the state's runs leave out each file as the run found it and the activity; renames come from git", async () => {
  const repo = makeRepo();
  const b = await startBridge(repo, FAKE_CLAUDE, { LOA_HERMES_BIN: FAKE_ACP });
  try {
    const run = await runToEnd(b, { agent: 'claude', prompt: 'Name it', scope: [], resumeFrom: null });
    const inState = ((await call(b, '/api/state')).body as unknown as StateResponse).runs.find(r => r.id === run.id)!;
    const listed = inState.changes.find(c => c.path === 'shared/allowlist.ts')!;
    expect(listed.pre).toBeUndefined();
    expect(inState.stream).toBeUndefined();
    expect(listed.hunks.length).toBeGreaterThan(0);
    const full = (await call(b, `/api/runs/${run.id}`)).body as unknown as RunDTO;
    expect(full.changes.find(c => c.path === 'shared/allowlist.ts')!.pre).toEqual(
      SEED['shared/allowlist.ts']!.split('\n').slice(0, -1),
    );
    expect(full.stream!.length).toBeGreaterThan(0);
    expect((await call(b, '/api/runs/99')).status).toBe(404);
    await expect
      .poll(async () => ((await call(b, '/api/state')).body as unknown as StateResponse).agents.hermes?.available)
      .toBe(true);
    const moved = await runToEnd(b, {
      agent: 'hermes',
      prompt: 'exec: mv shared/log.ts shared/logger.ts',
      scope: ['shared/'],
      resumeFrom: null,
    });
    expect(moved.changes.map(c => [c.path, c.created, c.deleted, c.renamedFrom ?? null])).toEqual([
      ['shared/log.ts', false, true, null],
      ['shared/logger.ts', true, false, 'shared/log.ts'],
    ]);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('a repository larger than a map: the app asks for a folder, maps it, remembers it, and can map the whole again', async ({
  page,
}) => {
  const repo = makeRepo();
  for (let i = 0; i < 6; i++) {
    fs.mkdirSync(path.join(repo, 'apps/web'), { recursive: true });
    fs.writeFileSync(path.join(repo, `apps/web/page${i}.ts`), `export const page${i} = ${i};\n`);
  }
  // A map shows up to 5 files here, so the repository's 10 don't fit.
  const b = await startBridge(repo, FAKE_CLAUDE, { LOA_MAX_FILES: '5' });
  try {
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    const picker = page.locator('#mapPicker');
    await expect(picker).toContainText('sample-repo has 10 code files. A map shows up to 5: pick a folder.');
    await expect(picker.locator('[data-folder="apps/"]')).toContainText('7 files');
    await picker.locator('input').fill('web');
    await expect(picker.locator('[data-folder]')).toHaveCount(1);
    await picker.locator('[data-folder="apps/web/"]').click();
    await expect(picker).toHaveCount(0);
    await expect(page.locator('#mapRoot')).toHaveText('apps/web/');
    await expect(page.locator('#nodes .fr[data-path="shared/log.ts"]')).toHaveCount(0);
    await expect(page.locator('#nodes .fr[data-path="apps/web/page0.ts"]')).toHaveCount(1);
    // Remembered: a reload maps the same folder, without asking.
    await page.reload();
    await expect(page.locator('#conn')).toHaveText('Live');
    await expect(page.locator('#mapRoot')).toHaveText('apps/web/');
    await expect(picker).toHaveCount(0);
    // The whole repository again, by choice: its first 5 files, and no asking.
    await page.locator('#mapRoot').click();
    await picker.locator('[data-folder=""]').click();
    await expect(page.locator('#mapRoot')).toHaveCount(0);
    await expect(page.locator('#nodes .fr')).toHaveCount(5);
    await expect(picker).toHaveCount(0);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test("a map of over 1,500 files: a card shows its lines once it's in view", async ({ page }) => {
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo, 'big'), { recursive: true });
  for (let i = 0; i < 1600; i++)
    fs.writeFileSync(path.join(repo, `big/f${String(i).padStart(4, '0')}.ts`), `export const v${i} = ${i};\n`);
  const b = await startBridge(repo);
  try {
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live', { timeout: 30_000 });
    await page.keyboard.press('ControlOrMeta+p');
    await page.keyboard.type('f0007');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(page.locator('#nodes .card[data-path="big/f0007.ts"] .ln')).toContainText(['export const v7 = 7;']);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('bridge keeps deny rules, records raw agent output, and keeps secret files out of snapshots', async () => {
  const repo = makeRepo();
  // Untracked files whose names usually hold secrets, at the top and deeper down.
  const secrets = ['.env', 'shared/.env.local', 'credentials.json', 'id_rsa', 'deploy/server.pem', 'infra/prod.tfvars'];
  for (const f of secrets) {
    fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
    fs.writeFileSync(path.join(repo, f), 'SECRET=do-not-store\n');
  }
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
    expect(Object.keys(settings.hooks).sort()).toEqual([
      'PostToolUse',
      'PreToolUse',
      'SessionEnd',
      'Stop',
      'UserPromptSubmit',
    ]);
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
      for (const f of secrets) expect(files.split('\n')).not.toContain(f);
      expect(files).toContain('shared/allowlist.ts');
    }
    expect(fs.readFileSync(path.join(repo, '.env'), 'utf8')).toBe('SECRET=do-not-store\n');
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// Attribution: which added lines Claude Code wrote through its edit tools. Lines it wrote another way (here, the
// stand-in appends a function and creates a file without an edit tool, as a shell command would) aren't its.
test('bridge records the lines Claude Code wrote with its edit tools, and only those', async () => {
  const repo = makeRepo();
  const b = await startBridge(repo, FAKE_CLAUDE, {}, ['--no-hooks']);
  try {
    const run = await runToEnd(b, {
      agent: 'claude',
      prompt: 'Name the action and origin',
      scope: [],
      resumeFrom: null,
    });
    const after = fs.readFileSync(path.join(repo, 'shared/allowlist.ts'), 'utf8').split('\n');
    const line = after.findIndex(l => l.includes('ALLOWLIST_VIOLATION: ${action}'));
    expect(line).toBeGreaterThan(0);
    expect(run.agentLines).toEqual({ 'shared/allowlist.ts': [[line, line]] });
    // Not the appended isEmpty, not the new file: added in the run, but by no edit tool.
    expect(run.changes.map(c => c.path).sort()).toEqual(['shared/allowlist.ts', 'shared/policy-cache.ts']);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// Colored by author: the line Claude Code wrote with its Edit tool is the agent's; the lines it added another way
// are unknown, never human. A click on a line shows its run and prompt.
test('colored by author: agent lines marked, the rest unknown, and a line shows its run and prompt', async ({
  page,
}) => {
  const repo = makeRepo(),
    b = await startBridge(repo, FAKE_CLAUDE, {}, ['--no-hooks']);
  try {
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await page.locator('.frame[data-dir="shared"] > .flabel b').click();
    await page.locator('#prompt').fill('Name the action and origin in allowlist errors');
    await page.locator('#prompt').press('Enter');
    await expect(page.locator('#insp .bubble').nth(1)).toHaveText(SUMMARY, { timeout: 15_000 });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('c');
    await expect(page.locator('#byAuthor')).toHaveAttribute('aria-pressed', 'true');
    const card = page.locator('.card[data-path="shared/allowlist.ts"]');
    await card.scrollIntoViewIfNeeded();
    const agent = card.locator('.ln.au-agent');
    await expect(agent).toHaveCount(1);
    await expect(agent).toContainText('ALLOWLIST_VIOLATION: ${action} on ${origin}');
    // The appended isEmpty: in the run, but by no edit tool. No line is called human.
    await expect(card.locator('.ln', { hasText: 'isEmpty' })).toHaveClass(/au-unknown/);
    await expect(page.locator('.ln.au-human')).toHaveCount(0);
    await agent.click();
    await expect(page.locator('#authorLine')).toContainText('Agent');
    await expect(page.locator('#authorLine')).toContainText('Claude Code wrote it with its edit tools.');
    await expect(page.locator('#authorLine')).toContainText('Claude Code · claude-sonnet-5-5 · Run 1');
    await expect(page.locator('#authorLine')).toContainText('Name the action and origin in allowlist errors');
    await page.screenshot({ path: test.info().outputPath('by-author.png') });
    // Zoomed out, the tile's bar shows the agent's share.
    await page.keyboard.press('0');
    await expect(page.locator('.fr[data-path="shared/allowlist.ts"] .au i.au-agent')).toHaveCount(1);
    await page.locator('#openAuthorRun').click();
    await expect(page.locator('#runbar b')).toHaveText('Run 1');
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// What git records, read only, for lines no kept run wrote: a Git AI note (Git AI Standard v3.0.0, written here
// by hand to its spec) gives lines to an agent session or a person; a Co-authored-by trailer naming an agent covers
// a whole commit, so its lines are only mixed.
test('colored by author: Git AI notes and co-author trailers label lines no run wrote', async ({ page }) => {
  const repo = makeRepo();
  const commit = (msg: string) =>
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', msg);
  fs.writeFileSync(
    path.join(repo, 'shared/noted.ts'),
    'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n',
  );
  git(repo, 'add', '-A');
  commit('noted');
  const note = [
    'shared/noted.ts',
    '  s_0123456789abcd::t_0123456789abcd 1-2',
    '  h_0123456789abcd 3',
    '---',
    JSON.stringify({
      schema_version: 'authorship/3.0.0',
      base_commit_sha: git(repo, 'rev-parse', 'HEAD').trim(),
      prompts: {},
      sessions: { s_0123456789abcd: { agent_id: { tool: 'cursor', id: 'conv-1', model: 'gpt-5' } } },
      humans: { h_0123456789abcd: { author: 'Ana <ana@example.test>' } },
    }),
  ].join('\n');
  git(repo, 'notes', '--ref=ai', 'add', '-m', note, 'HEAD');
  fs.writeFileSync(path.join(repo, 'shared/paired.ts'), 'export const d = 4;\n');
  git(repo, 'add', '-A');
  commit('paired\n\nCo-authored-by: Claude <noreply@anthropic.com>');
  const b = await startBridge(repo, FAKE_CLAUDE, {}, ['--no-hooks']);
  try {
    const lines = (await call(b, '/api/authors?path=shared/noted.ts')).body.lines as {
      author: string;
      source?: string;
    }[];
    expect(lines.map(l => `${l.author}/${l.source}`)).toEqual(['agent/git-ai', 'agent/git-ai', 'human/git-ai']);
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await page.keyboard.press('c');
    const open = async (q: string) => {
      await page.keyboard.press('ControlOrMeta+p');
      await page.keyboard.type(q);
      await page.keyboard.press('Enter');
    };
    await open('noted.ts');
    const noted = page.locator('.card[data-path="shared/noted.ts"]');
    await expect(noted.locator('.ln.au-agent')).toHaveCount(2);
    await expect(noted.locator('.ln.au-human')).toHaveCount(1);
    await noted.locator('.ln.au-human').click();
    await expect(page.locator('#authorLine')).toContainText('says Ana <ana@example.test> wrote it.');
    await noted.locator('.ln.au-agent').first().click();
    await expect(page.locator('#authorLine')).toContainText('says an agent wrote it: cursor · gpt-5.');
    await open('paired.ts');
    const paired = page.locator('.card[data-path="shared/paired.ts"]');
    await expect(paired.locator('.ln.au-mixed')).toHaveCount(1);
    await paired.locator('.ln.au-mixed').click();
    await expect(page.locator('#authorLine')).toContainText(
      'names an agent as co-author (Claude <noreply@anthropic.com>)',
    );
    // Read only: no note or ref was written.
    expect(git(repo, 'for-each-ref', 'refs/notes/').trim().split('\n')).toHaveLength(1);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// Exported only on a click, after a dialog that says where it goes: an Agent Trace record (spec 0.1.0) in
// refs/notes/agent-trace, and a Git AI log (Git AI Standard v3.0.0) in refs/notes/ai, never over one already there.
test('attribution exports to git notes on the last commit, only when asked', async ({ page }) => {
  const repo = makeRepo(),
    b = await startBridge(repo, FAKE_CLAUDE, {}, ['--no-hooks']);
  try {
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await page.locator('#prompt').fill('Name the action and origin in allowlist errors');
    await page.locator('#prompt').press('Enter');
    await expect(page.locator('#insp .bubble').nth(1)).toHaveText(SUMMARY, { timeout: 15_000 });
    git(repo, 'add', '-A');
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'the run');
    const head = git(repo, 'rev-parse', 'HEAD').trim();
    const line =
      fs
        .readFileSync(path.join(repo, 'shared/allowlist.ts'), 'utf8')
        .split('\n')
        .findIndex(l => l.includes('${action}')) + 1;
    expect(git(repo, 'for-each-ref', 'refs/notes/')).toBe('');
    const exportAs = async (name: string) => {
      await page.keyboard.press('ControlOrMeta+k');
      await page.keyboard.type(name);
      await page.keyboard.press('Enter');
      await expect(page.locator('#exportDlg')).toContainText('Write attribution to a git note?');
      await page.locator('#exportWrite').click();
    };
    await exportAs('as Agent Trace');
    await expect(page.locator(TOAST)).toContainText(`to refs/notes/agent-trace on ${head.slice(0, 8)}`);
    const trace = JSON.parse(git(repo, 'notes', '--ref=agent-trace', 'show', 'HEAD')) as {
      version: string;
      vcs: { type: string; revision: string };
      files: {
        path: string;
        conversations: {
          contributor: { type: string; model_id?: string };
          ranges: { start_line: number; end_line: number }[];
        }[];
      }[];
    };
    expect(trace.version).toBe('0.1.0');
    expect(trace.vcs).toEqual({ type: 'git', revision: head });
    const ai = trace.files
      .find(f => f.path === 'shared/allowlist.ts')!
      .conversations.find(c => c.contributor.type === 'ai')!;
    expect(ai.contributor.model_id).toBe('anthropic/claude-sonnet-5-5');
    expect(ai.ranges).toEqual([{ start_line: line, end_line: line }]);
    expect(git(repo, 'notes', '--ref=agent-trace', 'show', 'HEAD')).not.toContain('Name the action');
    await exportAs('as a Git AI note');
    await expect(page.locator(TOAST)).toContainText(`to refs/notes/ai on ${head.slice(0, 8)}`);
    const [attest, meta] = git(repo, 'notes', '--ref=ai', 'show', 'HEAD').split('\n---\n');
    expect(attest!.split('\n')[0]).toBe('shared/allowlist.ts');
    expect(attest!.split('\n')[1]).toMatch(new RegExp(`^  s_[0-9a-f]{14}::t_[0-9a-f]{14} ${line}$`));
    const m = JSON.parse(meta!) as {
      schema_version: string;
      base_commit_sha: string;
      sessions: Record<string, { agent_id: unknown }>;
    };
    expect(m.schema_version).toBe('authorship/3.0.0');
    expect(m.base_commit_sha).toBe(head);
    expect(Object.values(m.sessions)[0]!.agent_id).toEqual({
      tool: 'claude',
      id: 'sess-123',
      model: 'claude-sonnet-5-5',
    });
    // Never over a Git AI log already there.
    await exportAs('as a Git AI note');
    await expect(page.locator(TOAST)).toContainText('already has a Git AI note');
    expect(git(repo, 'log', '--oneline', '-1', 'HEAD').trim()).toContain('the run');
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
    // Codex's output names no model.
    expect(first.model).toBeNull();
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

test('an ACP harness (Hermes): asks before editing, reports its model, is refused outside the scope, resumes, cancels', async () => {
  const repo = makeRepo(),
    FILE = 'shared/allowlist.ts';
  const b = await startBridge(repo, FAKE_CLAUDE, { LOA_HERMES_BIN: FAKE_ACP });
  const api = (p: string, body?: object) => call(b, p, body);
  try {
    // Found once `hermes acp --check` passes; the state names it and says nothing of its command.
    await expect
      .poll(async () => ((await api('/api/state')).body as unknown as StateResponse).agents.hermes)
      .toEqual({ name: 'Hermes', available: true, stays: SANDBOX });
    const first = await runToEnd(b, {
      agent: 'hermes',
      prompt: 'Record who reviewed it',
      scope: ['shared/'],
      resumeFrom: null,
    });
    expect(first.model).toBe('fake-model-1');
    expect(first.sessionId).toMatch(/^fake-session-/);
    expect(first.summary).toBe(`Added reviewedBy to ${FILE}.`);
    expect(first.changes.map(c => c.path)).toEqual([FILE]);
    expect(first.stream!.map(e => e.text)).toEqual(
      expect.arrayContaining(['Reading the policy module.', `read: ${FILE}`, `patch: ${FILE}`]),
    );
    // The line it showed as a diff before writing it counts as the agent's (attribution).
    const at = SEED[FILE]!.split('\n').length - 1;
    expect(first.agentLines).toEqual({ [FILE]: [[at, at]] });
    const log = () => fs.readFileSync(path.join(repo, '../fake-acp.log'), 'utf8');
    expect(log()).toContain('Scope for this task:\\n- shared/');
    // A follow-up resumes the same session. Asked to edit outside the scope, it is refused, and the person asked.
    const asked = (
      await api('/api/runs', {
        agent: 'hermes',
        prompt: 'Note it outside too',
        scope: ['shared/'],
        resumeFrom: first.id,
      })
    ).body as unknown as RunDTO;
    const second = await answered(b, asked.id, false);
    expect(second.sessionId).toBe(first.sessionId);
    expect(log()).toContain(`resume ${first.sessionId}`);
    // What the harness replays on resuming is the earlier run's, not this one's.
    expect(second.stream!.map(e => e.text)).not.toContain('replayed: an earlier call');
    expect(second.stream!.map(e => e.text)).not.toContain('Replayed from before.');
    expect(fs.existsSync(path.join(repo, 'outside.txt'))).toBe(false);
    expect(second.stream!.map(e => `${e.t} ${e.text}`)).toContain('deny Tried to change outside.txt. Blocked.');
    // Cancel asks the harness to stop its turn.
    const slow = (await api('/api/runs', { agent: 'hermes', prompt: 'Take it slow', scope: [], resumeFrom: null }))
      .body;
    await expect
      .poll(async () => ((await api(`/api/runs/${slow.id}`)).body as unknown as RunDTO).stream?.length)
      .toBeGreaterThan(1);
    await api(`/api/runs/${slow.id}/cancel`, {});
    await expect
      .poll(
        async () =>
          ((await api('/api/state')).body as unknown as StateResponse).runs.find(r => r.id === slow.id)?.status,
      )
      .toBe('cancelled');
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test("without a sandbox, DeepSeek Harness runs in its read-only mode, so each edit asks: in the scope allowed and the agent's lines, outside refused", async () => {
  const repo = makeRepo(),
    FILE = 'shared/allowlist.ts';
  const b = await startBridge(repo, FAKE_CLAUDE, { LOA_DSH_BIN: FAKE_ACP, FAKE_ACP_STYLE: 'dsh', LOA_SANDBOX: 'off' });
  try {
    const started = (
      await call(b, '/api/runs', {
        agent: 'dsh',
        prompt: 'Record it outside too, and run a command',
        scope: ['shared/'],
        resumeFrom: null,
      })
    ).body as unknown as RunDTO;
    const run = await answered(b, started.id, false);
    expect(fs.readFileSync(path.join(repo, '../fake-acp.log'), 'utf8')).toMatch(/^new \S+ mode=read-only$/m);
    expect(run.changes.map(c => c.path)).toEqual([FILE]);
    const at = SEED[FILE]!.split('\n').length - 1;
    expect(run.agentLines).toEqual({ [FILE]: [[at, at]] });
    expect(fs.existsSync(path.join(repo, 'outside.txt'))).toBe(false);
    const entries = run.stream!.map(e => `${e.t} ${e.text}`);
    expect(entries).toContain('deny Tried to change outside.txt. Blocked.');
    // A command it asks to run is refused, by what it would run.
    expect(entries).toContain('deny Refused: bash rm -rf build');
    // Its sandbox holds each write until it asks: said as that, not as a failure.
    expect(entries).toContain(`warn Needs permission: edit ${FILE}`);
    expect(entries.filter(e => e.startsWith('err'))).toEqual([]);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

onMac(
  'in the sandbox, DeepSeek Harness runs in its full-access mode: held to the section by the system, its edits its own',
  async () => {
    const repo = makeRepo(),
      FILE = 'shared/allowlist.ts';
    const b = await startBridge(repo, FAKE_CLAUDE, { LOA_DSH_BIN: FAKE_ACP, FAKE_ACP_STYLE: 'dsh' });
    try {
      const started = (
        await call(b, '/api/runs', {
          agent: 'dsh',
          prompt: 'Record it outside too',
          scope: ['shared/'],
          resumeFrom: null,
        })
      ).body as unknown as RunDTO;
      const run = await answered(b, started.id, false);
      expect(fs.readFileSync(path.join(repo, '../fake-acp.log'), 'utf8')).toMatch(/^new \S+ mode=danger-full-access$/m);
      expect(run.changes.map(c => c.path)).toEqual([FILE]);
      const at = SEED[FILE]!.split('\n').length - 1;
      expect(run.agentLines).toEqual({ [FILE]: [[at, at]] });
      expect(fs.existsSync(path.join(repo, 'outside.txt'))).toBe(false);
      // Refused by the system, and asked of the person; not a failure.
      const entries = run.stream!.map(e => `${e.t} ${e.text}`);
      expect(entries).toContain('deny Tried to change outside.txt. Blocked.');
      expect(entries.filter(e => e.startsWith('err'))).toEqual([]);
    } finally {
      b.stop();
      fs.rmSync(path.dirname(repo), { recursive: true, force: true });
    }
  },
);

test.describe('commit a session', () => {
  async function committing(fn: (repo: string, b: Bridge) => Promise<void>) {
    const repo = makeRepo();
    const b = await startBridge(repo, FAKE_CLAUDE, { LOA_HERMES_BIN: FAKE_ACP });
    try {
      await expect
        .poll(async () => ((await call(b, '/api/state')).body as unknown as StateResponse).agents.hermes?.available)
        .toBe(true);
      await fn(repo, b);
    } finally {
      b.stop();
      fs.rmSync(path.dirname(repo), { recursive: true, force: true });
    }
  }
  const session = (b: Bridge, prompt: string) =>
    runToEnd(b, { agent: 'hermes', prompt, scope: ['shared/'], resumeFrom: null });
  const commit = (b: Bridge, id: number, body: object) => call(b, `/api/runs/${id}/commit`, body);
  const head = (repo: string) => git(repo, 'rev-parse', 'HEAD').trim();

  test("commits only the session's files, with its message; what you staged stays exactly as it was", () =>
    committing(async (repo, b) => {
      // Staged by the person, and one file changed but not staged: neither is the session's.
      fs.appendFileSync(path.join(repo, 'apps/console/main.ts'), '// staged by me\n');
      git(repo, 'add', 'apps/console/main.ts');
      fs.writeFileSync(path.join(repo, 'notes.md'), 'mine\n');
      const staged = git(repo, 'diff', '--cached');
      const index = git(repo, 'ls-files', '-s');
      const was = head(repo);
      const run = await session(b, 'edit:shared/log.ts');
      const preview = await call(b, `/api/runs/${run.id}/commit`);
      expect(preview.body).toMatchObject({ files: ['shared/log.ts'], yours: [], changed: [], branch: 'main' });
      const r = await commit(b, run.id, { message: 'Log the session\n\nEdited by Hermes.' });
      expect(r.status).toBe(200);
      expect(git(repo, 'rev-parse', 'HEAD~1').trim()).toBe(was);
      expect(git(repo, 'log', '-1', '--format=%B').trim()).toBe('Log the session\n\nEdited by Hermes.');
      expect(git(repo, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe('shared/log.ts');
      expect(git(repo, 'symbolic-ref', 'HEAD').trim()).toBe('refs/heads/main');
      // The staging area: the same, apart from the committed file, now clean.
      expect(git(repo, 'diff', '--cached')).toBe(staged);
      const entries = (t: string) => t.split('\n').filter(l => !l.endsWith('\tshared/log.ts'));
      expect(entries(git(repo, 'ls-files', '-s'))).toEqual(entries(index));
      expect(git(repo, 'status', '--porcelain')).toBe('M  apps/console/main.ts\n?? notes.md\n');
      expect(
        ((await call(b, '/api/state')).body as unknown as StateResponse).runs.find(x => x.id === run.id),
      ).toMatchObject({
        committed: { sha: head(repo) },
      });
    }));

  test('a file you had changed before the session is listed and left out unless you tick it', () =>
    committing(async (repo, b) => {
      fs.appendFileSync(path.join(repo, 'shared/allowlist.ts'), '// mine, before the session\n');
      const run = await session(b, 'edit:shared/allowlist.ts edit:shared/log.ts');
      const preview = await call(b, `/api/runs/${run.id}/commit`);
      expect(preview.body).toMatchObject({ files: ['shared/log.ts'], yours: ['shared/allowlist.ts'] });
      expect((await commit(b, run.id, { message: 'Only the session' })).status).toBe(200);
      expect(git(repo, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe('shared/log.ts');
      expect(git(repo, 'status', '--porcelain')).toBe(' M shared/allowlist.ts\n');
      // Ticked: committed too, with the person's own lines in it.
      const second = await session(b, 'edit:shared/allowlist.ts');
      expect((await commit(b, second.id, { message: 'With mine', include: ['shared/allowlist.ts'] })).status).toBe(200);
      expect(git(repo, 'show', 'HEAD:shared/allowlist.ts')).toContain('// mine, before the session');
      expect(git(repo, 'status', '--porcelain')).toBe('');
    }));

  test('refused when a file changed since the session, on a detached HEAD, or twice', () =>
    committing(async (repo, b) => {
      const run = await session(b, 'edit:shared/log.ts');
      fs.appendFileSync(path.join(repo, 'shared/log.ts'), '// later\n');
      expect((await commit(b, run.id, { message: 'x' })).body).toMatchObject({
        code: 'changed-since',
        args: { files: 'shared/log.ts' },
      });
      // As the session left it again.
      fs.writeFileSync(
        path.join(repo, 'shared/log.ts'),
        git(repo, 'show', `refs/loa/runs/${run.id}/after:shared/log.ts`),
      );
      git(repo, 'checkout', '-q', '--detach');
      expect((await commit(b, run.id, { message: 'x' })).body).toMatchObject({ code: 'detached-head' });
      git(repo, 'checkout', '-q', 'main');
      expect((await commit(b, run.id, { message: 'x' })).status).toBe(200);
      expect((await commit(b, run.id, { message: 'x' })).body).toMatchObject({ code: 'already-committed' });
    }));

  test('in the app: keep, then Commit opens the message and files; your earlier changes stay out unless ticked', ({
    page,
  }) =>
    committing(async (repo, b) => {
      fs.appendFileSync(path.join(repo, 'shared/allowlist.ts'), '// mine, before the session\n');
      await page.goto(linkFor(b));
      await expect(page.locator('#conn')).toHaveText('Live');
      await page.locator('#agentBtn').click();
      await page.locator('#agentMenu [data-agent="hermes"]').click();
      await page.locator('.frame[data-dir="shared"] > .flabel b').click();
      await page.locator('#prompt').fill('Tidy the log. edit:shared/log.ts edit:shared/allowlist.ts');
      await page.locator('#prompt').press('Enter');
      // The person's edit before it is recorded first, as its own run: the session is run 2.
      await expect(page.locator('#runbar b')).toHaveText('Run 2', { timeout: 15_000 });
      await page.locator('[data-act="keep"]').click();
      await page.locator('#commitBtn').click();
      const dlg = page.locator('#commitDlg');
      await expect(dlg.locator('h2')).toHaveText('Commit run 2 to main');
      await expect(page.locator('#commitMessage')).toHaveValue(
        'Tidy the log. edit:shared/log.ts edit:shared/allowlist.ts',
      );
      await expect(dlg.locator('#commitFiles li')).toHaveText([
        'shared/log.ts',
        'shared/allowlist.tsChanged before this session, not committed',
      ]);
      await expect(dlg.locator('[data-include="shared/allowlist.ts"]')).not.toBeChecked();
      await page.locator('#commitMessage').fill('Tidy the log');
      await page.locator('#commitConfirm').click();
      await expect(page.locator(TOAST)).toHaveText(/^Committed [0-9a-f]{7} to main$/);
      await expect(dlg).toHaveCount(0);
      await expect(page.locator('#insp .outcome')).toContainText('Committed');
      expect(git(repo, 'log', '-1', '--format=%B').trim()).toBe('Tidy the log');
      expect(git(repo, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe('shared/log.ts');
      expect(git(repo, 'status', '--porcelain')).toBe(' M shared/allowlist.ts\n');
    }));

  test("your git hooks run: they see only the session's files staged, can change the message, and can stop the commit", () =>
    committing(async (repo, b) => {
      const hooks = path.join(repo, '.git/hooks');
      // pre-commit: records what it sees staged; refuses while a file named STOP exists.
      fs.writeFileSync(
        path.join(hooks, 'pre-commit'),
        '#!/bin/sh\ngit diff --cached --name-only > "$(git rev-parse --git-dir)/seen"\nif [ -e STOP ]; then echo "secret found in shared/log.ts" >&2; exit 1; fi\n',
        { mode: 0o755 },
      );
      fs.writeFileSync(path.join(hooks, 'commit-msg'), '#!/bin/sh\nprintf "\\nReviewed-by: hook\\n" >> "$1"\n', {
        mode: 0o755,
      });
      fs.appendFileSync(path.join(repo, 'apps/console/main.ts'), '// staged by me\n');
      git(repo, 'add', 'apps/console/main.ts');
      const staged = git(repo, 'diff', '--cached');
      const was = head(repo);
      const run = await session(b, 'edit:shared/log.ts');
      fs.writeFileSync(path.join(repo, 'STOP'), '');
      const refused = await commit(b, run.id, { message: 'Log it' });
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: 'git-refused' });
      expect((refused.body as { args: { output: string } }).args.output).toContain('secret found in shared/log.ts');
      expect(head(repo)).toBe(was);
      expect(git(repo, 'diff', '--cached')).toBe(staged);
      fs.rmSync(path.join(repo, 'STOP'));
      expect((await commit(b, run.id, { message: 'Log it' })).status).toBe(200);
      expect(fs.readFileSync(path.join(repo, '.git/seen'), 'utf8')).toBe('shared/log.ts\n');
      expect(git(repo, 'log', '-1', '--format=%B').trim()).toBe('Log it\n\nReviewed-by: hook');
      expect(git(repo, 'diff', '--cached')).toBe(staged);
      expect(git(repo, 'status', '--porcelain')).toBe('M  apps/console/main.ts\n');
    }));

  test('a hook that reformats a file: what it committed is what your staging area holds, so the file shows clean', () =>
    committing(async (repo, b) => {
      fs.writeFileSync(
        path.join(repo, '.git/hooks/pre-commit'),
        '#!/bin/sh\nprintf "// formatted\\n" >> shared/log.ts\ngit add shared/log.ts\n',
        { mode: 0o755 },
      );
      const run = await session(b, 'edit:shared/log.ts');
      expect((await commit(b, run.id, { message: 'Format' })).status).toBe(200);
      expect(git(repo, 'show', 'HEAD:shared/log.ts')).toContain('// formatted');
      expect(git(repo, 'status', '--porcelain')).toBe('');
    }));

  test('in the app, a hook that stops the commit shows its own words, and the dialog stays open', ({ page }) =>
    committing(async (repo, b) => {
      fs.writeFileSync(
        path.join(repo, '.git/hooks/pre-commit'),
        '#!/bin/sh\necho "prettier: shared/log.ts is not formatted" >&2\nexit 1\n',
        { mode: 0o755 },
      );
      await page.goto(linkFor(b));
      await expect(page.locator('#conn')).toHaveText('Live');
      await page.locator('#agentBtn').click();
      await page.locator('#agentMenu [data-agent="hermes"]').click();
      await page.locator('.frame[data-dir="shared"] > .flabel b').click();
      await page.locator('#prompt').fill('Log it. edit:shared/log.ts');
      await page.locator('#prompt').press('Enter');
      await page.locator('[data-act="keep"]').click({ timeout: 15_000 });
      await page.locator('#commitBtn').click();
      await page.locator('#commitConfirm').click();
      await expect(page.locator('#commitHookOutput')).toContainText('prettier: shared/log.ts is not formatted');
      await expect(page.locator('#commitDlg')).toBeVisible();
      expect(git(repo, 'log', '--oneline').trim().split('\n')).toHaveLength(1);
    }));

  test('signs the commit when git is set to sign', () =>
    committing(async (repo, b) => {
      const gpg = path.join(path.dirname(repo), 'fake-gpg.sh');
      fs.writeFileSync(
        gpg,
        '#!/bin/sh\ncat >/dev/null\necho "[GNUPG:] SIG_CREATED D 1 8 00 0 0 0" >&2\nprintf -- "-----BEGIN PGP SIGNATURE-----\\nfake\\n-----END PGP SIGNATURE-----\\n"\n',
        { mode: 0o755 },
      );
      git(repo, 'config', 'commit.gpgsign', 'true');
      git(repo, 'config', 'gpg.program', gpg);
      git(repo, 'config', 'user.signingkey', 'TEST');
      const run = await session(b, 'edit:shared/log.ts');
      expect((await commit(b, run.id, { message: 'Signed' })).status).toBe(200);
      expect(git(repo, 'cat-file', '-p', 'HEAD')).toContain('-----BEGIN PGP SIGNATURE-----');
    }));
});

test.describe('sessions at once', () => {
  /** A repo whose stand-in Hermes edits what each prompt names, and holds its turn until the test says go. */
  async function twoSessions(fn: (b: Bridge, repo: string) => Promise<void>, env: Record<string, string> = {}) {
    const repo = makeRepo();
    const b = await startBridge(repo, FAKE_CLAUDE, { LOA_HERMES_BIN: FAKE_ACP, LOA_CODEX_BIN: FAKE_CODEX, ...env });
    try {
      await expect
        .poll(async () => ((await call(b, '/api/state')).body as unknown as StateResponse).agents.hermes?.available)
        .toBe(true);
      await fn(b, repo);
    } finally {
      b.stop();
      fs.rmSync(path.dirname(repo), { recursive: true, force: true });
    }
  }
  const start = (b: Bridge, scope: string[], prompt: string) =>
    call(b, '/api/runs', { agent: 'hermes', prompt, scope, resumeFrom: null });
  const state = async (b: Bridge) => (await call(b, '/api/state')).body as unknown as StateResponse;
  const runOf = async (b: Bridge, id: number) => (await call(b, `/api/runs/${id}`)).body as unknown as RunDTO;
  const go = (repo: string, name: string) => fs.writeFileSync(path.join(repo, `.loa/go-${name}`), '');
  const until = (b: Bridge, id: number, status: string) =>
    expect.poll(async () => (await runOf(b, id)).status, { timeout: 15_000 }).toBe(status);

  test('two sessions on disjoint folders at once: each owns its own change, and each reverts alone', () =>
    twoSessions(async (b, repo) => {
      const a = (await start(b, ['shared/'], 'Edit the log. edit:shared/log.ts wait:a')).body as unknown as RunDTO;
      expect(a.status).toBe('running');
      const c = (await start(b, ['apps/'], 'Edit the app. edit:apps/console/main.ts wait:c')).body as unknown as RunDTO;
      expect(c.status).toBe('running');
      expect((await state(b)).working).toEqual([a.id, c.id]);
      // Each prompt names the sections other sessions hold.
      const log = path.join(repo, '../fake-acp.log');
      await expect
        .poll(() => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''))
        .toContain('Other sessions are working at the same time on: shared/.');
      go(repo, 'a');
      go(repo, 'c');
      await until(b, a.id, 'done');
      await until(b, c.id, 'done');
      expect((await runOf(b, a.id)).changes.map(ch => ch.path)).toEqual(['shared/log.ts']);
      expect((await runOf(b, c.id)).changes.map(ch => ch.path)).toEqual(['apps/console/main.ts']);
      // Nothing left over: every change is a session's.
      expect((await state(b)).runs.map(r => r.agent)).toEqual(['hermes', 'hermes']);
      expect((await call(b, `/api/runs/${a.id}/revert`, {})).status).toBe(200);
      expect(fs.readFileSync(path.join(repo, 'shared/log.ts'), 'utf8')).toBe(SEED['shared/log.ts']);
      expect(fs.readFileSync(path.join(repo, 'apps/console/main.ts'), 'utf8')).not.toBe(SEED['apps/console/main.ts']);
      expect((await call(b, `/api/runs/${c.id}/revert`, {})).status).toBe(200);
      expect(fs.readFileSync(path.join(repo, 'apps/console/main.ts'), 'utf8')).toBe(SEED['apps/console/main.ts']);
    }));

  test("Codex beside Hermes: Codex doesn't report its edits, so it is credited what changed in its own section", () =>
    twoSessions(async (b, repo) => {
      const h = (await start(b, ['apps/'], 'edit:apps/console/main.ts wait:a')).body as unknown as RunDTO;
      const c = (await call(b, '/api/runs', { agent: 'codex', prompt: 'Change the log prefix', scope: ['shared/'] }))
        .body as unknown as RunDTO;
      await until(b, c.id, 'done');
      expect((await runOf(b, c.id)).changes.map(ch => ch.path)).toEqual(['shared/log.ts']);
      go(repo, 'a');
      await until(b, h.id, 'done');
      expect((await runOf(b, h.id)).changes.map(ch => ch.path)).toEqual(['apps/console/main.ts']);
      expect((await state(b)).runs.map(r => r.agent)).toEqual(['hermes', 'codex']);
    }));

  test("without a sandbox, Claude Code's shell commands outside its section are put back, kept, and restored in one click", () =>
    twoSessions(
      async (b, repo) => {
        const h = (await start(b, ['apps/'], 'edit:apps/console/main.ts wait:a')).body as unknown as RunDTO;
        const prompt = 'Log it. shell:shared/log.ts shell:notes.md';
        const c = (await call(b, '/api/runs', { agent: 'claude', prompt, scope: ['shared/'] }))
          .body as unknown as RunDTO;
        await until(b, c.id, 'done');
        const run = await runOf(b, c.id);
        expect(run.changes.map(ch => ch.path)).toEqual(['shared/log.ts']);
        expect(run.agentLines).toEqual({ 'shared/log.ts': [[1, 1]] });
        // Outside its section: undone at once, and the agent told why.
        expect(fs.existsSync(path.join(repo, 'notes.md'))).toBe(false);
        expect(run.summary).toContain('notes.md: League of Agents scope lock: a shell command changed notes.md');
        expect(run.stream!.map(e => e.text).join('\n')).toContain('Put back what a shell command changed outside');
        // Kept: restored as the command left it, once asked.
        expect(run.putBack).toEqual([
          { path: 'notes.md', ref: `refs/loa/runs/${c.id}/put-back-0`, put: null, restored: false },
        ]);
        // A file written there since it was put back: restoring would lose it, so it is refused.
        fs.writeFileSync(path.join(repo, 'notes.md'), 'mine\n');
        expect((await call(b, `/api/runs/${c.id}/put-back`, { path: 'notes.md' })).body).toMatchObject({
          code: 'changed-since-put-back',
        });
        fs.rmSync(path.join(repo, 'notes.md'));
        expect((await call(b, `/api/runs/${c.id}/put-back`, { path: 'notes.md' })).status).toBe(200);
        expect(fs.readFileSync(path.join(repo, 'notes.md'), 'utf8')).toBe('// written by a shell command\n');
        expect((await runOf(b, c.id)).putBack?.[0]?.restored).toBe(true);
        fs.rmSync(path.join(repo, 'notes.md'));
        go(repo, 'a');
        await until(b, h.id, 'done');
        // Nothing left over, and the session reverts on its own.
        expect((await state(b)).runs.map(r => r.agent)).toEqual(['hermes', 'claude']);
        expect((await call(b, `/api/runs/${c.id}/revert`, {})).status).toBe(200);
        expect(fs.readFileSync(path.join(repo, 'shared/log.ts'), 'utf8')).toBe(SEED['shared/log.ts']);
        // A terminal session, with no section, passes its shell commands through at once.
        const t0 = Date.now();
        const hook = spawnSync(process.execPath, [path.join(repo, '.loa/bridge.mjs'), 'hook', 'pre'], {
          cwd: repo,
          input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: repo }),
          env: { ...process.env, LOA_SCOPE_FILE: '' },
        });
        expect(hook.status).toBe(0);
        expect(Date.now() - t0).toBeLessThan(1000);
      },
      { LOA_SANDBOX: 'off' },
    ));

  onMac(
    "in the sandbox, Claude Code's shell commands write in its section, credited line for line, and nowhere else",
    () =>
      twoSessions(async (b, repo) => {
        const prompt = 'Log it. shell:shared/log.ts shell:notes.md shell:apps/console/main.ts';
        const c = (await call(b, '/api/runs', { agent: 'claude', prompt, scope: ['shared/'] }))
          .body as unknown as RunDTO;
        await until(b, c.id, 'done');
        const run = await runOf(b, c.id);
        expect(run.changes.map(ch => ch.path)).toEqual(['shared/log.ts']);
        expect(run.agentLines).toEqual({ 'shared/log.ts': [[1, 1]] });
        // Refused by the system: never written, so nothing to put back.
        expect(run.summary).toContain('notes.md: EPERM');
        expect(run.summary).toContain('apps/console/main.ts: EPERM');
        // A command's write names no file to ask about: said once, plainly.
        expect(run.commandBlocked).toBe(true);
        expect(run.stream!.filter(e => e.say === 'command-blocked')).toHaveLength(1);
        expect(fs.existsSync(path.join(repo, 'notes.md'))).toBe(false);
        expect(fs.readFileSync(path.join(repo, 'apps/console/main.ts'), 'utf8')).toBe(SEED['apps/console/main.ts']);
        expect(run.putBack).toBeUndefined();
      }),
  );

  onMac('the section lock holds every program a session starts: its section and ignored output only', () =>
    twoSessions(async (b, repo) => {
      fs.writeFileSync(path.join(repo, '.gitignore'), 'dist/\n*.log\n');
      git(repo, 'add', '.gitignore');
      git(repo, '-c', 'user.name=t', '-c', 'user.email=t@e.t', 'commit', '-qm', 'ignore');
      const cmd = [
        "printf 'x\\n' >> shared/log.ts",
        "printf 'y\\n' >> apps/console/main.ts",
        "printf 'n\\n' > notes.md",
        "python3 -c \"open('apps/console/main.ts','a').write('p')\"",
        'mv shared/allowlist.ts moved.ts',
        "mkdir -p dist && printf 'b' > dist/out.js",
        "printf 'l' > debug.log",
      ].join('; ');
      const h = (await start(b, ['shared/'], `exec: ${cmd}`)).body as unknown as RunDTO;
      await until(b, h.id, 'done');
      expect(fs.readFileSync(path.join(repo, 'shared/log.ts'), 'utf8')).toBe(SEED['shared/log.ts'] + 'x\n');
      expect(fs.readFileSync(path.join(repo, 'apps/console/main.ts'), 'utf8')).toBe(SEED['apps/console/main.ts']);
      expect(fs.existsSync(path.join(repo, 'notes.md'))).toBe(false);
      expect(fs.existsSync(path.join(repo, 'moved.ts'))).toBe(false);
      expect(fs.existsSync(path.join(repo, 'shared/allowlist.ts'))).toBe(true);
      expect(fs.readFileSync(path.join(repo, 'dist/out.js'), 'utf8')).toBe('b');
      expect(fs.readFileSync(path.join(repo, 'debug.log'), 'utf8')).toBe('l');
      expect((await runOf(b, h.id)).summary).toContain('Operation not permitted');
      expect((await runOf(b, h.id)).commandBlocked).toBe(true);
      // Inside its section only: nothing blocked, nothing said.
      const inside = (await start(b, ['shared/'], "exec: printf 'y\\n' >> shared/log.ts")).body as unknown as RunDTO;
      await until(b, inside.id, 'done');
      expect((await runOf(b, inside.id)).commandBlocked).toBeUndefined();
    }),
  );

  onMac(
    'npm install and a test suite run in a section holding the package; a lockfile outside the section is refused',
    () =>
      twoSessions(async (b, repo) => {
        const put = (p: string, text: string) => {
          fs.mkdirSync(path.dirname(path.join(repo, p)), { recursive: true });
          fs.writeFileSync(path.join(repo, p), text);
        };
        put('.gitignore', 'node_modules/\n');
        put('vendor/dep/package.json', JSON.stringify({ name: 'dep', version: '1.0.0', main: 'index.js' }));
        put('vendor/dep/index.js', 'module.exports = () => 42;\n');
        put('vendor/extra/package.json', JSON.stringify({ name: 'extra', version: '1.0.0' }));
        put(
          'app/package.json',
          JSON.stringify({
            name: 'app',
            version: '1.0.0',
            scripts: { test: 'node --test' },
            dependencies: { dep: 'file:../vendor/dep' },
          }),
        );
        put(
          'app/dep.test.js',
          "const test = require('node:test');\nconst assert = require('node:assert');\ntest('dep', () => assert.equal(require('dep')(), 42));\n",
        );
        execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: path.join(repo, 'app'), stdio: 'ignore' });
        fs.rmSync(path.join(repo, 'app/node_modules'), { recursive: true });
        git(repo, 'add', '-A');
        git(repo, '-c', 'user.name=t', '-c', 'user.email=t@e.t', 'commit', '-qm', 'app');
        const lock = fs.readFileSync(path.join(repo, 'app/package-lock.json'), 'utf8');
        const npm = 'cd app && npm install --no-audit --no-fund && npm test';
        const inside = (await start(b, ['app/'], `exec: ${npm}`)).body as unknown as RunDTO;
        await until(b, inside.id, 'done');
        expect((await runOf(b, inside.id)).summary).toMatch(/^exit 0:/);
        expect(fs.existsSync(path.join(repo, 'app/node_modules/dep'))).toBe(true);
        // Adding a package rewrites app/package.json and its lockfile, outside a session on app's tests alone.
        const narrow = (
          await start(b, ['app/test/'], 'exec: cd app && npm install --no-audit --no-fund ../vendor/extra')
        ).body as unknown as RunDTO;
        await until(b, narrow.id, 'done');
        expect((await runOf(b, narrow.id)).summary).toMatch(/^exit [1-9]/);
        expect(fs.readFileSync(path.join(repo, 'app/package-lock.json'), 'utf8')).toBe(lock);
        expect(JSON.parse(fs.readFileSync(path.join(repo, 'app/package.json'), 'utf8')).dependencies).toEqual({
          dep: 'file:../vendor/dep',
        });
      }),
  );

  onMac(
    "a session can't reach past the sandbox: the bridge's token, its shell token elsewhere, or what runs later",
    () =>
      twoSessions(async (b, repo) => {
        const home = homeOf(repo);
        fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
        const cmd = [
          'cat .loa/bridge.json',
          `printf x >> "$HOME/.gitconfig"`,
          `mkdir -p "$HOME/.config/league-of-agents" && printf x > "$HOME/.config/league-of-agents/approved.json"`,
          `printf x > "$HOME/.claude/settings.json"`,
          'printf x >> .git/config',
        ].join('; ');
        const config = fs.readFileSync(path.join(repo, '.git/config'), 'utf8');
        const h = (await start(b, ['shared/'], `exec: ${cmd}`)).body as unknown as RunDTO;
        await until(b, h.id, 'done');
        expect((await runOf(b, h.id)).summary).toMatch(/^exit 1: .*Operation not permitted/);
        expect(fs.existsSync(path.join(home, '.gitconfig'))).toBe(false);
        expect(fs.existsSync(path.join(home, '.config/league-of-agents/approved.json'))).toBe(false);
        expect(fs.existsSync(path.join(home, '.claude/settings.json'))).toBe(false);
        expect(fs.readFileSync(path.join(repo, '.git/config'), 'utf8')).toBe(config);
        // A run's shell token opens its own shell route and nothing else.
        const c = (await call(b, '/api/runs', { agent: 'claude', prompt: 'abuse', scope: ['shared/'] }))
          .body as unknown as RunDTO;
        await until(b, c.id, 'done');
        expect((await runOf(b, c.id)).summary).toBe('save: 401');
        expect(fs.existsSync(path.join(repo, 'README.md'))).toBe(false);
      }),
  );

  onMac(
    'on a file section, a session writes that file and nothing new beside it: no file named like it, no new file elsewhere',
    () =>
      twoSessions(async (b, repo) => {
        const cmd = [
          "printf 'x\\n' >> shared/allowlist.ts",
          "printf 'n' > shared/allowlist.tsx",
          "printf 'n' > shared/allowlist.ts.bak",
          "printf 'n' > shared/new.ts",
          "printf 'n' > brand-new.ts",
          "printf 'n' > shared/allowlist.ts.tmp.4242.a1b2c3d4e5f6",
          // Hermes writes its temporary file beside the file, then renames it over the file.
          "printf 'y\\n' > shared/.hermes-tmp.Ab12Cd && mv shared/.hermes-tmp.Ab12Cd shared/allowlist.ts",
        ].join('; ');
        const h = (await start(b, ['shared/allowlist.ts'], `exec: ${cmd}`)).body as unknown as RunDTO;
        await until(b, h.id, 'done');
        expect(fs.readFileSync(path.join(repo, 'shared/allowlist.ts'), 'utf8')).toBe('y\n');
        const refused = ['allowlist.tsx', 'allowlist.ts.bak', 'allowlist.ts.tmp.4242.a1b2c3d4e5f6', 'new.ts'];
        for (const p of [...refused.map(f => `shared/${f}`), 'brand-new.ts'])
          expect(fs.existsSync(path.join(repo, p)), p).toBe(false);
      }),
  );

  onMac(
    "a session can't widen its own lock: not through an ignore file, the bridge's folder, or the repo's agent settings",
    () =>
      twoSessions(async (b, repo) => {
        fs.writeFileSync(path.join(repo, '.gitignore'), 'dist/\n');
        git(repo, 'add', '.gitignore');
        git(repo, '-c', 'user.name=t', '-c', 'user.email=t@e.t', 'commit', '-qm', 'ignore');
        const cmd = [
          "printf 'apps/\\n' >> .gitignore",
          "printf 'apps/\\n' >> .git/info/exclude",
          "printf 'n' > apps/new.ts",
          "printf 'x' > .loa/planted.json",
          "mkdir -p .claude && printf '{}' > .claude/settings.local.json",
          "mkdir -p .codex && printf 'x' > .codex/config.toml",
          "mkdir -p .cursor && printf '{}' > .cursor/hooks.json",
        ].join('; ');
        const settings = path.join(repo, '.claude/settings.local.json');
        const before = fs.existsSync(settings) ? fs.readFileSync(settings, 'utf8') : null;
        const h = (await start(b, ['shared/'], `exec: ${cmd}`)).body as unknown as RunDTO;
        await until(b, h.id, 'done');
        expect(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8')).toBe('dist/\n');
        expect(fs.readFileSync(path.join(repo, '.git/info/exclude'), 'utf8')).not.toContain('apps/');
        expect(fs.existsSync(path.join(repo, 'apps/new.ts'))).toBe(false);
        expect(fs.existsSync(path.join(repo, '.loa/planted.json'))).toBe(false);
        expect(fs.existsSync(settings) ? fs.readFileSync(settings, 'utf8') : null).toBe(before);
        expect(fs.existsSync(path.join(repo, '.codex/config.toml'))).toBe(false);
        expect(fs.existsSync(path.join(repo, '.cursor/hooks.json'))).toBe(false);
      }),
  );

  const MAIN = 'apps/console/main.ts';
  const waitsOn = (b: Bridge, id: number) =>
    expect.poll(async () => (await runOf(b, id)).waiting, { timeout: 15_000 }).toBe('done');
  const answer = (b: Bridge, id: number, file: string, allow: boolean) =>
    call(b, `/api/runs/${id}/wants`, { path: file, allow });
  const acpLog = (repo: string) => fs.readFileSync(path.join(repo, '../fake-acp.log'), 'utf8');

  test('a write refused outside the section is asked; allowed, the file joins the section and the same session carries on', () =>
    twoSessions(async (b, repo) => {
      const h = (await start(b, ['shared/'], `edit:${MAIN}`)).body as unknown as RunDTO;
      await waitsOn(b, h.id);
      let run = await runOf(b, h.id);
      // Waiting for the person: still at work on its section, which no other session may take.
      expect(run.status).toBe('running');
      expect(run.wants).toEqual([{ path: MAIN }]);
      expect(run.stream!.map(e => `${e.t} ${e.text}`)).toContain(`deny Tried to change ${MAIN}. Blocked.`);
      expect(fs.readFileSync(path.join(repo, MAIN), 'utf8')).toBe(SEED[MAIN]);
      expect((await start(b, ['shared/log.ts'], 'Log it')).status).toBe(409);
      expect((await answer(b, h.id, MAIN, true)).status).toBe(200);
      await until(b, h.id, 'done');
      run = await runOf(b, h.id);
      expect(run.scope).toEqual(['shared/', MAIN]);
      expect(run.wants).toMatchObject([{ path: MAIN, answer: 'allowed' }]);
      expect(fs.readFileSync(path.join(repo, MAIN), 'utf8')).toBe(SEED[MAIN] + `// edited in ${run.sessionId}\n`);
      expect(run.changes.map(c => c.path)).toEqual([MAIN]);
      expect(run.outOfScope).toEqual([]);
      // The same session, resumed, and told what it may now change.
      expect(acpLog(repo)).toContain(`resume ${run.sessionId}`);
      expect(acpLog(repo)).toContain(`You may now change ${MAIN}. Carry on where you stopped.`);
      // Answered once: a second answer is refused.
      expect((await answer(b, h.id, MAIN, false)).body).toMatchObject({ code: 'answered' });
    }));

  test('refused, the file stays out and the session ends as its turn did; stopped while it waits, it ends at once', () =>
    twoSessions(async (b, repo) => {
      const h = (await start(b, ['shared/'], `edit:${MAIN}`)).body as unknown as RunDTO;
      await waitsOn(b, h.id);
      expect((await answer(b, h.id, MAIN, false)).status).toBe(200);
      await until(b, h.id, 'done');
      const run = await runOf(b, h.id);
      expect(run.scope).toEqual(['shared/']);
      expect(run.wants).toMatchObject([{ path: MAIN, answer: 'refused' }]);
      expect(fs.readFileSync(path.join(repo, MAIN), 'utf8')).toBe(SEED[MAIN]);
      expect(acpLog(repo)).not.toContain('resume');
      const s = (await start(b, ['shared/'], `edit:${MAIN}`)).body as unknown as RunDTO;
      await waitsOn(b, s.id);
      expect((await call(b, `/api/runs/${s.id}/cancel`, {})).status).toBe(200);
      await until(b, s.id, 'cancelled');
      expect(fs.existsSync(path.join(repo, `.loa/scope-${s.id}.json`))).toBe(false);
      expect((await answer(b, s.id, MAIN, true)).body).toMatchObject({ code: 'answered' });
    }));

  test('a file another session is working on waits for that session to end; the refusal names it', () =>
    twoSessions(async (b, repo) => {
      const a = (await start(b, ['apps/'], `edit:${MAIN} wait:a`)).body as unknown as RunDTO;
      const h = (await start(b, ['shared/'], `edit:${MAIN}`)).body as unknown as RunDTO;
      await waitsOn(b, h.id);
      const held = await answer(b, h.id, MAIN, true);
      expect(held.status).toBe(409);
      expect(held.body).toMatchObject({ code: 'held', args: { id: a.id, path: MAIN } });
      go(repo, 'a');
      await until(b, a.id, 'done');
      expect((await answer(b, h.id, MAIN, true)).status).toBe(200);
      await until(b, h.id, 'done');
      expect((await runOf(b, h.id)).changes.map(c => c.path)).toEqual([MAIN]);
    }));

  test("Claude Code's edit refused outside its section: asked, and once allowed, resumed in its own session", () =>
    twoSessions(async (b, repo) => {
      const c = (await call(b, '/api/runs', { agent: 'claude', prompt: 'want:apps/new.ts', scope: ['shared/'] }))
        .body as unknown as RunDTO;
      await waitsOn(b, c.id);
      expect((await runOf(b, c.id)).wants).toEqual([{ path: 'apps/new.ts' }]);
      expect(fs.existsSync(path.join(repo, 'apps/new.ts'))).toBe(false);
      expect((await answer(b, c.id, 'apps/new.ts', true)).status).toBe(200);
      await until(b, c.id, 'done');
      const run = await runOf(b, c.id);
      expect(run.summary).toBe('apps/new.ts: written (resumed sess-123)');
      expect(fs.readFileSync(path.join(repo, 'apps/new.ts'), 'utf8')).toBe('// written by a resumed session\n');
      expect(run.changes.map(ch => ch.path)).toEqual(['apps/new.ts']);
      expect(run.agentLines).toEqual({ 'apps/new.ts': [[0, 0]] });
    }));

  test('allowed a new file in a folder not made yet, the session makes that folder and writes the file', () =>
    twoSessions(async (b, repo) => {
      const c = (await call(b, '/api/runs', { agent: 'claude', prompt: 'want:notes/todo.md', scope: ['shared/'] }))
        .body as unknown as RunDTO;
      await waitsOn(b, c.id);
      expect((await answer(b, c.id, 'notes/todo.md', true)).status).toBe(200);
      await until(b, c.id, 'done');
      expect((await runOf(b, c.id)).summary).toBe('notes/todo.md: written (resumed sess-123)');
      expect(fs.readFileSync(path.join(repo, 'notes/todo.md'), 'utf8')).toBe('// written by a resumed session\n');
    }));

  onMac(
    'a file in a folder not made yet: the sandbox lets the session make that folder, as a folder, and nothing else in it',
    () =>
      twoSessions(async (b, repo) => {
        const cmd = [
          'printf n > notes',
          "mkdir -p notes/deep && printf 'x' > notes/deep/todo.md",
          "printf 'y' > notes/other.md",
          "printf 'z' > notes/deep/other.md",
          'mkdir notes2',
        ].join('; ');
        const h = (await start(b, ['shared/', 'notes/deep/todo.md'], `exec: ${cmd}`)).body as unknown as RunDTO;
        await until(b, h.id, 'done');
        expect(fs.readFileSync(path.join(repo, 'notes/deep/todo.md'), 'utf8')).toBe('x');
        expect(fs.readdirSync(path.join(repo, 'notes'))).toEqual(['deep']);
        expect(fs.readdirSync(path.join(repo, 'notes/deep'))).toEqual(['todo.md']);
        expect(fs.existsSync(path.join(repo, 'notes2'))).toBe(false);
      }),
  );

  onMac(
    'carrying on, a session is held by the ignore rules the repo had when it started, not ones it wrote since',
    () =>
      twoSessions(async (b, repo) => {
        fs.writeFileSync(path.join(repo, '.gitignore'), 'dist/\n');
        git(repo, 'add', '.gitignore');
        git(repo, '-c', 'user.name=t', '-c', 'user.email=t@e.t', 'commit', '-qm', 'ignore');
        const prompt = [
          "exec: printf 'apps/\\n' >> .gitignore",
          'later: printf n > apps/new.ts; mkdir -p dist && printf m > dist/x.js',
          'edit:loa.config.json',
        ].join('\n');
        const h = (await start(b, ['shared/', '.gitignore'], prompt)).body as unknown as RunDTO;
        await waitsOn(b, h.id);
        expect(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8')).toBe('dist/\napps/\n');
        expect((await answer(b, h.id, 'loa.config.json', true)).status).toBe(200);
        await until(b, h.id, 'done');
        expect(fs.existsSync(path.join(repo, 'apps/new.ts'))).toBe(false);
        expect(fs.readFileSync(path.join(repo, 'dist/x.js'), 'utf8')).toBe('m');
      }),
  );

  type Step = { i: number; at: number; act: string; file?: string; tool: string; text?: boolean; refused?: boolean };
  const stepsOf = async (b: Bridge, id: number, from = 0) =>
    ((await call(b, `/api/runs/${id}/steps?from=${from}`)).body as unknown as { steps: Step[] }).steps;

  test("each tool call is a step, as it happens: what it did, the file it named, and an edit's file as it left it", () =>
    twoSessions(async (b, repo) => {
      const h = (await start(b, ['shared/'], 'edit:shared/log.ts edit:shared/.env.local wait:a'))
        .body as unknown as RunDTO;
      // While it works: its steps so far, each with when it happened.
      await expect
        .poll(async () => (await stepsOf(b, h.id)).map(s => `${s.act} ${s.file ?? ''}`), { timeout: 15_000 })
        .toEqual(['read shared/allowlist.ts', 'edit shared/log.ts', 'edit shared/.env.local']);
      const steps = await stepsOf(b, h.id);
      expect(steps.map(s => s.i)).toEqual([0, 1, 2]);
      for (const s of steps) expect(Math.abs(s.at - Date.now())).toBeLessThan(15_000);
      // The edit's file, as the edit left it; never a file that usually holds secrets.
      await expect.poll(async () => (await stepsOf(b, h.id))[1]!.text, { timeout: 5_000 }).toBe(true);
      const at = (await call(b, `/api/runs/${h.id}/steps/1`)).body as unknown as { text: string };
      expect(at.text).toBe(SEED['shared/log.ts'] + `// edited in ${(await runOf(b, h.id)).sessionId}\n`);
      expect((await stepsOf(b, h.id))[2]!.text).toBeUndefined();
      expect((await call(b, `/api/runs/${h.id}/steps/2`)).status).toBe(404);
      expect((await call(b, `/api/runs/${h.id}/steps/0`)).status).toBe(404);
      expect((await stepsOf(b, h.id, 2)).map(s => s.i)).toEqual([2]);
      // While it works, a file a step named is served as the run found it, to draw its edits against.
      const found = await call(b, `/api/runs/${h.id}/before?path=shared/log.ts`);
      expect(found.body).toEqual({ text: SEED['shared/log.ts'] });
      expect((await call(b, `/api/runs/${h.id}/before?path=apps/console/main.ts`)).status).toBe(404);
      // The steps reached the app as they came: in progress events, with the model.
      const events = (await call(b, '/api/events?since=0')).body as unknown as {
        events: { type: string; run?: { id: number; steps?: Step[]; model?: string } }[];
      };
      const told = events.events
        .filter(e => e.type === 'progress' && e.run?.id === h.id)
        .flatMap(e => e.run!.steps ?? []);
      expect([...new Set(told.map(s => s.i))]).toEqual([0, 1, 2]);
      expect(events.events.some(e => e.run?.id === h.id && e.run.model === 'fake-model-1')).toBe(true);
      go(repo, 'a');
      await until(b, h.id, 'done');
      // Kept whole once it ends, past any restart: its file, and the edit's text pinned under the run.
      expect((await stepsOf(b, h.id)).length).toBe(3);
      expect(fs.readFileSync(path.join(repo, `.loa/runs/${h.id}.steps.jsonl`), 'utf8')).toContain('shared/log.ts');
      expect(git(repo, 'ls-tree', '-r', `refs/loa/runs/${h.id}/steps`)).toContain('blob');
      expect(((await call(b, `/api/runs/${h.id}/steps/1`)).body as unknown as { text: string }).text).toBe(at.text);
    }));

  test('two edits of a file in a row: each step keeps the file as that edit left it', () =>
    twoSessions(async (b, repo) => {
      const h = (await start(b, ['shared/'], 'edit:shared/log.ts edit:shared/log.ts')).body as unknown as RunDTO;
      await until(b, h.id, 'done');
      const at = async (i: number) =>
        ((await call(b, `/api/runs/${h.id}/steps/${i}`)).body as unknown as { text: string }).text;
      const line = `// edited in ${(await runOf(b, h.id)).sessionId}\n`;
      expect(await at(1)).toBe(SEED['shared/log.ts'] + line);
      expect(await at(2)).toBe(SEED['shared/log.ts'] + line + line);
      expect(fs.readFileSync(path.join(repo, 'shared/log.ts'), 'utf8')).toBe(await at(2));
    }));

  test("Claude Code's steps: an edit refused, then allowed and made; a shell command as a step that runs", () =>
    twoSessions(async (b, repo) => {
      const c = (await call(b, '/api/runs', { agent: 'claude', prompt: 'want:apps/new.ts', scope: ['shared/'] }))
        .body as unknown as RunDTO;
      await waitsOn(b, c.id);
      expect((await stepsOf(b, c.id)).map(s => [s.act, s.file, s.tool, !!s.refused])).toEqual([
        ['edit', 'apps/new.ts', 'Write', true],
      ]);
      expect((await answer(b, c.id, 'apps/new.ts', true)).status).toBe(200);
      await until(b, c.id, 'done');
      const steps = await stepsOf(b, c.id);
      expect(steps.map(s => [s.i, s.act, s.file, !!s.refused, !!s.text])).toEqual([
        [0, 'edit', 'apps/new.ts', true, false],
        [1, 'edit', 'apps/new.ts', false, true],
      ]);
      const s = (await call(b, '/api/runs', { agent: 'claude', prompt: 'shell:shared/log.ts', scope: ['shared/'] }))
        .body as unknown as RunDTO;
      await until(b, s.id, 'done');
      expect((await stepsOf(b, s.id)).map(x => [x.act, x.tool])).toEqual([['run', 'Bash']]);
      expect(fs.existsSync(path.join(repo, 'apps/new.ts'))).toBe(true);
    }));

  onMac("in a worktree, a session can't write the repo's git folder outside it", async () => {
    const main = makeRepo(),
      wt = path.join(path.dirname(main), 'wt');
    git(main, 'worktree', 'add', '-q', wt);
    const b = await startBridge(wt, FAKE_CLAUDE, { LOA_HERMES_BIN: FAKE_ACP });
    try {
      await expect
        .poll(async () => ((await call(b, '/api/state')).body as unknown as StateResponse).agents.hermes?.available)
        .toBe(true);
      const cmd = 'printf "[core]\\n\\tfsmonitor = touch /tmp/x\\n" >> "$(git rev-parse --git-common-dir)/config"';
      const r = await runToEnd(b, { agent: 'hermes', prompt: `exec: ${cmd}`, scope: ['shared/'], resumeFrom: null });
      expect(r.summary).toMatch(/^exit 1: .*Operation not permitted/);
      expect(fs.readFileSync(path.join(main, '.git/config'), 'utf8')).not.toContain('fsmonitor');
    } finally {
      b.stop();
      fs.rmSync(path.dirname(main), { recursive: true, force: true });
    }
  });

  onMac("a session on a section never runs unlocked: if the sandbox can't start, it is refused", () =>
    twoSessions(
      async b => {
        const r = await call(b, '/api/runs', { agent: 'claude', prompt: 'Log it', scope: ['shared/'] });
        expect(r.status).toBe(409);
        expect(r.body).toMatchObject({ code: 'no-sandbox' });
        expect((await state(b)).runs).toEqual([]);
        // The whole repository needs no section lock.
        expect((await call(b, '/api/runs', { agent: 'claude', prompt: 'Log it', scope: [] })).status).toBe(200);
      },
      { LOA_SANDBOX_EXEC: '/usr/bin/false' },
    ),
  );

  test('sections of sessions at work never overlap, and a whole-repository run works alone', () =>
    twoSessions(async (b, repo) => {
      const a = (await start(b, ['shared/'], 'edit:shared/log.ts wait:a')).body as unknown as RunDTO;
      const inside = await start(b, ['shared/allowlist.ts'], 'edit:shared/allowlist.ts');
      expect(inside.status).toBe(409);
      expect(inside.body).toMatchObject({ code: 'sections-overlap', args: { id: a.id, path: 'shared/' } });
      expect((await start(b, [], 'edit:README.md')).body).toMatchObject({ code: 'run-active', args: { id: a.id } });
      go(repo, 'a');
      await until(b, a.id, 'done');
      // Alone, a whole-repository run starts; while it works, a section can't.
      const whole = (await start(b, [], 'edit:shared/log.ts wait:w')).body as unknown as RunDTO;
      expect((await start(b, ['apps/'], 'edit:apps/console/main.ts')).body).toMatchObject({
        code: 'run-active',
        args: { id: whole.id },
      });
      go(repo, 'w');
      await until(b, whole.id, 'done');
    }));

  test('while sessions overlap, a change no session made is recorded on its own, credited to none', () =>
    twoSessions(async (b, repo) => {
      const a = (await start(b, ['shared/'], 'edit:shared/log.ts wait:a')).body as unknown as RunDTO;
      const c = (await start(b, ['apps/'], 'edit:apps/console/main.ts wait:c')).body as unknown as RunDTO;
      // Outside every section, and inside one but not by its agent.
      fs.writeFileSync(path.join(repo, 'notes.md'), '# notes\n');
      fs.appendFileSync(path.join(repo, 'shared/allowlist.ts'), '// by hand\n');
      go(repo, 'a');
      go(repo, 'c');
      await until(b, a.id, 'done');
      await until(b, c.id, 'done');
      expect((await runOf(b, a.id)).changes.map(ch => ch.path)).toEqual(['shared/log.ts']);
      expect((await runOf(b, c.id)).changes.map(ch => ch.path)).toEqual(['apps/console/main.ts']);
      await expect
        .poll(async () => (await state(b)).runs.find(r => r.agent === 'detected')?.changes.map(ch => ch.path))
        .toEqual(['notes.md', 'shared/allowlist.ts']);
      // Reverting it puts back only what no session made.
      const leftover = (await state(b)).runs.find(r => r.agent === 'detected')!;
      expect((await call(b, `/api/runs/${leftover.id}/revert`, {})).status).toBe(200);
      expect(fs.existsSync(path.join(repo, 'notes.md'))).toBe(false);
      expect(fs.readFileSync(path.join(repo, 'shared/allowlist.ts'), 'utf8')).toBe(SEED['shared/allowlist.ts']);
      expect(fs.readFileSync(path.join(repo, 'shared/log.ts'), 'utf8')).toContain('// edited in');
    }));

  test("an earlier run reverted while sessions work is the revert's, not left over when they end", () =>
    twoSessions(async (b, repo) => {
      const earlier = (await start(b, ['shared/'], 'edit:shared/log.ts')).body as unknown as RunDTO;
      await until(b, earlier.id, 'done');
      const a = (await start(b, ['apps/'], 'edit:apps/console/main.ts wait:a')).body as unknown as RunDTO;
      const c = (await start(b, ['notes.md'], 'edit:notes.md wait:c')).body as unknown as RunDTO;
      expect((await call(b, `/api/runs/${earlier.id}/revert`, {})).status).toBe(200);
      expect(fs.readFileSync(path.join(repo, 'shared/log.ts'), 'utf8')).toBe(SEED['shared/log.ts']);
      go(repo, 'a');
      go(repo, 'c');
      await until(b, a.id, 'done');
      await until(b, c.id, 'done');
      expect((await runOf(b, a.id)).changes.map(ch => ch.path)).toEqual(['apps/console/main.ts']);
      expect((await runOf(b, c.id)).changes.map(ch => ch.path)).toEqual(['notes.md']);
      expect((await state(b)).runs.map(r => r.agent)).toEqual(['hermes', 'hermes', 'hermes']);
    }));

  test('a save from the editor outside every section is its own run while sessions work; inside one, it waits', () =>
    twoSessions(async (b, repo) => {
      const a = (await start(b, ['shared/'], 'edit:shared/log.ts wait:a')).body as unknown as RunDTO;
      const save = async (file: string, text: string) => {
        const now = (await call(b, `/api/file?path=${encodeURIComponent(file)}`)).body as { hash: string };
        return call(b, '/api/save', { path: file, text, base: now.hash });
      };
      const outside = await save('apps/console/main.ts', 'export {};\n');
      expect(outside.status).toBe(200);
      expect(outside.body).toMatchObject({ agent: 'you', status: 'done' });
      expect((outside.body as unknown as RunDTO).changes.map(ch => ch.path)).toEqual(['apps/console/main.ts']);
      expect((await save('shared/allowlist.ts', 'export {};\n')).body).toMatchObject({ code: 'sections-overlap' });
      go(repo, 'a');
      await until(b, a.id, 'done');
      expect((await runOf(b, a.id)).changes.map(ch => ch.path)).toEqual(['shared/log.ts']);
    }));

  test('checks wait until every session is done, then run once for them all', () =>
    twoSessions(async (b, repo) => {
      const a = (await start(b, ['shared/'], 'edit:shared/log.ts wait:a')).body as unknown as RunDTO;
      const c = (await start(b, ['apps/'], 'edit:apps/console/main.ts wait:c')).body as unknown as RunDTO;
      go(repo, 'a');
      await until(b, a.id, 'done');
      // One session still works: no checks yet.
      expect((await runOf(b, a.id)).checks).toEqual([]);
      go(repo, 'c');
      await until(b, c.id, 'done');
      for (const id of [a.id, c.id])
        await expect.poll(async () => (await runOf(b, id)).checks.map(k => k.ok), { timeout: 15_000 }).toEqual([true]);
    }));
});

test.describe('sessions at once, in the app', () => {
  /** The app on a repo whose stand-in Hermes edits what each prompt names, holding its turn until told to go. */
  async function withHermes(page: Page, fn: (repo: string, b: Bridge) => Promise<void>, env = {}) {
    const repo = makeRepo();
    const b = await startBridge(repo, FAKE_CLAUDE, { LOA_HERMES_BIN: FAKE_ACP, ...env });
    try {
      await page.goto(linkFor(b));
      await expect(page.locator('#conn')).toHaveText('Live');
      await page.locator('#agentBtn').click();
      await page.locator('#agentMenu [data-agent="hermes"]').click();
      await fn(repo, b);
    } finally {
      b.stop();
      fs.rmSync(path.dirname(repo), { recursive: true, force: true });
    }
  }
  const go = (repo: string, name: string) => fs.writeFileSync(path.join(repo, `.loa/go-${name}`), '');
  const folder = (page: Page, dir: string) => page.locator(`.frame[data-dir="${dir}"] > .flabel b`);
  const run = async (page: Page, prompt: string) => {
    await page.locator('#prompt').fill(prompt);
    await page.locator('#prompt').press('Enter');
  };
  const running = (page: Page) => page.locator('#sideList .run.running');

  test('a second session starts while one works, each section drawn in its own colour', async ({ page }) =>
    withHermes(page, async repo => {
      await folder(page, 'shared').click();
      await run(page, 'Edit the log. edit:shared/log.ts wait:a');
      await expect(page.locator(TOAST)).toHaveText('Hermes started run 1');
      await folder(page, 'apps').click();
      await run(page, 'Edit the app. edit:apps/console/main.ts wait:c');
      await expect(page.locator(TOAST)).toHaveText('Hermes started run 2');
      await expect(running(page)).toHaveCount(2);
      // Each session's section is drawn, labelled with its run, in a colour of its own.
      const zones = page.locator('#sels .zone');
      await expect(zones).toHaveCount(2);
      await expect(zones.locator('b')).toHaveText(['Run 1 · Hermes', 'Run 2 · Hermes']);
      const colours = await zones.evaluateAll(els => els.map(el => getComputedStyle(el).outlineColor));
      expect(new Set(colours).size).toBe(2);
      // A section inside one at work is refused before it starts, saying whose it is.
      await page.locator('.fr[data-path="shared/log.ts"]').click();
      await run(page, 'edit:shared/log.ts');
      await expect(page.locator(TOAST)).toHaveText(
        'Run 1 is working on shared/. Pick a section outside it, or wait for it to finish.',
      );
      await expect(running(page)).toHaveCount(2);
      go(repo, 'a');
      go(repo, 'c');
      await expect(running(page)).toHaveCount(0, { timeout: 15_000 });
      await expect(zones).toHaveCount(0);
    }));

  test('stop one session or all; a stopped one shows so on its section and card, and frees its section', async ({
    page,
  }) =>
    withHermes(page, async () => {
      await folder(page, 'shared').click();
      await run(page, 'edit:shared/log.ts wait:a');
      await folder(page, 'apps').click();
      await run(page, 'edit:apps/console/main.ts wait:c');
      await expect(running(page)).toHaveCount(2);
      await page.locator('#sideList [data-run="1"] [data-stop]').click();
      await expect(page.locator('#sideList [data-run="1"] .tags')).toContainText('Cancelled', { timeout: 10_000 });
      // Its section stays drawn, marked as ended, until the run is opened; it is free again.
      await expect(page.locator('#sels .zone.ended b')).toHaveText('Run 1 · Hermes · Cancelled');
      await expect(page.locator('#sels .zone:not(.ended) b')).toHaveText(['Run 2 · Hermes']);
      await folder(page, 'shared').click();
      await run(page, 'edit:shared/log.ts wait:b');
      await expect(page.locator(TOAST)).toHaveText('Hermes started run 3');
      await expect(page.locator('#sels .zone.ended')).toHaveCount(0);
      // Several at work: all stop at once.
      await page.locator('#stopAll').click();
      await expect(running(page)).toHaveCount(0, { timeout: 10_000 });
      await expect(page.locator('#sideList [data-run="2"] .tags')).toContainText('Cancelled');
      await expect(page.locator('#sideList [data-run="3"] .tags')).toContainText('Cancelled');
      await expect(page.locator('#sels .zone.ended b')).toHaveText([
        'Run 2 · Hermes · Cancelled',
        'Run 3 · Hermes · Cancelled',
      ]);
      // Looked at, the marks go: run 2 opened, run 3 (open as it ended) left.
      await page.locator('#sideList [data-run="2"]').click();
      await expect(page.locator('#runbar b')).toHaveText('Run 2');
      await expect(page.locator('#sels .zone.ended')).toHaveCount(0);
    }));

  test('a session that hits its rate limit says so, on its section, its card and in the inspector', async ({ page }) =>
    withHermes(page, async () => {
      await page.locator('#agentBtn').click();
      await page.locator('#agentMenu [data-agent="claude"]').click();
      await folder(page, 'shared').click();
      await run(page, 'ratelimit');
      await expect(page.locator('#sideList [data-run="1"] .tags')).toContainText('Rate limited', { timeout: 10_000 });
      await expect(page.locator('#sels .zone.ended b')).toHaveText('Run 1 · Claude Code · Rate limited');
      // It opens as it ends.
      await expect(page.locator('#runbar b')).toHaveText('Run 1');
      await expect(page.locator('#insp .problem')).toHaveText('Claude Code hit its usage limit. Try again later.');
    }));

  test('follow-ups: the composer names the session it replies to, switches between them, and keeps its section', async ({
    page,
  }) =>
    withHermes(page, async (repo, b) => {
      await folder(page, 'shared').click();
      await run(page, 'Tidy the log. edit:shared/log.ts');
      // Alone, it opens as it finishes.
      await expect(page.locator('#runbar b')).toHaveText('Run 1', { timeout: 15_000 });
      await expect(page.locator('[data-act="keep"]')).toBeVisible();
      // Closed, so the next prompt starts a session of its own; apps/ picked in the file tree.
      await page.keyboard.press('Escape');
      await page.locator('[data-tab="files"]').click();
      await page.locator('#sideList .ti[data-dir="apps"]').click();
      await run(page, 'Tidy the app. edit:apps/console/main.ts');
      await expect(page.locator('#runbar b')).toHaveText('Run 2', { timeout: 15_000 });
      // Nothing selected: the follow-up works on the session's own section.
      await page.keyboard.press('Escape');
      await expect(page.locator('#scopeRow .chip.all, #scopeRow .chip.from')).toHaveCount(1);
      await expect(page.locator('#runbar b')).toHaveText('Run 2');
      const chip = page.locator('#followChip');
      await expect(chip).toHaveText('Follow-up to run 2');
      await expect(page.locator('#scopeRow .chip.from > span')).toHaveText(['apps/']);
      await chip.click();
      await expect(page.locator('#followMenu [data-follow]')).toHaveText([
        'Run 2 · Hermes · Tidy the app. edit:apps/console/main.ts',
        'Run 1 · Hermes · Tidy the log. edit:shared/log.ts',
        'Start a new session instead',
      ]);
      await page.locator('#followMenu [data-follow="1"]').click();
      await expect(page.locator('#runbar b')).toHaveText('Run 1');
      await expect(chip).toHaveText('Follow-up to run 1');
      await expect(page.locator('#scopeRow .chip.from > span')).toHaveText(['shared/']);
      await run(page, 'And the allowlist. edit:shared/allowlist.ts');
      await expect(page.locator(TOAST)).toHaveText('Hermes started run 3');
      const third = ((await call(b, '/api/state')).body as unknown as StateResponse).runs.find(r => r.id === 3)!;
      expect(third).toMatchObject({ resumeFrom: 1, scope: ['shared/'] });
      // A new session instead: no follow-up, and the selection (none: the whole repository) is the scope.
      await expect(page.locator('#runbar b')).toHaveText('Run 3', { timeout: 15_000 });
      await chip.click();
      await page.locator('#followMenu [data-follow="new"]').click();
      await expect(chip).toHaveText('New session');
      await expect(page.locator('#scopeRow .chip.all')).toHaveText('Whole repository');
    }));

  test('a reload mid-run brings back every session: its section, its colour, its state', async ({ page }) =>
    withHermes(page, async () => {
      await folder(page, 'shared').click();
      await run(page, 'edit:shared/log.ts wait:a');
      await folder(page, 'apps').click();
      await run(page, 'edit:apps/console/main.ts wait:b');
      await expect(running(page)).toHaveCount(2);
      // Run 1 stops; run 3 takes the colour it had, so colours aren't simply in order.
      await page.locator('#sideList [data-run="1"] [data-stop]').click();
      // Released once its agent has stopped: marked as ended.
      await expect(page.locator('#sels .zone.ended')).toHaveCount(1, { timeout: 10_000 });
      await page.keyboard.press('0');
      await folder(page, 'shared').click();
      await run(page, 'edit:shared/log.ts wait:c');
      await expect(running(page)).toHaveCount(2);
      const look = () =>
        page
          .locator('#sels .zone:not(.ended)')
          .evaluateAll(els =>
            els.map(el => `${el.querySelector('b')?.textContent} ${getComputedStyle(el).outlineColor}`),
          );
      const before = await look();
      expect(before).toHaveLength(2);
      await page.reload();
      await expect(page.locator('#conn')).toHaveText('Live');
      await expect(running(page)).toHaveCount(2);
      await expect(page.locator('#sideList [data-run="2"]')).toContainText('Hermes is working');
      await expect(page.locator('#sideList [data-run="3"]')).toContainText('Hermes is working');
      await expect.poll(look).toEqual(before);
      // Working sessions' cards keep their colour too.
      await expect(page.locator('#sideList [data-run="1"] .tags')).toContainText('Cancelled');
    }));

  test("each session's cost where its harness reports it, and the total for the sessions at work", async ({ page }) =>
    withHermes(page, async () => {
      await folder(page, 'shared').click();
      await run(page, 'edit:shared/log.ts wait:a cost');
      await folder(page, 'apps').click();
      await run(page, 'edit:apps/console/main.ts wait:b cost');
      await expect(running(page)).toHaveCount(2);
      await expect(page.locator('#sideList [data-run="1"] .cost')).toHaveText('$0.004');
      await expect(page.locator('#sessionsCost')).toHaveText('$0.008 so far');
    }));

  test('a session that finishes while you look elsewhere: a mark in the tab title, and a notification once turned on', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { away: boolean; notes: { title: string; body?: string }[] };
      w.away = false;
      w.notes = [];
      Object.defineProperty(document, 'hidden', { get: () => w.away });
      document.hasFocus = () => !w.away;
      class Recorder {
        static permission = 'default';
        static requestPermission = async () => (Recorder.permission = 'granted');
        onclick: (() => void) | null = null;
        constructor(title: string, opts?: { body?: string }) {
          w.notes.push({ title, body: opts?.body });
        }
      }
      (window as unknown as { Notification: unknown }).Notification = Recorder;
    });
    await withHermes(page, async repo => {
      const title = await page.title();
      await page.locator('#notifyBtn').click();
      await expect(page.locator('#notifyBtn')).toHaveAttribute('aria-pressed', 'true');
      await folder(page, 'shared').click();
      await run(page, 'Tidy the log. edit:shared/log.ts wait:a');
      await expect(running(page)).toHaveCount(1);
      await page.evaluate(() => {
        (window as unknown as { away: boolean }).away = true;
        document.dispatchEvent(new Event('visibilitychange'));
      });
      go(repo, 'a');
      await expect.poll(() => page.title(), { timeout: 15_000 }).toBe(`(1) ${title}`);
      expect(await page.evaluate(() => (window as unknown as { notes: unknown[] }).notes)).toEqual([
        { title: 'Run 1 finished', body: 'Tidy the log. edit:shared/log.ts wait:a' },
      ]);
      // Back: the mark goes.
      await page.evaluate(() => {
        (window as unknown as { away: boolean }).away = false;
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect.poll(() => page.title()).toBe(title);
    });
  });

  test('a session finishing while another is reviewed leaves the view where it is', async ({ page }) =>
    withHermes(page, async repo => {
      await folder(page, 'shared').click();
      await run(page, 'edit:shared/log.ts wait:a');
      await expect(running(page)).toHaveCount(1);
      await folder(page, 'apps').click();
      await run(page, 'edit:apps/console/main.ts wait:c');
      await expect(running(page)).toHaveCount(2);
      // The first to finish opens, and the map flies to it.
      go(repo, 'a');
      await expect(page.locator('#runbar b')).toHaveText('Run 1', { timeout: 15_000 });
      await expect(page.locator('[data-mode="diff"]')).toHaveAttribute('aria-checked', 'true');
      const view = page.locator('#world');
      await expect(async () => {
        const at = await view.getAttribute('style');
        await page.waitForTimeout(300);
        expect(await view.getAttribute('style')).toBe(at);
      }).toPass();
      const at = await view.getAttribute('style');
      // The second finishing while run 1 is reviewed: listed as done, and nothing moves.
      go(repo, 'c');
      await expect(running(page)).toHaveCount(0, { timeout: 15_000 });
      await expect(page.locator('#sideList [data-run="2"]')).toBeVisible();
      await expect(page.locator('#runbar b')).toHaveText('Run 1');
      expect(await view.getAttribute('style')).toBe(at);
    }));

  test('while a session works, files outside its section stay editable and files inside it wait', async ({ page }) =>
    withHermes(page, async repo => {
      await folder(page, 'shared').click();
      await run(page, 'edit:shared/log.ts wait:a');
      await expect(running(page)).toHaveCount(1);
      const open = async (file: string) => {
        await page.keyboard.press('Escape');
        await page.locator(`.fr[data-path="${file}"]`).click();
        await page.keyboard.press('Enter');
        await expect(page.locator('#editor .cm-content')).toBeFocused();
      };
      await open('shared/allowlist.ts');
      await expect(page.locator('#editorBlocked')).toHaveText('Run 1 is working. Editing waits until it finishes.');
      await expect(page.locator('#editor .cm-content')).toHaveAttribute('aria-readonly', 'true');
      await page.keyboard.press('Escape');
      await open('apps/console/main.ts');
      await expect(page.locator('#editorBlocked')).toHaveCount(0);
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.type('// saved beside the session');
      await page.keyboard.press('ControlOrMeta+s');
      await expect(page.locator(TOAST)).toHaveText(/^Saved as run \d+$/);
      expect(fs.readFileSync(path.join(repo, 'apps/console/main.ts'), 'utf8')).toContain('// saved beside the session');
      go(repo, 'a');
      await expect(running(page)).toHaveCount(0, { timeout: 15_000 });
    }));

  test('before a run and on its card, plain words say whether the session stays inside the selection', async ({
    page,
  }) =>
    withHermes(
      page,
      async repo => {
        const STAYS = 'Stays inside your selection';
        const FLAGGED = "Can change files outside your selection. You'll see each one flagged.";
        // With nothing selected there is nothing to stay inside: no line.
        await expect(page.locator('#reach')).toHaveCount(0);
        await folder(page, 'shared').click();
        await expect(page.locator('#reach')).toHaveText(SANDBOX ? STAYS : FLAGGED);
        await page.locator('#agentBtn').click();
        await page.locator('#agentMenu [data-agent="codex"]').click();
        await expect(page.locator('#reach')).toHaveText(FLAGGED);
        await page.locator('#agentBtn').click();
        await page.locator('#agentMenu [data-agent="hermes"]').click();
        await run(page, 'Add a header comment. wait:a');
        await expect(running(page).locator('.reach')).toHaveText(SANDBOX ? STAYS : FLAGGED);
        go(repo, 'a');
        await expect(running(page)).toHaveCount(0, { timeout: 15_000 });
      },
      { LOA_CODEX_BIN: FAKE_CODEX },
    ));

  test('a session that wants a file outside its section asks on its card: Allow, and it carries on; held, it says by which run', async ({
    page,
  }) =>
    withHermes(page, async (repo, b) => {
      await folder(page, 'apps').click();
      await run(page, 'edit:apps/console/main.ts wait:a');
      await expect(running(page)).toHaveCount(1);
      await page.keyboard.press('Escape');
      await folder(page, 'shared').click();
      await run(page, 'edit:apps/console/main.ts');
      const card = page.locator('#sideList [data-run="2"]');
      const ask = card.locator('[data-want="apps/console/main.ts"]');
      await expect(ask).toContainText('Wants to change apps/console/main.ts', { timeout: 15_000 });
      await expect(card).toContainText('Hermes is waiting for you');
      // Run 1 holds the file: Allow waits for it, and the card says so.
      await expect(ask.locator('.held')).toHaveText('Run 1 is working on it.');
      await expect(ask.locator('[data-allow]')).toBeDisabled();
      go(repo, 'a');
      await expect(ask.locator('.held')).toHaveCount(0, { timeout: 15_000 });
      await ask.locator('[data-allow]').click();
      await expect(running(page)).toHaveCount(0, { timeout: 15_000 });
      const two = (await call(b, '/api/state')).body as unknown as StateResponse;
      expect(two.runs.find(r => r.id === 2)!.scope).toEqual(['shared/', 'apps/console/main.ts']);
      // Its activity says what was blocked; it carried on from there.
      await card.click();
      await expect(page.locator('#runbar b')).toHaveText('Run 2');
      await expect(page.locator('#insp .acts')).toContainText('Tried to change apps/console/main.ts. Blocked.');
      // Refused: the file stays out, and the card asks no more.
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.keyboard.press('0');
      await folder(page, 'shared').click();
      await run(page, 'edit:apps/console/main.ts');
      const three = page.locator('#sideList [data-run="3"] [data-want="apps/console/main.ts"]');
      await three.locator('[data-refuse]').click();
      await expect(running(page)).toHaveCount(0, { timeout: 15_000 });
      const after = (await call(b, '/api/state')).body as unknown as StateResponse;
      expect(after.runs.find(r => r.id === 3)!.scope).toEqual(['shared/']);
    }));

  onMac(
    'a command that tried to write outside the selection says so on the card, while it works and after',
    async ({ page }) =>
      withHermes(page, async repo => {
        await folder(page, 'shared').click();
        await run(page, 'exec: printf n > notes.md\nedit:shared/log.ts wait:a');
        const line = page.locator('#sideList [data-run="1"] .blocked');
        await expect(line).toHaveText('A command tried to write outside your selection. Blocked.', { timeout: 15_000 });
        go(repo, 'a');
        await expect(running(page)).toHaveCount(0, { timeout: 15_000 });
        await expect(line).toHaveText('A command tried to write outside your selection. Blocked.');
        expect(fs.existsSync(path.join(repo, 'notes.md'))).toBe(false);
      }),
  );

  test('where each session is: a marker on the file its latest step names, on the map and the minimap', async ({
    page,
  }) =>
    withHermes(page, async repo => {
      await folder(page, 'shared').click();
      await run(page, 'edit:shared/log.ts wait:a');
      const one = page.locator('#markers .marker[data-run="1"]');
      await expect(one).toHaveAttribute('data-path', 'shared/log.ts', { timeout: 15_000 });
      await expect(one).toHaveText('Editing');
      await page.keyboard.press('Escape');
      await folder(page, 'apps').click();
      await run(page, 'hold:b edit:apps/console/main.ts');
      // Its first step reads a file outside its section: the marker goes where the session is, wherever that is.
      const two = page.locator('#markers .marker[data-run="2"]');
      await expect(two).toHaveAttribute('data-path', 'shared/allowlist.ts', { timeout: 15_000 });
      await expect(two).toHaveText('Reading');
      await expect(page.locator('#mini')).toHaveAttribute('data-here', '1 shared/log.ts,2 shared/allowlist.ts');
      go(repo, 'b');
      await expect(two).toHaveAttribute('data-path', 'apps/console/main.ts', { timeout: 15_000 });
      go(repo, 'a');
      await expect(running(page)).toHaveCount(0, { timeout: 15_000 });
      await expect(page.locator('#markers .marker')).toHaveCount(0);
      await expect(page.locator('#mini')).toHaveAttribute('data-here', '');
    }));

  test("a session's edits are drawn as they land: the file's changed lines marked while it still works", async ({
    page,
  }) =>
    withHermes(page, async (repo, b) => {
      await folder(page, 'shared').click();
      await run(page, 'edit:shared/log.ts wait:a');
      // Back on the map, as a person watching would be.
      await expect(page.locator('#markers .marker[data-run="1"]')).toHaveAttribute('data-path', 'shared/log.ts', {
        timeout: 15_000,
      });
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      const tile = page.locator('#nodes .fr[data-path="shared/log.ts"]');
      await expect(tile.locator('.tk i.add')).toHaveCount(1);
      // Zoomed in, the card shows the line it added.
      await tile.dblclick();
      const card = page.locator('#nodes .card[data-path="shared/log.ts"]');
      await expect(card.locator('.ln.add')).toContainText('// edited in fake-session-');
      expect(((await call(b, '/api/state')).body as unknown as StateResponse).runs[0]!.status).toBe('running');
      go(repo, 'a');
      await expect(running(page)).toHaveCount(0, { timeout: 15_000 });
      await expect(card.locator('.ln.add')).toHaveCount(1);
    }));

  test("a run's steps as a timeline: when, what, which file; a click shows the file as that step left it", async ({
    page,
  }) =>
    withHermes(page, async () => {
      await folder(page, 'shared').click();
      await run(page, 'edit:shared/log.ts edit:shared/log.ts');
      await expect(running(page)).toHaveCount(0, { timeout: 15_000 });
      await expect(page.locator('#runbar b')).toHaveText('Run 1');
      const rows = page.locator('#timeline [data-step]');
      await expect(rows).toHaveCount(3);
      await expect(rows.nth(0)).toHaveText(/^0:0\dReadshared\/allowlist\.ts$/);
      await expect(rows.nth(1)).toHaveText(/^0:0\dEditedshared\/log\.ts$/);
      // What it touched, at a glance: in words, and on the map the file it only read stays in view, outlined.
      await expect(page.locator('#touched')).toHaveText('Read 1 file · edited 1 file');
      await expect(page.locator('#nodes .fr.read')).toHaveCount(1);
      await expect(page.locator('#nodes .fr.read')).toHaveAttribute('data-path', 'shared/allowlist.ts');
      // The first edit: one line added so far; the second, two.
      await rows.nth(1).click();
      const card = page.locator('#nodes .card[data-path="shared/log.ts"]');
      await expect(card.locator('.at')).toHaveText('At step 2');
      await expect(card.locator('.ln.add')).toHaveCount(1);
      await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
      await rows.nth(2).click();
      await expect(card.locator('.at')).toHaveText('At step 3');
      await expect(card.locator('.ln.add')).toHaveCount(2);
      // A read step goes to its file, as the run left it.
      await rows.nth(0).click();
      await expect(page.locator('#nodes .card .at')).toHaveCount(0);
    }));

  test('following a session: the map goes to each file it turns to, until the person moves the map', async ({ page }) =>
    withHermes(page, async repo => {
      await folder(page, 'shared').click();
      await run(page, 'hold:a edit:shared/log.ts wait:b');
      const follow = page.locator('#sideList [data-run="1"] [data-follow]');
      await expect(page.locator('#markers .marker[data-run="1"]')).toHaveAttribute('data-path', 'shared/allowlist.ts', {
        timeout: 15_000,
      });
      await follow.click();
      await expect(follow).toHaveAttribute('aria-pressed', 'true');
      const centred = (p: string) =>
        expect
          .poll(
            async () => {
              const r = (await page.locator(`#nodes [data-path="${p}"]`).first().boundingBox())!;
              const s = (await page.locator('#stage').boundingBox())!;
              return (
                Math.hypot(r.x + r.width / 2 - (s.x + s.width / 2), r.y + r.height / 2 - (s.y + s.height / 2)) < 60
              );
            },
            { timeout: 5_000 },
          )
          .toBe(true);
      await centred('shared/allowlist.ts');
      go(repo, 'a');
      await centred('shared/log.ts');
      // Moving the map by hand stops following.
      const s = (await page.locator('#stage').boundingBox())!;
      await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
      await page.mouse.down();
      await page.mouse.move(s.x + s.width / 2 + 120, s.y + s.height / 2 + 60, { steps: 4 });
      await page.mouse.up();
      await expect(follow).toHaveAttribute('aria-pressed', 'false');
      go(repo, 'b');
      await expect(running(page)).toHaveCount(0, { timeout: 15_000 });
    }));

  test('one session ending leaves what the others reported since as it was: their cost, their activity', async ({
    page,
  }) =>
    withHermes(page, async repo => {
      await folder(page, 'shared').click();
      await run(page, 'cost hold:h edit:shared/log.ts wait:a');
      await page.keyboard.press('Escape');
      await folder(page, 'apps').click();
      await run(page, 'edit:apps/console/main.ts wait:b');
      // Run 1 reports its cost after run 2 started, and before run 2 ends.
      go(repo, 'h');
      const one = page.locator('#sideList [data-run="1"]');
      await expect(one.locator('.cost')).toHaveText('$0.004', { timeout: 15_000 });
      go(repo, 'b');
      await expect(page.locator('#sideList [data-run="2"]')).not.toHaveClass(/running/, { timeout: 15_000 });
      await expect(one.locator('.cost')).toHaveText('$0.004');
      go(repo, 'a');
      await expect(running(page)).toHaveCount(0, { timeout: 15_000 });
    }));

  test('several sections and one prompt start a session on each; sections that overlap start none', async ({ page }) =>
    withHermes(page, async (repo, b) => {
      await folder(page, 'shared').click();
      await folder(page, 'apps').click({ modifiers: ['Shift'] });
      await expect(page.locator('#scopeRow .chip:not(.all) > span')).toHaveText(['shared/', 'apps/']);
      // One prompt for the sections together stays one run; "a session each" splits it.
      await page.locator('#prompt').fill('Add a header comment. wait:a');
      await page.locator('#eachBtn').click();
      await expect(page.locator(TOAST)).toHaveText('Hermes started runs 1 and 2');
      await expect(running(page)).toHaveCount(2);
      const runs = ((await call(b, '/api/state')).body as unknown as StateResponse).runs;
      expect(runs.map(r => r.scope)).toEqual([['shared/'], ['apps/']]);
      go(repo, 'a');
      // The stand-in edits shared/ whatever its section: the session on apps/ asks, and is refused.
      await answered(b, runs[1]!.id, false);
      await expect(running(page)).toHaveCount(0, { timeout: 15_000 });
      // A file inside a folder also picked: refused, nothing started. (Closing the run that opened, back to the map.)
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.keyboard.press('0');
      await folder(page, 'shared').click();
      await page.locator('.fr[data-path="shared/log.ts"]').click({ modifiers: ['Shift'] });
      await page.locator('#prompt').fill('edit:shared/log.ts');
      await page.keyboard.press('ControlOrMeta+Enter');
      await expect(page.locator(TOAST)).toHaveText(
        "shared/log.ts is inside shared/. Pick sections that don't overlap.",
      );
      await expect(page.locator('#sideList .run')).toHaveCount(2);
    }));
});

test('harnesses the person adds in their own settings are listed by name and run from the map, with their model', async ({
  page,
}) => {
  const repo = makeRepo(),
    settings = path.join(homeOf(repo), '.config/league-of-agents/agents.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(
    settings,
    JSON.stringify([
      { id: 'goose', name: 'Goose', command: [process.execPath, FAKE_ACP] },
      // Not taken: a built-in agent's id, and an id that isn't one.
      { id: 'claude', name: 'Mine', command: [process.execPath, FAKE_ACP] },
      { id: 'Not an id', command: [process.execPath, FAKE_ACP] },
    ]),
  );
  const b = await startBridge(repo);
  try {
    const agents = ((await call(b, '/api/state')).body as unknown as StateResponse).agents;
    expect(agents.goose).toEqual({ name: 'Goose', available: true, stays: false });
    expect(agents.claude!.name).toBe('Claude Code');
    expect(Object.keys(agents)).not.toContain('Not an id');
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await page.locator('#agentBtn').click();
    await page.locator('#agentMenu [data-agent="goose"]').click();
    await expect(page.locator('#agentBtn')).toHaveText('Goose');
    await page.locator('#prompt').fill('Record who reviewed it');
    await page.locator('#prompt').press('Enter');
    await expect(page.locator('#runAgent')).toContainText('Goose · fake-model-1', { timeout: 15_000 });
    await expect(page.locator('#insp .bubble.md').last()).toHaveText('Added reviewedBy to shared/allowlist.ts.');
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
      for (const e of run.stream!) {
        expect(e.text).not.toContain(repo);
        expect(e.text).not.toContain('/repo');
      }
      // Claude Code's verdict on the turn: the last post_turn_summary in the recording wins.
      const verdict = events.filter(e => e.type === 'system' && e.subtype === 'post_turn_summary').at(-1);
      if (verdict) {
        expect(run.turn?.status).toBe(verdict.status_category);
        expect(run.turn?.needs === '').toBe(verdict.needs_action === '');
      }
      const lines = run.stream!.map(e => `${e.t}: ${e.text}`);
      if (name === 'claude-scope-lock-blocked.jsonl') {
        expect(run.turn?.status).toBe('blocked');
        expect(run.turn?.needs).not.toBe('');
        expect(lines).toContain('tool: Edit backend/app/main.py');
        expect(lines).toContain('deny: Tried to change backend/app/main.py. Blocked.');
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
      // Claude Code's own made-up messages carry no real model.
      { type: 'assistant', message: { model: '<synthetic>', content: [] } },
      {
        type: 'assistant',
        message: {
          model: 'claude-sonnet-5-5',
          content: [{ type: 'tool_use', name: 'Read', input: { file_path: path.join(repo, 'shared/log.ts') } }],
        },
      },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'export const log = …' }] } },
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Edit',
              input: {
                file_path: path.join(repo, 'shared/log.ts'),
                old_string: 'export const log = (msg: string) => console.log(`[console] ${msg}`);',
                new_string: 'export const log = (msg: string) => console.log(`[app] ${msg}`);',
              },
            },
          ],
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
    expect(run.model).toBe('claude-sonnet-5-5');
    // The line it wrote with its Edit tool, read from the transcript.
    expect(run.agentLines).toEqual({ 'shared/log.ts': [[0, 0]] });
    expect(run.sessionId).toBe('sess-term');
    expect(run.summary).toBe('Log lines now start with `[app]`.');
    expect(run.stream!.filter(e => e.t === 'tool').map(e => e.text)).toEqual([
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

test('without a sandbox, a file put back after a shell command is named on the run, and restored in one click', async ({
  page,
}) => {
  const repo = makeRepo(),
    b = await startBridge(repo, FAKE_CLAUDE, { LOA_SANDBOX: 'off' });
  try {
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await page.locator('.frame[data-dir="shared"] > .flabel b').click();
    await page.locator('#prompt').fill('Note it. shell:notes.md');
    await page.locator('#prompt').press('Enter');
    await expect(page.locator('#sideList [data-run="1"] .tags')).toContainText('Put back 1 file', { timeout: 15_000 });
    // It opens when it finishes.
    await expect(page.locator('#runbar b')).toHaveText('Run 1');
    const notice = page.locator('#putBack');
    await expect(notice).toContainText('A shell command changed these files outside the section. They were put back');
    await expect(notice.locator('li')).toHaveText(['notes.mdRestore']);
    expect(fs.existsSync(path.join(repo, 'notes.md'))).toBe(false);
    await notice.locator('[data-restore="notes.md"]').click();
    await expect(notice.locator('li')).toHaveText(['notes.mdRestored']);
    expect(fs.readFileSync(path.join(repo, 'notes.md'), 'utf8')).toBe('// written by a shell command\n');
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('a run limited to lines flags changes outside them; a file outside its file is never written', () =>
  watching(async (repo, b) => {
    // The stand-in agent changes line 9 of allowlist.ts, appends to it, and tries to create policy-cache.ts.
    const start = await call(b, '/api/runs', {
      agent: 'claude',
      prompt: 'Only touch loadPolicy',
      scope: ['shared/allowlist.ts:3-5'],
    });
    expect(start.status).toBe(200);
    await expect.poll(async () => (await runsOf(b))[0]?.status, { timeout: 15_000 }).toBe('done');
    const run = (await call(b, `/api/runs/${(await runsOf(b))[0]!.id}`)).body as unknown as RunDTO;
    // In the sandbox the file outside its file is never written; without one it is, and flagged.
    const outside = ['shared/allowlist.ts outside lines 3–5', ...(SANDBOX ? [] : ['shared/policy-cache.ts'])];
    expect(run.outOfScope).toEqual(outside);
    expect(run.stream!.map(e => e.text)).toContain(`Changed outside scope: ${outside.join(', ')}`);
    expect(fs.existsSync(path.join(repo, 'shared/policy-cache.ts'))).toBe(!SANDBOX);
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
    // The stand-in agent changed line 9, flagged on the run and in its review; the file it tried to create, the
    // sandbox refused, or without one, it is flagged too.
    expect(run!.outOfScope).toEqual([
      'shared/allowlist.ts outside lines 3–5',
      ...(SANDBOX ? [] : ['shared/policy-cache.ts']),
    ]);
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

/**
 * A repo with a 600-line file, a 5,000-line one, and a run that changed the first's 5th, 300th and 596th lines (watch
 * mode records it), open in Diff.
 */
async function longRun(page: Page, bridge?: string) {
  const repo = makeRepo(),
    FILE = 'shared/long.ts';
  const lines = Array.from({ length: 600 }, (_, i) => `export const v${i + 1} = ${i + 1};`);
  fs.writeFileSync(path.join(repo, FILE), lines.join('\n') + '\n');
  // Longer than the 4,000 lines a run keeps of a file in the state.
  fs.writeFileSync(path.join(repo, 'shared/big.ts'), Array.from({ length: 5000 }, (_, i) => `// ${i + 1}\n`).join(''));
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'long');
  const b = await startBridge(repo, undefined, { LOA_QUIET_MS: String(QUIET) }, ['--no-hooks'], bridge);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(bridge ? `${APP}/#bridge=${b.port}&t=${b.token}` : linkFor(b));
  await expect(page.locator('#conn')).toHaveText('Live');
  const edited = lines.slice();
  for (const n of [5, 300, 596]) edited[n - 1] = `export const v${n} = ${n * 10};`;
  fs.writeFileSync(path.join(repo, FILE), edited.join('\n') + '\n');
  await expect.poll(async () => (await runsOf(b)).length, { timeout: 15_000 }).toBe(1);
  await page.locator('[data-tab="runs"]').click();
  await page.locator('#sideList [data-run="1"]').click();
  await expect(page.locator('#runbar b')).toHaveText('Run 1');
  await page.locator('[data-mode="diff"]').click();
  // Open it: select its card, then Enter.
  await page.locator(`.card[data-path="${FILE}"]`).click();
  await page.keyboard.press('Enter');
  await expect(page.locator('#editor .cm-content')).toBeVisible();
  return { repo, b, FILE };
}

test('a file opened during a run shows the whole file in Before, After and Diff, its changes marked, filling the stage', async ({
  page,
}) => {
  const { repo, b, FILE } = await longRun(page);
  try {
    // The opened file fills the stage beside the sidebar, above the composer: not a small centred box.
    const stage = (await page.locator('#stage').boundingBox())!,
      box = (await page.locator('#editor').boundingBox())!;
    expect(box.width).toBeGreaterThan(stage.width - 300);
    expect(box.height).toBeGreaterThan(stage.height - 160);
    // Diff: the run's changes on the whole file, read only, scrolled to the first one.
    await expect(page.locator('#editorRunView')).toContainText('Run 1');
    await expect(page.locator('#editor .cm-content')).toHaveAttribute('aria-readonly', 'true');
    await expect(page.locator('#editor .cm-added').first()).toHaveText('export const v5 = 50;');
    await expect(page.locator('#editor .cm-removed').first()).toHaveText('export const v5 = 5;');
    // The last change, near line 596 of 600, is there too.
    await page.locator('#editor .cm-content').click();
    await page.keyboard.press('ControlOrMeta+End');
    await expect(page.locator('#editor .cm-added').last()).toHaveText('export const v596 = 5960;');
    await expect(page.locator('#editor .cm-gutterElement').last()).toHaveText('600');
    // After: the file as the run left it, its new lines marked, no removed lines.
    await page.locator('[data-mode="after"]').click();
    await expect(page.locator('#editor .cm-removed')).toHaveCount(0);
    await expect(page.locator('#editor .cm-added').first()).toHaveText('export const v5 = 50;');
    // Before: the file as the run found it, the lines it replaced marked.
    await page.locator('[data-mode="before"]').click();
    await expect(page.locator('#editor .cm-added')).toHaveCount(0);
    await expect(page.locator('#editor .cm-deleted').first()).toHaveText('export const v5 = 5;');
    // One click edits the file as it is now.
    await page.locator('#editFile').click();
    await expect(page.locator('#editorRunView')).toHaveCount(0);
    await expect(page.locator('#editor .cm-content')).toHaveAttribute('aria-readonly', 'false');
    // The bridge hands over the whole file as the run found it, past the 4,000 lines a run keeps in the state.
    fs.appendFileSync(path.join(repo, 'shared/big.ts'), '// 5001\n');
    await expect.poll(async () => (await runsOf(b)).length, { timeout: 15_000 }).toBe(2);
    const before = await call(b, `/api/runs/2/before?path=${encodeURIComponent('shared/big.ts')}`);
    expect((before.body.text as string).split('\n').length).toBe(5001);
    expect((await call(b, `/api/runs/2/before?path=${encodeURIComponent(FILE)}`)).status).toBe(404);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test("on a 0.1.3 bridge, a file opened during a run still shows the run's changes", async ({ page }) => {
  const { repo, b } = await longRun(page, publishedBridge('0.1.3'));
  try {
    await expect(page.locator('#editor .cm-added').first()).toHaveText('export const v5 = 50;');
    await expect(page.locator('#editor .cm-removed').first()).toHaveText('export const v5 = 5;');
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
  expect(Object.keys(claude.hooks).sort()).toEqual([
    'PostToolUse',
    'PreToolUse',
    'SessionEnd',
    'Stop',
    'UserPromptSubmit',
  ]);
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
      await page.route('**/api/state?*', async route => {
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
      "Update your bridge. It's an older version. It still works; 0.1.3 or later has fixes.",
    );
    await reporting('0.1.2');
    await expect(banner).toContainText("It's version 0.1.2. It still works; 0.1.3 or later has fixes.");
    await expect(page.locator('#updateCommand')).toHaveText('npx leagueofagents-cli@latest');
    // It takes the hint's place, and closes for this connection.
    await expect(page.locator('#tip')).toBeHidden();
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({ path: test.info().outputPath(`update-banner-${theme}.png`) });
    }
    await page.locator('#closeUpdate').click();
    await expect(banner).toHaveCount(0);
    await reporting('0.1.3');
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
    expect(out).toContain('- the checks you allowed for it');
    expect(fs.existsSync(allowedChecksFile(repo))).toBe(false);
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
  // The privacy pair as written, in the page and in its description.
  const pair = 'League of Agents never uploads your code anywhere. Your code goes only to the agent you authorized.';
  await expect(page.locator('main p').filter({ hasText: 'never uploads' })).toHaveText(pair);
  expect(await page.locator('meta[name="description"]').getAttribute('content')).toBe(
    `What League of Agents collects. ${pair}`,
  );
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
  // The person's own Codex hooks, not in git: ours go in beside them, then come out.
  const own = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }, null, 2);
  fs.mkdirSync(path.join(repo, '.codex'));
  fs.writeFileSync(path.join(repo, '.codex/hooks.json'), own);
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
    expect(git(repo, 'status', '--porcelain')).toBe('?? .codex/\n');
    await settled();
    expect(await runsOf(b)).toEqual([]);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// Runs are kept while they're among the newest 500 or from the last 30 days; older ones go, refs and files.
test('old runs are pruned: past the newest 500 and older than 30 days, with their snapshots', async () => {
  const repo = makeRepo();
  const head = git(repo, 'rev-parse', 'HEAD').trim();
  fs.mkdirSync(path.join(repo, '.loa/runs'), { recursive: true });
  const day = 86400000;
  const refs: string[] = [];
  for (let id = 1; id <= 600; id++) {
    // Runs 1 to 50 are recent; the rest are 40 days old.
    const endedAt = id <= 50 ? Date.now() - day : Date.now() - 40 * day;
    const run = {
      id,
      agent: 'detected',
      title: `Run ${id}`,
      prompt: '',
      scope: [],
      status: 'done',
      startedAt: endedAt - 1000,
      endedAt,
      before: head,
      after: head,
      changes: [],
      checks: [],
      stream: [],
    };
    fs.writeFileSync(path.join(repo, `.loa/runs/${id}.json`), JSON.stringify(run));
    fs.writeFileSync(path.join(repo, `.loa/runs/${id}.stream.jsonl`), '{}\n');
    refs.push(`create refs/loa/runs/${id}/before ${head}`, `create refs/loa/runs/${id}/after ${head}`);
  }
  execFileSync('git', ['update-ref', '--stdin'], { cwd: repo, input: refs.join('\n') + '\n' });
  const b = await startBridge(repo, undefined, {}, ['--no-hooks']);
  try {
    const ids = (await runsOf(b)).map(r => r.id);
    // The oldest 100 by number are past the newest 500; of those, 51 to 100 are also older than 30 days.
    expect(ids).toHaveLength(550);
    expect(ids.slice(0, 50)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(ids[50]).toBe(101);
    const left = git(repo, 'for-each-ref', '--format=%(refname)', 'refs/loa/runs/').trim().split('\n');
    expect(left).toHaveLength(1100);
    expect(left).not.toContain('refs/loa/runs/51/before');
    expect(fs.existsSync(path.join(repo, '.loa/runs/51.json'))).toBe(false);
    expect(fs.existsSync(path.join(repo, '.loa/runs/51.stream.jsonl'))).toBe(false);
    expect(fs.existsSync(path.join(repo, '.loa/runs/50.json'))).toBe(true);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// When watch mode can't start (on Linux, the limit on watched folders), edits outside a run go unrecorded: the
// app says so, and how to fix the limit. The bridge's state carries why (watchOff), set here on its way.
test('watch mode off: the app says edits outside a run are not recorded, and how to raise the limit', async ({
  page,
}) => {
  const repo = makeRepo(),
    b = await startBridge(repo, FAKE_CLAUDE, {}, ['--no-hooks']);
  try {
    expect((await call(b, '/api/state')).body.watchOff).toBeNull();
    await page.route('**/api/state?*', async route => {
      const res = await route.fetch();
      const body = (await res.json()) as StateResponse;
      await route.fulfill({
        response: res,
        json: { ...body, watchOff: 'the system limit on watched folders is reached' },
      });
    });
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await expect(page.locator('#watchOff')).toHaveText(
      "Edits made outside a run aren't recorded: the system limit on watched folders is reached.",
    );
    await expect(page.locator('#insp')).toContainText('sudo sysctl fs.inotify.max_user_watches=524288');
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// A hook file in git is the team's: the bridge leaves it as it is, so nothing machine-specific shows as a change.
test('a hooks file in git is never edited', async () => {
  const repo = makeRepo();
  const own = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo team' }] }] } }, null, 2);
  fs.mkdirSync(path.join(repo, '.codex'));
  fs.writeFileSync(path.join(repo, '.codex/hooks.json'), own);
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'team hooks');
  const b = await startBridge(repo);
  try {
    expect(b.output()).toContain("Left .codex/hooks.json as it is: it's in git");
    expect(fs.readFileSync(path.join(repo, '.codex/hooks.json'), 'utf8')).toBe(own);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    // The other agents' hooks still go in.
    expect(fs.readFileSync(path.join(repo, '.claude/settings.local.json'), 'utf8')).toContain('hook pre');
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
    // Each says it runs the repo's own code: these commands run what package.json and the tests say.
    await expect(page.locator('#suggestedChecks .repoCode')).toHaveText([
      'Runs the "test" script in this repo\'s package.json.',
      'Runs the "typecheck" script in this repo\'s package.json.',
      "Runs this repo's tests with pytest, and the conftest.py files they load.",
    ]);
    await page.screenshot({ path: test.info().outputPath('checks-offer.png') });
    expect(await runsOf(b)).toEqual([]);
    await page.locator('#enableChecks').click();
    await expect(page.locator('#suggestedChecks')).toHaveCount(0);
    // Kept in the home folder, out of the repo: nothing to commit, and no run.
    expect(JSON.parse(fs.readFileSync(allowedChecksFile(repo), 'utf8')).private).toEqual(found);
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

// A cloned repo's loa.config.json is the repo's, not the person's: its checks are offered with their commands and
// run only after this clone approves that exact list, again whenever the list changes. Before, the first file saved
// after the bridge started ran them.
test("a cloned repo's checks wait for approval, and wait again when they change", async ({ page }) => {
  const repo = makeRepo();
  const ran = path.join(path.dirname(repo), 'ran.txt');
  const times = () => (fs.existsSync(ran) ? fs.readFileSync(ran, 'utf8').split('\n').length - 1 : 0);
  const commitChecks = (name: string) => {
    const checks = [{ name, run: `node -e "require('fs').appendFileSync('../ran.txt', '${name}\\n')"` }];
    fs.writeFileSync(path.join(repo, 'loa.config.json'), JSON.stringify({ checks }));
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qam', 'checks');
    return checks;
  };
  const edit = async (b: Bridge, n: number) => {
    fs.appendFileSync(path.join(repo, 'shared/log.ts'), `export const n${n} = ${n};\n`);
    await expect.poll(async () => (await runsOf(b)).length, { timeout: 10_000 }).toBe(n);
    await settled();
    return (await runsOf(b))[n - 1]!;
  };
  const checks = commitChecks('tests');
  // A fresh clone: nothing approved on this machine.
  fs.rmSync(allowedChecksFile(repo));
  let b = await startBridge(repo, undefined, { LOA_QUIET_MS: String(QUIET) }, ['--no-hooks']);
  try {
    const state = (await call(b, '/api/state')).body;
    expect(state.suggestedChecks).toEqual(checks);
    expect(state.suggestedChecksFrom).toBe('repo');
    expect(state.checksOn).toEqual([]);
    // An edit in an editor is a run, and the repo's command doesn't run.
    expect((await edit(b, 1)).checks).toEqual([]);
    expect(times()).toBe(0);
    await page.goto(linkFor(b));
    await expect(page.locator('#suggestedChecks li')).toHaveCount(1);
    await expect(page.locator('#suggestedChecks li')).toContainText(checks[0]!.run);
    // The whole command shows, never cut off: it's read before it's approved.
    const code = page.locator('#suggestedChecks code');
    expect(await code.evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(
      true,
    );
    await expect(page.locator('#insp')).toContainText("This repo's loa.config.json asks to run these commands");
    await expect(page.locator('#shareChecks')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('repo-checks-offer.png') });
    await page.locator('#enableChecks').click();
    await expect(page.locator('#suggestedChecks')).toHaveCount(0);
    expect(JSON.parse(fs.readFileSync(allowedChecksFile(repo), 'utf8')).approved).toEqual(checks);
    // Approving changes nothing in the repo: only the edit above shows.
    expect(git(repo, 'status', '--porcelain')).toBe(' M shared/log.ts\n');
    // Approved: the next run runs them.
    await edit(b, 2);
    await expect
      .poll(async () => (await runsOf(b))[1]!.checks.map(c => c.name), { timeout: 15_000 })
      .toEqual(['tests']);
    expect(times()).toBe(1);
    // A pull changes the list: it waits for approval again after the next start.
    b.stop();
    const changed = commitChecks('lint');
    b = await startBridge(repo, undefined, { LOA_QUIET_MS: String(QUIET) }, ['--no-hooks']);
    const again = (await call(b, '/api/state')).body;
    expect(again.suggestedChecks).toEqual(changed);
    expect(again.suggestedChecksFrom).toBe('repo');
    expect((await edit(b, 3)).checks).toEqual([]);
    expect(times()).toBe(1);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// A repo can't approve its own checks: approvals live in the home folder, and a repo that commits .loa/ (where
// 0.1.2 kept them, with runs and settings) doesn't start the bridge at all. Its old files left on disk do nothing.
test("a repo that commits .loa/ can't approve its own checks or hand the bridge its runs", async () => {
  const repo = makeRepo();
  const ran = path.join(path.dirname(repo), 'ran.txt');
  const checks = [{ name: 'tests', run: `node -e "require('fs').appendFileSync('../ran.txt', 'ran\\n')"` }];
  fs.writeFileSync(path.join(repo, 'loa.config.json'), JSON.stringify({ checks }));
  fs.rmSync(allowedChecksFile(repo));
  // The approval as 0.1.2's fix kept it, the private list, and a run whose revert would delete a file outside.
  fs.mkdirSync(path.join(repo, '.loa/runs'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.loa/checks-approved.json'), JSON.stringify(checks));
  fs.writeFileSync(path.join(repo, '.loa/checks.json'), JSON.stringify(checks));
  const head = git(repo, 'rev-parse', 'HEAD').trim();
  const victim = path.join(path.dirname(repo), 'victim.txt');
  fs.writeFileSync(victim, 'keep me\n');
  fs.writeFileSync(
    path.join(repo, '.loa/runs/1.json'),
    JSON.stringify({
      id: 1,
      agent: 'claude',
      title: 'Planted',
      prompt: 'Planted',
      scope: [],
      status: 'done',
      startedAt: 1,
      endedAt: 2,
      before: head,
      after: head,
      changes: [{ path: '../victim.txt', created: true, deleted: false, pre: [], hunks: [] }],
      checks: [],
      stream: [],
    }),
  );
  git(repo, 'add', '-A', '-f');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'plant .loa');
  const start = spawnSync(process.execPath, [BRIDGE, 'serve', '--no-hooks', '--no-open'], {
    cwd: repo,
    env: { ...process.env, HOME: homeOf(repo) },
    encoding: 'utf8',
    timeout: 15_000,
  });
  expect(start.status).toBe(1);
  expect(start.stderr).toContain('This repo commits .loa/');
  // Untracked, as a downloaded copy would have them: the bridge starts, and none of it is trusted.
  git(repo, 'rm', '-r', '-q', '--cached', '.loa');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'untrack .loa');
  const b = await startBridge(repo, undefined, { LOA_QUIET_MS: String(QUIET) }, ['--no-hooks']);
  try {
    const state = (await call(b, '/api/state')).body;
    expect(state.suggestedChecksFrom).toBe('repo');
    expect(state.checksOn).toEqual([]);
    fs.appendFileSync(path.join(repo, 'shared/log.ts'), 'export const x = 1;\n');
    await expect.poll(async () => (await runsOf(b)).length, { timeout: 10_000 }).toBe(2);
    await settled();
    expect(fs.existsSync(ran)).toBe(false);
    // Reverting the planted run, even past its conflict, touches nothing outside the repo.
    expect((await call(b, '/api/runs/1/revert', { force: true })).status).toBe(200);
    expect(fs.readFileSync(victim, 'utf8')).toBe('keep me\n');
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
    expect(JSON.parse(fs.readFileSync(allowedChecksFile(repo), 'utf8')).private).toEqual([]);
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
test('start opens leagueofagents.dev in a Chrome-family default browser, the local app otherwise or with --local', async () => {
  const repo = makeRepo();
  const SITE = 'https://leagueofagents.dev';
  const start = (browser: string, more: string[] = []) =>
    execFileSync(process.execPath, [BRIDGE, 'start', '--no-open', '--no-hooks', ...more], {
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
    // --local: the local app even in Chrome, and the site is never printed. The running bridge, which lets the
    // site in, is replaced.
    const only = start('com.google.Chrome', ['--local']);
    const lb = JSON.parse(fs.readFileSync(path.join(repo, '.loa/bridge.json'), 'utf8')) as Bridge;
    expect(only).toContain(`Open    http://127.0.0.1:${lb.port}/#t=${lb.token}`);
    expect(only).not.toContain(SITE);
    // And the site can't reach it.
    const fromSite = await fetch(`http://127.0.0.1:${lb.port}/api/state`, {
      headers: { authorization: 'Bearer ' + lb.token, origin: SITE },
    });
    expect(fromSite.status).toBe(403);
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
