// The clip renderer's side of the page (an init script, after clock.js). It sets up a seasoned
// player, records every call the game makes to Sound's director (with its time on the page's clock,
// for the offline mix), starts the chosen run with the bot's seed and tuning, feeds the bot's inputs
// in before the steps they were logged at, checks the sim against the Node run's digests, and draws
// the captions and the end card over the game.
(() => {
  // --------------------------------------------------------------- the player
  // Level 12 on default settings, every first-time card already seen, every achievement and postcard
  // already earned (so no toast or card covers a clip), and a juice-on run next (Gate 1 rotation).
  const day = new Date().toISOString().slice(0, 10);
  const profile = {
    level: 12, xp: 120, total: 5200, runs: 60, streak: 4, lastDay: '', boostDay: day, askedGhost: true, windDay: day,
    sliceRuns: 2, player: 'p-clips', seenGusts: true, seenHazards: ['crosswind', 'junk', 'meteor', 'dust', 'sway'], seenBrittle: true,
    postcards: Array(10).fill(day), passIntro: true, avatar: { shape: 'O', face: 'idle', hat: 'party' },
    // The renderer passes every achievement's id (game/src/meta/achievements.ts).
    achievements: Object.fromEntries((window.__clipAchievements || []).map(id => [id, { at: day, paid: true }])),
  };
  try {
    if (!localStorage.getItem('shape-tower-profile-v1')) localStorage.setItem('shape-tower-profile-v1', JSON.stringify(profile));
    localStorage.setItem('shape-tower-played', '1');
  } catch { /* fine */ }

  const clip = (window.__clip = {
    audioLog: [],     // [t ms, method, args]
    problems: [],
    inputs: [],
    digests: [],
    started: false,
    spec: null,
    firstInput: true,
  });

  // --------------------------------------------------------------- the director's calls
  const METHODS = ['handle', 'ui', 'screen', 'setJuice', 'setZen', 'attach', 'setVolume', 'setMono', 'setCalm', 'setLockOnChime'];
  function tapAudio(a) {
    if (!a || a.__tapped) return;
    a.__tapped = true;
    for (const m of METHODS) {
      if (typeof a[m] !== 'function') continue;
      // Only the method and its first two arguments (the live director's own `when` is its clock, not ours).
      a[m] = (...args) => {
        let copy;
        try { copy = JSON.parse(JSON.stringify(args.slice(0, 2))); } catch { copy = [String(args[0])]; }
        clip.audioLog.push([performance.now(), m, copy]);
      };
    }
    a.setHapticsLevel = () => {};
  }

  // --------------------------------------------------------------- the run
  /** Starts the run: spec { mode, seed, tuning, secondWind, inputs, digests, tag }. */
  clip.start = spec => {
    const w = window.__wobble;
    clip.spec = spec;
    clip.inputs = spec.inputs;
    clip.digests = spec.digests;
    const scene = w.scene;
    const newRun = scene.newRun.bind(scene);
    scene.newRun = (demo, run = {}) => {
      if (demo) return newRun(demo, run);
      scene.hooks.lab.tuning = JSON.parse(JSON.stringify(spec.tuning));
      newRun(false, { ...run, seed: spec.seed, secondWind: spec.secondWind });
      wrapSim(scene.sim);
      scene.newRun = newRun;
    };
    const tap = sel => {
      const b = document.querySelector(`.sc-root.show [data-action="${sel}"]`);
      if (!b) throw new Error(`no ${sel} button`);
      b.click();
    };
    if (spec.mode === 'daily') {
      // The Daily card's scored try (two taps: arm, then go); the tag then names the clip's day.
      tap('daily');
      window.__clock.run(500);
      tap('scored');
      window.__clock.run(200);
      tap('scored');
    } else tap(spec.mode === 'zen' ? 'zen' : 'play');
    if (spec.tag) w.hud.setModeTag(spec.tag, true);
    clip.started = true;
    return { seed: scene.sim.seed, tuning: scene.sim.tuning.zen, mode: spec.mode };
  };

  function wrapSim(sim) {
    let k = 0;
    const step = sim.step.bind(sim);
    sim.step = (n = 1) => {
      for (let i = 0; i < n; i++) {
        while (k < clip.inputs.length && clip.inputs[k].s === sim.stepIndex) {
          const inp = clip.inputs[k++].i;
          sim.intent(inp);
          if (clip.firstInput && inp.type !== 'softDrop') { clip.firstInput = false; window.__wobble.hud.hideHint(); }
        }
        if (k < clip.inputs.length && clip.inputs[k].s < sim.stepIndex) clip.problems.push(`input for step ${clip.inputs[k].s} missed at ${sim.stepIndex}`);
        step(1);
        if (sim.stepIndex % 60 === 0) {
          const want = clip.digests[sim.stepIndex / 60 - 1];
          if (want && want !== sim.digest() && clip.problems.length < 5) clip.problems.push(`digest differs at step ${sim.stepIndex}`);
        }
      }
    };
  }

  /** Where the run is. */
  clip.state = () => {
    const s = window.__wobble?.scene?.sim;
    return { step: s?.stepIndex ?? 0, state: s?.state ?? 'none', now: performance.now(), problems: clip.problems.length, screen: !!document.querySelector('.sc-root.show') };
  };

  /** Frames with the canvas left undrawn (a fast-forward): Phaser updates, the renderer doesn't draw. */
  clip.draw = on => {
    const g = window.__wobble.game;
    if (!clip.saved) clip.saved = { render: g.scene.render, pre: g.renderer.preRender, post: g.renderer.postRender };
    const s = clip.saved;
    g.scene.render = on ? s.render : () => {};
    g.renderer.preRender = on ? s.pre : () => {};
    g.renderer.postRender = on ? s.post : () => {};
  };

  /** Fast-forward: frames of `ms` with no drawing until the sim reaches `step`. */
  clip.skipTo = (step, ms = 50, budget = 400) => {
    const s = window.__wobble.scene;
    for (let i = 0; i < budget && s.sim.stepIndex < step && s.sim.state === 'playing'; i++) window.__clock.frame(ms);
    return s.sim.stepIndex;
  };

  // --------------------------------------------------------------- overlay: captions and the end card
  const css = `
#clip-cap { position: fixed; left: 0; right: 0; z-index: 9998; display: flex; flex-direction: column; align-items: center; gap: 4px;
  pointer-events: none; text-align: center; padding: 0 7%; }
#clip-cap span { display: inline-block; font: 700 var(--fs, 34px)/1.12 'Fredoka', system-ui, sans-serif; color: #fff;
  -webkit-text-stroke: 7px #2B2140; paint-order: stroke fill; letter-spacing: 0.3px; text-shadow: 0 5px 0 rgba(43,33,64,0.35); }
#clip-cap span.hi { color: #FFD23F; }
#clip-end { position: fixed; inset: 0; z-index: 9999; pointer-events: none; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px;
  background: linear-gradient(#6EC3FF, #BFE8FF 62%, #FFF7E8); opacity: 0; }
#clip-end .logo { transform-origin: 50% 60%; }
#clip-end .cta { font: 700 27px 'Fredoka', system-ui, sans-serif; color: #2B2140; background: #FFC93C; border: 3px solid #2B2140; border-radius: 18px;
  box-shadow: 0 5px 0 #2B2140; padding: 10px 20px; }
#clip-end .sub { font: 600 19px 'Nunito', system-ui, sans-serif; color: #2B2140; opacity: 0.8; }
`;
  clip.overlay = () => {
    if (document.getElementById('clip-cap')) return;
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
    const cap = document.createElement('div');
    cap.id = 'clip-cap';
    document.body.appendChild(cap);
    const end = document.createElement('div');
    end.id = 'clip-end';
    end.innerHTML = `<div class="logo">${clip.logoHtml ?? ''}</div><div class="cta"></div><div class="sub"></div>`;
    document.body.appendChild(end);
  };

  /**
   * One frame of overlay. cap: { lines: [{ text, hi }], top (fraction of the height), size (css px), a (0..1),
   * pop (0..1, the pop-in) } or null; end: { cta, sub, a } or null.
   */
  clip.paint = (cap, end) => {
    clip.overlay();
    const el = document.getElementById('clip-cap');
    if (!cap || cap.a <= 0) el.style.display = 'none';
    else {
      el.style.display = '';
      // Below the biome's title card while it shows; eased, so the caption slides rather than jumps.
      let want = cap.top * innerHeight;
      for (const b of document.querySelectorAll('.ui-btitle')) {
        const r = b.getBoundingClientRect();
        if (r.height && getComputedStyle(b).opacity !== '0') want = Math.max(want, r.bottom + 10);
      }
      clip.capTop = clip.capTop === undefined || cap.pop < 0.05 ? want : clip.capTop + (want - clip.capTop) * 0.35;
      el.style.top = `${clip.capTop.toFixed(1)}px`;
      el.style.setProperty('--fs', `${cap.size}px`);
      el.style.opacity = String(cap.a);
      const s = 0.6 + 0.4 * easeBack(cap.pop);
      el.style.transform = `scale(${s.toFixed(4)}) rotate(${((1 - cap.pop) * -4).toFixed(3)}deg)`;
      const html = cap.lines.map(l => `<span class="${l.hi ? 'hi' : ''}">${escape(l.text)}</span>`).join('');
      if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
    }
    const e = document.getElementById('clip-end');
    if (!end || end.a <= 0) e.style.opacity = '0';
    else {
      e.style.opacity = String(end.a);
      e.querySelector('.logo').style.transform = `scale(${(0.85 + 0.15 * easeBack(Math.min(1, end.a * 1.2))).toFixed(4)})`;
      e.querySelector('.cta').textContent = end.cta;
      e.querySelector('.sub').textContent = end.sub ?? '';
      e.querySelector('.sub').style.display = end.sub ? '' : 'none';
    }
  };

  function easeBack(t) { const c = 1.70158, u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; }
  function escape(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // Tap the director as soon as the game makes it.
  const poll = setInterval(() => {
    const w = window.__wobble;
    if (w?.audio) { tapAudio(w.audio); clearInterval(poll); }
  }, 5);
  clip.tap = () => tapAudio(window.__wobble?.audio);
  /** The menu's logo, kept for the end card (still: no drop-in). */
  clip.keepLogo = () => {
    const l = document.querySelector('.sc-root .ui-logo');
    if (!l) return false;
    const c = l.cloneNode(true);
    c.classList.add('ui-still');
    c.style.visibility = '';
    clip.logoHtml = c.outerHTML;
    return true;
  };
})();
