// Headless playtest: STRONGHOLD sh25 "FINALITY" (levels/stronghold/sh25.json).
// XL 110x80, beacon-defense variant: 10 nights, wavesPerNight 2, waveMult 2.6,
// hpMult 1.8, blood moons on 2/4/6/8/10, Entropy bosses on nights 6/8/10.
//
// Four scripted late-game operatives, one per beacon fort:
//   pid 0  ATLAS   atlas      NW fort (28,22)  overWalls comet bombardier
//   pid 1  BOMBARD grenadier  NE fort (82,30)  overWalls arc-mortar bombardier
//   pid 2  LANCE   sniper     SE fort (78,56)  gate-lane rail (pierce 3)
//   pid 3  SPARK   volt       SW fort (30,60)  gate-lane chain spark (pierce 2)
//
// Modes (argv[2]):
//   win      full 10-night defense; expects status 'cleared' at final dawn
//            with >= 1 beacon lit (the FINALITY survival scenario)
//   loss     squad idles at center; expects all four beacons dark at once ->
//            'allDark' + status 'failed'
//   extract  defend night 1, then board the landed Anchorcraft (all four lit
//            at night >= 2 lands it) -> 'shipDown'/'shipLaunch' + 'cleared'
//
// Perf is sampled around every step() call: avg / p99 / max ms per tick and
// the peak entity count are reported (XL map at the 90-enemy cap).
//
// Run: node scripts/playtest-sh25.mjs win

import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';
import { charsById, createGame, step, TILE } from '../shared/game.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const def = JSON.parse(fs.readFileSync(path.join(root, 'levels/stronghold/sh25.json'), 'utf8'));
const characters = JSON.parse(fs.readFileSync(path.join(root, 'shared/characters.json'), 'utf8'));
const charMap = charsById(characters);

const MODE = process.argv[2] || 'win';
const DEBUG = +(process.env.SH25_DEBUG || 0);
const DT = 1 / 30;

const PARTY = [
  { pid: 0, name: 'ATLAS', charId: 'atlas' },
  { pid: 1, name: 'BOMBARD', charId: 'grenadier' },
  { pid: 2, name: 'LANCE', charId: 'sniper' },
  { pid: 3, name: 'SPARK', charId: 'volt' },
];
// Full sh25-era stronghold roster: 4 starters + all 13 unlocks. Respawn is
// Gain Ground style (each death consumes a roster operative), so the spare
// 13 are the squad's lives — ordered strongest-first for the pick screen.
const ROSTER = [
  'atlas', 'grenadier', 'sniper', 'volt', 'helix', 'boomer', 'warden', 'bastion',
  'seal', 'shade', 'duelist', 'pyro', 'engineer', 'raider', 'medic', 'soldier', 'scout',
];

const checks = [];
const issues = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) issues.push(`${name}${detail ? ' (' + detail + ')' : ''}`);
}
function note(msg) { console.log('      ' + msg); }

// --- terrain helpers ---------------------------------------------------------
const tileC = (g, x, y) => g.grid[y]?.[x] ?? '#';
// bots refuse lava ('!') as well as the hard blockers
const botBlocked = c => c === '#' || c === 'T' || c === '~' || c === 'o' || c === '%' || c === '!';

function blockedTile(g, tx, ty) {
  if (botBlocked(tileC(g, tx, ty))) return true;
  for (const b of g.builds) {
    if (b.built && b.kind !== 'farm' && Math.floor(b.x / TILE) === tx && Math.floor(b.y / TILE) === ty) return true;
  }
  return false;
}

// routing halo around SLEEPING camps: bots detour instead of stumbling into a
// group-alert onslaught (goal tiles stay legal so duties can still finish)
function campHalo(g) {
  const halo = new Set();
  for (const e of g.enemies) {
    if (e.dead || e.awake) continue;
    const ex = Math.floor(e.x / TILE), ey = Math.floor(e.y / TILE);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) halo.add((ey + dy) * g.w + (ex + dx));
  }
  return halo;
}

// BFS router (no teleports — the forts are all on the mainland)
function planRoute(g, p, gx, gy, avoidCamps = true) {
  const W = g.w, H = g.h;
  const sx = Math.floor(p.x / TILE), sy = Math.floor(p.y / TILE);
  const gtx = Math.floor(gx / TILE), gty = Math.floor(gy / TILE);
  const halo = avoidCamps ? campHalo(g) : null;
  const goal = gty * W + gtx;
  const dist = new Int32Array(W * H).fill(-1);
  const prev = new Int32Array(W * H).fill(-1);
  const start = sy * W + sx;
  const q = [start];
  dist[start] = 0;
  for (let h = 0; h < q.length; h++) {
    const cur = q[h], cx = cur % W, cy = (cur / W) | 0;
    if (cur === goal) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (dist[ni] !== -1 || blockedTile(g, nx, ny)) continue;
      if (halo && ni !== goal && halo.has(ni)) continue;
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

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const distT = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) / TILE;
function enemyNear(g, at, tiles) {
  const r2 = (TILE * tiles) ** 2;
  for (const e of g.enemies) { if (!e.dead && dist2(e, at) < r2) return true; }
  return false;
}

// 8-way facing: pick the dpad combo whose direction best matches the bearing
const DIRS = [
  { dx: 1, dy: 0, keys: { right: true } },
  { dx: -1, dy: 0, keys: { left: true } },
  { dx: 0, dy: 1, keys: { down: true } },
  { dx: 0, dy: -1, keys: { up: true } },
  { dx: 0.7071, dy: 0.7071, keys: { right: true, down: true } },
  { dx: 0.7071, dy: -0.7071, keys: { right: true, up: true } },
  { dx: -0.7071, dy: 0.7071, keys: { left: true, down: true } },
  { dx: -0.7071, dy: -0.7071, keys: { left: true, up: true } },
];
function bestDir(vx, vy) {
  const n = Math.hypot(vx, vy) || 1;
  let best = DIRS[0], bd = -2;
  for (const d of DIRS) {
    const dot = (d.dx * vx + d.dy * vy) / n;
    if (dot > bd) { bd = dot; best = d; }
  }
  return { dir: best, align: bd };
}

// is a friendly BUILT structure (or manned tower) sitting in this firing line?
function friendlyInLine(g, p, fx, fy) {
  const r2lim = (TILE * 2.6) ** 2;
  for (const b of g.builds) {
    if (!b.built || b.kind === 'farm') continue;
    const dx = b.x - p.x, dy = b.y - p.y;
    const dd = dx * dx + dy * dy;
    if (dd > r2lim) continue;
    const n = Math.sqrt(dd) || 1;
    if ((dx * fx + dy * fy) / n > 0.86) return true; // within ~30 deg, close
  }
  return false;
}

// --- bot state ----------------------------------------------------------------
// One guard per beacon fort. Gate posts/bombard posts derive from the fort
// geometry: every fort is a 7x7 wall ring with two 1-tile gates.
// (Beacon order in g.cores is parse order: NW, NE, SE, SW.)
const FORT_GATES = [
  // [open-gate tile (defended, never barricaded), barricade-gate site tile]
  { open: [31, 22], seal: [28, 25] }, // NW: defend east gate, seal south
  { open: [79, 30], seal: [82, 33] }, // NE: defend west gate, seal south
  { open: [78, 53], seal: [75, 56] }, // SE: defend north gate, seal west
  { open: [33, 60], seal: [30, 57] }, // SW: defend east gate, seal north
];

// Garrison plan: PAIR the squad on two forts (NW core0 + SW core3, same map
// flank): one overWalls mortar + one lane gunner each. Waves split across LIT
// beacons only, so two defended beacons each eat half a wave — and a fort can
// never fall while its pair is alive. NE/SE go dark on night 1 and stay dark;
// the lose rule needs ALL FOUR dark at once, and dawn relights cover the pair.
const ASSIGN = (process.env.SH25_ASSIGN || '0,0,0,0').split(',').map(Number);
const DEFENDED = [...new Set(ASSIGN)];
function mkBots(g) {
  return PARTY.map((pp, i) => ({
    pid: pp.pid, coreI: ASSIGN[i],
    route: [], routeGoal: null, repathT: 0,
    fleeT: 0, pickFlip: false, hired: false,
  }));
}

// Post: mortars bombard from beside the monolith (lobbing over their own
// walls); gunners hold INSIDE the fort, on the beacon-to-gate lane — wave
// enemies see them through the walls (sight ignores structures), engage, and
// funnel through the one open gate into point-blank fire.
function postFor(g, bot, i) {
  const core = g.cores[i];
  const side = (bot.pid % 2 === 0 ? -1 : 1) * 10; // de-stack pair members
  if (bot.mortar) return { x: core.x + side, y: core.y - TILE };
  const gate = FORT_GATES[i];
  const gx = (gate.open[0] + 0.5) * TILE, gy = (gate.open[1] + 0.5) * TILE;
  const n = Math.hypot(gx - core.x, gy - core.y) || 1;
  const ux = (gx - core.x) / n, uy = (gy - core.y) / n;
  return { x: core.x + ux * TILE * 1.6 - uy * side, y: core.y + uy * TILE * 1.6 + ux * side };
}

// The seat's operative changes on every death (roster consumption), so the
// loadout-derived fields re-derive each tick.
function refreshBot(g, bot, p) {
  const ch = charMap[p.charId];
  bot.ch = ch;
  bot.mortar = !!ch.weapon.overWalls;
  bot.range = ch.weapon.range ?? 5;
  bot.post = postFor(g, bot, bot.coreI);
}

function moveAlong(bot, p, inp) {
  while (bot.route.length && dist2(p, bot.route[0]) < 36) bot.route.shift();
  if (!bot.route.length) return false;
  const wp = bot.route[0];
  if (Math.abs(wp.x - p.x) > 4) inp[wp.x > p.x ? 'right' : 'left'] = true;
  if (Math.abs(wp.y - p.y) > 4) inp[wp.y > p.y ? 'down' : 'up'] = true;
  return true;
}

function routeTo(g, bot, p, gx, gy) {
  const key = (Math.floor(gx / TILE)) + ',' + (Math.floor(gy / TILE));
  if (bot.routeGoal !== key || bot.repathT <= 0 || !bot.route.length) {
    bot.route = planRoute(g, p, gx, gy);
    bot.routeGoal = key;
    bot.repathT = 1.2;
  }
  return bot.route.length > 0;
}

// Target priority: 1) anything actually GNAWING the guarded monolith (or
// about to), 2) acolytes in range (they shield the pack), 3) nearest awake.
function pickTarget(g, p, range, core) {
  let best = null, bd = Infinity, bestQ = null, bdQ = Infinity, bestG = null, bdG = Infinity;
  let bestB = null, bdB = Infinity;
  const gn2 = (TILE * 2.6) ** 2;
  for (const e of g.enemies) {
    if (e.dead || e.convertedT > 0 || !e.awake) continue;
    const d = dist2(p, e);
    if (d < bd) { bd = d; best = e; }
    if (e.kind === 'boss' && d < bdB) { bdB = d; bestB = e; }
    if (e.kind === 'acolyte' && d < bdQ) { bdQ = d; bestQ = e; }
    if (core && dist2(e, core) < gn2 && d < bdG) { bdG = d; bestG = e; }
  }
  if (bestG) return { e: bestG, d2: bdG };
  if (bestB && bdB < (range * TILE) ** 2) return { e: bestB, d2: bdB }; // burn bosses down
  if (bestQ && bdQ < (range * TILE) ** 2) return { e: bestQ, d2: bdQ };
  return best ? { e: best, d2: bd } : null;
}

function awakeNear(g, at, tiles) {
  const r2 = (TILE * tiles) ** 2;
  for (const e of g.enemies) { if (!e.dead && e.awake && dist2(e, at) < r2) return true; }
  return false;
}

function botCombat(g, bot, p, tgt, inp, post) {
  const e = tgt.e;
  const d = Math.sqrt(tgt.d2) / TILE;
  const { dir } = bestDir(e.x - p.x, e.y - p.y);
  const core = bot.guardCore;
  // flee: melee pile-up at point blank — fall back toward the monolith for a
  // few ticks (they follow single file through the gate)
  if (bot.fleeT > 0) {
    bot.fleeT -= DT;
    const away = bestDir(core.x - p.x, core.y - p.y).dir;
    Object.assign(inp, away.keys);
    return;
  }
  if (!bot.mortar && d < 1.3) {
    let pointBlank = 0;
    for (const o of g.enemies) { if (!o.dead && dist2(p, o) < (TILE * 1.4) ** 2) pointBlank++; }
    if (pointBlank >= 2 && distT(p, core) > 1.8) { bot.fleeT = 0.25; return; }
  }
  const maxR = bot.mortar ? bot.range - 0.5 : bot.range - 0.3;
  // hold the lane: only walk at targets that slipped INSIDE the fort (e.g.
  // beacon gnawers); everything outside is funneled to the gate by aggro.
  // Open-field self-defense: never turn your back on a chaser about to enter
  // weapon range — stand, face it, and let it walk into the line of fire.
  if (d > maxR) {
    if (d <= maxR + 2.5) {
      const facingDot = p.fx * dir.dx + p.fy * dir.dy;
      if (facingDot < 0.92) Object.assign(inp, dir.keys);
      return;
    }
    if (distT(e, core) < 3.2 && !bot.mortar) {
      routeTo(g, bot, p, e.x, e.y);
      moveAlong(bot, p, inp);
    } else if (distT(p, post) > 1.0) {
      routeTo(g, bot, p, post.x, post.y);
      moveAlong(bot, p, inp);
    }
    return;
  }
  // re-face only when the target leaves the current 8-way cone — a facing
  // tick nudges the bot, so constant re-facing would drag it off post
  const facingDot = p.fx * dir.dx + p.fy * dir.dy;
  if (facingDot < 0.92) Object.assign(inp, dir.keys);
  if (bot.mortar || !friendlyInLine(g, p, dir.dx, dir.dy)) inp.fire = true;
  // weapon special as a panic/boss button
  let near = 0;
  for (const o of g.enemies) { if (!o.dead && dist2(p, o) < (TILE * 4) ** 2) near++; }
  if (p.specialCool <= 0 && (near >= 3 || (e.kind === 'boss' && d < 7))) inp.special = true;
  // panic items
  if (p.item && p.item.kind === 'medkit' && p.hp <= 1) inp.item = true;
  else if (p.item && p.item.kind === 'shield' && p.shield === 0 && p.hp < p.maxHp) inp.item = true;
  else if (p.item && (p.item.kind === 'cracker' || p.item.kind === 'toxin')) {
    let swarm = 0;
    for (const o of g.enemies) { if (!o.dead && dist2(p, o) < (TILE * 6) ** 2) swarm++; }
    if (swarm >= (p.item.kind === 'toxin' ? 5 : 8)) inp.item = true;
  }
}

// drive the turret type carousel to TESLA (chain zap + 0.4s stun — the best
// funnel turret): hold act, tap right twice, confirm with fire
function driveCarousel(bot, inp) {
  inp.act = true;
  const seq = bot.selSeq || 0;
  // seq 0 sets the edge baseline; right-press on 1 and 3 (gun->prism->tesla);
  // fire on 5 confirms
  if (seq === 1 || seq === 3) inp.right = true;
  if (seq >= 5) inp.fire = true;
  bot.selSeq = seq + 1;
}

function botDuties(g, bot, p, inp) {
  const core = g.cores[bot.coreI];
  bot.tripping = false;
  // 0) a fresh turret waits in its type carousel: cycle it to tesla
  if (p.selecting) { driveCarousel(bot, inp); return; }
  bot.selSeq = 0;
  // 1) relight my monolith (day only; stepBeacons gates it anyway)
  if (!core.lit && g.shards >= 8) {
    if (distT(p, core) > 1.2) { routeTo(g, bot, p, core.x, core.y); moveAlong(bot, p, inp); }
    else inp.act = true;
    return;
  }
  // 1a) DECOY relight (gunners, early in the day): relighting the nearest
  // spare monolith splits the coming waves in half — its share spends the
  // night chewing a 30 hp decoy and arrives late — and it doubles the
  // distance to the allDark lose rule (the day-after mop-up can no longer
  // insta-lose the run when the home beacon slips). 8 shards a day, well spent.
  if (!bot.mortar && g.shards >= 20 && g.cycle.t > 50) {
    let decoy = null, dd = Infinity;
    for (let i = 0; i < g.cores.length; i++) {
      if (g.cores[i].lit || DEFENDED.includes(i)) continue;
      const d = dist2(core, g.cores[i]);
      if (d < dd) { dd = d; decoy = g.cores[i]; }
    }
    if (decoy) {
      bot.tripping = true;
      if (distT(p, decoy) > 1.2) { routeTo(g, bot, p, decoy.x, decoy.y); moveAlong(bot, p, inp); }
      else inp.act = true;
      return;
    }
  }
  // 2.5) WAR ECONOMY trip (gunners, early day, pool healthy): hire a combat
  // follower and shop for a damage token / shield pips / a medkit at the
  // central base, then sprint home
  if (!bot.mortar && g.cycle.t > 55 && g.shards >= 30
      && g.builds.some(b => b.built && b.kind === 'turret' && distT(b, core) < 4)) {
    const wantHire = !g.followers.some(f => !f.dead && f.owner === p.pid)
      && g.hires.some(h => !h.hired && (h.job === 'hound' || h.job === 'archer'));
    const wantIdx = (p.dmgBonus || 0) < 1 && g.shards >= 20 ? 0
      : p.shield === 0 && g.shards >= 12 ? 1
      : !p.item && g.shards >= 10 ? 3 : -1;
    if (wantHire && g.shards >= 24) {
      const h = g.hires.find(q => !q.hired && (q.job === 'hound' || q.job === 'archer'));
      bot.tripping = true;
      if (distT(p, h) > 1.2) { routeTo(g, bot, p, h.x, h.y); moveAlong(bot, p, inp); }
      else inp.act = true;
      return;
    }
    if (wantIdx >= 0 && g.shops.length) {
      const shop = g.shops[0];
      bot.tripping = true;
      if (distT(p, shop) > 1.2) { routeTo(g, bot, p, shop.x, shop.y); moveAlong(bot, p, inp); return; }
      // drive the shop carousel: act-hold engages, right edges seek the
      // offer, a fire edge buys it
      inp.act = true;
      const seq = bot.shopSeq || 0;
      if (p.shopping) {
        if (p.shopIdx !== wantIdx) { if (seq % 2 === 1) inp.right = true; }
        else if (seq % 2 === 1) inp.fire = true;
      }
      bot.shopSeq = seq + 1;
      return;
    }
  }
  bot.shopSeq = 0;
  // 1b) the OTHER defended monolith dark with BOTH of its guards out of
  // action: cross the map and relight it (all-dark insurance)
  if (g.shards >= 8) {
    for (const i of DEFENDED) {
      const c = g.cores[i];
      if (c.lit || i === bot.coreI) continue;
      const guarded = g.players.some((q, qi) => ASSIGN[qi] === i && q.state === 'active');
      if (guarded) continue;
      if (distT(p, c) > 1.2) { routeTo(g, bot, p, c.x, c.y); moveAlong(bot, p, inp); }
      else inp.act = true;
      return;
    }
  }
  // 2) seal the second gate (cost 4) to make ONE funnel, then the fort turret
  let site = null;
  for (const b of g.builds) {
    if (b.built) continue;
    if (b.kind === 'barricade' && Math.floor(b.x / TILE) === FORT_GATES[bot.coreI].seal[0]
        && Math.floor(b.y / TILE) === FORT_GATES[bot.coreI].seal[1] && g.shards >= 4) { site = b; break; }
    if (b.kind === 'turret' && distT(b, core) < 4 && g.shards >= 10) site = site || b;
  }
  if (site) {
    if (distT(p, site) > 1.2) { routeTo(g, bot, p, site.x, site.y); moveAlong(bot, p, inp); }
    else inp.act = true;
    return;
  }
  // 3) repair damaged fort structures (1 shard / 3 hp)
  if (g.shards >= 3) {
    let worst = null, worstFrac = 0.85;
    for (const b of g.builds) {
      if (!b.built || b.kind === 'farm' || distT(b, core) > 6) continue;
      const frac = b.hp / b.maxHp;
      if (frac < worstFrac) { worstFrac = frac; worst = b; }
    }
    if (worst) {
      if (distT(p, worst) > 1.2) { routeTo(g, bot, p, worst.x, worst.y); moveAlong(bot, p, inp); }
      else inp.act = true;
      return;
    }
  }
  // 3b) gunners hire a combat follower (hound/archer) for the lane
  if (!bot.mortar && g.shards >= 24) {
    const mine = g.followers.some(f => !f.dead && f.owner === p.pid);
    if (!mine) {
      let posts = g.hires.filter(h => !h.hired && (h.job === 'hound' || h.job === 'archer'));
      if (posts.length) {
        const h = posts[0];
        if (distT(p, h) > 1.2) { routeTo(g, bot, p, h.x, h.y); moveAlong(bot, p, inp); }
        else inp.act = true;
        return;
      }
    }
  }
  // 4) upgrade the fort turret with surplus shards (L2 8, L3 16)
  if (g.shards >= 20) {
    for (const b of g.builds) {
      if (!b.built || b.kind !== 'turret' || (b.level || 1) >= 3 || b.typeSelect || distT(b, core) > 4) continue;
      if (b.hp < b.maxHp) continue;
      if (distT(p, b) > 1.2) { routeTo(g, bot, p, b.x, b.y); moveAlong(bot, p, inp); }
      else inp.act = true;
      return;
    }
  }
  // 4b) then the seal-gate barricade (14 -> 22 -> 32 hp)
  if (g.shards >= 50) {
    for (const b of g.builds) {
      if (!b.built || b.kind !== 'barricade' || (b.level || 1) >= 3 || distT(b, core) > 4) continue;
      if (b.hp < b.maxHp) continue;
      if (distT(p, b) > 1.2) { routeTo(g, bot, p, b.x, b.y); moveAlong(bot, p, inp); }
      else inp.act = true;
      return;
    }
  }
  // NOTE on 5-7: targets are picked relative to the CORE, not the bot, so
  // both pair members converge on the same goal and escort each other.
  // 5) sweep shard drops near the fort
  let drop = null, dd = Infinity;
  for (const d of g.drops) {
    const dc = distT(d, core);
    if (dc > 16) continue;
    if (dc < dd) { dd = dc; drop = d; }
  }
  if (drop) { routeTo(g, bot, p, drop.x, drop.y); moveAlong(bot, p, inp); return; }
  // 6) open chests near the fort (skip any with company — even sleepers)
  let chest = null, cd = Infinity;
  for (const c of g.chests) {
    if (c.opened || enemyNear(g, c, 5)) continue;
    const dc = distT(c, core);
    if (dc > 14) continue;
    if (dc < cd) { cd = dc; chest = c; }
  }
  if (chest) {
    if (distT(p, chest) > 1.2) { routeTo(g, bot, p, chest.x, chest.y); moveAlong(bot, p, inp); }
    else inp.act = true;
    return;
  }
  // 7) crack LYTH crystals near the fort (4 shards each)
  let cry = null, cyd = Infinity;
  for (const c of g.crystals) {
    if (c.hp <= 0 || enemyNear(g, c, 5)) continue;
    const dc = distT(c, core);
    if (dc > 14) continue;
    if (dc < cyd) { cyd = dc; cry = c; }
  }
  if (cry) cyd = dist2(p, cry);
  if (cry) {
    const d = Math.sqrt(cyd) / TILE;
    if (d > 3.5) { routeTo(g, bot, p, cry.x, cry.y); moveAlong(bot, p, inp); return; }
    const { dir } = bestDir(cry.x - p.x, cry.y - p.y);
    const facingDot = p.fx * dir.dx + p.fy * dir.dy;
    if (facingDot < 0.99) Object.assign(inp, dir.keys);
    else if (!friendlyInLine(g, p, dir.dx, dir.dy)) inp.fire = true;
    return;
  }
  // 8) hold the post
  if (distT(p, bot.post) > 1.0) { routeTo(g, bot, p, bot.post.x, bot.post.y); moveAlong(bot, p, inp); }
}

function botTick(g, bot, p, mode) {
  const inp = {};
  // respawn pick: pickPrev starts all-held, so alternate fire off/on to
  // edge-confirm the first free roster operative
  if (p.state === 'pick') {
    bot.pickFlip = !bot.pickFlip;
    if (bot.pickFlip) inp.fire = true;
    return inp;
  }
  if (p.state !== 'active') return inp;
  refreshBot(g, bot, p);
  if (mode === 'idle') return inp;
  if (mode === 'board') {
    if (g.ship) {
      if (distT(p, g.ship) > 1.2) { routeTo(g, bot, p, g.ship.x, g.ship.y); moveAlong(bot, p, inp); }
      else inp.act = true;
      return inp;
    }
    // no ship yet: fall through to defense
  }
  const day = g.cycle.phase === 'day';
  // guard my own fort; if my monolith is DARK at night, reinforce the other
  // DEFENDED one (its besiegers re-target there) and come home to relight by
  // day; if the whole pair is dark, fall back to whatever is still lit
  let guardI = bot.coreI;
  if (!g.cores[guardI].lit && !day) {
    const other = DEFENDED.find(i => i !== bot.coreI && g.cores[i].lit);
    if (other !== undefined) guardI = other;
    else {
      let bd = Infinity;
      for (let i = 0; i < g.cores.length; i++) {
        if (!g.cores[i].lit) continue;
        const dd = dist2(g.cores[bot.coreI], g.cores[i]);
        if (dd < bd) { bd = dd; guardI = i; }
      }
    }
  }
  bot.guardCore = g.cores[guardI];
  const post = postFor(g, bot, guardI);
  if (!day) bot.tripping = false;
  // combat first: anything awake within engagement reach of me or the post —
  // unless we are mid-trip (decoy relight / shop run): then only self-defense
  const tgt = pickTarget(g, p, bot.range, bot.guardCore);
  if (tgt) {
    const dMe = Math.sqrt(tgt.d2) / TILE;
    const dCore = distT(tgt.e, bot.guardCore);
    const engage = bot.tripping ? dMe < 4 : (dMe < bot.range + 3 || dCore < 9);
    if (engage) {
      botCombat(g, bot, p, tgt, inp, post);
      return inp;
    }
  }
  if (p.selecting) { driveCarousel(bot, inp); return inp; }
  bot.selSeq = 0;
  // final seconds of daylight: regroup on the post before the dusk wave
  if (day && g.cycle.t > 12) { botDuties(g, bot, p, inp); return inp; }
  // night lull: gunners snatch shard drops near the fort (mortars hold)
  if (!day && !bot.mortar) {
    let drop = null, dd = Infinity;
    for (const d of g.drops) {
      const dc = distT(d, bot.guardCore);
      if (dc > 9 || enemyNear(g, d, 7)) continue;
      if (dc < dd) { dd = dc; drop = d; }
    }
    if (drop) { routeTo(g, bot, p, drop.x, drop.y); moveAlong(bot, p, inp); return inp; }
  }
  if (distT(p, post) > 1.0) { routeTo(g, bot, p, post.x, post.y); moveAlong(bot, p, inp); }
  return inp;
}

// --- run loop -----------------------------------------------------------------
function run(mode, maxS) {
  const g = createGame(def, PARTY, charMap, ROSTER);
  const bots = mkBots(g);
  const stats = {
    ticks: 0, simMs: 0, maxMs: 0, samples: [],
    peakEnemies: 0, kills: 0, downs: 0, relights: 0, beaconDowns: 0,
    bossSeen: 0, bossKilled: 0, shipDown: false, shipLaunch: false,
    waves: 0, allDark: false, darkTimeline: [], log: [],
  };
  const maxTicks = Math.ceil(maxS / DT);
  for (let t = 0; t < maxTicks && g.status === 'play'; t++) {
    // extract: turtle night 1 together, then fan out at dawn 1 — each seat
    // adopts one monolith (pid == core index), relights it by day and guards
    // it, so all four are lit when dusk 2 lands the Anchorcraft
    if (mode === 'extract' && g.cycle.nightNo >= 1 && g.cycle.phase === 'day' && !g.ship) {
      for (const bot of bots) bot.coreI = bot.pid;
    }
    const inputs = {};
    for (const bot of bots) {
      bot.repathT -= DT;
      const p = g.players[bot.pid];
      inputs[bot.pid] = botTick(g, bot, p, mode === 'extract' && g.cycle.nightNo >= 1 ? 'board' : mode === 'loss' ? 'idle' : 'play');
    }
    const t0 = performance.now();
    step(g, inputs, DT);
    const ms = performance.now() - t0;
    stats.ticks++;
    stats.simMs += ms;
    if (ms > stats.maxMs) stats.maxMs = ms;
    stats.samples.push(ms);
    if (g.enemies.length > stats.peakEnemies) stats.peakEnemies = g.enemies.length;
    for (const ev of g.events) {
      if (ev.type === 'dusk') {
        const lit = g.cores.filter(c => c.lit).length;
        stats.log.push(`dusk n${ev.nightNo}${ev.bloodMoon ? ' BLOODMOON' : ''} lit=${lit} shards=${Math.floor(g.shards)} score=${Math.round(g.score)}`);
      } else if (ev.type === 'dawn') {
        const lit = g.cores.filter(c => c.lit).length;
        const hps = g.cores.map(c => (c.lit ? c.hp : 'dark')).join('/');
        const lv = g.players.map(q => `${q.charId.slice(0, 4)}L${q.level || 1}+${q.dmgBonus || 0}`).join(' ');
        const tur = g.builds.filter(b => b.built && b.kind === 'turret').map(b => `${b.ttype || '?'}L${b.level || 1}`).join(',');
        const fol = g.followers.filter(f => !f.dead).length;
        stats.log.push(`dawn n${ev.nightNo} lit=${lit} hp=${hps} shards=${Math.floor(g.shards)} kills=${g.kills} downs=${stats.downs} | ${lv} | turrets=${tur || 'none'} followers=${fol}`);
      } else if (ev.type === 'beaconDown') {
        stats.beaconDowns++;
        stats.darkTimeline.push(`t=${Math.round(g.elapsed)}s beacon${ev.idx} DARK (night ${g.cycle.nightNo})`);
      } else if (ev.type === 'beaconLit') {
        stats.relights++;
        stats.darkTimeline.push(`t=${Math.round(g.elapsed)}s beacon${ev.idx} relit`);
      } else if (ev.type === 'chest' && DEBUG >= 3) {
        stats.log.push(`t=${Math.round(g.elapsed)}s chest ${ev.loot} by p${ev.pid} pool=${Math.floor(g.shards)}`);
      } else if (ev.type === 'crystal' && DEBUG >= 3) {
        stats.log.push(`t=${Math.round(g.elapsed)}s crystal cracked pool=${Math.floor(g.shards)}`);
      } else if (ev.type === 'built' && DEBUG >= 3) {
        stats.log.push(`t=${Math.round(g.elapsed)}s built ${ev.kind} L${ev.level || 1} at ${Math.floor(ev.x / TILE)},${Math.floor(ev.y / TILE)} pool=${Math.floor(g.shards)}`);
      } else if (ev.type === 'wave') stats.waves++;
      else if (ev.type === 'shipDown') stats.shipDown = true;
      else if (ev.type === 'shipLaunch') stats.shipLaunch = true;
      else if (ev.type === 'allDark') stats.allDark = true;
      else if (ev.type === 'down') {
        stats.downs++;
        if (DEBUG >= 2) {
          const near = g.enemies.filter(e => !e.dead && dist2(e, ev) < (TILE * 4) ** 2).map(e => e.kind);
          stats.log.push(`t=${Math.round(g.elapsed)}s DOWN at ${Math.floor(ev.x / TILE)},${Math.floor(ev.y / TILE)} ${g.cycle.phase}${g.cycle.nightNo} near=[${near.join(',')}]`);
        }
      }
    }
    if (DEBUG >= 3 && t % 300 === 0) {
      const ps = g.players.map(p => `p${p.pid}:${p.charId}@${Math.floor(p.x / TILE)},${Math.floor(p.y / TILE)}${p.state !== 'active' ? '(' + p.state + ')' : ''}`).join(' ');
      stats.log.push(`t=${Math.round(g.elapsed)}s pool=${Math.floor(g.shards)} ${ps}`);
    }
    if (DEBUG >= 2 && ms > 60 && g.elapsed - (stats.lastProf || -9) > 5) {
      stats.lastProf = g.elapsed;
      const stuck = g.enemies.filter(e => !e.dead && e.pathFailed);
      const tiles = stuck.slice(0, 12).map(e => Math.floor(e.x / TILE) + ',' + Math.floor(e.y / TILE)).join(' ');
      stats.log.push(`t=${Math.round(g.elapsed)}s SLOW tick ${ms.toFixed(0)}ms enemies=${g.enemies.length} pathFailed=${stuck.length} at: ${tiles}`);
    }
    for (const e of g.enemies) {
      if (e.kind === 'boss' && !e._seen) { e._seen = true; stats.bossSeen++; }
    }
    g.events.length = 0;
  }
  stats.samples.sort((a, b) => a - b);
  stats.p50 = stats.samples[Math.floor(stats.samples.length * 0.5)] || 0;
  stats.p99 = stats.samples[Math.floor(stats.samples.length * 0.99)] || 0;
  stats.avg = stats.simMs / Math.max(1, stats.ticks);
  stats.status = g.status;
  stats.elapsed = g.elapsed;
  stats.kills = g.kills;
  stats.score = g.score;
  stats.litEnd = g.cores.filter(c => c.lit).length;
  stats.nightNo = g.cycle.nightNo;
  stats.g = g;
  return stats;
}

console.log(`=== sh25 FINALITY playtest — mode: ${MODE} ===`);
const horizon = +(process.env.SH25_HORIZON || 0) || (MODE === 'loss' ? 1200 : MODE === 'extract' ? 700 : 2400);
const st = run(MODE, horizon);

for (const l of st.log) note(l);
if (DEBUG) for (const l of st.darkTimeline) note(l);

if (MODE === 'win') {
  check('mission cleared at final dawn', st.status === 'cleared' && st.nightNo === 10,
    `status=${st.status} night=${st.nightNo} elapsed=${Math.round(st.elapsed)}s`);
  check('>= 1 beacon lit at the end', st.litEnd >= 1, `lit=${st.litEnd}`);
  check('all 3 Entropy bosses marched', st.bossSeen >= 3, `bossSeen=${st.bossSeen}`);
  check('25 night waves fired (incl. blood-moon doubles)', st.waves >= 25, `waves=${st.waves}`);
  check('run was HARD (beacons went dark or squad got downed)', st.beaconDowns + st.downs > 0,
    `beaconDowns=${st.beaconDowns} relights=${st.relights} downs=${st.downs}`);
  note(`kills=${st.kills} score=${Math.round(st.score)} relights=${st.relights} beaconDowns=${st.beaconDowns} downs=${st.downs}`);
  note('(Anchorcraft landing/boarding is exercised by the extract mode)');
} else if (MODE === 'loss') {
  check('undefended map fails by allDark', st.allDark && st.status === 'failed',
    `status=${st.status} allDark=${st.allDark} at night ${st.nightNo}, t=${Math.round(st.elapsed)}s`);
  check('all four beacons went dark', st.beaconDowns >= 4, `beaconDowns=${st.beaconDowns}`);
} else if (MODE === 'extract') {
  check('Anchorcraft landed', st.shipDown, `night=${st.nightNo}`);
  check('boarding all four launched the ship', st.shipLaunch, `status=${st.status}`);
  check('early extraction cleared the mission', st.status === 'cleared',
    `status=${st.status} t=${Math.round(st.elapsed)}s score=${Math.round(st.score)}`);
}

console.log(`PERF  ticks=${st.ticks} avg=${st.avg.toFixed(3)}ms p50=${st.p50.toFixed(3)}ms p99=${st.p99.toFixed(3)}ms max=${st.maxMs.toFixed(2)}ms peakEnemies=${st.peakEnemies}`);
console.log(`(budget: 33.3ms/tick @ 30Hz)`);

const failed = checks.filter(c => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
