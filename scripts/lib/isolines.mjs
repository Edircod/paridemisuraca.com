// Marching-squares isolines over a scalar field, joined into polylines and simplified.
// Shared by contours.mjs (photos) and seabed.mjs (synthetic fields).

export function buildContours({ width, height, field, alpha, levels, outline = false }) {
  function isolines(f, t, clip) {
    const segs = [];
    const v = (x, y) => f[y * width + x];
    const k = (a, b) => (t - a) / (b - a);
    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        if (clip && (alpha[y * width + x] <= 0.5 || alpha[y * width + x + 1] <= 0.5 || alpha[(y + 1) * width + x] <= 0.5 || alpha[(y + 1) * width + x + 1] <= 0.5)) continue;
        const v0 = v(x, y), v1 = v(x + 1, y), v2 = v(x + 1, y + 1), v3 = v(x, y + 1);
        const c = (v0 > t ? 8 : 0) | (v1 > t ? 4 : 0) | (v2 > t ? 2 : 0) | (v3 > t ? 1 : 0);
        if (c === 0 || c === 15) continue;
        const top = [x + k(v0, v1), y], right = [x + 1, y + k(v1, v2)];
        const bottom = [x + k(v3, v2), y + 1], left = [x, y + k(v0, v3)];
        const table = {
          1: [[left, bottom]], 2: [[bottom, right]], 3: [[left, right]], 4: [[top, right]],
          5: [[left, top], [bottom, right]], 6: [[top, bottom]], 7: [[left, top]], 8: [[left, top]],
          9: [[top, bottom]], 10: [[left, bottom], [top, right]], 11: [[top, right]], 12: [[left, right]],
          13: [[bottom, right]], 14: [[left, bottom]],
        };
        segs.push(...table[c]);
      }
    }
    return join(segs);
  }

  function join(segs) {
    const key = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
    const ends = new Map();
    segs.forEach((s, i) => s.forEach((p) => {
      const kk = key(p);
      if (!ends.has(kk)) ends.set(kk, []);
      ends.get(kk).push(i);
    }));
    const used = new Uint8Array(segs.length);
    const lines = [];
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const line = [segs[i][0], segs[i][1]];
      for (const forward of [true, false]) {
        for (;;) {
          const end = forward ? line[line.length - 1] : line[0];
          const next = (ends.get(key(end)) || []).find((j) => !used[j]);
          if (next === undefined) break;
          used[next] = 1;
          const [a, b] = segs[next];
          const p = key(a) === key(end) ? b : a;
          forward ? line.push(p) : line.unshift(p);
        }
      }
      if (line.length > 6) lines.push(simplify(line, 0.35));
    }
    return lines;
  }

  function simplify(pts, eps) {
    if (pts.length < 3) return pts;
    const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    let max = 0, idx = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (max <= eps) return [pts[0], pts[pts.length - 1]];
    return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
  }


  const Q = 4095;
  const scale = Q / Math.max(width, height);
  const flat = (ln) => ln.flatMap(([x, y]) => [Math.round(x * scale), Math.round(y * scale)]);
  const out = { w: width, h: height, q: Q, levels: [], lines: [], outline: [] };
  for (let l = 1; l <= levels; l++) {
    const t = l / (levels + 1);
    out.levels.push(+t.toFixed(3));
    for (const ln of isolines(field, t, true)) out.lines.push([l - 1, ...flat(ln)]);
  }
  if (outline) out.outline = isolines(alpha, 0.5, false).map(flat);
  return out;
}
