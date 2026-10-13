// Level data as exported from the original game (see ../docs/SPEC.md).

export type Vec3 = [number, number, number];

export interface Footprint {
  pos: Vec3;
  min: Vec3;
  max: Vec3;
  id: number;
}

export interface EntranceData extends Footprint {
  lemmings: number;
  releaseRate: number;
  releaseRateMin: number;
  releaseRateMax: number;
  spawn: [number, number];
  dir: number;
  lemType: number;
}

export interface TriggerData extends Footprint {
  kind: string;
  value: number | null;
}

export interface TrapData extends Footprint {
  cls: string;
  name: string;
  anim: string;
}

export interface FluidData extends Footprint {
  type: 'water' | 'lava' | 'acid';
}

export interface LevelData {
  name: string;
  timeLimit: number;
  toSave: number;
  skills: Record<string, number>;
  grid: { cols: number; rows: number; cells: [number, number][] };
  entrances: EntranceData[];
  exits: Footprint[];
  fluids: FluidData[];
  triggers: TriggerData[];
  traps: TrapData[];
  teleporters: Footprint[];
  preplacedLemmings: { pos: Vec3; dir: number; gravity: number; climber: boolean; floater: boolean; type: number; blocking: boolean }[];
}

export interface LevelIndexEntry {
  slot: number;
  name: string;
  title: string;
  time: number;
  save: number;
  total: number;
  file: string | null;
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
