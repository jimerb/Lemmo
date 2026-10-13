import fs from 'node:fs';
import { decodeCells } from '../src/level.ts';
const lv = JSON.parse(fs.readFileSync(`public/levels/${process.argv[2]}.json`, 'utf8'));
const c = decodeCells(lv);
const [x0, x1] = [Number(process.argv[3] ?? 0), Number(process.argv[4] ?? 256)];
const marks = new Map<string, string>();
for (const e of lv.entrances) marks.set(`${e.spawn[0]},${e.spawn[1]}`, 'E');
for (const e of lv.exits) marks.set(`${Math.round(e.pos[0])},${Math.round(e.pos[1])}`, 'X');
for (let y = lv.grid.rows - 1; y >= 0; y--) {
  let s = '';
  for (let x = x0; x < x1; x++) {
    const v = c[x + y * 256];
    s += marks.get(`${x},${y}`) ?? (v & 0x200 ? '~' : v & 0x2000 ? '^' : v & 2 && v & 1 ? 'M' : v & 1 ? '#' : v & 0x80 ? ':' : v ? '?' : ' ');
  }
  console.log(String(y).padStart(2) + '|' + s);
}
console.log(JSON.stringify({ ent: lv.entrances.map((e: any) => [e.spawn, e.dir]), exit: lv.exits.map((e: any) => [e.min, e.max]), skills: lv.skills }));
