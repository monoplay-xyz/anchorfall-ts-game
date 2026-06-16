// Generates levels/story/ch07.json — "Chapter VII — The Anchorcraft", Act II opener.
// Deterministic (fixed seed 20260617): re-running always produces the same map.
// A 92x64 crash-site chapter: a road network links a small village (elder,
// forgekeeper, corridor warden, market, hire post) to the crashed Anchorcraft
// in the east. The craft's INTERIOR is a sealed compartment suite (airlock /
// hold / reactor / helm) entered only via an airlock teleport pair — the
// frontier-III interior pattern. No gate: the quest chain drives the mission,
// ending on a 'reach' at the helm console (launch).
//
// Main chain (elder-sefa): three hull-component fetches (guarded depot,
// swamp wreck islet by skiff, 3-glyph vault) -> build the launch pylon at the
// hull breach -> settle the 4-rune helm rite inside -> reach the helm.
// Secondaries: clear the husk nest ('z' debuts in numbers) for the warden,
// recover a proof fragment for the forgekeeper.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = 92, H = 64;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260617);

const grid = Array.from({ length: H }, () => Array(W).fill('.'));
const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const get = (x, y) => (inBounds(x, y) ? grid[y][x] : '#');
const set = (x, y, c) => { if (inBounds(x, y)) grid[y][x] = c; };
const isOpen = (x, y) => get(x, y) === '.';
const clearRect = (x0, x1, y0, y1, c = '.') => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c);
};
const wallRing = (x0, x1, y0, y1) => {
  for (let x = x0; x <= x1; x++) { set(x, y0, '#'); set(x, y1, '#'); }
  for (let y = y0; y <= y1; y++) { set(x0, y, '#'); set(x1, y, '#'); }
};

function blob(cx, cy, r, c, density = 0.75) {
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

// --- wild scatter (rock + trees) outside the planned set pieces ---
const RESERVED = [
  [3, 27, 21, 47],   // village
  [4, 22, 2, 18],    // husk nest (gets its own rubble)
  [33, 51, 3, 16],   // depot
  [27, 51, 45, 62],  // swamp
  [56, 70, 45, 59],  // vault + yard
  [50, 65, 24, 44],  // crash furrow + pad
  [62, 91, 22, 44],  // anchorcraft hull
];
const inReserved = (x, y) => RESERVED.some(([x0, x1, y0, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
function scatter(n, r0, r1, c) {
  let placed = 0, guard = 0;
  while (placed < n && guard++ < 500) {
    const x = 2 + rnd() * (W - 4), y = 2 + rnd() * (H - 4);
    if (inReserved(Math.round(x), Math.round(y))) continue;
    blob(x, y, r0 + rnd() * (r1 - r0), c);
    placed++;
  }
}
scatter(22, 1.2, 2.6, '#');
scatter(14, 1.3, 2.4, 'T');

// --- husk nest (NW): ash rubble, drift-touched ground ---
for (let i = 0; i < 7; i++) blob(7 + rnd() * 12, 5 + rnd() * 10, 1.0 + rnd() * 1.6, '#');
// open lanes through the rubble so no nest pocket seals shut
clearRect(5, 20, 9, 9);
clearRect(12, 12, 4, 16);
clearRect(5, 20, 14, 14);

// --- the village (x4..26, y22..46): palisade, houses, square ---
clearRect(4, 26, 22, 46);
wallRing(4, 26, 22, 46);
clearRect(26, 26, 33, 35);   // east gate onto the road
clearRect(13, 15, 22, 22);   // north gate toward the nest
// elder's hall
wallRing(7, 14, 24, 28); clearRect(8, 13, 25, 27); set(10, 28, '.');
// cottage
wallRing(18, 24, 24, 27); clearRect(19, 23, 25, 26); set(21, 27, '.');
// forge house (Hask's)
wallRing(6, 11, 39, 44); clearRect(7, 10, 40, 43); set(9, 39, '.');
// second cottage
wallRing(14, 19, 40, 44); clearRect(15, 18, 41, 43); set(16, 40, '.');

// --- depot (N, x35..49, y5..14): walled relay compound, mouth south ---
clearRect(35, 49, 5, 14);
wallRing(35, 49, 5, 14);
clearRect(41, 43, 14, 14);   // mouth
set(38, 15, 'o'); set(44, 15, 'o'); set(45, 15, 'o'); // sandbag line outside

// --- swamp (S): drowned ground around a wreck islet ---
blob(36, 55, 6.5, '~', 1.0);
blob(44, 56, 5.5, '~', 1.0);
blob(31, 52, 4.0, '~', 1.0);
blob(40, 59, 4.5, '~', 1.0);
// water ring guarantees the islet is moated
clearRect(42, 49, 51, 58, '~');
// the wreck islet
clearRect(44, 47, 53, 56);
set(44, 53, '#'); set(47, 56, '#'); // hull ribs of the drowned wreck
// shore tile for the skiff mooring, plus a solid water channel to the moat:
// the validator's sea-flood never expands through walk-reachable land, so the
// mooring must reach the islet ring on unbroken water
set(38, 50, '.'); set(37, 50, '.');
clearRect(38, 42, 51, 51, '~');
clearRect(40, 42, 52, 52, '~');

// --- keeper's vault (SE, x59..67, y51..57): 3-rune lock, mouth north ---
clearRect(58, 68, 48, 50);   // front yard for the stones
clearRect(59, 67, 51, 57);
wallRing(59, 67, 51, 57);
set(63, 51, '.');            // mouth — covered by the vault-door rect

// --- crash furrow + pad platform (x52..63, y26..42) ---
clearRect(58, 63, 30, 38);   // landing/pad platform before the hull
set(58, 30, 'o'); set(58, 38, 'o'); // sandbags flanking the platform
for (let i = 0; i < 5; i++) blob(52 + rnd() * 8, 27 + rnd() * 14, 0.9 + rnd() * 1.2, '#'); // debris

// --- THE ANCHORCRAFT (x64..89, y24..42): sealed hull, interior suite ---
clearRect(64, 89, 24, 42, '#');
clearRect(65, 67, 31, 35);   // airlock
clearRect(69, 74, 27, 39);   // the hold (aft)
clearRect(76, 81, 28, 38);   // the reactor (the Burn Room)
clearRect(78, 79, 31, 35, '#'); // lythium burn chamber behind amber glass
clearRect(83, 85, 29, 37);   // bridge antechamber
clearRect(87, 88, 31, 35);   // the helm
set(68, 33, '.');            // door-hold (bulkhead)
set(75, 33, '.');            // door-reactor (bulkhead)
set(82, 33, '.');            // open amidships gangway
set(86, 33, '.');            // door-helm (the rite's door)

// --- roads (carved after all painting so they always connect) ---
const roadMask = new Set();
const road = (x0, x1, y0, y1) => {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) { set(x, y, '.'); roadMask.add(x + ',' + y); }
  }
};
road(27, 63, 33, 35);  // main road: village east gate -> pad platform
road(39, 41, 15, 33);  // north branch -> depot mouth
road(49, 51, 35, 49);  // south branch -> shore/vault corridor
road(36, 67, 48, 49);  // shore + vault corridor
road(13, 15, 17, 21);  // nest path from the north gate

// ============================ entity placement ==============================
// Exact-coordinate placement with nearest-open fallback; every placement is
// recorded so row-major def arrays (npcs/builds/qitems/...) bind correctly.
function placeAt(c, x, y) {
  for (let r = 0; r < 5; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = x + dx, ty = y + dy;
        if (tx < 1 || ty < 1 || tx >= W - 1 || ty >= H - 1) continue;
        if (isOpen(tx, ty)) { set(tx, ty, c); return [tx, ty]; }
      }
    }
  }
  console.error(`failed to place '${c}' near ${x},${y}`);
  process.exit(1);
}
const scanSort = arr => arr.sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0]);

// --- player spawns + village square dressing ---
for (const [px, py] of [[11, 33], [11, 35], [13, 33], [13, 35]]) placeAt('P', px, py);
placeAt('*', 16, 34); // square campfire
placeAt('*', 10, 41); // forge fire
placeAt('S', 19, 32); // market shop
placeAt('H', 19, 36); // hire post

// --- npcs (3 quest givers in the village + the inscription plaque inside) ---
const npcPlan = [
  {
    x: 15, y: 33,
    npc: {
      id: 'elder-sefa', name: 'Elder Sefa Tenwright',
      lines: [
        'Ten keepers founded this village. I have buried six. You see the arithmetic of my problem.',
        'The craft in the east fell before the Fall finished falling. Plating, coil, regulator — three salvage runs, and I settle each one in the ledger.',
        'The depot keeps the plating, and its keepers now are not keepers. The swamp wreck keeps the coil — take the skiff. The vault keeps the regulator, and its own counsel.',
        'The vault answers three runes: first, the mark that cannot be unsaid. Then seven of ten, and not six. Last, what waits for all who are not anchored.',
        'The helm rite begins with the breath the field takes together, then one voice, once, and only once. The pilot’s plaque keeps the rest. Two and two — that is my half of four.',
        'Raise the pylon at the breach when the salvage is settled. The Anchor takes no fractions, operator. Neither does the craft.',
      ],
      gift: { shards: 8 },
    },
  },
  {
    x: 23, y: 34,
    npc: {
      id: 'warden-mirelle', name: 'Mirelle, Corridor Warden',
      lines: [
        'You don’t move. The world agrees you’ve moved. Try to be the kind of person worlds agree with.',
        'The husk nest at the north-west edge is drift made flesh. Thin it out and the road breathes again.',
        'The craft’s airlock is a settled corridor: two pads, one agreed state. Stand on the outer pad, let the field include you, and you are simply already inside.',
        'An unsettled corridor doesn’t lose travelers. It reconsiders them. I never send anyone mid-breath — the pad channels at the top of the wave.',
      ],
    },
  },
  {
    x: 8, y: 41,
    npc: {
      id: 'hask-embervein', name: 'Hask Embervein, Forgekeeper',
      lines: [
        'One key is a confession. Seven keys are a country.',
        'A keeper fell in the husk nest, north-west, carrying a proof fragment. Bring me fragments, not promises — the anvil cannot interpolate promises.',
        'Six fragments make slag. Don’t look at me like that — six is not a quorum at this anvil either.',
        'Burned hands, operator. Count your hammer blows out loud and you will never lose track of what is true.',
      ],
    },
  },
  {
    x: 84, y: 30,
    npc: {
      id: 'pilots-plaque', name: 'The Pilot’s Plaque',
      lines: [
        'IN MEMORIAM — she flew between checkpoints, and rests between them too.',
        'The rite, continued: third, what is read only at inclusion. Last, the mark that cannot be unsaid.',
        'Wave, then vertex, then seal, then anchor. The launch is a promise read in order, and finality signs it.',
        'SEALED — READ AT INCLUSION. The hold’s cargo will not open until the launch settles.',
      ],
    },
  },
];
const npcPlaced = npcPlan.map(p => ({ at: placeAt('N', p.x, p.y), npc: p.npc }));
const npcs = scanSort(npcPlaced).map(p => p.npc);

// --- build sites: gate barricades, pad turret, mid-map save beacon, the
// launch pylon at the hull breach (the build-quest target) ---
const buildPlan = [
  { kind: 'barricade', cost: 4, x: 28, y: 32 },
  { kind: 'barricade', cost: 4, x: 28, y: 36 },
  { kind: 'turret', cost: 10, x: 59, y: 32 },   // covers the airlock pad
  { kind: 'beacon', cost: 10, x: 48, y: 32 },   // mid-map checkpoint
  { kind: 'pylon', cost: 18, x: 62, y: 37 },    // the hull-breach repair
];
const buildPlaced = buildPlan.map(b => ({ at: placeAt('B', b.x, b.y), def: { kind: b.kind, cost: b.cost } }));
const builds = scanSort(buildPlaced).map(b => b.def);

// --- chests (def.chests binds row-major) ---
const chestPlan = [
  { x: 9, y: 26, loot: 'shards', amount: 8 },     // elder's hall
  { x: 22, y: 25, loot: 'cracker', amount: 2 },   // cottage
  { x: 38, y: 7, loot: 'shield', amount: 1 },     // depot stores
  { x: 47, y: 36, loot: 'medkit', amount: 1 },    // road junction cache
  { x: 46, y: 55, loot: 'shards', amount: 10 },   // wreck islet hoard
  { x: 61, y: 55, loot: 'toxin', amount: 1 },     // vault reliquary
  { x: 70, y: 27, loot: 'shards', amount: 9 },    // hold crate (sealed cargo)
  { x: 74, y: 39, loot: 'medkit', amount: 1 },    // hold crate (sealed cargo)
];
const chestPlaced = chestPlan.map(c => ({ at: placeAt('C', c.x, c.y), def: { loot: c.loot, amount: c.amount } }));
const chests = scanSort(chestPlaced).map(c => c.def);

// --- quest items (letter 'I', def.qitems binds row-major) ---
const qitemPlan = [
  { x: 42, y: 8, kind: 'plating', id: 'qi-plating' },      // guarded depot
  { x: 12, y: 9, kind: 'fragment', id: 'qi-fragment' },    // fallen keeper, husk nest
  { x: 45, y: 54, kind: 'coil', id: 'qi-coil' },           // swamp wreck islet
  { x: 63, y: 54, kind: 'regulator', id: 'qi-regulator' }, // behind the 3-glyph lock
];
const qitemPlaced = qitemPlan.map(q => ({ at: placeAt('I', q.x, q.y), def: { id: q.id, kind: q.kind } }));
const qitems = scanSort(qitemPlaced).map(q => q.def);

// --- field weapon pickups (letter 'A', def.pickups binds row-major) ---
const pickupPlan = [
  { x: 45, y: 10, kind: 'flamer' },     // depot armory
  { x: 73, y: 38, kind: 'mortarMk2' },  // the hold
];
const pickupPlaced = pickupPlan.map(p => ({ at: placeAt('A', p.x, p.y), def: { kind: p.kind } }));
const pickups = scanSort(pickupPlaced).map(p => p.def);

// --- relay switches (bulkhead releases inside the craft) ---
const switchPlan = [
  { x: 65, y: 31, id: 'airlock-bulkhead', group: 0 }, // opens door-hold
  { x: 70, y: 37, id: 'hold-bulkhead', group: 1 },    // opens door-reactor
];
const switchPlaced = switchPlan.map(s => ({ at: placeAt('Q', s.x, s.y), def: { id: s.id, group: s.group } }));
const switches = scanSort(switchPlaced).map(s => s.def);

// --- glyph stones: vault lock (group 0, ANCHOR>QUORUM>DRIFT) and the helm
// rite (group 1, WAVE>VERTEX>SEAL>ANCHOR) ---
const glyphPlan = [
  { x: 60, y: 49, symbol: 0, group: 0 }, // Anchor
  { x: 63, y: 49, symbol: 6, group: 0 }, // Quorum
  { x: 66, y: 49, symbol: 7, group: 0 }, // Drift
  { x: 83, y: 30, symbol: 1, group: 1 }, // Wave
  { x: 85, y: 30, symbol: 2, group: 1 }, // Vertex
  { x: 83, y: 36, symbol: 3, group: 1 }, // Seal
  { x: 85, y: 36, symbol: 0, group: 1 }, // Anchor
];
const glyphPlaced = glyphPlan.map(g => ({ at: placeAt('J', g.x, g.y), def: { symbol: g.symbol, group: g.group } }));
const glyphs = scanSort(glyphPlaced).map(g => g.def);

// --- airlock teleport pair (the settled corridor into the craft) ---
const telePlan = [
  { x: 61, y: 34, id: 'airlock-out', twin: 'airlock-in' },
  { x: 66, y: 33, id: 'airlock-in', twin: 'airlock-out' },
];
const telePlaced = telePlan.map(t => ({ at: placeAt('O', t.x, t.y), def: { id: t.id, twin: t.twin } }));
const teleports = scanSort(telePlaced).map(t => t.def);

// --- the skiff to the wreck islet ---
placeAt('V', 38, 50);
const vehicles = [{ kind: 'skiff' }];

// --- LYTH crystals (12, generous along every salvage route) ---
for (const [cx, cy] of [
  [5, 31],            // village
  [7, 14], [19, 10],  // nest
  [37, 12],           // depot
  [32, 32], [51, 32], // road + junction
  [36, 47],           // swamp shore
  [65, 55],           // vault
  [54, 28], [55, 40], // crash furrow
  [76, 29], [76, 37], // reactor shard hoppers
]) placeAt('Y', cx, cy);

// --- enemies (~64): z swarms debut, f alphas, u beetles, classic mix ---
// husk nest: the kill-quest swarm (14 z + 3 u)
for (let i = 0; i < 14; i++) placeAt('z', Math.round(7 + rnd() * 12), Math.round(5 + rnd() * 10));
placeAt('u', 9, 7); placeAt('u', 15, 12); placeAt('u', 18, 6);
// open field along the roads
placeAt('z', 30, 31); placeAt('z', 33, 37); placeAt('z', 36, 32);
placeAt('z', 44, 37); placeAt('z', 46, 31); placeAt('z', 34, 41);
placeAt('g', 29, 36); placeAt('g', 35, 30); placeAt('g', 42, 32); placeAt('g', 45, 36);
placeAt('w', 31, 33); placeAt('w', 43, 34);
placeAt('m', 33, 7); // brood nest west of the depot keeps the field alive
// depot garrison (the plating's not-keepers)
placeAt('f', 41, 12); placeAt('f', 44, 8);
placeAt('g', 38, 9); placeAt('g', 43, 11); placeAt('g', 46, 7);
placeAt('a', 37, 8); placeAt('a', 46, 12);
placeAt('s', 42, 9); placeAt('n', 39, 6);
// swamp lurkers
placeAt('a', 45, 55);                  // wreck islet archer
placeAt('n', 33, 48);                  // far-shore sniper
placeAt('u', 30, 47); placeAt('u', 43, 47);
placeAt('z', 35, 47); placeAt('z', 41, 47); placeAt('z', 47, 47);
// vault guard
placeAt('f', 59, 48); placeAt('r', 61, 47); placeAt('s', 65, 47); placeAt('n', 67, 50);
// crash furrow: the Entropy picks at the hull
placeAt('z', 53, 30); placeAt('z', 56, 27); placeAt('z', 57, 41); placeAt('z', 53, 38); placeAt('z', 52, 34);
placeAt('u', 55, 33); placeAt('u', 57, 29);
placeAt('f', 54, 36); placeAt('s', 56, 31); placeAt('g', 52, 31); placeAt('g', 52, 39);
placeAt('m', 53, 41); // second brood nest in the furrow
// drift vermin sealed in the hold
placeAt('z', 71, 33); placeAt('z', 72, 30);

// ============================ integrity checks ==============================
const PASS = c => c !== '#' && c !== 'T' && c !== '~' && c !== 'o';
const ENTITY = new Set(['P', 'c', 'N', 'B', 'C', 'V', 'Y', 'S', 'H', 'A', 'I', 'Q', 'J', 'O',
  'g', 'a', 'r', 's', 'm', 'n', 'w', 'b', 'z', 'f', 'q', 'v', 'x', 'u']);
const inHull = (x, y) => x >= 64 && x <= 89 && y >= 24 && y <= 42;
// the wreck islet is a skiff run by design (the validator sea-floods chests
// from the moored skiff; qitems and enemies carry no on-foot requirement)
const onIslet = (x, y) => x >= 43 && x <= 48 && y >= 52 && y <= 57;

function flood(sx, sy, pass) {
  const seen = Array.from({ length: H }, () => Array(W).fill(false));
  const q = [[sx, sy]];
  seen[sy][sx] = true;
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (inBounds(nx, ny) && !seen[ny][nx] && pass(get(nx, ny))) { seen[ny][nx] = true; q.push([nx, ny]); }
    }
  }
  return seen;
}

// exterior: everything outside the hull reachable on foot from spawn
const seenExt = flood(11, 33, PASS);
{
  const bad = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (ENTITY.has(get(x, y)) && !inHull(x, y) && !onIslet(x, y) && !seenExt[y][x]) bad.push([get(x, y), x, y]);
  if (bad.length) { console.error('UNREACHABLE exterior entities:', bad); process.exit(1); }
  if (seenExt[33][66]) { console.error('hull breached: exterior flood reached the airlock'); process.exit(1); }
}
// interior: every compartment entity reachable from the inner pad (the
// validator floods teleport twins and walks closed doors the same way)
{
  const seen = flood(66, 33, PASS);
  const bad = [];
  for (let y = 24; y <= 42; y++)
    for (let x = 64; x <= 89; x++)
      if (ENTITY.has(get(x, y)) && !seen[y][x]) bad.push([get(x, y), x, y]);
  if (!seen[33][88]) bad.push(['helm-console', 88, 33]);
  if (bad.length) { console.error('UNREACHABLE interior entities:', bad); process.exit(1); }
}
// sea-reach: the skiff must cover the wreck islet (coil + hoard). Mirror the
// validator exactly: its sea-flood pre-seeds every walk-seen tile and never
// expands FROM them, so the route must hold on unbroken water.
{
  const seen = seenExt.map(r => r.slice());
  const q = [[38, 50]];
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny) || seen[ny][nx]) continue;
      const t = get(nx, ny);
      if (t === '~' || PASS(t)) { seen[ny][nx] = true; q.push([nx, ny]); }
    }
  }
  for (const [x, y, what] of [[45, 54, 'coil'], [46, 55, 'islet chest']]) {
    if (!seen[y][x]) { console.error(`skiff cannot reach the ${what} at ${x},${y}`); process.exit(1); }
  }
}
// door tiles must be walkable floor
for (const [x, y, id] of [[63, 51, 'vault-door'], [68, 33, 'door-hold'], [75, 33, 'door-reactor'], [86, 33, 'door-helm']]) {
  if (!PASS(get(x, y))) { console.error(`door '${id}' tile ${x},${y} is not walkable`); process.exit(1); }
}

// ============================ floor painting ================================
for (let y = 1; y < H - 1; y++) {
  for (let x = 1; x < W - 1; x++) {
    if (get(x, y) !== '.') continue;
    if (roadMask.has(x + ',' + y)) { set(x, y, ';'); continue; }            // settled roads
    if (inHull(x, y)) { set(x, y, ':'); continue; }                          // craft decking
    if (x >= 59 && x <= 67 && y >= 51 && y <= 57) { set(x, y, ':'); continue; } // vault stone
    if (x >= 4 && x <= 26 && y >= 22 && y <= 46) { if (rnd() < 0.8) set(x, y, ','); continue; } // village earth
    if (x >= 35 && x <= 49 && y >= 5 && y <= 14) { set(x, y, ','); continue; }  // depot yard
    if (x >= 4 && x <= 22 && y >= 2 && y <= 18) { set(x, y, '_'); continue; }   // nest ashfield
    if (x >= 50 && x <= 63 && y >= 25 && y <= 43) { if (rnd() < 0.75) set(x, y, '_'); continue; } // crash scorch
  }
}

// ============================ stats =========================================
const counts = {};
for (const row of grid) for (const c of row) counts[c] = (counts[c] || 0) + 1;
const enemyLetters = ['g', 'a', 'r', 's', 'm', 'n', 'w', 'b', 'z', 'f', 'q', 'v', 'x', 'u'];
const enemyTotal = enemyLetters.reduce((n, c) => n + (counts[c] || 0), 0);
const SHARDS = { g: 1, a: 1, w: 1, r: 2, n: 2, s: 2, m: 3, b: 12, z: 1, f: 2, q: 2, v: 2, x: 3, u: 1 };
const killIncome = enemyLetters.reduce((n, c) => n + (counts[c] || 0) * (SHARDS[c] || 0), 0);
const buildBill = builds.reduce((n, b) => n + b.cost, 0);
const crystalIncome = (counts['Y'] || 0) * 4;
console.log(`${W}x${H} map (${W * H} tiles)`);
console.log('tile counts:', Object.fromEntries(Object.entries(counts).sort()));
console.log(`enemies: ${enemyTotal} (z:${counts.z || 0} f:${counts.f || 0} u:${counts.u || 0} g:${counts.g || 0} a:${counts.a || 0} s:${counts.s || 0} n:${counts.n || 0} r:${counts.r || 0} w:${counts.w || 0} m:${counts.m || 0})`);
console.log(`economy: build bill ${buildBill} vs crystals ${crystalIncome} + chests 27 + quest rewards 58 + 50% kills ${Math.floor(killIncome / 2)}`);
console.log('npcs (scan order):', npcs.map(n => n.id).join(', '));
console.log('builds (scan order):', builds.map(b => b.kind).join(', '));
console.log('qitems (scan order):', qitems.map(q => q.kind).join(', '));
console.log('pickups (scan order):', pickups.map(p => p.kind).join(', '));
console.log('glyphs (scan order):', glyphs.map(g => `${g.group}:${g.symbol}`).join(' '));
console.log('teleports (scan order):', teleports.map(t => t.id).join(', '));
console.log(grid.map(r => r.join('')).join('\n'));

// ============================ level def =====================================
const def = {
  name: 'The Anchorcraft',
  story: true,
  chapter: 7,
  title: 'Chapter VII — The Anchorcraft',
  expedition: true,
  objective: 'Repair the crashed Anchorcraft and take the helm — the Crossing continues',
  time: 900, // untimed in play (story): elapsed drives the waves; kept for tooling
  captiveChars: [],
  npcs,
  builds,
  chests,
  vehicles,
  pickups,
  qitems,
  switches,
  switchGroups: [
    { group: 0, need: 1, of: 1, reward: { openDoor: 'door-hold' } },
    { group: 1, need: 1, of: 1, reward: { openDoor: 'door-reactor' } },
  ],
  glyphs,
  glyphGroups: [
    { group: 0, order: [0, 6, 7], reward: { openDoor: 'vault-door' } },   // Anchor, Quorum, Drift
    { group: 1, order: [1, 2, 3, 0], reward: { openDoor: 'door-helm' } }, // Wave, Vertex, Seal, Anchor
  ],
  doors: [
    { id: 'vault-door', x: 63, y: 51, w: 1, h: 1 },
    { id: 'door-hold', x: 68, y: 33, w: 1, h: 1 },
    { id: 'door-reactor', x: 75, y: 33, w: 1, h: 1 },
    { id: 'door-helm', x: 86, y: 33, w: 1, h: 1 },
  ],
  teleports,
  quests: [
    {
      id: 'hull-plating', main: true, title: 'Salvage: depot hull plating',
      giver: 'elder-sefa', kind: 'fetch', item: 'plating', count: 1, reward: { shards: 8 },
      hint: 'The relay depot north of the road kept spare hull plate. Its keepers now are not keepers.',
    },
    {
      id: 'wave-coil', main: true, title: 'Salvage: the swamp wreck’s wave-coil',
      giver: 'elder-sefa', kind: 'fetch', item: 'coil', count: 1, reward: { shards: 8 },
      hint: 'A second wreck drowned in the south swamp. Take the skiff — the coil survived the water.',
    },
    {
      id: 'burn-regulator', main: true, title: 'Salvage: the vaulted burn regulator',
      giver: 'elder-sefa', kind: 'fetch', item: 'regulator', count: 1, reward: { shards: 8 },
      hint: 'Three runes guard the vault: the mark that cannot be unsaid; seven of ten, and not six; what waits for all who are not anchored.',
    },
    {
      id: 'hull-repair', main: true, title: 'Raise the launch pylon at the hull breach',
      giver: 'elder-sefa', kind: 'build', target: 'pylon', count: 1, reward: { shards: 6 },
      hint: 'Plating, coil, regulator — settled. Raise the pylon at the breach and the craft takes the repair as final.',
    },
    {
      id: 'helm-rite', main: true, title: 'Settle the helm rite — four runes in order',
      giver: 'elder-sefa', kind: 'glyph', target: '1', count: 1, reward: { shards: 6 },
      hint: 'It begins with the breath the field takes together, then one voice, once, and only once. The pilot’s plaque keeps the rest.',
    },
    {
      id: 'launch', main: true, title: 'Reach the helm — launch the Anchorcraft',
      giver: 'elder-sefa', kind: 'reach', target: { x: 88, y: 33 }, count: 1,
      hint: 'Behind you, a world that holds. Ahead, one that doesn’t yet.',
    },
    {
      id: 'husk-nest', title: 'Clear the husk nest',
      giver: 'warden-mirelle', kind: 'kill', target: 'z', count: 12, reward: { shards: 10 },
      hint: 'The nest at the north-west edge is drift made flesh. Twelve husks down and the road breathes again.',
    },
    {
      id: 'keepers-fragment', title: 'Recover the fallen keeper’s proof fragment',
      giver: 'hask-embervein', kind: 'fetch', item: 'fragment', count: 1, reward: { shards: 12 },
      hint: 'Bring me fragments, not promises. The anvil cannot interpolate promises.',
    },
  ],
  intro: [
    {
      title: 'Chapter VII — The Anchorcraft',
      lines: [
        'Act II. East of the village, a starcraft lies where it fell — hull cold, helm sealed.',
        'Elder Tenwright keeps the salvage ledger: plating, coil, regulator.',
        'The Crossing continues. This Anchor takes no fractions.',
      ],
      art: 'anchorcraft',
    },
  ],
  outro: [
    {
      title: 'Relight',
      lines: [
        'The burn chamber catches with a chord, and the lights walk aft to fore.',
        'The field goes gold edge to edge — the corridor of sky settles.',
        'The Anchorcraft rises on one long wave-tunnel.',
      ],
      art: 'anchorcraft',
    },
    {
      title: 'The Crossing Continues',
      lines: [
        'Behind you, a world that holds. Ahead, one that doesn’t yet.',
        'Next: the Prover Array — where mountains are ground into receipts.',
      ],
      art: 'crossing',
    },
  ],
  modifiers: {
    waves: [
      { at: 180, letters: 'zzzzz', edge: 'n' },
      { at: 360, letters: 'zzfuu', edge: 'e' },
      { at: 600, letters: 'zzzzzff', edge: 's' },
      { at: 840, letters: 'zzuuzzf', edge: 'w' },
    ],
  },
  tiles: grid.map(r => r.join('')),
};
const out = path.join(__dirname, '../levels/story/ch07.json');
fs.writeFileSync(out, JSON.stringify(def, null, 2) + '\n');
console.log('wrote', out);
