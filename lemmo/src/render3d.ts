// Cylinder world renderer in plain Canvas 2D (no WebGL needed). The terrain texture is wrapped
// around a cylinder by drawing one vertical strip per grid column, shaded for roundness; the far
// side is drawn first, dimmed, so you can see it through tunnels and gaps.
import { CELL_PX, TerrainPainter, type Theme } from './terrain.ts';

export const RADIUS = 256 / (2 * Math.PI); // one world unit per column at the surface

export interface Projected {
  x: number;
  y: number;
  scale: number;   // screen pixels per world unit at this point
  facing: number;  // cos of angle to the viewer; <= 0 means the far side
}

const TAU = Math.PI * 2;

export class CylinderView {
  rot = 0;
  camY = 0;
  dist = 150;
  target = { rot: 0, camY: 0, dist: 150 };
  private ctx: CanvasRenderingContext2D;
  private layer = document.createElement('canvas');
  private lctx: CanvasRenderingContext2D;
  private dark = document.createElement('canvas');
  private shadow = document.createElement('canvas');
  private dirty = true;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private stars: [number, number, number][] = [];
  private time = 0;
  private drawn = { rot: NaN, camY: NaN, dist: NaN, w: 0, h: 0 };
  private needsDraw = true;

  constructor(readonly canvas: HTMLCanvasElement, readonly painter: TerrainPainter, readonly rows: number, readonly theme: Theme) {
    this.ctx = canvas.getContext('2d')!;
    this.lctx = this.layer.getContext('2d')!;
    for (const c of [this.dark, this.shadow]) {
      c.width = painter.color.width;
      c.height = painter.color.height;
    }
    for (let i = 0; i < 160; i++) this.stars.push([Math.random(), Math.random(), Math.random()]);
  }

  markDirty() {
    this.dirty = true;
    this.needsDraw = true;
  }

  resize(w: number, h: number) {
    this.dpr = Math.min(2, window.devicePixelRatio);
    this.w = w;
    this.h = h;
    for (const c of [this.canvas, this.layer]) {
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
    }
  }

  /** Screen pixels per world unit at the front of the cylinder. */
  get ppu() {
    return (this.h / (this.rows * 1.18)) * (150 / this.dist);
  }

  lookAt(col: number, row: number, instant = false) {
    const want = -(col / 256) * TAU;
    const k = Math.round((this.target.rot - want) / TAU);
    this.target.rot = want + k * TAU;
    this.target.camY = row - this.rows / 2;
    if (instant) {
      this.rot = this.target.rot;
      this.camY = this.target.camY;
    }
  }

  frontColumn() {
    return ((((-this.rot / TAU) * 256) % 256) + 256) % 256;
  }

  project(col: number, row: number, _w?: number, _h?: number, lift = 0.25): Projected {
    const a = (col / 256) * TAU + this.rot;
    const ppu = this.ppu;
    return {
      x: this.w / 2 + (RADIUS + lift) * Math.sin(a) * ppu,
      y: this.h / 2 - (row - this.rows / 2 - this.camY) * ppu,
      scale: ppu,
      facing: Math.cos(a),
    };
  }

  /** Pre-tinted copies of the terrain (far side, thickness shadow); rebuilt only when terrain changes. */
  private refreshDark() {
    const tint = (dst: HTMLCanvasElement, color: string, alpha: number) => {
      const d = dst.getContext('2d')!;
      d.globalCompositeOperation = 'source-over';
      d.clearRect(0, 0, dst.width, dst.height);
      d.drawImage(this.painter.color, 0, 0);
      d.globalCompositeOperation = 'source-atop';
      d.globalAlpha = alpha;
      d.fillStyle = color;
      d.fillRect(0, 0, dst.width, dst.height);
      d.globalAlpha = 1;
      d.globalCompositeOperation = 'source-over';
    };
    tint(this.dark, '#0b1022', 0.74);
    tint(this.shadow, '#05070f', 0.75);
  }

  /** Draw the column strips of one side of the cylinder into ctx. */
  private strips(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, front: boolean, r: number, dy = 0) {
    const ppu = this.ppu * this.dpr;
    const cx = (this.w / 2) * this.dpr;
    const top = (this.h / 2 - (this.rows / 2 - this.camY) * this.ppu) * this.dpr + dy * this.dpr;
    const H = this.rows * ppu;
    const S = CELL_PX;
    for (let c = 0; c < 256; c++) {
      const a0 = (c / 256) * TAU + this.rot, a1 = ((c + 1) / 256) * TAU + this.rot;
      const mid = Math.cos((a0 + a1) / 2);
      if (front ? mid <= -0.02 : mid >= 0.02) continue;
      const x0 = cx + r * Math.sin(a0) * ppu, x1 = cx + r * Math.sin(a1) * ppu;
      const left = Math.min(x0, x1), width = Math.abs(x1 - x0) + 0.6;
      ctx.drawImage(src, c * S, 0, S, src.height, left, top, width, H);
    }
  }

  update(dt: number) {
    this.time += dt;
    const k = 1 - Math.exp(-dt * 12);
    this.rot += (this.target.rot - this.rot) * k;
    this.camY += (this.target.camY - this.camY) * k;
    this.dist += (this.target.dist - this.dist) * k;
    if (this.dirty) {
      this.refreshDark();
      this.dirty = false;
    }
    const D = this.drawn;
    const moved = Math.abs(D.rot - this.rot) > 1e-4 || Math.abs(D.camY - this.camY) > 1e-3 ||
      Math.abs(D.dist - this.dist) > 1e-3 || D.w !== this.w || D.h !== this.h;
    if (!moved && !this.needsDraw) return;
    // snap the last bit of easing so the view settles and stops redrawing
    if (Math.abs(this.target.rot - this.rot) < 2e-4) this.rot = this.target.rot;
    if (Math.abs(this.target.camY - this.camY) < 2e-3) this.camY = this.target.camY;
    if (Math.abs(this.target.dist - this.dist) < 2e-3) this.dist = this.target.dist;
    Object.assign(D, { rot: this.rot, camY: this.camY, dist: this.dist, w: this.w, h: this.h });
    this.needsDraw = false;
    const ctx = this.ctx, d = this.dpr;
    const W = this.canvas.width, Hh = this.canvas.height;
    ctx.clearRect(0, 0, W, Hh);
    ctx.imageSmoothingEnabled = true;

    // stars drifting with the rotation
    for (const [sx, sy, sz] of this.stars) {
      const x = ((sx * W + (this.rot * 40 * (0.3 + sz)) * d) % W + W) % W;
      ctx.fillStyle = `rgba(200,215,255,${0.15 + sz * 0.45})`;
      ctx.fillRect(x, sy * Hh, 1 + sz * d, 1 + sz * d);
    }

    const ppu = this.ppu * d;
    const cx = W / 2;
    const top = (this.h / 2 - (this.rows / 2 - this.camY) * this.ppu) * d;
    const H = this.rows * ppu;

    // glowing core behind everything
    const coreW = RADIUS * 0.22 * ppu;
    const g = ctx.createLinearGradient(cx - coreW, 0, cx + coreW, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, this.theme.lip + '55');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - coreW, top - 30 * d, coreW * 2, H + 60 * d);

    // far side (seen from inside), dimmed
    this.strips(ctx, this.dark, false, RADIUS - 1);

    // near side: thickness shadow + face, shaded on a separate layer
    const l = this.lctx;
    l.clearRect(0, 0, W, Hh);
    l.globalCompositeOperation = 'source-over';
    this.strips(l, this.shadow, true, RADIUS - 0.2, 0.7);
    this.strips(l, this.painter.color, true, RADIUS);
    l.globalCompositeOperation = 'lighter';
    l.globalAlpha = 0.55;
    this.strips(l, this.painter.glow, true, RADIUS);
    l.globalAlpha = 1;
    // roundness: darken toward the silhouette, soft highlight left of centre
    l.globalCompositeOperation = 'source-atop';
    const span = RADIUS * ppu;
    const sh = l.createLinearGradient(cx - span, 0, cx + span, 0);
    sh.addColorStop(0, 'rgba(4,6,16,0.85)');
    sh.addColorStop(0.18, 'rgba(4,6,16,0.35)');
    sh.addColorStop(0.38, 'rgba(255,255,255,0.10)');
    sh.addColorStop(0.5, 'rgba(255,255,255,0.0)');
    sh.addColorStop(0.8, 'rgba(4,6,16,0.35)');
    sh.addColorStop(1, 'rgba(4,6,16,0.9)');
    l.fillStyle = sh;
    l.fillRect(0, 0, W, Hh);
    l.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.layer, 0, 0);

    // metallic rims at the top and bottom of the drum
    for (const y of [top, top + H]) {
      const rg = ctx.createLinearGradient(cx - span, 0, cx + span, 0);
      rg.addColorStop(0, 'rgba(120,136,184,0)');
      rg.addColorStop(0.5, 'rgba(170,186,236,0.9)');
      rg.addColorStop(1, 'rgba(120,136,184,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(cx - span - 6 * d, y - 2 * d, span * 2 + 12 * d, 4 * d);
    }
  }

  dispose() {}
}
