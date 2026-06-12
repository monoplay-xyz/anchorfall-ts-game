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

48 levels across five categories (`levels/<category>/`), all served by
`/api/levels` and all playable solo or couch co-op:

- **Classic Campaign** — the 10 original arcade levels: one screen, one-hit
  operatives, a countdown clock, rescue the captives, reach the exit.
- **Story: Anchorfall Crossing** — eleven chapters with intro/outro
  cutscenes, a persistent roster, and one save slot. Acts I–II: *The Long
  Crossing*, *Lythium Basin*, *Broken Quorum*, *Forkfall*, *Cluster Siege*,
  *Final Settlement*, *The Anchorcraft*, *The Prover Array*. Act III crosses
  the unsettled Drift to the Entropy's source: *The Drift Sea* (a void-sea
  archipelago of skiff channels and teleport wave-tunnels), *The Burned
  Names* (a necropolis of glyph rites under ashstorm weather), and *Genesis
  Drift* (the first Anchor ever settled — a three-act, multi-boss finale).
  Rescued operatives carry across chapters; save beacons checkpoint runs
  mid-chapter. Story missions are untimed — the clock counts up.
- **Stronghold** — a 25-level siege-survival campaign (`sh01`–`sh25`).
  Day/night cycles with blood-moon nights, LYTH-shard economy, build sites
  (walls, barricades, farms, and Gun / Prism / Tesla / Toxin turrets), and a
  core (or four beacon monoliths) to keep alive. Days carry scheduled beats —
  a scavenger probe noses in at day+25s and a supply drop lands at day+45s —
  and any operative can hold ACT at the core (or a lit beacon) to **sound the
  horn**: the night comes early and the pool banks the skipped time as shards.
  Every level's TOTAL waves (blood-moon second edges included) fits a
  {3, 5, 7, 10} budget — early levels run 5, the mid arc 7, the late arc up
  to 10, and no stronghold ever exceeds 10. Beating a stronghold unlocks
  the next; clears also unlock new operatives — the roster grows from the 4
  starters (Scout, Soldier, Grenadier, Medic) toward all 17.
- **Versus — couch** (2–4 players, one screen, no AI enemies):
  **Capture the Flag** (two teams, per-team shard pools, first to the cap
  limit; a tied clock goes to sudden death, and overtime escalates — every
  20s both teams' respawns stretch +1s up to +5, dropped flags return twice
  as fast past the minute, and the HUD pins **OVERTIME +n**) and **Battle
  Royale** (free-for-all on a shrinking zone — couch BR always splits the
  screen so opponents never share a camera).
- **Online** — host Classic, Story, Stronghold, CTF, or Battle Royale rooms,
  or join with a 4-letter code. Up to 4 couch seats per machine, 8 players
  per room. Each machine splitscreens only its own local seats. Rooms
  survive a host disconnect (leadership migrates to the oldest remaining
  connection; a room only closes when empty), and a dropped player's seats
  are held for 120s — rejoining with the same name and room code mid-level
  reclaims them through the respawn-pick flow.

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

Online, big maps are internet-ready: the server serializes snapshots per
connection, trimming the bulk swarms (enemies, shots, drops, ground patches,
crackers) to a 26-tile interest area around that connection's seats — while
players, flags, builds, cores, and every other gameplay-critical entity
always ship in full. A compact global enemy array rides every 3rd tick so
the minimap keeps working beyond the interest radius, and a connection
falling behind (>256KB buffered) skips state ticks until it catches up —
mission-critical messages (level start/end, lobby, cutscenes) are never
skipped. Local sessions keep full snapshots.

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

## Rankings

Every level has a leaderboard (main menu → **Rankings**): top 50 runs per
board, ranked by score with completion time breaking ties, with a
score/fastest sort toggle and your latest run highlighted. Boards are keyed
`<category>/<filename-stem>` (e.g. `story/ch01`, `stronghold/sh17`) and
persist server-side in `saves/rankings.json` (atomic writes).

- **Online rooms** record every level clear automatically, server-side —
  the party's names, score, and elapsed time. CTF records the winning
  team at `captures × 1000` points with the match length as the time;
  Battle Royale records the champion's kills the same way.
- **Local sessions** served by a server POST their clears to
  `/api/rankings` (validated, clamped, rate-limited 10/min per IP, marked
  `online:false`).
- **Static builds** (no server) keep personal bests in `localStorage`; the
  Rankings page shows those, labelled as local bests.

A run that places top 50 toasts `RUN RECORDED — #rank`. REST surface:
`GET /api/rankings` (boards with entries), `GET /api/rankings/<cat>/<stem>`
(one board), `POST /api/rankings` (local-run submission).

Level and character modding work exactly as in v1 — see `../holdout/README.md`.
