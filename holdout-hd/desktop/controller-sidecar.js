// Controller sidecar — runs under SYSTEM node (NOT Electron), because the SDL
// native module crashes inside Electron's V8 (ABI mismatch) and conflicts with
// Electron's macOS run-loop in the main process. As its own process it loads
// SDL cleanly, reads game controllers with correct SDL mappings (PS5/PS4/Xbox/
// Switch, full analog sticks), and streams each frame's state as one JSON line
// on stdout. main.js forwards it to the renderer, which exposes it via
// navigator.getGamepads() so the game's existing input works unchanged.
let sdl;
try {
  sdl = require('@kmamal/sdl');
} catch (e) {
  process.stderr.write('controller-sidecar: SDL load failed: ' + e.message + '\n');
  process.exit(2);
}

const open = new Map(); // device.id -> { instance, device }

function controllerType(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('dualsense')) return 'ps5';
  if (n.includes('dualshock') || n.includes('ps4') || n.includes('ps3')) return 'ps4';
  if (n.includes('xbox')) return 'xbox';
  if (n.includes('switch') || n.includes('pro controller') || n.includes('joy-con') || n.includes('joycon')) return 'switch';
  if (n.includes('wireless controller')) return 'ps4'; // Sony pads report this
  return 'generic';
}

function openAll() {
  for (const device of sdl.controller.devices) {
    if (open.has(device.id)) continue;
    try {
      const instance = sdl.controller.openDevice(device);
      open.set(device.id, { instance, device });
    } catch (e) {
      process.stderr.write('open failed: ' + e.message + '\n');
    }
  }
}

sdl.controller.on('deviceAdd', () => openAll());
sdl.controller.on('deviceRemove', (e) => {
  const id = e && e.device && e.device.id;
  if (id != null) { try { open.get(id) && open.get(id).instance.close(); } catch {} open.delete(id); }
});
openAll();

// W3C "standard" gamepad layout (17 buttons, 4 axes). buttons[6]/[7] carry the
// analog trigger value; sticks are -1..1 so the game's per-axis deadzone gives
// clean 8-direction (diagonal) movement.
function snapshot() {
  const pads = [];
  let index = 0;
  for (const { instance, device } of open.values()) {
    const a = instance.axes || {};
    const b = instance.buttons || {};
    const lt = a.leftTrigger || 0;
    const rt = a.rightTrigger || 0;
    const flags = [
      !!b.a, !!b.b, !!b.x, !!b.y, !!b.leftShoulder, !!b.rightShoulder,
      lt > 0.35, rt > 0.35, !!b.back, !!b.start, !!b.leftStick, !!b.rightStick,
      !!b.dpadUp, !!b.dpadDown, !!b.dpadLeft, !!b.dpadRight, !!b.guide,
    ];
    pads.push({
      index: index++,
      id: device.name || 'Gamepad',
      type: controllerType(device.name),
      buttons: flags.map((p, i) => ({ pressed: p, value: i === 6 ? lt : i === 7 ? rt : (p ? 1 : 0) })),
      axes: [a.leftStickX || 0, a.leftStickY || 0, a.rightStickX || 0, a.rightStickY || 0],
    });
  }
  return pads;
}

// ~60 Hz. The interval also keeps the process (and SDL's event pump) alive.
let last = '';
setInterval(() => {
  const json = JSON.stringify(snapshot());
  if (json !== last || json !== '[]') { // always send while pads exist (live axes); only idle frames dedupe
    last = json;
    try { process.stdout.write(json + '\n'); } catch {}
  }
}, 16);

process.on('SIGTERM', () => process.exit(0));
process.stdout.write('[]\n'); // initial: no pads yet
