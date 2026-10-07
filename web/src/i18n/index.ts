// The app in the person's language: English, Simplified Chinese, French, Brazilian Portuguese or Spanish. A UI
// string is written in English where it's used, and that English is its key in each other language's catalogue
// (i18n/<lang>.ts, loaded on its own when chosen). No dependency: plurals, numbers and times come from Intl.

export type Lang = 'en' | 'zh-CN' | 'fr' | 'pt-BR' | 'es';
/** Each language by its own name, as the picker lists it. */
export const LANGS: { code: Lang; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'zh-CN', name: '简体中文' },
  { code: 'fr', name: 'Français' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'es', name: 'Español' },
];

/** A translation: one string, or one per plural form the language has (Intl.PluralRules categories). */
export type Entry = string | Partial<Record<Intl.LDMLPluralRule, string>>;
export type Catalogue = Record<string, Entry>;

const LOADERS: Record<Exclude<Lang, 'en'>, () => Promise<{ default: Catalogue }>> = {
  'zh-CN': () => import('./zh-CN'),
  fr: () => import('./fr'),
  'pt-BR': () => import('./pt-BR'),
  es: () => import('./es'),
};
const KEY = 'loa.lang';

let current: Lang = 'en',
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

/** The language a link names (/fr/ and so on), the one chosen before, the browser's, or English. */
export function preferredLang(): Lang {
  const first = location.pathname.split('/')[1]?.toLowerCase() ?? '';
  const named = LANGS.find(l => l.code !== 'en' && l.code.toLowerCase() === first);
  if (named) return named.code;
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    // Storage blocked: the browser's language decides.
  }
  const chosen = LANGS.find(l => l.code === saved);
  if (chosen) return chosen.code;
  for (const want of navigator.languages ?? [navigator.language]) {
    const w = want.toLowerCase();
    const hit =
      LANGS.find(l => l.code.toLowerCase() === w) ?? LANGS.find(l => l.code.split('-')[0] === w.split('-')[0]);
    if (hit) return hit.code;
  }
  return 'en';
}

/** Uses a language from now on: its catalogue, its plural rules, and the page's lang for fonts and readers. */
export async function setLang(code: Lang): Promise<void> {
  catalogue = code === 'en' ? {} : (await LOADERS[code]()).default;
  current = code;
  rules = new Intl.PluralRules(code);
  document.documentElement.lang = code;
}

/** Chooses a language for next time and opens the page in it (a language's own page keeps its own path). */
export function chooseLang(code: Lang) {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // Storage blocked: the choice holds for this page only.
  }
  const first = location.pathname.split('/')[1]?.toLowerCase() ?? '';
  const onLangPage = LANGS.some(l => l.code !== 'en' && l.code.toLowerCase() === first);
  const path = code === 'en' ? '/' : `/${code}/`;
  if (onLangPage) location.assign(path + location.hash);
  else location.reload();
}
