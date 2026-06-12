// Headless playtest: STRONGHOLD MID-ARC — sh12 "Forked Hold" + sh16 "Glasswater".
//
// Frontier IV contract checks:
//   - mid-arc difficulty with the INTENDED unlock roster (chars earned by then):
//       sh12: 4 starters + sniper/raider/pyro/engineer/bastion/duelist/volt (11)
//       sh16: the above + boomer/warden (13)
//   - economy verdict (shard income vs spend: chests, crystals, drops, repairs,
//     turret builds, hires, shop)
//   - wave pressure verdict (per-night ledger: spawned/killed/leftover, core hp,
//     downs, 90-cap saturation)
//   - terrain effects exercised: sand slow x0.85 (sh16 dunes, player AND enemy),
//     lava 1hp/0.8s players + shield absorb, 1hp/s enemies (sh13 flows — neither
//     mid-arc map ships lava, so the searing rules are exercised on the real
//     sh13 def with the same sim)
//   - NO pathing wedges across both maps for full runs: every wave enemy must
//     keep moving, gnaw something, fight someone or die — stationary-for-45s
//     enemies away from any structure/player are flagged with positions
//   - static wave-entry sanity: every spawn edge's entry tiles must reach the
//     core region on the blocksPath grid (lava-aware, like enemy A*)
//
// Run: node scripts/playtest-sh-mid.mjs            (both levels; exit 0 = pass)
//      node scripts/playtest-sh-mid.mjs sh12       (one level)
//      SH_DEBUG=1 for per-night chatter

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { charsById, createGame, parseLevel, step, TILE } from '../shared/game.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readDef = id => JSON.parse(fs.readFileSync(path.join(root, `levels/stronghold/${id}.json`), 'utf8'));
const characters = JSON.parse(fs.readFileSync(path.join(root, 'shared/characters.json'), 'utf8'));
const charMap = charsById(characters);

const DT = 1 / 30;
const DEBUG = +(process.env.SH_DEBUG || 0);
const only = process.argv[2];
const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
function note(msg) { console.log('      ' + msg); }

// Intended mid-arc rosters (contract unlock schedule: sh02 sniper, sh03 raider,
// sh04 pyro, sh05 engineer, sh06 bastion, sh08 duelist, sh10 volt, sh12 boomer,
// sh14 warden — the level being PLAYED has not granted its own unlock yet).
const ROSTERS = {
  sh12: ['bastion', 'sniper', 'volt', 'engineer', 'duelist', 'pyro', 'raider', 'soldier', 'grenadier', 'scout', 'medic'],
  sh16: ['bastion', 'warden', 'boomer', 'sniper', 'volt', 'duelist', 'engineer', 'pyro', 'raider', 'soldier', 'grenadier', 'scout', 'medic'],
};
const SEATS = {
  sh12: ['bastion', 'sniper', 'volt', 'engineer'],
  sh16: ['bastion', 'warden', 'boomer', 'sniper'],
};

// --- tile helpers ------------------------------------------------------------
const tileC = (g, x, y) => g.grid[y]?.[x] ?? '#';
// bots never walk lava or void; everything blocksMove blocks them too
const footBlocked = c => c === '#' || c === 'T' || c === '~' || c === 'o' || c === '%' || c === '!';
const blocksMoveC = c => c === '#' || c === 'T' || c === '~' || c === 'o' || c === '%';
const blocksPathC = c => blocksMoveC(c) || c === '!';

function blockedTile(g, tx, ty) {
  const c = tileC(g, tx, ty);
  if (footBlocked(c)) return true;
  if (g.core && Math.floor(g.core.x / TILE) === tx && Math.floor(g.core.y / TILE) === ty) return true;
  for (const b of g.builds) {
    if (b.built && b.kind !== 'farm' && Math.floor(b.x / TILE) === tx && Math.floor(b.y / TILE) === ty) return true;
  }
  return false;
}

function planRoute(g, p, gx, gy) {
  const W = g.w, H = g.h;
  const sx = Math.floor(p.x / TILE), sy = Math.floor(p.y / TILE);
  const gtx = Math.floor(gx / TILE), gty = Math.floor(gy / TILE);
  const dist = new Int32Array(W * H).fill(-1);
  const prev = new Int32Array(W * H).fill(-1);
  const start = sy * W + sx;
  const q = [start];
  dist[start] = 0;
  for (let h = 0; h < q.length; h++) {
    const cur = q[h], cx = cur % W, cy = (cur / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (dist[ni] !== -1 || blockedTile(g, nx, ny)) continue;
      dist[ni] = dist[cur] + 1;
      prev[ni] = cur;
      q.push(ni);
    }
  }
  let best = -1, bestScore = Infinity;
  if (dist[gty * W + gtx] !== -1) best = gty * W + gtx;
  else {
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] === -1) continue;
      const d = Math.hypot((i % W) - gtx, ((i / W) | 0) - gty) * 10 + dist[i] * 0.05;
      if (d < bestScore) { bestScore = d; best = i; }
    }
  }
  if (best === -1) return [];
  const rev = [];
  for (let i = best; i >= 0; i = prev[i]) rev.push(i);
  rev.reverse();
  return rev.slice(1).map(i => ({ x: ((i % W) + 0.5) * TILE, y: (((i / W) | 0) + 0.5) * TILE }));
}

// LoS for bot fire decisions: tiles AND own built structures block (player
// direct hits demolish own walls by design — bots must not friendly-shred)
function losShot(g, ax, ay, bx, by) {
  const d = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(d / 12));
  for (let i = 1; i < steps; i++) {
    const x = ax + (bx - ax) * (i / steps), y = ay + (by - ay) * (i / steps);
    const c = tileC(g, Math.floor(x / TILE), Math.floor(y / TILE));
    if (c === '#' || c === 'T' || c === '%') return false;
  }
  for (const b of g.builds) {
    if (!b.built || b.kind === 'farm') continue;
    // segment-point distance to the structure center
    const vx = bx - ax, vy = by - ay;
    const L2 = vx * vx + vy * vy || 1;
    let t = ((b.x - ax) * vx + (b.y - ay) * vy) / L2;
    t = Math.max(0.05, Math.min(0.95, t));
    const dx = ax + vx * t - b.x, dy = ay + vy * t - b.y;
    if (dx * dx + dy * dy < 12 * 12) return false;
  }
  return true;
}

function makeBot(pid, role) {
  return { pid, role, path: [], repath: 0, mem: {}, stuck: 0, buildsKey: '' };
}

function weaponRange(g, p) {
  const ch = charMap[p.charId];
  return ch?.weapon?.range ?? 5;
}

function aimAt(p, x, y, inp) {
  const d = Math.hypot(x - p.x, y - p.y) || 1;
  p.fx = (x - p.x) / d;
  p.fy = (y - p.y) / d;
  inp.fire = true;
}

function walkTo(g, bot, p, gx, gy, inp) {
  const buildsKey = g.builds.reduce((n, b) => n + (b.built ? 1 : 0), 0);
  bot.repath--;
  const moved = Math.hypot((bot.mem.gx ?? -1) - gx, (bot.mem.gy ?? -1) - gy) > TILE;
  if (bot.repath <= 0 || moved || !bot.path.length || bot.buildsKey !== buildsKey) {
    bot.path = planRoute(g, p, gx, gy);
    bot.mem.gx = gx; bot.mem.gy = gy;
    bot.buildsKey = buildsKey;
    bot.repath = 24;
  }
  while (bot.path.length && Math.hypot(bot.path[0].x - p.x, bot.path[0].y - p.y) < 14) bot.path.shift();
  const wp = bot.path[0];
  if (!wp) {
    const d = Math.hypot(gx - p.x, gy - p.y);
    if (d < TILE * 1.45) { bot.stuck = 0; return true; }
    bot.stuck++;
    bot.repath = 0;
    return bot.stuck > 240; // unreachable: give up rather than hang
  }
  if (wp.x < p.x - 4) inp.left = true; else if (wp.x > p.x + 4) inp.right = true;
  if (wp.y < p.y - 4) inp.up = true; else if (wp.y > p.y + 4) inp.down = true;
  return false;
}

// Engage awake enemies in LoS + range; give ground inside 1.6 tiles.
function combatReflex(g, bot, p, inp, engageT) {
  let tgt = null, bd = Infinity;
  for (const e of g.enemies) {
    if (e.dead) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    const interested = (e.awake && d < engageT * TILE) || d < 4.5 * TILE;
    if (!interested) continue;
    if (!losShot(g, p.x, p.y, e.x, e.y)) continue;
    if (d < bd) { bd = d; tgt = e; }
  }
  if (!tgt) return false;
  if (bd < 2.2 * TILE) {
    // give ground TOWARD THE CORE: falling back into the base keeps the
    // bot inside friendly fire lanes instead of pinned on its own wall
    let ux = (p.x - tgt.x) / (bd || 1), uy = (p.y - tgt.y) / (bd || 1);
    if (g.core) {
      const dc = Math.hypot(g.core.x - p.x, g.core.y - p.y);
      if (dc > 2 * TILE) { ux = (g.core.x - p.x) / dc; uy = (g.core.y - p.y) / dc; }
    }
    if (ux < -0.3) inp.left = true; else if (ux > 0.3) inp.right = true;
    if (uy < -0.3) inp.up = true; else if (uy > 0.3) inp.down = true;
    return true;
  }
  if (bd > weaponRange(g, p) * TILE) return false;
  aimAt(p, tgt.x, tgt.y, inp);
  return true;
}

// --- the defense brain ---------------------------------------------------------
function think(g, bot, frame, stats) {
  const p = g.players[bot.pid];
  const inp = {};
  if (!p) return inp;
  if (p.state === 'pick') { if (frame % 10 === 0) inp.fire = true; return inp; }
  if (p.state !== 'active') return inp;
  const inNight = g.cycle && g.cycle.phase === 'night';
  if (p.hp <= (inNight ? 2 : 1) && p.item && p.item.kind === 'medkit' && p.item.count > 0 && !bot.mem.itemPrev) inp.item = true;
  bot.mem.itemPrev = !!inp.item;

  const core = g.core;
  const night = g.cycle && g.cycle.phase === 'night';

  // threat list: awake enemies sorted by distance to the core
  const threats = [];
  for (const e of g.enemies) {
    if (e.dead || !e.awake) continue;
    const dc = Math.hypot(e.x - core.x, e.y - core.y);
    if (dc < 26 * TILE) threats.push({ e, dc });
  }
  threats.sort((a, b) => a.dc - b.dc);
  const hot = threats.length && threats[0].dc < 16 * TILE;

  if (combatReflex(g, bot, p, inp, bot.role === 'sniper' ? 11 : 8)) return inp;

  // build/repair seats keep working through daytime mop-ups: the reflex above
  // still defends them, but leftover stragglers must not starve the economy
  const workday = !night && (bot.role === 'build' || bot.role === 'repair');
  if ((night || hot) && !workday) {
    // intercept: bot i covers the (i % fronts)-th nearest threat
    bot.mem.task = null;
    let post;
    if (threats.length) {
      const k = Math.min(threats.length, 4);
      const t = threats[bot.pid % k];
      const d = t.dc || 1;
      // tight ring: let walls and turrets bleed the swarm, meet leakers close
      const r = Math.min(4.5 * TILE, Math.max(2.2 * TILE, d - 1.5 * TILE));
      post = { x: core.x + ((t.e.x - core.x) / d) * r, y: core.y + ((t.e.y - core.y) / d) * r };
    } else {
      const ang = (bot.pid / 4) * Math.PI * 2 + Math.PI / 4;
      post = { x: core.x + Math.cos(ang) * 2.6 * TILE, y: core.y + Math.sin(ang) * 2.6 * TILE };
    }
    walkTo(g, bot, p, post.x, post.y, inp);
    return inp;
  }

  // --- day work ---
  if (bot.role === 'repair') {
    // nearest damaged structure within 24 tiles of core; hold act till full
    let tgt = null, bd = Infinity;
    for (const b of g.builds) {
      if (!b.built || b.hp >= b.maxHp) continue;
      // a shop hold inside its radius opens the stall instead — skip those
      if (g.shops.some(s => Math.hypot(s.x - b.x, s.y - b.y) < 2.2 * TILE)) continue;
      const dc = Math.hypot(b.x - core.x, b.y - core.y);
      if (dc > 24 * TILE) continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d < bd) { bd = d; tgt = b; }
    }
    if (tgt) {
      if (Math.hypot(tgt.x - p.x, tgt.y - p.y) < 1.2 * TILE) {
        if (g.shards >= 1) inp.act = true; // hold to repair; release at full (loop re-checks)
      } else walkTo(g, bot, p, tgt.x, tgt.y, inp);
      return inp;
    }
  }
  if (bot.role === 'build') {
    // turrets first (cost 10): nearest unbuilt turret site to the core
    if (g.shards >= 12) {
      let site = null, bd = Infinity;
      for (const b of g.builds) {
        if (b.built || b.kind !== 'turret') continue;
        const dc = Math.hypot(b.x - core.x, b.y - core.y);
        if (dc > 20 * TILE) continue;
        if (dc < bd) { bd = dc; site = b; }
      }
      if (site) {
        if (Math.hypot(site.x - p.x, site.y - p.y) < 1.2 * TILE) inp.act = true;
        else walkTo(g, bot, p, site.x, site.y, inp);
        return inp;
      }
    }
    // then hires (followers) when flush
    if (g.shards >= 40) {
      const h = g.hires.find(h2 => !h2.hired && Math.hypot(h2.x - core.x, h2.y - core.y) < 18 * TILE);
      if (h) {
        if (Math.hypot(h.x - p.x, h.y - p.y) < 1.1 * TILE) {
          if (frame % 16 === 0) inp.act = true;
        } else walkTo(g, bot, p, h.x, h.y, inp);
        return inp;
      }
    }
    // idle builder doubles as a second repair hand
    let fix = null, bf = Infinity;
    for (const b of g.builds) {
      if (!b.built || b.hp >= b.maxHp) continue;
      if (g.shops.some(s => Math.hypot(s.x - b.x, s.y - b.y) < 2.2 * TILE)) continue;
      const dc = Math.hypot(b.x - core.x, b.y - core.y);
      if (dc > 24 * TILE) continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d < bf) { bf = d; fix = b; }
    }
    if (fix) {
      if (Math.hypot(fix.x - p.x, fix.y - p.y) < 1.2 * TILE) {
        if (g.shards >= 1) inp.act = true;
      } else walkTo(g, bot, p, fix.x, fix.y, inp);
      return inp;
    }
  }
  if (bot.role === 'loot' || bot.role === 'sniper') {
    const leash = 24 * TILE;
    // chests (this seat claims alternating indices)
    const mine = g.chests
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => !c.opened && i % 2 === (bot.pid % 2)
        && Math.hypot(c.x - core.x, c.y - core.y) < leash
        && !(bot.mem.gaveUp || {})[i]);
    if (mine.length) {
      mine.sort((a, b) => Math.hypot(a.c.x - p.x, a.c.y - p.y) - Math.hypot(b.c.x - p.x, b.c.y - p.y));
      const { c, i } = mine[0];
      if (Math.hypot(c.x - p.x, c.y - p.y) < 1.0 * TILE) {
        bot.mem.actT = (bot.mem.actT || 0) + 1;
        if (bot.mem.actT % 16 === 1) inp.act = true;
        if (bot.mem.actT > 16 * 8) {
          (bot.mem.gaveUp = bot.mem.gaveUp || {})[i] = true;
          stats.chestWhiffs.push(`pid${bot.pid}@chest${i}`);
          bot.mem.actT = 0;
        }
      } else {
        bot.mem.actT = 0;
        if (walkTo(g, bot, p, c.x, c.y, inp)) { (bot.mem.gaveUp = bot.mem.gaveUp || {})[i] = true; }
      }
      return inp;
    }
    // crystals: crack LYTH nodes for shards (4 each)
    let cry = null, bd = Infinity;
    for (const c of g.crystals) {
      if (c.hp <= 0) continue;
      const dc = Math.hypot(c.x - core.x, c.y - core.y);
      if (dc > leash) continue;
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bd) { bd = d; cry = c; }
    }
    if (cry) {
      const wr = weaponRange(g, p) * TILE * 0.8;
      if (bd < wr && losShot(g, p.x, p.y, cry.x, cry.y)) aimAt(p, cry.x, cry.y, inp);
      else if (walkTo(g, bot, p, cry.x, cry.y, inp)) bot.mem.cryStuck = (bot.mem.cryStuck || 0) + 1;
      return inp;
    }
    // day sweep: hoover dropped shards near the base before they expire
    let drop = null, bdd = Infinity;
    for (const d of g.drops) {
      const dc = Math.hypot(d.x - core.x, d.y - core.y);
      if (dc > 20 * TILE) continue;
      const dd = Math.hypot(d.x - p.x, d.y - p.y);
      if (dd < bdd) { bdd = dd; drop = d; }
    }
    if (drop && bdd > 1.0 * TILE) { walkTo(g, bot, p, drop.x, drop.y, inp); return inp; }
    // shop: shields > medkits > damage tokens as the pool allows
    const wantShield = g.shards >= 45 && (p.shield || 0) < 2;
    const wantMedkit = g.shards >= 35 && !(p.item && p.item.kind === 'medkit' && p.item.count > 0);
    const wantToken = g.shards >= 70 && (p.dmgBonus || 0) < 2;
    if ((wantShield || wantMedkit || wantToken) && g.shops.length) {
      const want = wantShield ? 1 : wantMedkit ? 3 : 0; // offer index
      const s = g.shops[0];
      if (Math.hypot(s.x - p.x, s.y - p.y) < 1.0 * TILE) {
        inp.act = true; // hold act = stall open; right edge browses, fire edge buys
        bot.mem.shopT = (bot.mem.shopT || 0) + 1;
        const phase = bot.mem.shopT % 36;
        if (phase === 6 && (p.shopIdx || 0) !== want) inp.right = true;
        if (phase === 18 && (p.shopIdx || 0) === want) inp.fire = true;
      } else { bot.mem.shopT = 0; walkTo(g, bot, p, s.x, s.y, inp); }
      return inp;
    }
  }
  // default: hold the home post by the core
  const ang = (bot.pid / 4) * Math.PI * 2 + Math.PI / 4;
  walkTo(g, bot, p, core.x + Math.cos(ang) * 2.6 * TILE, core.y + Math.sin(ang) * 2.6 * TILE, inp);
  return inp;
}

// --- full mission run -----------------------------------------------------------
function runLevel(id) {
  const def = readDef(id);
  const seats = SEATS[id];
  const party = seats.map((charId, pid) => ({ pid, name: 'BOT' + pid, charId }));
  const g = createGame(def, party, charMap, ROSTERS[id]);
  const roles = ['loot', 'sniper', 'build', 'repair'];
  const bots = party.map((pp, i) => makeBot(pp.pid, roles[i]));
  // seat 1 is the longest-range char on both maps: give it the sniper role
  const capS = (def.bastion.nights + 1) * (def.bastion.dayLen + def.bastion.nightLen) + 120;

  const stats = {
    nights: [], waves: [], downs: 0, coreHits: 0, buildDownEv: [], builtEv: [], repairs: 0,
    income: 0, chestShards: 0, chests: 0, crystals: 0, hires: 0, buys: 0, buyList: [],
    peakEnemies: 0, capHits: 0, chestWhiffs: [], wedges: new Map(), minCoreHp: 30,
    livesUsed: 0, sizzles: 0,
  };
  let nightLedger = null;
  const startKills = 0;
  const watch = new Map(); // enemy id -> {x, y, stillT}

  let frame = 0;
  const maxFrames = Math.ceil(capS / DT);
  for (; frame < maxFrames && g.status === 'play'; frame++) {
    const inputs = {};
    for (const b of bots) inputs[b.pid] = think(g, b, frame, stats);
    step(g, inputs, DT);

    for (const ev of g.events) {
      switch (ev.type) {
        case 'dusk':
          nightLedger = {
            night: ev.nightNo, bloodMoon: !!ev.bloodMoon, spawned: 0,
            killsAt: g.kills, downsAt: stats.downs, coreHpAt: g.core.hp, poolAt: g.shards,
            coreHits: 0,
          };
          break;
        case 'wave':
          stats.waves.push({ t: g.elapsed, edge: ev.edge, count: ev.count });
          if (nightLedger) nightLedger.spawned += ev.count;
          break;
        case 'dawn':
          if (nightLedger) {
            const live = g.enemies.filter(e => !e.dead).length;
            stats.nights.push({
              ...nightLedger,
              kills: g.kills - nightLedger.killsAt,
              downs: stats.downs - nightLedger.downsAt,
              coreHp: g.core.hp,
              leftover: live,
              pool: Math.round(g.shards),
            });
            nightLedger = null;
          }
          break;
        case 'coreHit':
          stats.coreHits++;
          if (nightLedger) nightLedger.coreHits++;
          break;
        case 'down': stats.downs++; break;
        case 'spawn': stats.livesUsed++; break;
        case 'buildDown': stats.buildDownEv.push({ t: g.elapsed, kind: ev.kind }); break;
        case 'built': stats.builtEv.push({ t: g.elapsed, kind: ev.kind, level: ev.level }); break;
        case 'repair': stats.repairs++; break;
        case 'shard': stats.income += ev.amount; break;
        case 'chest':
          stats.chests++;
          if (ev.loot === 'shards') { stats.chestShards += ev.amount; stats.income += ev.amount; }
          break;
        case 'crystal': stats.crystals++; break;
        case 'hired': stats.hires++; break;
        case 'sizzle': stats.sizzles++; break;
        case 'buy': stats.buys++; stats.buyList.push(ev.what); break;
      }
    }
    g.events.length = 0;

    const live = g.enemies.filter(e => !e.dead).length;
    if (live > stats.peakEnemies) stats.peakEnemies = live;
    if (live >= 90) stats.capHits++;
    if (g.core.hp < stats.minCoreHp) stats.minCoreHp = g.core.hp;

    // wedge watch, 1 Hz: an awake MOBILE enemy that has not moved 0.5 tiles in
    // 45s and is not beside any structure/core/player is wedged
    if (frame % 30 === 0) {
      const seen = new Set();
      for (const e of g.enemies) {
        if (e.dead || !e.awake || e.speed === 0) continue;
        seen.add(e.id);
        const w = watch.get(e.id);
        if (!w) { watch.set(e.id, { x: e.x, y: e.y, stillT: 0 }); continue; }
        if (Math.hypot(e.x - w.x, e.y - w.y) > 0.5 * TILE) {
          w.x = e.x; w.y = e.y; w.stillT = 0;
          continue;
        }
        w.stillT += 1;
        if (w.stillT >= 45 && !stats.wedges.has(e.id)) {
          const nearStruct = g.builds.some(b => b.built && b.kind !== 'farm' && Math.hypot(b.x - e.x, b.y - e.y) < 2 * TILE)
            || Math.hypot(g.core.x - e.x, g.core.y - e.y) < 2.5 * TILE
            || g.towers.some(t => t.hp > 0 && Math.hypot(t.x - e.x, t.y - e.y) < 2 * TILE);
          const nearPlayer = g.players.some(p2 => p2.state === 'active' && Math.hypot(p2.x - e.x, p2.y - e.y) < 14 * TILE
            && losShot(g, e.x, e.y, p2.x, p2.y));
          if (!nearStruct && !nearPlayer) {
            stats.wedges.set(e.id, {
              kind: e.kind, letter: e.letter, t: Math.round(g.elapsed),
              tx: Math.floor(e.x / TILE), ty: Math.floor(e.y / TILE), targetCore: !!e.targetCore,
            });
            if (DEBUG) {
              console.log(`  WEDGE id=${e.id} ${e.letter}/${e.kind} @${(e.x / TILE).toFixed(1)},${(e.y / TILE).toFixed(1)} t=${g.elapsed.toFixed(0)} `
                + `awake=${e.awake} ret=${e.returning} pf=${e.pathFailed} path=${e.path ? e.path.length + '@' + e.pathI : '-'} `
                + `gnawI=${e.gnawI} engage=${e.engagePid} stun=${(e.stunT || 0).toFixed(1)} conv=${(e.convertedT || 0).toFixed(1)} `
                + `stuckT=${(e.chaseStuckT || 0).toFixed(1)} kick=${e.chaseKicked} mut=${e.mutation} hp=${e.hp} coolH=${(e.hitCool || 0).toFixed(1)} aimT=${(e.aimT || 0).toFixed(2)}`);
            }
            if (process.env.SH_PROBE && !stats.probe) stats.probe = { id: e.id, until: frame + 120 };
          }
        }
      }
      for (const id of watch.keys()) if (!seen.has(id)) watch.delete(id);
    }

    if (stats.probe && frame <= stats.probe.until) {
      const e = g.enemies.find(e2 => e2.id === stats.probe.id);
      if (e) {
        console.log(`  PROBE f=${frame} x=${e.x.toFixed(2)} y=${e.y.toFixed(2)} awake=${e.awake ? 1 : 0} `
          + `path=${e.path ? e.path.length + '@' + e.pathI : '-'} rT=${(e.repathT ?? 0).toFixed(2)} pf=${e.pathFailed ? 1 : 0} `
          + `f=${e.fx.toFixed(2)},${e.fy.toFixed(2)} st=${(e.chaseStuckT || 0).toFixed(2)} sx=${e.stuckX === undefined ? '-' : e.stuckX.toFixed(1)} ret=${e.returning ? 1 : 0} gnaw=${e.gnawI ?? '-'}`);
      }
    }
    if (DEBUG && frame % (30 * 30) === 0) {
      console.log(`  t=${g.elapsed.toFixed(0)} ${g.cycle.phase}${g.cycle.nightNo} core=${g.core.hp} pool=${g.shards.toFixed(0)} live=${live} kills=${g.kills} `
        + g.players.map(p2 => `${p2.pid}:${p2.state[0]}${p2.hp ?? ''}`).join(' '));
    }
  }

  return { g, stats, frames: frame, def };
}

// =============================== TERRAIN MICRO-CHECKS ===============================
console.log('--- terrain micro-checks (real sim, real defs) ---');

// helper: find a horizontal run of tiles where rows y-1..y+1 are all in `set`
function findRun(grid, set, len) {
  for (let y = 1; y < grid.length - 1; y++) {
    for (let x = 1; x + len < grid[y].length - 1; x++) {
      let ok = true;
      for (let i = 0; ok && i < len; i++) {
        for (let dy = -1; dy <= 1; dy++) if (!set.has(grid[y + dy][x + i])) { ok = false; }
      }
      if (ok) return { x, y };
    }
  }
  return null;
}

{
  // SAND (sh16): drive an operative right along a dune run vs a plain run
  const def16 = readDef('sh16');
  const lvl = parseLevel(def16);
  const sandRun = findRun(lvl.grid, new Set(['=']), 8);
  const plainRun = findRun(lvl.grid, new Set(['.', ',']), 8);
  const drive = (run) => {
    const g = createGame(def16, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ROSTERS.sh16);
    g.enemies = [];
    g.graceT = 0;
    const p = g.players[0];
    p.x = (run.x + 0.5) * TILE; p.y = (run.y + 0.5) * TILE;
    const x0 = p.x;
    for (let i = 0; i < 45; i++) step(g, { 0: { right: true } }, DT);
    return (p.x - x0) / (45 * DT) / TILE; // tiles per second
  };
  const vSand = drive(sandRun);
  const vPlain = drive(plainRun);
  const ratio = vSand / vPlain;
  check('sand slows players to x0.85 (sh16 dunes)', Math.abs(ratio - 0.85) < 0.02,
    `plain ${vPlain.toFixed(2)} t/s vs sand ${vSand.toFixed(2)} t/s (ratio ${ratio.toFixed(3)}) at ${sandRun.x},${sandRun.y}`);

  // enemy on the same dunes: park a wave-grade hunter on sand vs plain and watch its stride
  const chase = (run) => {
    const g = createGame(def16, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ROSTERS.sh16);
    g.graceT = 0;
    const e = g.enemies.find(e2 => e2.kind === 'grunt' || e2.kind === 'husk') || g.enemies[0];
    g.enemies = [e];
    e.x = (run.x + 0.5) * TILE; e.y = (run.y + 0.5) * TILE;
    e.homeX = e.x; e.homeY = e.y;
    e.awake = true; e.aggro *= 100;
    const p = g.players[0];
    p.x = e.x + 7 * TILE; p.y = e.y;
    const x0 = e.x;
    for (let i = 0; i < 30; i++) step(g, {}, DT);
    return (e.x - x0) / (30 * DT) / TILE;
  };
  const eSand = chase(sandRun);
  const ePlain = chase(plainRun);
  const eRatio = eSand / ePlain;
  check('sand slows enemies to x0.85 too (their march wades the same dunes)', Math.abs(eRatio - 0.85) < 0.03,
    `plain ${ePlain.toFixed(2)} t/s vs sand ${eSand.toFixed(2)} t/s (ratio ${eRatio.toFixed(3)})`);
}

{
  // LAVA (sh13 — neither mid-arc map ships '!', so the searing rules are
  // exercised on the nearest def that does, with the same sim code)
  const def13 = readDef('sh13');
  const lvl = parseLevel(def13);
  let lavaT = null;
  outer: for (let y = 1; y < lvl.grid.length - 1; y++) {
    for (let x = 1; x < lvl.grid[y].length - 1; x++) {
      if (lvl.grid[y][x] === '!' && lvl.grid[y][x + 1] === '!' && lvl.grid[y][x - 1] === '!') { lavaT = { x, y }; break outer; }
    }
  }
  const mk = () => {
    const g = createGame(def13, [{ pid: 0, name: 'T', charId: 'scout' }], charMap, ['scout', 'soldier']);
    g.graceT = 0;
    const p = g.players[0];
    p.x = (lavaT.x + 0.5) * TILE; p.y = (lavaT.y + 0.5) * TILE;
    p.invuln = 0;
    return { g, p };
  };
  {
    const { g, p } = mk();
    g.enemies = [];
    for (let i = 0; i < Math.round(1.7 / DT); i++) step(g, {}, DT);
    check('lava sears players 1 hp per 0.8s standing', p.hp === 1, `hp 3 -> ${p.hp} after 1.7s in the flow`);
  }
  {
    const { g, p } = mk();
    g.enemies = [];
    p.shield = 2;
    for (let i = 0; i < Math.round(1.7 / DT); i++) step(g, {}, DT);
    check('shield pips absorb lava ticks first', p.hp === 3 && p.shield === 0, `hp ${p.hp}, shield 2 -> ${p.shield}`);
  }
  {
    const { g } = mk();
    const e = g.enemies[0];
    g.enemies = [e];
    e.x = (lavaT.x + 0.5) * TILE; e.y = (lavaT.y + 0.5) * TILE;
    const hp0 = e.hp;
    for (let i = 0; i < Math.round(2.1 / DT); i++) step(g, {}, DT);
    check('lava sears enemies at 1 hp/s', hp0 - e.hp === 2, `hp ${hp0} -> ${e.hp} after 2.1s`);
  }
}

// =============================== STATIC ENTRY REACHABILITY ===============================
console.log('--- static wave-entry reachability (lava-aware enemy pathing grid) ---');
for (const id of ['sh12', 'sh16']) {
  const lvl = parseLevel(readDef(id));
  const W = lvl.w, H = lvl.h;
  const grid = lvl.grid;
  const core = lvl.core;
  const reach = new Uint8Array(W * H);
  const cx = Math.floor(core.x / TILE), cy = Math.floor(core.y / TILE);
  const q = [cy * W + cx];
  reach[cy * W + cx] = 1;
  for (let h = 0; h < q.length; h++) {
    const cur = q[h], x = cur % W, y = (cur / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (reach[ni] || blocksPathC(grid[ny][nx])) continue;
      reach[ni] = 1;
      q.push(ni);
    }
  }
  const per = [];
  let allOk = true;
  for (const edge of ['n', 'e', 's', 'w']) {
    const horiz = edge === 'n' || edge === 's';
    const len = horiz ? W : H;
    let cands = 0, ok = 0;
    for (let i = 0; i < len; i++) {
      for (let depth = 0; depth < 2; depth++) {
        let tx, ty;
        if (edge === 'n') { tx = i; ty = depth; }
        else if (edge === 's') { tx = i; ty = H - 1 - depth; }
        else if (edge === 'w') { tx = depth; ty = i; }
        else { tx = W - 1 - depth; ty = i; }
        if (!blocksMoveC(grid[ty][tx]) && grid[ty][tx] !== '!') {
          cands++;
          if (reach[ty * W + tx]) ok++;
          break;
        }
      }
    }
    per.push(`${edge}:${ok}/${cands}`);
    if (!cands || ok < cands) allOk = false;
  }
  check(`${id}: every wave entry tile on all 4 edges reaches the core (A* grid, lava-aware)`,
    allOk, per.join(' '));
}

// =============================== FULL RUNS ===============================
for (const id of ['sh12', 'sh16']) {
  if (only && only !== id) continue;
  const def = readDef(id);
  console.log(`\n=== ${id} "${def.stronghold.name}" — full run: ${def.bastion.nights} nights, `
    + `wavesPerNight ${def.bastion.wavesPerNight}, waveMult ${def.bastion.waveMult}, hpMult ${def.stronghold.hpMult}, `
    + `bloodMoons [${def.bastion.bloodMoons}] — seats: ${SEATS[id].join('/')} of roster(${ROSTERS[id].length}) ===`);
  const t0 = Date.now();
  const { g, stats, frames } = runLevel(id);
  const wallS = ((Date.now() - t0) / 1000).toFixed(1);

  check(`${id}: mission CLEARED at final dawn with the mid-arc roster`,
    g.status === 'cleared',
    `status=${g.status} after ${g.elapsed.toFixed(0)}s sim (${wallS}s wall), nights survived: ${stats.nights.length}/${def.bastion.nights}`);
  check(`${id}: the core never fell to critical (final hp ${g.core.hp}/30)`,
    g.core.hp > 0, `min core hp ${stats.minCoreHp}, total core hits ${stats.coreHits}`);
  // def.stronghold.waves is the UI count: nights*wpn + one extra per blood
  // moon; at runtime each blood-moon wave fires from TWO edges (2 events).
  const uiWaves = def.bastion.nights * def.bastion.wavesPerNight + def.bastion.bloodMoons.length;
  const expEvents = def.bastion.nights * def.bastion.wavesPerNight + def.bastion.bloodMoons.length * def.bastion.wavesPerNight;
  check(`${id}: def waves field matches the schedule (waves=${def.stronghold.waves})`,
    def.stronghold.waves === uiWaves,
    `nights*wpn + bloodMoons = ${uiWaves}; runtime wave events seen ${stats.waves.length}` +
    (g.status === 'cleared' ? ` of ${expEvents} expected` : ' (run ended early)'));
  check(`${id}: NO pathing wedges across the full run`, stats.wedges.size === 0,
    stats.wedges.size ? [...stats.wedges.values()].map(w => `${w.letter}/${w.kind}@${w.tx},${w.ty} t=${w.t}s core=${w.targetCore}`).join('; ')
      : `0 of ${g.kills + g.enemies.length} engaged enemies ever sat still 45s+ away from a fight`);

  const spareLives = ROSTERS[id].length - SEATS[id].length;
  check(`${id}: roster attrition sustainable (downs ${stats.downs}, respawns ${stats.livesUsed} of ${spareLives} spare operatives)`,
    stats.livesUsed <= spareLives && g.players.filter(p => p.state === 'active').length >= 2,
    `${g.players.filter(p => p.state === 'active').length}/4 seats active at the end`);

  // ledgers
  note(`night ledger (spawned/killed/leftover, coreHp@dawn, downs, pool@dawn):`);
  for (const n of stats.nights) {
    note(`  n${n.night}${n.bloodMoon ? ' BLOODMOON' : ''}: spawned ${n.spawned}, killed ${n.kills}, leftover ${n.leftover}, `
      + `coreHits ${n.coreHits} (hp ${n.coreHp}/30), downs ${n.downs}, pool ${n.pool}`);
  }
  const spend = stats.income - g.shards;
  note(`economy: income ${Math.round(stats.income)} shards (${stats.chests} chests incl. ${stats.chestShards} shards, `
    + `${stats.crystals} crystals cracked, rest enemy drops) — spent ${Math.round(spend)} `
    + `(${stats.builtEv.filter(b => !b.level || b.level === 1).length} structures built incl. `
    + `${stats.builtEv.filter(b => b.kind === 'turret').length} turrets, ${stats.repairs} repair ticks, ${stats.hires} hires, `
    + `${stats.buys} shop buys [${stats.buyList.join(',')}]) — pool at end ${Math.round(g.shards)}`);
  note(`pressure: peak ${stats.peakEnemies} live enemies, 90-cap saturated ${(stats.capHits / 30).toFixed(0)}s total, `
    + `walls lost ${stats.buildDownEv.length} (${stats.buildDownEv.map(b => b.kind).join(',') || 'none'}), kills ${g.kills}, score ${Math.round(g.score)}`);
  note(`waves: ${stats.waves.map(w => `${w.count}@${w.edge}/${Math.round(w.t)}s`).join(' ')}`);
  if (stats.chestWhiffs.length) note(`chest whiffs: ${stats.chestWhiffs.join(', ')}`);
  for (const p of g.players) {
    note(`seat ${p.pid}: ${p.state} char=${p.charId} hp=${p.hp ?? '-'} xp=${Math.round(p.xp ?? 0)} L${p.level ?? '-'} dmg+${p.dmgBonus || 0}`);
  }
}

const failed = checks.filter(c => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
