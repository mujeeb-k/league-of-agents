// The repo's files as the map shows them: which files, their first lines, and which the app may read or write.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, IGNORE, git } from './repo.mjs';

export const CODE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|py|go|rs|rb|java|kt|swift|c|h|cpp|cs|php|vue|svelte|css|scss|html|sql|sh|md|yml|yaml|toml)$/i;
export const SKIP =
  /(^|\/)(node_modules|\.git|\.loa|dist|build|coverage|\.next|\.turbo)(\/|$)|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$|(^|\/)\.env/;
export const MAX_LINES = 400,
  MAX_FILES = 1500,
  // Larger files are left off the map and can't be opened: a guard against reading a giant file into memory.
  MAX_BYTES = 16 * 1024 * 1024;
/** Text, as git judges it: no NUL byte in the first 8,000 bytes. */
export const isText = buf => !buf.subarray(0, 8000).includes(0);

export function listFiles() {
  const out = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean);
  return [...new Set(out)]
    .filter(p => CODE_EXT.test(p) && !SKIP.test(p) && !IGNORE.some(g => g && p.startsWith(g)))
    .sort()
    .slice(0, MAX_FILES);
}
/**
 * A file as the map shows it: its length and first lines; null for one the map leaves out. The whole file opens on
 * demand (/api/file), so only its start is decoded here.
 */
export function treeEntry(p) {
  const abs = path.join(ROOT, p);
  let buf;
  try {
    if (fs.statSync(abs).size > MAX_BYTES) return null;
    buf = fs.readFileSync(abs);
  } catch {
    return null;
  }
  if (!isText(buf)) return null;
  let total = 0;
  for (let i = buf.indexOf(10); i >= 0; i = buf.indexOf(10, i + 1)) total++;
  if (buf.length && buf[buf.length - 1] !== 10) total++;
  const head = buf
    .subarray(0, 256 * 1024)
    .toString('utf8')
    .split('\n');
  return { path: p, total, lines: head.slice(0, Math.min(MAX_LINES, total)) };
}
export function readTree() {
  return listFiles().map(treeEntry).filter(Boolean);
}
export const hashOf = text => crypto.createHash('sha1').update(text).digest('hex');
/**
 * The absolute path of a file the app may read or write, or null: only a file the map shows (listFiles,
 * which leaves out .env files, .git, .loa and the skip list), whose real path is inside the repo, and that
 * is text under MAX_BYTES.
 */
export function repoFile(rel) {
  if (typeof rel !== 'string' || !listFiles().includes(rel)) return null;
  const abs = path.join(ROOT, rel);
  try {
    const real = fs.realpathSync(abs);
    if (!real.startsWith(fs.realpathSync(ROOT) + path.sep)) return null;
    const st = fs.statSync(real);
    if (!st.isFile() || st.size > MAX_BYTES || !isText(fs.readFileSync(real))) return null;
  } catch {
    return null;
  }
  return abs;
}
