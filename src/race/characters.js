import * as THREE from '../../vendor/three/three.module.js';

// The cast: original helmeted racers, modelled entirely in code. Each has a
// helmet design you can recognise from behind, and eyes behind the visor that
// react during the race. Menu portraits are rendered from the same 3D models.

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.05, ...opts });
const mesh = (g, geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };
const pair = (fn) => { fn(-1); fn(1); };
const keep = (t) => { t.colorSpace = THREE.SRGBColorSpace; t.userData.keep = true; return t; };   // shared between races

// ---------------------------------------------------------------- eyes behind the visor
const visorCache = new Map();

function drawVisor(mood, skin) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const g = c.getContext('2d'), y = 50, L = 96, R = 160;
  g.fillStyle = skin; g.fillRect(0, 0, 256, 96);
  const eyes = (fn) => { fn(L, -1); fn(R, 1); };
  const brow = (x, s, tilt) => { g.save(); g.translate(x, y - 24); g.rotate(s * tilt); g.fillStyle = '#2a1d17'; g.fillRect(-15, -3, 30, 6); g.restore(); };
  g.strokeStyle = '#1b1514'; g.lineWidth = 6; g.lineCap = 'round';
  if (mood === 'hit') {
    eyes((x) => { g.beginPath(); for (let a = 0; a < Math.PI * 4; a += 0.3) { const r = a * 2.1; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.8); } g.stroke(); });
  } else if (mood === 'blink') {
    eyes((x) => { g.beginPath(); g.moveTo(x - 13, y); g.lineTo(x + 13, y); g.stroke(); brow(x, 0, 0); });
  } else if (mood === 'win') {
    eyes((x) => { g.beginPath(); g.arc(x, y + 7, 13, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); brow(x, 0, 0); });
  } else {
    const h = mood === 'focus' ? 9 : 15, look = mood === 'worried' ? -3 : 3;
    eyes((x, s) => {
      g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(x, y, 13, h, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1b1514'; g.beginPath(); g.arc(x + look, y + 1, Math.min(8, h - 2), 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x + look + 3, y - 3, 2.5, 0, Math.PI * 2); g.fill();
      brow(x, s, mood === 'boost' || mood === 'focus' ? 0.32 : mood === 'worried' ? -0.35 : 0);
    });
  }
  // tinted glass with a highlight
  g.fillStyle = 'rgba(14, 26, 38, 0.2)'; g.fillRect(0, 0, 256, 96);
  const glare = g.createLinearGradient(0, 0, 256, 96);
  glare.addColorStop(0.15, 'rgba(255,255,255,0)'); glare.addColorStop(0.28, 'rgba(255,255,255,0.35)'); glare.addColorStop(0.36, 'rgba(255,255,255,0)');
  g.fillStyle = glare; g.fillRect(0, 0, 256, 96);
  return keep(new THREE.CanvasTexture(c));
}

function visorTexture(mood, skin) {
  const key = mood + skin;
  if (!visorCache.has(key)) visorCache.set(key, drawVisor(mood, skin));
  return visorCache.get(key);
}

// Helmet paint is drawn on a canvas that wraps the helmet: x = around (0 left side,
// 0.25 front, 0.5 right side, 0.75 back), y = top to bottom.
const helmetCache = new Map(), numberCache = new Map();   // drawn once per racer, reused every race
function helmetTexture(o) {
  if (helmetCache.has(o.id)) return helmetCache.get(o.id);
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d'), W = 512, H = 256, back = W * 0.75;
  g.fillStyle = o.color; g.fillRect(0, 0, W, H);
  g.fillStyle = o.accent; g.strokeStyle = o.accent;
  const band = (x, w) => { g.fillRect(x - w / 2, 0, w, H * 0.62); };
  switch (o.pattern) {
    case 'stripe': band(W * 0.25, 30); band(back, 30); g.fillStyle = '#fff'; band(W * 0.25 - 26, 8); band(W * 0.25 + 26, 8); band(back - 26, 8); band(back + 26, 8); break;
    case 'split': g.fillRect(W * 0.5, 0, W * 0.5, H); break;
    case 'checker': for (let x = 0; x < W; x += 32) for (let y = 0; y < H * 0.45; y += 32) if (((x + y) / 32) % 2 === 0) g.fillRect(x, y, 32, 32); break;
    case 'bolt': for (const cx of [W * 0.5 + 10, W - 30]) { g.beginPath(); g.moveTo(cx, 20); g.lineTo(cx - 40, 120); g.lineTo(cx - 6, 116); g.lineTo(cx - 30, 210); g.lineTo(cx + 34, 92); g.lineTo(cx, 96); g.closePath(); g.fill(); } break;
    case 'dots': for (let x = 16; x < W; x += 44) for (let y = 18; y < H * 0.6; y += 44) { g.beginPath(); g.arc(x + (y % 88 ? 22 : 0), y, 11, 0, Math.PI * 2); g.fill(); } break;
    case 'chevron': g.lineWidth = 22; for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(back - 90, 40 + k * 46); g.lineTo(back, 80 + k * 46); g.lineTo(back + 90, 40 + k * 46); g.stroke(); } break;
    case 'wave': g.lineWidth = 20; for (const y0 of [60, 120]) { g.beginPath(); for (let x = 0; x <= W; x += 8) g.lineTo(x, y0 + Math.sin(x / 26) * 16); g.stroke(); } break;
    case 'zigzag': g.lineWidth = 18; g.beginPath(); for (let x = 0; x <= W; x += 32) g.lineTo(x, (x / 32) % 2 ? 70 : 110); g.stroke(); break;
    case 'band': g.fillRect(0, 96, W, 46); g.fillStyle = '#fff'; g.fillRect(0, 90, W, 6); g.fillRect(0, 142, W, 6); break;
    case 'triangles': for (let x = 0; x < W; x += 48) { g.beginPath(); g.moveTo(x, 130); g.lineTo(x + 24, 60); g.lineTo(x + 48, 130); g.fill(); } break;
    case 'halo': g.fillRect(0, 0, W, 54); break;
    case 'flare': for (let k = 0; k < 7; k++) { g.beginPath(); g.moveTo(back - 70 + k * 20, 150); g.lineTo(back - 60 + k * 20, 20 + (k % 2) * 30); g.lineTo(back - 50 + k * 20, 150); g.fill(); } break;
  }
  // racing number on both sides
  g.font = '64px "Lilita One", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const x of [W * 0.02, W * 0.5, W * 0.98]) {
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x, 112, 38, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#16302b'; g.fillText(String(o.number), x, 116);
  }
  const t = keep(new THREE.CanvasTexture(c));
  t.anisotropy = 4;
  helmetCache.set(o.id, t);
  return t;
}

// Shared body plan: a racing suit, gloves on the wheel, and a full-face helmet.
function driver(g, o) {
  const suit = mat(o.color), trim = mat(o.accent), glove = mat(0x22252d);
  g.userData.spin = [];
  const torso = mesh(g, new THREE.CapsuleGeometry(0.42, 0.42, 6, 14), suit, 0, 0.95, 0); torso.scale.set(1.05, 1, 0.82);
  mesh(g, new THREE.BoxGeometry(0.2, 0.56, 0.02), trim, 0, 0.98, 0.35);
  if (!numberCache.has(o.id)) {
    const num = document.createElement('canvas'); num.width = 128; num.height = 128;
    const n = num.getContext('2d'); n.fillStyle = '#fff'; n.beginPath(); n.arc(64, 64, 58, 0, Math.PI * 2); n.fill();
    n.fillStyle = '#16302b'; n.font = '78px "Lilita One", system-ui, sans-serif'; n.textAlign = 'center'; n.textBaseline = 'middle'; n.fillText(String(o.number), 64, 70);
    numberCache.set(o.id, keep(new THREE.CanvasTexture(num)));
  }
  const plate = mesh(g, new THREE.CircleGeometry(0.22, 24), new THREE.MeshBasicMaterial({ map: numberCache.get(o.id) }), 0, 1.0, -0.36);
  plate.rotation.y = Math.PI;
  mesh(g, new THREE.CylinderGeometry(0.17, 0.2, 0.16, 12), trim, 0, 1.4, 0);
  pair((s) => {
    mesh(g, new THREE.SphereGeometry(0.17, 12, 10), suit, s * 0.44, 1.22, 0.02);
    const arm = mesh(g, new THREE.CapsuleGeometry(0.1, 0.42, 4, 8), suit, s * 0.46, 1.06, 0.34);
    arm.rotation.x = 1.15; arm.rotation.z = -s * 0.22;
    mesh(g, new THREE.SphereGeometry(0.13, 10, 8), glove, s * 0.33, 1.06, 0.66);
  });

  const head = new THREE.Group(); head.position.set(0, 1.86, 0.02); head.scale.setScalar(1.18); g.add(head);
  g.userData.head = head;
  const R = 0.5;
  mesh(head, new THREE.SphereGeometry(R, 32, 20), mat(0xffffff, { map: helmetTexture(o), roughness: 0.25, metalness: 0.1 }));
  // visor: a curved window on the front of the helmet
  const visorMat = new THREE.MeshBasicMaterial({ map: visorTexture('happy', o.skin), toneMapped: false });
  mesh(head, new THREE.SphereGeometry(R * 1.015, 32, 10, Math.PI / 2 - 0.95, 1.9, 1.08, 0.66), visorMat);
  let current = 'happy';
  g.userData.face = { set(mood) { if (mood !== current) { current = mood; visorMat.map = visorTexture(mood, o.skin); } } };

  const extra = mat(o.accent);
  switch (o.extra) {
    case 'fin': { const f = mesh(head, new THREE.ConeGeometry(0.2, 0.42, 3), extra, 0, 0.48, -0.12); f.scale.z = 2.2; f.rotation.x = -0.35; break; }
    case 'crest': for (let k = 0; k < 5; k++) mesh(head, new THREE.ConeGeometry(0.06, 0.22, 5), extra, 0, 0.46 + Math.sin(k * 0.7) * 0.03, 0.22 - k * 0.12); break;
    case 'ponytail': { const p = mesh(head, new THREE.CapsuleGeometry(0.1, 0.5, 4, 8), mat(o.hair ?? 0x3b2416), 0, -0.25, -0.5); p.rotation.x = 0.5; break; }
    case 'ears': pair((s) => { const e = mesh(head, new THREE.ConeGeometry(0.13, 0.24, 4), extra, s * 0.3, 0.43, 0); e.rotation.z = -s * 0.35; }); break;
    case 'antenna': mesh(head, new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), mat(0x16302b), 0.22, 0.62, -0.12); mesh(head, new THREE.SphereGeometry(0.07, 10, 8), extra, 0.22, 0.88, -0.12); break;
    case 'goggles': { const b = mesh(head, new THREE.TorusGeometry(0.5, 0.05, 6, 28), mat(0x3a2a20), 0, 0.2, 0); b.rotation.x = Math.PI / 2 - 0.3; pair((s) => { const l = mesh(head, new THREE.CylinderGeometry(0.11, 0.11, 0.08, 14), mat(0xb7e3ff, { roughness: 0.1 }), s * 0.16, 0.37, 0.36); l.rotation.x = 1.0; }); break; }
    case 'spoiler': mesh(head, new THREE.BoxGeometry(0.62, 0.05, 0.2), extra, 0, 0.46, -0.36); pair((s) => mesh(head, new THREE.BoxGeometry(0.04, 0.14, 0.14), extra, s * 0.18, 0.4, -0.33)); break;
    case 'propeller': { const p = new THREE.Group(); p.position.y = 0.58; head.add(p); mesh(head, new THREE.CylinderGeometry(0.03, 0.03, 0.12, 6), mat(0x16302b), 0, 0.52, 0); pair((s) => mesh(p, new THREE.BoxGeometry(0.4, 0.025, 0.09), extra, s * 0.2, 0, 0)); g.userData.spin.push([p, 'y', 6]); break; }
  }
}

const racer = (id, name, kind, color, accent, skin, pattern, extra, number, speed, accel, handling, more = {}) =>
  ({ id, name, kind, color, accent, skin, pattern, extra, number, speed, accel, handling, ...more, build(g) { driver(g, this); } });

export const CHARACTERS = [
  racer('ava', 'Ava', 'All-rounder', '#f26b21', '#ffffff', '#f1c7a5', 'stripe', 'none', 7, 1.0, 1.0, 1.0),
  racer('kai', 'Kai', 'Balanced', '#12a594', '#f6e05e', '#c68a5c', 'wave', 'fin', 12, 0.99, 1.02, 1.04),
  racer('zara', 'Zara', 'Quick starter', '#f5b700', '#16302b', '#8d5a3b', 'bolt', 'ponytail', 3, 0.97, 1.1, 1.05, { hair: 0x1f140e }),
  racer('leo', 'Leo', 'Top speed', '#e63946', '#ffffff', '#f5d5b8', 'checker', 'spoiler', 1, 1.05, 0.93, 0.95),
  racer('priya', 'Priya', 'Great grip', '#3d7fd1', '#ffd166', '#b07650', 'chevron', 'ponytail', 21, 0.98, 1.03, 1.1, { hair: 0x241510 }),
  racer('mia', 'Mia', 'Nimble', '#f472b6', '#ffffff', '#e8b896', 'dots', 'ears', 8, 0.97, 1.07, 1.09),
  racer('omar', 'Omar', 'Slick drifter', '#8b5cf6', '#7dffd6', '#9a6a45', 'zigzag', 'antenna', 44, 1.02, 0.98, 1.02),
  racer('jax', 'Jax', 'Heavy hitter', '#3fa34d', '#16302b', '#e0ac7e', 'triangles', 'crest', 99, 1.05, 0.92, 0.94),
  racer('rosa', 'Rosa', 'Steady', '#b86b34', '#ffe0b0', '#c98c63', 'band', 'goggles', 5, 1.03, 0.96, 0.98),
  racer('nia', 'Nia', 'Light and quick', '#5fd3c4', '#16302b', '#5e3a26', 'split', 'propeller', 11, 0.98, 1.08, 1.02),
  racer('theo', 'Theo', 'Fast cornerer', '#2f4b7c', '#ff7b2e', '#f0c19c', 'flare', 'fin', 27, 1.03, 0.95, 1.01),
  racer('hugo', 'Hugo', 'Tiny turner', '#a3d10f', '#16302b', '#d39a6c', 'halo', 'none', 64, 0.96, 1.1, 1.1),
];

export function charById(id) { return CHARACTERS.find((c) => c.id === id) || CHARACTERS[0]; }

// Render one small portrait per character from its 3D model.
export function makePortraits() {
  const size = 192;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch { return; }                                   // no WebGL: the UI falls back to coloured discs
  renderer.setSize(size, size); renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcbb9a0, 2.3));
  const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(2, 4, 5); scene.add(sun);
  const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  for (const ch of CHARACTERS) {
    const g = new THREE.Group();
    ch.build(g);
    g.rotation.y = 0.32;
    scene.add(g);
    const y = g.userData.head.position.y - 0.18;
    cam.position.set(0.25, y + 0.15, 3.6); cam.lookAt(0, y, 0);
    renderer.render(scene, cam);
    ch.portrait = renderer.domElement.toDataURL('image/png');
    scene.remove(g);
    g.traverse((o) => { o.geometry?.dispose(); });
  }
  renderer.dispose();
  renderer.forceContextLoss?.();
}
