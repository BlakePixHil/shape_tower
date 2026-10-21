// The game's screens (design doc "UI and screens"): main menu, pause, settings, profile, the
// run-over summary with its XP tally, and the level-up takeover. DOM over the canvas, in the
// sticker-toy style. Plain placeholders for now: Art's UI kit replaces the markup and CSS piece by
// piece, and the flow here stays the same.

import { levelStep } from '../sim/tuning.ts';
import { UNLOCKS, type Award, type Profile } from './profile.ts';
import type { PlayerSettings } from './settings.ts';
import { CONFETTI, GOLD, INK, INK_SOFT, MINT, PAPER, XP_VIOLET, hex } from './palette.ts';

export type UiSound = 'tap' | 'tap2' | 'back' | 'toggleOn' | 'toggleOff' | 'slider' | 'tab' | 'open' | 'close' | 'error' | 'pause' | 'resume' | 'start' | 'badge' | 'unlock';

export interface ScreenSounds {
  ui(kind: UiSound): void;
  xpTick(): void;
  levelUp(level: number): void;
}

const CSS = `
.sc-root { position: fixed; inset: 0; z-index: 9; display: none; font-family: 'Nunito', system-ui, sans-serif; color: ${INK}; -webkit-user-select: none; user-select: none; }
.sc-root.show { display: block; }
.sc-root * { box-sizing: border-box; }
.sc-dim { background: rgba(34,24,58,0.55); }
.sc-fill { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; padding: calc(env(safe-area-inset-top, 0px) + 14px) 16px calc(env(safe-area-inset-bottom, 0px) + 18px); overflow-y: auto; }
.sc-center > * { margin-top: auto; margin-bottom: auto; } /* centred, and scrolls from the top when too tall */
.sc-btn { pointer-events: auto; background: ${PAPER}; border: 3px solid ${INK}; border-radius: 16px; box-shadow: 0 4px 0 ${INK}; font: 600 18px 'Fredoka', system-ui, sans-serif; color: ${INK}; padding: 8px 18px; cursor: pointer; transition: transform 80ms, box-shadow 80ms; touch-action: manipulation; }
.sc-btn:active { transform: translateY(4px); box-shadow: 0 0 0 ${INK}; }
.sc-big { background: ${GOLD}; font-size: 26px; padding: 12px 40px; border-radius: 18px; }
.sc-icon { width: 46px; height: 46px; padding: 0; display: grid; place-items: center; font-size: 22px; }
.sc-panel { background: ${PAPER}; border: 3px solid ${INK}; border-radius: 18px; box-shadow: 0 6px 0 ${INK}; padding: 18px; width: min(360px, 100%); text-align: center; animation: sc-up 320ms cubic-bezier(.2,1.4,.4,1); }
.sc-panel h2 { font: 700 26px 'Fredoka', sans-serif; margin: 0 0 6px; }
.sc-panel p { margin: 6px 0; font-size: 15px; }
.sc-col { display: flex; flex-direction: column; gap: 10px; align-items: stretch; margin-top: 10px; }
.sc-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-top: 10px; }
.sc-note { font-size: 13px; color: ${INK_SOFT}; }
@keyframes sc-up { 0% { transform: translateY(60px); opacity: 0; } 100% { transform: none; opacity: 1; } }
@keyframes sc-pop { 0% { transform: scale(0); } 70% { transform: scale(1.2); } 100% { transform: scale(1); } }

.sc-top { width: 100%; display: flex; justify-content: space-between; align-items: center; }
.sc-chip { display: flex; gap: 8px; align-items: center; padding: 4px 12px 4px 4px; font-size: 15px; }
.sc-badge { width: 40px; height: 40px; border-radius: 50%; background: ${XP_VIOLET}; color: #fff; border: 3px solid ${INK}; display: grid; place-items: center; font: 700 18px 'Fredoka', sans-serif; flex: none; }
.sc-chip b { display: block; font: 700 15px 'Fredoka', sans-serif; text-align: left; }
.sc-mini { display: block; width: 70px; height: 8px; border: 2px solid ${INK}; border-radius: 99px; background: #fff; overflow: hidden; margin-top: 2px; }
.sc-mini i { display: block; height: 100%; background: ${XP_VIOLET}; }

.sc-logo { margin: 8vh 0 0; font: 700 54px/0.95 'Fredoka', sans-serif; color: #fff; -webkit-text-stroke: 5px ${INK}; paint-order: stroke fill; text-align: center; letter-spacing: 0.02em; }
.sc-logo .w { display: block; white-space: nowrap; }
.sc-logo span { display: inline-block; animation: sc-drop 620ms cubic-bezier(.3,.7,.4,1) both; }
@keyframes sc-drop { 0% { transform: translateY(-70vh); } 55% { transform: translateY(0) scale(1.15, 0.75); } 75% { transform: translateY(-10px) scale(0.95, 1.06); } 100% { transform: none; } }
.sc-tag { font: 700 15px 'Fredoka', sans-serif; color: #fff; -webkit-text-stroke: 3px ${INK}; paint-order: stroke fill; margin-top: 8px; }
.sc-menu-bottom { margin-top: auto; display: flex; flex-direction: column; align-items: center; gap: 12px; width: 100%; }
.sc-modes { display: flex; gap: 10px; width: min(360px, 100%); }
.sc-mode { flex: 1; background: rgba(255,247,232,0.92); border: 3px solid ${INK}; border-radius: 14px; box-shadow: 0 4px 0 ${INK}; padding: 8px; text-align: center; font: 700 16px 'Fredoka', sans-serif; }
.sc-mode small { display: block; font: 700 12px 'Nunito', sans-serif; color: ${INK_SOFT}; margin-top: 2px; }
.sc-mode.locked { opacity: 0.8; }
.sc-build { font-size: 11px; color: rgba(34,24,58,0.6); }

.sc-stats { display: grid; grid-template-columns: 1fr auto; gap: 3px 14px; text-align: left; margin: 10px 0; font-size: 15px; }
.sc-stats b { font-family: 'Fredoka', sans-serif; text-align: right; font-variant-numeric: tabular-nums; }
.sc-height { font: 700 46px 'Fredoka', sans-serif; line-height: 1; margin: 4px 0; font-variant-numeric: tabular-nums; }
.sc-height small { font-size: 22px; }
.sc-best { display: inline-block; background: ${GOLD}; border: 3px solid ${INK}; border-radius: 10px; font: 700 13px 'Fredoka', sans-serif; padding: 0 8px; transform: rotate(-4deg); animation: sc-pop 400ms 300ms both; }
.sc-biome { font: 700 15px 'Fredoka', sans-serif; color: ${INK_SOFT}; }
.sc-xp { margin: 10px 0 4px; text-align: left; }
.sc-xp-head { display: flex; justify-content: space-between; font: 700 15px 'Fredoka', sans-serif; }
.sc-bar { height: 18px; border: 3px solid ${INK}; border-radius: 99px; background: #fff; overflow: hidden; margin-top: 4px; }
.sc-bar i { display: block; height: 100%; width: 0; background: ${XP_VIOLET}; border-radius: 99px; }
.sc-lines { display: grid; grid-template-columns: 1fr auto; gap: 0 12px; font-size: 13px; color: ${INK_SOFT}; margin-top: 4px; }
.sc-lines span, .sc-lines b { opacity: 0; transition: opacity 200ms; }
.sc-lines .on { opacity: 1; }
.sc-lines b { text-align: right; font-family: 'Fredoka', sans-serif; }
.sc-ask { margin-top: 10px; padding-top: 10px; border-top: 2px dashed rgba(34,24,58,0.25); }
.sc-ask p { font-weight: 700; }
.sc-ask .sc-btn { font-size: 16px; padding: 4px 18px; margin: 0 4px; }
.sc-ask .sc-face { font-size: 24px; padding: 2px 6px; margin: 0 2px; }
.sc-testing { background: rgba(255,247,232,0.92); border: 2px solid ${INK}; border-radius: 10px; font: 700 13px 'Nunito', sans-serif; padding: 4px 10px; max-width: 340px; text-align: center; }

.sc-list { width: min(380px, 100%); display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
.sc-group { background: ${PAPER}; border: 3px solid ${INK}; border-radius: 16px; box-shadow: 0 4px 0 ${INK}; padding: 10px 14px; text-align: left; }
.sc-group h3 { font: 700 16px 'Fredoka', sans-serif; margin: 0 0 6px; }
.sc-set { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 40px; font-size: 15px; }
.sc-set input[type=range] { width: 46%; accent-color: ${XP_VIOLET}; }
.sc-switch { width: 52px; height: 30px; border-radius: 99px; border: 3px solid ${INK}; background: #ddd; position: relative; padding: 0; cursor: pointer; flex: none; }
.sc-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; border-radius: 50%; background: #fff; border: 2px solid ${INK}; transition: left 120ms; }
.sc-switch[aria-pressed=true] { background: ${MINT}; }
.sc-switch[aria-pressed=true]::after { left: 24px; }
.sc-seg { display: flex; border: 3px solid ${INK}; border-radius: 12px; overflow: hidden; flex: none; }
.sc-seg button { border: 0; background: #fff; font: 600 14px 'Fredoka', sans-serif; padding: 4px 10px; color: ${INK}; cursor: pointer; }
.sc-seg button + button { border-left: 2px solid ${INK}; }
.sc-seg button[aria-pressed=true] { background: ${GOLD}; }
.sc-head { width: min(380px, 100%); display: flex; align-items: center; gap: 12px; }
.sc-head h2 { font: 700 28px 'Fredoka', sans-serif; margin: 0; color: #fff; -webkit-text-stroke: 4px ${INK}; paint-order: stroke fill; }
.sc-unlock { display: flex; gap: 10px; align-items: center; font-size: 14px; }
.sc-unlock b { font-family: 'Fredoka', sans-serif; font-size: 15px; }
.sc-unlock .lv { flex: none; width: 54px; text-align: center; font: 700 12px 'Fredoka', sans-serif; border: 2px solid ${INK}; border-radius: 8px; padding: 2px 0; background: #fff; }
.sc-unlock.open .lv { background: ${MINT}; }

.sc-rays { position: absolute; inset: -50%; background: repeating-conic-gradient(from 0deg, rgba(255,194,61,0.55) 0deg 10deg, rgba(255,247,232,0) 10deg 20deg); animation: sc-spin 9s linear infinite; }
@keyframes sc-spin { to { transform: rotate(360deg); } }
.sc-lvl { position: relative; display: flex; flex-direction: column; align-items: center; gap: 14px; }
.sc-lvl h2 { font: 700 40px 'Fredoka', sans-serif; margin: 0; color: #fff; -webkit-text-stroke: 5px ${INK}; paint-order: stroke fill; animation: sc-pop 400ms both; }
.sc-flip { width: 120px; height: 120px; perspective: 600px; }
.sc-flip .sc-badge { width: 120px; height: 120px; font-size: 54px; border-width: 5px; box-shadow: 0 6px 0 ${INK}; animation: sc-turn 900ms 200ms both; }
@keyframes sc-turn { 0% { transform: rotateY(0); } 50% { transform: rotateY(90deg); } 100% { transform: rotateY(0); } }
.sc-confetti { position: absolute; top: -20px; width: 10px; height: 14px; border: 2px solid ${INK}; border-radius: 3px; animation: sc-fall linear both; }
@keyframes sc-fall { to { transform: translateY(110vh) rotate(720deg); } }
.sc-card { background: ${PAPER}; border: 3px solid ${INK}; border-radius: 16px; box-shadow: 0 5px 0 ${INK}; padding: 12px 16px; width: min(320px, 90vw); text-align: center; animation: sc-up 400ms 600ms both; }
.sc-card b { display: block; font: 700 20px 'Fredoka', sans-serif; }
`;

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export interface SummaryStats {
  cause: string;
  height: number;
  newBest: boolean;
  biome: string;
  checkpoints: number;
  perfects: number;
  rows: number;
  clutches: number;
  score: number;
}

export interface SummaryOptions {
  stats: SummaryStats;
  award: Award;
  /** One-tap prompts for QA, in order. 'faces' is five faces stored as 1 to 5. */
  questions: { id: string; text: string; kind?: 'yesno' | 'faces' }[];
  onAnswer(id: string, answer: string | number): void;
  onAgain(): void;
  onProfile(): void;
  onHome(): void;
  reducedMotion: boolean;
}

export class Screens {
  readonly root: HTMLDivElement;
  private name = '';

  constructor(parent: HTMLElement, private sounds: ScreenSounds) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.className = 'sc-root';
    parent.appendChild(this.root);
  }

  /** Which screen is showing ('' when none). */
  get current(): string { return this.name; }

  close(): void {
    this.root.classList.remove('show', 'sc-dim');
    this.root.innerHTML = '';
    this.name = '';
  }

  private open(name: string, html: string, dim: boolean): HTMLDivElement {
    this.name = name;
    this.root.innerHTML = html;
    this.root.classList.add('show');
    this.root.classList.toggle('sc-dim', dim);
    return this.root as HTMLDivElement;
  }

  /** Wires every [data-act] button to its handler, with a tap sound. */
  private acts(el: HTMLElement, handlers: Record<string, () => void>, sound: UiSound = 'tap'): void {
    el.querySelectorAll<HTMLButtonElement>('[data-act]').forEach(b => {
      const fn = handlers[b.dataset.act!];
      if (fn) b.onclick = () => { this.sounds.ui(b.dataset.sound as UiSound ?? sound); fn(); };
    });
  }

  // ---------------------------------------------------------------- main menu

  menu(o: { profile: Profile; build: string; note?: string; onPlay(): void; onProfile(): void; onSettings(): void }): void {
    const p = o.profile;
    const letters = (w: string, from: number) => [...w].map((c, i) => `<span style="animation-delay:${(from + i) * 70}ms">${c}</span>`).join('');
    const mode = (name: string, level: number) => p.level >= level
      ? `<div class="sc-mode">${name}<small>Coming in the next build</small></div>`
      : `<div class="sc-mode locked">${name}<small>🔒 Level ${level}</small></div>`;
    const el = this.open('menu', `
      <div class="sc-fill">
        <div class="sc-top">
          <button class="sc-btn sc-chip" data-act="profile" aria-label="Profile">${badge(p.level)}<span><b>Level ${p.level}</b>${mini(p)}</span></button>
          <button class="sc-btn sc-icon" data-act="settings" aria-label="Settings">⚙</button>
        </div>
        <h1 class="sc-logo"><span class="w">${letters('SHAPE', 0)}</span><span class="w">${letters('TOWER', 5)}</span></h1>
        <div class="sc-tag">How high can you stack?</div>
        <div class="sc-menu-bottom">
          ${o.note ? `<div class="sc-testing">${esc(o.note)}</div>` : ''}
          <button class="sc-btn sc-big" data-act="play" data-sound="start">Play</button>
          <div class="sc-modes">${mode('Daily Tower', 3)}${mode('Zen', 8)}</div>
          <div class="sc-build">build ${esc(o.build)}</div>
        </div>
      </div>`, false);
    this.acts(el, { play: o.onPlay, profile: o.onProfile, settings: o.onSettings }, 'open');
  }

  // ---------------------------------------------------------------- pause

  pause(o: { onResume(): void; onRestart(): void; onSettings(): void; onQuit(): void }): void {
    const el = this.open('pause', `
      <div class="sc-fill sc-center"><div class="sc-panel">
        <h2>Paused</h2>
        <div class="sc-col">
          <button class="sc-btn sc-big" data-act="resume" data-sound="resume">Resume</button>
          <button class="sc-btn" data-act="restart">Restart</button>
          <button class="sc-btn" data-act="settings" data-sound="open">Settings</button>
          <button class="sc-btn" data-act="quit" data-sound="back">Quit</button>
        </div>
        <p class="sc-note">Quitting halves this run's XP.</p>
      </div></div>`, true);
    this.acts(el, { resume: o.onResume, restart: o.onRestart, settings: o.onSettings, quit: o.onQuit });
  }

  // ---------------------------------------------------------------- settings

  settings(s: PlayerSettings, onChange: (s: PlayerSettings) => void, onBack: () => void): void {
    const sw = (key: keyof PlayerSettings, label: string) =>
      `<div class="sc-set"><span>${label}</span><button class="sc-switch" data-key="${key}" aria-pressed="${!!s[key]}" aria-label="${label}"></button></div>`;
    const range = (key: keyof PlayerSettings, label: string, min: number, max: number, step: number) =>
      `<div class="sc-set"><span>${label}</span><input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}" aria-label="${label}"></div>`;
    const seg = (key: keyof PlayerSettings, label: string, opts: [string, string][]) =>
      `<div class="sc-set"><span>${label}</span><div class="sc-seg" data-key="${key}">${opts.map(([v, t]) => `<button data-v="${v}" aria-pressed="${s[key] === v}">${t}</button>`).join('')}</div></div>`;
    const el = this.open('settings', `
      <div class="sc-fill">
        <div class="sc-head"><button class="sc-btn sc-icon" data-act="back" data-sound="back" aria-label="Back">←</button><h2>Settings</h2></div>
        <div class="sc-list">
          <div class="sc-group"><h3>Controls</h3>
            ${sw('splitTap', 'Tap left or right side to rotate that way')}
            ${range('sensitivity', 'Drag sensitivity', 0.75, 1.5, 0.05)}
          </div>
          <div class="sc-group"><h3>Landing guide</h3>
            ${range('guideOpacity', 'Guide opacity', 0.5, 1.5, 0.05)}
          </div>
          <div class="sc-group"><h3>Comfort</h3>
            ${seg('shake', 'Screen shake', [['off', 'Off'], ['low', 'Low'], ['full', 'Full']])}
            ${sw('reduceMotion', 'Reduce motion')}
            ${sw('faces', 'Block faces')}
          </div>
          <div class="sc-group"><h3>Sound and haptics</h3>
            ${range('music', 'Music', 0, 1, 0.05)}
            ${range('sfx', 'Effects', 0, 1, 0.05)}
            ${range('voices', 'Voices', 0, 1, 0.05)}
            ${seg('haptics', 'Haptics', [['off', 'Off'], ['light', 'Light'], ['full', 'Full']])}
          </div>
        </div>
      </div>`, true);
    const set = (key: string, v: unknown) => { (s as unknown as Record<string, unknown>)[key] = v; onChange(s); };
    el.querySelectorAll<HTMLButtonElement>('.sc-switch').forEach(b => {
      b.onclick = () => {
        const on = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(on));
        this.sounds.ui(on ? 'toggleOn' : 'toggleOff');
        set(b.dataset.key!, on);
      };
    });
    el.querySelectorAll<HTMLInputElement>('input[type=range]').forEach(r => {
      r.oninput = () => set(r.dataset.key!, Number(r.value));
      r.onchange = () => this.sounds.ui('slider');
    });
    el.querySelectorAll<HTMLDivElement>('.sc-seg').forEach(g => {
      g.querySelectorAll<HTMLButtonElement>('button').forEach(b => {
        b.onclick = () => {
          g.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
          this.sounds.ui('tab');
          set(g.dataset.key!, b.dataset.v);
        };
      });
    });
    this.acts(el, { back: onBack }, 'back');
  }

  // ---------------------------------------------------------------- profile

  profile(p: Profile, onBack: () => void): void {
    const st = p.stats;
    const unlocks = UNLOCKS.map(u => `<div class="sc-unlock${p.level >= u.level ? ' open' : ''}"><span class="lv">${p.level >= u.level ? '✓' : '🔒'} Lv ${u.level}</span><span><b>${u.name}</b>${u.text}</span></div>`).join('');
    const el = this.open('profile', `
      <div class="sc-fill">
        <div class="sc-head"><button class="sc-btn sc-icon" data-act="back" data-sound="back" aria-label="Back">←</button><h2>Profile</h2></div>
        <div class="sc-list">
          <div class="sc-group" style="text-align:center">
            <div style="display:flex;gap:12px;align-items:center">${badge(p.level, 64)}<div style="flex:1;text-align:left">
              <b style="font:700 22px Fredoka">Level ${p.level}</b>
              <div class="sc-bar"><i style="width:${Math.min(100, (p.xp / levelStep(p.level)) * 100).toFixed(1)}%"></i></div>
              <div class="sc-note">${p.xp.toLocaleString()} / ${levelStep(p.level).toLocaleString()} XP to level ${p.level + 1}</div>
            </div></div>
          </div>
          <div class="sc-group"><h3>Your towers</h3><div class="sc-stats" style="margin:0">
            <span>Best height</span><b>${st.bestHeight.toFixed(1)} m</b>
            <span>Highest biome</span><b>${esc(BIOME_NAMES[st.bestBiome - 1] ?? 'Meadow')}</b>
            <span>Runs</span><b>${p.runs}</b>
            <span>Day streak</span><b>${p.streak}</b>
            <span>Checkpoints claimed</span><b>${st.checkpoints}</b>
            <span>Bricks placed</span><b>${st.bricks.toLocaleString()}</b>
            <span>Perfects</span><b>${st.perfects}</b>
            <span>Solid Rows</span><b>${st.rows}</b>
            <span>Clutch saves</span><b>${st.clutches}</b>
          </div></div>
          <div class="sc-group"><h3>Unlocks</h3><div class="sc-col" style="margin:0;gap:8px">${unlocks}</div></div>
        </div>
      </div>`, true);
    this.acts(el, { back: onBack }, 'back');
  }

  // ---------------------------------------------------------------- run over

  /** The summary card: stats, then the XP lines tick in while the bar fills. A level-up takes over and hands back. */
  summary(o: SummaryOptions): void {
    const s = o.stats, a = o.award;
    const causes: Record<string, string> = { bricks: 'Out of bricks!', hearts: 'Out of hearts!', quit: 'You quit' };
    const lines = a.lines.map(([k, v]) => `<span>${esc(k)}</span><b>${esc(v)}</b>`).join('');
    const el = this.open('summary', `
      <div class="sc-fill sc-center"><div class="sc-panel">
        <h2>${causes[s.cause] ?? 'Run over'}</h2>
        <div class="sc-height">${s.height.toFixed(1)}<small> m</small></div>
        ${s.newBest ? '<div class="sc-best">NEW BEST!</div>' : ''}
        <div class="sc-biome">Reached ${esc(s.biome)}</div>
        <div class="sc-stats">
          <span>Checkpoints</span><b>${s.checkpoints}</b>
          <span>Perfects</span><b>${s.perfects}</b>
          <span>Solid Rows</span><b>${s.rows}</b>
          <span>Clutch saves</span><b>${s.clutches}</b>
          <span>Score</span><b>${Math.round(s.score).toLocaleString()}</b>
        </div>
        <div class="sc-xp">
          <div class="sc-xp-head"><span class="sc-lv">Level ${a.before.level}</span><span class="sc-xpn">+0 XP</span></div>
          <div class="sc-bar"><i></i></div>
          <div class="sc-lines">${lines}</div>
        </div>
        <div class="sc-asks"></div>
        <div class="sc-row">
          <button class="sc-btn sc-big" data-act="again" data-sound="start">Play again</button>
        </div>
        <div class="sc-row">
          <button class="sc-btn" data-act="profile" data-sound="open">Profile</button>
          <button class="sc-btn" data-act="home" data-sound="back">Home</button>
        </div>
      </div></div>`, true);
    this.acts(el, { again: o.onAgain, profile: o.onProfile, home: o.onHome });
    const asks = el.querySelector<HTMLDivElement>('.sc-asks')!;
    for (const q of o.questions) {
      const ask = document.createElement('div');
      ask.className = 'sc-ask';
      ask.innerHTML = `<p>${esc(q.text)}</p>`;
      const answers: [string, string | number][] = q.kind === 'faces'
        ? ['😖', '😕', '😐', '🙂', '😄'].map((f, i) => [f, i + 1])
        : [['Yes', 'yes'], ['No', 'no']];
      for (const [label, ans] of answers) {
        const b = document.createElement('button');
        b.className = 'sc-btn' + (q.kind === 'faces' ? ' sc-face' : '');
        b.textContent = label;
        b.setAttribute('aria-label', q.kind === 'faces' ? `${ans} of 5` : label);
        b.onclick = () => { this.sounds.ui('tap'); o.onAnswer(q.id, ans); ask.innerHTML = '<p>Thanks!</p>'; };
        ask.appendChild(b);
      }
      asks.appendChild(ask);
    }
    this.sounds.ui('open');
    this.tally(el, o);
  }

  /** XP lines appear one at a time while the bar fills, wrapping at each level. */
  private tally(el: HTMLElement, o: SummaryOptions): void {
    const fill = el.querySelector<HTMLElement>('.sc-bar i')!;
    const num = el.querySelector<HTMLElement>('.sc-xpn')!;
    const lvl = el.querySelector<HTMLElement>('.sc-lv')!;
    const cells = [...el.querySelectorAll<HTMLElement>('.sc-lines > *')];
    const a = o.award;
    let level = a.before.level, into = a.before.xp, shown = 0;
    const total = a.gained;
    const show = () => {
      fill.style.width = `${Math.min(100, (into / levelStep(level)) * 100)}%`;
      num.textContent = `+${Math.round(shown)} XP`;
      lvl.textContent = `Level ${level}`;
    };
    const finish = () => {
      level = a.after.level; into = a.after.xp; shown = total;
      cells.forEach(c => c.classList.add('on'));
      show();
      if (a.levelsGained > 0 && this.name === 'summary') {
        const keep = [...this.root.childNodes];
        this.levelUp(a.before.level, a.after.level, () => {
          // Hand back to the summary as it was.
          this.root.innerHTML = '';
          this.root.append(...keep);
          this.name = 'summary';
          this.root.classList.add('sc-dim');
        });
      }
    };
    if (o.reducedMotion || total <= 0) { finish(); return; }
    show();
    const lineMs = 260, dur = Math.max(1200, cells.length / 2 * lineMs + 400);
    const t0 = performance.now();
    let lastTick = 0;
    const frame = (now: number) => {
      if (!el.isConnected || this.name !== 'summary') return;
      const t = Math.min(1, (now - t0) / dur);
      for (let i = 0; i < cells.length; i++) if (now - t0 >= Math.floor(i / 2) * lineMs) cells[i].classList.add('on');
      const target = total * (1 - (1 - t) ** 2);
      let d = target - shown;
      shown = target;
      while (d > 0) {
        const room = levelStep(level) - into;
        if (d < room) { into += d; break; }
        d -= room;
        level++;
        into = 0;
      }
      if (now - lastTick > 70) { lastTick = now; this.sounds.xpTick(); }
      show();
      if (t < 1) requestAnimationFrame(frame); else finish();
    };
    requestAnimationFrame(frame);
  }

  /** The level-up takeover: rays, the badge flipping to the new number, confetti and the unlock card. */
  levelUp(from: number, to: number, done: () => void): void {
    const unlocked = UNLOCKS.filter(u => u.level > from && u.level <= to);
    const confetti = Array.from({ length: 36 }, (_, i) => {
      const c = hex(CONFETTI[i % CONFETTI.length]);
      return `<i class="sc-confetti" style="left:${(i * 37) % 100}%;background:${c};animation-duration:${1.6 + ((i * 13) % 10) / 10}s;animation-delay:${((i * 7) % 10) / 20}s"></i>`;
    }).join('');
    const cards = unlocked.map(u => `<div class="sc-card"><span class="sc-note">Unlocked</span><b>${u.name}</b>${u.text}</div>`).join('');
    const el = this.open('levelup', `
      <div style="position:absolute;inset:0;overflow:hidden;background:rgba(34,24,58,0.7)"><div class="sc-rays"></div>${confetti}</div>
      <div class="sc-fill sc-center"><div class="sc-lvl">
        <h2>LEVEL UP!</h2>
        <div class="sc-flip">${badge(to, 120)}</div>
        ${cards}
        <button class="sc-btn sc-big" data-act="go" style="animation:sc-up 300ms 900ms both">Nice!</button>
      </div></div>`, false);
    this.sounds.levelUp(to);
    if (unlocked.length) setTimeout(() => this.sounds.ui('unlock'), 700);
    this.acts(el, { go: done });
  }
}

const BIOME_NAMES = ['Meadow', 'Treetops', 'Cloudlands', 'Storm Belt', 'Stratosphere', 'Orbit', 'Moon', 'Red Planet', 'Ringed Giant', 'Deep Cosmos'];

function badge(level: number, size = 40): string {
  const style = size === 40 ? '' : ` style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px"`;
  return `<span class="sc-badge"${style}>${level}</span>`;
}

function mini(p: Profile): string {
  return `<i class="sc-mini"><i style="width:${Math.min(100, (p.xp / levelStep(p.level)) * 100).toFixed(1)}%"></i></i>`;
}
