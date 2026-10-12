#!/usr/bin/env node
// Stand-in for Cursor's command-line agent (`cursor-agent -p --force --output-format stream-json <prompt>`). Its
// events have the shapes of a recorded run (tests/fixtures/agents/cursor/cursor-canvas-run.jsonl, Cursor
// 2026.10.01): the first event with the model, each tool call started and completed under its own kind
// (readToolCall, editToolCall) with the file's absolute path, and a result at the end. A command it runs is a
// shellToolCall, which that run didn't make and Cursor's docs don't show: its shape here is assumed.
//
// The prompt steers it, one step after another: "read:<path>", "edit:<path>" (appends a line to the file, as an
// edit tool would), "exec:[<command>]" (runs it and says what it printed), "wait:<name>" (holds the turn until the
// file .loa/go-<name> exists, so a test can keep two sessions at work at once). With none of them it edits
// shared/log.ts. Appends its arguments to $FAKE_CURSOR_ARGS.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
// As `cursor-agent --version` prints it: a date and a build, with no name.
if (args[0] === '--version' || args[0] === '-v') {
  console.log('2026.10.01-e373342');
  process.exit(0);
}
// Its help is where it says whose it is.
if (args[0] === '--help' || args[0] === '-h') {
  console.log('Usage: agent [options] [command] [prompt...]\n\nStart the Cursor Agent');
  process.exit(0);
}
// `status`, as a logged-in Cursor answers it. While the file FAKE_CURSOR_LOGGED_OUT names exists, as one that isn't:
// that answer's wording and exit code are assumed, no logged-out Cursor was recorded.
if (args[0] === 'status') {
  const out = !!process.env.FAKE_CURSOR_LOGGED_OUT && fs.existsSync(process.env.FAKE_CURSOR_LOGGED_OUT);
  console.log(out ? 'Not logged in' : '✓ Logged in as person@example.test');
  process.exit(out ? 1 : 0);
}
if (process.env.FAKE_CURSOR_ARGS) fs.appendFileSync(process.env.FAKE_CURSOR_ARGS, JSON.stringify(args) + '\n');

const resumed = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : null;
const prompt = args.at(-1);
const session_id = resumed ?? `fake-cursor-${process.pid}`;
const request = `req-${process.pid}`;
const out = o => console.log(JSON.stringify(o));
let calls = 0,
  turns = 0;
const now = () => Date.now();

out({
  type: 'system',
  subtype: 'init',
  apiKeySource: 'login',
  cwd: process.cwd(),
  session_id,
  model: 'Auto',
  permissionMode: 'default',
});
out({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] }, session_id });

const say = text =>
  out({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    session_id,
    model_call_id: `${request}-${turns++}`,
    timestamp_ms: now(),
  });
/** A tool call, started, done by `work`, then completed with what it returned. */
function call(kind, callArgs, work) {
  const id = `call-${request}-${calls++}`;
  const event = (subtype, toolCall) =>
    out({
      type: 'tool_call',
      subtype,
      call_id: id,
      tool_call: toolCall,
      model_call_id: `${request}-${turns}`,
      session_id,
      timestamp_ms: now(),
    });
  const startedAtMs = String(now());
  event('started', { [kind]: { args: callArgs }, hookAdditionalContexts: [], toolCallId: id, startedAtMs });
  const success = work();
  event('completed', {
    [kind]: { args: callArgs, result: { success } },
    hookAdditionalContexts: [],
    toolCallId: id,
    startedAtMs,
    completedAtMs: String(now()),
  });
  return success;
}
const abs = p => path.join(process.cwd(), p);
const wait = async name => {
  while (!fs.existsSync(`.loa/go-${name}`)) await new Promise(r => setTimeout(r, 50));
};

const steps = [...prompt.matchAll(/\b(read|edit|exec|wait):(\[[^\]]*\]|\S+)/g)].map(m => [
  m[1],
  m[2].replace(/^\[|\]$/g, ''),
]);
if (!steps.length) steps.push(['edit', 'shared/log.ts']);
const said = [];
for (const [what, arg] of steps) {
  if (what === 'wait') await wait(arg);
  else if (what === 'read')
    call('readToolCall', { path: abs(arg), limit: 400 }, () => {
      const content = fs.existsSync(arg) ? fs.readFileSync(arg, 'utf8') : '';
      return { content, isEmpty: !content, exceededLimit: false, totalLines: content.split('\n').length };
    });
  else if (what === 'edit')
    call('editToolCall', { path: abs(arg), streamContent: '' }, () => {
      fs.mkdirSync(path.dirname(arg), { recursive: true });
      fs.appendFileSync(arg, `// edited by cursor in ${session_id}\n`);
      return { path: abs(arg), linesAdded: 1, linesRemoved: 0 };
    });
  else
    call('shellToolCall', { command: arg }, () => {
      const r = spawnSync(arg, { shell: '/bin/bash', encoding: 'utf8' });
      said.push(`${arg}: exit ${r.status}\n${r.stdout}${r.stderr}`.trim());
      return { command: arg, exitCode: r.status, stdout: r.stdout, stderr: r.stderr };
    });
}
const result = said.length ? said.join('\n') : 'Done.';
say(result);
out({
  type: 'result',
  subtype: 'success',
  duration_ms: 10,
  duration_api_ms: 10,
  is_error: false,
  result,
  session_id,
  request_id: request,
  usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
});
