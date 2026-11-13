import * as THREE from '../../vendor/three/three.module.js';

// Everything is drawn from code (canvas textures + low-poly shapes) — no asset files.

export function canvasTex(w, h, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 8;
  return t;
}

export function labelTexture(text, bg, fg = '#fff') {
  return canvasTex(128, 64, (c) => {
    c.fillStyle = bg; c.beginPath(); c.roundRect(4, 4, 120, 56, 18); c.fill();
    c.lineWidth = 5; c.strokeStyle = '#fff'; c.stroke();
    c.fillStyle = fg; c.font = '38px "Lilita One", system-ui, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 64, 34);
  });
}

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const low = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...opts });
const mesh = (g, geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };

const THEMES = {
  coast: { skyTop: '#2f9fe6', skyBottom: '#e2f6ff', fog: 0xdff3fb, fogNear: 260, fogFar: 1500, hemiSky: 0xffffff, hemiGround: 0xe8cf9f, hemi: 1.9, sun: 2.6, sunColor: 0xfff1d6, curb: ['#14a3a8', '#ffffff'] },
  snow: { skyTop: '#6ea8dc', skyBottom: '#f0f7fc', fog: 0xe8f1f8, fogNear: 200, fogFar: 1150, hemiSky: 0xffffff, hemiGround: 0xcfe0f0, hemi: 2.0, sun: 2.0, sunColor: 0xf3f7ff, curb: ['#ef6c2f', '#ffffff'] },
  canyon: { skyTop: '#e8643c', skyBottom: '#ffdca6', fog: 0xffd3a0, fogNear: 240, fogFar: 1300, hemiSky: 0xffe9cc, hemiGround: 0xb5623a, hemi: 1.8, sun: 2.8, sunColor: 0xffd9a8, curb: ['#5b3a29', '#e8c39a'] },
};

function ribbonGeometry(track, latA, latB, vScale, yA = 0, yB = 0, vertical = false) {
  const N = track.N, pos = [], uv = [], idx = [];
  for (let k = 0; k <= N; k++) {
    const i = k % N, v = track.dist[k] / vScale;
    const ax = track.x[i] + track.nx[i] * latA, az = track.z[i] + track.nz[i] * latA;
    const bx = track.x[i] + track.nx[i] * latB, bz = track.z[i] + track.nz[i] * latB;
    if (vertical) pos.push(ax, yA, az, ax, yB, az); else pos.push(ax, yA, az, bx, yB, bz);
    uv.push(0, v, 1, v);
    if (k < N) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function placeOnTrack(obj, track, i, lat, yOff = 0) {
  const p = track.point(i, lat);
  obj.position.set(p.x, yOff, p.z);
  obj.rotation.y = track.heading(i);
}

function instanced(geo, mat, list, shadow = true) {
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  const d = new THREE.Object3D();
  list.forEach((t, k) => {
    d.position.set(t.x, t.y || 0, t.z);
    d.rotation.set(t.rx || 0, t.r || 0, t.rz || 0);
    if (t.sv) d.scale.set(...t.sv); else d.scale.setScalar(t.s || 1);
    d.updateMatrix(); m.setMatrixAt(k, d.matrix);
  });
  m.instanceMatrix.needsUpdate = true;
  m.castShadow = shadow;
  return m;
}

const noisy = (c, w, h, r, n, a, b, size = 2) => {
  for (let k = 0; k < n; k++) { c.fillStyle = r() < 0.5 ? a : b; c.fillRect(r() * w, r() * h, size, size); }
};

export class World {
  constructor(track, quality = 'high') {
    this.track = track;
    this.low = quality === 'low';
    const th = this.theme = THEMES[track.def.theme];
    const scene = this.scene = new THREE.Scene();
    scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);
    this.animated = [];
    this.rand = rng(track.def.id.length * 977 + 13);
    this.buildLights();
    this.buildSky();
    this.buildGround();
    this.buildRoad();
    this[`build_${track.def.theme}`]();
    this.buildStart();
    this.buildShared();
  }

  buildLights() {
    const th = this.theme, b = this.track.bounds;
    this.scene.add(new THREE.HemisphereLight(th.hemiSky, th.hemiGround, th.hemi));
    const sun = new THREE.DirectionalLight(th.sunColor, th.sun);
    sun.position.set(b.cx + 260, 520, b.cz + 200);
    sun.target.position.set(b.cx, 0, b.cz);
    sun.castShadow = true;
    const R = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.5 + 160;
    Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 50, far: 1500 });
    sun.shadow.mapSize.setScalar(this.low ? 1536 : 4096);
    sun.shadow.bias = -0.0006;
    this.scene.add(sun, sun.target);
  }

  buildSky() {
    const th = this.theme, R = 2200;
    const geo = new THREE.SphereGeometry(R, 32, 16);
    const top = new THREE.Color(th.skyTop), bot = new THREE.Color(th.skyBottom), cols = [];
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = Math.min(1, Math.max(0, p.getY(i) / R * 2.2));
      const c = bot.clone().lerp(top, Math.pow(t, 0.7));
      cols.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
    sky.position.set(this.track.bounds.cx, 0, this.track.bounds.cz);
    sky.renderOrder = -1;
    this.scene.add(sky);
    const r = this.rand, puffs = [], cloud = low(0xffffff, { emissive: 0xbbbbbb, fog: false });
    for (let k = 0; k < (this.low ? 7 : 16); k++) {
      const a = r() * Math.PI * 2, d = 500 + r() * 900, cx = this.track.bounds.cx + Math.cos(a) * d, cz = this.track.bounds.cz + Math.sin(a) * d, cy = 190 + r() * 150;
      for (let j = 0; j < 5; j++) puffs.push({ x: cx + (j - 2) * 34, y: cy + r() * 14, z: cz + r() * 26, s: 0.7 + r() * 0.9, r: r() * 6 });
    }
    this.scene.add(instanced(new THREE.IcosahedronGeometry(30, 1), cloud, puffs, false));
  }

  buildGround() {
    const tr = this.track, t = tr.def.theme, b = tr.bounds;
    const paint = {
      coast: (c, w, h, r) => { c.fillStyle = '#efd9a7'; c.fillRect(0, 0, w, h); noisy(c, w, h, r, 3200, 'rgba(190,150,90,.22)', 'rgba(255,245,215,.35)'); },
      snow: (c, w, h, r) => { c.fillStyle = '#f4f9fd'; c.fillRect(0, 0, w, h); noisy(c, w, h, r, 1800, 'rgba(180,210,235,.2)', 'rgba(255,255,255,.7)', 3); },
      canyon: (c, w, h, r) => { c.fillStyle = '#c96f3f'; c.fillRect(0, 0, w, h); noisy(c, w, h, r, 3200, 'rgba(120,55,25,.2)', 'rgba(240,170,110,.22)', 3); },
    }[t];
    const R = rng(3);
    const tex = canvasTex(256, 256, (c, w, h) => paint(c, w, h, R), 150, 150);
    const size = 3600;
    const ground = new THREE.Mesh(t === 'coast' ? new THREE.CircleGeometry(Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.5 + 270, 64) : new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ map: tex }));
    if (t === 'coast') tex.repeat.set(70, 70);
    ground.rotation.x = -Math.PI / 2; ground.position.set(b.cx, -0.02, b.cz);
    ground.receiveShadow = true;
    this.scene.add(ground);
    if (t === 'coast') {
      const seaTex = canvasTex(256, 256, (c, w, h) => {
        c.fillStyle = '#19a7c9'; c.fillRect(0, 0, w, h);
        const r2 = rng(5);
        for (let k = 0; k < 90; k++) { c.fillStyle = `rgba(255,255,255,${0.08 + r2() * 0.18})`; c.fillRect(r2() * w, r2() * h, 14 + r2() * 30, 2); }
      }, 90, 90);
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(4400, 4400), new THREE.MeshLambertMaterial({ map: seaTex }));
      sea.rotation.x = -Math.PI / 2; sea.position.set(b.cx, -0.9, b.cz);
      this.scene.add(sea);
      this.animated.push((time) => { seaTex.offset.set(time * 0.05, time * 0.02); });
    }
  }

  buildRoad() {
    const tr = this.track, t = tr.def.theme, hw = tr.halfW, th = this.theme;
    const R = rng(7);
    const roadTex = canvasTex(256, 256, (c, w, h) => {
      const base = { coast: '#51565f', snow: '#5f6a78', canyon: '#8a5636' }[t];
      c.fillStyle = base; c.fillRect(0, 0, w, h);
      noisy(c, w, h, R, 2800, 'rgba(0,0,0,.09)', 'rgba(255,255,255,.08)');
      c.fillStyle = t === 'canyon' ? '#e9c9a0' : '#f7f7f4'; c.fillRect(9, 0, 7, h); c.fillRect(w - 16, 0, 7, h);
      c.fillStyle = { coast: '#ffcf33', snow: '#ffffff', canyon: '#f4d6ae' }[t]; c.fillRect(w / 2 - 3, 0, 6, h * 0.5);
    });
    const road = new THREE.Mesh(ribbonGeometry(tr, hw, -hw, 14, 0.04, 0.04), new THREE.MeshLambertMaterial({ map: roadTex, side: THREE.DoubleSide }));
    road.receiveShadow = true;
    this.scene.add(road);

    const curbTex = canvasTex(32, 64, (c, w, h) => { c.fillStyle = th.curb[0]; c.fillRect(0, 0, w, h / 2); c.fillStyle = th.curb[1]; c.fillRect(0, h / 2, w, h / 2); });
    const curbMat = new THREE.MeshLambertMaterial({ map: curbTex, side: THREE.DoubleSide });
    this.scene.add(new THREE.Mesh(ribbonGeometry(tr, hw + 1.5, hw, 5, 0.07, 0.07), curbMat));
    this.scene.add(new THREE.Mesh(ribbonGeometry(tr, -hw, -hw - 1.5, 5, 0.07, 0.07), curbMat));

    const shoulderCol = { coast: 0xe5cd95, snow: 0xdfeaf4, canyon: 0xb65f35 }[t];
    const shoulder = new THREE.MeshLambertMaterial({ color: shoulderCol, side: THREE.DoubleSide });
    for (const s of [1, -1]) { const m = new THREE.Mesh(ribbonGeometry(tr, s * (hw + 1.5), s * tr.fence, 12, 0.02, 0.02), shoulder); m.receiveShadow = true; this.scene.add(m); }

    const height = t === 'canyon' ? 5 : 1.8;
    const fenceTex = canvasTex(256, 128, (c, w, h) => {
      if (t === 'canyon') {
        c.fillStyle = '#a4502c'; c.fillRect(0, 0, w, h);
        const r = rng(11);
        for (let k = 0; k < 9; k++) { c.fillStyle = k % 2 ? 'rgba(90,40,20,.28)' : 'rgba(225,150,100,.2)'; c.fillRect(0, k * 14 + r() * 6, w, 7 + r() * 8); }
        for (let k = 0; k < 40; k++) { c.fillStyle = `rgba(${r() < 0.5 ? '70,30,15' : '225,150,100'},.25)`; c.fillRect(r() * w, r() * h, 22, 3); }
      } else if (t === 'snow') {
        c.fillStyle = '#ff7a2f'; c.fillRect(0, 0, w, h);
        c.fillStyle = '#ffd9c2'; for (let k = 0; k < 4; k++) c.fillRect(0, k * 32 + 10, w, 10); c.fillRect(104, 0, 32, h);
      } else {
        c.fillStyle = '#b8824e'; c.fillRect(0, 0, w, h); c.fillStyle = '#8b5c31'; c.fillRect(0, 0, 32, h); c.fillRect(0, 58, w, 12);
      }
    });
    const fenceMat = new THREE.MeshLambertMaterial({ map: fenceTex, side: THREE.DoubleSide });
    for (const s of [1, -1]) { const f = new THREE.Mesh(ribbonGeometry(tr, s * tr.fence, s * tr.fence, 8, 0, height, true), fenceMat); f.castShadow = true; this.scene.add(f); }
  }

  buildStart() {
    const tr = this.track, hw = tr.halfW;
    const check = canvasTex(256, 32, (c, w, h) => {
      const s = h / 2;
      for (let x = 0; x < w / s; x++) for (let y = 0; y < 2; y++) { c.fillStyle = (x + y) % 2 ? '#15151a' : '#fff'; c.fillRect(x * s, y * s, s, s); }
    });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(tr.def.width, 3), new THREE.MeshBasicMaterial({ map: check, side: THREE.DoubleSide }));
    line.geometry.rotateX(-Math.PI / 2);
    placeOnTrack(line, tr, 0, 0, 0.1);
    this.scene.add(line);
    const banner = canvasTex(512, 96, (c, w, h) => {
      c.fillStyle = '#16302b'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffb627'; c.fillRect(0, h - 10, w, 10); c.fillRect(0, 0, w, 10);
      c.fillStyle = '#fff'; c.font = '56px "Lilita One", system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('ANYTHING KART', w / 2, h / 2 + 3);
    });
    const gantry = new THREE.Group();
    const wood = low(0x8b5c31);
    for (const s of [-1, 1]) { const p = mesh(gantry, new THREE.CylinderGeometry(0.7, 0.9, 11, 7), wood, s * (hw + 2.5), 5.5, 0); p.castShadow = true; }
    const top = mesh(gantry, new THREE.BoxGeometry(tr.def.width + 7, 3, 0.6), new THREE.MeshBasicMaterial({ map: banner }), 0, 10, 0); top.castShadow = true;
    placeOnTrack(gantry, tr, 0, 0);
    this.scene.add(gantry);
  }

  // Random spots beyond the fences, always clear of every part of the road.
  scatter(count, r, spread) {
    const tr = this.track, out = [], rand = this.rand, min = tr.fence + r + 3;
    if (this.low) count = Math.ceil(count * 0.45);
    let guard = 0;
    while (out.length < count && guard++ < count * 40) {
      const i = Math.floor(rand() * tr.N), side = rand() < 0.5 ? -1 : 1, off = min + rand() * spread;
      const p = tr.point(i, side * off);
      if (tr.clearance(p.x, p.z) < min) continue;
      out.push({ x: p.x, z: p.z, r: rand() * Math.PI * 2, s: 0.75 + rand() * 0.7 });
    }
    return out;
  }

  add(group, spot, scale = spot.s) {
    group.position.set(spot.x, 0, spot.z); group.rotation.y = spot.r; group.scale.setScalar(scale);
    group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(group);
    return group;
  }

  mountains(color, cap) {
    const b = this.track.bounds, r = this.rand, list = [], caps = [];
    const R = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.5 + 420;
    for (let k = 0; k < 26; k++) {
      const a = (k / 26) * Math.PI * 2 + r() * 0.1, d = R + r() * 260, s = 0.8 + r() * 1.1;
      const spot = { x: b.cx + Math.cos(a) * d, y: 60 * s, z: b.cz + Math.sin(a) * d, s, r: r() * 6 };
      list.push(spot); caps.push({ ...spot, y: 92 * s });
    }
    this.scene.add(instanced(new THREE.ConeGeometry(120, 120, 6), low(color), list, false));
    if (cap !== undefined) this.scene.add(instanced(new THREE.ConeGeometry(68, 56, 6), low(cap), caps, false));
  }

  build_coast() {
    const palms = this.scatter(70, 3, 120);
    this.scene.add(instanced((() => { const g = new THREE.CylinderGeometry(0.7, 1.1, 15, 6); g.translate(0, 7.5, 0); return g; })(), low(0x9b6b3f), palms));
    const leaf = new THREE.ConeGeometry(1.6, 9, 4); leaf.scale(1, 1, 0.3); leaf.rotateZ(-1.8); leaf.translate(4.2, 14.4, 0);
    const lm = low(0x2fa84f, { side: THREE.DoubleSide });
    for (let k = 0; k < 6; k++) this.scene.add(instanced(leaf, lm, palms.map((p) => ({ ...p, r: p.r + (k * Math.PI) / 3 }))));
    this.scene.add(instanced(new THREE.SphereGeometry(0.8, 8, 6), low(0x6b4226), palms.map((p) => ({ ...p, y: 14 * p.s, s: p.s }))));
    const rocks = this.scatter(30, 4, 170);
    this.scene.add(instanced(new THREE.DodecahedronGeometry(4, 0), low(0x9a958c), rocks.map((k) => ({ ...k, y: 1.5, sv: [k.s * 1.5, k.s, k.s * 1.2] }))));
    for (const spot of this.scatter(9, 7, 90)) {
      const g = new THREE.Group(), cols = [0xe63946, 0xffb627, 0x2ec4b6];
      mesh(g, new THREE.CylinderGeometry(0.16, 0.16, 7, 6), low(0xffffff), 0, 3.5, 0);
      mesh(g, new THREE.ConeGeometry(5, 2.4, 8), low(cols[Math.floor(this.rand() * 3)]), 0, 7.4, 0);
      mesh(g, new THREE.BoxGeometry(2, 0.3, 5), low(0xffffff), 3.4, 0.5, 1);
      this.add(g, spot);
    }
    for (const spot of this.scatter(5, 11, 120)) {
      const g = new THREE.Group();
      mesh(g, new THREE.BoxGeometry(13, 7, 11), low(0xf3e0bd), 0, 3.5, 0);
      const roof = mesh(g, new THREE.ConeGeometry(11, 6, 4), low(0x2ec4b6), 0, 10, 0); roof.rotation.y = Math.PI / 4;
      mesh(g, new THREE.BoxGeometry(3, 4.6, 0.3), low(0x8b5c31), 0, 2.3, 5.6);
      this.add(g, spot, 1);
    }
    const [lh] = this.scatter(1, 14, 80);
    if (lh) {
      const g = new THREE.Group();
      for (let k = 0; k < 5; k++) mesh(g, new THREE.CylinderGeometry(6 - k * 0.75, 6.75 - k * 0.75, 11, 10), low(k % 2 ? 0xffffff : 0xe63946), 0, 5.5 + k * 11, 0);
      mesh(g, new THREE.CylinderGeometry(2.9, 2.9, 5, 10), low(0xffe9a8, { emissive: 0xffc94a, emissiveIntensity: 0.8 }), 0, 62, 0);
      mesh(g, new THREE.ConeGeometry(4.2, 5, 10), low(0xe63946), 0, 67, 0);
      this.add(g, lh, 1);
    }
    const b = this.track.bounds, R = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.5 + 400;
    for (let k = 0; k < 7; k++) {
      const a = this.rand() * Math.PI * 2, g = new THREE.Group();
      mesh(g, new THREE.BoxGeometry(5, 3, 18), low(0xffffff), 0, 1, 0);
      const sail = mesh(g, new THREE.ConeGeometry(7, 22, 3), low(k % 2 ? 0xffb627 : 0xffffff), 0, 13, 0); sail.scale.z = 0.12;
      g.position.set(b.cx + Math.cos(a) * R, -0.9, b.cz + Math.sin(a) * R); g.rotation.y = a * 3;
      this.scene.add(g);
      this.animated.push((t) => { g.position.y = -0.9 + Math.sin(t + k) * 0.5; g.rotation.z = Math.sin(t * 0.8 + k) * 0.05; });
    }
  }

  build_snow() {
    this.mountains(0x7f95b0, 0xffffff);
    const pines = this.scatter(170, 4, 170);
    this.scene.add(instanced((() => { const g = new THREE.CylinderGeometry(0.6, 0.8, 3, 6); g.translate(0, 1.5, 0); return g; })(), low(0x6b4a2f), pines));
    const tiers = [[5, 7, 5.5, 0x2c6e55], [4, 6, 9, 0x35805f], [2.9, 5, 12.4, 0x3f936d]];
    for (const [r, h, y, col] of tiers) { const g = new THREE.ConeGeometry(r, h, 7); g.translate(0, y, 0); this.scene.add(instanced(g, low(col), pines)); }
    { const g = new THREE.ConeGeometry(1.9, 3, 7); g.translate(0, 14, 0); this.scene.add(instanced(g, low(0xffffff), pines)); }
    for (const spot of this.scatter(8, 6, 60)) {
      const g = new THREE.Group(), w = low(0xffffff);
      mesh(g, new THREE.IcosahedronGeometry(3, 1), w, 0, 2.6, 0); mesh(g, new THREE.IcosahedronGeometry(2.2, 1), w, 0, 6, 0); mesh(g, new THREE.IcosahedronGeometry(1.6, 1), w, 0, 8.6, 0);
      const nose = mesh(g, new THREE.ConeGeometry(0.3, 1.4, 6), low(0xff7a2f), 0, 8.6, 1.9); nose.rotation.x = Math.PI / 2;
      mesh(g, new THREE.CylinderGeometry(1.1, 1.1, 1.3, 8), low(0x1f2430), 0, 10.3, 0); mesh(g, new THREE.CylinderGeometry(1.7, 1.7, 0.2, 8), low(0x1f2430), 0, 9.7, 0);
      this.add(g, spot);
    }
    for (const spot of this.scatter(6, 13, 120)) {
      const g = new THREE.Group();
      mesh(g, new THREE.BoxGeometry(15, 8, 12), low(0x7a4b2a), 0, 4, 0);
      const roof = mesh(g, new THREE.ConeGeometry(12.5, 7, 4), low(0xf4f9fd), 0, 11.4, 0); roof.rotation.y = Math.PI / 4; roof.scale.z = 0.85;
      mesh(g, new THREE.BoxGeometry(3, 4.6, 0.3), low(0x4a2d18), 0, 2.3, 6.1);
      mesh(g, new THREE.BoxGeometry(2.6, 2.6, 0.3), low(0xffe39a, { emissive: 0xffc94a, emissiveIntensity: 0.9 }), 4.5, 4.6, 6.1);
      mesh(g, new THREE.BoxGeometry(2, 6, 2), low(0x8a8f99), 5, 13, 0);
      this.add(g, spot, 1);
    }
    const ice = this.scatter(26, 5, 160);
    this.scene.add(instanced(new THREE.OctahedronGeometry(4, 0), low(0xb9e4f7, { transparent: true, opacity: 0.85 }), ice.map((k) => ({ ...k, y: 2.5, sv: [k.s, k.s * 1.6, k.s] }))));
    // falling snow follows the action
    const pos = [], R = rng(9), n = this.low ? 280 : 900, W = 260;
    for (let k = 0; k < n; k++) pos.push((R() - 0.5) * W, R() * 90, (R() - 0.5) * W);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const flakes = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, transparent: true, opacity: 0.9, depthWrite: false }));
    flakes.frustumCulled = false;
    this.scene.add(flakes);
    this.animated.push((t, dt, fx, fz) => {
      const a = geo.attributes.position.array;
      for (let k = 1; k < a.length; k += 3) { a[k] -= dt * 13; if (a[k] < 0) a[k] += 90; }
      geo.attributes.position.needsUpdate = true;
      flakes.position.set(fx, 0, fz);
    });
  }

  build_canyon() {
    this.mountains(0xb85a33);
    for (const spot of this.scatter(24, 34, 190)) {
      const g = new THREE.Group(), s = 0.7 + this.rand() * 0.9;
      mesh(g, new THREE.CylinderGeometry(24, 33, 26, 7), low(0xb85a33), 0, 13, 0);
      mesh(g, new THREE.CylinderGeometry(20, 24, 18, 7), low(0xd07a45), 0, 35, 0);
      mesh(g, new THREE.CylinderGeometry(15, 20, 9, 7), low(0xa34b2a), 0, 48.5, 0);
      this.add(g, spot, s);
    }
    for (const spot of this.scatter(4, 30, 60)) {
      const g = new THREE.Group(), m = low(0xbf6336);
      mesh(g, new THREE.CylinderGeometry(7, 10, 30, 6), m, -15, 15, 0); mesh(g, new THREE.CylinderGeometry(7, 10, 30, 6), m, 15, 15, 0);
      const top = mesh(g, new THREE.BoxGeometry(46, 12, 16), low(0xd07a45), 0, 34, 0); top.rotation.z = 0.04;
      this.add(g, spot, 1);
    }
    const cacti = this.scatter(70, 3, 170), green = low(0x3f8f55);
    const parts = [[new THREE.CapsuleGeometry(1, 7, 3, 7), 0, 4.6, 0], [new THREE.CapsuleGeometry(0.7, 2.6, 3, 7), -2.2, 5.4, 0], [new THREE.CapsuleGeometry(0.7, 2.2, 3, 7), 2.2, 6.6, 0]];
    for (const [g, x, y] of parts) { g.translate(x, y, 0); this.scene.add(instanced(g, green, cacti)); }
    for (const [x, y] of [[-1.4, 3.9], [1.4, 5.2]]) { const g = new THREE.CylinderGeometry(0.7, 0.7, 2, 6); g.rotateZ(Math.PI / 2); g.translate(x, y, 0); this.scene.add(instanced(g, green, cacti)); }
    const rocks = this.scatter(60, 4, 170);
    this.scene.add(instanced(new THREE.DodecahedronGeometry(3.6, 0), low(0x9c5230), rocks.map((k) => ({ ...k, y: 1.2, sv: [k.s * 1.5, k.s, k.s * 1.2] }))));
    for (const spot of this.scatter(3, 12, 80)) {
      const g = new THREE.Group(), w = low(0x7a5233);
      for (const [x, z] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) mesh(g, new THREE.CylinderGeometry(0.5, 0.5, 16, 5), w, x, 8, z);
      mesh(g, new THREE.CylinderGeometry(6.5, 6.5, 9, 10), low(0x95653d), 0, 20, 0);
      mesh(g, new THREE.ConeGeometry(7.5, 4, 10), low(0x5b3a29), 0, 26.5, 0);
      this.add(g, spot, 1);
    }
  }

  // ---------------------------------------------------------------- pickups + hazards
  buildShared() {
    const crate = canvasTex(128, 128, (c, w, h) => {
      c.fillStyle = '#d29a53'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#8b5c31'; c.lineWidth = 12; c.strokeRect(6, 6, w - 12, h - 12);
      c.lineWidth = 8; c.beginPath(); c.moveTo(6, 6); c.lineTo(w - 6, h - 6); c.stroke();
      c.fillStyle = '#fff4dd'; c.beginPath(); c.arc(64, 64, 40, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#f26b21'; c.beginPath(); c.arc(64, 64, 26, 0, Math.PI * 2); c.fill();                      // gear logo
      for (let k = 0; k < 8; k++) { c.save(); c.translate(64, 64); c.rotate((k / 8) * Math.PI * 2); c.fillRect(-7, -37, 14, 16); c.restore(); }
      c.fillStyle = '#fff4dd'; c.beginPath(); c.arc(64, 64, 11, 0, Math.PI * 2); c.fill();
    });
    this.boxGeo = new THREE.BoxGeometry(2.1, 2.1, 2.1);
    this.boxMat = new THREE.MeshLambertMaterial({ map: crate, emissive: 0x332211 });
    // acorn pickup: three shared parts, one small group per acorn
    this.acornBody = new THREE.IcosahedronGeometry(0.62, 1); this.acornBody.scale(0.88, 1.08, 0.88); this.acornBody.translate(0, -0.2, 0);
    this.acornCap = new THREE.SphereGeometry(0.68, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2); this.acornCap.scale(1, 0.72, 1); this.acornCap.translate(0, 0.2, 0);
    this.acornStem = new THREE.CylinderGeometry(0.08, 0.1, 0.34, 6); this.acornStem.translate(0, 0.78, 0);
    this.acornMats = [new THREE.MeshStandardMaterial({ color: 0xe8a33d, roughness: 0.35, flatShading: true, emissive: 0x6b3d05 }), new THREE.MeshStandardMaterial({ color: 0x7a4b2a, roughness: 0.8, flatShading: true })];
  }

  makeItemBox() { const m = new THREE.Mesh(this.boxGeo, this.boxMat); m.castShadow = false; this.scene.add(m); return m; }

  makeAcorn(parent = this.scene) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.acornBody, this.acornMats[0]), new THREE.Mesh(this.acornCap, this.acornMats[1]), new THREE.Mesh(this.acornStem, this.acornMats[1]));
    parent.add(g);
    return g;
  }

  makeBoostPad(i, lat) {
    const tex = canvasTex(64, 64, (c, w, h) => {
      c.fillStyle = '#10b5a4'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#f7fff0';
      for (let k = 0; k < 2; k++) { const y = k * 32; c.beginPath(); c.moveTo(8, y + 28); c.lineTo(32, y + 6); c.lineTo(56, y + 28); c.lineTo(56, y + 34); c.lineTo(32, y + 14); c.lineTo(8, y + 34); c.fill(); }
    }, 1, 2);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5, 7), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.95 }));
    m.geometry.rotateX(-Math.PI / 2);
    m.geometry.rotateY(Math.PI);   // chevrons point in the driving direction
    placeOnTrack(m, this.track, i, lat, 0.12);
    this.scene.add(m);
    this.animated.push((t) => { tex.offset.y = -t * 1.5; });
    return m;
  }

  // Trail gate: two flag poles with a banner. Lights up when you drive through it.
  makeGate(g) {
    const group = new THREE.Group(), half = 3.3;
    const banner = new THREE.MeshLambertMaterial({ color: 0xffb627, emissive: 0x7a4800, side: THREE.DoubleSide });
    const pole = low(0xfdf6e3);
    for (const s of [-1, 1]) mesh(group, new THREE.CylinderGeometry(0.16, 0.2, 5.4, 6), pole, s * half, 2.7, 0);
    mesh(group, new THREE.BoxGeometry(half * 2, 0.8, 0.12), banner, 0, 5, 0);
    placeOnTrack(group, this.track, g.idx, g.lat);
    this.scene.add(group);
    return { group, banner };
  }

  makeMud() {
    const g = new THREE.Group(), m = low(0x6b4426, { roughness: 0.5 });
    const a = mesh(g, new THREE.IcosahedronGeometry(1.3, 1), m, 0, 0.1, 0); a.scale.set(1.2, 0.26, 1.1);
    const b = mesh(g, new THREE.IcosahedronGeometry(0.7, 1), m, 0.8, 0.1, 0.5); b.scale.set(1, 0.3, 1);
    const c = mesh(g, new THREE.IcosahedronGeometry(0.6, 1), m, -0.8, 0.1, -0.6); c.scale.set(1, 0.3, 1);
    this.scene.add(g);
    return g;
  }

  makeSnowball() { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 2), low(0xf7fcff, { emissive: 0x8fb8d8, emissiveIntensity: 0.3 })); this.scene.add(m); return m; }

  makeBee() {
    const g = new THREE.Group(), body = mesh(g, new THREE.SphereGeometry(0.62, 12, 10), new THREE.MeshStandardMaterial({ color: 0xffc914, roughness: 0.4 })); body.scale.z = 1.35;
    const stripe = new THREE.MeshStandardMaterial({ color: 0x1c1c22 });
    for (const z of [-0.3, 0.2]) { const t = mesh(g, new THREE.TorusGeometry(0.56, 0.1, 6, 16), stripe, 0, 0, z); t.scale.set(1, 1, 0.8); }
    const wing = new THREE.MeshStandardMaterial({ color: 0xd8f1ff, transparent: true, opacity: 0.75, side: THREE.DoubleSide });
    g.userData.wings = [-1, 1].map((s) => { const w = mesh(g, new THREE.CircleGeometry(0.6, 10), wing, s * 0.5, 0.6, -0.1); w.scale.set(1, 0.6, 1); w.rotation.x = -Math.PI / 2; return w; });
    this.scene.add(g);
    return g;
  }

  update(t, dt, fx = 0, fz = 0) { for (const f of this.animated) f(t, dt, fx, fz); }
}
