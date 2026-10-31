// A small surf game hidden in the sea portrait. Keep the cursor on the picture for two seconds: it
// takes on the colours of the sea, its lines get finer, then they re-form into a swell seen from the
// beach at sunset. You paddle into it, towards the beach, as it rises and comes at you; click to take
// off: you pop up, drop straight down the face and bottom turn along it, while the wave breaks at the
// peak and then starts to barrel, peeling towards you. The surfer goes wherever the cursor is: further
// right is faster and keeps you ahead of the tube; slower, it catches up, until the falling lip hides
// you, and further still it lands on you. Shells are worth points. Surfers and rocks wipe you out; dodge
// them by moving up and down the face. Click on the face for a cutback; in the tube, for hands in the
// air, or a tuck when deep in. Shoot up past the lip to fly: keep going up for a frontside
// 360, pull down for a backside one, hold the button to grab the rail. Every air lands. The wave is
// drawn by the sea shader (line-field.ts); people, rocks, birds, shells and the score go on its 2D
// layer.
import type { Sea } from './line-field';

export interface GameCopy {
  score: string;
  best: string;
  speed: string;
  air: string;
  grab: string;
  frontside: string;
  backside: string;
  cutback: string;
  tube: string;
  wipeout: string;
  retry: string;
  retryTouch: string;
  takeoff: string;
  takeoffTouch: string;
  shells: string;
  newBest: string;
}

// Seconds of hovering before the picture turns into the game; ms it may then be left alone while
// paddling or after a wipeout (never during a ride).
const CHARGE = 2;
const LEAVE = 2500;
const MORPH_IN = 1.4;
const MORPH_OUT = 0.9;
// Seconds for the swell to rise, to pop up on the board, to drop down the face (pop-up included), for
// the bottom turn, and for the wave to break into a tube.
const SWELL = 3.2;
const POP = 0.35;
const DROP = 1;
const TURN = 0.4;
const BREAK = 4;
// Seconds for a cutback, and for a pose in the tube.
const CUT = 0.9;
const POSE = 1.2;
// How far off the swell starts, as a zoom on the water.
const FAR = 0.72;
const PAPER = '#f0efea';
const MUTE = '#a2a19c';
const SIGNAL = '#f3e600';
const MONO = '"Share Tech Mono", monospace';
const DISPLAY = '"Chakra Petch", sans-serif';
// The sun is low behind the wave: people are dark shapes with a warm rim of light.
const SUIT = '#0e1115';
const RIM = '#ffb27a';
// Boards as deck and rail colours.
type Board = [string, string];
const BOARDS: Board[] = [
  ['#e8e3d5', '#9a9486'],
  ['#a9cbdc', '#5d8396'],
  ['#e3aabb', '#9a6273'],
  ['#dcc4ff', '#8a74ad'],
];
const OWN: Board = [SIGNAL, '#8a8200'];

type Kind = 'sitter' | 'paddler' | 'rider' | 'rock' | 'gull' | 'shell';
interface Thing {
  kind: Kind;
  x: number;
  y: number;
  // Where it floats on the face, 0 at the crest and 1 in the trough, so it rises and falls with it;
  // a shell above the crest has a negative one.
  at: number;
  r: number;
  phase: number;
  board: Board;
  shape: number[];
  // A paddler's countdown to popping up (Infinity if they never catch the wave), how far up they are,
  // and how fast they ride once up.
  wait: number;
  pop: number;
  v: number;
}
interface Popup {
  text: string;
  x: number;
  y: number;
  age: number;
}
interface Air {
  vy: number;
  t: number;
  from: number;
  peak: number;
  spin: number;
  spinFrom: number;
  spinDur: number;
  grab: number;
  grabbing: boolean;
}
interface Pose {
  // 0 lying on the board, 1 up and riding.
  stand: number;
  crouch: number;
  lean: number;
  // Drives the paddling stroke, the kicking and the arms swinging for balance.
  time: number;
  grab: boolean;
  // 0 arms out for balance, 1 raised overhead.
  claim: number;
  rim: number;
  wake: number;
  board: Board;
}
type Point = [number, number];
// A limb drawn as a thick round stroke: from x, y to x, y, width.
type Limb = [number, number, number, number, number];

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (t: number) => t * t * (3 - 2 * t);
const step = (a: number, b: number, v: number) => smooth(clamp((v - a) / (b - a), 0, 1));
const mix = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// Two-bone leg, thigh 9 and shin 9.5, the knee bent forward towards the nose.
function knee(hip: Point, foot: Point): Point {
  const dx = foot[0] - hip[0];
  const dy = foot[1] - hip[1];
  const d = Math.min(Math.hypot(dx, dy), 18.4);
  const a = Math.atan2(dy, dx) - Math.acos(clamp((81 + d * d - 90.25) / (18 * d), -1, 1));
  return [hip[0] + Math.cos(a) * 9, hip[1] + Math.sin(a) * 9];
}

// A person: first a warm rim offset towards the sun, then the dark body over it.
function body(ctx: CanvasRenderingContext2D, limbs: Limb[], head: [number, number, number], rim: number) {
  const pass = (color: string, grow: number, dx: number, dy: number) => {
    ctx.strokeStyle = ctx.fillStyle = color;
    for (const [x0, y0, x1, y1, w] of limbs) {
      ctx.lineWidth = w + grow;
      ctx.beginPath();
      ctx.moveTo(x0 + dx, y0 + dy);
      ctx.lineTo(x1 + dx, y1 + dy);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(head[0] + dx, head[1] + dy, head[2] + grow / 2, 0, Math.PI * 2);
    ctx.fill();
  };
  if (rim > 0) {
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha * rim;
    pass(RIM, 0.6, 0.7, -0.7);
    ctx.globalAlpha = alpha;
  }
  pass(SUIT, 0, 0, 0);
}

// A board lying on the water, nose to the right; the rail facing the beach is in shade.
function floatingBoard(ctx: CanvasRenderingContext2D, color: string) {
  const outline = (dy: number) => {
    ctx.beginPath();
    ctx.moveTo(-19, dy);
    ctx.quadraticCurveTo(-19, -2 + dy, -12, -2 + dy);
    ctx.lineTo(12, -2 + dy);
    ctx.quadraticCurveTo(19, -2.2 + dy, 23, -4.5 + dy);
    ctx.quadraticCurveTo(19, 0.9 + dy, 12, 0.9 + dy);
    ctx.lineTo(-12, 0.9 + dy);
    ctx.quadraticCurveTo(-19, 0.9 + dy, -19, dy);
  };
  ctx.fillStyle = color;
  outline(0);
  ctx.fill();
  ctx.fillStyle = 'rgba(6, 12, 18, 0.55)';
  outline(1.3);
  ctx.fill();
}

// A board side-on, nose to the right and kicking up: thruster fins under the tail, showing once it
// planes, the deck in the light and the rail in shade underneath.
function rideBoard(ctx: CanvasRenderingContext2D, [deck, rail]: Board, fins: number) {
  if (fins > 0) {
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha * fins;
    ctx.fillStyle = '#23262b';
    for (const fx of [-15.5, -11]) {
      ctx.beginPath();
      ctx.moveTo(fx - 1.8, 1.6);
      ctx.quadraticCurveTo(fx - 1.2, 5.5, fx + 1.2, 6.2);
      ctx.lineTo(fx + 1.8, 1.6);
      ctx.fill();
    }
    ctx.globalAlpha = alpha;
  }
  ctx.fillStyle = rail;
  ctx.beginPath();
  ctx.moveTo(-18, -0.4);
  ctx.quadraticCurveTo(-18, 2.3, -12, 2.3);
  ctx.lineTo(10, 2.1);
  ctx.quadraticCurveTo(17, 1.5, 21.5, -3.4);
  ctx.quadraticCurveTo(15, -1.3, 10, -1.3);
  ctx.lineTo(-12, -1.3);
  ctx.quadraticCurveTo(-18, -1.3, -18, -0.4);
  ctx.fill();
  ctx.fillStyle = deck;
  ctx.beginPath();
  ctx.moveTo(-17.6, -0.5);
  ctx.quadraticCurveTo(-17.4, -1.7, -12, -1.7);
  ctx.lineTo(10, -1.7);
  ctx.quadraticCurveTo(15.5, -1.8, 21.5, -3.4);
  ctx.quadraticCurveTo(16, -0.2, 10, 0.1);
  ctx.lineTo(-12, 0.1);
  ctx.quadraticCurveTo(-17.2, 0.1, -17.6, -0.5);
  ctx.fill();
}

// A surfer seen from the front, coming down the face towards the beach on a board that points at us,
// foreshortened. Lying down at stand 0, paddling with the arms windmilling either side and the feet
// kicking; up at 1, crouched, arms out for balance. wake draws the track left down the face.
function frontRider(ctx: CanvasRenderingContext2D, p: { stand: number; time: number; board: Board; wake: number }) {
  const s = p.stand;
  const t = p.time;
  if (p.wake > 0) {
    const g = ctx.createLinearGradient(0, -12, 0, -64);
    g.addColorStop(0, `rgba(235, 245, 245, ${(0.75 * p.wake).toFixed(3)})`);
    g.addColorStop(1, 'rgba(235, 245, 245, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-4, -12);
    ctx.lineTo(-10, -64);
    ctx.lineTo(10, -64);
    ctx.lineTo(4, -12);
    ctx.fill();
  }
  const [deck, rail] = p.board;
  const outline = (dy: number) => {
    ctx.beginPath();
    ctx.moveTo(0, -17 + dy);
    ctx.bezierCurveTo(5, -16 + dy, 7.5, -8 + dy, 6.5, -1 + dy);
    ctx.bezierCurveTo(5.5, 5 + dy, 2, 8 + dy, 0, 9 + dy);
    ctx.bezierCurveTo(-2, 8 + dy, -5.5, 5 + dy, -6.5, -1 + dy);
    ctx.bezierCurveTo(-7.5, -8 + dy, -5, -16 + dy, 0, -17 + dy);
  };
  ctx.fillStyle = rail;
  outline(1.6);
  ctx.fill();
  ctx.fillStyle = deck;
  outline(0);
  ctx.fill();

  const kick = Math.sin(t * 8) * 1.2;
  const swing = Math.sin(t * 2.4) * 1.5;
  const at = (down: Point, up: Point): Point => mix(down, up, s);
  const hips: Point[] = [at([-2.2, -10], [-3, -16]), at([2.2, -10], [3, -16])];
  const knees: Point[] = [at([-2.4, -14], [-7, -11]), at([2.4, -14], [6.5, -7])];
  const feet: Point[] = [at([-2 - kick, -18.5], [-3.5, -7]), at([2 + kick, -18.5], [3, 1])];
  const neck = at([0, -3.5], [0, -26]);
  const shoulders: Point[] = [at([-5.5, -3.5], [-5.5, -25.5]), at([5.5, -3.5], [5.5, -25.5])];
  const head = at([0, -0.5], [0, -30.5]);
  const limbs: Limb[] = [];
  const wet: [Point, Point][] = [];
  for (const i of [0, 1]) {
    const side = i ? 1 : -1;
    limbs.push([hips[i][0], hips[i][1], knees[i][0], knees[i][1], 4.4], [knees[i][0], knees[i][1], feet[i][0], feet[i][1], 3.4]);
    // Paddling, each hand reaches forward towards us, pulls back under the water along the rail and
    // swings round over it again.
    const a = t * 5.5 + i * Math.PI;
    const under = Math.sin(a) < 0 && s < 0.5;
    const hand = at([side * (8 + 2.5 * Math.sin(a)), -3 + 7 * Math.cos(a)], [side * 16, -20 + side * swing]);
    const elbow = at(mix(shoulders[i], hand, 0.5), [side * 11, -23 + side * swing * 0.5]);
    if (under) wet.push([elbow, hand]);
    else limbs.push([shoulders[i][0], shoulders[i][1], elbow[0], elbow[1], 2.8], [elbow[0], elbow[1], hand[0], hand[1], 2.3]);
  }
  limbs.push(
    [hips[0][0], hips[0][1], hips[1][0], hips[1][1], 4.6],
    [(hips[0][0] + hips[1][0]) / 2, (hips[0][1] + hips[1][1]) / 2, neck[0], neck[1], 7.5],
    [shoulders[0][0], shoulders[0][1], shoulders[1][0], shoulders[1][1], 4.2],
  );
  body(ctx, limbs, [head[0], head[1], 3.4], 1);
  const alpha = ctx.globalAlpha;
  for (const [elbow, hand] of wet) {
    ctx.globalAlpha = alpha * 0.35;
    ctx.strokeStyle = SUIT;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(elbow[0], elbow[1]);
    ctx.lineTo(hand[0], hand[1]);
    ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(235, 245, 245, 0.8)';
    ctx.beginPath();
    ctx.ellipse(elbow[0], elbow[1] + 1, 2.4, 1, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Rings of water spreading in front of something floating.
function ripples(ctx: CanvasRenderingContext2D, phase: number, width: number) {
  ctx.strokeStyle = 'rgba(225, 240, 240, 0.5)';
  ctx.lineWidth = 0.9;
  for (let j = 0; j < 2; j++) {
    ctx.beginPath();
    ctx.ellipse(0, 1.2 + j * 1.6, width * (1.05 + 0.12 * Math.sin(phase * 2.4 + j * 2)), 1.6 + j, 0, 0, Math.PI);
    ctx.stroke();
  }
}

// A surfer on their board, nose to the right. Lying down they paddle, arms windmilling through the
// water and feet kicking; popping up, the same body rises into the riding stance: knees soaking up
// the turns, the torso leaning into them, arms out for balance.
function rider(ctx: CanvasRenderingContext2D, p: Pose) {
  const s = p.stand;
  const t = p.time;
  if (p.wake > 0) {
    // The wake peeling off the rail behind the tail.
    const g = ctx.createLinearGradient(-46, 0, -16, 0);
    g.addColorStop(0, 'rgba(235, 245, 245, 0)');
    g.addColorStop(1, `rgba(235, 245, 245, ${(0.8 * p.wake).toFixed(3)})`);
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-16, 1.8);
    ctx.quadraticCurveTo(-30, 3.2, -46, 2.6 + Math.sin(t * 9) * 0.8);
    ctx.stroke();
  }
  rideBoard(ctx, p.board, s);

  const swing = Math.sin(t * 2.4) * 0.25;
  const hip: Point = [p.lean * 5 - 1, -20 + 8 * p.crouch];
  const bend = 0.18 + p.lean + 0.4 * p.crouch;
  const shoulder: Point = [hip[0] + Math.sin(bend) * 12, hip[1] - Math.cos(bend) * 12];
  const kick = Math.sin(t * 8) * 1.3;
  const lyingHip: Point = [-4, -3.4];
  const lyingShoulder: Point = [6.5, -5];
  const lyingFeet: Point[] = [
    [-17, -3.4 + kick],
    [-16, -2.8 - kick],
  ];
  const strokes = [t * 5.5 + Math.PI, t * 5.5].map((a): Point => [6.5 + Math.cos(a) * 9, -3.5 + Math.sin(a) * 6.5]);
  const h = mix(lyingHip, hip, s);
  const sh = mix(lyingShoulder, shoulder, s);
  const backFoot = mix(lyingFeet[0], [-8, -2.4], s);
  const frontFoot = mix(lyingFeet[1], [7, -2.4], s);
  const backKnee = mix(mix(lyingHip, lyingFeet[0], 0.5), knee(hip, [-8, -2]), s);
  const frontKnee = mix(mix(lyingHip, lyingFeet[1], 0.5), knee(hip, [7, -2]), s);
  const up: [Point, Point][] = [
    [
      [shoulder[0] - 5, shoulder[1] + 1 - p.crouch * 2 - swing * 3],
      [shoulder[0] - 11, shoulder[1] - 1 - p.crouch * 3 - swing * 5],
    ],
    p.grab
      ? [
          [(shoulder[0] + 5) / 2 + 3, (shoulder[1] - 1) / 2],
          [5, -1],
        ]
      : [
          [shoulder[0] + 6, shoulder[1] + 1 + swing * 3],
          [shoulder[0] + 12, shoulder[1] + 3 + swing * 5],
        ],
  ];
  const raised: [Point, Point][] = [
    [
      [shoulder[0] - 4, shoulder[1] - 6],
      [shoulder[0] - 7, shoulder[1] - 13],
    ],
    [
      [shoulder[0] + 4, shoulder[1] - 6],
      [shoulder[0] + 7, shoulder[1] - 13],
    ],
  ];
  const arms = up.map(([elbow, hand], i): [Point, Point] => [
    mix(mix(lyingShoulder, strokes[i], 0.5), mix(elbow, raised[i][0], p.claim), s),
    mix(strokes[i], mix(hand, raised[i][1], p.claim), s),
  ]);

  // The leash, from the tail to the back ankle.
  ctx.strokeStyle = '#15171b';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-17.5, -0.6);
  ctx.quadraticCurveTo(-21, 4, backFoot[0] - 0.5, backFoot[1] - 0.6);
  ctx.stroke();

  const limbs: Limb[] = [];
  const wet: [Point, Point][] = [];
  const arm = ([elbow, hand]: [Point, Point]) => {
    if (hand[1] > 0) wet.push([elbow, hand]);
    else limbs.push([sh[0], sh[1], elbow[0], elbow[1], 2.8], [elbow[0], elbow[1], hand[0], hand[1], 2.3]);
  };
  arm(arms[0]);
  limbs.push(
    [h[0], h[1], backKnee[0], backKnee[1], 4.6],
    [backKnee[0], backKnee[1], backFoot[0], backFoot[1], 3.5],
    [h[0], h[1], sh[0], sh[1], 6.6],
    [h[0], h[1], frontKnee[0], frontKnee[1], 4.6],
    [frontKnee[0], frontKnee[1], frontFoot[0], frontFoot[1], 3.5],
  );
  arm(arms[1]);
  const head = mix([10.5, -7.8], [shoulder[0] + Math.sin(bend) * 4.8, shoulder[1] - Math.cos(bend) * 4.8], s);
  body(ctx, limbs, [head[0], head[1], 3.3], p.rim);
  // Arms in the water show only dimly, with a splash where they go in.
  const alpha = ctx.globalAlpha;
  for (const [elbow, hand] of wet) {
    ctx.globalAlpha = alpha * 0.35;
    ctx.strokeStyle = SUIT;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(sh[0], sh[1]);
    ctx.lineTo(elbow[0], elbow[1]);
    ctx.lineTo(hand[0], hand[1]);
    ctx.stroke();
    ctx.globalAlpha = alpha;
    if (hand[1] < 2) {
      ctx.fillStyle = 'rgba(235, 245, 245, 0.8)';
      ctx.beginPath();
      ctx.ellipse(hand[0], 0, 2.4, 1, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// A scallop shell, the coin of the game: ribs fanning out from the hinge, warm in the low sun, and a
// glint that comes and goes.
function drawShell(ctx: CanvasRenderingContext2D, glint: number) {
  const ribs = 7;
  const a0 = -Math.PI / 2 - 1.15;
  const da = 2.3 / ribs;
  const at = (a: number, r: number): Point => [Math.cos(a) * r, 4.5 + Math.sin(a) * r];
  const glow = ctx.createRadialGradient(0, -1, 2, 0, -1, 14);
  glow.addColorStop(0, 'rgba(255, 214, 140, 0.4)');
  glow.addColorStop(1, 'rgba(255, 214, 140, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, -1, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#6b2e17';
  ctx.lineWidth = 0.9;
  // The ears either side of the hinge.
  ctx.fillStyle = '#d9824f';
  ctx.beginPath();
  ctx.moveTo(-4.4, 2.8);
  ctx.lineTo(4.4, 2.8);
  ctx.lineTo(3, 6);
  ctx.lineTo(-3, 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // The fan, its edge scalloped where the ribs end.
  ctx.beginPath();
  ctx.moveTo(0, 4.5);
  const first = at(a0, 10);
  ctx.lineTo(first[0], first[1]);
  for (let i = 0; i < ribs; i++) {
    const c = at(a0 + da * (i + 0.5), 11.6);
    const e = at(a0 + da * (i + 1), 10);
    ctx.quadraticCurveTo(c[0], c[1], e[0], e[1]);
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(0, 4.5, 1, 0, 4.5, 12);
  g.addColorStop(0, '#c8653c');
  g.addColorStop(0.55, '#f2a46c');
  g.addColorStop(1, '#ffe2bf');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(120, 48, 24, 0.55)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (let i = 1; i < ribs; i++) {
    const e = at(a0 + da * i, 10);
    ctx.moveTo(0, 4.5);
    ctx.lineTo(e[0], e[1]);
  }
  ctx.stroke();
  if (glint > 0.05) {
    const r = 1.5 + 3 * glint;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(4, -4 - r);
    ctx.quadraticCurveTo(4, -4, 4 + r, -4);
    ctx.quadraticCurveTo(4, -4, 4, -4 + r);
    ctx.quadraticCurveTo(4, -4, 4 - r, -4);
    ctx.quadraticCurveTo(4, -4, 4, -4 - r);
    ctx.fill();
  }
}

function drawRock(ctx: CanvasRenderingContext2D, t: Thing, k: number) {
  ctx.translate(t.x, t.y);
  ctx.scale(k, k);
  const r = t.r / k;
  const n = t.shape.length;
  const pts = t.shape.map((v, i): Point => {
    const a = Math.PI + (i / (n - 1)) * Math.PI;
    return [Math.cos(a) * r * v * 1.3, Math.sin(a) * r * v * (0.75 + 0.25 * t.shape[(i + 3) % n])];
  });
  const trace = (from: number, to: number) => {
    ctx.beginPath();
    ctx.moveTo(pts[from][0], pts[from][1]);
    for (let i = from + 1; i <= to; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  };
  // Its face is towards us and the sun behind it: mostly shade, a little lighter higher up.
  trace(0, n - 1);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, -r, 0, 0);
  g.addColorStop(0, '#3b3e47');
  g.addColorStop(0.55, '#202329');
  g.addColorStop(1, '#0b0d10');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Cracks between the facets, and wet weed along the waterline.
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (let i = 2; i < n - 2; i += 3) {
    ctx.moveTo(pts[i][0], pts[i][1]);
    ctx.lineTo(pts[i][0] * 0.55 + (t.shape[i] - 0.8) * r, -r * 0.15);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(38, 46, 26, 0.9)';
  ctx.beginPath();
  ctx.moveTo(-r * 1.4, 0);
  for (let i = 0; i <= 10; i++) ctx.lineTo(-r * 1.4 + (i / 10) * r * 2.8, -2.5 - t.shape[i % n] * 2);
  ctx.lineTo(r * 1.4, 0);
  ctx.fill();
  ctx.restore();
  // A warm rim where the sun catches the top and the right-hand edge.
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha * 0.75;
  ctx.strokeStyle = RIM;
  ctx.lineWidth = 1.1;
  trace(Math.floor(n * 0.4), n - 2);
  ctx.stroke();
  ctx.globalAlpha = alpha;
  // Foam washing round its base.
  ctx.strokeStyle = 'rgba(230, 242, 242, 0.85)';
  ctx.lineWidth = 1.3;
  for (let j = 0; j < 2; j++) {
    ctx.beginPath();
    ctx.ellipse(0, 1 + j * 2.4, r * (1.4 + 0.2 * Math.sin(t.phase * 2.6 + j * 2)), 2.4, 0, 0, Math.PI);
    ctx.stroke();
  }
}

function drawGull(ctx: CanvasRenderingContext2D, t: Thing, k: number) {
  const s = t.phase;
  ctx.translate(t.x, t.y + Math.sin(s * 1.3) * 4 * k);
  ctx.scale(k * 0.9, k * 0.9);
  // It glides, with a few flaps now and then.
  const lift = Math.sin(s * 0.8 + t.r) > 0.4 ? Math.sin(s * 12) : 0.3;
  const wing = (up: number, dx: number) => {
    ctx.beginPath();
    ctx.moveTo(2 + dx, -0.6);
    ctx.quadraticCurveTo(0.5 + dx, -3 - 3 * up, -1.5 + dx, -3.5 - 4.5 * up);
    ctx.lineTo(-9 + dx, -2.5 - 8 * up);
    ctx.quadraticCurveTo(-4 + dx, -1.2 - 2.5 * up, -2 + dx, 0.2);
    ctx.closePath();
    ctx.fill();
  };
  ctx.fillStyle = '#968ca0';
  wing(lift * 0.8, 1.5);
  ctx.fillStyle = '#d8cfd8';
  ctx.beginPath();
  ctx.ellipse(0, 0, 5, 1.8, -0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(4.6, -1.1, 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-4, -0.8);
  ctx.lineTo(-8.5, -0.2);
  ctx.lineTo(-4, 1);
  ctx.fill();
  ctx.fillStyle = '#e8b04a';
  ctx.beginPath();
  ctx.moveTo(6, -1.4);
  ctx.lineTo(8.6, -0.9);
  ctx.lineTo(6, -0.5);
  ctx.fill();
  ctx.fillStyle = '#e4dce4';
  wing(lift, 0);
  ctx.strokeStyle = '#26232c';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(-6.2, -2.3 - 6.2 * lift);
  ctx.lineTo(-9, -2.5 - 8 * lift);
  ctx.stroke();
}

export function mountSurfGame(stage: HTMLElement, sea: Sea, copy: GameCopy) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let mode: 'idle' | 'in' | 'paddle' | 'play' | 'over' | 'out' = 'idle';
  let charge = 0;
  let morph = 0;
  const origin = { x: 0, y: 0 };
  const pointer = { x: 0, y: 0, inside: false };
  let awayFrom = -1;
  let touch = false;

  // Geometry and ride state, in the wave's own frame (CSS px) and seconds; k scales sizes and speeds
  // with the stage.
  let k = 1;
  let W = 0;
  let H = 0;
  // The crest at the peak once the swell has fully risen, the trough, and how far the lip throws.
  let lip = 0;
  let trough = 0;
  let reach = 0;
  // Where the lip pitches: the peak at first, then peeling towards the surfer unless they outrun it.
  let curl = 0;
  // Where the drop down the face started.
  let dropFrom = 0;
  let swell = 0;
  let breaking = 0;
  let rx = 0;
  let vx = 0;
  let y = 0;
  let vy = 0;
  let speed = 0;
  let travelled = 0;
  let score = 0;
  let best = 0;
  let record = false;
  let collected = 0;
  let inTube = 0;
  let deepest = 0;
  let clock = 0;
  let upAt = -1;
  let overAt = 0;
  let nextThing = 0;
  let nextShells = 0;
  let nextGull = 0;
  let air: Air | null = null;
  // Seconds into a cutback or a tube pose, -1 when not doing one.
  let cut = -1;
  let pose = -1;
  let tuck = false;
  let things: Thing[] = [];
  let popups: Popup[] = [];

  const measure = () => {
    ({ w: W, h: H } = sea.size());
    k = Math.max(0.62, H / 700);
    lip = H * 0.22;
    trough = H * 0.8;
    reach = (trough - lip) * 1.25;
  };
  // Same wave as the shader: the crest rises as the swell builds; a rounded peak easing down into the
  // shoulders, and once it breaks as tall as the peak left of the curl.
  const crest = () => trough - (trough - lip) * (0.45 + 0.55 * smooth(swell));
  const lipAt = (px: number) => {
    const d = (px - curl) / W;
    let h = 0.92 * Math.exp((-d * d) / (d > 0 ? 0.9 : 0.5)) + 0.08 * Math.exp((-d * d) / 0.01);
    if (d < 0) h = 1 + (h - 1) * (1 - step(0, 0.5, breaking));
    return trough - (trough - crest()) * (0.28 + 0.72 * h);
  };
  // As it breaks, a small curl at the top grows into a tube as tall as the wave: the lip throws further
  // out and lower down. The whitewater spreads left from where it lands and tumbles down the face.
  const formed = () => step(0, 0.7, breaking);
  const reachNow = () => Math.max(reach * formed(), 1);
  const spread = () => W * 1.5 * step(0.15, 1, breaking) + 70 * k * step(0, 0.15, breaking);
  // How far under the thrown lip px is: 0 at the curl, 1 where the lip lands; -1 before it breaks.
  const depth = (px: number) => (breaking > 0.02 ? (curl - px) / reachNow() : -1);
  // How far down the face the whitewater reaches at px.
  const washed = (px: number) => {
    const c = lipAt(px);
    const landed = c + (trough - c) * formed() + 20 * k;
    return landed + (trough + 16 * k - landed) * step(0.05, 0.6, breaking);
  };
  // Too deep: the lip lands on you, or the whitewater has you.
  const caught = (px: number, py: number) => depth(px) > 0.95 && curl - reachNow() - px < spread() - 30 * k && py < washed(px);
  // Highest the surfer can be at px: the crest on the open face; in the tube, under the falling lip.
  const topAt = (px: number) => {
    const c = lipAt(px);
    const s = depth(px);
    if (s <= 0 || s >= 1) return c - 6 * k;
    return c + (trough - c) * formed() * (1 - Math.sqrt(1 - s * s)) + 10 * k;
  };
  const gravity = () => 1400 * k;
  // The wave runs a little faster the longer you stay on it.
  const pace = () => Math.min(430, 250 + travelled / (250 * k)) * k;

  // While you paddle in, the water is drawn zoomed in towards the horizon above the middle; the game
  // works in the wave's frame, so the pointer comes in and the sea's foam and spray go out through
  // these.
  const zoom = () => FAR + (1 - FAR) * smooth(swell);
  const toScreen = (x: number, py: number): Point => [W / 2 + (x - W / 2) * zoom(), H * 0.4 + (py - H * 0.4) * zoom()];
  const aim = (): Point => [W / 2 + (pointer.x - W / 2) / zoom(), H * 0.4 + (pointer.y - H * 0.4) / zoom()];
  const spray = (x: number, py: number, svx: number, svy: number, life: number) => {
    const [sx, sy] = toScreen(x, py);
    sea.spray(sx, sy, svx * zoom(), svy * zoom(), life);
  };
  const foam = (x: number, py: number, radius: number, amount: number) => {
    const [sx, sy] = toScreen(x, py);
    sea.foam(sx, sy, radius * zoom(), amount);
  };

  // Paddling for the swell, just right of the peak and high on it, carried up as it rises.
  const paddle = () => {
    rx = W * 0.56;
    const c = lipAt(rx);
    y = c + (trough - c) * 0.14;
  };

  const reset = () => {
    measure();
    clock = 0;
    upAt = -1;
    swell = 0;
    breaking = 0;
    curl = W * 0.5;
    paddle();
    vx = 0;
    vy = 0;
    travelled = 0;
    // Paddling speed.
    speed = 60 * k;
    score = 0;
    record = false;
    collected = 0;
    inTube = 0;
    deepest = 0;
    air = null;
    cut = -1;
    pose = -1;
    things = [];
    popups = [];
    // A few clear seconds to get the feel of it before the first surfer shows up.
    nextThing = W * 1.2;
    nextShells = W * 0.5;
    nextGull = 2;
  };

  const takeOff = () => {
    mode = 'play';
    upAt = clock;
    dropFrom = y;
    vx = 0;
    vy = 0;
  };

  // The take off: up on the board, straight down the face, faster and faster, then a bottom turn that
  // throws a fan of spray and sets off along the wave to the right.
  const dropIn = (dt: number, since: number) => {
    const c = lipAt(rx);
    const bottom = c + (trough - c) * 0.82;
    if (since < DROP) {
      const u = clamp((since - POP * 0.5) / (DROP - POP * 0.5), 0, 1);
      const next = dropFrom + (bottom - dropFrom) * u * u;
      vy = (next - y) / Math.max(dt, 0.001);
      y = next;
      speed = pace() * (0.3 + 0.5 * u);
      if (u > 0.2) spray(rx + (Math.random() - 0.5) * 10 * k, y - 14 * k, (Math.random() - 0.5) * 60, -(40 + Math.random() * 80) * k, 0.4);
    } else {
      const u = (since - DROP) / TURN;
      vx = pace() * 1.1 * smooth(u);
      rx += vx * dt;
      y = bottom - (bottom - (c + (trough - c) * 0.6)) * smooth(u);
      vy = 0;
      speed = pace() * (0.8 + 0.2 * u);
      for (let i = 0; i < 3; i++) spray(rx - 6 * k, y + 2 * k, -(80 + Math.random() * 120) * k, -(120 + Math.random() * 220) * k, 0.5);
    }
    travelled += speed * dt;
    score += (speed * dt) / (30 * k);
  };

  const popup = (text: string, px = rx, py = y - 48 * k) => popups.push({ text, x: px, y: py, age: 0 });

  // A click while riding: a cutback on the open face; in the tube, hands in the air near the mouth, or
  // a tuck further back.
  const trick = () => {
    if (mode !== 'play' || air || clock - upAt < DROP + TURN || cut >= 0 || pose >= 0) return;
    const s = depth(rx);
    if (s > 0 && s < 1 && breaking > 0.5) {
      pose = 0;
      tuck = s > 0.3;
    } else {
      cut = 0;
    }
  };

  const wipe = () => {
    mode = 'over';
    overAt = clock;
    record = Math.round(score) > best;
    best = Math.max(best, Math.round(score));
    air = null;
    inTube = 0;
    cut = -1;
    pose = -1;
    const [sx, sy] = toScreen(rx, y);
    sea.crash(sx, sy, 0.7);
    // Left the picture during the ride: the wipeout screen waits only so long.
    if (awayFrom > 0) awayFrom = performance.now();
  };

  const spawn = (kind: Kind, x = W + 30 * k, at?: number) => {
    things.push({
      kind,
      x,
      y: kind === 'rock' ? trough - (2 + Math.random() * 10) * k : lip - (60 + Math.random() * 90) * k,
      at: at ?? (kind === 'sitter' ? 0.5 + Math.random() * 0.4 : 0.35 + Math.random() * 0.5),
      r: (kind === 'rock' ? 14 + Math.random() * 12 : 9) * k,
      phase: Math.random() * 6,
      board: BOARDS[Math.floor(Math.random() * BOARDS.length)],
      shape: Array.from({ length: 11 }, () => 0.6 + Math.random() * 0.4),
      wait: kind === 'paddler' && Math.random() < 0.5 ? 0.8 + Math.random() * 1.6 : Infinity,
      pop: kind === 'rider' ? 1 : 0,
      v: pace() * (0.55 + Math.random() * 0.25),
    });
  };

  // A string of shells: an arc over the lip to catch in the air, a zig-zag down the face, or a low
  // line that drifts into the tube.
  const spawnShells = () => {
    const r = Math.random();
    const n = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      if (r < 0.35) spawn('shell', W + (30 + i * 28) * k, -0.05 - 0.17 * Math.sin(Math.PI * u));
      else if (r < 0.7) spawn('shell', W + (30 + i * 44) * k, 0.28 + 0.34 * (i % 2));
      else spawn('shell', W + (30 + i * 34) * k, 0.78);
    }
  };

  const land = (a: Air) => {
    const height = (y - a.peak) / k;
    let points = 100 + Math.round(height * 2);
    const tricks: string[] = [];
    if (a.grab > 0.12) {
      points += 250;
      tricks.push(copy.grab);
    }
    if (a.spin) {
      points += 600;
      tricks.push(a.spin > 0 ? copy.frontside : copy.backside);
    }
    if (tricks.length === 2) points = Math.round(points * 1.5);
    score += points;
    popup(`+${points} ${tricks.length ? tricks.join(' + ') : copy.air}`);
  };

  const ride = (dt: number) => {
    const g = gravity();
    const [ax, ay] = aim();
    const since = clock - upAt;
    if (since < DROP + TURN) return dropIn(dt, since);
    if (cut >= 0 && (cut += dt) >= CUT) {
      cut = -1;
      score += 150;
      popup(`+150 ${copy.cutback}`);
    }
    if (pose >= 0 && (pose += dt) >= POSE) pose = -1;
    // The surfer follows the cursor along the wave, back and forth, with less grip in the air;
    // control eases in after the bottom turn. Not quite to the right edge, so whoever is paddling out
    // is seen coming. A cutback carves back towards the curl first, as far as its shoulder, then
    // swings round down the line.
    const grip = (air ? 0.25 : 1) * Math.min(1, (since - DROP - TURN) / 0.6);
    const back = clamp((curl + 60 * k - rx) * 6, -420 * k, 0);
    const wantX = cut >= 0 ? (cut < CUT * 0.55 ? back : 260 * k) : clamp((clamp(ax, 10 * k, W * 0.9) - rx) * 6, -900 * k, 900 * k);
    vx += (wantX - vx) * Math.min(1, dt * 8 * grip);
    rx = Math.max(10 * k, rx + vx * dt);
    // Further right is faster, further left slower and deeper in the tube.
    const ahead = clamp((rx - curl) / (W * 0.45), -0.5, 1);
    speed += (pace() * (0.85 + 0.75 * ahead) + Math.max(0, vx) * 0.25 - speed) * Math.min(1, dt * 2.2);
    // Once the tube has formed it peels along the wave: hang back and it slowly comes for you, taking
    // more of the picture, faster the further back you are; ride far enough right and it falls behind,
    // so there is always a way out. Sit in it long enough and it closes on you.
    curl = clamp(curl + pace() * (0.7 - rx / W) * dt * step(0.35, 0.8, breaking), W * 0.35, W + reach);

    if (air) {
      air.t += dt;
      air.vy += g * dt;
      y += air.vy * dt;
      air.peak = Math.min(air.peak, y);
      if (air.grabbing) air.grab += dt;
      const top = topAt(rx);
      // Once airborne, the pointer picks the spin: further up frontside, back down backside.
      if (!air.spin && Math.abs(ay - air.from) > 30 * k) {
        air.spin = ay < air.from ? 1 : -1;
        air.spinFrom = air.t;
        // Timed to finish before touching down: every air lands.
        const left = air.vy < 0 ? (2 * -air.vy) / g : (top - y) / Math.max(air.vy, 1);
        air.spinDur = Math.max(0.3, left * 0.85);
      }
      if (air.vy > 0 && y >= top) {
        land(air);
        y = top;
        vy = air.vy * 0.35;
        air = null;
      }
    } else {
      const top = topAt(rx);
      // The pointer may go above the crest: that is how you ask for air. A cutback turns at the top of
      // the face and comes back down to the middle.
      const target = cut >= 0 ? (cut < CUT * 0.45 ? top + 16 * k : lipAt(rx) + (trough - lipAt(rx)) * 0.55) : clamp(ay, crest() - 160 * k, trough);
      const want = clamp((target - y) * 7, -760 * k, 760 * k);
      vy += (want - vy) * Math.min(1, dt * 10);
      const next = y + vy * dt;
      if (next < top) {
        if (cut < 0 && rx > curl && vy < -260 * k && speed > 200 * k) {
          // The faster you hit the lip, the higher you fly.
          const lift = (220 + (speed / k) * 0.7) * k;
          air = { vy: -lift, t: 0, from: ay, peak: top, spin: 0, spinFrom: 0, spinDur: 1, grab: 0, grabbing: false };
        } else {
          vy = 0;
        }
        y = top;
      } else {
        y = Math.min(next, trough);
      }
      // Rail spray when carving hard.
      const carve = Math.abs(vy) / (760 * k);
      for (let i = 0; i < Math.floor(carve * 4); i++) {
        spray(rx - 12 * k, y + 2 * k, -speed * 0.6 + Math.random() * 40, -(60 + Math.random() * 180) * carve * k, 0.35 + Math.random() * 0.3);
      }
      // The fan thrown off the tail as the board comes round in a cutback.
      if (cut > CUT * 0.15 && cut < CUT * 0.5) {
        for (let i = 0; i < 5; i++) spray(rx + 6 * k, y, (40 + Math.random() * 260) * k, -(180 + Math.random() * 320) * k, 0.45 + Math.random() * 0.4);
      }
    }

    travelled += speed * dt;
    score += (speed * dt) / (30 * k);
    const s = depth(rx);
    if (!air && s > 0 && s < 1 && breaking > 0.5) {
      inTube += dt;
      deepest = Math.max(deepest, s);
    } else if (inTube > 0) {
      if (inTube > 0.35) {
        const points = Math.round(inTube * 400 * (1 + deepest));
        score += points;
        popup(`+${points} ${copy.tube}`);
      }
      inTube = 0;
      deepest = 0;
    }

    nextThing -= speed * dt;
    if (nextThing <= 0) {
      const r = Math.random();
      spawn(travelled < 1500 * k ? (r < 0.5 ? 'sitter' : 'paddler') : r < 0.25 ? 'sitter' : r < 0.5 ? 'paddler' : r < 0.7 ? 'rider' : 'rock');
      nextThing = (320 + Math.random() * 420) * k * clamp(1 - travelled / (40000 * k), 0.5, 1);
    }
    nextShells -= speed * dt;
    if (nextShells <= 0) {
      spawnShells();
      nextShells = (700 + Math.random() * 700) * k;
    }
    nextGull -= dt;
    if (nextGull <= 0) {
      spawn('gull');
      nextGull = 3 + Math.random() * 4;
    }
    things = things.filter((t) => {
      t.phase += dt;
      // Some of those paddling out catch the wave too: they pop up and ride it.
      if (t.kind === 'paddler' && (t.wait -= dt) <= 0) {
        t.pop = Math.min(1, t.pop + dt / POP);
        if (t.pop === 1) t.kind = 'rider';
      }
      const own = t.kind === 'gull' ? -50 * k : t.kind === 'paddler' ? 45 * k + (t.v - 45 * k) * t.pop : t.kind === 'rider' ? t.v : 0;
      t.x -= (speed - own) * dt;
      if (t.kind === 'rock' || t.kind === 'gull') {
        // The whitewater bursts on the rocks.
        if (t.kind === 'rock' && depth(t.x) > 0.9 && Math.random() < dt * 8) {
          spray(t.x + (Math.random() - 0.5) * t.r * 2, t.y - t.r * 0.5, (Math.random() - 0.3) * 120, -(140 + Math.random() * 200) * k, 0.6 + Math.random() * 0.4);
        }
        return t.x > -60 * k;
      }
      const c = lipAt(t.x);
      // Riders carve up and down the face.
      const at = t.kind === 'sitter' || t.kind === 'shell' ? t.at : t.at + (0.42 + 0.26 * Math.sin(1.7 * t.phase) - t.at) * t.pop;
      t.y = c + (trough - c) * at;
      if (t.kind === 'shell') return !caught(t.x, t.y) && t.x > -60 * k;
      // Caught inside by the falling lip: washed away.
      if (depth(t.x) > 0.3) {
        for (let i = 0; i < 8; i++) spray(t.x, t.y, (Math.random() - 0.5) * 140, -(80 + Math.random() * 140) * k, 0.5);
        return false;
      }
      return t.x > -60 * k;
    });
    things = things.filter((t) => {
      if (t.kind !== 'shell' || Math.hypot(t.x - rx, t.y - (y - 12 * k)) > 20 * k) return true;
      collected++;
      score += 100;
      popup('+100', t.x, t.y - 16 * k);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        spray(t.x, t.y, Math.cos(a) * 120 * k, Math.sin(a) * 120 * k - 60 * k, 0.35 + Math.random() * 0.25);
      }
      return false;
    });
    if (!air && caught(rx, y)) return wipe();
    if (air) return;
    for (const t of things) {
      const hit =
        t.kind === 'rock'
          ? Math.hypot((t.x - rx) / 1.3, t.y - t.r * 0.3 - y) < t.r * 0.75 + 6 * k
          : (t.kind === 'sitter' || t.kind === 'paddler' || t.kind === 'rider') && Math.hypot(t.x - rx, t.y - 4 * k - y) < 18 * k;
      if (hit) return wipe();
    }
  };

  // The breaking part of the wave: churn and spray where the lip lands, spray off the crest.
  const breakers = () => {
    const r = reachNow();
    foam(curl - r * (0.85 + Math.random() * 0.3), trough - Math.random() * 30 * k, 12 * k, 0.25);
    spray(curl - r + Math.random() * 30 * k, trough, (Math.random() - 0.5) * 120, -(140 + Math.random() * 260) * k, 0.5 + Math.random() * 0.5);
    spray(curl + Math.random() * 80 * k, lipAt(curl) - 2, 40 + Math.random() * 60, -(30 + Math.random() * 70) * k, 0.4 + Math.random() * 0.3);
  };

  const begin = () => {
    reset();
    origin.x = pointer.x;
    origin.y = pointer.y;
    mode = 'in';
    awayFrom = -1;
    sea.setGame(true);
    stage.style.touchAction = 'none';
  };
  const end = () => {
    mode = 'out';
    awayFrom = -1;
    stage.style.touchAction = '';
  };
  const drop = () => {
    mode = 'idle';
    charge = 0;
    morph = 0;
    awayFrom = -1;
    sea.setGame(false);
    sea.setCharge(0);
    sea.setMorph(0, 0, 0);
    stage.style.touchAction = '';
  };

  sea.onFrame((dt, now) => {
    measure();
    if (mode === 'idle') {
      charge = !touch && pointer.inside ? Math.min(1, charge + dt / CHARGE) : Math.max(0, charge - dt * 0.8);
      sea.setCharge(smooth(charge));
      if (charge < 1) return;
      begin();
    }
    if (mode !== 'play' && mode !== 'out' && awayFrom > 0 && now - awayFrom > LEAVE) end();
    if (mode === 'in') {
      morph = Math.min(1, morph + dt / MORPH_IN);
      // A tap skips the hover, so the colour and the finer lines arrive with the morph instead.
      sea.setCharge(smooth(Math.max(charge, Math.min(1, morph * 2))));
      if (morph === 1) mode = 'paddle';
    } else if (mode === 'out') {
      morph = Math.max(0, morph - dt / MORPH_OUT);
      charge = morph;
      sea.setCharge(smooth(morph));
      if (morph === 0) {
        mode = 'idle';
        sea.setGame(false);
      }
    } else {
      sea.setCharge(1);
      clock += dt;
      swell = Math.min(1, swell + dt / SWELL);
      if (mode === 'paddle') paddle();
      else breaking = Math.min(1, breaking + dt / BREAK);
      if (mode === 'play') ride(dt);
      if (breaking > 0.4) breakers();
    }
    popups = popups.filter((p) => (p.age += dt) < 1.4);
    sea.setMorph(smooth(morph), origin.x, origin.y);
    sea.setWave(crest(), trough, curl, reach, travelled, breaking, zoom());
  });

  const drawSurfer = (ctx: CanvasRenderingContext2D) => {
    const since = upAt < 0 ? -1 : clock - upAt;
    if (since < DROP + TURN && mode !== 'over') {
      // Paddling and dropping in, seen from the front and coming closer; in the bottom turn they
      // swing round side-on.
      const stand = since < 0 ? 0 : clamp(since / POP, 0, 1);
      const u = since < DROP ? 0 : (since - DROP) / TURN;
      const grow = 1 + 0.15 * clamp((since - POP) / (DROP - POP), 0, 1);
      const alpha = ctx.globalAlpha;
      ctx.translate(rx, y);
      ctx.scale(k * grow, k * grow);
      if (u < 1) {
        ctx.globalAlpha = alpha * (1 - u);
        frontRider(ctx, { stand: smooth(stand), time: clock, board: OWN, wake: since > POP ? 1 : 0 });
        if (stand < 1) {
          ctx.globalAlpha *= 1 - stand;
          ripples(ctx, clock, 12);
        }
      }
      if (u > 0) {
        ctx.globalAlpha = alpha * u;
        ctx.scale(Math.max(0.15, u), 1);
        rider(ctx, { stand: 1, crouch: 0.8, lean: 0.1, time: clock, grab: false, claim: 0, rim: 1, wake: u, board: OWN });
      }
      return;
    }
    let tilt = Math.atan2(vy, Math.max(speed, 1)) * 0.75;
    let crouch = clamp(0.3 + (Math.abs(vy) / (760 * k)) * 0.7, 0, 1);
    let lean = clamp(vy / (760 * k), -1, 1) * 0.3;
    let turn = 1;
    let grab = false;
    let claim = 0;
    let sink = 0;
    const s = depth(rx);
    // In the shade of the tube only a little light reaches the surfer, through the mouth; deeper in,
    // the falling lip hides them altogether.
    let rim = clamp(1 - s * 3, 0.3, 1);
    if (s > 0 && (s < 1 || caught(rx, y))) ctx.globalAlpha *= 1 - step(0.45, 0.88, Math.min(s, 1));
    if (cut >= 0) {
      // The cutback seen from the beach: the board comes round to face the curl, heads back a moment,
      // and comes round again, the surfer compressing through each turn.
      const a = Math.PI * (step(0, 0.4, cut / CUT) + step(0.6, 1, cut / CUT));
      turn = Math.cos(a);
      tilt = tilt * turn + Math.sin(a) * 0.2;
      crouch = Math.max(crouch, 0.9 * Math.abs(Math.sin(a)));
    }
    if (pose >= 0 && !air) {
      const p = step(0, 0.15, pose) * (1 - step(POSE - 0.3, POSE, pose));
      if (tuck) {
        crouch += (1 - crouch) * p;
        lean += (0.3 - lean) * p;
      } else {
        claim = p;
      }
    }
    if (air) {
      tilt = clamp(air.vy / (900 * k), -0.6, 0.6) * 0.6;
      crouch = air.grabbing ? 1 : 0.65;
      lean = 0.15;
      grab = air.grabbing;
      rim = 1;
      if (air.spin) {
        // A 360 seen from the beach: the surfer turns away and back round, leaning into the spin.
        const a = Math.PI * 2 * smooth(clamp((air.t - air.spinFrom) / air.spinDur, 0, 1));
        turn = Math.cos(a);
        tilt += Math.sin(a) * 0.25 * air.spin;
      }
    }
    if (mode === 'over') {
      const t = clock - overAt;
      tilt = t * 9;
      sink = t * 40 * k;
      ctx.globalAlpha *= clamp(1 - t / 0.8, 0, 1);
    }
    ctx.translate(rx, y + sink);
    ctx.rotate(tilt);
    // Never quite edge-on, so the board doesn't vanish mid-spin.
    ctx.scale(k * (Math.abs(turn) < 0.06 ? (turn < 0 ? -0.06 : 0.06) : turn), k);
    rider(ctx, { stand: 1, crouch, lean, time: clock, grab, claim, rim, wake: !air && mode === 'play' ? 1 : 0, board: OWN });
  };

  const drawSurfers = (ctx: CanvasRenderingContext2D, t: Thing) => {
    const s = t.phase;
    if (t.kind === 'sitter') {
      // Sitting on the board, legs down in the water, swaying and turning to watch the sets.
      ctx.translate(t.x, t.y + Math.sin(s * 2.2) * 1.5 * k);
      ctx.rotate(Math.sin(s * 1.7) * 0.04);
      ctx.scale(k, k);
      const sway = Math.sin(s * 1.3) * 0.15;
      const hip: Point = [-3, -2.2];
      const shoulder: Point = [hip[0] + Math.sin(sway) * 12, hip[1] - Math.cos(sway) * 12];
      // Shins seen dimly through the water.
      const alpha = ctx.globalAlpha;
      ctx.globalAlpha = alpha * 0.35;
      ctx.strokeStyle = SUIT;
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(4, -1.5);
      ctx.lineTo(5 + Math.sin(s * 3) * 1.2, 8);
      ctx.moveTo(2, -1.5);
      ctx.lineTo(1.5 + Math.sin(s * 3 + 1) * 1.2, 8);
      ctx.stroke();
      ctx.globalAlpha = alpha;
      floatingBoard(ctx, t.board[0]);
      body(
        ctx,
        [
          [hip[0], hip[1], 4.5, -2.2, 4.4],
          [hip[0], hip[1], shoulder[0], shoulder[1], 6.4],
          [shoulder[0], shoulder[1], shoulder[0] + 3, shoulder[1] + 5.5, 2.8],
          [shoulder[0] + 3, shoulder[1] + 5.5, 5, -3.2, 2.3],
        ],
        [shoulder[0] + 1 + Math.sin(s * 0.7) * 0.8, shoulder[1] - 4.6, 3.2],
        1,
      );
      ripples(ctx, s, 16);
      return;
    }
    // Paddling out, prone, or up and carving the face, tilted with the climb.
    const climb = (trough - lipAt(t.x)) * 0.26 * 1.7 * Math.cos(1.7 * s) * t.pop;
    ctx.translate(t.x, t.y + (1 - t.pop) * Math.sin(s * 2) * k);
    ctx.rotate(Math.atan2(climb, Math.max(t.v, 1)) * 0.75 * t.pop);
    ctx.scale(k, k);
    rider(ctx, {
      stand: smooth(t.pop),
      crouch: clamp(0.3 + (Math.abs(climb) / (760 * k)) * 0.7, 0, 1),
      lean: clamp(climb / (760 * k), -1, 1) * 0.3,
      time: s,
      grab: false,
      claim: 0,
      rim: 1,
      wake: t.pop,
      board: t.board,
    });
    if (t.pop < 1) {
      ctx.globalAlpha *= 1 - t.pop;
      ripples(ctx, s, 18);
    }
  };

  const text = (ctx: CanvasRenderingContext2D, s: string, px: number, py: number, font: string, color: string, align: CanvasTextAlign) => {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(s, px, py);
  };
  // "× N" with a shell in front, right-aligned at px.
  const haul = (ctx: CanvasRenderingContext2D, px: number, py: number, font: string, color: string) => {
    const s = `× ${collected}`;
    text(ctx, s, px, py, font, color, 'right');
    ctx.save();
    ctx.translate(px - ctx.measureText(s).width - 10 * k, py - 4 * k);
    ctx.scale(0.7 * k, 0.7 * k);
    drawShell(ctx, 0);
    ctx.restore();
  };

  // Game over, arcade style: a white flash as the lip comes down, the word dropping in letter by
  // letter, extruded and bouncing, then the scores on a panel.
  const banner = (ctx: CanvasRenderingContext2D, t: number) => {
    const base = ctx.globalAlpha;
    if (t < 0.3) {
      ctx.fillStyle = `rgba(255, 255, 255, ${(0.55 * (1 - t / 0.3)).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    const word = [...copy.wipeout.toUpperCase()];
    const size = Math.round(Math.min(64 * k, (W * 0.84) / (word.length * 0.66)));
    ctx.font = `700 ${size}px ${DISPLAY}`;
    ctx.textAlign = 'left';
    const widths = word.map((ch) => ctx.measureText(ch).width);
    const baseY = H * 0.38;
    const extrude = Math.max(3, Math.round(size / 10));
    let x = W / 2 - widths.reduce((a, b) => a + b, 0) / 2;
    word.forEach((ch, i) => {
      const u = clamp((t - i * 0.05) / 0.7, 0, 1);
      if (u > 0) {
        const fall = 1 - Math.cos(3 * Math.PI * u) * Math.exp(-5 * u);
        ctx.save();
        ctx.translate(x, baseY - (1 - fall) * H * 0.35 + Math.sin(clock * 3 + i * 0.7) * 2 * k * u);
        ctx.transform(1, 0, -0.16, 1, 0, 0);
        ctx.lineWidth = 6 * k;
        ctx.strokeStyle = '#140a24';
        ctx.strokeText(ch, extrude * 0.6, extrude);
        for (let d = extrude; d >= 1; d--) {
          ctx.fillStyle = d > extrude / 2 ? '#2c1450' : '#6a32b8';
          ctx.fillText(ch, d * 0.6, d);
        }
        ctx.strokeText(ch, 0, 0);
        const g = ctx.createLinearGradient(0, -size * 0.75, 0, 0);
        g.addColorStop(0, '#fffbd0');
        g.addColorStop(0.5, SIGNAL);
        g.addColorStop(1, '#f09a00');
        ctx.fillStyle = g;
        ctx.fillText(ch, 0, 0);
        ctx.restore();
      }
      x += widths[i];
    });

    const p = clamp((t - 0.9) / 0.3, 0, 1);
    if (p <= 0) return;
    ctx.globalAlpha = base * p;
    const pw = Math.min(280 * k, W - 32);
    const ph = 84 * k;
    const px = W / 2 - pw / 2;
    const py = baseY + 34 * k + (1 - p) * 10 * k;
    const cut = 14 * k;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + pw - cut, py);
    ctx.lineTo(px + pw, py + cut);
    ctx.lineTo(px + pw, py + ph);
    ctx.lineTo(px, py + ph);
    ctx.closePath();
    ctx.fillStyle = 'rgba(11, 12, 16, 0.86)';
    ctx.fill();
    ctx.strokeStyle = SIGNAL;
    ctx.lineWidth = 1;
    ctx.stroke();
    const small = `12px ${MONO}`;
    const value = `600 ${Math.round(16 * k)}px ${DISPLAY}`;
    const rows: [string, string][] = [
      [copy.score, String(Math.round(score))],
      [copy.best, String(best)],
    ];
    rows.forEach(([label, v], i) => {
      text(ctx, label.toUpperCase(), px + 14, py + (24 + i * 24) * k, small, MUTE, 'left');
      text(ctx, v, px + pw - 14, py + (24 + i * 24) * k, value, PAPER, 'right');
    });
    text(ctx, copy.shells.toUpperCase(), px + 14, py + 72 * k, small, MUTE, 'left');
    haul(ctx, px + pw - 14, py + 72 * k, value, PAPER);
    let ty = py + ph + 28 * k;
    if (record) {
      ctx.globalAlpha = base * p * (0.6 + 0.4 * Math.sin(clock * 7));
      text(ctx, copy.newBest.toUpperCase(), W / 2, ty, `700 ${Math.round(16 * k)}px ${DISPLAY}`, '#b98cff', 'center');
      ty += 24 * k;
    }
    ctx.globalAlpha = base * p * (0.6 + 0.4 * Math.sin(clock * 4));
    text(ctx, touch ? copy.retryTouch : copy.retry, W / 2, ty, small, SIGNAL, 'center');
  };

  sea.onDraw((ctx) => {
    if (mode === 'idle') {
      // The charge bar along the bottom edge.
      if (charge > 0.02) {
        ctx.fillStyle = SIGNAL;
        ctx.fillRect(0, H - 2, W * charge, 2);
      }
      return;
    }
    const a = clamp((morph - 0.55) / 0.45, 0, 1);
    if (a <= 0) return;
    const over = mode === 'over' ? clock - overAt : -1;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.textBaseline = 'alphabetic';
    ctx.save();
    // The lip coming down shakes everything on the water.
    if (over >= 0 && over < 0.4) {
      const j = (1 - over / 0.4) * 6 * k;
      ctx.translate((Math.random() - 0.5) * j, (Math.random() - 0.5) * j);
    }
    // While you paddle in, the water and everything on it come towards you.
    const z = zoom();
    ctx.translate(W / 2, H * 0.4);
    ctx.scale(z, z);
    ctx.translate(-W / 2, -H * 0.4);
    for (const t of things) {
      ctx.save();
      if (t.kind === 'rock') drawRock(ctx, t, k);
      else if (t.kind === 'gull') drawGull(ctx, t, k);
      else if (t.kind === 'shell') {
        ctx.translate(t.x, t.y + Math.sin(t.phase * 3) * 2 * k);
        ctx.scale(k, k);
        ctx.rotate(Math.sin(t.phase * 2) * 0.12);
        drawShell(ctx, Math.max(0, Math.sin(t.phase * 2.5)) ** 3);
      } else drawSurfers(ctx, t);
      ctx.restore();
    }
    ctx.save();
    drawSurfer(ctx);
    ctx.restore();
    const small = `12px ${MONO}`;
    for (const p of popups) {
      ctx.globalAlpha = a * (1 - p.age / 1.4);
      text(ctx, p.text.toUpperCase(), p.x, p.y - p.age * 30 * k, small, SIGNAL, 'center');
    }
    ctx.restore();

    ctx.globalAlpha = a;
    const big = `600 ${Math.round(24 * k)}px ${DISPLAY}`;
    text(ctx, copy.score.toUpperCase(), 14, 24, small, MUTE, 'left');
    text(ctx, String(Math.round(score)), 14, 24 + 26 * k, big, PAPER, 'left');
    text(ctx, `${Math.round(speed / k / 12)} ${copy.speed}`, 14, 44 + 30 * k, small, SIGNAL, 'left');
    text(ctx, copy.best.toUpperCase(), W - 14, 24, small, MUTE, 'right');
    text(ctx, String(best), W - 14, 24 + 26 * k, big, PAPER, 'right');
    haul(ctx, W - 14, 44 + 30 * k, small, SIGNAL);
    if (inTube > 0) text(ctx, `${copy.tube.toUpperCase()} ${inTube.toFixed(1)}s`, W / 2, 24, small, SIGNAL, 'center');
    if (mode === 'paddle') {
      ctx.globalAlpha = a * (0.55 + 0.45 * Math.sin(clock * 5));
      text(ctx, (touch ? copy.takeoffTouch : copy.takeoff).toUpperCase(), W / 2, H * 0.22, `600 ${Math.round(18 * k)}px ${DISPLAY}`, SIGNAL, 'center');
      ctx.globalAlpha = a;
    }
    if (over >= 0) banner(ctx, over);
    ctx.restore();
  });

  const locate = (e: PointerEvent) => {
    const r = stage.getBoundingClientRect();
    pointer.x = e.clientX - r.left;
    pointer.y = e.clientY - r.top;
  };
  stage.addEventListener('pointermove', (e) => {
    locate(e);
    pointer.inside = true;
    awayFrom = -1;
  });
  stage.addEventListener('pointerleave', (e) => {
    pointer.inside = false;
    if (e.pointerType === 'mouse' && mode !== 'idle' && mode !== 'out') awayFrom = performance.now();
  });
  stage.addEventListener('pointerdown', (e) => {
    touch = e.pointerType !== 'mouse';
    locate(e);
    if (e.button !== 0) return;
    if (mode === 'paddle') takeOff();
    // Left button (or a finger) in the air grabs the rail for as long as it is held.
    else if (air) air.grabbing = true;
    else if (!touch) trick();
  });
  stage.addEventListener('pointerup', () => {
    if (air) air.grabbing = false;
  });
  // A tap starts the game on touch screens, where there is no hovering; a click or tap restarts it
  // from the paddle out.
  stage.addEventListener('click', () => {
    if (mode === 'idle' && touch) begin();
    else if (mode === 'over' && clock - overAt > 0.9) {
      reset();
      mode = 'paddle';
    }
    // The finger steers, so on touch screens the tricks take a tap, not every touch.
    else if (touch) trick();
  });
  new IntersectionObserver(([e]) => {
    if (!e.isIntersecting && mode !== 'idle') drop();
  }).observe(stage);
}
