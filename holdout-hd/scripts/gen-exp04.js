// Generates levels/level14.json — "Chapter IV — Forkfall".
// Deterministic (fixed seed 20260614): re-running always produces the same map.
// The city that exists twice: an 84x64 ruined city whose WEST HALF is generated
// as city-block rectangles on a street grid (';' worked stone, '#' buildings,
// occasional 'T' overgrowth, '_' burn scars), then mirrored tile-for-tile onto
// the east half around the center seam — the fork made literal. A 2-wide '_'
// glitch scar runs down the middle with gaps. Spawn on the west edge; the
// dormant Anchor waits at the east edge, inside the false twin.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = 84, H = 64;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260614);

const grid = Array.from({ length: H }, () => Array(W).fill('.'));
const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const get = (x, y) => (inBounds(x, y) ? grid[y][x] : '#');
const set = (x, y, c) => { if (inBounds(x, y)) grid[y][x] = c; };
const isOpen = (x, y) => get(x, y) === '.';

// --- border ---
for (let x = 0; x < W; x++) { set(x, 0, '#'); set(x, H - 1, '#'); }
for (let y = 0; y < H; y++) { set(0, y, '#'); set(W - 1, y, '#'); }

// ============================================================
// WEST HALF (x 1..41): ruined city blocks on a street grid
// ============================================================
// Vertical building strips (streets between them, plus the grand avenue).
const STRIPS = [[6, 11], [15, 20], [24, 29], [33, 38]];   // building columns
const ROWS = [[2, 8], [12, 19], [23, 29], [34, 40], [44, 51], [55, 61]]; // building rows
// Streets: x 1..5 (west esplanade), 12..14, 21..23, 30..32, 39..41 (seam plaza);
// y 9..11, 20..22, 30..33 (grand avenue), 41..43, 52..54.

for (const [x0, x1] of STRIPS) {
  for (const [y0, y1] of ROWS) {
    if (rnd() < 0.15) {
      // razed lot: rubble scatter instead of a standing block
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const r = rnd();
          if (r < 0.16) set(x, y, '#');
          else if (r < 0.24) set(x, y, '_');
        }
      continue;
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const r = rnd();
        if (r < 0.06) set(x, y, '.');       // shell-hole gap
        else if (r < 0.12) set(x, y, 'T');  // overgrowth reclaiming the block
        else if (r < 0.16) set(x, y, '_');  // burn scar inside the ruin
        else set(x, y, '#');
      }
    }
  }
}

// Two spawner-nest courtyards carved into standing blocks (mirrored to the
// east half, giving four nests total).
function courtyard(x0, y0, x1, y1, doors) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, '.');
  // re-seal the ring so the nest reads as a walled yard
  for (let x = x0 - 1; x <= x1 + 1; x++) { set(x, y0 - 1, '#'); set(x, y1 + 1, '#'); }
  for (let y = y0 - 1; y <= y1 + 1; y++) { set(x0 - 1, y, '#'); set(x1 + 1, y, '#'); }
  for (const [dx, dy] of doors) set(dx, dy, '.');
}
courtyard(16, 13, 19, 18, [[15, 15], [15, 16]]); // nest A, west door onto street
courtyard(25, 45, 28, 50, [[26, 51], [27, 51]]); // nest B, south door onto street

// Burn-scar patches in the streets.
for (let i = 0; i < 26; i++) {
  const cx = 1 + Math.floor(rnd() * 41), cy = 1 + Math.floor(rnd() * 62);
  const r = 1 + Math.floor(rnd() * 2);
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++)
      if (x >= 1 && x <= 41 && get(x, y) === '.' && rnd() < 0.6) set(x, y, '_');
}
// Lone overgrowth pushing up through the paving.
for (let i = 0; i < 22; i++) {
  const x = 1 + Math.floor(rnd() * 41), y = 1 + Math.floor(rnd() * 62);
  if (get(x, y) === '.') set(x, y, 'T');
}
// Keep the grand avenue broad and walkable across the west half.
for (let y = 31; y <= 32; y++)
  for (let x = 1; x <= 41; x++)
    if (get(x, y) === '#' || get(x, y) === 'T') set(x, y, '.');

// ============================================================
// MIRROR: true horizontal mirror around the center seam.
// East half (x 42..83) = west half reflected; the fork made literal.
// ============================================================
for (let y = 0; y < H; y++)
  for (let x = 42; x < W; x++)
    grid[y][x] = grid[y][W - 1 - x];

// --- glitch seam: 2-wide '_' scar down the middle, with gaps ---
for (let y = 1; y < H - 1; y++) {
  if (rnd() < 0.78) { set(41, y, '_'); set(42, y, '_'); }
}
// glitch shards — frozen rubble caught mid-fork (never on the avenue)
for (const [sx, sy] of [[41, 6], [42, 17], [41, 38], [42, 57]]) set(sx, sy, '#');

// --- player spawns, west edge ---
for (let y = 28; y <= 35; y++) for (let x = 2; x <= 6; x++) set(x, y, '.');
for (const [px, py] of [[3, 30], [3, 33], [5, 30], [5, 33]]) set(px, py, 'P');

// --- Anchor arena + exit, east edge (inside the mirrored twin) ---
for (let y = 26; y <= 38; y++) for (let x = 76; x <= 82; x++) if (get(x, y) !== '.') set(x, y, '.');
for (const [ex, ey] of [[80, 31], [80, 32], [81, 31], [81, 32]]) set(ex, ey, 'E');

// ============================================================
// ENTITIES (placed after the mirror — the halves twin in terrain,
// not in what haunts them)
// ============================================================
function place(c, x, y) {
  x = Math.round(x); y = Math.round(y);
  for (let r = 0; r < 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (isOpen(x + dx, y + dy)) { set(x + dx, y + dy, c); return true; }
      }
    }
  }
  return false;
}

// Forkling skitters boil out of the scar: a heavy pack on the seam...
for (let i = 0; i < 8; i++) place('w', 38 + rnd() * 8, 5 + rnd() * 54);
// ...and more loose in the false twin's streets.
for (let i = 0; i < 6; i++) place('w', 46 + rnd() * 32, 5 + rnd() * 54);
// Four spawners, one per nest courtyard (two real, two mirrored).
place('m', 18, 15); place('m', 26, 47);
place('m', 65, 15); place('m', 57, 47);
// Grunts and chargers prowl the streets of both halves.
for (let i = 0; i < 5; i++) place('g', 8 + rnd() * 30, 5 + rnd() * 54);
for (let i = 0; i < 5; i++) place('g', 46 + rnd() * 32, 5 + rnd() * 54);
for (let i = 0; i < 3; i++) place('r', 12 + rnd() * 26, 27 + rnd() * 10);
for (let i = 0; i < 3; i++) place('r', 46 + rnd() * 26, 27 + rnd() * 10);
// Two snipers on sandbagged rooftop towers overlooking the avenue
// (sandbags block feet, not sightlines).
function tower(x, y) {
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    if (isOpen(x + dx, y + dy)) set(x + dx, y + dy, 'o');
  }
  place('n', x, y);
}
tower(35, 22);
tower(48, 42);

// --- captives (ids bound to 'c' tiles in row-major scan order) ---
const captivePlan = [
  ['boomer', 13, 6],   // north-west district, real city
  ['helix', 70, 57],   // south-east district, false twin
];
const placedCaptives = [];
for (const [id, x, y] of captivePlan) {
  const before = grid.map(r => r.join(''));
  if (!place('c', x, y)) { console.error('failed to place captive', id); process.exit(1); }
  outer: for (let yy = 0; yy < H; yy++) {
    for (let xx = 0; xx < W; xx++) {
      if (grid[yy][xx] === 'c' && before[yy][xx] !== 'c') {
        placedCaptives.push({ id, x: xx, y: yy });
        break outer;
      }
    }
  }
}
placedCaptives.sort((a, b) => a.y - b.y || a.x - b.x);
const captiveChars = placedCaptives.map(c => c.id);

// --- camps, build sites and LYTH crystals ---
const PROTECT = new Set(['P', 'c', 'E', 'g', 'a', 'r', 's', 'm', 'n', 'w', 'b', 'N', 'B', 'Y', '*']);
function forceSet(x, y, ch) {
  for (const accept of [c => c === '.', c => !PROTECT.has(c)]) {
    for (let r = 0; r < 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = x + dx, ty = y + dy;
          if (tx < 1 || ty < 1 || tx >= W - 1 || ty >= H - 1) continue;
          if (accept(get(tx, ty))) { set(tx, ty, ch); return [tx, ty]; }
        }
      }
    }
  }
  return null;
}

// Twin survivors — the same woman, once on each side of the seam.
// Her lines mirror each other. Only one of them ever had shards to give.
const campPlan = [
  {
    x: 22, y: 35, fireDx: 1,
    npc: {
      id: 'mirra-vex-west',
      name: 'Mirra Vex',
      lines: [
        "You walked in from the west. Good. That means you're the real one.",
        'There is a me across the seam. There was never a me across the seam.',
        'Forklings boil out of the scar in waves — get the barricades up on the cross-streets before the next one.',
        'Three pylons, one quorum. The Anchor settles, and one of these cities stops having happened.',
        'If she offers you shards — take them. They spend real.',
      ],
    },
  },
  {
    x: 61, y: 35, fireDx: -1,
    npc: {
      id: 'mirra-vex-east',
      name: 'Mirra Vex',
      lines: [
        "You walked in from the east. Good. That means you're the real one.",
        'There is a me across the seam. There was never a me across the seam.',
        'Take these. Shards, pulled out of the scar. They spend real.',
        'The nests glow in the old courtyards — crack the spawners between pulses or the streets never empty.',
        'If she told you to trust me — she would never say that.',
      ],
      gift: { shards: 6 },
    },
  },
];
const placedNpcs = [];
for (const camp of campPlan) {
  const at = forceSet(camp.x, camp.y, 'N');
  if (!at) { console.error('failed to place npc', camp.npc.id); process.exit(1); }
  placedNpcs.push({ x: at[0], y: at[1], npc: camp.npc });
  // campfire beside the survivor — mirrored sides, like everything here
  forceSet(at[0] + camp.fireDx, at[1], '*');
}
// def.npcs binds to 'N' tiles in row-major scan order
placedNpcs.sort((a, b) => a.y - b.y || a.x - b.x);
const npcs = placedNpcs.map(p => p.npc);

// 3 pylons (13 each) + 3 barricades + 1 turret
const buildPlan = [
  { kind: 'pylon', cost: 13, x: 18, y: 31 },     // west avenue, real city
  { kind: 'pylon', cost: 13, x: 44, y: 33 },     // just over the seam
  { kind: 'pylon', cost: 13, x: 70, y: 31 },     // false twin, Anchor approach
  { kind: 'barricade', cost: 4, x: 13, y: 22 },  // west cross-street
  { kind: 'barricade', cost: 4, x: 61, y: 21 },  // east cross-street (mirror of the west one)
  { kind: 'barricade', cost: 4, x: 52, y: 42 },  // south-east cross-street
  { kind: 'turret', cost: 10, x: 74, y: 34 },    // covering the Anchor arena
];
const placedBuilds = [];
for (const b of buildPlan) {
  const at = forceSet(b.x, b.y, 'B');
  if (!at) { console.error('failed to place build site', b.kind); process.exit(1); }
  placedBuilds.push({ x: at[0], y: at[1], kind: b.kind, cost: b.cost });
}
// def.builds binds to 'B' tiles in row-major scan order
placedBuilds.sort((a, b) => a.y - b.y || a.x - b.x);
const builds = placedBuilds.map(b => ({ kind: b.kind, cost: b.cost }));

// 11 LYTH crystal nodes, strung generously along the critical path
// (the grand avenue, the seam, and the nest districts).
const crystalPlan = [
  [7, 29], [14, 34], [22, 30], [29, 35], [36, 29],
  [41, 10], [42, 54],
  [49, 34], [57, 30], [65, 35], [73, 29],
];
for (const [cx, cy] of crystalPlan) forceSet(cx, cy, 'Y');

// --- connectivity: everything must be reachable from spawn on foot ---
const PASS = c => c !== '#' && c !== 'T' && c !== '~' && c !== 'o';
function reachableFrom(sx, sy) {
  const seen = Array.from({ length: H }, () => Array(W).fill(false));
  const q = [[sx, sy]];
  seen[sy][sx] = true;
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (inBounds(nx, ny) && !seen[ny][nx] && PASS(get(nx, ny))) {
        seen[ny][nx] = true;
        q.push([nx, ny]);
      }
    }
  }
  return seen;
}

function carveTo(x, y, seen) {
  // walk straight west toward spawn, carving blockers, until reaching reached ground
  let cx = x, cy = y;
  let guard = 0;
  while (!seen[cy][cx] && guard++ < 300) {
    if (cx > 3) cx--;
    else if (cy > 31) cy--;
    else cy++;
    if (!PASS(get(cx, cy))) set(cx, cy, '.');
  }
}

const ENTITY = new Set(['P', 'c', 'E', 'g', 'a', 'r', 's', 'm', 'n', 'w', 'b', 'N', 'B', 'Y']);
for (let pass = 0; pass < 10; pass++) {
  const seen = reachableFrom(3, 30);
  let bad = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (ENTITY.has(get(x, y)) && !seen[y][x]) {
        bad++;
        carveTo(x, y, seen);
      }
    }
  }
  if (!bad) break;
}

// final check
{
  const seen = reachableFrom(3, 30);
  const unreachable = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (ENTITY.has(get(x, y)) && !seen[y][x]) unreachable.push([get(x, y), x, y]);
  if (unreachable.length) {
    console.error('UNREACHABLE entities remain:', unreachable);
    process.exit(1);
  }
}

// --- paint: every remaining open tile becomes worked city stone ---
for (let y = 1; y < H - 1; y++)
  for (let x = 1; x < W - 1; x++)
    if (get(x, y) === '.') set(x, y, ';');

const counts = {};
for (const row of grid) for (const c of row) counts[c] = (counts[c] || 0) + 1;
console.log(grid.map(r => r.join('')).join('\n'));
console.log(`${W}x${H} map (${W * H} tiles)`);
console.log('tile counts:', Object.fromEntries(Object.entries(counts).sort()));
console.log('captives (scan order):', captiveChars.join(', '));
console.log('npcs (scan order):', npcs.map(n => n.id).join(', '));
console.log('builds (scan order):', builds.map(b => `${b.kind}:${b.cost}`).join(', '));
const bill = builds.reduce((n, b) => n + b.cost, 0);
const pylonBill = builds.filter(b => b.kind === 'pylon').reduce((n, b) => n + b.cost, 0);
console.log(`economy: pylon bill ${pylonBill} (total ${bill}) vs crystals ${crystalPlan.length}x4=${crystalPlan.length * 4} + gifts 6 + kill income`);

const def = {
  name: 'Forkfall',
  title: 'Chapter IV — Forkfall',
  objective: 'Cross the glitch seam into the false twin city — raise three pylons to settle the fork',
  time: 700,
  story: true,
  chapter: 4,
  expedition: true,
  intro: [
    {
      title: 'Forkfall',
      lines: [
        'The timeline forked here. Seal the false branch.',
        'A whole city, copied street for street across the scar.',
        'Three pylons. One city gets to be real.',
      ],
      art: 'forkfall',
    },
  ],
  modifiers: {
    waves: [
      { at: 300, letters: 'wwwww', edge: 'w' },
      { at: 480, letters: 'wwgg', edge: 'e' },
    ],
  },
  outro: [
    {
      title: 'One City',
      lines: [
        'The false branch thins to static and is gone. One city. One history.',
        'On the far bank, Mirra Vex waves goodbye. Once.',
      ],
      art: 'forkfall',
    },
  ],
  captiveChars,
  npcs,
  builds,
  gate: { need: 3 },
  tiles: grid.map(r => r.join('')),
};
const out = path.join(__dirname, '../levels/level14.json');
fs.writeFileSync(out, JSON.stringify(def, null, 2) + '\n');
console.log('wrote', out);
