// Core simulation shared by the Node server (online co-op) and the browser (solo).
// All distances are in pixels; speeds in characters.json are tiles/second.

export const TILE = 48;
const PLAYER_R = 14;
const ENEMY_R = 14;
const SHOT_R = 5;
const CAPTIVE_R = 12;
const RESPAWN_DELAY = 2;

const ENEMY_STATS = {
  g: { kind: 'grunt', hp: 2, speed: 1.25, score: 100, aggro: 9 },
  a: { kind: 'archer', hp: 1, speed: 0, range: 7, cool: 1, score: 125, aggro: 9.5 },
  r: { kind: 'charger', hp: 3, speed: 1.0, range: 4.2, cool: 1.2, score: 175, aggro: 9 },
  s: { kind: 'bulwark', hp: 5, speed: 0.7, score: 225, aggro: 8.5 },
  m: { kind: 'spawner', hp: 5, speed: 0, range: 6, cool: 1.5, spawnCool: 2.4, score: 250, aggro: 9 },
  n: { kind: 'sniper', hp: 2, speed: 0, range: 10.5, cool: 1.4, score: 200, aggro: 12.5 },
  w: { kind: 'skitter', hp: 1, speed: 2.0, score: 50, aggro: 10.5 },
  b: { kind: 'boss', hp: 24, speed: 0.55, range: 8.5, cool: 1.1, spawnCool: 3.2, score: 1200, aggro: 12 },
};

// Maps at or below this tile count play arcade-style: every enemy is awake
// from the start, exactly like the original single-screen levels.
const ARCADE_MAP_TILES = 600;
// A waking enemy alerts sleeping allies within this radius.
const ALERT_RIPPLE = 3.5;

// Enemies hold position for this long at level start so players get their bearings.
const START_GRACE = 2.5;

const ENEMY_LETTERS = new Set(Object.keys(ENEMY_STATS));

// Shards dropped on death, by kind. Deterministic, always.
const SHARD_DROPS = { grunt: 1, archer: 1, skitter: 1, charger: 2, sniper: 2, bulwark: 2, spawner: 3, boss: 12 };
const DROP_TTL = 25;
const MAGNET_RANGE = 2.5; // tiles
const MAGNET_SPEED = 6; // tiles/sec
const BUILD_RADIUS = 18; // px, built structures block movement in this circle
const BUILD_REACH = 1.5; // tiles, act range for building and talking
const CRYSTAL_R = 16;
const MELEE_KINDS = new Set(['grunt', 'skitter', 'charger', 'bulwark', 'boss']);
const STATIONARY_KINDS = new Set(['archer', 'sniper', 'spawner']);
const LEASH_MULT = 1.8;
const TURRET_WEAPON = { kind: 'turret', damage: 1, projSpeed: 10, range: 6, count: 1 };

// --- survival-core tuning (non-arcade content only; classics never touch it) ---
const PLAYER_MAX_HP = 3;
const SHIELD_MAX = 2;
const HIT_INVULN = 1; // seconds of grace after a survivable hit
const CORE_R = 18; // px, base-core contact radius (gnawed like a structure)
const CRACKER_RANGE = 4; // tiles, lob distance in the facing direction
const CRACKER_FLIGHT = 0.5; // seconds airborne (overWalls arc)
const CRACKER_FUSE = 3.0; // seconds of lure after landing
const CRACKER_LURE = 9; // tiles, enemies inside re-target the cracker
const CRACKER_AOE = 1.6; // tiles
const CRACKER_DMG = 3;
const CHEST_LOOTS = ['shards', 'cracker', 'medkit', 'shield', 'token'];
const HIRE_JOBS = ['farmer', 'engineer', 'smith'];
const MUTATIONS = ['feral', 'bulk', 'volatile', 'split'];
const WAVE_EDGES = ['n', 'e', 's', 'w'];
const FARM_GROW_T = 25; // seconds per stage (15 with a hired farmer)
const FARM_GROW_FAST = 15;
const BASTION_DEFAULTS = { nights: 5, dayLen: 90, nightLen: 75, bloodMoons: [3, 5] };
const BLOOD_WARN_LEAD = 30; // seconds before a blood-moon dusk

// --- structure levels, towers, shops, hires, vehicles, pvp tuning ---
const STRUCT_HP = { barricade: [14, 22, 32], turret: [10, 14, 18], tower: [20, 28, 38] };
const TURRET_DMG = [1, 2, 3];
const TURRET_RANGE = [5, 5.5, 6]; // tiles, targeting radius by level
const REPAIR_TICK = 0.5; // seconds per hp repaired
const REPAIR_COST = 1 / 3; // shards per hp (1 shard per 3 hp)
const UPGRADE_COST = lvl => lvl * 8; // shards to go from lvl to lvl+1
const TOWER_BONUS = [0.35, 0.5, 0.65]; // occupant range bonus by tower level
const TOWER_MOUNT_REACH = 0.9; // tiles: stand at the base to climb; the wider
// hold-act ring (out to BUILD_REACH) stays free for repair/upgrade/rebuild
const TOWER_REBUILD_COST = 10;
const SHOP_REACH = 1.5; // tiles
const SHOP_OFFERS = [
  { what: 'token', cost: 20 },
  { what: 'shield', cost: 12 },
  { what: 'cracker', cost: 8, amount: 2 },
  { what: 'medkit', cost: 10, amount: 1 },
];
const STAG_SPEED = 2.2; // land mount speed multiplier
const FLAG_REACH = 0.6; // tiles, flag touch radius
const FLAG_DROP_T = 8; // seconds a dropped flag lies before returning
const CTF_RESPAWN = 5;
const CTF_CAPS_TO_WIN = 3;
const CARRY_SLOW = 0.85; // flag carrier speed multiplier
const ZONE_TICK = 2; // seconds between 1-damage zone ticks
const ZONE_SHRINK_T = 10; // seconds a scheduled shrink takes to close
const FARM_REPLANT_T = 10; // seconds for a hired farmer to replant a trample

function buildMaxHp(kind) {
  if (kind === 'barricade') return 14;
  if (kind === 'turret') return 10;
  if (kind === 'farm') return 6;
  return 20; // pylon: never takes damage once built (indestructible)
}

// Deterministic chest loot: def.chests binds row-major; missing entries fall
// back to a fixed cycle by index. Shard chests pay 6-12 by index.
function chestLoot(def, i) {
  const cd = (def.chests || [])[i] || {};
  const loot = cd.loot || CHEST_LOOTS[i % CHEST_LOOTS.length];
  const amount = cd.amount ?? (loot === 'shards' ? 6 + (i % 7) : loot === 'cracker' ? 2 : 1);
  return { loot, amount };
}

export function charsById(characters) {
  const m = {};
  for (const c of characters) m[c.id] = c;
  return m;
}

function makeEnemy(letter, x, y, id) {
  const def = ENEMY_STATS[letter] || ENEMY_STATS.g;
  return {
    id,
    letter,
    kind: def.kind,
    x,
    y,
    hp: def.hp,
    maxHp: def.hp,
    speed: def.speed * TILE,
    range: (def.range || 0) * TILE,
    aggro: (def.aggro || 8) * TILE,
    cool: (def.cool || 0) + (id % 3) * 0.25,
    spawnCool: def.spawnCool || 0,
    score: def.score,
    fx: 0,
    fy: 1,
    hurt: 0,
    state: 'idle',
    aimT: 0,
    aimX: x,
    aimY: y,
    awake: false,
    repathT: (id % 5) * 0.1,
    path: null,
    pathI: 0,
    homeX: x,
    homeY: y,
    returning: false,
    hitCool: 0,
  };
}

export function parseLevel(def) {
  const grid = def.tiles.map(r => r.split(''));
  const h = grid.length;
  const w = grid[0].length;
  const spawns = [];
  const captives = [];
  const enemies = [];
  const npcs = [];
  const builds = [];
  const crystals = [];
  const chests = [];
  const vehicles = [];
  const towers = [];
  const shops = [];
  const hires = [];
  const flags = [];
  let core = null;
  let ci = 0;
  let ni = 0;
  let bi = 0;
  let eid = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = grid[y][x];
      const px = (x + 0.5) * TILE;
      const py = (y + 0.5) * TILE;
      if (c === 'P') {
        spawns.push({ x: px, y: py });
        grid[y][x] = '.';
      } else if (c === 'c') {
        const charId = (def.captiveChars || [])[ci++];
        if (charId) captives.push({ id: 'c' + ci, charId, x: px, y: py, owner: null, fromPlayer: false });
        grid[y][x] = '.';
      } else if (c === 'N') {
        const nd = (def.npcs || [])[ni++];
        if (nd) npcs.push({ id: nd.id, name: nd.name, x: px, y: py, lines: nd.lines || [], gift: nd.gift || null, lineIdx: 0, given: false });
        grid[y][x] = '.';
      } else if (c === 'B') {
        const bd = (def.builds || [])[bi++];
        if (bd) {
          builds.push({
            x: px, y: py, kind: bd.kind, cost: bd.cost,
            progress: 0, paid: 0, built: false,
            hp: 0, maxHp: buildMaxHp(bd.kind),
            cool: 0, evT: 0,
            ...(bd.kind === 'farm' ? { stage: 0, growT: 0 } : {}),
            // barricades and turrets carry an upgrade level; pylons never do
            ...(STRUCT_HP[bd.kind] ? { level: 1 } : {}),
          });
        }
        grid[y][x] = '.';
      } else if (c === 'C') {
        const ld = chestLoot(def, chests.length);
        chests.push({ x: px, y: py, opened: false, loot: ld.loot, amount: ld.amount });
        grid[y][x] = '.';
      } else if (c === 'K') {
        core = { x: px, y: py, hp: 30, maxHp: 30 };
        grid[y][x] = '.';
      } else if (c === 'V') {
        const vd = (def.vehicles || [])[vehicles.length] || {};
        vehicles.push({ id: 'v' + vehicles.length, x: px, y: py, kind: vd.kind || 'stag', rider: null });
        grid[y][x] = '.';
      } else if (c === 'W') {
        towers.push({ x: px, y: py, level: 1, hp: 20, maxHp: 20, occupant: null });
        grid[y][x] = '.';
      } else if (c === 'S') {
        shops.push({ x: px, y: py });
        grid[y][x] = '.';
      } else if (c === 'H') {
        const hd = (def.hires || [])[hires.length] || {};
        hires.push({
          x: px, y: py,
          cost: hd.cost ?? 12,
          job: hd.job || HIRE_JOBS[hires.length % HIRE_JOBS.length],
          hired: false,
          name: hd.name || 'Hand ' + (hires.length + 1),
        });
        grid[y][x] = '.';
      } else if (c === 'D') {
        flags.push({ team: flags.length % 2, x: px, y: py, homeX: px, homeY: py, carrier: null, atBase: true, dropT: 0 });
        grid[y][x] = '.';
      } else if (c === 'Y') {
        crystals.push({ cid: crystals.length, x: px, y: py, hp: 3 });
        grid[y][x] = '.';
      } else if (ENEMY_LETTERS.has(c)) {
        enemies.push(makeEnemy(c, px, py, eid++));
        grid[y][x] = '.';
      }
    }
  }
  return { grid: grid.map(r => r.join('')), w, h, spawns, captives, enemies, npcs, builds, crystals, chests, vehicles, towers, shops, hires, flags, core };
}

export function createGame(def, party, charMap, roster) {
  const lvl = parseLevel(def);
  const mods = def.modifiers || {};
  const pvp = def.mode === 'ctf' || def.mode === 'br';
  // PvP modes field no AI enemies at all, whatever the grid says.
  if (pvp) lvl.enemies = [];
  // Arcade maps (the classic single-screen levels) keep the original behavior
  // exactly: every enemy awake, straight-line steering, fire on range without
  // sight checks, global spawn caps, respawn at the level spawn point.
  // Mode maps (bastion/ctf/br) always play by survival rules, whatever their size.
  const arcade = !def.mode && lvl.w * lvl.h <= ARCADE_MAP_TILES;
  if (arcade) for (const e of lvl.enemies) e.awake = true;
  // Big-map spawn tuning: slower brood cycles than the arcade originals.
  if (!arcade) {
    for (const e of lvl.enemies) {
      if (e.kind === 'spawner') e.spawnCool = 6.5;
      else if (e.kind === 'boss') e.spawnCool = 7;
    }
  }
  const players = party.map((p, i) => {
    const s = lvl.spawns[i % lvl.spawns.length] || { x: TILE * 2, y: TILE * 2 };
    return spawnPlayer(p.pid, p.name, p.charId, s.x + (i * 10), s.y);
  });
  // Survival rules apply on every non-arcade map: 3 hp, shield pips, an item
  // slot. Arcade (classic) players stay 1-hit and gain no fields at all.
  if (!arcade) {
    for (const p of players) {
      p.hp = PLAYER_MAX_HP;
      p.maxHp = PLAYER_MAX_HP;
      p.shield = 0;
      p.item = null;
    }
  }
  // PvP team assignment. CTF: party entries may carry a team (online lobbies);
  // otherwise seats alternate 0/1. BR: every operative for themselves.
  if (def.mode === 'ctf') {
    for (let i = 0; i < players.length; i++) players[i].team = party[i].team ?? (i % 2);
  } else if (def.mode === 'br') {
    for (const p of players) p.team = p.pid;
  }
  // pvp scoreboard: per-player kills (BR simultaneous-wipe ties go to the
  // player with more kills, then the lower pid)
  if (pvp) for (const p of players) p.kills = 0;
  const bastion = def.mode === 'bastion' ? { ...BASTION_DEFAULTS, ...(def.bastion || {}) } : null;
  // First 'E' tile center, used by the gateOpen event.
  let exitX = lvl.w * TILE / 2, exitY = lvl.h * TILE / 2;
  outer: for (let y = 0; y < lvl.h; y++) {
    for (let x = 0; x < lvl.w; x++) {
      if (lvl.grid[y][x] === 'E') { exitX = (x + 0.5) * TILE; exitY = (y + 0.5) * TILE; break outer; }
    }
  }
  return {
    name: def.name || 'Untitled',
    objective: def.objective || '',
    grid: lvl.grid, w: lvl.w, h: lvl.h,
    arcade,
    spawns: lvl.spawns,
    timeLeft: def.time || 90,
    // Story modifiers. dark shrinks enemy aggro and caps their sight; waves
    // pour hunters in from a map edge at fixed elapsed times. Classic levels
    // define neither, so their behavior is untouched.
    dark: !!mods.dark,
    elapsed: 0,
    waves: (mods.waves || []).map(w => ({ at: w.at, letters: w.letters || '', edge: w.edge, fired: false })),
    players,
    enemies: lvl.enemies,
    captives: lvl.captives,
    npcs: lvl.npcs,
    builds: lvl.builds,
    crystals: lvl.crystals,
    chests: lvl.chests,
    vehicles: lvl.vehicles,
    towers: lvl.towers,
    shops: lvl.shops,
    hires: lvl.hires,
    flags: lvl.flags,
    core: lvl.core,
    crackers: [],
    // Mode missions (bastion/ctf/br) replace the classic end conditions;
    // classic defs carry no mode so nothing changes for them.
    mode: def.mode || null,
    bastion,
    cycle: bastion ? { phase: 'day', nightNo: 0, t: bastion.dayLen, bloodMoon: false, warned: false } : null,
    // CTF score and BR shrink zone. Null on every other mode (snapshot omits).
    caps: def.mode === 'ctf' ? [0, 0] : null,
    // CTF per-team shard pools; null everywhere else (g.shards rules there —
    // BR keeps the single shared pool by design).
    teamShards: def.mode === 'ctf' ? [0, 0] : null,
    // CTF sudden-death bookkeeping: flag pickups per team across the match,
    // and which team grabbed first inside sudden death (the 180s cap rules).
    grabs: def.mode === 'ctf' ? [0, 0] : null,
    sdFirstGrab: null,
    suddenT: 0,
    suddenDeath: false,
    zone: def.mode === 'br' ? {
      x: lvl.w * TILE / 2, y: lvl.h * TILE / 2,
      r: Math.hypot(lvl.w, lvl.h) * TILE / 2,
      targetR: Math.hypot(lvl.w, lvl.h) * TILE / 2,
      shrinkT: 0,
    } : null,
    brShrinks: def.mode === 'br'
      ? ((def.br || {}).shrinks || []).map(s => ({ at: s.at, r: s.r, fired: false }))
      : null,
    winner: undefined,
    lastOut: null,
    drops: [],
    shards: 0,
    // gate.after: optional time lock — even at full pylon quorum the Anchor
    // only opens once `after` seconds have elapsed (siege missions).
    gate: def.gate ? { need: def.gate.need, after: def.gate.after || 0, built: 0, open: false } : null,
    exitX,
    exitY,
    shots: [],
    events: [],
    rescued: [],
    roster: roster.slice(),
    charMap,
    status: 'play',
    graceT: START_GRACE,
    nextCaptiveId: 100,
    nextEnemyId: 1000,
    nextShotId: 1,
    score: 0,
    kills: 0,
    combo: 1,
    comboT: 0,
    lowTimeSent: false,
  };
}

function spawnPlayer(pid, name, charId, x, y) {
  return {
    pid, name, charId, x, y, fx: 0, fy: -1, cool: 0, state: 'active', respawn: 0, invuln: 3,
    specialCool: 0, dashT: 0, dashFx: 0, dashFy: -1, stimT: 0, actPrev: false, specialPrev: false,
    itemPrev: false,
  };
}

function tileAt(g, x, y) {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) return '#';
  return g.grid[ty][tx];
}

// Trees block movement (and sight); water and sandbags block movement only.
// New floor letters (',' ':' ';' '_') and the campfire '*' are all passable.
function blocksMove(c) { return c === '#' || c === 'T' || c === '~' || c === 'o'; }

function collides(g, x, y, r) {
  for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
    if (blocksMove(tileAt(g, x + ox, y + oy))) return true;
  }
  // Built structures (pylons, barricades, turrets) block players and enemies.
  // A* ignores them on purpose so enemies bump into them and gnaw them down.
  // Farms are walkable plots — anything can cross (and trample) them.
  if (g.builds) {
    for (const b of g.builds) {
      if (!b.built || b.kind === 'farm') continue;
      const dx = x - b.x, dy = y - b.y;
      const rr = BUILD_RADIUS + r;
      if (dx * dx + dy * dy < rr * rr) return true;
    }
  }
  return false;
}

// Like collides, but escape-friendly for build circles: a structure completing
// around someone must never entomb them — moves that increase distance from
// the structure's center are always allowed, only inward moves are blocked.
function moveBlocked(g, fromX, fromY, x, y, r) {
  for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
    if (blocksMove(tileAt(g, x + ox, y + oy))) return true;
  }
  if (g.builds) {
    for (const b of g.builds) {
      if (!b.built || b.kind === 'farm') continue;
      const dx = x - b.x, dy = y - b.y;
      const rr = BUILD_RADIUS + r;
      if (dx * dx + dy * dy < rr * rr) {
        const fx = fromX - b.x, fy = fromY - b.y;
        if (dx * dx + dy * dy < fx * fx + fy * fy) return true;
      }
    }
  }
  return false;
}

function moveCircle(g, e, dx, dy, r) {
  if (dx && !moveBlocked(g, e.x, e.y, e.x + dx, e.y, r)) e.x += dx;
  if (dy && !moveBlocked(g, e.x, e.y, e.x, e.y + dy, r)) e.y += dy;
}

function dist2(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function norm(dx, dy) {
  const d = Math.hypot(dx, dy) || 1;
  return [dx / d, dy / d, d];
}

// Sight stops at rock and trees — shots fly over water and sandbags, so
// enemies must be able to see (and shoot) across those too.
function blocksSight(c) { return c === '#' || c === 'T'; }

// True when the straight segment between two points crosses no blocking tile.
function hasLoS(g, ax, ay, bx, by, blocks = blocksMove) {
  const dx = bx - ax, dy = by - ay;
  const d = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(d / (TILE / 3)));
  for (let i = 1; i < steps; i++) {
    if (blocks(tileAt(g, ax + (dx * i) / steps, ay + (dy * i) / steps))) return false;
  }
  return true;
}

// In the dark, enemy sight is additionally capped at 8 tiles regardless of
// line of sight. Lit levels are untouched.
const DARK_SIGHT_TILES = 8;

function canSee(g, e, tgt) {
  if (g.dark && dist2(e, tgt) > (TILE * DARK_SIGHT_TILES) ** 2) return false;
  return hasLoS(g, e.x, e.y, tgt.x, tgt.y, blocksSight);
}

function tileBlocked(g, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) return true;
  if (blocksMove(g.grid[ty][tx])) return true;
  // A* routes around built structures instead of funneling chasers into them
  if (g.builds) {
    for (const b of g.builds) {
      if (b.built && b.kind !== 'farm' && Math.floor(b.x / TILE) === tx && Math.floor(b.y / TILE) === ty) return true;
    }
  }
  return false;
}

// True when the straight segment passes through a built structure's circle —
// straight-line steering must fall back to A* in that case or enemies wedge
// against pylons forever.
function segmentHitsBuild(g, ax, ay, bx, by, r) {
  if (!g.builds) return false;
  for (const b of g.builds) {
    if (!b.built || b.kind === 'farm') continue;
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy || 1;
    let t = ((b.x - ax) * dx + (b.y - ay) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t, py = ay + dy * t;
    const rr = BUILD_RADIUS + r;
    if ((px - b.x) ** 2 + (py - b.y) ** 2 < rr * rr) return true;
  }
  return false;
}

// Deterministic A* over the tile grid. Diagonals allowed unless they cut a corner.
// Returns pixel-space waypoints (excluding the start tile), or null when no route
// exists within the expansion budget.
function findPath(g, sx, sy, gx, gy, maxExpand = 2400) {
  if (sx === gx && sy === gy) return [];
  if (tileBlocked(g, gx, gy)) return null;
  const W = g.w;
  const heap = [];
  let seq = 0;
  const push = n => {
    heap.push(n);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].f < n.f || (heap[p].f === n.f && heap[p].seq < n.seq)) break;
      heap[i] = heap[p]; i = p;
    }
    heap[i] = n;
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && (heap[l].f < last.f || (heap[l].f === last.f && heap[l].seq < last.seq))) m = l;
        const mb = m === i ? last : heap[m];
        if (r < heap.length && (heap[r].f < mb.f || (heap[r].f === mb.f && heap[r].seq < mb.seq))) m = r;
        if (m === i) break;
        heap[i] = heap[m]; i = m;
      }
      heap[i] = last;
    }
    return top;
  };
  const oct = (x, y) => {
    const ax = Math.abs(x - gx), ay = Math.abs(y - gy);
    return ax + ay - 0.5858 * Math.min(ax, ay);
  };
  const gScore = new Map();
  const came = new Map();
  const start = sy * W + sx;
  gScore.set(start, 0);
  push({ x: sx, y: sy, f: oct(sx, sy), seq: seq++ });
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let expanded = 0;
  while (heap.length && expanded < maxExpand) {
    const cur = pop();
    const ck = cur.y * W + cur.x;
    expanded++;
    if (cur.x === gx && cur.y === gy) {
      const path = [];
      let k = ck;
      while (k !== start) {
        path.push({ x: (k % W + 0.5) * TILE, y: (Math.floor(k / W) + 0.5) * TILE });
        k = came.get(k);
      }
      return path.reverse();
    }
    const cg = gScore.get(ck);
    for (const [dx, dy] of DIRS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (tileBlocked(g, nx, ny)) continue;
      if (dx && dy && (tileBlocked(g, cur.x + dx, cur.y) || tileBlocked(g, cur.x, cur.y + dy))) continue;
      const nk = ny * W + nx;
      const ng = cg + (dx && dy ? 1.4142 : 1);
      if (ng < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, ng);
        came.set(nk, ck);
        push({ x: nx, y: ny, f: ng + oct(nx, ny), seq: seq++ });
      }
    }
  }
  return null;
}

function wakeEnemy(g, e, ripple = true) {
  if (e.dead || e.awake) return;
  e.awake = true;
  // fresh chase: forget any stuck-tracking left from a previous engagement
  e.stuckX = undefined;
  e.stuckY = undefined;
  e.chaseStuckT = 0;
  e.chaseKicked = false;
  g.events.push({ type: 'alert', x: e.x, y: e.y, kind: e.kind });
  if (ripple) {
    const r2 = (TILE * ALERT_RIPPLE) ** 2;
    for (const o of g.enemies) {
      if (!o.awake && !o.dead && dist2(e, o) < r2) wakeEnemy(g, o, false);
    }
  }
}

// Steer toward the target: straight when walkable in a straight line,
// A* waypoints when not. A failed search respects the repath cooldown so a
// stranded enemy can't burn a full A* budget every tick.
function moveToward(g, e, tgt, dt, speed = e.speed, r = ENEMY_R) {
  if (hasLoS(g, e.x, e.y, tgt.x, tgt.y) && !segmentHitsBuild(g, e.x, e.y, tgt.x, tgt.y, r)) {
    e.path = null;
    e.repathT = 0;
    // a clear straight line means not wedged: reset the anti-wedge tracker
    e.stuckX = undefined;
    e.stuckY = undefined;
    e.chaseStuckT = 0;
    e.chaseKicked = false;
    const [fx, fy] = norm(tgt.x - e.x, tgt.y - e.y);
    e.fx = fx; e.fy = fy;
    moveCircle(g, e, fx * speed * dt, fy * speed * dt, r);
    return;
  }
  e.repathT -= dt;
  if (e.repathT <= 0 || (e.path && e.pathI >= e.path.length)) {
    // Core-marching night waves and x100-aggro hunters cross the whole map;
    // the stock 2400 budget exhausts on long detours and they wedge at the
    // first wall — give them a deep search instead.
    const budget = (e.targetCore || e.aggro >= TILE * 100) ? 8000 : 2400;
    e.path = findPath(
      g,
      Math.floor(e.x / TILE), Math.floor(e.y / TILE),
      Math.floor(tgt.x / TILE), Math.floor(tgt.y / TILE),
      budget
    );
    e.pathI = 0;
    e.repathT = 0.6 + (e.id % 5) * 0.08;
  }
  let wp = e.path && e.path[e.pathI];
  while (wp && Math.hypot(wp.x - e.x, wp.y - e.y) < TILE * 0.45) {
    e.pathI++;
    wp = e.path[e.pathI];
  }
  const aim = wp || tgt;
  const [fx, fy] = norm(aim.x - e.x, aim.y - e.y);
  e.fx = fx; e.fy = fy;
  moveCircle(g, e, fx * speed * dt, fy * speed * dt, r);
  // Anti-wedge (chasers only — returning home has its own giveup in
  // stepEnemy): a chaser that has not MOVED 0.5px in 3s is wedged. Progress
  // is measured positionally, not by distance-to-target — a legitimate long
  // detour walks AWAY from the target for a while and must never trip this.
  // First trip forces a repath (path cleared, cooldown zeroed); still pinned
  // 3s after the kick, it gives up and re-sleeps exactly like the returning
  // giveup. Never teleport — determinism would survive it, feel would not.
  if (!e.returning) {
    if (e.stuckX === undefined || Math.hypot(e.x - e.stuckX, e.y - e.stuckY) > 0.5) {
      e.stuckX = e.x;
      e.stuckY = e.y;
      e.chaseStuckT = 0;
      e.chaseKicked = false;
    } else {
      e.chaseStuckT = (e.chaseStuckT || 0) + dt;
      if (!e.chaseKicked && e.chaseStuckT >= 3) {
        e.chaseKicked = true;
        e.path = null;
        e.repathT = 0;
      } else if (e.chaseKicked && e.chaseStuckT >= 6) {
        e.awake = false;
        e.returning = false;
        e.stuckX = undefined;
        e.stuckY = undefined;
        e.chaseStuckT = 0;
        e.chaseKicked = false;
      }
    }
  }
}

function countNear(g, e, r) {
  const r2 = r * r;
  let n = 0;
  for (const o of g.enemies) if (!o.dead && dist2(e, o) < r2) n++;
  return n;
}

// On big maps, respawn beside a living teammate instead of trekking back from
// the level start. Deterministic: first active player in pid order, nearest
// open tile in ring-scan order.
function respawnSpot(g) {
  const fallback = g.spawns[0] || { x: TILE * 2, y: TILE * 2 };
  if (g.arcade) return fallback;
  const ally = g.players.find(q => q.state === 'active');
  if (!ally) return fallback;
  for (let r = 1; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = ally.x + dx * TILE, y = ally.y + dy * TILE;
        if (x > TILE && y > TILE && x < (g.w - 1) * TILE && y < (g.h - 1) * TILE && !collides(g, x, y, PLAYER_R)) {
          return { x, y };
        }
      }
    }
  }
  return { x: ally.x, y: ally.y };
}

function fireWeapon(g, shooter, weapon, who, target = null) {
  const [fx, fy] = target ? norm(target.x - shooter.x, target.y - shooter.y) : [shooter.fx, shooter.fy];
  const base = Math.atan2(fy, fx);
  const n = weapon.count || 1;
  const spread = ((weapon.spreadDeg || 0) * Math.PI) / 180;
  const speed = Math.max(0.1, weapon.projSpeed || 8) * TILE;
  const ttl = ((weapon.range ?? 5) * TILE) / speed;
  const pierce = weapon.pierce === true ? 99 : (weapon.pierce || 0);
  const aoeRadius = (weapon.aoeRadius || 0) * TILE;
  for (let i = 0; i < n; i++) {
    // full rings space shots by spread/n (spread/(n-1) would duplicate the
    // rear shot and leave a gap along the facing direction)
    const fullRing = spread >= Math.PI * 2 - 1e-6;
    const a = n === 1 ? base
      : fullRing ? base + (spread * i) / n
      : base - spread / 2 + (spread * i) / (n - 1);
    const curve = (weapon.curve || 0) * (n > 1 && i % 2 ? -1 : 1);
    g.shots.push({
      id: g.nextShotId++,
      x: shooter.x + Math.cos(a) * (PLAYER_R + 4),
      y: shooter.y + Math.sin(a) * (PLAYER_R + 4),
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      ttl,
      // weapon tokens (chest/shop loot) raise all of a player's outgoing
      // damage; nobody else carries dmgBonus so +0 leaves classics untouched
      dmg: weapon.damage + (shooter.dmgBonus || 0),
      who,
      overWalls: !!weapon.overWalls,
      pierce,
      aoeRadius,
      curve,
      radius: weapon.radius || SHOT_R,
      kind: weapon.kind || weapon.name || 'shot',
      // pvp bookkeeping: who fired, and for which team (friendly fire is off)
      pid: shooter.pid,
      team: shooter.team,
      hits: [],
    });
  }
  g.events.push({ type: 'shoot', x: shooter.x, y: shooter.y, who, weapon: weapon.kind || weapon.name || 'shot' });
}

function enemyWeapon(kind) {
  if (kind === 'sniper') return { kind: 'sniper', damage: 1, projSpeed: 12, range: 11, cooldown: 0, count: 1 };
  if (kind === 'boss') return { kind: 'boss', damage: 1, projSpeed: 6.8, range: 9, cooldown: 0, count: 5, spreadDeg: 42 };
  if (kind === 'spawner') return { kind: 'spore', damage: 1, projSpeed: 4.8, range: 6, cooldown: 0, count: 1 };
  return { kind: 'arrow', damage: 1, projSpeed: 5.5, range: 8, cooldown: 0, count: 1 };
}

// Drop any carried flag on the spot. One code path for every drop that isn't
// a return: carrier going down, and climbing onto a mount (a CTF flag never
// rides a stag). The flag lies for FLAG_DROP_T, then ticks home as usual.
function dropFlags(g, p) {
  for (const f of g.flags) {
    if (f.carrier === p.pid) {
      f.carrier = null;
      f.atBase = false;
      f.x = p.x;
      f.y = p.y;
      f.dropT = FLAG_DROP_T;
      g.events.push({ type: 'flagDrop', team: f.team, pid: p.pid, x: f.x, y: f.y });
    }
  }
}

// Going down vacates whatever the player held: mount, watchtower, flag, shop.
function releaseHoldings(g, p) {
  p.shopping = false;
  if (p.riding) {
    const v = g.vehicles.find(v => v.id === p.riding);
    if (v) v.rider = null;
    p.riding = null;
  }
  if (p.towerId != null) {
    const t = g.towers[p.towerId];
    if (t) t.occupant = null;
    p.towerId = null;
  }
  dropFlags(g, p);
}

function downPlayer(g, p) {
  if (p.state !== 'active' || p.invuln > 0) return;
  releaseHoldings(g, p);
  // BR: no rescue, no captive body — straight out, last one standing wins.
  if (g.mode === 'br') {
    p.state = 'out';
    p.dashT = 0;
    p.stimT = 0;
    g.lastOut = p.pid;
    const remaining = g.players.filter(q => q.state === 'active').length;
    g.events.push({ type: 'eliminated', pid: p.pid, remaining, x: p.x, y: p.y });
    return;
  }
  // CTF: respawn at the team flag stand keeping the same operative; rosters
  // are never consumed in pvp.
  if (g.mode === 'ctf') {
    p.state = 'down';
    p.respawn = CTF_RESPAWN;
    p.dashT = 0;
    p.stimT = 0;
    g.events.push({ type: 'down', x: p.x, y: p.y });
    return;
  }
  g.captives.push({ id: 'c' + g.nextCaptiveId++, charId: p.charId, x: p.x, y: p.y, owner: null, fromPlayer: true });
  for (const c of g.captives) if (c.owner === p.pid) c.owner = null;
  g.events.push({ type: 'down', x: p.x, y: p.y });
  p.charId = null;
  p.state = 'down';
  p.respawn = RESPAWN_DELAY;
  p.dashT = 0;
  p.stimT = 0;
}

// Every source of player damage (contact, enemy shots, explosions, later the
// BR zone) routes through here. Arcade keeps the classic 1-hit rule exactly;
// survival maps spend shield pips first, then hp, with a short hit-grace.
function damagePlayer(g, p, dmg = 1) {
  if (p.state !== 'active' || p.invuln > 0) return;
  if (g.arcade || p.maxHp === undefined) { downPlayer(g, p); return; }
  for (let i = 0; i < dmg; i++) {
    if (p.shield > 0) p.shield--;
    else p.hp--;
  }
  if (p.hp <= 0) { downPlayer(g, p); return; }
  p.invuln = Math.max(p.invuln, HIT_INVULN);
  g.events.push({ type: 'playerHit', pid: p.pid, x: p.x, y: p.y, hp: p.hp, shield: p.shield });
}

// pvp damage funnel: routes through damagePlayer (invuln/shield rules apply)
// and credits the attacker with a kill when the hit downs/eliminates the
// victim. Per-player kills break simultaneous-wipe ties in BR.
function pvpHit(g, victim, dmg, attackerPid) {
  const was = victim.state;
  damagePlayer(g, victim, dmg);
  if (was === 'active' && victim.state !== 'active' && attackerPid !== undefined) {
    const att = g.players.find(q => q.pid === attackerPid);
    if (att) att.kills = (att.kills || 0) + 1;
  }
}

// --- shard pools -----------------------------------------------------------
// CTF runs per-team pools (g.teamShards [t0, t1]): collectors credit their
// own team and spends (shop/build/repair/upgrade/hire) debit the spender's
// team. Every other mode — BR included, by design: one shared pot keeps the
// free-for-all scramble honest — uses the single squad pool g.shards.
function getShards(g, p) {
  return g.teamShards && p && p.team !== undefined ? g.teamShards[p.team] : g.shards;
}
function addShards(g, p, n) {
  if (g.teamShards && p && p.team !== undefined) g.teamShards[p.team] += n;
  else g.shards += n;
}

function freeChars(g) {
  const used = new Set();
  for (const p of g.players) if (p.charId) used.add(p.charId);
  for (const c of g.captives) used.add(c.charId);
  for (const id of g.rescued) used.add(id);
  return g.roster.filter(id => !used.has(id));
}

function extractPlayer(g, p) {
  if (p.state !== 'active') return;
  releaseHoldings(g, p);
  p.state = 'extracted';
  g.score += 250;
  let rescuedHere = 0;
  for (let i = g.captives.length - 1; i >= 0; i--) {
    if (g.captives[i].owner === p.pid) {
      g.rescued.push(g.captives[i].charId);
      g.captives.splice(i, 1);
      rescuedHere++;
      g.score += 500;
    }
  }
  g.events.push({ type: 'extract', x: p.x, y: p.y, rescued: rescuedHere, points: 250 + rescuedHere * 500 });
}

// Act on a closed chest: shards join the squad pool; cracker/medkit fill the
// opener's item slot (same kind stacks, a different kind is swapped out);
// shield tops the pips; token raises the opener's damage (+2 cap).
function openChest(g, c, p) {
  c.opened = true;
  const ev = { type: 'chest', x: c.x, y: c.y, loot: c.loot, pid: p.pid };
  if (c.loot === 'shards') {
    addShards(g, p, c.amount); // ctf: credits the opener's team pool
    ev.amount = c.amount;
  } else if (c.loot === 'shield') {
    if (p.shield !== undefined) p.shield = Math.min(SHIELD_MAX, p.shield + 2);
  } else if (c.loot === 'token') {
    p.dmgBonus = Math.min(2, (p.dmgBonus || 0) + 1);
  } else { // cracker | medkit
    if (p.item && p.item.kind === c.loot) p.item.count += c.amount;
    else p.item = { kind: c.loot, count: c.amount };
  }
  g.events.push(ev);
}

// Act-harvest a stage-3 farm: a medkit for the harvester (stacking), or +1 hp
// on the spot when the slot is full of something else and they are hurt.
// A full slot of another kind at full hp leaves the crop standing — the
// refusal cues a 'slotFull' event (once per press; harvest runs on act edges).
function harvestFarm(g, b, p) {
  if (!p.item) p.item = { kind: 'medkit', count: 1 };
  else if (p.item.kind === 'medkit') p.item.count++;
  else if (p.hp !== undefined && p.hp < p.maxHp) p.hp++;
  else { g.events.push({ type: 'slotFull', x: b.x, y: b.y }); return; }
  b.stage = 0;
  b.growT = 0;
  g.events.push({ type: 'harvest', x: b.x, y: b.y, pid: p.pid });
}

function addKillScore(g, e) {
  const points = (e.score || 100) * g.combo;
  g.kills++;
  g.score += points;
  g.events.push({ type: 'die', x: e.x, y: e.y, kind: e.kind, points, combo: g.combo });
  g.combo = Math.min(9, g.combo + 1);
  g.comboT = 2;
}

// Split mutants burst into two skitters. Deterministic placement: fixed angle
// fans (opposed per twin) with a collide fallback, capped at the global 90.
function splitSpawn(g, e, k) {
  if (g.enemies.length >= 90) return;
  const base = k === 0 ? 0 : Math.PI;
  for (const a of [base, base + Math.PI / 2, base + Math.PI / 4, base - Math.PI / 4]) {
    const x = e.x + Math.cos(a) * TILE * 0.6;
    const y = e.y + Math.sin(a) * TILE * 0.6;
    if (!collides(g, x, y, ENEMY_R)) {
      const sk = makeEnemy('w', x, y, g.nextEnemyId++);
      sk.awake = true;
      if (e.targetCore) { sk.targetCore = true; sk.aggro *= 100; }
      g.enemies.push(sk);
      g.events.push({ type: 'spawnEnemy', x, y, kind: sk.kind });
      return;
    }
  }
}

function killEnemy(g, e) {
  if (e.dead) return;
  e.dead = true;
  addKillScore(g, e);
  // Every kill drops a shard pickup at the corpse. Deterministic, always.
  g.drops.push({ x: e.x, y: e.y, amount: SHARD_DROPS[e.kind] || 1, ttl: DROP_TTL });
  // Mutant deaths: volatile pops, split twins out.
  if (e.mutation === 'volatile') {
    g.events.push({ type: 'volatile', x: e.x, y: e.y, radius: TILE * 1.2 });
    const r2 = (TILE * 1.2) ** 2;
    for (const p of g.players) {
      if (p.state === 'active' && p.invuln <= 0 && dist2(e, p) <= r2) damagePlayer(g, p, 2);
    }
  } else if (e.mutation === 'split') {
    splitSpawn(g, e, 0);
    splitSpawn(g, e, 1);
  }
}

function damageEnemy(g, e, dmg, x, y, cause) {
  if (e.dead) return false;
  wakeEnemy(g, e);
  e.returning = false; // a hit always re-engages an enemy walking home
  e.hp -= dmg;
  e.hurt = 0.14;
  g.events.push({ type: 'hit', x: x ?? e.x, y: y ?? e.y, kind: e.kind, hp: Math.max(0, e.hp), cause });
  if (e.hp <= 0) {
    killEnemy(g, e);
    return true;
  }
  return false;
}

function shieldBlocks(e, s) {
  if (e.kind !== 'bulwark') return false;
  const sp = Math.hypot(s.vx, s.vy) || 1;
  const incomingX = -s.vx / sp;
  const incomingY = -s.vy / sp;
  return incomingX * e.fx + incomingY * e.fy > 0.35;
}

function explode(g, s, skipEnemy = null) {
  if (!s.aoeRadius || s.exploded) return;
  s.exploded = true;
  g.events.push({ type: 'explode', x: s.x, y: s.y, radius: s.aoeRadius, who: s.who });
  const r2 = s.aoeRadius * s.aoeRadius;
  if (s.who === 'p') {
    for (const e of g.enemies) {
      if (e.dead || e === skipEnemy) continue;
      if (dist2(s, e) <= r2) damageEnemy(g, e, s.dmg, e.x, e.y, s.kind);
    }
    // pvp only: player AoE wounds OTHER-team operatives caught in the blast
    // (never same-team; invuln/shield rules ride damagePlayer as usual)
    if ((g.mode === 'ctf' || g.mode === 'br') && s.pid !== undefined) {
      for (const q of g.players) {
        if (q.state !== 'active' || q.pid === s.pid || q.team === s.team || q.invuln > 0) continue;
        if (dist2(s, q) <= r2) pvpHit(g, q, s.dmg, s.pid);
      }
    }
  } else {
    for (const p of g.players) {
      if (p.state === 'active' && p.invuln <= 0 && dist2(s, p) <= r2) damagePlayer(g, p);
    }
  }
}

function nearestTarget(g, e) {
  // A landed lure cracker overrides every other target for enemies inside its
  // pull radius — they wake and converge on it until it detonates.
  if (g.crackers && g.crackers.length) {
    const r2 = (TILE * CRACKER_LURE) ** 2;
    for (const c of g.crackers) {
      if (!c.landed) continue;
      const d = dist2(e, c);
      if (d < r2) {
        wakeEnemy(g, e);
        e.returning = false;
        return [{ x: c.x, y: c.y, nonPlayer: true }, d];
      }
    }
  }
  // Bastion night-wave enemies march on the base core (they still gnaw
  // structures and hit players en route via the existing melee rules).
  if (e.targetCore && g.core && g.core.hp > 0) {
    return [{ x: g.core.x, y: g.core.y, nonPlayer: true }, dist2(e, g.core)];
  }
  let tgt = null, best = Infinity;
  for (const p of g.players) {
    if (p.state !== 'active') continue;
    const d = dist2(e, p);
    if (d < best) { best = d; tgt = p; }
  }
  return [tgt, best];
}

function contactPlayer(g, e, best, tgt) {
  if (!tgt) return;
  const rr = (PLAYER_R + ENEMY_R) ** 2;
  if (tgt.nonPlayer) {
    // marching on a lure or the core: melee still clips any player en route
    for (const p of g.players) {
      if (p.state === 'active' && dist2(e, p) < rr) { damagePlayer(g, p); return; }
    }
    return;
  }
  if (best < rr) damagePlayer(g, tgt);
}

function spawnSkitter(g, e, tgt) {
  const angles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI / 4, -Math.PI / 4];
  for (const a of angles) {
    const x = e.x + Math.cos(a) * TILE * 0.75;
    const y = e.y + Math.sin(a) * TILE * 0.75;
    if (!collides(g, x, y, ENEMY_R)) {
      const sk = makeEnemy('w', x, y, g.nextEnemyId++);
      sk.awake = true;
      if (tgt) {
        [sk.fx, sk.fy] = norm(tgt.x - x, tgt.y - y);
      }
      g.enemies.push(sk);
      g.events.push({ type: 'spawnEnemy', x, y, kind: sk.kind });
      return;
    }
  }
}

// Melee-class enemies in contact with a blocking built structure chew it down:
// 1 hp per 0.9s. Pylons are indestructible once built. Returns true while the
// enemy is gnawing so its step can stop there.
function structMaxHp(kind, level) {
  const t = STRUCT_HP[kind];
  return t ? t[level - 1] : buildMaxHp(kind);
}

// A destroyed watchtower throws its gunner out and loses its upgrades.
function towerDown(g, t) {
  for (const p of g.players) {
    if (p.towerId != null && g.towers[p.towerId] === t) p.towerId = null;
  }
  t.occupant = null;
  t.hp = 0;
  t.level = 1;
  t.maxHp = structMaxHp('tower', 1);
  t.progress = 0;
  t.invested = 0;
  g.events.push({ type: 'buildDown', x: t.x, y: t.y, kind: 'tower' });
}

function attackBuilds(g, e, dt) {
  if (!MELEE_KINDS.has(e.kind) || (!g.builds.length && !g.towers.length)) return false;
  let touching = null;
  let tower = null;
  const rr = BUILD_RADIUS + ENEMY_R + 3;
  for (const b of g.builds) {
    if (!b.built || b.kind === 'pylon' || b.kind === 'farm') continue; // farms are trampled, not gnawed
    if (dist2(e, b) < rr * rr) { touching = b; break; }
  }
  if (!touching) {
    for (const t of g.towers) {
      if (t.hp <= 0) continue;
      if (dist2(e, t) < rr * rr) { tower = t; break; }
    }
  }
  if (!touching && !tower) return false;
  if (e.hitCool <= 0) {
    e.hitCool = 0.9;
    const s = touching || tower;
    s.hp -= 1;
    g.events.push({ type: 'buildHit', x: s.x, y: s.y });
    if (s.hp <= 0) {
      if (tower) {
        towerDown(g, tower);
      } else {
        s.hp = 0;
        s.built = false;
        s.progress = 0;
        s.paid = 0;
        // a flattened structure loses its upgrades too
        if (s.level) { s.level = 1; s.maxHp = structMaxHp(s.kind, 1); }
        g.events.push({ type: 'buildDown', x: s.x, y: s.y, kind: s.kind });
      }
    }
  }
  return true;
}

// The base core is gnawed exactly like a structure: 1 dmg per 0.9s of melee
// contact. Loss (hp <= 0) is judged in step()'s end conditions.
function attackCore(g, e, dt) {
  if (!g.core || g.core.hp <= 0 || !MELEE_KINDS.has(e.kind)) return false;
  const rr = CORE_R + ENEMY_R + 3;
  if (dist2(e, g.core) >= rr * rr) return false;
  if (e.hitCool <= 0) {
    e.hitCool = 0.9;
    g.core.hp -= 1;
    g.events.push({ type: 'coreHit', x: g.core.x, y: g.core.y, hp: Math.max(0, g.core.hp) });
  }
  return true;
}

function stepEnemy(g, e, dt) {
  if (e.dead) return;
  if (e.hurt > 0) e.hurt -= dt;
  if (e.hitCool > 0) e.hitCool -= dt;
  const [tgt, best] = nearestTarget(g, e);
  if (!tgt) return;

  // Dark missions shrink every aggro radius to 75% (leash shrinks with it).
  const aggro = g.dark ? e.aggro * 0.75 : e.aggro;

  // Sleeping enemies hold their post until a player is seen inside aggro
  // range, bumps into them, or damages them (handled in damageEnemy).
  if (!e.awake) {
    if (best < aggro * aggro && canSee(g, e, tgt)) wakeEnemy(g, e);
    else if (best < (TILE * 2.2) ** 2) wakeEnemy(g, e);
    else return;
  }

  // Leash (big maps only — arcade keeps classic behavior byte-identical):
  // an awake enemy whose nearest target drifts beyond aggro*1.8 disengages.
  // Mobile kinds walk back to their post and fall asleep there; stationary
  // kinds simply go back to ambush sleep on the spot.
  if (!g.arcade) {
    const leash = aggro * LEASH_MULT;
    if (!e.returning && best > leash * leash) {
      if (STATIONARY_KINDS.has(e.kind)) { e.aimT = 0; e.awake = false; return; }
      e.returning = true;
    }
    if (e.returning) {
      if ((best < aggro * aggro && canSee(g, e, tgt)) || best < (TILE * 2.2) ** 2) {
        e.returning = false;
      } else {
        if (Math.hypot(e.homeX - e.x, e.homeY - e.y) < TILE * 0.6) {
          e.returning = false;
          e.awake = false;
          return;
        }
        // gnaw through barricades blocking the way home (else a wall built
        // behind a returning enemy pins it forever)
        if (attackBuilds(g, e, dt)) return;
        const dHome = Math.hypot(e.homeX - e.x, e.homeY - e.y);
        moveToward(g, e, { x: e.homeX, y: e.homeY }, dt);
        // wedged against something indestructible (a pylon): give up and
        // fall asleep on the spot instead of pushing forever
        if (dHome < (e.bestHome ?? Infinity) - 0.5) {
          e.bestHome = dHome;
          e.stuckT = 0;
        } else {
          e.stuckT = (e.stuckT || 0) + dt;
          if (e.stuckT > 2.5) {
            e.returning = false;
            e.awake = false;
            e.stuckT = 0;
            e.bestHome = undefined;
            return;
          }
        }
        return; // no attacking players while returning
      }
    }
  }

  const [fx, fy, d] = norm(tgt.x - e.x, tgt.y - e.y);
  e.fx = fx; e.fy = fy;

  if (attackBuilds(g, e, dt)) return;
  if (attackCore(g, e, dt)) return;

  if (e.kind === 'grunt' || e.kind === 'skitter' || e.kind === 'bulwark') {
    if (g.arcade) {
      moveCircle(g, e, e.fx * e.speed * dt, e.fy * e.speed * dt, ENEMY_R);
      contactPlayer(g, e, best, tgt);
    } else {
      moveToward(g, e, tgt, dt);
      contactPlayer(g, e, dist2(e, tgt), tgt);
    }
    return;
  }

  if (e.kind === 'charger') {
    if (e.state === 'windup') {
      e.windup -= dt;
      if (e.windup <= 0) {
        e.state = 'dash';
        e.dashT = 0.34;
        e.dashFx = e.chargeFx;
        e.dashFy = e.chargeFy;
        g.events.push({ type: 'dash', x: e.x, y: e.y, kind: e.kind });
      }
      return;
    }
    if (e.state === 'dash') {
      const v = 5.4 * TILE * dt;
      moveCircle(g, e, e.dashFx * v, e.dashFy * v, ENEMY_R);
      e.fx = e.dashFx; e.fy = e.dashFy;
      contactPlayer(g, e, dist2(e, tgt), tgt);
      e.dashT -= dt;
      if (e.dashT <= 0) e.state = 'idle';
      return;
    }
    e.cool -= dt;
    if (d < e.range && e.cool <= 0 && (g.arcade || canSee(g, e, tgt))) {
      e.state = 'windup';
      e.windup = 0.55;
      e.chargeFx = e.fx;
      e.chargeFy = e.fy;
      e.cool = 2.2;
      g.events.push({ type: 'telegraph', x: e.x, y: e.y, tx: tgt.x, ty: tgt.y, kind: e.kind });
    } else if (g.arcade) {
      moveCircle(g, e, e.fx * e.speed * dt, e.fy * e.speed * dt, ENEMY_R);
    } else {
      moveToward(g, e, tgt, dt);
    }
    contactPlayer(g, e, dist2(e, tgt), tgt);
    return;
  }

  if (e.kind === 'archer' || e.kind === 'spawner') {
    e.cool -= dt;
    if (e.cool <= 0 && d < (e.range || 7 * TILE) && (g.arcade || canSee(g, e, tgt))) {
      fireWeapon(g, e, enemyWeapon(e.kind), 'e', tgt);
      e.cool = e.kind === 'spawner' ? 2.1 : 2.0;
    }
    if (e.kind === 'spawner') {
      e.spawnCool -= dt;
      const spawnOk = g.arcade
        ? g.enemies.length < 36
        : g.enemies.length < 90 && countNear(g, e, TILE * 8) < 6;
      if (e.spawnCool <= 0 && spawnOk) {
        spawnSkitter(g, e, tgt);
        e.spawnCool = g.arcade ? 3.0 : 6.5;
      }
    }
    return;
  }

  if (e.kind === 'sniper') {
    if (e.aimT > 0) {
      e.aimT -= dt;
      e.aimX = tgt.x;
      e.aimY = tgt.y;
      if (e.aimT <= 0) {
        fireWeapon(g, e, enemyWeapon(e.kind), 'e', tgt);
        e.cool = 2.8;
      }
      return;
    }
    e.cool -= dt;
    if (e.cool <= 0 && d < e.range && (g.arcade || canSee(g, e, tgt))) {
      e.aimT = 0.9;
      e.aimX = tgt.x;
      e.aimY = tgt.y;
      g.events.push({ type: 'aim', x: e.x, y: e.y, tx: tgt.x, ty: tgt.y, kind: e.kind });
    }
    return;
  }

  if (e.kind === 'boss') {
    e.cool -= dt;
    e.spawnCool -= dt;
    const phase = e.hp <= e.maxHp * 0.5 ? 2 : 1;
    const chase = phase === 2 ? 0.8 : 0.5;
    if (g.arcade) {
      moveCircle(g, e, e.fx * TILE * chase * dt, e.fy * TILE * chase * dt, ENEMY_R + 6);
    } else {
      moveToward(g, e, tgt, dt, TILE * chase, ENEMY_R + 6);
    }
    contactPlayer(g, e, dist2(e, tgt), tgt);
    if (e.cool <= 0 && d < e.range) {
      fireWeapon(g, e, enemyWeapon(e.kind), 'e', tgt);
      e.cool = phase === 2 ? 0.75 : 1.25;
    }
    const spawnOk = g.arcade
      ? g.enemies.length < 34
      : g.enemies.length < 90 && countNear(g, e, TILE * 9) < 8;
    if (e.spawnCool <= 0 && spawnOk) {
      spawnSkitter(g, e, tgt);
      e.spawnCool = g.arcade
        ? (phase === 2 ? 2.2 : 3.8)
        : (phase === 2 ? 4.5 : 7);
    }
  }
}

// Deterministic wave entry points: for each position along the given map
// edge, the outermost passable tile in the 2-tile border band is a candidate
// (grid order, stable). The n spawn points are chosen evenly spaced across
// the candidate list. Pure grid math — no randomness.
function waveEntryPoints(g, edge, n) {
  const horiz = edge === 'n' || edge === 's';
  const len = horiz ? g.w : g.h;
  const cands = [];
  for (let i = 0; i < len; i++) {
    for (let depth = 0; depth < 2; depth++) {
      let tx, ty;
      if (edge === 'n') { tx = i; ty = depth; }
      else if (edge === 's') { tx = i; ty = g.h - 1 - depth; }
      else if (edge === 'w') { tx = depth; ty = i; }
      else { tx = g.w - 1 - depth; ty = i; }
      if (!blocksMove(g.grid[ty][tx])) {
        cands.push({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE });
        break;
      }
    }
  }
  const pts = [];
  if (!cands.length) return pts;
  for (let i = 0; i < n; i++) pts.push(cands[Math.floor(((i + 0.5) * cands.length) / n)]);
  return pts;
}

// Fire every wave whose time has come: spawn its letters at the edge entry
// points as awake hunters (aggro x100 — they never leash home), respecting
// the global 90-enemy cap. Each wave fires exactly once.
function maybeOpenGate(g) {
  if (!g.gate || g.gate.open) return;
  if (g.gate.built >= g.gate.need && g.elapsed >= g.gate.after) {
    g.gate.open = true;
    g.events.push({ type: 'gateOpen', x: g.exitX, y: g.exitY });
  }
}

function stepWaves(g) {
  if (!g.waves || !g.waves.length) return;
  for (const w of g.waves) {
    if (w.fired || g.elapsed < w.at) continue;
    w.fired = true;
    const room = Math.max(0, 90 - g.enemies.length);
    const count = Math.min(w.letters.length, room); // drop overflow
    const pts = waveEntryPoints(g, w.edge, count);
    for (let i = 0; i < pts.length; i++) {
      const e = makeEnemy(w.letters[i], pts[i].x, pts[i].y, g.nextEnemyId++);
      e.awake = true;
      e.aggro *= 100;
      g.enemies.push(e);
    }
    // x,y = center of the entry band, for FX/audio.
    const cx = w.edge === 'w' ? TILE : w.edge === 'e' ? (g.w - 1) * TILE : g.w * TILE / 2;
    const cy = w.edge === 'n' ? TILE : w.edge === 's' ? (g.h - 1) * TILE : g.h * TILE / 2;
    g.events.push({ type: 'wave', edge: w.edge, count: pts.length, x: cx, y: cy });
  }
}

// --- bastion mode: day/night cycle, dusk waves, mutants -------------------

// Wave composition scales with the night: base 6 grunts/skitters on night 1
// up to 14 mixed (chargers from night 3, bulwarks from night 4) on night 5+.
// Size also scales with the squad: ceil(base * (0.6 + 0.2 * players)) — 0.8x
// solo, 1.0x duo, 1.4x for a full couch. The global 90 cap still rules.
function bastionWaveLetters(n, players = 1) {
  const base = Math.min(14, 4 + n * 2);
  const size = Math.ceil(base * (0.6 + 0.2 * players));
  let s = '';
  for (let i = 0; i < size; i++) {
    if (n >= 4 && i % 5 === 4) s += 's';
    else if (n >= 3 && i % 4 === 3) s += 'r';
    else s += i % 3 === 2 ? 'w' : 'g';
  }
  return s;
}

function applyMutation(e, mut) {
  if (!mut) return;
  e.mutation = mut;
  if (mut === 'feral') e.speed *= 1.5;
  else if (mut === 'bulk') { e.hp *= 2; e.maxHp *= 2; e.speed *= 0.75; }
  // volatile and split trigger on death (killEnemy)
}

// One wave per dusk from a rotating cardinal edge; blood moons pour a full
// wave in from two different edges, mutate every enemy and add +1 hp.
// Mutation roll is the contract formula (nightNo*31+i)%5 over
// [none, feral, bulk, volatile, split]; blood moons re-roll 'none' as %4.
function spawnNightWave(g) {
  const n = g.cycle.nightNo;
  const letters = bastionWaveLetters(n, g.players.length);
  const edges = g.cycle.bloodMoon
    ? [WAVE_EDGES[(n - 1) % 4], WAVE_EDGES[(n + 1) % 4]]
    : [WAVE_EDGES[(n - 1) % 4]];
  let mi = 0; // mutation index runs across the whole night's spawns
  for (const edge of edges) {
    const room = Math.max(0, 90 - g.enemies.length);
    const count = Math.min(letters.length, room);
    const pts = waveEntryPoints(g, edge, count);
    for (let i = 0; i < pts.length; i++) {
      const e = makeEnemy(letters[i], pts[i].x, pts[i].y, g.nextEnemyId++);
      e.awake = true;
      e.aggro *= 100; // hunters: never leash home
      e.targetCore = true;
      const roll = (n * 31 + mi) % 5;
      let mut = roll === 0 ? null : MUTATIONS[roll - 1];
      if (g.cycle.bloodMoon && !mut) mut = MUTATIONS[(n * 31 + mi) % 4];
      mi++;
      applyMutation(e, mut);
      if (g.cycle.bloodMoon) { e.hp += 1; e.maxHp += 1; }
      g.enemies.push(e);
    }
    const cx = edge === 'w' ? TILE : edge === 'e' ? (g.w - 1) * TILE : g.w * TILE / 2;
    const cy = edge === 'n' ? TILE : edge === 's' ? (g.h - 1) * TILE : g.h * TILE / 2;
    g.events.push({ type: 'wave', edge, count: pts.length, x: cx, y: cy });
  }
}

// Day/night clock. Dusk flips to night, numbers it (1-based), spawns its
// wave; dawn after the final night wins the mission outright (no gate, no
// extraction). A blood-moon warning sounds 30s before its dusk.
function stepCycle(g, dt) {
  const cy = g.cycle;
  if (!cy) return;
  const evX = g.core ? g.core.x : g.w * TILE / 2;
  const evY = g.core ? g.core.y : g.h * TILE / 2;
  cy.t -= dt;
  if (cy.phase === 'day') {
    const nextNight = cy.nightNo + 1;
    if (!cy.warned && cy.t <= BLOOD_WARN_LEAD && nextNight <= g.bastion.nights
        && g.bastion.bloodMoons.includes(nextNight)) {
      cy.warned = true;
      g.events.push({ type: 'bloodWarn', nightNo: nextNight, x: evX, y: evY });
    }
    if (cy.t <= 0) {
      cy.phase = 'night';
      cy.nightNo = nextNight;
      cy.t = g.bastion.nightLen;
      cy.bloodMoon = g.bastion.bloodMoons.includes(cy.nightNo);
      cy.warned = false;
      g.events.push({ type: 'dusk', nightNo: cy.nightNo, bloodMoon: cy.bloodMoon, x: evX, y: evY });
      spawnNightWave(g);
    }
    return;
  }
  if (cy.t <= 0) {
    g.events.push({ type: 'dawn', nightNo: cy.nightNo, x: evX, y: evY });
    if (cy.nightNo >= g.bastion.nights) {
      g.status = 'cleared';
      g.events.push({ type: 'clear', x: g.w * TILE / 2, y: g.h * TILE / 2, points: Math.round(g.score) });
      return;
    }
    cy.phase = 'day';
    cy.bloodMoon = false;
    cy.t = g.bastion.dayLen;
  }
}

// --- structure hold chain: repair, then upgrade (shared by builds/towers) ---
// Returns true while the hold is consumed by repair or upgrade; false means
// the structure is at full hp and max level, so the hold may dismantle it.
// `payer` is the first holding player in seat order — in ctf their team's
// pool foots the bill; everywhere else it is the one squad pool anyway.
function holdStructure(g, s, kind, holders, dt, payer) {
  if (s.hp < s.maxHp) {
    s.repairT = (s.repairT || 0) + dt * holders;
    while (s.repairT >= REPAIR_TICK && s.hp < s.maxHp) {
      if (getShards(g, payer) + 1e-9 < REPAIR_COST) { s.repairT = 0; break; } // stall: no shards
      addShards(g, payer, -REPAIR_COST);
      s.hp = Math.min(s.maxHp, s.hp + 1);
      s.repairT -= REPAIR_TICK;
      if (s.evT <= 0) {
        g.events.push({ type: 'repair', x: s.x, y: s.y, hp: s.hp });
        s.evT = 0.5;
      }
    }
    return true;
  }
  s.repairT = 0;
  const level = s.level || 1;
  if (level < 3) {
    const cost = UPGRADE_COST(level);
    let delta = Math.min((holders * dt) / (cost * 0.6), 1 - (s.upProgress || 0));
    const pay = Math.min(delta * cost, getShards(g, payer));
    delta = pay / cost;
    if (delta > 0) {
      addShards(g, payer, -pay);
      s.upProgress = (s.upProgress || 0) + delta;
      if (s.evT <= 0) {
        g.events.push({ type: 'build', x: s.x, y: s.y });
        s.evT = 0.5;
      }
      if (s.upProgress >= 1 - 1e-9) {
        s.upProgress = 0;
        s.level = level + 1;
        s.maxHp = structMaxHp(kind, s.level);
        s.hp = s.maxHp;
        s.invested = (s.invested ?? s.cost ?? 0) + cost;
        g.events.push({ type: 'built', x: s.x, y: s.y, kind, level: s.level });
      }
    }
    return true; // an upgradeable structure never falls through to dismantle
  }
  return false;
}

// --- shops -----------------------------------------------------------------
function shopNear(g, p) {
  const r2 = (TILE * SHOP_REACH) ** 2;
  for (const s of g.shops) if (dist2(p, s) < r2) return s;
  return null;
}

// Build sites and repairable structures own their act radius — a shop only
// engages when no structure work could claim the hold.
function structureInReach(g, p) {
  const r2 = (TILE * BUILD_REACH) ** 2;
  for (const b of g.builds) {
    if (b.built && (b.kind === 'pylon' || b.kind === 'farm')) continue;
    if (dist2(p, b) < r2) return true;
  }
  for (const t of g.towers) if (dist2(p, t) < r2) return true;
  return false;
}

function buyOffer(g, p) {
  const o = SHOP_OFFERS[p.shopIdx || 0];
  if (getShards(g, p) < o.cost) return;
  if (o.what === 'token') {
    if ((p.dmgBonus || 0) >= 2) return; // tokens cap at +2 — never waste shards
    p.dmgBonus = (p.dmgBonus || 0) + 1;
  } else if (o.what === 'shield') {
    if (p.shield === undefined || p.shield >= SHIELD_MAX) return;
    p.shield = Math.min(SHIELD_MAX, p.shield + 2);
  } else { // cracker | medkit fill the item slot (stack same kind, else swap)
    if (p.item && p.item.kind === o.what) p.item.count += o.amount;
    else p.item = { kind: o.what, count: o.amount };
  }
  addShards(g, p, -o.cost);
  g.events.push({ type: 'buy', what: o.what, cost: o.cost, pid: p.pid, x: p.x, y: p.y });
}

// --- vehicles ---------------------------------------------------------------
// Skiffs may only be boarded from a tile touching water.
function nearWater(g, p) {
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = tx + dx, y = ty + dy;
    if (x >= 0 && y >= 0 && x < g.w && y < g.h && g.grid[y][x] === '~') return true;
  }
  return false;
}

// While aboard a skiff, movement is allowed only over '~' tiles (sliding
// within the tile currently occupied stays legal so the boat can shove off).
function skiffMove(g, p, dx, dy) {
  const ok = (nx, ny) => {
    if (tileAt(g, nx, ny) === '~') return true;
    return Math.floor(nx / TILE) === Math.floor(p.x / TILE) && Math.floor(ny / TILE) === Math.floor(p.y / TILE);
  };
  if (dx && ok(p.x + dx, p.y)) p.x += dx;
  if (dy && ok(p.x, p.y + dy)) p.y += dy;
}

function dismountVehicle(g, p, v) {
  if (v.kind === 'skiff' && tileAt(g, p.x, p.y) === '~') {
    // step ashore onto the first open neighboring tile; mid-lake with no land
    // in reach means staying aboard
    const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = (tx + dx + 0.5) * TILE, y = (ty + dy + 0.5) * TILE;
      if (x > 0 && y > 0 && x < g.w * TILE && y < g.h * TILE && !collides(g, x, y, PLAYER_R)) {
        p.x = x;
        p.y = y;
        v.rider = null;
        p.riding = null;
        g.events.push({ type: 'dismount', kind: v.kind, x: v.x, y: v.y, pid: p.pid });
        return;
      }
    }
    return;
  }
  v.rider = null;
  p.riding = null;
  g.events.push({ type: 'dismount', kind: v.kind, x: v.x, y: v.y, pid: p.pid });
}

// --- pvp: match end, flags, shrink zone -------------------------------------
function pvpWin(g, winner) {
  if (g.status !== 'play') return;
  g.status = 'cleared';
  g.winner = winner;
  g.events.push({
    type: 'matchEnd', winner,
    ...(g.caps ? { caps: g.caps.slice() } : {}),
    x: g.w * TILE / 2, y: g.h * TILE / 2,
  });
  g.events.push({ type: 'clear', x: g.w * TILE / 2, y: g.h * TILE / 2, points: Math.round(g.score) });
}

function stepFlags(g, dt) {
  if (!g.flags.length) return;
  // Sudden death cannot run forever: after 180s the cap rules the match.
  // More grabs (flag pickups, whole match) wins; tied grabs go to the team
  // that grabbed FIRST inside sudden death; zero grabs anywhere -> team 0.
  // Captures can't break the tie — caps are tied in sudden death by definition.
  if (g.suddenDeath && g.status === 'play') {
    g.suddenT += dt;
    if (g.suddenT >= 180) {
      pvpWin(g, g.grabs[0] !== g.grabs[1]
        ? (g.grabs[0] > g.grabs[1] ? 0 : 1)
        : (g.sdFirstGrab ?? 0));
      return;
    }
  }
  for (const f of g.flags) {
    if (f.carrier != null) {
      const p = g.players.find(q => q.pid === f.carrier);
      if (!p || p.state !== 'active') { // safety net: downPlayer drops normally
        f.carrier = null;
        f.dropT = FLAG_DROP_T;
        f.atBase = false;
      } else {
        f.x = p.x;
        f.y = p.y;
      }
      continue;
    }
    if (!f.atBase) {
      f.dropT -= dt;
      if (f.dropT <= 0) {
        f.atBase = true;
        f.x = f.homeX;
        f.y = f.homeY;
        f.dropT = 0;
        g.events.push({ type: 'flagReturn', team: f.team, x: f.x, y: f.y });
      }
    }
  }
  const r2 = (TILE * FLAG_REACH) ** 2;
  for (const p of g.players) {
    if (p.state !== 'active' || p.team === undefined) continue;
    for (const f of g.flags) {
      if (f.carrier != null || dist2(p, f) >= r2) continue;
      if (f.team !== p.team) {
        // mounted players never pick the flag up (drop-on-mount rule, and
        // the carrier slowdown must not be bypassed on stag-back)
        if (p.riding) continue;
        // grab the enemy flag, at its stand or off the ground
        f.carrier = p.pid;
        f.atBase = false;
        f.dropT = 0;
        if (g.grabs) {
          g.grabs[p.team]++;
          if (g.suddenDeath && g.sdFirstGrab == null) g.sdFirstGrab = p.team;
        }
        g.events.push({ type: 'flagTaken', team: f.team, pid: p.pid, x: f.x, y: f.y });
      } else if (!f.atBase) {
        // your own dropped flag goes straight home on touch
        f.atBase = true;
        f.x = f.homeX;
        f.y = f.homeY;
        f.dropT = 0;
        g.events.push({ type: 'flagReturn', team: f.team, x: f.x, y: f.y });
      }
    }
    // scoring: carry the enemy flag onto your own AT-BASE stand
    const own = g.flags.find(f => f.team === p.team);
    const carrying = g.flags.find(f => f.carrier === p.pid);
    if (own && own.atBase && carrying && dist2(p, { x: own.homeX, y: own.homeY }) < r2) {
      carrying.carrier = null;
      carrying.atBase = true;
      carrying.x = carrying.homeX;
      carrying.y = carrying.homeY;
      carrying.dropT = 0;
      g.caps[p.team]++;
      g.events.push({ type: 'capture', team: p.team, pid: p.pid, x: own.homeX, y: own.homeY });
      if (g.caps[p.team] >= CTF_CAPS_TO_WIN || g.suddenDeath) pvpWin(g, p.team);
    }
  }
}

function stepZone(g, dt) {
  if (!g.zone) return;
  const z = g.zone;
  for (const s of g.brShrinks) {
    if (s.fired || g.elapsed < s.at) continue;
    s.fired = true;
    z.targetR = s.r * TILE;
    z.shrinkT = ZONE_SHRINK_T;
    g.events.push({ type: 'zoneShrink', x: z.x, y: z.y, r: z.targetR, t: z.shrinkT });
  }
  if (z.r > z.targetR) {
    if (z.shrinkT > 0) {
      const rate = (z.r - z.targetR) / z.shrinkT;
      z.r = Math.max(z.targetR, z.r - rate * dt);
      z.shrinkT = Math.max(0, z.shrinkT - dt);
    } else {
      z.r = z.targetR;
    }
  } else if (g.brShrinks.every(s => s.fired)) {
    // Endgame: the last scheduled shrink never closes the ring fully, so 30s
    // after it settles the zone starts a continuous final collapse — 8 px/s,
    // straight down to r=0. No two-survivor stalemates.
    z.finalT = (z.finalT || 0) + dt;
    if (z.finalT >= 30 && z.r > 0) {
      if (!z.collapsing) {
        z.collapsing = true;
        g.events.push({ type: 'zoneShrink', x: z.x, y: z.y, r: 0, t: 0 });
      }
      z.r = Math.max(0, z.r - 8 * dt);
      z.targetR = z.r;
    }
  }
  // standing outside burns 1 hp every 2 seconds (shield pips absorb first);
  // once the collapsing ring drops under 60px the burn applies inside too —
  // everyone left alive ticks down, so the match always ends
  for (const p of g.players) {
    if (p.state !== 'active') continue;
    if (Math.hypot(p.x - z.x, p.y - z.y) > z.r || z.r < 60) {
      p.zoneT = (p.zoneT || 0) + dt;
      if (p.zoneT >= ZONE_TICK) {
        p.zoneT -= ZONE_TICK;
        damagePlayer(g, p, 1);
      }
    } else {
      p.zoneT = 0;
    }
  }
}

export function step(g, inputs, dt) {
  if (g.status !== 'play') return;

  g.elapsed += dt;
  stepWaves(g);
  stepCycle(g, dt); // bastion day/night clock (final dawn can clear here)
  if (g.status !== 'play') return;
  maybeOpenGate(g); // time-locked gates open when `after` elapses at full quorum

  // Bastion missions are governed by the day/night clock, not the mission
  // timer — it freezes and never fails the level. PvP clocks never fail the
  // match either: CTF expiry crowns the leader (a tie goes to sudden death,
  // first capture wins, clock frozen at 0) and BR lets the zone settle it.
  if (!g.cycle && g.timeLeft > 0) {
    g.timeLeft -= dt;
    if (g.timeLeft <= 0) {
      g.timeLeft = 0;
      const pvp = g.mode === 'ctf' || g.mode === 'br';
      if (!pvp) { g.status = 'failed'; g.events.push({ type: 'fail', x: 0, y: 0 }); return; }
      if (g.mode === 'ctf') {
        if (g.caps[0] !== g.caps[1]) { pvpWin(g, g.caps[0] > g.caps[1] ? 0 : 1); return; }
        g.suddenDeath = true;
      }
    } else if (!g.lowTimeSent && g.timeLeft <= 15) {
      g.lowTimeSent = true;
      g.events.push({ type: 'lowTime', x: g.w * TILE / 2, y: TILE });
    }
  }
  g.comboT -= dt;
  if (g.comboT <= 0) g.combo = 1;

  // --- players ---
  for (const p of g.players) {
    if (p.state === 'down') {
      p.respawn -= dt;
      if (p.respawn <= 0) {
        // CTF: redeploy the same operative at the team flag stand. No pick
        // screen, no roster consumption — pvp never touches rosters.
        if (g.mode === 'ctf') {
          const stand = g.flags.find(f => f.team === p.team);
          p.x = stand ? stand.homeX : (g.spawns[0] || { x: TILE * 2 }).x;
          p.y = stand ? stand.homeY : (g.spawns[0] || { y: TILE * 2 }).y;
          p.fx = 0; p.fy = -1; p.cool = 0;
          p.invuln = 2.5;
          if (p.maxHp !== undefined) { p.hp = p.maxHp; p.shield = 0; }
          p.state = 'active';
          g.events.push({ type: 'spawn', x: p.x, y: p.y });
          continue;
        }
        const free = freeChars(g);
        if (free.length) {
          // Gain Ground style: the fallen player picks their next operative.
          // pickPrev starts all-held so a button held while dying can't
          // instantly confirm — release first, then choose.
          p.state = 'pick';
          p.pickIdx = 0;
          p.pickPrev = { left: true, right: true, fire: true };
        } else {
          p.state = 'out';
        }
      }
      continue;
    }
    if (p.state === 'pick') {
      const free = freeChars(g);
      if (!free.length) { p.state = 'out'; continue; }
      if (p.pickIdx >= free.length) p.pickIdx = free.length - 1;
      const inp = inputs[p.pid] || {};
      const edgeL = !!inp.left && !p.pickPrev.left;
      const edgeR = !!inp.right && !p.pickPrev.right;
      const edgeF = !!inp.fire && !p.pickPrev.fire;
      p.pickPrev = { left: !!inp.left, right: !!inp.right, fire: !!inp.fire };
      if (edgeL) p.pickIdx = (p.pickIdx + free.length - 1) % free.length;
      if (edgeR) p.pickIdx = (p.pickIdx + 1) % free.length;
      if (edgeF) {
        const s = respawnSpot(g);
        p.charId = free[p.pickIdx];
        p.x = s.x; p.y = s.y; p.fx = 0; p.fy = -1; p.cool = 0;
        p.invuln = 3.5;
        // a fresh operative deploys at full hp with no shield; the item slot
        // belongs to the seat and survives the swap
        if (p.maxHp !== undefined) { p.hp = p.maxHp; p.shield = 0; }
        p.state = 'active';
        g.events.push({ type: 'spawn', x: p.x, y: p.y });
      }
      continue;
    }
    if (p.state !== 'active') continue;

    if (p.invuln > 0) p.invuln -= dt;
    if (p.specialCool > 0) p.specialCool -= dt;
    if (p.stimT > 0) p.stimT -= dt;
    const inp = inputs[p.pid] || {};
    const ch = g.charMap[p.charId];
    if (!ch) continue;

    // --- holdings: an occupied watchtower pins the gunner to its platform;
    // a mounted vehicle moves with its rider ---
    const tower = p.towerId != null ? g.towers[p.towerId] : null;
    if (tower) { p.x = tower.x; p.y = tower.y; }
    const vehicle = p.riding ? g.vehicles.find(v => v.id === p.riding) : null;

    // --- shop carousel: holding act inside 1.5 tiles of a stall locks
    // movement; left/right (edge) browse, fire (edge) buys. Structure work
    // owns its radius, so a hold near a build site never opens the shop. ---
    const wasShopping = !!p.shopping;
    p.shopping = !!(inp.act && !tower && !vehicle && g.shops.length
      && shopNear(g, p) && !structureInReach(g, p));
    // the press that ENGAGES the carousel is consumed whole: no fall-through
    // to chests/builds/anything else under the stall this tick
    const shopEngaged = p.shopping && !wasShopping;
    if (shopEngaged) {
      p.shopIdx = p.shopIdx || 0;
      // all-held start: buttons held when the stall opens must not buy
      p.shopPrev = { left: !!inp.left, right: !!inp.right, fire: !!inp.fire };
    }
    if (p.shopping) {
      const edgeL = !!inp.left && !p.shopPrev.left;
      const edgeR = !!inp.right && !p.shopPrev.right;
      const edgeF = !!inp.fire && !p.shopPrev.fire;
      p.shopPrev = { left: !!inp.left, right: !!inp.right, fire: !!inp.fire };
      if (edgeL) p.shopIdx = (p.shopIdx + SHOP_OFFERS.length - 1) % SHOP_OFFERS.length;
      if (edgeR) p.shopIdx = (p.shopIdx + 1) % SHOP_OFFERS.length;
      if (edgeF) buyOffer(g, p);
    }

    // --- special (edge-triggered; suppressed while mounted, towered or
    // browsing a shop) ---
    const specialEdge = !!inp.special && !p.specialPrev;
    p.specialPrev = !!inp.special;
    if (specialEdge && p.specialCool <= 0 && ch.special && !vehicle && !tower && !p.shopping) {
      const sp = ch.special;
      if (sp.kind === 'dash') {
        p.dashT = 0.15;
        p.dashFx = p.fx;
        p.dashFy = p.fy;
        p.invuln = Math.max(p.invuln, 0.4);
        g.events.push({ type: 'dash', x: p.x, y: p.y });
      } else if (sp.kind === 'stim') {
        for (const q of g.players) {
          // pvp: the ward shields only the medic's own team (self always) —
          // an opposing operative sprinting through gains nothing
          if (q.state === 'active' && (q === p || (dist2(p, q) < (TILE * 2) ** 2
              && (p.team === undefined || q.team === p.team)))) {
            q.invuln = Math.max(q.invuln, 1.5);
          }
        }
        p.stimT = 3;
        g.events.push({ type: 'special', x: p.x, y: p.y, kind: 'stim', who: 'p' });
      } else {
        fireWeapon(g, p, sp, 'p');
        g.events.push({ type: 'special', x: p.x, y: p.y, kind: sp.kind, who: 'p' });
      }
      p.specialCool = sp.cooldown || 3;
    }

    // --- item slot (edge-triggered): cracker lobs a lure grenade, medkit
    // heals +1 (only when hurt), shield refills the pips (only when low).
    // Arcade players carry no items so the button is inert there. ---
    const itemEdge = !!inp.item && !p.itemPrev;
    p.itemPrev = !!inp.item;
    if (itemEdge && p.item && p.item.count > 0 && p.maxHp !== undefined) {
      const it = p.item;
      let used = false;
      if (it.kind === 'cracker') {
        const tx = Math.max(TILE * 0.5, Math.min((g.w - 0.5) * TILE, p.x + p.fx * CRACKER_RANGE * TILE));
        const ty = Math.max(TILE * 0.5, Math.min((g.h - 0.5) * TILE, p.y + p.fy * CRACKER_RANGE * TILE));
        g.crackers.push({
          sx: p.x, sy: p.y, tx, ty, x: p.x, y: p.y,
          flightT: CRACKER_FLIGHT, landed: false, fuse: CRACKER_FUSE,
          // pvp bookkeeping: the boom hits other-team players (never own)
          pid: p.pid, team: p.team,
        });
        used = true;
      } else if (it.kind === 'medkit' && p.hp < p.maxHp) {
        p.hp++;
        g.events.push({ type: 'heal', pid: p.pid, x: p.x, y: p.y, hp: p.hp });
        used = true;
      } else if (it.kind === 'shield' && p.shield < SHIELD_MAX) {
        p.shield = Math.min(SHIELD_MAX, p.shield + 2);
        g.events.push({ type: 'shieldUp', pid: p.pid, x: p.x, y: p.y, shield: p.shield });
        used = true;
      }
      if (used && --it.count <= 0) p.item = null;
    }

    // --- movement (dash overrides stick input; stim grants +30% speed) ---
    if (p.dashT > 0) {
      p.dashT -= dt;
      // 3 tiles over 0.15s, in collision-checked sub-steps so the dash
      // cannot tunnel through walls or built structures.
      let remain = (3 / 0.15) * TILE * dt;
      while (remain > 0) {
        const m = Math.min(6, remain);
        moveCircle(g, p, p.dashFx * m, p.dashFy * m, PLAYER_R);
        remain -= m;
      }
    } else if (tower || p.shopping) {
      // locked in place; tower gunners still swivel their aim
      if (tower) {
        const dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
        const dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
        if (dx || dy) { const [mx, my] = norm(dx, dy); p.fx = mx; p.fy = my; }
        p.x = tower.x; p.y = tower.y;
      }
    } else {
      const dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      const dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
      if (dx || dy) {
        const [mx, my] = norm(dx, dy);
        p.fx = mx; p.fy = my;
        let v = ch.speed * TILE * dt * (p.stimT > 0 ? 1.3 : 1);
        if (vehicle) v = ch.speed * TILE * dt * (vehicle.kind === 'stag' ? STAG_SPEED : 1);
        if (g.flags.length && g.flags.some(f => f.carrier === p.pid)) v *= CARRY_SLOW;
        if (vehicle && vehicle.kind === 'skiff') skiffMove(g, p, mx * v, my * v);
        else moveCircle(g, p, mx * v, my * v, PLAYER_R);
      }
      if (vehicle) { vehicle.x = p.x; vehicle.y = p.y; }
    }
    p.cool -= dt;
    if (inp.fire && p.cool <= 0 && !vehicle && !p.shopping) {
      let weapon = ch.weapon;
      if (tower) {
        // the high ground: longer reach, shots sail over walls
        const bonus = TOWER_BONUS[(tower.level || 1) - 1];
        weapon = { ...weapon, range: (weapon.range ?? 5) * (1 + bonus), overWalls: true };
      }
      fireWeapon(g, p, weapon, 'p');
      p.cool = ch.weapon.cooldown;
    }

    // --- act (edge-triggered; a press that engaged the shop carousel above
    // never falls through to this chain. Priority order, top wins:
    //   1. leave tower            2. dismount vehicle
    //   3. build sites (they own their radius — building runs per-site below
    //      on the held bool)      4. ripe/trampled farms
    //   5. vehicle mount (NEAREST in reach — mounts outrank chest opening)
    //   6. chests (nearest)       7. tower occupy
    //   8. hire posts             9. npc talk ---
    const actEdge = !!inp.act && !p.actPrev && !shopEngaged;
    p.actPrev = !!inp.act;
    if (actEdge) {
      if (tower) {
        tower.occupant = null;
        p.towerId = null;
      } else if (vehicle) {
        dismountVehicle(g, p, vehicle);
      } else {
        const reach2 = (TILE * BUILD_REACH) ** 2;
        let onSite = false;
        let ripeFarm = null;
        let deadFarm = null;
        for (const b of g.builds) {
          if (dist2(p, b) >= reach2) continue;
          if (!b.built) { onSite = true; break; }
          if (b.kind === 'farm') {
            if (b.trampled) deadFarm = deadFarm || b;
            else if (b.stage >= 3) ripeFarm = ripeFarm || b;
          }
        }
        let handled = onSite;
        if (!handled && ripeFarm) {
          harvestFarm(g, ripeFarm, p);
          handled = true;
        }
        if (!handled && deadFarm) {
          // replant a trampled plot by hand (a hired farmer does it unasked)
          deadFarm.trampled = false;
          deadFarm.replantT = 0;
          deadFarm.growT = 0;
          handled = true;
        }
        if (!handled) {
          // mount the NEAREST free vehicle in reach (not array-first)
          let veh = null, bestV = reach2;
          for (const v of g.vehicles) {
            if (v.rider != null) continue;
            if (v.kind === 'skiff' && !nearWater(g, p)) continue;
            const dd = dist2(p, v);
            if (dd < bestV) { bestV = dd; veh = v; }
          }
          if (veh) {
            veh.rider = p.pid;
            p.riding = veh.id;
            p.x = veh.x; p.y = veh.y;
            p.dashT = 0;
            // a carried CTF flag never rides: it drops at the mount point
            dropFlags(g, p);
            g.events.push({ type: 'mount', kind: veh.kind, x: veh.x, y: veh.y, pid: p.pid });
            handled = true;
          }
        }
        if (!handled) {
          let chest = null, bestC = reach2;
          for (const c of g.chests) {
            if (c.opened) continue;
            const dd = dist2(p, c);
            if (dd < bestC) { bestC = dd; chest = c; }
          }
          if (chest) { openChest(g, chest, p); handled = true; }
        }
        if (!handled) {
          const m2 = (TILE * TOWER_MOUNT_REACH) ** 2;
          for (let ti = 0; ti < g.towers.length; ti++) {
            const t = g.towers[ti];
            if (t.hp > 0 && t.occupant == null && dist2(p, t) < m2) {
              t.occupant = p.pid;
              p.towerId = ti;
              p.x = t.x; p.y = t.y;
              p.dashT = 0;
              handled = true;
              break;
            }
          }
        }
        if (!handled) {
          for (const h of g.hires) {
            if (h.hired || dist2(p, h) >= reach2) continue;
            handled = true; // the post consumes the press even when unaffordable
            if (getShards(g, p) >= h.cost) {
              addShards(g, p, -h.cost);
              h.hired = true;
              g.events.push({ type: 'hired', name: h.name, job: h.job, cost: h.cost, x: h.x, y: h.y });
            }
            break;
          }
        }
        if (!handled) {
          let npc = null, bestN = (TILE * BUILD_REACH) ** 2;
          for (const n of g.npcs) {
            const dd = dist2(p, n);
            if (dd < bestN) { bestN = dd; npc = n; }
          }
          if (npc) {
            const line = npc.lines.length ? npc.lines[npc.lineIdx % npc.lines.length] : '';
            if (npc.lines.length) npc.lineIdx = (npc.lineIdx + 1) % npc.lines.length;
            let gift;
            if (!npc.given && npc.gift && npc.gift.shards) {
              npc.given = true;
              addShards(g, p, npc.gift.shards);
              gift = npc.gift.shards;
            }
            g.events.push({ type: 'talk', x: npc.x, y: npc.y, npcId: npc.id, name: npc.name, line, gift });
          }
        }
      }
    }

    for (const c of g.captives) {
      // == null, not falsy: local couch players start at pid 0
      if (c.owner == null && dist2(p, c) < (PLAYER_R + CAPTIVE_R) ** 2) {
        c.owner = p.pid;
        g.events.push({ type: 'pickup', x: c.x, y: c.y, charId: c.charId });
      }
    }

    // A dormant gate keeps its 'E' tiles inert — players just walk over them.
    if (tileAt(g, p.x, p.y) === 'E' && (!g.gate || g.gate.open)) extractPlayer(g, p);
  }

  // --- build sites and built structures: nearby players holding 'act' work
  // the site, paying shards proportionally from the shared pool as they go;
  // an empty pool stalls. On a BUILT barricade/turret the hold runs the
  // priority chain: repair while damaged, then upgrade below level 3, and
  // only a full-hp max-level structure dismantles (half of every shard ever
  // invested refunds). Pylons and farms keep their own act semantics. ---
  const holdReach2 = (TILE * BUILD_REACH) ** 2;
  // Holders in seat order; the first one is the payer (in ctf their team's
  // pool funds the work, everywhere else there is only the one pool).
  const holdersOf = s => {
    const arr = [];
    for (const p of g.players) {
      if (p.state !== 'active' || p.towerId != null || p.riding) continue;
      const inp = inputs[p.pid] || {};
      if (inp.act && dist2(p, s) < holdReach2) arr.push(p);
    }
    return arr;
  };
  for (const b of g.builds) {
    if (b.evT > 0) b.evT -= dt;
    if (b.built) {
      if (b.kind === 'pylon' || b.kind === 'farm') continue;
      const holderArr = holdersOf(b);
      const holders = holderArr.length;
      if (!holders) { b.dismantleT = 0; continue; }
      if (holdStructure(g, b, b.kind, holders, dt, holderArr[0])) continue;
      // Dismantle (full hp, max level) with no enemies within 6 tiles. Closes
      // the self-seal trap and lets misplaced structures move.
      let enemyNear = false;
      const r2 = (TILE * 6) ** 2;
      for (const e of g.enemies) {
        if (!e.dead && dist2(e, b) < r2) { enemyNear = true; break; }
      }
      if (enemyNear) { b.dismantleT = 0; continue; }
      b.dismantleT = (b.dismantleT || 0) + dt * holders;
      if (b.evT <= 0) {
        g.events.push({ type: 'build', x: b.x, y: b.y });
        b.evT = 0.5;
      }
      if (b.dismantleT >= 2) {
        b.built = false;
        b.progress = 0;
        b.paid = 0;
        b.hp = 0;
        b.dismantleT = 0;
        addShards(g, holderArr[0], Math.floor((b.invested ?? b.cost) / 2));
        b.invested = 0;
        if (b.level) { b.level = 1; b.maxHp = structMaxHp(b.kind, 1); }
        g.events.push({ type: 'buildDown', x: b.x, y: b.y, kind: b.kind });
      }
      continue;
    }
    const builderArr = holdersOf(b);
    const builders = builderArr.length;
    if (!builders) continue;
    let delta = Math.min((builders * dt) / (b.cost * 0.6), 1 - b.progress);
    const pay = Math.min(delta * b.cost, getShards(g, builderArr[0]));
    if (b.cost > 0) delta = pay / b.cost;
    if (delta <= 0) continue; // pool empty: progress stalls
    addShards(g, builderArr[0], -pay);
    b.paid += pay;
    b.progress += delta;
    if (b.evT <= 0) {
      g.events.push({ type: 'build', x: b.x, y: b.y });
      b.evT = 0.5;
    }
    if (b.progress >= 1 - 1e-9) {
      b.progress = 1;
      b.built = true;
      b.hp = b.maxHp;
      b.invested = b.cost;
      g.events.push({ type: 'built', x: b.x, y: b.y, kind: b.kind });
      if (b.kind === 'pylon' && g.gate) {
        g.gate.built++;
        maybeOpenGate(g);
      }
    }
  }

  // --- watchtowers: live ones repair/upgrade/dismantle exactly like built
  // structures; a destroyed tower is a build site again (cost 10). ---
  for (const t of g.towers) {
    if (t.evT === undefined) t.evT = 0;
    if (t.evT > 0) t.evT -= dt;
    const holderArr = holdersOf(t);
    const holders = holderArr.length;
    if (t.hp <= 0) {
      if (!holders) continue;
      let delta = Math.min((holders * dt) / (TOWER_REBUILD_COST * 0.6), 1 - (t.progress || 0));
      const pay = Math.min(delta * TOWER_REBUILD_COST, getShards(g, holderArr[0]));
      delta = pay / TOWER_REBUILD_COST;
      if (delta <= 0) continue; // pool empty: progress stalls
      addShards(g, holderArr[0], -pay);
      t.progress = (t.progress || 0) + delta;
      if (t.evT <= 0) {
        g.events.push({ type: 'build', x: t.x, y: t.y });
        t.evT = 0.5;
      }
      if (t.progress >= 1 - 1e-9) {
        t.progress = 0;
        t.maxHp = structMaxHp('tower', t.level);
        t.hp = t.maxHp;
        t.invested = (t.invested || 0) + TOWER_REBUILD_COST;
        g.events.push({ type: 'built', x: t.x, y: t.y, kind: 'tower', level: t.level });
      }
      continue;
    }
    if (!holders) { t.dismantleT = 0; continue; }
    if (holdStructure(g, t, 'tower', holders, dt, holderArr[0])) continue;
    let enemyNear = false;
    const r2 = (TILE * 6) ** 2;
    for (const e of g.enemies) {
      if (!e.dead && dist2(e, t) < r2) { enemyNear = true; break; }
    }
    if (enemyNear) { t.dismantleT = 0; continue; }
    t.dismantleT = (t.dismantleT || 0) + dt * holders;
    if (t.evT <= 0) {
      g.events.push({ type: 'build', x: t.x, y: t.y });
      t.evT = 0.5;
    }
    if (t.dismantleT >= 2) {
      t.dismantleT = 0;
      addShards(g, holderArr[0], Math.floor((t.invested || 0) / 2));
      towerDown(g, t);
    }
  }

  // --- hired operators work their posts on fixed deterministic ticks ---
  for (const h of g.hires) {
    if (!h.hired) continue;
    h.workT = (h.workT || 0) + dt;
    if (h.job === 'smith') {
      while (h.workT >= 20) { // +1 shard to the pool every 20s
        h.workT -= 20;
        // ctf maps field no hire posts; if one ever does, the smith pays
        // both team pools alike (no side gets the long straw)
        if (g.teamShards) { g.teamShards[0] += 1; g.teamShards[1] += 1; }
        else g.shards += 1;
        g.events.push({ type: 'shard', x: h.x, y: h.y, amount: 1 });
      }
    } else if (h.job === 'engineer') {
      while (h.workT >= 3) { // patches the nearest damaged structure, free
        h.workT -= 3;
        let tgt = null, best = Infinity;
        for (const b of g.builds) {
          if (!b.built || b.kind === 'pylon' || b.hp >= b.maxHp) continue;
          const dd = dist2(h, b);
          if (dd < best) { best = dd; tgt = b; }
        }
        for (const t of g.towers) {
          if (t.hp <= 0 || t.hp >= t.maxHp) continue;
          const dd = dist2(h, t);
          if (dd < best) { best = dd; tgt = t; }
        }
        if (tgt) {
          tgt.hp = Math.min(tgt.maxHp, tgt.hp + 1);
          g.events.push({ type: 'repair', x: tgt.x, y: tgt.y, hp: tgt.hp });
        }
      }
    }
    // farmers speed growth and replant tramples — both live in the farm loop
  }

  // --- farms: stages grow on a timer (faster with a hired farmer working);
  // enemies crossing a planted farm at night trample it back to a dead plot.
  // Trampled plots stay fallow until replanted: instantly by a player's act,
  // or after 10s by a hired farmer. ---
  for (const b of g.builds) {
    if (!b.built || b.kind !== 'farm') continue;
    const farmer = g.hires.some(h => h.hired && h.job === 'farmer');
    if (b.trampled) {
      if (farmer) {
        b.replantT = (b.replantT || 0) + dt;
        if (b.replantT >= FARM_REPLANT_T) {
          b.trampled = false;
          b.replantT = 0;
          b.growT = 0;
        }
      }
    } else if (b.stage < 3) {
      const need = farmer ? FARM_GROW_FAST : FARM_GROW_T;
      b.growT += dt;
      if (b.growT >= need) { b.growT = 0; b.stage++; }
    }
    if (b.stage > 0 && g.cycle && g.cycle.phase === 'night') {
      const rr = (BUILD_RADIUS + ENEMY_R) ** 2;
      for (const e of g.enemies) {
        if (!e.dead && dist2(e, b) < rr) {
          b.stage = 0;
          b.growT = 0;
          b.trampled = true;
          b.replantT = 0;
          g.events.push({ type: 'trample', x: b.x, y: b.y });
          break;
        }
      }
    }
  }

  // --- lure crackers: fly the 4-tile arc, land, pull every enemy within 9
  // tiles (nearestTarget override) for the fuse, then detonate ---
  for (let i = g.crackers.length - 1; i >= 0; i--) {
    const c = g.crackers[i];
    if (!c.landed) {
      c.flightT -= dt;
      const t = Math.max(0, c.flightT) / CRACKER_FLIGHT;
      c.x = c.tx - (c.tx - c.sx) * t;
      c.y = c.ty - (c.ty - c.sy) * t;
      if (c.flightT <= 0) {
        c.landed = true;
        c.x = c.tx; c.y = c.ty;
        g.events.push({ type: 'crackerOut', x: c.x, y: c.y });
      }
      continue;
    }
    c.fuse -= dt;
    if (c.fuse <= 0) {
      g.events.push({ type: 'crackerBoom', x: c.x, y: c.y, radius: TILE * CRACKER_AOE });
      const r2 = (TILE * CRACKER_AOE) ** 2;
      for (const e of g.enemies) {
        if (!e.dead && dist2(c, e) <= r2) damageEnemy(g, e, CRACKER_DMG, e.x, e.y, 'cracker');
      }
      // pvp only: the boom clips OTHER-team operatives caught in the lure
      // (never same-team; invuln/shield rules ride damagePlayer as usual)
      if ((g.mode === 'ctf' || g.mode === 'br') && c.pid !== undefined) {
        for (const q of g.players) {
          if (q.state !== 'active' || q.pid === c.pid || q.team === c.team || q.invuln > 0) continue;
          if (dist2(c, q) <= r2) pvpHit(g, q, CRACKER_DMG, c.pid);
        }
      }
      g.crackers.splice(i, 1);
    }
  }

  // --- shard drops: expire, magnetize toward the nearest player, collect ---
  for (let i = g.drops.length - 1; i >= 0; i--) {
    const d = g.drops[i];
    d.ttl -= dt;
    if (d.ttl <= 0) { g.drops.splice(i, 1); continue; }
    let near = null, best = Infinity;
    for (const p of g.players) {
      if (p.state !== 'active') continue;
      const dd = dist2(d, p);
      if (dd < best) { best = dd; near = p; }
    }
    if (!near) continue;
    // magnetize and collect only with a clear walkable line — shards must not
    // slide through walls or leak out of sealed pockets
    if (best < (TILE * MAGNET_RANGE) ** 2 && hasLoS(g, d.x, d.y, near.x, near.y)) {
      const [mx, my] = norm(near.x - d.x, near.y - d.y);
      d.x += mx * MAGNET_SPEED * TILE * dt;
      d.y += my * MAGNET_SPEED * TILE * dt;
    }
    if (dist2(d, near) < TILE * TILE && hasLoS(g, d.x, d.y, near.x, near.y)) {
      addShards(g, near, d.amount); // ctf: the collector's team pool
      g.events.push({ type: 'shard', x: d.x, y: d.y, amount: d.amount });
      g.drops.splice(i, 1);
    }
  }

  // --- built turrets: auto-fire at the nearest awake enemy in range+sight.
  // Levels raise damage (1/2/3) and targeting reach (5/5.5/6 tiles). ---
  for (const b of g.builds) {
    if (!b.built || b.kind !== 'turret') continue;
    if (b.cool > 0) { b.cool -= dt; continue; }
    const lvl = b.level || 1;
    let tgt = null, best = (TILE * TURRET_RANGE[lvl - 1]) ** 2;
    for (const e of g.enemies) {
      if (e.dead || !e.awake) continue;
      const dd = dist2(b, e);
      if (dd < best && hasLoS(g, b.x, b.y, e.x, e.y, blocksSight)) { best = dd; tgt = e; }
    }
    if (tgt) {
      fireWeapon(g, b, { ...TURRET_WEAPON, damage: TURRET_DMG[lvl - 1] }, 'p', tgt);
      b.cool = 0.8;
    }
  }

  // --- captives follow their owner ---
  for (const c of g.captives) {
    if (c.owner == null) continue;
    const o = g.players.find(p => p.pid === c.owner);
    if (!o || o.state !== 'active') { c.owner = null; continue; }
    const d = Math.hypot(o.x - c.x, o.y - c.y);
    const gap = PLAYER_R + CAPTIVE_R + 8;
    if (d > gap) {
      const t = Math.min(1, ((d - gap) / d) * 8 * dt);
      c.x += (o.x - c.x) * t;
      c.y += (o.y - c.y) * t;
    }
  }

  // --- pvp: carried flags track their runners, dropped ones tick home;
  // the BR zone closes in and burns whoever lingers outside ---
  stepFlags(g, dt);
  stepZone(g, dt);

  // --- enemies (frozen during the level-start grace period) ---
  if (g.graceT > 0) g.graceT -= dt;
  else for (const e of g.enemies) stepEnemy(g, e, dt);

  // --- shots ---
  for (let i = g.shots.length - 1; i >= 0; i--) {
    const s = g.shots[i];
    if (s.curve) {
      const ca = Math.cos(s.curve * dt), sa = Math.sin(s.curve * dt);
      const vx = s.vx * ca - s.vy * sa;
      const vy = s.vx * sa + s.vy * ca;
      s.vx = vx; s.vy = vy;
    }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.ttl -= dt;
    let dead = s.ttl <= 0 || s.x < 0 || s.y < 0 || s.x > g.w * TILE || s.y > g.h * TILE;
    if (!dead && !s.overWalls && blocksSight(tileAt(g, s.x, s.y))) {
      dead = true;
      g.events.push({ type: 'hitWall', x: s.x, y: s.y });
    }
    if (!dead && s.who === 'p') {
      for (const e of g.enemies) {
        if (e.dead || s.hits.includes(e.id)) continue;
        if (dist2(s, e) < (ENEMY_R + (s.radius || SHOT_R)) ** 2) {
          if (shieldBlocks(e, s)) {
            dead = true;
            g.events.push({ type: 'shield', x: e.x, y: e.y, kind: e.kind });
            break;
          }
          s.hits.push(e.id);
          damageEnemy(g, e, s.dmg, e.x, e.y, s.kind);
          if (s.aoeRadius) explode(g, s, e);
          if (s.pierce > 0) s.pierce--;
          else dead = true;
          break;
        }
      }
      // LYTH crystals crack under player fire; a broken node spills shards.
      if (!dead) {
        for (const c of g.crystals) {
          if (c.hp <= 0 || s.hits.includes('y' + c.cid)) continue;
          if (dist2(s, c) < (CRYSTAL_R + (s.radius || SHOT_R)) ** 2) {
            s.hits.push('y' + c.cid);
            c.hp -= s.dmg;
            if (c.hp <= 0) {
              g.events.push({ type: 'crystal', x: c.x, y: c.y });
              g.drops.push({ x: c.x, y: c.y, amount: 4, ttl: DROP_TTL });
            }
            if (s.pierce > 0) s.pierce--;
            else dead = true;
            break;
          }
        }
      }
      // pvp: player fire hits OTHER-team operatives (friendly fire is off;
      // shots sail through teammates and invulnerable targets)
      if (!dead && (g.mode === 'ctf' || g.mode === 'br') && s.pid !== undefined) {
        for (const q of g.players) {
          if (q.state !== 'active' || q.pid === s.pid || q.team === s.team || q.invuln > 0) continue;
          if (dist2(s, q) < (PLAYER_R + (s.radius || SHOT_R)) ** 2) {
            pvpHit(g, q, s.dmg, s.pid);
            dead = true; // an aoe shot still explodes below (dead handling)
            break;
          }
        }
      }
    } else if (!dead && s.who === 'e') {
      for (const p of g.players) {
        if (p.state === 'active' && p.invuln <= 0 && dist2(s, p) < (PLAYER_R + (s.radius || SHOT_R)) ** 2) {
          dead = true;
          if (s.aoeRadius) explode(g, s);
          else damagePlayer(g, p);
          break;
        }
      }
    }
    if (dead) {
      if (s.aoeRadius) explode(g, s);
      g.shots.splice(i, 1);
    }
  }

  g.enemies = g.enemies.filter(e => !e.dead);
  g.crystals = g.crystals.filter(c => c.hp > 0);

  // --- end conditions ---
  // Bastion: the base core falling loses the mission outright.
  if (g.core && g.core.hp <= 0) {
    g.status = 'failed';
    g.events.push({ type: 'coreDown', x: g.core.x, y: g.core.y });
    g.events.push({ type: 'fail', x: g.core.x, y: g.core.y });
    return;
  }
  // PvP ends on its own terms: BR crowns the last operative standing (a
  // simultaneous wipe goes to the last one eliminated); CTF wins are declared
  // at capture or timer expiry. Neither extracts nor all-out fails.
  if (g.mode === 'ctf' || g.mode === 'br') {
    if (g.mode === 'br') {
      const active = g.players.filter(p => p.state === 'active');
      if (g.players.length >= 2 && active.length <= 1) {
        let w;
        if (active.length) {
          w = active[0].pid;
        } else {
          // simultaneous wipe (the final collapse can burn the last few in
          // one tick): most kills this match wins; ties go to the lower pid
          w = undefined;
          let bk = -1;
          for (const p of g.players) {
            const k = p.kills || 0;
            if (k > bk || (k === bk && (w === undefined || p.pid < w))) { bk = k; w = p.pid; }
          }
        }
        pvpWin(g, w);
      }
    }
    return;
  }
  // Mode missions (bastion/ctf/br) never auto-clear on an empty field —
  // bastion waits for the final dawn, pvp modes have no AI enemies at all.
  if (g.enemies.length === 0 && !g.mode) {
    for (const p of g.players) if (p.state === 'active') extractPlayer(g, p);
    g.status = 'cleared';
    g.events.push({ type: 'clear', x: g.w * TILE / 2, y: g.h * TILE / 2, points: Math.round(g.score) });
    return;
  }
  if (g.players.every(p => p.state === 'extracted' || p.state === 'out')) {
    g.status = g.players.some(p => p.state === 'extracted') ? 'cleared' : 'failed';
    g.events.push({ type: g.status === 'cleared' ? 'clear' : 'fail', x: g.w * TILE / 2, y: g.h * TILE / 2, points: Math.round(g.score) });
  }
}

// Apply a finished level to the campaign roster.
// Cleared: characters left lying on the field are gone for good; rescues join the roster.
// Failed: no permanent losses -- you retry the level with the roster you walked in with.
export function applyResults(roster, g) {
  // PvP matches never touch the campaign roster, win or lose.
  if (g.mode === 'ctf' || g.mode === 'br') return { roster: roster.slice(), gained: [], lost: [] };
  if (g.status !== 'cleared') return { roster: roster.slice(), gained: [], lost: [] };
  const lost = g.captives.filter(c => c.fromPlayer).map(c => c.charId);
  const gained = g.rescued.filter(id => !roster.includes(id));
  const next = roster.filter(id => !lost.includes(id)).concat(gained.filter(id => !lost.includes(id)));
  return { roster: next, gained, lost };
}

// Pass full=false to omit the static tile grid (the server sends the grid once
// at levelStart and lite snapshots every tick; clients re-attach the cached grid).
export function snapshot(g, full = true) {
  return {
    name: g.name,
    objective: g.objective,
    ...(full ? { grid: g.grid } : {}), w: g.w, h: g.h,
    ...(g.dark ? { dark: true } : {}),
    timeLeft: g.timeLeft,
    status: g.status,
    shards: g.shards,
    // ctf only: per-team pools — the client HUD shows the viewer's team pool
    ...(g.teamShards ? { teamShards: g.teamShards.slice() } : {}),
    gate: g.gate ? { need: g.gate.need, after: g.gate.after, built: g.gate.built, open: g.gate.open, charging: !g.gate.open && g.gate.built >= g.gate.need } : null,
    builds: g.builds.map(b => ({
      x: b.x, y: b.y, kind: b.kind, cost: b.cost, progress: b.progress, paid: b.paid, built: b.built, hp: b.hp, maxHp: b.maxHp,
      ...(b.stage !== undefined ? { stage: b.stage, ...(b.trampled ? { trampled: true } : {}) } : {}),
      ...(b.level !== undefined ? { level: b.level } : {}),
    })),
    crystals: g.crystals.map(c => ({ x: c.x, y: c.y, hp: c.hp })),
    drops: g.drops.map(d => ({ x: d.x, y: d.y, amount: d.amount, ttl: d.ttl })),
    npcs: g.npcs.map(n => ({ id: n.id, name: n.name, x: n.x, y: n.y })),
    // New-mode state ships only when present so classic snapshots never gain
    // a key (downstream reads all use ?? / optional chaining).
    ...(g.mode ? { mode: g.mode } : {}),
    ...(g.core ? { core: { x: g.core.x, y: g.core.y, hp: g.core.hp, maxHp: g.core.maxHp } } : {}),
    ...(g.cycle ? { cycle: { phase: g.cycle.phase, nightNo: g.cycle.nightNo, t: g.cycle.t, bloodMoon: g.cycle.bloodMoon, nights: g.bastion.nights } } : {}),
    ...(g.chests.length ? { chests: g.chests.map(c => ({ x: c.x, y: c.y, opened: c.opened, loot: c.loot })) } : {}),
    ...(g.crackers.length ? { crackers: g.crackers.map(c => ({ x: c.x, y: c.y, landed: c.landed, fuse: c.fuse })) } : {}),
    ...(g.vehicles.length ? { vehicles: g.vehicles.map(v => ({ id: v.id, x: v.x, y: v.y, kind: v.kind, rider: v.rider })) } : {}),
    ...(g.towers.length ? { towers: g.towers.map(t => ({ x: t.x, y: t.y, level: t.level, hp: t.hp, maxHp: t.maxHp, occupant: t.occupant, ...(t.hp <= 0 ? { progress: t.progress || 0 } : {}) })) } : {}),
    ...(g.shops.length ? { shops: g.shops.map(s => ({ x: s.x, y: s.y })) } : {}),
    ...(g.hires.length ? { hires: g.hires.map(h => ({ x: h.x, y: h.y, cost: h.cost, job: h.job, hired: h.hired, name: h.name })) } : {}),
    ...(g.flags.length ? { flags: g.flags.map(f => ({ team: f.team, x: f.x, y: f.y, homeX: f.homeX, homeY: f.homeY, carrier: f.carrier, atBase: f.atBase, dropT: f.dropT })) } : {}),
    ...(g.caps ? { caps: g.caps.slice() } : {}),
    ...(g.zone ? { zone: { x: g.zone.x, y: g.zone.y, r: g.zone.r, targetR: g.zone.targetR, shrinkT: g.zone.shrinkT } } : {}),
    ...(g.winner !== undefined ? { winner: g.winner } : {}),
    players: g.players.map(p => ({
      pid: p.pid, name: p.name, charId: p.charId, x: p.x, y: p.y, fx: p.fx, fy: p.fy,
      state: p.state, invuln: p.invuln, specialCool: p.specialCool,
      ...(p.maxHp !== undefined ? { hp: p.hp, maxHp: p.maxHp, shield: p.shield } : {}),
      ...(p.item ? { item: { kind: p.item.kind, count: p.item.count } } : {}),
      ...(p.team !== undefined ? { team: p.team } : {}),
      ...(p.riding ? { riding: p.riding } : {}),
      ...(p.towerId != null ? { towerId: p.towerId } : {}),
      ...(p.shopping ? { shop: { idx: p.shopIdx || 0 } } : {}),
      ...(p.dmgBonus ? { dmgBonus: p.dmgBonus } : {}),
      ...(p.state === 'pick' ? { pick: { idx: p.pickIdx, choices: freeChars(g) } } : {}),
    })),
    enemies: g.enemies.map(e => ({
      id: e.id,
      kind: e.kind,
      x: e.x,
      y: e.y,
      hp: e.hp,
      maxHp: e.maxHp,
      fx: e.fx,
      fy: e.fy,
      hurt: e.hurt,
      state: e.state,
      aimT: e.aimT,
      aimX: e.aimX,
      aimY: e.aimY,
      awake: e.awake,
      returning: e.returning,
      ...(e.mutation ? { mutation: e.mutation } : {}),
    })),
    captives: g.captives.map(c => ({ charId: c.charId, x: c.x, y: c.y, owner: c.owner, fromPlayer: c.fromPlayer })),
    shots: g.shots.map(s => ({ x: s.x, y: s.y, vx: s.vx, vy: s.vy, who: s.who, kind: s.kind })),
    rescued: g.rescued,
    score: Math.round(g.score),
    kills: g.kills,
    combo: g.combo,
    events: g.events.splice(0),
  };
}
