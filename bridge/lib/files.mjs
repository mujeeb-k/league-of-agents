// The repo's files as the map shows them: which files, their first lines, and which the app may read or write.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, IGNORE, git, gitAsync } from './repo.mjs';
import { logError } from './util.mjs';

export const CODE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|py|go|rs|rb|java|kt|swift|c|h|cpp|cs|php|vue|svelte|css|scss|html|sql|sh|md|yml|yaml|toml)$/i;
export const SKIP =
  /(^|\/)(node_modules|\.git|\.loa|dist|build|coverage|\.next|\.turbo)(\/|$)|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$|(^|\/)\.env/;
export const MAX_LINES = 400,
  // Most files a map shows; a larger folder is mapped by one of its folders instead (the app asks which).
  MAX_FILES = 10000,
  // A map of more files than this carries no lines in the state: the app asks for files' first lines as it shows
  // them (heads).
  LINES_UNDER = 1500,
  // Larger files are left off the map and can't be opened: a guard against reading a giant file into memory.
  MAX_BYTES = 16 * 1024 * 1024;
/** Text, as git judges it: no NUL byte in the first 8,000 bytes. */
export const isText = buf => !buf.subarray(0, 8000).includes(0);

const LIST = ['ls-files', '-z', '--cached', '--others', '--exclude-standard'];
/** A path the map shows when git lists it: code, not in the skip list or loa.config's ignore list. */
export const isCode = p => CODE_EXT.test(p) && !SKIP.test(p) && !IGNORE.some(g => g && p.startsWith(g));
/** The code files among what git lists, sorted. */
function codeOf(out) {
  const files = [...new Set(out.split('\0').filter(Boolean))].filter(isCode).sort();
  return { files, set: new Set(files) };
}
/** The repo's code files, as last listed: listed again, without blocking, once files come or go (forgetFiles). */
let listed = /** @type {{ files: string[]; set: Set<string> } | null} */ (null);
let relisting = /** @type {NodeJS.Timeout | null} */ (null);
/**
 * Files came or went, or HEAD moved: listed again in a moment (llvm's 186,000 take seconds). Until then, the list as
 * it was. The app hears of the files themselves from the run or the watch-mode run that changed them.
 */
export function forgetFiles() {
  if (relisting) return;
  relisting = setTimeout(async () => {
    try {
      listed = codeOf(await gitAsync(LIST));
    } catch (e) {
      logError(e);
    }
    relisting = null;
  }, 200);
}
/** Every code file in the repo, on any map or none: what the app may open. */
export function codeFiles() {
  listed ??= codeOf(git(LIST));
  return listed;
}
/** The files a map of a folder ('' for the whole repo, else ending in /) shows: the first MAX_FILES in it. */
export function listFiles(root = '') {
  const { files } = codeFiles();
  return (root ? files.filter(p => p.startsWith(root)) : files).slice(0, MAX_FILES);
}
/** Every folder holding code files, with how many are in it and under it: the folders a map can be of. */
export function folders() {
  const { files } = codeFiles();
  const counts = new Map([['', files.length]]);
  for (const p of files) {
    for (let i = p.indexOf('/'); i >= 0; i = p.indexOf('/', i + 1)) {
      const dir = p.slice(0, i + 1);
      counts.set(dir, (counts.get(dir) ?? 0) + 1);
    }
  }
  return [...counts].map(([path, files]) => ({ path, files }));
}
/**
 * A file as the map shows it: its length and first lines (none with `lines` false); null for one the map leaves out.
 * The whole file opens on demand (/api/file), so only its start is decoded here.
 */
export function treeEntry(p, lines = true) {
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
  if (!lines) return { path: p, total, lines: [] };
  const head = buf
    .subarray(0, 256 * 1024)
    .toString('utf8')
    .split('\n');
  return { path: p, total, lines: head.slice(0, Math.min(MAX_LINES, total)) };
}
/**
 * The map of a folder: each file with its length and first lines, or for a map of LINES_UNDER files or more, its
 * length alone (the app asks for lines as it shows a file).
 */
export function readTree(root = '') {
  const files = listFiles(root);
  return files.map(p => treeEntry(p, files.length < LINES_UNDER)).filter(Boolean);
}
export const hashOf = text => crypto.createHash('sha1').update(text).digest('hex');
/**
 * The absolute path of a file the app may read or write, or null: only a code file (codeFiles, which leaves out .env
 * files, .git, .loa and the skip list), whose real path is inside the repo, and that is text under MAX_BYTES.
 */
export function repoFile(rel) {
  if (typeof rel !== 'string' || !codeFiles().set.has(rel)) return null;
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
