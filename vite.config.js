import { defineConfig } from 'vite';
import { readFileSync, writeFileSync, createReadStream, statSync } from 'fs';
import { resolve, join } from 'path';

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
    name: 'serve-assets-dir',
    configureServer(server) {
      const assetsDir = resolve(__dirname, 'assets');
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith('/assets/')) {
          const fp = join(assetsDir, decodeURIComponent(req.url.slice(8)));
          try {
            if (statSync(fp).isFile()) {
              const ext = fp.split('.').pop().toLowerCase();
              const types = {
                mp4: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg', png: 'image/png',
                jpg: 'image/jpeg', webp: 'image/webp', json: 'application/json',
                js: 'application/javascript', css: 'text/css', svg: 'image/svg+xml',
                atlas: 'text/plain', skel: 'application/octet-stream',
              };
              res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
              createReadStream(fp).pipe(res);
              return;
            }
          } catch {}
        }
        next();
      });
    },
  }, {
    name: 'copy-sw-root',
    // ba-web 的 Service Worker 必須在站點根（scope 涵蓋整個 Pages 子路徑）
    generateBundle() {
      try {
        this.emitFile({
          type: 'asset',
          fileName: 'sw.js',
          source: readFileSync(resolve(__dirname, 'renderer', 'sw.js'), 'utf-8'),
        });
      } catch (e) {
        console.warn('[build] copy sw.js failed:', e.message);
      }
    },
  }, {
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
