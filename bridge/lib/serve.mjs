// The bridge running: its first baseline, then the server, until it is stopped.
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { logError, onPath } from './util.mjs';
import { WEB_URL, ASKED_PORT } from './args.mjs';
import { ROOT, bridgeFile, TOKEN } from './repo.mjs';
import { AGENTS, ACP } from './agents/registry.mjs';
import { CLAUDE_RECHECK_MS, checkClaude } from './agents/claude.mjs';
import { stopSessions } from './sessions.mjs';
import { copyForHooks, installHooks, removeHooks } from './hooks-install.mjs';
import { working, loadRuns, pruneRuns, finishRun, interruptLeftover } from './runs.mjs';
import { watch } from './watch.mjs';
import { emit } from './events.mjs';
import { createBridgeServer, firstFreePort, listening } from './server.mjs';

/** Hooks installed this start: Claude Code is told edits outside the scope are blocked only when they are. */
export let HOOKS = false;
/**
 * Runs the bridge here, until it is stopped: `serve`, and what `start` runs in the background. Takes the first
 * baseline before it listens, so the first request finds the repo as it is.
 */
export async function serve(hooks) {
  HOOKS = hooks;
  // A port asked for is used as it is (and a busy one says so); otherwise the first free one from 43210, so a
  // second repo's bridge doesn't fail because the first holds the usual port.
  const port = ASKED_PORT ? Number(ASKED_PORT) : await firstFreePort(43210);
  fs.writeFileSync(bridgeFile, JSON.stringify({ port, token: TOKEN, hooks, pid: process.pid, web: WEB_URL }, null, 2));
  copyForHooks();
  if (hooks) installHooks();
  else removeHooks();
  loadRuns();
  pruneRuns();
  // Watch mode starts once events can be sent: it says so if it can't start.
  await watch();
  await interruptLeftover();
  // Stopping the bridge mid-run closes the run the same way; an agent it started is stopped first.
  for (const sig of ['SIGTERM', 'SIGINT'])
    process.on(sig, async () => {
      const left = [...working.values()];
      for (const run of left) run.status = 'interrupted';
      // A captured terminal turn has no agent of ours to stop: it ends here.
      if (!(await stopSessions())) for (const run of left) await finishRun(run, 'interrupted').catch(logError);
      process.exit(0);
    });
  const server = createBridgeServer(port);
  server.listen(port, '127.0.0.1', () => checkClaude(() => listening(port)));
  for (const [id, a] of Object.entries(ACP))
    if (a.check && onPath(a.check[0]))
      execFile(a.check[0], a.check.slice(1), { cwd: ROOT, timeout: 60000 }, e => {
        AGENTS[id].available = !e;
        if (!e) emit('state');
      });
  setInterval(() => AGENTS.claude.problem && checkClaude(), CLAUDE_RECHECK_MS).unref();
}
