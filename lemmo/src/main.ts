import { Audio } from './audio.ts';
import { fmtTime, Game } from './game.ts';
import { loadIndex, loadLevel, tierOf, TIERS, type LevelIndexEntry } from './level.ts';
import { ICONS } from './icons.ts';
import { openGuide } from './guide.ts';
import { BETA, EICONS, Editor, editorHub, esc, newLevelDialog, userLevelCards, type EditorNav } from './editor.ts';
import { fromShareCode, getUserLevel, listUserLevels, newUserLevel, putUserLevel, recordPlay, totalLemmos, type UserLevel } from './userlevels.ts';

const app = document.getElementById('app')!;
const audio = new Audio();
let index: LevelIndexEntry[] = [];
let game: Game | null = null;
let editor: Editor | null = null;
let currentTier = 0;
/** Level-select tab index of the user-made sandbox levels (after the campaign tiers). */
const USER_TAB = TIERS.length;

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
  editor?.destroy();
  editor = null;
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
      <button class="btn" data-a="editor">${EICONS.edit} Level Editor ${BETA}</button>
      <button class="btn" data-a="help">${ICONS.info} How to play</button>
    </div>
    <div class="hint">102 levels across five islands · ${TIERS.join(' · ')}</div>`;
  s.querySelector<HTMLElement>('[data-a=play]')!.onclick = () => levels();
  s.querySelector<HTMLElement>('[data-a=help]')!.onclick = () => openGuide(s);
  s.querySelector<HTMLElement>('[data-a=editor]')!.onclick = () => hub();
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
    <div class="tabs">${TIERS.map((t, i) => `<button class="tab ${i === currentTier ? 'active' : ''}" data-t="${i}">${t}</button>`).join('')}
      <button class="tab" data-t="${USER_TAB}" title="Levels made in the Level Editor, just for fun">✦ User levels · Sandbox</button></div>
    <div class="grid"></div>`;
  const grid = s.querySelector<HTMLElement>('.grid')!;
  const render = () => {
    grid.innerHTML = '';
    s.querySelectorAll<HTMLElement>('.tab').forEach((b) => b.classList.toggle('active', Number(b.dataset.t) === currentTier));
    if (currentTier === USER_TAB) {
      grid.append(...userLevelCards({ ...nav, newLevel: () => newLevelDialog(s, nav) }));
      return;
    }
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

// ---------------------------------------------------------------- Level Editor (beta) + sandbox
const nav: EditorNav = {
  menu: () => menu(),
  hub: () => hub(),
  edit: (id) => edit(id),
  play: (id, test) => playUser(id, test),
  campaign: () => index,
};

function hub() {
  clear();
  audio.stopMusic();
  app.append(editorHub(nav));
}

function edit(id: string) {
  const u = getUserLevel(id);
  if (!u) return hub();
  clear();
  audio.stopMusic();
  editor = new Editor(u, nav);
  app.append(editor.root);
}

function userEntry(u: UserLevel, test: boolean): LevelIndexEntry {
  return {
    slot: -1, name: u.id, title: esc(u.title), time: u.level.timeLimit, save: u.level.toSave,
    total: totalLemmos(u.level), file: null, tag: test ? 'Test play · Level Editor' : 'User level · Sandbox',
  };
}

/** Play a user level: from the sandbox list, or as a test run that returns to the editor. */
function playUser(id: string, test: boolean) {
  const u = getUserLevel(id);
  if (!u) return test ? hub() : levels();
  clear();
  game = new Game(structuredClone(u.level), userEntry(u, test), {
    audio,
    exitLabel: test ? 'Editor' : 'Levels',
    onExit: () => (test ? edit(id) : ((currentTier = USER_TAB), levels())),
    play: (e) => playUser(e.name, test),
    nextOf: (e) => {
      if (test) return null;
      const all = listUserLevels();
      const next = all[all.findIndex((x) => x.id === e.name) + 1];
      return next ? userEntry(next, false) : null;
    },
    onFinished: (_e, saved, ok) => recordPlay(id, saved, ok),
    resultNote: test
      ? (ok) => (ok ? '✓ Level verified: you proved it can be won.' : 'Not verified yet: beat your level to prove it can be won.')
      : undefined,
  });
  app.append(game.root);
  if (import.meta.env.DEV) (window as any).lemmo = game;
}

/** A level arrived in the URL (#share=…): show it and offer to play or edit a copy. */
async function openShared(code: string) {
  history.replaceState(null, '', location.pathname + location.search);
  if (!game && !editor) menu();
  const back = document.createElement('div');
  back.className = 'modal-back';
  const m = document.createElement('div');
  m.className = 'modal';
  back.append(m);
  app.append(back);
  try {
    const { title, level } = await fromShareCode(code);
    const total = totalLemmos(level);
    m.innerHTML = `<div class="sub">Shared level</div><h3>${esc(title)}</h3>
      <div class="facts"><div class="fact"><b>${total}</b><span>Lemmo's</span></div><div class="fact"><b>${level.toSave}</b><span>To save</span></div>
      <div class="fact"><b>${fmtTime(level.timeLimit)}</b><span>Time</span></div></div>
      <div class="hint">Playing or editing it saves a copy to your <b>User levels</b>, so you can come back to it or remix it.</div>
      <div class="actions"><button class="btn ghost" data-a="no">Not now</button><button class="btn" data-a="edit">${EICONS.edit} Edit</button><button class="btn primary" data-a="play">${ICONS.play} Play</button></div>`;
    const keep = (then: (id: string) => void) => {
      const u = newUserLevel(level, title);
      if (!putUserLevel(u)) {
        m.querySelector('.hint')!.textContent = 'Browser storage is full. Delete or export some levels first.';
        return;
      }
      back.remove();
      then(u.id);
    };
    m.querySelector<HTMLElement>('[data-a=no]')!.onclick = () => back.remove();
    m.querySelector<HTMLElement>('[data-a=play]')!.onclick = () => keep((id) => playUser(id, false));
    m.querySelector<HTMLElement>('[data-a=edit]')!.onclick = () => keep((id) => edit(id));
  } catch (e) {
    m.innerHTML = `<h3>Couldn't open that level</h3><div class="sub">${esc((e as Error).message)}</div><div class="actions"><button class="btn primary">OK</button></div>`;
    m.querySelector('button')!.onclick = () => back.remove();
  }
}

const shareInHash = () => (location.hash.startsWith('#share=') ? location.hash.slice(7) : null);
window.addEventListener('hashchange', () => {
  const code = shareInHash();
  if (code) openShared(code);
});

loadIndex().then((rows) => {
  index = rows;
  const shared = shareInHash();
  if (shared) return openShared(shared);
  const q = new URLSearchParams(location.search);
  const want = q.get('level');
  const e = want && index.find((r) => r.file?.toLowerCase() === want.toLowerCase());
  if (e) play(e, q.has('play'));
  else if (q.has('edit') && getUserLevel(q.get('edit')!)) edit(q.get('edit')!);
  else if (q.has('editor')) hub();
  else menu();
  const tab = q.get('guide');
  if (q.has('guide')) openGuide(app, undefined, (['Basics', 'Skills', 'World', 'Controls', 'Tips'].find((t) => t.toLowerCase() === tab?.toLowerCase()) ?? 'Basics') as never);
});
