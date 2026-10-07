import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ABOUT, DESCRIPTION, TAGLINE } from '../../src/lib/intro';
import { LANGS, type Lang } from '../../src/i18n';
import { CATALOGUES, alternates, descriptionIn, homePage, urlOf } from '../../src/i18n/pages';

const english = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

describe.each(LANGS.map(l => l.code))('the %s homepage HTML, before any script runs', (lang: Lang) => {
  const html = lang === 'en' ? english : homePage(english, lang);
  const tr = (en: string) => (lang === 'en' ? en : ((CATALOGUES[lang][en] as string | undefined) ?? en));
  const description = lang === 'en' ? DESCRIPTION : descriptionIn(lang);
  const meta = (attr: string) => new RegExp(`<meta ${attr} content="([^"]*)">`).exec(html)?.[1];
  const ld = [...html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)].map(
    m => JSON.parse(m[1]!) as Record<string, unknown>,
  );

  it('is in its language, at its own address, and names the page in every other language', () => {
    expect(html).toContain(`<html lang="${lang}">`);
    expect(html).toContain(`<link rel="canonical" href="${urlOf(lang, 'home')}">`);
    expect(meta('property="og:url"')).toBe(urlOf(lang, 'home'));
    expect(html).toContain(alternates('home'));
    // A page one folder down reaches the site's files from its root.
    if (lang !== 'en') expect(html).not.toMatch(/(href|src)="\.\//);
  });
  it('has one heading, the tagline, with the introduction the app shows in that language', () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(`<h1>${TAGLINE}</h1>`);
    if (lang !== 'en') expect(html).toContain(`<p class="translation">${esc(tr(TAGLINE))}</p>`);
    expect(html).toContain(`<p>${esc(tr(ABOUT))}</p>`);
    expect(html).toContain('<code>npx leagueofagents-cli@latest</code>');
  });
  it('describes the page the same way everywhere', () => {
    expect(meta('name="description"')).toBe(esc(description));
    expect(meta('property="og:description"')).toBe(esc(description));
    expect(meta('name="twitter:description"')).toBe(esc(description));
    // The page's title is the product name and the tagline, in English: the brand line, in every language.
    const title = `League of Agents: ${TAGLINE}`;
    expect(html).toContain(`<title>${title}</title>`);
    expect(meta('property="og:title"')).toBe(title);
    expect(meta('name="twitter:title"')).toBe(title);
  });
  it('carries a website, the app and its author as structured data, with nothing made up', () => {
    expect(ld.map(o => o['@type'])).toEqual(['WebSite', 'SoftwareApplication', 'Person']);
    const app = ld[1]!;
    expect(app.description).toBe(description);
    expect(app.operatingSystem).toBe('macOS');
    expect(app.inLanguage).toEqual(LANGS.map(l => l.code));
    expect(app).not.toHaveProperty('aggregateRating');
    expect(app).not.toHaveProperty('review');
    expect(app.author).toEqual({ '@id': ld[2]!['@id'] });
  });
});

describe('the homepage script', () => {
  it('knows the languages the app does, to hold back an introduction in another one', () => {
    const list = /var langs = (\[[^\]]*\]);/.exec(english)?.[1];
    expect(JSON.parse(list!.replace(/'/g, '"'))).toEqual(LANGS.map(l => l.code));
  });
});

describe('llms.txt', () => {
  it("stays one English file, and lists each other language's homepage", () => {
    const llms = readFileSync(new URL('../../public/llms.txt', import.meta.url), 'utf8');
    for (const l of LANGS.filter(l => l.code !== 'en')) expect(llms).toContain(`- ${l.name} `);
    for (const l of LANGS.filter(l => l.code !== 'en')) expect(llms).toContain(urlOf(l.code, 'home'));
  });
});
