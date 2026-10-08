#!/usr/bin/env node
// A stand-in harness that speaks the Agent Client Protocol over stdio, as Hermes does (`hermes acp`): it reports
// its model as a config option, asks before each edit with the diff, resumes a session it started (replaying it
// first, as Hermes does), and stops a
// turn on session/cancel. With `acp --check` it exits 0, as Hermes does when its ACP extra is installed.
// The prompt steers it: "outside" also asks to edit outside.txt; "slow" waits to be cancelled.
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

async function turn(sessionId, text) {
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
  const permit = async (toolCallId, path, oldText, newText) => {
    update(sessionId, {
      sessionUpdate: 'tool_call',
      toolCallId,
      title: `patch: ${path}`,
      kind: 'edit',
      locations: [{ path }],
    });
    const r = await ask('session/request_permission', {
      sessionId,
      toolCall: {
        toolCallId,
        title: `patch: ${path}`,
        kind: 'edit',
        content: [{ type: 'diff', path, oldText, newText }],
      },
      options: [
        { optionId: 'yes', name: 'Allow edit', kind: 'allow_once' },
        { optionId: 'no', name: 'Deny', kind: 'reject_once' },
      ],
    });
    return r.outcome?.optionId === 'yes';
  };
  if (/outside/.test(text) && (await permit('edit-out', 'outside.txt', '', 'written outside the scope\n')))
    fs.writeFileSync('outside.txt', 'written outside the scope\n');
  const before = fs.readFileSync(FILE, 'utf8');
  const line = "export const reviewedBy = 'fake-acp';";
  if (await permit('edit-1', FILE, before, before + line + '\n')) {
    fs.writeFileSync(FILE, before + line + '\n');
    update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'edit-1', status: 'completed' });
  }
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
    fs.appendFileSync('.loa/fake-acp.log', `new ${sessionId}\n`);
    reply({ sessionId, configOptions: [model] });
  } else if (m.method === 'session/resume') {
    fs.appendFileSync('.loa/fake-acp.log', `resume ${m.params.sessionId}\n`);
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
    fs.appendFileSync('.loa/fake-acp.log', `prompt ${JSON.stringify(text)}\n`);
    reply({ stopReason: await turn(m.params.sessionId, text) });
  } else if (m.method === 'session/cancel') cancelled?.();
  else if (m.id !== undefined) send({ id: m.id, error: { code: -32601, message: 'Method not found' } });
});
