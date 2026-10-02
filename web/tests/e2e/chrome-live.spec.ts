// leagueofagents.dev reaching a bridge in real Chrome, which asks before a site may reach apps on this computer
// (the loopback-network permission). The built app is served at the site's own address, so the browser treats
// it exactly as the live site. Skipped where Chrome isn't installed.
import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRepo, startBridge, type Bridge } from '../support/live';

const SITE = 'https://leagueofagents.dev';
const DIST = path.resolve('dist');
const CHROME = '/Applications/Google Chrome.app';
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

test.skip(!fs.existsSync(CHROME), 'Google Chrome is not installed');

/** Real Chrome with a fresh profile, the permission set as given, and the site served from web/dist. */
async function chrome(permission: 'granted' | 'denied' | null): Promise<BrowserContext> {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'loa-chrome-')), {
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
  });
  await ctx.route(`${SITE}/**`, route => {
    const p = new URL(route.request().url()).pathname;
    if (p.startsWith('/_vercel/')) return route.fulfill({ status: 204 });
    const file = path.join(DIST, p === '/' ? 'index.html' : p);
    if (!file.startsWith(DIST) || !fs.existsSync(file)) return route.fulfill({ status: 404 });
    return route.fulfill({ body: fs.readFileSync(file), contentType: TYPES[path.extname(file)] ?? 'text/plain' });
  });
  if (permission) {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(`${SITE}/privacy.html`);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Browser.setPermission', {
      permission: { name: 'loopback-network' },
      setting: permission,
      origin: SITE,
    });
  }
  return ctx;
}

async function withBridge(fn: (b: Bridge) => Promise<void>) {
  const repo = makeRepo();
  const b = await startBridge(repo, undefined, { LOA_WEB_URL: SITE }, ['--no-hooks']);
  try {
    await fn(b);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
}

test('before Chrome asks, the site explains, and reaches for nothing until Continue', () =>
  withBridge(async b => {
    const ctx = await chrome(null);
    try {
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      const reached: string[] = [];
      page.on('request', r => {
        if (r.url().startsWith('http://127.0.0.1')) reached.push(r.url());
      });
      await page.goto(`${SITE}/#bridge=${b.port}&t=${b.token}`);
      await expect(page.locator('#stageState')).toContainText('Your browser will ask to connect');
      await expect(page.locator('#stageState')).toContainText('Choose Allow.');
      await expect(page.locator('#conn')).toHaveText('Not connected');
      await expect(page.locator('#askLocal')).toHaveAttribute('href', `http://127.0.0.1:${b.port}/#t=${b.token}`);
      await page.screenshot({ path: test.info().outputPath('ask.png') });
      expect(reached).toEqual([]);
      // Continue asks the browser; a headless one can't show the question, so the request goes and is refused.
      await page.locator('#askContinue').click();
      await expect.poll(() => reached.length).toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  }));

test('allowed: the site connects straight away, with no explanation', () =>
  withBridge(async b => {
    const ctx = await chrome('granted');
    try {
      const page = ctx.pages()[0]!;
      await page.goto(`${SITE}/#bridge=${b.port}&t=${b.token}`);
      await expect(page.locator('#conn')).toHaveText('Live');
      await expect(page.locator('#repoName')).toHaveText('sample-repo');
      await page.screenshot({ path: test.info().outputPath('allowed.png') });
    } finally {
      await ctx.close();
    }
  }));

test('blocked: "Can\'t reach your bridge" says why, and "Open the local app" connects', () =>
  withBridge(async b => {
    const ctx = await chrome('denied');
    try {
      const page = ctx.pages()[0]!;
      await page.goto(`${SITE}/#bridge=${b.port}&t=${b.token}`);
      await expect(page.locator('#stageState')).toContainText("Can't reach your bridge");
      await expect(page.locator('#blocked')).toContainText('keep leagueofagents.dev from reaching apps');
      await page.screenshot({ path: test.info().outputPath('blocked.png') });
      await page.locator('#localLink').click();
      await expect(page).toHaveURL(new RegExp(`^http://127\\.0\\.0\\.1:${b.port}/`));
      await expect(page.locator('#conn')).toHaveText('Live');
    } finally {
      await ctx.close();
    }
  }));
