// The run-over card: stats, the XP bar filling up with level-ups, and QA's one-tap questions.

import { levelStep } from '../sim/tuning.ts';
import { statsHtml, type Hud, type RunStats } from './hud.ts';
import type { Award } from './profile.ts';
import { INK } from './palette.ts';

const CSS = `
.st-xp { margin: 10px 0 4px; text-align: left; }
.st-xp-head { display: flex; justify-content: space-between; font: 700 15px 'Fredoka', sans-serif; }
.st-xp-bar { height: 18px; border: 3px solid ${INK}; border-radius: 999px; background: #fff; overflow: hidden; margin-top: 4px; }
.st-xp-fill { height: 100%; width: 0; background: #7A5CFF; border-radius: 999px; }
.st-xp-lines { display: grid; grid-template-columns: 1fr auto; gap: 0 12px; font-size: 13px; color: #5B4F7A; margin-top: 4px; }
.st-xp-lines b { text-align: right; font-family: 'Fredoka', sans-serif; }
.st-lvl { display: inline-block; }
.st-lvl.up { animation: st-pop 400ms; color: #7A5CFF; }
.st-ask p { font-weight: 700; }
.st-ask .st-btn { font-size: 16px; padding: 6px 16px; }
`;

let styled = false;

export interface ResultsOptions {
  stats: RunStats;
  award: Award;
  questions: { id: string; text: string }[];
  onAnswer(id: string, answer: 'yes' | 'no'): void;
  onXpTick(): void;
  onLevelUp(level: number): void;
  onAgain(): void;
  reducedMotion: boolean;
}

export function showResults(hud: Hud, o: ResultsOptions): void {
  if (!styled) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    styled = true;
  }
  const a = o.award;
  const lines = a.lines.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('');
  const html = `${statsHtml(o.stats)}
    <div class="st-xp">
      <div class="st-xp-head"><span class="st-lvl">Level ${a.before.level}</span><span class="st-xp-num">+0 XP</span></div>
      <div class="st-xp-bar"><div class="st-xp-fill"></div></div>
      <div class="st-xp-lines">${lines}</div>
    </div>`;
  hud.card(html, [['Play again', o.onAgain, true]], panel => {
    for (const q of o.questions) {
      const ask = document.createElement('div');
      ask.className = 'st-ask';
      ask.innerHTML = `<p>${q.text}</p>`;
      for (const ans of ['yes', 'no'] as const) {
        const b = document.createElement('button');
        b.className = 'st-btn';
        b.textContent = ans === 'yes' ? 'Yes' : 'No';
        b.onclick = () => { o.onAnswer(q.id, ans); ask.innerHTML = '<p>Thanks!</p>'; };
        ask.appendChild(b);
      }
      panel.appendChild(ask);
    }
    animateXp(panel, o);
  });
}

/** Fills the bar over about 1.2 s, wrapping at each level-up. */
function animateXp(panel: HTMLElement, o: ResultsOptions): void {
  const fill = panel.querySelector<HTMLDivElement>('.st-xp-fill')!;
  const num = panel.querySelector<HTMLSpanElement>('.st-xp-num')!;
  const lvl = panel.querySelector<HTMLSpanElement>('.st-lvl')!;
  const a = o.award;
  let level = a.before.level;
  let into = a.before.xp;
  let shown = 0;
  const total = a.gained;
  const show = () => {
    fill.style.width = `${Math.min(100, (into / levelStep(level)) * 100)}%`;
    num.textContent = `+${Math.round(shown)} XP`;
  };
  if (o.reducedMotion || total <= 0) {
    level = a.after.level; into = a.after.xp; shown = total;
    lvl.textContent = `Level ${level}`;
    show();
    return;
  }
  show();
  const dur = 1200;
  const t0 = performance.now();
  let lastTick = 0;
  const frame = (now: number) => {
    if (!panel.isConnected) return;
    const t = Math.min(1, (now - t0) / dur);
    const target = total * (1 - (1 - t) ** 2);
    let d = target - shown;
    shown = target;
    while (d > 0) {
      const room = levelStep(level) - into;
      if (d < room) { into += d; d = 0; break; }
      d -= room;
      level++;
      into = 0;
      lvl.textContent = `Level ${level}`;
      lvl.classList.remove('up'); void lvl.offsetWidth; lvl.classList.add('up');
      o.onLevelUp(level);
    }
    if (now - lastTick > 70) { lastTick = now; o.onXpTick(); }
    show();
    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
