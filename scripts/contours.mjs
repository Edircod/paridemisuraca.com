// Turns a photo into isolines of its luminance: the only form in which photos of Paride reach the site.
// Usage: node scripts/contours.mjs <image> <out.json> [--width 360] [--levels 22] [--blur 1.6] [--mask alpha|none]
// Output: { w, h, q, levels: [t...], lines: [[levelIndex, x0, y0, x1, y1, ...]], outline: [[x0, y0, ...]] }
// Coordinates are quantised to 0..q on the longer side so the JSON stays small.
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { buildContours } from './lib/isolines.mjs';

const [input, output, ...rest] = process.argv.slice(2);
const opt = { width: 360, levels: 22, blur: 1.6, mask: 'alpha' };
for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, '')] = isNaN(rest[i + 1]) ? rest[i + 1] : Number(rest[i + 1]);

const { data, info } = await sharp(input).resize({ width: opt.width }).ensureAlpha().blur(opt.blur).raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const N = width * height;
const lum = new Float32Array(N);
const alpha = new Float32Array(N);
for (let i = 0; i < N; i++) {
  lum[i] = (0.2126 * data[i * channels] + 0.7152 * data[i * channels + 1] + 0.0722 * data[i * channels + 2]) / 255;
  alpha[i] = opt.mask === 'alpha' ? data[i * channels + 3] / 255 : 1;
}

// Histogram-equalise inside the subject so levels spread evenly across face, hair and clothes.
const inside = [];
for (let i = 0; i < N; i++) if (alpha[i] > 0.5) inside.push(lum[i]);
const sorted = Float32Array.from(inside).sort();
const rank = (v) => {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; sorted[m] < v ? (lo = m + 1) : (hi = m); }
  return lo / sorted.length;
};
const field = new Float32Array(N);
for (let i = 0; i < N; i++) field[i] = alpha[i] > 0.5 ? rank(lum[i]) : 0;

const out = buildContours({ width, height, field, alpha, levels: opt.levels, outline: opt.mask === 'alpha' });
writeFileSync(output, JSON.stringify(out));
const pts = out.lines.reduce((s, l) => s + (l.length - 1) / 2, 0);
console.log(`${width}x${height} levels=${opt.levels} lines=${out.lines.length} points=${pts} bytes=${JSON.stringify(out).length}`);
