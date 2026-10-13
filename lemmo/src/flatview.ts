// Panorama view: the whole cylinder unrolled and scaled to fit the screen. Nothing to scroll —
// every one of the 256 columns is visible at once; the world still wraps at the left/right edges.
import { CELL_PX, TerrainPainter, type Theme } from './terrain.ts';
import type { Projected } from './render3d.ts';

export class FlatView {
  // Camera fields kept for interface parity with CylinderView (unused here).
  rot = 0;
  camY = 0;
  dist = 150;
  target = { rot: 0, camY: 0, dist: 150 };
  /** Space reserved by the HUD above and the dock below (CSS px). */
  insets = { top: 70, bottom: 110 };
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private needsDraw = true;
  private stars: [number, number, number][] = [];

  constructor(readonly canvas: HTMLCanvasElement, readonly painter: TerrainPainter, readonly rows: number,
    readonly theme: Theme, readonly seam: number) {
    this.ctx = canvas.getContext('2d')!;
    for (let i = 0; i < 140; i++) this.stars.push([Math.random(), Math.random(), Math.random()]);
  }

  markDirty() {
    this.needsDraw = true;
  }

  resize(w: number, h: number) {
    this.dpr = Math.min(2, window.devicePixelRatio);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.needsDraw = true;
  }

  /** Layout of the panorama in CSS px. */
  get frame() {
    const pad = 16;
    const availW = this.w - pad * 2;
    const availH = this.h - this.insets.top - this.insets.bottom - pad * 2;
    const ppu = Math.max(1, Math.min(availW / 256, availH / this.rows));
    const width = 256 * ppu, height = this.rows * ppu;
    const left = (this.w - width) / 2;
    const top = this.insets.top + pad + (availH - height) / 2;
    return { ppu, left, top, width, height };
  }

  get ppu() {
    return this.frame.ppu;
  }

  lookAt() {}

  frontColumn() {
    return (this.seam + 128) % 256;
  }

  project(col: number, row: number): Projected {
    const f = this.frame;
    const rel = (((col - this.seam) % 256) + 256) % 256;
    return { x: f.left + rel * f.ppu, y: f.top + (this.rows - row) * f.ppu, scale: f.ppu, facing: 1 };
  }

  update() {
    if (!this.needsDraw) return;
    this.needsDraw = false;
    const c = this.ctx, d = this.dpr;
    const W = this.canvas.width, H = this.canvas.height;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    for (const [sx, sy, sz] of this.stars) {
      c.fillStyle = `rgba(200,215,255,${0.12 + sz * 0.4})`;
      c.fillRect(sx * W, sy * H, 1 + sz * d, 1 + sz * d);
    }
    c.setTransform(d, 0, 0, d, 0, 0);
    const f = this.frame;
    // panel behind the world
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.6)';
    c.shadowBlur = 40;
    c.fillStyle = this.theme.sky[0];
    c.beginPath();
    c.roundRect(f.left - 6, f.top - 6, f.width + 12, f.height + 12, 14);
    c.fill();
    c.restore();
    const g = c.createLinearGradient(0, f.top, 0, f.top + f.height);
    g.addColorStop(0, this.theme.sky[1]);
    g.addColorStop(1, this.theme.sky[0]);
    c.fillStyle = g;
    c.fillRect(f.left, f.top, f.width, f.height);

    // terrain, split at the seam so column `seam` sits at the left edge
    const S = CELL_PX;
    const src = this.painter;
    const leftCols = 256 - this.seam;
    const draw = (img: HTMLCanvasElement) => {
      c.drawImage(img, this.seam * S, 0, leftCols * S, img.height, f.left, f.top, leftCols * f.ppu, f.height);
      if (this.seam > 0) c.drawImage(img, 0, 0, this.seam * S, img.height, f.left + leftCols * f.ppu, f.top, this.seam * f.ppu, f.height);
    };
    c.imageSmoothingEnabled = true;
    draw(src.color);
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.5;
    draw(src.glow);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';

    // a hint of curvature: the edges are the "back" of the drum, where the world wraps
    const shade = c.createLinearGradient(f.left, 0, f.left + f.width, 0);
    shade.addColorStop(0, 'rgba(4,6,16,0.45)');
    shade.addColorStop(0.08, 'rgba(4,6,16,0)');
    shade.addColorStop(0.92, 'rgba(4,6,16,0)');
    shade.addColorStop(1, 'rgba(4,6,16,0.45)');
    c.fillStyle = shade;
    c.fillRect(f.left, f.top, f.width, f.height);
    c.strokeStyle = 'rgba(160,175,255,0.22)';
    c.lineWidth = 1;
    c.strokeRect(f.left - 0.5, f.top - 0.5, f.width + 1, f.height + 1);
    // wrap markers
    c.fillStyle = 'rgba(160,175,255,0.45)';
    for (const [x, dir] of [[f.left - 10, -1], [f.left + f.width + 10, 1]] as const) {
      const y = f.top + f.height / 2;
      c.beginPath();
      c.moveTo(x + dir * 4, y);
      c.lineTo(x - dir * 3, y - 6);
      c.lineTo(x - dir * 3, y + 6);
      c.closePath();
      c.fill();
    }
  }

  dispose() {}
}
