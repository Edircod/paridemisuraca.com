// Rock symbols (bolts, picks, flames, notes, speakers, vinyls…) laid over the music photo in the shape
// of the figure: faint at rest, so the photo shows, lit up where the cursor or the strum wakes them.
// Each symbol is pre-rendered once per colour and the resting figure is cached on a base layer:
// a frame copies the base and redraws only the symbols the cursor or the strum woke up.
import type { FieldData } from './glyph-portrait';

const SPRITE = 64;
const PAPER = '#f0efea';
const SKY = '#72cffa';
const SIGNAL = '#76efe0';
// Below this a symbol looks the same as its resting copy on the base layer.
const AWAKE = 0.05;
// How much of the resting figure shows over the photo.
const REST = 0.16;

type Draw = (c: CanvasRenderingContext2D) => void;

const fill = (d: string): Draw => (c) => c.fill(new Path2D(d));
const SYMBOLS: Draw[] = [
  fill('M38 4 14 36h16l-6 24 26-36H34l8-20Z'),
  fill('M32 60C18 46 8 30 10 16 12 8 22 4 32 4s20 4 22 12c2 14-8 30-22 44Z'),
  fill('M32 2l6 24 24 6-24 6-6 24-6-24-24-6 24-6Z'),
  fill('M32 62c-16 0-22-14-16-26 4-8 10-10 8-22 10 6 14 14 12 22 4-4 6-8 6-12 10 10 12 22 6 30-4 6-10 8-16 8Z'),
  (c) => {
    c.beginPath();
    c.ellipse(22, 48, 10, 7, -0.4, 0, Math.PI * 2);
    c.fill();
    c.fillRect(29, 8, 4, 40);
    c.fill(new Path2D('M33 8c11 6 17 14 13 26-2-8-6-12-13-14Z'));
  },
  (c) => {
    c.beginPath();
    c.ellipse(16, 50, 9, 6.5, -0.4, 0, Math.PI * 2);
    c.ellipse(46, 44, 9, 6.5, -0.4, 0, Math.PI * 2);
    c.fill();
    c.fillRect(21, 14, 4, 36);
    c.fillRect(51, 8, 4, 36);
    c.fill(new Path2D('M21 14 55 8v8L21 22Z'));
  },
  (c) => {
    c.lineWidth = 5;
    c.beginPath();
    c.arc(32, 32, 26, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(32, 32, 15, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(32, 32, 6, 0, Math.PI * 2);
    c.fill();
  },
  (c) => {
    c.beginPath();
    c.arc(32, 32, 28, 0, Math.PI * 2);
    c.fill();
    c.globalCompositeOperation = 'destination-out';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(32, 32, 19, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(32, 32, 10, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(32, 32, 2.5, 0, Math.PI * 2);
    c.fill();
  },
  (c) => {
    c.beginPath();
    c.roundRect(4, 22, 56, 20, 4);
    c.fill();
    c.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 6; k++) c.fillRect(9 + k * 8.5, 29, 5, 6);
  },
];

const sprites = (color: string) =>
  SYMBOLS.map((paint) => {
    const c = document.createElement('canvas');
    c.width = c.height = SPRITE;
    const g = c.getContext('2d')!;
    g.fillStyle = g.strokeStyle = color;
    paint(g);
    return c;
  });

const hash = (i: number) => {
  const s = Math.sin(i * 91.345 + 7.13) * 43758.5453;
  return s - Math.floor(s);
};

export interface SymbolField {
  setGain(v: number): void;
  setVolume(v: number): void;
  onLevel(cb: (v: number) => void): void;
  strum(): void;
}

export function mountSymbolField(stage: HTMLElement, canvas: HTMLCanvasElement, data: FieldData): SymbolField {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctx = canvas.getContext('2d')!;
  const base = document.createElement('canvas');
  const bctx = base.getContext('2d')!;
  const paper = sprites(PAPER);
  const sky = sprites(SKY);
  const signal = sprites(SIGNAL);

  let W = 0;
  let H = 0;
  let dpr = 1;
  let xs = new Float32Array(0);
  let ys = new Float32Array(0);
  let size = new Float32Array(0);
  let alpha = new Float32Array(0);
  let kind = new Uint8Array(0);
  let spin = new Float32Array(0);
  let energy = new Float32Array(0);
  let gain = 4 / 11;
  let volume = 7 / 11;
  let level = 0;
  let listener: (v: number) => void = () => {};
  const pointer = { x: -9999, y: -9999, inside: false };
  let strum = -1;
  let lastStrum = performance.now();
  let running = false;
  let visible = false;
  let raf = 0;
  let last = performance.now();

  const resize = () => {
    const r = stage.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = r.width;
    H = r.height;
    canvas.width = base.width = Math.round(W * dpr);
    canvas.height = base.height = Math.round(H * dpr);
    // ~5px cells: small symbols, so the figure keeps enough detail to read as a face.
    const cols = W < 360 ? 64 : 95;
    const cell = W / cols;
    const rows = Math.round(H / cell);
    const keep: number[][] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        // Max over the source block keeps thin features like the guitar neck alive.
        let l = 0;
        const sx0 = Math.floor((x / cols) * data.w);
        const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) / cols) * data.w));
        const sy0 = Math.floor((y / rows) * data.h);
        const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) / rows) * data.h));
        for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) l = Math.max(l, Number(data.rows[sy][sx]));
        if (l > 0) keep.push([x, y, l]);
      }
    }
    const n = keep.length;
    xs = new Float32Array(n);
    ys = new Float32Array(n);
    size = new Float32Array(n);
    alpha = new Float32Array(n);
    kind = new Uint8Array(n);
    spin = new Float32Array(n);
    energy = new Float32Array(n);
    keep.forEach(([x, y, l], i) => {
      const h = hash(y * cols + x);
      xs[i] = (x + 0.5) * cell + (h - 0.5) * cell * 0.3;
      ys[i] = (y + 0.5) * cell + (hash(h * 977) - 0.5) * cell * 0.3;
      size[i] = cell * (0.25 + 0.95 * Math.pow(l / 9, 1.3));
      alpha[i] = 0.1 + 0.9 * Math.pow(l / 9, 1.8);
      kind[i] = Math.floor(hash(h * 31) * SYMBOLS.length);
      spin[i] = (hash(h * 53) - 0.5) * 0.9;
    });
    bctx.imageSmoothingQuality = 'high';
    for (let i = 0; i < n; i++) {
      put(bctx, spin[i], xs[i], ys[i]);
      bctx.globalAlpha = alpha[i];
      bctx.drawImage(paper[kind[i]], -size[i] / 2, -size[i] / 2, size[i], size[i]);
    }
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.globalAlpha = 1;
    draw(performance.now());
  };

  const put = (c: CanvasRenderingContext2D, a: number, x: number, y: number) => {
    const cs = Math.cos(a) * dpr;
    const sn = Math.sin(a) * dpr;
    c.setTransform(cs, sn, -sn, cs, x * dpr, y * dpr);
  };

  const draw = (now: number) => {
    const t = now / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // At full gain the whole figure headbangs.
    const shake = gain > 0.95 && !reduced ? Math.sin(t * 17) * 2.5 : 0;
    ctx.globalAlpha = REST;
    ctx.drawImage(base, shake * dpr, 0);
    ctx.globalAlpha = 1;
    // Cut the resting copy of every awake symbol out of the base in one fill, then draw it moving on top.
    const holes = new Path2D();
    for (let i = 0; i < xs.length; i++) {
      if (energy[i] < AWAKE) continue;
      const h = size[i] * 0.7;
      holes.rect((xs[i] + shake - h) * dpr, (ys[i] - h) * dpr, h * 2 * dpr, h * 2 * dpr);
    }
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fill(holes);
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < xs.length; i++) {
      const e = energy[i];
      if (e < AWAKE) continue;
      const s = size[i] * (1 + e * (0.8 + gain * 1.2));
      const set = e > 0.75 ? signal : e > 0.25 ? sky : paper;
      put(ctx, spin[i] + Math.sin(t * 22 + i) * e * (0.3 + gain * 0.7), xs[i] + shake, ys[i] - e * 7);
      ctx.globalAlpha = Math.min(1, alpha[i] + e);
      ctx.drawImage(set[kind[i]], -s / 2, -s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  };

  const loop = (now: number) => {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const decay = Math.exp(-dt * (2.6 - gain * 1.4));
    let sum = 0;
    if (now - lastStrum > 3000) {
      lastStrum = now;
      strum = 0;
    }
    if (strum >= 0) {
      const band = strum * H;
      for (let i = 0; i < xs.length; i++) {
        const d = Math.abs(ys[i] - band);
        if (d < 18) energy[i] = Math.max(energy[i], (1 - d / 18) * 0.22 * (0.4 + volume));
      }
      strum += dt * 1.4;
      if (strum > 1) strum = -1;
    }
    for (let i = 0; i < energy.length; i++) {
      energy[i] = energy[i] < 0.01 ? 0 : energy[i] * decay;
      sum += energy[i];
    }
    level += (Math.min(1, (sum / Math.max(1, xs.length)) * 9 * (0.3 + volume)) - level) * Math.min(dt * 12, 1);
    listener(level);
    draw(now);
    raf = requestAnimationFrame(loop);
  };

  const play = () => {
    if (running || reduced || !visible) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  };
  const pause = () => {
    running = false;
    cancelAnimationFrame(raf);
  };

  stage.addEventListener('pointermove', (e) => {
    if (reduced) return;
    const r = stage.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const speed = pointer.inside ? Math.hypot(x - pointer.x, y - pointer.y) : 0;
    pointer.x = x;
    pointer.y = y;
    pointer.inside = true;
    const R = 30 + gain * 48;
    const push = Math.min(1, 0.35 + speed / 30);
    for (let i = 0; i < xs.length; i++) {
      const d = Math.hypot(xs[i] - x, ys[i] - y);
      if (d < R) energy[i] = Math.max(energy[i], (1 - d / R) * push);
    }
  });
  stage.addEventListener('pointerleave', () => {
    pointer.inside = false;
  });

  new ResizeObserver(resize).observe(stage);
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    visible ? play() : pause();
  }).observe(stage);
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));

  return {
    setGain: (v) => (gain = v),
    setVolume: (v) => (volume = v),
    onLevel: (cb) => (listener = cb),
    strum: () => {
      lastStrum = performance.now();
      strum = 0;
    },
  };
}
