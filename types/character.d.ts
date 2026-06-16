// types/character.d.ts — Character def contract for the TS migration (issue #4).
//
// Ambient declarations ONLY (no runtime code). This file describes the shape of
// every entry in shared/characters.json — the static, never-mutated character
// roster that the deterministic sim reads. Field presence and the closed kind
// unions were extracted directly from shared/characters.json (30 entries) and
// cross-checked against the consumers in shared/game.ts:
//   - charsById()  (game.ts:707)        — id-keyed lookup map { [id]: CharacterDef }
//   - g.charMap[p.charId].evolution     (game.ts:2733) — perk on level-up
//   - applyEvolution(ch.weapon|sp, evo) (game.ts:2701, 6816, 6982) — clones, never mutates
//   - the special dispatch              (game.ts:6795) — sp.kind 'dash' | 'stim' | <weapon>
//   - movement / swim checks            (game.ts:6647, 6945) — ch.speed, ch.swims
//
// IMPORTANT: character defs are shared across concurrent games and must never be
// mutated; the sim always spreads (`{ ...weapon }`) before adjusting. The types
// here therefore model the on-disk JSON, not the mutated runtime clone (e.g.
// applyEvolution may set boolean `pierce`/`stun`/`ignite`/`shockArc` on a clone,
// but those never appear in characters.json).

import type { Tiles } from './common';

// ---------------------------------------------------------------------------
// Closed kind unions (drawn from the full 30-entry roster)
// ---------------------------------------------------------------------------

/** Main-weapon archetype. Drives projectile visuals/behaviour selection. */
export type WeaponKind =
  | 'smg'
  | 'scatter'
  | 'mortar'
  | 'needle'
  | 'rail'
  | 'twin'
  | 'flame'
  | 'cannon'
  | 'rivet'
  | 'blade'
  | 'spark'
  | 'disc'
  | 'slug'
  | 'ghost'
  | 'helix'
  | 'comet'
  | 'harpoon';

/**
 * Special-ability dispatch tag (game.ts:6797). `'weapon'` fires a projectile
 * volley (full weapon stats, evolves with level); `'dash'` is an i-frame lunge;
 * `'stim'` is a team-shield/haste buff. Only `'weapon'` carries firing stats.
 */
export type SpecialKind = 'weapon' | 'dash' | 'stim';

/**
 * Level-3 evolution branch (char.evolution). Unlocked at L3, intensified at L4
 * inside applyEvolution (game.ts:2701): multi = +shots, blast = +aoe/pierce,
 * shock = stun/arc, burn = ignite/patch.
 */
export type Evolution = 'multi' | 'blast' | 'shock' | 'burn';

// ---------------------------------------------------------------------------
// Weapon stats
// ---------------------------------------------------------------------------

/**
 * The main weapon block (`char.weapon`). All base fields are present on every
 * roster entry; the trailing modifiers are sparse. Tunable distances are in
 * tiles and speeds in tiles/second (game.ts:3) — the sim multiplies by TILE at
 * fire time.
 */
export interface Weapon {
  /** Display name (e.g. "Pulse SMG"). */
  name: string;
  kind: WeaponKind;
  /** Per-hit damage. */
  damage: number;
  /** Projectile speed, tiles/second. */
  projSpeed: number;
  /** Effective range, in tiles. */
  range: Tiles;
  /** Seconds between shots. */
  cooldown: number;
  /** Projectiles fired per shot. */
  count: number;
  /** Total spread arc in degrees across `count` shots (0 = straight). */
  spreadDeg: number;
  /** Whether projectiles ignore wall collision. */
  overWalls: boolean;

  /** Splash radius in tiles (game.ts:2710); absent ⇒ no AoE. */
  aoeRadius?: number;
  /** Number of enemies a shot passes through before dying; absent ⇒ 0. */
  pierce?: number;
  /** Angular curve applied to flight (game.ts:2658, 7954); absent ⇒ straight. */
  curve?: number;
  /** Custom projectile collision radius (game.ts:2674); absent ⇒ SHOT_R. */
  radius?: number;
}

// ---------------------------------------------------------------------------
// Specials
// ---------------------------------------------------------------------------

/** Fields common to every special, regardless of kind. */
interface SpecialBase {
  /** Display name (e.g. "Flank Volley"). */
  name: string;
  kind: SpecialKind;
  /** Ability recharge in seconds (game.ts:6819, defaults to 3 if absent). */
  cooldown: number;
}

/**
 * A projectile-volley special (`kind: 'weapon'`). Carries the same firing stats
 * as a Weapon and is run through applyEvolution + fireWeapon (game.ts:6816).
 */
export interface WeaponSpecial extends SpecialBase {
  kind: 'weapon';
  damage: number;
  projSpeed: number;
  range: Tiles;
  count: number;
  spreadDeg: number;
  overWalls: boolean;
  pierce: number;
  aoeRadius: number;
  curve: number;
  /** Custom projectile collision radius (only Warden's Aegis Orbit sets this). */
  radius?: number;
}

/** A dash/lunge special (`kind: 'dash'`): i-frames + burst move, no stats. */
export interface DashSpecial extends SpecialBase {
  kind: 'dash';
}

/** A team buff special (`kind: 'stim'`): shield/haste, no firing stats. */
export interface StimSpecial extends SpecialBase {
  kind: 'stim';
}

/** Discriminated union over `special.kind`. */
export type Special = WeaponSpecial | DashSpecial | StimSpecial;

// ---------------------------------------------------------------------------
// Character def
// ---------------------------------------------------------------------------

/**
 * One entry in shared/characters.json — a static, shared, never-mutated
 * character definition. Keyed by `id` in the charsById() lookup map.
 */
export interface CharacterDef {
  /** Stable roster id (e.g. "scout"); the charsById/charMap key and p.charId. */
  id: string;
  /** Display name (may differ from id, e.g. id "seal" → name "Selkie"). */
  name: string;
  /** Hex UI/tint colour, e.g. "#4fc3f7". */
  color: string;
  /** Base move speed in tiles/second (game.ts:6945 multiplies by TILE). */
  speed: number;
  /** True for the four operatives available from the start (no unlock). */
  starting: boolean;
  evolution: Evolution;
  weapon: Weapon;
  special: Special;

  /** True for milestone-unlock characters (13 of the roster). Absent ⇒ false. */
  milestone?: boolean;
  /** True if the character treats water as open ground (only "seal"/Selkie). */
  swims?: boolean;
}

/**
 * id-keyed lookup built by charsById() (game.ts:707) and stored as g.charMap;
 * the sim reads `g.charMap[p.charId]` (game.ts:2733, 6645+).
 */
export interface CharacterMap {
  [id: string]: CharacterDef;
}
