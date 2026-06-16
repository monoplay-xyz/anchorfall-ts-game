# MAP AUTHORING CONTRACT

The single source of truth for the **level / tile format** in `holdout-hd`. Every
tool that produces or consumes a level — the **Map Generator (#6)**, the **Map
Builder (#5)** and the **Community DB (#7)** — builds against this contract.

It is derived from the real engine code, not from guesses:

- Tile semantics: `shared/game.ts` → `parseLevel()`, `blocksMove()`,
  `blocksMoveSwim()`, `blocksPath()`, `blocksSight()`, `moveMult()`, `tileAt()`,
  `ENEMY_STATS` (`ENEMY_LETTERS`), `THEMES`.
- LevelDef schema: `types/level.d.ts` (`LevelDef`, `ParsedLevel`, objective/theme
  sub-objects) cross-checked against real JSON under `levels/`.
- Validation rules: `scripts/validate-maps.mjs` (the `PASS` rule, `LEGAL_TILES`,
  `WAVE_LETTERS`, `QUEST_KINDS`, `ART_KEYS`, `BUILD_KINDS`, border/reachability/
  core-count checks, stronghold `waves` math) mirroring `test/sim.test.js`.

A map is **authored** as a JSON `LevelDef`. The only required field is `tiles`
(an ASCII grid). `parseLevel(def)` scans the grid into typed entity arrays in
**pixel** coords (tile center = `(i + 0.5) * TILE`, `TILE = 48`) and rewrites
every consumed marker tile back to `'.'`. Sidecar arrays (`captiveChars`,
`npcs`, `builds`, ...) bind to marker tiles in **row-major scan order**.

---

## 1. TILE LEGEND

`LEGAL_TILES` (from `validate-maps.mjs`, the exhaustive set a stronghold map may
contain) is:

```
#.To~,:;_*=!^%E  +-@/  PcNBCKVWSHDYAIQJXZO  garsmnwbzfqvxu  dehijkly$
```

Every character below is one cell. **walkable** means an operative may stand on
it; **solid** means it blocks movement. Marker tiles (spawns, enemies, entities)
are themselves walkable floor once consumed — `parseLevel` rewrites them to `'.'`.

### 1a. Terrain & floor (no entity; stays in the grid)

| Char | Name | Move | Sight | Shots | Notes |
|------|------|------|-------|-------|-------|
| `#` | Wall (rock) | **solid** | blocks | blocks | The map border must be solid (`#`/`T`/`%`). |
| `T` | Tree | **solid** | blocks | blocks | Blocks move + sight (like a wall). Legal border char. |
| `o` | Cover / sandbag | **solid** | passes | blocks-ish | Blocks movement only; shots/sight handled by structure logic. NOT a legal border char. |
| `%` | Void (shard abyss) | **solid** | blocks | blocks | Blocks move, sight AND shots. Legal border char. |
| `~` | Water | **solid** (swimmers walk it) | passes | passes | `blocksMove` true, but `char.swims` (the Seal) and skiff riders cross it. Counts as non-`PASS` in flood-fill. |
| `!` | Lava | **walkable** | passes | passes | Physically walkable but **searing**: standing on `!` damages players/enemies; `blocksPath` routes A* and enemy steering AROUND it. Waves never spawn into it. |
| `^` | Ice | **walkable** | passes | passes | `ICE_FAST` x1.05 speed + drift momentum (skating). |
| `=` | Sand | **walkable** | passes | passes | `SAND_SLOW` x0.85 movement. |
| `.` | Floor (default) | walkable | — | — | Plain floor. parseLevel rewrites consumed markers to this. |
| `,` | Floor variant | walkable | — | — | Cosmetic floor, plain passable. |
| `:` | Floor variant | walkable | — | — | Cosmetic floor, plain passable. |
| `;` | Floor variant | walkable | — | — | Cosmetic floor, plain passable. |
| `_` | Floor variant | walkable | — | — | Cosmetic floor, plain passable. |
| `*` | Campfire | walkable | — | — | Cosmetic, passable. |
| `E` | Exit / extract | walkable | — | — | Standing on `E` extracts a player (gated by `def.gate.open` if a gate exists). Validator requires every `E` to be reachable. |

**Biome floors** (map-overhaul, also plain-passable floor except where noted):

| Char | Name | Move | Notes |
|------|------|------|-------|
| `+` | Cinder (Emberwaste) | walkable | Plain passable, no speed hook. |
| `-` | Packed snow (Glacis) | walkable | `PACKED_SNOW_SLOW` x0.85 (drags like sand). |
| `@` | Peat (Mire) | walkable | Plain passable; Mire theme seeps toxin ground-patches separately. |
| `/` | Unstable slab (Voidscar) | walkable | Plain passable, no speed hook. |

### 1b. Markers consumed by parseLevel (rewritten to `.`)

Player / friendly:

| Char | Entity | Sidecar (row-major) | Notes |
|------|--------|---------------------|-------|
| `P` | Player spawn | — | At least one required. |
| `c` | Captive (rescuable) | `captiveChars: string[]` | Each `c` pulls one charId in scan order; the id must be a real character. Count must equal sidecar length. |
| `N` | Dialogue NPC | `npcs: NpcDef[]` | `{id,name,lines?,gift?}`. Count == `'N'` tiles. Quest givers reference `npc.id`. |
| `B` | Build site | `builds: BuildDef[]` | `{kind,cost?,prebuilt?,level?,ttype?}`. Count == `'B'` tiles. See build kinds below. |
| `C` | Chest | `chests: ChestDef[]` (by index, optional) | `{loot?,amount?}`. Missing entries cycle `CHEST_LOOTS`. |
| `V` | Vehicle | `vehicles: VehicleDef[]` (by index) | `{kind?}` default `'stag'` (also `'skiff'`). |
| `W` | Watchtower | — | Climbable, hp 20. |
| `S` | Shop / stall | — | Stronghold check: a stall must be ≥ 2.5 tiles from any `B`/`W`. |
| `H` | Hireable hand | `hires: HireDef[]` (by index) | `{cost?,job?,name?}`. job cycles `HIRE_JOBS` = `farmer`/`engineer`/`smith`. |
| `Y` | LYTH crystal node | — | hp 3. |
| `A` | Field-weapon pickup | `pickups: PickupDef[]` (by index) | `{kind?,ammo?}`. kind cycles `FIELD_KINDS` = `flamer`/`railcannon`/`stormgun`/`mortarMk2`. |
| `I` | Quest item | `qitems: QItemDef[]` (by index) | `{id?,kind?}` default kind `'fragment'`. Trails carrier like a captive. |

Objective markers:

| Char | Entity | Sidecar | Notes |
|------|--------|---------|-------|
| `K` | Monolith core / beacon | — | hp 30 (siege core may override via `siege.coreHp`). Count rules below. |
| `D` | CTF flag stand | — | Alternates team by index; CTF needs exactly 2. |
| `Q` | Relay switch | `switches: SwitchDef[]` (by index) | `{id?,group?}`. Quorums in `switchGroups`. |
| `J` | Glyph stone | `glyphs: GlyphDef[]` (by index) | `{id?,symbol? 0-7,group?}`. Orders in `glyphGroups`. |
| `X` | BLS pillar (destructible) | — | hp 12. |
| `Z` | Lythseal forge pad | — | Hold-to-channel pad. |
| `O` | Teleport pad | `teleports: TeleportDef[]` (by index) | `{id?,twin?}`. Default twins consecutive pads (0↔1, 2↔3); odd trailing pad is inert. Validator floods through twins. |

Siege-only emplacements (inert on non-siege maps):

| Char | Entity | Notes |
|------|--------|-------|
| `p` | Neutral siege **prism** emplacement | `siegePrisms`; createGame stamps id/hp only when `mode === 'siege'`. |
| `t` | Timed **trap** emplacement | `siegeTraps`; createGame stamps id/state only when `mode === 'siege'`. |

### 1c. Enemy letters (ENEMY_LETTERS — placed inline, awake by arcade rule)

Each enemy letter spawns `makeEnemy(letter, ...)`. All are walkable floor once
consumed. **Original roster:**

| Char | kind | hp | role |
|------|------|----|----|
| `g` | grunt | 2 | basic melee |
| `a` | archer | 1 | stationary ranged |
| `r` | charger | 3 | rushing melee |
| `s` | bulwark | 5 | slow tank |
| `m` | spawner | 5 | stationary, spawns adds |
| `n` | sniper | 2 | long-range stationary |
| `w` | skitter | 1 | very fast swarmer |
| `b` | boss | 24 | spawner + ranged boss |

**Frontier III roster:**

| Char | kind | hp | role |
|------|------|----|----|
| `z` | husk | 1 | cheap swarm fodder |
| `f` | alpha (Forkling) | 3 | splits into 2 skitters on death |
| `q` | acolyte | 2 | support caster (shields pack, never attacks) |
| `v` | wraith (Volt) | 3 | chain-zap + stun |
| `x` | stalker | 3 | blinks toward prey, melee |
| `u` | beetle (Pyre) | 2 | leaves burn patch on death |

**Biome roster (map-overhaul):**

| Char | kind | hp | role |
|------|------|----|----|
| `d` | molten | 4 | melee; burn patch on death |
| `e` | emberkite | 2 | stationary ranged; one-time flee-blink |
| `h` | frostshade | 3 | melee; chills on contact |
| `i` | glacier | 8 | very slow tank, chill-immune |
| `j` | bogspitter | 2 | stationary ranged toxin glob |
| `k` | phaseborn | 3 | melee; drifts through walls |
| `l` | sandlurker | 3 | buried ambusher, surfaces & charges |
| `y` | wraithv (Vault) | 3 | ranged chain-zap, arcs to 2nd target |
| `$` | brinehulk | 7 | heavy melee; double damage to structures |

> **Nightmare letters** `U F M R G L &` (spider/ghost/reaper/skeleton/zombie/
> hellhound/banshee) are **horde-event only** — they are NOT valid tilemap
> characters and never appear in an authored map.

**`WAVE_LETTERS`** (legal letters for `modifiers.waves[].letters` and a
`bastion.roster`) = the union of both authored rosters:

```
garsmnwbzfqvxu  dehijkly$
```

---

## 2. THE 10 BIOMES (`def.theme`)

`def.theme` names one preset in `THEMES` (game.ts) that pre-fills weather /
darkness / ambient hazard / ground-patch emitter. An explicit `def.weather`
still wins. Six classic looks plus the ten map-overhaul biomes:

**Classic looks:** `lava` (fire bleed), `toxic` (toxin bleed), `nuclear`
(radiation bleed), `storm` (rain + dark), `fire` (fire bleed), `ice` (snow).

**The 10 biomes:**

| Key | Weather | Dark | Hazard character |
|-----|---------|------|------------------|
| `emberwaste` | ashstorm | no | Ash-blasted cinder flats (`+` cinder floor); author-placed `!` lava. |
| `glacis` | snow | no | Glacial; `-` packed-snow drift banks drag movement. |
| `mire` | fog | no | Peat bog (`@`); seeps **toxin** ground-patches (`ambientPatches`). |
| `dunes` | ashstorm | no | Sandstorm reskin; `=` sand drags movement. |
| `verdance` | rain | no | Rain-soaked overgrowth. |
| `voidscar` | none | no | Eerie clear; `%` void edges + `/` unstable slabs. |
| `saltworks` | fog | no | Coastal haze; `~` water flats. |
| `nocturne` | fog | **yes** | Moonlit dark (shrinks aggro / caps sight). |
| `crucible` | ashstorm | no | Seeps **fire** patches (shrinking safe shelves). |
| `reliquary` | none | no | Sacred, clear. |

Hazards reuse existing systems: `lava`/`void` edges are author-placed tiles (no
passive bleed); `mire`/`crucible` emit ground patches; `nocturne` goes dark.
A theme's ambient bleed hazard (`toxin`/`radiation`/`fire`) deals ~0.5 hp / tick
and is negated by the `mask` item.

---

## 3. LEVELDEF SCHEMA (`types/level.d.ts`)

### 3a. Top-level fields

**Identity / presentation:** `name?`, `title?`, `objective?` (UI banner string),
`key?` (stable catalog key, e.g. `"story/ch3"`; seeds music stem + save ids).

**Mode / category tagging:**
- `mode?: 'classic'|'story'|'bastion'|'ctf'|'br'|'siege'` — absent ⇒ un-moded
  `classic`. (`'story'` is usually expressed via `story:true` rather than `mode`.)
- `story?: boolean`, `chapter?: number` — story campaign (untimed).
- `family?: boolean` — gentle co-op (tankier players, softened enemies, untimed).
- `expedition?: boolean` — campaign-catalog UI tag.
- `bastionVariant?: 'beacons'` — bastion sub-mode fielding 4 monoliths.
- `difficulty?: 'easy'|'normal'|'hard'|'extreme'` — feeds `difficultyScale`.

**Tilemap (REQUIRED):** `tiles: string[]` — equal-width ASCII rows.

**Timing:** `time?` (countdown seconds, default 90), `timed?` (force a countdown
on a normally-untimed level), `untimed?` (force no countdown — also implied by
story / bastion / siege / family).

**Look / atmosphere:** `theme?` (see §2), `weather?` (`rain`/`snow`/`ashstorm`/
`fog`; wins over theme), `ambience?` (audio bed key; null allowed),
`modifiers?` (`{dark?, waves?: WaveDef[], toxicAir?:{until?}}`).

**Tile-bound sidecars (row-major / by-index to their marker tile):**
`captiveChars` (`c`), `npcs` (`N`), `builds` (`B`), `chests` (`C`),
`vehicles` (`V`), `hires` (`H`), `pickups` (`A`), `qitems` (`I`),
`switches` (`Q`), `glyphs` (`J`), `teleports` (`O`).

**Alive-world enemy bindings:** `patrols?: PatrolDef[]` (`{at:[tx,ty],
points:[...]}` — 2-4 waypoints per route), `groups?: GroupDef[]` (camps =
arrays of enemy home tiles sharing a group id).

**Puzzle / objective systems (off unless present):** `switchGroups`,
`glyphGroups`, `doors`, `quests`, `gate`, `capture`, `bridge`, `escort`.

**Mode-specific tuning:** `siege` (+`towers`), `br`, `bastion`, `stronghold`,
`enemyStrongholds`.

**Opt-in world features:** `stranded?` (`true` or `{operators?,scrap?}`).

**Narrative:** `intro?`, `outro?` — arrays of `CutscenePanel` `{title,lines[],art}`.

### 3b. Sub-object shapes (key ones)

- **BuildDef** `{kind, cost?, prebuilt?, level?, ttype?}`. `BUILD_KINDS` =
  `pylon | barricade | turret | farm | beacon | wall | comm`. `ttype` (prebuilt
  turret) ∈ `gun | prism | tesla | toxin`. Leveled kinds (wall/turret/barricade)
  honor `level` 1-3.
- **DoorDef** `{id?, x, y, w?=1, h?=1, open?, sealLock?}`. Closed door blocks
  move/sight/shots/A*. Must lie on walkable floor (validator).
- **QuestDef** `{id, main?, title, giver, kind, item?, target?, count?, reward?,
  hint?}`. `kind` ∈ `QUEST_KINDS` = `fetch | kill | build | switch | glyph |
  destroy | craft | reach`. `giver` must be a real `npc.id`. A `fetch` quest's
  `item` must match a `qitems[].kind`.
- **SwitchGroupDef** `{group?, need?, of?, window?, reward?}` — `need` ≤ relays
  in the group.
- **GlyphGroupDef** `{group?, order: number[], reward?}` — every `order` symbol
  is a rune 0-7 and must have a matching stone in the group.
- **WaveDef** `{at, letters, edge}` — `letters` from `WAVE_LETTERS`, `edge` ∈
  `n|s|e|w`.
- **CutscenePanel** `{title, lines (1-3), art}` — `art` ∈ `ART_KEYS` =
  `anchorcraft | crossing | basin | quorum | forkfall | siege | settlement |
  campfire | entropy | dawn`.

### 3c. Objective sub-objects (each gates one win-mechanic)

- **capture** (King-of-the-Hill): `{x,y, radius?, duration?, threshold?, decay?,
  contest?}`. Validator: capture zone must be reachable.
- **bridge** (cross-and-hold): `{armOnReach, holdAt?, reachRadius?}` — only arms
  when `armOnReach` is true; `holdAt` defaults to the core.
- **escort** (mobile anchor): `{path:[≥2 tile waypoints], speed?, holdRadius?,
  hp?}`. An escort map is **coreless** (0 `K`). Every waypoint must be reachable.
- **gate** (Anchor quorum lock): `{need, after?}` — `need` ≤ number of `pylon`
  builds; `E` extract is gated until the gate opens.
- **siege** (MOBA): `{coreHp?, minionInterval?, minionCap?, waveBase?,
  wavePerMin?, lanes?}` + `towers: [{x,y,team,lane?,level?}]`.
- **br** (battle royale): `{shrinks:[{at,r}]}`.
- **bastion** (holdout defense): `{nights?=5, dayLen?, nightLen?, bloodMoons?,
  roster?, wavesPerNight?, waveMult?, bossNights?, endless?, survival?}`.
- **stronghold** (campaign metadata): `{level 1-25, name, sizeLabel S/M/L/XL,
  difficulty 1-5, waves, blurb, newFeatures[], hpMult? 1-2, unlock?}`.
- **enemyStrongholds**: `true | N | opts | sites[]`.

---

## 4. VALIDATION RULES (what makes a map VALID)

`scripts/validate-maps.mjs` is the authority. A valid map must satisfy:

**Grid shape & border**
- Rectangular: every row has the same width as row 0.
- Solid border: the entire first/last row and first/last column are border chars
  (`#`, `T`, or `%`).
- At least one player spawn `P`.

**`PASS` rule (walkable for flood-fill)** — a tile is impassable to the flood
when it is `#`, `T`, `~`, `o`, or `%`. Everything else (floors, `!` lava, `^`
ice, `=` sand, biome floors, markers) is walkable. A closed door tile and a
teleport-twin destination are also treated as reachable.

**Reachability (BFS flood from spawn, through closed doors + teleport twins)** —
every one of these must be reachable: the `core`, every `beacon`, every captive,
every npc, every build site, every relay, every glyph, every pillar, every
forge, every `E` exit, the capture zone, and every escort waypoint.

**Core / beacon count**
- `mode:'bastion'` with `bastionVariant:'beacons'` ⇒ exactly **4** `K`.
- Coreless map (`escort`, or `bastion.survival`) ⇒ **0** `K`.
- Otherwise a core bastion ⇒ exactly **1** `K`.
- `mode:'ctf'` ⇒ exactly **2** flag stands `D`.

**Sidecar parity** — each sidecar array length equals its marker-tile count:
`captiveChars`↔`c`, `npcs`↔`N`, `builds`↔`B`, `pickups`↔`A`, `qitems`↔`I`,
`switches`↔`Q`, `glyphs`↔`J`, `teleports`↔`O`, `chests`↔`C`, `vehicles`↔`V`,
`hires`↔`H`. Every `captiveChars` id must be a real character.

**Markers / doors on walkable floor** — every door rect is in-bounds and every
covered cell is a `PASS` tile (not a wall/cover/void/water).

**Puzzle satisfiability** — each `switchGroup.need` ≤ its relay count; each
`glyphGroup.order` rune (0-7) has a matching stone; teleport `twin` ids resolve;
`openDoor` rewards (quest / switch / glyph) reference a real door id; `gate.need`
≤ pylon count.

**String enums** — quest `kind` ∈ `QUEST_KINDS`; wave `letters` ⊆ `WAVE_LETTERS`
and `edge` ∈ `n/s/e/w`; cutscene `art` ∈ `ART_KEYS` with 1-3 lines and a title.
(Stronghold extra:) `weather` ∈ `clear/rain/snow/ashstorm/fog`; `ambience` ∈
`meadow/forest/swamp/ash/city/night/lava/ship`; build `kind` ∈ `BUILD_KINDS`.

**Stronghold-specific** (`levels/stronghold/*`)
- `mode === 'bastion'`; `stronghold` object present.
- `stronghold.level` 1-25, `sizeLabel` ∈ S/M/L/XL, `difficulty` 1-5,
  non-empty `blurb`, `newFeatures` all strings, ≥ 1 intro slide.
- Every tile ∈ `LEGAL_TILES`.
- **waves math:** with `nights = bastion.nights ?? 5`,
  `wpn = clamp(bastion.wavesPerNight||1, 1, 3)`, `moons = bloodMoons.length`,
  a non-endless map requires `stronghold.waves === nights*wpn + moons*wpn`.
  Endless maps just need a positive sentinel.
- `waveMult` 1-2.6; `hpMult` 1-2; `bossNights` non-empty and each 1..nights;
  `unlock` a real character.
- Patrols 2-4 points with a 2-element home tile; each stall `S` ≥ 2.5 tiles from
  any `B`/`W`.

**Live sim smoke test** — `createGame(def, party, charMap, roster)` must succeed
and `step()` for 60 frames without throwing.

A clean run prints `ALL CLEAN across N levels.` and exits 0.
