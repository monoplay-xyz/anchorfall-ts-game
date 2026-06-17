// Headless playtest: STORY CHAPTER XI (levels/story/ch11.json, "Genesis Drift").
// The saga-finale certification: four scripted operatives drive the full
// three-act gauntlet through the real sim, and the chapter must fall in at
// most THREE attempt configs (deterministic — a config either clears or it
// does not). Attempt 1 is the baseline doctrine; attempts 2 and 3 add caution
// (turret money, longer regroups, tighter engage leashes) if the nest wins.
//
//   pid 0  LANCE  sniper  the long gun: wakes every boss from outside its
//                         reach and bleeds it into the ball's anchored guns
//   pid 1  RUNNER scout   talks, the skiff fragment run, the Genesis Seal,
//                         the hollow rite, the final touch on the Anchor
//   pid 2  GHOST  shade   skiff escort, deep-slot gun, chest economy
//   pid 3  SPARK  volt    beacon (+ attempt-2 turrets), seat 6, sweep support
//
// DEATHBALL DOCTRINE (proven on ch8): the squad moves as one 4-gun ball
// through every act. Act 1: keeper talks -> two-skiff channel run to the
// deep-nest islet (two proof fragments, hoard chest) -> handover + Genesis
// Seal at the brazier -> ball to the plaza (cassio talk, beacon). Act 2: the
// gate-warden camp is baited through the gauntlet gate into four anchored
// guns; the ring is cleared as a loop (west boss camp, NW brood, north
// pickets, NE brood, east boss camp); the seven assigned seats are staged
// and thrown inside one 120s window. Act 3: nest-gate -> court sweep ->
// hollow-gate on the Seal -> the 4-rune rite (wave>vertex>seal>anchor) ->
// the eye pad one operative at a time -> the nest boss falls to anchored
// fire -> Runner touches the First Anchor (main-chain reach finale clears).
//
// Run: node scripts/playtest-ch11.mjs   (exit 0 = all checks pass)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { charsById, createGame, snapshot, step, TILE } from '../shared/game.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const def = JSON.parse(fs.readFileSync(path.join(root, 'levels/story/ch11.json'), 'utf8'));
const characters = JSON.parse(fs.readFileSync(path.join(root, 'shared/characters.json'), 'utf8'));
const charMap = charsById(characters);

const DT = 1 / 30;
const DEBUG = +(process.env.CH11_DEBUG || 0);
const TRACE = process.env.CH11_TRACE ? process.env.CH11_TRACE.split(',').map(Number) : [];
const CAP = +(process.env.CH11_CAP || 2400);
const checks = [];
const issues = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) issues.push(`${name}${detail ? ' (' + detail + ')' : ''}`);
}
function note(msg) { console.log('      ' + msg); }

// --- deterministic pad-aware router (ch8 chassis; lava and void are rock) ---
const footBlocked = c => c === '#' || c === 'T' || c === '~' || c === 'o' || c === '%' || c === '!';
const tileC = (g, x, y) => g.grid[y]?.[x] ?? '#';

function blockedTile(g, tx, ty) {
  if (footBlocked(tileC(g, tx, ty))) return true;
  for (const d of g.doors) {
    if (!d.open && tx >= d.x && tx < d.x + d.w && ty >= d.y && ty < d.y + d.h) return true;
  }
  for (const b of g.builds) {
    if (b.built && b.kind !== 'farm' && Math.floor(b.x / TILE) === tx && Math.floor(b.y / TILE) === ty) return true;
  }
  return false;
}

function planRoute(g, p, gx, gy) {
  const W = g.w, H = g.h;
  const sx = Math.floor(p.x / TILE), sy = Math.floor(p.y / TILE);
  const gtx = Math.floor(gx / TILE), gty = Math.floor(gy / TILE);
  const padAt = new Map();
  for (const t of g.teleports) {
    const twin = t.twin != null ? g.teleports.find(o => o.id === t.twin) : null;
    if (!twin) continue;
    padAt.set(Math.floor(t.y / TILE) * W + Math.floor(t.x / TILE),
      Math.floor(twin.y / TILE) * W + Math.floor(twin.x / TILE));
  }
  const dist = new Int32Array(W * H).fill(-1);
  const prev = new Int32Array(W * H).fill(-1);
  const via = new Uint8Array(W * H);
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
    const tw = padAt.get(cur);
    if (tw !== undefined && dist[tw] === -1 && !blockedTile(g, tw % W, (tw / W) | 0)) {
      dist[tw] = dist[cur] + 8;
      prev[tw] = cur;
      via[tw] = 1;
      q.push(tw);
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

// --- bot chassis ------------------------------------------------------------
function makeBot(pid, tasks) {
  return { pid, tasks, ti: 0, path: [], repath: 0, mem: {}, stuck: 0, doorsKey: '' };
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

function sidestepPad(g, p, inp) {
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
  if (!blockedTile(g, tx, ty + 1)) inp.down = true;
  else if (!blockedTile(g, tx + 1, ty)) inp.right = true;
  else if (!blockedTile(g, tx - 1, ty)) inp.left = true;
  else inp.up = true;
}

function aimAt(p, x, y, inp) {
  const d = Math.hypot(x - p.x, y - p.y) || 1;
  p.fx = (x - p.x) / d;
  p.fy = (y - p.y) / d;
  inp.fire = true;
}

// Combat reflex (ch8): engage what is awake and close; acolytes (the nest's
// Phantoms) die first inside range; back off melee except acolytes; ban
// proven whiff targets so a missed corner never pins a bot forever.
function combatReflex(g, bot, p, inp, engageT) {
  let tgt = null, bd = Infinity, aco = null, ad = Infinity;
  for (const e of g.enemies) {
    if (e.dead) continue;
    if ((bot.mem.banUntil?.get(e.id) ?? -1) > bot.mem.frame) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    const interested = (e.awake && d < engageT * TILE) || d < 4.5 * TILE;
    if (!interested) continue;
    if (!losShot(g, p.x, p.y, e.x, e.y)) continue;
    if (d < bd) { bd = d; tgt = e; }
    if (e.kind === 'acolyte' && d < ad) { ad = d; aco = e; }
  }
  if (!tgt) return false;
  if (aco && ad < engageT * TILE) { tgt = aco; bd = ad; }
  if (bd < 1.6 * TILE && tgt.kind !== 'acolyte') {
    const ux = (p.x - tgt.x) / (bd || 1), uy = (p.y - tgt.y) / (bd || 1);
    if (ux < -0.3) inp.left = true; else if (ux > 0.3) inp.right = true;
    if (uy < -0.3) inp.up = true; else if (uy > 0.3) inp.down = true;
    return true;
  }
  if (bd > (weaponRange(g, p) - 0.5) * TILE) return false;
  if (onPadTile(g, p) && !bot.mem.padWait) { sidestepPad(g, p, inp); return true; }
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

function walkTo(g, bot, p, gx, gy, inp) {
  const doorsKey = g.doors.map(d => +d.open).join('') + ':' + g.builds.filter(b => b.built).length;
  bot.repath--;
  const moved = Math.hypot((bot.mem.gx ?? -1) - gx, (bot.mem.gy ?? -1) - gy) > TILE;
  if (bot.repath <= 0 || moved || !bot.path.length || bot.doorsKey !== doorsKey) {
    bot.path = planRoute(g, p, gx, gy);
    bot.mem.gx = gx; bot.mem.gy = gy;
    bot.doorsKey = doorsKey;
    bot.repath = 24;
  }
  if (bot.path.length && bot.path[0].jump) {
    const padWp = bot.mem.padFrom;
    if (padWp && Math.hypot(p.x - bot.path[0].x, p.y - bot.path[0].y) < TILE * 1.5) {
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
    if (bot.path.length && bot.path[0].jump) bot.mem.padFrom = wp;
  }
  const wp = bot.path[0];
  if (!wp) {
    const d = Math.hypot(gx - p.x, gy - p.y);
    if (d < TILE * 1.45) { bot.stuck = 0; return true; }
    bot.stuck++;
    bot.repath = 0;
    return bot.stuck > 240;
  }
  if (wp.jump) return false;
  if (wp.x < p.x - 4) inp.left = true; else if (wp.x > p.x + 4) inp.right = true;
  if (wp.y < p.y - 4) inp.up = true; else if (wp.y > p.y + 4) inp.down = true;
  return false;
}

// One task per frame.
function think(g, bot, flags, frame) {
  const p = g.players[bot.pid];
  const inp = {};
  bot.mem.frame = frame;
  if (!p || p.state !== 'active') {
    if (p && p.state === 'pick') { if (frame % 8 === 0) inp.fire = true; }
    return inp;
  }
  if (p.hp <= 1 && p.item && p.item.kind === 'medkit' && p.item.count > 0 && !bot.mem.itemPrev) inp.item = true;
  bot.mem.itemPrev = !!inp.item;

  let task = bot.tasks[bot.ti];
  while (task && task.skipIf && task.skipIf(g, flags)) { task = bot.tasks[++bot.ti]; }
  if (!task) {
    if (!p.riding && combatReflex(g, bot, p, inp, bot.engageT || 6.5)) return inp;
    if (onPadTile(g, p)) sidestepPad(g, p, inp);
    return inp;
  }

  const quiet = task.t === 'act' || task.t === 'holdact' || p.riding;
  if (!quiet && combatReflex(g, bot, p, inp, bot.engageT || 6.5)) {
    if (task.t !== 'walk' || !bot.mem.padWait) return inp;
  }

  switch (task.t) {
    case 'walk': {
      if (walkTo(g, bot, p, task.x * TILE, task.y * TILE, inp)) { bot.ti++; bot.mem.actT = 0; bot.mem.shootT = 0; }
      break;
    }
    case 'wait': {
      bot.mem.waitT = (bot.mem.waitT || 0) + 1;
      if (task.until(g, flags) || (task.timeout && bot.mem.waitT > task.timeout)) { bot.ti++; bot.mem.waitT = 0; }
      else if (onPadTile(g, p)) sidestepPad(g, p, inp);
      break;
    }
    case 'act': {
      bot.mem.actT = (bot.mem.actT || 0) + 1;
      if (!task.check) {
        if (bot.mem.actT === 1) inp.act = true;
        else { bot.ti++; bot.mem.actT = 0; }
        break;
      }
      if (task.check(g, flags)) { bot.ti++; bot.mem.actT = 0; break; }
      if (bot.mem.actT % 16 === 1) inp.act = true;
      if (bot.mem.actT > 16 * 12) { bot.ti++; bot.mem.actT = 0; flags.actWhiffs.push(`pid${bot.pid}@task${bot.ti}`); }
      break;
    }
    case 'holdact': {
      inp.act = true;
      bot.mem.holdT = (bot.mem.holdT || 0) + 1;
      if (task.until(g, flags) || (task.timeout && bot.mem.holdT > task.timeout)) {
        bot.ti++;
        bot.mem.holdT = 0;
        if (task.timeout && bot.mem.holdT === 0 && !task.until(g, flags)) flags.actWhiffs.push(`pid${bot.pid}@holdact`);
      }
      break;
    }
    case 'mount': { // act-press until riding the nearest skiff
      if (p.riding) { bot.ti++; bot.mem.actT = 0; break; }
      bot.mem.actT = (bot.mem.actT || 0) + 1;
      if (bot.mem.actT % 16 === 1) inp.act = true;
      if (bot.mem.actT > 16 * 12) { bot.ti++; bot.mem.actT = 0; flags.actWhiffs.push(`pid${bot.pid}@mount`); }
      break;
    }
    case 'sail': { // steer the skiff along fixed water waypoints
      if (!p.riding) { bot.ti++; break; } // dismounted (or never mounted): move on
      bot.mem.sailI = bot.mem.sailI ?? 0;
      const wp = task.wps[bot.mem.sailI];
      if (!wp) { bot.ti++; bot.mem.sailI = undefined; break; }
      const wx = (wp[0] + 0.5) * TILE, wy = (wp[1] + 0.5) * TILE;
      if (Math.hypot(wx - p.x, wy - p.y) < 10) { bot.mem.sailI++; break; }
      if (wx < p.x - 4) inp.left = true; else if (wx > p.x + 4) inp.right = true;
      if (wy < p.y - 4) inp.up = true; else if (wy > p.y + 4) inp.down = true;
      break;
    }
    case 'dismount': {
      if (!p.riding) { bot.ti++; bot.mem.actT = 0; break; }
      bot.mem.actT = (bot.mem.actT || 0) + 1;
      if (bot.mem.actT % 16 === 1) inp.act = true;
      if (bot.mem.actT > 16 * 12) { bot.ti++; bot.mem.actT = 0; flags.actWhiffs.push(`pid${bot.pid}@dismount`); }
      break;
    }
    case 'mine': { // crack a LYTH crystal, then walk its drops
      const c = g.crystals.find(cc => Math.floor(cc.x / TILE) === task.x && Math.floor(cc.y / TILE) === task.y);
      if (!c) {
        if (walkTo(g, bot, p, (task.x + 0.5) * TILE, (task.y + 0.5) * TILE, inp)) { bot.ti++; }
        break;
      }
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d > (weaponRange(g, p) - 1) * TILE || !losShot(g, p.x, p.y, c.x, c.y)) {
        walkTo(g, bot, p, c.x, c.y, inp);
      } else {
        aimAt(p, c.x, c.y, inp);
      }
      break;
    }
    case 'shoot': {
      bot.mem.shootT = (bot.mem.shootT || 0) + 1;
      if (task.until(g, flags) || (task.timeout && bot.mem.shootT > task.timeout)) {
        if (task.timeout && bot.mem.shootT > task.timeout && !task.until(g, flags)) flags.actWhiffs.push(`pid${bot.pid}@shoot${task.x},${task.y}`);
        bot.ti++;
        bot.mem.shootT = 0;
        break;
      }
      const tx = task.x * TILE, ty = task.y * TILE;
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
    case 'touchdoor': {
      const d = g.doors.find(dd => dd.id === task.id);
      if (!d || d.open) { bot.ti++; break; }
      const cx = (d.x + d.w / 2) * TILE, cy = (d.y + d.h / 2) * TILE;
      if (Math.hypot(cx - p.x, cy - p.y) > TILE * 2.2) {
        walkTo(g, bot, p, cx, cy, inp);
      } else {
        if (cx < p.x - 2) inp.left = true; else if (cx > p.x + 2) inp.right = true;
        if (cy < p.y - 2) inp.up = true; else if (cy > p.y + 2) inp.down = true;
      }
      break;
    }
  }
  return inp;
}

// --- mission script -----------------------------------------------------------
const SW = id => g => !!g.switches.find(s => s.id === id)?.on;
const GL = (tx, ty) => g => !!g.glyphs.find(gl => Math.floor(gl.x / TILE) === tx && Math.floor(gl.y / TILE) === ty)?.lit;
const CHEST = (tx, ty) => g => !!g.chests.find(c => Math.floor(c.x / TILE) === tx && Math.floor(c.y / TILE) === ty)?.opened;
const at = (g, pid, tx, ty, r = 3) => {
  const p = g.players[pid];
  return p && p.state === 'active' && Math.hypot(p.x - (tx + 0.5) * TILE, p.y - (ty + 0.5) * TILE) < r * TILE;
};

const together = g => {
  const act = g.players.filter(p => p.state === 'active' && !p.riding);
  if (act.length <= 1) return true;
  const cx = act.reduce((s, p) => s + p.x, 0) / act.length;
  const cy = act.reduce((s, p) => s + p.y, 0) / act.length;
  return act.every(p => Math.hypot(p.x - cx, p.y - cy) < 7 * TILE);
};

// boss home tiles (spawn-time positions, for kill flags)
const BOSS_TILES = [[50, 42], [30, 28], [70, 28], [88, 7]];
const GATE_BOSS = { x: 50.5, y: 42.5 };
const WEST_BOSS = { x: 30.5, y: 28.5 };
const EAST_BOSS = { x: 70.5, y: 28.5 };
const EYE_BOSS = { x: 88.5, y: 7.5 };

function buildBots(cfg) {
  const REGROUP = { t: 'wait', until: together, timeout: cfg.regroupTimeout };
  const ballTo = wps => wps.flatMap(([x, y]) => ([{ t: 'walk', x, y }, REGROUP]));

  // the shared marches
  const MARCH = {
    plaza: [[24.5, 54.5], [33.5, 52.5], [44.5, 51.5]],
    forecourt: [[50.5, 52.5]], // 10 tiles off the warden: outside its dark sight
    westLeg: [[44.5, 41.5], [38.5, 41.5]],
    northLeg: [[31.5, 24.5], [32.5, 20.5], [40.5, 19.5], [50.5, 19.5], [56.5, 19.5]],
    eastLeg: [[64.5, 19.5]],
    court: [[50.5, 41.5], [50.5, 36.5], [46.5, 35.5]],
  };

  // bait-the-camp assaults: the baiter pokes the sleeping boss from outside
  // its 8.5 reach (a hit wakes it), the boss marches into the staged guns.
  // mobile=true walks for LOS (self-correcting); holds anchor the kill box.
  const bossShot = (bx, by, deadFlag, hx, hy, range) =>
    hx !== undefined
      ? { t: 'shoot', x: bx, y: by, holdX: hx, holdY: hy, until: (g, f) => f[deadFlag] }
      : { t: 'shoot', x: bx, y: by, range, until: (g, f) => f[deadFlag] };
  const T_BOSS = 30 * 90, T_SPAWNER = 30 * 60;
  const gateAssault = (hx, hy, range) => ([
    { t: 'wait', tag: 'gate', until: (g, f) => f.gateGo },
    { ...bossShot(GATE_BOSS.x, GATE_BOSS.y, 'gateBossDead', hx, hy, range), timeout: T_BOSS },
    { t: 'wait', until: (g, f) => f.gateCampDead, timeout: 30 * 60 },
  ]);
  const westAssault = (hx, hy, range) => ([
    { t: 'wait', tag: 'west', until: (g, f) => f.westGo },
    ...ballTo([[34.5, 40.5], [33.5, 36.5]]), // swept push up the west corridor
    { ...bossShot(WEST_BOSS.x, WEST_BOSS.y, 'westBossDead', hx, hy, range), timeout: T_BOSS },
    { t: 'shoot', x: 26.5, y: 18.5, range: cfg.spawnerRange, until: (g, f) => f.westBroodDead, timeout: T_SPAWNER },
  ]);
  const eastAssault = (hx, hy, range) => ([
    { t: 'wait', tag: 'east', until: (g, f) => f.eastGo },
    { t: 'shoot', x: 74.5, y: 18.5, range: cfg.spawnerRange, until: (g, f) => f.eastBroodDead, timeout: T_SPAWNER },
    ...ballTo([[70.5, 22.5]]), // push toward the camp's sight line together
    { ...bossShot(EAST_BOSS.x, EAST_BOSS.y, 'eastBossDead', hx, hy, range), timeout: T_BOSS },
  ]);
  const eyeAssault = (hx, hy, range) => ([
    { t: 'wait', tag: 'eye', until: (g, f) => f.eyeGo },
    { ...bossShot(EYE_BOSS.x, EYE_BOSS.y, 'eyeBossDead', hx, hy, range), timeout: T_BOSS },
    { t: 'shoot', x: 91.5, y: 5.5, range: cfg.spawnerRange, until: (g, f) => f.eyeBroodDead, timeout: T_SPAWNER },
  ]);
  // a seat throw: stage just south of the relay, sync on goSeats, then act
  const seat = (id, sx, sy) => ([
    { t: 'walk', x: sx, y: sy },
    { t: 'wait', tag: 'seat', until: (g, f) => f.goSeats },
    { t: 'act', check: SW(id) },
  ]);

  // pid 0 LANCE (sniper): the long gun. Wakes each boss from outside its 8.5
  // reach and holds the anchor while the ball burns it down.
  const lance = makeBot(0, [
    { t: 'wait', until: (g, f) => f.questsActive },
    { t: 'mine', x: 16, y: 57 },
    { t: 'walk', x: 16.5, y: 60.5 },
    { t: 'wait', until: (g, f) => f.sealForged },
    ...ballTo(MARCH.plaza),
    { t: 'shoot', x: 66.5, y: 52.5, range: 10, until: (g, f) => f.plazaSniperDead, timeout: 30 * 45 }, // the plaza sniper dies asleep
    ...ballTo(MARCH.forecourt),
    ...gateAssault(undefined, undefined, 10), // mobile: pokes from outside the warden's 8.5
    ...ballTo(MARCH.westLeg),
    ...westAssault(undefined, undefined, 10),
    ...ballTo(MARCH.northLeg),
    ...ballTo(MARCH.eastLeg),
    ...eastAssault(undefined, undefined, 10),
    ...seat('seat-3', 60.5, 20.4), // (60,19)
    { t: 'walk', x: 50.5, y: 19.6 },
    { t: 'act', check: SW('seat-1') }, // (50,18)
    { t: 'wait', until: (g, f) => f.quorum },
    ...ballTo(MARCH.court),
    { t: 'wait', until: (g, f) => f.hollowOpen },
    { t: 'walk', x: 46.5, y: 31.5 },
    { t: 'wait', until: (g, f) => f.riteDone },
    { t: 'walk', x: 50.5, y: 30.5 },
    { t: 'wait', until: (g, f) => f.eyeArrived >= 3 }, // Lance blinks in last
    { t: 'walk', x: 74.5, y: 8.5 },
    ...eyeAssault(undefined, undefined, 10),
    { t: 'wait', until: (g, f) => f.anchorReached },
  ]);
  lance.engageT = cfg.lanceEngage;

  // pid 1 RUNNER (scout): talks, the skiff fragment run, the Seal, the rite,
  // the final touch.
  const runner = makeBot(1, [
    { t: 'walk', x: 11.4, y: 60.5 }, { t: 'act', check: (g, f) => f.questsActive }, // the First Keeper
    { t: 'walk', x: 19.5, y: 62.5 },
    { t: 'mount' },
    { t: 'sail', wps: [[24, 62], [76, 62], [79, 61], [79, 55]] },
    { t: 'dismount' }, // steps ashore at (80,55)
    { t: 'wait', until: (g, f) => f.isletClear, timeout: 30 * 45 },
    { t: 'walk', x: 88.5, y: 54.5 },  // frag-deep-a
    { t: 'walk', x: 86.5, y: 55.5 },  // frag-deep-b
    { t: 'walk', x: 89.5, y: 57.4 }, { t: 'act', check: CHEST(89, 58) }, // the hoard (10 shards)
    { t: 'walk', x: 80.5, y: 55.5 },
    { t: 'mount' },
    { t: 'sail', wps: [[79, 61], [76, 62], [24, 62], [20, 62]] },
    { t: 'dismount' }, // ashore at (19,62)
    { t: 'walk', x: 11.4, y: 60.5 }, { t: 'act', check: g => g.quests.find(q => q.id === 'q-fragment').state === 'done' },
    { t: 'wait', until: g => g.shards >= 20 },
    { t: 'walk', x: 10.5, y: 58.4 },
    { t: 'holdact', until: (g, f) => f.sealForged, timeout: 30 * 60 }, // the Keeper's brazier
    { t: 'walk', x: 11.4, y: 60.5 }, { t: 'act', check: g => g.quests.find(q => q.id === 'q-seal').state === 'done' },
    ...ballTo(MARCH.plaza),
    { t: 'walk', x: 52.5, y: 50.4 }, { t: 'act', check: (g, f) => f.cassioTalked }, // Cassio Bell
    ...ballTo(MARCH.forecourt),
    ...gateAssault(47.5, 51.5),
    ...ballTo(MARCH.westLeg),
    ...westAssault(29.5, 34.5),
    ...ballTo(MARCH.northLeg),
    ...ballTo(MARCH.eastLeg),
    ...eastAssault(67.5, 22.5),
    ...seat('seat-5', 68.5, 27.4), // (68,26)
    { t: 'walk', x: 68.5, y: 33.4 },
    { t: 'act', check: SW('seat-7') }, // (68,32)
    { t: 'wait', until: (g, f) => f.quorum },
    ...ballTo(MARCH.court),
    { t: 'touchdoor', id: 'hollow-gate' }, // the Seal swings it
    { t: 'walk', x: 47.5, y: 30.5 },
    { t: 'wait', until: (g, f) => f.hollowClear, timeout: 30 * 45 },
    // THE GENESIS RITE: wave > vertex > seal > anchor, once and only once
    { t: 'walk', x: 45.5, y: 31.4 }, { t: 'act', check: GL(45, 30) },
    { t: 'walk', x: 48.5, y: 31.4 }, { t: 'act', check: GL(48, 30) },
    { t: 'walk', x: 51.5, y: 31.4 }, { t: 'act', check: GL(51, 30) },
    { t: 'walk', x: 47.5, y: 32.5 }, { t: 'act', check: GL(48, 32) },
    { t: 'wait', until: (g, f) => f.eyeArrived >= 2 }, // third through the pad
    { t: 'walk', x: 72.5, y: 6.5 },
    ...eyeAssault(77.5, 6.5),
    { t: 'walk', x: 90.5, y: 7.5 },
    { t: 'walk', x: 93.5, y: 7.5 }, // TOUCH THE FIRST ANCHOR
  ]);

  // pid 2 GHOST (shade): skiff escort, deep-slot gun, chest economy, seats 10+8.
  const ghost = makeBot(2, [
    { t: 'wait', until: (g, f) => f.questsActive },
    { t: 'walk', x: 19.5, y: 63.5 },
    { t: 'mount' },
    { t: 'sail', wps: [[24, 63], [76, 63], [79, 61], [79, 57]] },
    { t: 'dismount' }, // ashore at (80,57)
    { t: 'walk', x: 82.5, y: 57.5 }, // stand the islet beach, guns up
    { t: 'wait', until: (g, f) => f.isletClear, timeout: 30 * 45 },
    { t: 'mine', x: 84, y: 59 },
    { t: 'walk', x: 80.5, y: 57.5 },
    { t: 'mount' },
    { t: 'sail', wps: [[79, 61], [76, 63], [24, 63], [20, 63]] },
    { t: 'dismount' },
    { t: 'mine', x: 10, y: 63 },
    { t: 'walk', x: 14.5, y: 60.5 },
    { t: 'wait', until: (g, f) => f.sealForged },
    ...ballTo(MARCH.plaza),
    { t: 'mine', x: 34, y: 50 },
    { t: 'walk', x: 33.5, y: 52.4 }, { t: 'act', check: CHEST(33, 53) },
    ...ballTo(MARCH.forecourt),
    ...gateAssault(53.5, 51.5),
    ...ballTo(MARCH.westLeg),
    { t: 'walk', x: 26.5, y: 33.4 }, { t: 'act', check: CHEST(26, 34) }, // crackers
    ...westAssault(31.5, 35.5),
    ...ballTo(MARCH.northLeg),
    ...ballTo(MARCH.eastLeg),
    ...eastAssault(69.5, 21.5),
    { t: 'walk', x: 74.5, y: 33.4 }, { t: 'act', check: CHEST(74, 34) }, // 9 shards
    ...seat('seat-10', 58.5, 42.4), // (58,41)
    { t: 'walk', x: 50.5, y: 41.4 },
    { t: 'act', check: SW('seat-8') }, // (50,40)
    { t: 'wait', until: (g, f) => f.quorum },
    ...ballTo(MARCH.court),
    { t: 'wait', until: (g, f) => f.hollowOpen },
    { t: 'walk', x: 44.5, y: 31.4 }, { t: 'act', check: CHEST(44, 32) }, // the hollow token
    { t: 'walk', x: 46.5, y: 29.5 },
    { t: 'wait', until: (g, f) => f.riteDone },
    // GHOST IS FIRST THROUGH THE PAD: anchors the eye-side pocket
    { t: 'walk', x: 72.5, y: 9.5 },
    ...eyeAssault(76.5, 9.5),
    { t: 'wait', until: (g, f) => f.anchorReached },
  ]);

  // pid 3 SPARK (volt): the beacon, attempt-2 turrets, seat 6, sweep support.
  const spark = makeBot(3, [
    { t: 'wait', until: (g, f) => f.questsActive },
    { t: 'mine', x: 5, y: 55 },
    { t: 'walk', x: 5.5, y: 56.4 }, { t: 'act', check: CHEST(5, 56) }, // landing medkit
    { t: 'walk', x: 14.5, y: 58.5 },
    { t: 'wait', until: (g, f) => f.sealForged },
    { t: 'mine', x: 24, y: 55 },
    ...ballTo(MARCH.plaza),
    { t: 'walk', x: 38.5, y: 53.4 },
    { t: 'holdact', until: (g, f) => f.beaconBuilt, timeout: 30 * 50 }, // the plaza checkpoint
    ...ballTo(MARCH.forecourt),
    ...gateAssault(49.5, 52.5),
    ...(cfg.buildBarricades ? [
      { t: 'walk', x: 47.5, y: 46.4 },
      { t: 'holdact', until: (g, f) => f.barr1Built || g.shards < 4, timeout: 30 * 30 },
      { t: 'walk', x: 53.5, y: 46.4 },
      { t: 'holdact', until: (g, f) => f.barr2Built || g.shards < 4, timeout: 30 * 30 },
    ] : []),
    ...ballTo(MARCH.westLeg),
    ...westAssault(33.5, 35.5),
    ...ballTo(MARCH.northLeg),
    ...ballTo(MARCH.eastLeg),
    ...eastAssault(71.5, 22.5),
    ...seat('seat-6', 32.5, 33.4), // (32,32) — the long western trek
    { t: 'wait', until: (g, f) => f.quorum },
    ...ballTo(MARCH.court),
    { t: 'wait', until: (g, f) => f.hollowOpen },
    { t: 'walk', x: 53.5, y: 32.5 },
    { t: 'wait', until: (g, f) => f.riteDone },
    { t: 'wait', until: (g, f) => f.eyeArrived >= 1 }, // second through
    { t: 'walk', x: 74.5, y: 10.5 },
    ...eyeAssault(77.5, 9.5),
    { t: 'wait', until: (g, f) => f.anchorReached },
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
const ROSTER = ['sniper', 'scout', 'shade', 'volt', 'soldier', 'raider', 'duelist', 'helix', 'medic', 'grenadier', 'pyro', 'boomer'];

function fnv(h, s) { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }

// --- one chapter attempt -----------------------------------------------------
function runChapter(cfg) {
  const g = createGame(def, PARTY, charMap, ROSTER);
  const bots = buildBots(cfg);
  const flags = { actWhiffs: [], eyeArrived: 0 };
  const log = [];
  let hash = 2166136261;
  const bossIds = BOSS_TILES.map(([tx, ty]) =>
    g.enemies.find(e => e.kind === 'boss' && Math.floor(e.x / TILE) === tx && Math.floor(e.y / TILE) === ty)?.id);
  const sniperPlazaId = g.enemies.find(e => e.kind === 'sniper' && Math.floor(e.x / TILE) === 66)?.id;
  const spawnerIds = [[26, 18], [74, 18], [91, 5]].map(([tx, ty]) =>
    g.enemies.find(e => e.kind === 'spawner' && Math.floor(e.x / TILE) === tx && Math.floor(e.y / TILE) === ty)?.id);
  const phantom = { seen: false, minD: Infinity, t: 0 };
  let timeLeftDrift = false;
  let frame = 0;
  const alive = id => g.enemies.some(e => e.id === id && !e.dead);
  const hotRect = (x0, x1, y0, y1, skipAco = false) => {
    for (const e of g.enemies) {
      if (e.dead) continue;
      if (skipAco && e.kind === 'acolyte') continue;
      const tx = Math.floor(e.x / TILE), ty = Math.floor(e.y / TILE);
      if (tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1) return true;
    }
    return false;
  };

  const frames = Math.ceil(CAP / DT);
  for (; frame < frames && g.status === 'play'; frame++) {
    // mission control: squad flags from live state
    flags.gateBossDead = !alive(bossIds[0]);
    flags.westBossDead = !alive(bossIds[1]);
    flags.eastBossDead = !alive(bossIds[2]);
    flags.eyeBossDead = !alive(bossIds[3]);
    flags.plazaSniperDead = !alive(sniperPlazaId);
    flags.westBroodDead = !alive(spawnerIds[0]);
    flags.eastBroodDead = !alive(spawnerIds[1]);
    flags.eyeBroodDead = !alive(spawnerIds[2]);
    if (!flags.isletClear) flags.isletClear = !hotRect(78, 95, 48, 64);
    if (!flags.gateCampDead) flags.gateCampDead = flags.gateBossDead && !hotRect(40, 60, 37, 44, true);
    if (!flags.hollowClear) flags.hollowClear = flags.hollowOpen && !hotRect(43, 57, 28, 33, true);
    const staged = tag => bots.filter(b => b.tasks[b.ti]?.tag === tag && g.players[b.pid]?.state === 'active').length;
    if (!flags.gateGo) flags.gateGo = staged('gate') >= 4 || g.elapsed > cfg.gateBy;
    if (!flags.westGo) flags.westGo = (staged('west') >= 4 && flags.gateCampDead) || g.elapsed > cfg.westBy;
    if (!flags.eastGo) flags.eastGo = (staged('east') >= 4 && flags.westBossDead) || g.elapsed > cfg.eastBy;
    if (!flags.goSeats) {
      const ringSafe = flags.gateBossDead && flags.westBossDead && flags.eastBossDead
        && flags.westBroodDead && flags.eastBroodDead;
      flags.goSeats = (staged('seat') >= 4 && ringSafe) || g.elapsed > cfg.seatsBy;
    }
    if (!flags.eyeGo) flags.eyeGo = staged('eye') >= 4 || (flags.eyeArrived >= 4 && g.elapsed > (flags.eyeFirstT ?? Infinity) + 40);
    // eye arrivals (latched per pid): how many seats stand inside the eye
    let inEye = 0;
    for (const p of g.players) {
      if (p.state === 'active' && p.x > 70 * TILE && p.y < 13 * TILE) inEye++;
    }
    if (inEye > 0 && flags.eyeFirstT === undefined) flags.eyeFirstT = g.elapsed;
    flags.eyeArrived = Math.max(flags.eyeArrived, inEye);

    const inputs = {};
    for (const bot of bots) inputs[bot.pid] = think(g, bot, flags, frame);
    if (TRACE.length === 3 && g.elapsed >= TRACE[1] && g.elapsed <= TRACE[2] && frame % 15 === 0) {
      const b = bots[TRACE[0]], p = g.players[TRACE[0]], tk = b.tasks[b.ti];
      console.log(`TRACE t=${g.elapsed.toFixed(1)} p=(${(p.x / TILE).toFixed(2)},${(p.y / TILE).toFixed(2)}) hp=${p.hp} st=${p.state} ride=${p.riding ?? '-'} ti=${b.ti} task=${tk?.t}@${tk?.x},${tk?.y} stuck=${b.stuck} inp=${JSON.stringify(inputs[TRACE[0]])}`);
    }
    step(g, inputs, DT);
    if (g.timeLeft !== def.time) timeLeftDrift = true;
    const evs = g.events.splice(0);

    // phantom reveal: the Seal bearer inside 6 tiles of a nest acolyte
    const carrier = g.players.find(pp => pp.state === 'active' && pp.lythseal);
    if (carrier && !phantom.seen) {
      for (const e of g.enemies) {
        if (e.dead || e.kind !== 'acolyte') continue;
        const d = Math.hypot(e.x - carrier.x, e.y - carrier.y) / TILE;
        if (d < 6) {
          const me = snapshot(g, false).players.find(sp => sp.pid === carrier.pid);
          phantom.seen = !!me?.hasSeal;
          phantom.minD = d;
          phantom.t = g.elapsed;
          break;
        }
      }
    }

    for (const ev of evs) {
      const rec = { ...ev, t: g.elapsed };
      log.push(rec);
      if (ev.type === 'quest' && ev.state === 'active') flags.questsActive = true;
      if (ev.type === 'quest' && ev.id === 'q-forks') flags.cassioTalked = true;
      if (ev.type === 'sealForged') { flags.sealForged = true; rec.shardsAfter = g.shards; }
      if (ev.type === 'quorum') { flags.quorum = true; rec.onAt = g.switches.filter(s => s.on).length; }
      if (ev.type === 'doorOpen' && ev.id === 'nest-gate') flags.nestOpen = true;
      if (ev.type === 'doorOpen' && ev.id === 'hollow-gate') flags.hollowOpen = true;
      if (ev.type === 'doorOpen' && ev.id === 'eye-gate') flags.eyeOpen = true;
      if (ev.type === 'glyphDone' && ev.group === 0) flags.riteDone = true;
      if (ev.type === 'questProgress' && ev.id === 'q-genesis') flags.anchorReached = true;
      if (ev.type === 'built' && ev.kind === 'beacon') flags.beaconBuilt = true;
      if (ev.type === 'built' && ev.kind === 'barricade') {
        if (ev.x < 50 * TILE) flags.barr1Built = true; else flags.barr2Built = true;
      }
      if (ev.type !== 'shoot' && ev.type !== 'hitWall' && ev.type !== 'build' && ev.type !== 'aim') {
        hash = fnv(hash, `${ev.type}:${ev.pid ?? ev.id ?? ''}:${Math.round(ev.x ?? 0)},${Math.round(ev.y ?? 0)};`);
      }
      if (DEBUG && !['shoot', 'hitWall', 'build', 'aim', 'shard', 'die', 'spawnEnemy', 'playerHit', 'hit', 'alert', 'patch', 'pyreBurst', 'shield', 'shieldPop', 'enemyShield', 'levelUp', 'heal'].includes(ev.type)) {
        console.log('  EV t=' + g.elapsed.toFixed(1), JSON.stringify(rec).slice(0, 150));
      }
    }
    if (DEBUG && frame % (30 * 15) === 0) {
      console.log(`t=${g.elapsed.toFixed(0)} shards=${g.shards.toFixed(0)} on=${g.switches.filter(s => s.on).length} `
        + g.players.map(p => `${p.pid}:${p.state[0]}${p.hp ?? ''}@${(p.x / TILE).toFixed(0)},${(p.y / TILE).toFixed(0)}${bots[p.pid] ? '#' + bots[p.pid].ti : ''}`).join(' ')
        + ` flags=${['sealForged', 'gateCampDead', 'westBossDead', 'eastBossDead', 'goSeats', 'quorum', 'hollowOpen', 'riteDone', 'eyeOpen', 'eyeBossDead'].filter(k => flags[k]).join(',') || '-'}`);
    }
  }
  return { g, log, hash, flags, phantom, timeLeftDrift, frames: frame, snap: snapshot(g) };
}

// --- the certification: at most three attempt configs ------------------------
const ATTEMPTS = [
  { // 1: baseline doctrine
    id: 1, regroupTimeout: 30 * 45, lanceEngage: 10, spawnerRange: 8, buildBarricades: false,
    gateBy: 700, westBy: 850, eastBy: 1100, seatsBy: 1500,
  },
  { // 2: cautious — barricade money at the gate, longer regroups
    id: 2, regroupTimeout: 30 * 60, lanceEngage: 11, spawnerRange: 9, buildBarricades: true,
    gateBy: 800, westBy: 1000, eastBy: 1300, seatsBy: 1700,
  },
  { // 3: siege pace — everything slower and safer
    id: 3, regroupTimeout: 30 * 75, lanceEngage: 12, spawnerRange: 10, buildBarricades: true,
    gateBy: 900, westBy: 1150, eastBy: 1500, seatsBy: 1900,
  },
];

console.log('--- CH XI playtest: 4-seat squad, the saga finale, <=3 attempts ---');
let A = null, attemptUsed = 0;
for (const cfg of ATTEMPTS) {
  attemptUsed = cfg.id;
  console.log(`\n=== attempt ${cfg.id} ===`);
  A = runChapter(cfg);
  console.log(`attempt ${cfg.id}: status=${A.g.status} t=${A.g.elapsed.toFixed(0)}s kills=${A.g.kills} downs=${A.log.filter(e => e.type === 'down').length}`);
  if (A.g.status === 'cleared') break;
}

// ---------------- verdicts ----------------
const ev = type => A.log.filter(e => e.type === type);

check('CERTIFIED: chapter cleared within 3 attempts', A.g.status === 'cleared' && attemptUsed <= 3,
  `cleared on attempt ${attemptUsed}/3 at t=${A.g.elapsed.toFixed(0)}s, score ${Math.round(A.g.score)}`);

check('untimed story: timeLeft frozen, snapshot untimed, no lowTime',
  !A.timeLeftDrift && A.snap.untimed === true && !ev('lowTime').length,
  `timeLeft pinned at ${def.time}s, elapsed=${A.g.elapsed.toFixed(0)}s`);

check('dark nest: sim runs the dark modifier', A.g.dark === true);

// quests
const qs = id => A.g.quests.find(q => q.id === id);
check('keeper quests activate at the First Keeper', A.flags.questsActive === true,
  ev('quest').filter(e => e.state === 'active').map(e => e.id).join(', '));
check('q-landfall (main) tripped at the plaza gate', qs('q-landfall').progress >= 1);
check('skiff channel run: mounts and dismounts both ways',
  ev('mount').length >= 4 && ev('dismount').length >= 4,
  `${ev('mount').length} mounts, ${ev('dismount').length} dismounts`);
const qp = ev('qitemPickup');
check('both proof fragments scooped on the deep-nest islet', qp.length >= 2,
  qp.map(e => `${e.id}->pid${e.pid}@${e.t.toFixed(0)}s`).join(', '));
check('q-fragment settled (handover consumed one fragment)', qs('q-fragment').state === 'done');
const sf = ev('sealForged');
check('Genesis Seal forged at the brazier (fragment + 20 shards)',
  sf.length === 1 && qs('q-seal').state === 'done' && A.g.qitems.length === 0,
  sf.length ? `@${sf[0].t.toFixed(0)}s by pid${sf[0].pid}, pool after=${sf[0].shardsAfter}` : 'never');

// the founding seats
const quorum = ev('quorum');
const swEv = ev('switch');
const resets = ev('switchReset');
check('the Founding Seats: 7-of-10 quorum inside one 120s window',
  quorum.length === 1 && quorum[0].onAt === 7 && A.flags.nestOpen,
  quorum.length ? `quorum @${quorum[0].t.toFixed(0)}s with ${quorum[0].onAt} seats on, ${swEv.length} throws, ${resets.length} window resets` : 'no quorum');
check('switch quest (q-seats) progressed', qs('q-seats').progress >= 1);

// the seal door + the rite
check('hollow-gate (sealLock) opens on Genesis Seal touch',
  ev('doorOpen').some(e => e.id === 'hollow-gate'));
check('Phantom reveal: hasSeal carrier within 6 tiles of a nest acolyte',
  A.phantom.seen, A.phantom.seen ? `d=${A.phantom.minD.toFixed(1)} tiles @${A.phantom.t.toFixed(0)}s` : 'never sampled');
const glyphsLit = ev('glyph');
check('the Genesis Rite: 4 runes in order, no resets, eye-gate opens',
  ev('glyphDone').length >= 1 && ev('glyphReset').length === 0 && A.flags.eyeOpen
  && glyphsLit.filter(e => e.group === 0).length === 4,
  `runes lit: ${glyphsLit.map(e => e.symbol).join('>')}`);
check('glyph quest (q-rite) progressed', qs('q-rite').progress >= 1);

// the eye
const tp = ev('teleport');
check('the settled corridor: all four operatives blink into the eye', tp.length >= 4,
  `${tp.length} blinks`);
check('q-eye tripped at the corridor mouth', qs('q-eye').progress >= 1);

// the gauntlet
const bossesLeft = A.g.enemies.filter(e => !e.dead && e.kind === 'boss').length;
check('multi-boss gauntlet: all four bosses down (gate warden, west ring, east ring, the nest)',
  bossesLeft === 0, `${bossesLeft} bosses left alive`);
check('q-genesis (main) tripped: the First Anchor touched, finale clears at the ring',
  A.flags.anchorReached && ev('clear').length === 1 && ev('extract').length >= 1,
  `status=${A.g.status}, ${ev('extract').length} extracted at the clear`);
check('save beacon built at the plaza', A.flags.beaconBuilt === true);

// waves
const waves = ev('wave');
check('the nest answered: edge waves fired and were survived',
  waves.length >= 2 && A.g.status === 'cleared',
  `${waves.length} waves (${waves.map(w => w.edge + '@' + w.t.toFixed(0) + 's').join(', ')})`);

// ledger + wrap
note('quest ledger: ' + A.g.quests.map(q => `${q.id}=${q.state}(${q.progress}/${q.count})`).join(' '));
const downs = ev('down').length;
note(`downs: ${downs}; kills: ${A.g.kills}; pool end: ${A.g.shards.toFixed(0)} shards; frames: ${A.frames}`);
if (A.flags.actWhiffs.length) note('act whiffs (task gave up): ' + A.flags.actWhiffs.join(', '));
for (const p of A.g.players) {
  note(`${PARTY[p.pid].name.padEnd(7)} ${p.state.padEnd(10)} char=${p.charId ?? '-'} hp=${p.hp ?? '-'} item=${p.item ? p.item.kind + 'x' + p.item.count : '-'} xp=${p.xp?.toFixed(0) ?? '-'} L${p.level ?? '-'}${p.lythseal ? ' SEAL' : ''}`);
}

// ---------------- determinism: rerun the cleared config ----------------
const B = runChapter(ATTEMPTS[attemptUsed - 1]);
check('determinism: the cleared attempt replays to the same event hash and clock',
  B.hash === A.hash && B.g.status === A.g.status && Math.abs(B.g.elapsed - A.g.elapsed) < 0.001,
  `hashes ${A.hash.toString(16)} / ${B.hash.toString(16)}, t=${A.g.elapsed.toFixed(1)} / ${B.g.elapsed.toFixed(1)}`);

const failed = checks.filter(c => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
