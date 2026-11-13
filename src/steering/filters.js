// Smoothing used by the steering engine.

// One-euro filter: an exponential moving average whose strength adapts to speed. Held still it
// smooths jitter hard; turned quickly it barely smooths, so fast turns aren't delayed.
//   S(t) = alpha * X(t) + (1 - alpha) * S(t-1), with alpha from a cutoff that rises with |dX/dt|
export class OneEuro {
  constructor(minCutoff = 1.5, beta = 0.08, dCutoff = 1) { this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff; this.reset(); }
  reset(x = null) { this.x = x; this.dx = 0; }
  alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(x, dt) {
    if (this.x === null) { this.x = x; this.dx = 0; return x; }
    const dx = (x - this.x) / dt;
    this.dx += this.alpha(this.dCutoff, dt) * (dx - this.dx);
    this.x += this.alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt) * (x - this.x);
    return this.x;
  }
}

// Plain exponential moving average with a time constant (frame-rate independent).
export const ema = (prev, x, dt, tau) => prev + (x - prev) * (1 - Math.exp(-dt / tau));

// Limit how far a value may move in one step.
export const slew = (prev, target, maxStep) => prev + Math.max(-maxStep, Math.min(maxStep, target - prev));
