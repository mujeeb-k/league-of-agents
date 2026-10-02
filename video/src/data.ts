// The numbers the video says, taken from the captured runs (capture/footage.mjs), so the lines always match
// the footage.
import { useEffect, useState } from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';
import spread from '../public/footage/propagate.json';

const folderOf = (p: string) => p.split('/').slice(0, -1).join('/');
export const SPREAD = {
  files: spread.changes.length,
  folders: [...new Set(spread.changes.map(c => folderOf(c.path)))],
  seconds: Math.round((spread.endedAt - spread.startedAt) / 1000),
  cost: spread.cost,
  check: spread.checks[0]!,
  /** The files the agent edited, in the order it first edited each, with their folders. */
  edited: [
    ...new Set(spread.stream.filter(e => e.t === 'tool' && /^Edit /.test(e.text)).map(e => e.text.slice(5))),
  ].map(p => ({ path: p, name: p.split('/').pop()!, folder: folderOf(p) })),
};

type Use = { type: string; name?: string; text?: string; input?: Record<string, unknown> };
type Message = { type: string; duration_ms?: number; message?: { content: Use[] } };
export type Session = { actions: number; files: number; seconds: number; lines: { text: string; action: number }[] };

/** A real Claude Code session recorded in the averroes-hook clone (public/footage/<file>), as Claude Code prints it. */
export function useSession(file = 'hook-session.jsonl'): Session | null {
  const [s, set] = useState<Session | null>(null);
  const [handle] = useState(() => delayRender('agent session'));
  useEffect(() => {
    void fetch(staticFile(`footage/${file}`))
      .then(r => r.text())
      .then(t => {
        const msgs = t
          .trim()
          .split('\n')
          .map(l => JSON.parse(l) as Message);
        const rel = (p: string) => p.replace(/\/\S*?averroes-hook\//g, '').replace(/(^|[\s'"])\/\S*\/([^\s/'"]+)/g, '$1$2');
        const lines: Session['lines'] = [];
        const files = new Set<string>();
        let actions = 0;
        for (const m of msgs)
          for (const c of m.type === 'assistant' ? (m.message?.content ?? []) : []) {
            if (c.type === 'text' && c.text)
              for (const l of `⏺ ${c.text.replace(/`/g, '')}`.split('\n')) lines.push({ text: l, action: actions });
            if (c.type === 'tool_use' && c.name) {
              actions++;
              const i = c.input ?? {};
              const arg = String(i.file_path ?? i.command ?? '').split('\n')[0]!;
              const verb = c.name === 'Edit' ? 'Update' : c.name;
              if ((c.name === 'Edit' || c.name === 'Write') && String(i.file_path).includes('averroes-hook/'))
                files.add(String(i.file_path));
              lines.push({ text: `⏺ ${verb}(${rel(arg).slice(0, 80)})`, action: actions });
              for (const a of String(i.new_string ?? '')
                .split('\n')
                .filter(x => x.trim())
                .slice(0, 2))
                lines.push({ text: `  ⎿  + ${a}`, action: actions });
            }
          }
        const result = msgs.find(m => m.type === 'result');
        set({ actions, files: files.size, seconds: Math.round((result?.duration_ms ?? 0) / 1000), lines });
        continueRender(handle);
      });
  }, [handle, file]);
  return s;
}
