// Generates levels/stronghold/sh03.json — "Mire Hold" (stronghold 3).
// Deterministic (seed 20260703). A 78x58 M-size SWAMP under RAIN (burn
// patches gutter out twice as fast): pond chains, mud flats, a forest-band
// border, raider packs in the reeds — and the first PRE-WAVE SIDE-OP: three
// dark relays out in the mire, a switch quest from Relay-Warden Mossu.
// Unlock: RAIDER. Four nights, blood moon on the third (budget: 5 waves).
import { createMap, waveTable, assembleDef, writeDef, report } from './framework.mjs';

const W = 78, H = 58, LEVEL = 3;
const m = createMap({ w: W, h: H, seed: 20260703, name: 'sh03' });

// --- silhouette: deep forest border band, three bites ---
m.outline({ border: 'T', min: 2, max: 8, harmonics: 5, bites: 3 });
m.edgeRing('.');

// --- terrain: pond chains, mud, tree clumps ---
const ponds = [[14, 10], [26, 14], [62, 12], [68, 24], [10, 36], [16, 48], [58, 46], [66, 38], [40, 12], [40, 46]];
for (const [px, py] of ponds) m.disc(px, py, 1.8 + m.rnd() * 1.6, '~');
for (let i = 0; i < 12; i++) m.blob(6 + m.rnd() * 66, 5 + m.rnd() * 48, 2.5 + m.rnd() * 3.5, ':', 0.8);
for (let i = 0; i < 12; i++) m.blob(8 + m.rnd() * 62, 6 + m.rnd() * 46, 1.4 + m.rnd() * 1.6, 'T', 0.8);

// --- the hold: a stone rise with fortified walls, six gates ---
m.fortRect({
  x0: 32, y0: 23, x1: 46, y1: 33, floor: ';', apron: 2,
  gates: [[38, 23], [39, 23], [38, 33], [39, 33], [32, 28], [46, 28]],
});
m.addCore(39, 28);
for (const [x, y] of [[36, 26], [42, 26], [36, 30], [42, 30]]) m.addSpawn(x, y);
for (const [x, y] of [[34, 25], [44, 25], [34, 31], [44, 31]]) m.addTower(x, y);
m.addShop(42, 28);
m.addCampfire(39, 26); m.addCampfire(39, 30);
m.addHire(35, 27, { job: 'farmer', cost: 8, name: 'Bog-Sage Imra' });
m.addHire(35, 29, { job: 'engineer', cost: 10, name: 'Sump Keller' });
for (const [x, y] of [[37, 24], [41, 24], [37, 32], [41, 32]]) m.addBuild(x, y, { kind: 'turret', cost: 10 });
m.addBuild(43, 26, { kind: 'farm', cost: 6 }); m.addBuild(43, 30, { kind: 'farm', cost: 6 });
m.addVehicle(37, 28, 'stag');
// the quest giver, inside the walls
m.addNpc(40, 26, {
  id: 'mossu', name: 'Relay-Warden Mossu',
  lines: [
    'Three relays out in the mire went dark when the husks came.',
    'Throw them back on and the frontier hears us again — worth real shards.',
    'Mind the reeds. The raider packs WALK their rounds now.',
  ],
});

// --- approach lanes: ring to gates through the mire ---
m.carve(38, 2, 38, 20, 2);
m.carve(38, 36, 38, 55, 2);
m.carve(2, 27, 29, 27, 2);
m.carve(49, 27, 75, 27, 2);

// --- the three dark relays, each watched by a camp ---
const sw1 = m.addSwitch(14, 13, { id: 'relayNW', group: 0 });
const sw2 = m.addSwitch(63, 17, { id: 'relayNE', group: 1 });
const sw3 = m.addSwitch(18, 46, { id: 'relayS', group: 2 });

// --- camps and sentries ---
const farBase = (x, y) => x < 28 || x > 50 || y < 19 || y > 37;
m.camp({ x: 14, y: 15, members: ['r', 'r', 'g', 'w'], extra: farBase });   // raiders by the NW relay
m.camp({ x: 61, y: 19, members: ['n', 'a', 'g', 'g'], extra: farBase });  // sniper nest by the NE relay
m.camp({ x: 20, y: 44, members: ['z', 'z', 'z', 'w'], extra: farBase });  // husks by the S relay
m.camp({ x: 60, y: 44, members: ['s', 'g', 'a'], extra: farBase });
m.camp({ x: 10, y: 28, members: ['r', 'g', 'w', 'w'], extra: farBase });
m.camp({ x: 66, y: 31, members: ['g', 'g', 'a'], extra: farBase });
m.sentry('w', 39, 9);
m.sentry('z', 39, 48);
m.sentry('g', 70, 9);
m.sentry('r', 8, 50);

// --- loot and lyth ---
m.addChest(8, 8, 'shards', 8);
m.addChest(30, 8, 'medkit', 1);
m.addChest(68, 8, 'cracker', 2);
m.addChest(72, 30, 'shards', 7);
m.addChest(6, 22, 'shield', 1);
m.addChest(28, 48, 'token', 1);
m.addChest(48, 48, 'medkit', 1);
m.addChest(70, 50, 'shards', 10);
m.addChest(50, 10, 'toxin', 1);
m.addChest(12, 40, 'shield', 1);
for (const [x, y] of [[38, 12], [38, 44], [14, 27], [62, 27], [24, 18], [54, 18], [24, 40], [54, 40], [32, 6], [46, 50]]) m.addCrystal(x, y);

// --- proofs ---
m.validate({});
m.paintShores(':');

// --- decoration: reed grass and muck on the bare flats ---
m.decorate((x, y, rnd) => (rnd() < 0.3 ? ':' : rnd() < 0.25 ? ',' : null));

const table = waveTable({ level: LEVEL, nights: 4, bloodMoons: [3] });
const def = assembleDef({
  level: LEVEL,
  name: 'Mire Hold',
  sizeLabel: 'M',
  difficulty: 2,
  blurb: 'A stone rise in a drowned forest. Rain kills fire fast, raiders walk the reeds, and three relays sit dark.',
  newFeatures: ['Rain — ground fire gutters out fast', 'Relay restoration side-op', 'Raider packs in the reeds'],
  objective: 'Hold Mire Hold through four nights — restore the three mire relays for Mossu if you can',
  intro: [{
    title: 'Mire Hold',
    lines: [
      'The mire swallowed the relay line a week ago. The hold is deaf, and the waves still come.',
      'Rain favors them: your fires gutter out twice as fast. Three dark relays wait in the reeds — Mossu pays in shards.',
      'Raider packs walk their rounds out there. Spot them before their snipers spot you.',
    ],
    art: 'siege',
  }],
  outro: [{
    title: 'Signals in the Rain',
    lines: [
      'The fourth dawn finds the hold above water and the relays singing.',
      'Somewhere east, the frontier writes Mire Hold back onto the map.',
    ],
    art: 'dawn',
  }],
  table,
  map: m,
  weather: 'rain',
  ambience: 'swamp',
  quests: [{
    id: 'relays', title: 'Restore the relays', giver: 'mossu', kind: 'switch', count: 3,
    reward: { shards: 20 }, hint: 'Three mire relays sit dark — throw them back on',
  }],
});
const out = writeDef(def, 'sh03.json');
report(def, m, out);
