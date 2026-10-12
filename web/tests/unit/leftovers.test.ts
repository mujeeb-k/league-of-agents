// The check every suite ends with (tests/support/leftovers.ts): a folder left in the run's temp folder and a bridge
// still running there fail the run by name, and are removed and stopped; a run that left nothing passes; a bridge
// working anywhere else is left alone.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { begin, end, endOrFail, tagged } from '../support/leftovers';

const outer = process.env.TMPDIR;
const started: ChildProcess[] = [];
afterEach(() => {
  process.env.TMPDIR = outer;
  for (const p of started.splice(0)) p.kill('SIGKILL');
});

/** A process that looks like a bridge the hooks run (a `.loa/bridge.mjs`), working in `dir` until stopped. */
function bridgeIn(dir: string) {
  fs.mkdirSync(path.join(dir, '.loa'), { recursive: true });
  const file = path.join(dir, '.loa/bridge.mjs');
  fs.writeFileSync(file, 'setTimeout(() => {}, 60_000);\n');
  const p = spawn(process.execPath, [file], { cwd: dir, stdio: 'ignore' });
  started.push(p);
  return p;
}
const alive = (p: ChildProcess) => p.exitCode === null && p.signalCode === null;
const gone = (p: ChildProcess) => new Promise<void>(r => (alive(p) ? p.once('exit', () => r()) : r()));

it('a run that removed what it made and stopped what it started left nothing', () => {
  const root = begin();
  expect(os.tmpdir()).toBe(root);
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'loa-e2e-'));
  fs.rmSync(repo, { recursive: true });
  expect(end(root)).toEqual([]);
  expect(fs.existsSync(root)).toBe(false);
});

it('names a folder, a file of its own in /tmp and a bridge left behind, removes them and stops it', async () => {
  // Another run's bridge, working in a folder that isn't this run's: never touched.
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'loa-other-'));
  const theirs = bridgeIn(elsewhere);
  const root = begin();
  const repo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loa-e2e-')), 'sample-repo');
  fs.mkdirSync(repo, { recursive: true });
  const ours = bridgeIn(repo);
  fs.writeFileSync(tagged('probe'), '');
  // Until the process is up, ps doesn't list it.
  await new Promise(r => setTimeout(r, 300));
  const left = end(root);
  expect(left).toEqual([
    `left behind: ${path.dirname(repo)}`,
    `left behind: ${tagged('probe')}`,
    expect.stringMatching(new RegExp(`^still running: ${ours.pid} .*bridge\\.mjs$`)),
  ]);
  await gone(ours);
  expect(fs.existsSync(root)).toBe(false);
  expect(fs.existsSync(tagged('probe'))).toBe(false);
  expect(alive(theirs)).toBe(true);
  theirs.kill('SIGKILL');
  await gone(theirs);
  fs.rmSync(elsewhere, { recursive: true, force: true });
});

it('fails the run, saying what was left', () => {
  const root = begin();
  fs.mkdirSync(path.join(root, 'loa-e2e-left'));
  expect(() => endOrFail(root)).toThrow(/The tests left 1 behind:\n {2}left behind: .*loa-e2e-left/);
});
