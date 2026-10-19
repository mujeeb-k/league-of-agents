// What a test run leaves behind. Each run gets one folder for everything temporary: TMPDIR points at it, so the
// tests, the bridges they start and the agents those start all make their temp folders and repos there. A suite
// removes what it made as it goes and stops every bridge it started. When the run ends, whatever is still in that
// folder, and any bridge or stand-in agent the run started that is still running, fails the run by name; then it is
// removed and stopped, so a failed run leaves nothing either.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The bridges (the repo's own, a published one, the copy the hooks run) and stand-in agents the tests start. */
const OURS = /\/(loa|bridge)\.mjs( |$)|\/tests\/fixtures\/|\/tests\/support\/(slow|probe)-agent\.mjs/;

/** The folder a process works in, or null when it can't be asked: then nothing is known of it, and it is left alone. */
function cwdOf(pid: number): string | null {
  try {
    if (process.platform === 'linux') return fs.readlinkSync(`/proc/${pid}/cwd`).replace(/ \(deleted\)$/, '');
    const out = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' });
    return /^n(\/.*)$/m.exec(out)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * This run's bridges and stand-in agents still running: those working inside the run's folder, or in a folder of it
 * that is gone (a repo deleted under its bridge). One working anywhere else is another run's, or the developer's own
 * bridge.
 */
function running(root: string) {
  const real = fs.realpathSync(root);
  const found: [number, string][] = [];
  for (const l of execFileSync('ps', ['-A', '-o', 'pid=,args='], { encoding: 'utf8', maxBuffer: 1 << 26 }).split(
    '\n',
  )) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(l);
    if (!m || !OURS.test(m[2]!)) continue;
    const cwd = cwdOf(Number(m[1]));
    if (cwd === null) continue;
    // A folder that is gone was under this run's folder when its name says so: a repo deleted under its bridge.
    const at = fs.existsSync(cwd) ? fs.realpathSync(cwd) : cwd;
    if ([real, root].some(r => at.startsWith(r + path.sep))) found.push([Number(m[1]), m[2]!]);
  }
  return found;
}

/**
 * A run starts: its temp folder, which every test process and every process they start inherits. As the system
 * names its own (on a Mac, through a link), not the real path. A test that must write in /tmp itself names its file
 * after the folder (`tagged`), so it is found too.
 */
export function begin(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loa-tests-'));
  process.env.TMPDIR = root;
  return root;
}

/** A name in /tmp for a file of this run's: the run's folder name, then `name`. */
export const tagged = (name: string) => path.join('/tmp', `${path.basename(os.tmpdir())}-${name}`);

/**
 * What the tools themselves keep in the temp folder, not the tests: Node's cache of compiled modules, and a
 * browser's own temp folder, which it removes as it exits and may still be removing when the run ends (seen once
 * on Linux: `.org.chromium.Chromium.MQOO7m`, with every test passed).
 */
const NOT_OURS = /^(node-compile-cache$|\.(org\.chromium\.Chromium|com\.google\.Chrome)\.)/;

/** A run ends: what it left behind, each in a line, after removing and stopping it. Empty when it left nothing. */
export function end(root: string): string[] {
  const tag = path.basename(root) + '-';
  const inTmp = fs.readdirSync('/tmp').filter(n => n.startsWith(tag));
  const left = [
    ...fs
      .readdirSync(root)
      .filter(n => !NOT_OURS.test(n))
      .map(n => path.join(root, n)),
    ...inTmp.map(n => path.join('/tmp', n)),
  ];
  // What each holds, to tell what wrote it: removed before this returns.
  const held = left.map(p => {
    try {
      return fs.statSync(p).isDirectory()
        ? (fs.readdirSync(p, { recursive: true }) as string[]).slice(0, 12).join(', ')
        : 'a file';
    } catch {
      return '';
    }
  });
  const alive = running(root);
  for (const [pid] of alive)
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* gone meanwhile */
    }
  for (const p of [root, ...inTmp.map(n => path.join('/tmp', n))]) fs.rmSync(p, { recursive: true, force: true });
  return [
    ...left.map((p, i) => `left behind: ${p}${held[i] ? ` (holding ${held[i]})` : ''}`),
    ...alive.map(([pid, args]) => `still running: ${pid} ${args}`),
  ];
}

/** Fails the run when it left something, naming each. */
export function endOrFail(root: string) {
  const left = end(root);
  if (left.length) throw new Error(`The tests left ${left.length} behind:\n  ${left.join('\n  ')}`);
}
