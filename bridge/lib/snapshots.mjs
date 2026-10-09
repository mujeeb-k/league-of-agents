// Snapshots: the working tree as private git commits, pinned under refs/loa/; never your branch or staging.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { splitLines } from './util.mjs';
import { IGNORE, LOA, ROOT, excludeFile, gitAsync } from './repo.mjs';
import { SKIP } from './files.mjs';

const snapIndex = () => path.join(LOA, 'snapshot.index');
/** Names of files that usually hold secrets, at any depth: untracked ones stay out of snapshots. The README lists them. */
export const SECRET_FILES = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.jks',
  '*.keystore',
  '*.kdbx',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.git-credentials',
  '.htpasswd',
  'credentials.json',
  'secrets.json',
  'secrets.yaml',
  'secrets.yml',
  'service-account*.json',
  '*.tfvars',
];
/**
 * The working tree as a git tree, written through a private index. The index is kept between snapshots, so
 * git hashes only the files that changed since the last one. `fresh` starts it again from HEAD.
 */
/** `paths` limits the update to those paths: the rest of the tree is as last written. */
export async function writeTree(fresh = false, paths = /** @type {string[] | null} */ (null)) {
  const env = { ...process.env, GIT_INDEX_FILE: snapIndex() };
  if (fresh || !fs.existsSync(snapIndex())) {
    try {
      fs.rmSync(snapIndex());
    } catch {}
    await gitAsync((await headNow()).commit ? ['read-tree', 'HEAD'] : ['read-tree', '--empty'], { env });
  }
  // Untracked files that usually hold secrets (not ignored, not committed) never enter a snapshot. Tracked ones,
  // such as .env.example templates, are already in the repo's history and are snapshotted like any file.
  const untrackedSecrets = (
    await gitAsync([
      'ls-files',
      '-z',
      '--others',
      '--exclude-standard',
      '--',
      // Limited to the paths when given: a scan of every untracked path takes seconds in a repo the size of llvm.
      ...SECRET_FILES.flatMap(g =>
        paths
          ? paths.map(
              p =>
                `:(glob)${p.endsWith('/') ? `${p}**/` : path.posix.dirname(p) === '.' ? '' : `${path.posix.dirname(p)}/`}${g}`,
            )
          : [`:(glob)**/${g}`],
      ),
    ])
  )
    .split('\0')
    .filter(Boolean);
  // A path that doesn't exist yet (a file the section names, not yet created) fails a limited update: then all of it.
  await gitAsync(['add', '-A', ...(paths ? ['--', ...paths] : [])], { env }).catch(() =>
    gitAsync(['add', '-A'], { env }),
  );
  if (untrackedSecrets.length)
    await gitAsync(['rm', '--cached', '-q', '--ignore-unmatch', '--', ...untrackedSecrets], { env });
  return (await gitAsync(['write-tree'], { env })).trim();
}
const keyFile = () => path.join(LOA, 'snapshot.key');
/**
 * What the snapshot index holds besides the files' own content: HEAD, and every rule that says what git ignores. A
 * file once snapshotted stays in the index until it is started again from HEAD, even once ignored, so the index is
 * kept only while these are as they were.
 */
async function indexKey() {
  const [head, ignores, own] = await Promise.all([
    headNow(),
    gitAsync(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ':(glob)**/.gitignore']),
    gitAsync(['config', '--path', 'core.excludesFile']).catch(() => ''),
  ]);
  const files = [
    ...ignores
      .split('\0')
      .filter(Boolean)
      .map(f => path.join(ROOT, f)),
    excludeFile(),
    own.trim(),
  ];
  const h = crypto.createHash('sha1').update(`${head.commit}\0${JSON.stringify(IGNORE)}`);
  for (const f of files.filter(Boolean)) {
    h.update(`\0${f}\0`);
    try {
      h.update(fs.readFileSync(f));
    } catch {}
  }
  return h.digest('hex');
}
/**
 * Readies the snapshot index for a start's first snapshot, so git hashes only what changed: the index kept from the
 * last start while its key holds; on the first start, a copy of git's own index, whose tracked files git already
 * hashed. A split or sparse index can't be copied: then it starts from HEAD, as before.
 */
export async function startIndex() {
  const key = await indexKey();
  let kept = '';
  try {
    kept = fs.readFileSync(keyFile(), 'utf8');
  } catch {}
  if (kept !== key || !fs.existsSync(snapIndex())) {
    fs.rmSync(snapIndex(), { force: true });
    const [split, sparse, own] = await Promise.all([
      gitAsync(['config', '--bool', 'core.splitIndex']).catch(() => ''),
      gitAsync(['config', '--bool', 'index.sparse']).catch(() => ''),
      gitAsync(['rev-parse', '--path-format=absolute', '--git-path', 'index']),
    ]);
    if (split.trim() !== 'true' && sparse.trim() !== 'true' && fs.existsSync(own.trim()))
      fs.copyFileSync(own.trim(), snapIndex());
  }
  fs.writeFileSync(keyFile(), key);
}
/** A commit of the tree on top of HEAD, reachable only from the refs it is pinned to. */
export async function commitTree(tree, label, head) {
  const out = await gitAsync(['commit-tree', tree, ...(head.commit ? ['-p', head.commit] : []), '-m', 'loa ' + label], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'loa',
      GIT_AUTHOR_EMAIL: 'loa@localhost',
      GIT_COMMITTER_NAME: 'loa',
      GIT_COMMITTER_EMAIL: 'loa@localhost',
    },
  });
  return out.trim();
}
/** The branch HEAD points at and its commit; both empty before the first commit. */
export async function headNow() {
  try {
    const [commit, ref] = (await gitAsync(['rev-parse', 'HEAD', '--symbolic-full-name', 'HEAD'])).trim().split('\n');
    return { commit, ref };
  } catch {
    return { commit: '', ref: '' };
  }
}
/** The working tree now, as a snapshot commit: the baseline's shape, `{ head, tree, commit }`. */
export async function snapshotNow(label, paths = /** @type {string[] | null} */ (null)) {
  const head = await headNow(),
    tree = await writeTree(false, paths);
  return { head, tree, commit: await commitTree(tree, label, head) };
}
/** A file's content id in a commit, or null when the commit doesn't have it. */
export async function blobAt(commit, p) {
  const line = (await gitAsync(['ls-tree', commit, '--', p])).trim();
  return line ? line.split(/\s+/)[2] : null;
}
/**
 * A commit with the files of `commit`, except each of `files` ([path, from]) as commit `from` has it, or absent where
 * `from` doesn't have it. Built in an index of its own, so the snapshot index is left as it is.
 */
export async function commitWith(commit, files, label) {
  const index = path.join(LOA, 'compose.index');
  const env = { ...process.env, GIT_INDEX_FILE: index };
  await gitAsync(['read-tree', commit], { env });
  for (const [p, from] of files) {
    const line = (await gitAsync(['ls-tree', from, '--', p])).trim();
    if (line) {
      const [mode, , oid] = line.split(/\s+/);
      await gitAsync(['update-index', '--add', '--cacheinfo', `${mode},${oid},${p}`], { env });
    } else await gitAsync(['update-index', '--force-remove', '--', p], { env });
  }
  const tree = (await gitAsync(['write-tree'], { env })).trim();
  fs.rmSync(index, { force: true });
  return commitTree(tree, label, await headNow());
}
export async function pin(id, which, commit) {
  try {
    await gitAsync(['update-ref', `refs/loa/runs/${id}/${which}`, commit]);
  } catch {}
}
export async function showAt(ref, p) {
  try {
    return await gitAsync(['show', `${ref}:${p}`]);
  } catch {
    return null;
  }
}
export async function computeChanges(before, after) {
  const range = [before, after, '--', '.', ':(exclude).loa'];
  // Each file's path and status from git's -z listing, which names any file exactly; its hunks from the patch, whose
  // file blocks come in the same order (the patch's headers quote names beyond ASCII).
  const [raw, patch] = await Promise.all([
    gitAsync(['diff', '--no-renames', '--raw', '-z', ...range]),
    gitAsync(['diff', '--no-color', '--no-renames', '--no-ext-diff', '-U0', ...range]),
  ]);
  const fields = raw.split('\0');
  const out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const status = fields[i].trim().split(' ').at(-1);
    out.push({ path: fields[i + 1], created: status === 'A', deleted: status === 'D', binary: false, hunks: [] });
  }
  let n = -1,
    h = null;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      n++;
      h = null;
    } else if (n < 0 || !out[n]) continue;
    else if (line.startsWith('Binary files')) out[n].binary = true;
    else if (line.startsWith('@@')) {
      const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      const a = +m[1],
        b = m[2] === undefined ? 1 : +m[2];
      h = { at: b === 0 ? a : a - 1, del: b, add: [] };
      out[n].hunks.push(h);
    } else if (h && line.startsWith('+')) h.add.push(line.slice(1));
  }
  // Renames, as git finds them (half the lines in common, `git diff -M`): the run's records stay a file deleted and
  // one created, which is what revert undoes; the created one names the file it came from.
  const moved = new Map();
  if (out.some(c => c.created) && out.some(c => c.deleted)) {
    const fields = (
      await gitAsync(['diff', '-M', '--name-status', '-z', '--no-ext-diff', before, after, '--', '.', ':(exclude).loa'])
    ).split('\0');
    for (let i = 0; i < fields.length; i++)
      if (fields[i]?.startsWith('R')) {
        moved.set(fields[i + 2], fields[i + 1]);
        i += 2;
      } else if (/^[ACDMTUX]/.test(fields[i] ?? '')) i += 1;
  }
  return Promise.all(
    out
      .filter(c => c.path && !c.binary && !SKIP.test(c.path))
      .map(async c => {
        const pre = c.created ? [] : splitLines((await showAt(before, c.path)) || '');
        const from = c.created ? moved.get(c.path) : undefined;
        return {
          path: c.path,
          created: c.created,
          deleted: c.deleted,
          pre: pre.slice(0, 4000),
          hunks: c.hunks,
          ...(from ? { renamedFrom: from } : {}),
        };
      }),
  );
}
