// User-made levels (the Level Editor's sandbox): storage, object factories, templates, validation
// and a headless dry run. DOM-free apart from guarded localStorage, so tests can import it.
import {
  decodeCells, encodeCells, type EntranceData, type Footprint, type LevelData, type TrapData, type TriggerData,
} from './level.ts';
import { F, SKILLS, SPLAT_ROWS, Sim } from './sim.ts';
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

/** Move any footprint (and a hatch's spawn point) by whole cells. */
export function translate(f: Footprint, dx: number, dy: number) {
  f.pos[0] += dx; f.min[0] += dx; f.max[0] += dx;
  f.pos[1] += dy; f.min[1] += dy; f.max[1] += dy;
  const e = f as Partial<EntranceData>;
  if (e.spawn) e.spawn = [e.spawn[0] + dx, e.spawn[1] + dy];
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
  for (const k of ['entrances', 'exits', 'fluids', 'triggers', 'traps', 'teleporters', 'preplacedLemmos'] as const) {
    (l as any)[k] = structuredClone((src as any)[k] ?? []);
  }
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
  for (const s of [...SKILLS, 'nuke']) l.skills[s] = Math.round(num(src.skills?.[s], 0, 99, s === 'nuke' ? 1 : 0));
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
  l.traps = list<TrapData>(src.traps, (t) => { t.cls = String(t.cls ?? 'DYNA'); t.name = String(t.name ?? ''); t.anim = String(t.anim ?? ''); });
  l.triggers = list<TriggerData>(src.triggers, (t) => { t.kind = String(t.kind ?? ''); t.value = typeof t.value === 'number' ? t.value : null; });
  l.teleporters = list(src.teleporters);
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
  if (l.timeLimit < 30) out.push({ severity: 'warn', text: 'Under 30 seconds is very little time.' });
  if (!SKILLS.some((s) => (l.skills[s] ?? 0) > 0)) out.push({ severity: 'info', text: 'No skills: Lemmo\'s must find the exit on their own.' });
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
