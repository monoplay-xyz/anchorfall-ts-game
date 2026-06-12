// Generates levels/stronghold/sh02.json — "Dust Perimeter" (stronghold 2).
// Deterministic (seed 20260702). A 70x52 S-size desert: SAND DEBUT ('=' dunes
// slow everyone to x0.85), a mesa-rimmed organic silhouette (no wall-box), a
// fortified sand-road fort (prebuilt wall segments, six gate gaps), and the
// ALIVE-WORLD debut: patrolling camps with group ids and sniper spotters.
// Unlock: SNIPER. Five nights, blood moon on the fourth.
import { createMap, waveTable, assembleDef, writeDef, report } from './framework.mjs';

const W = 70, H = 52, LEVEL = 2;
const m = createMap({ w: W, h: H, seed: 20260702, name: 'sh02' });

// --- silhouette: wobbling mesa rim, three bites, wave-entry ring ---
m.outline({ border: '#', min: 2, max: 7, harmonics: 4, bites: 3 });
m.edgeRing('.');

// --- terrain: dune fields, mesa outcrops, scrub ---
for (let i = 0; i < 14; i++) m.blob(6 + m.rnd() * 58, 5 + m.rnd() * 42, 3 + m.rnd() * 3.2, '=', 0.85);
for (let i = 0; i < 8; i++) m.blob(8 + m.rnd() * 54, 6 + m.rnd() * 40, 1.4 + m.rnd() * 1.8, '#', 0.8);
for (const [ox, oy] of [[18, 18], [52, 16], [16, 36], [54, 36], [26, 44], [44, 8]]) {
  if (m.get(ox, oy) === '.' || m.get(ox, oy) === '=') m.set(ox, oy, 'o');
}

// --- the fort: fortified walls, six gates (N/S double, W/E single) ---
m.fortRect({
  x0: 28, y0: 21, x1: 42, y1: 31, floor: ';', apron: 2,
  gates: [[34, 21], [35, 21], [34, 31], [35, 31], [28, 26], [42, 26]],
});
m.addCore(35, 26);
for (const [x, y] of [[33, 24], [37, 24], [33, 28], [37, 28]]) m.addSpawn(x, y);
for (const [x, y] of [[30, 23], [40, 23], [30, 29], [40, 29]]) m.addTower(x, y);
m.addShop(38, 26);
m.addCampfire(35, 24); m.addCampfire(35, 28);
m.addHire(31, 25, { job: 'farmer', cost: 8, name: 'Dunewife Sera' });
m.addHire(31, 27, { job: 'engineer', cost: 10, name: 'Rigger Tolm' });
for (const [x, y] of [[33, 22], [37, 22], [33, 30], [37, 30]]) m.addBuild(x, y, { kind: 'turret', cost: 10 });
m.addBuild(39, 24, { kind: 'farm', cost: 6 }); m.addBuild(39, 28, { kind: 'farm', cost: 6 });
m.addVehicle(36, 27, 'stag');

// --- approach lanes: ring to gates through the dunes ---
m.carve(34, 2, 34, 18, 2);
m.carve(34, 34, 34, 49, 2);
m.carve(2, 25, 25, 25, 2);
m.carve(45, 25, 67, 25, 2);

// --- camps (group alert + patrols) and lone sentries, all off the apron ---
const farBase = (x, y) => x < 24 || x > 46 || y < 17 || y > 35;
m.camp({ x: 13, y: 11, members: ['g', 'g', 'w', 'w'], extra: farBase });
m.camp({ x: 55, y: 11, members: ['n', 'g', 'g', 'w'], extra: farBase }); // sniper spotter camp
m.camp({ x: 14, y: 41, members: ['n', 'a', 'g', 'g'], extra: farBase }); // sniper spotter camp
m.camp({ x: 55, y: 41, members: ['a', 'g', 'r', 'w'], extra: farBase });
m.camp({ x: 60, y: 26, members: ['r', 'g', 'w'], extra: farBase });
m.camp({ x: 9, y: 28, members: ['s', 'g', 'a'], extra: farBase });
m.sentry('w', 35, 7);
m.sentry('g', 35, 45);
m.sentry('s', 64, 20, { patrol: false });

// --- loot and lyth ---
m.addChest(8, 6, 'shards', 8);
m.addChest(62, 6, 'medkit', 1);
m.addChest(6, 46, 'cracker', 2);
m.addChest(63, 46, 'shards', 9);
m.addChest(20, 22, 'shield', 1);
m.addChest(50, 22, 'token', 1);
m.addChest(35, 12, 'medkit', 1);
m.addChest(35, 40, 'shield', 1);
m.addChest(25, 8, 'controller', 1);
for (const [x, y] of [[34, 10], [34, 44], [12, 25], [58, 25], [20, 15], [50, 15], [20, 38], [50, 38], [28, 6], [44, 46]]) m.addCrystal(x, y);

// --- proofs (carve-repairs anything the mesas strand) ---
m.validate({});

// --- decoration: dry pans on the bare flats ---
m.decorate((x, y, rnd) => (rnd() < 0.14 ? ':' : null));

const table = waveTable({ level: LEVEL, nights: 5, bloodMoons: [4] });
const def = assembleDef({
  level: LEVEL,
  name: 'Dust Perimeter',
  sizeLabel: 'S',
  difficulty: 1,
  blurb: 'Dunes, mesas and patrol camps around a sand-road fort. Everything moves slow in the sand — including you.',
  newFeatures: ['Sand dunes slow the stride', 'Camps patrol the wastes', 'Sniper spotters call targets'],
  objective: 'Hold Dust Perimeter through five nights — the core must stand at the fifth dawn',
  intro: [{
    title: 'Dust Perimeter',
    lines: [
      'A supply fort on the dune road, five nights from relief — and the Entropy knows it.',
      'Sand slows every stride. Camps patrol the wastes, and their snipers call targets: kill the spotter first.',
      'The walls stand prebuilt. Repair them by day; never leave a gate open at dusk.',
    ],
    art: 'siege',
  }],
  outro: [{
    title: 'The Dune Road Holds',
    lines: [
      'Five dawns of grit and the fort still answers.',
      'The dune road is open — and the frontier remembers who kept it so.',
    ],
    art: 'dawn',
  }],
  table,
  map: m,
  ambience: 'ash',
});
const out = writeDef(def, 'sh02.json');
report(def, m, out);
