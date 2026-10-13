// Level data as exported from the original game (see ../docs/SPEC.md).

export type Vec3 = [number, number, number];

export interface Footprint {
  pos: Vec3;
  min: Vec3;
  max: Vec3;
  id: number;
}

export interface EntranceData extends Footprint {
  lemmos: number;
  releaseRate: number;
  releaseRateMin: number;
  releaseRateMax: number;
  spawn: [number, number];
  dir: number;
  lemType: number;
}

/** A trigger command: [target id (-2 = the triggering Lemmo), op (0 set, 4 on, 5 off, 6 speed), a, b]. */
export type Command = [number, number, number, number];

export interface TriggerData extends Footprint {
  /** skill_pad (one-shot button), kind1 (lever), kind2 (timed plate), antigrav, kind4 (speed pad). */
  kind: string;
  value: number | null;
  rects?: Command[] | null;
  rects2?: Command[] | null;
  rect?: number[] | null;
  /** Cooldown in seconds between activations. */
  delay?: number;
  flag?: boolean;
  /** Enabled at level start (default true). Other triggers can switch it. */
  active?: boolean;
  /** Speed pad: only Lemmo's walking this way (0 = either). */
  dir?: number;
  cmd?: Command;
}

export interface TrapData extends Footprint {
  cls: string;
  name: string;
  anim: string;
  active?: boolean;
  /** Catches every Lemmo inside at once (otherwise one per attack). */
  killAll?: boolean;
  /** Switches itself off after one kill. */
  oneShot?: boolean;
  // Moving (DYNA) traps follow a path.
  path?: number;
  path2?: number;
  /** Kill box relative to the trap position: [dx0, dy0, dx1, dy1]. */
  box?: number[];
  speed?: number;
  seg?: number;
  s?: number;
  reverse?: boolean;
  /** Editor-made rollers carry their track as waypoints instead of a `path` index. */
  track?: number[][];
  /** The track is a closed loop (otherwise the roller runs back and forth). */
  loop?: boolean;
}

export interface PathData {
  closed: boolean;
  name?: string;
  /** Key indices where a trap may switch to its other path. */
  junctions: number[];
  /** Segment i runs from p for `len` time units at velocity v. */
  keys: { len: number; n: number; p: number[]; v: number[] }[];
}

/** A sliding metal door ("counter" in the original data). */
export interface DoorData {
  pos: Vec3;
  id: number;
  /** [x0, x1, yTop, yBottom], half-open. */
  rect: number[];
  active?: boolean;
  /** 0 plain door, 1 counts Lemmo's falling through, 2 counts Lemmo's walking through. */
  mode: number;
  open: boolean;
  count: number;
  countDir: number;
  /** Footprint mirror of `rect` used by the editor (cells x0..x1-1, yBottom..yTop-1). */
  min?: Vec3;
  max?: Vec3;
}

export interface TeleporterData extends Footprint {
  /** Object id of the teleporter this one sends Lemmo's to. */
  partner?: number;
  delay?: number;
  exit?: number[];
}

export interface FluidData extends Footprint {
  type: 'water' | 'lava' | 'acid';
  /** 0 starts full (levelA), 1 starts drained (levelB). */
  mode?: number;
  levelA?: number;
  levelB?: number;
  active?: boolean;
}

export interface LevelData {
  name: string;
  /** Display title (user levels; campaign titles live in index.json). */
  title?: string;
  /** Terrain theme name (user levels); otherwise picked from a hash of `name`. */
  theme?: string;
  timeLimit: number;
  toSave: number;
  skills: Record<string, number>;
  grid: { cols: number; rows: number; cells: [number, number][] };
  entrances: EntranceData[];
  exits: Footprint[];
  fluids: FluidData[];
  triggers: TriggerData[];
  traps: TrapData[];
  teleporters: TeleporterData[];
  counters?: DoorData[];
  paths?: PathData[];
  preplacedLemmos: { pos: Vec3; dir: number; gravity: number; climber: boolean; floater: boolean; type: number; blocking: boolean }[];
}

/** Turn a list of waypoints into a path: each segment moves at 1 cell per time unit. */
export function pathFromTrack(track: number[][], loop = false): PathData {
  const pts = track.filter((p) => p.length >= 2);
  const n = pts.length;
  const keys = pts.map((p, i) => {
    const q = loop ? pts[(i + 1) % n] : pts[i + 1];
    if (!q || n < 2) return { len: 0, n: 0, p: [p[0], p[1]], v: [0, 0] };
    let dx = q[0] - p[0];
    if (dx > 128) dx -= 256;
    if (dx < -128) dx += 256;
    const dy = q[1] - p[1];
    const len = Math.hypot(dx, dy);
    const vertical = Math.abs(dy) > Math.abs(dx);
    const positive = vertical ? dy > 0 : dx > 0;
    return { len, n: (vertical ? 2 : 0) | (positive ? 1 : 0), p: [p[0], p[1]], v: len ? [dx / len, dy / len] : [0, 0] };
  });
  return { closed: loop && n > 2, junctions: [], keys };
}

export interface LevelIndexEntry {
  slot: number;
  name: string;
  title: string;
  time: number;
  save: number;
  total: number;
  file: string | null;
  /** Subtitle shown instead of "Tier · Level N" (user levels). */
  tag?: string;
}

export const TIERS = ['Easy', 'Medium', 'Hard', 'Very Hard', 'Special'];

export function tierOf(slot: number) {
  return Math.min(TIERS.length - 1, Math.floor(slot / 25));
}

export async function loadIndex(): Promise<LevelIndexEntry[]> {
  const rows: LevelIndexEntry[] = await (await fetch('levels/index.json')).json();
  return rows.filter((r) => r.file && r.name.toLowerCase() !== 'blank');
}

export async function loadLevel(file: string): Promise<LevelData> {
  return (await fetch(`levels/${file}.json`)).json();
}

export function decodeCells(level: LevelData): Uint32Array {
  const { cols, rows, cells } = level.grid;
  const out = new Uint32Array(cols * rows);
  let i = 0;
  for (const [v, n] of cells) {
    out.fill(v, i, i + n);
    i += n;
  }
  return out;
}

/** Inverse of decodeCells: run-length encode a grid as [value, count] pairs. */
export function encodeCells(cells: Uint32Array): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < cells.length; i++) {
    const last = out[out.length - 1];
    if (last && last[0] === cells[i]) last[1]++;
    else out.push([cells[i], 1]);
  }
  return out;
}
