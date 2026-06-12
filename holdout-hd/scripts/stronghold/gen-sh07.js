// Generates levels/stronghold/sh07.json — "Two Rivers" (stronghold 7).
// Deterministic (seed 20260707). A 96x70 L-size river country under RAIN, on
// an island in an open sea (the border is WATER — skiff-flankable): two
// rivers quarter the land, meeting in a confluence lake with a skiff-only
// island hoard. BEACON DEFENSE: four monolith redoubts, one per bank, with
// the fords as chokepoints. Two skiffs and a stag are stabled.
// Unlock: none (feature debut level). Seven nights, blood moons 3/5/7.
import { createMap, waveTable, assembleDef, writeDef, report } from './framework.mjs';

const W = 96, H = 70, LEVEL = 7;
const m = createMap({ w: W, h: H, seed: 20260707, name: 'sh07' });

// --- silhouette: an island continent in open water, two lagoon bites ---
m.outline({ border: '~', min: 2, max: 7, harmonics: 5, bites: 2 });
m.edgeRing('.');

// --- the two rivers and the confluence lake ---
m.vein(48, 2, 48, 67, 3, '~');   // the Longwater, north to south
m.vein(2, 36, 93, 36, 3, '~');   // the Graywash, west to east
m.disc(48, 36, 6.5, '~');        // the confluence lake
m.disc(48, 36, 2.3, '.');        // the island
// fords: one per river arm, carved as gravel shallows
m.carve(43, 17, 53, 17, 2, ':');
m.carve(43, 55, 53, 55, 2, ':');
m.carve(22, 31, 22, 41, 2, ':');
m.carve(74, 31, 74, 41, 2, ':');
// woods on every bank
for (let i = 0; i < 14; i++) m.blob(8 + m.rnd() * 80, 6 + m.rnd() * 58, 1.5 + m.rnd() * 2.2, 'T', 0.8);

// --- four beacon redoubts, one per quadrant ---
const redoubts = [
  { cx: 14, cy: 12, gates: [[18, 12], [14, 16]] }, // NW
  { cx: 76, cy: 14, gates: [[72, 14], [76, 18]] }, // NE
  { cx: 20, cy: 56, gates: [[24, 56], [20, 52]] }, // SW
  { cx: 76, cy: 54, gates: [[72, 54], [76, 50]] }, // SE
];
for (const r of redoubts) {
  m.fortDiamond({ cx: r.cx, cy: r.cy, r: 4, floor: ';', apron: 2, gates: r.gates });
  m.addCore(r.cx, r.cy);
  m.addBuild(r.cx, r.cy - 2, { kind: 'turret', cost: 10 });
  m.addCampfire(r.cx, r.cy + 2);
}

// --- the supply fort on the northwest bank of the confluence ---
m.fortRect({
  x0: 26, y0: 18, x1: 38, y1: 28, floor: ';', apron: 2,
  gates: [[31, 18], [32, 18], [31, 28], [32, 28], [26, 23], [38, 23]],
});
for (const [x, y] of [[29, 21], [35, 21], [29, 25], [35, 25]]) m.addSpawn(x, y);
for (const [x, y] of [[28, 20], [36, 20], [28, 26], [36, 26]]) m.addTower(x, y);
m.addShop(33, 23);
m.addCampfire(32, 21);
m.addHire(28, 22, { job: 'farmer', cost: 8, name: 'Banks-Sage Ferro' });
m.addHire(28, 24, { job: 'engineer', cost: 10, name: 'Weir-Wright Salla' });
for (const [x, y] of [[30, 19], [34, 19], [30, 27], [34, 27]]) m.addBuild(x, y, { kind: 'turret', cost: 10 });
m.addBuild(36, 22, { kind: 'farm', cost: 6 }); m.addBuild(36, 24, { kind: 'farm', cost: 6 });
m.addVehicle(31, 24, 'stag');
// two ford towers — crewed guns over the chokepoints
m.addTower(24, 33);
m.addTower(72, 42);

// --- lanes: ring to the quadrant road net through the sea band ---
m.carve(31, 2, 31, 15, 2);
m.carve(2, 23, 23, 23, 2);
m.carve(20, 60, 20, 66, 2);
m.carve(86, 44, 92, 44, 2);
m.carve(76, 60, 76, 66, 2);
m.carve(60, 2, 60, 10, 2);

// --- the skiffs: one moored at the lake, one on the south Graywash bank ---
const lakeDock = m.nudge(40, 31, (x, y) =>
  [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => m.get(x + dx, y + dy) === '~'));
if (!lakeDock) m.fail('no lake skiff dock');
m.addVehicle(lakeDock[0], lakeDock[1], 'skiff');
const southDock = m.nudge(60, 42, (x, y) =>
  [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => m.get(x + dx, y + dy) === '~'));
if (!southDock) m.fail('no south skiff dock');
m.addVehicle(southDock[0], southDock[1], 'skiff');

// --- the island hoard (skiff-only, proven below) ---
const isleChests = [
  m.addChest(47, 35, 'token', 1, { exact: true, tag: 'isle' }),
  m.addChest(49, 35, 'shards', 12, { exact: true, tag: 'isle' }),
  m.addChest(48, 37, 'shield', 1, { exact: true, tag: 'isle' }),
];

// --- camps and sentries across the four banks ---
const farKeeps = (x, y) =>
  redoubts.every(r => Math.abs(x - r.cx) + Math.abs(y - r.cy) > 8)
  && (x < 22 || x > 42 || y < 14 || y > 32);
m.camp({ x: 62, y: 10, members: ['g', 'g', 'w', 'a'], extra: farKeeps });
m.camp({ x: 86, y: 26, members: ['r', 'r', 'g'], extra: farKeeps });
m.camp({ x: 10, y: 44, members: ['n', 'a', 'g', 'g'], extra: farKeeps }); // sniper nest at the W ford road
m.camp({ x: 38, y: 60, members: ['z', 'z', 'z', 'w'], extra: farKeeps });
m.camp({ x: 60, y: 62, members: ['s', 'g', 'a'], extra: farKeeps });
m.camp({ x: 86, y: 60, members: ['g', 'g', 'w', 'w'], extra: farKeeps });
m.camp({ x: 64, y: 24, members: ['n', 'g', 'w'], extra: farKeeps });     // sniper nest on the NE bank
m.sentry('w', 10, 28);
m.sentry('g', 52, 8);
m.sentry('r', 40, 48);

// --- loot and lyth ---
m.addChest(8, 8, 'shards', 8);
m.addChest(88, 8, 'medkit', 1);
m.addChest(8, 62, 'cracker', 2);
m.addChest(88, 64, 'shards', 10);
m.addChest(40, 8, 'shield', 1);
m.addChest(68, 30, 'token', 1);
m.addChest(30, 44, 'medkit', 1);
m.addChest(60, 50, 'shield', 1);
m.addChest(14, 32, 'cracker', 2);
m.addChest(82, 36, 'shards', 9);
m.addChest(52, 64, 'controller', 1);
for (const [x, y] of [[31, 8], [60, 14], [12, 23], [86, 33], [30, 33], [66, 38], [30, 52], [66, 58], [44, 62], [52, 22], [8, 54], [88, 20]]) m.addCrystal(x, y);

// --- proofs: walk net + skiff net + the hoard stays an island ---
m.validate({ mustNotReach: isleChests.map(([x, y]) => [x, y, 'island chest']) });
m.validateSkiff(lakeDock, isleChests.map(([x, y]) => [x, y, 'island chest']));
m.paintShores(':');

// --- decoration: bank grass ---
m.decorate((x, y, rnd) => (rnd() < 0.35 ? ',' : null));

const table = waveTable({ level: LEVEL, nights: 7, bloodMoons: [3, 5, 7] });
const def = assembleDef({
  level: LEVEL,
  name: 'Two Rivers',
  sizeLabel: 'L',
  difficulty: 3,
  blurb: 'Two rivers quarter the land and a beacon burns on every bank. Hold the fords — or flank by skiff.',
  newFeatures: ['Hold the fords — four banks, four beacons', 'Skiff flanking on open water', 'Island hoard in the confluence'],
  objective: 'Keep at least one beacon lit through seven rain-soaked nights — the fords decide everything',
  intro: [{
    title: 'Two Rivers',
    lines: [
      'The Longwater meets the Graywash here, and a beacon burns on every bank. The waves must cross somewhere.',
      'The fords are your chokepoints — tower them, wall them, hold them. Or take a skiff and own the water outright.',
      'Rain all week: ground fire dies fast. The confluence island hides a hoard only a skiff can reach.',
    ],
    art: 'siege',
  }],
  outro: [{
    title: 'The Confluence Holds',
    lines: [
      'Seven nights of rain, and light still stands on every bank that mattered.',
      'The rivers run dark and quiet. Downstream, somebody owes you a bridge.',
    ],
    art: 'dawn',
  }],
  table,
  map: m,
  bastionVariant: 'beacons',
  weather: 'rain',
  ambience: 'forest',
});
const out = writeDef(def, 'sh07.json');
report(def, m, out);
