// Headless playtest: STORY CHAPTER VIII (levels/story/ch08.json, "The Prover Array").
// Four scripted operatives drive the full chapter through the real sim:
//
//   pid 0  LANCE  sniper  the ball's long gun (rail only — no railcannon ammo
//                         to waste on husks), pillar finisher, sw4
//   pid 1  RUNNER scout   quest talks, proof fragment, seal forge, vault sweep, sw5-8
//   pid 2  GHOST  shade   deep-slot pillar finisher, sw3, the completion-talk round trip
//   pid 3  SPARK  volt    stormgun, save beacon, sweep support, sw9
//
// DEATHBALL DOCTRINE: the whole squad marches as one 4-gun ball through the
// entire prep arc (sel-brakka -> forge quarter -> NW pillar camp -> mint ->
// archive strip -> eastern colonnade -> muster -> boss nook -> vault sweep),
// with regroup waits stitching the legs. Solo errands kept dying to camps.
// The vault assault is GATED: nobody engages until every seat is parked on
// its muster wait with every pillar down (flags.muster), the boss is pulled
// up the nook corridor into four anchored guns, and the vault interior (ward
// acolytes + the phase stalker that assassinated Runner in earlier drafts)
// is swept clean (flags.vaultSwept) before the first relay is thrown. The
// sleeping brood south of the vault (spawner @78,53) and the nest sniper
// @85,42 are walled off LOS-wise and deliberately never woken.
//
// Mission beats verified, in order:
//   - quests activate at sel-brakka; untimed story clock (timeLeft frozen)
//   - 6 BLS pillars destroyed under guard pressure (destroy quest counts)
//   - proof fragment fetched; seal forged (20 shards + fragment consumed)
//   - vault sealLock door opens on lythseal touch; Phantom-reveal flag
//     (snapshot players hasSeal) live within 6 tiles of an acolyte
//   - quorum attempt 1: exactly 6 of 10 thrown -> 120s window expires ->
//     switchReset wipes the cluster clean (re-throwable)
//   - quorum attempt 2: 7 of 10 inside the window -> quorum -> core-gate opens
//   - save beacon built mid-run -> serializeGame/restoreGame resume determinism
//   - reach quest at the Array core, full squad extraction -> status 'cleared'
//   - teleport network is the only route between compartments (counts logged)
//
// Run: node scripts/playtest-ch8.mjs   (exit 0 = all checks pass)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { charsById, createGame, restoreGame, serializeGame, snapshot, step, TILE } from '../shared/game.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const def = JSON.parse(fs.readFileSync(path.join(root, 'levels/story/ch08.json'), 'utf8'));
const characters = JSON.parse(fs.readFileSync(path.join(root, 'shared/characters.json'), 'utf8'));
const charMap = charsById(characters);

const DT = 1 / 30;
const DEBUG = +(process.env.CH8_DEBUG || 0);
const TRACE = process.env.CH8_TRACE ? process.env.CH8_TRACE.split(',').map(Number) : []; // [pid, fromT, toT]
const checks = [];
const issues = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) issues.push(`${name}${detail ? ' (' + detail + ')' : ''}`);
}
function note(msg) { console.log('      ' + msg); }

// --- deterministic pad-aware router ------------------------------------------
// BFS over walkable tiles; teleport pads add a directed edge to their twin.
// Closed doors, built structures and (unless allowed) live 'E' exit tiles are
// rock. Path comes back as px waypoints; pad jumps carry a marker so the
// walker knows to stand and channel.
const footBlocked = c => c === '#' || c === 'T' || c === '~' || c === 'o';
const tileC = (g, x, y) => g.grid[y]?.[x] ?? '#';

function blockedTile(g, tx, ty, allowExit) {
  const c = tileC(g, tx, ty);
  if (footBlocked(c)) return true;
  if (c === 'E' && !allowExit) return true; // never stumble into an extraction
  for (const d of g.doors) {
    if (!d.open && tx >= d.x && tx < d.x + d.w && ty >= d.y && ty < d.y + d.h) return true;
  }
  for (const b of g.builds) {
    if (b.built && b.kind !== 'farm' && Math.floor(b.x / TILE) === tx && Math.floor(b.y / TILE) === ty) return true;
  }
  return false;
}

function planRoute(g, p, gx, gy, allowExit = false) {
  const W = g.w, H = g.h;
  const sx = Math.floor(p.x / TILE), sy = Math.floor(p.y / TILE);
  const gtx = Math.floor(gx / TILE), gty = Math.floor(gy / TILE);
  const padAt = new Map(); // tileIdx -> twin tileIdx
  for (const t of g.teleports) {
    const twin = t.twin != null ? g.teleports.find(o => o.id === t.twin) : null;
    if (!twin) continue;
    padAt.set(Math.floor(t.y / TILE) * W + Math.floor(t.x / TILE),
      Math.floor(twin.y / TILE) * W + Math.floor(twin.x / TILE));
  }
  const dist = new Int32Array(W * H).fill(-1);
  const prev = new Int32Array(W * H).fill(-1);
  const via = new Uint8Array(W * H); // 1 = arrived by pad jump
  const start = sy * W + sx;
  const q = [start];
  dist[start] = 0;
  for (let h = 0; h < q.length; h++) {
    const cur = q[h], cx = cur % W, cy = (cur / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (dist[ni] !== -1 || blockedTile(g, nx, ny, allowExit)) continue;
      dist[ni] = dist[cur] + 1;
      prev[ni] = cur;
      q.push(ni);
    }
    const tw = padAt.get(cur);
    if (tw !== undefined && dist[tw] === -1 && !blockedTile(g, tw % W, (tw / W) | 0, allowExit)) {
      dist[tw] = dist[cur] + 8; // a pad costs channel time; still a shortcut
      prev[tw] = cur;
      via[tw] = 1;
      q.push(tw);
    }
  }
  // exact goal, else nearest reachable tile to it (stable argmin)
  let best = -1, bestScore = Infinity;
  if (dist[gty * W + gtx] !== -1) best = gty * W + gtx;
  else {
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] === -1) continue;
      const d = Math.hypot((i % W) - gtx, ((i / W) | 0) - gty) * 10 + dist[i] * 0.05;
      if (d < bestScore) { bestScore = d; best = i; }
    }
  }
  if (best === -1 || !Number.isFinite(best)) return [];
  const rev = [];
  for (let i = best; i >= 0; i = prev[i]) { rev.push({ i, pad: via[i] === 1 }); }
  rev.reverse();
  const wps = [];
  for (let k = 1; k < rev.length; k++) {
    const { i, pad } = rev[k];
    wps.push({ x: ((i % W) + 0.5) * TILE, y: (((i / W) | 0) + 0.5) * TILE, jump: pad });
  }
  return wps;
}

function losShot(g, ax, ay, bx, by) {
  const d = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(d / 12));
  for (let i = 1; i < steps; i++) {
    const x = ax + (bx - ax) * (i / steps), y = ay + (by - ay) * (i / steps);
    const c = tileC(g, Math.floor(x / TILE), Math.floor(y / TILE));
    if (c === '#' || c === 'T') return false;
    for (const dd of g.doors) {
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      if (!dd.open && tx >= dd.x && tx < dd.x + dd.w && ty >= dd.y && ty < dd.y + dd.h) return false;
    }
  }
  return true;
}

// --- bot chassis ---------------------------------------------------------------
function makeBot(pid, tasks) {
  return {
    pid, tasks, ti: 0, path: [], repath: 0, mem: {}, stuck: 0, doorsKey: '',
  };
}

function weaponRange(g, p) {
  if (p.fieldWeapon) return { flamer: 4, railcannon: 13, stormgun: 7, mortarMk2: 8 }[p.fieldWeapon.kind] ?? 6;
  const ch = charMap[p.charId];
  return ch?.weapon?.range ?? 5;
}

function onPadTile(g, p) {
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
  return g.teleports.some(t => t.twin != null && Math.floor(t.x / TILE) === tx && Math.floor(t.y / TILE) === ty);
}

// idle bots must never camp a live pad (0.8s of standing = an accidental blink)
function sidestepPad(g, p, inp) {
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
  if (!blockedTile(g, tx, ty + 1, false)) inp.down = true;
  else if (!blockedTile(g, tx + 1, ty, false)) inp.right = true;
  else if (!blockedTile(g, tx - 1, ty, false)) inp.left = true;
  else inp.up = true;
}

function aimAt(p, x, y, inp) {
  const d = Math.hypot(x - p.x, y - p.y) || 1;
  p.fx = (x - p.x) / d;
  p.fy = (y - p.y) / d;
  inp.fire = true;
}

// Combat reflex: engage awake foes in range, or anything close enough to be a
// problem. Acolytes (Classical Phantom support) die first inside range. Hold
// ground to keep facing true; back off anything inside 1.6 tiles.
function combatReflex(g, bot, p, inp, engageT) {
  let tgt = null, bd = Infinity, aco = null, ad = Infinity;
  for (const e of g.enemies) {
    if (e.dead) continue;
    if ((bot.mem.banUntil?.get(e.id) ?? -1) > bot.mem.frame) continue; // proven whiff target
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    const interested = (e.awake && d < engageT * TILE) || d < 4.5 * TILE;
    if (!interested) continue;
    if (!losShot(g, p.x, p.y, e.x, e.y)) continue;
    if (d < bd) { bd = d; tgt = e; }
    if (e.kind === 'acolyte' && d < ad) { ad = d; aco = e; }
  }
  if (!tgt) return false;
  if (aco && ad < engageT * TILE) { tgt = aco; bd = ad; } // priority kill
  // too close: give ground (movement sets facing, so no fire this frame) —
  // EXCEPT from acolytes: they never raise a hand, so backing off from one
  // is an endless no-fire dance. Stand on its toes and shoot it.
  if (bd < 1.6 * TILE && tgt.kind !== 'acolyte') {
    const ux = (p.x - tgt.x) / (bd || 1), uy = (p.y - tgt.y) / (bd || 1);
    if (ux < -0.3) inp.left = true; else if (ux > 0.3) inp.right = true;
    if (uy < -0.3) inp.up = true; else if (uy > 0.3) inp.down = true;
    return true;
  }
  // out of true reach: keep tasking. Projectiles die at exactly range*TILE,
  // so an enemy parked AT max range eats infinite whiffs while the reflex
  // pins the bot in place — engage only what the shots can actually touch.
  if (bd > (weaponRange(g, p) - 0.5) * TILE) return false;
  // never stand-and-fight ON a live pad — sidestep first
  if (onPadTile(g, p) && !bot.mem.padWait) { sidestepPad(g, p, inp); return true; }
  // WHIFF BREAKER: bot losShot is a 12px-sampled ray — a corner the sampler
  // misses can eat every real projectile, pinning the bot in an infinite
  // stand-and-fire. 4s of zero hp progress on a distant target bans it for
  // 10s and gives the task its legs back (close targets always stay live).
  if (bd > 2.5 * TILE) {
    const w = bot.mem.whiff;
    if (w && w.id === tgt.id && tgt.hp >= w.hp) {
      if (bot.mem.frame - w.t > 120) {
        (bot.mem.banUntil ??= new Map()).set(tgt.id, bot.mem.frame + 300);
        bot.mem.whiff = null;
        return false;
      }
    } else {
      bot.mem.whiff = { id: tgt.id, hp: tgt.hp, t: bot.mem.frame };
    }
  }
  aimAt(p, tgt.x, tgt.y, inp);
  return true;
}

function walkTo(g, bot, p, gx, gy, inp, allowExit = false) {
  const doorsKey = g.doors.map(d => +d.open).join('') + ':' + g.builds.filter(b => b.built).length;
  bot.repath--;
  const moved = Math.hypot((bot.mem.gx ?? -1) - gx, (bot.mem.gy ?? -1) - gy) > TILE;
  if (bot.repath <= 0 || moved || !bot.path.length || bot.doorsKey !== doorsKey) {
    bot.path = planRoute(g, p, gx, gy, allowExit);
    bot.mem.gx = gx; bot.mem.gy = gy;
    bot.doorsKey = doorsKey;
    bot.repath = 24;
  }
  // pad jump pending? stand on the source pad and wait out the channel
  if (bot.path.length && bot.path[0].jump) {
    const padWp = bot.mem.padFrom;
    if (padWp && Math.hypot(p.x - bot.path[0].x, p.y - bot.path[0].y) < TILE * 1.5) {
      // the blink landed — consume the jump marker and march on
      bot.path.shift();
      bot.mem.padFrom = null;
      bot.mem.padWait = false;
      return false;
    }
    const src = padWp || { x: Math.floor(p.x / TILE) * TILE + TILE / 2, y: Math.floor(p.y / TILE) * TILE + TILE / 2 };
    bot.mem.padFrom = src;
    bot.mem.padWait = true;
    if (Math.hypot(src.x - p.x, src.y - p.y) > 6) {
      if (src.x < p.x - 3) inp.left = true; else if (src.x > p.x + 3) inp.right = true;
      if (src.y < p.y - 3) inp.up = true; else if (src.y > p.y + 3) inp.down = true;
    }
    return false;
  }
  bot.mem.padWait = false;
  while (bot.path.length && !bot.path[0].jump && Math.hypot(bot.path[0].x - p.x, bot.path[0].y - p.y) < 14) {
    const wp = bot.path.shift();
    if (bot.path.length && bot.path[0].jump) bot.mem.padFrom = wp; // next leg channels HERE
  }
  const wp = bot.path[0];
  if (!wp) {
    const d = Math.hypot(gx - p.x, gy - p.y);
    if (d < TILE * 1.45) { bot.stuck = 0; return true; } // nearest-reachable arrival
    bot.stuck++;
    bot.repath = 0;
    return bot.stuck > 240; // truly unreachable: give up rather than hang the run
  }
  if (wp.jump) return false; // handled next frame
  if (wp.x < p.x - 4) inp.left = true; else if (wp.x > p.x + 4) inp.right = true;
  if (wp.y < p.y - 4) inp.up = true; else if (wp.y > p.y + 4) inp.down = true;
  return false;
}

// One task per frame. Returns inputs for this bot.
function think(g, bot, flags, frame) {
  const p = g.players[bot.pid];
  const inp = {};
  bot.mem.frame = frame; // whiff-breaker clock
  if (!p || p.state !== 'active') {
    // down -> pick: confirm the first free operative so the seat comes back
    if (p && p.state === 'pick') { if (frame % 8 === 0) inp.fire = true; }
    return inp;
  }
  // emergency medkit
  if (p.hp <= 1 && p.item && p.item.kind === 'medkit' && p.item.count > 0 && !bot.mem.itemPrev) inp.item = true;
  bot.mem.itemPrev = !!inp.item;

  let task = bot.tasks[bot.ti];
  while (task && task.skipIf && task.skipIf(g, flags)) { task = bot.tasks[++bot.ti]; }
  if (!task) {
    if (combatReflex(g, bot, p, inp, bot.engageT || 6.5)) return inp;
    if (onPadTile(g, p)) sidestepPad(g, p, inp);
    return inp;
  }

  // combat first, except where a task must own the seat's hands
  const quiet = task.t === 'act' || task.t === 'holdact';
  if (!quiet && combatReflex(g, bot, p, inp, bot.engageT || 6.5)) {
    if (task.t !== 'walk' || !bot.mem.padWait) return inp;
  }

  switch (task.t) {
    case 'walk': {
      if (walkTo(g, bot, p, task.x * TILE, task.y * TILE, inp, task.allowExit)) { bot.ti++; bot.mem.actT = 0; }
      break;
    }
    case 'wait': {
      // optional timeout (frames): a regroup must never hang the campaign on
      // one wedged straggler — the ball moves on and the straggler catches up
      bot.mem.waitT = (bot.mem.waitT || 0) + 1;
      if (task.until(g, flags) || (task.timeout && bot.mem.waitT > task.timeout)) { bot.ti++; bot.mem.waitT = 0; }
      else if (onPadTile(g, p)) sidestepPad(g, p, inp);
      break;
    }
    case 'act': { // edge press, optionally verified + retried
      bot.mem.actT = (bot.mem.actT || 0) + 1;
      if (!task.check) { // fire-and-forget: one press, move on
        if (bot.mem.actT === 1) inp.act = true;
        else { bot.ti++; bot.mem.actT = 0; }
        break;
      }
      if (task.check(g, flags)) { bot.ti++; bot.mem.actT = 0; break; }
      if (bot.mem.actT % 16 === 1) inp.act = true; // press, settle, re-check
      if (bot.mem.actT > 16 * 12) { bot.ti++; bot.mem.actT = 0; flags.actWhiffs.push(`pid${bot.pid}@task${bot.ti}`); }
      break;
    }
    case 'holdact': { // forge mint / structure build
      inp.act = true;
      if (task.until(g, flags)) { bot.ti++; }
      break;
    }
    case 'shoot': { // stand off and pour fire until the condition clears
      if (task.until(g, flags)) { bot.ti++; break; }
      const tx = task.x * TILE, ty = task.y * TILE;
      // ANCHORED fire: hold a fixed stand and shoot only from there (no
      // creeping toward the target down a death alley); combatReflex still
      // owns anything that closes — the anchor is where the fight is taken
      if (task.holdX !== undefined) {
        const hx = task.holdX * TILE, hy = task.holdY * TILE;
        if (Math.hypot(hx - p.x, hy - p.y) > 1.0 * TILE) {
          walkTo(g, bot, p, hx, hy, inp);
        } else if (onPadTile(g, p)) {
          sidestepPad(g, p, inp);
        } else if (losShot(g, p.x, p.y, tx, ty) && Math.hypot(tx - p.x, ty - p.y) <= weaponRange(g, p) * TILE) {
          aimAt(p, tx, ty, inp);
        }
        break;
      }
      const standoff = Math.min(task.range ?? 7, weaponRange(g, p) - 0.8);
      const d = Math.hypot(tx - p.x, ty - p.y);
      if (d > standoff * TILE || !losShot(g, p.x, p.y, tx, ty)) {
        walkTo(g, bot, p, tx, ty, inp);
      } else if (onPadTile(g, p)) {
        sidestepPad(g, p, inp);
      } else {
        aimAt(p, tx, ty, inp);
      }
      break;
    }
    case 'touchdoor': { // sealLock doors swing on lythseal touch
      const d = g.doors.find(dd => dd.id === task.id);
      if (!d || d.open) { bot.ti++; break; }
      const cx = (d.x + d.w / 2) * TILE, cy = (d.y + d.h / 2) * TILE;
      if (Math.hypot(cx - p.x, cy - p.y) > TILE * 2.2) {
        walkTo(g, bot, p, cx, cy, inp);
      } else {
        // close: walkTo would declare arrival a hair OUTSIDE the touch ring
        // (the goal tile is the door itself), so nudge straight into the
        // rect until the seal registers — collision pins us at contact
        if (cx < p.x - 2) inp.left = true; else if (cx > p.x + 2) inp.right = true;
        if (cy < p.y - 2) inp.up = true; else if (cy > p.y + 2) inp.down = true;
      }
      break;
    }
  }
  return inp;
}

// --- mission script ---------------------------------------------------------------
const PILL = id => g => !g.pillars.some(pl => pl.id === id);
// stationary kinds can be addressed by their home tile (they never move)
const NEST = (kind, tx, ty) => g => !g.enemies.some(e => !e.dead && e.kind === kind
  && Math.floor(e.x / TILE) === tx && Math.floor(e.y / TILE) === ty);
const SW = id => g => !!g.switches.find(s => s.id === id)?.on;
const CHEST = (tx, ty) => g => !!g.chests.find(c => Math.floor(c.x / TILE) === tx && Math.floor(c.y / TILE) === ty)?.opened;
const at = (g, pid, tx, ty, r = 3) => {
  const p = g.players[pid];
  return p && p.state === 'active' && Math.hypot(p.x - (tx + 0.5) * TILE, p.y - (ty + 0.5) * TILE) < r * TILE;
};
const VAULT_BOSS = { x: 69.5, y: 46.5 };
const CORE_BOSS = { x: 86.5, y: 32.5 };
const MUSTER = { x: 57.5, y: 37.5 };

// DEATHBALL DOCTRINE. Every camp on this map can kill one or two 3-hp
// operatives but folds to four overlapping guns, so the squad moves as ONE
// BALL through the whole prep arc: sel-brakka -> forge quarter -> NW pillar
// camp -> forge mint -> archive strip -> eastern colonnade -> muster -> boss
// nook -> vault sweep. Regroup waits stitch the legs together, and the
// respawn-beside-an-ally rule means a lost operative re-picks and rejoins the
// ball in seconds instead of soloing a hot map crossing.
const together = g => {
  const act = g.players.filter(p => p.state === 'active');
  if (act.length <= 1) return true;
  const cx = act.reduce((s, p) => s + p.x, 0) / act.length;
  const cy = act.reduce((s, p) => s + p.y, 0) / act.length;
  return act.every(p => Math.hypot(p.x - cx, p.y - cy) < 7 * TILE);
};
const REGROUP = { t: 'wait', until: together, timeout: 30 * 45 };

// The shared ball march: sel-brakka muster -> west pad -> hask -> fragment
// corner -> NW pillar-camp anchors -> forge yard -> north pad -> the archive
// strip (regrouped at three checkpoints) -> east pad -> colonnade east
// entrance. Per-seat business (talks, the mint, the scoop) rides on top.
const ballTo = wps => wps.flatMap(([x, y]) => ([{ t: 'walk', x, y }, REGROUP]));

// The boss assault: hold an ANCHOR at the nook corridor mouth and let the
// boss walk INTO the guns — Lance's rail wakes and bleeds it from 9 tiles,
// the corridor funnels it, and the open rows 31-32 behind the anchors give
// every back-off somewhere safe to go. (The free-roaming version walked the
// squishies down the canal dead-end at x65 and they died there one by one.)
const bossAssault = (hx, hy) => ([
  { t: 'walk', x: MUSTER.x, y: MUSTER.y },
  { t: 'wait', tag: 'muster', until: (g, f) => f.muster },
  { t: 'shoot', x: VAULT_BOSS.x, y: VAULT_BOSS.y, holdX: hx, holdY: hy, until: (g, f) => f.vaultBossDead },
]);

// Colonnade pillar fire from a fixed anchor; a pillar beyond this seat's
// reach leaves the seat standing guard at the anchor until the rail (or the
// advancing pair) fells it — the until() passes either way.
const PILL_X = { pl0: 20.5, pl1: 23.5, pl2: 26.5, pl3: 58.5, pl4: 61.5, pl5: 64.5 };
const PILL_Y = { pl0: 8.5, pl1: 8.5, pl2: 8.5, pl3: 22.5, pl4: 22.5, pl5: 22.5 };
const pillShots = (holdX, holdY, pills) => pills.map(id => ({
  t: 'shoot', x: PILL_X[id], y: PILL_Y[id], holdX, holdY, until: PILL(id),
}));
// the colonnade is taken from its EAST entrance: the nest sniper dies first
// to four anchored guns parked inside its blind pocket
const snipeNest = (hx, hy) => ({ t: 'shoot', x: 65.5, y: 26.5, holdX: hx, holdY: hy, until: NEST('sniper', 65, 26) });

// Quorum throws are FIXED ASSIGNMENTS — exactly 6 voices in the deliberate
// fail (Lance sw4, Runner sw5+6+7, Ghost sw3, Spark sw9) and exactly 7 in the
// success run (the same six plus Runner's sw8), so the precise event counts
// the verdicts demand can never drift.
const coreAssault = (sx, sy, range) => ([
  { t: 'wait', until: (g, f) => f.coreOpen },
  { t: 'walk', x: sx, y: sy },
  { t: 'shoot', x: CORE_BOSS.x, y: CORE_BOSS.y, range, until: (g, f) => f.coreBossDead || g.elapsed > f.coreOpenT + 120 },
]);

// the shared march, by leg (regroups included); the NW pillar-camp anchors
// and colonnade anchors are per-seat and ride between these legs
const MARCH = {
  gather: [[12.5, 45.5]],            // form the ball at sel-brakka
  west: [[14.5, 22.5], [13.5, 19.5]], // west pad a->b into the forge quarter
  fragment: [[5.5, 5.5]],            // the proof-fragment corner
  forgeYard: [[10.5, 12.5]],         // guard the mint
  strip: [[27.5, 5.5], [42.5, 4.5], [57.5, 4.5], [70.5, 4.5], [84.5, 17.5], [82.5, 19.5], [70.5, 19.5]],
};

function buildBots() {
  // pid 0 LANCE (sniper): the ball's long gun — rail lance only (the
  // railcannon stays on its rack: reflex fire was draining it on husks long
  // before any boss saw a shot). Solo-finishes whatever outranges the others.
  const lance = makeBot(0, [
    { t: 'wait', until: (g, f) => f.questsActive },
    ...ballTo([...MARCH.gather, ...MARCH.west, ...MARCH.fragment]),
    { t: 'walk', x: 17.5, y: 12.5 },
    ...pillShots(17.5, 12.5, ['pl0']),
    { t: 'shoot', x: 23.5, y: 8.5, range: 9, until: PILL('pl1') }, // approach: the camp is engaged by now
    { t: 'shoot', x: 26.5, y: 8.5, range: 9, until: PILL('pl2') },
    ...ballTo(MARCH.forgeYard),
    { t: 'wait', until: (g, f) => f.sealForged }, // guard the mint + settle talk
    ...ballTo(MARCH.strip),
    { t: 'wait', tag: 'east', until: (g, f) => f.eastReady },
    snipeNest(69.5, 24.5),
    ...pillShots(70.5, 20.5, ['pl5', 'pl4', 'pl3']), // pl3 anchors him as rear guard
    ...bossAssault(69.5, 37.5), // rail reaches the sleeping boss from here
    { t: 'walk', x: 68.5, y: 40.5 }, // cover the sweep from the nook mouth
    { t: 'wait', until: (g, f) => f.vaultSwept },
    { t: 'walk', x: 60.5, y: 39.6 }, // sw4 station (60,38)
    { t: 'wait', until: (g, f) => f.goFail },
    { t: 'act', check: SW('voice-4') }, // fail throw 1 of exactly 6
    { t: 'wait', until: (g, f) => f.switchReset },
    { t: 'walk', x: 60.5, y: 39.6 },
    { t: 'wait', until: (g, f) => f.goSuccess },
    { t: 'act', check: SW('voice-4') }, // success throw 1 of exactly 7
    ...coreAssault(78.5, 31.5, 10),
    { t: 'walk', x: 85.5, y: 31.5 },
    { t: 'walk', x: 88.5, y: 31.5, allowExit: true }, // extract
  ]);
  lance.engageT = 10;

  // pid 1 RUNNER (scout): quest giver, fragment, forge, then the seal-bearer's
  // duties — open the vault, sweep its wards, and throw the inner relays
  const runner = makeBot(1, [
    { t: 'walk', x: 10.5, y: 44.4 }, { t: 'act', check: (g, f) => f.questsActive }, // sel-brakka
    REGROUP,
    ...ballTo(MARCH.west.slice(0, 1)),
    { t: 'walk', x: 12.5, y: 17.3 }, { t: 'act', check: g => g.quests.find(q => q.id === 'q-seal').state !== 'hidden' }, // hask
    REGROUP,
    { t: 'walk', x: 4.5, y: 4.5 },   // proof fragment (touch-scoop)
    REGROUP,
    { t: 'walk', x: 19.5, y: 11.5 },
    ...pillShots(19.5, 11.5, ['pl0', 'pl1', 'pl2']), // pl2 anchors him as guard
    { t: 'walk', x: 9.5, y: 12.5 },
    { t: 'wait', until: g => g.shards >= 20 },
    { t: 'walk', x: 8.6, y: 12.5 },
    { t: 'holdact', until: (g, f) => f.sealForged },
    { t: 'walk', x: 12.5, y: 17.3 }, { t: 'act', check: g => g.quests.find(q => q.id === 'q-seal').state === 'done' }, // settle q-seal
    ...ballTo(MARCH.strip),
    { t: 'wait', tag: 'east', until: (g, f) => f.eastReady },
    snipeNest(68.5, 24.5),
    ...pillShots(68.5, 20.5, ['pl5']),
    { t: 'shoot', x: 61.5, y: 22.5, range: 5, until: PILL('pl4') }, // advance the cleared slot
    { t: 'shoot', x: 58.5, y: 22.5, range: 5, until: PILL('pl3') },
    ...bossAssault(68.5, 36.5),
    { t: 'touchdoor', id: 'vault' },
    // interior sweep: wake and drop the ward acolytes and the phase stalker
    // BEFORE anyone stands still at a relay (the stalker's blink-maul is what
    // kept killing the bearer mid-sequence)
    { t: 'walk', x: 74.5, y: 42.6 },
    { t: 'walk', x: 76.5, y: 44.5 },
    { t: 'walk', x: 78.5, y: 46.4 },
    { t: 'walk', x: 80.5, y: 49.6 }, { t: 'act', check: CHEST(80, 48) }, // vault token (+1 dmg)
    { t: 'walk', x: 76.5, y: 44.5 },
    { t: 'wait', until: (g, f) => f.vaultSwept },
    { t: 'walk', x: 74.5, y: 42.6 }, // sw5 station
    { t: 'wait', until: (g, f) => f.goFail },
    { t: 'act', check: SW('voice-5') },                                  // sw5 (74,41)
    { t: 'walk', x: 78.5, y: 42.6 }, { t: 'act', check: SW('voice-6') }, // sw6 (78,41)
    { t: 'walk', x: 74.5, y: 46.4 }, { t: 'act', check: SW('voice-7') }, // sw7 (74,47) = 6th throw
    { t: 'walk', x: 76.5, y: 44.5 }, // hold the swept vault through the window
    { t: 'wait', until: (g, f) => f.switchReset },
    { t: 'walk', x: 74.5, y: 42.6 },
    { t: 'wait', until: (g, f) => f.goSuccess },
    { t: 'act', check: SW('voice-5') },
    { t: 'walk', x: 78.5, y: 42.6 }, { t: 'act', check: SW('voice-6') },
    { t: 'walk', x: 74.5, y: 46.4 }, { t: 'act', check: SW('voice-7') },
    { t: 'walk', x: 78.5, y: 46.4 }, { t: 'act', check: SW('voice-8') }, // 7th voice = quorum
    ...coreAssault(78.5, 32.5, 9),
    { t: 'walk', x: 85.5, y: 32.5 }, // the Array core: q-core 'reach'
    { t: 'walk', x: 88.5, y: 32.5, allowExit: true },
  ]);

  // pid 2 GHOST (shade): ball gun, the colonnade's deep-slot finisher, sw3,
  // then the settle-the-ledger talk run (no solo chest economy any more —
  // every lone errand on this map was a death sentence)
  const ghost = makeBot(2, [
    { t: 'wait', until: (g, f) => f.questsActive },
    ...ballTo([...MARCH.gather, ...MARCH.west, ...MARCH.fragment]),
    { t: 'walk', x: 17.5, y: 11.5 },
    ...pillShots(18.5, 11.5, ['pl0', 'pl1', 'pl2']), // pl2 anchors him as guard
    ...ballTo(MARCH.forgeYard),
    { t: 'wait', until: (g, f) => f.sealForged },
    ...ballTo(MARCH.strip),
    { t: 'wait', tag: 'east', until: (g, f) => f.eastReady },
    snipeNest(69.5, 25.5),
    ...pillShots(68.5, 21.5, ['pl5']),
    ...pillShots(63.5, 21.5, ['pl4', 'pl3']), // shade reaches both down the slot
    ...bossAssault(69.5, 35.5),
    { t: 'walk', x: 56.5, y: 40.5 }, // south route: the rows-40/42 canal gap
    { t: 'walk', x: 43.5, y: 34.6 }, // stage at sw3 (43,34) — the row-26 bridge
                                     // is a phase-stalker ambush, never again
    { t: 'wait', until: (g, f) => f.goFail },
    { t: 'act', check: SW('voice-3') },
    { t: 'wait', until: (g, f) => f.switchReset },
    { t: 'walk', x: 43.5, y: 34.6 },
    { t: 'wait', until: (g, f) => f.goSuccess },
    { t: 'act', check: SW('voice-3') },
    { t: 'wait', until: (g, f) => f.reachDone },
    { t: 'walk', x: 10.5, y: 44.4 }, { t: 'act', check: g => g.quests.find(q => q.id === 'q-migration').state === 'done' },
    // return leg rides the pads and stays north of the sleeping brood camp
    { t: 'walk', x: 50.5, y: 44.5 },
    { t: 'walk', x: 69.5, y: 33.5 },
    { t: 'walk', x: 78.5, y: 31.5 },
    { t: 'walk', x: 88.5, y: 31.5, allowExit: true },
  ]);

  // pid 3 SPARK (volt): ball gun, stormgun off the rack once the nest sniper
  // covering it is dead, sweep support, the beacon, then sw9
  const spark = makeBot(3, [
    { t: 'wait', until: (g, f) => f.questsActive },
    ...ballTo([...MARCH.gather, ...MARCH.west, ...MARCH.fragment]),
    { t: 'walk', x: 18.5, y: 12.5 },
    ...pillShots(20.5, 11.5, ['pl0', 'pl1', 'pl2']), // pl2 anchors him as guard
    ...ballTo(MARCH.forgeYard),
    { t: 'wait', until: (g, f) => f.sealForged },
    ...ballTo(MARCH.strip),
    { t: 'wait', tag: 'east', until: (g, f) => f.eastReady },
    snipeNest(68.5, 25.5),
    ...pillShots(68.5, 21.5, ['pl5']),
    { t: 'shoot', x: 61.5, y: 22.5, range: 5, until: PILL('pl4') }, // advance with Runner
    { t: 'shoot', x: 58.5, y: 22.5, range: 5, until: PILL('pl3') },
    { t: 'walk', x: 56.5, y: 31.6 }, { t: 'act', check: g => g.players[3].fieldWeapon?.kind === 'stormgun' }, // the rack is safe now
    ...bossAssault(68.5, 35.5),
    { t: 'walk', x: 74.5, y: 41.6 }, // sweep support: north relay row
    { t: 'walk', x: 74.5, y: 46.4 }, // south relay row
    { t: 'wait', until: (g, f) => f.vaultSwept },
    { t: 'walk', x: 52.5, y: 41.5 }, // canal gap, then the beacon on the way to sw9
    { t: 'walk', x: 45.5, y: 50.4 },
    { t: 'holdact', until: (g, f) => f.beaconBuilt },
    { t: 'walk', x: 50.5, y: 49.4 }, // stage at sw9 (50,50)
    { t: 'wait', until: (g, f) => f.goFail },
    { t: 'act', check: SW('voice-9') },
    { t: 'wait', until: (g, f) => f.switchReset },
    { t: 'walk', x: 50.5, y: 49.4 },
    { t: 'wait', until: (g, f) => f.goSuccess },
    { t: 'act', check: SW('voice-9') },
    ...coreAssault(78.5, 33.4, 7),
    { t: 'walk', x: 85.5, y: 33.0 },
    { t: 'walk', x: 89.5, y: 32.5, allowExit: true },
  ]);
  spark.engageT = 7;
  return [lance, runner, ghost, spark];
}

const PARTY = [
  { pid: 0, name: 'Lance', charId: 'sniper' },
  { pid: 1, name: 'Runner', charId: 'scout' },
  { pid: 2, name: 'Ghost', charId: 'shade' },
  { pid: 3, name: 'Spark', charId: 'volt' },
];
const ROSTER = ['sniper', 'scout', 'shade', 'volt', 'soldier', 'raider', 'duelist', 'helix'];

function fnv(h, s) { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }

// --- the chapter run ------------------------------------------------------------
function runChapter(capSeconds) {
  const g = createGame(def, PARTY, charMap, ROSTER);
  const bots = buildBots();
  const flags = { coreOpenT: Infinity, goSuccessT: Infinity, actWhiffs: [] };
  const log = [];
  let hash = 2166136261;
  const vaultBossId = g.enemies.find(e => e.kind === 'boss' && Math.floor(e.x / TILE) === 69)?.id;
  const coreBossId = g.enemies.find(e => e.kind === 'boss' && Math.floor(e.x / TILE) === 86)?.id;
  let beacon = null; // { frame, data }
  let tailFrames = 0; // frames stepped since the beacon was lit
  const tail = { inputs: [], hashes: [] }; // post-beacon replay material
  const phantom = { seen: false, minD: Infinity, acoAlive: 0, noSealOk: true, t: 0 };
  let timeLeftDrift = false;
  const pillarPressure = [];
  let frame = 0;

  const frames = Math.ceil(capSeconds / DT);
  for (; frame < frames && g.status === 'play'; frame++) {
    // mission control: derive squad-level flags from live state
    flags.vaultBossDead = !g.enemies.some(e => e.id === vaultBossId);
    flags.coreBossDead = !g.enemies.some(e => e.id === coreBossId);
    // the eastern colonnade is a TRIO job: nobody engages its guard camp
    // (two bulwarks, an acolyte, the nest sniper) until at least two bots
    // stand parked AT the tagged staging wait (a stormgun shopper passing
    // through the pocket must never trip it)
    const staged = tag => bots.filter(b => b.tasks[b.ti]?.tag === tag && g.players[b.pid]?.state === 'active').length;
    if (!flags.eastReady) flags.eastReady = staged('east') >= 3 || g.elapsed > 300;
    // the assault is a FOUR-gun affair behind a finished pillar quest: nobody
    // pokes the vault until every seat is PARKED on its muster wait (counting
    // bodies near the spot once latched it for a respawner passing through)
    if (!flags.muster) {
      flags.muster = (staged('muster') >= 4 && g.pillars.length === 0) || g.elapsed > 600;
    }
    // vault swept (latched): no live enemy anywhere in the nook + vault
    // compartment — the relay sequence only starts on clean ground
    if (!flags.vaultSwept && flags.vaultOpen) {
      let hot = false;
      for (const e of g.enemies) {
        if (e.dead) continue;
        const tx = Math.floor(e.x / TILE), ty = Math.floor(e.y / TILE);
        if (tx >= 67 && tx <= 82 && ty >= 38 && ty <= 50) { hot = true; break; }
      }
      if (!hot || g.elapsed > (flags.vaultOpenT ?? Infinity) + 120) flags.vaultSwept = true;
    }
    const stationed = at(g, 0, 60, 39, 3) && at(g, 1, 74, 42, 4) && at(g, 2, 43, 34, 3) && at(g, 3, 50, 49, 3);
    if (!flags.goFail) {
      flags.goFail = flags.vaultSwept && stationed;
    } else if (flags.switchReset && !flags.goSuccess) {
      flags.goSuccess = stationed || g.elapsed > (flags.switchResetT ?? Infinity) + 90;
      if (flags.goSuccess) flags.goSuccessT = g.elapsed;
    }
    // door state is read straight off the sim so a drained event can never
    // stall the script (events drive the verdicts, state drives the bots)
    if (g.doors.find(d => d.id === 'vault')?.open && !flags.vaultOpen) { flags.vaultOpen = true; flags.vaultOpenT = g.elapsed; }
    if (g.doors.find(d => d.id === 'core-gate')?.open && !flags.coreOpen) { flags.coreOpen = true; flags.coreOpenT = g.elapsed; }
    const inputs = {};
    for (const bot of bots) inputs[bot.pid] = think(g, bot, flags, frame);
    if (TRACE.length === 3 && g.elapsed >= TRACE[1] && g.elapsed <= TRACE[2] && frame % 15 === 0) {
      const b = bots[TRACE[0]], p = g.players[TRACE[0]], tk = b.tasks[b.ti];
      console.log(`TRACE t=${g.elapsed.toFixed(1)} p=(${(p.x / TILE).toFixed(2)},${(p.y / TILE).toFixed(2)}) hp=${p.hp} st=${p.state} ti=${b.ti} task=${tk?.t}@${tk?.x},${tk?.y} path=${b.path.length}${b.path[0] ? ` wp0=(${(b.path[0].x / TILE).toFixed(1)},${(b.path[0].y / TILE).toFixed(1)})j${+b.path[0].jump}` : ''} padWait=${+!!b.mem.padWait} stuck=${b.stuck} inp=${JSON.stringify(inputs[TRACE[0]])} f=(${p.fx?.toFixed(2)},${p.fy?.toFixed(2)})`);
    }
    if (beacon && tail.inputs.length < 1500) {
      // record facing too: bots aim by writing p.fx/fy (twin-stick style), so
      // a faithful replay must restore the same pre-step facing
      tail.inputs.push(JSON.stringify({ inputs, facing: g.players.map(p => [p.fx, p.fy]) }));
    }
    step(g, inputs, DT);
    if (g.timeLeft !== def.time) timeLeftDrift = true;
    // harvest events FIRST: snapshot() drains g.events (the server ships them
    // per tick), so every sampler below must run on the harvested copy
    const evs = g.events.splice(0);

    if (beacon) {
      tailFrames++;
      if (tailFrames % 30 === 0 && tailFrames <= 1500) {
        tail.hashes.push(fnv(2166136261, JSON.stringify(snapshot(g, false))));
      }
    }
    // phantom reveal sampling: carrier + acolyte within the 6-tile reveal ring
    // (the seal rides its own p.lythseal field now, never the item slot)
    const carrier = g.players.find(pp => pp.state === 'active' && pp.lythseal);
    if (carrier && !phantom.seen) {
      for (const e of g.enemies) {
        if (e.dead || e.kind !== 'acolyte') continue;
        const d = Math.hypot(e.x - carrier.x, e.y - carrier.y) / TILE;
        if (d < 6) {
          const snapPlayers = snapshot(g, false).players;
          const me = snapPlayers.find(sp => sp.pid === carrier.pid);
          phantom.seen = !!me?.hasSeal;
          phantom.minD = d;
          phantom.t = g.elapsed;
          phantom.acoAlive = g.enemies.filter(en => !en.dead && en.kind === 'acolyte').length;
          phantom.noSealOk = snapPlayers.every(sp => sp.pid === carrier.pid || !sp.hasSeal);
          break;
        }
      }
    }

    for (const ev of evs) {
      const rec = { ...ev, t: g.elapsed };
      log.push(rec);
      if (ev.type === 'pillarDown') {
        let guards = 0;
        for (const e of g.enemies) if (!e.dead && e.awake && Math.hypot(e.x - ev.x, e.y - ev.y) < 8 * TILE) guards++;
        pillarPressure.push({ id: ev.id, t: g.elapsed, guards });
      }
      if (ev.type === 'quest' && ev.state === 'active') flags.questsActive = true;
      if (ev.type === 'sealForged') { flags.sealForged = true; rec.shardsAfter = g.shards; }
      if (ev.type === 'doorOpen' && ev.id === 'vault' && !flags.vaultOpen) { flags.vaultOpen = true; flags.vaultOpenT = g.elapsed; }
      if (ev.type === 'doorOpen' && ev.id === 'core-gate') { flags.coreOpen = true; flags.coreOpenT = g.elapsed; }
      if (ev.type === 'switchReset') { flags.switchReset = true; flags.switchResetT = g.elapsed; rec.onAfter = g.switches.filter(s => s.on).length; }
      if (ev.type === 'quorum') { flags.quorum = true; rec.onAt = g.switches.filter(s => s.on).length; }
      if (ev.type === 'questProgress' && ev.id === 'q-core') flags.reachDone = true;
      if (ev.type === 'built' && ev.kind === 'beacon') flags.beaconBuilt = true;
      if (ev.type === 'beacon' && !beacon) beacon = { frame, data: serializeGame(g), elapsed: g.elapsed };
      if (ev.type !== 'shoot' && ev.type !== 'hitWall' && ev.type !== 'build' && ev.type !== 'aim') {
        hash = fnv(hash, `${ev.type}:${ev.pid ?? ev.id ?? ''}:${Math.round(ev.x ?? 0)},${Math.round(ev.y ?? 0)};`);
      }
      if (DEBUG && !['shoot', 'hitWall', 'build', 'aim', 'shard', 'die', 'spawnEnemy', 'playerHit', 'pillarHit', 'hit', 'alert', 'patch', 'pyreBurst', 'shield', 'shieldPop', 'enemyShield', 'levelUp', 'heal'].includes(ev.type)) {
        console.log('  EV t=' + g.elapsed.toFixed(1), JSON.stringify(rec).slice(0, 150));
      }
    }
    if (DEBUG && frame % (30 * 15) === 0) {
      console.log(`t=${g.elapsed.toFixed(0)} shards=${g.shards.toFixed(0)} pillars=${g.pillars.length} on=${g.switches.filter(s => s.on).length} `
        + g.players.map(p => `${p.pid}:${p.state[0]}${p.hp ?? ''}@${(p.x / TILE).toFixed(0)},${(p.y / TILE).toFixed(0)}${bots[p.pid] ? '#' + bots[p.pid].ti : ''}`).join(' ')
        + ` seal=${g.players.filter(p => p.lythseal).map(p => p.pid).join('/') || '-'}`
        + ` flags=${['muster', 'vaultOpen', 'vaultSwept', 'goFail', 'switchReset', 'goSuccess', 'quorum', 'coreOpen'].filter(k => flags[k]).join(',') || '-'}`);
      if (DEBUG > 1) {
        const hot = g.enemies.filter(e => {
          if (e.dead) return false;
          const tx = Math.floor(e.x / TILE), ty = Math.floor(e.y / TILE);
          return tx >= 67 && tx <= 82 && ty >= 38 && ty <= 50;
        });
        if (hot.length) console.log('      rect: ' + hot.map(e => `${e.kind}#${e.id}@${(e.x / TILE).toFixed(1)},${(e.y / TILE).toFixed(1)} hp${e.hp}${e.shielded ? '+w' : ''}${e.awake ? '' : ' zZ'}`).join(' | '));
      }
    }
  }
  return { g, log, hash, flags, beacon, tail, phantom, timeLeftDrift, pillarPressure, frames: frame, snap: snapshot(g) };
}

console.log('--- CH VIII playtest: 4-seat couch squad, full chapter ---');
const CAP = +(process.env.CH8_CAP || 2400);
const A = runChapter(CAP);

// ---------------- core verdicts ----------------
const ev = type => A.log.filter(e => e.type === type);

check('untimed story: timeLeft frozen, snapshot says untimed + elapsed counts up',
  !A.timeLeftDrift && A.snap.untimed === true && A.snap.elapsed > 0 && !ev('lowTime').length,
  `timeLeft pinned at ${def.time}s for the whole run, elapsed=${A.g.elapsed.toFixed(0)}s`);

check('quests activate at the giver', A.flags.questsActive === true,
  ev('quest').filter(e => e.state === 'active').map(e => e.id).join(', '));

// pillars
const pd = ev('pillarDown');
check('all 6 BLS pillars destroyed by player fire', pd.length === 6 && A.g.pillars.length === 0,
  pd.map(e => `${e.id}@${e.t.toFixed(0)}s`).join(', '));
check('pillars fell under guard pressure (awake enemies within 8 tiles)',
  A.pillarPressure.some(pp => pp.guards >= 1),
  A.pillarPressure.map(pp => `${pp.id}:${pp.guards} guards`).join(', '));
const qMig = A.g.quests.find(q => q.id === 'q-migration');
check('destroy quest counted all six and settled at sel-brakka',
  qMig.progress === 6 && qMig.state === 'done', `progress ${qMig.progress}/6, state ${qMig.state}`);

// fragment + forge
const qp = ev('qitemPickup');
const sf = ev('sealForged');
check('proof fragment fetched (qitemPickup) and seal forged', qp.length >= 1 && sf.length === 1,
  `fragment ${qp[0]?.id} @${qp[0]?.t.toFixed(0)}s; sealForged @${sf[0]?.t.toFixed(0)}s by pid${sf[0]?.pid}, pool after=${sf[0]?.shardsAfter}`);
check('forge consumed the fragment + 20 shards',
  sf.length === 1 && !A.g.qitems.some(it => it.id === 'frag-keeper') && A.g.qitems.length === 1,
  `qitems left on field: ${A.g.qitems.map(i => i.id).join(', ') || 'none'}`);
const qSeal = A.g.quests.find(q => q.id === 'q-seal');
check('craft quest settled at hask', qSeal.state === 'done');

// vault + phantom reveal
const vaultEv = ev('doorOpen').find(e => e.id === 'vault');
check('sealLock vault door opens on lythseal touch', !!vaultEv, vaultEv ? `@${vaultEv.t.toFixed(0)}s` : 'never opened');
check('Phantom reveal: snapshot hasSeal on the carrier within 6 tiles of an acolyte, others unflagged',
  A.phantom.seen && A.phantom.noSealOk,
  `d=${A.phantom.minD.toFixed(1)} tiles @${A.phantom.t.toFixed(0)}s, ${A.phantom.acoAlive} acolytes alive`);

// quorum: deliberate fail, clean reset, then 7-of-10
const swEv = ev('switch');
const reset = ev('switchReset');
const quorum = ev('quorum');
const preReset = reset.length ? swEv.filter(e => e.t < reset[0].t) : [];
check('deliberate fail: exactly 6 thrown, 120s window expires, switchReset wipes the cluster',
  reset.length === 1 && preReset.length === 6 && reset[0].onAfter === 0
  && Math.abs(reset[0].t - preReset[0]?.t - 120) < 1.5,
  reset.length ? `6 on by ${preReset[5]?.t.toFixed(0)}s, reset @${reset[0].t.toFixed(0)}s (${(reset[0].t - preReset[0]?.t).toFixed(1)}s after first throw), relays on after reset: ${reset[0].onAfter}` : 'no reset fired');
check('second attempt: 7-of-10 inside the window fires the quorum and opens the core gate',
  quorum.length === 1 && quorum[0].onAt === 7 && reset.length === 1 && quorum[0].t > reset[0].t
  && ev('doorOpen').some(e => e.id === 'core-gate'),
  quorum.length ? `quorum @${quorum[0].t.toFixed(0)}s with ${quorum[0].onAt} relays on (${(quorum[0].t - swEv.find(e => e.t > reset[0].t)?.t).toFixed(1)}s after the window opened)` : 'no quorum');
const qQuorum = A.g.quests.find(q => q.id === 'q-quorum');
check('switch quest (group 0) settled', qQuorum.state === 'done', `state ${qQuorum.state}`);

// reach + finale
const reach = ev('questProgress').find(e => e.id === 'q-core');
check('Array core reached (q-core reach quest trips)', !!reach && A.flags.reachDone,
  reach ? `@${reach.t.toFixed(0)}s` : 'never');
check('campaign finale fires: full squad extraction, status cleared, clear event',
  A.g.status === 'cleared' && ev('clear').length === 1 && ev('extract').length >= 3,
  `status=${A.g.status} after ${A.g.elapsed.toFixed(0)}s, ${ev('extract').length} extractions, score ${Math.round(A.g.score)}`);

// teleports
const tp = ev('teleport');
const padPairs = [...new Set(tp.map(e => e.from + '->' + e.to))];
check('teleport network traversal: pads used across the run', tp.length >= 8 && padPairs.length >= 5,
  `${tp.length} blinks over ${padPairs.length} distinct pad routes`);
note(`pad routes: ${padPairs.join(', ')}`);

// beacon -> serialize/restore resume determinism
check('save beacon built (cost 10) and beacon event fired', !!A.beacon && ev('beacon').length === 1,
  A.beacon ? `@${A.beacon.elapsed.toFixed(0)}s` : 'never built');
if (A.beacon) {
  const replayInputs = A.tail.inputs.map(s => JSON.parse(s));
  const runTail = (gr) => {
    const hashes = [];
    for (let i = 0; i < replayInputs.length; i++) {
      // restore the recorded pre-step facings: bots aim by writing p.fx/fy
      // directly (twin-stick style), which step() never sees in the inputs
      const { inputs, facing } = replayInputs[i];
      gr.players.forEach((p2, k) => {
        const f = facing[k];
        if (f) { p2.fx = f[0]; p2.fy = f[1]; }
      });
      step(gr, inputs, DT);
      gr.events.length = 0;
      if ((i + 1) % 30 === 0) hashes.push(fnv(2166136261, JSON.stringify(snapshot(gr, false))));
    }
    return hashes;
  };
  const h1 = runTail(restoreGame(A.beacon.data, charMap));
  const h2 = runTail(restoreGame(A.beacon.data, charMap));
  const mainH = A.tail.hashes.slice(0, h1.length);
  check('beacon resume determinism: restoreGame replays a byte-identical future (twice)',
    h1.length > 10 && h1.every((h, i) => h === mainH[i]) && h2.every((h, i) => h === h1[i]),
    `${h1.length} snapshot hashes compared over ${replayInputs.length} replay frames`);
}

// quest ledger + wrap
note('quest ledger: ' + A.g.quests.map(q => `${q.id}=${q.state}(${q.progress}/${q.count})`).join(' '));
const downs = ev('down').length;
const waves = ev('wave');
note(`waves survived: ${waves.length} (${waves.map(w => w.count + '@' + w.t.toFixed(0) + 's').join(', ')}); downs: ${downs}; kills: ${A.g.kills}; pool end: ${A.g.shards.toFixed(0)} shards`);
note(`field weapons: ${ev('fieldPickup').map(e => e.kind + '->pid' + e.pid).join(', ') || 'none'}; empties: ${ev('fieldEmpty').map(e => e.kind).join(', ') || 'none'}`);
if (A.flags.actWhiffs.length) note('act whiffs (task gave up): ' + A.flags.actWhiffs.join(', '));
for (const p of A.g.players) {
  note(`${PARTY[p.pid].name.padEnd(7)} ${p.state.padEnd(10)} char=${p.charId ?? '-'} hp=${p.hp ?? '-'} item=${p.item ? p.item.kind + 'x' + p.item.count : '-'} xp=${p.xp?.toFixed(0) ?? '-'} L${p.level ?? '-'}`);
}

// ---------------- determinism: full second run ----------------
const B = runChapter(CAP);
check('full-chapter determinism: rerun matches event hash, status and clear time',
  B.hash === A.hash && B.g.status === A.g.status && Math.abs(B.g.elapsed - A.g.elapsed) < 0.001,
  `hashes ${A.hash.toString(16)} / ${B.hash.toString(16)}, t=${A.g.elapsed.toFixed(1)} / ${B.g.elapsed.toFixed(1)}`);

const failed = checks.filter(c => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
