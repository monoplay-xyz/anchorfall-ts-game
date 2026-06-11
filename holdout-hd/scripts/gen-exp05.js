// Generates levels/level15.json — "Chapter V — Cluster Siege".
// Deterministic (fixed seed): re-running always produces the same map.
// A 72x56 NIGHT DEFENSE map: the squad starts INSIDE a walled cluster camp
// (stone floor, campfires, both NPCs) in the middle of a dark meadow/forest.
// All three relay pylons sit OUTSIDE the walls — north, west, south — so the
// squad must sortie into the dark between nightwaves. The dormant Anchor sits
// in a separate bastion east of camp. Four heavy waves pour in from the map
// edges while modifiers.dark caps enemy sight.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = 72, H = 56;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260615);

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

// --- dark wilderness: rock/tree clumps in every direction ---
for (let i = 0; i < 34; i++) blob(4 + rnd() * 64, 3 + rnd() * 50, 1.4 + rnd() * 2.4, '#');
// black ponds in the outer dark
blob(12, 11, 2.6, '~', 0.85);
blob(11, 45, 2.4, '~', 0.85);
blob(46, 8, 2.2, '~', 0.85);
blob(59, 46, 2.6, '~', 0.85);

// --- central cluster camp (x 18..34, y 20..36): squad starts INSIDE ---
const CX0 = 18, CX1 = 34, CY0 = 20, CY1 = 36;
for (let y = CY0; y <= CY1; y++)
  for (let x = CX0; x <= CX1; x++)
    set(x, y, x === CX0 || x === CX1 || y === CY0 || y === CY1 ? '#' : ';');
// 4 gate gaps (5 tiles): N, W, S single, E double — the main gate faces the Anchor road
const gateTiles = [[26, CY0], [CX0, 28], [26, CY1], [CX1, 27], [CX1, 28]];
for (const [gx, gy] of gateTiles) set(gx, gy, ';');

// --- Anchor bastion (x 52..64, y 22..34), 18 tiles east of the camp wall ---
const BX0 = 52, BX1 = 64, BY0 = 22, BY1 = 34;
for (let y = BY0; y <= BY1; y++)
  for (let x = BX0; x <= BX1; x++)
    set(x, y, x === BX0 || x === BX1 || y === BY0 || y === BY1 ? '#' : ';');
// west gate, double, facing the camp road
set(BX0, 27, ';'); set(BX0, 28, ';');
// the dormant Anchor gate
for (const [ex, ey] of [[60, 27], [61, 27], [60, 28], [61, 28]]) set(ex, ey, 'E');
// sandbag stubs flanking the bastion gate — cover for the sortie east
set(50, 25, 'o'); set(50, 30, 'o');

// --- roads into the dark: 2-wide, from each camp gate out to the map edge.
// They stop at the wall line so the 5 gate tiles stay the only openings. ---
for (let y = 1; y < CY0; y++) { set(25, y, '.'); set(26, y, '.'); }           // north
for (let y = CY1 + 1; y <= H - 2; y++) { set(25, y, '.'); set(26, y, '.'); }  // south
for (let x = 1; x < CX0; x++) { set(x, 27, '.'); set(x, 28, '.'); }           // west
for (let x = CX1 + 1; x < BX0; x++) { set(x, 27, '.'); set(x, 28, '.'); }     // east: the Anchor road

// --- wave entry bands: the 1-deep ring inside the border stays passable so
// every edge offers deterministic nightwave entry points ---
for (let x = 1; x < W - 1; x++) { if (get(x, 1) !== '.') set(x, 1, '.'); if (get(x, H - 2) !== '.') set(x, H - 2, '.'); }
for (let y = 1; y < H - 1; y++) { if (get(1, y) !== '.') set(1, y, '.'); if (get(W - 2, y) !== '.') set(W - 2, y, '.'); }

// --- pylon pockets OUTSIDE the walls: north, west, south ---
const pylonSpots = [[28, 8], [7, 25], [28, 48]];
for (const [px, py] of pylonSpots)
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) set(px + dx, py + dy, '.');

// --- camp interior fittings ---
// spawns: the squad wakes inside the walls
for (const [px, py] of [[24, 27], [28, 27], [24, 29], [28, 29]]) set(px, py, 'P');
// campfires: center fire + one beside each NPC
set(26, 28, '*'); set(27, 22, '*'); set(27, 34, '*');
// NPCs (def.npcs binds to 'N' tiles in row-major scan order)
const npcPlan = [
  {
    x: 26, y: 22,
    npc: {
      id: 'warden-okafor',
      name: 'Warden Okafor',
      lines: [
        "Nightwave's close — walls up, lights low.",
        'In this dark they see eight tiles, no further. Stay dim, strike first.',
        'Five gaps in my wall, five barricade frames waiting. Do the arithmetic before the north wave does.',
        'The pylons sit out in the black — north, west, south. Sortie between waves, never during.',
        'Take my reserve, ten shards. Mortar for the gaps or light for the gate. Spend it alive.',
      ],
      gift: { shards: 10 },
    },
  },
  {
    x: 26, y: 34,
    npc: {
      id: 'doc-aroyo',
      name: 'Doc Aroyo',
      lines: [
        'You again! Last needle I put in you was at the Crossing keep. Small frontier.',
        'Hm, hm-hmm... the old transit jingle. Pre-Fall. It keeps my hands steady.',
        'Crystal nodes glow along the roads — four shards a node. Crack them before the waves trample through.',
        'Stay by the fires between sorties. This dark gets into the joints.',
        "When the Anchor settles, the lines run again. I'll hum us the whole way home.",
      ],
    },
  },
];
const placedNpcs = [];
for (const p of npcPlan) {
  if (get(p.x, p.y) !== ';') { console.error('npc spot occupied', p.npc.id, get(p.x, p.y)); process.exit(1); }
  set(p.x, p.y, 'N');
  placedNpcs.push(p);
}
placedNpcs.sort((a, b) => a.y - b.y || a.x - b.x);
const npcs = placedNpcs.map(p => p.npc);

// --- build sites (def.builds binds to 'B' tiles in row-major scan order) ---
// 5 barricades on the gate gaps, 2 turrets inside, 3 pylons in the outer dark.
const buildPlan = [
  ...gateTiles.map(([x, y]) => ({ kind: 'barricade', cost: 4, x, y })),
  { kind: 'turret', cost: 10, x: 21, y: 25 },
  { kind: 'turret', cost: 10, x: 31, y: 31 },
  ...pylonSpots.map(([x, y]) => ({ kind: 'pylon', cost: 12, x, y })),
];
const placedBuilds = [];
for (const b of buildPlan) {
  if (get(b.x, b.y) !== ';' && get(b.x, b.y) !== '.') { console.error('build spot occupied', b.kind, b.x, b.y, get(b.x, b.y)); process.exit(1); }
  set(b.x, b.y, 'B');
  placedBuilds.push(b);
}
placedBuilds.sort((a, b) => a.y - b.y || a.x - b.x);
const builds = placedBuilds.map(b => ({ kind: b.kind, cost: b.cost }));

// --- captive: the bastion specialist, locked in the Anchor bastion ---
set(56, 28, 'c');
const captiveChars = ['bastion'];

// --- sparse pre-placed enemies (~25): grunts, archers, two bastion snipers ---
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
// place() only accepts '.' so the camp and bastion stone (';') stays clean.
// grunts prowl the dark in all four directions
for (let i = 0; i < 4; i++) place('g', 8 + rnd() * 50, 4 + rnd() * 11);   // north woods
for (let i = 0; i < 4; i++) place('g', 4 + rnd() * 11, 6 + rnd() * 44);   // west woods
for (let i = 0; i < 4; i++) place('g', 10 + rnd() * 50, 41 + rnd() * 11); // south woods
for (let i = 0; i < 4; i++) place('g', 38 + rnd() * 28, 6 + rnd() * 13);  // northeast
// archers ambush the roads and the bastion approach
place('a', 25, 12); place('a', 10, 26); place('a', 25, 44);
place('a', 40, 26); place('a', 47, 29);
place('a', 56, 16); place('a', 56, 40);
// two snipers hold the bastion towers
for (const [sx, sy] of [[55, 24], [55, 31]]) {
  if (get(sx, sy) !== ';') { console.error('sniper spot occupied', sx, sy); process.exit(1); }
  set(sx, sy, 'n');
}

// --- LYTH crystals: generous along the sortie roads (the critical path) ---
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
const crystalPlan = [
  [24, 13], [28, 6],   // north road, toward the north pylon
  [11, 27], [5, 30],   // west road, toward the west pylon
  [24, 43], [28, 51],  // south road, toward the south pylon
  [38, 26], [44, 29], [49, 27], // the Anchor road east
  [31, 17],            // just outside the north gate
];
for (const [cx, cy] of crystalPlan) forceSet(cx, cy, 'Y');

// --- the wilderness rock becomes night forest (keep some rock); the camp
// and bastion walls stay worked stone ---
const campDist = (x, y) => Math.max(Math.abs(x - 26), Math.abs(y - 28));
const inCamp = (x, y) => x >= CX0 && x <= CX1 && y >= CY0 && y <= CY1;
const inBastion = (x, y) => x >= BX0 && x <= BX1 && y >= BY0 && y <= BY1;
for (let y = 1; y < H - 1; y++)
  for (let x = 1; x < W - 1; x++)
    if (get(x, y) === '#' && !inCamp(x, y) && !inBastion(x, y) && rnd() < (campDist(x, y) > 14 ? 0.78 : 0.45)) set(x, y, 'T');

// --- connectivity: everything must be reachable from the camp spawn ---
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
  // walk toward the camp center, carving blockers, until reaching seen ground
  let cx = x, cy = y;
  let guard = 0;
  while (!seen[cy][cx] && guard++ < 300) {
    if (cx > 26) cx--;
    else if (cx < 26) cx++;
    else if (cy > 28) cy--;
    else cy++;
    if (!PASS(get(cx, cy))) set(cx, cy, '.');
  }
}

const ENTITY = new Set(['P', 'c', 'E', 'g', 'a', 'r', 's', 'm', 'n', 'w', 'b', 'N', 'B', 'Y']);
for (let pass = 0; pass < 10; pass++) {
  const seen = reachableFrom(24, 27);
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

// final check: entities AND the four wave entry bands must connect to spawn
{
  const seen = reachableFrom(24, 27);
  const unreachable = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (ENTITY.has(get(x, y)) && !seen[y][x]) unreachable.push([get(x, y), x, y]);
  if (unreachable.length) {
    console.error('UNREACHABLE entities remain:', unreachable);
    process.exit(1);
  }
  for (const [bx, by, label] of [[26, 1, 'n'], [26, H - 2, 's'], [1, 28, 'w'], [W - 2, 28, 'e']]) {
    if (!seen[by][bx]) { console.error(`wave band '${label}' disconnected from camp`); process.exit(1); }
  }
}

// --- paint biome floors (after carving so carved lanes get painted) ---
for (let y = 1; y < H - 1; y++) {
  for (let x = 1; x < W - 1; x++) {
    if (get(x, y) !== '.') continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => get(x + dx, y + dy) === '~')) { set(x, y, ':'); continue; } // pond mud
    if (x > CX1 && x < BX0 && y >= 26 && y <= 29) { set(x, y, '_'); continue; } // the scorched Anchor road
    if (x === 25 || x === 26 || ((y === 27 || y === 28) && x < CX0)) continue;  // sortie roads stay bare ground
    if (campDist(x, y) > 14) { set(x, y, ','); continue; }                      // outer night forest floor
    // near meadow keeps '.'
  }
}

const counts = {};
for (const row of grid) for (const c of row) counts[c] = (counts[c] || 0) + 1;
console.log(grid.map(r => r.join('')).join('\n'));
console.log(`${W}x${H} map (${W * H} tiles)`);
console.log('tile counts:', Object.fromEntries(Object.entries(counts).sort()));
console.log('captives (scan order):', captiveChars.join(', '));
console.log('npcs (scan order):', npcs.map(n => n.id).join(', '));
console.log('builds (scan order):', builds.map(b => `${b.kind}:${b.cost}`).join(', '));
const bill = builds.filter(b => b.kind === 'pylon').reduce((n, b) => n + b.cost, 0);
console.log(`economy: pylon bill ${bill} vs crystals ${crystalPlan.length * 4} + gifts ${npcs.reduce((n, p) => n + ((p.gift && p.gift.shards) || 0), 0)}`);

const def = {
  name: 'Cluster Siege',
  story: true,
  chapter: 5,
  title: 'Chapter V — Cluster Siege',
  objective: 'Hold the cluster camp through the nightwaves — sortie out to raise all three pylons and wake the Anchor in the east bastion',
  time: 720,
  expedition: true,
  intro: [
    {
      title: 'The Long Night',
      lines: [
        'The cluster camp douses its lights. The Entropy masses in the trees.',
        'Three relay pylons stand cold in the dark — north, west, south.',
        'Hold the walls. Sortie between waves. Keep the signal alive.',
      ],
      art: 'siege',
    },
  ],
  modifiers: {
    dark: true,
    waves: [
      { at: 120, letters: 'ggggww', edge: 'n' },
      { at: 280, letters: 'rrggww', edge: 'w' },
      { at: 440, letters: 'ssggwww', edge: 's' },
      { at: 580, letters: 'rrssggg', edge: 'e' },
    ],
  },
  outro: [
    {
      title: 'Dawn Over the Camp',
      lines: [
        'The last nightwave breaks against the walls and does not come again.',
        'Three relays burn steady. The warden finally sits down.',
        'One road left: east, to the Settlement.',
      ],
      art: 'dawn',
    },
  ],
  captiveChars,
  npcs,
  builds,
  gate: { need: 3, after: 600 }, // the Anchor charges through the night — hold until the last wave breaks
  tiles: grid.map(r => r.join('')),
};
const out = path.join(__dirname, '../levels/level15.json');
fs.writeFileSync(out, JSON.stringify(def, null, 2) + '\n');
console.log('wrote', out);
