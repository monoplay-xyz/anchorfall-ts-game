// TypeScript build for MONOLYTHIUM — THE ANCHORFALL (issue #4).
//
// Type-only migration: every .ts source is transpiled to a sibling .js by
// esbuild type-stripping ONLY — no bundling, no minification, no downleveling.
// The native-ESM module graph is preserved exactly (import specifiers untouched),
// so the browser, the Node server, the Electron shell and the Batocera static
// build all load the emitted .js the same way they loaded the hand-written .js
// before the migration. The emitted .js are build artifacts (gitignored); the
// .ts files are the source of truth.
//
// Byte-identical runtime is the contract: type annotations erase at compile time,
// so behaviour is unchanged — verified by `npm test` (deterministic sim stream +
// 32-player CTF wire size). If a converted file changes the snapshot stream or the
// wire baseline, the conversion changed behaviour and must be reverted.
//
// desktop/ is a separate CommonJS sub-package (electron-builder) and is built on
// its own; it is skipped here.

import { build } from 'esbuild';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(dirname(fileURLToPath(import.meta.url))); // holdout-hd/
const SKIP = new Set(['node_modules', 'dist', 'desktop', '.git', 'assets', 'levels', 'saves']);

function walk(dir, acc) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP.has(e.name)) continue;
      walk(join(dir, e.name), acc);
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) {
      acc.push(join(dir, e.name));
    }
  }
  return acc;
}

const entryPoints = walk(root, []);
if (entryPoints.length === 0) {
  console.log('build: no .ts sources yet (nothing to transpile)');
  process.exit(0);
}

await build({
  entryPoints,
  outdir: root,
  outbase: root,
  bundle: false, // preserve the native-ESM module graph; do not resolve/inline imports
  format: 'esm',
  target: 'esnext', // no downleveling, no polyfills (Node 26 + modern browsers)
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
});

console.log(`build: ${entryPoints.length} .ts -> .js (esbuild type-strip · esm · esnext)`);
