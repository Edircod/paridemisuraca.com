// Reduces the personal photos to intensity grids (levels 0-9, one character per cell).
// Lines and glyphs are drawn from these grids at runtime; the photos themselves never ship.
// Usage: node scripts/fields.mjs [previewDir]
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const previewDir = process.argv[2];

const presets = {
  // Glyph portrait: cells are 0.6 wide by 1 tall, so a square crop needs rows = cols * 0.6.
  about: {
    file: 'assets-src/photos/bw.jpeg',
    crop: { left: 0, top: 0, width: 576, height: 576 },
    grid: [168, 101],
    work: 3,
    mix: [0.12, 0.8, 0.3],
    mask: 'poly',
    poly: [
      [95, 105], [130, 60], [190, 15], [260, 5], [310, 40], [330, 80], [355, 130], [355, 150], [345, 185], [335, 210],
      [360, 240], [420, 255], [500, 280], [540, 320], [548, 380], [540, 430], [520, 470], [500, 520], [470, 576],
      [60, 576], [55, 520], [80, 460], [95, 420], [100, 370], [115, 320], [150, 290], [200, 270], [230, 265],
      [215, 240], [180, 200], [165, 165], [150, 140], [140, 125], [110, 120],
    ],
  },
  surf: {
    file: 'assets-src/photos/surf.png',
    crop: { left: 290, top: 215, width: 720, height: 670 },
    grid: [288, 268],
    work: 2,
    mix: [0.18, 0.7, 0.35],
    mask: 'key',
  },
  // The same shot cut tall for phones: the whole height of the photo, from the hand to the board.
  'surf-tall': {
    file: 'assets-src/photos/surf.png',
    crop: { left: 353, top: 0, width: 550, height: 940 },
    grid: [220, 376],
    work: 2,
    mix: [0.18, 0.7, 0.35],
    mask: 'key',
  },
  guitar: {
    file: 'assets-src/photos/guitar.jpg',
    crop: { left: 270, top: 205, width: 520, height: 826 },
    grid: [208, 330],
    work: 2,
    mix: [0.12, 0.8, 0.3],
    mask: 'poly',
    poly: [
      [440, 226], [505, 232], [535, 265], [540, 305], [528, 350], [522, 398], [580, 415], [640, 445], [658, 500],
      [652, 540], [700, 520], [735, 470], [762, 488], [745, 530], [655, 610], [628, 660], [622, 800], [626, 1031],
      [360, 1031], [360, 955], [318, 945], [302, 880], [300, 790], [298, 700], [310, 600], [325, 520], [332, 460],
      [380, 425], [418, 395], [402, 345], [392, 290], [395, 255],
    ],
  },
};

const blur = (src, w, h, r) => {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < w) (s += src[y * w + xx]), n++;
      }
      tmp[y * w + x] = s / n;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < h) (s += tmp[yy * w + x]), n++;
      }
      out[y * w + x] = s / n;
    }
  return out;
};

const inPoly = (x, y, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

for (const [name, p] of Object.entries(presets)) {
  const [gw, gh] = p.grid;
  const WORK = p.work;
  const w = gw * WORK, h = gh * WORK, N = w * h;
  const { data, info } = await sharp(p.file).extract(p.crop).removeAlpha().resize(w, h, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const c = info.channels;
  const lum = new Float32Array(N), sat = new Float32Array(N), hue = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = data[i * c] / 255, g = data[i * c + 1] / 255, b = data[i * c + 2] / 255;
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sat[i] = mx ? (mx - mn) / mx : 0;
    const d = mx - mn || 1;
    hue[i] = (mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
    if (hue[i] < 0) hue[i] += 360;
  }

  let mask = new Float32Array(N);
  if (p.mask === 'key') {
    // Dark wetsuit and hair, plus the saturated warm board and sleeves; sea, sky and sand fall away.
    for (let i = 0; i < N; i++) {
      const sleeve = (hue[i] > 330 || hue[i] < 45) && sat[i] > 0.4;
      const board = hue[i] > 22 && hue[i] < 55 && sat[i] > 0.12 && lum[i] > 0.6;
      mask[i] = lum[i] < 0.42 || sleeve || board ? 1 : 0;
    }
  } else {
    for (let i = 0; i < N; i++) {
      const x = p.crop.left + ((i % w) + 0.5) * (p.crop.width / w);
      const y = p.crop.top + (((i / w) | 0) + 0.5) * (p.crop.height / h);
      mask[i] = inPoly(x, y, p.poly) ? 1 : 0;
    }
  }
  mask = blur(mask, w, h, WORK);

  // Equalise luminance inside the subject, then add a little edge so features stay crisp.
  const inside = [];
  for (let i = 0; i < N; i++) if (mask[i] > 0.5) inside.push(lum[i]);
  const sorted = Float32Array.from(inside).sort();
  const rank = (v) => {
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const m = (lo + hi) >> 1; sorted[m] < v ? (lo = m + 1) : (hi = m); }
    return lo / sorted.length;
  };
  const sl = blur(lum, w, h, 1);
  const field = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = i % w, y = (i / w) | 0;
    const gx = x > 0 && x < w - 1 ? sl[i + 1] - sl[i - 1] : 0;
    const gy = y > 0 && y < h - 1 ? sl[i + w] - sl[i - w] : 0;
    const edge = Math.min(1, Math.hypot(gx, gy) * 7);
    const tone = name.startsWith('surf') ? 0.4 + 0.6 * (1 - rank(lum[i])) : rank(lum[i]);
    field[i] = mask[i] * Math.min(1, p.mix[0] + p.mix[1] * tone + p.mix[2] * edge);
  }

  const rows = [];
  const preview = Buffer.alloc(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    let row = '';
    for (let gx = 0; gx < gw; gx++) {
      let s = 0;
      for (let yy = 0; yy < WORK; yy++) for (let xx = 0; xx < WORK; xx++) s += field[(gy * WORK + yy) * w + gx * WORK + xx];
      const v = Math.min(9, Math.round((s / (WORK * WORK)) * 9));
      row += v;
      preview[gy * gw + gx] = v * 28;
    }
    rows.push(row);
  }
  const out = { w: gw, h: gh, rows };
  writeFileSync(`public/data/${name}.json`, JSON.stringify(out));
  if (previewDir) await sharp(preview, { raw: { width: gw, height: gh, channels: 1 } }).resize(gw * 4, gh * 4, { kernel: 'nearest' }).png().toFile(`${previewDir}/${name}.png`);
  console.log(`${name}: ${gw}x${gh} bytes=${JSON.stringify(out).length}`);
}
