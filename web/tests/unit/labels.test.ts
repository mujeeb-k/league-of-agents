// Paths in an agent's activity read as the repo names them, whichever form of the repo's path the agent used: macOS's
// temp folders sit behind a symlink (/var is /private/var), and agents name either.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

const LIB = path.join(__dirname, '../../../bridge/lib');

it.runIf(process.platform === 'darwin')('relPaths makes both forms of the repo path relative', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loa-labels-'));
  const real = fs.realpathSync(dir);
  expect(dir).not.toBe(real);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const url = (f: string) => JSON.stringify(pathToFileURL(path.join(LIB, f)).href);
  const text = `${dir}/src/a.ts, ${real}/src/b.ts, cd ${dir}`;
  const out = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const r = await import(${url('repo.mjs')}); r.openRepo();
       const { relPaths } = await import(${url('agents/labels.mjs')});
       process.stdout.write(relPaths(${JSON.stringify(text)}));`,
    ],
    { cwd: dir, encoding: 'utf8' },
  );
  expect(out).toBe('src/a.ts, src/b.ts, cd .');
  fs.rmSync(dir, { recursive: true, force: true });
});
