import { defineConfig } from 'vite';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },
  plugins: [{
    name: 'copy-root-index',
    closeBundle() {
      const src = resolve(__dirname, 'dist', 'index.html');
      const dst = resolve(__dirname, 'index.prod.html');
      try {
        let html = readFileSync(src, 'utf-8');
        html = html.split('./assets/').join('./dist/assets/');
        writeFileSync(dst, html);
        console.log('[build] dist/index.html -> index.prod.html');
      } catch (e) {
        console.warn('[build] Failed to copy index.html:', e.message);
      }
    },
  }],
});
