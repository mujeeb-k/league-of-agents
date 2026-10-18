// Two sessions that change one file, in the order of the owner's real run (spec 022, M1): Claude Code on a/ and
// Cursor on b/, both at work; Claude Code edits a/tax.mjs and ends; Cursor edits the same file and ends; one run is
// committed and the other reverted. At each step (each one said when it fails, not only the first): the file's bytes on disk and in the commit, each run's change
// (the file as it found it, its hunks), the lines it is credited with, and who wrote each line as By author shows it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { RunDTO } from '../../src/api/types';
import {
  FAKE_CLAUDE,
  FAKE_CURSOR,
  REPLAY_AGENT,
  REPO_ROOT,
  TWO_SECTIONS,
  call,
  git,
  linkFor,
  startBridge,
  type Bridge,
} from '../support/live';

/** a/tax.mjs as the two-sections test bed has it. */
const ORIGINAL = [
  '/** Tax on an amount in cents, at a rate in percent, rounded to the cent. */',
  'export function tax(cents, percent) {',
  '  return Math.round((cents * percent) / 100);',
  '}',
];
/** Claude Code's input checks, as its real run wrote them: a function at the top, and two calls in tax(). */
const CHECK = [
  'function check(name, value) {',
  "  if (typeof value !== 'number' || !Number.isFinite(value)) {",
  '    throw new TypeError(`${name} must be a finite number, got ${String(value)}`);',
  '  }',
  '  if (value < 0) {',
  '    throw new TypeError(`${name} must not be negative, got ${value}`);',
  '  }',
  '}',
  '',
];
const CALLS = ["  check('cents', cents);", "  check('percent', percent);"];
/** The comment Cursor was asked to add, after tax()'s doc comment. */
const COMMENT = '// b/summary.mjs uses it.';
const NOTE = '// Cart totals.';
const text = (lines: string[]) => lines.join('\n') + '\n';
/** After Claude Code: the 15 lines of the real run's commit (b835c1f). */
const CLAUDE_TAX = [...CHECK, ORIGINAL[0]!, ORIGINAL[1]!, ...CALLS, ORIGINAL[2]!, ORIGINAL[3]!];
/** After Cursor too: its comment at line 10. */
const BOTH_TAX = [...CLAUDE_TAX.slice(0, 10), COMMENT, ...CLAUDE_TAX.slice(10)];

/** Who wrote each line of a/tax.mjs, as [text, writer]: 'claude' is run 1's, 'cursor' run 2's. */
type Writer = 'claude' | 'cursor' | 'unknown';
const writers = (lines: string[], of: (line: string, i: number) => Writer) => lines.map((l, i) => [l, of(l, i)]);
const CLAUDE_WROTE = new Set([...CHECK.keys(), 11, 12]);
const AFTER_CLAUDE = writers(CLAUDE_TAX, (_, i) => (CLAUDE_WROTE.has(i) ? 'claude' : 'unknown'));
const AFTER_BOTH = writers(BOTH_TAX, (_, i) =>
  i === 10 ? 'cursor' : CLAUDE_WROTE.has(i < 10 ? i : i - 1) ? 'claude' : 'unknown',
);

const CLAUDE_PROMPT = 'Add input checks. wait:one insert:a/tax.mjs:0:check insert:a/tax.mjs:11:calls';
const CURSOR_PROMPT = 'Add a daily summary. wait:two insert:a/tax.mjs:10:comment insert:b/cart.mjs:0:note';

/** The two-sections repo, a bridge on it with both stand-ins, and the texts their edits put in. */
async function twoSessions(cursor: string = FAKE_CURSOR, env: Record<string, string> = {}, args: string[] = []) {
  const repo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loa-e2e-')), 'two-sections');
  execFileSync(process.execPath, [TWO_SECTIONS, repo]);
  const b = await startBridge(repo, FAKE_CLAUDE, { LOA_CURSOR_BIN: cursor, ...env }, args);
  for (const [name, lines] of Object.entries({ check: CHECK, calls: CALLS, comment: [COMMENT], note: [NOTE] }))
    fs.writeFileSync(path.join(repo, `.loa/text-${name}`), text(lines));
  const start = async (agent: string, scope: string[], prompt: string) =>
    (await call(b, '/api/runs', { agent, prompt, scope, resumeFrom: null })).body.id as number;
  const go = (name: string) => fs.writeFileSync(path.join(repo, `.loa/go-${name}`), '');
  return { repo, b, start, go };
}
const runOf = async (b: Bridge, id: number) => (await call(b, `/api/runs/${id}`)).body as unknown as RunDTO;
async function ended(b: Bridge, id: number) {
  await expect.poll(async () => (await runOf(b, id)).status, { timeout: 15_000 }).toBe('done');
  return runOf(b, id);
}
const onDisk = (repo: string, file: string) => fs.readFileSync(path.join(repo, file), 'utf8');
const committed = (repo: string, file: string) => git(repo, 'show', `HEAD:${file}`);
const change = (run: RunDTO, file: string) => run.changes.find(c => c.path === file);
const sharedOf = (run: RunDTO) => (run.shared ?? []).map(s => [s.path, s.with]);

/** Who wrote each line of a file on the map, coloured by author: the line, and the run's agent for an agent's. */
async function onMap(page: Page, file: string) {
  for (let i = 0; i < 2; i++) await page.keyboard.press('Escape');
  if ((await page.locator('#byAuthor').getAttribute('aria-pressed')) !== 'true') await page.keyboard.press('c');
  await expect(page.locator('#byAuthor')).toHaveAttribute('aria-pressed', 'true');
  const card = page.locator(`.card[data-path="${file}"]`);
  await card.scrollIntoViewIfNeeded();
  const out: [string, Writer][] = [];
  for (const ln of await card.locator('.ln').all()) {
    // A blank line shows a space, so it keeps its height.
    const said = ((await ln.locator(':scope > span').textContent()) ?? '').trimEnd();
    const cls = (await ln.getAttribute('class')) ?? '';
    if (!/au-agent/.test(cls)) {
      out.push([said, 'unknown']);
      continue;
    }
    await ln.click();
    const who = (await page.locator('#authorLine').textContent()) ?? '';
    out.push([said, /Run 1\b/.test(who) ? 'claude' : /Run 2\b/.test(who) ? 'cursor' : 'unknown']);
  }
  return out;
}

test('two sessions edit one file: each run is credited with its own lines, commit then revert keeps the other run', async ({
  page,
}) => {
  const { repo, b, start, go } = await twoSessions();
  try {
    await page.goto(linkFor(b));
    await expect.soft(page.locator('#conn')).toHaveText('Live');
    // 1. Run 1 starts, then run 2.
    const claude = await start('claude', ['a/'], CLAUDE_PROMPT);
    const cursor = await start('cursor', ['b/'], CURSOR_PROMPT);
    // 2. Run 1 edits the file and ends; run 2 still works.
    go('one');
    const one = await ended(b, claude);
    expect.soft(onDisk(repo, 'a/tax.mjs')).toBe(text(CLAUDE_TAX));
    expect.soft(change(one, 'a/tax.mjs')?.pre).toEqual(ORIGINAL);
    expect.soft(change(one, 'a/tax.mjs')?.hunks).toEqual([
      { at: 0, del: 0, add: CHECK },
      { at: 2, del: 0, add: CALLS },
    ]);
    expect.soft(one.agentLines).toEqual({
      'a/tax.mjs': [
        [0, 8],
        [11, 12],
      ],
    });
    expect.soft((await runOf(b, cursor)).status).toBe('running');
    expect.soft(await onMap(page, 'a/tax.mjs')).toEqual(AFTER_CLAUDE);
    // 3. Run 2 edits the same file, and one of its own, and ends.
    go('two');
    const two = await ended(b, cursor);
    expect.soft(onDisk(repo, 'a/tax.mjs')).toBe(text(BOTH_TAX));
    // Run 2's change is its comment alone, on the file as Claude Code left it.
    expect.soft(change(two, 'a/tax.mjs')?.pre).toEqual(CLAUDE_TAX);
    expect.soft(change(two, 'a/tax.mjs')?.hunks).toEqual([{ at: 10, del: 0, add: [COMMENT] }]);
    expect.soft(two.agentLines).toEqual({ 'a/tax.mjs': [[10, 10]], 'b/cart.mjs': [[0, 0]] });
    // Shared, on both runs; run 1's own change and lines are as they were.
    expect.soft(sharedOf(two)).toEqual([['a/tax.mjs', [claude]]]);
    const oneNow = await runOf(b, claude);
    expect.soft(sharedOf(oneNow)).toEqual([['a/tax.mjs', [cursor]]]);
    expect.soft(change(oneNow, 'a/tax.mjs')?.hunks).toEqual(change(one, 'a/tax.mjs')?.hunks);
    expect.soft(oneNow.agentLines).toEqual(one.agentLines);
    expect.soft(await onMap(page, 'a/tax.mjs')).toEqual(AFTER_BOTH);
    // 4. Run 1 is committed, the shared file chosen: the commit holds run 1's lines, not run 2's.
    const done = await call(b, `/api/runs/${claude}/commit`, { message: 'Add input checks', include: ['a/tax.mjs'] });
    expect.soft(done.status).toBe(200);
    expect.soft(committed(repo, 'a/tax.mjs')).toBe(text(CLAUDE_TAX));
    expect.soft(onDisk(repo, 'a/tax.mjs')).toBe(text(BOTH_TAX));
    // 5. Run 2 is reverted, the shared file chosen: only its comment goes; run 1's committed lines stay.
    const back = await call(b, `/api/runs/${cursor}/revert`, { force: false, shared: ['a/tax.mjs'] });
    expect.soft(back.status).toBe(200);
    expect.soft(onDisk(repo, 'a/tax.mjs')).toBe(text(CLAUDE_TAX));
    expect.soft(onDisk(repo, 'a/tax.mjs')).toBe(committed(repo, 'a/tax.mjs'));
    expect.soft(onDisk(repo, 'b/cart.mjs')).toBe(committed(repo, 'b/cart.mjs'));
    expect.soft(git(repo, 'status', '--porcelain', '--', 'a', 'b')).toBe('');
    expect.soft(await onMap(page, 'a/tax.mjs')).toEqual(AFTER_CLAUDE);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('run 1 waits to be committed while run 2 still works; then each keeps to its own lines', async ({ page }) => {
  const { repo, b, start, go } = await twoSessions();
  try {
    await page.goto(linkFor(b));
    await expect.soft(page.locator('#conn')).toHaveText('Live');
    const claude = await start('claude', ['a/'], CLAUDE_PROMPT);
    const cursor = await start('cursor', ['b/'], CURSOR_PROMPT);
    go('one');
    await ended(b, claude);
    // With run 2 at work, the commit waits (VISION 29): nothing is committed or written.
    const early = await call(b, `/api/runs/${claude}/commit`, { message: 'Add input checks', include: [] });
    expect.soft([early.status, early.body.code]).toEqual([409, 'sessions-working']);
    expect.soft(git(repo, 'log', '--oneline').trim().split('\n')).toHaveLength(1);
    expect.soft(onDisk(repo, 'a/tax.mjs')).toBe(text(CLAUDE_TAX));
    expect.soft((await runOf(b, cursor)).status).toBe('running');
    expect.soft(await onMap(page, 'a/tax.mjs')).toEqual(AFTER_CLAUDE);
    go('two');
    const two = await ended(b, cursor);
    expect.soft(onDisk(repo, 'a/tax.mjs')).toBe(text(BOTH_TAX));
    expect.soft(change(two, 'a/tax.mjs')?.pre).toEqual(CLAUDE_TAX);
    expect.soft(change(two, 'a/tax.mjs')?.hunks).toEqual([{ at: 10, del: 0, add: [COMMENT] }]);
    expect.soft(two.agentLines).toEqual({ 'a/tax.mjs': [[10, 10]], 'b/cart.mjs': [[0, 0]] });
    expect.soft(sharedOf(two)).toEqual([['a/tax.mjs', [claude]]]);
    expect.soft(sharedOf(await runOf(b, claude))).toEqual([['a/tax.mjs', [cursor]]]);
    expect.soft(await onMap(page, 'a/tax.mjs')).toEqual(AFTER_BOTH);
    // Now none works: run 1's commit holds its lines, not run 2's.
    const done = await call(b, `/api/runs/${claude}/commit`, { message: 'Add input checks', include: ['a/tax.mjs'] });
    expect.soft(done.status).toBe(200);
    expect.soft(committed(repo, 'a/tax.mjs')).toBe(text(CLAUDE_TAX));
    const back = await call(b, `/api/runs/${cursor}/revert`, { force: false, shared: ['a/tax.mjs'] });
    expect.soft(back.status).toBe(200);
    expect.soft(onDisk(repo, 'a/tax.mjs')).toBe(text(CLAUDE_TAX));
    expect.soft(git(repo, 'status', '--porcelain', '--', 'a', 'b')).toBe('');
    expect.soft(await onMap(page, 'a/tax.mjs')).toEqual(AFTER_CLAUDE);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('a shared file left unticked stays as both runs left it when the other run is reverted', async () => {
  const { repo, b, start, go } = await twoSessions();
  try {
    const claude = await start('claude', ['a/'], CLAUDE_PROMPT);
    const cursor = await start('cursor', ['b/'], CURSOR_PROMPT);
    go('one');
    await ended(b, claude);
    go('two');
    await ended(b, cursor);
    const back = await call(b, `/api/runs/${cursor}/revert`, { force: false, shared: [] });
    expect.soft(back.status).toBe(200);
    expect.soft(back.body.left).toEqual(['a/tax.mjs']);
    expect.soft(onDisk(repo, 'a/tax.mjs')).toBe(text(BOTH_TAX));
    expect.soft(onDisk(repo, 'b/cart.mjs')).toBe(git(repo, 'show', 'HEAD:b/cart.mjs'));
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// The owner's real run, replayed: Cursor's edit of a/tax.mjs, outside its section, was refused by the hook (its
// own stream, cut and redacted: tests/fixtures/agents/cursor/cursor-refused-edit.jsonl, Cursor 2026.10.16). It
// wrote nothing there, so a/tax.mjs is not its change, none of the file's lines are its, nothing is shared, and
// reverting it leaves the file as Claude Code left it.
test("a Cursor edit the hook refused is no edit: the file isn't its change, and its revert leaves the file", async () => {
  const { repo, b, start, go } = await twoSessions(REPLAY_AGENT, {
    LOA_FIXTURE: path.join(REPO_ROOT, 'tests/fixtures/agents/cursor/cursor-refused-edit.jsonl'),
  });
  try {
    const claude = await start('claude', ['a/'], CLAUDE_PROMPT);
    const cursor = await start('cursor', ['b/'], 'Add a daily summary.');
    go('one');
    await ended(b, claude);
    go('two');
    // The person is asked whether it may change the file, as for Claude Code; refused, the session ends.
    await expect
      .poll(async () => (await runOf(b, cursor)).wants?.map(w => w.path), { timeout: 15_000 })
      .toEqual(['a/tax.mjs']);
    await call(b, `/api/runs/${cursor}/wants`, { path: 'a/tax.mjs', allow: false });
    const two = await ended(b, cursor);
    expect.soft(onDisk(repo, 'a/tax.mjs')).toBe(text(CLAUDE_TAX));
    expect.soft(change(two, 'a/tax.mjs')).toBeUndefined();
    expect.soft(two.agentLines?.['a/tax.mjs']).toBeUndefined();
    expect.soft(two.shared ?? []).toEqual([]);
    expect.soft((await runOf(b, claude)).shared ?? []).toEqual([]);
    const steps = (await call(b, `/api/runs/${cursor}/steps?from=0`)).body.steps as { file?: string; refused?: true }[];
    expect.soft(steps.filter(s => s.file === 'a/tax.mjs').map(s => !!s.refused)).toEqual([true]);
    expect.soft(JSON.stringify(two.stream)).toContain('Tried to change a/tax.mjs. Blocked.');
    expect.soft((await call(b, `/api/runs/${cursor}/revert`, { force: false, shared: [] })).status).toBe(200);
    expect.soft(onDisk(repo, 'a/tax.mjs')).toBe(text(CLAUDE_TAX));
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// What the person sees of that refusal, in the app: before the run and on its card, that Cursor asks before an edit
// outside its section while the hooks it runs are in, its commands not held; then the edit it was refused, asked on
// its card with Allow and Refuse (owner, VISION 29 item 5).
test("Cursor's card says it asks before editing outside, and its refused edit is asked with Allow and Refuse", async ({
  page,
}) => {
  const { repo, b, go } = await twoSessions(REPLAY_AGENT, {
    LOA_FIXTURE: path.join(REPO_ROOT, 'tests/fixtures/agents/cursor/cursor-refused-edit.jsonl'),
  });
  const ASKS = 'Asks before editing outside your selection; its commands can still change files there.';
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await page.locator('.frame[data-dir="b"] > .flabel b').click();
    await page.locator('#agentBtn').click();
    await page.locator('#agentMenu [data-agent="cursor"]').click();
    await expect(page.locator('#reach')).toHaveText(ASKS);
    await page.locator('#prompt').fill('Add a daily summary.');
    await page.locator('#prompt').press('Enter');
    const card = page.locator('#sideList [data-run="1"]');
    await expect(card.locator('.reach')).toHaveText(ASKS);
    // The replay waits for this before its edit.
    go('two');
    const ask = card.locator('[data-want="a/tax.mjs"]');
    await expect(ask).toContainText('Wants to change a/tax.mjs', { timeout: 15_000 });
    await expect(ask.locator('[data-allow]')).toBeEnabled();
    await expect(ask.locator('[data-refuse]')).toBeEnabled();
    // On the map too, the file it was refused is said as blocked, not as an edit.
    await expect(page.locator('.marker[data-run="1"] b')).toHaveText('Blocked');
    for (const [width, theme] of [
      [1440, 'light'],
      [1440, 'dark'],
      [760, 'light'],
      [760, 'dark'],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({ path: test.info().outputPath(`cursor-refused-edit-asked-${width}x900-${theme}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1440, height: 900 });
    // Refused: the file stays as it was, and the run says it was blocked.
    await ask.locator('[data-refuse]').click();
    await expect.poll(async () => (await runOf(b, 1)).status, { timeout: 15_000 }).toBe('done');
    expect(onDisk(repo, 'a/tax.mjs')).toBe(text(ORIGINAL));
    expect(JSON.stringify((await runOf(b, 1)).stream)).toContain('Tried to change a/tax.mjs. Blocked.');
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// The real run's order, had Cursor's edit gone through: Claude Code writes a/tax.mjs by a shell command, which no hook
// brackets here, so nobody's writes are seen in it; then Cursor adds its comment. Cursor's change is its line alone,
// Claude Code's commit holds none of it, and reverting Cursor's run takes only it out.
test('a file one session wrote by a command and the other edited: each has its own, and the revert keeps the command', async () => {
  const { repo, b, start, go } = await twoSessions(FAKE_CURSOR, {}, ['--no-hooks']);
  const SHELL = '// written by a shell command';
  try {
    const cursor = await start('cursor', ['b/'], 'Add a daily summary. wait:two insert:a/tax.mjs:1:comment');
    const claude = await start('claude', ['a/'], 'Add input checks. shell:a/tax.mjs');
    const one = await ended(b, claude);
    expect.soft(onDisk(repo, 'a/tax.mjs')).toBe(text([...ORIGINAL, SHELL]));
    expect.soft(change(one, 'a/tax.mjs')?.hunks).toEqual([{ at: 4, del: 0, add: [SHELL] }]);
    // Written by its command while it alone was writing in a/: Claude Code's, by a command (VISION 30).
    expect.soft(one.agentLines).toEqual({ 'a/tax.mjs': [[4, 4]] });
    expect.soft(one.commandLines).toEqual({ 'a/tax.mjs': [[4, 4]] });
    go('two');
    const two = await ended(b, cursor);
    const both = [ORIGINAL[0]!, COMMENT, ...ORIGINAL.slice(1), SHELL];
    expect.soft(onDisk(repo, 'a/tax.mjs')).toBe(text(both));
    expect.soft(change(two, 'a/tax.mjs')?.pre).toEqual([...ORIGINAL, SHELL]);
    expect.soft(change(two, 'a/tax.mjs')?.hunks).toEqual([{ at: 1, del: 0, add: [COMMENT] }]);
    expect.soft(two.agentLines).toEqual({ 'a/tax.mjs': [[1, 1]] });
    // Committed after Cursor's line: the commit holds the command's line, not Cursor's.
    const done = await call(b, `/api/runs/${claude}/commit`, { message: 'Add input checks', include: [] });
    expect.soft(done.status).toBe(200);
    expect.soft(committed(repo, 'a/tax.mjs')).toBe(text([...ORIGINAL, SHELL]));
    expect.soft(onDisk(repo, 'a/tax.mjs')).toBe(text(both));
    const back = await call(b, `/api/runs/${cursor}/revert`, { force: false, shared: [] });
    expect.soft(back.status).toBe(200);
    expect.soft(onDisk(repo, 'a/tax.mjs')).toBe(committed(repo, 'a/tax.mjs'));
    expect.soft(git(repo, 'status', '--porcelain', '--', 'a', 'b')).toBe('');
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// A command Claude Code runs is bracketed by the hooks: its write is its run's, so a file it wrote and Cursor edited
// is shared, each run's change its own, Claude Code's commit holds the command's line alone, and reverting Cursor's
// run takes only its comment out.
test('a bracketed command and an edit make a shared file: commit and revert each keep to their own run', async () => {
  const { repo, b, start, go } = await twoSessions();
  const SHELL = '// written by a shell command';
  try {
    const cursor = await start('cursor', ['b/'], 'Add a daily summary. wait:two insert:a/tax.mjs:1:comment');
    const claude = await start('claude', ['a/'], 'Add input checks. shell:a/tax.mjs');
    const one = await ended(b, claude);
    expect.soft(one.agentLines).toEqual({ 'a/tax.mjs': [[4, 4]] });
    expect.soft(one.commandLines).toEqual({ 'a/tax.mjs': [[4, 4]] });
    go('two');
    const two = await ended(b, cursor);
    const both = [ORIGINAL[0]!, COMMENT, ...ORIGINAL.slice(1), SHELL];
    expect.soft(onDisk(repo, 'a/tax.mjs')).toBe(text(both));
    expect.soft(change(two, 'a/tax.mjs')?.hunks).toEqual([{ at: 1, del: 0, add: [COMMENT] }]);
    expect.soft(sharedOf(two)).toEqual([['a/tax.mjs', [claude]]]);
    expect.soft(sharedOf(await runOf(b, claude))).toEqual([['a/tax.mjs', [cursor]]]);
    const done = await call(b, `/api/runs/${claude}/commit`, { message: 'Add input checks', include: ['a/tax.mjs'] });
    expect.soft(done.status).toBe(200);
    expect.soft(committed(repo, 'a/tax.mjs')).toBe(text([...ORIGINAL, SHELL]));
    expect.soft(onDisk(repo, 'a/tax.mjs')).toBe(text(both));
    const back = await call(b, `/api/runs/${cursor}/revert`, { force: false, shared: ['a/tax.mjs'] });
    expect.soft(back.status).toBe(200);
    expect.soft(onDisk(repo, 'a/tax.mjs')).toBe(committed(repo, 'a/tax.mjs'));
    expect.soft(git(repo, 'status', '--porcelain', '--', 'a', 'b')).toBe('');
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// A shared file whose commit waits for a third session: once it ends, the commit holds this run's lines, the file
// holds the other run's again after it (the bridge's own write), and no run by none of them is made of it.
test('a shared file waits for a third session to be committed, and leaves no run by none of them', async () => {
  const { repo, b, start, go } = await twoSessions();
  try {
    const claude = await start('claude', ['a/'], CLAUDE_PROMPT);
    const cursor = await start('cursor', ['b/'], CURSOR_PROMPT);
    const third = await start('cursor', ['package.json'], 'Look at the scripts. wait:three read:package.json');
    go('one');
    await ended(b, claude);
    go('two');
    await ended(b, cursor);
    const early = await call(b, `/api/runs/${claude}/commit`, { message: 'Add input checks', include: ['a/tax.mjs'] });
    expect.soft([early.status, early.body.code]).toEqual([409, 'sessions-working']);
    go('three');
    await ended(b, third);
    const done = await call(b, `/api/runs/${claude}/commit`, { message: 'Add input checks', include: ['a/tax.mjs'] });
    expect.soft(done.status).toBe(200);
    expect.soft(committed(repo, 'a/tax.mjs')).toBe(text(CLAUDE_TAX));
    expect.soft(onDisk(repo, 'a/tax.mjs')).toBe(text(BOTH_TAX));
    const state = (await call(b, '/api/state')).body as unknown as { runs: RunDTO[] };
    expect.soft(state.runs.map(r => r.agent)).toEqual(['claude', 'cursor', 'cursor']);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// Revert takes out only the run's own lines. Where a later edit touches them (one of its lines changed by hand),
// the two can't be told apart: the file stays as it is and the revert says so, never putting it back whole.
test('a later edit that touches the run’s lines: Revert leaves that file as it is and says so', async () => {
  const { repo, b, start, go } = await twoSessions();
  try {
    const claude = await start('claude', ['a/'], CLAUDE_PROMPT);
    go('one');
    await ended(b, claude);
    const later = text(CLAUDE_TAX.map(l => (l === CALLS[0] ? `${l} // checked by hand` : l)));
    fs.writeFileSync(path.join(repo, 'a/tax.mjs'), later);
    const asked = await call(b, `/api/runs/${claude}/revert`, { force: false, shared: [] });
    expect.soft(asked.status).toBe(409);
    expect.soft(asked.body.conflict).toEqual(['a/tax.mjs']);
    const back = await call(b, `/api/runs/${claude}/revert`, { force: true, shared: [] });
    expect.soft([back.status, back.body]).toEqual([200, { ok: true, left: ['a/tax.mjs'] }]);
    expect.soft(onDisk(repo, 'a/tax.mjs')).toBe(later);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// An edit whose start wasn't seen (the stand-in writes before it says so) lands inside a long shell command of the
// other session's on the same file. Neither write can be told apart from the other: reverting either run leaves the
// file as it is and says so, and no line of the other's is lost.
test("an edit with no start seen, inside another session's command on the file: Revert loses no one's line", async () => {
  const { repo, b, start, go } = await twoSessions(FAKE_CURSOR, { FAKE_CURSOR_WRITES_FIRST: '1' });
  const SHELL = '// written by a shell command';
  try {
    const cursor = await start('cursor', ['b/'], 'Add a daily summary. wait:c edit:a/tax.mjs');
    const claude = await start('claude', ['a/'], 'Run the tests. shell:a/tax.mjs:d');
    await expect.poll(() => onDisk(repo, 'a/tax.mjs')).toContain(SHELL);
    go('c');
    await ended(b, cursor);
    go('d');
    await ended(b, claude);
    const both = onDisk(repo, 'a/tax.mjs');
    expect.soft(both).toContain(SHELL);
    expect.soft(both).toContain('// edited by cursor');
    const back = await call(b, `/api/runs/${cursor}/revert`, { force: false, shared: ['a/tax.mjs'] });
    expect.soft([back.status, back.body]).toEqual([200, { ok: true, left: ['a/tax.mjs'] }]);
    expect.soft(onDisk(repo, 'a/tax.mjs')).toBe(both);
    const first = await call(b, `/api/runs/${claude}/revert`, { force: false, shared: ['a/tax.mjs'] });
    expect.soft([first.status, first.body]).toEqual([200, { ok: true, left: ['a/tax.mjs'] }]);
    expect.soft(onDisk(repo, 'a/tax.mjs')).toBe(both);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// The order turned round: Cursor's run is committed first. Its file is outside its section and Claude Code wrote it
// by a command no hook brackets, so the commit holds Cursor's line alone, not Claude Code's uncommitted one.
test("a run's commit of a file outside its section holds its lines alone, not another's uncommitted ones", async () => {
  const { repo, b, start, go } = await twoSessions(FAKE_CURSOR, {}, ['--no-hooks']);
  const SHELL = '// written by a shell command';
  try {
    const cursor = await start('cursor', ['b/'], 'Add a daily summary. wait:two insert:a/tax.mjs:1:comment');
    const claude = await start('claude', ['a/'], 'Add input checks. shell:a/tax.mjs');
    await ended(b, claude);
    go('two');
    await ended(b, cursor);
    const done = await call(b, `/api/runs/${cursor}/commit`, { message: 'Note where tax is used', include: [] });
    expect.soft(done.status).toBe(200);
    expect.soft(committed(repo, 'a/tax.mjs')).toBe(text([ORIGINAL[0]!, COMMENT, ...ORIGINAL.slice(1)]));
    expect.soft(onDisk(repo, 'a/tax.mjs')).toBe(text([ORIGINAL[0]!, COMMENT, ...ORIGINAL.slice(1), SHELL]));
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// As "a shared file waits for a third session", in a repo with no pre-commit hook: nothing is held while git commits,
// and still no run by none of them is made of the other run's lines.
test('a shared file waits for a third session to be committed, with no commit hook, and leaves no run by none of them', async () => {
  const { repo, b, start, go } = await twoSessions();
  try {
    fs.rmSync(path.join(repo, '.git/hooks/pre-commit'));
    const claude = await start('claude', ['a/'], CLAUDE_PROMPT);
    const cursor = await start('cursor', ['b/'], CURSOR_PROMPT);
    const third = await start('cursor', ['package.json'], 'Look at the scripts. wait:three read:package.json');
    go('one');
    await ended(b, claude);
    go('two');
    await ended(b, cursor);
    const early = await call(b, `/api/runs/${claude}/commit`, { message: 'Add input checks', include: ['a/tax.mjs'] });
    expect.soft([early.status, early.body.code]).toEqual([409, 'sessions-working']);
    go('three');
    await ended(b, third);
    const done = await call(b, `/api/runs/${claude}/commit`, { message: 'Add input checks', include: ['a/tax.mjs'] });
    expect.soft(done.status).toBe(200);
    expect.soft(committed(repo, 'a/tax.mjs')).toBe(text(CLAUDE_TAX));
    expect.soft(onDisk(repo, 'a/tax.mjs')).toBe(text(BOTH_TAX));
    const state = (await call(b, '/api/state')).body as unknown as { runs: RunDTO[] };
    expect.soft(state.runs.map(r => r.agent)).toEqual(['claude', 'cursor', 'cursor']);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// Cursor's run, which wrote a file in Claude Code's section, is committed while Claude Code still works there: the
// commit waits, as every commit does while a session works, and Claude Code's change on it stays its own when it ends.
test("a run's file in a section still at work can't be committed until that session ends", async () => {
  const { repo, b, start, go } = await twoSessions(FAKE_CURSOR, {}, ['--no-hooks']);
  const SHELL = '// written by a shell command';
  try {
    const claude = await start('claude', ['a/'], 'Run the tests. shell:a/tax.mjs:d');
    await expect.poll(() => onDisk(repo, 'a/tax.mjs')).toContain(SHELL);
    const cursor = await start('cursor', ['b/'], 'Add a daily summary. insert:a/tax.mjs:1:comment');
    await ended(b, cursor);
    const early = await call(b, `/api/runs/${cursor}/commit`, { message: 'Note where tax is used', include: [] });
    expect.soft([early.status, early.body.code]).toEqual([409, 'sessions-working']);
    go('d');
    // Claude Code's change on the file is its command's line, without Cursor's; both wrote it, so it is shared.
    const one = await ended(b, claude);
    expect.soft(change(one, 'a/tax.mjs')?.hunks).toEqual([{ at: 4, del: 0, add: [SHELL] }]);
    expect.soft(sharedOf(one)).toEqual([['a/tax.mjs', [cursor]]]);
    const done = await call(b, `/api/runs/${cursor}/commit`, {
      message: 'Note where tax is used',
      include: ['a/tax.mjs'],
    });
    expect.soft(done.status).toBe(200);
    expect.soft(committed(repo, 'a/tax.mjs')).toBe(text([ORIGINAL[0]!, COMMENT, ...ORIGINAL.slice(1)]));
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});
