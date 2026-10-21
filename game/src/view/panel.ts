// The Wobble Lab tuning panel: sliders for gameplay.md §14, plus toggles. Saved per device.

import { DEFAULT_TUNING, type Tuning } from '../sim/tuning.ts';
import { INK } from './palette.ts';

export interface ViewSettings {
  reducedMotion: boolean;
  shake: number;       // 0 off, 0.5 low, 1 full
  faces: boolean;
  splitTap: boolean;
  ghostTint: boolean;
}

export const DEFAULT_VIEW: ViewSettings = { reducedMotion: false, shake: 1, faces: true, splitTap: false, ghostTint: true };

export interface LabState {
  tuning: Partial<Tuning>;
  view: ViewSettings;
  /** Second Wind ready at the start of every run: stands in for the v2 upgrade. */
  windAlways?: boolean;
}

type NumKey = { [K in keyof Tuning]: Tuning[K] extends number ? K : never }[keyof Tuning];
type BoolKey = { [K in keyof Tuning]: Tuning[K] extends boolean ? K : never }[keyof Tuning];

// [key, label, min, max, step, restart needed]
const GROUPS: [string, [NumKey, string, number, number, number, boolean?][]][] = [
  ['Physics', [
    ['gravity', 'Gravity (m/s²)', 5, 40, 0.5],
    ['friction', 'Friction', 0.2, 1.5, 0.05],
    ['angularDamping', 'Spin damping', 0, 3, 0.05],
    ['linearDamping', 'Slide damping', 0, 1, 0.02],
    ['cornerRadius', 'Corner radius (blocks)', 0, 0.2, 0.01],
    ['inset', 'Side inset (blocks)', 0, 0.06, 0.005],
    ['impactCap', 'Landing speed cap (m/s)', 0.5, 8, 0.25],
    ['squareUpGain', 'Square-up strength', 0, 15, 0.5],
  ]],
  ['Mortar', [
    ['mortarStrength', 'Bond strength', 0.2, 3, 0.05],
    ['bondDelay', 'Bond delay (s)', 0, 2, 0.05],
    ['breakForce', 'Break force', 1, 20, 0.5],
    ['breakTorque', 'Break torque', 1, 20, 0.5],
    ['bondHertz', 'Bond stiffness (Hz)', 1, 20, 0.5],
  ]],
  ['Controls and pace', [
    ['sensitivity', 'Drag sensitivity', 0.75, 1.5, 0.05],
    ['fallBase', 'Fall speed (blocks/s)', 0.5, 5, 0.1],
    ['softDropMult', 'Soft drop ×', 1, 6, 0.25],
    ['spawnHeight', 'Spawn height (blocks)', 4, 12, 0.5],
    ['touchGrace', 'Touchdown grace (s)', 0, 0.3, 0.01],
    ['stepUp', 'Step-up (blocks)', 0, 0.25, 0.01],
  ]],
  ['Run', [
    ['firstGap', 'First checkpoint gap', 3, 16, 1, true],
    ['holdTime', 'Hold steady (s)', 0.5, 4, 0.1],
    ['slackStart', 'Brick slack', 1, 2.5, 0.05, true],
    ['hearts', 'Hearts', 1, 6, 1, true],
    ['rowCoverage', 'Solid Row coverage', 0.7, 1, 0.01],
    ['wind', 'Wind (g, + is right)', -0.3, 0.3, 0.01],
  ]],
  ['Power-ups', [
    ['bubbleGap', 'Shapes between bubbles', 2, 12, 1],
    ['bubbleLife', 'Bubble lasts (shapes)', 1, 6, 1],
    ['glueStrength', 'Glue strength ×', 1, 4, 0.25],
    ['slowFactor', 'Slow-Mo fall speed ×', 0.25, 1, 0.05],
  ]],
];

const TOGGLES: [BoolKey, string][] = [
  ['mortar', 'Mortar (bonds between resting shapes)'],
  ['squareUp', 'Square-up assist on landing'],
  ['infiniteBudget', 'Infinite bricks'],
  ['infiniteHearts', 'Infinite hearts'],
  ['powerUps', 'Power-up bubbles and grants'],
];

const VIEW_TOGGLES: [keyof ViewSettings, string][] = [
  ['faces', 'Block faces'],
  ['ghostTint', 'Ghost stability tint'],
  ['splitTap', 'Split tap (left half rotates the other way)'],
  ['reducedMotion', 'Reduce motion (no shake, flashes or slow-mo)'],
];

const CSS = `
.st-lab-panel { position: fixed; left: 0; right: 0; bottom: 0; max-height: 72vh; overflow-y: auto; background: #FFF7E8; border-top: 3px solid ${INK}; border-radius: 18px 18px 0 0; box-shadow: 0 -4px 0 rgba(34,24,58,0.25); padding: 12px 16px calc(env(safe-area-inset-bottom, 0px) + 16px); z-index: 9; font-family: 'Nunito', system-ui, sans-serif; color: ${INK}; transform: translateY(105%); transition: transform 260ms cubic-bezier(.2,.9,.3,1); -webkit-overflow-scrolling: touch; }
.st-lab-panel.open { transform: translateY(0); }
.st-lab-panel h3 { font: 700 15px 'Fredoka', sans-serif; margin: 14px 0 4px; letter-spacing: 0.04em; text-transform: uppercase; color: #5B4F7A; }
.st-lab-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; position: sticky; top: -12px; background: #FFF7E8; padding: 4px 0 6px; z-index: 1; }
.st-lab-head b { font: 700 20px 'Fredoka', sans-serif; }
.st-lab-row { display: grid; grid-template-columns: 1fr 56px; gap: 2px 10px; align-items: center; margin: 6px 0; font-size: 14px; }
.st-lab-row input[type=range] { grid-column: 1 / 3; width: 100%; accent-color: #7A5CFF; height: 28px; }
.st-lab-row output { text-align: right; font: 600 14px 'Fredoka', sans-serif; font-variant-numeric: tabular-nums; }
.st-lab-row.changed span { font-weight: 800; }
.st-lab-check { display: flex; gap: 10px; align-items: center; margin: 8px 0; font-size: 14px; }
.st-lab-check input { width: 22px; height: 22px; accent-color: #7A5CFF; }
.st-lab-note { font-size: 12px; color: #5B4F7A; margin: 8px 0; }
.st-lab-buttons { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
`;

const KEY = 'shape-tower-lab-v1';

export function loadLab(): LabState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as LabState;
      return { tuning: s.tuning ?? {}, windAlways: !!s.windAlways, view: { ...DEFAULT_VIEW, reducedMotion: prefersReducedMotion(), ...((s.view ?? {}) as Partial<ViewSettings>) } };
    }
  } catch { /* storage unavailable: defaults */ }
  return { tuning: {}, view: { ...DEFAULT_VIEW, reducedMotion: prefersReducedMotion() } };
}

function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

function saveLab(s: LabState): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* fine without it */ }
}

export class LabPanel {
  private el: HTMLDivElement;
  constructor(parent: HTMLElement, private state: LabState, private hooks: {
    retune(patch: Partial<Tuning>): void;
    view(v: ViewSettings): void;
    restart(): void;
    opened(open: boolean): void;
    info(): string;
  }) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.className = 'st-lab-panel';
    parent.appendChild(this.el);
    this.render();
    this.el.addEventListener('pointerdown', e => e.stopPropagation());
  }

  get isOpen(): boolean { return this.el.classList.contains('open'); }

  toggle(open = !this.isOpen): void {
    if (open) this.render();
    this.el.classList.toggle('open', open);
    this.hooks.opened(open);
  }

  private value<K extends keyof Tuning>(k: K): Tuning[K] {
    return (this.state.tuning[k] ?? DEFAULT_TUNING[k]) as Tuning[K];
  }

  private render(): void {
    const t = this.state;
    let html = `<div class="st-lab-head"><b>Wobble Lab</b><button class="st-btn" data-act="close">Done</button></div>
      <div class="st-lab-note">${this.hooks.info()}</div>`;
    for (const [group, rows] of GROUPS) {
      html += `<h3>${group}</h3>`;
      for (const [k, label, min, max, step, restart] of rows) {
        const v = this.value(k) as number;
        const changed = v !== DEFAULT_TUNING[k];
        html += `<label class="st-lab-row${changed ? ' changed' : ''}"><span>${label}${restart ? ' ↻' : ''}</span><output>${fmt(v, step)}</output>
          <input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v}"></label>`;
      }
    }
    html += `<h3>Switches</h3>`;
    for (const [k, label] of TOGGLES) html += `<label class="st-lab-check"><input type="checkbox" data-b="${k}" ${this.value(k) ? 'checked' : ''}>${label}</label>`;
    html += `<label class="st-lab-check"><input type="checkbox" data-wind ${t.windAlways ? 'checked' : ''}>Second Wind ready every run (the v2 upgrade) ↻</label>`;
    for (const [k, label] of VIEW_TOGGLES) html += `<label class="st-lab-check"><input type="checkbox" data-v="${k}" ${t.view[k] ? 'checked' : ''}>${label}</label>`;
    html += `<label class="st-lab-row"><span>Screen shake</span><output>${['Off', 'Low', 'Full'][Math.round(t.view.shake * 2)]}</output><input type="range" data-shake min="0" max="1" step="0.5" value="${t.view.shake}"></label>`;
    html += `<div class="st-lab-note">Changes apply to the next shape. ↻ needs a restart. Settings stay on this device.</div>
      <div class="st-lab-buttons"><button class="st-btn" data-act="restart">↻ Restart run</button><button class="st-btn" data-act="defaults">Reset to defaults</button></div>`;
    this.el.innerHTML = html;

    this.el.querySelectorAll<HTMLInputElement>('input[data-k]').forEach(inp => {
      inp.oninput = () => {
        const k = inp.dataset.k as NumKey;
        const v = Number(inp.value);
        (this.state.tuning as Record<string, number>)[k] = v;
        const row = inp.closest('.st-lab-row')!;
        row.querySelector('output')!.textContent = fmt(v, Number(inp.step));
        row.classList.toggle('changed', v !== DEFAULT_TUNING[k]);
        this.hooks.retune({ [k]: v });
        saveLab(this.state);
      };
    });
    this.el.querySelectorAll<HTMLInputElement>('input[data-b]').forEach(inp => {
      inp.onchange = () => {
        const k = inp.dataset.b as BoolKey;
        (this.state.tuning as Record<string, boolean>)[k] = inp.checked;
        this.hooks.retune({ [k]: inp.checked });
        saveLab(this.state);
      };
    });
    this.el.querySelectorAll<HTMLInputElement>('input[data-v]').forEach(inp => {
      inp.onchange = () => {
        (this.state.view as unknown as Record<string, boolean>)[inp.dataset.v!] = inp.checked;
        this.hooks.view(this.state.view);
        saveLab(this.state);
      };
    });
    const wind = this.el.querySelector<HTMLInputElement>('input[data-wind]')!;
    wind.onchange = () => { this.state.windAlways = wind.checked; saveLab(this.state); };
    const shake = this.el.querySelector<HTMLInputElement>('input[data-shake]')!;
    shake.oninput = () => {
      this.state.view.shake = Number(shake.value);
      shake.closest('.st-lab-row')!.querySelector('output')!.textContent = ['Off', 'Low', 'Full'][Math.round(this.state.view.shake * 2)];
      this.hooks.view(this.state.view);
      saveLab(this.state);
    };
    this.el.querySelector<HTMLButtonElement>('[data-act="close"]')!.onclick = () => this.toggle(false);
    this.el.querySelector<HTMLButtonElement>('[data-act="restart"]')!.onclick = () => { this.toggle(false); this.hooks.restart(); };
    this.el.querySelector<HTMLButtonElement>('[data-act="defaults"]')!.onclick = () => {
      const patch: Partial<Tuning> = {};
      for (const k of Object.keys(this.state.tuning) as (keyof Tuning)[]) (patch as Record<string, unknown>)[k] = DEFAULT_TUNING[k];
      this.state.tuning = {};
      this.state.view = { ...DEFAULT_VIEW };
      this.state.windAlways = false;
      saveLab(this.state);
      this.hooks.retune(patch);
      this.hooks.view(this.state.view);
      this.render();
    };
  }
}

function fmt(v: number, step: number): string {
  const d = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return v.toFixed(d);
}
