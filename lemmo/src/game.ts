// The in-level screen: owns the simulation, the 3D view, the overlay and the HUD.
import { Audio } from './audio.ts';
import { burst, drawAntigrav, drawDoor, drawEntrance, drawExit, drawLemmo, drawPortal, drawSwitch, drawTrap, stepParticles, type Particle } from './art.ts';
import { ICONS } from './icons.ts';
import { openGuide } from './guide.ts';
import { TIERS, tierOf, type Footprint, type LevelData, type LevelIndexEntry } from './level.ts';
import { CylinderView, RADIUS } from './render3d.ts';
import { FlatView } from './flatview.ts';
import { F, SKILLS, SPECIALS, Sim, type Lemmo, type Skill } from './sim.ts';
import { TerrainPainter, themeFor } from './terrain.ts';

const STEP = 1 / 60;
const STATE_LABEL: Record<string, string> = {
  walking: 'Walker', falling: 'Faller', climbing: 'Climbing', flipping: 'Climbing', blocking: 'Blocker',
  building: 'Builder', shrugging: 'Builder', bashing: 'Basher', mining: 'Miner', digging: 'Digger', ohno: 'Oh no!',
  drowning: 'Drowning', burning: 'Burning', splatting: 'Splat', exiting: 'Saved!', trapped: 'Caught',
  rocketing: 'Rocket', cartwheeling: 'Cartwheel', trampoline: 'Trampoline', bouncing: 'Bouncing', teleporting: 'Teleporting',
};
const SKILL_LABEL: Record<string, string> = {
  climber: 'Climb', floater: 'Float', bomber: 'Bomb', blocker: 'Block', builder: 'Build', basher: 'Bash', miner: 'Mine', digger: 'Dig',
  rocket: 'Rocket', cartwheel: 'Wheel', trampoline: 'Spring', antigrav: 'Flip', slower: 'Slow', faster: 'Fast',
};

export interface GameHost {
  audio: Audio;
  onExit(): void;
  onFinished(entry: LevelIndexEntry, saved: number, success: boolean): void;
  nextOf(entry: LevelIndexEntry): LevelIndexEntry | null;
  play(entry: LevelIndexEntry): void;
  /** Label for the "back to the list" buttons (default "Levels"). */
  exitLabel?: string;
  /** Extra line under the result, e.g. the editor's verification status. */
  resultNote?(success: boolean): string;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export class Game {
  readonly root = el('div', 'screen game');
  readonly sim: Sim;
  view: CylinderView | FlatView;
  private mode: 'flat' | 'cylinder' = loadMode();
  private glc!: HTMLCanvasElement;
  private theme;
  private painter: TerrainPainter;
  private overlay: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private selected: Skill = 'climber';
  /** The eight standard skills plus any special skills this level hands out (keys 9 and 0). */
  private dockSkills: Skill[] = [];
  private hover: Lemmo | null = null;
  private mouse = { x: -1, y: -1, down: false, sx: 0, sy: 0, dragging: false, lastX: 0, lastY: 0 };
  private keys = new Set<string>();
  /** Last input came from touch or pen (no hover, bigger targets). */
  private touchMode = matchMedia('(pointer: coarse)').matches;
  private speed = 1;
  private paused = true;
  private started = false;
  private ended = false;
  private endTimer = 0;
  private acc = 0;
  private last = performance.now();
  private raf = 0;
  private clock = 0;
  private nukeArmedAt = -10;
  private ui: Record<string, HTMLElement> = {};
  private mini: HTMLCanvasElement;
  private miniBase: HTMLCanvasElement;
  private resizeObs: ResizeObserver;

  constructor(private level: LevelData, private entry: LevelIndexEntry, private host: GameHost) {
    this.sim = new Sim(level);
    this.dockSkills = [...SKILLS, ...SPECIALS.filter((s) => (level.skills[s] ?? 0) > 0)];
    const theme = themeFor(level.name, level.theme);
    this.painter = new TerrainPainter(this.sim.cells, this.sim.rows, theme);
    this.root.style.background = `radial-gradient(1200px 800px at 50% 40%, ${theme.sky[1]}, ${theme.sky[0]} 70%)`;
    this.theme = theme;
    this.glc = el('canvas');
    this.overlay = el('canvas', 'overlay');
    this.root.append(this.glc, this.overlay);
    this.octx = this.overlay.getContext('2d')!;
    this.view = this.makeView();
    this.mini = el('canvas', 'minimap');
    this.miniBase = el('canvas');
    this.buildHud();
    this.buildMiniBase();
    this.selected = this.dockSkills.find((s) => (this.sim.skills[s] ?? 0) > 0) ?? 'climber';
    this.refreshSkills();
    this.bindInput();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.root);
    this.showBriefing();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private makeView() {
    if (this.mode === 'flat') return new FlatView(this.glc, this.painter, this.sim.rows, this.theme, pickSeam(this.sim, this.level));
    const v = new CylinderView(this.glc, this.painter, this.sim.rows, this.theme);
    const e0 = this.level.entrances[0];
    v.target.dist = v.dist = 100;
    v.lookAt(e0 ? e0.pos[0] + 12 * (e0.dir || 1) : 0, e0 ? e0.pos[1] - 6 : this.sim.rows / 2, true);
    return v;
  }

  private guideOpen = false;
  private openGuide() {
    if (this.guideOpen) return;
    this.guideOpen = true;
    const resume = this.started && !this.paused && !this.ended;
    if (resume) this.togglePause(true);
    openGuide(this.root, () => {
      this.guideOpen = false;
      if (resume) this.togglePause(false);
    });
  }

  private toggleView() {
    this.mode = this.mode === 'flat' ? 'cylinder' : 'flat';
    try { localStorage.setItem('lemmo.view', this.mode); } catch { /* ignore */ }
    this.view.dispose();
    this.view = this.makeView();
    this.applyMode();
    this.resize();
    this.toast(this.mode === 'flat' ? 'Panorama view: the whole level at once' : 'Cylinder view: drag to spin');
  }

  private applyMode() {
    const flat = this.mode === 'flat';
    this.mini.classList.toggle('hidden', flat);
    this.mini.previousElementSibling?.classList.toggle('hidden', flat);
    this.ui.viewBtn.innerHTML = flat ? ICONS.cylinder : ICONS.panorama;
    this.ui.viewBtn.title = flat ? 'Switch to cylinder view (V)' : 'Switch to panorama view (V)';
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.view.dispose();
    this.root.remove();
  }

  // ------------------------------------------------------------------ HUD
  private buildHud() {
    const top = el('div', 'hud-top');
    const back = el('button', 'btn icon', ICONS.menu);
    back.title = 'Menu (Esc)';
    back.onclick = () => this.showPause();
    const name = el('div', 'pill level-name', `<small>${this.entry.tag ?? `${TIERS[tierOf(this.entry.slot)]} · ${this.entry.slot + 1}`}</small>${this.entry.title}`);
    const stats = el('div', 'stats');
    const stat = (k: string, label: string) => {
      const s = el('div', 'pill stat', `<b>–</b><span>${label}</span>`);
      this.ui[k] = s;
      stats.append(s);
    };
    stat('out', 'Out');
    stat('saved', 'Saved');
    stat('time', 'Time');
    const btns = el('div', 'hud-buttons');
    const pause = el('button', 'btn icon', ICONS.pause);
    pause.title = 'Pause (P)';
    pause.onclick = () => this.togglePause();
    const fast = el('button', 'btn icon', ICONS.fast);
    fast.title = 'Fast forward (F)';
    fast.onclick = () => this.cycleSpeed();
    const snd = el('button', 'btn icon');
    snd.title = 'Volume';
    this.ui.snd = snd;
    const sndWrap = el('div', 'vol-wrap');
    const pop = el('div', 'vol-pop hidden');
    pop.append(this.volumeControls());
    sndWrap.append(snd, pop);
    snd.onclick = (e) => {
      e.stopPropagation();
      pop.classList.toggle('hidden');
    };
    pop.onclick = (e) => e.stopPropagation();
    this.root.addEventListener('pointerdown', (e) => {
      if (!sndWrap.contains(e.target as Node)) pop.classList.add('hidden');
    });
    this.refreshSoundIcon();
    const info = el('button', 'btn icon', ICONS.info);
    info.title = 'How to play (I)';
    info.onclick = () => this.openGuide();
    const viewBtn = el('button', 'btn icon');
    viewBtn.onclick = () => this.toggleView();
    this.ui.viewBtn = viewBtn;
    this.ui.pause = pause;
    this.ui.fast = fast;
    btns.append(info, viewBtn, pause, fast, sndWrap);
    top.append(back, name, stats, btns);

    const dock = el('div', 'dock');
    const rr = el('div', 'rr', `<div class="lbl">Release</div><div class="val">0</div><div class="row"></div>`);
    const minus = el('button', 'btn', '−');
    const plus = el('button', 'btn', '+');
    const hold = (b: HTMLElement, d: number) => {
      let t = 0;
      const tick = () => { this.sim.adjustRelease(d); this.refreshRelease(); t = window.setTimeout(tick, 90); };
      b.onpointerdown = () => { this.sim.adjustRelease(d); this.refreshRelease(); t = window.setTimeout(tick, 400); };
      b.onpointerup = b.onpointerleave = b.onpointercancel = () => clearTimeout(t);
    };
    hold(minus, -1);
    hold(plus, 1);
    rr.querySelector('.row')!.append(minus, plus);
    this.ui.rr = rr.querySelector('.val')!;
    dock.append(rr, el('div', 'sep'));
    this.dockSkills.forEach((s, i) => {
      const special = i >= SKILLS.length;
      const b = el('button', special ? 'skill special' : 'skill', `${i < 10 ? `<span class="key">${(i + 1) % 10}</span>` : ''}${ICONS[s]}<span class="name">${SKILL_LABEL[s]}</span><span class="count">0</span>`);
      b.title = SKILL_HELP[s] ?? SKILL_LABEL[s];
      b.onclick = () => this.select(s);
      this.ui['skill_' + s] = b;
      dock.append(b);
    });
    const nuke = el('button', 'skill nuke', `<span class="key">N</span>${ICONS.nuke}<span class="name">Nuke</span>`);
    nuke.title = 'Double-click to nuke every Lemmo';
    nuke.onclick = () => this.armNuke();
    this.ui.nuke = nuke;
    dock.append(nuke, el('div', 'sep'), this.mini);
    this.ui.tooltip = el('div', 'tooltip hidden');
    this.ui.toast = el('div', 'toast');
    this.ui.toast.style.opacity = '0';
    this.root.append(top, dock, this.ui.tooltip, this.ui.toast);
    this.refreshRelease();
    this.applyMode();
  }

  private volControls: HTMLElement[] = [];

  /** Music + effects sliders, each with its own mute toggle. Every instance stays in sync. */
  private volumeControls() {
    const box = el('div', 'vol');
    const audio = this.host.audio;
    const row = (key: 'music' | 'sfx', label: string) => {
      const mutedKey = key === 'music' ? 'musicMuted' : 'sfxMuted';
      const r = el('div', 'vol-row', `<button class="btn icon vol-mute"></button><span class="vol-label">${label}</span>
        <input type="range" min="0" max="1" step="0.05"><span class="vol-val"></span>`);
      const btn = r.querySelector<HTMLButtonElement>('button')!;
      const inp = r.querySelector('input')!;
      btn.onclick = () => {
        audio.settings[mutedKey] = !audio.settings[mutedKey];
        if (!audio.settings[mutedKey] && audio.settings[key] === 0) audio.settings[key] = key === 'music' ? 0.45 : 0.8;
        this.commitVolume();
      };
      inp.oninput = () => {
        audio.settings[key] = Number(inp.value);
        audio.settings[mutedKey] = Number(inp.value) === 0;
        this.commitVolume(inp);
        if (key === 'sfx') audio.play('beepselect', 0.7);
      };
      r.dataset.key = key;
      return r;
    };
    box.append(row('music', 'Music'), row('sfx', 'Effects'));
    this.volControls.push(box);
    this.syncVolume(box);
    return box;
  }

  private commitVolume(except?: HTMLInputElement) {
    this.host.audio.save();
    this.volControls = this.volControls.filter((b) => b.isConnected || b.closest('.vol-pop'));
    for (const b of this.volControls) this.syncVolume(b, except);
    this.refreshSoundIcon();
  }

  private syncVolume(box: HTMLElement, except?: HTMLInputElement) {
    const s = this.host.audio.settings;
    box.querySelectorAll<HTMLElement>('.vol-row').forEach((r) => {
      const key = r.dataset.key as 'music' | 'sfx';
      const muted = key === 'music' ? s.musicMuted : s.sfxMuted;
      const inp = r.querySelector('input')!;
      if (inp !== except) inp.value = String(muted ? 0 : s[key]);
      inp.style.setProperty('--fill', `${(muted ? 0 : s[key]) * 100}%`);
      r.querySelector('.vol-val')!.textContent = muted ? 'Off' : `${Math.round(s[key] * 100)}%`;
      const btn = r.querySelector('button')!;
      btn.innerHTML = muted ? ICONS.mute : key === 'music' ? ICONS.music : ICONS.sound;
      btn.title = muted ? `Unmute ${key === 'music' ? 'music' : 'effects'}` : `Mute ${key === 'music' ? 'music' : 'effects'}`;
      btn.classList.toggle('off', muted);
    });
  }

  private refreshSoundIcon() {
    const a = this.host.audio;
    const silent = a.musicVolume === 0 && a.sfxVolume === 0;
    this.ui.snd.innerHTML = silent ? ICONS.mute : ICONS.sound;
    this.ui.snd.classList.toggle('active', false);
  }

  private refreshRelease() {
    this.ui.rr.textContent = String(this.sim.entrances[0]?.rate ?? 0);
  }

  private skillSig = '';
  private refreshSkills() {
    const sig = this.selected + this.dockSkills.map((s) => this.sim.skills[s] ?? 0).join(',');
    if (sig === this.skillSig) return;
    this.skillSig = sig;
    for (const s of this.dockSkills) {
      const b = this.ui['skill_' + s];
      const n = this.sim.skills[s] ?? 0;
      b.querySelector('.count')!.textContent = String(n);
      b.classList.toggle('empty', n <= 0);
      b.classList.toggle('sel', s === this.selected);
    }
  }

  private select(s: Skill) {
    this.selected = s;
    this.host.audio.play('beepselect', 0.6);
    this.refreshSkills();
  }

  private toast(msg: string) {
    const t = this.ui.toast;
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout((t as any)._h);
    (t as any)._h = setTimeout(() => (t.style.opacity = '0'), 1800);
  }

  private armNuke() {
    if (this.sim.nuking || !this.started) return;
    if (this.clock - this.nukeArmedAt < 0.6) {
      this.sim.nuke();
      this.ui.nuke.classList.remove('armed');
    } else {
      this.nukeArmedAt = this.clock;
      this.ui.nuke.classList.add('armed');
      this.toast(`${this.touchMode ? 'Tap' : 'Click'} Nuke again to blow up every Lemmo`);
      setTimeout(() => this.ui.nuke.classList.remove('armed'), 700);
    }
  }

  private togglePause(force?: boolean) {
    if (!this.started || this.ended) return;
    this.paused = force ?? !this.paused;
    this.ui.pause.innerHTML = this.paused ? ICONS.play : ICONS.pause;
    this.ui.pause.classList.toggle('active', this.paused);
    this.host.audio.pauseMusic(this.paused);
  }

  private cycleSpeed() {
    this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1;
    this.ui.fast.classList.toggle('active', this.speed > 1);
    this.ui.fast.title = `Speed ×${this.speed} (F)`;
    this.toast(`Speed ×${this.speed}`);
  }

  // ------------------------------------------------------------------ modals
  private modal(html: string) {
    const back = el('div', 'modal-back');
    const m = el('div', 'modal', html);
    back.append(m);
    this.root.append(back);
    return { back, m, close: () => back.remove() };
  }

  private skillChips() {
    return this.dockSkills.filter((s) => (this.level.skills[s] ?? 0) > 0)
      .map((s) => `<span class="chip">${ICONS[s]}${this.level.skills[s]}</span>`).join('') || '<span class="chip">No skills</span>';
  }

  private showBriefing() {
    const { m, close } = this.modal(`
      <div class="sub">${this.entry.tag ?? `${TIERS[tierOf(this.entry.slot)]} · Level ${this.entry.slot + 1}`}</div>
      <h3>${this.entry.title}</h3>
      <div class="facts">
        <div class="fact"><b>${this.sim.total}</b><span>Lemmo's</span></div>
        <div class="fact"><b>${this.level.toSave}</b><span>To save</span></div>
        <div class="fact"><b>${fmtTime(this.level.timeLimit)}</b><span>Time</span></div>
      </div>
      <div class="skill-chips">${this.skillChips()}</div>
      <div class="hint">${this.touchMode
        ? 'Tap a skill, then tap a Lemmo · the world wraps around at the edges · the cylinder button switches to the spinning view: drag to spin, pinch to zoom · new here? tap ⓘ for the guide'
        : `<kbd>1</kbd>–<kbd>${this.dockSkills.length > 8 ? (this.dockSkills.length > 9 ? '0' : '9') : '8'}</kbd> pick a skill · click a Lemmo to assign · the world wraps around at the edges · <kbd>V</kbd> toggles the spinning cylinder view · new here? press <kbd>I</kbd> or ⓘ for the guide`}</div>
      <div class="actions"><button class="btn ghost" data-a="back">${this.host.exitLabel ?? 'Levels'}</button><button class="btn primary" data-a="go">Let's go!</button></div>`);
    m.querySelector<HTMLElement>('[data-a=back]')!.onclick = () => this.host.onExit();
    this.closeBriefing = close;
    m.querySelector<HTMLElement>('[data-a=go]')!.onclick = () => this.start();
  }

  private closeBriefing: (() => void) | null = null;

  /** Dismiss the briefing and begin the level. */
  start() {
    if (this.started) return;
    this.closeBriefing?.();
    this.started = true;
    this.paused = false;
    this.last = performance.now();
    let seed = 0;
    for (const ch of this.level.name) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    this.host.audio.startMusic(seed);
    this.host.audio.unlock().then(() => this.host.audio.play('letsgo'));
    if (this.touchMode && this.root.clientHeight > this.root.clientWidth * 1.1 && this.mode === 'flat')
      setTimeout(() => this.toast('Turn your device sideways for a bigger view, or try the cylinder view'), 600);
  }

  private showPause() {
    if (this.ended) return;
    const wasPaused = this.paused;
    if (this.started) this.togglePause(true);
    const { m, close } = this.modal(`
      <h3>Paused</h3><div class="sub">${this.entry.title}</div>
      <div data-slot="vol"></div>
      <div class="actions">
        <button class="btn ghost" data-a="quit">Quit</button>
        <button class="btn" data-a="restart">Restart</button>
        <button class="btn primary" data-a="resume">Resume</button>
      </div>`);
    m.querySelector('[data-slot=vol]')!.replaceWith(this.volumeControls());
    m.querySelector<HTMLElement>('[data-a=quit]')!.onclick = () => this.host.onExit();
    m.querySelector<HTMLElement>('[data-a=restart]')!.onclick = () => this.host.play(this.entry);
    m.querySelector<HTMLElement>('[data-a=resume]')!.onclick = () => {
      close();
      if (this.started && !wasPaused) this.togglePause(false);
    };
  }

  private showResult() {
    const ok = this.sim.saved >= this.level.toSave;
    const pct = this.sim.total ? Math.round((this.sim.saved / this.sim.total) * 100) : 0;
    this.host.onFinished(this.entry, this.sim.saved, ok);
    this.host.audio.stopMusic();
    this.host.audio.play(ok ? 'fanfarestart' : 'die');
    const next = this.host.nextOf(this.entry);
    const { m } = this.modal(`
      <div class="sub">${ok ? (this.sim.saved === this.sim.total ? 'You totally stormed that level!' : 'Well done!') : 'You failed to rescue enough Lemmo’s'}</div>
      <h3>${this.entry.title}</h3>
      <div class="big ${ok ? 'good' : 'bad'}">${pct}%</div>
      ${this.host.resultNote ? `<div class="hint">${this.host.resultNote(ok)}</div>` : ''}
      <div class="facts">
        <div class="fact"><b>${this.sim.saved}</b><span>Saved</span></div>
        <div class="fact"><b>${this.level.toSave}</b><span>Needed</span></div>
        <div class="fact"><b>${this.sim.total}</b><span>Total</span></div>
      </div>
      <div class="actions">
        <button class="btn ghost" data-a="levels">${this.host.exitLabel ?? 'Levels'}</button>
        <button class="btn ${ok ? '' : 'primary'}" data-a="retry">${ICONS.restart} Retry</button>
        ${ok && next ? '<button class="btn primary" data-a="next">Next level</button>' : ''}
      </div>`);
    m.querySelector<HTMLElement>('[data-a=levels]')!.onclick = () => this.host.onExit();
    m.querySelector<HTMLElement>('[data-a=retry]')!.onclick = () => this.host.play(this.entry);
    const n = m.querySelector<HTMLElement>('[data-a=next]');
    if (n && next) n.onclick = () => this.host.play(next);
  }

  // ------------------------------------------------------------------ input
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    this.keys.add(e.key.toLowerCase());
    const k = e.key.toLowerCase();
    if (k >= '0' && k <= '9') {
      const s = this.dockSkills[(Number(k) + 9) % 10];
      if (s) this.select(s);
    }
    else if (k === 'p') this.togglePause();
    else if (k === 'f') this.cycleSpeed();
    else if (k === 'n') this.armNuke();
    else if (k === 'escape') this.showPause();
    else if (k === 'v') this.toggleView();
    else if (k === 'i') this.openGuide();
    else if (k === ' ' && this.mode === 'cylinder') {
      this.view.target.dist = this.view.target.dist > 110 ? 80 : 150;
      e.preventDefault();
    } else if (k === '+' || k === '=') { this.sim.adjustRelease(1); this.refreshRelease(); }
    else if (k === '-') { this.sim.adjustRelease(-1); this.refreshRelease(); }
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());

  private bindInput() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    const o = this.overlay;
    // Pointer input covers mouse, pen and touch: tap/click assigns, drag spins the cylinder, pinch zooms it.
    const pts = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; dist: number } | null = null;
    const spread = () => {
      const [a, b] = [...pts.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    o.addEventListener('pointerdown', (e) => {
      o.setPointerCapture(e.pointerId);
      this.touchMode = e.pointerType !== 'mouse';
      pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pts.size === 2) {
        pinch = { d: spread(), dist: this.view.target.dist };
        this.mouse.dragging = true; // a second finger never counts as a tap
        return;
      }
      Object.assign(this.mouse, { x: e.offsetX, y: e.offsetY, down: true, sx: e.offsetX, sy: e.offsetY, lastX: e.offsetX, lastY: e.offsetY, dragging: false });
    });
    o.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') this.touchMode = false;
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pinch && pts.size === 2) {
        if (this.mode === 'cylinder') this.view.target.dist = clamp(pinch.dist * (pinch.d / Math.max(10, spread())), 62, 280);
        return;
      }
      this.mouse.x = e.offsetX;
      this.mouse.y = e.offsetY;
      if (!this.mouse.down) return;
      const slop = e.pointerType === 'mouse' ? 6 : 12;
      if (!this.mouse.dragging && Math.hypot(e.offsetX - this.mouse.sx, e.offsetY - this.mouse.sy) > slop) this.mouse.dragging = true;
      if (this.mouse.dragging && this.mode === 'cylinder') {
        const front = this.view.project(this.view.frontColumn(), this.view.camY + this.sim.rows / 2, o.clientWidth, o.clientHeight);
        const ppu = Math.max(0.5, front.scale);
        this.view.target.rot += (e.offsetX - this.mouse.lastX) / (ppu * RADIUS);
        this.view.target.camY = clamp(this.view.target.camY + (e.offsetY - this.mouse.lastY) / ppu, -this.sim.rows / 2, this.sim.rows / 2);
        o.style.cursor = 'grabbing';
      }
      this.mouse.lastX = e.offsetX;
      this.mouse.lastY = e.offsetY;
    });
    const end = (e: PointerEvent, cancelled: boolean) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size > 0) return;
      const touch = e.pointerType !== 'mouse';
      if (!cancelled && this.mouse.down && !this.mouse.dragging) this.tryAssign(this.pick(e.offsetX, e.offsetY, touch ? 26 : 14), touch);
      this.mouse.down = false;
      this.mouse.dragging = false;
      if (touch) this.mouse.x = -1; // no hover highlight left behind by a finger
      o.style.cursor = '';
    };
    o.addEventListener('pointerup', (e) => end(e, false));
    o.addEventListener('pointercancel', (e) => end(e, true));
    o.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.mouse.x = -1; });
    o.addEventListener('wheel', (e) => {
      if (this.mode !== 'cylinder') return;
      this.view.target.dist = clamp(this.view.target.dist * (1 + e.deltaY * 0.0012), 62, 280);
      e.preventDefault();
    }, { passive: false });
    const mm = (e: PointerEvent) => {
      const r = this.mini.getBoundingClientRect();
      const col = ((e.clientX - r.left) / r.width) * 256;
      const row = (1 - (e.clientY - r.top) / r.height) * this.sim.rows;
      this.view.lookAt(col, row);
    };
    this.mini.addEventListener('pointerdown', (e) => { this.mini.setPointerCapture(e.pointerId); mm(e); });
    this.mini.addEventListener('pointermove', (e) => { if (e.buttons) mm(e); });
  }

  private lastVis: { l: Lemmo; p: { x: number; y: number; scale: number } }[] = [];
  /** The Lemmo nearest to screen point (x, y), preferring ones the selected skill can be given to. */
  private pick(x: number, y: number, minR: number): Lemmo | null {
    let best = Infinity, hit: Lemmo | null = null;
    for (const { l, p } of this.lastVis) {
      if (l.type === 3 || !this.sim.lemmos.includes(l)) continue;
      const d = Math.hypot(x - p.x, y - (p.y - p.scale * 1.6 * l.g));
      if (d > Math.max(minR, p.scale * 2.6)) continue;
      const score = d - (this.sim.canAssign(l, this.selected) ? 1000 : 0);
      if (score < best) {
        best = score;
        hit = l;
      }
    }
    return hit;
  }

  private tryAssign(l: Lemmo | null, touch: boolean) {
    if (!l || !this.started || this.ended) return;
    if (this.sim.assign(l, this.selected)) this.refreshSkills();
    else if ((this.sim.skills[this.selected] ?? 0) <= 0) this.toast(`No ${SKILL_LABEL[this.selected].toLowerCase()} skills left`);
    else if (touch) this.toast(`That Lemmo can’t ${SKILL_LABEL[this.selected].toLowerCase()} right now (${(STATE_LABEL[l.state] ?? l.state).toLowerCase()})`);
  }

  private resize() {
    const w = this.root.clientWidth, h = this.root.clientHeight;
    if (this.view instanceof FlatView) {
      const r = this.root.getBoundingClientRect();
      const top = this.root.querySelector('.hud-top')?.getBoundingClientRect();
      const dock = this.root.querySelector('.dock')?.getBoundingClientRect();
      this.view.insets = { top: top ? top.bottom - r.top : 70, bottom: dock ? r.bottom - dock.top : 110 };
    }
    this.view.resize(w, h);
    this.view.markDirty();
    const dpr = Math.min(2, window.devicePixelRatio);
    this.overlay.width = Math.round(w * dpr);
    this.overlay.height = Math.round(h * dpr);
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ------------------------------------------------------------------ minimap
  private buildMiniBase() {
    const rows = this.sim.rows;
    this.miniBase.width = 256;
    this.miniBase.height = rows;
    this.mini.width = 512;
    this.mini.height = rows * 2;
    const ctx = this.miniBase.getContext('2d')!;
    const img = ctx.createImageData(256, rows);
    for (let y = 0; y < rows; y++) for (let x = 0; x < 256; x++) this.miniPixel(img.data, x, y);
    ctx.putImageData(img, 0, 0);
  }

  private miniPixel(d: Uint8ClampedArray, x: number, y: number) {
    const v = this.sim.cells[x + y * 256];
    const o = (x + (this.sim.rows - 1 - y) * 256) * 4;
    const th = this.painter.theme;
    let c: number[] = [0, 0, 0, 0];
    if (v & F.EARTH) c = v & F.METAL ? [...th.metal, 255] : [...th.earthTop, 255];
    else if (v & F.LAVA) c = [255, 96, 32, 255];
    else if (v & F.ACID) c = [140, 240, 60, 255];
    else if (v & F.WATER) c = [56, 140, 255, 230];
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = c[3];
  }

  private miniDirty = false;
  private updateMini(changed: Set<number>) {
    if (this.miniDirty) {
      this.miniDirty = false;
      this.buildMiniBase();
    }
    if (changed.size) {
      const ctx = this.miniBase.getContext('2d')!;
      const img = ctx.getImageData(0, 0, 256, this.sim.rows);
      for (const i of changed) this.miniPixel(img.data, i % 256, Math.floor(i / 256));
      ctx.putImageData(img, 0, 0);
    }
    const m = this.mini.getContext('2d')!;
    const rows = this.sim.rows;
    m.clearRect(0, 0, 512, rows * 2);
    m.imageSmoothingEnabled = false;
    m.drawImage(this.miniBase, 0, 0, 512, rows * 2);
    // visible band
    const fc = this.view.frontColumn();
    const half = 256 * 0.16 * (this.view.dist / 150);
    m.fillStyle = 'rgba(93,242,176,0.12)';
    m.strokeStyle = 'rgba(93,242,176,0.7)';
    m.lineWidth = 2;
    for (const off of [-256, 0, 256]) {
      const x0 = (fc - half + off) * 2;
      m.fillRect(x0, 0, half * 4, rows * 2);
      m.strokeRect(x0, 1, half * 4, rows * 2 - 2);
    }
    const dot = (f: Footprint, col: string) => {
      m.fillStyle = col;
      m.fillRect(f.min[0] * 2, (rows - f.max[1] - 1) * 2, (f.max[0] - f.min[0] + 1) * 2, (f.max[1] - f.min[1] + 1) * 2);
    };
    this.level.entrances.forEach((e) => dot(e, '#5eead4'));
    this.level.exits.forEach((e) => dot(e, '#ffc857'));
    for (const l of this.sim.lemmos) {
      m.fillStyle = l.type === 3 ? '#ff4d6d' : '#ffffff';
      m.fillRect(Math.floor(l.x) * 2 - 1, (rows - l.y - 2) * 2, 3, 4);
    }
  }

  // ------------------------------------------------------------------ frame
  private frame(now: number) {
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.clock += dt;

    // camera keys
    const k = this.keys;
    if (this.mode === 'cylinder') {
    if (k.has('arrowleft') || k.has('a')) this.view.target.rot += dt * 1.4;
    if (k.has('arrowright') || k.has('d')) this.view.target.rot -= dt * 1.4;
    if (k.has('arrowup') || k.has('w')) this.view.target.camY = Math.min(this.sim.rows / 2, this.view.target.camY + dt * 40);
    if (k.has('arrowdown') || k.has('s')) this.view.target.camY = Math.max(-this.sim.rows / 2, this.view.target.camY - dt * 40);
    }

    if (this.started && !this.paused && !this.ended) {
      this.acc += dt * this.speed;
      let n = 0;
      while (this.acc >= STEP && n++ < 16) {
        this.sim.step(STEP);
        this.acc -= STEP;
      }
    }
    for (const ev of this.sim.events.splice(0)) {
      if (ev.kind === 'sound') this.host.audio.play(ev.name);
      else burst(this.particles, ev.x, ev.y, ev.style, ev.n);
    }
    stepParticles(this.particles, this.paused ? 0 : dt * this.speed);
    const changed = new Set(this.sim.changed);
    if (changed.size) {
      this.painter.repaint(changed);
      this.view.markDirty();
      this.sim.changed.clear();
    }
    this.view.update(dt);
    this.draw();
    if (this.mode === 'cylinder') this.updateMini(changed);
    else if (changed.size) this.miniDirty = true;
    this.updateStats();

    if (this.sim.finished && !this.ended) {
      this.endTimer += dt;
      if (this.endTimer > 1.2) {
        this.ended = true;
        this.showResult();
      }
    }
  }

  private statSig = '';
  private updateStats() {
    const out = this.sim.active.length;
    const sig = `${out}|${this.sim.saved}|${Math.ceil(this.sim.timeLeft)}`;
    this.refreshSkills();
    if (sig === this.statSig) return;
    this.statSig = sig;
    this.ui.out.querySelector('b')!.textContent = String(out);
    const sv = this.ui.saved;
    sv.querySelector('b')!.textContent = `${this.sim.saved}/${this.level.toSave}`;
    sv.classList.toggle('good', this.sim.saved >= this.level.toSave);
    const t = this.ui.time;
    t.querySelector('b')!.textContent = fmtTime(Math.ceil(this.sim.timeLeft));
    t.classList.toggle('warn', this.sim.timeLeft < 30);
  }

  private draw() {
    const c = this.octx;
    const w = this.overlay.clientWidth, h = this.overlay.clientHeight;
    c.clearRect(0, 0, w, h);
    const P = (col: number, row: number, lift = 0.3) => this.view.project(col, row, w, h, lift);
    const time = this.clock;

    // objects
    const open = clamp((this.sim.time - 1.1) / 0.4, 0, 1);
    for (const e of this.level.entrances) {
      const cx = (e.min[0] + e.max[0] + 1) / 2;
      const p = P(cx, e.min[1]);
      if (p.facing < 0.12) continue;
      drawEntrance(c, p.x, p.y, p.scale, e.max[0] - e.min[0] + 1, e.max[1] - e.min[1] + 2, e.lemType, open, time);
    }
    for (const r of this.sim.triggers) {
      const t = r.t;
      const p = P((t.min[0] + t.max[0] + 1) / 2, t.min[1]);
      if (p.facing <= 0.12) continue;
      if (t.kind === 'antigrav') drawAntigrav(c, p.x, p.y, p.scale, t.max[0] - t.min[0] + 1, t.max[1] - t.min[1] + 1, time, r.active);
      else drawSwitch(c, p.x, p.y, p.scale, t.kind, r.state, r.active, t.max[0] - t.min[0] + 1, time);
    }
    for (const d of this.sim.doors) {
      const p = P((d.x0 + d.x1) / 2, d.yBot);
      if (p.facing <= 0.12) continue;
      drawDoor(c, p.x, p.y, p.scale, d.x1 - d.x0, d.yTop - d.yBot, d.prog, d.d.mode ? Math.max(0, d.d.count - d.count) : null, time);
    }
    this.level.teleporters.forEach((t) => {
      const p = P(t.pos[0], t.min[1]);
      if (p.facing > 0.12) drawPortal(c, p.x, p.y, p.scale, time);
    });
    for (const r of this.sim.traps) {
      const b = r.box;
      const p = P((b.min[0] + b.max[0] + 1) / 2, b.min[1]);
      if (p.facing > 0.12) drawTrap(c, p.x, p.y, p.scale, b.max[0] - b.min[0] + 1, time, r.flash > 0, r.active, r.moving);
    }
    for (const e of this.level.exits) {
      const p = P((e.min[0] + e.max[0] + 1) / 2, e.min[1]);
      if (p.facing > 0.12) drawExit(c, p.x, p.y, p.scale, time);
    }

    // Lemmo's (far ones first)
    const vis: { l: Lemmo; p: ReturnType<typeof P> }[] = [];
    for (const l of this.sim.lemmos) {
      if (l.state === 'teleporting') continue;
      let x = l.x, y = l.y;
      if (l.state === 'bashing') x += l.dir * clamp((l.cyc - 0.15) / 0.85, 0, 1);
      if (l.state === 'mining' && l.cyc < 0.68) {
        const k = clamp((l.cyc - 0.2) / 0.48, 0, 1);
        x += l.dir * k;
        y -= l.g * k;
      }
      if (l.state === 'climbing') x -= l.dir * 0.35;
      const p = P(x, y, 0.6);
      if (p.facing > 0.12) vis.push({ l, p });
    }
    vis.sort((a, b) => a.p.facing - b.p.facing);

    // hover pick (mouse only: touch picks on release)
    this.lastVis = vis;
    this.hover = this.mouse.x >= 0 && !this.mouse.dragging && !this.touchMode ? this.pick(this.mouse.x, this.mouse.y, 14) : null;
    const lemScale = this.mode === 'flat' ? 1.35 : 1;
    for (const { l, p } of vis) drawLemmo(c, l, p.x, p.y, p.scale * lemScale, { face: l.dir, hover: l === this.hover, time });

    // particles
    for (const pt of this.particles) {
      const p = P(pt.x, pt.y, 0.8);
      if (p.facing < 0.1) continue;
      c.globalAlpha = Math.max(0, pt.life / pt.max);
      c.fillStyle = pt.color;
      const r = Math.max(1, pt.size * p.scale);
      c.fillRect(p.x - r / 2, p.y - r / 2, r, r);
    }
    c.globalAlpha = 1;

    // tooltip
    const tip = this.ui.tooltip;
    if (this.hover) {
      const l = this.hover;
      const tags = [l.climber ? 'Climber' : '', l.floater ? 'Floater' : '', l.type === 1 ? 'Swimmer' : l.type === 2 ? 'Acid-proof' : '',
        l.fast > 0 ? 'Faster' : l.slow > 0 ? 'Slower' : ''].filter(Boolean);
      const can = this.sim.canAssign(l, this.selected);
      tip.innerHTML = `${STATE_LABEL[l.state] ?? l.state}${tags.length ? ` · <em>${tags.join(' · ')}</em>` : ''}${can ? '' : ' · <span style="color:#ff8aa0">can’t ' + SKILL_LABEL[this.selected].toLowerCase() + '</span>'}`;
      tip.style.left = this.mouse.x + 'px';
      tip.style.top = this.mouse.y + 'px';
      tip.classList.remove('hidden');
      this.overlay.style.cursor = 'pointer';
    } else {
      tip.classList.add('hidden');
      if (!this.mouse.dragging) this.overlay.style.cursor = '';
    }
  }
}

const SKILL_HELP: Record<string, string> = {
  rocket: 'Rocket: after 5 seconds the Lemmo blasts off and blows a hole in whatever is above it',
  cartwheel: 'Cartwheel: rolls at double speed, smashing through earth (not metal)',
  trampoline: 'Trampoline: lies down; Lemmo\'s that land on it bounce high',
  antigrav: 'Anti-gravity: flips the Lemmo so it walks on the ceiling',
  slower: 'Slower: walks at half speed for 5 seconds',
  faster: 'Faster: everything at double speed for 5 seconds',
};

export function fmtTime(s: number) {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}


function loadMode(): 'flat' | 'cylinder' {
  try {
    return localStorage.getItem('lemmo.view') === 'cylinder' ? 'cylinder' : 'flat';
  } catch {
    return 'flat';
  }
}

/** Put the panorama's wrap seam at the most solid column that no object or hatch straddles. */
function pickSeam(sim: Sim, level: LevelData): number {
  const busy = new Uint8Array(256);
  const mark = (f: Footprint, pad: number) => {
    for (let x = Math.floor(f.min[0]) - pad; x <= Math.ceil(f.max[0]) + pad; x++) busy[((x % 256) + 256) % 256] = 1;
  };
  level.entrances.forEach((e) => mark(e, 3));
  level.exits.forEach((e) => mark(e, 6));
  level.traps.forEach((e) => mark(e, 2));
  level.triggers.forEach((e) => mark(e, 1));
  level.teleporters.forEach((e) => mark(e, 2));
  let best = 0, bestScore = Infinity;
  for (let x = 0; x < 256; x++) {
    let open = 0;
    for (let y = 0; y < sim.rows; y++) if (!(sim.cells[x + y * 256] & F.EARTH)) open++;
    const score = open + (busy[x] ? 1000 : 0) + Math.abs(((x + 128) % 256) - 128) * 0.001;
    if (score < bestScore) {
      bestScore = score;
      best = x;
    }
  }
  return best;
}
