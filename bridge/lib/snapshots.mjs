// Snapshots: the working tree as private git commits, pinned under refs/loa/; never your branch or staging.
import fs from 'node:fs';
import path from 'node:path';
import { splitLines } from './util.mjs';
import { LOA, gitAsync } from './repo.mjs';
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
export async function writeTree(fresh = false) {
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
      ...SECRET_FILES.map(g => `:(glob)**/${g}`),
    ])
  )
    .split('\0')
    .filter(Boolean);
  await gitAsync(['add', '-A'], { env });
  if (untrackedSecrets.length) await gitAsync(['rm', '--cached', '-q', '--', ...untrackedSecrets], { env });
  return (await gitAsync(['write-tree'], { env })).trim();
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
  const patch = await gitAsync([
    'diff',
    '--no-color',
    '--no-renames',
    '--no-ext-diff',
    '-U0',
    before,
    after,
    '--',
    '.',
    ':(exclude).loa',
  ]);
  const out = [];
  let cur = null,
    h = null;
  const unq = s => (s.startsWith('"') ? JSON.parse(s) : s);
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      cur = { path: null, created: false, deleted: false, binary: false, hunks: [] };
      out.push(cur);
      h = null;
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('new file mode')) cur.created = true;
    else if (line.startsWith('deleted file mode')) cur.deleted = true;
    else if (line.startsWith('Binary files')) cur.binary = true;
    else if (line.startsWith('--- ')) {
      const a = unq(line.slice(4));
      if (a !== '/dev/null') cur.path = a.replace(/^a\//, '');
    } else if (line.startsWith('+++ ')) {
      const b = unq(line.slice(4));
      if (b !== '/dev/null') cur.path = b.replace(/^b\//, '');
    } else if (line.startsWith('@@')) {
      const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      const a = +m[1],
        b = m[2] === undefined ? 1 : +m[2];
      h = { at: b === 0 ? a : a - 1, del: b, add: [] };
      cur.hunks.push(h);
    } else if (h && line.startsWith('+')) h.add.push(line.slice(1));
  }
  return Promise.all(
    out
      .filter(c => c.path && !c.binary && !SKIP.test(c.path))
      .map(async c => {
        const pre = c.created ? [] : splitLines((await showAt(before, c.path)) || '');
        return { path: c.path, created: c.created, deleted: c.deleted, pre: pre.slice(0, 4000), hunks: c.hunks };
      }),
  );
}
