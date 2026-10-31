// An electric guitar through a valve-style amp, all synthesised with Web Audio.
// Strings: Karplus-Strong with an allpass for exact tuning, picked near the bridge and heard through
// a bridge pickup; every note has two takes, a few cents apart and panned hard left and right, like a
// double-tracked rhythm part. Amp: mid push into an asymmetric soft clipper (the Gain knob), a 4x12
// cabinet made of filters, a small room, a limiter.
// The AudioContext is only created by setPower(true), which must run inside a user gesture.

// Drop D with open strings left ringing, the voicings Alter Bridge lean on.
const CHORDS = [
  [38, 45, 50, 57, 62, 64], // D5add9
  [46, 53, 57, 62, 64], // Bbmaj7#11
  [48, 55, 60, 62, 64], // Cadd9
  [43, 50, 55, 57, 62, 64], // G6/9
  [45, 52, 57, 59, 64], // Asus2
];
const SECONDS = 4;
// Loop filter (1 - S) + S·z⁻¹: how much the string darkens on every trip.
const S = 0.32;

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

function pluckString(rate: number, freq: number, out: Float32Array) {
  // The loop filter delays by S samples, the allpass makes up the fraction left over.
  const period = rate / freq - S;
  const n = Math.floor(period - 0.1);
  const d = period - n;
  const c = (1 - d) / (1 + d);
  // Low strings ring longer; g sets a 60 dB fade over t60 seconds.
  const t60 = 3 + 4 * Math.sqrt(73.4 / freq);
  const g = Math.pow(10, -3 / (t60 * freq));
  const line = new Float32Array(n);
  // Picked about 13% from the bridge: a soft noise burst minus a delayed copy of itself.
  const pick = Math.max(1, Math.round(n * 0.13));
  const burst = new Float32Array(n);
  for (let i = 0; i < n; i++) burst[i] = (i ? burst[i - 1] * 0.35 : 0) + (Math.random() * 2 - 1) * 0.65;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    line[i] = burst[i] - (i >= pick ? burst[i - pick] : 0);
    peak = Math.max(peak, Math.abs(line[i]));
  }
  for (let i = 0; i < n; i++) line[i] /= peak;
  let x1 = 0;
  let a1 = 0;
  let y1 = 0;
  for (let i = 0, p = 0; i < out.length; i++) {
    const x = line[p];
    out[i] = x;
    const lp = (1 - S) * x + S * x1;
    x1 = x;
    const ap = c * lp + a1 - c * y1;
    a1 = lp;
    y1 = ap;
    line[p] = ap * g;
    p = p + 1 === n ? 0 : p + 1;
  }
  // Bridge pickup: a partial comb that thins the lows and adds bite.
  const q = Math.max(1, Math.round(n * 0.18));
  for (let i = out.length - 1; i >= 0; i--) out[i] = (out[i] - (i >= q ? 0.7 * out[i - q] : 0)) * 0.6;
  const tail = Math.floor(rate * 0.3);
  for (let i = 0; i < tail; i++) out[out.length - 1 - i] *= i / tail;
}

function render(ctx: AudioContext, midi: number) {
  const buffer = ctx.createBuffer(2, Math.floor(ctx.sampleRate * SECONDS), ctx.sampleRate);
  pluckString(ctx.sampleRate, hz(midi - 0.03), buffer.getChannelData(0));
  pluckString(ctx.sampleRate, hz(midi + 0.03), buffer.getChannelData(1));
  return buffer;
}

// Valve-like clipping: harder on one half of the wave than the other, for even harmonics.
const valve = (gain: number) => {
  const k = 0.6 + Math.pow(gain, 1.5) * 50;
  const curve = new Float32Array(2048);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = x >= 0 ? Math.tanh(k * x) / Math.tanh(k) : (0.9 * Math.tanh(0.7 * k * x)) / Math.tanh(0.7 * k);
  }
  return curve;
};

export interface GuitarAudio {
  setPower(on: boolean): void;
  setGain(v: number): void;
  setVolume(v: number): void;
  /** position 0 (low) to 1 (high) across the notes of the current chord, velocity 0 to 1. */
  pluck(position: number, velocity: number): void;
  /** Strums the next chord of the progression. */
  strum(): void;
}

export function createGuitarAudio(): GuitarAudio {
  let ctx: AudioContext | null = null;
  let input: GainNode;
  let shaper: WaveShaperNode;
  let master: GainNode;
  let on = false;
  let gain = 4 / 11;
  let volume = 7 / 11;
  let chord = -1;
  const buffers = new Map<number, AudioBuffer>();
  // One voice per note, like a string: plucking it again chokes the old one.
  const ringing = new Map<number, { src: AudioBufferSourceNode; amp: GainNode }>();

  // The Volume knob tops out where 6 used to be, and the whole range sits low: a web page shouldn't
  // blast anyone's speakers. 11 still means the maximum.
  const level = () => (on ? Math.pow((volume * 6) / 11, 2) * 0.3 : 0);
  const notes = () => {
    const c = CHORDS[Math.max(0, chord)];
    return [...c, c[c.length - 2] + 12, c[c.length - 1] + 12];
  };
  const buffer = (midi: number) => {
    let b = buffers.get(midi);
    if (!b) {
      b = render(ctx!, midi);
      buffers.set(midi, b);
    }
    return b;
  };

  const build = () => {
    const c = new AudioContext();
    ctx = c;
    const filter = (type: BiquadFilterType, frequency: number, Q: number, gainDb = 0) => {
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = frequency;
      f.Q.value = Q;
      f.gain.value = gainDb;
      return f;
    };
    input = c.createGain();
    shaper = c.createWaveShaper();
    shaper.curve = valve(gain);
    shaper.oversample = '4x';
    master = c.createGain();
    master.gain.value = 0;
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;

    // Pickup resonance, then a tight low end and a mid push before the clipper, like a drive pedal.
    const pre = [filter('peaking', 3400, 1.4, 4), filter('highpass', 110, 0.7), filter('peaking', 750, 0.9, 6)];
    // 4x12 cabinet: no rumble, some thump, presence, and a steep roll-off above 5 kHz that kills the fizz.
    const cab = [
      filter('lowpass', 6500, 0.7),
      filter('highpass', 85, 0.8),
      filter('peaking', 120, 1, 3),
      filter('peaking', 2600, 1.2, 3),
      filter('lowpass', 4800, 0.8),
      filter('lowpass', 5200, 0.6),
    ];
    const chain: AudioNode[] = [input, ...pre, shaper, ...cab];
    for (let i = 1; i < chain.length; i++) chain[i - 1].connect(chain[i]);
    const out = cab[cab.length - 1];

    // A small room: two channels of decaying noise.
    const room = c.createConvolver();
    const ir = c.createBuffer(2, Math.floor(c.sampleRate * 1.4), c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      const gap = Math.floor(c.sampleRate * 0.01);
      for (let i = gap; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp((-(i - gap) / c.sampleRate) * 4.5);
    }
    room.buffer = ir;
    const wet = c.createGain();
    wet.gain.value = 0.16;
    out.connect(master);
    out.connect(room).connect(wet).connect(master);
    master.connect(limiter).connect(c.destination);
  };

  // The valves waking up: a short, low thump straight to the speaker.
  const thump = (size: number) => {
    const c = ctx!;
    const b = c.createBuffer(1, Math.floor(c.sampleRate * 0.12), c.sampleRate);
    const data = b.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / c.sampleRate;
      data[i] = (Math.sin(2 * Math.PI * 52 * t) + (Math.random() - 0.5) * 0.3) * Math.exp(-t * 40) * size;
    }
    const src = c.createBufferSource();
    src.buffer = b;
    src.connect(master);
    src.start();
  };

  const play = (midi: number, velocity: number, delay = 0) => {
    if (!ctx || !on) return;
    const at = ctx.currentTime + delay;
    const old = ringing.get(midi);
    if (old) {
      old.amp.gain.setTargetAtTime(0, at, 0.012);
      old.src.stop(at + 0.08);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer(midi);
    const amp = ctx.createGain();
    amp.gain.value = velocity;
    src.connect(amp).connect(input);
    src.start(at);
    ringing.set(midi, { src, amp });
    src.onended = () => {
      if (ringing.get(midi)?.src === src) ringing.delete(midi);
    };
  };

  // Rendering a note takes a few milliseconds: do the progression one note per tick after power-on,
  // so the first strum of each chord never stalls a frame.
  const warm = () => {
    const todo = [...new Set(CHORDS.flat())].filter((m) => !buffers.has(m));
    const next = () => {
      const m = todo.shift();
      if (m === undefined) return;
      buffer(m);
      setTimeout(next, 30);
    };
    next();
  };

  return {
    setPower(next) {
      if (next === on) return;
      on = next;
      if (on && !ctx) {
        build();
        warm();
      }
      if (!ctx) return;
      if (on) ctx.resume();
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(level(), ctx.currentTime, 0.03);
      if (on) thump(0.35);
    },
    setGain(v) {
      gain = v;
      if (ctx) shaper.curve = valve(gain);
    },
    setVolume(v) {
      volume = v;
      if (ctx) master.gain.setTargetAtTime(level(), ctx.currentTime, 0.03);
    },
    pluck(position, velocity) {
      const list = notes();
      const i = Math.round(Math.min(1, Math.max(0, position)) * (list.length - 1));
      play(list[i], 0.2 + velocity * 0.45);
    },
    strum() {
      chord = (chord + 1) % CHORDS.length;
      // Strings the new shape doesn't use get muted by the fretting hand.
      if (ctx) {
        for (const [midi, v] of ringing) {
          if (CHORDS[chord].includes(midi)) continue;
          v.amp.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
          v.src.stop(ctx.currentTime + 0.12);
          ringing.delete(midi);
        }
      }
      CHORDS[chord].forEach((midi, k) => play(midi, 0.42 + Math.random() * 0.08, k * 0.014));
    },
  };
}
