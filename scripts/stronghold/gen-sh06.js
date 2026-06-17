// Generates levels/stronghold/sh06.json — "Quarry Bastion" (stronghold 6).
// Deterministic (seed 20260706). An 86x62 M-size mountain quarry: deep rock
// rim, ridge spines, rubble fields, a stone pit in the southeast — and SIX
// watchtowers to crew. Pre-wave side-op: Quarrymaster Bel pays to put down
// the claim-jumper chargers squatting the pit. Back-to-back blood moons.
// Unlock: BASTION. Three nights, blood moons on 2 and 3 (budget: 5 waves).
import { createMap, waveTable, assembleDef, writeDef, report } from './framework.mjs';

const W = 86, H = 62, LEVEL = 6;
const m = createMap({ w: W, h: H, seed: 20260706, name: 'sh06' });

// --- silhouette: a deep mountain rim, heavily bitten ---
m.outline({ border: '#', min: 3, max: 9, harmonics: 5, bites: 4 });
m.edgeRing('.');

// --- terrain: ridge spines, the quarry pit, rubble ---
m.vein(10, 20, 38, 8, 2, '#');
m.vein(68, 8, 78, 28, 2, '#');
m.vein(8, 44, 24, 54, 2, '#');
// the pit: a stone bowl with a broken rock ring, open to the northwest
m.disc(62, 44, 8, ';');
for (let a = 0; a < 16; a++) {
  const ang = (a / 16) * Math.PI * 2;
  if (ang > Math.PI * 1.1 && ang < Math.PI * 1.6) continue; // NW gap
  m.disc(62 + Math.cos(ang) * 8.5, 44 + Math.sin(ang) * 8.5, 1.2, '#');
}
for (let i = 0; i < 10; i++) m.blob(8 + m.rnd() * 70, 6 + m.rnd() * 50, 1.3 + m.rnd() * 1.6, '#', 0.75);
for (const [ox, oy] of [[24, 16], [56, 12], [16, 34], [70, 18], [36, 50], [24, 44], [50, 24]]) {
  if (m.get(ox, oy) === '.') m.set(ox, oy, 'o');
}

// --- the bastion: a wide fortified rectangle, six gates, four corner towers ---
m.fortRect({
  x0: 30, y0: 24, x1: 46, y1: 36, floor: ';', apron: 2,
  gates: [[37, 24], [38, 24], [37, 36], [38, 36], [30, 30], [46, 30]],
});
m.addCore(38, 30);
for (const [x, y] of [[34, 27], [42, 27], [34, 33], [42, 33]]) m.addSpawn(x, y);
for (const [x, y] of [[32, 26], [44, 26], [32, 34], [44, 34]]) m.addTower(x, y);
m.addShop(41, 30);
m.addCampfire(38, 28); m.addCampfire(38, 32);
m.addHire(33, 29, { job: 'farmer', cost: 8, name: 'Terrace-Sage Pell' });
m.addHire(33, 30, { job: 'smith', cost: 12, name: 'Granite Hesk' });
m.addHire(33, 31, { job: 'engineer', cost: 10, name: 'Pulley Wren' });
for (const [x, y] of [[35, 25], [41, 25], [35, 35], [41, 35]]) m.addBuild(x, y, { kind: 'turret', cost: 10 });
m.addBuild(43, 29, { kind: 'farm', cost: 6 }); m.addBuild(43, 31, { kind: 'farm', cost: 6 });
m.addVehicle(36, 30, 'stag');
// the quest giver, by the north fire
m.addNpc(40, 28, {
  id: 'bel', name: 'Quarrymaster Bel',
  lines: [
    'Claim-jumpers squat my pit — chargers, the lot, quick as rockslides.',
    'Put four of them down and the shard purse is yours.',
    'Do it before dusk. The pit flanks our south wall.',
  ],
});

// --- two satellite watchtowers at the lane mouths (six total) ---
m.addTower(37, 12);
m.addTower(38, 48);

// --- approach lanes ---
m.carve(37, 2, 37, 21, 2);
m.carve(37, 39, 37, 59, 2);
m.carve(2, 29, 27, 29, 2);
m.carve(49, 29, 83, 29, 2);

// --- the claim-jumper camp in the pit + the mountain camps ---
const farBase = (x, y) => x < 26 || x > 50 || y < 20 || y > 40;
m.camp({ x: 62, y: 44, members: ['r', 'r', 'r', 'r', 'g', 'w'], spread: 3.5, extra: farBase }); // the pit
m.camp({ x: 14, y: 14, members: ['s', 's', 'g', 'a'], extra: farBase });
m.camp({ x: 68, y: 14, members: ['s', 'g', 'g', 'w'], extra: farBase });
m.camp({ x: 14, y: 46, members: ['n', 'a', 's', 'g'], extra: farBase }); // sniper nest
m.camp({ x: 20, y: 30, members: ['g', 'g', 'w', 'w'], extra: farBase });
m.camp({ x: 74, y: 30, members: ['n', 'g', 's'], extra: farBase });      // sniper nest
m.sentry('w', 38, 8);
m.sentry('g', 38, 52);
m.sentry('r', 6, 30);

// --- loot and lyth ---
m.addChest(8, 8, 'shards', 9);
m.addChest(76, 8, 'medkit', 1);
m.addChest(8, 52, 'cracker', 2);
m.addChest(76, 52, 'shards', 11);
m.addChest(62, 44, 'token', 1);    // the pit pays
m.addChest(58, 48, 'shards', 8);   // deep pit corner
m.addChest(26, 8, 'shield', 1);
m.addChest(60, 8, 'controller', 1);
m.addChest(12, 38, 'medkit', 1);
m.addChest(72, 38, 'shield', 1);
m.addChest(28, 52, 'toxin', 1);
for (const [x, y] of [[37, 10], [37, 46], [12, 29], [70, 29], [24, 20], [54, 20], [24, 42], [52, 42], [44, 8], [30, 54], [78, 44]]) m.addCrystal(x, y);

// --- proofs ---
m.validate({});

// --- decoration: gravel and stone terraces ---
m.decorate((x, y, rnd) => (rnd() < 0.22 ? ':' : rnd() < 0.16 ? ';' : null));

const table = waveTable({ level: LEVEL, nights: 3, bloodMoons: [2, 3] });
const def = assembleDef({
  level: LEVEL,
  name: 'Quarry Bastion',
  sizeLabel: 'M',
  difficulty: 3,
  blurb: 'Stone country: ridge spines, rubble, a pit full of claim-jumpers — and six towers begging for gunners.',
  newFeatures: ['Six watchtowers to crew', 'Back-to-back blood moons', 'Camp-clearing bounty'],
  objective: 'Hold Quarry Bastion through three nights — and clear the claim-jumpers from the pit for Bel',
  intro: [{
    title: 'Quarry Bastion',
    lines: [
      'The quarry cut the stone that walls half the frontier. Tonight the frontier owes it a garrison.',
      'Six watchtowers stand along the lanes — crewed towers win sieges. The pit southeast hides charger claim-jumpers; Bel pays for four.',
      'Two blood moons this tour, back to back. Stack shards, stack walls, sleep never.',
    ],
    art: 'siege',
  }],
  outro: [{
    title: 'Stone Holds Stone',
    lines: [
      'Six dawns and the quarry still rings — hammer on rock, not claw on gate.',
      'Bel chalks the tally on the wall: two blood moons, zero refunds.',
    ],
    art: 'dawn',
  }],
  table,
  map: m,
  ambience: 'city',
  quests: [{
    id: 'clearpit', title: 'Break the claim-jumpers', giver: 'bel', kind: 'kill', target: 'r', count: 4,
    reward: { shards: 25 }, hint: 'Put down four chargers — the pit crew squats the southeast bowl',
  }],
});
const out = writeDef(def, 'sh06.json');
report(def, m, out);
