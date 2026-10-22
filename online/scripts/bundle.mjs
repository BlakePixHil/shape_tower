// Bundles the API and the game's shared rules into one JS file (dist/api/v1.js), with a package.json
// that lets Vercel install @vercel/blob itself, ready to deploy as a project. Run: npm run bundle
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const out = new URL('../dist/', import.meta.url);
await build({
  entryPoints: [new URL('../api/v1.ts', import.meta.url).pathname],
  outfile: new URL('api/v1.js', out).pathname,
  bundle: true, platform: 'node', format: 'esm', target: 'node22', minify: false, legalComments: 'none',
  external: ['@vercel/blob'],
});
const blob = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).dependencies['@vercel/blob'];
writeFileSync(new URL('package.json', out), JSON.stringify({ name: 'shape-tower-api', private: true, type: 'module', engines: { node: '22.x' }, dependencies: { '@vercel/blob': blob } }, null, 2) + '\n');
writeFileSync(new URL('vercel.json', out), JSON.stringify({ functions: { 'api/v1.js': { maxDuration: 10 } } }, null, 2) + '\n');
mkdirSync(new URL('public/', out), { recursive: true });
writeFileSync(new URL('public/index.html', out), '<!doctype html><meta charset="utf-8"><title>Shape Tower API</title><p>Shape Tower ladder API. POST /api/v1</p>\n');
console.log(`bundled ${new URL('.', out).pathname}`);
