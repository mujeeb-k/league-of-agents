#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
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
// "shell:<path>" in the prompt: append a line to that file with a shell command instead of the usual edit, run between
// the PreToolUse and PostToolUse hooks the repo's .claude/settings.local.json holds for Bash, as Claude Code runs them.
const shells = [...prompt.matchAll(/\bshell:(\S+)/g)].map(m => m[1]);
if (shells.length) {
  const hooks = JSON.parse(fs.readFileSync('.claude/settings.local.json', 'utf8')).hooks || {};
  const runHooks = (event, payload) => {
    for (const entry of hooks[event] || [])
      if (new RegExp(`^(${entry.matcher || '.*'})$`).test('Bash'))
        for (const h of entry.hooks) {
          const r = spawnSync(h.command, { shell: true, input: JSON.stringify(payload), encoding: 'utf8' });
          if (r.status === 2) return r.stderr;
        }
    return null;
  };
  const results = [];
  for (const [i, file] of shells.entries()) {
    const command = `printf '// written by a shell command\\n' >> ${file}`;
    const payload = { tool_name: 'Bash', tool_input: { command }, tool_use_id: `toolu_shell_${i}`, cwd: process.cwd() };
    out({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: payload.tool_use_id, name: 'Bash', input: { command } }] },
    });
    const refused = runHooks('PreToolUse', payload);
    // In the section's sandbox, a write outside it fails as a shell command's would: told, not written.
    let failed = null;
    if (!refused)
      try {
        fs.appendFileSync(file, '// written by a shell command\n');
      } catch (e) {
        failed = e.code;
      }
    const told = refused ?? failed ?? runHooks('PostToolUse', payload);
    results.push(told ? `${file}: ${told}` : `${file}: written`);
  }
  out({ type: 'result', result: results.join('\n'), session_id: 'sess-123', total_cost_usd: 0.0123 });
  process.exit(0);
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
// Refused in a section's sandbox when the file is outside it: Claude Code carries on, and so does this.
try {
  fs.writeFileSync(
    'shared/policy-cache.ts',
    "import { loadPolicy } from './allowlist';\n\nexport const cached = loadPolicy();\n",
  );
} catch {}
await new Promise(r => setTimeout(r, 400));
out({
  type: 'result',
  result: 'Violation errors now name the action and origin. Added isEmpty and a policy cache.',
  session_id: 'sess-123',
  total_cost_usd: 0.0123,
});
