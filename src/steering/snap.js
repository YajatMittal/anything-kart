// Spotting a quick snap in one signal (a number measured every frame, like the hands' height).
//
// A snap is about speed, not position: the signal moves fast, goes far enough, and comes back
// quickly. Holding a position, drifting slowly, or a single jittery frame never counts.
//
//   rest:   while the signal is still, it slowly learns where the signal usually sits
//   start:  the signal moves faster than `vel` (units per second), away from rest
//   count:  it got at least `min` away from rest within `window` s, and has stopped (or turned back)
//   cancel: `window` seconds pass without getting far enough (a slow move)
//   after a snap, the way back doesn't count as another one

export class Snap {
  constructor({ vel, min, up = true, down = true, window = 0.4 }) {
    Object.assign(this, { vel, min, up, down, window });
    this.reset();
  }
  reset() { this.xs = null; this.base = 0; this.prev = 0; this.rawPrev = 0; this.v = 0; this.t = -1; this.peak = 0; this.dir = 0; this.gapDt = 0; this.blockDir = 0; this.blockT = 0; }
  cancel() { this.t = -1; }
  get active() { return this.t >= 0; }

  // No measurement this frame (a hand blurred or hidden mid-flick): a snap in progress stays alive
  // until its time runs out, and carries on when the signal comes back.
  hold(dt) {
    this.gapDt += dt;
    if (this.t >= 0) { this.t += dt; if (this.t > this.window) this.t = -1; }
  }

  // x: this frame's value. allowed: may a new snap start now. Returns how big a snap that just
  // finished was (1 = exactly `min`), or 0.
  update(x, dt, allowed) {
    if (this.xs === null) { this.xs = this.base = this.prev = this.rawPrev = x; this.gapDt = 0; return 0; }
    const span = dt + this.gapDt; this.gapDt = 0;                  // time since the last real value
    this.xs += (x - this.xs) * Math.min(1, span / 0.05);            // a little smoothing for the speed
    const inst = (this.xs - this.prev) / span; this.prev = this.xs;
    const rawStep = (x - this.rawPrev) / span; this.rawPrev = x;      // unsmoothed: to see the moment it stops
    this.v = this.v * 0.5 + inst * 0.5;
    this.blockT = Math.max(0, this.blockT - span);
    if (this.t < 0) {
      // where it rests: learned slowly (about 1.5 s), so a quick dip and back doesn't move it, while
      // a slow drift (tired arms sinking) still does
      if (Math.abs(this.v) < this.vel * 0.3) this.base += (this.xs - this.base) * Math.min(1, dt / 1.5);
      const fast = this.v > this.vel ? 1 : this.v < -this.vel ? -1 : 0;
      const dir = (fast === 1 && this.up) || (fast === -1 && this.down) ? fast : 0;
      // a fast move that can't be a snap (e.g. lowering the arms): the way back up isn't one either
      if (fast && !dir) { this.blockDir = -fast; this.blockT = 0.5; }
      if (allowed && dir && !(this.blockT > 0 && dir === this.blockDir)) { this.t = 0; this.dir = Math.sign(this.v); this.peak = Math.max(0, (x - this.base) * this.dir); }   // counts from this frame on (a quick snap can already be near its top)
      return 0;
    }
    this.t += dt;
    this.peak = Math.max(this.peak, (x - this.base) * this.dir);   // how far it went (raw, so a quick peak isn't trimmed)
    // far enough, and the quick movement has stopped or turned back: that's a snap. The way back
    // (or settling) right after isn't another one.
    if (this.peak >= this.min && rawStep * this.dir < this.vel * 0.4) {
      this.t = -1; this.blockDir = -this.dir; this.blockT = 0.5;
      return this.peak / this.min;
    }
    if (this.t > this.window && this.peak < this.min) this.t = -1;  // too slow to get anywhere: not a snap
    else if (this.t > this.window * 2) this.t = -1;                 // still moving fast after all this time: a sweep, not a snap
    return 0;
  }
}
