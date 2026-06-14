// Bridge between the native shell and the web game (contextIsolation-safe).
// Phase 1: expose display-mode control for the Settings → Display menu.
// Phase 2 (next): override navigator.getGamepads() with native SDL controller
// state so any pad maps correctly (the same SDL stack Godot uses) with low
// latency — the game keeps calling getGamepads() unchanged.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('anchorfallDesktop', {
  isDesktop: true,
  setDisplayMode: (mode) => ipcRenderer.invoke('display:set-mode', mode),
  getDisplayMode: () => ipcRenderer.invoke('display:get-mode'),
  quit: () => ipcRenderer.invoke('app:quit'),
});
