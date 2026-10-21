// The Sound Sketchbook: every placeholder sound and the main audio moments,
// played through the real AudioDirector. Built into one HTML page by
// scripts/build-sketchbook.mjs (the bake worker is inlined as a blob).

import { AudioDirector, type PlayOptions } from '../src/director';
import { BIOMES, biome } from '../src/biomes';
import { biomeScope, biomeWindow } from '../src/bank';
import { MATERIAL_INSTRUMENT } from '../src/synth/instruments';
import { keyName, scaleNote, type Key } from '../src/music/theory';
import { SOUNDS } from '../src/synth/recipes';
import type { Material } from '../src/types';

declare const __BAKE_WORKER__: string;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ------------------------------------------------------------ colors from Art's piece palette (light, base, shade)

const HUES = {
  sky: ['#9BE6FF', '#33C3F0', '#1E8BC3'],
  butter: ['#FFE58F', '#FFCC33', '#E0A100'],
  grape: ['#D0A8FF', '#A35CFF', '#6F35D1'],
  tangerine: ['#FFCB85', '#FF9A2E', '#D96F0A'],
  berry: ['#9DB3FF', '#4A72FF', '#2C4BD1'],
  lime: ['#A9F09A', '#5ED15A', '#34A13A'],
  cherry: ['#FF9DAA', '#FF4F64', '#CC2E48'],
  gumdrop: ['#F7A3EC', '#E84FD0', '#B52EA0'],
  plank: ['#F2C891', '#D9A066', '#A8723E'],
  teal: ['#8DEEDF', '#22C7B2', '#12907F'],
  glass: ['#E6F8FF', '#A8E6FF', '#6CBCE0'],
  boulder: ['#C9CDD8', '#A9AFC0', '#6E7487'],
  navy: ['#B9BDF7', '#8E95F2', '#3D46B8'],
} as const;
type Hue = keyof typeof HUES;
const TOWER_HUES: Hue[] = ['sky', 'butter', 'grape', 'tangerine', 'berry', 'lime', 'cherry'];

const MATERIAL_HUE: Record<Material, Hue> = {
  wood: 'plank', stone: 'boulder', ice: 'sky', rubber: 'cherry', jelly: 'gumdrop', metal: 'navy', glass: 'glass', ground: 'lime', base: 'butter',
};
const MATERIAL_LABEL: Record<Material, string> = {
  wood: 'Wood', stone: 'Stone', ice: 'Ice', rubber: 'Rubber', jelly: 'Jelly', metal: 'Metal', glass: 'Glass', ground: 'Ground', base: 'Plinth',
};
const INSTRUMENT_LABEL: Record<string, string> = {
  marimba: 'marimba', kalimba: 'kalimba', glassBell: 'glass bells', pluck: 'rubber pluck', wobble: 'jelly wobble', vibes: 'vibraphone', celesta: 'celesta',
};
/** Art's biome skies (top, middle, horizon). */
const SKIES: string[][] = [
  ['#6EC3FF', '#A9DEFF', '#E4F7FF'], ['#4DA8F0', '#86C9FA', '#CDEBFF'], ['#6FAFEF', '#B5D8FA', '#F6FAFF'], ['#3B4A6B', '#5F6F8F', '#8E9AB3'],
  ['#2B2F7A', '#B26AC0', '#FFB27A'], ['#05081A', '#0B1230', '#162452'], ['#07081A', '#121530', '#262A45'], ['#1A0710', '#4A1620', '#9A3B2A'],
  ['#0C0A24', '#2B1F52', '#8A6A3D'], ['#09031A', '#1C0A38', '#3A1258'],
];

// ------------------------------------------------------------ the catalog

interface PadDef { id: string; label: string; opts?: PlayOptions; loop?: number }
interface Group { title: string; blurb: string; hue: Hue; pads: PadDef[] }

const GROUPS: Group[] = [
  {
    title: 'Steering a shape', hue: 'sky', blurb: 'Quiet, quick and dry, so they never crowd the landings.',
    pads: [
      { id: 'spawn', label: 'New shape', opts: { gainDb: -12 } },
      { id: 'move', label: 'Move a column', opts: { gainDb: -12 } },
      { id: 'rotate.cw', label: 'Rotate', opts: { gainDb: -10 } },
      { id: 'rotate.ccw', label: 'Rotate back', opts: { gainDb: -10 } },
      { id: 'rotate.blocked', label: "Can't rotate", opts: { gainDb: -9 } },
      { id: 'drop', label: 'Soft drop', opts: { gainDb: -12 } },
      { id: 'harddrop', label: 'Hard drop', opts: { gainDb: -8 } },
      { id: 'swap', label: 'Hold swap', opts: { gainDb: -10 } },
      { id: 'lockon', label: 'Perfect-fit chime', opts: { gainDb: -10 } },
      { id: 'settle', label: 'Settles', opts: { gainDb: -10 } },
      { id: 'scrape.rough', label: 'Scrape (wood)', opts: { gainDb: -8 }, loop: 1.6 },
      { id: 'scrape.squeak', label: 'Squeak (rubber)', opts: { gainDb: -8 }, loop: 1.6 },
    ],
  },
  {
    title: 'Wobble and danger', hue: 'cherry', blurb: 'The tower complains before it falls, so you can save it.',
    pads: [
      { id: 'creak', label: 'Creak', opts: { gainDb: -6 } },
      { id: 'groan', label: 'Groan', opts: { gainDb: -6 } },
      { id: 'teeter', label: 'Teeter', opts: { gainDb: -6 } },
      { id: 'heartbeat', label: 'Danger heartbeat', opts: { gainDb: -4 } },
      { id: 'fallwhistle', label: 'Piece falling', opts: { gainDb: -8 } },
      { id: 'plonk', label: 'Lands far below', opts: { gainDb: -6 } },
      { id: 'boop', label: 'Floats away (space)', opts: { gainDb: -8 } },
      { id: 'heartpop', label: 'Heart lost', opts: { gainDb: -6 } },
      { id: 'heartup', label: 'Heart back', opts: { gainDb: -6 } },
      { id: 'collapse.crack', label: 'Collapse crack', opts: { gainDb: -4 } },
      { id: 'collapse.rumble', label: 'Collapse rumble', opts: { gainDb: -6 } },
    ],
  },
  {
    title: 'Building and checkpoints', hue: 'tangerine', blurb: 'Mortar, Solid Rows and the checkpoint hold.',
    pads: [
      { id: 'bond.tink', label: 'Mortar bond', opts: { gainDb: -8 } },
      { id: 'bond.snap', label: 'Bond snaps', opts: { gainDb: -6 } },
      { id: 'row.clack', label: 'Solid Row', opts: { gainDb: -4 } },
      { id: 'hold.tick', label: 'Hold ring tick', opts: { gainDb: -8 } },
      { id: 'hold.womp', label: 'Hold cancelled', opts: { gainDb: -6 } },
      { id: 'drumroll', label: 'Almost there', opts: { gainDb: -8 }, loop: 2.2 },
      { id: 'flag', label: 'Checkpoint flag', opts: { gainDb: -5 } },
      { id: 'stonewave', label: 'Tower turns to stone', opts: { gainDb: -6 } },
      { id: 'foundation', label: 'New foundation', opts: { gainDb: -5 } },
      { id: 'kaching', label: 'Leftover brick', opts: { gainDb: -8 } },
    ],
  },
  {
    title: 'Rewards', hue: 'butter', blurb: 'Sparkle, confetti and fanfare bits.',
    pads: [
      { id: 'shimmer', label: 'Shimmer', opts: { gainDb: -8 } },
      { id: 'confetti', label: 'Confetti', opts: { gainDb: -8 } },
      { id: 'swell', label: 'Swell', opts: { gainDb: -8 } },
      { id: 'firework', label: 'Firework', opts: { gainDb: -6 } },
      { id: 'phew', label: 'Clutch save', opts: { gainDb: -6 } },
      { id: 'gear', label: 'Getting harder', opts: { gainDb: -8 } },
      { id: 'blip', label: 'Height milestone', opts: { gainDb: -8 } },
      { id: 'xp.tick', label: 'XP tick', opts: { gainDb: -8 } },
      { id: 'stamp', label: 'Postcard stamp', opts: { gainDb: -6 } },
    ],
  },
  {
    title: 'Menus', hue: 'grape', blurb: 'Soft and short. Buttons click on touch-down.',
    pads: [
      { id: 'ui.tap', label: 'Tap', opts: { gainDb: -8, bus: 'ui' } },
      { id: 'ui.tap2', label: 'Tab', opts: { gainDb: -8, bus: 'ui' } },
      { id: 'ui.back', label: 'Back', opts: { gainDb: -8, bus: 'ui' } },
      { id: 'ui.on', label: 'Toggle on', opts: { gainDb: -8, bus: 'ui' } },
      { id: 'ui.off', label: 'Toggle off', opts: { gainDb: -8, bus: 'ui' } },
      { id: 'ui.slider', label: 'Slider', opts: { gainDb: -10, bus: 'ui' } },
      { id: 'ui.open', label: 'Open panel', opts: { gainDb: -8, bus: 'ui' } },
      { id: 'ui.close', label: 'Close panel', opts: { gainDb: -8, bus: 'ui' } },
      { id: 'ui.error', label: 'Not allowed', opts: { gainDb: -8, bus: 'ui' } },
      { id: 'ui.pause', label: 'Pause', opts: { gainDb: -8, bus: 'ui' } },
      { id: 'ui.resume', label: 'Resume', opts: { gainDb: -8, bus: 'ui' } },
    ],
  },
  {
    title: 'Hazards', hue: 'teal', blurb: 'Every hazard warns at least 2 seconds ahead.',
    pads: [
      { id: 'gust.warn', label: 'Gust coming', opts: { gainDb: -6 } },
      { id: 'gust.push', label: 'Gust hits', opts: { gainDb: -6 } },
      { id: 'wind.loop', label: 'Crosswind', opts: { gainDb: -6 }, loop: 3 },
      { id: 'radar', label: 'Space junk radar', opts: { gainDb: -8 } },
      { id: 'meteor.whistle', label: 'Meteor whistle', opts: { gainDb: -8 } },
      { id: 'meteor.pop', label: 'Meteor pop', opts: { gainDb: -8 } },
      { id: 'dust.swirl', label: 'Dust devil', opts: { gainDb: -6 } },
      { id: 'tidal.loop', label: 'Tidal sway', opts: { gainDb: -6 }, loop: 4 },
    ],
  },
  {
    title: 'Power-ups', hue: 'gumdrop', blurb: 'Bubbles to steer through, five powers and Second Wind. Each power sounds like what it does.',
    pads: [
      { id: 'bubble.spawn', label: 'Bubble appears', opts: { gainDb: -8 } },
      { id: 'bubble.pop', label: 'Bubble caught', opts: { gainDb: -6 } },
      { id: 'sweep', label: 'Clean Slate', opts: { gainDb: -6 } },
      { id: 'quickset', label: 'Quick-Set', opts: { gainDb: -5 } },
      { id: 'undo', label: 'Undo', opts: { gainDb: -6 } },
      { id: 'glue.on', label: 'Glue', opts: { gainDb: -6 } },
      { id: 'glue.squelch', label: 'Glued bond', opts: { gainDb: -6 } },
      { id: 'slow.in', label: 'Slow-Mo starts', opts: { gainDb: -6 } },
      { id: 'slow.out', label: 'Slow-Mo ends', opts: { gainDb: -6 } },
      { id: 'windgust', label: 'Second Wind', opts: { gainDb: -4 } },
    ],
  },
  {
    title: 'Ambience', hue: 'lime', blurb: 'Little sounds scattered over each biome bed every 3 to 15 seconds.',
    pads: [
      { id: 'amb.bird', label: 'Bird (Meadow)' },
      { id: 'amb.leaves', label: 'Leaves (Treetops)' },
      { id: 'amb.thunder', label: 'Thunder (Storm Belt)' },
      { id: 'amb.jet', label: 'Jet (Stratosphere)' },
      { id: 'amb.satellite', label: 'Satellite (Orbit)' },
      { id: 'amb.crackle', label: 'Static (Moon)' },
      { id: 'amb.rover', label: 'Rover (Red Planet)' },
      { id: 'amb.chime', label: 'Ice chimes (Ringed Giant)' },
      { id: 'amb.pulsar', label: 'Pulsar (Deep Cosmos)' },
    ].map((p) => ({ ...p, opts: { gainDb: -6 } })),
  },
  {
    title: 'Arriving in a biome', hue: 'berry', blurb: 'Played once per run as the camera rises into a new sky.',
    pads: BIOMES.map((b) => ({ id: `entry.${b.id}`, label: b.name, opts: { gainDb: -6 } })),
  },
];

const TIERS = [
  { label: 'Tap', speed: 'under 1 block/s' },
  { label: 'Knock', speed: '1 to 3' },
  { label: 'Thud', speed: '3 to 7' },
  { label: 'Slam', speed: '7 and up' },
];
const IMPACT_MATERIALS: Material[] = ['wood', 'stone', 'rubber', 'metal', 'glass', 'ice', 'jelly', 'ground', 'base'];

// ------------------------------------------------------------ the director

let audio: AudioDirector;
let workerUrl: string | undefined;
try {
  workerUrl = URL.createObjectURL(new Blob([__BAKE_WORKER__], { type: 'text/javascript' }));
} catch {
  workerUrl = undefined;
}
audio = new AudioDirector({ haptics: false, storage: null, worker: workerUrl ? () => new Worker(workerUrl!) : null, seed: 1 });
const internals = audio as unknown as { startRun(when: number, chime: boolean): void; key: Key; biomeId: number; running: boolean };

let started = false;
let ambienceOn = false;
let currentBiome = 1;

function ensureRun(): void {
  void audio.unlock();
  if (!internals.running) {
    internals.startRun(audio.now() + 0.02, false);
    if (internals.biomeId !== currentBiome) audio.handle('biome_entered', { id: currentBiome });
    audio.handle('signals', { biome: currentBiome });
  }
  applyAmbience();
  started = true;
}

function applyAmbience(): void {
  audio.mixer.setVolume('ambience', ambienceOn ? audio.settings.sfx : 0, audio.now());
}

// ------------------------------------------------------------ status

const expected = Object.keys(SOUNDS).filter((n) => {
  const sc = biomeScope(n);
  const win = biomeWindow(1);
  return !sc || sc.some((b) => win.includes(b));
}).length;

function updateStatus(): void {
  const s = $('status');
  const n = audio.bank.names().length;
  const st = audio.debugState();
  if (st.ready && n >= expected) {
    s.dataset.state = 'ready';
    $('status-text').textContent = started ? `Ready · ${st.voices} voices playing` : 'Ready · tap any sound';
  } else {
    s.dataset.state = 'baking';
    $('status-text').textContent = `Baking sounds ${Math.min(n, expected)} of ${expected}`;
  }
}
setInterval(updateStatus, 250);
updateStatus();

// ------------------------------------------------------------ pads

function hueVars(h: Hue): string {
  const [l, c, s] = HUES[h];
  return `--c:${l};--l:#FFFFFF99;--s:${c};--shade:${s}`;
}

function press(el: HTMLElement): void {
  el.classList.remove('bounce');
  el.classList.add('hit');
  setTimeout(() => {
    el.classList.remove('hit');
    el.classList.add('bounce');
  }, 110);
  setTimeout(() => el.classList.remove('bounce'), 360);
}

function playPad(p: PadDef): void {
  ensureRun();
  const when = audio.now() + 0.01;
  const pl = audio.play(p.id, { vary: true, slowmo: false, category: 'misc', priority: 1, ...p.opts, when, loop: !!p.loop || undefined });
  if (pl && p.loop) {
    pl.gain.gain.setTargetAtTime(0, when + p.loop, 0.15);
    pl.src.stop(when + p.loop + 1);
  }
}

function buildBoard(): void {
  const board = $('board');
  // impacts first: the core of the game's feel
  const imp = document.createElement('section');
  imp.className = 'group';
  imp.innerHTML = `<header><h2>Impacts</h2><p class="note">Nine materials, four strengths. The game picks the strength from how fast a piece hits (blocks per second) and sets the volume from the same speed. Each pad has four variations, so tap it a few times.</p></header>`;
  const box = document.createElement('div');
  box.className = 'panel impacts';
  const table = document.createElement('table');
  table.innerHTML = `<thead><tr><th scope="col">Material</th>${TIERS.map((t) => `<th scope="col">${t.label}<small>${t.speed}</small></th>`).join('')}</tr></thead>`;
  const tb = document.createElement('tbody');
  for (const m of IMPACT_MATERIALS) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<th scope="row">${MATERIAL_LABEL[m]}</th>`;
    TIERS.forEach((t, i) => {
      const td = document.createElement('td');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pad';
      b.setAttribute('style', hueVars(MATERIAL_HUE[m]));
      b.setAttribute('aria-label', `${MATERIAL_LABEL[m]} ${t.label.toLowerCase()}`);
      b.innerHTML = `<code>impact.${m}.${i + 1}</code>`;
      b.addEventListener('pointerdown', () => press(b));
      b.addEventListener('click', () => playPad({ id: `impact.${m}.${i + 1}`, label: '', opts: { gainDb: [-14, -9, -5, -2][i], category: 'impact' } }));
      td.append(b);
      tr.append(td);
    });
    tb.append(tr);
  }
  table.append(tb);
  box.append(table);
  imp.append(box);
  board.append(imp);

  for (const g of GROUPS) {
    const sec = document.createElement('section');
    sec.className = 'group';
    sec.innerHTML = `<header><h2>${g.title}</h2><p class="note">${g.blurb}</p></header>`;
    const pads = document.createElement('div');
    pads.className = 'pads';
    for (const p of g.pads) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pad';
      b.setAttribute('style', hueVars(g.hue));
      b.innerHTML = `<span>${p.label}</span><code>${p.id}</code>`;
      b.addEventListener('pointerdown', () => press(b));
      b.addEventListener('click', () => playPad(p));
      pads.append(b);
    }
    sec.append(pads);
    board.append(sec);
  }
}

// ------------------------------------------------------------ the instrument

const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const noteName = (midi: number) => `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
let towerCount = 0;
let bodyId = 0;

function instrumentFor(id: number) {
  return MATERIAL_INSTRUMENT[biome(id).material];
}

function renderLadder(highlight = -1, bloom = false): void {
  const key = internals.key ?? biome(currentBiome).key;
  const { inst, octave } = instrumentFor(currentBiome);
  const streak = audio.ladder.currentStreak;
  const lit = streak === 0 ? 0 : ((streak - 1) % 8) + 1;
  const ladder = $('ladder');
  ladder.classList.toggle('bloom', bloom);
  ladder.innerHTML = '';
  for (let i = 0; i < 8; i++) {
    const r = document.createElement('div');
    r.className = 'rung' + (i < lit ? ' on' : '') + (i === highlight ? ' now' : '');
    r.innerHTML = `${noteName(scaleNote(key, i) + 12 * octave)}<small>step ${i + 1}</small>`;
    ladder.append(r);
  }
  $('streak').textContent = String(streak);
  $('keyline').textContent = `${keyName(key)} · ${INSTRUMENT_LABEL[inst] ?? inst} · ${MATERIAL_LABEL[biome(currentBiome).material].toLowerCase()} blocks`;
}

function place(grade: 'clean' | 'perfect' | 'messy'): void {
  ensureRun();
  if (!audio.debugState().ready) return;
  const now = audio.now() + 0.02;
  const mat = biome(currentBiome).material;
  const key = internals.key;
  const { octave } = instrumentFor(currentBiome);
  const step = audio.ladder.currentStreak % 8;
  const midi = grade === 'messy' ? null : scaleNote(key, step) + 12 * octave;
  bodyId++;
  audio.handle('piece_landed', { impact: grade === 'messy' ? 0.8 : 0.45, material: mat }, now);
  audio.handle('contact_hit', { bodyA: `b${bodyId}`, bodyB: 'tower', approachSpeed: grade === 'messy' ? 9 : 4.5, materialA: mat, materialB: mat, point: { x: 0, y: towerCount }, size: 4 }, now);
  if (grade === 'messy') audio.handle('contact_hit', { bodyA: `b${bodyId}x`, bodyB: 'tower', approachSpeed: 2.5, materialA: mat, materialB: mat, point: { x: 1, y: towerCount } }, now + 0.09);
  audio.handle('piece_settled', { grade, material: mat }, now + 0.14);
  if (grade === 'perfect') audio.handle('perfect', { combo: audio.ladder.currentStreak }, now + 0.14);
  const bloom = grade !== 'messy' && audio.ladder.currentStreak % 8 === 0;
  addBlock(grade, midi);
  renderLadder(grade === 'messy' ? -1 : step, bloom);
}

function addBlock(grade: string, midi: number | null): void {
  const tower = $('tower');
  if (towerCount >= 11) {
    tower.innerHTML = '';
    towerCount = 0;
  }
  const h = HUES[TOWER_HUES[Math.floor(Math.random() * TOWER_HUES.length)]];
  const b = document.createElement('div');
  b.className = 'block' + (grade === 'messy' ? ' messy' : '');
  b.style.setProperty('--l', h[0]);
  b.style.setProperty('--c', h[1]);
  b.style.setProperty('--s', h[2]);
  if (grade === 'messy') {
    b.style.setProperty('--tilt', `${(Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 6)}deg`);
    b.style.setProperty('--shift', `${(Math.random() * 2 - 1) * 14}px`);
  }
  tower.append(b);
  towerCount++;
  const pop = document.createElement('div');
  pop.className = 'notepop';
  pop.textContent = midi === null ? 'clonk' : grade === 'perfect' ? `${noteName(midi)} ✦` : noteName(midi);
  pop.style.bottom = `${40 + towerCount * 23}px`;
  $('towerbox').append(pop);
  setTimeout(() => pop.remove(), 950);
}

function buildBiomes(): void {
  const box = $('biomes');
  for (const b of BIOMES) {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'chip';
    c.setAttribute('aria-pressed', String(b.id === currentBiome));
    const sky = SKIES[b.id - 1];
    c.innerHTML = `<i style="--a:${sky[0]};--b:${sky[1]};--c:${sky[2]}"></i>${b.name}<small>${keyName(b.key)} · ${INSTRUMENT_LABEL[MATERIAL_INSTRUMENT[b.material].inst]}</small>`;
    c.addEventListener('click', () => pickBiome(b.id));
    box.append(c);
  }
}

function pickBiome(id: number): void {
  ensureRun();
  currentBiome = id;
  audio.handle('biome_entered', { id });
  audio.handle('signals', { biome: id });
  Array.from($('biomes').children).forEach((el, i) => el.setAttribute('aria-pressed', String(i + 1 === id)));
  const sky = SKIES[id - 1];
  const tb = $('towerbox');
  tb.style.setProperty('--b-top', sky[0]);
  tb.style.setProperty('--b-mid', sky[1]);
  tb.style.setProperty('--b-low', sky[2]);
  renderLadder();
}

// ------------------------------------------------------------ moments

interface Moment { title: string; desc: string; run: (t: number) => number }
let checkpointN = 0;

const MOMENTS: Moment[] = [
  {
    title: 'Claim a checkpoint', desc: 'Drumroll near the line, the hold ring fills for 2 s, then flag, fanfare, stone wave, new foundation and 6 leftover bricks.',
    run: (t) => {
      audio.handle('checkpoint_near', { blocks: 1 }, t);
      for (let k = 0; k <= 10; k++) audio.handle('checkpoint_hold', { progress: k / 10 }, t + 1.2 + k * 0.2);
      audio.handle('checkpoint_claimed', { n: ++checkpointN, leftover: 6 }, t + 3.3);
      return 6.5;
    },
  },
  {
    title: 'Hold cancelled', desc: 'The ring fills halfway, then a piece wobbles off the line.',
    run: (t) => {
      for (let k = 0; k <= 5; k++) audio.handle('checkpoint_hold', { progress: k / 10 }, t + k * 0.2);
      audio.handle('checkpoint_cancelled', {}, t + 1.2);
      return 2.2;
    },
  },
  {
    title: 'Solid Row', desc: 'A full row fuses: a clack, a chord in key and a run of ticks. Then three rows at once.',
    run: (t) => {
      audio.handle('row_solid', { count: 1 }, t);
      audio.handle('row_solid', { count: 3 }, t + 1.6);
      return 3.2;
    },
  },
  {
    title: 'Collapse', desc: 'Tension climbs, the tower cracks and 40 pieces tumble. The mix never clips.',
    run: (t) => {
      for (let k = 0; k <= 16; k++) audio.handle('signals', { tension: Math.min(1, 0.4 + k * 0.04) }, t + k * 0.1);
      audio.handle('collapse_started', { pieces: 40 }, t + 1.8);
      const mats: Material[] = ['wood', 'wood', 'stone', biome(currentBiome).material];
      for (let k = 0; k < 60; k++) {
        const at = t + 1.85 + Math.random() * 1.8;
        audio.handle('contact_hit', { bodyA: `c${k % 30}`, bodyB: `c${(k * 7) % 30}`, approachSpeed: 1 + Math.random() * 13, materialA: mats[k % mats.length], materialB: mats[(k + 1) % mats.length], point: { x: (Math.random() * 2 - 1) * 5, y: Math.random() * 15 }, size: 1 + Math.floor(Math.random() * 5) }, at);
        if (k % 20 === 0) audio.handle('bond_broken', { force: 200 }, at);
      }
      for (let k = 0; k < 3; k++) audio.handle('piece_lost', {}, t + 2.4 + k * 0.4);
      setTimeout(() => audio.handle('signals', { tension: 0 }), 5000);
      return 5.5;
    },
  },
  {
    title: 'Lose a heart', desc: 'A piece falls off, whistles down and plonks far below. You lose a heart.',
    run: (t) => {
      audio.handle('piece_lost', {}, t);
      audio.handle('piece_gone', { how: 'offscreen' }, t + 1.1);
      audio.handle('heart_lost', { count: 1, left: 2 }, t + 1.2);
      return 2.6;
    },
  },
  {
    title: 'Last heart', desc: 'Down to one heart: a low bell, and the music leans in. Then a heart comes back.',
    run: (t) => {
      audio.handle('heart_lost', { count: 1, left: 1 }, t);
      audio.handle('last_heart', {}, t + 0.2);
      audio.handle('heart_restored', { left: 2 }, t + 2.6);
      return 3.6;
    },
  },
  {
    title: 'Clutch save', desc: 'A piece lands on the edge and holds. Phew.',
    run: (t) => {
      audio.handle('contact_hit', { bodyA: 'cl', bodyB: 'tower', approachSpeed: 5, point: { x: 3, y: 4 } }, t);
      audio.handle('piece_settled', { grade: 'clean' }, t + 0.15);
      audio.handle('clutch', {}, t + 0.2);
      return 1.6;
    },
  },
  {
    title: 'Personal best', desc: 'You pass your best height: three fireworks and a fanfare.',
    run: (t) => { audio.handle('pb_crossed', {}, t); return 2.6; },
  },
  {
    title: 'Gust of wind', desc: 'A rising whoosh warns 2 s ahead and lands right as the push hits.',
    run: (t) => {
      audio.handle('hazard_warning', { type: 'gust', dir: 'left', eta: 2 }, t);
      audio.handle('hazard_start', { type: 'gust', strength: 0.1, dir: 'left' }, t + 2);
      audio.handle('hazard_end', { type: 'gust' }, t + 4.5);
      return 4.6;
    },
  },
  {
    title: 'Meteor shower', desc: 'Whistles from above, then 3 tiny pops on the tower (Moon).',
    run: (t) => {
      audio.handle('hazard_warning', { type: 'meteor', eta: 2 }, t);
      for (let k = 0; k < 3; k++) audio.play('meteor.pop', { when: t + 2.1 + k * 0.18, gainDb: -8, pan: (k - 1) * 0.3 });
      return 3.4;
    },
  },
  {
    title: 'XP tally', desc: 'After a run, XP counts up in rising ticks, then you level up.',
    run: (t) => {
      for (let k = 0; k < 30; k++) audio.handle('xp_tick', {}, t + k * 0.07);
      audio.handle('level_up', { level: 5 }, t + 2.4);
      return 4.6;
    },
  },
  {
    title: 'Catch a power-up', desc: 'A bubble bloops in above the tower, and a falling shape pops it: a rising chime in the biome\'s key.',
    run: (t) => {
      audio.handle('bubble_spawned', { id: 1, kind: 'glue', x: 1, y: 6 }, t);
      audio.handle('power_collected', { id: 1, kind: 'glue', slot: 0, x: 1, y: 6 }, t + 1.3);
      return 2.4;
    },
  },
  {
    title: 'Glue', desc: 'A gloopy squelch, then the next shapes squelch as they stick.',
    run: (t) => {
      audio.handle('power_used', { kind: 'glue', slot: 0, shapes: 3 }, t);
      for (let k = 0; k < 2; k++) {
        audio.handle('contact_hit', { bodyA: `g${k}`, bodyB: 'tower', approachSpeed: 6, point: { x: k - 0.5, y: 3 }, size: 4 }, t + 0.9 + k * 0.9);
        audio.handle('piece_landed', { impact: 0.4, x: k - 0.5, glue: true }, t + 0.9 + k * 0.9);
        audio.handle('bond_formed', { pos: { x: k - 0.5, y: 3 }, glue: true }, t + 0.95 + k * 0.9);
        audio.handle('piece_settled', { grade: 'clean' }, t + 1.1 + k * 0.9);
      }
      audio.handle('power_ended', { kind: 'glue' }, t + 3);
      return 3.4;
    },
  },
  {
    title: 'Slow-Mo', desc: 'Time stretches down. Landings sink a little and the music softens, until it stretches back.',
    run: (t) => {
      audio.handle('power_used', { kind: 'slowmo', slot: 0, shapes: 3 }, t);
      for (let k = 0; k < 3; k++) {
        audio.handle('contact_hit', { bodyA: `s${k}`, bodyB: 'tower', approachSpeed: 5, point: { x: k - 1, y: 3 }, size: 4 }, t + 1.2 + k * 0.9);
        audio.handle('piece_settled', { grade: 'clean' }, t + 1.4 + k * 0.9);
      }
      audio.handle('power_ended', { kind: 'slowmo' }, t + 4.2);
      return 5;
    },
  },
  {
    title: 'Clean Slate', desc: 'One broom stroke sweeps the loose pieces away, then a clean sparkle.',
    run: (t) => {
      const pieces = Array.from({ length: 6 }, (_, i) => ({ id: i, shape: 'T', x: i - 3, y: 2 }));
      audio.handle('pieces_swept', { pieces }, t);
      audio.handle('power_used', { kind: 'clean', slot: 0, pieces, refund: 6 }, t);
      return 1.4;
    },
  },
  {
    title: 'Quick-Set', desc: 'The tower turns to stone from the top down.',
    run: (t) => { audio.handle('power_used', { kind: 'quickset', slot: 0, ids: [1, 2, 3, 4] }, t); return 1.6; },
  },
  {
    title: 'Undo', desc: 'The last shape comes back to your hand with a reverse fwip. Then a power with nothing to do.',
    run: (t) => {
      audio.handle('power_used', { kind: 'undo', slot: 0, id: 9, shape: 'L', x: -1, y: 3 }, t);
      audio.handle('piece_spawned', { shape: 'L' }, t + 0.35);
      audio.handle('power_refused', { kind: 'glue', slot: 1 }, t + 1.4);
      return 2;
    },
  },
  {
    title: 'Second Wind', desc: 'A big gust clears the tower, then a warm chord as your hearts and bricks come back.',
    run: (t) => {
      const pieces = Array.from({ length: 8 }, (_, i) => ({ id: i, shape: 'S', x: i - 4, y: 3 }));
      audio.handle('pieces_swept', { pieces }, t);
      audio.handle('second_wind', { pieces: 8, refund: 8, hearts: 3, restored: 2, bricks: 20 }, t);
      audio.handle('heart_restored', { left: 3 }, t);
      return 2.8;
    },
  },
  {
    title: 'Game over', desc: 'Everything slows to a halt like a tape stopping, then one note per biome you reached.',
    run: (t) => {
      audio.handle('run_over', { cause: 'hearts' }, t);
      setTimeout(() => ensureRun(), 6000);
      return 6;
    },
  },
];

function buildMoments(): void {
  const box = $('moments');
  for (const m of MOMENTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn moment';
    b.innerHTML = `${m.title}<span>${m.desc}</span>`;
    b.addEventListener('pointerdown', () => press(b));
    b.addEventListener('click', () => {
      ensureRun();
      if (!audio.debugState().ready) return;
      const len = m.run(audio.now() + 0.05);
      b.classList.add('playing');
      setTimeout(() => b.classList.remove('playing'), len * 1000);
    });
    box.append(b);
  }
}

function tensionLevel(v: number): [string, string] {
  if (v >= 0.85) return ['danger', 'danger'];
  if (v >= 0.6) return ['groan', 'groaning'];
  if (v >= 0.3) return ['creak', 'creaking'];
  return ['calm', 'steady'];
}

// ------------------------------------------------------------ wiring

buildBoard();
buildBiomes();
buildMoments();
renderLadder();

$('land-clean').addEventListener('click', () => place('clean'));
$('land-perfect').addEventListener('click', () => place('perfect'));
$('land-messy').addEventListener('click', () => place('messy'));
for (const id of ['land-clean', 'land-perfect', 'land-messy']) $(id).addEventListener('pointerdown', (e) => press(e.currentTarget as HTMLElement));

$<HTMLInputElement>('vol-sfx').addEventListener('input', (e) => {
  audio.setVolume('sfx', Number((e.target as HTMLInputElement).value) / 100);
  applyAmbience();
});
$<HTMLInputElement>('amb').addEventListener('change', (e) => {
  ensureRun();
  ambienceOn = (e.target as HTMLInputElement).checked;
  applyAmbience();
});
$<HTMLInputElement>('mono').addEventListener('change', (e) => audio.setMono((e.target as HTMLInputElement).checked));
$<HTMLInputElement>('calm').addEventListener('change', (e) => audio.setCalm((e.target as HTMLInputElement).checked));
$<HTMLInputElement>('tension').addEventListener('input', (e) => {
  ensureRun();
  const v = Number((e.target as HTMLInputElement).value) / 100;
  audio.handle('signals', { tension: v });
  $('tension-val').textContent = v.toFixed(2);
  const [level, word] = tensionLevel(v);
  const em = $('tension-level');
  em.dataset.level = level;
  em.textContent = word;
});
