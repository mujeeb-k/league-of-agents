#!/usr/bin/env node
// League of Agents bridge. Zero dependencies. Node 20+.
// Run inside a git repo:  node /path/to/bridge/loa.mjs
// Each command loads only what it needs: an agent's hook runs on every tool call, so it must start fast.
const [command, ...rest] = process.argv.slice(2);
if (command === 'hook') {
  const { runHook } = await import('./lib/hook.mjs');
  await runHook(rest[0], rest[1]);
} else await import('./lib/main.mjs');
