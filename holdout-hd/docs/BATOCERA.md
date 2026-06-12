# MONOLYTHIUM — THE ANCHORFALL on Batocera (couch co-op, 4 controllers)

Local play (solo, couch co-op, the story campaign) runs entirely in the
browser — no Node needed on the box. Batocera ships Python (for the tiny
file server) and can run Chromium.

## Setup

1. Build the static bundle on your dev machine:

   ```sh
   cd holdout-hd
   npm run build-static     # writes dist/
   ```

2. Copy `dist/` to the Batocera box, e.g. over the network share:

   ```
   \\BATOCERA\share\roms\ports\holdout\      (i.e. /userdata/roms/ports/holdout/)
   ```

3. Create `/userdata/roms/ports/Monolythium - The Anchorfall.sh`:

   ```bash
   #!/bin/bash
   bash /userdata/roms/ports/holdout/play.sh
   ```

   Make it executable, then refresh the games list (Start → Game Settings →
   Update Gamelists). It appears under **Ports**.

   `play.sh` starts a local Python file server and opens Chromium in kiosk
   mode. If your Batocera build has no `chromium` binary, install the
   Chromium flatpak once (Batocera v35+: flatpaks appear under EmulationStation
   when enabled) — `play.sh` tries the flatpak automatically.

## Controllers

The game uses the browser Gamepad API — pads just work, including DualSense
(PS5), DualShock 4, Xbox and most generic pads, up to 4 at once:

| Action | PS5 | Xbox |
|---|---|---|
| Move | left stick / d-pad | left stick / d-pad |
| Fire | Cross or R2 | A or RT |
| Talk / Build (hold) | Square | X |
| Special | Circle or R1 | B or RB |
| Item (use / drop weapon) | Triangle | Y |
| Full-map overlay (hold) | Select (Create/Share) | Back/View |
| Pause / menu nav | Options | Start |

**Hold Select for the map**: on Story, Stronghold, and expedition missions the
full-map overlay is fog-of-war aware — it only shows territory the squad has
explored.

These are the defaults. **Settings → Input remapping** rebinds any action per
device (each keyboard seat and the shared gamepad layout): pick the action,
press the new button, done — bindings persist in the browser, with a one-press
reset per device. The in-game controls overlay always shows the live,
remap-aware bindings.

Everyone presses FIRE in the lobby to join — no keyboard or mouse needed
anywhere, menus are fully pad-navigable. With 2+ pads, Settings → Splitscreen
(Off / Dynamic / Always) controls the couch camera; couch Battle Royale always
splits.

## Audio

The full Anchorfall audio pack (~460 ogg ambient/effects/voice clips plus the
EVA `.m4a` voice pack) ships inside `dist/assets/` — no extra download.
`play.sh` launches Chromium with autoplay enabled so sound starts immediately;
in a plain browser, audio wakes on the first click or button press. If a clip
ever fails to load, the built-in synth engine covers the cue — the game never
goes silent. The audio toggle lives in Settings.

## Alternative: LAN server (enables online co-op too)

Run the full game on any PC on your network:

```sh
cd holdout-hd && npm start    # http://<pc-ip>:3001
```

and open that URL in the Batocera browser. Same couch experience, plus the
Host/Join online co-op rooms work.

## Performance

Canvas 2D at 1280×720 — any box that runs Batocera comfortably runs this.
If the TV overscans, use Chromium's `--force-device-scale-factor=0.9`.
