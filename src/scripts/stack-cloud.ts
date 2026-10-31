// The tools behind the console, scattered on a sphere around the terminal. Hidden until the
// `stack` command bursts it open; afterwards it spins on its own and can be dragged.

const PAPER = '240,239,234';
const VIOLET = '#b56cff';
const SIGNAL = '#f3e600';

export function mountStackCloud(host: HTMLElement, canvas: HTMLCanvasElement, names: string[]) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctx = canvas.getContext('2d')!;
  // Fibonacci sphere: even spacing without clumps at the poles.
  const points = names.map((name, i) => {
    const y = 1 - (2 * (i + 0.5)) / names.length;
    const r = Math.sqrt(1 - y * y);
    const a = i * Math.PI * (3 - Math.sqrt(5));
    return { name, x: Math.cos(a) * r, y, z: Math.sin(a) * r };
  });

  let W = 0;
  let H = 0;
  let yaw = 0;
  let pitch = -0.25;
  let vYaw = 0.25;
  let open = 0;
  let born = -1;
  let flare = { index: -1, until: 0 };
  let drag: { x: number; y: number; t: number } | null = null;
  let running = false;
  let visible = false;
  let raf = 0;
  let last = performance.now();

  const resize = () => {
    const r = host.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (born >= 0) draw(performance.now());
  };

  const draw = (now: number) => {
    ctx.clearRect(0, 0, W, H);
    const rx = Math.min(W * 0.47, 660) * open;
    const ry = Math.min(H * 0.44, 380) * open;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const projected = points.map((p, i) => {
      const x1 = p.x * cy + p.z * sy;
      const z1 = -p.x * sy + p.z * cy;
      const y1 = p.y * cp - z1 * sp;
      const z2 = p.y * sp + z1 * cp;
      return { i, name: p.name, x: W / 2 + x1 * rx, y: H / 2 + y1 * ry, z: z2 };
    });
    projected.sort((a, b) => a.z - b.z);
    for (const p of projected) {
      const depth = (p.z + 1) / 2;
      ctx.font = `${Math.round(12 + depth * 12)}px "Share Tech Mono", monospace`;
      if (p.i === flare.index && now < flare.until) {
        ctx.fillStyle = VIOLET;
      } else if (depth > 0.86) {
        ctx.fillStyle = SIGNAL;
      } else {
        ctx.fillStyle = `rgba(${PAPER},${(0.12 + depth * 0.7).toFixed(3)})`;
      }
      ctx.fillText(p.name, p.x, p.y);
    }
  };

  const loop = (now: number) => {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const age = (now - born) / 1000;
    open = 1 - Math.pow(1 - Math.min(1, age / 1.1), 3);
    if (!drag) {
      vYaw += (0.25 - vYaw) * Math.min(dt * 0.8, 1);
      yaw += vYaw * dt;
    }
    if (now > flare.until + 400) flare = { index: (Math.random() * points.length) | 0, until: now + 900 };
    draw(now);
    raf = requestAnimationFrame(loop);
  };

  const play = () => {
    if (running || born < 0 || !visible || reduced) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  };
  const pause = () => {
    running = false;
    cancelAnimationFrame(raf);
  };

  host.addEventListener('pointerdown', (e) => {
    if (born < 0 || (e.target as Element).closest('.term, .chips, h2')) return;
    host.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  host.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const now = performance.now();
    const d = (e.clientX - drag.x) / 300;
    yaw += d;
    pitch = Math.max(-1, Math.min(1, pitch + (e.clientY - drag.y) / 300));
    vYaw = d / Math.max((now - drag.t) / 1000, 0.008);
    drag = { x: e.clientX, y: e.clientY, t: now };
    if (reduced) draw(now);
  });
  const release = () => {
    drag = null;
    vYaw = Math.max(-5, Math.min(5, vYaw));
  };
  host.addEventListener('pointerup', release);
  host.addEventListener('pointercancel', release);

  new ResizeObserver(resize).observe(host);
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    visible ? play() : pause();
  }).observe(host);
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));

  return {
    burst() {
      born = performance.now();
      if (reduced) {
        open = 1;
        draw(born);
        return;
      }
      play();
    },
  };
}
