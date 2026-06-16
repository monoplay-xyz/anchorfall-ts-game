// types/common.d.ts — SHARED primitive type vocabulary for the TS migration (issue #4).
//
// This file holds ONLY ambient declarations (no runtime code). It is the single
// source of truth for the small primitives every other contract imports: game
// modes, the sim's event-type union, power-up kinds, team/player id scalars, and
// a few geometry helpers. All values here were extracted directly from
// shared/game.ts (the deterministic sim) and cross-checked against server.ts,
// public/{client,render,audio}.ts and test/sim.test.ts.

// ---------------------------------------------------------------------------
// GameMode
// ---------------------------------------------------------------------------
// The set of gameplay modes the system branches on. The authoritative list is
// server.ts:793 — `['story','ctf','br','bastion','siege']` with everything else
// defaulting to `'classic'`. Inside the sim a room's mode is carried as
// `def.mode` (g.mode = `def.mode || null`); `'classic'` is the un-moded default
// (g.mode null) and `'story'` is distinguished by the `def.story` flag, but the
// public mode vocabulary is these six strings.
export type GameMode = 'classic' | 'story' | 'bastion' | 'ctf' | 'br' | 'siege';

// ---------------------------------------------------------------------------
// GameEventType
// ---------------------------------------------------------------------------
// Every distinct `ev.type` the deterministic sim emits via `g.events.push(...)`
// in shared/game.ts (148 values). Consumers (public/client.ts:566,
// public/audio.ts:1014 banner/SFX switches) read a subset of these; SFX-only
// cue names that never appear in game.ts (e.g. 'footstep', 'bark', 'zap',
// 'toxinPatch') are NOT sim events and are intentionally excluded.
export type GameEventType =
  | 'aim'
  | 'alert'
  | 'allDark'
  | 'ambientHazard'
  | 'beacon'
  | 'beaconDown'
  | 'beaconLit'
  | 'beaconRecovered'
  | 'beaconWarn'
  | 'blink'
  | 'bloodWarn'
  | 'bridgeArmed'
  | 'build'
  | 'buildDown'
  | 'buildHit'
  | 'buildSuperweapon'
  | 'built'
  | 'buy'
  | 'capture'
  | 'captureState'
  | 'captureWin'
  | 'clear'
  | 'converted'
  | 'coreDown'
  | 'coreHit'
  | 'crackerBoom'
  | 'crackerOut'
  | 'crystal'
  | 'dash'
  | 'dawn'
  | 'die'
  | 'dismount'
  | 'doorOpen'
  | 'down'
  | 'dusk'
  | 'eliminated'
  | 'enemyHeal'
  | 'enemyShield'
  | 'escortHit'
  | 'escortLost'
  | 'escortWaypoint'
  | 'escortWin'
  | 'explode'
  | 'extract'
  | 'fail'
  | 'fieldDrop'
  | 'fieldEmpty'
  | 'fieldPickup'
  | 'flagDrop'
  | 'flagReturn'
  | 'flagTaken'
  | 'followerDown'
  | 'followerHit'
  | 'followerLimit'
  | 'gateOpen'
  | 'glyph'
  | 'glyphDone'
  | 'glyphReset'
  | 'harvest'
  | 'heal'
  | 'hired'
  | 'hit'
  | 'hitWall'
  | 'horde'
  | 'hordeBurst'
  | 'horn'
  | 'levelUp'
  | 'lightningStrike'
  | 'lowTime'
  | 'maskOn'
  | 'matchEnd'
  | 'mbComplete'
  | 'mbDrop'
  | 'mbPickup'
  | 'mbPlace'
  | 'mount'
  | 'nightmareDissolve'
  | 'nukeStrike'
  | 'opDrop'
  | 'opPickup'
  | 'opSaved'
  | 'patch'
  | 'pickup'
  | 'pillarDown'
  | 'pillarHit'
  | 'placed'
  | 'playerHit'
  | 'powerup'
  | 'powerupDrop'
  | 'prismBeam'
  | 'prismDown'
  | 'prismFeed'
  | 'probe'
  | 'pyreBurst'
  | 'qitemPickup'
  | 'quest'
  | 'questProgress'
  | 'quorum'
  | 'recruit'
  | 'relicAwaken'
  | 'relicFailed'
  | 'relicSurvived'
  | 'repair'
  | 'restock'
  | 'scrapDrop'
  | 'scrapGiven'
  | 'scrapPickup'
  | 'sealForged'
  | 'shard'
  | 'shield'
  | 'shieldPop'
  | 'shieldUp'
  | 'shipBoard'
  | 'shipDown'
  | 'shipLaunch'
  | 'shockArc'
  | 'shoot'
  | 'siegePickup'
  | 'siegeWave'
  | 'sizzle'
  | 'slotFull'
  | 'spawn'
  | 'spawnEnemy'
  | 'special'
  | 'stormStart'
  | 'superBlast'
  | 'superweaponDown'
  | 'superweaponFired'
  | 'superweaponReady'
  | 'superweaponSite'
  | 'supplyDrop'
  | 'surface'
  | 'switch'
  | 'switchReset'
  | 'talk'
  | 'telegraph'
  | 'teleport'
  | 'teslaZap'
  | 'towerDown'
  | 'toxicAir'
  | 'trample'
  | 'trapArm'
  | 'trapTrip'
  | 'turretType'
  | 'vehicleDown'
  | 'volatile'
  | 'wave'
  | 'zoneShrink';

// ---------------------------------------------------------------------------
// PowerupType
// ---------------------------------------------------------------------------
// Floating power-up kinds. Stored on the pickup as `pu.type` (game.ts:3653+)
// and weighted in POWERUP_WEIGHTS (game.ts:217). Matches the TYPES guard set in
// test/sim.test.ts:8725 exactly.
export type PowerupType = 'fullhealth' | 'stamina' | 'firesale' | 'maxammo' | 'nuke';

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------
// Team id. PvP/team modes (ctf, br, siege) use two team slots indexed 0 and 1
// (caps/teamShards/grabs are [0,0] pairs — game.ts:1282). In some PvE configs
// the sim assigns `p.team = p.pid` (game.ts:1020), so at runtime a team value is
// really a small non-negative integer; the canonical two-team vocabulary is 0|1.
export type Team = 0 | 1;

// ---------------------------------------------------------------------------
// Pid
// ---------------------------------------------------------------------------
// Player id. A runtime number allocated by the server (`nextPid++`, starting at
// 1 — server.ts:353/775) and stored as `p.pid`. There is no `'pl0'`-style string
// pid in the runtime; any such string ids belong to UI/save contexts only.
export type Pid = number;

// ---------------------------------------------------------------------------
// Geometry primitives
// ---------------------------------------------------------------------------
/** A 2D point/vector in world (pixel) space. */
export interface Vec2 {
  x: number;
  y: number;
}

/** A distance measured in grid tiles. */
export type Tiles = number;

/** A distance measured in world pixels (TILE px per tile). */
export type Px = number;
