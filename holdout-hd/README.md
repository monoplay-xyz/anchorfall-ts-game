# HOLDOUT HD

The HD remaster of HOLDOUT: same simulation and co-op netcode as v1, with a full tactical-HUD presentation — squad panels with portraits, minimap, mission/score panels, weapon readout — and an HD jungle look: procedural terrain textures, pseudo-3D walls, dynamic lighting/vignette, tracers, and muzzle flashes.

```sh
npm install
npm start          # http://localhost:3001
npm test
npm run gen-assets # rebuild public/assets/*.png from shared/characters.json
```

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
