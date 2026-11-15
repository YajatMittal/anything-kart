// Shared definitions for the steering system: the controller output the game reads, the
// tracking states, the setup steps, and every tunable number in one place.

export const TRACK = {
  TRACKING: 'tracking',              // both hands tracked reliably
  DEGRADED: 'degraded',              // a moment of bad or missing measurements: last good value held
  LOST: 'temporarily_lost',          // one or both hands missing: steering eases to straight, waiting
  REACQUIRING: 'reacquiring',        // hands are back: checking they're the same pair before control returns
  PAUSED: 'paused',                  // gone too long during a race: the race is paused
};

// Setup steps (shown to players as the "lock-on").
export const PHASE = { FIND: 'find', SETTLE: 'settle', HOLD: 'hold', TEST: 'test', READY: 'ready' };
// The lock-on moves, one at a time and in this order, after the steady hold ('low' only when
// braking by lowering is switched on).
export const STEPS = ['left', 'right', 'low'];

// Player-facing tuning (Steering options). One object is shared by every engine.
export const DEFAULT_TUNING = {
  deadzone: 3,          // degrees around straight that do nothing
  sensitivity: 1,       // multiplies the steering
  maxAngle: 30,         // degrees for full lock until the lock-on measures the player's own range
  curve: 0.3,           // 0 = linear; higher = finer control near the middle (full lock still reachable)
  invert: false,
  style: 'tilt',        // tilt | move | both
  flick: 'normal',      // flick sensitivity: 'light' (easiest) | 'normal' | 'firm' (needs a bigger flick)
  brake: false,         // lowering the hands brakes (off by default: tired arms sink without meaning to)
};

// Timing and thresholds. Starting values; tune them through real play.
export const CFG = {
  hintGrace: 0.4,           // s: on-screen hints (ring, "Show both hands") ride over tracking gaps this short
  handFresh: 0.2,           // s: hand results older than this are never used as current
  tolerate: 0.35,           // s: brief detection gaps or rejected frames hold the last good value
  oneHandWait: 2.5,         // s with only one hand in view before a race pauses
  pauseAfter: 2.0,          // s with no hands in view before a race pauses
  recoverStable: 0.25,      // s of steady tracking before control returns after a short loss
  resumeStable: 0.6,        // s of steady tracking before a paused race may resume
  easeIn: 0.5,              // s of gentler steering changes just after control returns
  bridgeMax: 3,             // s: steering from the one visible hand while the other is hidden
  bridgeAgree: 40,          // degrees: the hand's tilt and its place around the middle must agree this well
  maxJump: 40,              // degrees: a bigger turn between two frames is a tracking error, not a turn
  minConf: 0.35,            // hands less certain than this are not used
  slewRate: 8,              // max change of the steering output per second
  slewEase: 3,              // ... while easing back in after a loss
  slewLost: 6,              // ... while easing to straight with no signal
  steerMinCutoff: 1.5,      // one-euro filter for the steering angle
  steerBeta: 0.08,
  vertTau: 0.06,            // s: smoothing of the height
  raiseDelay: 0.08,          // s in the raise zone before it counts (raise to start)
  brakeDelay: 0.12,         // s in the brake zone before brake activates
  zoneExit: 0.45,           // a zone is left at this fraction of its entry threshold (hysteresis)
  // Item and brake lines: fixed, in hand-lengths (palm length, wrist to middle knuckle) above or
  // below the lock-on height. Hand-lengths are the same whatever is being held (a remote or a
  // tablet) and whether the player is near or far, so "raise it about a hand" always works.
  raiseOn: -0.8,             // raise this far to count as raised (negative = up)
  // Flick (uses the item): a quick snap both hands make together, in any of three ways. Each is
  // [speed that starts it per second, how far it must go, then back within flickWindow].
  flickPop: [1.6, 0.4],     // the middle between the palms pops up (or down), in hand-lengths
  flickWrist: [1.2, 0.12],  // the wrists snap: both palms look shorter/longer vs. their spacing (log ratio)
  flickPush: [1.0, 0.12],   // a jab toward (or away from) the screen: the hands' spacing grows (log)
  flickWindow: 0.4,         // s: it has to get far enough within this (else it's a slow move, not a flick)
  flickSens: { light: 0.72, normal: 0.92, firm: 1.08 },   // scales the speeds and distances above
  flickCool: 0.5,           // s before the next flick can count
  flickMaxTurn: 150,        // degrees/s: wrist and jab flicks don't count while turning faster than this
  lowOn: 0.9,               // lower this far: brake (only when braking by lowering is on)
  settle: 1.5,              // s to get comfortable once both hands are found, before the steady hold
  stepHold: 0.35,           // s a lock-on move must be held to count
  stepPause: 0.7,           // s of \"nice!\" between lock-on moves
  skipAfter: 5,             // s on the lower move before it can be skipped
  holdSamples: 30,          // frames of a steady hold for straight-ahead (about 1 s)
  testAngle: 12,            // degrees the test asks for
};

export function emptyOutput() {
  return {
    steering: 0, item: false, brake: false, verticalPosition: 0, confidence: 0,
    trackingState: TRACK.LOST, activeSignals: { leftHand: false, rightHand: false },
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
export const D2R = Math.PI / 180;
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const mean = (xs) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
export const circMean = (ds) => Math.atan2(ds.reduce((s, d) => s + Math.sin(d * D2R), 0), ds.reduce((s, d) => s + Math.cos(d * D2R), 0)) / D2R;
