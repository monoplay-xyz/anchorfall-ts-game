// Headless playtest: STORY CHAPTER VIII (levels/level18.json, "The Prover Array").
// Four scripted operatives drive the full chapter through the real sim:
//
//   pid 0  LANCE  sniper  pillar demolition (rail + railcannon), sw4
//   pid 1  RUNNER scout   quest talks, proof fragment, seal forge, vault, sw5-8
//   pid 2  GHOST  shade   chest economy, sw3, the completion-talk round trip
//   pid 3  SPARK  volt    chests, stormgun, save beacon, sw9
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
const def = JSON.parse(fs.readFileSync(path.join(root, 'levels/level18.json'), 'utf8'));
const characters = JSON.parse(fs.readFileSync(path.join(root, 'shared/characters.json'), 'utf8'));
const charMap = charsById(characters);

const DT = 1 / 30;
const DEBUG = +(process.env.CH8_DEBUG || 0);
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
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    const interested = (e.awake && d < engageT * TILE) || d < 4.5 * TILE;
    if (!interested) continue;
    if (!losShot(g, p.x, p.y, e.x, e.y)) continue;
    if (d < bd) { bd = d; tgt = e; }
    if (e.kind === 'acolyte' && d < ad) { ad = d; aco = e; }
  }
  if (!tgt) return false;
  if (aco && ad < engageT * TILE) { tgt = aco; bd = ad; } // priority kill
  if (bd < 1.6 * TILE) {
    // too close: give ground (movement sets facing, so no fire this frame)
    const ux = (p.x - tgt.x) / (bd || 1), uy = (p.y - tgt.y) / (bd || 1);
    if (ux < -0.3) inp.left = true; else if (ux > 0.3) inp.right = true;
    if (uy < -0.3) inp.up = true; else if (uy > 0.3) inp.down = true;
    return true;
  }
  if (bd > weaponRange(g, p) * TILE) return false; // out of reach: keep tasking
  // never stand-and-fight ON a live pad — sidestep first
  if (onPadTile(g, p) && !bot.mem.padWait) { sidestepPad(g, p, inp); return true; }
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
      if (task.until(g, flags)) bot.ti++;
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
      walkTo(g, bot, p, (d.x + 0.5) * TILE, (d.y + d.h / 2) * TILE, inp);
      break;
    }
  }
  return inp;
}

// --- mission script ---------------------------------------------------------------
const PILL = id => g => !g.pillars.some(pl => pl.id === id);
const SW = id => g => !!g.switches.find(s => s.id === id)?.on;
const CHEST = (tx, ty) => g => !!g.chests.find(c => Math.floor(c.x / TILE) === tx && Math.floor(c.y / TILE) === ty)?.opened;
const at = (g, pid, tx, ty, r = 3) => {
  const p = g.players[pid];
  return p && p.state === 'active' && Math.hypot(p.x - (tx + 0.5) * TILE, p.y - (ty + 0.5) * TILE) < r * TILE;
};
const VAULT_BOSS = { x: 69.5, y: 46.5 };
const CORE_BOSS = { x: 86.5, y: 32.5 };
const MUSTER = { x: 57.5, y: 37.5 };
const vaultAssault = [
  { t: 'walk', x: MUSTER.x, y: MUSTER.y },
  { t: 'wait', until: (g, f) => f.muster },
  { t: 'shoot', x: VAULT_BOSS.x, y: VAULT_BOSS.y, range: 9, until: (g, f) => f.vaultBossDead },
];
const coreAssault = pid => [
  { t: 'wait', until: (g, f) => f.coreOpen },
  { t: 'walk', x: 78.5, y: 31.5 + (pid % 2) },
  { t: 'shoot', x: CORE_BOSS.x, y: CORE_BOSS.y, range: 9, until: (g, f) => f.coreBossDead || g.elapsed > f.coreOpenT + 120 },
];

// after their own success throw, each outer bot backs up a missing voice
const backup = (pid, sx, standX, standY) => ([
  { t: 'wait', until: (g, f) => f.quorum || g.elapsed > f.goSuccessT + 25 + pid * 18 },
  { t: 'walk', x: standX, y: standY, skipIf: (g, f) => f.quorum },
  { t: 'act', check: g => SW(sx)(g), skipIf: (g, f) => f.quorum },
]);

function buildBots() {
  // pid 0 LANCE (sniper): NW pillar row, then the eastern colonnade with the railcannon
  const lance = makeBot(0, [
    { t: 'wait', until: (g, f) => f.questsActive },
    { t: 'walk', x: 14.5, y: 22.5 }, // pad route W into the forge quarter
    { t: 'walk', x: 17.5, y: 12.5 },
    { t: 'shoot', x: 20.5, y: 8.5, range: 9, until: PILL('pl0') },
    { t: 'shoot', x: 23.5, y: 8.5, range: 9, until: PILL('pl1') },
    { t: 'shoot', x: 26.5, y: 8.5, range: 9, until: PILL('pl2') },
    { t: 'walk', x: 29.5, y: 13.6 }, { t: 'act', check: CHEST(29, 12) }, // medkit chest
    { t: 'walk', x: 42.5, y: 4.5 },  // north pad -> archive strip
    { t: 'walk', x: 50.5, y: 4.4 }, { t: 'act', check: CHEST(50, 3) },   // shard chest +10
    { t: 'walk', x: 55.5, y: 6.5 }, { t: 'act', check: g => g.players[0].fieldWeapon?.kind === 'railcannon' }, // railcannon
    { t: 'walk', x: 84.5, y: 17.5 }, // east pad pair down into the array floor
    { t: 'walk', x: 70.5, y: 19.5 },
    { t: 'shoot', x: 64.5, y: 22.5, range: 11, until: PILL('pl5') },
    { t: 'shoot', x: 61.5, y: 22.5, range: 11, until: PILL('pl4') },
    { t: 'shoot', x: 58.5, y: 22.5, range: 11, until: PILL('pl3') },
    ...vaultAssault,
    { t: 'walk', x: 60.5, y: 36.5 }, // hold OFF sw4 through the deliberate fail
    { t: 'wait', until: (g, f) => f.switchReset },
    { t: 'walk', x: 60.5, y: 39.6 },
    { t: 'wait', until: (g, f) => f.goSuccess },
    { t: 'act', check: SW('voice-4') }, // sw4 at (60,38)
    ...backup(0, 'voice-2', 72.5, 27.6), // sw2 (72,26) if the quorum hangs
    ...coreAssault(0),
    { t: 'walk', x: 85.5, y: 31.5 },
    { t: 'walk', x: 88.5, y: 31.5, allowExit: true }, // extract
  ]);
  lance.engageT = 10;

  // pid 1 RUNNER (scout): quest giver, fragment, forge, vault, the inner four relays
  const runner = makeBot(1, [
    { t: 'walk', x: 10.5, y: 44.4 }, { t: 'act', check: (g, f) => f.questsActive }, // sel-brakka
    { t: 'walk', x: 14.5, y: 22.5 }, // west pad pair
    { t: 'walk', x: 12.5, y: 17.3 }, { t: 'act', check: g => g.quests.find(q => q.id === 'q-seal').state !== 'hidden' }, // hask
    { t: 'walk', x: 4.5, y: 4.5 },   // proof fragment (touch-scoop)
    { t: 'walk', x: 9.5, y: 12.5 },
    { t: 'wait', until: g => g.shards >= 20 },
    { t: 'walk', x: 8.6, y: 12.5 },
    { t: 'holdact', until: (g, f) => f.sealForged },
    { t: 'walk', x: 12.5, y: 17.3 }, { t: 'act', check: g => g.quests.find(q => q.id === 'q-seal').state === 'done' }, // settle q-seal
    ...vaultAssault,
    { t: 'touchdoor', id: 'vault' },
    { t: 'walk', x: 74.5, y: 42.6 }, // inner cluster: stand by sw5
    { t: 'wait', until: (g, f) => f.goFail },
    { t: 'act', check: SW('voice-5') },                                  // sw5 (74,41)
    { t: 'walk', x: 78.5, y: 42.6 }, { t: 'act', check: SW('voice-6') }, // sw6 (78,41)
    { t: 'walk', x: 74.5, y: 46.4 }, { t: 'act', check: SW('voice-7') }, // sw7 (74,47)
    { t: 'walk', x: 78.5, y: 46.4 }, { t: 'act', check: SW('voice-8') }, // sw8 (78,47) = 6th throw
    { t: 'walk', x: 80.5, y: 49.6 }, { t: 'act', check: CHEST(80, 48) }, // vault token chest
    { t: 'wait', until: (g, f) => f.switchReset },
    { t: 'walk', x: 74.5, y: 42.6 },
    { t: 'wait', until: (g, f) => f.goSuccess },
    { t: 'act', check: SW('voice-5') },
    { t: 'walk', x: 78.5, y: 42.6 }, { t: 'act', check: SW('voice-6') },
    { t: 'walk', x: 74.5, y: 46.4 }, { t: 'act', check: SW('voice-7') },
    { t: 'walk', x: 78.5, y: 46.4 }, { t: 'act', check: SW('voice-8') },
    ...coreAssault(1),
    { t: 'walk', x: 85.5, y: 32.5 }, // the Array core: q-core 'reach'
    { t: 'walk', x: 88.5, y: 32.5, allowExit: true },
  ]);

  // pid 2 GHOST (shade): south chests, sw3, then the settle-the-ledger talk run
  const ghost = makeBot(2, [
    { t: 'wait', until: (g, f) => f.questsActive },
    { t: 'shoot', x: 14.5, y: 36.5, range: 6, until: g => !g.crystals.some(c => Math.floor(c.x / TILE) === 14 && Math.floor(c.y / TILE) === 36) },
    { t: 'walk', x: 24.5, y: 43.6 }, { t: 'act', check: CHEST(24, 42) }, // chest +8
    { t: 'walk', x: 42.5, y: 52.5 }, // south pads east
    { t: 'walk', x: 40.5, y: 55.4 }, { t: 'act', check: CHEST(40, 57) }, // chest +9
    ...vaultAssault,
    { t: 'walk', x: 43.5, y: 34.6 }, // stage at sw3 (43,34)
    { t: 'wait', until: (g, f) => f.goFail },
    { t: 'act', check: SW('voice-3') },
    { t: 'wait', until: (g, f) => f.switchReset },
    { t: 'walk', x: 43.5, y: 34.6 },
    { t: 'wait', until: (g, f) => f.goSuccess },
    { t: 'act', check: SW('voice-3') },
    ...backup(2, 'voice-1', 46.5, 19.6), // sw1 (46,18) if the quorum hangs
    { t: 'wait', until: (g, f) => f.reachDone },
    { t: 'walk', x: 10.5, y: 44.4 }, { t: 'act', check: g => g.quests.find(q => q.id === 'q-migration').state === 'done' },
    { t: 'walk', x: 85.5, y: 31.5 },
    { t: 'walk', x: 88.5, y: 31.5, allowExit: true },
  ]);

  // pid 3 SPARK (volt): stormgun, beacon, sw9
  const spark = makeBot(3, [
    { t: 'wait', until: (g, f) => f.questsActive },
    { t: 'walk', x: 28.5, y: 50.5 }, // south pad east with GHOST
    { t: 'walk', x: 50.5, y: 44.5 },
    { t: 'walk', x: 56.5, y: 31.6 }, { t: 'act', check: g => g.players[3].fieldWeapon?.kind === 'stormgun' }, // stormgun
    { t: 'wait', until: (g, f) => f.sealForged && g.shards >= 12 },
    { t: 'walk', x: 45.5, y: 50.4 },
    { t: 'holdact', until: (g, f) => f.beaconBuilt },
    ...vaultAssault,
    { t: 'walk', x: 50.5, y: 49.4 }, // stage at sw9 (50,50)
    { t: 'wait', until: (g, f) => f.goFail },
    { t: 'act', check: SW('voice-9') },
    { t: 'wait', until: (g, f) => f.switchReset },
    { t: 'walk', x: 50.5, y: 49.4 },
    { t: 'wait', until: (g, f) => f.goSuccess },
    { t: 'act', check: SW('voice-9') },
    ...coreAssault(3),
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
    if (!flags.muster) {
      let near = 0;
      for (const p of g.players) {
        if (p.state === 'active' && Math.hypot(p.x - MUSTER.x * TILE, p.y - MUSTER.y * TILE) < 9 * TILE) near++;
      }
      flags.muster = near >= 3 || g.elapsed > 420;
    }
    if (!flags.switchReset) {
      flags.goFail = flags.goFail
        || (flags.vaultOpen && at(g, 1, 74, 42, 4) && at(g, 2, 43, 34, 3) && at(g, 3, 50, 49, 3));
    } else if (!flags.goSuccess) {
      flags.goSuccess = (at(g, 1, 74, 42, 4) && at(g, 2, 43, 34, 3) && at(g, 3, 50, 49, 3) && at(g, 0, 60, 39, 3))
        || g.elapsed > (flags.switchResetT ?? Infinity) + 200;
      if (flags.goSuccess) flags.goSuccessT = g.elapsed;
    }
    // door state is read straight off the sim so a drained event can never
    // stall the script (events drive the verdicts, state drives the bots)
    if (g.doors.find(d => d.id === 'vault')?.open) flags.vaultOpen = true;
    if (g.doors.find(d => d.id === 'core-gate')?.open && !flags.coreOpen) { flags.coreOpen = true; flags.coreOpenT = g.elapsed; }
    const inputs = {};
    for (const bot of bots) inputs[bot.pid] = think(g, bot, flags, frame);
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
      if (ev.type === 'doorOpen' && ev.id === 'vault') flags.vaultOpen = true;
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
        + g.players.map(p => `${p.pid}:${p.state[0]}${p.hp ?? ''}@${(p.x / TILE).toFixed(0)},${(p.y / TILE).toFixed(0)}${bots[p.pid] ? '#' + bots[p.pid].ti : ''}`).join(' '));
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
