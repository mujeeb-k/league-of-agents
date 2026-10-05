// Lines selected for an agent are held by their text, not their numbers: when the file changes before the run,
// the agent gets the lines that were selected, or the app says they changed. Never other code at the old numbers.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { RunDTO, StateResponse } from '../../src/api/types';
import { anchorAt, toLines } from '../../src/lib/anchor';
import { BRIDGE, PROBE_AGENT, SEED, SLOW_AGENT, git, makeRepo, startBridge, type Bridge } from '../support/live';
import { TOAST } from '../support/targets';

const FILE = 'shared/allowlist.ts';
const linkFor = (b: Bridge) => `http://127.0.0.1:${b.port}/#t=${b.token}`;
// Lines 3 to 5 of the seeded file: loadPolicy.
const SELECTED = SEED[FILE]!.split('\n').slice(2, 5);
/** What the app sends with selected lines: their text and the lines around them, taken from `text`. */
const held = (text: string, from: number, to: number) => {
  const { text: t, ...near } = anchorAt(toLines(text), from, to);
  return { lines: { [FILE]: t.join('\n') }, context: { [FILE]: near } };
};

async function call(b: Bridge, route: string, body?: object) {
  const res = await fetch(`http://127.0.0.1:${b.port}${route}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: 'Bearer ' + b.token, 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** Opens the file in the editor and selects lines from..to. */
async function selectLines(page: Page, from: number, to: number) {
  await page.keyboard.press('0');
  await page.locator(`.fr[data-path="${FILE}"]`).click();
  await page.keyboard.press('Enter');
  await expect(page.locator('#editor .cm-content')).toBeFocused();
  await reselect(page, from, to);
}
/** Selects lines from..to in the open editor. */
async function reselect(page: Page, from: number, to: number) {
  await page
    .locator('#editor .cm-line')
    .nth(from - 1)
    .click();
  await page.keyboard.press('Home');
  for (let i = from; i <= to; i++) await page.keyboard.press('Shift+ArrowDown');
}
/** The scope chips, follow-up notes left out. */
const chip = (page: Page) => page.locator('#scopeRow .chip:not(.all):not(.fu) > span');
async function run(page: Page, prompt = 'Load the policy from the environment') {
  await page.locator('#prompt').fill(prompt);
  await page.locator('#prompt').press('Enter');
}
/** The prompts the stand-in agent was given, and the lines each one names, read from the file at that moment. */
const prompts = (log: string) =>
  fs.existsSync(log)
    ? fs
        .readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map(l => JSON.parse(l) as { prompt: string })
    : [];
const named = (prompt: string) => {
  const m = /lines (\d+) to (\d+)/.exec(prompt)!;
  return [+m[1]!, +m[2]!] as const;
};

/** A live bridge with the stand-in agent that records its prompts, on a fresh repo. */
async function withProbe(
  fn: (b: Bridge, repo: string, log: string) => Promise<void>,
  env: (repo: string) => Record<string, string> = () => ({}),
) {
  const repo = makeRepo();
  const log = path.join(path.dirname(repo), 'prompts.log');
  const b = await startBridge(repo, PROBE_AGENT, { PROBE_LOG: log, LOA_QUIET_MS: '300', ...env(repo) }, ['--no-hooks']);
  try {
    await fn(b, repo, log);
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
}

test('lines added above the selection outside the app: the selection follows its code, and the agent gets it', ({
  page,
}) =>
  withProbe(async (b, repo, log) => {
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await selectLines(page, 3, 5);
    await expect(chip(page)).toHaveText(['allowlist.ts:3–5']);
    fs.writeFileSync(path.join(repo, FILE), '// added outside\n// and again\n' + SEED[FILE]);
    await expect(chip(page)).toHaveText(['allowlist.ts:5–7'], { timeout: 10_000 });
    await run(page);
    await expect.poll(() => prompts(log).length, { timeout: 15_000 }).toBe(1);
    const [from, to] = named(prompts(log)[0]!.prompt);
    expect(
      fs
        .readFileSync(path.join(repo, FILE), 'utf8')
        .split('\n')
        .slice(from - 1, to),
    ).toEqual(SELECTED);
    // Watch mode recorded the edit outside as a run of its own; the agent's run is scoped to where the lines are now.
    const agentRun = ((await call(b, '/api/state')).body.runs as RunDTO[]).find(r => r.agent === 'claude');
    expect(agentRun!.scope).toEqual([`${FILE}:5-7`]);
  }));

test('a branch switch moves the selected code: the selection follows it', ({ page }) =>
  withProbe(async (b, repo, log) => {
    git(repo, 'checkout', '-qb', 'other');
    fs.writeFileSync(path.join(repo, FILE), '// one\n// two\n// three\n' + SEED[FILE]);
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qam', 'moved');
    git(repo, 'checkout', '-q', 'main');
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await selectLines(page, 3, 5);
    git(repo, 'checkout', '-q', 'other');
    await expect(chip(page)).toHaveText(['allowlist.ts:6–8'], { timeout: 10_000 });
    await run(page);
    await expect.poll(() => prompts(log).length, { timeout: 15_000 }).toBe(1);
    const [from, to] = named(prompts(log)[0]!.prompt);
    expect(
      fs
        .readFileSync(path.join(repo, FILE), 'utf8')
        .split('\n')
        .slice(from - 1, to),
    ).toEqual(SELECTED);
  }));

for (const [what, change] of [
  ['partly', (t: string) => t.replace('loadPolicy(): Policy {', 'loadPolicy(env = process.env): Policy {')],
  [
    'fully',
    (t: string) =>
      t
        .split('\n')
        .filter((_, i) => i < 2 || i > 4)
        .join('\n'),
  ],
] as const)
  test(`the selected lines change ${what}: the selection says so, and nothing runs on other code`, ({ page }) =>
    withProbe(async (b, repo, log) => {
      await page.goto(linkFor(b));
      await expect(page.locator('#conn')).toHaveText('Live');
      await selectLines(page, 3, 5);
      fs.writeFileSync(path.join(repo, FILE), change(SEED[FILE]!));
      await expect(chip(page)).toHaveText(['allowlist.ts:3–5 · changed'], { timeout: 10_000 });
      await expect(page.locator('#scopeRow .chip.stale')).toHaveAttribute(
        'title',
        'The lines you selected in allowlist.ts changed. Select them again.',
      );
      await expect(page.locator('#staleSelection')).toHaveText(
        'The lines you selected in allowlist.ts changed. Select them again.',
      );
      await page.locator('#prompt').fill('Load the policy from the environment');
      await expect(page.locator('#sendBtn')).toBeDisabled();
      await page.locator('#prompt').press('Enter');
      await expect(page.locator(TOAST)).toHaveText(
        'The lines you selected in allowlist.ts changed. Select them again.',
      );
      await page.waitForTimeout(1500);
      expect(prompts(log)).toEqual([]);
      // Selecting lines again clears it.
      await reselect(page, 3, 4);
      await expect(chip(page)).toHaveText(['allowlist.ts:3–4']);
      await expect(page.locator('#staleSelection')).toHaveCount(0);
      await expect(page.locator('#sendBtn')).toBeEnabled();
    }));

test('an unsaved edit in the file: the run waits for it to be saved, since the agent works on the saved file', ({
  page,
}) =>
  withProbe(async (b, _repo, log) => {
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await selectLines(page, 3, 5);
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.type('// draft line\n');
    await reselect(page, 4, 6);
    await expect(chip(page)).toHaveText(['allowlist.ts:4–6']);
    await run(page);
    await expect(page.locator(TOAST)).toHaveText(
      'Save your changes to allowlist.ts first: the agent works on the saved file.',
    );
    await page.waitForTimeout(1500);
    expect(prompts(log)).toEqual([]);
  }));

test('a follow-up on the same selection after the first run added lines above it gets the same code', ({ page }) =>
  withProbe(
    async (b, repo, log) => {
      await page.goto(linkFor(b));
      await expect(page.locator('#conn')).toHaveText('Live');
      await selectLines(page, 3, 5);
      await run(page, 'First');
      await expect.poll(() => prompts(log).length, { timeout: 15_000 }).toBe(1);
      expect(named(prompts(log)[0]!.prompt)).toEqual([3, 5]);
      await expect(chip(page)).toHaveText(['allowlist.ts:5–7'], { timeout: 10_000 });
      await expect
        .poll(async () => ((await call(b, '/api/state')).body as unknown as StateResponse).active, {
          timeout: 15_000,
        })
        .toBeFalsy();
      await run(page, 'Second');
      await expect.poll(() => prompts(log).length, { timeout: 15_000 }).toBe(2);
      const [from, to] = named(prompts(log)[1]!.prompt);
      // The stand-in agent added two more lines above before this check: the code is now two lines lower again.
      expect(
        fs
          .readFileSync(path.join(repo, FILE), 'utf8')
          .split('\n')
          .slice(from + 1, to + 2),
      ).toEqual(SELECTED);
      expect([from, to]).toEqual([5, 7]);
    },
    repo => ({ PROBE_PREPEND: path.join(repo, FILE) }),
  ));

test('an agent edits inside the selection: the selection takes the lines it left, and a follow-up runs on them', ({
  page,
}) =>
  withProbe(
    async (b, repo, log) => {
      const sent: { scope: string[]; lines: Record<string, string> }[] = [];
      page.on('request', r => {
        if (r.method() === 'POST' && r.url().endsWith('/api/runs')) sent.push(r.postDataJSON());
      });
      await page.goto(linkFor(b));
      await expect(page.locator('#conn')).toHaveText('Live');
      await selectLines(page, 3, 5);
      await run(page, 'First');
      await expect.poll(() => prompts(log).length, { timeout: 15_000 }).toBe(1);
      // The agent added a line after line 3: the selection is lines 3–6 now, not "changed".
      await expect(chip(page)).toHaveText(['allowlist.ts:3–6'], { timeout: 10_000 });
      await expect(page.locator('#staleSelection')).toHaveCount(0);
      await expect
        .poll(async () => ((await call(b, '/api/state')).body as unknown as StateResponse).active, {
          timeout: 15_000,
        })
        .toBeFalsy();
      const grownLines = fs.readFileSync(path.join(repo, FILE), 'utf8').split('\n').slice(2, 6);
      expect(grownLines[1]).toBe('  // added by the agent');
      await run(page, 'Second');
      await expect.poll(() => prompts(log).length, { timeout: 15_000 }).toBe(2);
      expect(sent[1]).toMatchObject({ scope: [`${FILE}:3-6`], lines: { [FILE]: grownLines.join('\n') } });
      expect(named(prompts(log)[1]!.prompt)).toEqual([3, 6]);
    },
    repo => ({ PROBE_INSERT: `${path.join(repo, FILE)}:3` }),
  ));

test('an agent removes every selected line while a copy of them sits elsewhere: the selection is removed, not moved to the copy', ({
  page,
}) =>
  withProbe(
    async (b, repo, log) => {
      fs.writeFileSync(path.join(repo, FILE), SEED[FILE] + '\n' + SELECTED.join('\n') + '\n');
      git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qam', 'copy');
      const sent: { scope: string[]; lines?: Record<string, string> }[] = [];
      page.on('request', r => {
        if (r.method() === 'POST' && r.url().endsWith('/api/runs')) sent.push(r.postDataJSON());
      });
      await page.goto(linkFor(b));
      await expect(page.locator('#conn')).toHaveText('Live');
      await selectLines(page, 3, 5);
      await run(page, 'Remove loadPolicy');
      await expect.poll(() => prompts(log).length, { timeout: 15_000 }).toBe(1);
      const removed = 'The lines you selected in allowlist.ts were removed. Select lines again.';
      await expect(chip(page)).toHaveText(['allowlist.ts:3–5 · removed'], { timeout: 10_000 });
      await expect(page.locator('#staleSelection')).toHaveText(removed);
      await expect
        .poll(async () => ((await call(b, '/api/state')).body as unknown as StateResponse).active, {
          timeout: 15_000,
        })
        .toBeFalsy();
      await page.locator('#prompt').fill('Next');
      await expect(page.locator('#sendBtn')).toBeDisabled();
      await page.locator('#prompt').press('Enter');
      await expect(page.locator(TOAST)).toHaveText(removed);
      await page.waitForTimeout(1000);
      expect(sent).toHaveLength(1);
      // One click clears the lines and keeps the file in scope: the next prompt goes out on the whole file.
      await page.getByRole('button', { name: 'Clear the selected lines' }).click();
      await expect(chip(page)).toHaveText(['allowlist.ts']);
      await expect(page.locator('#staleSelection')).toHaveCount(0);
      await page.locator('#prompt').press('Enter');
      await expect.poll(() => sent.length, { timeout: 10_000 }).toBe(2);
      expect(sent[1]!.scope).toEqual([FILE]);
      expect(sent[1]!.lines).toBeUndefined();
    },
    repo => ({ PROBE_DELETE: `${path.join(repo, FILE)}:3-5` }),
  ));

test('each agent is told to edit only inside the scope; Claude Code is also told its edit tools are blocked', () =>
  withProbe(
    async (b, _repo, log) => {
      const settle = () =>
        expect
          .poll(async () => ((await call(b, '/api/state')).body as unknown as StateResponse).active, {
            timeout: 15_000,
          })
          .toBeFalsy();
      for (const agent of ['claude', 'codex', 'cursor']) {
        const r = await call(b, '/api/runs', {
          agent,
          prompt: 'Probe',
          scope: [`${FILE}:3-5`, 'apps/'],
          resumeFrom: null,
          ...held(SEED[FILE]!, 3, 5),
        });
        expect(r.status).toBe(200);
        await settle();
      }
      const lines = fs
        .readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map(l => (JSON.parse(l) as { args: string[] }).args);
      const told = (args: string[]) => args.find(a => a.startsWith('Scope for this task'));
      const common = [
        'Scope for this task:',
        `- ${FILE}, lines 3 to 5 only: keep every other line of this file as it is`,
        '- apps/',
        'Edit only inside this scope. Changes outside it are reported to the user and can be undone.',
      ].join('\n');
      expect(told(lines[0]!)).toBe(common + '\nEdits outside it made with edit tools are blocked.\n\nProbe');
      expect(told(lines[1]!)).toBe(common + '\n\nProbe');
      expect(told(lines[2]!)).toBe(common + '\n\nProbe');
    },
    () => ({ LOA_CODEX_BIN: PROBE_AGENT, LOA_CURSOR_BIN: PROBE_AGENT }),
  ));

test('the bridge finds selected lines by their text and the lines around them: moved, kept, or refused', () =>
  withProbe(async (b, repo) => {
    const start = (scope: string[], body: object = held(SEED[FILE]!, 3, 5)) =>
      call(b, '/api/runs', { agent: 'claude', prompt: 'Probe', scope, resumeFrom: null, ...body });
    const settle = () =>
      expect
        .poll(async () => ((await call(b, '/api/state')).body as unknown as StateResponse).active, {
          timeout: 15_000,
        })
        .toBeFalsy();
    const write = (text: string) => fs.writeFileSync(path.join(repo, FILE), text);
    // Moved: two lines above them. The run is scoped to where they are now.
    write('// a\n// b\n' + SEED[FILE]);
    const moved = await start([`${FILE}:3-5`]);
    expect(moved.status).toBe(200);
    expect(moved.body.scope).toEqual([`${FILE}:5-7`]);
    await settle();
    // Windows line endings, in the file and in the selection.
    write(SEED[FILE]!.replace(/\n/g, '\r\n'));
    const crlf = await start([`${FILE}:3-5`], {
      ...held(SEED[FILE]!, 3, 5),
      lines: { [FILE]: SELECTED.join('\r\n') },
    });
    expect(crlf.body.scope).toEqual([`${FILE}:3-5`]);
    await settle();
    // Changed: refused, with the reason, and no run.
    const refused = {
      status: 409,
      body: { error: 'The lines you selected in allowlist.ts changed. Select them again.', stale: FILE },
    };
    write(SEED[FILE]!.replace('loadPolicy()', 'loadPolicy(env)'));
    expect(await start([`${FILE}:3-5`])).toEqual(refused);
    // A line found in more than one place: the lines above the selected one tell it apart.
    write('// a\n' + SEED[FILE]);
    const brace = await start([`${FILE}:5-5`], held(SEED[FILE]!, 5, 5));
    expect(brace.body.scope).toEqual([`${FILE}:6-6`]);
    await settle();
    // Deleted, with an identical copy elsewhere: refused, never moved to the copy.
    const withCopy = SEED[FILE] + '\n// Kept for the old console.\n' + SELECTED.join('\n') + '\n';
    const deleted = withCopy.split('\n');
    deleted.splice(2, 3);
    write(deleted.join('\n'));
    expect(await start([`${FILE}:3-5`], held(withCopy, 3, 5))).toEqual(refused);
    // Without the lines around them (apps before 0.1.2): taken only where their numbers say.
    write('// a\n// b\n' + SEED[FILE]);
    expect(await start([`${FILE}:3-5`], { lines: { [FILE]: SELECTED.join('\n') } })).toEqual(refused);
    write(SEED[FILE]!);
    const still = await start([`${FILE}:3-5`], { lines: { [FILE]: SELECTED.join('\n') } });
    expect(still.body.scope).toEqual([`${FILE}:3-5`]);
    await settle();
    // Without the text, the numbers are used as given.
    const plain = await start([`${FILE}:3-5`], {});
    expect(plain.body.scope).toEqual([`${FILE}:3-5`]);
    await settle();
  }));

test('a rebase moves code that has an identical copy: the selection follows the copy that was picked', ({ page }) =>
  withProbe(async (b, repo, log) => {
    const withCopy = SEED[FILE] + '\n// Kept for the old console.\n' + SELECTED.join('\n') + '\n';
    fs.writeFileSync(path.join(repo, FILE), withCopy);
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qam', 'copy');
    git(repo, 'checkout', '-qb', 'upstream');
    fs.writeFileSync(path.join(repo, FILE), '// one\n// two\n// three\n' + withCopy);
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qam', 'header');
    git(repo, 'checkout', '-q', 'main');
    await page.goto(linkFor(b));
    await expect(page.locator('#conn')).toHaveText('Live');
    await selectLines(page, 3, 5);
    git(repo, 'rebase', '-q', 'upstream');
    await expect(chip(page)).toHaveText(['allowlist.ts:6–8'], { timeout: 10_000 });
    await run(page);
    await expect.poll(() => prompts(log).length, { timeout: 15_000 }).toBe(1);
    expect(named(prompts(log)[0]!.prompt)).toEqual([6, 8]);
  }));

test('after a move, the scope lock holds the lines where they are now, not the old numbers', async () => {
  const repo = makeRepo();
  const b = await startBridge(repo, SLOW_AGENT, {}, ['--no-hooks']);
  try {
    fs.writeFileSync(path.join(repo, FILE), '// a\n// b\n' + SEED[FILE]);
    const r = await call(b, '/api/runs', {
      agent: 'claude',
      prompt: 'Probe',
      scope: [`${FILE}:3-5`],
      resumeFrom: null,
      ...held(SEED[FILE]!, 3, 5),
    });
    expect(r.body.scope).toEqual([`${FILE}:5-7`]);
    const scopeFile = path.join(repo, '.loa/scope.json');
    const pre = (tool_input: object) => {
      try {
        execFileSync(process.execPath, [BRIDGE, 'hook', 'pre'], {
          cwd: repo,
          input: JSON.stringify({ cwd: repo, tool_input: { file_path: path.join(repo, FILE), ...tool_input } }),
          env: { ...process.env, LOA_SCOPE_FILE: scopeFile },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return 'allowed';
      } catch (e) {
        return (e as { status: number }).status === 2 ? 'blocked' : 'error';
      }
    };
    // Inside the selected code, now at lines 5–7: allowed.
    expect(
      pre({
        old_string: 'export function loadPolicy(): Policy {',
        new_string: 'export function loadPolicy(env = process.env): Policy {',
      }),
    ).toBe('allowed');
    // What now sits at the old numbers, 3–5, is outside the selection: blocked.
    expect(pre({ old_string: 'export type Policy', new_string: 'export type Rules' })).toBe('blocked');
    await call(b, `/api/runs/${(r.body as unknown as RunDTO).id}/cancel`, {});
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('after the selection grows, the scope lock holds the new range: its new line is open, the line after is not', async () => {
  const repo = makeRepo();
  const b = await startBridge(repo, SLOW_AGENT, {}, ['--no-hooks']);
  try {
    const lines = SEED[FILE]!.split('\n');
    lines.splice(3, 0, '  // added by the agent');
    fs.writeFileSync(path.join(repo, FILE), lines.join('\n'));
    const r = await call(b, '/api/runs', {
      agent: 'claude',
      prompt: 'Probe',
      scope: [`${FILE}:3-6`],
      resumeFrom: null,
      lines: { [FILE]: lines.slice(2, 6).join('\n') },
    });
    expect(r.body.scope).toEqual([`${FILE}:3-6`]);
    const pre = (line: number) => {
      const edited = [...lines];
      edited[line - 1] += ' // edited';
      try {
        execFileSync(process.execPath, [BRIDGE, 'hook', 'pre'], {
          cwd: repo,
          input: JSON.stringify({
            cwd: repo,
            tool_input: { file_path: path.join(repo, FILE), content: edited.join('\n') },
          }),
          env: { ...process.env, LOA_SCOPE_FILE: path.join(repo, '.loa/scope.json') },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return 'allowed';
      } catch (e) {
        return (e as { status: number }).status === 2 ? 'blocked' : 'error';
      }
    };
    expect(pre(4)).toBe('allowed');
    expect(pre(6)).toBe('allowed');
    expect(pre(7)).toBe('blocked');
    expect(pre(2)).toBe('blocked');
    await call(b, `/api/runs/${(r.body as unknown as RunDTO).id}/cancel`, {});
  } finally {
    b.stop();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});
