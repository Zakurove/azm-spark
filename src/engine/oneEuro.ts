/** One-Euro filter (Casiez et al., CHI 2012) — low-latency jitter smoothing. */

class LowPass {
  private y: number | null = null;
  filter(x: number, alpha: number): number {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
  last(): number | null {
    return this.y;
  }
}

export class OneEuro {
  private xFilt = new LowPass();
  private dxFilt = new LowPass();
  private lastT: number | null = null;

  constructor(
    private minCutoff = 1.7,
    private beta = 0.3,
    private dCutoff = 1.0,
  ) {}

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, tMs: number): number {
    if (this.lastT === null) {
      this.lastT = tMs;
      this.dxFilt.filter(0, 1);
      return this.xFilt.filter(x, 1);
    }
    const dt = Math.max((tMs - this.lastT) / 1000, 1e-3);
    this.lastT = tMs;
    const prev = this.xFilt.last();
    const dx = prev === null ? 0 : (x - prev) / dt;
    const edx = this.dxFilt.filter(dx, this.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xFilt.filter(x, this.alpha(cutoff, dt));
  }
}

/** Bank of filters for 33 landmarks × (x,y) — z left raw (unused for 2D metrics). */
export class PoseSmoother {
  private fx: OneEuro[] = [];
  private fy: OneEuro[] = [];
  constructor(n = 33) {
    for (let i = 0; i < n; i++) {
      this.fx.push(new OneEuro());
      this.fy.push(new OneEuro());
    }
  }
  smooth(lm: { x: number; y: number; z: number; visibility: number }[], t: number) {
    return lm.map((p, i) => ({
      x: this.fx[i].filter(p.x, t),
      y: this.fy[i].filter(p.y, t),
      z: p.z,
      visibility: p.visibility,
    }));
  }
}
