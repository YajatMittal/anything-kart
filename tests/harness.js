// Test harness for the steering system. Injected into the page (not part of the game).
// Synthetic MediaPipe hands (21 landmarks) + drawn objects + a virtual clock.
window.__H = (() => {
  const ak = window.__ak, V = ak.vision, H = ak.hands, PW = 320, PH = 240;
  const realNow = performance.now.bind(performance);
  let clock = realNow();
  performance.now = () => clock;
  window.requestAnimationFrame = () => 0;           // stop the game loop: tests drive every frame
  V.update = () => false; H.update = () => {};
  let rnd = 12345; const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647 - 0.5; };
  const MODEL = [[0, 0], [0.25, 0.35], [0.45, 0.55], [0.6, 0.7], [0.75, 0.82], [0.95, 0.35], [1.35, 0.38], [1.6, 0.4], [1.8, 0.41], [1, 0.1], [1.45, 0.1], [1.75, 0.1], [1.95, 0.1],
    [0.95, -0.15], [1.38, -0.17], [1.62, -0.18], [1.8, -0.19], [0.85, -0.38], [1.2, -0.42], [1.38, -0.45], [1.52, -0.47]];
  // one hand as MediaPipe would report it (normalised, un-mirrored camera picture unless the camera mirrors)
  function handRaw(palm, axisDeg, size, side, noise) {
    const a = axisDeg * Math.PI / 180, u = { x: Math.cos(a), y: Math.sin(a) }, v = { x: -u.y, y: u.x }, sg = side === 'L' ? 1 : -1;
    const w = { x: palm.x - 0.75 * size * u.x, y: palm.y - 0.75 * size * u.y };
    const pts = MODEL.map(([mu, mv]) => {
      const x = w.x + size * (mu * u.x + sg * mv * v.x) + rand() * noise, y = w.y + size * (mu * u.y + sg * mv * v.y) + rand() * noise;
      return [V.flip ? 1 - x / PW : x / PW, y / PH];
    });
    return { score: 0.95, side: (side === 'L') === V.flip ? 'Right' : 'Left', pts };
  }
  // pose: theta (deg, + = clockwise in the player's view), mid {x,y} (player view px), gap, size,
  // seen: which hands the tracker reports ('both'|'L'|'R'|'none'), present: which are physically there
  function hands(p) {
    const th = (p.theta || 0) * Math.PI / 180, d = { x: Math.cos(th), y: Math.sin(th) };
    const L = { x: p.mid.x - p.gap / 2 * d.x, y: p.mid.y - p.gap / 2 * d.y }, R = { x: p.mid.x + p.gap / 2 * d.x, y: p.mid.y + p.gap / 2 * d.y };
    const jit = p.jitter || 0, j = (q) => ({ x: q.x + rand() * jit, y: q.y + rand() * jit });
    return { L: j(L), R: j(R), aL: -70 + (p.theta || 0) + (p.rollNoise ? rand() * p.rollNoise : 0), aR: -110 + (p.theta || 0) + (p.rollNoise ? rand() * p.rollNoise : 0) };
  }
  const toCanvas = (q) => ({ x: V.flip ? 640 - 2 * q.x : 2 * q.x, y: 2 * q.y });
  const OBJ = {
    plate: (c, g) => { c.fillStyle = '#efece3'; c.beginPath(); c.arc(0, 0, g * 0.48, 0, 7); c.fill(); c.strokeStyle = '#cfc7b3'; c.lineWidth = g * 0.05; c.beginPath(); c.arc(0, 0, g * 0.38, 0, 7); c.stroke(); },
    remote: (c, g) => { c.fillStyle = '#2b2b2e'; c.fillRect(-g * 0.6, -g * 0.15, g * 1.2, g * 0.3); for (let i = 0; i < 5; i++) { c.fillStyle = ['#e63946', '#2a9d8f', '#e9c46a', '#fff', '#fff'][i]; c.beginPath(); c.arc(-g * 0.35 + i * g * 0.16, 0, g * 0.045, 0, 7); c.fill(); } },
    book: (c, g) => { c.fillStyle = '#2a5ea8'; c.fillRect(-g * 0.52, -g * 0.36, g * 1.04, g * 0.72); c.fillStyle = '#fff'; c.fillRect(-g * 0.36, -g * 0.22, g * 0.72, g * 0.1); c.fillRect(-g * 0.36, -g * 0.04, g * 0.5, g * 0.06); c.fillStyle = '#e9c46a'; c.fillRect(-g * 0.36, g * 0.12, g * 0.3, g * 0.1); },
    // an irregular thing: a lumpy toy shape with a few markings
    blob: (c, g) => { c.fillStyle = '#8e44ad'; c.beginPath(); c.moveTo(-g * 0.5, -g * 0.1); c.lineTo(-g * 0.2, -g * 0.38); c.lineTo(g * 0.15, -g * 0.2); c.lineTo(g * 0.5, -g * 0.3); c.lineTo(g * 0.42, g * 0.25); c.lineTo(g * 0.05, g * 0.15); c.lineTo(-g * 0.3, g * 0.36); c.closePath(); c.fill(); c.fillStyle = '#f1c40f'; c.fillRect(-g * 0.25, -g * 0.15, g * 0.14, g * 0.14); c.fillStyle = '#fff'; c.beginPath(); c.arc(g * 0.25, 0, g * 0.07, 0, 7); c.fill(); c.fillRect(-g * 0.05, g * 0.0, g * 0.12, g * 0.06); },
    // plain ball: nothing on it shows which way it is turned
    ball: (c, g) => { c.fillStyle = '#f28c28'; c.beginPath(); c.arc(0, 0, g * 0.42, 0, 7); c.fill(); },
    bottle: (c, g) => { c.fillStyle = '#3fa37c'; c.beginPath(); c.roundRect(-g * 0.6, -g * 0.16, g * 1.2, g * 0.32, g * 0.12); c.fill(); c.fillStyle = '#fff'; c.fillRect(-g * 0.15, -g * 0.16, g * 0.3, g * 0.32); c.fillStyle = '#c0392b'; c.fillRect(-g * 0.08, -g * 0.06, g * 0.16, g * 0.12); },
  };
  function scene(p, hp) {
    const c = V.fake.ctx;
    const wall = c.createLinearGradient(0, 0, 0, 480); wall.addColorStop(0, '#d9d2c3'); wall.addColorStop(1, '#c4bba8');
    c.fillStyle = wall; c.fillRect(0, 0, 640, 480);
    c.fillStyle = '#7a8fa6'; c.fillRect(40, 40, 140, 110); c.fillStyle = '#a6c4e0'; c.fillRect(48, 48, 124, 94);
    c.fillStyle = '#6b4f33'; c.fillRect(470, 90, 150, 12);
    c.fillStyle = p.shirt || '#2f5d62'; c.beginPath(); c.ellipse(320, 480, 200, 170, 0, Math.PI, 0); c.fill();
    c.fillStyle = '#e0ac69'; c.beginPath(); c.arc(320, 150, 58, 0, 7); c.fill();
    c.fillStyle = '#3b2a1a'; c.beginPath(); c.arc(320, 122, 60, Math.PI, 0); c.fill();
    if (p.obj) {
      const m = toCanvas(p.mid); c.save(); c.translate(m.x, m.y); c.rotate((V.flip ? -1 : 1) * (p.theta || 0) * Math.PI / 180);
      OBJ[p.obj](c, p.gap * 2);
      c.restore();
    }
    c.fillStyle = '#d9a066';
    const present = p.present || p.seen || 'both';
    for (const k of ['L', 'R']) if (present === 'both' || present === k) { const q = toCanvas(hp[k]); c.beginPath(); c.ellipse(q.x, q.y, p.size * 0.9, p.size * 1.3, 0, 0, 7); c.fill(); }
  }
  let lastP = null;
  function step(p, n = 1) {
    for (let i = 0; i < n; i++) {
      let q = typeof p === 'function' ? p(i) : p;
      // real hands and objects can't teleport: limit how far the pose moves in one frame
      // (about 300 degrees/s of turn and 500 px/s of travel, both very fast for a person)
      if (lastP && !q.teleport) {
        const lim = (v, pv, m) => pv + Math.max(-m, Math.min(m, v - pv));
        q = { ...q, theta: lim(q.theta || 0, lastP.theta || 0, 10), mid: { x: lim(q.mid.x, lastP.mid.x, 16), y: lim(q.mid.y, lastP.mid.y, 16) }, gap: lim(q.gap, lastP.gap, lastP.gap * 0.05) };
      }
      lastP = q;
      clock += 1000 / 30;
      const hp = hands(q);
      scene(q, hp);
      const seen = q.seen || 'both', raw = [];
      if (seen === 'both' || seen === 'L') raw.push(handRaw(hp.L, hp.aL, q.size, 'L', q.noise ?? 1));
      if (seen === 'both' || seen === 'R') raw.push(handRaw(hp.R, hp.aR, q.size, 'R', q.noise ?? 1));
      for (const e of q.extra || []) raw.push(handRaw(e, e.axis ?? -90, q.size, e.side || 'L', 1));
      H.apply(raw, clock / 1000);
      V.process(V.fake.canvas, clock / 1000);
      if (document.querySelector('#screen-calib.active')) ak.calibTick(1 / 30, clock); else ak.tick(clock);
    }
  }
  const ch = (z = 0) => V.engines[z];
  return { step, ch, get clock() { return clock; }, ak, V, H, seed(n) { rnd = n; } };
})();
'harness ready';
