// Bridge between the native shell and the web game. contextIsolation is off
// (local trusted content), so this runs in the page context and can override
// navigator.getGamepads() with the native SDL controller feed coming from the
// sidecar process via main. The game keeps calling getGamepads() unchanged but
// now gets correct SDL mappings, full analog sticks (diagonals), and pad type.
const { ipcRenderer } = require('electron');

let latestPads = [];
let prevConnected = 0;
ipcRenderer.on('controllers:state', (_e, line) => {
  try {
    const pads = JSON.parse(line);
    // fire connect/disconnect events the game/browser may listen for
    if (pads.length !== prevConnected) {
      const type = pads.length > prevConnected ? 'gamepadconnected' : 'gamepaddisconnected';
      prevConnected = pads.length;
      try { window.dispatchEvent(new Event(type)); } catch {}
    }
    latestPads = pads;
  } catch {}
});

// W3C Gamepad-shaped objects from the SDL snapshot.
function toGamepad(p) {
  return {
    index: p.index,
    id: p.id,
    connected: true,
    mapping: 'standard',
    timestamp: (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    buttons: p.buttons.map((b) => ({ pressed: !!b.pressed, touched: !!b.pressed, value: b.value || 0 })),
    axes: p.axes.slice(),
    vibrationActuator: null,
  };
}

const browserGetGamepads = navigator.getGamepads ? navigator.getGamepads.bind(navigator) : () => [];
navigator.getGamepads = function () {
  if (latestPads.length) return latestPads.map(toGamepad);
  return browserGetGamepads(); // no SDL pad: fall back to the built-in API
};

window.anchorfallDesktop = {
  isDesktop: true,
  setDisplayMode: (mode) => ipcRenderer.invoke('display:set-mode', mode),
  getDisplayMode: () => ipcRenderer.invoke('display:get-mode'),
  quit: () => ipcRenderer.invoke('app:quit'),
  // [{ index, type:'ps5'|'ps4'|'xbox'|'switch'|'generic', name, id }] — drives
  // the adaptive on-screen button glyphs (Xbox X / PlayStation □ / keyboard E)
  controllers: () => latestPads.map((p) => ({ index: p.index, type: p.type, name: p.id, id: p.id })),
};
