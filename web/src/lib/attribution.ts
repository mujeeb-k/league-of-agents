// Who wrote each line, as far as League of Agents can know it: agent, human, mixed or unknown, with the run that
// last wrote it. Built by walking the runs in order, each from the file as the run found it to the file it left.
//
// What the labels mean:
// - agent: Claude Code wrote the line through its edit tools (the run's agentLines, from the bridge).
// - human: saved from the map's editor (a run by "you").
// - mixed: someone else rewrote part of a line an agent had written.
// - unknown: everything else: lines from before the first run kept, edits outside a run, lines a Codex or Cursor
//   run changed, lines a Claude Code run changed some other way (a shell command), and lines whose run was pruned.
import type { RecordedLine } from '../api/types';
import type { Run } from './types';

export type Author = 'agent' | 'human' | 'mixed' | 'unknown';
export interface Owner {
  author: Author;
  /** The run that last wrote the line; null for a line no kept run wrote. */
  run: number | null;
  /** For a line no kept run wrote: what git records about it (a Git AI note, or a co-author trailer). */
  source?: 'git-ai' | 'trailer';
  by?: string;
  commit?: string;
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

/** How far ahead a line is looked for when the two versions of a file are matched. */
const LOOKAHEAD = 200;
/**
 * The lines of `b` that are lines of `a`, in order: for each index in `b`, its index in `a`, or -1 for a line that
 * changed. Each line of `a` is matched once, to the next equal line of `b` within LOOKAHEAD; a line too short to
 * tell apart (a blank line, a brace) only to one within a few lines, so it can't pull the match far ahead.
 */
function matchLines(a: string[], b: string[]): number[] {
  const out = b.map(() => -1);
  let j = 0;
  for (let i = 0; i < a.length && j < b.length; i++) {
    const end = Math.min(b.length, j + (a[i]!.trim().length < 3 ? 3 : LOOKAHEAD));
    for (let k = j; k < end; k++)
      if (b[k] === a[i]) {
        out[k] = i;
        j = k + 1;
        break;
      }
  }
  return out;
}

/** A file as tracked so far, brought to the text a run or the disk shows: lines that differ lose their owner. */
function align(t: Tracked | undefined, lines: string[]): Tracked {
  if (!t) return { lines, owners: lines.map(() => UNKNOWN) };
  if (t.lines.length === lines.length && t.lines.every((l, i) => l === lines[i])) return t;
  return { lines, owners: matchLines(t.lines, lines).map(i => (i < 0 ? UNKNOWN : t.owners[i]!)) };
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
export function authorsOf(
  runs: Run[],
  now: Map<string, string[]>,
  recorded: Map<string, RecordedLine[]> = new Map(),
): Map<string, Owner[]> {
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
  for (const [path, lines] of now) {
    const owners = align(files.get(path), lines).owners;
    const rec = recorded.get(path);
    out.set(path, rec ? withRecorded(owners, lines, rec) : owners);
  }
  return out;
}

/** Lines no kept run wrote take what git records for them at HEAD, where the line is still as HEAD has it. */
function withRecorded(owners: Owner[], lines: string[], rec: RecordedLine[]): Owner[] {
  const at = matchLines(
    rec.map(r => r.text),
    lines,
  );
  return owners.map((o, i) => {
    if (o.run !== null) return o;
    const r = rec[at[i]!];
    if (!r?.source) return o;
    return { author: r.author, run: null, source: r.source, by: r.by, commit: r.commit };
  });
}

/** A file's lines by author, for its share bar when zoomed out. */
export function shareOf(owners: Owner[]): Record<Author, number> {
  const n: Record<Author, number> = { agent: 0, human: 0, mixed: 0, unknown: 0 };
  for (const o of owners) n[o.author]++;
  return n;
}
