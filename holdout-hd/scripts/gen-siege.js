// Generates the first Anchor Siege map: levels/siege/siege-anchorline.json.
// A 48x48 symmetric arena — two team cores in opposite corners, two lanes that
// ring the map (minions follow the waypoints; players roam freely), eight towers
// placed by interpolating along each lane, and a central shop. Reproducible.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = 48, H = 48;

const grid = [];
for (let y = 0; y < H; y++) {
  const row = [];
  for (let x = 0; x < W; x++) row.push(x === 0 || y === 0 || x === W - 1 || y === H - 1 ? '#' : '.');
  grid.push(row);
}
const set = (x, y, c) => { grid[y][x] = c; };

// cover: standalone pillars for skirmishing — none adjacent to the shop, so
// the shop stays reachable from every direction.
for (const [px, py] of [[20, 20], [28, 20], [20, 28], [28, 28], [14, 14], [33, 14], [14, 33], [33, 33], [24, 18], [24, 30], [18, 24], [30, 24]]) set(px, py, '#');
set(24, 24, 'S'); // shop at dead center, open on all four sides

// team cores: team 0 = bottom-left (larger y), team 1 = top-right
const CORE0 = [6, 41], CORE1 = [41, 6];
set(CORE0[0], CORE0[1], 'K');
set(CORE1[0], CORE1[1], 'K');
// a few spawn fallbacks near each base (siege deploys on core rings anyway)
for (const [cx, cy] of [CORE0, CORE1]) {
  for (const [dx, dy] of [[2, 0], [0, -2], [2, -2], [-2, 0], [0, 2]]) {
    const x = cx + dx, y = cy + dy;
    if (x > 0 && y > 0 && x < W - 1 && y < H - 1 && grid[y][x] === '.') set(x, y, 'P');
  }
}

// two lanes that ring the map between the bases
const lanes = [
  { waypoints: [[6, 41], [24, 44], [44, 44], [44, 24], [41, 6]] }, // bottom + right edge
  { waypoints: [[6, 41], [4, 24], [4, 4], [24, 4], [41, 6]] },     // left + top edge
];

// place towers by interpolating along a lane polyline (cumulative length)
function along(wps, frac) {
  let total = 0; const segs = [];
  for (let i = 1; i < wps.length; i++) {
    const d = Math.hypot(wps[i][0] - wps[i - 1][0], wps[i][1] - wps[i - 1][1]);
    segs.push(d); total += d;
  }
  let want = frac * total;
  for (let i = 1; i < wps.length; i++) {
    if (want <= segs[i - 1] || i === wps.length - 1) {
      const t = segs[i - 1] ? want / segs[i - 1] : 0;
      return [Math.round(wps[i - 1][0] + (wps[i][0] - wps[i - 1][0]) * t), Math.round(wps[i - 1][1] + (wps[i][1] - wps[i - 1][1]) * t)];
    }
    want -= segs[i - 1];
  }
  return wps[wps.length - 1];
}

// 2 towers per team per lane: team 0 guards its half (fracs 0.26/0.44),
// team 1 guards its half (fracs 0.58/0.76). 8 towers total.
const towers = [];
lanes.forEach((lane, li) => {
  for (const [team, frac] of [[0, 0.26], [0, 0.44], [1, 0.58], [1, 0.76]]) {
    const [x, y] = along(lane.waypoints, frac);
    towers.push({ x, y, team, lane: li, level: 1 });
  }
});

const def = {
  name: 'Anchorline',
  objective: 'Push a lane, break their towers, and shatter the enemy Anchor core.',
  mode: 'siege',
  expedition: true,
  untimed: true,
  siege: {
    coreHp: 60,
    minionInterval: 20,
    minionCap: 12,
    waveBase: 3,
    wavePerMin: 1,
    lanes,
  },
  towers,
  tiles: grid.map(r => r.join('')),
};

const outDir = path.join(__dirname, '..', 'levels', 'siege');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'siege-anchorline.json');
fs.writeFileSync(out, JSON.stringify(def, null, 1));
console.log(`wrote ${out} (${W}x${H}, ${towers.length} towers, ${lanes.length} lanes)`);
