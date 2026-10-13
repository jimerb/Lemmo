// Copies extracted original-game data into public/ in the shape the game expects.
// Level JSON comes from ../tools/export_levels.py; sounds/music are the original WAVs.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(root, '..');
const out = path.join(root, 'public');

function copyDir(src, dst, filter, rename = (n) => n.toLowerCase()) {
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(src)) {
    if (!filter(f)) continue;
    fs.copyFileSync(path.join(src, f), path.join(dst, rename(f)));
    n++;
  }
  return n;
}

// The converted levels ship with the repo in public/levels. This script is only needed to
// (a) re-export levels after changing the level tools, or (b) add the ORIGINAL sounds and music
// from your own CD, which Lemmo then uses instead of its synthesized audio.
let levels = 0, sounds = 0, music = 0;
const lvSrc = path.join(repo, 'assets/levels');
if (fs.existsSync(path.join(lvSrc, 'index.json'))) {
  const lvDst = path.join(out, 'levels');
  fs.mkdirSync(lvDst, { recursive: true });
  for (const f of fs.readdirSync(lvSrc)) {
    // the bundled index carries Lemmo's own level titles; only create it if it is missing
    if (f === 'index.json' && fs.existsSync(path.join(lvDst, f))) continue;
    const data = JSON.parse(fs.readFileSync(path.join(lvSrc, f), 'utf8'));
    if (data.cylinder) delete data.cylinder.lattice; // the remake builds its own cylinder
    fs.writeFileSync(path.join(lvDst, f), JSON.stringify(data));
    levels++;
  }
}
const sndSrc = path.join(repo, 'extracted/box/SOUNDS');
const musSrc = path.join(repo, 'extracted/box/MUSIC');
if (fs.existsSync(sndSrc)) sounds = copyDir(sndSrc, path.join(out, 'sounds'), (f) => f.endsWith('.WAV'));
if (fs.existsSync(musSrc)) music = copyDir(musSrc, path.join(out, 'music'), (f) => f.endsWith('.WAV'), (n) => n.toLowerCase().replace('lemming', 'track'));
if (!levels && !sounds && !music) {
  console.log(`Nothing to do: no extracted game data found.
The bundled levels in public/levels are already playable. To use the original audio, extract it
from your own CD first (from the repository root):
  python3 tools/lembox.py extract /path/to/cd/<archive> extracted/box
then run "npm run assets" again.`);
  process.exit(0);
}
console.log(`levels ${levels || '(bundled)'}, original sounds ${sounds}, original music ${music}`);
