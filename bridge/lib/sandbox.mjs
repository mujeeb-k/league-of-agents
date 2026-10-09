// The section lock, enforced by the system. On macOS a session on a section runs inside a Seatbelt sandbox
// (sandbox-exec, part of macOS): it and every program it starts may write inside its section, to files the repo
// ignores (build output, installed packages) and anywhere outside the repo (temp, the agent's own settings), and
// nowhere else in the repo. Nothing outside is written, so nothing needs putting back. Paths reach the profile as
// parameters, never as text in it. Where there is no sandbox, shell.mjs puts back what a shell command changed
// outside the section instead.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, git } from './repo.mjs';
import { scopeEntry } from './scope.mjs';

const SANDBOX_EXEC = process.env.LOA_SANDBOX_EXEC || '/usr/bin/sandbox-exec';

/** Agents proved to run inside the sandbox; the others are flagged after the run, as before. */
const SANDBOXED = new Set(['claude', 'hermes', 'dsh']);

/** macOS has the sandbox; LOA_SANDBOX=off makes the bridge behave as on a system without one. */
const HAS_SANDBOX = process.platform === 'darwin' && process.env.LOA_SANDBOX !== 'off';

let usable = /** @type {boolean | null} */ (null);
/** Whether the sandbox starts here: a bridge itself inside a sandbox can't start another one. */
function sandboxStarts() {
  if (usable === null)
    try {
      execFileSync(SANDBOX_EXEC, ['-p', '(version 1)(allow default)', '/usr/bin/true'], { stdio: 'ignore' });
      usable = true;
    } catch {
      usable = false;
    }
  return usable;
}

/**
 * How a run is held to its section by the system: 'sandbox', or 'refuse' when it should be and the sandbox can't
 * start (closed, never open); 'none' for a run on the whole repository, an agent not proved inside the sandbox, or a
 * system without one, where the hooks and the flags after the run are all there is.
 * @returns {'sandbox' | 'refuse' | 'none'}
 */
export function lockOfRun(run) {
  if (!run.scope?.length || !SANDBOXED.has(run.agent) || !HAS_SANDBOX) return 'none';
  return sandboxStarts() ? 'sandbox' : 'refuse';
}

/** An error the app words: a session on a section that the sandbox can't lock. */
export const NO_SANDBOX = () =>
  Object.assign(new Error("A session on a section needs macOS's sandbox, and it can't start here."), {
    code: 409,
    reason: 'no-sandbox',
    args: {},
  });

const escape = s => s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');

/**
 * Regexes for the paths the repo's ignore files ignore, from the patterns simple enough to be sure of: a name or
 * `*.ext`, anchored or not, for a folder or not. A `!` rule in any of them can re-include a path another file's rule
 * covers, so then none is converted; what isn't converted stays unwritable (closed, never open), apart from ignored
 * paths that already exist (sandboxArgs). Exported for its test.
 * @returns {string[]}
 */
export function ignoredPatterns(root = ROOT) {
  const files = String(
    git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ':(glob)**/.gitignore'], { cwd: root }),
  )
    .split('\0')
    .filter(Boolean);
  const sources = files.map(f => [path.posix.dirname(f), path.join(root, f)]);
  sources.push(['.', path.join(root, '.git/info/exclude')]);
  /** @type {[string, string[]][]} */
  const read = sources.map(([dir, file]) => {
    try {
      return [dir, fs.readFileSync(file, 'utf8').split('\n')];
    } catch {
      return [dir, []];
    }
  });
  if (read.some(([, lines]) => lines.some(l => l.trim().startsWith('!')))) return [];
  const out = [];
  for (const [dir, lines] of read) {
    for (let l of lines) {
      l = l.trim();
      if (!l || l.startsWith('#')) continue;
      if (l.endsWith('/')) l = l.slice(0, -1);
      const anchored = l.includes('/');
      l = l.replace(/^\//, '');
      if (!/^[A-Za-z0-9._-]*(\*[A-Za-z0-9._-]*)?$/.test(l) || !l || l === '*' || l.includes('/')) continue;
      const base = escape(dir === '.' ? root : path.join(root, dir));
      const name = l.split('*').map(escape).join('[^/]*');
      out.push(anchored ? `^${base}/${name}(/|$)` : `^${base}/(.*/)?${name}(/|$)`);
    }
  }
  return out;
}

/**
 * The sandbox-exec arguments that lock a run to its section: writes inside the repo only to the section, to what the
 * repo ignores, and to the temporary files an editor writes beside a file before renaming it over the file (Claude
 * Code's Edit tool does); no tracked file outside the section, even one that matches an ignore rule.
 */
export function sandboxArgs(run) {
  const real = fs.realpathSync(ROOT);
  const params = [['ROOT', real]];
  const allow = [],
    deny = [];
  const add = (kind, value) => {
    const name = `P${params.length}`;
    params.push([name, value]);
    return `(${kind} (param "${name}"))`;
  };
  const inSection = [];
  for (const e of run.scope.map(s => scopeEntry(s).path)) {
    const abs = path.join(real, e);
    if (e.endsWith('/')) {
      allow.push(add('subpath', abs.replace(/\/$/, '')));
      inSection.push(p => p.startsWith(e));
    } else {
      allow.push(add('regex', `^${escape(abs)}[^/]*$`));
      inSection.push(p => p === e);
    }
  }
  const patterns = ignoredPatterns(real);
  for (const rx of patterns) allow.push(add('regex', rx));
  for (const p of String(
    git(['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'], { cwd: real }),
  )
    .split('\0')
    .filter(Boolean))
    allow.push(add(p.endsWith('/') ? 'subpath' : 'literal', path.join(real, p).replace(/\/$/, '')));
  // Tracked files the allows above would reach: one named like a file in the section, or one an ignore pattern
  // matches though it is committed. Matched here in one pass; git's own matching takes seconds in llvm.
  const files = run.scope.map(s => scopeEntry(s).path).filter(e => !e.endsWith('/'));
  const ignoredRx = patterns.length ? new RegExp(patterns.join('|')) : null;
  for (const p of String(git(['ls-files', '-z'], { cwd: real })).split('\0'))
    if (p && !inSection.some(f => f(p)) && (files.some(f => p.startsWith(f)) || ignoredRx?.test(path.join(real, p))))
      deny.push(add('literal', path.join(real, p)));
  const profile = [
    '(version 1)',
    '(allow default)',
    '(deny file-write* (subpath (param "ROOT")))',
    ...(allow.length ? [`(allow file-write* ${allow.join(' ')})`] : []),
    ...(deny.length ? [`(deny file-write* ${deny.join(' ')})`] : []),
  ].join('\n');
  return [SANDBOX_EXEC, '-p', profile, ...params.flatMap(([k, v]) => ['-D', `${k}=${v}`])];
}
