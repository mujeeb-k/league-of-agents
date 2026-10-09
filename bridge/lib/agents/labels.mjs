// How an agent's work reads in the activity list: its tool calls and their failures, with paths as the repo names them.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../repo.mjs';

/** What a failed tool call said, as text with the repo's paths made relative. */
export const toolText = content =>
  relPaths(Array.isArray(content) ? content.map(c => c.text || '').join(' ') : content || '');
/**
 * Whether a failed write was refused, not wrong: by the scope lock (lib/hook.mjs words it so), or by the system
 * (macOS's sandbox, in a session that runs in it).
 */
export const refusedWrite = (text, sandboxed) =>
  text.includes('League of Agents scope lock:') || (sandboxed && /\bEPERM\b|operation not permitted/i.test(text));
/** A failed tool call, as an activity entry: denied, or an error. */
export function toolError(text) {
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
