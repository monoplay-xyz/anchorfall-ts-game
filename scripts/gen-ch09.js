// Generates levels/story/ch09.json — "Chapter IX — The Drift Sea", the Act III
// opener. Deterministic (fixed seed 20261209): re-running always reproduces it.
// A 96x64 void-sea archipelago: past Last Light Pier the map is '%' deep Drift
// (uncrossable abyss). Shoals float on it, drift-water channels ('~') thread
// between them for skiff travel, and teleport wave-tunnels arc shoal to shoal:
//
//   PIER (W)         Last Light Pier — spawns, chart-house (Noor Avesh),
//                    Joss Maru's dock camp, pier beacon site, skiff moorings,
//                    south banks running to the map edge (wave approach)
//   NORTH SHOAL      voices + stormgun, wave-tunnel from the pier
//   SOUTH SHOAL      voices + flamer + third skiff, wave-tunnel from the pier
//   CORRIDOR ISLE (E) the corridor mouth: voice, walled rite court
//                    (corridor-gate <- 4-of-6 quorum; pad-gate <- tide rite),
//                    outer pad of the settled corridor; a breakwater arm runs
//                    to the east edge (wave approach)
//   FAR SHORE        across pure void — inner pad + the chapter-gate reach
//   3 BUOY ISLETS    skiff-only: the three sunken wave-log qitems
//
// Main chain (per the Act III lore): reach the chart-house -> fetch the three
// wave-logs by skiff -> build the pier beacon -> 4-of-6 harbor voices inside a
// 100s window (opens corridor-gate) -> the Tide Rite, WAVE>VERTEX>SEAL>ANCHOR
// (opens pad-gate) -> stand the outer pad and reach the far shore. Untimed.
// NOTE: the lore's "bell ambush on each raised log" has no engine trigger —
// approximated as extra small timed 's'-edge waves (240/360/600/720 cadence).
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
const rnd = mulberry32(20261209);

// the Drift: everything starts as void
const grid = Array.from({ length: H }, () => Array(W).fill('%'));
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
// water lays ONLY over remaining void, so shoal coastlines stay land
const water = (x0, x1, y0, y1) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (get(x, y) === '%') set(x, y, '~');
};

// --- border ---
for (let x = 0; x < W; x++) { set(x, 0, '#'); set(x, H - 1, '#'); }
for (let y = 0; y < H; y++) { set(0, y, '#'); set(W - 1, y, '#'); }

// --- shoals (carved out of the void) ---
clearRect(2, 24, 16, 50);    // PIER: Last Light Pier island
clearRect(10, 20, 50, 57);   // pier south banks (upper)
clearRect(12, 18, 57, 62);   // pier south banks (lower) — touches the s edge band
clearRect(36, 52, 6, 22);    // NORTH SHOAL
clearRect(34, 52, 42, 58);   // SOUTH SHOAL
clearRect(40, 48, 58, 62);   // south shoal arm — touches the s edge band
clearRect(58, 76, 24, 50);   // CORRIDOR ISLE
clearRect(76, 94, 47, 52);   // breakwater arm — touches the e edge band
clearRect(84, 91, 28, 38);   // FAR SHORE (inset >=4 from the e border: no wave spawns)
clearRect(29, 33, 8, 12);    // buoy islet A (north run)
clearRect(54, 57, 9, 13);    // buoy islet C (east run)
clearRect(26, 30, 53, 57);   // buoy islet B (south pocket)
clearRect(31, 32, 22, 23);   // scenic drift islet (harbor)
clearRect(29, 30, 42, 43);   // scenic drift islet (harbor, south)

// --- drift-water channels (skiff lanes; all one connected body) ---
water(25, 35, 4, 16);   // W2 north run (around buoy A)
water(25, 33, 16, 50);  // W1 the harbor basin
water(19, 33, 50, 62);  // W5 south pocket (around buoy B)
water(34, 57, 29, 33);  // W3 mid lane east to the corridor isle shore
water(53, 57, 6, 29);   // W4 east run (around buoy C), joins W3

// --- structures ---
// the chart-house (Noor Avesh, the Struck^W drift charts)
wallRing(13, 21, 20, 26); clearRect(14, 20, 21, 25); set(17, 26, '.');
// the storehouse
wallRing(4, 9, 38, 43); clearRect(5, 8, 39, 42); set(6, 43, '.');
// the corridor mouth: walled rite court + inner pad chamber on the isle
wallRing(63, 75, 28, 40); clearRect(64, 74, 29, 39);
for (let y = 29; y <= 39; y++) set(72, y, '#');   // inner wall: court | chamber
set(63, 33, '.'); set(63, 34, '.');               // door 'corridor-gate' (quorum)
set(72, 33, '.'); set(72, 34, '.');               // door 'pad-gate' (tide rite)
// the pier: planks carved over the basin water
const roadMask = new Set();
const road = (x0, x1, y0, y1) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { set(x, y, '.'); roadMask.add(x + ',' + y); }
};
road(25, 29, 33, 34);   // pier planks (the causeway, not the sheen)
road(3, 24, 33, 35);    // harbor road: spawns -> dock

// --- wild scatter (rock snags + driftwood trees) on the big shoals ---
const RESERVED = [
  [12, 22, 19, 27],  // chart-house + yard
  [3, 10, 37, 44],   // storehouse
  [2, 30, 32, 36],   // harbor road + pier
  [11, 19, 48, 62],  // banks spine + choke
  [60, 76, 26, 42],  // rite court + approach
  [76, 94, 48, 51],  // breakwater arm lane
  [84, 91, 28, 38],  // far shore stays clean glass
];
const inReserved = (x, y) => RESERVED.some(([x0, x1, y0, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
function blob(cx, cy, r, c, density = 0.75) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r && get(x, y) === '.' && !inReserved(x, y) && rnd() < density * (1 - d / (r + 1))) set(x, y, c);
    }
  }
}
const SCATTER_ZONES = [
  [3, 23, 17, 49],   // pier island
  [37, 51, 7, 21],   // north shoal
  [35, 51, 43, 57],  // south shoal
  [59, 75, 25, 49],  // corridor isle
];
function scatter(n, r0, r1, c) {
  let placed = 0, guard = 0;
  while (placed < n && guard++ < 600) {
    const [x0, x1, y0, y1] = SCATTER_ZONES[Math.floor(rnd() * SCATTER_ZONES.length)];
    const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0);
    if (inReserved(Math.round(x), Math.round(y))) continue;
    blob(x, y, r0 + rnd() * (r1 - r0), c);
    placed++;
  }
}
scatter(14, 0.8, 1.8, '#');
scatter(9, 0.6, 1.1, 'T');
// re-clear the routes the scatter must never choke
road(3, 24, 33, 35);          // harbor road again (mask is a set: no dupes)
clearRect(14, 16, 50, 62);    // banks spine
clearRect(58, 62, 32, 36);    // west shore -> corridor-gate
clearRect(76, 94, 49, 50);    // breakwater lane

// ============================ entity placement ==============================
// Exact-coordinate placement with nearest-open fallback; every placement is
// recorded so the row-major def arrays bind correctly.
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

// --- player spawns + pier dressing ---
for (const [px, py] of [[5, 32], [5, 34], [7, 32], [7, 34]]) placeAt('P', px, py);
placeAt('*', 9, 32);   // landing fire by the spawns
placeAt('*', 22, 36);  // Joss Maru's dock brazier
placeAt('S', 11, 36);  // harbor market

// --- npcs (the chartwright and the tidewarden, lore-faithful) ---
const npcPlan = [
  {
    x: 17, y: 23,
    npc: {
      id: 'noor-avesh', name: 'Chartwright Noor Avesh',
      lines: [
        'Noor Avesh, chartwright. Mind the maps — out here they redraw themselves while your back is turned.',
        'Past this pier, nothing has ever happened once and for all. That is the Drift. Sail accordingly.',
        'Three survey buoys went down with their wave-logs. Take the skiff, raise the logs, and my chart becomes a promise instead of a guess.',
        'Four harbor voices light the crossing corridor — inside the window, mind. The sea forgets slower than the Array field. But it forgets.',
        'The deep Drift takes no hull and no causeway. A settled corridor or nothing — two pads, one agreed state.',
        'When the corridor settles you won’t feel the crossing. You’ll simply already be across. That is the only way over the deep.',
      ],
      gift: { shards: 8 },
    },
  },
  {
    x: 21, y: 36,
    npc: {
      id: 'joss-maru', name: 'Joss Maru, Tidewarden',
      lines: [
        'Tide’s out. Tide’s always out here. What comes in instead, we ring the bell for.',
        'Driftwaves don’t break on a schedule — they break on a grudge. When the bell rings, be behind something.',
        'The shoals hold. The sheen between them doesn’t. Old Tarn’s law travels: walk the causeway, not the sheen.',
        'Husks come up the channels glowing wrong — drift made flesh. Thin them on the water or meet them on your pier.',
        'Take these, salvage pay. Out here the LYTH remembers who carried it better than the sea remembers the ship.',
      ],
      gift: { shards: 6 },
    },
  },
];
const npcPlaced = npcPlan.map(p => ({ at: placeAt('N', p.x, p.y), npc: p.npc }));
const npcs = scanSort(npcPlaced).map(p => p.npc);

// --- build sites: the quest beacon on the pier, defenses for the wave lanes ---
const buildPlan = [
  { kind: 'beacon', cost: 10, x: 25, y: 33 },    // the pier beacon (build quest)
  { kind: 'turret', cost: 10, x: 15, y: 49 },    // banks choke, south waves
  { kind: 'barricade', cost: 4, x: 12, y: 51 },
  { kind: 'barricade', cost: 4, x: 18, y: 51 },
  { kind: 'turret', cost: 10, x: 75, y: 45 },    // breakwater mouth, east waves
];
const buildPlaced = buildPlan.map(b => ({ at: placeAt('B', b.x, b.y), def: { kind: b.kind, cost: b.cost } }));
const builds = scanSort(buildPlaced).map(b => b.def);

// --- chests (def.chests binds row-major) ---
const chestPlan = [
  { x: 6, y: 40, loot: 'shards', amount: 8 },     // storehouse
  { x: 20, y: 25, loot: 'medkit', amount: 1 },    // chart-house (clear of Noor's talk ring: chests outrank npc talk on act)
  { x: 48, y: 18, loot: 'cracker', amount: 2 },   // north shoal camp
  { x: 29, y: 42, loot: 'shards', amount: 7 },    // scenic islet hoard (skiff)
  { x: 26, y: 54, loot: 'shards', amount: 10 },   // buoy islet B hoard (skiff)
  { x: 48, y: 50, loot: 'shield', amount: 1 },    // south shoal
  { x: 71, y: 34, loot: 'toxin', amount: 1 },     // rite court reliquary (clear of the stones: chests outrank glyphs on act)
  { x: 89, y: 36, loot: 'token', amount: 1 },     // far shore: the first-road cache
];
const chestPlaced = chestPlan.map(c => ({ at: placeAt('C', c.x, c.y), def: { loot: c.loot, amount: c.amount } }));
const chests = scanSort(chestPlaced).map(c => c.def);

// --- the three sunken wave-logs (letter 'I', skiff runs by design) ---
const qitemPlan = [
  { x: 31, y: 10, kind: 'wavelog', id: 'qi-log-north' }, // buoy A
  { x: 56, y: 11, kind: 'wavelog', id: 'qi-log-east' },  // buoy C
  { x: 28, y: 55, kind: 'wavelog', id: 'qi-log-south' }, // buoy B
];
const qitemPlaced = qitemPlan.map(q => ({ at: placeAt('I', q.x, q.y), def: { id: q.id, kind: q.kind } }));
const qitems = scanSort(qitemPlaced).map(q => q.def);

// --- field weapon pickups ---
const pickupPlan = [
  { x: 45, y: 9, kind: 'stormgun' },  // north shoal salvage
  { x: 44, y: 55, kind: 'flamer' },   // south shoal salvage
];
const pickupPlaced = pickupPlan.map(p => ({ at: placeAt('A', p.x, p.y), def: { kind: p.kind } }));
const pickups = scanSort(pickupPlaced).map(p => p.def);

// --- the six harbor voices (one quorum: 4-of-6 inside a 100s window) ---
const switchPlan = [
  { x: 43, y: 13, id: 'voice-north' },    // north shoal
  { x: 13, y: 27, id: 'voice-chart' },    // chart-house yard
  { x: 21, y: 31, id: 'voice-dock' },     // dockside
  { x: 60, y: 34, id: 'voice-corridor' }, // outside the corridor-gate
  { x: 15, y: 45, id: 'voice-gate' },     // pier south gate
  { x: 42, y: 47, id: 'voice-south' },    // south shoal
];
const switchPlaced = switchPlan.map(s => ({ at: placeAt('Q', s.x, s.y), def: { id: s.id, group: 0 } }));
const switches = scanSort(switchPlaced).map(s => s.def);

// --- glyphs: the Tide Rite (group 0, WAVE>VERTEX>SEAL>ANCHOR — the Pilot's
// Plaque order holds at sea) in the court, plus a scenery waystone (group 1,
// no group def: it lights and binds nothing) on the far shore ---
const glyphPlan = [
  { x: 66, y: 31, symbol: 1, group: 0 }, // Wave
  { x: 69, y: 31, symbol: 2, group: 0 }, // Vertex
  { x: 66, y: 37, symbol: 3, group: 0 }, // Seal
  { x: 69, y: 37, symbol: 0, group: 0 }, // Anchor
  { x: 89, y: 31, symbol: 7, group: 1 }, // Drift waystone (scenery: the deep ends here)
];
const glyphPlaced = glyphPlan.map(g => ({ at: placeAt('J', g.x, g.y), def: { symbol: g.symbol, group: g.group } }));
const glyphs = scanSort(glyphPlaced).map(g => g.def);

// --- wave-tunnels (teleports) + the settled corridor over the deep ---
const telePlan = [
  { x: 21, y: 18, id: 'tun-north-a', twin: 'tun-north-b' },   // pier -> north shoal
  { x: 38, y: 19, id: 'tun-north-b', twin: 'tun-north-a' },
  { x: 16, y: 48, id: 'tun-south-a', twin: 'tun-south-b' },   // pier -> south shoal
  { x: 37, y: 45, id: 'tun-south-b', twin: 'tun-south-a' },
  { x: 50, y: 8, id: 'tun-east-a', twin: 'tun-east-b' },      // north shoal -> corridor isle
  { x: 61, y: 27, id: 'tun-east-b', twin: 'tun-east-a' },
  { x: 74, y: 34, id: 'corridor-out', twin: 'corridor-in' },  // THE settled corridor
  { x: 86, y: 33, id: 'corridor-in', twin: 'corridor-out' },
];
const telePlaced = telePlan.map(t => ({ at: placeAt('O', t.x, t.y), def: { id: t.id, twin: t.twin } }));
const teleports = scanSort(telePlaced).map(t => t.def);

// --- skiffs: two at the pier head, one on the south shoal shore ---
const skiffPlan = [[29, 33], [29, 34], [34, 47]];
const skiffPlaced = skiffPlan.map(([x, y]) => ({ at: placeAt('V', x, y) }));
const vehicles = skiffPlaced.map(() => ({ kind: 'skiff' }));

// --- LYTH crystals (13: the beacon, turrets and barricades all eat shards) ---
for (const [cx, cy] of [
  [4, 20], [9, 45], [23, 40],   // pier island
  [37, 8], [51, 15],            // north shoal
  [50, 44], [41, 57],           // south shoal
  [59, 46], [67, 25],           // corridor isle
  [85, 30],                     // far shore
  [30, 11], [54, 12], [31, 22], // skiff islets (salvage pay)
]) placeAt('Y', cx, cy);

// --- enemies (~63): husk channels, phantom fleets, drift elites ---
// pier south banks: the husks that come up the channels
for (const [x, y] of [[13, 55], [17, 57], [12, 59], [18, 60], [15, 53]]) placeAt('z', x, y);
placeAt('g', 11, 53); placeAt('g', 19, 56);
placeAt('w', 14, 58); placeAt('w', 16, 61);
// buoy islet guards (skiff fights)
placeAt('a', 30, 9); placeAt('z', 32, 11);            // A
placeAt('q', 55, 10); placeAt('z', 57, 12);           // C
placeAt('v', 27, 54); placeAt('q', 29, 56);           // B
// north shoal: a phantom picket over the stormgun
for (const [x, y] of [[39, 10], [44, 16], [49, 11], [41, 19], [47, 7]]) placeAt('z', x, y);
placeAt('f', 43, 9); placeAt('q', 40, 13); placeAt('q', 46, 17);
placeAt('u', 50, 19); placeAt('a', 38, 15); placeAt('n', 45, 20);
// south shoal: the fleet's southern line
for (const [x, y] of [[36, 50], [44, 44], [49, 46], [38, 56], [42, 60], [46, 61]]) placeAt('z', x, y);
placeAt('g', 40, 52); placeAt('g', 50, 55);
placeAt('s', 43, 51); placeAt('q', 47, 48); placeAt('n', 36, 44); placeAt('u', 45, 60);
// corridor isle: the corridor mouth garrison
for (const [x, y] of [[60, 30], [64, 44], [70, 46], [59, 38], [66, 25], [73, 26]]) placeAt('z', x, y);
placeAt('f', 62, 42); placeAt('f', 68, 45);
placeAt('q', 60, 26); placeAt('q', 71, 44);
placeAt('x', 65, 42); placeAt('s', 59, 33); placeAt('s', 72, 25);
placeAt('n', 67, 47); placeAt('v', 74, 26);
// breakwater arm: where the east waves ride in
placeAt('m', 84, 49);
for (const [x, y] of [[80, 50], [86, 48], [90, 50]]) placeAt('z', x, y);
placeAt('u', 82, 51); placeAt('u', 88, 49);
// far shore: the deep's welcome
placeAt('z', 85, 36); placeAt('z', 88, 30); placeAt('v', 87, 35);

// ============================ integrity checks ==============================
const PASS = c => c !== '#' && c !== 'T' && c !== '~' && c !== 'o' && c !== '%';
const ENTITY = new Set(['P', 'c', 'N', 'B', 'C', 'V', 'Y', 'S', 'H', 'A', 'I', 'Q', 'J', 'O',
  'g', 'a', 'r', 's', 'm', 'n', 'w', 'b', 'z', 'f', 'q', 'v', 'x', 'u']);
// skiff-only ground: the buoy and scenic islets (sea-reach covers them)
const SKIFF_RECTS = [[29, 33, 8, 12], [54, 57, 9, 13], [26, 30, 53, 57], [31, 32, 22, 23], [29, 30, 42, 43]];
const skiffOnly = (x, y) => SKIFF_RECTS.some(([x0, x1, y0, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
const DOORS = [[63, 33], [63, 34], [72, 33], [72, 34]];

// flood mirroring the validator: on foot, through closed doors, pads extend
// reach to their twins; `usePads`/`useDoors` gate the strictness variants
function flood(usePads, useDoors) {
  const blocked = new Set(useDoors ? [] : DOORS.map(([x, y]) => x + ',' + y));
  const seen = Array.from({ length: H }, () => Array(W).fill(false));
  const q = [[5, 32]];
  seen[32][5] = true;
  const run = () => {
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(nx, ny) || seen[ny][nx] || !PASS(get(nx, ny)) || blocked.has(nx + ',' + ny)) continue;
        seen[ny][nx] = true;
        q.push([nx, ny]);
      }
    }
  };
  run();
  if (usePads) {
    for (let pass = 0; pass <= telePlan.length; pass++) {
      let changed = false;
      for (const t of telePlaced) {
        const [tx, ty] = t.at;
        if (!seen[ty][tx]) continue;
        const twin = telePlaced.find(o => o.def.id === t.def.twin);
        if (twin && !seen[twin.at[1]][twin.at[0]]) {
          seen[twin.at[1]][twin.at[0]] = true;
          q.push(twin.at);
          changed = true;
          run();
        }
      }
      if (!changed) break;
    }
  }
  return seen;
}

// 1) every entity off the skiff islets is walk+pad reachable (validator law)
const seenFull = flood(true, true);
{
  const bad = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (ENTITY.has(get(x, y)) && !skiffOnly(x, y) && !seenFull[y][x]) bad.push([get(x, y), x, y]);
  if (!seenFull[33][89]) bad.push(['finale-reach', 89, 33]);
  if (bad.length) { console.error('UNREACHABLE entities:', bad); process.exit(1); }
}
// 2) the deep is deep: without the corridor pads the far shore is unreachable
{
  const seen = flood(false, true);
  if (seen[33][86] || seen[33][89]) { console.error('the deep Drift is crossable on foot'); process.exit(1); }
}
// 3) the rite court holds: with doors shut, court, chamber and far shore seal
{
  const seen = flood(true, false);
  for (const [x, y, what] of [[70, 34, 'rite court'], [74, 34, 'pad chamber'], [89, 33, 'far shore']]) {
    if (seen[y][x]) { console.error(`${what} reachable with the doors shut`); process.exit(1); }
  }
}
// 4) sea-reach (exact validator semantics: pre-seed every walk-seen tile,
// flood '~'/floor outward from the moored skiffs only): the wave-logs, the
// islet hoards and the islet crystals must all ride the water
{
  const seen = seenFull.map(r => r.slice());
  const q = skiffPlaced.map(s => s.at.slice());
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny) || seen[ny][nx]) continue;
      const t = get(nx, ny);
      if (t === '~' || PASS(t)) { seen[ny][nx] = true; q.push([nx, ny]); }
    }
  }
  const bad = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (ENTITY.has(get(x, y)) && skiffOnly(x, y) && !seen[y][x]) bad.push([get(x, y), x, y]);
  if (bad.length) { console.error('SKIFF-UNREACHABLE islet entities:', bad); process.exit(1); }
}
// 5) door tiles cover walkable floor
for (const [x, y] of DOORS) {
  if (!PASS(get(x, y))) { console.error(`door tile ${x},${y} is not walkable`); process.exit(1); }
}
// 6) wave edges answer: s and e bands hold entry candidates (waveEntryPoints law)
function bandCandidates(edge) {
  const len = edge === 'n' || edge === 's' ? W : H;
  let n = 0;
  for (let i = 0; i < len; i++) {
    for (let depth = 0; depth < 2; depth++) {
      const tx = edge === 'w' ? depth : edge === 'e' ? W - 1 - depth : i;
      const ty = edge === 'n' ? depth : edge === 's' ? H - 1 - depth : i;
      if (PASS(get(tx, ty)) && get(tx, ty) !== '!') { n++; break; }
    }
  }
  return n;
}
if (bandCandidates('s') < 8) { console.error('south edge starves its waves'); process.exit(1); }
if (bandCandidates('e') < 4) { console.error('east edge starves its waves'); process.exit(1); }

// ============================ floor painting ================================
const nearWaterTile = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => get(x + dx, y + dy) === '~');
for (let y = 1; y < H - 1; y++) {
  for (let x = 1; x < W - 1; x++) {
    if (get(x, y) !== '.') continue;
    if (roadMask.has(x + ',' + y)) { set(x, y, ';'); continue; }                 // road + pier planks
    if (x >= 14 && x <= 20 && y >= 21 && y <= 25) { set(x, y, ':'); continue; }  // chart-house floor
    if (x >= 5 && x <= 8 && y >= 39 && y <= 42) { set(x, y, ':'); continue; }    // storehouse floor
    if (x >= 64 && x <= 74 && y >= 29 && y <= 39) { set(x, y, ':'); continue; }  // rite court stone
    if (x >= 84 && x <= 91 && y >= 28 && y <= 38) { set(x, y, ':'); continue; }  // far shore: black glass
    if (skiffOnly(x, y)) { set(x, y, '='); continue; }                            // islet sand
    if (nearWaterTile(x, y)) { if (rnd() < 0.7) set(x, y, '='); continue; }       // shorelines
    if (x <= 24 && y >= 16 && y <= 50) { if (rnd() < 0.8) set(x, y, ','); continue; }  // pier island earth
    if (x >= 10 && x <= 20 && y >= 50) { set(x, y, rnd() < 0.55 ? '=' : ','); continue; } // the banks
    if (x >= 36 && y <= 22) { if (rnd() < 0.55) set(x, y, ','); continue; }       // north shoal
    if (x >= 34 && x <= 52 && y >= 42) { if (rnd() < 0.55) set(x, y, ','); continue; } // south shoal
    if (x >= 76 && y >= 47) { set(x, y, rnd() < 0.45 ? '=' : '_'); continue; }    // breakwater bar
    if (x >= 58 && x <= 76 && y >= 24 && y <= 50) { if (rnd() < 0.65) set(x, y, '_'); continue; } // drift-scoured isle
  }
}

// --- letters audit: every emitted char must be a known tile ---
const ALLOWED = new Set('#%~=.,:;_oT*PNBCVYSAIQJOgarsmnwbzfqvxu'.split(''));
for (const row of grid) for (const c of row) {
  if (!ALLOWED.has(c)) { console.error(`unknown tile letter '${c}'`); process.exit(1); }
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
const chestIncome = chestPlan.reduce((n, c) => n + (c.loot === 'shards' ? c.amount : 0), 0);
console.log(`${W}x${H} map (${W * H} tiles)`);
console.log('tile counts:', Object.fromEntries(Object.entries(counts).sort()));
console.log(`enemies: ${enemyTotal} (${enemyLetters.map(c => `${c}:${counts[c] || 0}`).join(' ')})`);
console.log(`economy: build bill ${buildBill} vs crystals ${crystalIncome} + gifts 14 + chests ${chestIncome} + quest rewards 54 + 50% kills ${Math.floor(killIncome / 2)}`);
console.log('npcs (scan order):', npcs.map(n => n.id).join(', '));
console.log('builds (scan order):', builds.map(b => b.kind).join(', '));
console.log('chests (scan order):', chests.map(c => c.loot).join(', '));
console.log('qitems (scan order):', qitems.map(q => q.id).join(', '));
console.log('pickups (scan order):', pickups.map(p => p.kind).join(', '));
console.log('switches (scan order):', switches.map(s => s.id).join(', '));
console.log('glyphs (scan order):', glyphs.map(g => `${g.group}:${g.symbol}`).join(' '));
console.log('teleports (scan order):', teleports.map(t => `${t.id}->${t.twin}`).join(', '));
console.log(grid.map(r => r.join('')).join('\n'));

// ============================ level def =====================================
const def = {
  name: 'The Drift Sea',
  story: true,
  chapter: 9,
  title: 'Chapter IX — The Drift Sea',
  expedition: true,
  objective: 'Cross the unsettled Drift — raise the drowned wave-logs, light the harbor voices, and settle a corridor over the deep',
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
    { group: 0, need: 4, of: 6, window: 100, reward: { openDoor: 'corridor-gate' } },
  ],
  glyphs,
  glyphGroups: [
    { group: 0, order: [1, 2, 3, 0], reward: { openDoor: 'pad-gate' } }, // Wave, Vertex, Seal, Anchor
  ],
  doors: [
    { id: 'corridor-gate', x: 63, y: 33, w: 1, h: 2 },
    { id: 'pad-gate', x: 72, y: 33, w: 1, h: 2 },
  ],
  teleports,
  quests: [
    {
      id: 'landfall', main: true, title: 'Landfall at Last Light Pier',
      giver: 'noor-avesh', kind: 'reach', target: { x: 17, y: 23 }, count: 1,
      hint: 'Reach the chart-house on the final checkpoint shoal — the last place anything is final.',
    },
    {
      id: 'wave-logs', main: true, title: 'Raise the Wave-Logs',
      giver: 'noor-avesh', kind: 'fetch', item: 'wavelog', count: 3, reward: { shards: 10 },
      hint: 'Three survey buoys went down with their wave-logs. Take the skiff — raise the logs and the chart becomes a promise.',
    },
    {
      id: 'pier-beacon', main: true, title: 'Light the Pier Beacon',
      giver: 'joss-maru', kind: 'build', target: 'beacon', count: 1, reward: { shards: 6 },
      hint: 'Raise a beacon at the pier so the harbor field has a heartbeat to count against.',
    },
    {
      id: 'harbor-voices', main: true, title: 'The Harbor Voices',
      giver: 'noor-avesh', kind: 'switch', target: '0', count: 1, reward: { shards: 8 },
      hint: 'Four of six harbor voices inside the window — the sea forgets slower than the Array field, but it forgets.',
    },
    {
      id: 'tide-rite', main: true, title: 'The Tide Rite',
      giver: 'noor-avesh', kind: 'glyph', target: '0', count: 1, reward: { shards: 8 },
      hint: 'Speak the crossing rite in order at the corridor mouth — it begins with the breath the field takes together. The Pilot’s Plaque order holds at sea.',
    },
    {
      id: 'cross-the-deep', main: true, title: 'Cross the Deep',
      giver: 'noor-avesh', kind: 'reach', target: { x: 89, y: 33 }, count: 1,
      hint: 'Stand the outer pad at the top of the wave; the field includes you, and you are simply already across.',
    },
    {
      id: 'channel-husks', title: 'Thin the Channel Husks',
      giver: 'joss-maru', kind: 'kill', target: 'z', count: 12, reward: { shards: 10 },
      hint: 'Husks come up the channels glowing wrong — drift made flesh. Thin them on the water or meet them on your pier.',
    },
    {
      id: 'phantom-fleet', title: 'Break the Phantom Fleet',
      giver: 'noor-avesh', kind: 'kill', target: 'q', count: 4, reward: { shards: 12 },
      hint: 'Phantom fleets patrol the sheen in faces that were never theirs. Out here nothing is final — make them final.',
    },
  ],
  intro: [
    {
      title: 'Chapter IX — The Drift Sea',
      lines: [
        'Act III. Past the last checkpoint, the map stops promising.',
        'The Drift: every wave that never settled, wide as a sea.',
        'Nothing out there is final. Bring finality with you.',
      ],
      art: 'crossing',
    },
    {
      title: 'Last Light Pier',
      lines: [
        'The Anchorcraft holds at the last checkpoint — the deep Drift binds to nothing.',
        'Skiffs from here. Channel to channel, shoal to shoal.',
        'Keep the signal alive.',
      ],
      art: 'anchorcraft',
    },
  ],
  outro: [
    {
      title: 'Across the Unsettled',
      lines: [
        'The corridor settles: two pads, one agreed state — and the deep is simply crossed.',
        'Behind the crew, the wave-buoys burn in a line. The first true road on the sea.',
        'Mid-Drift, an island of black glass glows. Names were burned there once.',
      ],
      art: 'dawn',
    },
  ],
  modifiers: {
    waves: [
      { at: 240, letters: 'zzzss', edge: 's' },   // husks up the channels
      { at: 360, letters: 'zzs', edge: 's' },     // bell ambush (timed echo)
      { at: 480, letters: 'zzffu', edge: 'e' },   // forklings off the sheen
      { at: 600, letters: 'zzs', edge: 's' },     // bell ambush (timed echo)
      { at: 720, letters: 'zzzzsff', edge: 's' }, // driftwave — breaks on a grudge
      { at: 960, letters: 'zzuuff', edge: 'e' },  // the sheen contests the corridor
    ],
  },
  tiles: grid.map(r => r.join('')),
};
const out = path.join(__dirname, '../levels/story/ch09.json');
fs.writeFileSync(out, JSON.stringify(def, null, 2) + '\n');
console.log('wrote', out);
