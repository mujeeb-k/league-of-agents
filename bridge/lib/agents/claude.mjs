// Whether Claude Code can run here: installed, and logged in.
import { execFile, execFileSync } from 'node:child_process';
import { onPath } from '../util.mjs';
import { ROOT } from '../repo.mjs';
import { emit } from '../events.mjs';
import { AGENTS, BIN } from './registry.mjs';

/**
 * Whether Claude Code is installed and logged in, asked of `claude auth status` without blocking. Only an
 * explicit "loggedIn": false counts as logged out: an older Claude Code without the command, or an answer that
 * isn't JSON, leaves it runnable. Asked before each Claude Code run, and every 15 s while there is a problem,
 * so installing or logging in clears it without a restart.
 */
export const CLAUDE_RECHECK_MS = Number(process.env.LOA_CLAUDE_RECHECK_MS) || 15000;
let claudeAsked = 0;
const loggedOut = out => {
  try {
    return JSON.parse(out).loggedIn === false;
  } catch {
    return false;
  }
};
/** What to tell the person when Claude Code can't run, with the command that fixes it. */
export const CLAUDE_FIX = {
  missing: "Claude Code isn't installed. To run it from the map: curl -fsSL https://claude.ai/install.sh | bash",
  loggedOut: "Claude Code isn't logged in. To run it from the map: claude auth login",
};
/** The same check, waited for: `start` says it before it hands over the link. */
export function claudeProblemNow() {
  if (!onPath(BIN.claude)) return 'missing';
  let out = '';
  try {
    out = execFileSync(BIN.claude, ['auth', 'status', '--json'], {
      cwd: ROOT,
      timeout: 10000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (e) {
    out = String(e.stdout || '');
  }
  return loggedOut(out) ? 'loggedOut' : null;
}
export function checkClaude(then) {
  const done = () => then?.();
  if (Date.now() - claudeAsked < CLAUDE_RECHECK_MS) return done();
  claudeAsked = Date.now();
  const setProblem = problem => {
    const was = AGENTS.claude.problem;
    AGENTS.claude.problem = problem;
    AGENTS.claude.available = !problem;
    if (was !== problem) emit('state');
  };
  if (!onPath(BIN.claude)) {
    setProblem('missing');
    return done();
  }
  execFile(BIN.claude, ['auth', 'status', '--json'], { cwd: ROOT, timeout: 10000 }, (_, out) => {
    setProblem(loggedOut(out) ? 'loggedOut' : null);
    done();
  });
}
/** Claude Code answered as logged out mid-session: said at once, and asked again after the usual wait. */
export function claudeLoggedOut() {
  AGENTS.claude.problem = 'loggedOut';
  AGENTS.claude.available = false;
  claudeAsked = Date.now();
  emit('state');
}
