// The lock-on screen. One control system: two hands steer, whatever they're holding (any object,
// or nothing). The lock-on finds the hands, takes a steady hold as straight-ahead, then the test
// moves. All the tracking lives in src/steering/; this screen shows it and passes on button presses.
import { PLAYER_COLORS } from '../race/race.js';
import { charById } from '../race/characters.js';
import { CameraController } from '../input/input.js';
import { PW, PH } from '../tracking/vision.js';
import { SteeringEngine } from '../steering/engine.js';
import { PHASE } from '../steering/config.js';
import { drawTracking } from '../steering/overlay.js';
import { ICON } from '../ui/icons.js';
import { $, $$, TOUCH, FAKE, app, settings, save, sound, input, vision, hands, tuning, camPlayers, portrait, toast, showScreen, fitMenus, keepAwake } from '../app.js';
import { launchRace, buildCfg, quitToLobby, setPause, stopAttract } from '../flow.js';
import { debug } from '../debug.js';

export const calib = { resume: false, panels: [], startT: 0 };
const STEPS = ['<b>Grab anything</b> (a book, a bottle, a plate) or nothing at all, and hold it up with both hands like a steering wheel.',
  '<b>Get comfortable,</b> then <b>hold steady</b> for a second: that becomes straight ahead.',
  'Do each move the picture asks for: <b>turn left, turn right.</b> It learns how far you like to turn. In the race, <b>flick it</b> (a quick snap of your wrists, or a quick pop) to use your item.',
  'Once everything is ticked, <b>hold it up for a second and a half</b> to start, or press <b>Start race</b> (or Space).'];
const TEST_LABELS = { hold: 'Straight ahead', left: 'Turn left', right: 'Turn right', low: 'Lower = brake' };

// Every camera player has done the lock-on and turned left and right once.
export const camsReady = () => vision.engines.length === camPlayers().length && vision.engines.every((e) => (calib.resume ? e.calibrated : e.canStart));

export function applyTuning() {
  Object.assign(tuning, { deadzone: settings.deadzone, sensitivity: settings.sensitivity, curve: settings.curve, invert: settings.invert, style: settings.style, maxAngle: settings.maxAngle, brake: !!settings.brakeGesture, flick: settings.flickSens || 'normal' });
  CameraController.autoDrift = !!settings.autoDrift;
  vision.flip = !settings.mirrored;
}
export function recenterAll() { let ok = false; for (const e of vision.engines) ok = e.recenter() || ok; return ok; }

function syncOptionInputs() {
  $('#opt-style').value = settings.style;
  $('#opt-brake').checked = !!settings.brakeGesture;
  $('#opt-drift').checked = !!settings.autoDrift;
  $('#opt-flick').value = settings.flickSens || 'normal';
  $('#opt-angle').value = settings.maxAngle; $('#opt-angle-val').textContent = settings.maxAngle + '°';
  $('#opt-dead').value = settings.deadzone; $('#opt-dead-val').textContent = settings.deadzone + '°';
  $('#opt-sens').value = Math.round(settings.sensitivity * 100); $('#opt-sens-val').textContent = Math.round(settings.sensitivity * 100) + '%';
  $('#opt-curve').value = Math.round(settings.curve * 100); $('#opt-curve-val').textContent = Math.round(settings.curve * 100) + '%';
  $('#opt-invert').checked = settings.invert;
  $('#opt-mirror').checked = settings.mirrored;
}

// resume: coming back here from the pause menu mid-race (keeps the lock-on)
export async function enterCalib(resume) {
  if (!resume) sound.menuMusic();                                // mid-race it keeps the race music
  sound.musicLevel('quiet');                                      // the lock-on's own sounds stay clear
  calib.resume = resume;
  stopAttract();
  app.state = 'calib';
  showScreen('calib');
  keepAwake(true);
  input.captureKeys = false;
  $('#calib-title').textContent = 'Lock on';
  $('#calib-steps').innerHTML = '<li class="touch-only"><b>Prop your phone up sideways,</b> about an arm\'s length away.</li>' + STEPS.map((x) => `<li>${x}</li>`).join('');
  $('#calib-tip').textContent = 'Tip: keep both hands in view, a little apart. Anything works as a wheel, because your hands do the steering.';
  $('#btn-calib-go').textContent = resume ? 'Back to race' : 'Start race';
  $('#calib-badge').textContent = FAKE ? 'Demo camera' : '';
  syncOptionInputs();
  const msg = $('#calib-msg');
  msg.textContent = 'Starting camera…';
  try {
    await vision.start();
  } catch (e) {
    console.warn(e);
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    msg.innerHTML = `${denied ? `The game needs your camera to see your hands.<br><span class="muted">${TOUCH ? 'Allow the camera for this site in your browser settings, then try again.' : 'Allow the camera using the icon in the address bar, then try again.'}</span>`
      : `Could not start the camera.<br><span class="muted">${e?.message || e}</span>`}<br>
      <button class="btn" id="btn-cam-retry">Try again</button> ${TOUCH ? '' : '<button class="btn ghost" id="btn-cam-kbd">Use the keyboard</button>'}`;
    $('#btn-cam-retry').onclick = () => enterCalib(resume);
    if (!TOUCH) $('#btn-cam-kbd').onclick = () => {
      const used = new Set(settings.players.map((p) => p.input));
      settings.players.forEach((p) => { if (p.input === 'camera') { p.input = !used.has('wasd') ? 'wasd' : 'arrows'; used.add(p.input); } });
      save(); quitToLobby();
    };
    return;
  }
  msg.textContent = '';
  applyTuning();
  const cps = camPlayers();
  // a fresh setup gets fresh engines; coming back here mid-race keeps the lock-on
  if (!(resume && vision.engines.length === cps.length)) {
    const zones = vision.zones(cps.length);
    vision.engines = cps.map((p, z) => new SteeringEngine(zones[z], vision, tuning));
  }
  for (const e of vision.engines) e.stop();
  hands.targets = vision.engines;
  buildCalibPanels(cps);
  fitMenus();
  hands.start(cps.length * 2);
}

function buildCalibPanels(cps) {
  $('#calib-players').innerHTML = cps.map((p, z) => {
    const ch = charById(p.charId);
    return `<div class="cp" style="--pc:${PLAYER_COLORS[p.i]}" data-z="${z}">
      <div class="cp-head">${portrait(ch, 'sm')}<span>P${p.i + 1} ${ch.name}</span><span class="side">${cps.length > 1 ? (z === 0 ? 'Left side' : 'Right side') : ''}</span></div>
      <div class="cp-wheel">${ICON.wheel}</div>
      <div class="cp-status"></div>
      <div class="cp-meter"><span class="cp-dir d-l">◀</span><div class="cp-bar"><i></i></div><span class="cp-dir d-r">▶</span><span class="cp-angle">–</span></div>
      <div class="cp-zones"><span class="z-raise">UP ↑</span><span class="z-neutral">MIDDLE</span><span class="z-brake">BRAKE ↓</span></div>
      <div class="cp-tests">${Object.entries(TEST_LABELS).map(([k, v]) => `<span data-t="${k}">${v}</span>`).join('')}</div>
      <div class="cp-sig"><i class="s-l">Left hand</i><i class="s-r">Right hand</i><b class="s-state"></b></div>
      <div class="cp-warn"></div>
      <div class="cp-btns">
        <button class="btn small cp-skip" data-act="skip" hidden>Skip this step</button>
        <button class="btn small" data-act="reset">Redo lock-on</button>
        <button class="btn small" data-act="center">Recenter (R)</button>
      </div>
    </div>`;
  }).join('');
  calib.panels = $$('#calib-players .cp').map((el) => {
    const q = (sel) => el.querySelector(sel);
    return { el, status: q('.cp-status'), wheel: q('.cp-wheel'), bar: q('.cp-bar i'), angle: q('.cp-angle'), dl: q('.d-l'), dr: q('.d-r'),
      skip: q('.cp-skip'), zl: q('.z-raise'), zn: q('.z-neutral'), zb: q('.z-brake'), warn: q('.cp-warn'), sl: q('.s-l'), sr: q('.s-r'), ss: q('.s-state'),
      tests: Object.fromEntries(Array.from(el.querySelectorAll('[data-t]')).map((x) => [x.dataset.t, x])) };
  });
  $$('#calib-players [data-act]').forEach((b) => b.onclick = () => {
    const e = vision.engines[+b.closest('.cp').dataset.z];
    if (b.dataset.act === 'reset') e.resetGrip();
    if (b.dataset.act === 'skip' && e.skipStep()) toast('Skipped: using the normal height for that', 1600);
    if (b.dataset.act === 'center') toast(e.recenter() ? 'Recentered: this is straight ahead now' : 'Finish locking on first, then recenter', 1400);
  });
}

// Steering options
$('#opt-style').onchange = (e) => { settings.style = e.target.value; save(); applyTuning(); };
$('#opt-angle').oninput = (e) => {
  settings.maxAngle = +e.target.value; $('#opt-angle-val').textContent = settings.maxAngle + '°'; save(); applyTuning();
  for (const q of vision.engines) { q.manualRange = true; if (q.grip) q.grip.maxAngle = settings.maxAngle; }
};
$('#opt-dead').oninput = (e) => { settings.deadzone = +e.target.value; $('#opt-dead-val').textContent = settings.deadzone + '°'; save(); applyTuning(); };
$('#opt-sens').oninput = (e) => { settings.sensitivity = +e.target.value / 100; $('#opt-sens-val').textContent = e.target.value + '%'; save(); applyTuning(); };
$('#opt-curve').oninput = (e) => { settings.curve = +e.target.value / 100; $('#opt-curve-val').textContent = e.target.value + '%'; save(); applyTuning(); };
$('#opt-invert').onchange = (e) => { settings.invert = e.target.checked; save(); applyTuning(); };
$('#opt-flick').onchange = (e) => { settings.flickSens = e.target.value; save(); applyTuning(); toast('Once locked on, try a flick: the ring shows FLICK! when it counts', 2200); };
$('#opt-drift').onchange = (e) => { settings.autoDrift = e.target.checked; save(); applyTuning(); toast(e.target.checked ? 'Auto drift on: long hard turns slide for a mini-boost' : 'Auto drift off', 1800); };
// Braking by lowering: switching it on adds the "lower it" move to the lock-on (to learn how low).
$('#opt-brake').onchange = (e) => { settings.brakeGesture = e.target.checked; save(); applyTuning(); toast(e.target.checked ? 'Lowering it now brakes: show it how low in the lock-on' : 'Lowering no longer brakes', 2000); };
$('#opt-mirror').onchange = (e) => {
  settings.mirrored = e.target.checked; save(); applyTuning();
  for (const q of vision.engines) q.resetGrip();     // left and right swap, so lock on again
  toast('Camera mirroring changed: hold your hands up to lock on again', 2400);
};
$('#btn-calib-back').onclick = () => {
  if (calib.resume && app.race) { app.state = 'paused'; showScreen(null); $('#overlay-pause').classList.add('active'); sound.musicLevel('race'); return; }
  quitToLobby();
};
$('#btn-calib-go').onclick = () => calibGo();

// Start race (or Back to race), if everyone is locked on.
export function calibGo() {
  if (!camsReady()) {
    const e = vision.engines.find((q) => !q.canStart);
    toast(e?.calibrated ? 'Turn left and right once to finish locking on' : 'Hold your hands up to lock on first', 2200);
    return;
  }
  sound.play('click');
  if (calib.resume && app.race) { showScreen(null); app.state = 'paused'; input.captureKeys = true; sound.musicLevel('race'); setPause(false); return; }
  launchRace(buildCfg());
}

// Until the hands are seen: where to hold them.
function drawHandGuides(g, s, e, col, secs) {
  const zc = (e.zone.x0 + e.zone.x1) / 2, w = e.zone.x1 - e.zone.x0, y = PH * 0.55, r = 20;
  g.save(); g.setLineDash([10, 8]); g.lineDashOffset = -secs * 30; g.lineWidth = 4; g.strokeStyle = col;
  for (const dx of [-0.2, 0.2]) { g.beginPath(); g.arc((zc + dx * w) * s, y * s, r * s, 0, Math.PI * 2); g.stroke(); }
  g.restore();
  g.font = '20px "Lilita One", system-ui, sans-serif'; g.textAlign = 'center'; g.fillStyle = '#fff'; g.shadowColor = '#000'; g.shadowBlur = 6;
  g.fillText('Hold your hands up here', zc * s, (y - r - 16) * s); g.shadowBlur = 0;
}

// What the player should do next, and whether they are ready.
function statusFor(e) {
  if (!e.calibrated) {
    if (e.phase === PHASE.SETTLE) return ['Found your hands! Get comfortable…', false];
    if (e.phase === PHASE.HOLD) return [`Hold steady… (${Math.round(e.holdProgress * 100)}%)`, false];
    return [e.msg || 'Hold both hands up, as if gripping a wheel', false];
  }
  if (!e.track.live) return ["Can't see both hands. Hold them up again", false];
  const k = e.stepKey;
  if (!k) return [e.startProgress > 0 ? 'Starting… keep holding it up' : 'All set! Raise it and hold to start (or press Start race)', true];
  const what = { left: 'Turn left', right: 'Turn right', low: 'Lower it (that brakes)' }[k];
  return [`Step ${e.stepIndex + 1} of ${e.steps.length}: ${what}`, false];
}

// Every frame while the lock-on screen is up.
export function updateCalib(dt, now) {
  vision.update();
  hands.update(now);
  vision.heartbeat(now / 1000);
  const cv = $('#calib-canvas'), g = cv.getContext('2d'), W = cv.width, s = W / PW;
  if (vision.cameraLost) { $('#calib-msg').innerHTML = 'The camera stopped. <button class="btn" id="btn-cam-retry">Start it again</button>'; $('#btn-cam-retry').onclick = () => enterCalib(calib.resume); return; }
  if (!vision.running) return;
  const cols = camPlayers().map((p) => PLAYER_COLORS[p.i]);
  drawTracking(g, vision, vision.engines, W, cv.height, { level: debug.on ? 'debug' : 'calib', colors: cols, tuning });
  const secs = now / 1000;
  vision.engines.forEach((e, z) => {
    const out = e.output;
    if (e.justLocked) { e.justLocked = false; sound.play('lock'); }
    if (e.justPassed) { sound.play(e.canStart ? 'lap' : 'box'); e.justPassed = null; }
    // Once locked on, flicks can be tried here: each one is shown on the ring. Not during the turn
    // steps (a quick turn there isn't a flick attempt). And a quick raise looks like a flick too, so
    // wait a moment: if the hands then stay up, it was "raise it to start", not a flick.
    if (e.flickT !== e.flickSeen) {
      if (e.flickSeen !== undefined) e.flickPending = e.flickT;
      e.flickSeen = e.flickT;
    }
    if (e.flickPending !== undefined && e.now - e.flickPending > 0.25) {
      const tryingFlicks = e.calibrated && !e.stepKey && e.doneT <= 0;
      if (tryingFlicks && !(e.zoneNow === 'raise' || e.startProgress > 0)) { e.flickShowT = performance.now() / 1000; sound.play('item'); }
      e.flickPending = undefined;
    }
    if (!e.calibrated && !e.ht.L && !e.ht.R) drawHandGuides(g, s, e, cols[z], secs);
    const p = calib.panels[z]; if (!p) return;
    const [status, ok] = statusFor(e);
    if (p.status.textContent !== status) p.status.textContent = status;
    p.status.classList.toggle('ok', ok);
    const live = e.usable, st = out.steering;
    // before the lock-on the little wheel shows how the hands are tilted; after, the steering itself
    const pre = !e.calibrated && e.ht.pair ? ((e.ht.pair.theta + 540) % 360) - 180 : null;
    p.wheel.style.transform = `rotate(${pre !== null ? Math.max(-90, Math.min(90, pre)) : st * 90}deg)`;
    p.bar.style.left = (st >= 0 ? 50 : 50 + st * 50) + '%'; p.bar.style.width = Math.abs(st) * 50 + '%';
    p.angle.textContent = live ? Math.round(e.angle * (tuning.invert ? -1 : 1)) + '°' : pre !== null ? Math.round(pre) + '°' : '–';
    p.dl.classList.toggle('on', live && st < -0.15); p.dr.classList.toggle('on', live && st > 0.15);
    const zone = live ? e.zoneNow : null;
    p.zl.classList.toggle('on', zone === 'raise'); p.zn.classList.toggle('on', zone === 'neutral'); p.zb.classList.toggle('on', zone === 'brake');
    p.tests.low.hidden = !tuning.brake; p.zb.hidden = !tuning.brake;
    for (const [k, el] of Object.entries(p.tests)) { el.classList.toggle('ok', !!e.tests[k]); el.classList.toggle('now', e.calibrated ? e.stepKey === k && e.doneT <= 0 : k === 'hold'); }
    p.skip.hidden = !e.canSkip;
    p.sl.classList.toggle('on', out.activeSignals.leftHand); p.sr.classList.toggle('on', out.activeSignals.rightHand);
    const stTxt = e.calibrated ? out.trackingState.replace('_', ' ') : '';
    if (p.ss.textContent !== stTxt) p.ss.textContent = stTxt;
    const warn = hands.failed ? "Hand tracking isn't available on this device. Use a keyboard or gamepad instead." : '';
    if (p.warn.textContent !== warn) p.warn.textContent = warn;
    if (e.calibrated && !e.manualRange && e.tests.left && e.tests.right && z === 0) $('#opt-angle-val').textContent = Math.round(e.grip.maxAngle) + '° (measured)';
  });
  $('#btn-calib-go').disabled = !camsReady();
  holdToStart(dt);
}

// Hold it up to start: once lock-on is done, any camera player raising it and holding for
// START_HOLD seconds presses Start race. Lowering lets the ring run back down, so a quick raise
// (or a tracking blip) never starts a race.
const START_HOLD = 1.5;
function holdToStart(dt) {
  const ready = app.state === 'calib' && camsReady();
  const holding = ready && vision.engines.some((e) => e.usable && e.zoneNow === 'raise');
  const before = calib.startT;
  calib.startT = holding ? before + dt : Math.max(0, before - dt * 3);
  if (holding && Math.floor(calib.startT / 0.5) > Math.floor(before / 0.5)) sound.play('count');
  for (const e of vision.engines) e.startProgress = Math.min(1, calib.startT / START_HOLD);
  if (calib.startT >= START_HOLD) { calib.startT = 0; for (const e of vision.engines) e.startProgress = 0; calibGo(); }
}
