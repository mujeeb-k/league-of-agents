// Outcome tests for what League of Agents says it never stores: a marker is planted, the product is used, and then
// every place the marker could have landed is searched, not only the place a fix touched.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Every file under a folder, as absolute paths; symlinks are not followed. */
function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? filesUnder(p) : e.isFile() ? [p] : [];
  });
}

/**
 * Where a marker landed: every object git holds for the repo, and in each League of Agents store found in the folders
 * given (loose or packed, reachable or not, read as content), every file under .git and .loa as bytes, and every file
 * under the other folders given (the bridge's home and temp folders). The working tree itself, where the marker was
 * planted, is not searched.
 */
export function landings(marker: string, repo: string, folders: string[]): string[] {
  const hits: string[] = [];
  const stores = folders.flatMap(f => {
    const repos = path.join(f, '.config/league-of-agents/repos');
    return fs.existsSync(repos)
      ? fs
          .readdirSync(repos)
          .map(d => path.join(repos, d, 'git'))
          .filter(d => fs.existsSync(path.join(d, 'objects')))
      : [];
  });
  for (const at of [[], ...stores.map(d => ['--git-dir', d])]) {
    const git = (...args: string[]) => execFileSync('git', [...at, ...args], { cwd: repo, maxBuffer: 1 << 30 });
    for (const line of git('cat-file', '--batch-all-objects', '--batch-check').toString().split('\n')) {
      const [oid, type] = line.split(' ');
      if (oid && type !== 'missing' && git('cat-file', type!, oid).includes(marker))
        hits.push(`git object ${oid} (${type})${at.length ? ` in ${at[1]}` : ''}`);
    }
  }
  for (const dir of [path.join(repo, '.git'), path.join(repo, '.loa'), ...folders])
    for (const f of filesUnder(dir)) if (fs.readFileSync(f).includes(marker)) hits.push(f.replace(repo + path.sep, ''));
  return hits;
}
