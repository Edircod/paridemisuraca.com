// Hand-written WebGL2 renderer for contour-line layers (portraits and seabed).
// Everything is GL_LINES: cheap on any GPU, so the budget goes to motion, not geometry.

export interface ContourData {
  w: number;
  h: number;
  q: number;
  levels: number[];
  lines: number[][];
  outline: number[][];
}

interface LayerOptions {
  slot?: HTMLElement;
  seabed?: boolean;
  relief?: number;
  colorLow: string;
  colorHigh: string;
  colorOutline?: string;
  colorWave?: string;
  alpha?: number;
}

interface Layer {
  vao: WebGLVertexArrayObject;
  count: number;
  opts: Required<Omit<LayerOptions, 'slot'>> & { slot?: HTMLElement };
  rect: [number, number, number, number];
  hover: number;
}

const VERT = `#version 300 es
in vec2 aPos;
in float aLevel;
in float aAlong;
in float aDelay;
in float aKind;
uniform vec4 uRect;
uniform vec2 uView;
uniform float uTime;
uniform vec2 uPointer;
uniform float uHover;
uniform vec3 uPings[4];
uniform float uRelief;
uniform float uSeabed;
uniform float uMotion;
out float vLevel;
out float vAlong;
out float vDelay;
out float vWave;
out float vKind;
out float vFade;
out float vNear;
out float vHover;
void main() {
  vec2 center = uRect.xy + uRect.zw * 0.5;
  vec2 local = (aPos - 0.5) * uRect.zw;
  vec2 world = center + local;
  // Hover only nudges the lines: a soft lens around the cursor plus a faint shiver.
  float d = distance(world, uPointer);
  float near = exp(-d * d / (2.0 * 70.0 * 70.0)) * uHover;
  vec2 away = d > 0.001 ? (world - uPointer) / d : vec2(0.0);
  local += away * near * 12.0;
  local += uHover * uMotion * 1.6 * vec2(sin(world.y * 0.045 + uTime * 3.1), cos(world.x * 0.04 + uTime * 2.7));
  world = center + local;
  float z = aLevel * uRelief;
  z += uMotion * 5.0 * sin(world.x * 0.011 + world.y * 0.017 - uTime * 1.1);
  float wave = 0.0;
  for (int i = 0; i < 4; i++) {
    if (uPings[i].z < 0.0) continue;
    float age = uTime - uPings[i].z;
    float dd = distance(world, uPings[i].xy) - age * 540.0;
    wave += exp(-dd * dd / (2.0 * 34.0 * 34.0)) * exp(-age * 0.85);
  }
  z += wave * 36.0;
  vec3 p = vec3(local, uSeabed > 0.5 ? 0.0 : z);
  vec2 screen = center + p.xy * (1400.0 / (1400.0 - p.z));
  if (uSeabed > 0.5) screen.y -= wave * 9.0;
  gl_Position = vec4(screen.x / uView.x * 2.0 - 1.0, 1.0 - screen.y / uView.y * 2.0, 0.0, 1.0);
  vLevel = aLevel;
  vAlong = aAlong;
  vDelay = aDelay;
  vWave = wave;
  vKind = aKind;
  vNear = near;
  vHover = uHover;
  // Portraits dissolve towards their lower edge, as if surfacing from the deep.
  vFade = uSeabed > 0.5 ? 1.0 : smoothstep(1.0, 0.74, aPos.y);
}`;

const FRAG = `#version 300 es
precision mediump float;
in float vLevel;
in float vAlong;
in float vDelay;
in float vWave;
in float vKind;
in float vFade;
in float vNear;
in float vHover;
uniform float uReveal;
uniform vec3 uColLow;
uniform vec3 uColHigh;
uniform vec3 uColOutline;
uniform vec3 uColWave;
uniform float uAlpha;
out vec4 outColor;
void main() {
  if (vAlong > clamp((uReveal - vDelay) / 0.5, 0.0, 1.0)) discard;
  float w = clamp(vWave, 0.0, 1.0);
  vec3 c = vKind > 0.5 ? uColOutline : mix(uColLow, uColHigh, vLevel);
  vec3 hot = vKind > 0.5 ? mix(uColWave, vec3(1.0), 0.35) : mix(uColWave * 0.45, mix(uColWave, vec3(1.0), 0.2), vLevel);
  c = mix(c, hot, vHover);
  c = mix(c, uColWave, w * 0.9);
  float a = uAlpha * (vKind > 0.5 ? 0.95 : 0.62 + 0.38 * vLevel);
  a = max(max(a, w * 0.95), vNear * 0.9) * vFade;
  outColor = vec4(c * a, a);
}`;

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

// Deterministic per-line jitter so the reveal looks hand-drawn but is stable between loads.
const hash = (i: number) => {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

export class ContourField {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private layers: Layer[] = [];
  private view = { w: 0, h: 0, dpr: 1 };
  private pointer = { x: -9999, y: -9999, inside: false };
  private pings = new Float32Array(12).fill(-1);
  private pingIndex = 0;
  private start = performance.now();
  private reveal = 0;
  private revealFrom = 0;
  private revealDuration = 2600;
  private running = false;
  private visible = false;
  private raf = 0;
  private last = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
    private reducedMotion: boolean,
  ) {
    this.gl = gl;
    this.prog = this.program();
    for (const name of ['uRect', 'uView', 'uTime', 'uPointer', 'uHover', 'uPings', 'uRelief', 'uSeabed', 'uMotion', 'uReveal', 'uColLow', 'uColHigh', 'uColOutline', 'uColWave', 'uAlpha']) {
      this.u[name] = gl.getUniformLocation(this.prog, name);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (reducedMotion) this.reveal = 99;

    new ResizeObserver(() => this.resize()).observe(canvas);
    new IntersectionObserver(([e]) => {
      this.visible = e.isIntersecting;
      this.visible ? this.play() : this.pause();
    }).observe(canvas);
    document.addEventListener('visibilitychange', () => (document.hidden ? this.pause() : this.visible && this.play()));
  }

  static create(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true, alpha: true });
    if (!gl) return null;
    return new ContourField(canvas, gl, matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  addLayer(data: ContourData, opts: LayerOptions) {
    const gl = this.gl;
    const scale = data.q / Math.max(data.w, data.h);
    const sx = 1 / (scale * data.w);
    const sy = 1 / (scale * data.h);
    const verts: number[] = [];
    const push = (flat: number[], level: number, kind: number, delay: number) => {
      const pts: [number, number][] = [];
      for (let i = 0; i < flat.length; i += 2) pts.push([flat[i] * sx, flat[i + 1] * sy]);
      let total = 0;
      const acc = [0];
      for (let i = 1; i < pts.length; i++) {
        total += Math.hypot((pts[i][0] - pts[i - 1][0]) * data.w, (pts[i][1] - pts[i - 1][1]) * data.h);
        acc.push(total);
      }
      for (let i = 1; i < pts.length; i++) {
        for (const j of [i - 1, i]) {
          const d = opts.seabed ? pts[j][0] * 0.45 + delay : delay;
          verts.push(pts[j][0], pts[j][1], level, total ? acc[j] / total : 0, d, kind);
        }
      }
    };
    const n = data.levels.length;
    data.lines.forEach((ln, i) => {
      const level = (ln[0] + 1) / n;
      push(ln.slice(1), level, 0, opts.seabed ? 0 : 0.12 + level * 0.55 + hash(i) * 0.1);
    });
    data.outline.forEach((ln) => push(ln, 1, 1, 0));

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    const stride = 6 * 4;
    const attrs: [string, number, number][] = [['aPos', 2, 0], ['aLevel', 1, 2], ['aAlong', 1, 3], ['aDelay', 1, 4], ['aKind', 1, 5]];
    for (const [name, size, offset] of attrs) {
      const loc = gl.getAttribLocation(this.prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
    }
    gl.bindVertexArray(null);

    this.layers.push({
      vao,
      count: verts.length / 6,
      opts: {
        seabed: false,
        relief: 0,
        colorOutline: opts.colorHigh,
        colorWave: opts.colorHigh,
        alpha: 1,
        ...opts,
      },
      rect: [0, 0, 0, 0],
      hover: 0,
    });
    this.measure();
    this.revealFrom = performance.now();
    this.frame(performance.now());
  }

  setPointer(clientX: number, clientY: number, inside: boolean) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer = { x: clientX - r.left, y: clientY - r.top, inside };
    if (this.reducedMotion) return;
    this.play();
  }

  ping(clientX: number, clientY: number) {
    if (this.reducedMotion) return;
    const r = this.canvas.getBoundingClientRect();
    const i = this.pingIndex++ % 4;
    this.pings.set([clientX - r.left, clientY - r.top, this.time()], i * 3);
    this.play();
  }

  private time() {
    return (performance.now() - this.start) / 1000;
  }

  private play() {
    if (this.running || !this.visible || this.reducedMotion) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  private pause() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private loop(t: number) {
    if (!this.running) return;
    this.frame(t);
    this.raf = requestAnimationFrame((tt) => this.loop(tt));
  }

  private measure() {
    const c = this.canvas.getBoundingClientRect();
    for (const l of this.layers) {
      if (!l.opts.slot) {
        l.rect = [0, 0, c.width, c.height];
        continue;
      }
      const s = l.opts.slot.getBoundingClientRect();
      l.rect = [s.left - c.left, s.top - c.top, s.width, s.height];
    }
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.view = { w: r.width, h: r.height, dpr };
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.measure();
    this.frame(performance.now());
  }

  private frame(now: number) {
    const gl = this.gl;
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    const time = this.time();

    if (!this.reducedMotion) {
      const p = Math.min((now - this.revealFrom) / this.revealDuration, 1);
      this.reveal = (1 - Math.pow(1 - p, 3)) * 1.3;
    }

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniform2f(this.u.uView, this.view.w, this.view.h);
    gl.uniform1f(this.u.uTime, time);
    gl.uniform2f(this.u.uPointer, this.pointer.x, this.pointer.y);
    gl.uniform3fv(this.u.uPings, this.pings);
    gl.uniform1f(this.u.uMotion, this.reducedMotion ? 0 : 1);
    gl.uniform1f(this.u.uReveal, this.reveal);

    for (const l of this.layers) {
      const [x, y, w, h] = l.rect;
      if (!this.reducedMotion && !l.opts.seabed) {
        const { x: px, y: py, inside } = this.pointer;
        const over = inside && px > x && px < x + w && py > y && py < y + h ? 1 : 0;
        l.hover += (over - l.hover) * Math.min(dt * 7, 1);
      }
      gl.uniform4f(this.u.uRect, x, y, w, h);
      gl.uniform1f(this.u.uRelief, l.opts.relief);
      gl.uniform1f(this.u.uHover, l.hover);
      gl.uniform1f(this.u.uSeabed, l.opts.seabed ? 1 : 0);
      gl.uniform3fv(this.u.uColLow, hex(l.opts.colorLow));
      gl.uniform3fv(this.u.uColHigh, hex(l.opts.colorHigh));
      gl.uniform3fv(this.u.uColOutline, hex(l.opts.colorOutline));
      gl.uniform3fv(this.u.uColWave, hex(l.opts.colorWave));
      gl.uniform1f(this.u.uAlpha, l.opts.alpha);
      gl.bindVertexArray(l.vao);
      gl.drawArrays(gl.LINES, 0, l.count);
    }
    gl.bindVertexArray(null);
  }

  private program() {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile failed');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'program link failed');
    return p;
  }
}
