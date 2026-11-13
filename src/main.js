// Anything Kart starts here: wires up the keys, gamepads, window and sound, runs the frame loop,
// and boots the title screen. Each screen lives in src/screens/; moving between them is in flow.js.
import { CHARACTERS, makePortraits } from './race/characters.js';
import { ITEMS } from './race/race.js';
import { TRACK, PHASE, CFG } from './steering/config.js';
import { ICON } from './ui/icons.js';
import { $, $$, app, settings, save, sound, input, vision, hands, renderer, tuning, camCount, portrait, toast, fitMenus, keepAwake } from './app.js';
import { goLobby, startFlow, launchRace, buildCfg, setPause, applyPip, startAttract, watchTracking, lost, hideLost } from './flow.js';
import { renderLobby, claimPad } from './screens/lobby.js';
import { enterCalib, updateCalib, calibGo, recenterAll } from './screens/lockon.js';
import './screens/results.js';
import { debug, toggleDebug, updateDebug } from './debug.js';
import { watchSpeed } from './resolution.js';
import { inject as startAnalytics } from '@vercel/analytics';

// Anonymous visitor counts (Vercel Web Analytics): no cookies, nothing personal, nothing from the
// camera. Only on the live site, so local testing doesn't count.
if (import.meta.env.PROD) startAnalytics({ mode: 'production' });

// ------------------------------------------------------------------ title and how to play
$('#btn-play').onclick = () => goLobby();

// The How to play card's item list, from the items themselves
$('#help-items').innerHTML = Object.values(ITEMS).map((it) => `<div><span class="ic">${ICON[it.icon]}</span><span><b>${it.name}</b> ${it.desc}</span></div>`).join('')
  + `<div class="acorn-row"><span class="ic">${ICON.acorn}</span><span><b>Acorns</b> on the track make you a little faster, up to 10. Getting hit drops 2.</span></div>`;
function showHelp(on) { $('#overlay-help').classList.toggle('active', on); if (on) $('#overlay-help [data-help-close].btn')?.focus(); }
$$('[data-help]').forEach((b) => b.onclick = () => { sound.play('click'); showHelp(true); });
$$('[data-help-close]').forEach((b) => b.onclick = () => showHelp(false));
$('#overlay-help').addEventListener('click', (e) => { if (e.target.id === 'overlay-help') showHelp(false); });

// Switching tabs pauses the race; coming back keeps the screen awake again.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (app.state === 'race') setPause(true); return; }
  if (app.state === 'race' || app.state === 'paused' || app.state === 'calib') keepAwake(true);
});

// ------------------------------------------------------------------ full screen and sound
// Full screen: the button (title, setup, pause menu) or the F key. iPhones don't let websites go
// full screen, but a game added to the home screen opens full screen, so there the button says how.
// Opened from the home screen it's already full screen, so the button is hidden.
const IPHONE = /iPhone|iPod/.test(navigator.userAgent);
const INSTALLED = navigator.standalone === true || !!window.matchMedia?.('(display-mode: standalone)').matches;
const FS_ICON = {
  enter: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  exit: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
};
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
const fsSupported = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
function toggleFullscreen() {
  if (!fsSupported) {
    if (IPHONE) toast('To play full screen on iPhone: tap Share, then "Add to Home Screen", and open Anything Kart from your home screen', 6000);
    return;
  }
  const el = document.documentElement;
  if (fsElement()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else (el.requestFullscreen || el.webkitRequestFullscreen).call(el)?.catch?.(() => toast("Full screen isn't available here", 1600));
}
function syncFullscreen() {
  const on = !!fsElement();
  $$('[data-fs]').forEach((b) => {
    b.hidden = INSTALLED || !(fsSupported || IPHONE);
    if (b.hasAttribute('data-fs-text')) b.textContent = on ? 'Exit full screen (F)' : 'Full screen (F)';
    else { b.innerHTML = on ? FS_ICON.exit : FS_ICON.enter; b.title = on ? 'Exit full screen (F)' : 'Full screen (F)'; }
  });
}
$$('[data-fs]').forEach((b) => b.onclick = () => { sound.play('click'); toggleFullscreen(); });
document.addEventListener('fullscreenchange', syncFullscreen);
document.addEventListener('webkitfullscreenchange', syncFullscreen);
syncFullscreen();

function toggleMute() {
  sound.init(); sound.setMuted(!sound.muted);
  $('#btn-mute').innerHTML = sound.muted ? ICON.muted : ICON.sound;
  toast(sound.muted ? 'Sound off' : 'Sound on', 1200);
}
$('#btn-mute').innerHTML = sound.muted ? ICON.muted : ICON.sound;
$('#btn-mute').onclick = () => toggleMute();

// Browsers only allow sound after the player does something, so start it on the first input.
for (const ev of ['pointerdown', 'touchend', 'click']) window.addEventListener(ev, () => sound.init());
const firstSound = () => { sound.init(); if (app.state !== 'race' && app.state !== 'paused') sound.menuMusic(); };
window.addEventListener('keydown', firstSound);
window.addEventListener('pointerdown', firstSound);

// ------------------------------------------------------------------ keys and gamepads
// Menu / shortcut keys are handled as they're pressed; driving keys are polled by the controllers.
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  const c = e.code, state = app.state;
  if ($('#overlay-help').classList.contains('active')) { if (c === 'Escape' || c === 'Enter' || c === 'Space') { e.preventDefault(); showHelp(false); } return; }
  if (c === 'KeyM') toggleMute();
  if (c === 'KeyF') toggleFullscreen();
  if (c === 'KeyD') toggleDebug();
  if (state === 'title' && (c === 'Enter' || c === 'Space')) goLobby();
  else if (state === 'calib' && (c === 'Enter' || c === 'Space') && tag !== 'BUTTON') { e.preventDefault(); calibGo(); }
  else if (state === 'race' || state === 'paused') {
    if (c === 'Escape' || c === 'KeyP') {
      if (lost.auto) { hideLost(); setPause(true); }
      else setPause(state === 'race');
    }
    if (c === 'KeyR' && camCount()) toast(recenterAll() ? 'Steering recentered' : 'Hold both hands up to recenter', 1000);
    if (c === 'KeyC') { settings.pip = (settings.pip + 1) % 3; save(); applyPip(); toast(['Camera view hidden', 'Camera view: small', 'Camera view: large'][settings.pip], 900); }
  } else if (state === 'calib') {
    if (c === 'KeyR') toast(recenterAll() ? 'Steering recentered' : 'Finish locking on first, then recenter', 1000);
    if (c === 'Enter') calibGo();
  } else if (state === 'results' && c === 'Enter') $('#btn-rematch').click();
});

// Gamepad buttons have no events, so they're checked each frame.
function handlePads() {
  const state = app.state;
  if (state === 'title' && input.anyPadTap([0, 9])) goLobby();
  else if (state === 'lobby' && input.anyPadTap([9])) startFlow();
  else if ((state === 'race' || state === 'paused') && input.anyPadTap([9])) setPause(state === 'race');
  else if (state === 'results' && input.anyPadTap([0])) $('#btn-rematch').click();
}
window.addEventListener('gamepadconnected', (e) => {
  claimPad(e.gamepad.index);
  toast(`Connected: ${e.gamepad.id.split('(')[0].trim()}`);
  if (app.state === 'lobby') renderLobby();
});
window.addEventListener('gamepaddisconnected', (e) => {
  toast(`Disconnected: ${e.gamepad.id.split('(')[0].trim()}`);
  if (app.state === 'lobby') renderLobby();
});

// ------------------------------------------------------------------ window size and frame rate
function fitScreen() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  app.race?.layout(); app.attract?.layout();
  fitMenus();
}
window.addEventListener('resize', fitScreen);
window.addEventListener('orientationchange', () => setTimeout(fitScreen, 250));


// ------------------------------------------------------------------ main loop
let last = performance.now();
function tick(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
  input.poll();
  handlePads();
  const { state, race, attract } = app;   // read after the pads, which can change screens
  if (state === 'calib') {
    updateCalib(dt, now);
  } else if (race && (state === 'race' || state === 'paused' || state === 'results')) {
    if (race.hasCam) {
      vision.update(); hands.update(now);
      vision.heartbeat(now / 1000);
      watchTracking(dt);
    }
    race.update(dt);
    race.render(renderer);
    if (app.state === 'race' && race.phase === 'race') watchSpeed(dt, race);
  } else if (attract) {
    attract.update(dt);
    attract.render(renderer);
  }
  if (debug.on) updateDebug(now);
  input.endFrame();
}

// One bad frame must never freeze the game: log it and keep going.
function frame(now) {
  try { tick(now); } catch (e) { console.error(e); }
  requestAnimationFrame(frame);
}

async function boot() {
  // The 3D background comes first, drawn straight away and faded in over the sky colour, so the
  // title never sits on a blank screen. The racer portraits are made just after it.
  startAttract();
  try { app.attract.update(1 / 60); app.attract.render(renderer); } catch (e) { console.error(e); }
  requestAnimationFrame(() => document.body.classList.add('ready'));
  requestAnimationFrame(frame);
  try { await Promise.all([document.fonts.load('40px "Lilita One"'), document.fonts.load('700 16px Nunito')]); } catch { /* system fonts are fine */ }
  await new Promise((r) => setTimeout(r, 60));
  makePortraits();
  $('#title-cast').innerHTML = CHARACTERS.slice(0, 7).map((c) => portrait(c, 'md')).join('');
  if (app.state === 'lobby') renderLobby();
}
boot();

// For the tests and for debugging from the browser console.
window.__ak = {
  get race() { return app.race; }, get attract() { return app.attract; }, get settings() { return settings; },
  vision, hands, input, sound, renderer, launchRace, buildCfg, enterCalib, tuning, TRACK, PHASE, CFG, lost, debug,
  draw() { (app.race || app.attract)?.render(renderer); },
  calibTick(dt, now) { updateCalib(dt, now); },
  tick(now) { tick(now); },
};
