#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
// Its version, as `claude --version` prints it: one that refuses a tool call when a hook marked so can't run
// (2.1.295), unless FAKE_CLAUDE_VERSION names another.
if (args[0] === '--version') {
  console.log(`${process.env.FAKE_CLAUDE_VERSION || '2.1.295'} (Claude Code)`);
  process.exit(0);
}
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
/**
 * Runs the hooks for a tool, as Claude Code does: those the repo's .claude/settings.local.json holds, unless it was
 * told to leave the repo's settings out, and those its --settings argument holds. Returns what one refused with. A hook may hand back the tool's input rewritten
 * (`updatedInput`), which replaces it in `payload`. A hook that can't run refuses the call when it is marked
 * `onFailure: "block"`, from 2.1.295 on; FAKE_CLAUDE_BREAK_HOOK makes every such hook one that can't.
 */
const given = args.includes('--settings') ? JSON.parse(args[args.indexOf('--settings') + 1]).hooks || {} : {};
const blocksOnFailure = Number((process.env.FAKE_CLAUDE_VERSION || '2.1.295').split('.')[2]) >= 295;
const runHooks = (event, payload) => {
  // The repo's own settings are read unless told to read the person's only (--setting-sources user).
  const own = args[args.indexOf('--setting-sources') + 1] !== 'user' || !args.includes('--setting-sources');
  const hooks =
    own && fs.existsSync('.claude/settings.local.json')
      ? JSON.parse(fs.readFileSync('.claude/settings.local.json', 'utf8')).hooks || {}
      : {};
  for (const entry of [...(hooks[event] || []), ...(given[event] || [])])
    if (new RegExp(`^(${entry.matcher || '.*'})$`).test(payload.tool_name))
      for (const h of entry.hooks) {
        const command = h.onFailure && process.env.FAKE_CLAUDE_BREAK_HOOK ? '/nowhere/hook' : h.command;
        const r = spawnSync(command, { shell: true, input: JSON.stringify(payload), encoding: 'utf8' });
        if (r.status === 2) return r.stderr;
        if (r.status !== 0) {
          if (h.onFailure === 'block' && blocksOnFailure)
            return `[${command}]: failed; blocking because onFailure is "block"`;
          continue;
        }
        try {
          const updated = JSON.parse(r.stdout).hookSpecificOutput?.updatedInput;
          if (updated) payload.tool_input = updated;
        } catch {}
      }
  return null;
};
/** Whether the bridge holds this session's commands in its sandbox: a hook rewrites each one (bridge/lib/hook.mjs). */
const held = JSON.stringify(given).includes('hook hold');
// "want:<path>" in the prompt: write that file with the Write tool, which the scope lock or the sandbox may refuse; and
// when resumed with "You may now change <paths>.", write those, as Claude Code carries on once allowed.
const resumed = args.includes('--resume');
const allowed = /You may now change (.+?)\. /.exec(prompt)?.[1].split(', ') ?? [];
const wants = [...[...prompt.matchAll(/\bwant:(\S+)/g)].map(m => m[1]), ...allowed];
// With "shell:" steps too, the turn goes on to them after its writes, and they hold it ("shell:<path>:<name>").
const shells = [...prompt.matchAll(/\bshell:(\S+)/g)].map(m => m[1]);
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
    let error =
      refused &&
      (refused.includes('onFailure')
        ? `PreToolUse:Write hook error: ${refused}`
        : `PreToolUse:Write hook error: [node .loa/bridge.mjs hook pre]: ${refused}`);
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
  if (!shells.length) {
    // "wait:<name>" after them: the turn holds until the file .loa/go-<name> exists, so a test can keep it at work.
    const hold = /\bwait:(\S+)/.exec(prompt)?.[1];
    while (hold && !fs.existsSync(`.loa/go-${hold}`)) await new Promise(r => setTimeout(r, 50));
    const resume = resumed ? ` (resumed ${args[args.indexOf('--resume') + 1]})` : '';
    out({ type: 'result', result: results.join('\n') + resume, session_id: 'sess-123', total_cost_usd: 0.0123 });
    process.exit(0);
  }
}
// "tool:<name>" in the prompt: call that tool, which the hooks may refuse, and say what came of it. With
// "tool:<name>><path>", the tool, once let through, writes that file from this process, as a tool Claude Code runs
// itself (an MCP server's, Monitor) would, outside any sandbox.
const [, named, target] = /\btool:(\w+)(?:>(\S+))?/.exec(prompt) ?? [];
if (named) {
  const payload = { tool_name: named, tool_input: { command: 'true' }, tool_use_id: 'toolu_named', cwd: process.cwd() };
  out({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: payload.tool_use_id, name: named, input: payload.tool_input }] },
  });
  const refused = runHooks('PreToolUse', payload);
  if (!refused && target) fs.writeFileSync(target, `written by ${named}\n`);
  const content = refused ? `PreToolUse:${named} hook error: [node .loa/bridge.mjs hook hold]: ${refused}` : 'Done';
  out({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: payload.tool_use_id, is_error: !!refused, content }] },
  });
  out({
    type: 'result',
    result: `${named}: ${refused ? 'refused' : 'done'}`,
    session_id: 'sess-123',
    total_cost_usd: 0.0123,
  });
  process.exit(0);
}
// "insert:<path>:<line>:<name>" in the prompt: put the text of .loa/text-<name> before that line (0-based) with the
// Edit tool, its old_string the line and its new_string the text and the line, as Claude Code's Edit would; and
// "wait:<name>" among them holds until .loa/go-<name> exists. Done in the order the prompt gives them, so a test can
// say when each edit lands.
const inserts = [...prompt.matchAll(/\b(insert|wait):(\S+)/g)].map(m => [m[1], m[2]]);
if (inserts.some(([what]) => what === 'insert')) {
  const results = [];
  for (const [n, [what, arg]] of inserts.entries()) {
    if (what === 'wait') {
      while (!fs.existsSync(`.loa/go-${arg}`)) await new Promise(r => setTimeout(r, 50));
      continue;
    }
    const [file, at, name] = arg.split(':');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const text = fs.readFileSync(`.loa/text-${name}`, 'utf8');
    const id = `toolu_insert_${n}`;
    const input = { file_path: `${process.cwd()}/${file}`, old_string: lines[at], new_string: text + lines[at] };
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Edit', input }] } });
    const payload = { tool_name: 'Edit', tool_input: input, tool_use_id: id, cwd: process.cwd() };
    const refused = runHooks('PreToolUse', payload);
    // The edit lands a moment after it is announced, once its hooks have run.
    await new Promise(r => setTimeout(r, 150));
    if (!refused)
      fs.writeFileSync(file, [...lines.slice(0, at), text + lines[at], ...lines.slice(Number(at) + 1)].join('\n'));
    const content = refused ? `PreToolUse:Edit hook error: [node .loa/bridge.mjs hook pre]: ${refused}` : 'Done';
    out({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: !!refused, content }] },
    });
    results.push(`${file}: ${refused ? 'refused' : 'edited'}`);
  }
  out({ type: 'result', result: results.join('\n'), session_id: 'sess-123', total_cost_usd: 0.0123 });
  process.exit(0);
}
if (shells.length) {
  const results = [];
  for (const [i, arg] of shells.entries()) {
    // "shell:<path>:<name>": the command then holds until .loa/go-<name> exists, as a long one (a test run) would.
    // "shell:<path>:<name>:late": it holds first, and writes once let go. It marks that it has begun with .at-<name>
    // beside the file (inside the section, so a held command may write it), for a test to wait on.
    const [file, until, late] = arg.split(':');
    const write = `printf '// written by a shell command\\n' >> ${file}`,
      hold = until ? `until [ -f .loa/go-${until} ]; do sleep 0.05; done` : '';
    const begun = `: > ${path.posix.join(path.posix.dirname(file), `.at-${until}`)}`;
    const command = !hold ? write : late ? `${begun} && ${hold} && ${write}` : `${write} && ${hold}`;
    const payload = { tool_name: 'Bash', tool_input: { command }, tool_use_id: `toolu_shell_${i}`, cwd: process.cwd() };
    out({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: payload.tool_use_id, name: 'Bash', input: { command } }] },
    });
    const refused = runHooks('PreToolUse', payload);
    // The command as the hooks left it. In the section's sandbox, a write outside it fails: told, not written.
    const failed =
      !refused && spawnSync(payload.tool_input.command, { shell: '/bin/bash' }).status !== 0 ? 'EPERM' : null;
    const told = refused ?? failed ?? runHooks('PostToolUse', payload);
    // The command's result, as Claude Code's Bash tool returns it: the shell's own error when the write failed.
    const content = refused?.includes('onFailure')
      ? `PreToolUse:Bash hook error: ${refused}`
      : failed
        ? `Exit code 1\n(eval):1: operation not permitted: ${file}`
        : '';
    out({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: payload.tool_use_id, is_error: !!failed || !!content, content }],
      },
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
        id: 'toolu_edit',
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
/**
 * Writes a file without an edit tool, as a shell command would. Where the bridge holds the session's commands, it is
 * one: handed to the hook and run as the hook rewrote it, so the sandbox refuses it outside the section.
 */
const byCommand = (file, text) => {
  if (!held) return fs.writeFileSync(file, text);
  const payload = {
    tool_name: 'Bash',
    tool_input: { command: `cat > ${file} <<'LOA_EOF'\n${text}LOA_EOF` },
    tool_use_id: `toolu_quiet_${file.replace(/\W/g, '_')}`,
    cwd: process.cwd(),
  };
  if (!runHooks('PreToolUse', payload)) spawnSync(payload.tool_input.command, { shell: '/bin/bash' });
};
// The Edit tool's own change, as Claude Code makes it: by the tool, once the hooks let it.
let t = fs.readFileSync('shared/allowlist.ts', 'utf8');
t = t.replace(
  "throw new Error('ALLOWLIST_VIOLATION');",
  'throw new Error(`ALLOWLIST_VIOLATION: ${action} on ${origin}`);',
);
const edit = { file_path: process.cwd() + '/shared/allowlist.ts' };
const edited =
  !held ||
  !runHooks('PreToolUse', { tool_name: 'Edit', tool_input: edit, tool_use_id: 'toolu_edit', cwd: process.cwd() });
if (edited) fs.writeFileSync('shared/allowlist.ts', t);
// Its result, as Claude Code sends one for every call.
out({
  type: 'user',
  message: {
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'toolu_edit',
        is_error: !edited,
        content: edited ? 'The file has been updated.' : 'Refused.',
      },
    ],
  },
});
// A model turn passes before its next call, as one does after each tool result: without the hooks, the bridge reads
// the file an edit left when it hears of the result, and a command at once after could be in that read.
await new Promise(r => setTimeout(r, 150));
t = fs.readFileSync('shared/allowlist.ts', 'utf8');
byCommand('shared/allowlist.ts', t + '\nexport function isEmpty(p: Policy) {\n  return p.origins.length === 0;\n}\n');
// Refused in a section's sandbox when the file is outside it: Claude Code carries on, and so does this.
try {
  byCommand(
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
