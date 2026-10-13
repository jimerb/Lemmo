// Level Editor (beta): paint terrain, place objects, set the win conditions, check and test-play
// user levels. Levels use the same LevelData format as the campaign, so Sim and Game run them as-is.
// Only mechanics the simulation supports are offered (see README "Known gaps"): static fluids,
// static saw traps, anti-gravity fields and teleporters paired in file order.
import './editor.css';
import { drawAntigrav, drawEntrance, drawExit, drawLemmo, drawPortal, drawTrap } from './art.ts';
import { fmtTime } from './game.ts';
import { ICONS } from './icons.ts';
import {
  decodeCells, encodeCells, loadLevel, TIERS, tierOf, type EntranceData, type Footprint, type LevelData,
  type LevelIndexEntry, type TriggerData,
} from './level.ts';
import { F, SKILLS, SPLAT_ROWS, type Lemmo } from './sim.ts';
import { CELL_PX, TerrainPainter, THEMES, themeFor } from './terrain.ts';
import * as U from './userlevels.ts';

const { COLS, ROWS } = U;

export interface EditorNav {
  menu(): void;
  hub(): void;
  edit(id: string): void;
  play(id: string, test: boolean): void;
  campaign(): LevelIndexEntry[];
}

// ------------------------------------------------------------------ helpers
export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const wrap = (x: number) => ((x % COLS) + COLS) % COLS;

const svg = (body: string) =>
  `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const EICONS: Record<string, string> = {
  select: svg('<path d="M8 4l16 11-7 2-3 8z" fill="currentColor" fill-opacity=".2"/>'),
  brush: svg('<path d="M27 5L14 18"/><path d="M14 18c-4-1-7 2-7 5 0 2-2 3-3 3 4 2 12 1 10-8z" fill="currentColor" fill-opacity=".3"/>'),
  eraser: svg('<path d="M19 5l9 9-12 12H9l-5-5z"/><path d="M12 12l9 9"/><path d="M16 27h12"/>'),
  rect: svg('<rect x="5" y="8" width="22" height="16" rx="2" fill="currentColor" fill-opacity=".25"/>'),
  fill: svg('<path d="M5 14l9-9 11 11-9 9z" fill="currentColor" fill-opacity=".2"/><path d="M27 19c0 3 3 5 3 7a3 3 0 0 1-6 0c0-2 3-4 3-7z" fill="#5ab0ff" stroke="#5ab0ff"/>'),
  pan: svg('<path d="M10 17V8a2 2 0 0 1 4 0v7M14 14V6a2 2 0 0 1 4 0v8M18 14V8a2 2 0 0 1 4 0v8M22 15v-3a2 2 0 0 1 4 0v7c0 6-4 10-9 10s-7-3-10-8l-2-4a2 2 0 0 1 3-2l2 3"/>'),
  entrance: svg('<rect x="5" y="4" width="22" height="13" rx="3"/><path d="M11 17v3M21 17v3"/><path d="M16 20v8M13 25l3 3 3-3" stroke="#5df2b0"/>'),
  exit: svg('<path d="M16 3c-6 0-9 4-9 8 0 5 6 8 9 10 3-2 9-5 9-10 0-4-3-8-9-8z" fill="#ff7a59" fill-opacity=".35"/><path d="M12 21l1 4M20 21l-1 4"/><rect x="11" y="25" width="10" height="4" rx="1"/>'),
  trap: svg('<circle cx="16" cy="13" r="7" stroke-dasharray="3 2"/><circle cx="16" cy="13" r="2" fill="#ff3b5c" stroke="#ff3b5c"/><path d="M5 27h22v-4H5z"/>'),
  antigrav: svg('<rect x="7" y="4" width="18" height="24" rx="3" stroke-dasharray="3 3" stroke="#3de7ff"/><path d="M11 18l5-5 5 5M11 25l5-5 5 5"/>'),
  portal: svg('<ellipse cx="11" cy="16" rx="5" ry="9" stroke="#be78ff"/><ellipse cx="23" cy="16" rx="4" ry="7" stroke="#be78ff" stroke-opacity=".6"/>'),
  undo: svg('<path d="M9 13h12a6 6 0 0 1 0 12h-6"/><path d="M13 8l-5 5 5 5"/>'),
  redo: svg('<path d="M23 13H11a6 6 0 0 0 0 12h6"/><path d="M19 8l5 5-5 5"/>'),
  plus: svg('<path d="M16 6v20M6 16h20"/>'),
  trash: svg('<path d="M6 9h20M12 9V5h8v4M8 9l2 18h12l2-18"/>'),
  download: svg('<path d="M16 4v16M9 13l7 7 7-7M6 27h20"/>'),
  upload: svg('<path d="M16 22V6M9 13l7-7 7 7M6 27h20"/>'),
  edit: svg('<path d="M22 5l5 5-15 15-7 2 2-7z"/><path d="M19 8l5 5"/>'),
  copy: svg('<rect x="10" y="10" width="16" height="17" rx="2"/><path d="M6 21V7a2 2 0 0 1 2-2h12"/>'),
  grid: svg('<rect x="4" y="4" width="24" height="24" rx="3"/><path d="M4 12h24M4 20h24M12 4v24M20 4v24" stroke-opacity=".6"/>'),
  fit: svg('<path d="M4 11V4h7M21 4h7v7M28 21v7h-7M11 28H4v-7"/>'),
  check: svg('<path d="M6 17l6 6 14-14"/>'),
  minus: svg('<path d="M6 16h20"/>'),
  more: svg('<circle cx="8" cy="16" r="1.6" fill="currentColor"/><circle cx="16" cy="16" r="1.6" fill="currentColor"/><circle cx="24" cy="16" r="1.6" fill="currentColor"/>'),
};

export const BETA = '<span class="beta">Beta</span>';

// ------------------------------------------------------------------ materials & tools
interface Material { id: string; name: string; v: number; desc: string; swatch: string }

const MATERIALS: Material[] = [
  { id: 'earth', name: 'Earth', v: F.EARTH, desc: 'Ordinary ground. Every digging skill cuts through it.', swatch: '' },
  { id: 'steel', name: 'Steel', v: F.EARTH | F.METAL, desc: 'Indestructible. Bashers, miners, diggers and bombs can\'t break it.', swatch: '' },
  { id: 'hard', name: 'Hard earth', v: F.EARTH | F.NODIG_DOWN | F.NODIG_UP, desc: 'Can be bashed and mined, but not dug down through.', swatch: '' },
  { id: 'owl', name: 'One-way ←', v: F.EARTH | F.ONEWAY_R, desc: 'Bashers and miners can only tunnel through it leftwards.', swatch: '←' },
  { id: 'owr', name: 'One-way →', v: F.EARTH | F.ONEWAY_L, desc: 'Bashers and miners can only tunnel through it rightwards.', swatch: '→' },
  { id: 'water', name: 'Water', v: F.WATER, desc: 'Drowns Lemmo\'s, except swimmers.', swatch: '' },
  { id: 'lava', name: 'Lava', v: F.LAVA, desc: 'Burns every Lemmo that touches it.', swatch: '' },
  { id: 'acid', name: 'Acid', v: F.ACID, desc: 'Dissolves Lemmo\'s, except acid-proof ones.', swatch: '' },
  { id: 'field', name: 'Force field', v: F.BARRIER, desc: 'Walkers turn around at it. Lemmo\'s can fall through it.', swatch: '' },
];

function materialName(v: number) {
  if (!v) return 'Empty';
  const m = MATERIALS.find((m) => m.v === v)
    ?? (v & F.METAL && v & F.EARTH ? MATERIALS[1] : v & F.LAVA ? MATERIALS[6] : v & F.ACID ? MATERIALS[7] : v & F.WATER ? MATERIALS[5] : v & F.EARTH ? MATERIALS[0] : v & F.BARRIER ? MATERIALS[8] : null);
  return m?.name ?? 'Special';
}

function swatchCss(m: Material, theme = THEMES[0]) {
  const rgb = (c: number[]) => `rgb(${c.join(',')})`;
  switch (m.id) {
    case 'earth': return `linear-gradient(${theme.lip} 0 3px, ${rgb(theme.earthTop)} 3px)`;
    case 'steel': return `repeating-linear-gradient(90deg, ${rgb(theme.metal)} 0 7px, rgba(0,0,0,.35) 7px 8px)`;
    case 'hard': return `radial-gradient(rgba(0,0,0,.35) 1px, transparent 1.5px) 0 0/4px 4px, ${rgb(theme.earthTop)}`;
    case 'owl': case 'owr': return rgb(theme.earthBottom);
    case 'water': return 'linear-gradient(#fff 0 2px, #388cff 2px)';
    case 'lava': return 'linear-gradient(#ffd0a0 0 2px, #ff6020 2px)';
    case 'acid': return 'linear-gradient(#eaffd0 0 2px, #8cf03c 2px)';
    default: return 'linear-gradient(90deg, transparent 30%, #ff50dc 30% 70%, transparent 70%)';
  }
}

type Tool = 'select' | 'brush' | 'eraser' | 'rect' | 'fill' | 'pan' | 'entrance' | 'exit' | 'trap' | 'antigrav' | 'portal';
type ListKey = 'entrances' | 'exits' | 'traps' | 'triggers' | 'teleporters';

const TOOLS: { id: Tool; name: string; key?: string; hint: string }[] = [
  { id: 'select', name: 'Select', key: 'V', hint: 'Click an object to edit it · drag to move · arrow keys nudge · Delete removes' },
  { id: 'brush', name: 'Brush', key: 'B', hint: 'Drag to paint · right-drag erases · [ and ] change the size · 1–9 pick a material' },
  { id: 'eraser', name: 'Eraser', key: 'E', hint: 'Drag to clear cells back to empty air · [ and ] change the size' },
  { id: 'rect', name: 'Box', key: 'R', hint: 'Drag a box to fill it with the material · right-drag clears a box' },
  { id: 'fill', name: 'Fill', key: 'F', hint: 'Click empty space to pour material up to that height · click terrain to recolour it' },
  { id: 'pan', name: 'Hand', key: 'H', hint: 'Drag to scroll (or hold Space) · wheel zooms · the world wraps around left and right' },
  { id: 'entrance', name: 'Hatch', hint: 'Click to place a hatch. Lemmo\'s drop from its bottom; the dotted line shows where they land' },
  { id: 'exit', name: 'Exit', hint: 'Click to place an exit. It snaps onto the ground below the cursor' },
  { id: 'trap', name: 'Trap', hint: 'Click to place a saw trap. It snaps onto the ground and catches one Lemmo at a time' },
  { id: 'antigrav', name: 'Anti-grav', hint: 'Click to place an anti-gravity field. Lemmo\'s passing through it flip upside down' },
  { id: 'portal', name: 'Teleport', hint: 'Click once for the first end, then again for its partner' },
];
const PLACE_LIST: Partial<Record<Tool, ListKey>> = {
  entrance: 'entrances', exit: 'exits', trap: 'traps', antigrav: 'triggers', portal: 'teleporters',
};
const KIND: Record<ListKey, string> = {
  entrances: 'Hatch', exits: 'Exit', traps: 'Trap', triggers: 'Anti-gravity field', teleporters: 'Teleporter',
};
const DRAW_ORDER: ListKey[] = ['triggers', 'teleporters', 'traps', 'exits', 'entrances'];
const TERRAIN_TOOLS: Tool[] = ['brush', 'eraser', 'rect', 'fill'];
const SKILL_LABEL: Record<string, string> = {
  climber: 'Climber', floater: 'Floater', bomber: 'Bomber', blocker: 'Blocker', builder: 'Builder', basher: 'Basher', miner: 'Miner', digger: 'Digger',
};

interface Sel { list: ListKey; i: number }
interface Snap { cells: Uint32Array; meta: string }

// Camera/tool state survives a round trip to test play.
const memory = new Map<string, { view: { ppu: number; c0: number; r0: number }; tool: Tool; material: number; brush: number }>();

// ------------------------------------------------------------------ the editor screen
export class Editor {
  readonly root = h('div', 'screen editor');
  private level: LevelData;
  private cells: Uint32Array;
  private painter: TerrainPainter;
  private canvas = h('canvas', 'ed-canvas');
  private ctx = this.canvas.getContext('2d')!;
  private stage = h('div', 'ed-stage');
  private panel = h('div', 'ed-panel');
  private tabsEl = h('div', 'ed-tabs');
  private ui: Record<string, HTMLElement> = {};
  private w = 1;
  private h = 1;
  private dpr = 1;
  private view = { ppu: 4, c0: 0, r0: 0 };
  private fitted = false;
  private tool: Tool = 'brush';
  private material = 0;
  private brush = 3;
  private square = false;
  private onlyEmpty = false;
  private showGrid = true;
  private tab: 'tool' | 'level' | 'check' = 'tool';
  private sel: Sel | null = null;
  private hoverObj: Sel | null = null;
  private pendingPortal: number | null = null;
  private undoStack: Snap[] = [];
  private redoStack: Snap[] = [];
  private changed = new Set<number>();
  private mouse = { x: -1, y: -1, col: 0, row: 0, inside: false };
  private drag:
    | { kind: 'pan'; sx: number; sy: number; c0: number; r0: number }
    | { kind: 'paint'; erase: boolean; last: [number, number] | null }
    | { kind: 'rect'; erase: boolean; x0: number; y0: number }
    | { kind: 'move'; sel: Sel; x0: number; y0: number; orig: string; moved: boolean }
    | null = null;
  private space = false;
  private raf = 0;
  private saveTimer = 0;
  private dry: U.DryRun | null = null;
  private resizeObs: ResizeObserver;

  constructor(private u: U.UserLevel, private nav: EditorNav) {
    this.level = structuredClone(u.level);
    this.level.title = u.title;
    this.cells = decodeCells(this.level);
    this.painter = new TerrainPainter(this.cells, ROWS, this.theme);
    const mem = memory.get(u.id);
    if (mem) {
      Object.assign(this, { tool: mem.tool, material: mem.material, brush: mem.brush });
      this.view = { ...mem.view };
      this.fitted = true;
    }
    this.build();
    this.bind();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.stage);
    this.raf = requestAnimationFrame(() => this.frame());
  }

  private get theme() {
    return themeFor(this.level.name, this.level.theme);
  }

  destroy() {
    this.flushSave();
    memory.set(this.u.id, { view: { ...this.view }, tool: this.tool, material: this.material, brush: this.brush });
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.root.remove();
  }

  // ------------------------------------------------------------------ DOM
  private build() {
    const top = h('div', 'topbar ed-top');
    const back = h('button', 'btn icon', ICONS.back);
    back.title = 'Back to your levels';
    back.onclick = () => this.nav.hub();
    const title = h('input', 'ed-title') as HTMLInputElement;
    title.value = this.u.title;
    title.maxLength = 60;
    title.placeholder = 'Level name';
    title.oninput = () => {
      this.u.title = this.level.title = title.value.trim() || 'Untitled level';
      this.scheduleSave();
    };
    const badge = h('span', 'ed-badge');
    this.ui.badge = badge;
    const saved = h('span', 'ed-saved', 'Saved');
    this.ui.saved = saved;
    const undo = h('button', 'btn icon', EICONS.undo);
    undo.title = 'Undo (Ctrl+Z)';
    undo.onclick = () => this.undo();
    const redo = h('button', 'btn icon', EICONS.redo);
    redo.title = 'Redo (Ctrl+Shift+Z)';
    redo.onclick = () => this.redo();
    this.ui.undo = undo;
    this.ui.redo = redo;
    const help = h('button', 'btn icon', ICONS.info);
    help.title = 'Editor help (?)';
    help.onclick = () => this.showHelp();
    const test = h('button', 'btn primary', `${ICONS.play} Test play`);
    test.title = 'Play your level (T). Beat it once to verify it.';
    test.onclick = () => this.testPlay();
    top.append(back, title, badge, h('div', 'spacer'), saved, undo, redo, help, test);

    const tools = h('div', 'ed-tools');
    const group = (label: string, ids: Tool[]) => {
      tools.append(h('div', 'ed-glabel', label));
      for (const id of ids) {
        const t = TOOLS.find((x) => x.id === id)!;
        const b = h('button', 'ed-tool', `${EICONS[id]}<span>${t.name}</span>`);
        b.title = `${t.name}${t.key ? ` (${t.key})` : ''}: ${t.hint}`;
        b.onclick = () => this.setTool(id);
        this.ui['tool_' + id] = b;
        tools.append(b);
      }
    };
    group('Terrain', ['select', 'brush', 'eraser', 'rect', 'fill', 'pan']);
    group('Objects', ['entrance', 'exit', 'trap', 'antigrav', 'portal']);

    const hint = h('div', 'ed-hint');
    const status = h('div', 'ed-status');
    const zoom = h('div', 'ed-zoom');
    const zb = (icon: string, tip: string, fn: () => void) => {
      const b = h('button', 'btn icon', icon);
      b.title = tip;
      b.onclick = fn;
      zoom.append(b);
      return b;
    };
    zb(EICONS.minus, 'Zoom out (−)', () => this.zoomBy(1 / 1.4));
    const zlabel = h('span', 'ed-zlabel');
    zoom.append(zlabel);
    zb(EICONS.plus, 'Zoom in (+)', () => this.zoomBy(1.4));
    zb(EICONS.fit, 'Fit the whole level (0)', () => this.fit());
    const gridBtn = zb(EICONS.grid, 'Toggle grid (G)', () => this.toggleGrid());
    Object.assign(this.ui, { hint, status, zlabel, gridBtn });
    this.stage.append(this.canvas, hint, status, zoom);

    const side = h('div', 'ed-side');
    side.append(this.tabsEl, this.panel);
    const body = h('div', 'ed-body');
    body.append(tools, this.stage, side);
    const toast = h('div', 'toast');
    toast.style.opacity = '0';
    this.ui.toast = toast;
    this.root.append(top, body, toast);
    this.canvas.oncontextmenu = (e) => e.preventDefault();
    this.refreshChrome();
    this.renderPanel();
  }

  private toast(msg: string) {
    const t = this.ui.toast;
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout((t as any)._h);
    (t as any)._h = setTimeout(() => (t.style.opacity = '0'), 2200);
  }

  /** Update everything outside the side panel that reflects state. */
  private refreshChrome() {
    for (const t of TOOLS) this.ui['tool_' + t.id].classList.toggle('active', t.id === this.tool);
    this.ui.hint.textContent = TOOLS.find((t) => t.id === this.tool)!.hint;
    this.ui.gridBtn.classList.toggle('active', this.showGrid);
    this.ui.zlabel.textContent = `${Math.round((this.view.ppu / CELL_PX) * 100)}%`;
    this.ui.undo.toggleAttribute('disabled', !this.undoStack.length);
    this.ui.redo.toggleAttribute('disabled', !this.redoStack.length);
    const v = this.u.verified;
    this.ui.badge.className = `ed-badge ${v ? 'ok' : ''}`;
    this.ui.badge.innerHTML = v ? `${EICONS.check} Verified` : 'Not verified';
    this.ui.badge.title = v ? 'You have beaten this version of the level.' : 'Beat your level in Test play to verify that it can be won.';
    this.canvas.style.cursor = this.tool === 'pan' || this.space ? (this.drag?.kind === 'pan' ? 'grabbing' : 'grab')
      : this.tool === 'select' ? (this.hoverObj ? 'move' : 'default') : 'crosshair';
  }

  // ------------------------------------------------------------------ side panel
  /** Tab labels: the tool/selection name, and the problem count on Check. Updated in place so clicks never land on a stale button. */
  private updateTabs(issues = U.validate(this.liveLevel(), this.cells)) {
    if (!this.tabsEl.childElementCount) {
      for (const id of ['tool', 'level', 'check'] as const) {
        const b = h('button', 'tab');
        b.onclick = () => {
          this.tab = id;
          this.renderPanel();
        };
        this.ui['tab_' + id] = b;
        this.tabsEl.append(b);
      }
    }
    const errors = issues.filter((i) => i.severity === 'error').length;
    const warns = issues.filter((i) => i.severity === 'warn').length;
    this.ui.tab_tool.textContent = this.sel ? KIND[this.sel.list] : TOOLS.find((t) => t.id === this.tool)!.name;
    this.ui.tab_level.textContent = 'Win rules';
    this.ui.tab_check.innerHTML = `Check${errors ? ` <i class="dot bad">${errors}</i>` : warns ? ` <i class="dot warn">${warns}</i>` : ' <i class="dot good">✓</i>'}`;
    for (const id of ['tool', 'level', 'check']) this.ui['tab_' + id].classList.toggle('active', this.tab === id);
  }

  private renderPanel() {
    const issues = U.validate(this.liveLevel(), this.cells);
    this.updateTabs(issues);
    const p = this.panel;
    p.innerHTML = '';
    if (this.tab === 'tool') this.renderToolTab();
    else if (this.tab === 'level') this.renderLevelTab();
    else this.renderCheckTab(p, issues);
  }

  private section(title: string, html = '') {
    const s = h('div', 'ed-section', `<h4>${title}</h4>${html}`);
    this.panel.append(s);
    return s;
  }

  /** A labelled slider. Pushes one undo step per drag. */
  private range(label: string, min: number, max: number, value: number, fmt: (v: number) => string, set: (v: number) => void, step = 1) {
    const r = h('label', 'ed-field', `<span>${label}</span><b>${fmt(value)}</b><input type="range" min="${min}" max="${max}" step="${step}" value="${value}">`);
    const inp = r.querySelector('input')!, val = r.querySelector('b')!;
    let armed = true;
    inp.oninput = () => {
      if (armed) this.pushUndo();
      armed = false;
      const v = Number(inp.value);
      set(v);
      val.textContent = fmt(v);
      this.touched();
    };
    inp.onchange = () => {
      armed = true;
      this.renderPanel();
    };
    return r;
  }

  private seg<T>(options: [T, string][], current: T, set: (v: T) => void) {
    const s = h('div', 'ed-seg');
    for (const [v, label] of options) {
      const b = h('button', v === current ? 'active' : '', label);
      b.onclick = () => {
        if (v === current) return;
        this.pushUndo();
        set(v);
        this.touched();
        this.renderPanel();
      };
      s.append(b);
    }
    return s;
  }

  private renderToolTab() {
    if (this.sel) {
      this.renderSelection();
      return;
    }
    const t = this.tool;
    if (TERRAIN_TOOLS.includes(t) && t !== 'eraser') {
      const s = this.section('Material');
      const grid = h('div', 'mat-grid');
      MATERIALS.forEach((m, i) => {
        const b = h('button', `mat ${i === this.material ? 'active' : ''}`,
          `<i style="background:${swatchCss(m, this.theme)}">${m.swatch}</i><span>${m.name}</span><kbd>${i + 1}</kbd>`);
        b.title = m.desc;
        b.onclick = () => this.setMaterial(i);
        grid.append(b);
      });
      s.append(grid, h('p', 'ed-note', MATERIALS[this.material].desc));
    }
    if (t === 'brush' || t === 'eraser') {
      const s = this.section('Brush');
      const r = h('label', 'ed-field', `<span>Size</span><b>${this.brush}</b><input type="range" min="1" max="16" value="${this.brush}">`);
      const inp = r.querySelector('input')!;
      inp.oninput = () => {
        this.brush = Number(inp.value);
        r.querySelector('b')!.textContent = String(this.brush);
      };
      const shape = h('div', 'ed-seg');
      for (const [sq, label] of [[false, 'Round'], [true, 'Square']] as const) {
        const b = h('button', sq === this.square ? 'active' : '', label);
        b.onclick = () => {
          this.square = sq;
          this.renderPanel();
        };
        shape.append(b);
      }
      s.append(r, shape);
    }
    if (t === 'brush' || t === 'rect') {
      const s = this.section('Options');
      const c = h('label', 'ed-check', `<input type="checkbox" ${this.onlyEmpty ? 'checked' : ''}><span>Only paint into empty space</span>`);
      c.querySelector('input')!.onchange = (e) => (this.onlyEmpty = (e.target as HTMLInputElement).checked);
      s.append(c);
    }
    if (t === 'fill') this.section('How fill works', `<p class="ed-note">Click <b>empty space</b> and the material pours in like a liquid: it fills the connected gap up to the height you clicked. Great for pools of water, lava or acid.</p><p class="ed-note">Click <b>terrain</b> to recolour all of that connected material, e.g. turn a wall of earth into steel.</p>`);
    if (t === 'select' || t === 'pan') this.renderObjectList();
    const place = PLACE_LIST[t];
    if (place) {
      const info: Record<ListKey, string> = {
        entrances: 'Lemmo\'s drop out of the hatch at the release rate. Set how many come out, which way they walk and what kind they are after placing it. The dotted line shows where they land: it turns red if the drop is fatal.',
        exits: 'Every Lemmo that walks into an exit is saved. Players win by saving enough of them before time runs out.',
        traps: 'A spinning saw that kills one Lemmo, then needs 1.5 seconds to reset. Static: it doesn\'t move.',
        triggers: 'Lemmo\'s that enter the field have gravity flipped: they fall up and walk on ceilings until they pass through another field.',
        teleporters: 'Teleporters come in pairs: a Lemmo entering one end pops out of the other. Place the first end, then click again for its partner.',
      };
      this.section(KIND[place], `<p class="ed-note">${info[place]}</p>`);
      this.renderObjectList();
    }
  }

  private renderObjectList() {
    const items: string[] = [];
    for (const list of [...DRAW_ORDER].reverse()) {
      this.level[list].forEach((f, i) => {
        if (list === 'triggers' && (f as TriggerData).kind !== 'antigrav') return;
        const label = list === 'teleporters' ? `Teleporter ${(i >> 1) + 1}${i % 2 ? 'B' : 'A'}` : `${KIND[list]} ${this.ordinal(list, i)}`;
        items.push(`<button class="ed-obj" data-l="${list}" data-i="${i}">${EICONS[toolOf(list)]}<span>${label}</span><small>${Math.round(f.pos[0])}, ${Math.round(f.min[1])}</small></button>`);
      });
    }
    const s = this.section('Objects in this level', items.length ? `<div class="ed-objs">${items.join('')}</div>` : '<p class="ed-note">None yet. Use the object tools on the left to add a hatch and an exit.</p>');
    s.querySelectorAll<HTMLElement>('.ed-obj').forEach((b) => {
      b.onclick = () => {
        this.select({ list: b.dataset.l as ListKey, i: Number(b.dataset.i) });
        const f = this.level[this.sel!.list][this.sel!.i];
        this.centerOn(f.pos[0], f.min[1] + 3);
      };
    });
  }

  private ordinal(list: ListKey, i: number) {
    if (list !== 'triggers') return i + 1;
    return this.level.triggers.slice(0, i + 1).filter((t) => t.kind === 'antigrav').length;
  }

  private renderSelection() {
    const { list, i } = this.sel!;
    const f = this.level[list][i];
    const head = h('div', 'ed-selhead', `${EICONS[toolOf(list)]}<b>${list === 'teleporters' ? `Teleporter ${(i >> 1) + 1}${i % 2 ? 'B' : 'A'}` : `${KIND[list]} ${this.ordinal(list, i)}`}</b><small>Column ${Math.round(f.pos[0])} · Row ${Math.round(f.min[1])}</small>`);
    const desel = h('button', 'btn icon ghost', '✕');
    desel.title = 'Deselect (Esc)';
    desel.onclick = () => this.select(null);
    head.append(desel);
    this.panel.append(head);
    if (list === 'entrances') {
      const e = f as EntranceData;
      const s = this.section('Hatch');
      s.append(
        this.range('Lemmo\'s', 1, 100, e.lemmos, String, (v) => {
          e.lemmos = v;
          this.level.toSave = Math.min(this.level.toSave, Math.max(1, U.totalLemmos(this.level)));
        }),
        this.range('Release rate', 1, 99, e.releaseRate, (v) => `${v} · ${v < 30 ? 'slow' : v < 70 ? 'medium' : 'fast'}`, (v) => (e.releaseRate = v)),
        h('div', 'ed-label', 'They walk'),
        this.seg<number>([[-1, '← Left'], [1, 'Right →']], e.dir, (v) => (e.dir = v)),
        h('div', 'ed-label', 'Kind of Lemmo'),
        this.seg<number>([[0, 'Normal'], [1, 'Swimmer'], [2, 'Acid-proof']], e.lemType, (v) => (e.lemType = v)),
        h('p', 'ed-note', 'Players can raise the release rate during play, and lower it down to 1.'),
      );
    } else if (list === 'triggers') {
      const t = f as TriggerData;
      const s = this.section('Field size');
      s.append(
        this.range('Width', 1, 24, t.max[0] - t.min[0] + 1, String, (v) => (t.max[0] = t.min[0] + v - 1)),
        this.range('Height', 1, 24, t.max[1] - t.min[1] + 1, String, (v) => (t.max[1] = t.min[1] + v - 1)),
        h('p', 'ed-note', 'Gravity flips once each time a Lemmo enters the field.'),
      );
    } else if (list === 'teleporters') {
      const partner = this.level.teleporters[i ^ 1];
      this.section('Teleporter', `<p class="ed-note">${partner
        ? `Lemmo's entering this end appear at end ${i % 2 ? 'A' : 'B'} (column ${Math.round(partner.pos[0])}, row ${Math.round(partner.min[1])}), and the other way round.`
        : 'This end has no partner yet, so it does nothing. Click in the level to place its partner.'}</p>`);
    } else if (list === 'exits') {
      this.section('Exit', '<p class="ed-note">Lemmo\'s walking or falling into the basket are saved. You can have several exits.</p>');
    } else {
      this.section('Saw trap', '<p class="ed-note">Kills one Lemmo, then resets after 1.5 seconds. Lemmo\'s just walk past while it resets.</p>');
    }
    const del = h('button', 'btn ed-danger', `${EICONS.trash} Delete ${list === 'teleporters' ? 'teleporter pair' : KIND[list].toLowerCase()}`);
    del.onclick = () => this.deleteSelected();
    this.panel.append(del);
  }

  private renderLevelTab() {
    const l = this.level;
    const total = U.totalLemmos(l);
    const s1 = this.section('How players win');
    s1.append(h('p', 'ed-note', `Players win by guiding at least <b>${l.toSave}</b> of the <b>${total}</b> Lemmo's into an exit before the clock runs out.`));
    if (total > 0) {
      s1.append(this.range('Lemmo\'s to save', 1, Math.max(1, total), clamp(l.toSave, 1, total),
        (v) => `${v} of ${total} · ${Math.round((v / total) * 100)}%`, (v) => (l.toSave = v)));
    } else {
      s1.append(h('p', 'ed-note warn', 'Place a hatch first: the number of Lemmo\'s comes from your hatches.'));
    }
    s1.append(this.range('Time limit', 30, 900, l.timeLimit, fmtTime, (v) => (l.timeLimit = v), 15));
    if (l.entrances.length > 1) s1.append(h('p', 'ed-note', `${l.entrances.length} hatches release ${total} Lemmo's in total. Select a hatch to change its count.`));

    const s2 = this.section('Skills available');
    const quick = h('div', 'ed-quick');
    for (const [label, n] of [['None', 0], ['2 each', 2], ['5 each', 5], ['10 each', 10]] as const) {
      const b = h('button', 'btn', label);
      b.onclick = () => {
        this.pushUndo();
        for (const k of SKILLS) l.skills[k] = n;
        this.touched();
        this.renderPanel();
      };
      quick.append(b);
    }
    s2.append(quick);
    const rows = h('div', 'ed-skills');
    for (const k of SKILLS) {
      const r = h('div', `ed-skill ${(l.skills[k] ?? 0) ? '' : 'zero'}`, `${ICONS[k]}<span>${SKILL_LABEL[k]}</span>`);
      const minus = h('button', 'btn', '−');
      const count = h('b', '', String(l.skills[k] ?? 0));
      const plus = h('button', 'btn', '+');
      const bump = (d: number) => (e: MouseEvent) => {
        const v = clamp((l.skills[k] ?? 0) + d * (e.shiftKey ? 5 : 1), 0, 99);
        if (v === (l.skills[k] ?? 0)) return;
        this.pushUndo();
        l.skills[k] = v;
        count.textContent = String(v);
        r.classList.toggle('zero', !v);
        this.touched();
      };
      minus.onclick = bump(-1);
      plus.onclick = bump(1);
      r.append(minus, count, plus);
      rows.append(r);
    }
    const nuke = h('label', 'ed-check', `<input type="checkbox" ${(l.skills.nuke ?? 1) > 0 ? 'checked' : ''}><span>Allow the Nuke button</span>`);
    nuke.querySelector('input')!.onchange = (e) => {
      this.pushUndo();
      l.skills.nuke = (e.target as HTMLInputElement).checked ? 1 : 0;
      this.touched();
    };
    s2.append(rows, nuke, h('p', 'ed-note', 'Shift-click + or − to change by 5.'));

    const s3 = this.section('Look');
    const themes = h('div', 'ed-themes');
    for (const t of THEMES) {
      const b = h('button', `ed-theme ${this.theme.name === t.name ? 'active' : ''}`,
        `<i style="background:linear-gradient(${t.sky[1]},${t.sky[0]} 45%, rgb(${t.earthTop.join(',')}) 45% 52%, rgb(${t.earthBottom.join(',')}))"></i><span>${t.name}</span>`);
      b.onclick = () => {
        this.pushUndo();
        l.theme = t.name;
        this.painter = new TerrainPainter(this.cells, ROWS, this.theme);
        this.touched();
        this.renderPanel();
      };
      themes.append(b);
    }
    s3.append(themes);
  }

  private renderCheckTab(p: HTMLElement, issues: U.Issue[]) {
    const v = this.u.verified;
    const status = h('div', `ed-verify ${v ? 'ok' : ''}`, v
      ? `${EICONS.check}<div><b>Verified</b><span>You beat this version of the level, so it's winnable. Editing it again clears this.</span></div>`
      : `<div class="ring">?</div><div><b>Not verified yet</b><span>Beat your own level in Test play to prove it can be won.</span></div>`);
    if (!v) {
      const b = h('button', 'btn primary', `${ICONS.play} Test play`);
      b.onclick = () => this.testPlay();
      status.append(b);
    }
    p.append(status);
    const s = this.section('Problems');
    if (!issues.length) s.append(h('p', 'ed-note good', '✓ No problems found.'));
    const list = h('div', 'ed-issues');
    for (const i of issues) {
      const r = h('button', `ed-issue ${i.severity}`, `<i></i><span>${esc(i.text)}</span>`);
      if (i.at) {
        r.title = 'Show me';
        r.onclick = () => this.centerOn(i.at![0], i.at![1]);
      } else r.disabled = true;
      list.append(r);
    }
    s.append(list);
    const d = this.section('Dry run');
    d.append(h('p', 'ed-note', 'Plays the level automatically without using any skills, to see whether it is too easy.'));
    if (this.dry) {
      const r = this.dry, l = this.level;
      const easy = r.saved >= l.toSave;
      d.append(h('div', `ed-dry ${easy ? 'warn' : 'good'}`, `<b>${r.saved} of ${r.total}</b> saved without skills (need ${l.toSave}) · ${r.died} lost<br>${easy
        ? 'This level can be won by doing nothing. Make it more of a puzzle!'
        : 'Good: players need to use skills to win.'}`));
    }
    const run = h('button', 'btn', this.dry ? 'Run again' : 'Run dry test');
    run.onclick = () => {
      if (!this.level.entrances.length || !this.level.exits.length) return this.toast('Add a hatch and an exit first');
      this.dry = U.dryRun(this.liveLevel());
      this.renderPanel();
    };
    d.append(run);
  }

  // ------------------------------------------------------------------ state changes
  private setTool(t: Tool) {
    if (this.pendingPortal !== null && t !== 'portal') this.cancelPortal();
    this.tool = t;
    if (t !== 'select') this.sel = null;
    this.tab = 'tool';
    this.refreshChrome();
    this.renderPanel();
  }

  private setMaterial(i: number) {
    this.material = i;
    if (!['brush', 'rect', 'fill'].includes(this.tool)) this.tool = 'brush';
    this.sel = null;
    this.refreshChrome();
    this.renderPanel();
    this.toast(MATERIALS[i].name);
  }

  private select(s: Sel | null) {
    this.sel = s;
    if (s) this.tab = 'tool';
    this.renderPanel();
  }

  private toggleGrid() {
    this.showGrid = !this.showGrid;
    this.refreshChrome();
  }

  /** The level with the current terrain encoded, ready to save, validate or play. */
  private liveLevel(): LevelData {
    return { ...this.level, grid: { cols: COLS, rows: ROWS, cells: encodeCells(this.cells) } };
  }

  /** Call after any edit that changes how the level plays. */
  private touched() {
    if (this.u.verified || this.u.best) {
      this.u.verified = false;
      this.u.best = 0;
      this.refreshChrome();
    }
    this.dry = null;
    this.scheduleSave();
  }

  private scheduleSave() {
    this.ui.saved.textContent = 'Saving…';
    this.ui.saved.classList.remove('bad');
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), 450);
  }

  private flushSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    this.u.level = structuredClone(this.liveLevel());
    this.u.updated = Date.now();
    const ok = U.putUserLevel(this.u);
    this.ui.saved.textContent = ok ? 'Saved' : 'Not saved: browser storage is full';
    this.ui.saved.classList.toggle('bad', !ok);
    this.refreshTabs();
  }

  /** After a save: refresh the problem count, and the Check tab's list if it is showing. */
  private refreshTabs() {
    if (this.tab === 'check' && !document.activeElement?.closest('.ed-panel')) this.renderPanel();
    else this.updateTabs();
  }

  private snapshot(): Snap {
    const { entrances, exits, traps, triggers, teleporters, skills, toSave, timeLimit, theme } = this.level;
    return { cells: this.cells.slice(), meta: JSON.stringify({ entrances, exits, traps, triggers, teleporters, skills, toSave, timeLimit, theme }) };
  }

  private pushUndo() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this.refreshChrome();
  }

  private restore(s: Snap) {
    const diff: number[] = [];
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i] !== s.cells[i]) diff.push(i);
    this.cells.set(s.cells);
    const meta = JSON.parse(s.meta);
    const themeChanged = meta.theme !== this.level.theme;
    Object.assign(this.level, meta);
    if (!meta.theme) delete this.level.theme;
    if (themeChanged) this.painter = new TerrainPainter(this.cells, ROWS, this.theme);
    else this.painter.repaint(diff);
    this.sel = null;
    this.pendingPortal = null;
    this.touched();
    this.refreshChrome();
    this.renderPanel();
  }

  private undo() {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snapshot());
    this.restore(s);
  }

  private redo() {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snapshot());
    this.restore(s);
  }

  private testPlay() {
    this.flushSave();
    const errs = U.validate(this.liveLevel(), this.cells).filter((i) => i.severity === 'error');
    if (errs.length) {
      this.tab = 'check';
      this.renderPanel();
      this.toast(errs[0].text);
      return;
    }
    this.nav.play(this.u.id, true);
  }

  // ------------------------------------------------------------------ terrain operations
  private setCell(x: number, y: number, v: number) {
    if (y < 0 || y >= ROWS) return;
    const i = wrap(x) + y * COLS;
    if (this.onlyEmpty && v && this.cells[i]) return;
    if (this.cells[i] === v) return;
    this.cells[i] = v;
    this.changed.add(i);
  }

  private brushCells(cx: number, cy: number): [number, number][] {
    const n = this.brush, o = Math.floor((n - 1) / 2), r2 = (n / 2) ** 2 + 0.25 * (n > 2 ? 1 : 0);
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const dx = i - (n - 1) / 2, dy = j - (n - 1) / 2;
        if (this.square || dx * dx + dy * dy <= r2) out.push([cx - o + i, cy - o + j]);
      }
    return out;
  }

  private stamp(cx: number, cy: number, v: number) {
    for (const [x, y] of this.brushCells(cx, cy)) this.setCell(x, y, v);
  }

  private commitCells() {
    if (!this.changed.size) return false;
    this.painter.repaint(this.changed);
    this.changed.clear();
    this.touched();
    return true;
  }

  private flood(x0: number, y0: number, v: number) {
    const start = wrap(x0) + y0 * COLS;
    const target = this.cells[start];
    if (target === v) return;
    const top = target === 0 ? y0 : ROWS - 1; // pouring into air fills only up to the clicked height
    const seen = new Uint8Array(this.cells.length);
    const stack = [start];
    while (stack.length) {
      const i = stack.pop()!;
      if (seen[i]) continue;
      seen[i] = 1;
      if (this.cells[i] !== target) continue;
      this.cells[i] = v;
      this.changed.add(i);
      const x = i % COLS, y = (i / COLS) | 0;
      stack.push(wrap(x - 1) + y * COLS, wrap(x + 1) + y * COLS);
      if (y > 0) stack.push(i - COLS);
      if (y < top) stack.push(i + COLS);
    }
  }

  // ------------------------------------------------------------------ objects
  private snapGround(x: number, y: number) {
    const solid = (yy: number) => (this.cells[wrap(x) + yy * COLS] & F.EARTH) !== 0;
    if (solid(y)) {
      while (y < ROWS - 8 && solid(y)) y++;
      return y;
    }
    while (y > 1 && !solid(y - 1)) y--;
    return y;
  }

  private place(tool: Tool, x: number, y: number) {
    const list = PLACE_LIST[tool]!;
    x = wrap(x);
    this.pushUndo();
    let f: Footprint;
    switch (tool) {
      case 'entrance': f = U.makeEntrance(x, clamp(y, 4, ROWS - 7)); break;
      case 'exit': f = U.makeExit(x, clamp(this.snapGround(x, y), 1, ROWS - 18)); break;
      case 'trap': f = U.makeTrap(x, clamp(this.snapGround(x, y), 1, ROWS - 6)); break;
      case 'antigrav': f = U.makeAntigrav(x, clamp(y, 1, ROWS - 4)); break;
      default: f = U.makePortal(x, clamp(this.snapGround(x, y), 1, ROWS - 7));
    }
    const arr = this.level[list] as Footprint[];
    arr.push(f);
    const i = arr.length - 1;
    if (tool === 'entrance') {
      // keep the goal sensible as Lemmo's are added
      if (this.level.entrances.length === 1) this.level.toSave = Math.max(1, Math.round(U.totalLemmos(this.level) / 2));
    }
    if (tool === 'portal') {
      if (this.pendingPortal === null) {
        this.pendingPortal = i;
        this.toast('Now click where the other end of the teleporter goes');
      } else {
        this.pendingPortal = null;
        this.toast('Teleporter pair placed');
      }
    }
    this.sel = { list, i };
    this.touched();
    this.renderPanel();
  }

  private cancelPortal() {
    if (this.pendingPortal === null) return;
    this.level.teleporters.splice(this.pendingPortal, 1);
    this.pendingPortal = null;
    if (this.sel?.list === 'teleporters') this.sel = null;
    this.undoStack.pop(); // placing the lone end was its own undo step
    this.refreshChrome();
    this.renderPanel();
  }

  private deleteSelected() {
    if (!this.sel) return;
    const { list, i } = this.sel;
    this.pushUndo();
    if (list === 'teleporters') {
      // teleporters pair up in file order, so the partner goes too
      const tp = this.level.teleporters;
      for (const j of [i, i ^ 1].filter((j) => j < tp.length).sort((a, b) => b - a)) tp.splice(j, 1);
      this.pendingPortal = null;
    } else {
      this.level[list].splice(i, 1);
    }
    this.level.toSave = clamp(this.level.toSave, 1, Math.max(1, U.totalLemmos(this.level)));
    this.sel = null;
    this.touched();
    this.renderPanel();
  }

  private bbox(list: ListKey, f: Footprint) {
    const cx = (f.min[0] + f.max[0] + 1) / 2, y = f.min[1];
    switch (list) {
      case 'entrances': return { x0: f.min[0], x1: f.max[0] + 1, y0: y, y1: y + (f.max[1] - f.min[1] + 2) * 0.85 };
      case 'exits': return { x0: cx - 4.5, x1: cx + 4.5, y0: y, y1: y + 17.5 };
      case 'traps': {
        const w = Math.max(3, f.max[0] - f.min[0] + 1);
        return { x0: cx - w / 2, x1: cx + w / 2, y0: y, y1: y + 4.6 };
      }
      case 'triggers': return { x0: f.min[0], x1: f.max[0] + 1, y0: y, y1: f.max[1] + 1 };
      default: return { x0: f.pos[0] - 2.8, x1: f.pos[0] + 2.8, y0: y, y1: y + 6.6 };
    }
  }

  private hit(col: number, row: number): Sel | null {
    const c = wrap(col);
    for (const list of [...DRAW_ORDER].reverse()) {
      const arr = this.level[list];
      for (let i = arr.length - 1; i >= 0; i--) {
        if (list === 'triggers' && (arr[i] as TriggerData).kind !== 'antigrav') continue;
        const b = this.bbox(list, arr[i]);
        if (row < b.y0 || row > b.y1) continue;
        for (const k of [-COLS, 0, COLS]) if (c + k >= b.x0 && c + k <= b.x1) return { list, i };
      }
    }
    return null;
  }

  private nudge(dx: number, dy: number) {
    if (!this.sel) return;
    const f = this.level[this.sel.list][this.sel.i];
    dy = clamp(dy, 1 - f.min[1], ROWS - 2 - f.max[1]);
    if (!dx && !dy) return;
    this.pushUndo();
    U.translate(f, dx, dy);
    U.normalizeX(f);
    this.touched();
    this.renderPanel();
  }

  // ------------------------------------------------------------------ view
  private resize() {
    const r = this.stage.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.dpr = Math.min(2, window.devicePixelRatio);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    if (!this.fitted) {
      this.fitted = true;
      this.fit();
    }
    this.clampView();
  }

  private fit() {
    const ppu = clamp(Math.min((this.w - 40) / COLS, (this.h - 90) / ROWS), 1, 40);
    this.view = { ppu, c0: -(this.w / ppu - COLS) / 2, r0: -(this.h / ppu - ROWS) / 2 };
    this.refreshChrome();
  }

  private zoomAt(sx: number, sy: number, factor: number) {
    const before = this.world(sx, sy);
    const ppu = clamp(this.view.ppu * factor, 1, 40);
    this.view.ppu = ppu;
    this.view.c0 = before.col - sx / ppu;
    this.view.r0 = ROWS - before.row - sy / ppu;
    this.clampView();
    this.refreshChrome();
  }

  private zoomBy(f: number) {
    this.zoomAt(this.w / 2, this.h / 2, f);
  }

  private centerOn(col: number, row: number) {
    if (this.view.ppu < 6) this.view.ppu = 8;
    const { ppu } = this.view;
    this.view.c0 = col - this.w / ppu / 2;
    this.view.r0 = ROWS - row - this.h / ppu / 2;
    this.clampView();
    this.refreshChrome();
  }

  private clampView() {
    const vr = this.h / this.view.ppu;
    if (vr >= ROWS + 6) this.view.r0 = -(vr - ROWS) / 2;
    else this.view.r0 = clamp(this.view.r0, -6, ROWS + 6 - vr);
  }

  private world(sx: number, sy: number) {
    const { ppu, c0, r0 } = this.view;
    return { col: c0 + sx / ppu, row: ROWS - (r0 + sy / ppu) };
  }

  private S(col: number, row: number) {
    const { ppu, c0, r0 } = this.view;
    return { x: (col - c0) * ppu, y: (ROWS - row - r0) * ppu };
  }

  /** Column offsets (multiples of 256) at which something at `col` is on screen. */
  private copies(col: number, pad = 12) {
    const out: number[] = [];
    const vis0 = this.view.c0 - pad, vis1 = this.view.c0 + this.w / this.view.ppu + pad;
    for (let k = Math.floor((vis0 - col) / COLS); col + k * COLS <= vis1; k++) if (col + k * COLS >= vis0) out.push(k * COLS);
    return out;
  }

  // ------------------------------------------------------------------ input
  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox') return;
    if (this.root.querySelector('.modal-back')) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); this.redo(); return; }
    if (mod && k === 's') { e.preventDefault(); this.flushSave(); this.toast('Saved'); return; }
    if (mod) return;
    if (k === ' ') {
      e.preventDefault();
      this.space = true;
      this.refreshChrome();
      return;
    }
    const byKey = TOOLS.find((x) => x.key?.toLowerCase() === k);
    if (byKey) return this.setTool(byKey.id);
    if (k >= '1' && k <= '9') return this.setMaterial(Number(k) - 1);
    if (k === '[') { this.brush = Math.max(1, this.brush - 1); this.renderPanel(); }
    else if (k === ']') { this.brush = Math.min(16, this.brush + 1); this.renderPanel(); }
    else if (k === 'g') this.toggleGrid();
    else if (k === '0') this.fit();
    else if (k === '+' || k === '=') this.zoomBy(1.4);
    else if (k === '-') this.zoomBy(1 / 1.4);
    else if (k === 't') this.testPlay();
    else if (k === '?') this.showHelp();
    else if (k === 'escape') {
      if (this.pendingPortal !== null) this.cancelPortal();
      else this.select(null);
    } else if ((k === 'delete' || k === 'backspace') && this.sel) {
      e.preventDefault();
      this.deleteSelected();
    } else if (k.startsWith('arrow')) {
      e.preventDefault();
      const d = e.shiftKey ? 8 : 1;
      const [dx, dy] = k === 'arrowleft' ? [-d, 0] : k === 'arrowright' ? [d, 0] : k === 'arrowup' ? [0, d] : [0, -d];
      if (this.sel) this.nudge(dx, dy);
      else {
        this.view.c0 += (dx * 4) / Math.max(1, this.view.ppu / 4);
        this.view.r0 -= (dy * 4) / Math.max(1, this.view.ppu / 4);
        this.clampView();
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ') {
      this.space = false;
      this.refreshChrome();
    }
  };

  private bind() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      (document.activeElement as HTMLElement | null)?.blur?.();
      this.track(e);
      const { col, row } = this.mouse;
      const x = Math.floor(col), y = Math.floor(row);
      if (e.button === 1 || this.space || this.tool === 'pan') {
        this.drag = { kind: 'pan', sx: e.offsetX, sy: e.offsetY, c0: this.view.c0, r0: this.view.r0 };
        this.refreshChrome();
        return;
      }
      const erase = e.button === 2;
      if (y < 0 || y >= ROWS) return;
      switch (this.tool) {
        case 'brush':
        case 'eraser':
          this.pushUndo();
          this.drag = { kind: 'paint', erase: erase || this.tool === 'eraser', last: null };
          this.paintTo(x, y);
          break;
        case 'rect':
          this.drag = { kind: 'rect', erase, x0: x, y0: y };
          break;
        case 'fill': {
          this.pushUndo();
          this.flood(x, y, erase ? 0 : MATERIALS[this.material].v);
          if (!this.commitCells()) this.undoStack.pop();
          this.refreshChrome();
          break;
        }
        case 'select': {
          const s = this.hit(col, row);
          this.select(s);
          if (s) this.drag = { kind: 'move', sel: s, x0: x, y0: y, orig: JSON.stringify(this.level[s.list][s.i]), moved: false };
          break;
        }
        default:
          if (erase) return;
          this.place(this.tool, x, y);
      }
    });
    c.addEventListener('pointermove', (e) => {
      this.track(e);
      const d = this.drag;
      if (!d) {
        const hv = this.tool === 'select' ? this.hit(this.mouse.col, this.mouse.row) : null;
        if ((hv?.list ?? null) !== (this.hoverObj?.list ?? null) || hv?.i !== this.hoverObj?.i) {
          this.hoverObj = hv;
          this.refreshChrome();
        }
        return;
      }
      const x = Math.floor(this.mouse.col), y = Math.floor(this.mouse.row);
      if (d.kind === 'pan') {
        this.view.c0 = d.c0 - (e.offsetX - d.sx) / this.view.ppu;
        this.view.r0 = d.r0 - (e.offsetY - d.sy) / this.view.ppu;
        this.clampView();
      } else if (d.kind === 'paint') this.paintTo(x, clamp(y, -20, ROWS + 20));
      else if (d.kind === 'move') {
        const f = this.level[d.sel.list][d.sel.i];
        const orig = JSON.parse(d.orig) as Footprint;
        const dx = x - d.x0;
        const dy = clamp(y - d.y0, 1 - orig.min[1], ROWS - 2 - orig.max[1]);
        if ((dx || dy) && !d.moved) {
          d.moved = true;
          this.undoStack.push({ cells: this.cells.slice(), meta: this.snapshotWith(d.sel, orig) });
          this.redoStack = [];
        }
        Object.assign(f, structuredClone(orig));
        U.translate(f, dx, dy);
      }
    });
    const end = () => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (d.kind === 'rect') {
        const x1 = Math.floor(this.mouse.col), y1 = clamp(Math.floor(this.mouse.row), 0, ROWS - 1);
        this.pushUndo();
        const v = d.erase ? 0 : MATERIALS[this.material].v;
        for (let x = Math.min(d.x0, x1); x <= Math.max(d.x0, x1); x++)
          for (let y = Math.min(d.y0, y1); y <= Math.max(d.y0, y1); y++) this.setCell(x, y, v);
        if (!this.commitCells()) this.undoStack.pop();
      } else if (d.kind === 'paint') {
        if (!this.commitCells()) this.undoStack.pop();
      } else if (d.kind === 'move' && d.moved) {
        U.normalizeX(this.level[d.sel.list][d.sel.i]);
        this.touched();
        this.renderPanel();
      }
      this.refreshChrome();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => (this.mouse.inside = false));
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        this.view.c0 += (e.shiftKey ? e.deltaY : e.deltaX) / this.view.ppu;
      } else {
        this.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015));
      }
    }, { passive: false });
  }

  /** Undo snapshot of the level as it was before a drag-move started. */
  private snapshotWith(sel: Sel, orig: Footprint) {
    const cur = this.level[sel.list][sel.i];
    this.level[sel.list][sel.i] = orig as never;
    const s = this.snapshot().meta;
    this.level[sel.list][sel.i] = cur as never;
    this.refreshChrome();
    return s;
  }

  private track(e: PointerEvent) {
    const w = this.world(e.offsetX, e.offsetY);
    Object.assign(this.mouse, { x: e.offsetX, y: e.offsetY, col: w.col, row: w.row, inside: true });
    const x = Math.floor(w.col), y = Math.floor(w.row);
    this.ui.status.textContent = y >= 0 && y < ROWS
      ? `Column ${wrap(x)} · Row ${y} · ${materialName(this.cells[wrap(x) + y * COLS])}`
      : 'Outside the level';
  }

  private paintTo(x: number, y: number) {
    const d = this.drag;
    if (d?.kind !== 'paint') return;
    const v = d.erase ? 0 : MATERIALS[this.material].v;
    if (d.last) {
      const [lx, ly] = d.last;
      const n = Math.max(Math.abs(x - lx), Math.abs(y - ly));
      for (let s = 1; s <= n; s++) this.stamp(Math.round(lx + ((x - lx) * s) / n), Math.round(ly + ((y - ly) * s) / n), v);
    } else this.stamp(x, y, v);
    d.last = [x, y];
    if (this.changed.size) {
      this.painter.repaint(this.changed);
      this.changed.clear();
      this.touched();
    }
  }

  // ------------------------------------------------------------------ drawing
  private frame() {
    this.raf = requestAnimationFrame(() => this.frame());
    this.draw(performance.now() / 1000);
  }

  private draw(time: number) {
    const c = this.ctx, { ppu, c0 } = this.view, W = this.w, H = this.h;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#04060d';
    c.fillRect(0, 0, W, H);
    const top = this.S(0, ROWS).y, bot = this.S(0, 0).y;
    const th = this.theme;
    const g = c.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0, th.sky[1]);
    g.addColorStop(1, th.sky[0]);
    c.fillStyle = g;
    c.fillRect(0, top, W, bot - top);

    // terrain, repeated across the wrap
    c.imageSmoothingEnabled = ppu < CELL_PX;
    for (const k of this.copies(0, COLS)) {
      const x = this.S(k, 0).x;
      if (x > W || x + COLS * ppu < 0) continue;
      c.drawImage(this.painter.color, x, top, COLS * ppu, ROWS * ppu);
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = 0.45;
      c.drawImage(this.painter.glow, x, top, COLS * ppu, ROWS * ppu);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
    }

    // grid
    if (this.showGrid && ppu >= 5) {
      const x0 = Math.floor(c0), x1 = Math.ceil(c0 + W / ppu);
      for (const major of [false, true]) {
        c.beginPath();
        for (let x = x0; x <= x1; x++) {
          if ((wrap(x) % 8 === 0) !== major) continue;
          const sx = Math.round((x - c0) * ppu) + 0.5;
          c.moveTo(sx, top);
          c.lineTo(sx, bot);
        }
        for (let y = 0; y <= ROWS; y++) {
          if ((y % 8 === 0) !== major) continue;
          const sy = Math.round(this.S(0, y).y) + 0.5;
          c.moveTo(0, sy);
          c.lineTo(W, sy);
        }
        c.strokeStyle = major ? 'rgba(200,215,255,0.13)' : 'rgba(200,215,255,0.05)';
        c.lineWidth = 1;
        c.stroke();
      }
    }

    // wrap seam
    c.setLineDash([6, 6]);
    c.strokeStyle = 'rgba(180,155,255,0.55)';
    c.lineWidth = 1.5;
    c.font = '600 11px Outfit, sans-serif';
    c.fillStyle = 'rgba(180,155,255,0.85)';
    for (const k of this.copies(0, 0)) {
      const x = Math.round(this.S(k, 0).x) + 0.5;
      c.beginPath();
      c.moveTo(x, top - 14);
      c.lineTo(x, bot + 6);
      c.stroke();
      c.textAlign = 'center';
      c.fillText('⟲ wrap', x, top - 18);
    }
    c.setLineDash([]);
    c.strokeStyle = 'rgba(160,175,255,0.25)';
    c.strokeRect(-1, top - 0.5, W + 2, bot - top + 1);

    this.drawObjects(c, time);
    this.drawCursor(c);
  }

  private drawObjects(c: CanvasRenderingContext2D, time: number) {
    const { ppu } = this.view;
    const l = this.level;
    const labels = ppu >= 2.5;
    c.textAlign = 'center';
    c.font = `700 ${clamp(ppu * 1.6, 10, 15)}px Outfit, sans-serif`;
    for (const list of DRAW_ORDER) {
      l[list].forEach((f, i) => {
        if (list === 'triggers' && (f as TriggerData).kind !== 'antigrav') return;
        const cx = (f.min[0] + f.max[0] + 1) / 2;
        const anchor = list === 'teleporters' ? f.pos[0] : cx;
        for (const k of this.copies(anchor, 20)) {
          const p = this.S(anchor + k, f.min[1]);
          switch (list) {
            case 'entrances': {
              const e = f as EntranceData;
              this.drawDrop(c, e, k, time);
              drawEntrance(c, p.x, p.y, ppu, f.max[0] - f.min[0] + 1, f.max[1] - f.min[1] + 2, e.lemType, 1, time);
              if (labels) {
                const ly = this.S(0, f.min[1] + 6.6).y;
                c.fillStyle = '#e8ecff';
                c.fillText(`${e.dir > 0 ? '' : '← '}${e.lemmos}${e.dir > 0 ? ' →' : ''}`, p.x, ly);
              }
              break;
            }
            case 'exits': drawExit(c, p.x, p.y, ppu, time); break;
            case 'traps': drawTrap(c, p.x, p.y, ppu, f.max[0] - f.min[0] + 1, time, false); break;
            case 'triggers': drawAntigrav(c, p.x, p.y, ppu, f.max[0] - f.min[0] + 1, f.max[1] - f.min[1] + 1, time); break;
            case 'teleporters': {
              drawPortal(c, p.x, p.y, ppu, time);
              if (labels) {
                c.fillStyle = '#d9b8ff';
                c.fillText(`${(i >> 1) + 1}${i % 2 ? 'B' : 'A'}`, p.x, this.S(0, f.min[1] + 7.6).y);
              }
              break;
            }
          }
        }
      });
    }
    // teleporter links
    const tp = l.teleporters;
    c.setLineDash([4, 6]);
    c.strokeStyle = 'rgba(190,120,255,0.5)';
    c.lineWidth = 1.5;
    for (let i = 0; i + 1 < tp.length; i += 2) {
      const a = tp[i], b = tp[i + 1];
      let bx = b.pos[0];
      if (bx - a.pos[0] > COLS / 2) bx -= COLS;
      if (a.pos[0] - bx > COLS / 2) bx += COLS;
      for (const k of this.copies(Math.min(a.pos[0], bx), Math.abs(bx - a.pos[0]) + 20)) {
        const p = this.S(a.pos[0] + k, a.min[1] + 2.5), q = this.S(bx + k, b.min[1] + 2.5);
        c.beginPath();
        c.moveTo(p.x, p.y);
        c.lineTo(q.x, q.y);
        c.stroke();
      }
    }
    c.setLineDash([]);
    // selection / hover outlines
    for (const [s, style] of [[this.hoverObj, 'rgba(255,255,255,0.45)'], [this.sel, '#5df2b0']] as const) {
      if (!s || !l[s.list][s.i]) continue;
      const b = this.bbox(s.list, l[s.list][s.i]);
      for (const k of this.copies(b.x0, 30)) {
        const p = this.S(b.x0 + k, b.y1), q = this.S(b.x1 + k, b.y0);
        c.setLineDash(s === this.sel ? [5, 4] : []);
        c.strokeStyle = style;
        c.lineWidth = s === this.sel ? 2 : 1;
        c.strokeRect(p.x - 3, p.y - 3, q.x - p.x + 6, q.y - p.y + 6);
      }
      c.setLineDash([]);
    }
  }

  /** Dotted line from a hatch down to where its Lemmo's land; red when the fall is fatal. */
  private drawDrop(c: CanvasRenderingContext2D, e: EntranceData, k: number, time: number) {
    const [sx, sy] = e.spawn;
    if (sy <= 0) return;
    const d = U.dropFrom(this.cells, sx, sy);
    const fatal = d.row <= 0 || (d.fall > SPLAT_ROWS && !this.level.skills.floater)
      || d.into & F.LAVA || (d.into & F.WATER && e.lemType !== 1) || (d.into & F.ACID && e.lemType !== 2);
    const a = this.S(sx + 0.5 + k, sy), b = this.S(sx + 0.5 + k, d.row);
    c.setLineDash([3, 4]);
    c.strokeStyle = fatal ? 'rgba(255,77,109,0.85)' : 'rgba(93,242,176,0.7)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
    c.setLineDash([]);
    if (d.row > 0 && this.view.ppu >= 3) {
      const ghost: Lemmo = {
        id: e.id, x: 0, y: 0, dir: e.dir, g: 1, type: e.lemType, climber: false, floater: false,
        state: fatal ? 'splatting' : 'walking', t: fatal ? 0.3 : time, cyc: 0, fallen: 0, umbrella: false, bricks: 0, empty: 0,
        bomb: null, inside: new Set(), blockCells: [],
      };
      c.globalAlpha = 0.75;
      drawLemmo(c, ghost, b.x, b.y, this.view.ppu, { face: e.dir, hover: false, time });
      c.globalAlpha = 1;
      if (this.view.ppu >= 4 && d.fall > 4) {
        c.fillStyle = fatal ? '#ff8aa0' : 'rgba(200,255,230,0.8)';
        c.font = '600 11px Outfit, sans-serif';
        c.fillText(`${d.fall}${fatal && d.fall > SPLAT_ROWS ? ' · too high' : ''}`, a.x + 8 + this.view.ppu, (a.y + b.y) / 2);
      }
    }
  }

  private drawCursor(c: CanvasRenderingContext2D) {
    if (!this.mouse.inside || this.space || this.tool === 'pan') return;
    const { ppu } = this.view;
    const x = Math.floor(this.mouse.col), y = Math.floor(this.mouse.row);
    const cellRect = (cx: number, cy: number) => {
      const p = this.S(cx, cy + 1);
      return [p.x, p.y, ppu, ppu] as const;
    };
    const d = this.drag;
    if (this.tool === 'brush' || this.tool === 'eraser') {
      const erasing = this.tool === 'eraser' || (d?.kind === 'paint' && d.erase);
      c.fillStyle = erasing ? 'rgba(255,90,120,0.28)' : 'rgba(255,255,255,0.28)';
      for (const [bx, by] of this.brushCells(x, y)) if (by >= 0 && by < ROWS) c.fillRect(...cellRect(bx, by));
    } else if (this.tool === 'rect' && d?.kind === 'rect') {
      const yy = clamp(y, 0, ROWS - 1);
      const p = this.S(Math.min(d.x0, x), Math.max(d.y0, yy) + 1), q = this.S(Math.max(d.x0, x) + 1, Math.min(d.y0, yy));
      c.fillStyle = d.erase ? 'rgba(255,90,120,0.25)' : 'rgba(255,255,255,0.2)';
      c.fillRect(p.x, p.y, q.x - p.x, q.y - p.y);
      c.strokeStyle = d.erase ? '#ff5a78' : '#fff';
      c.lineWidth = 1;
      c.strokeRect(p.x + 0.5, p.y + 0.5, q.x - p.x - 1, q.y - p.y - 1);
      c.fillStyle = '#fff';
      c.fillText(`${Math.abs(x - d.x0) + 1} × ${Math.abs(yy - d.y0) + 1}`, q.x + 22, q.y + 14);
    } else if (this.tool === 'rect' || this.tool === 'fill') {
      if (y >= 0 && y < ROWS) {
        c.strokeStyle = '#fff';
        c.lineWidth = 1.5;
        const [rx, ry, rw, rh] = cellRect(x, y);
        c.strokeRect(rx, ry, rw, rh);
      }
    } else if (PLACE_LIST[this.tool] && y >= 0 && y < ROWS) {
      // ghost of the object about to be placed
      const gy = this.tool === 'entrance' || this.tool === 'antigrav' ? y : this.snapGround(wrap(x), y);
      const p = this.S(x + 0.5, gy);
      c.globalAlpha = 0.55;
      const t = performance.now() / 1000;
      if (this.tool === 'entrance') drawEntrance(c, p.x, p.y, ppu, 9, 7, 0, 1, t);
      else if (this.tool === 'exit') drawExit(c, p.x, p.y, ppu, t);
      else if (this.tool === 'trap') drawTrap(c, p.x, p.y, ppu, 5, t, false);
      else if (this.tool === 'antigrav') drawAntigrav(c, p.x, p.y, ppu, 3, 3, t);
      else drawPortal(c, this.S(x, gy).x, p.y, ppu, t);
      c.globalAlpha = 1;
      if (this.tool === 'portal' && this.pendingPortal !== null) {
        const a = this.level.teleporters[this.pendingPortal];
        const pa = this.S(a.pos[0] + Math.round((x - a.pos[0]) / COLS) * COLS, a.min[1] + 2.5);
        c.setLineDash([4, 6]);
        c.strokeStyle = 'rgba(190,120,255,0.8)';
        c.beginPath();
        c.moveTo(pa.x, pa.y);
        c.lineTo(p.x, p.y - 2.5 * ppu);
        c.stroke();
        c.setLineDash([]);
      }
    }
  }

  // ------------------------------------------------------------------ help
  private showHelp() {
    const back = h('div', 'modal-back');
    const m = h('div', 'modal ed-help', `
      <h3>Level Editor ${BETA}</h3>
      <div class="sub">Build a level, set how it's won, then prove it can be beaten.</div>
      <div class="ed-help-grid">
        <div><h4>1 · Shape the world</h4><p>Paint terrain with the <b>Brush</b>, <b>Box</b> and <b>Fill</b> tools. Pick materials on the right: steel can't be broken, hard earth can't be dug down through, one-way walls can only be bashed from one side, and water, lava and acid are deadly.</p></div>
        <div><h4>2 · Add objects</h4><p>Every level needs at least one <b>hatch</b> and one <b>exit</b>. Traps, anti-gravity fields and teleporter pairs add extra challenge. Use <b>Select</b> to move objects or change their settings.</p></div>
        <div><h4>3 · Set the win rules</h4><p>In <b>Win rules</b>, choose how many Lemmo's must be saved, the time limit and which skills the player gets. Fewer skills make a harder puzzle.</p></div>
        <div><h4>4 · Check and verify</h4><p><b>Check</b> lists problems and runs a dry test. Then <b>Test play</b> it: once you beat it, the level is <b>Verified</b>. Your levels appear under <b>User levels</b> in level select.</p></div>
      </div>
      <div class="ctable ed-keys">
        <div><span>Tools</span><span><kbd>V</kbd> select <kbd>B</kbd> brush <kbd>E</kbd> eraser <kbd>R</kbd> box <kbd>F</kbd> fill <kbd>H</kbd> hand</span></div>
        <div><span>Materials · brush size</span><span><kbd>1</kbd>–<kbd>9</kbd> · <kbd>[</kbd> <kbd>]</kbd></span></div>
        <div><span>Erase while painting</span><span>right mouse button</span></div>
        <div><span>Scroll · zoom</span><span>hold <kbd>Space</kbd> and drag, or middle mouse · wheel · <kbd>0</kbd> fits</span></div>
        <div><span>Undo · redo · save</span><span><kbd>Ctrl</kbd>+<kbd>Z</kbd> · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> · saves automatically</span></div>
        <div><span>Selected object</span><span>arrow keys nudge (<kbd>Shift</kbd> = 8) · <kbd>Delete</kbd> removes</span></div>
        <div><span>Grid · test play</span><span><kbd>G</kbd> · <kbd>T</kbd></span></div>
      </div>
      <p class="ed-note">Beta: the editor offers only what the game can run today. Skill pads, switches, moving traps and rising water from the original levels aren't available yet.</p>
      <div class="actions"><button class="btn primary">Got it</button></div>`);
    back.append(m);
    back.onclick = (e) => { if (e.target === back) back.remove(); };
    m.querySelector('button')!.onclick = () => back.remove();
    this.root.append(back);
  }
}

function toolOf(list: ListKey): Tool {
  return (Object.keys(PLACE_LIST) as Tool[]).find((t) => PLACE_LIST[t] === list)!;
}

// ------------------------------------------------------------------ thumbnails & level lists
export function thumbnail(level: LevelData): HTMLCanvasElement {
  const cv = h('canvas', 'thumb');
  cv.width = COLS;
  cv.height = ROWS;
  const ctx = cv.getContext('2d')!;
  const th = themeFor(level.name, level.theme);
  const img = ctx.createImageData(COLS, ROWS);
  const cells = decodeCells(level);
  const d = img.data;
  for (let y = 0; y < ROWS; y++) {
    const sky = y / ROWS;
    for (let x = 0; x < COLS; x++) {
      const v = cells[x + y * COLS];
      const o = (x + (ROWS - 1 - y) * COLS) * 4;
      let c: number[];
      if (v & F.EARTH) c = v & F.METAL ? th.metal : th.earthTop;
      else if (v & F.LAVA) c = [255, 96, 32];
      else if (v & F.ACID) c = [140, 240, 60];
      else if (v & F.WATER) c = [56, 140, 255];
      else if (v & F.BARRIER) c = [255, 80, 220];
      else c = [10 + sky * 14, 16 + sky * 20, 34 + sky * 30];
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const dot = (f: Footprint, col: string, hgt: number) => {
    ctx.fillStyle = col;
    ctx.fillRect(f.min[0], ROWS - f.min[1] - hgt, Math.max(2, f.max[0] - f.min[0] + 1), hgt);
  };
  level.entrances.forEach((e) => dot(e, '#5eead4', 5));
  level.exits.forEach((e) => dot(e, '#ffc857', 6));
  return cv;
}

function modal(parent: HTMLElement, html: string) {
  const back = h('div', 'modal-back');
  const m = h('div', 'modal', html);
  back.append(m);
  parent.append(back);
  return { m, close: () => back.remove() };
}

function download(u: U.UserLevel) {
  const blob = new Blob([U.exportJson(u)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${u.title.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'level'}.lemmo.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function levelMeta(u: U.UserLevel) {
  const l = u.level;
  const skills = SKILLS.filter((s) => (l.skills[s] ?? 0) > 0);
  return `<span>Save ${l.toSave}/${U.totalLemmos(l)}</span><span>⏱ ${fmtTime(l.timeLimit)}</span><span>${skills.length ? `${skills.length} skill${skills.length > 1 ? 's' : ''}` : 'No skills'}</span>`;
}

/** Cards for the "User levels" tab in level select: click to play. */
export function userLevelCards(nav: EditorNav & { newLevel(): void }): HTMLElement[] {
  const cards: HTMLElement[] = [];
  for (const u of U.listUserLevels()) {
    const card = h('div', 'card ucard');
    card.tabIndex = 0;
    card.append(thumbnail(u.level));
    card.insertAdjacentHTML('beforeend', `<div class="num">${u.verified ? `<span class="vchip">${EICONS.check} Verified</span>` : 'Not verified'}</div>
      <div class="title">${esc(u.title)}</div><div class="meta">${levelMeta(u)}${u.best ? `<span>Best ${u.best}</span>` : ''}</div>`);
    const edit = h('button', 'btn icon ucard-edit', EICONS.edit);
    edit.title = 'Edit in the Level Editor';
    edit.onclick = (e) => {
      e.stopPropagation();
      nav.edit(u.id);
    };
    card.append(edit);
    card.onclick = () => nav.play(u.id, false);
    card.onkeydown = (e) => { if (e.key === 'Enter') nav.play(u.id, false); };
    cards.push(card);
  }
  const add = h('button', 'card ucard new', `${EICONS.plus}<div class="title">Create a level</div><div class="meta">Opens the Level Editor ${BETA}</div>`);
  add.onclick = () => nav.newLevel();
  cards.push(add);
  return cards;
}

/** The Level Editor's home: your levels, plus create / import. */
export function editorHub(nav: EditorNav): HTMLElement {
  const s = h('div', 'screen ed-hub');
  s.innerHTML = `
    <div class="topbar"><button class="btn icon" data-a="back">${ICONS.back}</button><h2>Level Editor</h2>${BETA}<div class="spacer"></div>
      <button class="btn" data-a="import">${EICONS.upload} Import</button>
      <button class="btn primary" data-a="new">${EICONS.plus} New level</button></div>
    <div class="ed-hub-intro">Build your own levels and play them in the sandbox under <b>Level select → User levels</b>.
      Levels are saved in this browser; export them to keep a copy or share them.</div>
    <div class="grid"></div>`;
  const grid = s.querySelector<HTMLElement>('.grid')!;
  const file = h('input') as HTMLInputElement;
  file.type = 'file';
  file.accept = '.json,application/json';
  file.onchange = async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    try {
      const { title, level } = U.importJson(await f.text());
      const u = U.newUserLevel(level, title);
      if (!U.putUserLevel(u)) throw new Error('Browser storage is full');
      render();
    } catch (e) {
      const { m, close } = modal(s, `<h3>Couldn't import</h3><div class="sub">${esc((e as Error).message)}</div><div class="actions"><button class="btn primary">OK</button></div>`);
      m.querySelector('button')!.onclick = close;
    }
  };
  const render = () => {
    grid.innerHTML = '';
    const rows = U.listUserLevels();
    if (!rows.length) {
      grid.innerHTML = `<div class="ed-empty">${EICONS.edit}<h3>No levels yet</h3>
        <p>Start from a blank world, a ready-made starter puzzle, or remix any of the campaign's levels.</p></div>`;
      const b = h('button', 'btn primary', `${EICONS.plus} Create your first level`);
      b.onclick = () => newLevelDialog(s, nav);
      grid.firstElementChild!.append(b);
      return;
    }
    for (const u of rows) {
      const card = h('div', 'card ucard');
      card.append(thumbnail(u.level));
      card.insertAdjacentHTML('beforeend', `<div class="num">${u.verified ? `<span class="vchip">${EICONS.check} Verified</span>` : 'Not verified'} · edited ${ago(u.updated)}</div>
        <div class="title">${esc(u.title)}</div><div class="meta">${levelMeta(u)}</div>
        <div class="ucard-actions">
          <button class="btn primary" data-a="edit">${EICONS.edit} Edit</button>
          <button class="btn" data-a="play">${ICONS.play} Play</button>
          <button class="btn icon" data-a="dup" title="Duplicate">${EICONS.copy}</button>
          <button class="btn icon" data-a="export" title="Export to a file">${EICONS.download}</button>
          <button class="btn icon" data-a="del" title="Delete">${EICONS.trash}</button>
        </div>`);
      const on = (a: string, fn: () => void) => (card.querySelector<HTMLElement>(`[data-a=${a}]`)!.onclick = fn);
      on('edit', () => nav.edit(u.id));
      on('play', () => nav.play(u.id, false));
      on('dup', () => {
        if (!U.putUserLevel(U.duplicateUserLevel(u))) return;
        render();
      });
      on('export', () => download(u));
      on('del', () => {
        const { m, close } = modal(s, `<h3>Delete level?</h3><div class="sub">“${esc(u.title)}” will be gone for good. Export it first if you want to keep a copy.</div>
          <div class="actions"><button class="btn ghost" data-a="no">Cancel</button><button class="btn ed-danger" data-a="yes">${EICONS.trash} Delete</button></div>`);
        m.querySelector<HTMLElement>('[data-a=no]')!.onclick = close;
        m.querySelector<HTMLElement>('[data-a=yes]')!.onclick = () => {
          U.deleteUserLevel(u.id);
          close();
          render();
        };
      });
      grid.append(card);
    }
  };
  s.querySelector<HTMLElement>('[data-a=back]')!.onclick = () => nav.menu();
  s.querySelector<HTMLElement>('[data-a=new]')!.onclick = () => newLevelDialog(s, nav);
  s.querySelector<HTMLElement>('[data-a=import]')!.onclick = () => file.click();
  render();
  return s;
}

function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

/** Choose a starting point for a new level, then open it in the editor. */
export function newLevelDialog(parent: HTMLElement, nav: EditorNav) {
  const n = U.listUserLevels().length + 1;
  const campaign = nav.campaign();
  const opts = TIERS.map((t, ti) => `<optgroup label="${t}">${campaign.filter((e) => tierOf(e.slot) === ti)
    .map((e) => `<option value="${e.file}">${e.slot + 1}. ${esc(e.title)}</option>`).join('')}</optgroup>`).join('');
  const { m, close } = modal(parent, `
    <h3>New level</h3><div class="sub">Pick a starting point. You can change everything afterwards.</div>
    <label class="ed-field ed-name"><span>Name</span><input type="text" maxlength="60" value="My level ${n}"></label>
    <div class="ed-templates">
      <button class="ed-tpl active" data-t="starter"><b>Starter puzzle</b><span>Ground, a hatch, an exit and a water pit to bridge.</span></button>
      <button class="ed-tpl" data-t="blank"><b>Blank world</b><span>An empty sky. Paint everything yourself.</span></button>
      <button class="ed-tpl" data-t="remix"><b>Remix a campaign level</b><span>Copy one of the ${campaign.length} levels and change it.</span></button>
    </div>
    <select class="ed-remix hidden">${opts}</select>
    <div class="actions"><button class="btn ghost" data-a="cancel">Cancel</button><button class="btn primary" data-a="create">Create</button></div>`);
  m.classList.add('ed-new');
  let tpl = 'starter';
  const sel = m.querySelector('select')!;
  m.querySelectorAll<HTMLElement>('.ed-tpl').forEach((b) => (b.onclick = () => {
    tpl = b.dataset.t!;
    m.querySelectorAll('.ed-tpl').forEach((x) => x.classList.toggle('active', x === b));
    sel.classList.toggle('hidden', tpl !== 'remix');
  }));
  m.querySelector<HTMLElement>('[data-a=cancel]')!.onclick = close;
  m.querySelector<HTMLElement>('[data-a=create]')!.onclick = async () => {
    const name = (m.querySelector('input') as HTMLInputElement).value.trim() || `My level ${n}`;
    let level: LevelData;
    if (tpl === 'remix') {
      const src = await loadLevel(sel.value);
      level = U.remixTemplate(src, name);
    } else level = tpl === 'blank' ? U.blankTemplate() : U.starterTemplate();
    const u = U.newUserLevel(level, name);
    if (!U.putUserLevel(u)) {
      m.querySelector('.sub')!.textContent = 'Browser storage is full. Delete or export some levels first.';
      return;
    }
    close();
    nav.edit(u.id);
  };
  (m.querySelector('input') as HTMLInputElement).select();
}
