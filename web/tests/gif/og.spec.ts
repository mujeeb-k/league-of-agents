// The social preview: the wordmark, the line, and the demo's real map with a run's changes. Run with
// `npm run media`. It writes the site's og:image (1200 × 630, public/brand/og.png) and GitHub's social preview
// (1280 × 640, brand/social-preview.png), which is uploaded in the repository's settings.
import fs from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { APP } from '../support/targets';

const OUT = [
  { file: path.resolve('public/brand/og.png'), width: 1200, height: 630 },
  { file: path.resolve('../brand/social-preview.png'), width: 1280, height: 640 },
];
// Inlined: a page set from a string can't load files.
const WORDMARK = fs.readFileSync(path.resolve('../brand/wordmark-600.png')).toString('base64');
const font = (w: number) =>
  `@font-face { font-family: 'IBM Plex Sans'; font-weight: ${w}; src: url(data:font/woff2;base64,${fs
    .readFileSync(path.resolve(`public/fonts/ibm-plex-sans-latin-${w}-normal.woff2`))
    .toString('base64')}) format('woff2'); }`;

test.use({ colorScheme: 'light' });

test('social preview image', async ({ page, browser }) => {
  // The product: the demo's latest run on the map, light theme, at 2× for a sharp crop.
  const app = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  });
  await app.goto(APP);
  await app.locator('#insp section').first().waitFor();
  await app.mouse.move(1279, 799);
  await app.locator('#tip').evaluate(el => el.setAttribute('hidden', ''));
  await app.waitForTimeout(800);
  const shot = (await app.screenshot({ clip: { x: 260, y: 90, width: 620, height: 520 } })).toString('base64');
  await app.close();

  for (const { file, width, height } of OUT) {
    await page.setViewportSize({ width, height });
    await page.setContent(`<!doctype html><html><head>
    <style>
      ${font(400)} ${font(600)}
      body { margin: 0; width: ${width}px; height: ${height}px; background: #f2f2f3; font-family: 'IBM Plex Sans', sans-serif;
             color: #18181b; display: flex; align-items: center; overflow: hidden; }
      .text { width: 520px; padding: 0 0 0 ${72 + width - 1200}px; box-sizing: content-box; }
      .brand { width: 360px; display: block; }
      h1 { font-size: 52px; line-height: 1.08; letter-spacing: -0.02em; margin: 36px 0 22px; font-weight: 600; }
      p { font-size: 24px; color: #52525b; margin: 0; }
      .shot { margin-left: 24px; width: 600px; flex-shrink: 0; height: 504px; border-radius: 16px; overflow: hidden;
              box-shadow: 0 0 0 1px #e4e4e7, 0 24px 60px rgba(0,0,0,.10); background: #fff; }
      .shot img { width: 600px; display: block; }
    </style></head><body>
    <div class="text">
      <img class="brand" src="data:image/png;base64,${WORDMARK}" alt="League of Agents">
      <h1>See every change your agents make.</h1>
      <p>leagueofagents.dev</p>
    </div>
    <div class="shot"><img src="data:image/png;base64,${shot}"></div>
  </body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: file });
  }
});
