// Every language has every word the app shows: each key in each catalogue, with the same {placeholders}, and for a
// count, the plural forms the language needs. Nothing a catalogue holds goes unused.
import { describe, expect, it, vi } from 'vitest';
import es from '../../src/i18n/es';
import fr from '../../src/i18n/fr';
import ptBR from '../../src/i18n/pt-BR';
import zhCN from '../../src/i18n/zh-CN';
import type { Catalogue } from '../../src/i18n';
import { usedKeys } from './keys';

// state/editing registers a page listener when it loads, through the sources the key list reads.
vi.hoisted(() => Object.assign(globalThis, { addEventListener: () => {} }));

const CATALOGUES: [string, Catalogue][] = [
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
});
