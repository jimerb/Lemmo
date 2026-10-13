import fs from 'node:fs';
import { Sim, SKILLS } from '../src/sim.ts';
let fails = 0;
const t0 = Date.now();
for (const f of fs.readdirSync('public/levels').filter((f) => f !== 'index.json')) {
  const lv = JSON.parse(fs.readFileSync(`public/levels/${f}`, 'utf8'));
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const sim = new Sim(lv);
  try {
    for (let i = 0; i < 60 * 240 && !sim.finished; i++) {
      if (i % 30 === 0 && sim.lemmings.length) {
        const l = sim.lemmings[Math.floor(rnd() * sim.lemmings.length)];
        sim.assign(l, SKILLS[Math.floor(rnd() * SKILLS.length)]);
      }
      if (i === 60 * 200) sim.nuke();
      sim.step(1 / 60);
      for (const l of sim.lemmings) if (!Number.isFinite(l.x) || !Number.isFinite(l.y)) throw new Error(`NaN lemming ${l.state}`);
    }
  } catch (e) {
    fails++;
    console.log('FAIL', f, (e as Error).message);
  }
  if (process.argv[2] === '-v') console.log(f, 'saved', sim.saved, '/', sim.total, 'died', sim.died, 'finished', sim.finished);
}
console.log('fails', fails, 'ms', Date.now() - t0);
