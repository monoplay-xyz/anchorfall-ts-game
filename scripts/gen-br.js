// Generates levels/br/level22-br.json — "The Shattering", the battle royale map.
// Deterministic (fixed seed 20260622): re-running always produces the same map.
//
// ~72x72 arena: four terrain quarters (NW meadow, NE forest, SW ruin, SE swamp)
// arranged around a central landmark — the Shattered Monolith, a broken stone
// ring with radial shard scars. 8 player spawns spread around the edges, 23
// chests (the loot game, richest at the center and on the swamp islet), 6 LYTH
// crystals, 2 stags, and 1 skiff by a swamp lake with an islet (2 chests).
// NO AI enemies: the test validator forbids enemy letters on pvp maps, so the
// "neutral sleeper" option was not taken — players are the only threat.
// A 1-tile stepping-stone ford connects the islet (the connectivity validator
// requires every chest reachable on foot); the skiff stays the fast/fun route.
//
// Zone math: the design radii are px — 1500 @60s, 980 @150s, 560 @240s, 240
// @330s. The sim reads def.br.shrinks[].r in TILES (stepZone: targetR = r *
// TILE, locked by the br unit test), so this generator emits px/TILE: 31.25,
// 20.42, 11.67, 5 tiles. TILE=48, 72x72 map = 3456x3456 px, center (1728,
// 1728), starting zone radius = diagonal/2 = ~2444 px > 1500, so the first
// shrink bites. The final 240 px circle (5 tiles) sits inside the monolith
// plaza (open radius ~6.5 tiles). time 420 leaves ~80s after the last shrink.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = 72, H = 72;
const CX = 35.5, CY = 35.5; // map center, between tiles 35 and 36

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260622);

const grid = Array.from({ length: H }, () => Array(W).fill('.'));
const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const get = (x, y) => (inBounds(x, y) ? grid[y][x] : '#');
const set = (x, y, c) => { if (x >= 1 && y >= 1 && x < W - 1 && y < H - 1) grid[y][x] = c; };
const FLOORS = new Set(['.', ',', ';', '_']);
const isOpen = (x, y) => FLOORS.has(get(x, y));
const cdist = (x, y) => Math.hypot(x - CX, y - CY);

// --- border ---
for (let x = 0; x < W; x++) { grid[0][x] = '#'; grid[H - 1][x] = '#'; }
for (let y = 0; y < H; y++) { grid[y][0] = '#'; grid[y][W - 1] = '#'; }

function blob(cx, cy, r, c, density = 0.8) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r && rnd() < density * (1 - d / (r + 1))) set(x, y, c);
    }
  }
}

// --- NW meadow: open grass, light tree clumps and lone rocks ---
for (let i = 0; i < 6; i++) blob(5 + rnd() * 27, 5 + rnd() * 27, 1 + rnd() * 1.4, 'T');
for (let i = 0; i < 4; i++) blob(5 + rnd() * 27, 5 + rnd() * 27, 0.8 + rnd() * 1.1, '#');

// --- NE forest: dense tree blobs with natural clearings ---
for (let i = 0; i < 16; i++) blob(39 + rnd() * 28, 4 + rnd() * 28, 1.5 + rnd() * 2.2, 'T');
for (let i = 0; i < 3; i++) blob(40 + rnd() * 26, 5 + rnd() * 26, 0.8 + rnd(), '#');

// --- SW ruin: four broken building shells, sandbag rubble between ---
const buildings = [
  [6, 42, 14, 50],
  [20, 40, 30, 47],
  [10, 56, 20, 64],
  [25, 54, 33, 62],
];
for (const [x0, y0, x1, y1] of buildings) {
  for (let x = x0; x <= x1; x++) { set(x, y0, '#'); set(x, y1, '#'); }
  for (let y = y0; y <= y1; y++) { set(x0, y, '#'); set(x1, y, '#'); }
  for (let y = y0 + 1; y < y1; y++) for (let x = x0 + 1; x < x1; x++) set(x, y, ';');
  // ruin the shell: crumble ~25% of the wall, then knock two sure doorways
  for (let x = x0; x <= x1; x++) { if (rnd() < 0.25) set(x, y0, ';'); if (rnd() < 0.25) set(x, y1, ';'); }
  for (let y = y0; y <= y1; y++) { if (rnd() < 0.25) set(x0, y, ';'); if (rnd() < 0.25) set(x1, y, ';'); }
  const mx = Math.floor((x0 + x1) / 2), my = Math.floor((y0 + y1) / 2);
  set(mx, y0, ';'); set(x1, my, ';');
}
for (let i = 0; i < 6; i++) blob(5 + rnd() * 28, 40 + rnd() * 28, 0.7 + rnd() * 0.9, 'o', 0.7);

// --- SE swamp: mud, scattered pools, dead trees, and the lake ---
for (let i = 0; i < 9; i++) {
  const bx = 38 + rnd() * 30, by = 38 + rnd() * 28, br = 1 + rnd() * 1.8;
  if (Math.hypot(bx - CX, by - CY) < 12) continue; // keep the landmark dry
  blob(bx, by, br, '~');
}
for (let i = 0; i < 7; i++) {
  const tx = Math.floor(38 + rnd() * 30), ty = Math.floor(38 + rnd() * 28);
  if (Math.hypot(tx - CX, ty - CY) >= 12 && isOpen(tx, ty)) set(tx, ty, 'T');
}
// the lake: a wobbled ellipse, the skiff's water arm
const LKX = 57, LKY = 55, LRX = 9.5, LRY = 6.5;
for (let y = LKY - 8; y <= LKY + 8; y++) {
  for (let x = LKX - 11; x <= LKX + 11; x++) {
    const d = ((x - LKX) / LRX) ** 2 + ((y - LKY) / LRY) ** 2;
    if (d <= 1 + (rnd() - 0.5) * 0.12) set(x, y, '~');
  }
}
// the islet: a mud knoll in the lake's west half, with its stepping-stone ford
for (let y = 53; y <= 57; y++)
  for (let x = 50; x <= 54; x++)
    if (Math.hypot(x - 52, y - 55) <= 2.2) set(x, y, '.');
for (let x = 46; x <= 49; x++) set(x, 55, '.'); // 1-wide ford to the west shore

// --- central landmark: the Shattered Monolith ---
// plaza floor, broken stone ring with four gaps, the cracked core, shard scars
for (let y = 26; y <= 45; y++) {
  for (let x = 26; x <= 45; x++) {
    const d = cdist(x, y);
    if (d <= 6.5) set(x, y, ';');
    else if (d <= 8) {
      const gap = Math.abs(x - CX) < 2 || Math.abs(y - CY) < 2; // N/E/S/W mouths
      if (!gap && rnd() > 0.15) set(x, y, '#');
      else if (FLOORS.has(get(x, y))) set(x, y, ';');
    }
  }
}
for (const [x, y] of [[35, 35], [36, 35], [35, 36], [36, 36]]) set(x, y, '#'); // the core
// radial shard scars: broken diagonals of fallen monolith stone
for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
  for (let k = 8; k <= 14; k += 2) {
    const x = Math.round(CX + dx * k * 0.85), y = Math.round(CY + dy * k * 0.85);
    if (isOpen(x, y)) set(x, y, '#');
  }
}

// --- circulation: edge ring road + four cardinal trails to the plaza ---
const clearTile = (x, y) => { if (!FLOORS.has(get(x, y)) && inBounds(x, y) && x > 0 && y > 0 && x < W - 1 && y < H - 1) set(x, y, '.'); };
for (let x = 2; x <= 69; x++) { clearTile(x, 2); clearTile(x, 69); }
for (let y = 2; y <= 69; y++) { clearTile(2, y); clearTile(69, y); }
for (const lx of [35, 36]) {
  for (let y = 2; y <= 29; y++) clearTile(lx, y);
  for (let y = 42; y <= 69; y++) clearTile(lx, y);
}
for (const ly of [35, 36]) {
  for (let x = 2; x <= 29; x++) clearTile(x, ly);
  for (let x = 42; x <= 69; x++) clearTile(x, ly);
}

// --- entity placement ---
function place(c, x, y) {
  x = Math.round(x); y = Math.round(y);
  for (let r = 0; r < 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isOpen(x + dx, y + dy)) { set(x + dx, y + dy, c); return [x + dx, y + dy]; }
      }
    }
  }
  console.error(`failed to place '${c}' near ${x},${y}`);
  process.exit(1);
}

// 8 spawns spread around the edges (3x3 cleared so nobody starts walled in)
const spawnPlan = [[36, 3], [4, 4], [67, 4], [3, 36], [68, 36], [4, 67], [36, 68], [67, 67]];
for (const [sx, sy] of spawnPlan) {
  for (let y = sy - 1; y <= sy + 1; y++) for (let x = sx - 1; x <= sx + 1; x++) clearTile(x, y);
  set(sx, sy, 'P');
}

// vehicles: two stags in the open quarters, the skiff on the lake's west shore
const vehiclePlan = [];
const stagA = place('V', 14, 20); vehiclePlan.push({ at: stagA, kind: 'stag' });
const stagB = place('V', 56, 14); vehiclePlan.push({ at: stagB, kind: 'stag' });
function placeNearWater(x, y) {
  for (let r = 0; r < 10; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = x + dx, ty = y + dy;
        if (!isOpen(tx, ty)) continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ax, ay]) => get(tx + ax, ty + ay) === '~')) {
          set(tx, ty, 'V');
          return [tx, ty];
        }
      }
    }
  }
  console.error('failed to place the skiff by water');
  process.exit(1);
}
const skiff = placeNearWater(46, 55); vehiclePlan.push({ at: skiff, kind: 'skiff' });

// 6 LYTH crystals: one per quarter, two flanking the landmark
for (const [cx, cy] of [[24, 10], [62, 26], [16, 53], [42, 62], [28, 30], [44, 42]]) place('Y', cx, cy);

// 23 chests — the loot game. Center + islet carry the prime loot.
const chestPlan = [
  // monolith plaza (5): worth fighting the final circle for
  { x: 33, y: 35, loot: 'token' }, { x: 38, y: 36, loot: 'shield' },
  { x: 36, y: 32, loot: 'medkit' }, { x: 34, y: 39, loot: 'cracker' },
  { x: 39, y: 39, loot: 'shards' },
  // lake islet (2): the skiff prize
  { x: 51, y: 54, loot: 'token' }, { x: 53, y: 56, loot: 'shield' },
  // NW meadow (4)
  { x: 8, y: 12, loot: 'shards' }, { x: 20, y: 26, loot: 'shards' },
  { x: 28, y: 8, loot: 'medkit' }, { x: 12, y: 30, loot: 'cracker' },
  // NE forest (4)
  { x: 44, y: 8, loot: 'shards' }, { x: 60, y: 12, loot: 'shards' },
  { x: 50, y: 24, loot: 'shield' }, { x: 66, y: 30, loot: 'cracker' },
  // SW ruin (4): inside the building shells
  { x: 10, y: 46, loot: 'shards' }, { x: 27, y: 44, loot: 'medkit' },
  { x: 14, y: 60, loot: 'shards' }, { x: 29, y: 58, loot: 'cracker' },
  // SE swamp (4)
  { x: 40, y: 48, loot: 'shards' }, { x: 64, y: 44, loot: 'shards' },
  { x: 44, y: 66, loot: 'medkit' }, { x: 62, y: 66, loot: 'shield' },
];
const placedChests = chestPlan.map(c => { const at = place('C', c.x, c.y); return { x: at[0], y: at[1], loot: c.loot }; });

// one shop on the plaza: mined shards buy shields/medkits/crackers mid-match
place('S', 36, 31);

// --- connectivity: every entity reachable on foot from the first spawn ---
const PASS = c => c !== '#' && c !== 'T' && c !== '~' && c !== 'o';
const ENTITY = new Set(['P', 'C', 'V', 'Y', 'S']);
function reachableFrom(sx, sy) {
  const seen = Array.from({ length: H }, () => Array(W).fill(false));
  const q = [[sx, sy]];
  seen[sy][sx] = true;
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (inBounds(nx, ny) && !seen[ny][nx] && (PASS(get(nx, ny)) || ENTITY.has(get(nx, ny)))) {
        seen[ny][nx] = true;
        q.push([nx, ny]);
      }
    }
  }
  return seen;
}
function carveTo(x, y, seen) {
  // walk toward the map center (the trails join everything there), carving
  let cx = x, cy = y, guard = 0;
  while (!seen[cy][cx] && guard++ < 300) {
    if (Math.abs(cx - 35) >= Math.abs(cy - 35) && cx !== 35) cx += cx < 35 ? 1 : -1;
    else if (cy !== 35) cy += cy < 35 ? 1 : -1;
    else break;
    if (!PASS(get(cx, cy)) && !ENTITY.has(get(cx, cy))) set(cx, cy, '.');
  }
}
for (let pass = 0; pass < 10; pass++) {
  const seen = reachableFrom(36, 3);
  let bad = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (ENTITY.has(get(x, y)) && !seen[y][x]) { bad++; carveTo(x, y, seen); }
  if (!bad) break;
}
{
  const seen = reachableFrom(36, 3);
  const unreachable = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (ENTITY.has(get(x, y)) && !seen[y][x]) unreachable.push([get(x, y), x, y]);
  if (unreachable.length) {
    console.error('UNREACHABLE entities remain:', unreachable);
    process.exit(1);
  }
}

// --- paint quarter floors (after carving so carved lanes get painted) ---
for (let y = 1; y < H - 1; y++) {
  for (let x = 1; x < W - 1; x++) {
    if (get(x, y) !== '.') continue;
    if (cdist(x, y) <= 8) { set(x, y, ';'); continue; }   // landmark grounds
    if (x < 36 && y < 36) continue;                        // meadow grass '.'
    if (x >= 36 && y < 36) { set(x, y, ','); continue; }   // forest loam
    if (x < 36) { if (rnd() < 0.4) set(x, y, ';'); continue; } // ruin pavings
    set(x, y, '_');                                        // swamp mud
  }
}

// --- def arrays bind row-major: sort recorded placements like the parser scans ---
const rowMajor = (a, b) => a.y - b.y || a.x - b.x;
placedChests.sort(rowMajor);
const vehiclesRM = vehiclePlan.map(v => ({ x: v.at[0], y: v.at[1], kind: v.kind })).sort(rowMajor);

// --- stats + self-check ---
const counts = {};
for (const row of grid) for (const c of row) counts[c] = (counts[c] || 0) + 1;
for (const c of 'garsmnwb') if (counts[c]) { console.error(`pvp map carries enemy letter '${c}'`); process.exit(1); }
const TILE = 48;
// design radii in px -> def carries tiles (the sim multiplies by TILE)
const SHRINKS_PX = [{ at: 60, r: 1500 }, { at: 150, r: 980 }, { at: 240, r: 560 }, { at: 330, r: 240 }];
const shrinks = SHRINKS_PX.map(s => ({ at: s.at, r: Math.round(s.r / TILE * 100) / 100 }));
const diag = Math.hypot(W, H) * TILE / 2;
console.log(`${W}x${H} map (${W * H} tiles)`);
console.log('tile counts:', Object.fromEntries(Object.entries(counts).sort()));
console.log(`spawns: ${counts.P} | chests: ${counts.C} | crystals: ${counts.Y} | vehicles: ${vehiclesRM.map(v => v.kind).join('/')} | shops: ${counts.S || 0}`);
console.log(`chest loot: ${placedChests.map(c => c.loot).join(', ')}`);
console.log(`zone: start r ${Math.round(diag)}px (diag/2), shrinks ${shrinks.map(s => s.r).join('/')} tiles = ${shrinks.map(s => Math.round(s.r * TILE)).join('/')}px at ${shrinks.map(s => s.at).join('/')}s`);
console.log(grid.map(r => r.join('')).join('\n'));

const def = {
  name: 'The Shattering',
  expedition: true,
  mode: 'br',
  objective: 'Last operative standing — loot the shattered fields and outlive the closing zone',
  time: 420,
  br: { shrinks },
  chests: placedChests.map(c => ({ loot: c.loot })),
  vehicles: vehiclesRM.map(v => ({ kind: v.kind })),
  tiles: grid.map(r => r.join('')),
};
const out = path.join(__dirname, '../levels/br/level22-br.json');
fs.writeFileSync(out, JSON.stringify(def, null, 2) + '\n');
console.log('wrote', out);
