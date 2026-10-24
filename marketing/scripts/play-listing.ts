// Puts the store listing on Google Play: the words for en-AU (the default language), en-GB and en-US
// (listing/text.ts), the icon, the feature graphic and the eight phone screenshots, all in one edit.
// --dry checks everything and uploads into an edit that's then thrown away, so nothing changes.
//
//   node --experimental-strip-types scripts/play-listing.ts [--dry] [--shots <folder>] [--video <YouTube URL>]
//
// The images: Art's store icon and feature graphic (/mnt/project-files/store/play-games/), and the
// screenshots from scripts/listing-shots.ts (/mnt/project-files/marketing/listing/screenshots/).
// Play takes a listing video only as a YouTube link, so it goes up once there is one.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API, UPLOAD, call, withEdit } from '../src/play.ts';
import { LISTING, checkListing } from '../listing/text.ts';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const dry = args.includes('--dry');
const SHOTS = flag('--shots') ?? '/mnt/project-files/marketing/listing/screenshots';
const STORE = '/mnt/project-files/store/play-games';
const video = flag('--video');
if (video && !/^https:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+/.test(video)) throw new Error(`--video ${video} isn't a YouTube link`);

for (const [lang, t] of Object.entries(LISTING)) {
  const bad = checkListing(t);
  if (bad.length) throw new Error(`${lang}: ${bad.join('; ')}`);
}

/** A copy with no alpha channel (Play refuses one in the feature graphic and screenshots). */
const tmp = mkdtempSync(join(tmpdir(), 'listing-'));
function opaque(src: string): Buffer {
  const out = join(tmp, `${readdirSync(tmp).length}.png`);
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-pix_fmt', 'rgb24', out], { encoding: 'utf8' });
  if (ff.status !== 0) throw new Error(`ffmpeg: ${ff.stderr}`);
  return readFileSync(out);
}
function size(png: Buffer): [number, number] { return [png.readUInt32BE(16), png.readUInt32BE(20)]; }

const icon = readFileSync(join(STORE, 'icon-512.png'));
const feature = opaque(join(STORE, 'feature-1024x500.png'));
const shotFiles = readdirSync(SHOTS).filter(f => /^\d-.*\.png$/.test(f)).sort();
if (shotFiles.length !== 8) throw new Error(`expected 8 screenshots in ${SHOTS}, found ${shotFiles.length}`);
const shots = shotFiles.map(f => opaque(join(SHOTS, f)));
// Play's rules: icon 512 x 512; feature graphic 1024 x 500; screenshots 320-3840 px, long side at most twice the short, 8 MB each.
if (size(icon).join() !== '512,512') throw new Error('icon must be 512 x 512');
if (size(feature).join() !== '1024,500') throw new Error('feature graphic must be 1024 x 500');
for (const [i, s] of shots.entries()) {
  const [w, h] = size(s);
  if (Math.min(w, h) < 320 || Math.max(w, h) > 3840 || Math.max(w, h) > 2 * Math.min(w, h) || s.length > 8e6) throw new Error(`${shotFiles[i]} breaks Play's screenshot rules (${w} x ${h}, ${s.length} bytes)`);
}

type Kind = 'icon' | 'featureGraphic' | 'phoneScreenshots';
const report: string[] = [];
try {
  await withEdit(async (auth, edit) => {
    const base = `${API}/edits/${edit}/listings`;
    for (const [lang, t] of Object.entries(LISTING)) {
      await call(auth, 'PUT', `${base}/${lang}`, { language: lang, title: t.title, shortDescription: t.shortDescription, fullDescription: t.fullDescription, ...(video ? { video } : {}) });
      const put = async (kind: Kind, images: Buffer[]) => {
        await call(auth, 'DELETE', `${base}/${lang}/${kind}`);
        for (const img of images) await call(auth, 'POST', `${UPLOAD}/edits/${edit}/listings/${lang}/${kind}?uploadType=media`, img, 'image/png');
      };
      await put('icon', [icon]);
      await put('featureGraphic', [feature]);
      await put('phoneScreenshots', shots);
      const got = await call<{ images?: unknown[] }>(auth, 'GET', `${base}/${lang}/phoneScreenshots`);
      report.push(`${lang}: "${t.title}", short and full description${video ? ', video' : ''}, icon, feature graphic, ${got.images?.length ?? 0} phone screenshots`);
    }
  }, !dry);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(report.join('\n'));
console.log(dry ? 'dry run: the edit was thrown away, nothing changed on Play' : 'committed: the listing is on Play');
console.log(`screenshots: ${shotFiles.join(', ')} (${shotFiles.map(f => `${Math.round(statSync(join(SHOTS, f)).size / 1024)} KB`).join(', ')})`);
