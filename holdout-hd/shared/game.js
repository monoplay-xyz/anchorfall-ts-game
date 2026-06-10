// Core simulation shared by the Node server (online co-op) and the browser (solo).
// All distances are in pixels; speeds in characters.json are tiles/second.

export const TILE = 48;
const PLAYER_R = 14;
const ENEMY_R = 14;
const SHOT_R = 5;
const CAPTIVE_R = 12;
const RESPAWN_DELAY = 2;

const ENEMY_STATS = {
  g: { kind: 'grunt', hp: 2, speed: 1.25, score: 100 },
  a: { kind: 'archer', hp: 1, speed: 0, range: 7, cool: 1, score: 125 },
  r: { kind: 'charger', hp: 3, speed: 1.0, range: 4.2, cool: 1.2, score: 175 },
  s: { kind: 'bulwark', hp: 5, speed: 0.7, score: 225 },
  m: { kind: 'spawner', hp: 5, speed: 0, range: 6, cool: 1.5, spawnCool: 2.4, score: 250 },
  n: { kind: 'sniper', hp: 2, speed: 0, range: 10.5, cool: 1.4, score: 200 },
  w: { kind: 'skitter', hp: 1, speed: 2.0, score: 50 },
  b: { kind: 'boss', hp: 24, speed: 0.55, range: 8.5, cool: 1.1, spawnCool: 3.2, score: 1200 },
};

// Enemies hold position for this long at level start so players get their bearings.
const START_GRACE = 2.5;

const ENEMY_LETTERS = new Set(Object.keys(ENEMY_STATS));

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
  };
}

export function parseLevel(def) {
  const grid = def.tiles.map(r => r.split(''));
  const h = grid.length;
  const w = grid[0].length;
  const spawns = [];
  const captives = [];
  const enemies = [];
  let ci = 0;
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
      } else if (ENEMY_LETTERS.has(c)) {
        enemies.push(makeEnemy(c, px, py, eid++));
        grid[y][x] = '.';
      }
    }
  }
  return { grid: grid.map(r => r.join('')), w, h, spawns, captives, enemies };
}

export function createGame(def, party, charMap, roster) {
  const lvl = parseLevel(def);
  const players = party.map((p, i) => {
    const s = lvl.spawns[i % lvl.spawns.length] || { x: TILE * 2, y: TILE * 2 };
    return spawnPlayer(p.pid, p.name, p.charId, s.x + (i * 10), s.y);
  });
  return {
    name: def.name || 'Untitled',
    objective: def.objective || '',
    grid: lvl.grid, w: lvl.w, h: lvl.h,
    spawns: lvl.spawns,
    timeLeft: def.time || 90,
    players,
    enemies: lvl.enemies,
    captives: lvl.captives,
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
  return { pid, name, charId, x, y, fx: 0, fy: -1, cool: 0, state: 'active', respawn: 0, invuln: 3 };
}

function tileAt(g, x, y) {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) return '#';
  return g.grid[ty][tx];
}

function blocksMove(c) { return c === '#' || c === '~' || c === 'o'; }

function collides(g, x, y, r) {
  for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
    if (blocksMove(tileAt(g, x + ox, y + oy))) return true;
  }
  return false;
}

function moveCircle(g, e, dx, dy, r) {
  if (dx && !collides(g, e.x + dx, e.y, r)) e.x += dx;
  if (dy && !collides(g, e.x, e.y + dy, r)) e.y += dy;
}

function dist2(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function norm(dx, dy) {
  const d = Math.hypot(dx, dy) || 1;
  return [dx / d, dy / d, d];
}

function fireWeapon(g, shooter, weapon, who, target = null) {
  const [fx, fy] = target ? norm(target.x - shooter.x, target.y - shooter.y) : [shooter.fx, shooter.fy];
  const base = Math.atan2(fy, fx);
  const n = weapon.count || 1;
  const spread = ((weapon.spreadDeg || 0) * Math.PI) / 180;
  const speed = Math.max(0.1, weapon.projSpeed || 8) * TILE;
  const ttl = ((weapon.range || 5) * TILE) / speed;
  const pierce = weapon.pierce === true ? 99 : (weapon.pierce || 0);
  const aoeRadius = (weapon.aoeRadius || 0) * TILE;
  for (let i = 0; i < n; i++) {
    const a = n === 1 ? base : base - spread / 2 + (spread * i) / (n - 1);
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
}

function damageEnemy(g, e, dmg, x, y, cause) {
  if (e.dead) return false;
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
      if (tgt) {
        [sk.fx, sk.fy] = norm(tgt.x - x, tgt.y - y);
      }
      g.enemies.push(sk);
      g.events.push({ type: 'spawnEnemy', x, y, kind: sk.kind });
      return;
    }
  }
}

function stepEnemy(g, e, dt) {
  if (e.dead) return;
  if (e.hurt > 0) e.hurt -= dt;
  const [tgt, best] = nearestTarget(g, e);
  if (!tgt) return;
  const [fx, fy, d] = norm(tgt.x - e.x, tgt.y - e.y);
  e.fx = fx; e.fy = fy;

  if (e.kind === 'grunt' || e.kind === 'skitter' || e.kind === 'bulwark') {
    moveCircle(g, e, e.fx * e.speed * dt, e.fy * e.speed * dt, ENEMY_R);
    contactPlayer(g, e, best, tgt);
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
    if (d < e.range && e.cool <= 0) {
      e.state = 'windup';
      e.windup = 0.55;
      e.chargeFx = e.fx;
      e.chargeFy = e.fy;
      e.cool = 2.2;
      g.events.push({ type: 'telegraph', x: e.x, y: e.y, tx: tgt.x, ty: tgt.y, kind: e.kind });
    } else {
      moveCircle(g, e, e.fx * e.speed * dt, e.fy * e.speed * dt, ENEMY_R);
    }
    contactPlayer(g, e, dist2(e, tgt), tgt);
    return;
  }

  if (e.kind === 'archer' || e.kind === 'spawner') {
    e.cool -= dt;
    if (e.cool <= 0 && d < (e.range || 7 * TILE)) {
      fireWeapon(g, e, enemyWeapon(e.kind), 'e', tgt);
      e.cool = e.kind === 'spawner' ? 2.1 : 2.0;
    }
    if (e.kind === 'spawner') {
      e.spawnCool -= dt;
      if (e.spawnCool <= 0 && g.enemies.length < 36) {
        spawnSkitter(g, e, tgt);
        e.spawnCool = 3.0;
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
    if (e.cool <= 0 && d < e.range) {
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
    moveCircle(g, e, e.fx * TILE * chase * dt, e.fy * TILE * chase * dt, ENEMY_R + 6);
    contactPlayer(g, e, dist2(e, tgt), tgt);
    if (e.cool <= 0 && d < e.range) {
      fireWeapon(g, e, enemyWeapon(e.kind), 'e', tgt);
      e.cool = phase === 2 ? 0.75 : 1.25;
    }
    if (e.spawnCool <= 0 && g.enemies.length < 34) {
      spawnSkitter(g, e, tgt);
      e.spawnCool = phase === 2 ? 2.2 : 3.8;
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
          const s = g.spawns[0] || { x: TILE * 2, y: TILE * 2 };
          p.charId = free[0];
          p.x = s.x; p.y = s.y; p.fx = 0; p.fy = -1; p.cool = 0;
          p.invuln = 3.5;
          p.state = 'active';
          g.events.push({ type: 'spawn', x: p.x, y: p.y });
        } else {
          p.state = 'out';
        }
      }
      continue;
    }
    if (p.state !== 'active') continue;

    if (p.invuln > 0) p.invuln -= dt;
    const inp = inputs[p.pid] || {};
    const ch = g.charMap[p.charId];
    if (!ch) continue;
    let dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    let dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    if (dx || dy) {
      const [mx, my] = norm(dx, dy);
      p.fx = mx; p.fy = my;
      const v = ch.speed * TILE * dt;
      moveCircle(g, p, mx * v, my * v, PLAYER_R);
    }
    p.cool -= dt;
    if (inp.fire && p.cool <= 0) {
      fireWeapon(g, p, ch.weapon, 'p');
      p.cool = ch.weapon.cooldown;
    }

    for (const c of g.captives) {
      if (!c.owner && dist2(p, c) < (PLAYER_R + CAPTIVE_R) ** 2) {
        c.owner = p.pid;
        g.events.push({ type: 'pickup', x: c.x, y: c.y, charId: c.charId });
      }
    }

    if (tileAt(g, p.x, p.y) === 'E') extractPlayer(g, p);
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
    if (!dead && !s.overWalls && tileAt(g, s.x, s.y) === '#') {
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

export function snapshot(g) {
  return {
    name: g.name,
    objective: g.objective,
    grid: g.grid, w: g.w, h: g.h,
    timeLeft: g.timeLeft,
    status: g.status,
    players: g.players.map(p => ({ pid: p.pid, name: p.name, charId: p.charId, x: p.x, y: p.y, fx: p.fx, fy: p.fy, state: p.state, invuln: p.invuln })),
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
