// Generates levels/level21-ctf.json — "Twin Relays" (versus: capture the flag).
// Deterministic (fixed seed 20260621): re-running always produces the same map.
// A 64x44 mirror-symmetric battlefield (gen-exp04's mirror trick: the WEST
// half is generated, then reflected tile-for-tile onto the east half). Two
// fortified relay bases face each other across a three-lane midfield of
// wall pillars, overgrowth and sandbag nests; a wide center boulevard holds
// the contested chests and a stag for each side.
//
// SPAWN <-> TEAM CONTRACT (verified against shared/game.js):
//   createGame assigns spawn i to party index i (spawns scan row-major) and
//   team = party[i].team ?? (i % 2); the first 'D' in scan order is team 0.
//   So each spawn row carries a LEFT P then a RIGHT P — scan order alternates
//   left/right, even party indices (team 0) all land at the west base, whose
//   flag stand scans first. Online lobbies that pass explicit alternating
//   teams by seat order produce the same pairing.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = 64, H = 44;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260621);

const grid = Array.from({ length: H }, () => Array(W).fill('.'));
const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const get = (x, y) => (inBounds(x, y) ? grid[y][x] : '#');
const set = (x, y, c) => { if (inBounds(x, y)) grid[y][x] = c; };
const mirrorX = (x) => W - 1 - x;

// ============================================================
// WEST HALF (x 0..31): base + midfield lanes. Mirrored later.
// ============================================================

// --- west relay base: walled fort x 1..14, y 12..31 ---
// North/south walls with posterns; east wall with the main gate. The map
// border closes the west side.
for (let x = 1; x <= 14; x++) {
  if (x !== 7 && x !== 8) { set(x, 12, '#'); set(x, 31, '#'); } // posterns at x 7..8
}
for (let y = 12; y <= 31; y++) {
  if (y < 20 || y > 23) set(14, y, '#'); // main gate opening y 20..23
}
// worked-stone parade ground inside the fort
for (let y = 13; y <= 30; y++)
  for (let x = 1; x <= 13; x++)
    set(x, y, ';');

// sandbag funnel outside the main gate (shots fly over, feet do not)
for (const [sx, sy] of [[16, 18], [17, 19], [16, 25], [17, 24]]) set(sx, sy, 'o');

// --- midfield ridges: split the field into three lanes ---
// Ridge rows y=12 and y=31 from x 17..29; gaps at x 20..21 and 28..29 are
// lane crossings; x 30..31 stays open as the center boulevard.
for (const ry of [12, 31]) {
  for (let x = 17; x <= 29; x++) {
    if ((x >= 20 && x <= 21) || (x >= 28 && x <= 29)) continue;
    set(x, ry, '#');
  }
}

// --- fixed cover, west half ---
// Top lane: pillar block + tree copse + sandbag nest.
for (let y = 4; y <= 5; y++) for (let x = 26; x <= 27; x++) set(x, y, '#');
for (const [tx, ty] of [[19, 4], [20, 4], [19, 5], [20, 6], [21, 6]]) set(tx, ty, 'T');
for (const [sx, sy] of [[29, 8], [30, 8], [29, 9]]) set(sx, sy, 'o');
// Bottom lane: the same idea, flipped to the south.
for (let y = 38; y <= 39; y++) for (let x = 26; x <= 27; x++) set(x, y, '#');
for (const [tx, ty] of [[19, 38], [20, 38], [19, 39], [20, 37], [21, 37]]) set(tx, ty, 'T');
for (const [sx, sy] of [[29, 34], [30, 34], [29, 35]]) set(sx, sy, 'o');
// Center lane: twin pillars guarding the boulevard mouth + sandbag arcs.
for (let y = 16; y <= 17; y++) for (let x = 24; x <= 25; x++) set(x, y, '#');
for (let y = 26; y <= 27; y++) for (let x = 24; x <= 25; x++) set(x, y, '#');
for (const [sx, sy] of [[27, 20], [27, 21], [27, 22], [27, 23]]) set(sx, sy, 'o');
for (const [tx, ty] of [[20, 15], [21, 15], [20, 28], [21, 28]]) set(tx, ty, 'T');

// --- deterministic scatter: overgrowth and burn scars in the midfield ---
for (let i = 0; i < 26; i++) {
  const x = 16 + Math.floor(rnd() * 16), y = 2 + Math.floor(rnd() * 40);
  if (get(x, y) === '.') set(x, y, rnd() < 0.45 ? 'T' : '_');
}
for (let i = 0; i < 18; i++) {
  const x = 1 + Math.floor(rnd() * 15), y = 2 + Math.floor(rnd() * 40);
  if (get(x, y) === '.') set(x, y, '_'); // shell scars on the approaches
}

// --- roads (carved after scatter so nothing seals a lane) ---
// Gate road: fort gate straight to the boulevard.
for (let y = 21; y <= 22; y++) for (let x = 14; x <= 31; x++) set(x, y, ';');
// West crossing: vertical road through both ridge gaps at x 20..21.
for (let y = 4; y <= 39; y++) for (let x = 20; x <= 21; x++) set(x, y, ';');
// Center boulevard (mirrors into a 4-wide x 30..33 spine).
for (let y = 2; y <= 41; y++) for (let x = 30; x <= 31; x++) set(x, y, ';');

// ============================================================
// MIRROR: east half (x 32..63) = west half reflected. Twin relays.
// ============================================================
for (let y = 0; y < H; y++)
  for (let x = 32; x < W; x++)
    grid[y][x] = grid[y][mirrorX(x)];

// --- map border ---
for (let x = 0; x < W; x++) { set(x, 0, '#'); set(x, H - 1, '#'); }
for (let y = 0; y < H; y++) { set(0, y, '#'); set(W - 1, y, '#'); }

// ============================================================
// ENTITIES — placed as explicit mirror pairs after the reflection.
// ============================================================
function put(x, y, c) {
  if (get(x, y) === '#' || get(x, y) === 'T' || get(x, y) === 'o') {
    console.error(`refusing to drop '${c}' on blocked tile ${x},${y} (${get(x, y)})`);
    process.exit(1);
  }
  set(x, y, c);
}
function pair(x, y, c) { put(x, y, c); put(mirrorX(x), y, c); }

// Flag stands: west 'D' scans first -> team 0 = left base. Mirror = team 1.
pair(5, 21, 'D');
// Spawns: one LEFT + RIGHT pair per row -> scan order alternates teams
// (party index i -> spawn i, team i%2). Eight total, four per side.
for (const py of [16, 19, 24, 27]) pair(3, py, 'P');
// Shops: one per base, by the north parade wall.
pair(10, 15, 'S');
// Stags: up the boulevard, NORTH of the center chests — equidistant by
// symmetry and 3+ tiles clear of the chests so the 1.5-tile act radii can
// never overlap (mount and chest-open must not collide on one press).
pair(30, 18, 'V');
// Chests: top-lane pair, contested center pair, bottom-lane pair.
pair(24, 6, 'C');
pair(31, 21, 'C');
pair(24, 37, 'C');

// ============================================================
// CONNECTIVITY — everything reachable from the first spawn; any carve is
// applied to BOTH halves so the mirror never breaks.
// ============================================================
const PASS = c => c !== '#' && c !== 'T' && c !== '~' && c !== 'o';
const ENTITY = new Set(['P', 'D', 'S', 'V', 'C']);
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
  // walk toward the map center carving blockers symmetrically
  let cx = x, cy = y, guard = 0;
  while (!seen[cy][cx] && guard++ < 300) {
    if (cx < 31 && cx < mirrorX(cx)) cx++;
    else if (cx > 32) cx--;
    else if (cy > 21) cy--;
    else cy++;
    if (!PASS(get(cx, cy)) && cx > 0 && cy > 0 && cx < W - 1 && cy < H - 1) {
      set(cx, cy, ';');
      set(mirrorX(cx), cy, ';');
    }
  }
}
for (let p = 0; p < 10; p++) {
  const seen = reachableFrom(3, 16);
  let bad = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (ENTITY.has(get(x, y)) && !seen[y][x]) { bad++; carveTo(x, y, seen); }
  if (!bad) break;
}
{
  const seen = reachableFrom(3, 16);
  const unreachable = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (ENTITY.has(get(x, y)) && !seen[y][x]) unreachable.push([get(x, y), x, y]);
  if (unreachable.length) {
    console.error('UNREACHABLE entities remain:', unreachable);
    process.exit(1);
  }
}

// ============================================================
// VERIFY the spawn/flag scan-order contract before writing anything.
// ============================================================
const scan = [];
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++)
    if (grid[y][x] === 'P' || grid[y][x] === 'D') scan.push([grid[y][x], x, y]);
const flags = scan.filter(s => s[0] === 'D');
const spawns = scan.filter(s => s[0] === 'P');
if (flags.length !== 2 || flags[0][1] >= 32 || flags[1][1] < 32) {
  console.error('flag scan order broken:', flags); process.exit(1);
}
if (spawns.length !== 8 || !spawns.every(([, x], i) => (i % 2 === 0 ? x < 32 : x >= 32))) {
  console.error('spawn scan order must alternate west/east:', spawns); process.exit(1);
}

const counts = {};
for (const row of grid) for (const c of row) counts[c] = (counts[c] || 0) + 1;
console.log(grid.map(r => r.join('')).join('\n'));
console.log(`${W}x${H} map (${W * H} tiles)`);
console.log('tile counts:', Object.fromEntries(Object.entries(counts).sort()));
console.log('spawn scan order (i -> team i%2):', spawns.map(([, x, y], i) => `#${i}:${x},${y}=${x < 32 ? 'W/t0' : 'E/t1'}`).join(' '));
console.log('flags (scan order):', flags.map(([, x, y], i) => `team${i}@${x},${y}`).join(' '));

const def = {
  name: 'Twin Relays',
  title: 'Versus — Twin Relays',
  objective: 'Steal the enemy banner and run it home — first to 3 captures takes the field',
  time: 480,
  mode: 'ctf',
  expedition: true,
  captiveChars: [],
  // chests bind row-major: top pair, contested center pair, bottom pair —
  // mirrored indices carry identical loot so neither side gets the long straw
  chests: [
    { loot: 'cracker', amount: 2 }, { loot: 'cracker', amount: 2 },
    { loot: 'shield', amount: 1 }, { loot: 'shield', amount: 1 },
    { loot: 'shards', amount: 8 }, { loot: 'shards', amount: 8 },
  ],
  // both midfield mounts are stags (row-major bind)
  vehicles: [{ kind: 'stag' }, { kind: 'stag' }],
  tiles: grid.map(r => r.join('')),
};
const out = path.join(__dirname, '../levels/level21-ctf.json');
fs.writeFileSync(out, JSON.stringify(def, null, 2) + '\n');
console.log('wrote', out);
