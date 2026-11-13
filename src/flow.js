// Moving between screens and running a race: title → setup → lock-on → race → results,
// the demo race behind the menus, the pause menu, and pausing when the camera loses the hands.
import { Race, PLAYER_COLORS } from './race/race.js';
import { TRACKS } from './race/tracks.js';
import { charById } from './race/characters.js';
import { TRACK } from './steering/config.js';
import { drawTracking } from './steering/overlay.js';
import { $, $$, QUALITY, app, settings, sound, input, vision, renderer, tuning, camPlayers, camCount, toast, showScreen, keepAwake } from './app.js';
import { renderLobby, validate } from './screens/lobby.js';
import { enterCalib, recenterAll } from './screens/lockon.js';
import { onEnd } from './screens/results.js';
import { debug } from './debug.js';
import { resetResolution } from './resolution.js';

// ------------------------------------------------------------------ the demo race behind the menus
export function startAttract() {
  if (app.attract) return;
  const t = TRACKS[Math.floor(Math.random() * TRACKS.length)];
  app.attract = new Race({ attract: true, trackId: t.id, mode: 'race', players: [] }, { sound, input, vision, renderer, quality: QUALITY });
}
export function stopAttract() { app.attract?.dispose(); app.attract = null; }

// ------------------------------------------------------------------ screens
export function goLobby() {
  sound.init(); sound.menuMusic(); sound.musicLevel('menu'); sound.play('click');
  app.state = 'lobby'; showScreen('lobby'); renderLobby(); startAttract();
}

function inputSpec(value, camIndex) {
  if (value === 'camera') return { type: 'camera', zone: camIndex };
  if (value.startsWith('pad:')) return { type: 'pad', index: +value.slice(4) };
  return { type: value };
}

// The race settings from the setup screen.
export function buildCfg() {
  let cam = 0;
  return {
    mode: settings.mode, trackId: settings.trackId, laps: settings.laps,
    cpuCount: settings.cpuCount, difficulty: settings.difficulty,
    players: settings.players.map((p) => ({ charId: charById(p.charId).id, input: inputSpec(p.input, p.input === 'camera' ? cam++ : 0) })),
  };
}

// The setup screen's Next / Start button: camera players lock on first.
export function startFlow() {
  if (!validate()) return;
  sound.init();
  if (camCount() > 0) enterCalib(false);
  else launchRace(buildCfg());
}

export function launchRace(cfg) {
  stopAttract();
  app.race?.dispose();
  app.lastCfg = cfg;
  sound.init();
  resetResolution();                       // every race starts sharp
  const race = app.race = new Race(cfg, { sound, input, vision, renderer, quality: QUALITY, onEnd, onPause: () => setPause(true), debug: () => debug.on, camColors: () => camPlayers().map((q) => PLAYER_COLORS[q.i]) });
  if (race.hasCam) for (const e of vision.engines) e.start();
  hideLost();
  keepAwake(true);
  applyPip();
  app.state = 'race';
  showScreen(null);
  input.captureKeys = true;
  sound.startMusic(race.track.def.theme);
  if (sound.muted) toast('Sound is off: press M or the speaker button to turn it on', 3000);
}

export function quitToLobby() {
  app.race?.dispose(); app.race = null;
  for (const e of vision.engines) e.stop();
  hideLost();
  keepAwake(false);
  sound.stopEngines(); sound.menuMusic(); sound.musicLevel('menu');
  input.captureKeys = false;
  app.state = 'lobby'; showScreen('lobby'); renderLobby(); startAttract();
}

// The small camera picture in the race: hidden, small or large (C).
export function applyPip() { $('#hud').classList.toggle('nopip', !settings.pip); $('#hud').classList.toggle('pip-lg', settings.pip === 2); }

// ------------------------------------------------------------------ pause
export function setPause(p) {
  const race = app.race;
  if (!race || race.done) return;
  race.setPaused(p);
  app.state = p ? 'paused' : 'race';
  $('#overlay-pause').classList.toggle('active', p);
  if (!p && race.hasCam) for (const e of vision.engines) if (!e.inGame) e.start();
  $('[data-pause="recalib"]').style.display = camCount() ? '' : 'none';
  $('[data-pause="recenter"]').style.display = camCount() ? '' : 'none';
}
$$('[data-pause]').forEach((b) => b.onclick = () => {
  const a = b.dataset.pause;
  if (a === 'resume') setPause(false);
  if (a === 'recenter') { toast(recenterAll() ? 'Steering recentered' : 'Hold your wheel up to recenter'); setPause(false); }
  if (a === 'recalib') { $('#overlay-pause').classList.remove('active'); enterCalib(true); }
  if (a === 'restart') { setPause(false); launchRace(app.lastCfg); }
  if (a === 'end') { $('#overlay-pause').classList.remove('active'); app.race.paused = false; app.race.finish(); }
  if (a === 'quit') quitToLobby();
});

// ------------------------------------------------------------------ tracking lost: pause, reacquire, resume
// A player's engine reports 'paused' once it has had no reliable signal for CFG.pauseAfter.
// The race then pauses and shows the camera. When every player's controller has been tracked
// steadily again, a short countdown resumes the race. Nobody has to set up again.
export const lost = { auto: false, countdown: null, shown: '' };
export function hideLost() { lost.auto = false; $('#overlay-lost').classList.remove('active'); }

// Only players still racing count: once you've finished, the camera losing you doesn't pause
// the race for your friends.
function racingCams(race) {
  const cps = camPlayers();
  return vision.engines.map((e, z) => ({ e, p: cps[z], k: race.humans.find((k) => k.controller?.engine === e) }))
    .filter(({ k }) => !k?.finished && !k?.eliminated);
}

export function watchTracking(dt) {
  const race = app.race;
  if (!race || race.done || !vision.engines.length) return;
  const active = racingCams(race), es = active.map((a) => a.e);
  if (!es.length) { if (lost.auto) resumeFromLost(); return; }   // every camera player has finished
  if (app.state === 'race') {
    if (es.some((e) => e.state === TRACK.PAUSED) || vision.cameraLost) {
      race.setPaused(true); app.state = 'paused'; lost.auto = true; lost.countdown = null; lost.shown = '';
      $('#overlay-lost').classList.add('active');
      sound.play('click');
    }
    return;
  }
  if (app.state !== 'paused' || !lost.auto) return;
  const cps = active.map((a) => a.p), cols = cps.map((p) => PLAYER_COLORS[p.i]);
  const cam = $('#lost-cam');
  drawTracking(cam.getContext('2d'), vision, es, cam.width, cam.height, { level: 'calib', colors: cols, tuning });
  const back = (e) => e.track.live || e.state === TRACK.REACQUIRING;
  if (lost.countdown === null) {
    if (!vision.cameraLost && es.every((e) => e.track.live || e.track.readyToResume)) lost.countdown = 1.5;
  } else if (!es.every(back)) lost.countdown = null;                  // lost again during the countdown: wait
  else {
    lost.countdown -= dt;
    if (lost.countdown <= 0) return resumeFromLost();
  }
  const who = es.map((e, z) => ({ e, p: cps[z] })).filter(({ e }) => !back(e));
  const names = camCount() > 1 ? who.map(({ p }) => `P${p.i + 1}`).join(' and ') : '';
  let title, text;
  if (vision.cameraLost) { title = 'Camera disconnected'; text = 'Reconnect it, then choose Lock on again from the pause menu.'; }
  else if (lost.countdown !== null) { title = `Back in ${Math.ceil(lost.countdown / 0.5)}…`; text = 'Got you. Hold steady…'; }
  else if (es.some((e) => e.state === TRACK.REACQUIRING) && !who.length) { title = 'Found you'; text = 'Hold steady…'; }
  else { title = `Can't see ${names ? names + "'s" : 'your'} hands`; text = 'Bring both hands back into view and the race carries on by itself.'; }
  if (lost.shown !== title + text) { lost.shown = title + text; $('#lost-title').textContent = title; $('#lost-msg').textContent = text; }
  $('#btn-lost-resume').style.display = lost.countdown !== null ? '' : 'none';
}
function resumeFromLost() {
  lost.countdown = null; lost.auto = false;
  for (const e of vision.engines) if (e.state === TRACK.REACQUIRING) e.resume();
  $('#overlay-lost').classList.remove('active');
  app.race.setPaused(false); app.state = 'race';
}
$('#btn-lost-resume').onclick = () => { if (lost.auto && lost.countdown !== null) resumeFromLost(); };
$('#btn-lost-menu').onclick = () => { lost.countdown = null; hideLost(); setPause(true); };
