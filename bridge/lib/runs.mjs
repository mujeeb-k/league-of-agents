// Runs: each change recorded with its before and after snapshots, kept, reverted, and pruned when old.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJson, splitLines, serial } from './util.mjs';
import { inScope, rangeKept, scopeEntry } from './scope.mjs';
import { ROOT, RUNS_DIR, git } from './repo.mjs';
import { agentLinesOf } from './agents/lines.mjs';
import { blobAt, blobNow, pin, restoreFrom, showAt, computeChanges, snapshotNow } from './snapshots.mjs';
import {
  checksFor,
  clash,
  joinEpoch,
  keepsBaseline,
  leaveEpoch,
  noteRevert,
  ownChanges,
  startingPoint,
} from './parallel.mjs';
import { base, setBase, rebase } from './watch.mjs';
import { NO_SANDBOX, lockOfRun } from './sandbox.mjs';
import { emit, emitRun } from './events.mjs';
import { pinSteps } from './steps.mjs';

export const runs = new Map();
/** The runs recorded before, from .loa/runs/. */
export function loadRuns() {
  for (const f of fs.readdirSync(RUNS_DIR))
    if (f.endsWith('.json')) {
      const r = readJson(path.join(RUNS_DIR, f));
      if (r) runs.set(r.id, r);
    }
}
/** The runs under way, by id: several at once when their sections don't overlap (parallel.mjs). */
export const working = new Map();
const nextId = () => Math.max(0, ...runs.keys()) + 1;
/** Runs kept: the newest KEEP_RUNS, and every run from the last KEEP_DAYS days, whichever is more. */
const KEEP_RUNS = 500,
  KEEP_DAYS = 30;
/** Deletes the runs older than both limits: their records, their raw output and their snapshot refs. */
export function pruneRuns() {
  const ids = [...runs.keys()].sort((a, b) => a - b);
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  const old = ids
    .slice(0, Math.max(0, ids.length - KEEP_RUNS))
    .filter(id => (runs.get(id).endedAt ?? runs.get(id).startedAt ?? 0) < cutoff);
  if (!old.length) return;
  git(['update-ref', '--stdin'], {
    input:
      old
        .flatMap(id => [
          `delete refs/loa/runs/${id}/before`,
          `delete refs/loa/runs/${id}/after`,
          `delete refs/loa/runs/${id}/steps`,
          ...[...new Set((runs.get(id).putBack ?? []).map(k => k.ref))].map(ref => `delete ${ref}`),
        ])
        .join('\n') + '\n',
  });
  for (const id of old) {
    for (const ext of ['.json', '.stream.jsonl', '.stderr.log', '.steps.jsonl'])
      fs.rmSync(path.join(RUNS_DIR, id + ext), { force: true });
    runs.delete(id);
  }
}
export const saveRun = r => fs.writeFileSync(path.join(RUNS_DIR, r.id + '.json'), JSON.stringify(r));
/**
 * A run as the state and its events carry it: without its activity or each file as it found it, which grow with every
 * run kept (GET /api/runs/:id has them, fullRun).
 */
export const publicRun = ({ stream, ...r }) => ({ ...r, changes: (r.changes || []).map(({ pre, ...c }) => c) });
/** A run with everything: its activity's last 60 entries, and each file as it found it. */
export const fullRun = r => ({ ...r, stream: (r.stream || []).slice(-60) });
/** A run's title: the prompt's first line, shortened. */
const title = s => {
  s = String(s || '')
    .trim()
    .split('\n')[0]
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > 72 ? s.slice(0, 70) + '…' : s || 'Untitled run';
};

/**
 * @param {{ agent: string; prompt?: string; scope?: string[]; resumeFrom?: number | null; sessionId?: string | null }} opts
 */
export function newRun({ agent, prompt = '', scope = [], resumeFrom = null, sessionId = null }) {
  return {
    id: nextId(),
    agent,
    title: title(prompt),
    prompt: prompt || '',
    scope,
    resumeFrom,
    sessionId,
    status: 'running',
    startedAt: Date.now(),
    endedAt: null,
    before: null,
    after: null,
    changes: [],
    checks: [],
    summary: '',
    stream: [],
    cost: null,
    /** The model the agent reported; null until it does, and for agents that don't (Codex). */
    model: null,
    kept: false,
    reverted: false,
  };
}
export function beginRun(opts) {
  return serial(async () => {
    const refused = clash(opts.scope ?? []);
    if (refused) throw refused;
    if (lockOfRun(opts) === 'refuse') throw NO_SANDBOX();
    const before = await startingPoint();
    const run = newRun(opts);
    // Said on its card: whether the system keeps it inside its section.
    if (run.scope.length) run.stays = lockOfRun(run) === 'sandbox';
    // Its colour on the map while it works: the first one free, kept with the run so every window and a reload
    // show the same.
    const taken = new Set([...working.values()].map(r => r.slot));
    run.slot = [0, 1, 2, 3, 4, 5, 6, 7].find(i => !taken.has(i)) ?? working.size;
    run.before = before;
    joinEpoch(run);
    await pin(run.id, 'before', run.before);
    runs.set(run.id, run);
    working.set(run.id, run);
    saveRun(run);
    emit('state');
    return run;
  });
}
/** Ends a run with its changes. `checks: false` leaves its checks to the caller (parallel.mjs, an epoch's end). */
export async function finishRun(run, status = 'done', { checks = true } = {}) {
  // Watch mode's runs arrive with their after snapshot; an agent's is taken now and, unless others overlapped it,
  // becomes the baseline.
  if (!run.after)
    await serial(async () => {
      const snap = await snapshotNow(`run ${run.id} after`);
      run.after = snap.commit;
      if (!keepsBaseline(run)) setBase(snap);
    });
  await pin(run.id, 'after', run.after);
  const own = await ownChanges(run, await computeChanges(run.before, run.after, { unseen: true }));
  run.changes = own.filter(c => !c.unseen);
  // What the map doesn't show (binary files, the skip list's) is still the run's: said, and undone by a revert.
  run.unseen = own.filter(c => c.unseen).map(({ unseen, ...c }) => c);
  if (run.unseen.length)
    run.stream.push({
      t: 'warn',
      text: `Changed files the map doesn't show: ${run.unseen.map(c => c.path).join(', ')}`,
    });
  run.agentLines = agentLinesOf(run);
  if ((run.agent === 'detected' || run.agent === 'you') && run.changes.length) run.title = editedTitle(run.changes);
  const out = await scopeViolations(run);
  if (out.length) run.stream.push({ t: 'warn', text: `Changed outside scope: ${out.join(', ')}` });
  run.outOfScope = out;
  run.waiting = null;
  await pinSteps(run);
  working.delete(run.id);
  if (checks) checksFor(run);
  // The last run of sessions that overlapped is said to be finished once what none of them made is recorded.
  await leaveEpoch();
  run.status = status;
  run.endedAt = Date.now();
  saveRun(run);
  pruneRuns();
  emitRun(run);
}
/** Names what watch mode saw change: "Edited main.py", or "Edited main.py and 2 more". */
function editedTitle(changes) {
  const first = path.posix.basename(changes[0].path);
  return changes.length > 1 ? `Edited ${first} and ${changes.length - 1} more` : `Edited ${first}`;
}
/** Files and folders outside the scope that changed, and line ranges whose surroundings changed. */
async function scopeViolations(run) {
  if (!run.scope?.length) return [];
  const out = [];
  for (const c of run.changes) {
    if (!inScope(run.scope, c.path)) {
      out.push(c.path);
      continue;
    }
    const range = run.scope.map(scopeEntry).find(e => e.from && e.path === c.path);
    if (range && !rangeKept(c.pre, splitLines((await showAt(run.after, c.path)) ?? ''), range))
      out.push(`${c.path} outside lines ${range.from}–${range.to}`);
  }
  return out;
}
/**
 * A write the session was refused outside its section, its file named by the edit tool that tried it. Said in the
 * activity, and for a session at work on a section, asked of the person once per file: allowed, the file joins the
 * section and the session carries on (sessions.mjs answerWant).
 */
export function blocked(run, file) {
  push(run, { t: 'deny', text: `Tried to change ${file}. Blocked.`, file });
  if (!run.scope?.length || !working.has(run.id) || run.wants?.some(w => w.path === file)) return;
  (run.wants ??= []).push({ path: file });
  saveRun(run);
  emitRun(run);
}
/**
 * A shell command the sandbox refused a write outside the section. It names no file reliably, so nothing is asked:
 * the run says so, once.
 */
export function commandBlocked(run) {
  if (run.commandBlocked) return;
  run.commandBlocked = true;
  push(run, { t: 'deny', text: 'A command tried to write outside the selection. Blocked.', say: 'command-blocked' });
  saveRun(run);
  emitRun(run);
}
/**
 * A command or tool the sandbox refused, as its output says. A path outside the repo it names (the home folder is
 * closed to a session, and writes outside the repo go only to temp) is said on the card, by name; with none, it was a
 * write outside the section (commandBlocked).
 */
export function refusedBySandbox(run, text) {
  const home = os.homedir();
  const named = [
    // An absolute path only: one inside the repo is named relative to it, and is a write outside the section.
    ...String(text).matchAll(
      /(?:^|[\s'"])(\/[^\s:'"]+): Operation not permitted|operation not permitted, \w+ '(\/[^']+)'/gm,
    ),
  ].map(m => path.resolve(m[1] ?? m[2]));
  const outside = [...new Set(named)].filter(p => p !== ROOT && !p.startsWith(ROOT + path.sep));
  if (!outside.length) return commandBlocked(run);
  run.blockedPaths ??= [];
  for (const p of outside) {
    const shown = p === home || p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p;
    if (run.blockedPaths.includes(shown) || run.blockedPaths.length >= 20) continue;
    run.blockedPaths.push(shown);
    push(run, { t: 'deny', text: `Tried to open ${shown}. Blocked.`, say: 'path-blocked', outside: shown });
  }
  saveRun(run);
  emitRun(run);
}
export function push(run, entry) {
  run.stream.push(entry);
  if (run.stream.length > 400) run.stream.splice(0, run.stream.length - 400);
  emit('progress', run);
}
export async function revertRun(run, force) {
  // A run names only files inside the repo; anything else in a run file is never read or touched.
  const changes = [...run.changes, ...(run.unseen ?? [])].filter(c =>
    path.resolve(ROOT, c.path).startsWith(ROOT + path.sep),
  );
  const drift = [];
  for (const c of changes) {
    if ((await blobNow(c.path)) !== (await blobAt(run.after, c.path))) drift.push(c.path);
  }
  if (drift.length && !force) return { conflict: drift };
  const back = [];
  for (const c of changes)
    if (c.created) fs.rmSync(path.join(ROOT, c.path), { force: true });
    else if ((await blobAt(run.before, c.path)) !== null) back.push(c.path);
  await restoreFrom(run.before, back);
  run.reverted = true;
  // The bridge's own writes are not someone's changes: taken into the baseline, or into the epoch under way.
  if (working.size) noteRevert(run);
  else await serial(() => rebase());
  saveRun(run);
  emit('state');
  return { ok: true };
}
/**
 * A run the bridge stopped during (a crash, a restart) is closed as interrupted, with the changes made so far:
 * everything between its before snapshot and the tree as it is now.
 */
export async function interruptLeftover() {
  for (const r of runs.values())
    if (r.status === 'running') {
      r.after = base.commit;
      await finishRun(r, 'interrupted');
    }
}
