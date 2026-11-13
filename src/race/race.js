import * as THREE from '../../vendor/three/three.module.js';
import { Track, TRACKS } from './tracks.js';
import { World } from './world.js';
import { Kart, CHARACTERS, BASE_MAX } from './kart.js';
import { Hud } from '../ui/hud.js';

export const MODES = {
  race: { name: 'Race', icon: 'flag', desc: 'Race the CPU racers with items on. First across the line wins.' },
  timetrial: { name: 'Time Trial', icon: 'timer', desc: 'No CPUs, three chilis, and a best time to beat.' },
  acorns: { name: 'Acorn Rush', icon: 'acorns', desc: 'Most acorns after 2 minutes wins. Getting hit drops some!' },
  knockout: { name: 'Knockout', icon: 'knockout', desc: 'Every 20 seconds, whoever is in last place is out.' },
};

export const ITEMS = {
  chili: { icon: 'chili', name: 'Hot Chili' },
  chili3: { icon: 'chili3', name: 'Chili Pack', count: 3 },
  mud: { icon: 'mud', name: 'Mud Pie' },
  snowball: { icon: 'snowball', name: 'Snowball' },
  bee: { icon: 'bee', name: 'Busy Bee' },
  bubble: { icon: 'bubble', name: 'Bubble Shield' },
  acorns: { icon: 'acorns', name: 'Acorn Bag' },
};
export const ROULETTE = ['chili', 'mud', 'snowball', 'bee', 'bubble', 'acorns'];
export const PLAYER_COLORS = ['#e63946', '#1d8fe0', '#23a65b', '#f08c00'];

const ACORN_RUSH_TIME = 120, KO_FIRST = 25, KO_EVERY = 20, ACORN_CAP = 10;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapPI = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
export const fmtTime = (t) => { if (!isFinite(t)) return '--:--.--'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; };
export const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');

function pickWeighted(table) {
  let total = 0; for (const [, w] of table) total += w;
  let r = Math.random() * total;
  for (const [v, w] of table) { r -= w; if (r <= 0) return v; }
  return table[0][0];
}

export class Race {
  constructor(cfg, deps) {
    this.cfg = cfg; this.deps = deps; this.sound = deps.sound;
    this.mode = cfg.mode; this.attract = !!cfg.attract;
    const def = TRACKS.find((t) => t.id === cfg.trackId) || TRACKS[0];
    this.track = new Track(def);
    this.world = new World(this.track, deps.quality);
    this.scene = this.world.scene;
    this.laps = this.attract ? Infinity : (this.mode === 'race' || this.mode === 'timetrial') ? cfg.laps : Infinity;
    this.time = 0; this.clock = 0; this.acc = 0;
    this.phase = this.attract ? 'race' : 'countdown';
    this.countdown = 3.99; this.lastBeep = 4;
    this.canDrive = this.attract;
    this.karts = []; this.humans = []; this.muds = []; this.shots = []; this.fx = [];
    this.boxes = []; this.acornPickups = []; this.pads = []; this.gates = [];
    this.finishOrder = []; this.koOrder = []; this.endT = null; this.done = false;
    this.nextKO = KO_FIRST; this.finishDeadline = null;
    // How good the CPU racers are. speed: top speed; ahead: how much they ease off when in front of
    // the players; behind: how much they speed up to catch up; wobble: sloppy steering; corner:
    // how fast they take corners; itemWait: seconds before they think about using an item.
    const SKILL = {
      beginner: { speed: 0.76, ahead: 0.84, behind: 1.0, wobble: 0.22, corner: 0.86, itemWait: [3, 6] },
      easy: { speed: 0.84, ahead: 0.9, behind: 1.03, wobble: 0.14, corner: 0.93, itemWait: [2, 4.5] },
      normal: { speed: 0.93, ahead: 0.95, behind: 1.07, wobble: 0.05, corner: 1, itemWait: [1, 3.5] },
      hard: { speed: 1.0, ahead: 0.98, behind: 1.12, wobble: 0, corner: 1.04, itemWait: [0.8, 2] },
    };
    this.bot = SKILL[cfg.difficulty] || SKILL.normal;
    this.skill = this.bot.speed;
    this.paused = false;
    this.buildKarts();
    this.buildPickups();
    this.views = this.humans.length
      ? this.humans.map((k, i) => ({ kart: k, i, cam: new THREE.PerspectiveCamera(72, 1, 0.3, 4600), camH: k.h, camY: 3, fov: 72, shake: 0 }))
      : [{ kart: this.karts[0], i: 0, cam: new THREE.PerspectiveCamera(60, 1, 0.3, 4600), camH: this.karts[0].h, camY: 4, fov: 60, shake: 0, cinematic: true, switchT: 0 }];
    for (const v of this.views) { v.cam.layers.enableAll(); if (!v.cinematic) v.cam.layers.disable(1 + v.kart.player); }
    this.engines = this.attract ? [] : this.humans.map(() => this.sound.engine());
    this.hasCam = this.humans.some((k) => k.controller?.kind === 'camera');
    this.hud = this.attract ? null : new Hud(this, deps);
    if (deps.renderer) deps.renderer.shadowMap.needsUpdate = true;
    this.layout();
  }

  buildKarts() {
    const cfg = this.cfg, tr = this.track;
    const humanCfg = this.attract ? [] : cfg.players;
    const taken = new Set(humanCfg.map((p) => p.charId));
    const pool = CHARACTERS.filter((c) => !taken.has(c.id)).sort(() => Math.random() - 0.5);
    const cpuCount = this.attract ? 6 : this.mode === 'timetrial' ? 0 : clamp(cfg.cpuCount, 0, 8 - humanCfg.length);
    const entries = [];
    for (let i = 0; i < cpuCount; i++) entries.push({ ch: pool[i % pool.length], human: false });
    humanCfg.forEach((p, i) => entries.push({ ch: CHARACTERS.find((c) => c.id === p.charId) || CHARACTERS[i], human: true, player: i, spec: p.input }));
    entries.forEach((e, slot) => {
      const opts = { human: e.human, player: e.player };
      if (e.human) {
        opts.controller = this.deps.input.controller(e.spec, this.deps.vision);
        if (humanCfg.length > 1) opts.tag = { text: 'P' + (e.player + 1), color: PLAYER_COLORS[e.player], player: e.player };
      }
      const k = new Kart(this, e.ch, opts);
      const row = Math.floor(slot / 2), col = slot % 2;
      const idx = tr.N - 3 - row * 4 - col * 2;
      k.placeAt(idx, (col ? -1 : 1) * tr.halfW * 0.42, idx - tr.N);
      k.speedMul = e.human ? 1 : this.skill;
      this.karts.push(k);
      if (e.human) this.humans.push(k);
    });
    this.humans.sort((a, b) => a.player - b.player);
    if (this.mode === 'timetrial') this.humans.forEach((k) => { k.item = 'chili3'; k.itemCount = 3; });
  }

  buildPickups() {
    const tr = this.track, w = this.world, def = tr.def, s = tr.halfW / 12;
    if (this.mode !== 'timetrial') {
      for (const t of def.itemRows) {
        const i = tr.idxAt(t);
        for (const lat of [-8, -2.7, 2.7, 8]) {
          const p = tr.point(i, lat * s), mesh = w.makeItemBox();
          mesh.position.set(p.x, 1.5, p.z);
          this.boxes.push({ x: p.x, z: p.z, idx: i, lat: lat * s, mesh, active: true, t: 0 });
        }
      }
    }
    const addLine = (t, lat, n) => {
      const i0 = tr.idxAt(t);
      for (let k = 0; k < n; k++) {
        const i = tr.wrap(i0 + k * 3), p = tr.point(i, lat), mesh = w.makeAcorn();
        mesh.position.set(p.x, 1.1, p.z);
        this.acornPickups.push({ x: p.x, z: p.z, mesh, active: true, t: 0 });
      }
    };
    for (const [t, lat] of def.acornLines) addLine(t, lat, 6);
    if (this.mode === 'acorns') {
      let seed = 1;
      const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let t = 0.03; t < 0.98; t += 0.055) addLine(t, (r() * 2 - 1) * tr.halfW * 0.7, 4);
    }
    for (const [t, lat] of def.boostPads) {
      const i = tr.idxAt(t);
      this.pads.push({ idx: i, lat, mesh: w.makeBoostPad(i, lat) });
    }
    for (const g of tr.gates) this.gates.push({ ...g, ...w.makeGate(g), litT: 0 });
  }

  layout() {
    const W = window.innerWidth, H = window.innerHeight, n = this.views.length;
    const rects = n === 1 ? [[0, 0, W, H]]
      : n === 2 ? [[0, 0, W / 2, H], [W / 2, 0, W / 2, H]]
        : [[0, 0, W / 2, H / 2], [W / 2, 0, W / 2, H / 2], [0, H / 2, W / 2, H / 2], [W / 2, H / 2, W / 2, H / 2]];
    this.views.forEach((v, i) => {
      const [x, y, w, h] = rects[i].map(Math.round);
      v.rect = { x, y, w, h };
      v.cam.aspect = w / h; v.cam.updateProjectionMatrix();
    });
    this.hud?.layout();
  }

  get alive() { return this.karts.filter((k) => !k.eliminated); }

  // ---------------------------------------------------------------- update
  update(dt) {
    if (this.paused || this.done) return;
    this.clock += dt;
    // read human controls once per frame (so a tap fires exactly once)
    const frameInputs = new Map();
    for (const k of this.humans) frameInputs.set(k, k.controller.read(dt));
    this.acc = Math.min(this.acc + dt, 0.1);
    const step = 1 / 60;
    let first = true;
    while (this.acc >= step) {
      this.step(step, frameInputs, first);
      this.acc -= step; first = false;
    }
    for (const k of this.karts) k.syncMesh(dt, this.clock);
    const focus = this.views[0].kart;
    this.world.update(this.clock, dt, focus.x, focus.z);
    this.animatePickups(dt);
    for (const v of this.views) this.updateCamera(v, dt);
    this.updateEngines();
    this.hud?.update(dt);
    if (this.endT !== null) { this.endT -= dt; if (this.endT <= 0) this.finish(); }
  }

  step(dt, frameInputs, first) {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      const c = Math.ceil(this.countdown);
      if (c < this.lastBeep && c >= 1) { this.lastBeep = c; this.sound.play('count'); this.hud?.countdown(c); }
      if (this.countdown <= 0) {
        this.phase = 'race'; this.canDrive = true;
        this.sound.play('go'); this.hud?.countdown('GO!');
        for (const k of this.karts) {
          const pressed = k.human ? (frameInputs.get(k)?.accel || 0) > 0.5 : Math.random() < 0.5;
          if (pressed) { k.boostT = 0.7; k.speed = BASE_MAX * 0.6; }
        }
      }
    } else this.time += dt;

    for (const k of this.karts) {
      if (k.eliminated) continue;
      if (k.human && !k.finished) {
        let inp = frameInputs.get(k);
        // Camera lost you? Camera players coast straight (their control layer pauses the race if
        // it lasts); other lost controllers are kept on the road at reduced speed.
        k.limp = !!inp.lost;
        if (inp.lost && !inp.neutral) inp = { ...inp, steer: this.ai(k, dt).steer, accel: 0.8, brake: 0 };
        k.input = first ? inp : { ...inp, item: false };
      } else { k.limp = false; k.input = this.ai(k, dt); }
      if (k.rouletteT > 0) {
        k.rouletteT -= dt;
        if (k.rouletteT <= 0) { k.item = k.pendingItem; k.itemCount = ITEMS[k.item].count || 1; if (k.human) this.sound.play('item'); }
      }
      if (k.input.item && this.canDrive && k.spinT <= 0) {
        if (!k.item && k.human && k.rouletteT <= 0) this.hud?.flash(k, 'NO ITEM YET', 'blue');   // so a flick always shows it worked
        this.useItem(k);
      }
      k.update(dt);
    }
    this.collideKarts();
    this.updateShots(dt);
    this.updateMuds(dt);
    this.pickups(dt);
    this.updateFx(dt);
    this.rank();
    if (this.phase === 'race' && !this.attract) this.rules();
    if (this.attract) this.paceAttract();
    else this.rubberBand();
  }

  // ---------------------------------------------------------------- CPU driving
  ai(k, dt) {
    const tr = this.track;
    const look = Math.round(5 + Math.abs(k.speed) * 0.33);
    let lane = Math.sin(this.time * 0.23 + k.aiSeed) * tr.halfW * 0.4;
    if (!k.item && k.rouletteT <= 0) {
      for (const b of this.boxes) {
        if (!b.active) continue;
        let d = b.idx - k.idx; if (d < 0) d += tr.N;
        if (d > 4 && d < 30) { lane = b.lat; break; }
      }
    }
    for (const b of this.muds) {
      const dx = b.x - k.x, dz = b.z - k.z, d = Math.hypot(dx, dz);
      if (d < 22 && dx * Math.sin(k.h) + dz * Math.cos(k.h) > 0) {
        const n = tr.nearest(b.x, b.z, k.idx);
        if (Math.abs(n.lat - lane) < 3.5) lane = n.lat + (n.lat > 0 ? -5 : 5);
      }
    }
    const p = tr.point(k.idx + look, clamp(lane, -tr.halfW + 2, tr.halfW - 2));
    const diff = wrapPI(Math.atan2(p.x - k.x, p.z - k.z) - k.h);
    let steer = clamp(-diff * 2.4, -1, 1);
    if (this.bot.wobble) steer += Math.sin(this.time * 1.7 + k.aiSeed) * this.bot.wobble;
    const cornerSpeed = tr.tightestAhead(k.idx + 2, 16 + Math.round(Math.abs(k.speed) * 0.35)) * 1.75 * this.bot.corner;
    const brake = (k.speed > cornerSpeed + 2 || (Math.abs(diff) > 1.0 && k.speed > 18)) ? 1 : 0;
    return { steer, accel: brake ? 0 : 1, brake, drift: false, item: k.human ? false : this.aiItem(k, diff, dt) };
  }

  aiItem(k, diff, dt) {
    if (!k.item || k.rouletteT > 0 || !this.canDrive) return false;
    k.aiItemT -= dt;
    if (k.aiItemT > 0) return false;
    const prog = k.dist;
    let use = false;
    switch (k.item) {
      case 'chili': case 'chili3': use = Math.abs(diff) < 0.15 && this.track.tightestAhead(k.idx, 30) > 45; break;
      case 'mud': use = this.alive.some((o) => o !== k && o.dist < prog && o.dist > prog - 14) || k.aiItemT < -8; break;
      case 'snowball': use = this.alive.some((o) => {
        if (o === k || o.dist <= prog || o.dist > prog + 22) return false;
        return Math.abs(wrapPI(Math.atan2(o.x - k.x, o.z - k.z) - k.h)) < 0.18;
      }) || k.aiItemT < -10; break;
      case 'bee': use = k.place > 1 || k.aiItemT < -10; break;
      default: use = true;
    }
    if (use) { const [a, b] = this.bot.itemWait; k.aiItemT = a + Math.random() * (b - a); }
    return use;
  }

  rubberBand() {
    if (!this.humans.length) return;
    const N = this.track.N, best = Math.max(...this.humans.map((h) => h.dist));
    for (const k of this.karts) {
      if (k.human) continue;
      const gap = (k.dist - best) / N;
      const A = this.bot.ahead, Bh = this.bot.behind;
      const rb = gap > 0.25 ? A - 0.05 : gap > 0.1 ? A : gap < -0.35 ? 1 + (Bh - 1) * 2 : gap < -0.12 ? Bh : 1;
      k.speedMul = this.skill * rb * (1 + 0.02 * Math.sin(k.aiSeed));
    }
  }

  paceAttract() { for (const k of this.karts) k.speedMul = 0.93 + 0.04 * Math.sin(this.clock * 0.1 + k.aiSeed); }

  // ---------------------------------------------------------------- items
  rollItem(k) {
    const n = this.alive.length, r = n > 1 ? (k.place - 1) / (n - 1) : 0;
    let table = r < 0.25 ? [['mud', 35], ['snowball', 30], ['acorns', 25], ['chili', 10]]
      : r < 0.6 ? [['chili', 25], ['snowball', 22], ['bee', 25], ['mud', 15], ['chili3', 8], ['bubble', 5]]
        : [['chili3', 28], ['bee', 26], ['bubble', 18], ['chili', 20], ['snowball', 8]];
    if (this.mode === 'acorns') table = table.concat([['acorns', 30]]);
    return pickWeighted(table);
  }

  useItem(k) {
    if (!k.item || k.rouletteT > 0) return;
    const fx = Math.sin(k.h), fz = Math.cos(k.h);
    switch (k.item) {
      case 'chili': case 'chili3':
        k.boostT = Math.max(k.boostT, 1.15); k.speed = Math.max(k.speed, BASE_MAX * 1.05);
        if (k.human) this.sound.play('boost');
        break;
      case 'mud': this.spawnMud(k.x - fx * 3.2, k.z - fz * 3.2, k); if (k.human) this.sound.play('drop'); break;
      case 'snowball': this.spawnShot('snowball', k); if (k.human) this.sound.play('throw'); break;
      case 'bee': this.spawnShot('bee', k); if (k.human) this.sound.play('buzz'); break;
      case 'bubble': k.shieldT = 8; if (k.human) this.sound.play('shield'); break;
      case 'acorns': k.acorns += 3; if (this.mode !== 'acorns') k.acorns = Math.min(ACORN_CAP, k.acorns); if (k.human) this.sound.play('acorn'); break;
    }
    k.itemCount--;
    if (k.itemCount <= 0) { k.item = null; k.itemCount = 0; }
  }

  spawnMud(x, z, owner) {
    const mesh = this.world.makeMud();
    mesh.position.set(x, 0.1, z); mesh.rotation.y = Math.random() * 6;
    this.muds.push({ x, z, mesh, owner, age: 0 });
    if (this.muds.length > 24) this.removeMud(this.muds[0]);
  }

  removeMud(b) { this.scene.remove(b.mesh); this.muds.splice(this.muds.indexOf(b), 1); }

  spawnShot(type, k) {
    const mesh = type === 'bee' ? this.world.makeBee() : this.world.makeSnowball();
    const fx = Math.sin(k.h), fz = Math.cos(k.h), sp = Math.max(58, k.speed + 26);
    let target = null;
    if (type === 'bee') target = this.alive.find((o) => o.place === k.place - 1 && !o.finished) || null;
    this.shots.push({ type, x: k.x + fx * 3.4, z: k.z + fz * 3.4, vx: fx * sp, vz: fz * sp, sp, life: type === 'bee' ? 6 : 4.5, age: 0, owner: k, target, mesh, idx: k.idx });
  }

  removeShot(s) { this.scene.remove(s.mesh); s.dead = true; }

  updateShots(dt) {
    const tr = this.track;
    for (const s of this.shots) {
      s.age += dt; s.life -= dt;
      if (s.life <= 0) { this.removeShot(s); continue; }
      if (s.type === 'bee') {
        let tx, tz;
        const t = s.target;
        if (t && !t.eliminated && Math.hypot(t.x - s.x, t.z - s.z) < 45) { tx = t.x; tz = t.z; }
        else { const p = tr.point(s.idx + 10, 0); tx = p.x; tz = p.z; }
        const cur = Math.atan2(s.vx, s.vz), want = Math.atan2(tx - s.x, tz - s.z);
        const a = cur + clamp(wrapPI(want - cur), -4.5 * dt, 4.5 * dt);
        s.vx = Math.sin(a) * s.sp; s.vz = Math.cos(a) * s.sp;
      }
      s.x += s.vx * dt; s.z += s.vz * dt;
      const n = tr.nearest(s.x, s.z, s.idx); s.idx = n.idx;
      const lim = tr.fence - 0.8;
      if (Math.abs(n.lat) > lim) {
        const sg = Math.sign(n.lat), nx = tr.nx[n.idx], nz = tr.nz[n.idx], vl = s.vx * nx + s.vz * nz;
        if (vl * sg > 0) { s.vx -= 2 * vl * nx; s.vz -= 2 * vl * nz; }
        s.x -= nx * sg * (Math.abs(n.lat) - lim); s.z -= nz * sg * (Math.abs(n.lat) - lim);
      }
      if (s.type === 'bee') {
        s.mesh.position.set(s.x, 2 + Math.sin(this.clock * 12) * 0.25, s.z);
        s.mesh.rotation.y = Math.atan2(s.vx, s.vz);
        for (const w of s.mesh.userData.wings) w.rotation.y = Math.sin(this.clock * 70) * 0.7;
      } else {
        s.mesh.position.set(s.x, 0.95, s.z);
        s.mesh.rotation.x += dt * 12;
      }
      for (const k of this.karts) {
        if (k.eliminated || (k === s.owner && s.age < 0.5)) continue;
        if ((k.x - s.x) ** 2 + (k.z - s.z) ** 2 < 2.1 * 2.1) {
          k.hit(s.type);
          this.burst(s.x, 1.2, s.z, s.type === 'bee' ? 0xffc914 : 0xf4fbff, 10);
          this.removeShot(s); break;
        }
      }
      if (s.dead) continue;
      for (const b of this.muds) {
        if ((b.x - s.x) ** 2 + (b.z - s.z) ** 2 < 1.6 * 1.6) { this.removeMud(b); this.removeShot(s); break; }
      }
      if (s.dead) continue;
      for (const o of this.shots) {
        if (o === s || o.dead) continue;
        if ((o.x - s.x) ** 2 + (o.z - s.z) ** 2 < 1.5 * 1.5) { this.removeShot(o); this.removeShot(s); break; }
      }
    }
    this.shots = this.shots.filter((s) => !s.dead);
  }

  updateMuds(dt) {
    for (const b of [...this.muds]) {
      b.age += dt;
      for (const k of this.karts) {
        if (k.eliminated || (k === b.owner && b.age < 0.7)) continue;
        if ((k.x - b.x) ** 2 + (k.z - b.z) ** 2 < 2 * 2) {
          k.hit('mud');
          this.burst(b.x, 0.8, b.z, 0x6b4426, 8);
          this.removeMud(b); break;
        }
      }
    }
  }

  collideKarts() {
    const ks = this.karts;
    for (let i = 0; i < ks.length; i++) {
      const a = ks[i]; if (a.eliminated) continue;
      for (let j = i + 1; j < ks.length; j++) {
        const b = ks[j]; if (b.eliminated) continue;
        const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz, R = 2.8;
        if (d2 >= R * R || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, push = (R - d) / 2;
        a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
        const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (rel < 0) { a.vx += nx * rel * 0.6; a.vz += nz * rel * 0.6; b.vx -= nx * rel * 0.6; b.vz -= nz * rel * 0.6; }
        if (Math.abs(rel) > 5 && (a.human || b.human)) this.sound.play('bump');
      }
    }
  }

  pickups(dt) {
    const tr = this.track;
    for (const b of this.boxes) {
      if (!b.active) {
        b.t -= dt;
        if (b.t <= 0) { b.active = true; b.mesh.visible = true; b.mesh.scale.setScalar(0.01); }
        continue;
      }
      for (const k of this.karts) {
        if (k.eliminated) continue;
        if ((k.x - b.x) ** 2 + (k.z - b.z) ** 2 < 2.7 * 2.7) {
          b.active = false; b.t = 2.5; b.mesh.visible = false;
          this.burst(b.x, 1.5, b.z, 0xd29a53, 10);
          if (!k.item && k.rouletteT <= 0) {
            k.pendingItem = this.rollItem(k); k.rouletteT = k.human ? 1.2 : 0.8;
            if (k.human) this.sound.play('box');
          }
          break;
        }
      }
    }
    for (const c of this.acornPickups) {
      if (!c.active) {
        c.t -= dt; if (c.t <= 0) { c.active = true; c.mesh.visible = true; }
        continue;
      }
      for (const k of this.karts) {
        if (k.eliminated) continue;
        if ((k.x - c.x) ** 2 + (k.z - c.z) ** 2 < 2.3 * 2.3) {
          c.active = false; c.t = this.mode === 'acorns' ? 5 : 10; c.mesh.visible = false;
          k.acorns++; if (this.mode !== 'acorns') k.acorns = Math.min(ACORN_CAP, k.acorns);
          if (k.human) this.sound.play('acorn');
          break;
        }
      }
    }
    for (const p of this.pads) {
      for (const k of this.karts) {
        if (k.eliminated) continue;
        let di = Math.abs(k.idx - p.idx); di = Math.min(di, tr.N - di);
        if (di <= 2 && Math.abs(k.lat - p.lat) < 3) {
          if (k.boostT < 0.3 && k.human) this.sound.play('boost');
          k.boostT = Math.max(k.boostT, 0.9);
        }
      }
    }
    for (const [i, g] of this.gates.entries()) {
      if (g.litT > 0) { g.litT -= dt; if (g.litT <= 0) { g.banner.color.set(0xffb627); g.banner.emissive.set(0x7a4800); } }
      for (const k of this.humans) {
        let di = Math.abs(k.idx - g.idx); di = Math.min(di, tr.N - di);
        const key = k.lap * 1000 + i;
        if (di > 1 || k.finished || (k.gateSeen ||= new Set()).has(key)) continue;
        k.gateSeen.add(key); k.gateTries++;
        if (Math.abs(k.lat - g.lat) < 3.5) {
          k.gates++; k.boostT = Math.max(k.boostT, 0.45);
          g.litT = 1; g.banner.color.set(0x35e0a1); g.banner.emissive.set(0x0a7a50);
          this.sound.play('gate');
        }
      }
    }
  }

  animatePickups(dt) {
    const t = this.clock;
    for (const b of this.boxes) {
      if (!b.active) continue;
      b.mesh.rotation.set(0, t * 0.9, 0);
      b.mesh.position.y = 1.5 + Math.sin(t * 2 + b.lat) * 0.15;
      if (b.mesh.scale.x < 1) b.mesh.scale.setScalar(Math.min(1, b.mesh.scale.x + dt * 3));
    }
    for (const c of this.acornPickups) if (c.active) c.mesh.rotation.y = t * 3;
  }

  // ---------------------------------------------------------------- particles
  burst(x, y, z, color, n) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.fxGeo ||= new THREE.TetrahedronGeometry(0.28), new THREE.MeshBasicMaterial({ color }));
      m.position.set(x, y, z); this.scene.add(m);
      const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 6;
      this.fx.push({ m, vx: Math.cos(a) * s, vy: 4 + Math.random() * 6, vz: Math.sin(a) * s, life: 0.7 + Math.random() * 0.3 });
    }
  }

  dropAcorns(k, n) {
    for (let i = 0; i < n; i++) {
      const m = this.world.makeAcorn();
      m.position.set(k.x, 1, k.z);
      const a = Math.random() * Math.PI * 2;
      this.fx.push({ m, vx: Math.cos(a) * 5, vy: 8, vz: Math.sin(a) * 5, life: 0.9, shared: true });
    }
  }

  updateFx(dt) {
    for (const p of this.fx) {
      p.life -= dt; p.vy -= 22 * dt;
      p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
      p.m.rotation.x += dt * 8; p.m.rotation.y += dt * 6;
      if (p.life < 0.3) p.m.scale.setScalar(Math.max(0.01, p.life / 0.3));
      if (p.life <= 0) { this.scene.remove(p.m); if (!p.shared) p.m.material.dispose(); }
    }
    this.fx = this.fx.filter((p) => p.life > 0);
  }

  // ---------------------------------------------------------------- rules
  rank() {
    const mode = this.mode;
    const alive = this.alive.slice().sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished) return a.finishTime - b.finishTime;
      if (mode === 'acorns' && a.acorns !== b.acorns) return b.acorns - a.acorns;
      return b.progress - a.progress;
    });
    alive.forEach((k, i) => { k.place = i + 1; });
    this.koOrder.slice().reverse().forEach((k, i) => { k.place = alive.length + i + 1; });
  }

  onLap(k) {
    if (this.attract || !isFinite(this.laps)) return;
    if (k.lap > this.laps && !k.finished) {
      k.finished = true; k.finishTime = this.time; this.finishOrder.push(k);
      if (k.human) {
        this.sound.play('finish');
        this.hud?.flash(k, k.place === 1 ? 'YOU WIN!' : ordinal(k.place) + '!', 'big');
      }
      return;
    }
    if (!k.human || k.lap < 2) return;
    if (k.lap === this.laps) { this.sound.play('final'); this.hud?.flash(k, 'FINAL LAP!', 'final'); }
    else { this.sound.play('lap'); this.hud?.flash(k, `LAP ${k.lap}/${this.laps}`); }
  }

  rules() {
    if (this.endT !== null) return;
    if (this.mode === 'race' || this.mode === 'timetrial') {
      if (this.humans.every((h) => h.finished)) { this.endT = 1.2; return; }   // a moment to see the finish, then results
      // Once anyone finishes, everyone else gets a fair but limited time to come home.
      if (this.finishOrder.length && this.finishDeadline === null) {
        const grace = clamp(this.time * 0.3, 20, 45);
        this.finishDeadline = this.time + grace;
        this.hud?.global(`Race ends in ${Math.round(grace)} seconds!`);
      }
      if (this.finishDeadline !== null && this.time >= this.finishDeadline) { this.hud?.global("TIME'S UP!"); this.sound.play('final'); this.canDrive = false; this.endT = 1.5; }
    } else if (this.mode === 'acorns') {
      if (this.time >= ACORN_RUSH_TIME) { this.sound.play('finish'); this.hud?.global("TIME'S UP!"); this.canDrive = false; this.endT = 1.5; }
    } else if (this.mode === 'knockout') {
      if (this.time >= this.nextKO) {
        this.nextKO += KO_EVERY;
        const alive = this.alive;
        if (alive.length > 1) this.eliminate(alive.reduce((a, b) => (a.place > b.place ? a : b)));
      }
      const alive = this.alive;
      if (alive.length <= 1 || this.humans.every((h) => h.eliminated)) {
        if (alive.length === 1) this.hud?.global(`${alive[0].name} wins!`);
        this.canDrive = false; this.endT = 1.8;   // long enough to read who won
      }
    }
  }

  eliminate(k) {
    k.eliminated = true; this.koOrder.push(k); k.koTime = this.time;
    this.burst(k.x, 1, k.z, 0xffffff, 16);
    this.burst(k.x, 1, k.z, k.color, 10);
    this.sound.play('out');
    this.hud?.global(`${k.name} is OUT!`);
    k.m.root.visible = false;
  }

  get koTimeLeft() { return this.mode === 'knockout' ? Math.max(0, this.nextKO - this.time) : 0; }
  get rushTimeLeft() { return Math.max(0, ACORN_RUSH_TIME - this.time); }
  get finishLeft() { return this.finishDeadline === null ? null : Math.max(0, this.finishDeadline - this.time); }

  // Also used by the pause menu's "End race now".
  finish() {
    if (this.done) return;
    this.done = true; this.canDrive = false;
    this.rank();
    const order = this.karts.slice().sort((a, b) => a.place - b.place);
    const rows = order.map((k) => {
      let detail = '';
      if (this.mode === 'race' || this.mode === 'timetrial') detail = k.finished ? fmtTime(k.finishTime) : `Lap ${Math.max(1, Math.min(k.lap, this.laps))}/${this.laps}`;
      else if (this.mode === 'acorns') detail = `${k.acorns} acorns`;
      else detail = k.eliminated ? `Out at ${fmtTime(k.koTime)}` : 'Survivor';
      return {
        place: k.place, name: k.name, ch: k.ch, color: k.color, human: k.human, player: k.player, detail,
        best: k.lapTimes.length ? Math.min(...k.lapTimes) : null, finishTime: k.finished ? k.finishTime : null,
        road: k.driveT > 0 ? k.roadT / k.driveT : null, gates: k.gates, gateTries: k.gateTries, camera: k.controller?.kind === 'camera',
      };
    });
    this.deps.onEnd?.(rows, this);
  }

  // ---------------------------------------------------------------- events from karts
  viewOf(k) { return this.views.find((v) => v.kart === k); }

  onKartHit(k, kind) {
    if (!k.human) return;
    this.sound.play(kind === 'mud' ? 'splat' : 'hit');
    this.hud?.flash(k, { mud: 'MUDDY!', snowball: 'SPLAT!', bee: 'BZZZT!' }[kind] || 'OUCH!', 'bad');
    k.controller?.rumble?.(350, 0.9);
    const v = this.viewOf(k); if (v) v.shake = 0.5;
  }
  onShieldPop(k) { if (k.human) { this.sound.play('pop'); this.hud?.flash(k, 'BLOCKED!', 'blue'); } }
  onRescue(k) { if (k.human) { this.sound.play('rescue'); this.hud?.flash(k, 'BACK ON TRACK!', 'blue'); } }
  onDriftBoost(k, lvl) { if (k.human) { this.sound.play('turbo'); this.hud?.flash(k, lvl === 2 ? 'MEGA BOOST!' : 'BOOST!', lvl === 2 ? 'pink' : 'blue'); } }
  onBump(k) { if (k.human) { this.sound.play('bump'); k.controller?.rumble?.(120, 0.4); } }

  // ---------------------------------------------------------------- camera + render
  updateCamera(v, dt) {
    let k = v.kart;
    if (k.eliminated) k = this.alive.reduce((a, b) => (a.place < b.place ? a : b), this.alive[0]) || k;
    if (v.cinematic) {
      v.switchT += dt;
      if (v.switchT > 9) { v.switchT = 0; v.kart = this.karts[Math.floor(Math.random() * this.karts.length)]; k = v.kart; v.camH = k.h; }
    }
    const kh = v.cinematic ? k.h + Math.sin(this.clock * 0.25) * 0.8 : k.h;
    v.camH += wrapPI(kh - v.camH) * (1 - Math.exp(-(v.cinematic ? 2 : 5) * dt));
    const back = v.cinematic ? 10 : 7.6 + (k.boostT > 0 ? 0.9 : 0), up = v.cinematic ? 4.2 : 3.3;
    const cam = v.cam, sx = Math.sin(v.camH), cz = Math.cos(v.camH);
    v.camY += (up + k.air * 0.3 - v.camY) * Math.min(1, dt * 8);
    cam.position.set(k.x - sx * back, v.camY, k.z - cz * back);
    if (v.shake > 0) {
      v.shake = Math.max(0, v.shake - dt);
      cam.position.x += (Math.random() - 0.5) * v.shake; cam.position.y += (Math.random() - 0.5) * v.shake;
    }
    cam.lookAt(k.x + sx * 5, 1.4, k.z + cz * 5);
    const fovT = (v.cinematic ? 60 : 70) + clamp(Math.abs(k.speed) / BASE_MAX, 0, 1.4) * 6 + (k.boostT > 0 ? 9 : 0);
    v.fov += (fovT - v.fov) * Math.min(1, dt * 4);
    if (Math.abs(cam.fov - v.fov) > 0.05) { cam.fov = v.fov; cam.updateProjectionMatrix(); }
  }

  updateEngines() {
    this.humans.forEach((k, i) => {
      const e = this.engines[i]; if (!e) return;
      e.set(this.paused ? 0 : clamp(Math.abs(k.speed) / (BASE_MAX * 1.4), 0, 1), k.boostT > 0, 1 / Math.sqrt(this.humans.length));
    });
  }

  render(renderer) {
    const H = window.innerHeight;
    renderer.setScissorTest(true);
    for (const v of this.views) {
      const r = v.rect;
      renderer.setViewport(r.x, H - r.y - r.h, r.w, r.h);
      renderer.setScissor(r.x, H - r.y - r.h, r.w, r.h);
      renderer.render(this.scene, v.cam);
    }
    renderer.setScissorTest(false);
  }

  setPaused(p) { this.paused = p; this.updateEngines(); }

  dispose() {
    this.sound.stopEngines();
    this.hud?.destroy();
    this.scene.traverse((o) => {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      mats.forEach((m) => { if (m.map && !m.map.userData.keep) m.map.dispose(); m.dispose(); });
    });
  }
}
