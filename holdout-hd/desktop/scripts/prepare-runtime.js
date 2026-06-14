// Stage a standalone Node binary into runtime/ so electron-builder bundles it
// into the app (Resources/runtime). The controller sidecar runs under THIS Node,
// because @kmamal/sdl SIGSEGVs inside Electron's binary on macOS (see main.js).
//
// It copies the Node that is *currently running this script* — so run it with the
// system Node for the platform you're building (CI does this per-matrix runner,
// and locally `npm run dist` invokes it via the system Node that runs npm).
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'runtime');
const exe = process.platform === 'win32' ? 'node.exe' : 'node';
const dst = path.join(dir, exe);

const src = process.execPath;
if (/electron/i.test(src)) {
  console.error('prepare-runtime: refusing to copy an Electron binary as the Node runtime.');
  console.error('Run this with a real Node: `node scripts/prepare-runtime.js`.');
  process.exit(1);
}

fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(src, dst);
if (process.platform !== 'win32') fs.chmodSync(dst, 0o755);
console.log(`prepare-runtime: staged ${src} -> ${dst} (${(fs.statSync(dst).size / 1e6).toFixed(0)} MB)`);
