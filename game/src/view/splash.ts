// The loading splash (game.html #splash, look in splash.css). It paints with the page before any script
// runs, over the same picture as the phone app's launch screen, and keeps moving on the compositor while
// the game boots. Once the menu is up, the splash's logo glides into the menu's own logo (it is that
// logo, baked) and the sky fades into the live backdrop. It never holds the game back: the menu is
// already live underneath while it leaves.

import { hideLaunchSplash } from '../native.ts';
import { loadSettings } from './settings.ts';

/** MARGIN in scripts/bake-native-assets.mjs: the splash's logo is the menu's, this much wider on each side. */
const MARGIN = 3;

// The phone's launch screen stays up behind the page until this splash has painted over it.
requestAnimationFrame(() => requestAnimationFrame(hideLaunchSplash));
// If the game is still not up after this long, offer a reload (it keeps waiting all the same).
const slow = setTimeout(() => retry('Taking a while… Tap to try again'), 30000);

/** The box around everything the menu's logo draws, measured the way the bake measured it. */
function logoBox(logo: Element): DOMRect | null {
  const rs = [...logo.querySelectorAll('img')].map(i => i.getBoundingClientRect());
  if (!rs.length) return null;
  const x = Math.min(...rs.map(r => r.left)) - MARGIN, y = Math.min(...rs.map(r => r.top)) - MARGIN;
  return new DOMRect(x, y, Math.max(...rs.map(r => r.right)) + MARGIN - x, Math.max(...rs.map(r => r.bottom)) + MARGIN - y);
}

/** The game is up with its menu showing: hand over and leave. */
export function splashDone(): void {
  const sp = document.getElementById('splash');
  if (!sp || sp.classList.contains('out')) return;
  clearTimeout(slow);
  sp.classList.add('out');
  hideLaunchSplash();
  const logo = sp.querySelector<HTMLElement>('.sp-logo')!, sky = sp.querySelector<HTMLElement>('.sp-sky')!;
  const menuLogo = document.querySelector<HTMLElement>('.sc-root .ui-logo');
  // The menu's logo is already on screen as the splash's: it doesn't drop in a second time, and it is
  // measured where it rests, not where its drop-in starts.
  menuLogo?.classList.add('ui-still');
  for (const a of menuLogo?.getAnimations({ subtree: true }) ?? []) try { a.finish(); } catch { /* an endless one */ }
  const to = menuLogo && logoBox(menuLogo);
  const calm = loadSettings().reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (calm || !menuLogo || !to) {
    const fade = sp.animate([{ opacity: 1 }, { opacity: 0 }], { duration: calm ? 220 : 320, easing: 'ease-in', fill: 'forwards' });
    void fade.finished.finally(() => sp.remove());
    return;
  }

  // The glide: up into the menu's logo with a little swell on the way, a squash as it lands (about its
  // foot), then the menu's own logo takes over. That one hides until then, so one logo is on screen.
  const from = logo.getBoundingClientRect(), img = logo.firstElementChild as HTMLElement;
  const dx = to.left + to.width / 2 - (from.left + from.width / 2), dy = to.bottom - from.bottom;
  const s = to.width / from.width;
  menuLogo.style.visibility = 'hidden';
  img.animate([{ transform: getComputedStyle(img).transform }, { transform: 'none' }], { duration: 200, fill: 'forwards' }); // the bob settles
  logo.style.transformOrigin = '50% 100%';
  const glide = logo.animate([
    { transform: 'none', easing: 'cubic-bezier(.5,0,.3,1)' },
    { offset: 0.72, transform: `translate(${dx}px, ${dy - 8}px) scale(${s * 1.06}, ${s * 0.98})`, easing: 'cubic-bezier(.4,0,.6,1)' },
    { offset: 0.86, transform: `translate(${dx}px, ${dy}px) scale(${s * 1.08}, ${s * 0.9})`, easing: 'ease-out' },
    { transform: `translate(${dx}px, ${dy}px) scale(${s})` },
  ], { duration: 520, fill: 'forwards' });
  sky.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 380, delay: 80, easing: 'ease-in-out', fill: 'forwards' });
  const ready = [glide.finished, ...[...menuLogo.querySelectorAll('img')].map(i => i.decode())];
  void Promise.allSettled(ready).then(() => {
    menuLogo.style.visibility = '';
    sp.remove();
  });
}

/** The game didn't start: keep the splash and offer a reload. */
export function splashFailed(err: unknown): void {
  console.error(err);
  clearTimeout(slow);
  retry("Couldn't start. Tap to try again");
}

function retry(text: string): void {
  hideLaunchSplash();
  const sp = document.getElementById('splash');
  if (!sp || sp.classList.contains('out')) return;
  const b = sp.querySelector<HTMLButtonElement>('.sp-retry') ?? sp.appendChild(document.createElement('button'));
  b.className = 'sp-retry';
  b.textContent = text;
  b.onclick = () => location.reload();
}
