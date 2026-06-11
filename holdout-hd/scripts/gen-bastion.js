// Generates levels/level20-bastion.json — "The Last Bastion" (mode: bastion).
// Deterministic (fixed seed): re-running always produces the same map.
// An 84x64 SIEGE SURVIVAL map: a walled bastion sits at the center of the
// frontier with the base core 'K' at its heart, watchtowers on the corners,
// barricade frames in every wall gap, a shop, hire posts and farm plots.
// Four cardinal approach lanes cross four distinct biomes — night waves pour
// down them at every dusk for five nights (blood moons on 3 and 5). A lake in
// the northeast hides an island treasure run reachable ONLY by skiff.
// No gate, no exit: the bastion wins at the fifth dawn or dies with its core.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = 84, H = 64;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260620);

const grid = Array.from({ length: H }, () => Array(W).fill('.'));
const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const get = (x, y) => (inBounds(x, y) ? grid[y][x] : '#');
const set = (x, y, c) => { if (inBounds(x, y)) grid[y][x] = c; };
const fail = msg => { console.error('GEN FAIL:', msg); process.exit(1); };

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

// --- four biomes, one per quadrant ---
// scattered frontier rock everywhere first
for (let i = 0; i < 26; i++) blob(4 + rnd() * 76, 3 + rnd() * 58, 1.4 + rnd() * 2.4, '#');
// NW: dense pine forest
for (let i = 0; i < 14; i++) blob(3 + rnd() * 27, 3 + rnd() * 20, 1.6 + rnd() * 2.6, 'T');
// SE: cracked badlands rock
for (let i = 0; i < 10; i++) blob(55 + rnd() * 26, 42 + rnd() * 19, 1.5 + rnd() * 2.5, '#');
// SW: marsh ponds
blob(10, 46, 2.4, '~', 0.85);
blob(22, 56, 2.2, '~', 0.85);
blob(7, 58, 2.0, '~', 0.85);
blob(17, 50, 1.8, '~', 0.85);

// --- NE: the lake and its island (skiff-only treasure run) ---
const LCX = 66, LCY = 12, LRX = 8.5, LRY = 7.5, ISLE_R = 2.4;
const inLake = (x, y) => ((x - LCX) / LRX) ** 2 + ((y - LCY) / LRY) ** 2 <= 1;
const inIsle = (x, y) => Math.hypot(x - LCX, y - LCY) <= ISLE_R;
for (let y = 1; y < H - 1; y++)
  for (let x = 1; x < W - 1; x++)
    if (inLake(x, y)) set(x, y, inIsle(x, y) ? '.' : '~');

// --- the bastion (x 32..52, y 24..40): walls, stone floor, six wall gaps ---
const BX0 = 32, BX1 = 52, BY0 = 24, BY1 = 40;
// clear a 2-tile apron outside the walls so the killing ground stays open
for (let y = BY0 - 2; y <= BY1 + 2; y++)
  for (let x = BX0 - 2; x <= BX1 + 2; x++)
    if (inBounds(x, y) && x > 0 && y > 0 && x < W - 1 && y < H - 1) set(x, y, '.');
for (let y = BY0; y <= BY1; y++)
  for (let x = BX0; x <= BX1; x++)
    set(x, y, x === BX0 || x === BX1 || y === BY0 || y === BY1 ? '#' : ';');
// gates: N double, S double, W single, E single — every gap takes a barricade
const gateTiles = [[41, BY0], [42, BY0], [BX0, 32], [BX1, 32], [41, BY1], [42, BY1]];
for (const [gx, gy] of gateTiles) set(gx, gy, ';');

// --- four cardinal approach lanes, gate to map edge ---
for (let y = 1; y < BY0; y++) { set(41, y, '.'); set(42, y, '.'); }            // north: forest edge
for (let y = BY1 + 1; y <= H - 2; y++) { set(41, y, '.'); set(42, y, '.'); }   // south: ash flats
for (let x = 1; x < BX0; x++) { set(x, 31, '.'); set(x, 32, '.'); }            // west: marsh causeway
for (let x = BX1 + 1; x <= W - 2; x++) { set(x, 31, '.'); set(x, 32, '.'); }   // east: lakeside meadow

// --- wave entry bands: the 1-deep ring inside the border stays passable so
// every cardinal edge offers deterministic night-wave entry points ---
for (let x = 1; x < W - 1; x++) { if (get(x, 1) !== '.') set(x, 1, '.'); if (get(x, H - 2) !== '.') set(x, H - 2, '.'); }
for (let y = 1; y < H - 1; y++) { if (get(1, y) !== '.') set(1, y, '.'); if (get(W - 2, y) !== '.') set(W - 2, y, '.'); }

// --- sandbag cover flanking the gates (outside the walls, off the lanes) ---
for (const [ox, oy] of [[39, 22], [44, 22], [39, 42], [44, 42], [30, 30], [30, 34], [54, 30], [54, 34]])
  if (get(ox, oy) === '.') set(ox, oy, 'o');

// --- bastion interior fittings ---
// squad wakes around the core
const spawnSpots = [[40, 30], [44, 30], [40, 34], [44, 34]];
for (const [px, py] of spawnSpots) set(px, py, 'P');
set(42, 32, 'K'); // the core: lose it, lose the mission
// watchtowers on the four inner corners
const towerSpots = [[34, 26], [50, 26], [34, 38], [50, 38]];
for (const [tx, ty] of towerSpots) {
  if (get(tx, ty) !== ';') fail(`tower spot occupied ${tx},${ty} ${get(tx, ty)}`);
  set(tx, ty, 'W');
}
// shop stall by the north wall, campfires on the parade ground
set(46, 28, 'S');
set(42, 29, '*'); set(42, 35, '*');
// hire posts along the west interior (def.hires binds row-major: y order):
// the 3 job posts plus 2 combat hands (hound/archer) bracketing the row
const hirePlan = [
  { x: 35, y: 29, job: 'hound', cost: 10, name: 'Fang Berro' },
  { x: 35, y: 31, job: 'farmer', cost: 8, name: 'Sage Imbra' },
  { x: 35, y: 33, job: 'engineer', cost: 10, name: 'Wrench Odal' },
  { x: 35, y: 35, job: 'smith', cost: 12, name: 'Forgemaster Hesk' },
  { x: 35, y: 37, job: 'archer', cost: 12, name: 'Fletch Roan' },
];
for (const h of hirePlan) {
  if (get(h.x, h.y) !== ';') fail(`hire spot occupied ${h.x},${h.y}`);
  set(h.x, h.y, 'H');
}
hirePlan.sort((a, b) => a.y - b.y || a.x - b.x); // def.hires binds row-major
// two stags stabled east of the core (the skiff joins the plan at the lake)
const vehiclePlan = [
  { x: 45, y: 31, kind: 'stag' },
  { x: 45, y: 33, kind: 'stag' },
];
for (const v of vehiclePlan) {
  if (get(v.x, v.y) !== ';') fail(`stag spot occupied ${v.x},${v.y}`);
  set(v.x, v.y, 'V');
}

// --- build sites (def.builds binds row-major): 6 gap barricades, 4 turrets
// inside (38,31 pairs within 4 tiles of 38,28 so prism chaining is on the
// table; 50,32 covers the far east gate), 4 farm plots in the southeast yard ---
const buildPlan = [
  ...gateTiles.map(([x, y]) => ({ kind: 'barricade', cost: 4, x, y })),
  { kind: 'turret', cost: 10, x: 38, y: 28 },
  { kind: 'turret', cost: 10, x: 38, y: 31 },
  { kind: 'turret', cost: 10, x: 38, y: 36 },
  { kind: 'turret', cost: 10, x: 50, y: 32 },
  { kind: 'farm', cost: 6, x: 44, y: 35 },
  { kind: 'farm', cost: 6, x: 46, y: 35 },
  { kind: 'farm', cost: 6, x: 44, y: 37 },
  { kind: 'farm', cost: 6, x: 46, y: 37 },
];
for (const b of buildPlan) {
  if (get(b.x, b.y) !== ';' && get(b.x, b.y) !== '.') fail(`build spot occupied ${b.kind} ${b.x},${b.y} ${get(b.x, b.y)}`);
  set(b.x, b.y, 'B');
}
buildPlan.sort((a, b) => a.y - b.y || a.x - b.x);
const builds = buildPlan.map(b => ({ kind: b.kind, cost: b.cost }));

// --- walk reachability from the first spawn (entity letters never block) ---
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
const R = reachableFrom(40, 30);

// --- the skiff: moored on the lake's southwest shore, walk-reachable, with
// water at its gunwale so it can shove off toward the island ---
function findDock(fx, fy) {
  for (let r = 0; r < 14; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = fx + dx, y = fy + dy;
        if (!inBounds(x, y) || get(x, y) !== '.' || !R[y][x]) continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => get(x + ox, y + oy) === '~' && inLake(x + ox, y + oy)))
          return [x, y];
      }
  return null;
}
const dock = findDock(56, 17);
if (!dock) fail('no walk-reachable skiff dock on the lake shore');
set(dock[0], dock[1], 'V');
vehiclePlan.push({ x: dock[0], y: dock[1], kind: 'skiff' });
vehiclePlan.sort((a, b) => a.y - b.y || a.x - b.x);
const vehicles = vehiclePlan.map(v => ({ kind: v.kind }));

// --- chests: 10 scattered across the biomes + 3 rich ones on the island ---
// nudge: spiral to the nearest plain walk-reachable floor tile
function nudge(fx, fy, extra = () => true) {
  for (let r = 0; r < 16; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = fx + dx, y = fy + dy;
        if (inBounds(x, y) && x > 0 && y > 0 && x < W - 1 && y < H - 1
          && get(x, y) === '.' && R[y][x] && extra(x, y)) return [x, y];
      }
  return null;
}
const chestPlan = [];
function placeChest(fx, fy, loot, amount) {
  const spot = nudge(fx, fy);
  if (!spot) fail(`no chest spot near ${fx},${fy}`);
  set(spot[0], spot[1], 'C');
  chestPlan.push({ x: spot[0], y: spot[1], loot, amount, isle: false });
}
placeChest(8, 7, 'shards', 8);     // deep NW forest
placeChest(22, 5, 'cracker', 2);   // north treeline
placeChest(52, 4, 'medkit', 1);    // north lane mouth
placeChest(79, 7, 'token', 1);     // behind the lake — a daring run
placeChest(5, 30, 'shield', 1);    // west causeway end
placeChest(8, 52, 'shards', 7);    // marsh hollow
placeChest(26, 57, 'medkit', 1);   // south marsh edge
placeChest(57, 57, 'cracker', 2);  // badlands gully
placeChest(78, 52, 'shards', 9);   // far badlands
placeChest(76, 33, 'shield', 1);   // east meadow end
placeChest(28, 14, 'controller', 1); // forest fringe — turn one of theirs
placeChest(60, 41, 'toxin', 1);    // badlands rim — area denial in a box
// the island hoard: rich, skiff-only
for (const [ix, iy, loot, amount] of [[65, 11, 'token', 1], [67, 11, 'shards', 12], [66, 13, 'shield', 1]]) {
  if (get(ix, iy) !== '.' || !inIsle(ix, iy)) fail(`island chest spot bad ${ix},${iy} ${get(ix, iy)}`);
  if (R[iy][ix]) fail(`island chest ${ix},${iy} is walk-reachable — the lake leaks`);
  set(ix, iy, 'C');
  chestPlan.push({ x: ix, y: iy, loot, amount, isle: true });
}
chestPlan.sort((a, b) => a.y - b.y || a.x - b.x);
const chests = chestPlan.map(c => ({ loot: c.loot, amount: c.amount }));

// --- LYTH crystals (12): strung along the four lanes and biome corners ---
const crystalSpots = [
  [41, 16], [43, 10],            // north lane
  [41, 48], [43, 55],            // south lane
  [12, 31], [20, 33],            // west causeway
  [60, 31], [70, 33], [78, 31],  // east meadow
  [15, 15],                      // forest clearing
  [60, 50], [70, 45],            // badlands
];
let crystalCount = 0;
for (const [cx, cy] of crystalSpots) {
  const spot = nudge(cx, cy);
  if (!spot) fail(`no crystal spot near ${cx},${cy}`);
  set(spot[0], spot[1], 'Y');
  crystalCount++;
}

// --- daytime patrols (28): leashed wanderers, all >= 12 tiles off the walls
// so the bastion's apron stays quiet until the first dusk ---
const wallDist = (x, y) => Math.max(
  Math.max(BX0 - x, x - BX1, 0),
  Math.max(BY0 - y, y - BY1, 0));
const farOut = (x, y) => wallDist(x, y) >= 12;
const enemyPlan = [
  // NW forest prowl: grunts, skitters, an archer in the trees
  ['g', 10, 10], ['g', 18, 14], ['g', 26, 8], ['g', 14, 20],
  ['w', 20, 10], ['w', 12, 16], ['a', 24, 12],
  // NE lakeshore: grunts on the meadow, a sniper watching the east shore
  ['g', 56, 6], ['g', 70, 22], ['a', 60, 3], ['a', 76, 16], ['n', 79, 12],
  // SW marsh: chargers in the reeds
  ['g', 10, 44], ['g', 16, 56], ['r', 8, 38], ['r', 20, 53],
  ['w', 14, 50], ['w', 24, 60], ['a', 6, 57],
  // SE badlands: the heavy country — bulwarks and a sniper
  ['g', 66, 46], ['g', 76, 58], ['r', 58, 54], ['r', 70, 52],
  ['s', 66, 55], ['s', 74, 44], ['a', 78, 46], ['a', 58, 52], ['n', 80, 57],
];
let enemyCount = 0;
for (const [letter, ex, ey] of enemyPlan) {
  const spot = nudge(ex, ey, farOut);
  if (!spot) fail(`no enemy spot near ${ex},${ey}`);
  set(spot[0], spot[1], letter);
  enemyCount++;
}

// ===== self-checks ==========================================================
{
  const seen = reachableFrom(40, 30);
  // every walk entity must be reachable from spawn; island chests must NOT
  const walkSpots = [
    ...spawnSpots.map(s => ['spawn', ...s]),
    ['core', 42, 32],
    ...towerSpots.map(s => ['tower', ...s]),
    ['shop', 46, 28],
    ...hirePlan.map(h => [h.job, h.x, h.y]),
    ...vehiclePlan.map(v => [v.kind, v.x, v.y]),
    ...buildPlan.map(b => [b.kind, b.x, b.y]),
    ...chestPlan.filter(c => !c.isle).map(c => ['chest', c.x, c.y]),
  ];
  for (const [what, x, y] of walkSpots)
    if (!seen[y][x]) fail(`${what} at ${x},${y} unreachable from spawn`);
  for (const c of chestPlan.filter(c => c.isle))
    if (seen[c.y][c.x]) fail(`island chest ${c.x},${c.y} reachable afoot — must be skiff-only`);
  // the skiff must sail dock -> island: flood '~' + shore land from the dock
  const sea = Array.from({ length: H }, () => Array(W).fill(false));
  const sq = [dock];
  sea[dock[1]][dock[0]] = true;
  while (sq.length) {
    const [x, y] = sq.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (inBounds(nx, ny) && !sea[ny][nx] && (get(nx, ny) === '~' || PASS(get(nx, ny)))) {
        sea[ny][nx] = true;
        sq.push([nx, ny]);
      }
    }
  }
  for (const c of chestPlan.filter(c => c.isle))
    if (!sea[c.y][c.x]) fail(`island chest ${c.x},${c.y} not reachable by skiff`);
  // all four wave edge bands: every depth<2 entry candidate connects to base
  for (const edge of ['n', 's', 'w', 'e']) {
    const len = edge === 'n' || edge === 's' ? W : H;
    let cands = 0;
    for (let i = 0; i < len; i++) {
      for (let depth = 0; depth < 2; depth++) {
        const [tx, ty] =
          edge === 'n' ? [i, depth] :
          edge === 's' ? [i, H - 1 - depth] :
          edge === 'w' ? [depth, i] : [W - 1 - depth, i];
        if (PASS(get(tx, ty))) {
          if (!seen[ty][tx]) fail(`wave band '${edge}' candidate ${tx},${ty} disconnected from the bastion`);
          cands++;
          break;
        }
      }
    }
    if (!cands) fail(`wave band '${edge}' has no entry candidates`);
  }
  // patrols keep their distance from the walls
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if ('garswn'.includes(get(x, y)) && get(x, y) !== '.' && !farOut(x, y))
        fail(`patrol at ${x},${y} inside the 12-tile quiet zone (dist ${wallDist(x, y)})`);
  // counts
  const counts = {};
  for (const row of grid) for (const c of row) counts[c] = (counts[c] || 0) + 1;
  const expect = { P: 4, K: 1, W: 4, S: 1, H: 5, V: 3, C: 15, Y: 12, B: 14 };
  for (const [ch, n] of Object.entries(expect))
    if ((counts[ch] || 0) !== n) fail(`tile '${ch}' count ${counts[ch] || 0} != ${n}`);
  if (enemyCount !== 28) fail(`enemy count ${enemyCount} != 28`);
  if (crystalCount !== 12) fail(`crystal count ${crystalCount} != 12`);
}

// --- paint biome floors LAST (every floor letter is passable, so the
// connectivity proofs above survive untouched) ---
const onLane = (x, y) =>
  ((x === 41 || x === 42) && (y < BY0 || y > BY1)) ||
  ((y === 31 || y === 32) && (x < BX0 || x > BX1));
for (let y = 1; y < H - 1; y++) {
  for (let x = 1; x < W - 1; x++) {
    if (get(x, y) !== '.') continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => get(x + dx, y + dy) === '~')) { set(x, y, ':'); continue; } // wet shore
    if (onLane(x, y)) continue;                                            // lanes stay bare road
    if (inIsle(x, y)) { set(x, y, ','); continue; }                        // island grass
    if (x < BX0 && y < BY0 && rnd() < 0.8) { set(x, y, ','); continue; }   // NW needle floor
    if (x < BX0 && y > BY1 && rnd() < 0.7) { set(x, y, ':'); continue; }   // SW marsh muck
    if (x > BX1 && y > BY1 && rnd() < 0.75) { set(x, y, '_'); continue; }  // SE ash flats
    // NE meadow and the bastion apron keep '.'
  }
}

// ===== report ===============================================================
const counts = {};
for (const row of grid) for (const c of row) counts[c] = (counts[c] || 0) + 1;
console.log(grid.map(r => r.join('')).join('\n'));
console.log(`${W}x${H} map (${W * H} tiles)`);
console.log('tile counts:', Object.fromEntries(Object.entries(counts).sort()));
console.log('builds (scan order):', builds.map(b => `${b.kind}:${b.cost}`).join(', '));
console.log('vehicles (scan order):', vehicles.map(v => v.kind).join(', '), `— skiff dock at ${dock[0]},${dock[1]}`);
console.log('hires (scan order):', hirePlan.map(h => `${h.name}/${h.job}:${h.cost}`).join(', '));
console.log('chests (scan order):', chestPlan.map(c => `${c.loot}${c.loot === 'shards' ? c.amount : ''}${c.isle ? '*' : ''}`).join(', '), '(* island)');
console.log(`patrols: ${enemyCount} | crystals: ${crystalCount} | shard chests pay ${chestPlan.filter(c => c.loot === 'shards').reduce((n, c) => n + c.amount, 0)} + crystals ${crystalCount * 4}`);

const def = {
  name: 'The Last Bastion',
  objective: 'Hold the bastion through five nights — the core must still stand at the fifth dawn',
  time: 600,
  expedition: true,
  mode: 'bastion',
  bastion: { nights: 5, dayLen: 90, nightLen: 75, bloodMoons: [3, 5] },
  intro: [
    {
      title: 'The Last Bastion',
      lines: [
        'One bastion still answers on the frontier band: five nights from relief.',
        'Every dusk the Entropy marches a lane. Two moons will rise blood.',
        'Wall the gaps. Crew the towers. The core must not fall.',
      ],
      art: 'siege',
    },
  ],
  outro: [
    {
      title: 'The Fifth Dawn',
      lines: [
        'The fifth dawn breaks over chewed walls and a core still humming.',
        'Relief columns crest the lanes the waves came down.',
        'The frontier holds — because this one did.',
      ],
      art: 'dawn',
    },
  ],
  captiveChars: [],
  builds,
  chests,
  vehicles,
  hires: hirePlan.map(h => ({ job: h.job, cost: h.cost, name: h.name })),
  tiles: grid.map(r => r.join('')),
};
const out = path.join(__dirname, '../levels/level20-bastion.json');
fs.writeFileSync(out, JSON.stringify(def, null, 2) + '\n');
console.log('wrote', out);
