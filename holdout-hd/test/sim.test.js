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
  assert.equal(levels.length, 11, 'campaign should contain 11 levels (10 classic + 1 expedition)');
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
  // a wall splits the room; the enemy must route around the gap at the bottom
  const rows = [];
  rows.push('#'.repeat(40));
  for (let y = 1; y < 19; y++) {
    let r = '#' + '.'.repeat(38) + '#';
    if (y >= 1 && y <= 15) r = r.slice(0, 20) + '#' + r.slice(21);
    rows.push(r);
  }
  rows.push('#'.repeat(40));
  rows[3] = '#P' + rows[3].slice(2);
  // skitter: fast enough to finish the ~54-tile detour within the test budget
  rows[3] = rows[3].slice(0, 30) + 'w' + rows[3].slice(31);
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

function testExpeditionMapIntegrity() {
  const def = levels.find(l => l.expedition);
  assert.ok(def, 'an expedition level exists');
  const parsed = parseLevel(def);
  assert.ok(parsed.w * parsed.h > 600, 'expedition map is big enough for the journey camera');
  assert.ok(parsed.spawns.length >= 4, 'expedition supports 4 players');
  assert.ok(parsed.captives.length >= 6, 'expedition carries rescuable characters');
  assert.ok(def.tiles.some(r => r.includes('E')), 'expedition has an exit');
  // walkable connectivity from spawn to exit and every captive
  const pass = c => c !== '#' && c !== '~' && c !== 'o';
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
  for (let y = 0; y < parsed.h; y++)
    for (let x = 0; x < parsed.w; x++)
      if (parsed.grid[y][x] === 'E') assert.ok(seen.has(x + ',' + y), `exit at ${x},${y} reachable`);
  for (const c of parsed.captives) {
    const k = Math.floor(c.x / TILE) + ',' + Math.floor(c.y / TILE);
    assert.ok(seen.has(k), `captive ${c.charId} reachable`);
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
  step(g, { 0: {}, 1: {} }, 1 / 30);
  const a = g.players[0];
  assert.equal(a.state, 'active', 'player respawned');
  const d = Math.hypot(a.x - g.players[1].x, a.y - g.players[1].y);
  assert.ok(d < TILE * 6, `respawn lands beside the living teammate (${Math.round(d / TILE)} tiles away)`);
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
testExpeditionMapIntegrity();
testArcadeSpawnCapsPreserved();
testEnemiesShootAcrossWater();
testPickupOwnerPidZeroNotStolen();
testRespawnNearTeammateOnBigMap();

console.log('sim tests passed');
