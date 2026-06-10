# MISSION: Full content & polish pass on the HOLDOUT game family

You are working in `~/workspace/retrogames-remastered/`, which contains four versions of HOLDOUT, an original top-down tactical action game (squad roster, rescue-the-captive mechanics, reach-the-exit-or-clear-all-enemies levels). All four share the same simulation, netcode, and data formats — they differ only in presentation:

| Folder | Style | Local port |
|--------|-------|-----------|
| `holdout/` | clean vector 2D, canvas | 3000 |
| `holdout-hd/` | HD look, tactical HUD (squad panels, minimap, score) | 3001 |
| `holdout-cyber/` | top-down pixel art, neon-teal terminal chrome | 3002 |
| `holdout-iso/` | isometric 2:1 pixel art, same chrome as cyber | 3003 |

## Architecture you must preserve

- `shared/game.js` — the entire simulation, used by BOTH the Node server (30 Hz authoritative co-op) and the browser (60 fps solo). Exports: `createGame`, `step`, `snapshot`, `applyResults`, `charsById`, `parseLevel`, `TILE`. Each folder has its own copy; if you change the sim, apply the same change to all four and keep them functionally identical.
- `server.js` — express static + WebSocket rooms (host/join/select/start/input messages, room codes, per-room saves in `saves/`). Reads `PORT` from env (Railway runs all four with PORT=8080). Do not break the message protocol.
- `levels/*.json` — `{ name, objective?, time, captiveChars: [], tiles: [ascii rows] }`. Tile chars: `#` wall, `.` floor, `~` water/coolant, `E` exit, `P` spawn, `c` captive, `o` cover (blocks movement, shots pass; v1 doesn't have `o` yet — port it there), `g` grunt, `a` archer. All rows in a level must be the same width. Levels load alphabetically from the folder; the server validates width on boot.
- `shared/characters.json` — `{ id, name, color, speed (tiles/s), starting, weapon: { name, damage, projSpeed, range, cooldown, count, spreadDeg, overWalls } }`.
- `public/assets/` (hd, cyber, iso) — drop-in PNG override slots; procedural art is the fallback. README in each folder documents the slot names.
- Roster rules: downed characters drop as captives; if a level is cleared without rescuing them they are PERMANENTLY lost; failed levels lose nothing. Do not change this — it's the design's core tension.

## Hard constraints

1. **Original content only.** The game is a homage to classic single-screen tactics games — never copy art, names, characters, maps, or audio from any existing game.
2. **No tool can generate bitmap images here, so generate assets programmatically**: write Node scripts (e.g. with `canvas`/`pngjs`, add as devDependency) that render high-quality procedural art and write real PNGs into each game's `public/assets/` slots, and/or upgrade the in-browser procedural bakers. Commit the generator scripts so art is reproducible (`npm run gen-assets` in each folder).
3. Keep solo + co-op working in all four games after every change. Keep save formats backward compatible or migrate them gracefully.
4. Do NOT deploy, push, or touch Railway. Local work only.
5. The repo root also contains a commercial ROM and ISO — ignore them entirely; never read or extract from them.

## Tasks (in priority order)

### 1. Content expansion (shared data — do once, sync to all four folders)
- Grow the roster from 6 to **16 characters**, each visually and mechanically distinct (e.g. piercing railgun, boomerang arc, short-range flamethrower cone, slow heavy AoE mortar, rapid twin pistols, deployable-feel slow tank, fast melee-range shredder…). Extend the weapon schema if needed (e.g. `pierce: true`, `aoeRadius`) and implement those behaviors in `shared/game.js` for all four copies. Balance: faster = weaker, slower = stronger.
- Add **3–4 new enemy types** (e.g. charger that telegraphs then dashes, shielded enemy immune from the front, spawner that emits weak adds, sniper with a visible aim line before firing). New tile letters for them; keep `g`/`a` working.
- Expand from 3 to **10 levels** with a difficulty curve, themed names/objectives, and new tiles if useful (e.g. `>` conveyor, `+` destructible wall — only if you implement them in the sim for all four). Each new character must be obtainable as a captive somewhere; spread them across the campaign.
- A final boss level is welcome if the boss is implemented in the shared sim (multi-HP enemy with phases is fine).

### 2. Game-feel polish (per renderer)
- Screen shake (small, on kills/explosions), hit-stop (1–2 frames on kill), muzzle flashes, shell-casing or spark particles, death animations (not just disappearing), damage flicker on enemies, floating score popups (`+100 x3`), low-time warning pulse, captive rescue celebration effect.
- Respect each version's identity: vector glow for v1, lighting/HD particles for hd, chunky 1px particles for cyber/iso. Iso: keep depth-sorting correct for any new entity.

### 3. Asset generation (hd, cyber, iso)
- Build the `gen-assets` scripts to fill every documented PNG slot with noticeably better art than the runtime fallbacks: richer terrain variants, character portraits with per-character faces/hair/gear (palette from `characters.json` colors), weapon icons. Add new slots for new characters/enemies and document them in each README.

### 4. Audio (procedural, no copyrighted samples)
- WebAudio-synthesized SFX: per-weapon shot sounds, hits, kill, pickup, extraction, level clear/fail stingers, low-timer tick. Master volume toggle persisted in localStorage. Optional: a simple generative ambient loop per version.

### 5. Verification (required after each task block)
- `node --check` every changed JS file.
- Write/extend a headless test script per folder (`npm test`) that runs the sim: every level parses, every character can kill an enemy, every new enemy type can down a player, captive rescue + permanent-loss rules still hold, a scripted bot can clear level 1.
- Boot each server (`PORT=400X node server.js`) and curl `/` and `/api/levels` to confirm 200s. Kill them afterwards.
- Fix everything you break before moving on. Work incrementally: one task block at a time, all four games kept green.

## Definition of done
All four games run locally with: 16 characters, ~4 new enemy types, 10 levels, juiced game feel, generated PNG asset packs (hd/cyber/iso), procedural audio, and passing `npm test` in each folder. Write a `POLISH-REPORT.md` at the repo root summarizing what changed, per game, and any balance numbers you chose.
