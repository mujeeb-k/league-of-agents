// The app's words, ready for other languages. A UI string is written in English where it's used, and that English
// is its key in a language's catalogue. No dependency: plurals come from Intl.

/** A translation: one string, or one per plural form the language has (Intl.PluralRules categories). */
export type Entry = string | Partial<Record<Intl.LDMLPluralRule, string>>;
export type Catalogue = Record<string, Entry>;

const current = 'en',
  catalogue: Catalogue = {},
  rules = new Intl.PluralRules('en');

const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;

/** The language words, numbers and dates are shown in. */
export const locale = () => current;

/** A UI string in the person's language; `{name}` in it takes `vars.name`. */
export function t(en: string, vars?: Record<string, string | number>): string {
  const e = catalogue[en];
  return fill(typeof e === 'string' ? e : en, vars);
}

/**
 * A count with its words, in the plural form the language needs: `tn(3, '{n} file', '{n} files')`. The English plural
 * is the key; a catalogue gives each form its language has.
 */
export function tn(n: number, one: string, other: string, vars?: Record<string, string | number>): string {
  const e = catalogue[other],
    form = rules.select(n);
  const s = typeof e === 'object' ? (e[form] ?? e.other ?? other) : typeof e === 'string' ? e : n === 1 ? one : other;
  return fill(s, { n: n.toLocaleString(current), ...vars });
}
