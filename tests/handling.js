// Handling check: how much a camera-steered kart slides, with and without boosts. Open the game,
// then in the console:  await (await import('/tests/handling.js')).run()
// The kart is steered like a camera player (smooth, rate-limited steering toward the racing line,
// with auto-drift), on every track, with a boost every few seconds. Not part of the game.
export async function run({ seconds = 40, boostEvery = 3, eager = false, autoDrift = true } = {}) {
  const ak = window.__ak;
  const wasMuted = ak.sound.muted;
  ak.sound.setMuted(true);
  const { Race } = await import('/src/race/race.js?' + Date.now());
  const out = {};
  for (const trackId of ['coast', 'snow', 'canyon']) {
    for (const boosts of [false, true]) {
      const r = new Race({ trackId, mode: 'race', laps: 9, cpuCount: 0, difficulty: 'normal', players: [{ charId: 'ava', input: 'wasd' }] },
        { sound: ak.sound, input: ak.input, vision: ak.vision, renderer: ak.renderer, quality: 'low' });
      const k = r.karts.find((q) => q.human);
      k.autoDrift = autoDrift; k.assist = true;                 // like a camera player
      let steer = 0;
      k.controller = { read: (dt) => {
        // steer toward the racing line like a person holding an object: smooth and a bit late
        // eager: steers harder and later, like someone new to it (turns the object a lot)
        const want = Math.max(-1, Math.min(1, r.ai(k, dt).steer * (eager ? 1.7 : 1)));
        steer += Math.max(-(eager ? 6 : 4) * dt, Math.min((eager ? 6 : 4) * dt, want - steer));
        return { steer, accel: 1, brake: 0, drift: false, item: false };
      } };
      const dt = 1 / 60;
      let n = 0, slipSum = 0, slipMax = 0, wideSum = 0, wideMax = 0, off = 0, drifts = 0, wasDrifting = false, boostT = 0;
      for (let i = 0; i < seconds * 60; i++) {
        if (boosts && r.canDrive) { boostT += dt; if (boostT > boostEvery) { boostT = 0; k.boostT = Math.max(k.boostT, 1.15); } }
        r.update(dt);
        if (!r.canDrive) continue;
        const sp = Math.hypot(k.vx, k.vz);
        if (sp < 8) continue;
        const slip = Math.abs(Math.atan2(Math.sin(Math.atan2(k.vx, k.vz) - k.h), Math.cos(Math.atan2(k.vx, k.vz) - k.h))) * 180 / Math.PI;
        const wide = Math.max(0, Math.abs(k.lat) - r.track.halfW * 0.6);     // how far toward the edge
        n++; slipSum += slip; slipMax = Math.max(slipMax, slip); wideSum += wide; wideMax = Math.max(wideMax, wide);
        if (k.offroad) off++;
        if (k.drifting && !wasDrifting) drifts++; wasDrifting = k.drifting;
      }
      out[`${trackId}${boosts ? ' + boosts' : ''}`] = `slide avg ${(slipSum / n).toFixed(1)}° max ${slipMax.toFixed(0)}° · near edge avg ${(wideSum / n).toFixed(2)} max ${wideMax.toFixed(1)} · offroad ${(off / n * 100).toFixed(1)}% · auto-drifts ${drifts} · laps ${k.lap ?? '?'}`;
      r.dispose();
    }
  }
  ak.sound.setMuted(wasMuted);   // don't leave the game muted
  return out;
}
