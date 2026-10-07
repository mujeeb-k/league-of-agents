import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ABOUT, DESCRIPTION, TAGLINE } from '../../src/lib/intro';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const meta = (attr: string) => new RegExp(`<meta ${attr} content="([^"]*)">`).exec(html)?.[1];
const ld = [...html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)].map(
  m => JSON.parse(m[1]!) as Record<string, unknown>,
);

describe('the homepage HTML, before any script runs', () => {
  it('has one heading, the tagline, with the same introduction the app shows', () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(`<h1>${TAGLINE}</h1>`);
    expect(html).toContain(`<p>${ABOUT}</p>`);
    expect(html).toContain('<code>npx leagueofagents-cli@latest</code>');
  });
  it('describes the page the same way everywhere', () => {
    expect(meta('name="description"')).toBe(DESCRIPTION);
    expect(meta('property="og:description"')).toBe(DESCRIPTION);
    expect(meta('name="twitter:description"')).toBe(DESCRIPTION);
    // The page's title is the product name and the tagline, the same in every place that names the page.
    const title = `League of Agents: ${TAGLINE}`;
    expect(html).toContain(`<title>${title}</title>`);
    expect(meta('property="og:title"')).toBe(title);
    expect(meta('name="twitter:title"')).toBe(title);
  });
  it('carries a website, the app and its author as structured data, with nothing made up', () => {
    expect(ld.map(o => o['@type'])).toEqual(['WebSite', 'SoftwareApplication', 'Person']);
    const app = ld[1]!;
    expect(app.description).toBe(DESCRIPTION);
    expect(app.operatingSystem).toBe('macOS');
    expect(app).not.toHaveProperty('aggregateRating');
    expect(app).not.toHaveProperty('review');
    expect(app.author).toEqual({ '@id': ld[2]!['@id'] });
  });
});
