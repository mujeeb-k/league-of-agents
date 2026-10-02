// Performance proof for the definition of done (docs/DESIGN.md). Run with `npm run perf`; not part of `npm test`,
// because frame timings depend on the machine. Writes a summary and Chrome traces to test-results/perf/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { git, startBridge } from '../support/live';
import { APP } from '../support/targets';

const OUT = path.resolve('test-results/perf');
const FRAME = 1000 / 60;

/** A git repo of `n` TypeScript files in nested folders, each importing two neighbours. */
function bigRepo(n: number): string {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loa-perf-')), 'big-repo');
  const paths = Array.from({ length: n }, (_, i) => `src/area${i % 8}/part${(i >> 3) % 10}/mod${i % 5}/file${i}.ts`);
  paths.forEach((p, i) => {
    const near = [paths[(i + 1) % n]!, paths[(i + 7) % n]!];
    const rel = (q: string) => {
      const r = path.relative(path.dirname(p), q).replace(/\.ts$/, '');
      return r.startsWith('.') ? r : './' + r;
    };
    const body = [
      ...near.map((q, k) => `import { value${k} } from '${rel(q)}';`),
      '',
      `export const value = ${i};`,
      ...Array.from(
        { length: 24 },
        (_, k) => `export function step${k}(x: number) {\n  return x * ${k} + value0 - value1;\n}`,
      ),
    ].join('\n');
    fs.mkdirSync(path.join(dir, path.dirname(p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), body + '\n');
  });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'seed');
  return dir;
}

type Wheel = { deltaX?: number; deltaY?: number; ctrlKey?: boolean };

/** Sends one wheel event per frame for `frames` frames and returns each frame's duration in ms. */
const drive = (page: Page, frames: number, init: Wheel) =>
  page.evaluate(
    ({ frames, init }) =>
      new Promise<number[]>(resolve => {
        const stage = document.getElementById('stage')!;
        const r = stage.getBoundingClientRect();
        const times: number[] = [];
        let last = 0;
        const tick = (t: number) => {
          if (last) times.push(t - last);
          last = t;
          if (times.length >= frames) return resolve(times);
          stage.dispatchEvent(
            new WheelEvent('wheel', {
              bubbles: true,
              cancelable: true,
              clientX: r.left + r.width / 2,
              clientY: r.top + r.height / 2,
              ...init,
            }),
          );
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { frames, init },
  );

function stats(name: string, times: number[]) {
  const sorted = [...times].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
  const dropped = times.filter(t => t > FRAME * 1.5).length;
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  return {
    name,
    frames: times.length,
    fps: +(1000 / mean).toFixed(1),
    p50: +pct(50).toFixed(1),
    p95: +pct(95).toFixed(1),
    max: +sorted.at(-1)!.toFixed(1),
    dropped,
  };
}

/** Prints rows as aligned text, for the proof log. */
const report = (rows: object[]) =>
  process.stdout.write(rows.map(r => Object.values(r).join('  |  ')).join('\n') + '\n');

test.describe.configure({ mode: 'serial' });
fs.mkdirSync(OUT, { recursive: true });

test('pan and zoom on a 1,000-file repo hold 60 fps', async ({ page, browser }) => {
  const repo = bigRepo(1000);
  const b = await startBridge(repo);
  try {
    await page.goto(`http://127.0.0.1:${b.port}/#t=${b.token}`);
    await expect(page.locator('#conn')).toHaveText('Live');
    await expect(page.locator('.fr')).toHaveCount(1000);
    // Fit everything, as a person would first: that ends the first-load sidebar (panels.ts), so it steps
    // aside when zoomed out.
    await page.keyboard.press('0');
    await page.waitForTimeout(600);
    await browser.startTracing(page, { path: path.join(OUT, 'pan-zoom-trace.json'), screenshots: false });
    const results: ReturnType<typeof stats>[] = [];
    // Each phase starts after the previous zoom has settled (camera.ts SETTLE_MS), so the one-off settle is
    // measured on its own, as a response time, and not counted as dropped frames.
    const phase = async (name: string, frames: number, w: Wheel) => {
      results.push(stats(name, await drive(page, frames, w)));
      await page.waitForTimeout(400);
    };
    const side = page.locator('#side'),
      away = /(^|\s)away(\s|$)/;
    await phase('pan, zoomed out (all 1,000 file tiles)', 180, { deltaX: 6, deltaY: 4 });
    await expect(side).toHaveClass(away);
    await phase('zoom in across 34%, the sidebar returns', 120, { deltaY: -6, ctrlKey: true });
    await expect(page.locator('#world')).toHaveClass(/near/);
    await expect(side).not.toHaveClass(away);
    await phase('pan, zoomed in (code cards)', 180, { deltaX: 8, deltaY: 6 });
    await phase('zoom out across 34%, the sidebar steps aside', 120, { deltaY: 6, ctrlKey: true });
    await expect(side).toHaveClass(away);
    await browser.stopTracing();
    fs.writeFileSync(path.join(OUT, 'pan-zoom.json'), JSON.stringify(results, null, 2));
    report(results);
    for (const r of results) expect(r.dropped, r.name).toBeLessThanOrEqual(Math.ceil(r.frames * 0.02));
  } finally {
    b.stop();
  }
});

type Action = 'quick open' | 'command menu' | 'type' | 'explorer down' | 'inspector wider';

/**
 * Milliseconds from the input event to the first frame that shows its result, measured in the page:
 * the event is dispatched, then each animation frame checks for the result.
 */
const respond = (page: Page, action: Action, text = '') =>
  page.evaluate(
    ({ action, text }) =>
      new Promise<number>(resolve => {
        const q = <T extends Element>(sel: string) => document.querySelector<T>(sel);
        const key = (target: EventTarget, init: KeyboardEventInit) =>
          target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
        const focused = document.activeElement;
        const width = q('#insp')!.getBoundingClientRect().width;
        const t0 = performance.now();
        let done: () => boolean;
        if (action === 'quick open' || action === 'command menu') {
          key(document, { key: action === 'quick open' ? 'p' : 'k', metaKey: true });
          done = () => !!q('#palette [cmdk-input]');
        } else if (action === 'type') {
          const input = q<HTMLInputElement>('#palette [cmdk-input]')!;
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          done = () => {
            const items = [...document.querySelectorAll<HTMLElement>('#palette [cmdk-item]')];
            return items.length > 0 && items.every(i => i.dataset.path!.includes(text));
          };
        } else if (action === 'explorer down') {
          key(focused!, { key: 'ArrowDown' });
          done = () => document.activeElement !== focused;
        } else {
          key(focused!, { key: 'ArrowLeft' });
          done = () => q('#insp')!.getBoundingClientRect().width !== width;
        }
        const frame = () => (done() ? resolve(Math.round(performance.now() - t0)) : requestAnimationFrame(frame));
        requestAnimationFrame(frame);
      }),
    { action, text },
  );

test('responses on a 1,000-file repo stay under 100 ms', async ({ page }) => {
  const b = await startBridge(bigRepo(1000));
  try {
    await page.goto(`http://127.0.0.1:${b.port}/#t=${b.token}`);
    await expect(page.locator('.fr')).toHaveCount(1000);
    const rows: { action: string; ms: number }[] = [];
    const close = async () => {
      await page.keyboard.press('Escape');
      await expect(page.locator('#palette')).toHaveCount(0);
    };
    rows.push({ action: 'open quick open (⌘P), 1,000 files', ms: await respond(page, 'quick open') });
    for (const text of ['file9', 'file99', 'file999'])
      rows.push({ action: `type "${text}" in quick open`, ms: await respond(page, 'type', text) });
    await close();
    rows.push({ action: 'open the command menu (⌘K)', ms: await respond(page, 'command menu') });
    await close();
    // The sidebar shows on first load (panels.ts).
    await page.locator('[data-tab="files"]').click();
    await page.locator('#sideList [role="treeitem"]').first().focus();
    for (let i = 0; i < 3; i++)
      rows.push({ action: 'move in the explorer (ArrowDown)', ms: await respond(page, 'explorer down') });
    await page.locator('#inspHandle').focus();
    rows.push({ action: 'resize the inspector (ArrowLeft)', ms: await respond(page, 'inspector wider') });
    for (const deltaY of [-40, -40, 40])
      rows.push({ action: 'settle after a zoom: sharp text and folder labels', ms: await settle(page, deltaY) });
    fs.writeFileSync(path.join(OUT, 'responses.json'), JSON.stringify(rows, null, 2));
    report(rows);
    for (const r of rows) expect(r.ms, r.action).toBeLessThan(100);
  } finally {
    b.stop();
  }
});

/**
 * Once a zoom rests for SETTLE_MS (camera.ts, 150 ms), text sizes and folder labels are redone for the new
 * scale (labels.ts). Milliseconds from the end of that rest to the first frame after the work.
 */
const settle = (page: Page, deltaY: number) =>
  page.evaluate(
    deltaY =>
      new Promise<number>(resolve => {
        const stage = document.getElementById('stage')!,
          world = document.getElementById('world')!,
          r = stage.getBoundingClientRect();
        const t0 = performance.now();
        stage.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY,
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
            clientX: r.left + r.width / 2,
            clientY: r.top + r.height / 2,
          }),
        );
        const frame = () =>
          world.classList.contains('zooming')
            ? requestAnimationFrame(frame)
            : resolve(Math.round(performance.now() - t0 - 150));
        requestAnimationFrame(frame);
      }),
    deltaY,
  );

type Trigger = {
  key?: string;
  click?: string;
  pointer?: string;
  until: string;
  attr?: string;
  value?: string;
  text?: string;
};

/** Like respond(), for one input on any element: ms from the event to the first frame where `until` matches. */
const respondTo = (page: Page, t: Trigger) =>
  page.evaluate(
    t =>
      new Promise<number>(resolve => {
        const t0 = performance.now();
        if (t.key)
          document.dispatchEvent(new KeyboardEvent('keydown', { key: t.key, bubbles: true, cancelable: true }));
        if (t.click) document.querySelector<HTMLElement>(t.click)!.click();
        if (t.pointer)
          document
            .querySelector(t.pointer)!
            .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
        const done = () => {
          const el = document.querySelector(t.until);
          if (!el) return false;
          if (t.attr) return el.getAttribute(t.attr) === t.value;
          if (t.text) return !!el.textContent?.includes(t.text);
          return true;
        };
        const frame = () => (done() ? resolve(Math.round(performance.now() - t0)) : requestAnimationFrame(frame));
        requestAnimationFrame(frame);
      }),
    t,
  );

test('responses in the demo stay under 100 ms', async ({ page }) => {
  await page.goto(APP);
  await page.locator('#insp section').first().waitFor();
  const rows: { action: string; ms: number }[] = [];
  const add = async (action: string, t: Trigger) => rows.push({ action, ms: await respondTo(page, t) });
  await add('show diff (D)', { key: 'd', until: '[data-mode="diff"]', attr: 'aria-checked', value: 'true' });
  await add('show before (B)', { key: 'b', until: '[data-mode="before"]', attr: 'aria-checked', value: 'true' });
  await add('step to the next file (J)', { key: 'j', until: '.flist li.cur' });
  await add('mark reviewed (R)', { key: 'r', until: '.flist .chk.on' });
  await add('keep the run', { click: '[data-act="keep"]', until: '#insp .outcome', text: 'Kept' });
  await add('close the run (Esc)', { key: 'Escape', until: '#runbar .quiet' });
  if (await page.locator('#side').evaluate(el => el.hasAttribute('inert'))) await page.keyboard.press('[');
  await page.locator('[data-tab="runs"]').click();
  await add('open a run from its card', { click: '#sideList [data-run="13"]', until: '#runbar b', text: 'Run 13' });
  await add('switch the theme', { click: '#themeBtn', until: 'html', attr: 'data-theme', value: 'dark' });
  await add('open the agent menu', { pointer: '#agentBtn', until: '#agentMenu' });
  fs.writeFileSync(path.join(OUT, 'responses-demo.json'), JSON.stringify(rows, null, 2));
  report(rows);
  for (const r of rows) expect(r.ms, r.action).toBeLessThan(100);
});

// The editor on a 1,000-line file. The expand animates transform and opacity only, at 60 fps, and a
// keystroke shows on screen within 100 ms.
test('the editor on a 1,000-line file: expand at 60 fps, keystrokes under 100 ms', async ({ page }) => {
  const repo = bigRepo(40);
  const long = Array.from({ length: 1000 }, (_, i) => `export const line${i} = ${i} * 2; // a line of ordinary code`);
  fs.writeFileSync(path.join(repo, 'src/long.ts'), long.join('\n') + '\n');
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'long file');
  const b = await startBridge(repo);
  try {
    await page.goto(`http://127.0.0.1:${b.port}/#t=${b.token}`);
    await expect(page.locator('#conn')).toHaveText('Live');
    await page.keyboard.press('0');
    await page.locator('.fr[data-path="src/long.ts"]').click();
    // Frame times while the editor expands, from the keypress.
    const [frames] = await Promise.all([
      page.evaluate(
        () =>
          new Promise<number[]>(resolve => {
            const out: number[] = [];
            let last = performance.now();
            const t0 = last;
            const tick = (now: number) => {
              out.push(now - last);
              last = now;
              if (now - t0 < 500) requestAnimationFrame(tick);
              else resolve(out);
            };
            requestAnimationFrame(tick);
          }),
      ),
      page.keyboard.press('Enter'),
    ]);
    await expect(page.locator('#editor .cm-content')).toBeFocused();
    const expand = stats('expand the editor (1,000-line file)', frames.slice(1));
    // Keystrokes: from the key event to the first frame that shows the character.
    await page.evaluate(() => {
      const w = window as unknown as { keyAt: number; shownAt: number };
      w.keyAt = Infinity;
      document.addEventListener('keydown', e => (w.keyAt = e.timeStamp), true);
      // Only a change after the key event counts, not the scroll from moving there.
      new MutationObserver(() => {
        if (w.keyAt !== Infinity && !w.shownAt) requestAnimationFrame(now => (w.shownAt ||= now));
      }).observe(document.querySelector('#editor .cm-content')!, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    });
    const rows: { action: string; ms: number }[] = [];
    for (const [where, keys] of [
      ['at the end', 'ControlOrMeta+End'],
      ['at the start', 'ControlOrMeta+Home'],
      ['in the middle', 'PageDown'],
    ] as const) {
      await page.keyboard.press(keys);
      await page.waitForTimeout(200);
      await page.evaluate(() => {
        const w = window as unknown as { keyAt: number; shownAt: number };
        w.keyAt = Infinity;
        w.shownAt = 0;
      });
      await page.keyboard.press('x');
      const ms = await page.evaluate(
        () =>
          new Promise<number>(resolve => {
            const w = window as unknown as { keyAt: number; shownAt: number };
            const wait = () => (w.shownAt ? resolve(Math.round(w.shownAt - w.keyAt)) : requestAnimationFrame(wait));
            wait();
          }),
      );
      rows.push({ action: `type a character ${where} of a 1,000-line file`, ms });
    }
    fs.writeFileSync(path.join(OUT, 'editor.json'), JSON.stringify({ expand, rows }, null, 2));
    report([expand, ...rows]);
    expect(expand.dropped, expand.name).toBeLessThanOrEqual(1);
    for (const r of rows) expect(r.ms, r.action).toBeLessThan(100);
  } finally {
    b.stop();
  }
});

test('first paint on the hosted site is under 1.5 s', async ({ browser }) => {
  const SITE = 'https://leagueofagents.dev/';
  const visit = async (net: { latency: number; downloadThroughput: number; uploadThroughput: number } | null) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    if (net) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...net });
    await page.goto(SITE, { waitUntil: 'load' });
    await page.locator('#insp section').first().waitFor();
    const m = await page.evaluate(
      () =>
        new Promise<{ fp: number; fcp: number; ttfb: number; script: string }>(resolve => {
          const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
          const fp = performance.getEntriesByName('first-paint')[0]?.startTime ?? NaN;
          const script =
            [...document.scripts]
              .map(s => s.src)
              .find(Boolean)
              ?.split('/')
              .pop() ?? '';
          new PerformanceObserver(list => {
            const fcp = list.getEntriesByName('first-contentful-paint')[0];
            if (fcp) resolve({ fp, fcp: fcp.startTime, ttfb: nav.responseStart, script });
          }).observe({ type: 'paint', buffered: true });
        }),
    );
    await ctx.close();
    return m;
  };
  await visit(null);
  const runs = [];
  for (const [label, net] of [
    ['no throttling', null],
    [
      'Lighthouse desktop network (10 Mbps, 40 ms RTT)',
      { latency: 40, downloadThroughput: 1.25e6, uploadThroughput: 1.25e6 },
    ],
  ] as const)
    for (let i = 0; i < 3; i++) {
      const m = await visit(net);
      runs.push({
        label,
        run: i + 1,
        ttfb: Math.round(m.ttfb),
        fp: Math.round(m.fp),
        fcp: Math.round(m.fcp),
        script: m.script,
      });
    }
  fs.writeFileSync(path.join(OUT, 'first-paint.json'), JSON.stringify(runs, null, 2));
  report(runs);
  for (const r of runs) expect(r.fcp, `${r.label}, run ${r.run}`).toBeLessThan(1500);
});
