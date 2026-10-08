// The bridge's commands other than the hooks: start, stop, status, uninstall, hooks remove, and serve.
import path from 'node:path';
import { argv } from './args.mjs';
import { ROOT, prev, openRepo } from './repo.mjs';
import { initChecks } from './checks.mjs';
import { loadAgents } from './agents.mjs';
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
if (argv[0] === 'uninstall') await uninstall();
if (argv[0] === 'hooks' && argv[1] === 'remove') await removeHooksCommand();
if (argv[0] === 'stop') await stopBridge();
if (argv[0] === 'status') await bridgeStatus();
// Hooks go in only with consent: asked once in the terminal and remembered; --hooks and --no-hooks decide.
const hooks = argv.includes('--hooks')
  ? true
  : argv.includes('--no-hooks')
    ? false
    : typeof prev.hooks === 'boolean'
      ? prev.hooks
      : process.stdin.isTTY
        ? await askForHooks()
        : false;
// `start` (and no command) runs the bridge in the background; `serve` runs it here, in the foreground.
if (argv[0] !== 'serve') await startInBackground(hooks);
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
