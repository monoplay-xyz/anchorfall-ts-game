// Generates levels/level16.json — "Chapter VI — Final Settlement", the finale.
// Deterministic (fixed seed 20260616): re-running always produces the same map.
// A 90x60 fortified approach WEST->EAST through three escalating defensive
// rings (ash and stone, heavy walls, sandbag lines, tree windbreaks) to the
// great Settlement Anchor in a grand worked-stone plaza. Two Entropy bosses —
// one guarding the second ring's pylon, one in the plaza — plus an elite
// garrison of bulwarks, chargers, snipers and spawners over a grunt host.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = 90, H = 60;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260616);

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

// --- western ashfield (x 2..20): scorched ground, broken stone ---
for (let i = 0; i < 8; i++) blob(5 + rnd() * 14, 4 + rnd() * 52, 1.4 + rnd() * 1.8, '#');

// --- RING 1 (x 22): single heavy wall, full height ---
for (let y = 1; y < H - 1; y++) set(22, y, '#');
// tree windbreaks flanking ring 1
for (let y = 4; y <= 24; y++) if (y % 3 !== 1) set(20, y, 'T');
for (let y = 36; y <= 56; y++) if (y % 3 !== 1) set(20, y, 'T');
// sandbag line in front of the main gate (gap kept at y 28..31)
for (const y of [24, 25, 26, 33, 34, 35]) set(18, y, 'o');

// --- first interior (x 23..49): ash and stone rubble ---
for (let i = 0; i < 11; i++) blob(26 + rnd() * 22, 4 + rnd() * 52, 1.3 + rnd() * 2.0, '#');
// short windbreak rows
for (let x = 28; x <= 44; x++) if (x % 5 !== 2) { set(x, 14, 'T'); set(x, 46, 'T'); }

// --- RING 2 (x 50..51): double heavy wall, full height ---
for (let y = 1; y < H - 1; y++) { set(50, y, '#'); set(51, y, '#'); }
// sandbag line before the second gate
for (const y of [24, 25, 26, 33, 34, 35]) set(47, y, 'o');

// --- second interior (x 52..70): garrison ground, windbreak rows ---
for (let i = 0; i < 8; i++) blob(54 + rnd() * 15, 4 + rnd() * 52, 1.2 + rnd() * 1.8, '#');
for (let x = 54; x <= 69; x++) if (x % 6 !== 3) { set(x, 20, 'T'); set(x, 40, 'T'); }
// guarded pocket for the last operator (atlas), north
for (let x = 61; x <= 67; x++) set(x, 9, '#');
for (const y of [10, 11, 12]) { set(61, y, '#'); set(67, y, '#'); }
for (let x = 61; x <= 67; x++) set(x, 13, '#');
set(64, 13, '.'); // pocket mouth

// --- RING 3 (x 72..73): double heavy wall around the plaza ---
for (let y = 1; y < H - 1; y++) { set(72, y, '#'); set(73, y, '#'); }
// sandbag line before the great gate
for (const y of [24, 25, 26, 33, 34, 35]) set(69, y, 'o');

// --- the grand plaza (x 74..88, y 16..44) ---
for (let y = 16; y <= 44; y++) for (let x = 74; x <= 88; x++) if (get(x, y) !== '.') set(x, y, '.');
// colonnade pillars — cover, but room to fight
for (const [px, py] of [[77, 21], [77, 39], [81, 21], [81, 39], [77, 26], [77, 34]]) set(px, py, '#');
// inner sandbag fighting line
for (const y of [26, 27, 33, 34]) set(79, y, 'o');
// back country behind the plaza walls (north/south of the plaza band): wild trees
for (let i = 0; i < 5; i++) blob(76 + rnd() * 11, 3 + rnd() * 10, 1.4 + rnd() * 1.6, 'T');
for (let i = 0; i < 5; i++) blob(76 + rnd() * 11, 47 + rnd() * 10, 1.4 + rnd() * 1.6, 'T');

// --- gates (cleared after all wall/blob painting) ---
const clearRect = (x0, x1, y0, y1) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, '.');
};
clearRect(21, 23, 28, 30);   // ring 1 main gate
clearRect(21, 23, 10, 11);   // ring 1 north sally port
clearRect(21, 23, 48, 49);   // ring 1 south sally port
clearRect(49, 52, 28, 30);   // ring 2 main gate
clearRect(49, 52, 46, 47);   // ring 2 south sally port
clearRect(71, 74, 28, 31);   // ring 3 great gate (4 wide)
clearRect(71, 74, 18, 19);   // ring 3 north postern

// --- Settlement Anchor: the 4-tile E cluster in the plaza ---
for (const [ex, ey] of [[84, 29], [85, 29], [84, 30], [85, 30]]) set(ex, ey, 'E');

// --- player spawns, west edge ---
for (const [px, py] of [[3, 28], [3, 31], [5, 28], [5, 31]]) set(px, py, 'P');
for (let y = 26; y <= 33; y++) for (let x = 2; x <= 8; x++) if (get(x, y) !== '.' && get(x, y) !== 'P') set(x, y, '.');

// --- enemies (~60: elite garrison over a grunt host) ---
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

// ashfield pickets: grunts probing the road west
for (let i = 0; i < 8; i++) place('g', 5 + rnd() * 13, 5 + rnd() * 50);
// ring 1 gate guard
place('s', 24, 29);
place('g', 25, 27); place('g', 25, 31); place('g', 24, 12);
place('n', 26, 25);
// first interior: grunt host plus a charger
for (let i = 0; i < 9; i++) place('g', 26 + rnd() * 21, 5 + rnd() * 50);
place('r', 40, 30);
// ring 2: the mid-map boss guards the second ring's pylon
place('b', 55, 30);
place('s', 53, 28); place('s', 53, 31);
place('m', 57, 36);
place('n', 54, 24);
// second interior: elite garrison
for (let i = 0; i < 10; i++) place('g', 53 + rnd() * 16, 5 + rnd() * 50);
place('r', 60, 24); place('r', 60, 36); place('r', 66, 30);
place('n', 63, 21);
place('m', 66, 43);
// the last operator's jailers
place('g', 63, 11); place('g', 65, 11);
// ring 3 great gate guard
place('g', 70, 28); place('g', 70, 31); place('g', 71, 19); place('g', 70, 24);
// plaza: the final boss and his court
place('b', 81, 30);
place('s', 75, 29); place('s', 75, 31);
place('n', 80, 22);
for (let i = 0; i < 8; i++) place('g', 75 + rnd() * 12, 18 + rnd() * 24);

// --- captive: atlas, the last operator, in the north pocket ---
const captivePlan = [['atlas', 64, 11]];
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

// Two voices at the end of the road: Old Tarn, back from the swamp, and a
// quiet settler at the gates of the plaza who speaks the creed.
const campPlan = [
  {
    x: 33, y: 31,
    npc: {
      id: 'old-tarn',
      name: 'Old Tarn',
      lines: [
        'You. Thought the swamp kept you. Then I thought the road did. Glad to be wrong twice.',
        'Take these — saved them since the crossing. The LYTH remembers everyone who ever carried it.',
        'Two pylons this time, one in each outer ring. Both lit, or the settlement gate stays cold.',
        'The rings were raised to keep the Entropy out. Now it mans the walls. Funny old frontier.',
        'Snipers nest along the windbreaks — slip through the tree gaps and they go blind.',
        "Settle it for good, operator. I'm done walking.",
      ],
      gift: { shards: 8 },
    },
  },
  {
    x: 68, y: 31,
    npc: {
      id: 'quiet-settler',
      name: 'The Quiet Settler',
      lines: [
        'We held this gate with a whisper, not a wall: keep the signal alive.',
        'Say it once and you are one of us. Keep the signal alive.',
        'Light both pylons before you touch the Anchor — a quorum will not open for half a promise.',
        'The guardian in the plaza watches the great gate. The colonnade shadows do not watch back.',
        'When the Anchor settles, finality spreads. Out here we just call it morning.',
      ],
    },
  },
];
const placedNpcs = [];
for (const camp of campPlan) {
  const at = forceSet(camp.x, camp.y, 'N');
  if (!at) { console.error('failed to place npc', camp.npc.id); process.exit(1); }
  placedNpcs.push({ x: at[0], y: at[1], npc: camp.npc });
  forceSet(at[0] + 1, at[1], '*'); // campfire beside them
}
placedNpcs.sort((a, b) => a.y - b.y || a.x - b.x);
const npcs = placedNpcs.map(p => p.npc);

// 2 pylons (one per outer ring) + 2 barricades + 2 turrets
const buildPlan = [
  { kind: 'pylon', cost: 15, x: 26, y: 32 },     // inside ring 1
  { kind: 'pylon', cost: 15, x: 54, y: 33 },     // inside ring 2, under the boss's eye
  { kind: 'barricade', cost: 4, x: 20, y: 29 },  // ring 1 gate mouth
  { kind: 'barricade', cost: 4, x: 49, y: 31 },  // ring 2 gate mouth
  { kind: 'turret', cost: 10, x: 56, y: 28 },    // covers the second interior
  { kind: 'turret', cost: 10, x: 76, y: 30 },    // plaza approach
];
const placedBuilds = [];
for (const b of buildPlan) {
  const at = forceSet(b.x, b.y, 'B');
  if (!at) { console.error('failed to place build site', b.kind); process.exit(1); }
  placedBuilds.push({ x: at[0], y: at[1], kind: b.kind, cost: b.cost });
}
placedBuilds.sort((a, b) => a.y - b.y || a.x - b.x);
const builds = placedBuilds.map(b => ({ kind: b.kind, cost: b.cost }));

// 12 LYTH crystal nodes, generous along the critical west->east path
const crystalPlan = [
  [9, 22], [12, 38],                       // ashfield
  [27, 24], [33, 38], [42, 18], [44, 44],  // first interior
  [55, 16], [58, 44], [64, 26], [68, 36],  // second interior
  [78, 20], [78, 40],                      // plaza flanks
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
    else if (cy > 29) cy--;
    else cy++;
    if (!PASS(get(cx, cy))) set(cx, cy, '.');
  }
}

const ENTITY = new Set(['P', 'c', 'E', 'g', 'a', 'r', 's', 'm', 'n', 'w', 'b', 'N', 'B', 'Y']);
for (let pass = 0; pass < 10; pass++) {
  const seen = reachableFrom(3, 28);
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
  const seen = reachableFrom(3, 28);
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
for (let y = 1; y < H - 1; y++) {
  for (let x = 1; x < W - 1; x++) {
    if (get(x, y) !== '.') continue;
    if (x >= 74) { set(x, y, ';'); continue; }                 // grand plaza: worked stone
    if (x >= 52) { set(x, y, ','); continue; }                 // second interior: garrison ground
    if (x >= 23) { set(x, y, rnd() < 0.2 ? '_' : '.'); continue; } // first interior: stone with ash drifts
    set(x, y, '_');                                            // western ashfield: scorched
  }
}

// --- stats ---
const counts = {};
for (const row of grid) for (const c of row) counts[c] = (counts[c] || 0) + 1;
const enemyLetters = ['g', 'a', 'r', 's', 'm', 'n', 'w', 'b'];
const enemyTotal = enemyLetters.reduce((n, c) => n + (counts[c] || 0), 0);
const SHARD_DROPS = { g: 1, a: 1, w: 1, r: 2, n: 2, s: 2, m: 3, b: 12 };
const killIncome = enemyLetters.reduce((n, c) => n + (counts[c] || 0) * SHARD_DROPS[c], 0);
const pylonBill = builds.filter(b => b.kind === 'pylon').reduce((n, b) => n + b.cost, 0);
const crystalIncome = (counts['Y'] || 0) * 4;
const giftIncome = npcs.reduce((n, p) => n + ((p.gift && p.gift.shards) || 0), 0);
console.log(`${W}x${H} map (${W * H} tiles)`);
console.log('tile counts:', Object.fromEntries(Object.entries(counts).sort()));
console.log(`enemies: ${enemyTotal} (g:${counts.g || 0} r:${counts.r || 0} s:${counts.s || 0} n:${counts.n || 0} m:${counts.m || 0} b:${counts.b || 0})`);
console.log(`economy: pylon bill ${pylonBill} vs crystals ${crystalIncome} + gifts ${giftIncome} + 50% kills ${Math.floor(killIncome / 2)} = ${crystalIncome + giftIncome + Math.floor(killIncome / 2)}`);
console.log('captives (scan order):', captiveChars.join(', '));
console.log('npcs (scan order):', npcs.map(n => n.id).join(', '));
console.log('builds (scan order):', builds.map(b => b.kind).join(', '));
console.log(grid.map(r => r.join('')).join('\n'));

const def = {
  name: 'Final Settlement',
  story: true,
  chapter: 6,
  title: 'Chapter VI — Final Settlement',
  expedition: true,
  objective: 'Breach the three rings and raise the Settlement Anchor — bring the expedition home',
  time: 780,
  captiveChars,
  npcs,
  builds,
  gate: { need: 2 },
  intro: [
    {
      title: 'Chapter VI — Final Settlement',
      lines: [
        'Three rings of stone stand between the expedition and the great Settlement Anchor.',
        'The Entropy garrisons every wall it ever broke.',
        'One last march. Keep the signal alive.',
      ],
      art: 'settlement',
    },
  ],
  outro: [
    {
      title: 'The Anchor Settles',
      lines: [
        'Light walks outward from the plaza, ring by ring.',
        'Finality spreads across the frontier like a slow dawn.',
        'The land remembers itself.',
      ],
      art: 'dawn',
    },
    {
      title: 'Home',
      lines: [
        "Wrenna's quorum sings. Tarn's odds finally come good.",
        'The settlement Anchor holds. The frontier is anchored for good — the expedition is home.',
      ],
      art: 'anchorcraft',
    },
  ],
  modifiers: { waves: [{ at: 420, letters: 'rrssgg', edge: 'w' }] },
  tiles: grid.map(r => r.join('')),
};
const out = path.join(__dirname, '../levels/level16.json');
fs.writeFileSync(out, JSON.stringify(def, null, 2) + '\n');
console.log('wrote', out);
