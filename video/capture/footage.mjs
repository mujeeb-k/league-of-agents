// Captures the product footage for the video: League of Agents on a clone of averroes-public (in a folder named
// averroes), light theme, driven by Playwright with a visible cursor, and real Claude Code runs. Writes motion
// clips (MP4, 30 fps, 2880 × 1800), their first and last frames, and the runs' data to public/footage/.
// Usage: node capture/footage.mjs <averroes clone> <python with the backend's requirements>
// CLIPS=map,review-dark,steps records only those clips, which need no new agent run (review-dark replays the
// clone's first recorded run in the dark theme, steps its Propagate run), and keeps every other clip.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE = path.resolve(here, '../../bridge/loa.mjs');
const OUT = path.resolve(here, '../public/footage');
const [REPO, PYTHON] = process.argv.slice(2).map(p => path.resolve(p));
if (!REPO || !PYTHON) {
  console.error('Usage: node capture/footage.mjs <averroes clone> <python>');
  process.exit(1);
}
const PORT = 43301;
// The app laid out at 1152 × 720 and drawn 2.5× larger: the page is 2880 × 1800 with CSS zoom 2.5, because
// Chrome's screencast records the page at its CSS size (a device scale factor would give 1152 × 720 frames).
// Mouse positions and element boxes are in the 2880 × 1800 frame.
const FRAME = { width: 2880, height: 1800 };
const ZOOM = 2.5;
const FILE = 'backend/app/routers/coach.py';
const BLOCK_FIRST = 'def _extract_refined_prompt';
const BLOCK_LINES = 23;
const PROMPT = 'Return None when the text between the delimiters is empty, instead of an empty string.';
const EDIT_FILE = 'backend/app/config.py';
const EDIT_LINE = '# Defaults are for local development; production sets them in the environment.';
const OLD_NAME = '_extract_refined_prompt';
const NEW_NAME = 'extract_refined_prompt';
const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20 });

const ONLY = process.env.CLIPS ? new Set(process.env.CLIPS.split(',')) : null;
// Keep what other steps wrote (the long session for the hook); replace everything this script makes.
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT))
  if (!f.endsWith('-session.jsonl') && (!ONLY || [...ONLY].some(n => f === `${n}.mp4` || f.startsWith(`${n}-`) || (n === 'review-dark' && f.startsWith('checks-dark')))))
    fs.rmSync(path.join(OUT, f), { recursive: true, force: true });

// The backend's own tests are the runs' check. The tests never call the model, so the key is a placeholder.
fs.writeFileSync(
  path.join(REPO, 'loa.config.json'),
  JSON.stringify({ checks: [{ name: 'backend tests', run: `cd backend && DEEPSEEK_API_KEY=unused ${PYTHON} -m pytest -q` }] }),
);
const exclude = path.join(REPO, '.git/info/exclude');
if (!fs.readFileSync(exclude, 'utf8').includes('loa.config.json')) fs.appendFileSync(exclude, '\nloa.config.json\n');

const bridge = spawn(process.execPath, [BRIDGE, 'serve', '--port', String(PORT), '--no-hooks'], {
  cwd: REPO,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
let log = '';
bridge.stdout.on('data', d => (log += d));
bridge.stderr.on('data', d => (log += d));
for (const t0 = Date.now(); !log.includes('Open'); await new Promise(r => setTimeout(r, 100)))
  if (Date.now() - t0 > 20000) throw new Error('bridge did not start:\n' + log);
const { token } = JSON.parse(fs.readFileSync(path.join(REPO, '.loa/bridge.json'), 'utf8'));
const api = async (p, body) =>
  (
    await fetch(`http://127.0.0.1:${PORT}${p}`, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    })
  ).json();
/** Waits for the latest run to finish, checks included, and returns it. */
async function finished() {
  for (const t0 = Date.now(); ; await new Promise(r => setTimeout(r, 1000))) {
    const run = (await api('/api/state')).runs.at(-1);
    if (run && !['running', 'checking'].includes(run.status) && !run.checksRunning) return run;
    if (Date.now() - t0 > 600000) throw new Error('run did not finish');
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: FRAME, deviceScaleFactor: 1, colorScheme: 'light' });
// A visible cursor: headless Chrome draws none, so the page draws one where the mouse is.
await page.addInitScript(zoom => {
  addEventListener('DOMContentLoaded', () => {
    document.documentElement.style.zoom = String(zoom);
    const c = document.createElement('div');
    c.innerHTML =
      '<svg width="22" height="30" viewBox="0 0 14 20"><path d="M1 1 L1 16 L5 12 L8 19 L10 18 L7 11 L12 11 Z" fill="#18181b" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none', translate: '-2px -2px' });
    document.body.appendChild(c);
    // Mouse positions are in frame pixels; the cursor sits inside the zoomed page.
    addEventListener('mousemove', e => (c.style.transform = `translate(${e.clientX / zoom}px, ${e.clientY / zoom}px)`), true);
  });
}, ZOOM);
const cdp = await page.context().newCDPSession(page);
const pause = ms => page.waitForTimeout(ms);
let mouse = { x: FRAME.width / 2, y: FRAME.height / 2 };
/** Moves the cursor to a point slowly, eased, the way a person would. */
async function glide(x, y, ms = 700) {
  const steps = Math.max(8, Math.round(ms / 16));
  const from = mouse;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps,
      e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await pause(16);
  }
  mouse = { x, y };
}
/** Glides to the middle of an element and clicks it. */
async function glideClick(locator, { double = false, ms = 700 } = {}) {
  const b = await locator.boundingBox();
  await glide(b.x + b.width / 2, b.y + b.height / 2, ms);
  await pause(250);
  await page.mouse.click(mouse.x, mouse.y, { clickCount: double ? 2 : 1 });
}

const clips = ONLY ? JSON.parse(fs.readFileSync(path.join(OUT, 'clips.json'), 'utf8')) : {};
/**
 * Records what `act` does as a clip: Chrome's screencast, resampled to a steady 30 fps (the screencast sends a
 * frame only when the page changes), encoded with Remotion's ffmpeg. The first and last frames are kept.
 */
async function record(name, act) {
  const frames = [];
  const onFrame = ({ data, metadata, sessionId }) => {
    frames.push({ t: metadata.timestamp, data });
    void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  };
  cdp.on('Page.screencastFrame', onFrame);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 2880, maxHeight: 1800 });
  await pause(300);
  await act();
  await pause(300);
  await cdp.send('Page.stopScreencast');
  cdp.off('Page.screencastFrame', onFrame);
  const dir = path.join(OUT, `${name}-frames`);
  fs.mkdirSync(dir, { recursive: true });
  const t0 = frames[0].t,
    n = Math.ceil((frames.at(-1).t - t0) * 30) + 1;
  for (let k = 0, j = 0; k < n; k++) {
    while (j + 1 < frames.length && frames[j + 1].t <= t0 + k / 30) j++;
    fs.writeFileSync(path.join(dir, `${String(k).padStart(5, '0')}.jpg`), Buffer.from(frames[j].data, 'base64'));
  }
  execFileSync(
    'npx',
    ['remotion', 'ffmpeg', '-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(dir, '%05d.jpg'),
      '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', path.join(OUT, `${name}.mp4`)],
    { cwd: path.resolve(here, '..') },
  );
  fs.copyFileSync(path.join(dir, `${String(n - 1).padStart(5, '0')}.jpg`), path.join(OUT, `${name}-last.jpg`));
  fs.copyFileSync(path.join(dir, '00000.jpg'), path.join(OUT, `${name}-first.jpg`));
  fs.rmSync(dir, { recursive: true });
  clips[name] = n / 30;
  console.log('clip', name, (n / 30).toFixed(1) + 's');
}

/** Opens a file on the map with quick open, so it is selected and in view. */
async function goTo(file) {
  await page.keyboard.press('Meta+p');
  await page.keyboard.type(file);
  await page.keyboard.press('Enter');
  await pause(1000);
}
/** Scrolls the editor so the line holding `text` sits near the top. */
const lineToTop = text =>
  page.evaluate(
    ([text, zoom]) => {
      const el = [...document.querySelectorAll('.cm-content .cm-line')].find(l => l.textContent.includes(text));
      const scroller = el.closest('.cm-scroller');
      // Boxes are in frame pixels; scroll offsets are in the page's own (unzoomed) pixels.
      scroller.scrollTop += (el.getBoundingClientRect().top - scroller.getBoundingClientRect().top) / zoom - 24;
    },
    [text, ZOOM],
  );
/**
 * Where a piece of text is on screen: in the line `offset` lines after the one holding `anchor` (the line's own
 * text from its first character when `sub` is empty). Lines are found by their text, after any scrolling.
 */
const textBox = (anchor, offset, sub) =>
  page.evaluate(
    ([anchor, offset, sub]) => {
      const lines = [...document.querySelectorAll('.cm-content .cm-line')];
      const line = lines[lines.findIndex(l => l.textContent.includes(anchor)) + offset];
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      const nodes = [];
      for (let node; (node = walker.nextNode()); ) nodes.push(node);
      const all = nodes.map(x => x.data).join('');
      let from = sub ? all.indexOf(sub) : all.search(/\S/),
        to = sub ? from + sub.length : all.length;
      const at = i => {
        for (const node of nodes) {
          if (i <= node.data.length) return [node, i];
          i -= node.data.length;
        }
      };
      const range = document.createRange();
      range.setStart(...at(from));
      range.setEnd(...at(to));
      const r = range.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    },
    [anchor, offset, sub],
  );
/** Opens a run from the command menu (the sidebar may be hidden). */
async function openRun(id) {
  await page.keyboard.press('Meta+k');
  await page.keyboard.type(`open run ${id}`);
  await page.keyboard.press('Enter');
  await pause(900);
}
/** Closes the editor; directly, since the camera may still be flying to a finished run. */
const closeEditor = () => page.locator('#closeEditor').evaluate(b => b.click());
/** Where an element is in the frame, in frame pixels. */
const frameBox = async locator => {
  const b = await locator.boundingBox();
  return b && { x: b.x, y: b.y, w: b.width, h: b.height };
};

try {
  await page.goto(`http://127.0.0.1:${PORT}/#t=${token}`);
  await page.locator('#conn', { hasText: 'Live' }).waitFor();
  await page.locator('[data-sonner-toast]').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  await page.mouse.move(mouse.x, mouse.y);

  // Your whole project on one screen: the whole map, then in with the app's own zoom to folders with their files'
  // names, then to code, toward the file the later scenes work on. Panels out of the way.
  await page.keyboard.press(']');
  await page.keyboard.press('[');
  await page.keyboard.press('0');
  await pause(1500);
  const zoom = async () => Number((await page.locator('#zPct').innerText()).replace('%', ''));
  /** How far the file's middle is from the canvas's middle, both as the page measures them. */
  const offCenter = () =>
    page.evaluate(file => {
      const s = document.getElementById('stage').getBoundingClientRect();
      // The file's row below 34%, its code card above: whichever is drawn.
      const r = [...document.querySelectorAll(`[data-path="${file}"]`)]
        .map(el => el.getBoundingClientRect())
        .find(b => b.width > 0 && b.height > 0);
      return { dx: r.left + r.width / 2 - (s.left + s.width / 2), dy: r.top + r.height / 2 - (s.top + s.height / 2) };
    }, FILE);
  /** Pans with the wheel, in steps, until the file sits in the middle of the canvas. */
  const centerFile = async () => {
    for (let k = 0; k < 60; k++) {
      const { dx, dy } = await offCenter();
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      await page.evaluate(
        ([dx, dy]) =>
          document
            .getElementById('stage')
            .dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: dx * 0.3, deltaY: dy * 0.3 })),
        [dx, dy],
      );
      await pause(40);
    }
  };
  /**
   * Zooms in at the canvas's middle, where the file is kept, until the zoom reaches `to`. Wheel events are sent in
   * the page: under CSS zoom, a real wheel's position and the canvas maths disagree, and the zoom would drift.
   */
  const zoomTo = async to => {
    while ((await zoom()) < to) {
      await page.evaluate(async () => {
        const stage = document.getElementById('stage');
        const r = stage.getBoundingClientRect();
        for (let i = 0; i < 4; i++) {
          stage.dispatchEvent(
            new WheelEvent('wheel', {
              bubbles: true,
              cancelable: true,
              ctrlKey: true,
              deltaY: -3,
              clientX: r.left + stage.clientWidth / 2,
              clientY: r.top + stage.clientHeight / 2,
            }),
          );
          await new Promise(res => setTimeout(res, 70));
        }
      });
      await centerFile();
    }
  };
  await centerFile();
  await pause(800);
  const target = await frameBox(page.locator(`[data-path="${FILE}"]`).first());
  if (!ONLY || ONLY.has('map'))
    await record('map', async () => {
      await pause(1200);
      await glide(target.x + target.w / 2, target.y + target.h / 2, 900);
      await pause(500);
      await zoomTo(13);
      await pause(1800);
      await zoomTo(100);
      await pause(1800);
    });

  // Before, After and Diff in the dark theme, on the clone's first recorded run, for the Review scene.
  if (ONLY?.has('review-dark')) {
    await page.locator('#themeBtn').evaluate(b => b.click());
    await page.keyboard.press(']');
    await openRun(1);
    await pause(1500);
    await record('review-dark', async () => {
      for (const m of ['before', 'after', 'diff']) {
        await glideClick(page.locator(`[data-mode="${m}"]`), { ms: 600 });
        await pause(1100);
      }
    });
    // The checks that ran, in the inspector, as a still.
    await page.locator('#insp .checks').scrollIntoViewIfNeeded();
    await page.mouse.move(5, FRAME.height - 5);
    await pause(600);
    await page.screenshot({ path: path.join(OUT, 'checks-dark.jpg'), quality: 92 });
    fs.writeFileSync(path.join(OUT, 'checks-dark.json'), JSON.stringify(await frameBox(page.locator('#insp .checks'))));
  }

  // Stepping through the Propagate run's files one by one (J), on the clone's recorded run, for Propagate's end.
  if (ONLY?.has('steps')) {
    await page.keyboard.press(']');
    const spreadRun = (await api('/api/state')).runs.find(r => r.agent === 'claude' && r.changes.length > 1);
    await openRun(spreadRun.id);
    await page.keyboard.press('d');
    await page.locator('#insp .flist').scrollIntoViewIfNeeded();
    await pause(1500);
    // Each file in turn: J brings it into view, R marks it reviewed, and the list and the progress follow.
    await record('steps', async () => {
      await pause(600);
      for (let i = 0; i < spreadRun.changes.length; i++) {
        await page.keyboard.press('j');
        await pause(1500);
        await page.keyboard.press('r');
        await pause(700);
      }
    });
  }

  // Everything after the map needs Claude Code's runs.
  if (!ONLY) {
    // Select the lines you want changed: drag over the function in the editor, ⌘K, the prompt, run.
    await page.keyboard.press(']');
    await goTo(FILE);
    await record('point', async () => {
      await page.keyboard.press('Enter');
      await page.locator('.cm-content').waitFor();
      await pause(600);
      await lineToTop(BLOCK_FIRST);
      await pause(400);
      const a = await textBox(BLOCK_FIRST, 0, ''),
        z = await textBox(BLOCK_FIRST, BLOCK_LINES - 1, '');
      await glide(a.x + 1, a.y + a.h / 2, 900);
      await page.mouse.down();
      await glide(z.x + z.w, z.y + z.h / 2, 1400);
      await page.mouse.up();
      await pause(700);
      // Stop before the agent runs if the drag missed the block.
      const scope = await page.locator('#scopeRow').innerText();
      if (!scope.includes(':34–56')) throw new Error(`selected the wrong lines: ${scope}`);
      await page.keyboard.press('Meta+k');
      await page.keyboard.type(PROMPT, { delay: 32 });
      await pause(500);
      await page.keyboard.press('Enter');
      await pause(1800);
    });
    const run = await finished();
    fs.writeFileSync(path.join(OUT, 'run.json'), JSON.stringify(run, null, 2));
    await closeEditor();
    await pause(1200);

    // Or open any file and edit it yourself: double-click its card, type, save.
    await goTo(EDIT_FILE);
    await pause(400);
    await record('edit', async () => {
      await glideClick(page.locator(`.card[data-path="${EDIT_FILE}"]`), { double: true });
      await page.locator('.cm-content').waitFor();
      await pause(900);
      await page.keyboard.press('Meta+ArrowUp');
      await page.keyboard.type(EDIT_LINE + '\n', { delay: 30 });
      await pause(500);
      await page.keyboard.press('Meta+s');
      await pause(1500);
    });
    await closeEditor();
    await pause(800);

    // Rename a function and save it; then "Update what depends on this".
    await goTo(FILE);
    await record('rename', async () => {
      await page.keyboard.press('Enter');
      await page.locator('.cm-content').waitFor();
      await pause(600);
      await lineToTop(BLOCK_FIRST);
      await pause(400);
      const b = await textBox(BLOCK_FIRST, 0, OLD_NAME);
      await glide(b.x + b.w / 2, b.y + b.h / 2, 900);
      await pause(300);
      await page.mouse.dblclick(mouse.x, mouse.y);
      await pause(500);
      await page.keyboard.type(NEW_NAME, { delay: 45 });
      await pause(400);
      // Stop before saving if the double-click didn't take the whole name.
      const line = await page.locator('.cm-content .cm-line', { hasText: `def ${NEW_NAME}` }).first().innerText().catch(() => '');
      if (!line.startsWith(`def ${NEW_NAME}(text: str)`)) throw new Error(`the rename went wrong: ${line}`);
      await page.keyboard.press('Meta+s');
      await pause(1600);
    });
    await closeEditor();
    const saved = (await api('/api/state')).runs.at(-1);
    if (!saved.changes.length) throw new Error('the rename was not saved');
    await openRun(saved.id);
    await page.keyboard.press('0');
    await pause(1200);
    await record('propagate-start', async () => {
      await glideClick(page.locator('#propagate'));
      await pause(2200);
    });
    const spread = await finished();
    fs.writeFileSync(path.join(OUT, 'propagate.json'), JSON.stringify(spread, null, 2));
    await pause(1500);
    // The spread, framed by zooming to the run (F), panels out of the way, with where each changed folder sits
    // for the pulses.
    await page.keyboard.press(']');
    // Nothing selected, so F frames the run rather than a file.
    await page.keyboard.press('Escape');
    await page.keyboard.press('f');
    await pause(1500);
    const folders = [...new Set(spread.changes.map(c => c.path.split('/').slice(0, -1).join('/')))];
    const where = {};
    for (const d of folders) where[d] = await frameBox(page.locator(`.frame[data-dir="${d}"] > .flabel`));
    if (Object.values(where).some(b => !b || b.x < 0 || b.y < 0 || b.x > 2880 || b.y > 1800))
      throw new Error(`a changed folder is out of the frame: ${JSON.stringify(where)}`);
    fs.writeFileSync(path.join(OUT, 'propagate-folders.json'), JSON.stringify(where, null, 2));
    await record('propagate-end', async () => {
      await pause(3500);
    });

    // See every changed line: Before, After, Diff, and the tests that ran.
    await page.keyboard.press(']');
    await openRun(run.id);
    await pause(1500);
    await record('review', async () => {
      for (const m of ['before', 'after', 'diff']) {
        await glideClick(page.locator(`[data-mode="${m}"]`), { ms: 600 });
        await pause(1100);
      }
    });

    // Keep it, or undo all of it: on the Propagate run.
    await openRun(spread.id);
    await pause(1200);
    await page.locator('[data-act="keep"]').scrollIntoViewIfNeeded();
    await pause(500);
    await record('keep', async () => {
      await glideClick(page.locator('[data-act="keep"]'));
      await pause(1500);
      await glideClick(page.locator('[data-act="revert"]'));
      await pause(2200);
    });
  }
  fs.writeFileSync(path.join(OUT, 'clips.json'), JSON.stringify(clips, null, 2));

  // Leave the clone as it was: undo the rename, the edit and the first run, latest first.
  for (const r of (await api('/api/state')).runs.reverse())
    if (!r.reverted && r.changes.length) await api(`/api/runs/${r.id}/revert`, { force: true });
} finally {
  await browser.close();
  process.kill(-bridge.pid, 'SIGTERM');
}

// The endless diff: the project's largest real change that both adds and removes lines, file by file.
if (ONLY) process.exit(0);
const biggest = git('log', '--format=@%h', '--shortstat')
  .split('@')
  .filter(Boolean)
  .map(b => [b.split('\n')[0], Math.min(Number(/(\d+) insertion/.exec(b)?.[1] ?? 0), Number(/(\d+) deletion/.exec(b)?.[1] ?? 0))])
  .sort((a, b) => b[1] - a[1])[0][0];
fs.writeFileSync(path.join(OUT, 'long.diff'), git('show', '--format=', biggest));
console.log('done; long diff from', biggest, '; git status after:', git('status', '--porcelain') || 'clean');
