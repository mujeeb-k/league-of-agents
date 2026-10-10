// The sandbox lets a session write what the repo ignores. Only patterns read for certain are converted, and each one
// may allow only paths git itself ignores: checked against `git check-ignore` on a repo full of awkward rules.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: the bridge is plain JavaScript, type-checked on its own (bridge/jsconfig.json).
import { ignoredPatterns } from '../../../bridge/lib/sandbox.mjs';

function repo(files: Record<string, string>) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'loa-ignore-')));
  for (const [p, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), text);
  }
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}
const ignored = (dir: string, p: string) =>
  spawnSync('git', ['check-ignore', '-q', '--no-index', p], { cwd: dir }).status === 0;

describe('ignored paths the sandbox allows', () => {
  it('none from patterns when any ignore file re-includes a path with !', () => {
    const neg = repo({ '.gitignore': '*.log\n', 'keep/.gitignore': '!keep.log\n' });
    expect(ignoredPatterns(neg)).toEqual({ paths: [], folders: [] });
  });

  it("reads a linked worktree's exclude file, which lives in the main repo's git folder", () => {
    const main = repo({ 'a.txt': 'a\n' });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'a'], { cwd: main });
    fs.writeFileSync(path.join(main, '.git/info/exclude'), 'scratch/\n');
    const tree = path.join(path.dirname(main), path.basename(main) + '-tree');
    execFileSync('git', ['worktree', 'add', '-q', tree], { cwd: main });
    const { paths } = ignoredPatterns(fs.realpathSync(tree)) as { paths: string[] };
    expect(paths.some(r => new RegExp(r).test(path.join(fs.realpathSync(tree), 'scratch/x')))).toBe(true);
  });

  const dir = repo({
    '.gitignore': ['node_modules/', '/build', '*.log', 'dist', 'foo*bar', 'docs/*.md', '[ab].txt', 'a\\ b', '#x'].join(
      '\n',
    ),
    'pkg/.gitignore': 'out/\n*.tmp\n',
  });
  const { paths: pathRxs, folders: folderRxs } = ignoredPatterns(dir) as { paths: string[]; folders: string[] };
  const rxs = pathRxs.map(r => new RegExp(r));
  const allowed = (p: string) => rxs.some(r => r.test(path.join(dir, p)));
  const paths = [
    'node_modules/x/index.js',
    'pkg/node_modules/y.js',
    'build/a.o',
    'pkg/build/a.o',
    'err.log',
    'pkg/sub/err.log',
    'dist',
    'dist/app.js',
    'pkg/dist/app.js',
    'fooXbar',
    'foobar',
    'docs/readme.md',
    'a.txt',
    'pkg/out/x',
    'pkg/out',
    'out/x',
    'pkg/x.tmp',
    'x.tmp',
    'src/main.ts',
    'distx/a',
    'node_modules_old/a',
  ];

  it("allows a folder-only rule's folders, as folders, and what is inside them", () => {
    expect(folderRxs.map(r => new RegExp(r).test(path.join(dir, 'pkg/out')))).toContain(true);
    expect(allowed('pkg/out')).toBe(false);
    expect(allowed('pkg/out/x')).toBe(true);
  });

  it('allows only paths git ignores', () => {
    for (const p of paths) if (allowed(p)) expect(ignored(dir, p), p).toBe(true);
  });

  it('allows the common ones: installed packages, build output, logs', () => {
    expect(paths.filter(allowed)).toEqual([
      'node_modules/x/index.js',
      'pkg/node_modules/y.js',
      'build/a.o',
      'err.log',
      'pkg/sub/err.log',
      'dist',
      'dist/app.js',
      'pkg/dist/app.js',
      'fooXbar',
      'foobar',
      'pkg/out/x',
      'pkg/x.tmp',
    ]);
  });
});
