// Headless playtest: BATTLE ROYALE (level22-br.json, "The Shattering").
// Six scripted operatives with distinct strategies drive a full match through
// the real sim (shared/game.js). Deterministic: no Math.random anywhere.
//
//   pid 0  RUSHER      scout   loots near center early, then hunts the nearest player
//   pid 1  LOOTER      medic   zone-aware chest route, fights back, uses items, throws a cracker
//   pid 2  CAMPER      sniper  never moves from the NE corner spawn -> the zone must kill him
//   pid 3  EDGE-RUNNER shade   orbits just inside the closing zone wall
//   pid 4  SKIFF-RAIDER raider boards the skiff, loots the lake islet before shrink 2
//   pid 5  SHOPPER     volt    walks to the stall, buys with the shared pool, then brawls
//
// Scenario B: a duo of mutual avoiders (never fire) must still end via the zone.
// Scenario C: stalemate probe — two zone-hugging pacifists inside the final ring.
//
// Run: node scripts/playtest-br.mjs   (exit 0 = all checks pass)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { applyResults, charsById, createGame, snapshot, step, TILE } from '../shared/game.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const brDef = JSON.parse(fs.readFileSync(path.join(root, 'levels/br/level22-br.json'), 'utf8'));
const classicDef = JSON.parse(fs.readFileSync(path.join(root, 'levels/classic/level01.json'), 'utf8'));
const characters = JSON.parse(fs.readFileSync(path.join(root, 'shared/characters.json'), 'utf8'));
const charMap = charsById(characters);

const DT = 1 / 30;
const checks = [];
const issues = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) issues.push(`${name}${detail ? ' (' + detail + ')' : ''}`);
}
function note(msg) { console.log('      ' + msg); }

// --- tiny deterministic helpers ---------------------------------------------
const footBlocked = c => c === '#' || c === 'T' || c === '~' || c === 'o';
const tile = (g, x, y) => g.grid[y]?.[x] ?? '#';

// BFS distance field over foot-walkable tiles from a px position.
function bfsField(g, px, py) {
  const sx = Math.floor(px / TILE), sy = Math.floor(py / TILE);
  const dist = new Int32Array(g.w * g.h).fill(-1);
  const prev = new Int32Array(g.w * g.h).fill(-1);
  const q = [sy * g.w + sx];
  dist[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const cur = q[h], cx = cur % g.w, cy = (cur / g.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      const ni = ny * g.w + nx;
      if (dist[ni] !== -1 || footBlocked(tile(g, nx, ny))) continue;
      dist[ni] = dist[cur] + 1;
      prev[ni] = cur;
      q.push(ni);
    }
  }
  return { dist, prev };
}

// Path of px waypoints toward (gx,gy) px; if the goal tile is unreachable,
// walk to the reachable tile nearest to it (stable argmin -> deterministic).
function planPath(g, p, gx, gy) {
  const { dist, prev } = bfsField(g, p.x, p.y);
  const gtx = Math.floor(gx / TILE), gty = Math.floor(gy / TILE);
  let best = -1, bestScore = Infinity;
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] === -1) continue;
    const tx = i % g.w, ty = (i / g.w) | 0;
    const d = Math.hypot(tx - gtx, ty - gty) * 10 + dist[i] * 0.05;
    if (d < bestScore) { bestScore = d; best = i; }
  }
  if (best === -1) return [];
  const rev = [];
  for (let i = best; i !== -1; i = prev[i]) rev.push(i);
  rev.reverse();
  return rev.slice(1).map(i => ({ x: ((i % g.w) + 0.5) * TILE, y: (((i / g.w) | 0) + 0.5) * TILE }));
}

function losClear(g, ax, ay, bx, by) {
  const d = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(d / 12));
  for (let i = 1; i < steps; i++) {
    const c = tile(g, Math.floor((ax + (bx - ax) * (i / steps)) / TILE), Math.floor((ay + (by - ay) * (i / steps)) / TILE));
    if (c === '#' || c === 'T') return false;
  }
  return true;
}

// --- bot chassis --------------------------------------------------------------
function makeBot(pid, brain) {
  return { pid, brain, path: [], repath: 0, prevAct: false, prevItem: false, prevFire: false, mem: {} };
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

function aimFire(g, p, tgt, inp, rangeT) {
  const d = Math.hypot(tgt.x - p.x, tgt.y - p.y);
  if (d < rangeT * TILE && losClear(g, p.x, p.y, tgt.x, tgt.y)) {
    p.fx = (tgt.x - p.x) / (d || 1);
    p.fy = (tgt.y - p.y) / (d || 1);
    inp.fire = true;
    inp.left = inp.right = inp.up = inp.down = false; // hold ground so facing sticks
    return true;
  }
  return false;
}

function nearestFoe(g, p) {
  let best = null, bd = Infinity;
  for (const q of g.players) {
    if (q.pid === p.pid || q.state !== 'active') continue;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bd) { bd = d; best = q; }
  }
  return [best, bd];
}

function nearestChest(g, p, insideZone) {
  let best = null, bd = Infinity;
  for (const c of g.chests) {
    if (c.opened) continue;
    if (insideZone && g.zone && Math.hypot(c.x - g.zone.x, c.y - g.zone.y) > g.zone.targetR * 0.92) continue;
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function useItems(bot, p, inp) {
  const want = p.item && p.item.count > 0
    && ((p.item.kind === 'medkit' && p.hp < p.maxHp) || (p.item.kind === 'shield' && p.shield < 2));
  if (want && !bot.prevItem) inp.item = true;
}

function huntBrain(g, bot, p, inp) {
  const [foe, d] = nearestFoe(g, p);
  useItems(bot, p, inp);
  if (!foe) return;
  const ch = charMap[p.charId];
  if (!aimFire(g, p, foe, inp, (ch.weapon.range ?? 5) * 0.92)) goTo(g, bot, p, foe.x, foe.y, inp);
  else if (d > TILE * 1.2 && !inp.fire) goTo(g, bot, p, foe.x, foe.y, inp);
}

// --- the six strategies -------------------------------------------------------
const brains = {
  rusher(g, bot, p, inp) {
    if (g.elapsed < 75) { // play the zone first: loot near the center
      const c = nearestChest(g, p, true);
      if (c) {
        if (Math.hypot(c.x - p.x, c.y - p.y) < TILE * 1.2) { if (!bot.prevAct) inp.act = true; }
        else goTo(g, bot, p, c.x, c.y, inp);
      }
      useItems(bot, p, inp);
      return;
    }
    huntBrain(g, bot, p, inp);
  },

  looter(g, bot, p, inp) {
    useItems(bot, p, inp);
    // one cracker probe mid-match: lob it to confirm the event flow sans enemies
    if (!bot.mem.crackered && p.item && p.item.kind === 'cracker' && g.elapsed > 30) {
      if (!bot.prevItem) { inp.item = true; bot.mem.crackered = true; return; }
    }
    const [foe, d] = nearestFoe(g, p);
    if (foe && d < TILE * 5) { aimFire(g, p, foe, inp, 5); return; } // fight back
    const c = nearestChest(g, p, true);
    if (!c || g.elapsed > 280) { huntBrain(g, bot, p, inp); return; }
    if (Math.hypot(c.x - p.x, c.y - p.y) < TILE * 1.2) { if (!bot.prevAct) inp.act = true; }
    else goTo(g, bot, p, c.x, c.y, inp);
  },

  camper(g, bot, p, inp) { // holds the corner; the zone is his judge
    const [foe] = nearestFoe(g, p);
    if (foe) aimFire(g, p, foe, inp, 11);
  },

  edgeRunner(g, bot, p, inp) {
    useItems(bot, p, inp);
    const z = g.zone;
    const ang = Math.atan2(p.y - z.y, p.x - z.x) + 0.22;
    const r = Math.max(TILE * 2, Math.min(z.r - TILE * 1.5, TILE * 30));
    const gx = Math.max(TILE, Math.min((g.w - 1) * TILE, z.x + Math.cos(ang) * r));
    const gy = Math.max(TILE, Math.min((g.h - 1) * TILE, z.y + Math.sin(ang) * r));
    const [foe, d] = nearestFoe(g, p);
    if (foe && d < TILE * 4.5 && aimFire(g, p, foe, inp, 7.5)) return;
    goTo(g, bot, p, gx, gy, inp);
  },

  skiffRaider(g, bot, p, inp) {
    const m = bot.mem;
    m.stage = m.stage ?? 0;
    const skiff = g.vehicles.find(v => v.kind === 'skiff');
    useItems(bot, p, inp);
    if (m.stage === 0) { // walk to the west shore, board
      if (p.riding) { m.stage = 1; return; }
      if (Math.hypot(skiff.x - p.x, skiff.y - p.y) < TILE * 1.2) { if (!bot.prevAct) inp.act = true; }
      else goTo(g, bot, p, skiff.x, skiff.y, inp);
    } else if (m.stage === 1) { // sail east to the water tile beside the islet chest
      const tx = (50 + 0.5) * TILE, ty = (54 + 0.5) * TILE;
      if (!p.riding) { m.stage = 2; return; }
      if (Math.abs(p.x - tx) < 8 && Math.abs(p.y - ty) < 8) { if (!bot.prevAct) inp.act = true; } // step ashore
      else {
        if (tx < p.x - 4) inp.left = true; else if (tx > p.x + 4) inp.right = true;
        if (ty < p.y - 4) inp.up = true; else if (ty > p.y + 4) inp.down = true;
      }
    } else if (m.stage === 2) { // loot the islet pair
      const c = nearestChest(g, p, false);
      const onIslet = c && Math.hypot(c.x - p.x, c.y - p.y) < TILE * 6;
      if (!onIslet) { m.stage = 3; return; }
      if (Math.hypot(c.x - p.x, c.y - p.y) < TILE * 1.2) { if (!bot.prevAct) inp.act = true; }
      else goTo(g, bot, p, c.x, c.y, inp);
    } else { // off the islet over the ford, then play the man
      // cracker probe: lob one as soon as the loot route hands us crackers
      if (!m.crackered && p.item && p.item.kind === 'cracker' && p.item.count > 0) {
        if (!bot.prevItem) { inp.item = true; m.crackered = true; return; }
      }
      if (g.elapsed < 200) { const c = nearestChest(g, p, true); if (c) { if (Math.hypot(c.x - p.x, c.y - p.y) < TILE * 1.2) { if (!bot.prevAct) inp.act = true; } else goTo(g, bot, p, c.x, c.y, inp); return; } }
      huntBrain(g, bot, p, inp);
    }
  },

  shopper(g, bot, p, inp) {
    const m = bot.mem;
    useItems(bot, p, inp);
    if (!m.bought && g.elapsed < 240) {
      const s = g.shops[0];
      if (Math.hypot(s.x - p.x, s.y - p.y) >= TILE * 1.2) { goTo(g, bot, p, s.x, s.y, inp); return; }
      inp.act = true; // hold the stall open
      if (!p.shopping) return; // opens next frame
      const wantIdx = g.shards >= 12 ? 1 : g.shards >= 10 ? 3 : 2; // shield > medkit > crackers
      m.tick = (m.tick ?? 0) + 1;
      if (m.tick % 12 !== 0) return; // give edges room to release
      if ((p.shopIdx ?? 0) !== wantIdx) { inp.right = true; return; }
      if (g.shards >= [20, 12, 8, 10][wantIdx]) { inp.fire = true; m.bought = true; }
      else if (g.elapsed > 200) m.bought = true; // pool never filled: give up, brawl
      return;
    }
    huntBrain(g, bot, p, inp);
  },
};

// pacifists for scenario B/C
function avoiderBrain(minSepTiles, hugZone) {
  return (g, bot, p, inp) => {
    const [foe, d] = nearestFoe(g, p);
    const z = g.zone;
    if (foe && d < minSepTiles * TILE) { // back away, even out of the zone
      const ux = (p.x - foe.x) / (d || 1), uy = (p.y - foe.y) / (d || 1);
      const gx = Math.max(TILE, Math.min((g.w - 1) * TILE, foe.x + ux * minSepTiles * TILE));
      const gy = Math.max(TILE, Math.min((g.h - 1) * TILE, foe.y + uy * minSepTiles * TILE));
      goTo(g, bot, p, gx, gy, inp);
      return;
    }
    if (hugZone) { // drift to a personal anchor inside the safe ring
      const ang = Math.atan2(p.y - z.y, p.x - z.x);
      const r = Math.max(TILE, Math.min(z.r - TILE * 1.2, TILE * 28));
      goTo(g, bot, p, z.x + Math.cos(ang) * r, z.y + Math.sin(ang) * r, inp);
    }
  };
}

// --- match runner ---------------------------------------------------------------
function fnv(h, s) { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }

function runMatch(def, party, bots, capSeconds) {
  const g = createGame(def, party, charMap, party.map(q => q.charId));
  const log = [];
  let hash = 2166136261;
  const frames = Math.ceil(capSeconds / DT);
  for (let f = 0; f < frames && g.status === 'play'; f++) {
    const inputs = {};
    for (const bot of bots) {
      const p = g.players[bot.pid];
      const inp = {};
      if (p.state === 'active') bot.brain(g, bot, p, inp);
      bot.prevAct = !!inp.act; bot.prevItem = !!inp.item; bot.prevFire = !!inp.fire;
      inputs[bot.pid] = inp;
    }
    step(g, inputs, DT);
    if (process.env.BR_DEBUG && f % 30 === 0 && g.elapsed < +process.env.BR_DEBUG) {
      console.log('t=' + g.elapsed.toFixed(1), g.players.map(p => `${p.pid}:${p.state[0]}hp${p.hp}@${(p.x / TILE).toFixed(0)},${(p.y / TILE).toFixed(0)}`).join(' '));
    }
    if (g.events.length) {
      for (const ev of g.events) {
        if (process.env.BR_DEBUG && g.elapsed < +process.env.BR_DEBUG && ['playerHit', 'eliminated', 'shoot', 'chest', 'mount', 'dismount'].includes(ev.type)) {
          console.log('  EV t=' + g.elapsed.toFixed(2), JSON.stringify(ev));
        }
        const rec = { ...ev, t: g.elapsed }; // our wall-clock wins (zoneShrink has its own t = duration)
        if (ev.type === 'playerHit' || ev.type === 'eliminated') {
          const q = g.players[ev.pid];
          rec.outside = g.zone ? Math.hypot(q.x - g.zone.x, q.y - g.zone.y) > g.zone.r - 1 : false;
          rec.zoneR = g.zone?.r;
        }
        log.push(rec);
        if (ev.type !== 'shoot' && ev.type !== 'hitWall') {
          hash = fnv(hash, `${ev.type}:${ev.pid ?? ''}:${Math.round(ev.x ?? 0)},${Math.round(ev.y ?? 0)};`);
        }
      }
      g.events.length = 0;
    }
    if (f % 60 === 0) for (const p of g.players) hash = fnv(hash, `${p.pid}:${Math.round(p.x)},${Math.round(p.y)},${p.hp ?? ''};`);
  }
  return { g, log, hash, snap: snapshot(g) };
}

const PARTY6 = [
  { pid: 0, name: 'Rusher', charId: 'scout' },
  { pid: 1, name: 'Looter', charId: 'medic' },
  { pid: 2, name: 'Camper', charId: 'sniper' },
  { pid: 3, name: 'EdgeRunner', charId: 'shade' },
  { pid: 4, name: 'SkiffRaider', charId: 'raider' },
  { pid: 5, name: 'Shopper', charId: 'volt' },
];
const BOTS6 = () => [
  makeBot(0, brains.rusher), makeBot(1, brains.looter), makeBot(2, brains.camper),
  makeBot(3, brains.edgeRunner), makeBot(4, brains.skiffRaider), makeBot(5, brains.shopper),
];

// =============================== SCENARIO A: 6-way match =========================
console.log('--- BR playtest: 6-operative match (rusher/looter/camper/edge-runner/skiff-raider/shopper) ---');
const runs = [runMatch(brDef, PARTY6, BOTS6(), 600), runMatch(brDef, PARTY6, BOTS6(), 600), runMatch(brDef, PARTY6, BOTS6(), 600)];
const A = runs[0];

check('match resolves (status cleared, winner declared)', A.g.status === 'cleared' && A.g.winner !== undefined,
  `winner pid ${A.g.winner} (${PARTY6[A.g.winner]?.name}) at t=${A.g.elapsed.toFixed(1)}s`);
check('BR fields no AI enemies', A.g.enemies.length === 0);

// determinism across reruns
check('winner + event stream deterministic across 3 reruns',
  runs.every(r => r.g.winner === A.g.winner && r.hash === A.hash && r.log.length === A.log.length),
  `hashes ${runs.map(r => r.hash.toString(16)).join(' / ')}`);

// eliminations feed events
const elims = A.log.filter(e => e.type === 'eliminated');
const remSeq = elims.map(e => e.remaining);
check('eliminated events fire with decreasing remaining',
  elims.length === 5 && remSeq.every((r, i) => r === 5 - i),
  `order: ${elims.map(e => `${PARTY6[e.pid].name}@${e.t.toFixed(0)}s rem=${e.remaining}`).join(', ')}`);
const endEv = A.log.find(e => e.type === 'matchEnd');
check('matchEnd event carries the winner', !!endEv && endEv.winner === A.g.winner);

// camper dies to the zone, outside it
const camperElim = elims.find(e => e.pid === 2);
const camperHits = A.log.filter(e => e.type === 'playerHit' && e.pid === 2);
check('zone kills the corner camper', !!camperElim && camperElim.outside === true,
  camperElim ? `eliminated t=${camperElim.t.toFixed(1)}s, outside zone (r=${(camperElim.zoneR / TILE).toFixed(1)}t)` : 'camper survived?!');
check('every hit on the camper landed outside the zone (no other damage source reached him)',
  camperHits.length >= 2 && camperHits.every(e => e.outside),
  `${camperHits.length} zone ticks before death`);

// chest economy
const chestEvs = A.log.filter(e => e.type === 'chest');
const lootMix = chestEvs.reduce((m, e) => (m[e.loot] = (m[e.loot] || 0) + 1, m), {});
const shardGain = chestEvs.filter(e => e.loot === 'shards').reduce((s, e) => s + e.amount, 0);
check('chest economy is exercised (>=10 of 23 chests opened, multiple loot kinds)',
  chestEvs.length >= 10 && Object.keys(lootMix).length >= 3,
  `${chestEvs.length} opened ${JSON.stringify(lootMix)}, +${shardGain} shards to the pool`);
const buyEvs = A.log.filter(e => e.type === 'buy');
check('shop purchase lands (buy event from the shopper)', buyEvs.length >= 1,
  buyEvs.map(e => `${e.what} for ${e.cost} by pid${e.pid} @${e.t.toFixed(0)}s`).join(', ') || 'no buy event');
// quirk probe: the same act press that opens the stall also runs the world act
// chain, so the chest one tile below the shop pops open "for free"
const shopChest = A.log.find(e => e.type === 'chest' && e.pid === 5
  && Math.hypot(e.x - 36.5 * TILE, e.y - 31.5 * TILE) < TILE * 1.7);
if (shopChest) note(`QUIRK: shopper's stall-opening act press also opened the adjacent chest (${shopChest.loot}) @${shopChest.t.toFixed(1)}s`);

// skiff islet route
const mountEvs = A.log.filter(e => e.type === 'mount' && e.kind === 'skiff' && e.pid === 4);
const isletChests = A.log.filter(e => e.type === 'chest' && e.pid === 4 && (e.loot === 'token' || e.loot === 'shield')
  && Math.hypot(e.x - 51.5 * TILE, e.y - 54.5 * TILE) < TILE * 4);
const shrink2 = A.log.find(e => e.type === 'zoneShrink' && Math.abs(e.r - 20.42 * TILE) < 2);
check('skiff islet loot route viable before shrink 2',
  mountEvs.length >= 1 && isletChests.length >= 2 && isletChests.every(e => e.t < 150),
  `mounted @${mountEvs[0]?.t.toFixed(1)}s, islet chests @${isletChests.map(e => e.t.toFixed(1) + 's (' + e.loot + ')').join(', ')}; shrink2 ${shrink2 ? '@' + shrink2.t.toFixed(0) + 's' : 'never fired (match ended first)'}`);

// cracker probe: lure flows fire, boom hurts nobody in pvp
const crOut = A.log.filter(e => e.type === 'crackerOut');
const crBoom = A.log.filter(e => e.type === 'crackerBoom');
const boomHits = A.log.filter(e => e.type === 'playerHit' && crBoom.some(b => Math.abs(b.t - e.t) < 0.1 && Math.hypot(b.x - e.x, b.y - e.y) < TILE * 1.7));
check('cracker probe: crackerOut + crackerBoom events fire', crOut.length >= 1 && crBoom.length >= 1,
  `${crOut.length} out / ${crBoom.length} boom; player damage from boom: ${boomHits.length} (sim only damages enemies)`);

// pvp combat happened at all (someone died to gunfire inside the zone)
const gunKills = elims.filter(e => !e.outside);
check('player-vs-player gunfire causes eliminations (not only the zone)', gunKills.length >= 1,
  `${gunKills.length} of 5 eliminations inside the zone`);

// snapshot additions present on BR, absent on classics
const sp = A.snap.players[0];
check('BR snapshot carries zone/winner/players hp/shield/team',
  !!A.snap.zone && A.snap.winner === A.g.winner && sp.hp !== undefined && sp.team !== undefined && sp.shield !== undefined);
const cg = createGame(classicDef, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout']);
const cs = snapshot(cg);
check('classic snapshot gains nothing (no zone, players keep 1-hit shape)',
  cs.zone === undefined && cs.winner === undefined && cs.players[0].hp === undefined && cs.players[0].team === undefined);

// pvp never touches rosters
const rr = applyResults(['scout', 'medic'], A.g);
check('applyResults is a no-op for BR', rr.roster.length === 2 && rr.gained.length === 0 && rr.lost.length === 0);

// per-player wrap line for the report
for (const p of A.g.players) {
  note(`${PARTY6[p.pid].name.padEnd(12)} ${p.state.padEnd(7)} hp=${p.hp} shield=${p.shield} dmgBonus=${p.dmgBonus ?? 0} item=${p.item ? p.item.kind + 'x' + p.item.count : '-'}`);
}
note(`pool ended at ${A.g.shards} shards; zone final r=${(A.g.zone.r / TILE).toFixed(1)} tiles; match length ${A.g.elapsed.toFixed(1)}s`);

// =============================== SCENARIO B: mutual avoiders =====================
console.log('--- duo of mutual avoiders (never fire): the zone must settle it ---');
const PARTY2 = [{ pid: 0, name: 'GhostA', charId: 'scout' }, { pid: 1, name: 'GhostB', charId: 'shade' }];
const BOTSB = [makeBot(0, avoiderBrain(14, true)), makeBot(1, avoiderBrain(14, true))];
const B = runMatch(brDef, PARTY2, BOTSB, 900);
const bElims = B.log.filter(e => e.type === 'eliminated');
const bShots = B.log.filter(e => e.type === 'shoot');
check('avoider duo ends via zone', B.g.status === 'cleared' && B.g.winner !== undefined && bShots.length === 0
  && bElims.length >= 1 && bElims.every(e => e.outside),
  `winner pid ${B.g.winner} at t=${B.g.elapsed.toFixed(1)}s, ${bElims.length} zone elimination(s), 0 shots fired`);

// =============================== SCENARIO C: stalemate probe =====================
// Two pacifists park on fixed antipodal anchors 4 tiles either side of the zone
// center — both fit inside the final r=5t ring. Also exercises the full shrink
// schedule deterministically (nobody dies, so the match runs the whole clock).
console.log('--- stalemate probe: two pacifists parked inside the final 5-tile ring ---');
const anchorBrain = ax => (g, bot, p, inp) => goTo(g, bot, p, ax * TILE, 36.5 * TILE, inp);
const BOTSC = [makeBot(0, anchorBrain(32.5)), makeBot(1, anchorBrain(40.5))];
const C = runMatch(brDef, PARTY2, BOTSC, 700);
const cShrinks = C.log.filter(e => e.type === 'zoneShrink');
check('full shrink schedule fires (4 zoneShrink events at 60/150/240/330)',
  cShrinks.length === 4 && cShrinks.map(e => Math.round(e.t)).join(',') === '60,150,240,330',
  `at t=${cShrinks.map(e => e.t.toFixed(0)).join('/')}s, radii ${cShrinks.map(e => (e.r / TILE).toFixed(1) + 't').join('/')}`);
check('zone settles at its final 5-tile radius', Math.abs(C.g.zone.r / TILE - 5) < 0.1,
  `r=${(C.g.zone.r / TILE).toFixed(2)}t after final shrink`);
const cAlive = C.g.players.filter(p => p.state === 'active').length;
const cHits = C.log.filter(e => e.type === 'playerHit').length;
note(`after 700s: status=${C.g.status}, active=${cAlive}, zone hits=${cHits}`);
const stalemate = C.g.status === 'play' && cAlive === 2;
if (stalemate) {
  note('OBSERVATION: the final ring never closes below r=5 tiles, the BR mission clock cannot end the');
  note('match, and two passive survivors inside the last ring stall the game forever (no sudden-death).');
}

// --- verdict ---------------------------------------------------------------------
const failed = checks.filter(c => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
