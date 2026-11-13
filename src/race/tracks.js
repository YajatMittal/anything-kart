import * as THREE from '../../vendor/three/three.module.js';

// Each track is a closed spline through [x, z] points.
export const TRACKS = [
  {
    id: 'coast', name: 'Sunny Coast', level: 'Easy', blurb: 'Wide, flowing curves past palm trees and a lighthouse.',
    width: 27, fence: 11, theme: 'coast',
    points: [[0, 0], [115, -8], [215, 8], [272, 72], [255, 155], [172, 190], [92, 160], [22, 188], [-68, 240], [-168, 218], [-222, 138], [-196, 56], [-105, 18]],
    itemRows: [0.1, 0.36, 0.6, 0.83], boostPads: [[0.27, 0], [0.71, -5]],
    acornLines: [[0.05, 6], [0.2, -6], [0.46, 0], [0.66, 6], [0.92, -4]],
  },
  {
    id: 'snow', name: 'Snowpeak Pass', level: 'Medium', blurb: 'A narrower mountain road with tighter corners through the pines.',
    width: 21, fence: 7, theme: 'snow',
    points: [[0, 0], [120, 0], [218, -22], [256, -100], [200, -172], [112, -148], [82, -78], [18, -68], [-26, -138], [-104, -192], [-200, -162], [-232, -72], [-176, -8], [-88, 16]],
    itemRows: [0.11, 0.37, 0.62, 0.85], boostPads: [[0.05, 0], [0.53, 0]],
    acornLines: [[0.18, 4], [0.32, -4], [0.46, 0], [0.74, 4], [0.94, -4]],
  },
  {
    id: 'canyon', name: 'Canyon Wiggle', level: 'Hard', blurb: 'Tight zigzags and precision gates. This one shows off your steering.',
    width: 16, fence: 4, theme: 'canyon', gates: true,
    points: [[0, 0], [62, 24], [126, -22], [190, 24], [254, -20], [322, 10], [352, 84], [304, 138], [236, 112], [196, 168], [244, 232], [204, 298], [126, 274], [62, 312], [-4, 268], [-70, 308], [-142, 274], [-182, 202], [-132, 146], [-186, 88], [-146, 24], [-72, -22]],
    itemRows: [0.16, 0.44, 0.74], boostPads: [[0.27, 0], [0.6, 0], [0.9, 0]],
    acornLines: [[0.06, 0], [0.34, 0], [0.52, 0], [0.82, 0]],
  },
];

export class Track {
  constructor(def) {
    this.def = def;
    this.halfW = def.width / 2;
    this.fence = this.halfW + def.fence;
    const pts = def.points.map((p) => new THREE.Vector3(p[0], 0, p[1]));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    this.length = curve.getLength();
    const N = this.N = Math.round(this.length / 2);
    const sp = curve.getSpacedPoints(N);
    this.x = new Float32Array(N); this.z = new Float32Array(N);
    this.tx = new Float32Array(N); this.tz = new Float32Array(N);
    this.nx = new Float32Array(N); this.nz = new Float32Array(N);
    this.dist = new Float32Array(N + 1);
    this.radius = new Float32Array(N);
    this.turn = new Int8Array(N);
    for (let i = 0; i < N; i++) { this.x[i] = sp[i].x; this.z[i] = sp[i].z; }
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      let tx = this.x[b] - this.x[a], tz = this.z[b] - this.z[a];
      const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      this.tx[i] = tx; this.tz[i] = tz;
      this.nx[i] = tz; this.nz[i] = -tx;          // "left" when facing along the track
      if (i > 0) this.dist[i] = this.dist[i - 1] + Math.hypot(this.x[i] - this.x[i - 1], this.z[i] - this.z[i - 1]);
    }
    this.dist[N] = this.length;
    // bend radius at each sample (used by CPU drivers and to place precision gates)
    for (let i = 0; i < N; i++) {
      const a = this.wrap(i - 4), b = this.wrap(i + 4);
      let d = Math.atan2(this.tx[b], this.tz[b]) - Math.atan2(this.tx[a], this.tz[a]);
      while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      this.radius[i] = Math.min(999, 16 / Math.max(1e-4, Math.abs(d)));
      this.turn[i] = Math.sign(d);
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < N; i++) {
      minX = Math.min(minX, this.x[i]); maxX = Math.max(maxX, this.x[i]);
      minZ = Math.min(minZ, this.z[i]); maxZ = Math.max(maxZ, this.z[i]);
    }
    this.bounds = { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
    this.gates = def.gates ? this.placeGates() : [];
  }

  // One gate on the inside of each real bend, so hitting them takes a clean line.
  placeGates() {
    const out = [], N = this.N, gap = 26;
    for (let i = Math.round(N * 0.04); i < N * 0.97; i++) {
      if (this.radius[i] > 60) continue;
      let peak = true;
      for (let k = -8; k <= 8; k++) if (this.radius[this.wrap(i + k)] < this.radius[i]) { peak = false; break; }
      if (!peak || (out.length && i - out[out.length - 1].idx < gap)) continue;
      out.push({ idx: i, lat: this.turn[i] * this.halfW * 0.42 });
    }
    return out;
  }

  wrap(i) { const N = this.N; return ((i % N) + N) % N; }
  heading(i) { i = this.wrap(i); return Math.atan2(this.tx[i], this.tz[i]); }
  idxAt(t) { return this.wrap(Math.round(t * this.N)); }

  // Point at sample i shifted `lat` units to the left.
  point(i, lat = 0) {
    i = this.wrap(i);
    return { x: this.x[i] + this.nx[i] * lat, y: 0, z: this.z[i] + this.nz[i] * lat };
  }

  // Tightest bend in the next `span` samples.
  tightestAhead(i, span) {
    let r = 999;
    for (let k = 0; k < span; k++) r = Math.min(r, this.radius[this.wrap(i + k)]);
    return r;
  }

  // Nearest centre-line sample, searching around a hint (or everywhere if hint < 0).
  nearest(x, z, hint = -1, span = 18) {
    let best = Infinity, bi = 0;
    if (hint < 0) {
      for (let i = 0; i < this.N; i++) {
        const dx = x - this.x[i], dz = z - this.z[i], d = dx * dx + dz * dz;
        if (d < best) { best = d; bi = i; }
      }
    } else {
      for (let k = -span; k <= span; k++) {
        const i = this.wrap(hint + k), dx = x - this.x[i], dz = z - this.z[i], d = dx * dx + dz * dz;
        if (d < best) { best = d; bi = i; }
      }
    }
    const dx = x - this.x[bi], dz = z - this.z[bi];
    return { idx: bi, lat: dx * this.nx[bi] + dz * this.nz[bi], along: dx * this.tx[bi] + dz * this.tz[bi] };
  }

  // Distance from (x,z) to the closest point of the centre line (coarse; for placing scenery).
  clearance(x, z) {
    let best = Infinity;
    for (let i = 0; i < this.N; i += 2) {
      const dx = x - this.x[i], dz = z - this.z[i], d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
}
