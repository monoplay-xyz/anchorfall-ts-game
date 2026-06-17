// Generates the Family Mode maps (levels/family/*.json) — bright, simple,
// child-friendly co-op fields: grass meadows with ponds + beaches, tree
// clusters, a few gentle monsters, and a friend to rescue. Reproducible.
// Tiles: '.' grass, '=' sand/beach, '~' water (scenery, walk around it),
// 'T' tree (cover), '#' wall border, 'P' spawn, 'E' exit, 'c' captive,
// 'g' grunt (gentle in family mode). Flowers are drawn by the renderer.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// tiny deterministic hash -> 0..1 (no RNG, so maps are reproducible)
const h2 = (x, y, s) => { let n = (x * 73856093) ^ (y * 19349663) ^ (s * 83492791); n = (n ^ (n >>> 13)) >>> 0; return (n % 1000) / 1000; };

function build(W, H, seed, opts) {
  const g = [];
  for (let y = 0; y < H; y++) {
    const row = [];
    for (let x = 0; x < W; x++) row.push(x === 0 || y === 0 || x === W - 1 || y === H - 1 ? '#' : '.');
    g.push(row);
  }
  const inb = (x, y) => x > 1 && y > 1 && x < W - 2 && y < H - 2;
  const set = (x, y, c) => { if (x > 0 && y > 0 && x < W - 1 && y < H - 1) g[y][x] = c; };
  // a pond with a sandy beach ring
  for (const [cx, cy, r] of opts.ponds) {
    for (let y = cy - r - 1; y <= cy + r + 1; y++) for (let x = cx - r - 1; x <= cx + r + 1; x++) {
      if (!inb(x, y)) continue;
      const d = Math.hypot(x - cx, (y - cy) * 1.15);
      if (d < r) set(x, y, '~');
      else if (d < r + 1.4) set(x, y, '='); // beach
    }
  }
  // tree clusters (cover, never on the spawn/exit lanes)
  for (const [cx, cy] of opts.groves) {
    for (let k = 0; k < 7; k++) { const x = cx + Math.round((h2(cx, cy, k) - 0.5) * 4), y = cy + Math.round((h2(cy, cx, k) - 0.5) * 4); if (inb(x, y) && g[y][x] === '.') set(x, y, 'T'); }
  }
  // a few sandy patches for variety
  for (const [cx, cy] of opts.sand || []) for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 2; x <= cx + 2; x++) if (inb(x, y) && g[y][x] === '.') set(x, y, '=');
  // spawns (left), exit (right)
  opts.spawns.forEach(([x, y]) => set(x, y, 'P'));
  set(opts.exit[0], opts.exit[1], 'E');
  // a friend to rescue
  if (opts.captive) set(opts.captive[0], opts.captive[1], 'c');
  // gentle monsters
  opts.foes.forEach(([x, y, c]) => { if (g[y][x] === '.') set(x, y, c); });
  return g.map(r => r.join(''));
}

const MAPS = [
  {
    name: 'Sunny Meadow', objective: 'Explore the meadow, help your friend, and reach the rainbow gate together!',
    W: 34, H: 22, seed: 1,
    ponds: [[24, 7, 3]], groves: [[9, 6], [27, 16]], sand: [[15, 17]],
    spawns: [[3, 11], [3, 10], [4, 12], [4, 9]], exit: [31, 11], captive: [18, 5],
    foes: [[12, 13, 'g'], [21, 15, 'g'], [26, 9, 'g']], captiveChars: ['scout'],
  },
  {
    name: 'Lake Picnic', objective: 'Walk around the big blue lake, rescue your buddy, and find the gate!',
    W: 36, H: 24, seed: 2,
    ponds: [[18, 12, 5]], groves: [[7, 5], [29, 19], [8, 19]], sand: [[18, 4], [18, 20]],
    spawns: [[3, 12], [3, 11], [4, 13], [4, 10]], exit: [33, 12], captive: [30, 6],
    foes: [[12, 6, 'g'], [24, 18, 'g'], [10, 17, 'z'], [27, 9, 'z']], captiveChars: ['medic'],
  },
  {
    name: 'Forest Friends', objective: 'Wander the woods, free your friend, and stroll to the gate!',
    W: 32, H: 22, seed: 3,
    ponds: [[8, 16, 2], [25, 6, 2]], groves: [[14, 6], [20, 15], [10, 9], [24, 17]], sand: [],
    spawns: [[3, 11], [3, 10], [4, 12], [4, 9]], exit: [29, 11], captive: [16, 11],
    foes: [[12, 14, 'g'], [22, 8, 'g'], [18, 17, 'z']], captiveChars: ['raider'],
  },
];

const outDir = path.join(__dirname, '..', 'levels', 'family');
fs.mkdirSync(outDir, { recursive: true });
MAPS.forEach((m, i) => {
  const tiles = build(m.W, m.H, m.seed, m);
  const def = {
    name: m.name, objective: m.objective,
    family: true, untimed: true, time: 0,
    weather: 'clear', ambience: 'meadow',
    captiveChars: m.captiveChars,
    tiles,
  };
  const file = path.join(outDir, `family${String(i + 1).padStart(2, '0')}.json`);
  fs.writeFileSync(file, JSON.stringify(def, null, 1));
  console.log(`wrote ${file} (${m.W}x${m.H}, ${m.name})`);
});
