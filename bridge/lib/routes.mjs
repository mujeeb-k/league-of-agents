// The API the app calls, one function per route. Each returns [status, body]; server.mjs checks who is calling
// first, and turns a thrown error into an answer.
import fs from 'node:fs';
import path from 'node:path';
import { VERSION } from './paths.mjs';
import { readJson, textLines } from './util.mjs';
import { relocate, scopeEntry } from './scope.mjs';
import { HOOK_AGENT } from './hook.mjs';
import { ROOT, CONFIG_FILE, CONF, LAYOUT_FILE, git } from './repo.mjs';
import {
  CHECKS_OFF,
  saveAllowed,
  repoChecks,
  checksShared,
  detectChecks,
  setRepoChecks,
  setChecksShared,
} from './checks.mjs';
import { AGENTS } from './agents/registry.mjs';
import { checkClaude } from './agents/claude.mjs';
import { onAgentLine } from './agents/stream.mjs';
import { removeHooks } from './hooks-install.mjs';
import { readTree, hashOf, repoFile } from './files.mjs';
import { showAt } from './snapshots.mjs';
import { recordedAuthors, exportAttribution } from './authorship.mjs';
import { runs, working, saveRun, publicRun, beginRun, finishRun, push, revertRun } from './runs.mjs';
import { armIdle, ownWrite, writeConfig, watchOff } from './watch.mjs';
import { seq, events, waiters, emit, emitRun } from './events.mjs';
import { answerWant, cancelSession, startSession } from './sessions.mjs';
import { restorePutBack, shellEnds, shellStarts } from './shell.mjs';
import { commitPreview, commitRun } from './commit.mjs';

/**
 * @typedef {{ url: URL; params: string[]; body: () => Promise<any> }} Request  `params`: what the route's pattern
 *   caught, such as a run's id.
 * @typedef {[number, any]} Reply
 * @typedef {(r: Request) => Reply | Promise<Reply>} Handler
 */

/** @returns {Reply} */
function state() {
  return [
    200,
    {
      repo: { name: path.basename(ROOT), branch: safeBranch(), root: ROOT },
      agents: AGENTS,
      tree: readTree(),
      runs: [...runs.values()].sort((a, b) => a.id - b.id).map(publicRun),
      active: working.keys().next().value ?? null,
      working: [...working.keys()],
      seq,
      version: VERSION,
      suggestedChecks: CONF.checks?.length ? [] : repoChecks.length ? repoChecks : detectChecks(),
      ...(repoChecks.length ? { suggestedChecksFrom: 'repo' } : {}),
      checksOn: (CONF.checks || []).map(c => c.name),
      watchOff,
    },
  ];
}
function safeBranch() {
  try {
    return git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  } catch {
    return '';
  }
}

/**
 * Events after `since`, waiting up to 25 s for one. Deltas go only to apps that ask; others refetch the state.
 * @param {Request} request
 * @returns {Promise<Reply>}
 */
async function eventsSince({ url }) {
  const since = Number(url.searchParams.get('since') || 0);
  const withDelta = url.searchParams.get('delta') === '1';
  const ready = () =>
    events.filter(e => e.seq > since).map(e => (withDelta || !e.delta ? e : { ...e, delta: undefined }));
  if (!ready().length)
    await new Promise(r => {
      const w = () => r();
      waiters.add(w);
      setTimeout(() => {
        waiters.delete(w);
        r();
      }, 25000);
    });
  return [200, { seq, events: ready() }];
}

/**
 * Starts a run: the agent on the prompt, in its scope; a follow-up resumes the agent's session.
 * @param {Request} request
 * @returns {Promise<Reply>}
 */
async function startRun({ body }) {
  const b = await body();
  if (b.agent === 'claude') await new Promise(r => checkClaude(r));
  if (AGENTS[b.agent]?.problem === 'loggedOut')
    return [
      400,
      {
        error: `${AGENTS[b.agent].name} is not logged in. Run: claude auth login`,
        code: 'not-logged-in',
        args: { agent: b.agent },
      },
    ];
  if (!AGENTS[b.agent]?.available)
    return [
      400,
      { error: `${b.agent} is not installed on this machine`, code: 'not-installed', args: { agent: b.agent } },
    ];
  const found = findLines(b);
  if (found.stale) {
    const name = path.basename(found.stale);
    return [
      409,
      {
        error: `The lines you selected in ${name} changed. Select them again.`,
        code: 'lines-changed',
        args: { name },
        stale: found.stale,
      },
    ];
  }
  const parent = b.resumeFrom ? runs.get(b.resumeFrom) : null;
  const run = await beginRun({
    agent: b.agent,
    prompt: b.prompt,
    scope: found.scope,
    resumeFrom: parent?.id ?? null,
    sessionId: parent?.agent === b.agent ? parent.sessionId : null,
  });
  await startSession(run, found.read);
  return [200, publicRun(run)];
}
/**
 * The scope with selected lines found where they are now. Lines selected in the app come with their text and the
 * lines around them; each range is found by them in the file as it is now, from one read that the scope lock then
 * holds (`read`): moved if its lines moved. `stale` names a file whose lines changed or can't be told apart from a
 * copy.
 * @returns {{ scope: string[]; read: Record<string, string>; stale?: string }}
 */
function findLines(b) {
  const scope = Array.isArray(b.scope) ? b.scope : [];
  /** @type {Record<string, string>} */
  const read = {};
  if (!b.lines || typeof b.lines !== 'object') return { scope, read };
  const found = [];
  for (const s of scope) {
    const e = scopeEntry(s);
    const want = e.from && typeof b.lines[e.path] === 'string' ? b.lines[e.path].replace(/\r/g, '').split('\n') : null;
    if (!want) {
      found.push(s);
      continue;
    }
    const abs = repoFile(e.path);
    const text = abs ? fs.readFileSync(abs, 'utf8') : null;
    const near = b.context?.[e.path];
    const context =
      near && typeof near === 'object'
        ? {
            before: Array.isArray(near.before) ? near.before.map(String) : [],
            after: Array.isArray(near.after) ? near.after.map(String) : [],
            twin: near.twin !== false,
          }
        : null;
    const at = text === null ? null : relocate(textLines(text), want, e.from, context);
    if (at === null) return { scope, read, stale: e.path };
    read[e.path] = text;
    found.push(`${e.path}:${at}-${at + want.length - 1}`);
  }
  return { scope: found, read };
}

const runOf = params => runs.get(Number(params[0]));
const noRun = /** @type {Reply} */ ([404, { error: 'No such run' }]);

/**
 * A session's shell command starting or ending, from its hooks: `undone` names what was put back.
 * @param {Request} request
 * @returns {Promise<Reply>}
 */
async function shell({ params, body }) {
  const run = runOf(params);
  if (!run || !working.has(run.id)) return [200, { undone: [] }];
  const { phase, tool } = await body();
  if (phase === 'start') {
    await shellStarts(run, tool);
    return [200, { undone: [] }];
  }
  return [200, { undone: await shellEnds(run, tool) }];
}
/**
 * What committing a run would hold (lib/commit.mjs).
 * @param {Request} request
 * @returns {Promise<Reply>}
 */
async function commitInfo({ params }) {
  const run = runOf(params);
  return run ? [200, await commitPreview(run)] : noRun;
}
/**
 * Commits a run's files, when the person clicks Commit.
 * @param {Request} request
 * @returns {Promise<Reply>}
 */
async function commit({ params, body }) {
  const run = runOf(params);
  if (!run) return noRun;
  const { message, include } = await body();
  return [200, await commitRun(run, { message, include })];
}
/**
 * Restores a file a shell command wrote outside its section, as the command left it, once the person asks.
 * @param {Request} request
 * @returns {Promise<Reply>}
 */
async function restore({ params, body }) {
  const run = runOf(params);
  if (!run) return noRun;
  const { path: file } = await body();
  if (!(await restorePutBack(run, file))) return [404, { error: 'Nothing kept to restore' }];
  emitRun(run);
  return [200, { ok: true }];
}
/**
 * The person allows a write a session asked to make outside its section, or refuses it (lib/sessions.mjs answerWant).
 * @param {Request} request
 * @returns {Promise<Reply>}
 */
async function answer({ params, body }) {
  const run = runOf(params);
  if (!run) return noRun;
  const { path: file, allow } = await body();
  await answerWant(run, String(file ?? ''), allow === true);
  return [200, { ok: true }];
}
/**
 * @param {Request} request
 * @returns {Promise<Reply>}
 */
async function cancelRun({ params }) {
  const run = runOf(params);
  if (!run) return noRun;
  // A captured terminal turn has no agent of ours to stop: it ends here.
  if (working.has(run.id) && !cancelSession(run)) {
    run.status = 'cancelled';
    await finishRun(run, 'cancelled');
  }
  return [200, { ok: true }];
}
/**
 * @param {Request} request
 * @returns {Reply}
 */
function keepRun({ params }) {
  const run = runOf(params);
  if (!run) return noRun;
  run.kept = true;
  saveRun(run);
  emit('state');
  return [200, { ok: true }];
}
/**
 * @param {Request} request
 * @returns {Promise<Reply>}
 */
async function revert({ params, body }) {
  const run = runOf(params);
  if (!run) return noRun;
  const r = await revertRun(run, !!(await body()).force);
  return [r.conflict ? 409 : 200, r];
}
/**
 * A file a run changed, whole, as the run found it: the state keeps only its first 4,000 lines (computeChanges).
 * @param {Request} request
 * @returns {Promise<Reply>}
 */
async function runFileBefore({ params, url }) {
  const run = runOf(params),
    rel = url.searchParams.get('path');
  if (!run?.before || !run.changes?.some(c => c.path === rel)) return [404, { error: 'That file is not in this run' }];
  return [200, { text: (await showAt(run.before, rel)) ?? '' }];
}

/**
 * Writes attribution to a git note on HEAD, only when the person asks (exportAttribution).
 * @param {Request} request
 * @returns {Promise<Reply>}
 */
async function exportNote({ body }) {
  const b = await body();
  const r = await exportAttribution(b.format === 'git-ai' ? 'git-ai' : 'agent-trace', b.files);
  return [r.error ? 409 : 200, r];
}
/**
 * Authorship git records for a file at HEAD: Git AI notes and co-author trailers (recordedAuthors).
 * @param {Request} request
 * @returns {Promise<Reply>}
 */
async function authors({ url }) {
  const rel = url.searchParams.get('path');
  if (!repoFile(rel)) return [404, { error: 'Not a file on the map' }];
  return [200, { lines: (await recordedAuthors(rel)) ?? [] }];
}
/**
 * The map's layout, kept per repo so a reload, another window size or the other app opens it as it was.
 */
const layout = () => /** @type {Reply} */ ([200, { layout: readJson(LAYOUT_FILE, null) }]);
/**
 * @param {Request} request
 * @returns {Promise<Reply>}
 */
async function saveLayout({ body }) {
  const { layout } = await body();
  const ok = layout?.v === 1 && [layout.dirs, layout.files].every(o => o && typeof o === 'object' && !Array.isArray(o));
  if (!ok) return [400, { error: 'Not a layout' }];
  fs.writeFileSync(LAYOUT_FILE, JSON.stringify(layout));
  return [200, { ok: true }];
}
/**
 * @param {Request} request
 * @returns {Reply}
 */
function file({ url }) {
  const abs = repoFile(url.searchParams.get('path'));
  if (!abs) return [404, { error: 'Not a file on the map' }];
  const text = fs.readFileSync(abs, 'utf8');
  return [200, { path: url.searchParams.get('path'), text, hash: hashOf(text) }];
}
/**
 * A save from the editor is a run by "You": the same snapshots, history and revert as an agent's.
 * @param {Request} request
 * @returns {Promise<Reply>}
 */
async function save({ body }) {
  const b = await body();
  const abs = repoFile(b.path);
  if (!abs || typeof b.text !== 'string') return [404, { error: 'Not a file on the map' }];
  const now = fs.readFileSync(abs, 'utf8');
  // Changed on disk since it was opened: never overwrite silently.
  if (hashOf(now) !== b.base) return [409, { error: 'changed', text: now, hash: hashOf(now) }];
  if (now === b.text) return [200, { unchanged: true }];
  // Its section is the file, so it can be saved while sessions work elsewhere, and waits for one working on it.
  const run = await beginRun({ agent: 'you', scope: [b.path] });
  fs.writeFileSync(abs, b.text);
  await finishRun(run);
  return [200, publicRun(run)];
}

/**
 * Turns on checks the bridge found, or approves the ones the repo's loa.config.json asks for (all of them). The page
 * names them; the commands are the bridge's own or the repo's, so a page can never put a command of its choosing
 * into loa.config.json.
 * @param {Request} request
 * @returns {Promise<Reply>}
 */
async function turnOnChecks({ body }) {
  const b = await body();
  const names = new Set(Array.isArray(b.names) ? b.names : []);
  if (repoChecks.length) {
    if (!repoChecks.every(c => names.has(c.name))) return [400, { error: 'No such checks to turn on' }];
    saveAllowed({ approved: repoChecks });
    CONF.checks = repoChecks;
    setRepoChecks([]);
    setChecksShared(true);
    emit('state');
    return [200, { checks: CONF.checks }];
  }
  const chosen = detectChecks().filter(c => names.has(c.name));
  if (!chosen.length || CONF.checks?.length) return [400, { error: 'No such checks to turn on' }];
  if (b.share) {
    if (working.size) return [409, { error: 'Wait for the run to finish', code: 'wait-for-run' }];
    await writeConfig({ ...readJson(CONFIG_FILE, {}), checks: chosen });
    saveAllowed({ approved: chosen });
    setChecksShared(true);
  } else saveAllowed({ private: chosen });
  CONF.checks = chosen;
  emit('state');
  return [200, { checks: chosen }];
}
/**
 * Turns one check off: out of loa.config.json, the file's other settings kept, and if the bridge found it, never
 * offered again.
 * @param {Request} request
 * @returns {Promise<Reply>}
 */
async function turnOffCheck({ body }) {
  const b = await body();
  const gone = (CONF.checks || []).find(c => c.name === b.name);
  if (!gone) return [404, { error: 'No such check' }];
  if (checksShared && working.size) return [409, { error: 'Wait for the run to finish', code: 'wait-for-run' }];
  CONF.checks = CONF.checks.filter(c => c !== gone);
  if (checksShared) {
    const file = readJson(CONFIG_FILE, {});
    file.checks = (file.checks || []).filter(c => c.name !== gone.name);
    if (!file.checks.length) delete file.checks;
    await writeConfig(file);
    saveAllowed({ approved: file.checks || [] });
    setChecksShared(!!CONF.checks.length);
  } else saveAllowed({ private: CONF.checks });
  fs.writeFileSync(CHECKS_OFF, JSON.stringify([...readJson(CHECKS_OFF, []), `${gone.name}\0${gone.run}`]));
  emit('state');
  return [200, { ok: true }];
}
/** @returns {Promise<Reply>} */
async function hooksRemove() {
  if (working.size)
    return [409, { error: 'A run is in progress. Remove the hooks once it finishes.', code: 'hooks-run-active' }];
  return [200, { removed: await ownWrite(removeHooks) }];
}

/** The run a terminal or editor turn started through our hooks, if one is under way: it works alone. */
const capturedRun = () => [...working.values()].find(r => Object.values(HOOK_AGENT).includes(r.agent));
/**
 * A prompt sent in a terminal or editor with our hooks, as a run (hook.mjs runHook 'start').
 * @param {Request} request
 * @returns {Promise<Reply>}
 */
async function captureStart({ body }) {
  const b = await body();
  const captured = capturedRun();
  // Runs from the map are at work: the terminal's turn is theirs to wait for, and isn't recorded.
  if (working.size && !captured) return [200, { ignored: true }];
  // The same prompt from a second set of hooks (a plugin's and the repo's): one run, not two.
  if (captured && captured.sessionId === (b.sessionId || null) && captured.prompt === (b.prompt || ''))
    return [200, { ignored: true }];
  // A terminal turn that never sent Stop was interrupted; the next prompt closes it.
  if (captured) await finishRun(captured, 'interrupted');
  const run = await beginRun({
    agent: Object.values(HOOK_AGENT).includes(b.agent) ? b.agent : 'claude-terminal',
    prompt: b.prompt,
    sessionId: b.sessionId || null,
  });
  push(run, {
    t: 'text',
    text: run.agent === 'cursor-editor' ? 'Captured from Cursor.' : 'Captured from a terminal session.',
  });
  armIdle();
  return [200, { id: run.id }];
}
/**
 * That turn's end: its events and reply, and how it ended (hook.mjs runHook 'stop').
 * @param {Request} request
 * @returns {Promise<Reply>}
 */
async function captureStop({ body }) {
  const b = await body();
  const captured = capturedRun();
  // A stop from another conversation (a second Cursor window, another terminal) leaves this run running.
  const other = b.sessionId && captured?.sessionId && b.sessionId !== captured.sessionId;
  if (captured && !other) {
    for (const e of Array.isArray(b.events) ? b.events : []) onAgentLine(captured, JSON.stringify(e));
    if (b.summary) captured.summary = b.summary;
    // Cursor says how the turn ended.
    await finishRun(captured, b.status === 'aborted' ? 'cancelled' : b.status === 'error' ? 'failed' : 'done');
  }
  return [200, { ok: true }];
}

/** @type {[string, string | RegExp, Handler][]} */
export const ROUTES = [
  ['GET', '/api/state', state],
  ['GET', '/api/events', eventsSince],
  ['POST', '/api/runs', startRun],
  ['POST', /^\/api\/runs\/(\d+)\/cancel$/, cancelRun],
  ['POST', /^\/api\/runs\/(\d+)\/keep$/, keepRun],
  ['POST', /^\/api\/runs\/(\d+)\/revert$/, revert],
  ['GET', /^\/api\/runs\/(\d+)\/before$/, runFileBefore],
  ['POST', /^\/api\/runs\/(\d+)\/shell$/, shell],
  ['POST', /^\/api\/runs\/(\d+)\/put-back$/, restore],
  ['POST', /^\/api\/runs\/(\d+)\/wants$/, answer],
  ['GET', /^\/api\/runs\/(\d+)\/commit$/, commitInfo],
  ['POST', /^\/api\/runs\/(\d+)\/commit$/, commit],
  ['POST', '/api/attribution/export', exportNote],
  ['GET', '/api/authors', authors],
  ['GET', '/api/layout', layout],
  ['POST', '/api/layout', saveLayout],
  ['GET', '/api/file', file],
  ['POST', '/api/save', save],
  ['POST', '/api/checks', turnOnChecks],
  ['POST', '/api/checks/off', turnOffCheck],
  ['POST', '/api/hooks/remove', hooksRemove],
  ['POST', '/api/capture/start', captureStart],
  ['POST', '/api/capture/stop', captureStop],
];
