// Diagnostics (D key, or ?debug in the address): everything needed to see why tracking succeeds
// or fails, with a live graph of the steering output. For development: none of it shows unless
// switched on.
import { PW, PH } from './tracking/vision.js';
import { TRACK } from './steering/config.js';
import { drawGraph } from './steering/overlay.js';
import { $, params, app, vision, hands, toast } from './app.js';

export const debug = { on: params.has('debug'), t: 0, frames: 0, results: 0 };
$('#debug').classList.toggle('on', debug.on);

export function toggleDebug() {
  debug.on = !debug.on;
  $('#debug').classList.toggle('on', debug.on);
  toast(debug.on ? 'Diagnostics on (D to hide)' : 'Diagnostics off', 1200);
}

const f2 = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2));
const f1 = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1));
const pc = (v) => (v == null ? '—' : Math.round(v * 100) + '%');

export function updateDebug(now) {
  debug.frames++;
  const gc = $('#debug-graph');
  drawGraph(gc.getContext('2d'), vision.engines, gc.width, gc.height);
  if (now - debug.t < 250) return;
  const secs = (now - debug.t) / 1000 || 1, fps = Math.round(debug.frames / secs), hz = Math.round((hands.results - debug.results) / secs);
  debug.t = now; debug.frames = 0; debug.results = hands.results;
  const L = [`<b>game</b> ${fps} fps · <b>camera</b> ${vision.running ? vision.fps + ' fps' : vision.cameraLost ? '<span class="bad">disconnected</span>' : 'off'} · <b>frame processing</b> ${vision.procMs.toFixed(1)} ms · <b>screen</b> ${app.state}`];
  if (hands.failed) L.push('<span class="bad">hand tracking unavailable on this device</span>');
  else if (hands.worker) L.push(`<b>hand tracker</b> ${hands.ready ? `${hz}/s · ${Math.round(hands.ms)} ms latency · ${hands.delegate}${hands.delegate === 'CPU' ? ' <span class="bad">(slow, no GPU)</span>' : ''} · rejected ${hands.rejected}` : 'starting…'} · picture ${vision.flip ? 'flipped by the game' : 'mirrored by the camera'}`);
  const nxy = (h, k) => (h ? `(${(h[k].x / PW).toFixed(3)}, ${(h[k].y / PH).toFixed(3)})` : '—');
  vision.engines.forEach((e, z) => {
    const d = e.diag(), st = d.state, bad = st === TRACK.LOST || st === TRACK.PAUSED;
    L.push(`<b>P${z + 1}</b> · lock-on ${d.phase} · state <b${bad ? ' class="bad"' : ''}>${st}</b>${d.lossT > 0 ? ` (lost ${d.lossT.toFixed(1)} s)` : ''} · this frame: ${d.measure}`);
    L.push(`   left wrist ${nxy(d.L, 'wrist')} palm ${nxy(d.L, 'palm')} ${pc(d.leftConf)} · right wrist ${nxy(d.R, 'wrist')} palm ${nxy(d.R, 'palm')} ${pc(d.rightConf)} · data ${Math.round(d.handsAge * 1000)} ms old`);
    L.push(`   raw angle ${f1(d.rawAngle)}° (straight-ahead at ${f1(d.theta0)}°) → relative ${f1(d.rel)}° → filtered ${f1(d.angle)}° · confidence ${pc(d.confidence)}`);
    L.push(`   <b>steering ${f2(d.steering)}</b> (full turn ${Math.round(d.maxAngle)}°) · height raw ${f2(-d.vRaw)} smooth ${f2(-d.vert)} · zone <b>${d.zone}</b>${d.armed ? '' : ' (not armed)'} · raise above ${f2(d.raiseOn == null ? null : -d.raiseOn)} · brake below ${f2(d.lowOn == null ? null : -d.lowOn)} · last flick: <b>${d.flick}</b>`);
  });
  $('#debug-text').innerHTML = L.join('\n');
}
