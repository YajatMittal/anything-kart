// The tracking state machine. Each frame says one of:
//   'ok'      both original hands measured reliably
//   'reject'  hands seen, but this measurement is implausible (a jump, low confidence)
//   'one'     only one hand in view
//   'none'    no hands
// and this decides what the game may use.

import { TRACK, CFG } from './config.js';

export class TrackingState {
  constructor() { this.reset(); }
  reset() { this.state = TRACK.LOST; this.badT = 99; this.stableT = 0; this.lossT = 0; this.wasPaused = false; this.last = 'none'; }

  update(m, dt, inGame) {
    const ok = m === 'ok';
    this.last = m;
    if (ok) { this.badT = 0; this.stableT += dt; } else { this.badT += dt; this.stableT = 0; }
    const S = this.state, wait = m === 'one' ? CFG.oneHandWait : CFG.pauseAfter;
    if (S === TRACK.TRACKING || S === TRACK.DEGRADED) {
      if (ok) this.state = TRACK.TRACKING;
      else this.state = this.badT < CFG.tolerate ? TRACK.DEGRADED : TRACK.LOST;
    } else if (S === TRACK.LOST) {
      if (ok) this.state = TRACK.REACQUIRING;
      else if (inGame && this.badT >= wait) { this.state = TRACK.PAUSED; this.wasPaused = true; }
    } else if (S === TRACK.PAUSED) {
      if (ok) this.state = TRACK.REACQUIRING;
    } else if (S === TRACK.REACQUIRING) {
      if (!ok) { if (this.badT >= CFG.tolerate) this.state = this.wasPaused ? TRACK.PAUSED : TRACK.LOST; }
      // after a short loss control comes back by itself; after a pause the game resumes it (resume())
      else if (!this.wasPaused && this.stableT >= CFG.recoverStable) this.state = TRACK.TRACKING;
    }
    const out = this.state === TRACK.LOST || this.state === TRACK.PAUSED || this.state === TRACK.REACQUIRING;
    this.lossT = out ? this.lossT + dt : 0;
  }

  get live() { return this.state === TRACK.TRACKING || this.state === TRACK.DEGRADED; }
  get readyToResume() { return this.state === TRACK.REACQUIRING && this.wasPaused && this.stableT >= CFG.resumeStable; }
  resume() { this.wasPaused = false; this.state = TRACK.TRACKING; this.lossT = 0; }
}
