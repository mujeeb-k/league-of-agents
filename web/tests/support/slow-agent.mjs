#!/usr/bin/env node
// Stand-in agent that starts and then waits, so a run can be cancelled mid-flight.
// The bridge asks whether Claude Code is logged in; a stand-in always is.
// Its version, as `claude --version` prints it: one whose sessions the bridge holds.
if (process.argv[2] === '--version') {
  console.log('2.1.295 (Claude Code)');
  process.exit(0);
}
if (process.argv[2] === 'auth') {
  console.log(JSON.stringify({ loggedIn: true }));
  process.exit(0);
}
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-slow' }));
console.log(
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Reading the policy module.' }] } }),
);
setTimeout(() => {}, 120_000);
