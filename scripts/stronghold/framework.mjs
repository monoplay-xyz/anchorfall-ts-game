// scripts/stronghold/framework.mjs — shared STRONGHOLD level-gen framework
// (frontier IV). Every gen-shNN.js imports this; it owns the rules all 25
// levels must agree on:
//   - deterministic rng (mulberry32, seeds 202607NN)
//   - the difficulty arc (hpMult 1.0->1.8, waveMult 1.0->2.6 across sh01..25)
//   - organic outlines + themed border bands (square wall-boxes are BANNED)
//   - the fortified-walls base kit: PREBUILT wall-segment builds (never '#'),
//     gate gaps with barricade sites — bases are damageable/repairable
//   - camps/squads with group ids, patrol routes, sniper spotters
//   - 'K' core/beacon placement (beacon variant = exactly 4 K tiles)
//   - row-major scan-order binding for every def-bound entity letter
//   - a BFS validator WITH REPAIR (carves causeways when something is cut
//     off) + the wave-entry edge-band guarantee waveEntryPoints relies on
//   - def assembly + a validator mirroring test/sim.test.js's stronghold
//     checks, so `node scripts/stronghold/gen-shNN.js` fails before tests do.
//
// Sim ground truth this file mirrors (shared/game.js):
//   blocksMove: '#' 'T' '~' 'o' '%'        (plus closed doors)
//   blocksPath: blocksMove + '!'           (enemies route AROUND lava)
//   wave entry: per edge, first depth<2 tile that neither blocksMove nor is
//               lava — EVERY such candidate must connect to the core(s)
//   prebuilt non-farm builds block movement (gnawable, but the validator
//               treats them as walls so gates stay the honest way in)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, '..', '..');
export const OUT_DIR = path.join(ROOT, 'levels', 'stronghold');

// ---------------------------------------------------------------------------
// rng
// ---------------------------------------------------------------------------
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// the difficulty arc — sh01 1.0/1.0 ... sh25 1.8/2.6, linear, rounded to 2dp
// so every agent generating levels lands on the same curve.
// ---------------------------------------------------------------------------
export function difficultyArc(level) {
  const t = (level - 1) / 24;
  const r2 = v => Math.round(v * 100) / 100;
  return { hpMult: r2(1 + t * 0.8), waveMult: r2(1 + t * 1.6) };
}

// Wave/difficulty table: returns the def.bastion block, the truthful
// def.stronghold.waves count and the arc hpMult for def.stronghold. Knobs
// the sim actually reads: nights, dayLen, nightLen, bloodMoons[],
// wavesPerNight (1..3), waveMult. TRUTHFUL ACCOUNTING: the sim pours EVERY
// wave of a blood-moon night from two edges (the second a 60% detachment),
// so each moon night adds wavesPerNight extra wave events:
//   waves = nights*wavesPerNight + bloodMoons.length*wavesPerNight.
// hpMult/waveMult default to the canonical arc; pass explicit values to
// retune a level off the curve (sh25's beatability retune does).
export function waveTable({ level, nights, wavesPerNight = 1, bloodMoons = [], dayLen = 90, nightLen = 75, hpMult: hpOverride, waveMult: wmOverride }) {
  if (!Number.isInteger(nights) || nights < 1) throw new Error('waveTable: nights required');
  for (const m of bloodMoons) {
    if (!Number.isInteger(m) || m < 1 || m > nights) throw new Error(`waveTable: blood moon ${m} outside 1..${nights}`);
  }
  const arc = difficultyArc(level);
  const hpMult = hpOverride ?? arc.hpMult;
  const waveMult = wmOverride ?? arc.waveMult;
  const bastion = { nights, dayLen, nightLen, bloodMoons };
  if (wavesPerNight > 1) bastion.wavesPerNight = wavesPerNight;
  if (waveMult > 1) bastion.waveMult = waveMult;
  return { bastion, waves: nights * wavesPerNight + bloodMoons.length * wavesPerNight, hpMult };
}

// ---------------------------------------------------------------------------
// tile law (kept in sync with shared/game.js + test/sim.test.js)
// ---------------------------------------------------------------------------
export const LEGAL_TILES = new Set('#.To~,:;_*=!^%E' + 'PcNBCKVWSHDYAIQJXZO' + 'garsmnwbzfqvxu');
export const ENEMY_LETTERS = new Set('garsmnwbzfqvxu');
const STATIONARY_LETTERS = new Set('anm'); // archer/sniper/spawner never patrol
const HARD_BLOCK = new Set('#T~o%');       // blocksMove letters
const FLOORS = new Set('.,:;_=^');         // nudge targets: passable, dry, unsearing
const WEATHERS = new Set(['clear', 'rain', 'snow', 'ashstorm', 'fog']);
const AMBIENCES = new Set(['meadow', 'forest', 'swamp', 'ash', 'city', 'night', 'lava', 'ship']);
const BUILD_KINDS = new Set(['pylon', 'barricade', 'turret', 'farm', 'beacon', 'wall', 'comm']);

export const WALL_COST = 5;       // the fortified wall segment convention
export const BARRICADE_COST = 4;  // gate-gap sites, like sh01

// ---------------------------------------------------------------------------
// the map builder
// ---------------------------------------------------------------------------
export function createMap({ w, h, seed, name = 'stronghold' }) {
  const rnd = mulberry32(seed);
  const grid = Array.from({ length: h }, () => Array(w).fill('.'));
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  const get = (x, y) => (inBounds(x, y) ? grid[y][x] : '#');
  const set = (x, y, c) => { if (inBounds(x, y)) grid[y][x] = c; };
  const fail = msg => { throw new Error(`GEN FAIL [${name}]: ${msg}`); };

  // ---- def-bound plans (sorted row-major at finalize) ----
  const builds = [];   // {x,y,kind,cost,prebuilt?,level?,ttype?}
  const chests = [];   // {x,y,loot,amount,tag?}
  const hires = [];    // {x,y,job,cost,name}
  const vehicles = []; // {x,y,kind}
  const npcs = [];     // {x,y,id,name,lines,gift?}
  const pickups = [];  // {x,y,kind}
  const switches = []; // {x,y,id,group}
  const qitems = [];   // {x,y,id,kind}
  const groups = [];   // [[x,y],...] per camp
  const patrols = [];  // {at:[x,y], points:[[x,y],...]}
  const spawns = [];   // [x,y]
  const cores = [];    // [x,y] — 1 (core) or 4 (beacons)
  const repairsLog = [];

  // ---- terrain painters ----
  function blob(cx, cy, r, c, density = 0.75) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r && rnd() < density * (1 - d / (r + 1))) set(x, y, c);
      }
    }
  }

  // Solid filled disc (no speckle) — lakes, lava pools, void shards.
  function disc(cx, cy, r, c) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (Math.hypot(x - cx, y - cy) <= r) set(x, y, c);
      }
    }
  }

  // Wandering band of letter c from (x0,y0) to (x1,y1) — rivers, lava veins,
  // mountain spines. Width wd, deterministic drunk-walk wobble.
  function vein(x0, y0, x1, y1, wd, c, wobble = 0.35) {
    let x = x0, y = y0;
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2.5);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const tx = x0 + (x1 - x0) * t + (rnd() - 0.5) * 2 * wobble * 4;
      const ty = y0 + (y1 - y0) * t + (rnd() - 0.5) * 2 * wobble * 4;
      x += (tx - x) * 0.5; y += (ty - y) * 0.5;
      disc(Math.round(x), Math.round(y), wd / 2, c);
    }
  }

  // ORGANIC OUTLINE (square wall-boxes are BANNED for sh02+): a themed
  // border band whose thickness wobbles with deterministic harmonics, eating
  // into the rectangle so every level gets a distinct silhouette. Optional
  // bites[] are big border blobs taking chunks out of the playfield.
  // The outermost row/col is ALWAYS the border letter; edgeRing() then opens
  // the depth-1 ring the night waves enter on.
  function outline({ border = '#', min = 2, max = 7, harmonics = 4, bites = 0 } = {}) {
    const ph = Array.from({ length: harmonics }, () => rnd() * Math.PI * 2);
    const amp = Array.from({ length: harmonics }, (_, i) => 0.6 / (i + 1));
    const ampSum = amp.reduce((a, b) => a + b, 0);
    const cx = (w - 1) / 2, cy = (h - 1) / 2;
    const th = (x, y) => {
      const a = Math.atan2((y - cy) / h, (x - cx) / w);
      let n = 0;
      for (let i = 0; i < harmonics; i++) n += amp[i] * Math.sin((i + 1) * a + ph[i]);
      return min + (max - min) * (0.5 + 0.5 * (n / ampSum));
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const edist = Math.min(x, y, w - 1 - x, h - 1 - y);
        if (edist < th(x, y)) set(x, y, border);
      }
    }
    for (let i = 0; i < bites; i++) {
      const side = i % 4;
      const bx = side === 0 ? 4 + rnd() * (w - 8) : side === 1 ? 4 + rnd() * (w - 8) : side === 2 ? 3 : w - 4;
      const by = side === 0 ? 3 : side === 1 ? h - 4 : 4 + rnd() * (h - 8), br = 3 + rnd() * 4;
      blob(bx, by, br, border, 0.9);
    }
  }

  // The depth-1 ring stays passable so every cardinal edge offers the
  // deterministic wave entry points stepWaves needs (depth<2 scan). The
  // depth-0 frame stays the border letter. Pair with carve() lanes inward.
  function edgeRing(floor = '.', border = null) {
    for (let x = 0; x < w; x++) {
      if (border) { set(x, 0, border); set(x, h - 1, border); }
      if (x > 0 && x < w - 1) { set(x, 1, floor); set(x, h - 2, floor); }
    }
    for (let y = 0; y < h; y++) {
      if (border) { set(0, y, border); set(w - 1, y, border); }
      if (y > 0 && y < h - 1) { set(1, y, floor); set(w - 2, y, floor); }
    }
  }

  // L-shaped corridor carve (horizontal leg first): approach lanes through
  // the border band, fords, causeways. Overwrites TERRAIN only — never a
  // planned entity tile ('B','K','P',... are left alone if already placed).
  function carve(x0, y0, x1, y1, wd = 2, floor = '.') {
    const lay = (x, y) => {
      for (let oy = 0; oy < wd; oy++) {
        for (let ox = 0; ox < wd; ox++) {
          const tx = x + ox, ty = y + oy;
          if (!inBounds(tx, ty) || tx < 1 || ty < 1 || tx > w - 2 || ty > h - 2) continue;
          const c = get(tx, ty);
          if (HARD_BLOCK.has(c) || c === '!' || c === '~' || FLOORS.has(c)) set(tx, ty, floor);
        }
      }
    };
    const sx = Math.sign(x1 - x0) || 1, sy = Math.sign(y1 - y0) || 1;
    for (let x = x0; x !== x1 + sx; x += sx) lay(x, y0);
    for (let y = y0; y !== y1 + sy; y += sy) lay(x1, y);
  }

  // Spiral to the nearest plain floor tile (FLOORS set) satisfying extra().
  function nudge(fx, fy, extra = () => true, maxR = 16) {
    for (let r = 0; r < maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = fx + dx, y = fy + dy;
          if (inBounds(x, y) && x > 1 && y > 1 && x < w - 2 && y < h - 2
            && FLOORS.has(get(x, y)) && extra(x, y)) return [x, y];
        }
      }
    }
    return null;
  }

  // ---- the fortified base kit (user mandate: NO indestructible bases) ----
  // Rectangular fort: interior floored, perimeter emitted as PREBUILT WALL
  // SEGMENT builds; gate tiles become open gaps with unbuilt BARRICADE sites.
  // Returns { perimeter, gates } (tile lists) for follow-up placement.
  function fortRect({ x0, y0, x1, y1, floor = ';', apron = 2, apronFloor = '.', gates = [], wallLevel }) {
    for (let y = y0 - apron; y <= y1 + apron; y++) {
      for (let x = x0 - apron; x <= x1 + apron; x++) {
        if (inBounds(x, y) && x > 1 && y > 1 && x < w - 2 && y < h - 2) set(x, y, apronFloor);
      }
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) set(x, y, floor);
    }
    const isGate = (x, y) => gates.some(([gx, gy]) => gx === x && gy === y);
    const perimeter = [];
    for (let x = x0; x <= x1; x++) { perimeter.push([x, y0]); perimeter.push([x, y1]); }
    for (let y = y0 + 1; y < y1; y++) { perimeter.push([x0, y]); perimeter.push([x1, y]); }
    for (const [px, py] of perimeter) {
      if (isGate(px, py)) addBuild(px, py, { kind: 'barricade', cost: BARRICADE_COST });
      else addBuild(px, py, { kind: 'wall', cost: WALL_COST, prebuilt: true, ...(wallLevel > 1 ? { level: wallLevel } : {}) });
    }
    return { perimeter, gates };
  }

  // Diamond fort (|dx|+|dy| ring) — a second silhouette for base variety.
  function fortDiamond({ cx, cy, r, floor = ';', apron = 2, apronFloor = '.', gates = [], wallLevel }) {
    for (let y = cy - r - apron; y <= cy + r + apron; y++) {
      for (let x = cx - r - apron; x <= cx + r + apron; x++) {
        if (!inBounds(x, y) || x <= 1 || y <= 1 || x >= w - 2 || y >= h - 2) continue;
        const d = Math.abs(x - cx) + Math.abs(y - cy);
        if (d < r) set(x, y, floor);
        else if (d <= r + apron) set(x, y, apronFloor);
      }
    }
    const isGate = (x, y) => gates.some(([gx, gy]) => gx === x && gy === y);
    const perimeter = [];
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (Math.abs(x - cx) + Math.abs(y - cy) === r) perimeter.push([x, y]);
      }
    }
    for (const [px, py] of perimeter) {
      if (isGate(px, py)) addBuild(px, py, { kind: 'barricade', cost: BARRICADE_COST });
      else addBuild(px, py, { kind: 'wall', cost: WALL_COST, prebuilt: true, ...(wallLevel > 1 ? { level: wallLevel } : {}) });
    }
    return { perimeter, gates };
  }

  // ---- entity placement (every adder stamps the letter AND records the
  // plan; finalize() sorts plans row-major to match the parse scan) ----
  function claim(x, y, letter, what) {
    if (!inBounds(x, y)) fail(`${what} out of bounds at ${x},${y}`);
    const c = get(x, y);
    if (!FLOORS.has(c)) fail(`${what} spot occupied at ${x},${y} ('${c}')`);
    set(x, y, letter);
  }
  function addBuild(x, y, spec) {
    if (!BUILD_KINDS.has(spec.kind)) fail(`unknown build kind '${spec.kind}'`);
    claim(x, y, 'B', `build ${spec.kind}`);
    builds.push({ x, y, ...spec });
  }
  function addChest(x, y, loot, amount, opts = {}) {
    const spot = opts.exact ? [x, y] : nudge(x, y, opts.extra || (() => true));
    if (!spot) fail(`no chest spot near ${x},${y}`);
    claim(spot[0], spot[1], 'C', 'chest');
    chests.push({ x: spot[0], y: spot[1], loot, amount, tag: opts.tag || null });
    return spot;
  }
  function addHire(x, y, spec) { claim(x, y, 'H', 'hire'); hires.push({ x, y, ...spec }); }
  function addVehicle(x, y, kind) { claim(x, y, 'V', 'vehicle'); vehicles.push({ x, y, kind }); }
  function addNpc(x, y, spec) { claim(x, y, 'N', 'npc'); npcs.push({ x, y, ...spec }); }
  function addPickup(x, y, kind) { claim(x, y, 'A', 'pickup'); pickups.push({ x, y, kind }); }
  function addSwitch(x, y, spec = {}) {
    const spot = nudge(x, y);
    if (!spot) fail(`no switch spot near ${x},${y}`);
    claim(spot[0], spot[1], 'Q', 'switch');
    switches.push({ x: spot[0], y: spot[1], ...spec });
    return spot;
  }
  function addQitem(x, y, spec = {}) { claim(x, y, 'I', 'qitem'); qitems.push({ x, y, ...spec }); }
  function addSpawn(x, y) { claim(x, y, 'P', 'spawn'); spawns.push([x, y]); }
  function addCore(x, y) { claim(x, y, 'K', 'core/beacon'); cores.push([x, y]); }
  function addTower(x, y) { claim(x, y, 'W', 'tower'); }
  function addShop(x, y) { claim(x, y, 'S', 'shop'); }
  function addCrystal(x, y) {
    const spot = nudge(x, y);
    if (!spot) fail(`no crystal spot near ${x},${y}`);
    claim(spot[0], spot[1], 'Y', 'crystal');
    return spot;
  }
  function addCampfire(x, y) { claim(x, y, '*', 'campfire'); }

  function placeEnemy(letter, fx, fy, extra = () => true) {
    if (!ENEMY_LETTERS.has(letter)) fail(`unknown enemy letter '${letter}'`);
    const spot = nudge(fx, fy, extra);
    if (!spot) fail(`no enemy spot near ${fx},${fy}`);
    claim(spot[0], spot[1], letter, 'enemy ' + letter);
    return spot;
  }

  // ALIVE WORLD: a CAMP places 3-6 members in a knot, stamps one group id
  // over all of them (group alert: wake one by sight, wake the camp), and
  // gives each mobile member a 2-4 point patrol loop within ~6 tiles of
  // home. Put an 'n' in members and the camp gains a sniper spotter.
  function camp({ x, y, members, spread = 2.5, patrolR = 5, extra = () => true }) {
    if (members.length < 1 || members.length > 6) fail(`camp at ${x},${y}: 1-6 members`);
    const homes = [];
    for (let i = 0; i < members.length; i++) {
      const a = (i / members.length) * Math.PI * 2 + rnd();
      const fx = Math.round(x + Math.cos(a) * spread * (0.4 + rnd() * 0.6));
      const fy = Math.round(y + Math.sin(a) * spread * (0.4 + rnd() * 0.6));
      const spot = placeEnemy(members[i], fx, fy, extra);
      homes.push({ letter: members[i], at: spot });
    }
    groups.push(homes.map(hm => hm.at));
    for (const hm of homes) {
      if (STATIONARY_LETTERS.has(hm.letter)) continue;
      const pts = [];
      const n = 2 + Math.floor(rnd() * 3); // 2-4 waypoints
      for (let k = 0; k < n && pts.length < 4; k++) {
        const a = rnd() * Math.PI * 2;
        const r = 2 + rnd() * Math.min(6, patrolR);
        const p = nudge(Math.round(hm.at[0] + Math.cos(a) * r), Math.round(hm.at[1] + Math.sin(a) * r), () => true, 6);
        if (p && !(p[0] === hm.at[0] && p[1] === hm.at[1])) pts.push(p);
      }
      if (pts.length >= 2) patrols.push({ at: hm.at, points: pts });
    }
    return homes;
  }

  // A lone sentry — placed solo, optional patrol loop, no group.
  function sentry(letter, x, y, { patrol = true, patrolR = 5 } = {}) {
    const at = placeEnemy(letter, x, y);
    if (patrol && !STATIONARY_LETTERS.has(letter)) {
      const pts = [];
      for (let k = 0; k < 3 && pts.length < 3; k++) {
        const a = rnd() * Math.PI * 2;
        const p = nudge(Math.round(at[0] + Math.cos(a) * (2 + rnd() * patrolR)), Math.round(at[1] + Math.sin(a) * (2 + rnd() * patrolR)), () => true, 6);
        if (p && !(p[0] === at[0] && p[1] === at[1])) pts.push(p);
      }
      if (pts.length >= 2) patrols.push({ at, points: pts });
    }
    return at;
  }

  // ---- validation + repair ----
  // Passability for the proofs: the sim's blocksPath ('#T~o%' + '!') PLUS
  // standing prebuilt structures (wall/barricade/turret/comm) — gnawable,
  // but the honest route must not need a demolition.
  function passSet() {
    const solidBuilds = new Set();
    for (const b of builds) {
      if (b.prebuilt && b.kind !== 'farm') solidBuilds.add(b.y * w + b.x);
    }
    return (x, y) => {
      const c = get(x, y);
      if (HARD_BLOCK.has(c) || c === '!') return false;
      if (c === 'B' && solidBuilds.has(y * w + x)) return false;
      return true;
    };
  }

  function bfs(sx, sy, pass) {
    const seen = Array.from({ length: h }, () => Array(w).fill(false));
    if (!pass(sx, sy)) return seen;
    const q = [[sx, sy]];
    seen[sy][sx] = true;
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (inBounds(nx, ny) && !seen[ny][nx] && pass(nx, ny)) {
          seen[ny][nx] = true;
          q.push([nx, ny]);
        }
      }
    }
    return seen;
  }

  // REPAIR: BFS from the cut-off tile across everything except standing
  // prebuilt builds and the depth-0 frame, find the nearest already-reachable
  // tile, then convert the terrain blockers along that path to floor.
  function repairTo(tx, ty, reach, pass) {
    const solid = new Set(builds.filter(b => b.prebuilt && b.kind !== 'farm').map(b => b.y * w + b.x));
    const prev = new Map();
    const q = [[tx, ty]];
    const seen = new Set([ty * w + tx]);
    let hit = null;
    while (q.length && !hit) {
      const [x, y] = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        const k = ny * w + nx;
        if (!inBounds(nx, ny) || nx < 1 || ny < 1 || nx > w - 2 || ny > h - 2) continue;
        if (seen.has(k) || solid.has(k)) continue;
        seen.add(k);
        prev.set(k, y * w + x);
        if (reach[ny][nx]) { hit = k; break; }
        q.push([nx, ny]);
      }
    }
    if (hit == null) return false;
    let k = hit;
    while (k !== undefined && k !== ty * w + tx) {
      const x = k % w, y = Math.floor(k / w);
      if (!pass(x, y)) { set(x, y, '.'); repairsLog.push(`carved ${x},${y}`); }
      k = prev.get(k);
    }
    return true;
  }

  // The full proof: spawns, cores, every def-bound entity and tower/shop
  // tile must reach spawn[0]; every wave-entry candidate on all four edges
  // must too. Cut-off targets get repaired (carved causeways), then the
  // whole proof reruns. `mustNotReach` (skiff islands) is asserted last.
  function validate({ mustNotReach = [], extraTargets = [], repair = true, maxPasses = 6 } = {}) {
    if (!spawns.length) fail('no spawns placed');
    if (!cores.length) fail('no core/beacon placed');
    const targets = [];
    for (const [x, y] of spawns) targets.push(['spawn', x, y]);
    for (const [x, y] of cores) targets.push(['core', x, y]);
    for (const b of builds) if (!b.prebuilt || b.kind === 'farm') targets.push(['build:' + b.kind, b.x, b.y]);
    for (const c of chests) if (!c.tag) targets.push(['chest', c.x, c.y]);
    for (const hi of hires) targets.push(['hire', hi.x, hi.y]);
    for (const v of vehicles) targets.push(['vehicle:' + v.kind, v.x, v.y]);
    for (const n of npcs) targets.push(['npc', n.x, n.y]);
    for (const p of pickups) targets.push(['pickup', p.x, p.y]);
    for (const s of switches) targets.push(['switch', s.x, s.y]);
    for (const qi of qitems) targets.push(['qitem', qi.x, qi.y]);
    for (const [x, y, label] of extraTargets) targets.push([label || 'extra', x, y]);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (get(x, y) === 'W' || get(x, y) === 'S' || get(x, y) === 'Y' || ENEMY_LETTERS.has(get(x, y))) {
          targets.push([get(x, y), x, y]);
        }
      }
    }
    for (let pass = 0; pass < maxPasses; pass++) {
      const P = passSet();
      const reach = bfs(spawns[0][0], spawns[0][1], P);
      let broken = 0;
      for (const [what, x, y] of targets) {
        if (reach[y][x]) continue;
        if (!repair) fail(`${what} at ${x},${y} unreachable from spawn`);
        if (!repairTo(x, y, reach, P)) fail(`${what} at ${x},${y} unreachable and unrepairable`);
        broken++;
      }
      // wave-entry edge bands: mirror waveEntryPoints (depth<2, !blocksMove,
      // never lava) — every candidate must connect, every edge must have one
      for (const edge of ['n', 's', 'w', 'e']) {
        const len = edge === 'n' || edge === 's' ? w : h;
        let cands = 0;
        for (let i = 0; i < len; i++) {
          for (let depth = 0; depth < 2; depth++) {
            const [tx, ty] =
              edge === 'n' ? [i, depth] :
              edge === 's' ? [i, h - 1 - depth] :
              edge === 'w' ? [depth, i] : [w - 1 - depth, i];
            const c = get(tx, ty);
            if (!HARD_BLOCK.has(c) && c !== '!') {
              if (!reach[ty][tx]) {
                if (!repair) fail(`wave band '${edge}' candidate ${tx},${ty} disconnected`);
                if (!repairTo(tx, ty, reach, P)) fail(`wave band '${edge}' candidate ${tx},${ty} unrepairable`);
                broken++;
              } else cands++;
              break;
            }
          }
        }
        if (!cands && !broken) fail(`wave band '${edge}' has no entry candidates`);
      }
      if (!broken) {
        for (const [x, y, what] of mustNotReach) {
          if (reach[y][x]) fail(`${what || 'isolated target'} at ${x},${y} is walk-reachable — it must not be`);
        }
        if (repair) sealPockets(reach, P);
        return reach;
      }
    }
    fail('validate: repairs did not converge');
  }

  // Connectivity repair: any walkable tile neither walk-reachable from
  // spawn[0] nor skiff-reachable (water+shore flood from a moored skiff) is
  // a dead pocket — outline wobble and void veins leave a few per map, and
  // they trap pathing into permanent rescans. Seal them to '#'. A pocket
  // holding a non-floor letter is a generator bug and fails loudly.
  function sealPockets(reach, P) {
    // Two-phase skiff exemption, matching what a skiff can actually do:
    // (1) sail ONLY the water body it is moored on; (2) beach on land tiles
    // touching that body, then walk. A different pond merely touching
    // walk-reachable land is NOT sailable — pockets ringed by it still seal.
    const waterOk = Array.from({ length: h }, () => Array(w).fill(false));
    const wq = [];
    for (const v of vehicles) {
      if (v.kind !== 'skiff') continue;
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = v.x + dx, ny = v.y + dy;
        if (inBounds(nx, ny) && get(nx, ny) === '~' && !waterOk[ny][nx]) {
          waterOk[ny][nx] = true;
          wq.push([nx, ny]);
        }
      }
    }
    while (wq.length) {
      const [x, y] = wq.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (inBounds(nx, ny) && !waterOk[ny][nx] && get(nx, ny) === '~') {
          waterOk[ny][nx] = true;
          wq.push([nx, ny]);
        }
      }
    }
    const skiffOk = Array.from({ length: h }, () => Array(w).fill(false));
    const lq = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!P(x, y) || skiffOk[y][x]) continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inBounds(x + dx, y + dy) && waterOk[y + dy][x + dx])) {
          skiffOk[y][x] = true;
          lq.push([x, y]);
        }
      }
    }
    while (lq.length) {
      const [x, y] = lq.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (inBounds(nx, ny) && !skiffOk[ny][nx] && P(nx, ny)) {
          skiffOk[ny][nx] = true;
          lq.push([nx, ny]);
        }
      }
    }
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (!P(x, y) || reach[y][x] || skiffOk[y][x]) continue;
        const c = get(x, y);
        if (!FLOORS.has(c)) fail(`dead pocket at ${x},${y} holds '${c}' — an entity is sealed off`);
        set(x, y, '#');
        repairsLog.push(`sealed ${x},${y}`);
      }
    }
  }

  // Skiff proof: flood '~' + walkable from the dock; every target must float.
  function validateSkiff(dock, targets) {
    const P = passSet();
    const seen = Array.from({ length: h }, () => Array(w).fill(false));
    const q = [dock];
    seen[dock[1]][dock[0]] = true;
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (inBounds(nx, ny) && !seen[ny][nx] && (get(nx, ny) === '~' || P(nx, ny))) {
          seen[ny][nx] = true;
          q.push([nx, ny]);
        }
      }
    }
    for (const [x, y, what] of targets) {
      if (!seen[y][x]) fail(`${what || 'skiff target'} at ${x},${y} not reachable by skiff from dock ${dock[0]},${dock[1]}`);
    }
  }

  // Decorative floor recolor LAST — passable letters only, '.' tiles only,
  // so every connectivity proof survives untouched.
  function decorate(cb) {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (get(x, y) !== '.') continue;
        const c = cb(x, y, rnd);
        if (c && FLOORS.has(c)) set(x, y, c);
      }
    }
  }

  // Wet shores: '.' beside '~' becomes ':' (the sh01 look).
  function paintShores(letter = ':') {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (get(x, y) !== '.') continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => get(x + dx, y + dy) === '~')) set(x, y, letter);
      }
    }
  }

  // ---- finalize: sort plans row-major, emit the def fragments ----
  function rowMajor(a, b) { return a.y - b.y || a.x - b.x; }
  function finalize() {
    builds.sort(rowMajor); chests.sort(rowMajor); hires.sort(rowMajor);
    vehicles.sort(rowMajor); npcs.sort(rowMajor); pickups.sort(rowMajor);
    switches.sort(rowMajor); qitems.sort(rowMajor);
    const frag = {
      tiles: grid.map(r => r.join('')),
      builds: builds.map(b => ({
        kind: b.kind, cost: b.cost,
        ...(b.prebuilt ? { prebuilt: true } : {}),
        ...(b.level > 1 ? { level: b.level } : {}),
        ...(b.ttype ? { ttype: b.ttype } : {}),
      })),
      chests: chests.map(c => ({ loot: c.loot, amount: c.amount })),
      hires: hires.map(hi => ({ job: hi.job, cost: hi.cost, name: hi.name })),
      vehicles: vehicles.map(v => ({ kind: v.kind })),
      npcs: npcs.map(n => ({ id: n.id, name: n.name, lines: n.lines || [], ...(n.gift ? { gift: n.gift } : {}) })),
      pickups: pickups.map(p => ({ kind: p.kind })),
      switches: switches.map(s => ({ ...(s.id ? { id: s.id } : {}), group: s.group ?? 0 })),
      qitems: qitems.map(qi => ({ ...(qi.id ? { id: qi.id } : {}), kind: qi.kind || 'fragment' })),
      groups: groups.map(g2 => g2.map(([x, y]) => [x, y])),
      patrols: patrols.map(p => ({ at: [p.at[0], p.at[1]], points: p.points.map(([x, y]) => [x, y]) })),
    };
    for (const k of ['chests', 'hires', 'vehicles', 'npcs', 'pickups', 'switches', 'qitems', 'groups', 'patrols']) {
      if (!frag[k].length) delete frag[k];
    }
    if (!frag.builds.length) delete frag.builds;
    return frag;
  }

  function counts() {
    const n = {};
    for (const row of grid) for (const c of row) n[c] = (n[c] || 0) + 1;
    return n;
  }

  return {
    w, h, rnd, grid, get, set, inBounds, fail,
    blob, disc, vein, outline, edgeRing, carve, nudge,
    fortRect, fortDiamond,
    addBuild, addChest, addHire, addVehicle, addNpc, addPickup, addSwitch, addQitem,
    addSpawn, addCore, addTower, addShop, addCrystal, addCampfire,
    placeEnemy, camp, sentry,
    validate, validateSkiff, decorate, paintShores,
    finalize, counts,
    spawns, cores, buildsPlan: builds, chestsPlan: chests, repairsLog,
  };
}

// ---------------------------------------------------------------------------
// def assembly + the mirror of test/sim.test.js's stronghold validator
// ---------------------------------------------------------------------------
let _charIds = null;
export function characterIds() {
  if (!_charIds) {
    const chars = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared', 'characters.json'), 'utf8'));
    _charIds = new Set(chars.map(c => c.id));
  }
  return _charIds;
}

// The fixed unlock schedule (contract): levels not listed grant a feature
// debut instead. Level agents MUST follow this — the client roster reads it.
export const UNLOCK_SCHEDULE = {
  2: 'sniper', 3: 'raider', 4: 'pyro', 5: 'engineer', 6: 'bastion',
  8: 'duelist', 10: 'volt', 12: 'boomer', 14: 'warden', 16: 'shade',
  18: 'helix', 20: 'seal', 23: 'atlas',
};

export function assembleDef({
  level, name, sizeLabel, difficulty, blurb, newFeatures,
  objective, intro, outro, table, map,
  bastionVariant, weather, ambience, modifiers, quests,
}) {
  const frag = map.finalize();
  const unlock = UNLOCK_SCHEDULE[level];
  const def = {
    name,
    objective,
    time: 600,
    expedition: true,
    mode: 'bastion',
    ...(bastionVariant ? { bastionVariant } : {}),
    bastion: table.bastion,
    stronghold: {
      level, name, sizeLabel, difficulty,
      waves: table.waves,
      ...(table.hpMult > 1 ? { hpMult: table.hpMult } : {}),
      ...(unlock ? { unlock } : {}),
      blurb,
      newFeatures,
    },
    ...(weather && weather !== 'clear' ? { weather } : {}),
    ...(ambience ? { ambience } : {}),
    ...(modifiers ? { modifiers } : {}),
    intro,
    ...(outro ? { outro } : {}),
    ...(quests && quests.length ? { quests } : {}),
    captiveChars: [],
    ...frag,
  };
  repairStallClearance(def);
  checkDef(def);
  return def;
}

// Mirrors testStrongholdDefIntegrity + the shared level checks so a bad
// generator dies at gen time, not at npm test.
export function checkDef(def) {
  const tag = def.name || 'stronghold level';
  const oops = msg => { throw new Error(`DEF INVALID [${tag}]: ${msg}`); };
  if (def.mode !== 'bastion') oops('mode must be bastion');
  const sh = def.stronghold;
  if (!sh || typeof sh !== 'object') oops('def.stronghold missing');
  if (!Number.isInteger(sh.level) || sh.level < 1 || sh.level > 25) oops('stronghold.level 1..25');
  if (typeof sh.name !== 'string' || !sh.name) oops('stronghold.name');
  if (!['S', 'M', 'L', 'XL'].includes(sh.sizeLabel)) oops('sizeLabel');
  if (!Number.isInteger(sh.difficulty) || sh.difficulty < 1 || sh.difficulty > 5) oops('difficulty 1..5');
  const b = def.bastion || {};
  const nights = b.nights ?? 5;
  const wpn = Math.max(1, Math.min(3, b.wavesPerNight || 1));
  const moons = (b.bloodMoons || []).length;
  if (sh.waves !== nights * wpn + moons * wpn) {
    oops(`waves ${sh.waves} != truthful ${nights * wpn + moons * wpn} (${nights} nights x${wpn} + ${moons} moons x${wpn})`);
  }
  if (b.waveMult !== undefined && !(b.waveMult >= 1 && b.waveMult <= 2.6)) oops('waveMult 1..2.6');
  if (sh.hpMult !== undefined && !(sh.hpMult >= 1 && sh.hpMult <= 2)) oops('hpMult 1..2');
  if (sh.unlock !== undefined && !characterIds().has(sh.unlock)) oops(`unlock '${sh.unlock}' unknown`);
  if (typeof sh.blurb !== 'string' || !sh.blurb) oops('blurb');
  if (!Array.isArray(sh.newFeatures) || !sh.newFeatures.every(s => typeof s === 'string')) oops('newFeatures');
  if (!Array.isArray(def.intro) || def.intro.length < 1) oops('intro slide required');
  const w = def.tiles[0].length;
  for (const row of def.tiles) {
    if (row.length !== w) oops('ragged tile rows');
    for (const c of row) if (!LEGAL_TILES.has(c)) oops(`illegal tile '${c}'`);
  }
  const ks = def.tiles.reduce((n, r) => n + (r.split('K').length - 1), 0);
  if (def.bastionVariant === 'beacons') { if (ks !== 4) oops(`beacon variant needs exactly 4 K tiles, found ${ks}`); }
  else if (ks !== 1) oops(`core bastion needs exactly 1 K tile, found ${ks}`);
  if (!def.tiles.some(r => r.includes('P'))) oops('no P spawn');
  if (!def.tiles.some(r => /[garsmnwbzfqvxu]/.test(r))) oops('no enemies on the map');
  for (const bd of def.builds || []) {
    if (!BUILD_KINDS.has(bd.kind)) oops(`build kind '${bd.kind}'`);
    if (typeof bd.cost !== 'number' || bd.cost < 0) oops('build cost');
    if (bd.prebuilt !== undefined && typeof bd.prebuilt !== 'boolean') oops('prebuilt flag');
  }
  if (def.weather && !WEATHERS.has(def.weather)) oops(`weather '${def.weather}'`);
  if (def.ambience && !AMBIENCES.has(def.ambience)) oops(`ambience '${def.ambience}'`);
  for (const pd of def.patrols || []) {
    if (!Array.isArray(pd.at) || pd.at.length !== 2) oops('patrol.at');
    if (!Array.isArray(pd.points) || pd.points.length < 2 || pd.points.length > 4) oops('patrol routes 2-4 points');
  }
  // bound counts: every letter with a def binding must not OVERRUN its array
  // (missing trailing defs fall back to defaults; extras would misbind)
  const tileCount = ch => def.tiles.reduce((n, r) => n + (r.split(ch).length - 1), 0);
  const boundMax = [['B', (def.builds || []).length], ['N', (def.npcs || []).length]];
  for (const [ch, n] of boundMax) {
    if (tileCount(ch) !== n && n !== 0) oops(`'${ch}' tiles (${tileCount(ch)}) != bound defs (${n})`);
  }
  for (const q of def.quests || []) {
    if (!q.id || !q.giver) oops(`quest '${q.id || '?'}' needs id+giver`);
    if (!(def.npcs || []).some(n => n.id === q.giver)) oops(`quest '${q.id}' giver '${q.giver}' is not an npc`);
  }
  // Stall clearance: structureInReach (1.5 tiles) silently claims an act-hold
  // near any build site/tower, so a stall inside 2.5 tiles of structure work
  // reads as 'the shop does not respond' (the sh17 report). Mirror of the
  // sim test; repairStallClearance(def) fixes violations deterministically.
  def.tiles.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== 'S') continue;
      def.tiles.forEach((row2, y2) => {
        for (let x2 = 0; x2 < row2.length; x2++) {
          if (row2[x2] !== 'B' && row2[x2] !== 'W') continue;
          const d = Math.hypot(x2 - x, y2 - y);
          if (d < 2.5) oops(`stall (${x},${y}) only ${d.toFixed(2)} tiles from structure work (${x2},${y2}) — needs >= 2.5`);
        }
      });
    }
  });
}

// Deterministic stall-clearance repair: every 'S' tile inside 2.5 tiles of a
// 'B'/'W' tile walks (BFS over plain floor, so it stays in its own region) to
// the nearest open floor tile with full clearance. assembleDef runs this
// before checkDef; standalone generators (gen-sh09-17) call it themselves.
const STALL_FLOORS = new Set('.,:;_=^');
export function repairStallClearance(def, minDist = 2.5) {
  const grid = def.tiles.map(r => r.split(''));
  const H = grid.length, W = grid[0].length;
  const works = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) if (grid[y][x] === 'B' || grid[y][x] === 'W') works.push([x, y]);
  }
  const clear = (x, y) => works.every(([wx, wy]) => Math.hypot(wx - x, wy - y) >= minDist);
  let moved = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grid[y][x] !== 'S' || clear(x, y)) continue;
      // BFS from the stall across walkable floor — first clear floor wins
      const seen = new Set([y * W + x]);
      const q = [[x, y]];
      let spot = null;
      while (q.length && !spot) {
        const [cx, cy] = q.shift();
        for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
          const nx = cx + dx, ny = cy + dy;
          const k = ny * W + nx;
          if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1 || seen.has(k)) continue;
          if (!STALL_FLOORS.has(grid[ny][nx])) continue;
          if (clear(nx, ny)) { spot = [nx, ny]; break; }
          seen.add(k);
          q.push([nx, ny]);
        }
      }
      if (!spot) throw new Error(`repairStallClearance: stall (${x},${y}) has no clear floor in reach`);
      grid[spot[1]][spot[0]] = 'S';
      grid[y][x] = '.';
      moved++;
    }
  }
  if (moved) def.tiles = grid.map(r => r.join(''));
  return moved;
}

export function writeDef(def, file) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, file);
  fs.writeFileSync(out, JSON.stringify(def, null, 2) + '\n');
  return out;
}

// Console report helper for generators.
export function report(def, map, out) {
  const n = map.counts();
  console.log(def.tiles.join('\n'));
  console.log(`${map.w}x${map.h} — ${def.name} (sh${String(def.stronghold.level).padStart(2, '0')})`);
  console.log('tile counts:', Object.fromEntries(Object.entries(n).sort()));
  console.log(`builds: ${(def.builds || []).length} (${(def.builds || []).filter(b => b.prebuilt).length} prebuilt walls/structures)`);
  console.log(`camps: ${(def.groups || []).length} | patrols: ${(def.patrols || []).length} | chests: ${(def.chests || []).length}`);
  console.log(`waves: ${def.stronghold.waves} over ${def.bastion.nights} nights (x${def.bastion.wavesPerNight || 1}/night, moons ${JSON.stringify(def.bastion.bloodMoons)}) | hpMult ${def.stronghold.hpMult || 1} | waveMult ${def.bastion.waveMult || 1}`);
  if (map.repairsLog.length) console.log(`validator repairs: ${map.repairsLog.length}`);
  console.log('wrote', out);
}
