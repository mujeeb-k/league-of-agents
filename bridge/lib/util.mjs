// Small helpers with no state of their own, shared by the bridge and its hooks.
import fs from 'node:fs';

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
