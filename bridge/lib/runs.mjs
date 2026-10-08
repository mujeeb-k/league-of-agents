// Runs: each change recorded with its before and after snapshots, kept, reverted, and pruned when old.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, splitLines, serial } from './util.mjs';
import { inScope, rangeKept, scopeEntry } from './scope.mjs';
import { ROOT, RUNS_DIR, CONF, git } from './repo.mjs';
import { runChecks } from './checks.mjs';
import { agentLinesOf } from './agents.mjs';
import { writeTree, commitTree, headNow, pin, showAt, computeChanges } from './snapshots.mjs';
import { base, setBase, rebase, settle } from './watch.mjs';
import { emit, emitRun } from './events.mjs';

export const runs = new Map();
/** The runs recorded before, from .loa/runs/. */
export function loadRuns() {
  for (const f of fs.readdirSync(RUNS_DIR))
    if (f.endsWith('.json')) {
      const r = readJson(path.join(RUNS_DIR, f));
      if (r) runs.set(r.id, r);
    }
}
export let active = null; // { run, child, cancel }: cancel, for a harness asked to stop its turn (startAcp)
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
      old.flatMap(id => [`delete refs/loa/runs/${id}/before`, `delete refs/loa/runs/${id}/after`]).join('\n') + '\n',
  });
  for (const id of old) {
    for (const ext of ['.json', '.stream.jsonl', '.stderr.log'])
      fs.rmSync(path.join(RUNS_DIR, id + ext), { force: true });
    runs.delete(id);
  }
}
export const saveRun = r => fs.writeFileSync(path.join(RUNS_DIR, r.id + '.json'), JSON.stringify(r));
export const publicRun = r => ({ ...r, stream: (r.stream || []).slice(-60) });
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
    if (active)
      throw Object.assign(new Error(`Run ${active.run.id} is still active`), {
        code: 409,
        reason: 'run-active',
        args: { id: active.run.id },
      });
    // Changes made before the run started are recorded on their own, so they never count as the agent's.
    const before = await settle();
    const run = newRun(opts);
    run.before = before;
    await pin(run.id, 'before', run.before);
    runs.set(run.id, run);
    active = { run, child: null };
    saveRun(run);
    emit('state');
    return run;
  });
}
export async function finishRun(run, status = 'done') {
  // Watch mode's runs arrive with their after snapshot; an agent's is taken now and becomes the baseline.
  if (!run.after)
    await serial(async () => {
      const head = await headNow(),
        tree = await writeTree();
      run.after = await commitTree(tree, `run ${run.id} after`, head);
      setBase({ head, tree, commit: run.after });
    });
  await pin(run.id, 'after', run.after);
  run.changes = await computeChanges(run.before, run.after);
  run.agentLines = agentLinesOf(run);
  if (run.agent === 'detected' || run.agent === 'you') run.title = editedTitle(run.changes);
  const out = await scopeViolations(run);
  if (out.length) run.stream.push({ t: 'warn', text: `Changed outside scope: ${out.join(', ')}` });
  run.outOfScope = out;
  run.status = status;
  run.endedAt = Date.now();
  if (active && active.run === run) active = null;
  saveRun(run);
  pruneRuns();
  emitRun(run);
  if (run.changes.length && CONF.checks?.length) {
    run.checksRunning = true;
    emit('progress', run);
    runChecks(run)
      .catch(e => run.checks.push({ name: 'checks', ok: false, summary: e.message }))
      .finally(() => {
        run.checksRunning = false;
        saveRun(run);
        emitRun(run);
      });
  }
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
export function push(run, entry) {
  run.stream.push(entry);
  if (run.stream.length > 400) run.stream.splice(0, run.stream.length - 400);
  emit('progress', run);
}
export async function revertRun(run, force) {
  const drift = [];
  for (const c of run.changes) {
    const now = fs.existsSync(path.join(ROOT, c.path)) ? fs.readFileSync(path.join(ROOT, c.path), 'utf8') : null;
    if (now !== (await showAt(run.after, c.path))) drift.push(c.path);
  }
  if (drift.length && !force) return { conflict: drift };
  for (const c of run.changes) {
    const abs = path.resolve(ROOT, c.path);
    // A run names only files inside the repo; anything else in a run file is never touched.
    if (!abs.startsWith(ROOT + path.sep)) continue;
    if (c.created) {
      try {
        fs.rmSync(abs);
      } catch {}
      continue;
    }
    const before = await showAt(run.before, c.path);
    if (before !== null) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, before);
    }
  }
  run.reverted = true;
  // The bridge's own writes are not someone's changes.
  if (!active) await serial(() => rebase());
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
