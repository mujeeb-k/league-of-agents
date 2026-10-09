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
// "ratelimit": the turn ends as Claude Code's does when the account hits its limit.
if (/\bratelimit\b/.test(prompt)) {
  const text = 'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Rate limited"}}';
  out({ type: 'result', is_error: true, result: text, session_id: 'sess-123', total_cost_usd: 0 });
  process.exit(1);
}
// "abuse": try the run's shell token on another route, as a session reaching past its hooks would.
if (/\babuse\b/.test(prompt)) {
  const r = await fetch(`http://127.0.0.1:${process.env.LOA_BRIDGE_PORT}/api/save`, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + process.env.LOA_SHELL_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'README.md', text: 'taken over\n' }),
  });
  out({ type: 'result', result: `save: ${r.status}`, session_id: 'sess-123', total_cost_usd: 0 });
  process.exit(0);
}
/** Runs the hooks the repo's .claude/settings.local.json holds for a tool, as Claude Code does: what one refused with. */
const runHooks = (event, payload) => {
  const hooks = fs.existsSync('.claude/settings.local.json')
    ? JSON.parse(fs.readFileSync('.claude/settings.local.json', 'utf8')).hooks || {}
    : {};
  for (const entry of hooks[event] || [])
    if (new RegExp(`^(${entry.matcher || '.*'})$`).test(payload.tool_name))
      for (const h of entry.hooks) {
        const r = spawnSync(h.command, { shell: true, input: JSON.stringify(payload), encoding: 'utf8' });
        if (r.status === 2) return r.stderr;
      }
  return null;
};
// "want:<path>" in the prompt: write that file with the Write tool, which the scope lock or the sandbox may refuse; and
// when resumed with "You may now change <paths>.", write those, as Claude Code carries on once allowed.
const resumed = args.includes('--resume');
const allowed = /You may now change (.+?)\. /.exec(prompt)?.[1].split(', ') ?? [];
const wants = [...[...prompt.matchAll(/\bwant:(\S+)/g)].map(m => m[1]), ...allowed];
if (wants.length) {
  const results = [];
  for (const [i, file] of wants.entries()) {
    const id = `toolu_write_${i}`;
    const input = {
      file_path: `${process.cwd()}/${file}`,
      content: `// written by ${resumed ? 'a resumed' : 'a'} session\n`,
    };
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Write', input }] } });
    const refused = runHooks('PreToolUse', {
      tool_name: 'Write',
      tool_input: input,
      tool_use_id: id,
      cwd: process.cwd(),
    });
    // Claude Code 2.1 puts the hook's own words after its own.
    let error = refused && `PreToolUse:Write hook error: [node .loa/bridge.mjs hook pre]: ${refused}`;
    if (!error)
      try {
        // As Claude Code's Write does: the file's folders made first.
        fs.mkdirSync(file.split('/').slice(0, -1).join('/') || '.', { recursive: true });
        fs.writeFileSync(file, input.content);
      } catch (e) {
        error = `${e.code}: operation not permitted, open '${input.file_path}'`;
      }
    out({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: !!error, content: error || 'Done' }] },
    });
    results.push(`${file}: ${error ? 'refused' : 'written'}`);
  }
  const resume = resumed ? ` (resumed ${args[args.indexOf('--resume') + 1]})` : '';
  out({ type: 'result', result: results.join('\n') + resume, session_id: 'sess-123', total_cost_usd: 0.0123 });
  process.exit(0);
}
const shells = [...prompt.matchAll(/\bshell:(\S+)/g)].map(m => m[1]);
if (shells.length) {
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
    // The command's result, as Claude Code's Bash tool returns it: the shell's own error when the write failed.
    const content = failed ? `Exit code 1\n(eval):1: operation not permitted: ${file}` : '';
    out({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: payload.tool_use_id, is_error: !!failed, content }] },
    });
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
