// User-made levels (the Level Editor's sandbox): storage, object factories, templates, validation
// and a headless dry run. DOM-free apart from guarded localStorage, so tests can import it.
import {
  decodeCells, encodeCells, type Command, type DoorData, type EntranceData, type FluidData, type Footprint, type LevelData,
  type TrapData, type TriggerData,
} from './level.ts';
import { ALL_SKILLS, F, SPLAT_ROWS, Sim } from './sim.ts';
import { THEMES } from './terrain.ts';

export const COLS = 256;
export const ROWS = 96;

export interface UserLevel {
  id: string;
  title: string;
  created: number;
  updated: number;
  /** Beaten at least once since the last edit. */
  verified: boolean;
  /** Most Lemmo's saved in any play of the current version. */
  best: number;
  level: LevelData;
}

// ------------------------------------------------------------------ storage
const KEY = 'lemmo.userLevels';

function readAll(): UserLevel[] {
  try {
    const rows = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function writeAll(rows: UserLevel[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
    return true;
  } catch {
    return false; // quota exceeded or storage blocked
  }
}

/** All user levels, most recently edited first. */
export function listUserLevels(): UserLevel[] {
  return readAll().sort((a, b) => b.updated - a.updated);
}

export function getUserLevel(id: string): UserLevel | null {
  return readAll().find((u) => u.id === id) ?? null;
}

export function putUserLevel(u: UserLevel): boolean {
  const rows = readAll();
  const i = rows.findIndex((r) => r.id === u.id);
  if (i >= 0) rows[i] = u;
  else rows.push(u);
  return writeAll(rows);
}

export function deleteUserLevel(id: string) {
  writeAll(readAll().filter((u) => u.id !== id));
}

export function newUserLevel(level: LevelData, title: string): UserLevel {
  const id = 'u' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const now = Date.now();
  level.name = id;
  level.title = title;
  return { id, title, created: now, updated: now, verified: false, best: 0, level };
}

export function duplicateUserLevel(u: UserLevel): UserLevel {
  const copy = newUserLevel(structuredClone(u.level), `${u.title} (copy)`);
  if (u.level.theme) copy.level.theme = u.level.theme;
  return copy;
}

/** Record a finished play; beating the level marks the current version as verified. */
export function recordPlay(id: string, saved: number, success: boolean) {
  const u = getUserLevel(id);
  if (!u) return;
  u.best = Math.max(u.best, saved);
  if (success) u.verified = true;
  putUserLevel(u);
}

// ------------------------------------------------------------------ object factories
// Footprints follow the conventions of the exported campaign levels (see sim.ts inBox and game.ts
// drawing): `x` is the object's column (its centre is x + 0.5) and `y` the row its base sits on.
let nextId = 1000;

export function makeEntrance(x: number, y: number): EntranceData {
  return {
    pos: [x, y, 0], min: [x - 4, y, 0], max: [x + 4, y + 5, 1], id: nextId++,
    lemmos: 20, releaseRate: 50, releaseRateMin: 1, releaseRateMax: 99, spawn: [x, y - 2], dir: 1, lemType: 0,
  };
}

export function makeExit(x: number, y: number): Footprint {
  return { pos: [x, y + 9, 1.5], min: [x - 1, y, 0], max: [x + 1, y + 3, 1], id: nextId++ };
}

export function makeTrap(x: number, y: number): TrapData {
  return { pos: [x, y, 0], min: [x - 2, y, 0], max: [x + 2, y + 5, 1], id: nextId++, cls: 'DYNA', name: '', anim: '' };
}

export function makeAntigrav(x: number, y: number, w = 3, h = 3): TriggerData {
  const x0 = x - Math.floor((w - 1) / 2);
  return { pos: [x, y, 0], min: [x0, y, 0], max: [x0 + w - 1, y + h - 1, 1], id: nextId++, kind: 'antigrav', value: null };
}

export function makePortal(x: number, y: number): Footprint {
  return { pos: [x, y, 0.5], min: [x - 2, y, 0], max: [x + 2, y + 5, 1], id: nextId++ };
}

/** Switch kinds as stored in the level data, with the names the editor shows. */
export const SWITCH_KINDS: [string, string][] = [['kind1', 'Lever'], ['skill_pad', 'Button'], ['kind2', 'Timed plate'], ['kind4', 'Speed pad']];
export const switchName = (kind: string) => SWITCH_KINDS.find(([k]) => k === kind)?.[1] ?? 'Anti-gravity field';

/** A lever, button, timed plate or speed pad standing on row `y`. */
export function makeSwitch(x: number, y: number, kind = 'kind1'): TriggerData {
  const t: TriggerData = {
    pos: [x, y, 0], min: [x - 1, y, 0], max: [x + 1, y + 6, 1], id: nextId++, kind, value: null,
    rects: [], rects2: [], delay: 0, active: true,
  };
  setSwitchKind(t, kind);
  return t;
}

/** Change a switch's kind, keeping its links. */
export function setSwitchKind(t: TriggerData, kind: string) {
  t.kind = kind;
  t.value = kind === 'kind1' ? (t.value === 1 ? 1 : -1) : kind === 'kind4' ? null : 0;
  t.delay = kind === 'kind2' ? (t.delay || 5) : 0;
  if (kind === 'kind4') {
    t.dir = t.dir ?? 0;
    t.flag = false;
    t.cmd = t.cmd ?? [-2, 6, 1, 0];
  }
}

/** A closed sliding door, `w` columns wide and `h` rows tall, standing on row `y`. */
export function makeDoor(x: number, y: number, w = 2, h = 8): DoorData {
  const d: DoorData = { pos: [x, y, 0.5], id: nextId++, rect: [x, x + w, y + h, y], mode: 0, open: false, count: 5, countDir: 0, active: true };
  return doorFootprint(d);
}

/** Give a door min/max mirroring its rect, so it can be moved and selected like other objects. */
export function doorFootprint(d: DoorData): DoorData {
  const [x0, x1, yTop, yBot] = d.rect;
  d.min = [x0, yBot, 0];
  d.max = [x1 - 1, yTop - 1, 1];
  d.pos = [x0, yBot, 0.5];
  return d;
}

/** After the editor changes a door's min/max, write the rect back. */
export function syncDoorRect(d: DoorData) {
  d.rect = [d.min![0], d.max![0] + 1, d.max![1] + 1, d.min![1]];
}

/** A pool of water, lava or acid filling `w` × `h` cells from row `y` up. */
export function makePool(x: number, y: number, type: FluidData['type'] = 'water', w = 8, h = 6): FluidData {
  const x0 = x - Math.floor(w / 2);
  return { pos: [x0, y, 0], min: [x0, y, 0], max: [x0 + w, y + h, 1], id: nextId++, type, mode: 0, levelA: h, levelB: 0, active: true };
}

/** A deathroller. Its track starts with one waypoint; the editor adds more. */
export function makeRoller(x: number, y: number): TrapData {
  const t: TrapData = {
    pos: [x, y, 0.5], min: [x - 1, y - 2, 0], max: [x + 3, y + 3, 1], id: nextId++, cls: 'DYNA', name: '', anim: 'deathroller',
    killAll: true, box: [-1, -2, 3, 3], speed: 6, seg: 0, s: 0, track: [[x, y]], loop: false, active: true,
  };
  return t;
}

/** Keep a roller's footprint on the first point of its track. */
export function syncRoller(t: TrapData) {
  const p = t.track?.[0];
  if (!p) return;
  const b = t.box ?? [-1, -2, 3, 3];
  t.pos = [p[0], p[1], 0.5];
  t.min = [p[0] + b[0], p[1] + b[1], 0];
  t.max = [p[0] + b[2], p[1] + b[3], 1];
}

/** A unique object id for this level (commands address objects by id). */
export function freshId(l: LevelData) {
  let max = 999;
  const lists: { id: number }[][] = [l.entrances, l.exits, l.traps, l.triggers, l.teleporters, l.fluids ?? [], l.counters ?? []];
  for (const arr of lists) for (const o of arr) if (typeof o.id === 'number' && o.id > max) max = o.id;
  return max + 1;
}

// ---- switch wiring: a "link" is a target id plus what the switch does to it
export interface Link { target: number; on: boolean }

/**
 * The objects a switch controls. For a lever `on` is what happens when it leans right, for a timed
 * plate what happens while someone stands on it, and for a button what a press does.
 */
export function switchLinks(t: TriggerData): Link[] {
  const out: Link[] = [];
  const primary = t.kind === 'kind1' ? t.rects2 : t.rects;
  for (const c of primary ?? []) if (c[0] >= 0 && (c[1] === 4 || c[1] === 5) && !out.some((l) => l.target === c[0])) out.push({ target: c[0], on: c[1] === 4 });
  return out;
}

/** Rewrite a switch's commands from a list of links. */
export function setSwitchLinks(t: TriggerData, links: Link[]) {
  const cmd = (l: Link, on: boolean): Command => [l.target, on ? 4 : 5, 0, 0];
  if (t.kind === 'kind1') {
    t.rects2 = links.map((l) => cmd(l, l.on));
    t.rects = links.map((l) => cmd(l, !l.on));
  } else if (t.kind === 'kind2') {
    t.rects = links.map((l) => cmd(l, l.on));
    t.rects2 = links.map((l) => cmd(l, !l.on));
  } else if (t.kind === 'skill_pad') {
    t.rects = links.map((l) => cmd(l, l.on));
    t.rects2 = [];
  }
}

/** Every object a switch can control, by id. */
export function linkTargets(l: LevelData): { id: number; kind: string; f: Footprint }[] {
  const out: { id: number; kind: string; f: Footprint }[] = [];
  for (const d of l.counters ?? []) if (d.min && d.max) out.push({ id: d.id, kind: 'door', f: d as Footprint });
  for (const f of l.fluids ?? []) out.push({ id: f.id, kind: 'pool', f });
  for (const t of l.traps) out.push({ id: t.id, kind: t.track || t.anim === 'deathroller' ? 'roller' : 'trap', f: t });
  for (const t of l.triggers) out.push({ id: t.id, kind: t.kind === 'antigrav' ? 'antigrav' : 'switch', f: t });
  return out;
}

/** Words for what "on" and "off" do to each kind of target. */
export const LINK_VERBS: Record<string, [string, string]> = {
  door: ['Open', 'Close'], pool: ['Fill', 'Drain'], trap: ['Switch on', 'Switch off'], roller: ['Start', 'Stop'],
  antigrav: ['Switch on', 'Switch off'], switch: ['Enable', 'Disable'],
};

/** Move any footprint (and a hatch's spawn point, a door's rect or a roller's track) by whole cells. */
export function translate(f: Footprint, dx: number, dy: number) {
  f.pos[0] += dx; f.min[0] += dx; f.max[0] += dx;
  f.pos[1] += dy; f.min[1] += dy; f.max[1] += dy;
  const e = f as Partial<EntranceData>;
  if (e.spawn) e.spawn = [e.spawn[0] + dx, e.spawn[1] + dy];
  const d = f as Partial<DoorData>;
  if (d.rect) d.rect = [d.rect[0] + dx, d.rect[1] + dx, d.rect[2] + dy, d.rect[3] + dy];
  const t = f as Partial<TrapData>;
  if (t.track) t.track = t.track.map((p) => [p[0] + dx, p[1] + dy]);
}

/** Keep footprint columns inside 0..255 after a move that crossed the wrap seam. */
export function normalizeX(f: Footprint) {
  const k = Math.floor(f.min[0] / COLS) * COLS;
  if (k) translate(f, -k, 0);
}

export function totalLemmos(l: LevelData) {
  return l.entrances.reduce((s, e) => s + (e.lemmos || 0), 0);
}

// ------------------------------------------------------------------ templates
function emptyLevel(): LevelData {
  return {
    name: '', timeLimit: 300, toSave: 10,
    skills: { climber: 0, floater: 0, bomber: 0, blocker: 0, builder: 0, basher: 0, miner: 0, digger: 0, nuke: 1 },
    grid: { cols: COLS, rows: ROWS, cells: [[0, COLS * ROWS]] },
    entrances: [], exits: [], fluids: [], triggers: [], traps: [], teleporters: [], preplacedLemmos: [],
  };
}

export function blankTemplate(): LevelData {
  return emptyLevel();
}

/** A small, solvable example: a floor with a water pit between the hatch and the exit. */
export function starterTemplate(): LevelData {
  const l = emptyLevel();
  const cells = new Uint32Array(COLS * ROWS);
  const set = (x: number, y: number, v: number) => (cells[x + y * COLS] = v);
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < 3; y++) set(x, y, F.EARTH | F.METAL);
    for (let y = 3; y < 18; y++) set(x, y, F.EARTH);
  }
  for (let x = 110; x < 126; x++) for (let y = 8; y < 18; y++) set(x, y, F.WATER);
  // a raised ledge for the hatch and a stopping wall behind the exit
  for (let x = 30; x < 64; x++) for (let y = 18; y < 24; y++) set(x, y, F.EARTH);
  for (let x = 196; x < 202; x++) for (let y = 18; y < 40; y++) set(x, y, F.EARTH | F.METAL);
  l.grid.cells = encodeCells(cells);
  l.entrances.push(makeEntrance(44, 44));
  l.exits.push(makeExit(170, 18));
  l.skills.builder = 4;
  l.skills.blocker = 2;
  l.toSave = 15;
  return l;
}

/** Copy a campaign level into an editable user level, dropping fields the remake doesn't use. */
export function remixTemplate(src: LevelData, title: string): LevelData {
  const l = emptyLevel();
  l.timeLimit = src.timeLimit;
  l.toSave = src.toSave;
  l.skills = { ...l.skills, ...src.skills };
  l.grid = structuredClone(src.grid);
  for (const k of ['entrances', 'exits', 'fluids', 'triggers', 'traps', 'teleporters', 'preplacedLemmos', 'counters', 'paths'] as const) {
    (l as any)[k] = structuredClone((src as any)[k] ?? []);
  }
  l.counters?.forEach(doorFootprint);
  l.theme = THEMES[0].name;
  l.title = title;
  return l;
}

// ------------------------------------------------------------------ import / export
export function exportJson(u: UserLevel): string {
  return JSON.stringify({ format: 'lemmo-level', version: 1, title: u.title, level: u.level });
}

const num = (v: unknown, lo: number, hi: number, dflt: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt;
const vec = (v: unknown, n: number): number[] | null =>
  Array.isArray(v) && v.length >= n && v.slice(0, n).every((x) => typeof x === 'number' && Number.isFinite(x)) ? v.slice(0, n) : null;

function cleanFootprint<T extends Footprint>(raw: any): T | null {
  const pos = vec(raw?.pos, 3) ?? vec(raw?.min, 3), min = vec(raw?.min, 3), max = vec(raw?.max, 3);
  if (!pos || !min || !max) return null;
  return { ...raw, pos, min, max, id: num(raw.id, 0, 1e9, nextId++) };
}

/** Parse an exported file (or a bare LevelData) and return a well-formed level, or throw. */
export function importJson(text: string): { title: string; level: LevelData } {
  const raw = JSON.parse(text);
  const src = raw?.format === 'lemmo-level' ? raw.level : raw;
  if (!src || typeof src !== 'object' || !src.grid) throw new Error('Not a Lemmo level file');
  const l = emptyLevel();
  const g = src.grid;
  if (g.cols !== COLS || g.rows !== ROWS || !Array.isArray(g.cells)) throw new Error('Unsupported grid size');
  let n = 0;
  const cells: [number, number][] = [];
  for (const c of g.cells) {
    if (!Array.isArray(c) || !Number.isInteger(c[0]) || !Number.isInteger(c[1]) || c[1] < 0) throw new Error('Corrupt terrain data');
    cells.push([c[0] >>> 0, c[1]]);
    n += c[1];
  }
  if (n !== COLS * ROWS) throw new Error('Terrain data has the wrong size');
  l.grid.cells = cells;
  l.timeLimit = num(src.timeLimit, 10, 5999, 300);
  for (const s of [...ALL_SKILLS, 'nuke']) l.skills[s] = Math.round(num(src.skills?.[s], 0, 99, s === 'nuke' ? 1 : 0));
  const list = <T extends Footprint>(v: unknown, fix: (f: T) => void = () => {}) =>
    (Array.isArray(v) ? v : []).map((r) => cleanFootprint<T>(r)).filter((f): f is T => !!f).map((f) => (fix(f), f));
  l.entrances = list<EntranceData>(src.entrances, (e) => {
    e.lemmos = Math.round(num(e.lemmos, 0, 200, 20));
    e.releaseRate = Math.round(num(e.releaseRate, 1, 99, 50));
    e.releaseRateMin = Math.round(num(e.releaseRateMin, 1, 99, 1));
    e.releaseRateMax = Math.round(num(e.releaseRateMax, 1, 99, 99));
    e.spawn = (vec(e.spawn, 2) as [number, number]) ?? [e.pos[0], e.min[1] - 2];
    e.dir = e.dir === -1 ? -1 : 1;
    e.lemType = [0, 1, 2].includes(e.lemType) ? e.lemType : 0;
  });
  l.exits = list(src.exits);
  l.traps = list<TrapData>(src.traps, (t) => {
    t.cls = String(t.cls ?? 'DYNA'); t.name = String(t.name ?? ''); t.anim = String(t.anim ?? '');
    if (t.track !== undefined) t.track = Array.isArray(t.track) ? t.track.filter((p) => vec(p, 2)).map((p) => [p[0], p[1]]).slice(0, 64) : undefined;
    if (t.speed !== undefined) t.speed = num(t.speed, 0.1, 80, 6);
  });
  const cmds = (v: unknown) => (Array.isArray(v) ? v.filter((c) => vec(c, 4)).map((c) => c.slice(0, 4) as Command).slice(0, 64) : []);
  l.triggers = list<TriggerData>(src.triggers, (t) => {
    t.kind = String(t.kind ?? ''); t.value = typeof t.value === 'number' ? t.value : null;
    t.rects = cmds(t.rects);
    t.rects2 = cmds(t.rects2);
    if (t.cmd !== undefined) t.cmd = (vec(t.cmd, 4) as Command | null) ?? undefined;
    if (t.delay !== undefined) t.delay = num(t.delay, 0, 600, 0);
  });
  l.teleporters = list(src.teleporters);
  l.fluids = list<FluidData>(src.fluids, (f) => {
    f.type = ['water', 'lava', 'acid'].includes(f.type) ? f.type : 'water';
    f.mode = f.mode === 1 ? 1 : 0;
    f.levelA = num(f.levelA, 0, ROWS, f.max[1] - f.min[1]);
    f.levelB = num(f.levelB, 0, ROWS, 0);
  });
  l.counters = (Array.isArray(src.counters) ? src.counters : []).filter((d: any) => vec(d?.rect, 4) && vec(d?.pos, 3))
    .map((d: any) => doorFootprint({ ...d, id: num(d.id, 0, 1e9, nextId++), mode: Math.round(num(d.mode, 0, 2, 0)), open: !!d.open, count: num(d.count, 0, 999, 0), countDir: num(d.countDir, -1, 1, 0) }));
  l.paths = (Array.isArray(src.paths) ? src.paths : []).map((p: any) => ({
    closed: !!p?.closed, junctions: Array.isArray(p?.junctions) ? p.junctions.filter(Number.isInteger) : [],
    keys: (Array.isArray(p?.keys) ? p.keys : []).filter((k: any) => vec(k?.p, 2) && vec(k?.v, 2) && typeof k.len === 'number')
      .map((k: any) => ({ len: k.len, n: Number(k.n) | 0, p: k.p.slice(0, 2), v: k.v.slice(0, 2) })),
  })).filter((p: any) => p.keys.length);
  l.toSave = Math.round(num(src.toSave, 1, Math.max(1, totalLemmos(l)), 1));
  if (THEMES.some((t) => t.name === src.theme)) l.theme = src.theme;
  const title = String(raw.title ?? src.title ?? 'Imported level').slice(0, 60) || 'Imported level';
  return { title, level: l };
}

// ------------------------------------------------------------------ validation
export interface Issue {
  severity: 'error' | 'warn' | 'info';
  text: string;
  /** World position to jump to when the issue is clicked. */
  at?: [number, number];
}

const solid = (v: number) => (v & F.EARTH) !== 0;

/** Where a hatch's Lemmo's first land, and how far they fall. */
export function dropFrom(cells: Uint32Array, x: number, y: number): { row: number; fall: number; into: number } {
  for (let r = y - 1; r >= 0; r--) {
    const v = cells[(((x % COLS) + COLS) % COLS) + r * COLS];
    if (solid(v) || v & (F.WATER | F.LAVA | F.ACID)) return { row: r + 1, fall: y - (r + 1), into: v };
  }
  return { row: 0, fall: y, into: 0 };
}

/** Problems that stop a level being winnable (errors) or that are probably mistakes (warnings). */
export function validate(l: LevelData, cells = decodeCells(l)): Issue[] {
  const out: Issue[] = [];
  const total = totalLemmos(l);
  const at = (x: number, y: number) => cells[(((x % COLS) + COLS) % COLS) + Math.max(0, Math.min(ROWS - 1, y)) * COLS];
  if (!l.entrances.length) out.push({ severity: 'error', text: 'Add a hatch so Lemmo\'s can enter the level.' });
  if (!l.exits.length) out.push({ severity: 'error', text: 'Add an exit so Lemmo\'s have somewhere to go.' });
  if (l.entrances.length && total === 0) out.push({ severity: 'error', text: 'Your hatches release no Lemmo\'s.' });
  if (total > 0 && (l.toSave < 1 || l.toSave > total)) out.push({ severity: 'error', text: `"To save" must be between 1 and ${total}.` });
  l.entrances.forEach((e, i) => {
    const [x, y] = e.spawn;
    const p: [number, number] = [x, y];
    if (y <= 1) out.push({ severity: 'error', text: `Hatch ${i + 1} is too close to the bottom of the world.`, at: p });
    else if (solid(at(x, y))) out.push({ severity: 'warn', text: `Hatch ${i + 1} drops Lemmo's into solid terrain.`, at: p });
    else {
      const d = dropFrom(cells, x, y);
      if (d.row <= 0) out.push({ severity: 'warn', text: `Lemmo's from hatch ${i + 1} fall out of the world: nothing below it.`, at: p });
      else if (d.into & F.LAVA) out.push({ severity: 'warn', text: `Hatch ${i + 1} drops Lemmo's straight into lava.`, at: p });
      else if (d.into & (F.WATER | F.ACID) && !(e.lemType === 1 && d.into & F.WATER) && !(e.lemType === 2 && d.into & F.ACID))
        out.push({ severity: 'warn', text: `Hatch ${i + 1} drops Lemmo's straight into a pool.`, at: p });
      else if (d.fall > SPLAT_ROWS && !l.skills.floater)
        out.push({ severity: 'warn', text: `Hatch ${i + 1}'s drop (${d.fall} rows) is fatal and there are no floaters.`, at: p });
    }
    if (e.min[1] + 5 >= ROWS) out.push({ severity: 'warn', text: `Hatch ${i + 1} sticks out of the top of the world.`, at: p });
  });
  l.exits.forEach((e, i) => {
    const x = e.min[0] + 1, y = e.min[1];
    let buried = true;
    for (let dy = 0; dy < 3; dy++) if (!solid(at(x, y + dy))) buried = false;
    if (buried) out.push({ severity: 'warn', text: `Exit ${i + 1} is buried in terrain.`, at: [x, y] });
  });
  if (l.teleporters.length % 2) out.push({ severity: 'warn', text: 'A teleporter has no partner, so it does nothing.' });
  const ids = new Set(linkTargets(l).map((t) => t.id));
  const count: Record<string, number> = {};
  for (const t of l.triggers) {
    if (t.kind === 'antigrav') continue;
    const name = `${switchName(t.kind)} ${(count[t.kind] = (count[t.kind] ?? 0) + 1)}`;
    const at: [number, number] = [t.pos[0], t.min[1]];
    if (t.kind === 'kind4') continue;
    const links = switchLinks(t);
    if (!links.length) out.push({ severity: 'warn', text: `${name} isn't linked to anything yet, so it does nothing.`, at });
    else if (links.some((k) => !ids.has(k.target))) out.push({ severity: 'warn', text: `${name} is linked to an object that no longer exists.`, at });
  }
  l.traps.forEach((t, i) => {
    if (t.track && t.track.length < 2) out.push({ severity: 'info', text: `Deathroller ${i + 1} has no track yet, so it stays where it is.`, at: [t.pos[0], t.min[1]] });
  });
  if (l.timeLimit < 30) out.push({ severity: 'warn', text: 'Under 30 seconds is very little time.' });
  if (!ALL_SKILLS.some((s) => (l.skills[s] ?? 0) > 0)) out.push({ severity: 'info', text: 'No skills: Lemmo\'s must find the exit on their own.' });
  return out;
}

export interface DryRun {
  saved: number;
  died: number;
  total: number;
  seconds: number;
}

/** Play the level headlessly with no skills assigned: shows whether it is trivially winnable. */
export function dryRun(l: LevelData): DryRun {
  const sim = new Sim(l);
  const dt = 1 / 60; // same step as the game
  while (!sim.finished && sim.time < l.timeLimit + 2) sim.step(dt);
  return { saved: sim.saved, died: sim.died, total: sim.total, seconds: sim.time };
}

// ------------------------------------------------------------------ share links
const b64url = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const res = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

/** A compact, URL-safe code for a level: deflated JSON in base64url. */
export async function shareCode(u: UserLevel): Promise<string> {
  const json = new TextEncoder().encode(exportJson({ ...u, level: { ...u.level, title: u.title } }));
  return b64url(await pipe(json, new CompressionStream('deflate-raw')));
}

/** Read a level back from a share code (throws if it's damaged). */
export async function fromShareCode(code: string): Promise<{ title: string; level: LevelData }> {
  let text: string;
  try {
    text = new TextDecoder().decode(await pipe(unb64url(code), new DecompressionStream('deflate-raw')));
  } catch {
    throw new Error('This share link is incomplete or damaged.');
  }
  return importJson(text);
}
