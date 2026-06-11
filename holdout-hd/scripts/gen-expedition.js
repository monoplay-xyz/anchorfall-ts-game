// Generates levels/level11.json — "The Long Crossing", the first expedition map.
// Deterministic (fixed seed): re-running always produces the same map.
// A 96x64 west-to-east journey: meadow, river fords, deep forest, a fortified
// village, a sniper ridge over a southern swamp, and a boss gate before the exit.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = 96, H = 64;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260610);

const grid = Array.from({ length: H }, () => Array(W).fill('.'));
const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const get = (x, y) => (inBounds(x, y) ? grid[y][x] : '#');
const set = (x, y, c) => { if (inBounds(x, y)) grid[y][x] = c; };
const isOpen = (x, y) => get(x, y) === '.';

// --- border ---
for (let x = 0; x < W; x++) { set(x, 0, '#'); set(x, H - 1, '#'); }
for (let y = 0; y < H; y++) { set(0, y, '#'); set(W - 1, y, '#'); }

function blob(cx, cy, r, c, density = 0.75) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r && rnd() < density * (1 - d / (r + 1))) set(x, y, c);
    }
  }
}

// --- west meadow: scattered rock/tree clumps (x 3..19) ---
for (let i = 0; i < 9; i++) blob(5 + rnd() * 14, 4 + rnd() * 56, 1.6 + rnd() * 1.8, '#');

// --- first river at x≈22 with two fords ---
const fordYs1 = [13, 46];
for (let y = 1; y < H - 1; y++) {
  const wob = Math.round(Math.sin(y * 0.22) * 2);
  if (fordYs1.some(f => Math.abs(y - f) <= 2)) continue;
  for (let dx = 0; dx < 3; dx++) set(22 + wob + dx, y, '~');
}

// --- deep forest (x 27..43): winding wall clusters ---
for (let i = 0; i < 26; i++) blob(28 + rnd() * 16, 3 + rnd() * 58, 1.4 + rnd() * 2.2, '#');
// guarantee three lanes through the forest
for (const laneY of [10, 31, 52]) {
  for (let x = 25; x <= 46; x++) {
    const wob = Math.round(Math.sin(x * 0.35 + laneY) * 1.5);
    for (let dy = -1; dy <= 1; dy++) set(x, laneY + wob + dy, '.');
  }
}

// --- central fortress village (x 47..62, y 22..42) ---
const FX0 = 47, FX1 = 62, FY0 = 22, FY1 = 42;
for (let x = FX0; x <= FX1; x++) { set(x, FY0, '#'); set(x, FY1, '#'); }
for (let y = FY0; y <= FY1; y++) { set(FX0, y, '#'); set(FX1, y, '#'); }
// gates: west, east, south
for (const [gx, gy] of [[FX0, 31], [FX0, 32], [FX1, 31], [FX1, 32], [54, FY1], [55, FY1]]) set(gx, gy, '.');
// inner keep
for (let x = 52; x <= 58; x++) { set(x, 27, '#'); set(x, 37, '#'); }
for (let y = 27; y <= 37; y++) { set(52, y, '#'); set(58, y, '#'); }
set(52, 32, '.'); set(58, 32, '.');
// clear fortress interior floor of stray blobs
for (let y = FY0 + 1; y < FY1; y++)
  for (let x = FX0 + 1; x < FX1; x++)
    if (get(x, y) === '~') set(x, y, '.');
// sandbag rings at the gates
for (const [sx, sy] of [[45, 29], [45, 34], [64, 29], [64, 34], [52, 44], [57, 44]]) set(sx, sy, 'o');

// --- second river at x≈68 with two fords ---
const fordYs2 = [9, 36];
for (let y = 1; y < H - 1; y++) {
  const wob = Math.round(Math.sin(y * 0.18 + 3) * 2);
  if (fordYs2.some(f => Math.abs(y - f) <= 2)) continue;
  for (let dx = 0; dx < 3; dx++) set(68 + wob + dx, y, '~');
}

// --- northern ridge (y 6..8, x 60..88): wall line with firing gaps ---
for (let x = 60; x <= 88; x++) if ((x - 60) % 7 !== 3) set(x, 8, '#');
// --- southern swamp (x 58..86, y 46..60) ---
for (let i = 0; i < 14; i++) blob(60 + rnd() * 24, 48 + rnd() * 11, 1.5 + rnd() * 2.4, '~', 0.85);
// winding swamp causeway
for (let x = 58; x <= 88; x++) {
  const y = Math.round(52 + Math.sin(x * 0.3) * 3);
  set(x, y, '.'); set(x, y + 1, '.');
}

// --- eastern approach (x 73..87): broken walls and bag lines ---
for (let i = 0; i < 10; i++) blob(74 + rnd() * 12, 12 + rnd() * 40, 1.3 + rnd() * 1.8, '#');
for (const [sx, sy] of [[84, 28], [84, 30], [84, 34], [84, 36]]) set(sx, sy, 'o');

// --- boss arena + exit (x 88..94, y 26..38) ---
for (let y = 26; y <= 38; y++) for (let x = 88; x <= 93; x++) if (get(x, y) !== '.') set(x, y, '.');
for (const [ex, ey] of [[93, 31], [93, 32], [94, 31], [94, 32]]) set(ex, ey, 'E');

// --- player spawns, west edge ---
for (const [px, py] of [[3, 30], [3, 33], [5, 30], [5, 33]]) set(px, py, 'P');
for (let y = 28; y <= 35; y++) for (let x = 2; x <= 8; x++) if (get(x, y) === '#') set(x, y, '.');

// --- enemies by zone ---
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

// meadow: grunts + a few archers
for (let i = 0; i < 8; i++) place('g', 8 + rnd() * 10, 4 + rnd() * 56);
for (let i = 0; i < 3; i++) place('a', 12 + rnd() * 6, 8 + rnd() * 48);
// river 1 ford guards
place('a', 25, 12); place('a', 25, 15); place('a', 25, 45); place('a', 25, 48);
place('o', 26, 13); place('o', 26, 47);
// forest: grunts, chargers, a spawner nest
for (let i = 0; i < 9; i++) place('g', 28 + rnd() * 16, 4 + rnd() * 56);
for (let i = 0; i < 5; i++) place('r', 30 + rnd() * 14, 6 + rnd() * 52);
place('m', 38, 31);
// fortress garrison
place('m', 55, 30); place('m', 55, 34);
place('s', 49, 31); place('s', 60, 32); place('s', 54, 24); place('s', 54, 40);
place('a', 50, 26); place('a', 59, 38);
place('b', 55, 32) || place('b', 56, 33); // fortress boss variant guards the keep
// ridge snipers
for (const x of [63, 70, 77, 84]) place('n', x, 6);
// swamp skitters
for (let i = 0; i < 8; i++) place('w', 60 + rnd() * 24, 47 + rnd() * 12);
place('n', 80, 55);
// approach: chargers + grunts + spawner
for (let i = 0; i < 5; i++) place('r', 74 + rnd() * 12, 14 + rnd() * 36);
for (let i = 0; i < 7; i++) place('g', 74 + rnd() * 12, 10 + rnd() * 44);
place('m', 86, 32);
// gate guards
place('s', 90, 30); place('s', 90, 34); place('a', 91, 28); place('a', 91, 36);

// --- captives at landmarks (ids bound in row-major scan order) ---
const captivePlan = [
  ['raider', 16, 8],    // meadow north pocket
  ['pyro', 16, 55],     // meadow south pocket
  ['sniper', 40, 10],   // forest north lane
  ['bastion', 55, 32],  // fortress keep (next to the boss)
  ['duelist', 40, 53],  // forest south lane
  ['volt', 74, 7],      // behind the ridge
  ['shade', 72, 53],    // swamp island
  ['atlas', 86, 20],    // approach ruin
];
const placedCaptives = [];
for (const [id, x, y] of captivePlan) {
  // find the actual tile place() picks so ids can be bound by scan order
  const before = grid.map(r => r.join(''));
  if (place('c', x, y)) {
    outer: for (let yy = 0; yy < H; yy++) {
      for (let xx = 0; xx < W; xx++) {
        if (grid[yy][xx] === 'c' && before[yy][xx] !== 'c') {
          placedCaptives.push({ id, x: xx, y: yy });
          break outer;
        }
      }
    }
  }
}
placedCaptives.sort((a, b) => a.y - b.y || a.x - b.x);
const captiveChars = placedCaptives.map(c => c.id);

// --- connectivity: everything must be reachable from spawn on foot ---
const PASS = c => c !== '#' && c !== '~' && c !== 'o';
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

const ENTITY = new Set(['P', 'c', 'E', 'g', 'a', 'r', 's', 'm', 'n', 'w', 'b']);
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

const counts = {};
for (const row of grid) for (const c of row) counts[c] = (counts[c] || 0) + 1;
console.log(`${W}x${H} map (${W * H} tiles)`);
console.log('tile counts:', Object.fromEntries(Object.entries(counts).sort()));
console.log('captives (scan order):', captiveChars.join(', '));

const def = {
  name: 'The Long Crossing',
  objective: 'Cross the frontier west to east — rescue the stranded, reach the far gate',
  time: 720,
  expedition: true,
  captiveChars,
  tiles: grid.map(r => r.join('')),
};
const out = path.join(__dirname, '../levels/level11.json');
fs.writeFileSync(out, JSON.stringify(def, null, 2) + '\n');
console.log('wrote', out);
