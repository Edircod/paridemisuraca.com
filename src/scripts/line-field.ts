// Sea silhouette: horizontal swell lines whose brightness comes from an intensity grid.
// The lines are resolved per pixel in a WebGL2 fragment shader, so their density costs nothing;
// foam lives in a coarse CPU grid uploaded as a texture, spray is drawn on a 2D canvas on top.
// The cursor breaks the wave: lines curl, foam builds up on them and spray flies off.
// The same lines can re-form into the wave of the surf game (see surf-game.ts), then fill in into a
// shaded scene; the game drives it through the Sea interface returned here.
import type { FieldData } from './glyph-portrait';

const MAX_SPRAY = 900;
// Pointer travel (px) that counts as one broken wave.
const CRASH_DISTANCE = 1400;
// Line pitch and foam cell size, in CSS px.
const PITCH = 3.6;
const FINE = 2.2;
const FOAM_CELL = 6;

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uView;
uniform float uDpr;
uniform float uTime;
uniform float uCount;
uniform vec2 uPointer;
uniform float uEnergy;
uniform sampler2D uVal;
uniform sampler2D uFoam;
uniform float uTint;
uniform float uMorph;
uniform vec2 uOrigin;
uniform vec4 uWave;
uniform float uScroll;
uniform float uBreak;
uniform float uZoom;
out vec4 outColor;

const vec3 PAPER = vec3(0.941, 0.937, 0.918);
const vec3 FOAM = vec3(0.93, 0.96, 0.97);

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// Sine-free hash for the scene's noise, so it stays random far along the scrolled coordinates.
float hash2(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  return 0.5 * noise(p) + 0.3 * noise(p * 2.03 + 3.1) + 0.2 * noise(p * 4.07 + 7.7);
}

// Brightness to sea colour: deep blue, teal, turquoise lit through the water, white foam.
vec3 sea(float t) {
  vec3 deep = vec3(0.03, 0.12, 0.25);
  vec3 teal = vec3(0.04, 0.42, 0.55);
  vec3 lit = vec3(0.32, 0.84, 0.82);
  vec3 foam = vec3(0.93, 0.98, 0.98);
  return t < 0.35 ? mix(deep, teal, t / 0.35) : t < 0.72 ? mix(teal, lit, (t - 0.35) / 0.37) : mix(lit, foam, clamp((t - 0.72) / 0.28, 0.0, 1.0));
}

// The crest of the game's wave: a rounded peak, easing down into a long shoulder on the right and,
// until the wave starts to break, a shorter one on the left. Once it breaks, the wave left of the curl
// stays as tall as the peak: from there on it is the lip and the whitewater.
float crest(float x) {
  float d = (x - uWave.z) / uView.x;
  float h = 0.92 * exp(-d * d / (d > 0.0 ? 0.9 : 0.5)) + 0.08 * exp(-d * d / 0.01);
  if (d < 0.0) h = mix(1.0, h, 1.0 - smoothstep(0.0, 0.5, uBreak));
  return uWave.y - (uWave.y - uWave.x) * (0.28 + 0.72 * h);
}

// The game's wave seen from the beach at sunset, with the sun low behind it. uWave holds the crest y,
// the trough y, the x of the curl and how far the thrown lip reaches once the wave has broken. uBreak
// takes it from an unbroken swell to a full tube with the whitewater rolling on behind it; uZoom
// brings the water towards the screen while you paddle in, the sky staying put. Right of the curl the
// open face, backlit and glowing through the top; in front flat water; behind the sky, the open sea
// and a headland. fine adds the noise detail, skipped while the lines are still re-forming.
vec3 scene(vec2 p, bool fine) {
  float k = max(0.62, uView.y / 700.0);
  float horizon = uView.y * 0.4;
  vec2 q = vec2(uView.x * 0.5, horizon) + (p - vec2(uView.x * 0.5, horizon)) / uZoom;
  float x = q.x;
  float y = q.y;
  float curl = uWave.z;
  float trough = uWave.y;
  vec2 sun = vec2(uView.x * 0.8, horizon - 26.0 * k);
  float sunward = exp(-abs(x - sun.x) / (220.0 * k));
  float lip = crest(x);
  float along = (x + uScroll) / k;
  // The wave breaks from the peak: a small curl at the top at first, then the lip throws further and
  // further out and lower down the face until the tube is as tall as the wave. The whitewater spreads
  // left from where the lip lands and tumbles down the face.
  float formed = smoothstep(0.0, 0.7, uBreak);
  float reach = max(uWave.w * formed, 1.0);
  float fall = (trough - lip) * formed;
  float spread = uView.x * 1.5 * smoothstep(0.15, 1.0, uBreak) + 70.0 * k * smoothstep(0.0, 0.15, uBreak);
  float s = uBreak > 0.02 ? (curl - x) / reach : -1.0;
  float behind = (curl - reach - x) / k;
  // Its leading edge is ragged, not a straight cut.
  float rag = fine ? (fbm(vec2(y / k * 0.025, uTime * 0.4)) - 0.5) * 90.0 : 0.0;
  float broken = s > 0.0 ? 1.0 - smoothstep(spread / k - 60.0, spread / k, behind + rag) : 0.0;
  // The top of the water in this column: the crest, or the lower whitewater, lower the further it
  // rolls on, with billows on top.
  float top = lip;
  if (s > 1.0 && broken > 0.0) {
    float soupTop = lip + (trough - lip) * (0.12 * min(1.0, behind / 40.0) + 0.36 * (1.0 - exp(-behind / 260.0)));
    if (fine) soupTop -= abs(fbm(vec2(x / k * 0.018 - uTime * 0.12, uTime * 0.35)) - 0.5) * 40.0 * k * min(1.0, behind / 40.0);
    top = mix(lip, soupTop, broken);
  }

  vec3 c;
  if (y < top) {
    if (p.y < horizon) {
      float h = clamp(p.y / horizon, 0.0, 1.0);
      c = mix(vec3(0.035, 0.045, 0.13), vec3(0.26, 0.14, 0.36), smoothstep(0.0, 0.7, h));
      c = mix(c, vec3(0.9, 0.48, 0.28), smoothstep(0.62, 1.0, h) * 0.85);
      if (fine) {
        float cloud = fbm(vec2(p.x / k * 0.004 + uTime * 0.004, p.y / k * 0.035));
        c = mix(c, mix(vec3(0.12, 0.07, 0.18), vec3(0.9, 0.46, 0.34), h * h), smoothstep(0.52, 0.78, cloud) * 0.5);
      }
      // A headland on the left, hazy against the sky.
      float land = horizon - (36.0 + 7.0 * (fine ? noise(vec2(p.x / k * 0.03, 0.5)) : 0.5)) * k * (1.0 - smoothstep(0.0, 0.34, p.x / uView.x));
      if (p.y > land) c = mix(vec3(0.08, 0.06, 0.14), c, 0.3);
      c = mix(c, vec3(1.0, 0.9, 0.72), smoothstep(15.0 * k, 12.5 * k, distance(p, sun)));
    } else {
      // Open sea out to the horizon, the sun's path glittering on it.
      c = mix(vec3(0.3, 0.17, 0.28), vec3(0.04, 0.09, 0.16), clamp((p.y - horizon) / (60.0 * k), 0.0, 1.0));
      float path = exp(-abs(p.x - sun.x) / (30.0 * k + (p.y - horizon) * 1.5));
      float glint = fine ? smoothstep(0.62, 0.8, noise(vec2(p.x / k * 0.3, p.y / k * 1.1 - uTime * 1.5))) : 0.3;
      c += vec3(1.0, 0.62, 0.32) * path * (0.18 + 0.75 * glint);
    }
    c += vec3(1.0, 0.55, 0.25) * exp(-distance(p, sun) / (90.0 * k)) * 0.45;
    // Spray blown back off the crest, mist hanging over the whitewater.
    float m = mix(exp(-(top - y) / (8.0 * k)) * (0.25 + 0.4 * exp(-abs(x - curl) / (300.0 * k))), exp(-(top - y) / (22.0 * k)) * 0.6, smoothstep(0.9, 1.3, s) * broken);
    if (fine) m *= 0.4 + 1.2 * noise(vec2(along * 0.06, y / k * 0.12 + uTime * 1.5));
    return mix(c, vec3(0.96, 0.86, 0.8), clamp(m, 0.0, 1.0));
  }

  if (y <= trough) {
    // The face: light through the thin water at the top, deep green-blue down into the trough, and
    // in its own shadow where it's steepest, close to the peak.
    float f = clamp((y - lip) / (trough - lip), 0.0, 1.0);
    float steep = exp(-abs(x - curl) / (260.0 * k));
    c = mix(vec3(0.24, 0.66, 0.56) + vec3(0.5, 0.28, 0.06) * sunward, vec3(0.035, 0.25, 0.3), smoothstep(0.0, 0.32, f));
    c = mix(c, vec3(0.01, 0.065, 0.09), smoothstep(0.28, 1.0, f));
    c *= 1.0 - 0.3 * steep * smoothstep(0.15, 0.7, f);
    // Round the curl the pitching lip hangs over the upper face and shades it.
    c *= 1.0 - 0.35 * formed * exp(-abs(x - curl) / (90.0 * k)) * smoothstep(0.02, 0.2, f) * (1.0 - smoothstep(0.3, 0.75, f));
    if (fine) {
      // Long bands of swell, and thin streaks of water drawn up the face as it moves past.
      float band = fbm(vec2(along * 0.005, f * 9.0 - uTime * 0.15));
      float streak = fbm(vec2(along * 0.03 + f * 4.0, f * 42.0 - uTime * 1.2));
      c *= 0.86 + 0.28 * band;
      c = mix(c, vec3(0.62, 0.8, 0.8), smoothstep(0.68, 0.8, streak) * 0.3 * (1.0 - f));
      // The dusk sky reflected on the upper face.
      c += vec3(0.3, 0.14, 0.2) * smoothstep(0.5, 0.0, f) * smoothstep(0.55, 0.75, noise(vec2(along * 0.01, f * 14.0))) * 0.25;
    } else {
      c *= 0.9 + 0.1 * sin(along * 0.045 + f * 13.0 - uTime * 2.0);
    }
    c = mix(c, FOAM, smoothstep(5.0 * k, 0.0, y - lip) * (0.4 + 0.45 * steep));
    c = mix(c, FOAM * 0.75, smoothstep(10.0 * k, 0.0, trough - y) * 0.3);
  } else {
    // Flat water in front: dark, catching the dusk, with streaks of lace left by the waves before.
    float d = clamp((y - trough) / (uView.y - trough), 0.0, 1.0);
    c = mix(vec3(0.012, 0.07, 0.095), vec3(0.02, 0.05, 0.085), d);
    if (fine) {
      float ripple = noise(vec2(along * 0.02, y / k * 0.4 - uTime * 0.4));
      c += vec3(0.35, 0.2, 0.22) * smoothstep(0.6, 0.9, ripple) * 0.2 * (1.0 - d);
      float lace = fbm(vec2(along * 0.01, y / k * 0.28));
      c = mix(c, vec3(0.6, 0.7, 0.74), smoothstep(0.62, 0.72, lace) * 0.35 * (1.0 - 0.7 * d));
    }
    c = mix(c, FOAM * 0.75, exp(-(y - trough) / (5.0 * k)) * 0.3);
    // The tube shades the water just in front of it.
    c *= 1.0 - 0.45 * formed * exp(-(y - trough) / (30.0 * k)) * smoothstep(0.0, 0.2, s) * (1.0 - smoothstep(0.9, 1.2, s));
  }

  if (s > 0.0 && s < 1.0 && y <= trough) {
    // The lip throws out over the face. Its leading edge arcs from the crest down to where it lands:
    // above it a translucent curtain of falling water, below it the tube, in shadow.
    float edge = lip + fall * (1.0 - sqrt(1.0 - s * s));
    // The lip only starts to throw at the curl: blend in from the open face.
    float shade = smoothstep(0.0, 0.2, s);
    if (y < edge - 2.0 * k) {
      // The curtain: thin at the top, where the low sun shines through it, thicker, darker and more
      // aerated as it falls, with streaks of water running down it; the thick lip along the crest
      // catches the light, and it whitens towards where it lands.
      float u = clamp((y - lip) / (edge - lip + 1.0), 0.0, 1.0);
      float streak = fine ? fbm(vec2(x / k * 0.12, y / k * 0.02 - uTime * 2.4)) : 0.5;
      vec3 curtain = mix(vec3(0.3, 0.76, 0.6) + vec3(0.55, 0.34, 0.08) * sunward, vec3(0.03, 0.2, 0.24), smoothstep(0.0, 0.85, u) * 0.85);
      curtain *= 0.7 + 0.6 * streak;
      curtain = mix(curtain, vec3(0.8, 0.95, 0.86), smoothstep(7.0 * k, 0.0, y - lip) * 0.45);
      curtain = mix(curtain, FOAM, smoothstep(0.6, 1.0, s) * 0.45 + smoothstep(0.7, 1.0, u) * 0.4 * streak);
      c = mix(c, curtain, shade);
    } else if (y < edge + 1.5 * k) {
      // The leading edge of the lip, frothing.
      c = mix(c, FOAM, shade);
    } else {
      // Inside the barrel: the back wall in the lip's shadow. Light only comes in through the mouth
      // by the curl, so it is darker the deeper in, darkest right under the lip; water streams up
      // the wall, and deep inside the foamball churns.
      float inside = clamp((y - edge) / (trough - edge + 1.0), 0.0, 1.0);
      float wall = fine ? fbm(vec2((x + uScroll * 0.2) / k * 0.025, y / k * 0.06 + uTime * 1.4)) : 0.5;
      // It starts out as the face itself at the mouth, so the shadow deepens into the tube with no seam.
      vec3 back = c * (0.18 + 0.82 * exp(-s * 2.6) * (0.65 + 0.5 * wall));
      back *= 0.4 + 0.6 * smoothstep(0.0, 26.0 * k, y - edge);
      float ball = fine ? fbm(vec2(x / k * 0.035 - uTime * 0.5, y / k * 0.035 - uTime * 0.9)) : 0.5;
      back = mix(back, vec3(0.6, 0.68, 0.72), smoothstep(0.62, 0.95, s) * smoothstep(0.4, 0.7, ball + inside * 0.35) * 0.85);
      // While the tube is still forming there is no hollow below where the lip lands.
      float open = 1.0 - smoothstep(lip + fall, lip + fall + 40.0 * k, y);
      c = mix(c, back, shade * mix(0.75, 1.0, inside) * open);
    }
  }

  if (s > 0.58) {
    // Whitewater: churning foam, lit warm along its top, grey-blue in its own shade lower down. In
    // front of the break it spreads over the flat water and thins out.
    float billow = fine ? fbm(vec2(x / k * 0.025 + uTime * 0.1, y / k * 0.03 - uTime * 0.6)) : 0.5;
    float bubbles = fine ? noise(vec2(x / k * 0.25, y / k * 0.25 - uTime * 3.0)) : 0.5;
    float depth = clamp((y - top) / (trough - top + 1.0), 0.0, 1.0);
    float light = clamp(0.62 + (billow - 0.5) * 1.1 + (bubbles - 0.5) * 0.18 - 0.4 * depth, 0.0, 1.0);
    vec3 soup = mix(vec3(0.3, 0.4, 0.5), FOAM, light);
    soup = mix(soup, vec3(1.0, 0.84, 0.7), exp(-(y - top) / (6.0 * k)) * 0.4);
    float front = trough + (16.0 + 16.0 * (fine ? noise(vec2(along * 0.03, uTime * 0.3)) : 0.5)) * k;
    // Where the lip lands the foam spreads first along the bottom, so its edge slants.
    float f = clamp((y - lip) / (trough - lip), 0.0, 1.0);
    float bottom = mix(lip + fall + (20.0 + (billow - 0.5) * 60.0) * k, front, smoothstep(0.05, 0.6, uBreak));
    // Billows break up its edge by some pixels too, or it looks cut while the lip is still short.
    c = mix(c, soup, smoothstep(0.78, 1.02, s + 0.2 * f + (billow - 0.5) * (0.25 + 60.0 * k / reach)) * broken * (1.0 - smoothstep(bottom - 8.0 * k, bottom, y)));
  }
  return c;
}

// Share of this pixel's height covered by a horizontal band centred on y.
float cover(float py, float y, float width) {
  float h = 0.5 / uDpr;
  return clamp(min(py + h, y + width * 0.5) - max(py - h, y - width * 0.5), 0.0, 1.0) * uDpr;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uView.y * uDpr - gl_FragCoord.y) / uDpr;
  float pitch = uView.y / uCount;
  // Once the lines have re-formed into the wave they fill in: every pixel shaded, the lines kept
  // only as scanlines.
  float fill = smoothstep(0.86, 1.0, uMorph);
  vec4 full = vec4(0.0);
  if (fill > 0.0) {
    // Foam left by spray and crashes breaks up into bubbles instead of a soft white blot.
    float fm = texture(uFoam, p / uView).r;
    vec3 sc = scene(p, true);
    if (fm > 0.01) {
      vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * p / max(0.62, uView.y / 700.0);
      sc = mix(sc, FOAM, fm * smoothstep(0.38, 0.62, fbm(q * 0.12 + vec2(0.0, uTime * 0.4))));
    }
    float jl = floor(p.y / pitch);
    float band = pitch * 0.72;
    float scan = min(1.0, cover(p.y, (jl - 0.5) * pitch, band) + cover(p.y, (jl + 0.5) * pitch, band) + cover(p.y, (jl + 1.5) * pitch, band));
    full = vec4(sc * mix(0.72, 1.0, scan), 1.0);
    if (fill >= 1.0) {
      outColor = full;
      return;
    }
  }
  // Packed tighter, lines also move and swell less, so the same few neighbours can reach a pixel.
  float d = pitch / 3.6;
  float thick = 0.55 + 0.45 * d;
  float b = p.x / uView.x;
  float j0 = floor(p.y / pitch - 0.5);
  float line = 0.0;
  vec3 col = PAPER;
  float white = 0.0;
  // A line can drift about 7px down and 12px up (times d), so a few neighbours can reach this pixel.
  for (int k = -2; k <= 4; k++) {
    float j = j0 + float(k);
    if (j < 0.0 || j >= uCount) continue;
    float v = (j + 0.5) / uCount;
    float y0 = v * uView.y;
    float val = texture(uVal, vec2(b, v)).r;
    float f = texture(uFoam, vec2(b, v)).r;
    // While the game charges up, the portrait takes on the colours of the sea.
    vec3 c = mix(PAPER, sea(0.08 + val * 0.9), uTint);
    float scatter = 0.0;
    if (uMorph > 0.0) {
      // Lines switch from the portrait to the wave in a front that spreads from where the cursor was,
      // flaring and jumping as it passes.
      float at = clamp(distance(vec2(p.x, y0), uOrigin) / length(uView) * 1.3, 0.0, 1.0) * 0.8 + hash(vec2(floor(p.x / 5.0), j)) * 0.2;
      float front = uMorph < 1.0 ? max(0.0, 1.0 - abs(uMorph * 1.3 - at - 0.06) / 0.07) : 0.0;
      float m = clamp((uMorph * 1.3 - at) / 0.12, 0.0, 1.0);
      vec3 w = scene(vec2(p.x, y0), false);
      float wb = clamp(dot(w, vec3(0.3, 0.55, 0.15)) * 1.6 + 0.06, 0.0, 1.0);
      val = mix(val, wb, m) + front * 0.6;
      c = mix(mix(c, w, m), vec3(1.0), front);
      scatter = front * (hash(vec2(floor(p.x / 3.0), j + 7.0)) - 0.5) * 8.0;
    }
    float swell = 1.3 * sin(b * 8.5 + v * 15.0 - uTime * 1.3) + 0.7 * sin(b * 21.0 - v * 7.0 + uTime * 0.8);
    float wake = 0.0;
    if (uEnergy > 0.01) {
      float dist = distance(vec2(p.x, y0), uPointer);
      wake = exp(-dist * dist / (2.0 * 90.0 * 90.0)) * uEnergy * sin(dist * 0.085 - uTime * 7.5);
    }
    float bright = min(1.0, val + f + abs(wake) * 0.9);
    // Foam lifts the line into a curl and roughens it.
    float rough = f > 0.05 ? (hash(vec2(floor(p.x / 4.0), j + floor(uTime * 30.0))) - 0.5) * f * 1.6 : 0.0;
    float y = y0 + (swell - val * 2.5 + wake * 5.0 - f * 4.0 + rough + scatter) * d;
    float cov = cover(p.y, y, mix(0.6, 1.45, bright) * thick) * mix(0.16, 1.0, bright);
    if (cov > line) {
      line = cov;
      col = c;
    }
    if (f > 0.25) white = max(white, cover(p.y, y, 1.6 * thick));
  }
  float a = max(line, white);
  outColor = mix(vec4(mix(col, vec3(1.0), white) * a, a), full, fill);
}`;

export interface Sea {
  size(): { w: number; h: number };
  /** While on, the cursor no longer breaks the wave and no sets roll in by themselves. */
  setGame(on: boolean): void;
  /** 0 to 1: the portrait takes on sea colours and its lines get finer. */
  setCharge(v: number): void;
  /** 0 shows the portrait, 1 the game wave; the change spreads from (x, y). */
  setMorph(v: number, x: number, y: number): void;
  /** breaking: 0 an unbroken swell, 1 a full tube; zoom brings the water towards the screen. */
  setWave(lip: number, trough: number, curl: number, reach: number, scroll: number, breaking: number, zoom: number): void;
  foam(x: number, y: number, radius: number, amount: number): void;
  spray(x: number, y: number, vx: number, vy: number, life: number): void;
  crash(x: number, y: number, size: number): void;
  onFrame(cb: (dt: number, now: number) => void): void;
  /** Draws on the 2D layer above the lines and the spray. */
  onDraw(cb: (ctx: CanvasRenderingContext2D) => void): void;
}

export function mountLineField(stage: HTMLElement, canvas: HTMLCanvasElement, sprayCanvas: HTMLCanvasElement, data: FieldData): Sea | undefined {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return;
  const ctx = sprayCanvas.getContext('2d')!;

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile failed');
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'program link failed');
  const u: Record<string, WebGLUniformLocation | null> = {};
  for (const name of ['uView', 'uDpr', 'uTime', 'uCount', 'uPointer', 'uEnergy', 'uVal', 'uFoam', 'uTint', 'uMorph', 'uOrigin', 'uWave', 'uScroll', 'uBreak', 'uZoom']) u[name] = gl.getUniformLocation(prog, name);
  gl.useProgram(prog);
  gl.uniform1i(u.uVal, 0);
  gl.uniform1i(u.uFoam, 1);
  gl.bindVertexArray(gl.createVertexArray());
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  const texture = (unit: number) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  texture(0);
  const levels = new Uint8Array(data.w * data.h);
  for (let y = 0; y < data.h; y++) for (let x = 0; x < data.w; x++) levels[y * data.w + x] = (Number(data.rows[y][x]) / 9) * 255;
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, data.w, data.h, 0, gl.RED, gl.UNSIGNED_BYTE, levels);
  texture(1);

  let W = 0;
  let H = 0;
  let dpr = 1;
  let fw = 0;
  let fh = 0;
  let foam = new Float32Array(0);
  let foamBytes = new Uint8Array(0);
  let foamy = false;
  // Spray particles: x, y, vx, vy, life, max life.
  const spray = new Float32Array(MAX_SPRAY * 6);
  let sprayHead = 0;
  const pointer = { x: -9999, y: -9999, energy: 0, inside: false, travel: 0 };
  let lastSet = performance.now();
  let game = false;
  let charge = 0;
  let morph = 0;
  const origin = { x: 0, y: 0 };
  // lip, trough, curl, reach, scroll, breaking, zoom.
  const wave = new Float32Array([0, 0, 0, 0, 0, 0, 1]);
  let onFrame = (_dt: number, _now: number) => {};
  let onDraw = (_ctx: CanvasRenderingContext2D) => {};
  let running = false;
  let visible = false;
  let raf = 0;
  let last = performance.now();
  const start = performance.now();

  const uploadFoam = () => {
    for (let i = 0; i < foam.length; i++) foamBytes[i] = foam[i] * 255;
    gl.activeTexture(gl.TEXTURE1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, fw, fh, gl.RED, gl.UNSIGNED_BYTE, foamBytes);
  };

  const resize = () => {
    const r = stage.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = r.width;
    H = r.height;
    canvas.width = sprayCanvas.width = Math.round(W * dpr);
    canvas.height = sprayCanvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fw = Math.ceil(W / FOAM_CELL);
    fh = Math.ceil(H / FOAM_CELL);
    foam = new Float32Array(fw * fh);
    foamBytes = new Uint8Array(fw * fh);
    gl.activeTexture(gl.TEXTURE1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, fw, fh, 0, gl.RED, gl.UNSIGNED_BYTE, foamBytes);
    draw(performance.now());
  };

  const throwSpray = (x: number, y: number, vx: number, vy: number, life: number) => {
    const k = (sprayHead++ % MAX_SPRAY) * 6;
    spray.set([x, y, vx, vy, life, life], k);
  };

  const whiten = (x: number, y: number, radius: number, amount: number) => {
    const j0 = Math.max(0, Math.floor((y - radius) / FOAM_CELL));
    const j1 = Math.min(fh - 1, Math.ceil((y + radius) / FOAM_CELL));
    const i0 = Math.max(0, Math.floor((x - radius) / FOAM_CELL));
    const i1 = Math.min(fw - 1, Math.ceil((x + radius) / FOAM_CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot((i + 0.5) * FOAM_CELL - x, (j + 0.5) * FOAM_CELL - y);
        if (d < radius) foam[j * fw + i] = Math.min(1, foam[j * fw + i] + amount * (1 - d / radius));
      }
    }
    foamy = true;
  };

  // A breaking lip: foam along a band, spray thrown up and forward.
  const crash = (x: number, y: number, size: number) => {
    for (let k = 0; k < 70 * size; k++) {
      const along = (Math.random() - 0.5) * 220 * size;
      throwSpray(x + along, y + (Math.random() - 0.5) * 14, along * 0.6 + (Math.random() - 0.5) * 60, -60 - Math.random() * 220 * size, 0.7 + Math.random() * 0.9);
    }
    whiten(x, y, 120 * size, 0.9);
  };

  const draw = (now: number) => {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(u.uView, W, H);
    gl.uniform1f(u.uDpr, dpr);
    gl.uniform1f(u.uTime, reduced ? 0 : (now - start) / 1000);
    // Charging the game packs the lines from PITCH down to FINE.
    gl.uniform1f(u.uCount, Math.max(60, Math.round(H / (PITCH + (FINE - PITCH) * charge))));
    gl.uniform1f(u.uTint, charge);
    gl.uniform2f(u.uPointer, pointer.x, pointer.y);
    gl.uniform1f(u.uEnergy, pointer.energy);
    gl.uniform1f(u.uMorph, morph);
    gl.uniform2f(u.uOrigin, origin.x, origin.y);
    gl.uniform4f(u.uWave, wave[0], wave[1], wave[2], wave[3]);
    gl.uniform1f(u.uScroll, wave[4]);
    gl.uniform1f(u.uBreak, wave[5]);
    gl.uniform1f(u.uZoom, wave[6]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    ctx.clearRect(0, 0, W, H);
    const dots = [new Path2D(), new Path2D(), new Path2D()];
    for (let k = 0; k < MAX_SPRAY; k++) {
      const o = k * 6;
      if (spray[o + 4] <= 0) continue;
      const life = spray[o + 4] / spray[o + 5];
      const s = 0.8 + life * 1.2;
      dots[Math.min(2, Math.floor(life * 3))].rect(spray[o], spray[o + 1], s, s);
    }
    dots.forEach((p, k) => {
      ctx.fillStyle = `rgba(255,255,255,${(0.3 + k * 0.33).toFixed(2)})`;
      ctx.fill(p);
    });
    onDraw(ctx);
  };

  const loop = (now: number) => {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    pointer.energy *= Math.exp(-dt * (pointer.inside ? 1.2 : 3));
    if (foamy) {
      const fade = Math.exp(-dt * 0.9);
      foamy = false;
      for (let i = 0; i < foam.length; i++) {
        if (foam[i] === 0) continue;
        foam[i] = foam[i] < 0.01 ? 0 : foam[i] * fade;
        foamy = true;
      }
      uploadFoam();
    }
    for (let k = 0; k < MAX_SPRAY; k++) {
      const o = k * 6;
      if (spray[o + 4] <= 0) continue;
      spray[o + 3] += 420 * dt;
      spray[o + 2] *= Math.exp(-dt * 1.5);
      spray[o] += spray[o + 2] * dt;
      spray[o + 1] += spray[o + 3] * dt;
      spray[o + 4] -= dt;
    }
    // Every few seconds a small set rolls in by itself, so the sea never looks frozen.
    if (!game && now - lastSet > 3800) {
      lastSet = now;
      crash(W * (0.25 + Math.random() * 0.5), H * (0.35 + Math.random() * 0.4), 0.35);
    }
    onFrame(dt, now);
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
    if (reduced || game) return;
    const r = stage.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const dx = pointer.inside ? x - pointer.x : 0;
    const dy = pointer.inside ? y - pointer.y : 0;
    const speed = Math.hypot(dx, dy);
    pointer.x = x;
    pointer.y = y;
    pointer.inside = true;
    pointer.energy = Math.min(1, pointer.energy + speed / 120);
    whiten(x, y, 34, Math.min(0.5, speed / 60));
    for (let k = 0; k < Math.min(16, speed * 0.4); k++) {
      throwSpray(x + (Math.random() - 0.5) * 24, y + (Math.random() - 0.5) * 10, dx * 4 + (Math.random() - 0.5) * 80, -40 - Math.random() * 160, 0.5 + Math.random() * 0.8);
    }
    pointer.travel += speed;
    if (pointer.travel > CRASH_DISTANCE) {
      pointer.travel = 0;
      crash(x, y, 1);
      lastSet = performance.now();
      stage.dispatchEvent(new CustomEvent('wavebreak'));
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
    size: () => ({ w: W, h: H }),
    setGame(on) {
      game = on;
      pointer.energy = 0;
      pointer.travel = 0;
    },
    setCharge: (v) => (charge = v),
    setMorph(v, x, y) {
      morph = v;
      origin.x = x;
      origin.y = y;
    },
    setWave: (lip, trough, curl, reach, scroll, breaking, zoom) => wave.set([lip, trough, curl, reach, scroll, breaking, zoom]),
    foam: whiten,
    spray: throwSpray,
    crash,
    onFrame: (cb) => (onFrame = cb),
    onDraw: (cb) => (onDraw = cb),
  };
}
