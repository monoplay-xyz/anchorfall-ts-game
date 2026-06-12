// Builds dist/ — a fully static, serverless build of HOLDOUT HD for couch play
// on machines without Node (e.g. Batocera): any static file server + a browser.
// Local play (solo / couch co-op / story) is fully client-side; online co-op
// needs the real Node server, so the online buttons are hidden in this build.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'shared'), { recursive: true });
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });

// levels/<category>/ subdirs -> one flat JSON array with def.category set,
// exactly like /api/levels serves them (classic-first, then story/stronghold/ctf/br)
const levelsDir = path.join(root, 'levels');
const CATEGORY_ORDER = ['classic', 'story', 'stronghold', 'ctf', 'br'];
const catRank = c => { const i = CATEGORY_ORDER.indexOf(c); return i === -1 ? CATEGORY_ORDER.length : i; };
const levels = fs.readdirSync(levelsDir, { withFileTypes: true })
  .filter(d => d.isDirectory()).map(d => d.name)
  .sort((a, b) => catRank(a) - catRank(b) || (a < b ? -1 : a > b ? 1 : 0))
  .flatMap(cat => fs.readdirSync(path.join(levelsDir, cat)).filter(f => f.endsWith('.json')).sort()
    .map(f => Object.assign(JSON.parse(fs.readFileSync(path.join(levelsDir, cat, f), 'utf8')), { category: cat })));
fs.writeFileSync(path.join(dist, 'levels.json'), JSON.stringify(levels));

// shared sim + data
for (const f of ['game.js', 'characters.json']) {
  fs.copyFileSync(path.join(root, 'shared', f), path.join(dist, 'shared', f));
}

// optional PNG art overrides + the EVA voice pack (assets/voice/*.m4a)
const assetsDir = path.join(root, 'public', 'assets');
if (fs.existsSync(assetsDir)) {
  fs.cpSync(assetsDir, path.join(dist, 'assets'), { recursive: true });
}

// client files with absolute paths rewritten to relative ones
const rewrite = s => s
  .replaceAll("'/shared/game.js'", "'./shared/game.js'")
  .replaceAll("'/shared/characters.json'", "'./shared/characters.json'")
  .replaceAll("'/api/levels'", "'./levels.json'")
  .replaceAll('`/assets/', '`./assets/');

for (const f of ['index.html', 'style.css', 'audio.js', 'render.js']) {
  fs.writeFileSync(path.join(dist, f), rewrite(fs.readFileSync(path.join(root, 'public', f), 'utf8')));
}
let client = rewrite(fs.readFileSync(path.join(root, 'public', 'client.js'), 'utf8'));
client += `
// static build: no game server, so online co-op is unavailable
for (const id of ['btnHost', 'btnJoin', 'joinCode']) {
  const el = document.getElementById(id);
  if (el) (el.closest('.joinrow') || el).style.display = 'none';
}
document.getElementById('btnHost')?.style.setProperty('display', 'none');
`;
fs.writeFileSync(path.join(dist, 'client.js'), client);

// convenience launcher for any machine with python
fs.writeFileSync(path.join(dist, 'play.sh'), `#!/bin/bash
# Serves the game locally and opens it. Works on Batocera/Linux/macOS.
cd "$(dirname "$0")"
PORT=\${PORT:-8123}
python3 -m http.server "$PORT" >/dev/null 2>&1 &
SRV=$!
trap "kill $SRV" EXIT
URL="http://localhost:$PORT"
echo "HOLDOUT HD at $URL"
chromium --kiosk --no-sandbox --autoplay-policy=no-user-gesture-required "$URL" 2>/dev/null \\
  || flatpak run org.chromium.Chromium --kiosk --autoplay-policy=no-user-gesture-required "$URL" 2>/dev/null \\
  || xdg-open "$URL" 2>/dev/null \\
  || open "$URL" 2>/dev/null \\
  || (echo "open $URL in a browser"; wait $SRV)
`, { mode: 0o755 });

const files = fs.readdirSync(dist).length;
console.log(`dist/ built: ${files} top-level entries, ${levels.length} levels inlined`);
