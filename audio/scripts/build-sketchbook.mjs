// Builds the Sound Sketchbook into one self-contained HTML page:
// node scripts/build-sketchbook.mjs [out.html]   (default dist/sketchbook.html)
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(process.argv[2] ?? join(root, 'dist', 'sketchbook.html'));

const worker = await build({
  entryPoints: [join(root, 'src/bake/worker.ts')],
  bundle: true, format: 'iife', target: 'es2020', minify: true, write: false, logLevel: 'warning',
});
const main = await build({
  entryPoints: [join(root, 'sketchbook/main.ts')],
  bundle: true, format: 'iife', target: 'es2020', minify: true, write: false, logLevel: 'warning',
  define: { __BAKE_WORKER__: JSON.stringify(worker.outputFiles[0].text) },
});
// keep "</script" out of the inline bundle
const js = main.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const page = readFileSync(join(root, 'sketchbook/page.html'), 'utf8').replace('/*BUNDLE*/', () => js);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`sketchbook: ${out} (${(page.length / 1024).toFixed(0)} KB)`);
