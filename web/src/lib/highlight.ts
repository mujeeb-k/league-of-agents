// Syntax tokens, returned as spans of data so components can render <em class="…">.
const TOK =
  /(\/\/.*$)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|\b(import|from|export|const|let|var|function|async|await|return|if|else|type|interface|new|for|of|in|throw|class|extends|default|as|def|self|None|True|False|null|undefined|true|false)\b|\b(\d[\d_.]*)\b/g;

export type TokenClass = 'c' | 's' | 'k' | 'n';
export interface Token {
  c: TokenClass | null;
  t: string;
  /** Part of a changed word in an added or removed line. */
  w?: boolean;
}

export function hl(s: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const m of s.matchAll(TOK)) {
    const off = m.index;
    if (off > last) out.push({ c: null, t: s.slice(last, off) });
    out.push({ c: m[1] ? 'c' : m[2] ? 's' : m[3] ? 'k' : 'n', t: m[0] });
    last = off + m[0].length;
  }
  if (last < s.length) out.push({ c: null, t: s.slice(last) });
  return out;
}

/** Splits tokens at the given character ranges and flags the pieces inside them as changed words. */
export function markWords(toks: Token[], ranges: [number, number][] | undefined): Token[] {
  if (!ranges?.length) return toks;
  const out: Token[] = [];
  let at = 0;
  for (const tok of toks) {
    const end = at + tok.t.length;
    let cut = at;
    for (const [s, e] of ranges) {
      if (e <= cut || s >= end) continue;
      if (s > cut) out.push({ c: tok.c, t: tok.t.slice(cut - at, s - at) });
      const to = Math.min(e, end);
      out.push({ c: tok.c, t: tok.t.slice(Math.max(s, cut) - at, to - at), w: true });
      cut = to;
    }
    if (cut < end) out.push({ c: tok.c, t: tok.t.slice(cut - at) });
    at = end;
  }
  return out;
}
