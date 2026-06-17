// One-off validation harness for the 36-map overhaul. Mirrors the integrity
// checks in test/sim.test.js (testStoryLevelIntegrity + testLevelsParse) but
// COLLECTS every failure across all levels instead of throwing on the first.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { charsById, createGame, parseLevel, step, TILE } from '../shared/game.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const characters = JSON.parse(fs.readFileSync(path.join(root, 'shared/characters.json'), 'utf8'));
const charMap = charsById(characters);
const startingRoster = characters.filter(c => c.starting).map(c => c.id);
const validChars = new Set(characters.map(c => c.id));

const QUEST_KINDS = new Set(['fetch', 'kill', 'build', 'switch', 'glyph', 'destroy', 'craft', 'reach']);
const ART_KEYS = new Set(['anchorcraft', 'crossing', 'basin', 'quorum', 'forkfall', 'siege', 'settlement', 'campfire', 'entropy', 'dawn']);
const WAVE_LETTERS = new Set('garsmnwbzfqvxu' + 'dehijkly$');

const levelsDir = path.join(root, 'levels');
const cats = fs.readdirSync(levelsDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
const levels = [];
for (const cat of cats) {
  for (const f of fs.readdirSync(path.join(levelsDir, cat)).filter(f => f.endsWith('.json')).sort()) {
    const def = Object.assign(JSON.parse(fs.readFileSync(path.join(levelsDir, cat, f), 'utf8')), { category: cat });
    levels.push({ rel: `levels/${cat}/${f}`, def, cat });
  }
}

const PASS = c => c !== '#' && c !== 'T' && c !== '~' && c !== 'o' && c !== '%';
let problems = 0;
const all = [];
for (const { rel, def, cat } of levels) {
  const errs = [];
  const ok = (cond, msg) => { if (!cond) errs.push(msg); };
  try {
    const w = def.tiles[0].length, h = def.tiles.length;
    ok(def.tiles.every(r => r.length === w), `non-rectangular grid`);
    const isBorder = c => c === '#' || c === 'T' || c === '%';
    let border = [...def.tiles[0]].every(isBorder) && [...def.tiles[h - 1]].every(isBorder);
    for (let y = 0; y < h; y++) border = border && isBorder(def.tiles[y][0]) && isBorder(def.tiles[y][w - 1]);
    ok(border, `incomplete border`);
    ok(def.tiles.some(r => r.includes('P')), `no player spawn (P)`);

    const parsed = parseLevel(def);
    const pvp = def.mode === 'ctf' || def.mode === 'br' || def.mode === 'siege';

    // core / flags / mode
    const coreless = def.escort || (def.bastion && def.bastion.survival);
    if (def.mode === 'bastion') {
      if (def.bastionVariant === 'beacons') ok(parsed.cores.length === 4, `beacon variant needs 4 K, has ${parsed.cores.length}`);
      else ok(!!parsed.core || coreless, `bastion map has no core (K)`);
    }
    if (def.mode === 'ctf') ok(parsed.flags.length === 2, `ctf needs 2 flag stands, has ${parsed.flags.length}`);

    // sidecar parity
    const tc = ch => def.tiles.reduce((n, r) => n + (r.split(ch).length - 1), 0);
    ok((def.captiveChars || []).length === tc('c'), `captiveChars ${(def.captiveChars || []).length} != 'c' tiles ${tc('c')}`);
    ok((def.npcs || []).length === tc('N'), `npcs ${(def.npcs || []).length} != 'N' tiles ${tc('N')}`);
    ok((def.builds || []).length === tc('B'), `builds ${(def.builds || []).length} != 'B' tiles ${tc('B')}`);
    if (def.pickups) ok(def.pickups.length === tc('A'), `pickups ${def.pickups.length} != 'A' tiles ${tc('A')}`);
    if (def.qitems) ok(def.qitems.length === tc('I'), `qitems ${def.qitems.length} != 'I' tiles ${tc('I')}`);
    if (def.switches) ok(def.switches.length === tc('Q'), `switches ${def.switches.length} != 'Q' tiles ${tc('Q')}`);
    if (def.glyphs) ok(def.glyphs.length === tc('J'), `glyphs ${def.glyphs.length} != 'J' tiles ${tc('J')}`);
    if (def.teleports) ok(def.teleports.length === tc('O'), `teleports ${def.teleports.length} != 'O' tiles ${tc('O')}`);
    if (def.chests) ok(def.chests.length === tc('C'), `chests ${def.chests.length} != 'C' tiles ${tc('C')}`);
    if (def.vehicles) ok(def.vehicles.length === tc('V'), `vehicles ${def.vehicles.length} != 'V' tiles ${tc('V')}`);
    if (def.hires) ok(def.hires.length === tc('H'), `hires ${def.hires.length} != 'H' tiles ${tc('H')}`);

    // captive ids valid
    for (const id of def.captiveChars || []) ok(validChars.has(id), `captive '${id}' not a real character`);

    // switch quorum satisfiable
    for (const sg of def.switchGroups || []) {
      const members = parsed.switches.filter(s => s.group === (sg.group ?? 0)).length;
      ok((sg.need || 1) <= members, `switch group '${sg.group}' need ${sg.need} > ${members} relays`);
    }
    // glyph orders satisfiable
    for (const gg of def.glyphGroups || []) {
      const members = parsed.glyphs.filter(s => s.group === (gg.group ?? 0));
      ok((gg.order || []).length >= 1, `glyph group '${gg.group}' orders zero runes`);
      for (const sym of gg.order || []) {
        ok(Number.isInteger(sym) && sym >= 0 && sym <= 7, `glyph symbol ${sym} not a rune 0-7`);
        ok(members.some(m => m.symbol === sym), `glyph group '${gg.group}' missing stone for rune ${sym}`);
      }
    }
    // teleport twins
    for (const t of parsed.teleports) if (t.twin != null) ok(parsed.teleports.some(o => o.id === t.twin), `teleport '${t.id}' twin '${t.twin}' missing`);
    // openDoor rewards reference real doors
    const doorIds = new Set((def.doors || []).map((d, i) => d.id || 'door' + i));
    const wantsDoor = (id, src) => ok(doorIds.has(id), `${src} openDoor '${id}' not a real door`);
    for (const q2 of def.quests || []) if (q2.reward && q2.reward.openDoor) wantsDoor(q2.reward.openDoor, `quest '${q2.id}'`);
    for (const sg of def.switchGroups || []) if (sg.reward && sg.reward.openDoor) wantsDoor(sg.reward.openDoor, `switch group '${sg.group}'`);
    for (const gg of def.glyphGroups || []) if (gg.reward && gg.reward.openDoor) wantsDoor(gg.reward.openDoor, `glyph group '${gg.group}'`);
    // quests
    for (const q of def.quests || []) {
      ok(q.id && typeof q.title === 'string' && q.title.length > 0, `quest missing id/title`);
      ok(QUEST_KINDS.has(q.kind), `quest '${q.id}' kind '${q.kind}' unknown`);
      ok((def.npcs || []).some(n => n.id === q.giver), `quest '${q.id}' giver '${q.giver}' not an npc`);
      if (q.kind === 'fetch') {
        ok(q.item, `fetch quest '${q.id}' names no item`);
        ok((def.qitems || []).some(it => (it.kind || 'fragment') === q.item), `fetch quest '${q.id}' item '${q.item}' not among qitems`);
      }
    }
    // gate need <= pylons
    if (def.gate) {
      const pylons = (def.builds || []).filter(b => b.kind === 'pylon').length;
      ok(def.gate.need <= pylons, `gate.need ${def.gate.need} > ${pylons} pylons`);
    }
    // waves
    for (const wv of (def.modifiers && def.modifiers.waves) || []) {
      ok(wv.letters.length >= 1 && [...wv.letters].every(c => WAVE_LETTERS.has(c)), `wave letters '${wv.letters}' contain a non-enemy char`);
      ok(['n', 's', 'e', 'w'].includes(wv.edge), `wave edge '${wv.edge}' not n/s/e/w`);
    }
    // cutscene slides
    for (const slide of [...(def.intro || []), ...(def.outro || [])]) {
      ok(typeof slide.title === 'string' && slide.title.length > 0, `slide missing title`);
      ok(Array.isArray(slide.lines) && slide.lines.length >= 1 && slide.lines.length <= 3, `slide lines not 1-3`);
      ok(ART_KEYS.has(slide.art), `slide art '${slide.art}' unknown`);
    }

    // doors cover walkable floor
    for (const [i, d] of (def.doors || []).entries()) {
      const dw = d.w || 1, dh = d.h || 1, id = d.id || 'door' + i;
      ok(d.x >= 0 && d.y >= 0 && d.x + dw <= parsed.w && d.y + dh <= parsed.h, `door '${id}' out of bounds`);
      for (let yy = d.y; yy < d.y + dh; yy++) for (let xx = d.x; xx < d.x + dw; xx++)
        if (parsed.grid[yy] && parsed.grid[yy][xx] !== undefined) ok(PASS(parsed.grid[yy][xx]), `door '${id}' covers '${parsed.grid[yy][xx]}' at (${xx},${yy})`);
    }

    // createGame + step 60 frames
    const party = pvp ? Array.from({ length: 8 }, (_, i) => ({ pid: i, name: 'P' + i, charId: startingRoster[0], team: i % 2 }))
      : [{ pid: 0, name: 'A', charId: startingRoster[0] }];
    const g = createGame(def, party, charMap, startingRoster);
    if (g.players[0]) g.players[0].invuln = 999;
    g.graceT = 1e9;
    for (let i = 0; i < 60 && g.status === 'play'; i++) step(g, { 0: {} }, 1 / 30);

    // BFS reach (flood through closed doors + teleport twins)
    const seen = new Set();
    const sx = Math.floor(parsed.spawns[0].x / TILE), sy = Math.floor(parsed.spawns[0].y / TILE);
    const stack = [[sx, sy]]; seen.add(sx + ',' + sy);
    const doorRects = (def.doors || []).map(d => ({ x: d.x, y: d.y, w: d.w || 1, h: d.h || 1 }));
    const inDoor = (x, y) => doorRects.some(d => x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h);
    const flood = () => {
      while (stack.length) {
        const [x, y] = stack.pop();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
          if (nx < 0 || ny < 0 || nx >= parsed.w || ny >= parsed.h || seen.has(k)) continue;
          if (!PASS(parsed.grid[ny][nx]) && !inDoor(nx, ny)) continue;
          seen.add(k); stack.push([nx, ny]);
        }
      }
    };
    flood();
    for (let p = 0; p <= parsed.teleports.length; p++) {
      let changed = false;
      for (const t of parsed.teleports) {
        if (!seen.has(Math.floor(t.x / TILE) + ',' + Math.floor(t.y / TILE))) continue;
        const twin = parsed.teleports.find(o => o.id === t.twin); if (!twin) continue;
        const wx = Math.floor(twin.x / TILE), wy = Math.floor(twin.y / TILE);
        if (seen.has(wx + ',' + wy)) continue;
        changed = true; seen.add(wx + ',' + wy); stack.push([wx, wy]); flood();
      }
      if (!changed) break;
    }
    const reach = (px, py, what) => ok(seen.has(Math.floor(px / TILE) + ',' + Math.floor(py / TILE)), `UNREACHABLE ${what}`);
    if (parsed.core) reach(parsed.core.x, parsed.core.y, 'core');
    for (const c of parsed.cores || []) reach(c.x, c.y, 'beacon');
    for (const c of parsed.captives || []) reach(c.x, c.y, `captive ${c.charId}`);
    for (const n of parsed.npcs || []) reach(n.x, n.y, `npc ${n.id}`);
    for (const b of parsed.builds || []) reach(b.x, b.y, `${b.kind} site`);
    for (const s of parsed.switches || []) reach(s.x, s.y, `relay ${s.id}`);
    for (const gl of parsed.glyphs || []) reach(gl.x, gl.y, `glyph ${gl.id}`);
    for (const pl of parsed.pillars || []) reach(pl.x, pl.y, `pillar ${pl.id}`);
    for (const fo of parsed.forges || []) reach(fo.x, fo.y, 'forge');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (def.tiles[y][x] === 'E') ok(seen.has(x + ',' + y), `UNREACHABLE exit at (${x},${y})`);
    if (def.capture) reach((def.capture.x + 0.5) * TILE, (def.capture.y + 0.5) * TILE, 'capture zone');
    if (def.escort && def.escort.path) for (const [wx, wy] of def.escort.path) reach((wx + 0.5) * TILE, (wy + 0.5) * TILE, 'escort waypoint');
  } catch (e) {
    errs.push(`THREW: ${e.message}`);
  }
  if (errs.length) { problems += errs.length; all.push({ rel, errs }); }
}

for (const { rel, errs } of all) for (const e of errs) console.log(`  [FAIL] ${rel}: ${e}`);
// ===== stronghold-specific def integrity (mirrors testStrongholdDefIntegrity) =====
const BUILD_KINDS = new Set(['pylon', 'barricade', 'turret', 'farm', 'beacon', 'wall', 'comm']);
const LEGAL_TILES = new Set('#.To~,:;_*=!^%E' + '+-@/' + 'PcNBCKVWSHDYAIQJXZO' + 'garsmnwbzfqvxu' + 'dehijkly$');
for (const { rel, def, cat } of levels) {
  if (cat !== 'stronghold') continue;
  const errs = [];
  const ok = (c, m) => { if (!c) errs.push(m); };
  const sh = def.stronghold || {};
  const b = def.bastion || {};
  ok(def.mode === 'bastion', `mode is '${def.mode}' not bastion`);
  ok(sh && typeof sh === 'object', `def.stronghold missing`);
  ok(Number.isInteger(sh.level) && sh.level >= 1 && sh.level <= 25, `stronghold.level ${sh.level} not 1..25`);
  ok(['S', 'M', 'L', 'XL'].includes(sh.sizeLabel), `sizeLabel '${sh.sizeLabel}' not S/M/L/XL`);
  ok(Number.isInteger(sh.difficulty) && sh.difficulty >= 1 && sh.difficulty <= 5, `difficulty ${sh.difficulty} not 1..5`);
  const nights = b.nights ?? 5;
  const wpn = Math.max(1, Math.min(3, b.wavesPerNight || 1));
  const moons = (b.bloodMoons || []).length;
  if (b.endless) ok(Number.isInteger(sh.waves) && sh.waves > 0, `endless waves not a positive sentinel`);
  else ok(sh.waves === nights * wpn + moons * wpn, `waves ${sh.waves} != ${nights}n x${wpn} + ${moons}moons x${wpn} = ${nights * wpn + moons * wpn}`);
  if (b.waveMult !== undefined) ok(b.waveMult >= 1 && b.waveMult <= 2.6, `waveMult ${b.waveMult} not 1..2.6`);
  if (b.bossNights !== undefined) { ok(Array.isArray(b.bossNights) && b.bossNights.length >= 1, `bossNights empty`); for (const bn of b.bossNights) ok(Number.isInteger(bn) && bn >= 1 && bn <= nights, `boss night ${bn} not 1..${nights}`); }
  if (sh.hpMult !== undefined) ok(sh.hpMult >= 1 && sh.hpMult <= 2, `hpMult ${sh.hpMult} not 1..2`);
  if (sh.unlock !== undefined) ok(validChars.has(sh.unlock), `unlock '${sh.unlock}' not a real character`);
  ok(typeof sh.blurb === 'string' && sh.blurb.length > 0, `blurb missing`);
  ok(Array.isArray(sh.newFeatures) && sh.newFeatures.every(s => typeof s === 'string'), `newFeatures not all strings`);
  ok(Array.isArray(def.intro) && def.intro.length >= 1, `no intro slide`);
  for (const row of def.tiles) for (const c of row) if (!LEGAL_TILES.has(c)) { ok(false, `illegal tile '${c}'`); break; }
  const ks = def.tiles.reduce((n, r) => n + (r.split('K').length - 1), 0);
  const shColess = def.escort || (b && b.survival);
  if (def.bastionVariant === 'beacons') ok(ks === 4, `beacon variant has ${ks} K (need 4)`);
  else if (shColess) ok(ks === 0, `coreless escort/survival map has ${ks} K (need 0)`);
  else ok(ks === 1, `core bastion has ${ks} K (need exactly 1)`);
  for (const bd of def.builds || []) { ok(BUILD_KINDS.has(bd.kind), `build kind '${bd.kind}' unknown`); ok(typeof bd.cost === 'number' && bd.cost >= 0, `build cost bad`); if (bd.prebuilt !== undefined) ok(typeof bd.prebuilt === 'boolean', `prebuilt not boolean`); }
  if (def.weather) ok(['clear', 'rain', 'snow', 'ashstorm', 'fog'].includes(def.weather), `weather '${def.weather}' unknown`);
  if (def.ambience) ok(['meadow', 'forest', 'swamp', 'ash', 'city', 'night', 'lava', 'ship'].includes(def.ambience), `ambience '${def.ambience}' unknown`);
  for (const pd of def.patrols || []) { ok(Array.isArray(pd.at) && pd.at.length === 2, `patrol missing home tile`); ok(Array.isArray(pd.points) && pd.points.length >= 2 && pd.points.length <= 4, `patrol not 2-4 points`); }
  const stalls = [], works = [];
  def.tiles.forEach((row, y) => { for (let x = 0; x < row.length; x++) { if (row[x] === 'S') stalls.push([x, y]); else if (row[x] === 'B' || row[x] === 'W') works.push([x, y]); } });
  for (const [sx, sy] of stalls) for (const [wx, wy] of works) { const dd = Math.hypot(wx - sx, wy - sy); ok(dd >= 2.5, `stall (${sx},${sy}) only ${dd.toFixed(2)} tiles from build (${wx},${wy})`); }
  if (errs.length) { problems += errs.length; all.push({ rel: rel + ' [SH]', errs }); }
}

for (const { rel, errs } of all.filter(a => a.rel.endsWith('[SH]'))) for (const e of errs) console.log(`  [SH-FAIL] ${rel}: ${e}`);
console.log(`\n${problems === 0 ? 'ALL CLEAN' : problems + ' PROBLEM(S) in ' + all.length + ' entr(ies)'} across ${levels.length} levels.`);
process.exit(problems === 0 ? 0 : 1);
