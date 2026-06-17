// Headless END-TO-END playtest: STORY CHAPTER IX (levels/story/ch09.json,
// "The Drift Sea") on the ch7/ch8 chassis: the whole mission lives in
// runMission() and is executed TWICE — the second run must replay to an
// identical FNV event-stream hash (full-chapter determinism gate).
//
// One scripted operative drives every mission system of the chapter through
// the real sim — not a navigation bot (sim.test.js owns the generic
// connectivity/determinism gates; the deathball harnesses own open combat).
// Cheat positioning (direct p.x/p.y writes + permanent invuln) is used
// between beats so the run verifies the DEF WIRING, plus one honest skiff
// voyage and two honest gun beats:
//
//   - untimed story clock; quests activate at both givers; gifts pay once
//   - 'landfall' reach trips at the chart-house
//   - REAL skiff leg: mount at the pier head, sail the harbor + north run,
//     dismount at buoy islet A, scoop the wave-log on touch
//   - remaining two wave-logs scooped; fetch x3 hands over at Noor (consumed)
//   - pier beacon built from the pool; build quest settles at Joss
//   - voices window: 1 thrown -> 100s expiry -> switchReset wipes the group
//   - 4-of-6 inside the window -> quorum -> corridor-gate opens
//   - rite: wrong stone first -> glyphReset; then WAVE>VERTEX>SEAL>ANCHOR ->
//     glyphDone -> pad-gate opens
//   - FULL CHAIN: 12 channel husks and 4 phantom acolytes are shot down with
//     the real weapon pipeline (cheat-aimed, invuln) and both kill quests
//     hand over at their givers — every quest in the chapter reaches done
//   - corridor-out channels 0.8s and blinks to corridor-in across the void
//     (the wave-tunnel: the second traversal system after the skiff)
//   - 'cross-the-deep' reach trips on the far shore -> chapter auto-clears
//   - determinism: full rerun -> identical event hash / status / clear time
//
// Run: node scripts/playtest-ch9.mjs   (exit 0 = all checks pass)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { charsById, createGame, step, TILE } from '../shared/game.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const def = JSON.parse(fs.readFileSync(path.join(root, 'levels/story/ch09.json'), 'utf8'));
const characters = JSON.parse(fs.readFileSync(path.join(root, 'shared/characters.json'), 'utf8'));
const charMap = charsById(characters);

const DT = 1 / 30;
const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
function fnv(h, s) {
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
const NOISY = new Set(['shoot', 'hitWall', 'hit', 'walk']); // high-volume, position-fuzzy

const ROSTER = ['scout', 'sniper', 'shade', 'volt', 'soldier'];

// ============================ the whole chapter ===============================
function runMission(quiet = false) {
  const g = createGame(def, [{ pid: 0, name: 'Pilot', charId: 'scout' }], charMap, ROSTER);
  const p = g.players[0];
  const log = [];
  const wedges = [];
  let hash = 2166136261;
  let frame = 0;

  // run A prints + records the wiring checks; run B only flags divergence
  const ck = (name, ok, detail = '') => {
    if (!quiet) check(name, ok, detail);
    else if (!ok) wedges.push(`rerun divergence: ${name}`);
  };

  function tick(n, inp = {}) {
    for (let i = 0; i < n; i++) {
      p.invuln = 9999; // wiring run: incoming damage is out of scope
      step(g, { 0: inp }, DT);
      frame++;
      for (const e of g.events) {
        log.push(e);
        if (!NOISY.has(e.type)) hash = fnv(hash, `${e.type}:${e.pid ?? ''}:${e.id ?? ''}:${Math.round(e.x ?? 0)},${Math.round(e.y ?? 0)};`);
      }
      g.events.length = 0;
      if (frame % 150 === 0) hash = fnv(hash, `${p.pid}@${Math.round(p.x)},${Math.round(p.y)}hp${p.hp};`);
      if (g.status !== 'play') return;
    }
  }
  const put = (tx, ty) => { p.x = (tx + 0.5) * TILE; p.y = (ty + 0.5) * TILE; tick(2); };
  const press = () => { tick(1, { act: true }); tick(8); };
  const ev = type => log.filter(e => e.type === type);
  const quest = id => g.quests.find(q => q.id === id);

  // move toward waypoints with real inputs (works afoot and aboard a skiff)
  function go(wps, cap = 30 * 60, tol = 10) {
    for (const [tx, ty] of wps) {
      const gx = (tx + 0.5) * TILE, gy = (ty + 0.5) * TILE;
      let guard = 0;
      while (Math.hypot(gx - p.x, gy - p.y) > tol && guard++ < cap) {
        const inp = {};
        if (gx < p.x - 4) inp.left = true; else if (gx > p.x + 4) inp.right = true;
        if (gy < p.y - 4) inp.up = true; else if (gy > p.y + 4) inp.down = true;
        tick(1, inp);
      }
      if (guard >= cap) { wedges.push(`wedged en route to ${tx},${ty} (at ${(p.x / TILE).toFixed(1)},${(p.y / TILE).toFixed(1)})`); break; }
    }
  }

  // shoot down `want` enemies of `letter` through the real weapon pipeline:
  // cheat-teleport near the nearest one, cheat-aim, hold fire. Deterministic
  // (nearest-first targeting, fixed offsets, no randomness in the loop).
  function hunt(letter, questId, want) {
    let guard = 0;
    while (quest(questId).progress < want && guard < 30 * 300 && g.status === 'play') {
      const alive = g.enemies.filter(e => !e.dead && e.letter === letter);
      if (!alive.length) break;
      let tgt = alive[0], best = Infinity;
      for (const e of alive) {
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < best) { best = d; tgt = e; }
      }
      if (best > TILE * 3.5) { p.x = tgt.x - TILE * 1.6; p.y = tgt.y; }
      let sub = 0;
      while (!tgt.dead && sub++ < 30 * 8 && guard++ < 30 * 300 && g.status === 'play') {
        const d = Math.hypot(tgt.x - p.x, tgt.y - p.y) || 1;
        p.fx = (tgt.x - p.x) / d; p.fy = (tgt.y - p.y) / d;
        tick(1, { fire: true });
      }
      if (!tgt.dead) { p.x = tgt.x - TILE * 0.9; p.y = tgt.y; } // wall between: go point-blank
    }
  }

  // --- untimed story clock ---
  tick(5);
  ck('untimed story: no countdown', g.untimed === true && g.timeLeft === def.time);

  // --- quests activate; landfall reach trips at the chart-house ---
  put(16, 24); press();
  ck('Noor talk activates her six quests + pays her gift once',
    ['landfall', 'wave-logs', 'harbor-voices', 'tide-rite', 'cross-the-deep', 'phantom-fleet'].every(id => quest(id).state === 'active')
    && ev('talk').some(e => e.npcId === 'noor-avesh' && e.gift === 8),
    ev('quest').filter(e => e.state === 'active').map(e => e.id).join(', '));
  tick(5);
  ck("'landfall' reach trips inside the chart-house", quest('landfall').progress >= 1);
  put(20, 36); press();
  ck('Joss talk activates his quests + pays his gift once',
    quest('pier-beacon').state === 'active' && quest('channel-husks').state === 'active'
    && ev('talk').some(e => e.npcId === 'joss-maru' && e.gift === 6));

  // --- the honest skiff voyage: pier head -> north run -> buoy islet A ---
  put(28, 33); press(); // mount the nearest moored skiff
  ck('skiff mounts from the pier head', ev('mount').some(e => e.kind === 'skiff') && p.riding != null);
  go([[30, 33], [30, 14], [28, 13], [28, 10]]); // up the harbor, around the islet, water only
  press(); // dismount: steps ashore onto the buoy islet
  ck('skiff sails the channels and lands the buoy islet',
    ev('dismount').some(e => e.kind === 'skiff') && !p.riding
    && Math.floor(p.x / TILE) >= 28 && Math.floor(p.x / TILE) <= 33 && Math.floor(p.y / TILE) >= 8 && Math.floor(p.y / TILE) <= 13,
    `ashore at ${(p.x / TILE).toFixed(1)},${(p.y / TILE).toFixed(1)}`);
  go([[31, 10]]); tick(3); // the wave-log scoops on touch
  ck('wave-log A scooped on touch', ev('qitemPickup').some(e => e.id === 'qi-log-north'));

  // --- the other two logs (positioning cheats; sea-reach is generator-proven) ---
  put(56, 11); tick(3);
  put(28, 55); tick(3);
  ck('all three wave-logs carried', g.qitems.filter(it => it.carrier === 0 && it.kind === 'wavelog').length === 3
    && quest('wave-logs').progress === 3);
  put(16, 24); press();
  ck('fetch x3 hands over at Noor (logs consumed, reward paid)',
    quest('wave-logs').state === 'done' && g.qitems.length === 0,
    `pool ${g.shards.toFixed(0)} shards`);

  // --- the pier beacon ---
  g.shards = 60;
  put(26, 34);
  { let guard = 0; while (!g.builds.find(b => b.kind === 'beacon').built && guard++ < 30 * 30) tick(1, { act: true }); }
  ck('pier beacon raised from the pool', g.builds.find(b => b.kind === 'beacon').built
    && ev('beacon').length >= 1 && quest('pier-beacon').progress >= 1);
  put(20, 36); press();
  ck('build quest settles at Joss', quest('pier-beacon').state === 'done');

  // --- the harbor voices: window expiry first, then the real quorum ---
  put(43, 14); press();
  ck('voice-north throws ON and starts the window',
    g.switches.find(s => s.id === 'voice-north').on && ev('switch').length === 1);
  tick(Math.ceil(105 / DT)); // let the sea forget
  ck('100s window expires -> switchReset wipes the group OFF',
    ev('switchReset').length === 1 && g.switches.every(s => !s.on));
  put(13, 28); press();
  put(21, 32); press();
  put(15, 46); press();
  put(42, 48); press();
  ck('4-of-6 voices inside the window -> quorum -> corridor-gate opens',
    ev('quorum').some(e => e.group === 0)
    && ev('doorOpen').some(e => e.id === 'corridor-gate')
    && g.doors.find(d => d.id === 'corridor-gate').open,
    `voices on: ${g.switches.filter(s => s.on).map(s => s.id).join(', ')}`);
  put(16, 24); press();
  ck('switch quest settles at Noor', quest('harbor-voices').state === 'done');

  // --- the Tide Rite: a wrong stone resets, the Plaque order opens the pad ---
  put(69, 32); press(); // VERTEX first — the field refuses
  ck('wrong first stone -> glyphReset (the rite restarts clean)',
    ev('glyphReset').length === 1 && g.glyphs.filter(gl => gl.group === 0).every(gl => !gl.lit));
  put(66, 32); press(); // WAVE
  put(69, 32); press(); // VERTEX
  put(66, 36); press(); // SEAL
  put(69, 36); press(); // ANCHOR
  ck('WAVE>VERTEX>SEAL>ANCHOR -> glyphDone -> pad-gate opens',
    ev('glyphDone').some(e => e.group === 0)
    && ev('doorOpen').some(e => e.id === 'pad-gate')
    && g.doors.find(d => d.id === 'pad-gate').open);
  put(16, 24); press();
  ck('glyph quest settles at Noor', quest('tide-rite').state === 'done');

  // --- the kill quests: real shots, cheat aim — the chain completes in full ---
  hunt('z', 'channel-husks', 12);
  ck('12 channel husks shot down through the live weapon pipeline',
    quest('channel-husks').progress >= 12, `kills ${g.kills}, level ${p.level}`);
  put(20, 36); press();
  ck('husk bounty settles at Joss', quest('channel-husks').state === 'done');
  hunt('q', 'phantom-fleet', 4);
  ck('4 phantom acolytes broken on the sheen', quest('phantom-fleet').progress >= 4);
  put(16, 24); press();
  ck('phantom quest settles at Noor — every chapter quest now banked',
    quest('phantom-fleet').state === 'done'
    && g.quests.filter(q => q.id !== 'cross-the-deep').every(q => q.state === 'done'));

  // --- the settled corridor: channel 0.8s, blink across the deep, finale ---
  // incoming combat stays out of scope: the far-shore greeters bodily wall
  // off a dumb straight-line walker, so they sit this beat out
  g.enemies = g.enemies.filter(e => !(e.x > 82 * TILE && e.y > 26 * TILE && e.y < 40 * TILE));
  put(74, 34); tick(40); // stand the outer pad through the channel
  const blink = ev('teleport').find(e => e.from === 'corridor-out');
  ck('corridor-out channels and blinks across the deep void (wave-tunnel)',
    !!blink && blink.to === 'corridor-in' && Math.floor(p.x / TILE) === 86 && Math.floor(p.y / TILE) === 33,
    blink ? `arrived ${(p.x / TILE).toFixed(1)},${(p.y / TILE).toFixed(1)}` : 'no blink');
  go([[87, 33]]); // the open far-shore approach...
  for (let i = 0; i < 45; i++) tick(1, { right: true }); // ...then shove the shore lip
  tick(30);
  ck("'cross-the-deep' reach trips on the far shore", quest('cross-the-deep').progress >= 1);
  ck('chapter auto-clears on the settled main chain (reach finale)',
    g.status === 'cleared' && ev('clear').length === 1 && ev('extract').length >= 1,
    `status=${g.status} at t=${g.elapsed.toFixed(0)}s, score ${Math.round(g.score)}`);

  return { g, p, log, hash, wedges };
}

// ================================ run + report ================================
console.log('--- Chapter IX playtest: full quest chain, skiff + wave-tunnel, determinism ---');
const t0 = Date.now();
const A = runMission();
console.log(`(run 1: ${((Date.now() - t0) / 1000).toFixed(1)}s wall, ${A.g.elapsed.toFixed(0)}s sim, ${A.log.length} events)`);
console.log('quest ledger: ' + A.g.quests.map(q => `${q.id}=${q.state}(${q.progress}/${q.count})`).join(' '));

check('full chain: every quest progressed to count (8/8)',
  A.g.quests.length === 8 && A.g.quests.every(q => q.progress >= q.count),
  A.g.quests.map(q => `${q.id}:${q.progress}/${q.count}`).join(' '));

const introSlides = Array.isArray(def.intro) ? def.intro : [];
const outroSlides = Array.isArray(def.outro) ? def.outro : [];
check('intro + outro slides defined for the chapter cutscenes',
  introSlides.length > 0 && outroSlides.length > 0
  && [...introSlides, ...outroSlides].every(s => s.title && Array.isArray(s.lines) && s.lines.length > 0),
  `${introSlides.length} intro / ${outroSlides.length} outro`);

// determinism: the full chapter rerun must replay byte-identically
const t1 = Date.now();
const B = runMission(true);
console.log(`(run 2: ${((Date.now() - t1) / 1000).toFixed(1)}s wall)`);
check('full-chapter determinism: rerun matches event hash, status and clear time',
  A.hash === B.hash && B.g.status === A.g.status
  && Math.abs(B.g.elapsed - A.g.elapsed) < 1e-9 && A.log.length === B.log.length,
  `hashes ${A.hash.toString(16)} / ${B.hash.toString(16)}, ${A.log.length} vs ${B.log.length} events`);

const issues = [...new Set([...A.wedges, ...B.wedges])];
const failed = checks.filter(c => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (issues.length) { console.log('issues:'); for (const i of issues) console.log('  - ' + i); }
process.exitCode = (failed.length || issues.length) ? 1 : 0;
