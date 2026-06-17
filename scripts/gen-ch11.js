// Generates levels/story/ch11.json — "Chapter XI — Genesis Drift", the saga
// finale. Deterministic (fixed seed 20261211): re-running always reproduces it.
// A 100x70 nest-world: the First Anchor, fallen the night of the Anchorfall,
// with the Entropy nested in its hollow. Corrupted genesis terrain — void
// edges and a drowned drift-sea south, lava veins, ice pockets, ruin rubble —
// laid out as a THREE-ACT GAUNTLET:
//
//   ACT 1  THE APPROACH   landing shoal (spawns, First Keeper camp, brazier,
//                         skiffs) -> drift channel by skiff to the deep-nest
//                         islet (two proof fragments) -> the drowned genesis
//                         plaza (Cassio Bell) at the outer gate
//   ACT 2  THE NEST RINGS outer ring wall (one south gauntlet gate) around an
//                         inner ring; the corridor between them holds the TEN
//                         founding seats (7-of-10, 120s window), two ring
//                         bosses with phantom retinues, two brood spawners
//                         and lava veins; the quorum opens the nest-gate
//   ACT 3  THE GENESIS RITE inner court -> the hollow (sealLock gate, Genesis
//                         Seal only) -> the 4-rune rite (wave>vertex>seal>
//                         anchor) opens the eye-gate pad cell -> a settled
//                         corridor into the EYE: the nest boss + brood over
//                         the First Anchor. Touching the Anchor ends the saga
//                         (main-chain reach finale; no exit tiles, no gate).
//
// Mains: q-landfall (reach, gate forecourt) and q-genesis (reach, the First
// Anchor). The doors enforce the physical chain (quorum -> nest-gate, seal ->
// hollow-gate, rite -> eye-gate); fetch/craft/switch/glyph quests guide and
// pay. No captives (the roster is full): shards, field weapons and loot.
// Dark map (the nest is lightless), crescendo waves from all four edges.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = 100, H = 70;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261211);

const grid = Array.from({ length: H }, () => Array(W).fill('.'));
const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const get = (x, y) => (inBounds(x, y) ? grid[y][x] : '#');
const set = (x, y, c) => { if (inBounds(x, y)) grid[y][x] = c; };
const isOpen = (x, y) => get(x, y) === '.';
const fillRect = (x0, x1, y0, y1, c) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c);
};
const clearRect = (x0, x1, y0, y1) => fillRect(x0, x1, y0, y1, '.');
function blob(cx, cy, r, c, density = 0.7) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r && rnd() < density * (1 - d / (r + 1))) set(x, y, c);
    }
  }
}

// --- structural geometry (shared with the protections below) ---------------
const EYE = { x0: 70, x1: 96, y0: 2, y1: 12 };          // wall perimeter rect
const OUTER = { x0: 24, x1: 76, y0: 16, y1: 44 };       // outer ring wall
const INNER = { x0: 38, x1: 62, y0: 24, y1: 38 };       // inner ring wall
const HOLLOW = { x0: 42, x1: 58, y0: 27, y1: 34 };      // the hollow cell
const GATE = [[49, 44], [50, 44], [51, 44]];            // outer gauntlet gate (open floor)
const DOOR_NEST = [[49, 38], [50, 38]];                 // quorum reward door
const DOOR_HOLLOW = [[49, 34], [50, 34]];               // sealLock door
const DOOR_EYE = [[54, 29]];                            // glyph-rite reward door
const PAD_CELL_WALLS = [[54, 28], [54, 30], [55, 31], [56, 31], [57, 31]];
const DOOR_TILES = [...DOOR_NEST, ...DOOR_HOLLOW, ...DOOR_EYE];

const onPerim = (r, x, y) =>
  x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1 &&
  (x === r.x0 || x === r.x1 || y === r.y0 || y === r.y1);
const isGateOrDoor = (x, y) =>
  GATE.some(([gx, gy]) => gx === x && gy === y) ||
  DOOR_TILES.some(([dx, dy]) => dx === x && dy === y);
const wallTile = (x, y) =>
  x === 0 || y === 0 || x === W - 1 || y === H - 1 ||
  ((onPerim(EYE, x, y) || onPerim(OUTER, x, y) || onPerim(INNER, x, y) ||
    onPerim(HOLLOW, x, y) ||
    PAD_CELL_WALLS.some(([px, py]) => px === x && py === y)) && !isGateOrDoor(x, y));

// --- border ---
for (let x = 0; x < W; x++) { set(x, 0, '#'); set(x, H - 1, '#'); }
for (let y = 0; y < H; y++) { set(0, y, '#'); set(W - 1, y, '#'); }

// --- the drift sea: void fills, then carved water channels, then the islet ---
fillRect(20, 98, 57, 68, '%');  // the southern deep Drift
fillRect(69, 96, 45, 56, '%');  // east of the plaza: sheer void
fillRect(97, 98, 45, 56, '%');  // east band ends where the sea begins
fillRect(20, 22, 60, 65, '~');  // harbor pocket at the landing quay
fillRect(20, 95, 61, 64, '~');  // channel A: the skiff road east
fillRect(78, 79, 48, 64, '~');  // islet ring, west reach
fillRect(78, 95, 48, 49, '~');  // islet ring, north reach
fillRect(94, 95, 48, 62, '~');  // islet ring, east reach
clearRect(80, 93, 50, 60);      // the deep-nest islet (skiff-only landfall)
fillRect(20, 22, 56, 59, '.');  // quay platform (landing -> causeway shoulder)
clearRect(23, 29, 50, 58);      // the causeway: landing -> plaza
fillRect(3, 18, 66, 68, '=');   // the landing beach (south wave vent)

// --- ruin rubble (before walls; walls overwrite, doors re-cleared below) ---
for (let i = 0; i < 8; i++) blob(6 + rnd() * 60, 3 + rnd() * 10, 1.0 + rnd() * 1.2, '#');   // north band ruins
for (let i = 0; i < 6; i++) blob(5 + rnd() * 17, 16 + rnd() * 32, 1.2 + rnd() * 1.0, '#');  // west field
for (let i = 0; i < 6; i++) blob(79 + rnd() * 16, 16 + rnd() * 26, 1.0 + rnd() * 1.0, '#'); // east field
for (let i = 0; i < 8; i++) blob(27 + rnd() * 47, 18 + rnd() * 24, 0.8 + rnd() * 1.0, '#'); // ring corridor cover
for (let i = 0; i < 5; i++) blob(32 + rnd() * 34, 46 + rnd() * 9, 0.8 + rnd() * 1.0, '#');  // plaza rubble
for (let i = 0; i < 3; i++) blob(5 + rnd() * 12, 52 + rnd() * 10, 0.8 + rnd() * 0.8, '#');  // landing scatter

// --- the walls: eye, outer ring, inner ring, the hollow, the pad cell ------
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (wallTile(x, y)) set(x, y, '#');
}
clearRect(EYE.x0 + 1, EYE.x1 - 1, EYE.y0 + 1, EYE.y1 - 1);          // eye interior
clearRect(HOLLOW.x0 + 1, HOLLOW.x1 - 1, HOLLOW.y0 + 1, HOLLOW.y1 - 1); // hollow interior
for (const [px, py] of PAD_CELL_WALLS) set(px, py, '#');
for (const [gx, gy] of GATE) set(gx, gy, '.');
for (const [dx, dy] of DOOR_TILES) set(dx, dy, '.');

// --- open wave vents: the edges must admit the nest's answer ---------------
clearRect(1, 98, 1, 1);    // north band, row 1 (above the eye wall)
clearRect(1, 2, 1, 65);    // west band
clearRect(97, 98, 1, 44);  // east band (void below y45 — the sea takes over)
// keep the bands joined to the field
clearRect(3, 96, 13, 15);  // the strip between north band and outer wall
clearRect(3, 23, 16, 53);  // west field stays open along the wall (rubble re-added below)
for (let i = 0; i < 6; i++) blob(5 + rnd() * 17, 17 + rnd() * 34, 0.9 + rnd() * 0.9, '#');

// --- corrupted genesis terrain: lava veins, ice pockets --------------------
const vein = (x0, x1, y, wob = 0) => {
  for (let x = x0; x <= x1; x++) {
    const yy = y + (wob ? Math.round(Math.sin(x * 0.9) * wob) : 0);
    if (get(x, yy) === '.') set(x, yy, '!');
  }
};
vein(26, 36, 22, 1);   // west ring corridor vein
vein(64, 74, 30, 1);   // east ring corridor vein
vein(30, 44, 10, 1);   // north band veins
vein(55, 66, 5, 1);
vein(32, 40, 49, 0);   // a plaza scorch line
for (let y = 33; y <= 36; y++) for (let x = 10; x <= 16; x++) if (get(x, y) === '.' && rnd() < 0.8) set(x, y, '^'); // west field ice shelf
for (let y = 35; y <= 37; y++) for (let x = 52; x <= 58; x++) if (get(x, y) === '.' && rnd() < 0.8) set(x, y, '^'); // the cold seats (inner court)
for (let y = 9; y <= 11; y++) for (let x = 58; x <= 64; x++) if (get(x, y) === '.' && rnd() < 0.7) set(x, y, '^');  // north band frost
// drowned-plaza pools (decorative, never on the gate funnel)
for (const [px, py] of [[37, 49], [38, 50], [56, 52], [57, 52], [44, 54], [62, 50]]) {
  if (get(px, py) === '.') set(px, py, '~');
}

// --- exact placement for point entities ------------------------------------
const seaTile = c => c === '~' || c === '%';
function placeAt(x, y, ch, room = 0) {
  if (wallTile(x, y) || isGateOrDoor(x, y) || seaTile(get(x, y))) {
    console.error(`placeAt(${x},${y},'${ch}') hits protected/sea ground (${get(x, y)})`);
    process.exit(1);
  }
  if (room) {
    for (let yy = y - room; yy <= y + room; yy++)
      for (let xx = x - room; xx <= x + room; xx++)
        if (!wallTile(xx, yy) && get(xx, yy) === '#') set(xx, yy, '.');
  }
  set(x, y, ch);
  return [x, y];
}
const byScan = (a, b) => a.y - b.y || a.x - b.x;

// --- player spawns: the landing shoal, south-west ---
clearRect(4, 16, 56, 64);
for (const [px, py] of [[6, 60], [8, 60], [6, 62], [8, 62]]) set(px, py, 'P');

// the settled corridor: hollow pad cell <-> the eye of the nest
const padPlan = [
  { id: 'eye-out', twin: 'eye-in', x: 73, y: 7 },  // arrival, inside the eye
  { id: 'eye-in', twin: 'eye-out', x: 56, y: 29 }, // the hollow's pad cell
];
for (const p of padPlan) placeAt(p.x, p.y, 'O', 1);

// the TEN founding seats, ringing the hollow through the ring corridor
const switchPlan = [
  [40, 19], [50, 18], [60, 19],   // north corridor
  [32, 26], [32, 32],             // west corridor
  [68, 26], [68, 32],             // east corridor
  [42, 41], [50, 40], [58, 41],   // south corridor
];
const switchRecs = switchPlan.map(([x, y]) => { placeAt(x, y, 'Q', 1); return { x, y }; });

// the Genesis Rite stones (hollow): wave > vertex > seal > anchor — and the
// First Anchor itself, a lone scenery rune at the heart of the eye
const glyphPlan = [
  { x: 93, y: 7, symbol: 0, group: 1 },  // the First Anchor (scenery: no group def)
  { x: 45, y: 30, symbol: 1, group: 0 }, // Wave
  { x: 48, y: 30, symbol: 2, group: 0 }, // Vertex
  { x: 51, y: 30, symbol: 3, group: 0 }, // Seal
  { x: 48, y: 32, symbol: 0, group: 0 }, // Anchor
];
const glyphRecs = glyphPlan.map(g => { placeAt(g.x, g.y, 'J', 1); return { ...g } });

// the Keeper's brazier (seal forge): fragment + 20 shards -> the Genesis Seal
placeAt(10, 57, 'Z', 1);

// two proof fragments on the deep-nest islet (one for the Struck-Ledger
// handover fetch, one to feed the brazier)
const qitemPlan = [
  { id: 'frag-deep-a', kind: 'fragment', x: 88, y: 54 },
  { id: 'frag-deep-b', kind: 'fragment', x: 86, y: 55 },
];
for (const q of qitemPlan) placeAt(q.x, q.y, 'I', 1);

// field weapon pickups
const pickupPlan = [
  { kind: 'flamer', x: 40, y: 5 },      // north band ruins
  { kind: 'mortarMk2', x: 40, y: 36 },  // inner court, south strip
  { kind: 'railcannon', x: 38, y: 47 }, // plaza west
  { kind: 'stormgun', x: 62, y: 47 },   // plaza east
];
for (const p of pickupPlan) placeAt(p.x, p.y, 'A', 1);

// two camps: the First Keeper at the landing, Cassio Bell at the gate forecourt
const npcPlan = [
  {
    x: 12, y: 60,
    npc: {
      id: 'first-keeper',
      name: 'The First Keeper',
      lines: [
        'Ten of us lit the First Anchor. Nine seats are cold. I am the count that remains, and I never stopped counting.',
        'Genesis was the first finality — the first promise that stayed promised. Everything you have anchored since is its interest.',
        'The Entropy is not a beast, operator. It is everything never finished, come home to where finishing was invented.',
        'Seven of my ten seats, true, inside the window. The First Anchor takes no fractions. It taught the others that.',
        "The rite on your pilot's plaque — wave, vertex, seal, anchor. We wrote it here first. Say it where it was born, once, and only once.",
        'Take my shards. I kept them for the relighting. I always knew someone would come — counting tells you that.',
      ],
      gift: { shards: 12 },
    },
  },
  {
    x: 52, y: 49,
    npc: {
      id: 'cassio-bell',
      name: "Cassio 'Quorum' Bell",
      lines: [
        'Cassio Bell. Yes — that Cassio. Word reached the Settlement that Genesis runs seven-in-ten, and I rode three nightwaves to get here.',
        "First job on this frontier I've ever liked the numbers on. Kindly don't make me revise.",
        'The nest spits waves from every edge at once. Count your barricades before the count starts — arithmetic first, heroics never.',
        'The corridor pad channels at the top of the wave. Step on, breathe out, be there. Mirelle taught me that, and I hate how right she is.',
        'Forklings still come two for one. At Genesis? Two for one, then two for each. Burn the seam early.',
        'Here — my whole purse. If the First Anchor settles, money is only the second-best thing it buys back.',
      ],
      gift: { shards: 7 },
    },
  },
];
const npcRecs = [];
for (const camp of npcPlan) {
  placeAt(camp.x, camp.y, 'N', 1);
  placeAt(camp.x + 1, camp.y, '*');
  npcRecs.push({ x: camp.x, y: camp.y, npc: camp.npc });
}

// build sites: a plaza save beacon, the count's defenses at the gauntlet
const buildPlan = [
  { kind: 'beacon', cost: 10, x: 38, y: 52 },   // checkpoint before the gauntlet
  { kind: 'turret', cost: 10, x: 46, y: 42 },   // ring south corridor, west of the gate
  { kind: 'turret', cost: 10, x: 54, y: 42 },   // ring south corridor, east of the gate
  { kind: 'barricade', cost: 4, x: 47, y: 45 }, // gate forecourt
  { kind: 'barricade', cost: 4, x: 53, y: 45 },
];
const buildRecs = buildPlan.map(b => { placeAt(b.x, b.y, 'B', 1); return b; });

// chests (loot binds row-major)
const chestPlan = [
  { loot: 'shield', amount: 1, x: 94, y: 4 },   // eye, north nook
  { loot: 'medkit', amount: 1, x: 94, y: 10 },  // eye, south nook
  { loot: 'token', amount: 1, x: 44, y: 32 },   // the hollow (+1 dmg for the finale)
  { loot: 'cracker', amount: 2, x: 26, y: 34 }, // ring west corridor
  { loot: 'shards', amount: 9, x: 74, y: 34 },  // ring east corridor
  { loot: 'shards', amount: 8, x: 33, y: 53 },  // plaza rubble
  { loot: 'medkit', amount: 1, x: 5, y: 56 },   // landing shoal
  { loot: 'shards', amount: 10, x: 89, y: 58 }, // the deep-nest islet (skiff hoard)
];
const chestRecs = chestPlan.map(c => { placeAt(c.x, c.y, 'C', 1); return c; });

// two skiffs at the landing quay (the channel road east)
const skiffPlan = [{ x: 19, y: 62 }, { x: 19, y: 63 }];
const skiffRecs = skiffPlan.map(v => { placeAt(v.x, v.y, 'V', 1); return v; });

// LYTH crystals: the brazier bill and the gauntlet defenses both eat shards
const crystalPlan = [
  [10, 63], [16, 57], [5, 55],      // landing
  [24, 55],                          // causeway
  [34, 50], [64, 54],                // plaza
  [8, 28], [18, 38],                 // west field
  [16, 5], [58, 6],                  // north band
  [82, 28], [93, 40],                // east field
  [28, 38], [72, 38],                // ring corridor
  [84, 59],                          // the islet
];
for (const [x, y] of crystalPlan) placeAt(x, y, 'Y', 1);

// --- enemies (~81): the nest — phantom-heavy, four bosses, two brood rings ---
function place(c, x, y) {
  x = Math.round(x); y = Math.round(y);
  for (let r = 0; r < 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (isOpen(x + dx, y + dy) && !isGateOrDoor(x + dx, y + dy)) { set(x + dx, y + dy, c); return true; }
      }
    }
  }
  console.error(`no room for enemy '${c}' near ${x},${y}`);
  process.exit(1);
}

// ACT 1 — the approach
for (const [x, y] of [[24, 56], [28, 54], [22, 52]]) place('z', x, y);   // causeway husks
place('u', 26, 55);
for (const [x, y] of [[36, 48], [44, 53], [58, 53], [64, 48], [40, 46], [60, 46]]) place('z', x, y); // plaza camp
place('f', 46, 51); place('f', 56, 49);
place('q', 48, 47); place('q', 52, 47);
place('n', 66, 52);
place('v', 84, 57); place('z', 87, 53); place('z', 90, 57); // the islet watch

// the outskirts (west / east / north fields)
for (const [x, y] of [[10, 30], [16, 40]]) place('z', x, y);
place('f', 14, 25); place('u', 12, 46); place('n', 6, 35);
for (const [x, y] of [[84, 20], [92, 30]]) place('z', x, y);
place('v', 88, 24); place('f', 90, 36);
for (const [x, y] of [[12, 6], [50, 5], [62, 8]]) place('z', x, y);
place('f', 22, 8); place('f', 44, 10);
place('u', 56, 4); place('s', 8, 8); place('n', 36, 7);

// ACT 2 — the nest rings
// south corridor: the gate warden (boss 1) and its phantom retinue
place('b', 50, 42);
place('q', 47, 41); place('q', 53, 41);
place('s', 45, 40); place('s', 55, 40);
place('f', 42, 39); place('f', 58, 39);
place('z', 36, 40); place('z', 64, 40);
// west ring: boss 2's camp + the NW brood spawner
place('b', 30, 28);
place('q', 28, 26); place('q', 28, 30);
place('v', 34, 22); place('x', 30, 36); place('z', 34, 30); place('s', 35, 26);
place('m', 26, 18);
// east ring: boss 3's camp + the NE brood spawner
place('b', 70, 28);
place('q', 72, 26); place('q', 72, 30);
place('v', 66, 22); place('x', 70, 36); place('z', 66, 30); place('s', 65, 26);
place('m', 74, 18);
// north corridor pickets
place('z', 44, 18); place('z', 56, 18);
place('x', 40, 22); place('x', 60, 22);
place('n', 50, 17); place('f', 50, 21);

// ACT 3 — court, hollow, eye
place('q', 40, 30); place('q', 60, 30); // inner court wardens
place('x', 50, 26); place('x', 50, 36);
place('x', 52, 32); place('q', 44, 29); place('q', 52, 28); // hollow guardians
place('b', 88, 7);                       // the nest boss, over the First Anchor
place('m', 91, 5);
place('x', 84, 5); place('x', 84, 9);
place('q', 80, 5); place('q', 80, 9);
place('v', 86, 10); place('v', 90, 8);

// --- connectivity: flood on foot + pads; carve rubble; islet rides the sea ---
const PASS = c => c !== '#' && c !== 'T' && c !== '~' && c !== 'o' && c !== '%';
const REGIONS = [
  { test: (x, y) => x >= 71 && x <= 95 && y >= 3 && y <= 11, anchor: [73, 7] },   // the eye
  { test: (x, y) => x >= 55 && x <= 57 && y >= 28 && y <= 30, anchor: [56, 29] }, // pad cell
  { test: (x, y) => x >= 43 && x <= 57 && y >= 28 && y <= 33, anchor: [50, 32] }, // the hollow
  { test: (x, y) => x >= 39 && x <= 61 && y >= 25 && y <= 37, anchor: [50, 36] }, // inner court
  { test: (x, y) => x >= 25 && x <= 75 && y >= 17 && y <= 43, anchor: [50, 41] }, // ring corridor
  { test: (x, y) => x >= 80 && x <= 93 && y >= 50 && y <= 60, anchor: [86, 56] }, // the islet
  { test: (x, y) => x >= 30 && x <= 68 && y >= 45 && y <= 56, anchor: [50, 50] }, // the plaza
  { test: (x, y) => x <= 29 && y >= 50, anchor: [6, 60] },                        // landing + causeway
  { test: (x, y) => x <= 23 && y >= 14 && y <= 49, anchor: [10, 30] },            // west field
  { test: (x, y) => x >= 77 && x <= 96 && y >= 14 && y <= 44, anchor: [85, 30] }, // east field
  { test: (x, y) => y <= 15, anchor: [50, 8] },                                   // north band
];
const isletRegion = REGIONS[5];
function flood() {
  const seen = Array.from({ length: H }, () => Array(W).fill(false));
  const q = [[6, 60]];
  seen[60][6] = true;
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
  const isle = REGIONS.find(i => i.test(x, y));
  if (!isle || isle === isletRegion) return;
  const [ax, ay] = isle.anchor;
  let cx = x, cy = y, guard = 0;
  while (!seen[cy][cx] && (cx !== ax || cy !== ay) && guard++ < 400) {
    const dx = Math.sign(ax - cx), dy = Math.sign(ay - cy);
    let nx = cx + dx, ny = cy;
    if (!dx || wallTile(nx, ny) || seaTile(get(nx, ny))) { nx = cx; ny = cy + dy; }
    if ((nx === cx && ny === cy) || wallTile(nx, ny) || seaTile(get(nx, ny))) return;
    cx = nx; cy = ny;
    if (get(cx, cy) === '#') set(cx, cy, '.');
  }
}
const ENTITY = new Set(['P', 'N', 'B', 'Y', 'C', 'V', 'A', 'I', 'Q', 'J', 'Z', 'O', '*',
  'g', 'a', 'r', 's', 'm', 'n', 'w', 'b', 'z', 'f', 'q', 'v', 'x', 'u']);
const onIslet = (x, y) => isletRegion.test(x, y);
for (let pass = 0; pass < 10; pass++) {
  const seen = flood();
  let bad = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (ENTITY.has(get(x, y)) && !seen[y][x] && !onIslet(x, y)) { bad++; carveTo(x, y, seen); }
  if (!bad) break;
}
{
  const seen = flood();
  // skiff sea-reach: flood '~' (and any shore it touches) from each skiff
  const seaSeen = seen.map(r => r.slice());
  const seaQ = skiffPlan.filter(v => seen[v.y][v.x]).map(v => [v.x, v.y]);
  while (seaQ.length) {
    const [x, y] = seaQ.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny) || seaSeen[ny][nx]) continue;
      const t = get(nx, ny);
      if (t === '~' || PASS(t)) { seaSeen[ny][nx] = true; seaQ.push([nx, ny]); }
    }
  }
  const unreachable = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!ENTITY.has(get(x, y))) continue;
      if (onIslet(x, y) ? !seaSeen[y][x] : !seen[y][x]) unreachable.push([get(x, y), x, y]);
    }
  for (const [dx, dy] of DOOR_TILES) if (!PASS(get(dx, dy))) unreachable.push(['door', dx, dy]);
  for (const [gx, gy] of GATE) if (!PASS(get(gx, gy))) unreachable.push(['gate', gx, gy]);
  if (unreachable.length) {
    console.error('UNREACHABLE entities remain:', unreachable);
    process.exit(1);
  }
  // the skiffs must moor against water
  for (const v of skiffPlan) {
    const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => get(v.x + dx, v.y + dy) === '~');
    if (!wet) { console.error(`skiff at ${v.x},${v.y} moors dry`); process.exit(1); }
  }
  // every wave edge needs entry candidates in the 2-tile border band
  for (const edge of ['n', 's', 'e', 'w']) {
    const horiz = edge === 'n' || edge === 's';
    const len = horiz ? W : H;
    let cands = 0;
    for (let i = 0; i < len; i++) {
      for (let depth = 0; depth < 2; depth++) {
        const tx = edge === 'n' || edge === 's' ? i : (edge === 'w' ? depth : W - 1 - depth);
        const ty = horiz ? (edge === 'n' ? depth : H - 1 - depth) : i;
        const c = get(tx, ty);
        if (PASS(c) && c !== '!') { cands++; break; }
      }
    }
    if (cands < 3) { console.error(`wave edge '${edge}' has only ${cands} entry tiles`); process.exit(1); }
  }
}

// --- biome floors (after carving so carved lanes get painted too) -----------
for (let y = 1; y < H - 1; y++) {
  for (let x = 1; x < W - 1; x++) {
    if (get(x, y) !== '.') continue;
    if (x >= 71 && x <= 95 && y >= 3 && y <= 11) { set(x, y, rnd() < 0.2 ? ',' : ';'); continue; }   // the eye: worked genesis stone
    if (x >= 25 && x <= 75 && y >= 17 && y <= 43) { set(x, y, rnd() < 0.3 ? '_' : ';'); continue; }  // rings + court + hollow: scorched stone
    if (x >= 30 && x <= 68 && y >= 45 && y <= 56) { set(x, y, rnd() < 0.3 ? ';' : ','); continue; }  // the drowned plaza
    if (onIslet(x, y)) { set(x, y, '_'); continue; }                                                 // islet ash
    if (y <= 15 || x >= 77) { set(x, y, '_'); continue; }                                            // north band + east field: ashfall
    set(x, y, rnd() < 0.25 ? '_' : '.');                                                             // west field + landing
  }
}

// --- letters audit: every emitted char must already be a known tile ---------
const ALLOWED = new Set('#.,:;_~oTE*%!^=PcNBYCVKWSHDgarsmnwbzfqvxuAIQJXZO'.split(''));
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
const bill = 20 + buildPlan.reduce((n, b) => n + b.cost, 0);
console.log(`${W}x${H} map (${W * H} tiles)`);
console.log('tile counts:', Object.fromEntries(Object.entries(counts).sort()));
console.log(`enemies: ${enemyTotal} (${enemyLetters.map(c => `${c}:${counts[c] || 0}`).join(' ')})`);
console.log(`economy: brazier+builds bill ${bill} vs crystals ${crystalIncome} + gifts ${giftIncome} + chests ${chestIncome} + 50% kills ${Math.floor(killIncome / 2)} = ${crystalIncome + giftIncome + chestIncome + Math.floor(killIncome / 2)}`);
console.log(grid.map(r => r.join('')).join('\n'));

// --- def emission: row-major sorted entity arrays ---------------------------
npcRecs.sort(byScan);
buildRecs.sort(byScan);
chestRecs.sort(byScan);
skiffRecs.sort(byScan);
switchRecs.sort(byScan);
glyphRecs.sort(byScan);
const padRecs = padPlan.slice().sort(byScan);
const qitemRecs = qitemPlan.slice().sort(byScan);
const pickupRecs = pickupPlan.slice().sort(byScan);

const def = {
  name: 'Genesis Drift',
  story: true,
  chapter: 11,
  title: 'Chapter XI — Genesis Drift',
  expedition: true,
  objective: 'Make landfall at the First Anchor — bring seven founding seats true, speak the rite where it was born, and settle the first finality',
  time: 900,
  weather: null,
  ambience: 'night',
  captiveChars: [],
  npcs: npcRecs.map(r => r.npc),
  builds: buildRecs.map(b => ({ kind: b.kind, cost: b.cost })),
  chests: chestRecs.map(c => ({ loot: c.loot, amount: c.amount })),
  vehicles: skiffRecs.map(() => ({ kind: 'skiff' })),
  pickups: pickupRecs.map(p => ({ kind: p.kind })),
  qitems: qitemRecs.map(q => ({ id: q.id, kind: q.kind })),
  switches: switchRecs.map((s, i) => ({ id: 'seat-' + (i + 1), group: 0 })),
  switchGroups: [
    { group: 0, need: 7, of: 10, window: 120, reward: { openDoor: 'nest-gate' } },
  ],
  glyphs: glyphRecs.map(g => ({ symbol: g.symbol, group: g.group })),
  glyphGroups: [
    { group: 0, order: [1, 2, 3, 0], reward: { openDoor: 'eye-gate' } }, // Wave, Vertex, Seal, Anchor
  ],
  doors: [
    { id: 'eye-gate', x: 54, y: 29, w: 1, h: 1 },
    { id: 'hollow-gate', x: 49, y: 34, w: 2, h: 1, sealLock: true },
    { id: 'nest-gate', x: 49, y: 38, w: 2, h: 1 },
  ],
  teleports: padRecs.map(p => ({ id: p.id, twin: p.twin })),
  quests: [
    {
      id: 'q-landfall', main: true, title: 'Landfall at Genesis: reach the drowned plaza gate',
      giver: 'first-keeper', kind: 'reach', target: { x: 50, y: 46 }, count: 1,
      reward: { shards: 6 },
      hint: 'Thread the nest channels between the void chasms. The gauntlet gate stands at the top of the plaza.',
    },
    {
      id: 'q-fragment', title: "The First Keeper's Fragment",
      giver: 'first-keeper', kind: 'fetch', item: 'fragment', count: 1,
      reward: { shards: 8 },
      hint: 'The deep nest hoards what it drowned. Skiff the channel east — bring me proof, not promises.',
    },
    {
      id: 'q-seal', title: "Forge the Genesis Seal at the Keeper's brazier",
      giver: 'first-keeper', kind: 'craft', target: 'lythseal', count: 1,
      reward: { shards: 8 },
      hint: 'A proof fragment and twenty shards — same law as ever. The hollow answers the Seal and nothing else.',
    },
    {
      id: 'q-seats', title: 'The Founding Seats: bring seven of ten true',
      giver: 'first-keeper', kind: 'switch', target: '0', count: 1,
      reward: { shards: 10 },
      hint: 'Seven inside the window, while the nest pours from every edge. The First Anchor takes no fractions.',
    },
    {
      id: 'q-rite', title: 'The Genesis Rite: speak it where it was born',
      giver: 'first-keeper', kind: 'glyph', target: '0', count: 1,
      reward: { shards: 8 },
      hint: 'Wave, then vertex, then seal, then anchor — once, and only once. The corridor into the eye answers the rite.',
    },
    {
      id: 'q-forks', title: 'Burn the seam early: fell four Forklings',
      giver: 'cassio-bell', kind: 'kill', target: 'f', count: 4,
      reward: { shards: 8 },
      hint: 'Two for one, then two for each. Arithmetic first, heroics never.',
    },
    {
      id: 'q-eye', title: 'The Eye of the Nest: take the settled corridor in',
      giver: 'cassio-bell', kind: 'reach', target: { x: 75, y: 7 }, count: 1,
      reward: { shards: 6 },
      hint: 'Step on, breathe out, be there. Hold through the last nightwave of everything.',
    },
    {
      id: 'q-genesis', main: true, title: 'Settle the First Finality: touch the First Anchor',
      giver: 'first-keeper', kind: 'reach', target: { x: 93, y: 7 }, count: 1,
      hint: 'Settle the first promise, and every other promise holds.',
    },
  ],
  intro: [
    {
      title: 'Chapter XI — Genesis Drift',
      lines: [
        'The First Anchor. The first finality. The oldest promise on the frontier.',
        'It fell first, the night of the Fall — and the Entropy has nested in it since.',
        'Everything unsettled drains home to Genesis.',
      ],
      art: 'entropy',
    },
    {
      title: 'The Nest',
      lines: [
        'Ten founding seats ring the hollow. Seven true reopen the count.',
        'Wave, then vertex, then seal, then anchor — say it where it was born.',
        'Settle the first promise, and every other promise holds.',
      ],
      art: 'quorum',
    },
  ],
  outro: [
    {
      title: 'Genesis Settles',
      lines: [
        'The First Anchor takes the rite and remembers what it was for.',
        'The nest thins to static, to mist, to morning.',
        'A hundred anchors answer in one breath — the checkpoint the frontier was waiting for.',
      ],
      art: 'dawn',
    },
    {
      title: 'The Hundredth Anchor',
      lines: [
        'Genesis settles, and the light walks home: the Crossing, the Basin, the field that counts to ten, the one city, the camp, the Settlement, the Array.',
        'A hundred anchors answer in one breath, and the deep checkpoint signs.',
        'Nothing forged outlives it. Nothing true needs to.',
      ],
      art: 'dawn',
    },
    {
      title: 'Keep the Signal Alive',
      lines: [
        'The Drift is only a sea now. The frontier holds end to end — the land remembers itself, and this time it is remembered.',
        'Aboard the Anchorcraft, Doc hums the old transit jingle. The lines run again, the whole way home.',
        'Behind you, a world that holds. Ahead — so does that one. Keep the signal alive.',
      ],
      art: 'anchorcraft',
    },
  ],
  modifiers: {
    dark: true,
    waves: [
      { at: 180, letters: 'zzzff', edge: 'n' },
      { at: 420, letters: 'zzqqvv', edge: 'w' },
      // the nest answers the count
      { at: 900, letters: 'zzqq', edge: 'n' },
      { at: 900, letters: 'ffqq', edge: 'e' },
      { at: 900, letters: 'zzff', edge: 's' },
      { at: 900, letters: 'qqzz', edge: 'w' },
      // the last nightwave of everything
      { at: 1380, letters: 'qqzz', edge: 'n' },
      { at: 1380, letters: 'qqvv', edge: 'e' },
      { at: 1380, letters: 'zzxx', edge: 's' },
      { at: 1380, letters: 'vvxx', edge: 'w' },
      { at: 1800, letters: 'zzff', edge: 'e' },
    ],
  },
  // alive-world bindings: the ring camps wake as camps (staggered boss fights)
  groups: [
    [[50, 42], [47, 41], [53, 41], [45, 40], [55, 40]],          // the gate warden's camp
    [[30, 28], [28, 26], [28, 30], [34, 30], [35, 26]],          // west ring camp
    [[70, 28], [72, 26], [72, 30], [66, 30], [65, 26]],          // east ring camp
    [[88, 7], [84, 5], [84, 9], [80, 5], [80, 9], [86, 10], [90, 8]], // the eye
  ],
  patrols: [
    { at: [44, 18], points: [[44, 18], [56, 18]] },  // north corridor walker
    { at: [36, 40], points: [[36, 40], [42, 40]] },  // south corridor walker
  ],
  tiles: grid.map(r => r.join('')),
};

console.log('npcs (scan order):', def.npcs.map(n => n.id).join(', '));
console.log('builds (scan order):', def.builds.map(b => b.kind).join(', '));
console.log('chests (scan order):', def.chests.map(c => c.loot).join(', '));
console.log('pickups (scan order):', def.pickups.map(p => p.kind).join(', '));
console.log('qitems (scan order):', def.qitems.map(q => q.id).join(', '));
console.log('glyphs (scan order):', def.glyphs.map(g => `${g.group}:${g.symbol}`).join(' '));
console.log('teleports (scan order):', def.teleports.map(t => `${t.id}->${t.twin}`).join(', '));
console.log('switches: 10 founding seats, quorum 7-of-10 inside a 120s window');

const out = path.join(__dirname, '../levels/story/ch11.json');
fs.writeFileSync(out, JSON.stringify(def, null, 2) + '\n');
console.log('wrote', out);
