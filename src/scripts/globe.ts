// Dotted globe on Canvas 2D: spins by itself, can be dragged with inertia, and fires
// violet links from Palermo to cities around the world.

const PAPER = '240,239,234';
const VIOLET = '181,108,255';
const SIGNAL = '#f3e600';
const HOME: [number, number] = [38.12, 13.36];
const CITIES: [number, number][] = [
  [40.71, -74.0], [51.51, -0.13], [-31.95, 115.86], [25.2, 55.27], [35.68, 139.69], [-23.55, -46.63],
  [52.52, 13.4], [43.65, -79.38], [-33.87, 151.21], [1.35, 103.82], [34.05, -118.24], [-33.92, 18.42],
  [47.37, 8.54], [40.42, -3.7], [19.43, -99.13], [59.33, 18.07],
];
const BUCKETS = 6;

type Vec = [number, number, number];

const toVec = (lat: number, lon: number): Vec => {
  const p = (lat * Math.PI) / 180;
  const l = (lon * Math.PI) / 180;
  return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)];
};

// Great-circle interpolation, lifted off the surface in the middle so links read as arcs.
const slerp = (a: Vec, b: Vec, t: number): Vec => {
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const w = Math.acos(dot);
  const s = Math.sin(w) || 1;
  const ka = Math.sin((1 - t) * w) / s;
  const kb = Math.sin(t * w) / s;
  const lift = 1 + Math.sin(Math.PI * t) * w * 0.12;
  return [(a[0] * ka + b[0] * kb) * lift, (a[1] * ka + b[1] * kb) * lift, (a[2] * ka + b[2] * kb) * lift];
};

interface Link {
  to: Vec;
  born: number;
}

export function mountGlobe(stage: HTMLElement, canvas: HTMLCanvasElement, dots: number[]) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctx = canvas.getContext('2d')!;
  const points: Vec[] = [];
  for (let i = 0; i < dots.length; i += 2) points.push(toVec(dots[i] / 10, dots[i + 1] / 10));
  const home = toVec(...HOME);
  const fills = Array.from({ length: BUCKETS }, (_, k) => `rgba(${PAPER},${(0.18 + (0.82 * k) / (BUCKETS - 1)).toFixed(3)})`);

  let size = 0;
  let yaw = (-HOME[1] * Math.PI) / 180;
  let pitch = 0.42;
  let vYaw = 0;
  let drag: { x: number; y: number; t: number } | null = null;
  const links: Link[] = [];
  let lastLink = 0;
  let running = false;
  let visible = false;
  let raf = 0;
  let last = performance.now();

  const project = ([x, y, z]: Vec): Vec => {
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const x1 = x * cy + z * sy;
    const z1 = -x * sy + z * cy;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const r = size * 0.46;
    return [size / 2 + x1 * r, size / 2 - (y * cp - z1 * sp) * r, y * sp + z1 * cp];
  };

  const resize = () => {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    size = r.width;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(performance.now());
  };

  const draw = (now: number) => {
    ctx.clearRect(0, 0, size, size);
    const r = size * 0.46;

    ctx.strokeStyle = `rgba(${PAPER},0.22)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    ctx.stroke();

    const dot = Math.max(1.1, size / 190);
    const paths = Array.from({ length: BUCKETS }, () => new Path2D());
    const back = new Path2D();
    for (const p of points) {
      const [x, y, z] = project(p);
      if (z < 0) {
        back.rect(x - 0.5, y - 0.5, 1, 1);
        continue;
      }
      const k = Math.min(BUCKETS - 1, Math.floor(z * BUCKETS));
      paths[k].rect(x - dot / 2, y - dot / 2, dot, dot);
    }
    ctx.fillStyle = `rgba(${PAPER},0.07)`;
    ctx.fill(back);
    paths.forEach((p, k) => {
      ctx.fillStyle = fills[k];
      ctx.fill(p);
    });

    for (const l of links) {
      const age = (now - l.born) / 1000;
      const head = Math.min(1, age / 1.1);
      const tail = Math.max(0, (age - 0.7) / 1.1);
      ctx.strokeStyle = `rgba(${VIOLET},0.9)`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      let pen = false;
      for (let s = 0; s <= 40; s++) {
        const t = tail + ((head - tail) * s) / 40;
        const [x, y, z] = project(slerp(home, l.to, t));
        if (z < 0) {
          pen = false;
          continue;
        }
        pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        pen = true;
      }
      ctx.stroke();
      if (head >= 1 && tail < 1) {
        const [x, y, z] = project(l.to);
        if (z > 0) {
          const ring = ((age - 1.1) / 0.8) * 10;
          ctx.strokeStyle = `rgba(${VIOLET},${Math.max(0, 1 - ring / 10).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(x, y, 2 + ring, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    const [hx, hy, hz] = project(home);
    if (hz > 0) {
      const ping = reduced ? 0 : ((now / 2400) % 1) * 14;
      ctx.strokeStyle = `rgba(${VIOLET},${(1 - ping / 14).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(hx, hy, 3 + ping, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = SIGNAL;
      ctx.fillRect(hx - 2.5, hy - 2.5, 5, 5);
    }
  };

  const loop = (now: number) => {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!drag) {
      vYaw += (0.16 - vYaw) * Math.min(dt * 0.8, 1);
      yaw += vYaw * dt;
      pitch += (0.42 - pitch) * Math.min(dt * 1.5, 1);
    }
    if (now - lastLink > 1500) {
      links.push({ to: toVec(...CITIES[(Math.random() * CITIES.length) | 0]), born: now });
      lastLink = now;
    }
    while (links.length && now - links[0].born > 2200) links.shift();
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

  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, t: performance.now() };
    vYaw = 0;
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const now = performance.now();
    const r = size * 0.46;
    const dYaw = (e.clientX - drag.x) / r;
    yaw += dYaw;
    pitch = Math.max(-1.1, Math.min(1.1, pitch + (e.clientY - drag.y) / r));
    vYaw = dYaw / Math.max((now - drag.t) / 1000, 0.008);
    drag = { x: e.clientX, y: e.clientY, t: now };
    if (reduced) draw(now);
  });
  const release = () => {
    drag = null;
    vYaw = Math.max(-6, Math.min(6, vYaw));
    stage.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  new ResizeObserver(resize).observe(stage);
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    visible ? play() : pause();
  }).observe(stage);
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));
}
