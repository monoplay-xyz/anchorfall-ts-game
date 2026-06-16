// types/entities.d.ts — INTERNAL sim-state contract for the TS migration (issue #4).
//
// This describes the RUNTIME shape of the deterministic sim: the Game state
// object `g` that `createGame()` returns and `step()` mutates, plus the entity
// records it carries. It is DISTINCT from the wire `Snapshot` (snapshot.d.ts):
// the snapshot is a culled, flattened projection serialized for clients; the
// shapes here are the full mutable in-memory records (with all the bookkeeping
// fields step() reads/writes that never reach the wire).
//
// Every shape below was read directly from shared/game.ts — createGame()
// (game.ts:951), parseLevel()/makeEnemy() (game.ts:713/775), spawnPlayer()
// (game.ts:1729), the per-system spawn sites, and step() (game.ts:6467).
// Where a field is genuinely heterogeneous or only present under a mode/def
// flag it is marked optional rather than over-tightened; index signatures are
// avoided in favor of explicit optionals so consumers get real completion.
//
// This file holds ONLY type declarations (no runtime code).

import type {
  GameMode,
  GameEventType,
  PowerupType,
  Team,
  Pid,
  Vec2,
  Tiles,
  Px,
} from './common';
import type { CharacterMap } from './character';

// ===========================================================================
// Small shared shapes
// ===========================================================================

/** A carrier reference. Most pickups/objects record their carrier as the
 * holding player's `pid` (a number); `null` means dropped/on the ground. */
export type Carrier = Pid | null;

/** A consumable item slot ('cracker' | 'medkit' | 'mask', and any future
 * placeable bought into the slot). Stacks by `kind`. */
export interface ItemSlot {
  kind: string;
  count: number;
}

/** An inventory slot (RA2 buy-then-place deck: walls/turrets/barricades). */
export interface InventorySlot {
  kind: string;
  count: number;
}

/** A field weapon a player is carrying ('A' pickups + dropped weapons). */
export interface FieldWeaponHeld {
  kind: string;
  ammo: number;
}

/** A per-direction edge-latch ({left,right,fire}) for menu/selection cursors. */
export interface DirLatch {
  left: boolean;
  right: boolean;
  fire: boolean;
}

// ===========================================================================
// Player
// ===========================================================================
// spawnPlayer() (game.ts:1729) mints the base shape; createGame() layers on
// survival fields (hp/maxHp/shield/item/xp/level) on non-arcade maps, plus
// team/kills in pvp/siege. step() lazily adds many transient/status fields.
export interface Player {
  pid: Pid;
  name: string;
  /** roster id; null while downed (the seat is held by a captive). */
  charId: string | null;
  x: Px;
  y: Px;
  /** Facing unit vector (fx, fy). */
  fx: number;
  fy: number;
  cool: number;
  /** 'active' on the field; 'down'/'out'/'picking' etc. while incapacitated. */
  state: string;
  respawn: number;
  invuln: number;
  specialCool: number;
  dashT: number;
  dashFx: number;
  dashFy: number;
  stimT: number;
  // input edge-latches (so held buttons fire once)
  actPrev: boolean;
  specialPrev: boolean;
  itemPrev: boolean;

  // --- survival fields (non-arcade maps only) ---
  hp?: number;
  maxHp?: number;
  shield?: number;
  item?: ItemSlot | null;
  xp?: number;
  level?: number;

  // --- pvp / team fields ---
  /** Team slot in ctf/siege (0|1); in br the sim sets team = pid. */
  team?: Team | Pid;
  kills?: number;

  // --- carried objects (each null when not carrying) ---
  /** A field weapon ('A' pickup) the operative is wielding. */
  fieldWeapon?: FieldWeaponHeld | null;
  /** The vehicle id currently ridden (skiff/stag), or null on foot. */
  riding?: string | null;

  // --- buy/shop upgrades ---
  dmgBonus?: number;
  /** True once the operative owns a gas mask (ambient-hazard immunity). */
  mask?: boolean;

  // --- stamina / sprint ---
  stamina?: number;
  staminaMax?: number;

  // --- status timers (ride on the operative; absent on classics) ---
  stunT?: number;
  chillT?: number;
  lavaT?: number;
  siegeSlow?: number;
  siegeSlowT?: number;
  teleCool?: number;

  // --- RA2 inventory + placement mode ---
  inventory?: InventorySlot[];
  /** The placeable kind being positioned, or undefined when not placing. */
  placing?: string;
  ghostX?: Px;
  ghostY?: Px;
  ghostPrev?: { up: boolean; down: boolean; left: boolean; right: boolean };
  wallAnchorX?: Px;
  wallAnchorY?: Px;
  placeFirePrev?: boolean;
  placeActPrev?: boolean;
  placeCancelPrev?: boolean;

  // --- superweapon build/fire edge-latches ---
  superBuildPrev?: boolean;
  superFirePrev?: boolean;

  // --- menu / selection edge-latches ---
  shopping?: boolean;
  shopIdx?: number;
  /** shop cursor edge-latch (per-direction booleans). */
  shopPrev?: DirLatch;
  selecting?: boolean;
  /** turret-select cursor edge-latch (per-direction booleans). */
  selPrev?: DirLatch;
  invIdx?: number;
  invPrev?: boolean;
  pickIdx?: number;
  /** char-pick cursor edge-latch (per-direction booleans). */
  pickPrev?: DirLatch;
  dropPrev?: boolean;
  itemHoldT?: number;
  itemHoldFired?: boolean;

  // --- ship boarding (early-extraction) ---
  aboard?: boolean;

  // --- misc objective/structure interaction ---
  /** index into g.towers of the watchtower the seat is mounted on, or null. */
  towerId?: number | null;
  lythseal?: boolean;
  zoneT?: number;
  channelT?: number;

  // --- ambient-hazard bleed (toxic air) + render-lean move delta ---
  airT?: number;
  airAcc?: number;
  mvX?: number;
  mvY?: number;

  // The sim attaches further ad-hoc fields under specific modes; allow them.
  [key: string]: unknown;
}

// ===========================================================================
// Enemy
// ===========================================================================
// makeEnemy() (game.ts:713). kind-specific extras (blinkT/buried/fled) and
// stronghold/leash/group fields are conditional; spawn-time mutations and
// runtime AI state (path/aim/hurt) are always present.
export interface Enemy {
  id: number;
  letter: string;
  kind: string;
  x: Px;
  y: Px;
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

  // --- kind-specific (conditional at spawn) ---
  /** Phase Stalker blink clock. */
  blinkT?: number;
  /** Sand Lurker starts buried (untargetable until a player nears). */
  buried?: boolean;
  /** Ember Kite single flee-blink latch. */
  fled?: boolean;

  // --- alive-world bindings (createGame patrols/groups) ---
  patrol?: Vec2[];
  patrolI?: number;
  group?: number;
  groupWakeT?: number;

  // --- stronghold garrison members ---
  fort?: string;
  leashR?: Px;

  // --- death / removal ---
  dead?: boolean;

  // --- runtime status (status effects, burn ownership, conversions) ---
  burnOwner?: Pid;

  // --- status-effect clocks / ownership ---
  /** burn DoT clock + per-second tick accumulator + patch-on-tick flag. */
  burnT?: number;
  burnTick?: number;
  burnPatch?: boolean;
  /** toxin DoT clock + tick accumulator + credit owner. */
  toxT?: number;
  toxTick?: number;
  toxOwner?: Pid;
  /** stun / chill-equivalent timers. */
  stunT?: number;
  lavaT?: number;
  /** converted-to-ally clock (>0 while fighting for the player). */
  convertedT?: number;
  /** acolyte ward (absorbs one hit). */
  shielded?: boolean;
  /** mutation tag ('feral'|'bulk'|'volatile'|'split'). */
  mutation?: string;

  // --- A* / pathing bookkeeping ---
  pathFailed?: boolean;
  pathFails?: number;
  gnawScanT?: number;
  /** index of the build currently being gnawed; undefined when marching. */
  gnawI?: number;
  /** unreachable-goal latch + the build-epoch it was set at. */
  dormant?: boolean;
  dormantEpoch?: number;
  /** march-on-the-core fallback latch + multi-core target index. */
  targetCore?: boolean;
  coreI?: number;
  /** seat this enemy has currently engaged (sight-locked). */
  engagePid?: Pid;
  bestHome?: number;

  // --- stuck / kick recovery ---
  chaseKicked?: boolean;
  chaseStuckT?: number;
  stuckT?: number;
  stuckX?: number;
  stuckY?: number;
  kickX?: number;
  kickY?: number;
  /** last-frame move delta (render lean). */
  mvX?: number;
  mvY?: number;

  // --- kind-specific transient AI ---
  /** charger windup + locked charge facing. */
  windup?: number;
  chargeFx?: number;
  chargeFy?: number;
  /** dash lunge (blink kinds). */
  dashT?: number;
  dashFx?: number;
  dashFy?: number;
  /** banshee/spawner pulse counter. */
  pulseN?: number;

  [key: string]: unknown;
}

// ===========================================================================
// Captives, NPCs, stranded operators, scrap
// ===========================================================================
export interface Captive {
  id: string;
  charId: string | null;
  x: Px;
  y: Px;
  owner: Carrier;
  /** True for captives minted from a downed operative (game.ts:3045). */
  fromPlayer: boolean;
  /** Pid of the player who just set this down (no instant re-scoop). */
  noPid?: Pid | null;
}

export interface Npc {
  id: string;
  name: string;
  x: Px;
  y: Px;
  lines: string[];
  /** one-time gift handed over on first talk (e.g. { shards: 6 }). */
  gift: { shards?: number; [reward: string]: number | undefined } | null;
  lineIdx: number;
  given: boolean;
}

/** Stranded operator: an ownerless field NPC walked back to base to recruit a
 * 'defender' follower (setupStranded, game.ts:1719). */
export interface Stranded {
  id: string;
  x: Px;
  y: Px;
  carrier: Carrier;
  recruited: boolean;
  /** Pid of the player who just set this down (no instant re-scoop). */
  noPid?: Pid | null;
}

/** Generic scrap pickup (never touches the relic shard pool). */
export interface Scrap {
  id: string;
  x: Px;
  y: Px;
  carrier: Carrier;
  /** Pid of the player who just set this down (no instant re-scoop). */
  noPid?: Pid | null;
}

// ===========================================================================
// Builds (structures)
// ===========================================================================
// parseLevel() seeds authored/prebuilt builds (game.ts:833); layStructure()
// and the build action add placed ones (game.ts:6150). Many fields are
// kind-conditional (farm growth, leveled hp, turret carousel).
export interface Build {
  x: Px;
  y: Px;
  kind: string;
  /** LYTH cost; absent on a few authored prebuilts (defaults by kind). */
  cost?: number;
  /** 0..1 build progress; 1 when standing. */
  progress: number;
  paid: number;
  built: boolean;
  hp: number;
  maxHp: number;
  cool: number;
  evT: number;

  // --- conditional ---
  /** Upgrade level (barricades/turrets/walls); pylons never carry one. */
  level?: number;
  /** Total shards sunk in (prebuilt/placed structures). */
  invested?: number;
  /** owning team slot (a small int; ctf/siege placed builds). */
  team?: number;
  /** farm growth bookkeeping. */
  stage?: number;
  growT?: number;
  /** Turret type once chosen ('gun'|'prism'|...); carousel state while choosing. */
  ttype?: string;
  typeSelect?: boolean;
  tsIdx?: number;
  selT?: number;
  typeSelectT?: number;
  attended?: boolean;
  /** trampled stage-build flag. */
  trampled?: boolean;
  /** Stronghold wall-ring membership id. */
  fort?: string;
  /** dismantle / farm-replant hold clocks. */
  dismantleT?: number;
  replantT?: number;
  /** upgrade-channel progress 0..1. */
  upProgress?: number;
  [key: string]: unknown;
}

// ===========================================================================
// Other level entities
// ===========================================================================
export interface Crystal {
  cid: number;
  x: Px;
  y: Px;
  hp: number;
}

export interface Chest {
  x: Px;
  y: Px;
  opened: boolean;
  loot: string;
  amount: number;
}

export interface Vehicle {
  id: string;
  x: Px;
  y: Px;
  kind: string;
  /** Riding player's pid, or null. */
  rider: Pid | null;
}

/** A climbable defense tower ('W'). Repaired/upgraded/rebuilt like a build, so
 * it carries the same gnaw/build bookkeeping once those systems touch it. */
export interface Tower {
  x: Px;
  y: Px;
  level: number;
  hp: number;
  maxHp: number;
  occupant: Pid | null;
  kind?: string;
  cost?: number;
  /** rebuild progress 0..1 (set once destroyed). */
  progress?: number;
  /** shards sunk into the tower. */
  invested?: number;
  /** event/flash clock. */
  evT?: number;
  /** dismantle hold clock. */
  dismantleT?: number;
}

export interface Shop {
  x: Px;
  y: Px;
}

/** A stall offer entry (SHOP_OFFERS / the extended mask+placeable deck). */
export interface ShopOffer {
  what: string;
  cost: number;
  amount?: number;
  /** routes the offer through addToInventory (placeable structures). */
  place?: boolean;
  /** wall offers enter drag-placement. */
  drag?: boolean;
}

export interface Hire {
  x: Px;
  y: Px;
  cost: number;
  job: string;
  hired: boolean;
  name: string;
  /** post-restock cooldown clock (once hired). */
  restockT?: number;
  /** accrued work timer (engineer/farmer/smith jobs). */
  workT?: number;
}

/** CTF/objective flag ('D'). */
export interface Flag {
  /** Team slot; minted at parse as `flags.length % 2` (a small int). */
  team: number;
  x: Px;
  y: Px;
  homeX: Px;
  homeY: Px;
  carrier: Carrier;
  atBase: boolean;
  dropT: number;
}

/** Field weapon pickup ('A') or a dropped weapon. */
export interface Pickup {
  id: string;
  x: Px;
  y: Px;
  kind: string;
  ammo: number;
}

/** Quest item ('I') — trails its carrier like a captive. */
export interface QItem {
  id: string;
  kind: string;
  x: Px;
  y: Px;
  carrier: Carrier;
}

/** Relay switch ('Q'). */
export interface Switch {
  id: string;
  x: Px;
  y: Px;
  on: boolean;
  group: number;
}

/** Glyph stone ('J') — lights in order within its group. */
export interface Glyph {
  id: string;
  x: Px;
  y: Px;
  symbol: number;
  lit: boolean;
  group: number;
}

/** BLS pillar ('X') — shot-destructible. */
export interface Pillar {
  id: string;
  x: Px;
  y: Px;
  hp: number;
  maxHp: number;
}

export interface Forge {
  x: Px;
  y: Px;
  holdT: number;
}

export interface Teleport {
  id: string;
  x: Px;
  y: Px;
  /** The paired pad id (resolved in parseLevel), or null if inert. */
  twin: string | null;
}

/** A monolith core ('K'). Single-core maps use g.core; beacon-defense maps use
 * the g.cores array (relightable); siege uses team-tagged cores. */
export interface Core {
  x: Px;
  y: Px;
  hp: number;
  maxHp: number;
  /** present on beacon/siege cores. */
  lit?: boolean;
  /** beacon-defense relight clock. */
  relightT?: number;
  /** siege: which team owns this core (a small int slot). */
  team?: number;
}

/** A door rect (def.doors) — closed it blocks move/sight/shots/A*. */
export interface Door {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  open: boolean;
  sealLock: boolean;
}

// ===========================================================================
// Followers (hired hands + recruited defenders)
// ===========================================================================
// Two spawn sites: recruitDefender (ownerless, slot -1, game.ts:2877) and the
// hire action (owned, posted, game.ts:7161).
export interface Follower {
  id: number;
  kind: string;
  /** Owning player's pid, or null for an ownerless base defender. */
  owner: Pid | null;
  x: Px;
  y: Px;
  hp: number;
  /** Formation slot; -1 marks the ownerless garrison. */
  slot: number;
  fx: number;
  fy: number;
  cool: number;
  invulnT: number;
  path: Vec2[] | null;
  pathI: number;
  repathT: number;
  isFollower: boolean;
  /** defenders carry maxHp; hires derive theirs from stats. */
  maxHp?: number;
  /** hires: index into g.hires of the post they garrison. */
  post?: number;
  /** ashore teleport clamp when the owner is in water. */
  landX?: number;
  landY?: number;
  [key: string]: unknown;
}

// ===========================================================================
// Projectiles, transient ground effects, drops
// ===========================================================================
export interface Shot {
  id: number;
  x: Px;
  y: Px;
  vx: Px;
  vy: Px;
  ttl: number;
  dmg: number;
  /** 'p' (player-side) | 'e' (enemy-side) etc. */
  who: string;
  overWalls: boolean;
  pierce: number;
  aoeRadius: number;
  curve: number;
  radius: Px;
  kind: string;
  pid?: Pid;
  /** owning team slot (a small int; pvp/siege shots). */
  team?: number;
  /** Kill-credit seat (null/absent for turrets/followers/converted enemies). */
  ownerPid?: Pid;
  /** Ids/entities already hit (pierce bookkeeping). */
  hits: unknown[];

  // --- evolution payloads (absent on classics) ---
  stun?: number;
  ignite?: boolean;
  ignitePatch?: boolean;
  shockArc?: boolean;
  knockback?: number;
  stunPlayer?: number;
  [key: string]: unknown;
}

/** A ground patch (burn/toxin/trap) — chip-damages whoever stands in it. */
export interface Patch {
  x: Px;
  y: Px;
  kind: string;
  r: Px;
  ttl: number;
  /** Owning pid (for kill credit), present on player-laid patches. */
  pid?: Pid;
  /** True for enemy/ambient patches that hurt players. */
  hostile?: boolean;
  /** Owning team (siege-trap patches; -1 unclaimed). */
  team?: number;
}

/** A shard drop (dropped on enemy death / objectives). */
export interface Drop {
  x: Px;
  y: Px;
  amount: number;
  ttl: number;
}

/** A thrown 'cracker' item in flight, then on a fuse. */
export interface Cracker {
  sx: Px;
  sy: Px;
  tx: Px;
  ty: Px;
  x: Px;
  y: Px;
  flightT: number;
  landed: boolean;
  fuse: number;
  pid: Pid;
  /** thrower's team slot (a small int; pvp). */
  team?: number;
}

/** A floating power-up pickup. */
export interface Powerup {
  id: string;
  x: Px;
  y: Px;
  type: PowerupType;
  ttl: number;
}

// ===========================================================================
// Relic superweapon + hazards
// ===========================================================================
export interface Superweapon {
  /** 'nuke' | 'weather'. */
  type: string;
  /** 'building' | 'charging' | 'ready' | 'wrecked'. */
  state: string;
  buildT: number;
  chargeT: number;
  used: boolean;
  x: Px;
  y: Px;
  ownerPid: Pid;
  hp: number;
  maxHp: number;
  /** auto-target reticle (set once it locks the densest cluster). */
  targetX?: Px;
  targetY?: Px;
}

/** A live hazard field: a nuke's flight telegraph, the radiation pool it
 * leaves, or a roaming lightning storm. Fields vary by `kind`. */
export interface Hazard {
  kind: string; // 'nukeFlight' | 'radiation' | 'storm'
  x: Px;
  y: Px;
  radius: Px;
  ttl: number;
  /** radiation chip clock. */
  tick?: number;
  /** storm-only. */
  warnT?: number;
  strikeT?: number;
  strikes?: number;
  ownerPid?: Pid;
  /** marks the hazard for removal this tick. */
  done?: boolean;
}

// ===========================================================================
// Mode / objective sub-state
// ===========================================================================
export interface Wave {
  at: number;
  letters: string;
  edge?: string;
  fired: boolean;
}

export interface BastionConfig {
  nights: number;
  dayLen: number;
  nightLen: number;
  bloodMoons: number[];
  /** daily-twist modifiers (merged from def.bastion / DAILY_TWISTS). */
  waveMult?: number;
  bossEvery?: number;
  bloodEvery?: number;
  wavesPerNight?: number;
  /** enemy letter roster the night waves draw from. */
  roster?: string[];
  /** endless-mode flag (daily challenge). */
  endless?: boolean;
  [key: string]: unknown;
}

/** Bastion day/night cycle clock (g.cycle). */
export interface Cycle {
  phase: string; // 'day' | 'night'
  nightNo: number;
  t: number;
  bloodMoon: boolean;
  warned: boolean;
  waveN: number;
  dayE: number;
  hornT: number;
  probeDone: boolean;
  dropDone: boolean;
}

/** King-of-the-Hill capture zone (capture_hill). */
export interface Capture {
  x: Px;
  y: Px;
  radius: Tiles;
  duration: number;
  threshold: number;
  decay: number;
  contest: boolean;
  /** owner-progress timer (also doubles as the controlling team slot). */
  ownerT: number;
  contested: boolean;
  held: boolean;
}

/** bridge_cross_hold reach-gate. */
export interface Bridge {
  armOnReach: boolean;
  reached: boolean;
  holdX: Px | null;
  holdY: Px | null;
  reachRadius: Px;
}

/** escort_push mobile anchor. */
export interface Escort {
  path: Vec2[];
  wp: number;
  x: Px;
  y: Px;
  speed: Tiles;
  holdRadius: Tiles;
  hp: number;
  maxHp: number;
  hitCool: number;
  moving: boolean;
  contested: boolean;
}

/** BR shrink zone. */
export interface Zone {
  x: Px;
  y: Px;
  r: Px;
  targetR: Px;
  shrinkT: number;
  /** final-collapse clock once the schedule is exhausted. */
  finalT?: number;
  /** true once the zone enters its terminal collapse. */
  collapsing?: boolean;
}

export interface BrShrink {
  at: number;
  r: Px;
  fired: boolean;
}

/** An objective reward payload (quest/switch-group/glyph-group). Open-ended but
 * the sim reads these specific keys. */
export interface Reward {
  shards?: number;
  item?: string;
  weapon?: string;
  openDoor?: string;
  door?: string;
  /** id of a quest to advance. */
  quest?: string;
  [k: string]: unknown;
}

/** A quest target — either a tag string or a reach point (tile coords). */
export type QuestTarget = string | { x: number; y: number } | null;

export interface QuestState {
  id: string;
  main: boolean;
  title: string;
  giver: string;
  /** quest kind ('fetch'|'reach'|'kill'|...); absent on a bare giver quest. */
  kind?: string;
  item?: string;
  target?: QuestTarget;
  count: number;
  reward: Reward | null;
  hint: string;
  /** 'hidden' | 'active' | 'done' (etc.). */
  state: string;
  progress: number;
}

export interface SwitchGroup {
  group: number;
  need: number;
  of: number;
  window: number;
  reward: Reward | null;
  windowT: number;
  done: boolean;
}

export interface GlyphGroup {
  group: number;
  order: number[];
  reward: Reward | null;
  done: boolean;
}

/** The Anchor exit gate (optional time lock). */
export interface Gate {
  need: number;
  after: number;
  built: number;
  open: boolean;
}

/** Generalized ambient hazard (toxin | radiation | fire). */
export interface AmbientHazard {
  kind: string;
  tick?: number;
  dmg?: number;
  immuneItem?: string;
  until?: number;
  [key: string]: unknown;
}

/** Optional theme ground-patch emitter (e.g. lava spits). */
export interface AmbientPatches {
  kind: string;
  everySec: number;
  r: Tiles;
  ttl: number;
  cap: number;
  patchT: number;
  patchN: number;
}

/** toxicAir modifier shadow-state (the legacy bleed timer). */
export interface ToxicAirState {
  until: number;
  warned: boolean;
}

/** The landed Anchorcraft (early-extraction reward). */
export interface Ship {
  x: Px;
  y: Px;
  landed: boolean;
}

// ===========================================================================
// Anchor Siege (MOBA) state
// ===========================================================================
export interface SiegeMinion {
  id: number;
  team: number;
  laneI: number;
  x: Px;
  y: Px;
  hp: number;
  maxHp: number;
  /** index of the next lane waypoint. */
  pathIdx: number;
  score: number;
  /** non-grunt minion kind (grunt ships no kind field). */
  kind?: string;
  [key: string]: unknown;
}

export interface SiegeLane {
  waypoints: Vec2[];
}

export interface SiegeState {
  minions: SiegeMinion[];
  nextMinionId: number;
  /** per-team spawn countdown [team0, team1]. */
  spawnT: [number, number];
  waveNo: [number, number];
  interval: number;
  cap: number;
  waveBase: number;
  wavePerMin: number;
  lanes: SiegeLane[];
  lanesRev: SiegeLane[];
  pickupT: number;
  pickupN: number;
  superCharge: [number, number];
  superMax: number;
  superHoldT: [number, number];
}

export interface SiegeTower {
  id: number;
  x: Px;
  y: Px;
  team: Team;
  lane: number;
  level: number;
  hp: number;
  maxHp: number;
  cool: number;
  destroyed: boolean;
}

/** Neutral mid-lane prism emplacement ('p'). */
export interface SiegePrism {
  id: number;
  x: Px;
  y: Px;
  hp: number;
  maxHp: number;
  cool: number;
}

/** Timed trap emplacement ('t'). team -1 = unclaimed. */
export interface SiegeTrap {
  id: number;
  x: Px;
  y: Px;
  team: number;
  armed: boolean;
  armT: number;
  cool: number;
}

// ===========================================================================
// Enemy strongholds + relic music box + awakening horde
// ===========================================================================
export interface Stronghold {
  id: string;
  x: Px;
  y: Px;
  /** wall-ring radius (tiles). */
  r: Tiles;
  aggro: Tiles;
  leash: Tiles;
  /** enemy ids stationed here. */
  garrison: number[];
  cleared: boolean;
}

export interface MusicBoxFragment {
  id: string;
  x: Px;
  y: Px;
  carrier: Carrier;
  placed: boolean;
}

export interface MusicBoxMount {
  x: Px;
  y: Px;
  filled: boolean;
}

/** The Music Box easter egg state (g.musicBox). Disabled levels store
 * `{ enabled: false }`. */
export interface MusicBox {
  enabled: boolean;
  mode?: string;
  stem?: unknown;
  altar?: Vec2;
  fragments?: MusicBoxFragment[];
  assembled?: number;
  complete?: boolean;
  /** stronghold-only four-corner relic mounts. */
  mounts?: MusicBoxMount[];
}

/** The relic awakening horde (latched while the music box is complete). */
export interface Horde {
  startedAt: number;
  dur: number;
  tick: number;
  nextAt: number;
  hits: number;
  deaths: number;
  ended: boolean;
  result: string | null;
  prevDark: boolean;
  prevWeather: string | null;
}

// ===========================================================================
// Game event
// ===========================================================================
// Pushed onto g.events each step (drained by the snapshot). The discriminant is
// `type`; the remaining payload is per-event and heterogeneous.
export interface GameEvent {
  type: GameEventType;
  x?: Px | null;
  y?: Px | null;
  [key: string]: unknown;
}

// ===========================================================================
// Game — the top-level sim state object `g`
// ===========================================================================
// Returned by createGame() (game.ts:1145) and mutated in place by step().
// Mode/def-gated objects are `T | null` exactly as the sim initializes them
// (null means "this system is off"); a few fields are lazily attached by
// step() and so are optional.
export interface Game {
  // --- identity / layout ---
  name: string;
  objective: string;
  grid: string[];
  w: Tiles;
  h: Tiles;
  arcade: boolean;
  untimed: boolean;
  spawns: Vec2[];

  // --- clocks ---
  timeLeft: number;
  elapsed: number;
  graceT: number;
  lowTimeSent: boolean;

  // --- world flags ---
  dark: boolean;
  weather: string | null;
  ambience: string | null;
  theme: string | null;
  difficulty: string;
  enemyScale: number;
  hpMult: number;
  family: boolean;
  familyLives: number | null;

  // --- entity arrays ---
  players: Player[];
  enemies: Enemy[];
  captives: Captive[];
  npcs: Npc[];
  builds: Build[];
  crystals: Crystal[];
  chests: Chest[];
  vehicles: Vehicle[];
  towers: Tower[];
  shops: Shop[];
  hires: Hire[];
  flags: Flag[];
  pickups: Pickup[];
  qitems: QItem[];
  switches: Switch[];
  glyphs: Glyph[];
  pillars: Pillar[];
  forges: Forge[];
  teleports: Teleport[];
  doors: Door[];

  // --- cores / beacons ---
  /** Single-core maps; null on siege + beacon-defense (which use cores[]). */
  core: Core | null;
  /** Beacon-defense (four) or siege (two team-tagged) cores; null otherwise. */
  cores: Core[] | null;

  // --- followers + their id source ---
  followers: Follower[];
  nextFollowerId: number;

  // --- stranded ops + scrap ---
  stranded: Stranded[];
  scrap: Scrap[];
  nextScrapId: number;

  // --- waves (story) ---
  waves: Wave[];

  // --- transient effects ---
  shots: Shot[];
  patches: Patch[];
  drops: Drop[];
  crackers: Cracker[];
  hazards: Hazard[];

  // --- power-ups ---
  powerups: Powerup[];
  nextPowerupId: number;
  powerupKills: number;
  fireSaleT: number;
  freeSprintT: number;

  // --- economy ---
  shards: number;
  shopOffers: ShopOffer[];

  // --- relic superweapon ---
  superweaponUnlocked: boolean;
  superweapon: Superweapon | null;

  // --- quests + puzzles ---
  quests: QuestState[];
  pendingDoorOpens: unknown[];
  switchGroups: SwitchGroup[];
  glyphGroups: GlyphGroup[];

  // --- ambient hazards / weather ---
  toxicAir: ToxicAirState | null;
  ambientHazard: AmbientHazard | null;
  ambientPatches: AmbientPatches | null;

  // --- gate / exit ---
  gate: Gate | null;
  exitX: Px;
  exitY: Px;

  // --- mode + objective sub-state (each null unless its def opts in) ---
  mode: GameMode | null;
  bastion: BastionConfig | null;
  cycle: Cycle | null;
  capture: Capture | null;
  bridge: Bridge | null;
  escort: Escort | null;

  // --- ctf / br ---
  caps: [number, number] | null;
  teamShards: [number, number] | null;
  grabs: [number, number] | null;
  sdFirstGrab: number | null;
  suddenT: number;
  suddenDeath: boolean;
  zone: Zone | null;
  brShrinks: BrShrink[] | null;

  // --- siege (MOBA) ---
  siege: SiegeState | null;
  siegeTowers: SiegeTower[] | null;
  siegePrisms: SiegePrism[] | null;
  siegeTraps: SiegeTrap[] | null;
  nextSiegeId: number;
  deathCountByTeam: [number, number] | null;

  // --- early-extraction ship ---
  ship: Ship | null;

  // --- match outcome ---
  status: string; // 'play' | 'cleared' | 'failed' (etc.)
  /** winning team slot (a small int), or null/undefined while the match runs. */
  winner?: number | null;
  lastOut: unknown | null;
  rescued: string[];

  // --- meta / scoring ---
  roster: string[];
  charMap: CharacterMap;
  score: number;
  kills: number;
  combo: number;
  comboT: number;

  // --- id sources ---
  nextCaptiveId: number;
  nextEnemyId: number;
  nextShotId: number;
  nextPickupId: number;

  // --- event queue (drained into snapshots each step) ---
  events: GameEvent[];

  // --- lazily attached by setup/step (absent until their system runs) ---
  /** Enemy strongholds; deleted (left undefined) when none seed. */
  strongholds?: Stronghold[];
  /** Internal stronghold group-id counter. */
  _strongholdGroupBase?: number;
  /** Music Box easter egg state. */
  musicBox?: MusicBox;
  /** The relic awakening horde, once latched. */
  horde?: Horde | null;
  /** Bumped whenever the route map changes (wakes dormant A* sleepers). */
  buildEpoch?: number;
  /** Per-step A* / gnaw work budgets. */
  pathBudget?: number;
  gnawBudget?: number;
  /** Beacon-defense relight grace clock. */
  beaconGraceT?: number | null;
  /** DEV cheat toggles (never set by the sim; injected by the dev harness). */
  cheats?: {
    god?: boolean;
    coreInvuln?: boolean;
    instantKill?: boolean;
    instantBuild?: boolean;
    pauseTime?: boolean;
    speed?: number;
    [k: string]: unknown;
  };
}
