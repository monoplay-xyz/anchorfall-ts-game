// types/input.d.ts — the per-seat Input contract for the TS migration (issue #4).
//
// ONLY ambient declarations (no runtime code). Describes a single seat's input
// object consumed by the deterministic sim via `step(g, inputs, dt)`, where
// `inputs` is a map keyed by player id (Pid). Every field here was extracted
// directly from how the sim READS input in shared/game.ts (export function
// step at game.ts:6467, plus stepPlacement / stepSuperweaponInput / the various
// `const inp = inputs[p.pid] || {}` action helpers) and cross-checked against
// how public/client.ts BUILDS each seat's input (the per-device read at
// client.ts:447, the wire object at client.ts:2362, and the mouse-aim /
// superweapon augmentation at client.ts:460/2371/2377/2383).
//
// Naming note: the sim's interact button is `act` (the on-screen [E/X] prompt),
// NOT `talk` — talking to an NPC is just `act` next to them. There is no `talk`
// or `build` field: structure placement is `place` (enter placement mode) and
// the relic superweapon assemble is `superBuild`. Aim is carried as the two
// scalars `aimX`/`aimY` (world pixels), NOT an `aim: {x,y}` object.

import type { Pid, Px } from './common';

// ---------------------------------------------------------------------------
// SuperBuildKind
// ---------------------------------------------------------------------------
// The relic superweapon the seat asks to assemble on a rising edge of
// `superBuild`. The sim only accepts these two (SUPER_KINDS, game.ts:153:
// `new Set(['nuke', 'weather'])`) and no-ops anything else; the client mirrors
// the same guard before queueing (client.ts:2094 queueSuperBuild). Any other
// value (or absence) means "don't build".
export type SuperBuildKind = 'nuke' | 'weather';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
// One seat's input for a single sim tick. The sim tolerates a fully empty
// object (`inputs[p.pid] || {}`), and the client only ever sends the optional
// fields when relevant, so EVERY field is optional and is read with truthiness
// (`!!inp.x`) or an `=== undefined` guard. Movement/action fields are plain
// booleans; aim is a pair of world-pixel scalars present only while placing.
export interface Input {
  // --- movement (held booleans; also used as the placement-ghost stepper) ---
  /** Move up / north. */
  up?: boolean;
  /** Move down / south. */
  down?: boolean;
  /** Move left / west. */
  left?: boolean;
  /** Move right / east. */
  right?: boolean;

  // --- primary actions (held booleans; the sim derives rising edges itself) ---
  /** Primary weapon trigger; also doubles as the superweapon launch button
   *  (see `superFire`) and as a placement-confirm. */
  fire?: boolean;
  /** Special / ability button (also placement cancel). */
  special?: boolean;
  /** Interact button ([E/X]): talk to NPCs, use forges/beacons/horns/ships,
   *  drive the turret-type carousel, board vehicles, placement confirm, etc.
   *  This is the field the sim reads everywhere it needs "interact". */
  act?: boolean;
  /** Use carried/selected item. */
  item?: boolean;

  // --- inventory + placement (edge-detected by the sim) ---
  /** Cycle the selected placeable in the seat's inventory (rising edge). */
  invSel?: boolean;
  /** Enter placement mode for the selected inventory item (rising edge). */
  place?: boolean;
  /** Drop whatever is carried — scrap / a carried operator / a relic fragment
   *  (rising edge). */
  drop?: boolean;

  // --- movement modifier ---
  /** Hold to sprint (drains the stamina meter while moving). */
  sprint?: boolean;

  // --- aim (placement / targeting cursor, world pixels) ---
  // Present together only while a keyboard seat is actually placing a structure
  // (seatNeedsAim gate). When both are defined the sim snaps the ghost to that
  // world point absolutely; otherwise it steps the ghost via the arrow/stick
  // edges above. The sim checks `aimX !== undefined && aimY !== undefined`.
  /** Aim cursor X in world (pixel) space. */
  aimX?: Px;
  /** Aim cursor Y in world (pixel) space. */
  aimY?: Px;

  // --- relic superweapon ---
  /** Assemble the one-shot relic superweapon on this seat's tile, on a rising
   *  edge. Only `'nuke'`/`'weather'` are honored; anything else is a no-op. */
  superBuild?: SuperBuildKind;
  /** Launch a READY relic superweapon (a plain trigger — the sim auto-targets
   *  the densest hostile cluster; no aim involved). In the client this is wired
   *  to the same value as `fire` for a seat that owns a ready device. */
  superFire?: boolean;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------
// The full second argument to `step(g, inputs, dt)`: a per-seat input map keyed
// by player id. Seats with no entry (or an empty `{}`) are treated as idle.
export type Inputs = Record<Pid, Input>;
