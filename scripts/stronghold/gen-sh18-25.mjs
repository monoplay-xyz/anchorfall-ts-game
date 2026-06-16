// Generates levels/stronghold/sh18.json .. sh25.json — the late arc and the
// finale of the 25-level stronghold campaign (Frontier IV, levels agent three).
// Imports the shared framework (scripts/stronghold/framework.mjs) for the
// painters, the fortified base kit, the difficulty arc, camps/patrols and the
// validating assembler. Deterministic: seeds 202607NN, byte-identical reruns.
//
// The eight levels (all XL, every silhouette organic, square boxes banned):
//   sh18 Helix Fields      — forest-rimmed dune spiral; relay prep quest;
//                            helix joins the roster
//   sh19 The Sunken Vault  — drowned stone basin; 4-beacon defense; a relay
//                            quorum opens the vault, lythseal opens the crypts
//   sh20 Selkie Deep       — archipelago; twin skiffs; pearl fetch; seal
//                            joins the roster
//   sh21 Emberfall         — lava veins off a cone volcano; toxic ash air
//                            (mask up); back-to-back blood moons
//   sh22 The Silent Quorum — fogbound forest; 4-beacon defense; acolyte
//                            war-camps; a timed four-relay quorum
//   sh23 Atlas Rise        — mountain hold behind THREE concentric wall
//                            rings (L1/L2/L3); atlas joins the roster
//   sh24 Night Unending    — void-shattered ash plain; seven long nights;
//                            comm-mast repair; teleport pair
//   sh25 FINALITY          — 110x80, every terrain on one field, 4 beacons
//                            (waveMult 1.8/hpMult 1.5 — retuned), 10 dense
//                            waves over 4 multi-wave nights, THREE Entropy
//                            bosses (nights 2/3/4 via def.bastion.bossNights)
import {
  createMap, waveTable, assembleDef, writeDef, report,
  WALL_COST, BARRICADE_COST,
} from './framework.mjs';

// ---------------------------------------------------------------------------
// shared helpers for this file's eight levels
// ---------------------------------------------------------------------------

const slide = (title, lines, art) => ({ title, lines, art });

// Keep camps and sentries honest: never inside `r` tiles of the base heart.
const awayFrom = (bx, by, r) => (x, y) => Math.hypot(x - bx, y - by) >= r;

// The standard fort interior kit: core (optional), 4 spawns, shop, 4 corner
// towers, a hire row, farm plots, turret sites, stabled stags, campfires.
// Rect must be at least 17x13. Every spot is fort floor by construction.
function baseKit(map, { x0, y0, x1, y1, core = true, hires, farms = 4, stags = 2, turrets = null }) {
  const cx = (x0 + x1) >> 1, cy = (y0 + y1) >> 1;
  if (core) map.addCore(cx, cy);
  map.addSpawn(cx - 2, cy - 2); map.addSpawn(cx + 2, cy - 2);
  map.addSpawn(cx - 2, cy + 2); map.addSpawn(cx + 2, cy + 2);
  map.addShop(cx + 4, y0 + 2);
  map.addTower(x0 + 2, y0 + 2); map.addTower(x1 - 2, y0 + 2);
  map.addTower(x0 + 2, y1 - 2); map.addTower(x1 - 2, y1 - 2);
  for (let i = 0; i < hires.length; i++) map.addHire(x0 + 3, y0 + 3 + i * 2, hires[i]);
  const farmAt = [[x1 - 5, y1 - 4], [x1 - 3, y1 - 4], [x1 - 5, y1 - 2], [x1 - 3, y1 - 2]];
  for (let i = 0; i < Math.min(farms, 4); i++) map.addBuild(farmAt[i][0], farmAt[i][1], { kind: 'farm', cost: 6 });
  const tspots = turrets || [
    [cx - 2, y0 + 2], [cx + 2, y0 + 2], [cx - 2, y1 - 2], [cx + 2, y1 - 2],
    [x0 + 2, cy], [x1 - 2, cy],
  ];
  for (const [tx, ty] of tspots) map.addBuild(tx, ty, { kind: 'turret', cost: 10 });
  for (let i = 0; i < stags; i++) map.addVehicle(cx - 3 + i * 6, cy, 'stag');
  map.addCampfire(cx, cy - 2); map.addCampfire(cx, cy + 2);
  return { cx, cy };
}

// A beacon satellite fort: a 7x7 walled post holding one 'K' monolith, with
// two gates (barricade sites) and one turret site inside. `tesla: true`
// (sh25's beatability retune) ships the turret PREBUILT as a tesla and adds
// a second open site — the last stand starts armed, not broke.
function beaconFort(map, cx, cy, { wallLevel = 2, gates, tesla = false } = {}) {
  const x0 = cx - 3, y0 = cy - 3, x1 = cx + 3, y1 = cy + 3;
  const g = gates || [[cx, y0], [cx, y1]];
  map.fortRect({ x0, y0, x1, y1, gates: g, wallLevel, apron: 2 });
  map.addCore(cx, cy);
  map.addBuild(cx - 2, cy, tesla
    ? { kind: 'turret', cost: 10, prebuilt: true, ttype: 'tesla' }
    : { kind: 'turret', cost: 10 });
  if (tesla) map.addBuild(cx, cy + 2, { kind: 'turret', cost: 10 });
  map.addCampfire(cx + 2, cy);
}

// An ORTHOGONALLY-continuous ring of prebuilt wall segments (a diamond/circle
// ring leaves diagonal joints an operative-width gap — this never does).
// Gates are angle positions (radians); each opens a gap of `gateTiles` cells
// holding unbuilt barricade sites.
function wallRing(map, cx, cy, r, { gates = [], gateTiles = 3, level = 1 } = {}) {
  const cells = [];
  const seen = new Set();
  const steps = Math.max(96, Math.ceil(r * 16));
  let last = null;
  for (let i = 0; i <= steps; i++) {
    const th = (i / steps) * Math.PI * 2;
    const x = Math.round(cx + r * Math.cos(th));
    const y = Math.round(cy + r * Math.sin(th));
    if (last && Math.abs(x - last[0]) === 1 && Math.abs(y - last[1]) === 1) {
      const k = x + ',' + last[1];
      if (!seen.has(k)) { seen.add(k); cells.push([x, last[1], th]); }
    }
    const k = x + ',' + y;
    if (!seen.has(k)) { seen.add(k); cells.push([x, y, th]); }
    last = [x, y];
  }
  const gateHalf = gateTiles / (2 * r);
  for (const [x, y, th] of cells) {
    const isGate = gates.some(g => {
      const d = Math.abs(((th - g + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      return d <= gateHalf;
    });
    if (map.get(x, y) === 'B') continue; // ring joints can revisit a cell
    map.set(x, y, '.');
    if (isGate) map.addBuild(x, y, { kind: 'barricade', cost: BARRICADE_COST });
    else map.addBuild(x, y, { kind: 'wall', cost: WALL_COST, prebuilt: true, ...(level > 1 ? { level } : {}) });
  }
}

// Carve a 2-wide wave mouth from a map edge straight inward (depth tiles).
// The depth-0 frame keeps the border letter; waveEntryPoints scans depth<2.
function mouths(map, edge, positions, depth = 11, floor = '.') {
  for (const p of positions) {
    if (edge === 'n') map.carve(p, 1, p, depth, 2, floor);
    else if (edge === 's') map.carve(p, map.h - 2, p, map.h - 1 - depth, 2, floor);
    else if (edge === 'w') map.carve(1, p, depth, p, 2, floor);
    else map.carve(map.w - 2, p, map.w - 1 - depth, p, 2, floor);
  }
}

// Nudge-place a quest item / pickup / npc on the nearest open floor.
function placeLoose(map, kind, x, y, ...args) {
  const spot = map.nudge(x, y);
  if (!spot) map.fail(`no loose spot near ${x},${y}`);
  if (kind === 'qitem') map.addQitem(spot[0], spot[1], args[0]);
  else if (kind === 'pickup') map.addPickup(spot[0], spot[1], args[0]);
  else if (kind === 'npc') map.addNpc(spot[0], spot[1], args[0]);
  else if (kind === 'vehicle') map.addVehicle(spot[0], spot[1], args[0]);
  else map.fail(`placeLoose: unknown kind ${kind}`);
  return spot;
}

// Stamp a letter the framework has no adder for ('Z' forge, 'O' teleport)
// on guaranteed floor, nudging first.
function stamp(map, letter, x, y) {
  const spot = map.nudge(x, y);
  if (!spot) map.fail(`no stamp spot for '${letter}' near ${x},${y}`);
  map.set(spot[0], spot[1], letter);
  return spot;
}

const HIRES_STD = (names) => [
  { job: 'hound', cost: 10, name: names[0] },
  { job: 'farmer', cost: 8, name: names[1] },
  { job: 'engineer', cost: 10, name: names[2] },
  { job: 'smith', cost: 12, name: names[3] },
  { job: 'archer', cost: 12, name: names[4] },
];

// ===========================================================================
// sh18 — HELIX FIELDS (XL 100x72, helix unlock, relay prep quest)
// ===========================================================================
function genSh18() {
  const map = createMap({ w: 100, h: 72, seed: 20260718, name: 'sh18' });
  map.outline({ border: 'T', min: 2, max: 7, harmonics: 4, bites: 3 });
  // the helix itself: two interleaved dune arms spiralling into the bastion
  const scx = 50, scy = 36;
  for (let arm = 0; arm < 2; arm++) {
    for (let t = 2.4; t < 13.2; t += 0.08) {
      const r = 2.2 + t * 2.45;
      const x = scx + Math.cos(t + arm * Math.PI) * r * 1.30;
      const y = scy + Math.sin(t + arm * Math.PI) * r * 0.80;
      if (x > 6 && y > 6 && x < map.w - 7 && y < map.h - 7) map.disc(x, y, 1.5, '=');
    }
  }
  // two ponds anchoring the corners
  map.disc(78, 14, 5.0, '~');
  map.disc(20, 56, 4.5, '~');
  map.blob(16, 52, 2.2, '~', 0.85);
  // the bastion
  const F = { x0: 42, y0: 29, x1: 58, y1: 43 };
  map.fortRect({ ...F, gates: [[49, 29], [50, 29], [49, 43], [50, 43], [42, 36], [58, 36]], wallLevel: 2 });
  const { cx, cy } = baseKit(map, { ...F, hires: HIRES_STD(['Fang Vasht', 'Sage Junipre', 'Wrench Calloh', 'Forgemaster Ides', 'Fletch Maro']) });
  // sandbag cover flanking the lanes
  for (const [ox, oy] of [[46, 25], [53, 25], [46, 47], [53, 47], [38, 34], [38, 38], [62, 34], [62, 38]]) {
    if (map.get(ox, oy) === '.' || map.get(ox, oy) === '=') map.set(ox, oy, 'o');
  }
  // the three dune relays (quest: throw all three)
  map.addSwitch(28, 18, { id: 'helixA', group: 0 });
  map.addSwitch(72, 22, { id: 'helixB', group: 0 });
  map.addSwitch(32, 56, { id: 'helixC', group: 0 });
  placeLoose(map, 'npc', cx + 3, cy - 3, {
    id: 'cartwright', name: 'Suri the Cartwright',
    lines: [
      'The dune relays went dark when the spiral grew teeth.',
      'Throw all three before dusk. Silence reads as weakness out here.',
    ],
  });
  // loot, crystals, weapons
  const chestPlan = [
    [10, 9, 'shards', 9], [30, 9, 'cracker', 2], [88, 10, 'medkit', 1], [90, 36, 'shield', 1],
    [86, 62, 'shards', 10], [60, 63, 'toxin', 1], [12, 36, 'controller', 1], [12, 62, 'cracker', 2],
    [36, 16, 'medkit', 1], [68, 44, 'token', 1], [24, 44, 'shards', 8], [70, 8, 'shield', 1],
  ];
  for (const [x, y, loot, amt] of chestPlan) map.addChest(x, y, loot, amt);
  for (const [x, y] of [[20, 24], [42, 12], [62, 10], [84, 22], [90, 48], [74, 58], [50, 58], [30, 64], [8, 48], [8, 20], [60, 28], [36, 46], [66, 36], [26, 36]]) {
    map.addCrystal(x, y);
  }
  placeLoose(map, 'pickup', 24, 30, 'flamer');
  placeLoose(map, 'pickup', 78, 46, 'railcannon');
  // camps + sentries (alive world): all >= 16 tiles off the core
  const far = awayFrom(cx, cy, 16);
  map.camp({ x: 18, y: 14, members: ['g', 'g', 'w', 'a'], extra: far });
  map.camp({ x: 42, y: 9, members: ['z', 'z', 'w', 'u'], extra: far });
  map.camp({ x: 82, y: 14, members: ['g', 'a', 'n', 'w'], extra: far });
  map.camp({ x: 88, y: 42, members: ['r', 's', 'a', 'u'], extra: far });
  map.camp({ x: 78, y: 58, members: ['g', 'r', 'v', 'w'], extra: far });
  map.camp({ x: 48, y: 61, members: ['z', 'u', 'u', 'x'], extra: far });
  map.camp({ x: 16, y: 58, members: ['r', 's', 'n', 'z'], extra: far });
  map.camp({ x: 10, y: 32, members: ['g', 'w', 'q', 'z'], extra: far });
  map.sentry('m', 30, 32); map.sentry('m', 70, 50);
  map.sentry('x', 62, 16); map.sentry('v', 36, 52);
  // wave mouths through the treeline
  mouths(map, 'n', [30, 68]);
  mouths(map, 's', [24, 70]);
  mouths(map, 'w', [22, 50]);
  mouths(map, 'e', [18, 52]);
  map.validate({});
  map.paintShores();
  map.decorate((x, y, rnd) => {
    if (rnd() < 0.40) return ','; // meadow grass between the dune arms
    return null;
  });
  const table = waveTable({ level: 18, nights: 5, bloodMoons: [3, 5], dayLen: 100, nightLen: 80 });
  const def = assembleDef({
    level: 18, name: 'Helix Fields', sizeLabel: 'XL', difficulty: 4,
    blurb: 'A dune spiral cut into meadow, forest-rimmed. Restore the relays, then hold the heart of the helix for five nights.',
    newFeatures: ['Helix joins the roster', 'Spiral dune ridges', 'Relay prep-work before dusk'],
    objective: 'Throw the three dune relays, then hold the bastion through five nights',
    intro: [slide('Helix Fields', [
      'The fields grew this spiral the night the Anchor fell. Nobody planted it.',
      'Three relays watch the arms — all dark. Throw them before dusk.',
      'Then dig in: five nights, and the spiral pulls the waves inward.',
    ], 'settlement')],
    outro: [slide('The Spiral Holds', [
      'Dawn five. The dune arms are chewed flat, the relays still sing.',
      'Helix walks out of the spiral heart and signs on.',
    ], 'dawn')],
    table, map,
    ambience: 'meadow',
    quests: [{
      id: 'relays18', title: 'Restore the field relays', giver: 'cartwright',
      kind: 'switch', count: 3, reward: { shards: 18 },
      hint: 'Throw the three dune relays out along the spiral arms',
    }],
  });
  report(def, map, writeDef(def, 'sh18.json'));
}

// ===========================================================================
// sh19 — THE SUNKEN VAULT (XL 102x74, 4 beacons, quorum door + seal crypts)
// ===========================================================================
function genSh19() {
  const map = createMap({ w: 102, h: 74, seed: 20260719, name: 'sh19' });
  map.outline({ border: '~', min: 3, max: 8, harmonics: 5, bites: 2 });
  // the drowned basin: stone reefs and dust shoals
  for (let i = 0; i < 16; i++) map.blob(10 + map.rnd() * 82, 8 + map.rnd() * 58, 1.4 + map.rnd() * 2.2, '#');
  // central vault bastion (no core — the four beacons rule this hold)
  const F = { x0: 43, y0: 30, x1: 59, y1: 44 };
  map.fortRect({ ...F, gates: [[50, 30], [51, 30], [50, 44], [51, 44], [43, 37], [59, 37]], wallLevel: 2 });
  const { cx, cy } = baseKit(map, { ...F, core: false, hires: HIRES_STD(['Fang Ostre', 'Sage Brakka', 'Wrench Lumen', 'Forgemaster Vey', 'Fletch Sorin']) });
  const forge = stamp(map, 'Z', cx, cy); // the lythseal forge sits where a core would
  // four beacon monoliths in satellite posts
  beaconFort(map, 23, 17, { gates: [[26, 17], [23, 20]] });
  beaconFort(map, 79, 17, { gates: [[76, 17], [79, 20]] });
  beaconFort(map, 23, 57, { gates: [[26, 57], [23, 54]] });
  beaconFort(map, 79, 57, { gates: [[76, 57], [79, 54]] });
  // the vault: a rock chamber due north, its gate a quorum-opened door
  map.disc(51, 12, 4.6, '#');
  for (let y = 9; y <= 15; y++) for (let x = 48; x <= 54; x++) map.set(x, y, x === 48 || x === 54 || y === 9 || y === 15 ? '#' : ';');
  map.set(50, 15, ';'); map.set(51, 15, ';'); // the doorway floor
  map.addChest(50, 11, 'token', 1, { exact: false });
  map.addChest(52, 11, 'controller', 1, { exact: false });
  map.addChest(51, 13, 'shards', 14, { exact: false });
  // two seal crypts east and west, lythseal-locked
  for (const [rx, ry, doorSide] of [[13, 37, 'e'], [89, 37, 'w']]) {
    for (let y = ry - 3; y <= ry + 3; y++) for (let x = rx - 3; x <= rx + 3; x++) {
      map.set(x, y, Math.abs(x - rx) === 3 || Math.abs(y - ry) === 3 ? '#' : ';');
    }
    const dx = doorSide === 'e' ? rx + 3 : rx - 3;
    map.set(dx, ry, ';'); // doorway floor
  }
  map.addChest(12, 36, 'shards', 12, { exact: false });
  map.addChest(14, 38, 'shield', 1, { exact: false });
  map.addChest(88, 36, 'token', 1, { exact: false });
  placeLoose(map, 'pickup', 90, 38, 'mortarMk2');
  // the three quorum relays ring the vault
  map.addSwitch(38, 14, { id: 'qrA', group: 0 });
  map.addSwitch(64, 14, { id: 'qrB', group: 0 });
  map.addSwitch(51, 24, { id: 'qrC', group: 0 });
  // a skiff lagoon south: the moored skiff, an islet hoard ringed by water
  map.disc(70, 66, 6.0, '~');
  map.disc(70, 66, 1.4, '.');
  const isleChests = [
    map.addChest(69, 66, 'shards', 14, { exact: true, tag: 'isle' }),
    map.addChest(71, 66, 'token', 1, { exact: true, tag: 'isle' }),
  ];
  const dock = map.nudge(70, 58, (x, y) =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => map.get(x + ox, y + oy) === '~'));
  if (!dock) map.fail('no skiff dock on the lagoon');
  map.addVehicle(dock[0], dock[1], 'skiff');
  // loot + crystals
  const chestPlan = [
    [8, 14, 'medkit', 1], [30, 8, 'cracker', 2], [92, 12, 'medkit', 1], [94, 50, 'cracker', 2],
    [34, 64, 'shield', 1], [10, 56, 'shards', 10], [62, 50, 'toxin', 1], [40, 22, 'shield', 1],
  ];
  for (const [x, y, loot, amt] of chestPlan) map.addChest(x, y, loot, amt);
  for (const [x, y] of [[16, 26], [34, 30], [68, 28], [86, 26], [16, 48], [40, 54], [62, 60], [86, 48], [51, 20], [30, 42], [72, 42], [51, 62], [8, 37], [94, 37]]) {
    map.addCrystal(x, y);
  }
  placeLoose(map, 'pickup', 30, 50, 'flamer');
  // camps: drowned-vault congregation — husks, acolytes, stalkers
  const far = awayFrom(cx, cy, 15);
  map.camp({ x: 14, y: 22, members: ['z', 'z', 'q', 'w'], extra: far });
  map.camp({ x: 88, y: 22, members: ['g', 'a', 'q', 'z'], extra: far });
  map.camp({ x: 36, y: 10, members: ['n', 'a', 'g'], extra: far });
  map.camp({ x: 66, y: 10, members: ['x', 'x', 'z'], extra: far });
  map.camp({ x: 14, y: 52, members: ['s', 'r', 'u', 'z'], extra: far });
  map.camp({ x: 88, y: 52, members: ['q', 'q', 'z', 'w'], extra: far });
  map.camp({ x: 40, y: 62, members: ['z', 'z', 'w', 'u'], extra: far });
  map.camp({ x: 60, y: 24, members: ['v', 'q', 'z'], extra: far });
  map.sentry('m', 28, 34); map.sentry('m', 74, 34);
  map.sentry('x', 51, 56); map.sentry('v', 30, 22);
  // stone causeways out of the basin
  mouths(map, 'n', [26, 76], 12);
  mouths(map, 's', [30, 52], 12);
  mouths(map, 'w', [26, 46], 12);
  mouths(map, 'e', [22, 44], 12);
  map.validate({
    extraTargets: [[forge[0], forge[1], 'lythseal forge']],
    mustNotReach: isleChests.map(s => [s[0], s[1], 'isle chest']),
  });
  map.validateSkiff(dock, isleChests.map(s => [s[0], s[1], 'isle chest']));
  map.paintShores();
  map.decorate((x, y, rnd) => {
    if (rnd() < 0.30) return ';';
    if (rnd() < 0.18) return '_';
    return null;
  });
  const table = waveTable({ level: 19, nights: 4, bloodMoons: [2, 3, 4], dayLen: 100, nightLen: 80 });
  const def = assembleDef({
    level: 19, name: 'The Sunken Vault', sizeLabel: 'XL', difficulty: 4,
    blurb: 'A drowned basin with four anchor monoliths and a sealed vault. The hold only falls when all four go dark at once.',
    newFeatures: ['Four-beacon vault defense', 'A relay quorum opens the vault', 'Lythseal crypt doors'],
    objective: 'Keep at least one beacon lit through four nights — the vault pays those who open it',
    intro: [slide('The Sunken Vault', [
      'The basin drowned an age ago; its four monoliths never did.',
      'Waves split between every lit beacon. Dark ones relight by day, 8 shards.',
      'Three relays open the vault. The forge cuts a lythseal for the crypts.',
    ], 'basin')],
    outro: [slide('Out of the Deep', [
      'Four dawns and at least one light never failed.',
      'The vault stands open and the causeway column rides out rich.',
    ], 'dawn')],
    table, map,
    bastionVariant: 'beacons',
    weather: 'fog',
    ambience: 'city',
  });
  def.switchGroups = [{ group: 0, need: 3, reward: { openDoor: 'vault19' } }];
  def.doors = [
    { id: 'vault19', x: 50, y: 15, w: 2, h: 1 },
    { id: 'cryptW', x: 16, y: 37, w: 1, h: 1, sealLock: true },
    { id: 'cryptE', x: 86, y: 37, w: 1, h: 1, sealLock: true },
  ];
  report(def, map, writeDef(def, 'sh19.json'));
}

// ===========================================================================
// sh20 — SELKIE DEEP (XL 104x74, seal unlock, archipelago, twin skiffs)
// ===========================================================================
function genSh20() {
  const map = createMap({ w: 104, h: 74, seed: 20260720, name: 'sh20' });
  // the deep: a water world — outline first, then open sea, then the isles
  map.outline({ border: '~', min: 3, max: 9, harmonics: 5, bites: 3 });
  for (let i = 0; i < 30; i++) map.blob(8 + map.rnd() * 88, 6 + map.rnd() * 62, 2.5 + map.rnd() * 4.5, '~', 0.9);
  // island chain: the heart isle and six outliers
  const isles = [
    [52, 37, 14.5], // heart
    [18, 14, 7], [82, 13, 7.5], [92, 44, 6.5],
    [78, 62, 7], [26, 60, 7.5], [10, 38, 6],
  ];
  for (const [ix, iy, ir] of isles) map.disc(ix, iy, ir, '.');
  // sand-bar causeways between the isles and out to the map edges
  const bar = (x0, y0, x1, y1) => map.carve(x0, y0, x1, y1, 2, '=');
  bar(52, 24, 52, 10); bar(52, 10, 22, 12);   // heart -> north -> NW isle
  bar(60, 26, 80, 15);                        // heart -> NE isle
  bar(65, 40, 90, 44);                        // heart -> E isle
  bar(58, 48, 58, 60); bar(58, 60, 76, 60);   // heart -> south -> SE isle
  bar(44, 48, 28, 58);                        // heart -> SW isle
  bar(40, 38, 12, 38);                        // heart -> W isle
  // the bastion on the heart isle
  const F = { x0: 44, y0: 30, x1: 60, y1: 44 };
  map.fortRect({ ...F, gates: [[51, 30], [52, 30], [51, 44], [52, 44], [44, 37], [60, 37]], wallLevel: 2 });
  const { cx, cy } = baseKit(map, { ...F, hires: HIRES_STD(['Fang Skerry', 'Sage Nessa', 'Wrench Harrow', 'Forgemaster Ebb', 'Fletch Gale']) });
  // two hoard lagoons, each with its own moored skiff ON ITS OWN SHORE: the
  // sim's skiff flood spreads from the dock through CONNECTED water only
  // (walk-reachable land never carries it), so dock and hoard share a body.
  map.disc(42, 18, 5.2, '~'); map.disc(42, 18, 1.2, '.');   // north lagoon + islet
  map.disc(50, 57, 5.5, '~'); map.disc(50, 57, 1.2, '.');   // south lagoon + islet
  const lagoonDock = (lx, ly, r, fx, fy) => {
    const spot = map.nudge(fx, fy, (x, y) =>
      [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) =>
        map.get(x + ox, y + oy) === '~' && Math.hypot(x + ox - lx, y + oy - ly) <= r + 0.4));
    if (!spot) map.fail(`no dock on the lagoon at ${lx},${ly}`);
    map.addVehicle(spot[0], spot[1], 'skiff');
    return spot;
  };
  const dockN = lagoonDock(42, 18, 5.2, 42, 12);
  const dockS = lagoonDock(50, 57, 5.5, 50, 50);
  const isleChests = [
    map.addChest(42, 18, 'token', 1, { exact: true, tag: 'isle' }),
    map.addChest(50, 57, 'shards', 14, { exact: true, tag: 'isle' }),
    map.addChest(50, 58, 'controller', 1, { exact: true, tag: 'isle' }),
  ];
  // two pearl shoals (fetch quest) on the far isles
  const p1 = placeLoose(map, 'qitem', 18, 12, { id: 'pearlN', kind: 'pearl' });
  const p2 = placeLoose(map, 'qitem', 78, 63, { id: 'pearlS', kind: 'pearl' });
  placeLoose(map, 'npc', cx - 4, cy - 3, {
    id: 'maren', name: 'Maren of the Deep',
    lines: [
      'The selkie pearls washed up on the far shoals — north and south.',
      'Bring me both and the deep will owe you. So will I.',
    ],
  });
  // loot + crystals across the chain
  const chestPlan = [
    [16, 10, 'medkit', 1], [84, 10, 'cracker', 2], [94, 42, 'shield', 1], [80, 64, 'medkit', 1],
    [24, 62, 'shards', 10], [8, 36, 'cracker', 2], [44, 12, 'shield', 1], [62, 58, 'toxin', 1],
    [38, 26, 'shards', 9], [66, 28, 'medkit', 1], [88, 26, 'shards', 8],
  ];
  for (const [x, y, loot, amt] of chestPlan) map.addChest(x, y, loot, amt);
  for (const [x, y] of [[20, 18], [50, 8], [84, 18], [90, 50], [72, 66], [30, 56], [12, 32], [40, 50], [64, 46], [36, 38], [68, 36], [52, 18], [22, 8], [94, 36], [56, 64]]) {
    map.addCrystal(x, y);
  }
  placeLoose(map, 'pickup', 56, 12, 'stormgun');
  placeLoose(map, 'pickup', 88, 46, 'railcannon');
  // camps: tide crabs and shore watchers on every outlier
  const far = awayFrom(cx, cy, 15);
  map.camp({ x: 16, y: 16, members: ['g', 'w', 'a', 'u'], extra: far });
  map.camp({ x: 84, y: 14, members: ['z', 'u', 'u', 'w'], extra: far });
  map.camp({ x: 92, y: 46, members: ['r', 's', 'a'], extra: far });
  map.camp({ x: 78, y: 60, members: ['n', 'a', 'g', 'w'], extra: far });
  map.camp({ x: 26, y: 58, members: ['v', 'q', 'z'], extra: far });
  map.camp({ x: 10, y: 40, members: ['x', 'w', 'z'], extra: far });
  map.camp({ x: 52, y: 12, members: ['w', 'w', 'g', 'a'], extra: far });
  map.sentry('m', 30, 30); map.sentry('m', 72, 30);
  map.sentry('x', 44, 58); map.sentry('n', 60, 20, { patrol: false });
  // sand-bar wave mouths reaching the rim
  mouths(map, 'n', [22, 52, 80], 12, '=');
  mouths(map, 's', [28, 76], 12, '=');
  mouths(map, 'w', [38, 14], 12, '=');
  mouths(map, 'e', [13, 44], 12, '=');
  map.validate({ mustNotReach: isleChests.map(s => [s[0], s[1], 'isle hoard']) });
  map.validateSkiff(dockN, [[isleChests[0][0], isleChests[0][1], 'north hoard']]);
  map.validateSkiff(dockS, [[isleChests[1][0], isleChests[1][1], 'south hoard'], [isleChests[2][0], isleChests[2][1], 'south hoard']]);
  map.paintShores();
  map.decorate((x, y, rnd) => (rnd() < 0.25 ? ',' : null));
  const table = waveTable({ level: 20, nights: 4, wavesPerNight: 2, bloodMoons: [3], dayLen: 105, nightLen: 85 });
  const def = assembleDef({
    level: 20, name: 'Selkie Deep', sizeLabel: 'XL', difficulty: 4,
    blurb: 'An archipelago strung on sand bars. Waves wade the causeways; the deep hides pearls and a hoard only a skiff can reach.',
    newFeatures: ['Seal joins the roster', 'Two waves a night', 'Twin skiffs', 'Water-flanked approaches'],
    objective: 'Hold the heart isle for four double-wave nights — Maren pays for the two selkie pearls',
    intro: [slide('Selkie Deep', [
      'The deep took the land back and left a chain of shoals.',
      'Every causeway is a wave lane. Every channel, a flank for a skiff.',
      'Maren wants her pearls. The seal watches from the water.',
    ], 'crossing')],
    outro: [slide('What the Tide Returns', [
      'Four dawns. The causeways held and the pearls went home.',
      'The seal hauls out beside the fire and stays.',
    ], 'dawn')],
    table, map,
    weather: 'rain',
    ambience: 'swamp',
    quests: [{
      id: 'pearls20', title: 'Gather the selkie pearls', giver: 'maren',
      kind: 'fetch', item: 'pearl', count: 2, reward: { shards: 20 },
      hint: 'Two pearls wait on the far shoals — carry them back to Maren',
    }],
  });
  void p1; void p2;
  report(def, map, writeDef(def, 'sh20.json'));
}

// ===========================================================================
// sh21 — EMBERFALL (XL 104x76, lava fields, toxic ash air, 4 blood moons)
// ===========================================================================
function genSh21() {
  const map = createMap({ w: 104, h: 76, seed: 20260721, name: 'sh21' });
  map.outline({ border: '#', min: 2, max: 7, harmonics: 4, bites: 4 });
  // the cone and its flows
  map.disc(82, 16, 6.5, '!');
  map.disc(82, 16, 2.2, '#'); // the vent plug
  map.vein(82, 16, 30, 8, 3, '!', 0.4);
  map.vein(82, 16, 58, 42, 3, '!', 0.4);
  map.vein(58, 42, 18, 66, 3, '!', 0.45);
  map.vein(82, 16, 92, 58, 3, '!', 0.4);
  for (const [px, py, pr] of [[24, 26, 2.6], [66, 62, 3.0], [14, 50, 2.2], [44, 14, 2.4], [92, 34, 2.5]]) {
    map.disc(px, py, pr, '!');
  }
  // the ember bastion
  const F = { x0: 41, y0: 32, x1: 57, y1: 46 };
  map.fortRect({ ...F, gates: [[48, 32], [49, 32], [48, 46], [49, 46], [41, 39], [57, 39]], wallLevel: 2 });
  const { cx, cy } = baseKit(map, { ...F, hires: HIRES_STD(['Fang Cindra', 'Sage Mott', 'Wrench Slag', 'Forgemaster Pyre', 'Fletch Soot']) });
  // mask caches by the gates (toxic ash air until the second day burns off)
  map.addChest(36, 28, 'mask', 1);
  map.addChest(62, 50, 'mask', 1);
  // loot + crystals
  const chestPlan = [
    [10, 10, 'shards', 10], [34, 8, 'cracker', 2], [94, 10, 'medkit', 1], [96, 48, 'shield', 1],
    [80, 66, 'shards', 11], [48, 66, 'medkit', 1], [10, 66, 'cracker', 2], [8, 34, 'shield', 1],
    [28, 46, 'toxin', 1], [70, 30, 'token', 1], [60, 12, 'controller', 1], [88, 44, 'shards', 9],
  ];
  for (const [x, y, loot, amt] of chestPlan) map.addChest(x, y, loot, amt);
  for (const [x, y] of [[18, 16], [42, 6], [66, 8], [94, 22], [96, 60], [70, 70], [30, 68], [8, 56], [8, 22], [30, 36], [66, 46], [52, 22], [78, 50], [22, 58], [90, 36], [38, 58]]) {
    map.addCrystal(x, y);
  }
  placeLoose(map, 'pickup', 26, 20, 'railcannon');
  placeLoose(map, 'pickup', 74, 56, 'mortarMk2');
  // camps: the pyre host
  const far = awayFrom(cx, cy, 16);
  map.camp({ x: 18, y: 12, members: ['u', 'u', 'u', 'w'], extra: far });
  map.camp({ x: 56, y: 8, members: ['u', 'g', 'g', 'a'], extra: far });
  map.camp({ x: 92, y: 26, members: ['r', 's', 'u', 'z'], extra: far });
  map.camp({ x: 90, y: 54, members: ['v', 'v', 'z', 'w'], extra: far });
  map.camp({ x: 64, y: 68, members: ['x', 'r', 'u'], extra: far });
  map.camp({ x: 30, y: 62, members: ['n', 'a', 'u'], extra: far });
  map.camp({ x: 10, y: 42, members: ['q', 'z', 'z', 'u'], extra: far });
  map.camp({ x: 36, y: 20, members: ['n', 'a', 'g'], extra: far });
  map.sentry('m', 24, 34); map.sentry('m', 76, 38);
  map.sentry('x', 50, 58); map.sentry('v', 64, 22);
  // basalt mouths through the rim
  mouths(map, 'n', [26, 70]);
  mouths(map, 's', [34, 74]);
  mouths(map, 'w', [24, 56]);
  mouths(map, 'e', [20, 64]);
  map.validate({});
  map.paintShores();
  map.decorate((x, y, rnd) => {
    if (rnd() < 0.42) return '_'; // ashfall
    if (rnd() < 0.16) return '='; // cinder drifts
    return null;
  });
  const table = waveTable({ level: 21, nights: 3, wavesPerNight: 2, bloodMoons: [2, 3], dayLen: 95, nightLen: 85 });
  const def = assembleDef({
    level: 21, name: 'Emberfall', sizeLabel: 'XL', difficulty: 5,
    blurb: 'Lava veins off a live cone, ash on every wind — and back-to-back blood moons. Mask up before the first dusk.',
    newFeatures: ['Toxic ash air — mask up', 'Back-to-back blood moons', 'Lava-field warfare'],
    objective: 'Survive three double-wave nights under the ashfall — the air itself is poison until the second day',
    intro: [slide('Emberfall', [
      'The cone woke last month and the sky has not closed since.',
      'Until the second day burns off, unmasked lungs pay in blood.',
      'Two blood moons, back to back. Lava on every lane. Welcome to Emberfall.',
    ], 'entropy')],
    outro: [slide('After the Ash', [
      'Nine dawns and the cone finally sleeps.',
      'The bastion stands black with soot — and standing is everything.',
    ], 'dawn')],
    table, map,
    weather: 'ashstorm',
    ambience: 'lava',
    modifiers: { toxicAir: { until: 260 } },
  });
  report(def, map, writeDef(def, 'sh21.json'));
}

// ===========================================================================
// sh22 — THE SILENT QUORUM (XL 106x76, 4 beacons, acolyte host, timed quorum)
// ===========================================================================
function genSh22() {
  const map = createMap({ w: 106, h: 76, seed: 20260722, name: 'sh22' });
  map.outline({ border: 'T', min: 2, max: 8, harmonics: 5, bites: 3 });
  // silent groves dot the interior
  for (let i = 0; i < 18; i++) map.blob(10 + map.rnd() * 86, 8 + map.rnd() * 60, 1.6 + map.rnd() * 2.6, 'T');
  // a still black pond NE, a mire SW
  map.disc(80, 16, 4.5, '~');
  map.blob(20, 60, 3.5, '~', 0.85);
  // the hushed bastion (no core — four shrine beacons)
  const F = { x0: 45, y0: 31, x1: 61, y1: 45 };
  map.fortRect({ ...F, gates: [[52, 31], [53, 31], [52, 45], [53, 45], [45, 38], [61, 38]], wallLevel: 2 });
  const { cx, cy } = baseKit(map, { ...F, core: false, hires: HIRES_STD(['Fang Hush', 'Sage Murn', 'Wrench Tacet', 'Forgemaster Grave', 'Fletch Whisper']) });
  map.addCampfire(cx, cy); // the quorum hearth where a core would stand
  // four shrine beacons at the compass points
  beaconFort(map, 24, 16, { gates: [[27, 16], [24, 19]] });
  beaconFort(map, 82, 16, { gates: [[79, 16], [82, 19]] });
  beaconFort(map, 24, 60, { gates: [[27, 60], [24, 57]] });
  beaconFort(map, 82, 60, { gates: [[79, 60], [82, 57]] });
  // the quorum: four relays ringing the bastion, 90s to close the circle
  map.addSwitch(53, 24, { id: 'quA', group: 0 });
  map.addSwitch(38, 38, { id: 'quB', group: 0 });
  map.addSwitch(68, 38, { id: 'quC', group: 0 });
  map.addSwitch(53, 52, { id: 'quD', group: 0 });
  placeLoose(map, 'npc', cx + 3, cy - 3, {
    id: 'edra', name: 'Voiceless Edra',
    lines: [
      'The acolytes silenced the quorum. Four relays, one circle.',
      'Close it inside ninety heartbeats and the old armory answers.',
    ],
  });
  // loot + crystals
  const chestPlan = [
    [10, 10, 'shards', 10], [36, 8, 'medkit', 1], [94, 10, 'cracker', 2], [96, 44, 'shield', 1],
    [88, 66, 'shards', 11], [52, 66, 'medkit', 1], [12, 66, 'shield', 1], [8, 38, 'cracker', 2],
    [38, 22, 'toxin', 1], [68, 54, 'token', 1], [30, 48, 'controller', 1], [76, 28, 'shards', 9],
    [53, 10, 'medkit', 1],
  ];
  for (const [x, y, loot, amt] of chestPlan) map.addChest(x, y, loot, amt);
  for (const [x, y] of [[16, 24], [40, 12], [66, 10], [92, 24], [94, 54], [70, 66], [36, 64], [10, 50], [10, 24], [32, 38], [74, 44], [53, 18], [53, 58], [88, 36], [20, 42], [62, 24]]) {
    map.addCrystal(x, y);
  }
  placeLoose(map, 'pickup', 28, 28, 'stormgun');
  placeLoose(map, 'pickup', 78, 48, 'flamer');
  // the acolyte host: q in nearly every camp, husks for the dirge
  const far = awayFrom(cx, cy, 15);
  map.camp({ x: 16, y: 14, members: ['q', 'z', 'z', 'w'], extra: far });
  map.camp({ x: 90, y: 14, members: ['q', 'q', 'z', 'x'], extra: far });
  map.camp({ x: 92, y: 50, members: ['q', 'a', 'n', 'z'], extra: far });
  map.camp({ x: 64, y: 64, members: ['z', 'z', 'z', 'u', 'w'], extra: far });
  map.camp({ x: 30, y: 64, members: ['x', 'x', 'q'], extra: far });
  map.camp({ x: 10, y: 44, members: ['s', 'r', 'q', 'z'], extra: far });
  map.camp({ x: 40, y: 14, members: ['v', 'q', 'z'], extra: far });
  map.camp({ x: 66, y: 22, members: ['n', 'a', 'z'], extra: far });
  map.camp({ x: 16, y: 30, members: ['n', 'a', 'z'], extra: far });
  map.sentry('m', 34, 30); map.sentry('m', 72, 50);
  map.sentry('m', 53, 64); map.sentry('x', 44, 56); map.sentry('v', 62, 12);
  // hushed forest mouths
  mouths(map, 'n', [32, 72]);
  mouths(map, 's', [26, 78]);
  mouths(map, 'w', [20, 54]);
  mouths(map, 'e', [22, 58]);
  map.validate({});
  map.paintShores();
  map.decorate((x, y, rnd) => {
    if (rnd() < 0.30) return ','; // black moss
    if (rnd() < 0.10) return '_';
    return null;
  });
  const table = waveTable({ level: 22, nights: 8, bloodMoons: [5, 8], dayLen: 95, nightLen: 88 });
  const def = assembleDef({
    level: 22, name: 'The Silent Quorum', sizeLabel: 'XL', difficulty: 5,
    blurb: 'A fogbound forest where the acolytes hold court. Four shrine beacons, four silenced relays, eight nights of dirge.',
    newFeatures: ['Acolyte war-camps', 'A four-relay quorum on a 90s window', 'Shrine-beacon defense'],
    objective: 'Keep a shrine lit through eight nights — close the relay circle for the armory cache',
    intro: [slide('The Silent Quorum', [
      'No birdsong here. The acolytes sang it out of the trees.',
      'Four shrines anchor the hold; the waves split between the lit.',
      'Close the four-relay circle in one window — silence answers silence.',
    ], 'quorum')],
    outro: [slide('The Circle Closed', [
      'Eight dawns. The dirge is done and the shrines still burn.',
      'The forest remembers how to sound like a forest.',
    ], 'dawn')],
    table, map,
    bastionVariant: 'beacons',
    weather: 'fog',
    ambience: 'night',
    quests: [{
      id: 'quorum22', title: 'Close the quorum circle', giver: 'edra',
      kind: 'switch', target: '0', count: 1, reward: { weapon: 'stormgun' },
      hint: 'Throw all four relays within the 90s window',
    }],
  });
  def.switchGroups = [{ group: 0, need: 4, window: 90, reward: { shards: 25 } }];
  report(def, map, writeDef(def, 'sh22.json'));
}

// ===========================================================================
// sh23 — ATLAS RISE (XL 106x78, atlas unlock, three concentric wall rings)
// ===========================================================================
function genSh23() {
  const map = createMap({ w: 106, h: 78, seed: 20260723, name: 'sh23' });
  map.outline({ border: '#', min: 3, max: 8, harmonics: 4, bites: 3 });
  // crags and ice shelves on the high ground
  for (let i = 0; i < 14; i++) map.blob(10 + map.rnd() * 86, 8 + map.rnd() * 62, 1.5 + map.rnd() * 2.4, '#');
  map.disc(20, 14, 5, '^'); map.disc(88, 60, 5.5, '^'); map.disc(86, 14, 4, '^');
  // the mountainhold: three concentric rings, gates staggered ring to ring
  const cx = 53, cy = 39;
  for (let y = cy - 26; y <= cy + 26; y++)
    for (let x = cx - 27; x <= cx + 27; x++)
      if (map.inBounds(x, y) && x > 1 && y > 1 && x < map.w - 2 && y < map.h - 2
        && Math.hypot(x - cx, y - cy) <= 26.5) map.set(x, y, '.');
  wallRing(map, cx, cy, 24, { gates: [0, Math.PI / 2, Math.PI, Math.PI * 1.5], level: 1 });
  wallRing(map, cx, cy, 16, { gates: [Math.PI / 4, Math.PI * 1.25], level: 2 });
  wallRing(map, cx, cy, 8, { gates: [Math.PI * 0.75, Math.PI * 1.75], level: 3 });
  // terraces between the rings
  for (let y = cy - 24; y <= cy + 24; y++)
    for (let x = cx - 24; x <= cx + 24; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < 7.5 && map.get(x, y) === '.') map.set(x, y, ';');
    }
  // the summit core and its garrison — every spot nudged onto free floor so
  // the rounded ring cells never collide with the kit
  const at = (fx, fy, maxD) => {
    const s = map.nudge(fx, fy, (x, y) => Math.hypot(x - cx, y - cy) < maxD);
    if (!s) map.fail(`no summit spot near ${fx},${fy}`);
    return s;
  };
  map.addCore(cx, cy);
  map.addSpawn(cx - 2, cy - 2); map.addSpawn(cx + 2, cy - 2);
  map.addSpawn(cx - 2, cy + 2); map.addSpawn(cx + 2, cy + 2);
  map.addShop(cx + 4, cy);
  map.addCampfire(cx, cy - 3); map.addCampfire(cx, cy + 3);
  for (const [tx, ty] of [[cx - 12, cy - 12], [cx + 12, cy - 12], [cx - 12, cy + 12], [cx + 12, cy + 12], [cx, cy - 20], [cx, cy + 20]]) {
    const s = at(tx, ty, 23);
    map.addTower(s[0], s[1]);
  }
  const hires = HIRES_STD(['Fang Crag', 'Sage Alpenna', 'Wrench Col', 'Forgemaster Scree', 'Fletch Rime']);
  for (let i = 0; i < hires.length; i++) {
    const s = at(cx - 5 + i * 2, cy - 3, 6.8);
    map.addHire(s[0], s[1], hires[i]); // summit row
  }
  for (const [fx, fy] of [[cx + 10, cy + 2], [cx + 12, cy + 2], [cx + 10, cy + 4], [cx + 12, cy + 4]]) {
    const s = at(fx, fy, 15);
    map.addBuild(s[0], s[1], { kind: 'farm', cost: 6 }); // mid-terrace plots
  }
  for (const [tx, ty] of [[cx - 4, cy + 4], [cx + 4, cy + 4],
    [cx - 20, cy - 4], [cx + 20, cy - 4], [cx - 4, cy - 20], [cx + 4, cy + 20]]) {
    const s = at(tx, ty, 23);
    map.addBuild(s[0], s[1], { kind: 'turret', cost: 10 });
  }
  const st1 = at(cx - 10, cy - 6, 15);
  map.addVehicle(st1[0], st1[1], 'stag');
  const st2 = at(cx + 10, cy - 6, 15);
  map.addVehicle(st2[0], st2[1], 'stag');
  // loot + crystals
  const chestPlan = [
    [10, 10, 'shards', 11], [40, 8, 'medkit', 1], [94, 12, 'cracker', 2], [96, 46, 'shield', 1],
    [88, 68, 'shards', 12], [52, 70, 'medkit', 1], [14, 68, 'cracker', 2], [8, 40, 'shield', 1],
    [26, 24, 'toxin', 1], [78, 52, 'token', 1], [30, 56, 'controller', 1], [80, 24, 'shards', 10],
    [62, 10, 'token', 1],
  ];
  for (const [x, y, loot, amt] of chestPlan) map.addChest(x, y, loot, amt);
  for (const [x, y] of [[18, 22], [44, 10], [70, 8], [92, 28], [94, 58], [68, 68], [34, 68], [10, 52], [12, 28], [30, 40], [76, 40], [53, 8], [53, 70], [90, 40], [22, 50], [66, 60]]) {
    map.addCrystal(x, y);
  }
  placeLoose(map, 'pickup', 28, 14, 'railcannon');
  placeLoose(map, 'pickup', 80, 64, 'mortarMk2');
  // the besieging host on the slopes
  const far = awayFrom(cx, cy, 30);
  map.camp({ x: 14, y: 14, members: ['s', 's', 'r', 'a'], extra: far });
  map.camp({ x: 90, y: 14, members: ['x', 'x', 'v'], extra: far });
  map.camp({ x: 94, y: 52, members: ['n', 'a', 's'], extra: far });
  map.camp({ x: 78, y: 68, members: ['g', 'g', 'w', 'a', 'u'], extra: far });
  map.camp({ x: 28, y: 68, members: ['v', 'v', 'q'], extra: far });
  map.camp({ x: 10, y: 46, members: ['r', 'r', 's', 'z'], extra: far });
  map.camp({ x: 40, y: 8, members: ['n', 'a', 'g'], extra: far });
  map.camp({ x: 66, y: 70, members: ['q', 'z', 'z', 'w'], extra: far });
  map.sentry('m', 22, 32); map.sentry('m', 84, 44);
  map.sentry('x', 53, 12); map.sentry('v', 18, 60);
  // mountain pass mouths
  mouths(map, 'n', [30, 74]);
  mouths(map, 's', [36, 70]);
  mouths(map, 'w', [22, 56]);
  mouths(map, 'e', [24, 60]);
  map.validate({});
  map.paintShores();
  map.decorate((x, y, rnd) => {
    const d = Math.hypot(x - cx, y - cy);
    if (d > 26 && rnd() < 0.22) return '^'; // glaze ice on the slopes
    if (rnd() < 0.20) return ';';
    return null;
  });
  const table = waveTable({ level: 23, nights: 4, wavesPerNight: 2, bloodMoons: [4], dayLen: 100, nightLen: 90 });
  const def = assembleDef({
    level: 23, name: 'Atlas Rise', sizeLabel: 'XL', difficulty: 5,
    blurb: 'A mountainhold behind three concentric wall rings — L1, L2, L3 — under snow, ice and a patient siege.',
    newFeatures: ['Atlas joins the roster', 'Three concentric wall rings (L1/L2/L3)', 'Glaze-ice slopes'],
    objective: 'Hold the summit core behind three rings for four double-wave nights',
    intro: [slide('Atlas Rise', [
      'Three rings of wall climb the mountain; the gates never line up.',
      'Ice glazes the slopes — your boots and theirs slide alike.',
      'Atlas built this hold. Hold it, and Atlas marches with you.',
    ], 'siege')],
    outro: [slide('The Mountain Stands', [
      'Four dawns and the inner ring never broke.',
      'Atlas shoulders the gate beam back into place and nods.',
    ], 'dawn')],
    table, map,
    weather: 'snow',
    ambience: 'city',
  });
  report(def, map, writeDef(def, 'sh23.json'));
}

// ===========================================================================
// sh24 — NIGHT UNENDING (XL 108x78, seven long nights, void shards, comm quest)
// ===========================================================================
function genSh24() {
  const map = createMap({ w: 108, h: 78, seed: 20260724, name: 'sh24' });
  map.outline({ border: '%', min: 2, max: 8, harmonics: 5, bites: 4 });
  // the shattering: void cracks across the plain
  map.vein(8, 20, 50, 6, 2, '%', 0.5);
  map.vein(100, 24, 64, 50, 2, '%', 0.5);
  map.vein(20, 70, 44, 52, 2, '%', 0.5);
  for (const [vx, vy, vr] of [[26, 38, 2.6], [82, 12, 3.0], [92, 64, 2.8], [60, 66, 2.2]]) {
    map.disc(vx, vy, vr, '%');
  }
  // dead groves and a tarn
  for (let i = 0; i < 10; i++) map.blob(10 + map.rnd() * 88, 8 + map.rnd() * 62, 1.4 + map.rnd() * 2.2, 'T');
  map.disc(16, 14, 4, '~');
  // the last camp burning
  const F = { x0: 46, y0: 32, x1: 62, y1: 46 };
  map.fortRect({ ...F, gates: [[53, 32], [54, 32], [53, 46], [54, 46], [46, 39], [62, 39]], wallLevel: 2 });
  const { cx, cy } = baseKit(map, { ...F, hires: HIRES_STD(['Fang Vigil', 'Sage Ember', 'Wrench Doss', 'Forgemaster Hale', 'Fletch Sable']) });
  // the dead comm mast: rebuild it before the first dusk for the relief cache
  map.addBuild(cx, cy - 5, { kind: 'comm', cost: 25 });
  placeLoose(map, 'npc', cx - 4, cy - 3, {
    id: 'vex', name: 'Signaller Vex',
    lines: [
      'Seven nights, they said. The sun barely bothers anymore.',
      'Raise the comm mast and relief drops a cache. Raise it BEFORE dark.',
    ],
  });
  // a teleport pair stitches the shattered flanks together
  const tpA = stamp(map, 'O', 20, 22);
  const tpB = stamp(map, 'O', 88, 56);
  // loot + crystals (medkits run heavy — the nights are 130s long)
  const chestPlan = [
    [10, 10, 'medkit', 1], [38, 8, 'shards', 11], [96, 12, 'medkit', 1], [98, 44, 'cracker', 2],
    [90, 68, 'shards', 12], [54, 68, 'medkit', 1], [14, 68, 'shield', 1], [8, 42, 'medkit', 1],
    [30, 26, 'shield', 1], [76, 28, 'toxin', 1], [34, 56, 'token', 1], [78, 60, 'controller', 1],
    [62, 12, 'cracker', 2], [50, 22, 'shards', 9],
  ];
  for (const [x, y, loot, amt] of chestPlan) map.addChest(x, y, loot, amt);
  for (const [x, y] of [[20, 28], [44, 10], [70, 8], [94, 26], [96, 56], [72, 68], [36, 66], [10, 52], [12, 30], [32, 44], [76, 44], [54, 10], [54, 60], [92, 36], [24, 60], [66, 56], [40, 28], [84, 20]]) {
    map.addCrystal(x, y);
  }
  placeLoose(map, 'pickup', 30, 18, 'flamer');
  placeLoose(map, 'pickup', 78, 36, 'stormgun');
  placeLoose(map, 'pickup', 50, 64, 'railcannon');
  // everything the Entropy has, camped in the dark
  const far = awayFrom(cx, cy, 16);
  map.camp({ x: 16, y: 18, members: ['z', 'z', 'z', 'w', 'u'], extra: far });
  map.camp({ x: 46, y: 10, members: ['f', 'f', 'w', 'z'], extra: far });
  map.camp({ x: 88, y: 16, members: ['q', 'q', 'z', 'x'], extra: far });
  map.camp({ x: 96, y: 48, members: ['v', 'x', 'q', 'z'], extra: far });
  map.camp({ x: 80, y: 66, members: ['s', 'r', 'a', 'n'], extra: far });
  map.camp({ x: 30, y: 66, members: ['n', 'a', 'z'], extra: far });
  map.camp({ x: 10, y: 48, members: ['n', 'a', 'z'], extra: far });
  map.camp({ x: 64, y: 60, members: ['x', 'x', 'v', 'q'], extra: far });
  map.camp({ x: 36, y: 24, members: ['g', 'r', 'w', 'u'], extra: far });
  map.sentry('m', 26, 34); map.sentry('m', 80, 40); map.sentry('m', 54, 64);
  map.sentry('x', 40, 50); map.sentry('v', 68, 24);
  // mouths through the void rim
  mouths(map, 'n', [34, 76]);
  mouths(map, 's', [28, 80]);
  mouths(map, 'w', [26, 58]);
  mouths(map, 'e', [22, 62]);
  map.validate({ extraTargets: [[tpA[0], tpA[1], 'teleport A'], [tpB[0], tpB[1], 'teleport B']] });
  map.paintShores();
  map.decorate((x, y, rnd) => {
    if (rnd() < 0.45) return '_'; // ash plain
    if (rnd() < 0.12) return ':';
    return null;
  });
  const table = waveTable({ level: 24, nights: 7, bloodMoons: [4, 6, 7], dayLen: 60, nightLen: 130 });
  const def = assembleDef({
    level: 24, name: 'Night Unending', sizeLabel: 'XL', difficulty: 5,
    blurb: 'Seven nights that barely break. Void cracks split the ash plain, the days are short and the last three dusks rise blood.',
    newFeatures: ['Seven near-endless nights', 'Void-shattered ground', 'Comm-mast repair', 'A teleport pair'],
    objective: 'Raise the comm mast before dark, then outlast seven unending nights',
    intro: [slide('Night Unending', [
      'Sixty seconds of sun. A hundred thirty of everything else.',
      'The ground itself is torn — void you cannot cross, see through, or shoot through.',
      'Raise the mast before dark. Then hold. And hold. And hold.',
    ], 'campfire')],
    outro: [slide('The Long Dark Ends', [
      'The seventh dawn arrives like it owes you money.',
      'One more hold. One more light. FINALITY waits.',
    ], 'dawn')],
    table, map,
    weather: 'ashstorm',
    ambience: 'ash',
    quests: [{
      id: 'comm24', title: 'Raise the comm mast', giver: 'vex',
      kind: 'build', target: 'comm', count: 1, reward: { shards: 25 },
      hint: 'Rebuild the mast north of the core before the first dusk',
    }],
  });
  const tps = [tpA, tpB].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  def.teleports = tps.map((t, i) => ({ id: 't24' + (i ? 'b' : 'a'), twin: 't24' + (i ? 'a' : 'b') }));
  report(def, map, writeDef(def, 'sh24.json'));
}

// ===========================================================================
// sh25 — FINALITY (XL 110x80, every terrain, 4 beacons, 3 bosses, 24 waves)
// ===========================================================================
function genSh25() {
  const map = createMap({ w: 110, h: 80, seed: 20260725, name: 'sh25' });
  map.outline({ border: '#', min: 2, max: 6, harmonics: 5, bites: 3 });
  // EVERY terrain on one field — the frontier's last collage:
  // NW taiga + ice sheet
  for (let i = 0; i < 12; i++) map.blob(8 + map.rnd() * 34, 6 + map.rnd() * 22, 1.6 + map.rnd() * 2.4, 'T');
  map.disc(18, 20, 5.5, '^');
  // NE the last lake, its hoard isle ringed in deep water
  map.disc(86, 16, 8.5, '~');
  map.disc(86, 16, 2.0, '.');
  // W marsh
  map.blob(12, 44, 3.2, '~', 0.85);
  map.blob(18, 52, 2.6, '~', 0.85);
  // SW lava country
  map.disc(20, 68, 3.4, '!');
  map.vein(20, 68, 44, 60, 3, '!', 0.4);
  map.vein(20, 68, 8, 58, 2, '!', 0.4);
  // SE void shards
  for (const [vx, vy, vr] of [[88, 62, 3.2], [96, 52, 2.4], [78, 70, 2.6]]) map.disc(vx, vy, vr, '%');
  map.vein(88, 62, 70, 52, 2, '%', 0.45);
  // S sand sea is painted in decorate(); stone heart under the bastion
  // THE LAST BASTION RISEN: L3 walls around the grand fort
  const F = { x0: 46, y0: 34, x1: 64, y1: 48 };
  map.fortRect({ ...F, gates: [[54, 34], [55, 34], [54, 48], [55, 48], [46, 41], [64, 41]], wallLevel: 3 });
  const { cx, cy } = baseKit(map, {
    ...F, core: false,
    hires: HIRES_STD(['Fang Last', 'Sage Aurel', 'Wrench Omega', 'Forgemaster Ende', 'Fletch Coda']),
  });
  map.addCampfire(cx, cy); // the hearth at the center of everything
  // two extra turret sites on the inner yard
  map.addBuild(cx + 5, cy - 3, { kind: 'turret', cost: 10 });
  map.addBuild(cx - 5, cy + 3, { kind: 'turret', cost: 10 });
  // FOUR anchor monoliths in satellite forts — the night splits between them
  beaconFort(map, 28, 22, { gates: [[31, 22], [28, 25]], wallLevel: 3, tesla: true });
  beaconFort(map, 82, 30, { gates: [[79, 30], [82, 33]], wallLevel: 3, tesla: true });
  beaconFort(map, 30, 60, { gates: [[33, 60], [30, 57]], wallLevel: 3, tesla: true });
  beaconFort(map, 78, 56, { gates: [[75, 56], [78, 53]], wallLevel: 3, tesla: true });
  // sandbag cover on the gate lanes
  for (const [ox, oy] of [[51, 30], [58, 30], [51, 52], [58, 52], [42, 38], [42, 44], [68, 38], [68, 44]]) {
    if (map.get(ox, oy) === '.') map.set(ox, oy, 'o');
  }
  // a teleport pair stitches west marsh to east shard country
  const tpA = stamp(map, 'O', 14, 32);
  const tpB = stamp(map, 'O', 96, 42);
  // the skiff and the lake hoard
  const dock = map.nudge(86, 26, (x, y) =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => map.get(x + ox, y + oy) === '~'));
  if (!dock) map.fail('no skiff dock at the last lake');
  map.addVehicle(dock[0], dock[1], 'skiff');
  const isleChests = [
    map.addChest(85, 16, 'token', 1, { exact: true, tag: 'isle' }),
    map.addChest(87, 16, 'controller', 1, { exact: true, tag: 'isle' }),
    map.addChest(86, 17, 'shards', 16, { exact: true, tag: 'isle' }),
  ];
  // loot + crystals — the long war chest
  const chestPlan = [
    [8, 8, 'shards', 12], [36, 8, 'medkit', 1], [64, 8, 'cracker', 2], [102, 10, 'medkit', 1],
    [102, 38, 'shield', 1], [98, 70, 'shards', 13], [60, 72, 'medkit', 1], [28, 72, 'cracker', 2],
    [6, 70, 'shield', 1], [6, 36, 'medkit', 1], [38, 24, 'toxin', 1], [70, 24, 'shield', 1],
    [36, 52, 'token', 1], [72, 64, 'shards', 11], [50, 62, 'medkit', 1], [24, 36, 'cracker', 2],
  ];
  for (const [x, y, loot, amt] of chestPlan) map.addChest(x, y, loot, amt);
  for (const [x, y] of [[14, 12], [40, 12], [66, 12], [98, 22], [100, 50], [84, 72], [46, 70], [14, 64], [8, 26], [30, 32], [74, 38], [55, 24], [55, 58], [94, 32], [26, 48], [64, 60], [44, 16], [88, 44], [16, 56], [60, 28]]) {
    map.addCrystal(x, y);
  }
  placeLoose(map, 'pickup', 30, 16, 'flamer');
  placeLoose(map, 'pickup', 96, 26, 'railcannon');
  placeLoose(map, 'pickup', 24, 64, 'stormgun');
  placeLoose(map, 'pickup', 84, 66, 'mortarMk2');
  // the final host — every kind the Entropy ever fielded
  const far = awayFrom(cx, cy, 17);
  map.camp({ x: 12, y: 14, members: ['x', 'x', 'v', 'q'], extra: far });
  map.camp({ x: 44, y: 8, members: ['q', 'q', 'z', 'z', 'w'], extra: far });
  map.camp({ x: 70, y: 10, members: ['s', 's', 'r', 'n'], extra: far });
  map.camp({ x: 100, y: 18, members: ['v', 'v', 'x'], extra: far });
  map.camp({ x: 100, y: 56, members: ['u', 'u', 'u', 'w'], extra: far });
  map.camp({ x: 84, y: 70, members: ['f', 'f', 'z', 'w'], extra: far });
  map.camp({ x: 52, y: 68, members: ['n', 'a', 's'], extra: far });
  map.camp({ x: 20, y: 72, members: ['n', 'a', 's'], extra: far });
  map.camp({ x: 8, y: 50, members: ['g', 'g', 'w', 'a', 'u'], extra: far });
  map.camp({ x: 36, y: 18, members: ['r', 'r', 's', 'z'], extra: far });
  map.camp({ x: 68, y: 62, members: ['q', 'x', 'z', 'w'], extra: far });
  map.sentry('m', 30, 40); map.sentry('m', 76, 44); map.sentry('m', 55, 18);
  map.sentry('x', 40, 60); map.sentry('v', 70, 18); map.sentry('x', 14, 40);
  // every edge opens — the end comes from everywhere
  mouths(map, 'n', [24, 55, 92]);
  mouths(map, 's', [36, 66, 94]);
  mouths(map, 'w', [22, 46, 66]);
  mouths(map, 'e', [24, 48, 64]);
  map.validate({
    extraTargets: [[tpA[0], tpA[1], 'teleport A'], [tpB[0], tpB[1], 'teleport B']],
    mustNotReach: isleChests.map(s => [s[0], s[1], 'the last hoard']),
  });
  map.validateSkiff(dock, isleChests.map(s => [s[0], s[1], 'the last hoard']));
  map.paintShores();
  map.decorate((x, y, rnd) => {
    if (y > 62 && x > 30 && x < 76 && rnd() < 0.55) return '='; // the south sand sea
    if (x < 36 && y < 30 && rnd() < 0.30) return ','; // taiga floor
    if (x < 26 && y > 36 && y < 58 && rnd() < 0.45) return ':'; // west marsh muck
    if (x > 64 && y > 48 && rnd() < 0.35) return '_'; // shard-country ash
    if (rnd() < 0.10) return ';';
    return null;
  });
  // BEATABILITY RETUNE (verify wave): the arc values (waveMult 2.6 /
  // hpMult 1.8 / 10 nights / 5 moons) were unwinnable in 9 expert scripted
  // attempts; waveMult 1.8 / hpMult 1.5 proved hard-but-beatable. WAVE CAP
  // LAW (polish wave): every stronghold fits a {3,5,7,10} budget — FINALITY
  // is the 10: four DENSE nights at two waves each, a blood-moon finale
  // (4 + 1 moon, x2 = 10 truthful waves), all three Entropy bosses intact
  // on nights 2/3/4, and its four beacon forts still ship armed (L3 walls,
  // prebuilt tesla) so the hold is a fight, not an economy bootstrap.
  const table = waveTable({ level: 25, nights: 4, wavesPerNight: 2, bloodMoons: [4], dayLen: 110, nightLen: 95, hpMult: 1.5, waveMult: 1.8 });
  table.bastion.bossNights = [2, 3, 4]; // three Entropy bosses, every night after the first
  const def = assembleDef({
    level: 25, name: 'FINALITY', sizeLabel: 'XL', difficulty: 5,
    blurb: 'Every terrain. Every horror. Ten dense waves over four nights, a blood-moon finale, and three Entropy bosses. The end of the arc.',
    newFeatures: ['Three Entropy bosses (nights 2, 3, 4)', 'Every terrain on one field', 'The Anchorcraft descends for the worthy'],
    objective: 'Keep an anchor lit through four dense nights — or light all four under a night sky and board the Anchorcraft',
    intro: [slide('FINALITY', [
      'Every biome the frontier ever grew, stitched into one battlefield.',
      'A blood-moon finale. Three Entropy warlords — every night after the first.',
      'All four anchors lit in the dark, and the Anchorcraft itself descends.',
    ], 'anchorcraft')],
    outro: [slide('Anchorfall, Answered', [
      'The last dawn finds four monoliths and the people who kept them.',
      'The Anchorcraft rises with every name aboard.',
      'The frontier holds. It always held — because you did.',
    ], 'anchorcraft')],
    table, map,
    bastionVariant: 'beacons',
    ambience: 'ship',
  });
  const tps = [tpA, tpB].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  def.teleports = tps.map((t, i) => ({ id: 't25' + (i ? 'b' : 'a'), twin: 't25' + (i ? 'a' : 'b') }));
  report(def, map, writeDef(def, 'sh25.json'));
}

// ---------------------------------------------------------------------------
const only = process.argv[2]; // `node gen-sh18-25.mjs 21` regenerates one level
const gens = { 18: genSh18, 19: genSh19, 20: genSh20, 21: genSh21, 22: genSh22, 23: genSh23, 24: genSh24, 25: genSh25 };
for (const [lvl, fn] of Object.entries(gens)) {
  if (only && only !== lvl) continue;
  fn();
}
