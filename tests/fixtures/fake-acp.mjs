#!/usr/bin/env node
// A stand-in harness that speaks the Agent Client Protocol over stdio, as Hermes does (`hermes acp`): it reports
// its model as a config option, asks before each edit with the diff, resumes a session it started (replaying it
// first, as Hermes does), and stops a turn on session/cancel. With `acp --check` it exits 0, as Hermes does when its
// ACP extra is installed. With FAKE_ACP_STYLE=dsh it asks as DeepSeek Harness does in its read-only mode: its edit
// tool call is kind "other", titled "edit", with the edit's arguments as rawInput, and its permission request names
// only the call; in its full-access mode it writes without asking, and a write the system refuses fails. The prompt steers it: "outside" also asks to edit outside.txt; "command" asks to run one; "slow" waits to be
// cancelled; "exec: <command>" runs it; "cost" reports a cost. "edit:<path>" asks to edit that file and appends a line to it, instead of the usual edit; "wait:<name>"
// then holds the turn until the file .loa/go-<name> exists, so a test can keep two sessions at work at once. It logs
// to fake-acp.log beside the repo: a session's sandbox lets nothing write in .loa.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline';

if (process.argv.includes('--check')) process.exit(0);
const FILE = 'shared/allowlist.ts';
const send = m => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
const update = (sessionId, u) => send({ method: 'session/update', params: { sessionId, update: u } });
const say = (sessionId, text) =>
  // In pieces, as harnesses stream it.
  text
    .split(/(?<= )/)
    .forEach(t => update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } }));
const sessions = new Set();
let next = 1000;
const waiting = new Map();
const ask = (method, params) =>
  new Promise(resolve => {
    const id = next++;
    waiting.set(id, resolve);
    send({ id, method, params });
  });
let cancelled = null;
const model = {
  id: 'model',
  name: 'Model',
  category: 'model',
  type: 'select',
  currentValue: '["fake","fake-model-1"]',
  options: [{ group: 'fake', name: 'Fake', options: [{ value: '["fake","fake-model-1"]', name: 'fake-model-1' }] }],
};

/** "wait:<name>" holds the turn until the file .loa/go-<name> exists. */
async function held(text) {
  const hold = /\bwait:(\S+)/.exec(text)?.[1];
  if (hold) while (!fs.existsSync(`.loa/go-${hold}`)) await new Promise(r => setTimeout(r, 20));
}

async function turn(sessionId, text) {
  // "cost": report the turn's cost so far, as ACP lets a harness do (usage_update), before any work.
  if (/\bcost\b/.test(text))
    update(sessionId, {
      sessionUpdate: 'usage_update',
      used: 7710,
      size: 1000000,
      cost: { amount: 0.0042, currency: 'USD' },
    });
  say(sessionId, 'Reading the policy module.');
  update(sessionId, {
    sessionUpdate: 'tool_call',
    toolCallId: 'read-1',
    title: `read: ${FILE}`,
    kind: 'read',
    locations: [{ path: FILE }],
  });
  if (/slow/.test(text)) {
    await new Promise(r => (cancelled = r));
    return 'cancelled';
  }
  const dsh = process.env.FAKE_ACP_STYLE === 'dsh';
  const permit = async (toolCallId, path, oldText, newText) => {
    update(
      sessionId,
      dsh
        ? {
            sessionUpdate: 'tool_call',
            toolCallId,
            title: 'edit',
            kind: 'other',
            rawInput: { file_path: `${process.cwd()}/${path}`, old_string: oldText, new_string: newText },
          }
        : { sessionUpdate: 'tool_call', toolCallId, title: `patch: ${path}`, kind: 'edit', locations: [{ path }] },
    );
    // In its full-access mode DeepSeek Harness writes without asking; a write the system refuses fails, and says so.
    if (dsh && process.env.DSH_PERMISSION_MODE === 'danger-full-access') {
      try {
        fs.writeFileSync(path, newText);
        update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId, status: 'completed' });
      } catch (e) {
        const text = `Error: ${e.code}: operation not permitted, open '${process.cwd()}/${path}'`;
        update(sessionId, {
          sessionUpdate: 'tool_call_update',
          toolCallId,
          status: 'failed',
          content: [{ type: 'content', content: { type: 'text', text } }],
        });
        return false;
      }
      return true;
    }
    // DeepSeek Harness's sandbox denies the write first, and the model then asks to escalate.
    if (dsh)
      update(sessionId, {
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: 'failed',
        content: [
          {
            type: 'content',
            content: { type: 'text', text: 'Error: [sandbox: file access denied under read-only mode]' },
          },
        ],
      });
    const r = await ask('session/request_permission', {
      sessionId,
      toolCall: dsh
        ? { toolCallId }
        : { toolCallId, title: `patch: ${path}`, kind: 'edit', content: [{ type: 'diff', path, oldText, newText }] },
      options: [
        { optionId: 'yes', name: 'Allow edit', kind: 'allow_once' },
        { optionId: 'no', name: 'Deny', kind: 'reject_once' },
      ],
    });
    return r.outcome?.optionId === 'yes';
  };
  // Asked to run a command, as Hermes does for one it deems dangerous and DeepSeek Harness for one that writes.
  if (/command/.test(text))
    await ask('session/request_permission', {
      sessionId,
      toolCall: { toolCallId: 'cmd-1', title: 'bash', kind: 'execute', rawInput: { command: 'rm -rf build' } },
      options: [
        { optionId: 'yes', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'no', name: 'Deny', kind: 'reject_once' },
      ],
    });
  // "exec: <command>" to the end of its line: run it unasked, in a shell of its own, as Hermes runs commands, and
  // reply with its exit code and the end of its output.
  // Resumed with "You may now change <paths>.": it edits those, as a harness carries on once allowed, and runs the
  // command a "later: <command>" line of the first prompt left for then.
  const allowed = /You may now change (.+?)\. /.exec(text)?.[1].split(', ') ?? [];
  const edits = [...[...text.matchAll(/\bedit:(\S+)/g)].map(m => m[1]), ...allowed];
  const later = /\blater: (.+)$/m.exec(text)?.[1];
  if (later) fs.writeFileSync('../fake-acp.later', later);
  const exec =
    allowed.length && fs.existsSync('../fake-acp.later')
      ? fs.readFileSync('../fake-acp.later', 'utf8')
      : /\bexec: (.+)$/m.exec(text)?.[1];
  if (exec) {
    // Told as Hermes tells its terminal tool: the call, then its output.
    update(sessionId, {
      sessionUpdate: 'tool_call',
      toolCallId: 'exec-1',
      title: `terminal: ${exec}`,
      kind: 'execute',
    });
    const r = spawnSync('sh', ['-c', exec], { encoding: 'utf8' });
    const output = (r.stdout + r.stderr).trim();
    update(sessionId, {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'exec-1',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: output } }],
    });
    say(sessionId, `exit ${r.status}: ${output.split('\n').slice(-3).join(' | ')}`);
    if (!edits.length) return 'end_turn';
  }
  if (edits.length) {
    for (const [i, file] of edits.entries()) {
      const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      const after = `${before}// edited in ${sessionId}\n`;
      if (await permit(`edit-${i}`, file, before, after)) fs.writeFileSync(file, after);
    }
    await held(text);
    say(sessionId, ` Edited ${edits.join(', ')}.`);
    return 'end_turn';
  }
  if (/outside/.test(text) && (await permit('edit-out', 'outside.txt', '', 'written outside the scope\n')))
    try {
      fs.writeFileSync('outside.txt', 'written outside the scope\n');
    } catch (e) {
      say(sessionId, `outside.txt: ${e.code}. `);
    }
  const before = fs.readFileSync(FILE, 'utf8');
  const line = "export const reviewedBy = 'fake-acp';";
  if (await permit('edit-1', FILE, before, before + line + '\n')) {
    fs.writeFileSync(FILE, before + line + '\n');
    update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'edit-1', status: 'completed' });
  }
  await held(text);
  say(sessionId, `Added reviewedBy to ${FILE}.`);
  return 'end_turn';
}

readline.createInterface({ input: process.stdin }).on('line', async l => {
  const m = JSON.parse(l);
  if (m.id !== undefined && !m.method) return waiting.get(m.id)?.(m.result ?? {});
  const reply = result => send({ id: m.id, result });
  if (m.method === 'initialize')
    reply({
      protocolVersion: 1,
      agentInfo: { name: 'fake-acp', version: '1.0.0' },
      agentCapabilities: { sessionCapabilities: { resume: {} } },
      authMethods: [],
    });
  else if (m.method === 'session/new') {
    const sessionId = `fake-session-${process.pid}`;
    sessions.add(sessionId);
    fs.appendFileSync('../fake-acp.log', `new ${sessionId} mode=${process.env.DSH_PERMISSION_MODE}\n`);
    reply({ sessionId, configOptions: [model] });
  } else if (m.method === 'session/resume') {
    fs.appendFileSync('../fake-acp.log', `resume ${m.params.sessionId}\n`);
    // Hermes replays the session so far before it answers a resume.
    say(m.params.sessionId, 'Replayed from before.');
    update(m.params.sessionId, {
      sessionUpdate: 'tool_call',
      toolCallId: 'old-1',
      title: 'replayed: an earlier call',
      kind: 'read',
    });
    reply({ configOptions: [model] });
  } else if (m.method === 'session/prompt') {
    const text = m.params.prompt.map(p => p.text).join('\n');
    fs.appendFileSync('../fake-acp.log', `prompt ${JSON.stringify(text)}\n`);
    // Steered by the prompt itself, below the scope the bridge writes above it.
    reply({ stopReason: await turn(m.params.sessionId, text.split('\n\n').at(-1)) });
  } else if (m.method === 'session/cancel') cancelled?.();
  else if (m.id !== undefined) send({ id: m.id, error: { code: -32601, message: 'Method not found' } });
});
