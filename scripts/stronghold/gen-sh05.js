// Generates levels/stronghold/sh05.json — "The Four Lights" (stronghold 5).
// Deterministic (seed 20260705). An 84x62 M-size meadow vale and the FIRST
// BEACON-DEFENSE map (def.bastionVariant 'beacons'): FOUR lit monoliths in
// diamond redoubts around a central supply fort. A dark beacon is relit by
// day (act-hold + 8 shards); lose only if all four go dark at once; all four
// lit at night (from night 2) lands the Anchorcraft for an early extraction.
// Unlock: ENGINEER. Four nights, blood moon on the third (budget: 5 waves).
import { createMap, waveTable, assembleDef, writeDef, report } from './framework.mjs';

const W = 84, H = 62, LEVEL = 5;
const m = createMap({ w: W, h: H, seed: 20260705, name: 'sh05' });

// --- silhouette: forest vale, three bites ---
m.outline({ border: 'T', min: 2, max: 7, harmonics: 5, bites: 3 });
m.edgeRing('.');

// --- terrain: tree clumps and a south stream with two fords ---
m.vein(2, 48, 81, 52, 2.5, '~');
for (let i = 0; i < 12; i++) m.blob(8 + m.rnd() * 68, 6 + m.rnd() * 48, 1.5 + m.rnd() * 2.2, 'T', 0.8);
m.carve(20, 44, 20, 56, 2, ':');  // west ford
m.carve(62, 44, 62, 56, 2, ':');  // east ford

// --- four beacon redoubts (diamond walls, two gate gaps each, K inside) ---
const redoubts = [
  { cx: 22, cy: 16, gates: [[26, 16], [22, 20]] }, // NW: east + south tips
  { cx: 62, cy: 16, gates: [[58, 16], [62, 20]] }, // NE: west + south tips
  { cx: 22, cy: 42, gates: [[26, 42], [22, 38]] }, // SW: east + north tips
  { cx: 62, cy: 42, gates: [[58, 42], [62, 38]] }, // SE: west + north tips
];
for (const r of redoubts) {
  m.fortDiamond({ cx: r.cx, cy: r.cy, r: 4, floor: ';', apron: 2, gates: r.gates });
  m.addCore(r.cx, r.cy);
  m.addBuild(r.cx, r.cy - 2, { kind: 'turret', cost: 10 });
  m.addCampfire(r.cx, r.cy + 2);
}

// --- the central supply fort (no core of its own — the lights are the goal) ---
m.fortRect({
  x0: 37, y0: 26, x1: 47, y1: 36, floor: ';', apron: 2,
  gates: [[42, 26], [42, 36], [37, 31], [47, 31]],
});
for (const [x, y] of [[40, 29], [44, 29], [40, 33], [44, 33]]) m.addSpawn(x, y);
m.addShop(42, 32);
m.addCampfire(42, 30);
m.addHire(39, 31, { job: 'farmer', cost: 8, name: 'Vale-Sage Onna' });
m.addHire(45, 31, { job: 'engineer', cost: 10, name: 'Lampkeep Duro' });
m.addBuild(42, 28, { kind: 'turret', cost: 10 });
m.addBuild(42, 34, { kind: 'turret', cost: 10 });
m.addBuild(40, 35, { kind: 'farm', cost: 6 }); m.addBuild(44, 35, { kind: 'farm', cost: 6 });
m.addVehicle(43, 30, 'stag');
// watchtowers on the diagonals between fort and redoubts
for (const [x, y] of [[32, 22], [52, 22], [32, 40], [52, 40]]) m.addTower(x, y);

// --- lanes: ring to the fort, threading between the redoubts ---
m.carve(42, 2, 42, 23, 2);
m.carve(42, 39, 42, 45, 2);
m.carve(42, 45, 42, 59, 2);
m.carve(2, 29, 34, 29, 2);
m.carve(50, 29, 81, 29, 2);

// --- camps and sentries (the dawn relight runs go through their country) ---
const farBeacons = (x, y) =>
  redoubts.every(r => Math.abs(x - r.cx) + Math.abs(y - r.cy) > 8)
  && (x < 33 || x > 51 || y < 22 || y > 40);
m.camp({ x: 10, y: 28, members: ['g', 'g', 'w'], extra: farBeacons });
m.camp({ x: 73, y: 28, members: ['n', 'a', 'g'], extra: farBeacons }); // sniper nest on the east road
m.camp({ x: 42, y: 11, members: ['r', 'g', 'w', 'w'], extra: farBeacons });
m.camp({ x: 42, y: 52, members: ['z', 'z', 'z'], extra: farBeacons });
m.camp({ x: 10, y: 8, members: ['s', 'g', 'a'], extra: farBeacons });
m.sentry('w', 74, 8);
m.sentry('g', 10, 52);
m.sentry('a', 74, 52, { patrol: false });

// --- loot and lyth (relights cost 8 shards each — the vale pays well) ---
m.addChest(8, 14, 'shards', 9);
m.addChest(74, 14, 'shards', 8);
m.addChest(8, 44, 'medkit', 1);
m.addChest(74, 44, 'shards', 10);
m.addChest(32, 8, 'shield', 1);
m.addChest(52, 8, 'token', 1);
m.addChest(32, 54, 'cracker', 2);
m.addChest(52, 54, 'shards', 7);
m.addChest(12, 34, 'medkit', 1);
m.addChest(72, 34, 'shield', 1);
for (const [x, y] of [[42, 8], [42, 56], [8, 30], [76, 30], [30, 16], [54, 16], [30, 46], [54, 46], [16, 22], [68, 22], [16, 40], [68, 40]]) m.addCrystal(x, y);

// --- proofs (all four beacons must be honest walks from spawn) ---
m.validate({});
m.paintShores(':');

// --- decoration: vale grass ---
m.decorate((x, y, rnd) => (rnd() < 0.4 ? ',' : null));

const table = waveTable({ level: LEVEL, nights: 4, bloodMoons: [3] });
const def = assembleDef({
  level: LEVEL,
  name: 'The Four Lights',
  sizeLabel: 'M',
  difficulty: 2,
  blurb: 'Four beacon monoliths in four redoubts. Keep one lit to dawn — or light all four at night and call the ship.',
  newFeatures: [
    'BEACON DEFENSE: four lights, keep one burning',
    'Relight dark beacons by day — 8 shards',
    'All four lit at night calls the Anchorcraft',
  ],
  objective: 'Keep at least one beacon lit through four nights — or light all four at night and board the Anchorcraft',
  intro: [{
    title: 'The Four Lights',
    lines: [
      'Four monoliths anchor this vale, and the waves will split between every light still burning.',
      'A beacon beaten to nothing goes DARK, not dead: stand at it by day, hold ACT, pay 8 shards — it burns again.',
      'Lose only if all four go dark at once. And from the second night: all four lit in the dark calls the Anchorcraft down.',
    ],
    art: 'siege',
  }],
  outro: [{
    title: 'Lights Over the Vale',
    lines: [
      'However it ended — dawn or descent — the vale kept a light burning.',
      'Four monoliths hum behind you. The frontier maps call it holdable now.',
    ],
    art: 'dawn',
  }],
  table,
  map: m,
  bastionVariant: 'beacons',
  ambience: 'meadow',
});
const out = writeDef(def, 'sh05.json');
report(def, m, out);
