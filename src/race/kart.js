import * as THREE from '../../vendor/three/three.module.js';
import { labelTexture, canvasTex } from './world.js';

export { CHARACTERS } from './characters.js';

export const BASE_MAX = 34;
const ACCEL = 26, BRAKE = 42, COAST = 7, TURN = 2.15;
const RESCUE_AFTER = 5;      // seconds without forward progress before a human is put back on the road

let shadowTex = null, sparkTex = null;

function buildMesh(ch, tag) {
  shadowTex ||= canvasTex(64, 64, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
  shadowTex.userData.keep = true;
  sparkTex ||= canvasTex(32, 32, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
  sparkTex.userData.keep = true;
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a6270, roughness: 0.5, metalness: 0.25, flatShading: true });
  const paint = new THREE.MeshStandardMaterial({ color: ch.color, roughness: 0.45, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24232a, roughness: 0.8 });
  const add = (geo, mat, x, y, z, parent = body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };

  // a scrapyard-built racer with a painted nose
  add(new THREE.BoxGeometry(1.75, 0.34, 3.1), wood, 0, 0.5, -0.1);
  add(new THREE.BoxGeometry(1.85, 0.16, 3.2), paint, 0, 0.7, -0.1);
  const nose = add(new THREE.CylinderGeometry(0.22, 0.9, 1.5, 4), paint, 0, 0.62, 2.0); nose.rotation.x = Math.PI / 2; nose.rotation.y = Math.PI / 4; nose.scale.set(1, 1, 0.42);
  add(new THREE.BoxGeometry(1.2, 0.42, 0.16), wood, 0, 0.94, -1.32);
  add(new THREE.BoxGeometry(2.08, 0.18, 0.2), dark, 0, 0.44, 2.72);
  const sw = add(new THREE.TorusGeometry(0.27, 0.05, 6, 14), dark, 0, 1.2, 0.72); sw.rotation.x = -0.75;

  const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.36, 12); wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.4, 6); hubGeo.rotateZ(Math.PI / 2);
  const hub = new THREE.MeshStandardMaterial({ color: 0xf4e7cf, roughness: 0.6 });
  const wheels = [], pivots = [];
  for (const [x, z] of [[-1.08, 1.32], [1.08, 1.32], [-1.08, -1.05], [1.08, -1.05]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.5, z); body.add(pivot);
    const w = new THREE.Mesh(wheelGeo, dark); pivot.add(w);
    w.add(new THREE.Mesh(hubGeo, hub));
    wheels.push(w); if (z > 0) pivots.push(pivot);
  }

  const driver = new THREE.Group(); driver.position.set(0, 0.28, -0.2); driver.scale.setScalar(0.92); body.add(driver);
  ch.build(driver);

  const brakeMat = new THREE.MeshBasicMaterial({ color: 0x5a1010 });
  for (const x of [-0.72, 0.72]) add(new THREE.BoxGeometry(0.3, 0.14, 0.06), brakeMat, x, 0.62, -1.68);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa62b, transparent: true, opacity: 0.9 });
  const flames = [];
  for (const x of [-0.5, 0.5]) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.24, 1.2, 7), flameMat);
    f.rotation.x = -Math.PI / 2; f.position.set(x, 0.56, -2.3); f.visible = false; body.add(f); flames.push(f);
  }
  const sparks = [];
  for (const x of [-1.08, 1.08]) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, color: 0x7dffd6, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.position.set(x, 0.3, -1.5); s.visible = false; body.add(s); sparks.push(s);
  }

  const bubble = new THREE.Mesh(new THREE.IcosahedronGeometry(2.9, 2), new THREE.MeshPhongMaterial({ color: 0x9be3ff, transparent: true, opacity: 0.32, shininess: 120, specular: 0xffffff, depthWrite: false }));
  bubble.position.y = 1.3; bubble.visible = false; root.add(bubble);

  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 4.8), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.14; root.add(shadow);

  let tagSprite = null;
  if (tag) {
    tagSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(tag.text, tag.color), depthTest: false, depthWrite: false }));
    tagSprite.scale.set(1.8, 0.9, 1); tagSprite.position.set(0, 3.9, 0); tagSprite.renderOrder = 10; root.add(tagSprite);
    tagSprite.layers.set(1 + tag.player);   // hidden from this player's own camera
  }
  return { root, body, driver, head: driver.userData.head, wheels, pivots, flames, sparks, bubble, shadow, brakeMat };
}

const wrapPI = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Kart {
  constructor(race, ch, opts = {}) {
    this.race = race; this.ch = ch;
    this.human = !!opts.human; this.player = opts.player ?? -1; this.controller = opts.controller || null;
    this.autoDrift = !opts.human || !!opts.controller?.autoDrift;
    this.assist = !!opts.human && opts.controller?.kind === 'camera';   // camera players: corner assist while boosting
    this.name = ch.name; this.color = ch.color;
    this.m = buildMesh(ch, opts.tag);
    race.scene.add(this.m.root);
    this.x = 0; this.z = 0; this.h = 0; this.speed = 0; this.vx = 0; this.vz = 0;
    this.air = 0; this.vAir = 0;
    this.drifting = false; this.driftDir = 0; this.driftCharge = 0; this.hardT = 0; this.softT = 0; this.driftVis = 0;
    this.boostT = 0; this.shieldT = 0; this.spinT = 0; this.spinDur = 1; this.stuckInMudT = 0; this.invulnT = 0; this.spinAngle = 0;
    this.acorns = 0; this.item = null; this.itemCount = 0; this.rouletteT = 0; this.pendingItem = null;
    this.idx = 0; this.dist = 0; this.along = 0; this.lat = 0; this.offroad = false;
    this.lap = 0; this.lapStart = 0; this.lapTimes = []; this.finished = false; this.finishTime = 0; this.place = 1;
    this.eliminated = false; this.wrongT = 0; this.speedMul = 1; this.visSteer = 0;
    this.bestDist = -Infinity; this.noProgressT = 0; this.limp = false;
    this.driveT = 0; this.roadT = 0; this.gates = 0; this.gateTries = 0; this.rescues = 0;
    this.input = { steer: 0, accel: 0, brake: 0, drift: false, item: false };
    // CPU personality
    this.aiSeed = Math.random() * 100; this.aiItemT = 1 + Math.random() * 3;
  }

  get progress() { return this.dist + this.along / 2; }

  placeAt(idx, lat, dist) {
    const tr = this.race.track, p = tr.point(idx, lat);
    this.x = p.x; this.z = p.z; this.h = tr.heading(idx);
    this.idx = tr.wrap(idx); this.dist = dist; this.speed = 0; this.vx = 0; this.vz = 0;
    this.syncMesh(0, 0);
  }

  hit(kind) {
    if (this.invulnT > 0 || this.eliminated) return false;
    if (this.shieldT > 0) { this.shieldT = 0; this.invulnT = 0.7; this.race.onShieldPop(this); return false; }
    if (kind === 'mud') {
      this.stuckInMudT = 0.85; this.speed *= 0.3;
    } else {
      this.spinDur = kind === 'bee' ? 1.25 : 0.95;
      this.spinT = this.spinDur; this.spinAngle = 0;
      this.speed *= 0.25;
    }
    this.drifting = false; this.driftCharge = 0; this.boostT = 0;
    this.invulnT = Math.max(this.spinT, this.stuckInMudT) + 0.9;
    const lose = this.race.mode === 'acorns' ? 3 : 2;
    this.race.dropAcorns(this, Math.min(this.acorns, lose));
    this.acorns = Math.max(0, this.acorns - lose);
    this.race.onKartHit(this, kind);
    return true;
  }

  // Put the kart back on the road at the furthest point it reached, facing forward.
  rescue() {
    const tr = this.race.track, keep = Math.max(this.bestDist, this.dist);
    const idx = tr.wrap(Math.floor(keep));
    this.placeAt(idx, 0, keep);
    this.air = 0; this.vAir = 0; this.spinT = 0; this.stuckInMudT = 0;
    this.drifting = false; this.driftCharge = 0; this.wrongT = 0;
    this.noProgressT = 0; this.invulnT = 1.6; this.speed = BASE_MAX * 0.4;
    this.rescues++;
    this.race.onRescue(this);
  }

  update(dt) {
    const race = this.race, tr = race.track, ch = this.ch;
    this.boostT = Math.max(0, this.boostT - dt); this.shieldT = Math.max(0, this.shieldT - dt);
    this.invulnT = Math.max(0, this.invulnT - dt); this.stuckInMudT = Math.max(0, this.stuckInMudT - dt);
    if (this.spinT > 0) { this.spinT = Math.max(0, this.spinT - dt); this.spinAngle = (1 - this.spinT / this.spinDur) * Math.PI * 4; }
    else this.spinAngle = 0;

    if (!Number.isFinite(this.x + this.z + this.h + this.speed)) { this.x = 0; this.z = 0; this.h = 0; this.speed = 0; this.vx = 0; this.vz = 0; this.rescue(); }

    const control = race.canDrive && this.spinT <= 0;
    const ended = !race.canDrive && race.phase === 'race';   // time's up: keep steering, roll to a stop
    const raw = this.input;
    const inp = control ? { ...raw, steer: Number.isFinite(raw.steer) ? raw.steer : 0 }
      : { steer: ended && this.spinT <= 0 ? raw.steer || 0 : 0, accel: 0, brake: ended ? 0.3 : 0, drift: false, item: false };

    let maxS = BASE_MAX * ch.speed * this.speedMul * (1 + 0.012 * Math.min(this.acorns, 10));
    const boosting = this.boostT > 0;
    if (this.offroad && !boosting) maxS *= 0.5;
    if (this.limp) maxS *= 0.55;
    if (this.stuckInMudT > 0) maxS *= 0.3;
    maxS *= 1 - 0.14 * Math.abs(inp.steer) * (this.drifting ? 0 : 1);   // hard steering scrubs a little speed
    if (boosting) {
      maxS *= 1.42;
      // corner assist (camera players, who can't brake): a boost never carries you into a sharp
      // corner faster than it can be taken, and never below normal top speed
      if (this.assist) {
        const safe = tr.tightestAhead(this.idx + 2, 16 + Math.round(Math.abs(this.speed) * 0.35)) * 1.9;
        maxS = Math.min(maxS, Math.max(maxS / 1.42, safe));
      }
      this.speed = Math.min(maxS, Math.max(this.speed, maxS * 0.75) + 60 * dt);
    }

    // throttle / brake
    if (inp.brake > 0.1 && this.speed > 0.5) this.speed -= BRAKE * inp.brake * dt;
    else if (inp.brake > 0.1 && inp.accel < 0.1) this.speed = Math.max(-10, this.speed - 16 * dt);
    else if (inp.accel > 0.05) {
      if (this.speed < maxS) this.speed += ACCEL * ch.accel * inp.accel * Math.max(0.18, 1 - this.speed / maxS) * dt * 1.6;
    } else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), COAST * dt);
    // extra speed (after a boost) fades; with the corner assist it fades faster when a sharp corner is coming
    let fade = 2.5;
    if (this.assist && !boosting && this.speed > maxS) {
      const safe = tr.tightestAhead(this.idx + 2, 16 + Math.round(Math.abs(this.speed) * 0.35)) * 1.9;
      if (this.speed > safe) fade = 7;
    }
    if (this.speed > maxS) this.speed -= (this.speed - maxS) * Math.min(1, fade * dt);

    // drifting (button for keyboards/pads, automatic for camera + CPU players)
    const sp = Math.abs(this.speed);
    let wantDrift;
    if (this.autoDrift) {
      // only a long, hard turn starts a power-slide (and never during a boost: that's when it slid wide)
      if (Math.abs(inp.steer) > 0.8 && !boosting) this.hardT += dt; else this.hardT = 0;
      if (Math.abs(inp.steer) < 0.3 || (this.drifting && Math.sign(inp.steer) === -this.driftDir && Math.abs(inp.steer) > 0.3)) this.softT += dt; else this.softT = 0;
      wantDrift = this.drifting ? this.softT < 0.15 : this.hardT > 0.45;
    } else wantDrift = inp.drift;
    if (!this.drifting && wantDrift && Math.abs(inp.steer) > 0.25 && sp > 13 && this.air <= 0.01) {
      this.drifting = true; this.driftDir = Math.sign(inp.steer); this.driftCharge = 0; this.vAir = 4.5;
    }
    if (this.drifting && (!wantDrift || sp < 9 || (this.offroad && !boosting))) {
      if (this.driftCharge >= 2.0 && !this.offroad) { this.boostT = Math.max(this.boostT, 1.25); race.onDriftBoost(this, 2); }
      else if (this.driftCharge >= 0.9 && !this.offroad) { this.boostT = Math.max(this.boostT, 0.65); race.onDriftBoost(this, 1); }
      this.drifting = false; this.driftCharge = 0;
    }

    // steering
    // turning gets a little gentler with speed, but not beyond top speed (so a boost doesn't make you run wide)
    // A boost is ~40% faster, which makes corners wider: turn a little sharper to help.
    const turnBase = TURN * ch.handling * clamp(sp / 7, 0, 1) * (1 - 0.28 * clamp(sp / BASE_MAX, 0, 1)) * (boosting ? 1.1 : 1);
    if (this.drifting) {
      const s = clamp(inp.steer * this.driftDir, -1, 1);
      this.h -= this.driftDir * turnBase * (0.72 + 0.55 * s) * dt;
      this.driftCharge += dt * (0.75 + 0.75 * Math.max(0, s));
    } else {
      this.h -= inp.steer * turnBase * dt * (this.speed < 0 ? -1 : 1);
    }
    this.h = wrapPI(this.h);
    this.visSteer += (inp.steer - this.visSteer) * Math.min(1, dt * 12);

    // velocity with grip (lower grip while drifting/spinning = slide)
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    // how quickly the kart's movement lines up with where it points: more grip = less sliding.
    // Extra grip while boosting, because sliding distance grows with speed.
    const grip = this.spinT > 0 ? 1.5 : this.drifting ? (boosting ? 8 : 6) : (boosting ? 20 : 15);
    const k = Math.min(1, grip * dt);
    this.vx += (fx * this.speed - this.vx) * k; this.vz += (fz * this.speed - this.vz) * k;
    this.x += this.vx * dt; this.z += this.vz * dt;

    // hop
    if (this.air > 0 || this.vAir > 0) { this.vAir -= 28 * dt; this.air = Math.max(0, this.air + this.vAir * dt); if (this.air === 0) this.vAir = 0; }

    // where are we on the track?
    const prev = this.idx;
    const n = tr.nearest(this.x, this.z, this.idx);
    this.idx = n.idx; this.lat = n.lat; this.along = n.along;
    let d = n.idx - prev; if (d > tr.N / 2) d -= tr.N; if (d < -tr.N / 2) d += tr.N;
    this.dist += d;
    this.offroad = Math.abs(n.lat) > tr.halfW + 0.8;
    if (this.human && race.phase === 'race' && !this.finished) { this.driveT += dt; if (!this.offroad) this.roadT += dt; }

    // walls: slide along them instead of sticking, even with no steering input
    const lim = tr.fence - 1.3;
    if (Math.abs(n.lat) > lim) {
      const s = Math.sign(n.lat), over = Math.abs(n.lat) - lim, nx = tr.nx[n.idx], nz = tr.nz[n.idx];
      this.x -= nx * s * over; this.z -= nz * s * over;
      const vl = this.vx * nx + this.vz * nz;
      if (vl * s > 0) {
        this.vx -= nx * vl * 1.5; this.vz -= nz * vl * 1.5;
        if (Math.abs(vl) > 6) { this.speed *= 0.72; race.onBump(this); }
      }
      if (this.speed > 0) {
        const along = wrapPI(tr.heading(n.idx) - this.h);
        if (Math.abs(along) < 2.2) this.h += clamp(along, -2.4 * dt, 2.4 * dt);
      }
    }

    // wrong way?
    const dot = fx * tr.tx[n.idx] + fz * tr.tz[n.idx];
    this.wrongT = dot < -0.4 && this.speed > 4 ? this.wrongT + dt : 0;

    // No forward progress for a few seconds (pinned, circling, going backwards)? Rescue.
    if (race.canDrive && race.phase === 'race' && !this.finished) {
      if (this.dist > this.bestDist) { this.bestDist = this.dist; this.noProgressT = 0; }
      else if (this.spinT <= 0) { this.noProgressT += dt; if (this.noProgressT > (this.human ? RESCUE_AFTER : 3)) this.rescue(); }
    }

    // laps
    const lapNow = Math.floor(this.dist / tr.N) + 1;
    if (lapNow > this.lap) {
      if (this.lap >= 1) this.lapTimes.push(race.time - this.lapStart);
      this.lap = lapNow; this.lapStart = race.time;
      race.onLap(this);
    }
  }

  syncMesh(dt, t) {
    const m = this.m, root = m.root;
    root.visible = !this.eliminated;
    root.position.set(this.x, this.air, this.z);
    this.driftVis += ((this.drifting ? this.driftDir : 0) - this.driftVis) * Math.min(1, dt * 8);
    root.rotation.y = this.h - this.driftVis * 0.4;
    const wobble = this.stuckInMudT > 0 ? Math.sin(t * 34) * 0.12 : 0;
    m.body.rotation.y = this.spinAngle + wobble;
    m.body.rotation.z = -this.visSteer * 0.07 * Math.min(1, Math.abs(this.speed) / 20) - this.driftVis * 0.09;
    m.body.position.y = (this.offroad && Math.abs(this.speed) > 3 ? Math.sin(t * 40) * 0.07 : Math.sin(t * 22) * 0.015);
    m.driver.rotation.z = -this.visSteer * 0.12;
    if (m.head) m.head.rotation.y = -this.visSteer * 0.35;
    for (const [part, axis, rate] of m.driver.userData.spin) part.rotation[axis] += dt * rate * (1 + Math.abs(this.speed) * 0.12);
    this.updateFace(t);
    m.shadow.position.y = 0.14 - this.air;
    for (const p of m.pivots) p.rotation.y = -this.visSteer * 0.45;
    for (const w of m.wheels) w.rotation.x += this.speed * dt / 0.5;
    const boosting = this.boostT > 0;
    for (const f of m.flames) { f.visible = boosting; if (boosting) f.scale.set(1, 0.7 + Math.random() * 0.8, 1); }
    const charged = this.drifting && this.driftCharge >= 0.9;
    for (const s of m.sparks) {
      s.visible = this.drifting;
      if (this.drifting) {
        s.material.color.set(this.driftCharge >= 2.0 ? 0xff5fa2 : charged ? 0x4dffc3 : 0xffffff);
        const sc = (charged ? 1 : 0.5) * (0.7 + Math.random() * 0.6); s.scale.set(sc, sc, 1);
      }
    }
    m.brakeMat.color.set(this.input.brake > 0.1 ? 0xff2a2a : 0x5a1010);
    m.bubble.visible = this.shieldT > 0;
    if (this.shieldT > 0) m.bubble.scale.setScalar(1 + Math.sin(t * 7) * 0.03);
    m.body.visible = !(this.invulnT > 0 && this.spinT <= 0 && this.stuckInMudT <= 0 && Math.floor(t * 18) % 2 === 0);
  }

  // The screen face reacts to whatever is happening right now.
  updateFace(t) {
    let mood = 'happy';
    if (this.spinT > 0 || this.stuckInMudT > 0) mood = 'hit';
    else if (this.finished) mood = this.place <= 3 ? 'win' : 'happy';
    else if (this.limp || this.wrongT > 0.5) mood = 'worried';
    else if (this.boostT > 0) mood = 'boost';
    else if (this.drifting) mood = 'focus';
    else if ((t + this.aiSeed) % 3.4 < 0.13) mood = 'blink';
    this.m.driver.userData.face.set(mood);
  }

  dispose() { this.race.scene.remove(this.m.root); }
}
