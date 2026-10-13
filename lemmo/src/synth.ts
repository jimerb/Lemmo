// Original synthesized sound effects for Lemmo (no recordings needed). Each effect is rendered
// once into an AudioBuffer from a small sample-generating function.

const TAU = Math.PI * 2;

type Gen = (t: number, i: number) => number;

function render(ctx: BaseAudioContext, seconds: number, gen: Gen): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.ceil(seconds * sr);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = gen(i / sr, i);
  // soft clip + tiny fades to avoid clicks
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / (sr * 0.003), (n - i) / (sr * 0.01));
    d[i] = Math.tanh(d[i] * 1.2) * fade;
  }
  return buf;
}

// deterministic noise
let seed = 1234567;
const noise = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return (seed / 0xffffffff) * 2 - 1;
};

/** One-pole low-pass filter state helper. */
function lowpass(cut: number, sr: number) {
  const a = 1 - Math.exp((-TAU * cut) / sr);
  let y = 0;
  return (x: number) => (y += a * (x - y));
}

const env = (t: number, attack: number, decay: number) => (t < attack ? t / attack : Math.exp(-(t - attack) / decay));
const tri = (p: number) => 2 * Math.abs(2 * (p - Math.floor(p + 0.5))) - 1;
const sq = (p: number, duty = 0.5) => (p - Math.floor(p) < duty ? 0.6 : -0.6);

/** Phase accumulator for frequency sweeps. */
function osc() {
  let ph = 0, last = 0;
  return (t: number, f: number) => {
    ph += f * (t - last);
    last = t;
    return ph;
  };
}

/** A sung note with vibrato and a vowel-ish timbre (used for the lemming "voices"). */
function voice(t: number, ph: number) {
  const vib = 1 + 0.02 * Math.sin(TAU * 6 * t);
  const p = ph * vib;
  return 0.55 * Math.sin(TAU * p) + 0.25 * Math.sin(TAU * 2 * p) + 0.12 * tri(3 * p);
}

const SFX: Record<string, (ctx: BaseAudioContext) => AudioBuffer> = {
  beepselect: (c) => render(c, 0.07, (t) => 0.35 * Math.sin(TAU * 1320 * t) * env(t, 0.002, 0.025)),
  mousepre: (c) => render(c, 0.04, (t) => 0.3 * Math.sin(TAU * 1800 * t) * env(t, 0.001, 0.01)),
  action: (c) => {
    const o = osc();
    return render(c, 0.12, (t) => 0.4 * sq(o(t, t < 0.05 ? 660 : 990), 0.3) * env(t, 0.003, 0.05));
  },
  changeop: (c) => {
    const o = osc();
    return render(c, 0.18, (t) => 0.35 * Math.sin(TAU * o(t, 500 + t * 3000)) * env(t, 0.005, 0.06));
  },
  door: (c) => {
    const lp = lowpass(500, c.sampleRate);
    return render(c, 0.45, (t) => 0.9 * lp(noise()) * env(t, 0.002, 0.07) + 0.6 * Math.sin(TAU * 95 * t) * env(t, 0.002, 0.12));
  },
  letsgo: (c) => {
    const o = osc();
    const notes = [523, 659, 784];
    return render(c, 0.55, (t) => {
      const k = Math.min(2, Math.floor(t / 0.13));
      const f = notes[k];
      const local = t - k * 0.13;
      return 0.45 * voice(t, o(t, f)) * env(local, 0.01, k === 2 ? 0.18 : 0.06);
    });
  },
  yippee: (c) => {
    const o = osc();
    return render(c, 0.42, (t) => {
      const f = 650 + 1100 * Math.min(1, t / 0.25);
      return 0.42 * voice(t, o(t, f)) * env(t, 0.01, 0.16) + 0.08 * Math.sin(TAU * 3200 * t) * env(t, 0.05, 0.05);
    });
  },
  ohno: (c) => {
    const o = osc();
    return render(c, 0.6, (t) => {
      const f = t < 0.24 ? 560 : 420 - (t - 0.24) * 120;
      const e = t < 0.24 ? env(t, 0.02, 0.12) : env(t - 0.24, 0.02, 0.18);
      return 0.45 * voice(t, o(t, f)) * e;
    });
  },
  chink: (c) => render(c, 0.35, (t) => {
    const e = env(t, 0.001, 0.07);
    return e * (0.3 * Math.sin(TAU * 2093 * t) + 0.22 * Math.sin(TAU * 3311 * t) + 0.15 * Math.sin(TAU * 4723 * t));
  }),
  minemetal: (c) => render(c, 0.4, (t) => {
    const e = env(t, 0.001, 0.09);
    return e * (0.35 * Math.sin(TAU * 1480 * t) + 0.22 * Math.sin(TAU * 2370 * t) + 0.12 * noise() * Math.exp(-t * 60));
  }),
  mine: (c) => {
    const lp = lowpass(1800, c.sampleRate);
    return render(c, 0.16, (t) => 0.8 * lp(noise()) * env(t, 0.001, 0.035));
  },
  thud: (c) => render(c, 0.2, (t) => 0.8 * Math.sin(TAU * (90 - t * 120) * t) * env(t, 0.002, 0.05)),
  explode: (c) => {
    const lp = lowpass(900, c.sampleRate);
    const lp2 = lowpass(160, c.sampleRate);
    const o = osc();
    return render(c, 1.3, (t) => {
      const n = noise();
      return 0.9 * lp(n) * env(t, 0.003, 0.25) + 0.7 * lp2(n) * env(t, 0.01, 0.5) + 0.6 * Math.sin(TAU * o(t, 70 - 40 * Math.min(1, t))) * env(t, 0.004, 0.3);
    });
  },
  fallsplat: (c) => {
    const lp = lowpass(700, c.sampleRate);
    const o = osc();
    return render(c, 0.35, (t) => 0.8 * lp(noise()) * env(t, 0.001, 0.06) + 0.5 * Math.sin(TAU * o(t, 220 - 400 * t)) * env(t, 0.002, 0.08));
  },
  splat: (c) => {
    const lp = lowpass(1200, c.sampleRate);
    return render(c, 0.3, (t) => 0.8 * lp(noise()) * env(t, 0.001, 0.05) * (1 + 0.5 * Math.sin(TAU * 30 * t)));
  },
  die: (c) => {
    const o = osc();
    return render(c, 0.7, (t) => 0.4 * tri(o(t, 420 * Math.pow(0.25, t / 0.7))) * env(t, 0.01, 0.3));
  },
  fire: (c) => {
    const lp = lowpass(2500, c.sampleRate);
    return render(c, 0.8, (t) => {
      const crackle = Math.random() < 0.004 ? 1 : 0;
      return (0.35 * lp(noise()) + crackle * 0.8) * env(t, 0.03, 0.35);
    });
  },
  bubble: (c) => render(c, 0.6, (t) => {
    const k = Math.floor(t / 0.11);
    const l = t - k * 0.11;
    return 0.4 * Math.sin(TAU * (380 + k * 70 + l * 2600) * l) * env(l, 0.004, 0.03) * Math.exp(-t * 2);
  }),
  glug2: (c) => render(c, 0.5, (t) => {
    const k = Math.floor(t / 0.13);
    const l = t - k * 0.13;
    return 0.5 * Math.sin(TAU * (220 + k * 40 + l * 1600) * l) * env(l, 0.004, 0.04) * Math.exp(-t * 2.5);
  }),
  antigrav: (c) => {
    const o = osc();
    return render(c, 0.75, (t) => 0.35 * Math.sin(TAU * o(t, 200 + 1400 * (t / 0.75) ** 2)) * env(t, 0.02, 0.35) * (0.7 + 0.3 * Math.sin(TAU * 18 * t)));
  },
  teleport: (c) => {
    const o = osc(), m = osc();
    return render(c, 0.8, (t) => {
      const mod = Math.sin(TAU * m(t, 30 + t * 60)) * 300;
      return 0.32 * Math.sin(TAU * o(t, 600 + mod + 900 * t)) * env(t, 0.02, 0.3);
    });
  },
  balloon: (c) => {
    const lp = lowpass(600, c.sampleRate);
    return render(c, 0.6, (t) => 0.5 * lp(noise()) * env(t, 0.15, 0.2));
  },
  fanfarestart: (c) => {
    const notes: [number, number, number][] = [[523, 0, 0.14], [659, 0.14, 0.14], [784, 0.28, 0.14], [1047, 0.42, 0.7]];
    return render(c, 1.3, (t) => {
      let s = 0;
      for (const [f, at, len] of notes) {
        const l = t - at;
        if (l < 0) continue;
        const e = l < len ? env(l, 0.01, 0.4) : env(l, 0.01, 0.4) * Math.exp(-(l - len) * 6);
        s += e * (0.25 * tri(f * l) + 0.12 * sq(f * l, 0.25) + 0.08 * Math.sin(TAU * 2 * f * l));
      }
      return s;
    });
  },
};

export function synthSfx(ctx: BaseAudioContext, name: string): AudioBuffer | null {
  return SFX[name]?.(ctx) ?? null;
}

// ---------------------------------------------------------------- generative music

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};
const PROGRESSIONS = [[0, 5, 3, 4], [0, 3, 4, 3], [0, 4, 5, 3], [5, 3, 0, 4], [0, 2, 3, 4]];

/**
 * A small, upbeat generative soundtrack: bass, pad, arpeggio, lead melody and light percussion,
 * scheduled ahead on the WebAudio clock. Each seed gives a different key, tempo and tune.
 */
export class GenerativeMusic {
  private timer = 0;
  private nextTime = 0;
  private step = 0;
  private out: GainNode;
  private noiseBuf: AudioBuffer;
  private rand: () => number;
  private root: number;
  private scale: number[];
  private prog: number[];
  private bpm: number;
  private melody: number[];
  private running = false;

  constructor(private ctx: AudioContext, dest: AudioNode, seedValue: number) {
    let s = seedValue >>> 0 || 1;
    this.rand = () => ((s = (s * 1103515245 + 12345) >>> 0) / 0xffffffff);
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    this.out.connect(dest);
    this.root = 48 + Math.floor(this.rand() * 7); // C3..F#3
    const names = Object.keys(SCALES) as (keyof typeof SCALES)[];
    this.scale = SCALES[names[Math.floor(this.rand() * names.length)]];
    this.prog = PROGRESSIONS[Math.floor(this.rand() * PROGRESSIONS.length)];
    this.bpm = 104 + Math.floor(this.rand() * 28);
    this.melody = Array.from({ length: 32 }, () => (this.rand() < 0.62 ? Math.floor(this.rand() * 8) : -1));
    const nb = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
  }

  private midi(n: number) {
    return 440 * Math.pow(2, (n - 69) / 12);
  }

  private degree(chord: number, deg: number, octave = 0) {
    const i = chord + deg;
    const oct = Math.floor(i / 7);
    return this.root + this.scale[((i % 7) + 7) % 7] + 12 * (oct + octave);
  }

  private note(type: OscillatorType, freq: number, at: number, len: number, vol: number, cutoff = 4000) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    o.type = type;
    o.frequency.value = freq;
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, at + len);
    o.connect(f).connect(g).connect(this.out);
    o.start(at);
    o.stop(at + len + 0.05);
  }

  private hat(at: number, vol: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0005, at + 0.05);
    src.connect(f).connect(g).connect(this.out);
    src.start(at);
    src.stop(at + 0.06);
  }

  private kick(at: number) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(130, at);
    o.frequency.exponentialRampToValueAtTime(45, at + 0.12);
    g.gain.setValueAtTime(0.55, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
    o.connect(g).connect(this.out);
    o.start(at);
    o.stop(at + 0.2);
  }

  /** Schedule one 16th-note step. */
  private schedule(step: number, at: number) {
    const sixteenth = 60 / this.bpm / 4;
    const bar = Math.floor(step / 16) % this.prog.length;
    const chord = this.prog[bar];
    const s = step % 16;
    const section = Math.floor(step / 64) % 4; // vary the arrangement every 4 bars
    // pad on each bar
    if (s === 0) {
      for (const d of [0, 2, 4]) this.note('sawtooth', this.midi(this.degree(chord, d, 1)), at, sixteenth * 16, 0.035, 1400);
    }
    // bouncy bass
    if (s % 4 === 0 || s === 6 || s === 14) {
      const n = s === 6 || s === 14 ? this.degree(chord, 4, -1) : this.degree(chord, 0, -1);
      this.note('triangle', this.midi(n), at, sixteenth * 1.6, 0.22, 900);
    }
    // arpeggio
    if (section !== 0 || s % 2 === 0) {
      const pattern = [0, 2, 4, 7, 4, 2];
      const n = this.degree(chord, pattern[s % pattern.length], 2);
      this.note('square', this.midi(n), at, sixteenth * 0.9, 0.035, 2600);
    }
    // lead melody on 8th notes in later sections
    if (section >= 2 && s % 2 === 0) {
      const m = this.melody[(step / 2) % this.melody.length];
      if (m >= 0) this.note('triangle', this.midi(this.degree(chord, m, 2)), at, sixteenth * 1.8, 0.09, 5000);
    }
    // percussion
    if (s % 4 === 0) this.kick(at);
    if (s % 2 === 1) this.hat(at, 0.06);
    if (s === 12) this.hat(at, 0.12);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.nextTime = this.ctx.currentTime + 0.1;
    const tick = () => {
      if (!this.running) return;
      const sixteenth = 60 / this.bpm / 4;
      while (this.nextTime < this.ctx.currentTime + 0.25) {
        this.schedule(this.step++, this.nextTime);
        this.nextTime += sixteenth;
      }
      this.timer = window.setTimeout(tick, 60);
    };
    tick();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }

  dispose() {
    this.stop();
    const g = this.out;
    g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    setTimeout(() => g.disconnect(), 400);
  }
}
