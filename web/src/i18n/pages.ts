// Each language's homepage and privacy page, made at build time from the English ones (vite.config.ts): the page's
// language, address, description and introduction in that language. The tagline and the privacy pair stay in
// English with their translation beneath, as the app shows them.
import { LANGS, type Catalogue, type Lang } from '.';
import { ABOUT, DESCRIPTION, IMAGE_ALT, PRIVACY, PRIVACY_ABOUT, SUMMARY, TAGLINE } from '../lib/intro';
import es from './es';
import fr from './fr';
import ptBR from './pt-BR';
import zhCN from './zh-CN';

export const SITE = 'https://leagueofagents.dev';
export type Other = Exclude<Lang, 'en'>;
export const CATALOGUES: Record<Other, Catalogue> = { 'zh-CN': zhCN, fr, 'pt-BR': ptBR, es };
type Page = 'home' | 'privacy';

/** A page's address in a language: the homepage at / or /fr/, the privacy page at /privacy or /fr/privacy. */
export const urlOf = (lang: Lang, page: Page) =>
  SITE + (lang === 'en' ? '/' : `/${lang}/`) + (page === 'privacy' ? 'privacy' : '');

/** The same page in each language, for search engines, with English as the default. */
export const alternates = (page: Page) =>
  [
    ...LANGS.map(l => `<link rel="alternate" hreflang="${l.code}" href="${urlOf(l.code, page)}">`),
    `<link rel="alternate" hreflang="x-default" href="${urlOf('en', page)}">`,
  ].join('\n');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Replaces every `from`; a page that lacks it fails the build rather than ship in English. */
function swap(html: string, from: string, to: string) {
  if (!html.includes(from)) throw new Error(`Not on the English page: ${from}`);
  return html.split(from).join(to);
}

const words = (cat: Catalogue) => (en: string) => {
  const e = cat[en];
  return typeof e === 'string' ? e : en;
};

/** The words a language's homepage describes itself with. */
export const descriptionIn = (lang: Other) => `${TAGLINE} ${words(CATALOGUES[lang])(SUMMARY)}`;

/** The homepage in a language, from the English one. */
export function homePage(html: string, lang: Other): string {
  const tr = words(CATALOGUES[lang]),
    description = descriptionIn(lang);
  let out = swap(html, '<html lang="en">', `<html lang="${lang}">`);
  // The meta tags first: the structured data's description is the same words, in JSON.
  out = swap(out, `content="${DESCRIPTION}"`, `content="${esc(description)}"`);
  out = swap(out, JSON.stringify(DESCRIPTION), JSON.stringify(description));
  out = swap(
    out,
    `content="League of Agents: ${TAGLINE} ${IMAGE_ALT}"`,
    `content="League of Agents: ${TAGLINE} ${esc(tr(IMAGE_ALT))}"`,
  );
  out = swap(out, `<link rel="canonical" href="${SITE}/">`, `<link rel="canonical" href="${urlOf(lang, 'home')}">`);
  out = swap(
    out,
    `<meta property="og:url" content="${SITE}/">`,
    `<meta property="og:url" content="${urlOf(lang, 'home')}">`,
  );
  out = swap(out, `<h1>${TAGLINE}</h1>`, `<h1>${TAGLINE}</h1>\n    <p class="translation">${esc(tr(TAGLINE))}</p>`);
  out = swap(out, `<p>${ABOUT}</p>`, `<p>${esc(tr(ABOUT))}</p>`);
  // One folder down, the site's files are reached from its root.
  return out.replace(/(href|src)="\.\//g, '$1="/');
}

/** The privacy page in a language, from the English one and that language's text (i18n/privacy/<lang>.html). */
export function privacyPage(html: string, lang: Other, body: string): string {
  const tr = words(CATALOGUES[lang]);
  let out = swap(html, '<html lang="en">', `<html lang="${lang}">`);
  out = swap(
    out,
    '<title>Privacy · League of Agents</title>',
    `<title>${esc(tr('Privacy'))} · League of Agents</title>`,
  );
  out = swap(
    out,
    `content="${PRIVACY_ABOUT} ${PRIVACY}"`,
    `content="${esc(`${tr(PRIVACY_ABOUT)} ${PRIVACY} ${tr(PRIVACY)}`)}"`,
  );
  out = swap(
    out,
    `<link rel="canonical" href="${urlOf('en', 'privacy')}">`,
    `<link rel="canonical" href="${urlOf(lang, 'privacy')}">`,
  );
  out = swap(out, '<a href="/">League of Agents</a>', `<a href="/${lang}/">League of Agents</a>`);
  const start = out.indexOf('</header>') + '</header>'.length,
    end = out.indexOf('</main>');
  return out.slice(0, start) + '\n' + body + out.slice(end);
}
