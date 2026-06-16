// shared/mapValidate.ts — REUSABLE, TYPED level validator.
//
// One canonical validateLevelDef() shared by the Map Generator (#6), the
// Community DB server (#7) and the Map Builder (#5). It is the EXACTLY-same
// integrity battery the one-off scripts/validate-maps.mjs runs (which in turn
// mirrors test/sim.test.ts's testLevelsParse + testStoryLevelIntegrity +
// testStrongholdDefIntegrity), but factored into a PURE function that:
//
//   - takes (def, ctx) where ctx supplies the character roster + id map, so it
//     reads NO fs, NO file paths and touches NO `process` — Node + browser safe.
//   - COLLECTS every problem into an array and NEVER throws (a createGame/step
//     blow-up is caught and recorded as a `THREW:` problem, not propagated).
//   - returns { ok: problems.length === 0, problems }.
//
// The runtime sim (parseLevel/createGame/step/TILE) is a normal value import
// from the emitted ../shared/game.js; every TYPE is `import type` so esbuild's
// type-strip can elide the .d.ts references (it cannot elide a value import of
// a declaration file).

import type { LevelDef } from '../types/level';
import type { CharacterMap, CharacterDef } from '../types/character';
// eslint-disable-next-line  — runtime value import of the emitted sim
import { parseLevel, createGame, step, TILE } from '../shared/game.js';

// ---------------------------------------------------------------------------
// Static vocabularies (kept byte-identical to validate-maps.mjs / sim.test.ts)
// ---------------------------------------------------------------------------
const QUEST_KINDS = new Set(['fetch', 'kill', 'build', 'switch', 'glyph', 'destroy', 'craft', 'reach']);
const ART_KEYS = new Set(['anchorcraft', 'crossing', 'basin', 'quorum', 'forkfall', 'siege', 'settlement', 'campfire', 'entropy', 'dawn']);
const WAVE_LETTERS = new Set('garsmnwbzfqvxu' + 'dehijkly$');
const BUILD_KINDS = new Set(['pylon', 'barricade', 'turret', 'farm', 'beacon', 'wall', 'comm']);
const HIRE_JOBS = new Set(['farmer', 'engineer', 'smith']);
const AMBIENCE = new Set(['meadow', 'forest', 'swamp', 'ash', 'city', 'night', 'lava', 'ship']);
const WEATHERS = new Set(['clear', 'rain', 'snow', 'ashstorm', 'fog']);
const LEGAL_TILES = new Set(
  '#.To~,:;_*=!^%E' + '+-@/' + 'PcNBCKVWSHDYAIQJXZO' + 'garsmnwbzfqvxu' + 'dehijkly$',
);

/** A tile a player can stand on (the BFS floods these). Mirrors validate-maps. */
const PASS = (c: string): boolean => c !== '#' && c !== 'T' && c !== '~' && c !== 'o' && c !== '%';

export interface ValidateCtx {
  charMap: CharacterMap;
  characters: CharacterDef[];
}

export interface ValidateResult {
  ok: boolean;
  problems: string[];
}

/**
 * Validate one authored level definition. Pure: no fs / no process / no globals
 * beyond the runtime sim. Collects every problem; never throws.
 */
export function validateLevelDef(def: LevelDef, ctx: ValidateCtx): ValidateResult {
  const problems: string[] = [];
  const ok = (cond: unknown, msg: string): void => { if (!cond) problems.push(msg); };

  const characters = ctx.characters || [];
  const charMap = ctx.charMap || {};
  const startingRoster = characters.filter((c) => (c as any).starting).map((c) => c.id);
  const validChars = new Set(characters.map((c) => c.id));
  // a usable party charId even if the roster JSON has no `starting` flag
  const anyChar = startingRoster[0] || (characters[0] && characters[0].id);

  const d = def as any;

  try {
    if (!Array.isArray(d.tiles) || d.tiles.length === 0 || typeof d.tiles[0] !== 'string') {
      problems.push('def.tiles missing or not a string[] grid');
      return { ok: false, problems };
    }

    const w = d.tiles[0].length, h = d.tiles.length;

    // --- rectangular grid + solid border ---
    ok(d.tiles.every((r: string) => r.length === w), 'non-rectangular grid');
    const isBorder = (c: string): boolean => c === '#' || c === 'T' || c === '%';
    let border = [...d.tiles[0]].every(isBorder) && [...d.tiles[h - 1]].every(isBorder);
    for (let y = 0; y < h; y++) border = border && isBorder(d.tiles[y][0]) && isBorder(d.tiles[y][w - 1]);
    ok(border, 'incomplete border');
    ok(d.tiles.some((r: string) => r.includes('P')), 'no player spawn (P)');

    const parsed: any = parseLevel(def);
    const pvp = d.mode === 'ctf' || d.mode === 'br' || d.mode === 'siege';

    // --- 'K' core count per mode / objective ---
    const coreless = d.escort || (d.bastion && d.bastion.survival);
    const kCount = d.tiles.reduce((n: number, r: string) => n + (r.split('K').length - 1), 0);
    if (d.mode === 'bastion') {
      if (d.bastionVariant === 'beacons') {
        ok(parsed.cores.length === 4, `beacon variant needs 4 K, has ${parsed.cores.length}`);
        ok(kCount === 4, `beacon variant has ${kCount} K tiles (need 4)`);
      } else if (coreless) {
        ok(kCount === 0, `coreless escort/survival map has ${kCount} K (need 0)`);
      } else {
        ok(!!parsed.core, 'bastion map has no core (K)');
        ok(kCount === 1, `core bastion has ${kCount} K (need exactly 1)`);
      }
    }
    if (d.mode === 'ctf') ok(parsed.flags.length === 2, `ctf needs 2 flag stands, has ${parsed.flags.length}`);

    // --- sidecar parity (def arrays vs their tile counts) ---
    const tc = (ch: string): number => d.tiles.reduce((n: number, r: string) => n + (r.split(ch).length - 1), 0);
    ok((d.captiveChars || []).length === tc('c'), `captiveChars ${(d.captiveChars || []).length} != 'c' tiles ${tc('c')}`);
    ok((d.npcs || []).length === tc('N'), `npcs ${(d.npcs || []).length} != 'N' tiles ${tc('N')}`);
    ok((d.builds || []).length === tc('B'), `builds ${(d.builds || []).length} != 'B' tiles ${tc('B')}`);
    if (d.pickups) ok(d.pickups.length === tc('A'), `pickups ${d.pickups.length} != 'A' tiles ${tc('A')}`);
    if (d.qitems) ok(d.qitems.length === tc('I'), `qitems ${d.qitems.length} != 'I' tiles ${tc('I')}`);
    if (d.switches) ok(d.switches.length === tc('Q'), `switches ${d.switches.length} != 'Q' tiles ${tc('Q')}`);
    if (d.glyphs) ok(d.glyphs.length === tc('J'), `glyphs ${d.glyphs.length} != 'J' tiles ${tc('J')}`);
    if (d.teleports) ok(d.teleports.length === tc('O'), `teleports ${d.teleports.length} != 'O' tiles ${tc('O')}`);
    if (d.chests) ok(d.chests.length === tc('C'), `chests ${d.chests.length} != 'C' tiles ${tc('C')}`);
    if (d.vehicles) ok(d.vehicles.length === tc('V'), `vehicles ${d.vehicles.length} != 'V' tiles ${tc('V')}`);
    if (d.hires) ok(d.hires.length === tc('H'), `hires ${d.hires.length} != 'H' tiles ${tc('H')}`);

    // --- captive ids valid ---
    for (const id of d.captiveChars || []) ok(validChars.has(id), `captive '${id}' not a real character`);

    // --- hire jobs valid ---
    for (const hd of d.hires || []) if (hd.job !== undefined) ok(HIRE_JOBS.has(hd.job), `hire job '${hd.job}' unknown`);

    // --- switch quorum satisfiable ---
    for (const sg of d.switchGroups || []) {
      const members = parsed.switches.filter((s: any) => s.group === (sg.group ?? 0)).length;
      ok((sg.need || 1) <= members, `switch group '${sg.group}' need ${sg.need} > ${members} relays`);
    }
    // --- glyph orders satisfiable ---
    for (const gg of d.glyphGroups || []) {
      const members = parsed.glyphs.filter((s: any) => s.group === (gg.group ?? 0));
      ok((gg.order || []).length >= 1, `glyph group '${gg.group}' orders zero runes`);
      for (const sym of gg.order || []) {
        ok(Number.isInteger(sym) && sym >= 0 && sym <= 7, `glyph symbol ${sym} not a rune 0-7`);
        ok(members.some((m: any) => m.symbol === sym), `glyph group '${gg.group}' missing stone for rune ${sym}`);
      }
    }
    // --- teleport twins resolve ---
    for (const t of parsed.teleports) if (t.twin != null) ok(parsed.teleports.some((o: any) => o.id === t.twin), `teleport '${t.id}' twin '${t.twin}' missing`);

    // --- openDoor rewards reference real doors ---
    const doorIds = new Set((d.doors || []).map((dd: any, i: number) => dd.id || 'door' + i));
    const wantsDoor = (id: string, src: string): void => ok(doorIds.has(id), `${src} openDoor '${id}' not a real door`);
    for (const q2 of d.quests || []) if (q2.reward && q2.reward.openDoor) wantsDoor(q2.reward.openDoor, `quest '${q2.id}'`);
    for (const sg of d.switchGroups || []) if (sg.reward && sg.reward.openDoor) wantsDoor(sg.reward.openDoor, `switch group '${sg.group}'`);
    for (const gg of d.glyphGroups || []) if (gg.reward && gg.reward.openDoor) wantsDoor(gg.reward.openDoor, `glyph group '${gg.group}'`);

    // --- quests ---
    for (const q of d.quests || []) {
      ok(q.id && typeof q.title === 'string' && q.title.length > 0, 'quest missing id/title');
      ok(QUEST_KINDS.has(q.kind), `quest '${q.id}' kind '${q.kind}' unknown`);
      ok((d.npcs || []).some((n: any) => n.id === q.giver), `quest '${q.id}' giver '${q.giver}' not an npc`);
      if (q.kind === 'fetch') {
        ok(q.item, `fetch quest '${q.id}' names no item`);
        ok((d.qitems || []).some((it: any) => (it.kind || 'fragment') === q.item), `fetch quest '${q.id}' item '${q.item}' not among qitems`);
      }
    }

    // --- gate need <= pylons ---
    if (d.gate) {
      const pylons = (d.builds || []).filter((b: any) => b.kind === 'pylon').length;
      ok(d.gate.need <= pylons, `gate.need ${d.gate.need} > ${pylons} pylons`);
    }

    // --- waves: legal roster letters + edge ---
    for (const wv of (d.modifiers && d.modifiers.waves) || []) {
      ok(wv.letters.length >= 1 && [...wv.letters].every((c: string) => WAVE_LETTERS.has(c)), `wave letters '${wv.letters}' contain a non-enemy char`);
      ok(['n', 's', 'e', 'w'].includes(wv.edge), `wave edge '${wv.edge}' not n/s/e/w`);
    }

    // --- cutscene slides ---
    for (const slide of [...(d.intro || []), ...(d.outro || [])]) {
      ok(typeof slide.title === 'string' && slide.title.length > 0, 'slide missing title');
      ok(Array.isArray(slide.lines) && slide.lines.length >= 1 && slide.lines.length <= 3, 'slide lines not 1-3');
      ok(ART_KEYS.has(slide.art), `slide art '${slide.art}' unknown`);
    }

    // --- ambience / weather strings (any level may carry them) ---
    if (d.ambience !== undefined && d.ambience !== null) ok(AMBIENCE.has(d.ambience), `ambience '${d.ambience}' unknown`);
    if (d.weather !== undefined && d.weather !== null) ok(WEATHERS.has(d.weather), `weather '${d.weather}' unknown`);

    // --- doors cover walkable floor + in bounds ---
    for (const [i, door] of (d.doors || []).entries()) {
      const dw = door.w || 1, dh = door.h || 1, id = door.id || 'door' + i;
      ok(door.x >= 0 && door.y >= 0 && door.x + dw <= parsed.w && door.y + dh <= parsed.h, `door '${id}' out of bounds`);
      for (let yy = door.y; yy < door.y + dh; yy++)
        for (let xx = door.x; xx < door.x + dw; xx++)
          if (parsed.grid[yy] && parsed.grid[yy][xx] !== undefined) ok(PASS(parsed.grid[yy][xx]), `door '${id}' covers '${parsed.grid[yy][xx]}' at (${xx},${yy})`);
    }

    // --- createGame + ~30 step()s without throwing ---
    const party = pvp
      ? Array.from({ length: 8 }, (_, i) => ({ pid: i, name: 'P' + i, charId: anyChar, team: i % 2 }))
      : [{ pid: 0, name: 'A', charId: anyChar }];
    const g: any = createGame(def, party, charMap, startingRoster.length ? startingRoster : (anyChar ? [anyChar] : []));
    if (g.players[0]) g.players[0].invuln = 999;
    g.graceT = 1e9;
    for (let i = 0; i < 30 && g.status === 'play'; i++) step(g, { 0: {} }, 1 / 30);

    // --- BFS reachability (flood through closed doors + teleport twins) ---
    const seen = new Set<string>();
    const sx = Math.floor(parsed.spawns[0].x / TILE), sy = Math.floor(parsed.spawns[0].y / TILE);
    const stack: [number, number][] = [[sx, sy]];
    seen.add(sx + ',' + sy);
    const doorRects = (d.doors || []).map((door: any) => ({ x: door.x, y: door.y, w: door.w || 1, h: door.h || 1 }));
    const inDoor = (x: number, y: number): boolean => doorRects.some((r: any) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    const flood = (): void => {
      while (stack.length) {
        const [x, y] = stack.pop()!;
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
        const twin = parsed.teleports.find((o: any) => o.id === t.twin); if (!twin) continue;
        const wx = Math.floor(twin.x / TILE), wy = Math.floor(twin.y / TILE);
        if (seen.has(wx + ',' + wy)) continue;
        changed = true; seen.add(wx + ',' + wy); stack.push([wx, wy]); flood();
      }
      if (!changed) break;
    }
    const reach = (px: number, py: number, what: string): void =>
      ok(seen.has(Math.floor(px / TILE) + ',' + Math.floor(py / TILE)), `UNREACHABLE ${what}`);
    if (parsed.core) reach(parsed.core.x, parsed.core.y, 'core');
    for (const c of parsed.cores || []) reach(c.x, c.y, 'beacon');
    for (const c of parsed.captives || []) reach(c.x, c.y, `captive ${c.charId}`);
    for (const n of parsed.npcs || []) reach(n.x, n.y, `npc ${n.id}`);
    for (const b of parsed.builds || []) reach(b.x, b.y, `${b.kind} site`);
    for (const s of parsed.switches || []) reach(s.x, s.y, `relay ${s.id}`);
    for (const gl of parsed.glyphs || []) reach(gl.x, gl.y, `glyph ${gl.id}`);
    for (const pl of parsed.pillars || []) reach(pl.x, pl.y, `pillar ${pl.id}`);
    for (const fo of parsed.forges || []) reach(fo.x, fo.y, 'forge');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d.tiles[y][x] === 'E') ok(seen.has(x + ',' + y), `UNREACHABLE exit at (${x},${y})`);
    if (d.capture) reach((d.capture.x + 0.5) * TILE, (d.capture.y + 0.5) * TILE, 'capture zone');
    if (d.escort && d.escort.path) for (const [wx, wy] of d.escort.path) reach((wx + 0.5) * TILE, (wy + 0.5) * TILE, 'escort waypoint');

    // ---------------------------------------------------------------------
    // Stronghold-specific def integrity (mirrors testStrongholdDefIntegrity /
    // validate-maps.mjs's second pass). Gated on category === 'stronghold'.
    // ---------------------------------------------------------------------
    if (d.category === 'stronghold') {
      const sh: any = d.stronghold || {};
      const b: any = d.bastion || {};
      ok(d.mode === 'bastion', `mode is '${d.mode}' not bastion`);
      ok(sh && typeof sh === 'object', 'def.stronghold missing');
      ok(Number.isInteger(sh.level) && sh.level >= 1 && sh.level <= 25, `stronghold.level ${sh.level} not 1..25`);
      ok(['S', 'M', 'L', 'XL'].includes(sh.sizeLabel), `sizeLabel '${sh.sizeLabel}' not S/M/L/XL`);
      ok(Number.isInteger(sh.difficulty) && sh.difficulty >= 1 && sh.difficulty <= 5, `difficulty ${sh.difficulty} not 1..5`);
      const nights = b.nights ?? 5;
      const wpn = Math.max(1, Math.min(3, b.wavesPerNight || 1));
      const moons = (b.bloodMoons || []).length;
      if (b.endless) ok(Number.isInteger(sh.waves) && sh.waves > 0, 'endless waves not a positive sentinel');
      else ok(sh.waves === nights * wpn + moons * wpn, `waves ${sh.waves} != ${nights}n x${wpn} + ${moons}moons x${wpn} = ${nights * wpn + moons * wpn}`);
      if (b.waveMult !== undefined) ok(b.waveMult >= 1 && b.waveMult <= 2.6, `waveMult ${b.waveMult} not 1..2.6`);
      if (b.bossNights !== undefined) {
        ok(Array.isArray(b.bossNights) && b.bossNights.length >= 1, 'bossNights empty');
        for (const bn of b.bossNights || []) ok(Number.isInteger(bn) && bn >= 1 && bn <= nights, `boss night ${bn} not 1..${nights}`);
      }
      if (sh.hpMult !== undefined) ok(sh.hpMult >= 1 && sh.hpMult <= 2, `hpMult ${sh.hpMult} not 1..2`);
      if (sh.unlock !== undefined) ok(validChars.has(sh.unlock), `unlock '${sh.unlock}' not a real character`);
      ok(typeof sh.blurb === 'string' && sh.blurb.length > 0, 'blurb missing');
      ok(Array.isArray(sh.newFeatures) && sh.newFeatures.every((s: any) => typeof s === 'string'), 'newFeatures not all strings');
      ok(Array.isArray(d.intro) && d.intro.length >= 1, 'no intro slide');
      for (const row of d.tiles) for (const c of row) if (!LEGAL_TILES.has(c)) { ok(false, `illegal tile '${c}'`); break; }
      for (const bd of d.builds || []) {
        ok(BUILD_KINDS.has(bd.kind), `build kind '${bd.kind}' unknown`);
        ok(typeof bd.cost === 'number' && bd.cost >= 0, 'build cost bad');
        if (bd.prebuilt !== undefined) ok(typeof bd.prebuilt === 'boolean', 'prebuilt not boolean');
      }
      for (const pd of d.patrols || []) {
        ok(Array.isArray(pd.at) && pd.at.length === 2, 'patrol missing home tile');
        ok(Array.isArray(pd.points) && pd.points.length >= 2 && pd.points.length <= 4, 'patrol not 2-4 points');
      }
      // market stalls must sit >= 2.5 tiles from any build/work spot
      const stalls: [number, number][] = [], works: [number, number][] = [];
      d.tiles.forEach((row: string, y: number) => {
        for (let x = 0; x < row.length; x++) {
          if (row[x] === 'S') stalls.push([x, y]);
          else if (row[x] === 'B' || row[x] === 'W') works.push([x, y]);
        }
      });
      for (const [stx, sty] of stalls)
        for (const [wx, wy] of works) {
          const dd = Math.hypot(wx - stx, wy - sty);
          ok(dd >= 2.5, `stall (${stx},${sty}) only ${dd.toFixed(2)} tiles from build (${wx},${wy})`);
        }
    }
  } catch (e: any) {
    problems.push(`THREW: ${e && e.message ? e.message : String(e)}`);
  }

  return { ok: problems.length === 0, problems };
}
