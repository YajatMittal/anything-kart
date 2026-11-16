// Feeds webcam frames to the hand-tracking worker (MediaPipe Hand Landmarker) and turns
// its results into checked, player-view hand measurements for each player's steering engine.
import { PW, PH } from './vision.js';

// How sure MediaPipe is about left vs right. This is NOT how sure it is that it's a hand (its
// presence check does that): hands gripping the sides of a big object, seen edge-on, often get a
// low handedness score while being tracked perfectly well. So it only decides whether to trust
// the left/right label, never whether to keep the hand.
const SIDE_SCORE = 0.75;
// The palm landmarks (wrist and knuckles) the game measures with. Only these need to be in the
// picture: fingertips may be hidden behind the object or go past the edge.
const PALM = [0, 5, 9, 13, 17];

export class Hands {
  constructor(vision) {
    this.vision = vision;
    this.worker = null; this.ready = false; this.failed = false; this.busy = false;
    this.last = 0; this.numHands = 2; this.id = 0; this.seen = []; this.rejected = 0;
    this.gap = 30;              // shortest time between frames (phones use a longer gap to save battery)
    this.lastVT = -1;
    this.targets = [];          // steering engines; each takes the hands inside its zone
    this.delegate = '?'; this.sentAt = 0; this.sentT = 0; this.ms = 0; this.results = 0;
    this.canvas = document.createElement('canvas'); this.canvas.width = 480; this.canvas.height = 360;
    // maps MediaPipe's coordinates (whole camera picture) to the game's 4:3 view; identity until a frame is sent
    this.map = { ox: 0, oy: 0, kx: 1, ky: 1 }; this.sentMap = this.map;
    this.ctx = this.canvas.getContext('2d');
    // loading progress, for the lock-on screen: bytes downloaded, then a short start-up
    this.load = { loaded: 0, total: 0, starting: false, t0: 0, rate: 0 };
  }

  // Seconds of loading left (null while there isn't enough to go on yet), and how far along it is.
  get loadingLeft() {
    const L = this.load, secs = performance.now() / 1000 - L.t0;
    if (L.starting) return { frac: 1, secs: null };
    const frac = L.total ? Math.min(0.99, L.loaded / L.total) : 0;
    if (!L.total || L.loaded < 200000 || secs < 0.4) return { frac, secs: null };
    const rate = L.loaded / secs;
    L.rate = L.rate ? L.rate * 0.9 + rate * 0.1 : rate;                     // smoothed, so the countdown doesn't jump around
    return { frac, secs: (L.total - L.loaded) / L.rate + 1.2 };            // + about a second to start up
  }

  start(numHands) {
    if (this.worker) { if (numHands !== this.numHands) { this.numHands = numHands; this.worker.postMessage({ type: 'hands', numHands }); } return; }
    this.numHands = numHands;
    try {
      this.worker = new Worker(new URL('./hands-worker.js', import.meta.url));
    } catch (e) { this.failed = true; console.warn('Hand tracking unavailable:', e); return; }
    this.worker.onmessage = (e) => this.onMessage(e.data);
    this.worker.onerror = (e) => { this.failed = true; this.busy = false; console.warn('Hand tracking unavailable:', e.message); };
    this.load.t0 = performance.now() / 1000;
    this.worker.postMessage({ type: 'init', numHands });
  }

  onMessage(m) {
    if (m.type === 'progress') { if (m.starting) this.load.starting = true; else { this.load.loaded = m.loaded; this.load.total = m.total; } return; }
    if (m.type === 'ready') {
      this.ready = true; this.delegate = m.delegate || '?';
      for (const e of this.targets) e.ht?.reset();    // start following hands fresh, now that results come quickly
      return;
    }
    if (m.type === 'failed') { this.failed = true; console.warn('Hand tracking unavailable:', m.error); return; }
    if (m.type === 'result') {
      this.busy = false; this.results++;
      if (this.sentAt) this.ms = this.ms ? this.ms * 0.8 + (performance.now() - this.sentAt) * 0.2 : performance.now() - this.sentAt;
      if (m.error) console.warn(m.error);
      this.map = this.sentMap; this.apply(m.hands, this.sentT);
    }
  }

  async update(now) {
    if (!this.ready || this.busy || now - this.last < this.gap) return;
    // only send a frame the camera hasn't already given us, as soon as it arrives
    const vt = this.vision.video.currentTime;
    if (vt === this.lastVT) return;
    const c = this.vision.cropRect();
    if (!c) return;
    this.lastVT = vt;
    this.busy = true; this.last = now;
    try {
      // Hand tracking sees the WHOLE camera picture, not just the 4:3 part on screen, so hands
      // holding something wide (a tablet) are still found when they sit past the picture's edge.
      const v = this.vision.video, vw = v.videoWidth, vh = v.videoHeight;
      const H = 360, W = Math.min(720, Math.round(H * vw / vh / 2) * 2);
      if (this.canvas.width !== W) this.canvas.width = W;
      this.ctx.drawImage(v, 0, 0, vw, vh, 0, 0, W, H);
      this.sentMap = { ox: c.sx / vw, oy: c.sy / vh, kx: vw / c.sw, ky: vh / c.sh };
      const bitmap = await createImageBitmap(this.canvas);
      this.sentAt = performance.now(); this.sentT = this.sentAt / 1000;   // when this picture was taken
      this.worker.postMessage({ type: 'frame', bitmap, id: ++this.id }, [bitmap]);
    } catch { this.busy = false; }
  }

  // Raw MediaPipe hands -> checked hands in player-view processing coordinates (PW x PH, as the
  // player sees themselves in a mirror), then each steering engine gets the hands in its zone.
  apply(raw, t = performance.now() / 1000) {
    const flip = this.vision.flip;
    const hands = [];
    for (const h of raw) {
      const hand = toHand(h, flip, this.map);
      if (hand) hands.push(hand); else this.rejected++;
    }
    this.seen = hands; this.seenT = t;
    // the outer zones reach past the picture's edges (hands there are still tracked)
    const n = this.targets.length;
    this.targets.forEach((ch, i) => {
      const x0 = i === 0 ? -Infinity : ch.zone.x0, x1 = i === n - 1 ? Infinity : ch.zone.x1;
      ch.setHands(hands.filter((h) => h.palm.x >= x0 && h.palm.x < x1), t);
    });
  }
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v) => Math.hypot(v.x, v.y);

// One MediaPipe hand -> { palm, wrist, index, middle, pinky, size, axis, conf, pts }, or null if
// it doesn't look like a real hand (a face or a smudge the detector fired on). Only the palm has
// to be visible and hand-shaped; fingers can be hidden. map: whole-picture -> on-screen view.
function toHand(h, flip = true, map = { ox: 0, oy: 0, kx: 1, ky: 1 }) {
  if (!h?.pts || h.pts.length < 21) return null;
  for (const i of PALM) { const [x, y] = h.pts[i]; if (!(x > -0.03 && x < 1.03 && y > -0.03 && y < 1.03)) return null; }   // palm out of the camera's view
  const pts = h.pts.map(([x, y]) => { const u = (x - map.ox) * map.kx, w = (y - map.oy) * map.ky; return { x: (flip ? 1 - u : u) * PW, y: w * PH }; });
  const wrist = pts[0], index = pts[5], middle = pts[9], ring = pts[13], pinky = pts[17];
  const palm = { x: (wrist.x + index.x + middle.x + ring.x + pinky.x) / 5, y: (wrist.y + index.y + middle.y + ring.y + pinky.y) / 5 };
  const size = len(sub(middle, wrist));                       // palm length, in processing pixels
  if (size < PH * 0.035 || size > PH * 0.5) return null;      // far too small or too big to be a player's hand
  // Hand-shaped? The knuckles span a sensible width (fingers aren't checked: they may be hidden).
  const span = len(sub(index, pinky)) / size;
  if (span < 0.12 || span > 1.8) return null;
  // Which way the hand points (wrist to middle knuckle): this turns as a gripping hand turns a wheel.
  const axis = Math.atan2(middle.y - wrist.y, middle.x - wrist.x) * 180 / Math.PI;
  // How much of the palm is inside the on-screen view (hands past the edge count a little less)
  const inView = PALM.filter((i) => pts[i].x >= 0 && pts[i].x <= PW && pts[i].y >= 0 && pts[i].y <= PH).length / PALM.length;
  const conf = 0.6 + 0.4 * inView;
  // MediaPipe names the hand as if the picture were a mirror image. The game sends it the raw
  // camera picture and flips it afterwards, so then the name is the other way round.
  const side = h.side && h.score >= SIDE_SCORE ? ((h.side === 'Left') !== flip ? 'L' : 'R') : null;
  return { palm, wrist, index, middle, pinky, size, axis, conf, score: h.score, side, pts };
}
