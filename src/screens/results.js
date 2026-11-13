// The results screen: podium, stats, the table, time-trial records and confetti.
import { PLAYER_COLORS, fmtTime, ordinal } from '../race/race.js';
import { $, app, sound, input, vision, camCount, portrait, keepAwake } from '../app.js';
import { launchRace, buildCfg, quitToLobby, hideLost } from '../flow.js';
import { enterCalib, camsReady } from './lockon.js';

// Called by the race when it ends (r is that race, so a late call from an old race is ignored).
export function onEnd(rows, r) {
  if (r !== app.race) return;
  app.state = 'results';
  for (const e of vision.engines) e.stop();
  hideLost();
  keepAwake(false);
  sound.stopMusic(); sound.stopEngines();
  setTimeout(() => { if (app.state === 'results') sound.menuMusic(); }, 3000);
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
    if (t > end || app.state !== 'results') return;
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
  else launchRace(app.lastCfg || buildCfg());
};
$('#btn-results-lobby').onclick = () => quitToLobby();
