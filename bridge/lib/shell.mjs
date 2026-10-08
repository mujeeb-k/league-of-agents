// A session's shell commands. Its edit tools name what they change; a shell command names nothing, so the hooks
// bracket each one (lib/hook.mjs): a snapshot before, one after, and what changed between is the command's. Inside the
// session's section it is the session's own, line for line; outside, it is put back at once and the agent is told,
// unless it lies in another session's section, whose own tools answer for it.
import fs from 'node:fs';
import path from 'node:path';
import { serial } from './util.mjs';
import { inScope } from './scope.mjs';
import { ROOT, git } from './repo.mjs';
import { blobAt, computeChanges, snapshotNow } from './snapshots.mjs';
import { noteLines } from './agents/lines.mjs';
import { push, working } from './runs.mjs';

/** The snapshot before each shell command under way, by run and tool call. */
const before = new Map();

export function shellStarts(run, tool) {
  return serial(async () => {
    before.set(`${run.id}:${tool}`, (await snapshotNow(`run ${run.id} before a shell command`)).commit);
  });
}

/** Ends a shell command's bracket: returns the files it changed outside the section, now put back. */
export function shellEnds(run, tool) {
  const key = `${run.id}:${tool}`,
    from = before.get(key);
  before.delete(key);
  if (!from) return Promise.resolve([]);
  return serial(async () => {
    const to = (await snapshotNow(`run ${run.id} after a shell command`)).commit;
    const others = [...working.values()].filter(r => r !== run).flatMap(r => (r.scope?.length ? r.scope : ['/']));
    const undone = [];
    for (const c of await computeChanges(from, to)) {
      if (inScope(run.scope, c.path))
        noteLines(
          run,
          c.path,
          c.hunks.map(h => h.add.join('\n')),
        );
      else if (!inScope(others, c.path)) {
        const abs = path.join(ROOT, c.path),
          was = await blobAt(from, c.path);
        if (was === null) fs.rmSync(abs, { force: true });
        else {
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          // Byte for byte, as the snapshot holds it.
          fs.writeFileSync(abs, git(['cat-file', 'blob', was], { encoding: 'buffer' }));
        }
        undone.push(c.path);
      }
    }
    if (undone.length)
      push(run, { t: 'warn', text: `Put back what a shell command changed outside the section: ${undone.join(', ')}` });
    return undone;
  });
}
