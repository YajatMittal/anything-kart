// Drawing what the tracking sees, on top of the camera picture.
//
// The ring: a circle on the object being held (centred between the hands, sized by their
// spacing) that tilts as it is turned, with a marker at the top and the steering angle.
// Nothing needs to detect the object: the hands say where it is and how it's turned.
//
// Levels of detail:
//   'calib'  the lock-on screen: ring, hand landmarks, progress
//   'pip'    the small in-race camera: ring and a status strip
//   'debug'  everything, plus the straight-ahead and height reference lines

import { PW, PH } from '../tracking/vision.js';
import { TRACK, PHASE, CFG, D2R, wrap180 } from './config.js';

const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];
const GREEN = '#2ee6a6', AMBER = '#ffb627', RED = '#ff5a5f', ORANGE = '#f26b21', GREY = 'rgba(255,255,255,0.55)';
const ZONE_COLOR = { raise: GREEN, neutral: '#9aa7a3', brake: RED };
const STATE_COLOR = { [TRACK.TRACKING]: GREEN, [TRACK.DEGRADED]: AMBER, [TRACK.LOST]: RED, [TRACK.PAUSED]: RED, [TRACK.REACQUIRING]: AMBER };

function skeleton(ctx, h, sx, sy, col) {
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const [a, b] of BONES) { ctx.moveTo(h.pts[a].x * sx, h.pts[a].y * sy); ctx.lineTo(h.pts[b].x * sx, h.pts[b].y * sy); }
  ctx.stroke();
  ctx.fillStyle = col; for (const q of h.pts) { ctx.beginPath(); ctx.arc(q.x * sx, q.y * sy, 2, 0, 7); ctx.fill(); }
}

function label(ctx, text, x, y, size) {
  ctx.font = `${size}px "Lilita One", system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff'; ctx.shadowColor = '#000'; ctx.shadowBlur = 6; ctx.fillText(text, x, y); ctx.shadowBlur = 0;
}

// mix two #rrggbb colours
const mix = (a, b, t) => {
  const p = (c, i) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  return '#' + [0, 1, 2].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t).toString(16).padStart(2, '0')).join('');
};

// The ring on the held object.
function ring(ctx, e, sx, sy, col, small, opts) {
  const r = e.ringPose(); if (!r) return;
  const live = r.live && e.calibrated && e.usable, s = (sx + sy) / 2;
  const cx = r.x * sx, cy = r.y * sy, R = Math.max(small ? 8 : 14, r.r * s);
  const turn = Math.min(1, Math.abs(e.output.steering));
  const c = !r.live ? GREY : live ? mix('#ffffff', ORANGE, turn) : col;
  // after the lock-on the ring turns by how far the hands are from their own straight ahead (what
  // the kart does), not by their tilt in the picture; before it, by their tilt
  const g = e.grip, turned = g ? wrap180(r.theta - g.theta0 - e.rotZero) : r.theta;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(turned * D2R);
  ctx.setLineDash(r.live ? [] : [8, 7]);
  ctx.lineWidth = small ? 5 : 9; ctx.strokeStyle = 'rgba(22,48,43,0.5)'; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.stroke();
  ctx.lineWidth = small ? 2.5 : 5; ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.stroke();
  ctx.setLineDash([]);
  // straight-ahead ticks left and right, and the marker at the top
  ctx.lineWidth = small ? 2 : 3.5; ctx.lineCap = 'round';
  for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sgn * R * 0.78, 0); ctx.lineTo(sgn * R * 1.0, 0); ctx.stroke(); }
  ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(0, -R, small ? 3.5 : 7, 0, 7); ctx.fill();
  ctx.lineWidth = small ? 1.5 : 2.5; ctx.strokeStyle = '#16302b'; ctx.stroke();
  ctx.restore();
  if (small) return;
  const arc = (frac, colr, w = 6) => { ctx.lineWidth = w; ctx.strokeStyle = colr; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(cx, cy, R + 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke(); };
  if (e.phase === PHASE.SETTLE && r.live) arc(e.settleLeft / CFG.settle, 'rgba(255,255,255,0.8)', 4);
  if (e.phase === PHASE.HOLD && e.samples.length) arc(e.holdProgress, GREEN);
  const coaching = opts.level === 'calib' && e.calibrated && !e.inGame;
  if (coaching && live) coach(ctx, e, cx, cy, R);
  if (coaching && live && e.startProgress > 0 && !small) label(ctx, 'START', cx, cy + 9, 30);   // holding it up to start
  // (the lock-on banner says what to do; the ring itself just shows the angle)
  const text = !r.live ? 'Show both hands' : live && !(coaching && e.doneT > 0) ? `${Math.round(e.angle * (opts.tuning?.invert ? -1 : 1))}°` : '';
  if (text) label(ctx, text, cx, cy - R - 18, live ? 24 : 20);
}

// What each lock-on move asks for, and what it's for.
const STEP_TEXT = {
  left: ['Turn left', 'Like turning a steering wheel'],
  right: ['Turn right', 'All the way you would to turn hard'],
  low: ['Lower it down', 'This is how you brake'],
};

function arrowHead(ctx, x, y, ang, sz) {
  ctx.beginPath(); ctx.moveTo(x + Math.cos(ang) * sz, y + Math.sin(ang) * sz);
  ctx.lineTo(x + Math.cos(ang + 2.5) * sz, y + Math.sin(ang + 2.5) * sz); ctx.lineTo(x + Math.cos(ang - 2.5) * sz, y + Math.sin(ang - 2.5) * sz); ctx.closePath(); ctx.fill();
}

// The lock-on coach on the ring: which way to move, how long is left to hold it, and a tick.
function coach(ctx, e, cx, cy, R) {
  const k = e.stepKey, t = performance.now() / 1000;
  if (e.doneT > 0) {                                   // just ticked: a big "nice!"
    const a = Math.min(1, (CFG.stepPause - e.doneT) / 0.15);
    ctx.globalAlpha = a; ctx.fillStyle = GREEN; ctx.beginPath(); ctx.arc(cx, cy, R * 0.55, 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(4, R * 0.12); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(cx - R * 0.25, cy); ctx.lineTo(cx - R * 0.06, cy + R * 0.2); ctx.lineTo(cx + R * 0.28, cy - R * 0.2); ctx.stroke();
    ctx.globalAlpha = 1; return;
  }
  const start = !k && e.canStart;
  if (!k && !start) return;
  const pulse = 0.5 + 0.5 * Math.sin(t * 6), col = '#ffd166', dark = 'rgba(22,48,43,0.85)';
  // each arrow is drawn twice: a dark outline, then yellow on top (visible on skin and on any object)
  const draw = (path, head) => {
    for (const [c, w, hs] of [[dark, 11, 19], [col, 6, 14]]) {
      ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round';
      ctx.beginPath(); path(); ctx.stroke(); arrowHead(ctx, head[0], head[1], head[2], hs);
    }
  };
  ctx.globalAlpha = 0.7 + 0.3 * pulse;
  const Ra = R + 26;
  if (k === 'left' || k === 'right') {                // a curved arrow around the top of the ring
    const s = k === 'left' ? -1 : 1, a0 = -Math.PI / 2 + s * 0.15, a1 = -Math.PI / 2 + s * 1.05;
    draw(() => ctx.arc(cx, cy, Ra, Math.min(a0, a1), Math.max(a0, a1)), [cx + Math.cos(a1) * Ra, cy + Math.sin(a1) * Ra, a1 + s * Math.PI / 2]);
  } else if (start || k === 'low') {  // straight up or down, on both sides of the ring
    const s = k === 'low' ? 1 : -1, bob = 6 * pulse;
    for (const side of [-1, 1]) {
      const x = cx + side * (R + 34), y0 = cy - s * R * 0.35, y1 = cy + s * (R * 0.55 + bob);
      draw(() => { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }, [x, y1, s * Math.PI / 2]);
    }
  }
  ctx.globalAlpha = 1;
  const prog = start ? e.startProgress || 0 : e.stepProgress;
  if (prog > 0) { ctx.lineWidth = start ? 9 : 6; ctx.strokeStyle = start ? ORANGE : GREEN; ctx.beginPath(); ctx.arc(cx, cy, R + 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog); ctx.stroke(); }
}

// The banner at the top of a player's side of the picture: the current lock-on step, big.
function banner(ctx, e, x0, x1, top) {
  let title, sub, n = null;
  if (!e.calibrated) {
    if (e.phase === PHASE.SETTLE) { title = 'Get comfortable'; sub = 'Hold it how you want to steer'; }
    else if (e.phase === PHASE.HOLD && e.tilted) { title = 'Hold it level'; sub = 'Like driving straight'; }
    else if (e.phase === PHASE.HOLD) { title = 'Now hold steady'; sub = 'This becomes straight ahead'; }
    else return;
  } else if (e.doneT > 0) { title = 'Nice!'; sub = e.stepKey ? `Next: ${STEP_TEXT[e.stepKey][0].toLowerCase()}` : ''; }
  else if (e.stepKey) { [title, sub] = STEP_TEXT[e.stepKey]; n = e.stepIndex + 1; }
  else if (e.startProgress > 0) { title = 'Starting…'; sub = 'Keep holding it up'; }
  else { title = 'Raise it to start'; sub = 'Or press Space'; }
  if (e.track && !e.track.live && e.calibrated && e.track.lossT > 0.2) { title = 'Show both hands'; sub = ''; }
  const w = x1 - x0, cx = (x0 + x1) / 2, bw = Math.min(w - 16, 340), bh = sub ? 64 : 44, y = top + 10;
  ctx.fillStyle = 'rgba(255,250,240,0.94)'; ctx.beginPath(); ctx.roundRect(cx - bw / 2, y, bw, bh, 14); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#16302b';
  // shrink a line until it fits the banner
  const fit = (text, size, font) => { let px = size; do { ctx.font = font(px); } while (ctx.measureText(text).width > bw - 20 && --px > 9); };
  fit(title, 26, (px) => `${px}px "Lilita One", system-ui, sans-serif`); ctx.fillText(title, cx, y + 32);
  if (sub) { fit(sub, 14, (px) => `600 ${px}px system-ui, sans-serif`); ctx.fillStyle = '#4a5e59'; ctx.fillText(sub, cx, y + 53); }
  if (n) { ctx.font = '800 12px system-ui, sans-serif'; ctx.fillStyle = '#0d7f70'; ctx.textAlign = 'left'; ctx.fillText(`STEP ${n} / ${e.steps.length}`, cx - bw / 2 + 12, y + 17); }
}

// A camera view canvas sized to the screen's real pixels, so it isn't stretched and blurry.
// Drawing code keeps working in w x h (e.g. 640x480); the canvas just has more pixels behind it.
// Never more pixels than the camera picture has (more would only cost time, not look sharper).
export function sharpCanvas(cv, w, h, video = null) {
  const shown = cv.clientWidth || w, src = video?.videoHeight ? video.videoHeight * 4 / 3 : w * 2;
  const k = Math.max(1, Math.min(2, src / w, Math.round(shown * (window.devicePixelRatio || 1) / w * 4) / 4));
  if (cv.width !== Math.round(w * k)) { cv.width = Math.round(w * k); cv.height = Math.round(h * k); }
  const g = cv.getContext('2d'); g.setTransform(k, 0, 0, k, 0, 0);
  return g;
}

// engines: SteeringEngine[]. opts: { level, colors, tuning }
export function drawTracking(ctx, vision, engines, w, h, opts = {}) {
  if (!vision.running) return;
  const level = opts.level || 'calib', debug = level === 'debug' || opts.debug, pip = level === 'pip';
  // the camera's own picture (sharp); the small 320x240 copy only if there's no live video (tests)
  const vid = vision.video;
  if (vid.readyState >= 2 && vid.videoWidth) vision.drawMirrored(ctx, w, h); else ctx.drawImage(vision.canvas, 0, 0, w, h);
  const sx = w / PW, sy = h / PH, colors = opts.colors || ['#ff4757', '#1e90ff'];
  if (engines.length === 2) {
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.setLineDash([8, 6]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke(); ctx.setLineDash([]);
  }
  const now = performance.now() / 1000;
  engines.forEach((e, k) => {
    const col = colors[k], g = e.grip;
    const hands = now - e.handsT < 0.25 ? [e.ht.L, e.ht.R].filter(Boolean) : [];
    if (!pip || debug) for (const hd of hands) skeleton(ctx, hd, sx, sy, col);
    ring(ctx, e, sx, sy, col, pip, opts);
    if (level === 'calib' && !e.inGame) banner(ctx, e, e.zone.x0 * sx, e.zone.x1 * sx, 0);
    if (debug && g) {
      // straight-ahead line through the lock-on middle, and the raise / neutral / brake heights
      const unit = (g.size0.L + g.size0.R) / 2, z = e.zone, x0 = z.x0 * sx + 6, x1 = z.x1 * sx - 6, y0 = (g.mid0.y + e.vZero * unit);
      ctx.setLineDash([4, 6]); ctx.lineWidth = 1.5;
      for (const [off, c] of [[g.raiseOn, GREEN], [g.lowOn, RED], [0, GREY]]) { const yy = (y0 + off * unit) * sy; ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke(); }
      const a = (g.theta0 + e.rotZero) * D2R, m = g.mid0, L = g.gap0 * 0.6;
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.moveTo((m.x - Math.cos(a) * L) * sx, (m.y - Math.sin(a) * L) * sy); ctx.lineTo((m.x + Math.cos(a) * L) * sx, (m.y + Math.sin(a) * L) * sy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = 'bold 12px ui-monospace, monospace'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
      if (e.ht.L && hands.length) ctx.fillText('L', e.ht.L.palm.x * sx, e.ht.L.palm.y * sy - 12);
      if (e.ht.R && hands.length) ctx.fillText('R', e.ht.R.palm.x * sx, e.ht.R.palm.y * sy - 12);
    }
    if (pip) {
      // the in-race strip: tracking status, steering direction, raise / neutral / brake
      const st = e.track.state, z = e.zone, x0 = z.x0 * sx, zw = (z.x1 - z.x0) * sx, bh = Math.max(13, h * 0.1), y = h - bh;
      ctx.fillStyle = 'rgba(10,20,18,0.72)'; ctx.fillRect(x0, y, zw, bh);
      ctx.fillStyle = STATE_COLOR[st] || RED; ctx.beginPath(); ctx.arc(x0 + bh * 0.5, y + bh * 0.5, bh * 0.26, 0, 7); ctx.fill();
      ctx.font = `bold ${Math.round(bh * 0.62)}px system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
      const txt = e.oneHand ? '1 HAND' : st === TRACK.TRACKING || st === TRACK.DEGRADED ? 'HANDS' : st === TRACK.REACQUIRING ? 'FOUND…' : 'LOST';
      ctx.fillText(txt, x0 + bh * 0.95, y + bh * 0.54);
      const mx = x0 + zw * 0.62, bw = zw * 0.26, sv = e.output.steering;
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(mx - bw / 2, y + bh * 0.42, bw, bh * 0.16);
      ctx.fillStyle = '#fff'; ctx.fillRect(sv >= 0 ? mx : mx + sv * bw / 2, y + bh * 0.3, Math.abs(sv) * bw / 2, bh * 0.4);
      ctx.fillStyle = ZONE_COLOR[e.zoneNow]; ctx.fillRect(x0 + zw - bh * 1.15, y + bh * 0.2, bh * 0.9, bh * 0.6);
      ctx.textBaseline = 'alphabetic';
    }
  });
}

// A live graph of the steering output (white) and height (teal) for the diagnostics panel.
export function drawGraph(ctx, engines, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
  const cols = [['#ffffff', '#5eead4'], ['#ffd166', '#93c5fd']];
  engines.forEach((e, k) => {
    const H = e.history, n = H.steer.length;
    for (const [arr, col] of [[H.vert, cols[k % 2][1]], [H.steer, cols[k % 2][0]]]) {
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let i = 0; i < n; i++) { const val = arr[(H.i + i) % n], x = (i / (n - 1)) * w, y = h / 2 - Math.max(-1, Math.min(1, val)) * (h / 2 - 2); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke();
    }
  });
}
