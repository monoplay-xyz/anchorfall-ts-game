// Generates levels/story/ch10.json — "Chapter X — The Burned Names", the middle
// chapter of Act III. Deterministic (fixed seed 20261210): re-running always
// reproduces it. A 90x66 island of black glass and ash mid-Drift — the exile
// shoal where the chain casts out equivocators — crossed from the landfall
// pier in the south to the far quay on the north shore:
//
//   far quay (skiff out, the heading to Genesis)        N
//   Vault of Names compound (vault-gate + sealLock crypt)
//   tomb-rows W            bell tower / reliquary       tomb-rows E
//   keeper tomb (rite)     the Ash Registry (anvil)     east tomb (rite)
//   landfall pier (spawns, skiff, the Penitent)         S
//
// The spine is glyph RITES — laying names to rest. Three ordered groups:
//   group 0  the Rite of Striking at the bell tower  (VERTEX>SEAL>BURN —
//            name, bond, burn; the mark that cannot be unsaid comes last)
//   group 1  the keeper tomb in the west rows        (ANCHOR>BURN)
//   group 2  the east tomb row                       (QUORUM>BURN)
// Main chain: reach the registry, fetch two proof fragments from the phantom
// nests, forge a LythiumSeal at the cold anvil, give ten stolen faces back,
// strike the rite, toll seven of ten mourning bells inside the 120s window
// (opens the vault approach), walk the Seal into the Vault of Names for the
// heading, then reach the far quay and skiff out. Untimed, ashstorm weather,
// Forkling/acolyte heavy. No captives — the roster is full; the island pays
// in shards, field weapons and tomb loot instead.
//
// Lore wave sketch note: the source sketch cues waves off bell tolls and uses
// 'P' for Phantoms; the sim fields timed waves only and the Phantom letter is
// 'q' (Null Acolyte, the Classical Phantom caster) — the trigger waves are
// approximated as timed mid/late waves and 'P' is transliterated to 'q'.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = 90, H = 66;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261210);

const grid = Array.from({ length: H }, () => Array(W).fill('.'));
const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const get = (x, y) => (inBounds(x, y) ? grid[y][x] : '#');
const set = (x, y, c) => { if (inBounds(x, y)) grid[y][x] = c; };
const isOpen = (x, y) => get(x, y) === '.';
const clearRect = (x0, x1, y0, y1) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, '.');
};
const wallRect = (x0, x1, y0, y1) => {
  for (let x = x0; x <= x1; x++) { set(x, y0, '#'); set(x, y1, '#'); }
  for (let y = y0; y <= y1; y++) { set(x0, y, '#'); set(x1, y, '#'); }
};

// --- protected geography: shores, piers and the worked walls ---------------
// North drift-water rows 1-3 (the far quay platform x64-77 stays land down to
// the border); south drift-water rows 61-64 (the landfall pier x15-27 and the
// hoard islet x44-48/y62-63 stay land). One landmass between, y4..60.
const NORTH_QUAY = (x, y) => x >= 64 && x <= 77 && y >= 1 && y <= 4;
const SOUTH_PIER = (x, y) => x >= 15 && x <= 27 && y >= 61 && y <= 64;
const ISLET = (x, y) => x >= 44 && x <= 48 && y >= 62 && y <= 63;
const waterTile = (x, y) =>
  (y >= 1 && y <= 3 && !NORTH_QUAY(x, y)) ||
  (y >= 61 && y <= 64 && !SOUTH_PIER(x, y) && !ISLET(x, y));

// Worked rooms: [x0, x1, y0, y1, doorTiles]. The walls are protected ground;
// the door tiles are carved floor (the runtime door system blocks them until
// their opener fires — quorum, rite or lythseal touch).
const ROOMS = [
  { x0: 10, x1: 34, y0: 6, y1: 19, doors: [[22, 19], [23, 19]] },   // vault compound
  { x0: 13, x1: 25, y0: 8, y1: 16, doors: [[25, 11], [25, 12]] },   // the crypt (sealLock)
  { x0: 49, x1: 59, y0: 21, y1: 28, doors: [[53, 28], [54, 28]] },  // bell tower / reliquary
  { x0: 39, x1: 53, y0: 38, y1: 46, doors: [[45, 38], [46, 38], [47, 38]] }, // registry (open arch)
  { x0: 6, x1: 12, y0: 47, y1: 53, doors: [[12, 49], [12, 50]] },   // keeper tomb (west)
  { x0: 77, x1: 84, y0: 49, y1: 56, doors: [[77, 52], [77, 53]] },  // east tomb
];
const roomWall = (x, y) => ROOMS.some(r =>
  x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1 &&
  (x === r.x0 || x === r.x1 || y === r.y0 || y === r.y1) &&
  !r.doors.some(([dx, dy]) => dx === x && dy === y));
const doorApron = (x, y) => ROOMS.some(r =>
  r.doors.some(([dx, dy]) => Math.abs(dx - x) <= 2 && Math.abs(dy - y) <= 2));
const protectedTile = (x, y) =>
  x === 0 || y === 0 || x === W - 1 || y === H - 1 || waterTile(x, y) || roomWall(x, y);

// --- border + water ---
for (let x = 0; x < W; x++) { set(x, 0, '#'); set(x, H - 1, '#'); }
for (let y = 0; y < H; y++) { set(0, y, '#'); set(W - 1, y, '#'); }
for (let y = 1; y < H - 1; y++)
  for (let x = 1; x < W - 1; x++)
    if (waterTile(x, y)) set(x, y, '~');

// --- rooms: walls, then carved interiors, then door floor ---
for (const r of ROOMS) {
  wallRect(r.x0, r.x1, r.y0, r.y1);
  clearRect(r.x0 + 1, r.x1 - 1, r.y0 + 1, r.y1 - 1);
}
for (const r of ROOMS) for (const [dx, dy] of r.doors) set(dx, dy, '.');

// --- the necropolis tomb-rows: ranks of black-glass tombs (2-wide blocks) ---
// A guarded paint: never touches shores, walls or door aprons.
const paint = (x, y, c) => {
  x = Math.round(x); y = Math.round(y);
  if (!inBounds(x, y) || protectedTile(x, y) || doorApron(x, y)) return;
  set(x, y, c);
};
const roomNear = (x, y) => ROOMS.some(r =>
  x >= r.x0 - 1 && x <= r.x1 + 1 && y >= r.y0 - 1 && y <= r.y1 + 1);
// west rows (between the vault compound and the keeper tomb)
for (const y of [23, 27, 31, 35, 39, 43]) {
  for (let x = 4; x <= 32; x += 5) {
    const jx = x + ((y / 4) | 0) % 2; // staggered ranks
    if (roomNear(jx, y) || roomNear(jx + 1, y)) continue;
    paint(jx, y, '#'); paint(jx + 1, y, '#');
  }
}
// east rows (between the far quay and the east tomb)
for (const y of [18, 22, 26, 30, 34, 38, 42, 46]) {
  for (let x = 62; x <= 84; x += 5) {
    const jx = x + ((y / 4) | 0) % 2;
    if (roomNear(jx, y) || roomNear(jx + 1, y)) continue;
    paint(jx, y, '#'); paint(jx + 1, y, '#');
  }
}
// scattered black-glass shards across the open fields (kept off the rooms)
for (let i = 0; i < 9; i++) {
  const cx = 37 + rnd() * 22, cy = 8 + rnd() * 26;
  if (roomNear(Math.round(cx), Math.round(cy))) continue;
  const r = 0.8 + rnd() * 1.0;
  for (let y = Math.floor(cy - r); y <= cy + r; y++)
    for (let x = Math.floor(cx - r); x <= cx + r; x++)
      if (Math.hypot(x - cx, y - cy) <= r && rnd() < 0.6 && !roomNear(x, y)) paint(x, y, '#');
}
for (let i = 0; i < 7; i++) {
  const cx = 30 + rnd() * 30, cy = 48 + rnd() * 10;
  const r = 0.7 + rnd() * 0.9;
  for (let y = Math.floor(cy - r); y <= cy + r; y++)
    for (let x = Math.floor(cx - r); x <= cx + r; x++)
      if (Math.hypot(x - cx, y - cy) <= r && rnd() < 0.6 && !roomNear(x, y)) paint(x, y, '#');
}

// --- exact placement for point entities (records feed the row-major defs) ---
function placeAt(x, y, ch, room = 0) {
  if (protectedTile(x, y)) { console.error(`placeAt(${x},${y},'${ch}') hits protected ground`); process.exit(1); }
  if (room) {
    for (let yy = y - room; yy <= y + room; yy++)
      for (let xx = x - room; xx <= x + room; xx++)
        if (!protectedTile(xx, yy) && get(xx, yy) === '#') set(xx, yy, '.');
  }
  set(x, y, ch);
  return [x, y];
}
const byScan = (a, b) => a.y - b.y || a.x - b.x;

// --- player spawns: the landfall pier, south shore ---
for (const [px, py] of [[18, 62], [20, 62], [18, 63], [20, 63]]) placeAt(px, py, 'P');

// --- skiffs: one moored at the landfall pier, one waiting at the far quay ---
const skiffPlan = [
  { x: 64, y: 2 },  // the far quay — "skiff out" (water at 63,2)
  { x: 27, y: 62 }, // the landfall pier (water at 28,62) — the islet hoard run
];
const skiffRecs = skiffPlan.map(v => { placeAt(v.x, v.y, 'V', 1); return v; });

// --- the mourning bells: ten relays ringing the necropolis, 7-of-10/120s ---
const bellPlan = [
  [40, 20], [52, 15], [64, 20],
  [71, 29], [69, 41], [58, 49],
  [44, 51], [33, 47], [28, 36], [32, 26],
];
const bellRecs = bellPlan.map(([x, y]) => { placeAt(x, y, 'Q', 1); return { x, y }; });

// --- glyph stones: the three rites that lay names to rest ------------------
// Runes by symbol: 0 ANCHOR, 2 VERTEX, 3 SEAL, 5 BURN, 6 QUORUM. Every rite
// ends in BURN — the mark that cannot be unsaid comes last. It always does.
const glyphPlan = [
  { id: 'rite-name', symbol: 2, group: 0, x: 51, y: 31 }, // VERTEX — the name
  { id: 'rite-bond', symbol: 3, group: 0, x: 54, y: 31 }, // SEAL — the bond
  { id: 'rite-burn', symbol: 5, group: 0, x: 57, y: 31 }, // BURN — last, always
  { id: 'keeper-anchor', symbol: 0, group: 1, x: 15, y: 49 },
  { id: 'keeper-burn', symbol: 5, group: 1, x: 15, y: 52 },
  { id: 'row-quorum', symbol: 6, group: 2, x: 74, y: 51 },
  { id: 'row-burn', symbol: 5, group: 2, x: 74, y: 54 },
];
const glyphRecs = glyphPlan.map(g => { placeAt(g.x, g.y, 'J', 1); return g; });

// --- the registry's cold anvil (a fragment + twenty shards = the Combining) ---
placeAt(42, 42, 'Z');

// --- proof fragments: two in the phantom nests, one with the dead keepers ---
const qitemPlan = [
  { id: 'frag-east', kind: 'fragment', x: 71, y: 24 },  // east nest
  { id: 'frag-west', kind: 'fragment', x: 17, y: 30 },  // west nest
  { id: 'frag-keeper', kind: 'fragment', x: 9, y: 50 }, // keeper tomb (rite 1)
];
for (const q of qitemPlan) placeAt(q.x, q.y, 'I', 1);

// --- field weapon pickups: reliquary railcannon, east-tomb stormgun ---
const pickupPlan = [
  { kind: 'railcannon', x: 54, y: 24 }, // behind the Rite of Striking
  { kind: 'stormgun', x: 81, y: 54 },   // behind the east row rite
];
for (const p of pickupPlan) placeAt(p.x, p.y, 'A');

// --- the two who stayed: Sere in the registry, the Penitent at landfall ---
const npcPlan = [
  {
    x: 49, y: 42, // inside the Ash Registry, beside the cold anvil
    npc: {
      id: 'sere-kallow',
      name: 'Sere Kallow, Archivist of the Struck Ledger',
      lines: [
        'Sere Kallow. I keep the Struck Ledger — every burned name, every second signature, every reason.',
        'We burn the name and keep the lesson. Erase both, and the Fall happens twice.',
        'Seven hundred names struck since Genesis. Not one was forced. Every equivocation is a choice made twice.',
        'The rite at the bell tower goes name, bond, burn — each rune once and only once. The mark that cannot be unsaid comes last. It always comes last.',
        'Seven of ten mourning bells inside the window. A true count, even over the dead. Especially over the dead.',
        'The vault answers a LythiumSeal and nothing else. Hask’s law holds even here: it never names the innocent — it only fails the forged.',
      ],
      gift: { shards: 8 },
    },
  },
  {
    x: 23, y: 61, // the landfall pier — the first voice the crew hears
    npc: {
      id: 'the-penitent',
      name: 'The Penitent (Name Burned)',
      lines: [
        'No name. Don’t ask. Mine is in the ledger with a line through it, and the line is the truest thing I ever signed.',
        'I signed twice the night of the Fall. Once for the chain, once for the whisper. The whisper paid better — for an hour.',
        'One hundred percent. That is what burning costs. Not most of you. All of you, and no road back by bonding again. The ledger is right, and I hate that it is right.',
        'The Entropy pays in second chances. If you are ever holding two of anything that should be one — drop both and run.',
        'The Phantoms wear us. Every stolen face out there is a name from the Struck Ledger. Walk the Seal close and give a dead man his line back.',
        'Take my shards. Spent men shouldn’t hold money. It remembers being carried by someone else.',
      ],
      gift: { shards: 10 },
    },
  },
];
// def.npcs binds row-major, so the records sort by scan position below.
const npcRecs = [];
for (const camp of npcPlan) {
  placeAt(camp.x, camp.y, 'N');
  placeAt(camp.x + 1, camp.y, '*');
  npcRecs.push({ x: camp.x, y: camp.y, npc: camp.npc });
}

// --- build sites: a checkpoint by the registry, defenses for the tolling ---
const buildPlan = [
  { kind: 'beacon', cost: 10, x: 56, y: 44 },   // outside the registry arch
  { kind: 'turret', cost: 10, x: 26, y: 22 },   // the vault-gate approach
  { kind: 'turret', cost: 10, x: 47, y: 34 },   // the bell field
  { kind: 'barricade', cost: 4, x: 60, y: 31 }, // east of the rite stones
  { kind: 'barricade', cost: 4, x: 37, y: 30 }, // west bell ring mouth
];
const buildRecs = buildPlan.map(b => { placeAt(b.x, b.y, 'B', 1); return b; });

// --- chests (loot binds row-major) ---
const chestPlan = [
  { loot: 'token', amount: 1, x: 16, y: 12 },   // the crypt: the heading's seal-token
  { loot: 'cracker', amount: 2, x: 31, y: 8 },  // vault courtyard
  { loot: 'token', amount: 1, x: 52, y: 25 },   // the reliquary
  { loot: 'shards', amount: 9, x: 56, y: 25 },  // the reliquary
  { loot: 'medkit', amount: 1, x: 50, y: 44 },  // the registry hall
  { loot: 'shards', amount: 8, x: 8, y: 48 },   // the keeper tomb
  { loot: 'shield', amount: 1, x: 80, y: 52 },  // the east tomb
  { loot: 'cracker', amount: 2, x: 82, y: 8 },  // north-east rows
  { loot: 'shards', amount: 7, x: 16, y: 61 },  // the landfall pier
  { loot: 'shards', amount: 12, x: 46, y: 62 }, // the hoard islet (skiff run)
];
const chestRecs = chestPlan.map(c => { placeAt(c.x, c.y, 'C', 1); return c; });

// --- LYTH crystals: the Combining and the build sites all eat shards ---
const crystalPlan = [
  [5, 9], [7, 21], [3, 40], [13, 57],
  [24, 57], [37, 55], [55, 57], [67, 55],
  [86, 46], [86, 30], [86, 18], [58, 8],
  [45, 7], [37, 12],
];
for (const [x, y] of crystalPlan) placeAt(x, y, 'Y', 1);

// --- enemies (~75): Forkling/acolyte heavy, Phantoms wearing burned names ---
function place(c, x, y) {
  x = Math.round(x); y = Math.round(y);
  for (let r = 0; r < 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (isOpen(x + dx, y + dy) && !protectedTile(x + dx, y + dy)) { set(x + dx, y + dy, c); return true; }
      }
    }
  }
  return false;
}

// south shore: husk pickets probing the landfall pier
for (const [x, y] of [[24, 58], [18, 57], [30, 59], [13, 59]]) place('z', x, y);
place('f', 26, 56);

// west tomb-rows: the west phantom nest holds frag-west
for (const [x, y] of [[10, 26], [22, 34], [8, 36], [26, 42], [12, 44]]) place('z', x, y);
place('q', 15, 29); place('q', 19, 31); // the nest wardens
place('f', 14, 32); place('f', 20, 28);
place('f', 18, 38); place('f', 24, 26);
place('u', 20, 42);
place('s', 7, 28);
// the keeper tomb's mourners
place('q', 17, 51); place('f', 19, 47); place('z', 22, 52);

// center fields: the bell ring and the rite stones
for (const [x, y] of [[44, 26], [58, 36], [48, 35], [38, 33]]) place('z', x, y);
place('q', 50, 35); place('q', 46, 20); place('q', 60, 26);
place('f', 42, 30); place('f', 56, 33);
place('s', 47, 30);
place('v', 50, 12); place('v', 62, 14); // wraiths on the north field
place('u', 36, 42); place('u', 62, 44);
place('x', 55, 18); // a stalker behind the tower
place('b', 22, 21); // the vault-gate warden

// east tomb-rows: the east phantom nest holds frag-east
for (const [x, y] of [[66, 22], [78, 28], [64, 34], [76, 38], [82, 42]]) place('z', x, y);
place('q', 69, 23); place('q', 73, 25); // the nest wardens
place('q', 72, 32); place('q', 78, 24); place('q', 66, 38); place('q', 80, 34);
place('f', 68, 26), place('f', 74, 22);
place('f', 70, 36); place('f', 76, 31); place('f', 82, 20);
place('x', 74, 44); place('x', 68, 18);
place('s', 84, 26); place('s', 63, 30);
place('u', 79, 46);
// the east tomb's mourners
place('q', 72, 52); place('f', 70, 50); place('z', 73, 56);

// the Vault of Names: courtyard retinue and the crypt guardian
place('x', 29, 9); place('x', 29, 16);
place('q', 28, 12); place('q', 15, 17);
place('b', 21, 12);                      // the crypt guardian
place('q', 18, 10); place('q', 18, 14);  // phantoms in struck names

// the far quay: wraiths over the heading out
place('v', 69, 3); place('v', 74, 3); place('q', 72, 2);

// --- connectivity: validator semantics — flood on foot from the spawn pier;
// closed doors count as routes (their tiles are floor; the rites, the quorum
// and the Seal open them); the islet chest rides the skiff sea-flood ---
const PASS = c => c !== '#' && c !== 'T' && c !== '~' && c !== 'o' && c !== '%';
function flood() {
  const seen = Array.from({ length: H }, () => Array(W).fill(false));
  const q = [[18, 62]];
  seen[62][18] = true;
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
  // one landmass: walk toward the center field, clearing unprotected glass
  const ax = 46, ay = 33;
  let cx = x, cy = y, guard = 0;
  while (!seen[cy][cx] && (cx !== ax || cy !== ay) && guard++ < 400) {
    const dx = Math.sign(ax - cx), dy = Math.sign(ay - cy);
    let nx = cx + dx, ny = cy;
    if (!dx || protectedTile(nx, ny)) { nx = cx; ny = cy + dy; }
    if ((nx === cx && ny === cy) || protectedTile(nx, ny)) return;
    cx = nx; cy = ny;
    if (!PASS(get(cx, cy))) set(cx, cy, '.');
  }
}
const ENTITY = new Set(['P', 'E', 'N', 'B', 'Y', 'C', 'V', 'A', 'I', 'Q', 'X', 'Z', 'O', 'J', '*',
  'g', 'a', 'r', 's', 'm', 'n', 'w', 'b', 'z', 'f', 'q', 'v', 'x', 'u']);
const ISLET_CHEST = [46, 62]; // skiff-run hoard: excused from the foot flood
const onFoot = (x, y) => !(x === ISLET_CHEST[0] && y === ISLET_CHEST[1]);
for (let pass = 0; pass < 10; pass++) {
  const seen = flood();
  let bad = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (ENTITY.has(get(x, y)) && onFoot(x, y) && !seen[y][x]) { bad++; carveTo(x, y, seen); }
  if (!bad) break;
}
{
  const seen = flood();
  const unreachable = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (ENTITY.has(get(x, y)) && onFoot(x, y) && !seen[y][x]) unreachable.push([get(x, y), x, y]);
  // every door tile is walkable floor and on the route map
  for (const r of ROOMS) for (const [dx, dy] of r.doors) {
    if (!PASS(get(dx, dy))) unreachable.push(['door', dx, dy]);
    if (!seen[dy][dx]) unreachable.push(['door-flood', dx, dy]);
  }
  // quest reach targets stand on reachable floor
  for (const [tx, ty] of [[46, 41], [19, 12], [71, 2]]) {
    if (!seen[ty][tx]) unreachable.push(['reach-target', tx, ty]);
  }
  if (unreachable.length) {
    console.error('UNREACHABLE entities remain:', unreachable);
    process.exit(1);
  }
  // the islet hoard must ride the sea-flood from a foot-reachable skiff
  const sea = seen.map(r => r.slice());
  const sq = [];
  for (const v of skiffPlan) if (seen[v.y][v.x]) sq.push([v.x, v.y]);
  while (sq.length) {
    const [x, y] = sq.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny) || sea[ny][nx]) continue;
      const t = get(nx, ny);
      if (t === '~' || PASS(t)) { sea[ny][nx] = true; sq.push([nx, ny]); }
    }
  }
  if (!sea[ISLET_CHEST[1]][ISLET_CHEST[0]]) {
    console.error('islet hoard out of skiff reach');
    process.exit(1);
  }
}

// --- biome floors (after carving so carved lanes get painted too) ---
// Black-glass pavement ';' over the necropolis, ash '_' on the west field
// and the shores, worked stone ',' in the center and on the quays.
for (let y = 1; y < H - 1; y++) {
  for (let x = 1; x < W - 1; x++) {
    if (get(x, y) !== '.') continue;
    if (NORTH_QUAY(x, y) || SOUTH_PIER(x, y) || ISLET(x, y)) { set(x, y, ','); continue; }
    if (y >= 56) { set(x, y, rnd() < 0.5 ? '_' : '.'); continue; }       // ash shore
    if (x <= 35) { set(x, y, rnd() < 0.25 ? ';' : '_'); continue; }      // west rows: ash + glass
    if (x >= 61) { set(x, y, rnd() < 0.3 ? '_' : ';'); continue; }       // east rows: glass + ash
    set(x, y, rnd() < 0.3 ? ';' : ',');                                  // center: worked stone
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
console.log(`enemies: ${enemyTotal} (${enemyLetters.map(c => `${c}:${counts[c] || 0}`).join(' ')}) — acolytes 'q' must cover the kill-10`);
console.log(`economy: forge+builds bill ${bill} vs crystals ${crystalIncome} + gifts ${giftIncome} + chests ${chestIncome} + 50% kills ${Math.floor(killIncome / 2)} = ${crystalIncome + giftIncome + chestIncome + Math.floor(killIncome / 2)}`);
console.log(grid.map(r => r.join('')).join('\n'));
if ((counts['q'] || 0) < 12) { console.error('not enough Phantoms for Give Back the Faces'); process.exit(1); }

// --- def emission: row-major sorted entity arrays ---
npcRecs.sort(byScan);
buildRecs.sort(byScan);
chestRecs.sort(byScan);
skiffRecs.sort(byScan);
bellRecs.sort(byScan);
glyphRecs.sort(byScan);
const qitemRecs = qitemPlan.slice().sort(byScan);
const pickupRecs = pickupPlan.slice().sort(byScan);

const def = {
  name: 'The Burned Names',
  story: true,
  chapter: 10,
  title: 'Chapter X — The Burned Names',
  expedition: true,
  objective: 'Cross the island of the exiles — forge the Seal, strike the rite, toll seven of ten mourning bells, and take the heading to Genesis',
  time: 900, // untimed in play (story): elapsed drives the waves; kept for tooling
  weather: 'ashstorm', // dread weather: all sight capped at 9 tiles
  ambience: 'ash',
  captiveChars: [], // the roster is full — the island pays in shards and steel
  npcs: npcRecs.map(r => r.npc),
  builds: buildRecs.map(b => ({ kind: b.kind, cost: b.cost })),
  chests: chestRecs.map(c => ({ loot: c.loot, amount: c.amount })),
  vehicles: skiffRecs.map(() => ({ kind: 'skiff' })),
  pickups: pickupRecs.map(p => ({ kind: p.kind })),
  qitems: qitemRecs.map(q => ({ id: q.id, kind: q.kind })),
  switches: bellRecs.map((s, i) => ({ id: 'bell-' + (i + 1), group: 0 })),
  switchGroups: [
    { group: 0, need: 7, of: 10, window: 120, reward: { openDoor: 'vault-gate' } },
  ],
  glyphs: glyphRecs.map(g => ({ id: g.id, symbol: g.symbol, group: g.group })),
  glyphGroups: [
    // the Rite of Striking: name, bond, burn — BURN comes last. It always does.
    { group: 0, order: [2, 3, 5], reward: { openDoor: 'reliquary' } },
    { group: 1, order: [0, 5], reward: { openDoor: 'tomb-west' } }, // the keepers
    { group: 2, order: [6, 5], reward: { openDoor: 'tomb-east' } }, // the east row
  ],
  doors: [
    { id: 'vault-gate', x: 22, y: 19, w: 2, h: 1 },           // the bells open the approach
    { id: 'vault', x: 25, y: 11, w: 1, h: 2, sealLock: true }, // the crypt: Seal or nothing
    { id: 'reliquary', x: 53, y: 28, w: 2, h: 1 },             // the Rite of Striking
    { id: 'tomb-west', x: 12, y: 49, w: 1, h: 2 },             // keeper rite (frag-keeper)
    { id: 'tomb-east', x: 77, y: 52, w: 1, h: 2 },             // east row rite
  ],
  quests: [
    {
      id: 'q-registry', main: true, title: 'The Ash Registry',
      giver: 'sere-kallow', kind: 'reach', target: { x: 46, y: 41 }, count: 1,
      reward: { shards: 6 },
      hint: 'Make landfall and reach the registry hall where the Struck Ledger is kept.',
    },
    {
      id: 'q-fragments', main: true, title: 'Fragments, Not Promises',
      giver: 'sere-kallow', kind: 'fetch', item: 'fragment', count: 2,
      reward: { shards: 10 },
      hint: 'Two proof fragments from the phantom nests, for the Ledger. A third sleeps with the keepers in the west tomb — the anvil will want one of its own.',
    },
    {
      id: 'q-seal', main: true, title: 'The Combining',
      giver: 'the-penitent', kind: 'craft', target: 'lythseal', count: 1,
      reward: { shards: 8 },
      hint: 'A proof fragment and twenty shards at the registry’s cold anvil. The anvil cannot interpolate promises.',
    },
    {
      id: 'q-faces', main: true, title: 'Give Back the Faces',
      giver: 'the-penitent', kind: 'kill', target: 'q', count: 10,
      reward: { shards: 12 },
      hint: 'Ten Phantoms wear burned names near the necropolis. Walk the Seal close and the stolen faces boil off — it never names the innocent, it only fails the forged.',
    },
    {
      id: 'q-rite', main: true, title: 'The Rite of Striking',
      giver: 'sere-kallow', kind: 'glyph', target: '0', count: 1,
      reward: { shards: 8 },
      hint: 'At the bell tower: name, bond, burn — each rune once and only once. The mark that cannot be unsaid comes last. It always comes last.',
    },
    {
      id: 'q-bells', main: true, title: 'The Mourning Bells',
      giver: 'sere-kallow', kind: 'switch', target: '0', count: 1,
      reward: { shards: 10 },
      hint: 'Toll seven of ten bells inside the window. A true count, even over the dead. Especially over the dead. The toll opens the vault approach.',
    },
    {
      id: 'q-vault', main: true, title: 'The Vault of Names',
      giver: 'sere-kallow', kind: 'reach', target: { x: 19, y: 12 }, count: 1,
      reward: { shards: 8 },
      hint: 'The vault answers a LythiumSeal and nothing else. Inside: the heading to Genesis, where the first word was signed.',
    },
    {
      id: 'q-quay', main: true, title: 'Skiff Out',
      giver: 'sere-kallow', kind: 'reach', target: { x: 71, y: 2 }, count: 1,
      hint: 'The heading is yours. Reach the far quay and skiff out for Genesis.',
    },
    {
      id: 'q-keepers', title: 'Lay the Keepers to Rest',
      giver: 'the-penitent', kind: 'glyph', target: '1', count: 1,
      reward: { shards: 6 },
      hint: 'Anchor, then burn, at the keeper tomb in the west rows. Burned, not forgotten — that is the whole mercy.',
    },
    {
      id: 'q-eastrow', title: 'Still the East Row',
      giver: 'sere-kallow', kind: 'glyph', target: '2', count: 1,
      reward: { shards: 6 },
      hint: 'Quorum, then burn, over the east tombs. A true count holds even here.',
    },
  ],
  intro: [
    {
      title: 'Chapter X — The Burned Names',
      lines: [
        'An island of black glass, where the chain keeps its exiles.',
        'They signed twice the night of the Fall. The Entropy paid them in second chances.',
        'Bonds burned. Names struck. Faces — stolen since.',
      ],
      art: 'entropy',
    },
    {
      title: 'The Struck Ledger',
      lines: [
        'One key is a confession. Two signatures are a sentence.',
        'The Seal never names the innocent. It only fails the forged.',
        'Toll a true count over the dead.',
      ],
      art: 'quorum',
    },
  ],
  outro: [
    {
      title: 'Names at Rest',
      lines: [
        'The last stolen face boils off, and the ash lies still.',
        'The Struck Ledger closes. Burned, not forgotten — that is the whole mercy.',
        'The vault gives up one heading: Genesis. Where the first word was signed.',
      ],
      art: 'dawn',
    },
  ],
  modifiers: {
    // lore sketch transliterated: 'P' (Phantom) -> 'q'; the bell-toll trigger
    // waves are approximated by the 840s pulse; the 960s 'all-edges' ledger
    // contest splits into east+south fronts (the sim takes one edge per wave)
    waves: [
      { at: 300, letters: 'zzqqs', edge: 'n' },   // phantoms in struck names
      { at: 600, letters: 'qqffq', edge: 'w' },   // ash-storm wave
      { at: 840, letters: 'qzqz', edge: 'e' },    // the names object
      { at: 960, letters: 'qqzz', edge: 'e' },    // the ledger contested
      { at: 975, letters: 'zzqq', edge: 's' },
    ],
  },
  tiles: grid.map(r => r.join('')),
};

console.log('npcs (scan order):', def.npcs.map(n => n.id).join(', '));
console.log('builds (scan order):', def.builds.map(b => b.kind).join(', '));
console.log('chests (scan order):', def.chests.map(c => c.loot).join(', '));
console.log('pickups (scan order):', def.pickups.map(p => p.kind).join(', '));
console.log('qitems (scan order):', def.qitems.map(q => q.id).join(', '));
console.log('glyphs (scan order):', def.glyphs.map(g => `${g.group}:${g.symbol}`).join(' '));
console.log('switches: 10 mourning bells, quorum 7-of-10 inside a 120s window');

const out = path.join(__dirname, '../levels/story/ch10.json');
fs.writeFileSync(out, JSON.stringify(def, null, 2) + '\n');
console.log('wrote', out);
