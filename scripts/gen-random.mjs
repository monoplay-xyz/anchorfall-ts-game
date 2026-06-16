// scripts/gen-random.mjs — thin CLI over the deterministic Map Generator
// (shared/mapgen.js, issue #6). Prints a sample LevelDef (or writes it to a
// file) and validates it with the shared validator. Pure fs/CLI glue — all map
// intelligence lives in shared/mapgen.ts.
//
// Usage:
//   node scripts/gen-random.mjs [--seed S] [--biome B] [--archetype A]
//                               [--objective O] [--size small|medium|large]
//                               [--difficulty 1..5] [--out path.json] [--quiet]
//
// Run `npm run build` first (imports the emitted shared/mapgen.js).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate } from '../shared/mapgen.js';
import { charsById } from '../shared/game.js';
import { validateLevelDef } from '../shared/mapValidate.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const characters = JSON.parse(fs.readFileSync(path.join(root, 'shared/characters.json'), 'utf8'));
const ctx = { charMap: charsById(characters), characters };

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}
const has = (name) => process.argv.includes('--' + name);

const seed = arg('seed', 'demo');
const params = {
  biome: arg('biome', 'verdance'),
  archetype: arg('archetype', 'centered-hold'),
  objective: arg('objective', 'bastion'),
  size: arg('size', 'medium'),
  difficulty: Number(arg('difficulty', '3')),
};

const def = generate(seed, params);
const res = validateLevelDef({ ...def }, ctx);

const out = arg('out', null);
if (out) {
  fs.writeFileSync(path.resolve(root, out), JSON.stringify(def, null, 2));
  console.log(`wrote ${out} (${def.tiles[0].length}x${def.tiles.length})  valid=${res.ok}`);
} else if (!has('quiet')) {
  for (const row of def.tiles) console.log(row);
  console.log(`\nseed=${seed} ${params.biome}/${params.archetype}/${params.objective}/${params.size}/d${params.difficulty}`);
  console.log(`size ${def.tiles[0].length}x${def.tiles.length}  mode=${def.mode || 'classic'}  valid=${res.ok}`);
}
if (!res.ok) {
  for (const p of res.problems) console.error('  [INVALID] ' + p);
  process.exit(1);
}
