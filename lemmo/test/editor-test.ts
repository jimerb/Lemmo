// Headless checks for the Level Editor's data layer: encoding, templates, validation, import/export,
// and that an editor-built level is actually winnable in the simulation.
import fs from 'node:fs';
import { decodeCells, encodeCells, type LevelData } from '../src/level.ts';
import { F, Sim } from '../src/sim.ts';
import * as U from '../src/userlevels.ts';

let fails = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) fails++;
  console.log(ok ? '  ok ' : 'FAIL ', msg);
};

// RLE round trip on every campaign level
let rt = true;
for (const f of fs.readdirSync('public/levels').filter((f) => f !== 'index.json')) {
  const lv: LevelData = JSON.parse(fs.readFileSync(`public/levels/${f}`, 'utf8'));
  const a = decodeCells(lv);
  const b = decodeCells({ ...lv, grid: { ...lv.grid, cells: encodeCells(a) } });
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) rt = false;
}
check(rt, 'encodeCells/decodeCells round-trips every campaign level');

// blank level: two blocking errors
const blank = U.blankTemplate();
const errs = U.validate(blank).filter((i) => i.severity === 'error');
check(errs.length === 2, `blank level reports missing hatch + exit (${errs.map((e) => e.text).join(' | ')})`);

// starter: valid, not trivially winnable, but winnable with its builders
const starter = U.starterTemplate();
check(!U.validate(starter).some((i) => i.severity !== 'info'), 'starter template has no errors or warnings');
const dry = U.dryRun(starter);
check(dry.saved < starter.toSave, `starter needs skills: dry run saved ${dry.saved}/${dry.total}`);
{
  const sim = new Sim(starter);
  let bridged = false;
  for (let t = 0; t < starter.timeLimit && !sim.finished; t += 1 / 60) {
    // the first walker to reach the pit's edge builds a bridge; everyone else follows it
    const lead = sim.lemmos.find((l) => l.state === 'walking' && Math.floor(l.x) === 106 && l.y === 18);
    if (lead && !bridged) bridged = sim.assign(lead, 'builder');
    sim.step(1 / 60);
  }
  check(sim.saved >= starter.toSave, `starter is winnable with one builder: saved ${sim.saved}/${sim.total} (need ${starter.toSave})`);
}

// validation spots a fatal drop and a buried exit
{
  const l = U.blankTemplate();
  const cells = decodeCells(l);
  for (let x = 0; x < 256; x++) cells[x] = F.EARTH;
  for (let y = 0; y < 6; y++) for (let x = 100; x < 104; x++) cells[x + y * 256] = F.EARTH;
  l.grid.cells = encodeCells(cells);
  l.entrances.push(U.makeEntrance(40, 80));
  l.exits.push(U.makeExit(101, 2));
  const texts = U.validate(l).map((i) => i.text).join(' | ');
  check(/fatal/.test(texts), 'warns about a fatal drop from a hatch');
  check(/buried/.test(texts), 'warns about a buried exit');
}

// export -> import keeps the level identical; junk is rejected
{
  const u = U.newUserLevel(U.starterTemplate(), 'Round <trip>');
  const back = U.importJson(U.exportJson(u));
  check(back.title === 'Round <trip>', 'import keeps the title');
  check(JSON.stringify(decodeCells(back.level)) === JSON.stringify(decodeCells(u.level)), 'import keeps the terrain');
  check(back.level.entrances[0].lemmos === 20 && back.level.toSave === u.level.toSave, 'import keeps hatches and goal');
  let threw = 0;
  for (const bad of ['{}', '[]', '{"grid":{"cols":256,"rows":96,"cells":[[1,5]]}}', 'nope']) {
    try { U.importJson(bad); } catch { threw++; }
  }
  check(threw === 4, 'malformed files are rejected');
}

// remixing a campaign level produces a playable copy
{
  const src = JSON.parse(fs.readFileSync('public/levels/MM_DIG_000.json', 'utf8'));
  const r = U.remixTemplate(src, 'Remix');
  check(!('sounds' in r) && r.entrances.length === 1 && r.exits.length === 1, 'remix copies objects and drops unused data');
  const sim = new Sim(r);
  for (let i = 0; i < 600; i++) sim.step(1 / 60);
  check(sim.lemmos.length > 0, 'remixed level runs in the simulation');
}

// switches, doors and moving traps survive a remix and an export/import round trip
{
  const src: LevelData = JSON.parse(fs.readFileSync('public/levels/VH16_MT.json', 'utf8'));
  const r = U.remixTemplate(src, 'Rollers');
  r.skills.rocket = 2;
  r.skills.trampoline = 1;
  const back = U.importJson(U.exportJson({ id: 'x', title: 'Rollers', created: 0, updated: 0, verified: false, best: 0, level: r })).level;
  check((back.counters?.length ?? 0) === (src.counters?.length ?? 0) && (back.paths?.length ?? 0) === (src.paths?.length ?? 0),
    'doors and trap paths are kept through remix + import');
  check(back.skills.rocket === 2 && back.skills.trampoline === 1, 'special skills are kept through import');
  const sim = new Sim(back);
  check(sim.traps.some((t) => t.moving), 'imported moving traps still move');
}

// machines built with the editor's factories behave in the simulation
{
  const l = U.starterTemplate();
  // a closed door across the path, opened by a lever the Lemmo's walk over first
  const door = U.makeDoor(80, 18, 2, 10);
  door.id = U.freshId(l);
  l.counters = [door];
  const lever = U.makeSwitch(70, 18);
  lever.id = U.freshId(l);
  U.setSwitchLinks(lever, [{ target: door.id, on: true }]);
  l.triggers.push(lever);
  check(lever.value === -1 && JSON.stringify(lever.rects2) === `[[${door.id},4,0,0]]` && JSON.stringify(lever.rects) === `[[${door.id},5,0,0]]`,
    'a lever link opens when it leans right and closes when it leans left');
  check(U.validate(l).every((i) => !/linked/.test(i.text)), 'a linked switch passes the check');
  const sim = new Sim(l);
  const closed = (sim.cells[80 + 20 * 256] & F.METAL) !== 0;
  for (let i = 0; i < 60 * 20; i++) sim.step(1 / 60);
  check(closed && !(sim.cells[80 + 20 * 256] & F.METAL), 'the door starts closed and the lever opens it');

  const lone = U.makeSwitch(30, 18, 'skill_pad');
  lone.id = U.freshId(l);
  l.triggers.push(lone);
  check(U.validate(l).some((i) => /isn't linked/.test(i.text)), 'an unlinked switch is flagged');
  U.setSwitchKind(lone, 'kind2');
  check(lone.delay === 5 && lone.kind === 'kind2', 'switch kind can be changed');

  const pool = U.makePool(150, 10, 'lava', 8, 4);
  pool.mode = 1;
  pool.id = U.freshId(l);
  l.fluids = [pool];
  const s2 = new Sim(l);
  check(!(s2.cells[150 + 11 * 256] & F.LAVA), 'a pool that starts empty has no liquid');

  const roller = U.makeRoller(100, 19);
  roller.id = U.freshId(l);
  roller.track!.push([140, 19]);
  l.traps.push(roller);
  const s3 = new Sim(l);
  const rt = s3.traps.find((t) => t.t.id === roller.id)!;
  const x0 = rt.x;
  for (let i = 0; i < 60 * 3; i++) s3.step(1 / 60);
  check(rt.moving && rt.x > x0 + 10, `an editor roller follows its track (moved ${(rt.x - x0).toFixed(1)})`);
  U.translate(roller, 5, 2);
  check(roller.track![1][0] === 145 && roller.track![1][1] === 21, 'moving a roller moves its track');
  U.translate(door as never, 3, 0);
  check(door.rect[0] === 83 && door.min![0] === 83, 'moving a door moves its rect');
  const ids = [door.id, lever.id, lone.id, pool.id, roller.id];
  check(new Set(ids).size === ids.length, 'every new object gets its own id');
}

// share links
{
  const l = U.starterTemplate();
  l.skills.rocket = 3;
  const u = U.newUserLevel(l, 'Share me');
  const code = await U.shareCode(u);
  const back = await U.fromShareCode(code);
  check(back.title === 'Share me' && back.level.skills.rocket === 3 && /^[\w-]+$/.test(code), `share code round trip (${code.length} chars)`);
  let threw = false;
  try { await U.fromShareCode(code.slice(0, 40)); } catch { threw = true; }
  check(threw, 'a damaged share code is rejected');
}

console.log(fails ? `${fails} editor checks failed` : 'editor checks passed');
if (fails) process.exit(1);
