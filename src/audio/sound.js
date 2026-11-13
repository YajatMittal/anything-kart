// Everything you hear is synthesized with WebAudio — no sound files.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

const SONGS = {
  coast: { bpm: 132, wave: 'triangle', chords: [[60, 64, 67], [65, 69, 72], [62, 65, 69], [67, 71, 74]] },
  snow: { bpm: 118, wave: 'sine', chords: [[57, 60, 64], [65, 69, 72], [60, 64, 67], [64, 67, 71]] },
  canyon: { bpm: 146, wave: 'sawtooth', chords: [[52, 55, 59], [50, 53, 57], [48, 52, 55], [50, 54, 57]] },
  // the menus: slower, softer, no drums
  menu: { bpm: 104, wave: 'sine', chords: [[60, 64, 67], [57, 60, 64], [65, 69, 72], [67, 71, 74]], calm: true },
};
const MUSIC_LEVEL = { race: 0.42, menu: 0.26, quiet: 0.13 };
const LEAD = [2, -1, -1, 1, -1, 0, 1, -1, 3, -1, 2, -1, 1, 0, -1, -1];
const LEAD_B = [0, 1, 2, -1, 3, -1, 2, 1, -1, 0, -1, 1, 2, -1, -1, 3];

export class Sound {
  constructor() {
    this.ctx = null;
    try { this.muted = localStorage.getItem('ak-muted') === '1'; } catch { this.muted = false; }
    this.engines = [];
    this.song = null; this.step = 0; this.nextTime = 0; this.timer = null;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.8; this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = MUSIC_LEVEL.race; this.musicBus.connect(this.master);
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('ak-muted', m ? '1' : '0'); } catch { /* storage unavailable */ }
    if (this.master) this.master.gain.value = m ? 0 : 0.8;
  }

  tone(freq, dur, { type = 'square', vol = 0.15, slide = null, delay = 0, bus = null } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus || this.sfxBus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise(dur, { vol = 0.2, freq = 1200, type = 'bandpass', delay = 0, bus = null, q = 1 } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus || this.sfxBus);
    s.start(t); s.stop(t + dur + 0.02);
  }

  play(name) {
    if (!this.ctx) return;
    switch (name) {
      case 'acorn': this.tone(1760, 0.09, { type: 'sine', slide: 2640, vol: 0.13 }); this.noise(0.04, { freq: 3500, vol: 0.05 }); break;
      case 'gate': [1047, 1397].forEach((f, i) => this.tone(f, 0.14, { type: 'triangle', delay: i * 0.06, vol: 0.13 })); break;
      case 'shield': this.tone(420, 0.45, { type: 'sine', slide: 1100, vol: 0.13 }); break;
      case 'pop': this.noise(0.1, { freq: 2600, vol: 0.4 }); this.tone(900, 0.08, { type: 'sine', slide: 220, vol: 0.14 }); break;
      case 'buzz': this.tone(190, 0.5, { type: 'sawtooth', slide: 240, vol: 0.07 }); break;
      case 'splat': this.noise(0.3, { freq: 260, type: 'lowpass', vol: 0.5 }); break;
      case 'rescue': [523, 784, 1047].forEach((f, i) => this.tone(f, 0.13, { type: 'sine', delay: i * 0.07, vol: 0.13 })); break;
      case 'box': [660, 880, 1100].forEach((f, i) => this.tone(f, 0.08, { type: 'triangle', delay: i * 0.05, vol: 0.12 })); break;
      case 'tick': this.tone(1500, 0.03, { vol: 0.04 }); break;
      case 'item': [784, 1047, 1319].forEach((f, i) => this.tone(f, 0.12, { type: 'triangle', delay: i * 0.06, vol: 0.14 })); break;
      case 'boost': this.noise(0.6, { freq: 500, type: 'lowpass', vol: 0.35 }); this.tone(180, 0.5, { type: 'sawtooth', slide: 700, vol: 0.08 }); break;
      case 'turbo': this.tone(600, 0.18, { type: 'square', slide: 1500, vol: 0.08 }); this.noise(0.3, { freq: 2000, vol: 0.15 }); break;
      case 'hit': this.noise(0.45, { freq: 350, vol: 0.45 }); this.tone(320, 0.6, { type: 'sawtooth', slide: 50, vol: 0.12 }); break;
      case 'bump': this.noise(0.14, { freq: 180, type: 'lowpass', vol: 0.4 }); break;
      case 'throw': this.tone(520, 0.16, { type: 'triangle', slide: 220, vol: 0.14 }); break;
      case 'drop': this.tone(300, 0.15, { type: 'triangle', slide: 160, vol: 0.14 }); break;
      case 'count': this.tone(523, 0.3, { vol: 0.16 }); break;
      case 'go': this.tone(1047, 0.7, { vol: 0.16 }); this.tone(1568, 0.7, { vol: 0.08 }); break;
      case 'lap': [784, 988, 1175].forEach((f, i) => this.tone(f, 0.15, { delay: i * 0.08, vol: 0.12 })); break;
      case 'final': [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 0.14, { delay: i * 0.09, vol: 0.12 })); break;
      case 'finish': [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => this.tone(f, 0.3, { delay: i * 0.1, type: 'triangle', vol: 0.15 })); break;
      case 'out': this.noise(0.8, { freq: 150, type: 'lowpass', vol: 0.5 }); this.tone(200, 0.8, { type: 'square', slide: 40, vol: 0.1 }); break;
      case 'lock': this.tone(880, 0.1, { vol: 0.12 }); this.tone(1320, 0.25, { delay: 0.1, vol: 0.12 }); break;
      case 'click': this.tone(700, 0.05, { type: 'triangle', vol: 0.1 }); break;
    }
  }

  // Continuous engine hum for one human kart.
  engine() {
    if (!this.ctx) return { set() {}, stop() {} };
    const c = this.ctx;
    const o1 = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o1.type = 'sawtooth'; o2.type = 'square'; o2.detune.value = 9;
    f.type = 'lowpass'; f.frequency.value = 500; g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.sfxBus);
    o1.start(); o2.start();
    const e = {
      set: (speedNorm, boosting, vol = 1) => {
        const t = c.currentTime, fr = 48 + 95 * speedNorm + (boosting ? 35 : 0);
        o1.frequency.setTargetAtTime(fr, t, 0.05); o2.frequency.setTargetAtTime(fr * 0.5, t, 0.05);
        f.frequency.setTargetAtTime(350 + 900 * speedNorm, t, 0.08);
        g.gain.setTargetAtTime((0.018 + 0.03 * speedNorm) * vol, t, 0.08);
      },
      stop: () => { try { g.gain.setTargetAtTime(0, c.currentTime, 0.05); o1.stop(c.currentTime + 0.3); o2.stop(c.currentTime + 0.3); } catch { /* already stopped */ } },
    };
    this.engines.push(e);
    return e;
  }

  stopEngines() { this.engines.forEach((e) => e.stop()); this.engines = []; }

  startMusic(theme) {
    if (!this.ctx) return;
    this.stopMusic();
    this.theme = theme;
    this.song = SONGS[theme] || SONGS.coast;
    this.musicLevel(theme === 'menu' ? 'menu' : 'race');
    this.step = 0; this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stopMusic() { clearInterval(this.timer); this.timer = null; this.song = null; this.theme = null; }

  // The menu tune, unless it's already playing (sound can only start after a click or key press).
  menuMusic() { if (this.ctx && this.theme !== 'menu') this.startMusic('menu'); }

  // How loud the music is: 'race', 'menu', or 'quiet' (under the lock-on screen's own sounds).
  musicLevel(level) {
    if (!this.musicBus) return;
    const g = this.musicBus.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(MUSIC_LEVEL[level] ?? MUSIC_LEVEL.race, t + 0.4);
  }

  schedule() {
    const c = this.ctx, s = this.song; if (!s) return;
    const stepDur = 60 / s.bpm / 4;
    while (this.nextTime < c.currentTime + 0.12) {
      const st = this.step, bar = Math.floor(st / 16) % 8, pos = st % 16, chord = s.chords[bar % 4];
      const when = this.nextTime - c.currentTime, bus = this.musicBus;
      if (pos % 2 === 0) this.tone(midi(chord[0] - 24 + (pos % 4 === 2 ? 12 : 0)), stepDur * 1.8, { type: 'triangle', vol: 0.22, delay: when, bus });
      const pat = bar >= 4 ? LEAD_B : LEAD, n = pat[pos];
      if (n >= 0) {
        const note = n === 3 ? chord[0] + 12 : chord[n];
        this.tone(midi(note + 12), stepDur * 1.6, { type: s.wave, vol: s.wave === 'sawtooth' ? 0.045 : 0.06, delay: when, bus });
      }
      if (!s.calm) {
        if (pos % 4 === 0) this.tone(120, 0.12, { type: 'sine', slide: 40, vol: 0.35, delay: when, bus });
        if (pos % 4 === 2) this.noise(0.05, { freq: 8000, type: 'highpass', vol: 0.08, delay: when, bus });
        if (pos === 4 || pos === 12) this.noise(0.12, { freq: 1800, vol: 0.12, delay: when, bus });
      } else if (pos === 0) this.tone(midi(chord[2]), stepDur * 14, { type: 'sine', vol: 0.05, delay: when, bus });   // a soft held note
      this.nextTime += stepDur; this.step++;
    }
  }
}
