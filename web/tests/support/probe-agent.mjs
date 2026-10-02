#!/usr/bin/env node
// Stand-in agent that records each prompt it is given to $PROBE_LOG. With $PROBE_PREPEND naming a file, it adds
// two lines at the top of that file, as an agent working above a selection would.
import fs from 'node:fs';
if (process.argv[2] === 'auth') {
  console.log(JSON.stringify({ loggedIn: true }));
  process.exit(0);
}
const args = process.argv.slice(2);
fs.appendFileSync(process.env.PROBE_LOG, JSON.stringify({ prompt: args[args.indexOf('-p') + 1] }) + '\n');
if (process.env.PROBE_PREPEND)
  fs.writeFileSync(
    process.env.PROBE_PREPEND,
    '// added\n// by the agent\n' + fs.readFileSync(process.env.PROBE_PREPEND, 'utf8'),
  );
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'probe' }));
console.log(JSON.stringify({ type: 'result', result: 'Recorded.', session_id: 'probe', total_cost_usd: 0 }));
