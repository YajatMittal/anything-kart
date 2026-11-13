// Turns keyboards, gamepads and camera-tracked hands into the same
// per-frame kart input: { steer -1..1, accel 0..1, brake 0..1, drift, item }.

const KEY_SCHEMES = {
  wasd: { left: ['KeyA'], right: ['KeyD'], accel: ['KeyW'], brake: ['KeyS'], drift: ['Space', 'ShiftLeft'], item: ['KeyE', 'KeyQ'] },
  arrows: { left: ['ArrowLeft'], right: ['ArrowRight'], accel: ['ArrowUp'], brake: ['ArrowDown'], drift: ['ShiftRight', 'Slash'], item: ['Enter', 'Period'] },
};
const CAMERA_ITEM_KEYS = [['KeyX'], ['KeyN']];   // backup item keys for camera players P1, P2 (M is mute)

export const INPUT_LABELS = {
  camera: 'Camera',
  wasd: 'Keyboard (WASD)',
  arrows: 'Keyboard (Arrows)',
};

export const INPUT_HELP = {
  camera: 'Hold anything like a wheel and turn it. Flick it to use your item.',
  wasd: 'W/S drive, A/D steer, Space drift, E item',
  arrows: 'Up/Down drive, Left/Right steer, Right Shift drift, Enter item',
  pad: 'Stick steer, A go, B brake, RB drift, LB or X item',
};

export class Input {
  constructor() {
    this.keys = new Set(); this.tapped = new Set();
    this.prevPadButtons = new Map();
    this.padTapped = new Map();
    window.addEventListener('keydown', (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (!e.repeat) this.tapped.add(e.code);
      this.keys.add(e.code);
      if (this.captureKeys && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.captureKeys = false;
  }

  down(codes) { return codes.some((c) => this.keys.has(c)); }
  tap(codes) { return codes.some((c) => this.tapped.has(c)); }

  pads() {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    return Array.from(list || []).filter(Boolean);
  }

  pad(index) { return this.pads().find((p) => p.index === index) || null; }

  // Call once per frame before controllers read.
  poll() {
    this.padTapped.clear();
    for (const p of this.pads()) {
      const prev = this.prevPadButtons.get(p.index) || [];
      const now = p.buttons.map((b) => b.pressed);
      const taps = new Set();
      now.forEach((v, i) => { if (v && !prev[i]) taps.add(i); });
      this.padTapped.set(p.index, taps);
      this.prevPadButtons.set(p.index, now);
    }
  }

  padTap(index, buttons) { const t = this.padTapped.get(index); return !!t && buttons.some((b) => t.has(b)); }
  anyPadTap(buttons) { for (const [i] of this.padTapped) if (this.padTap(i, buttons)) return true; return false; }

  endFrame() { this.tapped.clear(); }

  controller(spec, vision) {
    if (spec.type === 'camera') return new CameraController(this, vision, spec.zone ?? 0);
    if (spec.type === 'pad') return new PadController(this, spec.index ?? 0);
    return new KeyboardController(this, spec.type === 'arrows' ? 'arrows' : 'wasd');
  }
}

class KeyboardController {
  constructor(input, scheme) { this.in = input; this.k = KEY_SCHEMES[scheme]; this.steer = 0; this.kind = 'keyboard'; }
  read(dt) {
    const k = this.k, i = this.in;
    const target = (i.down(k.right) ? 1 : 0) - (i.down(k.left) ? 1 : 0);
    const rate = target === 0 ? 10 : Math.sign(target) !== Math.sign(this.steer) ? 14 : 6;
    this.steer += (target - this.steer) * Math.min(1, dt * rate);
    return {
      steer: this.steer, accel: i.down(k.accel) ? 1 : 0, brake: i.down(k.brake) ? 1 : 0,
      drift: i.down(k.drift), item: i.tap(k.item),
    };
  }
  rumble() {}
}

class PadController {
  constructor(input, index) { this.in = input; this.index = index; this.kind = 'pad'; }
  read() {
    const p = this.in.pad(this.index);
    if (!p) return { steer: 0, accel: 0, brake: 0, drift: false, item: false };
    const b = (n) => (p.buttons[n] ? p.buttons[n].value || (p.buttons[n].pressed ? 1 : 0) : 0);
    let sx = p.axes[0] || 0;
    if (Math.abs(sx) < 0.15) sx = 0; else sx = Math.sign(sx) * (Math.abs(sx) - 0.15) / 0.85;
    if (b(14)) sx = -1; if (b(15)) sx = 1;
    return {
      steer: sx,
      accel: Math.max(b(0), b(7)),
      brake: Math.max(b(1), b(6)),
      drift: b(5) > 0.5,
      item: this.in.padTap(this.index, [4, 2, 3]),
    };
  }
  rumble(ms = 250, strength = 0.8) {
    const p = this.in.pad(this.index);
    try { p?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 }); } catch { /* no rumble support */ }
  }
}

// Reads a player's SteeringEngine. The race only ever sees steer / accel / brake / item,
// and never touches the camera code.
export class CameraController {
  constructor(input, vision, zone) { this.in = input; this.vision = vision; this.zone = zone; this.kind = 'camera'; this.autoDrift = CameraController.autoDrift; }
  get engine() { return this.vision.engines[this.zone]; }
  get tracker() { return this.engine; }
  read() {
    const e = this.engine;
    const keyItem = this.in.tap(CAMERA_ITEM_KEYS[this.zone] || []);
    if (!e) return { steer: 0, accel: 0.35, brake: 0, drift: false, item: keyItem, lost: true, neutral: true };
    const o = e.output;
    const live = o.trackingState === 'tracking' || o.trackingState === 'degraded';
    // No reliable signal: straight ahead and off the throttle (never a stale value, never the AI)
    if (!live) return { steer: o.steering, accel: 0.35, brake: 0, drift: false, item: keyItem, lost: true, neutral: true };
    return { steer: o.steering, accel: o.brake ? 0 : 1, brake: o.brake ? 1 : 0, drift: false, item: e.consumeItem() || keyItem };
  }
  rumble() {}
}
// Auto drift for camera players (a setting; off by default: holding a hard turn slid too often)
CameraController.autoDrift = false;
