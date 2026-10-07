// The privacy page in each language: the same sections and points as the English one, which stays the reference;
// the privacy pair in English with its translation beneath, as the app shows it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRIVACY } from '../../src/lib/intro';
import { LANGS } from '../../src/i18n';
import { CATALOGUES, alternates, privacyPage, urlOf, type Other } from '../../src/i18n/pages';

const english = readFileSync(new URL('../../public/privacy.html', import.meta.url), 'utf8');
const count = (html: string, tag: string) => html.match(new RegExp(`<${tag}[ >]`, 'g'))?.length ?? 0;
const others = LANGS.map(l => l.code).filter((c): c is Other => c !== 'en');

describe('the privacy page', () => {
  it('names itself in every language', () => {
    expect(english).toContain(alternates('privacy'));
    expect(english).toContain(`<p>${PRIVACY}</p>`);
  });

  it.each(others)('in %s has every section and point the English one has', lang => {
    const body = readFileSync(new URL(`../../src/i18n/privacy/${lang}.html`, import.meta.url), 'utf8');
    const html = privacyPage(english, lang, body);
    expect(html).toContain(`<html lang="${lang}">`);
    expect(html).toContain(`<link rel="canonical" href="${urlOf(lang, 'privacy')}">`);
    expect(html).toContain(alternates('privacy'));
    expect(html).toContain(`<a href="/${lang}/">League of Agents</a>`);
    for (const tag of ['h1', 'h2', 'li', 'ul', 'code']) expect(count(html, tag), tag).toBe(count(english, tag));
    // Two paragraphs more: the beta note, and the privacy pair's translation.
    expect(count(html, 'p')).toBe(count(english, 'p') + 2);
    expect(html).toMatch(/<p class="beta">[^<]*<a href="\/privacy">/);
    expect(html).toContain(`<p>${PRIVACY}</p>\n  <p class="translation">${CATALOGUES[lang][PRIVACY] as string}</p>`);
  });
});
