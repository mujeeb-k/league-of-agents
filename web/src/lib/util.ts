import { locale, t } from '../i18n';

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function relTime(ts: number | undefined | null): string {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return t('Just now');
  const ago = new Intl.RelativeTimeFormat(locale(), { numeric: 'always' });
  if (s < 3600) return ago.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return ago.format(-Math.round(s / 3600), 'hour');
  return new Date(ts).toLocaleDateString(locale(), { month: 'short', day: 'numeric' });
}
export function fmtDur(a: number | undefined | null, b: number | undefined | null): string {
  if (!a || !b) return '';
  const s = Math.round((b - a) / 1000);
  const unit = (n: number, u: 'minute' | 'second') =>
    new Intl.NumberFormat(locale(), { style: 'unit', unit: u, unitDisplay: 'narrow' }).format(n);
  return s < 60 ? unit(s, 'second') : `${unit(Math.floor(s / 60), 'minute')} ${unit(s % 60, 'second')}`;
}

/** A cost in US dollars as agents report it: to a tenth of a cent. */
export const money = (usd: number) => '$' + usd.toFixed(3);
