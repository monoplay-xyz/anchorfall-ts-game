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

function buildMaxHp(kind) {
  if (kind === 'barricade') return 14;
  if (kind === 'turret') return 10;
  return 20; // pylon: never takes damage once built (indestructible)
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
          });
        }
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
  return { grid: grid.map(r => r.join('')), w, h, spawns, captives, enemies, npcs, builds, crystals };
}

export function createGame(def, party, charMap, roster) {
  const lvl = parseLevel(def);
  // Arcade maps (the classic single-screen levels) keep the original behavior
  // exactly: every enemy awake, straight-line steering, fire on range without
  // sight checks, global spawn caps, respawn at the level spawn point.
  const arcade = lvl.w * lvl.h <= ARCADE_MAP_TILES;
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
    players,
    enemies: lvl.enemies,
    captives: lvl.captives,
    npcs: lvl.npcs,
    builds: lvl.builds,
    crystals: lvl.crystals,
    drops: [],
    shards: 0,
    gate: def.gate ? { need: def.gate.need, built: 0, open: false } : null,
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
  if (g.builds) {
    for (const b of g.builds) {
      if (!b.built) continue;
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
      if (!b.built) continue;
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

function canSee(g, e, tgt) {
  return hasLoS(g, e.x, e.y, tgt.x, tgt.y, blocksSight);
}

function tileBlocked(g, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) return true;
  return blocksMove(g.grid[ty][tx]);
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
  if (hasLoS(g, e.x, e.y, tgt.x, tgt.y)) {
    e.path = null;
    e.repathT = 0;
    const [fx, fy] = norm(tgt.x - e.x, tgt.y - e.y);
    e.fx = fx; e.fy = fy;
    moveCircle(g, e, fx * speed * dt, fy * speed * dt, r);
    return;
  }
  e.repathT -= dt;
  if (e.repathT <= 0 || (e.path && e.pathI >= e.path.length)) {
    e.path = findPath(
      g,
      Math.floor(e.x / TILE), Math.floor(e.y / TILE),
      Math.floor(tgt.x / TILE), Math.floor(tgt.y / TILE)
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
      dmg: weapon.damage,
      who,
      overWalls: !!weapon.overWalls,
      pierce,
      aoeRadius,
      curve,
      radius: weapon.radius || SHOT_R,
      kind: weapon.kind || weapon.name || 'shot',
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

function downPlayer(g, p) {
  if (p.state !== 'active' || p.invuln > 0) return;
  g.captives.push({ id: 'c' + g.nextCaptiveId++, charId: p.charId, x: p.x, y: p.y, owner: null, fromPlayer: true });
  for (const c of g.captives) if (c.owner === p.pid) c.owner = null;
  g.events.push({ type: 'down', x: p.x, y: p.y });
  p.charId = null;
  p.state = 'down';
  p.respawn = RESPAWN_DELAY;
  p.dashT = 0;
  p.stimT = 0;
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

function addKillScore(g, e) {
  const points = (e.score || 100) * g.combo;
  g.kills++;
  g.score += points;
  g.events.push({ type: 'die', x: e.x, y: e.y, kind: e.kind, points, combo: g.combo });
  g.combo = Math.min(9, g.combo + 1);
  g.comboT = 2;
}

function killEnemy(g, e) {
  if (e.dead) return;
  e.dead = true;
  addKillScore(g, e);
  // Every kill drops a shard pickup at the corpse. Deterministic, always.
  g.drops.push({ x: e.x, y: e.y, amount: SHARD_DROPS[e.kind] || 1, ttl: DROP_TTL });
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
  } else {
    for (const p of g.players) {
      if (p.state === 'active' && p.invuln <= 0 && dist2(s, p) <= r2) downPlayer(g, p);
    }
  }
}

function nearestTarget(g, e) {
  let tgt = null, best = Infinity;
  for (const p of g.players) {
    if (p.state !== 'active') continue;
    const d = dist2(e, p);
    if (d < best) { best = d; tgt = p; }
  }
  return [tgt, best];
}

function contactPlayer(g, e, best, tgt) {
  if (tgt && best < (PLAYER_R + ENEMY_R) ** 2) downPlayer(g, tgt);
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
function attackBuilds(g, e, dt) {
  if (!MELEE_KINDS.has(e.kind) || !g.builds.length) return false;
  let touching = null;
  const rr = BUILD_RADIUS + ENEMY_R + 3;
  for (const b of g.builds) {
    if (!b.built || b.kind === 'pylon') continue;
    if (dist2(e, b) < rr * rr) { touching = b; break; }
  }
  if (!touching) return false;
  if (e.hitCool <= 0) {
    e.hitCool = 0.9;
    touching.hp -= 1;
    g.events.push({ type: 'buildHit', x: touching.x, y: touching.y });
    if (touching.hp <= 0) {
      touching.hp = 0;
      touching.built = false;
      touching.progress = 0;
      touching.paid = 0;
      g.events.push({ type: 'buildDown', x: touching.x, y: touching.y, kind: touching.kind });
    }
  }
  return true;
}

function stepEnemy(g, e, dt) {
  if (e.dead) return;
  if (e.hurt > 0) e.hurt -= dt;
  if (e.hitCool > 0) e.hitCool -= dt;
  const [tgt, best] = nearestTarget(g, e);
  if (!tgt) return;

  // Sleeping enemies hold their post until a player is seen inside aggro
  // range, bumps into them, or damages them (handled in damageEnemy).
  if (!e.awake) {
    if (best < e.aggro * e.aggro && canSee(g, e, tgt)) wakeEnemy(g, e);
    else if (best < (TILE * 2.2) ** 2) wakeEnemy(g, e);
    else return;
  }

  // Leash (big maps only — arcade keeps classic behavior byte-identical):
  // an awake enemy whose nearest target drifts beyond aggro*1.8 disengages.
  // Mobile kinds walk back to their post and fall asleep there; stationary
  // kinds simply go back to ambush sleep on the spot.
  if (!g.arcade) {
    const leash = e.aggro * LEASH_MULT;
    if (!e.returning && best > leash * leash) {
      if (STATIONARY_KINDS.has(e.kind)) { e.aimT = 0; e.awake = false; return; }
      e.returning = true;
    }
    if (e.returning) {
      if ((best < e.aggro * e.aggro && canSee(g, e, tgt)) || best < (TILE * 2.2) ** 2) {
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

export function step(g, inputs, dt) {
  if (g.status !== 'play') return;

  g.timeLeft -= dt;
  if (g.timeLeft <= 0) { g.timeLeft = 0; g.status = 'failed'; g.events.push({ type: 'fail', x: 0, y: 0 }); return; }
  if (!g.lowTimeSent && g.timeLeft <= 15) {
    g.lowTimeSent = true;
    g.events.push({ type: 'lowTime', x: g.w * TILE / 2, y: TILE });
  }
  g.comboT -= dt;
  if (g.comboT <= 0) g.combo = 1;

  // --- players ---
  for (const p of g.players) {
    if (p.state === 'down') {
      p.respawn -= dt;
      if (p.respawn <= 0) {
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

    // --- special (edge-triggered) ---
    const specialEdge = !!inp.special && !p.specialPrev;
    p.specialPrev = !!inp.special;
    if (specialEdge && p.specialCool <= 0 && ch.special) {
      const sp = ch.special;
      if (sp.kind === 'dash') {
        p.dashT = 0.15;
        p.dashFx = p.fx;
        p.dashFy = p.fy;
        p.invuln = Math.max(p.invuln, 0.4);
        g.events.push({ type: 'dash', x: p.x, y: p.y });
      } else if (sp.kind === 'stim') {
        for (const q of g.players) {
          if (q.state === 'active' && (q === p || dist2(p, q) < (TILE * 2) ** 2)) {
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
    } else {
      const dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      const dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
      if (dx || dy) {
        const [mx, my] = norm(dx, dy);
        p.fx = mx; p.fy = my;
        const v = ch.speed * TILE * dt * (p.stimT > 0 ? 1.3 : 1);
        moveCircle(g, p, mx * v, my * v, PLAYER_R);
      }
    }
    p.cool -= dt;
    if (inp.fire && p.cool <= 0) {
      fireWeapon(g, p, ch.weapon, 'p');
      p.cool = ch.weapon.cooldown;
    }

    // --- act (edge-triggered talk; build sites take priority in their radius,
    // and building itself is handled per-site below on the held bool) ---
    const actEdge = !!inp.act && !p.actPrev;
    p.actPrev = !!inp.act;
    if (actEdge) {
      let onSite = false;
      for (const b of g.builds) {
        if (!b.built && dist2(p, b) < (TILE * BUILD_REACH) ** 2) { onSite = true; break; }
      }
      if (!onSite) {
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
            g.shards += npc.gift.shards;
            gift = npc.gift.shards;
          }
          g.events.push({ type: 'talk', x: npc.x, y: npc.y, npcId: npc.id, name: npc.name, line, gift });
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

  // --- build sites: nearby players holding 'act' add progress, paying shards
  // proportionally from the shared pool as they go; an empty pool stalls. ---
  for (const b of g.builds) {
    if (b.evT > 0) b.evT -= dt;
    if (b.built) continue;
    let builders = 0;
    for (const p of g.players) {
      if (p.state !== 'active') continue;
      const inp = inputs[p.pid] || {};
      if (inp.act && dist2(p, b) < (TILE * BUILD_REACH) ** 2) builders++;
    }
    if (!builders) continue;
    let delta = Math.min((builders * dt) / (b.cost * 0.6), 1 - b.progress);
    const pay = Math.min(delta * b.cost, g.shards);
    if (b.cost > 0) delta = pay / b.cost;
    if (delta <= 0) continue; // pool empty: progress stalls
    g.shards -= pay;
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
      g.events.push({ type: 'built', x: b.x, y: b.y, kind: b.kind });
      if (b.kind === 'pylon' && g.gate) {
        g.gate.built++;
        if (!g.gate.open && g.gate.built >= g.gate.need) {
          g.gate.open = true;
          g.events.push({ type: 'gateOpen', x: g.exitX, y: g.exitY });
        }
      }
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
      g.shards += d.amount;
      g.events.push({ type: 'shard', x: d.x, y: d.y, amount: d.amount });
      g.drops.splice(i, 1);
    }
  }

  // --- built turrets: auto-fire at the nearest awake enemy in range+sight ---
  for (const b of g.builds) {
    if (!b.built || b.kind !== 'turret') continue;
    if (b.cool > 0) { b.cool -= dt; continue; }
    let tgt = null, best = (TILE * 5) ** 2;
    for (const e of g.enemies) {
      if (e.dead || !e.awake) continue;
      const dd = dist2(b, e);
      if (dd < best && hasLoS(g, b.x, b.y, e.x, e.y, blocksSight)) { best = dd; tgt = e; }
    }
    if (tgt) {
      fireWeapon(g, b, TURRET_WEAPON, 'p', tgt);
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
    } else if (!dead && s.who === 'e') {
      for (const p of g.players) {
        if (p.state === 'active' && p.invuln <= 0 && dist2(s, p) < (PLAYER_R + (s.radius || SHOT_R)) ** 2) {
          dead = true;
          if (s.aoeRadius) explode(g, s);
          else downPlayer(g, p);
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
  if (g.enemies.length === 0) {
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
    timeLeft: g.timeLeft,
    status: g.status,
    shards: g.shards,
    gate: g.gate ? { need: g.gate.need, built: g.gate.built, open: g.gate.open } : null,
    builds: g.builds.map(b => ({ x: b.x, y: b.y, kind: b.kind, cost: b.cost, progress: b.progress, paid: b.paid, built: b.built, hp: b.hp, maxHp: b.maxHp })),
    crystals: g.crystals.map(c => ({ x: c.x, y: c.y, hp: c.hp })),
    drops: g.drops.map(d => ({ x: d.x, y: d.y, amount: d.amount, ttl: d.ttl })),
    npcs: g.npcs.map(n => ({ id: n.id, name: n.name, x: n.x, y: n.y })),
    players: g.players.map(p => ({
      pid: p.pid, name: p.name, charId: p.charId, x: p.x, y: p.y, fx: p.fx, fy: p.fy,
      state: p.state, invuln: p.invuln, specialCool: p.specialCool,
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
