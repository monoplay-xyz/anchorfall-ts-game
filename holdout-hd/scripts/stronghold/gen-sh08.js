// Generates levels/stronghold/sh08.json — "The Husk Tide" (stronghold 8).
// Deterministic (seed 20260708). A 96x70 L-size drowned ruin-city in FOG
// (all sight capped at nine tiles): cliff rim west and north, a dead sea
// east, ash avenues between rubble blocks. The Null Priests mass their husks
// here in five-strong swarm camps — and the VOLT WRAITH elite debuts, leading
// three of them. A stormgun cache waits in the east ruins.
// Unlock: DUELIST. Three nights, blood moons on 2 and 3 (budget: 5 waves).
import { createMap, waveTable, assembleDef, writeDef, report } from './framework.mjs';

const W = 96, H = 70, LEVEL = 8;
const m = createMap({ w: W, h: H, seed: 20260708, name: 'sh08' });

// --- silhouette: cliff rim, then the dead sea floods the east band ---
m.outline({ border: '#', min: 2, max: 7, harmonics: 5, bites: 2 });
for (let y = 4; y < H - 4; y += 3) m.blob(90, y + m.rnd() * 2, 3 + m.rnd() * 2, '~', 0.95);
m.edgeRing('.');

// --- the ruined city: rubble blocks, debris, ash avenues ---
for (let i = 0; i < 14; i++) m.blob(10 + m.rnd() * 72, 8 + m.rnd() * 54, 1.5 + m.rnd() * 2.4, '#', 0.85);
for (const [ox, oy] of [[20, 20], [60, 16], [28, 56], [70, 50], [36, 12], [14, 40], [80, 24]]) {
  if (m.get(ox, oy) === '.') m.set(ox, oy, 'o');
}
// the avenue grid — old streets in ash
m.carve(12, 14, 82, 14, 2, '_');
m.carve(12, 52, 82, 52, 2, '_');
m.carve(16, 8, 16, 60, 2, '_');
m.carve(78, 8, 78, 60, 2, '_');

// --- the last precinct: fortified walls, six gates ---
m.fortRect({
  x0: 40, y0: 28, x1: 56, y1: 40, floor: ';', apron: 2,
  gates: [[47, 28], [48, 28], [47, 40], [48, 40], [40, 34], [56, 34]],
});
m.addCore(48, 34);
for (const [x, y] of [[44, 31], [52, 31], [44, 37], [52, 37]]) m.addSpawn(x, y);
for (const [x, y] of [[42, 30], [54, 30], [42, 38], [54, 38]]) m.addTower(x, y);
m.addShop(51, 34);
m.addCampfire(48, 31); m.addCampfire(48, 37);
m.addHire(43, 33, { job: 'farmer', cost: 8, name: 'Ash-Sage Brann' });
m.addHire(43, 34, { job: 'smith', cost: 12, name: 'Relic Tamsa' });
m.addHire(43, 35, { job: 'engineer', cost: 10, name: 'Gridkeep Holt' });
for (const [x, y] of [[45, 29], [51, 29], [45, 39], [51, 39]]) m.addBuild(x, y, { kind: 'turret', cost: 10 });
m.addBuild(53, 33, { kind: 'farm', cost: 6 }); m.addBuild(53, 35, { kind: 'farm', cost: 6 });
m.addVehicle(46, 34, 'stag');

// --- lanes: the precinct meets the avenue grid and the ring ---
m.carve(47, 2, 47, 25, 2);
m.carve(47, 43, 47, 66, 2);
m.carve(2, 33, 37, 33, 2);
m.carve(59, 33, 92, 33, 2);

// --- the husk tide: five-strong swarm camps, wraith-led packs, sniper nests ---
const farBase = (x, y) => x < 36 || x > 60 || y < 24 || y > 44;
m.camp({ x: 18, y: 18, members: ['z', 'z', 'z', 'z', 'z'], spread: 3, extra: farBase });
m.camp({ x: 72, y: 16, members: ['z', 'z', 'z', 'z', 'z'], spread: 3, extra: farBase });
m.camp({ x: 16, y: 54, members: ['z', 'z', 'z', 'z', 'z'], spread: 3, extra: farBase });
m.camp({ x: 30, y: 8, members: ['v', 'z', 'z', 'z', 'w'], extra: farBase });  // wraith-led
m.camp({ x: 82, y: 44, members: ['v', 'z', 'z', 'z', 'w'], extra: farBase }); // wraith-led
m.camp({ x: 26, y: 62, members: ['v', 'z', 'z', 'z', 'w'], extra: farBase }); // wraith-led
m.camp({ x: 12, y: 34, members: ['n', 'a', 'z', 'z'], extra: farBase });      // sniper nest, west road
m.camp({ x: 62, y: 8, members: ['n', 'a', 'z', 'z'], extra: farBase });       // sniper nest, north road
m.camp({ x: 64, y: 60, members: ['s', 'z', 'z'], extra: farBase });
m.sentry('v', 48, 12);
m.sentry('z', 48, 58);
m.sentry('w', 8, 12);
m.sentry('g', 84, 62);

// --- the stormgun cache and the city's loot ---
const sg = m.nudge(70, 40);
if (!sg) m.fail('no stormgun cache spot');
m.addPickup(sg[0], sg[1], 'stormgun');
m.addChest(8, 8, 'shards', 9);
m.addChest(82, 6, 'medkit', 1);
m.addChest(8, 62, 'cracker', 2);
m.addChest(70, 64, 'shards', 11);
m.addChest(30, 20, 'shield', 1);
m.addChest(64, 22, 'token', 1);
m.addChest(28, 46, 'medkit', 1);
m.addChest(68, 46, 'shield', 1);
m.addChest(38, 8, 'controller', 1);
m.addChest(20, 30, 'toxin', 1);
m.addChest(84, 16, 'shards', 8);
m.addChest(56, 62, 'cracker', 2);
for (const [x, y] of [[47, 10], [47, 62], [10, 33], [84, 33], [28, 14], [66, 14], [28, 52], [66, 52], [16, 24], [80, 56], [36, 62], [60, 24]]) m.addCrystal(x, y);

// --- proofs ---
m.validate({});
m.paintShores(':');

// --- decoration: broken pavement between the avenues ---
m.decorate((x, y, rnd) => (rnd() < 0.18 ? ';' : rnd() < 0.2 ? '_' : null));

const table = waveTable({ level: LEVEL, nights: 3, bloodMoons: [2, 3] });
const def = assembleDef({
  level: LEVEL,
  name: 'The Husk Tide',
  sizeLabel: 'L',
  difficulty: 3,
  blurb: 'A drowned ruin-city in rolling fog. Husk swarms mass in the streets, and something new crackles among them.',
  newFeatures: ['Volt Wraith elites debut', 'Husk swarms mass in the fog', 'Fog caps all sight at nine tiles'],
  objective: 'Hold the last precinct through three nights of fog — the tide breaks or the city does',
  intro: [{
    title: 'The Husk Tide',
    lines: [
      'The Null Priests empty their pews into this drowned city — husks in five-strong packs, walking their rounds in the fog.',
      'Fog cuts ALL sight to nine tiles, theirs and yours. Stumble into a camp and the whole pack wakes.',
      'Volt Wraiths lead three of the packs now: chain-lightning that stings and stuns. A stormgun cache waits in the east ruins — fight spark with spark.',
    ],
    art: 'siege',
  }],
  outro: [{
    title: 'Ebb Tide',
    lines: [
      'Seven dawns. The fog lifts off empty streets and a precinct still lit.',
      'The tide went out. It left its dead on your walls — and the city kept its name.',
    ],
    art: 'dawn',
  }],
  table,
  map: m,
  weather: 'fog',
  ambience: 'night',
});
const out = writeDef(def, 'sh08.json');
report(def, m, out);
