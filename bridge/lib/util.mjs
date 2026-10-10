// Small helpers shared by the bridge and its hooks.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function readJson(p, d) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return d;
  }
}
/** A file's text as lines, as git shows it (line endings kept), without the empty line after a final newline. */
export function splitLines(t) {
  const l = t.split('\n');
  if (l.length && l[l.length - 1] === '') l.pop();
  return l;
}
/** A file's text as lines, line endings normalised, without the empty line after a final newline. */
export function textLines(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
/**
 * A path through its symlinks (macOS's /var is /private/var, /tmp is /private/tmp), also for a file not made yet: its
 * nearest folder that exists, resolved, and the rest.
 */
export function realish(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    const up = path.dirname(p);
    return up === p ? p : path.join(realish(up), path.basename(p));
  }
}
/** Whether a token someone sent is the secret, in time that doesn't tell how much of it matched. */
export function sameSecret(sent, secret) {
  const a = Buffer.from(sent),
    b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
/**
 * A line the bridge writes into a run's activity, for the app to word in the person's language: `say` names the
 * sentence and `args` its values (web/src/lib/said.ts). `text` is the same sentence in English, for older apps.
 */
export const line = (t, say, text, args = {}) => ({ t, text, say, args });
/** A request the bridge turns down, as an error the app words by its reason (code 409). */
export const refused = (reason, message, args = {}) => Object.assign(new Error(message), { code: 409, reason, args });
export const logError = e => console.error(e.message);
/**
 * Runs baseline and snapshot work one at a time, in order: they share the snapshot index and the baseline.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function serial(fn) {
  const done = lane.then(fn);
  lane = done.catch(() => {});
  return done;
}
/** @type {Promise<unknown>} */
let lane = Promise.resolve();
export function onPath(bin) {
  if (path.isAbsolute(bin)) return fs.existsSync(bin);
  return (process.env.PATH || '')
    .split(path.delimiter)
    .some(d => ['', '.cmd', '.exe'].some(e => fs.existsSync(path.join(d, bin + e))));
}
