// MONOLYTHIUM — THE ANCHORFALL — native desktop shell (Electron).
// Wraps the existing web game in a real native window: true fullscreen, native
// display modes, and (added next) native SDL controller input. The game itself
// is unchanged — the server.js runs in-process and the window loads it.
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

// Audio should start without a click (the game also wakes audio on first input).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const PORT = 3199;
// Dev: the game is the parent folder. Packaged: electron-builder copies the game
// into Resources/game (see electron-builder.yml extraResources).
const GAME_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'game')
  : path.join(__dirname, '..'); // holdout-hd/
let server = null;
let win = null;

function startServer() {
  // Run the existing Node server with Electron's bundled node (no system node
  // needed when packaged) so online/LAN host+join work inside the app.
  server = spawn(process.execPath, [path.join(GAME_DIR, 'server.js')], {
    cwd: GAME_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      ELECTRON_RUN_AS_NODE: '1',
      // The packaged GAME_DIR (Resources/game) is read-only on signed macOS
      // builds, so point the server's saves/accounts store at a writable dir.
      SAVES_DIR: path.join(app.getPath('userData'), 'saves'),
    },
    stdio: 'inherit',
  });
}

function waitForPort(cb, tries = 0) {
  const req = http.get({ host: '127.0.0.1', port: PORT, path: '/' }, () => { req.destroy(); cb(); });
  req.on('error', () => { if (tries > 300) return cb(); setTimeout(() => waitForPort(cb, tries + 1), 100); });
}

function createWindow() {
  win = new BrowserWindow({
    fullscreen: true,
    backgroundColor: '#000000', // letterbox bars read black
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'monoplay-logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // local trusted content only — contextIsolation off lets the preload
      // override navigator.getGamepads() with the native SDL controller feed
      contextIsolation: false,
      sandbox: false,
      backgroundThrottling: false, // never throttle the game loop
    },
  });
  win.setMenuBarVisibility(false);
  win.loadURL(`http://127.0.0.1:${PORT}/`);
}

// --- Native controllers via the SDL sidecar (separate real-Node process) ---
// SDL cannot run inside Electron at all on macOS: loading @kmamal/sdl in
// Electron's binary SIGSEGVs (it touches Cocoa in Electron's already-initialized
// runtime), and a utilityProcess doesn't help because it's the same Electron
// binary. SDL only runs under a *real* Node. So we ship a standalone Node binary
// inside the app (Resources/runtime/node) and run the sidecar with it — no
// dependency on the user having Node installed. Each frame's controller state is
// forwarded to the renderer. If the runtime or SDL is unavailable, the renderer
// keeps the built-in browser Gamepad API — controllers still work, just without
// SDL's richer mappings.
let controllerProc = null;
function nodeBinary() {
  const exe = process.platform === 'win32' ? 'node.exe' : 'node';
  // 1) the Node runtime we bundle in the app — works on machines without Node.
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'runtime', exe);
    try { if (require('fs').existsSync(bundled)) return bundled; } catch {}
  }
  // 2) dev / fallback: a system Node.
  for (const p of ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']) {
    try { if (require('fs').existsSync(p)) return p; } catch {}
  }
  return exe; // last resort: PATH lookup
}
function startControllers() {
  try {
    controllerProc = spawn(nodeBinary(), [path.join(__dirname, 'controller-sidecar.js')], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) { console.error('controller sidecar spawn failed:', e.message); return; }
  let buf = '';
  controllerProc.stdout.on('data', (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (line && win && !win.isDestroyed()) win.webContents.send('controllers:state', line);
    }
  });
  controllerProc.stderr.on('data', (d) => console.error('[controllers]', d.toString().trim()));
  controllerProc.on('error', (e) => console.error('controller sidecar error:', e.message));
  controllerProc.on('exit', (code) => { if (code) console.error('controller sidecar exited', code); });
}

// --- Display-settings IPC (driven by the in-game Settings → Display menu) ---
ipcMain.handle('display:set-mode', (_e, mode) => {
  if (!win) return false;
  if (mode === 'fullscreen') {
    win.setFullScreen(true);
  } else if (mode === 'borderless') {
    win.setFullScreen(false);
    const wa = screen.getPrimaryDisplay().workAreaSize;
    win.setBounds({ x: 0, y: 0, width: wa.width, height: wa.height });
  } else if (mode === 'windowed') {
    win.setFullScreen(false);
    win.setSize(1280, 720);
    win.center();
  }
  return true;
});
ipcMain.handle('display:get-mode', () => (win && win.isFullScreen()) ? 'fullscreen' : 'windowed');

// Quit to desktop (driven by the main-menu "Quit to Desktop" button).
ipcMain.handle('app:quit', () => { try { server && server.kill(); } catch {} app.quit(); });

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    try { app.dock.setIcon(path.join(__dirname, 'assets', 'monoplay-logo.png')); } catch {}
  }
  startServer();
  startControllers();
  waitForPort(createWindow);
});
function cleanup() {
  try { server && server.kill(); } catch {}
  try { controllerProc && controllerProc.kill(); } catch {}
}
app.on('window-all-closed', () => { cleanup(); app.quit(); });
app.on('before-quit', cleanup);
