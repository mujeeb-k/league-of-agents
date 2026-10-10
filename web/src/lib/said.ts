// What the bridge says in its own words (a run's activity lines, a check's summary, a watch-mode run's title), worded
// here in the person's language: the bridge sends a code and its values (bridge/lib/util.mjs line), and the same
// sentence in English for apps that don't know the code.
import { t } from '../i18n';

type Args = Record<string, string | number>;

/** Each code's sentence. A code not here (a newer bridge's) shows the bridge's English. */
const SAID: Record<string, (a: Args) => string> = {
  'not-by-agent': a => t('Changed in this section, not by its agent: {files}', a),
  'outside-sections': a => t('Changed outside every section while others worked: {files}', a),
  'by-none': a => t('Changed while runs {runs} worked, by none of them.', a),
  unseen: a => t("Changed files the map doesn't show: {files}", a),
  'outside-scope': a => t('Changed outside scope: {files}', a),
  'put-back': a => t('Put back what a shell command changed outside the section: {files}', a),
  'not-started': a => t("Couldn't start: {why}", a),
  'no-sandbox-setup': a => t("The sandbox couldn't be set up: {why}", a),
  'needs-permission': a => t('Needs permission: {what}', a),
  'tool-failed': a => t('{what} failed', a),
  'no-resume': a => t("{agent} can't resume a session: this run starts a new one", a),
  'refused-task': a => t('{agent} refused the task', a),
  'hit-limit': a => t('{agent} stopped at its limit before finishing', a),
  'agent-error': a => `${a.agent}: ${a.why}`,
  exited: a => t('{agent} exited with code {code}', a),
  'exited-why': a => t('{agent} exited with code {code}: {why}', a),
  'refused-request': a => t('Refused: {what}', a),
  'not-launched': a => t('Could not start {command}: {why}', a),
  'check-port-busy': a => t('Skipped: port {port} is in use. Stop the running server first.', a),
  'check-stopped': a => t('Stopped after {seconds} s', a),
};

/** The codes worded here (a test holds them against the codes the bridge sends). */
export const SAID_CODES = Object.keys(SAID);

/** A line as the person reads it: by its code when the app knows it, else as the bridge wrote it. */
export const said = (e: { text?: string; summary?: string; say?: string; args?: Args }) =>
  (e.say && SAID[e.say]?.(e.args ?? {})) || e.text || e.summary || '';

/** A watch-mode run's title: "Edited main.py", or "Edited main.py and 2 more". */
export const editedTitle = (e: { file: string; more: number }) =>
  e.more ? t('Edited {file} and {n} more', { file: e.file, n: e.more }) : t('Edited {file}', { file: e.file });
