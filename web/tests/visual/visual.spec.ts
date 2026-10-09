// Visual baselines of the app. The screenshots in visual.spec.ts-snapshots/ are the approved baselines;
// any visual change fails here until the new screenshots are reviewed and approved
// (npx playwright test --project visual --update-snapshots, then commit them).
import { expect, test, type Page } from '@playwright/test';

type Step = (page: Page) => Promise<void>;
const SCENARIOS: Record<string, Step> = {
  // The opening view (camera.ts openingView): the demo's latest run, where its names read in full.
  'first-view': async () => {},
  'fit-all': async page => {
    await page.keyboard.press('0');
  },
  'run-diff': async page => {
    await page.keyboard.press('d');
    await page.keyboard.press('j');
  },
  'run-before': async page => {
    await page.keyboard.press('b');
    await page.keyboard.press('j');
    await page.keyboard.press('j');
  },
  'review-ring': async page => {
    await page.keyboard.press('d');
    await page.locator('.flist li[data-fly="server/delivery/endpoint-health.ts"]').click();
  },
  'file-selected': async page => {
    await page.keyboard.press('0');
    await page.keyboard.press('Escape');
    await page.locator('.fr[data-path="server/delivery/rate-limit.ts"]').click();
    await page.keyboard.press('f');
  },
  'folder-selected': async page => {
    await page.keyboard.press('0');
    await page.keyboard.press('Escape');
    await page.locator('.frame[data-dir="server/delivery/pipeline"] > .flabel b').click();
  },
  'runs-tab': async page => {
    await page.locator('[data-tab="runs"]').click();
  },
  'agent-menu': async page => {
    await page.locator('#agentBtn').click();
  },
  'connect-dialog': async page => {
    await page.locator('#connectBtn').click();
  },
  explorer: async page => {
    await page.keyboard.press('Escape');
    // Selected with ⌘P, which also opens its folders in the explorer and reveals its row.
    await page.keyboard.press('ControlOrMeta+p');
    await page.keyboard.type('routes endpoints');
    await page.keyboard.press('Enter');
  },
  'quick-open': async page => {
    await page.keyboard.press('ControlOrMeta+p');
    await page.keyboard.type('retry');
  },
  'command-menu': async page => {
    await page.keyboard.press('ControlOrMeta+k');
  },
};

const SIZES = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
];

for (const size of SIZES)
  for (const theme of ['light', 'dark'] as const)
    for (const [name, step] of Object.entries(SCENARIOS)) {
      test(`${name} ${size.width}x${size.height} ${theme}`, async ({ browser }) => {
        const ctx = await browser.newContext({
          viewport: size,
          deviceScaleFactor: 1,
          colorScheme: theme,
          reducedMotion: 'reduce',
        });
        const page = await ctx.newPage();
        await page.goto('/?still');
        await page.locator('#insp section').first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        await step(page);
        await page.mouse.move(size.width - 2, size.height - 2);
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        await expect(page).toHaveScreenshot(`${name}-${size.width}x${size.height}-${theme}.png`, { maxDiffPixels: 0 });
        await ctx.close();
      });
    }

// French runs longest and Chinese needs its own fonts: the same screens in both, on a wide and a phone screen, with
// nothing pushed past the edge.
const LOCALIZED = ['first-view', 'connect-dialog', 'command-menu'] as const;
for (const lang of ['fr', 'zh-CN'])
  for (const size of [
    { width: 1440, height: 900 },
    { width: 375, height: 812 },
  ])
    for (const theme of ['light', 'dark'] as const)
      for (const name of LOCALIZED) {
        test(`${name} ${lang} ${size.width}x${size.height} ${theme}`, async ({ browser }) => {
          const ctx = await browser.newContext({
            viewport: size,
            deviceScaleFactor: 1,
            colorScheme: theme,
            reducedMotion: 'reduce',
          });
          await ctx.addInitScript(l => localStorage.setItem('loa.lang', l), lang);
          const page = await ctx.newPage();
          await page.goto('/?still');
          await page.locator('#insp section, #intro').first().waitFor();
          await page.evaluate(() => document.fonts.ready);
          await expect(page.locator('html')).toHaveAttribute('lang', lang);
          if (name !== 'first-view') await SCENARIOS[name]!(page);
          await page.mouse.move(size.width - 2, size.height - 2);
          await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
            'page wider than the screen',
          ).toBe(0);
          await expect(page).toHaveScreenshot(`${name}-${lang}-${size.width}x${size.height}-${theme}.png`, {
            maxDiffPixels: 0,
          });
          await ctx.close();
        });
      }
