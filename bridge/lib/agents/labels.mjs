// How an agent's work reads in the activity list: its tool calls and their failures, with paths as the repo names them.
import path from 'node:path';
import { ROOT } from '../repo.mjs';
import { realish } from '../util.mjs';

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
/**
 * The repo's path as an agent may name it: its real path, and on macOS the form without /private that links to it
 * (/var is /private/var, /tmp is /private/tmp); the longer first, so it is replaced whole.
 */
let forms;
const rootForms = () => {
  if (forms?.[0] !== ROOT) {
    const alias = ROOT.startsWith('/private/') ? ROOT.slice('/private'.length) : null;
    forms = alias && realish(alias) === ROOT ? [ROOT, alias] : [ROOT];
  }
  return forms;
};
/** Absolute paths inside the repo become repo-relative, in any text. */
export function relPaths(text) {
  let out = String(text);
  for (const root of rootForms()) out = out.replaceAll(root + path.sep, '').replaceAll(root, '.');
  return out;
}
/** A path as the repo sees it, following symlinks (macOS /var is /private/var) before making it relative. */
export function repoRelative(f) {
  return path.relative(ROOT, realish(path.resolve(ROOT, f)));
}
/** A Claude Code, Cursor or Codex tool call as an activity entry: its name and the file, command or pattern it names. */
export function toolLabel(name, input = {}) {
  const f = input.file_path || input.notebook_path || input.path;
  if (f) return `${name} ${repoRelative(f)}`;
  if (input.command) return `${name} ${relPaths(input.command).slice(0, 80)}`;
  if (input.pattern) return `${name} ${input.pattern}`;
  return name;
}
/**
 * What a tool call did, for the app to word: what it does, the file in the repo it names, the command it runs. `text`
 * stays for older apps.
 */
export function toolSaid(act, file, cmd) {
  const inRepo = file && file !== '..' && !file.startsWith('../') && !path.isAbsolute(file);
  return {
    act,
    ...(inRepo ? { path: file } : {}),
    ...(act === 'run' && typeof cmd === 'string' ? { cmd: relPaths(cmd).slice(0, 200) } : {}),
  };
}
