# HOLDOUT HD

The HD remaster of HOLDOUT: same deterministic simulation and co-op netcode as
v1, with a full tactical-HUD presentation — squad panels with portraits,
minimap, mission/score panels, weapon readout — and a cold moonlit
"Monolythium: Anchorfall" look: procedural terrain textures, pseudo-3D walls,
dynamic lighting/vignette, tracers, and muzzle flashes.

```sh
npm install
npm start              # http://localhost:3001
npm test
npm run gen-assets     # rebuild public/assets/*.png from shared/characters.json
npm run gen-expedition # regenerate levels/story/ch01.json (deterministic)
npm run build-static   # serverless dist/ build for Batocera (docs/BATOCERA.md)
```

## Game modes

45 levels across five categories (`levels/<category>/`), all served by
`/api/levels` and all playable solo or couch co-op:

- **Classic Campaign** — the 10 original arcade levels: one screen, one-hit
  operatives, a countdown clock, rescue the captives, reach the exit.
- **Story: Anchorfall Crossing** — eight chapters with intro/outro cutscenes,
  a persistent roster, and one save slot: *The Long Crossing*, *Lythium
  Basin*, *Broken Quorum*, *Forkfall*, *Cluster Siege*, *Final Settlement*,
  *The Anchorcraft*, and *The Prover Array*. Rescued operatives carry across
  chapters; save beacons checkpoint runs mid-chapter. Story missions are
  untimed — the clock counts up.
- **Stronghold** — a 25-level siege-survival campaign (`sh01`–`sh25`).
  Day/night cycles with blood-moon nights, LYTH-shard economy, build sites
  (walls, barricades, farms, and Gun / Prism / Tesla / Toxin turrets), and a
  core (or four beacon monoliths) to keep alive. Beating a stronghold unlocks
  the next; clears also unlock new operatives — the roster grows from the 4
  starters (Scout, Soldier, Grenadier, Medic) toward all 17.
- **Versus — couch** (2–4 players, one screen, no AI enemies):
  **Capture the Flag** (two teams, per-team shard pools, first to the cap
  limit) and **Battle Royale** (free-for-all on a shrinking zone — couch BR
  always splits the screen so opponents never share a camera).
- **Online** — host Classic, Story, Stronghold, CTF, or Battle Royale rooms,
  or join with a 4-letter code. Up to 4 couch seats per machine, 8 players
  per room. Each machine splitscreens only its own local seats.

## Couch co-op (local multiplayer)

The game is built for one screen and a sofa. In a local lobby, every input
device joins by pressing FIRE: up to four local players, drawn from up to four
gamepads and two keyboard seats (WASD and Arrows). Each player steers their
own cursor in the character select
and locks in with FIRE. Menus, lobbies, dialogs and cutscenes are fully
gamepad-navigable — no mouse or keyboard needed anywhere.

### Controls (defaults)

| Action | Keyboard 1 | Keyboard 2 | Gamepad |
|---|---|---|---|
| Move | WASD | Arrows | left stick / d-pad |
| Fire (and join a lobby) | Space | Enter | A / RT |
| Special | F | Right Shift | B / RB |
| Talk / Build (hold) | E | / | X |
| Item (use / drop weapon) | Q | . | Y |
| Full map (hold) | Tab | M | Select/Back |
| Pause | Esc | Backspace | Start |

Every binding above is a **default**: Settings → **Input remapping** rebinds
any action per device (Keyboard WASD, Keyboard Arrows, Gamepad) — pick the
action, press the new key/button, Esc cancels. A key already bound on that
device moves to the new action (the old one unbinds), each device has a
one-press reset to defaults, and overrides persist in the browser.

An in-game **controls overlay** (corner panel, toggle in Settings, remap-aware)
shows the live bindings plus contextual hints near shops, build sites, turret
carousels, and towers.

## Dynamic splitscreen

With 2+ local players the couch camera can split into per-player viewports on
the one canvas. Settings → **Splitscreen** cycles three modes (persisted,
default *Dynamic*):

- **Off** — the classic single shared camera that zooms out as the squad
  spreads, with edge arrows to offscreen teammates and objectives.
- **Dynamic** — one shared camera while everyone fits at a readable zoom;
  when the squad spreads past it the screen splits, and it merges back when
  they regroup (hysteresis prevents border flicker; the split/merge animates
  in 0.25s).
- **Always** — split whenever 2+ local players are deployed.

Layouts: 2 players get vertical halves (P1 left); 4 players get 2×2 quadrants
in seat order; 3 players get a 2×2 grid whose fourth cell is a fog-aware
tactical full-map view. Each viewport runs its own camera with its own edge
arrows, prompts, and a name+hearts chip; global banners, wave countdowns, and
cutscenes stay full-screen. Couch Battle Royale forces Always while more than
one local player is in the match. Online sessions split only that machine's
seats.

## Fog of war

Story, Stronghold, and expedition missions start with an unexplored minimap:
terrain reveals as any squadmate's sight uncovers it, and the hold-to-view
full-map overlay (Tab / M / Select) respects the same exploration ledger —
objective markers only show in explored territory. Versus and Classic arcade
missions keep their full minimap.

## Big maps

Maps are no longer bound to one screen. Levels of any size work: the camera,
minimap (with viewport rectangle), and renderer culling handle the rest. On
maps larger than 600 tiles, enemies start asleep at their posts and wake when
they see a player inside aggro range, take damage, or an ally nearby raises
the alarm — and they pathfind (A*) around walls and water instead of hugging
the nearest wall. Small classic maps keep the original everyone-attacks
arcade behavior.

Mark a level with `"expedition": true` to get a menu shortcut to it.

## Audio

The HOLDOUT audio pack lives in `public/assets/audio/` (~460 ogg clips:
day/night/situation ambient beds, interaction cues, enemy combat vocals, NPC
voice lines, crash effects) plus the EVA voice pack in `public/assets/voice/`
(`*.m4a`). Playback is asset-first with deterministic clip rotation (every
couch hears the same take order); any missing or still-loading clip falls
back to the procedural synth engine, so the game never goes quiet and never
throws. Audio wakes on the first click or button press and toggles in
Settings.

## Art pipeline (drop-in PNG overrides)

Every visual is procedural first. Drop a PNG into `public/assets/` with the
right name and it replaces the baked art — no code changes:

| File | Replaces |
|------|----------|
| `<terrainKey>.png` | a 48×48 floor/obstacle texture variant — keys: `meadow0`…`meadow5`, `forest0`…`forest3`, `swamp0`…`swamp3`, `stone0`…`stone3`, `ash0`…`ash3`, `sand0`…`sand2`, `ice0`…`ice2`, `water0`…`water2`, `lava0`…`lava2`, `rock0`…`rock2`, `tree0`…`tree3`, `sandbags2`, `firebase` |
| `portrait2_<charId>.png` | HUD/character-select portraits (square, e.g. `portrait2_scout.png`) |
| `weapon2_<charId>.png` | current-weapon HUD icon |

(The v1 `grass*/wall*/portrait_*/weapon_*/enemy_*` filenames are legacy and no
longer looked up.)

## Scoring

Kills are worth `100 × combo` (combo chains within 2s, up to ×9), `+250` per
extraction, `+500` per rescue.

Level and character modding work exactly as in v1 — see `../holdout/README.md`.
