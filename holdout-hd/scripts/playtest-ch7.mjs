// Headless playtest: CHAPTER VII — The Anchorcraft (levels/level17.json).
// Two scripted operatives drive the FULL quest chain through the real sim
// (shared/game.js) with flow-field (BFS) pathing and scripted quest intent:
// the director reads def.quests and the npc hint lines (riddle -> rune table)
// and drives each step — village talks, three component fetches (husk-nest
// fragment, guarded depot plating, skiff-islet coil, 3-rune vault regulator),
// the launch-pylon repair build, the airlock teleport, the 4-rune helm rite,
// and the final reach at the helm console. Deterministic: no Math.random.
//
//   pid 0  RUNNER  scout  does the quest legwork (talks/fetches/runes/pads)
//   pid 1  ESCORT  medic  rides shotgun, holds chokepoints, grabs field guns
//
// No invuln cheats anywhere — survivability (the husk swarm especially) is
// measured at intended hp levels.
//
// Run: node scripts/playtest-ch7.mjs   (exit 0 = all checks pass)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { charsById, createGame, restoreGame, serializeGame, snapshot, step, TILE } from '../shared/game.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const def = JSON.parse(fs.readFileSync(path.join(root, 'levels/level17.json'), 'utf8'));
const characters = JSON.parse(fs.readFileSync(path.join(root, 'shared/characters.json'), 'utf8'));
const charMap = charsById(characters);

const DT = 1 / 30;
const CAP_S = 2400; // hard mission cap (sim seconds)
const checks = [];
const issues = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) issues.push(`${name}${detail ? ' (' + detail + ')' : ''}`);
}
function note(msg) { console.log('      ' + msg); }
const T = n => (n + 0.5) * TILE; // tile -> px center
const tx = px => Math.floor(px / TILE);

// --- riddle -> rune resolution (whitepaper rune table from render.js) --------
const RUNES = { ANCHOR: 0, WAVE: 1, VERTEX: 2, SEAL: 3, FORK: 4, BURN: 5, QUORUM: 6, DRIFT: 7 };
const RIDDLES = [
  [/mark that cannot be unsaid/i, 'ANCHOR'],
  [/seven of ten/i, 'QUORUM'],
  [/waits for all who are not anchored/i, 'DRIFT'],
  [/breath the field takes together/i, 'WAVE'],
  [/one voice, once/i, 'VERTEX'],
  [/read (only )?at inclusion/i, 'SEAL'],
];
// scan a hint line left-to-right; every riddle that matches contributes its
// rune at its match position — the sorted result is the encoded order
function runesIn(text) {
  const found = [];
  for (const [re, rune] of RIDDLES) {
    const m = text.match(re);
    if (m) found.push({ at: m.index, sym: RUNES[rune], rune });
  }
  return found.sort((a, b) => a.at - b.at);
}
const sefaLines = def.npcs.find(n => n.id === 'elder-sefa').lines;
const plaqueLines = def.npcs.find(n => n.id === 'pilots-plaque').lines;
const vaultOrder = runesIn(sefaLines.find(l => /vault answers three runes/.test(l))).map(r => r.sym);
const helmFirst = runesIn(sefaLines.find(l => /helm rite begins/.test(l))).map(r => r.sym);
const helmLast = runesIn(plaqueLines.find(l => /rite, continued/.test(l))).map(r => r.sym);
const helmOrder = helmFirst.concat(helmLast);
check('npc hint lines encode the vault runes (riddle table resolves 3 symbols)',
  vaultOrder.join() === (def.glyphGroups.find(g => g.group === 0).order.join()),
  `hints say [${vaultOrder}], def group 0 wants [${def.glyphGroups.find(g => g.group === 0).order}]`);
check('npc hint lines encode the helm rite (sefa 2 + plaque 2 = 4 symbols)',
  helmOrder.join() === (def.glyphGroups.find(g => g.group === 1).order.join()),
  `hints say [${helmOrder}], def group 1 wants [${def.glyphGroups.find(g => g.group === 1).order}]`);

// --- pathing -----------------------------------------------------------------
const footBlocked = c => c === '#' || c === 'T' || c === '~' || c === 'o';
const tileCh = (g, x, y) => g.grid[y]?.[x] ?? '#';
function blockedAt(g, x, y) { // mirrors sim tileBlocked: doors + built structures
  if (footBlocked(tileCh(g, x, y))) return true;
  for (const d of g.doors) if (!d.open && x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h) return true;
  for (const b of g.builds) if (b.built && b.kind !== 'farm' && tx(b.x) === x && tx(b.y) === y) return true;
  return false;
}
function bfsField(g, px, py, water = false) {
  const pass = water
    ? (x, y) => tileCh(g, x, y) === '~'
    : (x, y) => !blockedAt(g, x, y);
  const sx = tx(px), sy = tx(py);
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
      if (dist[ni] !== -1 || !pass(nx, ny)) continue;
      dist[ni] = dist[cur] + 1;
      prev[ni] = cur;
      q.push(ni);
    }
  }
  return { dist, prev };
}
function planPath(g, p, gx, gy, water = false) {
  const { dist, prev } = bfsField(g, p.x, p.y, water);
  const gtx = tx(gx), gty = tx(gy);
  let best = -1, bestScore = Infinity;
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] === -1) continue;
    const cx = i % g.w, cy = (i / g.w) | 0;
    const d = Math.hypot(cx - gtx, cy - gty) * 10 + dist[i] * 0.05;
    if (d < bestScore) { bestScore = d; best = i; }
  }
  if (best === -1) return [];
  const rev = [];
  for (let i = best; i !== -1; i = prev[i]) rev.push(i);
  rev.reverse();
  return rev.slice(1).map(i => ({ x: T(i % g.w), y: T((i / g.w) | 0) }));
}
function losClear(g, ax, ay, bx, by) {
  const d = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(d / 12));
  for (let i = 1; i < steps; i++) {
    const px = ax + (bx - ax) * (i / steps), py = ay + (by - ay) * (i / steps);
    const c = tileCh(g, tx(px), tx(py));
    if (c === '#' || c === 'T') return false;
    for (const dr of g.doors) {
      if (!dr.open && tx(px) >= dr.x && tx(px) < dr.x + dr.w && tx(py) >= dr.y && tx(py) < dr.y + dr.h) return false;
    }
  }
  return true;
}

// --- bot chassis ---------------------------------------------------------------
function makeBot(pid) {
  return { pid, path: [], repath: 0, relAct: 0, relFire: 0, relItem: 0, relSpec: 0, mem: { gx: -1, gy: -1 } };
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
  const moved = Math.hypot(bot.mem.gx - gx, bot.mem.gy - gy) > TILE;
  if (bot.repath <= 0 || moved || !bot.path.length) {
    bot.path = planPath(g, p, gx, gy);
    bot.mem.gx = gx; bot.mem.gy = gy;
    bot.repath = 15;
  }
  return moveAlong(bot, p, inp);
}
function pressAct(bot, inp) {
  if (bot.relAct > 0) return false;
  inp.act = true;
  bot.relAct = 8;
  return true;
}
function near(p, x, y, t = 1.2) { return Math.hypot(p.x - x, p.y - y) < TILE * t; }
// approach an entity and tap act in reach; returns true once a press went out
function actAt(g, bot, p, x, y, inp, reach = 1.1) {
  if (!near(p, x, y, reach)) { goTo(g, bot, p, x, y, inp); return false; }
  return pressAct(bot, inp);
}
function weaponRange(p) {
  if (p.fieldWeapon) return { flamer: 2.6, railcannon: 13, stormgun: 7, mortarMk2: 9 }[p.fieldWeapon.kind] ?? 5;
  return charMap[p.charId].weapon.range ?? 5;
}
// Combat reflex. Returns true when it owns this bot's frame.
function combat(g, bot, p, inp, opts = {}) {
  const engage = (opts.engage ?? 6.5) * TILE;
  // hostile burn patch underfoot: step out first
  for (const pa of g.patches) {
    if (pa.hostile && Math.hypot(p.x - pa.x, p.y - pa.y) < pa.r + 6) {
      const ux = (p.x - pa.x) / (Math.hypot(p.x - pa.x, p.y - pa.y) || 1);
      const uy = (p.y - pa.y) / (Math.hypot(p.x - pa.x, p.y - pa.y) || 1);
      if (ux < -0.3) inp.left = true; else if (ux > 0.3) inp.right = true;
      if (uy < -0.3) inp.up = true; else if (uy > 0.3) inp.down = true;
      return true;
    }
  }
  let tgt = null, bd = Infinity;
  for (const e of g.enemies) {
    if (e.dead || e.convertedT > 0) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    const sniperish = e.kind === 'sniper' || e.kind === 'archer';
    const maxR = sniperish && e.awake ? 11.5 * TILE : (e.awake ? engage : Math.min(engage, 5.5 * TILE));
    if (opts.zone && !opts.zone(e)) continue;
    if (d > maxR || !losClear(g, p.x, p.y, e.x, e.y)) continue;
    const score = d - (sniperish ? 3 * TILE : 0) - (e.kind === 'spawner' ? 2 * TILE : 0);
    if (score < bd) { bd = score; tgt = e; }
  }
  bot.dbg = tgt ? `${tgt.kind}@${tx(tgt.x)},${tx(tgt.y)} d=${(Math.hypot(tgt.x - p.x, tgt.y - p.y) / TILE).toFixed(1)} awake=${tgt.awake} hp=${tgt.hp}` : null;
  if (!tgt) {
    // items between fights
    if (p.item && bot.relItem <= 0 && p.maxHp !== undefined
      && ((p.item.kind === 'medkit' && p.hp < p.maxHp) || (p.item.kind === 'shield' && p.shield < 1))) {
      inp.item = true; bot.relItem = 10;
    }
    return false;
  }
  const d = Math.hypot(tgt.x - p.x, tgt.y - p.y);
  const range = weaponRange(p) * TILE * 0.95;
  // medic stim under pressure (real ability, not a cheat)
  if (charMap[p.charId].special?.kind === 'stim' && p.specialCool <= 0 && bot.relSpec <= 0) {
    let pressers = 0;
    for (const e of g.enemies) if (!e.dead && Math.hypot(e.x - p.x, e.y - p.y) < 2.2 * TILE) pressers++;
    if (p.hp <= 1 || pressers >= 2) { inp.special = true; bot.relSpec = 20; }
  }
  const keep = (tgt.kind === 'beetle' ? 2.3 : 1.7) * TILE;
  // bulwarks block frontal shots: whoever it chases kites, the other shoots
  let kite = d < keep;
  if (tgt.kind === 'bulwark') {
    let nearestPid = null, nd = Infinity;
    for (const q of g.players) {
      if (q.state !== 'active') continue;
      const qq = Math.hypot(tgt.x - q.x, tgt.y - q.y);
      if (qq < nd) { nd = qq; nearestPid = q.pid; }
    }
    if (nearestPid === p.pid && d < 3.2 * TILE) kite = true;
  }
  if (kite) {
    const ux = (p.x - tgt.x) / (d || 1), uy = (p.y - tgt.y) / (d || 1);
    if (ux < -0.3) inp.left = true; else if (ux > 0.3) inp.right = true;
    if (uy < -0.3) inp.up = true; else if (uy > 0.3) inp.down = true;
    return true;
  }
  if (d > range) { goTo(g, bot, p, tgt.x, tgt.y, inp); return true; }
  // stand and deliver (facing set directly, like the test-suite bots)
  inp.left = inp.right = inp.up = inp.down = false;
  p.fx = (tgt.x - p.x) / (d || 1);
  p.fy = (tgt.y - p.y) / (d || 1);
  inp.fire = true;
  return true;
}

// --- the mission ----------------------------------------------------------------
function fnv(h, s) { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }

function runMission(quiet = false) {
  const party = [
    { pid: 0, name: 'Runner', charId: 'scout' },
    { pid: 1, name: 'Escort', charId: 'medic' },
  ];
  const g = createGame(def, party, charMap, ['scout', 'medic', 'soldier', 'grenadier']);
  const R = g.players[0], E = g.players[1];
  const bots = [makeBot(0), makeBot(1)];
  const log = [];
  let hash = 2166136261;
  const marks = {}; // stage -> completion time
  const runIssues = [];
  const oops = (msg) => { runIssues.push(msg); if (!quiet) note('ISSUE: ' + msg); };

  // entity handles (live sim coordinates — the generator may have nudged tiles)
  const npc = id => g.npcs.find(n => n.id === id);
  const qi = kind => g.qitems.find(it => it.kind === kind); // undefined once consumed
  const quest = id => g.quests.find(q => q.id === id);
  const door = id => g.doors.find(d => d.id === id);
  const sw = id => g.switches.find(s => s.id === id);
  const buildOf = kind => g.builds.find(b => b.kind === kind);
  const skiff = g.vehicles[0];
  const padOut = g.teleports.find(t => tx(t.x) < 64);
  const padIn = g.teleports.find(t => tx(t.x) >= 64);
  const glyphsOf = grp => g.glyphs.filter(s => s.group === grp);
  const carrierOf = kind => { const it = qi(kind); return it && it.carrier != null ? g.players[it.carrier] : null; };
  const insideHull = p => tx(p.x) >= 64 && tx(p.x) <= 89 && tx(p.y) >= 24 && tx(p.y) <= 42;

  // light a glyph order step by step; returns true when the group is done
  function runeStep(grp, order, bot, p, inp) {
    const stones = glyphsOf(grp);
    const lit = stones.filter(s => s.lit).length;
    if (lit >= order.length) return true;
    const next = stones.find(s => !s.lit && s.symbol === order[lit]);
    if (!next) { oops(`rune order: no unlit stone for symbol ${order[lit]} in group ${grp}`); return true; }
    if (!near(p, next.x, next.y, 0.9)) { goTo(g, bot, p, next.x, next.y, inp); return false; }
    // only press when the intended stone is the nearest unlit one in reach
    let nearest = null, nd = Infinity;
    for (const s of stones) {
      if (s.lit) continue;
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < nd && d < 1.5 * TILE) { nd = d; nearest = s; }
    }
    if (nearest === next) pressAct(bot, inp);
    return false;
  }
  // teleport procedure: stand on the pad until the blink lands
  function channelAt(pad, bot, p, inp) {
    if (tx(p.x) === tx(pad.x) && tx(p.y) === tx(pad.y)) return true; // stand still
    goTo(g, bot, p, pad.x, pad.y, inp);
    return false;
  }
  function follow(bot, p, leader, inp, t = 2) {
    if (!near(p, leader.x, leader.y, t)) goTo(g, bot, p, leader.x, leader.y, inp);
  }

  // --- stage table: name, control, exit, budget(s) ---
  const sefa = npc('elder-sefa'), warden = npc('warden-mirelle'), hask = npc('hask-embervein'), plaque = npc('pilots-plaque');
  const sefaQuests = ['hull-plating', 'wave-coil', 'burn-regulator', 'hull-repair', 'helm-rite', 'launch'];
  const nestZone = e => e.x < 27 * TILE && e.y < 22 * TILE;
  let beaconChecked = false;

  const stages = [
    {
      name: 'talk-sefa', budget: 90,
      run(iR, iE) {
        if (!combat(g, bots[0], R, iR)) actAt(g, bots[0], R, sefa.x, sefa.y, iR);
        if (!combat(g, bots[1], E, iE)) follow(bots[1], E, R, iE);
      },
      done: () => sefaQuests.every(id => quest(id).state === 'active'),
    },
    {
      name: 'talk-warden', budget: 45,
      run(iR, iE) {
        if (!combat(g, bots[0], R, iR)) actAt(g, bots[0], R, warden.x, warden.y, iR);
        if (!combat(g, bots[1], E, iE)) follow(bots[1], E, R, iE);
      },
      done: () => quest('husk-nest').state === 'active',
    },
    {
      name: 'talk-hask', budget: 45,
      run(iR, iE) {
        if (!combat(g, bots[0], R, iR)) actAt(g, bots[0], R, hask.x, hask.y, iR);
        if (!combat(g, bots[1], E, iE)) follow(bots[1], E, R, iE);
      },
      done: () => quest('keepers-fragment').state === 'active',
    },
    {
      name: 'husk-nest', budget: 300,
      run(iR, iE) {
        const frag = qi('fragment');
        if (!combat(g, bots[0], R, iR, { engage: 7.5 })) {
          if (frag && frag.carrier == null) goTo(g, bots[0], R, frag.x, frag.y, iR);
          else goTo(g, bots[0], R, T(12), T(9), iR);
        }
        if (!combat(g, bots[1], E, iE, { engage: 7.5 })) {
          let t2 = null, bd = Infinity;
          for (const e of g.enemies) {
            if (e.dead || !nestZone(e)) continue;
            const d = Math.hypot(e.x - E.x, e.y - E.y);
            if (d < bd) { bd = d; t2 = e; }
          }
          if (t2) goTo(g, bots[1], E, t2.x, t2.y, iE);
          else follow(bots[1], E, R, iE);
        }
      },
      done: () => quest('husk-nest').progress >= 12 && (!qi('fragment') || qi('fragment').carrier != null),
    },
    {
      name: 'deliver-fragment', budget: 150,
      run(iR, iE) {
        const c = carrierOf('fragment') || R;
        const cb = bots[c.pid], ci = c.pid === 0 ? iR : iE;
        const ob = bots[1 - c.pid], o = g.players[1 - c.pid], oi = c.pid === 0 ? iE : iR;
        if (!combat(g, cb, c, ci)) actAt(g, cb, c, hask.x, hask.y, ci);
        if (!combat(g, ob, o, oi)) follow(ob, o, c, oi);
      },
      done: () => quest('keepers-fragment').state === 'done',
    },
    {
      name: 'depot-plating', budget: 300,
      run(iR, iE) {
        const plate = qi('plating');
        if (!combat(g, bots[0], R, iR, { engage: 7 })) {
          if (plate && plate.carrier == null) goTo(g, bots[0], R, plate.x, plate.y, iR);
          else follow(bots[0], R, E, iR);
        }
        if (!combat(g, bots[1], E, iE, { engage: 7 })) {
          const fl = g.pickups.find(w => w.kind === 'flamer');
          if (fl && !E.fieldWeapon) actAt(g, bots[1], E, fl.x, fl.y, iE);
          else follow(bots[1], E, R, iE);
        }
      },
      done() { const p2 = qi('plating'); return !!(p2 && p2.carrier != null && (E.fieldWeapon || this.t > 200)); },
    },
    {
      name: 'deliver-plating', budget: 200,
      run(iR, iE) {
        const c = carrierOf('plating') || R;
        const cb = bots[c.pid], ci = c.pid === 0 ? iR : iE;
        const o = g.players[1 - c.pid], ob = bots[1 - c.pid], oi = c.pid === 0 ? iE : iR;
        if (!combat(g, cb, c, ci)) actAt(g, cb, c, sefa.x, sefa.y, ci);
        // settle the husk-nest bounty at the warden on the same trip
        if (!combat(g, ob, o, oi)) {
          if (quest('husk-nest').state !== 'done') actAt(g, ob, o, warden.x, warden.y, oi);
          else follow(ob, o, c, oi);
        }
      },
      done: () => quest('hull-plating').state === 'done' && quest('husk-nest').state === 'done',
    },
    {
      name: 'skiff-coil', budget: 360,
      run(iR, iE) {
        const m = bots[0].mem;
        m.sail = m.sail ?? 'toSkiff';
        const coil = qi('coil');
        // escort holds the shore junction and thins the lurkers
        if (!combat(g, bots[1], E, iE, { engage: 7 })) goTo(g, bots[1], E, T(47), T(48), iE);
        if (m.sail === 'toSkiff') {
          if (R.riding) { m.sail = 'sail1'; return; }
          if (!combat(g, bots[0], R, iR)) actAt(g, bots[0], R, skiff.x, skiff.y, iR);
        } else if (m.sail === 'sail1') {
          if (!R.riding) { m.sail = 'islet'; return; }
          const gx = T(45), gy = T(52);
          if (near(R, gx, gy, 0.25)) { pressAct(bots[0], iR); return; } // step ashore
          bots[0].repath -= 1;
          if (bots[0].repath <= 0 || !bots[0].path.length) { bots[0].path = planPath(g, R, gx, gy, true); bots[0].repath = 15; }
          moveAlong(bots[0], R, iR);
        } else if (m.sail === 'islet') {
          if (coil && coil.carrier == null) {
            if (!combat(g, bots[0], R, iR, { engage: 6 })) goTo(g, bots[0], R, coil.x, coil.y, iR);
          } else {
            const hoard = g.chests.find(c => !c.opened && tx(c.x) >= 43 && tx(c.x) <= 48 && tx(c.y) >= 52);
            if (hoard) { if (!combat(g, bots[0], R, iR)) actAt(g, bots[0], R, hoard.x, hoard.y, iR); }
            else m.sail = 'remount';
          }
        } else if (m.sail === 'remount') {
          if (R.riding) { m.sail = 'sail2'; return; }
          if (!combat(g, bots[0], R, iR)) actAt(g, bots[0], R, skiff.x, skiff.y, iR, 1.4);
        } else if (m.sail === 'sail2') {
          if (!R.riding) { m.sail = 'ashore'; return; }
          const gx = T(38), gy = T(51);
          if (near(R, gx, gy, 0.25)) { pressAct(bots[0], iR); return; }
          bots[0].repath -= 1;
          if (bots[0].repath <= 0 || !bots[0].path.length) { bots[0].path = planPath(g, R, gx, gy, true); bots[0].repath = 15; }
          moveAlong(bots[0], R, iR);
        }
      },
      done: () => { const c = qi('coil'); return c && c.carrier != null && !R.riding && tx(R.x) < 41; },
    },
    {
      name: 'deliver-coil', budget: 200,
      run(iR, iE) {
        const c = carrierOf('coil') || R;
        const cb = bots[c.pid], ci = c.pid === 0 ? iR : iE;
        const o = g.players[1 - c.pid], ob = bots[1 - c.pid], oi = c.pid === 0 ? iE : iR;
        if (!combat(g, cb, c, ci)) actAt(g, cb, c, sefa.x, sefa.y, ci);
        if (!combat(g, ob, o, oi)) follow(ob, o, c, oi);
      },
      done: () => quest('wave-coil').state === 'done',
    },
    {
      name: 'vault-regulator', budget: 360,
      run(iR, iE) {
        const stones = glyphsOf(0);
        const yard = { x: T(63), y: T(48) };
        let foes = 0;
        for (const e of g.enemies) if (!e.dead && Math.hypot(e.x - yard.x, e.y - yard.y) < 8 * TILE) foes++;
        if (!combat(g, bots[1], E, iE, { engage: 8 })) goTo(g, bots[1], E, T(61), T(47), iE);
        if (combat(g, bots[0], R, iR, { engage: 8 })) return;
        if (foes > 0 && !door('vault-door').open) { goTo(g, bots[0], R, yard.x, yard.y, iR); return; }
        if (!door('vault-door').open) { runeStep(0, vaultOrder, bots[0], R, iR); return; }
        const reg = qi('regulator');
        if (reg && reg.carrier == null) { goTo(g, bots[0], R, reg.x, reg.y, iR); return; }
        const reli = g.chests.find(c => !c.opened && tx(c.x) >= 59 && tx(c.x) <= 67 && tx(c.y) >= 51);
        if (reli) actAt(g, bots[0], R, reli.x, reli.y, iR);
        else goTo(g, bots[0], R, T(63), T(48), iR);
      },
      done: () => { const r2 = qi('regulator'); return r2 && r2.carrier != null && tx(R.y) <= 51; },
    },
    {
      name: 'deliver-regulator', budget: 240,
      run(iR, iE) {
        const c = carrierOf('regulator') || R;
        const cb = bots[c.pid], ci = c.pid === 0 ? iR : iE;
        const o = g.players[1 - c.pid], ob = bots[1 - c.pid], oi = c.pid === 0 ? iE : iR;
        if (!combat(g, cb, c, ci)) actAt(g, cb, c, sefa.x, sefa.y, ci);
        if (!combat(g, ob, o, oi)) follow(ob, o, c, oi);
      },
      done: () => quest('burn-regulator').state === 'done',
    },
    {
      name: 'beacon-checkpoint', budget: 150,
      run(iR, iE) {
        const b = buildOf('beacon');
        for (const [bot, p, inp] of [[bots[0], R, iR], [bots[1], E, iE]]) {
          if (combat(g, bot, p, inp)) continue;
          if (!near(p, b.x, b.y, 1.2)) goTo(g, bot, p, b.x, b.y, inp);
          else inp.act = true; // hold to build
        }
      },
      done: () => buildOf('beacon').built,
    },
    {
      name: 'launch-pylon', budget: 240,
      run(iR, iE) {
        const b = buildOf('pylon');
        for (const [bot, p, inp] of [[bots[0], R, iR], [bots[1], E, iE]]) {
          if (combat(g, bot, p, inp, { engage: 7 })) continue;
          if (!near(p, b.x, b.y, 1.2)) goTo(g, bot, p, b.x, b.y, inp);
          else inp.act = true;
        }
      },
      done: () => buildOf('pylon').built && quest('hull-repair').progress >= 1,
    },
    {
      name: 'settle-repair', budget: 200,
      run(iR, iE) {
        if (!combat(g, bots[0], R, iR)) actAt(g, bots[0], R, sefa.x, sefa.y, iR);
        if (!combat(g, bots[1], E, iE, { engage: 7 })) goTo(g, bots[1], E, T(59), T(33), iE);
      },
      done: () => quest('hull-repair').state === 'done',
    },
    {
      name: 'airlock-teleport', budget: 200,
      run(iR, iE) {
        if (!insideHull(R)) {
          if (!combat(g, bots[0], R, iR)) channelAt(padOut, bots[0], R, iR);
        } else if (!combat(g, bots[0], R, iR)) goTo(g, bots[0], R, sw('airlock-bulkhead').x, sw('airlock-bulkhead').y, iR);
        if (!insideHull(E)) {
          if (insideHull(R)) { if (!combat(g, bots[1], E, iE)) channelAt(padOut, bots[1], E, iE); }
          else if (!combat(g, bots[1], E, iE)) goTo(g, bots[1], E, T(59), T(33), iE);
        } else if (!combat(g, bots[1], E, iE)) goTo(g, bots[1], E, T(66), T(35), iE);
      },
      done: () => insideHull(R) && insideHull(E),
    },
    {
      name: 'hold-bulkheads', budget: 240,
      run(iR, iE) {
        const s0 = sw('airlock-bulkhead'), s1 = sw('hold-bulkhead');
        if (!combat(g, bots[0], R, iR, { engage: 6 })) {
          if (!s0.on) actAt(g, bots[0], R, s0.x, s0.y, iR);
          else if (!door('door-hold').open) goTo(g, bots[0], R, T(67), T(33), iR); // NOT the pad tile

          else if (!s1.on) actAt(g, bots[0], R, s1.x, s1.y, iR);
          else goTo(g, bots[0], R, T(77), T(33), iR);
        }
        if (!combat(g, bots[1], E, iE, { engage: 6 })) {
          const mor = g.pickups.find(w => w.kind === 'mortarMk2');
          if (door('door-hold').open && mor && (!E.fieldWeapon || E.fieldWeapon.kind !== 'mortarMk2')) actAt(g, bots[1], E, mor.x, mor.y, iE);
          else follow(bots[1], E, R, iE);
        }
      },
      done: () => door('door-reactor').open,
    },
    {
      name: 'helm-rite', budget: 300,
      run(iR, iE) {
        if (!combat(g, bots[1], E, iE, { engage: 6 })) goTo(g, bots[1], E, T(84), T(34), iE);
        if (combat(g, bots[0], R, iR, { engage: 6 })) return;
        const m = bots[0].mem;
        const lit = glyphsOf(1).filter(s => s.lit).length;
        // mid-rite, with both flanking stones lit, the plaque becomes readable
        if (lit === 2 && !m.plaqueRead) {
          if (actAt(g, bots[0], R, plaque.x, plaque.y, iR)) { m.plaqueTried = true; m.plaqueRead = true; }
          return;
        }
        runeStep(1, helmOrder, bots[0], R, iR);
      },
      done: () => door('door-helm').open && quest('helm-rite').progress >= 1,
    },
    {
      name: 'reach-helm', budget: 120,
      run(iR, iE) {
        if (!combat(g, bots[0], R, iR)) goTo(g, bots[0], R, T(88), T(33), iR);
        if (!combat(g, bots[1], E, iE)) goTo(g, bots[1], E, T(85), T(33), iE);
      },
      done: () => quest('launch').progress >= 1,
    },
    { // observation window: does the sim clear the mission at the helm?
      name: 'launch-observe', budget: 8,
      run(iR, iE) { /* stand at the helm */ },
      done() { return this.t >= 6 || g.status !== 'play'; },
    },
    {
      name: 'exit-craft', budget: 240,
      run(iR, iE) {
        if (insideHull(R)) { if (!combat(g, bots[0], R, iR)) channelAt(padIn, bots[0], R, iR); }
        else if (!combat(g, bots[0], R, iR)) goTo(g, bots[0], R, T(55), T(34), iR);
        if (insideHull(E)) {
          if (!insideHull(R)) { if (!combat(g, bots[1], E, iE)) channelAt(padIn, bots[1], E, iE); }
          else if (!combat(g, bots[1], E, iE)) goTo(g, bots[1], E, T(84), T(33), iE);
        } else if (!combat(g, bots[1], E, iE)) follow(bots[1], E, R, iE);
      },
      done: () => !insideHull(R) && !insideHull(E),
    },
    {
      name: 'settle-launch', budget: 240,
      run(iR, iE) {
        if (!combat(g, bots[0], R, iR)) actAt(g, bots[0], R, sefa.x, sefa.y, iR);
        if (!combat(g, bots[1], E, iE)) follow(bots[1], E, R, iE);
      },
      done: () => quest('helm-rite').state === 'done' && quest('launch').state === 'done',
    },
    { // final observation: with every quest settled, does anything clear it?
      name: 'final-observe', budget: 12,
      run(iR, iE) { /* idle at the village */ },
      done() { return this.t >= 10 || g.status !== 'play'; },
    },
  ];

  let stageIdx = 0, stageT = 0;
  const downsByStage = {};
  let beaconData = null, beaconEquals = null, restoreTwinEqual = null;
  let snapAtSefaTalk = null, snapMid = null;
  const waveTimes = [];

  const frames = Math.ceil(CAP_S / DT);
  for (let f = 0; f < frames && g.status === 'play' && stageIdx < stages.length; f++) {
    const st = stages[stageIdx];
    st.t = stageT;
    const iR = {}, iE = {};
    // downed/pick handling first
    for (const [bot, p, inp] of [[bots[0], R, iR], [bots[1], E, iE]]) {
      bot.relAct--; bot.relFire--; bot.relItem--; bot.relSpec--;
      if (p.state === 'pick') {
        if (bot.relFire <= 0) { inp.fire = true; bot.relFire = 8; }
      }
    }
    if (R.state === 'active' || E.state === 'active') st.run(iR, iE);
    step(g, { 0: R.state === 'active' || R.state === 'pick' ? iR : {}, 1: E.state === 'active' || E.state === 'pick' ? iE : {} }, DT);
    stageT += DT;

    if (process.env.CH7_DEBUG && f % 90 === 0 && g.elapsed >= +process.env.CH7_DEBUG && g.elapsed < +process.env.CH7_DEBUG + (+process.env.CH7_DEBUG_SPAN || 120)) {
      const wp0 = bots[0].path[0], wp1 = bots[1].path[0];
      console.log(`t=${g.elapsed.toFixed(0)} st=${st.name}/${bots[0].mem.sail ?? ''} R=${R.x.toFixed(0)},${R.y.toFixed(0)}(${R.state},hp${R.hp})[${bots[0].dbg ?? 'free'}|path${bots[0].path.length}|wp=${wp0 ? wp0.x + ',' + wp0.y : '-'}|in=${JSON.stringify(iR)}] E=${E.x.toFixed(0)},${E.y.toFixed(0)}[${bots[1].dbg ?? 'free'}|path${bots[1].path.length}|wp=${wp1 ? wp1.x + ',' + wp1.y : '-'}|in=${JSON.stringify(iE)}]`);
    }
    // harvest events
    if (g.events.length) {
      for (const ev of g.events) {
        log.push({ ...ev, t: g.elapsed, stage: st.name });
        if (ev.type === 'down') downsByStage[st.name] = (downsByStage[st.name] || 0) + 1;
        if (ev.type === 'wave') waveTimes.push(Math.round(g.elapsed));
        if (!['shoot', 'hitWall', 'hit', 'walk'].includes(ev.type)) {
          hash = fnv(hash, `${ev.type}:${ev.pid ?? ''}:${ev.id ?? ''}:${Math.round(ev.x ?? 0)},${Math.round(ev.y ?? 0)};`);
        }
      }
      g.events.length = 0;
    }
    if (f % 150 === 0) for (const p of g.players) hash = fnv(hash, `${p.pid}@${Math.round(p.x)},${Math.round(p.y)}hp${p.hp};`);

    // beacon checkpoint: serialize/restore fidelity probe, once
    if (!beaconChecked && buildOf('beacon').built) {
      beaconChecked = true;
      beaconData = serializeGame(g);
      const live = JSON.stringify(snapshot(g, false)); // events already drained
      const rA = restoreGame(beaconData, charMap);
      beaconEquals = JSON.stringify(snapshot(rA, false)) === live;
      const r1 = restoreGame(beaconData, charMap);
      const r2 = restoreGame(beaconData, charMap);
      for (let i = 0; i < 90; i++) { step(r1, {}, DT); step(r2, {}, DT); }
      restoreTwinEqual = JSON.stringify(snapshot(r1, false)) === JSON.stringify(snapshot(r2, false));
    }
    // objective-panel probes
    if (!snapAtSefaTalk && stages[stageIdx].name === 'talk-warden') snapAtSefaTalk = snapshot(g, false);
    if (!snapMid && quest('hull-plating').state === 'done') snapMid = snapshot(g, false);

    if (st.done()) {
      marks[st.name] = g.elapsed;
      if (!quiet) note(`stage ${st.name.padEnd(18)} done at t=${g.elapsed.toFixed(1)}s  (shards=${g.shards}, R=${tx(R.x)},${tx(R.y)} E=${tx(E.x)},${tx(E.y)})`);
      stageIdx++;
      stageT = 0;
      bots[0].path = []; bots[1].path = [];
    } else if (stageT > st.budget) {
      oops(`stage '${st.name}' blew its ${st.budget}s budget at t=${g.elapsed.toFixed(0)}s ` +
        `(R at ${tx(R.x)},${tx(R.y)}; E at ${tx(E.x)},${tx(E.y)}; quests ${g.quests.map(q => q.id + ':' + q.state[0] + q.progress).join(' ')})`);
      marks[st.name] = -1;
      stageIdx++;
      stageT = 0;
      bots[0].path = []; bots[1].path = [];
    }
  }

  return {
    g, R, E, log, hash, marks, runIssues, downsByStage, waveTimes,
    beaconEquals, restoreTwinEqual, snapAtSefaTalk, snapMid,
    plaqueTried: bots[0].mem.plaqueTried,
  };
}

// ================================ run + report =================================
console.log('--- Chapter VII playtest: full quest chain, 2 operatives, no invuln cheats ---');
const t0 = Date.now();
const A = runMission();
console.log(`(run 1: ${((Date.now() - t0) / 1000).toFixed(1)}s wall, ${A.g.elapsed.toFixed(0)}s sim)`);

const q = id => A.g.quests.find(x => x.id === id);
const ev = type => A.log.filter(e => e.type === type);

// 1. the full chain happened
check('all 8 quests reach done', A.g.quests.every(x => x.state === 'done'),
  A.g.quests.map(x => `${x.id}:${x.state}`).join(' '));
check('all stages completed inside their budgets', Object.values(A.marks).every(v => v >= 0),
  Object.entries(A.marks).map(([k, v]) => `${k}@${v < 0 ? 'TIMEOUT' : v.toFixed(0) + 's'}`).join(' '));

// 2. puzzle systems fired in order
check('vault rune lock opened by hint-derived order (no glyphReset in group 0)',
  ev('glyphDone').some(e => e.group === 0) && !A.log.some(e => e.type === 'glyphReset' && e.group === 0));
check('helm rite settled by hint-derived order (no glyphReset in group 1)',
  ev('glyphDone').some(e => e.group === 1) && !A.log.some(e => e.type === 'glyphReset' && e.group === 1));
check('all four doors opened (vault, hold, reactor, helm)',
  A.g.doors.every(d => d.open), A.g.doors.map(d => `${d.id}:${d.open}`).join(' '));
check('both bulkhead relays threw quorums', ev('quorum').length === 2);
check('airlock teleports carried both operatives in and out',
  ev('teleport').filter(e => e.pid === 0).length >= 2 && ev('teleport').filter(e => e.pid === 1).length >= 2,
  `${ev('teleport').length} blinks total`);
check('skiff islet run (mount, coil, hoard chest, return)',
  ev('mount').length >= 2 && ev('dismount').length >= 2 && A.marks['skiff-coil'] >= 0);
check('plaque readable mid-rite (at inclusion: both flanking stones lit first)',
  A.log.some(e => e.type === 'talk' && e.npcId === 'pilots-plaque'),
  'glyph stones outrank npc talk in the act chain, so the plaque only answers once Wave+Vertex are lit');

// 3. beacon save
check('beacon build emits the beacon event', ev('beacon').length === 1,
  ev('beacon').map(e => `at ${Math.round(e.x / TILE)},${Math.round(e.y / TILE)} t=${e.t.toFixed(0)}s`).join());
check('serializeGame snapshot round-trips byte-identical', A.beaconEquals === true);
check('two restores from one beacon step identically for 90 frames', A.restoreTwinEqual === true);

// 4. untimed story contract
const sEnd = snapshot(A.g, false);
check('untimed story: clock counts up, timeLeft frozen, no lowTime/time-fail',
  sEnd.untimed === true && sEnd.elapsed > 0 && A.g.timeLeft === def.time
  && !A.log.some(e => e.type === 'lowTime'),
  `elapsed=${sEnd.elapsed?.toFixed(0)}s, timeLeft=${A.g.timeLeft}`);

// 5. objectives HUD data
const sq = A.snapAtSefaTalk?.quests ?? [];
check('snapshot.quests live for the objectives panel (sefa 6 active, others hidden at first talk)',
  sq.filter(x => x.state === 'active').length === 6 && sq.filter(x => x.state === 'hidden').length === 2
  && sq.every(x => x.title && x.kind),
  sq.map(x => `${x.id}:${x.state}`).join(' '));
check('main-quest flags ride the snapshot (6 main, 2 secondary)',
  sq.filter(x => x.main).length === 6);
check('quest lifecycle toasts fired (8 active + 8 done quest events)',
  ev('quest').filter(e => e.state === 'active').length === 8 && ev('quest').filter(e => e.state === 'done').length === 8);
const progEvs = ev('questProgress');
check('questProgress events stream for kill/build/glyph/reach quests', progEvs.length >= 15,
  `${progEvs.length} progress events`);

// 6. survivability at intended hp (no cheats anywhere)
const downs = ev('down');
const nestHits = A.log.filter(e => e.type === 'playerHit' && e.stage === 'husk-nest');
check('husk swarm survivable: nobody eliminated, mission never failed',
  ev('eliminated').length === 0 && A.g.status !== 'failed',
  `${downs.length} downs total (${Object.entries(A.downsByStage).map(([k, v]) => k + ':' + v).join(' ') || 'none'}), ${nestHits.length} hits taken in the nest`);
check('waves fired on the untimed elapsed clock', A.waveTimes.length >= 3,
  `waves at t=${A.waveTimes.join('/')}s (def: 180/360/600/840)`);

// 7. THE HEADLINE: does reaching the helm clear the chapter?
const launchAt = progEvs.find(e => e.id === 'launch');
check('launch quest tripped at the helm console', !!launchAt,
  launchAt ? `t=${launchAt.t.toFixed(1)}s at tile 88,33` : 'never tripped');
const clearedAtHelm = A.log.some(e => e.type === 'clear');
check('CHAPTER CLEARS: sim reaches status=cleared after the launch chain',
  A.g.status === 'cleared',
  `status='${A.g.status}' after all 8 quests done + 10s observation — ` +
  (A.g.status === 'cleared' ? `clear event ${clearedAtHelm}` :
    'no clear path exists: level17 has no E exit tiles and no gate, and the sim only clears non-mode maps when every enemy is dead or all players extract'));

// 8. determinism: full mission rerun must replay byte-identically
const t1 = Date.now();
const B = runMission(true);
console.log(`(run 2: ${((Date.now() - t1) / 1000).toFixed(1)}s wall)`);
check('full-mission determinism: event-stream hash + timings identical across reruns',
  A.hash === B.hash && Math.abs(A.g.elapsed - B.g.elapsed) < 1e-9 && A.log.length === B.log.length,
  `hashes ${A.hash.toString(16)} / ${B.hash.toString(16)}, ${A.log.length} vs ${B.log.length} events`);

for (const msg of A.runIssues) issues.push(msg);

// --- timings table -------------------------------------------------------------
console.log('\n--- stage timings (sim seconds) ---');
for (const [k, v] of Object.entries(A.marks)) console.log(`  ${k.padEnd(20)} ${v < 0 ? 'TIMEOUT' : v.toFixed(1)}`);
console.log(`  final status='${A.g.status}' score=${Math.round(A.g.score)} kills=${A.g.kills} shards=${A.g.shards} elapsed=${A.g.elapsed.toFixed(0)}s`);
for (const p of A.g.players) console.log(`  ${p.name}: state=${p.state} hp=${p.hp} lvl=${p.level} item=${p.item ? p.item.kind : '-'} field=${p.fieldWeapon ? p.fieldWeapon.kind + ':' + p.fieldWeapon.ammo : '-'}`);

const failed = checks.filter(c => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (issues.length) { console.log('issues:'); for (const i of issues) console.log('  - ' + i); }
process.exitCode = failed.length ? 1 : 0;
