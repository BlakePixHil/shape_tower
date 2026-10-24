// The page's clock for frame-by-frame rendering (an init script, so it runs before the game).
// Time only moves when the renderer calls __clock.frame(ms): performance.now, Date.now, timers and
// requestAnimationFrame all follow it, so a frame captured every 1/30 s shows exactly 1/30 s of play
// however long the headless browser takes to draw it. CSS and Web Animations follow it too: the
// renderer freezes the document timeline (CDP Animation.setPlaybackRate 0) and each frame seeks
// every running animation to its age on this clock.
(() => {
  const realDateNow = Date.now.bind(Date);
  const epoch = realDateNow();
  let now = 0; // ms since the page opened, on this clock
  let nextId = 1;
  const timers = new Map(); // id -> { at, fn, args, every }
  const frames = new Map(); // id -> callback
  const born = new WeakMap(); // animation -> { at, from }

  performance.now = () => now;
  Date.now = () => epoch + now;

  const add = (fn, ms, args, every) => {
    const id = nextId++;
    if (typeof fn === 'function') timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn, args, every });
    return id;
  };
  window.setTimeout = (fn, ms, ...args) => add(fn, ms, args, 0);
  window.setInterval = (fn, ms, ...args) => add(fn, ms, args, Math.max(1, Number(ms) || 0));
  window.clearTimeout = window.clearInterval = id => { timers.delete(id); };
  window.requestAnimationFrame = fn => { const id = nextId++; frames.set(id, fn); return id; };
  window.cancelAnimationFrame = id => { frames.delete(id); };
  window.requestIdleCallback = (fn, o) => add(() => fn({ didTimeout: false, timeRemaining: () => 50 }), o?.timeout ? Math.min(o.timeout, 1) : 1, [], 0);
  window.cancelIdleCallback = id => { timers.delete(id); };

  /** Runs the timers due by `end`, in time order. */
  function runTimers(end) {
    for (let guard = 0; guard < 100000; guard++) {
      let id = -1, t = null;
      for (const [k, v] of timers) if (v.at <= end && (!t || v.at < t.at)) { id = k; t = v; }
      if (!t) return;
      now = Math.max(now, t.at);
      if (t.every) t.at += t.every; else timers.delete(id);
      try { t.fn(...t.args); } catch (e) { console.error(e); }
    }
  }

  /** Seeks every animation to its age on this clock (the document timeline is frozen). */
  function seekAnimations() {
    for (const a of document.getAnimations()) {
      let b = born.get(a);
      if (!b) { b = { at: now, from: Number(a.currentTime) || 0 }; born.set(a, b); }
      if (a.playState === 'paused' || a.playState === 'finished') continue;
      const t = b.from + (now - b.at) * (a.playbackRate || 1);
      if (Math.abs((Number(a.currentTime) || 0) - t) > 0.5) a.currentTime = t;
    }
  }

  window.__clock = {
    get now() { return now; },
    /** One frame: time moves on by `ms`, due timers run, then the frame callbacks, then animations. */
    frame(ms) {
      const end = now + ms;
      runTimers(end);
      now = end;
      const due = [...frames];
      frames.clear();
      for (const [, fn] of due) { try { fn(now); } catch (e) { console.error(e); } }
      runTimers(now); // a callback that set a zero-delay timer
      seekAnimations();
      return now;
    },
    /** Many frames at once (no capture in between). */
    run(ms, step = 1000 / 30) {
      for (let t = 0; t < ms - 1e-6; t += step) this.frame(Math.min(step, ms - t));
      return now;
    },
    pending: () => ({ timers: timers.size, frames: frames.size }),
  };
})();
