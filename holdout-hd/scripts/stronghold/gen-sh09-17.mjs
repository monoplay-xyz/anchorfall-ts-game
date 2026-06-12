// Generates levels/stronghold/sh09.json .. sh17.json — the mid-arc of the
// 25-level stronghold campaign (Frontier IV contract, levels agent two).
//
// Deterministic: every level runs its own mulberry32 stream seeded 202607NN.
// Re-running always reproduces byte-identical JSON.
//
// Design rules honored here (see the contract):
//   - ORGANIC silhouettes only: every map is a noise-warped shape with a
//     themed natural border (mountain, forest, water, lava, void, ice) and
//     carved wave inlets on all four cardinal edges. No square wall boxes.
//   - Bases are PREBUILT WALL SEGMENTS (build kind 'wall', damageable),
//     gates are open gaps with barricade sites. No indestructible bases.
//   - Enemies live in CAMPS (def.groups) with patrol routes (def.patrols)
//     and sniper spotters; camps sit >= 10 tiles off the base walls so the
//     first day stays calm.
//   - Difficulty arc: waves 14 -> 20, hpMult 1.27 -> 1.55, waveMult
//     1.5 -> 2.05, nights 6 -> 9, blood moons thickening late.
//   - Unlock schedule (fixed): sh10 volt, sh12 boomer, sh14 warden,
//     sh16 shade. The other levels debut features instead.
//   - sh11 + sh17 run the beacon-defense variant (exactly four 'K').
//     sh17 'Twin Strongholds' fields TWO walled bases with two anchor
//     monoliths each — beacons-variant semantics: the hold only falls
//     when all four are dark at once (lose-when-all-dark, documented).
//
// Every level self-checks at generation time (mirrors test/sim.test.js):
// connectivity, row-major def bindings, wave-inlet candidates on all four
// edges, honest waves accounting (nights*wpn + bloodMoons*wpn — every
// blood-moon wave pours from two edges, the second a 60% detachment).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { repairStallClearance } from './framework.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '../../levels/stronghold');

const ART_KEYS = new Set(['anchorcraft', 'crossing', 'basin', 'quorum', 'forkfall', 'siege', 'settlement', 'campfire', 'entropy', 'dawn']);
const CHAR_IDS = new Set(['scout', 'soldier', 'grenadier', 'medic', 'sniper', 'raider', 'pyro', 'bastion', 'engineer', 'duelist', 'volt', 'boomer', 'warden', 'shade', 'helix', 'atlas', 'seal']);
const ENEMY_LETTERS = 'garsmnwbzfqvxu';
const MOBILE = new Set('grswzfqvxu'); // patrol-capable kinds (a/n/m are posts, b is a warlord)
const LEGAL_TILES = new Set('#.To~,:;_*=!^%E' + 'PcNBCKVWSHDYAIQJXZO' + ENEMY_LETTERS);
const BUILD_KINDS = new Set(['pylon', 'barricade', 'turret', 'farm', 'beacon', 'wall', 'comm']);
const WALK_BLOCK = new Set(['#', 'T', '~', 'o', '%']); // matches the sim/test pass()
const QUEST_KINDS = new Set(['fetch', 'kill', 'build', 'switch', 'glyph', 'destroy', 'craft', 'reach']);

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Level builder: a char grid plus row-major-bound def collectors. Every def
// array the sim binds by tile scan order (builds/chests/vehicles/hires/npcs/
// pickups/qitems/switches/glyphs/teleports) is collected WITH its tile and
// sorted y-then-x at assembly, so the JSON always matches the scan.
// ---------------------------------------------------------------------------
class Lvl {
  constructor(id, name, W, H, seed, fill = '.') {
    this.id = id; this.name = name; this.W = W; this.H = H;
    this.rnd = mulberry32(seed);
    this.g = Array.from({ length: H }, () => Array(W).fill(fill));
    this.builds = []; this.chests = []; this.vehicles = []; this.hires = [];
    this.npcs = []; this.pickups = []; this.qitems = []; this.switches = [];
    this.glyphs = []; this.teleports = []; this.quests = []; this.switchGroups = [];
    this.glyphGroups = []; this.doors = []; this.groups = []; this.patrols = [];
    this.spawns = []; this.cores = []; this.enemySpots = [];
  }
  in(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  inInner(x, y) { return x >= 1 && y >= 1 && x < this.W - 1 && y < this.H - 1; }
  get(x, y) { return this.in(x, y) ? this.g[y][x] : '#'; }
  set(x, y, c) { if (this.in(x, y)) this.g[y][x] = c; }
  fail(msg) { console.error(`GEN FAIL [${this.id} ${this.name}]:`, msg); process.exit(1); }

  // --- painters --------------------------------------------------------
  blob(cx, cy, r, c, density = 0.75) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r && this.rnd() < density * (1 - d / (r + 1))) this.set(x, y, c);
      }
  }
  // organic outline: an ellipse whose radius wobbles on two fixed harmonics —
  // the per-level silhouette. Returns a predicate(x, y) => inside.
  organic(cx, cy, rx, ry, amp = 0.13) {
    const k1 = 2 + Math.floor(this.rnd() * 3), k2 = 5 + Math.floor(this.rnd() * 3);
    const p1 = this.rnd() * Math.PI * 2, p2 = this.rnd() * Math.PI * 2;
    const a1 = amp * (0.6 + this.rnd() * 0.6), a2 = amp * 0.5 * (0.6 + this.rnd() * 0.6);
    return (x, y) => {
      const th = Math.atan2((y - cy) / ry, (x - cx) / rx);
      const r = Math.hypot((x - cx) / rx, (y - cy) / ry);
      return r <= 1 + a1 * Math.sin(k1 * th + p1) + a2 * Math.sin(k2 * th + p2);
    };
  }
  // paint every inner tile OUTSIDE the predicate with c (the themed border)
  border(pred, c) {
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++)
        if (!pred(x, y)) this.set(x, y, c);
  }
  rim() { // hard map rim — depth-0 ring (inlets may re-carve depth 1)
    for (let x = 0; x < this.W; x++) { this.set(x, 0, '#'); this.set(x, this.H - 1, '#'); }
    for (let y = 0; y < this.H; y++) { this.set(0, y, '#'); this.set(this.W - 1, y, '#'); }
  }
  // carve a polyline corridor of the given half-width down to floor
  carve(pts, w, c = '.') {
    for (let s = 0; s + 1 < pts.length; s++) {
      const [x0, y0] = pts[s], [x1, y1] = pts[s + 1];
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
      for (let i = 0; i <= steps; i++) {
        const x = x0 + (x1 - x0) * (i / steps), y = y0 + (y1 - y0) * (i / steps);
        for (let dy = -w; dy <= w; dy++)
          for (let dx = -w; dx <= w; dx++)
            if (dx * dx + dy * dy <= w * w + 0.5) {
              const tx = Math.round(x + dx), ty = Math.round(y + dy);
              if (this.inInner(tx, ty)) this.set(tx, ty, c);
            }
      }
    }
  }

  // --- placement (all assert their footing) -----------------------------
  isFloor(c) { return '.,:;_=^'.includes(c); }
  place(c, x, y, what = c) {
    if (!this.inInner(x, y)) this.fail(`${what} out of bounds at ${x},${y}`);
    if (!this.isFloor(this.get(x, y))) this.fail(`${what} spot occupied at ${x},${y} '${this.get(x, y)}'`);
    this.set(x, y, c);
    return [x, y];
  }
  // spiral to the nearest floor tile passing `ok`
  nudge(fx, fy, ok = () => true, maxR = 18) {
    for (let r = 0; r < maxR; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = fx + dx, y = fy + dy;
          if (this.inInner(x, y) && this.isFloor(this.get(x, y)) && ok(x, y)) return [x, y];
        }
    return null;
  }
  spawn(x, y) { this.place('P', x, y, 'spawn'); this.spawns.push([x, y]); }
  core(x, y) { this.place('K', x, y, 'core'); this.cores.push([x, y]); }
  tower(x, y) { this.place('W', x, y, 'tower'); }
  shop(x, y) { this.place('S', x, y, 'shop'); }
  fire(x, y) { if (this.isFloor(this.get(x, y))) this.set(x, y, '*'); }
  build(kind, cost, x, y, extra = {}) {
    this.place('B', x, y, kind);
    this.builds.push({ x, y, def: { kind, cost, ...extra } });
  }
  chest(x, y, loot, amount, isle = false) {
    this.place('C', x, y, 'chest');
    this.chests.push({ x, y, isle, def: { loot, amount } });
  }
  vehicle(kind, x, y) { this.place('V', x, y, kind); this.vehicles.push({ x, y, def: { kind } }); }
  hire(x, y, job, cost, name) { this.place('H', x, y, 'hire'); this.hires.push({ x, y, def: { job, cost, name } }); }
  npc(x, y, def) { this.place('N', x, y, 'npc'); this.npcs.push({ x, y, def }); }
  pickup(x, y, kind, ammo) { this.place('A', x, y, 'pickup'); this.pickups.push({ x, y, def: { kind, ...(ammo ? { ammo } : {}) } }); }
  qitem(x, y, def) { this.place('I', x, y, 'qitem'); this.qitems.push({ x, y, def }); }
  relay(x, y, id, group = 0) { this.place('Q', x, y, 'relay'); this.switches.push({ x, y, def: { id, group } }); }
  forge(x, y) { this.place('Z', x, y, 'forge'); }
  telepad(x, y, id, twin) { this.place('O', x, y, 'teleport'); this.teleports.push({ x, y, def: { id, twin } }); }
  crystal(fx, fy, ok = () => true) {
    const s = this.nudge(fx, fy, ok);
    if (!s) this.fail(`no crystal spot near ${fx},${fy}`);
    this.set(s[0], s[1], 'Y');
  }
  enemy(letter, x, y) {
    if (!ENEMY_LETTERS.includes(letter)) this.fail(`unknown enemy letter '${letter}'`);
    this.place(letter, x, y, `enemy ${letter}`);
    this.enemySpots.push([x, y]);
    return [x, y];
  }

  // straight line of walkable tiles (patrol legs steer, not path)
  lineWalkable(x0, y0, x1, y1) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + (x1 - x0) * (i / steps));
      const y = Math.round(y0 + (y1 - y0) * (i / steps));
      const c = this.get(x, y);
      if (WALK_BLOCK.has(c) || c === '!') return false;
    }
    return true;
  }
  // A CAMP: 3-6 members placed around (cx, cy), one shared group id, patrol
  // routes on up to `patrolN` mobile members (2-4 waypoints, <= 6 tiles out).
  camp(cx, cy, letters, { ok = () => true, patrolN = 2, fire = true } = {}) {
    const members = [];
    const ring = [[0, 0], [2, -1], [-2, 1], [1, 2], [-1, -2], [3, 1], [-3, -1], [2, 3], [-2, -3]];
    let ri = 0;
    for (const letter of letters) {
      let spot = null;
      while (ri < ring.length && !spot) {
        const [ox, oy] = ring[ri++];
        const cand = this.nudge(cx + ox, cy + oy, (x, y) => ok(x, y), 6);
        if (cand && !members.some(m => m[0] === cand[0] && m[1] === cand[1])) spot = cand;
      }
      if (!spot) this.fail(`camp at ${cx},${cy} has no room for '${letter}'`);
      this.enemy(letter, spot[0], spot[1]);
      members.push(spot);
    }
    this.groups.push(members.map(m => [m[0], m[1]]));
    let routed = 0;
    for (let i = 0; i < letters.length && routed < patrolN; i++) {
      if (!MOBILE.has(letters[i])) continue;
      const [hx, hy] = members[i];
      const pts = [];
      const arms = [[4, 0], [0, 4], [-4, 0], [0, -4], [3, 3], [-3, 3], [3, -3], [-3, -3]];
      for (let a = (routed * 2) % arms.length, tries = 0; pts.length < 3 && tries < arms.length; tries++) {
        const [ox, oy] = arms[(a + tries) % arms.length];
        const wp = this.nudge(hx + ox, hy + oy, (x, y) => Math.hypot(x - hx, y - hy) <= 6 && this.lineWalkable(hx, hy, x, y), 3);
        if (wp && !(wp[0] === hx && wp[1] === hy) && !pts.some(p => p[0] === wp[0] && p[1] === wp[1])) pts.push(wp);
      }
      if (pts.length >= 2) {
        this.patrols.push({ at: [hx, hy], points: pts });
        routed++;
      }
    }
    if (fire) {
      const f = this.nudge(cx, cy + 1, () => true, 4);
      if (f) this.fire(f[0], f[1]);
    }
    return members;
  }
  sentry(letter, fx, fy, ok = () => true) {
    const s = this.nudge(fx, fy, ok, 10);
    if (!s) this.fail(`no sentry spot near ${fx},${fy}`);
    this.enemy(letter, s[0], s[1]);
    return s;
  }

  // --- the fortress kit: prebuilt wall ring, gate barricades, fittings ----
  // Rect ring x0..x1, y0..y1. Gates: 2-wide N/S at the center column, 1-wide
  // E/W at the center row. All walls are prebuilt 'wall' segments (cost 5);
  // every gate cell is an open barricade site (cost 4).
  fortress(x0, y0, x1, y1, { floor = ';', gates = 'nsew', apron = 2, wallLevel = 1 } = {}) {
    const cx = Math.floor((x0 + x1) / 2), cy = Math.floor((y0 + y1) / 2);
    for (let y = y0 - apron; y <= y1 + apron; y++)
      for (let x = x0 - apron; x <= x1 + apron; x++)
        if (this.inInner(x, y)) this.set(x, y, '.');
    for (let y = y0 + 1; y < y1; y++)
      for (let x = x0 + 1; x < x1; x++) this.set(x, y, floor);
    const gateCells = [];
    if (gates.includes('n')) gateCells.push([cx - 1, y0], [cx, y0]);
    if (gates.includes('s')) gateCells.push([cx - 1, y1], [cx, y1]);
    if (gates.includes('w')) gateCells.push([x0, cy]);
    if (gates.includes('e')) gateCells.push([x1, cy]);
    const isGate = (x, y) => gateCells.some(([gx, gy]) => gx === x && gy === y);
    for (let x = x0; x <= x1; x++)
      for (const y of [y0, y1])
        if (!isGate(x, y)) { this.set(x, y, floor); this.build('wall', 5, x, y, { prebuilt: true, ...(wallLevel > 1 ? { level: wallLevel } : {}) }); }
    for (let y = y0 + 1; y < y1; y++)
      for (const x of [x0, x1])
        if (!isGate(x, y)) { this.set(x, y, floor); this.build('wall', 5, x, y, { prebuilt: true, ...(wallLevel > 1 ? { level: wallLevel } : {}) }); }
    for (const [gx, gy] of gateCells) { this.set(gx, gy, floor); this.build('barricade', 4, gx, gy); }
    return { cx, cy, gateCells };
  }
  // standard interior fittings for a ~21x15 fortress around (cx, cy)
  standardInterior(cx, cy, x0, y0, x1, y1, { hires = [], shopAt = null, farms = 4, stags = 2 } = {}) {
    this.core(cx, cy);
    for (const [ox, oy] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) this.spawn(cx + ox, cy + oy);
    for (const [tx, ty] of [[x0 + 2, y0 + 2], [x1 - 2, y0 + 2], [x0 + 2, y1 - 2], [x1 - 2, y1 - 2]]) this.tower(tx, ty);
    this.shop(...(shopAt || [cx + 4, y0 + 2]));
    this.fire(cx, cy - 3); this.fire(cx, cy + 3);
    const hp = [];
    hires.forEach((h, i) => { const y = cy - 4 + i * 2; this.hire(cx - 6, y, h.job, h.cost, h.name); hp.push([cx - 6, y]); });
    if (stags >= 1) this.vehicle('stag', cx + 6, cy - 1);
    if (stags >= 2) this.vehicle('stag', cx + 6, cy + 1);
    const farmSpots = [[cx + 3, cy + 3], [cx + 5, cy + 3], [cx + 3, cy + 5], [cx + 5, cy + 5]];
    for (let i = 0; i < Math.min(farms, farmSpots.length); i++) this.build('farm', 6, farmSpots[i][0], farmSpots[i][1]);
  }

  // --- analysis ----------------------------------------------------------
  reach(sx, sy, pass) {
    const seen = Array.from({ length: this.H }, () => Array(this.W).fill(false));
    if (!pass(this.get(sx, sy))) this.fail(`flood start ${sx},${sy} not passable`);
    const q = [[sx, sy]];
    seen[sy][sx] = true;
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (this.in(nx, ny) && !seen[ny][nx] && pass(this.get(nx, ny))) {
          seen[ny][nx] = true;
          q.push([nx, ny]);
        }
      }
    }
    return seen;
  }
  walkPass() { return c => !WALK_BLOCK.has(c); }

  // wave-entry candidates per edge, exactly as waveEntryPoints computes them
  edgeCandidates(edge) {
    const horiz = edge === 'n' || edge === 's';
    const len = horiz ? this.W : this.H;
    const cands = [];
    for (let i = 0; i < len; i++)
      for (let depth = 0; depth < 2; depth++) {
        const [tx, ty] =
          edge === 'n' ? [i, depth] :
          edge === 's' ? [i, this.H - 1 - depth] :
          edge === 'w' ? [depth, i] : [this.W - 1 - depth, i];
        const c = this.get(tx, ty);
        if (!WALK_BLOCK.has(c) && c !== '!') { cands.push([tx, ty]); break; }
      }
    return cands;
  }

  // --- assembly + the full self-check ------------------------------------
  assemble(meta) {
    const rm = arr => arr.slice().sort((a, b) => a.y - b.y || a.x - b.x).map(e => e.def);
    const sortPts = arr => arr.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const def = {
      name: this.name,
      objective: meta.objective,
      time: 600,
      expedition: true,
      mode: 'bastion',
      ...(meta.bastionVariant ? { bastionVariant: meta.bastionVariant } : {}),
      bastion: meta.bastion,
      stronghold: meta.stronghold,
      intro: meta.intro,
      ...(meta.outro ? { outro: meta.outro } : {}),
      captiveChars: [],
      builds: rm(this.builds),
      chests: rm(this.chests),
      vehicles: rm(this.vehicles),
      hires: rm(this.hires),
      ...(this.npcs.length ? { npcs: rm(this.npcs) } : {}),
      ...(this.quests.length ? { quests: this.quests } : {}),
      ...(this.qitems.length ? { qitems: rm(this.qitems) } : {}),
      ...(this.switches.length ? { switches: rm(this.switches) } : {}),
      ...(this.switchGroups.length ? { switchGroups: this.switchGroups } : {}),
      ...(this.teleports.length ? { teleports: rm(this.teleports) } : {}),
      ...(this.doors.length ? { doors: this.doors } : {}),
      ...(this.pickups.length ? { pickups: rm(this.pickups) } : {}),
      ...(this.patrols.length ? { patrols: this.patrols.slice().sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0]) } : {}),
      ...(this.groups.length ? { groups: this.groups.map(sortPts) } : {}),
      ...(meta.weather ? { weather: meta.weather } : {}),
      ...(meta.ambience ? { ambience: meta.ambience } : {}),
      ...(meta.modifiers ? { modifiers: meta.modifiers } : {}),
      tiles: this.g.map(r => r.join('')),
    };
    // stall clearance (the sh17 'shop does not respond' fix): relocate any
    // 'S' inside 2.5 tiles of structure work, then resync the working grid
    if (repairStallClearance(def)) this.g = def.tiles.map(r => r.split(''));
    this.validate(def);
    return def;
  }

  tileCount(def, ch) { return def.tiles.reduce((n, r) => n + (r.split(ch).length - 1), 0); }

  validate(def) {
    const F = m => this.fail(m);
    // grid sanity + legal letters
    if (def.tiles.length !== this.H) F('row count');
    for (const r of def.tiles) {
      if (r.length !== this.W) F('row width');
      for (const c of r) if (!LEGAL_TILES.has(c)) F(`illegal tile '${c}'`);
    }
    if (this.tileCount(def, 'E')) F('stronghold maps carry no exit');
    // stronghold block accounting
    const sh = def.stronghold, b = def.bastion;
    const wpn = Math.max(1, Math.min(3, b.wavesPerNight || 1));
    // truthful accounting: every wave of a blood-moon night pours from two
    // edges (the second a 60% detachment) — each moon night adds wpn waves
    if (sh.waves !== b.nights * wpn + (b.bloodMoons || []).length * wpn)
      F(`waves ${sh.waves} != nights ${b.nights} x ${wpn} + ${(b.bloodMoons || []).length} moons x ${wpn}`);
    for (const m of b.bloodMoons || []) if (m < 1 || m > b.nights) F(`blood moon night ${m} outside 1..${b.nights}`);
    if (b.waveMult !== undefined && (b.waveMult < 1 || b.waveMult > 2.6)) F('waveMult out of 1..2.6');
    if (sh.hpMult !== undefined && (sh.hpMult < 1 || sh.hpMult > 2)) F('hpMult out of 1..2');
    if (!['S', 'M', 'L', 'XL'].includes(sh.sizeLabel)) F('sizeLabel');
    if (!Number.isInteger(sh.difficulty) || sh.difficulty < 1 || sh.difficulty > 5) F('difficulty');
    if (sh.unlock !== undefined && !CHAR_IDS.has(sh.unlock)) F(`unlock '${sh.unlock}'`);
    if (!sh.blurb || !Array.isArray(sh.newFeatures)) F('blurb/newFeatures');
    for (const s of [...(def.intro || []), ...(def.outro || [])]) {
      if (!s.title || !Array.isArray(s.lines) || s.lines.length < 1 || s.lines.length > 3) F('slide shape');
      if (!ART_KEYS.has(s.art)) F(`slide art '${s.art}'`);
    }
    if (!def.intro || !def.intro.length) F('intro required');
    // K accounting
    const ks = this.tileCount(def, 'K');
    if (def.bastionVariant === 'beacons' ? ks !== 4 : ks !== 1) F(`K count ${ks} for variant '${def.bastionVariant || 'core'}'`);
    // row-major def arrays match their tiles
    const counts = [['B', def.builds], ['C', def.chests], ['V', def.vehicles], ['H', def.hires],
      ['N', def.npcs || []], ['A', def.pickups || []], ['I', def.qitems || []],
      ['Q', def.switches || []], ['J', def.glyphs || []], ['O', def.teleports || []]];
    for (const [ch, arr] of counts)
      if (this.tileCount(def, ch) !== arr.length) F(`'${ch}' tiles ${this.tileCount(def, ch)} != def entries ${arr.length}`);
    for (const bd of def.builds) {
      if (!BUILD_KINDS.has(bd.kind)) F(`build kind '${bd.kind}'`);
      if (typeof bd.cost !== 'number' || bd.cost < 0) F('build cost');
    }
    if (this.spawns.length < 4) F('needs 4 spawns');
    // stall clearance >= 2.5 tiles from any build site/tower (sim test mirror)
    def.tiles.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] !== 'S') continue;
        def.tiles.forEach((row2, y2) => {
          for (let x2 = 0; x2 < row2.length; x2++) {
            if ((row2[x2] === 'B' || row2[x2] === 'W') && Math.hypot(x2 - x, y2 - y) < 2.5)
              F(`stall (${x},${y}) ${Math.hypot(x2 - x, y2 - y).toFixed(2)} tiles from work (${x2},${y2})`);
          }
        });
      }
    });
    if (!this.enemySpots.length) F('needs map enemies');
    // quests
    for (const q of def.quests || []) {
      if (!QUEST_KINDS.has(q.kind)) F(`quest kind '${q.kind}'`);
      if (!q.id || !q.title) F('quest id/title');
      if (!(def.npcs || []).some(n => n.id === q.giver)) F(`quest giver '${q.giver}'`);
      if (q.kind === 'fetch' && !(def.qitems || []).some(it => (it.kind || 'fragment') === q.item)) F(`fetch item '${q.item}'`);
      if (q.reward && q.reward.openDoor && !(def.doors || []).some((d, i) => (d.id || 'door' + i) === q.reward.openDoor)) F('phantom openDoor');
    }
    for (const sg of def.switchGroups || []) {
      const members = (def.switches || []).filter(s => (s.group ?? 0) === (sg.group ?? 0)).length;
      if ((sg.need || 1) > members) F(`switch group need ${sg.need} > ${members}`);
      if (sg.reward && sg.reward.openDoor && !(def.doors || []).some((d, i) => (d.id || 'door' + i) === sg.reward.openDoor)) F('phantom quorum openDoor');
    }
    // teleport twins
    for (const t of def.teleports || [])
      if (t.twin != null && !def.teleports.some(o => o.id === t.twin)) F(`teleport twin '${t.twin}'`);
    // doors cover walkable floor
    for (const d of def.doors || []) {
      for (let yy = d.y; yy < d.y + (d.h || 1); yy++)
        for (let xx = d.x; xx < d.x + (d.w || 1); xx++)
          if (WALK_BLOCK.has(this.get(xx, yy))) F(`door '${d.id}' over blocked tile ${xx},${yy}`);
    }
    // patrols + groups bind to real enemies
    const enemyAt = (x, y) => ENEMY_LETTERS.includes(this.get(x, y));
    for (const pd of def.patrols || []) {
      if (!enemyAt(pd.at[0], pd.at[1])) F(`patrol home ${pd.at} has no enemy`);
      if (pd.points.length < 2 || pd.points.length > 4) F('patrol point count');
      for (const [px, py] of pd.points) {
        if (Math.hypot(px - pd.at[0], py - pd.at[1]) > 6.5) F(`patrol point ${px},${py} too far from ${pd.at}`);
        const c = this.get(px, py);
        if (WALK_BLOCK.has(c) || c === '!') F(`patrol point ${px},${py} not walkable`);
      }
    }
    for (const camp of def.groups || [])
      for (const [x, y] of camp) if (!enemyAt(x, y)) F(`group member ${x},${y} has no enemy`);
    // connectivity: BFS from spawn 0 (validator semantics: doors are floor)
    const pass = this.walkPass();
    const R = this.reach(this.spawns[0][0], this.spawns[0][1], pass);
    // teleports extend reach exactly like the test validator
    for (let it = 0; it <= (def.teleports || []).length; it++) {
      let changed = false;
      for (const t of this.teleports) {
        if (!R[t.y][t.x]) continue;
        const twinP = this.teleports.find(o => o.def.id === t.def.twin);
        if (twinP && !R[twinP.y][twinP.x]) {
          const R2 = this.reach(twinP.x, twinP.y, pass);
          for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) if (R2[y][x]) R[y][x] = true;
          changed = true;
        }
      }
      if (!changed) break;
    }
    const mustReach = [];
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++) {
        const c = this.get(x, y);
        if ('PNBKVWSHYAIQJXZO'.includes(c) || ENEMY_LETTERS.includes(c)) mustReach.push([x, y, c]);
      }
    for (const [x, y, c] of mustReach)
      if (!R[y][x]) F(`'${c}' at ${x},${y} unreachable from spawn`);
    // chests: afoot, or by sea from a walk-reachable skiff
    const sea = R.map(r => r.slice());
    const sq = [];
    for (const v of this.vehicles) if (v.def.kind === 'skiff' && R[v.y][v.x]) sq.push([v.x, v.y]);
    while (sq.length) {
      const [x, y] = sq.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!this.in(nx, ny) || sea[ny][nx]) continue;
        const c = this.get(nx, ny);
        if (c === '~' || pass(c)) { sea[ny][nx] = true; sq.push([nx, ny]); }
      }
    }
    for (const c of this.chests) {
      if (!sea[c.y][c.x]) F(`chest at ${c.x},${c.y} unreachable afoot and by skiff`);
      if (c.isle && R[c.y][c.x]) F(`island chest at ${c.x},${c.y} walk-reachable — the water leaks`);
    }
    // wave inlets: every cardinal edge offers candidates and ALL of them
    // march to a beacon/core without lava (A* legality) or closed doors
    const doorBlocked = (x, y) => (def.doors || []).some(d => !d.open
      && x >= d.x && x < d.x + (d.w || 1) && y >= d.y && y < d.y + (d.h || 1));
    const epass = c => !WALK_BLOCK.has(c) && c !== '!';
    const [k0x, k0y] = this.cores[0];
    const ER = this.reach(k0x, k0y, epass);
    // strike door rects from the enemy flood (cheap post-filter: a candidate
    // inside or beyond a closed door would still show reachable, so instead
    // verify no closed door tile was needed: re-flood with doors blocked)
    const ER2 = (def.doors || []).length
      ? (() => {
          const seen = Array.from({ length: this.H }, () => Array(this.W).fill(false));
          const q = [[k0x, k0y]];
          seen[k0y][k0x] = true;
          while (q.length) {
            const [x, y] = q.pop();
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = x + dx, ny = y + dy;
              if (this.in(nx, ny) && !seen[ny][nx] && epass(this.get(nx, ny)) && !doorBlocked(nx, ny)) {
                seen[ny][nx] = true;
                q.push([nx, ny]);
              }
            }
          }
          return seen;
        })()
      : ER;
    for (const edge of ['n', 'e', 's', 'w']) {
      const cands = this.edgeCandidates(edge);
      if (cands.length < 3) F(`edge '${edge}' offers only ${cands.length} wave entries`);
      for (const [x, y] of cands)
        if (!ER2[y][x]) F(`edge '${edge}' wave entry ${x},${y} cannot march to the core`);
    }
    // every core must be walk-reachable too (checked above via 'K'? K is not
    // in mustReach letters — add explicitly)
    for (const [x, y] of this.cores) if (!R[y][x]) F(`core at ${x},${y} unreachable`);
  }

}

// hire crews (names are fixed per level — deterministic flavor)
const CREWS = {
  sh09: [
    { job: 'farmer', cost: 8, name: 'Cinder Maev' },
    { job: 'engineer', cost: 10, name: 'Socket Brann' },
    { job: 'smith', cost: 12, name: 'Anvil Dree' },
    { job: 'hound', cost: 10, name: 'Ashjaw' },
    { job: 'archer', cost: 12, name: 'Flint Serra' },
  ],
  sh10: [
    { job: 'farmer', cost: 8, name: 'Rainward Polla' },
    { job: 'engineer', cost: 10, name: 'Coilwright Hess' },
    { job: 'smith', cost: 12, name: 'Stormbrand Ode' },
    { job: 'caster', cost: 14, name: 'Galewitch Imra' },
    { job: 'archer', cost: 12, name: 'Wetfletch Roun' },
  ],
  sh11: [
    { job: 'farmer', cost: 8, name: 'Tidemarsh Bela' },
    { job: 'engineer', cost: 10, name: 'Bilge Hark' },
    { job: 'smith', cost: 12, name: 'Saltforge Nim' },
    { job: 'hound', cost: 10, name: 'Reedfang' },
  ],
  sh12: [
    { job: 'farmer', cost: 8, name: 'Westwing Sel' },
    { job: 'engineer', cost: 10, name: 'Mirrorwright Cobb' },
    { job: 'smith', cost: 12, name: 'Twinhammer Lo' },
    { job: 'hound', cost: 10, name: 'Eastfang' },
    { job: 'archer', cost: 12, name: 'Forkeye Dunn' },
  ],
  sh13: [
    { job: 'farmer', cost: 8, name: 'Cindersow Reza' },
    { job: 'engineer', cost: 10, name: 'Basalt Wexx' },
    { job: 'smith', cost: 12, name: 'Magmara Holt' },
    { job: 'caster', cost: 14, name: 'Emberveil Sou' },
    { job: 'archer', cost: 12, name: 'Slagshot Pell' },
  ],
  sh14: [
    { job: 'farmer', cost: 8, name: 'Frostfurrow Ann' },
    { job: 'engineer', cost: 10, name: 'Icewright Toln' },
    { job: 'smith', cost: 12, name: 'Coldanvil Bryn' },
    { job: 'hound', cost: 10, name: 'Palefang' },
    { job: 'archer', cost: 12, name: 'Drift Arrow Kee' },
  ],
  sh15: [
    { job: 'farmer', cost: 8, name: 'Voidsow Petra' },
    { job: 'engineer', cost: 10, name: 'Shardwright Gil' },
    { job: 'smith', cost: 12, name: 'Sealsmith Vance' },
    { job: 'caster', cost: 14, name: 'Watchveil Suri' },
    { job: 'archer', cost: 12, name: 'Stillshot Marn' },
  ],
  sh16: [
    { job: 'farmer', cost: 8, name: 'Dunesow Calla' },
    { job: 'engineer', cost: 10, name: 'Glasswright Tev' },
    { job: 'smith', cost: 12, name: 'Saltanvil Rook' },
    { job: 'hound', cost: 10, name: 'Sandfang' },
    { job: 'archer', cost: 12, name: 'Lagoon-eye Fenn' },
  ],
  sh17: [
    { job: 'farmer', cost: 8, name: 'Northsow Edda' },
    { job: 'engineer', cost: 10, name: 'Gatewright Omm' },
    { job: 'smith', cost: 12, name: 'Twinforge Ralla' },
    { job: 'farmer', cost: 8, name: 'Southsow Imm' },
    { job: 'engineer', cost: 10, name: 'Wallwright Dask' },
    { job: 'archer', cost: 12, name: 'Waistroad Venn' },
  ],
};

// ===========================================================================
// sh09 'Ash Quorum' — 96x70 L caldera. Quorum relays spice (3-of-5 inside a
// window), Null Acolytes debut in the camps, toxic air until the masks come
// off the shelves. Border: a mountain ring; the silhouette is the crater.
// ===========================================================================
function genSh09() {
  const W = 96, H = 70;
  const L = new Lvl('sh09', 'Ash Quorum', W, H, 20260709);
  const CX = 48, CY = 35;
  const crater = L.organic(CX, CY, 44, 31, 0.12);
  L.border(crater, '#');
  L.rim();
  // crater texture: scattered rock + ash drifts painted late
  for (let i = 0; i < 30; i++) L.blob(8 + L.rnd() * 80, 6 + L.rnd() * 58, 1.2 + L.rnd() * 2.2, '#', 0.7);
  // four gorges through the ring (wave inlets), carved from depth 1 inward
  L.carve([[48, 1], [47, 10], [48, 20]], 2);
  L.carve([[46, H - 2], [48, H - 10], [47, H - 18]], 2);
  L.carve([[1, 36], [10, 35], [20, 35]], 2);
  L.carve([[W - 2, 34], [W - 10, 35], [W - 18, 34]], 2);

  // the bastion: center crater floor
  const x0 = CX - 10, y0 = CY - 7, x1 = CX + 10, y1 = CY + 7;
  const { cx, cy } = L.fortress(x0, y0, x1, y1);
  L.standardInterior(cx, cy, x0, y0, x1, y1, { hires: CREWS.sh09 });
  // gate turret sites + lane turrets
  for (const [tx, ty] of [[cx - 3, y0 + 2], [cx + 2, y0 + 2], [cx - 3, y1 - 2], [cx + 2, y1 - 2], [x0 + 2, cy], [x1 - 2, cy]])
    L.build('turret', 10, tx, ty);
  // quest giver: the Quorum Keeper by the north gate
  L.npc(cx + 2, y0 + 4, {
    id: 'keeper-ashlin', name: 'Quorum Keeper Ashlin',
    lines: [
      'The crater relays still answer — three lit together inside half a minute and the old grid pays out.',
      'The Null choir chants in the ash. Cut four acolytes out of it and the camps go quiet.',
      'Breathe through a mask until the vents clear. The ash eats lungs faster than husks eat walls.',
    ],
  });
  L.quests.push(
    { id: 'quorum', main: true, title: 'Light a 3-of-5 relay quorum', giver: 'keeper-ashlin', kind: 'switch', target: '0', count: 1, reward: { shards: 16 }, hint: 'Five relays ring the crater. Any three, lit inside the window, settle the quorum.' },
    { id: 'null-choir', title: 'Cull the Null choir', giver: 'keeper-ashlin', kind: 'kill', target: 'q', count: 4, reward: { shards: 12 }, hint: 'The acolytes mend and shield their packs. Silence four and the ash sings alone.' },
  );
  // five relays on knolls around the ring (group 0), 3-of-5 quorum
  const R0 = L.reach(cx, cy - 4, L.walkPass());
  const relayAngles = [-0.45 * Math.PI, -0.05 * Math.PI, 0.35 * Math.PI, 0.75 * Math.PI, 1.15 * Math.PI];
  relayAngles.forEach((th, i) => {
    const fx = Math.round(CX + Math.cos(th) * 30), fy = Math.round(CY + Math.sin(th) * 22);
    const s = L.nudge(fx, fy, (x, y) => R0[y][x], 12);
    if (!s) L.fail(`no relay knoll near ${fx},${fy}`);
    L.relay(s[0], s[1], 'relay-' + i, 0);
  });
  L.switchGroups.push({ group: 0, need: 3, of: 5, window: 30, reward: { shards: 16 } });

  const R = L.reach(cx, cy - 4, L.walkPass());
  const wallDist = (x, y) => Math.max(Math.max(x0 - x, x - x1, 0), Math.max(y0 - y, y - y1, 0));
  const far = (x, y) => R[y][x] && wallDist(x, y) >= 10;
  // camps: the Null choir debuts (q acolytes), heavies southeast
  L.camp(22, 14, 'qqzzn', { ok: far });        // NW choir + spotter
  L.camp(72, 12, 'qzzw', { ok: far });         // NE choir
  L.camp(16, 52, 'ggar', { ok: far });         // SW grunt line
  L.camp(74, 54, 'ssanr', { ok: far });        // SE heavies + spotter
  L.camp(58, 60, 'zzzww', { ok: far });        // S husk swarm
  L.camp(36, 8, 'mga', { ok: far, patrolN: 1 }); // N brood nest
  L.sentry('n', 8, 35, far);
  L.sentry('a', 86, 36, far);

  // chests: masks first (the toxic-air answer), then the staples
  const chestPlan = [
    [40, 12, 'mask', 1], [58, 56, 'mask', 1],
    [12, 24, 'shards', 8], [82, 22, 'shards', 9], [20, 44, 'cracker', 2],
    [70, 44, 'medkit', 1], [50, 8, 'shield', 1], [30, 60, 'toxin', 1],
    [84, 48, 'token', 1], [10, 44, 'controller', 1], [62, 26, 'shards', 7],
  ];
  for (const [fx, fy, loot, amount] of chestPlan) {
    const s = L.nudge(fx, fy, (x, y) => R[y][x], 12);
    if (!s) L.fail(`no chest spot near ${fx},${fy}`);
    L.chest(s[0], s[1], loot, amount);
  }
  for (const [fx, fy] of [[48, 24], [47, 50], [28, 35], [66, 34], [24, 22], [70, 20], [26, 50], [70, 50], [48, 5], [48, 64], [6, 36], [88, 34], [38, 28]])
    L.crystal(fx, fy, (x, y) => R[y][x]);

  // ash floors last: drifts of '_' with stone ';' near the rim, dirt seams
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      if (L.get(x, y) !== '.') continue;
      if (wallDist(x, y) <= 3) continue; // the apron stays bare killing ground
      const r = Math.hypot((x - CX) / 44, (y - CY) / 31);
      if (r > 0.82 && L.rnd() < 0.7) { L.set(x, y, ';'); continue; }
      if (L.rnd() < 0.55) L.set(x, y, '_');
      else if (L.rnd() < 0.1) L.set(x, y, ':');
    }

  return L.assemble({
    objective: 'Hold the crater bastion for six nights — and light a 3-of-5 relay quorum to wake the old grid',
    bastion: { nights: 6, dayLen: 85, nightLen: 80, bloodMoons: [5], wavesPerNight: 2, waveMult: 1.53 },
    stronghold: {
      level: 9, name: 'Ash Quorum', sizeLabel: 'L', difficulty: 3, waves: 14, hpMult: 1.27,
      blurb: 'A dead caldera, five relays, and a choir of Null Acolytes in the ash. Mask up before the vents clear.',
      newFeatures: ['Relay quorum objective', 'Null Acolytes in the camps', 'Toxic air + breather masks'],
    },
    intro: [{
      title: 'Ash Quorum',
      lines: [
        'A relay quorum sleeps under the ash — three of five lit together wakes its pay.',
        'The air itself is hostile until the vents clear: buy masks, then breathe.',
        'Acolyte choirs mend the camps. Kill the singers first.',
      ],
      art: 'quorum',
    }],
    weather: 'ashstorm',
    ambience: 'ash',
    modifiers: { toxicAir: { until: 150 } },
  });
}

// ===========================================================================
// sh10 'Stormfield' — 96x70 L rain-lashed meadow lens ringed by deep forest.
// Volt unlocks here. Tesla-favoring: tight twin turret clusters at the gates
// plus one PREBUILT tesla turret. Pre-wave quest: raise the storm mast.
// ===========================================================================
function genSh10() {
  const W = 96, H = 70;
  const L = new Lvl('sh10', 'Stormfield', W, H, 20260710);
  const lens = L.organic(48, 35, 45, 30, 0.1);
  L.border(lens, 'T');
  L.rim();
  // forest copses drifting into the field
  for (let i = 0; i < 22; i++) L.blob(8 + L.rnd() * 80, 6 + L.rnd() * 58, 1.3 + L.rnd() * 2.0, 'T', 0.65);
  for (let i = 0; i < 8; i++) L.blob(8 + L.rnd() * 80, 6 + L.rnd() * 58, 1.0 + L.rnd() * 1.6, '#', 0.6);
  // two brooks running north-south, three fords each
  L.carve([[30, 1], [27, 14], [32, 28], [28, 44], [33, 58], [30, 68]], 1, '~');
  L.carve([[64, 1], [67, 12], [62, 26], [66, 42], [61, 56], [65, 68]], 1, '~');
  for (const [bx, by] of [[28, 10], [30, 32], [31, 52], [66, 8], [64, 30], [63, 50]])
    L.carve([[bx - 3, by], [bx + 3, by]], 1, ':'); // mud fords
  // meadow inlets through the treeline (wave entries on all four edges)
  L.carve([[46, 1], [48, 8], [47, 16]], 2);
  L.carve([[50, H - 2], [48, H - 8], [49, H - 16]], 2);
  L.carve([[1, 34], [8, 35], [16, 34]], 2);
  L.carve([[W - 2, 36], [W - 8, 35], [W - 16, 36]], 2);

  const x0 = 38, y0 = 28, x1 = 58, y1 = 42;
  const { cx, cy } = L.fortress(x0, y0, x1, y1);
  L.standardInterior(cx, cy, x0, y0, x1, y1, { hires: CREWS.sh10 });
  // tesla-favoring clusters: twin pairs hugging both 2-wide gates, one
  // prebuilt tesla already humming on the north approach
  L.build('turret', 10, cx - 3, y0 + 2, { prebuilt: true, ttype: 'tesla' });
  for (const [tx, ty] of [[cx + 2, y0 + 2], [cx - 3, y1 - 2], [cx + 2, y1 - 2], [x0 + 2, cy], [x1 - 2, cy]])
    L.build('turret', 10, tx, ty);
  // the storm mast: a dead comm tower on a knoll across the west brook
  L.build('comm', 8, 22, 30);
  L.npc(cx + 2, y0 + 4, {
    id: 'signal-warden', name: 'Signal Warden Tale',
    lines: [
      'The mast across the west brook went dark in the first storm. Raise it and the relief column hears us.',
      'Rain kills fire. Lightning loves a crowd — the tesla coils do too.',
      'Volt walked out of the LYTH fields three storms back. Hold the field and she holds with you.',
    ],
  });
  L.quests.push(
    { id: 'storm-mast', main: true, title: 'Raise the storm mast', giver: 'signal-warden', kind: 'build', target: 'comm', count: 1, reward: { shards: 14 }, hint: 'The dead mast stands on the knoll across the west brook. Shards and an act-hold raise it.' },
    { id: 'wraith-count', title: 'Ground four Volt Wraiths', giver: 'signal-warden', kind: 'kill', target: 'v', count: 4, reward: { shards: 12 }, hint: 'The wraiths ride the storm. Grounding four thins the charge.' },
  );

  const R = L.reach(cx, cy - 4, L.walkPass());
  const wallDist = (x, y) => Math.max(Math.max(x0 - x, x - x1, 0), Math.max(y0 - y, y - y1, 0));
  const far = (x, y) => R[y][x] && wallDist(x, y) >= 10;
  L.camp(76, 20, 'vvzz', { ok: far });          // NE wraith storm-camp
  L.camp(70, 56, 'vgga', { ok: far });          // SE wraiths with muscle
  L.camp(18, 14, 'sran', { ok: far });          // NW heavy line + spotter
  L.camp(14, 52, 'wwwz', { ok: far });          // SW skitter ambush
  L.camp(48, 60, 'zzzwg', { ok: far });         // S husk swarm on the lane
  L.camp(40, 10, 'mqa', { ok: far, patrolN: 1 }); // N brood nest with a mender
  L.sentry('n', 8, 30, far);
  L.sentry('n', 88, 44, far);
  L.sentry('a', 50, 6, far);

  const chestPlan = [
    [20, 26, 'shards', 8], [12, 38, 'medkit', 1], [24, 58, 'cracker', 2],
    [44, 8, 'shield', 1], [78, 10, 'shards', 9], [86, 32, 'token', 1],
    [76, 48, 'medkit', 1], [56, 62, 'toxin', 1], [36, 18, 'controller', 1],
    [68, 26, 'shards', 7], [10, 16, 'cracker', 2],
  ];
  for (const [fx, fy, loot, amount] of chestPlan) {
    const s = L.nudge(fx, fy, (x, y) => R[y][x], 12);
    if (!s) L.fail(`no chest spot near ${fx},${fy}`);
    L.chest(s[0], s[1], loot, amount);
  }
  const s = L.nudge(82, 6, (x, y) => R[y][x], 10);
  if (!s) L.fail('no stormgun knoll');
  L.pickup(s[0], s[1], 'stormgun');
  for (const [fx, fy] of [[26, 20], [70, 16], [22, 44], [74, 40], [48, 12], [47, 58], [10, 34], [86, 36], [34, 50], [60, 20], [40, 64], [58, 8], [16, 62]])
    L.crystal(fx, fy, (x, y) => R[y][x]);

  // meadow floors: grass with mud near the brooks
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      if (L.get(x, y) !== '.') continue;
      if (wallDist(x, y) <= 3) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => L.get(x + dx, y + dy) === '~')) { L.set(x, y, ':'); continue; }
      if (L.rnd() < 0.5) L.set(x, y, ',');
    }

  return L.assemble({
    objective: 'Hold the stormfield for six nights — raise the storm mast so the relief column hears the hold',
    bastion: { nights: 6, dayLen: 85, nightLen: 80, bloodMoons: [4, 6], wavesPerNight: 2, waveMult: 1.6 },
    stronghold: {
      level: 10, name: 'Stormfield', sizeLabel: 'L', difficulty: 3, waves: 16, hpMult: 1.3, unlock: 'volt',
      blurb: 'A rain-lashed meadow under a dead mast. Lightning favors the coils — and so does the storm her people named Volt.',
      newFeatures: ['Volt joins the roster', 'Prebuilt tesla turret', 'Rain (burn patches die fast)'],
    },
    intro: [{
      title: 'Stormfield',
      lines: [
        'The mast is dead, the brooks are rising, and the waves come with the dusk.',
        'Rain drowns fire fast — let the tesla coils do the crowd work.',
        'Raise the storm mast and Volt answers the signal.',
      ],
      art: 'siege',
    }],
    weather: 'rain',
    ambience: 'meadow',
  });
}

// ===========================================================================
// sh11 'The Drowned Ring' — 96x70 L atoll. BEACON-DEFENSE VARIANT: four
// monoliths on a ring island, a moat with four causeways, an outer reef the
// waves land on, and a lagoon islet only a skiff can rob.
// ===========================================================================
function genSh11() {
  const W = 96, H = 70;
  const L = new Lvl('sh11', 'The Drowned Ring', W, H, 20260711);
  const CX = 48, CY = 35;
  const wob = (() => { const p = L.rnd() * Math.PI * 2; return th => 1 + 0.05 * Math.sin(3 * th + p); })();
  const rr = (x, y) => {
    const dx = x - CX, dy = (y - CY) * 1.3;
    return Math.hypot(dx, dy) / wob(Math.atan2(dy, dx));
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const r = rr(x, y);
      if (r <= 4.2) L.set(x, y, '.');        // treasure islet
      else if (r <= 13) L.set(x, y, '~');    // lagoon
      else if (r <= 21) L.set(x, y, '.');    // beacon ring island
      else if (r <= 26) L.set(x, y, '~');    // moat
      else if (r <= 31.5) L.set(x, y, '.');  // outer reef
      else L.set(x, y, '~');                 // open sea to every edge
    }
  // four causeways across the moat, four beach spits across the sea
  for (const th of [-Math.PI / 2, 0, Math.PI / 2, Math.PI]) {
    const p0 = [Math.round(CX + Math.cos(th) * 19), Math.round(CY + Math.sin(th) * 19 / 1.3)];
    const p1 = [Math.round(CX + Math.cos(th) * 28), Math.round(CY + Math.sin(th) * 28 / 1.3)];
    L.carve([p0, p1], 1, ':');
  }
  L.carve([[48, 1], [48, Math.round(CY - 29 / 1.3)]], 1, ':');     // N spit
  L.carve([[48, H - 2], [48, Math.round(CY + 29 / 1.3)]], 1, ':'); // S spit
  L.carve([[1, 35], [CX - 29, 35]], 1, ':');                       // W spit
  L.carve([[W - 2, 35], [CX + 29, 35]], 1, ':');                   // E spit

  // four beacon monoliths at the ring's compass points, each in a wall pocket
  // (prebuilt segments open toward the ring road, barricade across the gap)
  const beacons = [[48, 22, 'n'], [65, 35, 'e'], [48, 48, 's'], [31, 35, 'w']];
  for (const [bx, by, side] of beacons) {
    L.core(bx, by);
    const out = side === 'n' ? [0, -1] : side === 's' ? [0, 1] : side === 'e' ? [1, 0] : [-1, 0];
    const lat = side === 'n' || side === 's' ? [1, 0] : [0, 1];
    // a C of five wall segments facing the causeway, gap barricaded
    const cells = [
      [bx + out[0] * 2 - lat[0], by + out[1] * 2 - lat[1]],
      [bx + out[0] * 2 + lat[0], by + out[1] * 2 + lat[1]],
      [bx + out[0] * 2 - 2 * lat[0], by + out[1] * 2 - 2 * lat[1]],
      [bx + out[0] * 2 + 2 * lat[0], by + out[1] * 2 + 2 * lat[1]],
    ];
    for (const [wx, wy] of cells) L.build('wall', 5, wx, wy, { prebuilt: true });
    L.build('barricade', 4, bx + out[0] * 2, by + out[1] * 2);
    L.build('turret', 10, bx - out[0] + lat[0] * 2, by - out[1] + lat[1] * 2);
  }
  // the commons: ring island south-east arc — spawns, shop, posts, farms.
  // Everything is laid along the island band by polar walk + nudge.
  const ringOk = (x, y) => rr(x, y) > 13.8 && rr(x, y) < 20.2;
  const ringSpot = (th, r = 17) => [Math.round(CX + Math.cos(th) * r), Math.round(CY + Math.sin(th) * r / 1.3)];
  const put = (th, r, fn) => {
    const [fx, fy] = ringSpot(th, r);
    const sp = L.nudge(fx, fy, ringOk, 6);
    if (!sp) L.fail(`no ring spot at th=${th.toFixed(2)}`);
    fn(sp[0], sp[1]);
    return sp;
  };
  put(0.30 * Math.PI, 15.5, (x, y) => L.spawn(x, y));
  put(0.36 * Math.PI, 15.5, (x, y) => L.spawn(x, y));
  put(0.30 * Math.PI, 18.5, (x, y) => L.spawn(x, y));
  put(0.36 * Math.PI, 18.5, (x, y) => L.spawn(x, y));
  put(0.24 * Math.PI, 17, (x, y) => L.shop(x, y));
  put(0.33 * Math.PI, 17, (x, y) => L.fire(x, y));
  const crew = CREWS.sh11.slice();
  for (const th of [0.42, 0.47, 0.52, 0.57]) {
    const h = crew.shift();
    put(th * Math.PI, 17, (x, y) => L.hire(x, y, h.job, h.cost, h.name));
  }
  for (const th of [0.62, 0.66, 0.70, 0.74]) put(th * Math.PI, 17, (x, y) => L.build('farm', 6, x, y));
  put(0.18 * Math.PI, 17, (x, y) => L.tower(x, y));
  put(0.80 * Math.PI, 17, (x, y) => L.tower(x, y));
  put(-0.30 * Math.PI, 17, (x, y) => L.tower(x, y));
  put(-0.75 * Math.PI, 17, (x, y) => L.tower(x, y));
  // ring-road turret sites between the beacons, and one barricade site at
  // each causeway's center so the chokes can be corked
  for (const th of [0.25, 0.75, 1.25, 1.75]) put(th * Math.PI, 17, (x, y) => L.build('turret', 10, x, y));
  for (const th of [0, 0.5, 1, 1.5]) {
    const [fx, fy] = ringSpot(th * Math.PI, 23);
    const sp = L.nudge(fx, fy, (x, y) => rr(x, y) > 21.5 && rr(x, y) < 25.5, 5);
    if (!sp) L.fail(`no causeway barricade spot at th=${th}`);
    L.build('barricade', 4, sp[0], sp[1]);
  }
  // skiffs: one moored on the lagoon shore (the treasure run), one on the
  // outer reef shore (flank the sea)
  const [ldx, ldy] = ringSpot(0.28 * Math.PI, 14);
  const lagoonDock = L.nudge(ldx, ldy, (x, y) => ringOk(x, y)
    && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => L.get(x + dx, y + dy) === '~' && rr(x + dx, y + dy) <= 13), 8);
  if (!lagoonDock) L.fail('no lagoon dock');
  L.vehicle('skiff', lagoonDock[0], lagoonDock[1]);
  const seaDock = L.nudge(70, 50, (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => L.get(x + dx, y + dy) === '~' && rr(x + dx, y + dy) > 26), 10);
  if (!seaDock) L.fail('no sea dock');
  L.vehicle('skiff', seaDock[0], seaDock[1]);
  put(0.44 * Math.PI, 19.2, (x, y) => L.vehicle('stag', x, y));

  // reef camps: the ring is watching every causeway
  const R = L.reach(L.spawns[0][0], L.spawns[0][1], L.walkPass());
  const reefOk = (x, y) => R[y][x] && rr(x, y) > 26.5 && rr(x, y) < 31;
  L.camp(48, 9, 'uuzz', { ok: reefOk });        // N reef beetles
  L.camp(78, 25, 'qzzw', { ok: reefOk });       // NE reef choir
  L.camp(76, 47, 'ssn', { ok: reefOk });        // SE reef heavies + spotter
  L.camp(48, 62, 'ggar', { ok: reefOk });       // S reef line
  L.camp(18, 45, 'wwzz', { ok: reefOk });       // SW reef swarm
  L.camp(17, 24, 'rnga', { ok: reefOk });       // NW reef watch
  L.sentry('n', 19, 35, reefOk);
  L.sentry('a', 77, 35, reefOk);

  // chests: reef staples + the lagoon islet hoard (skiff-only)
  const reefChests = [
    [30, 12, 'shards', 8], [66, 10, 'medkit', 1], [88, 28, 'cracker', 2],
    [84, 44, 'shards', 9], [62, 60, 'shield', 1], [30, 58, 'toxin', 1],
    [10, 42, 'shards', 7], [8, 26, 'controller', 1],
  ];
  for (const [fx, fy, loot, amount] of reefChests) {
    const sp = L.nudge(fx, fy, reefOk, 12);
    if (!sp) L.fail(`no reef chest near ${fx},${fy}`);
    L.chest(sp[0], sp[1], loot, amount);
  }
  for (const [ox, oy, loot, amount] of [[-1, -1, 'token', 1], [1, 0, 'shards', 12], [0, 2, 'shield', 1]]) {
    const x = CX + ox, y = CY + oy;
    if (rr(x, y) > 4.2) L.fail(`islet chest off the islet ${x},${y}`);
    L.chest(x, y, loot, amount, true);
  }
  for (const [fx, fy] of [[48, 27], [48, 43], [56, 35], [40, 35], [48, 4], [48, 66], [5, 35], [90, 35], [70, 18], [26, 52], [24, 18], [72, 52]])
    L.crystal(fx, fy, (x, y) => R[y][x] && rr(x, y) <= 31.5);

  // shores get wet sand, the ring island greens over
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      if (L.get(x, y) !== '.') continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => L.get(x + dx, y + dy) === '~')) { L.set(x, y, ':'); continue; }
      const r = rr(x, y);
      if (r > 13 && r <= 21 && L.rnd() < 0.45) L.set(x, y, ',');
      else if (r > 26 && L.rnd() < 0.3) L.set(x, y, ':');
    }

  return L.assemble({
    objective: 'Keep at least one of the four drowned monoliths lit through seven nights — all four dark at once and the ring goes under',
    bastionVariant: 'beacons',
    bastion: { nights: 7, dayLen: 80, nightLen: 80, bloodMoons: [6], wavesPerNight: 2, waveMult: 1.67 },
    stronghold: {
      level: 11, name: 'The Drowned Ring', sizeLabel: 'L', difficulty: 4, waves: 16, hpMult: 1.33,
      blurb: 'Four monoliths on a drowned ring, four causeways, one skiff. Relight by day what the night puts out.',
      newFeatures: ['Four-beacon defense', 'Causeway chokepoints', 'Anchorcraft early extraction'],
    },
    intro: [{
      title: 'The Drowned Ring',
      lines: [
        'Four monoliths hold this atoll above the water — the waves split between every one still lit.',
        'A dark beacon is not a dead one: shards and daylight bring it back.',
        'Keep all four burning through a night and the Anchorcraft itself comes down for you.',
      ],
      art: 'basin',
    }],
    weather: 'rain',
    ambience: 'swamp',
  });
}

// ===========================================================================
// sh12 'Forked Hold' — 96x70 L butterfly. A MIRRORED base: twin walled wings
// either side of a river, the core on a holm between them. Boomer unlocks.
// Two of every approach — the defense must split like the hold does.
// ===========================================================================
function genSh12() {
  const W = 96, H = 70;
  const L = new Lvl('sh12', 'Forked Hold', W, H, 20260712);
  const west = L.organic(27, 35, 26, 28, 0.11);
  const east = L.organic(68, 35, 26, 28, 0.11);
  L.border((x, y) => west(x, y) || east(x, y), '#');
  L.rim();
  // forest fringe inside the rock line, copses in the wings
  for (let i = 0; i < 26; i++) L.blob(6 + L.rnd() * 84, 5 + L.rnd() * 60, 1.2 + L.rnd() * 2.0, 'T', 0.6);
  // the river: north-south between the wings, wobble kept off the walls
  L.carve([[48, 1], [47, 12], [49, 24], [48, 35], [47, 46], [49, 58], [48, 68]], 1, '~');
  // inlets through the border on all four edges
  L.carve([[27, 1], [27, 8], [28, 14]], 2);
  L.carve([[68, H - 2], [68, H - 8], [67, H - 14]], 2);
  L.carve([[1, 35], [8, 35], [14, 34]], 2);
  L.carve([[W - 2, 35], [W - 8, 35], [W - 16, 36]], 2);
  // stone bridges north and south of the hold, plus the core causeway
  L.carve([[42, 20], [54, 20]], 1, ';');
  L.carve([[42, 50], [54, 50]], 1, ';');

  // the mirrored wings (each a full fortress with gates on every face)
  const wWing = L.fortress(30, 28, 44, 42);
  const eWing = L.fortress(52, 28, 66, 42);
  // the holm: a stone island carved over the river, core at its heart;
  // the causeway threads west gate - holm - east gate (between the walls
  // only — the gate cells themselves are the wings' barricade sites)
  L.carve([[46, 35], [50, 35]], 1, ';');
  for (let y = 33; y <= 37; y++) for (let x = 46; x <= 50; x++) L.set(x, y, ';');
  L.core(48, 35);
  L.fire(48, 33); L.fire(48, 37);
  // wing interiors, mirrored: towers on the outer corners, a shop apiece
  for (const [tx, ty] of [[32, 30], [32, 40], [64, 30], [64, 40]]) L.tower(tx, ty);
  L.shop(37, 31);
  L.shop(59, 31);
  L.spawn(36, 34); L.spawn(38, 36); L.spawn(59, 34); L.spawn(57, 36);
  const crew = CREWS.sh12.slice();
  for (const [hx, hy] of [[34, 33], [34, 35], [34, 37]]) { const h = crew.shift(); L.hire(hx, hy, h.job, h.cost, h.name); }
  for (const [hx, hy] of [[62, 33], [62, 35]]) { const h = crew.shift(); L.hire(hx, hy, h.job, h.cost, h.name); }
  L.vehicle('stag', 40, 38);
  L.vehicle('stag', 56, 38);
  // turret sites mirrored around both wings' gates
  for (const [tx, ty] of [[35, 30], [39, 30], [35, 40], [39, 40], [57, 30], [61, 30], [57, 40], [61, 40]])
    L.build('turret', 10, tx, ty);
  for (const [fx, fy] of [[40, 32], [42, 32], [54, 32], [56, 32]]) L.build('farm', 6, fx, fy);

  const R = L.reach(36, 34, L.walkPass());
  const wallDist = (x, y) => Math.min(
    Math.max(Math.max(30 - x, x - 44, 0), Math.max(28 - y, y - 42, 0)),
    Math.max(Math.max(52 - x, x - 66, 0), Math.max(28 - y, y - 42, 0)));
  const far = (x, y) => R[y][x] && wallDist(x, y) >= 10;
  L.camp(14, 16, 'ffwz', { ok: far });            // NW alpha pack (they fork)
  L.camp(80, 16, 'ffzw', { ok: far });            // NE alpha pack, mirrored
  L.camp(12, 52, 'zzzzw', { ok: far });           // SW husk swarm
  L.camp(82, 54, 'ssrn', { ok: far });            // SE heavies + spotter
  L.camp(48, 10, 'mqz', { ok: far, patrolN: 1 }); // N riverhead nest
  L.camp(46, 60, 'vvga', { ok: far });            // S riverfoot wraiths
  L.sentry('n', 6, 34, far);
  L.sentry('n', 90, 36, far);
  L.sentry('a', 28, 62, far);

  const chestPlan = [
    [10, 24, 'shards', 8], [22, 8, 'cracker', 2], [40, 6, 'medkit', 1],
    [74, 6, 'shards', 9], [88, 26, 'shield', 1], [86, 46, 'medkit', 1],
    [70, 62, 'toxin', 1], [34, 62, 'cracker', 2], [8, 44, 'controller', 1],
    [56, 14, 'token', 1], [24, 46, 'shards', 7], [62, 56, 'shards', 8],
  ];
  for (const [fx, fy, loot, amount] of chestPlan) {
    const s = L.nudge(fx, fy, (x, y) => R[y][x], 12);
    if (!s) L.fail(`no chest spot near ${fx},${fy}`);
    L.chest(s[0], s[1], loot, amount);
  }
  const mort = L.nudge(82, 36, (x, y) => R[y][x], 10);
  if (!mort) L.fail('no mortar ruin spot');
  L.pickup(mort[0], mort[1], 'mortarMk2');
  for (const [fx, fy] of [[27, 20], [69, 20], [27, 50], [69, 50], [48, 16], [48, 54], [10, 35], [86, 35], [18, 36], [78, 36], [38, 12], [58, 58], [30, 56], [66, 12]])
    L.crystal(fx, fy, (x, y) => R[y][x]);

  // wing floors: needle grass west, ash-tinged east (the fork is uneven)
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      if (L.get(x, y) !== '.') continue;
      if (wallDist(x, y) <= 3) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => L.get(x + dx, y + dy) === '~')) { L.set(x, y, ':'); continue; }
      if (x < 48 && L.rnd() < 0.5) L.set(x, y, ',');
      else if (x >= 48 && L.rnd() < 0.4) L.set(x, y, '_');
    }

  return L.assemble({
    objective: 'Hold both wings of the forked hold for seven nights — the core on the holm must still stand at dawn',
    bastion: { nights: 7, dayLen: 85, nightLen: 80, bloodMoons: [4, 7], wavesPerNight: 2, waveMult: 1.73 },
    stronghold: {
      level: 12, name: 'Forked Hold', sizeLabel: 'L', difficulty: 4, waves: 18, hpMult: 1.37, unlock: 'boomer',
      blurb: 'Twin walled wings astride a river, one core on the holm between. Every approach comes in pairs.',
      newFeatures: ['Boomer joins the roster', 'Mirrored twin-wing base', 'Fork Alpha packs'],
    },
    intro: [{
      title: 'Forked Hold',
      lines: [
        'The hold split when the river did: two wings, two of every gate, one core on the holm.',
        'Whatever you wall on one bank, the night will test on the other.',
        'Boomer holds the west wing alone. Prove the east and he is yours.',
      ],
      art: 'forkfall',
    }],
    ambience: 'forest',
  });
}

// ===========================================================================
// sh13 'Lava Crossing' — 96x70 L volcanic flank. Two braided lava rivers cut
// the map into three ridges; stone bridges carry the marches, teleport pads
// carry YOU. Enemies path around the lava — it paths around nothing.
// ===========================================================================
function genSh13() {
  const W = 96, H = 70;
  const L = new Lvl('sh13', 'Lava Crossing', W, H, 20260713);
  const flank = L.organic(48, 35, 46, 32, 0.08);
  L.border(flank, '#');
  L.rim();
  for (let i = 0; i < 24; i++) L.blob(6 + L.rnd() * 84, 5 + L.rnd() * 60, 1.2 + L.rnd() * 2.2, '#', 0.65);
  // two braided lava rivers, north to south
  L.carve([[30, 1], [26, 12], [32, 24], [28, 38], [33, 52], [29, 68]], 1, '!');
  L.carve([[66, 1], [70, 10], [64, 24], [68, 40], [62, 54], [67, 68]], 1, '!');
  // lava pools off the rivers
  for (const [px, py, r] of [[14, 10, 2.2], [84, 14, 2.0], [12, 58, 2.2], [86, 56, 2.4], [48, 8, 1.6], [46, 62, 1.8]])
    L.blob(px, py, r, '!', 0.8);
  // three stone bridges per river (the only marches across)
  for (const y of [16, 35, 54]) {
    L.carve([[20, y], [40, y]], 1, ';');
    L.carve([[56, y], [76, y]], 1, ';');
  }
  // inlets: every edge gets a basalt road through the rock
  L.carve([[47, 1], [48, 8], [47, 14]], 2);
  L.carve([[49, H - 2], [48, H - 8], [49, H - 14]], 2);
  L.carve([[1, 35], [8, 35], [14, 35]], 2);
  L.carve([[W - 2, 35], [W - 8, 35], [W - 16, 35]], 2);

  const x0 = 38, y0 = 28, x1 = 58, y1 = 42;
  const { cx, cy } = L.fortress(x0, y0, x1, y1);
  L.standardInterior(cx, cy, x0, y0, x1, y1, { hires: CREWS.sh13 });
  for (const [tx, ty] of [[cx - 3, y0 + 2], [cx + 2, y0 + 2], [cx - 3, y1 - 2], [cx + 2, y1 - 2], [x0 + 2, cy], [x1 - 2, cy]])
    L.build('turret', 10, tx, ty);

  // teleport pads: west ridge <-> west yard, east ridge <-> east yard,
  // north forefield <-> south forefield. Pads are the players' shortcut —
  // the marches still have to take the bridges.
  const R0 = L.reach(cx, cy - 4, L.walkPass());
  const pad = (fx, fy, id, twin) => {
    const s = L.nudge(fx, fy, (x, y) => R0[y][x], 10);
    if (!s) L.fail(`no pad spot near ${fx},${fy}`);
    L.telepad(s[0], s[1], id, twin);
  };
  pad(12, 34, 'tp-west', 'tp-yard-w');
  pad(35, 34, 'tp-yard-w', 'tp-west');
  pad(84, 36, 'tp-east', 'tp-yard-e');
  pad(61, 36, 'tp-yard-e', 'tp-east');
  pad(47, 10, 'tp-north', 'tp-south');
  pad(49, 60, 'tp-south', 'tp-north');

  const wallDist = (x, y) => Math.max(Math.max(x0 - x, x - x1, 0), Math.max(y0 - y, y - y1, 0));
  const far = (x, y) => R0[y][x] && wallDist(x, y) >= 10;
  L.camp(14, 14, 'uuzzw', { ok: far });           // NW beetle swarm
  L.camp(82, 10, 'uuzz', { ok: far });            // NE beetle swarm
  L.camp(10, 50, 'rrga', { ok: far });            // SW charger gully
  L.camp(84, 48, 'ssqn', { ok: far });            // SE heavies, mended + spotted
  L.camp(48, 18, 'zzgw', { ok: far });            // N road camp
  L.camp(20, 28, 'mra', { ok: far, patrolN: 1 }); // west-ridge brood nest
  L.sentry('n', 6, 20, far);
  L.sentry('n', 90, 60, far);
  L.sentry('a', 50, 64, far);

  const chestPlan = [
    [8, 8, 'shards', 8], [20, 22, 'medkit', 1], [10, 64, 'cracker', 2],
    [24, 56, 'shards', 7], [86, 6, 'shield', 1], [88, 30, 'medkit', 1],
    [80, 62, 'shards', 9], [60, 8, 'toxin', 1], [36, 64, 'controller', 1],
    [74, 22, 'token', 1], [54, 60, 'cracker', 2],
  ];
  for (const [fx, fy, loot, amount] of chestPlan) {
    const s = L.nudge(fx, fy, (x, y) => R0[y][x], 12);
    if (!s) L.fail(`no chest spot near ${fx},${fy}`);
    L.chest(s[0], s[1], loot, amount);
  }
  const flame = L.nudge(16, 36, (x, y) => R0[y][x], 10);
  if (!flame) L.fail('no flamer cache spot');
  L.pickup(flame[0], flame[1], 'flamer');
  for (const [fx, fy] of [[26, 16], [70, 16], [26, 54], [70, 54], [48, 22], [48, 50], [8, 36], [88, 36], [34, 8], [62, 62], [18, 44], [78, 28]])
    L.crystal(fx, fy, (x, y) => R0[y][x]);

  // scoria floors: ash and basalt, ember seams beside the lava
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      if (L.get(x, y) !== '.') continue;
      if (wallDist(x, y) <= 3) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => L.get(x + dx, y + dy) === '!')) { L.set(x, y, ':'); continue; }
      if (L.rnd() < 0.45) L.set(x, y, '_');
      else if (L.rnd() < 0.18) L.set(x, y, ';');
    }

  return L.assemble({
    objective: 'Hold the crossing for seven nights — the marches take the bridges, you take the pads',
    bastion: { nights: 7, dayLen: 85, nightLen: 80, bloodMoons: [3, 5, 7], wavesPerNight: 2, waveMult: 1.8 },
    stronghold: {
      level: 13, name: 'Lava Crossing', sizeLabel: 'L', difficulty: 4, waves: 20, hpMult: 1.4,
      blurb: 'Two lava rivers, six bridges, three ridges. The pads blink you across what sears everything else.',
      newFeatures: ['Lava rivers', 'Teleport pad network', 'Bridge chokepoints'],
    },
    intro: [{
      title: 'Lava Crossing',
      lines: [
        'The mountain bleeds two rivers across the only road home.',
        'Lava sears whatever stands in it — the waves know, and take the bridges.',
        'The pads blink you ridge to ridge. Cork the bridges, own the crossing.',
      ],
      art: 'entropy',
    }],
    ambience: 'lava',
  });
}

// ===========================================================================
// sh14 'The Long Night' — 96x70 L glacial valley. EIGHT nights, snowstorm,
// a frozen lake that skates everything that crosses it, an ice cave hoard,
// and level-2 walls shipped hardened for the duration. Warden unlocks.
// ===========================================================================
function genSh14() {
  const W = 96, H = 70;
  const L = new Lvl('sh14', 'The Long Night', W, H, 20260714);
  const valley = L.organic(48, 36, 45, 30, 0.1);
  L.border(valley, '#');
  L.rim();
  for (let i = 0; i < 26; i++) L.blob(6 + L.rnd() * 84, 5 + L.rnd() * 60, 1.2 + L.rnd() * 2.2, '#', 0.6);
  // the frozen lake: a sheet of ice filling the west bowl, with two islets
  const lake = L.organic(26, 40, 17, 13, 0.1);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++)
      if (lake(x, y) && L.get(x, y) === '.') L.set(x, y, '^');
  // ice patches drifting east
  for (let i = 0; i < 10; i++) L.blob(40 + L.rnd() * 46, 8 + L.rnd() * 54, 1.4 + L.rnd() * 2.2, '^', 0.7);
  // the ice cave: a pocket bored into the north rock, glassy floor
  for (let y = 3; y <= 9; y++) for (let x = 56; x <= 66; x++)
    if (Math.hypot((x - 61) / 5.5, (y - 6) / 3.2) <= 1) L.set(x, y, '^');
  L.carve([[60, 9], [59, 13], [60, 17]], 1, '^'); // cave throat
  // inlets: the valley mouths
  L.carve([[30, 1], [31, 8], [30, 14]], 2);
  L.carve([[50, H - 2], [49, H - 8], [50, H - 14]], 2);
  L.carve([[1, 30], [8, 31], [14, 31]], 2);
  L.carve([[W - 2, 38], [W - 8, 38], [W - 16, 38]], 2);

  // the moraine fort, east valley floor — walls shipped at level 2
  const x0 = 52, y0 = 31, x1 = 72, y1 = 45;
  const { cx, cy } = L.fortress(x0, y0, x1, y1, { wallLevel: 2 });
  L.standardInterior(cx, cy, x0, y0, x1, y1, { hires: CREWS.sh14 });
  for (const [tx, ty] of [[cx - 3, y0 + 2], [cx + 2, y0 + 2], [cx - 3, y1 - 2], [cx + 2, y1 - 2], [x0 + 2, cy], [x1 - 2, cy]])
    L.build('turret', 10, tx, ty);

  const R = L.reach(cx, cy - 4, L.walkPass());
  const wallDist = (x, y) => Math.max(Math.max(x0 - x, x - x1, 0), Math.max(y0 - y, y - y1, 0));
  const far = (x, y) => R[y][x] && wallDist(x, y) >= 10;
  const onIce = (x, y) => far(x, y) && L.get(x, y) === '^';
  L.camp(22, 40, 'wwwww', { ok: onIce, fire: false }); // skitters skating the lake
  L.camp(30, 50, 'wwzz', { ok: far });                 // lakeshore swarm
  L.camp(14, 18, 'ssan', { ok: far });                 // NW bulwark line + spotter
  L.camp(80, 12, 'vvzz', { ok: far });                 // NE wraith ridge
  L.camp(82, 58, 'ssrn', { ok: far });                 // SE heavy line + spotter
  L.camp(40, 60, 'zzgw', { ok: far });                 // S valley swarm
  L.camp(36, 22, 'mqa', { ok: far, patrolN: 1 });      // mid-valley brood nest
  L.sentry('n', 8, 48, far);
  L.sentry('a', 48, 6, far);

  // the cave hoard + valley staples
  const caveOk = (x, y) => R[y][x] && y <= 9 && x >= 56 && x <= 66;
  for (const [fx, fy, loot, amount] of [[58, 5, 'token', 1], [62, 5, 'shards', 12], [64, 7, 'shield', 1]]) {
    const s = L.nudge(fx, fy, caveOk, 4);
    if (!s) L.fail(`no cave chest near ${fx},${fy}`);
    L.chest(s[0], s[1], loot, amount);
  }
  const gun = L.nudge(60, 7, caveOk, 4);
  if (!gun) L.fail('no cave weapon spot');
  L.pickup(gun[0], gun[1], 'stormgun');
  const chestPlan = [
    [10, 10, 'shards', 8], [40, 8, 'medkit', 1], [8, 36, 'cracker', 2],
    [18, 58, 'medkit', 1], [44, 50, 'shards', 7], [88, 24, 'shield', 1],
    [86, 48, 'cracker', 2], [60, 60, 'toxin', 1], [30, 30, 'controller', 1],
  ];
  for (const [fx, fy, loot, amount] of chestPlan) {
    const s = L.nudge(fx, fy, (x, y) => R[y][x], 12);
    if (!s) L.fail(`no chest spot near ${fx},${fy}`);
    L.chest(s[0], s[1], loot, amount);
  }
  for (const [fx, fy] of [[26, 40], [20, 34], [48, 20], [48, 54], [8, 26], [88, 36], [76, 8], [76, 62], [36, 36], [60, 22], [16, 50], [88, 12]])
    L.crystal(fx, fy, (x, y) => R[y][x]);

  // valley floors: stone moraines, frost-dirt near the ice
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      if (L.get(x, y) !== '.') continue;
      if (wallDist(x, y) <= 3) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => L.get(x + dx, y + dy) === '^')) { L.set(x, y, ':'); continue; }
      if (L.rnd() < 0.25) L.set(x, y, ';');
    }

  return L.assemble({
    objective: 'Survive the long night — eight short days, eight long dusks, and the last night rises blood',
    bastion: { nights: 8, dayLen: 70, nightLen: 95, bloodMoons: [8], wavesPerNight: 2, waveMult: 1.87 },
    stronghold: {
      level: 14, name: 'The Long Night', sizeLabel: 'L', difficulty: 4, waves: 18, hpMult: 1.43, unlock: 'warden',
      blurb: 'Eight nights, short days, a lake of ice underfoot. The walls ship hardened — they will need to be.',
      newFeatures: ['Warden joins the roster', 'Eight-night siege', 'Ice fields + snowstorm'],
    },
    intro: [{
      title: 'The Long Night',
      lines: [
        'Eight dusks stand between this fort and relief — the days up here are short.',
        'The lake is ice: everything that crosses it keeps sliding, you included.',
        'The walls ship hardened. Repair them by day; the Warden watches the rest.',
      ],
      art: 'campfire',
    }],
    weather: 'snow',
    ambience: 'night',
  });
}

// ===========================================================================
// sh15 'Phantom Watch' — 96x70 L shattered shards over the void. Phase
// Stalkers and acolyte phantoms in the fog; a seal forge, a proof fragment,
// and a sealLock vault holding a railcannon. The void blocks everything.
// ===========================================================================
function genSh15() {
  const W = 96, H = 70;
  const L = new Lvl('sh15', 'Phantom Watch', W, H, 20260715, '%');
  // five shards floating in the abyss
  const shards = [
    L.organic(48, 36, 16, 13, 0.12), // center: the watch
    L.organic(19, 15, 12, 10, 0.14), // NW
    L.organic(75, 13, 11, 9, 0.14),  // NE: the vault shard
    L.organic(27, 56, 11, 9, 0.14),  // SW
    L.organic(74, 55, 11, 9, 0.14),  // SE: the fragment shard
  ];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (shards.some(s => s(x, y))) L.set(x, y, '.');
  // stone bridges binding the shards to the watch
  L.carve([[34, 28], [25, 21]], 1, ';');  // NW
  L.carve([[60, 27], [69, 19]], 1, ';');  // NE
  L.carve([[37, 45], [31, 50]], 1, ';');  // SW
  L.carve([[59, 45], [67, 50]], 1, ';');  // SE
  // shard tips reach the map edges — the waves walk in off the rim
  L.carve([[19, 1], [19, 7]], 1);         // N spur (NW shard)
  L.carve([[1, 17], [8, 16]], 1);         // W spur (NW shard)
  L.carve([[W - 2, 12], [W - 8, 13]], 1); // E spur (NE shard)
  L.carve([[28, H - 2], [27, H - 8]], 1); // S spur (SW shard)

  const x0 = 38, y0 = 29, x1 = 58, y1 = 43;
  const { cx, cy } = L.fortress(x0, y0, x1, y1);
  L.standardInterior(cx, cy, x0, y0, x1, y1, { hires: CREWS.sh15 });
  for (const [tx, ty] of [[cx - 3, y0 + 2], [cx + 2, y0 + 2], [cx - 3, y1 - 2], [cx + 2, y1 - 2], [x0 + 2, cy], [x1 - 2, cy]])
    L.build('turret', 10, tx, ty);
  L.npc(cx + 2, y0 + 4, {
    id: 'archivist-noor', name: 'Archivist Noor',
    lines: [
      'The vault on the north-east shard answers only a lythseal — forge one and its door swings on touch.',
      'The forge wants twenty shards and a carried proof fragment. The fragment lies on the south-east shard, watched.',
      'The stalkers blink. The phantoms mend. In this fog, kill what you can already see.',
    ],
  });
  L.quests.push(
    { id: 'mint-seal', main: true, title: 'Mint a lythseal at the forge', giver: 'archivist-noor', kind: 'craft', target: 'lythseal', count: 1, reward: { shards: 14 }, hint: 'Twenty shards and a carried proof fragment, held to the anvil on the north-west shard.' },
    { id: 'stalker-cull', title: 'Put down five Phase Stalkers', giver: 'archivist-noor', kind: 'kill', target: 'x', count: 5, reward: { shards: 12 }, hint: 'They blink three tiles at a breath. Five down and the watch breathes easier.' },
  );

  const R = L.reach(cx, cy - 4, L.walkPass());
  // the vault: a rock ring on the NE shard, one door gap, sealLock'd
  const VX = 78, VY = 11;
  for (let y = VY - 4; y <= VY + 4; y++)
    for (let x = VX - 5; x <= VX + 5; x++) {
      const d = Math.hypot((x - VX) / 4.6, (y - VY) / 3.8);
      if (d <= 1 && d > 0.62 && L.get(x, y) === '.') L.set(x, y, '#');
    }
  // door gap on the vault's south face
  let doorX = null;
  for (let x = VX - 2; x <= VX + 2; x++)
    if (L.get(x, VY + 3) === '#' && L.get(x, VY + 4) !== '#' && L.get(x, VY + 2) !== '#') { doorX = x; break; }
  if (doorX == null) L.fail('no vault door column');
  L.set(doorX, VY + 3, ';');
  L.doors.push({ id: 'vault-door', x: doorX, y: VY + 3, w: 1, h: 1, sealLock: true });
  // the vault must hold: with the door shut, the hoard is out of reach
  {
    const seen = Array.from({ length: H }, () => Array(W).fill(false));
    const q = [[cx, cy - 4]];
    seen[cy - 4][cx] = true;
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!L.in(nx, ny) || seen[ny][nx] || WALK_BLOCK.has(L.get(nx, ny))) continue;
        if (nx === doorX && ny === VY + 3) continue; // the shut door
        seen[ny][nx] = true;
        q.push([nx, ny]);
      }
    }
    if (seen[VY][VX]) L.fail('vault leaks — hoard reachable around the seal door');
  }
  L.chest(VX - 1, VY, 'token', 1);
  L.chest(VX + 1, VY, 'shards', 12);
  L.chest(VX, VY + 1, 'shield', 1);
  L.pickup(VX, VY - 1, 'railcannon');
  // the forge on the NW shard, the fragment on the SE shard
  const fg = L.nudge(17, 13, (x, y) => R[y][x], 8);
  if (!fg) L.fail('no forge spot');
  L.forge(fg[0], fg[1]);
  const fr = L.nudge(76, 57, (x, y) => R[y][x], 8);
  if (!fr) L.fail('no fragment spot');
  L.qitem(fr[0], fr[1], { id: 'proof-1', kind: 'fragment' });

  const wallDist = (x, y) => Math.max(Math.max(x0 - x, x - x1, 0), Math.max(y0 - y, y - y1, 0));
  const far = (x, y) => R[y][x] && wallDist(x, y) >= 10;
  L.camp(74, 58, 'xxwz', { ok: far });            // SE: the fragment's keepers
  L.camp(22, 12, 'xqzz', { ok: far });            // NW: stalkers by the forge
  L.camp(72, 16, 'qqzn', { ok: far });            // NE: phantom choir + spotter
  L.camp(26, 52, 'ssra', { ok: far });            // SW: heavy line
  L.camp(70, 20, 'xwwz', { ok: far });            // NE bridge approach
  L.camp(30, 22, 'mza', { ok: far, patrolN: 1 }); // NW bridgehead nest
  L.sentry('n', 14, 20, far);
  L.sentry('n', 80, 50, far);

  const chestPlan = [
    [12, 10, 'shards', 8], [26, 18, 'medkit', 1], [70, 8, 'cracker', 2],
    [22, 60, 'shards', 7], [34, 52, 'medkit', 1], [68, 60, 'toxin', 1],
    [42, 22, 'shield', 1], [54, 50, 'cracker', 2], [80, 18, 'controller', 1],
  ];
  for (const [fx, fy, loot, amount] of chestPlan) {
    const s = L.nudge(fx, fy, (x, y) => R[y][x], 12);
    if (!s) L.fail(`no chest spot near ${fx},${fy}`);
    L.chest(s[0], s[1], loot, amount);
  }
  for (const [fx, fy] of [[19, 8], [76, 6], [30, 58], [78, 60], [48, 24], [48, 48], [36, 26], [60, 26], [14, 16], [86, 14], [38, 48], [58, 48]])
    L.crystal(fx, fy, (x, y) => R[y][x]);

  // shard floors: dead stone, starlit dust
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      if (L.get(x, y) !== '.') continue;
      if (wallDist(x, y) <= 3) continue;
      if (L.rnd() < 0.3) L.set(x, y, '_');
      else if (L.rnd() < 0.12) L.set(x, y, ';');
    }

  return L.assemble({
    objective: 'Hold the watch shard for eight nights — and forge the seal that opens the vault the phantoms circle',
    bastion: { nights: 8, dayLen: 80, nightLen: 85, bloodMoons: [4, 8], wavesPerNight: 2, waveMult: 1.93 },
    stronghold: {
      level: 15, name: 'Phantom Watch', sizeLabel: 'L', difficulty: 4, waves: 20, hpMult: 1.47,
      blurb: 'Five shards over the void, stalkers in the fog, and a vault that answers only a forged lythseal.',
      newFeatures: ['Void shards', 'Seal-forge vault', 'Phase Stalker packs'],
    },
    intro: [{
      title: 'Phantom Watch',
      lines: [
        'Five shards hang over the abyss — the void swallows shot, sight and step alike.',
        'A vault on the far shard answers only a lythseal: fragment, shards, anvil.',
        'The stalkers blink through the fog. Hold the bridges; trust the watch.',
      ],
      art: 'entropy',
    }],
    weather: 'fog',
    ambience: 'night',
  });
}

// ===========================================================================
// sh16 'Glasswater' — 100x72 L crescent coast. Sand drags every stride,
// glass lagoons mirror the dunes, the sea flanks the whole north-east — and
// Shade walks out of the heat shimmer. Two islets only a skiff can rob.
// ===========================================================================
function genSh16() {
  const W = 100, H = 72;
  const L = new Lvl('sh16', 'Glasswater', W, H, 20260716);
  // the sea: a great arc swallowing the north-east
  const seaD = (x, y) => Math.hypot(x - 112, y + 14);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = seaD(x, y);
      if (d < 70) L.set(x, y, '~');
      else if (d < 76) L.set(x, y, '=');
    }
  // islets in the glass water (skiff-only)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (Math.hypot((x - 86) / 4.2, (y - 12) / 3.2) <= 1) L.set(x, y, '=');
      if (Math.hypot((x - 92) / 3.0, (y - 32) / 2.6) <= 1) L.set(x, y, '=');
    }
  // rocky south range, deep forest west
  const southMt = (x, y) => ((x - 50) / 62) ** 2 + ((y - 80) / 19) ** 2 <= 1;
  const westWood = (x, y) => ((x + 8) / 20) ** 2 + ((y - 34) / 34) ** 2 <= 1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (southMt(x, y)) L.set(x, y, '#');
      else if (westWood(x, y) && L.get(x, y) === '.') L.set(x, y, 'T');
    }
  L.rim();
  // dune ridges marching inland, glass lagoons in the lee
  for (let i = 0; i < 26; i++) L.blob(10 + L.rnd() * 75, 8 + L.rnd() * 50, 1.6 + L.rnd() * 3.0, '=', 0.7);
  L.blob(26, 26, 4.6, '~', 0.85);
  L.blob(45, 17, 3.6, '~', 0.85);
  // inlets: tide bar north, wood cut west, pass south, dry shore east
  L.carve([[16, 1], [16, 8], [17, 14]], 2);
  L.carve([[1, 50], [8, 50], [14, 48]], 2);
  L.carve([[58, H - 2], [57, H - 8], [58, H - 14]], 2);
  L.carve([[W - 2, 60], [W - 8, 60], [W - 16, 58]], 2);

  // the bluff fort, center-south
  const x0 = 34, y0 = 39, x1 = 54, y1 = 53;
  const { cx, cy } = L.fortress(x0, y0, x1, y1);
  L.standardInterior(cx, cy, x0, y0, x1, y1, { hires: CREWS.sh16 });
  for (const [tx, ty] of [[cx - 3, y0 + 2], [cx + 2, y0 + 2], [cx - 3, y1 - 2], [cx + 2, y1 - 2], [x0 + 2, cy], [x1 - 2, cy]])
    L.build('turret', 10, tx, ty);

  const R = L.reach(cx, cy - 4, L.walkPass());
  // the skiff: beached where the sand meets the sea
  const dock = L.nudge(62, 30, (x, y) => R[y][x]
    && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => L.get(x + dx, y + dy) === '~' && seaD(x + dx, y + dy) < 70), 14);
  if (!dock) L.fail('no skiff beach');
  L.vehicle('skiff', dock[0], dock[1]);
  // islet hoards
  L.chest(85, 12, 'token', 1, true);
  L.chest(87, 12, 'shards', 12, true);
  L.chest(86, 14, 'shield', 1, true);
  L.chest(92, 32, 'medkit', 1, true);

  const wallDist = (x, y) => Math.max(Math.max(x0 - x, x - x1, 0), Math.max(y0 - y, y - y1, 0));
  const far = (x, y) => R[y][x] && wallDist(x, y) >= 10;
  L.camp(20, 18, 'xxwz', { ok: far });            // dune stalkers NW
  L.camp(70, 50, 'xnzz', { ok: far });            // dune stalkers + spotter E
  L.camp(44, 12, 'nraa', { ok: far });            // tide-bar sniper ridge
  L.camp(14, 60, 'ssga', { ok: far });            // south-wood heavy line
  L.camp(74, 62, 'zzzwg', { ok: far });           // dry-shore husk swarm
  L.camp(30, 30, 'mqz', { ok: far, patrolN: 1 }); // lagoon brood nest
  L.sentry('n', 8, 30, far);
  L.sentry('n', 38, 6, far);
  L.sentry('a', 88, 56, far);

  const chestPlan = [
    [10, 12, 'shards', 8], [30, 8, 'medkit', 1], [54, 8, 'cracker', 2],
    [8, 42, 'shards', 7], [22, 52, 'medkit', 1], [30, 64, 'cracker', 2],
    [70, 58, 'shards', 9], [88, 62, 'toxin', 1], [56, 24, 'shield', 1],
    [64, 40, 'controller', 1],
  ];
  for (const [fx, fy, loot, amount] of chestPlan) {
    const s = L.nudge(fx, fy, (x, y) => R[y][x], 12);
    if (!s) L.fail(`no chest spot near ${fx},${fy}`);
    L.chest(s[0], s[1], loot, amount);
  }
  const rail = L.nudge(50, 20, (x, y) => R[y][x], 10);
  if (!rail) L.fail('no dune cache spot');
  L.pickup(rail[0], rail[1], 'mortarMk2');
  for (const [fx, fy] of [[18, 10], [40, 22], [60, 18], [12, 36], [26, 44], [60, 50], [80, 58], [44, 60], [16, 64], [70, 36], [50, 32], [90, 66]])
    L.crystal(fx, fy, (x, y) => R[y][x]);

  // shores get wet sand, the inland greens between the dunes
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      if (L.get(x, y) !== '.') continue;
      if (wallDist(x, y) <= 3) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => L.get(x + dx, y + dy) === '~')) { L.set(x, y, ':'); continue; }
      if (L.rnd() < 0.4) L.set(x, y, ',');
    }

  return L.assemble({
    objective: 'Hold the bluff fort for eight nights — the dunes drag every stride, theirs included',
    bastion: { nights: 8, dayLen: 80, nightLen: 85, bloodMoons: [5, 8], wavesPerNight: 2, waveMult: 2 },
    stronghold: {
      level: 16, name: 'Glasswater', sizeLabel: 'L', difficulty: 5, waves: 20, hpMult: 1.5, unlock: 'shade',
      blurb: 'A crescent of dunes between glass lagoons and open sea. Sand slows the march — use every dragged stride.',
      newFeatures: ['Shade joins the roster', 'Sand dunes (everything slows)', 'Open-sea skiff flank'],
    },
    intro: [{
      title: 'Glasswater',
      lines: [
        'Dunes to the lagoons, lagoons to the sea — every stride out there drags.',
        'The waves wade the same sand. Meet them where it is deepest.',
        'Shade has watched this coast for years. Hold it and she steps out of the shimmer.',
      ],
      art: 'crossing',
    }],
    ambience: 'meadow',
  });
}

// ===========================================================================
// sh17 'Twin Strongholds' — 110x80 XL hourglass. TWO walled bases joined by
// a waist road, each holding TWO anchor monoliths: beacons-variant
// semantics, so the hold only falls when ALL FOUR are dark at once
// (lose-when-all-dark). Defend both — the waves split between what burns.
// ===========================================================================
function genSh17() {
  const W = 110, H = 80;
  const L = new Lvl('sh17', 'Twin Strongholds', W, H, 20260717);
  const nw = L.organic(32, 24, 27, 20, 0.11);
  const se = L.organic(78, 56, 27, 20, 0.11);
  L.border((x, y) => nw(x, y) || se(x, y), '#');
  L.rim();
  // the waist road binding the lobes
  L.carve([[46, 32], [55, 40], [64, 48]], 3);
  for (let i = 0; i < 24; i++) L.blob(6 + L.rnd() * 98, 5 + L.rnd() * 70, 1.2 + L.rnd() * 2.2, 'T', 0.6);
  for (let i = 0; i < 10; i++) L.blob(6 + L.rnd() * 98, 5 + L.rnd() * 70, 1.0 + L.rnd() * 1.8, '#', 0.6);
  // inlets: north + west feed the NW lobe, south + east feed the SE lobe
  L.carve([[32, 1], [32, 8], [31, 14]], 2);
  L.carve([[1, 24], [8, 24], [14, 25]], 2);
  L.carve([[78, H - 2], [78, H - 8], [79, H - 14]], 2);
  L.carve([[W - 2, 56], [W - 8, 56], [W - 16, 55]], 2);

  // twin fortresses, two anchor monoliths each
  const twin = (x0, y0, x1, y1, crew, flip) => {
    const { cx, cy } = L.fortress(x0, y0, x1, y1);
    L.core(cx - 2, cy);
    L.core(cx + 2, cy);
    L.spawn(cx, cy - 2);
    L.spawn(cx, cy + 2);
    const corners = flip
      ? [[x1 - 2, y1 - 2], [x0 + 2, y1 - 2], [x1 - 2, y0 + 2]]
      : [[x0 + 2, y0 + 2], [x1 - 2, y0 + 2], [x0 + 2, y1 - 2]];
    for (const [tx, ty] of corners) L.tower(tx, ty);
    L.shop(flip ? cx - 4 : cx + 4, flip ? y1 - 2 : y0 + 2);
    L.fire(cx, cy - 3); L.fire(cx, cy + 3);
    crew.forEach((h, i) => L.hire(cx - 5, cy - 2 + i * 2, h.job, h.cost, h.name));
    L.vehicle('stag', cx + 5, cy + (flip ? -2 : 2));
    for (const [tx, ty] of [[cx - 3, y0 + 2], [cx + 2, y0 + 2], [cx - 3, y1 - 2], [cx + 2, y1 - 2]])
      L.build('turret', 10, tx, ty);
    for (const [fx, fy] of [[cx + 4, cy], [cx + 6, cy], [cx + 4, cy + (flip ? -4 : 4)]])
      L.build('farm', 6, fx, fy);
    return { cx, cy, x0, y0, x1, y1 };
  };
  const A = twin(23, 18, 41, 30, CREWS.sh17.slice(0, 3), false);
  const B = twin(69, 50, 87, 62, CREWS.sh17.slice(3, 6), true);

  const R = L.reach(A.cx, A.cy - 2, L.walkPass());
  const wallDist = (x, y) => Math.min(
    Math.max(Math.max(A.x0 - x, x - A.x1, 0), Math.max(A.y0 - y, y - A.y1, 0)),
    Math.max(Math.max(B.x0 - x, x - B.x1, 0), Math.max(B.y0 - y, y - B.y1, 0)));
  const far = (x, y) => R[y][x] && wallDist(x, y) >= 10;
  // the warlord's camp: a boss and his retinue squat the east marches
  L.camp(96, 40, 'bssqn', { ok: far, patrolN: 0 });
  for (const [fx, fy, loot, amount] of [[94, 36, 'token', 1], [98, 44, 'shards', 14]]) {
    const s = L.nudge(fx, fy, (x, y) => far(x, y), 8);
    if (!s) L.fail(`no warlord chest spot near ${fx},${fy}`);
    L.chest(s[0], s[1], loot, amount);
  }
  const rail = L.nudge(92, 42, (x, y) => far(x, y), 8);
  if (!rail) L.fail('no warlord cache spot');
  L.pickup(rail[0], rail[1], 'railcannon');
  // camps across both lobes: every elite kind walks these marches
  L.camp(12, 10, 'ffwz', { ok: far });             // NW alpha pack
  L.camp(52, 10, 'xxqz', { ok: far });             // N stalker watch
  L.camp(10, 44, 'ssan', { ok: far });             // W heavy line + spotter
  L.camp(38, 46, 'vvzz', { ok: far });             // waist-west wraiths
  L.camp(62, 26, 'uuzzw', { ok: far });            // waist-east beetles
  L.camp(50, 66, 'rrga', { ok: far });             // S charger gully
  L.camp(94, 68, 'qqzn', { ok: far });             // SE phantom choir
  L.camp(26, 36, 'mza', { ok: far, patrolN: 1 });  // NW lobe brood nest
  L.camp(84, 30, 'mwa', { ok: far, patrolN: 1 });  // NE marches brood nest
  L.sentry('n', 6, 16, far);
  L.sentry('n', 102, 62, far);
  L.sentry('a', 56, 46, far);
  L.sentry('a', 60, 36, far);

  const chestPlan = [
    [8, 22, 'shards', 8], [24, 6, 'medkit', 1], [44, 18, 'cracker', 2],
    [14, 36, 'shards', 9], [58, 62, 'medkit', 1], [58, 36, 'shield', 1],
    [46, 26, 'shards', 7], [46, 10, 'cracker', 2], [102, 50, 'medkit', 1],
    [64, 70, 'toxin', 1], [54, 50, 'controller', 1], [88, 72, 'shards', 10],
  ];
  for (const [fx, fy, loot, amount] of chestPlan) {
    const s = L.nudge(fx, fy, (x, y) => R[y][x], 12);
    if (!s) L.fail(`no chest spot near ${fx},${fy}`);
    L.chest(s[0], s[1], loot, amount);
  }
  for (const [fx, fy] of [[32, 8], [8, 28], [50, 26], [38, 38], [56, 44], [72, 54], [78, 70], [102, 56], [22, 42], [52, 16], [88, 38], [62, 52], [60, 64], [40, 32], [55, 40], [70, 44]])
    L.crystal(fx, fy, (x, y) => R[y][x]);

  // marches floors: ash drifts thickening toward the east, stone on the road
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      if (L.get(x, y) !== '.') continue;
      if (wallDist(x, y) <= 3) continue;
      if (L.rnd() < 0.30 + 0.25 * (x / W)) L.set(x, y, '_');
      else if (L.rnd() < 0.1) L.set(x, y, ':');
    }

  return L.assemble({
    objective: 'Defend BOTH strongholds for eight nights — the hold falls only if all four anchor monoliths go dark at once',
    bastionVariant: 'beacons',
    bastion: { nights: 8, dayLen: 80, nightLen: 85, bloodMoons: [5, 8], wavesPerNight: 2, waveMult: 2.07 },
    stronghold: {
      level: 17, name: 'Twin Strongholds', sizeLabel: 'XL', difficulty: 5, waves: 20, hpMult: 1.53,
      blurb: 'Two walled keeps, two monoliths apiece, one waist road in the ash. The waves split between whatever still burns.',
      newFeatures: ['Twin walled strongholds', 'Two-and-two anchor monoliths', 'Warlord camp'],
    },
    intro: [{
      title: 'Twin Strongholds',
      lines: [
        'Two keeps share this pass, two anchor monoliths each — the waves split between all four.',
        'Only every monolith dark at once ends the hold. Dark is not dead: relight by day.',
        'A warlord squats the east marches with your railcannon. Negotiate accordingly.',
      ],
      art: 'siege',
    }],
    outro: [{
      title: 'The Pass Holds',
      lines: [
        'Eight dawns, four monoliths, two keeps — and one line that did not break.',
        'The ash settles on walls worth the name. The deep marches wait.',
      ],
      art: 'dawn',
    }],
    weather: 'ashstorm',
    ambience: 'ash',
  });
}

// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const GENS = {
  sh09: genSh09, sh10: genSh10, sh11: genSh11, sh12: genSh12, sh13: genSh13,
  sh14: genSh14, sh15: genSh15, sh16: genSh16, sh17: genSh17,
};
const want = argv.length ? argv : Object.keys(GENS);
for (const id of want) {
  if (!GENS[id]) { console.error('unknown level', id); process.exit(1); }
  const def = GENS[id]();
  const file = path.join(OUT_DIR, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(def, null, 2) + '\n');
  const counts = {};
  for (const row of def.tiles) for (const c of row) counts[c] = (counts[c] || 0) + 1;
  console.log(`${id} '${def.name}': waves ${def.stronghold.waves}, builds ${def.builds.length}, chests ${def.chests.length}, camps ${(def.groups || []).length}, patrols ${(def.patrols || []).length}`);
  console.log('  tiles:', Object.entries(counts).sort().map(([k, v]) => `${k}${v}`).join(' '));
}
