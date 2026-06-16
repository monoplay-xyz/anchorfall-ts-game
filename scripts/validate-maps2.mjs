// Thin Node harness over the reusable shared/mapValidate.js. Loads the roster
// (shared/characters.json) + every levels/<cat>/*.json, hands each def the same
// ctx the Map Generator / Community server / Map Builder will supply, and prints
// any problems validateLevelDef collects. Exits non-zero if any level fails.
//
// All map intelligence lives in shared/mapValidate.ts — this file only does the
// fs I/O that the pure validator deliberately avoids. Run after `npm run build`
// (it imports the emitted shared/mapValidate.js + shared/game.js).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { charsById } from '../shared/game.js';
import { validateLevelDef } from '../shared/mapValidate.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const characters = JSON.parse(fs.readFileSync(path.join(root, 'shared/characters.json'), 'utf8'));
const charMap = charsById(characters);
const ctx = { charMap, characters };

const levelsDir = path.join(root, 'levels');
const cats = fs.readdirSync(levelsDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
const levels = [];
for (const cat of cats) {
  for (const f of fs.readdirSync(path.join(levelsDir, cat)).filter(f => f.endsWith('.json')).sort()) {
    const def = Object.assign(JSON.parse(fs.readFileSync(path.join(levelsDir, cat, f), 'utf8')), { category: cat });
    levels.push({ rel: `levels/${cat}/${f}`, def });
  }
}

let failed = 0, totalProblems = 0;
for (const { rel, def } of levels) {
  const { ok, problems } = validateLevelDef(def, ctx);
  if (!ok) {
    failed++;
    totalProblems += problems.length;
    for (const p of problems) console.log(`  [FAIL] ${rel}: ${p}`);
  }
}

console.log(`\n${failed === 0 ? 'ALL CLEAN' : totalProblems + ' PROBLEM(S) in ' + failed + ' level(s)'} across ${levels.length} levels.`);
process.exit(failed === 0 ? 0 : 1);
