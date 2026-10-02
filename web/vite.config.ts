import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Relative asset paths, so the same build works on Vercel and served by the bridge at /.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // CSS ships unminified so the stylesheet is exactly as written (the minifier rewrites values).
  build: { outDir: 'dist', emptyOutDir: true, cssMinify: false },
});
