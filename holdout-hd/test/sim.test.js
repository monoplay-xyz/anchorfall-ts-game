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
    assert.ok(level.tiles.every(r => r.length === w), `level ${idx + 1} rows have equal width`);
    assert.ok(level.tiles.some(r => r.includes('P')), `level ${idx + 1} has a spawn`);
    assert.ok(level.tiles.some(r => /[garsmnb]/.test(r)), `level ${idx + 1} has enemies`);
    for (const id of level.captiveChars || []) {
      assert.ok(validChars.has(id), `${id} is a valid captive character`);
      captiveIds.add(id);
    }
    const parsed = parseLevel(level);
    assert.ok(parsed.spawns.length > 0, `level ${idx + 1} parses spawns`);
    assert.ok(parsed.enemies.length > 0, `level ${idx + 1} parses enemies`);
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
    assert.ok(parsed.spawns.length >= 2, `${tag}: at least 2 spawns`);
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

function testDismantleBuiltStructure() {
  const rows = [];
  rows.push('#'.repeat(30));
  for (let y = 1; y < 9; y++) rows.push('#' + '.'.repeat(28) + '#');
  rows.push('#'.repeat(30));
  rows[4] = '#P..B.....................g..#';
  const level = {
    name: 'Dismantle', time: 60, captiveChars: [],
    builds: [{ kind: 'barricade', cost: 4 }],
    tiles: rows,
  };
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.shards = 10;
  const p = g.players[0];
  p.invuln = 999;
  const site = g.builds[0];
  p.x = site.x - TILE; p.y = site.y;
  run(g, () => ({ 0: { act: true } }), 4);
  assert.ok(site.built, 'barricade built');
  const shardsBefore = g.shards;
  // keep holding act: with no enemies near (grunt is 20+ tiles away, asleep),
  // the structure dismantles after ~2s and refunds half its cost. Release act
  // the moment it drops, or the same hold would immediately rebuild it.
  run(g, () => ({ 0: { act: site.built } }), 3);
  assert.equal(site.built, false, 'holding act dismantles the structure');
  assert.equal(g.shards, shardsBefore + 2, 'dismantle refunds half the cost');
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

testRespawnPickFlow();
testEnemyPathsAroundBuiltPylon();
testDismantleBuiltStructure();
testGateTimeLock();
testDarkAggroShrink();
testDarkSightCap();
testDarkSnapshotFlag();
testWaveSpawnTimingAndPlacement();
testWaveEdgeBands();
testWaveFiresOnce();
testWaveRespectsGlobalCap();

console.log('sim tests passed');
