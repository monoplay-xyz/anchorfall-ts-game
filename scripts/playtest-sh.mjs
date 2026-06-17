// Headless playtest: STRONGHOLD sh01 + sh05 (levels/stronghold/).
// Four scripted missions through the real sim (shared/game.js), BFS pathing,
// no invuln cheats, fully deterministic (no Math.random):
//
//   1. sh01 REGRESSION   4 starters hold The Last Bastion's four gates through
//                        five nights (wave-cap budget 5: no blood moons now).
//   2. sh05 WIN-2-LIT    4 operatives defend the two NORTH beacons, let the
//                        south pair fall, relight one by day (8 shards), win
//                        the fourth dawn (4 nights, blood moon 3 — budget 5).
//   3. sh05 ALL-DARK     2 operatives sit tight in the keep; the waves gnaw
//                        all four monoliths dark -> 'allDark' loss.
//   4. sh05 EXTRACTION   4 operatives (one per beacon) hold ALL FOUR lit
//                        through night 1; at night 2 the Anchorcraft lands,
//                        everyone boards, early clear with the launch bonus.
//
// Run: node scripts/playtest-sh.mjs   (exit 0 = all checks pass)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { charsById, createGame, snapshot, step, TILE } from '../shared/game.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sh01 = JSON.parse(fs.readFileSync(path.join(root, 'levels/stronghold/sh01.json'), 'utf8'));
const sh05 = JSON.parse(fs.readFileSync(path.join(root, 'levels/stronghold/sh05.json'), 'utf8'));
const characters = JSON.parse(fs.readFileSync(path.join(root, 'shared/characters.json'), 'utf8'));
const charMap = charsById(characters);

const DT = 1 / 30;
const checks = [];
const issues = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) issues.push(`${name}${detail ? ' (' + detail + ')' : ''}`);
}
function note(msg) { console.log('      ' + msg); }
const T = n => (n + 0.5) * TILE;
const tx = px => Math.floor(px / TILE);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// --- pathing (mirrors sim blockers: rock/trees/water/sandbags/void; lava is
// walkable but never deliberately pathed; built structures block) -----------
const footBlocked = c => c === '#' || c === 'T' || c === '~' || c === 'o' || c === '%' || c === '!';
const tileCh = (g, x, y) => g.grid[y]?.[x] ?? '#';
function blockedAt(g, x, y) {
  if (footBlocked(tileCh(g, x, y))) return true;
  for (const d of g.doors || []) if (!d.open && x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h) return true;
  for (const b of g.builds) if (b.built && b.kind !== 'farm' && tx(b.x) === x && tx(b.y) === y) return true;
  return false;
}
function planPath(g, p, gx, gy) {
  const sx = tx(p.x), sy = tx(p.y);
  const dist0 = new Int32Array(g.w * g.h).fill(-1);
  const prev = new Int32Array(g.w * g.h).fill(-1);
  const q = [sy * g.w + sx];
  dist0[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const cur = q[h], cx = cur % g.w, cy = (cur / g.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      const ni = ny * g.w + nx;
      if (dist0[ni] !== -1 || blockedAt(g, nx, ny)) continue;
      dist0[ni] = dist0[cur] + 1;
      prev[ni] = cur;
      q.push(ni);
    }
  }
  const gtx = tx(gx), gty = tx(gy);
  let best = -1, bestScore = Infinity;
  for (let i = 0; i < dist0.length; i++) {
    if (dist0[i] === -1) continue;
    const cx = i % g.w, cy = (i / g.w) | 0;
    const d = Math.hypot(cx - gtx, cy - gty) * 10 + dist0[i] * 0.05;
    if (d < bestScore) { bestScore = d; best = i; }
  }
  if (best === -1) return [];
  const rev = [];
  for (let i = best; i !== -1; i = prev[i]) rev.push(i);
  rev.reverse();
  return rev.slice(1).map(i => ({ x: T(i % g.w), y: T((i / g.w) | 0) }));
}
// LoS for TARGETING: grid blockers + built structures (player shots demolish
// own walls on direct hits now, so bots refuse those firing lines).
function losClear(g, ax, ay, bx, by) {
  const d = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(d / 12));
  for (let i = 1; i < steps; i++) {
    const px = ax + (bx - ax) * (i / steps), py = ay + (by - ay) * (i / steps);
    const c = tileCh(g, tx(px), tx(py));
    if (c === '#' || c === 'T' || c === '%') return false;
    for (const b of g.builds) {
      if (b.built && b.kind !== 'farm' && Math.hypot(b.x - px, b.y - py) < 18) return false;
    }
  }
  return true;
}

// --- bot chassis -------------------------------------------------------------
function makeBot(pid) {
  return { pid, path: [], repath: 0, relAct: 0, relFire: 0, relItem: 0, relSpec: 0, mem: {}, frame: 0, tgtId: null, tgtHold: 0, avoid: new Map() };
}
function moveAlong(bot, p, inp) {
  while (bot.path.length && Math.hypot(bot.path[0].x - p.x, bot.path[0].y - p.y) < 12) bot.path.shift();
  const wp = bot.path[0];
  if (!wp) return false;
  if (wp.x < p.x - 4) inp.left = true; else if (wp.x > p.x + 4) inp.right = true;
  if (wp.y < p.y - 4) inp.up = true; else if (wp.y > p.y + 4) inp.down = true;
  return inp.left || inp.right || inp.up || inp.down;
}
function goTo(g, bot, p, gx, gy, inp) {
  bot.repath -= 1;
  const moved = Math.hypot((bot.mem.gx ?? -1) - gx, (bot.mem.gy ?? -1) - gy) > TILE;
  if (bot.repath <= 0 || moved || !bot.path.length) {
    bot.path = planPath(g, p, gx, gy);
    bot.mem.gx = gx; bot.mem.gy = gy;
    bot.repath = 15;
  }
  return moveAlong(bot, p, inp);
}
function near(p, x, y, t = 1.2) { return Math.hypot(p.x - x, p.y - y) < TILE * t; }
function pressAct(bot, inp) {
  if (bot.relAct > 0) return false;
  inp.act = true;
  bot.relAct = 8;
  return true;
}
function actAt(g, bot, p, x, y, inp, reach = 1.1) {
  if (!near(p, x, y, reach)) { goTo(g, bot, p, x, y, inp); return false; }
  return pressAct(bot, inp);
}
function weaponRange(p) {
  if (p.fieldWeapon) return { flamer: 2.6, railcannon: 13, stormgun: 7, mortarMk2: 9 }[p.fieldWeapon.kind] ?? 5;
  return charMap[p.charId]?.weapon.range ?? 5;
}

// Combat reflex (adapted from playtest-ch7): zone-limited targeting,
// gnawer priority via opts.prioAt, special-weapon volleys, cracker lobs,
// over-wall lobbing for mortar kits. Returns true when it owns the frame.
function combat(g, bot, p, inp, opts = {}) {
  if (p.state !== 'active') return true;
  const engage = (opts.engage ?? 6.5) * TILE;
  const ow = !p.fieldWeapon && !!charMap[p.charId]?.weapon.overWalls;
  for (const pa of g.patches) {
    if (pa.hostile && Math.hypot(p.x - pa.x, p.y - pa.y) < pa.r + 6) {
      const ux = (p.x - pa.x) / (Math.hypot(p.x - pa.x, p.y - pa.y) || 1);
      const uy = (p.y - pa.y) / (Math.hypot(p.x - pa.x, p.y - pa.y) || 1);
      if (ux < -0.3) inp.left = true; else if (ux > 0.3) inp.right = true;
      if (uy < -0.3) inp.up = true; else if (uy > 0.3) inp.down = true;
      return true;
    }
  }
  let tgt = null;
  if (bot.tgtId != null) {
    const e0 = g.enemies.find(e => e.id === bot.tgtId);
    if (e0 && !e0.dead && bot.tgtHold > 0 && Math.hypot(e0.x - p.x, e0.y - p.y) < 14 * TILE
      && (!opts.zone || opts.zone(e0))) {
      tgt = e0; bot.tgtHold--;
    } else { bot.tgtId = null; }
  }
  if (!tgt) {
    let bd = Infinity;
    for (const e of g.enemies) {
      if (e.dead || e.convertedT > 0) continue;
      const until = bot.avoid.get(e.id);
      if (until !== undefined && bot.frame < until) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      const sniperish = e.kind === 'sniper' || e.kind === 'archer';
      const maxR = sniperish && e.awake ? 11.5 * TILE : (e.awake ? engage : Math.min(engage, 5.5 * TILE));
      if (opts.zone && !opts.zone(e)) continue;
      if (d > maxR || (!ow && !losClear(g, p.x, p.y, e.x, e.y))) continue;
      let score = d - (sniperish ? 3 * TILE : 0) - (e.kind === 'spawner' ? 2 * TILE : 0);
      // gnawers at the defended monolith/core outrank everything
      if (opts.prioAt && Math.hypot(e.x - opts.prioAt.x, e.y - opts.prioAt.y) < 2.4 * TILE) score -= 9 * TILE;
      if (score < bd) { bd = score; tgt = e; }
    }
    if (tgt) { bot.tgtId = tgt.id; bot.tgtHold = 30; }
  }
  if (!tgt) {
    if (p.item && bot.relItem <= 0 && p.maxHp !== undefined
      && ((p.item.kind === 'medkit' && p.hp < p.maxHp) || (p.item.kind === 'shield' && p.shield < 1))) {
      inp.item = true; bot.relItem = 10;
    }
    return false;
  }
  const d = Math.hypot(tgt.x - p.x, tgt.y - p.y);
  const range = weaponRange(p) * TILE * 0.95;
  const spec = charMap[p.charId]?.special;
  if (spec?.kind === 'stim' && p.specialCool <= 0 && bot.relSpec <= 0) {
    let pressers = 0;
    for (const e of g.enemies) if (!e.dead && Math.hypot(e.x - p.x, e.y - p.y) < 2.2 * TILE) pressers++;
    if (p.hp <= 1 || pressers >= 2) { inp.special = true; bot.relSpec = 20; }
  }
  // cracker lure under a press (real consumable, deterministic toss)
  if (p.item?.kind === 'cracker' && bot.relItem <= 0) {
    let crowd = 0;
    for (const e of g.enemies) if (!e.dead && Math.hypot(e.x - p.x, e.y - p.y) < 3.5 * TILE) crowd++;
    if (crowd >= 4) { inp.item = true; bot.relItem = 40; }
  }
  const keep = (tgt.kind === 'beetle' ? 2.3 : 1.7) * TILE;
  let kite = d < keep;
  if (tgt.kind === 'bulwark') {
    let nearestPid = null, nd = Infinity;
    for (const q of g.players) {
      if (q.state !== 'active') continue;
      const qq = Math.hypot(tgt.x - q.x, tgt.y - q.y);
      if (qq < nd) { nd = qq; nearestPid = q.pid; }
    }
    if (nearestPid === p.pid && d < 2.4 * TILE) kite = true;
  }
  if (kite) {
    const ux = (p.x - tgt.x) / (d || 1), uy = (p.y - tgt.y) / (d || 1);
    if (ux < -0.3) inp.left = true; else if (ux > 0.3) inp.right = true;
    if (uy < -0.3) inp.up = true; else if (uy > 0.3) inp.down = true;
    return true;
  }
  if (d > range || (!ow && !losClear(g, p.x, p.y, tgt.x, tgt.y))) {
    const moving = goTo(g, bot, p, tgt.x, tgt.y, inp);
    if (!moving) {
      bot.avoid.set(tgt.id, bot.frame + 600);
      bot.tgtId = null;
      return false;
    }
    return true;
  }
  inp.left = inp.right = inp.up = inp.down = false;
  p.fx = (tgt.x - p.x) / (d || 1);
  p.fy = (tgt.y - p.y) / (d || 1);
  inp.fire = true;
  if (spec?.kind === 'weapon' && p.specialCool <= 0 && bot.relSpec <= 0 && d <= spec.range * TILE) {
    inp.special = true;
    bot.relSpec = 15;
  }
  return true;
}

// Guard a station: fight anything in the zone, otherwise sit on the post and
// run day chores (chest sweeps). Returns true while combat owns the frame.
function guard(g, bot, p, inp, post, opts = {}) {
  const zoneC = opts.zoneAt ?? post;
  const zoneR = (opts.zoneR ?? 11) * TILE;
  const zone = e => Math.hypot(e.x - zoneC.x, e.y - zoneC.y) < zoneR
    || Math.hypot(e.x - p.x, e.y - p.y) < 5 * TILE || e.engagePid === p.pid;
  if (combat(g, bot, p, inp, { engage: opts.engage ?? 12, zone, prioAt: opts.prioAt ?? zoneC })) return true;
  const day = g.cycle && g.cycle.phase === 'day';
  if (day && opts.chests) {
    const c = g.chests.find(c0 => !c0.opened && opts.chests.some(([cx, cy]) => tx(c0.x) === cx && tx(c0.y) === cy));
    if (c) { actAt(g, bot, p, c.x, c.y, inp); return false; }
  }
  if (!near(p, post.x, post.y, 0.9)) goTo(g, bot, p, post.x, post.y, inp);
  return false;
}

// --- generic mission loop ------------------------------------------------------
function fnv(h, s) { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }

function runMission(def, party, roster, capS, driver, quiet = false) {
  const g = createGame(def, party, charMap, roster);
  const bots = party.map(p => makeBot(p.pid));
  const log = [];
  let hash = 2166136261;
  const ctx = { g, bots, log, state: {}, snapAt0: snapshot(g, false), dawns: [], firstWaveEnemies: null, shardTrace: [] };
  const frames = Math.ceil(capS / DT);
  for (let f = 0; f < frames && g.status === 'play'; f++) {
    const inputs = {};
    for (const bot of bots) {
      const p = g.players[bot.pid];
      bot.relAct--; bot.relFire--; bot.relItem--; bot.relSpec--; bot.frame++;
      const inp = {};
      if (p.state === 'pick') {
        if (bot.relFire <= 0) { inp.fire = true; bot.relFire = 8; }
      }
      inputs[bot.pid] = inp;
    }
    driver(ctx, inputs);
    const shardsBefore = g.shards;
    step(g, inputs, DT);
    if (g.events.length) {
      for (const ev of g.events) {
        log.push({ ...ev, t: g.elapsed });
        if (ev.type === 'beaconLit') ctx.shardTrace.push({ t: g.elapsed, before: shardsBefore, after: g.shards });
        if (ev.type === 'dawn') {
          ctx.dawns.push({ n: ev.nightNo, t: g.elapsed, lit: g.cores ? g.cores.map(c => c.lit) : null, coreHp: g.core ? g.core.hp : null });
          if (!quiet) note(`dawn ${ev.nightNo} t=${g.elapsed.toFixed(0)}s ` + (g.cores ? `lit=[${g.cores.map(c => +c.lit)}] hp=[${g.cores.map(c => c.hp)}]` : `core=${g.core.hp}/30`) + ` shards=${g.shards.toFixed(1)} enemies=${g.enemies.length} squad=[${g.players.map(p => p.state[0] + (p.hp ?? '')).join(' ')}]`);
        }
        if (ev.type === 'dusk' && !quiet) note(`dusk ${ev.nightNo}${ev.bloodMoon ? ' BLOOD MOON' : ''} t=${g.elapsed.toFixed(0)}s shards=${g.shards.toFixed(1)}`);
        if (ev.type === 'wave' && ctx.firstWaveEnemies === null) {
          ctx.firstWaveEnemies = g.enemies.filter(e => e.targetCore).map(e => ({ kind: e.kind, maxHp: e.maxHp, mutation: e.mutation || null }));
        }
        if (!['shoot', 'hitWall', 'hit', 'walk'].includes(ev.type)) {
          hash = fnv(hash, `${ev.type}:${ev.pid ?? ''}:${ev.idx ?? ''}:${Math.round(ev.x ?? 0)},${Math.round(ev.y ?? 0)};`);
        }
      }
      g.events.length = 0;
    }
    if (f % 150 === 0) for (const p of g.players) hash = fnv(hash, `${p.pid}@${Math.round(p.x)},${Math.round(p.y)}hp${p.hp};`);
  }
  ctx.hash = hash;
  return ctx;
}

const ev = (ctx, type) => ctx.log.filter(e => e.type === type);

// ============================== 1. sh01 regression =============================
console.log('--- sh01: The Last Bastion regression (4 starters, 5 nights) ---');
{
  const party = ['scout', 'soldier', 'grenadier', 'medic'].map((id, i) => ({ pid: i, name: id, charId: id }));
  const roster = ['scout', 'soldier', 'grenadier', 'medic'];
  // four gate posts: N, E, S, W of the core at 42,32 (gates at 41/42,24 -
  // 52,32 - 41/42,40 - 32,32). Grenadier takes the N gate (night 1 pours
  // north on the rotation), soldier S, scout E, medic W.
  const core = { x: T(42), y: T(32) };
  const posts = { 2: { x: T(42), y: T(26) }, 1: { x: T(42), y: T(38) }, 0: { x: T(49), y: T(32) }, 3: { x: T(35), y: T(32) } };
  const t0 = Date.now();
  const A = runMission(sh01, party, roster, 1000, (ctx, inputs) => {
    for (const bot of ctx.bots) {
      const p = ctx.g.players[bot.pid];
      if (p.state !== 'active') continue;
      guard(ctx.g, bot, p, inputs[bot.pid], posts[bot.pid], { zoneAt: core, zoneR: 13, engage: 13, prioAt: core });
    }
  });
  console.log(`(run: ${((Date.now() - t0) / 1000).toFixed(1)}s wall, ${A.g.elapsed.toFixed(0)}s sim)`);

  check('sh01 clears at the fifth dawn (still beatable as before)', A.g.status === 'cleared',
    `status='${A.g.status}' elapsed=${A.g.elapsed.toFixed(0)}s core=${A.g.core?.hp}/30`);
  check('sh01: five nights fought (5 dusks, 5 dawns)', ev(A, 'dusk').length === 5 && ev(A, 'dawn').length === 5,
    `${ev(A, 'dusk').length} dusks / ${ev(A, 'dawn').length} dawns`);
  const bloods = ev(A, 'dusk').filter(d => d.bloodMoon).map(d => d.nightNo);
  check('sh01: no blood moons (wave-cap budget 5)', bloods.length === 0, `bloodMoons=[${bloods}]`);
  check('sh01: 5 wave pours (one per night, budget 5)', ev(A, 'wave').length === 5,
    `${ev(A, 'wave').length} wave events: ${ev(A, 'wave').map(w => w.edge).join(',')}`);
  if ((sh01.stronghold?.waves ?? 0) !== 5) {
    issues.push(`sh01 def.stronghold.waves=${sh01.stronghold?.waves} but the sim pours 5 (5 nights, no moons) — the card must say what the sim does`);
    note(`NOTE: def.stronghold.waves=${sh01.stronghold?.waves}, sim poured 5`);
  }
  check('sh01: core survives with hp > 0', (A.g.core?.hp ?? 0) > 0, `core ${A.g.core?.hp}/30`);
  const s0 = A.snapAt0;
  check('sh01: snapshot ships the cycle field at t=0 (day brightness driver: phase/t/nights)',
    s0.cycle && s0.cycle.phase === 'day' && s0.cycle.t === 90 && s0.cycle.nights === 5,
    JSON.stringify(s0.cycle));
  check('sh01: prebuilt wall perimeter in snapshot (66 wall segments, built)',
    s0.builds.filter(b => b.kind === 'wall' && b.built).length === 66,
    `${s0.builds.filter(b => b.kind === 'wall' && b.built).length} prebuilt walls`);
  const husks1 = (A.firstWaveEnemies || []).filter(e => e.kind === 'husk' && !e.mutation);
  check('sh01: no hpMult — unmutated night-1 husks at classic 1 hp',
    husks1.length > 0 && husks1.every(e => e.maxHp === 1),
    `husk maxHp=[${husks1.map(e => e.maxHp)}]`);
  const downs = ev(A, 'down').length;
  note(`downs=${downs}, kills=${A.g.kills}, score=${Math.round(A.g.score)}, shards left=${A.g.shards.toFixed(1)}`);
}

// ====================== 2. sh05 beacon run: win with 2 lit =====================
console.log('\n--- sh05: The Four Lights — defend north pair, relight one south beacon, win with 2 lit ---');
const sh05Roster = ['scout', 'soldier', 'grenadier', 'medic', 'sniper', 'raider', 'pyro']; // starters + sh02/03/04 unlocks
{
  const party = [
    { pid: 0, name: 'Gren', charId: 'grenadier' },
    { pid: 1, name: 'Pyro', charId: 'pyro' },
    { pid: 2, name: 'Snip', charId: 'sniper' },
    { pid: 3, name: 'Sold', charId: 'soldier' },
  ];
  // beacons: 0=(22,16) 1=(62,16) 2=(22,42) 3=(62,42). Defend 0+1; relight 2.
  const b0 = { x: T(22), y: T(16) }, b1 = { x: T(62), y: T(16) };
  const posts = {
    0: { post: { x: T(21), y: T(18) }, at: b0, chests: [[8, 14], [32, 8]] },
    1: { post: { x: T(24), y: T(15) }, at: b0, chests: [[8, 14], [32, 8]] },
    2: { post: { x: T(63), y: T(18) }, at: b1, chests: [[74, 14], [52, 8]] },
    3: { post: { x: T(60), y: T(15) }, at: b1, chests: [[74, 14], [52, 8]] },
  };
  // errand: walk to a stand tile and hold act (relight a dark monolith or
  // raise the redoubt turret); light self-defense only while traveling
  function errand(g, bot, p, inp, gx, gy) {
    if (combat(g, bot, p, inp, { engage: 5, zone: e => Math.hypot(e.x - p.x, e.y - p.y) < 5.5 * TILE })) return;
    if (!near(p, gx, gy, 0.45)) { goTo(g, bot, p, gx, gy, inp); return; }
    inp.act = true; // continuous hold (relight 1.5s / build 6s)
  }
  const turretAt = (g, x, y) => g.builds.find(b => b.kind === 'turret' && tx(b.x) === x && tx(b.y) === y);
  const t0 = Date.now();
  const A = runMission(sh05, party, sh05Roster, 1150, (ctx, inputs) => {
    const { g, state } = ctx;
    const day = g.cycle.phase === 'day';
    if (state.relit2Started && g.cores[2].lit) state.relit2 = true; // contract errand done, exactly once
    for (const bot of ctx.bots) {
      const p = g.players[bot.pid];
      const inp = inputs[bot.pid];
      if (p.state !== 'active') continue;
      const cfg = posts[bot.pid];
      const ownIdx = bot.pid < 2 ? 0 : 1;
      if (day && g.cycle.t > 25) {
        // pid 1: the contract errand — relight south beacon 2 ONCE (8 shards)
        if (bot.pid === 1 && !state.relit2 && !g.cores[2].lit && g.shards >= 10) {
          state.relit2Started = true;
          errand(g, bot, p, inp, T(22), T(43));
          continue;
        }
        // pids 0/2: keep the DEFENDED pair burning (relight own when dark —
        // a relight resets the monolith to FULL hp, the only heal it has)
        if ((bot.pid === 0 || bot.pid === 2) && !g.cores[ownIdx].lit && g.shards >= 9) {
          errand(g, bot, p, inp, ownIdx === 0 ? T(21) : T(63), T(16));
          continue;
        }
        // pids 0/3: raise then upgrade the redoubt turret by the monolith
        const siteX = ownIdx === 0 ? 22 : 62;
        const tu = turretAt(g, siteX, 14);
        // stand NORTH of the site: the lit monolith sits 3 tiles off, out of
        // act reach, so the build/upgrade hold can never charge THE HORN
        if ((bot.pid === 0 || bot.pid === 3) && tu) {
          if (!tu.built && g.shards >= 18) { errand(g, bot, p, inp, T(siteX), T(13)); continue; }
          if (tu.built && !tu.typeSelect && (tu.level || 1) < 3 && g.shards >= (tu.level || 1) * 8 + 12) {
            errand(g, bot, p, inp, T(siteX), T(13));
            continue;
          }
        }
      }
      guard(g, bot, p, inp, cfg.post, { zoneAt: cfg.at, zoneR: 12, engage: 13, prioAt: cfg.at, chests: cfg.chests });
    }
  });
  console.log(`(run: ${((Date.now() - t0) / 1000).toFixed(1)}s wall, ${A.g.elapsed.toFixed(0)}s sim)`);

  const litEnd = A.g.cores.map(c => c.lit);
  check('sh05 win run: cleared at the fourth dawn', A.g.status === 'cleared' && ev(A, 'dawn').length === 4,
    `status='${A.g.status}' dawns=${ev(A, 'dawn').length} elapsed=${A.g.elapsed.toFixed(0)}s`);
  check('sh05 win run: exactly the two defended beacons lit at the end', litEnd.join() === 'true,true,false,false',
    `lit=[${litEnd}]`);
  const downsEv = ev(A, 'beaconDown');
  check('sh05 win run: south beacons fell (beaconDown events, idx 2 and 3)',
    downsEv.some(e => e.idx === 2) && downsEv.some(e => e.idx === 3),
    `beaconDown idx=[${downsEv.map(e => e.idx)}] at t=[${downsEv.map(e => e.t.toFixed(0))}]`);
  const lit = ev(A, 'beaconLit');
  check('sh05 win run: fallen beacon 2 relit by a daytime act-hold', lit.some(e => e.idx === 2),
    `beaconLit=[${lit.map(e => 'idx' + e.idx + '@' + e.t.toFixed(0) + 's')}]`);
  const litDayOk = lit.every(e => {
    const dusks = ev(A, 'dusk').filter(d => d.t <= e.t).length;
    const dawns = ev(A, 'dawn').filter(d => d.t <= e.t).length;
    return dusks === dawns; // equal counts => daytime
  });
  check('sh05 win run: every relight happened during DAY', lit.length > 0 && litDayOk);
  check('sh05 win run: relight paid 8 shards from the pool',
    A.shardTrace.length > 0 && A.shardTrace.every(s => s.before - s.after > 7.5 && s.before - s.after <= 9),
    A.shardTrace.map(s => `${s.before.toFixed(1)}->${s.after.toFixed(1)}`).join(' '));
  // all four monoliths survive night 1 here, so the Anchorcraft lands at
  // dusk 2 — and the squad IGNORES it: boarding must stay optional, the
  // landed ship must persist, and the mission must still run to the dawn.
  check('sh05 win run: landed Anchorcraft is optional (shipDown, zero boards, no launch, played to the final dawn)',
    ev(A, 'shipDown').length === 1 && ev(A, 'shipBoard').length === 0 && ev(A, 'shipLaunch').length === 0 && !!A.g.ship,
    `shipDown=${ev(A, 'shipDown').length} boards=${ev(A, 'shipBoard').length} launch=${ev(A, 'shipLaunch').length} ship persists=${!!A.g.ship}`);
  const coreHits = ev(A, 'coreHit');
  check('sh05 win run: coreHit events carry the beacon idx for HUD pips', coreHits.length > 0 && coreHits.every(e => e.idx !== undefined),
    `${coreHits.length} hits across idx ${[...new Set(coreHits.map(e => e.idx))].sort().join(',')}`);
  const s0 = A.snapAt0;
  check('sh05: snapshot ships 4 cores with lit flags + cycle (nights=4) + ambience passthrough',
    s0.cores?.length === 4 && s0.cores.every(c => c.lit === true) && s0.cycle?.nights === 4 && s0.ambience === 'meadow',
    `cores=${s0.cores?.length} ambience=${s0.ambience}`);
  const husks5 = (A.firstWaveEnemies || []).filter(e => e.kind === 'husk' && !e.mutation);
  check('sh05: hpMult 1.13 applied — unmutated night-1 wave husks at 2 hp (classic 1)',
    husks5.length > 0 && husks5.every(e => e.maxHp === 2),
    `husk maxHp=[${husks5.map(e => e.maxHp)}]`);
  check('sh05: 5 wave pours (4 nights + the night-3 blood-moon double) — matches def.stronghold.waves',
    ev(A, 'wave').length === 5 && sh05.stronghold.waves === 5,
    `${ev(A, 'wave').length} pours, def says ${sh05.stronghold.waves}`);
  const bloods = ev(A, 'dusk').filter(d => d.bloodMoon).map(d => d.nightNo);
  check('sh05: blood moon on night 3', bloods.join() === '3', `[${bloods}]`);
  note(`downs=${ev(A, 'down').length}, kills=${A.g.kills}, score=${Math.round(A.g.score)}`);
}

// ============================ 3. sh05 loss: all dark ===========================
console.log('\n--- sh05: loss run — squad guards only itself in the keep, all four beacons go dark ---');
{
  const party = [
    { pid: 0, name: 'Idle1', charId: 'scout' },
    { pid: 1, name: 'Idle2', charId: 'medic' },
  ];
  const t0 = Date.now();
  // self-defense only (the day-event scavenger probes prowl the keep ring
  // now, so a truly idle squad gets eaten) — but NOBODY tends a beacon
  const A = runMission(sh05, party, sh05Roster, 500, (ctx, inputs) => {
    for (const bot of ctx.bots) {
      const p = ctx.g.players[bot.pid];
      if (p.state !== 'active') continue;
      combat(ctx.g, bot, p, inputs[bot.pid], { engage: 9, zone: e => Math.hypot(e.x - p.x, e.y - p.y) < 9 * TILE });
    }
  });
  console.log(`(run: ${((Date.now() - t0) / 1000).toFixed(1)}s wall, ${A.g.elapsed.toFixed(0)}s sim)`);

  check('sh05 loss run: mission FAILS once all four beacons are dark', A.g.status === 'failed',
    `status='${A.g.status}' at t=${A.g.elapsed.toFixed(0)}s`);
  check('sh05 loss run: allDark + fail events emitted', ev(A, 'allDark').length === 1 && ev(A, 'fail').length === 1);
  check('sh05 loss run: all four beaconDown events, every core dark at the end',
    new Set(ev(A, 'beaconDown').map(e => e.idx)).size === 4 && A.g.cores.every(c => !c.lit),
    `idx=[${ev(A, 'beaconDown').map(e => e.idx)}]`);
  check('sh05 loss run: loss was beacon-driven, not a squad wipe (both players still standing)',
    A.g.players.every(p => p.state === 'active'),
    A.g.players.map(p => p.state).join(','));
  check('sh05 loss run: single dark beacons never fail it (fail only after the 4th)',
    ev(A, 'beaconDown').length === 4 && ev(A, 'beaconDown')[3].t <= ev(A, 'fail')[0].t + 0.1);
}

// ===================== 4. sh05 early extraction: the Anchorcraft ===============
console.log('\n--- sh05: early extraction — all four lit through night 2, board the Anchorcraft ---');
function extractionDriver(ctx, inputs) {
  const { g, state } = ctx;
  // one guardian per beacon through night 1; the squad PRE-GATHERS at the
  // keep in the back half of day 2, then boards the moment the ship is down
  const beacons = [[22, 16], [62, 16], [22, 42], [62, 42]];
  const gathers = [[40, 28], [41, 27], [40, 30], [41, 29]]; // keep courtyard, clear of the stag/hires
  const farFromVehicles = (x, y) => g.vehicles.every(v => Math.hypot(v.x - x, v.y - y) >= 1.8 * TILE);
  for (const bot of ctx.bots) {
    const p = g.players[bot.pid];
    const inp = inputs[bot.pid];
    if (p.state !== 'active' || p.aboard) continue;
    if (g.ship) {
      // boarding is EDGE-triggered and the LOWEST rung of the act chain, so
      // the press must land on a spot clear of every other act claimant
      // (vehicles, hire posts, chests, towers, build sites, npcs, pickups) —
      // and it must be TAPPED, not held, so a stolen edge simply retries
      const clearOfClaimants = (x, y) => {
        const r = 1.7 * TILE;
        const away = o => Math.hypot(o.x - x, o.y - y) >= r;
        return g.vehicles.every(away)
          && g.hires.every(h => h.hired || away(h))
          && g.chests.every(c => c.opened || away(c))
          && g.towers.every(away)
          && g.builds.every(away)
          && g.shops.every(away) // the stall HOLD-claims an act inside 1.5 tiles
          && (g.npcs || []).every(away)
          && (g.pickups || []).every(away);
      };
      if (Math.hypot(p.x - g.ship.x, p.y - g.ship.y) < 1.35 * TILE && clearOfClaimants(p.x, p.y)) {
        bot.boardTap = (bot.boardTap || 0) + 1;
        if (bot.boardTap % 6 < 2) inp.act = true; // 2-on/4-off taps: fresh edges
        continue;
      }
      if (!state.boardSpots) {
        // claimant-safe STAND POINTS on a ring inside tap range (1.25 of the
        // 1.35-tile board reach): the keep's own turret site sits one tile
        // off the landing spot, so tile-center neighbors are never clear of
        // every act claimant — sweep spaced angles (south arc first) and
        // keep the points whose whole tap gate (walkable + clear) passes
        state.boardSpots = [];
        for (const k of [4, 5, 6, 7, 3, 8, 2, 9, 1, 10, 0, 11, 15, 12, 14, 13]) { // south arc first
          const a = (k / 16) * Math.PI * 2;
          const x = g.ship.x + Math.cos(a) * 1.25 * TILE;
          const y = g.ship.y + Math.sin(a) * 1.25 * TILE;
          if (!blockedAt(g, tx(x), tx(y)) && clearOfClaimants(x, y)) state.boardSpots.push([x, y]);
          if (state.boardSpots.length >= 4) break;
        }
        if (!state.boardSpots.length) state.boardSpots = [[g.ship.x - 1.25 * TILE, g.ship.y]];
      }
      const [gx, gy] = state.boardSpots[bot.pid % state.boardSpots.length];
      // one tap from extraction: fight only what is literally on top of us
      if (combat(g, bot, p, inp, { engage: 1.2, zone: e => Math.hypot(e.x - p.x, e.y - p.y) < 1.2 * TILE })) continue;
      const dSpot = Math.hypot(p.x - gx, p.y - gy);
      // beyond a tile: pathfind. Inside one: walk straight — planPath works in
      // tiles, so a bot already in the spot's tile would otherwise stall there
      if (dSpot > TILE * 1.0) { goTo(g, bot, p, gx, gy, inp); continue; }
      // close in: shuffle PRECISELY onto the clear stand point — goTo's
      // arrival slack (~0.45 tiles) can strand a bot just outside the
      // 1.35-tile board reach, frozen forever
      if (dSpot > TILE * 0.06) {
        inp.left = gx < p.x - 2; inp.right = gx > p.x + 2;
        inp.up = gy < p.y - 2; inp.down = gy > p.y + 2;
      }
      continue;
    }
    const [bx, by] = beacons[bot.pid];
    const at = { x: T(bx), y: T(by) };
    const day2 = g.cycle.phase === 'day' && g.cycle.nightNo === 1;
    let zoneClear = true;
    for (const e of g.enemies) {
      if (!e.dead && Math.hypot(e.x - at.x, e.y - at.y) < 12 * TILE) { zoneClear = false; break; }
    }
    if (day2 && g.cycle.t < 55 && zoneClear) {
      // pre-gather at the keep: the ship will touch down by the monolith
      // centroid the instant night 2 opens with all four lit
      const [gx, gy] = gathers[bot.pid];
      if (!near(p, T(gx), T(gy), 0.5)) {
        // wider engage: the day-event probes bed down on this very ring and
        // must be cleared before the boarding scramble
        if (combat(g, bot, p, inp, { engage: 8, zone: e => Math.hypot(e.x - p.x, e.y - p.y) < 8 * TILE })) continue;
        goTo(g, bot, p, T(gx), T(gy), inp);
      } else if (combat(g, bot, p, inp, { engage: 8, zone: e => Math.hypot(e.x - p.x, e.y - p.y) < 8 * TILE })) continue;
      continue;
    }
    guard(g, bot, p, inp, { x: T(bx), y: T(by + 2) }, { zoneAt: at, zoneR: 10, engage: 12, prioAt: at });
  }
  if (g.ship && !state.shipAt) state.shipAt = { t: g.elapsed, night: g.cycle.nightNo, phase: g.cycle.phase, lit: g.cores.map(c => c.lit).join() };
  if (g.ship && process.env.EXDBG && Math.floor(g.elapsed * 30) % 90 === 0) {
    const f = v => (v / TILE).toFixed(2);
    console.log(`t=${g.elapsed.toFixed(1)} spots=${(state.boardSpots || []).map(sp => f(sp[0]) + ',' + f(sp[1])).join(' | ')} ` + g.players.map(pp => `${pp.pid}:${pp.state[0]}${pp.aboard ? 'A' : ''}@${f(pp.x)},${f(pp.y)}`).join('  '));
  }
}
{
  const party = [
    { pid: 0, name: 'NW', charId: 'grenadier' },
    { pid: 1, name: 'NE', charId: 'sniper' },
    { pid: 2, name: 'SW', charId: 'pyro' },
    { pid: 3, name: 'SE', charId: 'soldier' },
  ];
  const t0 = Date.now();
  const A = runMission(sh05, party, sh05Roster, 600, extractionDriver);
  console.log(`(run: ${((Date.now() - t0) / 1000).toFixed(1)}s wall, ${A.g.elapsed.toFixed(0)}s sim)`);

  const down = ev(A, 'shipDown');
  check('extraction: the Anchorcraft lands (shipDown) once night 2 opens with all four lit',
    down.length === 1 && A.state.shipAt?.night === 2 && A.state.shipAt?.phase === 'night' && A.state.shipAt?.lit === 'true,true,true,true',
    down.length ? `landed t=${down[0].t.toFixed(0)}s night=${A.state.shipAt?.night} lit=[${A.state.shipAt?.lit}]` : 'never landed');
  const dusk2 = ev(A, 'dusk').find(d => d.nightNo === 2);
  check('extraction: no landing during night 1 (all four were lit then too)',
    down.length === 1 && dusk2 && down[0].t >= dusk2.t - 0.1,
    down.length && dusk2 ? `shipDown t=${down[0].t.toFixed(1)} vs dusk2 t=${dusk2.t.toFixed(1)}` : '');
  check('extraction: every operative boards (4 shipBoard events)',
    new Set(ev(A, 'shipBoard').map(e => e.pid)).size === 4,
    `boarded pids=[${[...new Set(ev(A, 'shipBoard').map(e => e.pid))]}]`);
  const launch = ev(A, 'shipLaunch');
  check('extraction: shipLaunch fires with the 2000-point full-clear bonus',
    launch.length === 1 && launch[0].points === 2000, JSON.stringify(launch[0] ?? null));
  check('extraction: mission cleared EARLY (before night 2 would even end)',
    A.g.status === 'cleared' && ev(A, 'dawn').length === 1 && A.g.elapsed < 90 + 2 * (75 + 90),
    `cleared at t=${A.g.elapsed.toFixed(0)}s of a ~990s full run, dawns=${ev(A, 'dawn').length}`);
  check('extraction: score banked the bonus', A.g.score >= 2000, `score=${Math.round(A.g.score)}`);
  check('extraction: all players extracted by the launch', A.g.players.every(p => p.state === 'extracted'),
    A.g.players.map(p => p.state).join(','));

  // determinism: replay the whole extraction byte-for-byte
  const B = runMission(sh05, party, sh05Roster, 600, extractionDriver, true);
  check('extraction: full-run determinism (event hash + elapsed identical on rerun)',
    A.hash === B.hash && Math.abs(A.g.elapsed - B.g.elapsed) < 1e-9 && A.log.length === B.log.length,
    `hashes ${A.hash.toString(16)}/${B.hash.toString(16)}, events ${A.log.length}/${B.log.length}`);
}

const failed = checks.filter(c => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (issues.length) { console.log('issues:'); for (const i of issues) console.log('  - ' + i); }
process.exitCode = failed.length ? 1 : 0;
