// Lemmo simulation — a re-implementation of the original game rules recovered from the
// original executable (docs/SPEC.md). Units: x = column (0..256, wraps), y = feet row (row 0 = bottom),
// time in seconds.
import { decodeCells, type Footprint, type LevelData } from './level.ts';

export const F = {
  EARTH: 0x1, METAL: 0x2, ONEWAY_R: 0x4, ONEWAY_L: 0x8, NODIG_DOWN: 0x10, NODIG_UP: 0x20,
  OBJ: 0x80, WATER: 0x200, BARRIER: 0x800, TRAMP: 0x1000, LAVA: 0x2000, ACID: 0x4000, SPIN: 0x8000,
};
export const FLUID = F.WATER | F.LAVA | F.ACID;

export const SKILLS = ['climber', 'floater', 'bomber', 'blocker', 'builder', 'basher', 'miner', 'digger'] as const;
export type Skill = (typeof SKILLS)[number];

// Constants recovered from the EXE.
export const WALK_SPEED = 5;      // columns / s       (DAT_004b10b0)
export const CLIMB_SPEED = 5;     // rows / s
export const FALL_SPEED = 20;     // rows / s          (DAT_004b0a18)
export const FLOAT_SPEED = 10;    // rows / s (umbrella halves fall speed)
export const UMBRELLA_AT = 10;    // rows fallen before the umbrella opens
export const SPLAT_ROWS = 30;     // fatal fall height
export const BOMB_TIME = 5;       // bomber countdown
export const BRICKS = 12;
export const CYCLE = 1;           // one 100-step skill cycle == one animation loop (1 s)
export const HEAD = 2;            // rows above the feet that make up the body

// COMPILED\RELEASERATE.PC: seconds between Lemmo's for release rate 1..99.
export const RELEASE_INTERVAL = [5.0, 4.515, 4.314, 4.16, 4.03, 3.916, 3.812, 3.717, 3.629, 3.545, 3.467,
  3.392, 3.32, 3.252, 3.186, 3.122, 3.061, 3.001, 2.943, 2.886, 2.832, 2.778, 2.726, 2.675, 2.625, 2.576,
  2.528, 2.481, 2.434, 2.389, 2.344, 2.3, 2.257, 2.215, 2.173, 2.131, 2.091, 2.051, 2.011, 1.972, 1.933,
  1.895, 1.858, 1.82, 1.784, 1.747, 1.711, 1.676, 1.641, 1.606, 1.571, 1.537, 1.504, 1.47, 1.437, 1.404,
  1.372, 1.339, 1.307, 1.276, 1.244, 1.213, 1.182, 1.151, 1.121, 1.091, 1.061, 1.031, 1.002, 0.972, 0.943,
  0.914, 0.886, 0.857, 0.829, 0.801, 0.773, 0.745, 0.718, 0.69, 0.663, 0.636, 0.609, 0.583, 0.556, 0.53,
  0.503, 0.477, 0.451, 0.426, 0.4, 0.375, 0.349, 0.324, 0.299, 0.274, 0.249, 0.225, 0.2];

// The 7x7 bomber blast disc (EXE 0x4b1528).
const BLAST = ['..###..', '.#####.', '#######', '#######', '#######', '.#####.', '..###..'];

export type State =
  | 'falling' | 'walking' | 'climbing' | 'flipping' | 'blocking' | 'building' | 'shrugging'
  | 'bashing' | 'mining' | 'digging' | 'ohno' | 'drowning' | 'burning' | 'splatting'
  | 'exiting' | 'trapped' | 'dead' | 'saved';

const DYING: State[] = ['ohno', 'drowning', 'burning', 'splatting', 'exiting', 'trapped', 'dead', 'saved'];
const GROUND_SKILL_STATES: State[] = ['walking', 'building', 'bashing', 'mining', 'digging', 'shrugging'];

export interface Lemmo {
  id: number;
  x: number;
  y: number;
  dir: number;      // +1 = increasing column
  g: number;        // gravity sign (+1 normal, -1 after anti-gravity)
  type: number;     // 0 normal, 1 water Lemmo, 2 acid Lemmo, 3 evil rat
  climber: boolean;
  floater: boolean;
  state: State;
  t: number;        // time in current state
  cyc: number;      // time within current skill cycle
  fallen: number;
  umbrella: boolean;
  bricks: number;
  empty: number;    // basher cycles without anything to bash
  bomb: number | null;
  inside: Set<string>;
  blockCells: number[];
}

export type SimEvent =
  | { kind: 'sound'; name: string }
  | { kind: 'burst'; x: number; y: number; style: 'dirt' | 'blast' | 'splash' | 'sparkle' | 'spark' | 'smoke'; n: number };

interface Entrance {
  x: number; y: number; dir: number; type: number;
  left: number; rate: number; min: number; max: number; timer: number;
}

const wrap = (x: number, n = 256) => ((x % n) + n) % n;
const isInt = (v: number) => v === Math.round(v);
// Next integer strictly ahead of v when moving in direction d (+1/-1).
const nextInt = (v: number, d: number) => (d > 0 ? Math.floor(v) + 1 : Math.ceil(v) - 1);

export class Sim {
  readonly cols = 256;
  readonly rows: number;
  readonly cells: Uint32Array;
  private block: Uint8Array;
  readonly changed = new Set<number>();
  readonly lemmos: Lemmo[] = [];
  readonly events: SimEvent[] = [];
  readonly entrances: Entrance[];
  readonly skills: Record<string, number>;
  readonly total: number;
  saved = 0;
  died = 0;
  time = 0;
  timeLeft: number;
  nuking = false;
  finished = false;
  private nextId = 1;
  private startDelay = 1.5;
  private trapCooldown = new Map<number, number>();

  readonly level: LevelData;

  constructor(level: LevelData) {
    this.level = level;
    this.rows = level.grid.rows;
    this.cells = decodeCells(level);
    this.block = new Uint8Array(this.cells.length);
    this.timeLeft = level.timeLimit;
    this.skills = { ...level.skills };
    this.entrances = level.entrances.map((e) => ({
      x: e.spawn[0], y: e.spawn[1], dir: e.dir || 1, type: e.lemType, left: e.lemmos,
      rate: e.releaseRate, min: e.releaseRateMin, max: e.releaseRateMax, timer: 0,
    }));
    this.total = level.entrances.reduce((s, e) => s + e.lemmos, 0);
    for (const p of level.preplacedLemmos) {
      const l = this.spawn(p.pos[0], p.pos[1], p.dir || 1, p.type);
      l.g = p.gravity || 1;
      l.climber = p.climber;
      l.floater = p.floater;
      if (p.blocking) this.setState(l, 'blocking');
    }
    this.events.push({ kind: 'sound', name: 'letsgo' });
  }

  // ------------------------------------------------------------------ grid
  idx(x: number, y: number) {
    const yy = Math.max(0, Math.min(this.rows - 1, Math.round(y)));
    return wrap(Math.round(x)) + yy * this.cols;
  }
  terrain(x: number, y: number) {
    return this.cells[this.idx(x, y)];
  }
  get(x: number, y: number, rat = false) {
    const i = this.idx(x, y);
    return this.cells[i] | (!rat && this.block[i] ? F.BARRIER : 0);
  }
  private setCell(x: number, y: number, v: number) {
    if (y < 0 || y >= this.rows) return;
    const i = this.idx(x, y);
    if (this.cells[i] !== v) {
      this.cells[i] = v;
      this.changed.add(i);
    }
  }
  static supports(v: number) {
    return (v & F.EARTH) !== 0 || (v & FLUID) !== 0;
  }

  // ------------------------------------------------------------------ lemmos
  col(l: Lemmo) {
    return wrap(l.dir > 0 ? Math.floor(l.x) : Math.ceil(l.x) - 1);
  }
  private spawn(x: number, y: number, dir: number, type: number): Lemmo {
    const l: Lemmo = {
      id: this.nextId++, x, y: Math.round(y), dir, g: 1, type, climber: false, floater: false,
      state: 'falling', t: 0, cyc: 0, fallen: 0, umbrella: false, bricks: 0, empty: 0, bomb: null,
      inside: new Set(), blockCells: [],
    };
    this.lemmos.push(l);
    return l;
  }
  private setState(l: Lemmo, s: State) {
    if (l.state === 'blocking' && s !== 'blocking') this.unblock(l);
    l.state = s;
    l.t = 0;
    l.cyc = 0;
    if (s === 'falling') {
      l.fallen = 0;
      l.umbrella = false;
    }
    if (s === 'blocking') this.stampBlock(l);
    if (['building', 'bashing', 'mining', 'digging', 'blocking'].includes(s)) {
      l.x = this.col(l) + 0.5;
    }
  }
  private turn(l: Lemmo) {
    l.dir = -l.dir;
  }
  private stampBlock(l: Lemmo) {
    const c = Math.floor(l.x);
    for (let dx = -1; dx <= 1; dx++)
      for (let k = 0; k <= HEAD; k++) {
        const i = this.idx(c + dx, l.y + k * l.g);
        if (!this.block[i]) {
          this.block[i] = 1;
          l.blockCells.push(i);
        }
      }
  }
  private unblock(l: Lemmo) {
    for (const i of l.blockCells) this.block[i] = 0;
    l.blockCells = [];
  }
  get active() {
    return this.lemmos.filter((l) => l.type !== 3 && l.state !== 'dead' && l.state !== 'saved');
  }
  get remainingToRelease() {
    return this.entrances.reduce((s, e) => s + e.left, 0);
  }

  // ------------------------------------------------------------------ player actions
  canAssign(l: Lemmo, skill: Skill): boolean {
    if (l.type === 3 || DYING.includes(l.state) || (this.skills[skill] ?? 0) <= 0) return false;
    switch (skill) {
      case 'climber': return !l.climber;
      case 'floater': return !l.floater;
      case 'bomber': return l.bomb === null;
      default: {
        const states: Record<string, State> = {
          blocker: 'blocking', builder: 'building', basher: 'bashing', miner: 'mining', digger: 'digging',
        };
        if (!GROUND_SKILL_STATES.includes(l.state) || l.state === states[skill]) return false;
        if (skill === 'digger' && this.get(this.col(l), l.y - l.g) & (F.WATER | F.ACID)) return false;
        return true;
      }
    }
  }
  assign(l: Lemmo, skill: Skill): boolean {
    if (!this.canAssign(l, skill)) return false;
    this.skills[skill]--;
    switch (skill) {
      case 'climber': l.climber = true; break;
      case 'floater': l.floater = true; break;
      case 'bomber': l.bomb = BOMB_TIME; break;
      case 'blocker': this.setState(l, 'blocking'); break;
      case 'builder': l.bricks = BRICKS; this.setState(l, 'building'); break;
      case 'basher': l.empty = 0; this.setState(l, 'bashing'); break;
      case 'miner': this.setState(l, 'mining'); break;
      case 'digger': this.setState(l, 'digging'); break;
    }
    this.events.push({ kind: 'sound', name: 'action' });
    return true;
  }
  adjustRelease(delta: number) {
    for (const e of this.entrances) e.rate = Math.max(e.min, Math.min(e.max, e.rate + delta));
  }
  nuke() {
    if (this.nuking || (this.skills.nuke ?? 1) <= 0) return;
    this.nuking = true;
    for (const e of this.entrances) e.left = 0;
    let i = 0;
    for (const l of this.active) if (l.bomb === null && !DYING.includes(l.state)) l.bomb = BOMB_TIME + 0.08 * i++;
    this.events.push({ kind: 'sound', name: 'ohno' });
  }

  // ------------------------------------------------------------------ tick
  step(dt: number) {
    if (this.finished) return;
    this.time += dt;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.release(dt);
    for (const [k, v] of this.trapCooldown) this.trapCooldown.set(k, v - dt);
    for (const l of this.lemmos) this.update(l, dt);
    for (let i = this.lemmos.length - 1; i >= 0; i--) {
      const s = this.lemmos[i].state;
      if (s === 'dead' || s === 'saved') this.lemmos.splice(i, 1);
    }
    const alive = this.active.length;
    if ((alive === 0 && this.remainingToRelease === 0) || this.timeLeft <= 0) this.finished = true;
  }

  private release(dt: number) {
    if (this.startDelay > 0) {
      this.startDelay -= dt;
      if (this.startDelay <= 0) this.events.push({ kind: 'sound', name: 'door' });
      return;
    }
    for (const e of this.entrances) {
      if (e.left <= 0) continue;
      e.timer -= dt;
      if (e.timer <= 0) {
        e.timer += RELEASE_INTERVAL[Math.max(1, Math.min(99, e.rate)) - 1];
        e.left--;
        this.spawn(e.x + 0.5, e.y, e.dir, e.type);
      }
    }
  }

  private update(l: Lemmo, dt: number) {
    l.t += dt;
    if (l.bomb !== null && !DYING.includes(l.state)) {
      l.bomb -= dt;
      if (l.bomb <= 0) {
        l.bomb = null;
        this.setState(l, 'ohno');
        this.events.push({ kind: 'sound', name: 'ohno' });
      }
    }
    switch (l.state) {
      case 'walking': this.walk(l, dt); break;
      case 'falling': this.fall(l, dt); break;
      case 'climbing': this.climb(l, dt); break;
      case 'flipping': if (l.t > 0.35) this.setState(l, 'walking'); break;
      case 'blocking':
        if (!Sim.supports(this.terrain(this.col(l), l.y - l.g))) this.setState(l, 'falling');
        break;
      case 'building': this.build(l, dt); break;
      case 'shrugging': if (l.t > 0.5) this.setState(l, 'walking'); break;
      case 'bashing': this.bash(l, dt); break;
      case 'mining': this.mine(l, dt); break;
      case 'digging': this.dig(l, dt); break;
      case 'ohno': if (l.t > 0.9) this.explode(l); break;
      case 'drowning': if (l.t > 1.2) this.kill(l); break;
      case 'burning': if (l.t > 0.8) this.kill(l); break;
      case 'splatting': if (l.t > 0.7) this.kill(l); break;
      case 'trapped': if (l.t > 0.5) this.kill(l); break;
      case 'exiting':
        if (l.t > 0.8) {
          l.state = 'saved';
          this.saved++;
        }
        break;
    }
    if (!DYING.includes(l.state)) this.environment(l);
  }

  private kill(l: Lemmo) {
    l.state = 'dead';
    this.unblock(l);
    if (l.type !== 3) this.died++;
  }

  // ---- walking (FUN_0041bdd4 / FUN_0041bffc)
  private walk(l: Lemmo, dt: number) {
    let rem = dt;
    while (rem > 1e-9 && l.state === 'walking') {
      const target = nextInt(l.x, l.dir);
      const need = Math.abs(target - l.x) / WALK_SPEED;
      if (rem < need) {
        const nx = l.x + l.dir * WALK_SPEED * rem;
        l.x = l.dir > 0 ? Math.min(nx, target - 1e-7) : Math.max(nx, target + 1e-7);
        break;
      }
      l.x = target;
      rem -= need;
      this.stepCheck(l);
      l.x = wrap(l.x);
    }
    l.x = wrap(l.x);
  }

  private stepCheck(l: Lemmo) {
    const X = Math.round(l.x);
    const c = l.dir > 0 ? X : X - 1;
    const { y, g } = l;
    const rat = l.type === 3;
    const feet = this.get(c, y, rat);
    if (feet & F.BARRIER && !rat) return this.turn(l);
    if (!(feet & F.EARTH)) {
      if (!Sim.supports(this.get(c, y - g, rat))) {
        if (Sim.supports(this.get(c, y - 2 * g, rat))) l.y = y - g;
        else if (Sim.supports(this.get(c, y - 3 * g, rat))) l.y = y - 2 * g;
        else this.setState(l, 'falling');
      }
      return;
    }
    if (!(this.get(c, y + g, rat) & F.EARTH)) {
      l.y = y + g;
      return;
    }
    const up2 = this.get(c, y + 2 * g, rat);
    if (up2 & F.BARRIER && !rat) return this.turn(l);
    if (!(up2 & F.EARTH)) {
      l.y = y + 2 * g;
      return;
    }
    if (l.climber) this.setState(l, 'climbing');
    else this.turn(l);
  }

  // ---- falling (FUN_004160bd, landing FUN_00416433)
  private fall(l: Lemmo, dt: number) {
    let rem = dt;
    while (l.state === 'falling') {
      const c = this.col(l);
      if (isInt(l.y)) {
        if (l.y <= 0 || l.y >= this.rows - 1) {
          this.events.push({ kind: 'sound', name: 'die' });
          return this.kill(l);
        }
        const below = this.get(c, l.y - l.g, l.type === 3);
        if (Sim.supports(below)) return this.land(l, below);
      }
      if (rem <= 1e-9) break;
      const speed = l.umbrella ? FLOAT_SPEED : FALL_SPEED;
      const target = nextInt(l.y, -l.g);
      const need = Math.abs(target - l.y) / speed;
      if (rem < need) {
        const ny = l.y - l.g * speed * rem;
        l.y = l.g > 0 ? Math.max(ny, target + 1e-7) : Math.min(ny, target - 1e-7);
        break;
      }
      l.y = target;
      rem -= need;
      l.fallen++;
      if (l.floater && l.fallen >= UMBRELLA_AT && !l.umbrella) l.umbrella = true;
    }
  }

  private land(l: Lemmo, below: number) {
    const safeFluid = (l.type === 1 && below & F.WATER) || (l.type === 2 && below & F.ACID);
    if (l.fallen > SPLAT_ROWS && !l.floater && !safeFluid) {
      this.setState(l, 'splatting');
      this.events.push({ kind: 'sound', name: 'fallsplat' });
      this.events.push({ kind: 'burst', x: l.x, y: l.y, style: 'splash', n: 14 });
    } else {
      this.setState(l, 'walking');
    }
  }

  // ---- climbing (FUN_004137ca / FUN_004139bf)
  private climb(l: Lemmo, dt: number) {
    let rem = dt;
    const X = Math.round(l.x);
    const wall = l.dir > 0 ? X : X - 1;
    const body = l.dir > 0 ? X - 1 : X;
    while (rem > 1e-9 && l.state === 'climbing') {
      const target = nextInt(l.y, l.g);
      const need = Math.abs(target - l.y) / CLIMB_SPEED;
      if (rem < need) {
        const ny = l.y + l.g * CLIMB_SPEED * rem;
        l.y = l.g > 0 ? Math.min(ny, target - 1e-7) : Math.max(ny, target + 1e-7);
        break;
      }
      l.y = target;
      rem -= need;
      if (l.y <= 0 || l.y >= this.rows - 2 || this.get(body, l.y + HEAD * l.g) & F.EARTH) {
        // "Climber hit head"
        this.turn(l);
        this.setState(l, 'falling');
        return;
      }
      if (!(this.get(wall, l.y) & F.EARTH)) {
        // "Climber topping out" -> flip over the edge
        this.setState(l, 'flipping');
        return;
      }
    }
  }

  // ---- builder (FUN_0040f8d1: brick at step 81, climb at step 90)
  private build(l: Lemmo, dt: number) {
    const prev = l.cyc;
    l.cyc += dt;
    const c = this.col(l);
    if (prev < 0.81 && l.cyc >= 0.81) {
      for (let k = 1; k <= 2; k++) this.setCell(c + k * l.dir, l.y, this.terrain(c + k * l.dir, l.y) | F.EARTH);
      l.bricks--;
      if (l.bricks < 4) this.events.push({ kind: 'sound', name: 'chink' });
    }
    if (prev < 0.9 && l.cyc >= 0.9) {
      const nc = c + 2 * l.dir;
      if (this.get(c + l.dir, l.y + (HEAD + 1) * l.g) & F.EARTH || this.get(nc, l.y + (HEAD + 1) * l.g) & F.EARTH) {
        this.turn(l);
        this.setState(l, 'walking');
        return;
      }
      l.x = wrap(l.x + 2 * l.dir);
      l.y += l.g;
      if (l.bricks <= 0) {
        this.setState(l, 'shrugging');
        return;
      }
    }
    if (l.cyc >= CYCLE) l.cyc -= CYCLE;
  }

  private blocks(v: number, dir: number) {
    return (v & F.EARTH) !== 0 && (v & (F.METAL | F.BARRIER | (dir > 0 ? F.ONEWAY_R : F.ONEWAY_L))) !== 0;
  }

  // ---- basher (FUN_0040bba0: 4-row tunnel, one column per cycle)
  private bash(l: Lemmo, dt: number) {
    const prev = l.cyc;
    l.cyc += dt;
    const c = Math.floor(l.x);
    if (prev < 0.15 && l.cyc >= 0.15) {
      const tc = c + l.dir;
      let removed = 0;
      for (let k = 0; k < 4; k++) {
        const v = this.terrain(tc, l.y + k * l.g);
        if (this.blocks(v, l.dir)) {
          this.events.push({ kind: 'sound', name: 'chink' }, { kind: 'burst', x: tc + 0.5, y: l.y + k, style: 'spark', n: 6 });
          this.setState(l, 'walking');
          return;
        }
      }
      for (let k = 0; k < 4; k++) {
        const y = l.y + k * l.g;
        if (this.terrain(tc, y) & F.EARTH) {
          this.setCell(tc, y, 0);
          removed++;
        }
      }
      if (removed) this.events.push({ kind: 'burst', x: tc + 0.5, y: l.y + 2 * l.g, style: 'dirt', n: removed * 2 });
      l.empty = removed ? 0 : l.empty + 1;
      if (l.empty >= 2) {
        this.setState(l, 'walking');
        return;
      }
    }
    if (l.cyc >= CYCLE) {
      l.cyc -= CYCLE;
      l.x = wrap(c + l.dir + 0.5);
      if (!Sim.supports(this.get(Math.floor(l.x), l.y - l.g))) this.setState(l, 'falling');
    }
  }

  // ---- miner (FUN_00418470: carve rows -1..3 ahead, then step diagonally down)
  private mine(l: Lemmo, dt: number) {
    const prev = l.cyc;
    l.cyc += dt;
    const c = Math.floor(l.x);
    const tc = c + l.dir;
    if (prev < 0.2 && l.cyc >= 0.2) {
      for (let k = -1; k <= 3; k++) {
        if (this.blocks(this.terrain(tc, l.y + k * l.g), l.dir)) {
          this.events.push({ kind: 'sound', name: 'minemetal' }, { kind: 'burst', x: tc + 0.5, y: l.y, style: 'spark', n: 6 });
          this.setState(l, 'walking');
          return;
        }
      }
      for (let k = -1; k <= 3; k++) {
        const y = l.y + k * l.g;
        if (this.terrain(tc, y) & F.EARTH) this.setCell(tc, y, 0);
      }
      this.events.push({ kind: 'sound', name: 'mine' }, { kind: 'burst', x: tc + 0.5, y: l.y, style: 'dirt', n: 8 });
    }
    if (prev < 0.68 && l.cyc >= 0.68) {
      l.x = wrap(tc + 0.5);
      l.y -= l.g;
      if (!Sim.supports(this.get(tc, l.y - l.g))) {
        this.setState(l, 'falling');
        return;
      }
    }
    if (l.cyc >= CYCLE) l.cyc -= CYCLE;
  }

  // ---- digger (FUN_00415850: 3 cells wide, one row per cycle)
  private dig(l: Lemmo, dt: number) {
    const prev = l.cyc;
    l.cyc += dt;
    if (prev < 0.25 && l.cyc >= 0.25) {
      const c = Math.floor(l.x);
      const y = l.y - l.g;
      const noDig = l.g > 0 ? F.NODIG_DOWN : F.NODIG_UP;
      let any = false;
      for (let dx = -1; dx <= 1; dx++) {
        const v = this.terrain(c + dx, y);
        if (v & F.EARTH && v & (F.METAL | noDig)) {
          this.events.push({ kind: 'sound', name: 'chink' }, { kind: 'burst', x: c + 0.5, y, style: 'spark', n: 6 });
          this.setState(l, 'walking');
          return;
        }
        if (v & F.EARTH) any = true;
      }
      if (!any) {
        this.setState(l, 'falling');
        return;
      }
      for (let dx = -1; dx <= 1; dx++) if (this.terrain(c + dx, y) & F.EARTH) this.setCell(c + dx, y, 0);
      this.events.push({ kind: 'burst', x: c + 0.5, y, style: 'dirt', n: 6 });
      l.y = y;
    }
    if (l.cyc >= CYCLE) l.cyc -= CYCLE;
  }

  // ---- bomber explosion (FUN_0043f510, 7x7 disc, spares metal / water / barriers)
  private explode(l: Lemmo) {
    const c = Math.floor(l.x);
    for (let r = 0; r < 7; r++)
      for (let q = 0; q < 7; q++) {
        if (BLAST[r][q] !== '#') continue;
        const x = c - 3 + q;
        const y = l.y + 3 - r;
        const v = this.terrain(x, y);
        if (v & (F.METAL | F.WATER | F.BARRIER)) continue;
        if (v & F.EARTH) this.setCell(x, y, 0);
      }
    this.events.push({ kind: 'sound', name: 'explode' }, { kind: 'burst', x: l.x, y: l.y + 1, style: 'blast', n: 40 });
    this.kill(l);
  }

  // ---- interactions with fluids, exits, traps, triggers, rats
  private inBox(l: Lemmo, f: Footprint, pad = 0) {
    const w = f.max[0] - f.min[0] + 2 * pad;
    const dx = wrap(l.x - (f.min[0] - pad));
    return dx <= w + 1 && l.y >= f.min[1] - pad - 1 && l.y <= f.max[1] + pad;
  }

  private environment(l: Lemmo) {
    const c = this.col(l);
    const here = this.terrain(c, l.y);
    const below = this.terrain(c, l.y - l.g);
    const grounded = l.state !== 'falling' && l.state !== 'climbing';
    let fluid = here & FLUID;
    if (!fluid && grounded && !(below & F.EARTH)) fluid = below & FLUID;
    if (fluid) {
      if (fluid & F.LAVA) {
        this.setState(l, 'burning');
        this.events.push({ kind: 'sound', name: 'fire' }, { kind: 'burst', x: l.x, y: l.y, style: 'smoke', n: 12 });
        return;
      }
      const safe = (fluid & F.WATER && l.type === 1) || (fluid & F.ACID && l.type === 2);
      if (!safe) {
        this.setState(l, 'drowning');
        this.events.push({ kind: 'sound', name: fluid & F.ACID ? 'bubble' : 'glug2' }, { kind: 'burst', x: l.x, y: l.y, style: 'splash', n: 10 });
        return;
      }
    }
    if (l.type === 3) {
      for (const o of this.lemmos) {
        if (o.type === 3 || DYING.includes(o.state)) continue;
        const dx = Math.abs(wrap(o.x - l.x + 128) - 128);
        if (dx < 1.3 && Math.abs(o.y - l.y) < 3) {
          this.setState(o, 'trapped');
          this.events.push({ kind: 'sound', name: 'thud' }, { kind: 'burst', x: o.x, y: o.y + 1, style: 'spark', n: 8 });
        }
      }
      return;
    }
    if (l.state !== 'climbing') {
      for (const e of this.level.exits) {
        if (this.inBox(l, e)) {
          this.setState(l, 'exiting');
          this.events.push({ kind: 'sound', name: 'yippee' }, { kind: 'burst', x: l.x, y: l.y + 2, style: 'sparkle', n: 12 });
          return;
        }
      }
    }
    this.level.traps.forEach((t, i) => {
      if (DYING.includes(l.state) || (this.trapCooldown.get(i) ?? 0) > 0 || !this.inBox(l, t)) return;
      this.trapCooldown.set(i, 1.5);
      this.setState(l, 'trapped');
      this.events.push({ kind: 'sound', name: 'splat' }, { kind: 'burst', x: l.x, y: l.y + 1, style: 'splash', n: 16 });
    });
    if (DYING.includes(l.state)) return;
    this.level.triggers.forEach((t, i) => {
      if (t.kind !== 'antigrav') return;
      const key = 't' + i;
      const inside = this.inBox(l, t);
      if (inside && !l.inside.has(key)) {
        l.inside.add(key);
        l.g = -l.g;
        if (l.state !== 'blocking') this.setState(l, 'falling');
        this.events.push({ kind: 'sound', name: 'antigrav' }, { kind: 'burst', x: l.x, y: l.y, style: 'sparkle', n: 10 });
      } else if (!inside) l.inside.delete(key);
    });
    const tp = this.level.teleporters;
    tp.forEach((t, i) => {
      const key = 'p' + i;
      const inside = this.inBox(l, t);
      const partner = tp[i ^ 1];
      if (inside && !l.inside.has(key) && partner) {
        l.x = partner.pos[0] + 0.5;
        l.y = Math.round(partner.pos[1]);
        l.inside.add('p' + (i ^ 1));
        this.setState(l, 'falling');
        this.events.push({ kind: 'sound', name: 'teleport' }, { kind: 'burst', x: l.x, y: l.y + 1, style: 'sparkle', n: 16 });
      } else if (!inside) l.inside.delete(key);
    });
  }
}
