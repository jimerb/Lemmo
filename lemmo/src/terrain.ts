// Procedural "modern" terrain painting: the collision grid becomes a crisp, bevelled texture.
import { F } from './sim.ts';

export const CELL_PX = 8;

export interface Theme {
  name: string;
  earthTop: [number, number, number];
  earthBottom: [number, number, number];
  lip: string;
  metal: [number, number, number];
  sky: [string, string];
}

export const THEMES: Theme[] = [
  { name: 'meadow', earthTop: [176, 120, 72], earthBottom: [104, 64, 44], lip: '#7ee08a', metal: [92, 108, 128], sky: ['#0b1324', '#1b2b4a'] },
  { name: 'dune', earthTop: [214, 168, 98], earthBottom: [150, 96, 60], lip: '#ffe29a', metal: [104, 112, 130], sky: ['#150f22', '#3a2340'] },
  { name: 'frost', earthTop: [150, 178, 214], earthBottom: [82, 102, 150], lip: '#e6f6ff', metal: [86, 100, 122], sky: ['#08121f', '#123047'] },
  { name: 'ember', earthTop: [166, 92, 82], earthBottom: [92, 44, 50], lip: '#ffb36b', metal: [96, 96, 112], sky: ['#16090c', '#36141c'] },
  { name: 'moss', earthTop: [110, 150, 92], earthBottom: [54, 82, 62], lip: '#c4f27a', metal: [88, 104, 116], sky: ['#07130f', '#14302a'] },
];

export function themeFor(name: string): Theme {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return THEMES[h % THEMES.length];
}

function hash(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) & 0xffff) / 0xffff;
}

const rgb = (c: number[], k = 1, a = 1) =>
  `rgba(${Math.round(Math.min(255, c[0] * k))},${Math.round(Math.min(255, c[1] * k))},${Math.round(Math.min(255, c[2] * k))},${a})`;
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);

export class TerrainPainter {
  readonly color: HTMLCanvasElement;
  readonly glow: HTMLCanvasElement;
  private c: CanvasRenderingContext2D;
  private gctx: CanvasRenderingContext2D;

  constructor(private cells: Uint32Array, private rows: number, readonly theme: Theme) {
    this.color = document.createElement('canvas');
    this.glow = document.createElement('canvas');
    for (const cv of [this.color, this.glow]) {
      cv.width = 256 * CELL_PX;
      cv.height = rows * CELL_PX;
    }
    this.c = this.color.getContext('2d')!;
    this.gctx = this.glow.getContext('2d')!;
    this.gctx.fillStyle = '#000';
    this.gctx.fillRect(0, 0, this.glow.width, this.glow.height);
    for (let y = 0; y < rows; y++) for (let x = 0; x < 256; x++) this.paint(x, y);
  }

  private at(x: number, y: number) {
    if (y < 0 || y >= this.rows) return F.METAL | F.EARTH;
    return this.cells[((x + 256) % 256) + y * 256];
  }

  /** Repaint changed cells plus their neighbours (bevels depend on neighbours). */
  repaint(indices: Iterable<number>) {
    const todo = new Set<number>();
    for (const i of indices) {
      const x = i % 256, y = Math.floor(i / 256);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy;
          if (yy >= 0 && yy < this.rows) todo.add(((x + dx + 256) % 256) + yy * 256);
        }
    }
    for (const i of todo) this.paint(i % 256, Math.floor(i / 256));
  }

  paint(x: number, y: number) {
    const S = CELL_PX;
    const px = x * S, py = (this.rows - 1 - y) * S;
    const v = this.at(x, y);
    const c = this.c, g = this.gctx, th = this.theme;
    c.clearRect(px, py, S, S);
    g.fillStyle = '#000';
    g.fillRect(px, py, S, S);
    const solid = (w: number) => (w & F.EARTH) !== 0;
    const n = hash(x, y);

    if (v & F.EARTH) {
      const up = solid(this.at(x, y + 1)), down = solid(this.at(x, y - 1));
      const left = solid(this.at(x - 1, y)), right = solid(this.at(x + 1, y));
      if (v & F.METAL) {
        const base = th.metal;
        const k = 0.92 + n * 0.12 + ((x >> 2) + (y >> 2)) % 2 * 0.06;
        c.fillStyle = rgb(base, k);
        c.fillRect(px, py, S, S);
        // plate seams + rivets every 4 cells
        c.fillStyle = rgb(base, 0.62);
        if (x % 4 === 0) c.fillRect(px, py, 1, S);
        if (y % 4 === 0) c.fillRect(px, py + S - 1, S, 1);
        if (x % 4 === 1 && y % 4 === 2) {
          c.fillStyle = rgb(base, 1.45);
          c.fillRect(px + 2, py + 2, 2, 2);
        }
        if (!up) { c.fillStyle = rgb(base, 1.6); c.fillRect(px, py, S, 2); }
      } else {
        const t = Math.min(1, Math.max(0, y / this.rows));
        const base = mix(th.earthBottom, th.earthTop, t);
        c.fillStyle = rgb(base, 0.9 + n * 0.18);
        c.fillRect(px, py, S, S);
        // speckles
        if (n > 0.72) { c.fillStyle = rgb(base, 1.25); c.fillRect(px + (n * 37 % 5), py + (n * 53 % 5), 2, 2); }
        if (n < 0.12) { c.fillStyle = rgb(base, 0.7); c.fillRect(px + 3, py + 4, 2, 2); }
        if (v & (F.NODIG_DOWN | F.NODIG_UP)) {
          c.fillStyle = 'rgba(0,0,0,0.28)';
          for (let k = 0; k < S; k += 3) c.fillRect(px + k, py + ((k + y) % S), 2, 2);
        }
        if (!up) { c.fillStyle = th.lip; c.fillRect(px, py, S, 2); c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(px, py + 2, S, 1); }
      }
      if (v & (F.ONEWAY_R | F.ONEWAY_L)) {
        const d = v & F.ONEWAY_R ? -1 : 1; // arrows point the way you CAN bash
        c.strokeStyle = 'rgba(255,240,180,0.55)';
        c.lineWidth = 1.5;
        c.beginPath();
        const cx = px + S / 2, cy = py + S / 2;
        c.moveTo(cx - d * 2, cy - 3);
        c.lineTo(cx + d * 2, cy);
        c.lineTo(cx - d * 2, cy + 3);
        c.stroke();
      }
      if (!down) { c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(px, py + S - 2, S, 2); }
      if (!left) { c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(px, py, 1, S); }
      if (!right) { c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(px + S - 1, py, 1, S); }
      return;
    }
    const fluid = v & (F.WATER | F.LAVA | F.ACID);
    if (fluid) {
      const surface = !(this.at(x, y + 1) & fluid);
      const [col, glow] = fluid & F.LAVA ? ['rgba(255,96,32,0.95)', '#ff5a1f']
        : fluid & F.ACID ? ['rgba(140,240,60,0.9)', '#5cff3a'] : ['rgba(56,140,255,0.82)', '#1f5fff'];
      c.fillStyle = col;
      c.fillRect(px, py, S, S);
      g.fillStyle = glow;
      g.globalAlpha = fluid & F.WATER ? 0.25 : 0.7;
      g.fillRect(px, py, S, S);
      g.globalAlpha = 1;
      if (surface) {
        c.fillStyle = 'rgba(255,255,255,0.75)';
        c.fillRect(px, py, S, 2);
        g.fillStyle = '#fff';
        g.globalAlpha = 0.6;
        g.fillRect(px, py, S, 1);
        g.globalAlpha = 1;
      }
      return;
    }
    if (v & F.BARRIER) {
      c.fillStyle = 'rgba(255,80,220,0.6)';
      c.fillRect(px + 2, py, S - 4, S);
      g.fillStyle = '#ff4ad8';
      g.fillRect(px + 3, py, S - 6, S);
    }
  }
}
