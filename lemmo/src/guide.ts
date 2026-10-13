// "How to play" guide: a tabbed, illustrated modal with live animated Lemmo’s for every skill.
import { drawAntigrav, drawEntrance, drawExit, drawLemmo, drawPortal, drawTrap } from './art.ts';
import { ICONS } from './icons.ts';
import { F, type Lemmo, type State } from './sim.ts';
import { CELL_PX, TerrainPainter, THEMES } from './terrain.ts';

type Scene = (c: CanvasRenderingContext2D, w: number, h: number, t: number) => void;

const EARTH = '#a8774b';
const EARTH_TOP = '#7ee08a';
const METAL = '#5c6c80';

function fakeLemmo(state: State, t: number, extra: Partial<Lemmo> = {}): Lemmo {
  return {
    id: 3, x: 0, y: 0, dir: 1, g: 1, type: 0, climber: false, floater: false, state, t, cyc: t % 1,
    fallen: 0, umbrella: false, bricks: 6, empty: 0, bomb: null, inside: new Set(), blockCells: [], ...extra,
  };
}

function ground(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color = EARTH, lip = EARTH_TOP) {
  c.fillStyle = color;
  c.fillRect(x, y, w, h);
  c.fillStyle = lip;
  c.fillRect(x, y, w, 3);
  c.fillStyle = 'rgba(0,0,0,0.18)';
  for (let i = 0; i < w; i += 9) c.fillRect(x + i + ((i * 7) % 5), y + 8 + ((i * 3) % 9), 3, 3);
}

const S = 9; // pixels per grid cell in the illustrations

const SCENES: Record<string, Scene> = {
  walker: (c, w, h, t) => {
    ground(c, 0, h - 22, w, 22);
    const x = ((t * 30) % (w + 40)) - 20;
    drawLemmo(c, fakeLemmo('walking', t), x, h - 22, S, { face: 1, hover: false, time: t });
  },
  climber: (c, w, h, t) => {
    ground(c, 0, h - 18, w, 18);
    c.fillStyle = METAL;
    ground(c, w * 0.58, 18, 34, h - 36, EARTH);
    const k = (t * 0.45) % 1;
    const y = h - 18 - k * (h - 40);
    drawLemmo(c, fakeLemmo('climbing', t, { climber: true }), w * 0.58 - 5, y, S, { face: 1, hover: false, time: t });
  },
  floater: (c, w, h, t) => {
    ground(c, 0, h - 16, w, 16);
    const k = (t * 0.35) % 1;
    const y = 20 + k * (h - 36);
    drawLemmo(c, fakeLemmo('falling', t, { umbrella: k > 0.12, floater: true }), w / 2, y, S, { face: 1, hover: false, time: t });
  },
  bomber: (c, w, h, t) => {
    ground(c, 0, h - 22, w, 22);
    const k = t % 6;
    if (k < 5) {
      const l = fakeLemmo(k > 4.1 ? 'ohno' : 'walking', t, { bomb: 5 - k });
      drawLemmo(c, l, w / 2 + Math.sin(t * 2) * 10, h - 22, S, { face: 1, hover: false, time: t });
    } else {
      const r = (k - 5) * 70;
      const g = c.createRadialGradient(w / 2, h - 30, 0, w / 2, h - 30, r);
      g.addColorStop(0, 'rgba(255,240,180,0.95)');
      g.addColorStop(0.5, 'rgba(255,120,60,0.7)');
      g.addColorStop(1, 'rgba(255,60,90,0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(w / 2, h - 30, r, 0, Math.PI * 2);
      c.fill();
    }
  },
  blocker: (c, w, h, t) => {
    ground(c, 0, h - 22, w, 22);
    drawLemmo(c, fakeLemmo('blocking', t), w / 2, h - 22, S, { face: 1, hover: false, time: t });
    const k = (t * 0.6) % 2;
    const x = k < 1 ? 10 + k * (w / 2 - 30) : w / 2 - 20 - (k - 1) * (w / 2 - 30);
    drawLemmo(c, fakeLemmo('walking', t + 1), x, h - 22, S, { face: k < 1 ? 1 : -1, hover: false, time: t });
  },
  builder: (c, w, h, t) => {
    ground(c, 0, h - 18, w, 18);
    const n = Math.floor(t % 7);
    c.fillStyle = '#e6a46a';
    for (let i = 0; i < n; i++) c.fillRect(20 + i * 2 * S, h - 18 - (i + 1) * S, 2 * S, S);
    const l = fakeLemmo(n < 6 ? 'building' : 'shrugging', t);
    drawLemmo(c, l, 20 + n * 2 * S - 4, h - 18 - n * S, S, { face: 1, hover: false, time: t });
  },
  basher: (c, w, h, t) => {
    ground(c, 0, h - 18, w, 18);
    const k = (t * 0.25) % 1;
    const wallX = w * 0.42;
    const cut = k * (w - wallX - 10);
    c.fillStyle = EARTH;
    c.fillRect(wallX + cut, 14, w - wallX - cut, h - 32);
    c.fillRect(wallX, 14, cut, h - 32 - 4 * S);
    c.fillStyle = EARTH_TOP;
    c.fillRect(wallX, 14, w - wallX, 3);
    drawLemmo(c, fakeLemmo('bashing', t), wallX + cut - 8, h - 18, S, { face: 1, hover: false, time: t });
  },
  miner: (c, w, h, t) => {
    ground(c, 0, 46, w, h - 46);
    const k = (t * 0.25) % 1;
    const steps = Math.floor(k * 7);
    c.fillStyle = '#0d1428';
    for (let i = 0; i <= steps; i++) c.fillRect(30 + i * S, 46 - 4 * S + i * S, S + 2, 5 * S);
    drawLemmo(c, fakeLemmo('mining', t), 30 + steps * S, 46 + steps * S, S, { face: 1, hover: false, time: t });
  },
  digger: (c, w, h, t) => {
    ground(c, 0, 50, w, h - 50);
    const k = (t * 0.2) % 1;
    const depth = k * (h - 60);
    c.fillStyle = '#0d1428';
    c.fillRect(w / 2 - 1.5 * S, 50, 3 * S, depth);
    drawLemmo(c, fakeLemmo('digging', t), w / 2, 50 + depth, S, { face: 1, hover: false, time: t });
  },
  nuke: (c, w, h, t) => {
    ground(c, 0, h - 22, w, 22);
    for (let i = 0; i < 4; i++) {
      const b = 5 - ((t + i * 0.4) % 5);
      drawLemmo(c, fakeLemmo(b < 0.8 ? 'ohno' : 'walking', t + i, { bomb: b }), 22 + i * (w - 44) / 3, h - 22, S * 0.85, { face: i % 2 ? -1 : 1, hover: false, time: t });
    }
  },
  hatch: (c, w, h, t) => {
    drawEntrance(c, w / 2, h - 20, 7, 9, 6, 0, Math.min(1, (t % 4) / 0.5), t);
    if (t % 4 > 0.6) drawLemmo(c, fakeLemmo('falling', t), w / 2, h - 30 + ((t % 4) - 0.6) * 18, 4, { face: 1, hover: false, time: t });
  },
  balloon: (c, w, h, t) => drawExit(c, w / 2, h - 8, 5.5, t),
  trap: (c, w, h, t) => {
    ground(c, 0, h - 18, w, 18);
    drawTrap(c, w / 2, h - 18, 9, 4, t, Math.sin(t * 2) > 0.5);
  },
  antigrav: (c, w, h, t) => {
    ground(c, 0, h - 14, w, 14);
    drawAntigrav(c, w / 2, h - 14, 7, 8, 9, t);
  },
  portal: (c, w, h, t) => {
    ground(c, 0, h - 16, w, 16);
    drawPortal(c, w / 2, h - 16, 9, t);
  },
  rat: (c, w, h, t) => {
    ground(c, 0, h - 20, w, 20);
    const x = ((t * 22) % (w + 40)) - 20;
    drawLemmo(c, fakeLemmo('walking', t, { type: 3 }), x, h - 20, 7, { face: 1, hover: false, time: t });
  },
  swimmer: (c, w, h, t) => {
    c.fillStyle = 'rgba(56,140,255,0.85)';
    c.fillRect(0, h - 26, w, 26);
    c.fillStyle = 'rgba(255,255,255,0.7)';
    c.fillRect(0, h - 26, w, 2);
    const x = ((t * 26) % (w + 40)) - 20;
    drawLemmo(c, fakeLemmo('walking', t, { type: 1 }), x, h - 26, S, { face: 1, hover: false, time: t });
  },
  acidproof: (c, w, h, t) => {
    c.fillStyle = 'rgba(140,240,60,0.85)';
    c.fillRect(0, h - 26, w, 26);
    c.fillStyle = 'rgba(255,255,255,0.6)';
    c.fillRect(0, h - 26, w, 2);
    const x = w - (((t * 26) % (w + 40)) - 20);
    drawLemmo(c, fakeLemmo('walking', t, { type: 2 }), x, h - 26, S, { face: -1, hover: false, time: t });
  },
};

// Terrain swatches rendered with the real terrain painter.
const MATERIALS: [string, number][] = [
  ['earth', F.EARTH], ['metal', F.EARTH | F.METAL], ['oneway', F.EARTH | F.ONEWAY_L], ['nodig', F.EARTH | F.NODIG_DOWN],
  ['water', F.WATER], ['acid', F.ACID], ['lava', F.LAVA],
];
let swatchPainter: TerrainPainter | null = null;
function swatch(kind: string): HTMLCanvasElement {
  const rows = 6;
  if (!swatchPainter) {
    const cells = new Uint32Array(256 * rows);
    MATERIALS.forEach(([, v], i) => {
      for (let x = i * 10 + 1; x < i * 10 + 9; x++) for (let y = 0; y < 5; y++) cells[x + y * 256] = v;
    });
    swatchPainter = new TerrainPainter(cells, rows, THEMES[0]);
  }
  const i = MATERIALS.findIndex(([k]) => k === kind);
  const cv = document.createElement('canvas');
  cv.width = 8 * CELL_PX;
  cv.height = 5 * CELL_PX;
  const c = cv.getContext('2d')!;
  c.drawImage(swatchPainter.color, (i * 10 + 1) * CELL_PX, CELL_PX, 8 * CELL_PX, 5 * CELL_PX, 0, 0, cv.width, cv.height);
  c.globalCompositeOperation = 'lighter';
  c.globalAlpha = 0.5;
  c.drawImage(swatchPainter.glow, (i * 10 + 1) * CELL_PX, CELL_PX, 8 * CELL_PX, 5 * CELL_PX, 0, 0, cv.width, cv.height);
  cv.className = 'swatch';
  return cv;
}

const SKILLS = [
  ['climber', 'Climber', '1', 'Permanent', 'Scales any wall it walks into, then flips over the top. If it bumps its head on an overhang it lets go and falls.'],
  ['floater', 'Floater', '2', 'Permanent', 'Carries an umbrella that opens after a short drop. Survives a fall from any height.'],
  ['bomber', 'Bomber', '3', '5 s fuse', 'Counts down from 5, says “Oh no!” and explodes, blasting a round hole. The Lemmo is lost, and metal survives.'],
  ['blocker', 'Blocker', '4', 'Stays put', 'Plants itself and turns every Lemmo that walks into it. It only moves again if the ground under it disappears.'],
  ['builder', 'Builder', '5', '12 bricks', 'Lays a rising staircase, one brick per step. You hear a chink when the last few bricks are being laid, and it shrugs when done.'],
  ['basher', 'Basher', '6', 'Horizontal', 'Punches a tunnel straight ahead. It stops at metal, at a one-way wall pointing the other way, or when nothing is left to bash.'],
  ['miner', 'Miner', '7', 'Diagonal', 'Swings a pickaxe to dig a tunnel slanting down and forward. Metal stops it.'],
  ['digger', 'Digger', '8', 'Vertical', 'Digs straight down, three cells wide, until it breaks through. It can’t dig metal or hard rock, or while standing in water.'],
] as const;

const WORLD = [
  ['earth', 'Earth', 'Normal ground. Every digging skill can remove it, and builders add more of it.'],
  ['metal', 'Metal', 'Riveted plates. Nothing digs, bashes or blows through it.'],
  ['oneway', 'One-way wall', 'The arrows show the only direction you can bash or mine through it.'],
  ['nodig', 'Hard rock', 'Hatched ground that diggers can’t dig down through.'],
  ['water', 'Water', 'Normal Lemmo’s drown in it. Blue swimmer Lemmo’s walk through safely.'],
  ['acid', 'Acid', 'Dissolves Lemmo’s, except the green acid-proof ones.'],
  ['lava', 'Lava', 'Deadly to every Lemmo. Build or block around it.'],
] as const;

const OBJECTS = [
  ['hatch', 'Hatch', 'Where Lemmo’s drop in. The glow tells you their type: teal for normal, blue for swimmers, green for acid-proof.'],
  ['balloon', 'Balloon', 'The exit. Every Lemmo that reaches the basket counts as saved.'],
  ['swimmer', 'Swimmers', 'Lemmo’s from a blue hatch can wade through water.'],
  ['acidproof', 'Acid-proof', 'Lemmo’s from a green hatch are safe in acid.'],
  ['trap', 'Traps', 'Saws and crushers grab any Lemmo that wanders in, then reset for a moment.'],
  ['antigrav', 'Anti-gravity', 'Flips gravity, so Lemmo’s fall upward and walk on ceilings.'],
  ['portal', 'Portals', 'Step in one and pop out of its twin somewhere else.'],
  ['rat', 'Evil rats', 'They patrol the level and catch any Lemmo they touch. Keep your Lemmo’s away from them.'],
] as const;

const TABS = ['Basics', 'Skills', 'World', 'Controls', 'Tips'] as const;

function scene(name: string, w = 220, h = 120) {
  const cv = document.createElement('canvas');
  cv.className = 'scene';
  cv.dataset.scene = name;
  cv.dataset.w = String(w);
  cv.dataset.h = String(h);
  return cv;
}

function html(tab: (typeof TABS)[number]): string {
  switch (tab) {
    case 'Basics':
      return `
        <h2>Save the Lemmo’s</h2>
        <p class="lead">Lemmo’s drop out of a hatch and march blindly forward. They walk off cliffs, into water and over each other. Give the right Lemmo the right skill at the right moment so enough of them reach the <b>hot-air balloon</b> before time runs out.</p>
        <div class="steps">
          <div class="step"><span class="n">1</span><div><b>Read the briefing</b><p>It shows how many Lemmo’s come out, how many you must save, the time limit and which skills you have.</p></div></div>
          <div class="step"><span class="n">2</span><div><b>Pick a skill</b><p>Click a skill in the dock at the bottom, or press <kbd>1</kbd>–<kbd>8</kbd>. The badge shows how many are left.</p></div></div>
          <div class="step"><span class="n">3</span><div><b>Click a Lemmo</b><p>A green ring marks the Lemmo you’re pointing at. The tooltip tells you what it’s doing and whether it can take the skill.</p></div></div>
          <div class="step"><span class="n">4</span><div><b>Get them home</b><p>Watch the top bar: <b>Out</b> is Lemmo’s still walking, <b>Saved</b> is rescued versus needed, and <b>Time</b> is the clock.</p></div></div>
        </div>
        <div class="callout">
          <div class="cyl">${ICONS.cylinder}</div>
          <div><b>The world is a cylinder.</b> Lemmo unrolls it so the whole level fits on screen. A Lemmo that walks off one side reappears on the other, as the little arrows at the edges show. Press <kbd>V</kbd> to switch to the spinning 3D-style drum.</div>
        </div>`;
    case 'Skills':
      return `
        <h2>Skills</h2>
        <p class="lead">Each level gives you a fixed number of each skill. Climber and Floater stay with a Lemmo for good, and a Lemmo can have both. The others replace whatever it was doing.</p>
        <div class="cards">${SKILLS.map(([id, name, key, tag, text]) => `
          <div class="gcard"><div class="scene-wrap" data-s="${id}"></div>
            <div class="gbody"><div class="ghead">${ICONS[id]}<b>${name}</b><kbd>${key}</kbd><span class="tag">${tag}</span></div><p>${text}</p></div></div>`).join('')}
          <div class="gcard danger"><div class="scene-wrap" data-s="nuke"></div>
            <div class="gbody"><div class="ghead">${ICONS.nuke}<b>Nuke</b><kbd>N</kbd><kbd>N</kbd></div><p>The emergency button: every Lemmo on screen becomes a bomber and no more come out. Click it twice to confirm.</p></div></div>
        </div>`;
    case 'World':
      return `
        <h2>Terrain</h2>
        <div class="mats">${WORLD.map(([id, name, text]) => `<div class="mat"><div data-swatch="${id}"></div><div><b>${name}</b><p>${text}</p></div></div>`).join('')}</div>
        <h2>Things you’ll meet</h2>
        <div class="cards small">${OBJECTS.map(([id, name, text]) => `
          <div class="gcard"><div class="scene-wrap" data-s="${id}"></div><div class="gbody"><b>${name}</b><p>${text}</p></div></div>`).join('')}</div>
        <div class="callout warn"><b>Mind the drop.</b> A Lemmo that falls more than about 30 cells goes splat. Floaters are the exception.</div>`;
    case 'Controls':
      return `
        <h2>Controls</h2>
        <div class="ctable">
          <div><span>Assign the selected skill</span><span>Click a Lemmo</span></div>
          <div><span>Choose a skill</span><span><kbd>1</kbd> – <kbd>8</kbd> or the dock</span></div>
          <div><span>Release rate slower / faster</span><span><kbd>−</kbd> <kbd>+</kbd> or the dock buttons (hold to repeat)</span></div>
          <div><span>Pause / resume</span><span><kbd>P</kbd> or ${ICONS.pause}</span></div>
          <div><span>Fast forward ×1 → ×2 → ×4</span><span><kbd>F</kbd> or ${ICONS.fast}</span></div>
          <div><span>Nuke</span><span><kbd>N</kbd> twice</span></div>
          <div><span>Panorama ↔ cylinder view</span><span><kbd>V</kbd> or ${ICONS.cylinder}</span></div>
          <div><span>Music &amp; effects volume</span><span>${ICONS.sound} in the top bar</span></div>
          <div><span>This guide</span><span><kbd>I</kbd> or the ⓘ button</span></div>
          <div><span>Pause menu (restart, quit)</span><span><kbd>Esc</kbd> or ${ICONS.menu}</span></div>
        </div>
        <h3>In cylinder view</h3>
        <div class="ctable">
          <div><span>Spin the drum / look up and down</span><span>Drag, or <kbd>A</kbd> <kbd>D</kbd> <kbd>W</kbd> <kbd>S</kbd> / arrow keys</span></div>
          <div><span>Zoom</span><span>Mouse wheel, or <kbd>Space</kbd> for a quick close-up</span></div>
          <div><span>Jump anywhere</span><span>Click the minimap</span></div>
        </div>`;
    case 'Tips':
      return `
        <h2>Tips from the island</h2>
        <ul class="tips">
          <li><b>Pause and plan.</b> You can assign skills while paused. Line up the perfect click, then resume.</li>
          <li><b>Hold the crowd.</b> A blocker near the hatch keeps everyone safe while a scout clears the path. Free them later by digging or bombing out the ground under the blocker.</li>
          <li><b>Check the target.</b> You rarely need every Lemmo. The briefing says how many must reach the balloon.</li>
          <li><b>Slow the release.</b> Turn the release rate down to give yourself time. Turn it up when the path is ready.</li>
          <li><b>Look all the way around.</b> The level wraps, so the balloon may be closer going the “wrong” way.</li>
          <li><b>Bridges need room.</b> Builders stop when their head hits a ceiling or a wall. Start them where they have headroom.</li>
          <li><b>Watch the one-way arrows.</b> Bashers and miners only cut through those walls in the arrow’s direction.</li>
          <li><b>Fast-forward the boring bits.</b> Press <kbd>F</kbd> once your Lemmo’s are safely on their way.</li>
        </ul>`;
  }
}

export function openGuide(parent: HTMLElement, onClose?: () => void, start: (typeof TABS)[number] = 'Basics') {
  const back = document.createElement('div');
  back.className = 'modal-back guide-back';
  back.innerHTML = `
    <div class="guide" role="dialog" aria-label="How to play">
      <aside>
        <div class="guide-logo">Lemmo</div>
        <div class="guide-sub">How to play</div>
        <nav>${TABS.map((t) => `<button class="gtab" data-tab="${t}">${t}</button>`).join('')}</nav>
        <button class="btn primary close">Let’s play</button>
      </aside>
      <section class="gcontent"></section>
      <button class="btn icon gx" title="Close (Esc)">✕</button>
    </div>`;
  const content = back.querySelector<HTMLElement>('.gcontent')!;
  let canvases: HTMLCanvasElement[] = [];
  const show = (tab: (typeof TABS)[number]) => {
    back.querySelectorAll<HTMLElement>('.gtab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    content.innerHTML = html(tab);
    content.scrollTop = 0;
    canvases = [];
    content.querySelectorAll<HTMLElement>('[data-s]').forEach((wrap) => {
      const cv = scene(wrap.dataset.s!);
      wrap.append(cv);
      canvases.push(cv);
    });
    content.querySelectorAll<HTMLElement>('[data-swatch]').forEach((d) => d.replaceWith(swatch(d.dataset.swatch!)));
  };
  back.querySelectorAll<HTMLElement>('.gtab').forEach((b) => (b.onclick = () => show(b.dataset.tab as (typeof TABS)[number])));
  let raf = 0;
  const close = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey, true);
    back.remove();
    onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.key.toLowerCase() === 'i') {
      e.stopPropagation();
      e.preventDefault();
      close();
    }
  };
  window.addEventListener('keydown', onKey, true);
  back.querySelector<HTMLElement>('.close')!.onclick = close;
  back.querySelector<HTMLElement>('.gx')!.onclick = close;
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  const t0 = performance.now();
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    const t = (now - t0) / 1000;
    const dpr = Math.min(2, window.devicePixelRatio);
    for (const cv of canvases) {
      const r = cv.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight || !r.width) continue;
      const w = r.width, h = r.height;
      if (cv.width !== Math.round(w * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const c = cv.getContext('2d')!;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, h);
      SCENES[cv.dataset.scene!]?.(c, w, h, t);
    }
  };
  raf = requestAnimationFrame(loop);
  show(start);
  parent.append(back);
  return close;
}
