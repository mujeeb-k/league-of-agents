// Authorship recorded in git, read only: Git AI notes and co-author trailers; and attribution written as a note.
import crypto from 'node:crypto';
import { VERSION } from './paths.mjs';
import { gitAsync } from './repo.mjs';
import { repoFile } from './files.mjs';
import { headNow } from './snapshots.mjs';
import { runs } from './runs.mjs';

/**
 * A Git AI authorship log (Git AI Standard v3.0.0, refs/notes/ai): for each file, its lines by author key, and
 * what each key stands for. Lines are 1-based, in the file as the commit has it.
 */
function parseGitAiNote(text) {
  const [attest, meta = '{}'] = text.split(/\n---\n/);
  let m = {};
  try {
    m = JSON.parse(meta);
  } catch {}
  const files = new Map();
  let file = null;
  for (const line of attest.split('\n')) {
    if (!line.trim()) continue;
    if (!line.startsWith('  ')) {
      file = line.replace(/^"(.*)"$/, '$1');
      files.set(file, []);
      continue;
    }
    const [key, spec] = line.trim().split(' ');
    const lines = [];
    for (const part of (spec || '').split(',')) {
      const [a, b] = part.split('-').map(Number);
      for (let n = a; n <= (b || a); n++) lines.push(n);
    }
    let who;
    if (key.startsWith('h_')) who = { author: 'human', by: m.humans?.[key]?.author ?? '' };
    else {
      // s_<session>::t_<trace> names a session; a bare hash, a legacy prompt record.
      const rec = key.startsWith('s_') ? m.sessions?.[key.split('::')[0]] : m.prompts?.[key];
      who = { author: 'agent', by: [rec?.agent_id?.tool, rec?.agent_id?.model].filter(Boolean).join(' · ') };
    }
    if (file) files.get(file).push({ ...who, lines });
  }
  return files;
}
/** Agents that sign commits with a co-author trailer, by the name or address they use. */
const AGENT_COAUTHOR = /anthropic\.com|\bclaude\b|openai|\bcodex\b|cursor|copilot|gemini|\bjules\b|devin/i;
/**
 * Who wrote each line of a file as HEAD has it, from what git records: Git AI notes (refs/notes/ai), and
 * Co-authored-by trailers naming an agent, which cover a whole commit, so its lines are only mixed. Read only.
 */
export async function recordedAuthors(rel) {
  let out;
  try {
    out = await gitAsync(['blame', '--porcelain', 'HEAD', '--', rel]);
  } catch {
    return null;
  }
  const commits = new Map(),
    lines = [];
  let cur = null;
  for (const l of out.split('\n')) {
    const head = /^([0-9a-f]{40}) (\d+) \d+/.exec(l);
    if (head) {
      cur = { sha: head[1], orig: Number(head[2]) };
      if (!commits.has(cur.sha)) commits.set(cur.sha, { file: rel });
    } else if (l.startsWith('filename ')) commits.get(cur.sha).file = l.slice(9);
    else if (l.startsWith('\t')) lines.push({ ...cur, text: l.slice(1) });
  }
  for (const [sha, c] of commits) {
    try {
      c.note = parseGitAiNote(await gitAsync(['notes', '--ref=ai', 'show', sha]));
    } catch {}
    const body = await gitAsync(['log', '-1', '--format=%B', sha]).catch(() => '');
    c.coauthor = [...body.matchAll(/^co-authored-by:\s*(.+)$/gim)]
      .map(m => m[1].trim())
      .find(n => AGENT_COAUTHOR.test(n));
  }
  return lines.map(({ sha, orig, text }) => {
    const c = commits.get(sha);
    const hit = c.note?.get(c.file)?.find(e => e.lines.includes(orig));
    const commit = sha.slice(0, 8);
    if (hit) return { text, author: hit.author, source: 'git-ai', by: hit.by, commit };
    if (c.coauthor) return { text, author: 'mixed', source: 'trailer', by: c.coauthor, commit };
    return { text, author: 'unknown', commit };
  });
}

/**
 * Writes who wrote each line, as the app worked it out, to a git note on HEAD: an Agent Trace record (spec 0.1.0,
 * agent-trace.dev; it sets no place to keep records, so this is our choice, refs/notes/agent-trace) or a Git AI
 * authorship log (refs/notes/ai, agent lines only, never over a log already there). Only files whose working copy
 * is HEAD's, so the line numbers are HEAD's. `files`: path to { start, end, author, run } ranges, 1-based. No
 * prompts go in: notes can be pushed.
 * @param {'agent-trace' | 'git-ai'} format
 * @param {Record<string, { start: number; end: number; author: string; run: number | null }[]>} files
 */
export async function exportAttribution(format, files) {
  const head = (await headNow()).commit;
  if (!head) return { error: 'There is no commit yet.', code: 'no-commit' };
  /** @type {[string, (typeof files)[string]][]} */
  const asHead = [];
  for (const [p, ranges] of Object.entries(files || {})) {
    if (!repoFile(p) || !Array.isArray(ranges)) continue;
    const same = await gitAsync(['diff', '--quiet', 'HEAD', '--', p]).then(
      () => true,
      () => false,
    );
    if (same) asHead.push([p, ranges.filter(r => r.run && runs.has(r.run))]);
  }
  const named = asHead.filter(([, r]) => r.length);
  if (!named.length)
    return { error: 'No file as the last commit has it has lines from a kept run.', code: 'no-kept-lines' };
  const ref = format === 'git-ai' ? 'refs/notes/ai' : 'refs/notes/agent-trace';
  let note;
  if (format === 'git-ai') {
    const exists = await gitAsync(['notes', '--ref=ai', 'show', head]).then(
      () => true,
      () => false,
    );
    if (exists)
      return {
        error: 'This commit already has a Git AI note; League of Agents never writes over it.',
        code: 'note-exists',
      };
    const sessions = {};
    const attest = [];
    for (const [p, ranges] of named) {
      const keys = new Map();
      for (const r of ranges.filter(r => r.author === 'agent')) {
        const run = runs.get(r.run);
        const tool = run.agent.replace(/-terminal$|-editor$/, '');
        const sid =
          's_' +
          crypto
            .createHash('sha256')
            .update(`${tool}:${run.sessionId ?? run.id}`)
            .digest('hex')
            .slice(0, 14);
        sessions[sid] = {
          agent_id: { tool, id: String(run.sessionId ?? run.id), ...(run.model ? { model: run.model } : {}) },
        };
        const key = `${sid}::t_${crypto.createHash('sha256').update(`${run.id}`).digest('hex').slice(0, 14)}`;
        keys.set(key, [...(keys.get(key) || []), r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`]);
      }
      if (keys.size) attest.push(/[\s"]/.test(p) ? `"${p}"` : p, ...[...keys].map(([k, l]) => `  ${k} ${l.join(',')}`));
    }
    if (!attest.length) return { error: 'No line from a kept run was written by an agent.', code: 'no-agent-lines' };
    note = `${attest.join('\n')}\n---\n${JSON.stringify({ schema_version: 'authorship/3.0.0', base_commit_sha: head, prompts: {}, sessions })}`;
  } else {
    const type = { agent: 'ai', human: 'human', mixed: 'mixed' };
    const record = {
      version: '0.1.0',
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      vcs: { type: 'git', revision: head },
      tool: { name: 'league-of-agents', version: VERSION },
      files: named.map(([p, ranges]) => {
        const byRun = new Map();
        for (const r of ranges.filter(r => type[r.author])) {
          const k = `${r.run}:${r.author}`;
          if (!byRun.has(k)) byRun.set(k, { run: runs.get(r.run), author: r.author, ranges: [] });
          byRun.get(k).ranges.push({ start_line: r.start, end_line: r.end });
        }
        return {
          path: p,
          conversations: [...byRun.values()].map(({ run, author, ranges }) => ({
            contributor: {
              type: type[author],
              ...(author !== 'human' && run.model && /^claude/.test(run.agent)
                ? { model_id: `anthropic/${run.model}` }
                : {}),
            },
            ranges,
          })),
        };
      }),
    };
    note = JSON.stringify(record, null, 2);
  }
  // The note is the person's: their git identity, or League of Agents' own where they have none set.
  const hasIdentity = await gitAsync(['var', 'GIT_AUTHOR_IDENT']).then(
    () => true,
    () => false,
  );
  const who = {
    GIT_AUTHOR_NAME: 'loa',
    GIT_AUTHOR_EMAIL: 'loa@localhost',
    GIT_COMMITTER_NAME: 'loa',
    GIT_COMMITTER_EMAIL: 'loa@localhost',
  };
  await gitAsync(['notes', `--ref=${ref.slice('refs/notes/'.length)}`, 'add', '-f', '-F', '-', head], {
    input: note,
    ...(hasIdentity ? {} : { env: { ...process.env, ...who } }),
  });
  return { ref, commit: head, files: named.length };
}
