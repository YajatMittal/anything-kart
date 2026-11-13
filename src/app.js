// Shared by every screen: the renderer, camera, hand tracker, input and sound, the saved
// settings, the app's current state, and a few small page helpers.
import * as THREE from 'three';
import { Input } from './input/input.js';
import { Vision } from './tracking/vision.js';
import { Hands } from './tracking/hands.js';
import { DEFAULT_TUNING } from './steering/config.js';
import { Sound } from './audio/sound.js';

export const $ = (s) => document.querySelector(s);
export const $$ = (s) => Array.from(document.querySelectorAll(s));

// ------------------------------------------------------------------ device
export const params = new URLSearchParams(location.search);
export const TOUCH = params.has('touch') || !!window.matchMedia?.('(pointer: coarse)').matches;
export const SMALL = params.has('touch') || (TOUCH && Math.min(screen.width, screen.height) < 820);
// Phones get everything except the biggest shadow map; if one can't keep up, the resolution steps
// down by itself (resolution.js). ?quality=low|medium|high overrides it, for testing.
export const QUALITY = ['low', 'medium', 'high'].includes(params.get('quality')) ? params.get('quality') : SMALL ? 'medium' : 'high';
export const FAKE = params.has('fakecam');
document.body.classList.toggle('touch', TOUCH);

// ------------------------------------------------------------------ renderer
export const renderer = new THREE.WebGLRenderer({ canvas: $('#gl'), antialias: QUALITY !== 'low', powerPreference: 'high-performance' });
// the sharpest the race is drawn (phone screens are very dense, so they cap at 2x)
export const BASE_RATIO = Math.min(window.devicePixelRatio || 1, QUALITY === 'low' ? 1.25 : SMALL ? 2 : 1.5);
renderer.setPixelRatio(BASE_RATIO);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;       // the scenery never moves, so its shadows are drawn once per track
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

// ------------------------------------------------------------------ systems
export const input = new Input();
export const vision = new Vision();
export const hands = new Hands(vision);
hands.gap = SMALL ? 50 : 30;   // up to 30 hand updates a second (20 on phones)
export const sound = new Sound();
export const tuning = { ...DEFAULT_TUNING };   // shared by every steering engine; set from the Steering options

// ------------------------------------------------------------------ app state
// state: 'title' | 'lobby' | 'calib' | 'race' | 'paused' | 'results'
// race: the race being played; attract: the demo race behind the menus; lastCfg: for Rematch
export const app = { state: 'title', race: null, attract: null, lastCfg: null };

// ------------------------------------------------------------------ settings (saved in the browser)
const DEFAULTS = {
  mode: 'race', trackId: 'coast', laps: 3, cpuCount: 5, difficulty: 'easy',
  players: [{ charId: 'sprocket', input: 'camera' }],
  style: 'tilt', maxAngle: 30, invert: false, pip: 1,          // pip: 0 hidden, 1 small, 2 large
  deadzone: 3, sensitivity: 1, curve: 0.3, mirrored: false, brakeGesture: false, flickSens: 'normal', autoDrift: false, v: 2,
};
function loadSettings() {
  let s;
  try { s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('ak-wild-settings') || '{}') }; } catch { s = { ...DEFAULTS }; }
  s.pip = s.pip === true ? 1 : s.pip === false ? 0 : s.pip;
  if (!Array.isArray(s.players) || !s.players.length) s.players = DEFAULTS.players;
  return s;
}
export const settings = loadSettings();
export const save = () => { try { localStorage.setItem('ak-wild-settings', JSON.stringify(settings)); } catch { /* private mode */ } };

export const camPlayers = () => settings.players.map((p, i) => ({ ...p, i })).filter((p) => p.input === 'camera');
export const camCount = () => settings.players.filter((p) => p.input === 'camera').length;

// ------------------------------------------------------------------ page helpers
export const portrait = (ch, cls = '') => (ch.portrait
  ? `<img class="portrait ${cls}" alt="${ch.name}" src="${ch.portrait}" style="--c:${ch.color}">`
  : `<span class="portrait ${cls}" style="--c:${ch.color}"></span>`);

let toastT = null;
export function toast(msg, ms = 2400) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}

export function showScreen(name) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  $$('.overlay').forEach((o) => o.classList.remove('active'));
  fitMenus();
}

// Big windows and full screen: the setup and lock-on screens grow to fill the space (up to 1.5x)
// instead of sitting small at the top. Normal and small windows are left as they are.
export function fitMenus() {
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

// Propped-up phones get no touches during a race, so ask the screen to stay on.
let wake = null;
export async function keepAwake(on) {
  try {
    if (on && !wake && navigator.wakeLock) {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    } else if (!on && wake) { await wake.release(); wake = null; }
  } catch { /* not supported, or the page isn't visible */ }
}
