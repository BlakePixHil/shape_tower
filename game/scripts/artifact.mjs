// Turns the single-file build into the body-only page the claude.ai Artifact tool publishes
// (it wraps pages in its own doctype, head and body).
//   npm run build && node scripts/artifact.mjs [out.html]

import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const out = process.argv[2] ?? new URL('../dist/artifact.html', import.meta.url).pathname;
const head = src.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? '';
const body = src.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? '';
const title = head.match(/<title>[\s\S]*?<\/title>/)?.[0] ?? '<title>Shape Tower Wobble Lab</title>';
const links = head.match(/<link[^>]*fonts\.(googleapis|gstatic)[^>]*>/g) ?? [];
const styles = head.match(/<style>[\s\S]*?<\/style>/g) ?? [];
const scripts = head.match(/<script\b[\s\S]*?<\/script>/g) ?? [];
if (!scripts.length) throw new Error('no inline script found in dist/index.html');
writeFileSync(out, [title, ...links, ...styles, body.trim(), ...scripts].join('\n'));
console.log(`wrote ${out} (${(readFileSync(out).length / 1024).toFixed(0)} KB)`);
