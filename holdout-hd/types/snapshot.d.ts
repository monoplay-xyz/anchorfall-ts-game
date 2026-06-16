// types/snapshot.d.ts — the WIRE Snapshot contract for the TS migration (issue #4).
//
// Types-only ambient declarations (no runtime code). This describes EXACTLY the
// object that `snapshot(g, full)` in shared/game.ts EMITS onto the wire — NOT the
// internal sim (`g.*`) shape. The wire shape is quantized (positions rounded to
// integer px via qi(), velocities/timers to 1 decimal via q1(), facing to 2
// decimals via q2()) and trimmed: most fields are gated behind
// `...(cond ? { x } : {})` spreads and are therefore OPTIONAL here. Anything not
// behind a gate is always present.
//
// Cross-checked against the consumers: public/client.ts (renderSnap / snapshot
// handling: updateObjectives, updateModePanels, updateHUD, updateHearts, etc.)
// and public/render.ts.
//
// Numbers carrying world coordinates are quantized but remain `number`; the
// quantization is documented inline. Shared scalar vocabulary comes from
// ./common.

import type { GameMode, GameEventType, PowerupType, Team, Pid, Px } from './common';

// ---------------------------------------------------------------------------
// Small shared aliases (wire-local)
// ---------------------------------------------------------------------------
/** Run lifecycle status (g.status). */
export type SnapStatus = 'play' | 'cleared' | 'failed';
/** Difficulty badge — only emitted when NOT the default 'normal'. */
export type Difficulty = 'easy' | 'extreme';
/** A polyline waypoint emitted as a packed [x, y] pair. */
export type WirePoint = [number, number];

// ---------------------------------------------------------------------------
// Sim events (g.events.splice(0))
// ---------------------------------------------------------------------------
// Each event is a discriminated record: a `type` from GameEventType plus an
// open bag of payload fields (x/y, kind, pid, dmg, team, winner, caps, etc.)
// that vary per event. The sim pushes heterogeneous literals, so payload keys
// are modeled as an index signature.
export interface WireEvent {
  type: GameEventType;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Objective / level-state sub-shapes
// ---------------------------------------------------------------------------
/** Exit gate progress (always present; null when the level has no gate). */
export interface WireGate {
  need: number;
  after: number;
  built: number;
  open: boolean;
  /** true once enough shards are built but the gate has not yet opened. */
  charging: boolean;
}

/** A placed/under-construction build (turret/wall/etc.). */
export interface WireBuild {
  x: Px;
  y: Px;
  kind: string;
  cost: number;
  progress: number;
  paid: number;
  built: boolean;
  hp: number;
  maxHp: number;
  /** multi-stage builds only. */
  stage?: number;
  /** stage builds that have been trampled. */
  trampled?: true;
  /** leveled builds only. */
  level?: number;
  /** confirmed turret type (carousel). */
  ttype?: string;
  /** turret type-select wheel is open. */
  typeSelect?: true;
  /** carousel cursor index (present with typeSelect). */
  tsIdx?: number;
  /** remaining auto-confirm seconds (present with typeSelect). */
  typeSelectT?: number;
}

/** A ground patch (fire/toxin/heal field). Shipped only when populated. */
export interface WirePatch {
  x: Px;
  y: Px;
  kind: string;
  r: Px;
  ttl: number;
  hostile?: true;
  team?: Team;
}

/** A field-weapon pickup. Shipped only when populated. */
export interface WirePickup {
  id: number;
  x: Px;
  y: Px;
  kind: string;
  ammo: number;
}

/** A quest item on the ground / carried. Shipped only when populated. */
export interface WireQItem {
  id: number;
  x: Px;
  y: Px;
  kind: string;
  /** pid of the carrier, or null/absent when on the ground. */
  carrier: Pid | null;
}

/** Quest objective state. Shipped only when populated. */
export interface WireQuest {
  id: number;
  state: string;
  progress: number;
  count: number;
  title: string;
  main: boolean;
  kind: string;
}

/** A recruited combat follower. Shipped only when populated. */
export interface WireFollower {
  id: number;
  kind: string;
  owner: Pid;
  x: Px;
  y: Px;
  hp: number;
  /** facing x (2-decimal). */
  fx: number;
  /** facing y (2-decimal). */
  fy: number;
  slot: number;
}

/** A stranded operator awaiting rescue (recruited ones drop off the wire). */
export interface WireStranded {
  id: number;
  x: Px;
  y: Px;
  /** pid of carrier, or null when on the ground. */
  carrier: Pid | null;
}

/** A scrap pickup. Shipped only when populated. */
export interface WireScrap {
  id: number;
  x: Px;
  y: Px;
  carrier: Pid | null;
}

/** A floor switch. Shipped only when populated. */
export interface WireSwitch {
  id: number;
  x: Px;
  y: Px;
  on: boolean;
  group: number | string;
}

/** A switch-group objective. Shipped only when populated. */
export interface WireSwitchGroup {
  group: number | string;
  need: number;
  of: number;
  done: boolean;
  /** countdown window — present only while > 0. */
  windowT?: number;
}

/** A glyph rune. Shipped only when populated. */
export interface WireGlyph {
  id: number;
  x: Px;
  y: Px;
  symbol: string;
  lit: boolean;
  group: number | string;
}

/** A destructible pillar. Shipped only when populated. */
export interface WirePillar {
  id: number;
  x: Px;
  y: Px;
  hp: number;
  maxHp: number;
}

/** A seal forge. Shipped only when populated. */
export interface WireForge {
  x: Px;
  y: Px;
  /** channel-hold timer — present only while > 0. */
  holdT?: number;
}

/** A teleport pad (paired by twin id). Shipped only when populated. */
export interface WireTeleport {
  id: number;
  x: Px;
  y: Px;
  twin: number;
}

/** A door. Shipped only when populated. */
export interface WireDoor {
  id: number;
  x: Px;
  y: Px;
  w: number;
  h: number;
  open: boolean;
  /** requires the lythseal to open. */
  sealLock?: true;
}

/** A crystal objective. Always present (possibly empty array). */
export interface WireCrystal {
  x: Px;
  y: Px;
  hp: number;
}

/** A dropped resource. Always present (possibly empty array). */
export interface WireDrop {
  x: Px;
  y: Px;
  amount: number;
  ttl: number;
}

/** A floating power-up. Shipped only when populated. */
export interface WirePowerup {
  id: number;
  x: Px;
  y: Px;
  type: PowerupType;
  ttl: number;
}

/** A named NPC. Always present (possibly empty array). */
export interface WireNpc {
  id: number;
  name: string;
  x: Px;
  y: Px;
}

// ---------------------------------------------------------------------------
// New-mode objective sub-shapes (each gated on its def opting in)
// ---------------------------------------------------------------------------
/** Siege/anchor core. */
export interface WireCore {
  x: Px;
  y: Px;
  hp: number;
  maxHp: number;
}

/** Hold-a-point capture objective. */
export interface WireCapture {
  x: Px;
  y: Px;
  radius: Px;
  /** owner-progress timer (1-decimal). */
  ownerT: number;
  duration: number;
  held: boolean;
  contested: boolean;
}

/** Reach-the-bridge objective. */
export interface WireBridge {
  reached: boolean;
  /** hold point — present only when the def set holdX/holdY. */
  x?: Px;
  y?: Px;
}

/** Escort objective. */
export interface WireEscort {
  x: Px;
  y: Px;
  hp: number;
  maxHp: number;
  /** current waypoint index. */
  wp: number;
  /** total waypoints (path length). */
  total: number;
  moving: boolean;
  contested: boolean;
  path: WirePoint[];
}

/** Beacon-defense monolith. */
export interface WireBeaconCore {
  x: Px;
  y: Px;
  hp: number;
  maxHp: number;
  lit: boolean;
  team?: Team;
}

// ---------------------------------------------------------------------------
// Anchor Siege (MOBA) sub-shapes
// ---------------------------------------------------------------------------
export interface WireSiegeMinion {
  id: number;
  team: Team;
  x: Px;
  y: Px;
  hp: number;
  maxHp: number;
  /** non-grunt minion kind only. */
  kind?: string;
}

export interface WireSiegeTower {
  x: Px;
  y: Px;
  team: Team;
  hp: number;
  maxHp: number;
  level: number;
  destroyed: boolean;
}

/** Neutral killable prism (MOBA Wave C). Shipped only when the map fields any. */
export interface WireSiegePrism {
  id: number;
  x: Px;
  y: Px;
  hp: number;
  maxHp: number;
}

/** Timed trap (MOBA Wave D). Shipped only when the map fields any. */
export interface WireSiegeTrap {
  id: number;
  x: Px;
  y: Px;
  /** team owner; -1 when unclaimed. */
  team: number;
  armed: boolean;
  /** cooldown — present only while > 0. */
  cool?: number;
}

export interface WireSiege {
  minions: WireSiegeMinion[];
  towers: WireSiegeTower[];
  /** per-lane polylines (packed [x,y] waypoints). */
  lanes: WirePoint[][];
  /** [team0CoreOpen, team1CoreOpen]. */
  open: [boolean, boolean];
  prisms?: WireSiegePrism[];
  traps?: WireSiegeTrap[];
  /** per-team super-weapon charge (always present in siege). */
  superCharge: number[];
  superMax: number;
}

// ---------------------------------------------------------------------------
// Day/night cycle (bastion)
// ---------------------------------------------------------------------------
export interface WireCycle {
  phase: string;
  nightNo: number;
  t: number;
  bloodMoon: boolean;
  /** total nights to survive. */
  nights: number;
  /** horn-hold progress 0..1 — present only while horn is held. */
  hornP?: number;
  endless?: true;
  /** flags the day before a blood-moon dusk. */
  nextBloodMoon?: true;
}

// ---------------------------------------------------------------------------
// Misc world objects (all gated on populated arrays / set fields)
// ---------------------------------------------------------------------------
export interface WireShip {
  x: Px;
  y: Px;
  landed: true;
}

export interface WireToxicAir {
  until: number;
  active: boolean;
}

/** A stall offer (extended mask-stock shops emit their list). */
export interface WireShopOffer {
  [key: string]: unknown;
}

export interface WireChest {
  x: Px;
  y: Px;
  opened: boolean;
  loot: string;
}

export interface WireCracker {
  x: Px;
  y: Px;
  landed: boolean;
  fuse: number;
}

export interface WireVehicle {
  id: number;
  x: Px;
  y: Px;
  kind: string;
  /** pid of the rider, or null when empty. */
  rider: Pid | null;
}

export interface WireTower {
  x: Px;
  y: Px;
  level: number;
  hp: number;
  maxHp: number;
  /** pid of the occupant, or null when empty. */
  occupant: Pid | null;
  /** rebuild progress — present only when destroyed (hp <= 0). */
  progress?: number;
}

export interface WireShop {
  x: Px;
  y: Px;
}

export interface WireHire {
  x: Px;
  y: Px;
  cost: number;
  job: string;
  hired: boolean;
  name: string;
}

/** A CTF flag. Shipped only when populated. */
export interface WireFlag {
  team: Team;
  x: Px;
  y: Px;
  homeX: Px;
  homeY: Px;
  carrier: Pid | null;
  atBase: boolean;
  /** drop-return timer (1-decimal). */
  dropT: number;
}

/** Battle-royale shrink zone. */
export interface WireZone {
  x: Px;
  y: Px;
  r: Px;
  targetR: Px;
  shrinkT: number;
}

// ---------------------------------------------------------------------------
// Player wire shape
// ---------------------------------------------------------------------------
export interface WirePlayerItem {
  kind: string;
  count: number;
}

/** An inventory slot (buy-then-place). */
export interface WireInventorySlot {
  kind: string;
  count: number;
}

export interface WireFieldWeapon {
  kind: string;
  ammo: number;
}

/** Shop browse cursor state (present while shopping). */
export interface WireShopState {
  idx: number;
}

/** Character-pick state (present while p.state === 'pick'). */
export interface WirePickState {
  idx: number;
  /** free character ids offered. */
  choices: unknown[];
}

export interface WirePlayer {
  pid: Pid;
  name: string;
  charId: string;
  x: Px;
  y: Px;
  /** facing x (2-decimal). */
  fx: number;
  /** facing y (2-decimal). */
  fy: number;
  state: string;
  /** invulnerability timer (1-decimal). */
  invuln: number;
  /** special-ability cooldown (1-decimal). */
  specialCool: number;
  // --- gated: health block (ships together) ---
  hp?: number;
  maxHp?: number;
  shield?: number;
  // --- gated: stamina block (ships once the seat has sprinted) ---
  stamina?: number;
  staminaMax?: number;
  // --- gated optionals ---
  item?: WirePlayerItem;
  team?: Team;
  /** vehicle id being ridden. */
  riding?: number | string;
  towerId?: number;
  shop?: WireShopState;
  selecting?: true;
  inventory?: WireInventorySlot[];
  /** inventory cursor (ships with inventory). */
  invIdx?: number;
  /** kind currently being placed. */
  placing?: string;
  /** tile-snapped placement ghost x (ships with placing). */
  ghostX?: Px;
  ghostY?: Px;
  /** wall-drag anchor x (ships with placing when dragging a wall). */
  wallAnchorX?: Px;
  wallAnchorY?: Px;
  dmgBonus?: number;
  fieldWeapon?: WireFieldWeapon;
  /** stun timer — present only while > 0. */
  stunT?: number;
  /** frostshade chill timer — present only while > 0. */
  chillT?: number;
  /** lythseal carrier flags (both ride together). */
  hasSeal?: true;
  lythseal?: true;
  /** channel timer — present only while > 0. */
  channelT?: number;
  mask?: true;
  aboard?: true;
  // --- gated: leveling block (non-arcade seats; ships together) ---
  xp?: number;
  level?: number;
  /** character-pick state (present while state === 'pick'). */
  pick?: WirePickState;
}

// ---------------------------------------------------------------------------
// Enemy wire shape
// ---------------------------------------------------------------------------
export interface WireEnemy {
  id: number;
  kind: string;
  x: Px;
  y: Px;
  hp: number;
  maxHp: number;
  /** facing x (2-decimal). */
  fx: number;
  /** facing y (2-decimal). */
  fy: number;
  /** hurt-flash timer (1-decimal). */
  hurt: number;
  state: string;
  /** aim wind-up timer (1-decimal). */
  aimT: number;
  aimX: Px;
  aimY: Px;
  awake: boolean;
  returning: boolean;
  mutation?: string;
  /** acolyte ward (one absorb). */
  shielded?: true;
  /** sand lurker submerged. */
  buried?: true;
  /** status clocks — each present only while > 0. */
  stunT?: number;
  burnT?: number;
  toxT?: number;
  convertedT?: number;
}

// ---------------------------------------------------------------------------
// Captive
// ---------------------------------------------------------------------------
export interface WireCaptive {
  charId: string;
  x: Px;
  y: Px;
  /** pid of the carrier, or null when on the ground. */
  owner: Pid | null;
  fromPlayer: boolean;
}

// ---------------------------------------------------------------------------
// Strongholds
// ---------------------------------------------------------------------------
export interface WireStronghold {
  id: number;
  x: Px;
  y: Px;
  r: Px;
  aggro: number;
  leash: number;
  /** true once every garrison enemy is dead. */
  cleared: boolean;
}

// ---------------------------------------------------------------------------
// Music Box easter egg
// ---------------------------------------------------------------------------
export interface WireMusicBoxFragment {
  id: number;
  x: Px;
  y: Px;
  carrier: Pid | null;
  placed: boolean;
}

export interface WireMusicBoxMount {
  x: Px;
  y: Px;
  filled: boolean;
}

export interface WireMusicBox {
  mode: string;
  stem: string;
  altar: { x: Px; y: Px };
  fragments: WireMusicBoxFragment[];
  assembled: boolean;
  complete: boolean;
  /** stronghold-only corner mounts; omitted for story. */
  mounts?: WireMusicBoxMount[];
}

// ---------------------------------------------------------------------------
// Relic awakening (horde event)
// ---------------------------------------------------------------------------
export interface WireHorde {
  active: boolean;
  remaining: number;
  dur: number;
  hits: number;
  deaths: number;
  bonus: number;
  /** survived/failed result — present once latched. */
  result?: string;
}

// ---------------------------------------------------------------------------
// Relic superweapon + hazards
// ---------------------------------------------------------------------------
export interface WireSuperweapon {
  type: string;
  state: string;
  x: Px;
  y: Px;
  hp: number;
  maxHp: number;
  ownerPid: Pid;
  /** building-state countdown (ships while state === 'building'). */
  buildT?: number;
  buildTime?: number;
  /** charging-state countdown (ships while state === 'charging'). */
  chargeT?: number;
  chargeMax?: number;
  /** targeting reticle (ships once a target is set). */
  targetX?: Px;
  targetY?: Px;
}

export interface WireHazard {
  kind: string;
  x: Px;
  y: Px;
  radius: Px;
  ttl: number;
  /** telegraph warn timer — present only while > 0. */
  warnT?: number;
}

// ---------------------------------------------------------------------------
// Shot
// ---------------------------------------------------------------------------
export interface WireShot {
  id: number;
  x: Px;
  y: Px;
  /** velocity x (1-decimal). */
  vx: number;
  /** velocity y (1-decimal). */
  vy: number;
  who: string;
  kind: string;
  /** owning seat (player shots only). */
  ownerPid?: Pid;
}

// ---------------------------------------------------------------------------
// The wire Snapshot
// ---------------------------------------------------------------------------
// The top-level object returned by snapshot(g, full). Fields without `?` are
// always emitted; `?` fields sit behind a `...(cond ? {} : {})` gate.
export interface Snapshot {
  name: string;
  objective: string;
  /** static tile grid — present only on full snapshots (full=true). */
  grid?: number[][];
  w: number;
  h: number;
  dark?: true;
  // untimed story (both ship together): client clock counts UP.
  untimed?: true;
  elapsed?: number;
  timeLeft: number;
  status: SnapStatus;
  shards: number;
  /** ctf per-team shard pools. */
  teamShards?: number[];
  gate: WireGate | null;
  builds: WireBuild[];
  patches?: WirePatch[];
  pickups?: WirePickup[];
  qitems?: WireQItem[];
  quests?: WireQuest[];
  followers?: WireFollower[];
  stranded?: WireStranded[];
  scrap?: WireScrap[];
  switches?: WireSwitch[];
  switchGroups?: WireSwitchGroup[];
  glyphs?: WireGlyph[];
  pillars?: WirePillar[];
  forges?: WireForge[];
  teleports?: WireTeleport[];
  doors?: WireDoor[];
  crystals: WireCrystal[];
  drops: WireDrop[];
  powerups?: WirePowerup[];
  /** Fire Sale timer — present only while active. */
  fireSaleT?: number;
  /** free-sprint timer — present only while active. */
  freeSprintT?: number;
  npcs: WireNpc[];
  mode?: GameMode;
  core?: WireCore;
  capture?: WireCapture;
  bridge?: WireBridge;
  escort?: WireEscort;
  cores?: WireBeaconCore[];
  siege?: WireSiege;
  /** only when NOT the default 'normal'. */
  difficulty?: Difficulty;
  // family mode (both ship together).
  family?: true;
  familyLives?: number;
  ship?: WireShip;
  weather?: string;
  ambience?: string;
  theme?: string;
  toxicAir?: WireToxicAir;
  /** extended stalls only (offer list differs from the default five). */
  shopOffers?: WireShopOffer[];
  cycle?: WireCycle;
  beaconGraceT?: number;
  chests?: WireChest[];
  crackers?: WireCracker[];
  vehicles?: WireVehicle[];
  towers?: WireTower[];
  shops?: WireShop[];
  hires?: WireHire[];
  flags?: WireFlag[];
  /** ctf per-team capture counts. */
  caps?: number[];
  /** ctf sudden-death escalation level (0..5) — present from the horn on. */
  overtime?: number;
  zone?: WireZone;
  /** winning team — present once the match has ended. */
  winner?: Team | number | null;
  players: WirePlayer[];
  enemies: WireEnemy[];
  captives: WireCaptive[];
  strongholds?: WireStronghold[];
  musicBox?: WireMusicBox;
  horde?: WireHorde;
  /** relic superweapon unlock flag — present once earned. */
  superweaponUnlocked?: true;
  superweapon?: WireSuperweapon;
  hazards?: WireHazard[];
  shots: WireShot[];
  rescued: string[];
  score: number;
  kills: number;
  combo: number;
  events: WireEvent[];
}
