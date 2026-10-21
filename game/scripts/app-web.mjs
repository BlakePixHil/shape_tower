// Makes dist-app/index.html, the page Capacitor loads, from the single-file game build. The phone
// app must work offline, so Google Fonts' links give way to the two fonts inlined from
// assets/fonts (latin subsets, SIL Open Font License; the licences sit beside them).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const at = p => new URL(p, import.meta.url);
const font = (file, family, weights) => `@font-face { font-family: '${family}'; font-style: normal; font-weight: ${weights}; font-display: block; `
  + `src: url(data:font/woff2;base64,${readFileSync(at(`../assets/fonts/${file}`)).toString('base64')}) format('woff2'); }`;
const fonts = `<style>${font('fredoka-latin.woff2', 'Fredoka', '300 700')}\n${font('nunito-latin.woff2', 'Nunito', '200 1000')}</style>`;

let html = readFileSync(at('../dist-game/game.html'), 'utf8');
const links = /<link rel="(?:preconnect|stylesheet)" href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>\s*/g;
if (!links.test(html)) throw new Error('app-web: Google Fonts links not found in dist-game/game.html');
html = html.replace(links, '').replace('</title>', `</title>\n  ${fonts}`);
mkdirSync(at('../dist-app'), { recursive: true });
writeFileSync(at('../dist-app/index.html'), html);
console.log(`wrote dist-app/index.html (${Math.round(html.length / 1024)} KB)`);
