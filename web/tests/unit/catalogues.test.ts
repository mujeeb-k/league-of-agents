// Every language has every word the app shows: each key in each catalogue, with the same {placeholders}, and for a
// count, the plural forms the language needs. Nothing a catalogue holds goes unused.
import { describe, expect, it, vi } from 'vitest';
import es from '../../src/i18n/es';
import fr from '../../src/i18n/fr';
import ptBR from '../../src/i18n/pt-BR';
import zhCN from '../../src/i18n/zh-CN';
import { setLang, tn, type Catalogue, type Lang } from '../../src/i18n';
import { usedKeys } from './keys';

// state/editing registers a page listener when it loads, through the sources the key list reads.
vi.hoisted(() => Object.assign(globalThis, { addEventListener: () => {} }));

const CATALOGUES: [Exclude<Lang, 'en'>, Catalogue][] = [
  ['zh-CN', zhCN],
  ['fr', fr],
  ['pt-BR', ptBR],
  ['es', es],
];
const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

describe('catalogues', () => {
  const keys = usedKeys();
  for (const [code, cat] of CATALOGUES)
    it(`${code} has every key, with the same placeholders and the plural forms it needs, and nothing unused`, () => {
      const problems: string[] = [];
      const forms = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
      for (const [key, { plural }] of keys) {
        const e = cat[key];
        if (e === undefined) {
          problems.push(`missing: ${key}`);
          continue;
        }
        const texts = typeof e === 'string' ? [e] : Object.values(e);
        if (plural && typeof e === 'string') problems.push(`not plural: ${key}`);
        if (plural && typeof e === 'object')
          for (const f of forms) if (f !== 'many' && !e[f] && !e.other) problems.push(`no ${f} form: ${key}`);
        for (const tx of texts)
          if (holes(tx!).join() !== holes(key).join()) problems.push(`placeholders differ: ${key} -> ${tx}`);
      }
      for (const key of Object.keys(cat)) if (!keys.has(key)) problems.push(`unused: ${key}`);
      expect(problems).toEqual([]);
    });

  for (const [code, cat] of CATALOGUES)
    it(`${code} counts read right for 0, 1, 2 and 5`, async () => {
      vi.stubGlobal('document', { documentElement: {} });
      await setLang(code);
      const rules = new Intl.PluralRules(code);
      for (const [key, { plural }] of keys) {
        if (!plural) continue;
        const e = cat[key] as Partial<Record<Intl.LDMLPluralRule, string>>;
        for (const n of [0, 1, 2, 5]) {
          const s = tn(
            n,
            key,
            key,
            Object.fromEntries(
              holes(key)
                .filter(h => h !== 'n')
                .map(h => [h!, 'x']),
            ),
          );
          expect(s, `${key}, ${n}`).not.toMatch(/\{\w+\}/);
          if (key.includes('{n}')) expect(s, `${key}, ${n}`).toContain(String(n));
          // A singular form where the language has one: French and Portuguese say "0 fichier", "1 arquivo".
          if (rules.select(n) === 'one') expect(e.one, `${key}: no one form`).toBeTruthy();
        }
      }
      await setLang('en');
      vi.unstubAllGlobals();
    });
});
