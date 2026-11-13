// Race setup: mode, track, players (racer and controls), laps, bots.
import { MODES, PLAYER_COLORS } from '../race/race.js';
import { TRACKS, Track } from '../race/tracks.js';
import { CHARACTERS, charById } from '../race/characters.js';
import { INPUT_LABELS, INPUT_HELP } from '../input/input.js';
import { ICON } from '../ui/icons.js';
import { $, $$, TOUCH, app, settings, save, sound, input, hands, camCount, portrait, showScreen, fitMenus } from '../app.js';
import { startFlow } from '../flow.js';

export function renderLobby() {
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
export function claimPad(index) {
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
  // Hand tracking takes a few seconds to download and start the first time, so as soon as anyone
  // is set to play by camera it starts loading in the background (if it isn't already).
  if (camCount() && app.state === 'lobby') hands.start(camCount() * 2);
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

// Whether the setup can start, with the reason shown if not.
export function validate() {
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

$('#opt-laps').onchange = (e) => { settings.laps = +e.target.value; save(); };
$('#opt-cpu').onchange = (e) => { settings.cpuCount = +e.target.value; save(); };
$('#btn-lobby-back').onclick = () => { app.state = 'title'; showScreen('title'); };
$('#btn-go').onclick = () => startFlow();
