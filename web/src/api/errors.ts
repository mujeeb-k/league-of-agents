// What went wrong, in words a person can act on. Raw errors (HTTP codes, exceptions) never reach the UI.
import { t } from '../i18n';
import { agentOf } from '../lib/constants';
import { BridgeError } from './client';

/** Nothing answered: a key, so callers can tell this case apart in every language (compare with `t(UNREACHABLE)`). */
export const UNREACHABLE =
  'Could not reach the bridge. Is it running? In Chrome, allow local network access for this site.';

/** Marks a connection the browser refused: this site may not reach apps on this computer (StageState says so). */
export const BLOCKED = 'blocked';

/** The bridge's errors by their code (bridge/loa.mjs sends one with each error the app shows), in English: the keys. */
export const BY_CODE: Record<string, string> = {
  'not-installed': "{agent} isn't installed on this computer.",
  'not-logged-in': "{agent} isn't logged in. Run claude auth login, then try again.",
  'lines-changed': 'The lines you selected in {name} changed. Select them again.',
  'run-active': 'Run {id} is still active',
  'sections-overlap': 'Run {id} is working on {path}. Pick a section outside it, or wait for it to finish.',
  'wait-for-run': 'Wait for the run to finish',
  'hooks-run-active': 'A run is in progress. Remove the hooks once it finishes.',
  'no-commit': 'There is no commit yet.',
  'no-kept-lines': 'No file as the last commit has it has lines from a kept run.',
  'note-exists': 'This commit already has a Git AI note; League of Agents never writes over it.',
  'no-agent-lines': 'No line from a kept run was written by an agent.',
};

export function explain(e: unknown): string {
  if (!(e instanceof BridgeError)) return t(UNREACHABLE);
  if (e.status === 401) return t('The bridge rejected that link. Copy the latest one it printed.');
  if (e.status === 423)
    return t(
      'The bridge locked itself after too many wrong links. Restart it with npx leagueofagents-cli@latest start.',
    );
  const { code, args = {} } = e.data;
  const said = code ? BY_CODE[code] : undefined;
  if (said) return t(said, typeof args.agent === 'string' ? { ...args, agent: agentOf(args.agent).name } : args);
  // A bridge before 0.2.0 sends no code: its English is matched, or a 409's sentence shown as it is.
  const missing = /^(\S+) is not installed/.exec(e.message);
  if (missing) return t("{agent} isn't installed on this computer.", { agent: agentOf(missing[1]!).name });
  if (e.status === 404) return t('That run no longer exists on the bridge.');
  if (e.status === 409 && e.message) return e.message;
  return t("The bridge couldn't do that. Try again, or restart the bridge if it keeps happening.");
}
