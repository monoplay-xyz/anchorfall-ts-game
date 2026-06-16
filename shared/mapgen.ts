// shared/mapgen.ts — DETERMINISTIC RANDOM MAP GENERATOR (issue #6).
//
// `generate(seed, params)` produces a fully-formed, guaranteed-valid LevelDef
// from a seed + a small parameter object. It is the third tool that builds
// against MAP-AUTHORING-CONTRACT.md alongside the validator (shared/mapValidate)
// and the Community DB.
//
// HARD GUARANTEES
//   - DETERMINISTIC. The only entropy source is a self-contained seeded PRNG
//     (mulberry32) keyed by an FNV-1a hash of the seed + the params. The same
//     (seed, params) ALWAYS yields a byte-identical LevelDef (verified by
//     JSON.stringify equality). There is NO Math.random, NO Date.now, NO
//     `new Date()`, NO wall-clock anywhere in this module. Retry/repair derive
//     their sub-seeds arithmetically from the base hash, so even the failure
//     path is reproducible.
//   - GEN-TIME ONLY. This module imports the sim purely to VALIDATE its own
//     output (parseLevel via validateLevelDef). It never mutates sim state and
//     produces only data — it cannot affect sim determinism.
//   - ALWAYS VALID. After building a candidate we run validateLevelDef; if it
//     fails we REPAIR (border / connectivity / K-count / marker placement) and,
//     if still bad, RE-ROLL with a derived sub-seed, looping up to MAX_ATTEMPTS.
//     generate() never returns an invalid map (it throws only if the absolute
//     fallback itself somehow fails, which the self-test proves it does not).
//
// Type imports are `import type` (esbuild strips them); the validator + roster
// helpers are runtime value imports from the emitted siblings.

import type { LevelDef, BuildDef, WaveDef, BastionDef } from '../types/level.js';
import type { CharacterDef, CharacterMap } from '../types/character.js';
import { validateLevelDef } from './mapValidate.js';
import { charsById } from './game.js';
// eslint-disable-next-line  — bundled JSON roster (resolveJsonModule)
import charactersJson from './characters.json' with { type: 'json' };

// ---------------------------------------------------------------------------
// Roster (loaded once; the validator ctx every candidate is checked against)
// ---------------------------------------------------------------------------
const CHARACTERS = charactersJson as unknown as CharacterDef[];
const CHAR_MAP: CharacterMap = charsById(CHARACTERS);
const VALIDATE_CTX = { charMap: CHAR_MAP, characters: CHARACTERS };
const STARTING_IDS = CHARACTERS.filter((c) => (c as any).starting).map((c) => c.id);
const CAPTIVE_POOL = STARTING_IDS.length ? STARTING_IDS : CHARACTERS.map((c) => c.id);

// ===========================================================================
// 1. Deterministic PRNG — FNV-1a string hash + mulberry32
// ===========================================================================

/** FNV-1a 32-bit hash of an arbitrary string → an unsigned 32-bit seed. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // h *= 16777619 (FNV prime), kept in 32-bit unsigned space
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: a tiny, well-distributed seeded PRNG. Pure; no globals. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return {
    /** next float in [0,1). */
    next(): number {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    /** integer in [0, n). */
    int(n: number): number {
      return Math.floor(this.next() * n);
    },
    /** integer in [lo, hi] inclusive. */
    range(lo: number, hi: number): number {
      return lo + Math.floor(this.next() * (hi - lo + 1));
    },
    /** pick one element of an array. */
    pick<T>(arr: readonly T[]): T {
      return arr[Math.floor(this.next() * arr.length)];
    },
    /** true with probability p. */
    chance(p: number): boolean {
      return this.next() < p;
    },
  };
}
type Rng = ReturnType<typeof mulberry32>;

// ===========================================================================
// 2. Public params
// ===========================================================================

export type MapSize = 'small' | 'medium' | 'large';

export interface GenParams {
  /** One of the 10 biomes (theme). Unknown values fall back to 'reliquary'. */
  biome: string;
  /** Spatial layout family (see ARCHETYPES). Unknown values fall back to centered-hold. */
  archetype: string;
  /** Win condition (see OBJECTIVES). Unknown values fall back to 'survival'. */
  objective: string;
  /** Named size bucket OR an explicit { w, h } in tiles. */
  size?: MapSize | { w: number; h: number };
  /** 1 (gentle) .. 5 (brutal); scales roster size + wave pressure. Default 3. */
  difficulty?: number;
}

// ===========================================================================
// 3. Biome vocabulary — floor + accent + hazard tiles per theme
// ===========================================================================

interface BiomePalette {
  /** Primary floor fill. */
  floor: string;
  /** Secondary cosmetic floor (scattered for texture). */
  accent: string;
  /** Hazard tile sprinkled in pockets ('' = none). */
  hazard: string;
  /** Per-tile probability a floor cell becomes the accent. */
  accentP: number;
  /** Per-tile probability a (non-structural) floor cell becomes a hazard pocket. */
  hazardP: number;
  /** Roster letters appropriate to the biome (drawn for night waves + camps). */
  roster: string[];
}

// Every floor/accent/hazard char below is a LEGAL_TILES walkable tile. Hazards
// '!','^','=','~','%' are placed only in interior pockets that the connectivity
// pass guarantees the spawn can route around (the validator floods around solids
// and treats '!','^','=' as walkable, so even hazard floors stay reachable).
const BIOMES: Record<string, BiomePalette> = {
  emberwaste: { floor: '+', accent: ',', hazard: '!', accentP: 0.10, hazardP: 0.05, roster: ['d', 'e', 'g', 'r', 'u'] },
  glacis:     { floor: '-', accent: ':', hazard: '^', accentP: 0.10, hazardP: 0.06, roster: ['h', 'i', 'g', 'w', 'r'] },
  mire:       { floor: '@', accent: ',', hazard: '~', accentP: 0.12, hazardP: 0.06, roster: ['j', 'z', 'q', 'v', 'g'] },
  dunes:      { floor: '=', accent: '_', hazard: '',  accentP: 0.14, hazardP: 0.00, roster: ['l', 'g', 'r', 'n', 'w'] },
  verdance:   { floor: '.', accent: ',', hazard: '',  accentP: 0.16, hazardP: 0.00, roster: ['z', 'w', 'g', 'r', 's'] },
  voidscar:   { floor: '/', accent: ';', hazard: '%', accentP: 0.10, hazardP: 0.05, roster: ['k', 'a', 'y', 'n', 'g'] },
  saltworks:  { floor: ',', accent: ':', hazard: '~', accentP: 0.10, hazardP: 0.07, roster: ['$', 'r', 's', 'j', 'g'] },
  nocturne:   { floor: '.', accent: ';', hazard: '',  accentP: 0.12, hazardP: 0.00, roster: ['x', 'w', 'g', 'n', 'h'] },
  crucible:   { floor: '+', accent: '*', hazard: '!', accentP: 0.08, hazardP: 0.06, roster: ['d', 'u', 'e', 'r', 's'] },
  reliquary:  { floor: '.', accent: ':', hazard: '',  accentP: 0.12, hazardP: 0.00, roster: ['a', 'n', 'g', 'q', 'y'] },
};
const BIOME_KEYS = Object.keys(BIOMES);
const DEFAULT_BIOME = 'reliquary';

// ===========================================================================
// 4. Size buckets
// ===========================================================================

const SIZES: Record<MapSize, { w: number; h: number }> = {
  small: { w: 40, h: 30 },
  medium: { w: 56, h: 40 },
  large: { w: 72, h: 50 },
};

function resolveSize(size: GenParams['size']): { w: number; h: number } {
  if (size && typeof size === 'object') {
    // clamp to sane, border-safe bounds
    const w = Math.max(20, Math.min(120, Math.round(size.w)));
    const h = Math.max(16, Math.min(90, Math.round(size.h)));
    return { w, h };
  }
  return SIZES[(size as MapSize) || 'medium'] || SIZES.medium;
}

// ===========================================================================
// 5. Grid scaffold (a mutable char matrix; serialized to string[] at the end)
// ===========================================================================

class Grid {
  w: number;
  h: number;
  cells: string[][];
  constructor(w: number, h: number, fill: string) {
    this.w = w;
    this.h = h;
    this.cells = Array.from({ length: h }, (_, y) =>
      Array.from({ length: w }, (_, x) =>
        (x === 0 || y === 0 || x === w - 1 || y === h - 1) ? '#' : fill,
      ),
    );
  }
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  /** interior = not on the solid border ring. */
  interior(x: number, y: number): boolean {
    return x > 0 && y > 0 && x < this.w - 1 && y < this.h - 1;
  }
  get(x: number, y: number): string {
    return this.cells[y][x];
  }
  set(x: number, y: number, c: string): void {
    if (this.interior(x, y)) this.cells[y][x] = c;
  }
  rows(): string[] {
    return this.cells.map((r) => r.join(''));
  }
}

// The set of tiles the validator's flood treats as IMPASSABLE. Mirrors PASS().
const SOLID = new Set(['#', 'T', '~', 'o', '%']);
const isPass = (c: string): boolean => !SOLID.has(c);
// Tiles we may freely overwrite when carving / placing markers (plain walkable
// floor — never a marker we already placed, never a hazard we want to keep).
const FLOORISH = new Set(['.', ',', ':', ';', '_', '+', '-', '@', '/', '*', '=', '^']);

// ===========================================================================
// 6. Archetypes — where the core 'K', spawns 'P' and structure go
// ===========================================================================

type ArchetypeKey =
  | 'centered-hold'
  | 'back-line'
  | 'corner-keep'
  | 'far-redoubt'
  | 'four-corner-beacons'
  | 'perimeter-ring';

const ARCHETYPES: ArchetypeKey[] = [
  'centered-hold',
  'back-line',
  'corner-keep',
  'far-redoubt',
  'four-corner-beacons',
  'perimeter-ring',
];

function resolveArchetype(a: string): ArchetypeKey {
  return (ARCHETYPES as string[]).includes(a) ? (a as ArchetypeKey) : 'centered-hold';
}

// ===========================================================================
// 7. Objectives
// ===========================================================================

type ObjectiveKey =
  | 'bastion'      // multi-night core hold
  | 'beacons'      // four-monolith hold
  | 'capture'      // king-of-the-hill zone
  | 'bridge'       // cross-and-hold far redoubt
  | 'escort'       // push a mobile anchor (coreless)
  | 'gate'         // raise pylon quorum to open the extract
  | 'survival';    // timed wave survival (coreless, classic mode)

const OBJECTIVES: ObjectiveKey[] = [
  'bastion', 'beacons', 'capture', 'bridge', 'escort', 'gate', 'survival',
];

function resolveObjective(o: string): ObjectiveKey {
  return (OBJECTIVES as string[]).includes(o) ? (o as ObjectiveKey) : 'survival';
}

// ===========================================================================
// 8. Terrain painting
// ===========================================================================

/** Fill the interior with the biome floor, scatter accents + hazard pockets. */
function paintBiome(grid: Grid, pal: BiomePalette, rng: Rng): void {
  for (let y = 1; y < grid.h - 1; y++) {
    for (let x = 1; x < grid.w - 1; x++) {
      let c = pal.floor;
      if (rng.chance(pal.accentP)) c = pal.accent;
      grid.cells[y][x] = c;
    }
  }
  // hazard pockets: small blobs, kept away from the border ring (>=2 in) so the
  // perimeter walk-around always exists.
  if (pal.hazard) {
    const pockets = Math.round((grid.w * grid.h) / 220);
    for (let p = 0; p < pockets; p++) {
      if (!rng.chance(0.7)) continue;
      const cx = rng.range(3, grid.w - 4);
      const cy = rng.range(3, grid.h - 4);
      const r = rng.range(1, 2);
      for (let yy = cy - r; yy <= cy + r; yy++) {
        for (let xx = cx - r; xx <= cx + r; xx++) {
          if (!grid.interior(xx, yy)) continue;
          if (Math.abs(xx - cx) + Math.abs(yy - cy) > r) continue;
          if (rng.chance(pal.hazardP * 8)) grid.cells[yy][xx] = pal.hazard;
        }
      }
    }
  }
}

/** Sprinkle a few interior wall/tree clusters for cover (never sealing a region;
 *  the connectivity pass + repair guarantee reachability regardless). */
function scatterCover(grid: Grid, rng: Rng, density: number): void {
  const blobs = Math.round((grid.w * grid.h) / 600 * density);
  for (let b = 0; b < blobs; b++) {
    const cx = rng.range(4, grid.w - 5);
    const cy = rng.range(4, grid.h - 5);
    const len = rng.range(1, 3);
    const horiz = rng.chance(0.5);
    const ch = rng.chance(0.6) ? '#' : 'T';
    for (let i = 0; i < len; i++) {
      const x = horiz ? cx + i : cx;
      const y = horiz ? cy : cy + i;
      if (grid.interior(x, y) && FLOORISH.has(grid.get(x, y))) grid.set(x, y, ch);
    }
  }
}

// ===========================================================================
// 9. Connectivity — carve a guaranteed open spanning path through the interior
// ===========================================================================

/** Flood from (sx,sy) over PASS tiles; returns the reachable cell set. */
function floodReach(grid: Grid, sx: number, sy: number): Set<string> {
  const seen = new Set<string>();
  const stack: [number, number][] = [[sx, sy]];
  seen.add(sx + ',' + sy);
  while (stack.length) {
    const [x, y] = stack.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
      if (!grid.inBounds(nx, ny) || seen.has(k)) continue;
      if (!isPass(grid.get(nx, ny))) continue;
      seen.add(k);
      stack.push([nx, ny]);
    }
  }
  return seen;
}

/** Carve a straight L-shaped corridor of plain floor between two interior tiles. */
function carvePath(grid: Grid, ax: number, ay: number, bx: number, by: number): void {
  let x = ax, y = ay;
  const stepTo = (tx: number, ty: number): void => {
    while (x !== tx) {
      x += Math.sign(tx - x);
      if (grid.interior(x, y) && SOLID.has(grid.get(x, y))) grid.set(x, y, '.');
    }
    while (y !== ty) {
      y += Math.sign(ty - y);
      if (grid.interior(x, y) && SOLID.has(grid.get(x, y))) grid.set(x, y, '.');
    }
  };
  stepTo(bx, by);
}

/** Ensure (tx,ty) is reachable from spawn; if not, carve a corridor to it. */
function ensureReachable(grid: Grid, sx: number, sy: number, tx: number, ty: number): void {
  if (SOLID.has(grid.get(tx, ty)) && grid.interior(tx, ty)) grid.set(tx, ty, '.');
  const seen = floodReach(grid, sx, sy);
  if (seen.has(tx + ',' + ty)) return;
  carvePath(grid, sx, sy, tx, ty);
}

// ===========================================================================
// 10. Marker placement bookkeeping
// ===========================================================================

class Placer {
  grid: Grid;
  rng: Rng;
  /** record of placed marker tiles by char (for parity/debug). */
  used: [number, number][] = [];
  constructor(grid: Grid, rng: Rng) {
    this.grid = grid;
    this.rng = rng;
  }
  /** Is (x,y) plain walkable floor we can safely stamp a marker onto? */
  freeFloor(x: number, y: number): boolean {
    return this.grid.interior(x, y) && FLOORISH.has(this.grid.get(x, y));
  }
  /** Stamp a marker at exactly (x,y), forcing the cell to floor first. */
  stampAt(x: number, y: number, ch: string): boolean {
    if (!this.grid.interior(x, y)) return false;
    if (SOLID.has(this.grid.get(x, y))) this.grid.set(x, y, '.');
    this.grid.set(x, y, ch);
    this.used.push([x, y]);
    return true;
  }
  /** Find the nearest free-floor cell to (x,y) via expanding rings, then stamp. */
  stampNear(x: number, y: number, ch: string, maxR = 12): [number, number] | null {
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx, ny = y + dy;
          if (this.freeFloor(nx, ny)) {
            this.grid.set(nx, ny, ch);
            this.used.push([nx, ny]);
            return [nx, ny];
          }
        }
      }
    }
    // last resort: force the exact cell to floor and stamp
    if (this.grid.interior(x, y)) {
      this.grid.set(x, y, '.');
      this.grid.set(x, y, ch);
      this.used.push([x, y]);
      return [x, y];
    }
    return null;
  }
}

// ===========================================================================
// 11. Difficulty scaling
// ===========================================================================

function clampDiff(d: number | undefined): number {
  const v = Math.round(d ?? 3);
  return Math.max(1, Math.min(5, Number.isFinite(v) ? v : 3));
}

/** Build a deterministic night roster string for a wave from the biome pool. */
function rosterFor(pal: BiomePalette, diff: number, rng: Rng): string {
  const n = 3 + diff; // 4..8 enemies per wave by difficulty
  let s = '';
  for (let i = 0; i < n; i++) s += rng.pick(pal.roster);
  return s;
}

// ===========================================================================
// 12. Core candidate builder — assembles one LevelDef from the rng stream
// ===========================================================================

interface BuildContext {
  biome: string;
  pal: BiomePalette;
  archetype: ArchetypeKey;
  objective: ObjectiveKey;
  diff: number;
  w: number;
  h: number;
}

const NIGHT_EDGES: Array<'n' | 's' | 'e' | 'w'> = ['n', 's', 'e', 'w'];

function buildCandidate(ctx: BuildContext, rng: Rng): LevelDef {
  const grid = new Grid(ctx.w, ctx.h, ctx.pal.floor);
  paintBiome(grid, ctx.pal, rng);
  scatterCover(grid, rng, ctx.archetype === 'perimeter-ring' ? 0.6 : 1.0);

  const cx = Math.floor(ctx.w / 2);
  const cy = Math.floor(ctx.h / 2);

  // --- decide the "hold point" + spawn anchor from the archetype ---
  let holdX = cx, holdY = cy;
  let spawnX = cx, spawnY = cy;
  let beaconPts: Array<[number, number]> = [];
  switch (ctx.archetype) {
    case 'centered-hold':
      holdX = cx; holdY = cy; spawnX = cx; spawnY = cy; break;
    case 'back-line':
      holdX = cx; holdY = ctx.h - 4; spawnX = cx; spawnY = ctx.h - 5; break;
    case 'corner-keep':
      holdX = 5; holdY = 5; spawnX = 6; spawnY = 6; break;
    case 'far-redoubt':
      holdX = ctx.w - 5; holdY = 4; spawnX = 4; spawnY = ctx.h - 4; break;
    case 'four-corner-beacons':
      holdX = cx; holdY = cy; spawnX = cx; spawnY = cy;
      beaconPts = [
        [4, 4], [ctx.w - 5, 4], [4, ctx.h - 5], [ctx.w - 5, ctx.h - 5],
      ];
      break;
    case 'perimeter-ring':
      holdX = cx; holdY = cy; spawnX = cx; spawnY = cy;
      // a ring of cover around the centre, with four gateways
      ringWall(grid, cx, cy, Math.min(cx, cy) - 4);
      break;
  }

  const placer = new Placer(grid, rng);

  // --- player spawns: a small cluster of 2-4 P near the spawn anchor ---
  const spawnAnchor = placer.stampNear(spawnX, spawnY, 'P') || [spawnX, spawnY];
  const [psx, psy] = spawnAnchor;
  const extraSpawns = 1 + rng.range(1, 3);
  for (let i = 0; i < extraSpawns; i++) {
    placer.stampNear(psx + rng.range(-2, 2), psy + rng.range(-2, 2), 'P');
  }

  const def: any = {};
  const coreless = ctx.objective === 'escort' || (ctx.objective === 'survival');

  // --- objective wiring (markers + def fields + mode) ---
  wireObjective(def, ctx, grid, placer, rng, {
    holdX, holdY, spawnX: psx, spawnY: psy, beaconPts, coreless,
  });

  // --- enemy camps / sleepers scattered in the interior, scaled to difficulty ---
  scatterCamps(def, ctx, grid, placer, rng);

  // --- a few support structures + chests for flavour (kept light + valid) ---
  decorate(def, ctx, grid, placer, rng);

  // --- presentation / theme / timing ---
  finalizePresentation(def, ctx, rng);

  // --- ensure every placed marker is reachable from the first spawn ---
  reconcileReachability(grid, def);

  def.tiles = grid.rows();
  return def as LevelDef;
}

/** Stamp a hollow ring of walls with four cardinal gateways (perimeter-ring). */
function ringWall(grid: Grid, cx: number, cy: number, r: number): void {
  if (r < 3) return;
  for (let a = -r; a <= r; a++) {
    const pts: Array<[number, number]> = [
      [cx + a, cy - r], [cx + a, cy + r], [cx - r, cy + a], [cx + r, cy + a],
    ];
    for (const [x, y] of pts) {
      if (grid.interior(x, y)) grid.set(x, y, '#');
    }
  }
  // carve gateways N/S/E/W
  for (const [gx, gy] of [[cx, cy - r], [cx, cy + r], [cx - r, cy], [cx + r, cy]] as const) {
    if (grid.interior(gx, gy)) grid.set(gx, gy, '.');
  }
}

// ===========================================================================
// 13. Objective wiring
// ===========================================================================

interface WireInfo {
  holdX: number;
  holdY: number;
  spawnX: number;
  spawnY: number;
  beaconPts: Array<[number, number]>;
  coreless: boolean;
}

function wireObjective(
  def: any, ctx: BuildContext, grid: Grid, placer: Placer, rng: Rng, info: WireInfo,
): void {
  const diff = ctx.diff;

  switch (ctx.objective) {
    case 'beacons': {
      def.mode = 'bastion';
      def.bastionVariant = 'beacons';
      // exactly 4 K tiles at the four beacon points (or four spread points)
      const pts = info.beaconPts.length === 4 ? info.beaconPts : [
        [4, 4], [ctx.w - 5, 4], [4, ctx.h - 5], [ctx.w - 5, ctx.h - 5],
      ];
      for (const [bx, by] of pts) placer.stampNear(bx, by, 'K');
      def.bastion = bastionCfg(ctx, rng, false);
      break;
    }
    case 'capture': {
      def.mode = 'bastion';
      // single core at hold; capture zone over it
      placer.stampNear(info.holdX, info.holdY, 'K');
      def.capture = {
        x: info.holdX, y: info.holdY,
        radius: 3, duration: 45 + diff * 5, threshold: 1, decay: 1, contest: true,
      };
      def.bastion = bastionCfg(ctx, rng, false);
      break;
    }
    case 'bridge': {
      def.mode = 'bastion';
      // far redoubt core; armOnReach defers the night clock until reached
      const [kx, ky] = placer.stampNear(info.holdX, info.holdY, 'K') || [info.holdX, info.holdY];
      def.bridge = { armOnReach: true, reachRadius: 1.5, holdAt: [kx, ky] };
      def.bastion = { ...bastionCfg(ctx, rng, false), armOnReach: true };
      break;
    }
    case 'escort': {
      def.mode = 'bastion';
      // coreless: a mobile anchor crawling a lane of >=2 reachable waypoints
      const path = escortPath(ctx, grid, info);
      def.escort = { path, speed: 1, holdRadius: 3, hp: 60 + diff * 20 };
      def.bastion = { ...bastionCfg(ctx, rng, true), survival: false };
      break;
    }
    case 'gate': {
      // raise a pylon quorum to open the extract; place E exits
      def.mode = 'bastion';
      placer.stampNear(info.holdX, info.holdY, 'K');
      const need = 3 + (diff >= 4 ? 1 : 0); // 3 or 4 pylons
      def.builds = def.builds || [];
      const pylonPts = spreadPoints(ctx, need, rng);
      for (const [bx, by] of pylonPts) {
        const at = placer.stampNear(bx, by, 'B');
        if (at) def.builds.push({ kind: 'pylon', cost: 12 } as BuildDef);
      }
      def.gate = { need };
      // place extract tiles near a corner, on floor
      const ex = ctx.w - 4, ey = ctx.h - 4;
      placer.stampNear(ex, ey, 'E');
      placer.stampNear(ex - 1, ey, 'E');
      def.bastion = bastionCfg(ctx, rng, false);
      break;
    }
    case 'bastion': {
      def.mode = 'bastion';
      placer.stampNear(info.holdX, info.holdY, 'K');
      def.bastion = bastionCfg(ctx, rng, false);
      break;
    }
    case 'survival':
    default: {
      // classic timed survival: coreless, timed reinforcement waves
      def.timed = true;
      def.time = 120 + diff * 30;
      def.modifiers = { waves: surviveWaves(ctx, rng) };
      break;
    }
  }
}

/** Build a BastionDef (nights / roster / waveMult / edges) scaled to difficulty. */
function bastionCfg(ctx: BuildContext, rng: Rng, survival: boolean): BastionDef & any {
  const diff = ctx.diff;
  const nights = 3 + (diff >= 3 ? 1 : 0) + (diff >= 5 ? 1 : 0); // 3..5
  const roster = uniqueRoster(ctx.pal, rng, 3 + Math.min(2, diff - 1));
  const bloodMoons = diff >= 4 ? [nights] : [];
  const edgeCount = 1 + Math.min(3, diff - 1);
  const edges = pickEdges(rng, edgeCount);
  const cfg: any = {
    nights,
    dayLen: 120,
    nightLen: 50 + diff * 6,
    bloodMoons,
    wavesPerNight: diff >= 4 ? 2 : 1,
    waveMult: +(1 + (diff - 1) * 0.2).toFixed(2), // 1.0 .. 1.8
    roster,
    edges,
  };
  if (survival) cfg.survival = true;
  return cfg;
}

/** A unique, deterministic subset of the biome roster, length n. */
function uniqueRoster(pal: BiomePalette, rng: Rng, n: number): string[] {
  const pool = [...pal.roster];
  const out: string[] = [];
  while (out.length < n && pool.length) {
    const i = rng.int(pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out.length ? out : ['g'];
}

function pickEdges(rng: Rng, n: number): Array<'n' | 's' | 'e' | 'w'> {
  const pool = [...NIGHT_EDGES];
  const out: Array<'n' | 's' | 'e' | 'w'> = [];
  for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(rng.int(pool.length), 1)[0]);
  return out.length ? out : ['s'];
}

/** Timed survival waves (modifiers.waves) — legal letters + edges only. */
function surviveWaves(ctx: BuildContext, rng: Rng): WaveDef[] {
  const count = 2 + ctx.diff; // 3..7 waves
  const out: WaveDef[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      at: 30 + i * 30,
      letters: rosterFor(ctx.pal, ctx.diff, rng),
      edge: rng.pick(NIGHT_EDGES),
    });
  }
  return out;
}

/** A spread of n interior points, away from the border, deterministic. */
function spreadPoints(ctx: BuildContext, n: number, rng: Rng): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const rx = (ctx.w / 2 - 6) * Math.cos(ang);
    const ry = (ctx.h / 2 - 6) * Math.sin(ang);
    const x = Math.round(ctx.w / 2 + rx) + rng.range(-1, 1);
    const y = Math.round(ctx.h / 2 + ry) + rng.range(-1, 1);
    out.push([Math.max(3, Math.min(ctx.w - 4, x)), Math.max(3, Math.min(ctx.h - 4, y))]);
  }
  return out;
}

/** Build a left→right escort lane of reachable waypoints (tile coords). */
function escortPath(ctx: BuildContext, grid: Grid, info: WireInfo): Array<[number, number]> {
  const y0 = Math.max(3, Math.min(ctx.h - 4, info.spawnY));
  const startX = 4;
  const endX = ctx.w - 5;
  const segs = 4;
  const path: Array<[number, number]> = [];
  for (let i = 0; i <= segs; i++) {
    const x = Math.round(startX + ((endX - startX) * i) / segs);
    const y = i === 0 ? y0 : Math.max(3, Math.min(ctx.h - 4, y0 + (i % 2 === 0 ? -2 : 2)));
    path.push([x, y]);
  }
  // carve the lane so every waypoint is reachable
  for (let i = 1; i < path.length; i++) {
    carvePath(grid, path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
  }
  return path;
}

// ===========================================================================
// 14. Enemy camps + decoration
// ===========================================================================

function scatterCamps(def: any, ctx: BuildContext, grid: Grid, placer: Placer, rng: Rng): void {
  const camps = 2 + ctx.diff; // 3..7 camps
  for (let c = 0; c < camps; c++) {
    const cx = rng.range(4, ctx.w - 5);
    const cy = rng.range(4, ctx.h - 5);
    const size = rng.range(1, 2 + Math.min(2, ctx.diff - 1));
    for (let i = 0; i < size; i++) {
      const ex = cx + rng.range(-2, 2);
      const ey = cy + rng.range(-2, 2);
      if (placer.freeFloor(ex, ey)) {
        placer.grid.set(ex, ey, rng.pick(ctx.pal.roster));
      }
    }
  }
}

function decorate(def: any, ctx: BuildContext, grid: Grid, placer: Placer, rng: Rng): void {
  // a couple of loot chests
  const chests = rng.range(1, 3);
  def.chests = def.chests || [];
  for (let i = 0; i < chests; i++) {
    const at = placer.stampNear(rng.range(4, ctx.w - 5), rng.range(4, ctx.h - 5), 'C', 6);
    if (at) def.chests.push({ loot: 'shards', amount: 6 + i });
  }
  if (def.chests.length === 0) delete def.chests;

  // an optional rescuable captive (only for non-coreless, lower difficulty)
  if (ctx.objective !== 'escort' && rng.chance(0.5)) {
    const at = placer.stampNear(rng.range(5, ctx.w - 6), rng.range(5, ctx.h - 6), 'c', 6);
    if (at) def.captiveChars = [rng.pick(CAPTIVE_POOL)];
  }
}

// ===========================================================================
// 15. Presentation
// ===========================================================================

const BIOME_NAMES: Record<string, string[]> = {
  emberwaste: ['Ashen Hold', 'Cinder Watch', 'Emberfall Line'],
  glacis:     ['Frostward Keep', 'Glacier Vigil', 'Rime Bastion'],
  mire:       ['Bogfast Redoubt', 'Mirewatch', 'Peat Hollow'],
  dunes:      ['Dunewatch', 'The Sand Anchor', 'Scour Hold'],
  verdance:   ['Greenward Stand', 'Overgrowth Keep', 'Thornwatch'],
  voidscar:   ['Void Rim Hold', 'The Shattered Anchor', 'Slabwatch'],
  saltworks:  ['Brinefast', 'Saltmarsh Vigil', 'Tidewatch'],
  nocturne:   ['Moonless Hold', 'Nightward Keep', 'The Dark Vigil'],
  crucible:   ['Forgewatch', 'The Crucible Line', 'Ashshelf Hold'],
  reliquary:  ['Hallowed Vigil', 'Reliquary Keep', 'The Quiet Anchor'],
};

const OBJECTIVE_BLURB: Record<ObjectiveKey, string> = {
  bastion: 'Hold the core through every night until the dawn relief arrives.',
  beacons: 'Keep all four monoliths humming through the nights.',
  capture: 'Seize the contested ground and hold it under fire.',
  bridge: 'Cross to the far redoubt, then hold it once the night clock starts.',
  escort: 'Push the wrecked anchor up the lane and keep its deck clear.',
  gate: 'Raise the pylon quorum to open the extract, then get clear.',
  survival: 'Outlast the timed waves until the countdown runs out.',
};

function finalizePresentation(def: any, ctx: BuildContext, rng: Rng): void {
  def.theme = ctx.biome;
  def.name = rng.pick(BIOME_NAMES[ctx.biome] || BIOME_NAMES[DEFAULT_BIOME]);
  def.objective = OBJECTIVE_BLURB[ctx.objective];
  def.expedition = true;
  if (def.mode === 'bastion') {
    def.time = 600;
  } else if (!def.time) {
    def.time = 120 + ctx.diff * 30;
  }
}

// ===========================================================================
// 16. Reachability reconciliation (pre-validation safety net)
// ===========================================================================

/** Carve corridors from the first spawn to every objective-critical marker so
 *  the validator's flood always succeeds. Deterministic (grid order). */
function reconcileReachability(grid: Grid, def: any): void {
  // find the first 'P'
  let sx = -1, sy = -1;
  outer: for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      if (grid.get(x, y) === 'P') { sx = x; sy = y; break outer; }
    }
  }
  if (sx < 0) return;
  // markers that MUST be reachable
  const must = new Set(['K', 'c', 'N', 'B', 'Q', 'J', 'X', 'Z', 'E']);
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      if (must.has(grid.get(x, y))) ensureReachable(grid, sx, sy, x, y);
    }
  }
  // escort waypoints + capture zone
  if (def.escort && def.escort.path) {
    for (const wp of def.escort.path) {
      const [wx, wy] = Array.isArray(wp) ? wp : [wp.x, wp.y];
      ensureReachable(grid, sx, sy, wx, wy);
    }
  }
  if (def.capture) ensureReachable(grid, sx, sy, def.capture.x, def.capture.y);
}

// ===========================================================================
// 17. Post-build repair (run only if validation fails)
// ===========================================================================

/** Repair the most common validation failures in place on a fresh Grid clone.
 *  Returns a new candidate def. Deterministic. */
function repairCandidate(def: any, ctx: BuildContext): LevelDef {
  const rows = (def.tiles as string[]).map((r) => r.split(''));
  const grid = new Grid(rows[0].length, rows.length, '.');
  grid.cells = rows;
  // 1. force a solid border
  for (let x = 0; x < grid.w; x++) { grid.cells[0][x] = '#'; grid.cells[grid.h - 1][x] = '#'; }
  for (let y = 0; y < grid.h; y++) { grid.cells[y][0] = '#'; grid.cells[y][grid.w - 1] = '#'; }
  // 2. reconcile reachability again
  reconcileReachability(grid, def);
  def.tiles = grid.rows();
  return def as LevelDef;
}

// ===========================================================================
// 18. Absolute fallback — a trivially-valid arena that ALWAYS passes
// ===========================================================================

function fallbackArena(ctx: BuildContext): LevelDef {
  const W = Math.max(20, ctx.w), H = Math.max(16, ctx.h);
  const rows: string[] = [];
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) {
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) row += '#';
      else row += ctx.pal.floor;
    }
    rows.push(row);
  }
  // place a single core + spawn cluster at centre, on plain floor
  const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
  const set = (x: number, y: number, c: string): void => {
    rows[y] = rows[y].slice(0, x) + c + rows[y].slice(x + 1);
  };
  set(cx, cy, 'K');
  set(cx - 2, cy, 'P');
  set(cx + 2, cy, 'P');
  set(cx, cy - 2, 'P');
  const def: any = {
    name: (BIOME_NAMES[ctx.biome] || BIOME_NAMES[DEFAULT_BIOME])[0],
    objective: OBJECTIVE_BLURB.bastion,
    theme: ctx.biome,
    mode: 'bastion',
    expedition: true,
    time: 600,
    bastion: {
      nights: 3,
      bloodMoons: [],
      roster: ctx.pal.roster.slice(0, 3),
      edges: ['s'],
    },
    tiles: rows,
  };
  return def as LevelDef;
}

// ===========================================================================
// 19. PUBLIC ENTRYPOINT
// ===========================================================================

const MAX_ATTEMPTS = 60;

export function generate(seed: number | string, params: GenParams): LevelDef {
  const biome = BIOME_KEYS.includes(params.biome) ? params.biome : DEFAULT_BIOME;
  const pal = BIOMES[biome];
  const archetype = resolveArchetype(params.archetype);
  const objective = resolveObjective(params.objective);
  const diff = clampDiff(params.difficulty);
  const { w, h } = resolveSize(params.size);

  // a single deterministic base hash off the FULL parameter signature
  const sig = `${seed}|${biome}|${archetype}|${objective}|${diff}|${w}x${h}`;
  const baseHash = fnv1a(sig);

  const ctx: BuildContext = { biome, pal, archetype, objective, diff, w, h };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // derive a fresh, deterministic sub-seed per attempt (no wall-clock)
    const subSeed = fnv1a(sig + '#' + attempt) ^ Math.imul(baseHash, attempt + 1);
    const rng = mulberry32(subSeed >>> 0);

    let cand = buildCandidate(ctx, rng);
    let res = validateLevelDef(cand, VALIDATE_CTX);
    if (res.ok) return cand;

    // one repair pass on this candidate before re-rolling
    cand = repairCandidate(cand as any, ctx);
    res = validateLevelDef(cand, VALIDATE_CTX);
    if (res.ok) return cand;
  }

  // Guaranteed-valid fallback (the self-test proves this branch is never hit,
  // but generate() must NEVER return an invalid map).
  const fb = fallbackArena(ctx);
  const res = validateLevelDef(fb, VALIDATE_CTX);
  if (res.ok) return fb;
  // If even the fallback fails the environment is broken; surface it loudly.
  throw new Error('mapgen: could not produce a valid map: ' + res.problems.join('; '));
}

export default generate;
