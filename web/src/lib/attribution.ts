// Who wrote each line, as far as League of Agents can know it: agent, human, mixed or unknown, with the run that
// last wrote it. Built by walking the runs in order, each from the file as the run found it to the file it left.
//
// What the labels mean:
// - agent: Claude Code wrote the line through its edit tools (the run's agentLines, from the bridge).
// - human: saved from the map's editor (a run by "you").
// - mixed: someone else rewrote part of a line an agent had written.
// - unknown: everything else: lines from before the first run kept, edits outside a run, lines a Codex or Cursor
//   run changed, lines a Claude Code run changed some other way (a shell command), and lines whose run was pruned.
import { changedBlock } from './textdiff';
import type { Run } from './types';

export type Author = 'agent' | 'human' | 'mixed' | 'unknown';
export interface Owner {
  author: Author;
  /** The run that last wrote the line; null for a line no kept run wrote. */
  run: number | null;
}
interface Tracked {
  lines: string[];
  owners: Owner[];
}

const UNKNOWN: Owner = { author: 'unknown', run: null };

/** The words two lines share, as a share of the words in either: 1 for the same words, 0 for none. */
function overlap(a: string, b: string): number {
  const wa = new Set(a.match(/\w+/g) ?? []),
    wb = new Set(b.match(/\w+/g) ?? []);
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.max(wa.size, wb.size);
}

/** A file as tracked so far, brought to the text a run or the disk shows: lines that differ lose their owner. */
function align(t: Tracked | undefined, lines: string[]): Tracked {
  if (!t) return { lines, owners: lines.map(() => UNKNOWN) };
  const b = changedBlock(t.lines, lines);
  if (!b) return t;
  return {
    lines,
    owners: [...t.owners.slice(0, b.at), ...b.add.map(() => UNKNOWN), ...t.owners.slice(b.at + b.del)],
  };
}

/** Who wrote a line a run added, at index `at` in the file the run left, given the lines its hunk replaced. */
function authorOf(run: Run, path: string, at: number, text: string, replaced: Tracked): Owner {
  const tool = run.agentLines?.[path]?.some(([from, to]) => at >= from && at <= to);
  if (tool) return { author: 'agent', run: run.id };
  const wasAgent = replaced.owners.some(
    (o, i) => (o.author === 'agent' || o.author === 'mixed') && overlap(replaced.lines[i]!, text) >= 0.5,
  );
  if (wasAgent) return { author: 'mixed', run: run.id };
  return { author: run.agent === 'you' ? 'human' : 'unknown', run: run.id };
}

/**
 * Each file's owners, line by line, for the files as they are now (`now`: path to lines). Runs are walked in
 * order; a reverted run is skipped, its lines being put back. Where the file a run found differs from the one
 * the walk reached (a commit, edits while the bridge was stopped, a pruned run), the lines that differ are unknown.
 */
export function authorsOf(runs: Run[], now: Map<string, string[]>): Map<string, Owner[]> {
  const files = new Map<string, Tracked>();
  for (const run of [...runs].sort((a, b) => a.id - b.id)) {
    if (run.reverted) continue;
    for (const [path, c] of run.changes) {
      if (c.deleted) {
        files.delete(path);
        continue;
      }
      const from = c.renamedFrom ?? path;
      const start = c.created ? { lines: [], owners: [] } : align(files.get(from), c.pre ?? []);
      if (c.renamedFrom) files.delete(c.renamedFrom);
      const lines: string[] = [],
        owners: Owner[] = [];
      // A created file is one insertion; the demo's carry their lines without hunks.
      const hunks = c.created && !c.hunks.length ? [{ at: 0, del: 0, add: c.lines }] : c.hunks;
      let i = 0;
      for (const h of [...hunks].sort((a, b) => a.at - b.at)) {
        for (; i < h.at; i++) {
          lines.push(start.lines[i]!);
          owners.push(start.owners[i]!);
        }
        const replaced = { lines: start.lines.slice(i, i + h.del), owners: start.owners.slice(i, i + h.del) };
        for (const text of h.add) {
          owners.push(authorOf(run, path, lines.length, text, replaced));
          lines.push(text);
        }
        i += h.del;
      }
      for (; i < start.lines.length; i++) {
        lines.push(start.lines[i]!);
        owners.push(start.owners[i]!);
      }
      files.set(path, { lines, owners });
    }
  }
  const out = new Map<string, Owner[]>();
  for (const [path, lines] of now) out.set(path, align(files.get(path), lines).owners);
  return out;
}

/** A file's lines by author, for its share bar when zoomed out. */
export function shareOf(owners: Owner[]): Record<Author, number> {
  const n: Record<Author, number> = { agent: 0, human: 0, mixed: 0, unknown: 0 };
  for (const o of owners) n[o.author]++;
  return n;
}
