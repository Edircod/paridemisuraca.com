// Generates the synthetic seabed contours behind the hero, straight from a float field (no 8-bit banding).
// Usage: node scripts/seabed.mjs <out.json> [width=480] [height=300] [levels=16] [seed=7]
import { writeFileSync } from 'node:fs';
import { buildContours } from './lib/isolines.mjs';

const [out, W = 480, H = 300, L = 16, seed = 7] = process.argv.slice(2);
const width = Number(W), height = Number(H), s = Number(seed);
const field = new Float32Array(width * height);
const alpha = new Float32Array(width * height).fill(1);
let min = Infinity, max = -Infinity;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height;
    // Depth grows towards the open sea on the right, broken by a few long swells and ridges.
    let f = u * 0.55;
    f += 0.16 * Math.sin(v * 6.1 + s + Math.sin(u * 3.3 + s) * 1.4);
    f += 0.09 * Math.sin(u * 9.7 - v * 4.2 + s * 1.7);
    f += 0.05 * Math.sin(u * 21.0 + v * 13.0 + s * 0.3);
    f += 0.03 * Math.sin(v * 37.0 - u * 17.0 + s);
    field[y * width + x] = f;
    min = Math.min(min, f);
    max = Math.max(max, f);
  }
}
for (let i = 0; i < field.length; i++) field[i] = (field[i] - min) / (max - min);

const data = buildContours({ width, height, field, alpha, levels: Number(L) });
writeFileSync(out, JSON.stringify(data));
console.log(`seabed ${width}x${height} lines=${data.lines.length} bytes=${JSON.stringify(data).length}`);
