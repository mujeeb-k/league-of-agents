// Every canvas interaction.
import { expect, test, type Page } from '@playwright/test';
import { ZOOMS, checkLevel, zoomTo } from '../support/zoom';
import { TOAST } from '../support/targets';

async function view(page: Page) {
  return page.evaluate(() => {
    const m = document
      .getElementById('world')!
      .style.transform.match(/translate\(([-\d.e]+)px,\s*([-\d.e]+)px\) scale\(([-\d.e]+)\)/)!;
    return { x: +m[1]!, y: +m[2]!, s: +m[3]! };
  });
}
const stageBox = async (page: Page) => (await page.locator('#stage').boundingBox())!;
/** A point on the stage where nothing on the canvas is hit, so clicks land on empty canvas. */
async function emptyPoint(page: Page) {
  const p = await page.evaluate(() => {
    const r = document.getElementById('stage')!.getBoundingClientRect();
    for (let y = r.top + 60; y < r.bottom - 200; y += 10)
      for (let x = r.left + 20; x < r.right - 260; x += 10) {
        const el = document.elementFromPoint(x, y);
        if (el && (el.id === 'stage' || el.id === 'world' || el.id === 'nodes')) return { x, y };
      }
    return null;
  });
  if (!p) throw new Error('no empty canvas point');
  return p;
}
/** Tests that use the sidebar pin it open, so later zooms in the test don't move it out of the way. */
const showSidebar = async (page: Page) => {
  if ((await page.locator('#sideBtn').getAttribute('aria-pressed')) !== 'true') await page.locator('#sideBtn').click();
  else if ((await page.locator('#pinSide').getAttribute('aria-pressed')) !== 'true')
    await page.locator('#pinSide').click();
};
const chips = (page: Page) => page.locator('#scopeRow .chip:not(.all):not(.fu) > span').allTextContents();
const mini = (page: Page) => page.evaluate(() => (document.getElementById('mini') as HTMLCanvasElement).toDataURL());

// The demo opens on its latest run at a readable zoom (camera.ts openingView). These tests start from the
// whole map, as "Fit everything" (0) shows it.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.locator('#insp section').first().waitFor();
  await page.keyboard.press('0');
  await expect(page.locator('#world')).not.toHaveClass(/near/);
});

test("the demo introduces itself: the tagline as the page's only heading, at the top of the inspector", async ({
  page,
}) => {
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('#insp #intro h1')).toHaveText('See every change your agents make.');
  await expect(page.locator('#intro p')).toHaveText(
    'League of Agents is a map of your repo for Claude Code, Codex and Cursor. Select files or lines, give your agent a task, then review its changes.',
  );
  await expect(page.locator('#introCommand')).toHaveText('npx leagueofagents-cli@latest');
  await expect(page.locator('#introStatic')).toHaveCount(0);
});

test('under 860 px, the introduction is a card at the top of the canvas, and closes', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(page.locator('#stage #intro h1')).toHaveText('See every change your agents make.');
  await expect(page.locator('#insp #intro')).toHaveCount(0);
  await expect(page.locator('h1')).toHaveCount(1);
  await page.locator('#closeIntro').click();
  await expect(page.locator('#intro')).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('#insp #intro')).toHaveCount(1);
});

test('the first view is readable: the latest run, at a zoom where its names read in full', async ({ page }) => {
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(size);
    await page.goto('/');
    await page.locator('#insp section').first().waitFor();
    // Code level: every card header shows its full name, and the run's first changed file is on screen.
    await expect(page.locator('#world')).toHaveClass(/near/);
    const card = page.locator('.card[data-path="server/delivery/endpoint-health.ts"]');
    await expect(card).toBeInViewport();
    await expect(card.locator('.fn')).toHaveText('endpoint-health.ts');
    expect(await card.locator('.fn').evaluate(n => n.scrollWidth <= n.clientWidth)).toBe(true);
    // Fit everything still shows the whole map.
    await page.keyboard.press('0');
    await expect(page.locator('#world')).not.toHaveClass(/near/);
    for (const p of ['relay.config.ts', 'server/delivery/pipeline/dispatch.ts'])
      await expect(page.locator(`.fr[data-path="${p}"]`)).toBeInViewport();
  }
});

test('demo boots with the latest run open', async ({ page }) => {
  await expect(page.locator('#repoName')).toHaveText('relay');
  await expect(page.locator('#runbar b')).toHaveText('Run 14');
  await expect(page.locator('[data-mode="diff"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#conn')).toHaveText('Demo');
  await expect(page.locator('#insp .runscope .chip')).toHaveText(['server/delivery/']);
});

test('a long agent reply shows its first lines, cut between two lines; Show all opens it for that run', async ({
  page,
}) => {
  // The clip inside the reply's bubble, which ends at a line's bottom.
  const reply = page.locator('#insp .bubble.md > div');
  // Every line of text is either wholly shown or wholly hidden: none is cut through.
  const cutLines = () =>
    reply.evaluate(el => {
      const box = el.getBoundingClientRect();
      const range = document.createRange();
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let shown = 0,
        cut = 0;
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) {
          if (!r.height || !n.textContent?.trim()) continue;
          if (r.bottom <= box.bottom + 0.5) shown++;
          else if (r.top < box.bottom - 0.5) cut++;
        }
      }
      return { shown, cut };
    });
  await expect(page.locator('#replyMore')).toHaveText('Show all');
  expect(await cutLines()).toMatchObject({ cut: 0 });
  expect((await cutLines()).shown).toBeGreaterThan(0);
  await page.locator('#replyMore').click();
  await expect(page.locator('#replyMore')).toHaveCount(0);
  await expect(reply).toContainText('Removed:');
  // Another run, then back: still open.
  await showSidebar(page);
  await page.locator('[data-tab="runs"]').click();
  await page.locator('#sideList [data-run="13"]').click();
  await page.locator('#sideList [data-run="14"]').click();
  await expect(page.locator('#runbar b')).toHaveText('Run 14');
  await expect(page.locator('#replyMore')).toHaveCount(0);
});

test('with nothing selected, the composer says to select a file or lines, or run on the whole repository', async ({
  page,
}) => {
  const hint = page.locator('#selectHint');
  await expect(hint).toHaveText('Select a file or lines on the map, or describe a change for the whole repository.');
  await page.locator('.fr[data-path="server/delivery/endpoint-health.ts"]').click();
  await expect(hint).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(hint).toHaveCount(1);
});

test('below 700 px the top bar keeps every control on screen without overlaps, in two rows', async ({ page }) => {
  const parts = [
    '#brand',
    '#runbar b',
    '[data-mode="before"]',
    '[data-mode="after"]',
    '[data-mode="diff"]',
    '[data-act="closeRun"]',
    '#connectBtn',
    '#themeBtn',
  ];
  for (const width of [390, 520, 690, 700]) {
    await page.setViewportSize({ width, height: 900 });
    const boxes = await page.evaluate(
      sel => sel.map(s => document.querySelector(s)?.getBoundingClientRect().toJSON() as DOMRect | undefined),
      parts,
    );
    for (const [i, b] of boxes.entries()) {
      expect(b?.width, `${parts[i]} at ${width} px`).toBeGreaterThan(0);
      expect(b!.left).toBeGreaterThanOrEqual(0);
      expect(b!.right).toBeLessThanOrEqual(width);
      for (const [j, c] of boxes.entries())
        if (j > i) {
          const overlap =
            b!.left < c!.right - 1 && c!.left < b!.right - 1 && b!.top < c!.bottom - 1 && c!.top < b!.bottom - 1;
          expect(overlap, `${parts[i]} and ${parts[j]} at ${width} px`).toBe(false);
        }
    }
    const header = (await page.locator('#top').boundingBox())!;
    expect(header.height, `top bar height at ${width} px`).toBe(width < 700 ? 87 : 48);
    // The demo's badge steps aside on narrow screens; the intro and the button say what this is.
    await expect(page.locator('#conn')).toBeVisible({ visible: width >= 700 });
  }
});

test('on a phone, Try it on your code says to use it on a Mac and offers to send the setup line', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  try {
    await page.goto('/');
    expect(await page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches)).toBe(true);
    await page.locator('#connectBtn').click();
    const dialog = page.locator('#connectDlg');
    await expect(dialog.getByRole('heading')).toHaveText('Use it on your Mac');
    await expect(dialog.locator('#setupPrompt')).toHaveText(
      'Read leagueofagents.dev/setup.md and set up League of Agents in this repo.',
    );
    await expect(dialog.locator('#shareSetup, #copySetup')).toHaveCount(1);
    await expect(dialog.locator('#runCommand')).toHaveText('npx leagueofagents-cli@latest');
    await expect(dialog.locator('#connectInput, #connectGo')).toHaveCount(0);
    await dialog.locator('#connectCancel').click();
    await expect(dialog).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('the mark and wordmark reload the page, by click and by keyboard', async ({ page }) => {
  await expect(page.locator('#brand img[alt="League of Agents"]:visible')).toHaveCount(1);
  for (const go of [() => page.locator('#brand').click(), () => page.locator('#brand').press('Enter')]) {
    await page.evaluate(() => ((window as unknown as { loaded: boolean }).loaded = true));
    await Promise.all([page.waitForEvent('load'), go()]);
    expect(await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded)).toBeUndefined();
    await expect(page.locator('#runbar b')).toHaveText('Run 14');
  }
});

test('drag pans the canvas and hides the tip', async ({ page }) => {
  const a = await view(page),
    p = await emptyPoint(page);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 120, p.y + 60, { steps: 4 });
  await page.mouse.up();
  const b = await view(page);
  expect(b.x - a.x).toBeCloseTo(120, 0);
  expect(b.y - a.y).toBeCloseTo(60, 0);
  await expect(page.locator('#tip')).toHaveClass(/gone/);
});

test('wheel pans; ctrl or meta wheel zooms toward the pointer', async ({ page }) => {
  const box = await stageBox(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const a = await view(page);
  await page.mouse.wheel(30, 100);
  const b = await view(page);
  expect(a.x - b.x).toBeCloseTo(30, 0);
  expect(a.y - b.y).toBeCloseTo(100, 0);
  await expect(page.locator('#tip')).toHaveClass(/gone/);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -50);
  await page.keyboard.up('Control');
  expect((await view(page)).s).toBeGreaterThan(b.s);
});

test('while zooming only the transform changes; zoom-dependent sizes apply once it rests', async ({ page }) => {
  const world = page.locator('#world');
  const sizeScale = () => world.evaluate(w => Number(w.style.getPropertyValue('--s')));
  const before = await sizeScale();
  await page.keyboard.press('=');
  const s = (await view(page)).s;
  await expect(world).toHaveClass(/zooming/);
  expect(await sizeScale()).toBeCloseTo(before, 5);
  await expect(world).not.toHaveClass(/zooming/);
  expect(await sizeScale()).toBeCloseTo(s, 5);
});

test('zoom keys, zoom buttons and the percentage button', async ({ page }) => {
  // The first-load view fits beside the sidebar; "Fit everything" fits the whole canvas.
  await page.keyboard.press('0');
  const s0 = (await view(page)).s;
  await page.keyboard.press('=');
  const s1 = (await view(page)).s;
  expect(s1 / s0).toBeCloseTo(1.4, 3);
  await page.keyboard.press('+');
  expect((await view(page)).s / s1).toBeCloseTo(1.4, 3);
  await page.keyboard.press('-');
  expect((await view(page)).s).toBeCloseTo(s1, 5);
  await page.locator('#zIn').click();
  expect((await view(page)).s / s1).toBeCloseTo(1.4, 3);
  await page.locator('#zOut').click();
  expect((await view(page)).s).toBeCloseTo(s1, 5);
  await expect(page.locator('#zPct')).toHaveText(Math.round(s1 * 100) + '%');
  await page.locator('#zPct').click();
  expect((await view(page)).s).toBeCloseTo(s0, 5);
  await page.keyboard.press('=');
  await page.keyboard.press('0');
  expect((await view(page)).s).toBeCloseTo(s0, 5);
});

test('semantic zoom switches at 34% and the dot grid appears above 55%', async ({ page }) => {
  await expect(page.locator('#world')).not.toHaveClass(/near/);
  await expect(page.locator('.card').first()).toBeHidden();
  await expect(page.locator('.fr').first()).toBeVisible();
  while ((await view(page)).s < 0.34) await page.keyboard.press('=');
  await expect(page.locator('#world')).toHaveClass(/near/);
  await expect(page.locator('.card').first()).toBeVisible();
  await expect(page.locator('.fr').first()).toBeHidden();
  await expect(page.locator('#stage')).not.toHaveClass(/grid/);
  while ((await view(page)).s <= 0.55) await page.keyboard.press('=');
  await expect(page.locator('#stage')).toHaveClass(/grid/);
});

// Three designed zoom levels, checked at every zoom in ZOOMS.
test('zoom levels: labels never overlap, names never wrap, and every folder draws its files', async ({ page }) => {
  for (const z of ZOOMS) {
    await zoomTo(page, z);
    const level = await page
      .locator('#world')
      .evaluate(w => (w.classList.contains('near') ? 'code' : w.classList.contains('over') ? 'overview' : 'structure'));
    expect(level).toBe(z < 12 ? 'overview' : z < 34 ? 'structure' : 'code');
    const r = await checkLevel(page);
    expect(r.labels, `labels shown at ${z}%`).toBeGreaterThan(0);
  }
});

test('a tile shows its full name on hover', async ({ page }) => {
  await zoomTo(page, 18);
  const tile = page.locator('.fr[data-path="server/delivery/endpoint-registry.ts"]');
  expect(await tile.locator('.n').evaluate(n => n.scrollWidth > n.clientWidth)).toBe(true);
  await tile.hover();
  await expect(page.locator('#tileName')).toBeVisible();
  await expect(page.locator('#tileName')).toHaveText('endpoint-registry.ts');
  await page.mouse.move(5, 5);
  await expect(page.locator('#tileName')).toBeHidden();
});

test('double click on empty canvas zooms 2x toward the pointer', async ({ page }) => {
  const s0 = (await view(page)).s;
  const p = await emptyPoint(page);
  await page.mouse.dblclick(p.x, p.y);
  expect((await view(page)).s / s0).toBeCloseTo(2, 3);
});

test('double click on a file or folder label selects it and zooms to it', async ({ page }) => {
  await page.keyboard.press('Escape');
  const s0 = (await view(page)).s;
  await page.locator('.fr[data-path="server/delivery/rate-limit.ts"]').dblclick();
  expect(await chips(page)).toEqual(['rate-limit.ts']);
  await expect.poll(async () => (await view(page)).s).toBeCloseTo(1.1, 3);
  await page.keyboard.press('0');
  await page.keyboard.press('Escape');
  await page.locator('.frame[data-dir="server/delivery/pipeline"] > .flabel b').dblclick();
  expect(await chips(page)).toEqual(['server/delivery/pipeline/']);
  await expect.poll(async () => (await view(page)).s).toBeGreaterThan(s0 * 1.5);
});

test('click selects a file or folder, shift or meta adds, empty click clears', async ({ page }) => {
  await page.keyboard.press('Escape'); // close the run
  await page.locator('.fr[data-path="server/delivery/rate-limit.ts"]').click();
  expect(await chips(page)).toEqual(['rate-limit.ts']);
  await expect(page.locator('.fr[data-path="server/delivery/rate-limit.ts"]')).toHaveClass(/sel/);
  await expect(page.locator('#insp h2')).toHaveText('rate-limit.ts');
  await page.locator('.fr[data-path="server/delivery/secrets.ts"]').click({ modifiers: ['Shift'] });
  await page.locator('.fr[data-path="server/delivery/http-client.ts"]').click({ modifiers: ['Meta'] });
  expect(await chips(page)).toEqual(['rate-limit.ts', 'secrets.ts', 'http-client.ts']);
  await page.locator('.fr[data-path="server/delivery/secrets.ts"]').click({ modifiers: ['Shift'] });
  expect(await chips(page)).toEqual(['rate-limit.ts', 'http-client.ts']);
  await page.locator('.frame[data-dir="server/delivery/pipeline"] > .flabel b').click();
  expect(await chips(page)).toEqual(['server/delivery/pipeline/']);
  await expect(page.locator('.selbox:not(.f) b')).toHaveText('5 files');
  const p = await emptyPoint(page);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('#scopeRow .chip.all')).toHaveText('Whole repository');
});

test('import lines show only for the focused file, and the note counts them', async ({ page }) => {
  await page.keyboard.press('Escape');
  const file = 'server/delivery/event-store.ts';
  await page.locator(`.fr[data-path="${file}"]`).click();
  await page.keyboard.press('f');
  await expect(page.locator('#world')).toHaveClass(/near/);
  const on = page.locator('#links .edge.on');
  await page.mouse.move(5, 5);
  const mine = page.locator(`#links .edge[data-a="${file}"], #links .edge[data-b="${file}"]`);
  await expect(on).toHaveCount(await mine.count());
  expect(await mine.count()).toBe(6);
  await expect(page.locator(`.card[data-path="${file}"] .uses`)).toHaveText('imports 1 · used by 5');
  await page.keyboard.press('Escape');
  await expect(on).toHaveCount(0);
  await page.locator(`.card[data-path="${file}"]`).hover();
  await expect(on).toHaveCount(6);
  await page.mouse.move(1430, 450);
  await expect(on).toHaveCount(0);
});

test('clicking the selected file again deselects it', async ({ page }) => {
  const row = page.locator('.fr[data-path="server/delivery/rate-limit.ts"]');
  await row.click();
  await page.waitForTimeout(450); // a second click sooner than this is a double click
  await row.click();
  await expect(page.locator('#scopeRow .chip.all')).toBeVisible();
});

test('shift drag draws a marquee and adds files to scope', async ({ page }) => {
  await page.keyboard.press('Escape');
  const r = (await page.locator('.frame[data-dir="server/delivery/pipeline"]').boundingBox())!;
  await page.keyboard.down('Shift');
  await page.mouse.move(r.x - 4, r.y - 4);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 5 });
  await expect(page.locator('#marquee')).toBeVisible();
  await page.mouse.move(r.x + r.width + 4, r.y + r.height + 4, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.locator('#marquee')).toBeHidden();
  expect(await chips(page)).toEqual([
    'dispatch.ts',
    'build-payload.ts',
    'sign-request.ts',
    'send-request.ts',
    'record-attempt.ts',
  ]);
  await expect(page.locator(TOAST)).toHaveText('5 files added to scope');
});

test('sidebar: tree click selects and flies, tabs switch', async ({ page }) => {
  await showSidebar(page);
  await page.keyboard.press('Escape');
  await page.locator('#sideList .ti[data-path="server/delivery/secrets.ts"]').click();
  await expect(page.locator('#sideList .ti[data-path="server/delivery/secrets.ts"]')).toHaveClass(/sel/);
  expect((await view(page)).s).toBeCloseTo(1.1, 3);
  await page.locator('#sideList .ti[data-dir="server/api"]').click();
  expect(await chips(page)).toEqual(['server/api/']);
  await page.locator('#sideList .ti[data-dir=""]').click();
  expect(await chips(page)).toEqual(['relay/']);
  await page.locator('[data-tab="runs"]').click();
  await expect(page.locator('[data-tab="runs"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#runCount')).toHaveText('3');
  await expect(page.locator('#sideList .run')).toHaveCount(3);
  await page.locator('[data-tab="files"]').click();
  await expect(page.locator('#sideList .ti').first()).toHaveText('relay/');
});

test('explorer: folders open and close; the open run and the selection are revealed', async ({ page }) => {
  await showSidebar(page);
  // The open run's changed files are revealed; untouched folders below the first level start closed.
  await expect(page.locator('#sideList [data-path="server/delivery/retry/backoff.ts"]')).toBeVisible();
  await expect(page.locator('#sideList [data-dir="server/api"]')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#sideList [data-path="server/api/routes/endpoints.ts"]')).toHaveCount(0);
  await page.locator('#sideList [data-dir="server/api"] [data-toggle]').click();
  await expect(page.locator('#sideList [data-dir="server/api"]')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#sideList [data-dir="server/api"] [data-toggle]').click();
  await expect(page.locator('#sideList [data-dir="server/api/routes"]')).toHaveCount(0);
  // Selecting a hidden file on the canvas opens its folders in the explorer.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('.fr[data-path="server/api/routes/endpoints.ts"]').click();
  await expect(page.locator('#sideList [data-path="server/api/routes/endpoints.ts"]')).toHaveClass(/sel/);
  // Files and Runs are real tab panels.
  const panel = await page.locator('[data-tab="files"]').getAttribute('aria-controls');
  await expect(page.locator(`#${panel}`)).toHaveAttribute('role', 'tabpanel');
});

test('explorer: arrows move focus, Right and Left open and close, Enter opens a file', async ({ page }) => {
  await showSidebar(page);
  await page.keyboard.press('Escape');
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      return el.dataset.path ?? 'd:' + el.dataset.dir;
    });
  await page.locator('#sideList [data-dir=""]').focus();
  await page.keyboard.press('ArrowDown');
  expect(await focused()).toBe('d:server');
  await page.keyboard.press('ArrowDown');
  expect(await focused()).toBe('d:server/api');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#sideList [data-dir="server/api"]')).toHaveAttribute('aria-expanded', 'true');
  expect(await focused()).toBe('d:server/api');
  await page.keyboard.press('ArrowRight');
  expect(await focused()).toBe('d:server/api/console');
  await page.keyboard.press('ArrowLeft');
  expect(await focused()).toBe('d:server/api');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#sideList [data-dir="server/api"]')).toHaveAttribute('aria-expanded', 'false');
  expect(await focused()).toBe('d:server/api');
  await page.keyboard.press('End');
  expect(await focused()).toBe('relay.config.ts');
  // Enter on a file opens it in the editor, with the file as the scope; Escape returns to the explorer.
  await page.keyboard.press('Enter');
  await expect(page.locator('#editor')).toHaveAttribute('aria-label', 'Editing relay.config.ts');
  expect(await chips(page)).toEqual(['relay.config.ts']);
  await page.keyboard.press('Escape');
  await expect(page.locator('#editor')).toHaveCount(0);
  await page.locator('#sideList [data-path="relay.config.ts"]').focus();
  await page.keyboard.press('Home');
  expect(await focused()).toBe('d:');
  await page.keyboard.press('Shift+Enter');
  expect(await chips(page)).toEqual(['relay.config.ts', 'relay/']);
});

test('sidebar steps aside below code zoom; pin, [ and ] and the inspector handle; choices are remembered', async ({
  page,
}) => {
  const side = page.locator('#side');
  const AWAY = /(^|\s)away(\s|$)/;
  await page.reload();
  await page.locator('#insp section').first().waitFor();
  // On first load the sidebar shows, whatever the zoom; the first zoom out fades it.
  await expect(side).not.toHaveClass(AWAY);
  await expect(page.locator('#sideBtn')).toHaveAttribute('aria-pressed', 'true');
  // The demo opens at code zoom (camera.ts openingView); fitting everything zooms out past it.
  await page.keyboard.press('0');
  // Fit zoom shows the tree on the canvas, so the sidebar is out of the way and out of the tab order.
  await expect(side).toHaveClass(AWAY);
  await expect(side).toHaveAttribute('inert', '');
  await expect(page.locator('#sideBtn')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('j');
  await expect(side).not.toHaveClass(AWAY);
  await expect(page.locator('#stage > [data-inset]').first()).toHaveCSS('--inset', '248px');
  await page.keyboard.press('0');
  await expect(side).toHaveClass(AWAY);
  // Pinned, it stays at every zoom.
  await page.locator('#sideBtn').click();
  await page.keyboard.press('Escape');
  await expect(side).not.toHaveClass(AWAY);
  await expect(page.locator('#pinSide')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#pinSide').click();
  await expect(side).toHaveClass(AWAY);
  await page.keyboard.press('[');
  await expect(side).not.toHaveClass(AWAY);
  await page.keyboard.press('[');
  await expect(side).toHaveClass(AWAY);
  await page.keyboard.press('j');
  await expect(side).toHaveClass(AWAY); // closed stays closed when zooming in
  // The inspector hides with ] and resizes by keyboard from its edge.
  const insp = page.locator('#insp');
  await page.keyboard.press(']');
  await expect(insp).toHaveAttribute('inert', '');
  await expect(page.locator('#inspBtn')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press(']');
  await expect(insp).not.toHaveAttribute('inert', '');
  const w0 = (await insp.boundingBox())!.width;
  await page.locator('#inspHandle').focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await insp.boundingBox())!.width).toBe(w0 + 32);
  await page.reload();
  await page.locator('#insp section').first().waitFor();
  expect((await insp.boundingBox())!.width).toBe(w0 + 32);
  await page.keyboard.press('j');
  await expect(side).toHaveClass(AWAY);
});

test('⌘P quick open finds a file, selects it and flies to it; focus returns', async ({ page }) => {
  await page.keyboard.press('Escape');
  await page.locator('#prompt').focus();
  await page.keyboard.press('ControlOrMeta+p');
  await expect(page.locator('#palette [cmdk-input]')).toBeFocused();
  await page.keyboard.type('backoff');
  await expect(page.locator('#palette [cmdk-item]').first()).toHaveAttribute(
    'data-path',
    'server/delivery/retry/backoff.ts',
  );
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette')).toHaveCount(0);
  expect(await chips(page)).toEqual(['backoff.ts']);
  expect((await view(page)).s).toBeCloseTo(1.1, 3);
  await expect(page.locator('#prompt')).toBeFocused();
});

test('⌘K command menu runs commands and closes with Escape', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator('#palette [cmdk-input]')).toBeFocused();
  await page.keyboard.type('show diff');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-mode="diff"]')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('dark theme');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('go to a file');
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette [cmdk-input]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#palette')).toHaveCount(0);
  await expect(page.locator('[data-mode="diff"]')).toHaveAttribute('aria-checked', 'true');
  // From the prompt, the menu returns focus to the prompt.
  await page.locator('#prompt').focus();
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('go to a file');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.locator('#prompt')).toBeFocused();
});

test('sidebar: shift and meta click add to the scope', async ({ page }) => {
  await showSidebar(page);
  await page.keyboard.press('Escape');
  await page.locator('#sideList .ti[data-dir="server/api"]').click();
  await page.locator('#sideList .ti[data-dir="server/storage"]').click({ modifiers: ['Shift'] });
  await page.locator('#sideList .ti[data-path="relay.config.ts"]').click({ modifiers: ['Meta'] });
  expect(await chips(page)).toEqual(['server/api/', 'server/storage/', 'relay.config.ts']);
  await page.locator('#sideList .ti[data-dir="server/storage"]').click({ modifiers: ['Shift'] });
  expect(await chips(page)).toEqual(['server/api/', 'relay.config.ts']);
});

test('scope chip remove button', async ({ page }) => {
  await page.locator('.fr[data-path="server/delivery/rate-limit.ts"]').click();
  await page.locator('[data-unsel="server/delivery/rate-limit.ts"]').click();
  await expect(page.locator('#scopeRow .chip.all')).toBeVisible();
});

test('agent menu opens, picks, and closes on outside click and Escape', async ({ page }) => {
  const menu = page.locator('#agentMenu');
  await expect(menu).toBeHidden();
  await page.locator('#agentBtn').click();
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-agent]')).toHaveText(['Claude Code', 'CursorBeta', 'CodexBeta']);
  await menu.locator('[data-agent="codex"]').click();
  await expect(menu).toBeHidden();
  await expect(page.locator('#agentBtn')).toHaveText('Codex');
  await page.locator('#agentBtn').click();
  await expect(menu).toBeVisible();
  // Radix starts listening for outside clicks one tick after opening; a person is never that fast.
  await page.waitForTimeout(100);
  await page.mouse.click(1300, 400);
  await expect(menu).toBeHidden();
  await page.locator('#agentBtn').click();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  // Keyboard: open with Enter, move with arrows, pick with Enter.
  await page.locator('#agentBtn').focus();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
});

test('prompt: slash focuses, Shift+Enter adds a line, Enter runs, Escape blurs', async ({ page }) => {
  const prompt = page.locator('#prompt'),
    sendBtn = page.locator('#sendBtn');
  await expect(sendBtn).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.locator('.frame[data-dir="server/delivery/pipeline"] > .flabel b').click();
  await page.keyboard.press('/');
  await expect(prompt).toBeFocused();
  await page.keyboard.type('Log every attempt');
  await expect(sendBtn).toBeEnabled();
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('with its status');
  await expect(prompt).toHaveValue('Log every attempt\nwith its status');
  await page.keyboard.press('Escape');
  await expect(prompt).not.toBeFocused();
  await prompt.focus();
  await page.keyboard.press('Enter');
  await expect(prompt).toHaveValue('');
  await expect(page.locator(TOAST)).toHaveText('Claude Code started run 15');
  await expect(page.locator('#sideList .run.running')).toHaveCount(1);
  await expect(page.locator('#runbar b')).toHaveText('Run 15', { timeout: 5000 });
  await expect(page.locator('[data-mode="diff"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#insp .bubble').nth(1)).toHaveText(
    'Changed 3 files inside the scope: dispatch.ts, build-payload.ts, sign-request.ts. Nothing outside it was touched.',
  );
});

test('open a run, close it with the button and with Escape', async ({ page }) => {
  await showSidebar(page);
  await page.locator('[data-tab="runs"]').click();
  await page.locator('#sideList [data-run="12"]').click();
  await expect(page.locator('#runbar b')).toHaveText('Run 12');
  await page.locator('[data-act="closeRun"]').click();
  await expect(page.locator('#runbar .quiet')).toHaveText('Latest state. Open a run to compare before and after.');
  await page.locator('#sideList [data-run="13"]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#runbar .quiet')).toBeVisible();
  await page.locator('#sideList [data-run="13"]').click();
  await page.locator('#sideList [data-run="13"]').click();
  await expect(page.locator('#runbar .quiet')).toBeVisible();
});

test('before, after and diff by click and by B, A, D', async ({ page }) => {
  await page.keyboard.press('j');
  await page.keyboard.press('b');
  await expect(page.locator('[data-mode="before"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.card.ghost[data-path="server/delivery/retry/backoff.ts"]')).toBeVisible();
  await expect(page.locator('.ln.add')).toHaveCount(0);
  await page.keyboard.press('d');
  await expect(page.locator('.card[data-path="server/delivery/retry/schedule-retry.ts"] .ln.add')).toHaveCount(5);
  await expect(page.locator('.card.ghost')).toHaveCount(0);
  await page.locator('[data-mode="after"]').click();
  await expect(page.locator('[data-mode="after"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.ln.del')).toHaveCount(0);
  await page.locator('[data-mode="diff"]').click();
  await expect(page.locator('.card[data-path="server/delivery/dead-letter.ts"] .ln.del')).toHaveCount(2);
});

test('switching views changes lines in place: unchanged lines stay, only new ones fade in', async ({ page }) => {
  await page.keyboard.press('j');
  const card = page.locator('.card[data-path="server/delivery/retry/schedule-retry.ts"]');
  await expect(card.locator('.ln').first()).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { kept: Element }).kept = document.querySelector(
      '.card[data-path="server/delivery/retry/schedule-retry.ts"] .ln:not(.add):not(.del)',
    )!;
  });
  await page.keyboard.press('b');
  await page.keyboard.press('d');
  expect(await page.evaluate(() => (window as unknown as { kept: Element }).kept.isConnected)).toBe(true);
  await expect(card.locator('.ln.fresh')).not.toHaveCount(0);
  await expect(card.locator('.ln.fresh:not(.add):not(.del)')).toHaveCount(0);
});

test('review: J, K and arrows step, R and the check button mark, list click views', async ({ page }) => {
  const cur = page.locator('.flist li.cur .p');
  await page.keyboard.press('j');
  await expect(cur).toHaveText('schedule-retry.ts');
  await page.keyboard.press('j');
  await expect(cur).toHaveText('backoff.ts');
  await page.keyboard.press('ArrowDown');
  await expect(cur).toHaveText('endpoint-health.ts');
  await page.keyboard.press('k');
  await expect(cur).toHaveText('backoff.ts');
  await page.keyboard.press('ArrowUp');
  await expect(cur).toHaveText('schedule-retry.ts');
  await page.keyboard.press('r');
  await expect(page.locator('#insp h3 .num')).toHaveText('1 of 4');
  await expect(page.locator('.chk.on')).toHaveCount(1);
  await page.locator('.chk[data-rev="server/delivery/dead-letter.ts"]').click();
  await expect(page.locator('#insp h3 .num')).toHaveText('2 of 4');
  await expect(page.locator('.flist li.cur .p')).toHaveText('schedule-retry.ts');
  await page.locator('.flist li[data-fly="server/delivery/endpoint-health.ts"]').click();
  await expect(cur).toHaveText('endpoint-health.ts');
  await expect(page.locator('.prog i.on')).toHaveCount(2);
  // Viewing a file in review never changes the scope; the card gets a plain ring instead.
  await expect(page.locator('#scopeRow .chip.all')).toHaveText('Whole repository');
  await expect(page.locator('.selbox')).toHaveCount(0);
  await expect(page.locator('.card.cur')).toHaveAttribute('data-path', 'server/delivery/endpoint-health.ts');
});

test('toasts never cover other UI, and follow the sidebar', async ({ page }) => {
  const clear = async () => {
    const boxes = await page.evaluate(() => {
      const r = (el: Element | null): [number, number, number, number] | null => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return b.width && b.height && getComputedStyle(el).opacity !== '0' ? [b.left, b.top, b.right, b.bottom] : null;
      };
      const side = document.getElementById('side')!;
      return {
        toast: r(document.querySelector('[data-sonner-toast]')),
        others: [
          r(document.getElementById('top')),
          side.classList.contains('away') ? null : r(side),
          r(document.getElementById('insp')),
          r(document.getElementById('composer')),
          r(document.getElementById('nav')),
          document.getElementById('tip')!.classList.contains('gone') ? null : r(document.getElementById('tip')),
        ],
      };
    });
    const t = boxes.toast!;
    for (const o of boxes.others)
      if (o) expect(t[0] < o[2] && t[2] > o[0] && t[1] < o[3] && t[3] > o[1], JSON.stringify([t, o])).toBe(false);
  };
  // Fit zoom, sidebar out of the way.
  await page.locator('[data-act="keep"]').click();
  await expect(page.locator(TOAST)).toHaveText('Kept run 14');
  await clear();
  // Code zoom, sidebar showing: the toast moves clear of it, even while one is on screen.
  await page.keyboard.press('j');
  await expect(page.locator('#side')).not.toHaveClass(/(^|\s)away(\s|$)/);
  await clear();
  await page.locator('[data-act="revert"]').click();
  await expect(page.locator(TOAST)).toHaveText('Reverted run 14');
  await clear();
});

test('keep and revert in demo mode work as in live mode (findings 1 and 31)', async ({ page }) => {
  await expect(page.locator('[data-act="keep"]')).toHaveText('Keep anyway');
  await page.locator('[data-act="keep"]').click();
  await expect(page.locator(TOAST)).toHaveText('Kept run 14');
  // Kept shows as an outcome, not as a button label; revert stays available.
  await expect(page.locator('[data-act="keep"]')).toHaveCount(0);
  await expect(page.locator('#insp .outcome')).toContainText('Kept');
  await page.locator('[data-act="revert"]').click();
  await expect(page.locator(TOAST)).toHaveText('Reverted run 14');
  // The run stays, marked reverted, and its changes are gone from the latest state.
  await expect(page.locator('#runbar b')).toHaveText('Run 14');
  await expect(page.locator('#runCount')).toHaveText('3');
  await expect(page.locator('#insp .outcome')).toContainText('Reverted');
  await page.keyboard.press('Escape');
  await expect(page.locator('.fr[data-path="server/delivery/retry/backoff.ts"]')).toHaveCount(0);
  await showSidebar(page);
  await page.locator('[data-tab="runs"]').click();
  await expect(page.locator('#sideList [data-run="14"]')).toContainText('Reverted');
});

test('demo revert refuses while a later run changed the same files', async ({ page }) => {
  await page.keyboard.press('Escape');
  await page.locator('.fr[data-path="server/delivery/dead-letter.ts"]').click();
  await page.locator('#prompt').fill('Log the reason');
  await page.locator('#prompt').press('Enter');
  await expect(page.locator('#runbar b')).toHaveText('Run 15', { timeout: 5000 });
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('open run 14');
  await page.keyboard.press('Enter');
  await page.locator('[data-act="revert"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#conflictDlg')).toContainText('Run 15 changed these files again');
  // Escape closes it and returns focus to Revert.
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-act="revert"]')).toBeFocused();
  await page.locator('[data-act="revert"]').click();
  await expect(page.locator('#conflictFiles')).toHaveText('server/delivery/dead-letter.ts');
  await page.getByRole('button', { name: 'Open run 15' }).click();
  await expect(page.locator('#runbar b')).toHaveText('Run 15');
});

test('F zooms to the selection, else the run, else everything', async ({ page }) => {
  await page.keyboard.press('0');
  const s0 = (await view(page)).s;
  await page.keyboard.press('f');
  const sRun = (await view(page)).s;
  expect(sRun).not.toBeCloseTo(s0, 3);
  await page.keyboard.press('Escape');
  await page.keyboard.press('f');
  expect((await view(page)).s).toBeCloseTo(s0, 5);
  await page.locator('.fr[data-path="server/delivery/secrets.ts"]').click();
  await page.keyboard.press('f');
  expect((await view(page)).s).toBeCloseTo(1.1, 3);
});

test('Escape closes the menu, then clears the selection, then closes the run', async ({ page }) => {
  await page.locator('.fr[data-path="server/delivery/secrets.ts"]').click();
  await page.locator('#agentBtn').click();
  await expect(page.locator('#agentMenu')).toBeVisible();
  // Each press does one thing: an open menu only closes itself.
  await page.keyboard.press('Escape');
  await expect(page.locator('#agentMenu')).toBeHidden();
  await expect(page.locator('#scopeRow .chip:not(.all)')).toHaveCount(1);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await expect(page.locator('#scopeRow .chip:not(.all)')).toHaveCount(0);
  await expect(page.locator('#runbar b')).toHaveText('Run 14');
  await page.keyboard.press('Escape');
  await expect(page.locator('#runbar .quiet')).toBeVisible();
});

test('minimap click and drag move the view', async ({ page }) => {
  await page.keyboard.press('=');
  await page.keyboard.press('=');
  const a = await view(page),
    before = await mini(page);
  const m = (await page.locator('#mini').boundingBox())!;
  await page.mouse.click(m.x + 30, m.y + 30);
  const b = await view(page);
  expect(b.x).not.toBeCloseTo(a.x, 0);
  expect(b.s).toBeCloseTo(a.s, 6);
  await page.mouse.move(m.x + 30, m.y + 30);
  await page.mouse.down();
  await page.mouse.move(m.x + 150, m.y + 100, { steps: 5 });
  await page.mouse.up();
  const c = await view(page);
  expect(c.x).toBeLessThan(b.x);
  expect(c.y).toBeLessThan(b.y);
  expect(await mini(page)).not.toEqual(before);
});

test('theme toggle switches, redraws the minimap, and is remembered', async ({ page }) => {
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const before = await mini(page);
  await page.locator('#themeBtn').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim()),
  ).toBe('#08080a');
  expect(await mini(page)).not.toEqual(before);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#themeBtn').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('system theme change redraws the minimap', async ({ page }) => {
  const before = await mini(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => mini(page)).not.toEqual(before);
});

test('resize re-applies the view and redraws', async ({ page }) => {
  const before = await mini(page);
  await page.setViewportSize({ width: 1200, height: 760 });
  await expect.poll(() => mini(page)).not.toEqual(before);
});

test('connect screen: the command to copy, errors inline, cancel and Escape', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const dlg = page.locator('#connectDlg');
  await page.locator('#connectBtn').click();
  await expect(dlg).toBeVisible();
  await expect(page.locator('#connectInput')).toBeFocused();
  await expect(page.locator('#runCommand')).toHaveText('npx leagueofagents-cli@latest');
  await page.locator('#copyCommand').click();
  await expect(page.locator('#copyCommand')).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('npx leagueofagents-cli@latest');
  await page.locator('#connectCancel').click();
  await expect(dlg).toBeHidden();
  // Problems show next to the link, in plain words, and the dialog stays open.
  await page.locator('#connectBtn').click();
  await page.locator('#connectInput').fill('not a link');
  await page.locator('#connectGo').click();
  await expect(page.locator('#connectError')).toHaveText(
    'Paste the full link the bridge printed. It starts with http://127.0.0.1.',
  );
  await page.locator('#connectInput').fill('http://127.0.0.1:1/#t=nope');
  await page.locator('#connectInput').press('Enter');
  await expect(page.locator('#connectError')).toHaveText(
    'Could not reach the bridge. Is it running? In Chrome, allow local network access for this site.',
  );
  await expect(dlg).toBeVisible();
  await expect(page.locator('#connectInput')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#conn')).toHaveText('Demo');
  // Escape closes it and returns focus to Connect; reopening starts clean.
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(page.locator('#connectBtn')).toBeFocused();
  await page.locator('#connectBtn').press('Enter');
  await expect(page.locator('#connectInput')).toHaveValue('');
  await expect(page.locator('#connectError')).toHaveCount(0);
});

test('the demo invites you to try it on your code: command, copy, requirements', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.keyboard.press('Escape');
  await expect(page.locator('#tryCommand')).toHaveText('npx leagueofagents-cli@latest');
  await expect(page.locator('#insp')).toContainText("Linux is in testing; Windows isn't supported yet.");
  await page.locator('#tryCopy').click();
  await expect(page.locator('#tryCopy')).toHaveAttribute('aria-label', 'Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('npx leagueofagents-cli@latest');
  await page.locator('#tryConnect').click();
  await expect(page.locator('#connectInput')).toBeFocused();
});

test('a full session by keyboard only, checking focus at every step', async ({ page }) => {
  const focus = () =>
    page.evaluate(() => {
      const e = document.activeElement as HTMLElement;
      return e.id || e.dataset.mode || e.dataset.act || e.dataset.path || e.getAttribute('aria-label') || e.tagName;
    });
  const tab = async (n = 1) => {
    for (let i = 0; i < n; i++) await page.keyboard.press('Tab');
  };
  // The top bar, in order. The sidebar is out of the way at fit zoom, so it is not in the tab order.
  await tab();
  await expect.poll(focus).toBe('brand');
  // The demo opens in Diff: the switch takes focus there, and arrows move between views.
  await tab();
  await expect.poll(focus).toBe('diff');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(focus).toBe('after');
  await page.keyboard.press('Space');
  await expect(page.locator('[data-mode="after"]')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowRight');
  await expect.poll(focus).toBe('diff');
  await page.keyboard.press('Space');
  await expect(page.locator('[data-mode="diff"]')).toHaveAttribute('aria-checked', 'true');
  await tab(2);
  await expect.poll(focus).toBe('sideBtn');
  await tab(3);
  await expect.poll(focus).toBe('themeBtn');

  // Quick open a file; focus comes back to where it was.
  await page.keyboard.press('ControlOrMeta+p');
  await page.keyboard.type('rate limit');
  await page.keyboard.press('Enter');
  expect(await chips(page)).toEqual(['rate-limit.ts']);
  await expect.poll(focus).toBe('themeBtn');

  // Open an earlier run from the command menu, review it, keep it.
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('open run 13');
  await page.keyboard.press('Enter');
  await expect(page.locator('#runbar b')).toHaveText('Run 13');
  await page.keyboard.press('d');
  await page.keyboard.press('j');
  await expect(page.locator('.flist li.cur')).toHaveCount(1);
  await page.keyboard.press('r');
  await expect(page.locator('.flist .chk.on')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('keep run');
  await page.keyboard.press('Enter');
  await expect(page.locator(TOAST)).toHaveText('Kept run 13');

  // The explorer: reviewing zoomed in, the sidebar is showing. Tab into the tree, move and select.
  await expect(page.locator('#side')).not.toHaveAttribute('inert');
  await page.locator('[data-tab="files"]').focus();
  await tab();
  await expect.poll(focus).toBe('pinSide');
  await tab();
  expect(await page.evaluate(() => document.activeElement!.getAttribute('role'))).toBe('tabpanel');
  await tab();
  expect(await page.evaluate(() => document.activeElement!.getAttribute('role'))).toBe('treeitem');
  await page.keyboard.press('Home');
  await page.keyboard.press('End');
  await expect.poll(focus).toBe('relay.config.ts');
  // Enter opens the file in the editor, with the code focused; Escape closes it.
  await page.keyboard.press('Enter');
  await expect(page.locator('#editor .cm-content')).toBeFocused();
  expect(await chips(page)).toEqual(['relay.config.ts']);
  await page.keyboard.press('Escape');
  await expect(page.locator('#editor')).toHaveCount(0);

  // The connect dialog from the command menu, closed with Escape; focus returns to Connect.
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('connect a repo');
  await page.keyboard.press('Enter');
  await expect.poll(focus).toBe('connectInput');
  await page.keyboard.press('Escape');
  await expect.poll(focus).toBe('connectBtn');

  // The prompt: / focuses it, Escape leaves it.
  await page.keyboard.press('/');
  await expect.poll(focus).toBe('prompt');
  await page.keyboard.press('Escape');
  await expect.poll(focus).not.toBe('prompt');

  // Run cards are buttons.
  await page.locator('[data-tab="runs"]').focus();
  await page.keyboard.press('Enter');
  await page.locator('#sideList [data-run="12"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#runbar b')).toHaveText('Run 12');
});

// The editor. A code box opens in place; Esc collapses it and keeps the draft.
test.describe('editor', () => {
  const FILE = 'server/delivery/endpoint-health.ts';
  const openFromCard = async (page: Page) => {
    await page.locator(`.fr[data-path="${FILE}"]`).click();
    await page.keyboard.press('f');
    await expect(page.locator('#world')).toHaveClass(/near/);
    await page.locator(`.card[data-path="${FILE}"]`).dblclick({ position: { x: 80, y: 80 } });
    await expect(page.locator('#editor')).toBeVisible();
    await expect(page.locator('#editor .cm-content')).toBeFocused();
  };

  test('double-click opens a code box in the editor with the full file; Esc collapses it and keeps the draft', async ({
    page,
  }) => {
    await page.keyboard.press('Escape');
    await openFromCard(page);
    await expect(page.locator('#editor')).toHaveAttribute('aria-label', 'Editing endpoint-health.ts');
    await expect(page.locator('#editor .cm-lineNumbers .cm-gutterElement').last()).toHaveText('19');
    await expect(page.locator('#editor .cm-line').first()).toHaveText(
      "import { recentAttempts } from './attempt-log';",
    );
    await expect(page.locator('#editor .tk-k').first()).toHaveText('import');
    await expect(page.locator('#scopeRow .chip:not(.all) > span')).toHaveText(['endpoint-health.ts']);
    // The file's import lines stay visible: what it imports on the right, what uses it on the left.
    const rel = (label: string) => page.locator(`.rel-chip[aria-label^="${label}"]`, {}).locator('span');
    await expect(rel('Imports')).toHaveText(['attempt-log.ts', 'types.ts']);
    await expect(rel('Used by')).toHaveText(['endpoints.ts', 'schedule-retry.ts', 'circuit-breaker.ts']);
    // The demo has no files on disk to open in another editor.
    await expect(page.locator('#openIn')).toHaveCount(0);
    // The minimap and the hint step aside; the composer stays.
    await expect(page.locator('#nav')).toBeHidden();
    await expect(page.locator('#composer')).toBeVisible();
    // Typing makes a draft: a dot in the header, on the card and in the explorer.
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('\nexport const edited = true;');
    await expect(page.locator('#editor header .dirty')).toBeVisible();
    await expect(page.locator('#saveFile')).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('#editor')).toHaveCount(0);
    await expect(page.locator(`.card[data-path="${FILE}"]`)).toHaveClass(/dirty/);
    await showSidebar(page);
    await expect(page.locator(`#sideList [data-path="${FILE}"] .dirty`)).toBeVisible();
    // Enter on the selected file opens it again, with the draft.
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.keyboard.press('Enter');
    await expect(page.locator('#editor .cm-content')).toContainText('export const edited = true;');
    // Undo back to the saved text: no draft.
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('#editor header .dirty')).toHaveCount(0);
    await expect(page.locator('#saveFile')).toBeDisabled();
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(page.locator('#editor header .dirty')).toBeVisible();
    // Discard changes restores the saved text.
    await page.locator('#discardDraft').click();
    await expect(page.locator('#editor .cm-content')).not.toContainText('edited = true');
    await expect(page.locator(`.card[data-path="${FILE}"]`)).not.toHaveClass(/dirty/);
  });

  test('a related file opens from its chip, and the sidebar steps aside while editing', async ({ page }) => {
    await page.keyboard.press('Escape');
    await openFromCard(page);
    await expect(page.locator('#side')).toHaveClass(/(^|\s)away(\s|$)/);
    await page.locator('.rel-chip[data-path="server/delivery/attempt-log.ts"]').click();
    await expect(page.locator('#editor')).toHaveAttribute('aria-label', 'Editing attempt-log.ts');
    await expect(page.locator('#editor .cm-line').first()).toContainText('import');
    await page.keyboard.press('Escape');
    await expect(page.locator('#editor')).toHaveCount(0);
  });

  test('selected lines narrow the scope; ⌘K instructs the agent; its change shows inline to keep or revert', async ({
    page,
  }) => {
    await page.keyboard.press('Escape');
    await openFromCard(page);
    await page.locator('#editor .cm-line').nth(5).click();
    await page.keyboard.press('Home');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowDown');
    await expect(page.locator('#scopeRow .chip:not(.all) > span')).toHaveText(['endpoint-health.ts:6–9']);
    // ⌘K with lines selected writes the instruction in the composer; without a selection it is the command menu.
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.locator('#prompt')).toBeFocused();
    await expect(page.locator('#palette')).toHaveCount(0);
    await page.keyboard.type('Log the failure count');
    await page.keyboard.press('Enter');
    await expect(page.locator('#editorBlocked')).toBeVisible();
    await expect(page.locator('#editorReview')).toHaveText(
      'Claude Code changed lines 6–9. Keep the change, or revert it.RevertKeep',
      { timeout: 5000 },
    );
    expect(await page.evaluate(() => [...document.querySelectorAll('#editor .cm-added')].length)).toBe(6);
    await expect(page.locator('#insp .runscope .chip')).toHaveText(['server/delivery/endpoint-health.ts:6-9']);
    // Revert: the change is gone from the file and from the editor.
    await page.locator('#rejectChange').click();
    await expect(page.locator('#editorReview')).toHaveCount(0);
    await expect(page.locator('#editor .cm-added')).toHaveCount(0);
    await expect(page.locator('#editor .cm-content')).not.toContainText('logTheFailure');
  });

  test('Propagate: after a rename is saved, the files that use it are updated in one run', async ({ page }) => {
    await page.keyboard.press('Escape');
    await openFromCard(page);
    const text = await page.locator('#editor .cm-content').innerText();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(text.replaceAll('healthOf', 'healthFor'));
    await page.keyboard.press('ControlOrMeta+s');
    await expect(page.locator(TOAST)).toHaveText('Saved as run 15');
    await page.keyboard.press('Escape');
    await page.locator('[data-tab="runs"]').click();
    await page.locator('#sideList [data-run="15"]').click();
    await page.locator('#propagate').click();
    await expect(page.locator('#runbar b')).toHaveText('Run 16');
    await expect(page.locator('#insp h2')).toHaveText('Update what depends on my change to endpoint-health.ts');
    await expect(page.locator('.flist li .p')).toHaveText(['endpoints.ts', 'circuit-breaker.ts']);
    // Every line that used the old name now uses the new one.
    for (const f of ['server/api/routes/endpoints.ts', 'server/delivery/circuit-breaker.ts']) {
      const card = page.locator(`.card[data-path="${f}"]`);
      await expect(card.locator('.ln.add')).not.toHaveCount(0);
      await expect(card.locator('.ln.add')).toContainText(['healthFor']);
      await expect(card.locator('.ln.del')).toContainText(['healthOf']);
    }
  });

  test('⌘S saves a draft as a run by You, with its diff', async ({ page }) => {
    await page.keyboard.press('Escape');
    await openFromCard(page);
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('\nexport const edited = true;');
    await page.keyboard.press('ControlOrMeta+s');
    await expect(page.locator(TOAST)).toHaveText('Saved as run 15');
    await expect(page.locator('#editor header .dirty')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.locator('[data-tab="runs"]').click();
    await expect(page.locator('#sideList [data-run="15"]')).toContainText('Edited endpoint-health.ts');
    await expect(page.locator('#sideList [data-run="15"]')).toContainText('You');
    await page.locator('#sideList [data-run="15"]').click();
    await expect(page.locator('#insp')).toContainText('Saved in the editor on the map.');
    await expect(page.locator('.flist li .p')).toHaveText(['endpoint-health.ts']);
  });

  test('clicks follow Figma: click selects, shift-click adds, double-click edits; leaving with a draft asks', async ({
    page,
  }) => {
    await page.keyboard.press('Escape');
    await page.locator(`.fr[data-path="${FILE}"]`).click();
    await page.keyboard.press('f');
    await page.locator('.card[data-path="server/delivery/http-client.ts"]').click({ modifiers: ['Shift'] });
    await expect(page.locator('#editor')).toHaveCount(0);
    expect(await chips(page)).toEqual(['endpoint-health.ts', 'http-client.ts']);
    // A plain click selects a code box as the scope, without opening it.
    await page.locator('.card[data-path="server/delivery/rate-limit.ts"]').click({ position: { x: 80, y: 80 } });
    await expect(page.locator('#editor')).toHaveCount(0);
    expect(await chips(page)).toEqual(['rate-limit.ts']);
    // With a draft, leaving the page asks first.
    await page.locator(`.card[data-path="${FILE}"]`).dblclick({ position: { x: 80, y: 80 } });
    await expect(page.locator('#editor .cm-content')).toBeFocused();
    await page.keyboard.type('x');
    await expect(page.locator('#editor header .dirty')).toBeVisible();
    let asked = false;
    page.on('dialog', d => {
      asked = d.type() === 'beforeunload';
      void d.dismiss();
    });
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => asked).toBe(true);
  });
});
