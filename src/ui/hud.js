import { ITEMS, ROULETTE, PLAYER_COLORS, fmtTime, ordinal } from '../race/race.js';
import { ICON } from './icons.js';
import { drawTracking, sharpCanvas } from '../steering/overlay.js';

const el = (cls, html = '', tag = 'div') => { const e = document.createElement(tag); e.className = cls; e.innerHTML = html; return e; };


export class Hud {
  constructor(race, deps) {
    this.race = race; this.deps = deps;
    this.root = document.getElementById('hud');
    this.root.innerHTML = '';
    this.root.classList.add('on');
    this.views = race.views.map((v) => this.makeView(v));
    this.count = el('hud-count'); this.root.appendChild(this.count);
    this.banner = el('hud-banner'); this.root.appendChild(this.banner);
    this.globalMsg = el('hud-global'); this.root.appendChild(this.globalMsg);
    this.map = el('hud-map', '', 'canvas'); this.map.width = 200; this.map.height = 200; this.root.appendChild(this.map);
    this.hasCam = race.hasCam;
    this.pip = el('hud-pip', '', 'canvas'); this.pip.width = 240; this.pip.height = 180;
    if (this.hasCam) this.root.appendChild(this.pip);
    const pause = el('hud-pause', '<i></i><i></i>', 'button');
    pause.setAttribute('aria-label', 'Pause');
    pause.onclick = () => deps.onPause?.();
    this.root.appendChild(pause);
    this.mapT = 0;
    this.prepMap();
    try { this.best = JSON.parse(localStorage.getItem('ak-best') || '{}'); } catch { this.best = {}; }
  }

  makeView(v) {
    const k = v.kart, multi = this.race.views.length > 1, cam = k.controller?.kind === 'camera';
    const box = el('vh');
    const parts = {
      item: el('vh-item', '<div class="slot"><span class="em"></span><span class="cnt"></span></div><div class="item-name"></div>'),
      lap: el('vh-lap'), time: el('vh-time'), place: el('vh-place'), acorns: el('vh-acorns'),
      msg: el('vh-msg'), wrong: el('vh-wrong', 'WRONG WAY'), danger: el('vh-danger', 'LAST PLACE: PASS SOMEONE!'),
      speed: el('vh-speed', '<i></i>'), gates: el('vh-gates'),
      done: el('vh-done', '<b></b><span>FINISHED</span><small class="t"></small><small class="w">Waiting for the others…</small>'),
    };
    const top = el('vh-topright'); top.append(parts.lap, parts.time, parts.gates);
    box.append(parts.item, top, parts.place, parts.acorns, parts.speed, parts.msg, parts.wrong, parts.danger, parts.done);
    if (multi) {
      const tag = el('vh-tag', `<span>P${k.player + 1}</span>${k.ch.portrait ? `<img alt="" src="${k.ch.portrait}">` : ''}${k.name}`);
      tag.style.background = PLAYER_COLORS[k.player]; box.appendChild(tag);
    }
    if (cam) {
      parts.cam = el('vh-cam', `<div class="wheel">${ICON.wheel}</div><div class="hmeter" title="Height of your hands"><i class="z-up"></i><i class="z-down"></i><b></b></div><div class="cam-info"><b class="cam-state"></b><span class="g g-item">FLICK: ITEM</span><span class="g g-brake">LOWER: BRAKE</span></div>`);
      parts.hdot = parts.cam.querySelector('.hmeter b'); parts.zUp = parts.cam.querySelector('.z-up'); parts.zDown = parts.cam.querySelector('.z-down');
      parts.wheel = parts.cam.querySelector('.wheel'); parts.camState = parts.cam.querySelector('.cam-state');
      parts.gItem = parts.cam.querySelector('.g-item'); parts.gBrake = parts.cam.querySelector('.g-brake');
      box.appendChild(parts.cam);
    }
    this.root.appendChild(box);
    return { v, box, ...parts, cache: {} };
  }

  layout() {
    const n = this.race.views.length;
    this.views.forEach((h) => {
      const r = h.v.rect;
      Object.assign(h.box.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
      h.box.classList.toggle('small', n > 2);
      if (n > 1) h.box.dataset.side = r.x + r.w / 2 < window.innerWidth / 2 ? 'left' : 'right';
    });
    this.root.dataset.views = n;
  }

  set(h, key, val, fn) { if (h.cache[key] !== val) { h.cache[key] = val; fn(val); } }

  update(dt) {
    const race = this.race;
    for (const h of this.views) {
      const k = h.v.kart;
      let icon = '', cnt = '', name = '';
      if (k.rouletteT > 0) {
        const r = Math.floor(race.clock * 14) % ROULETTE.length;
        icon = ROULETTE[r];
        if (r !== h.lastR) { h.lastR = r; race.sound.play('tick'); }
      } else if (k.item) { icon = ITEMS[k.item].icon; cnt = k.itemCount > 1 ? '×' + k.itemCount : ''; name = ITEMS[k.item].name; }
      this.set(h, 'item', icon + cnt, () => {
        h.item.querySelector('.em').innerHTML = icon ? ICON[icon] : '';
        h.item.querySelector('.cnt').textContent = cnt;
        h.item.querySelector('.item-name').textContent = name;
        h.item.classList.toggle('full', !!icon);
      });
      let lap;
      if (race.mode === 'acorns') lap = '';
      else if (race.mode === 'knockout') lap = `ALIVE <b>${race.alive.length}</b>`;
      else lap = `LAP <b>${Math.min(race.laps, Math.max(1, k.lap))}</b>/${race.laps}`;
      this.set(h, 'lap', lap, (v) => { h.lap.innerHTML = v; });
      const t = k.finished ? k.finishTime : race.time;
      this.set(h, 'time', fmtTime(t), (v) => { h.time.textContent = v; });
      this.set(h, 'gates', k.gateTries ? `GATES ${k.gates}/${k.gateTries}` : '', (v) => { h.gates.textContent = v; });
      const pl = k.eliminated ? 'OUT' : k.place;
      this.set(h, 'place', pl, (v) => {
        h.place.innerHTML = v === 'OUT' ? 'OUT' : `${v}<sup>${ordinal(v).slice(-2)}</sup>`;
        h.place.dataset.p = v === 'OUT' ? 'out' : Math.min(v, 4);
      });
      this.set(h, 'acorns', k.acorns, (v) => { h.acorns.innerHTML = `${ICON.acorn}<b>${v}</b>`; h.acorns.classList.toggle('big', race.mode === 'acorns'); });
      h.speed.firstChild.style.width = Math.min(100, Math.abs(k.speed) / 48 * 100) + '%';
      h.speed.classList.toggle('boost', k.boostT > 0);
      h.wrong.classList.toggle('show', k.wrongT > 1);
      const danger = race.mode === 'knockout' && !k.eliminated && race.alive.length > 1 && k.place === race.alive.length && race.koTimeLeft < 6;
      h.danger.classList.toggle('show', danger);
      h.box.classList.toggle('spectating', k.eliminated);
      // Finished while friends are still racing: a card with your place stays up until the end.
      const done = k.finished && race.humans.length > 1 && !race.humans.every((o) => o.finished);
      this.set(h, 'done', done ? k.place : 0, (p) => {
        h.box.classList.toggle('finished', !!p);
        if (!p) return;
        h.done.querySelector('b').innerHTML = p === 1 ? 'YOU WIN!' : `${p}<sup>${ordinal(p).slice(-2)}</sup>`;
        h.done.dataset.p = Math.min(p, 4);
        h.done.querySelector('.t').textContent = fmtTime(k.finishTime);
      });
      if (h.cam) {
        const e = k.controller.engine, o = e?.output, live = !!e?.usable;
        h.wheel.style.transform = `rotate(${(k.input?.steer || 0) * 90}deg)`;
        const st = !live ? 'lost' : o.trackingState;
        this.set(h, 'camstate', st, (v) => {
          h.camState.textContent = v === 'lost' ? 'Show both hands' : 'Steering: your hands';
          h.cam.dataset.state = v === 'lost' ? 'lost' : v === 'degraded' ? 'degraded' : 'ok';
        });
        // height meter (shown only when lowering brakes): the raise (green) and brake (red) zones
        const cal = e?.grip, span = Math.max(0.3, Math.abs(cal?.lowOn || 0.9), Math.abs(cal?.raiseOn || 0.8)) * 1.6;
        this.set(h, 'zones', `${cal?.raiseOn}|${cal?.lowOn}`, () => {
          h.zUp.style.height = `${Math.max(4, 50 - (Math.abs(cal?.raiseOn || 0.8) / span) * 50)}%`;
          h.zDown.style.height = `${Math.max(4, 50 - (Math.abs(cal?.lowOn || 0.9) / span) * 50)}%`;
        });
        h.hdot.style.top = `${Math.max(0, Math.min(100, 50 + ((live ? e.vert : 0) / span) * 50))}%`;
        this.set(h, 'zone', live ? e.zoneNow : 'neutral', (z) => { h.cam.dataset.zone = z; });
        h.gItem.classList.toggle('on', !!o?.item);
        h.gBrake.classList.toggle('on', !!o?.brake);
        const brakeOn = !!e?.tuning?.brake;
        h.gBrake.hidden = !brakeOn; h.zDown.hidden = !brakeOn;
        const meter = h.hdot.parentElement; if (meter.hidden === brakeOn) meter.hidden = !brakeOn;   // height only matters when lowering brakes
      }
    }
    let banner = '';
    const left = race.finishLeft;
    if (left !== null && !race.humans.every((k) => k.finished)) banner = `RACE ENDS IN ${Math.ceil(left)}s`;
    else if (race.mode === 'acorns') banner = `ACORN RUSH: ${Math.ceil(race.rushTimeLeft)}s`;
    else if (race.mode === 'knockout' && race.phase === 'race') banner = `NEXT KNOCKOUT IN ${Math.ceil(race.koTimeLeft)}s`;
    else if (race.mode === 'timetrial') { const b = this.best[race.track.def.id]; banner = `BEST ${b ? fmtTime(b.total) : '--:--.--'}`; }
    if (banner !== this.lastBanner) { this.lastBanner = banner; this.banner.textContent = banner; this.banner.classList.toggle('show', !!banner); }
    this.banner.classList.toggle('urgent', (left !== null && left < 10) || (race.mode === 'knockout' && race.koTimeLeft < 6 && race.phase === 'race'));

    this.mapT += dt;
    if (this.mapT > 1 / 30) { this.mapT = 0; this.drawMap(); if (this.hasCam) this.drawPip(); }
  }

  prepMap() {
    const tr = this.race.track, b = tr.bounds, W = this.map.width, pad = 16;
    const s = (W - pad * 2) / Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    // flip x so the map matches the driver's left/right
    this.mapXf = (x, z) => [W / 2 - (x - b.cx) * s, W / 2 - (z - b.cz) * s];
    const c = document.createElement('canvas'); c.width = W; c.height = W;
    const g = c.getContext('2d');
    g.lineJoin = 'round'; g.lineCap = 'round';
    const path = () => { g.beginPath(); for (let i = 0; i <= tr.N; i += 2) { const [x, y] = this.mapXf(tr.x[i % tr.N], tr.z[i % tr.N]); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); };
    path(); g.strokeStyle = 'rgba(20,30,28,0.65)'; g.lineWidth = 12; g.stroke();
    path(); g.strokeStyle = '#fff8e8'; g.lineWidth = 6.5; g.stroke();
    const [sx, sy] = this.mapXf(tr.x[0], tr.z[0]);
    g.fillStyle = '#15151a'; g.fillRect(sx - 5, sy - 5, 10, 10); g.fillStyle = '#fff'; g.fillRect(sx - 5, sy - 5, 5, 5); g.fillRect(sx, sy, 5, 5);
    this.mapBase = c;
  }

  drawMap() {
    const g = this.map.getContext('2d'), W = this.map.width;
    g.clearRect(0, 0, W, W); g.drawImage(this.mapBase, 0, 0);
    const ks = this.race.karts.filter((k) => !k.eliminated).sort((a, b) => (a.human - b.human) || b.place - a.place);
    for (const k of ks) {
      const [x, y] = this.mapXf(k.x, k.z);
      g.beginPath(); g.arc(x, y, k.human ? 7 : 4.5, 0, Math.PI * 2);
      g.fillStyle = k.color; g.fill();
      g.lineWidth = k.human ? 3 : 1.5; g.strokeStyle = k.human ? (this.race.humans.length > 1 ? PLAYER_COLORS[k.player] : '#fff') : 'rgba(0,0,0,0.7)'; g.stroke();
    }
  }

  drawPip() {
    const v = this.deps.vision; if (!v?.running) return;
    // the small camera view: what the tracking sees (outline, hands, a few points) and its status
    // the large view (C) also outlines the hands, so you can see what the tracker sees
    drawTracking(sharpCanvas(this.pip, 240, 180, v.video), v, v.engines, 240, 180, { level: 'pip', debug: !!this.deps.debug?.(), colors: this.deps.camColors?.(), outline: this.root.classList.contains('pip-lg') });
  }

  flash(k, text, cls = '') {
    const h = this.views.find((x) => x.v.kart === k); if (!h) return;
    h.msg.textContent = text; h.msg.className = 'vh-msg';
    void h.msg.offsetWidth;
    h.msg.className = 'vh-msg show ' + cls;
    clearTimeout(h.msgT); h.msgT = setTimeout(() => h.msg.classList.remove('show'), 1400);
  }

  countdown(c) {
    this.count.textContent = c; this.count.className = 'hud-count';
    void this.count.offsetWidth;
    this.count.className = 'hud-count show' + (c === 'GO!' ? ' go' : '');
    clearTimeout(this.countT); this.countT = setTimeout(() => this.count.classList.remove('show'), c === 'GO!' ? 900 : 950);
  }

  global(text) {
    this.globalMsg.textContent = text; this.globalMsg.className = 'hud-global';
    void this.globalMsg.offsetWidth;
    this.globalMsg.className = 'hud-global show';
    clearTimeout(this.globalT); this.globalT = setTimeout(() => this.globalMsg.classList.remove('show'), 2200);
  }

  destroy() { this.root.innerHTML = ''; this.root.classList.remove('on'); }
}
