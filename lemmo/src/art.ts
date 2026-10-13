// Vector art for Lemmo: Lemmo's in every state, level objects and particles, drawn on a 2D overlay.
import type { Lemmo } from './sim.ts';

type Ctx = CanvasRenderingContext2D;

const PALETTE: Record<number, { robe: string; robeDark: string; hair: string; skin: string }> = {
  0: { robe: '#4c6fff', robeDark: '#2f45b8', hair: '#5df28a', skin: '#ffd2b0' },
  1: { robe: '#22c3e6', robeDark: '#127c99', hair: '#7cf7ff', skin: '#ffd2b0' },
  2: { robe: '#9be22f', robeDark: '#5b8f13', hair: '#d06bff', skin: '#ffd2b0' },
};

const TAU = Math.PI * 2;

function limb(c: Ctx, x1: number, y1: number, x2: number, y2: number, w: number, col: string) {
  c.strokeStyle = col;
  c.lineWidth = w;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.stroke();
}

/**
 * Draw a Lemmo with feet at (0,0) in a local frame where 1 unit = 1 grid cell,
 * y up is negative screen y. `face` is +1 (right) or -1 (left).
 */
function body(c: Ctx, l: Lemmo, t: number, face: number, s: number) {
  const pal = PALETTE[l.type] ?? PALETTE[0];
  const lw = Math.max(0.16, 1.4 / s);
  let bob = 0, legA = 0, armA = 0.3, armB = -0.3, lean = 0, armUp = false, crouch = 0;
  switch (l.state) {
    case 'walking': {
      const p = t * TAU * 2.2;
      legA = Math.sin(p) * 0.55;
      armA = -Math.sin(p) * 0.6;
      armB = Math.sin(p) * 0.6;
      bob = Math.abs(Math.cos(p)) * 0.12;
      break;
    }
    case 'falling':
      armUp = true;
      legA = Math.sin(t * 18) * 0.35;
      break;
    case 'blocking':
      armA = Math.PI / 2;
      armB = -Math.PI / 2;
      legA = 0.35;
      break;
    case 'building':
      crouch = 0.25;
      armA = 0.9 + Math.sin(l.cyc * TAU) * 0.5;
      armB = 0.7;
      lean = 0.15;
      break;
    case 'bashing': {
      const punch = Math.max(0, Math.sin(l.cyc * TAU * 2));
      armA = 1.5;
      armB = 1.2 - punch * 0.6;
      lean = 0.2;
      legA = 0.3;
      break;
    }
    case 'mining':
      lean = 0.25;
      armA = 2.2 - Math.abs(Math.sin(l.cyc * Math.PI)) * 2.2;
      armB = armA - 0.2;
      crouch = 0.1;
      break;
    case 'digging':
      crouch = 0.3;
      armA = 2.6 + Math.sin(l.cyc * TAU * 2) * 0.4;
      armB = -2.6 - Math.sin(l.cyc * TAU * 2) * 0.4;
      bob = -Math.abs(Math.sin(l.cyc * TAU * 2)) * 0.2;
      break;
    case 'shrugging':
      armUp = true;
      break;
    case 'ohno':
      armUp = true;
      lean = Math.sin(t * 40) * 0.08;
      break;
    case 'climbing':
      armUp = true;
      legA = Math.sin(t * 14) * 0.4;
      break;
  }
  c.save();
  c.translate(0, -bob);
  c.rotate(lean * face);
  // legs
  const hipY = 1.25 - crouch;
  limb(c, -0.2, -hipY, -0.25 + Math.sin(legA) * 0.6 * face, -0.05, 0.42, pal.robeDark);
  limb(c, 0.2, -hipY, 0.25 - Math.sin(legA) * 0.6 * face, -0.05, 0.42, pal.robeDark);
  // feet
  c.fillStyle = '#2b2440';
  c.beginPath();
  c.ellipse(-0.25 + Math.sin(legA) * 0.6 * face + 0.12 * face, 0, 0.3, 0.16, 0, 0, TAU);
  c.ellipse(0.25 - Math.sin(legA) * 0.6 * face + 0.12 * face, 0, 0.3, 0.16, 0, 0, TAU);
  c.fill();
  // robe
  const top = 2.45 - crouch;
  const grad = c.createLinearGradient(-0.7, -top, 0.7, -hipY);
  grad.addColorStop(0, pal.robe);
  grad.addColorStop(1, pal.robeDark);
  c.fillStyle = grad;
  c.beginPath();
  c.moveTo(-0.45, -top);
  c.quadraticCurveTo(0, -top - 0.25, 0.45, -top);
  c.lineTo(0.72, -hipY + 0.15);
  c.quadraticCurveTo(0, -hipY - 0.15, -0.72, -hipY + 0.15);
  c.closePath();
  c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.25)';
  c.lineWidth = lw;
  c.stroke();
  // arms
  const sh = -top + 0.25;
  const arm = (a: number, side: number) => {
    const ang = armUp ? -Math.PI * 0.85 + side * 0.25 + Math.sin(t * 16 + side) * 0.25 : a;
    const ex = side * 0.42 + Math.sin(ang) * 0.95 * face;
    const ey = sh + Math.cos(ang) * 0.95;
    limb(c, side * 0.42, sh, ex, ey, 0.34, pal.robe);
    c.fillStyle = pal.skin;
    c.beginPath();
    c.arc(ex, ey, 0.2, 0, TAU);
    c.fill();
    return [ex, ey];
  };
  const back = arm(armB, -face);
  const fore = arm(armA, face);
  // head
  const hy = -top - 0.62;
  c.fillStyle = pal.skin;
  c.beginPath();
  c.arc(0.08 * face, hy, 0.55, 0, TAU);
  c.fill();
  // nose + eye
  c.beginPath();
  c.arc(0.55 * face, hy + 0.08, 0.17, 0, TAU);
  c.fill();
  c.fillStyle = '#1b1530';
  c.beginPath();
  c.arc(0.3 * face, hy - 0.08, 0.09, 0, TAU);
  c.fill();
  // hair tuft
  c.fillStyle = pal.hair;
  c.beginPath();
  const sway = Math.sin(t * 6) * 0.08 + (l.state === 'falling' ? 0.25 : 0);
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI + (i / 6) * Math.PI;
    const rr = i % 2 ? 0.95 : 0.62;
    c.lineTo(Math.cos(a) * rr * 0.75 - 0.05 * face + sway * (i / 6), hy - 0.1 + Math.sin(a) * rr * (l.state === 'falling' ? 1.25 : 1));
  }
  c.closePath();
  c.fill();
  // tools
  if (l.state === 'mining') {
    c.save();
    c.translate(fore[0], fore[1]);
    c.rotate(-(armA - 1) * face);
    limb(c, 0, 0, 0.9 * face, -0.6, 0.18, '#a07040');
    limb(c, 0.55 * face, -0.95, 1.2 * face, -0.25, 0.22, '#cfd6e6');
    c.restore();
  }
  if (l.state === 'digging') {
    limb(c, (fore[0] + back[0]) / 2, (fore[1] + back[1]) / 2, 0.1 * face, 0.4, 0.18, '#a07040');
    c.fillStyle = '#cfd6e6';
    c.fillRect(-0.25 + 0.1 * face, 0.3, 0.5, 0.4);
  }
  if (l.state === 'building') {
    c.fillStyle = '#e6a46a';
    c.fillRect(fore[0] - 0.3, fore[1] - 0.15, 0.7, 0.32);
  }
  c.restore();
}

function umbrella(c: Ctx, t: number, open: number) {
  c.save();
  c.translate(0, -4.3);
  c.rotate(Math.sin(t * 2.4) * 0.12);
  const r = 1.8 * open;
  for (let i = 0; i < 6; i++) {
    c.fillStyle = i % 2 ? '#ffd23f' : '#ff4d5e';
    c.beginPath();
    c.moveTo(0, 0);
    c.arc(0, 0.35, r, Math.PI + (i / 6) * Math.PI, Math.PI + ((i + 1) / 6) * Math.PI);
    c.closePath();
    c.fill();
  }
  limb(c, 0, 0, 0, 1.9, 0.12, '#6a4a3a');
  c.restore();
}

function rat(c: Ctx, t: number, face: number) {
  const p = Math.sin(t * 16) * 0.15;
  c.fillStyle = '#7b7f93';
  c.beginPath();
  c.ellipse(0, -0.75 + p * 0.3, 1.25, 0.72, 0, 0, TAU);
  c.fill();
  c.beginPath();
  c.ellipse(1.15 * face, -1.0, 0.62, 0.48, 0.3 * face, 0, TAU);
  c.fill();
  c.fillStyle = '#ffb0c0';
  c.beginPath();
  c.arc(0.9 * face, -1.55, 0.26, 0, TAU);
  c.fill();
  c.fillStyle = '#ff2d4a';
  c.beginPath();
  c.arc(1.35 * face, -1.12, 0.1, 0, TAU);
  c.fill();
  limb(c, -1.2 * face, -0.6, -2.2 * face, -0.9 + p, 0.14, '#c49aa8');
  limb(c, -0.5, -0.2, -0.6 + p, 0, 0.2, '#5d6174');
  limb(c, 0.5, -0.2, 0.6 - p, 0, 0.2, '#5d6174');
}

export interface DrawOpts {
  face: number;
  hover: boolean;
  time: number;
}

/** Draw Lemmo `l` at screen (sx, sy) where `s` = pixels per grid unit. */
export function drawLemmo(c: Ctx, l: Lemmo, sx: number, sy: number, s: number, o: DrawOpts) {
  const t = l.t + l.id * 0.37;
  c.save();
  c.translate(sx, sy);
  c.scale(s, s);
  // soft contact shadow
  c.fillStyle = 'rgba(0,0,0,0.3)';
  c.beginPath();
  c.ellipse(0, 0.05, 0.9, 0.22, 0, 0, TAU);
  c.fill();
  if (o.hover) {
    c.strokeStyle = 'rgba(120,255,200,0.95)';
    c.lineWidth = 2 / s;
    c.shadowColor = '#4dffb5';
    c.shadowBlur = 10;
    c.beginPath();
    c.ellipse(0, -1.6, 1.6, 2.4, 0, 0, TAU);
    c.stroke();
    c.shadowBlur = 0;
  }
  if (l.g < 0) c.scale(1, -1); // anti-gravity walkers hang upside down
  if (l.spin > 0) {
    // the anti-gravity flip: a quick somersault
    c.translate(0, -1.4);
    c.rotate((1 - l.spin / 0.6) * TAU * o.face);
    c.translate(0, 1.4);
  }
  if (l.fast > 0 || l.slow > 0) {
    c.strokeStyle = l.fast > 0 ? 'rgba(255,200,87,0.7)' : 'rgba(140,170,255,0.6)';
    c.lineWidth = 0.18;
    for (let i = 0; i < 3; i++) {
      const y = -0.8 - i * 0.7;
      c.beginPath();
      c.moveTo(-o.face * (1.1 + (i % 2) * 0.4), y);
      c.lineTo(-o.face * (2.2 + (l.fast > 0 ? 0.8 : 0)), y);
      c.stroke();
    }
  }
  const face = o.face;
  switch (l.state) {
    case 'splatting': {
      const k = Math.min(1, l.t / 0.15);
      c.fillStyle = (PALETTE[l.type] ?? PALETTE[0]).robe;
      c.beginPath();
      c.ellipse(0, -0.25, 0.9 + k * 0.8, 0.45 - k * 0.2, 0, 0, TAU);
      c.fill();
      c.fillStyle = (PALETTE[l.type] ?? PALETTE[0]).hair;
      c.beginPath();
      c.ellipse(0.6, -0.4, 0.5, 0.25, 0, 0, TAU);
      c.fill();
      break;
    }
    case 'drowning': {
      const sink = Math.min(1, l.t / 1.1);
      c.save();
      c.beginPath();
      c.rect(-3, -6, 6, 6 - 0.2 - sink * 0.2);
      c.clip();
      c.translate(0, sink * 3.2);
      body(c, { ...l, state: 'ohno' }, t, face, s);
      c.restore();
      c.fillStyle = 'rgba(200,240,255,0.8)';
      for (let i = 0; i < 4; i++) {
        const bt = (l.t * 1.6 + i * 0.27) % 1;
        c.beginPath();
        c.arc(Math.sin(i * 7 + l.t * 5) * 0.6, -0.4 - bt * 3, 0.18 + i * 0.04, 0, TAU);
        c.fill();
      }
      break;
    }
    case 'burning':
      body(c, { ...l, state: 'ohno' }, t, face, s);
      for (let i = 0; i < 6; i++) {
        const ft = (l.t * 2.5 + i / 6) % 1;
        c.fillStyle = `rgba(255,${Math.round(200 - ft * 160)},40,${1 - ft})`;
        c.beginPath();
        c.arc(Math.sin(i * 3.1) * 0.7, -ft * 4.2, 0.55 * (1 - ft) + 0.15, 0, TAU);
        c.fill();
      }
      break;
    case 'exiting': {
      const k = Math.min(1, l.t / 0.8);
      c.translate(0, -k * 3);
      c.scale(1 - k * 0.8, 1 - k * 0.8);
      c.globalAlpha = 1 - k * 0.6;
      body(c, { ...l, state: 'falling' }, t, face, s);
      break;
    }
    case 'trapped':
      c.globalAlpha = Math.max(0, 1 - l.t / 0.5);
      body(c, { ...l, state: 'ohno' }, t, face, s);
      break;
    case 'cartwheeling':
      c.translate(0, -1.4);
      c.rotate(face * l.t * 12);
      c.translate(0, 1.4);
      body(c, { ...l, state: 'blocking' }, t, face, s);
      break;
    case 'rocketing': {
      // flame below the feet, Lemmo stretched upward
      for (let i = 0; i < 5; i++) {
        const ft = (l.t * 6 + i / 5) % 1;
        c.fillStyle = `rgba(255,${Math.round(220 - ft * 150)},60,${1 - ft})`;
        c.beginPath();
        c.arc(Math.sin(i * 2.3 + l.t * 30) * 0.3, ft * 2.6, 0.5 * (1 - ft) + 0.15, 0, TAU);
        c.fill();
      }
      body(c, { ...l, state: 'shrugging' }, t, face, s);
      break;
    }
    case 'trampoline': {
      // lying on its back with a springy mat on top
      c.save();
      c.translate(0, -0.45);
      c.rotate(-face * Math.PI / 2);
      c.scale(0.8, 0.8);
      body(c, { ...l, state: 'blocking' }, t, face, s);
      c.restore();
      const sag = Math.max(0, Math.sin(l.t * 9)) * 0.15;
      c.strokeStyle = '#5df2b0';
      c.lineWidth = 0.28;
      c.beginPath();
      c.moveTo(-1.8, -1.6);
      c.quadraticCurveTo(0, -1.6 + sag * 4, 1.8, -1.6);
      c.stroke();
      break;
    }
    case 'bouncing':
      body(c, { ...l, state: 'falling' }, t, face, s);
      break;
    case 'flipping': {
      const k = Math.min(1, l.t / 0.35);
      c.translate(face * k * 0.8, -k * 0.5);
      c.rotate(face * (1 - k) * 0.8);
      body(c, { ...l, state: 'walking' }, t, face, s);
      break;
    }
    default:
      if (l.type === 3) rat(c, t, face);
      else {
        if (l.state === 'falling' && l.umbrella) umbrella(c, t, 1);
        body(c, l, t, face, s);
      }
  }
  c.restore();
  const fuse = l.bomb ?? l.fuse;
  if (fuse !== null && l.state !== 'dead') {
    const n = Math.ceil(fuse);
    const y = sy - s * 5.6 * (l.g < 0 ? -1 : 1);
    c.save();
    c.font = `700 ${Math.max(11, s * 1.6)}px Outfit, system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const w = Math.max(18, s * 2.4);
    c.fillStyle = l.bomb !== null ? 'rgba(255,70,90,0.92)' : 'rgba(255,160,40,0.92)';
    c.beginPath();
    c.roundRect(sx - w / 2, y - w / 2, w, w, w / 2);
    c.fill();
    c.fillStyle = '#fff';
    c.fillText(String(n), sx, y + 1);
    c.restore();
  }
}

// ---------------------------------------------------------------- objects
export function drawEntrance(c: Ctx, sx: number, sy: number, s: number, w: number, h: number, type: number, open: number, time: number) {
  const col = ['#5eead4', '#38bdf8', '#a3e635'][type] ?? '#5eead4';
  c.save();
  c.translate(sx, sy);
  c.scale(s, s);
  const W = w, H = h;
  const g = c.createLinearGradient(0, -H, 0, 0);
  g.addColorStop(0, '#2a3354');
  g.addColorStop(1, '#151a30');
  c.fillStyle = g;
  c.strokeStyle = col;
  c.lineWidth = 0.35;
  c.shadowColor = col;
  c.shadowBlur = 12;
  c.beginPath();
  c.roundRect(-W / 2, -H, W, H * 0.85, 1.2);
  c.fill();
  c.stroke();
  c.shadowBlur = 0;
  // trapdoor
  c.fillStyle = `rgba(0,0,0,${0.6})`;
  c.fillRect(-W * 0.32, -H * 0.18, W * 0.64, H * 0.06);
  c.save();
  c.translate(-W * 0.32, -H * 0.15);
  c.rotate(open * 1.3);
  c.fillStyle = col;
  c.globalAlpha = 0.85;
  c.fillRect(0, 0, W * 0.32, 0.35);
  c.restore();
  c.save();
  c.translate(W * 0.32, -H * 0.15);
  c.rotate(-open * 1.3);
  c.fillStyle = col;
  c.globalAlpha = 0.85;
  c.fillRect(-W * 0.32, 0, W * 0.32, 0.35);
  c.restore();
  // lights
  for (let i = 0; i < 3; i++) {
    c.fillStyle = col;
    c.globalAlpha = 0.4 + 0.6 * Math.max(0, Math.sin(time * 4 + i));
    c.beginPath();
    c.arc(-W * 0.25 + i * W * 0.25, -H * 0.72, 0.45, 0, TAU);
    c.fill();
  }
  c.restore();
}

export function drawExit(c: Ctx, sx: number, sy: number, s: number, time: number) {
  c.save();
  c.translate(sx, sy);
  c.scale(s, s);
  const bob = Math.sin(time * 1.6) * 0.35;
  // basket
  c.fillStyle = '#b07a46';
  c.beginPath();
  c.roundRect(-2.2, -2.2, 4.4, 2.2, 0.5);
  c.fill();
  c.strokeStyle = '#7a4f2b';
  c.lineWidth = 0.2;
  for (let i = -1; i <= 1; i++) {
    c.beginPath();
    c.moveTo(i * 1.4, -2.2);
    c.lineTo(i * 1.4, 0);
    c.stroke();
  }
  // ropes
  c.strokeStyle = 'rgba(255,255,255,0.6)';
  c.lineWidth = 0.12;
  c.beginPath();
  c.moveTo(-2, -2.2);
  c.lineTo(-3.2, -6 + bob);
  c.moveTo(2, -2.2);
  c.lineTo(3.2, -6 + bob);
  c.stroke();
  // envelope
  const cy = -10 + bob;
  const g = c.createRadialGradient(-1.5, cy - 2, 0.5, 0, cy, 6);
  g.addColorStop(0, '#ffe08a');
  g.addColorStop(0.5, '#ff7a59');
  g.addColorStop(1, '#c2346b');
  c.shadowColor = '#ff9a6b';
  c.shadowBlur = 18;
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(-3.2, -6 + bob);
  c.bezierCurveTo(-7, cy - 2, -4.5, cy - 7, 0, cy - 7);
  c.bezierCurveTo(4.5, cy - 7, 7, cy - 2, 3.2, -6 + bob);
  c.closePath();
  c.fill();
  c.shadowBlur = 0;
  c.strokeStyle = 'rgba(255,255,255,0.35)';
  c.lineWidth = 0.25;
  for (const k of [-0.5, 0, 0.5]) {
    c.beginPath();
    c.moveTo(k * 3.2 * 2, -6 + bob);
    c.quadraticCurveTo(k * 9, cy - 3, 0, cy - 7);
    c.stroke();
  }
  c.restore();
}

export function drawTrap(c: Ctx, sx: number, sy: number, s: number, w: number, time: number, active: boolean, on = true, moving = false) {
  c.save();
  c.translate(sx, sy);
  c.scale(s, s);
  if (!on) c.globalAlpha = 0.4;
  if (moving) {
    // deathroller: a spiked drum
    c.translate(0, -2.4);
    c.rotate(time * 6);
    c.fillStyle = '#4a4f66';
    c.strokeStyle = active ? '#ff3b5c' : '#cfd6e6';
    c.lineWidth = 0.25;
    c.beginPath();
    c.arc(0, 0, 2.1, 0, TAU);
    c.fill();
    c.stroke();
    c.fillStyle = '#cfd6e6';
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      c.beginPath();
      c.moveTo(Math.cos(a - 0.15) * 2.1, Math.sin(a - 0.15) * 2.1);
      c.lineTo(Math.cos(a) * 2.9, Math.sin(a) * 2.9);
      c.lineTo(Math.cos(a + 0.15) * 2.1, Math.sin(a + 0.15) * 2.1);
      c.fill();
    }
    c.restore();
    return;
  }
  const W = Math.max(3, w);
  c.fillStyle = '#26132a';
  c.strokeStyle = active ? '#ff3b5c' : '#ff8aa0';
  c.lineWidth = 0.3;
  c.beginPath();
  c.roundRect(-W / 2, -1.5, W, 1.5, 0.4);
  c.fill();
  c.stroke();
  // spinning saw
  c.translate(0, -2.6);
  c.rotate(on ? time * (active ? 9 : 3) : 0);
  c.fillStyle = '#d7dce8';
  c.beginPath();
  for (let i = 0; i < 16; i++) {
    const r = i % 2 ? 1.25 : 1.75;
    const a = (i / 16) * TAU;
    c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  c.closePath();
  c.fill();
  c.fillStyle = '#ff3b5c';
  c.beginPath();
  c.arc(0, 0, 0.45, 0, TAU);
  c.fill();
  c.restore();
}

export function drawAntigrav(c: Ctx, sx: number, sy: number, s: number, w: number, h: number, time: number, on = true) {
  c.save();
  c.translate(sx, sy);
  c.scale(s, s);
  if (!on) c.globalAlpha = 0.25;
  c.strokeStyle = 'rgba(80,230,255,0.7)';
  c.lineWidth = 0.18;
  c.shadowColor = '#3de7ff';
  c.shadowBlur = 10;
  c.beginPath();
  c.roundRect(-w / 2, -h, w, h, 0.8);
  c.stroke();
  for (let i = 0; i < 3; i++) {
    const k = (time * 0.8 + i / 3) % 1;
    c.globalAlpha = 1 - k;
    c.beginPath();
    c.moveTo(-0.8, -h * k + 0.6);
    c.lineTo(0, -h * k - 0.2);
    c.lineTo(0.8, -h * k + 0.6);
    c.stroke();
  }
  c.restore();
}

export function drawPortal(c: Ctx, sx: number, sy: number, s: number, time: number) {
  c.save();
  c.translate(sx, sy - 2.5 * s);
  c.scale(s, s);
  for (let i = 0; i < 3; i++) {
    c.strokeStyle = `rgba(190,120,255,${0.8 - i * 0.2})`;
    c.lineWidth = 0.3;
    c.beginPath();
    c.ellipse(0, 0, 1.6 + i * 0.5, 2.6 + i * 0.6, 0, time * (2 + i) % TAU, (time * (2 + i) % TAU) + Math.PI * 1.4);
    c.stroke();
  }
  c.restore();
}

/**
 * Switches: skill_pad (a button, pressed once), kind1 (a lever, tilted by `state` ±1),
 * kind2 (a timed plate) and kind4 (a speed pad with chevrons).
 */
export function drawSwitch(c: Ctx, sx: number, sy: number, s: number, kind: string, state: number, on: boolean, w: number, time: number) {
  c.save();
  c.translate(sx, sy);
  c.scale(s, s);
  if (!on) c.globalAlpha = 0.35;
  const W = Math.max(2.4, w);
  c.fillStyle = '#2a3354';
  c.strokeStyle = '#8b9ac2';
  c.lineWidth = 0.2;
  c.beginPath();
  c.roundRect(-W / 2, -0.5, W, 0.5, 0.2);
  c.fill();
  c.stroke();
  if (kind === 'kind1') {
    const a = (state === 1 ? 1 : -1) * 0.6;
    limb(c, 0, -0.4, Math.sin(a) * 2.4, -0.4 - Math.cos(a) * 2.4, 0.28, '#cfd6e6');
    c.fillStyle = state === 1 ? '#5df2b0' : '#ff8a5c';
    c.beginPath();
    c.arc(Math.sin(a) * 2.4, -0.4 - Math.cos(a) * 2.4, 0.55, 0, TAU);
    c.fill();
  } else if (kind === 'kind4') {
    c.strokeStyle = state === 1 ? '#ffe28a' : '#ffc857';
    c.lineWidth = 0.25;
    for (let i = 0; i < 3; i++) {
      const k = (time * 2 + i / 3) % 1;
      c.globalAlpha = (on ? 1 : 0.35) * (1 - k);
      const x = -W / 2 + k * W;
      c.beginPath();
      c.moveTo(x - 0.4, -1.4);
      c.lineTo(x + 0.2, -0.9);
      c.lineTo(x - 0.4, -0.4);
      c.stroke();
    }
  } else {
    const down = state === 1;
    c.fillStyle = kind === 'kind2' ? (down ? '#ffc857' : '#b88a2e') : down ? '#5df2b0' : '#ff4d6d';
    c.shadowColor = c.fillStyle;
    c.shadowBlur = down ? 0 : 8;
    c.beginPath();
    c.roundRect(-W * 0.3, down ? -0.75 : -1.1, W * 0.6, down ? 0.3 : 0.65, 0.2);
    c.fill();
  }
  c.restore();
}

/**
 * A sliding door while it moves (`prog` 0 = open, 1 = closed; a closed door is drawn by the terrain as
 * metal). Counting doors show how many Lemmo's may still pass.
 */
export function drawDoor(c: Ctx, sx: number, sy: number, s: number, w: number, h: number, prog: number, left: number | null, time: number) {
  c.save();
  c.translate(sx, sy);
  c.scale(s, s);
  if (prog > 0 && prog < 1) {
    c.globalAlpha = 0.25 + prog * 0.6;
    c.fillStyle = '#6b7a90';
    c.strokeStyle = '#cfd6e6';
    c.lineWidth = 0.2;
    c.fillRect(-w / 2, -h, w, h);
    c.strokeRect(-w / 2, -h, w, h);
    c.globalAlpha = 1;
  }
  if (prog < 1) {
    // rails marking where the door will close
    c.strokeStyle = `rgba(160,180,210,${0.35 + 0.15 * Math.sin(time * 3)})`;
    c.lineWidth = 0.18;
    c.setLineDash([0.6, 0.5]);
    c.strokeRect(-w / 2, -h, w, h);
    c.setLineDash([]);
  }
  if (left !== null) {
    c.font = '700 2.2px Outfit, system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = 'rgba(16,20,38,0.85)';
    c.beginPath();
    c.roundRect(-1.6, -h - 3, 3.2, 2.4, 0.6);
    c.fill();
    c.fillStyle = left > 0 ? '#ffc857' : '#ff4d6d';
    c.fillText(String(left), 0, -h - 1.75);
  }
  c.restore();
}

// ---------------------------------------------------------------- particles
export interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; grav: number;
}

const BURST: Record<string, { colors: string[]; speed: number; grav: number; life: number; size: number }> = {
  dirt: { colors: ['#b7804f', '#8a5a35', '#d9a36d'], speed: 6, grav: 40, life: 0.8, size: 0.35 },
  blast: { colors: ['#ffd36b', '#ff7a3d', '#ff3d5e', '#fff2c2'], speed: 22, grav: 18, life: 1.0, size: 0.55 },
  splash: { colors: ['#9fd8ff', '#4aa8ff', '#ffffff'], speed: 9, grav: 35, life: 0.7, size: 0.3 },
  sparkle: { colors: ['#fff6b0', '#7dffcf', '#ffffff', '#ffb3f0'], speed: 7, grav: -4, life: 1.0, size: 0.3 },
  spark: { colors: ['#ffffff', '#ffe28a'], speed: 10, grav: 20, life: 0.4, size: 0.2 },
  smoke: { colors: ['#555a6e', '#3a3e4f', '#ff8a3d'], speed: 3, grav: -8, life: 1.2, size: 0.6 },
};

export function burst(out: Particle[], x: number, y: number, style: string, n: number) {
  const b = BURST[style] ?? BURST.dirt;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, sp = b.speed * (0.3 + Math.random() * 0.7);
    out.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + b.speed * 0.3, life: b.life * (0.6 + Math.random() * 0.4),
      max: b.life, color: b.colors[i % b.colors.length], size: b.size * (0.6 + Math.random() * 0.8), grav: b.grav,
    });
  }
}

export function stepParticles(ps: Particle[], dt: number) {
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    p.life -= dt;
    if (p.life <= 0) {
      ps.splice(i, 1);
      continue;
    }
    p.vy -= p.grav * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}
