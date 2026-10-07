// The README in each language: every section the English one has, at the same level and in the same order, and its
// code exactly. Fails when a translation misses a section, as soon as one is added to README.md alone.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRIVACY, TAGLINE } from '../../src/lib/intro';
import { LANGS } from '../../src/i18n';
import { CATALOGUES, type Other } from '../../src/i18n/pages';

const read = (name: string) => readFileSync(new URL(`../../../${name}`, import.meta.url), 'utf8');
const english = read('README.md');
const fenced = (md: string) => md.match(/^```[\s\S]*?^```$/gm) ?? [];
// Headings outside code: their levels, in order.
const levels = (md: string) =>
  md
    .replace(/^```[\s\S]*?^```$/gm, '')
    .split('\n')
    .filter(l => /^#{1,6} /.test(l))
    .map(l => l.split(' ')[0]);
const LINKS = LANGS.map(l => `[${l.name}](${l.code === 'en' ? 'README.md' : `README.${l.code}.md`})`).join(' · ');
const others = LANGS.map(l => l.code).filter((c): c is Other => c !== 'en');

describe('the README', () => {
  it('links every language at the top', () => {
    expect(english.split('\n')[2]).toBe(LINKS);
  });

  it.each(others)('in %s has every section and code block the English one has', lang => {
    const name = `README.${lang}.md`;
    expect(existsSync(new URL(`../../../${name}`, import.meta.url)), name).toBe(true);
    const md = read(name);
    const lines = md.split('\n');
    expect(lines[0]).toBe(english.split('\n')[0]);
    expect(lines[2]).toBe(LINKS);
    // Marked beta, with the English README as the reference.
    expect(lines[4]).toMatch(/^> .*\[README\.md\]\(README\.md\)/);
    expect(levels(md)).toEqual(levels(english));
    expect(fenced(md)).toEqual(fenced(english));
    // The tagline stays English, the brand line, with its translation beneath; so does the privacy pair.
    expect(md).toContain(`**${TAGLINE}**<br>\n${CATALOGUES[lang][TAGLINE] as string}\n`);
    expect(md.split(PRIVACY).length).toBe(english.split(PRIVACY).length);
    expect(md).toContain(CATALOGUES[lang][PRIVACY] as string);
  });
});
