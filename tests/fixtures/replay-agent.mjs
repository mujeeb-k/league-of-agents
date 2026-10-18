#!/usr/bin/env node
// Replays a recorded agent stream (tests/fixtures/agents/) as if it were the agent, so the bridge's
// parser can be tested against real output. /repo in the fixture becomes the current repo root.
import fs from 'node:fs';
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
const fixture = process.env.LOA_FIXTURE;
if (!fixture) {
  console.error('Set LOA_FIXTURE to a recorded stream.');
  process.exit(1);
}
// A line {"loa_wait": "<name>"} isn't the agent's: the replay holds there until .loa/go-<name> exists, so a test can
// say when the rest of the recording happens.
for (const line of fs.readFileSync(fixture, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const hold = /^\{"loa_wait":"([\w-]+)"\}$/.exec(line.trim())?.[1];
  if (!hold) console.log(line.split('/repo').join(process.cwd()));
  else while (!fs.existsSync(`.loa/go-${hold}`)) await new Promise(r => setTimeout(r, 50));
}
