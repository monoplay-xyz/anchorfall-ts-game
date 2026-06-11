// Generates levels/level18.json — "Chapter VIII — The Prover Array", the Act II
// finale. Deterministic (fixed seed 20260618): re-running always reproduces it.
// A 96x60 shard-world of vast prover fields split by impassable chasms that are
// crossed ONLY via a four-pair Settled Corridor (teleport) network:
//
//   B  forge camp (Hask, seal forge, colonnade row 1, fragment)   D  relay graveyard (fragment, railcannon, wraith pack)
//   A  landing shelf (spawns, Brakka camp, stag, husk pickets)    C  the Prover Array (canals, stacks, 10 voices, vault, core)
//
// Corridors: A<->B (west), B<->D (north), D<->C (east), A<->C (south) — a ring,
// so the Array can be approached from either side. The main chain: fell the six
// classical pillars (the Migration), forge a LythiumSeal at Hask's anvil, open
// the sealed vault hiding the last four breaker voices, throw seven-of-ten
// inside the 120s window (the Count), then walk the gold gate to the Array core.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = 96, H = 60;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260618);

const grid = Array.from({ length: H }, () => Array(W).fill('.'));
const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const get = (x, y) => (inBounds(x, y) ? grid[y][x] : '#');
const set = (x, y, c) => { if (inBounds(x, y)) grid[y][x] = c; };
const isOpen = (x, y) => get(x, y) === '.';
const clearRect = (x0, x1, y0, y1) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, '.');
};
function blob(cx, cy, r, c, density = 0.7) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r && rnd() < density * (1 - d / (r + 1))) set(x, y, c);
    }
  }
}

// --- border ---
for (let x = 0; x < W; x++) { set(x, 0, '#'); set(x, H - 1, '#'); }
for (let y = 0; y < H; y++) { set(0, y, '#'); set(W - 1, y, '#'); }

// --- chasms (settled geography: on foot there is NO way across) ---
for (let y = 1; y < H - 1; y++) for (let x = 32; x <= 37; x++) set(x, y, '#'); // the west rift
for (let y = 26; y <= 30; y++) for (let x = 1; x <= 31; x++) set(x, y, '#');  // B / A split
for (let y = 10; y <= 13; y++) for (let x = 38; x <= 94; x++) set(x, y, '#'); // D / C split
for (let y = 1; y <= 9; y++) for (let x = 87; x <= 94; x++) set(x, y, '#');   // D east cap
// ragged chasm lips
for (let i = 0; i < 10; i++) blob(32 + rnd() * 6, 3 + rnd() * 54, 1.0 + rnd() * 1.4, '#', 0.5);
for (let i = 0; i < 6; i++) blob(3 + rnd() * 27, 26 + rnd() * 5, 0.8 + rnd() * 1.2, '#', 0.5);
for (let i = 0; i < 8; i++) blob(40 + rnd() * 52, 10 + rnd() * 4, 0.8 + rnd() * 1.2, '#', 0.5);

// --- island scatter: broken stone and dead obelisk stacks ---
for (let i = 0; i < 7; i++) blob(4 + rnd() * 25, 33 + rnd() * 23, 1.2 + rnd() * 0.8, '#');      // A rubble
for (let i = 0; i < 7; i++) blob(4 + rnd() * 25, 3 + rnd() * 20, 1.2 + rnd() * 0.8, '#');       // B rubble
for (let i = 0; i < 4; i++) blob(42 + rnd() * 42, 3 + rnd() * 5, 0.8 + rnd() * 0.8, '#');       // D wreckage
for (let i = 0; i < 14; i++) blob(41 + rnd() * 50, 16 + rnd() * 40, 1.2 + rnd() * 1.0, '#');    // C prover stacks

// --- island C: coolant canals (water) with worked crossings ---
for (let y = 16; y <= 56; y++) { set(52, y, '~'); set(53, y, '~'); }
for (let y = 18; y <= 50; y++) { set(66, y, '~'); set(67, y, '~'); }
clearRect(52, 53, 24, 26); // canal 1 north crossing
clearRect(52, 53, 40, 42); // canal 1 south crossing
clearRect(66, 67, 30, 32); // canal 2 north crossing
clearRect(66, 67, 47, 48); // canal 2 south crossing

// --- east approach band: kept open so late waves pour in along the Array ---
clearRect(93, 94, 14, 58);

// --- the sealed vault (hides the final four breaker voices) ---
clearRect(71, 81, 39, 49);
for (let x = 70; x <= 82; x++) { set(x, 38, '#'); set(x, 50, '#'); }
for (let y = 38; y <= 50; y++) { set(70, y, '#'); set(82, y, '#'); }
set(70, 43, '.'); set(70, 44, '.'); // sealLock door 'vault' (lythseal touch)

// --- the Array core (opens on the seven-of-ten quorum) ---
clearRect(82, 91, 27, 37);
for (let x = 81; x <= 92; x++) { set(x, 26, '#'); set(x, 38, '#'); }
for (let y = 26; y <= 38; y++) { set(81, y, '#'); set(92, y, '#'); }
set(81, 31, '.'); set(81, 32, '.'); // door 'core-gate' (quorum reward)
for (const [ex, ey] of [[88, 31], [89, 31], [88, 32], [89, 32]]) set(ex, ey, 'E');

// --- player spawns: the landing shelf, south-west ---
clearRect(2, 8, 42, 48);
for (const [px, py] of [[4, 44], [4, 46], [6, 44], [6, 46]]) set(px, py, 'P');

// --- exact placement for point entities (records feed the row-major defs) ---
const ringTile = (x, y) =>
  (x >= 70 && x <= 82 && y >= 38 && y <= 50 && (x === 70 || x === 82 || y === 38 || y === 50)) ||
  (x >= 81 && x <= 92 && y >= 26 && y <= 38 && (x === 81 || x === 92 || y === 26 || y === 38));
const chasmTile = (x, y) =>
  (x >= 32 && x <= 37) || (x <= 31 && y >= 26 && y <= 30) ||
  (x >= 38 && y >= 10 && y <= 13) || (x >= 87 && y <= 9) ||
  x === 0 || y === 0 || x === W - 1 || y === H - 1;
function placeAt(x, y, ch, room = 0) {
  if (ringTile(x, y) || chasmTile(x, y)) { console.error(`placeAt(${x},${y},'${ch}') hits protected ground`); process.exit(1); }
  if (room) {
    for (let yy = y - room; yy <= y + room; yy++)
      for (let xx = x - room; xx <= x + room; xx++)
        if (!ringTile(xx, yy) && !chasmTile(xx, yy) && get(xx, yy) === '#') set(xx, yy, '.');
  }
  set(x, y, ch);
  return [x, y];
}
const byScan = (a, b) => a.y - b.y || a.x - b.x;

// Settled Corridors: four pad pairs, A<->B, B<->D, D<->C, A<->C
const padPlan = [
  { id: 'cor-west-a', twin: 'cor-west-b', x: 14, y: 33 },   // A north shelf
  { id: 'cor-west-b', twin: 'cor-west-a', x: 14, y: 22 },   // B south shelf
  { id: 'cor-north-a', twin: 'cor-north-b', x: 28, y: 3 },  // B north-east
  { id: 'cor-north-b', twin: 'cor-north-a', x: 42, y: 4 },  // D west
  { id: 'cor-east-a', twin: 'cor-east-b', x: 84, y: 5 },    // D east
  { id: 'cor-east-b', twin: 'cor-east-a', x: 84, y: 17 },   // C north-east
  { id: 'cor-south-a', twin: 'cor-south-b', x: 28, y: 50 }, // A east shelf
  { id: 'cor-south-b', twin: 'cor-south-a', x: 42, y: 52 }, // C south-west
];
for (const p of padPlan) placeAt(p.x, p.y, 'O', 1);

// The Count: ten breaker voices, one cluster quorum (7-of-10, 120s window).
// Six stand in the open fields of the Array; four wait inside the sealed vault.
const switchPlan = [
  [46, 18], [43, 34], [50, 50],   // west of canal 1
  [60, 38],                       // between the canals
  [72, 26], [88, 52],             // north pocket / south-east terrace
  [74, 41], [78, 41], [74, 47], [78, 47], // the vault cluster
];
const switchRecs = switchPlan.map(([x, y]) => { placeAt(x, y, 'Q', 1); return { x, y }; });

// The Classical Colonnade: two guarded rows of three legacy-BLS pillars
for (const [x, y] of [[20, 8], [23, 8], [26, 8], [58, 22], [61, 22], [64, 22]]) placeAt(x, y, 'X', 1);

// Hask's anvil (island B): 20 shards + a carried proof fragment -> lythseal
placeAt(8, 12, 'Z', 1);

// proof fragments: one in the relay graveyard, one behind the west colonnade
const qitemPlan = [
  { id: 'frag-relay', kind: 'fragment', x: 64, y: 3 },
  { id: 'frag-keeper', kind: 'fragment', x: 4, y: 4 },
];
for (const q of qitemPlan) placeAt(q.x, q.y, 'I', 1);

// field weapon pickups: railcannon in the graveyard, stormgun on the Array
const pickupPlan = [
  { kind: 'railcannon', x: 55, y: 6 },
  { kind: 'stormgun', x: 56, y: 30 },
];
for (const p of pickupPlan) placeAt(p.x, p.y, 'A', 1);

// two camps: Sel Brakka at the landing shelf, Hask Embervein by the forge
const npcPlan = [
  {
    x: 10, y: 45,
    npc: {
      id: 'sel-brakka',
      name: 'Sel Brakka, Prover Foreman',
      lines: [
        'Sel Brakka, foreman of the Array. We grind mountains into receipts here — when the stacks are lit. They are not lit.',
        'The Entropy threw the count. Ten breaker voices stand on that field, and seven true make a quorum. Six is not a quorum. The gate text means it.',
        'Mind the window: the moment the first voice goes up, the field starts counting. Seven inside two minutes, or it forgets every voice you threw.',
        'The old colonnade still stands — six grey pillars on the dead curve. While one stands, the Phantoms re-knit out of drift. Put the Migration through.',
        'Hask keeps the forge across the west corridor. The vault out there only answers a LythiumSeal — a proof fragment and twenty shards buy the Combining.',
        "Keep my canals wet and the corridors gold. Generation is costly, verification is cheap. That's mercy, engineered.",
      ],
      gift: { shards: 6 },
    },
  },
  {
    x: 12, y: 18,
    npc: {
      id: 'hask-embervein',
      name: 'Hask Embervein, Forgekeeper',
      lines: [
        'Hask Embervein. Mind the sparks. One key is a confession; seven keys are a country.',
        "Bring me fragments, not promises. The anvil can't interpolate promises.",
        'A proof fragment and twenty shards buy you the Combining. Six fragments make slag — six is not a quorum at this anvil either.',
        'The Seal never names the innocent. It only fails the forged. Walk it near a Phantom and watch the stolen face boil off.',
        'The colonnade pillars? Good servants, bad gods. They served between checkpoints. Let them rest between them too.',
      ],
      gift: { shards: 10 },
    },
  },
];
const npcRecs = [];
for (const camp of npcPlan) {
  placeAt(camp.x, camp.y, 'N', 1);
  placeAt(camp.x + 1, camp.y, '*');
  npcRecs.push({ x: camp.x, y: camp.y, npc: camp.npc });
}

// build sites: one save beacon by the south corridor, defenses for the Count
const buildPlan = [
  { kind: 'beacon', cost: 10, x: 45, y: 50 },   // by the A<->C arrival pad
  { kind: 'turret', cost: 10, x: 69, y: 40 },   // vault door approach
  { kind: 'turret', cost: 10, x: 79, y: 29 },   // core gate approach
  { kind: 'barricade', cost: 4, x: 68, y: 47 }, // canal corridor mouth
  { kind: 'barricade', cost: 4, x: 83, y: 41 }, // south-east terrace
];
const buildRecs = buildPlan.map(b => { placeAt(b.x, b.y, 'B', 1); return b; });

// chests (loot binds row-major)
const chestPlan = [
  { loot: 'shards', amount: 8, x: 24, y: 42 },  // A
  { loot: 'medkit', amount: 1, x: 29, y: 12 },  // B
  { loot: 'shards', amount: 10, x: 50, y: 3 },  // D
  { loot: 'cracker', amount: 2, x: 75, y: 7 },  // D
  { loot: 'shield', amount: 1, x: 93, y: 15 },  // C east band
  { loot: 'token', amount: 1, x: 80, y: 48 },   // inside the vault
  { loot: 'shards', amount: 9, x: 40, y: 57 },  // C south-west
];
const chestRecs = chestPlan.map(c => { placeAt(c.x, c.y, 'C', 1); return c; });

// two stags: one at the landing shelf, one on the Array
const stagPlan = [{ x: 8, y: 40 }, { x: 68, y: 36 }];
const stagRecs = stagPlan.map(v => { placeAt(v.x, v.y, 'V', 1); return v; });

// LYTH crystals: the forge bill, the beacon and the turrets all eat shards
const crystalPlan = [
  [5, 52], [14, 36], [20, 55],            // A
  [5, 20], [25, 15], [18, 3],             // B
  [47, 7], [70, 2],                       // D
  [40, 16], [48, 42], [62, 48], [90, 20], [90, 55], [57, 17], // C
];
for (const [x, y] of crystalPlan) placeAt(x, y, 'Y', 1);

// --- enemies (~78): phantom-heavy, with the wraith/stalker/acolyte debut ---
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

// island A: husk pickets probing the landing shelf
for (const [x, y] of [[18, 38], [20, 52], [25, 46], [13, 52], [22, 34], [27, 55]]) place('z', x, y);
place('g', 16, 40); place('g', 24, 38);
place('u', 21, 48);
place('q', 27, 48); // a Phantom shadowing the south corridor pad

// island B: the west colonnade garrison
for (const [x, y] of [[10, 8], [16, 12], [22, 18], [7, 16], [19, 21], [24, 5], [3, 9], [27, 9]]) place('z', x, y);
place('f', 15, 6); place('f', 9, 21);
place('q', 5, 6); place('q', 21, 10); place('q', 25, 11);
place('s', 21, 9); place('s', 25, 7);
place('n', 28, 6);
place('u', 17, 16);

// island D: the relay graveyard — wraith pack over the fragment
for (const [x, y] of [[60, 4], [66, 5], [58, 2], [72, 4]]) place('v', x, y);
place('x', 63, 6); place('x', 68, 2);
place('q', 62, 3); place('q', 65, 7);
for (const [x, y] of [[45, 5], [52, 7], [78, 3], [81, 6]]) place('z', x, y);
place('m', 74, 5);

// island C: the Array fields
for (const [x, y] of [[45, 25], [50, 38], [56, 46], [60, 30], [64, 17], [71, 33], [44, 40], [58, 52], [75, 57], [90, 45]]) place('z', x, y);
for (const [x, y] of [[60, 24], [63, 20], [68, 41], [47, 30], [53, 42], [76, 55]]) place('q', x, y);
for (const [x, y] of [[57, 34], [73, 30], [86, 48]]) place('v', x, y);
for (const [x, y] of [[62, 40], [49, 22], [80, 55]]) place('x', x, y);
place('f', 51, 28); place('f', 76, 22);
place('s', 59, 21); place('s', 63, 24); // the east colonnade's wardens
place('n', 66, 26); place('n', 85, 42);
place('m', 78, 53);
place('u', 46, 36); place('u', 88, 24);
place('b', 69, 46); // the vault-door guardian
// inside the vault: a stalker and its phantom retinue
place('x', 76, 44); place('q', 73, 42); place('q', 79, 46);
// inside the core: the last guardian of the old curve
place('b', 86, 32); place('q', 84, 30); place('q', 87, 34);

// --- connectivity: validator semantics — flood on foot, pads extend reach,
// closed doors count as routes (their tiles are floor; puzzles open them) ---
const PASS = c => c !== '#' && c !== 'T' && c !== '~' && c !== 'o';
const ISLAND_ANCHORS = [
  { test: (x, y) => x <= 31 && y >= 31, anchor: [4, 45] },  // A
  { test: (x, y) => x <= 31 && y <= 25, anchor: [14, 22] }, // B
  { test: (x, y) => x >= 38 && y <= 9, anchor: [42, 4] },   // D
  { test: (x, y) => x >= 38 && y >= 14, anchor: [42, 52] }, // C
];
function flood() {
  const seen = Array.from({ length: H }, () => Array(W).fill(false));
  const q = [[4, 44]];
  seen[44][4] = true;
  const run = () => {
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
  };
  run();
  for (let pass = 0; pass <= padPlan.length; pass++) {
    let changed = false;
    for (const p of padPlan) {
      if (!seen[p.y][p.x]) continue;
      const twin = padPlan.find(o => o.id === p.twin);
      if (twin && !seen[twin.y][twin.x]) {
        seen[twin.y][twin.x] = true;
        q.push([twin.x, twin.y]);
        changed = true;
        run();
      }
    }
    if (!changed) break;
  }
  return seen;
}
function carveTo(x, y, seen) {
  const isle = ISLAND_ANCHORS.find(i => i.test(x, y));
  if (!isle) return;
  const [ax, ay] = isle.anchor;
  let cx = x, cy = y, guard = 0;
  while (!seen[cy][cx] && (cx !== ax || cy !== ay) && guard++ < 400) {
    const dx = Math.sign(ax - cx), dy = Math.sign(ay - cy);
    let nx = cx + dx, ny = cy;
    if (!dx || ringTile(nx, ny) || chasmTile(nx, ny)) { nx = cx; ny = cy + dy; }
    if ((nx === cx && ny === cy) || ringTile(nx, ny) || chasmTile(nx, ny)) return;
    cx = nx; cy = ny;
    if (!PASS(get(cx, cy))) set(cx, cy, '.');
  }
}
const ENTITY = new Set(['P', 'E', 'N', 'B', 'Y', 'C', 'V', 'A', 'I', 'Q', 'X', 'Z', 'O', '*',
  'g', 'a', 'r', 's', 'm', 'n', 'w', 'b', 'z', 'f', 'q', 'v', 'x', 'u']);
for (let pass = 0; pass < 10; pass++) {
  const seen = flood();
  let bad = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (ENTITY.has(get(x, y)) && !seen[y][x]) { bad++; carveTo(x, y, seen); }
  if (!bad) break;
}
{
  const seen = flood();
  const unreachable = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (ENTITY.has(get(x, y)) && !seen[y][x]) unreachable.push([get(x, y), x, y]);
  for (const [dx, dy] of [[70, 43], [70, 44], [81, 31], [81, 32]]) {
    if (!PASS(get(dx, dy))) unreachable.push(['door', dx, dy]);
  }
  if (unreachable.length) {
    console.error('UNREACHABLE entities remain:', unreachable);
    process.exit(1);
  }
}

// --- biome floors (after carving so carved lanes get painted too) ---
for (let y = 1; y < H - 1; y++) {
  for (let x = 1; x < W - 1; x++) {
    if (get(x, y) !== '.') continue;
    if (x >= 38 && y >= 14) { set(x, y, rnd() < 0.18 ? ',' : ';'); continue; } // C: worked stone terraces
    if (x >= 38) { set(x, y, '_'); continue; }                                 // D: drift-scarred ash
    if (y <= 25) { set(x, y, rnd() < 0.15 ? '_' : ','); continue; }            // B: forge ground
    set(x, y, rnd() < 0.25 ? '_' : '.');                                       // A: ash shelf
  }
}

// --- letters audit: every emitted char must already be a known tile ---
const ALLOWED = new Set('#.,:;_~oTE*PcNBYCVKWSHDgarsmnwbzfqvxuAIQJXZO'.split(''));
for (const row of grid) for (const c of row) {
  if (!ALLOWED.has(c)) { console.error(`unknown tile letter '${c}'`); process.exit(1); }
}

// --- stats ---
const counts = {};
for (const row of grid) for (const c of row) counts[c] = (counts[c] || 0) + 1;
const enemyLetters = ['g', 'a', 'r', 's', 'm', 'n', 'w', 'b', 'z', 'f', 'q', 'v', 'x', 'u'];
const enemyTotal = enemyLetters.reduce((n, c) => n + (counts[c] || 0), 0);
const DROPS = { g: 1, a: 1, w: 1, r: 2, n: 2, s: 2, m: 3, b: 12, z: 1, f: 2, q: 2, v: 2, x: 3, u: 1 };
const killIncome = enemyLetters.reduce((n, c) => n + (counts[c] || 0) * DROPS[c], 0);
const crystalIncome = (counts['Y'] || 0) * 4;
const giftIncome = npcPlan.reduce((n, p) => n + ((p.npc.gift && p.npc.gift.shards) || 0), 0);
const chestIncome = chestPlan.reduce((n, c) => n + (c.loot === 'shards' ? c.amount : 0), 0);
const bill = 20 + buildPlan.reduce((n, b) => n + b.cost, 0); // one Combining + every site
console.log(`${W}x${H} map (${W * H} tiles)`);
console.log('tile counts:', Object.fromEntries(Object.entries(counts).sort()));
console.log(`enemies: ${enemyTotal} (${enemyLetters.map(c => `${c}:${counts[c] || 0}`).join(' ')})`);
console.log(`economy: forge+builds bill ${bill} vs crystals ${crystalIncome} + gifts ${giftIncome} + chests ${chestIncome} + 50% kills ${Math.floor(killIncome / 2)} = ${crystalIncome + giftIncome + chestIncome + Math.floor(killIncome / 2)}`);
console.log(grid.map(r => r.join('')).join('\n'));

// --- def emission: row-major sorted entity arrays ---
npcRecs.sort(byScan);
buildRecs.sort(byScan);
chestRecs.sort(byScan);
stagRecs.sort(byScan);
const padRecs = padPlan.slice().sort(byScan);
const qitemRecs = qitemPlan.slice().sort(byScan);
const pickupRecs = pickupPlan.slice().sort(byScan);
switchRecs.sort(byScan);

const def = {
  name: 'The Prover Array',
  story: true,
  chapter: 8,
  title: 'Chapter VIII — The Prover Array',
  expedition: true,
  objective: 'Fell the six classical pillars, forge the LythiumSeal, and bring seven of ten voices online — then walk the gold gate to the Array core',
  time: 900,
  captiveChars: [],
  npcs: npcRecs.map(r => r.npc),
  builds: buildRecs.map(b => ({ kind: b.kind, cost: b.cost })),
  chests: chestRecs.map(c => ({ loot: c.loot, amount: c.amount })),
  vehicles: stagRecs.map(() => ({ kind: 'stag' })),
  pickups: pickupRecs.map(p => ({ kind: p.kind })),
  qitems: qitemRecs.map(q => ({ id: q.id, kind: q.kind })),
  switches: switchRecs.map((s, i) => ({ id: 'voice-' + (i + 1), group: 0 })),
  switchGroups: [
    { group: 0, need: 7, of: 10, window: 120, reward: { openDoor: 'core-gate' } },
  ],
  doors: [
    { id: 'vault', x: 70, y: 43, w: 1, h: 2, sealLock: true },
    { id: 'core-gate', x: 81, y: 31, w: 1, h: 2 },
  ],
  teleports: padRecs.map(p => ({ id: p.id, twin: p.twin })),
  quests: [
    {
      id: 'q-migration', main: true, title: 'The Migration: fell the six classical pillars',
      giver: 'sel-brakka', kind: 'destroy', target: 'pillar', count: 6,
      reward: { shards: 14 },
      hint: 'They served between checkpoints. Let them rest between them too.',
    },
    {
      id: 'q-seal', title: "Forge a LythiumSeal at Hask's anvil",
      giver: 'hask-embervein', kind: 'craft', target: 'lythseal', count: 1,
      reward: { shards: 8 },
      hint: 'A proof fragment and twenty shards. The anvil cannot interpolate promises.',
    },
    {
      id: 'q-quorum', title: 'The Count: bring seven of ten voices online',
      giver: 'sel-brakka', kind: 'switch', target: '0', count: 1,
      reward: { shards: 10 },
      hint: 'Seven inside the window, or the field forgets every voice you threw. Six is not a quorum.',
    },
    {
      id: 'q-core', title: 'Reach the Array core',
      giver: 'sel-brakka', kind: 'reach', target: { x: 85, y: 32 }, count: 1,
      hint: 'The gold gate answers the quorum. Walk in and prove the frontier whole.',
    },
  ],
  intro: [
    {
      title: 'Chapter VIII — The Prover Array',
      lines: [
        'The Entropy threw the count at the Prover Array. The stacks stand cold, the corridors grey.',
        'While one classical pillar stands, the slain Phantoms re-knit out of drift.',
        'A forged name dies at the next checkpoint. Become the checkpoint.',
      ],
      art: 'entropy',
    },
    {
      title: 'Six Is Not a Quorum',
      lines: [
        'Ten breaker voices wait across the chasms, and any seven true voices give the same answer.',
        'The Anchor takes no fractions.',
      ],
      art: 'quorum',
    },
  ],
  outro: [
    {
      title: 'The Field Proves Whole',
      lines: [
        'The seventh voice snaps true and gold floods the field — every pylon answers at once.',
        'The stacks roar back to work; feather-light receipts ride the settled corridors to every village gate.',
        'What the curve promised, the lattice keeps.',
      ],
      art: 'dawn',
    },
    {
      title: 'Act II — Settled',
      lines: [
        'From the Basin to the Array, the frontier holds: anchored, counted, proven whole.',
        'The Anchorcraft waits on its pad for the hundredth-anchor checkpoint. The Crossing continues.',
        'Behind you, a world that holds. Ahead, one that does not yet.',
      ],
      art: 'settlement',
    },
  ],
  modifiers: {
    waves: [
      { at: 300, letters: 'zzzzzzuu', edge: 'e' },
      { at: 600, letters: 'qqvvxx', edge: 'e' },
      { at: 960, letters: 'zzzzffqq', edge: 'e' },
      { at: 1320, letters: 'xxvvqqss', edge: 'e' },
    ],
  },
  tiles: grid.map(r => r.join('')),
};

console.log('npcs (scan order):', def.npcs.map(n => n.id).join(', '));
console.log('builds (scan order):', def.builds.map(b => b.kind).join(', '));
console.log('chests (scan order):', def.chests.map(c => c.loot).join(', '));
console.log('pickups (scan order):', def.pickups.map(p => p.kind).join(', '));
console.log('qitems (scan order):', def.qitems.map(q => q.id).join(', '));
console.log('teleports (scan order):', def.teleports.map(t => `${t.id}->${t.twin}`).join(', '));
console.log('switches: 10 voices, quorum 7-of-10 inside a 120s window');

const out = path.join(__dirname, '../levels/level18.json');
fs.writeFileSync(out, JSON.stringify(def, null, 2) + '\n');
console.log('wrote', out);
