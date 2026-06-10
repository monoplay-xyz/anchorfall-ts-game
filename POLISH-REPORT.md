# HOLDOUT Polish Report

## Shared Campaign And Simulation

- Expanded the roster from 6 to 16 original operatives.
- Starting roster: Scout, Soldier, Grenadier, Medic.
- Unlock roster: Sniper, Raider, Pyro, Bastion, Engineer, Duelist, Volt, Boomer, Warden, Shade, Helix, Atlas.
- Added weapon schema extensions:
  - `kind` for renderer/audio flavor.
  - `pierce` for extra hits.
  - `aoeRadius` for tile-scale blast damage.
  - `curve` for arcing disc/helix projectiles.
  - `radius` for larger projectile hit circles.
- Added enemy tiles:
  - `r` Charger: telegraphs, then dashes.
  - `s` Bulwark: front shield blocks shots.
  - `m` Spawner: fires spores and emits skitters.
  - `n` Sniper: visible aim line before firing.
  - `b` Command core boss: multi-HP phase enemy.
- Added spawned `skitter` enemies from spawners/bosses.
- Synchronized `shared/game.js`, `shared/characters.json`, and `levels/*.json` across all four variants.
- Expanded the campaign to 10 levels with all 12 non-starting operatives obtainable as captives.
- Ported `o` cover to the v1 simulation and levels.

## Balance Notes

- Fast operatives use lower damage and shorter range: Duelist speed 5.0 with 1.7-tile shredder, Raider speed 4.7 with 3.6-tile twin pistols.
- Slow operatives hit hardest: Atlas speed 1.9 with 5 damage and 1.35-tile AoE; Bastion speed 2.0 with 4 damage and 0.75-tile AoE.
- Kill score is enemy base score times combo. Combo chains for 2 seconds and caps at x9.
- Extraction awards +250; each carried rescue awards +500.

## Per Game Polish

- `holdout/`: vector renderer now supports cover, new enemy silhouettes, sniper aim lines, muzzle flashes, explosions, screen shake, score popups, rescue popups, low-time pulse, and damage flicker.
- `holdout-hd/`: tactical renderer now supports all enemy types, shield/boss visual accents, aim lines, generated weapon icons, screen shake, HD particles, score/rescue popups, explosion feedback, and low-time feedback.
- `holdout-cyber/`: pixel renderer now loads generated PNG tile/enemy overrides, draws all enemy types, pixel aim lines, integer screen shake, chunky particles, score/rescue popups, and boss/bulwark markers.
- `holdout-iso/`: isometric renderer now loads generated diamond terrain/wall/crate/enemy overrides, preserves depth sorting for entities, adds projected popups/particles, screen shake, sniper aim lines, and boss/bulwark markers.

## Assets

- Added reproducible `npm run gen-assets` for `holdout-hd/`, `holdout-cyber/`, and `holdout-iso/`.
- Generator: `scripts/gen-assets.js`, using `pngjs`.
- Generated 51 PNGs per styled variant:
  - terrain variants,
  - cover/coolant assets,
  - 16 portraits,
  - 16 weapon icons,
  - 8 enemy sprites/source assets.
- Updated each styled README with documented slot names.

## Audio

- Added `public/audio.js` to all variants.
- WebAudio synth SFX cover weapon shots, hits, walls/shields, kills, explosions, pickups, extraction/clear, failures, low-time warnings, and spawns.
- Added a persisted master audio toggle in each main menu.

## Tests And Verification

- Added `npm test` in all four folders.
- Test coverage checks:
  - all levels parse,
  - all non-starting characters are obtainable,
  - every character can kill a grunt,
  - each new enemy type can down a player,
  - rescue and permanent-loss rules,
  - scripted bot clears level 1.
- Passed `npm test` in:
  - `holdout/`
  - `holdout-hd/`
  - `holdout-cyber/`
  - `holdout-iso/`
- Passed `node --check` for all changed JS files.
- Boot/curl verification passed:
  - `holdout` on port 4000: `/` 200, `/api/levels` 200, 10 levels.
  - `holdout-hd` on port 4001: `/` 200, `/api/levels` 200, 10 levels.
  - `holdout-cyber` on port 4002: `/` 200, `/api/levels` 200, 10 levels.
  - `holdout-iso` on port 4003: `/` 200, `/api/levels` 200, 10 levels.

## Known Verification Gap

- In-app Browser visual smoke testing could not be completed because the Browser plugin reported the `iab` browser as unavailable in this session.
