# HOLDOUT HD

The HD remaster of HOLDOUT: same simulation and co-op netcode as v1, with a full tactical-HUD presentation — squad panels with portraits, minimap, mission/score panels, weapon readout — and an HD jungle look: procedural terrain textures, pseudo-3D walls, dynamic lighting/vignette, tracers, and muzzle flashes.

```sh
npm install
npm start              # http://localhost:3001
npm test
npm run gen-assets     # rebuild public/assets/*.png from shared/characters.json
npm run gen-expedition # regenerate levels/level11.json (deterministic)
```

## Story campaign — Anchorfall Crossing

Six chapters with intro/outro cutscenes, a persistent roster, and one save
slot: The Long Crossing, Lythium Basin, Broken Quorum, Forkfall, Cluster
Siege (a night defense — dark sight, four enemy waves, a time-locked Anchor),
and Final Settlement. Rescued characters carry across chapters. Menus, lobby,
dialogs and cutscenes are fully gamepad-navigable — no mouse or keyboard
needed (Batocera-ready: see docs/BATOCERA.md and `npm run build-static`).

## Couch co-op (local multiplayer)

The game is built for one screen and a sofa. In a Local Game lobby, every input
device joins by pressing FIRE: up to four players from gamepads (stick/d-pad +
A to fire, Start to pause) plus two keyboard seats (WASD + Space, Arrows +
Enter). Each player steers their own cursor in the character select and locks
in with FIRE. One shared dynamic camera follows the squad and zooms out as you
spread; offscreen teammates, rescues, and the exit get edge arrows.

## Big maps

Maps are no longer bound to one screen. Levels of any size work: the camera,
minimap (with viewport rectangle), and renderer culling handle the rest. On
maps larger than ~600 tiles, enemies start asleep at their posts and wake when
they see a player inside aggro range, take damage, or an ally nearby raises
the alarm — and they pathfind (A*) around walls and water instead of hugging
the nearest wall. Small classic maps keep the original everyone-attacks
arcade behavior.

`levels/level11.json` — **The Long Crossing** (96×64) — is the first
expedition map: a west-to-east journey through a meadow, river fords, deep
forest, a fortified village, a sniper ridge over a swamp, and a boss gate.
Mark a level with `"expedition": true` to get a menu shortcut to it.

## Art pipeline (drop-in PNG overrides)

Every visual is procedural placeholder art first. Drop a PNG into `public/assets/` with the right name and it replaces the placeholder — no code changes:

| File | Replaces |
|------|----------|
| `grass0.png` … `grass5.png` | floor tile variants (48×48) |
| `wall0.png` … `wall2.png` | wall top faces (48×48) |
| `water.png` | water tile (48×48) |
| `sandbags.png` | cover obstacle (48×48) |
| `portrait_<charId>.png` | HUD/character-select portraits (square, e.g. `portrait_scout.png`) |
| `weapon_<charId>.png` | current-weapon HUD icon |
| `enemy_<kind>.png` | generated enemy sprite source art (`grunt`, `archer`, `charger`, `bulwark`, `spawner`, `sniper`, `skitter`, `boss`) |

## New since v1

- `o` tile: sandbag cover — blocks movement, shots fly over it.
- New enemy tiles: `r` charger, `s` bulwark, `m` spawner, `n` sniper, `b` command core boss.
- Weapon extensions: `pierce`, `aoeRadius`, `curve`, `radius`, and `kind`.
- Score system: kills are worth `100 × combo` (combo chains within 2s, up to x9), `+250` per extraction, `+500` per rescue.
- Levels can set an `"objective"` string, shown in the mission panel.

Level and character modding work exactly as in v1 — see `../holdout/README.md`.
