export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function relTime(ts: number | undefined | null): string {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'Just now';
  if (s < 3600) return plural(Math.round(s / 60), 'min') + ' ago';
  if (s < 86400) return plural(Math.round(s / 3600), 'hour') + ' ago';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export function fmtDur(a: number | undefined | null, b: number | undefined | null): string {
  if (!a || !b) return '';
  const s = Math.round((b - a) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
