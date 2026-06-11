// Generates levels/level12.json — "Chapter II — Lythium Basin", story chapter 2.
// Deterministic (fixed seed): re-running always produces the same map.
// An 88x60 north-to-south descent through a drowned LYTH refinery basin:
// meadow pockets at the top, then a swamp maze of water channels crossed by
// narrow causeways, stone refinery platforms standing proud of the flood at
// mid-map, leech dens glowing around crystal seams in the lower marsh, and the
// dormant basin Anchor at the southern gate. Crystal-rich — this is the LYTH
// chapter. No boss; the Leeches ARE the economy.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = 88, H = 60;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260612);

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

// --- entry meadow (y 1..7): scattered rock clumps, room to breathe ---
for (let i = 0; i < 5; i++) blob(8 + rnd() * 72, 2 + rnd() * 5, 1.2 + rnd() * 1.4, '#');

// --- four horizontal water bands, wavy, with offset causeway gaps ---
// (gap x positions zigzag band to band so the maze forces lateral travel)
const bands = [
  { y0: 9,  gaps: [20, 44, 68] },
  { y0: 21, gaps: [12, 36, 60, 80] },
  { y0: 39, gaps: [24, 48, 72] },
  { y0: 50, gaps: [16, 44, 70] },
];
for (const band of bands) {
  for (let x = 1; x < W - 1; x++) {
    const wob = Math.round(Math.sin(x * 0.21 + band.y0) * 1.5);
    for (let dy = 0; dy < 3; dy++) set(x, band.y0 + wob + dy, '~');
  }
}

// --- vertical channel spurs between the bands: the maze walls ---
function spur(x, y0, y1) {
  for (let y = y0; y <= y1; y++) { set(x, y, '~'); set(x + 1, y, '~'); }
}
spur(10, 11, 17); spur(32, 11, 16); spur(56, 11, 17); spur(78, 11, 16); // hang from band 1
spur(26, 16, 21); spur(50, 15, 21); spur(72, 16, 21);                   // rise to band 2
spur(12, 42, 47); spur(38, 42, 46); spur(62, 42, 48);                   // hang from band 3
spur(28, 45, 49); spur(52, 46, 49); spur(76, 44, 49);                   // rise to band 4

// --- swampy texture: loose water blobs in the marsh zones ---
for (let i = 0; i < 8; i++) blob(6 + rnd() * 76, 12 + rnd() * 8, 1.2 + rnd() * 1.6, '~', 0.8);
for (let i = 0; i < 10; i++) blob(6 + rnd() * 76, 42 + rnd() * 7, 1.2 + rnd() * 1.8, '~', 0.8);

// --- carve the causeways through their bands (after all water painting) ---
for (const band of bands) {
  for (const gx of band.gaps) {
    for (let y = band.y0 - 3; y <= band.y0 + 5; y++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (get(gx + dx, y) === '~') set(gx + dx, y, '.');
      }
    }
  }
}

// --- refinery platforms (mid-map, stone floors painted at the end) ---
const PLATFORMS = [
  { x0: 8,  x1: 26, y0: 25, y1: 33 },  // west floor
  { x0: 34, x1: 56, y0: 24, y1: 37 },  // central refinery
  { x0: 62, x1: 80, y0: 25, y1: 33 },  // east floor
];
for (const p of PLATFORMS) {
  for (let y = p.y0; y <= p.y1; y++) {
    for (let x = p.x0; x <= p.x1; x++) {
      if (get(x, y) === '~') set(x, y, '.');
    }
  }
}
// central refinery: broken wall ring with four gates
{
  const { x0, x1, y0, y1 } = PLATFORMS[1];
  for (let x = x0; x <= x1; x++) { set(x, y0, '#'); set(x, y1, '#'); }
  for (let y = y0; y <= y1; y++) { set(x0, y, '#'); set(x1, y, '#'); }
  for (const [gx, gy] of [[44, y0], [45, y0], [44, y1], [45, y1], [x0, 30], [x0, 31], [x1, 30], [x1, 31]]) set(gx, gy, '.');
  // collapsed vat housings inside
  for (let x = 38; x <= 41; x++) set(x, 28, '#');
  for (let x = 48; x <= 51; x++) set(x, 33, '#');
  // breach holes in the ring (the flood came through here)
  set(37, y0, '.'); set(52, y1, '.');
}
// wall stubs on the side floors
for (const [sx, sy] of [[12, 26], [22, 31], [66, 31], [76, 26]]) { set(sx, sy, '#'); set(sx + 1, sy, '#'); }
// sandbag lines the crews stacked when the water rose
for (const [sx, sy] of [
  [10, 26], [24, 26], [10, 32], [24, 32],          // west floor corners
  [42, 26], [47, 26], [42, 35], [47, 35],          // central gate flanks
  [64, 26], [78, 26], [64, 32], [78, 32],          // east floor corners
]) set(sx, sy, 'o');

// --- Anchor arena at the southern gate ---
for (let y = 52; y <= 58; y++) for (let x = 38; x <= 52; x++) if (get(x, y) !== '.') set(x, y, '.');
for (const [ex, ey] of [[44, 56], [45, 56], [44, 57], [45, 57]]) set(ex, ey, 'E');

// --- player spawns, north edge ---
for (const [px, py] of [[41, 2], [44, 2], [41, 4], [44, 4]]) set(px, py, 'P');
for (let y = 1; y <= 5; y++) for (let x = 39; x <= 47; x++) if (get(x, y) === '#') set(x, y, '.');

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

// entry meadow + first causeway: light picket
place('g', 20, 5); place('g', 66, 5); place('a', 46, 12);
// upper swamp: skitter packs on the water margins, leeches by the seams
place('w', 8, 11); place('w', 28, 11); place('w', 52, 11); place('w', 74, 11);
place('w', 26, 18); place('w', 50, 17);
place('w', 18, 20); place('w', 42, 20); place('w', 66, 20);
place('s', 15, 13); place('s', 43, 16); place('s', 69, 16);
place('g', 32, 13); place('g', 58, 13); place('g', 18, 18); place('g', 70, 19);
place('r', 24, 16); place('r', 60, 16);
// refinery floors: archers on the stone, snipers on the towers, a spawner nest
place('a', 12, 28); place('a', 20, 30);                  // west floor
place('a', 38, 26); place('a', 50, 26); place('a', 38, 34); place('a', 52, 34); // central
place('a', 66, 28); place('a', 74, 30);                  // east floor
place('n', 45, 32); place('n', 70, 28);
place('m', 14, 29);
place('s', 13, 28); place('s', 73, 28);
// lower swamp: the leech dens — heavy, glowing, rich
place('s', 11, 44); place('s', 35, 45); place('s', 59, 44); place('s', 77, 45);
place('w', 20, 41); place('w', 44, 41); place('w', 68, 41);
place('w', 12, 48); place('w', 36, 48); place('w', 60, 48); place('w', 80, 48);
place('r', 36, 45); place('r', 66, 46); place('r', 46, 42);
place('g', 30, 44); place('g', 54, 47); place('g', 14, 47); place('g', 72, 44);
place('m', 64, 46);
// Anchor approach guards
place('n', 48, 55); place('a', 40, 55);

// --- captives at landmarks (ids bound in row-major scan order) ---
// The seal sits on a hummock at the south mouth of the eastern fourth-band
// causeway — any character reaches her by land, and once rescued her swimming
// turns every channel in the basin into a shortcut.
const captivePlan = [
  ['engineer', 48, 28],  // central refinery floor — she never left the works
  ['volt', 20, 46],      // lower swamp islet, ringed by leech dens
  ['seal', 70, 48],      // causeway-end hummock in leech country, water on three sides
];
const placedCaptives = [];
for (const [id, x, y] of captivePlan) {
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

// Two stranded operators: the leech-hunter by the first causeway teaches the
// chapter's economy (kill Leeches, get rich); the foreman holds the refinery.
const campPlan = [
  {
    x: 39, y: 6,
    npc: {
      id: 'saba-marrow',
      name: 'Saba Marrow, Leech-Hunter',
      lines: [
        'Hsst. Keep low. See them wallowing in the channels? Leeches — fat on stolen LYTH.',
        'They glow gold where they have fed. Kill one and the shards spill right back out.',
        'Slow brutes, but they soak hits like mud soaks rain. Back up, keep firing, get rich.',
        'Skitters run the water margins in packs. Never take them standing in a channel mouth.',
        'Fifteen crystal seams in this basin by my count. Crack every one. The basin owes you.',
      ],
    },
  },
  {
    x: 40, y: 30,
    npc: {
      id: 'foreman-vael',
      name: 'Foreman Eshe Vael',
      lines: [
        'Lythium Basin works. Three hundred hands on shift when the levee gave. One night. All of it under.',
        'The refinery floors still stand proud of the flood. Fight from the stone — the mud belongs to them now.',
        'Two pylons wake this Anchor. One here on my floor, one down at the southern gate. A quorum of two.',
        'Take these. The last seam we ever cut. Build something that outlasts the water.',
        'My crews stacked those sandbags when it rose. Still holding the line. So am I.',
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
  forceSet(at[0] + 1, at[1], '*'); // campfire beside the operator
}
// def.npcs binds to 'N' tiles in row-major scan order
placedNpcs.sort((a, b) => a.y - b.y || a.x - b.x);
const npcs = placedNpcs.map(p => p.npc);

// 2 pylons + 3 causeway barricades + 1 turret
const buildPlan = [
  { kind: 'barricade', cost: 4, x: 44, y: 9 },   // first causeway chokepoint
  { kind: 'pylon', cost: 14, x: 44, y: 30 },     // mid-refinery floor
  { kind: 'turret', cost: 10, x: 45, y: 35 },    // covers the refinery south gate
  { kind: 'barricade', cost: 4, x: 48, y: 39 },  // third-band causeway
  { kind: 'barricade', cost: 4, x: 44, y: 50 },  // final causeway before the gate
  { kind: 'pylon', cost: 14, x: 44, y: 53 },     // before the Anchor
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

// LYTH crystal seams — 15, strung generously down the critical path
const crystalPlan = [
  [38, 5], [50, 7],                       // entry meadow
  [14, 13], [44, 15], [70, 17], [26, 19], // upper swamp
  [12, 27], [52, 26], [74, 29],           // refinery floors
  [10, 44], [34, 46], [58, 44], [78, 46], // lower swamp (leech country)
  [30, 54], [58, 54],                     // Anchor approach
];
for (const [cx, cy] of crystalPlan) forceSet(cx, cy, 'Y');

// --- drowned willows: 13 trees on the banks and hummocks ---
const treePlan = [
  [6, 4], [16, 3], [28, 6], [56, 3], [70, 5], [80, 3], // entry meadow fringe
  [6, 17], [82, 14], [30, 18], [58, 19],               // upper swamp hummocks
  [8, 54], [70, 53], [82, 47],                         // southern banks
];
for (const [tx, ty] of treePlan) forceSet(tx, ty, 'T');

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
  // walk straight north toward spawn, carving blockers, until reaching reached ground
  let cx = x, cy = y;
  let guard = 0;
  while (!seen[cy][cx] && guard++ < 300) {
    if (cy > 3) cy--;
    else if (cx > 41) cx--;
    else cx++;
    if (!PASS(get(cx, cy))) set(cx, cy, '.');
  }
}

const ENTITY = new Set(['P', 'c', 'E', 'g', 'a', 'r', 's', 'm', 'n', 'w', 'b', 'N', 'B', 'Y']);
for (let pass = 0; pass < 10; pass++) {
  const seen = reachableFrom(41, 2);
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
  const seen = reachableFrom(41, 2);
  const unreachable = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (ENTITY.has(get(x, y)) && !seen[y][x]) unreachable.push([get(x, y), x, y]);
  if (unreachable.length) {
    console.error('UNREACHABLE entities remain:', unreachable);
    process.exit(1);
  }
}

// --- paint biome floors by zone (after carving so carved lanes get painted) ---
const onPlatform = (x, y) => PLATFORMS.some(p => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1);
for (let y = 1; y < H - 1; y++) {
  for (let x = 1; x < W - 1; x++) {
    if (get(x, y) !== '.') continue;
    if (onPlatform(x, y)) { set(x, y, ';'); continue; }                 // refinery: worked stone
    if (x >= 38 && x <= 52 && y >= 52) { set(x, y, ';'); continue; }    // Anchor arena: worked stone
    if (y <= 7) continue;                                               // entry meadow keeps '.'
    set(x, y, ':');                                                     // everything else: basin mud
  }
}

const counts = {};
for (const row of grid) for (const c of row) counts[c] = (counts[c] || 0) + 1;
const enemies = 'garsmnwb'.split('').reduce((n, c) => n + (counts[c] || 0), 0);
console.log(`${W}x${H} map (${W * H} tiles)`);
console.log('tile counts:', Object.fromEntries(Object.entries(counts).sort()));
console.log(`enemies: ${enemies} | crystals: ${counts['Y'] || 0} | trees: ${counts['T'] || 0} | leeches: ${counts['s'] || 0}`);
console.log('captives (scan order):', captiveChars.join(', '));
console.log('npcs (scan order):', npcs.map(n => n.id).join(', '));
console.log('builds (scan order):', builds.map(b => b.kind).join(', '));
if ((counts['Y'] || 0) < 14 || (counts['Y'] || 0) > 16) { console.error('crystal count out of brief'); process.exit(1); }
if ((counts['T'] || 0) < 12 || (counts['T'] || 0) > 14) { console.error('tree count out of brief'); process.exit(1); }
if ((counts['s'] || 0) < 8 || (counts['s'] || 0) > 10) { console.error('leech count out of brief'); process.exit(1); }

const def = {
  name: 'Lythium Basin',
  story: true,
  chapter: 2,
  title: 'Chapter II — Lythium Basin',
  expedition: true,
  objective: 'Descend the drowned refinery basin — raise two relay pylons to wake the southern Anchor',
  time: 660,
  intro: [
    {
      title: 'The Drowned Works',
      lines: [
        'The flood took the refinery in one night. The LYTH stayed.',
        'Leeches wallow in the channels, glowing with stolen shards.',
        'Two relays wake the basin Anchor. Keep the signal alive.',
      ],
      art: 'basin',
    },
  ],
  outro: [
    {
      title: 'The Basin Settles',
      lines: [
        'The second Anchor hums under the waterline. Finality spreads.',
        'The foreman stands a long while, watching the channels run clean.',
        'East, past the ash fields, the broken quorum waits.',
      ],
      art: 'basin',
    },
  ],
  captiveChars,
  npcs,
  builds,
  gate: { need: 2 },
  tiles: grid.map(r => r.join('')),
};

// Safety pass: no sleepers inside wake range of the spawn meadow — an idle
// squad at mission start must never be aggroed the moment grace expires.
{
  const spawnTiles = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grid[y][x] === 'P') spawnTiles.push([x, y]);
  const HOT = 11;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!'garsmnwb'.includes(grid[y][x])) continue;
      if (spawnTiles.some(([sx, sy]) => Math.hypot(x - sx, y - sy) < HOT)) grid[y][x] = '.';
    }
  }
  def.tiles = grid.map(r => r.join(''));
}
const out = path.join(__dirname, '../levels/level12.json');
fs.writeFileSync(out, JSON.stringify(def, null, 2) + '\n');
console.log('wrote', out);
