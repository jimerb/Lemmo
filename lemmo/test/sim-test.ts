// Headless sanity runs of the simulation against real levels.
import fs from 'node:fs';
import { Sim, type Skill } from '../src/sim.ts';

function run(file: string, plan: (sim: Sim) => void, seconds = 400) {
  const level = JSON.parse(fs.readFileSync(`public/levels/${file}.json`, 'utf8'));
  const sim = new Sim(level);
  const states = new Map<string, number>();
  for (let t = 0; t < seconds && !sim.finished; t += 1 / 60) {
    plan(sim);
    sim.step(1 / 60);
    for (const l of sim.lemmings) states.set(l.state, (states.get(l.state) ?? 0) + 1);
  }
  console.log(file, `saved ${sim.saved}/${sim.total} (need ${level.toSave}) died ${sim.died} t=${sim.time.toFixed(1)}`,
    'skills left', JSON.stringify(sim.skills), 'state-ticks', JSON.stringify(Object.fromEntries(states)));
}

const giveAll = (skill: Skill) => (sim: Sim) => { for (const l of sim.lemmings) sim.assign(l, skill); };
run('MM_CLIMB_002', giveAll('climber'));
run('MM_CLIMB_002', () => {});
run('MM_FLOAT', giveAll('floater'));
run('MM_DIG_000', (sim) => { for (const l of sim.lemmings) if (l.state === 'walking' && l.t > 0.5) sim.assign(l, 'digger'); });
run('MM_BASH_002', (sim) => { for (const l of sim.lemmings) if (l.state === 'walking') sim.assign(l, 'basher'); });
