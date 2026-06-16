// types/level.d.ts — TypeScript contract for the LEVEL DEFINITION (issue #4, TS
// migration). TYPES ONLY: this file is a pure ambient declaration file, no
// runtime code.
//
// It describes three things, in this order:
//   1. LevelDef          — the authored input object handed to parseLevel(def)
//                          and createGame(def, party, charMap, roster). This is
//                          exactly the JSON shape an author writes under levels/
//                          (levels/classic, levels/ctf, levels/stronghold, ...).
//   2. ParsedLevel       — the return value of parseLevel(def): the tilemap
//                          scanned into typed entity arrays (pixel coords).
//   3. Objectives + theme/biome — the per-objective def sub-objects (capture,
//                          bridge, escort, gate, siege, bastion, stronghold,
//                          quests, switches, glyphs, ...) and the named Theme
//                          presets.
//
// All shapes were read directly off shared/game.ts (parseLevel + createGame, the
// // @ts-nocheck source of truth) and cross-checked against real level JSON in
// levels/{classic,ctf,br,siege,story,stronghold,family}. Optional fields are
// preferred over guessing; fields the engine reads with `|| default` or `?? d`
// are marked optional here.

import type { GameMode, PowerupType, Team, Pid, Vec2, Tiles, Px } from './common';

// ===========================================================================
// Small shared aliases
// ===========================================================================

/** A point given in TILE indices (column, row). Authors may write a few of
 *  these as a `[x, y]` pair OR an `{ x, y }` object — createGame's `toTilePx`
 *  normalizes both. */
export type TileCoord = [number, number];
export type TilePoint = TileCoord | { x: number; y: number };

/** One row of the ASCII tilemap; the whole map is `string[]` of equal width. */
export type TileRow = string;

/** Map category / difficulty knob fed to difficultyScale (createGame). */
export type Difficulty = 'easy' | 'normal' | 'hard' | 'extreme' | string;

/** Authorable weather. createGame only honors the four/handful the sim knows
 *  (rain/snow/ashstorm/fog); any other value (e.g. family's "clear") is inert. */
export type Weather = 'rain' | 'snow' | 'ashstorm' | 'fog' | string;

/** Built-structure kinds an author can pre-place via def.builds / 'B' tiles. */
export type BuildKind =
  | 'pylon'
  | 'barricade'
  | 'turret'
  | 'wall'
  | 'farm'
  | 'comm'
  | 'beacon';

/** Turret weapon variants (a prebuilt turret may name one via def.builds[].ttype). */
export type TurretType = 'gun' | 'prism' | string;

/** Deterministic chest loot kinds (def.chests[].loot); also cycled by index. */
export type LootKind =
  | 'shards'
  | 'cracker'
  | 'shield'
  | 'medkit'
  | 'token'
  | 'controller'
  | string;

/** Rideable vehicle kinds (def.vehicles[].kind / 'V' tiles). */
export type VehicleKind = 'stag' | 'skiff' | string;

/** Field-weapon pickup kinds (def.pickups[].kind / 'A' tiles). */
export type FieldWeaponKind = string;

/** Generalized ambient-hazard flavor (theme- or modifier-supplied). */
export type HazardKind = 'toxin' | 'radiation' | 'fire';

// ===========================================================================
// THEME / BIOME
// ===========================================================================
// def.theme names one preset in THEMES (game.ts). Each preset pre-fills weather
// / darkness / an ambient hazard / a ground-patch emitter; an explicit def field
// still wins. The four classic looks plus the ten map-overhaul biomes:
export type Theme =
  // classic looks
  | 'lava'
  | 'toxic'
  | 'nuclear'
  | 'storm'
  | 'fire'
  | 'ice'
  // map-overhaul biomes
  | 'emberwaste'
  | 'glacis'
  | 'mire'
  | 'dunes'
  | 'verdance'
  | 'voidscar'
  | 'saltworks'
  | 'nocturne'
  | 'crucible'
  | 'reliquary';

// ===========================================================================
// LevelDef sub-objects (authored input)
// ===========================================================================

/** A captive/NPC line-runner placed on an 'N' tile (def.npcs, bound row-major). */
export interface NpcDef {
  id: string;
  name: string;
  /** Dialogue lines, cycled on talk. */
  lines?: string[];
  /** One-time gift handed over on first talk (e.g. { shards: 6 }). */
  gift?: { shards?: number; [reward: string]: number | undefined } | null;
}

/** A pre-placeable structure (def.builds, bound row-major to 'B' tiles). */
export interface BuildDef {
  kind: BuildKind;
  /** LYTH cost; defaults vary by kind when omitted. */
  cost?: number;
  /** Ship it already standing & paid (stronghold wall rings). */
  prebuilt?: boolean;
  /** Pre-upgrade level 1..3 for leveled kinds (wall/turret/barricade). */
  level?: number;
  /** Weapon variant for a prebuilt turret ('gun' default). */
  ttype?: TurretType;
}

/** Deterministic chest loot override (def.chests, bound by index to 'C' tiles). */
export interface ChestDef {
  loot?: LootKind;
  amount?: number;
}

/** A vehicle override (def.vehicles, bound by index to 'V' tiles). */
export interface VehicleDef {
  kind?: VehicleKind;
}

/** A hireable hand override (def.hires, bound by index to 'H' tiles). */
export interface HireDef {
  cost?: number;
  job?: string;
  name?: string;
}

/** A field-weapon pickup override (def.pickups, bound by index to 'A' tiles). */
export interface PickupDef {
  kind?: FieldWeaponKind;
  ammo?: number;
}

/** A quest item override (def.qitems, bound by index to 'I' tiles). */
export interface QItemDef {
  id?: string;
  kind?: string;
}

/** A relay switch override (def.switches, bound by index to 'Q' tiles). */
export interface SwitchDef {
  id?: string;
  group?: number;
}

/** A glyph stone override (def.glyphs, bound by index to 'J' tiles). */
export interface GlyphDef {
  id?: string;
  /** Symbol 0..7. Defaults to placement index when omitted. */
  symbol?: number;
  group?: number;
}

/** A teleport pad override (def.teleports, bound by index to 'O' tiles). */
export interface TeleportDef {
  id?: string;
  /** Id of the twin pad; defaults to pairing consecutive pads (0<->1, 2<->3). */
  twin?: string | null;
}

/** A switch-cluster quorum (def.switchGroups). */
export interface SwitchGroupDef {
  group?: number;
  /** How many switches in the group must be on. */
  need?: number;
  /** Total in the group (defaults to the count of matching switches). */
  of?: number;
  /** Optional time window (seconds) all switches must be held together. */
  window?: number;
  reward?: ObjectiveReward | null;
}

/** A glyph-ordering puzzle (def.glyphGroups). */
export interface GlyphGroupDef {
  group?: number;
  /** The exact order glyph symbols must be lit. */
  order?: number[];
  reward?: ObjectiveReward | null;
}

/** A door rect (def.doors): closed it blocks movement/sight/shots/A*. */
export interface DoorDef {
  id?: string;
  /** Top-left tile of the rect. */
  x: number;
  y: number;
  /** Rect size in tiles (default 1x1). */
  w?: number;
  h?: number;
  open?: boolean;
  /** Only a lythseal touch opens it. */
  sealLock?: boolean;
}

/** A quest (def.quests). Hidden until the giver is talked to. */
export interface QuestDef {
  id: string;
  /** Main-line quest (vs side). */
  main?: boolean;
  title?: string;
  /** NPC id that gives/completes the quest. */
  giver: string;
  kind?: string;
  item?: string;
  /** A target tag string, or a reach point (tile coords) for 'reach' quests. */
  target?: string | { x: number; y: number };
  count?: number;
  reward?: ObjectiveReward | null;
  hint?: string;
}

/** A patrol route bound to a sleeping enemy's home tile (def.patrols). */
export interface PatrolDef {
  /** The enemy's home tile [tx, ty]. */
  at: TileCoord;
  /** Waypoint loop, tile coords. */
  points: TileCoord[];
}

/** A camp = a list of enemy home tiles sharing a group id (def.groups[ gi ]). */
export type GroupDef = TileCoord[];

/** Reward payloads granted by switch/glyph/quest completion. Shape is open;
 *  common keys seen in levels are shards/door opens/item grants. */
export interface ObjectiveReward {
  shards?: number;
  door?: string;
  item?: string;
  [k: string]: unknown;
}

/** A "wave" of hunters that pours in at a fixed elapsed time (modifiers.waves). */
export interface WaveDef {
  /** Elapsed seconds at which the wave fires. */
  at: number;
  /** Enemy letters to spawn. */
  letters?: string;
  /** Map edge they enter from. */
  edge?: 'n' | 's' | 'e' | 'w' | string;
}

/** Story / hazard modifiers (def.modifiers). All optional + def-gated. */
export interface LevelModifiers {
  /** Shrink enemy aggro + cap sight (night maps). */
  dark?: boolean;
  /** Timed reinforcement waves. */
  waves?: WaveDef[];
  /** Unmasked operatives bleed until `until` elapsed-seconds (mask item immunity). */
  toxicAir?: { until?: number };
}

// ---- Objective sub-objects (each gates one win-mechanic) ------------------

/** capture_hill (def.capture): a King-of-the-Hill zone. */
export interface CaptureDef {
  /** Zone center, tile coords (either form). */
  x?: number;
  y?: number;
  /** Contested-zone radius in tiles. */
  radius?: Tiles;
  /** Seconds of controlled hold to win. */
  duration?: number;
  /** Active heroes inside required to accrue. */
  threshold?: number;
  /** Meter lost per uncontrolled second. */
  decay?: number;
  /** An enemy inside freezes accrual. */
  contest?: boolean;
}

/** bridge_cross_hold (def.bridge): defer day/night until the far redoubt. */
export interface BridgeDef {
  /** Required: arms the mechanic. */
  armOnReach: boolean;
  /** Reach point in tile coords; defaults to the core. */
  holdAt?: TilePoint;
  /** Reach radius in pixels (defaults to BUILD_REACH). */
  reachRadius?: Px;
}

/** escort_push (def.escort): a mobile anchor crawling a lane (>=2 waypoints). */
export interface EscortDef {
  /** Lane waypoints in tile coords (first is the start). */
  path: TilePoint[];
  /** Tiles/sec the anchor crawls. */
  speed?: number;
  /** Heroes within push / enemies within stall (tiles). */
  holdRadius?: Tiles;
  /** Anchor health. */
  hp?: number;
}

/** Anchor gate time/quorum lock (def.gate): the Anchor opens at full pylon
 *  quorum, but no sooner than `after` seconds. */
export interface GateDef {
  /** Pylons required (quorum). */
  need: number;
  /** Minimum elapsed seconds before it can open. */
  after?: number;
}

/** One siege lane (def.siege.lanes[]). */
export interface SiegeLaneDef {
  waypoints?: TileCoord[];
}

/** Anchor Siege (MOBA) tuning (def.siege), used when mode === 'siege'. */
export interface SiegeDef {
  /** Core HP (tougher than the 30 beacon default). */
  coreHp?: number;
  minionInterval?: number;
  minionCap?: number;
  waveBase?: number;
  wavePerMin?: number;
  lanes?: SiegeLaneDef[];
}

/** A pre-placed siege lane tower (def.towers, siege mode). */
export interface SiegeTowerDef {
  /** Tile coords. */
  x: number;
  y: number;
  team: Team;
  lane?: number;
  level?: number;
}

/** Battle-royale shrink schedule entry (def.br.shrinks[]). */
export interface BrShrinkDef {
  /** Elapsed seconds. */
  at: number;
  /** Target zone radius (tiles). */
  r: Tiles;
}

/** Battle-royale tuning (def.br), used when mode === 'br'. */
export interface BrDef {
  shrinks?: BrShrinkDef[];
}

/** Bastion (holdout-defense) tuning (def.bastion), merged over BASTION_DEFAULTS. */
export interface BastionDef {
  /** Nights to survive (default 5). */
  nights?: number;
  /** Day phase length (default 120s). */
  dayLen?: number;
  /** Night phase length (default 60s). */
  nightLen?: number;
  /** Night numbers that are blood moons (default [3, 5]). */
  bloodMoons?: number[];
  /** Enemy letter roster the waves draw from. */
  roster?: string[];
}

/** Stronghold campaign metadata + enemy strength scaling (def.stronghold). */
export interface StrongholdDef {
  /** Enemy hp multiplier applied once at spawn (1.0 -> ~1.8 across the arc). */
  hpMult?: number;
  /** Catalog/UI metadata (not read by the sim). */
  level?: number;
  name?: string;
  sizeLabel?: string;
  difficulty?: number;
  waves?: number;
  blurb?: string;
  newFeatures?: string[];
}

/** Fortified hostile keep config (def.enemyStrongholds). Accepts several forms:
 *   - `true` / a number  → auto-place N keeps
 *   - an options object  → tuned auto-placement
 *   - an array of sites  → authored keeps. */
export type EnemyStrongholdsDef =
  | boolean
  | number
  | EnemyStrongholdOpts
  | EnemyStrongholdSite[];

export interface EnemyStrongholdOpts {
  count?: number;
  /** Garrison enemy letters. */
  garrison?: string;
  /** Number of garrison enemies (defaults to the garrison-letter count). */
  garrisonCount?: number;
  aggro?: Tiles;
  leash?: Tiles;
  ring?: Tiles;
  hpMult?: number;
}

export interface EnemyStrongholdSite {
  /** Keep center tile [tx, ty]. */
  at?: TileCoord;
  garrison?: string;
  /** Number of garrison enemies (defaults to the garrison-letter count). */
  garrisonCount?: number;
  aggro?: Tiles;
  leash?: Tiles;
  ring?: Tiles;
  hpMult?: number;
}

/** A cutscene panel (def.intro / def.outro), purely narrative. */
export interface CutscenePanel {
  title?: string;
  lines?: string[];
  /** Named art key for the panel background. */
  art?: string;
}

// ===========================================================================
// LevelDef — the authored input to parseLevel() / createGame()
// ===========================================================================
export interface LevelDef {
  // --- identity / presentation ---
  name?: string;
  /** Longer display title (menus/cutscenes). */
  title?: string;
  objective?: string;
  /** Stable catalog key (e.g. "story/ch3"); seeds the music-box stem + save ids. */
  key?: string;

  // --- category / mode tagging ---
  /** Mode tag the sim branches on; absent => the un-moded 'classic' default. */
  mode?: GameMode;
  /** Story-campaign flag (distinguishes 'story' from 'classic'; untimed). */
  story?: boolean;
  /** Story chapter number. */
  chapter?: number;
  /** Family Mode: gentle co-op, generous lives, softened enemies. */
  family?: boolean;
  /** Marks a level as part of the expedition/campaign catalog (UI tag). */
  expedition?: boolean;
  /** Bastion sub-mode: 'beacons' fields four monoliths instead of one core. */
  bastionVariant?: 'beacons' | string;
  difficulty?: Difficulty;

  // --- the tilemap (the only REQUIRED field) ---
  /** ASCII rows, equal width. Letters mark spawns/enemies/structures/objectives;
   *  parseLevel scans them into ParsedLevel and rewrites consumed tiles to '.'. */
  tiles: TileRow[];

  // --- timing ---
  /** Starting countdown seconds (default 90). */
  time?: number;
  /** Opt a normally-untimed level back into a countdown. */
  timed?: boolean;
  /** Force no countdown (also implied by story/bastion/siege/family). */
  untimed?: boolean;

  // --- look / atmosphere ---
  /** Named theme/biome preset (re-skins weather/dark/ambient hazard). */
  theme?: Theme;
  /** Explicit weather (wins over a theme's implied weather). */
  weather?: Weather;
  /** Ambience audio bed key. */
  ambience?: string | null;
  /** Story/hazard modifiers (dark, timed waves, toxic air). */
  modifiers?: LevelModifiers;

  // --- tile-bound entity overrides (each binds row-major / by-index to a tile) ---
  /** Character ids for the 'c' captive tiles, in scan order. */
  captiveChars?: string[];
  npcs?: NpcDef[];          // 'N'
  builds?: BuildDef[];      // 'B'
  chests?: ChestDef[];      // 'C'
  vehicles?: VehicleDef[];  // 'V'
  hires?: HireDef[];        // 'H'
  pickups?: PickupDef[];    // 'A'
  qitems?: QItemDef[];      // 'I'
  switches?: SwitchDef[];   // 'Q'
  glyphs?: GlyphDef[];      // 'J'
  teleports?: TeleportDef[]; // 'O'

  // --- alive-world enemy bindings ---
  patrols?: PatrolDef[];
  groups?: GroupDef[];

  // --- puzzle / objective systems (each null/off unless present) ---
  switchGroups?: SwitchGroupDef[];
  glyphGroups?: GlyphGroupDef[];
  doors?: DoorDef[];
  quests?: QuestDef[];
  gate?: GateDef;
  capture?: CaptureDef;
  bridge?: BridgeDef;
  escort?: EscortDef;

  // --- mode-specific tuning blocks ---
  siege?: SiegeDef;          // mode === 'siege'
  towers?: SiegeTowerDef[];  // siege lane towers
  br?: BrDef;                // mode === 'br'
  bastion?: BastionDef;      // mode === 'bastion'
  stronghold?: StrongholdDef;
  enemyStrongholds?: EnemyStrongholdsDef;

  // --- opt-in world features ---
  /** Seed stranded operators + scrap pickups (setupStranded). `true` uses the
   *  defaults; an options object tunes the counts. */
  stranded?: boolean | { operators?: number; scrap?: number };

  // --- narrative ---
  intro?: CutscenePanel[];
  outro?: CutscenePanel[];
}

// ===========================================================================
// ParsedLevel — the return value of parseLevel(def)
// ===========================================================================
// parseLevel scans def.tiles, emits typed entity arrays in PIXEL coords (tile
// center = (i + 0.5) * TILE), and returns the grid with consumed marker tiles
// rewritten to '.'. createGame then layers mode/objective state on top.

/** A player deploy point ('P'). */
export interface ParsedSpawn extends Vec2 {}

/** A rescuable captive ('c'), bound to a captiveChars id; trails its owner. */
export interface ParsedCaptive extends Vec2 {
  id: string;
  charId: string;
  owner: Pid | null;
  fromPlayer: boolean;
}

/** A parsed enemy (any ENEMY_LETTERS tile). Full runtime AI shape from makeEnemy. */
export interface ParsedEnemy extends Vec2 {
  id: number;
  letter: string;
  kind: string;
  hp: number;
  maxHp: number;
  speed: Px;
  range: Px;
  aggro: Px;
  cool: number;
  spawnCool: number;
  score: number;
  fx: number;
  fy: number;
  hurt: number;
  state: string;
  aimT: number;
  aimX: Px;
  aimY: Px;
  awake: boolean;
  repathT: number;
  path: Vec2[] | null;
  pathI: number;
  homeX: Px;
  homeY: Px;
  returning: boolean;
  hitCool: number;
  /** Phase Stalker blink clock (stalker kind only). */
  blinkT?: number;
  /** Sand Lurker starts buried (sandlurker kind only). */
  buried?: boolean;
  /** Ember Kite one-shot flee state (emberkite kind only). */
  fled?: boolean;
  /** Assigned post-parse by createGame from def.patrols / def.groups. */
  patrol?: Vec2[];
  patrolI?: number;
  group?: number;
  /** runtime AI bookkeeping step() lazily attaches (same shape as entities.Enemy). */
  [key: string]: unknown;
}

/** A dialogue NPC ('N'). */
export interface ParsedNpc extends Vec2 {
  id: string;
  name: string;
  lines: string[];
  /** minted as `nd.gift || null` — never undefined. */
  gift: { shards?: number; [reward: string]: number | undefined } | null;
  lineIdx: number;
  given: boolean;
}

/** A parsed structure ('B'); prebuilt ones ship already standing. */
export interface ParsedBuild extends Vec2 {
  kind: BuildKind;
  cost?: number;
  progress: number;
  paid: number;
  built: boolean;
  hp: number;
  maxHp: number;
  cool: number;
  evT: number;
  /** Farm growth (farm kind only). */
  stage?: number;
  growT?: number;
  /** Upgrade level (leveled kinds only). */
  level?: number;
  /** LYTH sunk (prebuilt only). */
  invested?: number;
  /** Turret weapon variant (prebuilt turret only). */
  ttype?: TurretType;
  /** runtime gnaw/build bookkeeping step() lazily attaches (entities.Build). */
  [key: string]: unknown;
}

/** A LYTH crystal node ('Y'). */
export interface ParsedCrystal extends Vec2 {
  cid: number;
  hp: number;
}

/** A loot chest ('C'). */
export interface ParsedChest extends Vec2 {
  opened: boolean;
  loot: LootKind;
  amount: number;
}

/** A rideable vehicle ('V'). */
export interface ParsedVehicle extends Vec2 {
  id: string;
  kind: VehicleKind;
  rider: Pid | null;
}

/** A climbable watchtower ('W'). */
export interface ParsedTower extends Vec2 {
  level: number;
  hp: number;
  maxHp: number;
  occupant: Pid | null;
}

/** A shop/stall ('S'). */
export interface ParsedShop extends Vec2 {}

/** A hireable hand ('H'). */
export interface ParsedHire extends Vec2 {
  cost: number;
  job: string;
  hired: boolean;
  name: string;
}

/** A CTF flag/banner ('D'); alternates team by index. */
export interface ParsedFlag extends Vec2 {
  team: number;
  homeX: Px;
  homeY: Px;
  carrier: Pid | null;
  atBase: boolean;
  dropT: number;
}

/** A field-weapon pickup ('A'). */
export interface ParsedPickup extends Vec2 {
  id: string;
  kind: FieldWeaponKind;
  ammo: number;
}

/** A quest item ('I'); trails its carrier like a captive. */
export interface ParsedQItem extends Vec2 {
  id: string;
  kind: string;
  carrier: Pid | null;
}

/** A relay switch ('Q'). */
export interface ParsedSwitch extends Vec2 {
  id: string;
  on: boolean;
  group: number;
}

/** A glyph stone ('J'). */
export interface ParsedGlyph extends Vec2 {
  id: string;
  symbol: number;
  lit: boolean;
  group: number;
}

/** A destructible BLS pillar ('X'). */
export interface ParsedPillar extends Vec2 {
  id: string;
  hp: number;
  maxHp: number;
}

/** A lythseal forge pad ('Z'). */
export interface ParsedForge extends Vec2 {
  holdT: number;
}

/** A teleport pad ('O'); twin resolved after the full scan. */
export interface ParsedTeleport extends Vec2 {
  id: string;
  twin: string | null;
}

/** A neutral siege prism emplacement ('p'); pixel coords only (createGame
 *  stamps id/hp once it knows the map is siege). Inert on non-siege maps. */
export interface ParsedSiegePrism extends Vec2 {}

/** A timed-trap emplacement ('t'); pixel coords only until createGame. */
export interface ParsedSiegeTrap extends Vec2 {}

/** A monolith core ('K'); beacon-defense maps field four. */
export interface ParsedCore extends Vec2 {
  hp: number;
  maxHp: number;
}

/** The full return value of parseLevel(def). */
export interface ParsedLevel {
  /** The tilemap rejoined to string rows, consumed markers rewritten to '.'. */
  grid: string[];
  /** Width in tiles. */
  w: number;
  /** Height in tiles. */
  h: number;
  spawns: ParsedSpawn[];
  captives: ParsedCaptive[];
  enemies: ParsedEnemy[];
  npcs: ParsedNpc[];
  builds: ParsedBuild[];
  crystals: ParsedCrystal[];
  chests: ParsedChest[];
  vehicles: ParsedVehicle[];
  towers: ParsedTower[];
  shops: ParsedShop[];
  hires: ParsedHire[];
  flags: ParsedFlag[];
  pickups: ParsedPickup[];
  qitems: ParsedQItem[];
  switches: ParsedSwitch[];
  glyphs: ParsedGlyph[];
  pillars: ParsedPillar[];
  forges: ParsedForge[];
  teleports: ParsedTeleport[];
  siegePrisms: ParsedSiegePrism[];
  siegeTraps: ParsedSiegeTrap[];
  /** First 'K' core (single-core maps); null on beacon/siege maps. */
  core: ParsedCore | null;
  /** Every 'K' core (beacon-defense maps read all four). */
  cores: ParsedCore[];
}
