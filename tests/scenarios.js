// Steering scenario tests (simulated hands; any object is just a prop). Open the game with
// ?fakecam, then in the console:
//   await (await import('/tests/brief.js')).brief()            // or brief({ obj: 'book', mirrored: true })
// Reload the page between runs. Not part of the game.
export async function run(opts = {}) {
  const ak = window.__ak;
  const wasMuted = ak.sound.muted;
  ak.sound.setMuted(true);
  document.querySelector('#btn-play').click(); await new Promise((r) => setTimeout(r, 200));
  ak.settings.players.splice(1); Object.assign(ak.settings.players[0], { input: 'camera' });
  ak.settings.mirrored = !!opts.mirrored;
  Object.assign(ak.settings, { mode: 'race', laps: 5, brakeGesture: !!opts.brake, flickSens: opts.sens || 'normal' });   // a long race, so it never ends mid-test
  document.querySelector('#btn-go').click(); await new Promise((r) => setTimeout(r, 2000));
  if (!window.__H) (0, eval)(await (await fetch('/tests/harness.js?' + Date.now())).text());
  const T = window.__H, e = T.ch(), out = {};
  const B = { obj: opts.obj || null, mid: { x: 160, y: 132 }, gap: 96, size: 30, theta: 0 };
  const P = (o = {}) => ({ ...B, ...o, mid: o.mid || B.mid });
  const up = (f) => ({ x: B.mid.x, y: B.mid.y - f * B.gap });
  const upHL = (f) => ({ x: B.mid.x, y: B.mid.y - f * B.size });   // in hand-lengths
  const o = () => e.output;
  const ideal = (a) => { const dz = ak.tuning.deadzone, M = e.maxAngle; let x = Math.abs(a) <= dz ? 0 : Math.sign(a) * (Math.abs(a) - dz) / Math.max(5, M - dz); x = Math.max(-1, Math.min(1, x * ak.tuning.sensitivity)); const c = ak.tuning.curve; return (1 - c) * x + c * x ** 3; };
  const track = (fn, n, from = 12) => {
    let worst = 0, jump = 0, prev = o().steering, wrong = 0; const states = new Set();
    for (let k = 0; k < n; k++) {
      const [p, th] = fn(k); T.step(p);
      if (k > from && th !== null) { worst = Math.max(worst, Math.abs(o().steering - ideal(th))); if (Math.abs(th) > 8 && Math.sign(o().steering) === -Math.sign(th)) wrong++; }
      jump = Math.max(jump, Math.abs(o().steering - prev)); prev = o().steering; states.add(o().trackingState);
    }
    return `err ${worst.toFixed(2)} · wrong-way ${wrong} · max step ${jump.toFixed(2)} · ${[...states].join('/')}`;
  };

  // ---- lock-on
  let i = 0, settleSeen = false; for (; i < 300 && e.phase !== 'test'; i++) { T.step(P()); settleSeen ||= e.phase === 'settle'; }
  out.lockOn = `locked in after ${(i / 30).toFixed(1)} s (settle phase shown: ${settleSeen})`;
  const hide = opts.hideOnTurn;   // the hand on the far side of the turn is hidden behind the object
  const pose = { left: P({ theta: -26, ...(hide ? { seen: 'L', present: 'L' } : {}) }), right: P({ theta: 26, ...(hide ? { seen: 'R', present: 'R' } : {}) }), low: P({ mid: up(-0.48) }) };
  const took = [], order = [];
  for (const k of [...e.steps]) {
    let n = 0; order.push(e.stepKey);
    if (hide && (k === 'left' || k === 'right')) { const th = k === 'left' ? -26 : 26; for (let j = 0; j < 8; j++) T.step(P({ theta: th * (j + 1) / 8 })); n = 8; }   // turn with both seen, then one hides
    while (e.stepKey === k && n < 200) { T.step(pose[k]); n++; }
    took.push(`${k} ${n >= 200 ? 'NOT DONE' : (n / 30).toFixed(1) + 's'}`);
  }
  T.step(P(), 25);
  out.tests = `asked in order: ${order.join(' → ')} · ${took.join(', ')} · can start ${e.canStart} · full turn ${Math.round(e.maxAngle)}° · raise line ${e.grip.raiseOn.toFixed(2)} brake line ${e.grip.lowOn.toFixed(2)}`;
  const theta0 = e.grip.theta0, mid0 = { ...e.grip.mid0 };
  document.querySelector('#btn-calib-go').click(); T.step(P(), 150);
  out.race = `${ak.race?.phase} · ${o().trackingState}`;

  // ---- steering
  let mx = 0; for (let k = 0; k < 60; k++) { T.step(P({ jitter: 3, rollNoise: 5 })); mx = Math.max(mx, Math.abs(o().steering)); }
  out.neutralShaky = `max |steering| ${mx.toFixed(2)}`;
  out.slowTurns = track((k) => { const th = 20 * Math.sin(2 * Math.PI * 0.3 * k / 30); return [P({ theta: th }), th]; }, 120, 15);
  let hi = 0, lo = 0; for (let k = 0; k < 60; k++) { T.step(P({ theta: 34 * Math.sin(2 * Math.PI * k / 30) })); hi = Math.max(hi, o().steering); lo = Math.min(lo, o().steering); }
  out.fastTurns = `reach ${lo.toFixed(2)} … ${hi.toFixed(2)}`;
  T.step(P(), 20);
  let side = 0; for (let k = 0; k < 60; k++) { T.step(P({ mid: { x: 160 + 45 * Math.sin(k / 9), y: B.mid.y } })); side = Math.max(side, Math.abs(o().steering)); }
  let body = 0, bb = false; for (let k = 0; k < 90; k++) { const s = 1 + 0.25 * Math.sin(k / 12); T.step(P({ mid: { x: 160 + 30 * Math.sin(k / 15), y: B.mid.y + 6 * Math.sin(k / 10) }, gap: B.gap * s, size: B.size * s })); body = Math.max(body, Math.abs(o().steering)); bb ||= o().item || o().brake; }
  out.handsMoveTogether = `sideways ${side.toFixed(2)} · leaning in/out ${body.toFixed(2)}, item/brake ${bb}`;
  T.step(P(), 20);

  // ---- item (a pop up) / brake
  let item = false, brake = false, sv = 0, flick = 0, lastZ = e.zoneNow;
  { for (const f of [0.35, 0.7, 0.7, 0.35, 0, 0, 0, 0]) { T.step(P({ mid: upHL(f) })); item ||= o().item; sv = Math.max(sv, Math.abs(o().steering)); } }
  T.step(P(), 15);
  for (let k = 0; k < 15; k++) { T.step(P({ mid: up(-0.48) })); brake ||= o().brake; sv = Math.max(sv, Math.abs(o().steering)); }
  T.step(P(), 15);
  out.itemBrake = `item ${item} · brake ${brake} · steering moved ${sv.toFixed(2)} · back to neutral ${e.zoneNow === 'neutral'}`;
  const pu = B.size / B.gap;   // heights are in hand-lengths; up() takes hand spacings
  for (let k = 0; k < 60; k++) { T.step(P({ mid: up(-(e.grip.lowOn * pu + 0.02 * Math.sin(k * 1.7))), jitter: 1.5 })); if (e.zoneNow !== lastZ) { flick++; lastZ = e.zoneNow; } }
  out.boundary = `zone changes hovering at the brake line: ${flick}`;
  T.step(P(), 20);
  let acc = false; for (let k = 0; k < 40; k++) { T.step(P({ theta: 30 * Math.sin(k / 6) })); acc ||= o().item || o().brake; }
  T.step(P({ theta: 20, mid: up(0.42) }), 14); const both = `${o().item ? 'item' : 'no item'} + steering ${o().steering.toFixed(2)}`;
  T.step(P(), 20);
  out.turnVsHeight = `turning triggered item/brake: ${acc} · turn while lifted: ${both}`;

  // ---- someone else's hand appears (another person beside you)
  out.otherHands = track((k) => { const th = 12 * Math.sin(k / 8); return [P({ theta: th, extra: k > 5 ? [{ x: 25, y: 120, side: 'L', axis: -90 }, { x: 298, y: 150, side: 'R', axis: -90 }] : [] }), th]; }, 60);
  T.step(P(), 15);
  out.handsCrossBriefly = track((k) => [P({ gap: k > 10 && k < 25 ? 22 : B.gap }), 0], 45, 0);
  T.step(P(), 20);

  // ---- one hand hidden while turning (behind the object): steering carries on from the other hand
  out.turnOneHandHidden = track((k) => { const th = 22 * Math.sin(k / 10); return [P({ theta: th, ...(k > 8 && k < 80 && Math.abs(th) > 8 ? (th > 0 ? { seen: 'R', present: 'R' } : { seen: 'L', present: 'L' }) : {}) }), th]; }, 100, 15);
  // ...and a stranger's hand appearing alone far away is never used
  T.step(P(), 20);
  let stray = 0; for (let k = 0; k < 30; k++) { T.step(P({ seen: 'none', present: 'none', extra: [{ x: 300, y: 60, side: 'R', axis: -60 }] })); stray = Math.max(stray, Math.abs(o().steering)); }
  out.strangerAlone = `max |steering| ${stray.toFixed(2)} · ${o().trackingState}`;
  T.step(P(), 40);
  // ---- one hand leaves briefly (0.5 s) while turning: steering continues, no pause, resumes smoothly
  T.step(P({ theta: 18 }), 20);
  const tl1 = []; let paused1 = false;
  for (let k = 0; k < 15; k++) { T.step(P({ theta: 18, seen: 'R', present: 'R' })); paused1 ||= ak.race.paused; if ([1, 6, 14].includes(k)) tl1.push(`${(k + 1) * 33}ms ${o().steering.toFixed(2)} ${o().trackingState}`); }
  let j1 = 0, pv = o().steering; for (let k = 0; k < 30; k++) { T.step(P({ theta: 18 })); j1 = Math.max(j1, Math.abs(o().steering - pv)); pv = o().steering; }
  out.oneHandBrief = `${tl1.join(' | ')} · paused ${paused1} · after return ${o().steering.toFixed(2)} (ideal ${ideal(18).toFixed(2)}), max step ${j1.toFixed(2)} · ${o().trackingState}`;
  // one hand gone for good: pauses after the recovery window
  let pAt = null; for (let k = 0; k < 240; k++) { T.step(P({ seen: 'R', present: 'R' })); if (pAt === null && ak.race.paused) pAt = (k + 1) * 33; }
  out.oneHandGone = `race paused at ${pAt} ms · "${document.querySelector('#lost-title').textContent}"`;
  let at = null; for (let k = 0; k < 110; k++) { T.step(P()); if (at === null && !ak.race.paused) at = k * 33; }
  out.oneHandBack = `resumed after ${at} ms · ${o().trackingState}`;
  T.step(P(), 20);

  // ---- both hands leave briefly, come back at a different angle: no jump, eased
  const tl2 = []; for (let k = 0; k < 9; k++) { T.step(P({ seen: 'none', present: 'none' })); if ([1, 5, 8].includes(k)) tl2.push(`${(k + 1) * 33}ms ${o().steering.toFixed(2)} ${o().trackingState}`); }
  let steps = []; for (let k = 0; k < 20; k++) { T.step(P({ theta: 24, teleport: true })); steps.push(o().steering); }
  const maxStep = Math.max(...steps.map((v, k) => Math.abs(v - (k ? steps[k - 1] : 0))));
  out.bothBrief = `${tl2.join(' | ')} · back turned 24°: max step ${maxStep.toFixed(2)}, reached ${steps[steps.length - 1].toFixed(2)} (ideal ${ideal(24).toFixed(2)}) · paused ${ak.race.paused}`;
  T.step(P(), 25);

  // ---- both hands gone while braking: brake off at once, steering eases out, then pause; recovery keeps the lock-on
  for (let k = 0; k < 12; k++) T.step(P({ theta: 28, mid: up(-0.48) }));
  const tl3 = []; let p3 = null;
  for (let k = 0; k < 100; k++) { T.step(P({ seen: 'none', present: 'none' })); if ([0, 8, 14].includes(k)) tl3.push(`${(k + 1) * 33}ms steer ${o().steering.toFixed(2)} brake ${o().brake} ${o().trackingState}`); if (p3 === null && ak.race.paused) p3 = (k + 1) * 33; }
  out.bothGone = `${tl3.join(' | ')} · paused at ${p3} ms`;
  let at2 = null, fired = false, maxS = 0, pv2 = 0;
  for (let k = 0; k < 110; k++) { T.step(P({ theta: 6, mid: up(0.42), gap: B.gap * 1.15, size: B.size * 1.15 })); fired ||= o().item || o().brake; if (at2 === null && !ak.race.paused) at2 = k * 33; if (at2 !== null) { maxS = Math.max(maxS, Math.abs(o().steering - pv2)); } pv2 = o().steering; }
  out.recovery = `resumed after ${at2} ms (came back held high, a bit closer) · item/brake fired on return: ${fired} · max step ${maxS.toFixed(2)} · lock-on unchanged: ${e.grip.theta0 === theta0 && e.grip.mid0.y === mid0.y}`;
  T.step(P(), 30);
  out.afterRecovery = track((k) => { const th = 15 * Math.sin(k / 9); return [P({ theta: th }), th]; }, 60, 15);

  {
    // count items used: each flick moves e.flickT
    const count = (frames) => { let n = 0, last = e.flickT; for (const q of frames) { T.step(q); if (e.flickT !== last) { n++; last = e.flickT; } } return n; };
    const kind = () => e.lastSnap?.kind || '-';
    const rest = (n) => Array.from({ length: n }, () => P());
    const many = (n, f) => Array.from({ length: n }, (_, k) => f(k));
    const pop = (h = 0.7) => [P({ mid: upHL(h / 2) }), P({ mid: upHL(h) }), P({ mid: upHL(h) }), P({ mid: upHL(h / 2) }), P(), P()];
    const wrist = (r = 0.78) => [P({ size: B.size * (1 + r) / 2 }), P({ size: B.size * r }), P({ size: B.size * r }), P({ size: B.size * (1 + r) / 2 }), P(), P()];   // palms foreshorten, spacing the same
    const push = (m = 1.18) => [1, 2, 3, 2, 1, 0].map((k) => { const f = 1 + (m - 1) * k / 3; return P({ gap: B.gap * f, size: B.size * f }); });            // everything grows: closer to the camera
    T.step(P(), 30);
    const r = {};
    r.pop = count([...pop(), ...rest(20)]) + ' (' + kind() + ')';
    r.wrist = count([...wrist(), ...rest(20)]) + ' (' + kind() + ')';
    r.push = count([...push(), ...rest(20)]) + ' (' + kind() + ')';
    // with an object: hands drop out mid-flick (blur, or hidden behind it), and flicks are slower
    r.popOneHandGone = count([P({ mid: upHL(0.35) }), P({ mid: upHL(0.7), seen: 'R', present: 'R' }), P({ mid: upHL(0.7), seen: 'R', present: 'R' }), P({ mid: upHL(0.35) }), P(), P(), ...rest(20)]);
    r.popBlurred = count([P({ mid: upHL(0.35) }), P({ mid: upHL(0.7), seen: 'none', present: 'none' }), P({ mid: upHL(0.5) }), P({ mid: upHL(0.2) }), P(), P(), ...rest(20)]);
    r.heavyPop = count([...[1, 2, 3, 4, 5, 4, 3, 2, 1, 0].map((k) => P({ mid: upHL(0.45 * k / 5) })), ...rest(20)]);
    r.wristBlurred = count([P({ size: B.size * 0.88 }), P({ size: B.size * 0.78, seen: 'none', present: 'none' }), P({ size: B.size * 0.8 }), P({ size: B.size * 0.9 }), P(), P(), ...rest(20)]);
    r.wristWhileTurned = (T.step(P({ theta: 15 }), 20), count([...wrist().map((q) => ({ ...q, theta: 15 })), ...many(20, () => P({ theta: 15 }))])); T.step(P(), 20);
    // gentler flicks: small, or not snapping back
    r.smallPop = count([P({ mid: upHL(0.15) }), P({ mid: upHL(0.33) }), P({ mid: upHL(0.36) }), ...many(8, () => P({ mid: upHL(0.36) })), ...many(10, (k) => P({ mid: upHL(0.36 * (1 - k / 9)) })), ...rest(25)]);
    r.smallWrist = count([P({ size: B.size * 0.94 }), P({ size: B.size * 0.89 }), ...many(6, () => P({ size: B.size * 0.89 })), ...many(8, (k) => P({ size: B.size * (0.89 + 0.11 * k / 7) })), ...rest(25)]);
    r.lowerFast = count([P({ mid: upHL(-0.4) }), P({ mid: upHL(-0.8) }), ...many(10, () => P({ mid: upHL(-0.8) })), ...many(15, (k) => P({ mid: upHL(-0.8 * (1 - k / 14)) })), ...rest(25)]);
    r.three = count([...pop(), ...rest(20), ...wrist(), ...rest(20), ...push(), ...rest(20)]);
    r.backToBack = count([...pop(), ...pop(), ...rest(20)]);
    // must not count
    r.slowRaise = count([...many(45, (k) => P({ mid: upHL(1.3 * k / 44) })), ...many(30, () => P({ mid: upHL(1.3) })), ...many(30, (k) => P({ mid: upHL(1.3 * (1 - k / 29)) })), ...rest(20)]);
    r.raiseHoldOnce = count([P({ mid: upHL(0.5) }), P({ mid: upHL(1) }), ...many(40, () => P({ mid: upHL(1) })), ...many(30, (k) => P({ mid: upHL(1 - k / 29) })), ...rest(20)]);
    r.leanInOut = count([...many(120, (k) => { const f = 1 + 0.25 * Math.sin(k / 12); return P({ gap: B.gap * f, size: B.size * f }); }), ...many(30, (k) => { const f0 = 1 + 0.25 * Math.sin(119 / 12), f = f0 + (1 - f0) * k / 29; return P({ gap: B.gap * f, size: B.size * f }); }), ...rest(20)]);   // leans, then eases back like a person
    r.hardSteering = count(many(90, (k) => P({ theta: 30 * Math.sin(k / 5) })));
    r.snapTurns = count(many(90, (k) => P({ theta: [0, 25, -25][Math.floor(k / 10) % 3] })));
    r.sideJolts = count(many(90, (k) => P({ mid: { x: 160 + (k % 15 < 2 ? 25 : 0), y: B.mid.y } })));
    r.shaky = count(many(90, () => P({ jitter: 4, rollNoise: 6, noise: 2.5 })));
    out.flick = `counts: pop ${r.pop} · wrist snap ${r.wrist} · jab ${r.push} · wrist snap while turned ${r.wristWhileTurned} · one of each ${r.three} · two back to back ${r.backToBack} · small pop, no snap back ${r.smallPop} · small wrist snap, eased back ${r.smallWrist} · quick raise then held ${r.raiseHoldOnce} (1 is fine: raising does nothing else)`;
    out.flickWithObject = `pop with a hand hidden at the top ${r.popOneHandGone} · pop with both hands blurred for a frame ${r.popBlurred} · slower, smaller (heavy) pop ${r.heavyPop} · wrist snap with a blurred frame ${r.wristBlurred}`;
    out.notFlick = `slow raise ${r.slowRaise} · arms lowered fast ${r.lowerFast} · leaning in/out ${r.leanInOut} · hard steering ${r.hardSteering} · snappy turns ${r.snapTurns} · sideways jolts ${r.sideJolts} · very shaky hands ${r.shaky}`;
  }
  ak.sound.setMuted(wasMuted);   // don't leave the game muted
  return out;
}
