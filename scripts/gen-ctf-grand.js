// Generates levels/ctf/level23-grand.json — "Grand Relays" (versus: 16v16 CTF).
// Deterministic (fixed seed 20261207): re-running always produces the same map,
// byte for byte. A 120x72 mirror-symmetric battlefield (gen-ctf's mirror trick:
// the WEST half is generated, then reflected tile-for-tile onto the east half)
// built for the 32-player cap: THREE lanes with different risk/time tradeoffs.
//
//   NORTH RIDGE   (y ~5..20)  rock chokepoints + copses — cover-rich ambush
//                             lane, two 2-wide passes; slower, safer approach.
//   MID FIELD     (y ~22..49) the gate-to-gate boulevard through the contested
//                             center plaza — fastest, longest sightlines,
//                             turret build sites cover both gates.
//   SOUTH CANAL   (y ~51..66) a skiff canal: 2 skiffs per side give fast water
//                             transit (mounting DROPS a carried flag, so it is
//                             a raid/rotate lane, never a carry lane); the
//                             island hoard mid-canal is a skiff run by design.
//
// 32-PLAYER CONTRACT (verified against shared/game.js):
//   CTF deploys/respawns every seat on its team stand's spawn ring
//   (ctfStandSpot: 8/16/16 slots at 1.25/2.25/3.25 tiles). Each stand sits in
//   a clear parade plaza so all 40 candidate slots are open — 16 seats per
//   stand deploy unstuck and deterministic. Flag-to-flag straight distance is
//   101 tiles (contract wants 95+).
//
// SPAWN <-> TEAM CONTRACT (same as Twin Relays):
//   the first 'D' in row-major scan is team 0 (west); each 'P' row carries a
//   LEFT P then a RIGHT P so spawn scan order alternates west/east.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = 120, H = 72;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261207);

const grid = Array.from({ length: H }, () => Array(W).fill('.'));
const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const get = (x, y) => (inBounds(x, y) ? grid[y][x] : '#');
const set = (x, y, c) => { if (inBounds(x, y)) grid[y][x] = c; };
const mirrorX = (x) => W - 1 - x;

// ============================================================
// WEST HALF (x 0..59). Mirrored onto x 60..119 afterwards.
// ============================================================

// --- organic silhouette: north mountains (depth 2..4, noisy tree fringe) ---
for (let x = 0; x < 60; x++) {
  const depth = 2 + Math.floor(rnd() * 3); // rows 0..(depth-1) are rock
  for (let y = 0; y < depth; y++) set(x, y, '#');
  if (rnd() < 0.3 && get(x, depth) === '.') set(x, depth, 'T');
}
// --- west cliff edge: cols 0..1 solid, col 2 noisy blobs outside the fort ---
for (let y = 0; y < H; y++) {
  set(0, y, '#'); set(1, y, '#');
  if (rnd() < 0.45 && !(y >= 26 && y <= 47)) set(2, y, '#');
}
// --- south marsh fringe: noisy rock/water/reeds, then the border shelf ---
for (let y = 67; y <= 69; y++) {
  for (let x = 2; x < 60; x++) {
    const r = rnd();
    if (r < 0.15) set(x, y, '#');
    else if (r < 0.45) set(x, y, '~');
    else if (r < 0.58) set(x, y, 'T');
    else if (r < 0.66) set(x, y, '_');
  }
}
for (let x = 0; x < 60; x++) { set(x, 70, '#'); set(x, 71, '#'); }

// --- west relay fort: x 2..20, y 26..47 ---
// Worked-stone parade ground; posterns north/south at x 10..12; the main
// gate east at y 34..38. The flag plaza (x 4..15, y 31..42) stays clear so
// the 16-seat spawn ring always has open slots.
for (let y = 27; y <= 46; y++) for (let x = 2; x <= 19; x++) set(x, y, ';');
for (let x = 2; x <= 20; x++) {
  if (x < 10 || x > 12) { set(x, 26, '#'); set(x, 47, '#'); }
}
for (let y = 26; y <= 47; y++) {
  if (y < 34 || y > 38) set(20, y, '#');
}
// organic wall bumps at the shoulders
for (const [bx, by] of [[3, 25], [17, 25], [3, 48], [17, 48]]) set(bx, by, '#');
// stable rails beside the stag stalls (sandbags: shots fly over, feet do not)
for (const [sx, sy] of [[5, 44], [7, 44], [11, 44], [13, 44]]) set(sx, sy, 'o');

// --- inner ridge wall y=21: gaps at x 10..12 (postern), 36..38, 57..59 ---
for (let x = 2; x < 60; x++) {
  if ((x >= 10 && x <= 12) || (x >= 36 && x <= 38) || x >= 57) continue;
  set(x, 21, '#');
  if (rnd() < 0.18 && x > 13 && x < 35) set(x, 22, '#'); // noisy footing
}
// --- ridge chokepoint stubs: pass A rows 12..13 at x 29..30, pass B rows
// 8..9 at x 47..48 (the lane wanders north between them) ---
for (const x of [29, 30]) {
  for (let y = 2; y <= 11; y++) set(x, y, '#');
  for (let y = 14; y <= 20; y++) set(x, y, '#');
}
for (const x of [47, 48]) {
  for (let y = 2; y <= 7; y++) set(x, y, '#');
  for (let y = 10; y <= 20; y++) set(x, y, '#');
}
// sandbag flanks covering the pass mouths
for (const [sx, sy] of [[31, 11], [31, 14], [49, 7], [49, 10]]) set(sx, sy, 'o');

// --- levee y=50: gaps mirror the ridge wall (x 10..12, 36..38, 57..59) ---
for (let x = 2; x < 60; x++) {
  if ((x >= 10 && x <= 12) || (x >= 36 && x <= 38) || x >= 57) continue;
  set(x, 50, '#');
}

// --- the canal: water band y 58..63, organic edges, a bank-pinch choke ---
for (let y = 58; y <= 63; y++) for (let x = 4; x < 60; x++) set(x, y, '~');
for (let x = 4; x < 60; x++) {
  const dock = x >= 12 && x <= 18;      // keep the dock front wet + the pad dry
  const island = x >= 54;               // keep the island ring honest water
  const rTop = rnd(), rBot = rnd();
  if (!dock && rTop < 0.28) set(x, 57, '~');          // north bite
  else if (!dock && !island && rTop < 0.55) set(x, 58, '.'); // north shore bump
  if (rBot < 0.28) set(x, 64, '~');                   // south bite
  else if (!island && rBot < 0.55) set(x, 63, '.');   // south shore bump
}
// bank-pinch: the canal swells north at x 38..42 (corridor narrows to 3 rows)
for (let y = 54; y <= 57; y++) for (let x = 38; x <= 42; x++) set(x, y, '~');
// --- the mid-canal island (west half; the mirror completes it) ---
for (let y = 60; y <= 61; y++) for (let x = 57; x < 60; x++) set(x, y, ';');
set(57, 60, 'T'); // a little cover on the hoard
// --- docks: stone pad with two skiff moors, water at its feet ---
for (let y = 55; y <= 57; y++) for (let x = 13; x <= 17; x++) set(x, y, ';');

// --- midfield fixed cover (x 21..56, y 22..49) ---
// pillar blocks
for (let y = 27; y <= 28; y++) for (let x = 28; x <= 29; x++) set(x, y, '#');
for (let y = 44; y <= 45; y++) for (let x = 28; x <= 29; x++) set(x, y, '#');
for (let y = 30; y <= 31; y++) for (let x = 44; x <= 45; x++) set(x, y, '#');
for (let y = 41; y <= 42; y++) for (let x = 44; x <= 45; x++) set(x, y, '#');
// tree copses (off the road rows 35..37)
for (const [tx, ty] of [[33, 32], [34, 32], [35, 33], [33, 40], [34, 40], [35, 39], [24, 23], [25, 24]]) set(tx, ty, 'T');
// sandbag funnel outside the fort gate + arcs at the plaza mouth
for (const [sx, sy] of [[22, 32], [23, 33], [22, 40], [23, 39], [51, 33], [52, 33], [51, 39], [52, 39]]) set(sx, sy, 'o');
// center plaza: a worked-stone disc straddling the seam, twin gate posts
for (let y = 30; y <= 43; y++) {
  for (let x = 52; x < 60; x++) {
    const dx = x - 59.5, dy = y - 36.5;
    if (dx * dx + dy * dy <= 33) set(x, y, ';');
  }
}
set(56, 32, '#'); set(56, 41, '#');

// --- deterministic scatter: overgrowth, reeds and burn scars ---
for (let i = 0; i < 34; i++) { // ridge
  const x = 3 + Math.floor(rnd() * 57), y = 4 + Math.floor(rnd() * 17);
  if (get(x, y) === '.') set(x, y, rnd() < 0.55 ? 'T' : '_');
}
for (let i = 0; i < 60; i++) { // midfield + foothill strips
  const x = 21 + Math.floor(rnd() * 39), y = 22 + Math.floor(rnd() * 28);
  if (get(x, y) === '.') set(x, y, rnd() < 0.38 ? 'T' : '_');
}
for (let i = 0; i < 26; i++) { // north bank reeds
  const x = 4 + Math.floor(rnd() * 56), y = 51 + Math.floor(rnd() * 7);
  if (get(x, y) === '.') set(x, y, rnd() < 0.5 ? 'T' : '_');
}
for (let i = 0; i < 20; i++) { // south bank reeds
  const x = 4 + Math.floor(rnd() * 56), y = 64 + Math.floor(rnd() * 3);
  if (get(x, y) === '.') set(x, y, rnd() < 0.5 ? 'T' : '_');
}
for (let i = 0; i < 12; i++) { // shell scars on the fort approach
  const x = 21 + Math.floor(rnd() * 13), y = 27 + Math.floor(rnd() * 20);
  if (get(x, y) === '.') set(x, y, '_');
}

// --- roads and lane clears (carved after scatter so nothing seals a lane) ---
const clearBlock = (x, y) => { if ('#To_'.includes(get(x, y))) set(x, y, '.'); };
// MID: gate road to the plaza
for (let y = 35; y <= 37; y++) for (let x = 20; x < 60; x++) set(x, y, ';');
// posterns: north road up to the ridge, south road down to the bank
for (let y = 15; y <= 26; y++) for (let x = 10; x <= 12; x++) set(x, y, ';');
for (let y = 47; y <= 53; y++) for (let x = 10; x <= 12; x++) set(x, y, ';');
// center crossings: plaza to the ridge gap and down to the bank
for (let y = 21; y <= 30; y++) for (let x = 57; x < 60; x++) set(x, y, ';');
for (let y = 43; y <= 53; y++) for (let x = 57; x < 60; x++) set(x, y, ';');
// mid crossings at x 36..38 (ridge wall + levee gaps onto open ground)
for (let y = 22; y <= 25; y++) for (let x = 36; x <= 38; x++) clearBlock(x, y);
for (let x = 36; x <= 38; x++) { set(x, 21, '.'); set(x, 50, '.'); }
for (let y = 48; y <= 53; y++) for (let x = 36; x <= 38; x++) clearBlock(x, y);
// RIDGE: the wandering corridor (south rows west, north rows east) + passes
for (let y = 12; y <= 13; y++) for (let x = 3; x <= 46; x++) clearBlock(x, y);
for (let y = 8; y <= 13; y++) for (let x = 44; x <= 46; x++) clearBlock(x, y);
for (let y = 8; y <= 9; y++) for (let x = 47; x < 60; x++) clearBlock(x, y);
for (let y = 12; y <= 13; y++) for (const x of [29, 30]) set(x, y, '.');
for (let y = 8; y <= 9; y++) for (const x of [47, 48]) set(x, y, '.');
// CANAL: the bank corridor stays walkable, dock approach open
for (let y = 52; y <= 53; y++) for (let x = 4; x < 60; x++) clearBlock(x, y);
for (let x = 13; x <= 17; x++) clearBlock(x, 54);

// ============================================================
// MIRROR: east half (x 60..119) = west half reflected.
// ============================================================
for (let y = 0; y < H; y++)
  for (let x = 60; x < W; x++)
    grid[y][x] = grid[y][mirrorX(x)];

// hard border (rows 0/71 and cols 0/119 are already solid; reassert)
for (let x = 0; x < W; x++) { set(x, 0, '#'); set(x, H - 1, '#'); }
for (let y = 0; y < H; y++) { set(0, y, '#'); set(W - 1, y, '#'); }

// ============================================================
// ENTITIES — explicit mirror pairs after the reflection. Loot/kind specs are
// registered by coordinate and re-read in row-major scan order at the end,
// so def.chests / def.vehicles / def.builds can never drift from the tiles.
// ============================================================
const lootAt = new Map(), vehicleAt = new Map(), buildAt = new Map();
const key = (x, y) => x + ',' + y;
function put(x, y, c) {
  if (get(x, y) === 'T' || get(x, y) === '_') set(x, y, '.'); // soft scatter yields
  if ('#~o'.includes(get(x, y))) {
    console.error(`refusing to drop '${c}' on blocked tile ${x},${y} (${get(x, y)})`);
    process.exit(1);
  }
  set(x, y, c);
}
function pair(x, y, c, spec) {
  put(x, y, c); put(mirrorX(x), y, c);
  if (spec) { lootAt.set(key(x, y), spec); lootAt.set(key(mirrorX(x), y), spec); }
}
function pairV(x, y, kind) {
  put(x, y, 'V'); put(mirrorX(x), y, 'V');
  vehicleAt.set(key(x, y), kind); vehicleAt.set(key(mirrorX(x), y), kind);
}
function pairB(x, y, spec) {
  put(x, y, 'B'); put(mirrorX(x), y, 'B');
  buildAt.set(key(x, y), spec); buildAt.set(key(mirrorX(x), y), spec);
}

// Flag stands: west 'D' scans first -> team 0 = west base. 101 tiles apart.
pair(9, 36, 'D');
// Spawns: one LEFT + RIGHT pair per row -> scan order alternates teams.
for (const py of [33, 35, 37, 39]) pair(4, py, 'P');
// Shops: one per base, by the north parade wall.
pair(6, 29, 'S');
// Turret build sites: two per base, flanking the main gate from inside
// (10+ tiles off the stand — a finished turret can never crowd the ring).
pairB(18, 31, { kind: 'turret', cost: 10 });
pairB(18, 41, { kind: 'turret', cost: 10 });
// Stables: two stags per base on the south parade (4 stags total)...
pairV(6, 43, 'stag');
pairV(12, 43, 'stag');
// ...and two skiffs per side at the docks (moored on the pad, water at y 58).
pairV(14, 57, 'skiff');
pairV(16, 57, 'skiff');
// Chests: ridge pass pair, mid-road bait pair, contested plaza pair, and the
// island hoard (skiff run by design — mounting drops a carried flag).
pair(34, 12, 'C', { loot: 'cracker', amount: 2 });
pair(40, 36, 'C', { loot: 'shield', amount: 1 });
pair(56, 36, 'C', { loot: 'shards', amount: 8 });
pair(58, 61, 'C', { loot: 'shards', amount: 10 });
// LYTH crystals: the team-shard economy, strung along all three lanes.
pair(52, 17, 'Y');  // ridge, past the second pass
pair(30, 55, 'Y');  // north bank
pair(46, 27, 'Y');  // midfield north shoulder
pair(46, 45, 'Y');  // midfield south shoulder
pair(54, 34, 'Y');  // plaza rim
pair(54, 38, 'Y');  // plaza rim

// ============================================================
// CONNECTIVITY — every entity afoot-reachable from the first spawn EXCEPT the
// island chests (skiff runs, validated via sea-reach below). Any carve is
// applied to BOTH halves so the mirror never breaks; carves walk vertical-
// first toward the road band and never touch the canal rows.
// ============================================================
const PASS = c => c !== '#' && c !== 'T' && c !== '~' && c !== 'o' && c !== '%';
const ENTITY = new Set(['P', 'D', 'S', 'V', 'C', 'B', 'Y']);
const skiffOnly = (x, y) => y >= 58 && y <= 63; // the island hoard rows
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
  let cx = x, cy = y, guard = 0;
  while (!seen[cy][cx] && guard++ < 400) {
    if (cy > 38) cy--;
    else if (cy < 34) cy++;
    else if (cx < 59 && cx < mirrorX(cx)) cx++;
    else if (cx > 60) cx--;
    else break;
    if (cy >= 58 && cy <= 63) break; // never bridge the canal
    if (!PASS(get(cx, cy)) && get(cx, cy) !== '~' && cx > 1 && cy > 1 && cx < W - 2 && cy < H - 2) {
      set(cx, cy, ';');
      set(mirrorX(cx), cy, ';');
    }
  }
}
for (let p = 0; p < 10; p++) {
  const seen = reachableFrom(4, 33);
  let bad = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (ENTITY.has(get(x, y)) && !skiffOnly(x, y) && !seen[y][x]) { bad++; carveTo(x, y, seen); }
  if (!bad) break;
}
const seen = reachableFrom(4, 33);
{
  const unreachable = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (ENTITY.has(get(x, y)) && !skiffOnly(x, y) && !seen[y][x]) unreachable.push([get(x, y), x, y]);
  if (unreachable.length) {
    console.error('UNREACHABLE entities remain:', unreachable);
    process.exit(1);
  }
}

// --- sea-reach: the island hoard must be coverable by a walk-reached skiff
// (the validator's law: flood '~' + shore outward from each reachable skiff) ---
{
  const seaSeen = seen.map(r => r.slice());
  const q = [];
  for (const [k] of vehicleAt) {
    if (vehicleAt.get(k) !== 'skiff') continue;
    const [x, y] = k.split(',').map(Number);
    if (!seen[y][x]) { console.error(`skiff at ${k} not walk-reachable`); process.exit(1); }
    q.push([x, y]);
  }
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny) || seaSeen[ny][nx]) continue;
      const t = get(nx, ny);
      if (t === '~' || PASS(t)) { seaSeen[ny][nx] = true; q.push([nx, ny]); }
    }
  }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (get(x, y) === 'C' && !seaSeen[y][x]) {
        console.error(`island chest at ${x},${y} unreachable even by skiff`);
        process.exit(1);
      }
  // the canal itself must run dock to dock (one connected body of water)
  const wet = (x, y) => seaSeen[y][x] && get(x, y) === '~';
  for (const [cx, cy] of [[14, 58], [105, 58], [58, 59], [61, 62]]) {
    if (!wet(cx, cy)) { console.error(`canal severed at ${cx},${cy}`); process.exit(1); }
  }
}

// --- spawn-ring audit: both stands must offer 16+ open ring slots (the sim's
// ctfStandSpot rings: 8/16/16 slots at 1.25/2.25/3.25 tiles; a slot is open
// when no player-circle corner overlaps a blocker) ---
{
  const TILE = 48, PR = 14;
  const blocked = c => c === '#' || c === 'T' || c === '~' || c === 'o' || c === '%';
  const openAt = (px, py) => {
    for (const [ox, oy] of [[-PR, -PR], [PR, -PR], [-PR, PR], [PR, PR]]) {
      const tx = Math.floor((px + ox) / TILE), ty = Math.floor((py + oy) / TILE);
      if (!inBounds(tx, ty) || blocked(grid[ty][tx])) return false;
    }
    return true;
  };
  for (const [fx, fy] of [[9, 36], [110, 36]]) {
    const cx = (fx + 0.5) * TILE, cy = (fy + 0.5) * TILE;
    let open = 0;
    for (const [n, r] of [[8, 1.25], [16, 2.25], [16, 3.25]]) {
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
        if (openAt(cx + Math.cos(a) * r * TILE, cy + Math.sin(a) * r * TILE)) open++;
      }
    }
    if (open < 32) { console.error(`stand at ${fx},${fy}: only ${open}/40 ring slots open`); process.exit(1); }
    console.log(`stand ${fx},${fy}: ${open}/40 ring slots open`);
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
if (flags.length !== 2 || flags[0][1] >= 60 || flags[1][1] < 60) {
  console.error('flag scan order broken:', flags); process.exit(1);
}
const flagDist = Math.abs(flags[1][1] - flags[0][1]);
if (flagDist < 95) { console.error(`flags only ${flagDist} tiles apart (need 95+)`); process.exit(1); }
if (spawns.length !== 8 || !spawns.every(([, x], i) => (i % 2 === 0 ? x < 60 : x >= 60))) {
  console.error('spawn scan order must alternate west/east:', spawns); process.exit(1);
}

// --- lane report: BFS step-distance west stand -> each seam crossing; a full
// lane is twice that (mirror symmetry) plus the seam step itself ---
{
  const dist = Array.from({ length: H }, () => Array(W).fill(-1));
  const q = [[9, 36]]; dist[36][9] = 0;
  for (let head = 0; head < q.length; head++) {
    const [x, y] = q[head];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (inBounds(nx, ny) && dist[ny][nx] === -1 && PASS(get(nx, ny))) {
        dist[ny][nx] = dist[y][x] + 1;
        q.push([nx, ny]);
      }
    }
  }
  const lanes = [['ridge', 59, 12], ['mid', 59, 36], ['canal bank', 59, 52]];
  for (const [name, x, y] of lanes) {
    if (dist[y][x] === -1) { console.error(`lane '${name}' severed at ${x},${y}`); process.exit(1); }
    console.log(`lane ${name}: stand->seam ${dist[y][x]} steps (~${dist[y][x] * 2 + 1} flag-to-flag afoot)`);
  }
}

const counts = {};
for (const row of grid) for (const c of row) counts[c] = (counts[c] || 0) + 1;
console.log(grid.map(r => r.join('')).join('\n'));
console.log(`${W}x${H} map (${W * H} tiles), flags ${flagDist} tiles apart`);
console.log('tile counts:', Object.fromEntries(Object.entries(counts).sort()));
console.log('spawn scan order (i -> team i%2):', spawns.map(([, x, y], i) => `#${i}:${x},${y}=${x < 60 ? 'W/t0' : 'E/t1'}`).join(' '));
console.log('flags (scan order):', flags.map(([, x, y], i) => `team${i}@${x},${y}`).join(' '));

// --- row-major def arrays, read straight off the final grid ---
const chests = [], vehicles = [], builds = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const c = grid[y][x], k = key(x, y);
    if (c === 'C') {
      if (!lootAt.has(k)) { console.error(`chest at ${k} has no loot spec`); process.exit(1); }
      chests.push(lootAt.get(k));
    } else if (c === 'V') {
      if (!vehicleAt.has(k)) { console.error(`vehicle at ${k} has no kind`); process.exit(1); }
      vehicles.push({ kind: vehicleAt.get(k) });
    } else if (c === 'B') {
      if (!buildAt.has(k)) { console.error(`build site at ${k} has no spec`); process.exit(1); }
      builds.push(buildAt.get(k));
    }
  }
}
console.log('chests (scan order):', chests.map(c => `${c.loot}x${c.amount}`).join(', '));
console.log('vehicles (scan order):', vehicles.map(v => v.kind).join(', '));
console.log('builds (scan order):', builds.map(b => `${b.kind}:${b.cost}`).join(', '));

const def = {
  name: 'Grand Relays',
  title: 'Versus — Grand Relays',
  objective: 'Ridge, field or canal — run the enemy banner home; first to 3 captures takes the day',
  time: 480,
  mode: 'ctf',
  expedition: true,
  captiveChars: [],
  chests,
  vehicles,
  builds,
  tiles: grid.map(r => r.join('')),
};
const out = path.join(__dirname, '../levels/ctf/level23-grand.json');
fs.writeFileSync(out, JSON.stringify(def, null, 2) + '\n');
console.log('wrote', out);
