// What went wrong, in words a person can act on. Raw errors (HTTP codes, exceptions) never reach the UI.
import { agentOf } from '../lib/constants';
import { BridgeError } from './client';

export const UNREACHABLE =
  'Could not reach the bridge. Is it running? In Chrome, allow local network access for this site.';

/** Marks a connection the browser refused: this site may not reach apps on this computer (StageState says so). */
export const BLOCKED = 'blocked';

export function explain(e: unknown): string {
  if (!(e instanceof BridgeError)) return UNREACHABLE;
  if (e.status === 401) return 'The bridge rejected that link. Copy the latest one it printed.';
  if (e.status === 423)
    return 'The bridge locked itself after too many wrong links. Restart it with npx leagueofagents-cli@latest start.';
  const missing = /^(\S+) is not installed/.exec(e.message);
  if (missing) return `${agentOf(missing[1]!).name} isn't installed on this computer.`;
  if (e.status === 404) return 'That run no longer exists on the bridge.';
  // 409s carry the bridge's own sentence, written for people (for example, a run that is still active).
  if (e.status === 409 && e.message) return e.message;
  return "The bridge couldn't do that. Try again, or restart the bridge if it keeps happening.";
}
