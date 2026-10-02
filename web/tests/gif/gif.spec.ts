// The README's GIF: the demo's core loop, recorded from the built app and encoded with gifenc.
// Run alone with `npm run gif`; it writes docs/media/demo.gif.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import gifenc from 'gifenc';
import { PNG } from 'pngjs';
import { APP } from '../support/targets';

// gifenc is CommonJS: its functions come from the default export.
const { GIFEncoder, applyPalette, quantize } = gifenc;
const OUT = path.resolve('../docs/media/demo.gif');
const SIZE = { width: 1200, height: 750 };

/** Screenshots taken as fast as the page allows, each kept for as long as it was on screen. */
class Recording {
  frames: { png: Buffer; at: number }[] = [];
  private on = false;
  private loop: Promise<void> = Promise.resolve();
  constructor(private page: Page) {}
  start() {
    this.on = true;
    this.loop = (async () => {
      while (this.on) this.frames.push({ png: await this.page.screenshot(), at: Date.now() });
    })();
  }
  async stop() {
    this.on = false;
    await this.loop;
  }
  /** Holds still for `ms`: the screen doesn't change, so one frame covers it. */
  hold = (ms: number) => this.page.waitForTimeout(ms);
}

// Real motion: the camera's flight to the run is part of the story.
// Drawn at 0.8, so the GIF is 960 × 600 and stays small enough for a README. Reduced motion, so the camera
// jumps instead of flying: a recording catches a flight between frames, mid-zoom.
test.use({ viewport: SIZE, deviceScaleFactor: 0.8, colorScheme: 'light' });

test('README GIF: the demo, from the map to a reviewed run', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(APP);
  await page.locator('#insp section').first().waitFor();
  await page.keyboard.press('Escape');
  await page.keyboard.press('0');
  await page.waitForTimeout(800);
  const rec = new Recording(page);
  rec.start();
  await rec.hold(1200);
  // Point the agent at a folder, and ask.
  await page.locator('.frame[data-dir="server/delivery"] > .flabel b').click();
  await rec.hold(700);
  await page.locator('#prompt').click();
  await page.keyboard.type('Log why a delivery was dead-lettered', { delay: 45 });
  await rec.hold(400);
  await page.keyboard.press('Enter');
  // The run finishes; the map flies to it and shows the diff.
  await expect(page.locator('[data-mode="diff"]')).toHaveAttribute('aria-checked', 'true', { timeout: 10_000 });
  await rec.hold(2200);
  // Review it: before and after, then file by file.
  await page.keyboard.press('b');
  await rec.hold(1100);
  await page.keyboard.press('d');
  await rec.hold(900);
  await page.keyboard.press('j');
  await rec.hold(1200);
  await page.keyboard.press('r');
  await expect(page.locator('#insp')).toContainText('1 of 3');
  await rec.hold(1600);
  await rec.stop();

  // A frame that repeats the one before only lengthens it.
  const frames = rec.frames.filter((f, i) => i === 0 || !f.png.equals(rec.frames[i - 1]!.png));
  const gif = GIFEncoder();
  frames.forEach((f, i) => {
    const { data, width, height } = PNG.sync.read(f.png);
    const palette = quantize(data, 256);
    const next = frames[i + 1]?.at ?? f.at + 1500;
    gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay: Math.max(20, next - f.at) });
  });
  gif.finish();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, gif.bytes());
  expect(frames.length).toBeGreaterThan(20);
});
