// Generates levels/stronghold/sh04.json — "Cinder Gate" (stronghold 4).
// Deterministic (seed 20260704). An 84x62 M-size volcanic pass: LAVA DEBUT
// ('!' sears 1 hp/0.8s, enemies path AROUND it), ash flats, basalt outcrops —
// and TOXIC AIR for the first 120s (0.5 hp/4s unmasked): three marked mask
// chests sit on the apron and the shop stocks masks. Equip before the waves.
// Unlock: PYRO. Six nights, blood moons on the fourth and sixth.
import { createMap, waveTable, assembleDef, writeDef, report } from './framework.mjs';

const W = 84, H = 62, LEVEL = 4;
const m = createMap({ w: W, h: H, seed: 20260704, name: 'sh04' });

// --- silhouette: basalt rim with lava welling along the band ---
m.outline({ border: '#', min: 2, max: 6, harmonics: 4, bites: 2 });
for (let i = 0; i < 10; i++) {
  const side = i % 4;
  const x = side < 2 ? 6 + m.rnd() * 72 : side === 2 ? 3 + m.rnd() * 4 : 77 + m.rnd() * 4;
  const y = side === 0 ? 3 + m.rnd() * 4 : side === 1 ? 55 + m.rnd() * 4 : 6 + m.rnd() * 50;
  m.blob(x, y, 2 + m.rnd() * 2.5, '!', 0.9);
}
m.edgeRing('.');

// --- terrain: two lava veins cross the pass, ash flats, outcrops ---
m.vein(60, 2, 56, 59, 3, '!');          // the east flow, north to south
m.vein(2, 13, 30, 17, 2.5, '!');        // the west flow, toward the pass
for (const [px, py] of [[16, 40], [70, 44], [24, 8]]) m.disc(px, py, 1.6 + m.rnd() * 1.2, '!');
for (let i = 0; i < 14; i++) m.blob(6 + m.rnd() * 72, 5 + m.rnd() * 52, 3 + m.rnd() * 3.5, '_', 0.85);
for (let i = 0; i < 8; i++) m.blob(8 + m.rnd() * 68, 6 + m.rnd() * 50, 1.4 + m.rnd() * 1.8, '#', 0.8);
for (const [ox, oy] of [[20, 24], [64, 20], [18, 52], [66, 54], [30, 44]]) {
  if (m.get(ox, oy) === '.' || m.get(ox, oy) === '_') m.set(ox, oy, 'o');
}

// --- the gate: fortified walls, six gates ---
m.fortRect({
  x0: 36, y0: 26, x1: 50, y1: 36, floor: ';', apron: 2,
  gates: [[42, 26], [43, 26], [42, 36], [43, 36], [36, 31], [50, 31]],
});
m.addCore(43, 31);
for (const [x, y] of [[40, 29], [46, 29], [40, 33], [46, 33]]) m.addSpawn(x, y);
for (const [x, y] of [[38, 28], [48, 28], [38, 34], [48, 34]]) m.addTower(x, y);
m.addShop(45, 31); // stocks breather masks while the air is bad
m.addCampfire(43, 29); m.addCampfire(43, 33);
m.addHire(39, 30, { job: 'engineer', cost: 10, name: 'Vent-Rigger Aulo' });
m.addHire(39, 32, { job: 'smith', cost: 12, name: 'Cinderwright Voss' });
for (const [x, y] of [[41, 27], [45, 27], [41, 35], [45, 35]]) m.addBuild(x, y, { kind: 'turret', cost: 10 });
m.addBuild(47, 30, { kind: 'farm', cost: 6 }); m.addBuild(47, 32, { kind: 'farm', cost: 6 });
m.addVehicle(41, 31, 'stag');

// --- approach lanes: basalt causeways (carve cuts the lava veins) ---
m.carve(42, 2, 42, 23, 2);
m.carve(42, 39, 42, 59, 2);
m.carve(2, 30, 33, 30, 2);
m.carve(53, 30, 81, 30, 2);

// --- mask chests on the apron — grab them before the first dusk ---
m.addChest(34, 24, 'mask', 1);
m.addChest(52, 24, 'mask', 1);
m.addChest(34, 38, 'mask', 1);

// --- camps and sentries ---
const farBase = (x, y) => x < 32 || x > 54 || y < 22 || y > 40;
m.camp({ x: 16, y: 12, members: ['u', 'u', 'g', 'w'], extra: farBase });     // pyre beetle nest
m.camp({ x: 66, y: 12, members: ['g', 'g', 'a', 'w'], extra: farBase });
m.camp({ x: 14, y: 48, members: ['n', 'a', 'g', 'g'], extra: farBase });     // sniper nest
m.camp({ x: 66, y: 48, members: ['z', 'z', 'z', 'z', 'w'], extra: farBase }); // husk pack
m.camp({ x: 12, y: 31, members: ['r', 'r', 'w'], extra: farBase });
m.camp({ x: 70, y: 31, members: ['u', 'g', 'a'], extra: farBase });
m.sentry('u', 43, 10);
m.sentry('g', 43, 52);
m.sentry('w', 8, 16);

// --- loot, lyth, and one flamer cache for the pyro-minded ---
const fl = m.nudge(20, 48);
if (!fl) m.fail('no flamer cache spot');
m.addPickup(fl[0], fl[1], 'flamer');
m.addChest(8, 6, 'shards', 8);
m.addChest(74, 6, 'medkit', 1);
m.addChest(8, 54, 'cracker', 2);
m.addChest(74, 54, 'shards', 10);
m.addChest(26, 18, 'shield', 1);
m.addChest(58, 18, 'token', 1);
m.addChest(26, 44, 'medkit', 1);
m.addChest(58, 44, 'shield', 1);
for (const [x, y] of [[42, 12], [42, 50], [14, 30], [70, 30], [24, 22], [60, 22], [24, 40], [60, 40], [34, 6], [52, 56], [10, 42]]) m.addCrystal(x, y);

// --- proofs ---
m.validate({});

// --- decoration: ash drifts on the bare ground ---
m.decorate((x, y, rnd) => (rnd() < 0.3 ? '_' : rnd() < 0.08 ? ':' : null));

const table = waveTable({ level: LEVEL, nights: 6, bloodMoons: [4, 6] });
const def = assembleDef({
  level: LEVEL,
  name: 'Cinder Gate',
  sizeLabel: 'M',
  difficulty: 2,
  blurb: 'A pass between live lava flows, under air that bites. Mask up, mind the veins, hold six nights.',
  newFeatures: ['Lava veins — never wade them', 'Toxic air: equip masks fast', 'Pyre Beetle nests'],
  objective: 'Mask up before the air clears, then hold Cinder Gate through six nights',
  intro: [{
    title: 'Cinder Gate',
    lines: [
      'The caldera vents opened with the last quake. For now the air itself is poison — masks first, heroics second.',
      'Lava sears anything that wades it. The Entropy paths around the flows; learn the causeways better than they do.',
      'Three mask chests sit on the apron and the stall stocks more. Equip before the first waves.',
    ],
    art: 'siege',
  }],
  outro: [{
    title: 'The Vents Close',
    lines: [
      'Six dawns, and the air runs clean again over Cinder Gate.',
      'The flows keep rolling south — past a fort that would not melt.',
    ],
    art: 'dawn',
  }],
  table,
  map: m,
  ambience: 'lava',
  modifiers: { toxicAir: { until: 120 } },
});
const out = writeDef(def, 'sh04.json');
report(def, m, out);
