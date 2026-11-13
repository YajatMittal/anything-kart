// Which hand is which, and the pose of a pair of hands.
//
// MediaPipe returns hands in no fixed order, so each player's hands are followed over time: a
// hand keeps its label (left / right) by staying close to where that hand was a moment ago.
// With no history, two hands are labelled by position (left in the mirror view is the left
// hand) and a lone hand by MediaPipe's own handedness.

import { dist, wrap180 } from './config.js';

const D = 180 / Math.PI;

export class HandTracker {
  constructor(zone) { this.zone = zone; this.reset(); }
  reset() { this.refTheta = null; this.L = null; this.R = null; this.pair = null; this.last = { L: null, R: null }; this.lastTheta = null; this.pairT = -9; this.soloT = 0; this.lastT = 0; }

  // fresh: this player's checked hands from the current hand-tracking result ([] if stale).
  // pairFilter(a, b, gap, size) may veto a pair (return null) or add to its cost.
  update(fresh, now, pairFilter = null) {
    const dt = Math.min(0.2, Math.max(0, now - this.lastT)); this.lastT = now;
    const recent = (k) => (this.last[k] && now - this.last[k].t < 0.5 ? this.last[k].hand : null);
    const pL = recent('L'), pR = recent('R');
    let best = null, bestScore = Infinity;
    for (let i = 0; i < fresh.length; i++) for (let j = i + 1; j < fresh.length; j++) {
      let a = fresh[i], b = fresh[j];
      const size = (a.size + b.size) / 2, gap = dist(a.palm, b.palm);
      if (Math.max(a.size, b.size) / Math.min(a.size, b.size) > 1.9) continue;      // one player's two hands are about the same size
      if (gap < Math.max(20, size * 0.6) || gap > size * 9) continue;                // apart, but not across the room
      let score = 0;
      if (pL && pR) {
        if (dist(a.palm, pR.palm) + dist(b.palm, pL.palm) < dist(a.palm, pL.palm) + dist(b.palm, pR.palm)) [a, b] = [b, a];
        const move = dist(a.palm, pL.palm) + dist(b.palm, pR.palm);
        score += move > gap * 1.2 + 30 ? 40 : move * 0.5;                           // prefer the same two hands as before
      } else if (pL || pR) {
        const known = pL || pR, aNear = dist(a.palm, known.palm) <= dist(b.palm, known.palm);
        if (!!pL !== aNear) [a, b] = [b, a];
      } else if (a.palm.x > b.palm.x) [a, b] = [b, a];                               // left in the mirror view is the left hand
      // A steering wheel is never held upside down: if this labelling puts the hands more than a
      // quarter turn from the locked-on straight-ahead, left and right are the other way round.
      if (this.refTheta !== null && Math.abs(wrap180(Math.atan2(b.palm.y - a.palm.y, b.palm.x - a.palm.x) * D - this.refTheta)) > 100) [a, b] = [b, a];
      const extra = pairFilter ? pairFilter(a, b, gap, size) : 0;
      if (extra === null) continue;
      score += extra;
      if (score < bestScore) { bestScore = score; best = { L: a, R: b, gap, size }; }
    }
    this.L = null; this.R = null; this.pair = null;
    if (best) {
      const { L, R } = best;
      let theta = Math.atan2(R.palm.y - L.palm.y, R.palm.x - L.palm.x) * D;
      if (this.lastTheta !== null && now - this.pairT < 0.5) theta = this.lastTheta + wrap180(theta - this.lastTheta);   // continuous: never jumps at ±180
      this.lastTheta = theta; this.pairT = now;
      this.L = L; this.R = R;
      this.pair = {
        L, R, theta, gap: best.gap, size: best.size, conf: Math.min(L.conf, R.conf),
        mid: { x: (L.palm.x + R.palm.x) / 2, y: (L.palm.y + R.palm.y) / 2 },
        wristMid: { x: (L.wrist.x + R.wrist.x) / 2, y: (L.wrist.y + R.wrist.y) / 2 },
      };
    } else {
      // no usable pair: label up to two hands one by one
      // A hand hidden behind the object for a while comes back near where it was last seen, so
      // lone hands are matched against a longer memory (the length of a one-hand stretch).
      const zc = (this.zone.x0 + this.zone.x1) / 2;
      const mem = (k) => (this.last[k] && now - this.last[k].t < 3 ? this.last[k].hand : null);
      const mL = mem('L'), mR = mem('R');
      const hs = fresh.slice().sort((p, q) => q.conf - p.conf).slice(0, 2);
      for (const h of hs) {
        const dl = mL ? dist(h.palm, mL.palm) : Infinity, dr = mR ? dist(h.palm, mR.palm) : Infinity, reach = h.size * 3 + 20;
        let k = Math.min(dl, dr) < reach ? (dl <= dr ? 'L' : 'R') : (h.side || (h.palm.x < zc ? 'L' : 'R'));
        if (this[k]) k = k === 'L' ? 'R' : 'L';
        if (!this[k]) this[k] = h;
      }
    }
    for (const k of ['L', 'R']) if (this[k]) this.last[k] = { hand: this[k], t: now };
    // how long exactly one hand has been in view (for steering with one hand hidden)
    this.soloT = (this.L ? 1 : 0) + (this.R ? 1 : 0) === 1 ? this.soloT + dt : 0;
  }
}
