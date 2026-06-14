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
const GAME_DIR = path.join(__dirname, '..'); // holdout-hd/
let server = null;
let win = null;

function startServer() {
  // Run the existing Node server with Electron's bundled node (no system node
  // needed when packaged) so online/LAN host+join work inside the app.
  server = spawn(process.execPath, [path.join(GAME_DIR, 'server.js')], {
    cwd: GAME_DIR,
    env: { ...process.env, PORT: String(PORT), ELECTRON_RUN_AS_NODE: '1' },
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
      contextIsolation: true,
      backgroundThrottling: false, // never throttle the game loop
    },
  });
  win.setMenuBarVisibility(false);
  win.loadURL(`http://127.0.0.1:${PORT}/`);
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
  waitForPort(createWindow);
});
app.on('window-all-closed', () => { try { server && server.kill(); } catch {} app.quit(); });
app.on('before-quit', () => { try { server && server.kill(); } catch {} });
