import { Audio } from './audio.ts';
import { fmtTime, Game } from './game.ts';
import { loadIndex, loadLevel, tierOf, TIERS, type LevelIndexEntry } from './level.ts';
import { ICONS } from './icons.ts';
import { openGuide } from './guide.ts';

const app = document.getElementById('app')!;
const audio = new Audio();
let index: LevelIndexEntry[] = [];
let game: Game | null = null;
let currentTier = 0;

type Progress = Record<string, { best: number; done: boolean }>;
const PKEY = 'lemmo.progress';
function progress(): Progress {
  try {
    return JSON.parse(localStorage.getItem(PKEY) ?? '{}');
  } catch {
    return {};
  }
}
function saveProgress(p: Progress) {
  try {
    localStorage.setItem(PKEY, JSON.stringify(p));
  } catch { /* ignore */ }
}

function clear() {
  game?.destroy();
  game = null;
  app.innerHTML = '';
}

function menu() {
  clear();
  audio.stopMusic();
  const s = document.createElement('div');
  s.className = 'screen menu';
  const done = Object.values(progress()).filter((p) => p.done).length;
  s.innerHTML = `
    <div class="floaters">${Array.from({ length: 14 }, (_, i) =>
      `<span style="left:${(i * 7.3) % 100}%;animation-duration:${9 + (i % 5) * 3}s;animation-delay:${-i * 1.7}s">${i % 3 ? '☂️' : '🟢'}</span>`).join('')}</div>
    <div class="logo">Lemmo</div>
    <div class="tagline">Save the Lemmo's. Spin the world.</div>
    <div class="menu-actions">
      <button class="btn primary" data-a="play">Play</button>
      ${done ? `<button class="btn" data-a="continue">Continue · ${done}/${index.length}</button>` : ''}
      <button class="btn" data-a="help">${ICONS.info} How to play</button>
    </div>
    <div class="hint">102 levels across five islands · ${TIERS.join(' · ')}</div>`;
  s.querySelector<HTMLElement>('[data-a=play]')!.onclick = () => levels();
  s.querySelector<HTMLElement>('[data-a=help]')!.onclick = () => openGuide(s);
  const cont = s.querySelector<HTMLElement>('[data-a=continue]');
  if (cont) cont.onclick = () => {
    const p = progress();
    const next = index.find((e) => !p[e.file!]?.done) ?? index[0];
    play(next);
  };
  app.append(s);
}

function levels() {
  clear();
  audio.stopMusic();
  const s = document.createElement('div');
  s.className = 'screen';
  const p = progress();
  s.innerHTML = `
    <div class="topbar"><button class="btn icon" data-a="back">${ICONS.back}</button><h2>Choose a level</h2><div class="spacer"></div>
      <span class="hint" style="margin:0">${Object.values(p).filter((x) => x.done).length} / ${index.length} complete</span></div>
    <div class="tabs">${TIERS.map((t, i) => `<button class="tab ${i === currentTier ? 'active' : ''}" data-t="${i}">${t}</button>`).join('')}</div>
    <div class="grid"></div>`;
  const grid = s.querySelector<HTMLElement>('.grid')!;
  const render = () => {
    grid.innerHTML = '';
    s.querySelectorAll<HTMLElement>('.tab').forEach((b) => b.classList.toggle('active', Number(b.dataset.t) === currentTier));
    for (const e of index.filter((r) => tierOf(r.slot) === currentTier)) {
      const card = document.createElement('button');
      card.className = 'card';
      const pr = p[e.file!];
      card.innerHTML = `<div class="num">Level ${e.slot + 1}</div><div class="title">${e.title}</div>
        <div class="meta"><span>Save ${e.save}/${e.total}</span><span>⏱ ${fmtTime(e.time)}</span>${pr ? `<span>Best ${pr.best}</span>` : ''}</div>
        ${pr?.done ? '<div class="done">✓</div>' : ''}`;
      card.onclick = () => play(e);
      grid.append(card);
    }
  };
  s.querySelectorAll<HTMLElement>('.tab').forEach((b) => (b.onclick = () => { currentTier = Number(b.dataset.t); render(); }));
  s.querySelector<HTMLElement>('[data-a=back]')!.onclick = () => menu();
  render();
  app.append(s);
}

async function play(entry: LevelIndexEntry, autostart = false) {
  clear();
  currentTier = tierOf(entry.slot);
  const data = await loadLevel(entry.file!);
  game = new Game(data, entry, {
    audio,
    onExit: () => levels(),
    play: (e) => play(e),
    nextOf: (e) => index[index.indexOf(e) + 1] ?? null,
    onFinished: (e, saved, ok) => {
      const p = progress();
      const prev = p[e.file!] ?? { best: 0, done: false };
      p[e.file!] = { best: Math.max(prev.best, saved), done: prev.done || ok };
      saveProgress(p);
    },
  });
  app.append(game.root);
  if (autostart) game.start();
  if (import.meta.env.DEV) (window as any).lemmo = game;
}

loadIndex().then((rows) => {
  index = rows;
  const q = new URLSearchParams(location.search);
  const want = q.get('level');
  const e = want && index.find((r) => r.file?.toLowerCase() === want.toLowerCase());
  if (e) play(e, q.has('play'));
  else menu();
  const tab = q.get('guide');
  if (q.has('guide')) openGuide(app, undefined, (['Basics', 'Skills', 'World', 'Controls', 'Tips'].find((t) => t.toLowerCase() === tab?.toLowerCase()) ?? 'Basics') as never);
});
