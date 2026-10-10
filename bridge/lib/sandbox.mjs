// The section lock, enforced by the system. On macOS a session on a section runs inside a Seatbelt sandbox
// (sandbox-exec, part of macOS): it and every program it starts may write inside its section, to files the repo
// ignores (build output, installed packages) and outside the repo (temp, the agent's own state but not its settings
// or hooks: runLater), and nowhere else in the repo. Nothing outside is written, so nothing needs putting back. Paths reach the profile as
// parameters, never as text in it. Where there is no sandbox, shell.mjs puts back what a shell command changed
// outside the section instead.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, git, gitAsync } from './repo.mjs';
import { scopeEntry } from './scope.mjs';
import { BRIDGE_DIR } from './paths.mjs';
import { realish, refused } from './util.mjs';

const SANDBOX_EXEC = process.env.LOA_SANDBOX_EXEC || '/usr/bin/sandbox-exec';

/**
 * The agents proved to run inside the sandbox (the others are flagged after the run), each with the
 * temporary file its edit tool writes beside a file and renames over it, as a regex of the file's folder and name
 * (both escaped). Only that: no other new file beside a file section.
 */
const TEMP_BESIDE = {
  // Claude Code's Edit: <file>.tmp.<pid>.<hex>.
  claude: (dir, name) => `^${dir}/${name}\\.tmp\\.[0-9]+\\.[0-9a-f]+$`,
  // Hermes's write and patch: .hermes-tmp.XXXXXX (mktemp) in the file's folder.
  hermes: dir => `^${dir}/\\.hermes-tmp\\.[A-Za-z0-9.]+$`,
  // DeepSeek Harness's edit and write: a folder .<file>.<pid>.<uuid>.tmpdir holding <file>.tmp.
  dsh: (dir, name) => `^${dir}/\\.${name}\\.[0-9]+\\.[0-9a-f-]+\\.tmpdir(/|$)`,
};

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
  if (!run.scope?.length || !Object.hasOwn(TEMP_BESIDE, run.agent) || !HAS_SANDBOX) return 'none';
  return sandboxStarts() ? 'sandbox' : 'refuse';
}

/** An error the app words: a session on a section that the sandbox can't lock. */
export const NO_SANDBOX = () =>
  refused('no-sandbox', "A session on a section needs macOS's sandbox, and it can't start here.");

const escape = s => s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');

/**
 * Regexes for the paths the repo's ignore files ignore, from the patterns simple enough to be sure of: a name or
 * `*.ext`, anchored or not, for a folder or not. A `!` rule in any of them can re-include a path another file's rule
 * covers, so then none is converted; what isn't converted stays unwritable (closed, never open), apart from ignored
 * paths that already exist (sandboxArgs). A rule for folders only (`out/`) gives what is inside them in `paths`, and
 * the folders themselves in `folders`, written only as folders. Exported for its test.
 * @returns {{ paths: string[], folders: string[] }}
 */
export function ignoredPatterns(root = ROOT) {
  const files = String(
    git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ':(glob)**/.gitignore'], { cwd: root }),
  )
    .split('\0')
    .filter(Boolean);
  const sources = files.map(f => [path.posix.dirname(f), path.join(root, f)]);
  // Git's own path for it: in a linked worktree, .git is a file, and the exclude file is the main repo's.
  sources.push([
    '.',
    path.resolve(root, String(git(['rev-parse', '--git-path', 'info/exclude'], { cwd: root })).trim()),
  ]);
  /** @type {[string, string[]][]} */
  const read = sources.map(([dir, file]) => {
    try {
      return [dir, fs.readFileSync(file, 'utf8').split('\n')];
    } catch {
      return [dir, []];
    }
  });
  const out = { paths: [], folders: [] };
  if (read.some(([, lines]) => lines.some(l => l.trim().startsWith('!')))) return out;
  for (const [dir, lines] of read) {
    for (let l of lines) {
      l = l.trim();
      if (!l || l.startsWith('#')) continue;
      const folderOnly = l.endsWith('/');
      if (folderOnly) l = l.slice(0, -1);
      const anchored = l.includes('/');
      l = l.replace(/^\//, '');
      if (!/^[A-Za-z0-9._-]*(\*[A-Za-z0-9._-]*)?$/.test(l) || !l || l === '*' || l.includes('/')) continue;
      const base = escape(dir === '.' ? root : path.join(root, dir));
      const name = l.split('*').map(escape).join('[^/]*');
      const at = anchored ? `^${base}/${name}` : `^${base}/(.*/)?${name}`;
      if (folderOnly) {
        out.paths.push(`${at}/`);
        out.folders.push(`${at}$`);
      } else out.paths.push(`${at}(/|$)`);
    }
  }
  return out;
}

/** Each run's sandbox-exec arguments, prepared before it starts (prepareSandbox) and taken as it starts (sandboxArgs). */
const prepared = new Map();

/** The sandbox-exec arguments prepared for a run, used once as its agent starts. */
export function sandboxArgs(run) {
  const args = prepared.get(run.id);
  prepared.delete(run.id);
  if (!args) throw NO_SANDBOX();
  return args;
}

/**
 * Outside the repo, files something runs later without the sandbox, so a session must not write them: git's settings
 * (a filter or fsmonitor set there runs at the bridge's next snapshot), a worktree's git folder and the repo's hooks
 * (git runs them at Commit), the bridge's own code and settings (approved checks), and the agents' settings and hooks,
 * which later sessions run.
 * @returns {[string, string][]} [kind, path]
 */
function runLater(gitDir, commonDir, hooksDir) {
  const home = os.homedir();
  const hermes = process.env.HERMES_HOME || path.join(home, '.hermes');
  const config = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const pkg = path.dirname(BRIDGE_DIR);
  /** @type {[string, string][]} */
  const out = [
    ['subpath', gitDir],
    ['subpath', commonDir],
    ['subpath', hooksDir],
    ['literal', path.join(home, '.gitconfig')],
    ['subpath', path.join(config, 'git')],
    ['subpath', path.join(home, '.config/league-of-agents')],
    ['literal', path.join(home, '.claude/settings.json')],
    ['literal', path.join(home, '.claude/settings.local.json')],
    ['literal', path.join(home, '.codex/config.toml')],
    ['literal', path.join(home, '.codex/hooks.json')],
    ['literal', path.join(home, '.cursor/hooks.json')],
    ['literal', path.join(hermes, 'config.yaml')],
    ['subpath', path.join(hermes, 'hooks')],
  ];
  if (process.env.GIT_CONFIG_GLOBAL) out.push(['literal', process.env.GIT_CONFIG_GLOBAL]);
  // The package the bridge runs from, unless it is this repo's own code (working on League of Agents itself).
  if (pkg !== ROOT && !pkg.startsWith(ROOT + path.sep)) out.push(['subpath', pkg]);
  return out;
}

/** What the repo ignored as each run at work started, by run (prepareSandbox). */
const ignoredAtStart = new Map();
/** A run ended: what it was held by goes, and a sandbox prepared for a turn it never started. */
export function forgetSandbox(run) {
  ignoredAtStart.delete(run.id);
  prepared.delete(run.id);
}

/**
 * Every folder above a path, to the root: denied as folders only (writing inside them stays allowed), so none can be
 * moved away and replaced by one holding other files.
 */
const above = p => {
  const out = [];
  for (let d = path.dirname(p); d !== path.dirname(d); d = path.dirname(d)) out.push(d);
  return [...out, '/'];
};

/** The agents' settings and hook files a repo may hold. */
const REPO_SETTINGS = [
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.codex/config.toml',
  '.codex/hooks.json',
  '.cursor/hooks.json',
];

/**
 * Prepares the sandbox that locks a run to its section: writes inside the repo only to the section, to what the
 * repo ignores, and to the temporary files an agent's edit tool writes beside a file before renaming it over the
 * file (TEMP_BESIDE); no tracked file outside the section, even one that matches an ignore rule; nothing that runs
 * later outside the sandbox (runLater, REPO_SETTINGS); and no reading the bridge's own token. Asynchronous: in a repo the size of
 * llvm, git's listings take a second.
 */
export async function prepareSandbox(run) {
  const real = fs.realpathSync(ROOT);
  const params = [['ROOT', real]];
  const allow = [],
    deny = [];
  const add = (kind, value) => {
    const name = `P${params.length}`;
    params.push([name, value]);
    return `(${kind} (param "${name}"))`;
  };
  const inSection = [],
    folders = [];
  for (const e of run.scope.map(s => scopeEntry(s).path)) {
    const abs = path.join(real, e);
    if (e.endsWith('/')) {
      allow.push(add('subpath', abs.replace(/\/$/, '')));
      inSection.push(p => p.startsWith(e));
    } else {
      allow.push(add('literal', abs));
      allow.push(add('regex', TEMP_BESIDE[run.agent](escape(path.dirname(abs)), escape(path.basename(abs)))));
      inSection.push(p => p === e);
      // A new file the person allowed, in folders not made yet: those folders may be made, as folders only.
      for (let dir = path.dirname(abs); dir !== real && !fs.existsSync(dir); dir = path.dirname(dir))
        folders.push(`(require-all ${add('literal', dir)} (vnode-type DIRECTORY))`);
    }
  }
  const opts = { cwd: real };
  // What the repo ignored as the run started: a run carrying on (sessions.mjs) is held by that, not by ignore rules it
  // wrote since.
  if (!ignoredAtStart.has(run.id))
    ignoredAtStart.set(run.id, {
      patterns: ignoredPatterns(real),
      ignored: gitAsync(['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'], opts),
    });
  const { patterns, ignored: listed } = ignoredAtStart.get(run.id);
  for (const rx of patterns.paths) allow.push(add('regex', rx));
  for (const rx of patterns.folders) allow.push(`(require-all ${add('regex', rx)} (vnode-type DIRECTORY))`);
  const [ignored, tracked, gitDir, commonDir, hooksDir] = await Promise.all([
    listed,
    gitAsync(['ls-files', '-z'], opts),
    gitAsync(['rev-parse', '--absolute-git-dir'], opts),
    gitAsync(['rev-parse', '--git-common-dir'], opts),
    gitAsync(['rev-parse', '--git-path', 'hooks'], opts),
  ]);
  for (const p of ignored.split('\0').filter(Boolean))
    allow.push(add(p.endsWith('/') ? 'subpath' : 'literal', path.join(real, p).replace(/\/$/, '')));
  // Tracked files an ignore pattern matches though they are committed. Matched here in one pass; git's own matching
  // takes seconds in llvm.
  const ignoredRx = patterns.paths.length ? new RegExp(patterns.paths.join('|')) : null;
  for (const p of tracked.split('\0'))
    if (p && !inSection.some(f => f(p)) && ignoredRx?.test(path.join(real, p)))
      deny.push(add('literal', path.join(real, p)));
  const later = runLater(gitDir.trim(), path.resolve(real, commonDir.trim()), path.resolve(real, hooksDir.trim()));
  // In the repo, though git ignores them: the bridge's own folder, and the agents' settings and hooks for this repo,
  // which later sessions run outside the sandbox. Writable only when the section holds them.
  later.push(['subpath', path.join(real, '.loa')]);
  for (const p of REPO_SETTINGS) if (!inSection.some(f => f(p))) later.push(['literal', path.join(real, p)]);
  const parents = new Set(above(real));
  for (const [kind, p] of later) {
    const at = realish(p);
    deny.push(add(kind, at));
    for (const d of above(at)) parents.add(d);
  }
  for (const d of parents) deny.push(add('literal', d));
  // The bridge's token, in its settings and in the link its log prints.
  const token = ['bridge.json', 'bridge.log'].map(f => add('literal', path.join(real, '.loa', f))).join(' ');
  const profile = [
    '(version 1)',
    '(allow default)',
    '(deny file-write* (subpath (param "ROOT")))',
    ...(allow.length ? [`(allow file-write* ${allow.join(' ')})`] : []),
    ...(folders.length ? [`(allow file-write-create ${folders.join(' ')})`] : []),
    `(deny file-write* ${deny.join(' ')})`,
    `(deny file-read* ${token})`,
  ].join('\n');
  prepared.set(run.id, [SANDBOX_EXEC, '-p', profile, ...params.flatMap(([k, v]) => ['-D', `${k}=${v}`])]);
}
