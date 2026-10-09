// Checks: the tests and type checks that run after a run that changed files, and which of them may run.
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { readJson } from './util.mjs';
import { ROOT, CONF, git } from './repo.mjs';
import { emit } from './events.mjs';

/** Found checks the person turned off: never offered again (`name\0command`). */
export let CHECKS_OFF;
/**
 * The checks this person allowed for this repo, kept outside it, in their home folder, so nothing in a repo can
 * allow its own commands. `private`: found checks they turned on (loa.config.json is written only when they share
 * them with their team). `approved`: the committed loa.config.json list they approved. A cloned repo's
 * loa.config.json is the repo's, not the person's: its checks run only once that exact list is approved, and
 * wait again whenever any of it changes.
 */
export let CHECKS_FILE;
export let allowed;
export function saveAllowed(change) {
  Object.assign(allowed, change);
  fs.mkdirSync(path.dirname(CHECKS_FILE), { recursive: true });
  fs.writeFileSync(CHECKS_FILE, JSON.stringify({ ...allowed, root: ROOT }, null, 2));
}
export const sameChecks = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Committed checks waiting for the person's approval: offered, never run. */
export let repoChecks = [];
export let checksShared = false;
export const setRepoChecks = c => (repoChecks = c);
export const setChecksShared = on => (checksShared = on);
/** Which checks run: the person's own, or the repo's committed list once they approved that exact list. */
export function initChecks() {
  CHECKS_OFF = path.join(ROOT, '.loa', 'checks-off.json');
  CHECKS_FILE = path.join(
    os.homedir(),
    '.config',
    'league-of-agents',
    'repos',
    crypto.createHash('sha256').update(ROOT).digest('hex').slice(0, 32) + '.json',
  );
  allowed = { private: [], approved: [], ...readJson(CHECKS_FILE, {}) };
  checksShared = !!CONF.checks?.length;
  if (checksShared && !sameChecks(CONF.checks, allowed.approved)) {
    repoChecks = CONF.checks;
    CONF.checks = [];
    checksShared = false;
  }
  if (!checksShared && !repoChecks.length) CONF.checks = allowed.private;
}
/**
 * Checks the repo seems to have, for a repo with none set up: each package's test and typecheck scripts (with
 * the package manager its lockfile names) and pytest, in the repo and in the folders directly inside it. They
 * are only offered; nothing runs until the person turns them on.
 */
export function detectChecks() {
  const has = (...p) => fs.existsSync(path.join(ROOT, ...p));
  const skip = /^(\.|node_modules$|dist$|build$|vendor$|target$|venv$)/;
  let dirs = [''];
  try {
    dirs = dirs.concat(
      fs
        .readdirSync(ROOT, { withFileTypes: true })
        .filter(d => d.isDirectory() && !skip.test(d.name))
        .map(d => d.name),
    );
  } catch {}
  const out = [];
  for (const d of dirs) {
    const quoted = /^[\w.-]+$/.test(d) ? d : `'${d.replace(/'/g, "'\\''")}'`;
    const cd = d ? `cd ${quoted} && ` : '',
      label = d ? `${d} ` : '';
    const scripts = readJson(path.join(ROOT, d, 'package.json'), null)?.scripts;
    if (scripts) {
      const lock = f => has(d, f) || has(f);
      const pm = lock('pnpm-lock.yaml')
        ? 'pnpm'
        : lock('yarn.lock')
          ? 'yarn'
          : lock('bun.lockb') || lock('bun.lock')
            ? 'bun'
            : 'npm';
      if (scripts.test && !/no test specified/.test(scripts.test))
        out.push({ name: `${label}tests`, run: `${cd}${pm} test` });
      const tc = ['typecheck', 'type-check', 'check-types', 'tsc'].find(s => scripts[s]);
      if (tc) out.push({ name: `${label}typecheck`, run: `${cd}${pm} run ${tc}` });
    }
    let pyproject = '';
    try {
      pyproject = fs.readFileSync(path.join(ROOT, d, 'pyproject.toml'), 'utf8');
    } catch {}
    let testsDir = [];
    try {
      testsDir = fs.readdirSync(path.join(ROOT, d, 'tests'));
    } catch {}
    if (
      ['pytest.ini', 'conftest.py', 'tox.ini'].some(f => has(d, f)) ||
      /\[tool\.pytest/.test(pyproject) ||
      testsDir.some(f => /^test_.*\.py$/.test(f))
    )
      out.push({ name: `${label}pytest`, run: `${cd}python3 -m pytest -q` });
  }
  const off = new Set(readJson(CHECKS_OFF, []));
  return out.filter(c => !off.has(`${c.name}\0${c.run}`)).slice(0, 6);
}
function portBusy(port) {
  return new Promise(r => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => {
      s.destroy();
      r(true);
    });
    s.once('error', () => r(false));
  });
}
export async function runChecks(run) {
  run.checks = [];
  for (const c of CONF.checks) {
    if (c.requires_free_port && (await portBusy(c.requires_free_port))) {
      run.checks.push({
        name: c.name,
        ok: null,
        summary: `Skipped: port ${c.requires_free_port} is in use. Stop the running server first.`,
      });
      continue;
    }
    const t0 = Date.now();
    const res = await new Promise(resolve => {
      const ch = spawn(c.run, { cwd: ROOT, shell: true, env: { ...process.env, CI: '1' } });
      let out = '';
      const add = d => {
        out += d;
        if (out.length > 200000) out = out.slice(-100000);
      };
      ch.stdout.setEncoding('utf8');
      ch.stderr.setEncoding('utf8');
      ch.stdout.on('data', add);
      ch.stderr.on('data', add);
      const timer = setTimeout(() => ch.kill('SIGTERM'), (c.timeout_s || 900) * 1000);
      ch.on('close', code => {
        clearTimeout(timer);
        resolve({ code, out });
      });
    });
    const clean = res.out.replace(/\x1b\[[0-9;]*m/g, '');
    const error = res.code ? setupError(clean, res.code) : null;
    if (error) {
      run.checks.push({
        name: c.name,
        ok: null,
        couldNotRun: true,
        summary: error,
        ms: Date.now() - t0,
        tail: clean.split('\n').slice(-40).join('\n'),
      });
      emit('progress', run);
      continue;
    }
    const hit = clean.match(/(\d+)\s+(passed|passing)[^\n]*/i) || clean.match(/(\d+)\s+failed[^\n]*/i);
    run.checks.push({
      name: c.name,
      ok: res.code === 0,
      summary: hit ? hit[0].trim() : `exit ${res.code}`,
      ms: Date.now() - t0,
      tail: clean.split('\n').slice(-40).join('\n'),
    });
    emit('progress', run);
  }
}

/**
 * Why a check couldn't run on this machine, as the error's own line, or null when it ran and failed. Only
 * clear setup problems count: a command that isn't installed (exit 127), or a package that isn't installed and
 * isn't part of the repo. A missing module the repo has, a failing test or anything else is a real failure.
 */
function setupError(out, code) {
  // pytest marks error lines with a leading "E".
  const lines = out.split('\n').map(l => l.trim().replace(/^E\s+/, ''));
  const line = re => lines.find(l => re.test(l))?.slice(0, 200) ?? null;
  if (code === 127)
    return line(/command not found|not found|No such file or directory/) ?? `Command not found (exit 127)`;
  const missing = [
    ...out.matchAll(/No module named '([\w.]+)'/g),
    ...out.matchAll(/Cannot find (?:module|package) '([^'.\/][^']*)'/g),
  ].map(m => m[1]);
  if (!missing.length) return null;
  const tracked = git(['ls-files']).split('\n');
  const inRepo = name => {
    const top = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split(/[./]/)[0];
    return tracked.some(f =>
      f.split('/').some((seg, i, all) => seg === top || (i === all.length - 1 && seg === `${top}.py`)),
    );
  };
  const outside = missing.find(m => !inRepo(m));
  return outside
    ? line(new RegExp(`(No module named|Cannot find (module|package)) '${outside.replace(/[^\w@/-]/g, '\\$&')}'`))
    : null;
}
