// Headless playtest: STORY CHAPTER X (levels/story/ch10.json, "The Burned
// Names"). One scripted operative drives every mission system of the chapter
// through the real sim (ch9 wiring chassis): cheat positioning + permanent
// invuln verify the DEF WIRING between beats, while the kills themselves
// (phantom hunt, necropolis wardens, milestone waves) are REAL shots through
// the real combat pipeline. The whole run is wrapped in runChapter() and
// replayed for the determinism gate.
//
//   - untimed story clock, ashstorm weather, no captives (roster is full)
//   - both givers activate their quests; gifts pay once (10 + 8 shards)
//   - 'q-registry' reach trips in the registry hall
//   - ALL THREE GLYPH RITES in hinted order, plus ONE deliberate wrong-stone
//     reset on the bell-tower rite:
//       g0 name(2) > bond(3) > burn(5)  -> reliquary opens
//       g1 anchor(0) > burn(5)          -> tomb-west opens (the keepers)
//       g2 quorum(6) > burn(5)          -> tomb-east opens (the east row)
//   - three proof fragments scooped; the handover consumes exactly two and
//     leaves the keeper fragment for the anvil
//   - CRYPT SEAL FLOW: act-hold at the cold anvil (fragment + 20 shards) ->
//     lythseal -> the bells' 7-of-10 quorum opens the vault approach ->
//     the sealLock vault door swings on touch -> 'q-vault' reach inside
//   - bell window negative test: one toll, 120s expiry -> switchReset
//   - phantom hunt: ten Null Acolytes fall to real fire ('q-faces')
//   - MILESTONE WAVES at 300/600/840/960/975s (n/w/e/e/s) are met and put
//     down to the last attacker — the operative holds until the ash settles
//   - 'q-quay' reach trips at the far quay -> main-chain reach finale clears
//   - DETERMINISM: the full run replays to the same event hash and clock
//
// Run: node scripts/playtest-ch10.mjs   (exit 0 = all checks pass)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { charsById, createGame, snapshot, step, TILE } from '../shared/game.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const def = JSON.parse(fs.readFileSync(path.join(root, 'levels/story/ch10.json'), 'utf8'));
const characters = JSON.parse(fs.readFileSync(path.join(root, 'shared/characters.json'), 'utf8'));
const charMap = charsById(characters);

const DT = 1 / 30;
const ROSTER = ['scout', 'sniper', 'shade', 'volt', 'soldier'];
const checks = [];
const issues = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) issues.push(`${name}${detail ? ' (' + detail + ')' : ''}`);
}
function note(msg) { console.log('      ' + msg); }
const fnv = (h, s) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
const HASH_SKIP = new Set(['shoot', 'hitWall', 'build', 'aim']);

// ---------------------------------------------------------------------------
function runChapter() {
  const g = createGame(def, [{ pid: 0, name: 'Warden', charId: 'scout' }], charMap, ROSTER);
  const p = g.players[0];
  const log = [];
  const notes = [];
  const waveIds = new Set(); // every enemy spawned by a milestone wave tick
  const spawnBaseline = g.nextEnemyId; // map population ends below this id
  let hash = 2166136261 >>> 0;
  let timeLeftDrift = false;
  let frames = 0;

  function tick(n, inp = {}) {
    for (let i = 0; i < n; i++) {
      p.invuln = 9999; // wiring run: the operative cannot fall between beats
      const beforeNext = g.nextEnemyId;
      step(g, { 0: inp }, DT);
      frames++;
      if (g.timeLeft !== def.time) timeLeftDrift = true;
      let sawWave = false;
      for (const e of g.events.splice(0)) {
        const rec = { ...e, t: g.elapsed };
        if (e.type === 'quorum') rec.onAt = g.switches.filter(s => s.on).length;
        if (e.type === 'sealForged') rec.shardsAfter = g.shards;
        if (e.type === 'wave') sawWave = true;
        log.push(rec);
        if (!HASH_SKIP.has(e.type)) {
          hash = fnv(hash, `${e.type}:${e.pid ?? e.id ?? e.group ?? ''}:${Math.round(e.x ?? 0)},${Math.round(e.y ?? 0)};`);
        }
      }
      if (sawWave) for (const e of g.enemies) if (e.id >= beforeNext) waveIds.add(e.id);
      if (g.status !== 'play') return;
    }
  }
  const put = (tx, ty) => { p.x = (tx + 0.5) * TILE; p.y = (ty + 0.5) * TILE; tick(2); };
  const press = () => { tick(1, { act: true }); tick(8); };
  const ev = type => log.filter(e => e.type === type);
  const quest = id => g.quests.find(q => q.id === id);

  // FINALE DISCIPLINE: a main 'reach' quest counts complete the moment any
  // player stands inside its 1.5-tile ring — so the hunts must never place
  // the operative near a PENDING main reach target, or the chapter would
  // auto-clear out from under the later beats (the quay phantom spawns one
  // tile from the skiff-out ring; an acolyte roams the Vault of Names).
  const reachRings = () => g.quests
    .filter(q => q.main && q.kind === 'reach' && q.progress < q.count && q.target)
    .map(q => ({ x: (q.target.x + 0.5) * TILE, y: (q.target.y + 0.5) * TILE }));
  const ringSafe = e => reachRings().every(r => (e.x - r.x) ** 2 + (e.y - r.y) ** 2 > (3 * TILE) ** 2);

  // real fire: stand beside the target (inside its own tile when possible so
  // shots never spawn in a wall), face it, hold the trigger. Bulwarks block
  // every shot arriving within ~70 degrees of their facing (shieldBlocks),
  // so the operative slips BEHIND the shield wall first — perpendicular and
  // plain side offsets are the fallbacks when the back row is rubble.
  const walkable = (tx, ty) => !'#T~o%!'.includes((g.grid[ty] || '')[tx] || '#');
  function engage(tgt) {
    const offs = [];
    if (tgt.kind === 'bulwark') {
      const fl = Math.hypot(tgt.fx, tgt.fy) || 1;
      const bx = -tgt.fx / fl, by = -tgt.fy / fl;
      offs.push([bx * 0.45, by * 0.45], [-by * 0.45, bx * 0.45], [by * 0.45, -bx * 0.45]);
    }
    offs.push([-0.45, 0], [0.45, 0], [0, -0.45], [0, 0.45]);
    for (const [ox, oy] of offs) {
      const nx = tgt.x + ox * TILE, ny = tgt.y + oy * TILE;
      if (walkable(Math.floor(nx / TILE), Math.floor(ny / TILE))) { p.x = nx; p.y = ny; break; }
    }
    const d = Math.hypot(tgt.x - p.x, tgt.y - p.y) || 1;
    p.fx = (tgt.x - p.x) / d;
    p.fy = (tgt.y - p.y) / d;
    tick(1, { fire: true });
  }
  // one combat step at the nearest live ring-safe enemy matching `match`
  function engageNearest(match) {
    let tgt = null, bd = Infinity, blocked = false;
    for (const e of g.enemies) {
      if (e.dead || !match(e)) continue;
      if (!ringSafe(e)) { blocked = true; continue; }
      const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
      if (d < bd) { bd = d; tgt = e; }
    }
    if (!tgt) return blocked ? 'blocked' : 'clear';
    engage(tgt);
    return 'engaged';
  }
  // hunt every live enemy matching `match` until none remain (nearest first);
  // ring-blocked stragglers get a beat to wander clear, then are re-checked
  function hunt(match, label, capFrames) {
    let guard = 0;
    while (guard++ < capFrames && g.status === 'play') {
      const r = engageNearest(match);
      if (r === 'clear') return true;
      if (r === 'blocked') tick(3);
    }
    notes.push(`hunt wedged: ${label} (cap ${capFrames})`);
    return false;
  }

  // --- the landing: clocks, weather, the two exiles -------------------------
  tick(5);

  put(23, 61); press(); // the Penitent, beside the southern landing
  put(49, 42); press(); // Sere Kallow in the registry hall
  put(46, 41); tick(3); // 'q-registry' reach target inside the hall

  // --- the rites: one deliberate wrong stone, then all three in hinted order
  put(57, 31); press(); // BURN first — "the mark that cannot be unsaid comes last"
  const resetAfterWrongStone = log.some(e => e.type === 'glyphReset')
    && g.glyphs.filter(gl => gl.group === 0).every(gl => !gl.lit);
  put(51, 31); press(); // NAME
  put(54, 31); press(); // BOND
  put(57, 31); press(); // BURN — always last
  put(15, 49); press(); // keeper tomb: ANCHOR
  put(15, 52); press(); // then BURN
  put(74, 51); press(); // east row: QUORUM
  put(74, 54); press(); // then BURN

  // --- fragments: two for the Ledger, the keepers' one for the anvil --------
  put(71, 24); tick(3); // frag-east, the phantom nest
  put(17, 30); tick(3); // frag-west
  put(9, 50); tick(3);  // frag-keeper, inside the opened west tomb
  const carriedBeforeHandover = g.qitems.filter(it => it.carrier === 0).length;
  put(49, 42); press(); // handover at Sere (consumes two, settles the hall quests)
  const keeperFragKept = g.qitems.length === 1 && g.qitems[0].id === 'frag-keeper'
    && g.qitems[0].carrier === 0;

  // --- the crypt seal: fragment + 20 shards at the cold anvil ----------------
  const shardsBeforeForge = g.shards;
  put(42, 42);
  { let guard = 0; while (!log.some(e => e.type === 'sealForged') && guard++ < 120) tick(1, { act: true }); }
  const shardsAfterForge = g.shards;

  // --- the phantom hunt: ten stolen faces, real fire -------------------------
  // the vault quarter's phantoms sleep until the Seal opens it, and the quay
  // phantom is left for the ash — both sit on pending main reach rings
  const qx = 71.5 * TILE, qy = 2.5 * TILE;
  const phantoms = g.enemies.filter(e => e.letter === 'q'
    && !(e.x < 35 * TILE && e.y < 20 * TILE)
    && (e.x - qx) ** 2 + (e.y - qy) ** 2 > (6 * TILE) ** 2).slice(0, 10);
  for (const ph of phantoms) hunt(e => e === ph, `phantom@${(ph.x / TILE).toFixed(0)},${(ph.y / TILE).toFixed(0)}`, 900);
  put(23, 61); press(); // settle q-seal, q-faces, q-keepers at the Penitent

  // --- the mourning bells: window expiry first, then a true count ------------
  put(52, 15); press(); // one toll starts the 120s window
  const tollsAfterOne = g.switches.filter(s => s.on).length;
  tick(Math.ceil(125 / DT)); // let the count lapse
  const resetWipedBells = log.some(e => e.type === 'switchReset') && g.switches.every(s => !s.on);
  const gateStillShut = !g.doors.find(d => d.id === 'vault-gate').open;
  for (const [bx, by] of [[52, 15], [40, 20], [64, 20], [32, 26], [71, 29], [28, 36], [69, 41]]) {
    put(bx, by); press(); // seven of ten, well inside the window
  }
  put(49, 42); press(); // settle q-bells (and q-rite, q-eastrow) at Sere

  // --- the vault: the Seal opens what nothing else answers -------------------
  const vaultShutBeforeTouch = !g.doors.find(d => d.id === 'vault').open;
  put(26, 11); tick(20, { left: true }); // press the Seal against the lock
  const vaultOpenedOnTouch = vaultShutBeforeTouch
    && log.some(e => e.type === 'doorOpen' && e.id === 'vault');
  const vaultUntrippedBeforeBeat = quest('q-vault').progress === 0;
  put(19, 12); tick(3); // 'q-vault' reach inside the Vault of Names
  const vaultTrippedAtBeat = vaultUntrippedBeforeBeat && quest('q-vault').progress >= 1;

  // --- the wardens: the vault ring is settled, so nothing is off-limits now —
  // put the necropolis bosses down before the long watch so their skitter
  // trickle can never crowd the 90-enemy cap and starve a milestone wave
  hunt(e => e.kind === 'boss', 'wardens', 6000);
  hunt(e => e.id >= spawnBaseline && !waveIds.has(e.id), 'warden spawn', 3000);

  // --- the watch: every milestone wave met and put down ----------------------
  const wavePlan = def.modifiers.waves || [];
  const lastAt = Math.max(...wavePlan.map(w => w.at));
  {
    let guard = 0;
    while (guard++ < 80000 && g.status === 'play') {
      const liveSpawn = g.enemies.some(e => !e.dead && e.id >= spawnBaseline);
      if (g.elapsed > lastAt + 12 && !liveSpawn && ev('wave').length >= wavePlan.length) break;
      if (!liveSpawn) { p.x = 44.5 * TILE; p.y = 44.5 * TILE; tick(15); continue; }
      if (process.env.CH10_DEBUG && guard % 1500 === 0) {
        const live = g.enemies.filter(e => !e.dead && e.id >= spawnBaseline);
        console.log(`watch t=${g.elapsed.toFixed(0)} stun=${(p.stunT || 0).toFixed(2)} cool=${p.cool.toFixed(2)} `
          + `p@${(p.x / TILE).toFixed(1)},${(p.y / TILE).toFixed(1)} shots=${ev('shoot').length} `
          + `live=[${live.slice(0, 6).map(e => `${e.letter}${e.hp}${e.shielded ? 'S' : ''}@${(e.x / TILE).toFixed(0)},${(e.y / TILE).toFixed(0)}`).join(' ')}]${live.length > 6 ? '+' + (live.length - 6) : ''}`);
      }
      if (engageNearest(e => e.id >= spawnBaseline) !== 'engaged') tick(3);
    }
    if (guard >= 80000) notes.push('watch wedged at the 80000-iteration cap');
  }
  const waveSurvivors = g.enemies.filter(e => waveIds.has(e.id) && !e.dead).length;
  const standingAfterWaves = g.status === 'play' && p.state === 'active';

  // --- the heading to Genesis: skiff out at the far quay ----------------------
  const quayCleanUntilFinale = quest('q-quay').progress === 0;
  put(71, 2); tick(10);

  return {
    g, p, log, notes, hash, frames, waveIds, timeLeftDrift, snap: snapshot(g),
    resetAfterWrongStone, carriedBeforeHandover, keeperFragKept,
    shardsBeforeForge, shardsAfterForge, tollsAfterOne, resetWipedBells,
    gateStillShut, vaultOpenedOnTouch, vaultTrippedAtBeat,
    waveSurvivors, standingAfterWaves, quayCleanUntilFinale,
  };
}

// ---------------------------------------------------------------------------
console.log('--- CH X playtest: the Burned Names, one operative, full wiring ---');
const A = runChapter();
const ev = type => A.log.filter(e => e.type === type);
const quest = id => A.g.quests.find(q => q.id === id);

// the landing
check('untimed story: timeLeft pinned, snapshot untimed, no lowTime',
  !A.timeLeftDrift && A.snap.untimed === true && !ev('lowTime').length,
  `timeLeft held at ${def.time}s, elapsed=${A.g.elapsed.toFixed(0)}s`);
check('ashstorm weather wired through sim and snapshot',
  A.g.weather === 'ashstorm' && A.snap.weather === 'ashstorm');
check('no captives: the roster is full', A.g.captives.length === 0);
check('the Penitent activates his three quests + pays his gift once',
  ['q-seal', 'q-faces', 'q-keepers'].every(id => quest(id).state !== 'hidden')
  && ev('talk').filter(e => e.npcId === 'the-penitent' && e.gift === 10).length === 1);
check('Sere Kallow activates her seven quests + pays her gift once',
  ['q-registry', 'q-fragments', 'q-rite', 'q-bells', 'q-vault', 'q-quay', 'q-eastrow'].every(id => quest(id).state !== 'hidden')
  && ev('talk').filter(e => e.npcId === 'sere-kallow' && e.gift === 8).length === 1,
  ev('quest').filter(e => e.state === 'active').map(e => e.id).join(', '));
check("'q-registry' reach trips in the registry hall", quest('q-registry').progress >= 1);

// the rites
check('deliberate wrong stone (burn first) -> glyphReset, rite restarts clean',
  A.resetAfterWrongStone && ev('glyphReset').length === 1,
  `${ev('glyphReset').length} reset(s) all run`);
const lit = ev('glyph');
check('bell-tower rite in hinted order: name>bond>burn -> reliquary opens',
  ev('glyphDone').some(e => e.group === 0)
  && lit.filter(e => e.group === 0).map(e => e.symbol).join('>') === '2>3>5'
  && ev('doorOpen').some(e => e.id === 'reliquary'));
check('keeper rite in hinted order: anchor>burn -> tomb-west opens',
  ev('glyphDone').some(e => e.group === 1)
  && lit.filter(e => e.group === 1).map(e => e.symbol).join('>') === '0>5'
  && ev('doorOpen').some(e => e.id === 'tomb-west'));
check('east-row rite in hinted order: quorum>burn -> tomb-east opens',
  ev('glyphDone').some(e => e.group === 2)
  && lit.filter(e => e.group === 2).map(e => e.symbol).join('>') === '6>5'
  && ev('doorOpen').some(e => e.id === 'tomb-east'));
check('glyph quests settled: q-rite, q-keepers, q-eastrow done',
  ['q-rite', 'q-keepers', 'q-eastrow'].every(id => quest(id).state === 'done'));

// the fragments and the crypt seal flow
const qp = ev('qitemPickup');
check('all three proof fragments scooped on touch',
  A.carriedBeforeHandover === 3 && ['frag-east', 'frag-west', 'frag-keeper'].every(id => qp.some(e => e.id === id)),
  qp.map(e => e.id).join(', '));
check('handover consumes exactly two; the keeper fragment stays for the anvil',
  quest('q-fragments').state === 'done' && A.keeperFragKept);
const sf = ev('sealForged');
check('LythiumSeal forged at the cold anvil (fragment + 20 shards, act-hold)',
  sf.length === 1 && A.p.lythseal === true
  && A.shardsBeforeForge - A.shardsAfterForge === 20 && A.g.qitems.length === 0
  && quest('q-seal').state === 'done',
  sf.length ? `@${sf[0].t.toFixed(0)}s, pool ${A.shardsBeforeForge.toFixed(0)} -> ${sf[0].shardsAfter.toFixed(0)}` : 'never forged');
check('bell window negative test: one toll lapses -> switchReset wipes the count',
  A.tollsAfterOne === 1 && A.resetWipedBells && A.gateStillShut
  && ev('switchReset').length === 1);
const quorum = ev('quorum');
check('the mourning bells: 7-of-10 inside one window -> vault-gate opens',
  quorum.length === 1 && quorum[0].onAt === 7
  && ev('doorOpen').some(e => e.id === 'vault-gate')
  && quest('q-bells').state === 'done',
  quorum.length ? `quorum @${quorum[0].t.toFixed(0)}s with ${quorum[0].onAt} bells tolled` : 'no quorum');
check('the vault answers the Seal and nothing else: sealLock swings on touch',
  A.vaultOpenedOnTouch);
check("'q-vault' reach trips inside the Vault of Names (at its beat, not before)",
  A.vaultTrippedAtBeat);

// the phantom hunt
check('ten Null Acolytes fall to real fire: q-faces done',
  quest('q-faces').state === 'done' && quest('q-faces').progress >= 10,
  `${A.g.kills} kills all run`);

// the milestone waves
const waves = ev('wave');
const plan = def.modifiers.waves;
const planOk = waves.length === plan.length && plan.every((w, i) =>
  waves[i] && waves[i].edge === w.edge && Math.abs(waves[i].t - w.at) < 2
  && waves[i].count === w.letters.length);
check(`milestone waves: all ${plan.length} fired on schedule at full strength`,
  planOk,
  waves.map(w => `${w.edge}x${w.count}@${w.t.toFixed(0)}s`).join(', ') || 'none fired');
check('milestone waves survived: every attacker down, the operative standing',
  A.waveSurvivors === 0 && A.waveIds.size === plan.reduce((n, w) => n + w.letters.length, 0)
  && A.standingAfterWaves,
  `${A.waveIds.size} attackers spawned, ${A.waveSurvivors} left alive`);

// the finale
check('finale discipline: q-quay stayed untripped until the skiff-out beat',
  A.quayCleanUntilFinale);
check("'q-quay' reach trips at the far quay -> main-chain reach finale clears",
  quest('q-quay').progress >= 1 && A.g.status === 'cleared'
  && ev('clear').length === 1 && ev('extract').length >= 1,
  `status=${A.g.status} at t=${A.g.elapsed.toFixed(0)}s, score ${Math.round(A.g.score)}`);
check('wiring integrity: no downs, no fails', !ev('down').length && !ev('fail').length);

// ledger + wrap
note('quest ledger: ' + A.g.quests.map(q => `${q.id}=${q.state}(${q.progress}/${q.count})`).join(' '));
note(`kills: ${A.g.kills}; pool end: ${A.g.shards.toFixed(0)} shards; frames: ${A.frames}; score: ${Math.round(A.g.score)}`);
if (A.notes.length) note('run notes: ' + A.notes.join('; '));

// --- determinism: the full chapter replays to the same hash and clock --------
const B = runChapter();
check('determinism: the full run replays to the same event hash and clock',
  B.hash === A.hash && B.g.status === A.g.status && B.frames === A.frames
  && Math.abs(B.g.elapsed - A.g.elapsed) < 0.001 && Math.round(B.g.score) === Math.round(A.g.score),
  `hashes ${A.hash.toString(16)} / ${B.hash.toString(16)}, t=${A.g.elapsed.toFixed(1)} / ${B.g.elapsed.toFixed(1)}, score ${Math.round(A.g.score)} / ${Math.round(B.g.score)}`);

const failed = checks.filter(c => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
