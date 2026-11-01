// Canvas 2D portrait printed with code: brightness comes from a coarse intensity grid,
// the characters from a running snippet. The cursor sets off a blue rain of glyphs.
// Only cells whose glyph or colour changed are redrawn.

export interface FieldData {
  w: number;
  h: number;
  rows: string[];
}

const CODE =
  "const paride = { role: 'software architect', active: 'worldwide', stack: ['TypeScript', 'Python', 'PHP', 'React', 'Node', 'SQL', 'Shopify', 'n8n', 'LangChain'], builds: ['erp', 'crm', 'sites', 'shops', 'apps', 'agents', 'integrations', 'mods'], offline: ['surf', 'guitar', 'vocals', 'luthiery'] }; export async function build(idea) { const plan = await analyse(idea); for (const step of plan) await ship(step); return support(plan); } ";
const NOISE = '01<>/\\{}[]#*+=;:_-$%&';
const PAPER = '240,239,234';
const SKY = '114,207,250';
const SIGNAL = '#76efe0';
const DROP_HEAD = '#e8f7ff';
const MAX_DROPS = 360;

const noise = () => NOISE[(Math.random() * NOISE.length) | 0];

export function mountGlyphPortrait(stage: HTMLElement, canvas: HTMLCanvasElement, data: FieldData) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctx = canvas.getContext('2d')!;
  const cols = data.w;
  const rows = data.h;
  const N = cols * rows;
  const level = new Uint8Array(N);
  const glyph: string[] = [];
  const settle = new Float32Array(N);
  const heat = new Float32Array(N);
  const rain = new Array<string>(N).fill('');
  const head = new Uint8Array(N);
  const drops: { x: number; y: number; speed: number }[] = [];
  const sparkle = new Float32Array(N);
  // What each cell shows now, as glyph + palette index, so unchanged cells are skipped cheaply.
  const drawnCh: string[] = new Array(N).fill('');
  const drawnColor = new Int16Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    level[i] = Number(data.rows[(i / cols) | 0][i % cols]);
    glyph[i] = CODE[i % CODE.length];
    settle[i] = (((i / cols) | 0) / rows) * 1400 + Math.random() * 420;
  }
  // Palette: 0 none, 1-10 tone by level, 11-20 rain by heat, then flicker, faint, caret, drop head.
  const palette = [
    '',
    ...Array.from({ length: 10 }, (_, l) => `rgba(${PAPER},${(0.16 + 0.84 * Math.pow(l / 9, 0.9)).toFixed(3)})`),
    ...Array.from({ length: 10 }, (_, k) => `rgba(${SKY},${(0.4 + 0.6 * (k / 9)).toFixed(3)})`),
    `rgba(${PAPER},0.32)`,
    // The rest of the page of code stays barely lit, so the figure reads as brightness, not as a cut-out.
    `rgba(${PAPER},0.06)`,
    SIGNAL,
    DROP_HEAD,
  ];
  const TONE = 1;
  const HOT = 11;
  const FLICKER = 21;
  const FAINT = 22;
  const CARET = 23;
  const HEAD = 24;

  let cw = 0;
  let chh = 0;
  let start = -1;
  let caret = -1;
  let running = false;
  let visible = false;
  let raf = 0;
  let last = performance.now();

  const resize = () => {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cw = r.width / cols;
    chh = r.height / rows;
    ctx.font = `${chh.toFixed(2)}px "DM Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawnColor.fill(-1);
    paint(performance.now());
  };

  const cell = (i: number, ch: string, color: number) => {
    if (drawnCh[i] === ch && drawnColor[i] === color) return;
    drawnCh[i] = ch;
    drawnColor[i] = color;
    const x = (i % cols) * cw;
    const y = ((i / cols) | 0) * chh;
    ctx.clearRect(x, y, cw, chh);
    if (ch === ' ' || !color) return;
    ctx.fillStyle = palette[color];
    if (ch === '█') ctx.fillRect(x, y + chh * 0.08, cw, chh * 0.84);
    else ctx.fillText(ch, x + cw / 2, y + chh / 2);
  };

  const paint = (now: number) => {
    const t = reduced ? Infinity : start < 0 ? -Infinity : now - start;
    for (let i = 0; i < N; i++) {
      const l = level[i];
      if (i === caret) {
        cell(i, (now / 530) % 2 < 1 ? '█' : ' ', CARET);
        continue;
      }
      if (t < settle[i] - 260) cell(i, ' ', 0);
      else if (t < settle[i]) cell(i, l ? noise() : ' ', FLICKER);
      else if (head[i]) cell(i, rain[i], HEAD);
      else if (heat[i] > 0.08) cell(i, rain[i], HOT + Math.min(9, Math.round(heat[i] * 9)));
      else if (l && sparkle[i] > now) cell(i, noise(), TONE + 9);
      else cell(i, glyph[i], l ? TONE + l : FAINT);
    }
  };

  const loop = (now: number) => {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const decay = Math.pow(0.94, dt * 60);
    for (let i = 0; i < N; i++) {
      head[i] = 0;
      if (heat[i] > 0) {
        heat[i] = heat[i] < 0.02 ? 0 : heat[i] * decay;
        if (Math.random() < 0.08) rain[i] = noise();
      }
    }
    for (let k = drops.length - 1; k >= 0; k--) {
      const d = drops[k];
      const from = Math.max(0, Math.floor(d.y));
      d.y += d.speed * dt;
      const to = Math.min(rows - 1, Math.floor(d.y));
      for (let y = from; y <= to; y++) {
        const i = y * cols + d.x;
        if (heat[i] < 0.08) rain[i] = noise();
        heat[i] = 1;
      }
      if (d.y >= rows) drops.splice(k, 1);
      else head[to * cols + d.x] = 1;
    }
    for (let k = 0; k < 6; k++) {
      const i = (Math.random() * N) | 0;
      if (level[i] > 2) sparkle[i] = now + 110;
    }
    paint(now);
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
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const cx = Math.floor(px / cw);
    const cy = Math.floor(py / chh);
    caret = cy * cols + cx;
    for (let k = 0; k < 5 && drops.length < MAX_DROPS; k++) {
      const x = cx + Math.round((Math.random() - 0.5) * cols * 0.12);
      if (x >= 0 && x < cols) drops.push({ x, y: cy - Math.random() * 6, speed: rows * (0.35 + Math.random() * 0.35) });
    }
    const R = 30;
    const rx = Math.ceil(R / cw);
    const ry = Math.ceil(R / chh);
    for (let y = Math.max(0, cy - ry); y <= Math.min(rows - 1, cy + ry); y++) {
      for (let x = Math.max(0, cx - rx); x <= Math.min(cols - 1, cx + rx); x++) {
        const d = Math.hypot((x - cx) * cw, (y - cy) * chh);
        if (d < R) {
          const i = y * cols + x;
          if (heat[i] < 0.08) rain[i] = noise();
          heat[i] = Math.max(heat[i], 1 - d / R);
        }
      }
    }
  });
  stage.addEventListener('pointerleave', () => {
    caret = -1;
  });

  new ResizeObserver(resize).observe(stage);
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && start < 0) start = performance.now();
    visible ? play() : pause();
  }).observe(stage);
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));

  document.fonts.load('12px "DM Mono"').then(resize);
}
