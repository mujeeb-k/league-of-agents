// The subset of Markdown agents write in replies: paragraphs, headings, lists, code blocks,
// inline code, bold, and italic. Rendered as React elements, never as raw HTML.
import type { ReactNode } from 'react';

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] };

const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const FENCE = /^\s*```/;

export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', text: para.join(' ') });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (FENCE.test(line)) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !FENCE.test(lines[i]!)) code.push(lines[i]!);
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const list = line.match(BULLET) ? 'ul' : line.match(NUMBER) ? 'ol' : null;
    if (list) {
      flush();
      const items: string[] = [];
      for (; i < lines.length; i++) {
        const m = lines[i]!.match(list === 'ul' ? BULLET : NUMBER);
        if (m) items.push(m[1]!);
        else if (lines[i]!.trim() && /^\s+/.test(lines[i]!) && items.length)
          items[items.length - 1] += ' ' + lines[i]!.trim();
        else break;
      }
      i--;
      blocks.push({ kind: list, items });
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      flush();
      blocks.push({ kind: 'h', text: heading[1]! });
    } else if (!line.trim()) flush();
    else para.push(line.trim());
  }
  flush();
  return blocks;
}

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|(?<!\w)__[^_\n]+__(?!\w))|(\*[^*\s\n][^*\n]*\*|(?<!\w)_[^_\s\n][^_\n]*_(?!\w))/g;

export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (m[1]) out.push(<code key={m.index}>{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={m.index}>{inline(t.slice(2, -2))}</strong>);
    else out.push(<em key={m.index}>{inline(t.slice(1, -1))}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  return (
    <>
      {parseBlocks(text).map((b, i) => {
        if (b.kind === 'code')
          return (
            <pre key={i}>
              <code>{b.text}</code>
            </pre>
          );
        if (b.kind === 'ul' || b.kind === 'ol') {
          const List = b.kind;
          return (
            <List key={i}>
              {b.items.map((it, j) => (
                <li key={j}>{inline(it)}</li>
              ))}
            </List>
          );
        }
        if (b.kind === 'h')
          return (
            <p key={i}>
              <strong>{inline(b.text)}</strong>
            </p>
          );
        return <p key={i}>{inline(b.text)}</p>;
      })}
    </>
  );
}
