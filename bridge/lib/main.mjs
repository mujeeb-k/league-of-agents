// The bridge's commands other than the hooks: start, stop, status, uninstall, hooks remove, and serve.
import path from 'node:path';
import { command, opt, subcommand } from './args.mjs';
import { ROOT, prev, openRepo } from './repo.mjs';
import { initChecks } from './checks.mjs';
import { loadAgents } from './agents/registry.mjs';
import {
  linkOf,
  running,
  startInBackground,
  stopBridge,
  bridgeStatus,
  askForHooks,
  uninstall,
  removeHooksCommand,
} from './cli.mjs';
import { serve } from './serve.mjs';

openRepo();
initChecks();
loadAgents();
if (command === 'uninstall') await uninstall();
if (command === 'hooks' && subcommand === 'remove') await removeHooksCommand();
if (command === 'stop') await stopBridge();
if (command === 'status') await bridgeStatus();
// Hooks go in only with consent: asked once in the terminal and remembered; --hooks and --no-hooks decide.
const hooks = opt('hooks')
  ? true
  : opt('no-hooks')
    ? false
    : typeof prev.hooks === 'boolean'
      ? prev.hooks
      : process.stdin.isTTY
        ? await askForHooks()
        : false;
// `start` (and no command) runs the bridge in the background; `serve` runs it here, in the foreground.
if (command !== 'serve') await startInBackground(hooks);
// One bridge per repo. A second would take over .loa/bridge.json, and the hooks, which find the bridge there,
// would send its prompts and stops to the wrong one. `start` already opened the running one instead.
{
  const other = await running();
  if (other) {
    console.log(`League of Agents is already running for ${path.basename(ROOT)}: ${linkOf(other)}`);
    process.exit(0);
  }
}
await serve(hooks);
