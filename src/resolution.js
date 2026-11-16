// The race's resolution follows the frame rate. If a device can't keep up, the race is drawn with
// fewer pixels; once it runs smoothly again, it steps back up. Every race starts at full sharpness,
// and the first seconds of a race (and the hand tracker still starting up) are ignored, so a
// one-off hiccup doesn't leave the game blurry.
import { renderer, BASE_RATIO, hands } from './app.js';

const STEPS = [1, 0.85, 0.72, 0.6];      // fractions of full sharpness
const SLOW = 0.036;                      // average frame time (s) that counts as struggling (under ~28 fps)
const FAST = 0.022;                      // ... and as comfortably smooth (over ~45 fps)
const s = { step: 0, clock: 0, t: 0, n: 0, fastT: 0, upAt: -1e9, noUp: false };

function setStep(k) { s.step = k; renderer.setPixelRatio(BASE_RATIO * STEPS[k]); }

export function resetResolution() {
  Object.assign(s, { clock: 0, t: 0, n: 0, fastT: 0, upAt: -1e9, noUp: false });
  setStep(0);
}

// Called every frame while racing.
export function watchSpeed(dt, race) {
  s.clock += dt;
  if (s.clock < 3 || (race.hasCam && !hands.ready)) { s.t = 0; s.n = 0; return; }
  s.t += dt; s.n++;
  if (s.t < 2) return;
  const avg = s.t / s.n; s.t = 0; s.n = 0;
  if (avg > SLOW && s.step < STEPS.length - 1) {
    if (s.clock - s.upAt < 8) s.noUp = true;      // went up and straight back down: stay put this race
    setStep(s.step + 1); s.fastT = 0;
  } else if (avg < FAST && s.step > 0 && !s.noUp) {
    s.fastT += 2;
    if (s.fastT >= 6) { setStep(s.step - 1); s.upAt = s.clock; s.fastT = 0; }
  } else s.fastT = 0;
}
