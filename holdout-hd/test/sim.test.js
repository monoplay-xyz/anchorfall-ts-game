import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { applyResults, charsById, createGame, parseLevel, snapshot, step, TILE } from '../shared/game.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const characters = JSON.parse(fs.readFileSync(path.join(root, 'shared/characters.json'), 'utf8'));
const charMap = charsById(characters);
const startingRoster = characters.filter(c => c.starting).map(c => c.id);
const levels = fs.readdirSync(path.join(root, 'levels'))
  .filter(f => f.endsWith('.json'))
  .sort()
  .map(f => JSON.parse(fs.readFileSync(path.join(root, 'levels', f), 'utf8')));

function run(g, inputFn, seconds, dt = 1 / 30) {
  const frames = Math.ceil(seconds / dt);
  for (let i = 0; i < frames && g.status === 'play'; i++) {
    step(g, inputFn(g, i * dt), dt);
  }
}

function aimAtNearest(g, p) {
  let target = null;
  let best = Infinity;
  for (const e of g.enemies) {
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    const d = dx * dx + dy * dy;
    if (d < best) { best = d; target = e; }
  }
  if (!target) return { fire: false };
  const dx = target.x - p.x;
  const dy = target.y - p.y;
  const d = Math.hypot(dx, dy) || 1;
  p.fx = dx / d;
  p.fy = dy / d;
  return {
    fire: true,
    left: dx < -TILE * 2,
    right: dx > TILE * 2,
    up: dy < -TILE * 2,
    down: dy > TILE * 2,
  };
}

function testLevelsParse() {
  const classics = levels.filter(l => !l.story && !l.expedition);
  assert.equal(classics.length, 10, 'classic campaign keeps exactly its 10 missions');
  assert.ok(levels.length >= 11, 'at least one story/expedition level ships beside the classics');
  const validChars = new Set(characters.map(c => c.id));
  const captiveIds = new Set();
  for (const [idx, level] of levels.entries()) {
    const w = level.tiles[0].length;
    const pvp = level.mode === 'ctf' || level.mode === 'br';
    assert.ok(level.tiles.every(r => r.length === w), `level ${idx + 1} rows have equal width`);
    assert.ok(level.tiles.some(r => r.includes('P')), `level ${idx + 1} has a spawn`);
    if (!pvp) assert.ok(level.tiles.some(r => /[garsmnb]/.test(r)), `level ${idx + 1} has enemies`);
    for (const id of level.captiveChars || []) {
      assert.ok(validChars.has(id), `${id} is a valid captive character`);
      captiveIds.add(id);
    }
    const parsed = parseLevel(level);
    assert.ok(parsed.spawns.length > 0, `level ${idx + 1} parses spawns`);
    if (!pvp) assert.ok(parsed.enemies.length > 0, `level ${idx + 1} parses enemies`);
  }
  for (const ch of characters) {
    if (!ch.starting) assert.ok(captiveIds.has(ch.id), `${ch.id} is obtainable as a captive`);
  }
}

function testEveryCharacterCanKill() {
  const level = {
    name: 'Weapon Test',
    time: 20,
    captiveChars: [],
    tiles: [
      '##########',
      '#........#',
      '#.P.g..E.#',
      '#........#',
      '##########',
    ],
  };
  for (const ch of characters) {
    const g = createGame(level, [{ pid: 0, name: ch.name, charId: ch.id }], charMap, [ch.id]);
    g.players[0].invuln = 99;
    run(g, () => {
      const p = g.players[0];
      if (p) { p.fx = 1; p.fy = 0; }
      return { 0: { fire: true } };
    }, 8);
    assert.ok(g.kills >= 1 || g.status === 'cleared', `${ch.name} can kill a grunt`);
  }
}

function testNewEnemiesCanDownPlayer() {
  const cases = [
    ['r', 'charger'],
    ['s', 'bulwark'],
    ['m', 'spawner'],
    ['n', 'sniper'],
    ['b', 'boss'],
  ];
  for (const [letter, label] of cases) {
    const level = {
      name: `${label} Test`,
      time: 20,
      captiveChars: [],
      tiles: [
        '##########',
        '#........#',
        `#.P.${letter}..E.#`,
        '#........#',
        '##########',
      ],
    };
    const g = createGame(level, [{ pid: 0, name: 'Target', charId: startingRoster[0] }], charMap, startingRoster);
    g.players[0].invuln = 0;
    run(g, () => ({ 0: {} }), 10);
    assert.ok(g.captives.some(c => c.fromPlayer) || g.players[0].state !== 'active', `${label} can down a player`);
  }
}

function testRescueAndPermanentLossRules() {
  const rescueLevel = {
    name: 'Rescue Test',
    time: 20,
    captiveChars: ['sniper'],
    tiles: [
      '########',
      '#P.c.E.#',
      '#..g...#',
      '########',
    ],
  };
  const g = createGame(rescueLevel, [{ pid: 0, name: 'Scout', charId: 'scout' }], charMap, ['scout']);
  g.captives[0].owner = 0;
  g.players[0].x = 5.5 * TILE;
  g.players[0].y = 1.5 * TILE;
  step(g, { 0: {} }, 1 / 30);
  assert.equal(g.status, 'cleared', 'extracting a carried captive clears when all players are out');
  assert.deepEqual(applyResults(['scout'], g).gained, ['sniper'], 'rescued captive joins roster');

  const lossGame = createGame(rescueLevel, [{ pid: 0, name: 'Scout', charId: 'scout' }], charMap, ['scout', 'soldier']);
  lossGame.captives.push({ id: 'loss', charId: 'scout', x: TILE, y: TILE, owner: null, fromPlayer: true });
  lossGame.status = 'cleared';
  assert.deepEqual(applyResults(['scout', 'soldier'], lossGame).roster, ['soldier'], 'unrescued downed character is permanently lost on clear');
  lossGame.status = 'failed';
  assert.deepEqual(applyResults(['scout', 'soldier'], lossGame).roster, ['scout', 'soldier'], 'failed levels lose no one permanently');
}

function testScriptedBotClearsLevelOne() {
  const party = startingRoster.map((id, i) => ({ pid: i, name: id, charId: id }));
  const g = createGame(levels[0], party, charMap, startingRoster);
  for (const p of g.players) p.invuln = 999;
  run(g, () => {
    const inputs = {};
    for (const p of g.players) {
      if (p.state === 'active') inputs[p.pid] = aimAtNearest(g, p);
    }
    return inputs;
  }, 45);
  assert.equal(g.status, 'cleared', 'scripted bot clears level 1');
}

// --- big-map AI: enemies sleep until a player gets close ---
function bigEmptyLevel(extraRows = []) {
  // 40x20 = 800 tiles, above the arcade auto-wake threshold
  const tiles = [];
  tiles.push('#'.repeat(40));
  for (let y = 1; y < 19; y++) tiles.push('#' + '.'.repeat(38) + '#');
  tiles.push('#'.repeat(40));
  for (const [y, row] of extraRows) tiles[y] = row;
  return { name: 'Big Test', time: 60, captiveChars: [], tiles };
}

function testAggroSleep() {
  const level = bigEmptyLevel([
    [2, '#P....................................#'],
    [17, '#....................................g#'],
  ]);
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const e = g.enemies[0];
  const ex = e.x, ey = e.y;
  run(g, () => ({ 0: {} }), 5);
  assert.equal(e.awake, false, 'distant enemy stays asleep');
  assert.ok(e.x === ex && e.y === ey, 'sleeping enemy does not move');
  // teleport the player next to it: it must wake and chase
  g.players[0].x = e.x - TILE * 3;
  g.players[0].y = e.y;
  run(g, () => ({ 0: {} }), 1.5);
  assert.equal(e.awake, true, 'enemy wakes when a player gets close');
}

function testSmallMapsStayArcade() {
  const level = {
    name: 'Arcade', time: 20, captiveChars: [],
    tiles: ['##########', '#P......g#', '##########'],
  };
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  assert.equal(g.enemies[0].awake, true, 'small maps auto-wake every enemy (classic behavior)');
}

function testPathfindingAroundWall() {
  // a wall splits the room; the enemy must route around the gap at the bottom.
  // Geometry keeps the straight-line distance inside the skitter's big-map
  // leash (aggro 10.5 * 1.8 tiles) while still forcing a long detour.
  const rows = [];
  rows.push('#'.repeat(40));
  for (let y = 1; y < 19; y++) {
    let r = '#' + '.'.repeat(38) + '#';
    if (y >= 1 && y <= 15) r = r.slice(0, 20) + '#' + r.slice(21);
    rows.push(r);
  }
  rows.push('#'.repeat(40));
  rows[3] = rows[3].slice(0, 16) + 'P' + rows[3].slice(17);
  // skitter: fast enough to finish the ~36-tile detour within the test budget
  rows[3] = rows[3].slice(0, 24) + 'w' + rows[3].slice(25);
  const level = { name: 'Path Test', time: 90, captiveChars: [], tiles: rows };
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const e = g.enemies[0];
  e.awake = true;
  g.players[0].invuln = 999;
  const d0 = Math.hypot(e.x - g.players[0].x, e.y - g.players[0].y);
  run(g, () => ({ 0: {} }), 40);
  const d = Math.hypot(e.x - g.players[0].x, e.y - g.players[0].y);
  assert.ok(d < TILE * 4, `enemy pathfinds around the wall (started ${Math.round(d0 / TILE)}, ended ${Math.round(d / TILE)} tiles away)`);
}

function testSnapshotGridModes() {
  const g = createGame(levels[0], [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const full = snapshot(g, true);
  const lite = snapshot(g, false);
  assert.ok(Array.isArray(full.grid), 'full snapshot carries the grid');
  assert.equal(lite.grid, undefined, 'lite snapshot omits the grid');
  assert.equal(lite.w, g.w, 'lite snapshot keeps dimensions');
  assert.ok(full.enemies.every(e => typeof e.awake === 'boolean'), 'snapshot exposes awake state');
}

function testTwoLocalPlayersMoveIndependently() {
  const g = createGame(levels[0], [
    { pid: 0, name: 'P1', charId: startingRoster[0] },
    { pid: 1, name: 'P2', charId: startingRoster[1] },
  ], charMap, startingRoster);
  for (const p of g.players) p.invuln = 999;
  const [a, b] = g.players;
  const ax = a.x, bx = b.x;
  run(g, () => ({ 0: { left: true }, 1: { right: true } }), 1);
  assert.ok(a.x < ax, 'player 1 moved left');
  assert.ok(b.x > bx, 'player 2 moved right');
}

// Generic integrity gate for EVERY story/expedition level. New chapters are
// validated automatically the moment their files land in levels/.
const ART_KEYS = new Set(['anchorcraft', 'crossing', 'basin', 'quorum', 'forkfall', 'siege', 'settlement', 'campfire', 'entropy', 'dawn']);
const WAVE_LETTERS = new Set('garsmnwb');

function testStoryLevelIntegrity() {
  const storyLevels = levels.filter(l => l.story || l.expedition);
  assert.ok(storyLevels.length >= 1, 'at least one story/expedition level exists');
  for (const def of storyLevels) {
    const tag = def.name || 'story level';
    const w = def.tiles[0].length;
    assert.ok(def.tiles.every(r => r.length === w), `${tag}: rows have equal width`);
    const parsed = parseLevel(def);
    // Mode maps (bastion/ctf/br) need no gate and no exit; ctf wants 4 spawns
    // per side, br fields no AI enemies at all.
    const needSpawns = def.mode === 'ctf' ? 8 : 2;
    assert.ok(parsed.spawns.length >= needSpawns, `${tag}: at least ${needSpawns} spawns`);
    if (def.mode === 'ctf' || def.mode === 'br') {
      assert.equal(parsed.enemies.length, 0, `${tag}: pvp maps carry no AI enemies`);
      assert.ok(def.expedition, `${tag}: mode maps must be expedition-tagged so rotations skip them`);
    }
    if (def.mode === 'ctf') assert.equal(parsed.flags.length, 2, `${tag}: ctf maps carry exactly two flag stands`);
    if (def.mode === 'bastion') assert.ok(parsed.core, `${tag}: bastion maps carry a base core`);
    // entity arrays must match their tile counts exactly
    const tileCount = ch => def.tiles.reduce((n, r) => n + (r.split(ch).length - 1), 0);
    assert.equal((def.captiveChars || []).length, tileCount('c'), `${tag}: captiveChars length matches 'c' tiles`);
    assert.equal((def.npcs || []).length, tileCount('N'), `${tag}: npcs length matches 'N' tiles`);
    assert.equal((def.builds || []).length, tileCount('B'), `${tag}: builds length matches 'B' tiles`);
    if (def.gate) {
      const pylons = (def.builds || []).filter(b => b.kind === 'pylon').length;
      assert.ok(def.gate.need <= pylons, `${tag}: gate.need ${def.gate.need} <= ${pylons} pylon sites`);
    }
    // walkable connectivity (BFS) from the first spawn to every objective
    // ('T' trees block movement; crystals are parsed out and never block)
    const pass = c => c !== '#' && c !== 'T' && c !== '~' && c !== 'o';
    const seen = new Set();
    const sx = Math.floor(parsed.spawns[0].x / TILE), sy = Math.floor(parsed.spawns[0].y / TILE);
    const q = [[sx, sy]];
    seen.add(sx + ',' + sy);
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= parsed.w || ny >= parsed.h) continue;
        const k = nx + ',' + ny;
        if (!seen.has(k) && pass(parsed.grid[ny][nx])) { seen.add(k); q.push([nx, ny]); }
      }
    }
    const reach = (px, py, what) =>
      assert.ok(seen.has(Math.floor(px / TILE) + ',' + Math.floor(py / TILE)), `${tag}: ${what} reachable from spawn`);
    for (let y = 0; y < parsed.h; y++)
      for (let x = 0; x < parsed.w; x++)
        if (parsed.grid[y][x] === 'E') assert.ok(seen.has(x + ',' + y), `${tag}: exit at ${x},${y} reachable from spawn`);
    for (const c of parsed.captives) reach(c.x, c.y, `captive ${c.charId}`);
    for (const n of parsed.npcs) reach(n.x, n.y, `npc ${n.id}`);
    for (const b of parsed.builds) reach(b.x, b.y, `${b.kind} site`);
    // Water-locked chests are legal when the map moors a walk-reachable
    // skiff: island hoards are skiff runs by design. Sea-reach floods '~'
    // (and any shore it touches) outward from each reachable skiff — exactly
    // the ground a boarded skiff can cover, nothing more.
    const seaSeen = new Set(seen);
    const seaQ = parsed.vehicles
      .filter(v => v.kind === 'skiff' && seen.has(Math.floor(v.x / TILE) + ',' + Math.floor(v.y / TILE)))
      .map(v => [Math.floor(v.x / TILE), Math.floor(v.y / TILE)]);
    while (seaQ.length) {
      const [x, y] = seaQ.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= parsed.w || ny >= parsed.h) continue;
        const k = nx + ',' + ny;
        const t = parsed.grid[ny][nx];
        if (!seaSeen.has(k) && (t === '~' || pass(t))) { seaSeen.add(k); seaQ.push([nx, ny]); }
      }
    }
    for (const c of parsed.chests)
      assert.ok(seaSeen.has(Math.floor(c.x / TILE) + ',' + Math.floor(c.y / TILE)), `${tag}: chest reachable from spawn (afoot or by skiff)`);
    for (const t of parsed.towers) reach(t.x, t.y, 'watchtower');
    for (const s of parsed.shops) reach(s.x, s.y, 'shop');
    for (const h2 of parsed.hires) reach(h2.x, h2.y, `${h2.job} post`);
    for (const v of parsed.vehicles) reach(v.x, v.y, `${v.kind}`);
    for (const f of parsed.flags) reach(f.x, f.y, `team ${f.team} flag stand`);
    if (parsed.core) reach(parsed.core.x, parsed.core.y, 'base core');
    // story modifiers: wave letters/edges/timing must be sane
    for (const wv of (def.modifiers && def.modifiers.waves) || []) {
      assert.ok(wv.letters.length >= 1 && [...wv.letters].every(c => WAVE_LETTERS.has(c)), `${tag}: wave letters '${wv.letters}' all in garsmnwb`);
      assert.ok(['n', 's', 'e', 'w'].includes(wv.edge), `${tag}: wave edge '${wv.edge}' is n/s/e/w`);
      assert.ok(typeof wv.at === 'number' && wv.at < def.time, `${tag}: wave at ${wv.at}s fires inside the ${def.time}s timer`);
    }
    // cutscene slides: title, 1-3 lines, known art key
    for (const slide of [...(def.intro || []), ...(def.outro || [])]) {
      assert.ok(typeof slide.title === 'string' && slide.title.length > 0, `${tag}: slide has a title`);
      assert.ok(Array.isArray(slide.lines) && slide.lines.length >= 1 && slide.lines.length <= 3, `${tag}: slide has 1-3 lines`);
      assert.ok(ART_KEYS.has(slide.art), `${tag}: slide art '${slide.art}' is a known art key`);
    }
  }
}

function testArcadeSpawnCapsPreserved() {
  // classic single-screen spawner level: total enemy population must respect
  // the original global cap of 36, exactly as shipped
  const level = {
    name: 'Cap Test', time: 90, captiveChars: [],
    tiles: [
      '####################',
      '#P.................#',
      '#......m....m......#',
      '#..................#',
      '#......m....m......#',
      '#.................E#',
      '####################',
    ],
  };
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  assert.equal(g.arcade, true, 'small map is arcade class');
  g.players[0].invuln = 999;
  let peak = 0;
  run(g, () => { peak = Math.max(peak, g.enemies.length); return { 0: {} }; }, 60);
  peak = Math.max(peak, g.enemies.length);
  assert.ok(peak <= 36, `arcade spawn cap holds (peaked at ${peak})`);
}

function testEnemiesShootAcrossWater() {
  // sight stops at walls only: an archer must fire over a river, like its arrows do
  const rows = [];
  rows.push('#'.repeat(40));
  for (let y = 1; y < 19; y++) rows.push('#' + '.'.repeat(38) + '#');
  rows.push('#'.repeat(40));
  let r = rows[5];
  r = r.slice(0, 4) + 'P' + r.slice(5);           // player at x=4
  r = r.slice(0, 6) + '~~~' + r.slice(9);         // 3-tile river
  r = r.slice(0, 10) + 'a' + r.slice(11);         // archer at x=10 (6 tiles < range 7)
  rows[5] = r;
  const level = { name: 'River Test', time: 30, captiveChars: [], tiles: rows };
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  assert.equal(g.arcade, false, 'map is big-map class');
  g.players[0].invuln = 999;
  run(g, () => ({ 0: {} }), 8);
  assert.equal(g.enemies[0]?.awake ?? true, true, 'archer sights the player across the river');
  assert.ok(g.events.some(ev => ev.type === 'shoot' && ev.who === 'e'), 'archer fires across the river');
}

function testPickupOwnerPidZeroNotStolen() {
  const level = {
    name: 'Pickup Test', time: 20, captiveChars: ['sniper'],
    tiles: ['##########', '#PPc...E.#', '##########'],
  };
  const g = createGame(level, [
    { pid: 0, name: 'P1', charId: 'scout' },
    { pid: 1, name: 'P2', charId: 'soldier' },
  ], charMap, ['scout', 'soldier']);
  const c = g.captives[0];
  c.owner = 0;
  // park P2 directly on the captive
  g.players[1].x = c.x;
  g.players[1].y = c.y;
  const before = g.events.length;
  step(g, { 0: {}, 1: {} }, 1 / 30);
  assert.equal(c.owner, 0, 'pid-0 ownership is not stolen by a touching teammate');
  assert.ok(!g.events.slice(before).some(ev => ev.type === 'pickup'), 'no spurious pickup event');
}

function testRespawnNearTeammateOnBigMap() {
  const level = bigEmptyLevel([
    [2, '#PP...................................#'],
    [17, '#g....................................#'], // keeps the level from auto-clearing
  ]);
  const g = createGame(level, [
    { pid: 0, name: 'A', charId: startingRoster[0] },
    { pid: 1, name: 'B', charId: startingRoster[1] },
  ], charMap, startingRoster.slice(0, 3));
  assert.equal(g.arcade, false);
  // B fights far east; A goes down
  g.players[1].x = 34 * TILE;
  g.players[1].y = 10 * TILE;
  g.players[0].charId = null;
  g.players[0].state = 'down';
  g.players[0].respawn = 0.01;
  step(g, { 0: {}, 1: {} }, 1 / 30); // timer expires -> pick
  step(g, { 0: {}, 1: {} }, 1 / 30); // release
  step(g, { 0: { fire: true }, 1: {} }, 1 / 30); // confirm first choice
  const a = g.players[0];
  assert.equal(a.state, 'active', 'player respawned');
  const d = Math.hypot(a.x - g.players[1].x, a.y - g.players[1].y);
  assert.ok(d < TILE * 6, `respawn lands beside the living teammate (${Math.round(d / TILE)} tiles away)`);
}

// --- leash: big-map enemies disengage, walk home and fall back asleep ---
function testLeashReturnAndResleep() {
  const level = bigEmptyLevel([
    [2, '#P....................................#'],
    [17, '#..................................g..#'],
  ]);
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const e = g.enemies[0];
  const hx = e.x, hy = e.y;
  g.players[0].invuln = 999;
  g.graceT = 0; // skip the level-start freeze; this test is about the leash
  // walk a player up to it: it wakes and chases
  g.players[0].x = e.x - TILE * 3;
  g.players[0].y = e.y;
  run(g, () => ({ 0: {} }), 1);
  assert.equal(e.awake, true, 'enemy wakes near a player');
  assert.ok(e.x !== hx || e.y !== hy, 'awake enemy left its post');
  // teleport the player across the map, far beyond the leash
  g.players[0].x = TILE * 2;
  g.players[0].y = TILE * 2;
  let sawReturning = false;
  run(g, () => { if (e.returning) sawReturning = true; return { 0: {} }; }, 12);
  assert.ok(sawReturning, 'leashed enemy entered the returning state');
  assert.equal(e.awake, false, 'returned enemy fell back into ambush sleep');
  assert.ok(Math.hypot(e.x - hx, e.y - hy) < TILE, 'enemy is back at its post');
}

// --- shard economy: kills drop pickups that magnetize and join the pool ---
function testShardDropMagnetPickup() {
  const level = bigEmptyLevel([
    [5, '#...P.g...............................#'],
    [17, '#....................................g#'],
  ]);
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.players[0].invuln = 999;
  run(g, gg => {
    const p = gg.players[0];
    p.fx = 1; p.fy = 0;
    return { 0: { fire: true } };
  }, 2.5);
  assert.equal(g.kills, 1, 'nearby grunt is dead');
  assert.ok(g.events.some(ev => ev.type === 'shard' && ev.amount === 1), 'shard pickup event fired');
  assert.equal(g.shards, 1, 'grunt shard magnetized into the squad pool');
  assert.equal(g.drops.length, 0, 'collected drop is gone');
  // far-away drops expire on their ttl instead
  g.drops.push({ x: 35 * TILE, y: 17 * TILE, amount: 5, ttl: 0.3 });
  run(g, () => ({ 0: {} }), 1);
  assert.equal(g.drops.length, 0, 'unclaimed drop expires');
  assert.equal(g.shards, 1, 'expired drop pays nothing');
}

// --- building: a pylon paid from the pool opens the gate, which gates extraction ---
function testPylonOpensGateAndGatesExtraction() {
  const tiles = [];
  tiles.push('#'.repeat(40));
  for (let y = 1; y < 19; y++) tiles.push('#' + '.'.repeat(38) + '#');
  tiles.push('#'.repeat(40));
  tiles[2] = '#P' + tiles[2].slice(2);
  tiles[10] = tiles[10].slice(0, 10) + 'B..E' + tiles[10].slice(14);
  tiles[17] = tiles[17].slice(0, 37) + 'g' + tiles[17].slice(38);
  const def = {
    name: 'Gate Test', time: 120, captiveChars: [],
    gate: { need: 1 },
    builds: [{ kind: 'pylon', cost: 14 }],
    tiles,
  };
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  assert.equal(g.arcade, false, 'synthetic gate map is big-map class');
  assert.deepEqual(snapshot(g, false).gate, { need: 1, after: 0, built: 0, open: false, charging: false }, 'snapshot carries the dormant gate');
  const b = g.builds[0];
  const p = g.players[0];
  p.invuln = 999;
  // dormant gate: standing on 'E' does not extract
  p.x = 13.5 * TILE; p.y = 10.5 * TILE;
  step(g, { 0: {} }, 1 / 30);
  assert.equal(p.state, 'active', 'dormant gate does not extract');
  // build the pylon with a pre-granted shard pool
  g.shards = 14;
  p.x = b.x + TILE; p.y = b.y;
  run(g, () => ({ 0: { act: true } }), 10);
  assert.equal(b.built, true, 'pylon completes');
  assert.ok(b.paid > 13.9, 'cost paid from the shared pool as progress accrued');
  assert.ok(g.shards < 0.1, 'pool spent');
  assert.ok(g.events.some(ev => ev.type === 'build'), 'build progress events fired');
  assert.ok(g.events.some(ev => ev.type === 'built' && ev.kind === 'pylon'), 'built event fired');
  assert.ok(g.events.some(ev => ev.type === 'gateOpen'), 'gateOpen event fired');
  assert.equal(g.gate.open, true, 'pylon quorum opens the gate');
  // the built pylon blocks movement
  p.x = b.x - TILE; p.y = b.y;
  run(g, () => ({ 0: { right: true } }), 1);
  assert.ok(p.x < b.x - 18, 'built pylon blocks the player');
  // with the gate open, 'E' extracts again
  p.x = 13.5 * TILE; p.y = 10.5 * TILE;
  step(g, { 0: {} }, 1 / 30);
  assert.equal(p.state, 'extracted', 'open gate extracts');
}

// --- npc talk: edge-detected act, cycling lines, one-time gift ---
function testNpcTalkAndGift() {
  const level = {
    name: 'Talk Test', time: 30, captiveChars: [],
    npcs: [{ id: 'uma', name: 'Uma', lines: ['First line', 'Second line'], gift: { shards: 6 } }],
    tiles: ['#########', '#PN....g#', '#########'],
  };
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.players[0].invuln = 999;
  assert.equal(g.npcs.length, 1, 'npc bound from level def');
  assert.deepEqual(
    snapshot(g, false).npcs,
    [{ id: 'uma', name: 'Uma', x: 2.5 * TILE, y: 1.5 * TILE }],
    'snapshot exposes npc id/name/position only'
  );
  // holding act for a second still produces exactly one talk (edge-detected)
  run(g, () => ({ 0: { act: true } }), 1);
  let talks = g.events.filter(ev => ev.type === 'talk');
  assert.equal(talks.length, 1, 'held act produces a single talk');
  assert.equal(talks[0].line, 'First line');
  assert.equal(talks[0].npcId, 'uma');
  assert.equal(talks[0].gift, 6, 'first talk includes the gift amount');
  assert.equal(g.shards, 6, 'gift shards land in the pool');
  // release, press again: next line, gift only once
  run(g, () => ({ 0: {} }), 0.2);
  run(g, () => ({ 0: { act: true } }), 0.2);
  talks = g.events.filter(ev => ev.type === 'talk');
  assert.equal(talks.length, 2, 'second press talks again');
  assert.equal(talks[1].line, 'Second line', 'lines advance');
  assert.equal(talks[1].gift, undefined, 'gift granted only once');
  assert.equal(g.shards, 6);
  // third press cycles back to the first line
  run(g, () => ({ 0: {} }), 0.2);
  run(g, () => ({ 0: { act: true } }), 0.2);
  talks = g.events.filter(ev => ev.type === 'talk');
  assert.equal(talks[2].line, 'First line', 'lines cycle');
}

// --- specials: every character's special does something ---
function testEveryCharacterSpecial() {
  // a full ring of grunts two tiles out in every direction: whatever shape a
  // weapon special throws (forward, twin-opposed, 360, curved, lobbed), its
  // projectiles must cross the ring and connect with something
  const ringTiles = (() => {
    const rows = [];
    for (let y = 0; y < 15; y++) {
      let r = '';
      for (let x = 0; x < 15; x++) r += (x === 0 || y === 0 || x === 14 || y === 14) ? '#' : '.';
      rows.push(r);
    }
    const put = (x, y, c) => { rows[y] = rows[y].slice(0, x) + c + rows[y].slice(x + 1); };
    put(7, 7, 'P');
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) put(7 + dx, 7 + dy, 'g');
      }
    }
    return rows;
  })();
  for (const ch of characters) {
    assert.ok(ch.special && ch.special.kind, `${ch.name} has a special`);
    assert.ok(ch.special.cooldown >= 3 && ch.special.cooldown <= 8, `${ch.name} special cooldown in range`);
    const sp = ch.special;
    if (sp.kind === 'dash') {
      const level = { name: 'Dash', time: 20, captiveChars: [], tiles: ['##########', '#P......g#', '##########'] };
      const g = createGame(level, [{ pid: 0, name: ch.name, charId: ch.id }], charMap, [ch.id]);
      const p = g.players[0];
      p.invuln = 0;
      p.fx = 1; p.fy = 0;
      const x0 = p.x;
      step(g, { 0: { special: true } }, 1 / 30);
      assert.ok(p.invuln > 0.3, `${ch.name} dash grants brief invulnerability`);
      run(g, () => ({ 0: {} }), 0.3);
      assert.ok(p.x - x0 > TILE * 2.5, `${ch.name} dash covers ~3 tiles`);
      assert.ok(g.events.some(ev => ev.type === 'dash'), 'dash event emitted');
      assert.ok(p.specialCool > 0, 'dash starts the cooldown');
    } else if (sp.kind === 'stim') {
      const level = { name: 'Stim', time: 20, captiveChars: [], tiles: ['##########', '#PP.....g#', '##########'] };
      const allyId = startingRoster.find(id => id !== ch.id) || startingRoster[0];
      const g = createGame(level, [
        { pid: 0, name: ch.name, charId: ch.id },
        { pid: 1, name: 'Ally', charId: allyId },
      ], charMap, startingRoster);
      const [a, ally] = g.players;
      a.invuln = 0; ally.invuln = 0;
      step(g, { 0: { special: true }, 1: {} }, 1 / 30);
      assert.ok(a.invuln >= 1.4, `${ch.name} stim shields the caster`);
      assert.ok(ally.invuln >= 1.4, 'stim shields the nearby ally');
      assert.ok(a.stimT > 2.5, 'caster gains the speed surge');
      assert.ok(g.events.some(ev => ev.type === 'special' && ev.kind === 'stim'), 'stim special event emitted');
      assert.ok(a.specialCool > 0, 'stim starts the cooldown');
    } else {
      const level = { name: 'Special', time: 30, captiveChars: [], tiles: ringTiles };
      const g = createGame(level, [{ pid: 0, name: ch.name, charId: ch.id }], charMap, [ch.id]);
      g.players[0].invuln = 999;
      run(g, (gg, t) => ({ 0: { special: Math.round(t * 30) % 2 === 0 } }), 15);
      assert.ok(g.kills >= 1 || g.status === 'cleared', `${ch.name}'s special (${sp.name}) can kill a grunt`);
      assert.ok(g.events.some(ev => ev.type === 'special' && ev.who === 'p'), 'weapon special event emitted');
    }
  }
}

// --- crystals: player fire cracks a node, which spills a 4-shard pickup ---
function testCrystalBreakDropsShards() {
  const level = bigEmptyLevel([
    [5, '#...P..Y..............................#'],
    [17, '#....................................g#'],
  ]);
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  assert.equal(g.crystals.length, 1, 'crystal parsed from the grid');
  g.players[0].invuln = 999;
  run(g, gg => {
    const p = gg.players[0];
    p.fx = 1; p.fy = 0;
    return { 0: { fire: true } };
  }, 2.5);
  assert.equal(g.crystals.length, 0, 'crystal breaks after 3 damage');
  assert.ok(g.events.some(ev => ev.type === 'crystal'), 'crystal break event emitted');
  assert.equal(g.drops.length, 1, 'broken crystal leaves a pickup');
  assert.equal(g.drops[0].amount, 4, 'crystal pickup is worth 4 shards');
  g.players[0].x = 6.5 * TILE;
  g.players[0].y = 5.5 * TILE;
  run(g, () => ({ 0: {} }), 1);
  assert.equal(g.shards, 4, 'crystal shards magnetize and collect');
}

// --- big-map spawn tuning: sustained brooding stays under the global 90 cap ---
function testBigMapSpawnerPopulationCap() {
  const W2 = 70, H2 = 30;
  const rows = [];
  for (let y = 0; y < H2; y++) {
    let r = '';
    for (let x = 0; x < W2; x++) r += (x === 0 || y === 0 || x === W2 - 1 || y === H2 - 1) ? '#' : '.';
    rows.push(r);
  }
  const put = (x, y, c) => { rows[y] = rows[y].slice(0, x) + c + rows[y].slice(x + 1); };
  put(35, 15, 'P');
  for (const [x, y] of [[48, 15], [44, 24], [35, 27], [26, 24], [22, 15], [26, 6], [35, 3], [44, 6]]) put(x, y, 'm');
  const level = { name: 'Brood Test', time: 300, captiveChars: [], tiles: rows };
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  assert.equal(g.arcade, false, 'brood map is big-map class');
  g.players[0].invuln = 999;
  for (const e of g.enemies) e.awake = true;
  let peak = 0;
  run(g, () => { peak = Math.max(peak, g.enemies.length); return { 0: {} }; }, 100);
  peak = Math.max(peak, g.enemies.length);
  assert.ok(peak > 36, `big-map spawners outgrow the arcade cap (peaked at ${peak})`);
  assert.ok(peak <= 90, `big-map population respects the global 90 cap (peaked at ${peak})`);
}

// --- determinism: identical scripted co-op runs on the expedition match exactly ---
function testDeterministicExpeditionRun() {
  const def = levels.find(l => l.expedition);
  const party = startingRoster.map((id, i) => ({ pid: i, name: id, charId: id }));
  const runOnce = () => {
    const g = createGame(def, party, charMap, startingRoster);
    const dt = 1 / 30;
    for (let i = 0; i < 900 && g.status === 'play'; i++) {
      const inputs = {};
      for (const p of g.players) {
        inputs[p.pid] = {
          right: (i % 50) < 35,
          left: false,
          down: p.pid % 2 === 0 && (i % 80) < 15,
          up: p.pid % 2 === 1 && (i % 80) < 15,
          fire: (i % 9) < 4,
          special: (i % 150) === 20 + p.pid,
          act: (i % 70) < 12,
        };
      }
      step(g, inputs, dt);
    }
    return JSON.stringify(snapshot(g, true));
  };
  const a = runOnce();
  const b = runOnce();
  assert.ok(a === b, 'two identical scripted runs on the expedition produce identical snapshots at t=30');
}

function testRespawnPickFlow() {
  const level = bigEmptyLevel([
    [2, '#PP...................................#'],
    [17, '#g....................................#'], // keeps the level alive
  ]);
  const g = createGame(level, [
    { pid: 0, name: 'A', charId: startingRoster[0] },
    { pid: 1, name: 'B', charId: startingRoster[1] },
  ], charMap, startingRoster);
  const a = g.players[0];
  a.charId = null;
  a.state = 'down';
  a.respawn = 0.01;
  step(g, { 0: {}, 1: {} }, 1 / 30);
  assert.equal(a.state, 'pick', 'fallen player enters character pick after the respawn delay');
  const snapMe = snapshot(g).players.find(q => q.pid === 0);
  assert.ok(Array.isArray(snapMe.pick?.choices) && snapMe.pick.choices.length >= 2, 'snapshot carries the pick choices');
  const choices = snapMe.pick.choices;
  // a held button must not auto-confirm; cycle right with a clean edge
  step(g, { 0: { right: false, fire: false }, 1: {} }, 1 / 30);
  step(g, { 0: { right: true }, 1: {} }, 1 / 30);
  assert.equal(a.pickIdx, 1, 'right cycles to the next free operative');
  step(g, { 0: {}, 1: {} }, 1 / 30);
  step(g, { 0: { fire: true }, 1: {} }, 1 / 30);
  assert.equal(a.state, 'active', 'fire deploys the chosen operative');
  assert.equal(a.charId, choices[1], 'the cycled-to character is the one fielded');
}

// --- dark modifier: aggro radii x0.75, lit behavior untouched ---
function testDarkAggroShrink() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  // grunt aggro is 9 tiles; the player stands 8 tiles away in clear sight
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(r, 4, 'P'), 12, 'g');
  const make = dark => {
    const def = bigEmptyLevel([[5, r]]);
    if (dark) def.modifiers = { dark: true };
    const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
    g.graceT = 0;
    g.players[0].invuln = 999;
    return g;
  };
  const lit = make(false);
  assert.equal(lit.dark, false, 'no modifier: g.dark stays false');
  run(lit, () => ({ 0: {} }), 0.5);
  assert.equal(lit.enemies[0].awake, true, 'lit: grunt aggro (9 tiles) sights a player 8 tiles out');
  const dark = make(true);
  assert.equal(dark.dark, true, 'modifiers.dark sets g.dark');
  run(dark, () => ({ 0: {} }), 0.5);
  assert.equal(dark.enemies[0].awake, false, 'dark: aggro shrinks to 6.75 tiles, grunt stays asleep');
  // inside the shrunken radius it still wakes
  dark.players[0].x = dark.enemies[0].x - TILE * 5;
  dark.players[0].y = dark.enemies[0].y;
  run(dark, () => ({ 0: {} }), 0.5);
  assert.equal(dark.enemies[0].awake, true, 'dark: enemies still wake inside the shrunken radius');
}

// --- dark modifier: sight (canSee) additionally capped at 8 tiles ---
function testDarkSightCap() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  // sniper aggro is 12.5 tiles (9.375 in the dark); the player stands 9 tiles
  // out — inside the dark aggro radius, but beyond the 8-tile sight cap
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(r, 4, 'P'), 13, 'n');
  const make = dark => {
    const def = bigEmptyLevel([[5, r]]);
    if (dark) def.modifiers = { dark: true };
    const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
    g.graceT = 0;
    g.players[0].invuln = 999;
    return g;
  };
  const lit = make(false);
  run(lit, () => ({ 0: {} }), 0.5);
  assert.equal(lit.enemies[0].awake, true, 'lit: sniper sights a player 9 tiles out');
  const dark = make(true);
  run(dark, () => ({ 0: {} }), 0.5);
  assert.equal(dark.enemies[0].awake, false, 'dark: the 8-tile sight cap blinds the sniper even inside aggro range');
  dark.players[0].x = dark.enemies[0].x - TILE * 7;
  dark.players[0].y = dark.enemies[0].y;
  run(dark, () => ({ 0: {} }), 0.5);
  assert.equal(dark.enemies[0].awake, true, 'dark: sniper sights a player back inside 8 tiles');
}

// --- dark modifier: snapshots carry top-level dark:true, classics stay clean ---
function testDarkSnapshotFlag() {
  const def = bigEmptyLevel([[17, '#....................................g#']]);
  def.modifiers = { dark: true };
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  assert.equal(snapshot(g, true).dark, true, 'full snapshot carries dark:true');
  assert.equal(snapshot(g, false).dark, true, 'lite snapshot carries dark:true');
  const classic = createGame(levels[0], [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  assert.ok(!('dark' in snapshot(classic, true)), 'classic snapshots gain no dark key (byte-identical)');
}

// --- waves: timed deterministic edge spawns ---
function waveLevel(waves) {
  const def = bigEmptyLevel([
    [10, '#P....................................#'],
    [17, '#....................................g#'], // keeps the level alive
  ]);
  def.modifiers = { waves };
  return def;
}

function testWaveSpawnTimingAndPlacement() {
  const def = waveLevel([{ at: 2, letters: 'ggw', edge: 'n' }]);
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.graceT = 9999; // freeze enemy AI so spawn positions can be inspected exactly
  g.players[0].invuln = 999;
  const before = g.enemies.length;
  run(g, () => ({ 0: {} }), 1.9);
  assert.equal(g.enemies.length, before, 'no spawns before the wave time');
  assert.ok(!g.events.some(ev => ev.type === 'wave'), 'no wave event before the wave time');
  run(g, () => ({ 0: {} }), 0.5);
  const spawned = g.enemies.slice(before);
  assert.equal(spawned.length, 3, 'the wave spawns one enemy per letter');
  assert.deepEqual(spawned.map(e => e.letter), ['g', 'g', 'w'], 'letters spawn in order');
  const xs = [];
  for (const e of spawned) {
    assert.equal(e.awake, true, 'wave enemy spawns awake');
    assert.ok(e.aggro >= TILE * 100, 'wave enemy hunts with x100 aggro (never leashes home)');
    assert.equal(e.homeX, e.x, 'home anchored at spawn x');
    assert.equal(e.homeY, e.y, 'home anchored at spawn y');
    assert.ok(e.y < TILE * 2, 'spawn lies in the 2-tile north band');
    xs.push(Math.floor(e.x / TILE));
  }
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2], `entry points spread along the edge (cols ${xs.join(',')})`);
  const ev = g.events.find(v => v.type === 'wave');
  assert.ok(ev, 'wave event emitted');
  assert.equal(ev.edge, 'n', 'wave event carries the edge');
  assert.equal(ev.count, 3, 'wave event carries the spawned count');
  assert.equal(ev.x, g.w * TILE / 2, 'wave event x at the entry band center');
  assert.equal(ev.y, TILE, 'wave event y at the entry band center');
}

function testWaveEdgeBands() {
  // 40x20 map: each edge's spawns must land in its own 2-tile band and the
  // event must point at that band's center
  const cases = {
    n: { band: e => e.y < TILE * 2, cx: 20 * TILE, cy: TILE },
    s: { band: e => e.y > 18 * TILE, cx: 20 * TILE, cy: 19 * TILE },
    w: { band: e => e.x < TILE * 2, cx: TILE, cy: 10 * TILE },
    e: { band: e => e.x > 38 * TILE, cx: 39 * TILE, cy: 10 * TILE },
  };
  for (const [edge, want] of Object.entries(cases)) {
    const def = waveLevel([{ at: 1, letters: 'gg', edge }]);
    const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
    g.graceT = 9999;
    g.players[0].invuln = 999;
    const before = g.enemies.length;
    run(g, () => ({ 0: {} }), 1.5);
    const spawned = g.enemies.slice(before);
    assert.equal(spawned.length, 2, `edge ${edge}: both letters spawned`);
    for (const e of spawned) assert.ok(want.band(e), `edge ${edge}: spawn inside the 2-tile band`);
    const ev = g.events.find(v => v.type === 'wave');
    assert.equal(ev.edge, edge, `edge ${edge}: event edge`);
    assert.equal(ev.x, want.cx, `edge ${edge}: event x at band center`);
    assert.equal(ev.y, want.cy, `edge ${edge}: event y at band center`);
  }
}

function testWaveFiresOnce() {
  const def = waveLevel([{ at: 1, letters: 'gg', edge: 's' }]);
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.graceT = 99999;
  g.players[0].invuln = 999;
  const before = g.enemies.length;
  run(g, () => ({ 0: {} }), 10);
  assert.equal(g.enemies.length, before + 2, 'the wave spawned its two enemies exactly once');
  assert.equal(g.events.filter(v => v.type === 'wave').length, 1, 'the wave event fired exactly once');
}

function testWaveRespectsGlobalCap() {
  // 88 pre-placed grunts: a 5-letter wave may only add 2 before the 90 cap
  const rows = [];
  rows.push('#'.repeat(40));
  for (let y = 1; y < 19; y++) rows.push('#' + '.'.repeat(38) + '#');
  rows.push('#'.repeat(40));
  rows[2] = '#P' + '.'.repeat(37) + '#';
  rows[10] = '#' + 'g'.repeat(38) + '#';
  rows[11] = '#' + 'g'.repeat(38) + '#';
  rows[12] = '#' + 'g'.repeat(12) + '.'.repeat(26) + '#';
  const def = {
    name: 'Cap Wave', time: 60, captiveChars: [], tiles: rows,
    modifiers: { waves: [{ at: 1, letters: 'wwwww', edge: 'n' }] },
  };
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  assert.equal(g.enemies.length, 88, 'pre-placed population is 88');
  g.graceT = 99999;
  g.players[0].invuln = 999;
  run(g, () => ({ 0: {} }), 2);
  assert.equal(g.enemies.length, 90, 'wave overflow is dropped at the global 90 cap');
  const ev = g.events.find(v => v.type === 'wave');
  assert.equal(ev.count, 2, 'wave event reports the post-cap spawned count');
}

testLevelsParse();
testEveryCharacterCanKill();
testNewEnemiesCanDownPlayer();
testRescueAndPermanentLossRules();
testScriptedBotClearsLevelOne();
testAggroSleep();
testSmallMapsStayArcade();
testPathfindingAroundWall();
testSnapshotGridModes();
testTwoLocalPlayersMoveIndependently();
testStoryLevelIntegrity();
testArcadeSpawnCapsPreserved();
testEnemiesShootAcrossWater();
testPickupOwnerPidZeroNotStolen();
testRespawnNearTeammateOnBigMap();
testLeashReturnAndResleep();
testShardDropMagnetPickup();
testPylonOpensGateAndGatesExtraction();
testNpcTalkAndGift();
testEveryCharacterSpecial();
testCrystalBreakDropsShards();
testBigMapSpawnerPopulationCap();
testDeterministicExpeditionRun();
function testEnemyPathsAroundBuiltPylon() {
  // a built pylon mid-corridor must not wedge chasers — A* routes around it
  const rows = [];
  rows.push('#'.repeat(40));
  for (let y = 1; y < 19; y++) rows.push('#' + '.'.repeat(38) + '#');
  rows.push('#'.repeat(40));
  rows[9] = '#P............B.......w...............#';
  const level = {
    name: 'Pylon Path', time: 60, captiveChars: [],
    builds: [{ kind: 'pylon', cost: 1 }],
    tiles: rows,
  };
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.shards = 10;
  const p = g.players[0];
  p.invuln = 999;
  // build the pylon, standing beside (not on) the site
  const site = g.builds[0];
  p.x = site.x - TILE; p.y = site.y;
  run(g, () => ({ 0: { act: true } }), 5);
  assert.ok(site.built, 'pylon built');
  const e = g.enemies[0];
  e.awake = true;
  // skitter must reach the player even though the pylon sits on the beeline
  run(g, () => ({ 0: {} }), 25);
  const d = Math.hypot(e.x - p.x, e.y - p.y);
  assert.ok(d < TILE * 3, `chaser routes around the built pylon (ended ${(d / TILE).toFixed(1)} tiles away)`);
}

// --- structure levels: hold-act on a BUILT structure runs the priority chain
// repair -> upgrade -> dismantle (full hp + max level only) ---
function testStructureRepairUpgradeDismantle() {
  const level = bigEmptyLevel([
    [4, '#P..B.................................#'],
    [17, '#....................................g#'],
  ]);
  level.builds = [{ kind: 'barricade', cost: 4 }];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  const site = g.builds[0];
  p.invuln = 999;
  g.shards = 100;
  p.x = site.x - TILE; p.y = site.y;
  // build it
  run(g, () => ({ 0: { act: !site.built } }), 4);
  assert.ok(site.built, 'barricade built');
  assert.equal(site.level, 1, 'fresh structure is level 1');
  assert.equal(site.maxHp, 14, 'level 1 barricade maxHp is 14');
  assert.equal(snapshot(g, false).builds[0].level, 1, 'snapshot carries the build level');
  // repair: 1 hp / 0.5s, 1 shard per 3 hp, before anything else
  site.hp = 8;
  let shards0 = g.shards;
  run(g, () => ({ 0: { act: site.hp < site.maxHp } }), 4);
  assert.equal(site.hp, 14, 'holding act repairs a damaged structure to full');
  assert.ok(Math.abs(shards0 - g.shards - 2) < 0.05, `6 hp of repair costs 2 shards (spent ${(shards0 - g.shards).toFixed(2)})`);
  assert.ok(g.events.some(ev => ev.type === 'repair'), 'repair event fired');
  assert.equal(site.level, 1, 'repair takes priority over upgrade');
  // repair stalls without shards
  site.hp = 10;
  g.shards = 0;
  run(g, () => ({ 0: { act: true } }), 2);
  assert.equal(site.hp, 10, 'an empty pool stalls the repair');
  g.shards = 100;
  run(g, () => ({ 0: { act: site.hp < site.maxHp } }), 3);
  assert.equal(site.hp, 14, 'repair resumes when shards return');
  // upgrade: full hp + level<3, cost level*8, progress like building
  shards0 = g.shards;
  run(g, () => ({ 0: { act: site.level === 1 } }), 7);
  assert.equal(site.level, 2, 'holding act on a full-hp structure upgrades it');
  assert.equal(site.maxHp, 22, 'level 2 barricade maxHp is 22');
  assert.equal(site.hp, 22, 'upgrade completes at full hp');
  assert.ok(Math.abs(shards0 - g.shards - 8) < 0.05, 'level 1->2 costs 8 shards');
  assert.ok(g.events.some(ev => ev.type === 'built' && ev.level === 2), 'upgrade fires a built event with the level');
  run(g, () => ({ 0: { act: site.level === 2 } }), 12);
  assert.equal(site.level, 3, 'level 2->3 upgrade works');
  assert.equal(site.maxHp, 32, 'level 3 barricade maxHp is 32');
  assert.equal(snapshot(g, false).builds[0].level, 3, 'snapshot tracks the level');
  // dismantle: only at full hp AND max level; refunds half of all invested
  const shardsBefore = g.shards;
  run(g, () => ({ 0: { act: site.built } }), 3);
  assert.equal(site.built, false, 'a full-hp max-level structure dismantles');
  assert.equal(g.shards, shardsBefore + 14, 'refund is half the 4+8+16 invested');
  assert.equal(site.level, 1, 'dismantled structure loses its levels');
}

// --- turret levels: damage 1/2/3, targeting range 5/5.5/6 tiles ---
function testTurretLevels() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(r, 2, 'P'), 10, 'B'), 15, 'g'); // grunt exactly 5 tiles from the turret
  const level = bigEmptyLevel([[5, r], [17, '#....................................g#']]);
  level.builds = [{ kind: 'turret', cost: 5 }];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  const b = g.builds[0];
  const e = g.enemies[0];
  p.invuln = 999;
  g.graceT = 1e9; // freeze enemy AI; turrets keep firing
  g.shards = 10;
  p.x = b.x - TILE; p.y = b.y;
  run(g, () => ({ 0: { act: !b.built } }), 5);
  assert.ok(b.built, 'turret built');
  e.awake = true;
  e.hp = 50; // survives the volleys so every level has a standing target
  let seen = null;
  const watch = () => {
    const s = g.shots.find(s => s.kind === 'turret');
    if (s) seen = s;
    return { 0: {} };
  };
  run(g, watch, 1.5);
  assert.ok(!seen && !g.events.some(ev => ev.type === 'shoot' && ev.weapon === 'turret'),
    'level 1 turret (5-tile reach) cannot touch a grunt 5 tiles out');
  b.level = 2; // upgrade path is covered by the barricade chain test
  run(g, watch, 1.5);
  assert.ok(seen, 'level 2 turret (5.5-tile reach) fires');
  assert.equal(seen.dmg, 2, 'level 2 turret deals 2 damage');
  seen = null;
  b.level = 3;
  b.cool = 0;
  run(g, watch, 1.5);
  assert.ok(seen && seen.dmg === 3, 'level 3 turret deals 3 damage');
}

function testGateTimeLock() {
  const rows = [];
  rows.push('#'.repeat(30));
  for (let y = 1; y < 9; y++) rows.push('#' + '.'.repeat(28) + '#');
  rows.push('#'.repeat(30));
  rows[4] = '#P.B....E................g...#';
  const level = {
    name: 'Charging Anchor', time: 60, captiveChars: [],
    builds: [{ kind: 'pylon', cost: 1 }],
    gate: { need: 1, after: 6 },
    tiles: rows,
  };
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.shards = 5;
  const p = g.players[0];
  p.invuln = 999;
  const site = g.builds[0];
  p.x = site.x - TILE; p.y = site.y;
  run(g, () => ({ 0: { act: true } }), 2);
  assert.ok(site.built, 'pylon built before the time lock');
  assert.equal(g.gate.open, false, 'gate stays shut at full quorum until `after` elapses');
  const snapCharging = snapshot(g, false).gate;
  assert.equal(snapCharging.charging, true, 'snapshot reports the charging state');
  run(g, () => ({ 0: {} }), 5);
  assert.equal(g.gate.open, true, 'gate opens once the time lock elapses');
  assert.equal(snapshot(g).events !== undefined, true);
}

// ===== survival core (hp/shield/item, crackers, chests, bastion, farms) =====

// An enemy arrow parked on the player: the cheapest deterministic way to land
// exactly one hit through the public step().
function enemyShotAt(g, p) {
  g.shots.push({
    id: g.nextShotId++, x: p.x, y: p.y, vx: 0, vy: 0, ttl: 0.5, dmg: 1,
    who: 'e', overWalls: true, pierce: 0, aoeRadius: 0, curve: 0, radius: 5, kind: 'arrow', hits: [],
  });
}

function playerShotAt(g, e, dmg = 1) {
  g.shots.push({
    id: g.nextShotId++, x: e.x, y: e.y, vx: 0, vy: 0, ttl: 0.5, dmg,
    who: 'p', overWalls: true, pierce: 0, aoeRadius: 0, curve: 0, radius: 5, kind: 'test', hits: [],
  });
}

// --- survival hp: 3 hits on big maps, shield absorbs first, 1s hit-grace ---
function testPlayerHpShieldFlow() {
  const level = bigEmptyLevel([
    [2, '#P....................................#'],
    [17, '#....................................g#'],
  ]);
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  assert.equal(p.hp, 3, 'non-arcade player starts at 3 hp');
  assert.equal(p.maxHp, 3, 'maxHp is 3');
  assert.equal(p.shield, 0, 'no shield to start');
  const snapP = snapshot(g, false).players[0];
  assert.equal(snapP.hp, 3, 'snapshot carries hp');
  assert.equal(snapP.maxHp, 3, 'snapshot carries maxHp');
  assert.equal(snapP.shield, 0, 'snapshot carries shield');
  p.invuln = 0;
  enemyShotAt(g, p);
  step(g, { 0: {} }, 1 / 30);
  assert.equal(p.hp, 2, 'first hit costs 1 hp');
  assert.ok(p.invuln > 0.9, 'a survivable hit grants ~1s of invulnerability');
  const hitEv = g.events.find(ev => ev.type === 'playerHit');
  assert.ok(hitEv, 'playerHit event fired');
  assert.equal(hitEv.pid, 0, 'playerHit carries the pid');
  assert.equal(hitEv.hp, 2, 'playerHit carries the remaining hp');
  // a second hit inside the grace window does nothing
  enemyShotAt(g, p);
  step(g, { 0: {} }, 1 / 30);
  assert.equal(p.hp, 2, 'invulnerability blocks the follow-up hit');
  // shield pips absorb before hp
  p.invuln = 0;
  p.shield = 2;
  enemyShotAt(g, p);
  step(g, { 0: {} }, 1 / 30);
  assert.equal(p.shield, 1, 'shield absorbs the hit');
  assert.equal(p.hp, 2, 'hp untouched while shielded');
  // last hp triggers the existing down/captive flow
  p.invuln = 0;
  p.shield = 0;
  p.hp = 1;
  const charBefore = p.charId;
  enemyShotAt(g, p);
  step(g, { 0: {} }, 1 / 30);
  assert.equal(p.state, 'down', 'hp 0 routes into the down flow');
  assert.ok(g.captives.some(c => c.fromPlayer && c.charId === charBefore), 'downed operative drops as a captive');
}

// --- arcade fidelity: classics stay 1-hit and gain no snapshot keys ---
function testArcadeStaysOneHit() {
  const level = {
    name: 'Arcade Hit', time: 20, captiveChars: [],
    tiles: ['##########', '#P......g#', '##########'],
  };
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  assert.equal(g.arcade, true);
  const p = g.players[0];
  assert.equal(p.hp, undefined, 'arcade players carry no hp');
  p.invuln = 0;
  enemyShotAt(g, p);
  step(g, { 0: {} }, 1 / 30);
  assert.equal(p.state, 'down', 'arcade stays one-hit');
  assert.ok(!g.events.some(ev => ev.type === 'playerHit'), 'no playerHit event on arcade');
  const s = snapshot(createGame(levels[0], [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster), true);
  for (const key of ['mode', 'core', 'cycle', 'chests', 'crackers', 'vehicles', 'towers', 'shops', 'hires', 'flags', 'caps', 'zone', 'winner']) {
    assert.ok(!(key in s), `classic snapshot gains no '${key}' key`);
  }
  assert.ok(!('hp' in s.players[0]) && !('item' in s.players[0]) && !('shield' in s.players[0]), 'classic snapshot players gain no survival keys');
  for (const key of ['team', 'riding', 'towerId', 'shop', 'dmgBonus']) {
    assert.ok(!(key in s.players[0]), `classic snapshot players gain no '${key}' key`);
  }
  assert.ok(s.enemies.every(e => !('mutation' in e)), 'classic snapshot enemies gain no mutation key');
}

// --- item slot: edge-triggered medkit/shield use with caps ---
function testItemMedkitAndShield() {
  const level = bigEmptyLevel([
    [2, '#P....................................#'],
    [17, '#....................................g#'],
  ]);
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  p.invuln = 999;
  p.item = { kind: 'medkit', count: 2 };
  p.hp = 1;
  // a full second of held button is still one edge -> one use
  run(g, () => ({ 0: { item: true } }), 1);
  assert.equal(p.hp, 2, 'medkit heals exactly +1 on a held press (edge-triggered)');
  assert.equal(p.item.count, 1, 'one medkit consumed');
  assert.ok(g.events.some(ev => ev.type === 'heal'), 'heal cue event fired');
  run(g, () => ({ 0: {} }), 0.2);
  run(g, () => ({ 0: { item: true } }), 0.2);
  assert.equal(p.hp, 3, 'second press heals again');
  assert.equal(p.item, null, 'spent slot empties');
  assert.ok(!('item' in snapshot(g, false).players[0]), 'empty slot ships no item key');
  // medkit at full hp is not wasted
  p.item = { kind: 'medkit', count: 1 };
  run(g, () => ({ 0: {} }), 0.2);
  run(g, () => ({ 0: { item: true } }), 0.2);
  assert.equal(p.hp, 3, 'hp capped at max');
  assert.deepEqual(p.item, { kind: 'medkit', count: 1 }, 'medkit not consumed at full hp');
  // shield item: +2 pips, capped at 2, not wasted at the cap
  p.item = { kind: 'shield', count: 1 };
  p.shield = 1;
  run(g, () => ({ 0: {} }), 0.2);
  run(g, () => ({ 0: { item: true } }), 0.2);
  assert.equal(p.shield, 2, 'shield use caps at 2 pips');
  assert.equal(p.item, null, 'shield consumed');
  assert.deepEqual(snapshot(g, false).players[0].item, undefined, 'no item key after use');
  p.item = { kind: 'shield', count: 1 };
  run(g, () => ({ 0: {} }), 0.2);
  run(g, () => ({ 0: { item: true } }), 0.2);
  assert.deepEqual(p.item, { kind: 'shield', count: 1 }, 'shield not consumed at full pips');
  assert.deepEqual(snapshot(g, false).players[0].item, { kind: 'shield', count: 1 }, 'snapshot carries the item slot');
}

// --- lure cracker: 4-tile lob, 3s lure that overrides targeting, then boom ---
function testCrackerLureAndBoom() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(r, 4, 'P'), 12, 'w'); // skitter 8 tiles right of the player
  const level = bigEmptyLevel([[5, r]]);
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  const e = g.enemies[0];
  p.invuln = 999;
  g.graceT = 0;
  p.fx = 1; p.fy = 0;
  p.item = { kind: 'cracker', count: 1 };
  const tx = p.x + 4 * TILE;
  step(g, { 0: { item: true } }, 1 / 30);
  assert.equal(p.item, null, 'cracker thrown and consumed');
  assert.equal(g.crackers.length, 1, 'cracker in flight');
  assert.ok(snapshot(g, false).crackers.length === 1, 'snapshot carries the cracker');
  run(g, () => ({ 0: {} }), 0.6);
  const out = g.events.find(ev => ev.type === 'crackerOut');
  assert.ok(out, 'crackerOut fires on landing');
  assert.equal(out.x, tx, 'cracker lands 4 tiles out in the facing direction');
  assert.equal(e.awake, true, 'lure wakes enemies inside 9 tiles');
  // the skitter must converge on the cracker (to its left), not the player
  run(g, () => ({ 0: {} }), 2);
  assert.ok(Math.abs(e.x - tx) < TILE, 'lured enemy converges on the cracker, not the player');
  assert.ok(Math.hypot(e.x - p.x, e.y - p.y) > TILE * 3, 'lured enemy never reached the player');
  run(g, () => ({ 0: {} }), 1.2);
  assert.ok(g.events.some(ev => ev.type === 'crackerBoom'), 'crackerBoom fires when the fuse ends');
  assert.equal(g.crackers.length, 0, 'detonated cracker is gone');
  assert.equal(g.kills, 1, 'the boom killed the lured skitter');
}

// --- chests: act-open, loot table, def binding, act priority over npcs ---
function testChestLootAndPriority() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(r, 2, 'P');
  for (const x of [4, 8, 12, 16, 20]) r = put(r, x, 'C');
  r = put(r, 5, 'N'); // npc right beside the first chest
  const level = bigEmptyLevel([[5, r], [17, '#....................................g#']]);
  level.chests = [
    { loot: 'shards', amount: 9 }, { loot: 'medkit' }, { loot: 'shield' },
    { loot: 'token' }, { loot: 'cracker' },
  ];
  level.npcs = [{ id: 'jo', name: 'Jo', lines: ['hey'] }];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  assert.equal(g.chests.length, 5, 'chests parsed from C tiles');
  const p = g.players[0];
  p.invuln = 999;
  const goTo = i => { p.x = g.chests[i].x; p.y = g.chests[i].y; };
  const act = () => {
    step(g, { 0: {} }, 1 / 30);
    step(g, { 0: { act: true } }, 1 / 30);
  };
  // chest 0 sits beside the npc: act opens the chest, no talk (chest > npc)
  goTo(0);
  act();
  assert.equal(g.chests[0].opened, true, 'chest opened');
  assert.equal(g.shards, 9, 'shard chest pays into the pool');
  assert.ok(!g.events.some(ev => ev.type === 'talk'), 'chest takes act priority over the npc');
  const chestEv = g.events.find(ev => ev.type === 'chest');
  assert.equal(chestEv.loot, 'shards');
  assert.equal(chestEv.amount, 9);
  // same spot again: chest is spent, npc gets the press
  act();
  assert.equal(g.shards, 9, 'opened chest never pays twice');
  assert.ok(g.events.some(ev => ev.type === 'talk'), 'spent chest yields act to the npc');
  goTo(1);
  act();
  assert.deepEqual(g.players[0].item, { kind: 'medkit', count: 1 }, 'medkit chest fills the item slot');
  goTo(2);
  act();
  assert.equal(p.shield, 2, 'shield chest grants the pips directly');
  goTo(3);
  act();
  assert.equal(p.dmgBonus, 1, 'token chest grants +1 damage');
  step(g, { 0: { fire: true } }, 1 / 30);
  const shot = g.shots[g.shots.length - 1];
  assert.equal(shot.dmg, 2, 'weapon token raises shot damage (+1 on the scout SMG)');
  goTo(4);
  act();
  assert.deepEqual(p.item, { kind: 'cracker', count: 2 }, 'cracker chest pays 2 and swaps out the old kind');
  assert.equal(snapshot(g, false).chests.filter(c => c.opened).length, 5, 'snapshot tracks opened chests');
  // default loot when def.chests is missing: fixed cycle by index
  const dflt = parseLevel({ tiles: ['#######', '#PCCCg#', '#######'] });
  assert.deepEqual(dflt.chests.map(c => c.loot), ['shards', 'cracker', 'medkit'], 'default loot cycles deterministically');
  assert.equal(dflt.chests[0].amount, 6, 'default shard chest 0 pays 6');
}

// --- bastion: a 40x20 base map with the core mid-field ---
function bastionDef(b = {}, extraRows = []) {
  const tiles = [];
  tiles.push('#'.repeat(40));
  for (let y = 1; y < 19; y++) tiles.push('#' + '.'.repeat(38) + '#');
  tiles.push('#'.repeat(40));
  tiles[2] = '#PP' + '.'.repeat(36) + '#';
  tiles[10] = tiles[10].slice(0, 20) + 'K' + tiles[10].slice(21);
  for (const [y, row] of extraRows) tiles[y] = row;
  return {
    name: 'Bastion Test', time: 600, captiveChars: [], mode: 'bastion',
    bastion: { nights: 2, dayLen: 5, nightLen: 4, bloodMoons: [2], ...b },
    tiles,
  };
}

// --- bastion: cycle events, wave rotation/composition, mutations, win ---
function testBastionCycleWavesAndWin() {
  const g = createGame(bastionDef(), [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  assert.equal(g.mode, 'bastion');
  assert.deepEqual(g.core, { x: 20.5 * TILE, y: 10.5 * TILE, hp: 30, maxHp: 30 }, 'K parses into the core');
  const s0 = snapshot(g, false);
  assert.equal(s0.mode, 'bastion', 'snapshot carries the mode');
  assert.deepEqual(s0.cycle, { phase: 'day', nightNo: 0, t: 5, bloodMoon: false, nights: 2 }, 'snapshot carries the cycle');
  assert.equal(s0.core.hp, 30, 'snapshot carries the core');
  g.graceT = 1e9; // freeze enemy AI: this test inspects spawns and the clock
  g.players[0].invuln = 999;
  // an empty field must NOT auto-clear a bastion map
  run(g, () => ({ 0: {} }), 2);
  assert.equal(g.status, 'play', 'no enemies on the field, mission still running');
  assert.equal(g.timeLeft, 600, 'bastion ignores the mission timer (cycle clock governs)');
  // night 1: dusk at 5s, one wave from the rotating edge (n first). Waves
  // scale with the squad — ceil(base * (0.6 + 0.2 * players)): solo runs at
  // 0.8x, so night 1's base 6 spawns 5.
  run(g, () => ({ 0: {} }), 3.5);
  const dusk1 = g.events.find(ev => ev.type === 'dusk');
  assert.ok(dusk1, 'dusk event fired');
  assert.equal(dusk1.nightNo, 1);
  assert.equal(dusk1.bloodMoon, false);
  assert.equal(g.cycle.phase, 'night');
  const wave1 = g.enemies.slice();
  assert.equal(wave1.length, 5, 'night 1 solo wave is 5 enemies (base 6 x 0.8)');
  assert.deepEqual(wave1.map(e => e.letter), ['g', 'g', 'w', 'g', 'g'], 'night 1 is grunts and skitters');
  for (const e of wave1) {
    assert.equal(e.awake, true, 'wave enemy spawns awake');
    assert.equal(e.targetCore, true, 'wave enemy targets the core');
    assert.ok(e.aggro >= TILE * 100, 'wave enemy hunts at x100 aggro');
    assert.ok(e.y < TILE * 2, 'night 1 wave enters from the north band');
  }
  // mutation rolls are (nightNo*31+i)%5 over [none,feral,bulk,volatile,split]
  assert.deepEqual(
    wave1.map(e => e.mutation),
    ['feral', 'bulk', 'volatile', 'split', undefined],
    'night 1 mutations follow the deterministic roll'
  );
  assert.equal(wave1[0].speed, 1.25 * TILE * 1.5, 'feral runs +50% faster');
  assert.equal(wave1[1].hp, 4, 'bulk doubles hp');
  assert.equal(wave1[1].speed, 1.25 * TILE * 0.75, 'bulk lumbers at -25% speed');
  const snapEn = snapshot(g, false).enemies;
  assert.equal(snapEn.filter(e => e.mutation).length, 4, 'snapshot exposes mutations');
  assert.ok(snapEn.some(e => !('mutation' in e)), 'unmutated wave enemies ship no mutation key');
  // dawn 1 at 9s, then the blood warning leads night 2's dusk
  run(g, () => ({ 0: {} }), 4);
  const dawn1 = g.events.find(ev => ev.type === 'dawn');
  assert.ok(dawn1, 'dawn event fired');
  assert.equal(dawn1.nightNo, 1);
  assert.equal(g.status, 'play', 'not cleared yet: one night to go');
  assert.equal(g.cycle.phase, 'day');
  run(g, () => ({ 0: {} }), 1);
  const warn = g.events.find(ev => ev.type === 'bloodWarn');
  assert.ok(warn, 'bloodWarn fires inside 30s of a blood-moon dusk');
  assert.equal(warn.nightNo, 2, 'warning names the blood night');
  // night 2 (blood moon): waves from TWO edges (e then w), all mutated, +1 hp
  // (the snapshot above drained g.events, so only night-2 events remain)
  const before = g.enemies.length;
  run(g, () => ({ 0: {} }), 4.5);
  const dusk2 = g.events.find(ev => ev.type === 'dusk');
  assert.ok(dusk2, 'night 2 dusk fired');
  assert.equal(dusk2.nightNo, 2);
  assert.equal(dusk2.bloodMoon, true, 'night 2 is the blood moon');
  const wave2 = g.enemies.slice(before);
  assert.equal(wave2.length, 14, 'blood moon doubles the wave: 7 per edge (base 8 x 0.8 solo) from two edges');
  assert.ok(wave2.some(e => e.x > 38 * TILE), 'first blood edge is east');
  assert.ok(wave2.some(e => e.x < 2 * TILE), 'second blood edge is west');
  assert.ok(wave2.every(e => e.mutation), 'every blood moon enemy is mutated');
  assert.ok(wave2.filter(e => e.mutation !== 'bulk').every(e => e.hp === (e.letter === 'w' ? 2 : 3)), 'blood moon adds +1 hp');
  assert.equal(g.events.filter(ev => ev.type === 'wave').length, 2, 'one wave event per blood-moon entry edge');
  // final dawn wins the mission outright
  run(g, () => ({ 0: {} }), 4.5);
  assert.equal(g.status, 'cleared', 'surviving the last night clears at dawn');
  assert.ok(g.events.some(ev => ev.type === 'dawn' && ev.nightNo === 2), 'final dawn event fired');
  assert.ok(g.events.some(ev => ev.type === 'clear'), 'clear event fired');
}

// --- bastion: the wave marches on the core; core 0 fails the mission ---
function testCoreSiegeAndLoss() {
  const def = bastionDef({ nights: 1, dayLen: 1, nightLen: 300, bloodMoons: [] });
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.graceT = 0;
  g.players[0].invuln = 999;
  run(g, () => ({ 0: {} }), 90);
  assert.ok(g.events.some(ev => ev.type === 'coreHit'), 'wave enemies gnaw the core on contact');
  assert.ok(g.core.hp <= 0, 'core falls to the siege');
  assert.equal(g.status, 'failed', 'core destruction fails the mission');
  assert.ok(g.events.some(ev => ev.type === 'coreDown'), 'coreDown event fired');
}

// --- mutants: volatile pops on death, split twins out ---
function testMutantDeathEffects() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(r, 4, 'P'), 5, 'g'), 12, 'g');
  const level = bigEmptyLevel([[5, r]]);
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  const [near, far] = g.enemies;
  g.graceT = 1e9;
  // volatile: dies adjacent to the player -> 1.2-tile blast for 2 damage
  near.mutation = 'volatile';
  near.hp = 1;
  p.invuln = 0;
  playerShotAt(g, near);
  step(g, { 0: {} }, 1 / 30);
  assert.ok(g.events.some(ev => ev.type === 'volatile'), 'volatile death event fired');
  assert.equal(p.hp, 1, 'volatile blast costs 2 hp');
  assert.equal(g.events.filter(ev => ev.type === 'playerHit').length, 1, 'one playerHit for the blast');
  // split: dies and spawns two skitters
  far.mutation = 'split';
  far.hp = 1;
  const beforeCount = g.enemies.filter(e => !e.dead).length;
  playerShotAt(g, far);
  step(g, { 0: {} }, 1 / 30);
  const skitters = g.enemies.filter(e => e.kind === 'skitter');
  assert.equal(skitters.length, 2, 'split death spawns two skitters');
  assert.ok(skitters.every(e => e.awake), 'split spawn wakes the twins');
  assert.equal(g.enemies.filter(e => !e.dead).length, beforeCount + 1, 'two spawned for one killed');
}

// --- farms: stage growth, farmer speed-up, harvest, night trampling ---
function testFarmGrowHarvestTrample() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  const def = bastionDef({ nights: 1, dayLen: 1000, nightLen: 1000, bloodMoons: [] }, []);
  def.tiles[5] = put(put('#' + '.'.repeat(38) + '#', 4, 'B'), 30, 'g');
  def.builds = [{ kind: 'farm', cost: 6 }];
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  const b = g.builds[0];
  const e = g.enemies[0];
  p.invuln = 999;
  g.graceT = 1e9;
  g.shards = 6;
  p.x = b.x - TILE; p.y = b.y;
  run(g, () => ({ 0: { act: true } }), 5);
  assert.equal(b.built, true, 'farm builds like any site');
  assert.equal(b.stage, 0, 'fresh farm starts at stage 0');
  assert.equal(snapshot(g, false).builds[0].stage, 0, 'snapshot carries farm stage');
  run(g, () => ({ 0: {} }), 26);
  assert.equal(b.stage, 1, 'stage grows every 25s');
  // a hired farmer works the fields: 15s stages
  g.hires.push({ x: 0, y: 0, cost: 0, job: 'farmer', hired: true, name: 'Fae' });
  b.growT = 0;
  run(g, () => ({ 0: {} }), 16);
  assert.equal(b.stage, 2, 'a working farmer grows stages in 15s');
  g.hires.pop();
  // harvest a ripe farm: medkit to the harvester, plot resets
  b.stage = 3;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.deepEqual(p.item, { kind: 'medkit', count: 1 }, 'harvest pays a medkit');
  assert.equal(b.stage, 0, 'harvest resets the plot');
  assert.ok(g.events.some(ev => ev.type === 'harvest'), 'harvest event fired');
  // slot full of another kind + hurt: the crop heals on the spot
  b.stage = 3;
  p.item = { kind: 'cracker', count: 1 };
  p.hp = 2;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(p.hp, 3, 'full-slot hurt harvester eats the crop (+1 hp)');
  assert.equal(b.stage, 0, 'plot resets');
  assert.deepEqual(p.item, { kind: 'cracker', count: 1 }, 'item slot untouched');
  // slot full + full hp: the crop stays on the plot and the refusal cues
  // a slotFull event exactly once for the press
  b.stage = 3;
  g.events.length = 0;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(b.stage, 3, 'nothing to gain: crop left standing');
  const fullEvs = g.events.filter(ev => ev.type === 'slotFull');
  assert.equal(fullEvs.length, 1, 'refused harvest cues slotFull once per press');
  assert.ok(fullEvs[0].x === b.x && fullEvs[0].y === b.y, 'slotFull carries the plot position');
  // holding the button adds no further cues (edge-triggered)
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(g.events.filter(ev => ev.type === 'slotFull').length, 1, 'held act does not respam the cue');
  // night trampling: an enemy crossing the plot flattens it
  g.cycle.phase = 'night';
  g.cycle.nightNo = 1;
  g.cycle.t = 500;
  b.stage = 2;
  e.x = b.x; e.y = b.y;
  step(g, { 0: {} }, 1 / 30);
  assert.equal(b.stage, 0, 'night crossing tramples the farm');
  assert.ok(g.events.some(ev => ev.type === 'trample'), 'trample event fired');
  // daytime crossings are harmless
  g.cycle.phase = 'day';
  b.stage = 2;
  step(g, { 0: {} }, 1 / 30);
  assert.equal(b.stage, 2, 'daytime crossing does not trample');
}

// --- new letters parse into entities (inert stubs for V/W/S/H/D) ---
function testParseNewLetters() {
  const def = {
    name: 'Letters', time: 60, captiveChars: [],
    vehicles: [{ kind: 'skiff' }],
    hires: [{ cost: 20, job: 'smith', name: 'Bo' }],
    tiles: [
      '###########',
      '#P.CVVKWg.#',
      '#..SHHDD..#',
      '###########',
    ],
  };
  const lvl = parseLevel(def);
  assert.equal(lvl.chests.length, 1, 'C parses a chest');
  assert.deepEqual(lvl.vehicles.map(v => ({ id: v.id, kind: v.kind, rider: v.rider })), [
    { id: 'v0', kind: 'skiff', rider: null },
    { id: 'v1', kind: 'stag', rider: null },
  ], 'V binds def.vehicles row-major, defaults to stag');
  assert.deepEqual(lvl.core, { x: 6.5 * TILE, y: 1.5 * TILE, hp: 30, maxHp: 30 }, 'K parses the core');
  assert.deepEqual(lvl.towers, [{ x: 7.5 * TILE, y: 1.5 * TILE, level: 1, hp: 20, maxHp: 20, occupant: null }], 'W parses a watchtower');
  assert.deepEqual(lvl.shops, [{ x: 3.5 * TILE, y: 2.5 * TILE }], 'S parses a shop');
  assert.deepEqual(lvl.hires.map(h => ({ cost: h.cost, job: h.job, hired: h.hired, name: h.name })), [
    { cost: 20, job: 'smith', hired: false, name: 'Bo' },
    { cost: 12, job: 'engineer', hired: false, name: 'Hand 2' },
  ], 'H binds def.hires row-major with deterministic defaults');
  assert.deepEqual(lvl.flags.map(f => ({ team: f.team, carrier: f.carrier, atBase: f.atBase, dropT: f.dropT })), [
    { team: 0, carrier: null, atBase: true, dropT: 0 },
    { team: 1, carrier: null, atBase: true, dropT: 0 },
  ], 'first D is team 0, second is team 1');
  for (const row of lvl.grid) assert.ok(!/[CVKWSHD]/.test(row), 'every new letter resolves to floor');
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const s = snapshot(g, false);
  assert.equal(s.chests.length, 1, 'snapshot ships chests');
  assert.equal(s.vehicles.length, 2, 'snapshot ships vehicles');
  assert.equal(s.towers.length, 1, 'snapshot ships towers');
  assert.equal(s.shops.length, 1, 'snapshot ships shops');
  assert.equal(s.hires.length, 2, 'snapshot ships hires');
  assert.equal(s.flags.length, 2, 'snapshot ships flags');
  assert.equal(s.core.maxHp, 30, 'snapshot ships the core');
}

// --- determinism: identical scripted bastion runs match snapshot-for-snapshot ---
function testDeterministicBastionRun() {
  const def = bastionDef({ nights: 2, dayLen: 6, nightLen: 8, bloodMoons: [2] });
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  def.tiles[4] = put(put('#' + '.'.repeat(38) + '#', 6, 'C'), 9, 'C');
  const party = startingRoster.slice(0, 2).map((id, i) => ({ pid: i, name: id, charId: id }));
  const runOnce = () => {
    const g = createGame(def, party, charMap, startingRoster);
    g.players[0].item = { kind: 'cracker', count: 2 };
    g.players[1].item = { kind: 'medkit', count: 1 };
    const dt = 1 / 30;
    const h = [];
    for (let i = 0; i < 900 && g.status === 'play'; i++) {
      const inputs = {};
      for (const p of g.players) {
        inputs[p.pid] = {
          right: (i % 50) < 30, down: p.pid === 0 && (i % 70) < 25, up: p.pid === 1 && (i % 70) < 25,
          fire: (i % 8) < 3, special: (i % 160) === 40 + p.pid,
          act: (i % 45) < 10, item: (i % 120) === 60 + p.pid,
        };
      }
      step(g, inputs, dt);
      if (i % 30 === 0) h.push(JSON.stringify(snapshot(g, false)));
    }
    return h.join('\n');
  };
  assert.ok(runOnce() === runOnce(), 'two identical scripted bastion runs produce identical snapshot streams');
}

// --- melee contact damage routes through the survival hp pool ---
function testContactDamageNonArcade() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(r, 4, 'P'), 6, 'g');
  const level = bigEmptyLevel([[5, r]]);
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  p.invuln = 0;
  g.graceT = 0;
  run(g, () => ({ 0: {} }), 1.5);
  assert.equal(p.state, 'active', 'first grunt contact no longer downs outright');
  assert.equal(p.hp, 2, 'contact costs 1 hp with ~1s grace between hits');
  assert.equal(g.events.filter(ev => ev.type === 'playerHit').length, 1, 'hit-grace spaces contact damage');
}

// ===== SIM-B: towers, shops, hires, vehicles, pvp (ctf/br) ==================

// --- watchtowers: occupy at the base, boosted overWalls fire, leave on act ---
function testTowerOccupyAndFire() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(r, 4, 'P'), 10, 'W');
  const level = bigEmptyLevel([[5, r], [17, '#....................................g#']]);
  const g = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  const p = g.players[0];
  const t = g.towers[0];
  p.invuln = 999;
  g.graceT = 1e9;
  // out at 1.2 tiles: act must NOT occupy (that ring belongs to repair holds)
  p.x = t.x - TILE * 1.2; p.y = t.y;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(p.towerId ?? null, null, 'act outside 0.9 tiles does not occupy');
  // stand at the base: act occupies and snaps to the platform
  p.x = t.x; p.y = t.y + TILE * 0.5;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(p.towerId, 0, 'act at the tower base occupies it');
  assert.equal(t.occupant, 0, 'tower records its occupant');
  assert.ok(p.x === t.x && p.y === t.y, 'occupant snaps to the tower center');
  const snapT = snapshot(g, false);
  assert.equal(snapT.players[0].towerId, 0, 'snapshot carries towerId');
  assert.equal(snapT.towers[0].occupant, 0, 'snapshot towers carry the occupant');
  // movement is locked but the gunner still swivels
  run(g, () => ({ 0: { right: true } }), 1);
  assert.ok(p.x === t.x && p.y === t.y, 'occupant cannot walk off the platform');
  assert.equal(p.fx, 1, 'movement input swivels the aim');
  // fire: +35% range at level 1, shots sail over walls
  p.cool = 0;
  step(g, { 0: { fire: true, right: true } }, 1 / 30);
  const shot = g.shots[g.shots.length - 1];
  assert.ok(shot, 'occupant fires');
  assert.equal(shot.overWalls, true, 'tower shots fly over walls');
  // ttl already ticked once inside the same step: allow one frame of slack
  const ch = charMap.scout;
  assert.ok(Math.abs(shot.ttl - (ch.weapon.range * 1.35) / ch.weapon.projSpeed) < 0.04, 'level 1 tower grants +35% range');
  // level 3 towers grant +65%
  t.level = 3;
  p.cool = 0;
  step(g, { 0: { fire: true } }, 1 / 30);
  const shot3 = g.shots[g.shots.length - 1];
  assert.ok(Math.abs(shot3.ttl - (ch.weapon.range * 1.65) / ch.weapon.projSpeed) < 0.04, 'level 3 tower grants +65% range');
  t.level = 1;
  // leave with a fresh act edge
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(p.towerId ?? null, null, 'act edge leaves the tower');
  assert.equal(t.occupant, null, 'tower is vacant again');
  // going down ejects the occupant
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(p.towerId, 0, 're-occupied');
  p.invuln = 0; p.shield = 0; p.hp = 1;
  enemyShotAt(g, p);
  step(g, { 0: {} }, 1 / 30);
  assert.equal(p.state, 'down', 'occupant went down');
  assert.equal(p.towerId ?? null, null, 'downed occupant is ejected');
  assert.equal(t.occupant, null, 'tower vacated on down');
}

// --- watchtowers are structures: gnawed by melee, repairable, upgradable,
// destroyed ones eject the gunner and rebuild for 10 shards ---
function testTowerSiegeRepairRebuild() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(r, 4, 'P'), 10, 'W'), 12, 'g');
  const level = bigEmptyLevel([[5, r], [17, '#....................................g#']]);
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  const t = g.towers[0];
  const e = g.enemies[0];
  p.invuln = 999;
  g.graceT = 0;
  // occupy, then let the grunt march on the occupant and gnaw the tower
  p.x = t.x; p.y = t.y + TILE * 0.5;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(p.towerId, 0, 'gunner in the tower');
  t.level = 2;
  t.hp = t.maxHp = 28;
  e.awake = true;
  run(g, () => ({ 0: {} }), 5);
  assert.ok(g.events.some(ev => ev.type === 'buildHit' && ev.x === t.x), 'melee enemies gnaw the tower');
  assert.ok(t.hp < 28, 'tower takes structure damage');
  t.hp = 1; // skip ahead to the collapse
  run(g, () => ({ 0: {} }), 1.5);
  assert.equal(t.hp, 0, 'tower falls');
  assert.ok(g.events.some(ev => ev.type === 'buildDown' && ev.kind === 'tower'), 'buildDown event fired for the tower');
  assert.equal(p.towerId ?? null, null, 'destroyed tower ejects the occupant');
  assert.equal(t.level, 1, 'destroyed tower loses its upgrades');
  // clear the field, then rebuild like a build site for 10 shards
  playerShotAt(g, e, 99);
  step(g, { 0: {} }, 1 / 30);
  g.drops.length = 0; // the corpse shard would pollute the cost accounting
  g.shards = 25;
  p.x = t.x - TILE; p.y = t.y;
  run(g, () => ({ 0: { act: t.hp <= 0 } }), 8);
  assert.equal(t.hp, 20, 'rebuilt tower stands at level 1 hp');
  assert.ok(Math.abs(g.shards - 15) < 0.05, 'rebuild cost 10 shards');
  assert.ok(g.events.some(ev => ev.type === 'built' && ev.kind === 'tower'), 'rebuild fires a built event');
  // hold-act ring: repair then upgrade, exactly like other structures
  t.hp = 12;
  p.x = t.x - TILE * 1.2; p.y = t.y;
  run(g, () => ({ 0: { act: t.hp < t.maxHp } }), 5);
  assert.equal(t.hp, 20, 'hold-act repairs the tower');
  run(g, () => ({ 0: { act: t.level === 1 } }), 7);
  assert.equal(t.level, 2, 'hold-act upgrades the tower');
  assert.equal(t.maxHp, 28, 'level 2 tower maxHp is 28');
  assert.equal(t.hp, 28, 'tower upgrade completes at full hp');
}

// --- shop: act-hold carousel with movement lock, left/right browse, fire buys ---
function testShopCarousel() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(r, 4, 'P'), 10, 'S');
  const level = bigEmptyLevel([[5, r], [17, '#....................................g#']]);
  const g = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  const p = g.players[0];
  const shop = g.shops[0];
  p.invuln = 999;
  g.shards = 50;
  p.x = shop.x + TILE; p.y = shop.y;
  const x0 = p.x;
  // holding act inside 1.5 tiles opens the stall and locks movement
  run(g, () => ({ 0: { act: true, right: true } }), 0.5);
  assert.equal(p.shopping, true, 'holding act near the stall opens the carousel');
  assert.equal(p.x, x0, 'browsing locks movement');
  assert.deepEqual(snapshot(g, false).players[0].shop, { idx: 0 }, 'snapshot carries the carousel state');
  // the right held at open never cycled (all-held start); a fresh edge does
  step(g, { 0: { act: true } }, 1 / 30);
  step(g, { 0: { act: true, right: true } }, 1 / 30);
  assert.equal(p.shopIdx, 1, 'right edge cycles the offers');
  // fire buys the shield offer
  step(g, { 0: { act: true, fire: true } }, 1 / 30);
  assert.equal(p.shield, 2, 'shield offer grants +2 pips');
  assert.equal(g.shards, 38, 'shield costs 12');
  let buys = g.events.filter(ev => ev.type === 'buy');
  assert.deepEqual({ what: buys[0].what, cost: buys[0].cost }, { what: 'shield', cost: 12 }, 'buy event fired');
  assert.equal(g.shots.length, 0, 'fire while browsing never shoots');
  // crackers: x2 per purchase, stacking
  step(g, { 0: { act: true } }, 1 / 30);
  step(g, { 0: { act: true, right: true } }, 1 / 30);
  step(g, { 0: { act: true, fire: true } }, 1 / 30);
  assert.deepEqual(p.item, { kind: 'cracker', count: 2 }, 'cracker offer fills the slot with 2');
  step(g, { 0: { act: true } }, 1 / 30);
  step(g, { 0: { act: true, fire: true } }, 1 / 30);
  assert.deepEqual(p.item, { kind: 'cracker', count: 4 }, 'same-kind purchases stack');
  assert.equal(g.shards, 22, 'two cracker packs cost 16');
  // medkit swaps the slot kind
  step(g, { 0: { act: true } }, 1 / 30);
  step(g, { 0: { act: true, right: true } }, 1 / 30);
  step(g, { 0: { act: true, fire: true } }, 1 / 30);
  assert.deepEqual(p.item, { kind: 'medkit', count: 1 }, 'different-kind purchase swaps the slot');
  assert.equal(g.shards, 12, 'medkit costs 10');
  // token: unaffordable at 12 shards -> nothing happens
  // (carousel now holds 5 offers — the toxin canister sits between medkit and the wrap)
  step(g, { 0: { act: true } }, 1 / 30);
  step(g, { 0: { act: true, right: true } }, 1 / 30);
  assert.equal(p.shopIdx, 4, 'toxin canister is the fifth offer');
  step(g, { 0: { act: true } }, 1 / 30);
  step(g, { 0: { act: true, right: true } }, 1 / 30);
  assert.equal(p.shopIdx, 0, 'carousel wraps back to the token');
  step(g, { 0: { act: true, fire: true } }, 1 / 30);
  assert.equal(p.dmgBonus ?? 0, 0, 'unaffordable offer does not sell');
  assert.equal(g.shards, 12, 'no shards spent');
  // tokens raise weapon AND special damage via dmgBonus, capped at +2
  g.shards = 60;
  for (let i = 0; i < 3; i++) {
    step(g, { 0: { act: true } }, 1 / 30);
    step(g, { 0: { act: true, fire: true } }, 1 / 30);
  }
  assert.equal(p.dmgBonus, 2, 'weapon tokens cap at +2');
  assert.equal(g.shards, 20, 'the third token never sold');
  buys = g.events.filter(ev => ev.type === 'buy');
  assert.equal(buys.length, 6, 'six successful purchases in total');
  // release act: stall closes, movement and fire return
  step(g, { 0: {} }, 1 / 30);
  assert.equal(p.shopping, false, 'releasing act closes the stall');
  run(g, () => ({ 0: { right: true } }), 0.5);
  assert.ok(p.x > x0, 'movement unlocked');
  p.cool = 0;
  step(g, { 0: { fire: true } }, 1 / 30);
  const shot = g.shots[g.shots.length - 1];
  assert.equal(shot.dmg, 3, 'scout SMG fires at 1+2 token damage');
}

// --- hire posts: act+shards hires; smith/engineer/farmer work deterministic ticks ---
function testHireJobs() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(put(put(r, 4, 'P'), 8, 'H'), 10, 'H'), 12, 'H'), 20, 'B');
  const level = bigEmptyLevel([[5, r], [17, '#....................................g#']]);
  level.hires = [
    { job: 'smith', cost: 5, name: 'Bo' },
    { job: 'engineer', cost: 7, name: 'Ada' },
    { job: 'farmer', cost: 6, name: 'Fae' },
  ];
  level.builds = [{ kind: 'farm', cost: 6 }];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  const [smith, engineer, farmer] = g.hires;
  const farm = g.builds[0];
  p.invuln = 999;
  g.graceT = 1e9;
  // broke: the post consumes the press but sells nothing
  g.shards = 3;
  p.x = smith.x; p.y = smith.y + TILE;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(smith.hired, false, 'cannot hire without the shards');
  // hire the smith
  g.shards = 12;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(smith.hired, true, 'smith hired');
  assert.equal(g.shards, 7, 'hire cost paid');
  const hiredEv = g.events.find(ev => ev.type === 'hired');
  assert.deepEqual({ name: hiredEv.name, job: hiredEv.job }, { name: 'Bo', job: 'smith' }, 'hired event names the operator');
  assert.equal(snapshot(g, false).hires[0].hired, true, 'snapshot tracks hired posts');
  // smith: +1 shard to the pool every 20s
  const pool0 = g.shards;
  run(g, () => ({ 0: {} }), 20.1);
  assert.equal(g.shards, pool0 + 1, 'smith pays +1 shard after 20s');
  // engineer: free 1 hp / 3s on the nearest damaged structure
  g.shards = 20;
  p.x = engineer.x; p.y = engineer.y + TILE;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(engineer.hired, true, 'engineer hired');
  p.x = farm.x - TILE; p.y = farm.y;
  run(g, () => ({ 0: { act: !farm.built } }), 5);
  assert.ok(farm.built, 'farm built');
  farm.hp = 2;
  const shardsBefore = g.shards;
  run(g, () => ({ 0: {} }), 9.2);
  assert.equal(farm.hp, 5, 'engineer repaired 3 hp in 9s');
  assert.ok(g.shards >= shardsBefore, 'engineer repairs are free');
  // tramples kill the plot until someone replants
  farm.stage = 2;
  farm.trampled = true;
  run(g, () => ({ 0: {} }), 12);
  assert.equal(farm.trampled, true, 'no farmer: a trampled plot stays fallow');
  // a player can replant by hand with act
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(farm.trampled, false, 'act on a trampled farm replants it');
  // the farmer replants unasked after 10s
  p.x = farmer.x; p.y = farmer.y + TILE;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(farmer.hired, true, 'farmer hired');
  farm.trampled = true;
  farm.replantT = 0;
  run(g, () => ({ 0: {} }), 10.2);
  assert.equal(farm.trampled, false, 'hired farmer auto-replants after 10s');
}

// --- stag: shared land mount, x2.2 speed, no fire/special, act dismounts ---
function testVehicleStag() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(r, 4, 'P'), 8, 'V');
  const level = bigEmptyLevel([[5, r], [17, '#....................................g#']]);
  level.vehicles = [{ kind: 'stag' }];
  const g = createGame(level, [
    { pid: 0, name: 'A', charId: 'scout' },
    { pid: 1, name: 'B', charId: startingRoster[1] },
  ], charMap, startingRoster);
  const [a, b] = g.players;
  const v = g.vehicles[0];
  a.invuln = 999; b.invuln = 999;
  g.graceT = 1e9;
  a.x = v.x - TILE; a.y = v.y;
  step(g, { 0: {}, 1: {} }, 1 / 30);
  step(g, { 0: { act: true }, 1: {} }, 1 / 30);
  assert.equal(a.riding, 'v0', 'act mounts the stag');
  assert.equal(v.rider, 0, 'stag records its rider');
  assert.ok(a.x === v.x && a.y === v.y, 'mounting snaps to the saddle');
  assert.ok(g.events.some(ev => ev.type === 'mount' && ev.kind === 'stag'), 'mount event fired');
  assert.equal(snapshot(g, false).players[0].riding, 'v0', 'snapshot carries riding');
  // one saddle: the second player cannot take a ridden stag
  b.x = v.x; b.y = v.y + TILE * 0.5;
  step(g, { 0: {}, 1: {} }, 1 / 30);
  step(g, { 0: {}, 1: { act: true } }, 1 / 30);
  assert.equal(b.riding ?? null, null, 'a ridden stag refuses a second rider');
  b.x = TILE * 2; b.y = TILE * 2;
  // x2.2 speed, the stag moves with the rider
  const x0 = a.x;
  run(g, () => ({ 0: { right: true }, 1: {} }), 0.5);
  const expected = charMap.scout.speed * 2.2 * TILE * 0.5;
  assert.ok(Math.abs((a.x - x0) - expected) < 2, `stag covers x2.2 ground (got ${(a.x - x0).toFixed(1)} vs ${expected.toFixed(1)})`);
  assert.ok(v.x === a.x && v.y === a.y, 'the stag carries its rider');
  // no fire, no special from the saddle
  a.cool = 0; a.specialCool = 0;
  run(g, () => ({ 0: { fire: true }, 1: {} }), 0.3);
  assert.equal(g.shots.length, 0, 'no firing while mounted');
  step(g, { 0: { special: true }, 1: {} }, 1 / 30);
  assert.ok(!g.events.some(ev => ev.type === 'dash' || ev.type === 'special'), 'no specials while mounted');
  // act dismounts in place; the stag is free for anyone again
  step(g, { 0: {}, 1: {} }, 1 / 30);
  step(g, { 0: { act: true }, 1: {} }, 1 / 30);
  assert.equal(a.riding ?? null, null, 'act dismounts');
  assert.equal(v.rider, null, 'the stag is free again');
  assert.ok(g.events.some(ev => ev.type === 'dismount'), 'dismount event fired');
  // going down throws the rider
  step(g, { 0: {}, 1: {} }, 1 / 30);
  step(g, { 0: { act: true }, 1: {} }, 1 / 30);
  assert.equal(a.riding, 'v0', 'remounted');
  a.invuln = 0; a.shield = 0; a.hp = 1;
  enemyShotAt(g, a);
  step(g, { 0: {}, 1: {} }, 1 / 30);
  assert.equal(a.state, 'down', 'rider went down');
  assert.equal(v.rider, null, 'a downed rider frees the stag');
}

// --- skiff: boards only beside water, sails only on water, lands on shores ---
function testVehicleSkiff() {
  // a 4-tile-wide river (cols 12-15) splits the map; the skiff docks at col 11
  const tiles = [];
  tiles.push('#'.repeat(40));
  for (let y = 1; y < 19; y++) tiles.push('#' + '.'.repeat(10) + '~~~~' + '.'.repeat(24) + '#');
  tiles.push('#'.repeat(40));
  tiles[2] = '#P' + '.'.repeat(9) + '~~~~' + '.'.repeat(24) + '#';
  tiles[17] = '#' + '.'.repeat(10) + '~~~~' + '.'.repeat(23) + 'g#';
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  tiles[5] = put(tiles[5], 11, 'V');
  const level = { name: 'Skiff Test', time: 300, captiveChars: [], vehicles: [{ kind: 'skiff' }], tiles };
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const tileAt = (gg, x, y) => gg.grid[Math.floor(y / TILE)][Math.floor(x / TILE)];
  const p = g.players[0];
  const v = g.vehicles[0];
  assert.equal(v.kind, 'skiff', 'skiff parsed');
  p.invuln = 999;
  g.graceT = 1e9;
  // a tile away from the bank: in reach of the skiff but not beside water
  p.x = (9 + 0.5) * TILE; p.y = v.y;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(p.riding ?? null, null, 'a skiff only boards from a tile beside water');
  // on the bank: mount works
  p.x = (11 + 0.5) * TILE;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(p.riding, 'v0', 'boarded from the bank');
  // sail east onto the river; the far bank (col 15, land) blocks the bow
  run(g, () => ({ 0: { right: true } }), 4);
  assert.equal(Math.floor(p.x / TILE), 14, 'the skiff sails water and stops at the far bank');
  assert.equal(tileAt(g, p.x, p.y), '~', 'still afloat');
  // sailing along the river works too
  const y0 = p.y;
  run(g, () => ({ 0: { down: true } }), 0.5);
  assert.ok(p.y > y0, 'the skiff sails along the river');
  // mid-river with no shore beside: cannot disembark
  p.x = (13 + 0.5) * TILE; p.y = (9 + 0.5) * TILE;
  v.x = p.x; v.y = p.y;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(p.riding, 'v0', 'no land in reach: still aboard');
  // beside the far bank: act steps ashore, the skiff stays moored
  p.x = (14 + 0.5) * TILE;
  v.x = p.x; v.y = p.y;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(p.riding ?? null, null, 'disembarked beside the bank');
  assert.ok(tileAt(g, p.x, p.y) !== '~', 'the sailor stands on dry land');
  assert.equal(tileAt(g, v.x, v.y), '~', 'the skiff stays moored on the water');
  assert.equal(v.rider, null, 'moored skiff is free');
  // and it can be re-boarded from that shore
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(p.riding, 'v0', 're-boarded from the far shore');
}

// helper: a parked pvp shot owned by a player (pid/team), like enemyShotAt
function pvpShotAt(g, target, pid, team, dmg = 1) {
  g.shots.push({
    id: g.nextShotId++, x: target.x, y: target.y, vx: 0, vy: 0, ttl: 0.5, dmg,
    who: 'p', pid, team, overWalls: true, pierce: 0, aoeRadius: 0, curve: 0, radius: 5, kind: 'test', hits: [],
  });
}

function ctfDef() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  const tiles = [];
  tiles.push('#'.repeat(40));
  for (let y = 1; y < 19; y++) tiles.push('#' + '.'.repeat(38) + '#');
  tiles.push('#'.repeat(40));
  tiles[2] = '#PPPP' + '.'.repeat(34) + '#';
  tiles[10] = put(put(tiles[10], 2, 'D'), 37, 'D');
  tiles[15] = put(tiles[15], 20, 'g'); // pvp must strip AI enemies at create
  return { name: 'CTF Test', time: 120, mode: 'ctf', captiveChars: [], tiles };
}

// --- ctf: teams, friendly fire off, carry/drop/return/capture, respawns ---
function testCtfMatch() {
  const party = [0, 1, 2, 3].map(i => ({ pid: i, name: 'P' + i, charId: startingRoster[i % startingRoster.length] }));
  const g = createGame(ctfDef(), party, charMap, startingRoster);
  assert.equal(g.mode, 'ctf');
  assert.equal(g.arcade, false, 'mode maps are never arcade class');
  assert.equal(g.enemies.length, 0, 'ctf fields no AI enemies');
  assert.deepEqual(g.players.map(p => p.team), [0, 1, 0, 1], 'local seats alternate teams');
  assert.deepEqual(g.caps, [0, 0], 'score starts 0-0');
  const s0 = snapshot(g, false);
  assert.deepEqual(s0.caps, [0, 0], 'snapshot carries caps');
  assert.equal(s0.players[1].team, 1, 'snapshot players carry team');
  assert.equal(s0.flags.length, 2, 'snapshot carries both flags');
  const [p0, p1, p2, p3] = g.players;
  const [f0, f1] = g.flags;
  for (const p of g.players) p.invuln = 0;
  // park everyone away from the stands
  p0.x = 10 * TILE; p0.y = 5 * TILE;
  p1.x = 12 * TILE; p1.y = 5 * TILE;
  p2.x = 14 * TILE; p2.y = 5 * TILE;
  p3.x = 30 * TILE; p3.y = 5 * TILE;
  // friendly fire is OFF: p0's shot parked on teammate p2 does nothing
  pvpShotAt(g, p2, 0, 0);
  step(g, { 0: {}, 1: {}, 2: {}, 3: {} }, 1 / 30);
  assert.equal(p2.hp, 3, 'friendly fire is off');
  assert.ok(!g.events.some(ev => ev.type === 'playerHit'), 'no hit event on a teammate');
  // but the same shot wounds an enemy
  pvpShotAt(g, p1, 0, 0);
  step(g, { 0: {}, 1: {}, 2: {}, 3: {} }, 1 / 30);
  assert.equal(p1.hp, 2, 'enemy-team players take shot damage');
  assert.ok(g.events.some(ev => ev.type === 'playerHit' && ev.pid === 1), 'playerHit fired for the enemy');
  // real weapon fire stamps pid/team on the shot
  p0.cool = 0;
  step(g, { 0: { fire: true }, 1: {}, 2: {}, 3: {} }, 1 / 30);
  const ws = g.shots[g.shots.length - 1];
  assert.ok(ws.pid === 0 && ws.team === 0, 'player shots carry pid and team');
  g.shots.length = 0;
  // p1 (team 1) grabs the team-0 flag off its stand
  p1.invuln = 0;
  p1.x = f0.homeX; p1.y = f0.homeY;
  step(g, { 0: {}, 1: {}, 2: {}, 3: {} }, 1 / 30);
  assert.equal(f0.carrier, 1, 'touching the enemy flag takes it');
  assert.equal(f0.atBase, false, 'taken flag leaves the stand');
  assert.ok(g.events.some(ev => ev.type === 'flagTaken' && ev.team === 0), 'flagTaken event fired');
  // carriers run 15% slower
  p1.x = 10 * TILE; p1.y = 8 * TILE;
  const cx0 = p1.x;
  run(g, () => ({ 1: { right: true } }), 1);
  const carried = p1.x - cx0;
  const expectedCarry = charMap[p1.charId].speed * TILE * 0.85;
  assert.ok(Math.abs(carried - expectedCarry) < 3, `carrier slowed to 85% (got ${carried.toFixed(1)} vs ${expectedCarry.toFixed(1)})`);
  // downing the carrier drops the flag where they fell (8s to return)
  p1.invuln = 0; p1.shield = 0; p1.hp = 1;
  const dropX = p1.x;
  pvpShotAt(g, p1, 0, 0);
  step(g, { 0: {}, 1: {}, 2: {}, 3: {} }, 1 / 30);
  assert.equal(p1.state, 'down', 'carrier downed');
  assert.equal(g.captives.length, 0, 'pvp downs never drop captives');
  assert.equal(p1.charId, party[1].charId, 'pvp keeps the operative');
  assert.equal(f0.carrier, null, 'flag dropped');
  assert.ok(Math.abs(f0.x - dropX) < TILE, 'flag lies where the carrier fell');
  assert.ok(f0.dropT > 7.9, 'dropped flag waits 8s before returning');
  // its own team touches it: instant return
  p2.x = f0.x; p2.y = f0.y;
  step(g, { 0: {}, 1: {}, 2: {}, 3: {} }, 1 / 30);
  assert.equal(f0.atBase, true, 'own team returns a dropped flag instantly');
  assert.ok(f0.x === f0.homeX && f0.y === f0.homeY, 'flag back on its stand');
  assert.ok(g.events.some(ev => ev.type === 'flagReturn' && ev.team === 0), 'flagReturn event fired');
  p2.x = 14 * TILE; p2.y = 5 * TILE;
  // the downed carrier redeploys at their own stand after 5s, reset and whole
  run(g, () => ({}), 5.2);
  assert.equal(p1.state, 'active', 'ctf respawns after 5s');
  assert.ok(p1.x === f1.homeX && p1.y === f1.homeY, 'respawn lands at the team flag stand');
  assert.equal(p1.hp, 3, 'respawn restores hp');
  p1.x = 30 * TILE; p1.y = 15 * TILE;
  // p0 runs the full capture: take the enemy flag, bring it home
  p0.x = f1.homeX; p0.y = f1.homeY;
  step(g, { 0: {}, 1: {}, 2: {}, 3: {} }, 1 / 30);
  assert.equal(f1.carrier, 0, 'p0 took the team-1 flag');
  p0.x = f0.homeX; p0.y = f0.homeY;
  step(g, { 0: {}, 1: {}, 2: {}, 3: {} }, 1 / 30);
  assert.deepEqual(g.caps, [1, 0], 'capture scores');
  assert.ok(g.events.some(ev => ev.type === 'capture' && ev.team === 0), 'capture event fired');
  assert.equal(f1.atBase, true, 'captured flag returns home');
  // first to 3 wins
  g.caps[0] = 2;
  p0.x = f1.homeX; p0.y = f1.homeY;
  step(g, { 0: {}, 1: {}, 2: {}, 3: {} }, 1 / 30);
  p0.x = f0.homeX; p0.y = f0.homeY;
  step(g, { 0: {}, 1: {}, 2: {}, 3: {} }, 1 / 30);
  assert.equal(g.status, 'cleared', 'third capture ends the match');
  assert.equal(g.winner, 0, 'team 0 wins');
  const endEv = g.events.find(ev => ev.type === 'matchEnd');
  assert.ok(endEv && endEv.winner === 0 && endEv.caps[0] === 3, 'matchEnd carries winner and caps');
  assert.equal(snapshot(g, false).winner, 0, 'snapshot carries the winner');
  // pvp never touches the campaign roster
  assert.deepEqual(applyResults(startingRoster, g).roster, startingRoster, 'ctf leaves the roster untouched');
}

// --- ctf clock: expiry crowns the leader; a tie goes to sudden death ---
function testCtfTimerAndSuddenDeath() {
  const party = [0, 1].map(i => ({ pid: i, name: 'P' + i, charId: startingRoster[i] }));
  // leader at the horn wins outright
  let g = createGame(ctfDef(), party, charMap, startingRoster);
  g.caps = [0, 2];
  g.timeLeft = 0.05;
  run(g, () => ({}), 0.2);
  assert.equal(g.status, 'cleared', 'timer expiry ends a decided match');
  assert.equal(g.winner, 1, 'the leading team wins at the horn');
  assert.equal(g.timeLeft, 0, 'clock stops at zero');
  // a tie freezes the clock and the next capture takes it all
  g = createGame(ctfDef(), party, charMap, startingRoster);
  g.caps = [1, 1];
  g.timeLeft = 0.05;
  run(g, () => ({}), 0.3);
  assert.equal(g.status, 'play', 'tied match plays on');
  assert.equal(g.suddenDeath, true, 'sudden death armed');
  assert.equal(g.timeLeft, 0, 'clock frozen at zero');
  const p0 = g.players[0];
  const [f0, f1] = g.flags;
  p0.invuln = 0;
  p0.x = f1.homeX; p0.y = f1.homeY;
  step(g, { 0: {}, 1: {} }, 1 / 30);
  p0.x = f0.homeX; p0.y = f0.homeY;
  step(g, { 0: {}, 1: {} }, 1 / 30);
  assert.equal(g.status, 'cleared', 'sudden-death capture ends it');
  assert.equal(g.winner, 0, 'capturing team takes the match');
  assert.deepEqual(g.caps, [2, 1], 'the golden capture still counts');
}

// --- br: every player for themselves, shrink zone, eliminations, last one standing ---
function testBrZoneAndWinner() {
  const tiles = [];
  tiles.push('#'.repeat(40));
  for (let y = 1; y < 19; y++) tiles.push('#' + '.'.repeat(38) + '#');
  tiles.push('#'.repeat(40));
  tiles[2] = '#PPP' + '.'.repeat(35) + '#';
  const def = {
    name: 'BR Test', time: 300, mode: 'br', captiveChars: [],
    br: { shrinks: [{ at: 1, r: 4 }] },
    tiles,
  };
  const party = [0, 1, 2].map(i => ({ pid: i, name: 'P' + i, charId: startingRoster[i] }));
  const g = createGame(def, party, charMap, startingRoster);
  assert.equal(g.mode, 'br');
  assert.deepEqual(g.players.map(p => p.team), [0, 1, 2], 'br teams are the pids');
  const z = g.zone;
  assert.ok(z && z.x === 20 * TILE && z.y === 10 * TILE, 'zone centers on the map');
  const r0 = z.r;
  const sz = snapshot(g, false).zone;
  assert.ok(sz && sz.r === r0, 'snapshot carries the zone');
  const [p0, p1, p2] = g.players;
  for (const p of g.players) { p.invuln = 0; p.x = z.x; p.y = z.y; }
  p0.x = z.x + TILE; // keep them apart, all inside
  p2.x = 2 * TILE; p2.y = 2 * TILE; // far corner: outside once the ring closes
  p2.shield = 1;
  // the scheduled shrink fires at 1s and closes over 10s
  run(g, () => ({}), 1.2);
  const shrinkEv = g.events.find(ev => ev.type === 'zoneShrink');
  assert.ok(shrinkEv, 'zoneShrink event fired');
  assert.equal(z.targetR, 4 * TILE, 'shrink targets the scheduled radius');
  assert.ok(z.r < r0, 'the ring is closing');
  run(g, () => ({}), 11);
  assert.equal(z.r, 4 * TILE, 'ring settles at the target radius');
  // outside: 1 damage every 2s, shield first
  assert.ok(p2.shield === 0 || p2.hp < 3, 'zone damage landed on the straggler');
  assert.ok(g.events.some(ev => ev.type === 'playerHit' && ev.pid === 2), 'zone damage routes through playerHit');
  // keep burning until elimination — no down state, no captive, just out
  run(g, () => ({}), 8);
  assert.equal(p2.state, 'out', 'br eliminations skip the down/rescue flow');
  assert.equal(g.captives.length, 0, 'no captive body in br');
  const elim = g.events.find(ev => ev.type === 'eliminated');
  assert.ok(elim && elim.pid === 2 && elim.remaining === 2, 'eliminated event counts the remaining players');
  assert.equal(g.status, 'play', 'two still standing: match continues');
  // p0 guns down p1 (teams differ: pids) -> last one standing wins
  p1.invuln = 0; p1.shield = 0; p1.hp = 1;
  pvpShotAt(g, p1, 0, 0);
  step(g, { 0: {}, 1: {}, 2: {} }, 1 / 30);
  assert.equal(p1.state, 'out', 'shot elimination is immediate');
  assert.equal(g.status, 'cleared', 'last player standing ends the match');
  assert.equal(g.winner, 0, 'the survivor wins');
  assert.ok(g.events.some(ev => ev.type === 'matchEnd' && ev.winner === 0), 'matchEnd fired');
  assert.equal(snapshot(g, false).winner, 0, 'snapshot carries the winner');
  assert.deepEqual(applyResults(startingRoster, g).roster, startingRoster, 'br leaves the roster untouched');
}

// --- ctf: per-team shard pools (collectors credit, spenders debit); br keeps one pool ---
function testCtfTeamShardPools() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  const def = ctfDef();
  def.tiles[8] = put(put(def.tiles[8], 10, 'C'), 14, 'S');
  def.chests = [{ loot: 'shards', amount: 9 }];
  const party = [0, 1, 2, 3].map(i => ({ pid: i, name: 'P' + i, charId: startingRoster[i % startingRoster.length] }));
  const g = createGame(def, party, charMap, startingRoster);
  assert.deepEqual(g.teamShards, [0, 0], 'ctf opens with empty per-team pools');
  assert.deepEqual(snapshot(g, false).teamShards, [0, 0], 'snapshot carries teamShards');
  const [p0, p1] = g.players;
  for (const p of g.players) p.invuln = 999;
  g.players[2].x = 30 * TILE; g.players[2].y = 15 * TILE;
  g.players[3].x = 31 * TILE; g.players[3].y = 15 * TILE;
  // a team-0 opener credits team 0's pool only
  const chest = g.chests[0];
  p0.x = chest.x; p0.y = chest.y;
  step(g, { 0: {}, 1: {}, 2: {}, 3: {} }, 1 / 30);
  step(g, { 0: { act: true }, 1: {}, 2: {}, 3: {} }, 1 / 30);
  assert.deepEqual(g.teamShards, [9, 0], 'chest shards credit the opener team');
  assert.equal(g.shards, 0, 'the shared pool stays untouched in ctf');
  // a drop collected by team 1 credits team 1
  p1.x = 20 * TILE; p1.y = 14 * TILE;
  g.drops.push({ x: p1.x + 4, y: p1.y, amount: 5, ttl: 10 });
  step(g, { 0: {}, 1: {}, 2: {}, 3: {} }, 1 / 30);
  assert.deepEqual(g.teamShards, [9, 5], 'shard drops credit the collector team');
  // shop spends debit the BUYER's team — the enemy pool is no help
  const shop = g.shops[0];
  p1.x = shop.x; p1.y = shop.y;
  p1.shopIdx = 1; // shield offer, 12 shards
  step(g, { 0: {}, 1: { act: true }, 2: {}, 3: {} }, 1 / 30);
  assert.equal(p1.shopping, true, 'stall engaged');
  step(g, { 0: {}, 1: { act: true, fire: true }, 2: {}, 3: {} }, 1 / 30);
  assert.equal(p1.shield, 0, 'team 1 cannot spend team 0 shards');
  assert.deepEqual(g.teamShards, [9, 5], 'no cross-team debit');
  g.teamShards[1] = 20;
  step(g, { 0: {}, 1: { act: true }, 2: {}, 3: {} }, 1 / 30);
  step(g, { 0: {}, 1: { act: true, fire: true }, 2: {}, 3: {} }, 1 / 30);
  assert.equal(p1.shield, 2, 'buyer with a funded team pool gets the goods');
  assert.deepEqual(g.teamShards, [9, 8], 'spend debits the spender team only');
  // BR keeps ONE shared pool by design
  const tiles2 = [];
  tiles2.push('#'.repeat(40));
  for (let y = 1; y < 19; y++) tiles2.push('#' + '.'.repeat(38) + '#');
  tiles2.push('#'.repeat(40));
  tiles2[2] = '#PP' + '.'.repeat(36) + '#';
  tiles2[8] = put(tiles2[8], 10, 'C');
  const def2 = { name: 'BR Pool', time: 300, mode: 'br', captiveChars: [], br: { shrinks: [] }, chests: [{ loot: 'shards', amount: 7 }], tiles: tiles2 };
  const g2 = createGame(def2, [0, 1].map(i => ({ pid: i, name: 'P' + i, charId: startingRoster[i] })), charMap, startingRoster);
  assert.equal(g2.teamShards, null, 'br has no per-team pools');
  assert.equal(snapshot(g2, false).teamShards, undefined, 'br snapshot ships no teamShards');
  const q0 = g2.players[0];
  q0.invuln = 999;
  q0.x = g2.chests[0].x; q0.y = g2.chests[0].y;
  step(g2, { 0: {}, 1: {} }, 1 / 30);
  step(g2, { 0: { act: true }, 1: {} }, 1 / 30);
  assert.equal(g2.shards, 7, 'br chest shards land in the one shared pool');
}

// --- pvp: aoe/cracker booms hit the other team only, stim wards own team,
// --- and downing an enemy credits the attacker with a kill ---
function testPvpAoeStimAndKillCredit() {
  const party = [0, 1, 2, 3].map(i => ({ pid: i, name: 'P' + i, charId: startingRoster[i % startingRoster.length] }));
  const g = createGame(ctfDef(), party, charMap, startingRoster);
  const [p0, p1, p2, p3] = g.players; // teams 0,1,0,1
  for (const p of g.players) p.invuln = 0;
  assert.deepEqual(g.players.map(p => p.kills), [0, 0, 0, 0], 'pvp players open with 0 kills');
  p0.x = 6 * TILE; p0.y = 5 * TILE;
  p1.x = 20 * TILE; p1.y = 5 * TILE;
  p2.x = 20 * TILE + 18; p2.y = 5 * TILE; // team 0, inside the blast
  p3.x = 20 * TILE - 18; p3.y = 5 * TILE; // team 1, inside the blast
  // an aoe shot from p0 (team 0) dies on p1 — the blast wounds team 1 only
  g.shots.push({
    id: g.nextShotId++, x: p1.x, y: p1.y, vx: 0, vy: 0, ttl: 0.01, dmg: 1,
    who: 'p', pid: 0, team: 0, overWalls: true, pierce: 0, aoeRadius: TILE * 1.5, curve: 0, radius: 5, kind: 'test', hits: [],
  });
  step(g, { 0: {}, 1: {}, 2: {}, 3: {} }, 1 / 30);
  assert.equal(p1.hp, 2, 'direct pvp hit lands');
  assert.equal(p3.hp, 2, 'player aoe wounds the other team');
  assert.equal(p2.hp, 3, 'player aoe never wounds the shooter team');
  assert.equal(p0.hp, 3, 'the shooter is never self-hit');
  // downing an enemy credits the kill
  p3.invuln = 0; p3.shield = 0; p3.hp = 1;
  pvpShotAt(g, p3, 0, 0);
  step(g, { 0: {}, 1: {}, 2: {}, 3: {} }, 1 / 30);
  assert.equal(p3.state, 'down', 'enemy downed');
  assert.equal(p0.kills, 1, 'the attacker is credited with the kill');
  // cracker boom: other-team players in the blast take CRACKER_DMG
  p0.item = { kind: 'cracker', count: 1 };
  p0.x = 10 * TILE; p0.y = 14 * TILE; p0.fx = 1; p0.fy = 0;
  const bx = p0.x + 4 * TILE; // CRACKER_RANGE in the facing direction
  p1.invuln = 0; p1.x = bx; p1.y = p0.y;
  p2.x = bx + 10; p2.y = p0.y; // team 0 — must stay safe
  step(g, { 0: { item: true }, 1: {}, 2: {}, 3: {} }, 1 / 30);
  run(g, () => ({}), 4); // flight 0.5s + fuse 3s
  assert.ok(g.events.some(ev => ev.type === 'crackerBoom'), 'cracker detonated');
  assert.equal(p1.state, 'down', 'cracker boom downs the wounded enemy (3 dmg on 2 hp)');
  assert.equal(p2.hp, 3, 'cracker boom never wounds the owner team');
  assert.equal(p0.kills, 2, 'boom kills credit the thrower');
  // medic stim wards SAME-team players only
  const medicId = characters.find(c => c.special?.kind === 'stim').id;
  const g2 = createGame(ctfDef(), [
    { pid: 0, name: 'M', charId: medicId },           // team 0
    { pid: 1, name: 'E', charId: startingRoster[0] }, // team 1
    { pid: 2, name: 'A', charId: startingRoster[1] }, // team 0
  ], charMap, startingRoster);
  const [m, foe, ally] = g2.players;
  for (const p of g2.players) p.invuln = 0;
  m.x = 10 * TILE; m.y = 14 * TILE;
  foe.x = m.x + TILE; foe.y = m.y;
  ally.x = m.x - TILE; ally.y = m.y;
  step(g2, { 0: { special: true }, 1: {}, 2: {} }, 1 / 30);
  assert.ok(m.invuln >= 1.4, 'stim wards the medic');
  assert.ok(ally.invuln >= 1.4, 'stim wards the teammate in range');
  assert.equal(foe.invuln, 0, 'stim never wards the other team');
}

// --- ctf: mounting a stag drops a carried flag at the mount point ---
function testCtfFlagDropOnMount() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  const def = ctfDef();
  def.tiles[8] = put(def.tiles[8], 20, 'V');
  def.vehicles = [{ kind: 'stag' }];
  const party = [0, 1].map(i => ({ pid: i, name: 'P' + i, charId: startingRoster[i] }));
  const g = createGame(def, party, charMap, startingRoster);
  const [p0, p1] = g.players;
  const f1 = g.flags[1];
  const v = g.vehicles[0];
  for (const p of g.players) p.invuln = 0;
  p1.x = 30 * TILE; p1.y = 15 * TILE;
  // p0 grabs the enemy flag, carries it to the stag
  p0.x = f1.homeX; p0.y = f1.homeY;
  step(g, { 0: {}, 1: {} }, 1 / 30);
  assert.equal(f1.carrier, 0, 'flag taken');
  p0.x = v.x - TILE; p0.y = v.y;
  step(g, { 0: {}, 1: {} }, 1 / 30);
  step(g, { 0: { act: true }, 1: {} }, 1 / 30);
  assert.equal(p0.riding, 'v0', 'mounted the stag');
  assert.equal(f1.carrier, null, 'mounting drops the carried flag');
  assert.equal(f1.atBase, false, 'dropped — not returned home');
  assert.ok(Math.hypot(f1.x - v.x, f1.y - v.y) < TILE, 'flag lies at the mount point');
  assert.ok(f1.dropT > 7.9, 'standard 8s drop timer runs');
  assert.ok(g.events.some(ev => ev.type === 'flagDrop' && ev.team === 1 && ev.pid === 0), 'flagDrop event fired');
  // the rider parked on the drop cannot scoop it back up from the saddle
  run(g, () => ({}), 0.5);
  assert.equal(f1.carrier, null, 'mounted players never pick a flag up');
}

// --- ctf: the 180s sudden-death cap rules an endless overtime ---
function testCtfSuddenDeathCap() {
  const party = [0, 1].map(i => ({ pid: i, name: 'P' + i, charId: startingRoster[i] }));
  const arm = g => { // tie at the horn -> sudden death armed
    g.caps = [1, 1];
    g.timeLeft = 0.05;
    run(g, () => ({}), 0.2);
    assert.equal(g.suddenDeath, true, 'sudden death armed');
  };
  // grabs are counted from the whole match: a pickup increments the team
  let g = createGame(ctfDef(), party, charMap, startingRoster);
  const p0 = g.players[0];
  p0.invuln = 0;
  p0.x = g.flags[1].homeX; p0.y = g.flags[1].homeY;
  step(g, { 0: {}, 1: {} }, 1 / 30);
  assert.deepEqual(g.grabs, [1, 0], 'flag pickup counts a grab for the taking team');
  // more grabs wins at the cap
  g = createGame(ctfDef(), party, charMap, startingRoster);
  arm(g);
  g.grabs = [2, 3];
  g.suddenT = 179.9;
  run(g, () => ({}), 0.3);
  assert.equal(g.status, 'cleared', 'the 180s cap ends overtime');
  assert.equal(g.winner, 1, 'more grabs takes the match');
  // tied grabs: the team that grabbed FIRST in sudden death takes it
  g = createGame(ctfDef(), party, charMap, startingRoster);
  arm(g);
  const q1 = g.players[1];
  q1.invuln = 0;
  q1.x = g.flags[0].homeX; q1.y = g.flags[0].homeY;
  step(g, { 0: {}, 1: {} }, 1 / 30); // team 1 grabs first inside SD
  assert.equal(g.sdFirstGrab, 1, 'first sudden-death grab recorded');
  g.grabs = [4, 4];
  g.suddenT = 179.9;
  run(g, () => ({}), 0.3);
  assert.equal(g.winner, 1, 'tied grabs go to the first sudden-death grabber');
  // zero grabs anywhere: team 0 by definition
  g = createGame(ctfDef(), party, charMap, startingRoster);
  arm(g);
  g.suddenT = 179.9;
  run(g, () => ({}), 0.3);
  assert.equal(g.winner, 0, 'a grabless overtime defaults to team 0');
}

// --- br: 30s after the last shrink settles the zone collapses to nothing;
// --- a simultaneous wipe goes to the player with more kills (tie: lower pid) ---
function testBrFinalCollapseAndKillTiebreak() {
  const tiles = [];
  tiles.push('#'.repeat(40));
  for (let y = 1; y < 19; y++) tiles.push('#' + '.'.repeat(38) + '#');
  tiles.push('#'.repeat(40));
  tiles[2] = '#PP' + '.'.repeat(36) + '#';
  const def = {
    name: 'BR Collapse', time: 600, mode: 'br', captiveChars: [],
    br: { shrinks: [{ at: 1, r: 4 }] },
    tiles,
  };
  const party = [0, 1].map(i => ({ pid: i, name: 'P' + i, charId: startingRoster[i] }));
  const g = createGame(def, party, charMap, startingRoster);
  const z = g.zone;
  const [p0, p1] = g.players;
  for (const p of g.players) { p.invuln = 0; p.x = z.x; p.y = z.y; }
  p1.x = z.x + TILE;
  p1.kills = 2; // p1 leads the match scoreboard
  // shrink fires at 1s, settles by 11s at 4 tiles; no collapse before +30s
  run(g, () => ({}), 12);
  assert.equal(z.r, 4 * TILE, 'scheduled shrink settled');
  run(g, () => ({}), 25);
  assert.equal(z.r, 4 * TILE, 'no final collapse during the 30s grace');
  assert.equal(g.status, 'play', 'match still live');
  // grace over (T+41s): continuous 8 px/s collapse
  run(g, () => ({}), 6);
  assert.ok(z.r < 4 * TILE, 'final collapse under way');
  const r1 = z.r;
  run(g, () => ({}), 2);
  assert.ok(Math.abs((r1 - z.r) - 16) < 1, `collapse runs at 8 px/s (closed ${(r1 - z.r).toFixed(1)}px in 2s)`);
  // both survivors sit at the center: once r < 60 everyone burns, and the
  // simultaneous wipe goes to the kill leader
  run(g, () => ({}), 40);
  assert.equal(g.status, 'cleared', 'the collapse always ends the match');
  assert.equal(p0.state, 'out', 'p0 burned');
  assert.equal(p1.state, 'out', 'p1 burned');
  assert.equal(g.winner, 1, 'simultaneous wipe goes to the player with more kills');
  // tie on kills: lower pid
  const g2 = createGame(def, party, charMap, startingRoster);
  const z2 = g2.zone;
  for (const p of g2.players) { p.invuln = 0; p.x = z2.x; p.y = z2.y; }
  g2.players[1].x = z2.x + TILE;
  run(g2, () => ({}), 90);
  assert.equal(g2.status, 'cleared', 'tie run also ends');
  assert.equal(g2.winner, 0, 'kill tie goes to the lower pid');
}

// --- bastion: night waves scale with the squad size (global 90 cap holds) ---
function testBastionWaveScaling() {
  const party4 = [0, 1, 2, 3].map(i => ({ pid: i, name: 'P' + i, charId: startingRoster[i % startingRoster.length] }));
  const g = createGame(bastionDef(), party4, charMap, startingRoster);
  g.graceT = 1e9;
  for (const p of g.players) p.invuln = 999;
  run(g, () => ({}), 5.5); // dusk at 5s
  assert.equal(g.cycle.phase, 'night', 'night 1 fell');
  assert.equal(g.enemies.length, 9, 'night 1 wave for 4P is ceil(6 * 1.4) = 9');
  // duo keeps the original night-1 size exactly (6 * 1.0)
  const party2 = party4.slice(0, 2);
  const g2 = createGame(bastionDef(), party2, charMap, startingRoster);
  g2.graceT = 1e9;
  for (const p of g2.players) p.invuln = 999;
  run(g2, () => ({}), 5.5);
  assert.equal(g2.enemies.length, 6, 'night 1 wave for 2P stays 6 (base x 1.0)');
}

// --- bastion: wave hunters get the deep A* budget for cross-map detours ---
function testBastionDeepWavePathing() {
  // The playtest shape: a serpentine of walls makes the true route to the
  // core ~2900 tiles long — far past the stock 2400 A* budget (an A* must
  // expand at least one node per path tile), but well inside 8000.
  const W = 160, H = 40;
  const tiles = ['#'.repeat(W)];
  for (let y = 1; y < H - 1; y++) {
    if (y % 2 === 0) {
      const gapX = (y / 2) % 2 === 1 ? W - 2 : 1; // gaps hug alternating ends
      tiles.push([...Array(W)].map((_, x) => (x === gapX ? '.' : '#')).join(''));
    } else {
      tiles.push('#' + '.'.repeat(W - 2) + '#');
    }
  }
  tiles.push('#'.repeat(W));
  // grunt in the NW corner, core in the last corridor, player parked east
  tiles[1] = '#g' + '.'.repeat(W - 6) + 'P..#';
  tiles[H - 3] = tiles[H - 3].slice(0, W - 4) + 'K..#';
  const def = { name: 'Serpentine', time: 600, captiveChars: [], tiles };
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  assert.ok(g.core, 'core parsed');
  const e = g.enemies[0];
  e.awake = true;
  e.targetCore = true;
  e.aggro *= 100; // exactly how spawnNightWave arms its hunters
  g.players[0].invuln = 999;
  g.graceT = 0;
  const x0 = e.x, y0 = e.y;
  run(g, () => ({ 0: {} }), 1);
  assert.ok(e.path && e.path.length > 2400, `deep budget finds the cross-map route (${e.path?.length ?? 0} waypoints)`);
  run(g, () => ({ 0: {} }), 10);
  assert.ok(Math.hypot(e.x - x0, e.y - y0) > TILE * 8, 'the hunter marches the detour instead of wedging');
}

// --- chasers that can make no progress kick a repath, then re-sleep ---
function testChaseStuckRepathsThenResleeps() {
  // The player is sealed inside a walled cell: no LoS, no route. A waked
  // grunt must force a repath after 3 stuck seconds and give up (re-sleep
  // in place, like the returning giveup) 3 stuck seconds later. No teleports.
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  const tiles = [];
  tiles.push('#'.repeat(40));
  for (let y = 1; y < 19; y++) tiles.push('#' + '.'.repeat(38) + '#');
  tiles.push('#'.repeat(40));
  // double east wall: the wedge point must sit beyond the 2.2-tile bump-wake
  // range or the sleeper would re-wake on contact forever
  tiles[9] = put(put(put(put(tiles[9], 9, '#'), 10, '#'), 11, '#'), 12, '#');
  tiles[10] = put(put(put(put(tiles[10], 9, '#'), 10, 'P'), 11, '#'), 12, '#');
  tiles[11] = put(put(put(put(tiles[11], 9, '#'), 10, '#'), 11, '#'), 12, '#');
  tiles[10] = put(tiles[10], 16, 'g'); // 6 tiles east of the cell
  const def = { name: 'Sealed Cell', time: 600, captiveChars: [], tiles };
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const e = g.enemies[0];
  e.awake = true;
  g.players[0].invuln = 999;
  g.graceT = 0;
  const x0 = e.x;
  // approach (~3.2s to cross 4 tiles), wedge, 3s stuck -> repath kicked
  run(g, () => ({ 0: {} }), 7.5);
  assert.equal(e.awake, true, 'still trying during the kick window');
  assert.equal(e.chaseKicked, true, 'no-progress chase forced a repath');
  // still pinned 3s after the kick: give up and re-sleep on the spot
  run(g, () => ({ 0: {} }), 4);
  assert.equal(e.awake, false, 'hopeless chase re-sleeps like the returning giveup');
  assert.ok(e.x < x0 && e.x > x0 - TILE * 5, 'the grunt slept where it stood — no teleport');
  // and it stays asleep (no LoS, player beyond bump range)
  run(g, () => ({ 0: {} }), 2);
  assert.equal(e.awake, false, 'stays asleep against the sealed cell');
}

// --- act priority: nearest mount outranks chests; the shop-engage press is consumed ---
function testActPriorityMountShopAndNearestVehicle() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  // chest at 8, stag at 9, second stag at 12 — P walks between them
  r = put(put(put(put(r, 4, 'P'), 8, 'C'), 9, 'V'), 12, 'V');
  const level = bigEmptyLevel([[5, r], [17, '#....................................g#']]);
  level.vehicles = [{ kind: 'stag' }, { kind: 'stag' }];
  level.chests = [{ loot: 'shards', amount: 5 }];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  const p = g.players[0];
  const chest = g.chests[0];
  const [v0, v1] = g.vehicles;
  p.invuln = 999;
  g.graceT = 1e9;
  // both the chest and a stag in reach: the mount wins the press
  p.x = chest.x + TILE * 0.5; p.y = chest.y;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(p.riding, 'v0', 'vehicle mount outranks chest opening');
  assert.equal(chest.opened, false, 'the chest press was not consumed');
  // dismount, then prove NEAREST-vehicle selection (not array order):
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(p.riding ?? null, null, 'dismounted');
  p.x = v1.x + TILE * 0.2; p.y = v1.y; // v1 close, v0 at ~3 tiles (out/farther)
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(p.riding, 'v1', 'act mounts the NEAREST stag in reach');
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30); // dismount again
  // shop engage consumes the press: a chest under the stall stays shut
  let r2 = '#' + '.'.repeat(38) + '#';
  r2 = put(put(put(r2, 4, 'P'), 8, 'C'), 9, 'S');
  const level2 = bigEmptyLevel([[5, r2], [17, '#....................................g#']]);
  level2.chests = [{ loot: 'shards', amount: 5 }];
  const g2 = createGame(level2, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  const q = g2.players[0];
  q.invuln = 999;
  g2.graceT = 1e9;
  q.x = g2.chests[0].x + TILE * 0.5; q.y = g2.chests[0].y;
  step(g2, { 0: {} }, 1 / 30);
  step(g2, { 0: { act: true } }, 1 / 30);
  assert.equal(q.shopping, true, 'the press engaged the stall');
  assert.equal(g2.chests[0].opened, false, 'the engaging press never falls through to the chest');
  step(g2, { 0: { act: true } }, 1 / 30);
  assert.equal(g2.chests[0].opened, false, 'holding act keeps the chest shut');
  // released away from the stall, a fresh press still opens the chest
  q.x = g2.chests[0].x - TILE; // out of the 1.5-tile stall ring, chest in reach
  step(g2, { 0: {} }, 1 / 30);
  step(g2, { 0: { act: true } }, 1 / 30);
  assert.equal(g2.chests[0].opened, true, 'chests still open when no stall claims the press');
}

// --- determinism: identical scripted ctf matches replay snapshot-for-snapshot ---
function testDeterministicCtfRun() {
  const party = [0, 1, 2, 3].map(i => ({ pid: i, name: 'P' + i, charId: startingRoster[i % startingRoster.length] }));
  const runOnce = () => {
    const g = createGame(ctfDef(), party, charMap, startingRoster);
    const dt = 1 / 30;
    const h = [];
    for (let i = 0; i < 600 && g.status === 'play'; i++) {
      const inputs = {};
      for (const p of g.players) {
        inputs[p.pid] = {
          right: p.team === 0 && (i % 40) < 30,
          left: p.team === 1 && (i % 40) < 30,
          down: p.pid < 2 && (i % 60) < 20,
          up: p.pid >= 2 && (i % 60) < 20,
          fire: (i % 7) < 3,
          special: (i % 90) === 10 + p.pid,
          act: (i % 50) < 8,
          item: (i % 110) === 30 + p.pid,
        };
      }
      step(g, inputs, dt);
      if (i % 20 === 0) h.push(JSON.stringify(snapshot(g, false)));
    }
    return h.join('\n');
  };
  assert.ok(runOnce() === runOnce(), 'two identical scripted ctf matches produce identical snapshot streams');
}

testRespawnPickFlow();
testEnemyPathsAroundBuiltPylon();
testStructureRepairUpgradeDismantle();
testTurretLevels();
testGateTimeLock();
testDarkAggroShrink();
testDarkSightCap();
testDarkSnapshotFlag();
testWaveSpawnTimingAndPlacement();
testWaveEdgeBands();
testWaveFiresOnce();
testWaveRespectsGlobalCap();
testPlayerHpShieldFlow();
testArcadeStaysOneHit();
testItemMedkitAndShield();
testCrackerLureAndBoom();
testChestLootAndPriority();
testBastionCycleWavesAndWin();
testCoreSiegeAndLoss();
testMutantDeathEffects();
testFarmGrowHarvestTrample();
testParseNewLetters();
testDeterministicBastionRun();
testContactDamageNonArcade();
testTowerOccupyAndFire();
testTowerSiegeRepairRebuild();
testShopCarousel();
testHireJobs();
testVehicleStag();
testVehicleSkiff();
testCtfMatch();
testCtfTimerAndSuddenDeath();
testBrZoneAndWinner();
testCtfTeamShardPools();
testPvpAoeStimAndKillCredit();
testCtfFlagDropOnMount();
testCtfSuddenDeathCap();
testBrFinalCollapseAndKillTiebreak();
testBastionWaveScaling();
testBastionDeepWavePathing();
testChaseStuckRepathsThenResleeps();
testActPriorityMountShopAndNearestVehicle();
testDeterministicCtfRun();

console.log('sim tests passed');
