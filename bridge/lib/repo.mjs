// The repo the bridge runs in: where it is, its config, and git run there. League of Agents' own records (its runs,
// their snapshots and what pins them, its settings and key) are kept in a folder of its own outside the repo (loaOf),
// where no git command run in the repo reaches them. The snapshots are in a bare repository there, the store, which
// reads the repo's objects and keeps its own copy of every object a pinned snapshot reaches: a commit reset away and
// pruned in the repo takes nothing a run needs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { loaOf, readJson, realish } from './util.mjs';

/** The repo the bridge runs in, set by openRepo before anything else reads it. */
export let ROOT, LOA, RUNS_DIR, CONFIG_FILE, CONF, bridgeFile, LAYOUT_FILE, prev, EXCLUDED;
/** The store, in LOA: a bare repository holding the snapshots. The repo's own object folder. */
export let STORE, REPO_OBJECTS;
/** Whether this start stopped a bridge of an earlier version running in the repo (`stop`, `uninstall`). */
export let stoppedOld = false;
/** League of Agents' own git identity, for its snapshots, and for notes where the person has none set. */
export const LOA_IDENT = {
  GIT_AUTHOR_NAME: 'loa',
  GIT_AUTHOR_EMAIL: 'loa@localhost',
  GIT_COMMITTER_NAME: 'loa',
  GIT_COMMITTER_EMAIL: 'loa@localhost',
};
/**
 * Finds the repo and League of Agents' folder for it, or says why the bridge can't run here and exits. Reads
 * loa.config.json and the last start's bridge.json. `stopOld`: a bridge of an earlier version running in the repo is
 * stopped; otherwise the bridge doesn't start beside it.
 */
export function openRepo({ stopOld = false } = {}) {
  try {
    ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    console.error('Run this inside a git repository.');
    process.exit(1);
  }
  // .loa/ is where bridges before this one kept their records. A repo that commits it could hand the bridge runs,
  // settings or approvals of its choosing, so the bridge doesn't start on one.
  if (execFileSync('git', ['ls-files', '--', '.loa'], { cwd: ROOT, encoding: 'utf8' }).trim()) {
    console.error(
      'This repo commits .loa/, which League of Agents keeps private to each machine. Take it out of git first:\n' +
        '  git rm -r --cached .loa && git commit -m "Stop tracking .loa"',
    );
    process.exit(1);
  }
  LOA = loaOf(ROOT);
  // A repo that holds the home folder's .config (a dotfiles repo) would hold the records too: in its own snapshots,
  // and in reach of its git.
  const ours = realish(path.dirname(path.dirname(LOA)));
  if (!path.relative(ROOT, ours).startsWith('..')) {
    console.error(`League of Agents keeps its records in ${ours}, which is inside this repo.`);
    process.exit(1);
  }
  // It holds the token (bridge.json): only this user may open it.
  fs.mkdirSync(LOA, { recursive: true, mode: 0o700 });
  fs.chmodSync(LOA, 0o700);
  RUNS_DIR = path.join(LOA, 'runs');
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  bridgeFile = path.join(LOA, 'bridge.json');
  EXCLUDED = path.join(LOA, 'excluded.json');
  openStore(stopOld);
  CONFIG_FILE = path.join(ROOT, 'loa.config.json');
  CONF = readJson(CONFIG_FILE, {});
  // Where the map's folders and files are placed (web/src/lib/layout.ts SavedLayout).
  LAYOUT_FILE = path.join(LOA, 'layout.json');
  prev = readJson(bridgeFile, {});
  excludeFromGit(['.claude/settings.local.json']);
}
/** Makes the store, or finds it, and moves in what a bridge before this one kept in the repo. */
function openStore(stopOld) {
  STORE = path.join(LOA, 'git');
  REPO_OBJECTS = path.join(
    execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim(),
    'objects',
  );
  if (!fs.existsSync(path.join(STORE, 'HEAD'))) execFileSync('git', ['init', '--bare', '-q', STORE]);
  const legacy = path.join(ROOT, '.loa');
  if (
    (fs.existsSync(legacy) && fs.readdirSync(legacy).some(n => LEGACY.test(n))) ||
    git(['for-each-ref', '--count=1', 'refs/loa/'], { repo: true }).trim()
  )
    moveLegacy(legacy, stopOld);
}
/** Whether a process is running. */
const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
/** What a bridge before this one kept in the repo's .loa/ that is still wanted: the rest it makes again. */
const KEPT =
  /^(runs|layout\.json|map\.json|hooks-backup\.json|excluded\.json|checks-off\.json|held\.json|interrupted)$/;
/**
 * Every name such a bridge wrote there, the wanted ones among them: only these are removed. The hooks' loader and its
 * copies (bridge.mjs, b-*) stay until copyForHooks replaces them, so a hook never finds them missing.
 */
const LEGACY = new RegExp(
  `${KEPT.source}|^(bridge\\.(json|log)|snapshot\\.(index|key)|[a-z]+(-[0-9a-f]+)?\\.index|hold-\\d+(\\.tmp)?|` +
    `scope-\\d+\\.json|scope\\.json|merge-\\w+|checks(-approved)?\\.json)$`,
);
/**
 * Moves the records a bridge before this one kept in the repo (.loa/, and its snapshots under refs/loa/) into
 * League of Agents' own folder. Each snapshot becomes a commit of the same files in the store, its copy of their
 * objects made first; only once the runs name the new commits are the repo's refs and .loa/ removed.
 */
function moveLegacy(legacy, stopOld) {
  const old = readJson(path.join(legacy, 'bridge.json'), null);
  if (typeof old?.pid === 'number' && alive(old.pid)) {
    if (!stopOld) {
      console.error(
        'A League of Agents bridge from an earlier version is running in this repo. Stop it first: npx leagueofagents-cli@latest stop',
      );
      process.exit(1);
    }
    process.kill(old.pid, 'SIGTERM');
    const pause = new Int32Array(new SharedArrayBuffer(4));
    for (const t0 = Date.now(); alive(old.pid) && Date.now() - t0 < 5000;) Atomics.wait(pause, 0, 0, 100);
    // Still running: nothing of its moves while it could still write it.
    if (alive(old.pid)) {
      console.error(
        `The League of Agents bridge from an earlier version (process ${old.pid}) didn't stop. Nothing was moved.`,
      );
      process.exit(1);
    }
    stoppedOld = true;
  }
  const refs = git(['for-each-ref', '--format=%(objectname) %(objecttype) %(refname)', 'refs/loa/'], { repo: true })
    .split('\n')
    .filter(Boolean)
    .map(l => l.split(' '));
  /** Each old snapshot commit and the store's commit of the same files. */
  const moved = new Map();
  for (const [oid, type] of refs)
    if (type === 'commit' && !moved.has(oid))
      moved.set(
        oid,
        git(['commit-tree', `${oid}^{tree}`, '-m', 'loa snapshot'], { env: { ...process.env, ...LOA_IDENT } }).trim(),
      );
  const pins = refs.map(([oid, , ref]) => [ref, moved.get(oid) ?? oid]);
  // Nothing is removed until the store holds every object of every snapshot by itself.
  try {
    copySync(pins.map(([, oid]) => oid));
  } catch (e) {
    console.error(`Couldn't move the records an earlier version kept in this repo; they stay where they are. ${e}`);
    return;
  }
  if (pins.length)
    store(['update-ref', '--stdin'], { input: pins.map(([ref, oid]) => `update ${ref} ${oid}`).join('\n') + '\n' });
  // Each file once: what is already in League of Agents' folder stays.
  for (const name of fs.existsSync(legacy) ? fs.readdirSync(legacy).filter(n => KEPT.test(n)) : [])
    fs.cpSync(path.join(legacy, name), path.join(LOA, name), { recursive: true, force: false, errorOnExist: false });
  if (pins.length)
    for (const f of fs.readdirSync(RUNS_DIR).filter(f => f.endsWith('.json'))) {
      const r = readJson(path.join(RUNS_DIR, f), null);
      if (!r) continue;
      for (const k of ['before', 'after']) if (moved.has(r[k])) r[k] = moved.get(r[k]);
      for (const k of r.putBack ?? []) k.commit ??= pins.find(([ref]) => ref === k.ref)?.[1];
      fs.writeFileSync(path.join(RUNS_DIR, f), JSON.stringify(r));
    }
  if (refs.length)
    git(['update-ref', '--stdin'], { repo: true, input: refs.map(([, , ref]) => `delete ${ref}`).join('\n') + '\n' });
  if (fs.existsSync(legacy))
    for (const name of fs.readdirSync(legacy).filter(n => LEGACY.test(n)))
      fs.rmSync(path.join(legacy, name), { recursive: true, force: true });
}
/**
 * The environment git runs in for the bridge: what it writes (snapshots, an edit's file, a merge) goes into the
 * store's objects, and it reads the repo's too. `repo`: git as the person's own, writing into the repo (a commit, a
 * note).
 */
const envOf = (env = process.env, repo = false) =>
  repo || !STORE
    ? env
    : { ...env, GIT_OBJECT_DIRECTORY: path.join(STORE, 'objects'), GIT_ALTERNATE_OBJECT_DIRECTORIES: REPO_OBJECTS };
/** The bridge's own git environment, for a git it starts itself (writes.mjs). */
export const gitEnv = () => envOf();
/** git on the store's own refs: those that pin snapshots. */
const store = (args, opts) => git(['--git-dir', STORE, ...args], opts);
export const storeAsync = (args, opts) => gitAsync(['--git-dir', STORE, ...args], opts);
/** git asked about `list` in one object folder alone, with only what it borrows on disk. */
const askIn = (objects, list) => ({
  input: list.join('\n') + '\n',
  repo: true,
  env: { ...process.env, GIT_OBJECT_DIRECTORY: objects, GIT_ALTERNATE_OBJECT_DIRECTORIES: '' },
});
/** The objects `cat-file --batch-check` found missing. */
const missing = out =>
  out
    .split('\n')
    .filter(l => l.endsWith(' missing'))
    .map(l => l.split(' ')[0]);
/** Writes into an object folder, as one pack, those of `list` it lacks, read from the repo's objects and the store's. */
async function copyInto(objects, list) {
  if (!list.length) return;
  const need = missing(await gitAsync(['cat-file', '--batch-check=%(objectname)'], askIn(objects, list)));
  if (need.length)
    await gitAsync(['pack-objects', '-q', path.join(objects, 'pack', 'pack')], { input: need.join('\n') + '\n' });
}
let keeping = Promise.resolve();
/**
 * Pins a snapshot (a commit or a tree) under `ref` in the store, once the store has its own copy of every object it
 * reaches. One at a time, so each copies only what the pins before it don't reach.
 */
export function keep(ref, oid) {
  const done = keeping.then(async () => {
    const pinned = (await storeAsync(['for-each-ref', '--format=%(if)%(tree)%(then)%(tree)%(else)%(objectname)%(end)']))
      .split('\n')
      .filter(Boolean);
    // Its files, never the history it was taken on.
    const type = (await gitAsync(['cat-file', '-t', oid])).trim();
    const reached = await gitAsync(['rev-list', '--objects', '--stdin'], {
      input: [type === 'commit' ? `${oid}^{tree}` : oid, ...pinned.map(p => `^${p}`)].join('\n') + '\n',
    });
    await copyInto(path.join(STORE, 'objects'), [
      oid,
      ...reached
        .split('\n')
        .filter(Boolean)
        .map(l => l.split(' ')[0]),
    ]);
    await storeAsync(['update-ref', ref, oid]);
  });
  keeping = done.catch(() => {});
  return done;
}
/** The same copy, for the snapshots of a bridge before this one, moved in at start, and confirmed. */
function copySync(list) {
  if (!list.length) return;
  const trees = [...new Set(list)].map(oid =>
    git(['cat-file', '-t', oid]).trim() === 'commit' ? `${oid}^{tree}` : oid,
  );
  const reached = git(['rev-list', '--objects', '--stdin'], { input: trees.join('\n') + '\n' });
  const all = [
    ...list,
    ...reached
      .split('\n')
      .filter(Boolean)
      .map(l => l.split(' ')[0]),
  ];
  const objects = path.join(STORE, 'objects');
  const need = missing(git(['cat-file', '--batch-check=%(objectname)'], askIn(objects, all)));
  if (need.length) git(['pack-objects', '-q', path.join(objects, 'pack', 'pack')], { input: need.join('\n') + '\n' });
  // Confirmed: the store alone has every one.
  const left = missing(git(['cat-file', '--batch-check=%(objectname)'], askIn(objects, all)));
  if (left.length) throw new Error(`the store lacks ${left.length} of them`);
}
/** Writes into the repo the objects among `list` it lacks: the files a commit holds, written by the bridge. */
export const intoRepo = list => copyInto(REPO_OBJECTS, list);
/** Deletes pins from the store, then lets git tidy it: what no pin reaches goes, after git's own grace period. */
export function unpin(refs) {
  if (!refs.length) return;
  store(['update-ref', '--stdin'], { input: refs.map(r => `delete ${r}`).join('\n') + '\n' });
  execFile('git', ['--git-dir', STORE, 'gc', '--auto', '--quiet'], { cwd: ROOT }, () => {});
}
/** Hooks installed this start: Claude Code is told edits outside the scope are blocked only when they are. */
export let HOOKS = false;
export const setHooks = on => void (HOOKS = on);
// A fresh token on every start: a link from an earlier run stops working.
export const TOKEN = crypto.randomBytes(18).toString('base64url');
// Git's own path for it: in a linked worktree, the main repo's, which git reads (not the worktree's git folder).
export const excludeFile = () =>
  path.resolve(ROOT, git(['rev-parse', '--git-path', 'info/exclude'], { repo: true }).trim());
export function excludeFromGit(lines) {
  const ex = excludeFile();
  fs.mkdirSync(path.dirname(ex), { recursive: true });
  const cur = fs.existsSync(ex) ? fs.readFileSync(ex, 'utf8') : '';
  const add = lines.filter(l => !cur.split('\n').includes(l));
  if (!add.length) return;
  fs.appendFileSync(ex, (cur.endsWith('\n') || !cur ? '' : '\n') + add.join('\n') + '\n');
  fs.writeFileSync(EXCLUDED, JSON.stringify([...readJson(EXCLUDED, []), ...add]));
}
/**
 * @param {string[]} args
 * @param {{ repo?: boolean } & import('node:child_process').ExecFileSyncOptions} [opts]
 * @returns {string}
 */
export function git(args, { repo = false, ...opts } = {}) {
  return String(
    execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      ...opts,
      env: envOf(opts.env, repo),
    }),
  );
}
/**
 * git without blocking the bridge: snapshots, diffs and reverts run while requests are still answered.
 * @param {string[]} args
 * @param {{ input?: string | Buffer; repo?: boolean } & import('node:child_process').ExecFileOptions} [opts]
 * @returns {Promise<string>}
 */
export function gitAsync(args, { input, repo = false, ...opts } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts, env: envOf(opts.env, repo) },
      // A failure carries what git printed: a hook's own words, when one refused.
      (e, out, err) =>
        e ? reject(Object.assign(e, { stdout: String(out), stderr: String(err) })) : resolve(String(out)),
    );
    if (input !== undefined) child.stdin.end(input);
  });
}
