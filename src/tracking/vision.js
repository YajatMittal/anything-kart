// The camera: one webcam stream, turned into small frames the steering system analyses.
//
// Every new camera frame is mirrored (so it behaves like a mirror) and shrunk to 320x240 for
// the steering maths; the camera views draw the full camera picture so they stay sharp. Hand tracking (hands.js) reads the camera itself; each player's
// SteeringEngine (js/steering/engine.js) is updated once per new frame. Nothing leaves the computer.

export const PW = 320, PH = 240;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Simulated webcam (?fakecam / ?fakecam=2): a person holding an alarm clock (and a
// remote for player 2) that tilt back and forth. Used to test without a camera.
class FakeCamera {
  constructor(mode) {
    this.mode = mode;
    this.canvas = document.createElement('canvas'); this.canvas.width = 640; this.canvas.height = 480;
    this.ctx = this.canvas.getContext('2d');
    this.stream = this.canvas.captureStream(30);
    this.t0 = performance.now();
    this.truth = [0, 0]; // angle in mirrored view, + = clockwise = steer right
    this.manual = null;  // tests can set { angle, lift, low } per player
    this.draw();
    this.timer = setInterval(() => this.draw(), 33);
  }
  draw() {
    const c = this.ctx, t = (performance.now() - this.t0) / 1000;
    const wall = c.createLinearGradient(0, 0, 0, 480); wall.addColorStop(0, '#d9d2c3'); wall.addColorStop(1, '#b8ae9c');
    c.fillStyle = wall; c.fillRect(0, 0, 640, 480);
    c.fillStyle = '#7a8fa6'; c.fillRect(40, 40, 140, 110); c.fillStyle = '#a6c4e0'; c.fillRect(48, 48, 124, 94);
    c.fillStyle = '#6b4f33'; c.fillRect(470, 90, 150, 12);
    ['#c0392b', '#2c3e50', '#27ae60', '#8e44ad', '#d35400'].forEach((col, i) => { c.fillStyle = col; c.fillRect(480 + i * 24, 40, 18, 50); });
    // person
    c.fillStyle = '#2f5d62'; c.beginPath(); c.ellipse(320, 470, 190, 150, 0, Math.PI, 0); c.fill();
    c.fillStyle = '#e0ac69'; c.beginPath(); c.arc(320, 170, 62, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#3b2a1a'; c.beginPath(); c.arc(320, 140, 64, Math.PI, 0); c.fill();
    const objs = this.mode === 2 ? [[480, 'clock', 0], [160, 'remote', 1]] : [[320, 'clock', 0]];
    for (const [x, kind, k] of objs) {
      let ang = 32 * Math.sin(t * 0.8 + k * 1.7) + 4 * Math.sin(t * 3.1 + k);
      let lift = (t + k * 4) % 10 < 0.8 ? -70 : 0;
      if (this.manual && this.manual[k]) { ang = this.manual[k].angle ?? ang; lift = this.manual[k].lift ? -70 : this.manual[k].low ? 70 : 0; }
      this.truth[k] = ang;
      c.save();
      c.translate(x + 10 * Math.sin(t * 0.5 + k), 300 + lift);
      c.rotate(-ang * Math.PI / 180);   // raw camera is un-mirrored, so rotation flips
      if (kind === 'clock') this.drawClock(c);
      else this.drawRemote(c);
      c.fillStyle = '#d9a066';
      c.beginPath(); c.ellipse(-78, 10, 18, 26, 0.3, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.ellipse(78, 10, 18, 26, -0.3, 0, Math.PI * 2); c.fill();
      c.restore();
    }
  }
  drawClock(c) {
    c.fillStyle = '#d4af37';
    c.beginPath(); c.arc(-38, -52, 20, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(38, -52, 20, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#222'; c.fillRect(-40, 52, 10, 18); c.fillRect(30, 52, 10, 18);
    c.fillStyle = '#d62828'; c.beginPath(); c.arc(0, 0, 60, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fbfbf2'; c.beginPath(); c.arc(0, 0, 46, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#111'; c.font = 'bold 15px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('12', 0, -33); c.fillText('3', 34, 0); c.fillText('6', 0, 34); c.fillText('9', -34, 0);
    c.strokeStyle = '#111'; c.lineWidth = 4; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -28); c.stroke();
    c.lineWidth = 3; c.beginPath(); c.moveTo(0, 0); c.lineTo(20, 10); c.stroke();
  }
  drawRemote(c) {
    c.fillStyle = '#1f4fd1'; c.beginPath(); c.roundRect(-75, -24, 150, 48, 12); c.fill();
    c.fillStyle = '#f1c40f'; c.beginPath(); c.arc(-48, 0, 10, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ecf0f1'; for (let i = 0; i < 4; i++) c.fillRect(-20 + i * 22, -10, 12, 20);
  }
  stop() { clearInterval(this.timer); }
}

export class Vision {
  constructor() {
    this.video = document.createElement('video');
    this.video.muted = true; this.video.playsInline = true; this.video.autoplay = true;
    this.canvas = document.createElement('canvas'); this.canvas.width = PW; this.canvas.height = PH;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.rgba = null;
    this.engines = [];            // one SteeringEngine per camera player, updated after every analysed frame
    this.running = false; this.fake = null; this.lastVideoTime = -1;
    this.flip = true;             // ordinary webcams send an un-mirrored picture; flip it so it works like a mirror
    this.frameNo = 0; this.lastFrameT = 0; this.cameraLost = false;
    this.fps = 0; this._fpsN = 0; this._fpsT = performance.now(); this.procMs = 0;
  }

  async start() {
    if (this.running) return;
    const fakeParam = new URLSearchParams(location.search).get('fakecam');
    let stream;
    if (fakeParam !== null) {
      this.fake = new FakeCamera(fakeParam === '2' ? 2 : 1);
      stream = this.fake.stream;
    } else {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot reach the camera here. Open the game from its secure https:// link.');
      // Laptops ask for 720p so the camera views look sharp (tracking still uses a small copy);
      // phones keep 640x480, where speed and battery matter more and the views are small.
      const hd = !matchMedia('(pointer: coarse)').matches;
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: hd ? 1280 : 640 }, height: { ideal: hd ? 720 : 480 }, facingMode: 'user' }, audio: false });
    }
    // one stream for everything; if the camera is unplugged or taken away, say so
    this.cameraLost = false;
    for (const tr of stream.getVideoTracks()) tr.addEventListener('ended', () => { this.cameraLost = true; this.running = false; });
    this.video.srcObject = stream;
    await this.video.play();
    this.running = true;
  }

  // Each camera player's part of the picture: all of it for one, left and right halves for two.
  zones(n) {
    n = clamp(n, 0, 2);
    return Array.from({ length: n }, (_, i) => (n === 1 ? { x0: 0, x1: PW } : { x0: i * PW / 2, x1: (i + 1) * PW / 2 }));
  }

  // The centre 4:3 part of the webcam picture.
  cropRect() {
    const v = this.video, vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return null;
    let sx = 0, sy = 0, sw = vw, sh = vh;
    if (vw / vh > 4 / 3) { sw = vh * 4 / 3; sx = (vw - sw) / 2; } else { sh = vw * 3 / 4; sy = (vh - sh) / 2; }
    return { sx, sy, sw, sh };
  }

  // Draws the video centre-cropped to 4:3 and mirrored (so it behaves like a mirror).
  drawMirrored(ctx, w, h, src = this.video) {
    const vw = src.videoWidth || src.width, vh = src.videoHeight || src.height;
    let sx = 0, sy = 0, sw = vw, sh = vh;
    if (vw / vh > 4 / 3) { sw = vh * 4 / 3; sx = (vw - sw) / 2; } else { sh = vw * 3 / 4; sy = (vh - sh) / 2; }
    ctx.save(); if (this.flip) { ctx.translate(w, 0); ctx.scale(-1, 1); } ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h); ctx.restore();
  }

  // Analyse the newest camera frame, if there is one. Only ever the newest: frames are never
  // queued, so a slow moment drops frames instead of adding delay.
  update() {
    if (!this.running || this.video.readyState < 2 || !this.video.videoWidth) return false;
    const t = this.video.currentTime;
    if (t === this.lastVideoTime) return false;
    this.lastVideoTime = t;
    this.process(this.video, performance.now() / 1000);
    return true;
  }

  // Analyse one frame from any image source (the webcam normally; tests pass the demo canvas).
  process(src, now) {
    const t0 = performance.now();
    this.drawMirrored(this.ctx, PW, PH, src);
    this.frameNo++; this.lastFrameT = now;
    for (const e of this.engines) e.update(now);
    this._fpsN++;
    if (performance.now() - this._fpsT > 1000) { this.fps = this._fpsN; this._fpsN = 0; this._fpsT = performance.now(); }
    this.procMs += (performance.now() - t0 - this.procMs) * 0.1;
    return true;
  }

  // If the camera stops delivering frames, the engines must still notice time passing (so
  // steering goes neutral and the race pauses instead of holding a stale value).
  heartbeat(now) {
    if (!this.engines.length || now - this.lastFrameT < 0.25) return;
    for (const e of this.engines) if (now - e.lastT > 0.1) e.update(now, true);
  }
}
