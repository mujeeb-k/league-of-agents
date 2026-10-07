import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { LANGS } from './src/i18n';
import { homePage, privacyPage, type Other } from './src/i18n/pages';

const SITE = 'https://leagueofagents.dev';

/**
 * sitemap.xml, written on every build: the home page, each page in public/ (served without .html, vercel.json's
 * cleanUrls), and the Markdown and text files written for people and agents to read.
 */
function sitemap(): Plugin {
  return {
    name: 'sitemap',
    apply: 'build',
    generateBundle() {
      const pages = readdirSync(new URL('./public', import.meta.url))
        .filter(f => /\.(html|md)$/.test(f) || f === 'llms.txt')
        .sort()
        .map(f => '/' + f.replace(/\.html$/, ''));
      const translated = OTHERS.flatMap(l => [`/${l}/`, `/${l}/privacy`]);
      const urls = ['/', ...pages, ...translated].map(p => `  <url><loc>${SITE}${p}</loc></url>`).join('\n');
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      });
    },
  };
}

const OTHERS = LANGS.map(l => l.code).filter((c): c is Other => c !== 'en');

/** The homepage and privacy page in each other language, under its own path (/fr/ and /fr/privacy): i18n/pages.ts. */
function langPages(): Plugin {
  const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));
  return {
    name: 'lang-pages',
    apply: 'build',
    // After the build is written, so the homepage is the built one, with its scripts.
    closeBundle() {
      const home = readFileSync(at('./dist/index.html'), 'utf8'),
        privacy = readFileSync(at('./public/privacy.html'), 'utf8');
      for (const lang of OTHERS) {
        mkdirSync(at(`./dist/${lang}`), { recursive: true });
        writeFileSync(at(`./dist/${lang}/index.html`), homePage(home, lang));
        const body = readFileSync(at(`./src/i18n/privacy/${lang}.html`), 'utf8');
        writeFileSync(at(`./dist/${lang}/privacy.html`), privacyPage(privacy, lang, body));
      }
    },
  };
}

// Relative asset paths, so the same build works on Vercel and served by the bridge at /.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), sitemap(), langPages()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // CSS ships unminified so the stylesheet is exactly as written (the minifier rewrites values).
  build: { outDir: 'dist', emptyOutDir: true, cssMinify: false },
});
