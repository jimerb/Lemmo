import fs from 'node:fs';
import { ALL_SKILLS, SPECIALS, Sim } from '../src/sim.ts';
let fails = 0;
const t0 = Date.now();
for (const f of fs.readdirSync('public/levels').filter((f) => f !== 'index.json')) {
  const lv = JSON.parse(fs.readFileSync(`public/levels/${f}`, 'utf8'));
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const sim = new Sim(lv);
  for (const s of SPECIALS) sim.skills[s] = 3; // no shipped level has them, so hand some out
  try {
    for (let i = 0; i < 60 * 240 && !sim.finished; i++) {
      if (i % 30 === 0 && sim.lemmos.length) {
        const l = sim.lemmos[Math.floor(rnd() * sim.lemmos.length)];
        sim.assign(l, ALL_SKILLS[Math.floor(rnd() * ALL_SKILLS.length)]);
      }
      if (i === 60 * 200) sim.nuke();
      sim.step(1 / 60);
      for (const l of sim.lemmos) if (!Number.isFinite(l.x) || !Number.isFinite(l.y)) throw new Error(`NaN lemmo ${l.state}`);
    }
  } catch (e) {
    fails++;
    console.log('FAIL', f, (e as Error).message);
  }
  if (process.argv[2] === '-v') console.log(f, 'saved', sim.saved, '/', sim.total, 'died', sim.died, 'finished', sim.finished);
}
console.log('fails', fails, 'ms', Date.now() - t0);
