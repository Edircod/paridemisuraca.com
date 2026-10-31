// Samples the world's land masses into an evenly spaced dot cloud for the About globe.
// Usage: node scripts/globe.mjs  →  public/data/globe.json  ([lat, lon] pairs in tenths of a degree)
import { writeFile } from 'node:fs/promises';

const SOURCE = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json';
const STEP = 2.2;

const topo = await (await fetch(SOURCE)).json();
const { scale, translate } = topo.transform;
const arcs = topo.arcs.map((arc) => {
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => [(x += dx) * scale[0] + translate[0], (y += dy) * scale[1] + translate[1]]);
});
const ring = (ids) =>
  ids.flatMap((id, i) => {
    const pts = id < 0 ? [...arcs[~id]].reverse() : arcs[id];
    return i ? pts.slice(1) : pts;
  });
// Rings that cross the antimeridian (Fiji, Chukotka) are unwrapped into continuous longitudes,
// then tested one turn either side, so the ray cast stays planar.
const unwrap = (r) => {
  let off = 0;
  return r.map(([x, y], i) => {
    if (i) {
      const d = x - r[i - 1][0];
      if (d > 180) off -= 360;
      else if (d < -180) off += 360;
    }
    return [x + off, y];
  });
};
const rings = topo.objects.land.geometries
  .flatMap((g) => (g.type === 'Polygon' ? [g.arcs] : g.arcs))
  .flatMap((poly) => poly.map(ring))
  .map((r) => {
    const wraps = r.some(([x], i) => i && Math.abs(x - r[i - 1][0]) > 180);
    return { wraps, pts: wraps ? unwrap(r) : r };
  });

const contains = (pts, lon, lat) => {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
const inside = (lon, lat) =>
  rings.reduce((hit, r) => hit !== (contains(r.pts, lon, lat) || (r.wraps && (contains(r.pts, lon + 360, lat) || contains(r.pts, lon - 360, lat)))), false);

const dots = [];
for (let lat = -56; lat <= 80; lat += STEP) {
  const step = STEP / Math.cos((lat * Math.PI) / 180);
  for (let lon = -180; lon < 180; lon += step) {
    if (inside(lon, lat)) dots.push(Math.round(lat * 10), Math.round(lon * 10));
  }
}

await writeFile(new URL('../public/data/globe.json', import.meta.url), JSON.stringify(dots));
console.log(`${dots.length / 2} dots`);
