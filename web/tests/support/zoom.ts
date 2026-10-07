// Zoom levels: set an exact zoom through the real input path, and check what each level shows.
import { expect, type Page } from '@playwright/test';

export const ZOOMS = [5, 10, 18, 25, 37, 64, 110];

const scale = (page: Page) => page.locator('#world').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a);

/** Zooms to `pct` percent toward the middle of the canvas with ⌘ or Ctrl and the wheel, then lets it settle. */
export async function zoomTo(page: Page, pct: number) {
  const box = (await page.locator('#stage').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // The canvas zooms by exp(-deltaY / 100) per wheel event (Stage.tsx).
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100 * Math.log(pct / 100 / (await scale(page))));
  await page.keyboard.up('Control');
  await expect.poll(() => scale(page)).toBeCloseTo(pct / 100, 3);
  // The zoom-dependent sizes and the label pass apply once the scale rests (camera.ts SETTLE_MS).
  await expect(page.locator('#world')).not.toHaveClass(/zooming/);
  // Park the pointer on the top bar, so nothing on the canvas is hovered.
  await page.mouse.move(box.x + box.width / 2, 10);
}

/**
 * Requirement 4: visible folder labels never overlap and are one line. Names never break: tiles' names are
 * one line. Requirement 3: below code zoom, every folder with files draws its tiles: named, except at the
 * farthest zoom (`.over`), where a tile is its block and its change marks.
 */
export async function checkLevel(page: Page) {
  const r = await page.evaluate(() => {
    const vis = (el: Element) =>
      getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
    const labels = [...document.querySelectorAll('.frame .flabel')]
      .filter(vis)
      .map(el => ({ dir: (el.parentElement as HTMLElement).dataset.dir, r: el.getBoundingClientRect() }));
    const overlaps: string[] = [];
    for (let i = 0; i < labels.length; i++)
      for (let j = i + 1; j < labels.length; j++) {
        const [a, b] = [labels[i]!, labels[j]!];
        if (
          a.r.left < b.r.right - 0.5 &&
          b.r.left < a.r.right - 0.5 &&
          a.r.top < b.r.bottom - 0.5 &&
          b.r.top < a.r.bottom - 0.5
        )
          overlaps.push(`${a.dir} and ${b.dir}`);
      }
    const tall = labels.filter(l => l.r.height > 26).map(l => `${l.dir}: ${l.r.height}px`);
    const near = document.getElementById('world')!.classList.contains('near');
    const names = [...document.querySelectorAll<HTMLElement>('.fr .n')].filter(vis);
    const wrapped = names.filter(n => n.getBoundingClientRect().height > 20).map(n => n.textContent);
    const bare: string[] = [];
    if (!near)
      for (const f of document.querySelectorAll<HTMLElement>('.frame:not(.bare)')) {
        const tiles = [...document.querySelectorAll<HTMLElement>('.fr')].filter(
          t => t.dataset.path!.slice(0, Math.max(0, t.dataset.path!.lastIndexOf('/'))) === f.dataset.dir,
        );
        const over = document.getElementById('world')!.classList.contains('over');
        const drawn = tiles.filter(t => {
          const name = t.querySelector<HTMLElement>('.n');
          return vis(t) && t.getBoundingClientRect().width > 0 && (over || (name && vis(name)));
        });
        if (!drawn.length) bare.push(f.dataset.dir || '/');
      }
    return { labels: labels.length, overlaps, tall, wrapped, bare };
  });
  expect(r.overlaps, 'overlapping labels').toEqual([]);
  expect(r.tall, 'labels taller than one line').toEqual([]);
  expect(r.wrapped, 'tile names on more than one line').toEqual([]);
  expect(r.bare, 'folders with files that draw nothing').toEqual([]);
  return r;
}
