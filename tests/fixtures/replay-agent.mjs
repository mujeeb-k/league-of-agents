#!/usr/bin/env node
// Replays a recorded agent stream (tests/fixtures/agents/) as if it were the agent, so the bridge's
// parser can be tested against real output. /repo in the fixture becomes the current repo root.
import fs from 'node:fs';
// The bridge asks whether Claude Code is logged in; a stand-in always is.
if (process.argv[2] === 'auth') {
  console.log(JSON.stringify({ loggedIn: true }));
  process.exit(0);
}
const fixture = process.env.LOA_FIXTURE;
if (!fixture) {
  console.error('Set LOA_FIXTURE to a recorded stream.');
  process.exit(1);
}
for (const line of fs.readFileSync(fixture, 'utf8').split('\n'))
  if (line.trim()) console.log(line.split('/repo').join(process.cwd()));
