import { readdirSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

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
      const urls = ['/', ...pages].map(p => `  <url><loc>${SITE}${p}</loc></url>`).join('\n');
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      });
    },
  };
}

// Relative asset paths, so the same build works on Vercel and served by the bridge at /.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), sitemap()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // CSS ships unminified so the stylesheet is exactly as written (the minifier rewrites values).
  build: { outDir: 'dist', emptyOutDir: true, cssMinify: false },
});
