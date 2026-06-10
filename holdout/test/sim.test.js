import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { applyResults, charsById, createGame, parseLevel, step, TILE } from '../shared/game.js';

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
  assert.equal(levels.length, 10, 'campaign should contain 10 levels');
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

testLevelsParse();
testEveryCharacterCanKill();
testNewEnemiesCanDownPlayer();
testRescueAndPermanentLossRules();
testScriptedBotClearsLevelOne();

console.log('sim tests passed');
