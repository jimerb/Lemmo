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

console.log(fails ? `${fails} editor checks failed` : 'editor checks passed');
if (fails) process.exit(1);
