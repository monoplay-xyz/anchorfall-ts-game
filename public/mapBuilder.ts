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
  /**
   * IMPORTED-DEF PASSTHROUGH BASE (lossless round-trip). When a def is imported
   * (Load .json / Paste shareable string), the WHOLE original def is stashed here
   * so export can preserve every gameplay field the builder does NOT model
   * (stranded / captiveChars / builds / chests / vehicles / hires / intro / outro /
   * stronghold / quests / switchGroups / …). builderStateToLevelDef() deep-clones
   * this base and overlays only the edited grid + modeled panel fields on top.
   * A freshly-built (non-imported) map leaves this undefined and assembles from
   * scratch exactly as in Stage A.
   */
  _base?: any;
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

  // LOSSLESS ROUND-TRIP. If this state was IMPORTED, start from a deep clone of
  // the original def (the passthrough base) so EVERY gameplay field the builder
  // does not model survives untouched (stranded / stronghold / quests /
  // switchGroups / intro / outro / captiveChars / builds / chests / vehicles /
  // hires / npcs / …). We then overlay only the edited grid + the modeled panel
  // fields on top. A freshly-built map has no base and assembles from scratch.
  const imported = state._base != null;
  const def: any = imported ? deepClone(state._base) : {};

  def.name = state.name || def.name || 'Untitled Map';
  def.tiles = grid;

  if (state.theme) def.theme = state.theme;

  // --- mode / category tagging ---
  // For an IMPORTED base whose mode the author did NOT change, leave the base's
  // mode fields EXACTLY as they were — so a classic timed map (no `mode`, no
  // core) is never force-tagged 'bastion', and any unmodeled mode semantics
  // survive. We only re-tag when the map is fresh OR the author switched modes.
  const modeChanged = !imported || state.mode !== deriveBuilderMode(state._base);
  // does the base behave like a bastion already (so we must still write the
  // bastion config block below even when we did not re-tag the mode)?
  if (modeChanged) {
    // Clear the mode flags this enum could have set so a mode change off an
    // imported base does not leave a stale flag behind.
    delete def.story; delete def.family; delete def.untimed;
    switch (state.mode) {
      case 'bastion':
        def.mode = 'bastion';
        def.untimed = true;
        break;
      case 'siege':
        def.mode = 'siege';
        if (!def.siege || typeof def.siege !== 'object') def.siege = {};
        break;
      case 'ctf':
        def.mode = 'ctf';
        break;
      case 'br':
        def.mode = 'br';
        break;
      case 'story':
        delete def.mode;
        def.story = true;
        def.untimed = true;
        break;
      case 'family':
        delete def.mode;
        def.family = true;
        def.untimed = true;
        break;
    }
  }

  def.difficulty = state.difficulty;

  // --- bastion config (nights / waves / bloodMoons / roster + wave edges) ---
  // Only write the bastion config when this map is ACTUALLY a bastion: a fresh
  // bastion, an imported bastion, or a mode-switch INTO bastion. A classic map
  // imported (and shown as 'bastion' in the panel) but left unchanged must NOT
  // gain a bastion block — that block would make the validator demand a K core.
  const isBastion = state.mode === 'bastion' && (modeChanged || def.mode === 'bastion');
  if (isBastion) {
    const nights = clampInt(state.bastion.nights, 1, 25);
    const wpn = clampInt(state.bastion.wavesPerNight, 1, 3);
    const bloodMoons = (state.bastion.bloodMoons || [])
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= nights)
      .sort((a, b) => a - b);
    const roster = (state.bastion.roster || []).filter((c) => WAVE_LETTER_SET.has(c));
    const base = (imported && def.bastion && typeof def.bastion === 'object') ? def.bastion : null;
    // Start from any imported bastion block so unmodeled sub-fields (dayLen /
    // nightLen / waveMult / endless / survival / …) ride through unchanged, then
    // overlay the modeled knobs. For an IMPORTED base, a modeled field is written
    // only when the author ACTUALLY changed it from the imported value — so a
    // pure import->export keeps the base verbatim (a `nights: 99` endless map
    // survives the panel's 1-25 clamp; an absent wavesPerNight stays absent).
    const bastion: any = base ? { ...base } : {};
    // import re-derives each modeled knob by clamping the base value; we only
    // overwrite when the panel value DIFFERS from that imported-derived value.
    if (!base) { bastion.nights = nights; bastion.wavesPerNight = wpn; bastion.bloodMoons = bloodMoons; if (roster.length) bastion.roster = roster; }
    else {
      if (nights !== clampInt(base.nights ?? 5, 1, 25)) bastion.nights = nights;
      if (wpn !== clampInt(base.wavesPerNight ?? 1, 1, 3)) bastion.wavesPerNight = wpn;
      const impMoons = Array.isArray(base.bloodMoons) ? base.bloodMoons.filter((n: any) => Number.isInteger(n)) : [];
      if (!sameNums(bloodMoons, impMoons)) bastion.bloodMoons = bloodMoons;
      const impRoster = Array.isArray(base.roster) ? base.roster.map((c: any) => String(c)).filter((c: string) => c.length === 1) : [];
      if (roster.length && roster.join('') !== impRoster.join('')) bastion.roster = roster;
    }
    def.bastion = bastion as BastionDef;

    // timed reinforcement waves around the chosen edges (legal roster letters).
    // For an imported base we only RE-DERIVE waves when the author edited the
    // edge set (otherwise the base's authored modifiers.waves ride through).
    const edges = (state.bastion.edges || []).filter((e) => 'nsew'.includes(e));
    const baseEdges = baseDerivedEdges(imported ? state._base : null);
    const edgesEdited = !imported || edges.join(',') !== baseEdges.join(',');
    if (roster.length && edges.length && edgesEdited) {
      const waves: WaveDef[] = [];
      for (let i = 0; i < edges.length; i++) {
        waves.push({ at: 20 + i * 20, letters: roster.join('').slice(0, 4) || 'g', edge: edges[i] as any });
      }
      def.modifiers = { ...(imported && def.modifiers && typeof def.modifiers === 'object' ? def.modifiers : {}), waves };
    }
  }

  // --- objective block (only the chosen one) ---
  // For an imported base each objective block MERGES over the base so unmodeled
  // sub-fields survive (capture: threshold/decay/contest; escort: speed/hp/
  // holdRadius + the authored path; gate: after). The modeled scalars are only
  // overwritten when the author changed them from the imported value.
  const objBase = imported ? state._base : null;
  if (state.objective === 'capture') {
    const k = findChar(grid, 'K');
    const cx = k ? k[0] : Math.floor((grid[0]?.length ?? 2) / 2);
    const cy = k ? k[1] : Math.floor(grid.length / 2);
    const cb = (objBase && objBase.capture && typeof objBase.capture === 'object') ? objBase.capture : null;
    const cap: any = cb ? { ...cb } : { x: cx, y: cy };
    const impR = clampInt(cb?.radius ?? 3, 1, 12), impD = clampInt(cb?.duration ?? 30, 5, 600);
    const r = clampInt(state.capture.radius, 1, 12), d = clampInt(state.capture.duration, 5, 600);
    if (!cb) { cap.radius = r; cap.duration = d; }
    else { if (r !== impR) cap.radius = r; if (d !== impD) cap.duration = d; }
    def.capture = cap;
  } else if (state.objective === 'escort') {
    // an escort map is CORELESS — strip every 'K' so the validator's 0-core rule
    // holds, then thread a path through interior waypoints (spawn -> exit-ish).
    stripChar(grid, 'K'); // mutates grid rows in place; def.tiles already === grid
    const eb = (objBase && objBase.escort && typeof objBase.escort === 'object') ? objBase.escort : null;
    const userPath = (state.escort.path || []).filter(
      ([x, y]) => x > 0 && y > 0 && x < (grid[0]?.length ?? 0) - 1 && y < grid.length - 1,
    );
    const impPath = importEscortPath(eb);
    const esc: any = eb ? { ...eb } : {};
    // keep the authored path unless the author supplied a new (different) one
    if (userPath.length >= 2 && !samePath(userPath, impPath)) esc.path = userPath;
    else if (!eb) esc.path = userPath.length >= 2 ? userPath : autoEscortPath(grid);
    def.escort = esc;
  } else if (state.objective === 'gate') {
    const gb = (objBase && objBase.gate && typeof objBase.gate === 'object') ? objBase.gate : null;
    const need = clampInt(state.gate.need, 1, Math.max(1, tileCount(grid, 'B')));
    const impNeed = clampInt(gb?.need ?? 1, 1, 99);
    const gate: any = gb ? { ...gb } : {};
    if (!gb || clampInt(state.gate.need, 1, 99) !== impNeed) gate.need = need;
    def.gate = gate;
  }

  // --- sidecar arrays ---
  // FRESH map: synthesize every tile-bound sidecar sized to its marker count so
  // the new def validates (the author refines the per-entity details later).
  // IMPORTED map: the base ALREADY carries the real sidecars (correctly sized to
  // the unchanged grid), so we do NOT regenerate them — regenerating would clob-
  // ber authored builds/chests/npcs/… with empty placeholders and DROP gameplay.
  // We only fill in a sidecar the base happens to be MISSING for a marker the
  // author painted in (keeps parity without overwriting authored data).
  if (!imported) attachSidecars(def, grid, ctx);
  else fillMissingSidecars(def, grid, ctx);

  return def as LevelDef;
}

/** Structured deep clone (kept local + dependency-free; JSON round-trip is enough
 *  for a LevelDef, which is plain JSON data). */
function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

/** For an imported base: only ADD a tile-bound sidecar the base is MISSING for a
 *  marker the author painted, so the def keeps sidecar parity WITHOUT overwriting
 *  any authored entry. Existing arrays (real builds/chests/npcs/…) are untouched. */
function fillMissingSidecars(def: any, grid: string[], ctx: AssembleCtx): void {
  const n = (ch: string): number => tileCount(grid, ch);
  const need = (key: string, ch: string, make: (count: number) => any[]): void => {
    const have = Array.isArray(def[key]) ? def[key].length : (def[key] === undefined ? -1 : 0);
    const count = n(ch);
    if (have === count) return;            // already in parity — leave authored data alone
    if (count === 0) { if (Array.isArray(def[key])) def[key] = []; return; }
    if (have < 0) { def[key] = make(count); return; } // base never had it: synth full
    // base had a partial/stale array after a grid edit: pad or trim to parity,
    // preserving as many authored leading entries as possible.
    const cur = def[key].slice(0, count);
    while (cur.length < count) cur.push(make(1)[0]);
    def[key] = cur;
  };
  need('captiveChars', 'c', (c) => new Array(c).fill(ctx.captiveCharId || '__CAPTIVE__'));
  need('npcs', 'N', (c) => Array.from({ length: c }, (_, i) => ({ id: 'npc' + i, name: 'Survivor ' + (i + 1) })));
  need('builds', 'B', (c) => Array.from({ length: c }, () => ({ kind: 'pylon', cost: 0 })));
  need('chests', 'C', (c) => Array.from({ length: c }, () => ({})));
  need('vehicles', 'V', (c) => Array.from({ length: c }, () => ({})));
  need('hires', 'H', (c) => Array.from({ length: c }, () => ({})));
  need('pickups', 'A', (c) => Array.from({ length: c }, () => ({})));
  need('qitems', 'I', (c) => Array.from({ length: c }, () => ({ kind: 'fragment' })));
  need('switches', 'Q', (c) => Array.from({ length: c }, (_, i) => ({ id: 'sw' + i, group: 0 })));
  need('glyphs', 'J', (c) => Array.from({ length: c }, (_, i) => ({ id: 'gl' + i, symbol: i % 8, group: 0 })));
  need('teleports', 'O', (c) => Array.from({ length: c }, (_, i) => ({ id: 'tp' + i })));
}

// ---------------------------------------------------------------------------
// 4. IMPORT — load a LevelDef back INTO a builder state (the inverse direction)
// ---------------------------------------------------------------------------

/** Map a LevelDef to the builder MODE its panel would select. A def with no
 *  recognized mode/flag (a classic timed map) edits as 'bastion' for the panel,
 *  but the assembler PRESERVES the base's mode fields when that choice is
 *  unchanged — so a classic map never gets force-tagged bastion on export. */
export function deriveBuilderMode(def: any): BuilderMode {
  if (def?.mode === 'bastion' || def?.mode === 'siege' || def?.mode === 'ctf' || def?.mode === 'br') return def.mode;
  if (def?.story) return 'story';
  if (def?.family) return 'family';
  return 'bastion';
}

/**
 * importToBuilderState — turn an authored LevelDef back into an editable
 * BuilderState. It (a) DERIVES the modeled panel fields the builder owns
 * (name / grid / mode / theme / objective / difficulty / bastion knobs) from the
 * def so the right panel reflects the loaded map, and (b) stashes the WHOLE def
 * as `state._base` so builderStateToLevelDef() can replay every unmodeled
 * gameplay field on export — the lossless round-trip contract.
 *
 * Pure: no DOM, no fs. Throws TypeError if `def` is not a tile-grid LevelDef.
 */
export function importToBuilderState(def: any): BuilderState {
  if (!def || typeof def !== 'object' || !Array.isArray(def.tiles)
      || def.tiles.length === 0 || typeof def.tiles[0] !== 'string') {
    throw new TypeError('not a LevelDef: missing a tiles string[] grid');
  }
  const grid = def.tiles.map((r: any) => String(r));

  // --- mode: prefer def.mode; story/family are flags, not a mode value ---
  const mode = deriveBuilderMode(def);

  // --- theme: only keep a value the panel can re-select ---
  const theme: Theme | '' = (typeof def.theme === 'string' && THEME_KEYS.includes(def.theme as Theme))
    ? (def.theme as Theme) : '';

  // --- objective: read back the one objective block the def carries ---
  let objective: BuilderObjective = 'none';
  if (def.capture) objective = 'capture';
  else if (def.escort) objective = 'escort';
  else if (def.gate) objective = 'gate';

  // --- difficulty: keep a known label, else fall back to normal ---
  const difficulty: Difficulty =
    DIFFICULTIES.includes(def.difficulty as Difficulty) ? (def.difficulty as Difficulty) : 'normal';

  // --- objective params (best-effort read; the base preserves the rest) ---
  const capture = {
    radius: clampInt(def.capture?.radius ?? 3, 1, 12),
    duration: clampInt(def.capture?.duration ?? 30, 5, 600),
  };
  const escortPath: [number, number][] = Array.isArray(def.escort?.path)
    ? def.escort.path.map(normTileCoord).filter((p: any): p is [number, number] => !!p)
    : [];
  const gate = { need: clampInt(def.gate?.need ?? 1, 1, 99) };

  // --- bastion knobs (only meaningful when mode === 'bastion') ---
  const b = (def.bastion && typeof def.bastion === 'object') ? def.bastion : {};
  const waves = (def.modifiers && Array.isArray(def.modifiers.waves)) ? def.modifiers.waves : [];
  const edges = Array.from(new Set(
    waves.map((w: any) => String(w?.edge || '')).filter((e: string) => 'nsew'.includes(e) && e.length === 1),
  )) as string[];
  const bastion = {
    nights: clampInt(b.nights ?? 5, 1, 25),
    wavesPerNight: clampInt(b.wavesPerNight ?? 1, 1, 3),
    bloodMoons: Array.isArray(b.bloodMoons) ? b.bloodMoons.filter((n: any) => Number.isInteger(n)) : [],
    roster: Array.isArray(b.roster) ? b.roster.map((c: any) => String(c)).filter((c: string) => c.length === 1) : [],
    edges,
  };

  const sizeLabel = String(def.stronghold?.sizeLabel ?? 'S');

  return {
    name: String(def.name || 'Imported Map'),
    grid,
    mode,
    theme,
    objective,
    difficulty,
    capture,
    escort: { path: escortPath },
    gate,
    bastion,
    sizeLabel,
    _base: deepClone(def), // the passthrough base — lossless round-trip on export
  };
}

/** Normalize a `[x,y]` pair OR `{x,y}` object waypoint to a tuple (or null). */
function normTileCoord(p: any): [number, number] | null {
  if (Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) return [p[0], p[1]];
  if (p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y)) return [p.x, p.y];
  return null;
}

/** The wave EDGES importToBuilderState would derive from a base def's
 *  modifiers.waves (dedup'd, single n/s/e/w letters). Used to tell whether the
 *  author edited the edge set, so an unchanged import keeps the authored waves. */
function baseDerivedEdges(base: any): string[] {
  const waves = (base && base.modifiers && Array.isArray(base.modifiers.waves)) ? base.modifiers.waves : [];
  return Array.from(new Set(
    waves.map((w: any) => String(w?.edge || '')).filter((e: string) => 'nsew'.includes(e) && e.length === 1),
  )) as string[];
}

/** The escort PATH importToBuilderState would derive from a base escort block
 *  (normalized to tuples), so export can tell an unchanged path from an edit. */
function importEscortPath(escortBlock: any): [number, number][] {
  return Array.isArray(escortBlock?.path)
    ? escortBlock.path.map(normTileCoord).filter((p: any): p is [number, number] => !!p)
    : [];
}

/** Two waypoint lists equal (same length + same coords in order). */
function samePath(a: [number, number][], b: [number, number][]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
  return true;
}

/** Two integer lists equal (order-insensitive — bloodMoons are a set). */
function sameNums(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y), sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

// ---------------------------------------------------------------------------
// 5. SHAREABLE STRING — a single pasteable blob carrying the whole LevelDef.
//
// Format: a short tag + base64-of-UTF8(JSON), so the blob survives copy/paste
// (no raw braces/quotes to mangle) and Import can recognise + decode it. Import
// ALSO accepts raw JSON (a pasted .json), so authors can paste either form.
// ---------------------------------------------------------------------------

const SHARE_PREFIX = 'MONOMAP1:';

/** Encode a LevelDef to a single shareable string (tag + base64 of its JSON). */
export function levelDefToShareString(def: LevelDef): string {
  const json = JSON.stringify(def);
  return SHARE_PREFIX + b64encodeUtf8(json);
}

/** Decode a pasted blob to a LevelDef. Accepts the tagged base64 share string
 *  OR bare base64 OR raw JSON. Throws on anything that is not a tile-grid def. */
export function parseShareString(input: string): LevelDef {
  let s = String(input || '').trim();
  if (!s) throw new TypeError('empty input');
  let json: string;
  if (s.startsWith(SHARE_PREFIX)) {
    json = b64decodeUtf8(s.slice(SHARE_PREFIX.length).trim());
  } else if (s[0] === '{' || s[0] === '[') {
    json = s; // raw JSON pasted directly
  } else {
    // bare base64 (no tag) — try to decode; fall through to a JSON parse error
    try { json = b64decodeUtf8(s); } catch { json = s; }
  }
  let def: any;
  try { def = JSON.parse(json); } catch (e: any) {
    throw new TypeError('could not parse: ' + (e?.message || 'invalid JSON / share string'));
  }
  if (!def || typeof def !== 'object' || !Array.isArray(def.tiles)) {
    throw new TypeError('parsed value is not a LevelDef (no tiles grid)');
  }
  return def as LevelDef;
}

/** UTF-8-safe base64 encode (browser btoa is latin1-only; Node has Buffer). */
function b64encodeUtf8(s: string): string {
  const g: any = (typeof globalThis !== 'undefined') ? globalThis : {};
  if (g.Buffer) return g.Buffer.from(s, 'utf8').toString('base64');
  // browser: percent-encode to latin1 first so btoa accepts non-ASCII
  const bytes = encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  return g.btoa(bytes);
}

/** UTF-8-safe base64 decode (inverse of b64encodeUtf8). */
function b64decodeUtf8(s: string): string {
  const g: any = (typeof globalThis !== 'undefined') ? globalThis : {};
  if (g.Buffer) return g.Buffer.from(s, 'base64').toString('utf8');
  const bin = g.atob(s);
  let pct = '';
  for (let i = 0; i < bin.length; i++) pct += '%' + ('00' + bin.charCodeAt(i).toString(16)).slice(-2);
  return decodeURIComponent(pct);
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
