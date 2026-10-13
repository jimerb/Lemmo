// Sound for Lemmo. Effects and music run on separate gain channels with their own volume and mute.
// By default everything is synthesized in code (src/synth.ts). If original game WAVs
// have been placed in public/sounds and public/music (see README), those are used instead.
import { GenerativeMusic, synthSfx } from './synth.ts';

const SOUND_NAMES = [
  'letsgo', 'door', 'action', 'chink', 'mine', 'minemetal', 'explode', 'ohno', 'fallsplat', 'yippee',
  'die', 'fire', 'bubble', 'glug2', 'splat', 'thud', 'antigrav', 'teleport', 'beepselect', 'mousepre',
  'fanfarestart', 'balloon', 'changeop',
];

export interface AudioSettings {
  sfx: number;
  music: number;
  sfxMuted: boolean;
  musicMuted: boolean;
}

const KEY = 'lemmo.audio';

/** Fetch a WAV only if it really exists (dev servers may answer missing files with index.html). */
async function fetchWav(url: string): Promise<ArrayBuffer | null> {
  try {
    const r = await fetch(url);
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('audio')) return null;
    return await r.arrayBuffer();
  } catch {
    return null;
  }
}

export class Audio {
  private ctx: AudioContext | null = null;
  private sfxGain!: GainNode;
  private musicGain!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private lastPlayed = new Map<string, number>();
  private track: HTMLAudioElement | null = null;
  private generative: GenerativeMusic | null = null;
  private wantMusic: number | null = null; // seed of the music that should be playing
  private musicPaused = false;
  private originalMusic: boolean | null = null;
  settings: AudioSettings;

  constructor() {
    let s: AudioSettings = { sfx: 0.8, music: 0.45, sfxMuted: false, musicMuted: false };
    try {
      s = { ...s, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
    } catch { /* ignore unavailable storage */ }
    this.settings = s;
  }

  get sfxVolume() {
    return this.settings.sfxMuted ? 0 : this.settings.sfx;
  }

  get musicVolume() {
    return this.settings.musicMuted ? 0 : this.settings.music;
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.settings));
    } catch { /* ignore */ }
    if (this.ctx) {
      this.sfxGain.gain.setTargetAtTime(this.sfxVolume, this.ctx.currentTime, 0.02);
      this.musicGain.gain.setTargetAtTime(this.musicVolume, this.ctx.currentTime, 0.02);
    }
    if (this.track) this.track.volume = this.musicVolume;
  }

  /** Must be called from a user gesture. Loads original WAVs if present, otherwise synthesizes. */
  async unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const ctx = (this.ctx = new AudioContext());
    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = this.sfxVolume;
    this.sfxGain.connect(ctx.destination);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.musicVolume;
    this.musicGain.connect(ctx.destination);
    // synthesized effects are available immediately...
    for (const n of SOUND_NAMES) {
      const b = synthSfx(ctx, n);
      if (b) this.buffers.set(n, b);
    }
    // ...and replaced by the original recordings when the player supplied them
    // (probe one file first so a normal install doesn't make two dozen failed requests).
    const probe = await fetchWav('sounds/letsgo.wav');
    if (probe) await Promise.all(SOUND_NAMES.map(async (n) => {
      const data = await fetchWav(`sounds/${n}.wav`);
      if (!data) return;
      try {
        this.buffers.set(n, await ctx.decodeAudioData(data));
      } catch { /* keep the synthesized version */ }
    }));
    if (this.wantMusic !== null) this.startMusic(this.wantMusic);
  }

  play(name: string, volume = 1) {
    if (!this.ctx) return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    const now = this.ctx.currentTime;
    if (now - (this.lastPlayed.get(name) ?? -1) < 0.06) return; // avoid stacking identical sounds
    this.lastPlayed.set(name, now);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.sfxGain);
    src.start();
  }

  /** Start level music. `seed` picks the track: an original WAV if available, else a generated tune. */
  async startMusic(seed = Math.floor(Math.random() * 1e9)) {
    this.stopMusic();
    this.wantMusic = seed;
    this.musicPaused = false;
    if (!this.ctx) return; // will start once unlock() runs
    if (this.originalMusic === null) {
      try {
        const r = await fetch('music/track01.wav', { method: 'HEAD' });
        this.originalMusic = r.ok && (r.headers.get('content-type') ?? '').includes('audio');
      } catch {
        this.originalMusic = false;
      }
    }
    if (this.wantMusic !== seed) return; // superseded while checking
    if (this.originalMusic) {
      const n = 1 + (seed % 13);
      this.track = new window.Audio(`music/track${String(n).padStart(2, '0')}.wav`);
      this.track.loop = true;
      this.track.volume = this.musicVolume;
      this.track.play().catch(() => {});
    } else {
      this.generative = new GenerativeMusic(this.ctx, this.musicGain, seed);
      this.generative.start();
    }
  }

  stopMusic() {
    this.wantMusic = null;
    this.track?.pause();
    this.track = null;
    this.generative?.dispose();
    this.generative = null;
  }

  pauseMusic(p: boolean) {
    if (p === this.musicPaused) return;
    this.musicPaused = p;
    if (this.track) {
      if (p) this.track.pause();
      else this.track.play().catch(() => {});
    }
    if (this.generative) {
      if (p) this.generative.stop();
      else this.generative.start();
    }
  }
}
