// Small helpers shared by the bridge and its hooks.
import fs from 'node:fs';
import path from 'node:path';

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
