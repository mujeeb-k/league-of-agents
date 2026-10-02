#!/usr/bin/env node
// Stand-in for `codex exec --json`, until real Codex streams are recorded.
// Appends its arguments to $FAKE_CODEX_ARGS so tests can check how the bridge called it.
import fs from 'node:fs';
if (process.env.FAKE_CODEX_ARGS)
  fs.appendFileSync(process.env.FAKE_CODEX_ARGS, JSON.stringify(process.argv.slice(2)) + '\n');
const out = o => console.log(JSON.stringify(o));
out({ type: 'thread.started', thread_id: 'thr-fake-1' });
out({ type: 'turn.started' });
fs.writeFileSync('shared/log.ts', 'export const log = (msg: string) => console.log(`[codex] ${msg}`);\n');
out({
  type: 'item.completed',
  item: { id: 'item_0', type: 'file_change', changes: [{ path: 'shared/log.ts', kind: 'update' }] },
});
out({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'Changed the log prefix.' } });
out({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } });
