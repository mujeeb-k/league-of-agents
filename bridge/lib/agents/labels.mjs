// How an agent's work reads in the activity list: its tool calls and their failures, with paths as the repo names them.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../repo.mjs';

/** A failed tool call, as an activity entry: blocked by the scope lock, denied, or an error. */
export function toolError(content) {
  const text = relPaths(Array.isArray(content) ? content.map(c => c.text || '').join(' ') : content || '');
  const lock =
    text.match(/League of Agents scope lock: (\S+) is outside the selected scope/) ||
    text.match(/League of Agents scope lock: this edit changes (\S+ outside lines \S+)\./);
  if (lock) return { t: 'warn', text: `Blocked by the scope lock: ${lock[1]}` };
  const line = text.split('\n')[0].slice(0, 300);
  return /requires approval|permission/i.test(line) ? { t: 'deny', text: line } : { t: 'err', text: line };
}
/** Absolute paths inside the repo become repo-relative, in any text. */
export function relPaths(text) {
  return String(text)
    .split(ROOT + path.sep)
    .join('')
    .split(ROOT)
    .join('.');
}
/** A path as the repo sees it, following symlinks (macOS /var is /private/var) before making it relative. */
export function repoRelative(f) {
  let abs = path.resolve(ROOT, f);
  try {
    abs = fs.realpathSync(abs);
  } catch {
    try {
      abs = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
    } catch {
      /* neither the file nor its folder exists: keep the path as given */
    }
  }
  return path.relative(ROOT, abs);
}
/** A Claude Code, Cursor or Codex tool call as an activity entry: its name and the file, command or pattern it names. */
export function toolLabel(name, input = {}) {
  const f = input.file_path || input.notebook_path || input.path;
  if (f) return `${name} ${repoRelative(f)}`;
  if (input.command) return `${name} ${relPaths(input.command).slice(0, 80)}`;
  if (input.pattern) return `${name} ${input.pattern}`;
  return name;
}
