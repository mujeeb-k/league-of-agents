import type { Conn } from './types';

export function parseConn(str: string, here: string = location.href): Conn | null {
  try {
    const u = new URL(str, here),
      hp = new URLSearchParams(u.hash.slice(1));
    const t = hp.get('t');
    if (!t) return null;
    if (hp.get('bridge')) return { base: `http://127.0.0.1:${+(hp.get('bridge') ?? '')}`, token: t };
    if (/^(127\.0\.0\.1|localhost)$/.test(u.hostname)) return { base: u.origin, token: t };
  } catch {
    /* not a URL */
  }
  return null;
}

const KEY = 'loa.conn';

export function saveConn(c: Conn) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* storage blocked */
  }
}
export function clearConn() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
}
export function loadConn(): Conn | null {
  let v: unknown = null;
  try {
    v = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    /* storage blocked or bad JSON */
  }
  if (
    typeof v === 'object' &&
    v !== null &&
    'base' in v &&
    'token' in v &&
    typeof v.base === 'string' &&
    typeof v.token === 'string'
  )
    return { base: v.base, token: v.token };
  return null;
}
