// SteeringEngine: one per camera player. Two hands steer, whatever the player is holding
// (any object, or nothing). It turns the hand tracker's measurements into the one output the
// game reads:
//
//   { steering: -1..1, item, brake, verticalPosition, confidence, trackingState,
//     activeSignals: { leftHand, rightHand } }
//
//   steering:  the turn of the line between the two palms, compared with the straight-ahead set
//              in the lock-on
//   item:      true for a moment after a flick (use your item)
//   brake:     the point between the palms is held low (only if lowering to brake is on).
//              Height is measured in units of the hands' spacing, so it works the same near or
//              far from the camera, and turning doesn't move that point.
//
// The lock-on (straight-ahead, range) is only ever set by the player: by the lock-on itself or
// Recenter. Losing and finding the hands never changes it.

import { TRACK, PHASE, STEPS, CFG, emptyOutput, clamp, wrap180, mean, circMean } from './config.js';
import { OneEuro, ema, slew } from './filters.js';
import { HandTracker } from './hands-pose.js';
import { TrackingState } from './state.js';
import { Snap } from './snap.js';

const HIST = 240;                   // frames of history for the diagnostics graph

export class SteeringEngine {
  constructor(zone, vision, tuning) {
    this.zone = zone; this.v = vision; this.tuning = tuning;
    this.ht = new HandTracker(zone);
    this.hands = []; this.handsT = -9;
    this.filter = new OneEuro(CFG.steerMinCutoff, CFG.steerBeta);
    this.track = new TrackingState();
    this.output = emptyOutput();
    this.history = { steer: new Float32Array(HIST), vert: new Float32Array(HIST), i: 0 };
    this.inGame = false; this.lastT = 0; this.now = 0;
    this.resetGrip();
  }

  // ------------------------------------------------------------------ lock-on
  // Start the lock-on again from nothing (Redo lock-on).
  resetGrip() {
    this.phase = PHASE.FIND;
    this.grip = null;                // set by the lock-on: { theta0, mid0, gap0, size0: {L, R}, ratio0, maxAngle, raiseOn, lowOn }
    this.samples = []; this.findT = 0; this.msg = ''; this.levelT = 0; this.tilted = false;
    this.tests = { hold: false, left: false, right: false, low: false };
    this.tt = { left: 0, right: 0, low: 0 };
    this.ext = { minA: 0, maxA: 0, minV: 0, maxV: 0 };
    this.manualRange = false; this.testT = 0;
    this.stepT = 0; this.doneT = 0; this.skipped = {};
    this.ht.reset();
    this.resetMotion();
  }
  resetMotion() {
    this.est = null; this.last = null; this.lastGood = null;
    this.rotZero = 0; this.vZero = 0; this.hZero = 0;
    this.rel = 0; this.angle = 0; this.vRaw = 0; this.vert = 0; this.hRaw = 0; this.vVel = 0; this.vPrev = null;
    this.steering = 0; this.zone_ = 'neutral'; this.raiseT = 0; this.brakeT = 0; this.armed = false; this.armT = 0; this.itemQueued = false;
    this.conf = 0; this.easeT = 0; this.measure = 'none';
    this.snaps = null; this.flickT = -9; this.flickCool = 0; this.lastSnap = null;   // the flick detector
    this.gk = null; this.oneHand = false; this.bridge = null;   // how each hand sits on the held thing (for one-hand frames)
    this.filter.reset(); this.track.reset();
  }

  setHands(hands, t) { this.hands = hands; this.handsT = t; }

  get calibrated() { return !!this.grip; }
  // the lock-on moves this player does (lowering only when it brakes), and the next one not done
  get steps() { return this.tuning.brake ? STEPS : STEPS.filter((k) => k !== 'low'); }
  get canStart() { return !!this.grip && this.steps.every((k) => this.tests[k]); }
  get stepKey() { return this.grip ? this.steps.find((k) => !this.tests[k]) || null : null; }
  get stepIndex() { return this.steps.indexOf(this.stepKey); }
  get stepProgress() { const k = this.stepKey; return k ? Math.min(1, this.tt[k] / CFG.stepHold) : 1; }
  get settleLeft() { return this.phase === PHASE.SETTLE ? Math.max(0, CFG.settle - this.findT) : 0; }
  get canSkip() { const k = this.stepKey; return k === 'low' && this.stepT > CFG.skipAfter && this.doneT <= 0; }
  // Skip the lower move (keeps the default brake height).
  skipStep() { if (!this.canSkip) return false; this.skipped[this.stepKey] = true; this.tests[this.stepKey] = true; this.nextStep(); return true; }
  nextStep() { this.stepT = 0; this.doneT = CFG.stepPause; for (const k in this.tt) this.tt[k] = 0; if (this.canStart) this.phase = PHASE.READY; }
  get state() { return this.track.state; }
  get usable() { return !!this.grip && this.track.live; }
  get holdProgress() { return Math.min(1, this.samples.length / CFG.holdSamples); }
  get maxAngle() { return this.grip ? this.grip.maxAngle : this.tuning.maxAngle; }

  // ------------------------------------------------------------------ per camera frame
  // stale: no new camera frame arrived (camera stalled), so nothing can be measured.
  update(now, stale = false) {
    const dt = clamp(now - this.lastT || 1 / 30, 1 / 120, 0.1); this.lastT = now; this.now = now; this.dt = dt;
    const fresh = !stale && now - this.handsT < CFG.handFresh ? this.hands : [];
    const g = this.grip;
    // keep following the original pair: after the lock-on, a pair must have the same grip shape.
    // Before it, nobody holds a wheel upside down: hands that look it have left and right swapped
    // (easily done when one hand shows up first and the tracker guesses which hand it is)
    this.ht.refTheta = g ? g.theta0 : 0;
    this.ht.update(fresh, now, g ? (a, b, gap, size) => this.samePair(a, b, gap, size) : null);
    this.rememberRing();
    if (!g) { this.gripCheck(dt); this.idle(dt); return; }
    this.process(this.measure_(now), dt);
  }

  // Could these two hands be the player's original pair? (Size and spacing relative to each
  // other don't change when they move nearer or further, so they still match after a loss.)
  samePair(a, b, gap, size) {
    const g = this.grip, ratio = gap / size / g.ratio0;
    if (ratio < 0.35 || ratio > 2.8) return null;                   // held a bit closer or wider than at lock-on is fine
    const sL = a.size / g.size0.L, sR = b.size / g.size0.R;
    if (sL / sR > 2 || sR / sL > 2) return null;                   // the two hands keep their size relationship (roughly: a hand turning on an object looks smaller)
    if (Math.abs(wrap180(Math.atan2(b.palm.y - a.palm.y, b.palm.x - a.palm.x) * 180 / Math.PI - g.theta0)) > 100) return null;   // hard turns count (past this, left and right swap)
    return Math.abs(Math.log(ratio)) * 40;
  }

  // Measure this frame: 'ok' with an estimate, or why not ('reject' | 'one' | 'none').
  measure_(now) {
    const ht = this.ht, g = this.grip, p = ht.pair;
    const n = (ht.L ? 1 : 0) + (ht.R ? 1 : 0);
    this.oneHand = false; this.bridge = null; this.measure = '';
    if (!p) {
      if (n === 1) { const e = this.oneHandEstimate(now); if (e) return e; }
      if (this.measure !== 'reject') this.measure = n ? 'one' : 'none';
      return null;
    }
    const scale = clamp(p.size / ((g.size0.L + g.size0.R) / 2), 0.5, 2);
    const hand = (g.size0.L + g.size0.R) / 2 * scale;            // height in hand-lengths; sideways in hand spacings
    const e = { rot: wrap180(p.theta - g.theta0), v: (p.mid.y - g.mid0.y) / hand, h: (p.mid.x - g.mid0.x) / (g.gap0 * scale),
      conf: p.conf, gap: p.gap, scale, pair: p };
    // reject what can't be a real movement: low confidence, or a jump no hands make in the time
    // between two hand-tracking results (slower devices track less often, so allow more per result)
    const L = this.lastGood, k = this.jumpScale(L);
    const jump = L && now - L.t < 0.3 && (Math.abs(wrap180(e.rot - L.rot)) > CFG.maxJump * k || Math.abs(Math.log(e.gap / L.gap)) > 0.35 * k);
    if (e.conf < CFG.minConf || jump) { this.measure = 'reject'; return null; }
    this.measure = 'ok'; this.lastGood = { rot: e.rot, gap: e.gap, t: now, ht: this.handsT };
    this.learnGrip(p, now);
    return e;
  }

  // How much bigger a jump is believable: the limits are for 1/30 s between hand-tracking
  // results, so a tracker running at 12 a second allows 2.5 times as much (never over 3 times,
  // which would let a left/right mix-up through).
  jumpScale(L) {
    const gap = L?.ht !== undefined ? this.handsT - L.ht : 0;
    return clamp(gap * 30, 1, 3);
  }

  // While both hands are seen: how each hand is tilted relative to the line between them. A hand
  // holding something turns with it, so later its own tilt alone says how far the thing has turned.
  learnGrip(p, now) {
    const k = this.gk && now - this.gk.t < 1 ? this.gk : (this.gk = {});
    for (const s of ['L', 'R']) {
      const off = wrap180(p[s].axis - p.theta);
      k[s] = k[s] === undefined ? off : wrap180(k[s] + 0.15 * wrap180(off - k[s]));
    }
    Object.assign(k, { t: now, pairT: now, theta: p.theta, mid: { ...p.mid }, gap: p.gap, size: p.size });
  }

  // Only one hand seen (the other hidden behind the object or turned edge-on): the angle from the
  // visible hand's tilt, checked against where that hand sits around the middle. Short gaps only;
  // a disagreement is a bad frame, never a guess.
  oneHandEstimate(now) {
    const k = this.gk, g = this.grip, ht = this.ht;
    if (!k || now - k.pairT > CFG.bridgeMax) return null;
    const s = ht.L ? 'L' : 'R', h = ht[s];
    if (k[s] === undefined) return null;
    // the same hand: about the size it was a moment ago (relative to the lock-on), near where it was
    const sz = h.size / g.size0[s], ref = k.size / ((g.size0.L + g.size0.R) / 2);
    if (sz / ref > 1.8 || ref / sz > 1.8) { this.measure = 'reject'; return null; }
    const half = k.gap / 2, dx = h.palm.x - k.mid.x, dy = h.palm.y - k.mid.y, d = Math.hypot(dx, dy);
    if (d > k.gap * 1.3) { this.measure = 'reject'; return null; }
    let theta = h.axis - k[s], conf = 0.5;
    if (Math.abs(d - half) < 0.35 * half) {
      const orbit = Math.atan2(s === 'R' ? dy : -dy, s === 'R' ? dx : -dx) * 180 / Math.PI;
      const diff = wrap180(orbit - theta);
      if (Math.abs(diff) > CFG.bridgeAgree) { this.measure = 'reject'; return null; }
      if (Math.abs(diff) < 20) { theta += diff * 0.4; conf = 0.65; }
    }
    const rot = wrap180(theta - g.theta0), L = this.lastGood;
    if (L && now - L.t < 0.3 && Math.abs(wrap180(rot - L.rot)) > CFG.maxJump * this.jumpScale(L)) { this.measure = 'reject'; return null; }
    this.measure = 'ok'; this.oneHand = true; this.lastGood = { rot, gap: L ? L.gap : k.gap, t: now, ht: this.handsT };
    // where the middle would be (for the ring)
    const a = theta * Math.PI / 180, sg = s === 'R' ? 1 : -1;
    this.bridge = { x: h.palm.x - sg * half * Math.cos(a), y: h.palm.y - sg * half * Math.sin(a), r: k.gap * 0.36, theta };
    return { rot, v: this.est ? this.est.v : 0, h: this.est ? this.est.h : 0, conf, gap: L ? L.gap : k.gap, scale: 1, oneHand: true, hand: s, palmY: h.palm.y };
  }

  // ------------------------------------------------------------------ the lock-on
  gripCheck(dt) {
    const p = this.ht.pair;
    this.tilted = false;
    if (!p) {
      this.findT = Math.max(0, this.findT - dt * 2);
      if (this.samples.length) this.samples.length = Math.max(0, this.samples.length - 2);
      if (this.findT === 0) { this.phase = PHASE.FIND; this.levelT = 0; }
      const n = (this.ht.L ? 1 : 0) + (this.ht.R ? 1 : 0);
      this.msg = n === 1 ? 'Now show your other hand too' : 'Hold both hands up, as if gripping a wheel';
      return;
    }
    // found: a moment to get comfortable before the steady hold starts
    this.findT = Math.min(CFG.settle + 0.1, this.findT + dt);
    if (this.findT < CFG.settle) { this.phase = PHASE.SETTLE; this.msg = 'Get comfortable…'; return; }
    this.phase = PHASE.HOLD;
    // straight ahead is saved from this hold, so it should be about level: a tilted straight makes
    // a slight lean the wrong way steer the other way (a little more room once the hold has begun).
    // Only a nudge: after levelWait it takes the hold as it is (a crooked camera, or a grip that's
    // just like that), so nobody gets stuck here.
    const S = this.samples, tilt = wrap180(p.theta);
    this.tilted = Math.abs(tilt) > CFG.levelMax + (S.length ? 3 : 0) && this.levelT < CFG.levelWait;
    if (this.tilted) {
      this.levelT += dt;
      this.lowSide = tilt > 0 ? 'right' : 'left';     // + is turned clockwise: the right hand is lower
      this.samples = []; this.msg = `Raise your ${this.lowSide} hand a little`; return;
    }
    // a steady hold: restart if it moves
    if (S.length) {
      const th = circMean(S.map((s) => s.theta)), mx = mean(S.map((s) => s.mid.x)), my = mean(S.map((s) => s.mid.y));
      if (Math.abs(wrap180(p.theta - th)) > 7 || Math.hypot(p.mid.x - mx, p.mid.y - my) > p.gap * 0.18) { this.samples = []; this.msg = 'Hold still for a moment…'; return; }
    }
    S.push({ theta: p.theta, mid: p.mid, gap: p.gap, sizeL: p.L.size, sizeR: p.R.size });
    this.msg = 'Hold steady…';
    if (S.length < CFG.holdSamples) return;
    const size0 = { L: mean(S.map((s) => s.sizeL)), R: mean(S.map((s) => s.sizeR)) }, gap0 = mean(S.map((s) => s.gap));
    this.grip = {
      theta0: circMean(S.map((s) => s.theta)),
      mid0: { x: mean(S.map((s) => s.mid.x)), y: mean(S.map((s) => s.mid.y)) },
      gap0, size0, ratio0: gap0 / ((size0.L + size0.R) / 2),
      maxAngle: this.tuning.maxAngle, raiseOn: CFG.raiseOn, lowOn: CFG.lowOn,
    };
    this.samples = []; this.tests.hold = true; this.phase = PHASE.TEST; this.justLocked = true;
    this.resetMotion();
  }

  // The test moves. What the player actually does sets their own full-turn angle and heights.
  runTests(dt) {
    const a = this.angle * (this.tuning.invert ? -1 : 1), v = this.vert, T = this.tests, tt = this.tt, e = this.ext, g = this.grip;
    this.testT += dt;
    // the player's own range and heights: how far they actually go (kept updating all along, so
    // turning further after a move is ticked still counts)
    e.minA = Math.min(e.minA, a); e.maxA = Math.max(e.maxA, a); e.minV = Math.min(e.minV, v); e.maxV = Math.max(e.maxV, v);
    // one move at a time, in order; a short "nice!" pause between them
    const k = this.stepKey;
    if (this.doneT > 0) this.doneT -= dt;
    else if (k) {
      this.stepT += dt;
      const cond = { left: a < -CFG.testAngle, right: a > CFG.testAngle, low: v > g.lowOn }[k];
      tt[k] = cond ? tt[k] + dt : 0;
      if (tt[k] >= CFG.stepHold && cond) { T[k] = true; this.justPassed = k; this.nextStep(); }
    }
    // never below 30°: people often do a small turn here, which made the race steering twitchy
    if (T.left && T.right && !this.manualRange) g.maxAngle = clamp(0.8 * Math.min(-e.minA, e.maxA), 30, 45);
  }

  // ------------------------------------------------------------------ smoothing, state, output
  idle(dt) {
    this.steering = slew(this.steering, 0, CFG.slewLost * dt);
    const o = this.output;
    o.steering = this.steering; o.item = false; o.brake = false; o.verticalPosition = 0; o.confidence = 0; o.trackingState = TRACK.LOST;
    o.activeSignals.leftHand = !!this.ht.L; o.activeSignals.rightHand = !!this.ht.R;
    this.pushHistory();
  }

  process(est, dt) {
    const g = this.grip, t = this.tuning, was = this.track.state;
    this.track.update(this.measure, dt, this.inGame);
    const st = this.track.state, live = this.track.live;
    // how long the hands were out before this frame (a longer gap is eased in even if it was
    // short enough not to count as lost)
    const gap = this.missT || 0; this.missT = est ? 0 : gap + dt;
    if (est) {
      this.est = est;
      this.rel = wrap180(est.rot - this.rotZero);
      // coming back after a loss: start smoothing from where the hands are now (no burst of old
      // movement), and ease the output in
      const back = live && !(was === TRACK.TRACKING || was === TRACK.DEGRADED);
      if (back) { this.filter.reset(this.rel); this.easeT = CFG.easeIn; this.armed = false; this.armT = 0; this.vert = est.v - this.vZero; this.vPrev = null; }
      else if (live && gap > 0.15) { this.filter.reset(this.rel); this.easeT = CFG.easeIn; }
      this.angle = this.filter.filter(this.rel, dt);
      if (!est.oneHand) {                       // one hand can't say how high the middle is: hold it
        this.vRaw = est.v - this.vZero;
        this.vert = ema(this.vert, this.vRaw, dt, CFG.vertTau);
        this.hRaw = est.h - this.hZero;
      }
    }
    this.easeT = Math.max(0, this.easeT - dt);
    this.conf += ((est ? est.conf : 0) - this.conf) * Math.min(1, dt * 8);

    // steering: dead zone, the player's range, sensitivity, curve, then a rate limit
    let target = this.steering;                                       // DEGRADED: hold the last value
    if (this.oneHand) this.bridgedT = this.now;
    const afterOneHand = this.now - (this.bridgedT ?? -9) < 0.5;      // ...except right after a one-hand stretch ran out: ease to straight
    if (st === TRACK.TRACKING) {
      const sign = t.invert ? -1 : 1, a = this.angle * sign, dz = t.deadzone;
      let x = Math.abs(a) <= dz ? 0 : Math.sign(a) * (Math.abs(a) - dz) / Math.max(5, g.maxAngle - dz);
      x = clamp(x * t.sensitivity, -1, 1);
      x = (1 - t.curve) * x + t.curve * x * x * x;
      const sl = clamp(this.hRaw / 0.45 * sign, -1, 1), slideS = Math.abs(sl) < 0.12 ? 0 : (sl - Math.sign(sl) * 0.12) / 0.88;
      target = t.style === 'move' ? slideS : t.style === 'both' ? clamp(x + slideS, -1, 1) : x;
    } else if (!live || afterOneHand) target = 0;                     // lost: ease to straight
    const rate = !live ? CFG.slewLost : this.easeT > 0 ? CFG.slewEase : CFG.slewRate;
    this.steering = slew(this.steering, target, rate * dt);
    if (Math.abs(this.steering) < 1e-3) this.steering = 0;

    // raise / neutral / brake zones. Off at once without both hands; after a loss, the hands
    // must be seen at the neutral height before either can fire again.
    if (st === TRACK.TRACKING && this.oneHand) {
      // one hand: item and brake stay as they were
    } else if (st === TRACK.TRACKING) {
      const v = this.vert, lo = g.raiseOn * CFG.zoneExit, hi = g.lowOn * CFG.zoneExit;
      this.vVel = this.vPrev === null ? 0 : this.vVel * 0.5 + ((v - this.vPrev) / dt) * 0.5; this.vPrev = v;
      if (!this.armed) { this.armT = v > lo && v < hi ? this.armT + dt : 0; if (this.armT >= 0.1) this.armed = true; }
      this.raiseT = v < g.raiseOn ? this.raiseT + dt : 0; this.brakeT = v > g.lowOn ? this.brakeT + dt : 0;
      const z = this.zone_;
      if (z === 'neutral' && this.armed) {
        if (this.raiseT >= CFG.raiseDelay || (v < g.raiseOn * 0.6 && this.vVel < -4)) this.zone_ = 'raise';   // raised (only used for "raise it to start")
        else if (this.brakeT >= CFG.brakeDelay && this.tuning.brake) this.zone_ = 'brake';
      } else if (z === 'raise' && v > lo) this.zone_ = 'neutral';
      else if (z === 'brake' && v < hi) this.zone_ = 'neutral';
    } else if (st !== TRACK.DEGRADED || this.measure === 'none') {   // a brief one-hand or bad-frame blip keeps the zone
      this.zone_ = 'neutral'; this.raiseT = 0; this.brakeT = 0; this.armed = false; this.armT = 0; this.itemQueued = false; this.vPrev = null;
    }
    // the flick carries on through short dropouts (fast flicks blur, and objects hide hands);
    // it only starts over once control is really lost
    if (st === TRACK.TRACKING || st === TRACK.DEGRADED) this.detectFlick(dt, est);
    else { this.snaps = null; this.flickReadyT = 0; }

    const o = this.output;
    o.steering = this.steering; o.item = this.now - this.flickT < 0.3; o.brake = this.zone_ === 'brake';
    o.verticalPosition = live ? -this.vert : 0; o.confidence = Math.round(this.conf * 100) / 100; o.trackingState = st;
    o.activeSignals.leftHand = !!this.ht.L; o.activeSignals.rightHand = !!this.ht.R;
    this.pushHistory();
    if (!this.inGame && st === TRACK.TRACKING) this.runTests(dt);
  }

  // The flick (uses the item): a quick snap both hands make together. Any of three counts:
  //   pop:   the middle between the palms pops up
  //   wrist: the wrists snap, so both palms briefly look shorter or longer next to their spacing
  //   push:  a quick jab toward (or away from) the screen, so the hands' spacing briefly grows
  // Turning keeps the middle where it is and the spacing the same, so steering isn't a flick; the
  // wrist and push kinds are also ignored during a fast turn. Only with both hands in view.
  detectFlick(dt, est) {
    const sens = CFG.flickSens[this.tuning.flick] || CFG.flickSens.normal;
    if (this.snaps && this.snapsSens !== sens) this.snaps = null;      // sensitivity changed
    this.snapsSens = sens;
    const mk = ([vel, min], o = {}) => new Snap({ vel: vel * sens, min: min * sens, window: CFG.flickWindow, ...o });
    const S = this.snaps || (this.snaps = {
      pop: mk(CFG.flickPop, { down: false }),                         // up only: lowering the arms never uses an item
      wrist: mk(CFG.flickWrist),
      push: mk(CFG.flickPush),
    });
    this.flickCool = Math.max(0, this.flickCool - dt);
    const p = est && !est.oneHand ? est.pair : null, hits = {};
    if (p) {
      // both hands: all three kinds
      const turnRate = Math.abs(wrap180(this.rel - (this.relPrev ?? this.rel))) / dt; this.relPrev = this.rel;
      this.turnRate = (this.turnRate || 0) * 0.6 + turnRate * 0.4;
      // ready once both hands have been seen steadily for a moment. Not tied to the lock-on height:
      // players sit differently in the next race, and the flick learns their resting position itself.
      this.flickReadyT = (this.flickReadyT || 0) + dt;
      const ok = this.flickReadyT > 0.3 && this.flickCool === 0, calm = this.turnRate < CFG.flickMaxTurn;
      hits.pop = S.pop.update(-this.vRaw, dt, ok);
      hits.wrist = S.wrist.update((Math.log(p.L.size / p.gap) + Math.log(p.R.size / p.gap)) / 2, dt, ok && calm);
      hits.push = S.push.update(Math.log(p.gap), dt, ok && calm);
      this.flickPair = { x: -this.vRaw, L: p.L.palm.y, R: p.R.palm.y, unit: (this.grip.size0.L + this.grip.size0.R) / 2 * (est.scale || 1), t: this.now };
    } else {
      S.wrist.hold(dt); S.push.hold(dt);
      // one hand in view during a pop that has already started: that hand rises and falls with
      // the object, so follow it for these few frames
      const fp = this.flickPair;
      if (est?.oneHand && S.pop.active && fp && this.now - fp.t < CFG.flickWindow) hits.pop = S.pop.update(fp.x - (est.palmY - fp[est.hand]) / fp.unit, dt, false);
      else S.pop.hold(dt);
    }
    const kind = Object.keys(hits).find((k) => hits[k] > 0);
    if (kind) {
      this.itemQueued = true; this.flickT = this.now; this.flickCool = CFG.flickCool;
      this.lastSnap = { kind, size: hits[kind], t: this.now };
      for (const k in S) S[k].cancel();                                // one flick, one item
    }
  }

  pushHistory() { const H = this.history; H.steer[H.i] = this.steering; H.vert[H.i] = this.output.verticalPosition; H.i = (H.i + 1) % HIST; }

  // ------------------------------------------------------------------ game API
  // Recenter: the way the hands are held right now becomes straight ahead and level. Only ever
  // done when the player asks.
  recenter() {
    if (!this.grip || !this.track.live || !this.est) return false;
    this.rotZero += this.angle; this.vZero += this.vRaw; this.hZero += this.hRaw;
    this.filter.reset(0); this.angle = 0; this.rel = 0; this.vert = 0; this.vRaw = 0; this.hRaw = 0;
    return true;
  }
  start() { if (this.grip) { this.inGame = true; this.itemQueued = false; } }
  stop() { this.inGame = false; this.track.wasPaused = false; if (this.track.state === TRACK.PAUSED) this.track.state = TRACK.LOST; }
  // The race resumes after a pause (the game shows a countdown first): control eases back in.
  resume() { this.track.resume(); this.easeT = CFG.easeIn; this.armed = false; this.armT = 0; this.zone_ = 'neutral'; this.itemQueued = false; if (this.est) this.filter.reset(this.rel); }
  consumeItem() { const q = this.itemQueued; this.itemQueued = false; return q; }
  get zoneNow() { return this.zone_; }

  // For the overlays: where the ring goes and how it is turned.
  ringPose() {
    const p = this.ht.pair, g = this.grip;
    if (p && this.now - this.ht.pairT < 0.2) return { x: p.mid.x, y: p.mid.y, r: p.gap * 0.36, theta: p.theta, live: true };
    if (this.bridge) return { ...this.bridge, live: true, oneHand: true };
    if (this.last && this.ringGoneFor < CFG.hintGrace) return { ...this.last, live: true };   // a hiccup: keep it as it was
    // lost: the grey ring and "Show both hands" sit where you locked on (a fixed spot that says
    // where to bring them back), not wherever the hands happened to leave, which can be a corner
    if (g) return { x: g.mid0.x, y: g.mid0.y, r: g.gap0 * 0.36, theta: g.theta0, live: false };
    return null;
  }
  rememberRing() {
    const p = this.ht.pair;
    if (this.ht.L || this.ht.R) this.handSeenT = this.now;
    if (p && this.now - this.ht.pairT < 0.2) { this.last = { x: p.mid.x, y: p.mid.y, r: p.gap * 0.36, theta: p.theta }; this.ringT = this.now; }
    else if (this.bridge) { this.last = { x: this.bridge.x, y: this.bridge.y, r: this.bridge.r, theta: this.bridge.theta }; this.ringT = this.now; }
  }
  // For what's shown on screen only (never the steering): a hand-tracking hiccup this short
  // shouldn't make the ring, the hand guides or "Show both hands" flash on and off.
  get handsGoneFor() { return this.now - (this.handSeenT ?? -99); }
  get ringGoneFor() { return this.now - (this.ringT ?? -99); }

  diag() {
    const ht = this.ht, e = this.est, g = this.grip;
    return {
      phase: this.phase, state: this.track.state, measure: this.oneHand ? 'one hand (other hidden)' : this.measure, lossT: this.track.lossT,
      leftConf: ht.L ? ht.L.conf : null, rightConf: ht.R ? ht.R.conf : null,
      L: ht.L, R: ht.R, rawAngle: e && this.track.live ? e.rot : null, rel: this.rel, angle: this.angle, theta0: g ? g.theta0 : null,
      steering: this.steering, vRaw: this.vRaw, vert: this.vert, zone: this.zone_, armed: this.armed,
      signals: this.output.activeSignals, confidence: this.conf, raiseOn: g?.raiseOn, lowOn: g?.lowOn, maxAngle: this.maxAngle,
      handsAge: this.now - this.handsT,
      flick: this.lastSnap ? `${this.lastSnap.kind} ×${this.lastSnap.size.toFixed(1)}, ${(this.now - this.lastSnap.t).toFixed(1)} s ago` : 'none yet',
    };
  }
}
