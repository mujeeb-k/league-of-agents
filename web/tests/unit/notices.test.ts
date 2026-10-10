// The package ships the app built from other people's libraries, so it ships their licenses too
// (THIRD-PARTY-NOTICES.txt): the file names every production dependency, and is up to date.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const REPO = path.join(__dirname, '../../..');

it('THIRD-PARTY-NOTICES.txt is what the installed production dependencies give', () => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'scripts/third-party-notices.mjs'), '--check'], {
    encoding: 'utf8',
  });
  expect(r.stderr).toBe('');
  expect(r.status).toBe(0);
});

it('it names every library the app depends on directly, and the package carries it', () => {
  const notices = fs.readFileSync(path.join(REPO, 'THIRD-PARTY-NOTICES.txt'), 'utf8');
  const web = JSON.parse(fs.readFileSync(path.join(REPO, 'web/package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  for (const name of Object.keys(web.dependencies)) expect(notices, name).toMatch(new RegExp(`^${name} \\d`, 'm'));
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')) as { files: string[] };
  expect(pkg.files).toContain('THIRD-PARTY-NOTICES.txt');
});
