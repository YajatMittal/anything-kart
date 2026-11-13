import * as THREE from '../vendor/three/three.module.js';
import { Race, MODES, PLAYER_COLORS, fmtTime, ordinal } from './race/race.js';
import { TRACKS, Track } from './race/tracks.js';
import { CHARACTERS, charById, makePortraits } from './race/characters.js';
import { Input, INPUT_LABELS, INPUT_HELP, CameraController } from './input/input.js';
import { Vision, PW, PH } from './tracking/vision.js';
import { Hands } from './tracking/hands.js';
import { SteeringEngine } from './steering/engine.js';
import { DEFAULT_TUNING, TRACK, PHASE, CFG } from './steering/config.js';
import { drawTracking, drawGraph } from './steering/overlay.js';
import { Sound } from './audio/sound.js';
import { ICON } from './ui/icons.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const params = new URLSearchParams(location.search);
const TOUCH = params.has('touch') || !!window.matchMedia?.('(pointer: coarse)').matches;
const SMALL = params.has('touch') || (TOUCH && Math.min(screen.width, screen.height) < 820);
const QUALITY = SMALL ? 'low' : 'high';
document.body.classList.toggle('touch', TOUCH);

const renderer = new THREE.WebGLRenderer({ canvas: $('#gl'), antialias: !SMALL, powerPreference: 'high-performance' });
const BASE_RATIO = Math.min(window.devicePixelRatio || 1, SMALL ? 1.25 : 1.5);
renderer.setPixelRatio(BASE_RATIO);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;       // the scenery never moves, so its shadows are drawn once per track
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const input = new Input();
const vision = new Vision();
const hands = new Hands(vision);
const sound = new Sound();
const tuning = { ...DEFAULT_TUNING };   // shared by every steering engine; set from the Steering options
hands.gap = SMALL ? 50 : 30;   // up to 30 hand updates a second (20 on phones)
const FAKE = params.has('fakecam');

const portrait = (ch, cls = '') => (ch.portrait
  ? `<img class="portrait ${cls}" alt="${ch.name}" src="${ch.portrait}" style="--c:${ch.color}">`
  : `<span class="portrait ${cls}" style="--c:${ch.color}"></span>`);

// ------------------------------------------------------------------ settings
const DEFAULTS = {
  mode: 'race', trackId: 'coast', laps: 3, cpuCount: 5, difficulty: 'easy',
  players: [{ charId: 'sprocket', input: 'camera' }],
  style: 'tilt', maxAngle: 30, invert: false, pip: 1,          // pip: 0 hidden, 1 small, 2 large
  deadzone: 3, sensitivity: 1, curve: 0.3, mirrored: false, brakeGesture: false, flickSens: 'normal', autoDrift: false, v: 2,
};
let settings;
try { settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('ak-wild-settings') || '{}') }; } catch { settings = { ...DEFAULTS }; }
settings.pip = settings.pip === true ? 1 : settings.pip === false ? 0 : settings.pip;
if (!Array.isArray(settings.players) || !settings.players.length) settings.players = DEFAULTS.players;
const save = () => { try { localStorage.setItem('ak-wild-settings', JSON.stringify(settings)); } catch { /* private mode */ } };

function inputSpec(value, camIndex) {
  if (value === 'camera') return { type: 'camera', zone: camIndex };
  if (value.startsWith('pad:')) return { type: 'pad', index: +value.slice(4) };
  return { type: value };
}

// ------------------------------------------------------------------ state
let state = 'title';
let race = null, attract = null, lastCfg = null;
let toastT = null;

function toast(msg, ms = 2400) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}

function showScreen(name) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  $$('.overlay').forEach((o) => o.classList.remove('active'));
  fitMenus();
}

// Big windows and full screen: the setup and lock-on screens grow to fill the space (up to 1.5x)
// instead of sitting small at the top. Normal and small windows are left as they are.
function fitMenus() {
  requestAnimationFrame(() => {
    for (const el of $$('.screen.active .lobby, .screen.active .calib')) {
      // measure the content at its natural size (nothing stretched to fill the window)
      el.style.setProperty('--z', 1); el.classList.add('measuring');
      const top = el.getBoundingClientRect().top;
      const h = Math.max(...[...el.children].map((c) => c.getBoundingClientRect().bottom)) - top + 24;
      const w = el.getBoundingClientRect().width;
      el.classList.remove('measuring');
      const z = Math.max(1, Math.min(1.5, (innerWidth - 32) / w, (innerHeight - 8) / h));
      el.style.setProperty('--z', z.toFixed(3));
    }
  });
}

function startAttract() {
  if (attract) return;
  const t = TRACKS[Math.floor(Math.random() * TRACKS.length)];
  attract = new Race({ attract: true, trackId: t.id, mode: 'race', players: [] }, { sound, input, vision, renderer, quality: QUALITY });
}
function stopAttract() { attract?.dispose(); attract = null; }

// ------------------------------------------------------------------ how to play
function showHelp(on) { $('#overlay-help').classList.toggle('active', on); if (on) $('#overlay-help [data-help-close].btn')?.focus(); }
$$('[data-help]').forEach((b) => b.onclick = () => { sound.play('click'); showHelp(true); });
$$('[data-help-close]').forEach((b) => b.onclick = () => showHelp(false));
$('#overlay-help').addEventListener('click', (e) => { if (e.target.id === 'overlay-help') showHelp(false); });

// ------------------------------------------------------------------ title
$('#btn-play').onclick = () => goLobby();
function goLobby() { sound.init(); sound.menuMusic(); sound.musicLevel('menu'); sound.play('click'); state = 'lobby'; showScreen('lobby'); renderLobby(); startAttract(); }

// Propped-up phones get no touches during a race, so ask the screen to stay on.
let wake = null;
async function keepAwake(on) {
  try {
    if (on && !wake && navigator.wakeLock) {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    } else if (!on && wake) { await wake.release(); wake = null; }
  } catch { /* not supported, or the page isn't visible */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (state === 'race') setPause(true); return; }
  if (state === 'race' || state === 'paused' || state === 'calib') keepAwake(true);
});

// ------------------------------------------------------------------ lobby
function renderLobby() {
  $('#mode-cards').innerHTML = Object.entries(MODES).map(([id, m]) => `
    <button class="tile mode ${settings.mode === id ? 'sel' : ''}" data-mode="${id}" aria-pressed="${settings.mode === id}">
      <span class="ic">${ICON[m.icon]}</span><span class="t">${m.name}</span>
    </button>`).join('');
  $('#mode-desc').textContent = MODES[settings.mode]?.desc || '';
  $$('[data-mode]').forEach((b) => b.onclick = () => { settings.mode = b.dataset.mode; sound.play('click'); save(); renderLobby(); });

  $('#track-cards').innerHTML = TRACKS.map((t) => `
    <button class="tile track ${settings.trackId === t.id ? 'sel' : ''}" data-track="${t.id}" aria-pressed="${settings.trackId === t.id}">
      <canvas width="240" height="150" data-preview="${t.id}"></canvas>
      <span class="level l-${t.level.toLowerCase()}">${t.level}</span>
      <span class="t">${t.name}</span>
    </button>`).join('');
  $('#track-desc').textContent = TRACKS.find((t) => t.id === settings.trackId)?.blurb || '';
  $$('[data-track]').forEach((b) => b.onclick = () => { settings.trackId = b.dataset.track; sound.play('click'); save(); renderLobby(); });
  $$('[data-preview]').forEach(drawTrackPreview);

  renderPlayers();

  const tt = settings.mode === 'timetrial', lapsMode = settings.mode === 'race' || tt;
  $('#opt-laps-wrap').classList.toggle('hidden', !lapsMode);
  $('#opt-cpu-wrap').classList.toggle('hidden', tt);
  $('#opt-diff-wrap').classList.toggle('hidden', tt);
  const maxCpu = 8 - settings.players.length;
  settings.cpuCount = Math.min(settings.cpuCount, maxCpu);
  $('#opt-cpu').innerHTML = Array.from({ length: maxCpu + 1 }, (_, i) => `<option ${i === settings.cpuCount ? 'selected' : ''}>${i}</option>`).join('');
  $('#opt-laps').value = settings.laps;
  const DIFFS = [['beginner', 'Beginner', 'Relaxed: they never catch up'], ['easy', 'Easy', 'A bit slow'], ['normal', 'Normal', 'A fair race'], ['hard', 'Hard', 'Fast, sharp, no mercy']];
  $('#diff-pick').innerHTML = DIFFS.map(([id, name, tip]) => `<button class="diff ${settings.difficulty === id ? 'sel' : ''}" data-diff="${id}" role="radio" aria-checked="${settings.difficulty === id}" title="${tip}">${name}</button>`).join('');
  $$('[data-diff]').forEach((b) => b.onclick = () => { settings.difficulty = b.dataset.diff; sound.play('click'); save(); renderLobby(); });
  validate();
  fitMenus();
}

const previewCache = new Map();
function drawTrackPreview(cv) {
  const def = TRACKS.find((t) => t.id === cv.dataset.preview);
  if (!previewCache.has(def.id)) previewCache.set(def.id, new Track(def));
  const tr = previewCache.get(def.id), g = cv.getContext('2d'), b = tr.bounds;
  const s = Math.min((cv.width - 30) / (b.maxX - b.minX), (cv.height - 30) / (b.maxZ - b.minZ));
  const xf = (i) => [cv.width / 2 - (tr.x[i] - b.cx) * s, cv.height / 2 - (tr.z[i] - b.cz) * s];
  const [bg, col] = { coast: ['#7fd4e8', '#fff3cf'], snow: ['#cfe3f2', '#ffffff'], canyon: ['#e39a68', '#fbe3bf'] }[def.theme];
  g.fillStyle = bg; g.fillRect(0, 0, cv.width, cv.height);
  g.lineJoin = 'round';
  for (const [w, c] of [[11, 'rgba(22,48,43,.75)'], [6, col]]) {
    g.beginPath(); for (let i = 0; i <= tr.N; i += 2) { const [x, y] = xf(i % tr.N); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.closePath(); g.strokeStyle = c; g.lineWidth = w; g.stroke();
  }
  const [x, y] = xf(0); g.fillStyle = '#e63946'; g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
}

// A controller's name without the browser's vendor/product codes.
const padName = (p) => {
  const n = p.id.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\bWireless\b/gi, '').replace(/\s+/g, ' ').trim();
  return !n ? `Gamepad ${p.index + 1}` : n.length > 30 ? n.slice(0, 29).trim() + '…' : n;
};

// The choices for player i: camera, keyboards, then only the controllers actually connected
// (marked with who already uses them). With none connected, a single "press a button" entry.
function inputOptions(current, i) {
  const pads = input.pads();
  const user = (v) => settings.players.findIndex((q, j) => j !== i && q.input === v);
  // options someone else already has can't be picked, and say why
  const camOthers = settings.players.filter((q, j) => j !== i && q.input === 'camera').length;
  const opts = [['camera', INPUT_LABELS.camera + (camOthers >= 2 && current !== 'camera' ? ' (full: 2 max)' : ''), camOthers >= 2 && current !== 'camera']];
  for (const k of ['wasd', 'arrows']) {
    if (TOUCH && current !== k) continue;
    const j = user(k);
    opts.push([k, INPUT_LABELS[k] + (j >= 0 ? ` (P${j + 1})` : ''), j >= 0 && current !== k]);
  }
  for (const p of pads) { const j = user(`pad:${p.index}`); opts.push([`pad:${p.index}`, padName(p) + (j >= 0 ? ` (P${j + 1})` : '')]); }
  const waiting = 'Gamepad (press any button on it)';
  if (current.startsWith('pad:') && !pads.some((p) => `pad:${p.index}` === current)) opts.push([current, waiting]);
  else if (!pads.length) {
    // a free slot, so it lines up with the next controller the browser sees
    let k = 0; while (user(`pad:${k}`) >= 0) k++;
    opts.push([`pad:${k}`, waiting]);
  }
  return opts.map(([v, l, off]) => `<option value="${v}" ${v === current ? 'selected' : ''} ${off ? 'disabled' : ''}>${l}</option>`).join('');
}

// A controller just appeared: a player still waiting for one gets it (the browser numbers
// controllers itself, so the waiting slot may not match).
function claimPad(index) {
  const v = `pad:${index}`;
  if (settings.players.some((p) => p.input === v)) return;
  const pads = input.pads();
  const waiting = settings.players.find((p) => p.input.startsWith('pad:') && !pads.some((g) => `pad:${g.index}` === p.input));
  if (waiting) { waiting.input = v; save(); }
}

const cameraHelp = () => `Hold anything like a steering wheel (or just your hands) and turn it. Flick it (a quick snap) to use your item${settings.brakeGesture ? ', lower it to brake' : ''}.`;
// 1 to 5 pips from a character's stat (they range about 0.92 to 1.1)
const pips = (label, v) => {
  const n = Math.max(1, Math.min(5, Math.round(((v - 0.9) / 0.2) * 5)));
  return `<div class="pip-row"><span>${label}</span><i>${'<b class="on"></b>'.repeat(n)}${'<b></b>'.repeat(5 - n)}</i></div>`;
};
let activeSlot = 0;          // which player is choosing a racer right now

function renderPlayers() {
  const ps = settings.players;
  activeSlot = Math.min(activeSlot, ps.length - 1);
  // a racer saved by an older version may not exist any more: give that player a free one
  for (const p of ps) if (!CHARACTERS.some((c) => c.id === p.charId)) p.charId = CHARACTERS.find((c) => !ps.some((q) => q.charId === c.id))?.id || CHARACTERS[0].id;
  // the players: tap one to choose their racer
  $('#player-slots').innerHTML = ps.map((p, i) => {
    const ch = charById(p.charId);
    return `<div class="slot ${i === activeSlot ? 'on' : ''}" style="--pc:${PLAYER_COLORS[i]}">
      <button class="slot-pick" data-slot="${i}" aria-pressed="${i === activeSlot}">${portrait(ch, 'sm')}<b>P${i + 1}</b><span>${ch.name}</span></button>
      ${i > 0 ? `<button class="slot-rm" data-rm="${i}" title="Remove P${i + 1}" aria-label="Remove P${i + 1}">×</button>` : ''}
    </div>`;
  }).join('') + (ps.length < 4 ? '<button class="slot add" id="btn-add-player">+ Add player</button>' : '<span class="slot add full">4 players max</span>');
  const cams = ps.filter((q) => q.input === 'camera').length;
  $('#players-hint').innerHTML = ps.length === 1
    ? 'Up to 4 players. <b>2 can share the camera</b> (side by side); others use a keyboard or gamepad.'
    : cams >= 2 ? '<b>Camera full:</b> P1 and P2 stand side by side. Anyone else uses a keyboard or gamepad.'
      : 'Up to 4 players. <b>2 can share the camera</b> (side by side); others use a keyboard or gamepad.';

  // the chosen racer, big
  const p = ps[activeSlot], ch = charById(p.charId), i = activeSlot;
  const help = p.input === 'camera' ? cameraHelp() : p.input.startsWith('pad') ? INPUT_HELP.pad : INPUT_HELP[p.input];
  const sc = $('#showcase');
  const changed = sc.dataset.who !== `${i}:${ch.id}`; sc.dataset.who = `${i}:${ch.id}`;
  sc.style.setProperty('--c', ch.color); sc.style.setProperty('--pc', PLAYER_COLORS[i]);
  sc.innerHTML = `
    <div class="stage">
      <span class="ptag">P${i + 1}</span><span class="num">#${ch.number}</span>
      <button class="nav prev" data-prev="${i}" aria-label="Previous racer">‹</button>
      ${ch.portrait ? `<img class="hero ${changed ? 'pop' : ''}" alt="" src="${ch.portrait}">` : `<span class="hero portrait" style="--c:${ch.color}"></span>`}
      <button class="nav next" data-next="${i}" aria-label="Next racer">›</button>
    </div>
    <div class="show-name">${ch.name}</div>
    <div class="show-kind">${ch.kind}</div>
    <div class="pips">${pips('Speed', ch.speed)}${pips('Accel', ch.accel)}${pips('Handling', ch.handling)}</div>
    <label class="ctl">P${i + 1} plays with <select data-input="${i}">${inputOptions(p.input, i)}</select></label>
    <p class="help">${help}</p>`;

  // everyone to choose from
  const owner = new Map(ps.map((q, j) => [q.charId, j]));
  $('#roster').innerHTML = CHARACTERS.map((c) => {
    const j = owner.get(c.id);
    return `<button class="rtile ${j === activeSlot ? 'mine' : ''} ${j !== undefined && j !== activeSlot ? 'taken' : ''}" data-char="${c.id}" style="--c:${c.color}${j !== undefined ? `;--pc:${PLAYER_COLORS[j]}` : ''}" aria-pressed="${j === activeSlot}" title="${c.name}: ${c.kind}">
      ${portrait(c, 'md')}<span class="rn">${c.name}</span>${j !== undefined ? `<span class="rtag">P${j + 1}</span>` : ''}
    </button>`;
  }).join('');

  const pick = (i, id) => {
    const j = ps.findIndex((q, k) => k !== i && q.charId === id);
    if (j >= 0) ps[j].charId = ps[i].charId;            // taken: the two players swap
    ps[i].charId = id; sound.play('click'); save(); renderPlayers(); validate();
  };
  $$('[data-char]').forEach((b) => b.onclick = () => pick(activeSlot, b.dataset.char));
  $$('[data-slot]').forEach((b) => b.onclick = () => { activeSlot = +b.dataset.slot; sound.play('click'); renderPlayers(); });
  $$('[data-rm]').forEach((b) => b.onclick = () => { ps.splice(+b.dataset.rm, 1); if (activeSlot >= +b.dataset.rm) activeSlot = Math.max(0, activeSlot - 1); save(); renderLobby(); });
  const cycle = (i, dir) => {
    const used = new Set(ps.filter((_, j) => j !== i).map((q) => q.charId));
    let k = Math.max(0, CHARACTERS.findIndex((c) => c.id === ps[i].charId));
    do { k = (k + dir + CHARACTERS.length) % CHARACTERS.length; } while (used.has(CHARACTERS[k].id));
    ps[i].charId = CHARACTERS[k].id; sound.play('click'); save(); renderPlayers(); validate();
  };
  $$('[data-prev]').forEach((b) => b.onclick = () => cycle(+b.dataset.prev, -1));
  $$('[data-next]').forEach((b) => b.onclick = () => cycle(+b.dataset.next, 1));
  $$('[data-input]').forEach((s) => s.onchange = () => { ps[+s.dataset.input].input = s.value; save(); renderPlayers(); validate(); });
  const add = $('#btn-add-player'); if (add) add.onclick = addPlayer;
  const pads = input.pads();
  $('#pad-status').textContent = pads.length ? `Controllers connected: ${pads.map((q) => q.id.split('(')[0].trim()).join(', ')}` : '';
}

function addPlayer() {
  if (settings.players.length >= 4) return;
  const used = new Set(settings.players.map((p) => p.charId));
  const ch = CHARACTERS.find((c) => !used.has(c.id));
  const cams = settings.players.filter((p) => p.input === 'camera').length;
  const usedInputs = new Set(settings.players.map((p) => p.input));
  const pad = input.pads().find((p) => !usedInputs.has('pad:' + p.index));
  const inp = cams < 2 ? 'camera' : pad ? 'pad:' + pad.index : ['wasd', 'arrows'].find((x) => !usedInputs.has(x)) || 'pad:' + settings.players.length;
  settings.players.push({ charId: ch.id, input: inp });
  activeSlot = settings.players.length - 1;              // the new player picks their racer next
  sound.play('click'); save(); renderLobby();
}

$('#opt-laps').onchange = (e) => { settings.laps = +e.target.value; save(); };
$('#opt-cpu').onchange = (e) => { settings.cpuCount = +e.target.value; save(); };
$('#btn-lobby-back').onclick = () => { state = 'title'; showScreen('title'); };
$('#btn-mute').onclick = () => toggleMute();
$('#btn-go').onclick = () => startFlow();

function validate() {
  const ps = settings.players;
  let err = '';
  const cams = ps.filter((p) => p.input === 'camera').length;
  if (cams > 2) err = 'Only 2 players can share one camera (left side and right side).';
  const seen = new Map();
  ps.forEach((p, i) => {
    if (p.input === 'camera') return;
    if (seen.has(p.input)) err = `P${seen.get(p.input) + 1} and P${i + 1} are using the same controls.`;
    seen.set(p.input, i);
  });
  const pads = input.pads();
  const missing = ps.map((p, i) => (p.input.startsWith('pad:') && !pads.some((g) => g.index === +p.input.slice(4)) ? `P${i + 1}` : null)).filter(Boolean);
  $('#lobby-error').textContent = err || (missing.length ? `${missing.join(', ')}: gamepad not connected yet. Press a button on it.` : '');
  $('#btn-go').disabled = !!err;
  $('#btn-go').textContent = cams ? 'Next: lock on' : 'Start race';
  return !err;
}

// ------------------------------------------------------------------ race flow
function buildCfg() {
  let cam = 0;
  return {
    mode: settings.mode, trackId: settings.trackId, laps: settings.laps,
    cpuCount: settings.cpuCount, difficulty: settings.difficulty,
    players: settings.players.map((p) => ({ charId: charById(p.charId).id, input: inputSpec(p.input, p.input === 'camera' ? cam++ : 0) })),
  };
}
const camCount = () => settings.players.filter((p) => p.input === 'camera').length;
// Every camera player has done the lock-on and turned left and right once.
const camsReady = () => vision.engines.length === camCount() && vision.engines.every((e) => (calib.resume ? e.calibrated : e.canStart));

function startFlow() {
  if (!validate()) return;
  sound.init();
  if (camCount() > 0) enterCalib(false);
  else launchRace(buildCfg());
}

function launchRace(cfg) {
  stopAttract();
  race?.dispose();
  lastCfg = cfg;
  sound.init();
  race = new Race(cfg, { sound, input, vision, renderer, quality: QUALITY, onEnd, onPause: () => setPause(true), debug: () => debug.on, camColors: () => camPlayers().map((q) => PLAYER_COLORS[q.i]) });
  if (race.hasCam) for (const e of vision.engines) e.start();
  lost.auto = false; $('#overlay-lost').classList.remove('active');
  keepAwake(true);
  applyPip();
  state = 'race';
  showScreen(null);
  input.captureKeys = true;
  sound.startMusic(race.track.def.theme);
  if (sound.muted) toast('Sound is off: press M or the speaker button to turn it on', 3000);
}

function onEnd(rows, r) {
  if (r !== race) return;
  state = 'results';
  for (const e of vision.engines) e.stop();
  lost.auto = false; $('#overlay-lost').classList.remove('active');
  keepAwake(false);
  sound.stopMusic(); sound.stopEngines();
  setTimeout(() => { if (state === 'results') sound.menuMusic(); }, 3000);
  input.captureKeys = false;
  let best = {};
  try { best = JSON.parse(localStorage.getItem('ak-best') || '{}'); } catch { /* ignore */ }
  const tid = r.track.def.id;
  let record = false;
  if (r.mode === 'timetrial') {
    for (const row of rows.filter((x) => x.human && x.finishTime)) {
      const cur = best[tid];
      if (!cur || row.finishTime < cur.total) { best[tid] = { total: row.finishTime, lap: row.best }; row.record = true; record = true; }
    }
    try { localStorage.setItem('ak-best', JSON.stringify(best)); } catch { /* ignore */ }
  }
  const humans = rows.filter((x) => x.human), top = humans[0];
  let title = 'Results';
  if (top) {
    if (r.mode === 'timetrial') title = record ? 'New record!' : 'Time Trial';
    else if (humans.length === 1) title = top.place === 1 ? 'You win!' : `You finished ${ordinal(top.place)}`;
    else title = `P${top.player + 1} ${top.name} ${top.place === 1 ? 'wins!' : 'is the top player'}`;
  }
  $('#results-title').textContent = title;
  const pod = [rows[1], rows[0], rows[2]].filter(Boolean);
  $('#results-podium').innerHTML = pod.map((x) => `<div class="step p${x.place}">${portrait(x.ch, 'lg')}<b>${x.name}</b><span class="block">${x.place}</span></div>`).join('');
  const stats = [];
  if (top) {
    if (top.road !== null) stats.push([`${Math.round(top.road * 100)}%`, 'on the road']);
    if (top.gateTries) stats.push([`${top.gates}/${top.gateTries}`, 'gates cleared']);
    if (top.best) stats.push([fmtTime(top.best), 'best lap']);
  }
  $('#results-stats').innerHTML = stats.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
  $('#results-table').innerHTML = `<table class="rtable">${rows.map((x) => `
    <tr class="${x.human ? 'human' : ''}">
      <td class="pl">${x.place}</td><td class="em">${portrait(x.ch, 'sm')}</td>
      <td>${x.name}${x.human ? `<span class="tag" style="background:${humans.length > 1 ? PLAYER_COLORS[x.player] : '#16302b'}">${humans.length > 1 ? 'P' + (x.player + 1) : 'YOU'}</span>` : ''}</td>
      <td class="det">${x.detail}${x.record ? ' <span class="record">NEW RECORD</span>' : ''}</td>
    </tr>`).join('')}</table>`;
  $('#overlay-results').classList.add('active');
  if (top && top.place <= 3) confetti();
}

function confetti() {
  const c = $('#confetti'), g = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
  const cols = ['#e63946', '#ffb627', '#2ec4b6', '#fff8e8', '#1d8fe0'];
  const bits = Array.from({ length: 150 }, () => ({ x: Math.random() * c.width, y: -Math.random() * c.height, s: 5 + Math.random() * 7, v: 2 + Math.random() * 3, r: Math.random() * 6, c: cols[Math.floor(Math.random() * 5)] }));
  const end = performance.now() + 4500;
  const draw = (t) => {
    g.clearRect(0, 0, c.width, c.height);
    if (t > end || state !== 'results') return;
    for (const b of bits) {
      b.y += b.v; b.x += Math.sin(b.y / 40) * 1.2; b.r += 0.08;
      g.save(); g.translate(b.x, b.y); g.rotate(b.r); g.fillStyle = b.c; g.fillRect(-b.s / 2, -b.s / 3, b.s, b.s * 0.66); g.restore();
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

$('#btn-rematch').onclick = () => {
  $('#overlay-results').classList.remove('active');
  if (camCount() > 0 && !camsReady()) enterCalib(false);
  else launchRace(lastCfg || buildCfg());
};
$('#btn-results-lobby').onclick = () => quitToLobby();

function quitToLobby() {
  race?.dispose(); race = null;
  for (const e of vision.engines) e.stop();
  lost.auto = false; $('#overlay-lost').classList.remove('active');
  keepAwake(false);
  sound.stopEngines(); sound.menuMusic(); sound.musicLevel('menu');
  input.captureKeys = false;
  state = 'lobby'; showScreen('lobby'); renderLobby(); startAttract();
}

// ------------------------------------------------------------------ pause
function setPause(p) {
  if (!race || race.done) return;
  race.setPaused(p);
  state = p ? 'paused' : 'race';
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
  if (a === 'restart') { setPause(false); launchRace(lastCfg); }
  if (a === 'end') { $('#overlay-pause').classList.remove('active'); race.paused = false; race.finish(); }
  if (a === 'quit') quitToLobby();
});

// ------------------------------------------------------------------ lock-on
// One control system: two hands steer, whatever they're holding (any object, or nothing).
// The lock-on finds the hands, takes a steady hold as straight-ahead, then the test moves.
// All the tracking lives in js/steering/; this screen shows it and passes on button presses.
const calib = { resume: false, panels: [] };
const STEPS = ['<b>Grab anything</b> (a book, a bottle, a plate) or nothing at all, and hold it up with both hands like a steering wheel.',
  '<b>Get comfortable,</b> then <b>hold steady</b> for a second: that becomes straight ahead.',
  'Do each move the picture asks for: <b>turn left, turn right.</b> It learns how far you like to turn. In the race, <b>flick it</b> (a quick snap of your wrists, or a quick pop) to use your item.',
  'Once everything is ticked, <b>hold it up for a second and a half</b> to start, or press <b>Start race</b> (or Space).'];
const TEST_LABELS = { hold: 'Straight ahead', left: 'Turn left', right: 'Turn right', low: 'Lower = brake' };

function camPlayers() { return settings.players.map((p, i) => ({ ...p, i })).filter((p) => p.input === 'camera'); }

function applyTuning() {
  Object.assign(tuning, { deadzone: settings.deadzone, sensitivity: settings.sensitivity, curve: settings.curve, invert: settings.invert, style: settings.style, maxAngle: settings.maxAngle, brake: !!settings.brakeGesture, flick: settings.flickSens || 'normal' });
  CameraController.autoDrift = !!settings.autoDrift;
  vision.flip = !settings.mirrored;
}
function applyPip() { $('#hud').classList.toggle('nopip', !settings.pip); $('#hud').classList.toggle('pip-lg', settings.pip === 2); }
function recenterAll() { let ok = false; for (const e of vision.engines) ok = e.recenter() || ok; return ok; }

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

async function enterCalib(resume) {
  if (!resume) sound.menuMusic();                                // mid-race it keeps the race music
  sound.musicLevel('quiet');                                      // the lock-on's own sounds stay clear
  calib.resume = resume;
  stopAttract();
  state = 'calib';
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
      <div class="cp-zones"><span class="z-lift">UP ↑</span><span class="z-neutral">MIDDLE</span><span class="z-brake">BRAKE ↓</span></div>
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
      skip: q('.cp-skip'), zl: q('.z-lift'), zn: q('.z-neutral'), zb: q('.z-brake'), warn: q('.cp-warn'), sl: q('.s-l'), sr: q('.s-r'), ss: q('.s-state'),
      tests: Object.fromEntries(Array.from(el.querySelectorAll('[data-t]')).map((x) => [x.dataset.t, x])) };
  });
  $$('#calib-players [data-act]').forEach((b) => b.onclick = () => {
    const e = vision.engines[+b.closest('.cp').dataset.z];
    if (b.dataset.act === 'reset') e.resetGrip();
    if (b.dataset.act === 'skip' && e.skipStep()) toast('Skipped: using the normal height for that', 1600);
    if (b.dataset.act === 'center') toast(e.recenter() ? 'Recentered: this is straight ahead now' : 'Finish locking on first, then recenter', 1400);
  });
}

$('#opt-style').onchange = (e) => { settings.style = e.target.value; save(); applyTuning(); };
$('#opt-angle').oninput = (e) => {
  settings.maxAngle = +e.target.value; $('#opt-angle-val').textContent = settings.maxAngle + '°'; save(); applyTuning();
  for (const q of vision.engines) { q.manualRange = true; if (q.grip) q.grip.maxAngle = settings.maxAngle; }
};
$('#opt-dead').oninput = (e) => { settings.deadzone = +e.target.value; $('#opt-dead-val').textContent = settings.deadzone + '°'; save(); applyTuning(); };
$('#opt-sens').oninput = (e) => { settings.sensitivity = +e.target.value / 100; $('#opt-sens-val').textContent = e.target.value + '%'; save(); applyTuning(); };
$('#opt-curve').oninput = (e) => { settings.curve = +e.target.value / 100; $('#opt-curve-val').textContent = e.target.value + '%'; save(); applyTuning(); };
$('#opt-invert').onchange = (e) => { settings.invert = e.target.checked; save(); applyTuning(); };
// Braking by lowering: switching it on adds the "lower it" move to the lock-on (to learn how low).
$('#opt-flick').onchange = (e) => { settings.flickSens = e.target.value; save(); applyTuning(); toast('Try a flick: the ring shows FLICK! when it counts', 2000); };
$('#opt-drift').onchange = (e) => { settings.autoDrift = e.target.checked; save(); applyTuning(); toast(e.target.checked ? 'Auto drift on: long hard turns slide for a mini-boost' : 'Auto drift off', 1800); };
$('#opt-brake').onchange = (e) => { settings.brakeGesture = e.target.checked; save(); applyTuning(); toast(e.target.checked ? 'Lowering it now brakes: show it how low in the lock-on' : 'Lowering no longer brakes', 2000); };
$('#opt-mirror').onchange = (e) => {
  settings.mirrored = e.target.checked; save(); applyTuning();
  for (const q of vision.engines) q.resetGrip();     // left and right swap, so check the grip again
  toast('Camera mirroring changed: hold your hands up to lock on again', 2400);
};
$('#btn-calib-back').onclick = () => {
  if (calib.resume && race) { state = 'paused'; showScreen(null); $('#overlay-pause').classList.add('active'); sound.musicLevel('race'); return; }
  quitToLobby();
};
$('#btn-calib-go').onclick = () => calibGo();

function calibGo() {
  if (!camsReady()) {
    const e = vision.engines.find((q) => !q.canStart);
    toast(e?.calibrated ? 'Turn left and right once to finish locking on' : 'Hold your hands up to lock on first', 2200);
    return;
  }
  sound.play('click');
  if (calib.resume && race) { showScreen(null); state = 'paused'; input.captureKeys = true; sound.musicLevel('race'); setPause(false); return; }
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
  const T = e.tests;
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

function updateCalib(dt, now) {
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
    // Try flicks here: each one is shown on the ring. But a quick raise looks like a flick too, so wait
    // a moment: if the hands then stay up, it was "raise it to start", not a flick.
    if (e.flickT !== e.flickSeen) {
      if (e.flickSeen !== undefined) e.flickPending = e.flickT;
      e.flickSeen = e.flickT;
    }
    if (e.flickPending !== undefined && e.now - e.flickPending > 0.25) {
      if (!(e.zoneNow === 'lift' || e.startProgress > 0)) { e.flickShowT = performance.now() / 1000; sound.play('item'); }
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
    p.zl.classList.toggle('on', zone === 'lift'); p.zn.classList.toggle('on', zone === 'neutral'); p.zb.classList.toggle('on', zone === 'brake');
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

// Hold it up to start: once lock-on is done, any camera player lifting and holding for
// START_HOLD seconds presses Start race. Lowering lets the ring run back down, so a quick lift
// (or a tracking blip) never starts a race.
const START_HOLD = 1.5;
function holdToStart(dt) {
  const ready = state === 'calib' && camsReady();
  const holding = ready && vision.engines.some((e) => e.usable && e.zoneNow === 'lift');
  const before = calib.startT || 0;
  calib.startT = holding ? before + dt : Math.max(0, before - dt * 3);
  if (holding && Math.floor(calib.startT / 0.5) > Math.floor(before / 0.5)) sound.play('count');
  for (const e of vision.engines) e.startProgress = Math.min(1, calib.startT / START_HOLD);
  if (calib.startT >= START_HOLD) { calib.startT = 0; for (const e of vision.engines) e.startProgress = 0; calibGo(); }
}

// ------------------------------------------------------------------ keys & misc
// Full screen: the button (title, setup, pause menu) or the F key. Hidden where the browser
// doesn't allow it (iPhone Safari only allows it for videos).
const FS_ICON = {
  enter: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  exit: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
};
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
const fsSupported = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
function toggleFullscreen() {
  if (!fsSupported) return;
  const el = document.documentElement;
  if (fsElement()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else (el.requestFullscreen || el.webkitRequestFullscreen).call(el)?.catch?.(() => toast("Full screen isn't available here", 1600));
}
function syncFullscreen() {
  const on = !!fsElement();
  $$('[data-fs]').forEach((b) => {
    b.hidden = !fsSupported;
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

// Menu / shortcut keys are handled as they're pressed; driving keys are polled by the controllers.
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  const c = e.code;
  if ($('#overlay-help').classList.contains('active')) { if (c === 'Escape' || c === 'Enter' || c === 'Space') { e.preventDefault(); showHelp(false); } return; }
  if (c === 'KeyM') toggleMute();
  if (c === 'KeyF') toggleFullscreen();
  if (c === 'KeyD') toggleDebug();
  if (state === 'title' && (c === 'Enter' || c === 'Space')) goLobby();
  else if (state === 'calib' && (c === 'Enter' || c === 'Space') && tag !== 'BUTTON') { e.preventDefault(); calibGo(); }
  else if (state === 'race' || state === 'paused') {
    if (c === 'Escape' || c === 'KeyP') {
      if (lost.auto) { lost.auto = false; $('#overlay-lost').classList.remove('active'); setPause(true); }
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
  if (state === 'title' && input.anyPadTap([0, 9])) goLobby();
  else if (state === 'lobby' && input.anyPadTap([9])) startFlow();
  else if ((state === 'race' || state === 'paused') && input.anyPadTap([9])) setPause(state === 'race');
  else if (state === 'results' && input.anyPadTap([0])) $('#btn-rematch').click();
}

function fitScreen() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  race?.layout(); attract?.layout();
  fitMenus();
}
window.addEventListener('resize', fitScreen);
window.addEventListener('orientationchange', () => setTimeout(fitScreen, 250));

// If the race can't hold a smooth frame rate, draw fewer pixels until it can.
const speed = { t: 0, n: 0, step: 0, steps: [1, 0.82, 0.68, 0.56] };
function watchSpeed(dt) {
  speed.t += dt; speed.n++;
  if (speed.t < 3) return;
  const slow = speed.t / speed.n > 0.036;
  speed.t = 0; speed.n = 0;
  if (slow && speed.step < speed.steps.length - 1) renderer.setPixelRatio(BASE_RATIO * speed.steps[++speed.step]);
}
for (const ev of ['pointerdown', 'touchend', 'click']) window.addEventListener(ev, () => sound.init());
const firstSound = () => { sound.init(); if (state !== 'race' && state !== 'paused') sound.menuMusic(); };
window.addEventListener('keydown', firstSound);
window.addEventListener('pointerdown', firstSound);
window.addEventListener('gamepadconnected', (e) => {
  claimPad(e.gamepad.index);
  toast(`Connected: ${e.gamepad.id.split('(')[0].trim()}`);
  if (state === 'lobby') renderLobby();
});
window.addEventListener('gamepaddisconnected', (e) => {
  toast(`Disconnected: ${e.gamepad.id.split('(')[0].trim()}`);
  if (state === 'lobby') renderLobby();
});

// ------------------------------------------------------------------ main loop
let last = performance.now();
function tick(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
  input.poll();
  handlePads();
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
    if (state === 'race' && race.phase === 'race') watchSpeed(dt);
  } else if (attract) {
    attract.update(dt);
    attract.render(renderer);
  }
  if (debug.on) updateDebug(now);
  input.endFrame();
}

// ------------------------------------------------------------------ tracking lost: pause, reacquire, resume
// A player's engine reports 'paused' once it has had no reliable signal for CFG.pauseAfter.
// The race then pauses and shows the camera. When every player's controller has been tracked
// steadily again, a short countdown resumes the race. Nobody has to set up again.
const lost = { auto: false, countdown: null, shown: '' };
function watchTracking(dt) {
  const es = vision.engines;
  if (!race || race.done || !es.length) return;
  if (state === 'race') {
    if (es.some((e) => e.state === TRACK.PAUSED) || vision.cameraLost) {
      race.setPaused(true); state = 'paused'; lost.auto = true; lost.countdown = null; lost.shown = '';
      $('#overlay-lost').classList.add('active');
      sound.play('click');
    }
    return;
  }
  if (state !== 'paused' || !lost.auto) return;
  const cps = camPlayers(), cols = cps.map((p) => PLAYER_COLORS[p.i]);
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
  const names = cps.length > 1 ? who.map(({ p }) => `P${p.i + 1}`).join(' and ') : '';
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
  race.setPaused(false); state = 'race';
}
$('#btn-lost-resume').onclick = () => { if (lost.auto && lost.countdown !== null) resumeFromLost(); };
$('#btn-lost-menu').onclick = () => { lost.auto = false; lost.countdown = null; $('#overlay-lost').classList.remove('active'); setPause(true); };

// ------------------------------------------------------------------ diagnostics (D, or ?debug)
// Everything needed to see why tracking succeeds or fails, with a live graph of the steering
// output. For development: none of it shows unless switched on.
const debug = { on: params.has('debug'), t: 0, frames: 0, results: 0 };
function toggleDebug() { debug.on = !debug.on; $('#debug').classList.toggle('on', debug.on); toast(debug.on ? 'Diagnostics on (D to hide)' : 'Diagnostics off', 1200); }
$('#debug').classList.toggle('on', debug.on);
const f2 = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2)), f1 = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1)), pc = (v) => (v == null ? '—' : Math.round(v * 100) + '%');
function updateDebug(now) {
  debug.frames++;
  const gc = $('#debug-graph');
  drawGraph(gc.getContext('2d'), vision.engines, gc.width, gc.height);
  if (now - debug.t < 250) return;
  const secs = (now - debug.t) / 1000 || 1, fps = Math.round(debug.frames / secs), hz = Math.round((hands.results - debug.results) / secs);
  debug.t = now; debug.frames = 0; debug.results = hands.results;
  const L = [`<b>game</b> ${fps} fps · <b>camera</b> ${vision.running ? vision.fps + ' fps' : vision.cameraLost ? '<span class="bad">disconnected</span>' : 'off'} · <b>frame processing</b> ${vision.procMs.toFixed(1)} ms · <b>screen</b> ${state}`];
  if (hands.failed) L.push('<span class="bad">hand tracking unavailable on this device</span>');
  else if (hands.worker) L.push(`<b>hand tracker</b> ${hands.ready ? `${hz}/s · ${Math.round(hands.ms)} ms latency · ${hands.delegate}${hands.delegate === 'CPU' ? ' <span class="bad">(slow, no GPU)</span>' : ''} · rejected ${hands.rejected}` : 'starting…'} · picture ${vision.flip ? 'flipped by the game' : 'mirrored by the camera'}`);
  const nxy = (h, k) => (h ? `(${(h[k].x / PW).toFixed(3)}, ${(h[k].y / PH).toFixed(3)})` : '—');
  vision.engines.forEach((e, z) => {
    const d = e.diag(), st = d.state, bad = st === TRACK.LOST || st === TRACK.PAUSED;
    L.push(`<b>P${z + 1}</b> · lock-on ${d.phase} · state <b${bad ? ' class="bad"' : ''}>${st}</b>${d.lossT > 0 ? ` (lost ${d.lossT.toFixed(1)} s)` : ''} · this frame: ${d.measure}`);
    L.push(`   left wrist ${nxy(d.L, 'wrist')} palm ${nxy(d.L, 'palm')} ${pc(d.leftConf)} · right wrist ${nxy(d.R, 'wrist')} palm ${nxy(d.R, 'palm')} ${pc(d.rightConf)} · data ${Math.round(d.handsAge * 1000)} ms old`);
    L.push(`   raw angle ${f1(d.rawAngle)}° (straight-ahead at ${f1(d.theta0)}°) → relative ${f1(d.rel)}° → filtered ${f1(d.angle)}° · confidence ${pc(d.confidence)}`);
    L.push(`   <b>steering ${f2(d.steering)}</b> (full turn ${Math.round(d.maxAngle)}°) · height raw ${f2(-d.vRaw)} smooth ${f2(-d.vert)} · zone <b>${d.zone}</b>${d.armed ? '' : ' (not armed)'} · lift above ${f2(d.liftOn == null ? null : -d.liftOn)} · brake below ${f2(d.lowOn == null ? null : -d.lowOn)} · last flick: <b>${d.flick}</b>`);
  });
  $('#debug-text').innerHTML = L.join('\n');
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
  try { attract.update(1 / 60); attract.render(renderer); } catch (e) { console.error(e); }
  requestAnimationFrame(() => document.body.classList.add('ready'));
  requestAnimationFrame(frame);
  try { await Promise.all([document.fonts.load('40px "Lilita One"'), document.fonts.load('700 16px Nunito')]); } catch { /* system fonts are fine */ }
  await new Promise((r) => setTimeout(r, 60));
  makePortraits();
  $('#title-cast').innerHTML = CHARACTERS.slice(0, 7).map((c) => portrait(c, 'md')).join('');
  if (state === 'lobby') renderLobby();
}
boot();

// handy for debugging from the console
window.__ak = {
  get race() { return race; }, get attract() { return attract; }, get settings() { return settings; },
  vision, hands, input, sound, renderer, launchRace, buildCfg, enterCalib, tuning, TRACK, PHASE, CFG, lost, debug,
  draw() { (race || attract)?.render(renderer); },
  calibTick(dt, now) { updateCalib(dt, now); },
  tick(now) { tick(now); },
};
