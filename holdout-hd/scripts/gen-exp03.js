// Generates levels/level13.json — "Chapter III — Broken Quorum".
// Deterministic (fixed seed 20260613): re-running always produces the same map.
// A 96x56 west-to-east march across the relay field that failed at six-of-ten:
// scorched ash littered with dead relay stumps in graveyard rows, a long
// shattered ridge with firing gaps mid-map, stone service roads, sparse burnt
// trees. Phantom snipers nest behind the ridge; the final pylon plaza in the
// east is held by an Entropy boss. Raise four pylons — restore the quorum.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = 96, H = 56;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260613);

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

// --- dead relay stumps: a pylon graveyard in regular-ish grid rows ---
// Each stump is a short '#' cluster: a lone post, a 2x2 footing, or a cross.
function stump(x, y) {
  const r = rnd();
  set(x, y, '#');
  if (r < 0.35) return;                       // a lone snapped post
  if (r < 0.7) { set(x + 1, y, '#'); set(x, y + 1, '#'); set(x + 1, y + 1, '#'); return; } // footing
  set(x + 1, y, '#'); set(x - 1, y, '#'); set(x, y + 1, '#'); set(x, y - 1, '#'); // fallen cross
}
function stumpField(x0, x1, y0, y1, stepX, stepY) {
  for (let gy = y0; gy <= y1; gy += stepY) {
    for (let gx = x0; gx <= x1; gx += stepX) {
      const jx = gx + Math.floor(rnd() * 3) - 1;
      const jy = gy + Math.floor(rnd() * 3) - 1;
      if (jy >= 24 && jy <= 31) continue;     // keep the main road band clear
      if (jx >= 82 && jy >= 20 && jy <= 36) continue; // keep the plaza clear
      stump(jx, jy);
    }
  }
}
stumpField(12, 40, 6, 50, 7, 8);   // western field (the six that answered)
stumpField(56, 80, 6, 50, 7, 8);   // eastern field (the four that died)

// --- long shattered ridge mid-map (x≈47, full height) with firing gaps ---
const gapYs = [9, 21, 33, 45];
for (let y = 1; y < H - 1; y++) {
  if (gapYs.some(g => Math.abs(y - g) <= 1)) continue;  // walkable breaches
  if (rnd() < 0.1) continue;                            // shattered firing slits
  const xr = 47 + Math.round(Math.sin(y * 0.23) * 2);
  set(xr, y, '#');
  if (rnd() < 0.6) set(xr + 1, y, '#');
}

// --- sparse burnt trees ---
for (let i = 0; i < 14; i++) {
  const tx = Math.floor(8 + rnd() * 82);
  const ty = Math.floor(3 + rnd() * 50);
  if (ty >= 24 && ty <= 31) continue;
  if (tx >= 82 && ty >= 20 && ty <= 36) continue;
  if (isOpen(tx, ty)) set(tx, ty, 'T');
}

// --- stone service roads (carved now, painted ';' at the end) ---
const roadSet = new Set();
function road(x, y) {
  if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return;
  set(x, y, '.');
  roadSet.add(x + ',' + y);
}
// main service road, west gate to the plaza
for (let x = 2; x <= 93; x++) {
  const y0 = 27 + Math.round(Math.sin(x * 0.13) * 1.2);
  road(x, y0); road(x, y0 + 1);
}
// north branch toward the relay keeper's dead sector
for (let y = 8; y <= 27; y++) { road(30, y); road(31, y); }
// south branch toward the drowned crystals
for (let y = 28; y <= 48; y++) { road(64, y); road(65, y); }

// --- final pylon plaza (x 82..93, y 21..35) ---
for (let y = 21; y <= 35; y++)
  for (let x = 82; x <= 93; x++)
    if (get(x, y) !== '.') set(x, y, '.');
// sandbag scars on the plaza approach
for (const [sx, sy] of [[81, 24], [81, 31], [85, 21], [85, 35]]) set(sx, sy, 'o');
// exit gate, east edge
for (const [ex, ey] of [[93, 27], [93, 28], [94, 27], [94, 28]]) set(ex, ey, 'E');

// --- player spawns, west edge ---
for (let y = 24; y <= 31; y++) for (let x = 2; x <= 8; x++) if (get(x, y) !== '.') set(x, y, '.');
for (const [px, py] of [[3, 26], [3, 29], [5, 26], [5, 29]]) set(px, py, 'P');

// --- enemies ---
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

// western ash: grunts wandering the graveyard rows
for (let i = 0; i < 8; i++) place('g', 12 + rnd() * 28, 5 + rnd() * 46);
// chargers prowl the open ash on both sides of the ridge
for (let i = 0; i < 5; i++) place('r', 14 + rnd() * 28, 6 + rnd() * 44);
for (let i = 0; i < 4; i++) place('r', 56 + rnd() * 24, 6 + rnd() * 44);
// archers entrenched among the stumps
for (let i = 0; i < 5; i++) place('a', 13 + rnd() * 27, 5 + rnd() * 46);
for (let i = 0; i < 5; i++) place('a', 56 + rnd() * 22, 5 + rnd() * 46);
// the Phantoms: 8 snipers — four covering the ridge breaches from behind,
// four nested deep in the eastern stump rows
for (const gy of gapYs) place('n', 51, gy);
place('n', 62, 12); place('n', 68, 40); place('n', 76, 19); place('n', 79, 34);
// one Entropy spawner festering in the south-east field
place('m', 69, 45);
// the boss holds the final pylon plaza
place('b', 89, 31);

// --- captives at landmarks (ids bound in row-major scan order) ---
const captivePlan = [
  ['shade', 54, 6],   // slipped behind the ridge, hiding in the north stumps
  ['warden', 84, 23], // chained at the edge of the boss plaza
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

// Two camps: the keeper who lost the field, and a scavenger selling hope.
const campPlan = [
  {
    x: 20, y: 25,
    npc: {
      id: 'keeper-vasht',
      name: 'Keeper Vasht',
      lines: [
        'Six of ten... six of ten. The field answered six and the quorum wanted seven.',
        'I logged the fault at dusk. By dawn the Entropy had eaten four pylons whole.',
        'I kept the count. I always keep the count. Counting is all the keeping I have left.',
        'The Phantoms nest behind the ridge — they see farther than you do. Break their line with a barricade or feed it.',
        'Four fresh pylons, operator. All four. This Anchor takes no fractions.',
        'Take my shards. They were for repairs that never... just take them.',
      ],
      gift: { shards: 8 },
    },
  },
  {
    x: 56, y: 30,
    npc: {
      id: 'junie-marrow',
      name: "Junie 'Hope' Marrow",
      lines: [
        'Hope! Genuine bottled hope, friend — three shards a measure and worth every one.',
        'Sold out of medicine two seasons back. Hope keeps better. Never expires, rarely works.',
        'Free sample: crystal nodes along the road crack open at four shards apiece. Shoot them.',
        "The chargers in the open ash don't want hope. They want you. Keep a sandbag between you.",
        "When the gate lights, I ride through first. That's not hope, friend — that's a plan.",
      ],
    },
  },
];
const placedNpcs = [];
for (const camp of campPlan) {
  const at = forceSet(camp.x, camp.y, 'N');
  if (!at) { console.error('failed to place npc', camp.npc.id); process.exit(1); }
  placedNpcs.push({ x: at[0], y: at[1], npc: camp.npc });
  forceSet(at[0] + 1, at[1], '*');
}
placedNpcs.sort((a, b) => a.y - b.y || a.x - b.x);
const npcs = placedNpcs.map(p => p.npc);

// 4 pylons (the quorum needs four-of-four) + 2 barricades + 2 turrets
const buildPlan = [
  { kind: 'pylon', cost: 12, x: 14, y: 26 },     // first relay, on the road
  { kind: 'pylon', cost: 12, x: 38, y: 30 },     // before the ridge
  { kind: 'pylon', cost: 12, x: 60, y: 26 },     // behind the ridge
  { kind: 'pylon', cost: 12, x: 87, y: 28 },     // the boss plaza — the fourth vote
  { kind: 'barricade', cost: 4, x: 44, y: 21 },  // cover at the north breach
  { kind: 'barricade', cost: 4, x: 44, y: 33 },  // cover at the south breach
  { kind: 'turret', cost: 10, x: 52, y: 34 },    // sweep behind the ridge
  { kind: 'turret', cost: 10, x: 84, y: 27 },    // plaza approach (in range of the plaza pylon fight)
];
const placedBuilds = [];
for (const b of buildPlan) {
  const at = forceSet(b.x, b.y, 'B');
  if (!at) { console.error('failed to place build site', b.kind); process.exit(1); }
  placedBuilds.push({ x: at[0], y: at[1], kind: b.kind, cost: b.cost });
}
placedBuilds.sort((a, b) => a.y - b.y || a.x - b.x);
const builds = placedBuilds.map(b => ({ kind: b.kind, cost: b.cost }));

// 12 LYTH crystal nodes, generous along the critical path
const crystalPlan = [
  [9, 28], [16, 22], [24, 30], [31, 12], [34, 26], [42, 34],
  [50, 21], [57, 32], [65, 46], [70, 26], [78, 30], [86, 22],
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
  let cx = x, cy = y;
  let guard = 0;
  while (!seen[cy][cx] && guard++ < 300) {
    if (cx > 3) cx--;
    else if (cy > 26) cy--;
    else cy++;
    if (!PASS(get(cx, cy))) set(cx, cy, '.');
  }
}

const ENTITY = new Set(['P', 'c', 'E', 'g', 'a', 'r', 's', 'm', 'n', 'w', 'b', 'N', 'B', 'Y']);
for (let pass = 0; pass < 10; pass++) {
  const seen = reachableFrom(3, 26);
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
  const seen = reachableFrom(3, 26);
  const unreachable = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (ENTITY.has(get(x, y)) && !seen[y][x]) unreachable.push([get(x, y), x, y]);
  if (unreachable.length) {
    console.error('UNREACHABLE entities remain:', unreachable);
    process.exit(1);
  }
}

// --- paint floors: scorched ash dominant, stone service roads, plaza stone ---
for (let y = 1; y < H - 1; y++) {
  for (let x = 1; x < W - 1; x++) {
    if (get(x, y) !== '.') continue;
    if (x >= 82 && y >= 21 && y <= 35) { set(x, y, ';'); continue; } // pylon plaza: worked stone
    if (roadSet.has(x + ',' + y)) { set(x, y, ';'); continue; }      // service roads
    set(x, y, '_');                                                  // scorched ash
  }
}
// a few cinder drifts for texture
for (const [cx, cy] of [[12, 42], [27, 9], [36, 44], [58, 13], [74, 40]]) {
  for (let y = cy - 2; y <= cy + 2; y++)
    for (let x = cx - 3; x <= cx + 3; x++)
      if (get(x, y) === '_' && Math.hypot(x - cx, y - cy) <= 2.6 && rnd() < 0.8) set(x, y, ':');
}

const counts = {};
for (const row of grid) for (const c of row) counts[c] = (counts[c] || 0) + 1;
console.log(`${W}x${H} map (${W * H} tiles)`);
console.log('tile counts:', Object.fromEntries(Object.entries(counts).sort()));
console.log('captives (scan order):', captiveChars.join(', '));
console.log('npcs (scan order):', npcs.map(n => n.id).join(', '));
console.log('builds (scan order):', builds.map(b => `${b.kind}:${b.cost}`).join(', '));
const pylonBill = builds.filter(b => b.kind === 'pylon').reduce((n, b) => n + b.cost, 0);
console.log(`economy: pylon bill ${pylonBill} vs crystals ${counts.Y * 4} + gifts ${npcs.reduce((n, p) => n + ((p.gift && p.gift.shards) || 0), 0)}`);
console.log(grid.map(r => r.join('')).join('\n'));

const def = {
  name: 'Broken Quorum',
  objective: 'Cross the dead relay field and raise four pylons — make the count true again',
  time: 720,
  story: true,
  chapter: 3,
  title: 'Chapter III — Broken Quorum',
  expedition: true,
  intro: [
    {
      title: 'Chapter III — Broken Quorum',
      lines: [
        'The relay field answered six of ten. Six is not a quorum.',
        'Ash where the pylons stood. Phantoms where the keepers slept.',
        'Raise four. Make the count true again.',
      ],
      art: 'quorum',
    },
  ],
  outro: [
    {
      title: 'Four of Four',
      lines: [
        'The quorum holds. The relay field hums for the first time since the Fall.',
        'Keeper Vasht counts to ten now. All the way to ten. And smiles.',
      ],
      art: 'quorum',
    },
  ],
  captiveChars,
  npcs,
  builds,
  gate: { need: 4 },
  tiles: grid.map(r => r.join('')),
};
const out = path.join(__dirname, '../levels/level13.json');
fs.writeFileSync(out, JSON.stringify(def, null, 2) + '\n');
console.log('wrote', out);
