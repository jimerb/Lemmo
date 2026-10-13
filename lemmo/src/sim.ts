// Lemmo simulation — a re-implementation of the original game rules recovered from the
// original executable (docs/SPEC.md). Units: x = column (0..256, wraps), y = feet row (row 0 = bottom),
// time in seconds.
import {
  decodeCells, pathFromTrack, type Command, type DoorData, type FluidData, type Footprint, type LevelData, type PathData,
  type TrapData, type TriggerData,
} from './level.ts';

export const F = {
  EARTH: 0x1, METAL: 0x2, ONEWAY_R: 0x4, ONEWAY_L: 0x8, NODIG_DOWN: 0x10, NODIG_UP: 0x20,
  OBJ: 0x80, WATER: 0x200, DOOR: 0x400, BARRIER: 0x800, TRAMP: 0x1000, LAVA: 0x2000, ACID: 0x4000, SPIN: 0x8000,
};
export const FLUID = F.WATER | F.LAVA | F.ACID;

export const SKILLS = ['climber', 'floater', 'bomber', 'blocker', 'builder', 'basher', 'miner', 'digger'] as const;
/** The original's panel slot 9 "special skill" (EXE action ids 0xb..0x10). */
export const SPECIALS = ['rocket', 'cartwheel', 'trampoline', 'antigrav', 'slower', 'faster'] as const;
export const ALL_SKILLS = [...SKILLS, ...SPECIALS] as const;
export type Skill = (typeof ALL_SKILLS)[number];

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
export const ROCKET_FUSE = 5;     // countdown type 1 (FUN_0041a56c)
export const ROCKET_SPEED = 25;   // rows / s (DAT_004b0c40)
export const CARTWHEEL_SPEED = 2 * WALK_SPEED; // DAT_004b0d48 = 2
export const CARTWHEEL_TIME = 5;
export const SPEED_TIME = 5;      // Faster / Slower last 5 s (FUN_0041688c, FUN_0041ac9c)
export const BOUNCE_V = 35;       // bounce: h(t) = 35 t - 12.5 t² (FUN_0040eec4)
export const BOUNCE_G = 25;
export const DOOR_SPEED = 3;      // door slide, fraction per second (DAT_004bf6d0)
export const FLUID_RATE: Record<string, number> = { water: 2, lava: 0.5, acid: 1 }; // rows / s (FUN_00428848)

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
  | 'bashing' | 'mining' | 'digging' | 'rocketing' | 'cartwheeling' | 'trampoline' | 'bouncing'
  | 'teleporting' | 'ohno' | 'drowning' | 'burning' | 'splatting' | 'exiting' | 'trapped' | 'dead' | 'saved';

const DYING: State[] = ['teleporting', 'ohno', 'drowning', 'burning', 'splatting', 'exiting', 'trapped', 'dead', 'saved'];
const GROUND_SKILL_STATES: State[] = ['walking', 'building', 'bashing', 'mining', 'digging', 'shrugging', 'cartwheeling'];

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
  fuse: number | null;  // rocket countdown
  fast: number;     // seconds of Faster left (whole Lemmo runs at double speed)
  slow: number;     // seconds of Slower left (walking / climbing at half speed)
  spin: number;     // seconds left of the anti-gravity spin animation
  by: number;       // bounce: row the bounce started from
  tele: { to: number; timer: number } | null;
  inside: Set<string>;
  blockCells: number[];
  trampCells: number[];
}

export type SimEvent =
  | { kind: 'sound'; name: string }
  | { kind: 'burst'; x: number; y: number; style: 'dirt' | 'blast' | 'splash' | 'sparkle' | 'spark' | 'smoke'; n: number };

interface Entrance {
  x: number; y: number; dir: number; type: number;
  left: number; rate: number; min: number; max: number; timer: number;
}

/** Runtime state of a trigger (skill pad, lever, timed plate, anti-gravity zone, speed pad). */
export interface TriggerRt {
  t: TriggerData;
  active: boolean;
  state: number;
  timer: number;
  /** Anti-gravity zone without spinner cells (editor levels): flips Lemmo's entering the box. */
  legacy: boolean;
}

/** Runtime state of a sliding door. `prog` is 0 when open and 1 when closed. */
export interface DoorRt {
  d: DoorData;
  active: boolean;
  x0: number; x1: number; yTop: number; yBot: number;
  target: 1 | 2;    // 1 open, 2 closed
  cur: number;
  prog: number;
  goal: number;
  timer: number;
  count: number;
}

export interface FluidRt {
  f: FluidData;
  active: boolean;
  flag: number;
  level: number;
  target: number;   // 0 fill to levelA, 1 drain to levelB
  cur: number;
}

export interface TrapRt {
  t: TrapData;
  active: boolean;
  cooldown: number;
  flash: number;
  // moving traps
  moving: boolean;
  x: number;
  y: number;
  paths: (PathData | null)[];
  cur: number;
  want: number;
  seg: number;
  s: number;
  rev: boolean;
  box: Footprint;
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
  private tramp: Uint8Array;
  readonly changed = new Set<number>();
  readonly lemmos: Lemmo[] = [];
  readonly events: SimEvent[] = [];
  readonly entrances: Entrance[];
  readonly skills: Record<string, number>;
  readonly total: number;
  readonly triggers: TriggerRt[];
  readonly doors: DoorRt[];
  readonly fluids: FluidRt[];
  readonly traps: TrapRt[];
  /** Index of the teleporter each teleporter sends Lemmo's to (-1 = none). */
  readonly portalTo: number[];
  saved = 0;
  died = 0;
  time = 0;
  timeLeft: number;
  nuking = false;
  finished = false;
  private nextId = 1;
  private startDelay = 1.5;
  private objects = new Map<number, { on(): void; off(): void; set(a: number): void }>();

  readonly level: LevelData;

  constructor(level: LevelData) {
    this.level = level;
    this.rows = level.grid.rows;
    this.cells = decodeCells(level);
    this.block = new Uint8Array(this.cells.length);
    this.tramp = new Uint8Array(this.cells.length);
    this.timeLeft = level.timeLimit;
    this.skills = { ...level.skills };
    this.entrances = level.entrances.map((e) => ({
      x: e.spawn[0], y: e.spawn[1], dir: e.dir || 1, type: e.lemType, left: e.lemmos,
      rate: e.releaseRate, min: e.releaseRateMin, max: e.releaseRateMax, timer: 0,
    }));
    this.total = level.entrances.reduce((s, e) => s + e.lemmos, 0);

    this.fluids = (level.fluids ?? []).map((f) => this.initFluid(f));
    this.doors = (level.counters ?? []).filter((d) => d.rect?.length === 4).map((d) => this.initDoor(d));
    this.traps = level.traps.map((t) => this.initTrap(t));
    this.triggers = level.triggers.map((t) => ({
      t, active: t.active !== false, state: 0, timer: 0, legacy: t.kind === 'antigrav' && !this.hasSpin(t),
    }));
    // Teleporters link to their partner by object id; levels without ids pair up in file order.
    const tp = level.teleporters;
    this.portalTo = tp.map((t, i) => {
      if (typeof t.partner === 'number') {
        const j = tp.findIndex((o) => o.id === t.partner);
        if (j >= 0 && j !== i) return j;
      }
      return tp[i ^ 1] ? i ^ 1 : -1;
    });
    this.registerObjects();
    // Levers apply their starting position to whatever they control (vtable slot 10).
    for (const r of this.triggers) if (r.t.kind === 'kind1') this.setLever(r, r.t.value === 1 ? 1 : -1, null);

    for (const p of level.preplacedLemmos) {
      const l = this.spawn(p.pos[0], p.pos[1], p.dir || 1, p.type);
      l.g = p.gravity || 1;
      l.climber = p.climber;
      l.floater = p.floater;
      if (p.blocking) this.setState(l, 'blocking');
    }
    this.changed.clear();
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
    return this.cells[i] | (!rat && this.block[i] ? F.BARRIER : 0) | (this.tramp[i] ? F.TRAMP : 0);
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

  // ------------------------------------------------------------------ level objects
  private registerObjects() {
    const reg = (id: number | undefined, o: { on(): void; off(): void; set(a: number): void }) => {
      if (typeof id === 'number' && !this.objects.has(id)) this.objects.set(id, o);
    };
    for (const d of this.doors) reg(d.d.id, { on: () => (d.target = 1), off: () => (d.target = 2), set: () => {} });
    for (const f of this.fluids) reg(f.f.id, { on: () => (f.target = 0), off: () => (f.target = 1), set: () => {} });
    for (const t of this.traps) reg(t.t.id, {
      on: () => (t.active = true),
      off: () => (t.active = false),
      set: (a) => (t.want = a === 2 ? 1 - t.want : a ? 1 : 0),
    });
    for (const r of this.triggers) reg(r.t.id, { on: () => (r.active = true), off: () => (r.active = false), set: () => {} });
  }

  /** Execute a trigger command (FUN_00433b2e). `l` is the Lemmo that set the trigger off. */
  private run(cmd: Command, l: Lemmo | null) {
    const [target, op, a] = cmd;
    if (target === -2) {
      if (op === 6 && l && !DYING.includes(l.state)) {
        if (a === 1) this.speedUp(l);
        else if (a === 2) this.slowDown(l);
      }
      return;
    }
    const o = this.objects.get(target);
    if (!o) return;
    if (op === 4) o.on();
    else if (op === 5) o.off();
    else if (op === 0) o.set(a);
  }
  private runAll(cmds: Command[] | null | undefined, l: Lemmo | null) {
    for (const c of cmds ?? []) this.run(c, l);
  }

  private fluidBox(f: FluidData) {
    const x0 = Math.floor(f.min[0]);
    let x1 = Math.floor(f.max[0]);
    if (x1 < x0) x1 += 256;
    return { x0, x1, y0: Math.floor(f.min[1]) };
  }
  /** Set the fluid flag from the bottom of the box up to the current level (FUN_004311d0). */
  private stampFluid(r: FluidRt) {
    const { x0, x1, y0 } = this.fluidBox(r.f);
    const top = Math.floor(r.f.min[1] + r.level);
    for (let x = x0; x < x1; x++) for (let y = y0; y < top; y++) this.setCell(x, y, this.terrain(x, y) | r.flag);
  }
  private clearFluid(r: FluidRt) {
    const { x0, x1, y0 } = this.fluidBox(r.f);
    const top = Math.ceil(r.f.max[1]);
    for (let x = x0; x < x1; x++) for (let y = y0; y < top; y++) this.setCell(x, y, this.terrain(x, y) & ~r.flag);
  }
  private initFluid(f: FluidData): FluidRt {
    const flag = f.type === 'lava' ? F.LAVA : f.type === 'acid' ? F.ACID : F.WATER;
    const mode = f.mode ?? 0;
    const levelA = f.levelA ?? f.max[1] - f.min[1];
    const r: FluidRt = { f: { ...f, levelA, levelB: f.levelB ?? 0 }, active: f.active !== false, flag, level: 0, target: mode, cur: 2 };
    if (mode === 1) {
      // starts drained: the level file has the full volume baked into the grid
      r.level = r.f.levelB!;
      this.clearFluid(r);
    } else {
      r.level = levelA;
      this.stampFluid(r);
    }
    r.cur = mode;
    return r;
  }
  private stepFluid(r: FluidRt, dt: number) {
    if (r.target === r.cur) return;
    const rate = FLUID_RATE[r.f.type] ?? 1;
    const before = Math.floor(r.level);
    if (r.target === 0) {
      r.level = Math.min(r.f.levelA!, r.level + rate * dt);
      if (r.level >= r.f.levelA!) r.cur = 0;
      if (Math.floor(r.level) !== before || r.cur === 0) this.stampFluid(r);
    } else {
      r.level = Math.max(r.f.levelB!, r.level - rate * dt);
      if (r.level <= r.f.levelB!) r.cur = 1;
      if (Math.floor(r.level) !== before || r.cur === 1) {
        this.clearFluid(r);
        this.stampFluid(r);
      }
    }
    if (Math.floor(r.level) !== before && this.time > 0.1) this.events.push({ kind: 'sound', name: 'rumble' });
  }

  private initDoor(d: DoorData): DoorRt {
    const [x0, x1, yTop, yBot] = d.rect;
    const r: DoorRt = {
      d, active: d.active !== false, x0, x1, yTop, yBot,
      target: d.open ? 1 : 2, cur: d.open ? 1 : 2, prog: d.open ? 0 : 1, goal: d.open ? 0 : 1, timer: 0, count: 0,
    };
    this.paintDoor(r, !d.open);
    return r;
  }
  /** Closed doors are solid metal (cells |= 0x403, FUN_00427554); open ones are cleared. */
  private paintDoor(r: DoorRt, solid: boolean) {
    const bits = F.EARTH | F.METAL | F.DOOR;
    for (let x = r.x0; x < r.x1; x++)
      for (let y = r.yBot; y < r.yTop; y++) this.setCell(x, y, solid ? this.terrain(x, y) | bits : this.terrain(x, y) & ~bits);
  }
  private inDoor(r: DoorRt, x: number, y: number) {
    const dx = wrap(x - r.x0);
    return dx < r.x1 - r.x0 && y >= r.yBot && y < r.yTop;
  }
  /** Counting doors close once enough Lemmo's have gone through (FUN_00423858). */
  private countDoor(r: DoorRt) {
    const key = 'd' + r.d.id;
    for (const l of this.lemmos) {
      if (l.type === 3 || DYING.includes(l.state)) continue;
      const inside = this.inDoor(r, l.x, l.y);
      if (inside && !l.inside.has(key)) {
        l.inside.add(key);
        const dec = r.d.mode === 1 ? r.d.countDir === l.g : r.d.countDir === -l.dir;
        r.count += dec ? -1 : 1;
        if (r.count === r.d.count) {
          // close once this Lemmo is through
          r.timer = r.d.mode === 1 ? (r.yTop - r.yBot + 0.2) / FALL_SPEED : (r.x1 - r.x0 + 0.2) / WALK_SPEED;
        }
      } else if (!inside) l.inside.delete(key);
    }
    return r.count >= r.d.count;
  }
  private stepDoor(r: DoorRt, dt: number) {
    // slide toward the goal (FUN_004270dc)
    if (r.prog !== r.goal) {
      const closing = r.goal > r.prog;
      r.prog = closing ? Math.min(r.goal, r.prog + dt * DOOR_SPEED) : Math.max(r.goal, r.prog - dt * DOOR_SPEED);
      if (r.prog === r.goal) this.paintDoor(r, closing);
      else if (closing) {
        for (const l of this.lemmos) {
          if (l.type === 3 || DYING.includes(l.state) || !this.inDoor(r, l.x, l.y)) continue;
          this.setState(l, 'trapped'); // caught by the closing door
          this.events.push({ kind: 'sound', name: 'thud' }, { kind: 'burst', x: l.x, y: l.y + 1, style: 'spark', n: 10 });
        }
      }
    }
    if (r.d.mode > 0 && r.d.mode < 3 && r.cur === 1 && this.countDoor(r)) r.target = 2;
    if (r.target !== r.cur) {
      r.timer -= dt;
      if (r.timer <= 0) {
        r.timer = 0;
        r.goal = r.target === 1 ? 0 : 1;
        if (r.target === 1) r.count = 0;
        r.cur = r.target;
        if (this.time > 0.1) this.events.push({ kind: 'sound', name: 'forcef' });
      }
    }
  }

  private initTrap(t: TrapData): TrapRt {
    const paths = this.level.paths ?? [];
    const own = t.track && t.track.length >= 1 ? pathFromTrack(t.track, t.loop) : null;
    const moving = t.cls === 'DYNA' && (!!own || (typeof t.path === 'number' && !!paths[t.path]));
    const r: TrapRt = {
      t, active: t.active !== false, cooldown: 0, flash: 0, moving,
      x: t.pos[0], y: t.pos[1],
      paths: own ? [own, null] : [paths[t.path ?? -1] ?? null, paths[t.path2 ?? -1] ?? null],
      cur: 0, want: 0, seg: t.seg ?? 0, s: t.s ?? 0, rev: !!t.reverse,
      box: { pos: [...t.pos], min: [...t.min], max: [...t.max], id: t.id },
    };
    if (moving) this.placeTrap(r);
    return r;
  }
  private pathOf(r: TrapRt) {
    return r.paths[r.cur];
  }
  /** Move along the polyline (FUN_00451997): open paths ping-pong, closed paths loop. */
  private normalizePath(r: TrapRt) {
    const p = this.pathOf(r)!;
    const n = p.keys.length;
    if (n <= 1) {
      r.seg = 0;
      r.s = 0;
      return;
    }
    r.seg = Math.max(0, Math.min(n - 1, r.seg));
    for (let guard = 0; r.s < 0 && guard < 1000; guard++) {
      if (r.seg === 0) {
        if (!p.closed) {
          r.rev = false;
          r.s = -r.s;
          break;
        }
        r.seg = n - 1;
      } else r.seg--;
      r.s += p.keys[r.seg].len;
    }
    for (let guard = 0; p.keys[r.seg].len < r.s && guard < 1000; guard++) {
      r.s -= p.keys[r.seg].len;
      if (!p.closed) {
        if (r.seg >= n - 2) {
          r.rev = true;
          r.s = p.keys[r.seg].len - r.s;
        } else r.seg++;
      } else r.seg = r.seg === n - 1 ? 0 : r.seg + 1;
    }
  }
  private placeTrap(r: TrapRt) {
    this.normalizePath(r);
    const k = this.pathOf(r)!.keys[r.seg];
    const s = this.pathOf(r)!.keys.length <= 1 ? 0 : r.s;
    r.x = wrap(k.p[0] + k.v[0] * s);
    r.y = k.p[1] + k.v[1] * s;
    const b = r.t.box ?? [-1, -2, 3, 3];
    r.box.pos = [r.x, r.y, 0.5];
    r.box.min = [r.x + b[0], r.y + b[1], 0];
    r.box.max = [r.x + b[2], r.y + b[3], 1];
  }
  /** Switch to the other path at a junction (FUN_004245f1, simplified to junction-index matching). */
  private switchPath(r: TrapRt) {
    const from = this.pathOf(r), to = r.paths[r.want];
    if (!to) return;
    if (!from || from.keys.length <= 1) {
      r.cur = r.want;
      r.seg = to.junctions[0] ?? 0;
      r.s = 0;
      return;
    }
    const j = from.junctions.indexOf(r.seg);
    if (j < 0) return;
    r.cur = r.want;
    r.seg = to.junctions[j] ?? to.junctions[0] ?? 0;
    r.s = 0;
  }
  /** Deathrollers carve a path through earth and turn back at metal (FUN_0042478f). */
  private carveTrap(r: TrapRt) {
    const p = this.pathOf(r);
    if (!p) return;
    const k = p.keys[Math.min(r.seg, p.keys.length - 1)];
    const n = k.n ^ (r.rev ? 1 : 0);
    const { min, max } = r.box;
    let hitMetal = false;
    let removed = 0;
    const cut = (x: number, y: number) => {
      const v = this.terrain(x, y);
      if (v & F.METAL && v & F.EARTH) return false;
      if (v & F.EARTH) {
        this.setCell(x, y, 0);
        removed++;
      }
      return true;
    };
    if (!(n & 2)) {
      const x = Math.floor(n & 1 ? max[0] : min[0]);
      for (let y = Math.floor(min[1]) + 1; y <= Math.floor(max[1]); y++) if (!cut(x, y)) { hitMetal = true; break; }
    } else {
      const y = Math.floor(n & 1 ? max[1] : min[1]);
      // a roller moving down rests on the floor row; only rising rollers cut their leading row fully
      if (n & 1 || y > Math.floor(min[1])) for (let x = Math.floor(min[0]); x <= Math.floor(max[0]); x++) if (!cut(x, y)) { hitMetal = true; break; }
    }
    if (removed) this.events.push({ kind: 'burst', x: r.x, y: r.y, style: 'dirt', n: Math.min(12, removed * 2) });
    if (hitMetal && p.keys.length > 1) r.rev = !r.rev;
  }
  private stepTrap(r: TrapRt, dt: number) {
    r.flash = Math.max(0, r.flash - dt);
    r.cooldown = Math.max(0, r.cooldown - dt);
    if (!r.active) return;
    if (r.moving && this.pathOf(r)) {
      this.carveTrap(r);
      const seg = r.seg, rev = r.rev;
      if (this.pathOf(r)!.keys.length > 1) r.s += (r.rev ? -1 : 1) * (r.t.speed ?? 1) * dt;
      this.placeTrap(r);
      if (r.cur !== r.want && (r.seg !== seg || r.rev !== rev || this.pathOf(r)!.keys.length <= 1)) {
        this.switchPath(r);
        this.placeTrap(r);
      }
    }
    if (r.cooldown > 0) return;
    // traps with an attack animation catch one Lemmo per attack; the others catch everyone inside
    const hasAttack = r.t.name !== '';
    let caught = 0;
    for (const l of this.lemmos) {
      if (l.type === 3 || DYING.includes(l.state) || !this.inBox(l, r.box)) continue;
      this.setState(l, 'trapped');
      this.events.push({ kind: 'sound', name: 'splat' }, { kind: 'burst', x: l.x, y: l.y + 1, style: 'splash', n: 16 });
      caught++;
      if (!r.t.killAll && (hasAttack || !r.moving)) break;
    }
    if (caught) {
      r.flash = 0.6;
      if (hasAttack || !r.moving) r.cooldown = 1.5;
      if (r.t.oneShot) r.active = false;
    }
  }

  // ---- triggers (vtables 0x4b1148 pad, 0x4b1288 lever, 0x4b12b4 timed plate, 0x4b1178 speed pad)
  private contains(f: Footprint, x: number, y: number) {
    const dx = wrap(x - f.min[0]);
    return dx <= f.max[0] - f.min[0] && y >= f.min[1] && y <= f.max[1];
  }
  private hasSpin(t: TriggerData) {
    for (let x = Math.floor(t.min[0]) - 2; x <= Math.ceil(t.max[0]) + 2; x++)
      for (let y = Math.floor(t.min[1]) - 2; y <= Math.ceil(t.max[1]) + 2; y++)
        if (y >= 0 && y < this.rows && this.terrain(x, y) & F.SPIN) return true;
    return false;
  }
  private setLever(r: TriggerRt, dir: number, l: Lemmo | null) {
    r.state = dir;
    this.runAll(dir === 1 ? r.t.rects2 : r.t.rects, l);
  }
  private candidates(r: TriggerRt) {
    return this.lemmos.filter((l) => l.type !== 3 && !DYING.includes(l.state) && this.contains(r.t, l.x, l.y));
  }
  /** Base trigger update (FUN_004339fc): idle hook while the cooldown is over, fire when someone is there. */
  private stepTrigger(r: TriggerRt, dt: number) {
    const t = r.t;
    if (t.kind === 'antigrav') return;
    if (r.timer <= 0) this.idle(r);
    else r.timer -= dt;
    if (r.timer > 0) return;
    let who: Lemmo[] = [];
    switch (t.kind) {
      case 'skill_pad': who = this.candidates(r).slice(0, 1); break;
      case 'kind1': who = this.candidates(r).filter((l) => l.dir === (r.state === 1 ? -1 : 1)).slice(0, 1); break;
      case 'kind2': who = this.candidates(r).slice(0, 1); break;
      case 'kind4': who = this.candidates(r).filter((l) => (!t.dir || l.dir === t.dir) && l.g === (t.flag ? -1 : 1)); break;
    }
    if (!who.length) return;
    r.timer = t.delay ?? 0;
    switch (t.kind) {
      case 'skill_pad':
        if (r.state !== 1) {
          r.state = 1;
          this.runAll(t.rects, who[0]);
          this.events.push({ kind: 'sound', name: 'lever' });
        }
        break;
      case 'kind1':
        this.setLever(r, who[0].dir, who[0]);
        this.events.push({ kind: 'sound', name: 'lever' });
        break;
      case 'kind2':
        if (r.state !== 1) {
          r.state = 1;
          this.runAll(t.rects, who[0]);
          this.events.push({ kind: 'sound', name: 'lever' });
        }
        break;
      case 'kind4':
        if (r.state !== 1) {
          r.state = 1;
          for (const l of who) if (t.cmd) this.run(t.cmd, l);
        }
        break;
    }
  }
  private idle(r: TriggerRt) {
    if (r.t.kind === 'kind2' && r.state !== 2) {
      r.state = 2;
      this.runAll(r.t.rects2, null);
    } else if (r.t.kind === 'kind4') r.state = 0;
  }

  // ------------------------------------------------------------------ lemmos
  col(l: Lemmo) {
    return wrap(l.dir > 0 ? Math.floor(l.x) : Math.ceil(l.x) - 1);
  }
  private spawn(x: number, y: number, dir: number, type: number): Lemmo {
    const l: Lemmo = {
      id: this.nextId++, x, y: Math.round(y), dir, g: 1, type, climber: false, floater: false,
      state: 'falling', t: 0, cyc: 0, fallen: 0, umbrella: false, bricks: 0, empty: 0, bomb: null,
      fuse: null, fast: 0, slow: 0, spin: 0, by: 0, tele: null, inside: new Set(), blockCells: [], trampCells: [],
    };
    this.lemmos.push(l);
    return l;
  }
  private setState(l: Lemmo, s: State) {
    if (l.state === 'blocking' && s !== 'blocking') this.unblock(l);
    if (l.state === 'trampoline' && s !== 'trampoline') this.unblock(l);
    l.state = s;
    l.t = 0;
    l.cyc = 0;
    if (s === 'falling') {
      l.fallen = 0;
      l.umbrella = false;
    }
    if (s === 'blocking') this.stampBlock(l);
    if (['building', 'bashing', 'mining', 'digging', 'blocking', 'trampoline'].includes(s)) {
      l.x = this.col(l) + 0.5;
    }
    if (s === 'trampoline') this.stampTrampoline(l);
    if (s === 'bouncing') l.by = l.y;
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
  /** A trampoline Lemmo is a one-column barrier with a springy top (FUN_0041b838: 0x882 / 0x1082). */
  private stampTrampoline(l: Lemmo) {
    const c = Math.floor(l.x);
    for (let k = 0; k <= HEAD + 1; k++) {
      const i = this.idx(c, l.y + k * l.g);
      if (!this.block[i]) {
        this.block[i] = 1;
        l.blockCells.push(i);
      }
    }
    // the springy surface is widened to three columns so a falling Lemmo of normal width can hit it
    for (let dx = -1; dx <= 1; dx++) {
      const i = this.idx(c + dx, l.y + l.g);
      if (!this.tramp[i] && !(this.cells[i] & F.EARTH)) {
        this.tramp[i] = 1;
        l.trampCells.push(i);
      }
    }
  }
  private unblock(l: Lemmo) {
    for (const i of l.blockCells) this.block[i] = 0;
    for (const i of l.trampCells) this.tramp[i] = 0;
    l.blockCells = [];
    l.trampCells = [];
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
    if (l.state === 'rocketing' || l.state === 'bouncing') return false;
    switch (skill) {
      case 'climber': return !l.climber;
      case 'floater': return !l.floater;
      case 'bomber': return l.bomb === null;
      // FUN_0045a0e0 slot 8: rocket/cartwheel need a free walker, trampoline anyone on the ground
      case 'rocket': return l.fuse === null && GROUND_SKILL_STATES.includes(l.state);
      case 'cartwheel': return l.state !== 'cartwheeling' && GROUND_SKILL_STATES.includes(l.state);
      case 'trampoline': return GROUND_SKILL_STATES.includes(l.state);
      case 'antigrav': case 'slower': case 'faster':
        return GROUND_SKILL_STATES.includes(l.state) || l.state === 'blocking';
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
      case 'rocket': l.fuse = ROCKET_FUSE; break;
      case 'cartwheel': this.setState(l, 'cartwheeling'); break;
      case 'trampoline': this.setState(l, 'trampoline'); break;
      case 'antigrav': this.flip(l); break;
      case 'slower': this.slowDown(l); break;
      case 'faster': this.speedUp(l); break;
    }
    this.events.push({ kind: 'sound', name: 'action' });
    return true;
  }
  private speedUp(l: Lemmo) {
    if (l.fast <= 0) this.events.push({ kind: 'sound', name: 'speedpad' });
    l.fast = SPEED_TIME;
    l.slow = 0;
  }
  private slowDown(l: Lemmo) {
    if (l.slow <= 0) this.events.push({ kind: 'sound', name: 'speedpad' });
    l.slow = SPEED_TIME;
    l.fast = 0;
  }
  /** Reverse gravity (FUN_0042f5e3) with the spinning animation. */
  private flip(l: Lemmo) {
    l.g = -l.g;
    l.spin = 0.6;
    if (l.state !== 'blocking') this.setState(l, 'falling');
    this.events.push({ kind: 'sound', name: 'antigrav' }, { kind: 'burst', x: l.x, y: l.y, style: 'sparkle', n: 10 });
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
    for (const r of this.triggers) if (r.active) this.stepTrigger(r, dt);
    for (const r of this.doors) if (r.active) this.stepDoor(r, dt);
    for (const r of this.fluids) if (r.active) this.stepFluid(r, dt);
    for (const r of this.traps) this.stepTrap(r, dt);
    for (const l of this.lemmos) {
      this.update(l, dt);
      // Faster runs the whole Lemmo twice per frame (FUN_0042e2bf, speedMod 2)
      if (l.fast > 0) {
        l.fast -= dt;
        if (!DYING.includes(l.state)) this.update(l, dt);
      }
      if (l.slow > 0) l.slow -= dt;
      if (l.spin > 0) l.spin -= dt;
    }
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
    if (!DYING.includes(l.state)) {
      if (l.bomb !== null) {
        l.bomb -= dt;
        if (l.bomb <= 0) {
          l.bomb = null;
          this.setState(l, 'ohno');
          this.events.push({ kind: 'sound', name: 'ohno' });
        }
      }
      if (l.fuse !== null && l.state !== 'ohno') {
        l.fuse -= dt;
        if (l.fuse <= 0) {
          l.fuse = null;
          this.setState(l, 'rocketing');
          this.events.push({ kind: 'sound', name: 'rocket' }, { kind: 'burst', x: l.x, y: l.y, style: 'smoke', n: 14 });
        }
      }
    }
    const slow = l.slow > 0 ? 0.5 : 1;
    switch (l.state) {
      case 'walking': this.walk(l, dt * slow); break;
      case 'falling': this.fall(l, dt); break;
      case 'climbing': this.climb(l, dt * slow); break;
      case 'flipping': if (l.t > 0.35) this.setState(l, 'walking'); break;
      case 'blocking':
      case 'trampoline':
        if (!Sim.supports(this.terrain(this.col(l), l.y - l.g))) this.setState(l, 'falling');
        break;
      case 'building': this.build(l, dt); break;
      case 'shrugging': if (l.t > 0.5) this.setState(l, 'walking'); break;
      case 'bashing': this.bash(l, dt); break;
      case 'mining': this.mine(l, dt); break;
      case 'digging': this.dig(l, dt); break;
      case 'rocketing': this.rocket(l, dt); break;
      case 'cartwheeling': this.cartwheel(l, dt * slow); break;
      case 'bouncing': this.bounce(l, dt); break;
      case 'teleporting': this.teleportStep(l, dt); break;
      case 'ohno': if (l.t > 0.9) this.explode(l, l.y); break;
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

  /** Spinner cells (0x8000) under an enabled anti-gravity zone flip the walker (FUN_0041bffc → action 0x2b). */
  private spinnerAt(c: number, y: number, l: Lemmo) {
    if (!(this.terrain(c, y - l.g) & F.SPIN)) return false;
    return this.triggers.some((r) => r.t.kind === 'antigrav' && r.active && !r.legacy
      && this.inBox(l, r.t, 2));
  }

  private stepCheck(l: Lemmo) {
    const X = Math.round(l.x);
    const c = l.dir > 0 ? X : X - 1;
    const { y, g } = l;
    const rat = l.type === 3;
    if (!rat && this.spinnerAt(c, y, l)) return this.flip(l);
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
        if (below & F.TRAMP && l.type !== 3) return this.setState(l, 'bouncing');
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

  // ---- bounce off a trampoline (action 0x21, FUN_0040eec4): a parabola at walking pace
  private bounce(l: Lemmo, dt: number) {
    if (l.t <= dt + 1e-9) this.events.push({ kind: 'sound', name: 'boing' });
    // horizontal: bounce off walls
    let rem = dt;
    while (rem > 1e-9) {
      const target = nextInt(l.x, l.dir);
      const need = Math.abs(target - l.x) / WALK_SPEED;
      if (rem < need) {
        l.x += l.dir * WALK_SPEED * rem;
        break;
      }
      rem -= need;
      const c = wrap(l.dir > 0 ? target : target - 1);
      let wall = false;
      for (let k = 0; k <= HEAD; k++) if (this.get(c, Math.round(l.y) + k * l.g) & (F.EARTH | F.BARRIER)) wall = true;
      if (wall) {
        l.x = target - l.dir * 1e-6;
        this.turn(l);
      } else l.x = target;
    }
    l.x = wrap(l.x);
    // vertical
    const apex = (BOUNCE_V * BOUNCE_V) / (2 * BOUNCE_G);
    const h = BOUNCE_V * l.t - 0.5 * BOUNCE_G * l.t * l.t;
    const goal = l.by + l.g * h;
    const up = (goal - l.y) * l.g > 0;
    while (Math.abs(goal - l.y) > 1e-9) {
      const target = nextInt(l.y, up ? l.g : -l.g);
      const past = up ? (target - goal) * l.g > 0 : (goal - target) * l.g > 0;
      if (past) {
        l.y = goal;
        break;
      }
      l.y = target;
      const c = this.col(l);
      if (l.y <= 0 || l.y >= this.rows - 1) {
        this.events.push({ kind: 'sound', name: 'die' });
        return this.kill(l);
      }
      if (up) {
        if (this.get(c, l.y + (HEAD + 1) * l.g) & F.EARTH) {
          this.setState(l, 'falling'); // hit the ceiling
          return;
        }
      } else {
        const below = this.get(c, l.y - l.g);
        if (below & F.TRAMP) return this.setState(l, 'bouncing');
        if (Sim.supports(below)) {
          l.fallen = Math.max(0, Math.round(apex - (l.y - l.by) * l.g));
          return this.land(l, below);
        }
      }
    }
    // once it falls faster than a normal faller, it is just falling
    if (BOUNCE_G * l.t - BOUNCE_V > FALL_SPEED) {
      const fallen = Math.round(apex - (l.y - l.by) * l.g);
      l.y = Math.round(l.y);
      this.setState(l, 'falling');
      l.fallen = fallen;
    }
  }

  // ---- rocket (action 0xb, FUN_0041a6d5): flies against gravity and blows up whatever it hits
  private rocket(l: Lemmo, dt: number) {
    let rem = dt;
    while (rem > 1e-9 && l.state === 'rocketing') {
      const target = nextInt(l.y, l.g);
      const need = Math.abs(target - l.y) / ROCKET_SPEED;
      if (rem < need) {
        l.y += l.g * ROCKET_SPEED * rem;
        break;
      }
      l.y = target;
      rem -= need;
      const head = l.y + HEAD * l.g;
      if (head <= 0 || head >= this.rows - 1) {
        this.events.push({ kind: 'sound', name: 'die' });
        return this.kill(l);
      }
      const v = this.get(this.col(l), head + l.g, true);
      if (v & (F.EARTH | FLUID)) return this.explode(l, head);
    }
  }

  // ---- cartwheel (action 0xc, FUN_0041cd24): rolls at double speed carving a 3-row tunnel
  private cartwheel(l: Lemmo, dt: number) {
    if (l.t > CARTWHEEL_TIME) return this.setState(l, 'walking');
    let rem = dt;
    while (rem > 1e-9 && l.state === 'cartwheeling') {
      const target = nextInt(l.x, l.dir);
      const need = Math.abs(target - l.x) / CARTWHEEL_SPEED;
      if (rem < need) {
        l.x += l.dir * CARTWHEEL_SPEED * rem;
        break;
      }
      l.x = target;
      rem -= need;
      const c = wrap(l.dir > 0 ? target : target - 1);
      const oneway = l.dir > 0 ? F.ONEWAY_R : F.ONEWAY_L;
      let blocked = false;
      for (let k = 0; k <= HEAD; k++) {
        const v = this.get(c, l.y + k * l.g);
        if (v & F.BARRIER || (v & F.EARTH && v & (F.METAL | oneway))) blocked = true;
      }
      if (blocked) {
        this.events.push({ kind: 'sound', name: 'chink' }, { kind: 'burst', x: l.x, y: l.y + 1, style: 'spark', n: 6 });
        this.turn(l);
        this.setState(l, 'walking');
        return;
      }
      let removed = 0;
      for (let k = 0; k <= HEAD; k++) {
        const y = l.y + k * l.g;
        if (this.terrain(c, y) & F.EARTH) {
          this.setCell(c, y, 0);
          removed++;
        }
      }
      if (removed) this.events.push({ kind: 'burst', x: c + 0.5, y: l.y + l.g, style: 'dirt', n: removed * 2 });
      l.x = wrap(l.x);
      if (!Sim.supports(this.get(c, l.y - l.g))) {
        this.setState(l, 'falling');
        return;
      }
    }
    l.x = wrap(l.x);
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

  // ---- explosion (FUN_0043f510, 7x7 disc centred on row cy, spares metal / water / barriers)
  private explode(l: Lemmo, cy: number) {
    const c = Math.floor(l.x);
    for (let r = 0; r < 7; r++)
      for (let q = 0; q < 7; q++) {
        if (BLAST[r][q] !== '#') continue;
        const x = c - 3 + q;
        const y = cy + 3 - r;
        const v = this.terrain(x, y);
        if (v & (F.METAL | F.WATER | F.BARRIER)) continue;
        if (v & F.EARTH) this.setCell(x, y, 0);
      }
    this.events.push({ kind: 'sound', name: 'explode' }, { kind: 'burst', x: l.x, y: cy + 1, style: 'blast', n: 40 });
    this.kill(l);
  }

  // ---- teleporters (FUN_00434b0f): the Lemmo vanishes, then drops out of the partner's exit
  private teleportStep(l: Lemmo, dt: number) {
    if (!l.tele) return this.setState(l, 'falling');
    l.tele.timer -= dt;
    if (l.tele.timer > 0) return;
    const to = this.level.teleporters[l.tele.to];
    const ex = to.exit ?? [to.pos[0], to.pos[1]];
    l.x = wrap(ex[0] + 0.5);
    l.y = Math.round(ex[1]);
    l.inside.add('p' + l.tele.to);
    l.tele = null;
    this.setState(l, 'falling');
    this.events.push({ kind: 'sound', name: 'teleport' }, { kind: 'burst', x: l.x, y: l.y + 1, style: 'sparkle', n: 16 });
  }

  // ---- interactions with fluids, exits, traps, triggers, rats
  inBox(l: Lemmo, f: Footprint, pad = 0) {
    const w = f.max[0] - f.min[0] + 2 * pad;
    const dx = wrap(l.x - (f.min[0] - pad));
    return dx <= w + 1 && l.y >= f.min[1] - pad - 1 && l.y <= f.max[1] + pad;
  }

  private environment(l: Lemmo) {
    const c = this.col(l);
    const here = this.terrain(c, l.y);
    const below = this.terrain(c, l.y - l.g);
    const grounded = !['falling', 'climbing', 'rocketing', 'bouncing'].includes(l.state);
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
    if (l.state !== 'climbing' && l.state !== 'rocketing') {
      for (const e of this.level.exits) {
        if (this.inBox(l, e)) {
          this.setState(l, 'exiting');
          this.events.push({ kind: 'sound', name: 'yippee' }, { kind: 'burst', x: l.x, y: l.y + 2, style: 'sparkle', n: 12 });
          return;
        }
      }
    }
    // anti-gravity zones without spinner cells (editor levels) flip Lemmo's entering the box
    this.triggers.forEach((r, i) => {
      if (!r.legacy || !r.active) return;
      const key = 't' + i;
      const inside = this.inBox(l, r.t);
      if (inside && !l.inside.has(key)) {
        l.inside.add(key);
        if (!DYING.includes(l.state)) this.flip(l);
      } else if (!inside) l.inside.delete(key);
    });
    if (DYING.includes(l.state) || l.state === 'rocketing') return;
    const tp = this.level.teleporters;
    tp.forEach((t, i) => {
      const key = 'p' + i;
      const inside = this.inBox(l, t);
      const to = this.portalTo[i];
      if (inside && !l.inside.has(key) && to >= 0 && !DYING.includes(l.state)) {
        l.inside.add(key);
        this.setState(l, 'teleporting');
        l.tele = { to, timer: t.delay ?? 0.5 };
        this.events.push({ kind: 'sound', name: 'teleport' }, { kind: 'burst', x: l.x, y: l.y + 1, style: 'sparkle', n: 16 });
      } else if (!inside) l.inside.delete(key);
    });
  }
}
