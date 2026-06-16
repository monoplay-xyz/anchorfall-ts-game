// public/mapBuilder.ts — the VISUAL MAP BUILDER's pure core (issue #5, Stage A).
//
// This module is DOM-FREE on purpose. It owns:
//
//   1. The tile PALETTE (the legend chars from MAP-AUTHORING-CONTRACT.md, grouped
//      and labelled) + a per-tile minimap colour mirror, so the canvas UI can
//      paint swatches and the panel can list enemies/markers — all from one
//      source of truth.
//   2. The PURE assembly function `builderStateToLevelDef(state): LevelDef`, the
//      single place a painted grid + def-panel knobs become an authored LevelDef
//      (schema-identical to the JSON under levels/<cat>/). Because it is pure
//      (no DOM, no fs, no globals), it is unit-smoked in Node independent of the
//      browser: assemble -> validateLevelDef -> parseLevel/createGame/step.
//
// The canvas/panel shell (in public/client.ts) is a thin layer that maintains a
// BuilderState and calls builderStateToLevelDef() on every edit to drive the live
// preview + the validate-before-export gate. It MUST NOT reimplement assembly.

import type {
  LevelDef,
  Theme,
  Difficulty,
  BastionDef,
  WaveDef,
} from '../types/level';

// ---------------------------------------------------------------------------
// 1. TILE PALETTE (mirrors §1 of MAP-AUTHORING-CONTRACT.md exactly)
// ---------------------------------------------------------------------------

/** One paintable tile: its legend char, a human label, and a swatch colour
 *  (mirrors render.ts's MM_TILE so swatches read like the minimap). */
export interface PaletteTile {
  ch: string;
  name: string;
  color: string;
}

/** A labelled group of tiles in the palette (floors / walls / hazards / ...). */
export interface PaletteGroup {
  group: string;
  tiles: PaletteTile[];
}

// Swatch colours: terrain/biome floors mirror render.ts MM_TILE; markers/enemies
// get distinct readable hues (the engine draws those as sprites, not tiles).
const C = {
  floor: '#1c242b', floorV1: '#221C22', floorV2: '#2A2820', floorV3: '#272b38', floorV4: '#15121a',
  wall: '#343A48', tree: '#23392b', water: '#101A2E', cover: '#4A4232', campfire: '#F0A93C',
  sand: '#3E3829', lava: '#5A2210', ice: '#243648', voidc: '#04040A', exit: '#39e0a0',
  cinder: '#241915', snow: '#B6C7DA', peat: '#1F1D14', slab: '#2A2C3A',
  player: '#4cd2ff', friendly: '#7adf8a', objective: '#d9a441', enemy: '#e0556a', siege: '#b07adf',
};

export const PALETTE: PaletteGroup[] = [
  {
    group: 'Floors',
    tiles: [
      { ch: '.', name: 'Floor', color: C.floor },
      { ch: ',', name: 'Floor variant', color: C.floorV1 },
      { ch: ':', name: 'Floor variant', color: C.floorV2 },
      { ch: ';', name: 'Floor variant', color: C.floorV3 },
      { ch: '_', name: 'Floor variant', color: C.floorV4 },
      { ch: '*', name: 'Campfire', color: C.campfire },
      { ch: 'E', name: 'Exit / extract', color: C.exit },
    ],
  },
  {
    group: 'Walls & solids',
    tiles: [
      { ch: '#', name: 'Wall (rock) — border', color: C.wall },
      { ch: 'T', name: 'Tree — border', color: C.tree },
      { ch: '%', name: 'Void abyss — border', color: C.voidc },
      { ch: 'o', name: 'Cover / sandbag', color: C.cover },
    ],
  },
  {
    group: 'Hazards & terrain',
    tiles: [
      { ch: '~', name: 'Water (swimmers cross)', color: C.water },
      { ch: '!', name: 'Lava (searing)', color: C.lava },
      { ch: '^', name: 'Ice (slippery)', color: C.ice },
      { ch: '=', name: 'Sand (slow)', color: C.sand },
    ],
  },
  {
    group: 'Biome floors',
    tiles: [
      { ch: '+', name: 'Cinder (Emberwaste)', color: C.cinder },
      { ch: '-', name: 'Packed snow (Glacis)', color: C.snow },
      { ch: '@', name: 'Peat (Mire)', color: C.peat },
      { ch: '/', name: 'Unstable slab (Voidscar)', color: C.slab },
    ],
  },
  {
    group: 'Player & friendly markers',
    tiles: [
      { ch: 'P', name: 'Player spawn', color: C.player },
      { ch: 'c', name: 'Captive (rescuable)', color: C.friendly },
      { ch: 'N', name: 'Dialogue NPC', color: C.friendly },
      { ch: 'B', name: 'Build site', color: C.friendly },
      { ch: 'C', name: 'Chest', color: C.friendly },
      { ch: 'V', name: 'Vehicle', color: C.friendly },
      { ch: 'W', name: 'Watchtower', color: C.friendly },
      { ch: 'S', name: 'Shop / stall', color: C.friendly },
      { ch: 'H', name: 'Hireable hand', color: C.friendly },
      { ch: 'Y', name: 'LYTH crystal node', color: C.friendly },
      { ch: 'A', name: 'Field-weapon pickup', color: C.friendly },
      { ch: 'I', name: 'Quest item', color: C.friendly },
    ],
  },
  {
    group: 'Objective markers',
    tiles: [
      { ch: 'K', name: 'Monolith core / beacon', color: C.objective },
      { ch: 'D', name: 'CTF flag stand', color: C.objective },
      { ch: 'Q', name: 'Relay switch', color: C.objective },
      { ch: 'J', name: 'Glyph stone', color: C.objective },
      { ch: 'X', name: 'BLS pillar', color: C.objective },
      { ch: 'Z', name: 'Lythseal forge pad', color: C.objective },
      { ch: 'O', name: 'Teleport pad', color: C.objective },
    ],
  },
  {
    group: 'Enemies',
    tiles: [
      { ch: 'g', name: 'Grunt', color: C.enemy },
      { ch: 'a', name: 'Archer', color: C.enemy },
      { ch: 'r', name: 'Charger', color: C.enemy },
      { ch: 's', name: 'Bulwark', color: C.enemy },
      { ch: 'm', name: 'Spawner', color: C.enemy },
      { ch: 'n', name: 'Sniper', color: C.enemy },
      { ch: 'w', name: 'Skitter', color: C.enemy },
      { ch: 'b', name: 'Boss', color: C.enemy },
      { ch: 'z', name: 'Husk', color: C.enemy },
      { ch: 'f', name: 'Alpha (Forkling)', color: C.enemy },
      { ch: 'q', name: 'Acolyte', color: C.enemy },
      { ch: 'v', name: 'Wraith (Volt)', color: C.enemy },
      { ch: 'x', name: 'Stalker', color: C.enemy },
      { ch: 'u', name: 'Beetle (Pyre)', color: C.enemy },
      { ch: 'd', name: 'Molten', color: C.enemy },
      { ch: 'e', name: 'Emberkite', color: C.enemy },
      { ch: 'h', name: 'Frostshade', color: C.enemy },
      { ch: 'i', name: 'Glacier', color: C.enemy },
      { ch: 'j', name: 'Bogspitter', color: C.enemy },
      { ch: 'k', name: 'Phaseborn', color: C.enemy },
      { ch: 'l', name: 'Sandlurker', color: C.enemy },
      { ch: 'y', name: 'Wraithv (Vault)', color: C.enemy },
      { ch: '$', name: 'Brinehulk', color: C.enemy },
    ],
  },
  {
    group: 'Siege emplacements',
    tiles: [
      { ch: 'p', name: 'Siege prism', color: C.siege },
      { ch: 't', name: 'Timed trap', color: C.siege },
    ],
  },
];

/** Flat char -> PaletteTile lookup (for swatch colour / label by char). */
export const TILE_BY_CHAR: Record<string, PaletteTile> = (() => {
  const m: Record<string, PaletteTile> = {};
  for (const grp of PALETTE) for (const t of grp.tiles) m[t.ch] = t;
  return m;
})();

/** The legal border chars (a solid border is required by the validator). */
export const BORDER_CHARS = ['#', 'T', '%'] as const;

/** The 16 selectable themes (six classic looks + the ten biomes). */
export const THEME_KEYS: Theme[] = [
  'lava', 'toxic', 'nuclear', 'storm', 'fire', 'ice',
  'emberwaste', 'glacis', 'mire', 'dunes', 'verdance',
  'voidscar', 'saltworks', 'nocturne', 'crucible', 'reliquary',
];

/** Builder mode choices (each maps onto a LevelDef.mode / flag combination). */
export type BuilderMode = 'bastion' | 'story' | 'siege' | 'ctf' | 'br' | 'family';
export const BUILDER_MODES: BuilderMode[] = ['bastion', 'story', 'siege', 'ctf', 'br', 'family'];

/** Objective choices the panel offers (each gates one win-mechanic block). */
export type BuilderObjective = 'none' | 'capture' | 'escort' | 'gate';
export const BUILDER_OBJECTIVES: BuilderObjective[] = ['none', 'capture', 'escort', 'gate'];

export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard', 'extreme'];
export const SIZE_LABELS = ['S', 'M', 'L', 'XL'] as const;

export const GRID_MIN = 8;
export const GRID_MAX = 64;

// ---------------------------------------------------------------------------
// 2. BUILDER STATE — the plain data the UI maintains and the pure fn consumes
// ---------------------------------------------------------------------------

/** The full editor state. The canvas/panel UI maintains exactly this object and
 *  hands it to builderStateToLevelDef() on every change. No DOM nodes here. */
export interface BuilderState {
  name: string;
  /** rows of equal-width tile strings (the painted ASCII grid). */
  grid: string[];
  mode: BuilderMode;
  theme: Theme | '';
  objective: BuilderObjective;
  difficulty: Difficulty;
  /** objective params (only the active objective's are read). */
  capture: { radius: number; duration: number };
  escort: { path: [number, number][] };
  gate: { need: number };
  /** bastion-config knobs (used when mode === 'bastion'). */
  bastion: {
    nights: number;
    wavesPerNight: number;
    bloodMoons: number[];
    roster: string[];
    edges: string[];
  };
  /** sizeLabel for the optional stronghold catalog block (bastion only). */
  sizeLabel: string;
}

/** A fresh, valid-by-construction starting state: a bordered hold with a spawn,
 *  one core and a small build/stall layout. The UI seeds new maps from this. */
export function emptyBuilderState(w = 16, h = 12): BuilderState {
  return {
    name: 'Untitled Map',
    grid: blankGrid(w, h),
    mode: 'bastion',
    theme: 'verdance',
    objective: 'none',
    difficulty: 'normal',
    capture: { radius: 3, duration: 30 },
    escort: { path: [] },
    gate: { need: 1 },
    bastion: {
      nights: 5,
      wavesPerNight: 1,
      bloodMoons: [],
      roster: ['g', 'r', 'w', 'z'],
      edges: ['n', 's', 'e', 'w'],
    },
    sizeLabel: 'S',
  };
}

/** A bordered grid filled with floor, a centred player spawn and one core —
 *  the smallest thing that validates as a core bastion. */
export function blankGrid(w: number, h: number): string[] {
  w = clampInt(w, GRID_MIN, GRID_MAX);
  h = clampInt(h, GRID_MIN, GRID_MAX);
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      row += border ? '#' : '.';
    }
    rows.push(row);
  }
  // seed a player spawn + a single core in the interior so a brand-new map is
  // immediately valid (a core bastion needs exactly one P and one K).
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  rows[cy] = setChar(rows[cy], cx, 'K');
  rows[Math.min(h - 2, cy + 2)] = setChar(rows[Math.min(h - 2, cy + 2)], cx, 'P');
  return rows;
}

/** Resize the grid, preserving the painted interior (top-left anchored) and
 *  re-stamping a solid '#' border. */
export function resizeGrid(grid: string[], w: number, h: number): string[] {
  w = clampInt(w, GRID_MIN, GRID_MAX);
  h = clampInt(h, GRID_MIN, GRID_MAX);
  const out: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (border) { row += '#'; continue; }
      const src = grid[y] && grid[y][x] !== undefined ? grid[y][x] : '.';
      // an interior cell that lands on the new border is forced solid above; an
      // old border char left dangling in the interior is harmless (solids are
      // legal anywhere), so the preserved char rides through unchanged.
      row += src;
    }
    out.push(row);
  }
  return out;
}

/** Stamp a solid '#' border around the current grid (the border helper). */
export function applyBorder(grid: string[], ch = '#'): string[] {
  const h = grid.length, w = grid[0]?.length ?? 0;
  return grid.map((row, y) => {
    let r = '';
    for (let x = 0; x < w; x++) {
      r += (x === 0 || y === 0 || x === w - 1 || y === h - 1) ? ch : row[x];
    }
    return r;
  });
}

/** Paint one cell (returns a NEW grid; never mutates). */
export function paintCell(grid: string[], x: number, y: number, ch: string): string[] {
  if (y < 0 || y >= grid.length || x < 0 || x >= (grid[0]?.length ?? 0)) return grid;
  const out = grid.slice();
  out[y] = setChar(out[y], x, ch);
  return out;
}

// ---------------------------------------------------------------------------
// 3. THE PURE ASSEMBLY FUNCTION
// ---------------------------------------------------------------------------

/** Count how many times a marker char appears in the grid (row-major). */
function tileCount(grid: string[], ch: string): number {
  return grid.reduce((n, r) => n + (r.split(ch).length - 1), 0);
}

/** Optional pure context for assembly: a real character id to bind to any
 *  captive ('c') tiles. Supplied by the UI (starting roster) and the node smoke
 *  (the loaded character set) so the assembled def is FULLY valid. Still pure —
 *  this is plain data, no DOM / fs. */
export interface AssembleCtx {
  /** A real character id for captive bindings (e.g. the first starting char). */
  captiveCharId?: string;
}

/**
 * builderStateToLevelDef — the SINGLE place a builder state becomes a LevelDef.
 *
 * Pure: no DOM, no fs, no globals. The output is schema-identical to the JSON an
 * author writes under levels/<cat>/, so it drops straight into parseLevel /
 * createGame and passes validateLevelDef (when the painted grid satisfies the
 * contract). Sidecar arrays are auto-sized to their marker-tile counts so the
 * def never trips the validator's sidecar-parity checks for a freshly painted
 * map; an author refines the per-entity details after export.
 */
export function builderStateToLevelDef(state: BuilderState, ctx: AssembleCtx = {}): LevelDef {
  const grid = state.grid.map((r) => r); // defensive copy of the rows
  const def: any = {
    name: state.name || 'Untitled Map',
    tiles: grid,
  };

  if (state.theme) def.theme = state.theme;

  // --- mode / category tagging ---
  switch (state.mode) {
    case 'bastion':
      def.mode = 'bastion';
      def.untimed = true;
      break;
    case 'siege':
      def.mode = 'siege';
      def.siege = {};
      break;
    case 'ctf':
      def.mode = 'ctf';
      break;
    case 'br':
      def.mode = 'br';
      break;
    case 'story':
      def.story = true;
      def.untimed = true;
      break;
    case 'family':
      def.family = true;
      def.untimed = true;
      break;
  }

  def.difficulty = state.difficulty;

  // --- bastion config (nights / waves / bloodMoons / roster + wave edges) ---
  if (state.mode === 'bastion') {
    const nights = clampInt(state.bastion.nights, 1, 25);
    const wpn = clampInt(state.bastion.wavesPerNight, 1, 3);
    const bloodMoons = (state.bastion.bloodMoons || [])
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= nights)
      .sort((a, b) => a - b);
    const roster = (state.bastion.roster || []).filter((c) => WAVE_LETTER_SET.has(c));
    const bastion: BastionDef = {
      nights,
      wavesPerNight: wpn,
      bloodMoons,
      ...(roster.length ? { roster } : {}),
    } as BastionDef;
    def.bastion = bastion;

    // timed reinforcement waves around the chosen edges (legal roster letters).
    const edges = (state.bastion.edges || []).filter((e) => 'nsew'.includes(e));
    if (roster.length && edges.length) {
      const waves: WaveDef[] = [];
      for (let i = 0; i < edges.length; i++) {
        waves.push({ at: 20 + i * 20, letters: roster.join('').slice(0, 4) || 'g', edge: edges[i] as any });
      }
      def.modifiers = { waves };
    }
  }

  // --- objective block (only the chosen one) ---
  if (state.objective === 'capture') {
    // centre the capture zone on the (first) core, else the grid centre.
    const k = findChar(grid, 'K');
    const cx = k ? k[0] : Math.floor((grid[0]?.length ?? 2) / 2);
    const cy = k ? k[1] : Math.floor(grid.length / 2);
    def.capture = {
      x: cx, y: cy,
      radius: clampInt(state.capture.radius, 1, 12),
      duration: clampInt(state.capture.duration, 5, 600),
    };
  } else if (state.objective === 'escort') {
    // an escort map is CORELESS — strip every 'K' so the validator's 0-core rule
    // holds, then thread a path through interior waypoints (spawn -> exit-ish).
    stripChar(grid, 'K');
    const path = (state.escort.path || []).filter(
      ([x, y]) => x > 0 && y > 0 && x < (grid[0]?.length ?? 0) - 1 && y < grid.length - 1,
    );
    def.escort = { path: path.length >= 2 ? path : autoEscortPath(grid) };
  } else if (state.objective === 'gate') {
    def.gate = { need: clampInt(state.gate.need, 1, Math.max(1, tileCount(grid, 'B'))) };
  }

  // --- sidecar arrays auto-sized to their marker-tile counts ---
  // Each defaults its per-entity payload; an author tunes the specifics later.
  attachSidecars(def, grid, ctx);

  return def as LevelDef;
}

/** Attach every tile-bound sidecar array, sized to its marker count, with
 *  contract-default payloads so a freshly painted map validates. */
function attachSidecars(def: any, grid: string[], ctx: AssembleCtx): void {
  const n = (ch: string): number => tileCount(grid, ch);

  // captives need a REAL character id (validateLevelDef checks each is real);
  // the caller supplies one via ctx.captiveCharId (UI: starting roster; smoke:
  // loaded character set). Fall back to a sentinel only if none was provided.
  const cCount = n('c');
  if (cCount > 0) def.captiveChars = new Array(cCount).fill(ctx.captiveCharId || '__CAPTIVE__');

  const nN = n('N');
  if (nN > 0) def.npcs = Array.from({ length: nN }, (_, i) => ({ id: 'npc' + i, name: 'Survivor ' + (i + 1) }));

  const nB = n('B');
  if (nB > 0) def.builds = Array.from({ length: nB }, () => ({ kind: 'pylon', cost: 0 }));

  const nC = n('C');
  if (nC > 0) def.chests = Array.from({ length: nC }, () => ({}));

  const nV = n('V');
  if (nV > 0) def.vehicles = Array.from({ length: nV }, () => ({}));

  const nH = n('H');
  if (nH > 0) def.hires = Array.from({ length: nH }, () => ({}));

  const nA = n('A');
  if (nA > 0) def.pickups = Array.from({ length: nA }, () => ({}));

  const nI = n('I');
  if (nI > 0) def.qitems = Array.from({ length: nI }, () => ({ kind: 'fragment' }));

  const nQ = n('Q');
  if (nQ > 0) def.switches = Array.from({ length: nQ }, (_, i) => ({ id: 'sw' + i, group: 0 }));

  const nJ = n('J');
  if (nJ > 0) def.glyphs = Array.from({ length: nJ }, (_, i) => ({ id: 'gl' + i, symbol: i % 8, group: 0 }));

  const nO = n('O');
  if (nO > 0) def.teleports = Array.from({ length: nO }, (_, i) => ({ id: 'tp' + i }));
}

/** A trivial escort path: spawn tile -> grid centre -> opposite interior corner. */
function autoEscortPath(grid: string[]): [number, number][] {
  const w = grid[0]?.length ?? 4, h = grid.length;
  const p = findChar(grid, 'P');
  const start: [number, number] = p ? p : [1, 1];
  const mid: [number, number] = [Math.floor(w / 2), Math.floor(h / 2)];
  return [start, mid];
}

// ---------------------------------------------------------------------------
// small grid helpers (string-row mutation, kept local + pure)
// ---------------------------------------------------------------------------

const WAVE_LETTER_SET = new Set('garsmnwbzfqvxu' + 'dehijkly$');

function setChar(row: string, x: number, ch: string): string {
  if (x < 0 || x >= row.length) return row;
  return row.slice(0, x) + ch + row.slice(x + 1);
}

function findChar(grid: string[], ch: string): [number, number] | null {
  for (let y = 0; y < grid.length; y++) {
    const x = grid[y].indexOf(ch);
    if (x >= 0) return [x, y];
  }
  return null;
}

/** Replace every occurrence of `ch` with floor, in place on the row array. */
function stripChar(grid: string[], ch: string): void {
  for (let y = 0; y < grid.length; y++) grid[y] = grid[y].split(ch).join('.');
}

function clampInt(v: number, lo: number, hi: number): number {
  v = Math.round(Number(v) || 0);
  return Math.max(lo, Math.min(hi, v));
}
