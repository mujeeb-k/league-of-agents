// The interaction inventory: every interactive element in every state that applies, in both
// themes, laid out as one contact sheet per theme in test-results/states/. Run with `npm run states`.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { makeRepo, startBridge } from '../support/live';
import { APP } from '../support/targets';

const OUT = path.resolve('test-results/states');
const STATES = ['default', 'hover', 'pressed', 'focus', 'disabled', 'loading', 'selected'] as const;
type State = (typeof STATES)[number];
type Setup = (page: Page) => Promise<unknown>;
/** How to put an element into a state: 'auto' for the generic way, or a setup run before the shot. */
type Element = { name: string; at: string; states: Partial<Record<State, 'auto' | Setup>>; prep?: Setup };

const auto = { default: 'auto', hover: 'auto', pressed: 'auto', focus: 'auto' } as const;
const DEMO: Element[] = [
  { name: 'View toggle (Diff)', at: '[data-mode="diff"]', states: { ...auto, selected: p => p.keyboard.press('d') } },
  { name: 'Close run', at: '[data-act="closeRun"]', states: auto },
  {
    name: 'Sidebar toggle',
    at: '#sideBtn',
    states: { ...auto, selected: p => p.keyboard.press('j') },
  },
  { name: 'Connect', at: '#connectBtn', states: auto },
  { name: 'Theme', at: '#themeBtn', states: auto },
  {
    name: 'Agent picker',
    at: '#agentBtn',
    states: { ...auto, selected: p => p.locator('#agentBtn').click() },
  },
  {
    name: 'Agent menu item',
    at: '#agentMenu [data-agent="codex"]',
    prep: p => p.locator('#agentBtn').click(),
    states: { default: 'auto', hover: 'auto', selected: p => p.keyboard.press('ArrowDown') },
  },
  {
    name: 'Prompt',
    at: '#prompt',
    states: { default: 'auto', hover: 'auto', focus: 'auto' },
  },
  {
    name: 'Send',
    at: '#sendBtn',
    states: {
      disabled: 'auto',
      default: p => p.locator('#prompt').fill('Add a retry budget'),
      hover: p => p.locator('#prompt').fill('Add a retry budget'),
      pressed: p => p.locator('#prompt').fill('Add a retry budget'),
      focus: p => p.locator('#prompt').fill('Add a retry budget'),
    },
  },
  {
    name: 'Scope chip remove',
    at: '#scopeRow [data-unsel]',
    // The demo opens on its latest run's code (camera.ts openingView); tiles show from fit-all.
    prep: async p => {
      await p.keyboard.press('0');
      await p.locator('.fr[data-path="server/delivery/rate-limit.ts"]').click();
    },
    states: { default: 'auto', hover: 'auto', pressed: 'auto', focus: 'auto' },
  },
  { name: 'Zoom in', at: '#zIn', states: auto },
  { name: 'Zoom percentage', at: '#zPct', states: auto },
  {
    name: 'Explorer folder',
    at: '#sideList [data-dir="server/api"]',
    prep: p => p.locator('#pinSide').click(),
    states: {
      default: 'auto',
      hover: 'auto',
      focus: 'auto',
      selected: p => p.locator('#sideList [data-dir="server/api"] .nm').click(),
    },
  },
  {
    name: 'Explorer file',
    at: '#sideList [data-path="server/delivery/http-client.ts"]',
    prep: p => p.locator('#pinSide').click(),
    states: {
      default: 'auto',
      hover: 'auto',
      focus: 'auto',
      selected: p => p.locator('#sideList [data-path="server/delivery/http-client.ts"]').click(),
    },
  },
  {
    name: 'Sidebar tab',
    at: '[data-tab="runs"]',
    prep: p => p.locator('#pinSide').click(),
    states: { default: 'auto', hover: 'auto', focus: 'auto', selected: p => p.locator('[data-tab="runs"]').click() },
  },
  {
    name: 'Pin',
    at: '#pinSide',
    prep: p => p.keyboard.press('j'),
    states: { ...auto, selected: p => p.locator('#pinSide').click() },
  },
  {
    name: 'Run card',
    at: '#sideList [data-run="13"]',
    prep: async p => {
      await p.locator('#pinSide').click();
      await p.locator('[data-tab="runs"]').click();
    },
    states: { ...auto, selected: p => p.locator('#sideList [data-run="13"]').click() },
  },
  {
    name: 'Review file',
    at: '.flist li:nth-child(2) [data-fly]',
    states: { ...auto, selected: p => p.locator('.flist li:nth-child(2) [data-fly]').click() },
  },
  {
    name: 'Review check',
    at: '.flist li:nth-child(2) [data-rev]',
    states: { ...auto, selected: p => p.locator('.flist li:nth-child(2) [data-rev]').click() },
  },
  { name: 'Revert run', at: '[data-act="revert"]', states: auto },
  { name: 'Keep', at: '[data-act="keep"]', states: auto },
  {
    name: 'Kept outcome',
    at: '#insp .outcome',
    prep: p => p.locator('[data-act="keep"]').click(),
    states: { selected: 'auto' },
  },
  {
    name: 'Canvas file row',
    at: '.fr[data-path="server/delivery/http-client.ts"]',
    prep: async p => {
      await p.keyboard.press('Escape');
      await p.keyboard.press('0');
    },
    states: {
      default: 'auto',
      hover: 'auto',
      selected: p => p.locator('.fr[data-path="server/delivery/http-client.ts"]').click(),
    },
  },
  {
    name: 'Code card',
    at: '.card[data-path="server/delivery/retry/backoff.ts"]',
    prep: p => p.keyboard.press('j'),
    states: {
      default: async p => p.keyboard.press('j'),
      hover: 'auto',
      selected: p => p.locator('.flist li:nth-child(2) [data-fly]').click(),
    },
  },
  {
    name: 'Copy command (connect screen)',
    at: '#copyCommand',
    prep: p => p.locator('#connectBtn').click(),
    states: { ...auto, selected: p => p.locator('#copyCommand').click() },
  },
  {
    name: 'Connect screen: Connect',
    at: '#connectGo',
    prep: p => p.locator('#connectBtn').click(),
    states: auto,
  },
  {
    name: 'Copy command (inspector)',
    at: '#tryCopy',
    prep: p => p.keyboard.press('Escape'),
    states: { ...auto, selected: p => p.locator('#tryCopy').click() },
  },
  { name: 'I have a link to paste', at: '#tryConnect', prep: p => p.keyboard.press('Escape'), states: auto },
  {
    name: 'Conflict: Open run',
    at: '#conflictDlg [data-slot="dialog-footer"] button:last-child',
    prep: async p => {
      await p.keyboard.press('Escape');
      await p.keyboard.press('0');
      await p.locator('.fr[data-path="server/delivery/dead-letter.ts"]').click();
      await p.locator('#prompt').fill('Log the reason');
      await p.locator('#prompt').press('Enter');
      await expect(p.locator('#runbar b')).toHaveText('Run 15', { timeout: 5000 });
      await p.keyboard.press('ControlOrMeta+k');
      await p.keyboard.type('open run 14');
      await p.keyboard.press('Enter');
      await p.locator('[data-act="revert"]').click();
    },
    states: auto,
  },
  { name: 'Inspector edge', at: '#inspHandle', states: { default: 'auto', hover: 'auto', focus: 'auto' } },
  {
    name: 'Command menu item',
    at: '#palette [cmdk-item]:nth-child(2)',
    prep: p => p.keyboard.press('ControlOrMeta+k'),
    states: { default: 'auto', hover: 'auto', selected: p => p.keyboard.press('ArrowDown') },
  },
];

const away = (p: Page) => p.mouse.move(720, 22);

/** A screenshot of the element with room for rings and shadows, as a data URL. */
async function shot(page: Page, loc: Locator) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const b = (await loc.boundingBox())!;
  const pad = 10;
  const buf = await page.screenshot({
    clip: {
      x: Math.max(0, b.x - pad),
      y: Math.max(0, b.y - pad),
      width: Math.min(b.width, 340) + pad * 2,
      height: Math.min(b.height, 220) + pad * 2,
    },
  });
  return 'data:image/png;base64,' + buf.toString('base64');
}

async function capture(page: Page, el: Element, state: State, how: 'auto' | Setup) {
  if (el.prep) await el.prep(page);
  const loc = page.locator(el.at).first();
  if (how !== 'auto') await how(page);
  await expect(loc).toBeVisible({ timeout: 3000 });
  if (state === 'hover') await loc.hover();
  else if (state === 'focus') {
    await page.keyboard.press('Shift');
    await loc.focus();
  } else if (state === 'pressed') {
    await loc.hover();
    await page.mouse.down();
  } else await away(page);
  const url = await shot(page, loc);
  if (state === 'pressed') {
    await away(page);
    await page.mouse.up();
  }
  return url;
}

/** Default, hover and focus of an element on a page that has to stay as it is (live states). */
async function live(page: Page, loc: Locator) {
  await away(page);
  const row: Partial<Record<State, string>> = { default: await shot(page, loc) };
  await loc.hover();
  row.hover = await shot(page, loc);
  await page.keyboard.press('Shift');
  await loc.focus();
  row.focus = await shot(page, loc);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  return row;
}

function sheet(theme: string, rows: Map<string, Partial<Record<State, string>>>) {
  const cell = (u?: string) => (u ? `<td><img src="${u}"></td>` : '<td class="na">—</td>');
  return `<!doctype html><html data-theme="${theme}"><head><style>
    body{margin:0;padding:24px;font:13px 'IBM Plex Sans',system-ui,sans-serif;background:${theme === 'dark' ? '#0e0e10' : '#fafafa'};color:${theme === 'dark' ? '#ededef' : '#18181b'}}
    h1{font-size:15px;margin:0 0 16px} table{border-collapse:collapse} th,td{padding:8px;border:1px solid ${theme === 'dark' ? '#26262a' : '#e4e4e7'};vertical-align:middle}
    th{font-weight:500;text-align:left} td.na{color:#8a8a93;text-align:center} img{display:block;max-width:360px;max-height:240px}
  </style></head><body><h1>Interactive elements by state, ${theme} theme</h1><table>
    <tr><th>Element</th>${STATES.map(s => `<th>${s}</th>`).join('')}</tr>
    ${[...rows].map(([n, r]) => `<tr><th>${n}</th>${STATES.map(s => cell(r[s])).join('')}</tr>`).join('')}
  </table></body></html>`;
}

test.describe.configure({ mode: 'serial' });
fs.mkdirSync(OUT, { recursive: true });

for (const theme of ['light', 'dark'] as const)
  test(`states, ${theme}`, async ({ browser }) => {
    test.setTimeout(600_000);
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: theme,
      reducedMotion: 'reduce',
    });
    // Every page starts from defaults: no panel or theme choice carried over from the page before.
    await ctx.addInitScript(() => localStorage.clear());
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    const rows = new Map<string, Partial<Record<State, string>>>();
    // Demo-mode elements: a fresh page for every state, so states never leak into each other.
    for (const el of DEMO) {
      const row: Partial<Record<State, string>> = {};
      for (const [state, how] of Object.entries(el.states) as [State, 'auto' | Setup][]) {
        const page = await ctx.newPage();
        await page.goto(APP);
        await page.locator('#insp section').first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        row[state] = await capture(page, el, state, how);
        await page.close();
      }
      rows.set(el.name, row);
    }
    // Live-only states: loading and running, against a real bridge with slowed responses.
    const repo = makeRepo();
    const b = await startBridge(repo);
    try {
      const page = await ctx.newPage();
      const hold = (pattern: string, method = 'POST') => {
        let release = () => {};
        const gate = new Promise<void>(r => (release = r));
        void page.route(pattern, async route => {
          if (route.request().method() === method) await gate;
          await route.continue();
        });
        return release;
      };
      await page.goto(APP);
      await page.locator('#insp section').first().waitFor();
      let release = hold('**/api/state', 'GET');
      await page.locator('#connectBtn').click();
      await page.locator('#connectInput').fill(`http://127.0.0.1:${b.port}/#t=${b.token}`);
      await page.locator('#connectInput').press('Enter');
      await expect(page.locator('#conn')).toHaveText('Connecting');
      rows.get('Connect')!.loading = await shot(page, page.locator('#conn'));
      rows.get('Connect screen: Connect')!.loading = await shot(page, page.locator('#connectGo'));
      release();
      await expect(page.locator('#conn')).toHaveText('Live');
      release = hold('**/api/runs');
      await page.locator('#prompt').fill('Name the action and origin in allowlist errors');
      await page.locator('#prompt').press('Enter');
      await expect(page.locator('#sendBtn .spin')).toBeVisible();
      rows.get('Send')!.loading = await shot(page, page.locator('#sendBtn'));
      release();
      const card = page.locator('#sideList [data-run="1"]');
      await expect(page.locator('#sideList .run.running')).toHaveCount(1);
      rows.get('Run card')!.disabled = await shot(page, card);
      await expect(page.locator('[data-act="keep"]')).toBeVisible({ timeout: 15_000 });
      release = hold('**/api/runs/1/keep');
      await page.locator('[data-act="keep"]').click();
      await expect(page.locator('[data-act="keep"]')).toHaveAttribute('aria-busy', 'true');
      rows.get('Keep')!.loading = await shot(page, page.locator('[data-act="keep"]'));
      rows.get('Revert run')!.disabled = await shot(page, page.locator('[data-act="revert"]'));
      release();
      // The live conflict dialog: files changed again after the run.
      await expect(page.locator('#insp .outcome')).toContainText('Kept');
      fs.appendFileSync(path.join(repo, 'shared/allowlist.ts'), '// edited after the run\n');
      // Watch mode records the later edit as run 2; run 1 stays open, and the conflict is on run 1.
      await expect(page.locator('#sideList [data-run="2"]')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('#runbar b')).toHaveText('Run 1');
      await page.locator('[data-act="revert"]').click();
      await expect(page.locator('#conflictDlg')).toBeVisible();
      for (const [name, at] of [
        ['Conflict: Keep my later edits', '#conflictKeep'],
        ['Conflict: Revert anyway', '#conflictRevert'],
      ] as const)
        rows.set(name, await live(page, page.locator(at)));
      await page.keyboard.press('Escape');
      // Offline: the bridge stops answering, and Connect becomes Reconnect.
      b.stop();
      await expect(page.locator('#conn')).toHaveText('Offline', { timeout: 15_000 });
      rows.set('Reconnect (offline)', await live(page, page.locator('#connectBtn')));
      // Connecting at startup: the way out to the demo.
      const b2 = await startBridge(makeRepo());
      try {
        const start = await ctx.newPage();
        void start.route('**/api/state', () => {});
        await start.goto(`${APP}/#bridge=${b2.port}&t=${b2.token}`);
        await expect(start.locator('#showDemo')).toBeVisible();
        rows.set('Show the demo meanwhile', await live(start, start.locator('#showDemo')));
        await start.close();
      } finally {
        b2.stop();
      }
    } finally {
      b.stop();
    }
    const page = await ctx.newPage();
    await page.setContent(sheet(theme, rows));
    await page.screenshot({ path: path.join(OUT, `states-${theme}.png`), fullPage: true });
    await ctx.close();
  });
