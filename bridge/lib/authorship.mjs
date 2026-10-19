// Authorship recorded in git, read only: co-author trailers.
import { gitAsync } from './repo.mjs';

/** Agents that sign commits with a co-author trailer, by the name or address they use. */
const AGENT_COAUTHOR = /anthropic\.com|\bclaude\b|openai|\bcodex\b|cursor|copilot|gemini|\bjules\b|devin/i;
/**
 * Who wrote each line of a file as HEAD has it, from what git records: Co-authored-by trailers naming an agent,
 * which cover a whole commit, so its lines are only mixed. Read only.
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
  let sha = '';
  for (const l of out.split('\n')) {
    const head = /^([0-9a-f]{40}) \d+ \d+/.exec(l);
    if (head) {
      sha = head[1];
      if (!commits.has(sha)) commits.set(sha, {});
    } else if (l.startsWith('\t')) lines.push({ sha, text: l.slice(1) });
  }
  for (const [sha, c] of commits) {
    const body = await gitAsync(['log', '-1', '--format=%B', sha]).catch(() => '');
    c.coauthor = [...body.matchAll(/^co-authored-by:\s*(.+)$/gim)]
      .map(m => m[1].trim())
      .find(n => AGENT_COAUTHOR.test(n));
  }
  return lines.map(({ sha, text }) => {
    const c = commits.get(sha);
    const commit = sha.slice(0, 8);
    if (c.coauthor) return { text, author: 'mixed', source: 'trailer', by: c.coauthor, commit };
    return { text, author: 'unknown', commit };
  });
}
