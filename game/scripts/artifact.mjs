// Turns the single-file build into the body-only page the claude.ai Artifact tool publishes
// (it wraps pages in its own doctype, head and body).
//   npm run build && node scripts/artifact.mjs [out.html]
//   npm run build:game && node scripts/artifact.mjs out.html dist-game/game.html

import { readFileSync, writeFileSync } from 'node:fs';

const from = process.argv[3] ? new URL(`../${process.argv[3]}`, import.meta.url) : new URL('../dist/index.html', import.meta.url);
const src = readFileSync(from, 'utf8');
const out = process.argv[2] ?? new URL('../dist/artifact.html', import.meta.url).pathname;
const head = src.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? '';
const body = src.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? '';
const title = head.match(/<title>[\s\S]*?<\/title>/)?.[0] ?? '<title>Shape Tower Wobble Lab</title>';
const links = head.match(/<link[^>]*fonts\.(googleapis|gstatic)[^>]*>/g) ?? [];
// Every <style>, with or without attributes: the single-file build inlines linked sheets (the loading
// splash's) as <style rel="stylesheet" crossorigin>.
const styles = head.match(/<style\b[^>]*>[\s\S]*?<\/style>/g) ?? [];
const scripts = head.match(/<script\b[\s\S]*?<\/script>/g) ?? [];
if (!scripts.length) throw new Error(`no inline script found in ${from.pathname}`);
writeFileSync(out, [title, ...links, ...styles, body.trim(), ...scripts].join('\n'));
console.log(`wrote ${out} (${(readFileSync(out).length / 1024).toFixed(0)} KB)`);
