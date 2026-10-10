#!/usr/bin/env node
// Stand-in agent that records each prompt it is given, and its arguments, to $PROBE_LOG. With $PROBE_TRY, also
// whether it could write that file. With $PROBE_PREPEND naming a file, it adds
// two lines at the top of that file, as an agent working above a selection would. With $PROBE_INSERT as "file:n", it
// adds a line after line n of that file, as an agent working inside a selection would. With $PROBE_DELETE as
// "file:from-to", it deletes those lines, as an agent removing the selected code would.
import fs from 'node:fs';
if (process.argv[2] === 'auth') {
  console.log(JSON.stringify({ loggedIn: true }));
  process.exit(0);
}
const args = process.argv.slice(2);
// With $PROBE_TRY naming a file, it tries to write it, and records whether it could: whether a sandbox holds it.
let wrote;
if (process.env.PROBE_TRY)
  try {
    fs.writeFileSync(process.env.PROBE_TRY, 'x');
    wrote = true;
  } catch {
    wrote = false;
  }
fs.appendFileSync(process.env.PROBE_LOG, JSON.stringify({ prompt: args[args.indexOf('-p') + 1], args, wrote }) + '\n');
if (process.env.PROBE_PREPEND)
  fs.writeFileSync(
    process.env.PROBE_PREPEND,
    '// added\n// by the agent\n' + fs.readFileSync(process.env.PROBE_PREPEND, 'utf8'),
  );
if (process.env.PROBE_INSERT) {
  const [file, n] = process.env.PROBE_INSERT.split(':');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.splice(+n, 0, '  // added by the agent');
  fs.writeFileSync(file, lines.join('\n'));
}
if (process.env.PROBE_DELETE) {
  const [, file, from, to] = /^(.+):(\d+)-(\d+)$/.exec(process.env.PROBE_DELETE);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.splice(+from - 1, +to - +from + 1);
  fs.writeFileSync(file, lines.join('\n'));
}
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'probe' }));
console.log(JSON.stringify({ type: 'result', result: 'Recorded.', session_id: 'probe', total_cost_usd: 0 }));
