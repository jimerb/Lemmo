// Checks for the switchable and moving level objects and the special skills.
import fs from 'node:fs';
import { encodeCells, type LevelData } from '../src/level.ts';
import { F, Sim, type Lemmo } from '../src/sim.ts';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failed++;
}

const ROWS = 96;
/** A level with an earth floor (rows 0..9, so Lemmo's walk on row 10) and no objects. */
function flat(edit: (set: (x: number, y: number, v: number) => void) => void = () => {}): LevelData {
  const cells = new Uint32Array(256 * ROWS);
  for (let x = 0; x < 256; x++) for (let y = 0; y < 10; y++) cells[x + y * 256] = F.EARTH;
  edit((x, y, v) => (cells[x + y * 256] = v));
  return {
    name: 'test', timeLimit: 300, toSave: 1,
    skills: { climber: 0, floater: 0, bomber: 0, blocker: 0, builder: 0, basher: 0, miner: 0, digger: 0, nuke: 1 },
    grid: { cols: 256, rows: ROWS, cells: encodeCells(cells) },
    entrances: [], exits: [], fluids: [], triggers: [], traps: [], teleporters: [], preplacedLemmos: [],
  };
}
const box = (x0: number, y0: number, x1: number, y1: number, id: number) => ({ pos: [x0, y0, 0] as [number, number, number], min: [x0, y0, 0] as [number, number, number], max: [x1, y1, 1] as [number, number, number], id });
function walker(l: LevelData, x: number, y = 10, dir = 1) {
  l.preplacedLemmos.push({ pos: [x, y, 0], dir, gravity: 1, climber: false, floater: false, type: 0, blocking: false });
}
/** Keeps a level running: a blocker far from everything. */
function bystander(l: LevelData) {
  l.preplacedLemmos.push({ pos: [5, 10, 0], dir: 1, gravity: 1, climber: false, floater: false, type: 0, blocking: true });
}
function runFor(sim: Sim, seconds: number, each: (sim: Sim) => void = () => {}) {
  for (let t = 0; t < seconds && !sim.finished; t += 1 / 60) {
    each(sim);
    sim.step(1 / 60);
  }
}
const first = (sim: Sim): Lemmo | undefined => sim.lemmos[0];

// ---------------------------------------------------------------- teleporters
{
  const l = flat();
  // three teleporters: A (id 10) -> C (id 30), C -> A, B (id 20) -> C. File order would pair A with B.
  l.teleporters = [
    { ...box(40, 10, 44, 16, 10), partner: 30, delay: 0.5, exit: [200, 10] },
    { ...box(100, 10, 104, 16, 20), partner: 30, delay: 0.5, exit: [100, 10] },
    { ...box(198, 10, 202, 16, 30), partner: 10, delay: 0.5, exit: [200, 10] },
  ];
  walker(l, 30);
  const sim = new Sim(l);
  check('teleporters link by partner id, not file order', sim.portalTo.join() === '2,2,0', sim.portalTo.join());
  let hidden = false;
  runFor(sim, 3, (s) => { if (first(s)?.state === 'teleporting') hidden = true; });
  const lem = first(sim)!;
  check('a Lemmo vanishes while teleporting', hidden);
  check('it comes out at the partner', Math.abs(lem.x - 200) < 12, `x=${lem.x.toFixed(1)}`);
  const m18 = new Sim(JSON.parse(fs.readFileSync('public/levels/M18_MT_1.json', 'utf8')));
  check('M18 pairs 13<->17 and 14<->15 like the original', m18.portalTo.join() === '3,2,1,0', m18.portalTo.join());
}

// ---------------------------------------------------------------- doors and levers
{
  const l = flat();
  l.counters = [{ pos: [60, 10, 0], id: 5, rect: [60, 62, 20, 10], mode: 0, open: false, count: 0, countDir: 0 }];
  walker(l, 50);
  const sim = new Sim(l);
  check('a closed door is solid metal', (sim.cells[61 + 12 * 256] & (F.EARTH | F.METAL)) === (F.EARTH | F.METAL));
  runFor(sim, 4);
  check('a walker turns at a closed door', first(sim)!.x < 60, `x=${first(sim)!.x.toFixed(1)}`);

  const l2 = flat();
  l2.counters = [{ pos: [60, 10, 0], id: 5, rect: [60, 62, 20, 10], mode: 0, open: false, count: 0, countDir: 0 }];
  // a lever (state -1 opens nothing, +1 opens the door) that the walker flips on its way
  l2.triggers = [{ ...box(45, 10, 47, 16, 1), kind: 'kind1', value: -1, rects: [[5, 5, 0, 0]], rects2: [[5, 4, 0, 0]] }];
  walker(l2, 40);
  const s2 = new Sim(l2);
  runFor(s2, 8);
  check('walking over a lever opens its door', !(s2.cells[61 + 12 * 256] & F.EARTH) && first(s2)!.x > 62, `x=${first(s2)!.x.toFixed(1)}`);

  const l3 = flat();
  l3.counters = [{ pos: [60, 10, 0], id: 5, rect: [60, 62, 20, 10], mode: 0, open: true, count: 0, countDir: 0 }];
  // the pad is right in front of the door, so the Lemmo that steps on it is still inside when it shuts
  l3.triggers = [{ ...box(59, 10, 60, 16, 1), kind: 'skill_pad', value: 0, rects: [[5, 5, 0, 0]] }];
  walker(l3, 59.5);
  walker(l3, 20);
  const s3 = new Sim(l3);
  runFor(s3, 12);
  const xs = s3.lemmos.map((m) => m.x);
  check('a pad closes a door once, trapping the Lemmo inside', s3.died === 1 && !!(s3.cells[61 + 12 * 256] & F.METAL), `died=${s3.died} xs=${xs.map((x) => x.toFixed(0))}`);

  const l4 = flat();
  l4.counters = [{ pos: [60, 10, 0], id: 5, rect: [60, 62, 20, 10], mode: 2, open: true, count: 2, countDir: 0 }];
  for (let i = 0; i < 4; i++) walker(l4, 30 - i * 6);
  const s4 = new Sim(l4);
  runFor(s4, 12);
  const past = s4.lemmos.filter((m) => m.x > 62 && m.x < 120).length;
  check('a counting door lets two through, then shuts', past === 2 && !!(s4.cells[61 + 12 * 256] & F.METAL), `past=${past}`);
}

// ---------------------------------------------------------------- fluids
{
  const l = flat((set) => { for (let x = 80; x < 90; x++) for (let y = 2; y < 10; y++) set(x, y, F.WATER); });
  l.fluids = [{ ...box(80, 2, 90, 10, 7), type: 'water', mode: 1, levelA: 8, levelB: 0 }];
  l.triggers = [{ ...box(40, 10, 41, 16, 1), kind: 'skill_pad', value: 0, rects: [[7, 4, 0, 0]] }];
  const sim = new Sim(l);
  const water = () => { let n = 0; for (let x = 80; x < 90; x++) for (let y = 2; y < 10; y++) if (sim.cells[x + y * 256] & F.WATER) n++; return n; };
  check('a mode-1 fluid starts drained', water() === 0, `cells=${water()}`);
  walker(l, 35);
  const s = new Sim(l);
  const w = () => { let n = 0; for (let x = 80; x < 90; x++) for (let y = 2; y < 10; y++) if (s.cells[x + y * 256] & F.WATER) n++; return n; };
  runFor(s, 2.5);
  const mid = w();
  runFor(s, 4);
  check('switching it on fills it at 2 rows/s', mid > 0 && mid < 80 && w() === 80, `after ~1.5s ${mid}, later ${w()}`);
  const l2 = flat((set) => { for (let x = 80; x < 90; x++) for (let y = 2; y < 10; y++) set(x, y, F.LAVA); });
  l2.fluids = [{ ...box(80, 2, 90, 10, 7), type: 'lava', mode: 0, levelA: 8, levelB: 0 }];
  l2.triggers = [{ ...box(40, 10, 41, 16, 1), kind: 'skill_pad', value: 0, rects: [[7, 5, 0, 0]] }];
  walker(l2, 45, 10, -1);
  const s2 = new Sim(l2);
  runFor(s2, 30);
  check('switching it off drains it and the Lemmo survives', s2.died === 0 && !(s2.cells[85 + 3 * 256] & F.LAVA), `died ${s2.died}`);
}

// ---------------------------------------------------------------- moving traps
{
  const l = flat();
  l.paths = [{ closed: false, junctions: [], keys: [{ len: 10, n: 1, p: [100, 11], v: [4, 0] }, { len: 0, n: 1, p: [140, 11], v: [0, 0] }] }];
  l.traps = [{ ...box(100, 9, 104, 14, 3), cls: 'DYNA', name: '', anim: 'deathroller', killAll: true, path: 0, path2: -1, box: [-1, -2, 3, 3], speed: 1, seg: 0, s: 0 }];
  bystander(l);
  const sim = new Sim(l);
  const xs: number[] = [];
  runFor(sim, 15, (s) => xs.push(s.traps[0].x));
  const max = Math.max(...xs);
  check('a moving trap follows its path and turns back at the end', max > 138 && xs[xs.length - 1] < max - 10, `max ${max.toFixed(1)} end ${xs[xs.length - 1].toFixed(1)}`);
  const l2 = flat((set) => { for (let y = 10; y < 20; y++) set(120, y, F.EARTH); });
  l2.paths = l.paths;
  l2.traps = l.traps;
  bystander(l2);
  const s2 = new Sim(l2);
  runFor(s2, 8);
  check('it rolls through earth', !(s2.cells[120 + 12 * 256] & F.EARTH));
  const l3 = flat();
  l3.paths = l.paths;
  l3.traps = l.traps;
  walker(l3, 130, 10, -1);
  const s3 = new Sim(l3);
  runFor(s3, 6);
  check('it kills Lemmo\'s it runs over', s3.died === 1);
}

// ---------------------------------------------------------------- speed pads
{
  const l = flat();
  l.triggers = [{ ...box(40, 10, 42, 16, 1), kind: 'kind4', value: null, dir: 0, flag: false, cmd: [-2, 6, 1, 0] }];
  walker(l, 30);
  walker(l, 30.01);
  const sim = new Sim(l);
  sim.lemmos[1].x = 20;
  runFor(sim, 4);
  const [a, b] = sim.lemmos;
  check('a speed pad makes a Lemmo run twice as fast', a.fast > 0 && a.x - b.x > 15, `gap ${(a.x - b.x).toFixed(1)}`);
}

// ---------------------------------------------------------------- spinner (anti-gravity) cells
{
  const mk = (active: boolean) => {
    const l = flat((set) => { set(60, 9, F.EARTH | F.SPIN); set(61, 9, F.EARTH | F.SPIN); });
    l.triggers = [{ ...box(59, 9, 62, 10, 4), kind: 'antigrav', value: null, active }];
    walker(l, 50);
    const s = new Sim(l);
    runFor(s, 3);
    return first(s)!;
  };
  check('a spinner under an enabled anti-gravity zone flips gravity', mk(true).g === -1);
  check('a disabled zone does nothing', mk(false).g === 1);
}

// ---------------------------------------------------------------- special skills
{
  const withSkill = (skill: string, edit?: (set: (x: number, y: number, v: number) => void) => void) => {
    const l = flat(edit);
    l.skills[skill] = 5;
    walker(l, 50);
    return new Sim(l);
  };
  // rocket: a ceiling at rows 30..34 gets a hole
  let s = withSkill('rocket', (set) => { for (let x = 40; x < 80; x++) for (let y = 30; y < 35; y++) set(x, y, F.EARTH); });
  runFor(s, 0.5);
  check('rocket can be given to a walker', s.assign(first(s)!, 'rocket'));
  let rocketed = false;
  runFor(s, 8, (q) => { if (first(q)?.state === 'rocketing') rocketed = true; });
  const holes = (() => { let n = 0; for (let x = 40; x < 80; x++) if (!(s.cells[x + 30 * 256] & F.EARTH)) n++; return n; })();
  check('after the fuse it flies up and blasts the ceiling', rocketed && holes > 0 && s.died === 1, `holes ${holes}`);

  s = withSkill('cartwheel', (set) => { for (let y = 10; y < 20; y++) for (let x = 70; x < 74; x++) set(x, y, F.EARTH); });
  runFor(s, 0.5);
  s.assign(first(s)!, 'cartwheel');
  runFor(s, 3);
  check('cartwheel rolls through a wall', first(s)!.x > 74 && !(s.cells[71 + 11 * 256] & F.EARTH), `x=${first(s)!.x.toFixed(1)}`);
  s = withSkill('cartwheel', (set) => { for (let y = 10; y < 20; y++) set(70, y, F.EARTH | F.METAL); });
  runFor(s, 0.5);
  s.assign(first(s)!, 'cartwheel');
  runFor(s, 3);
  check('but not through metal', first(s)!.x < 70);

  // trampoline: a second Lemmo dropped onto it bounces
  {
    const l = flat();
    l.skills.trampoline = 1;
    walker(l, 60.5);
    const sim = new Sim(l);
    runFor(sim, 0.3);
    check('trampoline can be given', sim.assign(first(sim)!, 'trampoline'));
    sim.lemmos.push({ ...first(sim)!, id: 99, y: 40, state: 'falling', inside: new Set(), blockCells: [], trampCells: [], dir: 1 });
    let bounced = false, peak = 0;
    runFor(sim, 4, (q) => { const b = q.lemmos.find((m) => m.id === 99); if (b?.state === 'bouncing') { bounced = true; peak = Math.max(peak, b.y); } });
    check('a Lemmo falling onto it bounces high', bounced && peak > 25, `peak ${peak.toFixed(1)}`);
    check('and the trampoline turns walkers', first(sim)!.state === 'trampoline');
  }

  s = withSkill('antigrav');
  runFor(s, 0.5);
  s.assign(first(s)!, 'antigrav');
  runFor(s, 0.2);
  check('anti-gravity skill flips the Lemmo', first(s)!.g === -1);

  for (const k of ['faster', 'slower'] as const) {
    const a = withSkill(k);
    runFor(a, 0.5);
    a.assign(first(a)!, k);
    const x0 = first(a)!.x;
    runFor(a, 2);
    const d = first(a)!.x - x0;
    const want = k === 'faster' ? d > 15 : d < 7;
    check(`${k} changes walking speed`, want, `moved ${d.toFixed(1)} in 2 s`);
  }
}

// ---------------------------------------------------------------- campaign levels with switches
for (const f of ['E16_KF_1', 'H10_MT_1', 'M04_KF_1', 'VH16_MT']) {
  const lv = JSON.parse(fs.readFileSync(`public/levels/${f}.json`, 'utf8'));
  const sim = new Sim(lv);
  let ok = true;
  try { runFor(sim, 120, (s) => { if (s.time > 60) s.nuke(); }); } catch { ok = false; }
  check(`${f} runs with its switches and moving parts`, ok);
}

if (failed) {
  console.log(`${failed} mechanic check(s) failed`);
  process.exit(1);
}
console.log('mechanic checks passed');
