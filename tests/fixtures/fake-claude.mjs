#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
// While the file FAKE_CLAUDE_LOGGED_OUT names exists, it answers as a logged-out Claude Code does: to
// `auth status`, and to a prompt.
const loggedOut = !!process.env.FAKE_CLAUDE_LOGGED_OUT && fs.existsSync(process.env.FAKE_CLAUDE_LOGGED_OUT);
if (args[0] === 'auth') {
  console.log(JSON.stringify({ loggedIn: !loggedOut, authMethod: loggedOut ? 'none' : 'claude.ai' }));
  process.exit(loggedOut ? 1 : 0);
}
const prompt = args[args.indexOf('-p') + 1];
const out = o => console.log(JSON.stringify(o));
// Claude Code's first event names the model, as in tests/fixtures/agents/claude/claude-canvas-follow-up.jsonl.
out({ type: 'system', subtype: 'init', session_id: 'sess-123', model: 'claude-sonnet-5-5' });
if (loggedOut) {
  const text = 'Not logged in · Please run /login';
  out({ type: 'assistant', error: 'authentication_failed', message: { content: [{ type: 'text', text }] } });
  out({ type: 'result', is_error: true, result: text, session_id: 'sess-123', total_cost_usd: 0 });
  process.exit(1);
}
out({
  type: 'assistant',
  message: {
    content: [
      { type: 'text', text: 'Adding a stale-policy guard.' },
      // The edit it reports, as Claude Code's Edit tool does. The lines it appends below, and the file it creates,
      // it writes without an edit tool, as a shell command would: no Edit or Write input names them.
      {
        type: 'tool_use',
        name: 'Edit',
        input: {
          file_path: process.cwd() + '/shared/allowlist.ts',
          old_string: "    throw new Error('ALLOWLIST_VIOLATION');",
          new_string: '    throw new Error(`ALLOWLIST_VIOLATION: ${action} on ${origin}`);',
        },
      },
    ],
  },
});
let t = fs.readFileSync('shared/allowlist.ts', 'utf8');
t = t.replace(
  "throw new Error('ALLOWLIST_VIOLATION');",
  'throw new Error(`ALLOWLIST_VIOLATION: ${action} on ${origin}`);',
);
t += '\nexport function isEmpty(p: Policy) {\n  return p.origins.length === 0;\n}\n';
fs.writeFileSync('shared/allowlist.ts', t);
fs.writeFileSync(
  'shared/policy-cache.ts',
  "import { loadPolicy } from './allowlist';\n\nexport const cached = loadPolicy();\n",
);
await new Promise(r => setTimeout(r, 400));
out({
  type: 'result',
  result: 'Violation errors now name the action and origin. Added isEmpty and a policy cache.',
  session_id: 'sess-123',
  total_cost_usd: 0.0123,
});
