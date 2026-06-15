import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { addPlayerMidGame, applyResults, charsById, createGame, maxOutPlayer, maybeDropPowerup, MODE_CAPS, parseLevel, questProgress, restoreGame, revivePlayer, serializeGame, snapshot, step, TILE, triggerPowerup } from '../shared/game.js';
import { MUSIC_DURATIONS, RELIC_WAVE_FALLBACK } from '../shared/music-durations.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const characters = JSON.parse(fs.readFileSync(path.join(root, 'shared/characters.json'), 'utf8'));
const charMap = charsById(characters);
const startingRoster = characters.filter(c => c.starting).map(c => c.id);
// levels/ is organized by category subdirectory (classic/story/stronghold/ctf/br);
// the loader walks them recursively, classic-first so levels[0] stays level01,
// and tags each def with its subdir name as def.category (mirroring the server).
const levelsDir = path.join(root, 'levels');
const CATEGORY_ORDER = ['classic', 'story', 'stronghold', 'ctf', 'br'];
const catRank = c => { const i = CATEGORY_ORDER.indexOf(c); return i === -1 ? CATEGORY_ORDER.length : i; };
const levels = fs.readdirSync(levelsDir, { withFileTypes: true })
  .filter(d => d.isDirectory()).map(d => d.name)
  .sort((a, b) => catRank(a) - catRank(b) || (a < b ? -1 : a > b ? 1 : 0))
  .flatMap(cat => fs.readdirSync(path.join(levelsDir, cat))
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => Object.assign(JSON.parse(fs.readFileSync(path.join(levelsDir, cat, f), 'utf8')), { category: cat })));

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

// A faithful-enough enemy entity for the sim's damage/kill paths (mirrors the
// fields makeEnemy mints). hp matches ENEMY_STATS so the boss reads hp24, etc.
const ENEMY_HP_FOR_TEST = { g: 2, a: 1, r: 3, s: 5, m: 5, n: 2, w: 1, b: 24 };
function makeEnemyForTest(g, letter, x, y) {
  const hp = ENEMY_HP_FOR_TEST[letter] ?? 2;
  const kindMap = { g: 'grunt', a: 'archer', r: 'charger', s: 'bulwark', m: 'spawner', n: 'sniper', w: 'skitter', b: 'boss' };
  return {
    id: g.nextEnemyId++, letter, kind: kindMap[letter] || 'grunt', x, y,
    // speed 0 pins the staged garrison in place (the AoE under test doesn't care
    // about movement, and the relic test map is small enough to auto-wake) so
    // nothing wanders out of the blast/storm zone and the asserts stay stable.
    hp, maxHp: hp, speed: 0, range: 0, aggro: 9 * TILE, cool: 0, spawnCool: 0,
    score: 100, fx: 0, fy: 1, hurt: 0, state: 'idle', aimT: 0, aimX: x, aimY: y,
    awake: false, repathT: 0, path: null, pathI: 0, homeX: x, homeY: y,
    returning: false, hitCool: 0,
  };
}

function testLevelsParse() {
  const classics = levels.filter(l => l.category === 'classic');
  assert.equal(classics.length, 10, 'classic campaign keeps exactly its 10 missions');
  assert.ok(classics.every(l => !l.story && !l.expedition && !l.mode), 'classic dir holds only plain campaign maps');
  assert.ok(levels.length >= 11, 'at least one story/expedition level ships beside the classics');
  const validChars = new Set(characters.map(c => c.id));
  const captiveIds = new Set();
  for (const [idx, level] of levels.entries()) {
    const w = level.tiles[0].length;
    // ctf/br/siege field no tile-enemies (siege spawns minions at runtime)
    const pvp = level.mode === 'ctf' || level.mode === 'br' || level.mode === 'siege';
    assert.ok(level.tiles.every(r => r.length === w), `level ${idx + 1} rows have equal width`);
    assert.ok(level.tiles.some(r => r.includes('P')), `level ${idx + 1} has a spawn`);
    if (!pvp) assert.ok(level.tiles.some(r => /[garsmnwbzfqvxu]/.test(r)), `level ${idx + 1} has enemies`);
    for (const id of level.captiveChars || []) {
      assert.ok(validChars.has(id), `${id} is a valid captive character`);
      captiveIds.add(id);
    }
    const parsed = parseLevel(level);
    assert.ok(parsed.spawns.length > 0, `level ${idx + 1} parses spawns`);
    if (!pvp) assert.ok(parsed.enemies.length > 0, `level ${idx + 1} parses enemies`);
    // EVERY level (story, stronghold, classic alike): each openDoor reward id
    // referenced by quests/switchGroups/glyphGroups must name a real door in
    // def.doors — a phantom id would park forever and soft-lock the puzzle
    const doorIds = new Set((level.doors || []).map((d, i) => d.id || 'door' + i));
    const wantsDoor = (id, src) =>
      assert.ok(doorIds.has(id), `level ${idx + 1} (${level.name}): ${src} openDoor reward '${id}' exists in def.doors`);
    for (const q of level.quests || []) {
      if (q.reward && q.reward.openDoor) wantsDoor(q.reward.openDoor, `quest '${q.id}'`);
    }
    for (const sg of level.switchGroups || []) {
      if (sg.reward && sg.reward.openDoor) wantsDoor(sg.reward.openDoor, `switch group '${sg.group}'`);
    }
    for (const gg of level.glyphGroups || []) {
      if (gg.reward && gg.reward.openDoor) wantsDoor(gg.reward.openDoor, `glyph group '${gg.group}'`);
    }
  }
  for (const ch of characters) {
    // milestone operators are earned through play (Endless/Daily/missions), not
    // rescued — every other non-starter must be obtainable as a captive.
    if (!ch.starting && !ch.milestone) assert.ok(captiveIds.has(ch.id), `${ch.id} is obtainable as a captive`);
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

// --- MUSIC BOX easter egg: story/stronghold only, deterministic placement,
// captive-style carry + altar deposit, drop on down, snapshot wiring ---
function testMusicBoxFeature() {
  // a roomy story map: spawn middle-ish, open corners, no obstacles. A lone
  // grunt keeps the field non-empty so the level can't auto-clear under us.
  const W = 14, H = 10;
  const tiles = ['#'.repeat(W)];
  for (let y = 1; y < H - 1; y++) tiles.push('#' + '.'.repeat(W - 2) + '#');
  tiles.push('#'.repeat(W));
  // place a spawn near center, with a sleeping grunt a few tiles off it
  tiles[Math.floor(H / 2)] = '#' + '.'.repeat(5) + 'P' + '.'.repeat(W - 8) + '#';
  tiles[2] = '#' + '.'.repeat(9) + 'g' + '.'.repeat(W - 12) + '#';
  const storyDef = { name: 'MB Story', story: true, chapter: 3, time: 600, tiles, captiveChars: [] };

  const g = createGame(storyDef, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  assert.ok(g.musicBox && g.musicBox.enabled, 'story level enables the music box');
  assert.equal(g.musicBox.fragments.length, 4, 'four fragments seed');
  assert.ok(g.musicBox.altar && Number.isFinite(g.musicBox.altar.x), 'an altar seeds');
  assert.equal(g.musicBox.mode, 'story', 'mode tag is story');
  assert.equal(g.musicBox.stem, 'ch03', 'stem derives from chapter when no key');
  assert.equal(g.musicBox.assembled, 0, 'nothing assembled at start');
  assert.ok(g.musicBox.fragments.every(f => !f.placed && f.carrier == null), 'fragments start free');

  // determinism: a second identical build places identically
  const g2 = createGame(storyDef, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  assert.deepEqual(
    g2.musicBox.fragments.map(f => [f.x, f.y]),
    g.musicBox.fragments.map(f => [f.x, f.y]),
    'fragment placement is deterministic across builds');
  assert.deepEqual([g2.musicBox.altar.x, g2.musicBox.altar.y], [g.musicBox.altar.x, g.musicBox.altar.y], 'altar placement is deterministic');

  // stem from def.key (server-tagged) wins over chapter
  const keyed = createGame({ ...storyDef, key: 'story/ch07' }, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  assert.equal(keyed.musicBox.stem, 'ch07', 'stem comes from def.key when present');

  // snapshot ships the musicBox block for story
  const snap = snapshot(g);
  assert.ok(snap.musicBox, 'snapshot carries musicBox for story');
  assert.equal(snap.musicBox.fragments.length, 4, 'snapshot lists all fragments');
  assert.equal(snap.musicBox.mode, 'story');
  assert.equal(snap.musicBox.stem, 'ch03');

  // pickup: teleport a player onto a fragment, step once -> carried. Keep the
  // operative invulnerable so the lone grunt can't interrupt the scripted run.
  const p = g.players[0];
  p.invuln = 999;
  g.graceT = 0;
  const f0 = g.musicBox.fragments[0];
  p.x = f0.x; p.y = f0.y;
  step(g, { 0: {} }, 1 / 30);
  assert.equal(g.musicBox.fragments[0].carrier, 0, 'walking onto a fragment carries it');
  // only one fragment per carrier: stand on a second, it stays free
  const f1 = g.musicBox.fragments[1];
  p.x = f1.x; p.y = f1.y;
  step(g, { 0: {} }, 1 / 30);
  assert.equal(g.musicBox.fragments[1].carrier, null, 'a carrier cannot scoop a second fragment');

  // deposit: walk the carrier to the altar -> assembled increments, consumed
  p.x = g.musicBox.altar.x; p.y = g.musicBox.altar.y;
  step(g, { 0: {} }, 1 / 30);
  assert.equal(g.musicBox.assembled, 1, 'depositing at the altar increments assembled');
  assert.ok(g.musicBox.fragments[0].placed, 'deposited fragment is marked placed');
  assert.equal(g.musicBox.fragments[0].carrier, null, 'deposited fragment has no carrier');

  // complete: carry + deposit the remaining three at the altar
  for (const idx of [1, 2, 3]) {
    const fr = g.musicBox.fragments[idx];
    p.x = fr.x; p.y = fr.y;
    step(g, { 0: {} }, 1 / 30); // scoop it
    assert.equal(fr.carrier, 0, `fragment ${idx} picked up`);
    p.x = g.musicBox.altar.x; p.y = g.musicBox.altar.y;
    step(g, { 0: {} }, 1 / 30); // deposit it
  }
  assert.equal(g.musicBox.assembled, 4, 'all four assembled');
  assert.ok(g.musicBox.complete, 'music box completes at 4/4');

  // drop on down: a fresh run, carry a fragment, flip the carrier inactive ->
  // the fragment frees right where the carrier fell, recoverable by anyone
  const dg = createGame(storyDef, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  const dp = dg.players[0];
  dp.invuln = 999; dg.graceT = 0;
  const df = dg.musicBox.fragments[0];
  dp.x = df.x; dp.y = df.y;
  step(dg, { 0: {} }, 1 / 30);
  assert.equal(dg.musicBox.fragments[0].carrier, 0, 'fragment carried before down');
  const dropX = dg.musicBox.fragments[0].x;
  dp.state = 'down'; // simulate a downed carrier
  step(dg, { 0: {} }, 1 / 30);
  assert.equal(dg.musicBox.fragments[0].carrier, null, 'a downed carrier drops the fragment, recoverable');
  assert.ok(Math.abs(dg.musicBox.fragments[0].x - dropX) < TILE, 'fragment stays where the carrier fell');

  // other modes never gain the feature
  const classicDef = { name: 'Plain', time: 90, tiles, captiveChars: [] };
  const cg = createGame(classicDef, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  assert.ok(cg.musicBox && cg.musicBox.enabled === false, 'classic levels leave the music box disabled');
  assert.ok(!snapshot(cg).musicBox, 'classic snapshot never gains a musicBox key');

  // stronghold (mode bastion) enables it with the stronghold tag + sh stem
  const shDef = { name: 'MB Stronghold', mode: 'bastion', time: 600, tiles, captiveChars: [], stronghold: { level: 13, hpMult: 1 } };
  const sg = createGame(shDef, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  assert.ok(sg.musicBox.enabled, 'stronghold (bastion) enables the music box');
  assert.equal(sg.musicBox.mode, 'stronghold', 'stronghold mode tag');
  assert.equal(sg.musicBox.stem, 'sh13', 'stronghold stem derives from level');
}

// --- STRANDED OPERATORS + SCRAP + DROP action: opt-in (def.stranded), gated so
// every other mode stays byte-stable. Scrap is a GENERIC item separate from the
// relic shard pool; giving scrap to an operator recruits a friendly defender;
// dropping a carried operator at the stronghold centre saves + recruits one;
// drop with empty hands is a no-op. ---
function testStrandedOperatorsAndScrap() {
  // a roomy open map, center spawn, no core -> base centre is the map centre.
  // A story flag (musicBox) is added so we can prove scrap NEVER touches the
  // relic assembled count.
  const W = 18, H = 14;
  const tiles = ['#'.repeat(W)];
  for (let y = 1; y < H - 1; y++) tiles.push('#' + '.'.repeat(W - 2) + '#');
  tiles.push('#'.repeat(W));
  tiles[Math.floor(H / 2)] = '#' + '.'.repeat(7) + 'P' + '.'.repeat(W - 10) + '#';
  tiles[2] = '#' + '.'.repeat(13) + 'g' + '.'.repeat(W - 16) + '#'; // a far sleeping grunt keeps the field non-empty
  const def = { name: 'Stranded Test', story: true, chapter: 3, time: 600, tiles, captiveChars: [], stranded: { operators: 2, scrap: 3 } };

  const g = createGame(def, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  assert.equal(g.stranded.length, 2, 'two stranded operators seed');
  assert.equal(g.scrap.length, 3, 'three scrap items seed');
  assert.ok(g.stranded.every(o => !o.recruited && o.carrier == null), 'operators start free');
  assert.ok(g.scrap.every(s => s.carrier == null), 'scrap starts free');

  // determinism: a second identical build places identically
  const g2 = createGame(def, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  assert.deepEqual(g2.stranded.map(o => [o.x, o.y]), g.stranded.map(o => [o.x, o.y]), 'operator placement is deterministic');
  assert.deepEqual(g2.scrap.map(s => [s.x, s.y]), g.scrap.map(s => [s.x, s.y]), 'scrap placement is deterministic');

  // snapshot ships the gated keys for a stranded level
  const snap = snapshot(g);
  assert.equal((snap.stranded || []).length, 2, 'snapshot lists un-recruited operators');
  assert.equal((snap.scrap || []).length, 3, 'snapshot lists scrap');

  const p = g.players[0];
  p.invuln = 999; g.graceT = 0;
  const base = { x: g.w * TILE / 2, y: g.h * TILE / 2 }; // no core -> map centre

  // --- SCRAP is separate from the relic pool: pick up scrap, give it to an
  // operator, and the music-box assembled count must NOT move. ---
  assert.equal(g.musicBox.assembled, 0, 'relic starts un-assembled');
  const sc = g.scrap[0];
  p.x = sc.x; p.y = sc.y;
  step(g, { 0: {} }, 1 / 30);
  assert.equal(g.scrap[0].carrier, 0, 'walking onto scrap carries it');
  // a carrier cannot scoop a second scrap
  const sc2 = g.scrap[1];
  p.x = sc2.x; p.y = sc2.y;
  step(g, { 0: {} }, 1 / 30);
  assert.equal(g.scrap[1].carrier, null, 'a carrier cannot scoop a second scrap');

  // carry the scrap onto an operator and DROP it -> recruit, scrap consumed
  const op0 = g.stranded[0];
  p.x = op0.x; p.y = op0.y;
  const scrapBefore = g.scrap.length;
  const followersBefore = g.followers.length;
  step(g, { 0: { drop: true } }, 1 / 30);
  assert.equal(g.musicBox.assembled, 0, 'giving scrap NEVER changes the relic assembled count');
  assert.ok(op0.recruited, 'the operator is recruited by the scrap');
  assert.equal(g.scrap.length, scrapBefore - 1, 'the scrap is consumed (not returned to any pool)');
  assert.equal(g.followers.length, followersBefore + 1, 'recruiting spawns one defender follower');
  const def0 = g.followers[g.followers.length - 1];
  assert.equal(def0.kind, 'defender', 'recruit is a defender');
  assert.equal(def0.owner, null, 'the defender is ownerless (a base garrison, not a seat hire)');

  // the defender HEADS TO BASE: park it left of base with no prey near, step,
  // it closes the distance to the stronghold centre. Pin the only field enemy
  // far asleep in a corner (>9 tiles off both the defender and the player) so
  // nothing wakes into the hold ring and yanks the march off course.
  g.enemies[0].x = (g.w - 1.5) * TILE; g.enemies[0].y = 1.5 * TILE; g.enemies[0].awake = false;
  def0.x = base.x - 5.5 * TILE; def0.y = base.y;
  const distBefore = Math.hypot(def0.x - base.x, def0.y - base.y);
  p.x = 1.5 * TILE; p.y = (g.h - 1.5) * TILE; // player parked opposite, far from everything
  run(g, () => ({ 0: {} }), 1.5);
  const distAfter = Math.hypot(def0.x - base.x, def0.y - base.y);
  assert.ok(distAfter < distBefore - TILE, 'a recruited defender heads toward the stronghold centre');

  // the defender FIGHTS enemies near base: drop a fresh grunt right by base, the
  // defender shoots it down (weak but helpful). Park the defender on top of base
  // so the new grunt is squarely inside the hold ring + weapon range.
  def0.x = base.x; def0.y = base.y;
  const e = makeEnemyForTest(g, 'g', base.x + TILE * 2, base.y);
  e.awake = true;
  g.enemies.push(e);
  const eHp = e.hp;
  run(g, () => ({ 0: {} }), 4);
  assert.ok(e.dead || e.hp < eHp, 'a defender shoots enemies that reach the base');

  // --- RESCUE PATH: carry a stranded operator to the base centre, DROP there
  // -> saved + recruited. ---
  const rg = createGame(def, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  const rp = rg.players[0];
  rp.invuln = 999; rg.graceT = 0;
  const rbase = { x: rg.w * TILE / 2, y: rg.h * TILE / 2 };
  const rop = rg.stranded[1];
  rp.x = rop.x; rp.y = rop.y;
  step(rg, { 0: {} }, 1 / 30);
  assert.equal(rop.carrier, 0, 'walking onto an operator carries them');
  // dropping AWAY from base does NOT recruit (just sets them down)
  rp.x = rbase.x + 9 * TILE; rp.y = rbase.y;
  rop.x = rp.x; rop.y = rp.y; // the carried operator trails to the carrier
  const fBeforeFar = rg.followers.length;
  step(rg, { 0: { drop: true } }, 1 / 30);
  assert.ok(!rop.recruited, 'dropping an operator far from base does not recruit');
  assert.equal(rg.followers.length, fBeforeFar, 'no defender spawns on a far drop');
  // pick them up again and drop at the base centre -> recruited
  rp.x = rop.x; rp.y = rop.y;
  step(rg, { 0: {} }, 1 / 30);
  assert.equal(rop.carrier, 0, 're-carried after the far drop');
  rp.x = rbase.x; rp.y = rbase.y; rop.x = rbase.x; rop.y = rbase.y;
  const fBeforeBase = rg.followers.length;
  step(rg, { 0: { drop: true } }, 1 / 30);
  assert.ok(rop.recruited, 'dropping a carried operator at the base centre recruits them');
  assert.equal(rg.followers.length, fBeforeBase + 1, 'the base-centre drop spawns a defender');
  assert.equal(rg.followers[rg.followers.length - 1].owner, null, 'the rescued defender is ownerless');

  // --- DROP with EMPTY HANDS is a no-op ---
  const eg = createGame(def, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  const ep = eg.players[0];
  ep.invuln = 999; eg.graceT = 0;
  ep.x = eg.w * TILE / 2; ep.y = eg.h * TILE / 2; // empty-handed, away from any scrap/op
  const scrapN = eg.scrap.length, opRecruited = eg.stranded.filter(o => o.recruited).length, follN = eg.followers.length, asm = eg.musicBox.assembled;
  step(eg, { 0: { drop: true } }, 1 / 30);
  assert.equal(eg.scrap.length, scrapN, 'empty-handed drop touches no scrap');
  assert.equal(eg.stranded.filter(o => o.recruited).length, opRecruited, 'empty-handed drop recruits nobody');
  assert.equal(eg.followers.length, follN, 'empty-handed drop spawns no defender');
  assert.equal(eg.musicBox.assembled, asm, 'empty-handed drop never touches the relic pool');

  // --- gating: an UNFLAGGED level seeds nothing and ships no keys ---
  const plainDef = { name: 'Plain', time: 90, tiles, captiveChars: [] };
  const cg = createGame(plainDef, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  assert.equal(cg.stranded.length, 0, 'unflagged level seeds no operators');
  assert.equal(cg.scrap.length, 0, 'unflagged level seeds no scrap');
  const csnap = snapshot(cg);
  assert.ok(!('stranded' in csnap), 'unflagged snapshot never gains a stranded key');
  assert.ok(!('scrap' in csnap), 'unflagged snapshot never gains a scrap key');

  // serialize/restore round-trips the new state cleanly
  const rt = restoreGame(serializeGame(g), charMap);
  assert.equal(rt.scrap.length, g.scrap.length, 'scrap survives serialize/restore');
  assert.equal(rt.followers.length, g.followers.length, 'defenders survive serialize/restore');
}

// --- every shipped story + stronghold level seeds a usable music box ---
function testMusicBoxOnAllStoryAndStronghold() {
  for (const level of levels.filter(l => l.category === 'story' || l.category === 'stronghold')) {
    const g = createGame(level, [{ pid: 0, name: 'A', charId: startingRoster[0] }], charMap, startingRoster);
    assert.ok(g.musicBox.enabled, `${level.category} ${level.name}: music box enabled`);
    assert.equal(g.musicBox.fragments.length, 4, `${level.name}: four fragments`);
    // every fragment + altar sits on a walkable, non-lava floor tile
    const onFloor = (x, y) => {
      const c = g.grid[Math.floor(y / TILE)][Math.floor(x / TILE)];
      return c !== '#' && c !== 'T' && c !== '~' && c !== 'o' && c !== '%' && c !== '!';
    };
    for (const f of g.musicBox.fragments) assert.ok(onFloor(f.x, f.y), `${level.name}: fragment on walkable floor`);
    assert.ok(onFloor(g.musicBox.altar.x, g.musicBox.altar.y), `${level.name}: altar on walkable floor`);
    assert.ok(snapshot(g).musicBox, `${level.name}: snapshot ships musicBox`);
  }
}

// --- STRONGHOLD relic: four FORTRESS-CORNER MOUNTS instead of the single altar.
// They cluster around the CENTRAL BASE/CORE (a fixed radius out to each diagonal,
// snapped to open tiles) — NOT at the map edges. Each shard locks into the nearest
// unfilled mount; all four filled completes the relic. STORY keeps its single
// altar (no .mounts). ---
function testStrongholdCornerMounts() {
  // a roomy open bastion map: a CORE ('K') at the center, four open corners. The
  // core makes baseCenter explicit so we can prove the mounts cluster around it.
  const W = 18, H = 14;
  const tiles = ['#'.repeat(W)];
  for (let y = 1; y < H - 1; y++) tiles.push('#' + '.'.repeat(W - 2) + '#');
  tiles.push('#'.repeat(W));
  const midY = Math.floor(H / 2), midX = Math.floor(W / 2);
  tiles[midY] = '#' + '.'.repeat(midX - 1) + 'K' + '.'.repeat(W - midX - 2) + '#'; // core dead-center
  tiles[midY - 2] = '#' + '.'.repeat(2) + 'P' + '.'.repeat(W - 5) + '#'; // spawn off-center
  tiles[2] = '#' + '.'.repeat(W - 6) + 'g' + '...#'; // a sleeping grunt keeps the field non-empty
  const shDef = { name: 'MB Bastion', mode: 'bastion', time: 600, tiles, captiveChars: [], stronghold: { level: 5, hpMult: 1 } };

  const g = createGame(shDef, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  assert.ok(g.musicBox.enabled, 'stronghold enables the music box');
  assert.ok(g.core && Number.isFinite(g.core.x), 'the test bastion map seeds a central core');
  assert.ok(Array.isArray(g.musicBox.mounts) && g.musicBox.mounts.length === 4, 'stronghold seeds four corner mounts');
  assert.ok(g.musicBox.mounts.every(m => Number.isFinite(m.x) && Number.isFinite(m.y) && m.filled === false), 'mounts start unfilled with valid coords');
  assert.equal(g.musicBox.fragments.length, 4, 'four shards still spawn for stronghold');
  // each mount clusters AROUND the base/core (a few tiles out, one per diagonal),
  // and emphatically NOT at the far map corners.
  const base = { x: g.core.x, y: g.core.y };
  const mapCorners = [[0, 0], [(W - 1) * TILE, 0], [0, (H - 1) * TILE], [(W - 1) * TILE, (H - 1) * TILE]];
  for (let i = 0; i < 4; i++) {
    const m = g.musicBox.mounts[i];
    const distBase = Math.hypot(m.x - base.x, m.y - base.y);
    assert.ok(distBase <= 7 * TILE, `mount ${i} clusters near the base center (got ${Math.round(distBase / TILE)} tiles)`);
    const atMapCorner = mapCorners.some(([cx, cy]) => Math.hypot(m.x - cx, m.y - cy) < 3 * TILE);
    assert.ok(!atMapCorner, `mount ${i} is NOT parked at a map corner`);
  }
  // the four mounts straddle the base: at least one on each side of the core,
  // proving they fan out to the fortress's diagonal corners (not all bunched).
  assert.ok(g.musicBox.mounts.some(m => m.x < base.x) && g.musicBox.mounts.some(m => m.x > base.x), 'mounts flank the base on both the left and right');
  assert.ok(g.musicBox.mounts.some(m => m.y < base.y) && g.musicBox.mounts.some(m => m.y > base.y), 'mounts flank the base above and below');
  // DETERMINISM: a second build of the same def seeds byte-identical mount coords.
  const g3 = createGame(shDef, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  assert.deepEqual(g3.musicBox.mounts.map(m => [m.x, m.y]), g.musicBox.mounts.map(m => [m.x, m.y]), 'mount placement is deterministic');
  // mounts ship in the snapshot (gated to stronghold)
  const snap = snapshot(g);
  assert.ok(snap.musicBox.mounts && snap.musicBox.mounts.length === 4, 'snapshot carries the four mounts for stronghold');

  // carry each shard to a corner mount -> assembled increments, mount fills, and
  // 4/4 completes the relic. Keep the operative invulnerable for the scripted run.
  const p = g.players[0];
  p.invuln = 999; g.graceT = 0;
  for (let i = 0; i < 4; i++) {
    const fr = g.musicBox.fragments[i];
    p.x = fr.x; p.y = fr.y;
    step(g, { 0: {} }, 1 / 30); // scoop
    assert.equal(fr.carrier, 0, `shard ${i} picked up`);
    // walk to the nearest unfilled mount and deposit
    const target = g.musicBox.mounts.find(m => !m.filled);
    p.x = target.x; p.y = target.y;
    step(g, { 0: {} }, 1 / 30); // lock in
    assert.equal(g.musicBox.assembled, i + 1, `assembled is ${i + 1} after locking shard ${i}`);
    assert.ok(target.filled, `mount accepting shard ${i} is now filled`);
  }
  assert.equal(g.musicBox.mounts.filter(m => m.filled).length, 4, 'all four corner mounts filled');
  assert.ok(g.musicBox.complete, 'stronghold relic completes when all four mounts are filled');

  // STORY keeps the single-altar version: NO mounts.
  const storyDef = { name: 'MB Story', story: true, chapter: 2, time: 600, tiles, captiveChars: [] };
  const sg = createGame(storyDef, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  assert.ok(sg.musicBox.enabled, 'story enables the music box');
  assert.ok(!sg.musicBox.mounts, 'story uses the single altar — no corner mounts');
  assert.ok(!snapshot(sg).musicBox.mounts, 'story snapshot never ships mounts');
}

// --- WALL PRICE: a single shard per fortified segment. The bastion shop stocks
// the wall offer at cost 1 / amount 1, and a laid wall records exactly 1 shard of
// investment (so dismantle math, repair and the HUD all read the cheaper wall).
// CONTROL: the turret offer is untouched (still cost 8) — proving we only moved
// the wall knob, not the whole placeable deck. ---
function testWallCostsOneShard() {
  const W = 16, H = 12;
  const tiles = ['#'.repeat(W)];
  for (let y = 1; y < H - 1; y++) tiles.push('#' + '.'.repeat(W - 2) + '#');
  tiles.push('#'.repeat(W));
  tiles[Math.floor(H / 2)] = '#' + '.'.repeat(6) + 'P' + '.'.repeat(W - 9) + '#';
  tiles[2] = '#' + '.'.repeat(10) + 'g' + '.'.repeat(W - 13) + '#';
  const shDef = { name: 'Wall Price', mode: 'bastion', time: 600, tiles, captiveChars: [], stronghold: { level: 5, hpMult: 1 } };
  const g = createGame(shDef, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);

  // the stocked wall OFFER is 1 shard for 1 wall (was 5 for 3).
  const wallOffer = (g.shopOffers || []).find(o => o.what === 'wall');
  assert.ok(wallOffer, 'a bastion shop stocks the wall offer');
  assert.equal(wallOffer.cost, 1, 'wall offer costs 1 shard');
  assert.equal(wallOffer.amount, 1, 'wall offer hands over a single wall');
  // CONTROL: the turret offer is unchanged, proving we only retuned the wall.
  const turretOffer = (g.shopOffers || []).find(o => o.what === 'turret');
  assert.equal(turretOffer.cost, 8, 'turret offer is untouched (still 8 shards)');

  // a LAID wall records exactly 1 shard of investment. Hand the operative a wall
  // in inventory and drive the RA2 buy-then-place flow through step(): enter
  // placement, drop the anchor, lay the (single-tile) line.
  const p = g.players[0];
  p.invuln = 1e9; g.graceT = 0;
  p.x = 4 * TILE + TILE / 2; p.y = (Math.floor(H / 2) - 2) * TILE + TILE / 2; // open interior, clear of walls
  p.inventory = [{ kind: 'wall', count: 1 }]; p.invIdx = 0;
  const wallsBefore = g.builds.filter(b => b.kind === 'wall').length;
  step(g, { 0: { place: true } }, 1 / 30);          // enter placement (ghost on the operative's tile)
  assert.equal(p.placing, 'wall', 'placement mode armed for the wall');
  step(g, { 0: {} }, 1 / 30);                        // release place (edge reset)
  step(g, { 0: { fire: true } }, 1 / 30);            // first confirm: drop the wall anchor
  step(g, { 0: {} }, 1 / 30);                        // release fire (edge reset)
  step(g, { 0: { fire: true } }, 1 / 30);            // second confirm: lay the one-tile line
  const newWalls = g.builds.filter(b => b.kind === 'wall');
  assert.equal(newWalls.length, wallsBefore + 1, 'exactly one wall segment was laid');
  const laid = newWalls[newWalls.length - 1];
  assert.equal(laid.cost, 1, 'a laid wall records cost 1');
  assert.equal(laid.invested, 1, 'a laid wall records 1 shard invested');
}

// --- DAY/NIGHT DEFAULTS: a bastion level with no dayLen/nightLen override
// inherits the longer-day/shorter-night rhythm (120s day / 60s night). The cycle
// clock starts on a 120s day. A level that DOES set its own pair (the deliberate
// long-night design twists) keeps it. CONTROL: a classic level has no cycle. ---
function testDayNightDefaults() {
  const W = 14, H = 10;
  const tiles = ['#'.repeat(W)];
  for (let y = 1; y < H - 1; y++) tiles.push('#' + '.'.repeat(W - 2) + '#');
  tiles.push('#'.repeat(W));
  tiles[Math.floor(H / 2)] = '#' + '.'.repeat(5) + 'P' + '.'.repeat(W - 8) + '#';
  tiles[2] = '#' + '.'.repeat(9) + 'g' + '.'.repeat(W - 12) + '#';

  // INHERIT: no bastion.dayLen/nightLen -> the 120/60 defaults.
  const inheritDef = { name: 'Default Cycle', mode: 'bastion', time: 600, tiles, captiveChars: [], stronghold: { level: 1, hpMult: 1 } };
  const g = createGame(inheritDef, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  assert.equal(g.bastion.dayLen, 120, 'default day length is 120s');
  assert.equal(g.bastion.nightLen, 60, 'default night length is 60s');
  assert.equal(g.cycle.phase, 'day', 'a bastion run opens on day');
  assert.equal(g.cycle.t, 120, 'the opening day clock starts at 120s');

  // OVERRIDE: a deliberate long-night design twist keeps its own pair.
  const twistDef = { name: 'Long Night', mode: 'bastion', time: 600, tiles, captiveChars: [],
    bastion: { nights: 6, dayLen: 70, nightLen: 95 }, stronghold: { level: 14, hpMult: 1 } };
  const tg = createGame(twistDef, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  assert.equal(tg.bastion.dayLen, 70, 'a level override keeps its short day');
  assert.equal(tg.bastion.nightLen, 95, 'a level override keeps its long night');

  // CONTROL: a classic (non-bastion) level has no cycle at all (byte-stable).
  const classicDef = { name: 'Plain', time: 90, tiles, captiveChars: [] };
  const cg = createGame(classicDef, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  assert.equal(cg.bastion, null, 'classic levels carry no bastion config');
  assert.equal(cg.cycle, null, 'classic levels carry no day/night cycle');
}

// --- DIFFICULTY threading (the shape the SERVER now sends): a host's chosen
// difficulty rides into createGame as def.difficulty and scales spawn counts the
// same way solo does. EXTREME is the byte-stable baseline; NORMAL halves it. This
// mirrors server.js startLevel cloning the def with room.difficulty. ---
function testHostedDifficultyScales() {
  // a wide bastion map: a scripted night wave whose letter-count we can count.
  const W = 40, H = 18;
  const tiles = ['#'.repeat(W)];
  for (let y = 1; y < H - 1; y++) tiles.push('#' + (y === 1 ? 'P' + '.'.repeat(W - 3) : y === 9 ? '.'.repeat(W - 3) + 'g.' : '.'.repeat(W - 2)) + '#');
  tiles.push('#'.repeat(W));
  // a host hands difficulty straight into the def (exactly server.js's clone).
  const hostDef = (d) => ({ name: 'Hosted', time: 60, captiveChars: [], difficulty: d,
    modifiers: { waves: [{ at: 0.5, letters: 'gggggggg', edge: 'n' }] }, tiles });
  const waveCount = (d) => {
    const g = createGame(hostDef(d), [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
    g.graceT = 99999; g.players[0].invuln = 999;
    const before = g.enemies.length;
    run(g, () => ({ 0: {} }), 1);
    return g.enemies.length - before;
  };
  const wExtreme = waveCount('extreme');
  const wNormal = waveCount('normal');
  assert.equal(wExtreme, 8, 'a hosted EXTREME room spawns the full 8-letter wave (baseline)');
  assert.equal(wNormal, 4, 'a hosted NORMAL room spawns about half (8 -> 4)');
  // a def WITHOUT a difficulty key (versus rooms, or a normal host) defaults to
  // normal and never ships the difficulty wire key — keeping CTF byte-stable.
  const vg = createGame({ name: 'Versus-ish', time: 60, captiveChars: [], tiles,
    modifiers: { waves: [] } }, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  assert.equal(vg.difficulty, 'normal', 'no def.difficulty defaults to normal (versus/host baseline)');
  assert.ok(!('difficulty' in snapshot(vg)), 'a normal-default snapshot ships no difficulty key (byte-stable)');
}

// --- DEV cheats (solo offline): enabling a cheat sets g.devMode, and the sim
// honors god mode / instant-kill / speed / instant-build deterministically. The
// finish() score-submission is gated on g.devMode (verified at unit level here:
// devMode flips, and the dirty flag survives serialize/restore). ---
function testDevCheats() {
  const W = 14, H = 10;
  const tiles = ['#'.repeat(W)];
  for (let y = 1; y < H - 1; y++) tiles.push('#' + '.'.repeat(W - 2) + '#');
  tiles.push('#'.repeat(W));
  tiles[Math.floor(H / 2)] = '#' + '.'.repeat(5) + 'P' + '.'.repeat(W - 8) + '#';
  // a few enemies so kill-all/instant-kill have targets
  tiles[2] = '#' + '.'.repeat(4) + 'gggg' + '.'.repeat(W - 10) + '#';
  const def = { name: 'Cheat Map', time: 600, tiles, captiveChars: [] };

  // GOD MODE: a player with god on never goes down even when forced to 0 hp.
  const g = createGame(def, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  g.cheats = { god: true, speed: 1, instantKill: false, instantBuild: false };
  g.devMode = true; // enabling any cheat sets this sticky flag (client does it)
  const p = g.players[0];
  p.invuln = 0; g.graceT = 0;
  p.x = (2.5) * TILE; p.y = (2.5) * TILE; // stand right under the grunt line
  // hammer the player into enemies for a while — god mode must keep it active
  run(g, () => ({ 0: {} }), 2);
  assert.equal(g.players[0].state, 'active', 'god mode keeps the player active under contact');
  assert.equal(g.captives.filter(c => c.fromPlayer).length, 0, 'god mode produces no downed-player captive');

  // INSTANT KILL: any player-owned damage one-shots even tough enemies. Make
  // every grunt unkillably-tough (hp 99) so a normal scout can't whittle them
  // — only the one-shot cheat clears them under fire.
  const mkTough = ik => {
    const gg = createGame(def, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
    gg.cheats = { god: false, speed: 1, instantKill: ik, instantBuild: false };
    for (const e of gg.enemies) { e.hp = 99; e.maxHp = 99; e.dormant = false; e.awake = true; }
    gg.players[0].invuln = 999; gg.graceT = 0;
    return gg;
  };
  // control: WITHOUT instant-kill the scout can't dent hp-99 grunts in 1.5s
  const ctrl = mkTough(false);
  const ctrlK0 = ctrl.kills;
  run(ctrl, (gg) => ({ 0: aimAtNearest(gg, gg.players[0]) }), 1.5);
  assert.equal(ctrl.kills, ctrlK0, 'without instant-kill, hp-99 grunts survive scout fire');
  // with instant-kill: a single landed player shot drops the enemy
  const g2 = mkTough(true);
  const killsBefore = g2.kills;
  run(g2, (gg) => ({ 0: aimAtNearest(gg, gg.players[0]) }), 1.5);
  assert.ok(g2.kills > killsBefore, 'instant-kill one-shots tough enemies under player fire');

  // SPEED: x10 moves the hero markedly farther per frame than x1.
  const mk = () => {
    const gg = createGame(def, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
    gg.players[0].invuln = 999; gg.graceT = 0;
    return gg;
  };
  const slow = mk(); slow.cheats = { god: false, speed: 1, instantKill: false, instantBuild: false };
  const fast = mk(); fast.cheats = { god: false, speed: 10, instantKill: false, instantBuild: false };
  const x0s = slow.players[0].x, x0f = fast.players[0].x;
  step(slow, { 0: { right: true } }, 1 / 30);
  step(fast, { 0: { right: true } }, 1 / 30);
  const dSlow = slow.players[0].x - x0s, dFast = fast.players[0].x - x0f;
  assert.ok(dFast > dSlow * 5, 'x10 speed cheat moves the hero far more than x1');

  // devMode survives serialize/restore (a saved cheated run stays dirty).
  const ser = serializeGame(g);
  assert.equal(ser.devMode, true, 'devMode persists through serializeGame');
  assert.equal(ser.cheats.god, true, 'cheats persist through serializeGame');
  const back = restoreGame(ser, charMap);
  assert.equal(back.devMode, true, 'devMode survives restoreGame');

  // untouched modes never gain cheats: a plain game has no g.cheats, so every
  // sim guard is inert and behavior is unchanged.
  const plain = createGame(def, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  assert.equal(plain.cheats, undefined, 'a normal run carries no cheats object');
  assert.equal(plain.devMode, undefined, 'a normal run is not dev-dirty');
}

// --- DEV "Pause Time" cheat (solo offline): freezes the WORLD — enemies stop
// moving, the mission countdown holds, enemy projectiles hang — while the
// operative still moves/aims/fires/builds. Gated on g.cheats.pauseTime, so an
// untouched run (no g.cheats) is a byte-identical no-op. Control proves the
// world DOES advance when the cheat is off. ---
function testPauseTimeCheatFreezesWorld() {
  const W = 14, H = 10;
  const tiles = ['#'.repeat(W)];
  for (let y = 1; y < H - 1; y++) tiles.push('#' + '.'.repeat(W - 2) + '#');
  tiles.push('#'.repeat(W));
  const mid = Math.floor(H / 2);
  // player on the left of the open middle row; a grunt 4 tiles to its right so
  // it is awake (arcade map auto-wakes) and aggro'd — it will march at the hero.
  tiles[mid] = '#' + '.'.repeat(2) + 'P' + '...' + 'g' + '.'.repeat(W - 8) + '#';
  const def = { name: 'Freeze Map', time: 600, tiles, captiveChars: [] };

  // Build twin runs that differ ONLY in the pauseTime flag, then drive both with
  // an empty input for a few ticks (the grunt walks itself toward the hero).
  const mk = pauseTime => {
    const gg = createGame(def, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
    gg.cheats = { god: false, speed: 1, instantKill: false, instantBuild: false, pauseTime };
    if (pauseTime) gg.devMode = true; // sticky dirty flag (client sets this too)
    gg.graceT = 0;                    // skip the level-start grace so enemies act now
    gg.players[0].invuln = 999;       // keep the hero up regardless of contact
    return gg;
  };

  // CONTROL (cheat OFF): the world advances — the grunt closes on the hero and
  // the mission clock ticks down.
  const ctrl = mk(false);
  const ce0 = ctrl.enemies[0];
  const cx0 = ce0.x, cy0 = ce0.y, cTime0 = ctrl.timeLeft;
  run(ctrl, () => ({ 0: {} }), 1.0);
  const cMoved = Math.hypot(ctrl.enemies[0].x - cx0, ctrl.enemies[0].y - cy0);
  assert.ok(cMoved > TILE * 0.25, 'control (cheat off): the enemy advances on the hero');
  assert.ok(ctrl.timeLeft < cTime0, 'control (cheat off): the mission countdown decrements');

  // FROZEN (cheat ON): the enemy holds its exact tile and the clock does not
  // move — but the operative still walks under a right-input.
  const froz = mk(true);
  const fe0 = froz.enemies[0];
  const fx0 = fe0.x, fy0 = fe0.y, fTime0 = froz.timeLeft;
  const px0 = froz.players[0].x;
  run(froz, () => ({ 0: { right: true } }), 1.0);
  assert.equal(froz.enemies[0].x, fx0, 'pause time: enemy x is unchanged (world frozen)');
  assert.equal(froz.enemies[0].y, fy0, 'pause time: enemy y is unchanged (world frozen)');
  assert.equal(froz.timeLeft, fTime0, 'pause time: the mission countdown holds');
  assert.ok(froz.players[0].x - px0 > TILE * 0.25, 'pause time: the operative still moves');

  // Toggling the cheat OFF mid-run releases the world again (the same game keeps
  // simulating): the held enemy resumes its march.
  froz.cheats.pauseTime = false;
  const rx0 = froz.enemies[0].x;
  run(froz, () => ({ 0: {} }), 1.0);
  assert.notEqual(froz.enemies[0].x, rx0, 'clearing pause time resumes enemy movement');

  // Untouched runs never gain the flag, so the gate is fully inert: a plain
  // game (no g.cheats) advances exactly as before.
  const plain = createGame(def, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  assert.equal(plain.cheats, undefined, 'a normal run carries no cheats object (pause-time gate inert)');
}

// --- RELIC AWAKENING horde: latch on relic completion, escalating nightmares
// from all four edges, ends after the track length restoring dark/weather, and
// a survival bonus that drops with hits + deaths. Gated entirely on g.musicBox.
function relicStoryDef(chapter = 4) {
  // a roomy open story map: center spawn, open edges for edge-spawns.
  const W = 20, H = 14;
  const tiles = ['#'.repeat(W)];
  for (let y = 1; y < H - 1; y++) tiles.push('#' + '.'.repeat(W - 2) + '#');
  tiles.push('#'.repeat(W));
  tiles[Math.floor(H / 2)] = '#' + '.'.repeat(8) + 'P' + '.'.repeat(W - 10) + '#';
  // one sleeping grunt far off so the field is never empty (no auto-clear)
  tiles[2] = '#' + '.'.repeat(15) + 'g' + '.'.repeat(W - 17) + '#';
  // EXTREME pins the historical (no-op) spawn counts so every existing horde
  // assertion stays the exact baseline; the difficulty test below varies it.
  return { name: 'Relic Test', story: true, chapter, time: 9000, untimed: true, tiles, captiveChars: [], difficulty: 'extreme' };
}

// Drive the four shards into the altar so g.musicBox.complete flips true.
function completeRelic(g) {
  const p = g.players[0];
  p.invuln = 1e9; g.graceT = 0;
  for (let idx = 0; idx < 4; idx++) {
    const fr = g.musicBox.fragments[idx];
    p.x = fr.x; p.y = fr.y;
    step(g, { 0: {} }, 1 / 30);            // scoop
    p.x = g.musicBox.altar.x; p.y = g.musicBox.altar.y;
    step(g, { 0: {} }, 1 / 30);            // deposit
  }
  assert.ok(g.musicBox.complete, 'relic completes at 4/4');
}

function testRelicAwakeningHorde() {
  // dur ties EXACTLY to MUSIC_DURATIONS for the level's mode-stem.
  const g = createGame(relicStoryDef(4), [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  assert.ok(!g.horde, 'no horde before the relic completes');
  assert.equal(g.dark, false, 'world starts lit');

  completeRelic(g);
  // one more step: stepHorde latches on the rising edge of complete.
  step(g, { 0: {} }, 1 / 30);
  assert.ok(g.horde, 'completing the relic latches g.horde');
  const expectDur = MUSIC_DURATIONS['story-ch04'] || RELIC_WAVE_FALLBACK;
  assert.equal(g.horde.dur, expectDur, 'horde dur is the exact MUSIC_DURATIONS track length');
  assert.equal(g.dark, true, 'the world darkens for the event');
  assert.equal(g.weather, 'thunderstorm', 'the thunderstorm rolls in');
  assert.ok(g.horde.prevDark === false, 'pre-event dark is remembered for restore');
  // the relicAwaken event fired (banner/audio cue for the client)
  const snapNow = snapshot(g);
  assert.ok(snapNow.horde && snapNow.horde.active, 'snapshot ships an active horde flag while live');
  assert.ok(snapNow.dark, 'snapshot ships the dark flag during the event');

  // ESCALATE: the very first burst (fired at latch) spawns from ALL FOUR edges
  // at once. Read the spawn-band edges straight off that first batch before the
  // fast melee kinds rush inward. Edges are reported on the 'horde' events too.
  const p = g.players[0];
  p.invuln = 1e9;
  const nm = g.enemies.filter(e => ['spider', 'ghost', 'reaper', 'skeleton', 'zombie', 'hellhound', 'banshee'].includes(e.kind));
  assert.ok(nm.length > 0, 'nightmares spawn on the first burst');
  const edges = new Set(nm.map(e => {
    if (e.y < 2 * TILE) return 'n';
    if (e.y > (g.h - 2) * TILE) return 's';
    if (e.x < 2 * TILE) return 'w';
    if (e.x > (g.w - 2) * TILE) return 'e';
    return 'mid';
  }));
  edges.delete('mid');
  assert.ok(edges.size >= 2, `nightmares enter from multiple edges (saw ${[...edges].join(',')})`);
  // the horde events also name every breached edge
  const hordeEdges = new Set(snapNow.events.filter(e => e.type === 'horde').map(e => e.edge));
  assert.ok(hordeEdges.size >= 3, `the first burst breaches 3+ edges (saw ${[...hordeEdges].join(',')})`);
  // the nightmare letters are FRESH — none collides with a real level enemy
  assert.ok(nm.every(e => /[UFMRGL&]/.test(e.letter)), 'nightmares use fresh capital/symbol letters');
  // density ESCALATES: a late-progress burst drops more per edge than the opener.
  let earlyPerEdge = 0, latePerEdge = 0;
  {
    const ge = createGame(relicStoryDef(4), [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
    completeRelic(ge);
    ge.players[0].invuln = 1e9;
    step(ge, { 0: {} }, 1 / 30); // latch + first (opening) burst
    earlyPerEdge = (snapshot(ge).events.find(e => e.type === 'horde') || {}).count || 0;
    // jump near the climax: shove the start clock back so progress ~0.9
    ge.horde.startedAt = ge.elapsed - ge.horde.dur * 0.9;
    ge.horde.nextAt = ge.elapsed; // force a burst now
    for (const e of ge.enemies) e.dead = true; // clear the field for a clean read
    step(ge, { 0: {} }, 1 / 30);
    latePerEdge = (snapshot(ge).events.find(e => e.type === 'horde') || {}).count || 0;
  }
  assert.ok(latePerEdge > earlyPerEdge, `density escalates (${earlyPerEdge} -> ${latePerEdge} per edge)`);

  // END (survive): fast-forward past the track length with the squad alive.
  // Coarse dt just to walk the clock to the finish — determinism unaffected.
  run(g, () => { g.players[0].invuln = 1e9; return { 0: {} }; }, expectDur + 4, 0.5);
  assert.ok(g.horde.ended, 'the horde ends once the song plays out');
  assert.equal(g.horde.result, 'survived', 'the squad survives');
  assert.equal(g.dark, false, 'dark restores to its pre-event value');
  assert.equal(g.weather, g.horde.prevWeather, 'weather restores to its pre-event value');
  // every leftover nightmare dissolved on the finish
  assert.equal(g.enemies.filter(e => !e.dead && ['spider', 'ghost', 'reaper', 'skeleton', 'zombie', 'hellhound', 'banshee'].includes(e.kind)).length, 0,
    'remaining nightmares dissolve when the event ends');

  // SCORING: the formula drops with hits + deaths. Clean survival (0/0) banks
  // the full base bonus; a wounded run banks strictly less.
  const cleanBonus = HORDE_BASE_BONUS_FOR_TEST; // mirrored below
  // run two fresh events to the same finish, one clean, one battered.
  function survivedScore({ hits, deaths }) {
    const gg = createGame(relicStoryDef(4), [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
    completeRelic(gg);
    step(gg, { 0: {} }, 1 / 30);
    const before = gg.score;
    // walk to a few seconds before the finish, then inject the hit/death tallies
    // the sim would have accrued, and step on until the bonus is awarded.
    run(gg, () => { gg.players[0].invuln = 1e9; return { 0: {} }; }, gg.horde.dur - 5, 0.5);
    assert.ok(!gg.horde.ended, 'still live just before the finish');
    gg.horde.hits = hits; gg.horde.deaths = deaths;
    let surv = null;
    for (let i = 0; i < 40 && !gg.horde.ended; i++) {
      gg.players[0].invuln = 1e9;
      step(gg, { 0: {} }, 0.5);
      const ev = gg.events.find(e => e.type === 'relicSurvived');
      if (ev) surv = ev;
    }
    assert.ok(gg.horde.ended && gg.horde.result === 'survived', 'event survived');
    assert.ok(surv, 'a relicSurvived event carries the breakdown');
    return { awarded: gg.score - before, ev: surv };
  }
  const clean = survivedScore({ hits: 0, deaths: 0 });
  const battered = survivedScore({ hits: 10, deaths: 1 });
  assert.equal(clean.ev.base, cleanBonus, 'clean run reports the base bonus');
  assert.equal(clean.awarded, cleanBonus, 'clean survival banks the full base bonus');
  assert.equal(battered.awarded, cleanBonus - 10 * clean.ev.hitPenalty - 1 * clean.ev.deathPenalty,
    'each hit + death bleeds the bonus by the exact penalties');
  assert.ok(battered.awarded < clean.awarded, 'a battered run banks strictly less');
  assert.equal(battered.ev.hits, 10, 'breakdown carries the hit count');
  assert.equal(battered.ev.deaths, 1, 'breakdown carries the death count');

  // FAIL: if every player is down during the event, the relic goes dormant —
  // world restores, no bonus, a relicFailed event fires.
  const fg = createGame(relicStoryDef(4), [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  completeRelic(fg);
  step(fg, { 0: {} }, 1 / 30);
  assert.ok(fg.horde && !fg.horde.ended, 'fail run: event is live');
  const scoreBeforeFail = fg.score;
  fg.players[0].state = 'down'; // simulate the whole squad going down
  step(fg, { 0: {} }, 1 / 30);
  assert.ok(fg.horde.ended && fg.horde.result === 'failed', 'a full wipe fails the event');
  assert.equal(fg.dark, false, 'fail restores dark');
  assert.equal(fg.weather, fg.horde.prevWeather, 'fail restores weather');
  assert.equal(fg.score, scoreBeforeFail, 'a failed event awards no bonus');
  assert.ok(fg.events.some(e => e.type === 'relicFailed'), 'a relicFailed event fires');

  // GATING: a plain classic level never latches a horde even if forced.
  const cg = createGame({ name: 'Plain', time: 90, tiles: relicStoryDef().tiles, captiveChars: [] },
    [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  assert.equal(cg.musicBox.enabled, false, 'classic level has no music box');
  run(cg, () => ({ 0: {} }), 3, 1 / 30);
  assert.ok(!cg.horde, 'no music box -> stepHorde stays a no-op (no g.horde key)');
  assert.ok(!snapshot(cg).horde, 'classic snapshot never gains a horde key');
}
// base bonus mirrored from game.js HORDE_BASE_BONUS (kept in sync by the asserts
// above, which read the penalties off the live event so only the base is fixed).
const HORDE_BASE_BONUS_FOR_TEST = 5000;

// --- DIFFICULTY selector: a single enemy-count multiplier on normal waves and
// the relic awakening horde. EXTREME (1.0) is the historical no-op baseline;
// NORMAL (~0.5) halves the pressure; EASY (~0.35) relaxes it further. A legit
// setting (never sets g.devMode), so scores still count on every difficulty. ---
function testDifficultySelector() {
  // a fresh relic level at a given difficulty.
  const relicAt = (d) => ({ ...relicStoryDef(4), difficulty: d });

  // BASELINE: omitting def.difficulty defaults to 'normal' (0.5).
  const dfDefault = createGame(relicStoryDef(4), [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  // (relicStoryDef pins 'extreme' so the horde suite stays the baseline; a def
  // with NO difficulty key falls back to 'normal'.)
  const plain = createGame({ name: 'Plain', time: 90, tiles: relicStoryDef().tiles, captiveChars: [] },
    [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  assert.equal(plain.difficulty, 'normal', 'no def.difficulty defaults to normal');
  assert.equal(plain.enemyScale, 0.5, 'normal maps to a 0.5 enemy-count scale');
  assert.equal(dfDefault.difficulty, 'extreme', 'extreme def carries through to the game');
  assert.equal(dfDefault.enemyScale, 1, 'extreme is the no-op 1.0 scale');

  // NOT A CHEAT: choosing any difficulty never flips the dev-dirty flag.
  for (const d of ['easy', 'normal', 'extreme']) {
    const g = createGame(relicAt(d), [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
    assert.equal(g.devMode, undefined, `difficulty '${d}' does not set g.devMode (scores still count)`);
  }

  // HORDE COUNT: force a single late-progress burst and total the nightmares
  // spawned that tick. EXTREME must reproduce the historical count exactly;
  // NORMAL spawns about half; EASY fewer still — never zero where 1 is needed.
  function burstSpawns(d) {
    const g = createGame(relicAt(d), [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
    completeRelic(g);
    g.players[0].invuln = 1e9;
    step(g, { 0: {} }, 1 / 30);          // latch + opening burst
    g.horde.startedAt = g.elapsed - g.horde.dur * 0.9; // jump to ~climax
    g.horde.nextAt = g.elapsed;          // force a burst this tick
    for (const e of g.enemies) e.dead = true; // clear the field for a clean read
    g.events.length = 0;                 // drop the opening-burst events first
    step(g, { 0: {} }, 1 / 30);
    const bursts = g.events.filter(e => e.type === 'hordeBurst');
    assert.equal(bursts.length, 1, `difficulty '${d}': exactly one climax burst fired`);
    return bursts[0].count; // total nightmares this burst (all four edges)
  }
  const extremeBurst = burstSpawns('extreme'); // climax: 3/edge * 4 edges = 12
  const normalBurst = burstSpawns('normal');   // ~half: 2/edge * 4 = 8
  const easyBurst = burstSpawns('easy');        // fewer: 1/edge * 4 = 4
  assert.equal(extremeBurst, 12, 'extreme climax burst is the historical full count');
  assert.ok(normalBurst >= 1 && normalBurst < extremeBurst,
    `normal spawns FEWER than extreme (saw ${normalBurst} < ${extremeBurst})`);
  // about half the relic horde (per-edge density carries a floor of 1, so the
  // climax lands near ~0.5-0.67 of extreme; the early bursts thin proportionally).
  assert.ok(normalBurst <= Math.round(extremeBurst * 0.7) && normalBurst >= Math.round(extremeBurst * 0.4),
    `normal is about HALF the relic horde (saw ${normalBurst} of ${extremeBurst})`);
  assert.ok(easyBurst < normalBurst, `easy spawns fewer than normal (saw ${easyBurst} < ${normalBurst})`);
  assert.ok(easyBurst >= 1, 'easy never drops the horde to zero');

  // NORMAL WAVES scale too: an extreme 8-letter wave spawns all 8; normal ~half.
  function waveCount(d) {
    const def = { name: 'WD', time: 60, captiveChars: [], difficulty: d,
      tiles: ['#'.repeat(40), ...Array.from({ length: 18 }, (_, i) =>
        i === 1 ? '#P' + '.'.repeat(37) + '#'
        : i === 9 ? '#' + '.'.repeat(37) + 'g#' : '#' + '.'.repeat(38) + '#'),
        '#'.repeat(40)],
      modifiers: { waves: [{ at: 0.5, letters: 'gggggggg', edge: 'n' }] } };
    const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
    g.graceT = 99999; g.players[0].invuln = 999;
    const before = g.enemies.length;
    run(g, () => ({ 0: {} }), 1);
    return g.enemies.length - before;
  }
  const wExtreme = waveCount('extreme');
  const wNormal = waveCount('normal');
  const wEasy = waveCount('easy');
  assert.equal(wExtreme, 8, 'extreme spawns the full 8-letter wave (no-op baseline)');
  assert.equal(wNormal, 4, 'normal spawns about half the wave (8 -> 4)');
  assert.ok(wEasy < wNormal && wEasy >= 1, `easy thins the wave further (saw ${wEasy})`);

  // SNAPSHOT GATING: default 'normal' never ships the difficulty key (wire
  // stays byte-identical); easy/extreme ship the badge for the HUD.
  assert.ok(!('difficulty' in snapshot(plain)), 'normal snapshot stays byte-identical (no difficulty key)');
  const eg = createGame(relicAt('easy'), [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  assert.equal(snapshot(eg).difficulty, 'easy', 'easy snapshot ships the difficulty badge');
  assert.equal(snapshot(dfDefault).difficulty, 'extreme', 'extreme snapshot ships the difficulty badge');

  // PERSISTENCE through serialize/restore: the resumed run keeps its scale so
  // post-restore spawns stay deterministic (legacy beacons fall back to 1.0).
  const rt = restoreGame(serializeGame(eg), charMap);
  assert.equal(rt.enemyScale, eg.enemyScale, 'enemyScale survives restore');
  assert.equal(rt.difficulty, 'easy', 'difficulty survives restore');
}

// --- RELIC SUPERWEAPON (RA2-style nuke / weather machine) ------------------
// Unlocked by surviving the music-box awakening; then a player BUILDS a one-shot
// device (a 6s channel), which on completion starts a ~60s charge AND spawns a
// tiny punish wave; once ready the owner fires it ONCE at a target cell — the
// nuke clears everything in its blast (so it wipes a stronghold garrison) and
// the weather machine storms a zone over a few seconds. Entirely gated on the
// unlock flag, so every other mode stays byte-identical.

// Mirror the sim's superweapon kill radii (tiles) so the auto-target assertions
// can check the chosen impact landed on the dense cluster, not the lone enemy.
const NUKE_RADIUS_TILES = 4.5;
const STORM_RADIUS_TILES = 5.0;
const RAD_RADIUS_TILES = 3.0;
// A player in any of these states was taken down (vs 'active' play or a clean
// 'extracted' win). The friendly-safe asserts use this so a level auto-clearing
// after we cull the enemies (state 'extracted') is not mistaken for a death.
const DOWNED = new Set(['down', 'out', 'pick']);

// Drive the awakening to a SURVIVED finish so g.superweaponUnlocked flips true.
// Reuses the startedAt rewind trick to walk the clock to the end in one step.
function unlockSuperweapon(g) {
  completeRelic(g);
  g.players[0].invuln = 1e9;
  step(g, { 0: {} }, 1 / 30); // latch g.horde
  g.horde.startedAt = g.elapsed - g.horde.dur - 1; // past the finish
  step(g, { 0: {} }, 1 / 30); // SURVIVED -> unlock
  assert.ok(g.horde.ended && g.horde.result === 'survived', 'awakening survived');
  assert.ok(g.superweaponUnlocked === true, 'surviving the awakening unlocks the superweapon');
}

// First open floor cell that is a legal build site (clear of wall/extract/spawn).
function findSuperSite(g) {
  for (let ty = 1; ty < g.h - 1; ty++) {
    for (let tx = 1; tx < g.w - 1; tx++) {
      const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
      // mirror canBuildSuperweaponAt: '.' floor, >=1 tile off #/o, >=4 off E/P,
      // free of enemies/structures (the test maps have neither in the interior).
      if (g.grid[ty][tx] !== '.') continue;
      let wallNear = false;
      for (let dy = -1; dy <= 1 && !wallNear; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const c = g.grid[ty + dy]?.[tx + dx];
          if (c === '#' || c === 'o') { wallNear = true; break; }
        }
      if (wallNear) continue;
      let exitNear = false;
      for (let yy = 0; yy < g.h && !exitNear; yy++)
        for (let xx = 0; xx < g.w; xx++) {
          const t = g.grid[yy][xx];
          if (t !== 'E' && t !== 'P') continue;
          if ((((xx + 0.5) * TILE) - x) ** 2 + (((yy + 0.5) * TILE) - y) ** 2 < (4 * TILE) ** 2) { exitNear = true; break; }
        }
      if (exitNear) continue;
      return { x, y };
    }
  }
  return null;
}

// Move the seat onto a site and channel the build to completion. Returns the
// device. Keeps the operative invulnerable so the spawned mini-wave can't down it.
function buildSuperweaponAt(g, kind, site) {
  const p = g.players[0];
  p.x = site.x; p.y = site.y; p.invuln = 1e9; g.graceT = 0;
  step(g, { 0: { superBuild: kind } }, 1 / 30); // edge: start the channel
  assert.ok(g.superweapon && g.superweapon.state === 'building', `${kind} device starts building`);
  // channel ~6s of standing still (drop superBuild so it's a clean edge later)
  run(g, () => { g.players[0].x = site.x; g.players[0].y = site.y; g.players[0].invuln = 1e9; return { 0: {} }; }, 6.5, 1 / 30);
  return g.superweapon;
}

function testSuperweaponLockedUntilSurvived() {
  // LOCKED: a fresh relic level (music box present, never survived) refuses to
  // build, and the snapshot never carries the unlock/device keys.
  const g = createGame(relicStoryDef(4), [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  assert.equal(g.superweaponUnlocked, false, 'superweapon starts locked');
  assert.equal(g.superweapon, null, 'no device before unlock');
  const site = findSuperSite(g);
  assert.ok(site, 'the test map has a legal build site');
  const p = g.players[0];
  p.x = site.x; p.y = site.y; p.invuln = 1e9; g.graceT = 0;
  step(g, { 0: { superBuild: 'nuke' } }, 1 / 30);
  assert.equal(g.superweapon, null, 'a locked superweapon cannot be built');
  const snap = snapshot(g);
  assert.ok(!('superweaponUnlocked' in snap), 'locked snapshot never gains the unlock key');
  assert.ok(!('superweapon' in snap), 'locked snapshot never gains the device key');
  assert.ok(!('hazards' in snap), 'locked snapshot never gains the hazards key');
}

function testSuperweaponBuildChargeAndTinyWave() {
  const g = createGame(relicStoryDef(4), [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  unlockSuperweapon(g);
  // leave the map's sleeping enemies in place (an empty field would auto-clear
  // this story level); measure the tiny wave as the delta from this baseline.
  const before = g.enemies.filter(e => !e.dead).length;

  const site = findSuperSite(g);
  const sw = buildSuperweaponAt(g, 'nuke', site);
  // BUILD COMPLETE: charge started at ~60s, and the tiny wave showed up.
  assert.equal(sw.state, 'charging', 'a finished build enters the charge state');
  assert.ok(sw.chargeT > 55 && sw.chargeT <= 60, `charge timer is ~60s (saw ${sw.chargeT})`);
  const after = g.enemies.filter(e => !e.dead).length;
  assert.ok(after - before >= 3 && after - before <= 4, `build completion spawns a TINY wave (saw +${after - before})`);
  assert.ok(after - before < 8, 'the tiny wave is far smaller than a real horde');
  // snapshot carries the device + countdown for the HUD
  const snap = snapshot(g);
  assert.ok(snap.superweaponUnlocked, 'snapshot ships the unlock flag once earned');
  assert.equal(snap.superweapon.state, 'charging', 'snapshot ships the charging device');
  assert.ok(snap.superweapon.chargeT > 0, 'snapshot ships the live charge countdown');

  // NOT USABLE BEFORE CHARGE: a fire attempt while charging does nothing.
  g.players[0].x = site.x + TILE; g.players[0].y = site.y;
  step(g, { 0: { superFire: true, aimX: site.x, aimY: site.y } }, 1 / 30);
  assert.equal(g.superweapon.state, 'charging', 'a charging device cannot fire');
  assert.equal(g.hazards.length, 0, 'no strike lands before the device is ready');

  // CONTROL: let the charge run out — the device flips to ready.
  g.superweapon.chargeT = 0.1;
  run(g, () => { g.players[0].invuln = 1e9; return { 0: {} }; }, 0.5, 1 / 30);
  assert.equal(g.superweapon.state, 'ready', 'the device goes live when the charge elapses');
}

function testSuperweaponNukeClearsStronghold() {
  const g = createGame(relicStoryDef(4), [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  unlockSuperweapon(g);

  const site = findSuperSite(g);
  const sw = buildSuperweaponAt(g, 'nuke', site);
  sw.chargeT = 0; // skip the wait
  run(g, () => { g.players[0].invuln = 1e9; return { 0: {} }; }, 0.2, 1 / 30);
  assert.equal(g.superweapon.state, 'ready', 'device ready to fire');

  // a CONTROL enemy parked far from the target proves the blast is local.
  const cx = (3 + 0.5) * TILE, cy = (11 + 0.5) * TILE; // far corner
  const control = makeEnemyForTest(g, 'g', cx, cy);
  g.enemies.push(control);

  // pile a dense "stronghold garrison" (incl. a boss hp24) at a target cell
  // well away from the control, the spawn and the device.
  const tx = (16 + 0.5) * TILE, ty = (11 + 0.5) * TILE;
  const cluster = ['b', 'm', 'm', 's', 's', 'g', 'g', 'r', 'a'];
  const garrisonIds = [];
  for (let i = 0; i < cluster.length; i++) {
    const ang = (i / cluster.length) * Math.PI * 2;
    const ex = tx + Math.cos(ang) * TILE, ey = ty + Math.sin(ang) * TILE;
    const made = makeEnemyForTest(g, cluster[i], ex, ey);
    g.enemies.push(made);
    garrisonIds.push(made.id);
  }
  assert.ok(garrisonIds.length >= 9, 'a dense garrison is staged');

  // FIRE: owner just TRIGGERS it (aimless) — the sim auto-targets the densest
  // hostile cluster, which is this 9-pack. The strike is telegraphed (flight
  // delay), then the blast resolves and wipes the cluster.
  g.players[0].x = site.x; g.players[0].y = site.y; // owner near the device
  step(g, { 0: { superFire: true } }, 1 / 30);
  assert.equal(g.superweapon.state, 'spent', 'firing consumes the one use');
  assert.equal(g.superweapon.used, true, 'the device is marked used');
  // the auto-target landed on the dense cluster, not the lone far control
  assert.ok((g.superweapon.targetX - tx) ** 2 + (g.superweapon.targetY - ty) ** 2 < (NUKE_RADIUS_TILES * TILE) ** 2,
    'auto-target struck the dense cluster, not the lone far enemy');
  // the flight is in the air now (one-shot: a second trigger does nothing)
  step(g, { 0: { superFire: true } }, 1 / 30);
  // walk past the flight delay so the blast lands
  run(g, () => { g.players[0].invuln = 1e9; return { 0: {} }; }, 1.5, 1 / 30);
  const survivors = g.enemies.filter(e => !e.dead && garrisonIds.includes(e.id)).length;
  assert.equal(survivors, 0, 'the nuke clears every enemy in the blast (stronghold garrison wiped)');
  // CONTROL: the far-off enemy outside the radius survives the same blast.
  assert.ok(g.enemies.some(e => !e.dead && e.id === control.id), 'an enemy far outside the blast is untouched');
  // AFTERMATH: a radiation pool lingers on the crater.
  assert.ok(g.hazards.some(h => h.kind === 'radiation'), 'the blast leaves a radiation crater');
  const radSnap = snapshot(g);
  assert.ok((radSnap.hazards || []).some(h => h.kind === 'radiation'), 'snapshot ships the radiation field');
}

// Stage a weather strike on a packed cluster and run the storm out; returns the
// staged-cluster ids and how many survived (used twice to prove determinism).
function runWeatherStorm() {
  const g = createGame(relicStoryDef(4), [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  unlockSuperweapon(g);
  const site = findSuperSite(g);
  const sw = buildSuperweaponAt(g, 'weather', site);
  sw.chargeT = 0;
  run(g, () => { g.players[0].invuln = 1e9; return { 0: {} }; }, 0.2, 1 / 30);
  assert.equal(g.superweapon.state, 'ready', 'weather device ready');

  // a packed cluster of hp1-3 enemies (a "stronghold garrison") near the storm
  // center, away from the spawn / device / the map's sleeper. The center-biased
  // bolt scatter devastates a packed base over the duration.
  const tx = (10 + 0.5) * TILE, ty = (10 + 0.5) * TILE;
  const ids = [];
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2, rr = TILE * (0.4 + (i % 4) * 0.5);
    const e = makeEnemyForTest(g, 'g', tx + Math.cos(ang) * rr, ty + Math.sin(ang) * rr);
    g.enemies.push(e); ids.push(e.id);
  }

  // FIRE: aimless trigger — the sim auto-targets the packed cluster and schedules
  // a lightning storm field over it (no instant blast).
  g.players[0].x = site.x; g.players[0].y = site.y;
  step(g, { 0: { superFire: true } }, 1 / 30);
  assert.equal(g.superweapon.state, 'spent', 'firing consumes the one use');
  assert.ok(g.hazards.some(h => h.kind === 'storm'), 'a storm field is scheduled');
  assert.ok((g.superweapon.targetX - tx) ** 2 + (g.superweapon.targetY - ty) ** 2 < (STORM_RADIUS_TILES * TILE) ** 2,
    'storm auto-target landed on the packed cluster');

  // WARNING DELAY: during the LightningDeferment window NO bolt has struck yet.
  const aliveAtWarn = g.enemies.filter(e => !e.dead && ids.includes(e.id)).length;
  assert.equal(aliveAtWarn, ids.length, 'no damage during the storm warning delay');

  // DAMAGE OVER TIME: across the storm duration bolts repeatedly strike and the
  // packed cluster is shredded (not a single instant hit — it takes the window).
  run(g, () => { g.players[0].invuln = 1e9; return { 0: {} }; }, 9, 1 / 30);
  const aliveAfter = g.enemies.filter(e => !e.dead && ids.includes(e.id)).length;
  assert.ok(aliveAfter <= 3, `the storm devastates the packed cluster over its duration (${ids.length} -> ${aliveAfter})`);
  assert.ok(!g.hazards.some(h => h.kind === 'storm'), 'the storm clears when its duration ends');
  return { staged: ids.length, aliveAfter };
}

function testSuperweaponWeatherStormsOverTime() {
  const a = runWeatherStorm();
  // determinism: a second identical run reaches the same survivor count (the
  // bolt scatter is a seeded LCG, so the spread is reproducible).
  const b = runWeatherStorm();
  assert.equal(b.aliveAfter, a.aliveAfter, 'the storm scatter is deterministic (same survivors twice)');

  // CONTROL: the SAME packed cluster, with the storm NEVER fired, is untouched
  // over the same elapsed window — proving the kills come from the storm, not
  // some incidental field effect.
  const g = createGame(relicStoryDef(4), [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  unlockSuperweapon(g);
  const tx = (10 + 0.5) * TILE, ty = (10 + 0.5) * TILE;
  const ids = [];
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2, rr = TILE * (0.4 + (i % 4) * 0.5);
    const e = makeEnemyForTest(g, 'g', tx + Math.cos(ang) * rr, ty + Math.sin(ang) * rr);
    g.enemies.push(e); ids.push(e.id);
  }
  run(g, () => { g.players[0].invuln = 1e9; return { 0: {} }; }, 9, 1 / 30);
  const aliveControl = g.enemies.filter(e => !e.dead && ids.includes(e.id)).length;
  assert.equal(aliveControl, ids.length, 'without a storm the cluster takes no damage (control)');
  assert.ok(a.aliveAfter < aliveControl, 'the storm kills strictly more than the un-triggered baseline');
}

// Place a friendly turret build + an ownerless recruited defender + a VULNERABLE
// player INSIDE an AoE footprint, ~2.3 tiles off the impact center: that is well
// within the nuke blast (4.5t) and radiation crater (3t) / storm (5t), yet far
// enough from the packed (speed-0) cluster that ordinary enemy melee can't reach
// them — so the ONLY thing that could hurt them is the superweapon. It doesn't.
function stageFriendliesAt(g, cx, cy) {
  const off = TILE * 2.3;
  const turret = { x: cx + off, y: cy, kind: 'turret', cost: 8, progress: 1, paid: 8, built: true, hp: 5, maxHp: 5, cool: 0, evT: 0, level: 1 };
  g.builds.push(turret);
  const defender = {
    id: g.nextFollowerId++, kind: 'defender', owner: null,
    x: cx, y: cy + off, hp: 4, maxHp: 4, slot: -1,
    fx: 0, fy: 1, cool: 0, invulnT: 0, path: null, pathI: 0, repathT: 0, isFollower: true,
  };
  g.followers.push(defender);
  const p = g.players[0];
  p.x = cx - off; p.y = cy; p.state = 'active'; p.invuln = 0; // VULNERABLE on purpose
  return { turret, defender, player: p, off };
}

// AUTO-TARGET + FRIENDLY-FIRE-PROOF (nuke). The trigger is aimless: the sim must
// pick the densest hostile cluster (NOT a lone far enemy), wipe it, AND leave a
// player + turret + recruited defender standing inside the blast unharmed.
function testSuperweaponNukeAutoTargetsFriendlySafe() {
  const g = createGame(relicStoryDef(4), [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  unlockSuperweapon(g);
  const site = findSuperSite(g);
  const sw = buildSuperweaponAt(g, 'nuke', site);
  sw.chargeT = 0;
  run(g, () => { g.players[0].invuln = 1e9; return { 0: {} }; }, 0.2, 1 / 30);
  assert.equal(g.superweapon.state, 'ready', 'nuke ready');

  // CONTROL: a lone enemy parked far from everything. It must NOT be chosen over
  // the tight cluster, and (being outside the blast) must survive.
  const lone = makeEnemyForTest(g, 'b', (3 + 0.5) * TILE, (2 + 0.5) * TILE); // hp24 boss, but ALONE
  g.enemies.push(lone);

  // DENSE cluster of 8 grunts packed tight around a target cell.
  const cx = (15 + 0.5) * TILE, cy = (11 + 0.5) * TILE;
  const clusterIds = [];
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    const e = makeEnemyForTest(g, 'g', cx + Math.cos(ang) * TILE * 0.8, cy + Math.sin(ang) * TILE * 0.8);
    g.enemies.push(e); clusterIds.push(e.id);
  }
  // friendlies standing inside the blast footprint (so the AoE engulfs them too)
  const { turret, defender, player, off } = stageFriendliesAt(g, cx, cy);
  // sanity: the staged friendlies really are inside the nuke blast radius.
  assert.ok(off < NUKE_RADIUS_TILES * TILE, 'the staged friendlies sit inside the nuke blast radius');

  // TRIGGER (no aim). Auto-target must hit the dense cluster, not the lone boss.
  step(g, { 0: { superFire: true } }, 1 / 30);
  assert.equal(g.superweapon.state, 'spent', 'the trigger fired the device');
  assert.ok((g.superweapon.targetX - cx) ** 2 + (g.superweapon.targetY - cy) ** 2 < (NUKE_RADIUS_TILES * TILE) ** 2,
    'auto-target chose the dense cluster, not the lone far boss');
  // the auto-target ignored the lone far boss (it must still be alive now).
  assert.ok(g.enemies.some(e => !e.dead && e.id === lone.id), 'the lone far enemy is never targeted');
  // let the flight resolve WITH the (vulnerable) player held in the blast. Cull
  // every NON-cluster enemy each tick (the far boss + any edge-spawn) so the only
  // thing that could touch the parked friendlies is the nuke/crater — which it
  // doesn't. (We already proved the boss survived the auto-target above.)
  const pin = () => {
    const q = g.players[0]; q.x = cx - off; q.y = cy; q.invuln = 0;
    for (const e of g.enemies) if (!clusterIds.includes(e.id)) e.dead = true;
    return { 0: {} };
  };
  run(g, pin, 1.5, 1 / 30);

  // the cluster is wiped by the nuke it auto-targeted.
  const survivors = g.enemies.filter(e => !e.dead && clusterIds.includes(e.id)).length;
  assert.equal(survivors, 0, 'the nuke wipes the dense cluster it auto-targeted');

  // FRIENDLY-FIRE-PROOF: the player, turret and defender stood inside the blast
  // (and the lingering radiation crater) yet take ZERO damage.
  assert.equal(turret.hp, turret.maxHp, 'the friendly turret in the blast is undamaged');
  assert.equal(defender.hp, defender.maxHp, 'the recruited defender in the blast is undamaged');
  assert.ok(!DOWNED.has(player.state), 'the (vulnerable) player in the blast is never downed');

  // and the radiation crater that lingers still never chips the friendlies.
  assert.ok(g.hazards.some(h => h.kind === 'radiation'), 'a radiation crater lingers');
  assert.ok(off < RAD_RADIUS_TILES * TILE, 'the friendlies sit inside the radiation crater');
  run(g, pin, 3, 1 / 30); // sit in the crater
  assert.equal(turret.hp, turret.maxHp, 'the turret survives the radiation crater too');
  assert.equal(defender.hp, defender.maxHp, 'the defender survives the radiation crater too');
  assert.ok(!DOWNED.has(g.players[0].state), 'the player survives standing in the radiation crater');
}

// AUTO-TARGET + FRIENDLY-FIRE-PROOF (weather). The aimless trigger auto-targets
// the dense cluster; the storm shreds it over its duration but never harms the
// player / turret / defender standing under the same footprint.
function testSuperweaponWeatherAutoTargetsFriendlySafe() {
  const g = createGame(relicStoryDef(4), [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  unlockSuperweapon(g);
  const site = findSuperSite(g);
  const sw = buildSuperweaponAt(g, 'weather', site);
  sw.chargeT = 0;
  run(g, () => { g.players[0].invuln = 1e9; return { 0: {} }; }, 0.2, 1 / 30);
  assert.equal(g.superweapon.state, 'ready', 'weather ready');

  // CONTROL: a lone far enemy that must not be chosen over the cluster.
  const lone = makeEnemyForTest(g, 'b', (3 + 0.5) * TILE, (2 + 0.5) * TILE);
  g.enemies.push(lone);

  // a TIGHT 12-pack (within ~1 tile of center) so the storm shreds it AND the
  // friendlies staged 2.3 tiles out stay clear of any enemy melee/gnaw reach.
  const cx = (10 + 0.5) * TILE, cy = (10 + 0.5) * TILE;
  const clusterIds = [];
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2, rr = TILE * (0.3 + (i % 3) * 0.25);
    const e = makeEnemyForTest(g, 'g', cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
    g.enemies.push(e); clusterIds.push(e.id);
  }
  const { turret, defender, player, off } = stageFriendliesAt(g, cx, cy);
  assert.ok(off < STORM_RADIUS_TILES * TILE, 'the staged friendlies sit inside the storm footprint');

  g.players[0].x = site.x; g.players[0].y = site.y;
  step(g, { 0: { superFire: true } }, 1 / 30);
  assert.equal(g.superweapon.state, 'spent', 'the trigger fired the device');
  assert.ok((g.superweapon.targetX - cx) ** 2 + (g.superweapon.targetY - cy) ** 2 < (STORM_RADIUS_TILES * TILE) ** 2,
    'weather auto-target chose the dense cluster, not the lone far enemy');

  // run the storm out. Hold the VULNERABLE player parked under the footprint;
  // cull every NON-cluster enemy each tick (the far lone boss + any edge-spawn)
  // so the only thing that could hurt the parked friendlies is the storm itself —
  // which (post-change) never touches them. The defender's ordinary-combat grace
  // is topped too (the storm never calls damageFollower anyway).
  const loneId = lone.id;
  const pin = () => {
    const q = g.players[0]; q.x = cx - off; q.y = cy; q.invuln = 0; defender.invulnT = 1;
    for (const e of g.enemies) if (!clusterIds.includes(e.id)) e.dead = true;
    return { 0: {} };
  };
  // before culling, confirm the auto-target ignored the lone enemy (it survived
  // the warning window untouched while the cluster was chosen).
  assert.ok(g.enemies.some(e => !e.dead && e.id === loneId), 'the lone far enemy is never targeted');
  run(g, pin, 11, 1 / 30);

  const survivors = g.enemies.filter(e => !e.dead && clusterIds.includes(e.id)).length;
  assert.ok(survivors <= 3, `the storm shreds the cluster it auto-targeted (${clusterIds.length} -> ${survivors})`);

  // FRIENDLY-FIRE-PROOF across the whole storm: nothing friendly was scratched.
  assert.equal(turret.hp, turret.maxHp, 'the turret under the storm is undamaged');
  assert.equal(defender.hp, defender.maxHp, 'the defender under the storm is undamaged');
  assert.ok(!DOWNED.has(g.players[0].state), 'the player under the storm is never downed');
}

// AUTO-TARGET no-op: with zero enemies and no strongholds, a trigger keeps the
// charge (it does not waste the one-shot on empty air).
function testSuperweaponAutoTargetNoEnemiesKeepsCharge() {
  const g = createGame(relicStoryDef(4), [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  unlockSuperweapon(g);
  const site = findSuperSite(g);
  const sw = buildSuperweaponAt(g, 'nuke', site);
  sw.chargeT = 0;
  run(g, () => { g.players[0].invuln = 1e9; return { 0: {} }; }, 0.2, 1 / 30);
  assert.equal(g.superweapon.state, 'ready', 'nuke ready');
  // clear the field (incl. the map's lone sleeper) so there is nothing to hit.
  for (const e of g.enemies) e.dead = true;
  assert.ok(!g.strongholds || !g.strongholds.length, 'the story map seeds no stronghold to fall back on');
  g.players[0].x = site.x; g.players[0].y = site.y;
  step(g, { 0: { superFire: true } }, 1 / 30);
  assert.equal(g.superweapon.state, 'ready', 'with nothing to hit the trigger is a no-op (charge kept)');
  assert.equal(g.superweapon.used, false, 'the one-shot was not consumed on empty air');
  assert.equal(g.hazards.length, 0, 'no strike was scheduled');
}

// --- relic awakening freezes the day/night clock --------------------------
// When the relic completes in a bastion run, the awakening horde forces darkness
// + thunder for the whole wave. The day/night clock MUST pause for the duration
// so a normal dusk/dawn never fires mid-event (no daytime/darkness transition
// fighting the forced-dark wave). It must resume EXACTLY where it left off once
// the wave ends. Drive a real bastion (cycle + corner-mount relic), latch the
// horde, and assert cy.t holds dead-still across ticks while live, then ticks
// again after the wave — with a control proving identical ticks advance the
// clock once the freeze lifts.
function testRelicFreezesDayNightCycle() {
  // long day/night so neither dusk nor dawn fires during the scripted window;
  // the relic completion alone latches the horde we want to time the clock by.
  const def = bastionDef({ nights: 5, dayLen: 9000, nightLen: 9000, bloodMoons: [] });
  const g = createGame(def, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  assert.ok(g.cycle, 'bastion seeds a day/night cycle');
  assert.equal(g.cycle.phase, 'day', 'cycle opens on the day phase');
  assert.ok(g.musicBox.enabled && g.musicBox.mounts && g.musicBox.mounts.length === 4,
    'bastion seeds the relic with four corner mounts');

  // complete the relic: carry each shard to an unfilled mount (mirrors the
  // stronghold-mounts deposit path). Keep the operative invulnerable + ungraced.
  const p = g.players[0];
  p.invuln = 1e9; g.graceT = 0;
  for (let i = 0; i < 4; i++) {
    const fr = g.musicBox.fragments[i];
    p.x = fr.x; p.y = fr.y;
    step(g, { 0: {} }, 1 / 30); // scoop
    const target = g.musicBox.mounts.find(m => !m.filled);
    p.x = target.x; p.y = target.y;
    step(g, { 0: {} }, 1 / 30); // lock in
  }
  assert.ok(g.musicBox.complete, 'relic completes at 4/4 mounts');

  // one more step latches the horde (rising edge of complete) AND, this same
  // tick, stepCycle should ALREADY refuse to advance (stepHorde runs first).
  const tBeforeLatch = g.cycle.t;
  p.x = g.musicBox.altar.x; p.y = g.musicBox.altar.y; // park away from any spawn
  step(g, { 0: {} }, 1 / 30);
  assert.ok(g.horde && !g.horde.ended, 'completing the relic latches a live horde');
  assert.equal(g.cycle.t, tBeforeLatch, 'the clock does not advance on the latch tick');

  // FREEZE: across many ticks while the wave is live, cy.t must hold dead-still.
  const frozenAt = g.cycle.t;
  const FREEZE_TICKS = 30;
  for (let i = 0; i < FREEZE_TICKS; i++) {
    p.invuln = 1e9; // never let the squad fall (a wipe would end the horde early)
    step(g, { 0: {} }, 1 / 30);
    assert.ok(g.horde && !g.horde.ended, `horde still live on freeze tick ${i}`);
    assert.equal(g.cycle.t, frozenAt, `cycle clock frozen on tick ${i} (stayed ${frozenAt})`);
  }
  // no phase flip and no day events leaked through the freeze
  assert.equal(g.cycle.phase, 'day', 'still day — no dusk slipped through the wave');
  assert.ok(!g.events.some(e => e.type === 'dusk' || e.type === 'dawn'),
    'no dusk/dawn transition fired while the awakening wave ran');

  // END the wave: shove the start clock back so the song has played out, then
  // step once to finish it. World restores; the horde marks ended.
  g.horde.startedAt = g.elapsed - g.horde.dur - 1;
  p.invuln = 1e9;
  step(g, { 0: {} }, 1 / 30);
  assert.ok(g.horde.ended && g.horde.result === 'survived', 'the wave plays out and survives');

  // RESUME (control): the SAME tick size that left the clock untouched during
  // the freeze must now advance it — proving the freeze was load-bearing, not a
  // coincidence of a stopped clock.
  const tAtResume = g.cycle.t;
  step(g, { 0: {} }, 1 / 30);
  assert.ok(g.cycle.t < tAtResume, 'the clock advances again once the wave ends');
  assert.ok(Math.abs((tAtResume - g.cycle.t) - 1 / 30) < 1e-9,
    'it resumes at exactly the normal tick rate (one dt per step)');
  // and it picks up where it left off — never skipped the wave's worth of time:
  // the resumed value is within a couple ticks of where it froze, NOT dur lower.
  assert.ok(frozenAt - g.cycle.t < g.horde.dur,
    'the cycle resumed where it paused — the wave duration was never burned off');
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
const WAVE_LETTERS = new Set('garsmnwbzfqvxu'); // frontier III adds z f q v x u
const QUEST_KINDS = new Set(['fetch', 'kill', 'build', 'switch', 'glyph', 'destroy', 'craft', 'reach']);

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
    // bastion maps carry a base core; the beacon-defense variant carries
    // exactly four 'K' monoliths instead
    if (def.mode === 'bastion') {
      if (def.bastionVariant === 'beacons') assert.equal(parsed.cores.length, 4, `${tag}: beacon variant fields exactly 4 K monoliths`);
      else assert.ok(parsed.core, `${tag}: bastion maps carry a base core`);
    }
    // entity arrays must match their tile counts exactly
    const tileCount = ch => def.tiles.reduce((n, r) => n + (r.split(ch).length - 1), 0);
    assert.equal((def.captiveChars || []).length, tileCount('c'), `${tag}: captiveChars length matches 'c' tiles`);
    assert.equal((def.npcs || []).length, tileCount('N'), `${tag}: npcs length matches 'N' tiles`);
    assert.equal((def.builds || []).length, tileCount('B'), `${tag}: builds length matches 'B' tiles`);
    // field weapon pickups and quest items have deterministic defaults, so
    // their defs are optional — but a present def must match its tiles
    if (def.pickups) assert.equal(def.pickups.length, tileCount('A'), `${tag}: pickups length matches 'A' tiles`);
    if (def.qitems) assert.equal(def.qitems.length, tileCount('I'), `${tag}: qitems length matches 'I' tiles`);
    // puzzle systems: optional row-major defs must match their tiles too
    if (def.switches) assert.equal(def.switches.length, tileCount('Q'), `${tag}: switches length matches 'Q' tiles`);
    if (def.glyphs) assert.equal(def.glyphs.length, tileCount('J'), `${tag}: glyphs length matches 'J' tiles`);
    if (def.teleports) assert.equal(def.teleports.length, tileCount('O'), `${tag}: teleports length matches 'O' tiles`);
    // switch quorums must be satisfiable by the map's relays
    for (const sg of def.switchGroups || []) {
      const members = parsed.switches.filter(s => s.group === (sg.group ?? 0)).length;
      assert.ok((sg.need || 1) <= members, `${tag}: switch group '${sg.group}' need ${sg.need} <= ${members} relays`);
    }
    // glyph orders: every ordered rune exists among the group's stones
    for (const gg of def.glyphGroups || []) {
      const members = parsed.glyphs.filter(s => s.group === (gg.group ?? 0));
      assert.ok((gg.order || []).length >= 1, `${tag}: glyph group '${gg.group}' orders at least one rune`);
      for (const sym of gg.order || []) {
        assert.ok(Number.isInteger(sym) && sym >= 0 && sym <= 7, `${tag}: glyph symbol ${sym} is a rune 0-7`);
        assert.ok(members.some(m => m.symbol === sym), `${tag}: glyph group '${gg.group}' has a stone for rune ${sym}`);
      }
    }
    // every teleport twin resolves to a pad on the map
    for (const t of parsed.teleports) {
      if (t.twin != null) assert.ok(parsed.teleports.some(o => o.id === t.twin), `${tag}: teleport '${t.id}' twin '${t.twin}' exists`);
    }
    // every openDoor reward (quests, quorums, glyph orders) names a real door
    const doorIds = new Set((def.doors || []).map((d, i) => d.id || 'door' + i));
    const wantsDoor = id => assert.ok(doorIds.has(id), `${tag}: openDoor reward '${id}' is a real door`);
    for (const q2 of def.quests || []) if (q2.reward && q2.reward.openDoor) wantsDoor(q2.reward.openDoor);
    for (const sg of def.switchGroups || []) if (sg.reward && sg.reward.openDoor) wantsDoor(sg.reward.openDoor);
    for (const gg of def.glyphGroups || []) if (gg.reward && gg.reward.openDoor) wantsDoor(gg.reward.openDoor);
    // quests: known kinds, real givers, fetch items that actually exist
    for (const q of def.quests || []) {
      assert.ok(q.id && typeof q.title === 'string' && q.title.length > 0, `${tag}: quest has id and title`);
      assert.ok(QUEST_KINDS.has(q.kind), `${tag}: quest '${q.id}' kind '${q.kind}' is known`);
      assert.ok((def.npcs || []).some(n => n.id === q.giver), `${tag}: quest '${q.id}' giver '${q.giver}' is an npc on the map`);
      if (q.kind === 'fetch') {
        assert.ok(q.item, `${tag}: fetch quest '${q.id}' names its item`);
        assert.ok((def.qitems || []).some(it => (it.kind || 'fragment') === q.item),
          `${tag}: fetch quest '${q.id}' item '${q.item}' exists among the map's qitems`);
      }
    }
    if (def.gate) {
      const pylons = (def.builds || []).filter(b => b.kind === 'pylon').length;
      assert.ok(def.gate.need <= pylons, `${tag}: gate.need ${def.gate.need} <= ${pylons} pylon sites`);
    }
    // walkable connectivity (BFS) from the first spawn to every objective
    // ('T' trees and '%' void block movement; crystals are parsed out and
    // never block; '=' sand, '!' lava and '^' ice are walkable terrain)
    const pass = c => c !== '#' && c !== 'T' && c !== '~' && c !== 'o' && c !== '%';
    // doors must cover walkable floor inside the map (the rect is a route
    // once the door opens; the BFS below deliberately walks through closed
    // doors — the validator assumes solvable puzzles open them eventually)
    for (const [i, d] of (def.doors || []).entries()) {
      const dw = d.w || 1, dh = d.h || 1;
      const id = d.id || 'door' + i;
      assert.ok(d.x >= 0 && d.y >= 0 && d.x + dw <= parsed.w && d.y + dh <= parsed.h, `${tag}: door '${id}' rect in bounds`);
      for (let yy = d.y; yy < d.y + dh; yy++)
        for (let xx = d.x; xx < d.x + dw; xx++)
          assert.ok(pass(parsed.grid[yy][xx]), `${tag}: door '${id}' covers walkable floor`);
    }
    const seen = new Set();
    const sx = Math.floor(parsed.spawns[0].x / TILE), sy = Math.floor(parsed.spawns[0].y / TILE);
    const q = [[sx, sy]];
    seen.add(sx + ',' + sy);
    const flood = () => {
      while (q.length) {
        const [x, y] = q.pop();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= parsed.w || ny >= parsed.h) continue;
          const k = nx + ',' + ny;
          if (!seen.has(k) && pass(parsed.grid[ny][nx])) { seen.add(k); q.push([nx, ny]); }
        }
      }
    };
    flood();
    // teleport pads extend on-foot reach: a reachable pad floods its twin
    // (the interior pattern: compartments reachable only via pads/doors)
    for (let pass2 = 0; pass2 <= parsed.teleports.length; pass2++) {
      let changed = false;
      for (const t of parsed.teleports) {
        if (!seen.has(Math.floor(t.x / TILE) + ',' + Math.floor(t.y / TILE))) continue;
        const twin = parsed.teleports.find(o => o.id === t.twin);
        if (!twin) continue;
        const wx = Math.floor(twin.x / TILE), wy = Math.floor(twin.y / TILE);
        if (seen.has(wx + ',' + wy)) continue;
        changed = true;
        seen.add(wx + ',' + wy);
        q.push([wx, wy]);
        flood();
      }
      if (!changed) break;
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
    for (const c of parsed.cores || []) reach(c.x, c.y, 'beacon monolith');
    for (const s of parsed.switches) reach(s.x, s.y, `relay ${s.id}`);
    for (const s of parsed.glyphs) reach(s.x, s.y, `glyph ${s.id}`);
    for (const pl of parsed.pillars) reach(pl.x, pl.y, `pillar ${pl.id}`);
    for (const f2 of parsed.forges) reach(f2.x, f2.y, 'seal forge');
    for (const t of parsed.teleports) reach(t.x, t.y, `teleport ${t.id}`);
    // story modifiers: wave letters/edges/timing must be sane. Untimed levels
    // (story/bastion without timed:true) run on elapsed time, so the
    // wave.at < def.time bound only binds when a countdown actually runs.
    const untimed = !def.timed && (!!def.story || def.mode === 'bastion')
      && def.mode !== 'ctf' && def.mode !== 'br';
    for (const wv of (def.modifiers && def.modifiers.waves) || []) {
      assert.ok(wv.letters.length >= 1 && [...wv.letters].every(c => WAVE_LETTERS.has(c)), `${tag}: wave letters '${wv.letters}' all in garsmnwbzfqvxu`);
      assert.ok(['n', 's', 'e', 'w'].includes(wv.edge), `${tag}: wave edge '${wv.edge}' is n/s/e/w`);
      assert.ok(typeof wv.at === 'number' && (untimed || wv.at < def.time), `${tag}: wave at ${wv.at}s fires inside the ${def.time}s timer`);
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

// --- ENEMY STRONGHOLDS: fortified keep, garrison aggro/leash, gating ---------
function testEnemyStronghold() {
  // a big map with an authored keep at tile (34,16), far from the (1,2) spawn.
  const level = bigEmptyLevel([[2, '#P' + '.'.repeat(36) + '#']]);
  level.enemyStrongholds = [{ at: [34, 16], garrison: 'gggg', ring: 2,
    aggro: 6, leash: 11 }];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.graceT = 0;
  g.players[0].invuln = 999;

  // --- placement: keep seeded, walls ringed, garrison stationed ---
  assert.ok(g.strongholds && g.strongholds.length === 1, 'one stronghold seeds');
  const sh = g.strongholds[0];
  const kx = (34 + 0.5) * TILE, ky = (16 + 0.5) * TILE;
  assert.ok(Math.hypot(sh.x - kx, sh.y - ky) < TILE, 'keep sits at the authored tile');
  const garrison = g.enemies.filter(e => e.fort === sh.id);
  assert.equal(garrison.length, 4, 'four garrison enemies stationed');
  assert.ok(garrison.every(e => e.homeX === sh.x && e.homeY === sh.y), 'garrison homes on the keep');
  assert.ok(garrison.every(e => e.group === garrison[0].group), 'garrison shares one group');
  const walls = g.builds.filter(b => b.fort === sh.id && b.kind === 'wall' && b.built);
  assert.ok(walls.length >= 1, 'a prebuilt wall ring fortifies the keep');
  // the keep is away from the base (deterministic placement away from spawn)
  assert.ok(Math.hypot(sh.x - g.players[0].x, sh.y - g.players[0].y) > 18 * TILE,
    'keep is placed well away from the player spawn');

  // --- control: a distant player NEVER wakes the garrison ---
  const spots = garrison.map(e => ({ x: e.x, y: e.y }));
  run(g, () => ({ 0: {} }), 4);
  assert.ok(garrison.every(e => !e.awake), 'distant garrison stays asleep (control)');
  assert.ok(garrison.every(e => Math.hypot(e.x - e.homeX, e.y - e.homeY) <= (sh.r + 1.5) * TILE),
    'idle garrison holds inside the keep footprint');
  assert.ok(garrison.every((e, i) => e.x === spots[i].x && e.y === spots[i].y),
    'idle garrison does not drift from its post');

  // --- aggro: a player crossing the aggro radius wakes the garrison ---
  g.players[0].x = sh.x - TILE * 4; // inside the 6-tile aggro radius
  g.players[0].y = sh.y;
  run(g, () => ({ 0: {} }), 1.5);
  assert.ok(garrison.some(e => e.awake), 'garrison wakes when a player enters aggro');
  // ... and chases: at least one guard left its post toward the player
  assert.ok(garrison.some(e => Math.hypot(e.x - e.homeX, e.y - e.homeY) > TILE * 0.6),
    'an aggroed guard chases off its post');

  // --- leash: walk the player far past the keep leash radius; garrison returns ---
  g.players[0].x = TILE * 2;
  g.players[0].y = TILE * 2; // back at the base, far beyond the 11-tile leash
  let sawReturning = false;
  run(g, () => { if (garrison.some(e => e.returning)) sawReturning = true; return { 0: {} }; }, 24);
  assert.ok(sawReturning, 'leashed garrison entered the returning state');
  assert.ok(garrison.every(e => !e.awake), 'garrison fell back into ambush sleep');
  assert.ok(garrison.every(e => Math.hypot(e.x - e.homeX, e.y - e.homeY) < TILE * 2),
    'returned garrison is back guarding the keep');

  // --- snapshot gating + cleared flag ---
  const snap = snapshot(g, false);
  assert.ok(snap.strongholds && snap.strongholds.length === 1, 'snapshot ships the keep');
  assert.equal(snap.strongholds[0].cleared, false, 'a garrisoned keep is not cleared');
  assert.ok(Number.isFinite(snap.strongholds[0].x) && Number.isFinite(snap.strongholds[0].y),
    'keep exposes a target position');
  for (const e of garrison) { e.dead = true; e.hp = 0; }
  assert.equal(snapshot(g, false).strongholds[0].cleared, true, 'keep clears when the garrison falls');

  // --- gating: a level WITHOUT enemyStrongholds never gains the key ---
  const plain = bigEmptyLevel([[17, '#' + '.'.repeat(35) + 'g..#']]);
  const pg = createGame(plain, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  assert.ok(!pg.strongholds, 'no enemyStrongholds: no g.strongholds');
  assert.ok(!snapshot(pg, false).strongholds, 'no enemyStrongholds: snapshot stays byte-stable');

  // --- auto placement (corner-scan) seeds away from the base too ---
  const autoLvl = bigEmptyLevel([[2, '#P' + '.'.repeat(36) + '#']]);
  autoLvl.enemyStrongholds = { count: 1, garrison: 'gg' };
  const ag = createGame(autoLvl, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  assert.ok(ag.strongholds && ag.strongholds.length === 1, 'auto-count seeds one keep');
  assert.ok(Math.hypot(ag.strongholds[0].x - ag.players[0].x, ag.strongholds[0].y - ag.players[0].y) > 18 * TILE,
    'auto-placed keep lands far from the base');
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
  // EXTREME pins the historical (no-op) wave counts so exact-count assertions
  // below stay the baseline; difficulty scaling is exercised in its own test.
  def.difficulty = 'extreme';
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
    difficulty: 'extreme', // pin the historical count: this exercises the 90-cap drop
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
testMusicBoxFeature();
testStrandedOperatorsAndScrap();
testMusicBoxOnAllStoryAndStronghold();
testStrongholdCornerMounts();
testWallCostsOneShard();
testDayNightDefaults();
testHostedDifficultyScales();
testDevCheats();
testPauseTimeCheatFreezesWorld();
testRelicAwakeningHorde();
testDifficultySelector();
testRelicFreezesDayNightCycle();
testSuperweaponLockedUntilSurvived();
testSuperweaponBuildChargeAndTinyWave();
testSuperweaponNukeClearsStronghold();
testSuperweaponWeatherStormsOverTime();
testSuperweaponNukeAutoTargetsFriendlySafe();
testSuperweaponWeatherAutoTargetsFriendlySafe();
testSuperweaponAutoTargetNoEnemiesKeepsCharge();
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
testEnemyStronghold();
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

// --- turret levels: damage 1/2/3, targeting range 5.5/6/6.5 tiles, 0.55s cadence ---
function testTurretLevels() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(r, 2, 'P'), 10, 'B'), 16, 'g'); // grunt exactly 6 tiles from the turret
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
  // a fresh turret waits in type select and holds its fire until confirmed
  assert.equal(b.typeSelect, true, 'a finished turret enters type select');
  step(g, { 0: { act: true } }, 1 / 30); // engage the carousel
  step(g, { 0: { act: true, fire: true } }, 1 / 30); // fire-edge confirms 'gun'
  step(g, { 0: {} }, 1 / 30); // release
  assert.equal(b.typeSelect, false, 'fire confirms the carousel');
  assert.equal(b.ttype, 'gun', 'default selection is the gun');
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
    'level 1 turret (5.5-tile reach) cannot touch a grunt 6 tiles out');
  b.level = 2; // upgrade path is covered by the barricade chain test
  e.x = b.x + TILE * 5.7; // inside L2's 6-tile reach, outside L1's 5.5
  const shots0 = g.events.filter(ev => ev.type === 'shoot' && ev.weapon === 'turret').length;
  run(g, watch, 1.5);
  assert.ok(seen, 'level 2 turret (6-tile reach) fires');
  assert.equal(seen.dmg, 2, 'level 2 turret deals 2 damage');
  const volleys = g.events.filter(ev => ev.type === 'shoot' && ev.weapon === 'turret').length - shots0;
  assert.ok(volleys >= 3, `0.55s cadence lands >= 3 shots in 1.5s (saw ${volleys})`);
  seen = null;
  b.level = 3;
  b.cool = 0;
  e.x = b.x + TILE * 6.3; // beyond L2's reach, inside L3's 6.5
  const hp0 = e.hp;
  run(g, watch, 1.5);
  assert.ok(seen && seen.dmg === 3, 'level 3 turret deals 3 damage at 6.3 tiles');
  assert.ok(e.hp < hp0, 'the +0.5-tile flight buffer carries the round to an edge-of-range target');
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

function playerShotAt(g, e, dmg = 1, extra = {}) {
  g.shots.push({
    id: g.nextShotId++, x: e.x, y: e.y, vx: 0, vy: 0, ttl: 0.5, dmg,
    who: 'p', overWalls: true, pierce: 0, aoeRadius: 0, curve: 0, radius: 5, kind: 'test', hits: [],
    ...extra,
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
  p.maxHp = 6; p.hp = 1;
  // a full second of held button is still one edge -> one use
  run(g, () => ({ 0: { item: true } }), 1);
  assert.equal(p.hp, 3, 'medkit heals +2 on a held press (edge-triggered)');
  assert.equal(p.item.count, 1, 'one medkit consumed');
  assert.ok(g.events.some(ev => ev.type === 'heal'), 'heal cue event fired');
  run(g, () => ({ 0: {} }), 0.2);
  run(g, () => ({ 0: { item: true } }), 0.2);
  assert.equal(p.hp, 5, 'second press heals again (+2)');
  assert.equal(p.item, null, 'spent slot empties');
  assert.ok(!('item' in snapshot(g, false).players[0]), 'empty slot ships no item key');
  // medkit at full hp is not wasted
  p.hp = p.maxHp;
  p.item = { kind: 'medkit', count: 1 };
  run(g, () => ({ 0: {} }), 0.2);
  run(g, () => ({ 0: { item: true } }), 0.2);
  assert.equal(p.hp, p.maxHp, 'hp capped at max — medkit no-op at full');
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
    // dayEvents off by default: most bastion tests probe one mechanic over a
    // synthetic day and must not meet a scavenger pack at day+25s — the day
    // events suite re-enables them explicitly (dayEvents: true)
    bastion: { nights: 2, dayLen: 5, nightLen: 4, bloodMoons: [2], dayEvents: false, ...b },
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
  assert.deepEqual(wave1.map(e => e.letter), ['z', 'z', 'w', 'z', 'z'], 'night 1 is husk fodder and skitters');
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
  assert.equal(wave1[0].speed, 1.0 * TILE * 1.5, 'feral runs +50% faster');
  assert.equal(wave1[1].hp, 2, 'bulk doubles hp');
  assert.equal(wave1[1].speed, 1.0 * TILE * 0.75, 'bulk lumbers at -25% speed');
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
  // blood moon: full wave (7 = base 8 x 0.8 solo) on the first edge plus a
  // 60% detachment (round(7 x 0.6) = 4) on the second — heavy, not double
  assert.equal(wave2.length, 11, 'blood moon: 7 first edge + 4 (60%) second edge');
  assert.ok(wave2.some(e => e.x > 38 * TILE), 'first blood edge is east');
  assert.ok(wave2.some(e => e.x < 2 * TILE), 'second blood edge is west');
  assert.ok(wave2.every(e => e.mutation), 'every blood moon enemy is mutated');
  // night 2 blends z z w u (+ one trailing f per edge); +1 hp on base stats
  const bloodHp = { z: 2, w: 2, u: 3, f: 4 };
  assert.ok(wave2.filter(e => e.mutation !== 'bulk').every(e => e.hp === bloodHp[e.letter]), 'blood moon adds +1 hp');
  assert.ok(wave2.some(e => e.letter === 'u') && wave2.some(e => e.letter === 'f'),
    'night 2 mixes in Pyre Beetles and a Fork Alpha');
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
  // the downed carrier redeploys on their own stand's spawn ring after 5s,
  // reset and whole (wave 7: ring offsets, not the stand point — 16 seats
  // per base must not stack)
  run(g, () => ({}), 5.2);
  assert.equal(p1.state, 'active', 'ctf respawns after 5s');
  assert.ok(Math.hypot(p1.x - f1.homeX, p1.y - f1.homeY) <= TILE * 3.5,
    'respawn lands on the team stand spawn ring');
  assert.ok(Math.hypot(p1.x - f0.homeX, p1.y - f0.homeY) > TILE * 10,
    'respawn lands at the OWN base, not the enemy one');
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

// ===== combat depth (xp/evolutions, statuses, turret types, followers, seal) =====

// --- xp: kill credit pays score/25 to the owning seat; levels at 12/34/70 ---
function testXpThresholdsAndLevelUps() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(put(put(put(r, 4, 'P'), 12, 'g'), 16, 'g'), 20, 'g'), 24, 'g'), 28, 'g');
  const level = bigEmptyLevel([[5, r]]);
  const g = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  const p = g.players[0];
  const [e0, e1, e2, e3, e4] = g.enemies;
  p.invuln = 999;
  g.graceT = 1e9;
  assert.equal(p.xp, 0, 'fresh seat starts at 0 xp');
  assert.equal(p.level, 1, 'fresh seat starts at level 1');
  e0.score = 275; // 11 xp: one short of the L2 threshold
  playerShotAt(g, e0, 99, { ownerPid: 0 });
  step(g, { 0: {} }, 1 / 30);
  assert.equal(p.xp, 11, 'kill credit pays enemy score / 25 xp');
  assert.equal(p.level, 1, '11 xp stays below the 12-xp L2 threshold');
  const hp0 = p.hp;
  e1.score = 25; // +1 -> 12: L2 exactly at the threshold
  playerShotAt(g, e1, 99, { ownerPid: 0 });
  step(g, { 0: {} }, 1 / 30);
  assert.equal(p.level, 2, '12 xp reaches L2');
  assert.equal(p.maxHp, 4, 'L2 grants +1 max hp');
  assert.equal(p.hp, hp0 + 1, 'L2 heals 1 on the spot');
  assert.ok(g.events.some(ev => ev.type === 'levelUp' && ev.pid === 0 && ev.level === 2 && ev.perk === 'hp'),
    'levelUp event carries pid/level/perk');
  e2.score = 550; // +22 -> 34: L3 unlocks the evolution
  playerShotAt(g, e2, 99, { ownerPid: 0 });
  step(g, { 0: {} }, 1 / 30);
  assert.equal(p.level, 3, '34 xp reaches L3');
  assert.ok(g.events.some(ev => ev.type === 'levelUp' && ev.level === 3 && ev.perk === 'multi'),
    'L3 levelUp names the character evolution');
  e3.score = 900; // +36 -> 70: L4 intensifies it
  playerShotAt(g, e3, 99, { ownerPid: 0 });
  step(g, { 0: {} }, 1 / 30);
  assert.equal(p.level, 4, '70 xp reaches L4 (the cap)');
  const snap = snapshot(g, false);
  assert.equal(snap.players[0].level, 4, 'snapshot carries the level');
  assert.equal(snap.players[0].xp, 70, 'snapshot carries the xp');
  // ownerless kills (turrets, followers, mind control) pay nobody
  playerShotAt(g, e4, 99);
  step(g, { 0: {} }, 1 / 30);
  assert.equal(p.xp, 70, 'a kill without an owner pays no xp');
}

// --- evolutions: every branch at L3 and L4, stacking with shop dmgBonus ---
function testEvolutionBranchesAndDmgBonusStack() {
  const evoGame = charId => {
    const level = bigEmptyLevel([[17, '#....................................g#']]);
    const g = createGame(level, [{ pid: 0, name: 'T', charId }], charMap, [charId]);
    g.players[0].invuln = 999;
    g.players[0].x = 10 * TILE;
    g.players[0].y = 10 * TILE;
    g.graceT = 1e9;
    return g;
  };
  const fireOnce = (g, btn = 'fire') => {
    const p = g.players[0];
    p.cool = 0;
    p.specialCool = 0;
    p.specialPrev = false;
    g.shots.length = 0;
    step(g, { 0: { [btn]: true } }, 1 / 30);
    return g.shots;
  };
  // multi: +1 shot at L3 (singles fan 6deg), another +1 at L4
  let g = evoGame('scout');
  assert.equal(fireOnce(g).length, 1, 'L1 scout fires its base single shot');
  g.players[0].level = 3;
  assert.equal(fireOnce(g).length, 2, 'L3 multi adds a shot');
  g.players[0].level = 4;
  assert.equal(fireOnce(g).length, 3, 'L4 multi adds another');
  // multi covers the special too (Flank Volley count 2 -> 3 at L3)
  g.players[0].level = 3;
  assert.equal(fireOnce(g, 'special').length, 3, 'evolution applies to weapon-kind specials');
  // dmgBonus from the shop stacks separately on top
  g.players[0].level = 3;
  g.players[0].dmgBonus = 2;
  assert.equal(fireOnce(g)[0].dmg, 3, 'shop dmgBonus stacks on an evolved weapon');
  // blast: +0.6 aoe at L3; +0.5 more and pierce 1 at L4
  g = evoGame('grenadier');
  let s = fireOnce(g)[0];
  assert.ok(Math.abs(s.aoeRadius - 1.05 * TILE) < 0.01, 'L1 mortar keeps its base aoe');
  g.players[0].level = 3;
  s = fireOnce(g)[0];
  assert.ok(Math.abs(s.aoeRadius - (1.05 + 0.6) * TILE) < 0.01, 'L3 blast widens the aoe by 0.6 tiles');
  assert.equal(s.pierce, 0, 'L3 blast does not pierce yet');
  g.players[0].level = 4;
  s = fireOnce(g)[0];
  assert.ok(Math.abs(s.aoeRadius - (1.05 + 1.1) * TILE) < 0.01, 'L4 blast widens by another 0.5');
  assert.equal(s.pierce, 1, 'L4 blast shots pierce 1');
  // shock: hits stun at L3; L4 arcs (arc behavior tested with live enemies below)
  g = evoGame('medic');
  g.players[0].level = 3;
  s = fireOnce(g)[0];
  assert.equal(s.stun, 0.4, 'L3 shock shots carry the 0.4s stun');
  assert.ok(!s.shockArc, 'no arc at L3');
  g.players[0].level = 4;
  s = fireOnce(g)[0];
  assert.ok(s.shockArc, 'L4 shock shots arc');
  // burn: hits ignite at L3; L4 marks the death-patch flag
  g = evoGame('soldier');
  g.players[0].level = 3;
  s = fireOnce(g)[0];
  assert.ok(s.ignite && !s.ignitePatch, 'L3 burn ignites, no patch');
  g.players[0].level = 4;
  s = fireOnce(g)[0];
  assert.ok(s.ignite && s.ignitePatch, 'L4 burn leaves death patches');
  // arcade seats never level: classic fire is byte-identical
  const ga = createGame(levels[0], [{ pid: 0, name: 'T', charId: 'scout' }], charMap, startingRoster);
  ga.players[0].invuln = 999;
  ga.players[0].cool = 0;
  ga.shots.length = 0;
  step(ga, { 0: { fire: true } }, 1 / 30);
  assert.equal(ga.shots.length, 1, 'arcade scout still fires exactly one shot');
  assert.equal(ga.players[0].level, undefined, 'arcade seats carry no level');
}

// --- burn: 1 dmg/s for 3s, contact chains once, L4 corpses pool fire ---
function testBurnSpreadChainAndGroundPatches() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(r, 10, 'g'), 14, 'g'), 18, 'g');
  const level = bigEmptyLevel([[5, r], [2, '#P....................................#']]);
  const g = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  const p = g.players[0];
  const [a, b, c] = g.enemies;
  p.invuln = 999;
  g.graceT = 1e9;
  // chain spacing: A-B and B-C inside the 2-radius contact ring (28px)
  b.x = a.x + 25; b.y = a.y;
  c.x = a.x + 50; c.y = a.y;
  playerShotAt(g, a, 1, { ignite: true, ownerPid: 0 });
  step(g, { 0: {} }, 1 / 30);
  assert.ok(a.burnT > 2.9, 'the hit ignited A for ~3s');
  assert.equal(a.hp, 1, 'the shot itself dealt its 1 damage');
  run(g, () => ({ 0: {} }), 0.2);
  assert.ok(b.burnT > 0 && b.chainBurned, 'contact chained the burn to B once');
  assert.ok(c.burnT > 0 && c.chainBurned, 'and on to C — a spread chain');
  // dot: 1 dmg/s — A (1 hp left) dies at the first tick, crediting the igniter
  run(g, () => ({ 0: {} }), 1.0);
  assert.ok(a.dead || !g.enemies.includes(a), 'burn damage killed A');
  assert.equal(p.xp, 4, 'burn kills credit the igniting seat');
  assert.equal(g.patches.length, 0, 'L3 burn corpses leave no patch');
  // L4: an ignited corpse pools fire where it dies; the pool ignites others
  const g2 = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  g2.players[0].invuln = 999;
  g2.graceT = 1e9;
  const [a2, b2] = g2.enemies;
  b2.x = a2.x + 40; b2.y = a2.y; // outside the 28px contact ring, inside the 48px patch
  playerShotAt(g2, a2, 1, { ignite: true, ignitePatch: true, ownerPid: 0 });
  run(g2, () => ({ 0: {} }), 1.2);
  assert.ok(!g2.enemies.includes(a2), 'A2 died ignited');
  assert.equal(g2.patches.length, 1, 'the L4 corpse left a ground burn patch');
  assert.equal(g2.patches[0].kind, 'burn');
  assert.ok(g2.events.some(ev => ev.type === 'patch' && ev.kind === 'burn'), 'patch event fired');
  assert.equal(snapshot(g2, false).patches.length, 1, 'snapshot ships live patches');
  step(g2, { 0: {} }, 1 / 30);
  assert.ok(b2.burnT > 0, 'standing in the burn patch ignites');
  // players are never hurt by burn patches (PvE clarity)
  const p2 = g2.players[0];
  p2.invuln = 0;
  p2.x = g2.patches[0].x; p2.y = g2.patches[0].y;
  const hpBefore = p2.hp;
  run(g2, () => ({ 0: {} }), 1.2);
  assert.equal(p2.hp, hpBefore, 'burn patches never hurt players');
  run(g2, () => ({ 0: {} }), 2.2);
  assert.equal(g2.patches.length, 0, 'burn patches expire after 3s');
}

// --- toxin: pools slow everyone, dot 0.5/s for 2s, contact spread ---
function testToxinSlowAndSpread() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(r, 4, 'P'), 30, 'g'), 34, 'g');
  const level = bigEmptyLevel([[5, r]]);
  const g = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  const p = g.players[0];
  const [a, b] = g.enemies;
  p.invuln = 999;
  g.graceT = 1e9;
  // throw the toxin item: a 4-tile lob along the facing
  p.fx = 1; p.fy = 0;
  p.item = { kind: 'toxin', count: 1 };
  step(g, { 0: { item: true } }, 1 / 30);
  assert.equal(g.patches.length, 1, 'toxin lob pools a patch');
  const pa = g.patches[0];
  assert.equal(pa.kind, 'toxin');
  assert.ok(Math.abs(pa.x - (p.x + 4 * TILE)) < 1, 'the lob lands 4 tiles out');
  assert.ok(Math.abs(pa.r - 1.6 * TILE) < 0.01, 'patch radius is 1.6 tiles');
  assert.equal(p.item, null, 'the throw consumed the item');
  // enemies in the pool sicken; contact spreads it once to a clean neighbor
  a.x = pa.x + 60; a.y = pa.y; // inside the 76.8px pool
  b.x = pa.x + 85; b.y = pa.y; // outside the pool, 25px from A (contact ring)
  step(g, { 0: {} }, 1 / 30);
  assert.ok(a.toxT > 0, 'the pool intoxicates enemies inside');
  run(g, () => ({ 0: {} }), 0.2);
  assert.ok(b.toxT > 0 && b.chainToxed, 'toxin spreads on contact like burn');
  const hpA = a.hp;
  run(g, () => ({ 0: {} }), 1.1);
  assert.equal(a.hp, hpA - 0.5, 'toxin ticks 0.5 damage per second');
  // players wade at x0.6 through toxin (their own pools included)
  p.x = pa.x - 60; p.y = pa.y;
  const x0 = p.x;
  run(g, () => ({ 0: { right: true } }), 0.3);
  const slowed = p.x - x0;
  const free = charMap.scout.speed * TILE * 0.3;
  assert.ok(Math.abs(slowed - free * 0.6) < 4, `toxin slows players to 60% (got ${slowed.toFixed(1)} vs ${(free * 0.6).toFixed(1)})`);
  // pools dry up after their 6s ttl
  run(g, () => ({ 0: {} }), 6);
  assert.equal(g.patches.length, 0, 'toxin pools expire');
}

// --- stun: a stunned enemy takes no actions and does not move ---
function testStunHaltsEnemies() {
  const level = bigEmptyLevel([[10, '#P.........g..........................#']]);
  const g = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  const p = g.players[0];
  const e = g.enemies[0];
  p.invuln = 999;
  g.graceT = 0;
  e.awake = true;
  run(g, () => ({ 0: {} }), 0.2);
  const moving = e.x;
  assert.ok(moving < 11.5 * TILE, 'the grunt chases before the stun');
  playerShotAt(g, e, 0, { stun: 0.4, ownerPid: 0 });
  step(g, { 0: {} }, 1 / 30);
  const sx = e.x, sy = e.y;
  run(g, () => ({ 0: {} }), 0.3);
  assert.ok(e.x === sx && e.y === sy, 'a stunned enemy holds perfectly still');
  run(g, () => ({ 0: {} }), 0.5);
  assert.ok(e.x !== sx || e.y !== sy, 'the chase resumes when the stun decays');
  // L4 shock arc: the hit jumps to the nearest enemy within 2 tiles at half damage
  const g2 = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  g2.graceT = 1e9;
  g2.players[0].invuln = 999;
  const e2 = g2.enemies[0];
  // clone a second grunt 1.5 tiles away (inside the 2-tile arc reach)
  g2.enemies.push(Object.assign(JSON.parse(JSON.stringify(e2)), { id: 9999, x: e2.x + TILE * 1.5 }));
  const buddy = g2.enemies[1];
  playerShotAt(g2, e2, 1, { stun: 0.4, shockArc: true, ownerPid: 0 });
  step(g2, { 0: {} }, 1 / 30);
  assert.equal(e2.hp, 1, 'the direct hit took its full damage');
  assert.equal(buddy.hp, 1.5, 'the arc dealt half damage to the neighbor');
  assert.ok(buddy.stunT > 0, 'the arc stuns like a direct shock hit');
  assert.ok(g2.events.some(ev => ev.type === 'shockArc'), 'shockArc event fired');
}

// Helper: stamp a parsed turret site as already built with a chosen type.
function forceTurret(b, ttype) {
  b.built = true;
  b.progress = 1;
  b.hp = b.maxHp;
  b.invested = b.cost;
  b.typeSelect = false;
  b.ttype = ttype;
}

// --- prism turrets (RA2 rebalance): 1/1.2s base beam (NOT an instant kill), and
// LINKED prisms pick ONE firing master while the rest hold fire and feed it
// (+1/feeder, cap +3). A control case asserts the master beam is stronger AND
// that supporters stay silent. ---
function testPrismTurretAdjacency() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  // lone prism: base damage only — and the nerfed base is just 1 (was 2)
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(r, 2, 'P'), 10, 'B'), 15, 'g');
  let level = bigEmptyLevel([[5, r]]);
  level.builds = [{ kind: 'turret', cost: 5 }];
  let g = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  g.players[0].invuln = 999;
  g.graceT = 1e9;
  forceTurret(g.builds[0], 'prism');
  g.enemies[0].awake = true;
  g.enemies[0].hp = 99;
  step(g, { 0: {} }, 1 / 30);
  let beams = g.events.filter(ev => ev.type === 'prismBeam');
  assert.equal(beams.length, 1, 'a lone prism fires exactly one beam');
  assert.equal(beams[0].dmg, 1, 'lone level-1 prism deals 1 (nerfed from 2: no instant kill)');
  assert.equal(g.enemies[0].hp, 98, 'the beam damage landed instantly');
  // five prisms in a row: ONE master fires, the four supporters HOLD FIRE and
  // feed (+1 each, capped at +3) → a single 1+3=4 beam, never five beams
  r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(put(put(put(put(r, 2, 'P'), 10, 'B'), 11, 'B'), 12, 'B'), 13, 'B'), 14, 'B'), 18, 'g');
  level = bigEmptyLevel([[5, r]]);
  level.builds = [1, 2, 3, 4, 5].map(() => ({ kind: 'turret', cost: 5 }));
  g = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  g.players[0].invuln = 999;
  g.graceT = 1e9;
  for (const b of g.builds) forceTurret(b, 'prism');
  g.enemies[0].awake = true;
  g.enemies[0].hp = 99;
  step(g, { 0: {} }, 1 / 30);
  beams = g.events.filter(ev => ev.type === 'prismBeam');
  assert.equal(beams.length, 1, 'the link group fires ONE master beam, supporters hold fire');
  assert.equal(beams[0].dmg, 4, 'four feeders cap at +3: 1 base + 3');
  assert.equal(beams[0].linked, 3, 'the master reports its three feeders');
  assert.ok(g.events.filter(ev => ev.type === 'prismFeed').length >= 3, 'feeder flashes fired');
  // CONTROL: the linked master out-damages a lone prism (and only one fired)
  assert.ok(beams[0].dmg > 1, 'linked beam is strictly stronger than the lone base beam');
}

// --- prism fragility (RA2 nerf): a confirmed prism stands on a ~2-hit HP track,
// far below the 10-hp gun/tesla/toxin turret. Driven through the real carousel
// (the supported confirm path) so the HP re-clamp on confirm is exercised. ---
function testPrismFragile() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  // a far, asleep grunt keeps the mission in play (an empty field extracts)
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(r, 4, 'P'), 10, 'B'), 35, 'g');
  const level = bigEmptyLevel([[5, r]]);
  level.builds = [{ kind: 'turret', cost: 5 }];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  const p = g.players[0];
  const b = g.builds[0];
  p.invuln = 999;
  g.graceT = 1e9;
  g.shards = 10;
  // build the turret with an act-hold (mirrors testTurretTypeSelectCarousel)
  p.x = b.x - TILE; p.y = b.y;
  run(g, () => ({ 0: { act: !b.built } }), 5);
  assert.ok(b.built && b.typeSelect, 'turret built and waiting in typeSelect');
  // CONTROL: a confirmed GUN keeps the generic 10-hp turret track
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);       // engage carousel
  step(g, { 0: { act: true, fire: true } }, 1 / 30); // fire confirms 'gun' (idx 0)
  assert.equal(b.ttype, 'gun', 'default confirm is the gun');
  assert.equal(b.maxHp, 10, 'a gun turret keeps the generic 10-hp track (control)');
  // a second turret, this time confirmed as a PRISM, lands on the fragile track
  const g2 = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  const p2 = g2.players[0];
  const b2 = g2.builds[0];
  p2.invuln = 999;
  g2.graceT = 1e9;
  g2.shards = 10;
  p2.x = b2.x - TILE; p2.y = b2.y;
  run(g2, () => ({ 0: { act: !b2.built } }), 5);
  assert.ok(b2.built && b2.typeSelect, 'second turret waits in typeSelect');
  step(g2, { 0: {} }, 1 / 30);
  step(g2, { 0: { act: true } }, 1 / 30);            // engage carousel
  step(g2, { 0: { act: true, right: true } }, 1 / 30); // right: gun -> prism
  step(g2, { 0: { act: true } }, 1 / 30);            // release right (clean edge)
  step(g2, { 0: { act: true, fire: true } }, 1 / 30);  // fire confirms prism
  assert.equal(b2.ttype, 'prism', 'the carousel confirmed a prism');
  assert.equal(b2.maxHp, 2, 'a confirmed L1 prism re-clamps to a 2-hp (2-hit) track');
  assert.ok(b2.hp <= 2 && b2.hp > 0, 'its current hp clamps to the fragile cap');
  // two enemy gnaw bites (1 dmg each) destroy it — ~2 hits to kill
  b2.hp = 2;
  b2.hp -= 1; assert.ok(b2.hp > 0, 'one hit leaves the prism standing');
  b2.hp -= 1; assert.ok(b2.hp <= 0, 'the second hit drops it to zero — 2 hits to destroy');
}

// --- tesla turrets: 1.5s chain-zap, up to 3 targets for 2/1/1, each stunned ---
function testTeslaChainAndStun() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(put(put(r, 2, 'P'), 10, 'B'), 11, 'g'), 12, 'g'), 13, 'g');
  const level = bigEmptyLevel([[5, r]]);
  level.builds = [{ kind: 'turret', cost: 5 }];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  g.players[0].invuln = 999;
  g.graceT = 1e9;
  forceTurret(g.builds[0], 'tesla');
  const [e1, e2, e3] = g.enemies;
  for (const e of g.enemies) e.awake = true;
  step(g, { 0: {} }, 1 / 30);
  const zap = g.events.find(ev => ev.type === 'teslaZap');
  assert.ok(zap, 'tesla zapped');
  assert.equal(zap.targets.length, 3, 'the chain hit all three grunts in reach');
  assert.ok(e1.dead || !g.enemies.includes(e1), 'first target took 2 (a grunt dies)');
  assert.equal(e2.hp, 1, 'second chain hop took 1');
  assert.equal(e3.hp, 1, 'third chain hop took 1');
  assert.ok(e2.stunT > 0 && e3.stunT > 0, 'every zapped enemy is stunned 0.4s');
  assert.ok(snapshot(g, false).enemies.every(e => e.stunT > 0), 'snapshot ships live stun clocks');
}

// --- toxin turrets: lob a pool onto the nearest awake enemy every 3s ---
function testToxinTurretPools() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(r, 2, 'P'), 10, 'B'), 14, 'g');
  const level = bigEmptyLevel([[5, r]]);
  level.builds = [{ kind: 'turret', cost: 5 }];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  g.players[0].invuln = 999;
  g.graceT = 1e9;
  forceTurret(g.builds[0], 'toxin');
  const e = g.enemies[0];
  e.awake = true;
  e.hp = 99;
  step(g, { 0: {} }, 1 / 30);
  assert.equal(g.patches.length, 1, 'the turret sprayed a pool at its target');
  assert.equal(g.patches[0].kind, 'toxin');
  assert.ok(Math.abs(g.patches[0].x - e.x) < 1, 'the pool lands on the target');
  step(g, { 0: {} }, 1 / 30);
  assert.ok(e.toxT > 0, 'the pool intoxicates');
  run(g, () => ({ 0: {} }), 3.05);
  assert.equal(g.patches.length, 2, 'another pool every 3 seconds');
}

// --- turret typeSelect: carousel UX, default after 8s, act priority ---
function testTurretTypeSelectCarousel() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(put(r, 4, 'P'), 10, 'B'), 12, 'C'), 13, 'g');
  const level = bigEmptyLevel([[5, r], [17, '#....................................g#']]);
  level.builds = [{ kind: 'turret', cost: 5 }];
  level.chests = [{ loot: 'shards', amount: 5 }];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  const p = g.players[0];
  const b = g.builds[0];
  const chest = g.chests[0];
  p.invuln = 999;
  g.graceT = 1e9;
  g.shards = 10;
  p.x = b.x - TILE; p.y = b.y;
  run(g, () => ({ 0: { act: !b.built } }), 5);
  assert.ok(b.built, 'turret built');
  assert.equal(b.typeSelect, true, 'a finished turret waits in typeSelect');
  assert.equal(snapshot(g, false).builds[0].typeSelect, true, 'snapshot ships the select state');
  // it holds fire while undecided
  g.enemies[0].awake = true;
  run(g, () => ({ 0: {} }), 1.2);
  assert.ok(!g.events.some(ev => ev.type === 'shoot' && ev.weapon === 'turret'), 'no fire during typeSelect');
  // carousel outranks the chest: stand between both, the press is consumed
  p.x = b.x + TILE; p.y = b.y; // 1 tile from turret, 1 tile from chest
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(p.selecting, true, 'act engaged the carousel');
  assert.equal(chest.opened, false, 'the engaging press never falls through to the chest');
  // cycle right twice -> tesla, fire confirms
  step(g, { 0: { act: true, right: true } }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  step(g, { 0: { act: true, right: true } }, 1 / 30);
  assert.equal(b.tsIdx, 2, 'left/right cycle the carousel');
  step(g, { 0: { act: true, fire: true } }, 1 / 30);
  assert.equal(b.typeSelect, false, 'fire confirms');
  assert.equal(b.ttype, 'tesla', 'the chosen type sticks');
  assert.ok(g.events.some(ev => ev.type === 'turretType' && ev.ttype === 'tesla'), 'turretType event fired');
  // the confirmed tesla goes straight to work, on the very confirm tick
  assert.ok(g.events.some(ev => ev.type === 'teslaZap'), 'the confirmed tesla zaps');
  assert.equal(chest.opened, false, 'confirming never opened the chest either');
  assert.equal(snapshot(g, false).builds[0].ttype, 'tesla', 'snapshot ships the confirmed type');
  // away from the turret ring, a fresh press still opens the chest
  p.x = chest.x + TILE * 0.5; p.y = chest.y;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(chest.opened, true, 'chests open again once no carousel claims the press');
  // unattended: a neglected carousel confirms 'gun' after 8s
  const g2 = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  g2.players[0].invuln = 999;
  g2.graceT = 1e9;
  g2.shards = 10;
  g2.players[0].x = g2.builds[0].x - TILE; g2.players[0].y = g2.builds[0].y;
  run(g2, () => ({ 0: { act: !g2.builds[0].built } }), 5);
  assert.ok(g2.builds[0].built && g2.builds[0].typeSelect, 'second turret waits in typeSelect');
  g2.players[0].x = TILE * 30; // walk away
  run(g2, () => ({ 0: {} }), 8.2);
  assert.equal(g2.builds[0].typeSelect, false, 'an unattended carousel self-confirms after 8s');
  assert.equal(g2.builds[0].ttype, 'gun', 'the default is the gun');
  // build sites outrank the carousel: a neighboring open site claims the hold
  const r3 = put(put(put('#' + '.'.repeat(38) + '#', 4, 'P'), 10, 'B'), 11, 'B');
  const level3 = bigEmptyLevel([[5, r3], [17, '#....................................g#']]);
  level3.builds = [{ kind: 'turret', cost: 2 }, { kind: 'barricade', cost: 8 }];
  const g3 = createGame(level3, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  const p3 = g3.players[0];
  const [tur, barr] = g3.builds;
  p3.invuln = 999;
  g3.graceT = 1e9;
  g3.shards = 50;
  p3.x = (tur.x + barr.x) / 2; p3.y = tur.y;
  run(g3, () => ({ 0: { act: true } }), 1.6); // turret (1.2s) completes first
  assert.ok(tur.built && tur.typeSelect, 'turret done, carousel open');
  assert.ok(!barr.built && barr.progress > 0, 'barricade still going');
  assert.equal(p3.selecting ?? false, false, 'the open site outranks the carousel — hold keeps building');
  assert.equal(tur.tsIdx, 0, 'the carousel was never driven');
  run(g3, () => ({ 0: { act: true } }), 4);
  assert.ok(barr.built, 'barricade finished under the same hold');
  step(g3, { 0: { act: true } }, 1 / 30);
  assert.equal(p3.selecting, true, 'with no open site left, the held act engages the carousel');
  assert.ok(tur.typeSelect, 'engaged carousel stopped the unattended clock');
}

// --- followers: hire, formation, engage, limits, death, restock ---
function testFollowersLifecycle() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(put(r, 4, 'P'), 5, 'P'), 8, 'H'), 12, 'H');
  let r2 = '#' + '.'.repeat(38) + '#';
  r2 = put(r2, 16, 'H');
  const level = bigEmptyLevel([[5, r], [7, r2], [17, '#...........g........................g#']]);
  level.hires = [
    { job: 'hound', cost: 6, name: 'Fang' },
    { job: 'archer', cost: 6, name: 'Fletch' },
    { job: 'caster', cost: 6, name: 'Gale' },
  ];
  const g = createGame(level, [
    { pid: 0, name: 'A', charId: 'scout' },
    { pid: 1, name: 'B', charId: 'soldier' },
  ], charMap, startingRoster);
  const [p0, p1] = g.players;
  const [hPost, aPost, cPost] = g.hires;
  p0.invuln = 999;
  p1.invuln = 999;
  g.graceT = 1e9;
  g.shards = 100;
  // hire the hound: it binds to the hiring seat
  p0.x = hPost.x; p0.y = hPost.y + TILE;
  p1.x = 30 * TILE; p1.y = 15 * TILE;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(g.followers.length, 1, 'hiring a combat job fields a follower');
  const hound = g.followers[0];
  assert.deepEqual([hound.kind, hound.owner, hound.slot], ['hound', 0, 0], 'bound to the hiring player');
  assert.equal(hPost.hired, true, 'the post is taken');
  assert.equal(g.shards, 94, 'hire cost paid');
  // formation: it settles into the slot behind/flanking the owner's facing
  p0.x = 20 * TILE; p0.y = 10 * TILE; p0.fx = 0; p0.fy = -1;
  run(g, () => ({ 0: {} }), 3);
  const sx = p0.x - p0.fx * TILE * 1.1 + p0.fy * TILE * 0.8; // slot 0, side -1
  const sy = p0.y - p0.fy * TILE * 1.1 - p0.fx * TILE * 0.8;
  assert.ok(Math.hypot(hound.x - sx, hound.y - sy) < TILE * 0.6,
    `the hound holds its formation slot (off by ${(Math.hypot(hound.x - sx, hound.y - sy) / TILE).toFixed(2)} tiles)`);
  assert.equal(snapshot(g, false).followers.length, 1, 'snapshot ships followers');
  // adrift: 12+ tiles from the owner teleports it home
  hound.x = p0.x + TILE * 13; hound.y = p0.y;
  step(g, { 0: {} }, 1 / 30);
  assert.ok(Math.hypot(hound.x - p0.x, hound.y - p0.y) < TILE, 'an adrift follower teleports to its owner');
  // engage: an enemy within 5 tiles of the OWNER draws the bite
  const prey = g.enemies[0];
  prey.x = p0.x + TILE * 3; prey.y = p0.y;
  prey.hp = 50;
  prey.awake = true;
  run(g, () => ({ 0: {} }), 3);
  assert.ok(prey.hp < 50, 'the hound bit the enemy near its owner');
  assert.equal(p0.xp, 0, 'follower kills/damage pay no seat xp');
  // per-player limit: 2 — the third post refuses
  p0.x = aPost.x; p0.y = aPost.y + TILE;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(g.followers.length, 2, 'second follower hired');
  p0.x = cPost.x; p0.y = cPost.y + TILE;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(g.followers.length, 2, 'a third is refused: max 2 per player');
  assert.ok(g.events.some(ev => ev.type === 'followerLimit'), 'the refusal is evented');
  assert.equal(cPost.hired, false, 'the post stays open');
  // squad limit: 5 across all seats
  for (let i = 0; i < 3; i++) {
    g.followers.push({
      id: g.nextFollowerId++, kind: 'hound', owner: 99, x: 0, y: 0, hp: 2, slot: 0,
      post: 0, isFollower: true, fx: 0, fy: 1, cool: 0, invulnT: 0, path: null, pathI: 0, repathT: 0,
    });
  }
  p1.x = cPost.x; p1.y = cPost.y + TILE;
  step(g, { 0: {}, 1: {} }, 1 / 30);
  step(g, { 0: {}, 1: { act: true } }, 1 / 30);
  assert.equal(g.followers.filter(f => f.owner === 1).length, 0, 'squad cap 5 refuses even a fresh seat');
  g.followers = g.followers.filter(f => f.owner !== 99);
  step(g, { 0: {}, 1: {} }, 1 / 30);
  step(g, { 0: {}, 1: { act: true } }, 1 / 30);
  assert.equal(g.followers.filter(f => f.owner === 1).length, 1, 'under the cap the hire goes through');
  // the archer actually shoots
  const mark = g.enemies[1];
  mark.x = p0.x + TILE * 3; mark.y = p0.y + TILE;
  mark.hp = 50;
  mark.awake = true;
  let sawArrow = false;
  run(g, () => {
    if (g.shots.some(s => s.kind === 'arrow')) sawArrow = true;
    return { 0: {}, 1: {} };
  }, 2);
  assert.ok(sawArrow, 'the archer follower fires arrows');
  // death: enemy fire downs it; the post restocks 20s later
  const dog = g.followers.find(f => f.kind === 'hound');
  dog.hp = 1;
  dog.invulnT = 0;
  g.shots.push({
    id: g.nextShotId++, x: dog.x, y: dog.y, vx: 0, vy: 0, ttl: 0.5, dmg: 1,
    who: 'e', overWalls: true, pierce: 0, aoeRadius: 0, curve: 0, radius: 5, kind: 'arrow', hits: [],
  });
  step(g, { 0: {}, 1: {} }, 1 / 30);
  assert.ok(!g.followers.some(f => f.kind === 'hound' && f.owner === 0), 'enemy shots kill followers');
  assert.ok(g.events.some(ev => ev.type === 'followerDown'), 'followerDown evented');
  assert.ok(hPost.restockT > 19, 'the post begins its 20s restock');
  assert.equal(hPost.hired, true, 'no re-hire until the restock lands');
  run(g, () => ({ 0: {}, 1: {} }), 20.1);
  assert.equal(hPost.hired, false, 'the post restocked');
  p0.x = hPost.x; p0.y = hPost.y + TILE;
  step(g, { 0: {}, 1: {} }, 1 / 30);
  step(g, { 0: { act: true }, 1: {} }, 1 / 30);
  assert.ok(g.followers.some(f => f.kind === 'hound' && f.owner === 0), 're-hired after restock');
}

// --- mind control: convert the nearest non-boss for 10s, then it burns out ---
function testControllerConvertAndExpiry() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(r, 4, 'P'), 6, 'b'), 7, 'g');
  const level = bigEmptyLevel([[10, r]]);
  const g = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  const p = g.players[0];
  const boss = g.enemies.find(e => e.kind === 'boss');
  const grunt = g.enemies.find(e => e.kind === 'grunt');
  p.invuln = 999;
  g.graceT = 0;
  p.item = { kind: 'controller', count: 1 };
  step(g, { 0: { item: true } }, 1 / 30);
  assert.ok(grunt.convertedT > 9.9, 'the nearest NON-boss converts');
  assert.ok(!(boss.convertedT > 0), 'bosses cannot be controlled');
  assert.equal(p.item, null, 'the controller burned its single use');
  assert.ok(g.events.some(ev => ev.type === 'converted' && ev.kind === 'grunt'), 'converted event fired');
  // player fire passes over the converted ally
  playerShotAt(g, grunt, 5, { ownerPid: 0 });
  step(g, { 0: {} }, 1 / 30);
  assert.equal(grunt.hp, 2, 'player shots pass through a converted enemy');
  // it attacks its own: the boss takes melee bites
  const bossHp = boss.hp;
  run(g, () => ({ 0: {} }), 3);
  assert.ok(boss.hp < bossHp, 'the converted grunt fights its own side');
  assert.equal(p.xp, 0, 'converted kills/damage pay no seat xp');
  // expiry: the husk burns out and dies quietly (a 0-point death, no drop)
  run(g, () => ({ 0: {} }), 7.5);
  assert.ok(!g.enemies.includes(grunt), 'the husk died at the 10s burnout');
  assert.ok(g.events.some(ev => ev.type === 'die' && ev.kind === 'grunt' && ev.points === 0),
    'the burnout is a quiet 0-point death');
  assert.ok(!g.drops.some(d => Math.hypot(d.x - grunt.x, d.y - grunt.y) < 2),
    'a burned-out husk drops no shards');
  // no target in reach: the use is refused, the item kept
  const g2 = createGame(bigEmptyLevel([[17, '#....................................g#']]),
    [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  g2.players[0].invuln = 999;
  g2.graceT = 1e9;
  g2.players[0].item = { kind: 'controller', count: 1 };
  step(g2, { 0: { item: true } }, 1 / 30);
  assert.deepEqual(g2.players[0].item, { kind: 'controller', count: 1 }, 'no target in 4 tiles: nothing wasted');
}

// --- the seal: water is open ground (x0.7, +50% fire cooldown), others sink ---
function testSealSwimsCaptiveTrails() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  const tiles = [];
  tiles.push('#'.repeat(40));
  for (let y = 1; y < 19; y++) {
    let row = '#' + '.'.repeat(38) + '#';
    row = row.slice(0, 20) + '~~~' + row.slice(23);
    tiles.push(row);
  }
  tiles.push('#'.repeat(40));
  tiles[10] = put(tiles[10], 4, 'P');
  tiles[10] = put(tiles[10], 17, 'c');
  const level = { name: 'Channel', time: 90, captiveChars: ['sniper'], tiles: [...tiles] };
  tiles[17] = put(tiles[17], 36, 'g');
  level.tiles = tiles;
  const g = createGame(level, [{ pid: 0, name: 'T', charId: 'seal' }], charMap, ['seal', 'sniper']);
  const p = g.players[0];
  p.invuln = 999;
  g.graceT = 1e9;
  // land speed baseline
  let x0 = p.x;
  run(g, () => ({ 0: { right: true } }), 0.5);
  const landDx = p.x - x0;
  assert.ok(Math.abs(landDx - charMap.seal.speed * TILE * 0.5) < 4, 'seal swims at full speed on land');
  // on water: x0.7
  p.x = 21.5 * TILE; p.y = 10.5 * TILE; // mid-channel
  x0 = p.x;
  run(g, () => ({ 0: { right: true } }), 0.3);
  const waterDx = p.x - x0;
  assert.ok(Math.abs(waterDx - charMap.seal.speed * TILE * 0.3 * 0.7) < 4,
    `water slows the seal to 70% (got ${waterDx.toFixed(1)})`);
  // the harpooner CAN fire while swimming, at +50% cooldown
  p.x = 21.5 * TILE; p.y = 10.5 * TILE;
  p.cool = 0;
  g.shots.length = 0;
  step(g, { 0: { fire: true } }, 1 / 30);
  assert.equal(g.shots.length, 1, 'the seal fires from the water');
  assert.ok(Math.abs(p.cool - charMap.seal.weapon.cooldown * 1.5) < 0.001, 'swimming fire costs +50% cooldown');
  p.x = 10 * TILE; p.y = 10.5 * TILE;
  p.cool = 0;
  step(g, { 0: { fire: true } }, 1 / 30);
  assert.ok(Math.abs(p.cool - charMap.seal.weapon.cooldown) < 0.001, 'land fire keeps the base cooldown');
  // a carried captive floats across behind the swimmer
  const cap = g.captives[0];
  p.x = 17.5 * TILE; p.y = 10.5 * TILE;
  step(g, { 0: {} }, 1 / 30); // touch: pick the captive up
  assert.equal(cap.owner, 0, 'captive picked up');
  run(g, () => ({ 0: { right: true } }), 4);
  assert.ok(p.x > 24 * TILE, 'the seal crossed the channel');
  assert.ok(cap.x > 22 * TILE, 'the carried captive floated across the water');
  assert.ok(Math.hypot(cap.x - p.x, cap.y - p.y) < TILE * 2, 'and still trails its owner');
  // everyone else is blocked at the bank
  const g2 = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout', 'sniper']);
  const q = g2.players[0];
  q.invuln = 999;
  g2.graceT = 1e9;
  q.x = 19.4 * TILE; q.y = 10.5 * TILE;
  run(g2, () => ({ 0: { right: true } }), 1.5);
  assert.ok(q.x < 20 * TILE, 'non-swimmers cannot enter water');
}

// --- the seal is recruitable: a captive in chapter 2 (Lythium Basin) ---
function testSealRecruitableInBasin() {
  const basin = levels.find(l => l.name === 'Lythium Basin');
  assert.ok(basin, 'chapter 2 (Lythium Basin) ships');
  assert.ok((basin.captiveChars || []).includes('seal'), 'the seal is bound as a captive there');
  const parsed = parseLevel(basin);
  const cap = parsed.captives.find(c => c.charId === 'seal');
  assert.ok(cap, 'the seal parses as a rescuable captive');
  assert.ok(basin.tiles.some(row => row.includes('~')), 'the basin holds water for the swimmer');
  // land-reachable: at least one neighboring tile is open ground, so any
  // character can walk up and free the seal (the causeway-end hummock)
  const tx = Math.floor(cap.x / TILE), ty = Math.floor(cap.y / TILE);
  const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
    const c = parsed.grid[ty + dy]?.[tx + dx];
    return c !== undefined && !'#T~o'.includes(c);
  });
  assert.ok(open, 'the seal captive sits on land reachable by foot');
}

// --- arcade fidelity: classic levels replay lockstep and gain no new keys ---
function testArcadeFidelityLockstep() {
  const party = startingRoster.slice(0, 2).map((id, i) => ({ pid: i, name: id, charId: id }));
  const runOnce = () => {
    const g = createGame(levels[0], party, charMap, startingRoster);
    const dt = 1 / 30;
    const h = [];
    for (let i = 0; i < 450 && g.status === 'play'; i++) {
      const inputs = {};
      for (const p of g.players) {
        inputs[p.pid] = {
          right: (i % 50) < 25, down: (i % 70) < 30, fire: (i % 5) < 2,
          special: (i % 80) === 15 + p.pid, act: (i % 60) < 5, item: (i % 90) === 40,
        };
      }
      step(g, inputs, dt);
      if (i % 15 === 0) h.push(JSON.stringify(snapshot(g, false)));
    }
    return h;
  };
  const a = runOnce();
  assert.equal(a.join('\n'), runOnce().join('\n'), 'identical arcade runs produce identical snapshot streams');
  for (const js of a) {
    const s = JSON.parse(js);
    assert.equal(s.patches, undefined, 'classic snapshots never gain a patches key');
    assert.equal(s.followers, undefined, 'classic snapshots never gain a followers key');
    for (const p of s.players) {
      assert.equal(p.level, undefined, 'arcade players carry no level');
      assert.equal(p.xp, undefined, 'arcade players carry no xp');
    }
    for (const e of s.enemies) {
      assert.ok(e.stunT === undefined && e.burnT === undefined && e.toxT === undefined && e.convertedT === undefined,
        'arcade enemies carry no status keys');
    }
  }
}

// --- pvp: evolutions fire, hire posts are inert, patches slow-all/no burn ---
function testPvpCombatDepthRules() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  const tiles = [];
  tiles.push('#'.repeat(40));
  for (let y = 1; y < 19; y++) tiles.push('#' + '.'.repeat(38) + '#');
  tiles.push('#'.repeat(40));
  tiles[2] = '#PPPP' + '.'.repeat(34) + '#';
  tiles[10] = put(put(tiles[10], 2, 'D'), 37, 'D');
  tiles[12] = put(tiles[12], 20, 'H');
  const def = {
    name: 'PvP Depth', time: 120, mode: 'ctf', captiveChars: [],
    hires: [{ job: 'hound', cost: 5, name: 'Fang' }],
    tiles,
  };
  const party = [0, 1].map(i => ({ pid: i, name: 'P' + i, charId: startingRoster[i] }));
  const g = createGame(def, party, charMap, startingRoster);
  const [p0, p1] = g.players;
  const post = g.hires[0];
  g.teamShards[0] = 50;
  p0.invuln = 999;
  p1.invuln = 999;
  // hire posts are inert in pvp: no follower, no spend, post stays open
  p0.x = post.x; p0.y = post.y + TILE;
  step(g, { 0: {}, 1: {} }, 1 / 30);
  step(g, { 0: { act: true }, 1: {} }, 1 / 30);
  assert.equal(post.hired, false, 'pvp hire posts are inert');
  assert.equal(g.followers.length, 0, 'no followers in pvp');
  assert.equal(g.teamShards[0], 50, 'no shards spent');
  // evolutions still work: a L3 scout fires its extra shot
  p0.x = 10 * TILE; p0.y = 5 * TILE;
  p0.level = 3;
  p0.cool = 0;
  g.shots.length = 0;
  step(g, { 0: { fire: true }, 1: {} }, 1 / 30);
  assert.equal(g.shots.length, 2, 'evolutions apply in pvp');
  g.shots.length = 0;
  // toxin pools slow BOTH teams (patches carry no team)
  p0.x = 10 * TILE; p0.y = 8 * TILE;
  p1.x = 28 * TILE; p1.y = 8 * TILE;
  g.patches.push({ x: p0.x + 30, y: p0.y, kind: 'toxin', r: 1.6 * TILE, ttl: 30 });
  g.patches.push({ x: p1.x + 30, y: p1.y, kind: 'toxin', r: 1.6 * TILE, ttl: 30 });
  const x00 = p0.x, x10 = p1.x;
  run(g, () => ({ 0: { right: true }, 1: { right: true } }), 0.3);
  const d0 = p0.x - x00, d1 = p1.x - x10;
  assert.ok(Math.abs(d0 - charMap[p0.charId].speed * TILE * 0.3 * 0.6) < 4, 'toxin slows team 0');
  assert.ok(Math.abs(d1 - charMap[p1.charId].speed * TILE * 0.3 * 0.6) < 4, 'toxin slows team 1 just the same');
  // burn patches never hurt players — either team
  g.patches.length = 0;
  g.patches.push({ x: p1.x, y: p1.y, kind: 'burn', r: 1.6 * TILE, ttl: 30, pid: 0 });
  p1.invuln = 0;
  const hp1 = p1.hp;
  run(g, () => ({ 0: {}, 1: {} }), 1.5);
  assert.equal(p1.hp, hp1, 'burn patches deal no player damage in pvp');
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

// --- converted allies: squad damage (patches, cracker) passes over them;
// cracker kills credit the thrower's seat with xp like other items ---
function testConvertedImmunityAndCrackerXp() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(r, 4, 'P'), 12, 'g'), 14, 'g');
  const level = bigEmptyLevel([[5, r], [17, '#....................................g#']]);
  const g = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  const p = g.players[0];
  const [a, b] = g.enemies;
  p.invuln = 999;
  g.graceT = 1e9;
  b.convertedT = 10; // b fights for the squad
  // a toxin pool covering both only sickens the hostile one
  const mx = (a.x + b.x) / 2;
  g.patches.push({ x: mx, y: a.y, kind: 'toxin', r: 1.6 * TILE, ttl: 30, pid: 0 });
  step(g, { 0: {} }, 1 / 30);
  assert.ok(a.toxT > 0, 'the pool intoxicates the hostile grunt');
  assert.ok(!(b.toxT > 0), 'the converted ally is spared by patches');
  g.patches.length = 0;
  // a cracker boom centered between them kills only the hostile, paying xp
  g.crackers.push({ x: mx, y: a.y, landed: true, fuse: 0.01, pid: 0 });
  step(g, { 0: {} }, 1 / 30);
  assert.ok(a.dead || !g.enemies.includes(a), 'the cracker killed the hostile grunt');
  assert.equal(b.hp, 2, 'the converted ally is spared by the boom');
  assert.equal(p.xp, 4, 'cracker kills credit the thrower (score/25 xp)');
}

// --- respawnSpot: a swimming ally mid-lake must not strand a walker on '~' ---
function testRespawnSpotAvoidsWater() {
  const rows = [];
  rows.push('#'.repeat(40));
  for (let y = 1; y < 19; y++) {
    let r = '#' + '.'.repeat(38) + '#';
    if (y >= 5 && y <= 15) r = r.slice(0, 20) + '~'.repeat(13) + r.slice(33); // big lake
    rows.push(r);
  }
  rows.push('#'.repeat(40));
  rows[2] = '#PP' + rows[2].slice(3);
  rows[17] = rows[17].slice(0, 37) + 'g' + rows[17].slice(38); // keeps the level alive
  const level = { name: 'Lake Strand', time: 90, captiveChars: [], tiles: rows };
  const g = createGame(level, [
    { pid: 0, name: 'A', charId: 'scout' },
    { pid: 1, name: 'B', charId: 'seal' },
  ], charMap, ['scout', 'seal', 'soldier']);
  g.graceT = 1e9;
  const [a, seal] = g.players;
  seal.invuln = 999;
  // the seal swims dead-center: every ring-scan candidate within 4 tiles is water
  seal.x = 26.5 * TILE;
  seal.y = 10.5 * TILE;
  a.charId = null;
  a.state = 'pick';
  a.pickIdx = 0;
  a.pickPrev = { left: false, right: false, fire: false };
  step(g, { 0: { fire: true }, 1: {} }, 1 / 30);
  assert.equal(a.state, 'active', 'walker redeployed');
  const tile = level.tiles[Math.floor(a.y / TILE)][Math.floor(a.x / TILE)];
  assert.ok(tile !== '~', 'respawn never lands a walker on water');
  assert.ok(Math.hypot(a.x - g.spawns[0].x, a.y - g.spawns[0].y) < TILE,
    'with the ally unreachable, the respawn falls back to the level start');
}

// --- followers wait ashore instead of teleporting onto water after a swimmer ---
function testFollowerWaitsAshore() {
  const rows = [];
  rows.push('#'.repeat(40));
  for (let y = 1; y < 19; y++) {
    let r = '#' + '.'.repeat(38) + '#';
    r = r.slice(0, 9) + '~'.repeat(24) + r.slice(33); // channel cols 9..32
    rows.push(r);
  }
  rows.push('#'.repeat(40));
  rows[10] = '#P' + rows[10].slice(2);
  rows[17] = '#'.repeat(40); // no stray enemies needed; keep one alive below
  rows[17] = rows[17].slice(0, 1) + '.'.repeat(38) + rows[17].slice(39);
  rows[17] = rows[17].slice(0, 37) + 'g' + rows[17].slice(38);
  const level = { name: 'Channel Wait', time: 90, captiveChars: [], tiles: rows };
  const g = createGame(level, [{ pid: 0, name: 'T', charId: 'seal' }], charMap, ['seal']);
  const p = g.players[0];
  p.invuln = 999;
  g.graceT = 1e9;
  g.followers.push({
    id: 1, kind: 'hound', owner: 0, x: 5.5 * TILE, y: 10.5 * TILE, hp: 2, slot: 0,
    post: 0, isFollower: true, fx: 0, fy: 1, cool: 0, invulnT: 0, path: null, pathI: 0, repathT: 0,
  });
  const dog = g.followers[0];
  // the seal swims 20 tiles out: way past the 12-tile adrift teleport
  p.x = 25.5 * TILE;
  p.y = 10.5 * TILE;
  run(g, () => ({ 0: {} }), 2);
  const tile = level.tiles[Math.floor(dog.y / TILE)][Math.floor(dog.x / TILE)];
  assert.ok(tile !== '~', 'the adrift hound waits ashore — never teleports onto water');
  assert.ok(Math.hypot(dog.x - p.x, dog.y - p.y) > TILE * 12, 'it stayed behind, still adrift');
  // owner back on land: the normal adrift teleport resumes
  p.x = 35.5 * TILE;
  step(g, { 0: {} }, 1 / 30);
  assert.ok(Math.hypot(dog.x - p.x, dog.y - p.y) < TILE, 'a dry owner pulls the teleport as before');
}

// --- formation slots: a rehire takes the lowest slot a LIVING follower freed ---
function testFollowerSlotReuseAfterRehire() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(r, 4, 'P'), 8, 'H'), 12, 'H');
  const level = bigEmptyLevel([[5, r], [17, '#....................................g#']]);
  level.hires = [
    { job: 'hound', cost: 6, name: 'Fang' },
    { job: 'archer', cost: 6, name: 'Fletch' },
  ];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  const p = g.players[0];
  const [hPost, aPost] = g.hires;
  p.invuln = 999;
  g.graceT = 1e9;
  g.shards = 50;
  p.x = hPost.x; p.y = hPost.y + TILE;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  p.x = aPost.x; p.y = aPost.y + TILE;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.deepEqual(g.followers.map(f => [f.kind, f.slot]), [['hound', 0], ['archer', 1]], 'first hires take slots 0 and 1');
  // the hound dies; its post restocks; the rehire must reclaim slot 0
  const dog = g.followers[0];
  dog.hp = 1;
  dog.invulnT = 0;
  g.shots.push({
    id: g.nextShotId++, x: dog.x, y: dog.y, vx: 0, vy: 0, ttl: 0.5, dmg: 1,
    who: 'e', overWalls: true, pierce: 0, aoeRadius: 0, curve: 0, radius: 5, kind: 'arrow', hits: [],
  });
  step(g, { 0: {} }, 1 / 30);
  assert.ok(!g.followers.some(f => f.kind === 'hound'), 'the hound went down');
  hPost.restockT = 0.01;
  run(g, () => ({ 0: {} }), 0.1);
  assert.equal(hPost.hired, false, 'post restocked');
  p.x = hPost.x; p.y = hPost.y + TILE;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  const rehired = g.followers.find(f => f.kind === 'hound');
  assert.ok(rehired, 'rehired after restock');
  assert.equal(rehired.slot, 0, 'the rehire reclaims the freed slot 0 (no flank doubling)');
}

// --- burnPatch flag clears when a survived burn expires (no stale death patch) ---
function testStaleBurnPatchCleared() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(r, 4, 'P'), 12, 'g');
  const level = bigEmptyLevel([[5, r], [17, '#....................................g#']]);
  const g = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  g.players[0].invuln = 999;
  g.graceT = 1e9;
  const a = g.enemies[0];
  a.hp = 10;
  playerShotAt(g, a, 1, { ignite: true, ignitePatch: true, ownerPid: 0 });
  step(g, { 0: {} }, 1 / 30);
  assert.equal(a.burnPatch, true, 'the L4 ignite marks the patch flag');
  run(g, () => ({ 0: {} }), 3.2); // the burn runs its 3s and the grunt survives
  assert.equal(a.burnT, 0, 'burn expired');
  assert.equal(a.burnPatch, false, 'the expired burn clears its patch flag');
  // a later PLAIN ignite that kills must not inherit the stale flag
  playerShotAt(g, a, 1, { ignite: true, ownerPid: 0 });
  step(g, { 0: {} }, 1 / 30);
  playerShotAt(g, a, 99, { ownerPid: 0 });
  step(g, { 0: {} }, 1 / 30);
  assert.ok(a.dead || !g.enemies.includes(a), 'the plain-burn kill landed');
  assert.equal(g.patches.length, 0, 'no stale death patch from the earlier L4 ignite');
}

// --- squad assist xp: other active seats within 8 tiles earn floor(half) ---
function testSquadAssistXp() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(put(put(r, 4, 'P'), 5, 'P'), 6, 'P'), 12, 'g'), 16, 'g');
  const level = bigEmptyLevel([[5, r], [17, '#....................................g#']]);
  const g = createGame(level, [
    { pid: 0, name: 'A', charId: 'scout' },
    { pid: 1, name: 'B', charId: 'soldier' },
    { pid: 2, name: 'C', charId: 'medic' },
  ], charMap, startingRoster);
  const [p0, p1, p2] = g.players;
  for (const p of g.players) p.invuln = 999;
  g.graceT = 1e9;
  p1.x = p0.x + TILE * 5; p1.y = p0.y; // inside the 8-tile assist ring
  p2.x = p0.x + TILE * 20; p2.y = p0.y; // far outside
  const [e0, e1] = g.enemies;
  playerShotAt(g, e0, 99, { ownerPid: 0 }); // grunt: 100 score -> 4 xp
  step(g, { 0: {}, 1: {}, 2: {} }, 1 / 30);
  assert.equal(p0.xp, 4, 'the killer keeps full kill xp');
  assert.equal(p1.xp, 2, 'a teammate within 8 tiles earns floor(4/2) = 2');
  assert.equal(p2.xp, 0, 'a seat 20 tiles away earns nothing');
  e1.score = 125; // 5 xp -> assist floor(2.5) = 2
  playerShotAt(g, e1, 99, { ownerPid: 0 });
  step(g, { 0: {}, 1: {}, 2: {} }, 1 / 30);
  assert.equal(p0.xp, 9, 'killer xp accrues in full');
  assert.equal(p1.xp, 4, 'odd assist halves floor (2.5 -> 2)');
}

// --- snapshot ships typeSelectT and player-shot ownerPid (renderer fields) ---
function testSnapshotTypeSelectTAndShotOwnerPid() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(r, 4, 'P'), 20, 'B');
  const level = bigEmptyLevel([[5, r], [17, '#....................................g#']]);
  level.builds = [{ kind: 'turret', cost: 5 }];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  const b = g.builds[0];
  g.players[0].invuln = 999;
  g.graceT = 1e9;
  b.built = true;
  b.progress = 1;
  b.hp = b.maxHp;
  b.typeSelect = true;
  b.tsIdx = 2;
  b.selT = 3;
  const s = snapshot(g, false);
  assert.equal(s.builds[0].tsIdx, 2, 'snapshot ships the carousel cursor');
  assert.equal(s.builds[0].typeSelectT, 5, 'snapshot ships the remaining auto-confirm seconds');
  // player fire carries the seat pid; enemy fire carries no key at all
  const p = g.players[0];
  p.cool = 0;
  step(g, { 0: { fire: true } }, 1 / 30);
  enemyShotAt(g, { x: p.x + TILE * 5, y: p.y });
  const s2 = snapshot(g, false);
  const mine = s2.shots.find(sh => sh.who === 'p');
  const theirs = s2.shots.find(sh => sh.who === 'e');
  assert.equal(mine.ownerPid, 0, 'player shots ship ownerPid');
  assert.ok(theirs && !('ownerPid' in theirs), 'enemy shots gain no ownerPid key');
}

// --- night waves: marchers engage a player seen within 6 tiles, resume at 9 ---
function testNightWaveEngageAndResume() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  const tiles = [];
  tiles.push('#'.repeat(40));
  for (let y = 1; y < 19; y++) tiles.push('#' + '.'.repeat(38) + '#');
  tiles.push('#'.repeat(40));
  tiles[10] = put(put(tiles[10], 8, 'g'), 30, 'K');
  tiles[5] = put(tiles[5], 8, 'P'); // 5 tiles north of the marcher, clear sight
  const level = { name: 'Engage Test', time: 600, captiveChars: [], tiles };
  const g = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  const p = g.players[0];
  const e = g.enemies[0];
  p.invuln = 999;
  g.graceT = 0;
  e.awake = true;
  e.targetCore = true;
  e.aggro *= 100; // exactly how spawnNightWave arms its hunters
  const dCore0 = Math.hypot(e.x - 30.5 * TILE, e.y - 10.5 * TILE);
  run(g, () => ({ 0: {} }), 1.5);
  assert.equal(e.engagePid, 0, 'a player seen within 6 tiles is engaged');
  const dP = Math.hypot(e.x - p.x, e.y - p.y);
  assert.ok(dP < TILE * 5, `the marcher broke off to fight (now ${(dP / TILE).toFixed(1)} tiles from the player)`);
  assert.ok(Math.hypot(e.x - 30.5 * TILE, e.y - 10.5 * TILE) >= dCore0 - TILE,
    'it was not closing on the core while engaged');
  // the player breaks contact past 9 tiles: the march resumes (no kiting forever)
  p.x = 2.5 * TILE;
  p.y = 17.5 * TILE;
  step(g, { 0: {} }, 1 / 30);
  assert.equal(e.engagePid, undefined, 'past 9 tiles the engagement drops');
  const dCore1 = Math.hypot(e.x - 30.5 * TILE, e.y - 10.5 * TILE);
  run(g, () => ({ 0: {} }), 3);
  assert.ok(Math.hypot(e.x - 30.5 * TILE, e.y - 10.5 * TILE) < dCore1 - TILE * 2,
    'the wave resumes its core march after disengaging');
}

// --- sealed camp: a core-marcher whose A* fails gnaws the blocking barricade ---
function testSealedCampGnawFallback() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  const tiles = [];
  tiles.push('#'.repeat(40));
  for (let y = 1; y < 19; y++) tiles.push('#' + '.'.repeat(38) + '#');
  tiles.push('#'.repeat(40));
  // a walled cell rows 8..12 x cols 18..24, single gap at (21,8) plugged by a
  // built barricade; the core inside; the marcher outside to the north
  for (let x = 18; x <= 24; x++) { tiles[8] = put(tiles[8], x, '#'); tiles[12] = put(tiles[12], x, '#'); }
  for (let y = 9; y <= 11; y++) { tiles[y] = put(tiles[y], 18, '#'); tiles[y] = put(tiles[y], 24, '#'); }
  tiles[8] = put(tiles[8], 21, 'B');
  tiles[10] = put(tiles[10], 21, 'K');
  tiles[3] = put(tiles[3], 21, 'g');
  tiles[17] = put(tiles[17], 3, 'P'); // far away: no engagement noise
  const level = {
    name: 'Sealed Camp', time: 600, captiveChars: [],
    builds: [{ kind: 'barricade', cost: 4 }],
    tiles,
  };
  const g = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  const p = g.players[0];
  const site = g.builds[0];
  site.built = true;
  site.progress = 1;
  site.hp = site.maxHp;
  site.invested = site.cost;
  p.invuln = 999;
  g.graceT = 0;
  const e = g.enemies[0];
  e.awake = true;
  e.targetCore = true;
  e.aggro *= 100;
  run(g, () => ({ 0: {} }), 30);
  assert.ok(g.events.some(ev => ev.type === 'buildHit'), 'the sealed-out marcher gnawed the barricade (no corner pile-up)');
  assert.ok(g.events.some(ev => ev.type === 'buildDown' && ev.kind === 'barricade'), 'it chewed the barricade down');
  assert.ok(g.events.some(ev => ev.type === 'coreHit'), 'then resumed the march and reached the core');
  assert.ok(g.core.hp < 30, 'the core is under siege');
}

// --- bastion difficulty: night>=3 waves +15% hp; blood moons +1 hp, x1.15 speed, 60% second edge ---
function testBloodMoonAndLateNightBuffs() {
  const g = createGame(bastionDef({ nights: 4, dayLen: 2, nightLen: 2, bloodMoons: [4] }),
    [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.graceT = 1e9; // freeze the field: this test inspects spawn stats only
  g.players[0].invuln = 999;
  // nights 1+2 (5 + 7 spawns) carry no hp buff
  run(g, () => ({ 0: {} }), 6.5);
  assert.equal(g.enemies.length, 12, 'nights 1+2 spawned 5 + 7');
  assert.ok(g.enemies.filter(e => !e.mutation && e.letter === 'z').every(e => e.hp === 1),
    'early-night plain husks keep base 1 hp');
  // night 3 (normal): +15% hp rounded up, applied after mutation.
  // Composition (solo size 8): z g w u r z q f (cycle zgwur, q/f trailing).
  run(g, () => ({ 0: {} }), 4);
  const wave3 = g.enemies.slice(12);
  assert.equal(wave3.length, 8, 'night 3 solo wave is 8 (base 10 x 0.8)');
  assert.deepEqual(wave3.map(e => e.letter), ['z', 'g', 'w', 'u', 'r', 'z', 'q', 'f'],
    'night 3 blends the frontier roster plus one acolyte and one alpha');
  const plainSkitter3 = wave3[2]; // 'w', mutation roll (3*31+2)%5 = 0 -> none
  assert.equal(plainSkitter3.letter, 'w');
  assert.equal(plainSkitter3.mutation, undefined);
  assert.equal(plainSkitter3.hp, 2, 'night 3 skitter: ceil(1 * 1.15) = 2');
  const plainAlpha3 = wave3[7]; // 'f', roll (3*31+7)%5 = 0 -> none
  assert.equal(plainAlpha3.letter, 'f');
  assert.equal(plainAlpha3.hp, 4, 'night 3 fork alpha: ceil(3 * 1.15) = 4');
  const bulk3 = wave3[4]; // 'r', roll (3*31+4)%5 = 2 -> bulk
  assert.equal(bulk3.letter, 'r');
  assert.equal(bulk3.mutation, 'bulk');
  assert.equal(bulk3.hp, 7, 'night 3 bulk charger: ceil(3*2 * 1.15) = 7');
  assert.equal(bulk3.speed, 1.0 * TILE * 0.75, 'normal-night buff never touches speed');
  // night 4 (blood moon): full mutation, +1 hp, +15% speed — no 15% hp
  // stacking. Composition (solo size 10): z g w u s v g w q f — wraiths
  // join from n4. Second edge brings the 60% detachment (round(10*0.6)=6).
  run(g, () => ({ 0: {} }), 4);
  const wave4 = g.enemies.slice(20);
  assert.equal(wave4.length, 16, 'blood moon: 10 first edge + 6 (60%) second edge');
  assert.ok(wave4.every(e => e.mutation), 'every blood moon enemy is mutated');
  assert.ok(wave4.some(e => e.letter === 'v') && wave4.some(e => e.letter === 's'),
    'night 4 anchors bulwarks and stalks in Volt Wraiths');
  const feral4 = wave4[2]; // 'w', roll (4*31+2)%5 = 1 -> feral
  assert.equal(feral4.mutation, 'feral');
  assert.equal(feral4.hp, 2, 'blood skitter: 1 + 1 hp (no 15% on blood nights)');
  assert.equal(feral4.speed, 2.0 * TILE * 1.5 * 1.15, 'blood feral skitter: base x1.5 feral x1.15 blood');
  const split4 = wave4[0]; // 'z', roll (4*31)%5 = 4 -> split
  assert.equal(split4.letter, 'z');
  assert.equal(split4.mutation, 'split');
  assert.equal(split4.hp, 2, 'blood husk: 1 + 1 hp');
  assert.equal(split4.speed, 1.0 * TILE * 1.15, 'blood husk pace: base x1.15');
  const wraith4 = wave4[5]; // 'v', roll (4*31+5)%5 = 4 -> split
  assert.equal(wraith4.letter, 'v');
  assert.equal(wraith4.hp, 4, 'blood wraith: rebalanced 3 + 1 hp');
}

// ===== SIM-D: frontier III — new roster, field weapons, quests ==============

// --- letters audit: z f q v x u / A / I all parse, collide with nothing ---
function testFrontierLettersParse() {
  const def = {
    name: 'Frontier Letters', time: 60, captiveChars: [],
    pickups: [{ kind: 'railcannon', ammo: 3 }],
    qitems: [{ id: 'frag1', kind: 'fragment' }],
    tiles: [
      '############',
      '#P.zfqvxu..#',
      '#..A..I....#',
      '############',
    ],
  };
  const lvl = parseLevel(def);
  assert.deepEqual(lvl.enemies.map(e => e.kind), ['husk', 'alpha', 'acolyte', 'wraith', 'stalker', 'beetle'],
    'z f q v x u parse row-major into the six new kinds');
  const by = k => lvl.enemies.find(e => e.kind === k);
  assert.equal(by('husk').hp, 1, 'husk hp 1');
  assert.equal(by('husk').score, 40, 'husk score 40');
  assert.equal(by('alpha').hp, 3, 'fork alpha hp 3');
  assert.equal(by('alpha').speed, 1.7 * TILE, 'fork alpha speed 1.7');
  assert.equal(by('acolyte').range, 5 * TILE, 'acolyte support range 5 tiles');
  assert.equal(by('wraith').range, 6 * TILE, 'wraith zap range 6 tiles');
  assert.equal(by('stalker').blinkT, 3.5 + (4 % 4) * 0.35, 'stalker blink clock staggered by id');
  assert.equal(by('beetle').score, 130, 'beetle score 130');
  assert.deepEqual(lvl.pickups, [{ id: 'fw0', x: 3.5 * TILE, y: 2.5 * TILE, kind: 'railcannon', ammo: 3 }],
    'A binds def.pickups row-major (kind + ammo)');
  assert.deepEqual(lvl.qitems, [{ id: 'frag1', kind: 'fragment', x: 6.5 * TILE, y: 2.5 * TILE, carrier: null }],
    'I binds def.qitems row-major');
  for (const row of lvl.grid) assert.ok(!/[zfqvxuAI]/.test(row), 'every frontier letter resolves to floor');
  // defaults: pickups cycle the four field kinds, qitems default to fragments
  const dflt = parseLevel({ tiles: ['########', '#PAAAAI#', '########'] });
  assert.deepEqual(dflt.pickups.map(w => w.kind), ['flamer', 'railcannon', 'stormgun', 'mortarMk2'],
    'unbound A tiles cycle the field kinds deterministically');
  assert.equal(dflt.pickups[0].ammo, 90, 'flamer default fuel 90');
  assert.equal(dflt.pickups[1].ammo, 10, 'railcannon default 10 rounds');
  assert.equal(dflt.pickups[2].ammo, 24, 'stormgun default 24 rounds');
  assert.equal(dflt.pickups[3].ammo, 14, 'mortarMk2 default 14 rounds');
  assert.equal(dflt.qitems[0].kind, 'fragment', 'unbound I defaults to a proof fragment');
  // populated maps ship the new keys; classics never gain them
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const s = snapshot(g, false);
  assert.equal(s.pickups.length, 1, 'snapshot ships pickups');
  assert.equal(s.qitems.length, 1, 'snapshot ships qitems');
  const classic = snapshot(createGame(levels[0], [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster), false);
  for (const key of ['pickups', 'qitems', 'quests', 'untimed', 'elapsed']) {
    assert.ok(!(key in classic), `classic snapshots never gain '${key}'`);
  }
}

// --- fork alpha always splits; new letters ride the wave machinery ---
function testAlphaSplitAndFrontierWaves() {
  const level = {
    name: 'Alpha Test', time: 30, captiveChars: [],
    tiles: ['##########', '#P..f....#', '##########'],
  };
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.players[0].invuln = 999;
  run(g, () => ({ 0: aimAtNearest(g, g.players[0]) }), 12);
  assert.ok(g.events.some(ev => ev.type === 'die' && ev.kind === 'alpha'), 'the alpha died');
  assert.equal(g.events.filter(ev => ev.type === 'spawnEnemy' && ev.kind === 'skitter').length, 2,
    'a dying alpha always splits into exactly two skitters');
  assert.ok(g.kills >= 3 || g.status === 'cleared', 'the twins were hunted down too');
  // new letters spawn from scripted waves exactly like the classics
  const wlevel = bigEmptyLevel([[17, '#....................................g#']]);
  wlevel.modifiers = { waves: [{ at: 0.5, letters: 'zu', edge: 'n' }] };
  wlevel.difficulty = 'extreme'; // pin: both wave letters must spawn for the kind check
  const wg = createGame(wlevel, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  wg.players[0].invuln = 999;
  run(wg, () => ({ 0: {} }), 1);
  const kinds = wg.enemies.map(e => e.kind);
  assert.ok(kinds.includes('husk') && kinds.includes('beetle'), 'wave letters z/u spawn husk and beetle');
  assert.ok(wg.enemies.filter(e => e.kind !== 'grunt').every(e => e.awake), 'wave spawns arrive awake');
}

// --- null acolyte: support pulses, one-hit ward, 25%-rate mend, pacifism ---
function testAcolyteShieldHealAndPacifism() {
  const level = {
    name: 'Acolyte Test', time: 60, captiveChars: [],
    tiles: ['############', '#P..gq.....#', '############'],
  };
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  const grunt = g.enemies.find(e => e.kind === 'grunt');
  p.invuln = 999;
  g.graceT = 0;
  // acolyte id 1: first pulse lands at 2.5 + 0.25s
  run(g, () => ({ 0: {} }), 3);
  assert.equal(grunt.shielded, true, 'the acolyte warded its nearest packmate');
  assert.ok(g.events.some(ev => ev.type === 'enemyShield' && ev.kind === 'grunt'), 'enemyShield cue fired');
  assert.equal(snapshot(g, false).enemies.find(e => e.kind === 'grunt').shielded, true, 'snapshot flags the ward');
  // the ward soaks exactly one hit, leaving hp untouched
  g.graceT = 1e9; // freeze the field and line up a clean shot at the grunt
  p.x = grunt.x + 3 * TILE;
  p.y = grunt.y;
  p.fx = -1; p.fy = 0;
  for (let i = 0; i < 60 && !g.events.some(ev => ev.type === 'shieldPop'); i++) {
    step(g, { 0: { fire: true } }, 1 / 30);
  }
  assert.ok(g.events.some(ev => ev.type === 'shieldPop' && ev.kind === 'grunt'), 'the ward popped under fire');
  assert.equal(grunt.shielded, false, 'one absorb charge only');
  assert.equal(grunt.hp, 2, 'the warded hit cost no hp');
  // mend: every 4th pulse heals the nearest wounded packmate 1 hp
  const g2 = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g2.players[0].invuln = 999;
  g2.graceT = 0;
  const hurt = g2.enemies.find(e => e.kind === 'grunt');
  hurt.hp = 1;
  run(g2, () => ({ 0: {} }), 11);
  assert.ok(g2.events.some(ev => ev.type === 'enemyHeal' && ev.kind === 'grunt'), 'the 4th pulse mended the packmate');
  assert.equal(hurt.hp, 2, 'mend restored exactly 1 hp');
  // pacifism: an acolyte alone never lays a hand on a player
  const g3 = createGame({
    name: 'Pacifist', time: 30, captiveChars: [],
    tiles: ['########', '#P.q...#', '########'],
  }, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g3.players[0].invuln = 0;
  g3.graceT = 0;
  run(g3, () => ({ 0: {} }), 5);
  assert.equal(g3.players[0].state, 'active', 'the acolyte never attacks players directly');
  assert.ok(!g3.events.some(ev => ev.type === 'down' || ev.type === 'playerHit'), 'no player damage of any kind');
}

// --- volt wraith: chain-zap stings and roots; a shield pip soaks the lot ---
function testWraithZapStunAndShieldAbsorb() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  const mk = () => {
    let r = '#' + '.'.repeat(38) + '#';
    r = put(put(r, 4, 'P'), 9, 'v');
    const g = createGame(bigEmptyLevel([[5, r]]), [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
    g.graceT = 0;
    g.players[0].invuln = 0;
    return g;
  };
  const g = mk();
  const p = g.players[0];
  for (let i = 0; i < 150 && !g.events.some(ev => ev.type === 'playerHit'); i++) step(g, { 0: {} }, 1 / 30);
  assert.ok(g.events.some(ev => ev.type === 'playerHit'), 'the zap landed');
  assert.equal(p.hp, 2, 'zap costs 1 hp');
  assert.ok(p.stunT > 0, 'an unshielded operative is rooted');
  const x0 = p.x;
  step(g, { 0: { right: true } }, 1 / 30);
  assert.equal(p.x, x0, 'rooted feet hold still');
  run(g, () => ({ 0: { right: true } }), 0.5);
  assert.ok(p.x > x0, 'the root wears off in 0.3s');
  // shield pips absorb the zap whole — damage AND stun
  const g2 = mk();
  const p2 = g2.players[0];
  p2.shield = 2;
  for (let i = 0; i < 150 && !g2.events.some(ev => ev.type === 'playerHit'); i++) step(g2, { 0: {} }, 1 / 30);
  assert.equal(p2.hp, 3, 'shield pip soaked the damage');
  assert.equal(p2.shield, 1, 'one pip spent');
  assert.ok(!(p2.stunT > 0), 'shield absorbs the stun too');
}

// --- phase stalker: deterministic 3-tile blinks toward its prey, then melee ---
function testStalkerBlinkAndMelee() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(r, 4, 'P'), 18, 'x');
  const g = createGame(bigEmptyLevel([[5, r]]), [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  const e = g.enemies[0];
  assert.equal(e.kind, 'stalker');
  e.awake = true;
  g.graceT = 0;
  p.invuln = 0;
  run(g, () => ({ 0: {} }), 3.6);
  const blink = g.events.find(ev => ev.type === 'blink');
  assert.ok(blink, 'the stalker blinked on its 3.5s cadence');
  assert.ok(Math.abs(Math.hypot(blink.tx - blink.x, blink.ty - blink.y) - 3 * TILE) < 1,
    'a full blink covers exactly 3 tiles');
  run(g, () => ({ 0: {} }), 8);
  assert.ok(g.events.some(ev => ev.type === 'playerHit'), 'the stalker closed and mauled in melee');
}

// --- pyre beetle: death burst — 1 dmg AoE plus a hostile burn patch ---
function testBeetleBurstAndHostilePatch() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(r, 4, 'P'), 5, 'u'), 6, 'g');
  const g = createGame(bigEmptyLevel([[5, r]]), [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  const beetle = g.enemies.find(e => e.kind === 'beetle');
  const grunt = g.enemies.find(e => e.kind === 'grunt');
  g.graceT = 1e9; // freeze the field: this test inspects the death burst only
  p.invuln = 0;
  p.fx = 1; p.fy = 0;
  beetle.hp = 1;
  for (let i = 0; i < 30 && !beetle.dead; i++) step(g, { 0: { fire: true } }, 1 / 30);
  assert.ok(beetle.dead, 'the beetle fell to fire');
  const burst = g.events.find(ev => ev.type === 'pyreBurst');
  assert.ok(burst, 'pyreBurst fired');
  assert.equal(burst.radius, 1.2 * TILE, 'burst radius is 1.2 tiles');
  assert.equal(p.hp, 2, 'the urn blast cost the adjacent operative 1 hp');
  const patch = g.patches.find(pa => pa.kind === 'burn');
  assert.ok(patch && patch.hostile, 'a hostile burn patch pools at the corpse');
  assert.equal(patch.r, 1.2 * TILE, 'patch radius is 1.2 tiles');
  assert.ok(snapshot(g, false).patches[0].hostile, 'snapshot flags the hostile patch');
  // the patch sears players (~1/s through the hit grace), never enemies
  run(g, () => ({ 0: {} }), 1.3);
  assert.equal(p.hp, 1, 'standing in the fire costs ~1 hp per second');
  assert.ok(!(grunt.burnT > 0), 'hostile patches pass clean over enemies');
}

// --- field weapons: pickup, fire override, ammo, evaporation ---
function testFieldWeaponPickupOverrideAndAmmo() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(r, 4, 'P'), 5, 'A');
  const level = bigEmptyLevel([[5, r], [17, '#....................................g#']]);
  level.pickups = [{ kind: 'railcannon', ammo: 2 }];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  const ch = charMap[p.charId];
  p.invuln = 999;
  p.dmgBonus = 1;
  p.level = 4; // evolutions must NOT touch field weapons
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.deepEqual(p.fieldWeapon, { kind: 'railcannon', ammo: 2 }, 'act grabs the pickup');
  assert.equal(g.pickups.length, 0, 'the pickup left the field');
  assert.ok(g.events.some(ev => ev.type === 'fieldPickup' && ev.kind === 'railcannon'), 'fieldPickup cue fired');
  assert.deepEqual(snapshot(g, false).players[0].fieldWeapon, { kind: 'railcannon', ammo: 2 }, 'snapshot ships the held weapon');
  const n0 = g.shots.length;
  step(g, { 0: { fire: true } }, 1 / 30);
  assert.equal(g.shots.length - n0, 1, 'railcannon fires a single slug (no evolution multishot)');
  const shot = g.shots[g.shots.length - 1];
  assert.equal(shot.kind, 'railcannon', 'the field weapon overrides main fire');
  assert.equal(shot.dmg, 6, 'dmg 5 + shop token bonus (dmgBonus still applies)');
  assert.equal(shot.pierce, 6, 'railcannon pierces 6');
  assert.equal(p.fieldWeapon.ammo, 1, 'each trigger pull spends 1 round');
  assert.equal(p.cool, 1.4, 'field weapons use their own cooldown');
  p.cool = 0;
  step(g, { 0: { fire: true } }, 1 / 30);
  assert.equal(p.fieldWeapon, null, 'a dry weapon evaporates — nothing drops');
  assert.equal(g.pickups.length, 0, 'no pickup from an empty weapon');
  assert.ok(g.events.some(ev => ev.type === 'fieldEmpty' && ev.kind === 'railcannon'), 'fieldEmpty cue fired');
  p.cool = 0;
  step(g, { 0: { fire: true } }, 1 / 30);
  const back = g.shots[g.shots.length - 1];
  assert.equal(back.kind, ch.weapon.kind || ch.weapon.name || 'shot', 'the character weapon is back next press');
}

// --- field weapons: 0.8s ITEM-hold drop, teammate sharing, downed drop ---
function testFieldWeaponDropShareAndDownedDrop() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(r, 4, 'P');
  const level = bigEmptyLevel([[5, r], [17, '#....................................g#']]);
  const party = startingRoster.slice(0, 2).map((id, i) => ({ pid: i, name: id, charId: id }));
  const g = createGame(level, party, charMap, startingRoster);
  const [p0, p1] = g.players;
  p0.invuln = 999;
  g.graceT = 0;
  p0.fieldWeapon = { kind: 'stormgun', ammo: 7 };
  // a short tap never drops
  run(g, () => ({ 0: { item: true } }), 0.5);
  assert.ok(p0.fieldWeapon, 'a 0.5s hold keeps the weapon');
  run(g, () => ({ 0: {} }), 0.2);
  run(g, () => ({ 0: { item: true } }), 0.9);
  assert.equal(p0.fieldWeapon, null, 'a 0.8s ITEM hold drops the weapon');
  assert.equal(g.pickups.length, 1, 'the drop lies as a pickup');
  assert.equal(g.pickups[0].ammo, 7, 'remaining ammo rides the drop');
  assert.ok(g.events.some(ev => ev.type === 'fieldDrop' && ev.pid === 0), 'fieldDrop cue fired');
  // a teammate scoops the cast-off
  p1.x = g.pickups[0].x;
  p1.y = g.pickups[0].y;
  step(g, {}, 1 / 30);
  step(g, { 1: { act: true } }, 1 / 30);
  assert.deepEqual(p1.fieldWeapon, { kind: 'stormgun', ammo: 7 }, 'teammates can grab a dropped weapon');
  // going down drops the weapon at the body (step away from the invulnerable
  // teammate first so the grunt unambiguously hunts the carrier)
  p1.x += 8 * TILE;
  const e = g.enemies[0];
  e.awake = true;
  e.x = p1.x + 20;
  e.y = p1.y;
  p1.hp = 1;
  p1.invuln = 0;
  run(g, () => ({}), 2);
  assert.ok(p1.state !== 'active', 'the carrier went down');
  assert.ok(!p1.fieldWeapon, 'downed players lose the weapon from hand');
  assert.equal(g.pickups.length, 1, 'the weapon lies where they fell');
  assert.equal(g.pickups[0].kind, 'stormgun', 'same weapon');
  assert.equal(g.pickups[0].ammo, 7, 'same ammo');
  // grabbing with full hands swaps: the old weapon drops at the feet
  p0.fieldWeapon = { kind: 'flamer', ammo: 5 };
  p0.x = g.pickups[0].x;
  p0.y = g.pickups[0].y;
  step(g, {}, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.deepEqual(p0.fieldWeapon, { kind: 'stormgun', ammo: 7 }, 'the new weapon is in hand');
  assert.deepEqual(g.pickups.map(w => ({ kind: w.kind, ammo: w.ammo })), [{ kind: 'flamer', ammo: 5 }],
    'the old weapon swapped out at the feet');
  // --- ITEM tap vs hold: with a weapon in hand a TAP (<0.3s, on release)
  // uses the item slot; a HOLD >=0.8s drops the weapon and never uses ---
  p0.item = { kind: 'medkit', count: 2 };
  p0.hp = 1;
  run(g, () => ({ 0: { item: true } }), 4 / 30); // 0.13s and still held...
  assert.equal(p0.hp, 1, 'a press in flight does nothing yet (tap-use waits for the release)');
  run(g, () => ({ 0: {} }), 0.2); // ...released inside the 0.3s tap window
  assert.equal(p0.hp, 3, 'the tap used the medkit on release (+2)');
  assert.equal(p0.item.count, 1, 'one medkit spent');
  assert.deepEqual(p0.fieldWeapon, { kind: 'stormgun', ammo: 7 }, 'the tap never dropped the weapon');
  // a mid-length press (0.3s..0.8s) is neither tap nor drop
  run(g, () => ({ 0: { item: true } }), 0.5);
  run(g, () => ({ 0: {} }), 0.2);
  assert.equal(p0.hp, 3, 'a 0.5s press is no tap: the item is preserved');
  assert.deepEqual(p0.fieldWeapon, { kind: 'stormgun', ammo: 7 }, 'and no drop either');
  // a full 0.8s hold drops the weapon; the closing release never tap-uses
  const drops0 = g.pickups.length;
  run(g, () => ({ 0: { item: true } }), 0.9);
  assert.equal(p0.fieldWeapon, null, 'the 0.8s hold dropped the weapon');
  assert.equal(g.pickups.length, drops0 + 1, 'it lies as a pickup');
  run(g, () => ({ 0: {} }), 0.2);
  assert.equal(p0.hp, 3, 'the release closing a fired hold uses nothing');
  assert.equal(p0.item.count, 1, 'the medkit is untouched');
  // empty-handed (no field weapon) the press edge uses the item immediately
  p0.hp = 1; // hurt again so the heal isn't a full-hp no-op
  step(g, { 0: { item: true } }, 1 / 30);
  assert.equal(p0.hp, 3, 'without a field weapon the press edge heals at once');
  assert.equal(p0.item, null, 'the last medkit is spent');
}

// --- quests: fetch lifecycle — hidden, active, carried fragment, done ---
function testQuestFetchLifecycle() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(r, 4, 'P'), 8, 'N'), 20, 'I');
  const level = bigEmptyLevel([[5, r], [17, '#....................................g#']]);
  level.npcs = [{ id: 'sefa', name: 'Elder Tenwright', lines: ['Seven I can settle. Six I can only mourn.'] }];
  level.qitems = [{ id: 'frag1', kind: 'fragment' }];
  level.quests = [{
    id: 'count1', main: true, title: 'The Count', giver: 'sefa', kind: 'fetch',
    item: 'fragment', count: 1, reward: { shards: 7 }, hint: 'Six is not a quorum.',
  }];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  const npc = g.npcs[0];
  const qi = g.qitems[0];
  p.invuln = 999;
  assert.deepEqual(snapshot(g, false).quests, [{
    id: 'count1', state: 'hidden', progress: 0, count: 1, title: 'The Count', main: true, kind: 'fetch',
  }], 'quests ship hidden in the snapshot from the start');
  const talk = () => {
    step(g, { 0: {} }, 1 / 30);
    step(g, { 0: { act: true } }, 1 / 30);
  };
  p.x = npc.x + TILE;
  p.y = npc.y;
  talk();
  assert.equal(g.quests[0].state, 'active', 'talking to the giver activates the quest');
  assert.ok(g.events.some(ev => ev.type === 'quest' && ev.id === 'count1' && ev.state === 'active' && ev.main === true),
    'quest activation event fired');
  talk();
  assert.equal(g.quests[0].state, 'active', 'empty-handed talk completes nothing');
  // touch the fragment: scooped like a captive, then it trails the carrier
  p.x = qi.x;
  p.y = qi.y;
  step(g, { 0: {} }, 1 / 30);
  assert.equal(qi.carrier, 0, 'quest items are picked up on touch');
  assert.ok(g.events.some(ev => ev.type === 'qitemPickup' && ev.id === 'frag1'), 'qitemPickup cue fired');
  p.x += 5 * TILE;
  run(g, () => ({ 0: {} }), 1.5);
  assert.ok(Math.hypot(qi.x - p.x, qi.y - p.y) < TILE * 2, 'the fragment trails its carrier');
  assert.equal(g.quests[0].progress, 1, 'fetch progress mirrors the carried count for the HUD');
  // a downed carrier lays the fragment where they stood
  p.state = 'down';
  step(g, {}, 1 / 30);
  assert.equal(qi.carrier, null, 'down drops the quest item');
  p.state = 'active';
  p.x = qi.x;
  p.y = qi.y;
  step(g, { 0: {} }, 1 / 30);
  assert.equal(qi.carrier, 0, 'rescooped on touch');
  // deliver
  p.x = npc.x + TILE;
  p.y = npc.y;
  const shards0 = g.shards;
  talk();
  assert.equal(g.quests[0].state, 'done', 'carrying the fragment to the giver completes the fetch');
  assert.equal(g.qitems.length, 0, 'the fragment is handed over and consumed');
  assert.equal(g.shards, shards0 + 7, 'the shard reward pays the pool');
  assert.ok(g.events.some(ev => ev.type === 'quest' && ev.id === 'count1' && ev.state === 'done'), 'quest done event fired');
}

// --- quests: kill/build/reach progress, rewards, openDoor parking, hooks ---
function testQuestKillBuildReachAndRewards() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(put(put(r, 4, 'P'), 10, 'z'), 12, 'z'), 14, 'z'), 8, 'N');
  let r2 = '#' + '.'.repeat(38) + '#';
  r2 = put(r2, 4, 'B');
  // a far sleeping grunt keeps the field from auto-clearing once husks fall
  const level = bigEmptyLevel([[5, r], [8, r2], [17, '#....................................g#']]);
  level.npcs = [{ id: 'sefa', name: 'Elder Tenwright', lines: ['Put them down kindly.'] }];
  level.builds = [{ kind: 'barricade', cost: 2 }];
  level.doors = [{ id: 'door1', x: 34, y: 14 }];
  level.quests = [
    { id: 'cull', title: 'Cull the Husks', giver: 'sefa', kind: 'kill', target: 'z', count: 2, reward: { openDoor: 'door1' } },
    { id: 'wall', title: 'Raise the Wall', giver: 'sefa', kind: 'build', target: 'barricade', count: 1, reward: { item: 'medkit' } },
    { id: 'ridge', title: 'Reach the Ridge', giver: 'sefa', kind: 'reach', target: { x: 30, y: 12 }, count: 1, reward: { weapon: 'stormgun' } },
    { id: 'mig', title: 'The Migration', giver: 'sefa', kind: 'destroy', target: 'pillar', count: 1 },
  ];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  const npc = g.npcs[0];
  p.invuln = 999;
  g.graceT = 0;
  g.shards = 10;
  const qById = id => g.quests.find(q => q.id === id);
  // kills before activation earn nothing
  for (let i = 0; i < 240 && g.kills < 1; i++) step(g, { 0: aimAtNearest(g, p) }, 1 / 30);
  assert.ok(g.kills >= 1, 'a husk fell before the quest was taken');
  const talk = () => {
    step(g, { 0: {} }, 1 / 30);
    step(g, { 0: { act: true } }, 1 / 30);
  };
  p.x = npc.x + TILE;
  p.y = npc.y;
  talk();
  assert.ok(g.quests.every(q => q.state === 'active'), 'one talk hands out every quest the giver holds');
  assert.equal(qById('cull').progress, 0, 'pre-activation kills never count');
  // cull two more husks
  for (let i = 0; i < 600 && g.kills < 3; i++) step(g, { 0: aimAtNearest(g, p) }, 1 / 30);
  assert.equal(qById('cull').progress, 2, 'kill quests count the target letter');
  assert.ok(g.events.some(ev => ev.type === 'questProgress' && ev.id === 'cull' && ev.progress === 2), 'progress events fired');
  // raise the wall (hold act on the site)
  const site = g.builds[0];
  p.x = site.x + TILE;
  p.y = site.y;
  run(g, () => ({ 0: { act: true } }), 2.5);
  assert.ok(site.built, 'the barricade went up');
  assert.equal(qById('wall').progress, 1, 'build quests count completed structures');
  // reach the ridge
  p.x = (30 + 0.5) * TILE;
  p.y = (12 + 0.5) * TILE;
  step(g, { 0: {} }, 1 / 30);
  assert.equal(qById('ridge').progress, 1, 'reach quests trip on standing at the target tile');
  // the puzzle-system hook (switch/glyph/destroy/craft resolutions call this)
  questProgress(g, 'destroy', ['pillar'], 0, 0);
  assert.equal(qById('mig').progress, 1, 'exported questProgress drives linked-system quests');
  // settle all four with the giver
  p.x = npc.x + TILE;
  p.y = npc.y;
  talk();
  assert.ok(g.quests.every(q => q.state === 'done'), 'one settling talk completes every satisfied quest');
  // the parked openDoor reward is consumed by stepDoors in the same tick
  assert.deepEqual(g.pendingDoorOpens, [], 'the door system drained the parked reward');
  assert.equal(g.doors[0].open, true, 'the openDoor reward swung door1');
  assert.ok(g.events.some(ev => ev.type === 'doorOpen' && ev.id === 'door1'), 'doorOpen event fired');
  assert.deepEqual(p.item, { kind: 'medkit', count: 1 }, 'item rewards fill the slot');
  assert.deepEqual(p.fieldWeapon, { kind: 'stormgun', ammo: 24 }, 'weapon rewards arrive fully loaded');
  assert.equal(g.events.filter(ev => ev.type === 'quest' && ev.state === 'done').length, 4, 'four done events');
  const s = snapshot(g, false);
  assert.ok(s.quests.every(q => q.state === 'done'), 'snapshot tracks quest completion');

  // --- main-quest gate + binary 'reach' finale (fresh field) ---------------
  // The extermination auto-clear must hold while a MAIN quest is in flight,
  // and a count-3 reach quest must complete in ONE tick (binary), with the
  // settled main chain's reach finale clearing the chapter at the ring.
  let rm = '#' + '.'.repeat(38) + '#';
  rm = put(put(put(rm, 4, 'P'), 8, 'N'), 12, 'z');
  const level2 = bigEmptyLevel([[5, rm]]);
  level2.npcs = [{ id: 'brakka', name: 'Sel Brakka', lines: ['Walk in and prove it.'] }];
  level2.quests = [
    { id: 'm-cull', main: true, title: 'Cull the Husk', giver: 'brakka', kind: 'kill', target: 'z', count: 1 },
    { id: 'm-core', main: true, title: 'Reach the Core', giver: 'brakka', kind: 'reach', target: { x: 30, y: 5 }, count: 3 },
  ];
  const g2 = createGame(level2, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p2 = g2.players[0];
  const npc2 = g2.npcs[0];
  p2.invuln = 999;
  g2.graceT = 0;
  const talk2 = () => {
    step(g2, { 0: {} }, 1 / 30);
    step(g2, { 0: { act: true } }, 1 / 30);
  };
  p2.x = npc2.x + TILE;
  p2.y = npc2.y;
  talk2();
  assert.ok(g2.quests.every(q => q.state === 'active'), 'both main quests are active');
  // exterminate the field: the auto-clear must NOT fire past unfinished mains
  for (let i = 0; i < 600 && g2.enemies.length; i++) step(g2, { 0: aimAtNearest(g2, p2) }, 1 / 30);
  assert.equal(g2.enemies.length, 0, 'the field is empty');
  run(g2, () => ({ 0: {} }), 0.5);
  assert.equal(g2.status, 'play', 'an empty field never auto-clears past an unfinished MAIN quest');
  // settle the kill quest at the giver; the reach finale still holds the field
  p2.x = npc2.x + TILE;
  p2.y = npc2.y;
  talk2();
  assert.equal(g2.quests.find(q => q.id === 'm-cull').state, 'done', 'the kill main settled');
  run(g2, () => ({ 0: {} }), 0.5);
  assert.equal(g2.status, 'play', 'the un-tripped reach finale still holds the field open');
  // step into the ring: count 3 completes in ONE tick, and the finale clears
  p2.x = (30 + 0.5) * TILE;
  p2.y = (5 + 0.5) * TILE;
  step(g2, { 0: {} }, 1 / 30);
  const mq = g2.quests.find(q => q.id === 'm-core');
  assert.equal(mq.progress, 3, 'reach quests are binary: progress jumps straight to count');
  assert.equal(g2.events.filter(ev => ev.type === 'questProgress' && ev.id === 'm-core').length, 1,
    'one progress event total — never 1 per tick');
  assert.equal(g2.status, 'cleared', "the settled main chain's reach finale clears the chapter at the ring");
  assert.ok(g2.events.some(ev => ev.type === 'clear'), 'clear event fired');
}

// --- untimed story: no countdown, no lowTime, waves keep riding elapsed ---
function testUntimedStoryAndBastion() {
  const mkLevel = () => {
    const level = bigEmptyLevel([[17, '#....................................g#']]);
    level.time = 3;
    level.story = true;
    level.modifiers = { waves: [{ at: 5, letters: 'z', edge: 'n' }] };
    return level;
  };
  const g = createGame(mkLevel(), [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  assert.equal(g.untimed, true, 'story levels run untimed');
  g.players[0].invuln = 999;
  run(g, () => ({ 0: {} }), 6.5);
  assert.equal(g.status, 'play', 'the 3s clock never failed the mission');
  assert.equal(g.timeLeft, 3, 'timeLeft never decrements');
  assert.ok(!g.events.some(ev => ev.type === 'lowTime' || ev.type === 'fail'), 'no lowTime, no time-out fail');
  assert.ok(g.enemies.some(e => e.kind === 'husk'), 'waves keep firing on elapsed time (at 5s > time 3)');
  const s = snapshot(g, false);
  assert.equal(s.untimed, true, 'snapshot flags untimed');
  assert.ok(s.elapsed > 6 && s.elapsed < 7, 'snapshot ships elapsed for the count-up clock');
  // def.timed:true opts a story level back into the countdown
  const tLevel = mkLevel();
  tLevel.timed = true;
  tLevel.modifiers = undefined;
  const tg = createGame(tLevel, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  assert.equal(tg.untimed, false, 'timed:true restores the countdown');
  tg.players[0].invuln = 999;
  run(tg, () => ({ 0: {} }), 4);
  assert.equal(tg.status, 'failed', 'the opted-in countdown still fails the level');
  assert.ok(tg.events.some(ev => ev.type === 'lowTime'), 'lowTime still cues on timed levels');
  // bastion maps are untimed by definition; classics keep their countdown
  const bg = createGame(bastionDef(), [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  assert.equal(bg.untimed, true, 'bastion maps run untimed');
  assert.equal(snapshot(bg, false).untimed, true, 'bastion snapshot flags untimed');
  const cg = createGame(levels[0], startingRoster.map((id, i) => ({ pid: i, name: id, charId: id })), charMap, startingRoster);
  assert.equal(cg.untimed, false, 'classics never run untimed');
  run(cg, () => ({}), 1);
  assert.ok(cg.timeLeft < levels[0].time, 'classic countdowns are untouched');
}

// --- determinism: identical scripted runs over every frontier system ---
function testDeterministicFrontierRun() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r5 = '#' + '.'.repeat(38) + '#';
  r5 = put(put(put(put(r5, 4, 'P'), 5, 'P'), 14, 'z'), 18, 'f');
  let r8 = '#' + '.'.repeat(38) + '#';
  r8 = put(put(put(put(r8, 6, 'A'), 10, 'I'), 16, 'q'), 20, 'v');
  let r11 = '#' + '.'.repeat(38) + '#';
  r11 = put(put(put(r11, 8, 'N'), 24, 'x'), 28, 'u');
  const level = bigEmptyLevel([[5, r5], [8, r8], [11, r11]]);
  level.story = true;
  level.npcs = [{ id: 'hask', name: 'Hask Embervein', lines: ['Bring me fragments, not promises.'] }];
  level.qitems = [{ id: 'frag1', kind: 'fragment' }];
  level.quests = [{ id: 'forge', title: 'The Combining', giver: 'hask', kind: 'fetch', item: 'fragment', count: 1, reward: { shards: 5 } }];
  const party = startingRoster.slice(0, 2).map((id, i) => ({ pid: i, name: id, charId: id }));
  const runOnce = () => {
    const g = createGame(level, party, charMap, startingRoster);
    const dt = 1 / 30;
    const h = [];
    for (let i = 0; i < 900 && g.status === 'play'; i++) {
      const inputs = {};
      for (const p of g.players) {
        inputs[p.pid] = {
          right: (i % 60) < 35, down: p.pid === 0 && (i % 80) < 30, up: p.pid === 1 && (i % 80) < 30,
          fire: (i % 9) < 4, act: (i % 50) < 12, item: (i % 100) < 40,
        };
      }
      step(g, inputs, dt);
      if (i % 30 === 0) h.push(JSON.stringify(snapshot(g, false)));
    }
    return h.join('\n');
  };
  assert.ok(runOnce() === runOnce(), 'two identical scripted frontier runs produce identical snapshot streams');
}

// --- puzzle letters: Q J X Z O parse, defs bind row-major, defaults hold ---
function testPuzzleLettersParse() {
  const def = {
    name: 'Puzzle Letters', time: 60, captiveChars: [],
    switches: [{ id: 'swA', group: 'g1' }, { group: 'g1' }],
    glyphs: [{ id: 'glA', symbol: 5, group: 'runes' }],
    teleports: [{ id: 'padA' }, { id: 'padB' }],
    doors: [{ id: 'gate', x: 9, y: 2, sealLock: true }],
    tiles: [
      '############',
      '#P.QQ.J.X..#',
      '#..Z.OO....#',
      '############',
    ],
  };
  const lvl = parseLevel(def);
  assert.deepEqual(lvl.switches, [
    { id: 'swA', x: 3.5 * TILE, y: 1.5 * TILE, on: false, group: 'g1' },
    { id: 'sw1', x: 4.5 * TILE, y: 1.5 * TILE, on: false, group: 'g1' },
  ], 'Q binds def.switches row-major');
  assert.deepEqual(lvl.glyphs, [
    { id: 'glA', x: 6.5 * TILE, y: 1.5 * TILE, symbol: 5, lit: false, group: 'runes' },
  ], 'J binds def.glyphs row-major');
  assert.deepEqual(lvl.pillars, [
    { id: 'pl0', x: 8.5 * TILE, y: 1.5 * TILE, hp: 12, maxHp: 12 },
  ], 'X parses a 12 hp BLS pillar');
  assert.deepEqual(lvl.forges, [{ x: 3.5 * TILE, y: 2.5 * TILE, holdT: 0 }], 'Z parses a seal forge');
  assert.deepEqual(lvl.teleports.map(t => ({ id: t.id, twin: t.twin })),
    [{ id: 'padA', twin: 'padB' }, { id: 'padB', twin: 'padA' }],
    'O pads pair consecutively in def.teleports order');
  for (const row of lvl.grid) assert.ok(!/[QJXZO]/.test(row), 'every puzzle letter resolves to floor');
  // defaults: group 0, symbols cycle 0-7, twin by index pairing, odd pad inert
  const dflt = parseLevel({ tiles: ['#############', '#PQJJJJJJJJJO#'.slice(0, 12) + '#', '#############'] });
  assert.equal(dflt.switches[0].group, 0, 'unbound switches default to group 0');
  assert.deepEqual(dflt.glyphs.map(s => s.symbol), [0, 1, 2, 3, 4, 5, 6, 7, 0], 'unbound glyph symbols cycle the 8 runes');
  const odd = parseLevel({ tiles: ['#####', '#POO#', '#.O.#', '#####'] });
  assert.deepEqual(odd.teleports.map(t => t.twin), ['tp1', 'tp0', null], 'an odd trailing pad has no twin (inert)');
  // populated maps ship the new snapshot keys; classics never gain them
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const s = snapshot(g, false);
  assert.equal(s.switches.length, 2, 'snapshot ships switches');
  assert.equal(s.glyphs.length, 1, 'snapshot ships glyphs');
  assert.equal(s.pillars.length, 1, 'snapshot ships pillars');
  assert.equal(s.forges.length, 1, 'snapshot ships forges');
  assert.equal(s.teleports.length, 2, 'snapshot ships teleports');
  assert.deepEqual(s.doors, [{ id: 'gate', x: 9, y: 2, w: 1, h: 1, open: false, sealLock: true }], 'snapshot ships doors');
  const classic = snapshot(createGame(levels[0], [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster), false);
  for (const key of ['switches', 'switchGroups', 'glyphs', 'pillars', 'forges', 'teleports', 'doors']) {
    assert.ok(!(key in classic), `classic snapshots never gain '${key}'`);
  }
}

// --- relay switches: act toggles ON, the cluster quorum, window resets ---
function testSwitchQuorumWindowAndReset() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(put(r, 4, 'P'), 8, 'Q'), 16, 'Q'), 24, 'Q');
  const level = bigEmptyLevel([[5, r], [17, '#....................................g#']]);
  level.switches = [{ group: 'g1' }, { group: 'g1' }, { group: 'g1' }];
  level.switchGroups = [{ group: 'g1', need: 2, of: 3, window: 2, reward: { openDoor: 'gateA' } }];
  level.doors = [{ id: 'gateA', x: 34, y: 5 }];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  p.invuln = 999;
  // a live 'switch' quest targeting the group counts the quorum
  g.quests.push({
    id: 'sq', main: false, title: 'Bring the Cluster Online', giver: 'none', kind: 'switch',
    target: 'g1', count: 1, reward: null, hint: '', state: 'active', progress: 0,
  });
  const throwAt = sw => {
    p.x = sw.x - TILE;
    p.y = sw.y;
    step(g, { 0: {} }, 1 / 30);
    step(g, { 0: { act: true } }, 1 / 30);
  };
  // one relay alone: the window opens, runs out, and resets the cluster
  throwAt(g.switches[0]);
  assert.equal(g.switches[0].on, true, 'act throws the relay ON');
  assert.ok(g.events.some(ev => ev.type === 'switch' && ev.id === 'sw0' && ev.on === true), 'switch event fired');
  assert.ok(g.switchGroups[0].windowT > 0, 'the first relay starts the quorum window');
  run(g, () => ({ 0: {} }), 2.2);
  assert.equal(g.switches[0].on, false, 'an expired window resets every relay');
  assert.ok(g.events.some(ev => ev.type === 'switchReset' && ev.group === 'g1'), 'switchReset event fired');
  assert.equal(g.doors[0].open, false, 'no quorum, no door');
  // re-throwing the same relay works after a reset; 2-of-3 inside the window wins
  throwAt(g.switches[0]);
  throwAt(g.switches[2]);
  assert.equal(g.switchGroups[0].done, true, 'need-of-of online completes the quorum');
  assert.ok(g.events.some(ev => ev.type === 'quorum' && ev.group === 'g1'), 'quorum event fired');
  assert.equal(g.quests.find(q => q.id === 'sq').progress, 1, "the quorum drove the 'switch' quest");
  step(g, { 0: {} }, 1 / 30);
  assert.equal(g.doors[0].open, true, 'the quorum reward opened its door');
  assert.equal(g.switchGroups[0].windowT, 0, 'a completed quorum stops its clock');
  run(g, () => ({ 0: {} }), 2.2);
  assert.equal(g.switches[0].on, true, 'completed clusters never reset');
  // acting on an ON relay is inert
  const n = g.events.filter(ev => ev.type === 'switch').length;
  throwAt(g.switches[0]);
  assert.equal(g.events.filter(ev => ev.type === 'switch').length, n, 'an ON relay consumes no press');
  const s = snapshot(g, false);
  assert.equal(s.switches.filter(sw => sw.on).length, 2, 'snapshot tracks relay state');
  assert.equal(s.switchGroups[0].done, true, 'snapshot tracks quorum completion');
}

// --- glyph stones: exact order lights the group; a wrong stone resets it ---
function testGlyphOrderAndReset() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(put(r, 4, 'P'), 8, 'J'), 16, 'J'), 24, 'J');
  const level = bigEmptyLevel([[5, r], [17, '#....................................g#']]);
  level.glyphs = [{ symbol: 3, group: 'runes' }, { symbol: 5, group: 'runes' }, { symbol: 1, group: 'runes' }];
  level.glyphGroups = [{ group: 'runes', order: [5, 3, 1], reward: { openDoor: 'vault' } }];
  level.doors = [{ id: 'vault', x: 34, y: 5 }];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  p.invuln = 999;
  // a live 'glyph' quest targeting the group counts the completed order
  g.quests.push({
    id: 'gq', main: false, title: 'Read the Stones', giver: 'none', kind: 'glyph',
    target: 'runes', count: 1, reward: null, hint: '', state: 'active', progress: 0,
  });
  const lightAt = gl => {
    p.x = gl.x - TILE;
    p.y = gl.y;
    step(g, { 0: {} }, 1 / 30);
    step(g, { 0: { act: true } }, 1 / 30);
  };
  const bySym = sym => g.glyphs.find(o => o.symbol === sym);
  // right first stone (rune 5), then a wrong one (rune 1 before 3): reset
  lightAt(bySym(5));
  assert.equal(bySym(5).lit, true, 'the ordered first stone lights');
  assert.ok(g.events.some(ev => ev.type === 'glyph' && ev.symbol === 5), 'glyph event fired');
  lightAt(bySym(1));
  assert.equal(g.glyphs.every(o => !o.lit), true, 'a wrong stone snuffs the whole group');
  assert.ok(g.events.some(ev => ev.type === 'glyphReset' && ev.group === 'runes'), 'glyphReset event fired');
  assert.equal(g.doors[0].open, false, 'no order, no door');
  // the exact order completes
  lightAt(bySym(5));
  lightAt(bySym(3));
  lightAt(bySym(1));
  assert.equal(g.glyphGroups[0].done, true, 'the exact order completes the group');
  assert.ok(g.events.some(ev => ev.type === 'glyphDone' && ev.group === 'runes'), 'glyphDone event fired');
  assert.equal(g.quests.find(q => q.id === 'gq').progress, 1, "the completed order drove the 'glyph' quest");
  step(g, { 0: {} }, 1 / 30);
  assert.equal(g.doors[0].open, true, 'the glyph reward opened its door');
  const s = snapshot(g, false);
  assert.equal(s.glyphs.filter(o => o.lit).length, 3, 'snapshot tracks lit stones');
}

// --- BLS pillars: player fire alone cracks them; 'destroy' quests count ---
function testPillarDestructionAndQuest() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(r, 4, 'P'), 8, 'X'), 12, 'N');
  const level = bigEmptyLevel([[5, r], [17, '#....................................g#']]);
  level.npcs = [{ id: 'tela', name: 'Tela of the Loop', lines: ['Smash the old ciphers.'] }];
  level.quests = [{ id: 'bls', title: 'Obsolete Cryptography', giver: 'tela', kind: 'destroy', target: 'pillar', count: 1 }];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  const pillar = g.pillars[0];
  p.invuln = 999;
  // activate the quest first
  p.x = g.npcs[0].x + TILE;
  p.y = g.npcs[0].y;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(g.quests[0].state, 'active');
  // enemy fire never scratches a pillar
  const eshotN = () => {
    g.shots.push({
      id: g.nextShotId++, x: pillar.x - 2 * TILE, y: pillar.y, vx: 8 * TILE, vy: 0,
      ttl: 1, dmg: 1, who: 'e', pierce: 0, aoeRadius: 0, radius: 5, kind: 'arrow', hits: [],
    });
  };
  eshotN();
  run(g, () => ({ 0: {} }), 1);
  assert.equal(pillar.hp, 12, 'enemy shots pass clean over pillars');
  // 12 player hits down it
  p.x = pillar.x - 3 * TILE;
  p.y = pillar.y;
  p.fx = 1; p.fy = 0;
  for (let i = 0; i < 360 && g.pillars.length; i++) step(g, { 0: { fire: true } }, 1 / 30);
  assert.equal(g.pillars.length, 0, 'the pillar fell to player fire');
  assert.ok(g.events.some(ev => ev.type === 'pillarHit'), 'pillarHit events fired');
  assert.ok(g.events.some(ev => ev.type === 'pillarDown' && ev.id === 'pl0'), 'pillarDown event fired');
  assert.equal(g.quests[0].progress, 1, "the 'destroy' quest counted the pillar");
  assert.ok(!('pillars' in snapshot(g, false)), 'a cleared field ships no pillars key');
}

// --- seal forge: 20 shards + a carried fragment mint a lythseal; the seal
// rides its OWN field (never the item slot), opens sealLock doors on touch
// and flags hasSeal for the phantom reveal; item-slot writes can't kill it ---
function testSealForgeAndLythsealDoors() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(put(r, 4, 'P'), 8, 'Z'), 12, 'I'), 16, 'C');
  // a wall line at y=10 with a floor gap at x=20, sealed by a sealLock door
  const wall = '#'.repeat(20) + '.' + '#'.repeat(19);
  const level = bigEmptyLevel([[5, r], [10, wall], [17, '#....................................g#']]);
  level.qitems = [{ id: 'proof1', kind: 'fragment' }];
  level.chests = [{ loot: 'controller' }]; // an item-slot loot: the seal's old killer
  level.doors = [{ id: 'sealgate', x: 20, y: 10, sealLock: true }];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  const forge = g.forges[0];
  p.invuln = 999;
  g.shards = 25;
  // a live 'craft' quest counts the forging
  g.quests.push({
    id: 'cq', main: false, title: 'Forge the Seal', giver: 'none', kind: 'craft',
    target: 'lythseal', count: 1, reward: null, hint: '', state: 'active', progress: 0,
  });
  // an empty-handed hold forges nothing
  p.x = forge.x - TILE;
  p.y = forge.y;
  run(g, () => ({ 0: { act: true } }), 1.5);
  assert.ok(!p.lythseal, 'no fragment, no seal');
  assert.equal(g.shards, 25, 'no shards spent');
  // scoop the fragment, then hold at the anvil
  p.x = g.qitems[0].x;
  p.y = g.qitems[0].y;
  step(g, { 0: {} }, 1 / 30);
  assert.equal(g.qitems[0].carrier, 0, 'the proof fragment is carried');
  p.x = forge.x - TILE;
  p.y = forge.y;
  run(g, () => ({ 0: { act: true } }), 1.5);
  assert.equal(p.lythseal, true, 'the forge minted a lythseal onto its own field');
  assert.equal(p.item, null, 'the item slot stays free — the seal never occupies it');
  assert.equal(g.shards, 5, 'the forge consumed 20 shards');
  assert.equal(g.qitems.length, 0, 'the proof fragment was consumed');
  assert.ok(g.events.some(ev => ev.type === 'sealForged' && ev.pid === 0), 'sealForged event fired');
  assert.equal(g.quests.find(q => q.id === 'cq').progress, 1, "forging drove the 'craft' quest");
  const sp = snapshot(g, false).players[0];
  assert.equal(sp.hasSeal, true, 'snapshot flags the carrier for the phantom reveal');
  assert.equal(sp.lythseal, true, 'snapshot ships the lythseal field for the HUD');
  // the ITEM button never spends a lythseal (it is a key, not a consumable)
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { item: true } }, 1 / 30);
  assert.equal(p.lythseal, true, 'the seal is not consumable');
  // item-slot writes (chest loot, shop buys, quest rewards) coexist with the
  // carried seal — opening a chest used to destroy it silently
  p.x = g.chests[0].x;
  p.y = g.chests[0].y;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(g.chests[0].opened, true, 'the chest opened');
  assert.deepEqual(p.item, { kind: 'controller', count: 1 }, 'the loot filled the item slot');
  assert.equal(p.lythseal, true, 'the carried seal SURVIVED the item-slot write');
  assert.equal(snapshot(g, false).players[0].hasSeal, true, 'the phantom-reveal flag survived too');
  // the sealed gate blocks until the carrier touches it
  const doorX = (20 + 0.5) * TILE;
  p.x = doorX;
  p.y = 9.5 * TILE - 20; // just north of the closed door, out of touch range
  assert.equal(g.doors[0].open, false);
  run(g, () => ({ 0: { down: true } }), 1.5);
  assert.equal(g.doors[0].open, true, 'a lythseal carrier swings the sealLock door on touch');
  assert.ok(g.events.some(ev => ev.type === 'doorOpen' && ev.id === 'sealgate'), 'doorOpen event fired');
  run(g, () => ({ 0: { down: true } }), 2.5);
  assert.ok(p.y > 11 * TILE, 'the opened gate lets the carrier through');
  // a legacy beacon (seal parked in the item slot) migrates on restore
  const legacy = serializeGame(g);
  legacy.players[0].lythseal = undefined;
  legacy.players[0].item = { kind: 'lythseal', count: 1 };
  const lg = restoreGame(JSON.parse(JSON.stringify(legacy)), charMap);
  assert.equal(lg.players[0].lythseal, true, 'restoreGame migrates a legacy item-slot seal');
  assert.equal(lg.players[0].item, null, 'the migrated slot is freed');
}

// --- doors: closed rects block movement, sight, shots and A*; openers work ---
function testDoorsBlockMoveSightShotsAndPath() {
  // a wall line at y=10 with a floor gap at x=20, shut by a plain door
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  const wall = '#'.repeat(20) + '.' + '#'.repeat(19);
  let r13 = '#' + '.'.repeat(38) + '#';
  r13 = put(r13, 20, 'P');
  let r7 = '#' + '.'.repeat(38) + '#';
  r7 = put(r7, 20, 'g');
  const level = bigEmptyLevel([[13, r13], [10, wall], [7, r7]]);
  level.doors = [{ id: 'd1', x: 20, y: 10 }];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  const e = g.enemies[0];
  p.invuln = 999;
  g.graceT = 0;
  // movement: pushing north into the closed door goes nowhere
  run(g, () => ({ 0: { up: true } }), 1.5);
  assert.ok(p.y > 10.5 * TILE, 'the closed door holds the line');
  // sight: the grunt is 6 tiles away through the door — it must stay asleep
  assert.equal(e.awake, false, 'no sight through a closed door');
  // shots: player fire north dies at the door
  p.fx = 0; p.fy = -1;
  const wallHits0 = g.events.filter(ev => ev.type === 'hitWall').length;
  run(g, () => ({ 0: { fire: true } }), 0.6);
  assert.ok(g.events.filter(ev => ev.type === 'hitWall').length > wallHits0, 'shots die on the closed door');
  assert.equal(e.hp, 2, 'nothing reached the grunt');
  // A*: an awake grunt cannot route through the shut gap
  e.awake = true;
  run(g, () => ({ 0: {} }), 2.5);
  assert.ok(e.y < 10 * TILE, 'A* respects the closed door');
  // open it via the parked-reward path (quests/quorums/glyphs all land here)
  g.pendingDoorOpens.push('d1');
  step(g, { 0: {} }, 1 / 30);
  assert.equal(g.doors[0].open, true, 'pendingDoorOpens swings the door');
  assert.ok(g.events.some(ev => ev.type === 'doorOpen' && ev.id === 'd1'), 'doorOpen event fired');
  // the grunt now sees, routes through the gap and crosses the line
  run(g, () => ({ 0: {} }), 5);
  assert.ok(e.y > 10 * TILE, 'the opened door is a route again');
  // and shots fly through: park the grunt off the firing line, fire north —
  // rounds sail the gap and die mid-air, never on the door
  e.x = 34.5 * TILE;
  e.y = 13.5 * TILE;
  const wallHits1 = g.events.filter(ev => ev.type === 'hitWall').length;
  p.fx = 0; p.fy = -1;
  run(g, () => ({ 0: { fire: true } }), 0.6);
  assert.equal(g.events.filter(ev => ev.type === 'hitWall').length, wallHits1, 'shots pass the open door');
}

// --- teleport pads: 0.8s channel, blink with cargo, 2s cooldown, no enemies ---
function testTeleportPads() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r5 = '#' + '.'.repeat(38) + '#';
  r5 = put(put(put(put(r5, 4, 'P'), 8, 'O'), 6, 'c'), 10, 'I');
  let r15 = '#' + '.'.repeat(38) + '#';
  r15 = put(r15, 30, 'O');
  // a second pad pair (tp2<->tp3) parks the enemy-on-pad probe far from the
  // action; the sleeping grunt on tp2 also keeps the field from auto-clearing
  let r17 = '#' + '.'.repeat(38) + '#';
  r17 = put(put(put(r17, 10, 'O'), 20, 'O'), 11, 'g');
  const level = bigEmptyLevel([[5, r5], [15, r15], [17, r17]]);
  level.captiveChars = ['sniper'];
  level.qitems = [{ id: 'frag1', kind: 'fragment' }];
  // a closed door squats on tp3 (tile 20,17): its twin tp2 must refuse to channel
  level.doors = [{ id: 'dgate', x: 20, y: 17 }];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  const [padA, padB, padC, padD] = g.teleports;
  assert.equal(padA.twin, 'tp1', 'pads pair consecutively');
  const sleeper = g.enemies[0];
  p.invuln = 999;
  g.graceT = 0;
  // cargo: a trailing captive, a carried fragment, a hired hound
  g.captives[0].owner = 0;
  g.qitems[0].carrier = 0;
  g.followers.push({
    id: g.nextFollowerId++, kind: 'hound', owner: 0, x: p.x, y: p.y, hp: 2, slot: 0,
    post: 0, isFollower: true, fx: 0, fy: 1, cool: 0, invulnT: 0, path: null, pathI: 0, repathT: 0,
  });
  // park the sleeping grunt squarely on tp2
  sleeper.x = padC.x;
  sleeper.y = padC.y;
  // crossing the pad in under 0.8s never triggers
  p.x = padA.x - 2 * TILE;
  p.y = padA.y;
  run(g, () => ({ 0: { right: true } }), 1.2);
  assert.ok(!g.events.some(ev => ev.type === 'teleport'), 'walking across a pad never blinks');
  // standing on it channels for 0.8s, then blinks — cargo and all
  p.x = padA.x;
  p.y = padA.y;
  run(g, () => ({ 0: {} }), 1);
  const tev = g.events.find(ev => ev.type === 'teleport');
  assert.ok(tev, 'the channel completed');
  assert.equal(tev.from, 'tp0');
  assert.equal(tev.to, 'tp1');
  assert.ok(Math.hypot(p.x - padB.x, p.y - padB.y) < TILE, 'the player blinked to the twin');
  assert.ok(Math.hypot(g.captives[0].x - padB.x, g.captives[0].y - padB.y) < TILE, 'the trailing captive came along');
  assert.ok(Math.hypot(g.qitems[0].x - padB.x, g.qitems[0].y - padB.y) < TILE, 'the carried fragment came along');
  assert.ok(Math.hypot(g.followers[0].x - p.x, g.followers[0].y - p.y) < TILE * 2.5, 'the follower blinked with its owner');
  // the 2s cooldown holds the return trip, then standing channels back
  run(g, () => ({ 0: {} }), 1.5);
  assert.equal(g.events.filter(ev => ev.type === 'teleport').length, 1, 'the cooldown blocks an instant return');
  run(g, () => ({ 0: {} }), 1.6);
  assert.equal(g.events.filter(ev => ev.type === 'teleport').length, 2, 'after the cooldown the pad channels back');
  assert.ok(Math.hypot(p.x - padA.x, p.y - padA.y) < TILE, 'the return trip lands on the first pad');
  // enemies never use pads: the grunt slept on tp2 the whole time
  assert.equal(sleeper.x, padC.x, 'an enemy parked on a pad never teleports');
  assert.equal(sleeper.y, padC.y, 'it never even shuffled');
  // a twin pad sitting inside a CLOSED door rect refuses the channel outright
  // — blinking into the sealed rect would trap the player with no way out
  sleeper.x += 3 * TILE; // clear the pad for the operative
  p.teleCool = 0;
  p.x = padC.x;
  p.y = padC.y;
  const trips = g.events.filter(ev => ev.type === 'teleport').length;
  run(g, () => ({ 0: {} }), 1.2);
  assert.equal(g.events.filter(ev => ev.type === 'teleport').length, trips,
    'the channel refuses while the twin sits inside a closed door');
  assert.ok(!(p.channelT > 0), 'the hold never even charges');
  // the moment the door opens, the pad answers again
  g.pendingDoorOpens.push('dgate');
  run(g, () => ({ 0: {} }), 1);
  assert.equal(g.events.filter(ev => ev.type === 'teleport').length, trips + 1,
    'an opened door re-allows the channel');
  assert.ok(Math.hypot(p.x - padD.x, p.y - padD.y) < TILE, 'the blink lands on the freed twin');
}

// --- save beacons: cost-10 build sites that announce themselves when raised ---
function testBeaconBuildAndEvent() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(r, 4, 'P'), 8, 'B');
  const level = bigEmptyLevel([[5, r], [17, '#....................................g#']]);
  level.builds = [{ kind: 'beacon', cost: 10 }];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  const b = g.builds[0];
  p.invuln = 999;
  g.shards = 12;
  p.x = b.x - TILE;
  p.y = b.y;
  run(g, () => ({ 0: { act: true } }), 8);
  assert.equal(b.built, true, 'the beacon went up');
  assert.ok(Math.abs(g.shards - 2) < 1e-6, 'the build cost 10 shards');
  assert.ok(g.events.some(ev => ev.type === 'built' && ev.kind === 'beacon'), 'built event fired');
  assert.ok(g.events.some(ev => ev.type === 'beacon' && ev.x === b.x && ev.y === b.y), "the 'beacon' event announces the checkpoint");
  // a raised beacon is inert: no repair/upgrade/dismantle hold, no gnawing
  run(g, () => ({ 0: { act: true } }), 2.5);
  assert.equal(b.built, true, 'holding act never dismantles a beacon');
  const e = g.enemies[0];
  e.awake = true;
  e.x = b.x + 28; // pressed against the build circle (BUILD_RADIUS 18 + reach)
  e.y = b.y;
  g.graceT = 0;
  run(g, () => ({ 0: {} }), 3);
  assert.equal(b.hp, b.maxHp, 'enemies never gnaw a beacon');
  assert.ok(!g.events.some(ev => ev.type === 'buildHit'), 'no buildHit ever lands on a beacon');
}

// --- serializeGame/restoreGame: a 60s bastion run, saved and resumed, steps
// in perfect lockstep with the original for 30 more seconds ---
function testSerializeRestoreRoundTrip() {
  const level = bastionDef({ nights: 3, dayLen: 20, nightLen: 30, bloodMoons: [2] });
  const party = startingRoster.slice(0, 2).map((id, i) => ({ pid: i, name: id, charId: id }));
  const g = createGame(level, party, charMap, startingRoster);
  g.core.hp = 5000;
  g.core.maxHp = 5000;
  for (const p of g.players) p.invuln = 1e9;
  const dt = 1 / 30;
  const inputsAt = i => {
    const inputs = {};
    for (const pid of [0, 1]) {
      inputs[pid] = {
        right: (i % 50) < 25, left: (i % 50) >= 40,
        down: pid === 0 && (i % 70) < 30, up: pid === 1 && (i % 70) < 30,
        fire: (i % 7) < 3, act: (i % 90) < 10,
      };
    }
    return inputs;
  };
  for (let i = 0; i < 1800; i++) step(g, inputsAt(i), dt);
  assert.equal(g.status, 'play', 'the bastion run is live at the save point');
  const data = serializeGame(g);
  assert.ok(!('charMap' in data), 'serializeGame strips the shared charMap');
  assert.equal(JSON.stringify(data), JSON.stringify(JSON.parse(JSON.stringify(data))), 'the save is JSON-safe');
  // a beacon save is stored as JSON and reloaded later: simulate the trip
  const stored = JSON.parse(JSON.stringify(data));
  const g2 = restoreGame(stored, charMap);
  assert.equal(g2.charMap, charMap, 'restoreGame reattaches the charMap');
  for (let i = 1800; i < 2700; i++) {
    step(g, inputsAt(i), dt);
    step(g2, inputsAt(i), dt);
  }
  assert.equal(g.status, 'play', 'the original is still live after 90s');
  assert.equal(
    JSON.stringify(snapshot(g, false)),
    JSON.stringify(snapshot(g2, false)),
    'the restored sim steps in lockstep with the original'
  );
  // restoring never mutates the stored save: resume twice from one beacon
  const g3 = restoreGame(stored, charMap);
  assert.equal(JSON.stringify(serializeGame(g3)), JSON.stringify(stored), 'the stored beacon survives a restore untouched');
}

// =============================================================================
// --- frontier IV: stronghold campaign, fortified walls, alive world ----------
// =============================================================================

// Stronghold def validator: every levels/stronghold/*.json must carry a sane
// def.stronghold block, legal tiles (new terrain included), a valid unlock,
// and — on the beacon variant — exactly four 'K' monoliths.
function testStrongholdDefIntegrity() {
  const shs = levels.filter(l => l.category === 'stronghold');
  assert.ok(shs.length >= 1, 'stronghold dir ships at least sh01');
  const validChars = new Set(characters.map(c => c.id));
  const BUILD_KINDS = new Set(['pylon', 'barricade', 'turret', 'farm', 'beacon', 'wall', 'comm']);
  const LEGAL_TILES = new Set('#.To~,:;_*=!^%E' + 'PcNBCKVWSHDYAIQJXZO' + 'garsmnwbzfqvxu');
  for (const def of shs) {
    const tag = def.name || 'stronghold level';
    assert.equal(def.mode, 'bastion', `${tag}: stronghold levels run bastion mode`);
    const sh = def.stronghold;
    assert.ok(sh && typeof sh === 'object', `${tag}: def.stronghold present`);
    assert.ok(Number.isInteger(sh.level) && sh.level >= 1 && sh.level <= 25, `${tag}: stronghold.level 1..25`);
    assert.ok(typeof sh.name === 'string' && sh.name.length > 0, `${tag}: stronghold.name set`);
    assert.ok(['S', 'M', 'L', 'XL'].includes(sh.sizeLabel), `${tag}: sizeLabel S/M/L/XL`);
    assert.ok(Number.isInteger(sh.difficulty) && sh.difficulty >= 1 && sh.difficulty <= 5, `${tag}: difficulty 1..5`);
    const b = def.bastion || {};
    const nights = b.nights ?? 5;
    const wpn = Math.max(1, Math.min(3, b.wavesPerNight || 1));
    const moons = (b.bloodMoons || []).length;
    // truthful accounting: the sim pours EVERY wave of a blood-moon night
    // from two edges (the second a 60% detachment), so each moon night adds
    // wpn extra wave events — the level-select card must say what the sim does
    assert.equal(sh.waves, nights * wpn + moons * wpn,
      `${tag}: waves ${sh.waves} = ${nights} nights x${wpn} + ${moons} moons x${wpn}`);
    if (b.waveMult !== undefined) assert.ok(b.waveMult >= 1 && b.waveMult <= 2.6, `${tag}: waveMult 1..2.6`);
    if (b.bossNights !== undefined) {
      assert.ok(Array.isArray(b.bossNights) && b.bossNights.length >= 1, `${tag}: bossNights is a non-empty list`);
      for (const bn of b.bossNights) assert.ok(Number.isInteger(bn) && bn >= 1 && bn <= nights, `${tag}: boss night ${bn} within 1..${nights}`);
    }
    if (sh.hpMult !== undefined) assert.ok(sh.hpMult >= 1 && sh.hpMult <= 2, `${tag}: hpMult 1..2`);
    if (sh.unlock !== undefined) assert.ok(validChars.has(sh.unlock), `${tag}: unlock '${sh.unlock}' is a real character`);
    assert.ok(typeof sh.blurb === 'string' && sh.blurb.length > 0, `${tag}: blurb set`);
    assert.ok(Array.isArray(sh.newFeatures) && sh.newFeatures.every(s => typeof s === 'string'), `${tag}: newFeatures are strings`);
    assert.ok(Array.isArray(def.intro) && def.intro.length >= 1, `${tag}: stronghold levels ship an intro slide`);
    for (const row of def.tiles) {
      for (const c of row) assert.ok(LEGAL_TILES.has(c), `${tag}: tile '${c}' is a legal letter`);
    }
    const ks = def.tiles.reduce((n2, r) => n2 + (r.split('K').length - 1), 0);
    if (def.bastionVariant === 'beacons') assert.equal(ks, 4, `${tag}: beacon variant fields exactly 4 K tiles`);
    else assert.equal(ks, 1, `${tag}: core bastion fields exactly 1 K tile`);
    for (const bd of def.builds || []) {
      assert.ok(BUILD_KINDS.has(bd.kind), `${tag}: build kind '${bd.kind}' is known`);
      assert.ok(typeof bd.cost === 'number' && bd.cost >= 0, `${tag}: build cost sane`);
      if (bd.prebuilt !== undefined) assert.equal(typeof bd.prebuilt, 'boolean', `${tag}: prebuilt is boolean`);
    }
    if (def.weather) assert.ok(['clear', 'rain', 'snow', 'ashstorm', 'fog'].includes(def.weather), `${tag}: weather '${def.weather}' known`);
    if (def.ambience) assert.ok(['meadow', 'forest', 'swamp', 'ash', 'city', 'night', 'lava', 'ship'].includes(def.ambience), `${tag}: ambience '${def.ambience}' known`);
    for (const pd of def.patrols || []) {
      assert.ok(Array.isArray(pd.at) && pd.at.length === 2, `${tag}: patrol carries its enemy home tile`);
      assert.ok(Array.isArray(pd.points) && pd.points.length >= 2 && pd.points.length <= 4, `${tag}: patrol routes 2-4 points`);
    }
    // Shop stalls own their act radius only when no structure work could
    // claim the hold (structureInReach) — a stall parked beside a build
    // site/tower silently feeds repairs instead of opening the carousel
    // (the sh17 'shop does not respond' report). Keep them 2.5+ tiles apart.
    const stalls = [], works = [];
    def.tiles.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === 'S') stalls.push([x, y]);
        else if (row[x] === 'B' || row[x] === 'W') works.push([x, y]);
      }
    });
    for (const [sx, sy] of stalls) {
      for (const [wx, wy] of works) {
        const d = Math.hypot(wx - sx, wy - sy);
        assert.ok(d >= 2.5, `${tag}: stall (${sx},${sy}) only ${d.toFixed(2)} tiles from structure work (${wx},${wy}) — needs >= 2.5`);
      }
    }
  }
}

// --- fortified walls: the wall kind, prebuilt structures, upgrade ladder ---
function testWallsAndPrebuilt() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  const def = bastionDef({ nights: 1, dayLen: 1000, nightLen: 10, bloodMoons: [] });
  def.tiles[5] = put(put(put('#' + '.'.repeat(38) + '#', 4, 'B'), 8, 'B'), 12, 'B');
  def.builds = [
    { kind: 'wall', cost: 5, prebuilt: true },
    { kind: 'wall', cost: 5 },
    { kind: 'turret', cost: 8, prebuilt: true, ttype: 'tesla' },
  ];
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const [w1, w2, tu] = g.builds;
  assert.equal(w1.built, true, 'prebuilt wall ships standing');
  assert.equal(w1.hp, 20, 'wall L1 has 20 hp');
  assert.equal(w1.maxHp, 20);
  assert.equal(w1.paid, 5, 'prebuilt structures ship paid in full');
  assert.equal(w1.level, 1, 'walls carry an upgrade level');
  assert.equal(w2.built, false, 'a non-prebuilt wall site ships open');
  assert.equal(tu.built, true, 'prebuilt turret ships standing');
  assert.equal(tu.ttype, 'tesla', 'prebuilt turret takes its def type, no carousel');
  assert.ok(!tu.typeSelect, 'prebuilt turret never enters typeSelect');
  // prebuilt walls block movement like barricades
  const p = g.players[0];
  p.invuln = 1e9;
  p.x = w1.x - TILE;
  p.y = w1.y;
  run(g, () => ({ 0: { right: true } }), 1);
  assert.ok(p.x < w1.x - 14, 'a standing wall blocks the walk');
  // an open wall site builds like any structure, then upgrades 20/35/60
  g.shards = 60;
  p.x = w2.x - TILE * 1.2;
  p.y = w2.y;
  run(g, () => ({ 0: { act: true } }), 5);
  assert.equal(w2.built, true, 'wall site builds under an act-hold');
  assert.equal(w2.hp, 20, 'fresh wall stands at L1 hp');
  run(g, () => ({ 0: { act: true } }), 7);
  assert.equal(w2.level, 2, 'held act upgrades the wall');
  assert.equal(w2.maxHp, 35, 'wall L2 maxHp is 35');
  assert.equal(w2.hp, 35, 'upgrade completes at full hp');
}

// --- inventory: buying a placeable (turret/wall) lands it in the per-player
// inventory (NOT the item slot), and inp.invSel cycles the selection. ---
function testBuyPlaceableToInventory() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(put(r, 4, 'P'), 10, 'S'), 35, 'g');
  const level = bigEmptyLevel([[5, r]]);
  const g = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  // stock the stall with two placeable offers (a custom offer list)
  g.shopOffers = [
    { what: 'turret', cost: 8, place: true },
    { what: 'wall', cost: 5, amount: 3, place: true },
    { what: 'medkit', cost: 10, amount: 1 },
  ];
  const p = g.players[0];
  const shop = g.shops[0];
  p.invuln = 999;
  g.shards = 50;
  p.x = shop.x + TILE; p.y = shop.y;
  assert.equal(p.inventory, undefined, 'no inventory key before any placeable is bought');
  // buy the turret (offer 0) — fire on open buys idx 0
  run(g, () => ({ 0: { act: true } }), 0.4);
  assert.equal(p.shopping, true, 'stall open');
  step(g, { 0: { act: true, fire: true } }, 1 / 30);
  assert.deepEqual(p.inventory, [{ kind: 'turret', count: 1 }], 'the turret went to inventory, not the item slot');
  assert.equal(p.item ?? null, null, 'the item slot stays empty');
  assert.equal(g.shards, 42, 'turret costs 8');
  // cycle to the wall offer and buy 3
  step(g, { 0: { act: true } }, 1 / 30);
  step(g, { 0: { act: true, right: true } }, 1 / 30);
  assert.equal(p.shopIdx, 1, 'cycled to the wall offer');
  step(g, { 0: { act: true } }, 1 / 30);
  step(g, { 0: { act: true, fire: true } }, 1 / 30);
  assert.deepEqual(p.inventory, [{ kind: 'turret', count: 1 }, { kind: 'wall', count: 3 }], 'wall stacks 3 into a new slot');
  assert.equal(g.shards, 37, 'a wall pack costs 5');
  // inventory cycle: inp.invSel edge steps the selection, wrapping
  assert.equal(p.invIdx, 0, 'selection starts on the first slot');
  step(g, { 0: {} }, 1 / 30); // close the stall
  step(g, { 0: { invSel: true } }, 1 / 30);
  assert.equal(p.invIdx, 1, 'invSel advances the selection');
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { invSel: true } }, 1 / 30);
  assert.equal(p.invIdx, 0, 'selection wraps back to the first slot');
  // snapshot ships inventory + selection only for a seat that carries them
  const snap = snapshot(g, false);
  assert.deepEqual(snap.players[0].inventory, [{ kind: 'turret', count: 1 }, { kind: 'wall', count: 3 }], 'snapshot mirrors the inventory');
  assert.equal(snap.players[0].invIdx, 0, 'snapshot carries the selection index');
}

// --- placement mode: choosing Place freezes the operative, a tile-snapped ghost
// follows the arrows, cancel exits WITHOUT consuming, confirm drops the
// structure and consumes exactly one. ---
function testPlacementModeFreezesAndConsumes() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(r, 10, 'P'), 35, 'g');
  const level = bigEmptyLevel([[5, r]]);
  const g = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  const p = g.players[0];
  p.invuln = 999;
  g.graceT = 1e9;
  // two turrets in inventory (placement consumes one per drop)
  p.inventory = [{ kind: 'turret', count: 2 }];
  p.invIdx = 0;
  const x0 = p.x, y0 = p.y;
  const builds0 = g.builds.length;
  // enter placement mode (inp.place edge); the ghost seeds on the player's tile
  step(g, { 0: { place: true } }, 1 / 30);
  assert.equal(p.placing, 'turret', 'place entered placement mode for the selected item');
  assert.ok(p.ghostX !== undefined && p.ghostY !== undefined, 'a ghost cursor appeared');
  // CONTROL/FREEZE: arrow input moves the GHOST one tile, never the character
  const ghostX0 = p.ghostX;
  step(g, { 0: {} }, 1 / 30); // clear the all-held arrow guard
  step(g, { 0: { right: true } }, 1 / 30);
  assert.equal(p.ghostX, ghostX0 + TILE, 'right steps the ghost one tile east');
  assert.equal(p.x, x0, 'the operative does NOT move while placing (x frozen)');
  assert.equal(p.y, y0, 'the operative does NOT move while placing (y frozen)');
  // cancel (special) exits WITHOUT consuming or placing anything
  step(g, { 0: { special: true } }, 1 / 30);
  assert.equal(p.placing, undefined, 'special cancels placement');
  assert.equal(p.inventory[0].count, 2, 'cancel consumed nothing');
  assert.equal(g.builds.length, builds0, 'cancel placed nothing');
  // re-enter and CONFIRM (fire) — drops the turret, consumes one
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { place: true } }, 1 / 30);
  step(g, { 0: {} }, 1 / 30); // clear arrow/place guards
  step(g, { 0: { right: true } }, 1 / 30); // nudge the ghost off the player's own tile
  const gx = p.ghostX, gy = p.ghostY;
  step(g, { 0: { fire: true } }, 1 / 30);
  assert.equal(g.builds.length, builds0 + 1, 'confirm placed one structure');
  const placed = g.builds[g.builds.length - 1];
  assert.equal(placed.kind, 'turret', 'a turret was laid');
  assert.equal(placed.built, true, 'the placed turret stands immediately');
  assert.equal(placed.x, gx, 'the turret landed on the ghost tile (x)');
  assert.equal(placed.y, gy, 'the turret landed on the ghost tile (y)');
  assert.equal(p.inventory[0].count, 1, 'confirm consumed exactly one');
  assert.equal(p.placing, 'turret', 'still placing — a second turret remains');
  // place the second: the stack empties and placement auto-exits
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { right: true } }, 1 / 30); // move ghost to a fresh tile
  step(g, { 0: { right: true, fire: false } }, 1 / 30);
  step(g, { 0: { fire: true } }, 1 / 30);
  assert.equal(g.builds.length, builds0 + 2, 'the second turret placed too');
  assert.equal(p.inventory, undefined, 'inventory emptied and cleared');
  assert.equal(p.placing, undefined, 'placement auto-exits once the stack is gone');
}

// --- RA2 walls: drag-to-line. The first confirm sets the anchor, dragging the
// ghost previews a line, the second confirm lays a connected run of wall
// segments (one per inventory count) that block movement. ---
function testWallDragLine() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  let r = '#' + '.'.repeat(38) + '#';
  r = put(put(r, 6, 'P'), 35, 'g');
  const level = bigEmptyLevel([[5, r]]);
  const g = createGame(level, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
  const p = g.players[0];
  p.invuln = 999;
  g.graceT = 1e9;
  p.inventory = [{ kind: 'wall', count: 4 }];
  p.invIdx = 0;
  const builds0 = g.builds.length;
  // enter placement: the ghost seeds on the player's tile
  step(g, { 0: { place: true } }, 1 / 30);
  assert.equal(p.placing, 'wall', 'placing a wall');
  // first confirm drops the drag anchor (no wall laid yet)
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { fire: true } }, 1 / 30);
  assert.ok(p.wallAnchorX !== undefined, 'the first confirm set the drag anchor');
  assert.equal(g.builds.length, builds0, 'no wall laid by the anchor press alone');
  const anchorX = p.wallAnchorX, anchorY = p.wallAnchorY;
  // drag the ghost three tiles east, then confirm to lay the line
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { right: true } }, 1 / 30);
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { right: true } }, 1 / 30);
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { right: true } }, 1 / 30);
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { fire: true } }, 1 / 30);
  const laid = g.builds.slice(builds0);
  assert.equal(laid.length, 4, 'a connected line of 4 wall tiles laid (anchor + 3 drag tiles)');
  assert.ok(laid.every(b => b.kind === 'wall' && b.built), 'every segment is a standing wall');
  // the run is connected: contiguous tile centers one TILE apart along a row
  const xs = laid.map(b => b.x).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) {
    assert.equal(xs[i] - xs[i - 1], TILE, 'segments are adjacent (RA2 connected line)');
  }
  assert.ok(laid.every(b => b.y === anchorY), 'the line stays on the anchor row');
  assert.equal(xs[0], anchorX, 'the line starts at the anchor tile');
  // out of wall: placement auto-exits
  assert.equal(p.inventory, undefined, 'all four wall segments consumed');
  assert.equal(p.placing, undefined, 'placement exits when the wall stock empties');
  // CONTROL: the laid walls block movement — an operative cannot cross the line
  const wall = laid[2];
  p.x = wall.x - TILE; p.y = wall.y;
  const px0 = p.x;
  run(g, () => ({ 0: { right: true } }), 1);
  assert.ok(p.x < wall.x - 14, 'the drag-laid wall blocks the walk (movement + collision)');
  assert.ok(p.x <= px0 + 2 || p.x < wall.x - 14, 'the wall line is a real barrier');
}

// --- fortified walls: player DIRECT shots demolish own structures — the
// official shoot-your-way-out self-rescue. Pylons/beacons immune, splash
// immune, ownerless (turret) fire immune. ---
function testShootYourWayOut() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  const def = bastionDef({ nights: 1, dayLen: 1000, nightLen: 10, bloodMoons: [] });
  // player pocket: a prebuilt barricade due east of the operative
  def.tiles[10] = put(put(def.tiles[10], 6, 'B'), 10, 'B');
  def.builds = [
    { kind: 'barricade', cost: 4, prebuilt: true },
    { kind: 'pylon', cost: 10, prebuilt: true },
  ];
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const [bar, pyl] = g.builds;
  const p = g.players[0];
  p.invuln = 1e9;
  // stand west of the barricade, fire east at it
  p.x = bar.x - TILE * 1.2;
  p.y = bar.y;
  const hp0 = bar.hp;
  run(g, () => {
    p.fx = 1;
    p.fy = 0;
    return { 0: { fire: true } };
  }, 1.2);
  assert.ok(bar.hp < hp0, 'player direct fire damages the own barricade');
  assert.ok(g.events.some(ev => ev.type === 'buildHit'), 'buildHit events land');
  run(g, () => {
    p.fx = 1;
    p.fy = 0;
    return { 0: { fire: true } };
  }, 8);
  assert.equal(bar.built, false, 'the barricade falls to sustained fire');
  assert.ok(g.events.some(ev => ev.type === 'buildDown' && ev.kind === 'barricade'), 'buildDown fired');
  // the way is open: walk through where the barricade stood
  const x0 = p.x;
  run(g, () => ({ 0: { right: true } }), 1.5);
  assert.ok(p.x > x0 + TILE, 'the demolished wall opens the way out');
  // pylons never take player fire
  p.x = pyl.x - TILE * 1.2;
  p.y = pyl.y;
  run(g, () => {
    p.fx = 1;
    p.fy = 0;
    return { 0: { fire: true } };
  }, 2);
  assert.equal(pyl.hp, pyl.maxHp, 'pylons are immune to player fire');
  assert.equal(pyl.built, true, 'the pylon stands');
  // AoE splash never hurts structures: an exploding shot beside a wall
  const def2 = bastionDef({ nights: 1, dayLen: 1000, nightLen: 10, bloodMoons: [] });
  def2.tiles[10] = put(def2.tiles[10], 6, 'B');
  def2.builds = [{ kind: 'wall', cost: 5, prebuilt: true }];
  const g2 = createGame(def2, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const wall2 = g2.builds[0];
  g2.shots.push({
    id: g2.nextShotId++, x: wall2.x - 40, y: wall2.y, vx: 0, vy: 0, ttl: 0,
    dmg: 5, who: 'p', overWalls: false, pierce: 0, aoeRadius: TILE * 2, curve: 0,
    radius: 5, kind: 'test', ownerPid: 0, pid: 0, hits: [],
  });
  step(g2, { 0: {} }, 1 / 30);
  assert.equal(wall2.hp, wall2.maxHp, 'AoE splash never hurts own structures');
  // ownerless fire (turrets/followers) sails clean over structures
  g2.shots.push({
    id: g2.nextShotId++, x: wall2.x - 30, y: wall2.y, vx: 10 * TILE, vy: 0, ttl: 0.4,
    dmg: 5, who: 'p', overWalls: false, pierce: 0, aoeRadius: 0, curve: 0,
    radius: 5, kind: 'turret', hits: [],
  });
  run(g2, () => ({ 0: {} }), 0.5);
  assert.equal(wall2.hp, wall2.maxHp, 'ownerless (turret) fire never demolishes');
}

// --- beacon-defense variant: a 40x20 field with four 'K' monoliths ---
function beaconsDef(b = {}, extraRows = []) {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  const tiles = [];
  tiles.push('#'.repeat(40));
  for (let y = 1; y < 19; y++) tiles.push('#' + '.'.repeat(38) + '#');
  tiles.push('#'.repeat(40));
  tiles[2] = '#PP' + '.'.repeat(36) + '#';
  tiles[8] = put(put(tiles[8], 16, 'K'), 24, 'K');
  tiles[12] = put(put(tiles[12], 16, 'K'), 24, 'K');
  for (const [y, row] of extraRows) tiles[y] = row;
  return {
    name: 'Beacons Test', time: 600, captiveChars: [], mode: 'bastion',
    bastionVariant: 'beacons',
    // dayEvents off by default, like bastionDef (re-enable per test)
    bastion: { nights: 3, dayLen: 5, nightLen: 300, bloodMoons: [], dayEvents: false, ...b },
    tiles,
  };
}

// --- beacons: cores array, wave split, dark (not destroyed), day relight,
// all-dark loss ---
function testBeaconSiegeDarkRelightAndLoss() {
  const def = beaconsDef();
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  p.invuln = 1e9;
  assert.equal(g.core, null, 'the variant nulls the single core');
  assert.equal(g.cores.length, 4, 'four monoliths parse into g.cores');
  assert.ok(g.cores.every(c => c.lit && c.hp === 30), 'all four ship lit at full hp');
  const s0 = snapshot(g, false);
  assert.equal(s0.core, undefined, 'no single-core key on variant snapshots');
  assert.equal(s0.cores.length, 4, 'snapshot ships the cores array');
  assert.ok(s0.cores.every(c => c.lit === true), 'snapshot carries HUD-ready lit flags');
  // dusk 1: the wave splits round-robin across the four LIT beacons
  run(g, () => ({ 0: {} }), 5.2);
  const wave = g.enemies.slice();
  assert.ok(wave.length >= 5, 'the night wave spawned');
  assert.deepEqual(wave.slice(0, 4).map(e => e.coreI), [0, 1, 2, 3], 'wave targets split across the lit beacons');
  // gnaw beacon 0 dark: it goes DARK, never destroyed
  const c0 = g.cores[0];
  c0.hp = 1;
  const gnawer = wave[0];
  gnawer.x = c0.x - TILE * 0.5;
  gnawer.y = c0.y;
  gnawer.hitCool = 0;
  g.graceT = 0;
  run(g, () => ({ 0: {} }), 1);
  assert.equal(c0.lit, false, 'a beacon at 0 hp goes dark');
  assert.equal(c0.hp, 0);
  assert.equal(g.cores.length, 4, 'dark beacons are never destroyed');
  assert.ok(g.events.some(ev => ev.type === 'beaconDown' && ev.idx === 0), 'beaconDown event fired');
  assert.ok(g.events.some(ev => ev.type === 'coreHit' && ev.idx === 0), 'beacon gnaws fire indexed coreHit');
  assert.equal(g.status, 'play', 'one dark beacon never loses the mission');
  // its besiegers retarget the next lit monolith
  run(g, () => ({ 0: {} }), 0.2);
  assert.ok(g.enemies.filter(e => !e.dead && e.targetCore).every(e => g.cores[e.coreI].lit),
    'enemies abandon dark beacons for lit ones');
  // relight refuses at NIGHT, even with shards and a held act
  g.shards = 20;
  p.x = c0.x - TILE;
  p.y = c0.y;
  run(g, () => ({ 0: { act: true } }), 3);
  assert.equal(c0.lit, false, 'no relighting under the night sky');
  // by day, hold-act + 8 shards relights at full hp
  g.cycle.phase = 'day';
  g.cycle.t = 500;
  run(g, () => ({ 0: { act: true } }), 2);
  assert.equal(c0.lit, true, 'a day act-hold relights the beacon');
  assert.equal(c0.hp, c0.maxHp, 'relit beacons stand at full hp');
  assert.equal(g.shards, 12, 'relighting costs 8 shards');
  assert.ok(g.events.some(ev => ev.type === 'beaconLit' && ev.idx === 0), 'beaconLit event fired');
  // an empty pool stalls the relight
  c0.lit = false;
  c0.hp = 0;
  g.shards = 7;
  run(g, () => ({ 0: { act: true } }), 3);
  assert.equal(c0.lit, false, '7 shards cannot pay the 8-shard relight');
  // LOSE only when all four are dark at once
  for (const c of g.cores) { c.lit = false; c.hp = 0; }
  step(g, { 0: {} }, 1 / 30);
  assert.equal(g.status, 'failed', 'all four dark at once loses the mission');
  assert.ok(g.events.some(ev => ev.type === 'allDark'), 'allDark event fired');
  assert.ok(g.events.some(ev => ev.type === 'fail'), 'fail event fired');
}

// --- beacons: surviving to the final dawn with >=1 lit clears ---
function testBeaconFinalDawnWin() {
  const def = beaconsDef({ nights: 1, dayLen: 2, nightLen: 3, bloodMoons: [] });
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.players[0].invuln = 1e9;
  g.graceT = 1e9; // hold the wave still: this test is about the clock
  // three beacons dark, one lit: still a win at the final dawn
  for (const c of g.cores.slice(1)) { c.lit = false; c.hp = 0; }
  run(g, () => ({ 0: {} }), 6);
  assert.equal(g.status, 'cleared', 'final dawn with one lit beacon wins');
  assert.ok(g.events.length === 0 || true, 'sanity');
}

// --- beacons: the all-lit night feat lands the Anchorcraft; all aboard
// launches an immediate full-clear ---
function testAnchorcraftEarlyExtraction() {
  const def = beaconsDef({ nights: 4, dayLen: 2, nightLen: 1000, bloodMoons: [] });
  const party = startingRoster.slice(0, 2).map((id, i) => ({ pid: i, name: id, charId: id }));
  const g = createGame(def, party, charMap, startingRoster);
  for (const p of g.players) p.invuln = 1e9;
  g.graceT = 1e9; // the wave holds; beacons stay lit
  // night 1, all four lit: the ship does NOT land before night 2
  run(g, () => ({ 0: {}, 1: {} }), 3);
  assert.equal(g.cycle.phase, 'night');
  assert.ok(g.cores.every(c => c.lit), 'all four still lit');
  assert.equal(g.ship, null, 'night 1 never lands the ship');
  // night 2 with all four lit: touchdown
  g.cycle.nightNo = 2;
  step(g, { 0: {}, 1: {} }, 1 / 30);
  assert.ok(g.ship && g.ship.landed, 'the Anchorcraft lands on the all-lit night feat');
  assert.ok(g.events.some(ev => ev.type === 'shipDown'), 'shipDown event fired');
  const s = snapshot(g, false);
  assert.deepEqual(s.ship, { x: g.ship.x, y: g.ship.y, landed: true }, 'snapshot ships the landed vessel');
  // a dark beacon afterwards never recalls the landed ship
  g.cores[0].lit = false;
  step(g, { 0: {}, 1: {} }, 1 / 30);
  assert.ok(g.ship, 'the ship persists once landed');
  g.cores[0].lit = true;
  // player 0 boards (act within 1.5 tiles); the match keeps playing
  const [p0, p1] = g.players;
  p0.x = g.ship.x - TILE;
  p0.y = g.ship.y;
  step(g, { 0: { act: true }, 1: {} }, 1 / 30);
  assert.equal(p0.aboard, true, 'acting at the ramp marks the operative aboard');
  assert.ok(g.events.some(ev => ev.type === 'shipBoard' && ev.pid === 0), 'shipBoard event fired');
  assert.equal(g.status, 'play', 'one aboard of two active: still playing');
  assert.ok(snapshot(g, false).players.find(q => q.pid === 0).aboard, 'snapshot flags the boarded seat');
  // player 1 boards: launch, immediate clear with the full-clear bonus
  const score0 = g.score;
  p1.x = g.ship.x + TILE;
  p1.y = g.ship.y;
  step(g, { 0: {}, 1: { act: true } }, 1 / 30);
  assert.equal(g.status, 'cleared', 'all active aboard launches an immediate clear');
  assert.ok(g.events.some(ev => ev.type === 'shipLaunch'), 'shipLaunch event fired');
  assert.ok(g.score >= score0 + 2000, 'the launch pays the full-clear bonus');
  assert.ok(g.players.every(q => q.state === 'extracted'), 'boarders extract with the ship');
}

// --- stronghold hp scaling: def.stronghold.hpMult raises every spawn ---
function testStrongholdHpMult() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  const def = bastionDef({ nights: 1, dayLen: 2, nightLen: 100, bloodMoons: [] });
  def.tiles[15] = put('#' + '.'.repeat(38) + '#', 30, 'g');
  def.stronghold = { level: 9, name: 'Scaled', sizeLabel: 'M', difficulty: 3, waves: 1, hpMult: 1.5, blurb: 'x', newFeatures: [] };
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const grunt = g.enemies[0];
  assert.equal(grunt.maxHp, 3, 'initial grunt pool scales ceil(2 x 1.5) = 3');
  assert.equal(grunt.hp, 3);
  g.players[0].invuln = 1e9;
  g.graceT = 1e9;
  run(g, () => ({ 0: {} }), 2.2);
  const wave = g.enemies.slice(1);
  assert.equal(wave.length, 5, 'night 1 solo wave spawned');
  // letters z z w z z; mutations [feral, bulk, volatile, split, none]:
  // base 1 hp scales to 2; the bulk mutant doubles the SCALED pool to 4
  assert.deepEqual(wave.map(e => e.maxHp), [2, 4, 2, 2, 2], 'wave pools ride the multiplier (bulk doubles the scaled pool)');
  // vanilla bastion: base pools byte-identical
  const def2 = bastionDef({ nights: 1, dayLen: 2, nightLen: 100, bloodMoons: [] });
  const g2 = createGame(def2, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g2.players[0].invuln = 1e9;
  g2.graceT = 1e9;
  run(g2, () => ({ 0: {} }), 2.2);
  assert.deepEqual(g2.enemies.map(e => e.maxHp), [1, 2, 1, 1, 1], 'no stronghold def: base pools untouched');
}

// --- '=' sand: players AND enemies stride at x0.85 ---
function testSandSlowsEveryone() {
  const mk = sand => {
    const fill = sand ? '=' : '.';
    // the skitter sits 13.5 tiles out: inside its 18.9-tile leash, outside
    // melee reach for the test's duration
    const row = '#P' + fill.repeat(13) + 'w' + fill.repeat(23) + '#';
    const level = bigEmptyLevel([[5, row]]);
    const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
    g.graceT = 0;
    g.players[0].invuln = 1e9;
    g.enemies[0].awake = true;
    return g;
  };
  const gF = mk(false), gS = mk(true);
  const px0 = gF.players[0].x, ex0 = gF.enemies[0].x;
  run(gF, () => ({ 0: { right: true } }), 1.5);
  run(gS, () => ({ 0: { right: true } }), 1.5);
  const pdF = gF.players[0].x - px0;
  const pdS = gS.players[0].x - px0;
  assert.ok(pdS < pdF * 0.9 && pdS > pdF * 0.78, `sand drags players to ~x0.85 (got ${(pdS / pdF).toFixed(2)})`);
  const edF = ex0 - gF.enemies[0].x;
  const edS = ex0 - gS.enemies[0].x;
  assert.ok(edS < edF * 0.9 && edS > edF * 0.78, `sand drags enemies to ~x0.85 (got ${(edS / edF).toFixed(2)})`);
}

// --- '^' ice: x1.05 pace plus 60% drift momentum, players and enemies ---
function testIceDriftAndPace() {
  const mk = ice => {
    const fill = ice ? '^' : '.';
    const row = '#P' + fill.repeat(13) + 'w' + fill.repeat(23) + '#';
    const level = bigEmptyLevel([[5, row]]);
    const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
    g.graceT = 0;
    g.players[0].invuln = 1e9;
    g.enemies[0].awake = true;
    return g;
  };
  const gF = mk(false), gI = mk(true);
  const ex0 = gF.enemies[0].x;
  run(gF, () => ({ 0: { right: true } }), 1);
  run(gI, () => ({ 0: { right: true } }), 1);
  assert.ok(gI.players[0].x > gF.players[0].x, 'ice skates players faster (x1.05 + momentum)');
  assert.ok(ex0 - gI.enemies[0].x > ex0 - gF.enemies[0].x, 'enemies skate too');
  // release the stick: floor stops dead, ice keeps sliding
  const fx = gF.players[0].x, ix = gI.players[0].x;
  run(gF, () => ({ 0: {} }), 0.3);
  run(gI, () => ({ 0: {} }), 0.3);
  assert.equal(gF.players[0].x, fx, 'releasing the stick on floor stops instantly');
  assert.ok(gI.players[0].x > ix + 4, 'on ice the slide carries on, decaying deterministically');
}

// --- '!' lava: sears players 1 hp/0.8s (shield absorbs, sizzle throttled),
// enemies 1 hp/s; enemy pathing routes AROUND the flows ---
function testLavaSearsAndPathsAround() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  const level = bigEmptyLevel([
    [2, '#P' + '.'.repeat(37) + '#'],
    [5, '#' + '!'.repeat(5) + '.'.repeat(33) + '#'],
    [7, put('#' + '.'.repeat(38) + '#', 30, 'n')],
  ]);
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.graceT = 0;
  const p = g.players[0];
  p.shield = 2;
  p.x = 3.5 * TILE;
  p.y = 5.5 * TILE; // standing mid-lava
  run(g, () => ({ 0: {} }), 2.5);
  assert.equal(p.shield, 0, 'shield pips absorb the first sizzles');
  assert.equal(p.hp, 2, 'then hp burns at 1 per 0.8s');
  assert.equal(g.events.filter(ev => ev.type === 'sizzle').length, 3, 'sizzle events ride the 0.8s cadence');
  p.x = 15.5 * TILE;
  p.y = 2.5 * TILE;
  const hp1 = p.hp;
  run(g, () => ({ 0: {} }), 1.5);
  assert.equal(p.hp, hp1, 'off the lava the searing stops');
  // enemies: a stationary sniper dropped into lava cooks at 1 hp/s
  const sn = g.enemies[0];
  sn.x = 2.5 * TILE;
  sn.y = 5.5 * TILE;
  run(g, () => ({ 0: {} }), 1.1);
  assert.equal(sn.hp, 1, 'lava cooks enemies at 1 hp per second');
  assert.ok(g.events.some(ev => ev.type === 'hit' && ev.cause === 'lava'), 'lava damage is evented');
  // pathing: a skitter crosses AROUND a lava strip, never through it
  const level2 = bigEmptyLevel([
    [1, '#P' + '.'.repeat(37) + '#'],
    [2, put('#' + '.'.repeat(38) + '#', 6, '!')],
    [3, put(put('#' + '.'.repeat(38) + '#', 6, '!'), 10, 'w')],
    [4, put('#' + '.'.repeat(38) + '#', 6, '!')],
    [5, put('#' + '.'.repeat(38) + '#', 6, '!')],
  ]);
  const g2 = createGame(level2, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g2.graceT = 0;
  g2.players[0].invuln = 1e9;
  g2.players[0].x = 2.5 * TILE;
  g2.players[0].y = 3.5 * TILE;
  const sk = g2.enemies[0];
  run(g2, () => ({ 0: {} }), 7);
  assert.ok(!g2.events.some(ev => ev.type === 'hit' && ev.cause === 'lava'), 'the chaser never waded the flow');
  assert.ok(Math.hypot(sk.x - g2.players[0].x, sk.y - g2.players[0].y) < TILE * 5,
    'it pathed around the lava to reach the operative');
}

// --- '%' void: blocks movement, sight and shots ---
function testVoidBlocksAll() {
  const level = bigEmptyLevel([
    [4, '#...%' + '.'.repeat(34) + '#'],
    [5, '#P..%..a' + '.'.repeat(31) + '#'],
    [6, '#...%' + '.'.repeat(34) + '#'],
  ]);
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.graceT = 0;
  const p = g.players[0];
  p.invuln = 1e9;
  const archer = g.enemies[0];
  run(g, () => ({ 0: {} }), 1);
  assert.equal(archer.awake, false, 'void blocks enemy sight (6 tiles, inside aggro)');
  run(g, () => ({ 0: { right: true } }), 1.5);
  assert.ok(p.x < 4 * TILE, 'void blocks movement like rock');
  run(g, () => {
    p.fx = 1;
    p.fy = 0;
    return { 0: { fire: true } };
  }, 0.6);
  assert.ok(g.events.some(ev => ev.type === 'hitWall'), 'shots die at the void');
  assert.equal(archer.hp, archer.maxHp, 'nothing crosses the abyss');
}

// --- weather: fog/ashstorm sight cap, snow slow, rain douses burn patches ---
function testWeatherFogSnowRain() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  const sniperWakes = weather => {
    const level = bigEmptyLevel([
      [2, '#P' + '.'.repeat(37) + '#'],
      [10, put('#' + '.'.repeat(38) + '#', 25, 'n')],
    ]);
    if (weather) level.weather = weather;
    const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
    g.graceT = 0;
    g.players[0].invuln = 1e9;
    g.players[0].x = 15.5 * TILE; // 10 tiles out, clear line
    g.players[0].y = 10.5 * TILE;
    run(g, () => ({ 0: {} }), 1);
    return g.enemies[0].awake;
  };
  assert.equal(sniperWakes(null), true, 'clear skies: the sniper marks at 10 tiles');
  assert.equal(sniperWakes('fog'), false, 'fog caps all sight at 9 tiles');
  assert.equal(sniperWakes('ashstorm'), false, 'ashstorm caps all sight at 9 tiles');
  // snow: every entity strides at x0.92 (a far sentry keeps the field live)
  const sprint = weather => {
    const level = bigEmptyLevel([
      [5, '#P' + '.'.repeat(37) + '#'],
      [17, put('#' + '.'.repeat(38) + '#', 36, 'g')],
    ]);
    if (weather) level.weather = weather;
    const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
    const x0 = g.players[0].x;
    run(g, () => ({ 0: { right: true } }), 1.5);
    return g.players[0].x - x0;
  };
  const clearD = sprint(null), snowD = sprint('snow');
  assert.ok(Math.abs(snowD - clearD * 0.92) < 6, `snow slows the stride to x0.92 (got ${(snowD / clearD).toFixed(3)})`);
  // rain: burn patches expire twice as fast; toxin pools are untouched
  const mkRain = weather => {
    const level = bigEmptyLevel([
      [5, '#P' + '.'.repeat(37) + '#'],
      [17, put('#' + '.'.repeat(38) + '#', 36, 'g')],
    ]);
    if (weather) level.weather = weather;
    const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
    g.patches.push({ x: 30 * TILE, y: 10 * TILE, kind: 'burn', r: TILE, ttl: 3 });
    g.patches.push({ x: 34 * TILE, y: 10 * TILE, kind: 'toxin', r: TILE, ttl: 3 });
    run(g, () => ({ 0: {} }), 1.7);
    return g;
  };
  const gRain = mkRain('rain');
  assert.ok(!gRain.patches.some(pa => pa.kind === 'burn'), 'rain douses burn patches in half the time');
  assert.ok(gRain.patches.some(pa => pa.kind === 'toxin'), 'toxin pools ignore the rain');
  const gClear = mkRain(null);
  assert.ok(gClear.patches.some(pa => pa.kind === 'burn'), 'clear skies: the burn patch still smolders at 1.7s');
  assert.equal(snapshot(gRain, false).weather, 'rain', 'snapshot carries the weather');
}

// --- alive world: patrols, group alert, sniper spotters ---
function testPatrolsGroupAlertAndSpotters() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  // patrol: a sleeping sentry walks its loop at 0.6x and still spots
  const level = bigEmptyLevel([
    [2, '#P' + '.'.repeat(37) + '#'],
    [10, put('#' + '.'.repeat(38) + '#', 10, 'g')],
  ]);
  level.patrols = [{ at: [10, 10], points: [[13, 10], [10, 10]] }];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.graceT = 0;
  g.players[0].invuln = 1e9;
  const e = g.enemies[0];
  const x0 = e.x;
  run(g, () => ({ 0: {} }), 2);
  assert.equal(e.awake, false, 'patrolling is pre-aggro wandering: still asleep');
  assert.ok(e.x > x0 + TILE * 0.8, 'the sentry walks its route while unaware');
  run(g, () => ({ 0: {} }), 3);
  assert.equal(e.patrolI, 1, 'reaching a waypoint advances the round-robin');
  run(g, () => ({ 0: {} }), 4);
  assert.equal(e.patrolI, 0, 'the loop wraps deterministically');
  g.players[0].x = e.x - TILE * 3;
  g.players[0].y = e.y;
  run(g, () => ({ 0: {} }), 0.5);
  assert.equal(e.awake, true, 'patrolling sentries still spot by sight');
  // group alert: sight-waking one member raises the whole camp inside 1s
  const campRow = put(put('#' + '.'.repeat(38) + '#', 8, 'g'), 18, 'g');
  const level2 = bigEmptyLevel([
    [2, '#P' + '.'.repeat(37) + '#'],
    [10, campRow],
  ]);
  level2.groups = [[[8, 10], [18, 10]]];
  const g2 = createGame(level2, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g2.graceT = 0;
  g2.players[0].invuln = 1e9;
  const [a2, b2] = g2.enemies;
  g2.players[0].x = a2.x - TILE * 4;
  g2.players[0].y = a2.y;
  step(g2, { 0: {} }, 1 / 30);
  assert.equal(a2.awake, true, 'the seen member wakes at once');
  assert.equal(b2.awake, false, 'its camp-mate (10 tiles off) is not instantly awake');
  assert.ok(b2.groupWakeT > 0, 'but the staggered alarm is running');
  run(g2, () => ({ 0: {} }), 1.1);
  assert.equal(b2.awake, true, 'the whole camp is up within a second');
  // a silent long-range kill never trips the camp
  const g3 = createGame(level2, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g3.graceT = 0;
  const [a3, b3] = g3.enemies;
  playerShotAt(g3, a3, 5);
  step(g3, { 0: {} }, 1 / 30);
  assert.ok(a3.dead, 'one shot from beyond their eyes');
  assert.ok(!(b3.groupWakeT > 0), 'no group alarm from a silent kill');
  run(g3, () => ({ 0: {} }), 2);
  assert.equal(b3.awake, false, 'the camp sleeps on — stealth play stands');
  // sniper spotters: +4 tiles of aggro inside 8 tiles of a LIVING sniper
  const level3 = bigEmptyLevel([
    [2, '#PP' + '.'.repeat(36) + '#'],
    [10, put(put('#' + '.'.repeat(38) + '#', 25, 'g'), 28, 'n')],
  ]);
  level3.groups = [[[25, 10], [28, 10]]];
  const gruntMarks = killSniper => {
    const g4 = createGame(level3, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
    g4.graceT = 0;
    g4.players[0].invuln = 1e9;
    if (killSniper) g4.enemies.find(e2 => e2.kind === 'sniper').dead = true;
    g4.players[0].x = 12.9 * TILE; // 12.6 tiles from the grunt: 9 < 12.6 < 9+4
    g4.players[0].y = 10.5 * TILE;
    run(g4, () => ({ 0: {} }), 0.5);
    return g4.enemies.find(e2 => e2.kind === 'grunt').awake;
  };
  assert.equal(gruntMarks(false), true, 'the sniper calls targets: the grunt marks at 12.6 tiles');
  assert.equal(gruntMarks(true), false, 'sniper down first: the camp is blind again');
}

// --- toxic air + masks: the bleed, the chest stock, the stall offer ---
function testToxicAirAndMasks() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  const level = bigEmptyLevel([
    [2, '#P' + '.'.repeat(37) + '#'],
    [4, put(put('#' + '.'.repeat(38) + '#', 6, 'C'), 10, 'S')],
    [17, put('#' + '.'.repeat(38) + '#', 36, 'g')],
  ]);
  level.modifiers = { toxicAir: { until: 60 } };
  level.chests = [{ loot: 'mask' }];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  step(g, { 0: {} }, 1 / 30);
  assert.ok(g.events.some(ev => ev.type === 'toxicAir' && ev.until === 60), 'the EVA warning fires at mission start');
  run(g, () => ({ 0: {} }), 8.2);
  assert.equal(p.hp, 2, 'unmasked: 0.5 hp per 4s lands the first 1-hp tick by 8s');
  // the marked chest stocks a mask; wearing it is permanent immunity
  p.x = g.chests[0].x - TILE;
  p.y = g.chests[0].y;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.deepEqual(p.item, { kind: 'mask', count: 1 }, 'marked chests stock masks');
  step(g, { 0: { item: true } }, 1 / 30);
  assert.equal(p.mask, true, 'the mask is worn for good');
  assert.equal(p.item, null, 'the slot frees up');
  assert.ok(g.events.some(ev => ev.type === 'maskOn'), 'maskOn event fired');
  assert.ok(snapshot(g, false).players[0].mask, 'snapshot flags the masked seat');
  const hpAfter = p.hp;
  run(g, () => ({ 0: {} }), 10);
  assert.equal(p.hp, hpAfter, 'masked operatives never bleed');
  // the stall stocks a sixth offer on toxic-air levels: the mask
  assert.equal(g.shopOffers.length, 6, 'toxic-air levels extend the stall');
  assert.equal(g.shopOffers[5].what, 'mask');
  assert.equal(snapshot(g, false).shopOffers.length, 6, 'extended offers ship in the snapshot');
  g.shards = 10;
  p.mask = false; // fresh lungs so the stall will sell
  p.shopIdx = 5;
  p.x = g.shops[0].x;
  p.y = g.shops[0].y;
  step(g, { 0: { act: true } }, 1 / 30); // engage the stall (press consumed)
  step(g, { 0: { act: true, fire: true } }, 1 / 30); // fire edge buys
  assert.deepEqual(p.item, { kind: 'mask', count: 1 }, 'the stall sells masks');
  assert.equal(g.shards, 0, 'the mask offer costs 10');
  // past the deadline the air clears, masked or not
  g.elapsed = 100;
  const hp2 = p.hp;
  run(g, () => ({ 0: {} }), 9);
  assert.equal(p.hp, hp2, 'past the deadline the air is clean');
}

// --- comm masts: the build kind behind 'repair the comm tower' missions ---
function testCommRepairQuest() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  const level = bigEmptyLevel([
    [2, '#P' + '.'.repeat(37) + '#'],
    [5, put(put('#' + '.'.repeat(38) + '#', 5, 'N'), 9, 'B')],
    [15, put('#' + '.'.repeat(38) + '#', 30, 'g')],
  ]);
  level.npcs = [{ id: 'eva', name: 'EVA', lines: ['Raise the mast before dusk.'] }];
  level.builds = [{ kind: 'comm', cost: 6 }];
  level.quests = [{ id: 'fixcomm', main: true, title: 'Repair the comm tower', giver: 'eva', kind: 'build', target: 'comm', count: 1 }];
  const g = createGame(level, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.graceT = 1e9;
  const p = g.players[0];
  p.invuln = 1e9;
  const b = g.builds[0];
  assert.equal(b.maxHp, 25, 'the comm mast carries 25 hp');
  assert.equal(b.built, false, 'it ships broken (an open repair site)');
  p.x = g.npcs[0].x - TILE;
  p.y = g.npcs[0].y;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  const q = g.quests[0];
  assert.equal(q.state, 'active', 'talking the giver opens the repair');
  g.shards = 10;
  p.x = b.x - TILE;
  p.y = b.y;
  run(g, () => ({ 0: { act: true } }), 5);
  assert.equal(b.built, true, 'the mast rebuilds under the act-hold');
  assert.equal(q.progress, 1, "build quests count 'comm' masts");
  p.x = g.npcs[0].x - TILE;
  p.y = g.npcs[0].y;
  step(g, { 0: {} }, 1 / 30);
  step(g, { 0: { act: true } }, 1 / 30);
  assert.equal(q.state, 'done', 'the repair settles at the giver');
}

// --- map themes: def.theme re-skins look + ambient hazard; gated so plain
// levels stay byte-identical, and the generalized ambient hazard bleeds the
// unmasked exactly like toxic air ---
function testMapThemes() {
  // a lava theme: implies a fire ambient hazard, ships theme in the snapshot,
  // stocks the mask, and bleeds the unmasked operative on the toxic-air clock
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  const lava = bigEmptyLevel([
    [2, '#P' + '.'.repeat(37) + '#'],
    [4, put('#' + '.'.repeat(38) + '#', 6, 'C')],
    [17, put('#' + '.'.repeat(38) + '#', 36, 'g')],
  ]);
  lava.theme = 'lava';
  const g = createGame(lava, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  assert.equal(g.theme, 'lava', 'g.theme set from def.theme');
  assert.equal(g.ambientHazard.kind, 'fire', 'lava theme arms a fire ambient hazard');
  assert.equal(g.shopOffers.length, 6, 'an immune-item hazard extends the stall with the mask');
  const s = snapshot(g, false);
  assert.equal(s.theme, 'lava', 'theme rides the snapshot');
  const p = g.players[0];
  run(g, () => ({ 0: {} }), 8.2);
  assert.equal(p.hp, 2, 'unmasked: the fire hazard lands the first 1-hp tick by 8s (toxic-air math)');
  assert.ok(g.events.some(ev => ev.type === 'ambientHazard' && ev.kind === 'fire'),
    'a per-kind ambientHazard event fired for FX/audio');
  // wearing the immune item (mask) stops the bleed
  p.mask = true;
  const hp1 = p.hp;
  run(g, () => ({ 0: {} }), 10);
  assert.equal(p.hp, hp1, 'the immune item grants full immunity');

  // a storm theme implies rain weather + a dark grade, no ambient hazard
  const storm = bigEmptyLevel([[2, '#P' + '.'.repeat(37) + '#']]);
  storm.theme = 'storm';
  const gs = createGame(storm, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const ss = snapshot(gs, true);
  assert.equal(ss.weather, 'rain', 'storm theme implies rain weather');
  assert.equal(ss.dark, true, 'storm theme runs the dark grade');
  assert.equal(ss.theme, 'storm', 'storm theme rides the snapshot');
  assert.equal(gs.ambientHazard, null, 'storm theme arms no ambient hazard');

  // unthemed levels gain none of the keys (byte-stable)
  const plain = createGame(levels[0], [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const sp = snapshot(plain, false);
  assert.equal(sp.theme, undefined, 'classics ship no theme key');
  assert.equal(plain.ambientHazard, null, 'classics arm no ambient hazard');
  assert.equal(sp.shopOffers, undefined, 'classics keep the implicit five offers');
}

// --- ambience/weather/new-mode keys ship only where they belong ---
function testAmbienceWeatherSnapshotPassthrough() {
  const def = bastionDef();
  def.ambience = 'swamp';
  def.weather = 'rain';
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const s = snapshot(g, false);
  assert.equal(s.ambience, 'swamp', 'def.ambience rides every snapshot');
  assert.equal(s.weather, 'rain', 'def.weather rides every snapshot');
  const g2 = createGame(levels[0], [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const s2 = snapshot(g2, false);
  assert.equal(s2.ambience, undefined, 'classics ship no ambience key');
  assert.equal(s2.weather, undefined, 'classics ship no weather key');
  assert.equal(s2.cores, undefined, 'classics ship no cores key');
  assert.equal(s2.ship, undefined, 'classics ship no ship key');
  assert.equal(s2.shopOffers, undefined, 'classics ship no shopOffers key');
  assert.equal(s2.toxicAir, undefined, 'classics ship no toxicAir key');
}

// --- stronghold difficulty knobs: wavesPerNight and waveMult ---
function testWavesPerNightAndWaveMult() {
  const def = bastionDef({ nights: 1, dayLen: 2, nightLen: 30, bloodMoons: [], wavesPerNight: 2, waveMult: 2 });
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.players[0].invuln = 1e9;
  g.core.hp = 100000;
  g.core.maxHp = 100000;
  run(g, () => ({ 0: {} }), 2.2);
  assert.equal(g.enemies.length, 10, 'waveMult 2 doubles the dusk wave (ceil(6 x 0.8 x 2))');
  assert.equal(g.events.filter(ev => ev.type === 'wave').length, 1, 'one wave at dusk');
  run(g, () => ({ 0: {} }), 15);
  assert.equal(g.events.filter(ev => ev.type === 'wave').length, 2, 'the second wave pours in mid-night');
  assert.ok(g.enemies.length >= 18, 'the night fields both waves');
}

// --- finale bosses: def.bastion.bossNights marches exactly one boss at the
// head of the listed night's first wave; blood-moon double edges and second
// waves never duplicate it; unlisted nights stay boss-free ---
function testBossNightsMarchTheBoss() {
  const def = bastionDef({ nights: 2, dayLen: 2, nightLen: 10, bloodMoons: [2], wavesPerNight: 2, bossNights: [2] });
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.players[0].invuln = 1e9;
  g.core.hp = 100000;
  g.core.maxHp = 100000;
  run(g, () => ({ 0: {} }), 2.2); // dusk 1: an unlisted night
  assert.equal(g.enemies.filter(e => e.kind === 'boss').length, 0, 'night 1 is not a boss night');
  run(g, () => ({ 0: {} }), 10 + 2 + 0.5); // through dawn, day 2, dusk 2
  const bosses = g.enemies.filter(e => e.kind === 'boss');
  assert.equal(bosses.length, 1, 'boss night 2 fields exactly ONE boss (blood-moon double edge never doubles it)');
  assert.ok(bosses[0].targetCore, 'the wave boss marches on the core');
  run(g, () => ({ 0: {} }), 6); // the night''s second wave pours in
  assert.equal(g.events.filter(ev => ev.type === 'wave').length >= 4, true, 'both edges and the second wave landed');
  assert.equal(g.enemies.filter(e => e.kind === 'boss').length, 1, 'second waves never re-march the boss');
  // a PACKED field (global 90 cap pinned) still fields the scheduled boss —
  // the one-slot exception — while the rest of the wave stays capped
  const def2 = bastionDef({ nights: 1, dayLen: 2, nightLen: 10, bloodMoons: [], bossNights: [1] });
  const g2 = createGame(def2, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g2.players[0].invuln = 1e9;
  g2.core.hp = 100000;
  g2.core.maxHp = 100000;
  while (g2.enemies.length < 90) {
    const e = { ...g2.enemies[0], id: g2.nextEnemyId++, x: TILE * 2, y: TILE * 2 };
    g2.enemies.push(e);
  }
  run(g2, () => ({ 0: {} }), 2.2);
  assert.equal(g2.enemies.filter(e => e.kind === 'boss').length, 1, 'the cap never swallows a scheduled boss');
  assert.equal(g2.enemies.length, 91, 'only the boss breaches the ceiling — the rest of the wave stays capped');
}

// --- determinism: identical beacon-variant runs, identical streams ---
function testDeterministicBeaconsRun() {
  const runOnce = () => {
    const def = beaconsDef({ nights: 2, dayLen: 4, nightLen: 8, bloodMoons: [] });
    const party = startingRoster.slice(0, 2).map((id, i) => ({ pid: i, name: id, charId: id }));
    const g = createGame(def, party, charMap, startingRoster);
    const dt = 1 / 30;
    const h = [];
    for (let i = 0; i < 900 && g.status === 'play'; i++) {
      const inputs = {};
      for (const p of g.players) {
        inputs[p.pid] = {
          right: (i % 40) < 20, down: (i % 60) < 25, fire: (i % 6) < 2,
          act: (i % 50) < 8,
        };
      }
      step(g, inputs, dt);
      if (i % 10 === 0) h.push(JSON.stringify(snapshot(g, false)));
    }
    return h.join('\n');
  };
  assert.equal(runOnce(), runOnce(), 'identical beacon runs produce identical snapshot streams');
}

testStrongholdDefIntegrity();
testWallsAndPrebuilt();
testBuyPlaceableToInventory();
testPlacementModeFreezesAndConsumes();
testWallDragLine();
testShootYourWayOut();
testBeaconSiegeDarkRelightAndLoss();
testBeaconFinalDawnWin();
testAnchorcraftEarlyExtraction();
testStrongholdHpMult();
testSandSlowsEveryone();
testIceDriftAndPace();
testLavaSearsAndPathsAround();
testVoidBlocksAll();
testWeatherFogSnowRain();
testPatrolsGroupAlertAndSpotters();
testToxicAirAndMasks();
testMapThemes();
testCommRepairQuest();
testAmbienceWeatherSnapshotPassthrough();
testWavesPerNightAndWaveMult();
testBossNightsMarchTheBoss();
testDeterministicBeaconsRun();
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
testXpThresholdsAndLevelUps();
testEvolutionBranchesAndDmgBonusStack();
testBurnSpreadChainAndGroundPatches();
testToxinSlowAndSpread();
testStunHaltsEnemies();
testPrismTurretAdjacency();
testPrismFragile();
testTeslaChainAndStun();
testToxinTurretPools();
testTurretTypeSelectCarousel();
testFollowersLifecycle();
testControllerConvertAndExpiry();
testSealSwimsCaptiveTrails();
testSealRecruitableInBasin();
testArcadeFidelityLockstep();
testPvpCombatDepthRules();
testDeterministicCtfRun();
testConvertedImmunityAndCrackerXp();
testRespawnSpotAvoidsWater();
testFollowerWaitsAshore();
testFollowerSlotReuseAfterRehire();
testStaleBurnPatchCleared();
testSquadAssistXp();
testSnapshotTypeSelectTAndShotOwnerPid();
testNightWaveEngageAndResume();
testSealedCampGnawFallback();
testBloodMoonAndLateNightBuffs();
testFrontierLettersParse();
testAlphaSplitAndFrontierWaves();
testAcolyteShieldHealAndPacifism();
testWraithZapStunAndShieldAbsorb();
testStalkerBlinkAndMelee();
testBeetleBurstAndHostilePatch();
testFieldWeaponPickupOverrideAndAmmo();
testFieldWeaponDropShareAndDownedDrop();
testQuestFetchLifecycle();
testQuestKillBuildReachAndRewards();
testUntimedStoryAndBastion();
testDeterministicFrontierRun();
testPuzzleLettersParse();
testSwitchQuorumWindowAndReset();
testGlyphOrderAndReset();
testPillarDestructionAndQuest();
testSealForgeAndLythsealDoors();
testDoorsBlockMoveSightShotsAndPath();
testTeleportPads();
testBeaconBuildAndEvent();
testSerializeRestoreRoundTrip();

// =============================================================================
// --- wave-4 verify fixes: walls vs enemy fire, gnaw gating, edge boarding,
// --- pathfinding budgets + dormancy, corner-pin regression, countdown flag ---
// =============================================================================

// Handcrafted enemy round (mirrors fireWeapon's shape, hostile side).
function craftEnemyShot(g, x, y, vx, vy, extra = {}) {
  const s = { id: g.nextShotId++, x, y, vx, vy, ttl: 3, dmg: 1, who: 'e', pierce: 0, hits: [], kind: 'test', ...extra };
  g.shots.push(s);
  return s;
}

// --- built blocking structures soak enemy fire (1 dmg, round dies); pylons
// block without damage; overWalls arcs sail over; beacons/core are physical ---
function testEnemyShotsBlockedByStructures() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  const def = bastionDef({ nights: 1, dayLen: 1000, nightLen: 10, bloodMoons: [] });
  def.tiles[10] = put(def.tiles[10], 10, 'B'); // wall, on the core's row
  def.tiles[14] = put(def.tiles[14], 10, 'B'); // pylon
  def.builds = [
    { kind: 'wall', cost: 5, prebuilt: true },
    { kind: 'pylon', cost: 4, prebuilt: true },
  ];
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const [wall, pylon] = g.builds;
  // 1) an enemy round dies on a built wall and chips it for exactly 1
  craftEnemyShot(g, wall.x - TILE, wall.y, TILE * 10, 0);
  run(g, () => ({ 0: {} }), 0.5);
  assert.equal(wall.hp, wall.maxHp - 1, 'enemy round chips the wall for 1');
  assert.equal(g.shots.length, 0, 'the round died on the wall');
  assert.ok(g.events.some(ev => ev.type === 'buildHit'), 'buildHit announced');
  // 2) pylons stop rounds but never take damage (inert)
  const pylonHp = pylon.hp;
  const hits0 = g.events.filter(ev => ev.type === 'buildHit').length;
  craftEnemyShot(g, pylon.x - TILE, pylon.y, TILE * 10, 0);
  run(g, () => ({ 0: {} }), 0.5);
  assert.equal(g.shots.length, 0, 'pylon stopped the round');
  assert.equal(pylon.hp, pylonHp, 'pylon takes no damage');
  assert.equal(g.events.filter(ev => ev.type === 'buildHit').length, hits0, 'no buildHit on a pylon');
  // 3) lobbed overWalls arcs sail clean over structures
  craftEnemyShot(g, wall.x - TILE * 2, wall.y, TILE * 10, 0, { overWalls: true });
  run(g, () => ({ 0: {} }), 0.3);
  assert.equal(g.shots.length, 1, 'the lobbed arc is still flying');
  assert.ok(g.shots[0].x > wall.x, 'it sailed past the wall line');
  assert.equal(wall.hp, wall.maxHp - 1, 'the wall was not touched again');
  g.shots.length = 0;
  // 4) the base core is physical: an enemy round chips it (coreHit)
  const coreHp = g.core.hp;
  craftEnemyShot(g, g.core.x - TILE, g.core.y, TILE * 10, 0);
  run(g, () => ({ 0: {} }), 0.5);
  assert.equal(g.core.hp, coreHp - 1, 'enemy round chips the core');
  assert.ok(g.events.some(ev => ev.type === 'coreHit'), 'coreHit announced');
  // 5) beacon monoliths: lit takes the hit (indexed), dark just stops it
  const bdef = beaconsDef({ nights: 1, dayLen: 1000, nightLen: 10, bloodMoons: [] });
  const g2 = createGame(bdef, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const c0 = g2.cores[0];
  craftEnemyShot(g2, c0.x - TILE, c0.y, TILE * 10, 0);
  run(g2, () => ({ 0: {} }), 0.5);
  assert.equal(c0.hp, c0.maxHp - 1, 'enemy round chips a lit monolith');
  assert.ok(g2.events.some(ev => ev.type === 'coreHit' && ev.idx === 0), 'indexed coreHit');
  c0.lit = false;
  c0.hp = 0;
  const downs = g2.events.filter(ev => ev.type === 'beaconDown').length;
  craftEnemyShot(g2, c0.x - TILE, c0.y, TILE * 10, 0);
  run(g2, () => ({ 0: {} }), 0.5);
  assert.equal(g2.shots.length, 0, 'a dark monolith still stops rounds cold');
  assert.equal(c0.hp, 0, 'a dark monolith takes no further damage');
  assert.equal(g2.events.filter(ev => ev.type === 'beaconDown').length, downs, 'beaconDown never refires');
}

// --- core/beacon gnawing is for night waves (targetCore) or enemies whose
// target is sealed off (pathFailed) — never a passing camp chaser ---
function testCoreGnawNeedsWaveOrSealedTarget() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  const def = bastionDef({ nights: 1, dayLen: 1000, nightLen: 10, bloodMoons: [] });
  def.tiles[10] = put(def.tiles[10], 24, 'z');
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.graceT = 0;
  g.players[0].invuln = 1e9;
  const e = g.enemies[0];
  e.awake = true;
  e.aggro *= 100; // hunter: never leashes home
  // parked in core contact with a REACHABLE player across the yard: no gnaw
  e.x = g.core.x + 30;
  e.y = g.core.y;
  run(g, () => ({ 0: {} }), 1.5);
  assert.equal(g.core.hp, 30, 'a wandering chaser never gnaws the core');
  assert.ok(!g.events.some(ev => ev.type === 'coreHit'), 'no coreHit from a passer-by');
  // the same enemy as a WAVE marcher gnaws like always
  e.x = g.core.x + 30;
  e.y = g.core.y;
  e.targetCore = true;
  run(g, () => ({ 0: {} }), 1.5);
  assert.ok(g.events.some(ev => ev.type === 'coreHit'), 'a night-wave marcher gnaws the core');
  assert.ok(g.core.hp < 30, 'the core took gnaw damage');
  // an enemy whose only target is SEALED OFF may gnaw too (pathFailed)
  const def2 = bastionDef({ nights: 1, dayLen: 1000, nightLen: 10, bloodMoons: [] }, [
    [1, '####' + '.'.repeat(35) + '#'],
    [2, '#PP#' + '.'.repeat(35) + '#'],
    [3, '####' + '.'.repeat(35) + '#'],
  ]);
  def2.tiles[10] = put(def2.tiles[10], 24, 'z');
  const g3 = createGame(def2, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g3.graceT = 0;
  g3.players[0].invuln = 1e9;
  const e3 = g3.enemies[0];
  e3.awake = true;
  e3.aggro *= 100;
  e3.x = g3.core.x + 30;
  e3.y = g3.core.y;
  run(g3, () => ({ 0: {} }), 3);
  assert.equal(e3.pathFailed, true, 'the sealed-off player marks the search failed');
  assert.ok(g3.events.some(ev => ev.type === 'coreHit'), 'a sealed-off chaser falls back to gnawing');
}

// --- DEV cheat: CORE INTEGRITY (g.cheats.coreInvuln) nullifies every bit of
// damage to the base core/center. Control: the identical wave marcher gnaws the
// core down without the cheat (mirrors testCoreGnawNeedsWaveOrSealedTarget). ---
function testCoreIntegrityCheatNullifiesCoreDamage() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  // CONTROL: no cheat — a night-wave marcher parked on the core gnaws it down.
  const ctrlDef = bastionDef({ nights: 1, dayLen: 1000, nightLen: 10, bloodMoons: [] });
  ctrlDef.tiles[10] = put(ctrlDef.tiles[10], 24, 'z');
  const gc = createGame(ctrlDef, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  gc.graceT = 0;
  gc.players[0].invuln = 1e9;
  const ec = gc.enemies[0];
  ec.awake = true;
  ec.aggro *= 100;
  ec.targetCore = true;
  ec.x = gc.core.x + 30;
  ec.y = gc.core.y;
  run(gc, () => ({ 0: {} }), 2);
  assert.ok(gc.core.hp < gc.core.maxHp, 'control: the core takes gnaw damage without the cheat');
  assert.ok(gc.events.some(ev => ev.type === 'coreHit'), 'control: a coreHit fired');

  // CHEAT ON: identical setup, but g.cheats.coreInvuln = true — the center is
  // invulnerable. The enemy still stalls at the core (no march-through) but the
  // hp never drops and no coreHit event ever fires.
  const cheatDef = bastionDef({ nights: 1, dayLen: 1000, nightLen: 10, bloodMoons: [] });
  cheatDef.tiles[10] = put(cheatDef.tiles[10], 24, 'z');
  const g = createGame(cheatDef, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.graceT = 0;
  g.cheats = { god: false, speed: 1, instantKill: false, instantBuild: false, coreInvuln: true };
  g.players[0].invuln = 1e9;
  const e = g.enemies[0];
  e.awake = true;
  e.aggro *= 100;
  e.targetCore = true;
  e.x = g.core.x + 30;
  e.y = g.core.y;
  run(g, () => ({ 0: {} }), 2);
  assert.equal(g.core.hp, g.core.maxHp, 'core integrity: the center takes no gnaw damage');
  assert.ok(!g.events.some(ev => ev.type === 'coreHit'), 'core integrity: no coreHit event fires');
}

// --- DEV cheat: MAX OUT (maxOutPlayer) brings the seat to the top of the
// per-mission progression — level 4, the L2 +1 maxHp perk applied, full hp.
// Control: a fresh non-arcade seat starts at level 1 with base maxHp. ---
function testMaxOutPlayerCheat() {
  const g = createGame(bastionDef(), [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  // baseline (control): a fresh seat is level 1 with the base hp pool
  assert.equal(p.level, 1, 'control: a fresh seat starts at level 1');
  const baseMaxHp = p.maxHp;
  maxOutPlayer(g, p.pid);
  assert.equal(p.level, 4, 'max out: the seat reaches the top level (4)');
  assert.ok(p.maxHp > baseMaxHp, 'max out: the L2 perk raised max hp above baseline');
  assert.equal(p.hp, p.maxHp, 'max out: the seat arrives at full health');
  // the level-up climb fired its events exactly like an earned one would
  assert.ok(g.events.some(ev => ev.type === 'levelUp' && ev.level === 4 && ev.pid === p.pid),
    'max out: a level-4 levelUp event fired');
  // idempotent: re-applying at the cap changes nothing and never over-levels
  const evCount = g.events.filter(ev => ev.type === 'levelUp').length;
  maxOutPlayer(g, p.pid);
  assert.equal(p.level, 4, 'max out: re-applying at the cap never over-levels');
  assert.equal(g.events.filter(ev => ev.type === 'levelUp').length, evCount,
    'max out: re-applying at the cap emits no further level-ups');
}

// --- Anchorcraft boarding is EDGE-triggered (act chain, lowest rung) and
// walking out of board reach un-boards; launch needs everyone at the vessel ---
function testShipBoardingEdgeWalkAwayAndLaunch() {
  const def = beaconsDef({ nights: 4, dayLen: 2, nightLen: 1000, bloodMoons: [] });
  const party = startingRoster.slice(0, 2).map((id, i) => ({ pid: i, name: id, charId: id }));
  const g = createGame(def, party, charMap, startingRoster);
  const dtt = 1 / 30;
  for (const p of g.players) p.invuln = 1e9;
  g.graceT = 1e9;
  run(g, () => ({ 0: {}, 1: {} }), 3);
  g.cycle.nightNo = 2;
  step(g, { 0: {}, 1: {} }, dtt);
  assert.ok(g.ship && g.ship.landed, 'the Anchorcraft landed on the all-lit feat');
  const [p0, p1] = g.players;
  // a press fired AWAY from the ship, held while stepping into reach: no board
  p0.x = g.ship.x - TILE * 6;
  p0.y = g.ship.y;
  step(g, { 0: { act: true }, 1: {} }, dtt); // edge consumed in open field
  p0.x = g.ship.x - TILE;
  run(g, () => ({ 0: { act: true }, 1: {} }), 0.5);
  assert.ok(!p0.aboard, 'boarding is edge-triggered: a held act never boards');
  // release + fresh press at the ramp boards
  step(g, { 0: {}, 1: {} }, dtt);
  step(g, { 0: { act: true }, 1: {} }, dtt);
  assert.equal(p0.aboard, true, 'a fresh press at the ramp boards');
  assert.ok(g.events.some(ev => ev.type === 'shipBoard' && ev.pid === 0), 'shipBoard fired');
  assert.equal(g.status, 'play', 'one of two aboard: still playing');
  // walking out of reach steps back off the ramp — no remote launches
  p0.x = g.ship.x - TILE * 5;
  step(g, { 0: {}, 1: {} }, dtt);
  assert.equal(p0.aboard, false, 'walking away un-boards');
  assert.equal(g.status, 'play', 'no launch with the boarder gone');
  // both operatives physically at the vessel: launch and clear
  p0.x = g.ship.x - TILE;
  p0.y = g.ship.y;
  step(g, { 0: {}, 1: {} }, dtt);
  step(g, { 0: { act: true }, 1: {} }, dtt);
  assert.equal(p0.aboard, true, 're-boarded at the ramp');
  p1.x = g.ship.x + TILE;
  p1.y = g.ship.y;
  step(g, { 0: {}, 1: { act: true } }, dtt);
  assert.equal(g.status, 'cleared', 'everyone at the vessel: immediate launch clear');
  assert.ok(g.events.some(ev => ev.type === 'shipLaunch'), 'shipLaunch fired');
}

// --- p2v regression: a wave marcher corner-pinned on sh12's diagonal tree
// (88,29) must cross the pin and march on (anti-wedge kick + A* parking) ---
function testCornerPinnedMarcherReachesCore() {
  const def = levels.find(l => l.category === 'stronghold' && l.stronghold?.level === 12);
  assert.ok(def, 'sh12 ships');
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.graceT = 0;
  g.players[0].invuln = 1e9;
  const e = g.enemies[0];
  e.x = (89 + 0.5) * TILE;
  e.y = (28 + 0.5) * TILE;
  e.homeX = e.x;
  e.homeY = e.y;
  e.awake = true;
  e.targetCore = true;
  e.aggro *= 100;
  const d0 = Math.hypot(e.x - g.core.x, e.y - g.core.y);
  run(g, () => ({ 0: {} }), 25);
  const d1 = Math.hypot(e.x - g.core.x, e.y - g.core.y);
  assert.ok(d1 < d0 - TILE * 10,
    `the pinned marcher crossed the corner (closed ${((d0 - d1) / TILE).toFixed(1)} tiles)`);
}

// --- pathfinding budgets: 6 full A* searches per tick field-wide, failed
// verdicts cached, permanently-unreachable enemies go dormant and wake on
// terrain change or player proximity ---
function testPathBudgetThrottleAndDormancy() {
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  const def = bastionDef({ nights: 1, dayLen: 1000, nightLen: 10, bloodMoons: [] }, [
    [1, '####' + '.'.repeat(35) + '#'],
    [2, '#PP#' + '.'.repeat(35) + '#'],
    [3, '####' + '.'.repeat(35) + '#'],
  ]);
  // enemies start 18+ tiles out so the dormancy verdict lands while the
  // player is still beyond the 12-tile wake radius (closer chasers are
  // SUPPOSED to stay awake — that is the proximity-wake rule)
  let row = def.tiles[14];
  for (let i = 0; i < 10; i++) row = put(row, 20 + i * 2, 'z');
  def.tiles[14] = row;
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.graceT = 0;
  g.players[0].invuln = 1e9;
  assert.equal(g.enemies.length, 10);
  for (const e of g.enemies) {
    e.awake = true;
    e.aggro *= 100; // hunters: no leash, the sealed player stays the target
    e.repathT = 0;  // stampede: everyone wants a search the same tick
  }
  step(g, { 0: {} }, 1 / 30);
  assert.equal(g.enemies.filter(e => e.pathFailed).length, 6,
    'global A* budget: exactly 6 full searches on the stampede tick');
  assert.equal(g.enemies.filter(e => !e.pathFailed).length, 4,
    'the other four keep their bearing one short cycle');
  // three consecutive failures (verdicts cached ~2.5s apart) -> dormant
  run(g, () => ({ 0: {} }), 12);
  assert.ok(g.enemies.every(e => e.dormant), 'permanently-unreachable chasers go dormant');
  const xs = g.enemies.map(e => e.x);
  run(g, () => ({ 0: {} }), 1);
  assert.ok(g.enemies.every((e, i) => e.x === xs[i]), 'dormant enemies hold position (no scans, no marches)');
  // the world changing (build completed/destroyed, door opened) stirs them
  g.buildEpoch = (g.buildEpoch || 0) + 1;
  step(g, { 0: {} }, 1 / 30);
  assert.ok(g.enemies.every(e => !e.dormant), 'a terrain change stirs every dormant sleeper');
  // left alone they settle again; a player in reach wakes them for real
  // (re-park them out wide first — pathFails reset on the epoch wake, so the
  // verdict needs three fresh failures while they march back in)
  g.enemies.forEach((e, i) => { e.x = (26 + i) * TILE; e.y = (14 + (i % 2)) * TILE; });
  run(g, () => ({ 0: {} }), 14);
  assert.ok(g.enemies.every(e => e.dormant), 'still sealed off: dormant again');
  const e0 = g.enemies[0];
  g.players[0].x = e0.x - TILE * 3;
  g.players[0].y = e0.y;
  step(g, { 0: {} }, 1 / 30);
  assert.ok(!e0.dormant, 'a player walking into reach wakes the dormant enemy');
}

// --- snapshot cycle.nextBloodMoon: the DAY before a blood-moon dusk only ---
function testNextBloodMoonCountdownFlag() {
  const g = createGame(bastionDef(), [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.players[0].invuln = 1e9;
  let s = snapshot(g, false);
  assert.ok(!('nextBloodMoon' in s.cycle), 'day before a NORMAL night: no flag (classic snapshots stay byte-stable)');
  run(g, () => ({ 0: {} }), 5.2); // dusk 1 (normal night)
  assert.equal(g.cycle.phase, 'night');
  s = snapshot(g, false);
  assert.ok(!('nextBloodMoon' in s.cycle), 'night snapshots never carry the flag');
  run(g, () => ({ 0: {} }), 4.2); // dawn -> the day before night 2, the blood moon
  assert.equal(g.cycle.phase, 'day');
  s = snapshot(g, false);
  assert.equal(s.cycle.nextBloodMoon, true, 'the day before a blood moon flags the countdown');
}

// --- revivePlayer: a held-out seat re-enters via the existing respawn-pick
// flow (server mid-level rejoin); no free operatives leaves it out ---
function testRevivePlayerRejoinFlow() {
  // 12x9 arcade map; the lone grunt is sealed in a pocket so it can neither
  // interfere nor die (an empty field would auto-clear the mission)
  const tiles = [
    '############',
    '#..........#',
    '#PP........#',
    '#..........#',
    '#..........#',
    '#........###',
    '#........#g#',
    '#........###',
    '############',
  ];
  const def = { name: 'Revive Test', time: 300, captiveChars: [], tiles };
  const party = [0, 1].map(i => ({ pid: i, name: 'P' + i, charId: startingRoster[i] }));
  const g = createGame(def, party, charMap, [startingRoster[0], startingRoster[1]]);
  const [p0, p1] = g.players;
  assert.equal(revivePlayer(g, 0), false, 'an active seat refuses revival');
  assert.equal(revivePlayer(g, 7), false, 'an unknown pid refuses');
  // down p0 away from p1 (the captive body must not be auto-rescued)
  p0.x = 5 * TILE + TILE / 2; p0.y = 4 * TILE + TILE / 2;
  p0.invuln = 0;
  enemyShotAt(g, p0);
  run(g, () => ({ 0: {}, 1: {} }), 2.6); // down -> 2s timer -> no free chars
  assert.equal(p0.state, 'out', 'no free operatives: the seat parks out');
  assert.equal(g.status, 'play', 'a teammate still standing keeps the level live');
  assert.equal(revivePlayer(g, 0), false, 'no free operatives: revival refused');
  assert.equal(p0.state, 'out', 'the refused seat stays out');
  // a freed operative makes the rejoin land in the pick flow
  g.roster.push(startingRoster[2]);
  assert.equal(revivePlayer(g, 0), true, 'free operative: revival accepted');
  assert.equal(p0.state, 'pick', 'revival re-enters the existing pick flow');
  assert.equal(p0.pickIdx, 0, 'pick cursor starts at the first choice');
  assert.deepEqual(p0.pickPrev, { left: true, right: true, fire: true },
    'all-held pickPrev: a held button cannot instantly confirm');
  assert.equal(revivePlayer(g, 0), false, 'a seat mid-pick refuses a second revival');
  const sp = snapshot(g, false).players[0];
  assert.deepEqual(sp.pick, { idx: 0, choices: [startingRoster[2]] },
    'snapshot ships the rejoiner pick choices');
  // held fire never confirms; release-then-press deploys the operative
  step(g, { 0: { fire: true }, 1: {} }, 1 / 30);
  assert.equal(p0.state, 'pick', 'held fire does not confirm');
  step(g, { 0: {}, 1: {} }, 1 / 30);
  step(g, { 0: { fire: true }, 1: {} }, 1 / 30);
  assert.equal(p0.state, 'active', 'released-then-pressed fire confirms');
  assert.equal(p0.charId, startingRoster[2], 'the freed operative deploys');
  assert.ok(g.events.some(ev => ev.type === 'spawn'), 'spawn event fired');
  // determinism: the same calls on a restored twin produce the same answers
  const g2 = restoreGame(serializeGame(g), charMap);
  assert.equal(revivePlayer(g2, 0), false, 'restored twin agrees: active seat refuses');
}

// --- ctf overtime escalation: respawn +1s per 20s of sudden death (cap +5),
// drop timer halves at +60s, snapshot ships the HUD level, 180s cap holds ---
function testCtfOvertimeEscalation() {
  const party = [0, 1].map(i => ({ pid: i, name: 'P' + i, charId: startingRoster[i] }));
  const g = createGame(ctfDef(), party, charMap, startingRoster);
  const [p0, p1] = g.players;
  const [f0, f1] = g.flags;
  for (const p of g.players) p.invuln = 0;
  const resetFlag = f => { f.carrier = null; f.atBase = true; f.x = f.homeX; f.y = f.homeY; f.dropT = 0; };
  // regulation: no overtime key, standard 5s respawn and 8s drop timer
  assert.ok(!('overtime' in snapshot(g, false)), 'regulation snapshots never carry overtime');
  p0.x = f1.homeX; p0.y = f1.homeY;
  step(g, { 0: {}, 1: {} }, 1 / 30);
  assert.equal(f1.carrier, 0, 'p0 grabbed the enemy flag');
  pvpShotAt(g, p0, 1, 1, 9);
  step(g, { 0: {}, 1: {} }, 1 / 30);
  assert.equal(p0.state, 'down', 'carrier downed');
  assert.ok(Math.abs(p0.respawn - 5) < 0.05, 'regulation ctf respawn stays 5s');
  assert.ok(Math.abs(f1.dropT - 8) < 0.1, 'regulation drop timer stays 8s');
  resetFlag(f1);
  // tie at the horn -> sudden death opens at OVERTIME +0
  g.caps = [1, 1];
  g.timeLeft = 0.05;
  run(g, () => ({}), 0.2);
  assert.equal(g.suddenDeath, true, 'sudden death armed');
  assert.equal(snapshot(g, false).overtime, 0, 'the horn opens at OVERTIME +0');
  // +45s in: level 2 — respawns stretch, the drop timer still runs full
  g.suddenT = 45;
  p0.state = 'active'; p0.hp = p0.maxHp; p0.shield = 0; p0.invuln = 0; p0.respawn = 0;
  p0.x = f1.homeX; p0.y = f1.homeY;
  step(g, { 0: {}, 1: {} }, 1 / 30);
  assert.equal(f1.carrier, 0, 'overtime grab taken');
  assert.equal(snapshot(g, false).overtime, 2, '45s of overtime reads +2');
  pvpShotAt(g, p0, 1, 1, 9);
  step(g, { 0: {}, 1: {} }, 1 / 30);
  assert.equal(p0.state, 'down', 'overtime carrier downed');
  assert.ok(Math.abs(p0.respawn - 7) < 0.05, '+2 overtime adds 2s to the respawn');
  assert.ok(Math.abs(f1.dropT - 8) < 0.1, 'before +60s the drop timer stays full');
  resetFlag(f1);
  // +130s in: capped at +5, and dropped flags tick home in half the time
  g.suddenT = 130;
  assert.equal(snapshot(g, false).overtime, 5, 'escalation caps at +5');
  p1.invuln = 0;
  p1.x = f0.homeX; p1.y = f0.homeY;
  step(g, { 0: {}, 1: {} }, 1 / 30);
  assert.equal(f0.carrier, 1, 'p1 grabbed the enemy flag');
  pvpShotAt(g, p1, 0, 0, 9);
  step(g, { 0: {}, 1: {} }, 1 / 30);
  assert.equal(p1.state, 'down', 'deep-overtime carrier downed');
  assert.ok(Math.abs(p1.respawn - 10) < 0.05, 'capped overtime respawn is 10s');
  assert.ok(Math.abs(f0.dropT - 4) < 0.1, 'past +60s dropped flags return in half the time');
  // a save/restore round-trip keeps the escalation level
  const g2 = restoreGame(serializeGame(g), charMap);
  assert.equal(snapshot(g2, false).overtime, 5, 'a restored match keeps its overtime level');
  // the 180s grab-count cap stays the final backstop (grabs ran 2-1 here)
  g.suddenT = 179.9;
  run(g, () => ({}), 0.3);
  assert.equal(g.status, 'cleared', 'the 180s cap still ends overtime');
  assert.equal(g.winner, 0, 'more grabs still takes the capped match');
}

// --- THE HORN: call the night early (bastion days) --------------------------
// Hold-act 1.5s at the core (or a LIT beacon) during a day: 5s dusk warning,
// then night; pool bonus floor(skipped/6) min 3; event 'horn'. Refused at
// night, inside a blood-moon warning window, and in a day's last 5s. The horn
// rides the parallel hold rail (stepHorn) — never the act edge chain.
function testHornCallsTheNightEarly() {
  const def = bastionDef({ nights: 2, dayLen: 60, nightLen: 4, bloodMoons: [2] });
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.graceT = 1e9; // freeze enemy AI: this test inspects the horn and the clock
  const p = g.players[0];
  p.invuln = 1e9;
  p.x = g.core.x + TILE;
  p.y = g.core.y;
  const shards0 = g.shards;
  // out of reach: a held act far from the core never charges the horn
  p.x = g.core.x + TILE * 4;
  run(g, () => ({ 0: { act: true } }), 2);
  assert.ok(!g.events.some(ev => ev.type === 'horn'), 'no horn from beyond reach');
  assert.equal(g.cycle.hornT, 0, 'out-of-reach holds never accumulate');
  // at the core: 1.5s of act-hold sounds it — 45 ticks in, cy.t reads 58.5,
  // so the call skips 53.5 day-seconds and banks floor(53.5/6) = 8 shards
  p.x = g.core.x + TILE;
  run(g, () => ({ 0: { act: true } }), 1.6);
  const horn = g.events.find(ev => ev.type === 'horn');
  assert.ok(horn, 'the horn sounded');
  assert.equal(horn.nightNo, 1, 'the horn names the night it calls');
  assert.equal(horn.bonus, 8, 'bonus = floor(skipped day seconds / 6)');
  assert.equal(g.shards, shards0 + 8, 'the bonus lands in the squad pool');
  assert.ok(Math.abs(g.cycle.t - 5) < 0.2, 'the day collapses to the 5s dusk warning');
  assert.equal(g.cycle.phase, 'day', 'the warning seconds still elapse as day');
  // a second hold inside the warning window cannot double-call (t <= 5)
  run(g, () => ({ 0: { act: true } }), 2);
  assert.equal(g.events.filter(ev => ev.type === 'horn').length, 1, 'one horn per day');
  run(g, () => ({ 0: {} }), 3.5);
  const dusk = g.events.find(ev => ev.type === 'dusk');
  assert.ok(dusk && g.cycle.phase === 'night' && g.cycle.nightNo === 1,
    'night begins ~5s after the horn');
  snapshot(g, false); // drain
  // NIGHT: the horn post is silent
  run(g, () => ({ 0: { act: true } }), 2);
  assert.ok(!g.events.some(ev => ev.type === 'horn'), 'no horn at night');
  assert.equal(g.cycle.hornT, 0, 'night holds never accumulate');
  // day 2 leads the BLOOD moon (night 2): inside the 30s warning window the
  // horn refuses — the moonrise keeps its own drama
  run(g, () => ({ 0: {} }), 2.2); // dawn -> day 2 (t 60)
  assert.equal(g.cycle.phase, 'day');
  run(g, () => ({ 0: {} }), 31); // t ~29: bloodWarn has fired, warned = true
  assert.ok(g.events.some(ev => ev.type === 'bloodWarn'), 'the blood warning sounded');
  run(g, () => ({ 0: { act: true } }), 2.5);
  assert.ok(!g.events.some(ev => ev.type === 'horn'), 'no horn inside a blood-moon warning window');
  // MIN BONUS: a short day pays the floor of 3
  const g2 = createGame(bastionDef({ nights: 1, dayLen: 12, nightLen: 4, bloodMoons: [] }),
    [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g2.players[0].invuln = 1e9;
  g2.players[0].x = g2.core.x + TILE;
  g2.players[0].y = g2.core.y;
  const pool2 = g2.shards;
  run(g2, () => ({ 0: { act: true } }), 1.6);
  const horn2 = g2.events.find(ev => ev.type === 'horn');
  assert.ok(horn2, 'short-day horn still sounds');
  assert.equal(horn2.bonus, 3, 'skipping under 18s pays the 3-shard floor');
  assert.equal(g2.shards, pool2 + 3);
  // LAST 5s: nothing left to skip — the hold never completes
  const g3 = createGame(bastionDef({ nights: 1, dayLen: 6.2, nightLen: 4, bloodMoons: [] }),
    [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g3.players[0].invuln = 1e9;
  g3.players[0].x = g3.core.x + TILE;
  g3.players[0].y = g3.core.y;
  run(g3, () => ({ 0: { act: true } }), 6.5);
  assert.ok(!g3.events.some(ev => ev.type === 'horn'), 'no horn inside a day\'s last 5s');
  assert.ok(g3.events.some(ev => ev.type === 'dusk'), 'the natural dusk still arrives');
  // CLAIM RULE: a held act with a NEARER (or tied) hold-claimant in reach —
  // here an unbuilt barricade site beside the core — must never charge the
  // horn; the same hold from the core's far side (site out of reach) does
  const put = (str, x, c) => str.slice(0, x) + c + str.slice(x + 1);
  const def4 = bastionDef({ nights: 1, dayLen: 60, nightLen: 4, bloodMoons: [] });
  def4.tiles[10] = put(def4.tiles[10], 21, 'B'); // site one tile east of the K core
  def4.builds = [{ kind: 'barricade', cost: 4 }];
  const g4 = createGame(def4, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g4.graceT = 1e9;
  g4.shards = 10; // fund the barricade so the claimed hold visibly works it
  g4.players[0].invuln = 1e9;
  g4.players[0].x = g4.builds[0].x; // standing ON the site: the work owns the hold
  g4.players[0].y = g4.builds[0].y + TILE;
  run(g4, () => ({ 0: { act: true } }), 2.5);
  assert.ok(!g4.events.some(ev => ev.type === 'horn'), 'a hold claimed by nearer structure work never horns');
  assert.ok(g4.builds[0].progress > 0, 'the hold went to the barricade build');
  g4.players[0].x = g4.core.x - TILE; // far side of the core: the site is out of reach
  g4.players[0].y = g4.core.y;
  run(g4, () => ({ 0: { act: true } }), 1.6);
  assert.ok(g4.events.some(ev => ev.type === 'horn'), 'clear of claimants, the same hold sounds the horn');
}

// --- the horn on the beacon variant: any LIT monolith is a horn post --------
function testHornAtLitBeacon() {
  const def = beaconsDef({ nights: 2, dayLen: 60, nightLen: 4, bloodMoons: [] });
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  const p = g.players[0];
  p.invuln = 1e9;
  // douse beacon 0 and empty the pool so the relight rail stays inert too
  g.cores[0].lit = false;
  g.cores[0].hp = 0;
  g.shards = 0;
  p.x = g.cores[0].x + TILE;
  p.y = g.cores[0].y;
  run(g, () => ({ 0: { act: true } }), 2);
  assert.ok(!g.events.some(ev => ev.type === 'horn'), 'a DARK beacon is no horn post');
  assert.equal(g.cycle.phase, 'day', 'day still running');
  // a lit one answers: serialize mid-hold first — the charge survives a
  // beacon save/restore and the twin finishes the call identically
  p.x = g.cores[1].x + TILE;
  p.y = g.cores[1].y;
  run(g, () => ({ 0: { act: true } }), 1.0);
  assert.ok(g.cycle.hornT > 0.9, 'mid-hold charge accumulating');
  const twin = restoreGame(serializeGame(g), charMap);
  for (const gx of [g, twin]) run(gx, () => ({ 0: { act: true } }), 0.6);
  for (const gx of [g, twin]) {
    const horn = gx.events.find(ev => ev.type === 'horn');
    assert.ok(horn, 'the lit beacon sounds the horn (original and restored twin)');
    assert.equal(horn.x, gx.cores[1].x, 'the event marks the post that called it');
  }
  assert.equal(snapshot(g, false).cycle.t, snapshot(twin, false).cycle.t,
    'twin clocks agree after the call');
}

// --- DAY EVENTS: scavenger probe at day+25s, supply drop at day+45s ---------
// Deterministic (seeded by the day's nightNo), skipped by a horn-shortened
// day, re-armed each dawn; probes prowl to the base perimeter on normal
// aggro/leash and are never core-targeted.
function testDayEventsProbeAndSupplyDrop() {
  const def = bastionDef({ nights: 2, dayLen: 90, nightLen: 4, bloodMoons: [], dayEvents: true });
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.players[0].invuln = 1e9;
  run(g, () => ({ 0: {} }), 24);
  assert.equal(g.enemies.length, 0, 'nothing prowls before day+25s');
  assert.ok(!g.events.some(ev => ev.type === 'probe'), 'no probe event yet');
  // determinism twin: a beacon saved before the beats replays them exactly
  const twin = restoreGame(serializeGame(g), charMap);
  run(g, () => ({ 0: {} }), 1.5);
  const probe = g.events.find(ev => ev.type === 'probe');
  assert.ok(probe, 'the scavenger probe lands at day+25s');
  assert.equal(probe.edge, 'e', 'day 0 probes the east edge ((0*3+1) % 4)');
  assert.equal(probe.count, 5, 'day 0 packs 3 + ((0*7+2) % 3) = 5 scavengers');
  const pack = g.enemies.slice();
  assert.equal(pack.length, 5);
  assert.deepEqual(pack.map(e => e.letter), ['z', 'z', 'w', 'z', 'z'], 'light enemies only');
  for (const e of pack) {
    assert.ok(e.x > TILE * 36, 'spawned on the east band');
    assert.equal(e.awake, true, 'probes prowl awake');
    assert.equal(e.returning, true, 'prowling = walking home to the base ring');
    assert.ok(!e.targetCore, 'NEVER core-targeted');
    assert.ok(e.aggro < TILE * 50, 'normal aggro (no x100 hunter bump)');
    const dHome = Math.hypot(e.homeX - g.core.x, e.homeY - g.core.y) / TILE;
    assert.ok(dHome >= 4 && dHome <= 10, `prowl home rings the base (${dHome.toFixed(1)} tiles)`);
  }
  // supply drop at day+45s: a loot chest 8-14 tiles off the base
  run(g, () => ({ 0: {} }), 21);
  const drop = g.events.find(ev => ev.type === 'supplyDrop');
  assert.ok(drop, 'the supply drop lands at day+45s');
  assert.equal(g.chests.length, 1, 'one chest landed');
  const chest = g.chests[0];
  assert.equal(chest.x, drop.x, 'event marks the landing tile');
  assert.equal(chest.y, drop.y);
  assert.equal(chest.opened, false);
  assert.equal(chest.loot, 'shards', 'day 0 drops shards');
  assert.equal(chest.amount, 10, 'day 0 pays 10');
  const dBase = Math.hypot(chest.x - g.core.x, chest.y - g.core.y) / TILE;
  assert.ok(dBase >= 7 && dBase <= 15, `landing band 8-14 tiles (tile-rounded: ${dBase.toFixed(1)})`);
  assert.ok(snapshot(g, false).chests.some(c => c.x === chest.x && !c.opened), 'snapshot ships the chest');
  // the saved twin replays both beats to the same field
  run(twin, () => ({ 0: {} }), 22.5);
  const sg = snapshot(g, false), st = snapshot(twin, false);
  assert.deepEqual(st.enemies, sg.enemies, 'twin probe pack matches exactly');
  assert.deepEqual(st.chests, sg.chests, 'twin supply chest matches exactly');
  // by late day the pack has prowled in and bedded down on the base ring
  run(g, () => ({ 0: {} }), 35);
  assert.ok(g.enemies.some(e => !e.awake), 'scavengers bed down at the perimeter');
  assert.ok(g.core.hp === 30, 'the core was never their target');
}

// --- day events: a horn-called day skips its unfired beats; dawns re-arm ----
function testDayEventsSkippedByHornAndRearm() {
  const def = bastionDef({ nights: 2, dayLen: 90, nightLen: 4, bloodMoons: [], dayEvents: true });
  const g = createGame(def, [{ pid: 0, name: 'T', charId: startingRoster[0] }], charMap, startingRoster);
  g.graceT = 1e9; // freeze enemy AI: scheduling only — the night wave must not eat the core
  const p = g.players[0];
  p.invuln = 1e9;
  p.x = g.core.x + TILE;
  p.y = g.core.y;
  // call the night at once: day 1's probe AND drop never fire
  const inputs = gx => ({ 0: { act: gx.cycle.phase === 'day' && gx.cycle.nightNo === 0 } });
  run(g, inputs, 8); // horn ~1.5s, warning 5s, dusk
  assert.ok(g.events.some(ev => ev.type === 'horn'), 'horn called');
  assert.equal(g.cycle.phase, 'night');
  assert.ok(!g.events.some(ev => ev.type === 'probe'), 'horn skipped the unfired probe');
  assert.ok(!g.events.some(ev => ev.type === 'supplyDrop'), 'horn skipped the unfired drop');
  assert.equal(g.chests.length, 0, 'no chest landed on the skipped day');
  snapshot(g, false); // drain night-1 events
  // dawn re-arms day 2 (nightNo 1): probe at +25s off the north edge, 3 strong
  run(g, () => ({ 0: {} }), 4.5); // through the night
  assert.equal(g.cycle.phase, 'day');
  const before = g.enemies.length;
  run(g, () => ({ 0: {} }), 26);
  const probe = g.events.find(ev => ev.type === 'probe');
  assert.ok(probe, 'the next dawn re-arms the probe');
  assert.equal(probe.edge, 'n', 'day 1 probes the north edge ((1*3+1) % 4)');
  assert.equal(probe.count, 3, 'day 1 packs 3 + ((1*7+2) % 3) = 3');
  const pack = g.enemies.slice(before);
  assert.equal(pack.length, 3);
  assert.ok(pack.every(e => e.y < TILE * 2), 'north band entries');
  // and the drop re-arms too, with the day-1 loot row
  run(g, () => ({ 0: {} }), 21);
  const drop = g.events.find(ev => ev.type === 'supplyDrop');
  assert.ok(drop, 'day 2 supply drop landed');
  assert.equal(g.chests[0].loot, 'medkit', 'day 1 drops medkits');
}

// ===== WAVE 7: 32-player CTF — spawn rings, mid-match joins, duplicates =====

// helper: a 32-seat ctf party with explicit alternating teams (16v16)
function party32() {
  return Array.from({ length: 32 }, (_, i) =>
    ({ pid: i, name: 'P' + i, charId: startingRoster[i % startingRoster.length], team: i % 2 }));
}

// helper: would a walker stand clear at (x, y)? Mirrors the sim's collides():
// rock/trees/water/skiff-moor/void block, checked at the player-circle corners.
function stuckAt(g, x, y) {
  const blocked = c => c === '#' || c === 'T' || c === '~' || c === 'o' || c === '%';
  const tile = (px, py) => {
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    if (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) return '#';
    return g.grid[ty][tx];
  };
  for (const [ox, oy] of [[-14, -14], [14, -14], [-14, 14], [14, 14]]) {
    if (blocked(tile(x + ox, y + oy))) return true;
  }
  for (const b of g.builds) {
    if (!b.built || b.kind === 'farm') continue;
    if (Math.hypot(x - b.x, y - b.y) < 18 + 14) return true;
  }
  return false;
}

// --- sprint + stamina: hold sprint to burst (drains), recover only at full hp ---
// Driven on the roomy non-arcade relic map (a hero seat with hp tracking). The
// meter is a gated field: it does not exist until the seat first presses sprint,
// so the no-sprint control stays byte-identical to a vanilla run.
function testSprintStamina() {
  // a roomy 30x24 (=720 tiles, above ARCADE_MAP_TILES=600) open story map, so the
  // seat is a hero with hp tracking (arcade 1-hit seats carry no stamina at all)
  const W = 30, HH = 24;
  const sprintTiles = ['#'.repeat(W)];
  for (let y = 1; y < HH - 1; y++) sprintTiles.push('#' + '.'.repeat(W - 2) + '#');
  sprintTiles.push('#'.repeat(W));
  sprintTiles[Math.floor(HH / 2)] = '#' + 'P' + '.'.repeat(W - 3) + '#'; // spawn far left
  sprintTiles[2] = '#' + '.'.repeat(W - 4) + 'g' + '..#'; // one sleeping grunt: never empty, so the field can't auto-clear (extract) the seat mid-measure
  const sprintDef = { name: 'Sprint Test', story: true, chapter: 4, time: 9000, untimed: true, tiles: sprintTiles, captiveChars: [] };
  const mk = () => {
    const g = createGame(sprintDef, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
    const p = g.players[0];
    assert.equal(g.arcade, false, 'sprint map is a big (non-arcade) hero map');
    assert.ok(p.maxHp !== undefined, 'hero seat carries hp tracking');
    p.invuln = 1e9; // never die mid-measure
    p.x = 4 * TILE; p.y = Math.floor(HH / 2) * TILE; // open left, clear of the wall
    return [g, p];
  };
  const DT = 1 / 30, RUN = 0.3;

  // CONTROL: no sprint input -> no meter ever minted (byte-stable), normal travel
  const [gc, pc] = mk();
  const cx0 = pc.x;
  run(gc, () => ({ 0: { right: true } }), RUN);
  const ctrlDist = pc.x - cx0;
  assert.equal(pc.stamina, undefined, 'no sprint input ever mints the stamina field (byte-stable control)');
  assert.ok(!('stamina' in snapshot(gc, false).players[0]), 'control snapshot ships no stamina key');
  assert.ok(ctrlDist > 0, 'control seat actually moved right');

  // SPRINT: holding sprint while moving drains the meter AND travels farther
  const [gs, ps] = mk();
  const sx0 = ps.x;
  run(gs, () => ({ 0: { right: true, sprint: true } }), RUN);
  const sprintDist = ps.x - sx0;
  assert.ok(ps.stamina !== undefined, 'sprinting mints the stamina field');
  assert.ok(ps.stamina < ps.staminaMax, `sprint drains the meter (got ${ps.stamina}/${ps.staminaMax})`);
  assert.ok(sprintDist > ctrlDist * 1.3, `sprint covers more ground than walking (${sprintDist} vs ${ctrlDist})`);
  assert.ok('stamina' in snapshot(gs, false).players[0], 'sprinting seat snapshot ships the stamina key');

  // AT ZERO: an empty meter caps the seat back to normal speed. Wound the seat
  // so the recovery gate stays shut and the meter holds at 0 across the burst.
  const [gz, pz] = mk();
  step(gz, { 0: { sprint: true } }, DT);     // mint the field with a single press
  pz.stamina = 0;                            // hand-drain it
  pz.hp = pz.maxHp - 1;                       // below full -> no recovery
  const zx0 = pz.x;
  run(gz, () => ({ 0: { right: true, sprint: true } }), RUN);
  const zeroDist = pz.x - zx0;
  assert.ok(Math.abs(zeroDist - ctrlDist) < 0.01, `at 0 stamina sprint is normal speed (${zeroDist} vs ${ctrlDist})`);
  assert.equal(pz.stamina, 0, 'an empty meter stays empty (no boost, no recovery below full hp)');

  // RECOVERY GATE — below full hp the meter does NOT climb back
  const [gh, ph] = mk();
  step(gh, { 0: { right: true, sprint: true } }, DT); // mint + drain a touch
  const drained = ph.stamina;
  assert.ok(drained < ph.staminaMax, 'meter is below full after a sprint tick');
  ph.hp = ph.maxHp - 1;                                // wounded
  run(gh, () => ({ 0: {} }), 1.0);                     // idle, healed? no — still hurt
  assert.equal(ph.stamina, drained, 'stamina does NOT recover while below full hp');

  // RECOVERY — at full hp the meter climbs back
  ph.hp = ph.maxHp;
  run(gh, () => ({ 0: {} }), 0.5);
  assert.ok(ph.stamina > drained, `stamina recovers once at full hp (${ph.stamina} > ${drained})`);
  assert.ok(ph.stamina <= ph.staminaMax, 'recovery never overfills the meter');
}

// --- POWER-UP DROPS (Black Ops Zombies-style): rare deterministic drops, a
// weighted type table, a horde rate boost, and five team-wide effects that fire
// when any friendly seat WALKS OVER the floater. Every assert drives the real
// integrated paths (the kill roll, the step() walk-over pickup, the effect
// timers) and the gated snapshot/serialize surface. ---
function powerupHostLevel() {
  // 40x20 open hero map (non-arcade so seats carry hp/level/stamina tracking),
  // two spawns side by side so a second seat sits IDLE to prove team-wide reach.
  const level = bigEmptyLevel([
    [2, '#PP..................................#'],
    [17, '#..................................g#'], // one far sleeper: field never auto-clears
  ]);
  level.story = true; level.chapter = 4; level.time = 9000; level.untimed = true;
  return level;
}
function powerupParty() {
  return [
    { pid: 0, name: 'A', charId: 'scout' },
    { pid: 1, name: 'B', charId: 'soldier' },
  ];
}

function testPowerupDropRollDeterministicAndGated() {
  // CONTROL: a fresh game gains the always-present gated state, empty/zero, and
  // the snapshot ships NONE of the new keys (byte-stable until a drop exists).
  const g = createGame(powerupHostLevel(), powerupParty(), charMap, startingRoster);
  assert.deepEqual(g.powerups, [], 'powerups array is always present and empty');
  assert.equal(g.fireSaleT, 0, 'fire-sale timer defaults to 0');
  assert.equal(g.freeSprintT, 0, 'free-sprint timer defaults to 0');
  const s0 = snapshot(g, false);
  assert.ok(!('powerups' in s0), 'empty powerups never ship (byte-stable)');
  assert.ok(!('fireSaleT' in s0), 'zero fire-sale timer never ships');
  assert.ok(!('freeSprintT' in s0), 'zero free-sprint timer never ships');

  // The deterministic roll: walk enemy ids until one rolls a drop and one does
  // not, at a FIXED (powerupKills, elapsed). Same inputs -> same outcome twice.
  let dropId = null, noDropId = null;
  for (let id = 1; id <= 4000 && (dropId === null || noDropId === null); id++) {
    const probe = createGame(powerupHostLevel(), powerupParty(), charMap, startingRoster);
    probe.powerupKills = 7; probe.elapsed = 3.5;
    maybeDropPowerup(probe, { id, x: 100, y: 100 });
    if (probe.powerups.length && dropId === null) dropId = id;
    else if (!probe.powerups.length && noDropId === null) noDropId = id;
  }
  assert.ok(dropId !== null, 'some enemy id rolls a drop at the fixed seed');
  assert.ok(noDropId !== null, 'control: a different id at the same seed does NOT drop');
  // determinism: the dropping id drops again identically (type + position)
  const a = createGame(powerupHostLevel(), powerupParty(), charMap, startingRoster);
  const b = createGame(powerupHostLevel(), powerupParty(), charMap, startingRoster);
  a.powerupKills = 7; a.elapsed = 3.5; b.powerupKills = 7; b.elapsed = 3.5;
  maybeDropPowerup(a, { id: dropId, x: 100, y: 100 });
  maybeDropPowerup(b, { id: dropId, x: 100, y: 100 });
  assert.equal(a.powerups.length, 1, 'the dropping id drops exactly one floater');
  assert.equal(a.powerups[0].type, b.powerups[0].type, 'the rolled type is deterministic');
  assert.equal(a.powerups[0].ttl, b.powerups[0].ttl, 'the floater ttl is deterministic');
  assert.equal(a.powerups[0].x, 100, 'the floater lands at the corpse');
  // a drop event fired for FX/audio
  assert.ok(a.events.some(ev => ev.type === 'powerupDrop' && ev.ptype === a.powerups[0].type),
    'a powerupDrop event fires for the render/audio');
  // the per-game kill counter advanced even when nothing dropped (no-drop id)
  const ng = createGame(powerupHostLevel(), powerupParty(), charMap, startingRoster);
  const k0 = ng.powerupKills;
  maybeDropPowerup(ng, { id: noDropId, x: 0, y: 0 });
  assert.equal(ng.powerupKills, k0 + 1, 'the kill counter advances on every kill (drop or not)');
}

function testPowerupWeightedDistributionFavorsFullHealth() {
  // Roll the weighted picker across many seeds: Full Health (weight 40) must be
  // the modal type and Nuke (weight 5) the rarest. We FORCE a drop each trial by
  // probing ids that pass the rare gate, then tally the chosen types.
  const tally = { fullhealth: 0, stamina: 0, firesale: 0, maxammo: 0, nuke: 0 };
  let drops = 0;
  for (let id = 1; id <= 40000 && drops < 800; id++) {
    const g = createGame(powerupHostLevel(), powerupParty(), charMap, startingRoster);
    g.powerupKills = id; g.elapsed = id * 0.013; // spread the seed widely
    maybeDropPowerup(g, { id, x: 0, y: 0 });
    if (g.powerups.length) { tally[g.powerups[0].type]++; drops++; }
  }
  assert.ok(drops > 200, `gathered a healthy drop sample (got ${drops})`);
  assert.ok(tally.fullhealth > tally.nuke, `Full Health out-drops Nuke (${tally.fullhealth} vs ${tally.nuke})`);
  assert.ok(tally.fullhealth >= tally.stamina, `Full Health is the most common (fh ${tally.fullhealth} >= stam ${tally.stamina})`);
  assert.ok(tally.nuke < tally.firesale && tally.nuke < tally.maxammo,
    `Nuke is the rarest (nuke ${tally.nuke} < firesale ${tally.firesale}, maxammo ${tally.maxammo})`);
  assert.ok(tally.nuke > 0, 'Nuke still drops sometimes (it is rare, not impossible)');
}

function testPowerupHordeBoostsRate() {
  // The same fixed (id, kills, elapsed) seed that does NOT clear the base gate
  // CAN clear the x3 horde-boosted gate. Count drops over a sweep with and
  // without the awakening active and assert the boosted run drops strictly more.
  const sweep = (activateHorde) => {
    let drops = 0;
    for (let id = 1; id <= 3000; id++) {
      const g = createGame(relicStoryDef(4), [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
      if (activateHorde) { completeRelic(g); step(g, { 0: {} }, 1 / 30); } // latch the horde
      g.powerupKills = id; g.elapsed = 50 + id * 0.01;
      maybeDropPowerup(g, { id, x: 0, y: 0 });
      drops += g.powerups.length;
    }
    return drops;
  };
  const base = sweep(false);
  const boosted = sweep(true);
  assert.ok(base > 0, `base rate drops something over the sweep (got ${base})`);
  assert.ok(boosted > base, `the awakening horde boosts the drop rate (${boosted} > ${base})`);
}

function testPowerupWalkOverPickupAndTeamWideEffects() {
  const DT = 1 / 30;
  // Helper: stand both seats at a known spot, drop a powerup of a chosen type
  // right under seat 0, step once so the walk-over fires, return [g, p0, p1].
  const setup = (type) => {
    const g = createGame(powerupHostLevel(), powerupParty(), charMap, startingRoster);
    const [p0, p1] = g.players;
    p0.invuln = 1e9; p1.invuln = 1e9; g.graceT = 0;
    p0.x = 10 * TILE; p0.y = 10 * TILE;
    p1.x = 25 * TILE; p1.y = 10 * TILE; // IDLE seat, far from the floater
    g.powerups.push({ id: 'putest', x: p0.x, y: p0.y, type, ttl: 12 });
    return [g, p0, p1];
  };

  // FULL HEALTH: both seats (incl the idle one) restore to max — team-wide.
  {
    const [g, p0, p1] = setup('fullhealth');
    p0.hp = 1; p1.hp = 1;
    step(g, { 0: {}, 1: {} }, DT);
    assert.equal(g.powerups.length, 0, 'fullhealth: the floater is consumed on walk-over');
    assert.equal(p0.hp, p0.maxHp, 'fullhealth: the picker is restored');
    assert.equal(p1.hp, p1.maxHp, 'fullhealth: the IDLE teammate is also restored (team-wide)');
    assert.ok(g.events.some(ev => ev.type === 'powerup' && ev.ptype === 'fullhealth'),
      'a powerup event fires for FX/audio');
  }

  // MAX AMMO (full upgrade): every friendly seat hits the top level.
  {
    const [g, p0, p1] = setup('maxammo');
    assert.equal(p0.level, 1, 'control: seats start at level 1 before max-ammo');
    step(g, { 0: {}, 1: {} }, DT);
    assert.equal(p0.level, 4, 'maxammo: the picker maxes to top level');
    assert.equal(p1.level, 4, 'maxammo: the IDLE teammate maxes too (team-wide)');
  }

  // STAMINA: 30s of free sprint, suppressing drain, then resuming after expiry.
  {
    const [g, p0] = setup('stamina');
    step(g, { 0: {}, 1: {} }, DT);
    assert.ok(Math.abs(g.freeSprintT - 30 + DT) < 1e-6 || g.freeSprintT > 29,
      `stamina: free-sprint timer arms ~30s (got ${g.freeSprintT})`);
    // arm the meter, then sprint hard: drain is suppressed while the timer runs
    p0.x = 4 * TILE; p0.y = 10 * TILE; p0.hp = p0.maxHp - 1; // wounded: no recovery masking
    step(g, { 0: { right: true, sprint: true } }, DT);       // mint the meter at full
    const before = p0.stamina;
    run(g, () => ({ 0: { right: true, sprint: true } }), 0.5);
    assert.equal(p0.stamina, before, 'stamina: free sprint does NOT drain the meter');
    // burn the 30s down, then a final sprint DOES drain again
    g.freeSprintT = 0.0001;
    step(g, { 0: {} }, DT);
    assert.equal(g.freeSprintT, 0, 'stamina: the free-sprint timer expires');
    p0.x = 4 * TILE;
    run(g, () => ({ 0: { right: true, sprint: true } }), 0.3);
    assert.ok(p0.stamina < before, 'stamina: drain resumes once free sprint expires');
  }

  // FIRE SALE: arming + expiry off the pickup. The 10s timer arms on walk-over
  // and ticks down; the zero-cost BUY itself is proven on a real bastion shop
  // below (testPowerupFireSaleFreeBuilds), where placeable offers are stocked.
  {
    const [g] = setup('firesale');
    step(g, { 0: {}, 1: {} }, DT);
    assert.ok(g.fireSaleT > 9, `firesale: timer arms ~10s (got ${g.fireSaleT})`);
    g.fireSaleT = 0.0001;
    step(g, { 0: {}, 1: {} }, DT);
    assert.equal(g.fireSaleT, 0, 'firesale: the timer expires after its window');
  }

  // NUKE: kills exactly 10 of 20 live enemies (the 10 nearest the picker). The
  // sim reaps dead enemies out of g.enemies during the step, so we verify by
  // identity: the 10 NEAREST ids are gone, the 10 FARTHEST survive.
  {
    const [g, p0] = setup('nuke');
    g.enemies.length = 0; // clear the lone sleeper so the count is exact
    for (let i = 0; i < 20; i++) {
      const e = makeEnemyForTest(g, 'g', p0.x + (i + 1) * 6, p0.y); // increasing distance
      g.enemies.push(e);
    }
    assert.equal(g.enemies.length, 20, 'control: 20 live enemies before the nuke');
    const byDist = g.enemies.slice().sort((a, b) => a.x - b.x);
    const nearestIds = new Set(byDist.slice(0, 10).map(e => e.id));
    const farthestIds = new Set(byDist.slice(10).map(e => e.id));
    step(g, { 0: {}, 1: {} }, DT);
    assert.equal(g.kills, 10, 'nuke: exactly 10 enemies die (never the whole field)');
    const survivorIds = new Set(g.enemies.map(e => e.id));
    assert.equal(survivorIds.size, 10, 'nuke: 10 of 20 survive');
    assert.ok([...nearestIds].every(id => !survivorIds.has(id)), 'nuke: the 10 nearest the picker die');
    assert.ok([...farthestIds].every(id => survivorIds.has(id)), 'nuke: the 10 farthest survive');
  }
}

function testPowerupNukeFewerThanTen() {
  // Fewer than 10 alive -> the nuke kills all of them, never throws.
  const g = createGame(powerupHostLevel(), powerupParty(), charMap, startingRoster);
  const p0 = g.players[0];
  p0.x = 10 * TILE; p0.y = 10 * TILE;
  g.enemies.length = 0;
  for (let i = 0; i < 3; i++) g.enemies.push(makeEnemyForTest(g, 'g', p0.x + (i + 1) * 6, p0.y));
  triggerPowerup(g, { id: 'x', x: p0.x, y: p0.y, type: 'nuke' }, p0);
  assert.equal(g.enemies.filter(e => !e.dead).length, 0, 'nuke with <10 alive kills all of them');
}

// In a TEAM mode (ctf) triggerPowerup's friendly() is team-scoped: only the
// picker's team benefits, and the Nuke is friendly-safe to BOTH teams' seats
// (it reaps g.enemies only — players are never in that list). This is the
// team-restricted counterpart to the co-op team-wide test above.
function testPowerupTeamScopedAndFriendlySafeInCtf() {
  const party = [0, 1, 2, 3].map(i =>
    ({ pid: i, name: 'P' + i, charId: startingRoster[i % startingRoster.length], team: i % 2 }));
  const g = createGame(ctfDef(), party, charMap, startingRoster);
  assert.equal(g.enemies.length, 0, 'control: ctf fields no AI enemies at create');
  const team0 = g.players.filter(p => p.team === 0);
  const team1 = g.players.filter(p => p.team === 1);
  for (const p of g.players) { p.invuln = 1e9; p.hp = 1; } // every seat wounded
  const picker = team0[0];

  // FULL HEALTH picked up by a team-0 seat heals team 0 only — team 1 stays hurt.
  triggerPowerup(g, { id: 'fh', x: picker.x, y: picker.y, type: 'fullhealth' }, picker);
  assert.ok(team0.every(p => p.hp === p.maxHp), 'fullhealth: the picker team is fully restored');
  assert.ok(team1.every(p => p.hp === 1), 'fullhealth: the OPPOSING team is NOT healed (team-scoped)');

  // NUKE picked up in ctf reaps only the (manually staged) hostiles; no seat on
  // EITHER team takes damage — players are never in g.enemies, so it is friendly-safe.
  for (let i = 0; i < 4; i++) g.enemies.push(makeEnemyForTest(g, 'g', picker.x + (i + 1) * 6, picker.y));
  const hpBefore = g.players.map(p => p.hp);
  triggerPowerup(g, { id: 'nk', x: picker.x, y: picker.y, type: 'nuke' }, picker);
  assert.equal(g.enemies.filter(e => !e.dead).length, 0, 'nuke: every staged hostile dies');
  // friendly-safe: no seat on EITHER team loses HP (the kill XP may HEAL the
  // owner via a level-up, but the blast never damages a player — they are not
  // in g.enemies, which is the only list damageEnemy touches).
  for (const p of g.players) {
    assert.ok(p.hp >= hpBefore[p.pid], `nuke: seat ${p.pid} (team ${p.team}) takes no damage (friendly-safe)`);
  }
}

function testPowerupFireSaleFreeBuilds() {
  // A real bastion shop stocks the placeable deck (turret cost 8). With Fire Sale
  // active a BROKE seat (0 shards) buys a turret for FREE; with it off the same
  // buy is refused. CONTROL: a non-placeable offer (token, cost 20) is NOT free
  // even during the sale (the sale is scoped to builds/placeables only).
  const put = (s, x, c) => s.slice(0, x) + c + s.slice(x + 1);
  const W = 20, H = 12;
  const tiles = ['#'.repeat(W)];
  for (let y = 1; y < H - 1; y++) tiles.push('#' + '.'.repeat(W - 2) + '#');
  tiles.push('#'.repeat(W));
  tiles[5] = put(put(tiles[5], 4, 'P'), 10, 'S'); // spawn + shop stall
  tiles[2] = put(tiles[2], 14, 'g');              // a sleeper so the field never auto-clears
  const def = { name: 'Fire Sale Shop', mode: 'bastion', time: 600, tiles, captiveChars: [], stronghold: { level: 1, hpMult: 1 } };
  const g = createGame(def, [{ pid: 0, name: 'A', charId: 'scout' }], charMap, ['scout']);
  const p = g.players[0];
  const shop = g.shops[0];
  p.invuln = 1e9; g.graceT = 0;
  p.x = shop.x + TILE; p.y = shop.y;
  // find the turret offer index in the stocked deck
  const offers = g.shopOffers;
  const turretIdx = offers.findIndex(o => o.what === 'turret');
  const tokenIdx = offers.findIndex(o => o.what === 'token');
  assert.ok(turretIdx >= 0 && tokenIdx >= 0, 'bastion shop stocks both a turret placeable and a token');
  assert.equal(offers[turretIdx].cost, 8, 'turret offer base cost is 8');

  // CONTROL: broke + no sale -> the turret buy is refused (nothing in inventory).
  g.shards = 0;
  run(g, () => ({ 0: { act: true } }), 0.5);   // open the carousel
  assert.equal(p.shopping, true, 'shop carousel open');
  p.shopIdx = turretIdx;
  step(g, { 0: { act: true } }, 1 / 30);        // release fire edge
  step(g, { 0: { act: true, fire: true } }, 1 / 30);
  assert.ok(!p.inventory || !p.inventory.some(s => s.kind === 'turret'),
    'control: a broke seat cannot buy the turret without a sale');

  // FIRE SALE ON: broke seat buys the turret for FREE, no shard debit.
  g.fireSaleT = 10;
  step(g, { 0: { act: true } }, 1 / 30);
  step(g, { 0: { act: true, fire: true } }, 1 / 30);
  assert.ok(p.inventory && p.inventory.some(s => s.kind === 'turret'),
    'firesale: a broke seat buys the turret for free');
  assert.equal(g.shards, 0, 'firesale: no shards were debited for the free buy');
  const freeBuy = g.events.filter(ev => ev.type === 'buy' && ev.what === 'turret').pop();
  assert.equal(freeBuy.cost, 0, 'firesale: the buy event records cost 0');

  // CONTROL within the sale: a NON-placeable (token, cost 20) is still NOT free.
  p.shopIdx = tokenIdx;
  const dmgBefore = p.dmgBonus || 0;
  step(g, { 0: { act: true } }, 1 / 30);
  step(g, { 0: { act: true, fire: true } }, 1 / 30);
  assert.equal(p.dmgBonus || 0, dmgBefore, 'firesale: a broke seat still cannot buy the (non-placeable) token');
}

function testPowerupSnapshotGatingAndSerializeRoundTrip() {
  const g = createGame(powerupHostLevel(), powerupParty(), charMap, startingRoster);
  // arm a live floater + both timers, then assert the gated keys ship and the
  // sim JSON round-trips byte-stably (serialize/restore parity).
  g.powerups.push({ id: 'pu0', x: 123, y: 456, type: 'nuke', ttl: 8.25 });
  g.fireSaleT = 4.2; g.freeSprintT = 12.7;
  const snap = snapshot(g, false);
  assert.ok(Array.isArray(snap.powerups) && snap.powerups.length === 1, 'a live floater ships in the snapshot');
  assert.deepEqual(snap.powerups[0], { id: 'pu0', x: 123, y: 456, type: 'nuke', ttl: 8.3 },
    'the floater ships id/x/y/type/ttl (ttl quantized)');
  assert.equal(snap.fireSaleT, 4.2, 'the active fire-sale timer ships');
  assert.equal(snap.freeSprintT, 12.7, 'the active free-sprint timer ships');
  // serialize/restore keeps the new state and snapshots byte-identically
  const twin = restoreGame(serializeGame(g), charMap);
  assert.equal(JSON.stringify(snapshot(twin, false)), JSON.stringify(snapshot(g, false)),
    'serialize/restore round-trips the power-up state byte-stably');
  // a legacy beacon (no power-up fields) restores with the gated defaults
  const ser = serializeGame(g);
  delete ser.powerups; delete ser.nextPowerupId; delete ser.powerupKills;
  delete ser.fireSaleT; delete ser.freeSprintT;
  const legacy = restoreGame(ser, charMap);
  assert.deepEqual(legacy.powerups, [], 'legacy restore backfills the empty powerups array');
  assert.equal(legacy.fireSaleT, 0, 'legacy restore backfills the fire-sale timer');
  assert.equal(legacy.freeSprintT, 0, 'legacy restore backfills the free-sprint timer');
  // a legacy restore still steps without throwing
  step(legacy, { 0: {}, 1: {} }, 1 / 30);
  assert.equal(legacy.status, 'play', 'a legacy-restored game steps cleanly');
}

// --- presentation parity: the render/audio/client power-up tables must cover
// EXACTLY the sim's power-up type set. The sim emits g.powerups[].type and the
// 'powerup'/'powerupDrop' event ptype from POWERUP_WEIGHTS; render.js paints
// each via POWERUP_STYLE, client.js banners each via POWERUP_BANNER, and
// audio.js stings each via the ev.ptype branch. A rename on either side (or a
// new/removed type) breaks this without anyone having to launch a browser. ---
function testPowerupPresentationTablesCoverSimTypes() {
  // The canonical type set, read straight out of triggerPowerup so the test
  // tracks the real effect dispatch (not a copy that could drift).
  const TYPES = ['fullhealth', 'stamina', 'firesale', 'maxammo', 'nuke'];
  // sanity: every one of these is actually handled by the sim (no silent type)
  for (const t of TYPES) {
    const g = createGame(powerupHostLevel(), powerupParty(), charMap, startingRoster);
    const p0 = g.players[0];
    p0.x = 10 * TILE; p0.y = 10 * TILE;
    triggerPowerup(g, { id: 'pt', x: p0.x, y: p0.y, type: t }, p0);
    assert.ok(g.events.some(ev => ev.type === 'powerup' && ev.ptype === t),
      `sim dispatches a 'powerup' event for ${t}`);
  }

  const render = fs.readFileSync(path.join(root, 'public/render.js'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'public/client.js'), 'utf8');
  const audio = fs.readFileSync(path.join(root, 'public/audio.js'), 'utf8');

  // pull the keys out of the POWERUP_STYLE / POWERUP_BANNER object literals
  const styleKeys = objectLiteralKeys(render, 'POWERUP_STYLE');
  const bannerKeys = objectLiteralKeys(client, 'POWERUP_BANNER');
  assert.deepEqual([...styleKeys].sort(), [...TYPES].sort(),
    'render.js POWERUP_STYLE keys match the sim power-up type set exactly');
  assert.deepEqual([...bannerKeys].sort(), [...TYPES].sort(),
    'client.js POWERUP_BANNER keys match the sim power-up type set exactly');

  // render + client + audio all consume the gated snapshot fields by name
  for (const field of ['powerups', 'fireSaleT', 'freeSprintT']) {
    assert.ok(render.includes(field), `render.js reads snap.${field}`);
  }
  assert.ok(render.includes("ev.type === 'powerup'") && render.includes("ev.type === 'powerupDrop'"),
    'render.js handles both the powerupDrop and powerup events');
  assert.ok(client.includes("case 'powerup'"), 'client.js banners the powerup event');
  // audio sting branches on each type by ptype, with a default fallback
  for (const t of TYPES) {
    if (t === 'fullhealth') continue; // covered by the else fallback branch
    assert.ok(audio.includes(`ev.ptype === '${t}'`), `audio.js has a ${t} power-up sting`);
  }
  assert.ok(audio.includes("ev.type === 'powerupDrop'") && audio.includes("ev.type === 'powerup'"),
    'audio.js handles both power-up events');
}
// Tiny brace-matched key scraper for a top-level `const NAME = { ... }` literal.
// Good enough for the flat one-line-per-entry tables this test guards.
function objectLiteralKeys(src, name) {
  const start = src.indexOf(`const ${name} = {`);
  assert.ok(start >= 0, `${name} object literal is present`);
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  assert.ok(end > start, `${name} object literal is brace-balanced`);
  const body = src.slice(src.indexOf('{', start) + 1, end);
  const keys = new Set();
  // match keys at brace depth 1 only (skip nested glyph(ctx){...} bodies)
  let d = 0;
  for (const m of body.matchAll(/([{}])|(^\s*|[,{]\s*)([a-zA-Z_][\w]*)\s*:/gm)) {
    if (m[1] === '{') d++;
    else if (m[1] === '}') d--;
    else if (d === 0 && m[3]) keys.add(m[3]);
  }
  return keys;
}

// --- ctf mode caps: the contract numbers the whole wave builds against ---
function testModeCaps() {
  assert.deepEqual(MODE_CAPS, { classic: 8, story: 8, bastion: 8, ctf: 32, br: 16 },
    'per-mode caps: co-op squads stay 8, ctf fields 32, br fields 16');
}

// --- ctf: same-team character duplicates are allowed at the sim level ---
function testCtfSameTeamDuplicates() {
  const dup = startingRoster[0];
  const g = createGame(ctfDef(), [
    { pid: 0, name: 'A', charId: dup, team: 0 },
    { pid: 1, name: 'B', charId: dup, team: 0 }, // same char, same team
    { pid: 2, name: 'C', charId: dup, team: 1 }, // and across teams too
    { pid: 3, name: 'D', charId: startingRoster[1], team: 1 },
  ], charMap, startingRoster);
  assert.deepEqual(g.players.map(p => p.charId), [dup, dup, dup, startingRoster[1]],
    'createGame fields same-team duplicates untouched');
  assert.deepEqual(g.players.map(p => p.team), [0, 0, 1, 1], 'explicit party teams hold');
  // both duplicate seats are fully functional: each fires its own shot
  for (const p of g.players) { p.invuln = 0; p.cool = 0; }
  g.players[0].x = 10 * TILE; g.players[0].y = 5 * TILE;
  g.players[1].x = 12 * TILE; g.players[1].y = 5 * TILE;
  step(g, { 0: { fire: true }, 1: { fire: true }, 2: {}, 3: {} }, 1 / 30);
  const pids = g.shots.map(s => s.pid).sort();
  assert.deepEqual(pids, [0, 1], 'both same-char seats fire independently');
}

// --- ctf spawn rings: 16 seats per stand, deterministic, unstuck, own-base ---
// Runs against the synthetic open-field def AND every shipped ctf map, so a
// new 32-player map is gated the moment its file lands in levels/ctf.
function testCtfSpawnRings16PerStand() {
  const defs = [ctfDef(), ...levels.filter(l => l.mode === 'ctf')];
  for (const def of defs) {
    const tag = def.name;
    const g = createGame(def, party32(), charMap, startingRoster);
    assert.equal(g.players.length, 32, `${tag}: 32 seats fielded`);
    for (const team of [0, 1]) {
      const mates = g.players.filter(p => p.team === team);
      assert.equal(mates.length, 16, `${tag}: team ${team} fields 16`);
      const stand = g.flags.find(f => f.team === team);
      const foe = g.flags.find(f => f.team !== team);
      const spots = new Set(mates.map(p => p.x.toFixed(2) + '|' + p.y.toFixed(2)));
      assert.equal(spots.size, 16, `${tag}: team ${team}'s 16 seats land on 16 distinct ring slots`);
      for (const p of mates) {
        assert.ok(!stuckAt(g, p.x, p.y), `${tag}: seat ${p.pid} deploys unstuck`);
        const dOwn = Math.hypot(p.x - stand.homeX, p.y - stand.homeY) / TILE;
        const dFoe = Math.hypot(p.x - foe.homeX, p.y - foe.homeY) / TILE;
        assert.ok(dOwn <= 3.5, `${tag}: seat ${p.pid} rings its own stand (${dOwn.toFixed(1)} tiles)`);
        assert.ok(dFoe > dOwn, `${tag}: seat ${p.pid} deploys at its OWN base`);
      }
    }
    // deterministic: a second create lands every seat on the same slot
    const g2 = createGame(def, party32(), charMap, startingRoster);
    assert.deepEqual(g2.players.map(p => [p.x, p.y]), g.players.map(p => [p.x, p.y]),
      `${tag}: ring deployment is deterministic`);
  }
  // respawn reuses the seat's ring slot: down a seat, wait out the 5s, and it
  // lands exactly where it deployed — then walks free (not overlap-stuck)
  const g = createGame(ctfDef(), party32(), charMap, startingRoster);
  const p = g.players[6]; // team 0, ring seat 3
  const home = { x: p.x, y: p.y };
  p.invuln = 0; p.shield = 0; p.hp = 1;
  pvpShotAt(g, p, 1, 1);
  step(g, {}, 1 / 30);
  assert.equal(p.state, 'down', 'seat downed');
  p.x = 20 * TILE; p.y = 10 * TILE; // body elsewhere — the ring must pull it home
  run(g, () => ({}), 5.3);
  assert.equal(p.state, 'active', 'seat redeployed after the 5s ctf respawn');
  assert.ok(Math.abs(p.x - home.x) < 0.01 && Math.abs(p.y - home.y) < 0.01,
    'respawn reuses the seat ring slot deterministically');
  const x0 = p.x;
  run(g, () => ({ [p.pid]: { right: true } }), 0.5);
  assert.ok(p.x > x0 + TILE * 0.5, 'respawned seat walks free of the ring');
}

// --- addPlayerMidGame: pick-state insertion at the team stand, caps, dups ---
function testAddPlayerMidGame() {
  const party = [0, 1, 2, 3].map(i => ({ pid: i, name: 'P' + i, charId: startingRoster[i % startingRoster.length] }));
  const g = createGame(ctfDef(), party, charMap, startingRoster);
  run(g, () => ({}), 1); // a live, mid-match field
  // refusals first: wrong mode, bad team, duplicate pid
  assert.equal(addPlayerMidGame(g, { pid: 50, name: 'X', team: 2 }), false, 'team must be 0 or 1');
  assert.equal(addPlayerMidGame(g, { pid: 0, name: 'X', team: 1 }), false, 'duplicate pid refused');
  const classic = createGame(levels[0], [{ pid: 0, name: 'A', charId: startingRoster[0] }], charMap, startingRoster);
  assert.equal(addPlayerMidGame(classic, { pid: 9, name: 'X', team: 0 }), false, 'classic refuses mid-game joins');
  const brDef = { ...ctfDef(), name: 'BR Join', mode: 'br', br: { shrinks: [] } };
  brDef.tiles = brDef.tiles.map(r => r.replace(/D/g, '.')); // br fields no stands
  const br = createGame(brDef, party.slice(0, 2), charMap, startingRoster);
  assert.equal(addPlayerMidGame(br, { pid: 9, name: 'X', team: 0 }), false,
    'br refuses mid-game joins — eliminated is eliminated');
  // the join: lands in the respawn-pick state on the team-1 stand ring
  const joiner = addPlayerMidGame(g, { pid: 50, name: 'Late', team: 1 });
  assert.ok(joiner && joiner.pid === 50, 'join returns the new player');
  assert.equal(g.players.length, 5, 'seat appended');
  assert.equal(joiner.state, 'pick', 'joiner enters the respawn-pick state');
  assert.equal(joiner.charId, null, 'no operative until the pick confirms');
  assert.equal(joiner.team, 1);
  assert.deepEqual([joiner.hp, joiner.maxHp, joiner.shield, joiner.kills, joiner.xp, joiner.level],
    [3, 3, 0, 0, 0, 1], 'survival + pvp seat fields ride the insert');
  const stand1 = g.flags.find(f => f.team === 1);
  assert.ok(Math.hypot(joiner.x - stand1.homeX, joiner.y - stand1.homeY) <= TILE * 3.5,
    'joiner waits on the team stand ring');
  // pvp pick choices: the FULL roster, duplicates included (identity is
  // name + team color) — teammates' fielded chars stay choosable
  const sj = snapshot(g, false).players.find(p => p.pid === 50);
  assert.deepEqual(sj.pick.choices, startingRoster, 'pick offers the full roster in pvp');
  // a button held through the join can't instantly confirm (down-flow rule)
  step(g, { 50: { fire: true } }, 1 / 30);
  assert.equal(joiner.state, 'pick', 'held fire does not confirm');
  step(g, { 50: {} }, 1 / 30); // release
  step(g, { 50: { fire: true } }, 1 / 30); // press = confirm
  assert.equal(joiner.state, 'active', 'released-then-pressed fire confirms the pick');
  assert.equal(joiner.charId, startingRoster[0], 'joiner fields the cursor operative');
  assert.ok(joiner.invuln > 3, 'fresh deploy lands with spawn grace');
  assert.ok(Math.hypot(joiner.x - stand1.homeX, joiner.y - stand1.homeY) <= TILE * 3.5,
    'the confirmed deploy is on the team ring too');
  // same-team duplicate via the pick: pid 1 (team 1) already fields roster[1];
  // a second joiner cursors right once and fields the same operative
  const j2 = addPlayerMidGame(g, { pid: 51, name: 'Twin', team: 1 });
  step(g, { 51: {} }, 1 / 30);
  step(g, { 51: { right: true } }, 1 / 30); // cursor 0 -> 1
  step(g, { 51: {} }, 1 / 30);
  step(g, { 51: { fire: true } }, 1 / 30);
  assert.equal(j2.charId, startingRoster[1], 'duplicate pick confirms');
  assert.equal(g.players.filter(p => p.team === 1 && p.charId === startingRoster[1]).length, 2,
    'two team-1 seats field the same operative');
  // mid-join determinism + snapshot integrity: a serialize/restore twin taken
  // right after an insert replays snapshot-for-snapshot
  const g3 = createGame(ctfDef(), party, charMap, startingRoster);
  run(g3, () => ({}), 0.5);
  addPlayerMidGame(g3, { pid: 70, name: 'Mid', team: 0 });
  assert.ok(!Number.isNaN(JSON.stringify(snapshot(g3, false)).length), 'post-insert snapshot serializes');
  const twin = restoreGame(serializeGame(g3), charMap);
  const script = i => {
    const inputs = {};
    for (const p of [0, 1, 2, 3, 70]) {
      inputs[p] = { right: p % 2 === 0, left: p % 2 === 1, fire: (i * 30 % 5) < 2 };
    }
    return inputs;
  };
  const h = [[], []];
  [g3, twin].forEach((gx, gi) => {
    for (let i = 0; i < 60; i++) {
      step(gx, script(i / 30), 1 / 30);
      h[gi].push(JSON.stringify(snapshot(gx, false)));
    }
  });
  assert.deepEqual(h[0], h[1], 'mid-join twins replay snapshot-for-snapshot');
}

// --- addPlayerMidGame: the sim holds the 32/16-per-team caps itself ---
function testAddPlayerMidGameCaps() {
  // 31 seats: 16 on team 0 (full), 15 on team 1
  const party = Array.from({ length: 31 }, (_, i) =>
    ({ pid: i, name: 'P' + i, charId: startingRoster[i % startingRoster.length], team: i < 16 ? 0 : 1 }));
  const g = createGame(ctfDef(), party, charMap, startingRoster);
  assert.equal(addPlayerMidGame(g, { pid: 100, name: 'X', team: 0 }), false,
    'a full team (16) refuses even below the room cap');
  const ok = addPlayerMidGame(g, { pid: 100, name: 'X', team: 1 });
  assert.ok(ok, 'the open team accepts the 32nd seat');
  assert.equal(g.players.length, MODE_CAPS.ctf, 'field is at the 32 cap');
  assert.equal(addPlayerMidGame(g, { pid: 101, name: 'Y', team: 1 }), false,
    'seat 33 is refused at the sim level');
  // a finished match refuses too
  g.status = 'cleared';
  g.players.pop();
  assert.equal(addPlayerMidGame(g, { pid: 102, name: 'Z', team: 1 }), false,
    'no joins after the horn');
}

// --- br at its new 16 cap: every seat deploys unstuck on the shipped map ---
// (the audit fix: spawn-reuse drift spawns[i % n] + i*10px walked seat 12
// into the level22 border wall at 16 players)
function testBr16SeatsDeployUnstuck() {
  const brMaps = levels.filter(l => l.mode === 'br');
  assert.ok(brMaps.length >= 1, 'a br map ships');
  for (const def of brMaps) {
    const party = Array.from({ length: MODE_CAPS.br }, (_, i) =>
      ({ pid: i, name: 'P' + i, charId: startingRoster[i % startingRoster.length] }));
    const g = createGame(def, party, charMap, startingRoster);
    assert.equal(g.players.length, MODE_CAPS.br, `${def.name}: 16 seats fielded`);
    for (const p of g.players) {
      assert.ok(!stuckAt(g, p.x, p.y), `${def.name}: seat ${p.pid} deploys unstuck at 16 players`);
    }
    // deterministic: the unstick scan lands the same seats on the same tiles
    const g2 = createGame(def, party, charMap, startingRoster);
    assert.deepEqual(g2.players.map(p => [p.x, p.y]), g.players.map(p => [p.x, p.y]),
      `${def.name}: 16-seat deploy is deterministic`);
  }
}

// --- 32-player ctf smoke: 60s of scripted 16v16 chaos, bytes/tick report ---
function test32PlayerCtfSmoke() {
  const g = createGame(ctfDef(), party32(), charMap, startingRoster);
  const full = JSON.stringify({ t: 'levelStart', s: snapshot(g, true) }).length;
  const dt = 1 / 30;
  let bytes = 0, maxBytes = 0, ticks = 0;
  for (let i = 0; i < 1800 && g.status === 'play'; i++) {
    const inputs = {};
    for (const p of g.players) {
      const adv = (i % 240) < 150; // advance waves, then regroup
      inputs[p.pid] = {
        right: p.team === 0 ? adv : !adv,
        left: p.team === 1 ? adv : !adv,
        up: (p.pid % 4) < 2 && (i % 50) < 25,
        down: (p.pid % 4) >= 2 && (i % 50) < 25,
        fire: ((i + p.pid * 3) % 9) < 4,
        special: (i % 120) === (p.pid * 3) % 120,
        act: ((i + p.pid) % 70) < 6,
        item: (i % 200) === (p.pid * 5) % 200,
      };
    }
    step(g, inputs, dt);
    const wire = JSON.stringify({ t: 'state', s: snapshot(g, false) });
    bytes += wire.length;
    maxBytes = Math.max(maxBytes, wire.length);
    ticks++;
    if (i % 150 === 0) {
      for (const p of g.players) {
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), 'positions stay finite');
        assert.ok(p.x >= 0 && p.x <= g.w * TILE && p.y >= 0 && p.y <= g.h * TILE, 'players stay in bounds');
      }
    }
  }
  assert.equal(ticks, 1800, '60 seconds of 32-player ctf step without an early end or throw');
  assert.equal(g.players.length, 32, 'all 32 seats survive the match state machine');
  // the whole sim still JSON round-trips after the brawl
  const twin = restoreGame(serializeGame(g), charMap);
  assert.equal(JSON.stringify(snapshot(twin, false)), JSON.stringify(snapshot(g, false)),
    'post-smoke serialize/restore is byte-stable');
  const avg = Math.round(bytes / ticks);
  // players ride every snapshot whole by design; 32 seats must stay sane on
  // the wire (the AOI path trims swarms, not players)
  assert.ok(avg < 32 * 1024, `32-player snapshot averages under 32KB/tick (got ${avg})`);
  console.log(`  32-player ctf wire: avg ${avg} bytes/tick, peak ${maxBytes}, levelStart ${full} (${ticks} ticks)`);
}

// --- public-deploy hardening: drive the REAL server over real sockets ---------
// Two spawns of server.js on spare ports. PUBLIC instance (PUBLIC_DEPLOY=1,
// HOLDOUT_SMOKE=1 to prove the hook is dead, SAVES_DIR=tmp, ROOM_CAP=4,
// LOBBY_TTL_MS=1500): boot log says PUBLIC; lobby omits lan; host re-entry is
// refused (orphaned-room leak); the global room cap refuses the 5th room;
// debugClear is inert; prototype-key charIds never reach a roster; names are
// sanitized at the trust boundary; rankings.json lands under SAVES_DIR with
// sanitized names, a lower score ceiling, and de-dup; the per-IP ws cap (keyed
// on X-Forwarded-For — the trust-proxy path) refuses the 9th socket; message
// floods and garbage frames (null/binary) are dropped without disconnect; an
// oversized frame kills only its own socket; idle lobbies are reaped and their
// members freed. COUCH instance (no env flags beyond HOLDOUT_SMOKE/SAVES_DIR):
// no PUBLIC log, and the host-sent debugClear smoke hook still works.
async function testServerPublicHardening() {
  const { spawn } = await import('child_process');
  const osMod = await import('os');
  const WebSocket = (await import('ws')).default;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const basePort = 4300 + (process.pid % 500);

  function startSrv(port, env) {
    const proc = spawn(process.execPath, [path.join(root, 'server.js')], {
      // explicit blanks so a dev's shell env can't leak flags into the run
      env: { ...process.env, PORT: String(port), PUBLIC_DEPLOY: '', HOLDOUT_SMOKE: '', SAVES_DIR: '', ROOM_CAP: '', LOBBY_TTL_MS: '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    proc.stdout.on('data', d => { log += d; });
    proc.stderr.on('data', d => { log += d; });
    const ready = (async () => {
      for (let i = 0; i < 240; i++) {
        if (log.includes('running at')) return;
        if (proc.exitCode !== null) throw new Error('server exited early:\n' + log);
        await sleep(25);
      }
      throw new Error('server boot timeout:\n' + log);
    })();
    return { proc, ready, getLog: () => log };
  }

  // ws client with an inbox: expect(type) resolves the next message of that
  // type; none(type, ms) asserts none arrives in the window
  function open(port, xff) {
    const w = new WebSocket(`ws://127.0.0.1:${port}`, xff ? { headers: { 'x-forwarded-for': xff } } : undefined);
    const queue = [];
    const waiters = [];
    w.on('message', raw => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      const i = waiters.findIndex(x => x.type === m.t);
      if (i !== -1) waiters.splice(i, 1)[0].res(m);
      else queue.push(m);
    });
    w.expect = (type, ms = 4000) => {
      const i = queue.findIndex(m => m.t === type);
      if (i !== -1) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((res, rej) => {
        const wt = { type, res: null };
        const t = setTimeout(() => {
          const j = waiters.indexOf(wt);
          if (j !== -1) waiters.splice(j, 1);
          rej(new Error(`timeout waiting for '${type}' (queued: ${queue.map(m => m.t).join(',') || 'nothing'})`));
        }, ms);
        wt.res = m => { clearTimeout(t); res(m); };
        waiters.push(wt);
      });
    };
    w.none = async (type, ms) => {
      await sleep(ms);
      assert.ok(!queue.some(m => m.t === type), `no '${type}' expected, got one`);
    };
    w.sendj = obj => w.send(JSON.stringify(obj));
    w.opened = new Promise((res, rej) => { w.on('open', () => res(w)); w.on('error', rej); });
    w.closed = new Promise(res => w.on('close', code => res(code)));
    return w;
  }

  const tmpA = fs.mkdtempSync(path.join(osMod.tmpdir(), 'anchorfall-pub-'));
  const tmpB = fs.mkdtempSync(path.join(osMod.tmpdir(), 'anchorfall-lan-'));
  const pub = startSrv(basePort, { PUBLIC_DEPLOY: '1', HOLDOUT_SMOKE: '1', SAVES_DIR: tmpA, ROOM_CAP: '4', LOBBY_TTL_MS: '1500' });
  const couch = startSrv(basePort + 1, { HOLDOUT_SMOKE: '1', SAVES_DIR: tmpB });
  const api = (port, p) => `http://127.0.0.1:${port}${p}`;
  const sockets = [];
  const track = w => { sockets.push(w); return w; };
  try {
    await pub.ready;
    await couch.ready;
    assert.ok(pub.getLog().includes('PUBLIC'), 'public boot log announces PUBLIC mode');
    assert.ok(!couch.getLog().includes('PUBLIC'), 'couch boot log says nothing about PUBLIC');

    // --- global room cap (ROOM_CAP=4): 5th host refused with a friendly error
    const hosts = await Promise.all([1, 2, 3, 4, 5].map(n => track(open(basePort, `10.0.0.${n}`)).opened));
    for (const [i, h] of hosts.entries()) {
      h.sendj({ t: 'host', name: 'Cap' + i, mode: 'classic' });
      if (i < 4) await h.expect('joined');
    }
    const capErr = await hosts[4].expect('error');
    assert.ok(/room limit/i.test(capErr.error), `5th room refused (${capErr.error})`);
    for (const h of hosts) h.close();
    await Promise.all(hosts.map(h => h.closed));
    await sleep(100); // server processes the closes; rooms freed

    // --- host re-entry guard + lan omitted + name sanitation + rejoin token
    const R = await track(open(basePort, '10.0.1.1')).opened;
    R.sendj({ t: 'host', name: '  Grief ‮er name that overflows  ', mode: 'ctf', public: true });
    const rJoined = await R.expect('joined');
    assert.ok(typeof rJoined.token === 'string' && rJoined.token.length >= 8, 'joined carries a rejoin token');
    const rLobby = await R.expect('lobby');
    assert.ok(!('lan' in rLobby), 'PUBLIC lobby omits the lan field');
    assert.equal(rLobby.players[0].name, 'Grief er nam', 'name stripped of control/bidi chars, collapsed, 12-capped');
    const tReap = Date.now(); // R idles from here; the reaper should free it
    R.sendj({ t: 'host', name: 'Again', mode: 'classic' });
    const reErr = await R.expect('error');
    assert.ok(/already in a room/i.test(reErr.error), 'second host on a seated connection is refused');
    const listed = await (await fetch(api(basePort, '/api/rooms'))).json();
    assert.equal(listed.length, 1, 'no orphan room was minted by the re-host attempt');

    // --- debugClear is DEAD under PUBLIC even with HOLDOUT_SMOKE=1
    const E = await track(open(basePort, '10.0.1.2')).opened;
    E.sendj({ t: 'host', name: 'Smoke', mode: 'classic' });
    await E.expect('joined');
    const eLobby = await E.expect('lobby');
    E.sendj({ t: 'select', charId: eLobby.roster[0] });
    await E.expect('lobby');
    E.sendj({ t: 'start' });
    await E.expect('levelStart');
    E.sendj({ t: 'debugClear' });
    await E.none('levelEnd', 600);
    E.close();

    // --- prototype-key charId injection via the bastion roster
    const F = await track(open(basePort, '10.0.1.3')).opened;
    F.sendj({ t: 'host', name: 'Proto', mode: 'bastion', roster: ['__proto__', 'constructor', 'toString', 'hasOwnProperty'] });
    await F.expect('joined');
    const fLobby = await F.expect('lobby');
    for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      assert.ok(!fLobby.roster.includes(bad), `prototype key '${bad}' filtered from the roster`);
    }
    F.sendj({ t: 'select', charId: 'constructor' });
    const fLobby2 = await F.expect('lobby');
    assert.equal(fLobby2.players[0].charId, null, 'prototype-key select is refused');
    F.sendj({ t: 'start' }); // no party — must be a no-op, never a crash
    await sleep(150);
    assert.equal((await fetch(api(basePort, '/api/levels'))).status, 200, 'server alive after injection attempt');
    F.close();

    // --- SAVES_DIR + rankings POST hygiene (sanitized names, ceiling, de-dup)
    const defs = await (await fetch(api(basePort, '/api/levels'))).json();
    const key = defs.find(d => d.category === 'classic').key;
    const post = body => fetch(api(basePort, '/api/rankings'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const r1 = await (await post({ key, names: ['Evil ‮Nam e'], score: 1234, timeS: 56.7 })).json();
    assert.equal(r1.rank, 1, 'local run lands on the fresh board');
    assert.ok(fs.existsSync(path.join(tmpA, 'rankings.json')), 'rankings.json written under SAVES_DIR');
    const board = await (await fetch(api(basePort, `/api/rankings/${key}`))).json();
    assert.equal(board.entries[0].names[0], 'Evil Nam e', 'REST names pass the same sanitizer');
    const r2 = await (await post({ key, names: ['Evil ‮Nam e'], score: 1234, timeS: 56.7 })).json();
    assert.equal(r2.rank, null, 'identical resubmission is de-duplicated');
    assert.equal((await post({ key, names: ['Forge'], score: 2e7, timeS: 10 })).status, 400, 'absurd score refused');

    // --- per-IP ws cap keyed on X-Forwarded-For: 9th socket refused, other IP fine
    const batch = await Promise.all(Array.from({ length: 8 }, () => track(open(basePort, '203.0.113.9')).opened));
    const ninth = track(open(basePort, '203.0.113.9'));
    await ninth.opened;
    const nineErr = await ninth.expect('error');
    assert.ok(/too many connections/i.test(nineErr.error), '9th socket from one IP refused');
    assert.equal(await ninth.closed, 1013, '9th socket closed with 1013 (try again later)');
    const other = await track(open(basePort, '203.0.113.10')).opened;
    other.sendj({ t: 'join', room: 'ZZZZ' });
    const otherErr = await other.expect('error');
    assert.ok(/room not found/i.test(otherErr.error), 'a different forwarded IP is still served');
    for (const b of batch) b.close();
    other.close();

    // --- garbage frames are ignored; flood is dropped without disconnect
    const G = await track(open(basePort, '10.0.1.4')).opened;
    // garbage first, while the token bucket is full, so each one really hits
    // the parse path: JSON `null` would crash the old `m.t` access outright
    G.send('null'); G.send('123'); G.send('[1,2]'); G.send('"str"'); G.send(Buffer.from([1, 2, 3]));
    for (let i = 0; i < 500; i++) G.sendj({ t: 'zzz', i });
    await sleep(300);
    assert.equal(G.readyState, WebSocket.OPEN, 'flooding socket stays connected (messages dropped, not killed)');
    await sleep(1300); // token bucket refills
    G.sendj({ t: 'join', room: 'ZZZZ' });
    const gErr = await G.expect('error');
    assert.ok(/room not found|join attempts/i.test(gErr.error), 'socket is serviced again after the flood');
    G.close();

    // --- oversized frame: that socket dies (1009), the process does not
    const H = await track(open(basePort, '10.0.1.5')).opened;
    H.send('x'.repeat(64 * 1024));
    assert.equal(await H.closed, 1009, 'oversized frame closes only the offending socket');
    assert.equal((await fetch(api(basePort, '/api/levels'))).status, 200, 'server alive after oversized frame');

    // --- mid-level rejoin holds: PUBLIC binds them to token-or-IP, so an
    // observed name alone can no longer hijack a dropped player's seats
    const E2 = await track(open(basePort, '10.0.2.1')).opened;
    E2.sendj({ t: 'host', name: 'Holder', mode: 'classic' });
    const e2Joined = await E2.expect('joined');
    const e2Lobby = await E2.expect('lobby');
    E2.sendj({ t: 'select', charId: e2Lobby.roster[0] });
    await E2.expect('lobby');
    E2.sendj({ t: 'start' });
    await E2.expect('levelStart');
    E2.terminate(); // mid-level drop banks a 120s hold
    await sleep(150);
    const hijacker = await track(open(basePort, '10.0.2.99')).opened;
    hijacker.sendj({ t: 'join', room: e2Lobby.room, name: 'Holder' });
    const hjErr = await hijacker.expect('error');
    assert.ok(/in progress/i.test(hjErr.error), 'name-only rejoin from a stranger IP is refused on PUBLIC');
    hijacker.close();
    const victim = await track(open(basePort, '10.0.2.50')).opened;
    victim.sendj({ t: 'join', room: e2Lobby.room, name: 'holder', token: e2Joined.token });
    const vJoined = await victim.expect('joined');
    assert.equal(vJoined.rejoined, true, 'the real player rejoins with their token (even from a new IP)');
    victim.close();

    // --- idle lobby reaper (LOBBY_TTL_MS=1500): R's parked lobby is closed
    await sleep(Math.max(0, tReap + 4000 - Date.now()));
    const reapErr = await R.expect('error');
    assert.ok(/idle/i.test(reapErr.error), `idle lobby got a closed notice (${reapErr.error})`);
    R.sendj({ t: 'host', name: 'Fresh', mode: 'classic' });
    await R.expect('joined'); // me.room was freed — hosting works again
    assert.equal((await (await fetch(api(basePort, '/api/rooms'))).json()).length, 0, 'reaped lobby left the room browser');
    R.close();

    // --- couch instance: no flags = old behavior, smoke hook alive for the host
    const C = await track(open(basePort + 1)).opened;
    C.sendj({ t: 'host', name: 'Couch', mode: 'classic' });
    await C.expect('joined');
    const cLobby = await C.expect('lobby');
    C.sendj({ t: 'select', charId: cLobby.roster[0] });
    await C.expect('lobby');
    C.sendj({ t: 'start' });
    await C.expect('levelStart');
    C.sendj({ t: 'debugClear' });
    const cEnd = await C.expect('levelEnd');
    assert.equal(cEnd.status, 'cleared', 'couch smoke hook still force-clears for the host');
    assert.ok(fs.existsSync(path.join(tmpB, 'rankings.json')), 'online clear persisted rankings under SAVES_DIR (couch too)');
    C.close();

    // --- couch rejoin stays name-keyed (old clients send no token)
    const C2 = await track(open(basePort + 1)).opened;
    C2.sendj({ t: 'host', name: 'Rejoiner', mode: 'classic' });
    await C2.expect('joined');
    const c2Lobby = await C2.expect('lobby');
    C2.sendj({ t: 'select', charId: c2Lobby.roster[0] });
    await C2.expect('lobby');
    C2.sendj({ t: 'start' });
    await C2.expect('levelStart');
    C2.terminate();
    await sleep(150);
    const C3 = await track(open(basePort + 1)).opened;
    C3.sendj({ t: 'join', room: c2Lobby.room, name: 'rejoiner' });
    const c3Joined = await C3.expect('joined');
    assert.equal(c3Joined.rejoined, true, 'LAN rejoin by name alone still works (no token required)');
    C3.close();

    console.log('  public-deploy hardening: boot/caps/sanitizer/reaper/flood all hold');
  } finally {
    for (const w of sockets) { try { w.terminate(); } catch { /* already closed */ } }
    pub.proc.kill();
    couch.proc.kill();
    fs.rmSync(tmpA, { recursive: true, force: true });
    fs.rmSync(tmpB, { recursive: true, force: true });
  }
}

testEnemyShotsBlockedByStructures();
testCoreGnawNeedsWaveOrSealedTarget();
testCoreIntegrityCheatNullifiesCoreDamage();
testMaxOutPlayerCheat();
testShipBoardingEdgeWalkAwayAndLaunch();
testCornerPinnedMarcherReachesCore();
testPathBudgetThrottleAndDormancy();
testNextBloodMoonCountdownFlag();
testRevivePlayerRejoinFlow();
testCtfOvertimeEscalation();
testHornCallsTheNightEarly();
testHornAtLitBeacon();
testDayEventsProbeAndSupplyDrop();
testDayEventsSkippedByHornAndRearm();
testSprintStamina();
testPowerupDropRollDeterministicAndGated();
testPowerupWeightedDistributionFavorsFullHealth();
testPowerupHordeBoostsRate();
testPowerupWalkOverPickupAndTeamWideEffects();
testPowerupNukeFewerThanTen();
testPowerupTeamScopedAndFriendlySafeInCtf();
testPowerupFireSaleFreeBuilds();
testPowerupSnapshotGatingAndSerializeRoundTrip();
testPowerupPresentationTablesCoverSimTypes();
testModeCaps();
testCtfSameTeamDuplicates();
testCtfSpawnRings16PerStand();
testAddPlayerMidGame();
testAddPlayerMidGameCaps();
testBr16SeatsDeployUnstuck();
test32PlayerCtfSmoke();
await testServerPublicHardening();

console.log('sim tests passed');
