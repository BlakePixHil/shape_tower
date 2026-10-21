import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));
// Two apps from one codebase: the Wobble Lab (index.html, the default) and the game (game.html).
const app = process.env.ST_APP === 'game' ? 'game' : 'lab';
let rev = 'local';
try { rev = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a checkout */ }

export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  define: { __BUILD__: JSON.stringify(`${rev} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`) },
  resolve: {
    alias: [
      { find: '@art', replacement: at('../art/src') },
      { find: /^@audio$/, replacement: at('../audio/src/index.ts') },
      { find: '@audio', replacement: at('../audio/src') },
    ],
  },
  worker: { format: 'iife' },
  build: {
    target: 'es2022', assetsInlineLimit: 100000000, chunkSizeWarningLimit: 8000,
    outDir: app === 'game' ? 'dist-game' : 'dist',
    rollupOptions: { input: at(app === 'game' ? 'game.html' : 'index.html') },
  },
  server: { host: true, fs: { allow: ['..'] } },
});
