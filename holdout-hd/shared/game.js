// Core simulation shared by the Node server (online co-op) and the browser (solo).
// All distances are in pixels; speeds in characters.json are tiles/second.

// RELIC AWAKENING horde: the event runs for EXACTLY the level track's length
// (the song plays once, no loop). These exact per-track seconds are the
// deterministic input that keeps the server and every client in lockstep.
import { MUSIC_DURATIONS, RELIC_WAVE_FALLBACK } from './music-durations.js';

export const TILE = 48;
// Per-mode seat caps for one match (wave 7: replaces the old flat 8). The sim
// enforces the ctf cap — and its half-size team cap — in addPlayerMidGame;
// the server reads the rest for lobby gating. Versus scales up to massed
// fields; co-op stays a tight squad of 8.
export const MODE_CAPS = { classic: 8, story: 8, bastion: 8, ctf: 32, br: 16 };
const PLAYER_R = 14;
const ENEMY_R = 14;
const SHOT_R = 5;
const CAPTIVE_R = 12;
const RESPAWN_DELAY = 2;

const ENEMY_STATS = {
  g: { kind: 'grunt', hp: 2, speed: 1.25, score: 100, aggro: 9 },
  a: { kind: 'archer', hp: 1, speed: 0, range: 7, cool: 1, score: 125, aggro: 9.5 },
  r: { kind: 'charger', hp: 3, speed: 1.0, range: 4.2, cool: 1.2, score: 175, aggro: 9 },
  s: { kind: 'bulwark', hp: 5, speed: 0.7, score: 225, aggro: 8.5 },
  m: { kind: 'spawner', hp: 5, speed: 0, range: 6, cool: 1.5, spawnCool: 2.4, score: 250, aggro: 9 },
  n: { kind: 'sniper', hp: 2, speed: 0, range: 10.5, cool: 1.4, score: 200, aggro: 12.5 },
  w: { kind: 'skitter', hp: 1, speed: 2.0, score: 50, aggro: 10.5 },
  b: { kind: 'boss', hp: 24, speed: 0.55, range: 8.5, cool: 1.1, spawnCool: 3.2, score: 1200, aggro: 12 },
  // --- frontier III roster (deep-world contract) ---
  // z Husk: Null Priest cultist husks — cheap horde fodder that swarms.
  z: { kind: 'husk', hp: 1, speed: 1.0, score: 40, aggro: 9 },
  // f Fork Alpha: the Forkling, the divided one — on death the seam parts and
  // it ALWAYS splits into two skitters (distinct from the 'split' mutation).
  f: { kind: 'alpha', hp: 3, speed: 1.7, score: 150, aggro: 9.5 },
  // q Null Acolyte: Classical Phantom support caster — shields and mends the
  // pack, never raises a hand against players. Priority-kill design.
  q: { kind: 'acolyte', hp: 2, speed: 0.9, range: 5, cool: 2.5, score: 220, aggro: 9 },
  // v Volt Wraith: LYTH Leech-kin elite — chain-zap shots that sting and
  // briefly stun one operative (shield pips absorb the whole zap).
  v: { kind: 'wraith', hp: 3, speed: 1.1, range: 6, cool: 2.2, score: 230, aggro: 10 },
  // x Phase Stalker: Rift Brute lineage — blinks 3 tiles toward its prey on a
  // deterministic per-id cadence, then mauls in melee.
  x: { kind: 'stalker', hp: 3, speed: 1.3, score: 260, aggro: 10 },
  // u Pyre Beetle: the Swarm Carrier urnback — the urn cracks on death into a
  // burning ground patch plus a 1-damage blast.
  u: { kind: 'beetle', hp: 2, speed: 1.4, score: 130, aggro: 9 },
  // --- NIGHTMARE roster: the RELIC AWAKENING horde event ONLY ----------------
  // These use FRESH letters (capitals + '&') that NO level tilemap ever uses
  // (parseLevel's tiles are all lowercase/special), so they can never appear in
  // normal play — only stepHorde spawns them, gated entirely on g.musicBox.
  // U Dread Spider: fast skittering swarmer, glass-thin (melee).
  U: { kind: 'spider', hp: 1, speed: 2.3, score: 60, aggro: 11 },
  // F Pale Ghost: drifts THROUGH walls (stepEnemy moves it ignoring collision),
  // medium hp, translucent (melee).
  F: { kind: 'ghost', hp: 3, speed: 1.15, score: 200, aggro: 10 },
  // M Reaper: slow, high hp, heavy 2-dmg melee, a dread aura (handled in render).
  M: { kind: 'reaper', hp: 8, speed: 0.6, score: 320, aggro: 9, meleeDmg: 2 },
  // R Rattle Skeleton: jittery ranged bone-thrower (holds and lobs).
  R: { kind: 'skeleton', hp: 2, speed: 0.85, range: 8, cool: 1.6, score: 180, aggro: 10 },
  // G Ghoul (zombie): slow shambling melee filler, cheap horde mass.
  G: { kind: 'zombie', hp: 2, speed: 0.7, score: 70, aggro: 9 },
  // L Hellhound: very fast lunger that closes and mauls (melee).
  L: { kind: 'hellhound', hp: 2, speed: 2.6, score: 150, aggro: 11.5 },
  // & Banshee Wraith: a ranged drifter that wails bolts from afar.
  '&': { kind: 'banshee', hp: 2, speed: 1.0, range: 7, cool: 2.0, score: 220, aggro: 10 },
};

// Nightmare kinds the RELIC AWAKENING horde draws from. Names are distinct from
// every existing kind so MELEE_KINDS/STATIONARY_KINDS/SHARD_DROPS wiring below
// is purely additive and normal play is byte-identical.
const NIGHTMARE_KINDS = ['spider', 'ghost', 'reaper', 'skeleton', 'zombie', 'hellhound', 'banshee'];
const NIGHTMARE_LETTERS = ['U', 'F', 'M', 'R', 'G', 'L', '&'];

// --- RELIC AWAKENING horde tuning (all deterministic) ----------------------
// Bursts fire on a cadence that tightens toward the climax, and each burst
// drops more enemies per edge as the song crests. The global 90-enemy cap
// still rules, so a packed field self-throttles.
const HORDE_BURST_MIN = 2.2;   // seconds between bursts at the very start
const HORDE_BURST_MAX = 5.0;   // seconds between bursts (slow opening)
const HORDE_PER_EDGE_MIN = 1;  // enemies per edge at the opening
const HORDE_PER_EDGE_MAX = 4;  // enemies per edge at the climax
// DIFFICULTY: a single global multiplier on enemy spawn COUNTS for both normal
// waves and the relic-awakening horde. 'extreme' is the historical no-op (1.0),
// so every existing count-pinned path stays byte-identical; 'normal' (the
// default) halves the pressure, 'easy' relaxes it further. This is a legit
// setting (NOT a cheat): it never sets g.devMode and scores still count.
const DIFFICULTY_SCALE = { easy: 0.35, normal: 0.5, extreme: 1 };
function difficultyScale(d) {
  return DIFFICULTY_SCALE[d] !== undefined ? DIFFICULTY_SCALE[d] : 1;
}
// Scale an integer spawn count by g.enemyScale, deterministically and never
// dropping a required spawn to zero: round to nearest, but keep at least 1
// whenever the un-scaled count asked for at least 1.
function scaleCount(g, n) {
  if (n <= 0) return n;
  const s = (g && g.enemyScale !== undefined) ? g.enemyScale : 1;
  if (s >= 1) return n;
  return Math.max(1, Math.round(n * s));
}
// Scoring: a big survival bonus that bleeds away with every hit and death.
const HORDE_BASE_BONUS = 5000;
const HORDE_FLOOR_BONUS = 500;
const HORDE_HIT_PENALTY = 60;
const HORDE_DEATH_PENALTY = 400;
function hordeDur(g) {
  return MUSIC_DURATIONS[`${g.musicBox.mode}-${g.musicBox.stem}`] || RELIC_WAVE_FALLBACK;
}

// --- RELIC SUPERWEAPON (RA2-style nuke / weather machine) ------------------
// One-shot, single-use structure superweapon, UNLOCKED by surviving the relic
// awakening horde (g.superweaponUnlocked). The whole system is a no-op unless
// that flag is set AND a player actively builds one, so every untouched mode /
// snapshot stays byte-identical. All values are HOLDOUT-scaled (TILE px, 1-24
// enemy hp) from the RA2 spec; everything below is fully deterministic — the
// only "randomness" is the seeded LCG used for the weather storm's bolt
// scatter (seeded off the device id + a monotonic strike counter).
const SUPER_KINDS = new Set(['nuke', 'weather']);
const SUPER_BUILD_TIME = 6;      // s of standing-still channel to assemble
const SUPER_CHARGE_SECONDS = 60; // ~1 minute charge before it goes live
const SUPER_DEVICE_HP = 8;       // enemies can attack + destroy it mid-charge
const SUPER_SITE_WALL_MIN = 1;   // tiles clear of wall '#' / cover 'o'
const SUPER_SITE_EXIT_MIN = 4;   // tiles clear of an extract / spawn
// NUKE: a single deterministic flatten + a lingering radiation crater.
const NUKE_FLIGHT_DELAY = 1.0;   // s telegraph between launch and impact
const NUKE_RADIUS = 4.5;         // tiles: outer blast (full damage inside 3)
const NUKE_FULL_RADIUS = 3.0;    // tiles: full-damage core
const NUKE_DAMAGE = 50;          // one-shots every enemy incl. the hp24 boss
const NUKE_FALLOFF_DAMAGE = 25;  // edge damage (still lethal to all)
const RAD_RADIUS = 3.0;          // tiles: radiation pool radius
const RAD_TTL = 8;               // s the pool lingers before it fades
const RAD_ENEMY_TICK = 0.5;      // s between 1-dmg chip ticks on enemies
// WEATHER: a lightning storm — spread, probabilistic anti-base area denial.
const STORM_WARNING_DELAY = 2.0; // s LightningDeferment before the first bolt
const STORM_DURATION = 6;        // s the storm strikes
const STORM_RADIUS = 5.0;        // tiles: storm footprint
const STORM_STRIKE_INTERVAL = 0.4; // s between bolts (~15 over the storm)
const STORM_BOLT_DAMAGE = 8;     // per bolt (3 bolts down the hp24 boss)
const STORM_BOLT_RADIUS = 1.5;   // tiles: per-bolt area-ish splash

// Maps at or below this tile count play arcade-style: every enemy is awake
// from the start, exactly like the original single-screen levels.
const ARCADE_MAP_TILES = 600;
// A waking enemy alerts sleeping allies within this radius.
const ALERT_RIPPLE = 3.5;

// Enemies hold position for this long at level start so players get their bearings.
const START_GRACE = 2.5;

const ENEMY_LETTERS = new Set(Object.keys(ENEMY_STATS));

// Shards dropped on death, by kind. Deterministic, always.
const SHARD_DROPS = {
  grunt: 1, archer: 1, skitter: 1, charger: 2, sniper: 2, bulwark: 2, spawner: 3, boss: 12,
  husk: 1, alpha: 2, acolyte: 2, wraith: 2, stalker: 3, beetle: 1,
  // nightmare horde drops (relic event only)
  spider: 1, ghost: 2, reaper: 4, skeleton: 1, zombie: 1, hellhound: 1, banshee: 2,
};
const DROP_TTL = 25;
const MAGNET_RANGE = 2.5; // tiles
const MAGNET_SPEED = 6; // tiles/sec
// --- POWER-UP DROPS (Black Ops Zombies-style) -------------------------------
// A kill VERY RARELY drops a floating power-up at the corpse; any friendly seat
// that walks over it fires a TEAM-WIDE effect. Everything here is deterministic
// (an FNV/LCG mix of the dying enemy's id + a per-game kill counter + elapsed,
// the same pattern shard/stronghold/stranded placement uses) so server and
// client agree on every roll. Untouched modes never roll a drop they keep (the
// chance is tiny and the fields are gated everywhere), so snapshots stay byte-
// identical until a power-up actually exists.
const POWERUP_TTL = 12;             // seconds a floating power-up lingers
const POWERUP_PICKUP_R = 0.9;       // tiles: walk within this to grab it
const POWERUP_DROP_CHANCE = 0.015;  // ~1.5% base chance per kill
const POWERUP_HORDE_MULT = 3;       // boosted x3 while the relic awakening plays
const POWERUP_FIRESALE_T = 10;      // seconds builds/placeables cost nothing
const POWERUP_FREESPRINT_T = 30;    // seconds sprint never drains stamina
const POWERUP_NUKE_KILLS = 10;      // enemies a nuke deletes (fewer if <10 live)
// Weighted rarity — Full Health most common, Nuke rarest ("one more than the
// other"). Order fixed so the deterministic weighted pick is stable everywhere.
const POWERUP_WEIGHTS = [
  ['fullhealth', 40],
  ['stamina', 25],
  ['firesale', 18],
  ['maxammo', 12],
  ['nuke', 5],
];
const POWERUP_WEIGHT_TOTAL = POWERUP_WEIGHTS.reduce((s, w) => s + w[1], 0);
const BUILD_RADIUS = 18; // px, built structures block movement in this circle
const BUILD_REACH = 1.5; // tiles, act range for building and talking
// --- inventory + placement mode (RA2-style buy-then-place) ------------------
// A bought placeable lands in the per-player inventory; choosing Place freezes
// the operative and drives a tile-snapped ghost cursor with arrows/stick/mouse,
// then confirm drops the structure (consuming one) or cancel exits free. The
// cursor (placementCursor) is generic so the superweapon phase reuses it for
// map targeting. PLACEABLES: inventory kind -> the g.builds structure it lays.
const PLACEABLES = {
  turret: { build: 'turret', cost: 8 },
  wall: { build: 'wall', cost: 1, drag: true }, // drag-to-line, 1 shard per segment
  barricade: { build: 'barricade', cost: 4 },
};
const PLACE_REACH = 6; // tiles: how far from the operative a ghost may roam
const WALL_LINE_MAX = 12; // tiles: longest single drag-laid wall line
const CRYSTAL_R = 16;
const MELEE_KINDS = new Set(['grunt', 'skitter', 'charger', 'bulwark', 'boss', 'husk', 'alpha', 'stalker', 'beetle',
  // nightmare melee kinds (relic event); ghost/hellhound/spider/reaper/zombie all close and maul
  'spider', 'ghost', 'reaper', 'zombie', 'hellhound']);
// skeleton (bone-thrower) and banshee (wailing bolts) hold and fire like archers
const STATIONARY_KINDS = new Set(['archer', 'sniper', 'spawner', 'skeleton', 'banshee']);
const LEASH_MULT = 1.8;
const TURRET_WEAPON = { kind: 'turret', damage: 1, projSpeed: 10, range: 6, count: 1 };

// --- survival-core tuning (non-arcade content only; classics never touch it) ---
const PLAYER_MAX_HP = 3;
const SHIELD_MAX = 2;
const HIT_INVULN = 1; // seconds of grace after a survivable hit
// --- Family Mode (gentle, child-friendly co-op) -----------------------------
const FAMILY_PLAYER_HP = 5;     // tankier than the usual 3 hearts
const FAMILY_HIT_INVULN = 1.6;  // long mercy window between hits
const FAMILY_RESPAWN = 4;       // seconds to pop back after going down
const FAMILY_ENEMY_SPEED = 0.7; // monsters amble instead of charging
const FAMILY_BASE_LIVES = 6;    // + 3 per player; runs out only into endless respawns
const CORE_R = 18; // px, base-core contact radius (gnawed like a structure)
const CRACKER_RANGE = 4; // tiles, lob distance in the facing direction
const CRACKER_FLIGHT = 0.5; // seconds airborne (overWalls arc)
const CRACKER_FUSE = 3.0; // seconds of lure after landing
const CRACKER_LURE = 9; // tiles, enemies inside re-target the cracker
const CRACKER_AOE = 1.6; // tiles
const CRACKER_DMG = 3;
const CHEST_LOOTS = ['shards', 'cracker', 'medkit', 'shield', 'token', 'toxin', 'controller'];
const HIRE_JOBS = ['farmer', 'engineer', 'smith'];
const MUTATIONS = ['feral', 'bulk', 'volatile', 'split'];
const WAVE_EDGES = ['n', 'e', 's', 'w'];
const FARM_GROW_T = 25; // seconds per stage (15 with a hired farmer)
const FARM_GROW_FAST = 15;
const BASTION_DEFAULTS = { nights: 5, dayLen: 120, nightLen: 60, bloodMoons: [3, 5] };
const BLOOD_WARN_LEAD = 30; // seconds before a blood-moon dusk

// --- Daily Challenge -------------------------------------------------------
// A deterministic daily siege: the same UTC date yields the same stronghold map
// + modifier twist for everyone, played as an endless holdout ranked on a shared
// daily board. A pure function of (dateStr, mapCount) so the client and server
// derive byte-identical specs — no trust needed on which map/twist is "today".
const DAILY_TWISTS = [
  { id: 'standard',  label: 'Standard Siege', mods: {} },
  { id: 'iron',      label: 'Iron Night',     mods: { waveMult: 1.4 } },          // thicker waves
  { id: 'bloodtide', label: 'Blood Tide',     mods: { bloodEvery: 2 } },          // blood moon every other night
  { id: 'swiftdusk', label: 'Swift Dusk',     mods: { dayLen: 55 } },             // less time to prep
  { id: 'bossrush',  label: 'Boss Rush',      mods: { bossEvery: 3 } },           // a boss every 3rd night
  { id: 'onslaught', label: 'Onslaught',      mods: { wavesPerNight: 2, waveMult: 1.2 } }, // two waves a night
];
function dailyHash(s) {
  let h = 2166136261; // FNV-1a (deterministic, no Math.random/Date)
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0);
}
export function dailyChallenge(dateStr, mapCount) {
  const h = dailyHash(String(dateStr));
  const mapIdx = mapCount > 0 ? h % mapCount : 0;
  const tw = DAILY_TWISTS[(h >>> 8) % DAILY_TWISTS.length]; // independent bits → map and twist vary apart
  return { dateStr: String(dateStr), mapIdx, twist: tw.id, label: tw.label, mods: { ...tw.mods } };
}
const WAVE_ENGAGE = 6; // tiles: a core-marcher engages a player it SEES this close
const WAVE_DISENGAGE = 9; // tiles: it resumes the march once they slip this far

// --- structure levels, towers, shops, hires, vehicles, pvp tuning ---
// 'wall' is the frontier IV fortified segment (cost 1 per segment): a real
// damageable structure, so stronghold bases ship as PREBUILT wall perimeters
// instead of indestructible '#' rock.
const STRUCT_HP = { barricade: [14, 22, 32], turret: [10, 14, 18], tower: [20, 28, 38], wall: [20, 35, 60] };
const TURRET_DMG = [1, 2, 3];
const TURRET_RANGE = [5.5, 6, 6.5]; // tiles, targeting radius by level
const TURRET_PERIOD = 0.55; // seconds between gun shots (reliable single-target dps)
const REPAIR_TICK = 0.5; // seconds per hp repaired
const REPAIR_COST = 1 / 3; // shards per hp (1 shard per 3 hp)
const UPGRADE_COST = lvl => lvl * 8; // shards to go from lvl to lvl+1
const TOWER_BONUS = [0.35, 0.5, 0.65]; // occupant range bonus by tower level
const TOWER_MOUNT_REACH = 0.9; // tiles: stand at the base to climb; the wider
// hold-act ring (out to BUILD_REACH) stays free for repair/upgrade/rebuild
const TOWER_REBUILD_COST = 10;
const SHOP_REACH = 1.5; // tiles
const SHOP_OFFERS = [
  { what: 'token', cost: 20 },
  { what: 'shield', cost: 12 },
  { what: 'cracker', cost: 8, amount: 2 },
  { what: 'medkit', cost: 10, amount: 1 },
  { what: 'toxin', cost: 10, amount: 1 },
];
const STAG_SPEED = 2.2; // land mount speed multiplier
// Sprint (hold SHIFT): a brief speed burst that drains a stamina meter, then
// recovers — but ONLY while the operative is at full hp. The meter is a gated
// hero-mode field (lazy-minted on the first sprint press), so seats that never
// sprint stay byte-identical on the wire (CTF snapshots unchanged).
const SPRINT_MULT = 1.6;     // move-speed multiplier while sprinting
const STAMINA_MAX = 3;       // full meter (seconds of sprint at full drain)
const STAMINA_DRAIN = 1;     // meter-units per second drained while sprinting
const STAMINA_REGEN = 0.6;   // meter-units per second regained (FULL hp only)
const FLAG_REACH = 0.6; // tiles, flag touch radius
const FLAG_DROP_T = 8; // seconds a dropped flag lies before returning
const CTF_RESPAWN = 5;
const CTF_CAPS_TO_WIN = 3;
const CARRY_SLOW = 0.85; // flag carrier speed multiplier
const ZONE_TICK = 2; // seconds between 1-damage zone ticks
const ZONE_SHRINK_T = 10; // seconds a scheduled shrink takes to close
const FARM_REPLANT_T = 10; // seconds for a hired farmer to replant a trample

// --- combat depth: xp/evolutions, status effects, turret types, followers ---
// Per-mission seat xp. Levels 2/3/4 unlock at these cumulative totals.
const XP_THRESH = [12, 34, 70];
const XP_DIV = 25; // xp per kill = enemy base score / 25
const SQUAD_ASSIST_R = 8; // tiles: other seats this close to the killer earn floor(xp/2)

// --- Anchor Siege (MOBA lane-push) ------------------------------------------
// Minions are a SEPARATE faction (g.siege.minions) with their own cheap step
// functions; towers are g.siegeTowers (not the mountable g.towers); cores are
// g.cores tagged with a team. All gated on g.siege so other modes are untouched.
const SIEGE_CORE_HP = 60;
const SIEGE_TOWER_HP = [24, 32, 42];    // by tower level 1..3
const SIEGE_TOWER_DMG = [2, 3, 4];
const SIEGE_TOWER_RANGE = [6, 6.5, 7];  // tiles
const SIEGE_TOWER_PERIOD = 0.8;         // seconds between tower shots
const SIEGE_TOWER_REWARD = 8;           // shards to the team that destroys a tower
const SIEGE_HERO_SPEED = 0.72;          // MOBA heroes move deliberately (vs the fast run-and-gun campaign)
const MINION_HP = 4;
const MINION_SPEED = 2.0;               // tiles/sec along the lane
const MINION_R = TILE * 0.32;
const MINION_SCORE = 10;                // -> 0.4 xp on kill, 1 team shard
const MINION_CORE_DPS = 0.5;            // hp/s a minion gnaws an enemy core
const MINION_TOWER_DPS = 0.5;           // hp/s a minion gnaws an enemy tower
const SIEGE_TOWER_R = TILE * 0.55;      // collision radius for player shots
const SIEGE_CORE_R = TILE * 0.9;
const TURRET_TYPES = ['gun', 'prism', 'tesla', 'toxin'];
const TYPE_SELECT_T = 8; // seconds before an unattended carousel confirms 'gun'
// RA2 rebalance: a prism is a glass cannon — fragile (dies in ~2 hits) and its
// raw per-shot beam is no longer an instant kill. Reach/cadence unchanged.
const PRISM_DMG = [1, 2, 3]; // beam damage by turret level (was 2/3/4: too lethal)
const PRISM_HP = [2, 3, 4]; // fragile prism: ~2 hits to destroy at L1 (vs turret 10)
const PRISM_RANGE = [7, 7.5, 8]; // tiles
const PRISM_PERIOD = 1.2;
const PRISM_LINK_R = 4; // tiles: prisms inside link into one firing master
// RA2 Prism Tower linking: a group of nearby prisms picks ONE master to fire;
// the rest HOLD FIRE and feed it. Each feeder adds PRISM_FEED_DMG to the beam,
// capped at PRISM_FEED_CAP feeders (diminishing returns past the cap).
const PRISM_FEED_DMG = 1; // beam damage added per feeding supporter
const PRISM_FEED_CAP = 3; // max supporters that can feed one master
const TESLA_DMG = [[2, 1, 1], [3, 2, 1], [4, 2, 2]]; // chain damage by level
const TESLA_RANGE = [4, 4.5, 5]; // tiles
const TESLA_PERIOD = 1.5;
const TESLA_STUN = 0.4;
const TOXIN_TURRET_RANGE = [5, 5.5, 6]; // tiles
const TOXIN_TURRET_R = [1.6, 1.8, 2.0]; // sprayed patch radius (tiles) by level
const TOXIN_TURRET_PERIOD = 3;
const TOXIN_PATCH_R = 1.6; // tiles, thrown toxin lob patch
const TOXIN_PATCH_TTL = 6;
const BURN_PATCH_R = 1; // tiles, L4 burn-evolution death patch
const BURN_PATCH_TTL = 3;
const BURN_T = 3; // seconds ignited, 1 dmg per second
const TOX_T = 2; // seconds intoxicated, 0.5 dmg per second
const TOXIN_SLOW = 0.6; // player speed multiplier inside a toxin patch (everyone)
const STUN_T = 0.4; // shock-evolution stun
const FOLLOWER_JOBS = new Set(['hound', 'archer', 'caster']);
const FOLLOWER_STATS = { hound: { hp: 2, speed: 2.6 }, archer: { hp: 2, speed: 3.0 }, caster: { hp: 2, speed: 3.0 } };
const FOLLOWER_R = 12;
const FOLLOWER_ENGAGE = 5; // tiles from the OWNER inside which followers engage
const FOLLOWER_ADRIFT = 12; // tiles adrift before teleporting back to the owner
const FOLLOWER_ARROW = { kind: 'arrow', damage: 1, projSpeed: 9, range: 6, count: 1 };
const FOLLOWER_TORNADO = { kind: 'tornado', damage: 2, projSpeed: 3.5, range: 7, count: 1, pierce: 2, knockback: 1, radius: 10 };
const MAX_FOLLOWERS_PER_PLAYER = 2;
const MAX_FOLLOWERS_PER_SQUAD = 5;
const POST_RESTOCK_T = 20; // seconds before a post whose follower died restocks
// --- STRANDED OPERATORS + SCRAP (def.stranded opt-in; absent => byte-stable) -
// Weak neutral civilians waiting on the field. Give one a SCRAP item (a generic
// pickup, wholly separate from relic/music-box shards) or carry one to the
// stronghold centre and it RECRUITS as a 'defender' follower: an ownerless
// (owner === null) weak friendly that hustles to base and shoots enemies near
// it. Defenders reuse the g.followers array + render so the wire/draw stay one
// code path; only stepFollowers gains an ownerless branch.
const DEFENDER_STATS = { defender: { hp: 2, speed: 3.4 } }; // weak, but quick to base
const DEFENDER_HOLD = 7; // tiles around base the defender garrisons + engages within
const DEFENDER_ARROW = { kind: 'arrow', damage: 1, projSpeed: 8, range: 5, count: 1 };
const STRANDED_R = 12; // touch radius, captive-sized
const SCRAP_R = 12; // generic scrap pickup touch radius
const CONTROLLER_RANGE = 4; // tiles, mind-control reach
const CONTROLLER_T = 10; // seconds of mind control before the husk burns out
const SWIM_SLOW = 0.7; // swimmer speed multiplier on water
const SWIM_FIRE_MULT = 1.5; // swimmer fire cooldown multiplier on water

// --- frontier III: new roster tuning, field weapons, quests -----------------
const ACOLYTE_PULSE = 2.5; // seconds between Null Acolyte support pulses
// 'heals 1 hp at 25% rate': one mend rides every 4th shield pulse (1 hp/10s)
const ACOLYTE_HEAL_EVERY = 4;
const WRAITH_COOL = 2.2; // seconds between Volt Wraith chain-zaps
const WRAITH_STUN = 0.3; // seconds an unshielded operative is rooted by a zap
const STALKER_BLINK_T = 3.5; // seconds between Phase Stalker blinks
const STALKER_BLINK_TILES = 3; // tiles per blink, toward its target
const BEETLE_BURST_R = 1.2; // tiles: Pyre Beetle death patch + 1 dmg AoE
// Field weapon pickups (letter 'A'): self-contained weapon defs. They replace
// the carrier's main FIRE outright — no evolutions, their own cooldown; shop
// dmgBonus still rides via fireWeapon. `ammo` is the full-load default.
const FIELD_WEAPONS = {
  // cone of 5 short burn shots every 0.3s; each volley sips 1 fuel of 90
  flamer: { kind: 'flamer', damage: 1, projSpeed: 7, range: 2.6, count: 5, spreadDeg: 24, ignite: true, cooldown: 0.3, ammo: 90 },
  railcannon: { kind: 'railcannon', damage: 5, projSpeed: 20, range: 13, count: 1, pierce: 6, cooldown: 1.4, ammo: 10 },
  // chain-zap: stuns the mark and arcs to the nearest other enemy (shockArc)
  stormgun: { kind: 'stormgun', damage: 2, projSpeed: 11, range: 7, count: 1, stun: 0.3, shockArc: true, cooldown: 0.5, ammo: 24 },
  mortarMk2: { kind: 'mortarMk2', damage: 4, projSpeed: 7, range: 9, count: 1, aoeRadius: 1.6, overWalls: true, cooldown: 1.2, ammo: 14 },
};
const FIELD_KINDS = ['flamer', 'railcannon', 'stormgun', 'mortarMk2']; // 'A' default cycle
const FIELD_DROP_HOLD = 0.8; // seconds holding ITEM to drop a field weapon
// With a field weapon in hand the ITEM button is overloaded: a press released
// inside this window is a TAP (use the item slot, on release); holding to
// FIELD_DROP_HOLD lays the weapon down instead. Empty-handed players keep the
// classic edge-triggered use — there is nothing to disambiguate.
const ITEM_TAP_T = 0.3;
const QITEM_R = 12; // px, quest item touch radius (captive-sized)
const QUEST_REACH_TILES = 1.5; // tiles, 'reach' quests trip inside this ring

// --- frontier III: monolythium puzzle systems -------------------------------
// 'X' BLS pillar: obsolete cryptography, destructible by player fire only.
const PILLAR_HP = 12;
const PILLAR_R = 16; // px, shot-hit circle (crystal-sized)
// 'Z' seal forge: act-hold with 20 shards + a carried proof fragment mints a
// lythseal. The seal is its OWN player field (p.lythseal) — never an
// item-slot occupant, so chest loot/shop buys/quest rewards can't destroy it.
const FORGE_COST = 20; // shards
const FORGE_ITEM = 'fragment'; // required carried quest-item kind
const FORGE_HOLD_T = 1.0; // seconds of act-hold at the anvil
const GLYPH_SYMBOLS = 8; // distinct Monolythium runes, 0-7
// 'O' teleport pads: stand 0.8s to channel, blink to the twin, 2s per-player
// cooldown. Enemies never use pads (no code path exists for them).
const TELE_CHANNEL_T = 0.8;
const TELE_COOLDOWN = 2;
const DOOR_TOUCH = 10; // px beyond the player radius for lythseal door touches

// --- frontier IV: stronghold campaign, alive world, new terrain -------------
// Beacon-defense variant: four 'K' monoliths instead of one core. A beacon at
// 0 hp goes DARK (never destroyed); a day-time act-hold plus 8 shards relights
// it at full hp. Lose only when all four are dark at once.
const RELIGHT_COST = 8; // shards to relight a dark beacon
const RELIGHT_HOLD_T = 1.5; // seconds of act-hold at the dark monolith
// Anchorcraft early extraction: from night 2 on, all four beacons lit AT NIGHT
// lands the ship; boarding everyone launches with a full-clear bonus.
const SHIP_BOARD_TILES = 1.5; // act reach to board, like extraction
const SHIP_CLEAR_BONUS = 2000;
// THE HORN: during a bastion DAY any operative may hold act at the base core
// (or any LIT beacon) to call the night early — a 5s dusk warning, then night.
// The pool is paid floor(skipped-day-seconds / 6) shards (min 3) for the time
// bought back. Refused at night, while a blood-moon warning sounds, and in a
// day's last 5s (nothing left to skip).
const HORN_HOLD_T = 1.5;  // seconds of act-hold, scaled by holders (relight rule)
const HORN_LEAD = 5;      // the dusk warning the horn leaves on the clock
const HORN_BONUS_DIV = 6; // shards = floor(skipped seconds / 6) ...
const HORN_MIN_BONUS = 3; // ... but never less than 3
// DAY EVENTS (bastion): every day carries two deterministic beats seeded by
// the day's nightNo — a SCAVENGER PROBE at day+25s (3-5 light enemies off a
// deterministic edge, prowling to the base perimeter on normal aggro/leash,
// never core-targeted) and a SUPPLY DROP at day+45s (a loot chest landing
// 8-14 tiles from the base). A horn-shortened day skips whatever hasn't
// fired. def.bastion.dayEvents === false opts a map out (default on).
const PROBE_AT = 25;     // seconds into the day
const PROBE_HOME_TILES = [5, 9];  // probe prowl ring around the base
const DROP_AT = 45;      // seconds into the day
const DROP_TILES = [8, 14];       // supply chest landing band
// Terrain: '=' sand drags, '^' ice skates and drifts, '!' lava sears,
// '%' void blocks everything (move, sight, shots).
const SAND_SLOW = 0.85;
const ICE_FAST = 1.05;
const ICE_DRIFT = 0.6; // fraction of last tick's movement carried as drift
const LAVA_PLAYER_TICK = 0.8; // seconds per 1 hp standing in lava (players)
const LAVA_ENEMY_TICK = 1; // seconds per 1 hp for enemies
// Weather (def.weather): fog/ashstorm cap all sim sight at 9 tiles, snow slows
// every entity to x0.92, rain burns ground fire patches out twice as fast.
// 'thunderstorm' is the RELIC AWAKENING weather: it is NOT a level-authorable
// weather (createGame only honors def.weather for the four classic kinds), so
// no normal level can ever request it — only stepHorde latches it for the event.
const WEATHERS = new Set(['rain', 'snow', 'ashstorm', 'fog', 'thunderstorm']);
const WEATHER_SIGHT_TILES = 9;
const SNOW_SLOW = 0.92;
// Alive world: camp patrols walk waypoints at 0.6x while unaware; a living
// camp sniper inside 8 tiles spots for its group-mates (+4 tiles aggro).
const PATROL_SPEED = 0.6;
const SPOTTER_RANGE = 8; // tiles
const SPOTTER_BONUS = 4; // tiles of aggro granted by the spotter
// --- ENEMY STRONGHOLDS: fortified hostile outposts seeded onto big maps ------
// A stronghold is a walled ring (prebuilt wall builds) cornered by stationary
// defenders, GARRISONED with a cluster of melee guards that idle at home. The
// garrison shares the stronghold as its leash anchor: a player crossing the
// aggro radius wakes the whole garrison (existing wakeEnemy/alertGroup), and
// the garrison chases until the player drifts past the leash radius — measured
// from the STRONGHOLD, not each enemy — at which point they walk home and idle
// again (the existing returning state machine, re-homed to the keep). The
// feature is gated entirely on def.enemyStrongholds: untouched modes never seed
// one, so their snapshots stay byte-identical.
const STRONGHOLD_AGGRO = 11;   // tiles: garrison wakes when a player crosses in
const STRONGHOLD_LEASH = 18;   // tiles: garrison leashes home past this (from keep)
const STRONGHOLD_RING = 2;     // tiles: wall ring radius around the keep center
const STRONGHOLD_AWAY = 18;    // tiles: minimum keep distance from any spawn
const STRONGHOLD_GARRISON = 'ggrsa'; // default garrison letters (guards + defenders)
// Toxic air (def.modifiers.toxicAir {until}): unmasked operatives bleed
// 0.5 hp per 4s until the deadline. The mask item is persistent once worn.
const TOXIC_AIR_TICK = 4;
const MASK_OFFER = { what: 'mask', cost: 10, amount: 1 };
// RA2 buy-then-place stock: defense maps (bastion/stronghold) stall a deck of
// placeable structures beyond the standard five. `place: true` routes them
// through addToInventory (see buyOffer) — the operative then cycles inventory
// (inp.invSel) and enters placement mode (inp.place) to drop them. Costs match
// PLACEABLES (turret 8, wall 1/segment, barricade 4). Appended the same way
// MASK_OFFER is, so classic/PvP stalls keep the implicit five and stay byte-
// stable on the wire.
const PLACEABLE_OFFERS = [
  { what: 'turret', cost: 8, place: true },
  { what: 'wall', cost: 1, amount: 1, place: true, drag: true },
  { what: 'barricade', cost: 4, place: true },
];
// --- Map THEMES (def.theme): one named look+hazard preset that re-skins the
// whole environment so a level reads as "a lava map / a toxic map" etc. A
// theme pre-fills g.dark, g.weather and the deterministic ambient hazard at
// createGame; the render palette (THEME_PAL in render.js) keys off g.theme.
// kind maps onto the generalized ambientHazard timer (toxin|radiation|fire),
// all sharing the toxic-air math (~0.5 hp/4s, immuneItem grants immunity).
// ambientPatches (optional) seeds deterministic ground patches on a fixed
// clock — no Math.random, the emitter walks a counter like the siege waves.
const THEMES = {
  lava:    { weather: null,   dark: false, ambientHazard: { kind: 'fire',      tick: TOXIC_AIR_TICK, dmg: 0.5, immuneItem: 'mask' } },
  toxic:   { weather: null,   dark: false, ambientHazard: { kind: 'toxin',     tick: TOXIC_AIR_TICK, dmg: 0.5, immuneItem: 'mask' } },
  nuclear: { weather: null,   dark: false, ambientHazard: { kind: 'radiation', tick: TOXIC_AIR_TICK, dmg: 0.5, immuneItem: 'mask' } },
  storm:   { weather: 'rain', dark: true,  ambientHazard: null },
  fire:    { weather: null,   dark: false, ambientHazard: { kind: 'fire',      tick: TOXIC_AIR_TICK, dmg: 0.5, immuneItem: 'mask' } },
  ice:     { weather: 'snow', dark: false, ambientHazard: null },
};

function buildMaxHp(kind) {
  if (kind === 'barricade') return 14;
  if (kind === 'turret') return 10;
  if (kind === 'farm') return 6;
  if (kind === 'wall') return 20; // fortified segment, L1 (20/35/60 by level)
  if (kind === 'comm') return 25; // comm mast: mission-prep repair objective
  return 20; // pylon/beacon: never take damage once built (indestructible)
}

// Built structures that are never gnawed, repaired, upgraded or dismantled:
// pylons (gate anchors) and save beacons (checkpoints are sacrosanct).
function inertBuild(kind) { return kind === 'pylon' || kind === 'beacon'; }

// Deterministic chest loot: def.chests binds row-major; missing entries fall
// back to a fixed cycle by index. Shard chests pay 6-12 by index.
function chestLoot(def, i) {
  const cd = (def.chests || [])[i] || {};
  const loot = cd.loot || CHEST_LOOTS[i % CHEST_LOOTS.length];
  const amount = cd.amount ?? (loot === 'shards' ? 6 + (i % 7) : loot === 'cracker' ? 2 : 1);
  return { loot, amount };
}

export function charsById(characters) {
  const m = {};
  for (const c of characters) m[c.id] = c;
  return m;
}

function makeEnemy(letter, x, y, id) {
  const def = ENEMY_STATS[letter] || ENEMY_STATS.g;
  return {
    id,
    letter,
    kind: def.kind,
    x,
    y,
    hp: def.hp,
    maxHp: def.hp,
    speed: def.speed * TILE,
    range: (def.range || 0) * TILE,
    aggro: (def.aggro || 8) * TILE,
    cool: (def.cool || 0) + (id % 3) * 0.25,
    spawnCool: def.spawnCool || 0,
    score: def.score,
    fx: 0,
    fy: 1,
    hurt: 0,
    state: 'idle',
    aimT: 0,
    aimX: x,
    aimY: y,
    awake: false,
    repathT: (id % 5) * 0.1,
    path: null,
    pathI: 0,
    homeX: x,
    homeY: y,
    returning: false,
    hitCool: 0,
    // Phase Stalker blink clock: staggered by id, like cool — deterministic.
    ...(def.kind === 'stalker' ? { blinkT: STALKER_BLINK_T + (id % 4) * 0.35 } : {}),
  };
}

// Stronghold strength scaling: applied once at spawn, BEFORE mutations (a
// bulk mutant doubles the scaled pool) and blood-moon/late-night additives.
// Ceil keeps hp integral and the scaling deterministic.
function scaleEnemyHp(mult, e) {
  if (!(mult > 1)) return;
  e.hp = Math.ceil(e.hp * mult);
  e.maxHp = Math.ceil(e.maxHp * mult);
}

// GROUP ALERT: a camp member that spots trouble (sight or bump — never a
// silent long-range kill) wakes its whole camp on a deterministic 0.25..1s
// stagger. Members already waking keep their earlier clock.
function alertGroup(g, e) {
  if (e.group === undefined) return;
  let k = 0;
  for (const o of g.enemies) {
    if (o === e || o.dead || o.awake || o.group !== e.group) continue;
    if (!(o.groupWakeT > 0)) o.groupWakeT = 0.25 + (k % 4) * 0.25;
    k++;
  }
}

export function parseLevel(def) {
  const grid = def.tiles.map(r => r.split(''));
  const h = grid.length;
  const w = grid[0].length;
  const spawns = [];
  const captives = [];
  const enemies = [];
  const npcs = [];
  const builds = [];
  const crystals = [];
  const chests = [];
  const vehicles = [];
  const towers = [];
  const shops = [];
  const hires = [];
  const flags = [];
  const pickups = [];
  const qitems = [];
  const switches = [];
  const glyphs = [];
  const pillars = [];
  const forges = [];
  const teleports = [];
  const cores = []; // every 'K' monolith (beacon-defense maps field four)
  let core = null;
  let ci = 0;
  let ni = 0;
  let bi = 0;
  let eid = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = grid[y][x];
      const px = (x + 0.5) * TILE;
      const py = (y + 0.5) * TILE;
      if (c === 'P') {
        spawns.push({ x: px, y: py });
        grid[y][x] = '.';
      } else if (c === 'c') {
        const charId = (def.captiveChars || [])[ci++];
        if (charId) captives.push({ id: 'c' + ci, charId, x: px, y: py, owner: null, fromPlayer: false });
        grid[y][x] = '.';
      } else if (c === 'N') {
        const nd = (def.npcs || [])[ni++];
        if (nd) npcs.push({ id: nd.id, name: nd.name, x: px, y: py, lines: nd.lines || [], gift: nd.gift || null, lineIdx: 0, given: false });
        grid[y][x] = '.';
      } else if (c === 'B') {
        const bd = (def.builds || [])[bi++];
        if (bd) {
          // prebuilt:true ships the structure already standing (paid in
          // full) — stronghold base perimeters are prebuilt wall segments.
          // An optional bd.level (leveled kinds only) pre-upgrades it.
          const lvl0 = STRUCT_HP[bd.kind] ? Math.min(3, Math.max(1, bd.level || 1)) : undefined;
          // a prebuilt prism turret ships on its fragile HP track (RA2 nerf)
          const prebuiltPrism = bd.prebuilt && bd.kind === 'turret' && bd.ttype === 'prism';
          const maxHp = prebuiltPrism ? turretMaxHp('prism', lvl0 || 1)
            : lvl0 !== undefined ? STRUCT_HP[bd.kind][lvl0 - 1] : buildMaxHp(bd.kind);
          builds.push({
            x: px, y: py, kind: bd.kind, cost: bd.cost,
            progress: bd.prebuilt ? 1 : 0,
            paid: bd.prebuilt ? bd.cost : 0,
            built: !!bd.prebuilt,
            hp: bd.prebuilt ? maxHp : 0, maxHp,
            cool: 0, evT: 0,
            ...(bd.kind === 'farm' ? { stage: 0, growT: 0 } : {}),
            // barricades/turrets/walls carry an upgrade level; pylons never do
            ...(lvl0 !== undefined ? { level: lvl0 } : {}),
            ...(bd.prebuilt ? { invested: bd.cost } : {}),
            // a prebuilt turret skips the type carousel: def.ttype or 'gun'
            ...(bd.prebuilt && bd.kind === 'turret'
              ? { ttype: TURRET_TYPES.includes(bd.ttype) ? bd.ttype : 'gun' } : {}),
          });
        }
        grid[y][x] = '.';
      } else if (c === 'C') {
        const ld = chestLoot(def, chests.length);
        chests.push({ x: px, y: py, opened: false, loot: ld.loot, amount: ld.amount });
        grid[y][x] = '.';
      } else if (c === 'K') {
        const chp = (def.siege && def.siege.coreHp) || 30; // siege cores are tougher; beacons stay 30
        cores.push({ x: px, y: py, hp: chp, maxHp: chp });
        grid[y][x] = '.';
      } else if (c === 'V') {
        const vd = (def.vehicles || [])[vehicles.length] || {};
        vehicles.push({ id: 'v' + vehicles.length, x: px, y: py, kind: vd.kind || 'stag', rider: null });
        grid[y][x] = '.';
      } else if (c === 'W') {
        towers.push({ x: px, y: py, level: 1, hp: 20, maxHp: 20, occupant: null });
        grid[y][x] = '.';
      } else if (c === 'S') {
        shops.push({ x: px, y: py });
        grid[y][x] = '.';
      } else if (c === 'H') {
        const hd = (def.hires || [])[hires.length] || {};
        hires.push({
          x: px, y: py,
          cost: hd.cost ?? 12,
          job: hd.job || HIRE_JOBS[hires.length % HIRE_JOBS.length],
          hired: false,
          name: hd.name || 'Hand ' + (hires.length + 1),
        });
        grid[y][x] = '.';
      } else if (c === 'D') {
        flags.push({ team: flags.length % 2, x: px, y: py, homeX: px, homeY: py, carrier: null, atBase: true, dropT: 0 });
        grid[y][x] = '.';
      } else if (c === 'Y') {
        crystals.push({ cid: crystals.length, x: px, y: py, hp: 3 });
        grid[y][x] = '.';
      } else if (c === 'A') {
        // field weapon pickups: def.pickups binds row-major; missing entries
        // cycle the four field kinds deterministically by index
        const pd = (def.pickups || [])[pickups.length] || {};
        const kind = FIELD_WEAPONS[pd.kind] ? pd.kind : FIELD_KINDS[pickups.length % FIELD_KINDS.length];
        pickups.push({ id: 'fw' + pickups.length, x: px, y: py, kind, ammo: pd.ammo ?? FIELD_WEAPONS[kind].ammo });
        grid[y][x] = '.';
      } else if (c === 'I') {
        // quest items: def.qitems binds row-major (proof fragments and the
        // like); they trail their carrier exactly like captives
        const qd = (def.qitems || [])[qitems.length] || {};
        qitems.push({ id: qd.id || 'qi' + qitems.length, kind: qd.kind || 'fragment', x: px, y: py, carrier: null });
        grid[y][x] = '.';
      } else if (c === 'Q') {
        // relay switches: def.switches binds row-major ({id, group})
        const sd = (def.switches || [])[switches.length] || {};
        switches.push({ id: sd.id || 'sw' + switches.length, x: px, y: py, on: false, group: sd.group ?? 0 });
        grid[y][x] = '.';
      } else if (c === 'J') {
        // glyph stones: def.glyphs binds row-major ({id, symbol 0-7, group})
        const gd = (def.glyphs || [])[glyphs.length] || {};
        glyphs.push({
          id: gd.id || 'gl' + glyphs.length, x: px, y: py,
          symbol: (gd.symbol ?? glyphs.length) % GLYPH_SYMBOLS, lit: false, group: gd.group ?? 0,
        });
        grid[y][x] = '.';
      } else if (c === 'X') {
        // BLS pillars: obsolete cryptography, shot-destructible (hp 12)
        pillars.push({ id: 'pl' + pillars.length, x: px, y: py, hp: PILLAR_HP, maxHp: PILLAR_HP });
        grid[y][x] = '.';
      } else if (c === 'Z') {
        forges.push({ x: px, y: py, holdT: 0 });
        grid[y][x] = '.';
      } else if (c === 'O') {
        // teleport pads pair in def.teleports order; the default pairs
        // consecutive pads (0<->1, 2<->3, ...) — an odd trailing pad is inert
        const td = (def.teleports || [])[teleports.length] || {};
        teleports.push({ id: td.id || 'tp' + teleports.length, x: px, y: py, twin: td.twin ?? null });
        grid[y][x] = '.';
      } else if (ENEMY_LETTERS.has(c)) {
        enemies.push(makeEnemy(c, px, py, eid++));
        grid[y][x] = '.';
      }
    }
  }
  // resolve default teleport twins by id once every pad is known
  teleports.forEach((t, i) => {
    if (t.twin == null) t.twin = (teleports[i ^ 1] || {}).id ?? null;
  });
  // single-core maps keep their one 'K' on .core; beacon-defense maps read
  // the full .cores array (createGame decides by def.bastionVariant)
  core = cores.length ? cores[0] : null;
  return { grid: grid.map(r => r.join('')), w, h, spawns, captives, enemies, npcs, builds, crystals, chests, vehicles, towers, shops, hires, flags, pickups, qitems, switches, glyphs, pillars, forges, teleports, core, cores };
}

export function createGame(def, party, charMap, roster) {
  const lvl = parseLevel(def);
  const mods = def.modifiers || {};
  const pvp = def.mode === 'ctf' || def.mode === 'br';
  const siege = def.mode === 'siege'; // MOBA lane-push: minions are the only mobs
  // PvP/siege modes field no AI enemies at all, whatever the grid says.
  if (pvp || siege) lvl.enemies = [];
  // Arcade maps (the classic single-screen levels) keep the original behavior
  // exactly: every enemy awake, straight-line steering, fire on range without
  // sight checks, global spawn caps, respawn at the level spawn point.
  // Mode maps (bastion/ctf/br) always play by survival rules, whatever their size.
  const arcade = !def.mode && lvl.w * lvl.h <= ARCADE_MAP_TILES;
  if (arcade) for (const e of lvl.enemies) e.awake = true;
  // Big-map spawn tuning: slower brood cycles than the arcade originals.
  if (!arcade) {
    for (const e of lvl.enemies) {
      if (e.kind === 'spawner') e.spawnCool = 6.5;
      else if (e.kind === 'boss') e.spawnCool = 7;
    }
  }
  // Stronghold enemy strength scaling: def.stronghold.hpMult (1.0 -> 1.8
  // across the 25-level arc) raises every enemy's hp pool, spawn-time only.
  const hpMult = (def.stronghold && def.stronghold.hpMult) || 1;
  if (hpMult > 1) for (const e of lvl.enemies) scaleEnemyHp(hpMult, e);
  // Family Mode: gentle monsters — they amble rather than charge (damage is
  // softened in damagePlayer, and going down just respawns; see downPlayer).
  if (def.family) for (const e of lvl.enemies) { e.speed = (e.speed || 1) * FAMILY_ENEMY_SPEED; if (e.aggro) e.aggro *= 0.8; }
  // Alive-world bindings, by home tile (row-major spawn position):
  // def.patrols [{at:[x,y], points:[[x,y],...]}] gives a sleeping enemy a
  // waypoint loop; def.groups [[[x,y],...], ...] stamps camp group ids.
  const atTile = (x, y) => lvl.enemies.find(e2 => e2.homeX === (x + 0.5) * TILE && e2.homeY === (y + 0.5) * TILE);
  for (const pd of def.patrols || []) {
    const e = pd.at && atTile(pd.at[0], pd.at[1]);
    if (e && Array.isArray(pd.points) && pd.points.length) {
      e.patrol = pd.points.map(pt => ({ x: (pt[0] + 0.5) * TILE, y: (pt[1] + 0.5) * TILE }));
      e.patrolI = 0;
    }
  }
  (def.groups || []).forEach((camp, gi) => {
    for (const at of camp) {
      const e = atTile(at[0], at[1]);
      if (e) e.group = gi;
    }
  });
  // Beacon-defense variant: the four 'K' monoliths become g.cores; the
  // single-core fields (and their lose rule) stay null on these maps.
  const beaconVariant = def.bastionVariant === 'beacons' && def.mode === 'bastion';
  const players = party.map((p, i) => {
    const s = lvl.spawns[i % lvl.spawns.length] || { x: TILE * 2, y: TILE * 2 };
    return spawnPlayer(p.pid, p.name, p.charId, s.x + (i * 10), s.y);
  });
  // Survival rules apply on every non-arcade map: 3 hp, shield pips, an item
  // slot. Arcade (classic) players stay 1-hit and gain no fields at all.
  if (!arcade) {
    for (const p of players) {
      p.hp = def.family ? FAMILY_PLAYER_HP : PLAYER_MAX_HP;
      p.maxHp = p.hp;
      p.shield = 0;
      p.item = null;
      // on-the-spot leveling: per-mission seat xp, levels 1..4
      p.xp = 0;
      p.level = 1;
    }
  }
  // PvP team assignment. CTF: party entries may carry a team (online lobbies);
  // otherwise seats alternate 0/1. BR: every operative for themselves.
  if (def.mode === 'ctf' || siege) {
    for (let i = 0; i < players.length; i++) players[i].team = party[i].team ?? (i % 2);
  } else if (def.mode === 'br') {
    for (const p of players) p.team = p.pid;
  }
  // pvp scoreboard: per-player kills (BR simultaneous-wipe ties go to the
  // player with more kills, then the lower pid)
  if (pvp || siege) for (const p of players) p.kills = 0;
  const bastion = def.mode === 'bastion' ? { ...BASTION_DEFAULTS, ...(def.bastion || {}) } : null;
  // Untimed story (user mandate: no countdown in story modes): story levels
  // and bastion maps never decrement timeLeft, never fail on the clock and
  // never cue lowTime — g.elapsed keeps driving waves/gate.after/day-night.
  // def.timed:true opts a future level back into a countdown. CTF and BR keep
  // their match timers; classic levels keep their arcade countdowns.
  const untimed = !pvp && !def.timed && (!!def.story || def.mode === 'bastion' || siege || !!def.family || !!def.untimed);
  // First 'E' tile center, used by the gateOpen event.
  let exitX = lvl.w * TILE / 2, exitY = lvl.h * TILE / 2;
  outer: for (let y = 0; y < lvl.h; y++) {
    for (let x = 0; x < lvl.w; x++) {
      if (lvl.grid[y][x] === 'E') { exitX = (x + 0.5) * TILE; exitY = (y + 0.5) * TILE; break outer; }
    }
  }
  // --- Anchor Siege setup: two team cores, lane waypoints, pre-placed towers ---
  let siegeCores = null, siegeState = null, siegeTowers = null;
  if (siege) {
    // exactly two 'K' cores; team by position — the core LOWER on the map
    // (larger y) is team 0 (bottom-left base), the other is team 1.
    const cs = lvl.cores.slice(0, 2).sort((a, b) => b.y - a.y);
    const chp = (def.siege && def.siege.coreHp) || SIEGE_CORE_HP;
    siegeCores = cs.map((c, i) => ({ x: c.x, y: c.y, hp: chp, maxHp: chp, lit: true, team: i }));
    const toPx = ([tx, ty]) => ({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE });
    const lanes = ((def.siege && def.siege.lanes) || []).map(l => ({ waypoints: (l.waypoints || []).map(toPx) }));
    siegeState = {
      minions: [], nextMinionId: 9000, spawnT: [3, 3], waveNo: [0, 0],
      interval: (def.siege && def.siege.minionInterval) || 20,
      cap: (def.siege && def.siege.minionCap) || 12,
      waveBase: (def.siege && def.siege.waveBase) || 3,
      wavePerMin: (def.siege && def.siege.wavePerMin) || 1,
      lanes,
      lanesRev: lanes.map(l => ({ waypoints: l.waypoints.slice().reverse() })),
    };
    siegeTowers = (def.towers || []).map((t, i) => {
      const lvlv = Math.max(1, Math.min(3, t.level || 1));
      return { id: i, x: (t.x + 0.5) * TILE, y: (t.y + 0.5) * TILE, team: t.team, lane: t.lane || 0,
        level: lvlv, hp: SIEGE_TOWER_HP[lvlv - 1], maxHp: SIEGE_TOWER_HP[lvlv - 1], cool: 0, destroyed: false };
    });
  }
  // --- Map theme: a named preset (THEMES) that re-skins the level. It only
  // pre-fills look/hazard fields below; an explicit def.modifier still wins
  // (toxicAir keeps its own ambientHazard wiring). Unthemed levels never touch
  // any of this, so their snapshots stay byte-identical. ---
  const theme = (typeof def.theme === 'string' && THEMES[def.theme]) ? def.theme : null;
  const tdef = theme ? THEMES[theme] : null;
  // theme weather only applies when the def names no weather of its own.
  const themeWeather = tdef && WEATHERS.has(tdef.weather) ? tdef.weather : null;
  // toxicAir modifier maps onto an ambientHazard of kind 'toxin'; otherwise a
  // theme supplies the ambient hazard. The two never stack (modifier wins).
  const ambientHazard = mods.toxicAir
    ? { kind: 'toxin', tick: TOXIC_AIR_TICK, dmg: 0.5, immuneItem: 'mask', until: mods.toxicAir.until || 0 }
    : (tdef && tdef.ambientHazard ? { ...tdef.ambientHazard } : null);
  // any ambient hazard with an immuneItem stocks that item in the stall.
  const stockMask = !!(ambientHazard && ambientHazard.immuneItem === 'mask');
  // Defense maps (bastion/stronghold) stock the RA2 buy-then-place deck so the
  // turret/wall/barricade placement loop is reachable in normal play. PvP and
  // classic survival stalls keep the implicit five (byte-stable on the wire).
  const stockPlaceables = def.mode === 'bastion';
  const shopOffers = (stockMask ? SHOP_OFFERS.concat([MASK_OFFER]) : SHOP_OFFERS)
    .concat(stockPlaceables ? PLACEABLE_OFFERS : []);

  const g = {
    name: def.name || 'Untitled',
    objective: def.objective || '',
    grid: lvl.grid, w: lvl.w, h: lvl.h,
    arcade,
    untimed,
    spawns: lvl.spawns,
    timeLeft: def.time || 90,
    // Story modifiers. dark shrinks enemy aggro and caps their sight; waves
    // pour hunters in from a map edge at fixed elapsed times. Classic levels
    // define neither, so their behavior is untouched.
    dark: !!mods.dark || !!(tdef && tdef.dark),
    elapsed: 0,
    waves: (mods.waves || []).map(w => ({ at: w.at, letters: w.letters || '', edge: w.edge, fired: false })),
    players,
    enemies: lvl.enemies,
    captives: lvl.captives,
    npcs: lvl.npcs,
    builds: lvl.builds,
    crystals: lvl.crystals,
    chests: lvl.chests,
    vehicles: lvl.vehicles,
    towers: lvl.towers,
    shops: lvl.shops,
    hires: lvl.hires,
    flags: lvl.flags,
    core: (siege || beaconVariant) ? null : lvl.core,
    // beacon-defense: four lit monoliths; dark at 0 hp, relightable by day.
    // siege: two team-tagged cores (the only win/lose objective).
    cores: siege ? siegeCores
      : beaconVariant
        ? lvl.cores.slice(0, 4).map(c => ({ x: c.x, y: c.y, hp: c.hp, maxHp: c.maxHp, lit: true, relightT: 0 }))
        : null,
    // Anchor Siege state (minions + lanes) and the pre-placed lane towers.
    siege: siegeState,
    siegeTowers: siegeTowers,
    deathCountByTeam: siege ? [0, 0] : null,
    // Family Mode: gentle co-op — generous shared lives, respawn-on-cooldown.
    family: !!def.family,
    familyLives: def.family ? FAMILY_BASE_LIVES + 3 * players.length : null,
    ship: null, // the landed Anchorcraft (early-extraction reward), if any
    hpMult,
    // DIFFICULTY: enemy spawn-count multiplier from def.difficulty (default
    // 'normal'). 'extreme' == 1.0 keeps today's exact counts; lower values
    // thin both normal waves and the relic horde. Legit setting, not a cheat.
    difficulty: def.difficulty || 'normal',
    enemyScale: difficultyScale(def.difficulty || 'normal'),
    // alive world: weather/ambience pass through to snapshots for render/audio
    // (an explicit def.weather wins; otherwise a theme may imply one)
    weather: WEATHERS.has(def.weather) ? def.weather : themeWeather,
    ambience: def.ambience || null,
    // Map theme name: drives the render palette + ambient FX. Null when unset.
    theme,
    // toxic air: unmasked operatives bleed until the deadline (elapsed s)
    toxicAir: mods.toxicAir ? { until: mods.toxicAir.until || 0, warned: false } : null,
    // Generalized ambient hazard: one deterministic bleed timer (toxin |
    // radiation | fire) for any unmasked operative. toxicAir maps onto kind
    // 'toxin'; a theme can supply one directly. Null on plain levels.
    ambientHazard,
    // Optional theme ground-patch emitter (e.g. lava spits): a deterministic
    // clock (patchT counts down by dt) drops patches on a fixed cadence, the
    // spawn site walked by a counter (patchN) — never Math.random. Null when
    // the theme declares none, so the emitter below is a no-op on plain levels.
    ambientPatches: (tdef && tdef.ambientPatches)
      ? { kind: tdef.ambientPatches.kind, everySec: tdef.ambientPatches.everySec || 4,
          r: tdef.ambientPatches.r || 1.2, ttl: tdef.ambientPatches.ttl || 4,
          cap: tdef.ambientPatches.cap || 4, patchT: tdef.ambientPatches.everySec || 4, patchN: 0 }
      : null,
    shopOffers,
    crackers: [],
    // ground patches (burn/toxin) and hired combat followers. Always present;
    // snapshots only ship them when populated, so classics never gain a key.
    patches: [],
    followers: [],
    nextFollowerId: 1,
    // STRANDED OPERATORS + SCRAP: filled by setupStranded only when def.stranded
    // is set. Always present (empty otherwise) so step/snapshot/serialize never
    // branch on existence; snapshot ships them only when populated, so every
    // unflagged mode keeps byte-identical snapshots.
    stranded: [],
    scrap: [],
    nextScrapId: 0,
    // field weapon pickups ('A') and quest items ('I'). Dropped weapons mint
    // fresh ids from nextPickupId so shared loot stays addressable.
    pickups: lvl.pickups,
    nextPickupId: lvl.pickups.length,
    qitems: lvl.qitems,
    // quest runtime: hidden until the giver is talked to; progress accrues
    // while active; completion (and rewards) land back at the giver's feet.
    quests: (def.quests || []).map(q => ({
      id: q.id, main: !!q.main, title: q.title || q.id, giver: q.giver,
      kind: q.kind, item: q.item, target: q.target, count: q.count || 1,
      reward: q.reward || null, hint: q.hint || '',
      state: 'hidden', progress: 0,
    })),
    // openDoor quest rewards park door ids here; stepDoors consumes them.
    pendingDoorOpens: [],
    // --- monolythium puzzle systems ---
    // relay switches and their cluster quorums (need-of-of, optional window)
    switches: lvl.switches,
    switchGroups: (def.switchGroups || []).map(sg => ({
      group: sg.group ?? 0, need: sg.need || 1, of: sg.of ?? lvl.switches.filter(s => s.group === (sg.group ?? 0)).length,
      window: sg.window || 0, reward: sg.reward || null, windowT: 0, done: false,
    })),
    // glyph stones light in exact order; a wrong stone resets the group
    glyphs: lvl.glyphs,
    glyphGroups: (def.glyphGroups || []).map(gg => ({
      group: gg.group ?? 0, order: (gg.order || []).slice(), reward: gg.reward || null, done: false,
    })),
    pillars: lvl.pillars,
    forges: lvl.forges,
    teleports: lvl.teleports,
    // doors are tile rects from def.doors: closed they block movement, sight,
    // shots and A*; opened by quest/switch/glyph rewards or lythseal touch
    doors: (def.doors || []).map((d, i) => ({
      id: d.id || 'door' + i, x: d.x, y: d.y, w: d.w || 1, h: d.h || 1,
      open: !!d.open, sealLock: !!d.sealLock,
    })),
    // Mode missions (bastion/ctf/br) replace the classic end conditions;
    // classic defs carry no mode so nothing changes for them.
    mode: def.mode || null,
    bastion,
    cycle: bastion ? { phase: 'day', nightNo: 0, t: bastion.dayLen, bloodMoon: false, warned: false, waveN: 0, dayE: 0, hornT: 0, probeDone: false, dropDone: false } : null,
    // CTF score and BR shrink zone. Null on every other mode (snapshot omits).
    caps: def.mode === 'ctf' ? [0, 0] : null,
    // CTF per-team shard pools; null everywhere else (g.shards rules there —
    // BR keeps the single shared pool by design).
    teamShards: (def.mode === 'ctf' || siege) ? [0, 0] : null,
    // CTF sudden-death bookkeeping: flag pickups per team across the match,
    // and which team grabbed first inside sudden death (the 180s cap rules).
    grabs: def.mode === 'ctf' ? [0, 0] : null,
    sdFirstGrab: null,
    suddenT: 0,
    suddenDeath: false,
    zone: def.mode === 'br' ? {
      x: lvl.w * TILE / 2, y: lvl.h * TILE / 2,
      r: Math.hypot(lvl.w, lvl.h) * TILE / 2,
      targetR: Math.hypot(lvl.w, lvl.h) * TILE / 2,
      shrinkT: 0,
    } : null,
    brShrinks: def.mode === 'br'
      ? ((def.br || {}).shrinks || []).map(s => ({ at: s.at, r: s.r, fired: false }))
      : null,
    winner: undefined,
    lastOut: null,
    drops: [],
    // POWER-UP DROPS: always present (empty) so step/snapshot/serialize never
    // branch on existence; snapshot ships the array + the two effect timers only
    // when populated/non-zero, so every mode that never drops one stays byte-
    // identical. powerupKills is the per-game kill counter the deterministic drop
    // roll mixes in (separate from g.kills, which other systems already drive).
    powerups: [],
    nextPowerupId: 0,
    powerupKills: 0,
    fireSaleT: 0,    // >0: builds/placeables are free
    freeSprintT: 0,  // >0: sprint never drains stamina
    shards: 0,
    // gate.after: optional time lock — even at full pylon quorum the Anchor
    // only opens once `after` seconds have elapsed (siege missions).
    gate: def.gate ? { need: def.gate.need, after: def.gate.after || 0, built: 0, open: false } : null,
    exitX,
    exitY,
    shots: [],
    events: [],
    rescued: [],
    roster: roster.slice(),
    charMap,
    status: 'play',
    graceT: START_GRACE,
    nextCaptiveId: 100,
    nextEnemyId: 1000,
    nextShotId: 1,
    score: 0,
    kills: 0,
    combo: 1,
    comboT: 0,
    lowTimeSent: false,
    // RELIC SUPERWEAPON: unlocked only by surviving the awakening horde; the
    // device + hazard fields stay absent/empty otherwise so snapshots for every
    // untouched mode are byte-identical. (superweapon stays null until built;
    // hazards stays empty until a nuke/storm lands.)
    superweaponUnlocked: false,
    superweapon: null,
    hazards: [],
  };
  // CTF deploys every operative on their team stand's spawn ring (16 seats
  // per stand, deterministic offsets, see ctfStandSpot) instead of the
  // row-major 'P' spawn list — at 16v16 the old spawns[i % n] + i*10px drift
  // walked late seats into walls AND could land explicit-team parties at the
  // wrong base. Respawn and mid-match joins use the same rings.
  if (g.siege) {
    // siege deploys each operative on a ring around their team's core
    for (const p of g.players) { const s = siegeSpawnSpot(g, p); p.x = s.x; p.y = s.y; }
  } else if (g.mode === 'ctf' && g.flags.length) {
    for (const p of g.players) {
      const s = ctfStandSpot(g, p);
      p.x = s.x;
      p.y = s.y;
    }
  } else if (!g.arcade) {
    // Mode maps above the old flat-8 cap (br fields 16 now): the classic
    // spawn drift (spawns[i % n] + i*10px) can run a late seat into a wall
    // when spawns are reused. A colliding deploy ring-scans to the nearest
    // open tile around its spawn point (deterministic respawnSpot order);
    // clear deploys keep their exact classic positions, so nothing moves
    // for the squads that always fit. Arcade classics keep the original
    // byte-identical behavior, drift and all.
    for (const p of g.players) {
      if (!collides(g, p.x, p.y, PLAYER_R)) continue;
      ring: for (let r = 1; r <= 4; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = p.x + dx * TILE, y = p.y + dy * TILE;
            if (x > TILE && y > TILE && x < (g.w - 1) * TILE && y < (g.h - 1) * TILE && !collides(g, x, y, PLAYER_R)) {
              p.x = x;
              p.y = y;
              break ring;
            }
          }
        }
      }
    }
  }
  // Music Box easter egg: story + stronghold only. Deterministic placement of
  // four corner fragments and one base-side altar straight off the tilemap, so
  // every client and the server agree without exchanging any extra setup.
  placeStags(g, def);
  // Enemy strongholds: fortified hostile keeps + garrison, gated on
  // def.enemyStrongholds (untouched modes never seed one). Runs BEFORE the
  // music box so a keep's wall ring is on the map when fragments scan for open
  // tiles — fragments simply route around the new structures, deterministically.
  setupStrongholds(g, def);
  setupMusicBox(g, def);
  // STRANDED OPERATORS + SCRAP: opt-in field NPCs/pickups. Runs LAST so the base
  // centre, strongholds and music-box altar are all on the map before it scans
  // for open tiles. A no-op (arrays stay empty) unless def.stranded is set.
  setupStranded(g, def);
  return g;
}

// --- MUSIC BOX easter egg (story + stronghold only) -----------------------
// Four collectible fragments seed at the four map corners (nearest open tile
// scanning inward), and one ruin altar seeds a few tiles outside the spawn
// cluster. Fragments carry exactly like quest items: a single carrier field,
// scooped on touch, trailing the carrier, dropped where a downed carrier fell.
// Walking the altar while carrying deposits one. Gated strictly on g.musicBox
// .enabled — every other mode leaves g.musicBox disabled and untouched.
const MUSICBOX_FRAGS = 4;
const MUSICBOX_R = 12; // touch radius, captive-sized

// Nearest open (walkable, non-lava, structure-free) tile to a map corner,
// scanned inward along the corner diagonal then its neighbourhood. Returns
// tile-center world coords, or the corner tile center as a last resort.
function cornerOpenTile(g, cornerX, cornerY) {
  // cornerX/cornerY are tile indices of the corner; stepX/stepY point inward.
  const stepX = cornerX === 0 ? 1 : -1;
  const stepY = cornerY === 0 ? 1 : -1;
  const maxD = Math.max(g.w, g.h);
  for (let d = 0; d < maxD; d++) {
    // expanding diagonal band: tiles whose Chebyshev distance from the corner
    // along the inward diagonal equals d, scanned in a fixed deterministic order
    for (let a = 0; a <= d; a++) {
      for (const [ix, iy] of [[d, a], [a, d]]) {
        const tx = cornerX + stepX * ix;
        const ty = cornerY + stepY * iy;
        if (tx < 1 || ty < 1 || tx >= g.w - 1 || ty >= g.h - 1) continue;
        const c = g.grid[ty][tx];
        if (blocksMove(c) || c === '!') continue;
        const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
        if (collides(g, x, y, MUSICBOX_R)) continue;
        return { x, y };
      }
    }
  }
  return { x: (cornerX + 0.5) * TILE, y: (cornerY + 0.5) * TILE };
}

// Audio stem for this level: "<category>/<filename-stem>" if the server tagged
// def.key, else rebuild it from the chapter / stronghold numbers. The client
// turns mode + stem into music/<mode>-<stem>.mp3.
function musicBoxStem(def) {
  const mode = def.story ? 'story' : 'stronghold';
  if (typeof def.key === 'string' && def.key.includes('/')) {
    return { mode, stem: def.key.slice(def.key.lastIndexOf('/') + 1) };
  }
  if (mode === 'story') return { mode, stem: 'ch' + String(def.chapter ?? 1).padStart(2, '0') };
  return { mode, stem: 'sh' + String(def.stronghold?.level ?? 1).padStart(2, '0') };
}

// Stags are a fast land mount; authored 'V' tiles often sit inside the base,
// turning the stag into a free shortcut. Scatter stags to deterministic-random
// open tiles out in the map (away from every spawn), capped at 2 per level.
// Skiffs (water craft) keep their authored dock positions.
function placeStags(g, def) {
  if (!Array.isArray(g.vehicles) || !g.vehicles.length) return;
  const stags = g.vehicles.filter(v => v.kind === 'stag');
  if (!stags.length) return;
  const others = g.vehicles.filter(v => v.kind !== 'stag');
  const keep = stags.slice(0, 2); // max 2
  const sp = g.spawns.length ? g.spawns : [{ x: g.w * TILE / 2, y: g.h * TILE / 2 }];
  const BASE_R = 4.5 * TILE, AWAY_R = 11 * TILE;
  const inBase = (x, y) => sp.some(s => Math.hypot(x - s.x, y - s.y) < BASE_R);
  const nearSpawn = (x, y) => sp.some(s => Math.hypot(x - s.x, y - s.y) < AWAY_R);
  // deterministic LCG seeded by the level identity (same placement everywhere)
  const nm = String(def.key || def.name || def.title || 'lvl');
  let seed = 2166136261; for (let i = 0; i < nm.length; i++) { seed ^= nm.charCodeAt(i); seed = (seed * 16777619) >>> 0; }
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (const v of keep) {
    if (!inBase(v.x, v.y)) continue; // only scatter stags that sit IN the base
    for (let tries = 0; tries < 80; tries++) {
      const tx = 2 + Math.floor(rnd() * Math.max(1, g.w - 4));
      const ty = 2 + Math.floor(rnd() * Math.max(1, g.h - 4));
      const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
      if (collides(g, x, y, PLAYER_R)) continue;
      const c = tileAt(g, x, y);
      if (c === '!' || c === '~' || c === '%') continue; // not lava / water / void
      if (nearSpawn(x, y)) continue;                      // not in or beside the base
      v.x = x; v.y = y; v.rider = null;
      break;
    }
  }
  g.vehicles = others.concat(keep);
}

// --- ENEMY STRONGHOLDS -----------------------------------------------------
// Seed fortified hostile outposts onto the map, deterministically, when the def
// opts in via def.enemyStrongholds. Accepted forms:
//   def.enemyStrongholds: true | <count>            (auto-place N keeps, N=1)
//   def.enemyStrongholds: { count, garrison, aggro, leash, ring, hpMult }
//   def.enemyStrongholds: [ {at:[tx,ty], garrison, ...}, ... ]  (authored keeps)
// Auto placement walks the four map corners (cornerOpenTile, the same inward
// scan the relic mounts use) in a fixed order, skipping any keep site that would
// land inside STRONGHOLD_AWAY tiles of a player spawn. Every keep gets a
// prebuilt wall ring (with cardinal gaps so the garrison can sortie) and a
// garrison of fresh enemies whose home/leash anchor is the keep center, sharing
// a group id so they wake as one. g.strongholds exposes each keep's center and
// radii for the renderer/minimap and the superweapon phase. Untouched modes
// (no def.enemyStrongholds) never call any of this and stay byte-identical.
function setupStrongholds(g, def) {
  const cfg = def.enemyStrongholds;
  if (!cfg) return; // gated: classic/story/ctf/etc. never seed a keep
  // Strongholds only make sense on non-arcade (big-map survival) layouts where
  // the aggro/leash machinery runs; arcade auto-wakes everything.
  if (g.arcade) return;
  const opts = (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) ? cfg : {};
  const aggro = (opts.aggro || STRONGHOLD_AGGRO);
  const leash = (opts.leash || STRONGHOLD_LEASH);
  const ring = Math.max(1, Math.round(opts.ring || STRONGHOLD_RING));
  const garrisonLetters = String(opts.garrison || STRONGHOLD_GARRISON);
  const shHpMult = opts.hpMult || 1;
  const sp = g.spawns.length ? g.spawns : [{ x: g.w * TILE / 2, y: g.h * TILE / 2 }];
  const awayPx = STRONGHOLD_AWAY * TILE;
  const farFromSpawn = (x, y) => sp.every(s => Math.hypot(x - s.x, y - s.y) >= awayPx);
  // Resolve keep CENTERS in a fixed deterministic order.
  let sites;
  if (Array.isArray(cfg)) {
    sites = cfg.map(s => {
      const tx = s.at ? s.at[0] : Math.floor(g.w / 2);
      const ty = s.at ? s.at[1] : Math.floor(g.h / 2);
      return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, def: s };
    });
  } else {
    // count: opts.count wins; a bare number cfg is the count; cfg===true means 1.
    const rawCount = opts.count ?? (typeof cfg === 'number' ? cfg : 1);
    const want = Math.max(1, Math.min(4, Math.round(Number(rawCount)) || 1));
    // far corners first: order the four corners by distance from the spawn
    // centroid (descending) so a single keep lands opposite the base.
    let cx = 0, cy = 0; for (const s of sp) { cx += s.x; cy += s.y; } cx /= sp.length; cy /= sp.length;
    const corners = [[0, 0], [g.w - 1, 0], [0, g.h - 1], [g.w - 1, g.h - 1]]
      .map(([tx, ty]) => ({ tx, ty, d: Math.hypot((tx + 0.5) * TILE - cx, (ty + 0.5) * TILE - cy) }))
      .sort((a, b) => b.d - a.d || a.tx - b.tx || a.ty - b.ty);
    sites = [];
    for (const c of corners) {
      if (sites.length >= want) break;
      const spot = cornerOpenTile(g, c.tx, c.ty);
      if (!farFromSpawn(spot.x, spot.y)) continue; // never seed atop the base
      sites.push({ x: spot.x, y: spot.y, def: opts });
    }
    // fall back to the farthest corner even if every corner is "near" (tiny
    // maps): a requested keep still seeds rather than silently vanishing.
    if (!sites.length && corners.length) {
      const c = corners[0];
      const spot = cornerOpenTile(g, c.tx, c.ty);
      sites.push({ x: spot.x, y: spot.y, def: opts });
    }
  }
  g.strongholds = [];
  let nextId = g.nextEnemyId || 1000;
  sites.forEach((site, i) => {
    const sd = site.def || {};
    const cAggro = (sd.aggro || aggro);
    const cLeash = (sd.leash || leash);
    const cRing = Math.max(1, Math.round(sd.ring || ring));
    const cHp = sd.hpMult || shHpMult;
    // per-site garrison letters: an authored keep names its own roster, else the
    // shared default; the count derives from the roster length unless overridden.
    const cLetters = String(sd.garrison || garrisonLetters);
    const ctx = Math.round(site.x / TILE - 0.5);
    const cty = Math.round(site.y / TILE - 0.5);
    const cx = (ctx + 0.5) * TILE, cy = (cty + 0.5) * TILE;
    const group = (g._strongholdGroupBase = (g._strongholdGroupBase || 1000) + 1);
    const fortId = 'fort' + i;
    // WALL RING: a square shell of prebuilt walls at Chebyshev distance cRing,
    // with the four cardinal mid-tiles left OPEN as sally gates so the garrison
    // can pour out (and the player can breach in). Skip the keep's own footprint.
    for (let dx = -cRing; dx <= cRing; dx++) {
      for (let dy = -cRing; dy <= cRing; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== cRing) continue; // shell only
        if ((dx === 0 || dy === 0) && Math.abs(dx) + Math.abs(dy) === cRing) continue; // cardinal gates
        const wtx = ctx + dx, wty = cty + dy;
        if (wtx < 1 || wty < 1 || wtx >= g.w - 1 || wty >= g.h - 1) continue;
        const c = g.grid[wty][wtx];
        if (blocksMove(c) || c === '!') continue; // don't stack on terrain blockers
        const wx = (wtx + 0.5) * TILE, wy = (wty + 0.5) * TILE;
        if (collides(g, wx, wy, PLAYER_R)) continue; // skip occupied cells
        g.builds.push({
          x: wx, y: wy, kind: 'wall', cost: 0, progress: 1, paid: 0, built: true,
          hp: STRUCT_HP.wall[0], maxHp: STRUCT_HP.wall[0], cool: 0, evT: 0, level: 1,
          fort: fortId,
        });
      }
    }
    // GARRISON: a cluster seeded on open tiles around the keep, deterministic
    // ring scan (openTileNear, seeded by the keep index). Letter j picks a
    // garrison kind round-robin; the first stationary kind anchors the keep
    // center as its defender, the rest ring it. Every member is re-homed to the
    // keep so the leash measures from the stronghold (see stepEnemy).
    const garrison = [];
    const count = Math.max(1, Math.round(sd.garrisonCount ?? cLetters.length));
    for (let j = 0; j < count; j++) {
      const letter = cLetters[j % cLetters.length] || 'g';
      let spot;
      if (j === 0) spot = { x: cx, y: cy }; // the anchor sits dead-center
      else spot = openTileNear(g, cx, cy, 1, cRing + 1, (i * 7 + j) % 16);
      if (!spot) spot = { x: cx, y: cy };
      const e = makeEnemy(letter, spot.x, spot.y, nextId++);
      // re-home to the keep: home is the keep center, leash measures from here
      e.homeX = cx; e.homeY = cy;
      e.fort = fortId;
      e.aggro = cAggro * TILE;        // stronghold aggro radius (overrides def aggro)
      e.leashR = cLeash * TILE;       // stronghold leash radius (measured from keep)
      e.group = group;                // wake/alert as one garrison
      if (cHp > 1) scaleEnemyHp(cHp, e);
      g.enemies.push(e);
      garrison.push(e.id);
    }
    g.nextEnemyId = nextId;
    g.strongholds.push({
      id: fortId, x: cx, y: cy,
      r: cRing,                        // wall-ring radius (tiles)
      aggro: cAggro, leash: cLeash,    // tiles
      garrison,                        // enemy ids stationed here
      cleared: false,
    });
  });
  if (!g.strongholds.length) delete g.strongholds; // nothing seeded: stay byte-stable
}

function setupMusicBox(g, def) {
  const enabled = !!def.story || def.mode === 'bastion';
  if (!enabled) { g.musicBox = { enabled: false }; return; }
  const { mode, stem } = musicBoxStem(def);
  // spawn cluster centroid (couch parties may have drifted off raw spawns)
  let sx = 0, sy = 0;
  const sp = g.spawns.length ? g.spawns : [{ x: g.w * TILE / 2, y: g.h * TILE / 2 }];
  for (const s of sp) { sx += s.x; sy += s.y; }
  sx /= sp.length; sy /= sp.length;
  // altar: an open tile 3-5 tiles outside the spawn cluster (deterministic
  // ring scan); fall back to the centroid if the whole band is blocked
  const altarSpot = openTileNear(g, sx, sy, 3, 5, 7) || { x: sx, y: sy };
  // four shards at deterministic-random spread spots — one per map quadrant so
  // they stay spread out, but NO LONGER pinned to the exact corners. Open tiles,
  // off lava/water/void, kept out of the base and off the altar. Falls back to
  // the quadrant's corner if a quadrant has no eligible open tile.
  const nm = String(def.key || def.name || def.title || 'lvl');
  let seed = 2166136261; for (let i = 0; i < nm.length; i++) { seed ^= nm.charCodeAt(i); seed = (seed * 16777619) >>> 0; }
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const hw = g.w / 2, hh = g.h / 2;
  const quads = [[0, 0], [1, 0], [0, 1], [1, 1]]; // tl, tr, bl, br — spread coverage
  const fragments = quads.map(([qx, qy], i) => {
    let spot = null;
    for (let tries = 0; tries < 120 && !spot; tries++) {
      const tx = Math.floor(qx * hw + 1 + rnd() * (hw - 2));
      const ty = Math.floor(qy * hh + 1 + rnd() * (hh - 2));
      const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
      if (collides(g, x, y, PLAYER_R)) continue;
      const c = tileAt(g, x, y);
      if (c === '!' || c === '~' || c === '%') continue;                       // off hazards
      if (Math.hypot(x - sx, y - sy) < 8 * TILE) continue;                     // not in the base
      if (Math.hypot(x - altarSpot.x, y - altarSpot.y) < 6 * TILE) continue;   // not on the altar
      spot = { x, y };
    }
    if (!spot) { const cc = cornerOpenTile(g, qx ? g.w - 1 : 0, qy ? g.h - 1 : 0); spot = { x: cc.x, y: cc.y }; }
    return { id: 'mb' + i, x: spot.x, y: spot.y, carrier: null, placed: false };
  });
  g.musicBox = {
    enabled: true, mode, stem,
    altar: { x: altarSpot.x, y: altarSpot.y },
    fragments, assembled: 0, complete: false,
  };
  // STRONGHOLD ONLY: instead of one altar, four relic MOUNTS — clustered at the
  // four DIAGONAL CORNERS OF THE CENTRAL FORTRESS, not the map edges. Anchor to
  // the base/core center (baseCenter) and step out a fixed radius along each
  // diagonal, then snap to the nearest open walkable tile (openTileNear, the
  // same deterministic ring scan stranded ops use). The seed per corner is the
  // fixed diagonal index, so server and every client agree without exchanging
  // setup. A shard carried to ANY unfilled mount locks into it; all four filled
  // completes the relic. The .altar field is KEPT for the horde event's banner
  // coordinates; story keeps its single-altar deposit path untouched (no .mounts).
  if (def.mode === 'bastion') {
    const base = baseCenter(g);
    const RING = 4; // tiles out from the fortress center to each corner mount
    const diag = [[-1, -1], [1, -1], [-1, 1], [1, 1]]; // tl, tr, bl, br
    g.musicBox.mounts = diag.map(([dx, dy], i) => {
      const wx = base.x + dx * RING * TILE, wy = base.y + dy * RING * TILE;
      // snap to the nearest open tile in a tight band around the corner point;
      // fall back outward, then to the corner point itself if all is blocked
      const spot = openTileNear(g, wx, wy, 0, 3, i * 4 + 1)
        || openTileNear(g, wx, wy, 3, 6, i * 4 + 1)
        || { x: wx, y: wy };
      return { x: spot.x, y: spot.y, filled: false };
    });
  }
}

// STRANDED OPERATORS + SCRAP: opt-in via def.stranded (truthy, or an object
// {operators, scrap} for counts). Untouched modes leave both arrays empty so
// snapshot/render gain no key and stay byte-identical. Placement is fully
// deterministic — an FNV-seeded LCG (the exact pattern the music-box shards
// use) walks open tiles away from the base, so server and every client agree
// without exchanging setup. Scrap is a GENERIC item: it never touches the relic
// shard pool (g.shards) or the music-box fragments.
function setupStranded(g, def) {
  const cfg = def.stranded;
  if (!cfg) return; // arrays stay empty: classic/unflagged snapshots unchanged
  const nOps = Math.max(1, (typeof cfg === 'object' && cfg.operators) || 3);
  const nScrap = Math.max(nOps, (typeof cfg === 'object' && cfg.scrap) || nOps + 1);
  const base = baseCenter(g);
  const nm = String(def.key || def.name || def.title || 'lvl') + '#stranded';
  let seed = 2166136261; for (let i = 0; i < nm.length; i++) { seed ^= nm.charCodeAt(i); seed = (seed * 16777619) >>> 0; }
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  // pick an open tile >= 6 tiles off the base (so saved folk have somewhere to
  // be walked back to), off hazards; fall back to a ring scan when the random
  // probe fails so the count is always met.
  const pick = (kSeed, minTiles) => {
    for (let tries = 0; tries < 160; tries++) {
      const tx = 1 + Math.floor(rnd() * (g.w - 2));
      const ty = 1 + Math.floor(rnd() * (g.h - 2));
      const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
      if (collides(g, x, y, STRANDED_R)) continue;
      const c = tileAt(g, x, y);
      if (c === '!' || c === '~' || c === '%') continue;
      if (Math.hypot(x - base.x, y - base.y) < minTiles * TILE) continue;
      return { x, y };
    }
    return openTileNear(g, base.x, base.y, minTiles, minTiles + 8, kSeed) || { x: base.x, y: base.y };
  };
  g.stranded = [];
  for (let i = 0; i < nOps; i++) {
    const s = pick(i * 7 + 3, 6);
    g.stranded.push({ id: 'op' + i, x: s.x, y: s.y, carrier: null, recruited: false });
  }
  g.scrap = [];
  for (let i = 0; i < nScrap; i++) {
    const s = pick(i * 13 + 5, 4);
    g.scrap.push({ id: 'sc' + i, x: s.x, y: s.y, carrier: null });
  }
  g.nextScrapId = nScrap;
}

function spawnPlayer(pid, name, charId, x, y) {
  return {
    pid, name, charId, x, y, fx: 0, fy: -1, cool: 0, state: 'active', respawn: 0, invuln: 3,
    specialCool: 0, dashT: 0, dashFx: 0, dashFy: -1, stimT: 0, actPrev: false, specialPrev: false,
    itemPrev: false,
  };
}

function tileAt(g, x, y) {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) return '#';
  return g.grid[ty][tx];
}

// Trees block movement (and sight); water and sandbags block movement only.
// New floor letters (',' ':' ';' '_') and the campfire '*' are all passable.
// '%' VOID (shattered-shard abyss) blocks movement, sight and shots alike.
// '=' sand, '!' lava and '^' ice are passable terrain (with their own rules).
function blocksMove(c) { return c === '#' || c === 'T' || c === '~' || c === 'o' || c === '%'; }

// Swimmers (char.swims, the seal) treat water as open ground — everything
// else that blocks movement still blocks them.
function blocksMoveSwim(c) { return c === '#' || c === 'T' || c === 'o' || c === '%'; }

// Pathing-only blocker: lava is physically walkable but enemies route AROUND
// it — both the straight-line steering check and the A* grid treat '!' as
// blocked, so a burning enemy is one knocked back, spawned in, or cornered.
function blocksPath(c) { return blocksMove(c) || c === '!'; }

// Terrain + weather speed: sand drags everyone to x0.85, ice skates at x1.05
// (drift momentum rides separately), snowfall slows every entity to x0.92.
// Plain floors under clear skies multiply by 1 — classics are untouched.
function moveMult(g, x, y) {
  let m = g.weather === 'snow' ? SNOW_SLOW : 1;
  const t = tileAt(g, x, y);
  if (t === '=') m *= SAND_SLOW;
  else if (t === '^') m *= ICE_FAST;
  return m;
}

// A closed door covers its tile rect like rock: movement, sight, shots and
// A* all stop at it. Maps without doors pay one length check and move on.
function doorBlocksPx(g, x, y) {
  if (!g.doors || !g.doors.length) return false;
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  for (const d of g.doors) {
    if (!d.open && tx >= d.x && tx < d.x + d.w && ty >= d.y && ty < d.y + d.h) return true;
  }
  return false;
}

function collides(g, x, y, r) {
  for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
    if (blocksMove(tileAt(g, x + ox, y + oy))) return true;
    if (doorBlocksPx(g, x + ox, y + oy)) return true;
  }
  // Built structures (pylons, barricades, turrets) block players and enemies.
  // A* ignores them on purpose so enemies bump into them and gnaw them down.
  // Farms are walkable plots — anything can cross (and trample) them.
  if (g.builds) {
    for (const b of g.builds) {
      if (!b.built || b.kind === 'farm') continue;
      const dx = x - b.x, dy = y - b.y;
      const rr = BUILD_RADIUS + r;
      if (dx * dx + dy * dy < rr * rr) return true;
    }
  }
  // A live relic superweapon (building/charging/ready) is a solid obstacle —
  // gated on g.superweapon, so every untouched mode short-circuits here.
  const sw = g.superweapon;
  if (sw && sw.state !== 'spent' && sw.state !== 'wrecked') {
    const dx = x - sw.x, dy = y - sw.y, rr = BUILD_RADIUS + r;
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  return false;
}

// Like collides, but escape-friendly for build circles: a structure completing
// around someone must never entomb them — moves that increase distance from
// the structure's center are always allowed, only inward moves are blocked.
function moveBlocked(g, fromX, fromY, x, y, r, blocks = blocksMove) {
  for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
    if (blocks(tileAt(g, x + ox, y + oy))) return true;
    // closed doors only ever OPEN (never close on someone), so a plain
    // block needs no escape-friendly carve-out
    if (doorBlocksPx(g, x + ox, y + oy)) return true;
  }
  if (g.builds) {
    for (const b of g.builds) {
      if (!b.built || b.kind === 'farm') continue;
      const dx = x - b.x, dy = y - b.y;
      const rr = BUILD_RADIUS + r;
      if (dx * dx + dy * dy < rr * rr) {
        const fx = fromX - b.x, fy = fromY - b.y;
        if (dx * dx + dy * dy < fx * fx + fy * fy) return true;
      }
    }
  }
  return false;
}

function moveCircle(g, e, dx, dy, r, blocks = blocksMove) {
  if (dx && !moveBlocked(g, e.x, e.y, e.x + dx, e.y, r, blocks)) e.x += dx;
  if (dy && !moveBlocked(g, e.x, e.y, e.x, e.y + dy, r, blocks)) e.y += dy;
}

function dist2(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function norm(dx, dy) {
  const d = Math.hypot(dx, dy) || 1;
  return [dx / d, dy / d, d];
}

// Sight stops at rock, trees and the void — shots fly over water and
// sandbags, so enemies must be able to see (and shoot) across those too.
function blocksSight(c) { return c === '#' || c === 'T' || c === '%'; }

// True when the straight segment between two points crosses no blocking tile.
function hasLoS(g, ax, ay, bx, by, blocks = blocksMove) {
  const dx = bx - ax, dy = by - ay;
  const d = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(d / (TILE / 3)));
  for (let i = 1; i < steps; i++) {
    const px = ax + (dx * i) / steps;
    const py = ay + (dy * i) / steps;
    if (blocks(tileAt(g, px, py))) return false;
    if (doorBlocksPx(g, px, py)) return false; // closed doors stop sight too
  }
  return true;
}

// In the dark, enemy sight is additionally capped at 8 tiles regardless of
// line of sight. Lit levels are untouched.
const DARK_SIGHT_TILES = 8;

function canSee(g, e, tgt) {
  if (g.dark && dist2(e, tgt) > (TILE * DARK_SIGHT_TILES) ** 2) return false;
  // fog banks and ashstorms cap ALL sight at 9 tiles, dark or lit
  if ((g.weather === 'fog' || g.weather === 'ashstorm')
      && dist2(e, tgt) > (TILE * WEATHER_SIGHT_TILES) ** 2) return false;
  return hasLoS(g, e.x, e.y, tgt.x, tgt.y, blocksSight);
}

// Per-game cache of door/structure blocked tiles for the A* hot loop —
// tileBlocked runs per neighbor per expansion (millions of hits per defended
// siege tick), and linear scans over 100+ builds were most of that bill.
// Keyed off buildEpoch + door states; lives OUTSIDE the game object so saves
// and snapshots never see it (WeakMap: dropped with the game). Deterministic:
// a pure function of state the sim already tracks.
const blockMaskCache = new WeakMap();
function buildBlockMask(g) {
  let c = blockMaskCache.get(g);
  const doorsKey = g.doors && g.doors.length ? g.doors.reduce((n, d, i) => n + (d.open ? 0 : i + 1), 0) : 0;
  const epoch = (g.buildEpoch || 0);
  if (!c || c.epoch !== epoch || c.doorsKey !== doorsKey) {
    const mask = c && c.mask.length === g.w * g.h ? c.mask.fill(0) : new Uint8Array(g.w * g.h);
    if (g.doors) {
      for (const d of g.doors) {
        if (d.open) continue;
        for (let y = d.y; y < d.y + d.h; y++) {
          for (let x = d.x; x < d.x + d.w; x++) {
            if (x >= 0 && y >= 0 && x < g.w && y < g.h) mask[y * g.w + x] = 1;
          }
        }
      }
    }
    if (g.builds) {
      for (const b of g.builds) {
        if (!b.built || b.kind === 'farm') continue;
        const tx = Math.floor(b.x / TILE), ty = Math.floor(b.y / TILE);
        if (tx >= 0 && ty >= 0 && tx < g.w && ty < g.h) mask[ty * g.w + tx] = 1;
      }
    }
    c = { epoch, doorsKey, mask };
    blockMaskCache.set(g, c);
  }
  return c.mask;
}

function tileBlocked(g, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) return true;
  // lava is walkable but never PATHED through: A* routes around the flows
  if (blocksPath(g.grid[ty][tx])) return true;
  // A* respects closed doors exactly like rock (they reopen the route later)
  // and routes around built structures instead of funneling chasers into them
  return buildBlockMask(g)[ty * g.w + tx] === 1;
}

// True when the straight segment passes through a built structure's circle —
// straight-line steering must fall back to A* in that case or enemies wedge
// against pylons forever.
function segmentHitsBuild(g, ax, ay, bx, by, r) {
  if (!g.builds) return false;
  for (const b of g.builds) {
    if (!b.built || b.kind === 'farm') continue;
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy || 1;
    let t = ((b.x - ax) * dx + (b.y - ay) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t, py = ay + dy * t;
    const rr = BUILD_RADIUS + r;
    if ((px - b.x) ** 2 + (py - b.y) ** 2 < rr * rr) return true;
  }
  return false;
}

// Deterministic A* over the tile grid. Diagonals allowed unless they cut a corner.
// Returns pixel-space waypoints (excluding the start tile), or null when no route
// exists within the expansion budget. adjacentOk targets a BLOCKED goal tile
// (a built structure): the search succeeds on any tile touching it.
// gScore/came live in module-level generation-stamped typed arrays — failing
// XL-map searches expand thousands of nodes, and Map get/set was the single
// hottest line of a defended-siege tick (p99 was ~90ms; this is ~5x cheaper).
// Single-threaded sim, no reentrancy; identical scores, so determinism holds.
let pfSize = 0;
let pfGen = 0;
let pfG = null;     // gScore per tile
let pfStamp = null; // generation stamp: stale entries read as Infinity
let pfCame = null;  // predecessor tile key
function findPath(g, sx, sy, gx, gy, maxExpand = 2400, adjacentOk = false) {
  if (sx === gx && sy === gy) return [];
  if (adjacentOk && Math.abs(sx - gx) <= 1 && Math.abs(sy - gy) <= 1) return [];
  if (tileBlocked(g, gx, gy) && !adjacentOk) return null;
  const W = g.w;
  const cells = g.w * g.h;
  if (pfSize < cells) {
    pfSize = cells;
    pfG = new Float64Array(cells);
    pfStamp = new Int32Array(cells);
    pfCame = new Int32Array(cells);
  }
  pfGen++;
  if (pfGen >= 2147483647) { pfGen = 1; pfStamp.fill(0); }
  const heap = [];
  let seq = 0;
  const push = n => {
    heap.push(n);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].f < n.f || (heap[p].f === n.f && heap[p].seq < n.seq)) break;
      heap[i] = heap[p]; i = p;
    }
    heap[i] = n;
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && (heap[l].f < last.f || (heap[l].f === last.f && heap[l].seq < last.seq))) m = l;
        const mb = m === i ? last : heap[m];
        if (r < heap.length && (heap[r].f < mb.f || (heap[r].f === mb.f && heap[r].seq < mb.seq))) m = r;
        if (m === i) break;
        heap[i] = heap[m]; i = m;
      }
      heap[i] = last;
    }
    return top;
  };
  const oct = (x, y) => {
    const ax = Math.abs(x - gx), ay = Math.abs(y - gy);
    return ax + ay - 0.5858 * Math.min(ax, ay);
  };
  const start = sy * W + sx;
  pfG[start] = 0;
  pfStamp[start] = pfGen;
  push({ x: sx, y: sy, f: oct(sx, sy), seq: seq++ });
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let expanded = 0;
  while (heap.length && expanded < maxExpand) {
    const cur = pop();
    const ck = cur.y * W + cur.x;
    expanded++;
    if ((cur.x === gx && cur.y === gy)
        || (adjacentOk && Math.abs(cur.x - gx) <= 1 && Math.abs(cur.y - gy) <= 1)) {
      const path = [];
      let k = ck;
      while (k !== start) {
        path.push({ x: (k % W + 0.5) * TILE, y: (Math.floor(k / W) + 0.5) * TILE });
        k = pfCame[k];
      }
      return path.reverse();
    }
    const cg = pfG[ck];
    for (const [dx, dy] of DIRS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (tileBlocked(g, nx, ny)) continue;
      if (dx && dy && (tileBlocked(g, cur.x + dx, cur.y) || tileBlocked(g, cur.x, cur.y + dy))) continue;
      const nk = ny * W + nx;
      const ng = cg + (dx && dy ? 1.4142 : 1);
      if (ng < (pfStamp[nk] === pfGen ? pfG[nk] : Infinity)) {
        pfG[nk] = ng;
        pfStamp[nk] = pfGen;
        pfCame[nk] = ck;
        push({ x: nx, y: ny, f: ng + oct(nx, ny), seq: seq++ });
      }
    }
  }
  return null;
}

function wakeEnemy(g, e, ripple = true) {
  if (e.dead || e.awake) return;
  e.awake = true;
  // fresh chase: forget any stuck-tracking left from a previous engagement
  e.stuckX = undefined;
  e.stuckY = undefined;
  e.chaseStuckT = 0;
  e.chaseKicked = false;
  g.events.push({ type: 'alert', x: e.x, y: e.y, kind: e.kind });
  if (ripple) {
    const r2 = (TILE * ALERT_RIPPLE) ** 2;
    for (const o of g.enemies) {
      if (!o.awake && !o.dead && dist2(e, o) < r2) wakeEnemy(g, o, false);
    }
  }
}

// Steer toward the target: straight when walkable in a straight line,
// A* waypoints when not. A failed search respects the repath cooldown so a
// stranded enemy can't burn a full A* budget every tick.
function moveToward(g, e, tgt, dt, speed = e.speed, r = ENEMY_R) {
  // terrain underfoot scales the stride (sand x0.85, ice x1.05, snow x0.92)
  speed *= moveMult(g, e.x, e.y);
  // straight-line steering is lava-aware (blocksPath): a clear line through a
  // flow is no line at all — the A* fallback below routes around it.
  // BIG MAPS ONLY: a chaser kicked by the anti-wedge below stays OFF the
  // straight line until it truly moves again — a zero-width clear ray can
  // corner-pin a radius-r body (ray clear, both move axes blocked) and the
  // ray flickers clear/blocked as the body see-saws ~1px on the corner, so
  // the straight-line branch and the A* branch live-lock each other forever.
  // Arcade keeps the original branch unconditionally (classic fidelity).
  if ((g.arcade || !e.chaseKicked)
      && hasLoS(g, e.x, e.y, tgt.x, tgt.y, blocksPath) && !segmentHitsBuild(g, e.x, e.y, tgt.x, tgt.y, r)) {
    e.path = null;
    e.repathT = 0;
    e.pathFailed = false; // a clear line is a route: the goal is reachable
    if (g.arcade) {
      // classic behavior, byte-identical: a clear line resets the tracker
      // and skips it entirely this tick
      e.stuckX = undefined;
      e.stuckY = undefined;
      e.chaseStuckT = 0;
      e.chaseKicked = false;
      const [afx, afy] = norm(tgt.x - e.x, tgt.y - e.y);
      e.fx = afx; e.fy = afy;
      moveCircle(g, e, afx * speed * dt, afy * speed * dt, r);
      return;
    }
    const [fx, fy] = norm(tgt.x - e.x, tgt.y - e.y);
    e.fx = fx; e.fy = fy;
    moveCircle(g, e, fx * speed * dt, fy * speed * dt, r);
  } else {
    e.repathT -= dt;
    if (e.repathT <= 0 || (e.path && e.pathI >= e.path.length)) {
      if (!g.arcade && !(g.pathBudget > 0)) {
        // global per-tick A* budget spent: keep the stale path (or the bare
        // bearing) one short cycle and ask again next tick
        e.repathT = 0.1;
      } else {
        if (!g.arcade) g.pathBudget--;
        // Core-marching night waves and x100-aggro hunters cross the whole map;
        // the stock 2400 budget exhausts on long detours and they wedge at the
        // first wall — give them a deep search instead.
        const budget = (e.targetCore || e.aggro >= TILE * 100) ? 8000 : 2400;
        e.path = findPath(
          g,
          Math.floor(e.x / TILE), Math.floor(e.y / TILE),
          Math.floor(tgt.x / TILE), Math.floor(tgt.y / TILE),
          budget,
          !!tgt.adj // gnaw targets sit on blocked tiles: stop beside them
        );
        e.pathI = 0;
        e.repathT = 0.6 + (e.id % 5) * 0.08;
        // an exhausted search marks the goal sealed (core-marchers retarget the
        // blocking structure in nearestTarget rather than pinning on a corner)
        e.pathFailed = !e.path;
        if (!g.arcade) {
          if (e.path) e.pathFails = 0;
          else {
            // cache the failed verdict ~2.5s — re-searching an unreachable
            // goal every 0.6s is the siege-tick CPU bill — and after 3
            // consecutive total failures go dormant until the world changes
            // (stepEnemy wakes on buildEpoch/door change, player proximity
            // or damage)
            e.repathT = 2.4 + (e.id % 5) * 0.12;
            e.pathFails = (e.pathFails || 0) + 1;
            if (e.pathFails >= 3 && !e.returning) {
              e.dormant = true;
              e.dormantEpoch = g.buildEpoch || 0;
            }
          }
        }
      }
    }
    let wp = e.path && e.path[e.pathI];
    while (wp && Math.hypot(wp.x - e.x, wp.y - e.y) < TILE * 0.45) {
      e.pathI++;
      wp = e.path[e.pathI];
    }
    const aim = wp || tgt;
    const [fx, fy] = norm(aim.x - e.x, aim.y - e.y);
    e.fx = fx; e.fy = fy;
    moveCircle(g, e, fx * speed * dt, fy * speed * dt, r);
  }
  // Anti-wedge (chasers only — returning home has its own giveup in
  // stepEnemy): a chaser that has not MOVED in 3s is wedged. Progress is
  // measured positionally, not by distance-to-target — a legitimate long
  // detour walks AWAY from the target for a while and must never trip this.
  // Big maps run it across BOTH branches with a 4px bar (corner-pin see-saw
  // jitter reaches ~2px; the slowest real walker still clears 30px in 3s);
  // arcade keeps the original 0.5px A*-branch-only semantics above.
  // First trip forces a repath (path cleared, cooldown zeroed) and parks the
  // chaser on A* steering until it truly moves; still pinned 3s after the
  // kick, it gives up and re-sleeps exactly like the returning giveup.
  // Never teleport — determinism would survive it, feel would not.
  if (!e.returning) {
    const eps = g.arcade ? 0.5 : 4;
    // A kicked chaser hands the wheel back to straight-line steering only
    // once it has GENUINELY escaped the pin — over half a tile from where
    // the kick fired. The 4px tracker reset alone would re-enable the very
    // ray that pinned it (climb 4px up the corner, slide 4px back, forever).
    if (e.chaseKicked && !g.arcade
        && Math.hypot(e.x - (e.kickX ?? e.x), e.y - (e.kickY ?? e.y)) > TILE * 0.6) {
      e.chaseKicked = false;
    }
    if (e.stuckX === undefined || Math.hypot(e.x - e.stuckX, e.y - e.stuckY) > eps) {
      e.stuckX = e.x;
      e.stuckY = e.y;
      e.chaseStuckT = 0;
      if (g.arcade) e.chaseKicked = false; // classic reset semantics
    } else {
      e.chaseStuckT = (e.chaseStuckT || 0) + dt;
      if (!e.chaseKicked && e.chaseStuckT >= 3) {
        e.chaseKicked = true;
        e.kickX = e.x;
        e.kickY = e.y;
        e.path = null;
        e.repathT = 0;
      } else if (e.chaseKicked && e.chaseStuckT >= 6) {
        e.awake = false;
        e.returning = false;
        e.stuckX = undefined;
        e.stuckY = undefined;
        e.chaseStuckT = 0;
        e.chaseKicked = false;
      }
    }
  }
}

function countNear(g, e, r) {
  const r2 = r * r;
  let n = 0;
  for (const o of g.enemies) if (!o.dead && dist2(e, o) < r2) n++;
  return n;
}

// On big maps, respawn beside a living teammate instead of trekking back from
// the level start. Deterministic: first active player in pid order, nearest
// open tile in ring-scan order.
function respawnSpot(g) {
  const fallback = g.spawns[0] || { x: TILE * 2, y: TILE * 2 };
  if (g.arcade) return fallback;
  const ally = g.players.find(q => q.state === 'active');
  if (!ally) return fallback;
  for (let r = 1; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = ally.x + dx * TILE, y = ally.y + dy * TILE;
        if (x > TILE && y > TILE && x < (g.w - 1) * TILE && y < (g.h - 1) * TILE && !collides(g, x, y, PLAYER_R)) {
          return { x, y };
        }
      }
    }
  }
  // The ally's own spot is only safe when a walker can stand there — a seal
  // swimming mid-lake would strand a non-swimmer on '~' forever. Collision on
  // the ally's position sends the respawn back to the level start instead.
  if (collides(g, ally.x, ally.y, PLAYER_R)) return fallback;
  return { x: ally.x, y: ally.y };
}

// --- ctf team spawn rings ----------------------------------------------------
// 16v16 needs 16 unstuck spawners per base, so CTF seats deploy AROUND their
// team's flag stand on deterministic ring offsets instead of stacking on the
// stand point. Three fixed candidate rings (8/16/16 slots at 1.25/2.25/3.25
// tiles, angles stepped clockwise from due north) are filtered to spots a
// walker can stand on (collides: rock/trees/water/void/doors/structures —
// nobody deploys overlap-stuck in a wall), then seat k takes the k-th open
// slot. k is the player's index among its OWN team in players order — stable,
// because seats only ever append. More seats than open slots wraps (an overlap
// beats a wall); a fully blocked neighborhood falls back to the stand itself
// (the pre-ring behavior). No RNG, no clock: the same field state always
// yields the same spot, so replays and save/restore twins stay byte-exact.
const CTF_RINGS = [[8, 1.25], [16, 2.25], [16, 3.25]];
function ctfStandSpot(g, p) {
  const stand = g.flags.find(f => f.team === p.team);
  if (!stand) {
    const s = g.spawns[0] || { x: TILE * 2, y: TILE * 2 };
    return { x: s.x, y: s.y };
  }
  let k = 0;
  for (const q of g.players) {
    if (q.pid === p.pid) break;
    if (q.team === p.team) k++;
  }
  const open = [];
  for (const [n, r] of CTF_RINGS) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
      const x = stand.homeX + Math.cos(a) * r * TILE;
      const y = stand.homeY + Math.sin(a) * r * TILE;
      if (x > TILE && y > TILE && x < (g.w - 1) * TILE && y < (g.h - 1) * TILE && !collides(g, x, y, PLAYER_R)) {
        open.push({ x, y });
      }
    }
  }
  if (!open.length) return { x: stand.homeX, y: stand.homeY };
  return open[k % open.length];
}

// --- Anchor Siege: spawn ring, minion waves, lane march, tower fire ---------
function siegeFoe(team) { return team === 0 ? 1 : 0; }
// a team's core is only attackable once ALL of that team's towers have fallen
function siegeCoreOpen(g, team) { return !g.siegeTowers.some(t => !t.destroyed && t.team === team); }
function siegeSpawnSpot(g, p) {
  const core = (g.cores || []).find(c => c.team === p.team) || (g.cores || [])[0];
  if (!core) { const s = g.spawns[0] || { x: TILE * 2, y: TILE * 2 }; return { x: s.x, y: s.y }; }
  let k = 0;
  for (const q of g.players) { if (q.pid === p.pid) break; if (q.team === p.team) k++; }
  const open = [];
  for (const [n, r] of CTF_RINGS) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
      const x = core.x + Math.cos(a) * r * TILE, y = core.y + Math.sin(a) * r * TILE;
      if (x > TILE && y > TILE && x < (g.w - 1) * TILE && y < (g.h - 1) * TILE && !collides(g, x, y, PLAYER_R)) open.push({ x, y });
    }
  }
  return open.length ? open[k % open.length] : { x: core.x, y: core.y };
}
function spawnSiegeWave(g, team) {
  const S = g.siege;
  if (!S.lanes.length) return;
  const laneI = S.waveNo[team] % S.lanes.length;
  const wps = (team === 0 ? S.lanes[laneI] : S.lanesRev[laneI]).waypoints;
  if (!wps.length) { S.waveNo[team]++; return; }
  const live = S.minions.reduce((n, m) => n + (m.team === team ? 1 : 0), 0);
  const want = S.waveBase + Math.min(6, Math.floor(g.elapsed / 60) * S.wavePerMin);
  const count = Math.max(0, Math.min(S.cap - live, want));
  const start = wps[0];
  for (let i = 0; i < count; i++) {
    S.minions.push({ id: S.nextMinionId++, team, laneI,
      x: start.x + ((i % 3) - 1) * TILE * 0.45, y: start.y + (Math.floor(i / 3) - 1) * TILE * 0.45,
      hp: MINION_HP, maxHp: MINION_HP, pathIdx: 1, score: MINION_SCORE });
  }
  S.waveNo[team]++;
  g.events.push({ type: 'siegeWave', team, count, x: start.x, y: start.y });
}
function stepSiegeWaves(g, dt) {
  const S = g.siege; if (!S) return;
  for (let team = 0; team < 2; team++) {
    S.spawnT[team] -= dt;
    if (S.spawnT[team] <= 0) { spawnSiegeWave(g, team); S.spawnT[team] = S.interval; }
  }
}
function stepSiegeMinions(g, dt) {
  const S = g.siege; if (!S) return;
  for (let i = S.minions.length - 1; i >= 0; i--) {
    const m = S.minions[i];
    const foe = siegeFoe(m.team);
    let gnawing = false;
    // STOP and chew an enemy tower in reach (so a wave actually breaks a tower)
    for (const t of g.siegeTowers) {
      if (t.destroyed || t.team !== foe) continue;
      if (dist2(m, t) < (TILE * 0.9) ** 2) { t.hp -= MINION_TOWER_DPS * dt; if (t.hp <= 0) siegeTowerDown(g, t, null); gnawing = true; break; }
    }
    // once that team's towers are down, the core is exposed — chew it
    if (!gnawing && siegeCoreOpen(g, foe)) for (const c of g.cores) {
      if (c.team !== foe || c.hp <= 0) continue;
      // DEV core integrity: minion still stalls on the core, but deals no damage
      if (dist2(m, c) < SIEGE_CORE_R ** 2) { if (!(g.cheats && g.cheats.coreInvuln)) c.hp = Math.max(0, c.hp - MINION_CORE_DPS * dt); gnawing = true; break; }
    }
    if (gnawing) continue; // hold position while chewing
    // otherwise march along the lane toward the enemy core
    const lane = m.team === 0 ? S.lanes[m.laneI] : S.lanesRev[m.laneI];
    const wps = lane ? lane.waypoints : null;
    if (wps && wps.length) {
      const wp = wps[Math.min(m.pathIdx, wps.length - 1)];
      const dx = wp.x - m.x, dy = wp.y - m.y;
      if (Math.hypot(dx, dy) < TILE * 0.5 && m.pathIdx < wps.length - 1) m.pathIdx++;
      const [nx, ny] = norm(dx, dy);
      m.x += nx * MINION_SPEED * TILE * dt;
      m.y += ny * MINION_SPEED * TILE * dt;
    }
  }
}
function stepSiegeTowers(g, dt) {
  if (!g.siege) return;
  for (const t of g.siegeTowers) {
    if (t.destroyed) continue;
    t.cool -= dt;
    if (t.cool > 0) continue;
    const foe = siegeFoe(t.team);
    const R = SIEGE_TOWER_RANGE[t.level - 1] * TILE;
    let tgt = null, best = R * R;
    for (const m of g.siege.minions) {
      if (m.team !== foe) continue;
      const d = dist2(t, m);
      if (d < best) { best = d; tgt = m; }
    }
    if (tgt) {
      fireWeapon(g, { x: t.x, y: t.y, fx: 0, fy: -1, team: t.team },
        { kind: 'turret', damage: SIEGE_TOWER_DMG[t.level - 1], projSpeed: 10, range: SIEGE_TOWER_RANGE[t.level - 1] + 0.5, count: 1 }, 'siege', tgt);
      t.cool = SIEGE_TOWER_PERIOD;
    }
  }
}
function damageMinion(g, m, dmg, killerPid) {
  m.hp -= dmg;
  if (m.hp <= 0) killMinion(g, m, killerPid);
  else g.events.push({ type: 'hit', x: m.x, y: m.y, kind: 'minion' });
}
function killMinion(g, m, killerPid) {
  const i = g.siege.minions.indexOf(m);
  if (i < 0) return;
  g.siege.minions.splice(i, 1);
  g.events.push({ type: 'die', x: m.x, y: m.y, kind: 'minion', team: m.team, points: 0 });
  const killer = killerPid != null ? g.players.find(p => p.pid === killerPid) : null;
  if (killer) { addShards(g, killer, 1); awardXp(g, killer.pid, m); killer.kills = (killer.kills || 0) + 1; g.kills++; }
}
function siegeTowerDown(g, t, killerPid) {
  if (t.destroyed) return;
  t.destroyed = true; t.hp = 0;
  g.events.push({ type: 'towerDown', x: t.x, y: t.y, team: t.team });
  const killer = killerPid != null ? g.players.find(p => p.pid === killerPid) : null;
  if (killer) { addShards(g, killer, SIEGE_TOWER_REWARD); awardXp(g, killer.pid, { score: 50 }); }
}
function damageTower(g, t, dmg, killerPid) {
  if (t.destroyed) return;
  t.hp -= dmg;
  if (t.hp <= 0) siegeTowerDown(g, t, killerPid);
  else g.events.push({ type: 'buildHit', x: t.x, y: t.y });
}

function fireWeapon(g, shooter, weapon, who, target = null) {
  const [fx, fy] = target ? norm(target.x - shooter.x, target.y - shooter.y) : [shooter.fx, shooter.fy];
  const base = Math.atan2(fy, fx);
  const n = weapon.count || 1;
  const spread = ((weapon.spreadDeg || 0) * Math.PI) / 180;
  const speed = Math.max(0.1, weapon.projSpeed || 8) * TILE;
  const ttl = ((weapon.range ?? 5) * TILE) / speed;
  const pierce = weapon.pierce === true ? 99 : (weapon.pierce || 0);
  const aoeRadius = (weapon.aoeRadius || 0) * TILE;
  for (let i = 0; i < n; i++) {
    // full rings space shots by spread/n (spread/(n-1) would duplicate the
    // rear shot and leave a gap along the facing direction)
    const fullRing = spread >= Math.PI * 2 - 1e-6;
    const a = n === 1 ? base
      : fullRing ? base + (spread * i) / n
      : base - spread / 2 + (spread * i) / (n - 1);
    const curve = (weapon.curve || 0) * (n > 1 && i % 2 ? -1 : 1);
    g.shots.push({
      id: g.nextShotId++,
      x: shooter.x + Math.cos(a) * (PLAYER_R + 4),
      y: shooter.y + Math.sin(a) * (PLAYER_R + 4),
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      ttl,
      // weapon tokens (chest/shop loot) raise all of a player's outgoing
      // damage; nobody else carries dmgBonus so +0 leaves classics untouched
      dmg: weapon.damage + (shooter.dmgBonus || 0),
      who,
      overWalls: !!weapon.overWalls,
      pierce,
      aoeRadius,
      curve,
      radius: weapon.radius || SHOT_R,
      kind: weapon.kind || weapon.name || 'shot',
      // pvp bookkeeping: who fired, and for which team (friendly fire is off)
      pid: shooter.pid,
      team: shooter.team,
      // xp bookkeeping: kill credit flows to this seat. Turrets, followers
      // and mind-controlled enemies carry no pid, so their kills pay nobody.
      ownerPid: shooter.pid,
      // evolution payloads (status effects ride the shot; absent on classics)
      ...(weapon.stun ? { stun: weapon.stun } : {}),
      ...(weapon.ignite ? { ignite: true } : {}),
      ...(weapon.ignitePatch ? { ignitePatch: true } : {}),
      ...(weapon.shockArc ? { shockArc: true } : {}),
      ...(weapon.knockback ? { knockback: weapon.knockback } : {}),
      // volt wraith zap: roots the struck operative (shield pips absorb it)
      ...(weapon.stunPlayer ? { stunPlayer: weapon.stunPlayer } : {}),
      hits: [],
    });
  }
  g.events.push({ type: 'shoot', x: shooter.x, y: shooter.y, who, weapon: weapon.kind || weapon.name || 'shot' });
}

// --- on-the-spot leveling: weapon evolutions -------------------------------
// L3 unlocks the character's evolution (char.evolution in characters.json);
// L4 intensifies it. Applied at FIRE time to a clone — character defs are
// shared across games and must never mutate. Evolutions cover the main weapon
// AND weapon-kind specials; shop dmgBonus stacks separately in fireWeapon.
function applyEvolution(weapon, evo, level) {
  if (!level || level < 3) return weapon;
  evo = evo || 'multi';
  const w = { ...weapon };
  if (evo === 'multi') {
    const base = w.count || 1;
    w.count = base + (level >= 4 ? 2 : 1); // L3 +1 shot, L4 another +1
    if (base === 1) w.spreadDeg = (w.spreadDeg || 0) + 6; // single-shots fan out
  } else if (evo === 'blast') {
    w.aoeRadius = (w.aoeRadius || 0) + 0.6 + (level >= 4 ? 0.5 : 0);
    if (level >= 4) w.pierce = Math.max(w.pierce === true ? 99 : (w.pierce || 0), 1);
  } else if (evo === 'shock') {
    w.stun = STUN_T; // hits stun
    if (level >= 4) w.shockArc = true; // arc to the nearest enemy within 2 tiles
  } else if (evo === 'burn') {
    w.ignite = true; // hits ignite
    if (level >= 4) w.ignitePatch = true; // ignited enemies leave a death patch
  }
  return w;
}

// Grant xp to one seat and resolve any level-ups it unlocks.
// Levels 2..4 land at 12/34/70 xp — automatic, deterministic, evented.
function grantXp(g, p, amount) {
  p.xp += amount;
  while (p.level < 4 && p.xp >= XP_THRESH[p.level - 1]) {
    p.level++;
    let perk = 'hp';
    if (p.level === 2) {
      p.maxHp += 1; // L2: +1 max hp, and heal 1 on the spot
      p.hp = Math.min(p.maxHp, p.hp + 1);
    } else {
      perk = (g.charMap[p.charId] || {}).evolution || 'multi';
    }
    g.events.push({ type: 'levelUp', pid: p.pid, level: p.level, perk, x: p.x, y: p.y });
  }
}

// Kill credit: the owning seat's fielded character earns score/25 xp. Squad
// assist: every OTHER active seat within 8 tiles of the killer earns
// floor(half) — short-range characters keep leveling in a full couch.
// Solo play is untouched (no other seats to pay).
function awardXp(g, pid, e) {
  if (pid === undefined || pid === null) return;
  const p = g.players.find(q => q.pid === pid);
  if (!p || p.level === undefined) return; // arcade seats never level
  const xp = (e.score || 100) / XP_DIV;
  grantXp(g, p, xp);
  const assist = Math.floor(xp / 2);
  if (assist > 0) {
    const r2 = (TILE * SQUAD_ASSIST_R) ** 2;
    for (const q of g.players) {
      if (q === p || q.state !== 'active' || q.level === undefined) continue;
      if (dist2(p, q) <= r2) grantXp(g, q, assist);
    }
  }
}

// DEV "max out": bring one seat to the top of the per-mission progression — full
// level (4), every level-up perk applied (the +1 maxHp at L2, the L3/L4 weapon
// evolution that fireWeapon reads off p.level), and topped-up hp. Routes through
// grantXp so the level-up climb (and its events) is identical to an earned one.
// No-op on arcade seats (1-hit classic players carry no p.level field) and on
// seats already maxed. Exported so the solo dev cheat menu can invoke it.
export function maxOutPlayer(g, pid) {
  const p = g.players.find(q => q.pid === pid);
  if (!p || p.level === undefined) return; // arcade seats never level
  if (p.level < 4) {
    // grant enough xp to cross every remaining threshold in one resolve; the
    // grantXp loop caps at level 4, so this lands exactly at the top.
    grantXp(g, p, XP_THRESH[XP_THRESH.length - 1] + 1);
  }
  p.hp = p.maxHp; // arrive at full health, like any fresh evolution would want
}

// --- status effects --------------------------------------------------------
// Ignite: 1 dmg/s for 3s. Fresh ignitions reset the tick clock; re-touching
// fire pins the timer at 3. patchFlag marks L4-burn ignitions whose corpse
// leaves a ground burn patch.
function igniteEnemy(g, e, owner, patchFlag = false) {
  if (e.dead) return;
  if (!(e.burnT > 0)) { e.burnTick = 0; e.burnOwner = owner; }
  e.burnT = Math.max(e.burnT || 0, BURN_T);
  if (patchFlag) e.burnPatch = true;
}

// Toxin: 0.5 dmg/s for 2s, same shape as ignite.
function toxEnemy(g, e, owner) {
  if (e.dead) return;
  if (!(e.toxT > 0)) { e.toxTick = 0; e.toxOwner = owner; }
  e.toxT = Math.max(e.toxT || 0, TOX_T);
}

function enemyWeapon(kind) {
  if (kind === 'sniper') return { kind: 'sniper', damage: 1, projSpeed: 12, range: 11, cooldown: 0, count: 1 };
  // volt wraith chain-zap: 1 dmg + a 0.3s root on ONE operative; a shield
  // pip absorbs the whole zap, stun included (see the enemy-shot hit loop)
  if (kind === 'wraith') return { kind: 'zap', damage: 1, projSpeed: 9, range: 6.5, cooldown: 0, count: 1, stunPlayer: WRAITH_STUN };
  if (kind === 'boss') return { kind: 'boss', damage: 1, projSpeed: 6.8, range: 9, cooldown: 0, count: 5, spreadDeg: 42 };
  if (kind === 'spawner') return { kind: 'spore', damage: 1, projSpeed: 4.8, range: 6, cooldown: 0, count: 1 };
  // nightmare ranged (relic event): a thrown bone and a banshee wail
  if (kind === 'skeleton') return { kind: 'bone', damage: 1, projSpeed: 6, range: 8, cooldown: 0, count: 1 };
  if (kind === 'banshee') return { kind: 'wail', damage: 1, projSpeed: 5, range: 7, cooldown: 0, count: 1 };
  return { kind: 'arrow', damage: 1, projSpeed: 5.5, range: 8, cooldown: 0, count: 1 };
}

// --- ctf overtime escalation -------------------------------------------------
// Sudden death must converge: every 20s of overtime adds +1s to the CTF
// respawn delay (cap +5), and from +60s on, dropped flags tick home in HALF
// the time — pressure compounds until one side converts. The 180s grab-count
// cap in stepFlags stays the final backstop. Both knobs read g.suddenT
// directly (plain serialized state), so save/restore keeps the escalation
// byte-exact and the whole thing stays deterministic.
function ctfOvertimeLevel(g) {
  return g.suddenDeath ? Math.min(5, Math.floor(g.suddenT / 20)) : 0;
}
function ctfFlagDropT(g) {
  return g.suddenDeath && g.suddenT >= 60 ? FLAG_DROP_T / 2 : FLAG_DROP_T;
}

// Drop any carried flag on the spot. One code path for every drop that isn't
// a return: carrier going down, and climbing onto a mount (a CTF flag never
// rides a stag). The flag lies for FLAG_DROP_T (halved deep into overtime),
// then ticks home as usual.
function dropFlags(g, p) {
  for (const f of g.flags) {
    if (f.carrier === p.pid) {
      f.carrier = null;
      f.atBase = false;
      f.x = p.x;
      f.y = p.y;
      f.dropT = ctfFlagDropT(g);
      g.events.push({ type: 'flagDrop', team: f.team, pid: p.pid, x: f.x, y: f.y });
    }
  }
}

// Lay a carried field weapon at the feet as a shared pickup with whatever
// ammo is left. One code path for every drop: the 0.8s ITEM hold, going down,
// extraction, and the swap-out when grabbing a different weapon.
function dropFieldWeapon(g, p) {
  if (!p.fieldWeapon) return;
  g.pickups.push({ id: 'fw' + g.nextPickupId++, x: p.x, y: p.y, kind: p.fieldWeapon.kind, ammo: p.fieldWeapon.ammo });
  g.events.push({ type: 'fieldDrop', pid: p.pid, x: p.x, y: p.y, kind: p.fieldWeapon.kind, ammo: p.fieldWeapon.ammo });
  p.fieldWeapon = null;
}

// STRANDED OPERATORS: spawn a weak friendly 'defender' follower at (x,y). It is
// OWNERLESS (owner === null) — it belongs to the squad/base, not a seat — so
// stepFollowers runs its garrison-the-base branch and enemies weight it like
// any follower. Reuses g.followers (one wire/render path). slot: -1 marks the
// ownerless garrison so the formation code never claims it.
function recruitDefender(g, x, y, src) {
  const f = {
    id: g.nextFollowerId++, kind: 'defender', owner: null,
    x, y, hp: DEFENDER_STATS.defender.hp, maxHp: DEFENDER_STATS.defender.hp, slot: -1,
    fx: 0, fy: 1, cool: 0, invulnT: 0, path: null, pathI: 0, repathT: 0, isFollower: true,
  };
  g.followers.push(f);
  g.events.push({ type: 'recruit', x, y, src });
  return f;
}

// DROP action (inp.drop edge): lay down whatever the operative is carrying, in
// priority. SCRAP first (the give-an-operator-a-weapon currency): dropped next
// to a stranded operator it RECRUITS them (consumed), else it lands as a loose
// pickup. Then a carried STRANDED OPERATOR: dropped at the stronghold centre
// they are saved and recruited as a defender, else set back down on the field.
// Then a relic music-box FRAGMENT (the carried shard). Empty-handed is a no-op.
// Returns true when something was dropped (so the press is consumed).
function dropHeld(g, p) {
  // 1. carried scrap
  const sc = g.scrap.find(s => s.carrier === p.pid);
  if (sc) {
    // recruit the NEAREST un-recruited stranded operator in reach
    let op = null, best = (TILE * BUILD_REACH) ** 2;
    for (const o of g.stranded) {
      if (o.recruited || o.carrier != null) continue;
      const d = dist2(p, o);
      if (d < best) { best = d; op = o; }
    }
    if (op) {
      op.recruited = true;
      sc.carrier = null;
      g.scrap.splice(g.scrap.indexOf(sc), 1); // scrap is consumed (never the relic pool)
      recruitDefender(g, op.x, op.y, 'scrap');
      g.events.push({ type: 'scrapGiven', x: op.x, y: op.y, opId: op.id });
    } else {
      sc.carrier = null;
      sc.x = p.x;
      sc.y = p.y;
      sc.noPid = p.pid; // don't let the dropper instantly re-scoop it off the ground
      g.events.push({ type: 'scrapDrop', x: p.x, y: p.y, id: sc.id });
    }
    return true;
  }
  // 2. carried stranded operator
  const op = g.stranded.find(o => o.carrier === p.pid);
  if (op) {
    op.carrier = null;
    op.x = p.x;
    op.y = p.y;
    const base = baseCenter(g);
    if (dist2(p, base) < (TILE * DEFENDER_HOLD) ** 2) {
      op.recruited = true;
      recruitDefender(g, p.x, p.y, 'rescue');
      g.events.push({ type: 'opSaved', x: p.x, y: p.y, opId: op.id });
    } else {
      g.events.push({ type: 'opDrop', x: p.x, y: p.y, opId: op.id });
    }
    return true;
  }
  // 3. carried relic fragment (drops it on the spot for a teammate to retrieve)
  if (g.musicBox && g.musicBox.enabled && !g.musicBox.complete) {
    const f = g.musicBox.fragments.find(fr => fr.carrier === p.pid);
    if (f) {
      f.carrier = null;
      f.x = p.x;
      f.y = p.y;
      g.events.push({ type: 'mbDrop', x: p.x, y: p.y, id: f.id, pid: p.pid });
      return true;
    }
  }
  return false; // empty hands: no-op
}

// Going down vacates whatever the player held: mount, watchtower, flag, shop.
function releaseHoldings(g, p) {
  p.shopping = false;
  if (p.placing) exitPlacement(p); // a downed operative drops out of placement
  dropFieldWeapon(g, p); // downed (and extracted) operatives drop theirs
  if (p.riding) {
    const v = g.vehicles.find(v => v.id === p.riding);
    if (v) v.rider = null;
    p.riding = null;
  }
  if (p.towerId != null) {
    const t = g.towers[p.towerId];
    if (t) t.occupant = null;
    p.towerId = null;
  }
  dropFlags(g, p);
  // a downed/extracted carrier sets down their stranded operator + scrap where
  // they fell (mirrors how captives free their owner) so neither is ever lost
  for (const o of g.stranded) if (o.carrier === p.pid) { o.carrier = null; o.x = p.x; o.y = p.y; }
  for (const s of g.scrap) if (s.carrier === p.pid) { s.carrier = null; s.x = p.x; s.y = p.y; s.noPid = p.pid; }
}

function downPlayer(g, p) {
  if (p.state !== 'active' || p.invuln > 0) return;
  if (g.cheats && g.cheats.god) return; // DEV god mode: never goes down
  // RELIC AWAKENING scoring: a death during the live event is a heavy penalty.
  if (g.horde && !g.horde.ended) g.horde.deaths++;
  releaseHoldings(g, p);
  p.aboard = false; // going down steps off the landed Anchorcraft
  // BR: no rescue, no captive body — straight out, last one standing wins.
  if (g.mode === 'br') {
    p.state = 'out';
    p.dashT = 0;
    p.stimT = 0;
    g.lastOut = p.pid;
    const remaining = g.players.filter(q => q.state === 'active').length;
    g.events.push({ type: 'eliminated', pid: p.pid, remaining, x: p.x, y: p.y });
    return;
  }
  // CTF: respawn at the team flag stand keeping the same operative; rosters
  // are never consumed in pvp. Overtime escalation stretches the delay by
  // +1s per 20s of sudden death (cap +5) — already-counting timers keep the
  // delay they were assigned at down time.
  if (g.mode === 'ctf') {
    p.state = 'down';
    p.respawn = CTF_RESPAWN + ctfOvertimeLevel(g);
    p.dashT = 0;
    p.stimT = 0;
    g.events.push({ type: 'down', x: p.x, y: p.y });
    return;
  }
  // Siege: respawn at the team core after a delay that grows with the team's
  // death count (4s rising to 12s). XP/level/maxHp persist (like CTF).
  if (g.siege) {
    g.deathCountByTeam[p.team]++;
    p.state = 'down';
    p.respawn = Math.min(12, 4 + Math.min(8, Math.ceil(g.deathCountByTeam[p.team] / 3)));
    p.dashT = 0;
    p.stimT = 0;
    g.events.push({ type: 'down', x: p.x, y: p.y });
    return;
  }
  // Family Mode: gentle — you KEEP your operative and pop back at a spawn after
  // a short cooldown; the shared life counter ticks down (floors at 0) so it
  // never becomes a hard game-over. XP/level persist.
  if (g.family) {
    if (g.familyLives > 0) g.familyLives--;
    p.state = 'down';
    p.respawn = FAMILY_RESPAWN;
    p.dashT = 0;
    p.stimT = 0;
    g.events.push({ type: 'down', x: p.x, y: p.y });
    return;
  }
  g.captives.push({ id: 'c' + g.nextCaptiveId++, charId: p.charId, x: p.x, y: p.y, owner: null, fromPlayer: true });
  for (const c of g.captives) if (c.owner === p.pid) c.owner = null;
  g.events.push({ type: 'down', x: p.x, y: p.y });
  p.charId = null;
  p.state = 'down';
  p.respawn = RESPAWN_DELAY;
  p.dashT = 0;
  p.stimT = 0;
}

// Every source of player damage (contact, enemy shots, explosions, later the
// BR zone) routes through here. Arcade keeps the classic 1-hit rule exactly;
// survival maps spend shield pips first, then hp, with a short hit-grace.
function damagePlayer(g, p, dmg = 1) {
  if (p.state !== 'active' || p.invuln > 0) return;
  if (g.cheats && g.cheats.god) return; // DEV god mode: take no damage
  // RELIC AWAKENING scoring: a connecting hit during the live event bleeds the
  // survival bonus. Counted once per landed damage instance (the invuln guard
  // above already throttles repeat contact).
  if (g.horde && !g.horde.ended) g.horde.hits++;
  // a single hit destroys your mount — the stag is a fast ride, not a tank. It's
  // gone for the level (a fresh one can be earned/found next level). Skiffs
  // (water craft) are exempt so you can't be stranded mid-lake.
  if (p.riding) {
    const v = g.vehicles.find(vv => vv.id === p.riding);
    if (v && v.kind === 'stag') {
      dismountVehicle(g, p, v);          // nulls v.rider + p.riding
      const idx = g.vehicles.indexOf(v);
      if (idx >= 0) g.vehicles.splice(idx, 1); // gone for the level
      g.events.push({ type: 'vehicleDown', kind: 'stag', x: v.x, y: v.y, pid: p.pid });
    }
  }
  if (g.arcade || p.maxHp === undefined) { downPlayer(g, p); return; }
  if (g.family) dmg = 1; // toddler mode: every bump is a single gentle tick, never a burst
  for (let i = 0; i < dmg; i++) {
    if (p.shield > 0) p.shield--;
    else p.hp--;
  }
  if (p.hp <= 0) { downPlayer(g, p); return; }
  p.invuln = Math.max(p.invuln, g.family ? FAMILY_HIT_INVULN : HIT_INVULN);
  g.events.push({ type: 'playerHit', pid: p.pid, x: p.x, y: p.y, hp: p.hp, shield: p.shield });
}

// pvp damage funnel: routes through damagePlayer (invuln/shield rules apply)
// and credits the attacker with a kill when the hit downs/eliminates the
// victim. Per-player kills break simultaneous-wipe ties in BR.
function pvpHit(g, victim, dmg, attackerPid) {
  const was = victim.state;
  damagePlayer(g, victim, dmg);
  if (was === 'active' && victim.state !== 'active' && attackerPid !== undefined) {
    const att = g.players.find(q => q.pid === attackerPid);
    if (att) {
      att.kills = (att.kills || 0) + 1;
      // a siege takedown is worth shards + xp (and counts toward total kills)
      if (g.siege) { addShards(g, att, 3); awardXp(g, att.pid, { score: 75 }); g.kills++; }
    }
  }
}

// --- shard pools -----------------------------------------------------------
// CTF runs per-team pools (g.teamShards [t0, t1]): collectors credit their
// own team and spends (shop/build/repair/upgrade/hire) debit the spender's
// team. Every other mode — BR included, by design: one shared pot keeps the
// free-for-all scramble honest — uses the single squad pool g.shards.
function getShards(g, p) {
  return g.teamShards && p && p.team !== undefined ? g.teamShards[p.team] : g.shards;
}
function addShards(g, p, n) {
  if (g.teamShards && p && p.team !== undefined) g.teamShards[p.team] += n;
  else g.shards += n;
}

function freeChars(g) {
  // pvp: the full roster is always free. Character duplicates are allowed —
  // even on the same team (identity in ctf is name + team color) — and pvp
  // never consumes roster operatives, so there is nothing to filter.
  if (g.mode === 'ctf' || g.mode === 'br') return g.roster.slice();
  const used = new Set();
  for (const p of g.players) if (p.charId) used.add(p.charId);
  for (const c of g.captives) used.add(c.charId);
  for (const id of g.rescued) used.add(id);
  return g.roster.filter(id => !used.has(id));
}

// Mid-level rejoin (server reservation flow): a held-out seat re-enters
// through the EXISTING respawn-pick flow — state 'out' becomes 'pick' when
// free roster operatives exist, else the seat stays out (the caller may try
// again after a rescue frees somebody). Deterministic: no RNG, no clock —
// just a state flip the next step() resolves exactly like a post-down pick.
// pickPrev starts all-held so a button held through the rejoin can't
// instantly confirm (mirrors the down flow). PvP refuses outright: BR
// eliminations are final by design and CTF never parks a seat out.
export function revivePlayer(g, pid) {
  if (g.status !== 'play' || g.mode === 'ctf' || g.mode === 'br') return false;
  const p = g.players.find(q => q.pid === pid);
  if (!p || p.state !== 'out' || !freeChars(g).length) return false;
  p.state = 'pick';
  p.pickIdx = 0;
  p.pickPrev = { left: true, right: true, fire: true };
  return true;
}

// CTF mid-match join (wave 7, public rooms): insert a brand-new seat into a
// LIVE ctf match. The joiner lands in the respawn-pick state on their team
// stand's spawn ring and picks any roster operative (pvp duplicates allowed —
// freeChars returns the full roster). Sim-level caps hold here too: refuses
// at MODE_CAPS.ctf seats total or MODE_CAPS.ctf/2 on the team, and refuses
// non-ctf modes, finished matches, bad teams and duplicate pids. pickPrev
// starts all-held so a button held through the join can't instantly confirm
// (the down-flow rule). Deterministic: no RNG, no clock — the new seat is
// plain appended state, so serializeGame/restoreGame round-trips keep
// replaying byte-exact. Returns the new player, or false when refused.
export function addPlayerMidGame(g, { pid, name, team }) {
  if (g.mode !== 'ctf' || g.status !== 'play') return false;
  if (team !== 0 && team !== 1) return false;
  if (g.players.some(q => q.pid === pid)) return false;
  if (g.players.length >= MODE_CAPS.ctf) return false;
  if (g.players.filter(q => q.team === team).length >= MODE_CAPS.ctf / 2) return false;
  const p = spawnPlayer(pid, name, null, 0, 0);
  p.team = team;
  p.kills = 0;
  // survival-rule fields (mode maps are never arcade): 3 hp, shield pips, an
  // item slot, per-seat xp — exactly the createGame loadout
  p.hp = PLAYER_MAX_HP;
  p.maxHp = PLAYER_MAX_HP;
  p.shield = 0;
  p.item = null;
  p.xp = 0;
  p.level = 1;
  g.players.push(p);
  const s = ctfStandSpot(g, p);
  p.x = s.x;
  p.y = s.y;
  p.state = 'pick';
  p.pickIdx = 0;
  p.pickPrev = { left: true, right: true, fire: true };
  return p;
}

function extractPlayer(g, p) {
  if (p.state !== 'active') return;
  releaseHoldings(g, p);
  p.state = 'extracted';
  g.score += 250;
  let rescuedHere = 0;
  for (let i = g.captives.length - 1; i >= 0; i--) {
    if (g.captives[i].owner === p.pid) {
      g.rescued.push(g.captives[i].charId);
      g.captives.splice(i, 1);
      rescuedHere++;
      g.score += 500;
    }
  }
  g.events.push({ type: 'extract', x: p.x, y: p.y, rescued: rescuedHere, points: 250 + rescuedHere * 500 });
}

// Act on a closed chest: shards join the squad pool; cracker/medkit fill the
// opener's item slot (same kind stacks, a different kind is swapped out);
// shield tops the pips; token raises the opener's damage (+2 cap).
function openChest(g, c, p) {
  c.opened = true;
  const ev = { type: 'chest', x: c.x, y: c.y, loot: c.loot, pid: p.pid };
  if (c.loot === 'shards') {
    addShards(g, p, c.amount); // ctf: credits the opener's team pool
    ev.amount = c.amount;
  } else if (c.loot === 'shield') {
    if (p.shield !== undefined) p.shield = Math.min(SHIELD_MAX, p.shield + 2);
  } else if (c.loot === 'token') {
    p.dmgBonus = Math.min(2, (p.dmgBonus || 0) + 1);
  } else { // cracker | medkit | toxin | controller fill the item slot
    if (p.item && p.item.kind === c.loot) p.item.count += c.amount;
    else p.item = { kind: c.loot, count: c.amount };
  }
  g.events.push(ev);
}

// Act-harvest a stage-3 farm: a medkit for the harvester (stacking), or +1 hp
// on the spot when the slot is full of something else and they are hurt.
// A full slot of another kind at full hp leaves the crop standing — the
// refusal cues a 'slotFull' event (once per press; harvest runs on act edges).
function harvestFarm(g, b, p) {
  if (!p.item) p.item = { kind: 'medkit', count: 1 };
  else if (p.item.kind === 'medkit') p.item.count++;
  else if (p.hp !== undefined && p.hp < p.maxHp) p.hp++;
  else { g.events.push({ type: 'slotFull', x: b.x, y: b.y }); return; }
  b.stage = 0;
  b.growT = 0;
  g.events.push({ type: 'harvest', x: b.x, y: b.y, pid: p.pid });
}

// --- quests --------------------------------------------------------------
// Bump every ACTIVE quest of `kind` whose target matches one of `tags`
// (a quest with no target matches anything). Kill and build quests call in
// from the sim; the puzzle systems (switch/glyph/destroy/craft) call the
// export from their own resolutions. Completion always settles at the giver.
export function questProgress(g, kind, tags = [], x = 0, y = 0) {
  if (!g.quests || !g.quests.length) return;
  for (const q of g.quests) {
    if (q.state !== 'active' || q.kind !== kind || q.progress >= q.count) continue;
    if (q.target != null && !tags.includes(q.target)) continue;
    q.progress++;
    g.events.push({ type: 'questProgress', id: q.id, progress: q.progress, count: q.count, x, y });
  }
}

// Talking to a giver drives its quests: hidden ones activate; active ones
// complete once satisfied. fetch = the TALKER trails `count` quest items of
// the right kind (handed over and consumed on the spot); every other kind
// banks `progress` from linked events first. Rewards pay the talker —
// shards to the pool, an item into the slot, a field weapon into the hands;
// openDoor parks the door id on g.pendingDoorOpens for the door system.
function questTalk(g, npc, p) {
  if (!g.quests.length) return;
  for (const q of g.quests) {
    if (q.giver !== npc.id) continue;
    if (q.state === 'hidden') {
      q.state = 'active';
      g.events.push({ type: 'quest', id: q.id, state: 'active', title: q.title, main: q.main });
      continue;
    }
    if (q.state !== 'active') continue;
    let satisfied = false;
    if (q.kind === 'fetch') {
      const carried = g.qitems.filter(it => it.carrier === p.pid && it.kind === q.item);
      if (carried.length >= q.count) {
        for (let i = 0; i < q.count; i++) g.qitems.splice(g.qitems.indexOf(carried[i]), 1);
        q.progress = q.count;
        satisfied = true;
      }
    } else {
      satisfied = q.progress >= q.count;
    }
    if (!satisfied) continue;
    q.state = 'done';
    const r = q.reward || {};
    if (r.shards) addShards(g, p, r.shards);
    if (r.item) { // item rewards fill the slot like chest loot (stack/swap)
      if (p.item && p.item.kind === r.item) p.item.count += 1;
      else p.item = { kind: r.item, count: 1 };
    }
    if (r.weapon && FIELD_WEAPONS[r.weapon]) { // a fully loaded field weapon
      dropFieldWeapon(g, p); // anything in hand swaps out at the feet
      p.fieldWeapon = { kind: r.weapon, ammo: FIELD_WEAPONS[r.weapon].ammo };
    }
    if (r.openDoor) g.pendingDoorOpens.push(r.openDoor);
    g.events.push({ type: 'quest', id: q.id, state: 'done', title: q.title, main: q.main, ...(q.reward ? { reward: q.reward } : {}) });
  }
}

// Per-tick quest upkeep: 'reach' quests are BINARY — they complete outright
// the moment any active player stands inside 1.5 tiles of the target tile
// (count is ignored: progress jumps straight to count, never 1 per tick).
// Fetch quests mirror the carried count into progress so the objectives HUD
// reads live (completion still demands the talker carry them to the giver).
function stepQuests(g) {
  if (!g.quests.length) return;
  for (const q of g.quests) {
    if (q.state !== 'active') continue;
    if (q.kind === 'reach' && q.progress < q.count && q.target && typeof q.target.x === 'number') {
      const tx = (q.target.x + 0.5) * TILE, ty = (q.target.y + 0.5) * TILE;
      for (const p of g.players) {
        if (p.state !== 'active' || dist2(p, { x: tx, y: ty }) >= (TILE * QUEST_REACH_TILES) ** 2) continue;
        q.progress = q.count;
        g.events.push({ type: 'questProgress', id: q.id, progress: q.progress, count: q.count, x: tx, y: ty });
        break;
      }
    } else if (q.kind === 'fetch') {
      let carried = 0;
      for (const it of g.qitems) if (it.carrier != null && it.kind === q.item) carried++;
      q.progress = Math.min(q.count, carried);
    }
  }
}

// --- monolythium puzzle systems --------------------------------------------
// Doors open exactly once, by id. Every opener funnels through here.
function openDoor(g, d) {
  if (!d || d.open) return;
  d.open = true;
  g.buildEpoch = (g.buildEpoch || 0) + 1; // the route map changed: dormant sleepers re-check
  g.events.push({ type: 'doorOpen', id: d.id, x: (d.x + d.w / 2) * TILE, y: (d.y + d.h / 2) * TILE });
}

// Puzzle rewards mirror quest rewards where they overlap: openDoor parks the
// id on pendingDoorOpens (stepDoors consumes it); quest bumps the named
// quest's progress by one, like any other linked-system event.
function applyPuzzleReward(g, reward, x, y) {
  if (!reward) return;
  if (reward.openDoor) g.pendingDoorOpens.push(reward.openDoor);
  if (reward.quest) {
    const q = g.quests.find(q2 => q2.id === reward.quest);
    if (q && q.state === 'active' && q.progress < q.count) {
      q.progress++;
      g.events.push({ type: 'questProgress', id: q.id, progress: q.progress, count: q.count, x, y });
    }
  }
}

// Relay switch: act throws it ON (one-way; the quorum window resets it).
// CLUSTER QUORUM: need-of-of online completes the group — its reward fires
// and 'switch' quests targeting the group name advance. A lone relay with no
// group def drives 'switch' quests by its own id instead.
function toggleSwitch(g, s, p) {
  s.on = true;
  g.events.push({ type: 'switch', id: s.id, group: s.group, on: true, x: s.x, y: s.y, pid: p.pid });
  const grp = g.switchGroups.find(sg => sg.group === s.group && !sg.done);
  if (!grp) {
    questProgress(g, 'switch', [s.id], s.x, s.y);
    return;
  }
  let on = 0;
  for (const o of g.switches) if (o.group === s.group && o.on) on++;
  // a timed quorum starts its window on the FIRST relay thrown
  if (grp.window > 0 && on === 1) grp.windowT = grp.window;
  if (on >= grp.need) {
    grp.done = true;
    grp.windowT = 0;
    g.events.push({ type: 'quorum', group: grp.group, x: s.x, y: s.y });
    applyPuzzleReward(g, grp.reward, s.x, s.y);
    questProgress(g, 'switch', [String(grp.group)], s.x, s.y);
  }
}

// Quorum windows tick down; an expired window resets every relay in the
// group to OFF (the whole cluster must be re-thrown inside a fresh window).
function stepSwitchGroups(g, dt) {
  if (!g.switchGroups.length) return;
  for (const grp of g.switchGroups) {
    if (grp.done || !(grp.windowT > 0)) continue;
    grp.windowT -= dt;
    if (grp.windowT <= 0) {
      grp.windowT = 0;
      let x = 0, y = 0;
      for (const s of g.switches) {
        if (s.group !== grp.group) continue;
        s.on = false;
        x = s.x; y = s.y;
      }
      g.events.push({ type: 'switchReset', group: grp.group, x, y });
    }
  }
}

// Glyph stone: act lights it — but only the stone whose symbol comes next in
// the group's order. A wrong stone snuffs the whole group ('glyphReset');
// completing the order fires the reward and 'glyph' quests by group name.
// Stones without a group def just light (scenery inscriptions).
function lightGlyph(g, gl, p) {
  const grp = g.glyphGroups.find(gg => gg.group === gl.group && !gg.done);
  if (!grp) {
    gl.lit = true;
    g.events.push({ type: 'glyph', id: gl.id, symbol: gl.symbol, group: gl.group, x: gl.x, y: gl.y });
    return;
  }
  let lit = 0;
  for (const o of g.glyphs) if (o.group === gl.group && o.lit) lit++;
  if (gl.symbol !== grp.order[lit]) {
    for (const o of g.glyphs) if (o.group === gl.group) o.lit = false;
    g.events.push({ type: 'glyphReset', group: gl.group, x: gl.x, y: gl.y });
    return;
  }
  gl.lit = true;
  g.events.push({ type: 'glyph', id: gl.id, symbol: gl.symbol, group: gl.group, x: gl.x, y: gl.y });
  if (lit + 1 >= grp.order.length) {
    grp.done = true;
    g.events.push({ type: 'glyphDone', group: gl.group, x: gl.x, y: gl.y });
    applyPuzzleReward(g, grp.reward, gl.x, gl.y);
    questProgress(g, 'glyph', [String(grp.group)], gl.x, gl.y);
  }
}

// Seal forge: an act-hold at the anvil by a player trailing a proof fragment
// while the pool holds 20 shards consumes both and mints a lythseal. The seal
// lives on its OWN field (p.lythseal) — the item slot stays free, so loot and
// rewards can never silently destroy a carried seal. Carrying it opens
// sealLock doors on touch and reveals Classical Phantoms (snapshot players
// hasSeal; render does the distance). A bearer never re-forges: the anvil
// refuses the hold rather than waste a fragment and 20 shards on nothing.
function stepForges(g, inputs, dt) {
  if (!g.forges.length) return;
  const r2 = (TILE * BUILD_REACH) ** 2;
  for (const f of g.forges) {
    let crafter = null;
    for (const p of g.players) {
      if (p.state !== 'active' || p.towerId != null || p.riding || p.shopping || p.selecting) continue;
      if (p.lythseal) continue; // one seal per bearer — nothing to mint
      const inp = inputs[p.pid] || {};
      if (!inp.act || dist2(p, f) >= r2) continue;
      if (!g.qitems.some(it => it.carrier === p.pid && it.kind === FORGE_ITEM)) continue;
      if (getShards(g, p) < FORGE_COST) continue;
      crafter = p;
      break;
    }
    if (!crafter) { f.holdT = 0; continue; }
    f.holdT = (f.holdT || 0) + dt;
    if (f.holdT < FORGE_HOLD_T) continue;
    f.holdT = 0;
    const idx = g.qitems.findIndex(it => it.carrier === crafter.pid && it.kind === FORGE_ITEM);
    g.qitems.splice(idx, 1);
    addShards(g, crafter, -FORGE_COST);
    crafter.lythseal = true;
    g.events.push({ type: 'sealForged', pid: crafter.pid, x: f.x, y: f.y });
    questProgress(g, 'craft', ['lythseal'], f.x, f.y);
  }
}

// Doors: consume parked openDoor rewards (quests, quorums, glyph orders),
// then let lythseal carriers swing sealLock doors on touch.
function stepDoors(g) {
  if (g.pendingDoorOpens.length) {
    for (const id of g.pendingDoorOpens.splice(0)) {
      openDoor(g, g.doors.find(d => d.id === id));
    }
  }
  if (!g.doors.length) return;
  for (const d of g.doors) {
    if (d.open || !d.sealLock) continue;
    for (const p of g.players) {
      if (p.state !== 'active' || !p.lythseal) continue;
      // nearest point of the door's pixel rect to the carrier
      const nx = Math.max(d.x * TILE, Math.min((d.x + d.w) * TILE, p.x));
      const ny = Math.max(d.y * TILE, Math.min((d.y + d.h) * TILE, p.y));
      const dx = p.x - nx, dy = p.y - ny;
      if (dx * dx + dy * dy <= (PLAYER_R + DOOR_TOUCH) ** 2) {
        openDoor(g, d);
        break;
      }
    }
  }
}

// Teleport pads: an active, unmounted player standing on a pad channels for
// 0.8s, then blinks to the twin. Carried captives and quest items arrive at
// the destination with them; the player's followers blink along too. A 2s
// per-player cooldown stops ping-ponging; enemies never channel at all.
// A twin pad sitting inside a CLOSED door rect refuses the channel outright —
// blinking into a sealed rect would trap the player (door blocking has no
// escape carve-out). The pad answers again the moment the door opens.
function stepTeleports(g, dt) {
  if (!g.teleports.length) return;
  for (const p of g.players) {
    if (p.teleCool > 0) p.teleCool -= dt;
    if (p.state !== 'active' || p.riding || p.towerId != null) { p.channelT = 0; continue; }
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor(p.y / TILE);
    let pad = null;
    for (const t of g.teleports) {
      if (Math.floor(t.x / TILE) === tx && Math.floor(t.y / TILE) === ty) { pad = t; break; }
    }
    const twin = pad && pad.twin != null ? g.teleports.find(t => t.id === pad.twin) : null;
    if (!twin || p.teleCool > 0 || doorBlocksPx(g, twin.x, twin.y)) { p.channelT = 0; continue; }
    p.channelT = (p.channelT || 0) + dt;
    if (p.channelT < TELE_CHANNEL_T) continue;
    p.channelT = 0;
    p.teleCool = TELE_COOLDOWN;
    const sx = p.x, sy = p.y;
    p.x = twin.x;
    p.y = twin.y;
    for (const c of g.captives) {
      if (c.owner === p.pid) { c.x = twin.x; c.y = twin.y; }
    }
    for (const it of g.qitems) {
      if (it.carrier === p.pid) { it.x = twin.x; it.y = twin.y; }
    }
    if (g.musicBox && g.musicBox.enabled) {
      for (const f of g.musicBox.fragments) {
        if (f.carrier === p.pid) { f.x = twin.x; f.y = twin.y; }
      }
    }
    for (const f of g.followers) {
      if (f.dead || f.owner !== p.pid) continue;
      f.x = twin.x;
      f.y = twin.y;
      f.path = null;
      f.repathT = 0;
    }
    g.events.push({ type: 'teleport', pid: p.pid, from: pad.id, to: twin.id, sx, sy, x: twin.x, y: twin.y });
  }
}

function addKillScore(g, e) {
  const points = (e.score || 100) * g.combo;
  g.kills++;
  g.score += points;
  g.events.push({ type: 'die', x: e.x, y: e.y, kind: e.kind, points, combo: g.combo });
  g.combo = Math.min(9, g.combo + 1);
  g.comboT = 2;
}

// Split mutants burst into two skitters. Deterministic placement: fixed angle
// fans (opposed per twin) with a collide fallback, capped at the global 90.
function splitSpawn(g, e, k) {
  if (g.enemies.length >= 90) return;
  const base = k === 0 ? 0 : Math.PI;
  for (const a of [base, base + Math.PI / 2, base + Math.PI / 4, base - Math.PI / 4]) {
    const x = e.x + Math.cos(a) * TILE * 0.6;
    const y = e.y + Math.sin(a) * TILE * 0.6;
    if (!collides(g, x, y, ENEMY_R)) {
      const sk = makeEnemy('w', x, y, g.nextEnemyId++);
      sk.awake = true;
      scaleEnemyHp(g.hpMult, sk);
      if (e.targetCore) {
        sk.targetCore = true;
        sk.aggro *= 100;
        if (e.coreI !== undefined) sk.coreI = e.coreI; // same beacon as the parent
      }
      g.enemies.push(sk);
      g.events.push({ type: 'spawnEnemy', x, y, kind: sk.kind });
      return;
    }
  }
}

function killEnemy(g, e, ownerPid) {
  if (e.dead) return;
  e.dead = true;
  addKillScore(g, e);
  awardXp(g, ownerPid, e); // kill credit -> the owning seat levels up
  questProgress(g, 'kill', [e.letter, e.kind], e.x, e.y); // kill quests count
  // L4 burn: an enemy that dies ignited leaves a 3s ground burn patch.
  if (e.burnT > 0 && e.burnPatch) {
    g.patches.push({ x: e.x, y: e.y, kind: 'burn', r: BURN_PATCH_R * TILE, ttl: BURN_PATCH_TTL, pid: e.burnOwner });
    g.events.push({ type: 'patch', x: e.x, y: e.y, kind: 'burn', r: BURN_PATCH_R * TILE });
  }
  // Every kill drops a shard pickup at the corpse. Deterministic, always.
  g.drops.push({ x: e.x, y: e.y, amount: SHARD_DROPS[e.kind] || 1, ttl: DROP_TTL });
  // POWER-UP DROP: a kill VERY RARELY leaves a floating team-wide power-up at
  // the corpse (boosted while the relic awakening horde plays). Fully
  // deterministic so server and client agree on every roll. Gated entirely
  // inside maybeDropPowerup, so untouched modes that never roll a keeper stay
  // byte-identical.
  maybeDropPowerup(g, e);
  // Fork Alpha: the seam parts — it ALWAYS splits into two skitters. The
  // 'split' mutation below stacks its own pair on top when rolled.
  if (e.kind === 'alpha') {
    splitSpawn(g, e, 0);
    splitSpawn(g, e, 1);
  }
  // Pyre Beetle: the urn cracks — 1 dmg AoE to players plus a hostile burn
  // patch (hostile patches sear players and pass over enemies; see stepPatches).
  if (e.kind === 'beetle') {
    const r = TILE * BEETLE_BURST_R;
    g.events.push({ type: 'pyreBurst', x: e.x, y: e.y, radius: r });
    const r2 = r * r;
    for (const p of g.players) {
      if (p.state === 'active' && p.invuln <= 0 && dist2(e, p) <= r2) damagePlayer(g, p, 1);
    }
    g.patches.push({ x: e.x, y: e.y, kind: 'burn', r, ttl: BURN_PATCH_TTL, hostile: true });
    g.events.push({ type: 'patch', x: e.x, y: e.y, kind: 'burn', r, hostile: true });
  }
  // Mutant deaths: volatile pops, split twins out.
  if (e.mutation === 'volatile') {
    g.events.push({ type: 'volatile', x: e.x, y: e.y, radius: TILE * 1.2 });
    const r2 = (TILE * 1.2) ** 2;
    for (const p of g.players) {
      if (p.state === 'active' && p.invuln <= 0 && dist2(e, p) <= r2) damagePlayer(g, p, 2);
    }
  } else if (e.mutation === 'split') {
    splitSpawn(g, e, 0);
    splitSpawn(g, e, 1);
  }
}

// True while the relic/music-box awakening wave is mid-flight — power-up drops
// are boosted during it (recon hordeDetect).
function hordeActive(g) {
  return !!(g.musicBox && g.musicBox.enabled && g.horde && !g.horde.ended);
}

// POWER-UP DROP ROLL. Deterministic: an FNV/LCG mix of the dying enemy's id, a
// per-game kill counter (g.powerupKills) and g.elapsed — the exact seed pattern
// the shard/stronghold/stranded placement code uses — so the same kill on the
// same frame rolls identically on the server and every client. Two LCG draws:
// the first gates the rare drop (boosted x3 during the awakening horde), the
// second weighted-picks the type (Full Health most common, Nuke rarest).
// Exported as a test seam (the integrated kill path calls it internally).
export function maybeDropPowerup(g, e) {
  const k = g.powerupKills++;            // advance the per-game counter every kill
  // seed identity from the enemy id + counter + elapsed (quantized to ms so the
  // float never feeds character-by-character noise into the FNV mix)
  const nm = 'pu' + (e.id | 0) + ':' + k + ':' + Math.round(g.elapsed * 1000);
  let seed = 2166136261; for (let i = 0; i < nm.length; i++) { seed ^= nm.charCodeAt(i); seed = (seed * 16777619) >>> 0; }
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const chance = POWERUP_DROP_CHANCE * (hordeActive(g) ? POWERUP_HORDE_MULT : 1);
  if (rnd() >= chance) return;           // no drop: the common case, gated away
  // weighted type pick — walk the cumulative weights with the second draw
  let pick = rnd() * POWERUP_WEIGHT_TOTAL, type = POWERUP_WEIGHTS[0][0];
  for (const [t, w] of POWERUP_WEIGHTS) { if (pick < w) { type = t; break; } pick -= w; }
  g.powerups.push({ id: 'pu' + g.nextPowerupId++, x: e.x, y: e.y, type, ttl: POWERUP_TTL });
  g.events.push({ type: 'powerupDrop', x: e.x, y: e.y, ptype: type });
}

// Apply a TEAM-WIDE power-up effect when a friendly seat walks over it. In co-op
// every active seat is friendly; in team modes the picker's team benefits. The
// effect runs entirely off existing deterministic state (no Math.random) so the
// pickup replays byte-identically. Exported as a test seam (the walk-over pickup
// path in step() calls it internally).
export function triggerPowerup(g, pu, picker) {
  const friendly = p => p.state === 'active'
    && (picker.team === undefined || p.team === picker.team);
  if (pu.type === 'firesale') {
    g.fireSaleT = POWERUP_FIRESALE_T;
  } else if (pu.type === 'stamina') {
    g.freeSprintT = POWERUP_FREESPRINT_T;
  } else if (pu.type === 'fullhealth') {
    for (const p of g.players) if (friendly(p) && p.maxHp !== undefined) p.hp = p.maxHp;
  } else if (pu.type === 'maxammo') {
    for (const p of g.players) if (friendly(p)) maxOutPlayer(g, p.pid);
  } else if (pu.type === 'nuke') {
    // delete the N enemies nearest the picker (fewer if fewer are alive) — a
    // deterministic selection that never wipes the whole field
    const live = g.enemies.filter(en => !en.dead);
    live.sort((a, b) => (dist2(picker, a) - dist2(picker, b)) || (a.id - b.id));
    for (const en of live.slice(0, POWERUP_NUKE_KILLS)) damageEnemy(g, en, en.hp + 999, en.x, en.y, 'nuke', picker.pid);
  }
  g.events.push({ type: 'powerup', x: pu.x, y: pu.y, ptype: pu.type });
}

function damageEnemy(g, e, dmg, x, y, cause, ownerPid) {
  if (e.dead) return false;
  wakeEnemy(g, e);
  e.returning = false; // a hit always re-engages an enemy walking home
  if (e.dormant) { e.dormant = false; e.pathFails = 0; } // pain stirs the unreachable
  // Null Acolyte ward: one absorb charge soaks the whole damage instance
  // (status riders applied before the hit still land — it's a damage ward).
  if (e.shielded) {
    e.shielded = false;
    e.hurt = 0.14;
    g.events.push({ type: 'shieldPop', x: x ?? e.x, y: y ?? e.y, kind: e.kind });
    return false;
  }
  // DEV instant-kill: any player-owned damage (ownerPid set) one-shots.
  if (g.cheats && g.cheats.instantKill && ownerPid != null) dmg = e.hp + 999;
  e.hp -= dmg;
  e.hurt = 0.14;
  g.events.push({ type: 'hit', x: x ?? e.x, y: y ?? e.y, kind: e.kind, hp: Math.max(0, e.hp), cause });
  if (e.hp <= 0) {
    killEnemy(g, e, ownerPid);
    return true;
  }
  return false;
}

function shieldBlocks(e, s) {
  if (e.kind !== 'bulwark') return false;
  const sp = Math.hypot(s.vx, s.vy) || 1;
  const incomingX = -s.vx / sp;
  const incomingY = -s.vy / sp;
  return incomingX * e.fx + incomingY * e.fy > 0.35;
}

function explode(g, s, skipEnemy = null) {
  if (!s.aoeRadius || s.exploded) return;
  s.exploded = true;
  g.events.push({ type: 'explode', x: s.x, y: s.y, radius: s.aoeRadius, who: s.who });
  const r2 = s.aoeRadius * s.aoeRadius;
  if (s.who === 'p') {
    for (const e of g.enemies) {
      if (e.dead || e === skipEnemy || e.convertedT > 0) continue;
      if (dist2(s, e) <= r2) damageEnemy(g, e, s.dmg, e.x, e.y, s.kind, s.ownerPid);
    }
    // pvp only: player AoE wounds OTHER-team operatives caught in the blast
    // (never same-team; invuln/shield rules ride damagePlayer as usual)
    if ((g.mode === 'ctf' || g.mode === 'br') && s.pid !== undefined) {
      for (const q of g.players) {
        if (q.state !== 'active' || q.pid === s.pid || q.team === s.team || q.invuln > 0) continue;
        if (dist2(s, q) <= r2) pvpHit(g, q, s.dmg, s.pid);
      }
    }
  } else {
    for (const p of g.players) {
      if (p.state === 'active' && p.invuln <= 0 && dist2(s, p) <= r2) damagePlayer(g, p);
    }
  }
}

function nearestTarget(g, e) {
  // A landed lure cracker overrides every other target for enemies inside its
  // pull radius — they wake and converge on it until it detonates.
  if (g.crackers && g.crackers.length) {
    const r2 = (TILE * CRACKER_LURE) ** 2;
    for (const c of g.crackers) {
      if (!c.landed) continue;
      const d = dist2(e, c);
      if (d < r2) {
        wakeEnemy(g, e);
        e.returning = false;
        return [{ x: c.x, y: c.y, nonPlayer: true }, d];
      }
    }
  }
  // Bastion night-wave enemies march on the base core (they still gnaw
  // structures and hit players en route via the existing melee rules).
  // Beacon-defense: each wave enemy marches its ASSIGNED monolith (coreI,
  // round-robin over the lit set at spawn); a beacon going dark hands its
  // besiegers to the next lit one, scanning from the assignment.
  let coreGoal = null;
  if (e.targetCore) {
    if (g.cores) {
      const n = g.cores.length;
      for (let k = 0; k < n; k++) {
        const cc = g.cores[((e.coreI || 0) + k) % n];
        if (cc.lit) {
          if (k) e.coreI = ((e.coreI || 0) + k) % n;
          coreGoal = cc;
          break;
        }
      }
    } else if (g.core && g.core.hp > 0) {
      coreGoal = g.core;
    }
  }
  if (coreGoal) {
    // Sighted defender: engage a player SEEN within 6 tiles and fight until
    // they die or slip 9+ tiles away, then resume the march. The resume
    // radius keeps the wave honest — nobody kites it across the map forever.
    if (e.engagePid !== undefined) {
      const p = g.players.find(q => q.pid === e.engagePid);
      if (p && p.state === 'active' && dist2(e, p) <= (TILE * WAVE_DISENGAGE) ** 2) {
        return [p, dist2(e, p)];
      }
      e.engagePid = undefined;
    } else {
      let seen = null, best = (TILE * WAVE_ENGAGE) ** 2;
      for (const p of g.players) {
        if (p.state !== 'active') continue;
        const d = dist2(e, p);
        if (d < best && canSee(g, e, p)) { best = d; seen = p; }
      }
      if (seen) {
        e.engagePid = seen.pid;
        return [seen, best];
      }
    }
    // Sealed approach: when A* to the core failed (every gap barricaded),
    // gnaw the nearest REACHABLE blocking structure instead of pinning on a
    // wall corner. adj-pathing stops beside it; contact gnawing does the
    // rest, and a fallen barricade resumes the core march through the gap.
    if (e.gnawI !== undefined) {
      const b = g.builds[e.gnawI];
      if (b && b.built && b.kind !== 'farm' && !inertBuild(b.kind)) {
        return [{ x: b.x, y: b.y, nonPlayer: true, adj: true }, dist2(e, b)];
      }
      e.gnawI = undefined; // chewed through (or dismantled): resume the march
      e.pathFailed = false;
      e.path = null;
      e.repathT = 0;
    } else if (e.pathFailed && !(e.gnawScanT > 0)) {
      // Budget guards (big maps; arcade keeps the classic unbounded scan):
      // at most g.gnawBudget scans START per tick field-wide, each capped to
      // the 8 NEAREST candidates, each candidate search drawing on the
      // global A* budget. A completed scan that found nothing reachable
      // caches that verdict ~2.5s and counts toward dormancy; a scan cut
      // short by an empty budget retries almost immediately instead.
      if (!g.arcade && (!(g.gnawBudget > 0) || !(g.pathBudget > 0))) {
        e.gnawScanT = 0.25;
      } else {
        if (!g.arcade) g.gnawBudget--;
        e.gnawScanT = 1.2; // per-enemy floor: rescan at most every 1.2s
        const ex = Math.floor(e.x / TILE), ey = Math.floor(e.y / TILE);
        const cands = [];
        for (let i = 0; i < g.builds.length; i++) {
          const b = g.builds[i];
          // pylons/beacons are indestructible, farms walkable — never gnaw goals
          if (!b.built || b.kind === 'farm' || inertBuild(b.kind)) continue;
          cands.push([dist2(e, b), i]);
        }
        cands.sort((a, b2) => a[0] - b2[0] || a[1] - b2[1]);
        let found = null, tried = 0, cut = false;
        for (const [, i] of cands) {
          if (!g.arcade) {
            if (tried >= 8) break;
            if (!(g.pathBudget > 0)) { cut = true; break; }
            g.pathBudget--;
            tried++;
          }
          const b = g.builds[i];
          const path = findPath(g, ex, ey, Math.floor(b.x / TILE), Math.floor(b.y / TILE), 8000, true);
          if (path) {
            e.pathFails = 0;
            e.gnawI = i;
            e.path = path;
            e.pathI = 0;
            e.repathT = 0.6 + (e.id % 5) * 0.08;
            found = [{ x: b.x, y: b.y, nonPlayer: true, adj: true }, dist2(e, b)];
            break;
          }
        }
        if (found) return found;
        if (!g.arcade) {
          if (cut) e.gnawScanT = 0.25; // budget ran dry mid-scan: retry soon
          else {
            // full scan, nothing reachable: cache the verdict; repeated
            // total failures put the enemy dormant via the same counter
            e.gnawScanT = 2.4 + (e.id % 7) * 0.1;
            e.pathFails = (e.pathFails || 0) + 1;
            if (e.pathFails >= 3 && !e.returning) {
              e.dormant = true;
              e.dormantEpoch = g.buildEpoch || 0;
            }
          }
        }
      }
    }
    return [{ x: coreGoal.x, y: coreGoal.y, nonPlayer: true }, dist2(e, coreGoal)];
  }
  let tgt = null, best = Infinity, eff = Infinity;
  for (const p of g.players) {
    if (p.state !== 'active') continue;
    const d = dist2(e, p);
    if (d < eff) { eff = d; best = d; tgt = p; }
  }
  // Followers are valid prey at 1.5x distance weighting (2.25x squared):
  // an enemy picks the dog only when it is meaningfully closer than a player.
  for (const f of g.followers) {
    if (f.dead) continue;
    const d = dist2(e, f);
    if (d * 2.25 < eff) { eff = d * 2.25; best = d; tgt = f; }
  }
  return [tgt, best];
}

function contactPlayer(g, e, best, tgt) {
  if (!tgt) return;
  if (tgt.isFollower) {
    if (best < (FOLLOWER_R + ENEMY_R) ** 2) damageFollower(g, tgt, 1);
    return;
  }
  const rr = (PLAYER_R + ENEMY_R) ** 2;
  if (tgt.nonPlayer) {
    // marching on a lure or the core: melee still clips any player en route
    for (const p of g.players) {
      if (p.state === 'active' && dist2(e, p) < rr) { damagePlayer(g, p); return; }
    }
    return;
  }
  if (best < rr) damagePlayer(g, tgt);
}

// Nightmare melee contact: like contactPlayer, but honors a per-kind melee
// damage (the reaper's heavy 2-dmg blow). Used by the relic horde only.
function contactNightmare(g, e, best, tgt) {
  if (!tgt || tgt.nonPlayer) return;
  const rr = (PLAYER_R + ENEMY_R) ** 2;
  if (best < rr) damagePlayer(g, tgt, ENEMY_STATS[e.letter]?.meleeDmg || 1);
}

function spawnSkitter(g, e, tgt) {
  const angles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI / 4, -Math.PI / 4];
  for (const a of angles) {
    const x = e.x + Math.cos(a) * TILE * 0.75;
    const y = e.y + Math.sin(a) * TILE * 0.75;
    if (!collides(g, x, y, ENEMY_R)) {
      const sk = makeEnemy('w', x, y, g.nextEnemyId++);
      sk.awake = true;
      scaleEnemyHp(g.hpMult, sk);
      if (tgt) {
        [sk.fx, sk.fy] = norm(tgt.x - x, tgt.y - y);
      }
      g.enemies.push(sk);
      g.events.push({ type: 'spawnEnemy', x, y, kind: sk.kind });
      return;
    }
  }
}

// Melee-class enemies in contact with a blocking built structure chew it down:
// 1 hp per 0.9s. Pylons are indestructible once built. Returns true while the
// enemy is gnawing so its step can stop there.
function structMaxHp(kind, level) {
  const t = STRUCT_HP[kind];
  return t ? t[level - 1] : buildMaxHp(kind);
}

// Turret HP is type-aware: prisms are deliberately fragile (PRISM_HP, ~2 hits)
// while every other turret type keeps the generic turret HP track. Used wherever
// a turret's maxHp is (re)computed so repair/upgrade respect the prism nerf.
function turretMaxHp(ttype, level) {
  if (ttype === 'prism') return PRISM_HP[Math.min(PRISM_HP.length, Math.max(1, level || 1)) - 1];
  return structMaxHp('turret', level);
}

// A destroyed watchtower throws its gunner out and loses its upgrades.
function towerDown(g, t) {
  for (const p of g.players) {
    if (p.towerId != null && g.towers[p.towerId] === t) p.towerId = null;
  }
  t.occupant = null;
  t.hp = 0;
  t.level = 1;
  t.maxHp = structMaxHp('tower', 1);
  t.progress = 0;
  t.invested = 0;
  g.events.push({ type: 'buildDown', x: t.x, y: t.y, kind: 'tower' });
}

function attackBuilds(g, e, dt) {
  if (!MELEE_KINDS.has(e.kind) || (!g.builds.length && !g.towers.length)) return false;
  let touching = null;
  let tower = null;
  const rr = BUILD_RADIUS + ENEMY_R + 3;
  for (const b of g.builds) {
    if (!b.built || inertBuild(b.kind) || b.kind === 'farm') continue; // farms are trampled, not gnawed
    if (dist2(e, b) < rr * rr) { touching = b; break; }
  }
  if (!touching) {
    for (const t of g.towers) {
      if (t.hp <= 0) continue;
      if (dist2(e, t) < rr * rr) { tower = t; break; }
    }
  }
  if (!touching && !tower) return false;
  if (e.hitCool <= 0) {
    e.hitCool = 0.9;
    const s = touching || tower;
    s.hp -= 1;
    g.events.push({ type: 'buildHit', x: s.x, y: s.y });
    if (s.hp <= 0) {
      if (tower) {
        towerDown(g, tower);
      } else {
        s.hp = 0;
        s.built = false;
        s.progress = 0;
        s.paid = 0;
        // a flattened structure loses its upgrades too
        if (s.level) { s.level = 1; s.maxHp = structMaxHp(s.kind, 1); }
        g.buildEpoch = (g.buildEpoch || 0) + 1; // terrain changed: dormant sleepers re-check
        g.events.push({ type: 'buildDown', x: s.x, y: s.y, kind: s.kind });
      }
    }
  }
  return true;
}

// The base core is gnawed exactly like a structure: 1 dmg per 0.9s of melee
// contact. Loss (hp <= 0) is judged in step()'s end conditions. Beacon-
// defense maps gnaw whichever LIT monolith the enemy touches: at 0 hp it
// goes DARK (beaconDown) — never destroyed, relightable by day.
// Only the night waves (targetCore) and enemies with NO reachable player
// target (pathFailed) gnaw — a wandering camp patrol brushing past a lit
// monolith must never darken it unprovoked.
function attackCore(g, e, dt) {
  if (!MELEE_KINDS.has(e.kind)) return false;
  if (!e.targetCore && !e.pathFailed) return false;
  // DEV core integrity: the center cannot be destroyed. Enemy still stalls at
  // the core (returns true to hold position), but no hp is ever subtracted.
  const coreInvuln = !!(g.cheats && g.cheats.coreInvuln);
  const rr = CORE_R + ENEMY_R + 3;
  if (g.cores) {
    for (let i = 0; i < g.cores.length; i++) {
      const c = g.cores[i];
      if (!c.lit || dist2(e, c) >= rr * rr) continue;
      if (e.hitCool <= 0 && !coreInvuln) {
        e.hitCool = 0.9;
        c.hp -= 1;
        g.events.push({ type: 'coreHit', idx: i, x: c.x, y: c.y, hp: Math.max(0, c.hp) });
        if (c.hp <= 0) {
          c.hp = 0;
          c.lit = false;
          g.events.push({ type: 'beaconDown', idx: i, x: c.x, y: c.y });
        }
      }
      return true;
    }
    return false;
  }
  if (!g.core || g.core.hp <= 0) return false;
  if (dist2(e, g.core) >= rr * rr) return false;
  if (e.hitCool <= 0 && !coreInvuln) {
    e.hitCool = 0.9;
    g.core.hp -= 1;
    g.events.push({ type: 'coreHit', x: g.core.x, y: g.core.y, hp: Math.max(0, g.core.hp) });
  }
  return true;
}

// --- followers: hired combat hands (hound/archer/caster) -------------------
function damageFollower(g, f, dmg = 1) {
  if (f.dead || f.invulnT > 0) return;
  f.hp -= dmg;
  f.invulnT = 0.5; // brief grace so contact doesn't shred a dog in one tick
  g.events.push({ type: 'followerHit', x: f.x, y: f.y, kind: f.kind, hp: Math.max(0, f.hp) });
  if (f.hp <= 0) {
    f.dead = true; // downed followers are gone; their post restocks in 20s
    const h = g.hires[f.post];
    if (h) h.restockT = POST_RESTOCK_T;
    g.events.push({ type: 'followerDown', x: f.x, y: f.y, kind: f.kind, owner: f.owner });
  }
}

// Followers hold a formation slot behind/flanking their owner (recomputed
// from the owner's facing every tick — pure math, no randomness), engage
// enemies within 5 tiles of the owner, and teleport home when 12+ tiles
// adrift. Follower kills credit no seat (no xp).
// A recruited STRANDED OPERATOR: an OWNERLESS (owner === null) weak friendly
// that hustles to the stronghold centre and shoots any enemy within
// DEFENDER_HOLD tiles of base. It rides the g.followers array (one wire/render
// path) but, having no seat, runs this garrison branch instead of the formation
// one. Fully deterministic (no RNG/clock): a stale-path A* via moveToward, the
// same family the hired hands and enemies use.
function stepDefender(g, f, dt) {
  const st = DEFENDER_STATS.defender;
  const base = baseCenter(g);
  // engage the nearest enemy within the base hold ring
  let tgt = null, best = Infinity;
  const hold2 = (TILE * DEFENDER_HOLD) ** 2;
  for (const e of g.enemies) {
    if (e.dead || e.convertedT > 0) continue;
    if (dist2(base, e) >= hold2) continue;
    const d = dist2(f, e);
    if (d < best) { best = d; tgt = e; }
  }
  if (tgt) {
    const w = DEFENDER_ARROW;
    if (best < (w.range * TILE) ** 2 && hasLoS(g, f.x, f.y, tgt.x, tgt.y, blocksSight)) {
      const [fx, fy] = norm(tgt.x - f.x, tgt.y - f.y);
      f.fx = fx; f.fy = fy;
      if (f.cool <= 0) {
        f.cool = 1.4;
        fireWeapon(g, f, w, 'p', tgt);
      }
    } else {
      moveToward(g, f, tgt, dt, st.speed * TILE, FOLLOWER_R);
    }
    return;
  }
  // no prey: march back to the base centre and garrison just off it
  if (dist2(f, base) > (TILE * 1.5) ** 2) {
    moveToward(g, f, base, dt, st.speed * TILE, FOLLOWER_R);
  }
}

function stepFollowers(g, dt) {
  if (!g.followers.length) return;
  for (const f of g.followers) {
    if (f.dead) continue;
    if (f.invulnT > 0) f.invulnT -= dt;
    if (f.cool > 0) f.cool -= dt;
    if (f.owner == null) { stepDefender(g, f, dt); continue; } // ownerless base garrison
    const o = g.players.find(q => q.pid === f.owner);
    if (!o || o.state !== 'active') continue; // owner down: hold position
    // remember the last solid footing — the adrift teleport must never drop
    // a follower into open water chasing a swimming (or skiff-borne) owner
    if (tileAt(g, f.x, f.y) !== '~') { f.landX = f.x; f.landY = f.y; }
    if (dist2(f, o) > (TILE * FOLLOWER_ADRIFT) ** 2) {
      const v = o.riding ? g.vehicles.find(vv => vv.id === o.riding) : null;
      const wet = tileAt(g, o.x, o.y) === '~' || (v && v.kind === 'skiff');
      // a wet owner clamps the teleport ashore: the follower waits there
      const tx = wet ? (f.landX ?? f.x) : o.x;
      const ty = wet ? (f.landY ?? f.y) : o.y;
      if (tx !== f.x || ty !== f.y) {
        f.x = tx;
        f.y = ty;
        f.path = null;
        f.repathT = 0;
      }
    }
    const st = FOLLOWER_STATS[f.kind];
    // engage the nearest (to the follower) enemy within 5 tiles of the owner
    let tgt = null, best = Infinity;
    const er2 = (TILE * FOLLOWER_ENGAGE) ** 2;
    for (const e of g.enemies) {
      if (e.dead || e.convertedT > 0) continue;
      if (dist2(o, e) >= er2) continue;
      const d = dist2(f, e);
      if (d < best) { best = d; tgt = e; }
    }
    if (tgt) {
      if (f.kind === 'hound') {
        if (best < (FOLLOWER_R + ENEMY_R + 2) ** 2) {
          const [fx, fy] = norm(tgt.x - f.x, tgt.y - f.y);
          f.fx = fx; f.fy = fy;
          if (f.cool <= 0) {
            f.cool = 0.8;
            damageEnemy(g, tgt, 1, tgt.x, tgt.y, 'bite');
          }
        } else {
          moveToward(g, f, tgt, dt, st.speed * TILE, FOLLOWER_R);
        }
      } else {
        const w = f.kind === 'archer' ? FOLLOWER_ARROW : FOLLOWER_TORNADO;
        if (best < (w.range * TILE) ** 2 && hasLoS(g, f.x, f.y, tgt.x, tgt.y, blocksSight)) {
          const [fx, fy] = norm(tgt.x - f.x, tgt.y - f.y);
          f.fx = fx; f.fy = fy;
          if (f.cool <= 0) {
            f.cool = f.kind === 'archer' ? 1.6 : 4;
            fireWeapon(g, f, w, 'p', tgt);
          }
        } else {
          moveToward(g, f, tgt, dt, st.speed * TILE, FOLLOWER_R);
        }
      }
      continue;
    }
    // formation: 1.1 tiles behind the owner, flanked 0.8 tiles per slot side
    const side = f.slot % 2 === 0 ? -1 : 1;
    const sx = o.x - o.fx * TILE * 1.1 - o.fy * TILE * 0.8 * side;
    const sy = o.y - o.fy * TILE * 1.1 + o.fx * TILE * 0.8 * side;
    if (Math.hypot(sx - f.x, sy - f.y) > TILE * 0.3) {
      moveToward(g, f, { x: sx, y: sy }, dt, st.speed * TILE, FOLLOWER_R);
    }
  }
}

// --- ground patches: enemies inside catch the status. Patches have no team:
// burn patches (always player-made) never hurt players at all (PvE clarity);
// toxin slows EVERYONE (handled in the player movement block). ---
function stepPatches(g, dt) {
  if (!g.patches.length) return;
  for (let i = g.patches.length - 1; i >= 0; i--) {
    const pa = g.patches[i];
    // rain douses ground fire: burn patches expire twice as fast
    pa.ttl -= (g.weather === 'rain' && pa.kind === 'burn') ? dt * 2 : dt;
    if (pa.ttl <= 0) { g.patches.splice(i, 1); continue; }
    const r2 = pa.r * pa.r;
    // hostile patches (Pyre Beetle bursts) are the mirror image: they sear
    // players standing in them (the hit-grace spaces the burn to ~1 dmg/s)
    // and pass clean over enemies — no enemy-on-enemy friendly fire.
    if (pa.hostile) {
      for (const p of g.players) {
        if (p.state !== 'active' || p.invuln > 0 || dist2(pa, p) >= r2) continue;
        damagePlayer(g, p, 1);
      }
      continue;
    }
    for (const e of g.enemies) {
      // converted enemies fight for the squad: patches pass over allies
      // (no convert-then-poison farming for score/xp/shards)
      if (e.dead || e.convertedT > 0 || dist2(pa, e) >= r2) continue;
      if (pa.kind === 'burn') igniteEnemy(g, e, pa.pid, false);
      else toxEnemy(g, e, pa.pid);
    }
  }
}

// --- per-enemy status clocks: stun decay, burn/toxin dot ticks and contact
// spread chains, mind-control burnout. Runs every tick (grace included). ---
function stepStatuses(g, dt) {
  for (const e of g.enemies) {
    if (e.dead) continue;
    if (e.stunT > 0) e.stunT = Math.max(0, e.stunT - dt);
    if (e.convertedT > 0) {
      e.convertedT -= dt;
      if (e.convertedT <= 0) {
        // mind control burns out: the husk dies quietly (no score, no drop)
        e.convertedT = 0;
        e.dead = true;
        g.events.push({ type: 'die', x: e.x, y: e.y, kind: e.kind, points: 0, combo: 1 });
        continue;
      }
    }
    if (e.burnT > 0) {
      e.burnT -= dt;
      e.burnTick = (e.burnTick || 0) + dt;
      while (e.burnTick >= 1 && !e.dead) {
        e.burnTick -= 1;
        damageEnemy(g, e, 1, e.x, e.y, 'burn', e.burnOwner);
      }
      // a survived burn clears the L4 patch flag too — a later plain ignite
      // must not inherit a stale death-patch
      if (e.burnT <= 0) { e.burnT = 0; e.burnTick = 0; e.burnPatch = false; }
      // spread: contact ignites a non-burning enemy ONCE (chain, no ping-pong)
      if (!e.dead && e.burnT > 0) {
        const rr = (ENEMY_R * 2) ** 2;
        for (const o of g.enemies) {
          if (o === e || o.dead || o.burnT > 0 || o.chainBurned) continue;
          if (dist2(e, o) < rr) {
            o.chainBurned = true;
            igniteEnemy(g, o, e.burnOwner, e.burnPatch);
          }
        }
      }
    }
    if (!e.dead && e.toxT > 0) {
      e.toxT -= dt;
      e.toxTick = (e.toxTick || 0) + dt;
      while (e.toxTick >= 1 && !e.dead) {
        e.toxTick -= 1;
        damageEnemy(g, e, 0.5, e.x, e.y, 'toxin', e.toxOwner);
      }
      if (e.toxT <= 0) { e.toxT = 0; e.toxTick = 0; }
      if (!e.dead && e.toxT > 0) {
        const rr = (ENEMY_R * 2) ** 2;
        for (const o of g.enemies) {
          if (o === e || o.dead || o.toxT > 0 || o.chainToxed) continue;
          if (dist2(e, o) < rr) {
            o.chainToxed = true;
            toxEnemy(g, o, e.toxOwner);
          }
        }
      }
    }
  }
}

// --- mind control: a converted enemy fights its own for 10s. Its shots count
// as player fire with a null owner (no seat earns the xp). ---
function stepConverted(g, e, dt) {
  let tgt = null, best = Infinity;
  for (const o of g.enemies) {
    if (o === e || o.dead || o.convertedT > 0) continue;
    const d = dist2(e, o);
    if (d < best) { best = d; tgt = o; }
  }
  if (!tgt) return;
  const [fx, fy, d] = norm(tgt.x - e.x, tgt.y - e.y);
  e.fx = fx; e.fy = fy;
  if (STATIONARY_KINDS.has(e.kind)) {
    e.cool -= dt;
    if (e.cool <= 0 && d < (e.range || 6 * TILE) && canSee(g, e, tgt)) {
      const n0 = g.shots.length;
      fireWeapon(g, e, enemyWeapon(e.kind), 'p', tgt);
      // never shoot itself: the muzzle overlaps its own hit circle
      for (let i = n0; i < g.shots.length; i++) g.shots[i].hits.push(e.id);
      e.cool = 2;
    }
    return;
  }
  if (d < ENEMY_R * 2 + 2) {
    if (e.hitCool <= 0) {
      e.hitCool = 0.9;
      damageEnemy(g, tgt, 1, tgt.x, tgt.y, 'converted');
    }
    return;
  }
  moveToward(g, e, tgt, dt);
}

// Confirm a turret's chosen type (player fire, or the 8s unattended default).
// Does prism `o` have a valid (awake, in-range, line-of-sight) enemy target?
// Used to elect the firing master of a link group: only a prism that could
// actually fire may claim mastership over a higher-index linked prism.
function prismHasTarget(g, o) {
  const range2 = (TILE * PRISM_RANGE[(o.level || 1) - 1]) ** 2;
  for (const e of g.enemies) {
    if (e.dead || !e.awake || e.convertedT > 0) continue;
    if (dist2(o, e) < range2 && hasLoS(g, o.x, o.y, e.x, e.y, blocksSight)) return true;
  }
  return false;
}

function confirmTurretType(g, b) {
  b.typeSelect = false;
  b.ttype = TURRET_TYPES[b.tsIdx || 0];
  b.selT = 0;
  b.cool = 0;
  // RA2 prism nerf: a confirmed prism re-clamps to its fragile HP track; every
  // other type keeps the generic turret HP it was built with (byte-stable).
  if (b.ttype === 'prism') {
    b.maxHp = turretMaxHp('prism', b.level || 1);
    b.hp = Math.min(b.hp, b.maxHp);
  }
  g.events.push({ type: 'turretType', x: b.x, y: b.y, ttype: b.ttype });
}

function stepEnemy(g, e, dt) {
  if (e.dead) return;
  if (e.hurt > 0) e.hurt -= dt;
  if (e.hitCool > 0) e.hitCool -= dt;
  if (e.gnawScanT > 0) e.gnawScanT -= dt;
  // group alert: a camp-mate spotted trouble — wake on the staggered clock
  if (e.groupWakeT > 0 && !e.awake) {
    e.groupWakeT -= dt;
    if (e.groupWakeT <= 0) {
      e.groupWakeT = 0;
      wakeEnemy(g, e, false);
    }
  }
  // lava sears enemies at 1 hp/s; their pathing routes around the flows, so
  // a burning enemy was knocked back, spawned in, or cut a corner
  if (tileAt(g, e.x, e.y) === '!') {
    e.lavaT = (e.lavaT || 0) + dt;
    while (e.lavaT >= LAVA_ENEMY_TICK && !e.dead) {
      e.lavaT -= LAVA_ENEMY_TICK;
      damageEnemy(g, e, 1, e.x, e.y, 'lava');
    }
    if (e.dead) return;
  } else if (e.lavaT) e.lavaT = 0;
  // Mind-controlled enemies fight for the squad; stunned ones do nothing at
  // all (no actions, no movement — the clocks tick in stepStatuses).
  if (e.convertedT > 0) {
    if (e.stunT > 0) return;
    stepConverted(g, e, dt);
    return;
  }
  if (e.stunT > 0) return;
  // Permanently-unreachable enemies (3 consecutive failed searches — see
  // moveToward / the gnaw scan) stand DORMANT: no target scan, no pathing,
  // no march. They stir again when the world changes (a build completes or
  // falls, a door opens — buildEpoch), when a player walks into aggro reach
  // (capped at 12 tiles so x100-aggro wave hunters don't wake map-wide), or
  // when damaged (damageEnemy clears the flag). Big maps only.
  if (e.dormant && !g.arcade) {
    if ((g.buildEpoch || 0) !== e.dormantEpoch) {
      e.dormant = false;
      e.pathFails = 0;
      e.path = null;
      e.repathT = 0;
      e.gnawScanT = 0;
    } else {
      const wr = Math.min(g.dark ? e.aggro * 0.75 : e.aggro, TILE * 12);
      let near = false;
      for (const p of g.players) {
        if (p.state === 'active' && dist2(e, p) < wr * wr) { near = true; break; }
      }
      if (near) e.dormant = false; // stale fail caches still pace the retries
      else return;
    }
  }
  const [tgt, best] = nearestTarget(g, e);
  if (!tgt) return;

  // Dark missions shrink every aggro radius to 75% (leash shrinks with it).
  let aggro = g.dark ? e.aggro * 0.75 : e.aggro;

  // Sniper spotters: a living camp sniper inside 8 tiles calls targets for
  // its group-mates (+4 tiles aggro). Kill the sniper first: the camp is
  // literally blinded back to its own eyes.
  if (e.group !== undefined && e.kind !== 'sniper') {
    const r2s = (TILE * SPOTTER_RANGE) ** 2;
    for (const o of g.enemies) {
      if (!o.dead && o !== e && o.kind === 'sniper' && o.group === e.group && dist2(e, o) < r2s) {
        aggro += TILE * SPOTTER_BONUS;
        break;
      }
    }
  }

  // Sleeping enemies hold their post until a player is seen inside aggro
  // range, bumps into them, or damages them (handled in damageEnemy).
  // Spotting by sight or bump raises the whole camp (alertGroup) — a silent
  // kill from beyond their eyes never does.
  if (!e.awake) {
    if (best < aggro * aggro && canSee(g, e, tgt)) {
      wakeEnemy(g, e);
      alertGroup(g, e);
    } else if (best < (TILE * 2.2) ** 2) {
      wakeEnemy(g, e);
      alertGroup(g, e);
    } else {
      // patrols: unaware mobile enemies walk their waypoint loop at 0.6x
      // speed, deterministic round-robin — pre-aggro wandering only
      if (e.patrol && e.patrol.length && !STATIONARY_KINDS.has(e.kind)) {
        const wp = e.patrol[e.patrolI % e.patrol.length];
        if (Math.hypot(wp.x - e.x, wp.y - e.y) < TILE * 0.45) {
          e.patrolI = (e.patrolI + 1) % e.patrol.length;
        } else {
          moveToward(g, e, wp, dt, e.speed * PATROL_SPEED);
        }
      }
      return;
    }
  }

  // Leash (big maps only — arcade keeps classic behavior byte-identical):
  // an awake enemy whose nearest target drifts beyond aggro*1.8 disengages.
  // Mobile kinds walk back to their post and fall asleep there; stationary
  // kinds simply go back to ambush sleep on the spot.
  //
  // STRONGHOLD GARRISON (e.leashR set): the leash is measured by the player's
  // distance from the KEEP (home), not enemy-to-target — so a garrison chases
  // a runner only while that runner stays near the stronghold, then peels off
  // and walks home the instant the player clears the keep's leash radius. The
  // re-aggro test mirrors it: a player back inside the keep aggro re-engages.
  if (!g.arcade) {
    const garrison = e.leashR > 0;
    const homeBest = garrison ? dist2(tgt, { x: e.homeX, y: e.homeY }) : best;
    const leash = garrison ? e.leashR : aggro * LEASH_MULT;
    if (!e.returning && homeBest > leash * leash) {
      if (STATIONARY_KINDS.has(e.kind)) { e.aimT = 0; e.awake = false; return; }
      e.returning = true;
    }
    if (e.returning) {
      if ((homeBest < aggro * aggro && canSee(g, e, tgt)) || best < (TILE * 2.2) ** 2) {
        e.returning = false;
      } else {
        if (Math.hypot(e.homeX - e.x, e.homeY - e.y) < TILE * 0.6) {
          e.returning = false;
          e.awake = false;
          return;
        }
        // gnaw through barricades blocking the way home (else a wall built
        // behind a returning enemy pins it forever)
        if (attackBuilds(g, e, dt)) return;
        const dHome = Math.hypot(e.homeX - e.x, e.homeY - e.y);
        moveToward(g, e, { x: e.homeX, y: e.homeY }, dt);
        // wedged against something indestructible (a pylon): give up and
        // fall asleep on the spot instead of pushing forever
        if (dHome < (e.bestHome ?? Infinity) - 0.5) {
          e.bestHome = dHome;
          e.stuckT = 0;
        } else {
          e.stuckT = (e.stuckT || 0) + dt;
          if (e.stuckT > 2.5) {
            e.returning = false;
            e.awake = false;
            e.stuckT = 0;
            e.bestHome = undefined;
            return;
          }
        }
        return; // no attacking players while returning
      }
    }
  }

  const [fx, fy, d] = norm(tgt.x - e.x, tgt.y - e.y);
  e.fx = fx; e.fy = fy;

  if (attackBuilds(g, e, dt)) return;
  if (attackCore(g, e, dt)) return;

  // --- NIGHTMARE melee (relic event only): spider/zombie/hellhound chase like
  // the classic chassis; the ghost glides STRAIGHT THROUGH walls (no collision)
  // and the reaper lands a heavy 2-damage blow. All deterministic.
  if (e.kind === 'spider' || e.kind === 'zombie' || e.kind === 'hellhound'
      || e.kind === 'ghost' || e.kind === 'reaper') {
    if (e.kind === 'ghost') {
      // a ghost ignores every blocker: it floats in a straight bearing toward
      // the target, phasing through rock, trees and structures alike.
      e.x += e.fx * e.speed * dt;
      e.y += e.fy * e.speed * dt;
    } else if (g.arcade) {
      moveCircle(g, e, e.fx * e.speed * dt, e.fy * e.speed * dt, ENEMY_R);
    } else {
      moveToward(g, e, tgt, dt);
    }
    contactNightmare(g, e, dist2(e, tgt), tgt);
    return;
  }
  // skeleton (bone-thrower) + banshee (wail) hold at range and fire like archers
  if (e.kind === 'skeleton' || e.kind === 'banshee') {
    e.cool -= dt;
    if (d < e.range && (g.arcade || canSee(g, e, tgt)) && !tgt.nonPlayer) {
      if (e.cool <= 0) {
        fireWeapon(g, e, enemyWeapon(e.kind), 'e', tgt);
        e.cool = (e.kind === 'banshee' ? 2.0 : 1.6) + (e.id % 3) * 0.2;
      }
    } else {
      moveToward(g, e, tgt, dt);
    }
    return;
  }

  // husk/alpha/beetle melee exactly like the classic chassis; the stalker
  // shares it after resolving its blink below
  if (e.kind === 'grunt' || e.kind === 'skitter' || e.kind === 'bulwark'
      || e.kind === 'husk' || e.kind === 'alpha' || e.kind === 'beetle' || e.kind === 'stalker') {
    // Phase Stalker: on its per-id cadence it blinks up to 3 tiles toward the
    // target (never closer than a tile out, never onto blocked ground — the
    // first open landing along the line wins; walls don't stop a phase).
    if (e.kind === 'stalker') {
      e.blinkT -= dt;
      if (e.blinkT <= 0) {
        e.blinkT = STALKER_BLINK_T;
        if (d > TILE * 2) {
          const hop = Math.min(STALKER_BLINK_TILES * TILE, d - TILE);
          for (let r = hop; r >= TILE; r -= TILE * 0.5) {
            const nx = e.x + e.fx * r, ny = e.y + e.fy * r;
            if (!collides(g, nx, ny, ENEMY_R)) {
              g.events.push({ type: 'blink', x: e.x, y: e.y, tx: nx, ty: ny, kind: e.kind });
              e.x = nx; e.y = ny;
              e.path = null;
              e.repathT = 0;
              break;
            }
          }
        }
      }
    }
    if (g.arcade) {
      moveCircle(g, e, e.fx * e.speed * dt, e.fy * e.speed * dt, ENEMY_R);
      contactPlayer(g, e, best, tgt);
    } else {
      moveToward(g, e, tgt, dt);
      contactPlayer(g, e, dist2(e, tgt), tgt);
    }
    return;
  }

  if (e.kind === 'acolyte') {
    // Null Acolyte: pure support — NEVER attacks players. It shadows the
    // pack toward its target, holds at range, and pulses every 2.5s: the
    // nearest unwarded packmate gains a one-hit absorb shield; every 4th
    // pulse also mends the nearest wounded packmate 1 hp (the 25% heal rate).
    e.cool -= dt;
    if (e.cool <= 0) {
      e.cool = ACOLYTE_PULSE;
      e.pulseN = (e.pulseN || 0) + 1;
      const r2 = e.range * e.range;
      let ward = null, bestW = r2;
      for (const o of g.enemies) {
        if (o === e || o.dead || o.shielded || o.convertedT > 0) continue;
        const dd = dist2(e, o);
        if (dd < bestW) { bestW = dd; ward = o; }
      }
      if (ward) {
        ward.shielded = true;
        g.events.push({ type: 'enemyShield', x: ward.x, y: ward.y, kind: ward.kind });
      }
      if (e.pulseN % ACOLYTE_HEAL_EVERY === 0) {
        let mend = null, bestM = r2;
        for (const o of g.enemies) {
          if (o === e || o.dead || o.convertedT > 0 || o.hp >= o.maxHp) continue;
          const dd = dist2(e, o);
          if (dd < bestM) { bestM = dd; mend = o; }
        }
        if (mend) {
          mend.hp = Math.min(mend.maxHp, mend.hp + 1);
          g.events.push({ type: 'enemyHeal', x: mend.x, y: mend.y, kind: mend.kind, hp: mend.hp });
        }
      }
    }
    if (d > e.range) moveToward(g, e, tgt, dt);
    return;
  }

  if (e.kind === 'wraith') {
    // Volt Wraith: mobile zapper — closes until its chain-zap reaches, then
    // holds and fires every 2.2s at ONE operative.
    e.cool -= dt;
    if (d < e.range && (g.arcade || canSee(g, e, tgt)) && !tgt.nonPlayer) {
      if (e.cool <= 0) {
        fireWeapon(g, e, enemyWeapon('wraith'), 'e', tgt);
        e.cool = WRAITH_COOL;
      }
    } else {
      moveToward(g, e, tgt, dt);
    }
    return;
  }

  if (e.kind === 'charger') {
    if (e.state === 'windup') {
      e.windup -= dt;
      if (e.windup <= 0) {
        e.state = 'dash';
        e.dashT = 0.34;
        e.dashFx = e.chargeFx;
        e.dashFy = e.chargeFy;
        g.events.push({ type: 'dash', x: e.x, y: e.y, kind: e.kind });
      }
      return;
    }
    if (e.state === 'dash') {
      const v = 5.4 * TILE * dt;
      moveCircle(g, e, e.dashFx * v, e.dashFy * v, ENEMY_R);
      e.fx = e.dashFx; e.fy = e.dashFy;
      contactPlayer(g, e, dist2(e, tgt), tgt);
      e.dashT -= dt;
      if (e.dashT <= 0) e.state = 'idle';
      return;
    }
    e.cool -= dt;
    if (d < e.range && e.cool <= 0 && (g.arcade || canSee(g, e, tgt))) {
      e.state = 'windup';
      e.windup = 0.55;
      e.chargeFx = e.fx;
      e.chargeFy = e.fy;
      e.cool = 2.2;
      g.events.push({ type: 'telegraph', x: e.x, y: e.y, tx: tgt.x, ty: tgt.y, kind: e.kind });
    } else if (g.arcade) {
      moveCircle(g, e, e.fx * e.speed * dt, e.fy * e.speed * dt, ENEMY_R);
    } else {
      moveToward(g, e, tgt, dt);
    }
    contactPlayer(g, e, dist2(e, tgt), tgt);
    return;
  }

  if (e.kind === 'archer' || e.kind === 'spawner') {
    e.cool -= dt;
    if (e.cool <= 0 && d < (e.range || 7 * TILE) && (g.arcade || canSee(g, e, tgt))) {
      fireWeapon(g, e, enemyWeapon(e.kind), 'e', tgt);
      e.cool = e.kind === 'spawner' ? 2.1 : 2.0;
    }
    if (e.kind === 'spawner') {
      e.spawnCool -= dt;
      const spawnOk = g.arcade
        ? g.enemies.length < 36
        : g.enemies.length < 90 && countNear(g, e, TILE * 8) < 6;
      if (e.spawnCool <= 0 && spawnOk) {
        spawnSkitter(g, e, tgt);
        e.spawnCool = g.arcade ? 3.0 : 6.5;
      }
    }
    return;
  }

  if (e.kind === 'sniper') {
    if (e.aimT > 0) {
      e.aimT -= dt;
      e.aimX = tgt.x;
      e.aimY = tgt.y;
      if (e.aimT <= 0) {
        fireWeapon(g, e, enemyWeapon(e.kind), 'e', tgt);
        e.cool = 2.8;
      }
      return;
    }
    e.cool -= dt;
    if (e.cool <= 0 && d < e.range && (g.arcade || canSee(g, e, tgt))) {
      e.aimT = 0.9;
      e.aimX = tgt.x;
      e.aimY = tgt.y;
      g.events.push({ type: 'aim', x: e.x, y: e.y, tx: tgt.x, ty: tgt.y, kind: e.kind });
    }
    return;
  }

  if (e.kind === 'boss') {
    e.cool -= dt;
    e.spawnCool -= dt;
    const phase = e.hp <= e.maxHp * 0.5 ? 2 : 1;
    const chase = phase === 2 ? 0.8 : 0.5;
    if (g.arcade) {
      moveCircle(g, e, e.fx * TILE * chase * dt, e.fy * TILE * chase * dt, ENEMY_R + 6);
    } else {
      moveToward(g, e, tgt, dt, TILE * chase, ENEMY_R + 6);
    }
    contactPlayer(g, e, dist2(e, tgt), tgt);
    if (e.cool <= 0 && d < e.range) {
      fireWeapon(g, e, enemyWeapon(e.kind), 'e', tgt);
      e.cool = phase === 2 ? 0.75 : 1.25;
    }
    const spawnOk = g.arcade
      ? g.enemies.length < 34
      : g.enemies.length < 90 && countNear(g, e, TILE * 9) < 8;
    if (e.spawnCool <= 0 && spawnOk) {
      spawnSkitter(g, e, tgt);
      e.spawnCool = g.arcade
        ? (phase === 2 ? 2.2 : 3.8)
        : (phase === 2 ? 4.5 : 7);
    }
  }
}

// Deterministic wave entry points: for each position along the given map
// edge, the outermost passable tile in the 2-tile border band is a candidate
// (grid order, stable). The n spawn points are chosen evenly spaced across
// the candidate list. Pure grid math — no randomness.
function waveEntryPoints(g, edge, n) {
  const horiz = edge === 'n' || edge === 's';
  const len = horiz ? g.w : g.h;
  const cands = [];
  for (let i = 0; i < len; i++) {
    for (let depth = 0; depth < 2; depth++) {
      let tx, ty;
      if (edge === 'n') { tx = i; ty = depth; }
      else if (edge === 's') { tx = i; ty = g.h - 1 - depth; }
      else if (edge === 'w') { tx = depth; ty = i; }
      else { tx = g.w - 1 - depth; ty = i; }
      // never spawn a wave INTO lava (it is walkable, but searing); void and
      // the other hard blockers are already excluded by blocksMove
      if (!blocksMove(g.grid[ty][tx]) && g.grid[ty][tx] !== '!') {
        cands.push({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE });
        break;
      }
    }
  }
  const pts = [];
  if (!cands.length) return pts;
  for (let i = 0; i < n; i++) pts.push(cands[Math.floor(((i + 0.5) * cands.length) / n)]);
  return pts;
}

// Fire every wave whose time has come: spawn its letters at the edge entry
// points as awake hunters (aggro x100 — they never leash home), respecting
// the global 90-enemy cap. Each wave fires exactly once.
function maybeOpenGate(g) {
  if (!g.gate || g.gate.open) return;
  if (g.gate.built >= g.gate.need && g.elapsed >= g.gate.after) {
    g.gate.open = true;
    g.events.push({ type: 'gateOpen', x: g.exitX, y: g.exitY });
  }
}

function stepWaves(g) {
  if (!g.waves || !g.waves.length) return;
  for (const w of g.waves) {
    if (w.fired || g.elapsed < w.at) continue;
    w.fired = true;
    const room = Math.max(0, 90 - g.enemies.length);
    // DIFFICULTY thins the wave first (extreme == full count), then room clamps.
    const count = Math.min(scaleCount(g, w.letters.length), room); // drop overflow
    const pts = waveEntryPoints(g, w.edge, count);
    for (let i = 0; i < pts.length; i++) {
      const e = makeEnemy(w.letters[i], pts[i].x, pts[i].y, g.nextEnemyId++);
      e.awake = true;
      e.aggro *= 100;
      scaleEnemyHp(g.hpMult, e); // stronghold strength arc
      g.enemies.push(e);
    }
    // x,y = center of the entry band, for FX/audio.
    const cx = w.edge === 'w' ? TILE : w.edge === 'e' ? (g.w - 1) * TILE : g.w * TILE / 2;
    const cy = w.edge === 'n' ? TILE : w.edge === 's' ? (g.h - 1) * TILE : g.h * TILE / 2;
    g.events.push({ type: 'wave', edge: w.edge, count: pts.length, x: cx, y: cy });
  }
}

// True when every operative is down/out (relic FAILS — world restores, no bonus).
// Players in 'pick' (waiting to redeploy) count as down too: nobody is standing.
function allPlayersDown(g) {
  if (!g.players.length) return false;
  return g.players.every(p => p.state !== 'active');
}

// Restore the world to its pre-event look and clear every remaining nightmare
// (they dissolve). One code path for both the survive and the fail finish.
function endHorde(g) {
  const h = g.horde;
  if (!h || h.ended) return;
  h.ended = true;
  g.dark = h.prevDark;
  g.weather = h.prevWeather;
  for (const e of g.enemies) {
    if (e.dead || !NIGHTMARE_KINDS.includes(e.kind)) continue;
    e.dead = true; // dissolve: no score, no shard drop
    g.events.push({ type: 'nightmareDissolve', x: e.x, y: e.y, kind: e.kind });
  }
}

// RELIC AWAKENING — the horde event. A NO-OP unless g.musicBox is enabled and
// complete, so every other level/mode is byte-identical (it never touches g
// otherwise). Called once in step() right after stepWaves.
//
// LATCH: the first tick g.musicBox.complete is true, latch g.horde, darken the
// world, swap in the thunderstorm, and push {type:'relicAwaken'}.
// ESCALATE: while the song plays, fire bursts on a cadence that tightens toward
// the climax; each burst spawns nightmare hunters from ALL FOUR edges, the type
// mix and density ramping with progress = (elapsed-startedAt)/dur.
// END: when dur elapses -> {type:'relicSurvived', score+breakdown}; if every
// player is down at any point -> {type:'relicFailed'} (no bonus). Either finish
// restores g.dark/g.weather and dissolves the leftover nightmares.
function stepHorde(g, dt) {
  if (!g.musicBox || !g.musicBox.enabled) return;
  // LATCH on the rising edge of complete.
  if (g.musicBox.complete && !g.horde) {
    const dur = hordeDur(g);
    g.horde = {
      startedAt: g.elapsed, dur,
      tick: 0, nextAt: g.elapsed, // first burst fires immediately
      hits: 0, deaths: 0, ended: false, result: null,
      prevDark: g.dark, prevWeather: g.weather,
    };
    g.dark = true;
    g.weather = 'thunderstorm';
    g.events.push({ type: 'relicAwaken', x: g.musicBox.altar.x, y: g.musicBox.altar.y, dur });
  }
  const h = g.horde;
  if (!h || h.ended) return;

  // FAIL: the squad is wiped (every seat down/out/picking) -> relic goes
  // dormant, world restores, no bonus.
  if (allPlayersDown(g)) {
    endHorde(g);
    h.result = 'failed';
    g.events.push({ type: 'relicFailed', x: g.musicBox.altar.x, y: g.musicBox.altar.y });
    return;
  }

  const since = g.elapsed - h.startedAt;
  // SURVIVED: the song has played out.
  if (since >= h.dur) {
    endHorde(g);
    const base = HORDE_BASE_BONUS;
    const penalty = h.hits * HORDE_HIT_PENALTY + h.deaths * HORDE_DEATH_PENALTY;
    const score = Math.max(HORDE_FLOOR_BONUS, base - penalty);
    g.score += score;
    h.result = 'survived';
    // SUPERWEAPON UNLOCK: clearing the music-box awakening earns the squad the
    // right to build the one-shot relic superweapon (nuke / weather machine).
    g.superweaponUnlocked = true;
    g.events.push({
      type: 'relicSurvived', x: g.musicBox.altar.x, y: g.musicBox.altar.y,
      score, base, hits: h.hits, deaths: h.deaths,
      hitPenalty: HORDE_HIT_PENALTY, deathPenalty: HORDE_DEATH_PENALTY,
      points: Math.round(g.score),
    });
    return;
  }

  // BURST schedule: progress 0..1 across the song. Cadence tightens and the
  // per-edge count climbs toward the climax. Pure functions of since/dur and a
  // monotonic tick counter — fully deterministic, no clocks/randomness.
  const progress = h.dur > 0 ? since / h.dur : 1;
  if (g.elapsed >= h.nextAt) {
    const interval = HORDE_BURST_MAX - (HORDE_BURST_MAX - HORDE_BURST_MIN) * progress;
    h.nextAt = g.elapsed + interval;
    // DIFFICULTY scales the per-edge density (extreme == full); never below 1.
    const perEdge = scaleCount(g, HORDE_PER_EDGE_MIN
      + Math.floor((HORDE_PER_EDGE_MAX - HORDE_PER_EDGE_MIN) * progress + 0.0001));
    // the deadlier nightmares unlock as the song crests: at the climax the full
    // roster is in play; the opening is spider/zombie fodder.
    const pool = Math.max(2, Math.ceil(NIGHTMARE_LETTERS.length * (0.3 + 0.7 * progress)));
    let spawned = 0;
    // a monotonic per-event sequence over EVERY nightmare spawned: stepping it
    // by 1 per spawn (seeded by the burst tick) walks the unlocked roster slice
    // evenly, so a burst is a mix — never all-one-kind — and stays deterministic.
    let seq = h.tick * 3;
    for (let ei = 0; ei < WAVE_EDGES.length; ei++) {
      const edge = WAVE_EDGES[ei];
      const room = Math.max(0, 90 - g.enemies.length);
      if (room <= 0) break;
      const count = Math.min(perEdge, room);
      const pts = waveEntryPoints(g, edge, count);
      for (let i = 0; i < pts.length; i++) {
        // index ramps with progress (pool widens to the full roster at the
        // climax); seq spreads the picks across the unlocked slice.
        const idx = seq++ % pool;
        const letter = NIGHTMARE_LETTERS[idx];
        const e = makeEnemy(letter, pts[i].x, pts[i].y, g.nextEnemyId++);
        e.awake = true;
        e.aggro *= 100; // hunters: never leash home
        e.targetCore = true; // march on the base if no player is reachable
        scaleEnemyHp(g.hpMult, e);
        g.enemies.push(e);
        spawned++;
      }
      const cx = edge === 'w' ? TILE : edge === 'e' ? (g.w - 1) * TILE : g.w * TILE / 2;
      const cy = edge === 'n' ? TILE : edge === 's' ? (g.h - 1) * TILE : g.h * TILE / 2;
      g.events.push({ type: 'horde', edge, count: pts.length, x: cx, y: cy, progress });
    }
    h.tick++;
    if (spawned) g.events.push({ type: 'hordeBurst', tick: h.tick, progress, count: spawned });
  }
}

// --- RELIC SUPERWEAPON ------------------------------------------------------
// The whole module is GATED: it never touches g unless a relic superweapon has
// been built (g.superweapon) or a hazard field is live (g.hazards.length), so
// every other mode / snapshot is byte-identical.

// A superweapon may be ASSEMBLED on an open floor tile that is clear of walls /
// cover and well away from extracts and spawns (mirrors the RA2 build-site
// rule, HOLDOUT-scaled to tiles). Pure grid math — fully deterministic.
function canBuildSuperweaponAt(g, x, y) {
  const c = tileAt(g, x, y);
  if (c !== '.') return false; // floor only
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  for (let dy = -SUPER_SITE_WALL_MIN; dy <= SUPER_SITE_WALL_MIN; dy++) {
    for (let dx = -SUPER_SITE_WALL_MIN; dx <= SUPER_SITE_WALL_MIN; dx++) {
      const nx = tx + dx, ny = ty + dy;
      if (ny < 0 || nx < 0 || ny >= g.h || nx >= g.w) continue;
      const t = g.grid[ny][nx];
      if (t === '#' || t === 'o') return false; // 1 tile clear of wall/cover
    }
  }
  const exitR2 = (SUPER_SITE_EXIT_MIN * TILE) ** 2;
  for (let yy = 0; yy < g.h; yy++) {
    for (let xx = 0; xx < g.w; xx++) {
      const t = g.grid[yy][xx];
      if (t !== 'E' && t !== 'P') continue;
      const cx = (xx + 0.5) * TILE, cy = (yy + 0.5) * TILE;
      if ((cx - x) ** 2 + (cy - y) ** 2 < exitR2) return false; // 4 tiles off E/P
    }
  }
  if (collides(g, x, y, BUILD_RADIUS)) return false; // free of other structures
  return true;
}

// Player input drives the relic superweapon lifecycle. Called per active seat
// from the player loop. inp.superBuild ('nuke'|'weather') asks to assemble on
// the seat's tile; inp.superFire is a plain TRIGGER (no aim) that auto-targets
// the densest hostile cluster once the device is ready. Both are no-ops until
// g.superweaponUnlocked is true.
function stepSuperweaponInput(g, p, inp) {
  if (!g.superweaponUnlocked) return;
  const sw = g.superweapon;
  // BUILD: one device per run. A fresh edge of inp.superBuild on a valid site
  // starts a 6s standing channel (channelT) — interruptible by moving/downing.
  if (!sw && SUPER_KINDS.has(inp.superBuild) && !p.superBuildPrev) {
    const c = tileCenter(p.x, p.y);
    if (canBuildSuperweaponAt(g, c.x, c.y)) {
      g.superweapon = {
        type: inp.superBuild, state: 'building',
        buildT: 0, chargeT: SUPER_CHARGE_SECONDS, used: false,
        x: c.x, y: c.y, ownerPid: p.pid, hp: SUPER_DEVICE_HP, maxHp: SUPER_DEVICE_HP,
      };
      g.events.push({ type: 'superweaponSite', x: c.x, y: c.y, kind: inp.superBuild, pid: p.pid });
    }
  }
  p.superBuildPrev = SUPER_KINDS.has(inp.superBuild);
  // FIRE: when the device is ready the OWNER just TRIGGERS it (one button, no
  // aim) — the sim deterministically auto-targets the densest hostile cluster
  // (superweaponAutoTarget) and fires there. If nothing worth hitting exists the
  // trigger is a no-op so the charge is kept (no wasted one-shot on empty air).
  const fw = g.superweapon;
  if (fw && fw.state === 'ready' && !fw.used && p.pid === fw.ownerPid
      && inp.superFire && !p.superFirePrev) {
    const tgt = superweaponAutoTarget(g, fw);
    if (tgt) fireSuperweapon(g, fw, tgt.x, tgt.y);
  }
  p.superFirePrev = !!inp.superFire;
}

// AUTO-TARGET: deterministically pick the impact point that maximizes HOSTILE
// concentration within the weapon's kill radius. Candidate centers are every
// live enemy position plus every enemy stronghold center; for each we count the
// live hostiles within the radius and keep the densest. Stronghold candidates
// win ties at equal density (so the strike favors a fortified keep over a loose
// pack), then a lower candidate index breaks any remaining tie — fully ordered,
// no Math.random. Returns the tile-center {x,y}, or null when there is nothing
// to hit (no live enemy AND no stronghold) so the caller keeps the charge.
// Friendlies never enter the math: the blast is friendly-fire-proof regardless
// of where it lands, so the only thing that matters is enemy density.
function superweaponAutoTarget(g, sw) {
  const radTiles = sw.type === 'weather' ? STORM_RADIUS : NUKE_RADIUS;
  const r2 = (radTiles * TILE) ** 2;
  const live = g.enemies.filter(e => !e.dead);
  // Candidate centers: enemy positions first (rank 0), strongholds after
  // (rank 1, so they win equal-count ties). Each carries a stable order key.
  const cands = [];
  for (const e of live) cands.push({ x: e.x, y: e.y, rank: 0, key: e.id });
  if (g.strongholds) for (const sh of g.strongholds) cands.push({ x: sh.x, y: sh.y, rank: 1, key: sh.id });
  let best = null;
  for (const c of cands) {
    let count = 0;
    for (const e of live) {
      if ((e.x - c.x) ** 2 + (e.y - c.y) ** 2 <= r2) count++;
    }
    if (!best
      || count > best.count
      || (count === best.count && c.rank > best.rank)
      || (count === best.count && c.rank === best.rank && c.key < best.key)) {
      best = { x: c.x, y: c.y, count, rank: c.rank, key: c.key };
    }
  }
  // No enemies at all: fall back to the largest stronghold (biggest garrison),
  // tie-broken by lowest id, so a trigger still lands somewhere meaningful.
  if (best && best.count === 0 && g.strongholds && g.strongholds.length) {
    let sh = null;
    for (const s of g.strongholds) {
      const n = s.garrison ? s.garrison.length : 0;
      if (!sh || n > sh.n || (n === sh.n && s.id < sh.id)) sh = { x: s.x, y: s.y, n, id: s.id };
    }
    if (sh) best = { x: sh.x, y: sh.y };
  }
  if (!best || (best.count === 0 && !(g.strongholds && g.strongholds.length))) return null;
  return tileCenter(best.x, best.y);
}

// Per-step device clock: BUILD channel -> CHARGE -> READY. Called once per step
// (a no-op when no device exists). The owner must keep standing on the device's
// tile to channel it up; walking off / going down pauses the build channel.
function stepSuperweapon(g, dt) {
  const sw = g.superweapon;
  if (!sw) return;
  // ENEMY ATTACK: while it is still being built or charging the device is a
  // gnawable target (1 dmg per 0.9s of melee contact, like a structure). At 0
  // hp it is DESTROYED — and since the relic weapon is one-use, it's gone for
  // good (mirrors RA2 "destroying the silo resets the timer", harsher here).
  if (sw.state === 'building' || sw.state === 'charging') {
    const rr = (BUILD_RADIUS + ENEMY_R + 3) ** 2;
    for (const e of g.enemies) {
      if (e.dead || !MELEE_KINDS.has(e.kind) || e.hitCool > 0) continue;
      if ((e.x - sw.x) ** 2 + (e.y - sw.y) ** 2 >= rr) continue;
      e.hitCool = 0.9;
      sw.hp -= 1;
      g.events.push({ type: 'buildHit', x: sw.x, y: sw.y });
      if (sw.hp <= 0) {
        sw.hp = 0;
        sw.state = 'wrecked';
        g.events.push({ type: 'superweaponDown', x: sw.x, y: sw.y, kind: sw.type });
        break;
      }
    }
    if (sw.state === 'wrecked') return;
  }
  if (sw.state === 'building') {
    const owner = g.players.find(q => q.pid === sw.ownerPid);
    const here = owner && owner.state === 'active'
      && Math.hypot(owner.x - sw.x, owner.y - sw.y) <= TILE * BUILD_REACH;
    if (here) {
      sw.buildT += dt;
      if (sw.buildT >= SUPER_BUILD_TIME) {
        // CONSTRUCTION COMPLETE: start the ~60s charge AND spawn the tiny
        // punish wave so the squad must defend the new device.
        sw.state = 'charging';
        sw.buildT = SUPER_BUILD_TIME;
        sw.chargeT = SUPER_CHARGE_SECONDS;
        g.events.push({ type: 'buildSuperweapon', x: sw.x, y: sw.y, kind: sw.type });
        spawnSuperweaponMiniWave(g, sw);
      }
    }
    return;
  }
  if (sw.state === 'charging') {
    sw.chargeT -= dt;
    if (sw.chargeT <= 0) {
      sw.chargeT = 0;
      sw.state = 'ready';
      g.events.push({ type: 'superweaponReady', x: sw.x, y: sw.y, kind: sw.type });
    }
  }
}

// A TINY response wave near a finished device: a 4-enemy poke (a fraction of a
// real 15-30 wave), each aimed at the device. Deterministic open-cell ring scan
// (openTileNear, the same the relic altar uses), seeded by the device tile.
function spawnSuperweaponMiniWave(g, sw) {
  const roster = sw.type === 'weather' ? ['g', 'g', 'w', 'w'] : ['g', 'g', 'g', 'r'];
  const baseSeed = (Math.floor(sw.x / TILE) * 31 + Math.floor(sw.y / TILE) * 7) | 0;
  for (let i = 0; i < roster.length; i++) {
    const spot = openTileNear(g, sw.x, sw.y, 3, 4, baseSeed + i * 5);
    if (!spot) continue;
    const e = makeEnemy(roster[i], spot.x, spot.y, g.nextEnemyId++);
    e.awake = true;
    e.aggro *= 100; // hunters: march on the device / nearest player
    const dx = sw.x - spot.x, dy = sw.y - spot.y, d = Math.hypot(dx, dy) || 1;
    e.fx = dx / d; e.fy = dy / d;
    scaleEnemyHp(g.hpMult, e);
    g.enemies.push(e);
    g.events.push({ type: 'spawnEnemy', x: spot.x, y: spot.y, kind: e.kind });
  }
}

// FIRE: the one shot. Marks the device spent (no recharge) and resolves the
// payoff — the nuke schedules a delayed instant flatten + radiation crater; the
// weather machine schedules a lightning storm DoT field over the target.
function fireSuperweapon(g, sw, ax, ay) {
  const c = tileCenter(ax, ay);
  sw.used = true;
  sw.state = 'spent';
  sw.targetX = c.x;
  sw.targetY = c.y;
  if (sw.type === 'nuke') {
    g.events.push({ type: 'nukeStrike', x: c.x, y: c.y, radius: NUKE_RADIUS * TILE });
    // launch arc telegraph: the blast resolves after a short flight (~1s) so the
    // auto-chosen impact reads as intentional and the squad can group/react. The
    // blast is friendly-fire-proof, but the telegraph still marks the spot.
    g.hazards.push({ kind: 'nukeFlight', x: c.x, y: c.y, radius: NUKE_RADIUS * TILE, ttl: NUKE_FLIGHT_DELAY });
  } else {
    g.events.push({ type: 'stormStart', x: c.x, y: c.y, radius: STORM_RADIUS * TILE });
    g.hazards.push({
      kind: 'storm', x: c.x, y: c.y, radius: STORM_RADIUS * TILE,
      ttl: STORM_DURATION + STORM_WARNING_DELAY, warnT: STORM_WARNING_DELAY,
      strikeT: STORM_WARNING_DELAY, strikes: 0, ownerPid: sw.ownerPid,
    });
  }
  g.events.push({ type: 'superweaponFired', x: c.x, y: c.y, kind: sw.type });
}

// Detonate the nuke: instant AoE that one-shots every HOSTILE in the circle
// (full damage in the 3-tile core, lethal falloff out to 4.5) and leaves a
// lingering radiation pool. FRIENDLY-FIRE-PROOF: players, friendly builds
// (turrets/walls/barricades), recruited defenders (ownerless followers) and
// cores are NEVER hit, even when caught in the radius — the auto-target may
// land near friendlies but never harms them. Only enemies take damage.
function nukeDetonate(g, x, y) {
  const r = NUKE_RADIUS * TILE, full = NUKE_FULL_RADIUS * TILE;
  const r2 = r * r, full2 = full * full;
  g.events.push({ type: 'explode', x, y, radius: r, who: 'p' });
  for (const e of g.enemies) {
    if (e.dead) continue;
    const d2 = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d2 > r2) continue;
    damageEnemy(g, e, d2 <= full2 ? NUKE_DAMAGE : NUKE_FALLOFF_DAMAGE, e.x, e.y, 'nuke');
  }
  g.hazards.push({ kind: 'radiation', x, y, radius: RAD_RADIUS * TILE, ttl: RAD_TTL, tick: 0 });
}

// Tick every live hazard field: the nuke's flight telegraph detonates at 0,
// radiation chip-kills enemies / downs players inside it, and the storm scatters
// lightning bolts across its footprint for its duration. Drops expired fields.
// A no-op (and never allocates) when g.hazards is empty.
function stepHazards(g, dt) {
  if (!g.hazards.length) return;
  for (const hz of g.hazards) {
    if (hz.kind === 'nukeFlight') {
      hz.ttl -= dt;
      if (hz.ttl <= 0) { nukeDetonate(g, hz.x, hz.y); hz.done = true; }
    } else if (hz.kind === 'radiation') {
      hz.ttl -= dt;
      // FRIENDLY-FIRE-PROOF: the crater only chip-kills enemies — players,
      // builds, defenders and cores standing in the pool take no damage.
      // enemies: 1 dmg every RAD_ENEMY_TICK s (serious ongoing area denial)
      hz.tick = (hz.tick || 0) + dt;
      while (hz.tick >= RAD_ENEMY_TICK) {
        hz.tick -= RAD_ENEMY_TICK;
        for (const e of g.enemies) {
          if (e.dead) continue;
          if ((e.x - hz.x) ** 2 + (e.y - hz.y) ** 2 <= hz.radius * hz.radius) {
            damageEnemy(g, e, 1, e.x, e.y, 'radiation');
          }
        }
      }
      if (hz.ttl <= 0) hz.done = true;
    } else if (hz.kind === 'storm') {
      hz.ttl -= dt;
      if (hz.warnT > 0) hz.warnT -= dt;
      else {
        hz.strikeT -= dt;
        while (hz.strikeT <= 0) {
          hz.strikeT += STORM_STRIKE_INTERVAL;
          stormBolt(g, hz);
        }
      }
      if (hz.ttl <= 0) hz.done = true;
    }
  }
  g.hazards = g.hazards.filter(hz => !hz.done);
}

// One lightning bolt: a seeded-random cell inside the storm footprint takes a
// powerful area-ish strike (LightningWarhead). The scatter is a deterministic
// LCG seeded off the storm origin + a monotonic strike counter (same family as
// the shard-placement LCG), so it's spread/probabilistic yet fully reproducible
// — a packed stronghold gets shredded over the duration while a lone fast
// enemy can slip between strikes. A direct hit downs a player.
function stormBolt(g, hz) {
  hz.strikes++;
  let seed = ((Math.floor(hz.x / TILE) * 73856093) ^ (Math.floor(hz.y / TILE) * 19349663) ^ (hz.strikes * 83492791)) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  // polar sample with a CENTER bias (r = R * rnd^0.7): strikes scatter across the
  // whole footprint but cluster inward, so a packed base in the AoE is devastated
  // over the duration while a straggler at the rim can slip a few bolts.
  const ang = rnd() * Math.PI * 2;
  const rad = hz.radius * Math.pow(rnd(), 0.7);
  const bx = hz.x + Math.cos(ang) * rad;
  const by = hz.y + Math.sin(ang) * rad;
  const br = STORM_BOLT_RADIUS * TILE, br2 = br * br;
  g.events.push({ type: 'lightningStrike', x: bx, y: by, radius: br });
  // FRIENDLY-FIRE-PROOF: a bolt only fries enemies. Players, builds, defenders
  // and cores caught under the storm footprint take no damage.
  for (const e of g.enemies) {
    if (e.dead) continue;
    if ((e.x - bx) ** 2 + (e.y - by) ** 2 <= br2) damageEnemy(g, e, STORM_BOLT_DAMAGE, e.x, e.y, 'storm');
  }
}

// --- bastion mode: day/night cycle, dusk waves, mutants -------------------

// Wave composition scales with the night: base 6 on night 1 up to 14 mixed
// on night 5+. The frontier roster joins the siege as it deepens:
//   n1:  husk fodder with skitters             (z z w cycle)
//   n2:  Pyre Beetles join, plus one Fork Alpha (z z w u cycle + one f)
//   n3:  grunts/chargers harden the line, plus one Null Acolyte
//                                              (z g w u r cycle + f + q)
//   n4:  bulwarks anchor every 5th slot; Volt Wraiths stalk in every 6th
//   n5+: Phase Stalkers complete the blend, every 7th slot
// The f/q specials take the trailing slots so every staple still shows.
// Size also scales with the squad: ceil(base * (0.6 + 0.2 * players)) — 0.8x
// solo, 1.0x duo, 1.4x for a full couch. The global 90 cap still rules.
// `mult` is the stronghold wave-size multiplier (def.bastion.waveMult,
// 1.0..2.6 across the arc); 1 keeps the classic bastion sizes exactly.
function bastionWaveLetters(n, players = 1, mult = 1, endless = false) {
  // Endless keeps the count climbing past the night-5 plateau (to a 30 base);
  // the global 90-on-field cap still rules, so it never floods. Campaign defs
  // (endless=false) keep the exact 14 cap — every stronghold plays unchanged.
  const base = Math.min(endless ? 30 : 14, 4 + n * 2);
  const size = Math.max(1, Math.ceil(base * (0.6 + 0.2 * players) * mult));
  const cycle = n >= 3 ? 'zgwur' : n >= 2 ? 'zzwu' : 'zzw';
  const letters = [];
  for (let i = 0; i < size; i++) {
    if (n >= 5 && i % 7 === 6) letters.push('x');
    else if (n >= 4 && i % 6 === 5) letters.push('v');
    else if (n >= 4 && i % 5 === 4) letters.push('s');
    else letters.push(cycle[i % cycle.length]);
  }
  if (n >= 2 && size >= 2) letters[size - 1] = 'f';
  if (n >= 3 && size >= 4) letters[size - 2] = 'q';
  return letters.join('');
}

function applyMutation(e, mut) {
  if (!mut) return;
  e.mutation = mut;
  if (mut === 'feral') e.speed *= 1.5;
  else if (mut === 'bulk') { e.hp *= 2; e.maxHp *= 2; e.speed *= 0.75; }
  // volatile and split trigger on death (killEnemy)
}

// One wave per dusk from a rotating cardinal edge; blood moons pour from two
// different edges — a full wave on the first, a 60% detachment on the second
// (a heavy night, not a flat double) — mutate every enemy, add +1 hp and
// +15% speed. Normal waves from night 3 on carry +15% hp (rounded up).
// Mutation roll is the contract formula (nightNo*31+i)%5 over
// [none, feral, bulk, volatile, split]; blood moons re-roll 'none' as %4.
// `off` offsets the mutation roll for the night's SECOND/THIRD waves
// (def.bastion.wavesPerNight) so repeat waves don't clone their mutations.
function spawnNightWave(g, off = 0) {
  const n = g.cycle.nightNo;
  const endless = !!(g.bastion && g.bastion.endless);
  const letters = bastionWaveLetters(n, g.players.length, (g.bastion && g.bastion.waveMult) || 1, endless);
  const edges = g.cycle.bloodMoon
    ? [WAVE_EDGES[(n - 1) % 4], WAVE_EDGES[(n + 1) % 4]]
    : [WAVE_EDGES[(n - 1) % 4]];
  // Finale bosses: def.bastion.bossNights [6,8,10] marches exactly ONE
  // Entropy boss at the head of each listed night's FIRST wave (first edge
  // only, so a blood-moon double edge never doubles the boss). Def-gated:
  // classic bastion defs never carry the field and play exactly as before.
  // Boss cadence: the campaign's scheduled bossNights, OR — in endless — one
  // Entropy boss every bossEvery nights (default 5; a daily twist may tighten
  // it). The def carries no list in endless; first edge only.
  const bossEvery = g.bastion.bossEvery || 5;
  let bossDue = off === 0 && (
    (Array.isArray(g.bastion.bossNights) && g.bastion.bossNights.includes(n))
    || (endless && bossEvery > 0 && n % bossEvery === 0)
  ) ? 1 : 0;
  let mi = off; // mutation index runs across the whole night's spawns
  for (let ei = 0; ei < edges.length; ei++) {
    const edge = edges[ei];
    const boss = bossDue > 0;
    bossDue = 0;
    // blood-moon SECOND edge: a 60% detachment, not a full clone
    const base = ei === 0 ? letters
      : letters.slice(0, Math.max(1, Math.round(letters.length * 0.6)));
    const ls = boss ? 'b' + base : base;
    // A scheduled boss ALWAYS marches — a one-slot exception to the global
    // 90 cap (the rest of its wave still respects the ceiling), so a packed
    // field can never silently swallow a finale boss.
    const room = Math.max(boss ? 1 : 0, 90 - g.enemies.length);
    const count = Math.min(ls.length, room);
    const pts = waveEntryPoints(g, edge, count);
    for (let i = 0; i < pts.length; i++) {
      const e = makeEnemy(ls[i], pts[i].x, pts[i].y, g.nextEnemyId++);
      e.awake = true;
      e.aggro *= 100; // hunters: never leash home
      e.targetCore = true;
      scaleEnemyHp(g.hpMult, e); // stronghold strength arc (before mutation)
      // beacon-defense: split the wave across the LIT monoliths, round-robin
      if (g.cores) {
        const lit = [];
        for (let k = 0; k < g.cores.length; k++) if (g.cores[k].lit) lit.push(k);
        if (lit.length) e.coreI = lit[mi % lit.length];
      }
      const roll = (n * 31 + mi) % 5;
      let mut = roll === 0 ? null : MUTATIONS[roll - 1];
      if (g.cycle.bloodMoon && !mut) mut = MUTATIONS[(n * 31 + mi) % 4];
      mi++;
      applyMutation(e, mut);
      if (g.cycle.bloodMoon) {
        // blood moon: +1 hp on top of the full mutation, and a +15% pace
        e.hp += 1;
        e.maxHp += 1;
        e.speed *= 1.15;
      } else if (n >= 3) {
        // late normal nights harden: +15% hp, rounded up
        e.hp = Math.ceil(e.hp * 1.15);
        e.maxHp = Math.ceil(e.maxHp * 1.15);
      }
      if (endless && n > 5) {
        // endless has no finish line, so the threat must keep climbing past the
        // campaign's night-5 ceiling: +4.5% hp per night beyond the fifth.
        const k = 1 + 0.045 * (n - 5);
        e.hp = Math.ceil(e.hp * k);
        e.maxHp = Math.ceil(e.maxHp * k);
      }
      g.enemies.push(e);
    }
    const cx = edge === 'w' ? TILE : edge === 'e' ? (g.w - 1) * TILE : g.w * TILE / 2;
    const cy = edge === 'n' ? TILE : edge === 's' ? (g.h - 1) * TILE : g.h * TILE / 2;
    g.events.push({ type: 'wave', edge, count: pts.length, x: cx, y: cy });
  }
}

// Day/night clock. Dusk flips to night, numbers it (1-based), spawns its
// wave; dawn after the final night wins the mission outright (no gate, no
// extraction). A blood-moon warning sounds 30s before its dusk.
function stepCycle(g, dt) {
  const cy = g.cycle;
  if (!cy) return;
  // RELIC AWAKENING FREEZE: while the awakening horde is live (g.horde latched
  // and not yet ended — stepHorde ran just before us this tick), the day/night
  // clock is PAUSED. stepHorde forces darkness + thunder for the whole wave, so
  // advancing cy.t here could fire a normal dusk/dawn (a daytime or darkness
  // transition) mid-event and fight the forced look. Freezing means cy.t does
  // not tick down, no day events/blood warnings/phase flips run, and the cycle
  // resumes EXACTLY where it left off when endHorde clears the wave. Gated: this
  // is a no-op unless a relic completed (story/bastion only), so every other
  // run stays byte-identical.
  if (g.horde && !g.horde.ended) return;
  // Endless: no fixed night count — blood moons recur every 3rd night from the
  // 3rd, and dawn never declares victory (the run ends only when the base falls).
  const endless = !!(g.bastion && g.bastion.endless);
  const bloodEvery = g.bastion.bloodEvery || 3; // default every 3rd night; a daily twist may tighten it
  const isBloodNight = k => endless ? (bloodEvery > 0 && k % bloodEvery === 0) : g.bastion.bloodMoons.includes(k);
  const evX = g.core ? g.core.x : g.w * TILE / 2;
  const evY = g.core ? g.core.y : g.h * TILE / 2;
  cy.t -= dt;
  if (cy.phase === 'day') {
    const nextNight = cy.nightNo + 1;
    if (!cy.warned && cy.t <= BLOOD_WARN_LEAD && (endless || nextNight <= g.bastion.nights)
        && isBloodNight(nextNight)) {
      cy.warned = true;
      g.events.push({ type: 'bloodWarn', nightNo: nextNight, x: evX, y: evY });
    }
    // DAY EVENTS run on the day's own ELAPSED clock (dayE), not on cy.t —
    // the horn collapses cy.t, so a horn-shortened day simply never reaches
    // an unfired beat (the contract: early call skips what hasn't fired)
    if (g.bastion.dayEvents !== false) {
      cy.dayE = (cy.dayE || 0) + dt;
      if (!cy.probeDone && cy.dayE >= PROBE_AT) { cy.probeDone = true; spawnDayProbe(g); }
      if (!cy.dropDone && cy.dayE >= DROP_AT) { cy.dropDone = true; spawnSupplyDrop(g); }
    }
    if (cy.t <= 0) {
      cy.phase = 'night';
      cy.nightNo = nextNight;
      cy.t = g.bastion.nightLen;
      cy.bloodMoon = isBloodNight(cy.nightNo);
      cy.warned = false;
      cy.dayE = 0;
      g.events.push({ type: 'dusk', nightNo: cy.nightNo, bloodMoon: cy.bloodMoon, x: evX, y: evY });
      spawnNightWave(g, 0);
      cy.waveN = 1;
    }
    return;
  }
  // stronghold difficulty: def.bastion.wavesPerNight (1..3) pours the night's
  // later waves in at even intervals; 1 (the default) is classic bastion.
  const wpn = Math.max(1, Math.min(3, g.bastion.wavesPerNight || 1));
  if ((cy.waveN || 0) < wpn && cy.t > 0 && cy.t <= g.bastion.nightLen * (1 - (cy.waveN || 0) / wpn)) {
    spawnNightWave(g, (cy.waveN || 0) * 17);
    cy.waveN = (cy.waveN || 0) + 1;
  }
  if (cy.t <= 0) {
    g.events.push({ type: 'dawn', nightNo: cy.nightNo, x: evX, y: evY });
    if (!endless && cy.nightNo >= g.bastion.nights) {
      g.status = 'cleared';
      g.events.push({ type: 'clear', x: g.w * TILE / 2, y: g.h * TILE / 2, points: Math.round(g.score) });
      return;
    }
    cy.phase = 'day';
    cy.bloodMoon = false;
    cy.t = g.bastion.dayLen;
    // a fresh day re-arms its two scheduled beats
    cy.dayE = 0;
    cy.probeDone = false;
    cy.dropDone = false;
  }
}

// --- bastion day events: scavenger probes, supply drops, the horn ----------

// The base's center: the single core, or the beacons' centroid.
function baseCenter(g) {
  if (g.core) return { x: g.core.x, y: g.core.y };
  if (g.cores && g.cores.length) {
    return {
      x: g.cores.reduce((s, c) => s + c.x, 0) / g.cores.length,
      y: g.cores.reduce((s, c) => s + c.y, 0) / g.cores.length,
    };
  }
  return { x: g.w * TILE / 2, y: g.h * TILE / 2 };
}

// First OPEN tile (walkable, unsearing, not inside a structure) scanned
// deterministically over a radius band around a world point: radii step
// outward tile by tile, 16 angle spokes per ring starting on a seeded spoke.
// Returns tile-center world coords or null when the whole band is blocked.
function openTileNear(g, wx, wy, rMin, rMax, seed) {
  for (let r = rMin; r <= rMax; r++) {
    for (let k = 0; k < 16; k++) {
      const a = (((seed + k) % 16) / 16) * Math.PI * 2;
      const tx = Math.round(wx / TILE + Math.cos(a) * r - 0.5);
      const ty = Math.round(wy / TILE + Math.sin(a) * r - 0.5);
      if (tx < 1 || ty < 1 || tx >= g.w - 1 || ty >= g.h - 1) continue;
      const c = g.grid[ty][tx];
      if (blocksMove(c) || c === '!') continue;
      const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
      if (collides(g, x, y, CAPTIVE_R)) continue; // builds/towers/cores
      return { x, y };
    }
  }
  return null;
}

// Deterministic open-cell pick by a stepping index (theme ambient patches walk
// a counter through this): scans interior tiles from `idx`, returns the first
// passable one. Pure function of the grid + idx — fully reproducible.
function openTileByIndex(g, idx) {
  const cols = Math.max(1, g.w - 2), rows = Math.max(1, g.h - 2);
  const total = cols * rows;
  for (let k = 0; k < total; k++) {
    const n = (((idx + k) % total) + total) % total;
    const tx = 1 + (n % cols), ty = 1 + Math.floor(n / cols);
    const c = g.grid[ty][tx];
    if (blocksMove(c) || c === '!') continue;
    const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
    if (collides(g, x, y, CAPTIVE_R)) continue;
    return { x, y };
  }
  return null;
}

// SCAVENGER PROBE (day+25s): a small pack of light enemies off a deterministic
// edge that PROWLS to the base perimeter and beds down there — they ride the
// normal walk-home machinery (awake + returning toward a home ring 5-9 tiles
// off the base center), so they aggro/leash/fight exactly like any wanderer
// and are NEVER core-targeted. Composition deepens with the night count, hp
// scales with the stronghold arc (g.hpMult). All seeded by nightNo: same day,
// same probe — and the probe edge (3n+1 mod 4) provably never matches the
// coming night's first wave edge (n mod 4), so days read different from dusks.
function spawnDayProbe(g) {
  const n = g.cycle.nightNo;
  const count = 3 + ((n * 7 + 2) % 3); // 3-5
  const mix = n >= 4 ? 'zwug' : n >= 2 ? 'zwu' : 'zzw';
  const edge = WAVE_EDGES[(n * 3 + 1) % 4];
  const room = Math.max(0, 90 - g.enemies.length);
  const pts = waveEntryPoints(g, edge, Math.min(count, room));
  if (!pts.length) return;
  const base = baseCenter(g);
  for (let i = 0; i < pts.length; i++) {
    const e = makeEnemy(mix[i % mix.length], pts[i].x, pts[i].y, g.nextEnemyId++);
    scaleEnemyHp(g.hpMult, e); // stronghold strength arc, like the night waves
    const home = openTileNear(g, base.x, base.y, PROBE_HOME_TILES[0], PROBE_HOME_TILES[1], n * 5 + i * 3);
    if (home) { e.homeX = home.x; e.homeY = home.y; }
    e.awake = true;
    e.returning = true; // walk-home = the prowl in; aggro normal, leash normal
    g.enemies.push(e);
  }
  const cx = edge === 'w' ? TILE : edge === 'e' ? (g.w - 1) * TILE : g.w * TILE / 2;
  const cy2 = edge === 'n' ? TILE : edge === 's' ? (g.h - 1) * TILE : g.h * TILE / 2;
  g.events.push({ type: 'probe', edge, count: pts.length, x: cx, y: cy2 });
}

// SUPPLY DROP (day+45s): a loot chest lands on an open tile 8-14 tiles from
// the base. Loot is deterministic by nightNo; the event carries the landing
// spot for the client's banner/map ping and the renderer's crate flare.
function spawnSupplyDrop(g) {
  const n = g.cycle.nightNo;
  const base = baseCenter(g);
  const spot = openTileNear(g, base.x, base.y, DROP_TILES[0], DROP_TILES[1], n * 11 + 5);
  if (!spot) return;
  const menu = [['shards', 10 + n * 2], ['medkit', 2], ['cracker', 2], ['shield', 1], ['toxin', 2]];
  const [loot, amount] = menu[n % menu.length];
  g.chests.push({ x: spot.x, y: spot.y, opened: false, loot, amount });
  g.events.push({ type: 'supplyDrop', x: spot.x, y: spot.y, loot });
}

// THE HORN: hold act HORN_HOLD_T at the base core (or any LIT beacon) during
// a day to call the night early — cy.t collapses to a 5s dusk warning and the
// squad pool banks floor(skipped/6) shards, min 3. ACT PRIORITY: like beacon
// relight (stepBeacons), the horn rides the PARALLEL hold rail — it never
// claims or consumes the edge-triggered act chain in stepPlayers, and busy
// seats (tower/vehicle/shop/carousel) never charge it. UNLIKE relight (whose
// dark-beacon gate makes accidents impossible), the horn only charges when
// the post is the player's NEAREST hold-claimant — a held act that is
// building, repairing, upgrading, shopping, forging or rebuilding something
// closer must never ALSO skip the day (mirror of the renderer's nearest-
// prompt rule). Refused at night, while a blood-moon warning sounds
// (cy.warned), and inside a day's last 5s.
function hornClaimDist2(g, p) {
  // squared distance to the nearest OTHER act-hold claimant in reach
  const r2b = (TILE * BUILD_REACH) ** 2;
  let best = Infinity;
  for (const b of g.builds) {
    if (b.built && b.kind === 'farm') continue; // harvest is a press, not a hold
    const d = dist2(p, b);
    if (d < r2b && d < best) best = d;
  }
  for (const t of g.towers) {
    if ((t.hp ?? 1) > 0) continue; // occupy is a press; only REBUILD holds
    const d = dist2(p, t);
    if (d < r2b && d < best) best = d;
  }
  const r2s = (TILE * SHOP_REACH) ** 2;
  for (const s of g.shops) {
    const d = dist2(p, s);
    if (d < r2s && d < best) best = d;
  }
  for (const f of g.forges) {
    const d = dist2(p, f);
    if (d < r2b && d < best) best = d;
  }
  return best;
}
function stepHorn(g, inputs, dt) {
  const cy = g.cycle;
  if (!cy || g.status !== 'play') return;
  if (cy.phase !== 'day' || cy.warned || cy.t <= HORN_LEAD) { cy.hornT = 0; return; }
  const posts = g.cores ? g.cores.filter(c => c.lit) : (g.core ? [g.core] : []);
  if (!posts.length) { cy.hornT = 0; return; }
  const r2 = (TILE * BUILD_REACH) ** 2;
  let holders = 0;
  let at = null;
  for (const p of g.players) {
    if (p.state !== 'active' || p.towerId != null || p.riding || p.shopping || p.selecting) continue;
    const inp = inputs[p.pid] || {};
    if (!inp.act) continue;
    let dPost = Infinity;
    let post = null;
    for (const c of posts) {
      const d = dist2(p, c);
      if (d < r2 && d < dPost) { dPost = d; post = c; }
    }
    if (!post || dPost >= hornClaimDist2(g, p)) continue; // ties go to the work
    holders++;
    if (!at) at = post;
  }
  if (!holders) { cy.hornT = 0; return; }
  cy.hornT = (cy.hornT || 0) + dt * holders;
  if (cy.hornT < HORN_HOLD_T) return;
  cy.hornT = 0;
  const skipped = Math.max(0, cy.t - HORN_LEAD); // the warning seconds still elapse
  const bonus = Math.max(HORN_MIN_BONUS, Math.floor(skipped / HORN_BONUS_DIV));
  g.shards += bonus; // bastion is co-op: the one squad pool
  cy.t = HORN_LEAD;
  g.events.push({ type: 'horn', nightNo: cy.nightNo + 1, bonus, x: at.x, y: at.y });
}

// --- beacon-defense: day relight + the Anchorcraft early extraction ---------
// A dark monolith relights under a daytime act-hold (1.5s, scaled by holders)
// once the pool can pay the 8 shards: full hp, lit again, 'beaconLit'.
function stepBeacons(g, inputs, dt) {
  if (!g.cores) return;
  const day = g.cycle && g.cycle.phase === 'day';
  const r2 = (TILE * BUILD_REACH) ** 2;
  for (let i = 0; i < g.cores.length; i++) {
    const c = g.cores[i];
    if (c.lit || !day) { c.relightT = 0; continue; }
    let holders = 0;
    let payer = null;
    for (const p of g.players) {
      if (p.state !== 'active' || p.towerId != null || p.riding || p.shopping || p.selecting) continue;
      const inp = inputs[p.pid] || {};
      if (inp.act && dist2(p, c) < r2) {
        holders++;
        if (!payer) payer = p;
      }
    }
    if (!holders || getShards(g, payer) < RELIGHT_COST) { c.relightT = 0; continue; }
    c.relightT = (c.relightT || 0) + dt * holders;
    if (c.relightT < RELIGHT_HOLD_T) continue;
    c.relightT = 0;
    addShards(g, payer, -RELIGHT_COST);
    c.lit = true;
    c.hp = c.maxHp;
    g.events.push({ type: 'beaconLit', idx: i, x: c.x, y: c.y });
  }
}

// From night 2 onward, ALL FOUR beacons lit at once WHILE IT IS NIGHT (a real
// feat under wave pressure) lands the Anchorcraft near the base ('shipDown').
// The ship persists once landed; boarding stays optional. Boarding itself is
// EDGE-triggered through the act priority chain in stepPlayers (lowest rung,
// after NPC talk) so a held repair/shop/relight press can never double as a
// commitment to leave. Walking out of board reach steps back OFF the ramp:
// launch ('shipLaunch', immediate clear + full-clear bonus) requires every
// active player physically at the vessel.
function stepShip(g, inputs, dt) {
  if (!g.cores || g.status !== 'play') return;
  if (!g.ship) {
    if (!g.cycle || g.cycle.phase !== 'night' || g.cycle.nightNo < 2) return;
    if (!g.cores.every(c => c.lit)) return;
    // touchdown: nearest open spot ring-scanned from the beacons' centroid
    const cx = g.cores.reduce((s, c) => s + c.x, 0) / g.cores.length;
    const cy = g.cores.reduce((s, c) => s + c.y, 0) / g.cores.length;
    let lx = cx, ly = cy;
    outer: for (let r = 0; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx * TILE, y = cy + dy * TILE;
          if (x > TILE && y > TILE && x < (g.w - 1) * TILE && y < (g.h - 1) * TILE
              && !collides(g, x, y, PLAYER_R)) {
            lx = x;
            ly = y;
            break outer;
          }
        }
      }
    }
    g.ship = { x: lx, y: ly, landed: true };
    g.events.push({ type: 'shipDown', x: lx, y: ly });
    return;
  }
  // walking away cancels a boarding — aboard means AT the vessel, right now
  const r2 = (TILE * SHIP_BOARD_TILES) ** 2;
  for (const p of g.players) {
    if (p.aboard && dist2(p, g.ship) >= r2) p.aboard = false;
  }
  const active = g.players.filter(p => p.state === 'active');
  if (active.length && active.every(p => p.aboard)) {
    g.score += SHIP_CLEAR_BONUS;
    g.events.push({ type: 'shipLaunch', x: g.ship.x, y: g.ship.y, points: SHIP_CLEAR_BONUS });
    for (const p of active) extractPlayer(g, p);
    g.status = 'cleared';
    g.events.push({ type: 'clear', x: g.ship.x, y: g.ship.y, points: Math.round(g.score) });
  }
}

// --- structure hold chain: repair, then upgrade (shared by builds/towers) ---
// Returns true while the hold is consumed by repair or upgrade; false means
// the structure is at full hp and max level, so the hold may dismantle it.
// `payer` is the first holding player in seat order — in ctf their team's
// pool foots the bill; everywhere else it is the one squad pool anyway.
function holdStructure(g, s, kind, holders, dt, payer) {
  if (s.hp < s.maxHp) {
    s.repairT = (s.repairT || 0) + dt * holders;
    while (s.repairT >= REPAIR_TICK && s.hp < s.maxHp) {
      if (getShards(g, payer) + 1e-9 < REPAIR_COST) { s.repairT = 0; break; } // stall: no shards
      addShards(g, payer, -REPAIR_COST);
      s.hp = Math.min(s.maxHp, s.hp + 1);
      s.repairT -= REPAIR_TICK;
      if (s.evT <= 0) {
        g.events.push({ type: 'repair', x: s.x, y: s.y, hp: s.hp });
        s.evT = 0.5;
      }
    }
    return true;
  }
  s.repairT = 0;
  const level = s.level || 1;
  if (level < 3) {
    const cost = UPGRADE_COST(level);
    let delta = Math.min((holders * dt) / (cost * 0.6), 1 - (s.upProgress || 0));
    const pay = Math.min(delta * cost, getShards(g, payer));
    delta = pay / cost;
    if (delta > 0) {
      addShards(g, payer, -pay);
      s.upProgress = (s.upProgress || 0) + delta;
      if (s.evT <= 0) {
        g.events.push({ type: 'build', x: s.x, y: s.y });
        s.evT = 0.5;
      }
      if (s.upProgress >= 1 - 1e-9) {
        s.upProgress = 0;
        s.level = level + 1;
        // a prism stays on its fragile HP track through upgrades (RA2 nerf)
        s.maxHp = kind === 'turret' && s.ttype === 'prism' ? turretMaxHp('prism', s.level) : structMaxHp(kind, s.level);
        s.hp = s.maxHp;
        s.invested = (s.invested ?? s.cost ?? 0) + cost;
        g.events.push({ type: 'built', x: s.x, y: s.y, kind, level: s.level });
      }
    }
    return true; // an upgradeable structure never falls through to dismantle
  }
  return false;
}

// --- shops -----------------------------------------------------------------
function shopNear(g, p) {
  const r2 = (TILE * SHOP_REACH) ** 2;
  for (const s of g.shops) if (dist2(p, s) < r2) return s;
  return null;
}

// Build sites and repairable structures own their act radius — a shop only
// engages when no structure work could claim the hold.
function structureInReach(g, p) {
  const r2 = (TILE * BUILD_REACH) ** 2;
  for (const b of g.builds) {
    if (b.built && (inertBuild(b.kind) || b.kind === 'farm')) continue;
    if (dist2(p, b) < r2) return true;
  }
  for (const t of g.towers) if (dist2(p, t) < r2) return true;
  return false;
}

// A just-built turret waiting in typeSelect claims the act-hold within build
// reach — unless an OPEN build site shares the radius (build sites outrank
// the carousel). The nearest such turret wins; null means no carousel here.
function typeSelectNear(g, p) {
  const r2 = (TILE * BUILD_REACH) ** 2;
  let sel = null, best = r2;
  for (const b of g.builds) {
    const d = dist2(p, b);
    if (d >= r2) continue;
    if (!b.built) return null; // an open build site outranks the carousel
    if (b.kind === 'turret' && b.typeSelect && d < best) { best = d; sel = b; }
  }
  return sel;
}

// --- inventory + placement mode --------------------------------------------
// Inventory and placement state are GATED: a player gains p.inventory only once
// they buy a placeable, and p.placing only while a ghost is up. Snapshots emit
// these keys only when present, so every classic snapshot stays byte-stable.

// Add `count` of a placeable kind to a player's inventory (stacking same kind).
function addToInventory(p, kind, count = 1) {
  if (!PLACEABLES[kind]) return;
  if (!p.inventory) p.inventory = [];
  const slot = p.inventory.find(s => s.kind === kind);
  if (slot) slot.count += count;
  else p.inventory.push({ kind, count });
  if (p.invIdx === undefined) p.invIdx = 0;
}

function inventoryCount(p, kind) {
  if (!p.inventory) return 0;
  const slot = p.inventory.find(s => s.kind === kind);
  return slot ? slot.count : 0;
}

// Consume one of a placeable kind; drops emptied slots and keeps invIdx sane.
function consumeInventory(p, kind) {
  if (!p.inventory) return false;
  const i = p.inventory.findIndex(s => s.kind === kind);
  if (i < 0 || p.inventory[i].count <= 0) return false;
  if (--p.inventory[i].count <= 0) p.inventory.splice(i, 1);
  if (p.inventory.length === 0) { p.inventory = undefined; p.invIdx = undefined; }
  else if (p.invIdx >= p.inventory.length) p.invIdx = p.inventory.length - 1;
  return true;
}

// Snap a world point to its tile center.
function tileCenter(wx, wy) {
  return { x: (Math.floor(wx / TILE) + 0.5) * TILE, y: (Math.floor(wy / TILE) + 0.5) * TILE };
}

// REUSABLE targeting cursor (the superweapon phase calls this for map
// targeting too). Drives a tile-snapped {x,y} cursor from an anchor: a mouse
// world point (inp.aimX/aimY) places it absolutely, else arrow/stick EDGES step
// it one tile per press. The cursor is clamped to the map and to `reach` tiles
// of the anchor. Edge state lives on `prev` (caller owns it). Returns the new
// cursor; never mutates the player's own position.
export function placementCursor(cur, inp, prev, anchor, w, h, reach) {
  let cx = cur.x, cy = cur.y;
  if (inp.aimX !== undefined && inp.aimY !== undefined) {
    const c = tileCenter(inp.aimX, inp.aimY);
    cx = c.x; cy = c.y;
  } else {
    // edge-stepped: one tile per fresh press, deterministic and frame-rate free
    const eR = !!inp.right && !prev.right, eL = !!inp.left && !prev.left;
    const eD = !!inp.down && !prev.down, eU = !!inp.up && !prev.up;
    if (eR) cx += TILE;
    if (eL) cx -= TILE;
    if (eD) cy += TILE;
    if (eU) cy -= TILE;
  }
  prev.right = !!inp.right; prev.left = !!inp.left;
  prev.down = !!inp.down; prev.up = !!inp.up;
  // clamp inside the map AND inside reach tiles of the anchor (tile-snapped)
  cx = Math.max(TILE * 0.5, Math.min((w - 0.5) * TILE, cx));
  cy = Math.max(TILE * 0.5, Math.min((h - 0.5) * TILE, cy));
  const r = reach * TILE;
  const dx = cx - anchor.x, dy = cy - anchor.y;
  if (dx * dx + dy * dy > r * r) {
    const d = Math.hypot(dx, dy) || 1;
    const c = tileCenter(anchor.x + (dx / d) * r, anchor.y + (dy / d) * r);
    cx = c.x; cy = c.y;
  }
  return { x: cx, y: cy };
}

// A ghost tile is plottable when it sits on open ground (no wall/water/void),
// is free of other built structures and the map core, and is clear of enemies.
function canPlaceAt(g, x, y) {
  const t = tileAt(g, x, y);
  if (blocksMove(t)) return false;
  const rr = BUILD_RADIUS * 2;
  for (const b of g.builds) {
    if (dist2({ x, y }, b) < rr * rr) return false;
  }
  if (g.core && dist2({ x, y }, g.core) < (CORE_R + BUILD_RADIUS) ** 2) return false;
  for (const e of g.enemies) {
    if (!e.dead && dist2({ x, y }, e) < (ENEMY_R + BUILD_RADIUS) ** 2) return false;
  }
  return true;
}

// Lay one placeable structure (already paid via inventory) at a tile center.
// Returns the new build, already standing, or null if the tile is blocked.
function layStructure(g, p, placeKind, x, y) {
  const def = PLACEABLES[placeKind];
  if (!def || !canPlaceAt(g, x, y)) return null;
  const kind = def.build;
  const level = 1;
  const maxHp = kind === 'turret' ? structMaxHp('turret', level) : structMaxHp(kind, level) || buildMaxHp(kind);
  const b = {
    x, y, kind, cost: def.cost,
    progress: 1, paid: def.cost, built: true,
    hp: maxHp, maxHp, cool: 0, evT: 0,
    invested: def.cost,
    ...(STRUCT_HP[kind] ? { level } : {}),
    team: p.team,
  };
  if (kind === 'turret') {
    // a placed turret enters the same RA2 carousel a built one does
    b.typeSelect = true; b.tsIdx = 0; b.selT = 0; b.attended = false;
  }
  g.builds.push(b);
  g.buildEpoch = (g.buildEpoch || 0) + 1;
  g.events.push({ type: 'placed', x, y, kind });
  return b;
}

// The set of tile centers along an RA2 wall drag: a straight line from anchor
// to the cursor, snapped to whichever axis (row/col) the drag favors, capped at
// WALL_LINE_MAX tiles. Deterministic, inclusive of both ends.
function wallLineTiles(anchor, cursor) {
  const ax = Math.floor(anchor.x / TILE), ay = Math.floor(anchor.y / TILE);
  const cxT = Math.floor(cursor.x / TILE), cyT = Math.floor(cursor.y / TILE);
  const ddx = cxT - ax, ddy = cyT - ay;
  // favor the longer axis: RA2 lays a straight horizontal or vertical run
  const horiz = Math.abs(ddx) >= Math.abs(ddy);
  const len = Math.min(WALL_LINE_MAX - 1, horiz ? Math.abs(ddx) : Math.abs(ddy));
  const step = horiz ? Math.sign(ddx) : Math.sign(ddy);
  const tiles = [];
  for (let i = 0; i <= len; i++) {
    const tx = horiz ? ax + step * i : ax;
    const ty = horiz ? ay : ay + step * i;
    tiles.push({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE });
  }
  return tiles;
}

// Exit placement mode, clearing all transient placement state.
function exitPlacement(p) {
  p.placing = undefined;
  p.ghostX = undefined; p.ghostY = undefined;
  p.ghostPrev = undefined;
  p.wallAnchorX = undefined; p.wallAnchorY = undefined;
  p.placeFirePrev = undefined; p.placeActPrev = undefined; p.placeCancelPrev = undefined;
}

// One tick of an active placement (the operative is frozen by the caller). The
// ghost cursor follows arrows/stick/mouse; cancel (special, edge) exits free;
// confirm (fire or act, edge) drops the structure, consuming one from
// inventory. Walls are RA2 drag-to-line: the first confirm drops the anchor,
// the second lays the whole previewed line (one segment per inventory count).
function stepPlacement(g, p, inp) {
  const placeKind = p.placing;
  const pdef = PLACEABLES[placeKind];
  // the bought item vanished (consumed elsewhere) or kind unknown: bail out
  if (!pdef || inventoryCount(p, placeKind) <= 0) { exitPlacement(p); return; }

  if (!p.ghostPrev) p.ghostPrev = { up: false, down: false, left: false, right: false };
  const cur = placementCursor(
    { x: p.ghostX, y: p.ghostY }, inp, p.ghostPrev, p, g.w, g.h, PLACE_REACH);
  p.ghostX = cur.x; p.ghostY = cur.y;

  const cancelEdge = !!inp.special && !p.placeCancelPrev;
  p.placeCancelPrev = !!inp.special;
  if (cancelEdge) { exitPlacement(p); return; }

  const confirmEdge = (!!inp.fire && !p.placeFirePrev) || (!!inp.act && !p.placeActPrev);
  p.placeFirePrev = !!inp.fire;
  p.placeActPrev = !!inp.act;
  if (!confirmEdge) return;

  if (pdef.drag) {
    // RA2 wall drag: first confirm sets the anchor; second lays the line
    if (p.wallAnchorX === undefined) {
      if (!canPlaceAt(g, p.ghostX, p.ghostY)) return; // a bad anchor is ignored
      p.wallAnchorX = p.ghostX; p.wallAnchorY = p.ghostY;
      return;
    }
    const tiles = wallLineTiles({ x: p.wallAnchorX, y: p.wallAnchorY }, cur);
    for (const t of tiles) {
      if (inventoryCount(p, placeKind) <= 0) break;
      if (!canPlaceAt(g, t.x, t.y)) continue; // skip blocked tiles, lay the rest
      if (layStructure(g, p, placeKind, t.x, t.y)) consumeInventory(p, placeKind);
    }
    p.wallAnchorX = undefined; p.wallAnchorY = undefined;
    // out of wall, or none left: leave placement; otherwise keep laying lines
    if (inventoryCount(p, placeKind) <= 0) exitPlacement(p);
    return;
  }

  // single-tile placeable: drop it, consume one, exit when the stack empties
  if (canPlaceAt(g, p.ghostX, p.ghostY) && layStructure(g, p, placeKind, p.ghostX, p.ghostY)) {
    consumeInventory(p, placeKind);
    if (inventoryCount(p, placeKind) <= 0) exitPlacement(p);
  }
}

function buyOffer(g, p) {
  // toxic-air levels stock a mask offer beyond the standard five
  const offers = g.shopOffers || SHOP_OFFERS;
  const o = offers[p.shopIdx || 0];
  // FIRE SALE: while the timer runs, placeables (turret/wall/barricade) cost
  // nothing — every other offer keeps its price. Effective cost gates both the
  // affordability check and the debit below so the sale is fully free.
  const free = g.fireSaleT > 0 && o && o.place && PLACEABLES[o.what];
  const cost = free ? 0 : (o ? o.cost : 0);
  if (!o || getShards(g, p) < cost) return;
  if (o.place && PLACEABLES[o.what]) {
    // placeables (turret/wall/barricade) land in the inventory, NOT the item
    // slot — the operative cycles inventory and enters placement mode to drop
    addToInventory(p, o.what, o.amount || 1);
  } else if (o.what === 'token') {
    if ((p.dmgBonus || 0) >= 2) return; // tokens cap at +2 — never waste shards
    p.dmgBonus = (p.dmgBonus || 0) + 1;
  } else if (o.what === 'shield') {
    if (p.shield === undefined || p.shield >= SHIELD_MAX) return;
    p.shield = Math.min(SHIELD_MAX, p.shield + 2);
  } else if (o.what === 'mask' && p.mask) {
    return; // already wearing one: a second mask buys nothing
  } else { // cracker | medkit | mask fill the item slot (stack same kind, else swap)
    if (p.item && p.item.kind === o.what) p.item.count += o.amount;
    else p.item = { kind: o.what, count: o.amount };
  }
  addShards(g, p, -cost);
  g.events.push({ type: 'buy', what: o.what, cost, pid: p.pid, x: p.x, y: p.y });
}

// --- vehicles ---------------------------------------------------------------
// Skiffs may only be boarded from a tile touching water.
function nearWater(g, p) {
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = tx + dx, y = ty + dy;
    if (x >= 0 && y >= 0 && x < g.w && y < g.h && g.grid[y][x] === '~') return true;
  }
  return false;
}

// While aboard a skiff, movement is allowed only over '~' tiles (sliding
// within the tile currently occupied stays legal so the boat can shove off).
function skiffMove(g, p, dx, dy) {
  const ok = (nx, ny) => {
    if (tileAt(g, nx, ny) === '~') return true;
    return Math.floor(nx / TILE) === Math.floor(p.x / TILE) && Math.floor(ny / TILE) === Math.floor(p.y / TILE);
  };
  if (dx && ok(p.x + dx, p.y)) p.x += dx;
  if (dy && ok(p.x, p.y + dy)) p.y += dy;
}

function dismountVehicle(g, p, v) {
  if (v.kind === 'skiff' && tileAt(g, p.x, p.y) === '~') {
    // step ashore onto the first open neighboring tile; mid-lake with no land
    // in reach means staying aboard
    const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = (tx + dx + 0.5) * TILE, y = (ty + dy + 0.5) * TILE;
      if (x > 0 && y > 0 && x < g.w * TILE && y < g.h * TILE && !collides(g, x, y, PLAYER_R)) {
        p.x = x;
        p.y = y;
        v.rider = null;
        p.riding = null;
        g.events.push({ type: 'dismount', kind: v.kind, x: v.x, y: v.y, pid: p.pid });
        return;
      }
    }
    return;
  }
  v.rider = null;
  p.riding = null;
  g.events.push({ type: 'dismount', kind: v.kind, x: v.x, y: v.y, pid: p.pid });
}

// --- pvp: match end, flags, shrink zone -------------------------------------
function pvpWin(g, winner) {
  if (g.status !== 'play') return;
  g.status = 'cleared';
  g.winner = winner;
  g.events.push({
    type: 'matchEnd', winner,
    ...(g.caps ? { caps: g.caps.slice() } : {}),
    x: g.w * TILE / 2, y: g.h * TILE / 2,
  });
  g.events.push({ type: 'clear', x: g.w * TILE / 2, y: g.h * TILE / 2, points: Math.round(g.score) });
}

function stepFlags(g, dt) {
  if (!g.flags.length) return;
  // Sudden death cannot run forever: after 180s the cap rules the match.
  // More grabs (flag pickups, whole match) wins; tied grabs go to the team
  // that grabbed FIRST inside sudden death; zero grabs anywhere -> team 0.
  // Captures can't break the tie — caps are tied in sudden death by definition.
  if (g.suddenDeath && g.status === 'play') {
    g.suddenT += dt;
    if (g.suddenT >= 180) {
      pvpWin(g, g.grabs[0] !== g.grabs[1]
        ? (g.grabs[0] > g.grabs[1] ? 0 : 1)
        : (g.sdFirstGrab ?? 0));
      return;
    }
  }
  for (const f of g.flags) {
    if (f.carrier != null) {
      const p = g.players.find(q => q.pid === f.carrier);
      if (!p || p.state !== 'active') { // safety net: downPlayer drops normally
        f.carrier = null;
        f.dropT = ctfFlagDropT(g);
        f.atBase = false;
      } else {
        f.x = p.x;
        f.y = p.y;
      }
      continue;
    }
    if (!f.atBase) {
      f.dropT -= dt;
      if (f.dropT <= 0) {
        f.atBase = true;
        f.x = f.homeX;
        f.y = f.homeY;
        f.dropT = 0;
        g.events.push({ type: 'flagReturn', team: f.team, x: f.x, y: f.y });
      }
    }
  }
  const r2 = (TILE * FLAG_REACH) ** 2;
  for (const p of g.players) {
    if (p.state !== 'active' || p.team === undefined) continue;
    for (const f of g.flags) {
      if (f.carrier != null || dist2(p, f) >= r2) continue;
      if (f.team !== p.team) {
        // mounted players never pick the flag up (drop-on-mount rule, and
        // the carrier slowdown must not be bypassed on stag-back)
        if (p.riding) continue;
        // grab the enemy flag, at its stand or off the ground
        f.carrier = p.pid;
        f.atBase = false;
        f.dropT = 0;
        if (g.grabs) {
          g.grabs[p.team]++;
          if (g.suddenDeath && g.sdFirstGrab == null) g.sdFirstGrab = p.team;
        }
        g.events.push({ type: 'flagTaken', team: f.team, pid: p.pid, x: f.x, y: f.y });
      } else if (!f.atBase) {
        // your own dropped flag goes straight home on touch
        f.atBase = true;
        f.x = f.homeX;
        f.y = f.homeY;
        f.dropT = 0;
        g.events.push({ type: 'flagReturn', team: f.team, x: f.x, y: f.y });
      }
    }
    // scoring: carry the enemy flag onto your own AT-BASE stand
    const own = g.flags.find(f => f.team === p.team);
    const carrying = g.flags.find(f => f.carrier === p.pid);
    if (own && own.atBase && carrying && dist2(p, { x: own.homeX, y: own.homeY }) < r2) {
      carrying.carrier = null;
      carrying.atBase = true;
      carrying.x = carrying.homeX;
      carrying.y = carrying.homeY;
      carrying.dropT = 0;
      g.caps[p.team]++;
      g.events.push({ type: 'capture', team: p.team, pid: p.pid, x: own.homeX, y: own.homeY });
      if (g.caps[p.team] >= CTF_CAPS_TO_WIN || g.suddenDeath) pvpWin(g, p.team);
    }
  }
}

function stepZone(g, dt) {
  if (!g.zone) return;
  const z = g.zone;
  for (const s of g.brShrinks) {
    if (s.fired || g.elapsed < s.at) continue;
    s.fired = true;
    z.targetR = s.r * TILE;
    z.shrinkT = ZONE_SHRINK_T;
    g.events.push({ type: 'zoneShrink', x: z.x, y: z.y, r: z.targetR, t: z.shrinkT });
  }
  if (z.r > z.targetR) {
    if (z.shrinkT > 0) {
      const rate = (z.r - z.targetR) / z.shrinkT;
      z.r = Math.max(z.targetR, z.r - rate * dt);
      z.shrinkT = Math.max(0, z.shrinkT - dt);
    } else {
      z.r = z.targetR;
    }
  } else if (g.brShrinks.every(s => s.fired)) {
    // Endgame: the last scheduled shrink never closes the ring fully, so 30s
    // after it settles the zone starts a continuous final collapse — 8 px/s,
    // straight down to r=0. No two-survivor stalemates.
    z.finalT = (z.finalT || 0) + dt;
    if (z.finalT >= 30 && z.r > 0) {
      if (!z.collapsing) {
        z.collapsing = true;
        g.events.push({ type: 'zoneShrink', x: z.x, y: z.y, r: 0, t: 0 });
      }
      z.r = Math.max(0, z.r - 8 * dt);
      z.targetR = z.r;
    }
  }
  // standing outside burns 1 hp every 2 seconds (shield pips absorb first);
  // once the collapsing ring drops under 60px the burn applies inside too —
  // everyone left alive ticks down, so the match always ends
  for (const p of g.players) {
    if (p.state !== 'active') continue;
    if (Math.hypot(p.x - z.x, p.y - z.y) > z.r || z.r < 60) {
      p.zoneT = (p.zoneT || 0) + dt;
      if (p.zoneT >= ZONE_TICK) {
        p.zoneT -= ZONE_TICK;
        damagePlayer(g, p, 1);
      }
    } else {
      p.zoneT = 0;
    }
  }
}

export function step(g, inputs, dt) {
  if (g.status !== 'play') return;

  // DEV "Pause Time" cheat (solo offline only; sets g.devMode like every other
  // cheat): FREEZE THE WORLD while the operative keeps acting. The world-clock
  // substeps (waves/horde/superweapon charge/cycle/siege/gate/ambient patches),
  // the mission countdown, the enemy step, status/patch/follower/hazard ticks
  // and enemy projectiles are all gated below on this flag — so enemies, spawns
  // and timers hold across ticks while the player still moves, aims, fires,
  // builds and repositions. Reads g.cheats defensively, so untouched runs (no
  // g.cheats object) are byte-identical no-ops.
  const frozen = !!(g.cheats && g.cheats.pauseTime);

  g.elapsed += dt;
  // Global pathfinding budgets (big maps only; arcade never spends them and
  // keeps its classic byte-identical behavior): at most 6 full A* searches
  // and 2 gnaw-target scans START per tick across the whole field. Enemies
  // denied a search keep their stale path one short cycle and ask again —
  // per-enemy cooldown phases differ, so contention round-robins itself.
  if (!g.arcade) {
    g.pathBudget = 6;
    g.gnawBudget = 2;
  }
  // toxic air: one EVA-style warning the moment the mission opens
  if (g.toxicAir && !g.toxicAir.warned) {
    g.toxicAir.warned = true;
    g.events.push({ type: 'toxicAir', until: g.toxicAir.until, x: g.w * TILE / 2, y: TILE });
  }
  // theme ambient patches: a deterministic clock spits ground patches (lava
  // spits etc.) on a fixed cadence; the spawn cell is walked by a counter, so
  // it is fully reproducible (no Math.random). No-op when the theme set none.
  if (g.ambientPatches && !frozen) {
    const ap = g.ambientPatches;
    ap.patchT -= dt;
    while (ap.patchT <= 0) {
      ap.patchT += ap.everySec;
      if (g.patches.length < ap.cap) {
        // walk a counter across the open grid for a deterministic, spread site
        const cell = openTileByIndex(g, ap.patchN * 37 + 11);
        ap.patchN++;
        if (cell) {
          g.patches.push({ x: cell.x, y: cell.y, kind: ap.kind, r: ap.r * TILE, ttl: ap.ttl, hostile: true });
          g.events.push({ type: 'patch', x: cell.x, y: cell.y, kind: ap.kind, r: ap.r * TILE, hostile: true });
        }
      }
    }
  }
  // World-clock substeps freeze under Pause Time: waves/horde/superweapon
  // charge/day-night/siege/gate all hold so nothing spawns or advances.
  if (!frozen) {
    stepWaves(g);
    stepHorde(g, dt); // RELIC AWAKENING horde (no-op unless g.musicBox completed)
    stepSuperweapon(g, dt); // relic superweapon build/charge clock (no-op until built)
    stepCycle(g, dt); // bastion day/night clock (final dawn can clear here)
    if (g.status !== 'play') return;
    // Anchor Siege: minion waves march the lanes, towers cover them (no-ops off-mode)
    stepSiegeWaves(g, dt);
    stepSiegeMinions(g, dt);
    stepSiegeTowers(g, dt);
    maybeOpenGate(g); // time-locked gates open when `after` elapses at full quorum
  }

  // Bastion missions are governed by the day/night clock, not the mission
  // timer — it freezes and never fails the level. PvP clocks never fail the
  // match either: CTF expiry crowns the leader (a tie goes to sudden death,
  // first capture wins, clock frozen at 0) and BR lets the zone settle it.
  // Untimed story missions freeze the countdown entirely: timeLeft never
  // decrements and neither the time-out fail nor 'lowTime' can fire.
  if (!frozen && !g.cycle && !g.untimed && g.timeLeft > 0) {
    g.timeLeft -= dt;
    if (g.timeLeft <= 0) {
      g.timeLeft = 0;
      const pvp = g.mode === 'ctf' || g.mode === 'br';
      if (!pvp) { g.status = 'failed'; g.events.push({ type: 'fail', x: 0, y: 0 }); return; }
      if (g.mode === 'ctf') {
        if (g.caps[0] !== g.caps[1]) { pvpWin(g, g.caps[0] > g.caps[1] ? 0 : 1); return; }
        g.suddenDeath = true;
      }
    } else if (!g.lowTimeSent && g.timeLeft <= 15) {
      g.lowTimeSent = true;
      g.events.push({ type: 'lowTime', x: g.w * TILE / 2, y: TILE });
    }
  }
  if (!frozen) {
    g.comboT -= dt;
    if (g.comboT <= 0) g.combo = 1;
  }

  // --- players ---
  for (const p of g.players) {
    if (p.state === 'down') {
      p.respawn -= dt;
      if (p.respawn <= 0) {
        // CTF: redeploy the same operative on the team stand's spawn ring
        // (the seat's deterministic slot). No pick screen, no roster
        // consumption — pvp never touches rosters.
        if (g.mode === 'ctf' || g.siege || g.family) {
          const s = g.siege ? siegeSpawnSpot(g, p)
            : g.family ? (g.spawns[p.pid % g.spawns.length] || g.spawns[0] || { x: TILE * 2, y: TILE * 2 })
              : ctfStandSpot(g, p);
          p.x = s.x;
          p.y = s.y;
          p.fx = 0; p.fy = -1; p.cool = 0;
          p.invuln = g.family ? 3 : 2.5;
          if (p.maxHp !== undefined) { p.hp = p.maxHp; p.shield = 0; }
          p.state = 'active';
          g.events.push({ type: 'spawn', x: p.x, y: p.y });
          continue;
        }
        const free = freeChars(g);
        if (free.length) {
          // Gain Ground style: the fallen player picks their next operative.
          // pickPrev starts all-held so a button held while dying can't
          // instantly confirm — release first, then choose.
          p.state = 'pick';
          p.pickIdx = 0;
          p.pickPrev = { left: true, right: true, fire: true };
        } else {
          p.state = 'out';
        }
      }
      continue;
    }
    if (p.state === 'pick') {
      const free = freeChars(g);
      if (!free.length) { p.state = 'out'; continue; }
      if (p.pickIdx >= free.length) p.pickIdx = free.length - 1;
      const inp = inputs[p.pid] || {};
      const edgeL = !!inp.left && !p.pickPrev.left;
      const edgeR = !!inp.right && !p.pickPrev.right;
      const edgeF = !!inp.fire && !p.pickPrev.fire;
      p.pickPrev = { left: !!inp.left, right: !!inp.right, fire: !!inp.fire };
      if (edgeL) p.pickIdx = (p.pickIdx + free.length - 1) % free.length;
      if (edgeR) p.pickIdx = (p.pickIdx + 1) % free.length;
      if (edgeF) {
        // ctf pickers (mid-match joiners) deploy on their team stand's ring —
        // respawnSpot's "beside a living teammate" could land them beside an
        // ENEMY in pvp. Co-op keeps the teammate-adjacent respawn exactly.
        const s = g.mode === 'ctf' ? ctfStandSpot(g, p) : respawnSpot(g);
        p.charId = free[p.pickIdx];
        p.x = s.x; p.y = s.y; p.fx = 0; p.fy = -1; p.cool = 0;
        p.invuln = 3.5;
        // a fresh operative deploys at full hp with no shield; the item slot
        // belongs to the seat and survives the swap
        if (p.maxHp !== undefined) { p.hp = p.maxHp; p.shield = 0; }
        p.state = 'active';
        g.events.push({ type: 'spawn', x: p.x, y: p.y });
      }
      continue;
    }
    if (p.state !== 'active') continue;

    if (p.invuln > 0) p.invuln -= dt;
    if (p.specialCool > 0) p.specialCool -= dt;
    if (p.stimT > 0) p.stimT -= dt;
    if (p.stunT > 0) p.stunT -= dt; // volt zap root: blocks movement and fire
    const inp = inputs[p.pid] || {};
    const ch = g.charMap[p.charId];
    if (!ch) continue;

    // Swimmers (char.swims — the seal) treat water as open ground: x0.7
    // speed and +50% fire cooldown while standing on a '~' tile.
    const swims = !!ch.swims;
    const onWater = swims && tileAt(g, p.x, p.y) === '~';

    // --- holdings: an occupied watchtower pins the gunner to its platform;
    // a mounted vehicle moves with its rider ---
    const tower = p.towerId != null ? g.towers[p.towerId] : null;
    if (tower) { p.x = tower.x; p.y = tower.y; }
    const vehicle = p.riding ? g.vehicles.find(v => v.id === p.riding) : null;

    // --- SPRINT + STAMINA (hold sprint to run a brief burst). The meter is a
    // gated hero-mode field: only operatives with hp tracking (p.maxHp set, i.e.
    // non-arcade) can sprint, and the field stays undefined until the seat first
    // presses sprint — so untouched runs (and every mode that never sprints)
    // emit byte-identical snapshots. Drain runs only while actually moving under
    // sprint; recovery runs ONLY when the operative is at full hp. At 0 the meter
    // simply stops boosting (normal speed) until it climbs back. The resulting
    // `sprinting` flag feeds the movement velocity below (composes with the
    // stag/vehicle/siege multipliers without double-applying). ---
    let sprinting = false;
    if (p.maxHp !== undefined && (inp.sprint || p.stamina !== undefined)) {
      if (p.stamina === undefined) { p.stamina = STAMINA_MAX; p.staminaMax = STAMINA_MAX; }
      const wantsSprint = !!inp.sprint && !tower && !p.shopping && !p.selecting && !(p.stunT > 0);
      const moving = (inp.left || inp.right || inp.up || inp.down) && !(p.stunT > 0);
      // STAMINA power-up: free sprint never drains and ignores an empty meter.
      const freeSprint = g.freeSprintT > 0;
      if (wantsSprint && moving && (freeSprint || p.stamina > 0)) {
        sprinting = true;
        if (!freeSprint) p.stamina = Math.max(0, p.stamina - STAMINA_DRAIN * dt);
      } else if (p.hp >= p.maxHp && p.stamina < p.staminaMax) {
        // recovery gate: only refill when fully healed (the key constraint)
        p.stamina = Math.min(p.staminaMax, p.stamina + STAMINA_REGEN * dt);
      }
    }

    // --- inventory cycle (edge): inp.invSel steps the selected placeable. Only
    // engages when the operative actually carries placeables; gated so seats
    // that never buy one never gain inventory keys. ---
    {
      const invEdge = !!inp.invSel && !p.invPrev;
      p.invPrev = !!inp.invSel;
      if (invEdge && p.inventory && p.inventory.length) {
        p.invIdx = ((p.invIdx || 0) + 1) % p.inventory.length;
      }
    }

    // --- DROP (edge): lay down whatever is carried — scrap (give it to a
    // stranded operator to recruit them), a carried operator (drop at the
    // stronghold centre to save + recruit), or a relic fragment. Empty hands is
    // a no-op (dropHeld returns false), so seats carrying nothing are unaffected
    // and unflagged levels — where every carry array is empty — never act. ---
    {
      const dropEdge = !!inp.drop && !p.dropPrev;
      p.dropPrev = !!inp.drop;
      if (dropEdge && !tower && !vehicle && !p.placing && !p.shopping && !p.selecting) {
        dropHeld(g, p);
      }
    }

    // --- RELIC SUPERWEAPON (RA2-style nuke / weather machine): inp.superBuild
    // asks to assemble the one-shot device on this seat's tile (once unlocked);
    // inp.superFire is a plain TRIGGER (no aim) that auto-targets the densest
    // hostile cluster once it is ready. A no-op until the awakening horde was
    // survived, so untouched modes never run it. ---
    stepSuperweaponInput(g, p, inp);

    // --- placement mode (RA2 buy-then-place): inp.place toggles it on for the
    // selected inventory item. While placing, the operative is FROZEN: a
    // tile-snapped ghost follows arrows/stick/mouse, confirm (fire/act) drops
    // the structure (consuming one) and cancel (special) exits free. Walls drag
    // a connected line; everything else drops a single tile. The whole block
    // owns the tick and continues past movement/fire/act below. ---
    if (!p.placing && !tower && !vehicle && !p.shopping && !p.selecting
        && inp.place && !p.placePrev && p.inventory && p.inventory.length) {
      const sel = p.inventory[p.invIdx || 0];
      if (sel) {
        p.placing = sel.kind;
        const c = tileCenter(p.x, p.y);
        p.ghostX = c.x; p.ghostY = c.y;
        p.ghostPrev = { up: !!inp.up, down: !!inp.down, left: !!inp.left, right: !!inp.right };
        p.placeFirePrev = !!inp.fire;
        p.placeActPrev = !!inp.act;
        p.placeCancelPrev = !!inp.special;
        p.wallAnchorX = undefined; p.wallAnchorY = undefined;
      }
    }
    p.placePrev = !!inp.place;
    if (p.placing) {
      stepPlacement(g, p, inp);
      // movement, fire, act, special are all suppressed: the operative is frozen
      p.mvX = 0; p.mvY = 0;
      continue;
    }

    // --- turret type carousel (RA2 homage): a freshly built turret idles in
    // typeSelect; holding act within build reach drives the carousel —
    // left/right cycle gun/prism/tesla/toxin, fire confirms. Unattended for
    // 8s it confirms by itself ('gun' unless someone cycled it and left).
    // Open build sites outrank the carousel (typeSelectNear yields null);
    // the carousel outranks the shop (a built turret in reach already blocks
    // stall engagement via structureInReach) and consumes its engaging press
    // whole, exactly like the shop below. ---
    const wasSelecting = !!p.selecting;
    const selB = inp.act && !tower && !vehicle ? typeSelectNear(g, p) : null;
    p.selecting = !!selB;
    const selEngaged = p.selecting && !wasSelecting;
    if (selEngaged) p.selPrev = { left: !!inp.left, right: !!inp.right, fire: !!inp.fire };
    if (selB) {
      selB.attended = true; // the unattended-confirm clock holds while driven
      const edgeL = !!inp.left && !p.selPrev.left;
      const edgeR = !!inp.right && !p.selPrev.right;
      const edgeF = !!inp.fire && !p.selPrev.fire;
      p.selPrev = { left: !!inp.left, right: !!inp.right, fire: !!inp.fire };
      if (edgeL) selB.tsIdx = ((selB.tsIdx || 0) + TURRET_TYPES.length - 1) % TURRET_TYPES.length;
      if (edgeR) selB.tsIdx = ((selB.tsIdx || 0) + 1) % TURRET_TYPES.length;
      // p.selecting stays set through the confirming tick so the press never
      // falls through to the main weapon or the act chain
      if (edgeF) confirmTurretType(g, selB);
    }

    // --- shop carousel: holding act inside 1.5 tiles of a stall locks
    // movement; left/right (edge) browse, fire (edge) buys. Structure work
    // owns its radius, so a hold near a build site never opens the shop. ---
    const wasShopping = !!p.shopping;
    p.shopping = !!(inp.act && !tower && !vehicle && g.shops.length
      && shopNear(g, p) && !structureInReach(g, p));
    // the press that ENGAGES the carousel is consumed whole: no fall-through
    // to chests/builds/anything else under the stall this tick
    const shopEngaged = p.shopping && !wasShopping;
    if (shopEngaged) {
      p.shopIdx = p.shopIdx || 0;
      // all-held start: buttons held when the stall opens must not buy
      p.shopPrev = { left: !!inp.left, right: !!inp.right, fire: !!inp.fire };
    }
    if (p.shopping) {
      const edgeL = !!inp.left && !p.shopPrev.left;
      const edgeR = !!inp.right && !p.shopPrev.right;
      const edgeF = !!inp.fire && !p.shopPrev.fire;
      p.shopPrev = { left: !!inp.left, right: !!inp.right, fire: !!inp.fire };
      const nOffers = (g.shopOffers || SHOP_OFFERS).length;
      if (edgeL) p.shopIdx = (p.shopIdx + nOffers - 1) % nOffers;
      if (edgeR) p.shopIdx = (p.shopIdx + 1) % nOffers;
      if (edgeF) buyOffer(g, p);
    }

    // --- special (edge-triggered; suppressed while mounted, towered or
    // browsing a shop) ---
    const specialEdge = !!inp.special && !p.specialPrev;
    p.specialPrev = !!inp.special;
    if (specialEdge && p.specialCool <= 0 && ch.special && !vehicle && !tower && !p.shopping && !p.selecting) {
      const sp = ch.special;
      if (sp.kind === 'dash') {
        p.dashT = 0.15;
        p.dashFx = p.fx;
        p.dashFy = p.fy;
        p.invuln = Math.max(p.invuln, 0.4);
        g.events.push({ type: 'dash', x: p.x, y: p.y });
      } else if (sp.kind === 'stim') {
        for (const q of g.players) {
          // pvp: the ward shields only the medic's own team (self always) —
          // an opposing operative sprinting through gains nothing
          if (q.state === 'active' && (q === p || (dist2(p, q) < (TILE * 2) ** 2
              && (p.team === undefined || q.team === p.team)))) {
            q.invuln = Math.max(q.invuln, 1.5);
          }
        }
        p.stimT = 3;
        g.events.push({ type: 'special', x: p.x, y: p.y, kind: 'stim', who: 'p' });
      } else {
        // weapon-kind specials evolve with the seat's level, like main fire
        fireWeapon(g, p, applyEvolution(sp, ch.evolution, p.level), 'p');
        g.events.push({ type: 'special', x: p.x, y: p.y, kind: sp.kind, who: 'p' });
      }
      p.specialCool = sp.cooldown || 3;
    }

    // --- ITEM button: tap vs hold --------------------------------------
    // With a field weapon in hand the button is overloaded, so the two
    // gestures are split: a TAP (released inside 0.3s) uses the item slot on
    // release; a HOLD reaching 0.8s lays the weapon down as a pickup (the
    // release that closes a fired hold never tap-uses). With empty hands the
    // press edge uses the item outright, exactly as before field weapons —
    // and a hold with an empty item slot still drops the weapon. All clocks
    // accrue dt, so the gesture split is deterministic.
    const itemPress = !!inp.item && !p.itemPrev;
    const itemRelease = !inp.item && !!p.itemPrev;
    p.itemPrev = !!inp.item;
    let itemUse = false;
    if (p.fieldWeapon) {
      if (inp.item) {
        p.itemHoldT = (p.itemHoldT || 0) + dt;
        if (!p.itemHoldFired && p.itemHoldT >= FIELD_DROP_HOLD) {
          p.itemHoldFired = true;
          dropFieldWeapon(g, p);
        }
      } else {
        if (itemRelease && !p.itemHoldFired && (p.itemHoldT || 0) < ITEM_TAP_T) itemUse = true;
        p.itemHoldT = 0;
        p.itemHoldFired = false;
      }
    } else {
      itemUse = itemPress;
      p.itemHoldT = 0;
      if (!inp.item) p.itemHoldFired = false;
    }

    // --- item slot use: cracker lobs a lure grenade, medkit heals +1 (only
    // when hurt), shield refills the pips (only when low). Arcade players
    // carry no items so the button is inert there. ---
    if (itemUse && p.item && p.item.count > 0 && p.maxHp !== undefined) {
      const it = p.item;
      let used = false;
      if (it.kind === 'cracker') {
        const tx = Math.max(TILE * 0.5, Math.min((g.w - 0.5) * TILE, p.x + p.fx * CRACKER_RANGE * TILE));
        const ty = Math.max(TILE * 0.5, Math.min((g.h - 0.5) * TILE, p.y + p.fy * CRACKER_RANGE * TILE));
        g.crackers.push({
          sx: p.x, sy: p.y, tx, ty, x: p.x, y: p.y,
          flightT: CRACKER_FLIGHT, landed: false, fuse: CRACKER_FUSE,
          // pvp bookkeeping: the boom hits other-team players (never own)
          pid: p.pid, team: p.team,
        });
        used = true;
      } else if (it.kind === 'medkit' && p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, p.hp + 2); // a medkit mends a meaningful chunk, not a token 1hp
        g.events.push({ type: 'heal', pid: p.pid, x: p.x, y: p.y, hp: p.hp });
        used = true;
      } else if (it.kind === 'shield' && p.shield < SHIELD_MAX) {
        p.shield = Math.min(SHIELD_MAX, p.shield + 2);
        g.events.push({ type: 'shieldUp', pid: p.pid, x: p.x, y: p.y, shield: p.shield });
        used = true;
      } else if (it.kind === 'toxin') {
        // thrown like the cracker: a 4-tile lob that pools toxin on landing
        const tx = Math.max(TILE * 0.5, Math.min((g.w - 0.5) * TILE, p.x + p.fx * CRACKER_RANGE * TILE));
        const ty = Math.max(TILE * 0.5, Math.min((g.h - 0.5) * TILE, p.y + p.fy * CRACKER_RANGE * TILE));
        g.patches.push({ x: tx, y: ty, kind: 'toxin', r: TOXIN_PATCH_R * TILE, ttl: TOXIN_PATCH_TTL, pid: p.pid });
        g.events.push({ type: 'patch', x: tx, y: ty, kind: 'toxin', r: TOXIN_PATCH_R * TILE });
        used = true;
      } else if (it.kind === 'mask') {
        // breather mask: worn for good (p.mask is persistent), the toxic-air
        // bleed never touches a masked operative. A second mask is refused.
        if (!p.mask) {
          p.mask = true;
          g.events.push({ type: 'maskOn', pid: p.pid, x: p.x, y: p.y });
          used = true;
        }
      } else if (it.kind === 'controller') {
        // mind control: the nearest NON-BOSS enemy within 4 tiles fights for
        // the squad for 10s, then burns out. No target in reach wastes nothing.
        let tgt = null, best = (TILE * CONTROLLER_RANGE) ** 2;
        for (const e of g.enemies) {
          if (e.dead || e.kind === 'boss' || e.convertedT > 0) continue;
          const dd = dist2(p, e);
          if (dd < best) { best = dd; tgt = e; }
        }
        if (tgt) {
          tgt.convertedT = CONTROLLER_T;
          tgt.returning = false;
          wakeEnemy(g, tgt, false);
          g.events.push({ type: 'converted', x: tgt.x, y: tgt.y, kind: tgt.kind, pid: p.pid });
          used = true;
        }
      }
      if (used && --it.count <= 0) p.item = null;
    }

    // --- movement (dash overrides stick input; stim grants +30% speed).
    // Ice momentum: standing on '^', 60% of the previous tick's movement
    // vector carries over as drift before the stick is read — deterministic
    // skating for players and enemies alike. mvX/mvY record the tick's total
    // displacement (drift included) for the next tick's carry. ---
    const mvX0 = p.x, mvY0 = p.y;
    if (p.dashT > 0) {
      p.dashT -= dt;
      // 3 tiles over 0.15s, in collision-checked sub-steps so the dash
      // cannot tunnel through walls or built structures.
      let remain = (3 / 0.15) * TILE * dt;
      while (remain > 0) {
        const m = Math.min(6, remain);
        moveCircle(g, p, p.dashFx * m, p.dashFy * m, PLAYER_R, swims ? blocksMoveSwim : blocksMove);
        remain -= m;
      }
    } else if (tower || p.shopping || p.selecting) {
      // locked in place; tower gunners still swivel their aim
      if (tower) {
        const dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
        const dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
        if (dx || dy) { const [mx, my] = norm(dx, dy); p.fx = mx; p.fy = my; }
        p.x = tower.x; p.y = tower.y;
      }
    } else {
      if (!g.arcade && (p.mvX || p.mvY) && !(p.stunT > 0) && tileAt(g, p.x, p.y) === '^') {
        moveCircle(g, p, p.mvX * ICE_DRIFT, p.mvY * ICE_DRIFT, PLAYER_R, swims ? blocksMoveSwim : blocksMove);
      }
      const dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      const dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
      // a volt-zap root pins the feet for its 0.3s; aim and items still work
      if ((dx || dy) && !(p.stunT > 0)) {
        const [mx, my] = norm(dx, dy);
        p.fx = mx; p.fy = my;
        let v = ch.speed * TILE * dt * (p.stimT > 0 ? 1.3 : 1);
        if (vehicle) v = ch.speed * TILE * dt * (vehicle.kind === 'stag' ? STAG_SPEED : 1);
        // sprint burst: on foot only (a mount already carries its own boost), so
        // it composes with siege/terrain factors below without doubling the stag
        if (sprinting && !vehicle) v *= SPRINT_MULT;
        if (g.cheats && g.cheats.speed > 1) v *= g.cheats.speed; // DEV speed multiplier
        if (g.siege && !vehicle) v *= SIEGE_HERO_SPEED; // MOBA: deliberate hero movement
        v *= moveMult(g, p.x, p.y); // sand drags, ice skates, snowfall slows
        if (g.flags.length && g.flags.some(f => f.carrier === p.pid)) v *= CARRY_SLOW;
        if (!vehicle && onWater) v *= SWIM_SLOW; // swimmers paddle slower
        // toxin pools slow EVERYONE wading through — patches carry no team
        // (burn patches never touch players at all; see stepPatches)
        if (g.patches.length) {
          for (const pa of g.patches) {
            if (pa.kind === 'toxin' && dist2(p, pa) < pa.r * pa.r) { v *= TOXIN_SLOW; break; }
          }
        }
        if (vehicle && vehicle.kind === 'skiff') skiffMove(g, p, mx * v, my * v);
        else moveCircle(g, p, mx * v, my * v, PLAYER_R, swims ? blocksMoveSwim : blocksMove);
      }
      if (vehicle) { vehicle.x = p.x; vehicle.y = p.y; }
    }
    p.mvX = p.x - mvX0;
    p.mvY = p.y - mvY0;
    p.cool -= dt;
    if (inp.fire && p.cool <= 0 && !vehicle && !p.shopping && !p.selecting && !(p.stunT > 0)) {
      let weapon, cd;
      if (p.fieldWeapon) {
        // a carried field weapon REPLACES the character weapon for fire:
        // no evolutions, its own cooldown; shop dmgBonus rides in fireWeapon
        weapon = FIELD_WEAPONS[p.fieldWeapon.kind];
        cd = weapon.cooldown;
      } else {
        // L3+ weapon evolutions ride every shot (arcade seats never level, so
        // p.level is undefined there and the weapon passes through untouched)
        weapon = applyEvolution(ch.weapon, ch.evolution, p.level);
        cd = ch.weapon.cooldown;
      }
      if (tower) {
        // the high ground: longer reach, shots sail over walls
        const bonus = TOWER_BONUS[(tower.level || 1) - 1];
        weapon = { ...weapon, range: (weapon.range ?? 5) * (1 + bonus), overWalls: true };
      }
      fireWeapon(g, p, weapon, 'p');
      p.cool = cd * (onWater ? SWIM_FIRE_MULT : 1);
      // ammo: each trigger pull (full volley) spends 1; dry weapons evaporate
      // on the spot — nothing drops, the character weapon is back next press
      if (p.fieldWeapon && --p.fieldWeapon.ammo <= 0) {
        g.events.push({ type: 'fieldEmpty', pid: p.pid, x: p.x, y: p.y, kind: p.fieldWeapon.kind });
        p.fieldWeapon = null;
      }
    }

    // --- act (edge-triggered). FINAL priority order, top wins. The hold
    // interactions claim a press first and consume it whole (no fall-through):
    //   a. open build sites own their radius (building runs per-site below
    //      on the held bool) and outrank both carousels
    //   b. turret typeSelect carousel (gun/prism/tesla/toxin, fire confirms)
    //   c. shop carousel (only when no structure work could claim the hold)
    // Then the edge chain:
    //   1. leave tower            2. dismount vehicle
    //   3. build sites            4. ripe/trampled farms
    //   5. vehicle mount (NEAREST in reach — mounts outrank chest opening)
    //   6. chests (nearest)       7. field weapon pickups (nearest)
    //   8. relay switches         9. glyph stones
    //  10. tower occupy          11. hire posts (inert in pvp)
    //  12. npc talk              13. board the landed Anchorcraft (lowest)
    // The dismantle-chain on BUILT structures runs LAST, on the held bool in
    // the structures block below: repair while damaged > upgrade below max
    // level > dismantle.
    // PARALLEL HOLD RAIL (not in this chain, claims nothing, consumes
    // nothing): beacon relight (stepBeacons, dark monolith by day) and THE
    // HORN (stepHorn, core/lit beacon by day) accumulate on the raw held
    // bool alongside whatever the chain is doing — they are mutually
    // exclusive per monolith (dark vs lit) and inert for busy seats. The
    // horn additionally yields to any NEAREST-or-tied hold-claimant (site/
    // structure work/shop/forge/tower rebuild) so a working hold can never
    // skip the day by accident. ---
    const actEdge = !!inp.act && !p.actPrev && !shopEngaged && !selEngaged;
    p.actPrev = !!inp.act;
    if (actEdge) {
      if (tower) {
        tower.occupant = null;
        p.towerId = null;
      } else if (vehicle) {
        dismountVehicle(g, p, vehicle);
      } else {
        const reach2 = (TILE * BUILD_REACH) ** 2;
        let onSite = false;
        let ripeFarm = null;
        let deadFarm = null;
        for (const b of g.builds) {
          if (dist2(p, b) >= reach2) continue;
          if (!b.built) { onSite = true; break; }
          if (b.kind === 'farm') {
            if (b.trampled) deadFarm = deadFarm || b;
            else if (b.stage >= 3) ripeFarm = ripeFarm || b;
          }
        }
        let handled = onSite;
        if (!handled && ripeFarm) {
          harvestFarm(g, ripeFarm, p);
          handled = true;
        }
        if (!handled && deadFarm) {
          // replant a trampled plot by hand (a hired farmer does it unasked)
          deadFarm.trampled = false;
          deadFarm.replantT = 0;
          deadFarm.growT = 0;
          handled = true;
        }
        if (!handled) {
          // mount the NEAREST free vehicle in reach (not array-first)
          let veh = null, bestV = reach2;
          for (const v of g.vehicles) {
            if (v.rider != null) continue;
            if (v.kind === 'skiff' && !nearWater(g, p)) continue;
            const dd = dist2(p, v);
            if (dd < bestV) { bestV = dd; veh = v; }
          }
          if (veh) {
            veh.rider = p.pid;
            p.riding = veh.id;
            p.x = veh.x; p.y = veh.y;
            p.dashT = 0;
            // a carried CTF flag never rides: it drops at the mount point
            dropFlags(g, p);
            g.events.push({ type: 'mount', kind: veh.kind, x: veh.x, y: veh.y, pid: p.pid });
            handled = true;
          }
        }
        if (!handled) {
          let chest = null, bestC = reach2;
          for (const c of g.chests) {
            if (c.opened) continue;
            const dd = dist2(p, c);
            if (dd < bestC) { bestC = dd; chest = c; }
          }
          if (chest) { openChest(g, chest, p); handled = true; }
        }
        if (!handled) {
          // field weapon pickups: grab the NEAREST in reach. A weapon already
          // in hand swaps out at the feet so teammates can claim the cast-off.
          let pk = null, bestW = reach2;
          for (const w of g.pickups) {
            const dd = dist2(p, w);
            if (dd < bestW) { bestW = dd; pk = w; }
          }
          if (pk) {
            g.pickups.splice(g.pickups.indexOf(pk), 1);
            dropFieldWeapon(g, p);
            p.fieldWeapon = { kind: pk.kind, ammo: pk.ammo };
            p.itemHoldT = 0;
            g.events.push({ type: 'fieldPickup', pid: p.pid, x: pk.x, y: pk.y, kind: pk.kind, ammo: pk.ammo });
            handled = true;
          }
        }
        if (!handled && g.switches.length) {
          // relay switches: throw the NEAREST off relay in reach
          let sw = null, bestSw = reach2;
          for (const s of g.switches) {
            if (s.on) continue;
            const dd = dist2(p, s);
            if (dd < bestSw) { bestSw = dd; sw = s; }
          }
          if (sw) { toggleSwitch(g, sw, p); handled = true; }
        }
        if (!handled && g.glyphs.length) {
          // glyph stones: light the NEAREST unlit stone in reach
          let gl = null, bestGl = reach2;
          for (const st of g.glyphs) {
            if (st.lit) continue;
            const dd = dist2(p, st);
            if (dd < bestGl) { bestGl = dd; gl = st; }
          }
          if (gl) { lightGlyph(g, gl, p); handled = true; }
        }
        if (!handled) {
          const m2 = (TILE * TOWER_MOUNT_REACH) ** 2;
          for (let ti = 0; ti < g.towers.length; ti++) {
            const t = g.towers[ti];
            if (t.hp > 0 && t.occupant == null && dist2(p, t) < m2) {
              t.occupant = p.pid;
              p.towerId = ti;
              p.x = t.x; p.y = t.y;
              p.dashT = 0;
              handled = true;
              break;
            }
          }
        }
        if (!handled && !(g.mode === 'ctf' || g.mode === 'br')) { // pvp: posts are inert
          for (const h of g.hires) {
            if (h.hired || dist2(p, h) >= reach2) continue;
            handled = true; // the post consumes the press even when unaffordable
            if (FOLLOWER_JOBS.has(h.job)) {
              // combat hands bind to the HIRING player. Limits: 2 per player,
              // 5 per squad — living followers only; the dead free their slot.
              let mine = 0, all = 0;
              const usedSlots = new Set();
              for (const f of g.followers) {
                if (f.dead) continue;
                all++;
                if (f.owner === p.pid) { mine++; usedSlots.add(f.slot); }
              }
              // lowest formation slot not held by a LIVING follower of this
              // hirer — a rehire after a death never doubles up a flank
              let slot = 0;
              while (usedSlots.has(slot)) slot++;
              if (mine >= MAX_FOLLOWERS_PER_PLAYER || all >= MAX_FOLLOWERS_PER_SQUAD) {
                g.events.push({ type: 'followerLimit', x: h.x, y: h.y, pid: p.pid });
              } else if (getShards(g, p) >= h.cost) {
                addShards(g, p, -h.cost);
                h.hired = true;
                g.followers.push({
                  id: g.nextFollowerId++, kind: h.job, owner: p.pid,
                  x: h.x, y: h.y, hp: FOLLOWER_STATS[h.job].hp, slot,
                  post: g.hires.indexOf(h), isFollower: true,
                  fx: 0, fy: 1, cool: 0, invulnT: 0, path: null, pathI: 0, repathT: 0,
                });
                g.events.push({ type: 'hired', name: h.name, job: h.job, cost: h.cost, x: h.x, y: h.y });
              }
            } else if (getShards(g, p) >= h.cost) {
              addShards(g, p, -h.cost);
              h.hired = true;
              g.events.push({ type: 'hired', name: h.name, job: h.job, cost: h.cost, x: h.x, y: h.y });
            }
            break;
          }
        }
        if (!handled) {
          let npc = null, bestN = (TILE * BUILD_REACH) ** 2;
          for (const n of g.npcs) {
            const dd = dist2(p, n);
            if (dd < bestN) { bestN = dd; npc = n; }
          }
          if (npc) {
            const line = npc.lines.length ? npc.lines[npc.lineIdx % npc.lines.length] : '';
            if (npc.lines.length) npc.lineIdx = (npc.lineIdx + 1) % npc.lines.length;
            let gift;
            if (!npc.given && npc.gift && npc.gift.shards) {
              npc.given = true;
              addShards(g, p, npc.gift.shards);
              gift = npc.gift.shards;
            }
            g.events.push({ type: 'talk', x: npc.x, y: npc.y, npcId: npc.id, name: npc.name, line, gift });
            questTalk(g, npc, p); // givers hand out and settle their quests
            handled = true;
          }
        }
        if (!handled && g.ship && !p.aboard
            && dist2(p, g.ship) < (TILE * SHIP_BOARD_TILES) ** 2) {
          // board the landed Anchorcraft — the chain's lowest rung, so a
          // press meant for any nearby work never doubles as a commitment
          // to leave (stepShip un-boards anyone who walks back out of reach)
          p.aboard = true;
          g.events.push({ type: 'shipBoard', pid: p.pid, x: g.ship.x, y: g.ship.y });
        }
      }
    }

    for (const c of g.captives) {
      // == null, not falsy: local couch players start at pid 0
      if (c.owner == null && dist2(p, c) < (PLAYER_R + CAPTIVE_R) ** 2) {
        c.owner = p.pid;
        g.events.push({ type: 'pickup', x: c.x, y: c.y, charId: c.charId });
      }
    }

    // quest items are scooped on touch, exactly like captives
    for (const it of g.qitems) {
      if (it.carrier == null && dist2(p, it) < (PLAYER_R + QITEM_R) ** 2) {
        it.carrier = p.pid;
        g.events.push({ type: 'qitemPickup', x: it.x, y: it.y, id: it.id, kind: it.kind, pid: p.pid });
      }
    }

    // SCRAP: scoop a loose scrap on touch (one per carrier — the carry it later
    // gives to an operator, or drops, via the DROP action). Generic item: this
    // never touches g.shards or the relic fragments. No-op off-mode (empty arr).
    if (!g.scrap.some(s => s.carrier === p.pid)) {
      for (const s of g.scrap) {
        if (s.carrier != null) continue;
        const inReach = dist2(p, s) < (PLAYER_R + SCRAP_R) ** 2;
        if (s.noPid === p.pid) { // just dropped by this seat: don't re-grab until they step off it
          if (!inReach) s.noPid = null; // walked away -> anyone (incl. them) may pick it up again
          continue;
        }
        if (inReach) {
          s.carrier = p.pid;
          g.events.push({ type: 'scrapPickup', x: s.x, y: s.y, id: s.id, pid: p.pid });
          break; // at most one scrap per pickup tick
        }
      }
    }
    // STRANDED OPERATORS: carry one to the stronghold centre (drop there to
    // save + recruit). Scoop on touch, one per carrier (a hand full of scrap is
    // fine — the two carries are independent). No-op off-mode (empty arr).
    if (!g.stranded.some(o => o.carrier === p.pid)) {
      for (const o of g.stranded) {
        if (!o.recruited && o.carrier == null && dist2(p, o) < (PLAYER_R + STRANDED_R) ** 2) {
          o.carrier = p.pid;
          g.events.push({ type: 'opPickup', x: o.x, y: o.y, opId: o.id, pid: p.pid });
          break; // at most one operator per pickup tick
        }
      }
    }

    // Music Box: scoop a free fragment on touch (one per carrier), and deposit
    // a carried fragment when the carrier reaches the altar. Same scoop/trail
    // mechanic as captives + quest items, gated on the easter-egg flag so no
    // other mode ever runs it.
    if (g.musicBox && g.musicBox.enabled && !g.musicBox.complete) {
      const mb = g.musicBox;
      const carrying = mb.fragments.some(f => f.carrier === p.pid);
      if (!carrying) {
        for (const f of mb.fragments) {
          if (!f.placed && f.carrier == null && dist2(p, f) < (PLAYER_R + MUSICBOX_R) ** 2) {
            f.carrier = p.pid;
            g.events.push({ type: 'mbPickup', x: f.x, y: f.y, id: f.id, pid: p.pid });
            break; // at most one fragment per pickup tick
          }
        }
      } else if (mb.mounts) {
        // STRONGHOLD: lock the carried shard into the nearest UNFILLED corner
        // mount within deposit range. Completion path is identical to the
        // single-altar version (assembled++/complete -> awakening).
        const depR2 = (PLAYER_R + MUSICBOX_R + 8) ** 2;
        let mount = null, best = depR2;
        for (const m of mb.mounts) {
          if (m.filled) continue;
          const d = dist2(p, m);
          if (d < best) { best = d; mount = m; }
        }
        if (mount) {
          const f = mb.fragments.find(fr => fr.carrier === p.pid);
          if (f) {
            f.carrier = null;
            f.placed = true;
            f.x = mount.x;
            f.y = mount.y;
            mount.filled = true;
            mb.assembled++;
            g.events.push({ type: 'mbPlace', x: mount.x, y: mount.y, assembled: mb.assembled, of: MUSICBOX_FRAGS });
            if (mb.assembled >= MUSICBOX_FRAGS) {
              mb.complete = true;
              g.events.push({ type: 'mbComplete', x: mb.altar.x, y: mb.altar.y });
            }
          }
        }
      } else if (dist2(p, mb.altar) < (PLAYER_R + MUSICBOX_R + 8) ** 2) {
        const f = mb.fragments.find(fr => fr.carrier === p.pid);
        if (f) {
          f.carrier = null;
          f.placed = true;
          f.x = mb.altar.x;
          f.y = mb.altar.y;
          mb.assembled++;
          g.events.push({ type: 'mbPlace', x: mb.altar.x, y: mb.altar.y, assembled: mb.assembled, of: MUSICBOX_FRAGS });
          if (mb.assembled >= MUSICBOX_FRAGS) {
            mb.complete = true;
            g.events.push({ type: 'mbComplete', x: mb.altar.x, y: mb.altar.y });
          }
        }
      }
    }

    // A dormant gate keeps its 'E' tiles inert — players just walk over them.
    if (tileAt(g, p.x, p.y) === 'E' && (!g.gate || g.gate.open)) extractPlayer(g, p);

    // --- frontier IV environmental hazards (survival maps only) ---
    // Lava sears anyone standing in it: 1 hp per 0.8s, shield pips absorb
    // first. Wading is voluntary, so the tick bypasses the hit-grace — the
    // throttled 'sizzle' doubles as the audio hook.
    if (p.maxHp !== undefined && p.state === 'active' && tileAt(g, p.x, p.y) === '!') {
      p.lavaT = (p.lavaT || 0) + dt;
      while (p.lavaT >= LAVA_PLAYER_TICK && p.state === 'active') {
        p.lavaT -= LAVA_PLAYER_TICK;
        if (p.shield > 0) p.shield--;
        else p.hp--;
        g.events.push({ type: 'sizzle', pid: p.pid, x: p.x, y: p.y, hp: p.hp, shield: p.shield });
        g.events.push({ type: 'playerHit', pid: p.pid, x: p.x, y: p.y, hp: p.hp, shield: p.shield });
        if (p.hp <= 0) {
          p.invuln = 0; // the flow grants no grace
          downPlayer(g, p);
        }
      }
    } else if (p.lavaT) p.lavaT = 0;
    // Ambient hazard (generalized toxic-air): a themed environment hazard —
    // kind 'toxin' (toxicAir modifier), 'radiation' (nuclear) or 'fire'
    // (lava/fire) — bleeds any operative lacking the immune item at hz.dmg per
    // hz.tick s (default 0.5 hp / 4s = one 1-hp tick every 8s) through the
    // standard shield/invuln rules. The immune item (mask) is full immunity.
    // A toxicAir modifier carries hz.until and only bites before that deadline;
    // theme hazards have no deadline. Identical math to the original toxicAir.
    const hz = g.ambientHazard;
    const hzLive = hz && (hz.until === undefined || g.elapsed < hz.until);
    if (hzLive && p.state === 'active'
        && p.maxHp !== undefined && !p[hz.immuneItem]) {
      p.airT = (p.airT || 0) + dt;
      while (p.airT >= hz.tick) {
        p.airT -= hz.tick;
        p.airAcc = (p.airAcc || 0) + hz.dmg;
        if (p.airAcc >= 1) {
          p.airAcc -= 1;
          damagePlayer(g, p, 1);
          // distinct per-kind event so audio/FX differ (geiger / sizzle / hiss)
          g.events.push({ type: 'ambientHazard', kind: hz.kind, x: p.x, y: p.y });
        }
      }
    } else if (p.airT) p.airT = 0;
  }

  // --- build sites and built structures: nearby players holding 'act' work
  // the site, paying shards proportionally from the shared pool as they go;
  // an empty pool stalls. On a BUILT barricade/turret the hold runs the
  // priority chain: repair while damaged, then upgrade below level 3, and
  // only a full-hp max-level structure dismantles (half of every shard ever
  // invested refunds). Pylons and farms keep their own act semantics. ---
  const holdReach2 = (TILE * BUILD_REACH) ** 2;
  // Holders in seat order; the first one is the payer (in ctf their team's
  // pool funds the work, everywhere else there is only the one pool).
  const holdersOf = s => {
    const arr = [];
    for (const p of g.players) {
      // a player driving a typeSelect carousel never works structures
      if (p.state !== 'active' || p.towerId != null || p.riding || p.selecting) continue;
      const inp = inputs[p.pid] || {};
      if (inp.act && dist2(p, s) < holdReach2) arr.push(p);
    }
    return arr;
  };
  for (const b of g.builds) {
    if (b.evT > 0) b.evT -= dt;
    if (b.built) {
      if (inertBuild(b.kind) || b.kind === 'farm') continue;
      if (b.typeSelect) {
        // the carousel (player loop above) claims every hold here; left
        // unattended, the 8s clock runs down and the turret self-confirms
        // ('gun' unless somebody cycled it and walked away)
        if (b.attended) { b.selT = 0; b.attended = false; }
        else {
          b.selT = (b.selT || 0) + dt;
          if (b.selT >= TYPE_SELECT_T) confirmTurretType(g, b);
        }
        b.dismantleT = 0;
        continue;
      }
      const holderArr = holdersOf(b);
      const holders = holderArr.length;
      if (!holders) { b.dismantleT = 0; continue; }
      if (holdStructure(g, b, b.kind, holders, dt, holderArr[0])) continue;
      // Dismantle (full hp, max level) with no enemies within 6 tiles. Closes
      // the self-seal trap and lets misplaced structures move.
      let enemyNear = false;
      const r2 = (TILE * 6) ** 2;
      for (const e of g.enemies) {
        if (!e.dead && dist2(e, b) < r2) { enemyNear = true; break; }
      }
      if (enemyNear) { b.dismantleT = 0; continue; }
      b.dismantleT = (b.dismantleT || 0) + dt * holders;
      if (b.evT <= 0) {
        g.events.push({ type: 'build', x: b.x, y: b.y });
        b.evT = 0.5;
      }
      if (b.dismantleT >= 2) {
        b.built = false;
        b.progress = 0;
        b.paid = 0;
        b.hp = 0;
        b.dismantleT = 0;
        g.buildEpoch = (g.buildEpoch || 0) + 1;
        addShards(g, holderArr[0], Math.floor((b.invested ?? b.cost) / 2));
        b.invested = 0;
        if (b.level) { b.level = 1; b.maxHp = structMaxHp(b.kind, 1); }
        g.events.push({ type: 'buildDown', x: b.x, y: b.y, kind: b.kind });
      }
      continue;
    }
    const builderArr = holdersOf(b);
    const builders = builderArr.length;
    if (!builders) continue;
    let delta, pay;
    if (g.cheats && g.cheats.instantBuild) {
      // DEV instant build: finish now, free (no hold timer, no shard cost)
      delta = 1 - b.progress;
      pay = 0;
    } else if (g.fireSaleT > 0) {
      // FIRE SALE: keep the normal hold cadence but charge nothing — the
      // structure builds for free while the timer runs.
      delta = Math.min((builders * dt) / (b.cost * 0.6), 1 - b.progress);
      pay = 0;
    } else {
      delta = Math.min((builders * dt) / (b.cost * 0.6), 1 - b.progress);
      pay = Math.min(delta * b.cost, getShards(g, builderArr[0]));
      if (b.cost > 0) delta = pay / b.cost;
    }
    if (delta <= 0) continue; // pool empty: progress stalls
    addShards(g, builderArr[0], -pay);
    b.paid += pay;
    b.progress += delta;
    if (b.evT <= 0) {
      g.events.push({ type: 'build', x: b.x, y: b.y });
      b.evT = 0.5;
    }
    if (b.progress >= 1 - 1e-9) {
      b.progress = 1;
      b.built = true;
      b.hp = b.maxHp;
      b.invested = b.cost;
      // pvp: the structure belongs to the finishing builder's team — drives
      // the turret friendly-fire exemption (undefined in co-op: all friendly)
      b.team = builderArr[0].team;
      g.buildEpoch = (g.buildEpoch || 0) + 1;
      g.events.push({ type: 'built', x: b.x, y: b.y, kind: b.kind });
      questProgress(g, 'build', [b.kind], b.x, b.y); // build quests count
      if (b.kind === 'beacon') {
        // save beacon: the client snapshots the run here (serializeGame) and
        // offers 'Resume from beacon' on mission failure. Sim just announces.
        g.events.push({ type: 'beacon', x: b.x, y: b.y });
      }
      if (b.kind === 'turret') {
        // RA2 homage: a finished turret waits in type-select; the carousel
        // (player loop) confirms it, or 8s of neglect defaults it to 'gun'.
        b.typeSelect = true;
        b.tsIdx = 0;
        b.selT = 0;
        b.attended = false;
        b.ttype = undefined;
      }
      if (b.kind === 'pylon' && g.gate) {
        g.gate.built++;
        maybeOpenGate(g);
      }
    }
  }

  // --- watchtowers: live ones repair/upgrade/dismantle exactly like built
  // structures; a destroyed tower is a build site again (cost 10). ---
  for (const t of g.towers) {
    if (t.evT === undefined) t.evT = 0;
    if (t.evT > 0) t.evT -= dt;
    const holderArr = holdersOf(t);
    const holders = holderArr.length;
    if (t.hp <= 0) {
      if (!holders) continue;
      let delta = Math.min((holders * dt) / (TOWER_REBUILD_COST * 0.6), 1 - (t.progress || 0));
      const pay = Math.min(delta * TOWER_REBUILD_COST, getShards(g, holderArr[0]));
      delta = pay / TOWER_REBUILD_COST;
      if (delta <= 0) continue; // pool empty: progress stalls
      addShards(g, holderArr[0], -pay);
      t.progress = (t.progress || 0) + delta;
      if (t.evT <= 0) {
        g.events.push({ type: 'build', x: t.x, y: t.y });
        t.evT = 0.5;
      }
      if (t.progress >= 1 - 1e-9) {
        t.progress = 0;
        t.maxHp = structMaxHp('tower', t.level);
        t.hp = t.maxHp;
        t.invested = (t.invested || 0) + TOWER_REBUILD_COST;
        g.events.push({ type: 'built', x: t.x, y: t.y, kind: 'tower', level: t.level });
      }
      continue;
    }
    if (!holders) { t.dismantleT = 0; continue; }
    if (holdStructure(g, t, 'tower', holders, dt, holderArr[0])) continue;
    let enemyNear = false;
    const r2 = (TILE * 6) ** 2;
    for (const e of g.enemies) {
      if (!e.dead && dist2(e, t) < r2) { enemyNear = true; break; }
    }
    if (enemyNear) { t.dismantleT = 0; continue; }
    t.dismantleT = (t.dismantleT || 0) + dt * holders;
    if (t.evT <= 0) {
      g.events.push({ type: 'build', x: t.x, y: t.y });
      t.evT = 0.5;
    }
    if (t.dismantleT >= 2) {
      t.dismantleT = 0;
      addShards(g, holderArr[0], Math.floor((t.invested || 0) / 2));
      towerDown(g, t);
    }
  }

  // --- hired operators work their posts on fixed deterministic ticks ---
  for (const h of g.hires) {
    // a combat post whose follower went down restocks after 20s
    if (h.restockT > 0) {
      h.restockT -= dt;
      if (h.restockT <= 0) {
        h.restockT = 0;
        h.hired = false;
        g.events.push({ type: 'restock', x: h.x, y: h.y, job: h.job });
      }
    }
    if (!h.hired) continue;
    if (FOLLOWER_JOBS.has(h.job)) continue; // combat hands fight afield, no post work
    h.workT = (h.workT || 0) + dt;
    if (h.job === 'smith') {
      while (h.workT >= 20) { // +1 shard to the pool every 20s
        h.workT -= 20;
        // ctf maps field no hire posts; if one ever does, the smith pays
        // both team pools alike (no side gets the long straw)
        if (g.teamShards) { g.teamShards[0] += 1; g.teamShards[1] += 1; }
        else g.shards += 1;
        g.events.push({ type: 'shard', x: h.x, y: h.y, amount: 1 });
      }
    } else if (h.job === 'engineer') {
      while (h.workT >= 3) { // patches the nearest damaged structure, free
        h.workT -= 3;
        let tgt = null, best = Infinity;
        for (const b of g.builds) {
          if (!b.built || inertBuild(b.kind) || b.hp >= b.maxHp) continue;
          const dd = dist2(h, b);
          if (dd < best) { best = dd; tgt = b; }
        }
        for (const t of g.towers) {
          if (t.hp <= 0 || t.hp >= t.maxHp) continue;
          const dd = dist2(h, t);
          if (dd < best) { best = dd; tgt = t; }
        }
        if (tgt) {
          tgt.hp = Math.min(tgt.maxHp, tgt.hp + 1);
          g.events.push({ type: 'repair', x: tgt.x, y: tgt.y, hp: tgt.hp });
        }
      }
    }
    // farmers speed growth and replant tramples — both live in the farm loop
  }

  // --- farms: stages grow on a timer (faster with a hired farmer working);
  // enemies crossing a planted farm at night trample it back to a dead plot.
  // Trampled plots stay fallow until replanted: instantly by a player's act,
  // or after 10s by a hired farmer. ---
  for (const b of g.builds) {
    if (!b.built || b.kind !== 'farm') continue;
    const farmer = g.hires.some(h => h.hired && h.job === 'farmer');
    if (b.trampled) {
      if (farmer) {
        b.replantT = (b.replantT || 0) + dt;
        if (b.replantT >= FARM_REPLANT_T) {
          b.trampled = false;
          b.replantT = 0;
          b.growT = 0;
        }
      }
    } else if (b.stage < 3) {
      const need = farmer ? FARM_GROW_FAST : FARM_GROW_T;
      b.growT += dt;
      if (b.growT >= need) { b.growT = 0; b.stage++; }
    }
    if (b.stage > 0 && g.cycle && g.cycle.phase === 'night') {
      const rr = (BUILD_RADIUS + ENEMY_R) ** 2;
      for (const e of g.enemies) {
        if (!e.dead && dist2(e, b) < rr) {
          b.stage = 0;
          b.growT = 0;
          b.trampled = true;
          b.replantT = 0;
          g.events.push({ type: 'trample', x: b.x, y: b.y });
          break;
        }
      }
    }
  }

  // --- lure crackers: fly the 4-tile arc, land, pull every enemy within 9
  // tiles (nearestTarget override) for the fuse, then detonate ---
  for (let i = g.crackers.length - 1; i >= 0; i--) {
    const c = g.crackers[i];
    if (!c.landed) {
      c.flightT -= dt;
      const t = Math.max(0, c.flightT) / CRACKER_FLIGHT;
      c.x = c.tx - (c.tx - c.sx) * t;
      c.y = c.ty - (c.ty - c.sy) * t;
      if (c.flightT <= 0) {
        c.landed = true;
        c.x = c.tx; c.y = c.ty;
        g.events.push({ type: 'crackerOut', x: c.x, y: c.y });
      }
      continue;
    }
    c.fuse -= dt;
    if (c.fuse <= 0) {
      g.events.push({ type: 'crackerBoom', x: c.x, y: c.y, radius: TILE * CRACKER_AOE });
      const r2 = (TILE * CRACKER_AOE) ** 2;
      for (const e of g.enemies) {
        // converted allies are spared (no convert-then-boom score farming);
        // kills credit the thrower's seat with xp, like every other item
        if (e.dead || e.convertedT > 0) continue;
        if (dist2(c, e) <= r2) damageEnemy(g, e, CRACKER_DMG, e.x, e.y, 'cracker', c.pid);
      }
      // pvp only: the boom clips OTHER-team operatives caught in the lure
      // (never same-team; invuln/shield rules ride damagePlayer as usual)
      if ((g.mode === 'ctf' || g.mode === 'br') && c.pid !== undefined) {
        for (const q of g.players) {
          if (q.state !== 'active' || q.pid === c.pid || q.team === c.team || q.invuln > 0) continue;
          if (dist2(c, q) <= r2) pvpHit(g, q, CRACKER_DMG, c.pid);
        }
      }
      g.crackers.splice(i, 1);
    }
  }

  // --- shard drops: expire, magnetize toward the nearest player, collect ---
  for (let i = g.drops.length - 1; i >= 0; i--) {
    const d = g.drops[i];
    d.ttl -= dt;
    if (d.ttl <= 0) { g.drops.splice(i, 1); continue; }
    let near = null, best = Infinity;
    for (const p of g.players) {
      if (p.state !== 'active') continue;
      const dd = dist2(d, p);
      if (dd < best) { best = dd; near = p; }
    }
    if (!near) continue;
    // magnetize and collect only with a clear walkable line — shards must not
    // slide through walls or leak out of sealed pockets
    if (best < (TILE * MAGNET_RANGE) ** 2 && hasLoS(g, d.x, d.y, near.x, near.y)) {
      const [mx, my] = norm(near.x - d.x, near.y - d.y);
      d.x += mx * MAGNET_SPEED * TILE * dt;
      d.y += my * MAGNET_SPEED * TILE * dt;
    }
    if (dist2(d, near) < TILE * TILE && hasLoS(g, d.x, d.y, near.x, near.y)) {
      addShards(g, near, d.amount); // ctf: the collector's team pool
      g.events.push({ type: 'shard', x: d.x, y: d.y, amount: d.amount });
      g.drops.splice(i, 1);
    }
  }

  // --- POWER-UP DROPS: float + pulse (no magnetize — you WALK over them),
  // despawn after their ttl, and fire a team-wide effect the instant any
  // friendly seat steps within pickup radius. The whole block no-ops on the
  // empty array, so untouched modes pay nothing and stay byte-identical. ---
  for (let i = g.powerups.length - 1; i >= 0; i--) {
    const pu = g.powerups[i];
    pu.ttl -= dt;
    if (pu.ttl <= 0) { g.powerups.splice(i, 1); continue; }
    const r2 = (TILE * POWERUP_PICKUP_R) ** 2;
    let picker = null;
    for (const p of g.players) {
      if (p.state !== 'active') continue;
      if (dist2(pu, p) <= r2) { picker = p; break; }
    }
    if (picker) {
      g.powerups.splice(i, 1);     // consume before firing so a nuke can't re-grab
      triggerPowerup(g, pu, picker);
    }
  }
  // POWER-UP EFFECT TIMERS: tick down each step. fireSaleT zeroes build costs;
  // freeSprintT suppresses stamina drain (both gated at their use sites).
  if (g.fireSaleT > 0) g.fireSaleT = Math.max(0, g.fireSaleT - dt);
  if (g.freeSprintT > 0) g.freeSprintT = Math.max(0, g.freeSprintT - dt);

  // --- built turrets: each confirmed type runs its own pattern, level-scaled.
  //   gun:   projectile, dmg 1/2/3, reach 5.5/6/6.5 tiles, every 0.55s
  //          (the cheap reliable single-target pick beside the prism)
  //   prism: instant beam, dmg 2/3/4 +1 per OTHER built prism within 4 tiles
  //          (cap +3, the RA2 chain), reach 7/7.5/8, every 1.2s
  //   tesla: chain-zap up to 3 enemies for 2/1/1 (3/2/1, 4/2/2) + 0.4s stun,
  //          reach 4/4.5/5, every 1.5s
  //   toxin: lobs a toxin patch onto the nearest awake enemy in 5/5.5/6 every
  //          3s (a lob: no sight line needed)
  // A turret still in typeSelect holds its fire. Turret kills pay no xp. ---
  for (const b of g.builds) {
    if (!b.built || b.kind !== 'turret' || b.typeSelect) continue;
    if (b.cool > 0) { b.cool -= dt; continue; }
    const lvl = b.level || 1;
    const ttype = b.ttype || 'gun';
    const pick = (rangeTiles, needLoS) => {
      let tgt = null, best = (TILE * rangeTiles) ** 2;
      for (const e of g.enemies) {
        if (e.dead || !e.awake || e.convertedT > 0) continue;
        const dd = dist2(b, e);
        if (dd < best && (!needLoS || hasLoS(g, b.x, b.y, e.x, e.y, blocksSight))) { best = dd; tgt = e; }
      }
      return tgt;
    };
    if (ttype === 'gun') {
      const tgt = pick(TURRET_RANGE[lvl - 1], true);
      if (tgt) {
        // shot flight range rides half a tile past targeting reach so the
        // round always covers the distance to an edge-of-range target
        fireWeapon(g, b, { ...TURRET_WEAPON, damage: TURRET_DMG[lvl - 1], range: TURRET_RANGE[lvl - 1] + 0.5 }, 'p', tgt);
        b.cool = TURRET_PERIOD;
      }
    } else if (ttype === 'prism') {
      // RA2 Prism Tower linking: of all prisms within link radius of each other,
      // exactly ONE is the MASTER and fires; the rest are SUPPORTERS that HOLD
      // FIRE and feed it. Each feeder adds PRISM_FEED_DMG, capped at
      // PRISM_FEED_CAP feeders (diminishing returns past the cap). The master is
      // the lowest build-index linked prism THAT HAS A TARGET — a deterministic
      // pick that never silences the group just because the lowest-index prism
      // is out of range. A lone prism with a target simply fires its base beam.
      const tgt = pick(PRISM_RANGE[lvl - 1], true);
      if (tgt) {
        const link2 = (TILE * PRISM_LINK_R) ** 2;
        const myIdx = g.builds.indexOf(b);
        const linkedPrisms = [];
        let supporter = false;
        for (let oi = 0; oi < g.builds.length; oi++) {
          const o = g.builds[oi];
          if (o === b || !o.built || o.kind !== 'turret' || o.ttype !== 'prism' || o.typeSelect) continue;
          if (dist2(b, o) >= link2) continue;
          linkedPrisms.push(o);
          // a lower-index linked prism that ALSO has a target outranks me as
          // master, so I become a supporter and hold fire this group
          if (oi < myIdx && prismHasTarget(g, o)) supporter = true;
        }
        if (supporter) {
          b.cool = PRISM_PERIOD; // feed the master; clock drains on schedule
        } else {
          let feed = 0;
          for (const o of linkedPrisms) {
            if (feed >= PRISM_FEED_CAP) break;
            feed++;
            g.events.push({ type: 'prismFeed', x: o.x, y: o.y, tx: b.x, ty: b.y });
          }
          const dmg = PRISM_DMG[lvl - 1] + feed * PRISM_FEED_DMG;
          g.events.push({ type: 'prismBeam', x: b.x, y: b.y, tx: tgt.x, ty: tgt.y, dmg, ...(feed ? { linked: feed } : {}) });
          damageEnemy(g, tgt, dmg, tgt.x, tgt.y, 'prism');
          b.cool = PRISM_PERIOD;
        }
      }
    } else if (ttype === 'tesla') {
      const first = pick(TESLA_RANGE[lvl - 1], true);
      if (first) {
        // chain: hop to the nearest remaining enemy still inside turret reach
        const range2 = (TILE * TESLA_RANGE[lvl - 1]) ** 2;
        const targets = [first];
        let from = first;
        while (targets.length < 3) {
          let nxt = null, best = Infinity;
          for (const e of g.enemies) {
            if (e.dead || e.convertedT > 0 || targets.includes(e)) continue;
            if (dist2(b, e) >= range2) continue;
            const dd = dist2(from, e);
            if (dd < best) { best = dd; nxt = e; }
          }
          if (!nxt) break;
          targets.push(nxt);
          from = nxt;
        }
        g.events.push({ type: 'teslaZap', x: b.x, y: b.y, targets: targets.map(t => ({ x: t.x, y: t.y })) });
        const dmgs = TESLA_DMG[lvl - 1];
        for (let i = 0; i < targets.length; i++) {
          const t = targets[i];
          t.stunT = Math.max(t.stunT || 0, TESLA_STUN); // stun first: kills don't care
          damageEnemy(g, t, dmgs[i], t.x, t.y, 'tesla');
        }
        b.cool = TESLA_PERIOD;
      }
    } else if (ttype === 'toxin') {
      const tgt = pick(TOXIN_TURRET_RANGE[lvl - 1], false);
      if (tgt) {
        const r = TOXIN_TURRET_R[lvl - 1] * TILE;
        g.patches.push({ x: tgt.x, y: tgt.y, kind: 'toxin', r, ttl: TOXIN_PATCH_TTL });
        g.events.push({ type: 'patch', x: tgt.x, y: tgt.y, kind: 'toxin', r });
        b.cool = TOXIN_TURRET_PERIOD;
      }
    }
  }

  // --- captives follow their owner ---
  for (const c of g.captives) {
    if (c.owner == null) continue;
    const o = g.players.find(p => p.pid === c.owner);
    if (!o || o.state !== 'active') { c.owner = null; continue; }
    const d = Math.hypot(o.x - c.x, o.y - c.y);
    const gap = PLAYER_R + CAPTIVE_R + 8;
    if (d > gap) {
      const t = Math.min(1, ((d - gap) / d) * 8 * dt);
      c.x += (o.x - c.x) * t;
      c.y += (o.y - c.y) * t;
    }
  }

  // --- quest items trail their carrier like captives; a carrier going down
  // (or extracting) lays them where they stood, free for anyone to scoop ---
  for (const it of g.qitems) {
    if (it.carrier == null) continue;
    const o = g.players.find(p => p.pid === it.carrier);
    if (!o || o.state !== 'active') { it.carrier = null; continue; }
    const d = Math.hypot(o.x - it.x, o.y - it.y);
    const gap = PLAYER_R + QITEM_R + 8;
    if (d > gap) {
      const t = Math.min(1, ((d - gap) / d) * 8 * dt);
      it.x += (o.x - it.x) * t;
      it.y += (o.y - it.y) * t;
    }
  }

  // --- music box fragments trail their carrier exactly like quest items; a
  // carrier going down (or extracting) drops the fragment where they fell,
  // free for anyone to recover. Placed (deposited) fragments never move. ---
  if (g.musicBox && g.musicBox.enabled) {
    for (const f of g.musicBox.fragments) {
      if (f.carrier == null) continue;
      const o = g.players.find(p => p.pid === f.carrier);
      if (!o || o.state !== 'active') { f.carrier = null; continue; }
      const d = Math.hypot(o.x - f.x, o.y - f.y);
      const gap = PLAYER_R + MUSICBOX_R + 8;
      if (d > gap) {
        const t = Math.min(1, ((d - gap) / d) * 8 * dt);
        f.x += (o.x - f.x) * t;
        f.y += (o.y - f.y) * t;
      }
    }
  }

  // --- carried scrap + stranded operators trail their carrier exactly like
  // captives; a carrier going down sets them down where they fell. Both arrays
  // are empty off-mode, so these loops are pure no-ops on every other level. ---
  for (const s of g.scrap) {
    if (s.carrier == null) continue;
    const o = g.players.find(p => p.pid === s.carrier);
    if (!o || o.state !== 'active') { s.carrier = null; continue; }
    const d = Math.hypot(o.x - s.x, o.y - s.y);
    const gap = PLAYER_R + SCRAP_R + 8;
    if (d > gap) {
      const t = Math.min(1, ((d - gap) / d) * 8 * dt);
      s.x += (o.x - s.x) * t;
      s.y += (o.y - s.y) * t;
    }
  }
  for (const op of g.stranded) {
    if (op.carrier == null) continue;
    const o = g.players.find(p => p.pid === op.carrier);
    if (!o || o.state !== 'active') { op.carrier = null; continue; }
    const d = Math.hypot(o.x - op.x, o.y - op.y);
    const gap = PLAYER_R + STRANDED_R + 8;
    if (d > gap) {
      const t = Math.min(1, ((d - gap) / d) * 8 * dt);
      op.x += (o.x - op.x) * t;
      op.y += (o.y - op.y) * t;
    }
  }

  stepQuests(g); // reach checks + live fetch progress for the objectives HUD

  // --- monolythium puzzle systems: quorum windows, the seal forge, doors
  // (parked openDoor rewards + lythseal touches), teleport pads. All empty
  // on classics — pure no-ops. ---
  stepSwitchGroups(g, dt);
  stepForges(g, inputs, dt);
  stepDoors(g);
  stepTeleports(g, dt);

  // --- beacon-defense: day relights, the Anchorcraft landing/boarding (can
  // clear the mission outright on an all-aboard launch) ---
  stepBeacons(g, inputs, dt);
  stepHorn(g, inputs, dt);
  stepShip(g, inputs, dt);
  if (g.status !== 'play') return;

  // --- pvp: carried flags track their runners, dropped ones tick home;
  // the BR zone closes in and burns whoever lingers outside ---
  stepFlags(g, dt);
  stepZone(g, dt);

  // --- enemies (frozen during the level-start grace period, and held entirely
  // under the Pause Time cheat so the field stops dead). Ice momentum mirrors
  // the player rule: 60% of last tick's movement drifts first. ---
  if (frozen) { /* Pause Time: enemies hold position, no AI/attacks tick */ }
  else if (g.graceT > 0) g.graceT -= dt;
  else {
    for (const e of g.enemies) {
      const ex0 = e.x, ey0 = e.y;
      if (!g.arcade && !e.dead && !(e.stunT > 0) && (e.mvX || e.mvY) && tileAt(g, e.x, e.y) === '^') {
        moveCircle(g, e, e.mvX * ICE_DRIFT, e.mvY * ICE_DRIFT, ENEMY_R);
      }
      stepEnemy(g, e, dt);
      e.mvX = e.x - ex0;
      e.mvY = e.y - ey0;
    }
  }

  // --- combat depth: status clocks (stun/burn/toxin/mind-control), ground
  // patches, hired combat followers. All empty on classics — pure no-ops. All
  // held under Pause Time so nothing in the world advances. ---
  if (!frozen) {
    stepStatuses(g, dt);
    stepPatches(g, dt);
    stepFollowers(g, dt);
    stepHazards(g, dt); // relic superweapon hazard fields (no-op until one lands)
  }

  // --- shots ---
  for (let i = g.shots.length - 1; i >= 0; i--) {
    const s = g.shots[i];
    // Pause Time: enemy projectiles hang frozen in the air (the player can still
    // fire and their rounds keep flying). Player shots fall through and advance.
    if (frozen && s.who === 'e') continue;
    if (s.curve) {
      const ca = Math.cos(s.curve * dt), sa = Math.sin(s.curve * dt);
      const vx = s.vx * ca - s.vy * sa;
      const vy = s.vx * sa + s.vy * ca;
      s.vx = vx; s.vy = vy;
    }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.ttl -= dt;
    let dead = s.ttl <= 0 || s.x < 0 || s.y < 0 || s.x > g.w * TILE || s.y > g.h * TILE;
    if (!dead && !s.overWalls && (blocksSight(tileAt(g, s.x, s.y)) || doorBlocksPx(g, s.x, s.y))) {
      dead = true;
      g.events.push({ type: 'hitWall', x: s.x, y: s.y });
    }
    if (!dead && s.who === 'p') {
      for (const e of g.enemies) {
        // mind-controlled enemies fight for the squad: player fire passes over
        if (e.dead || e.convertedT > 0 || s.hits.includes(e.id)) continue;
        if (dist2(s, e) < (ENEMY_R + (s.radius || SHOT_R)) ** 2) {
          if (shieldBlocks(e, s)) {
            dead = true;
            g.events.push({ type: 'shield', x: e.x, y: e.y, kind: e.kind });
            break;
          }
          s.hits.push(e.id);
          // evolution riders land BEFORE the damage so a killing blow still
          // counts as ignited (L4 burn corpses leave their ground patch)
          if (s.stun) e.stunT = Math.max(e.stunT || 0, s.stun);
          if (s.ignite) igniteEnemy(g, e, s.ownerPid, !!s.ignitePatch);
          damageEnemy(g, e, s.dmg, e.x, e.y, s.kind, s.ownerPid);
          if (s.shockArc) {
            // L4 shock: arc to the nearest OTHER enemy within 2 tiles at half
            // damage, stunned like a direct hit
            let arc = null, bestA = (TILE * 2) ** 2;
            for (const o of g.enemies) {
              if (o === e || o.dead || o.convertedT > 0) continue;
              const dd = dist2(e, o);
              if (dd < bestA) { bestA = dd; arc = o; }
            }
            if (arc) {
              arc.stunT = Math.max(arc.stunT || 0, s.stun || STUN_T);
              g.events.push({ type: 'shockArc', x: e.x, y: e.y, tx: arc.x, ty: arc.y });
              damageEnemy(g, arc, s.dmg / 2, arc.x, arc.y, 'shock', s.ownerPid);
            }
          }
          if (s.knockback && !e.dead) {
            // tornado: shove the victim back along the shot's line of flight
            const sp = Math.hypot(s.vx, s.vy) || 1;
            moveCircle(g, e, (s.vx / sp) * s.knockback * TILE, (s.vy / sp) * s.knockback * TILE, ENEMY_R);
          }
          if (s.aoeRadius) explode(g, s, e);
          if (s.pierce > 0) s.pierce--;
          else dead = true;
          break;
        }
      }
      // LYTH crystals crack under player fire; a broken node spills shards.
      if (!dead) {
        for (const c of g.crystals) {
          if (c.hp <= 0 || s.hits.includes('y' + c.cid)) continue;
          if (dist2(s, c) < (CRYSTAL_R + (s.radius || SHOT_R)) ** 2) {
            s.hits.push('y' + c.cid);
            c.hp -= s.dmg;
            if (c.hp <= 0) {
              g.events.push({ type: 'crystal', x: c.x, y: c.y });
              g.drops.push({ x: c.x, y: c.y, amount: 4, ttl: DROP_TTL });
            }
            if (s.pierce > 0) s.pierce--;
            else dead = true;
            break;
          }
        }
      }
      // BLS pillars crack under player fire alone ('destroy obsolete
      // cryptography') — enemy shots and explosions pass clean over them.
      if (!dead && g.pillars.length) {
        for (const pl of g.pillars) {
          if (pl.hp <= 0 || s.hits.includes(pl.id)) continue;
          if (dist2(s, pl) < (PILLAR_R + (s.radius || SHOT_R)) ** 2) {
            s.hits.push(pl.id);
            pl.hp -= s.dmg;
            g.events.push({ type: 'pillarHit', x: pl.x, y: pl.y, hp: Math.max(0, pl.hp) });
            if (pl.hp <= 0) {
              g.events.push({ type: 'pillarDown', id: pl.id, x: pl.x, y: pl.y });
              questProgress(g, 'destroy', ['pillar', pl.id], pl.x, pl.y);
            }
            if (s.pierce > 0) s.pierce--;
            else dead = true;
            break;
          }
        }
      }
      // FORTIFIED WALLS: player shots demolish structures on DIRECT hits —
      // walls, barricades, towers and comm masts; NEVER pylons or beacons
      // (inert), never farms, and never the own team's turrets (see below).
      // Seat-fired rounds only (turret and
      // follower fire carries no ownerPid) and lobbed overWalls arcs sail
      // clean over. AoE splash and ground patches never touch structures —
      // so this is the official self-rescue: built yourself in? Shoot out.
      if (!dead && s.ownerPid !== undefined && !s.overWalls) {
        for (let bi = 0; bi < g.builds.length; bi++) {
          const b = g.builds[bi];
          if (!b.built || inertBuild(b.kind) || b.kind === 'farm' || s.hits.includes('b' + bi)) continue;
          // turrets are friendly-fire-proof: your own team's guns can't be
          // shot down (hold ACT to DISMANTLE instead). Walls and barricades
          // stay demolishable — that's the built-yourself-in escape hatch.
          // In pvp the OTHER team's turrets are fair game.
          if (b.kind === 'turret' && (s.team === undefined || s.team === b.team)) continue;
          if (dist2(s, b) < (BUILD_RADIUS + (s.radius || SHOT_R)) ** 2) {
            s.hits.push('b' + bi);
            b.hp -= s.dmg;
            g.events.push({ type: 'buildHit', x: b.x, y: b.y });
            if (b.hp <= 0) {
              b.hp = 0;
              b.built = false;
              b.progress = 0;
              b.paid = 0;
              if (b.level) { b.level = 1; b.maxHp = structMaxHp(b.kind, 1); }
              g.buildEpoch = (g.buildEpoch || 0) + 1;
              g.events.push({ type: 'buildDown', x: b.x, y: b.y, kind: b.kind });
            }
            if (s.pierce > 0) s.pierce--;
            else dead = true;
            break;
          }
        }
        if (!dead) {
          for (let ti = 0; ti < g.towers.length; ti++) {
            const t = g.towers[ti];
            if (t.hp <= 0 || s.hits.includes('t' + ti)) continue;
            if (dist2(s, t) < (BUILD_RADIUS + (s.radius || SHOT_R)) ** 2) {
              s.hits.push('t' + ti);
              t.hp -= s.dmg;
              g.events.push({ type: 'buildHit', x: t.x, y: t.y });
              if (t.hp <= 0) towerDown(g, t);
              if (s.pierce > 0) s.pierce--;
              else dead = true;
              break;
            }
          }
        }
      }
      // pvp/siege: player fire hits OTHER-team operatives (friendly fire is off;
      // shots sail through teammates and invulnerable targets)
      if (!dead && (g.mode === 'ctf' || g.mode === 'br' || g.siege) && s.pid !== undefined) {
        for (const q of g.players) {
          if (q.state !== 'active' || q.pid === s.pid || q.team === s.team || q.invuln > 0) continue;
          if (dist2(s, q) < (PLAYER_R + (s.radius || SHOT_R)) ** 2) {
            pvpHit(g, q, s.dmg, s.pid);
            dead = true; // an aoe shot still explodes below (dead handling)
            break;
          }
        }
      }
    } else if (!dead && s.who === 'e') {
      for (const p of g.players) {
        if (p.state === 'active' && p.invuln <= 0 && dist2(s, p) < (PLAYER_R + (s.radius || SHOT_R)) ** 2) {
          dead = true;
          if (s.aoeRadius) explode(g, s);
          else {
            // volt zap: a shield pip absorbs the WHOLE zap — the root only
            // lands when the hit reached hp (arcade never fields wraiths)
            const soaked = p.shield !== undefined && p.shield > 0;
            damagePlayer(g, p);
            if (s.stunPlayer && !soaked) p.stunT = Math.max(p.stunT || 0, s.stunPlayer);
          }
          break;
        }
      }
      // followers soak enemy fire too (contact damage rides nearestTarget)
      if (!dead) {
        for (const f of g.followers) {
          if (f.dead || f.invulnT > 0) continue;
          if (dist2(s, f) < (FOLLOWER_R + (s.radius || SHOT_R)) ** 2) {
            dead = true;
            if (s.aoeRadius) explode(g, s);
            else damageFollower(g, f, s.dmg);
            break;
          }
        }
      }
      // WALLS MATTER: built blocking structures soak enemy fire — the round
      // hits the wall (1 damage, like a gnaw bite), not the squad behind it.
      // Pylons/beacon-kind builds block without taking damage (inert), and
      // lobbed overWalls arcs still sail clean over everything. The base
      // core and the beacon monoliths are physical too: a lit one takes the
      // hit (coreHit), a dark monolith just stops the round cold.
      if (!dead && !s.overWalls) {
        for (const b of g.builds) {
          if (!b.built || b.kind === 'farm') continue;
          if (dist2(s, b) < (BUILD_RADIUS + (s.radius || SHOT_R)) ** 2) {
            dead = true;
            if (!inertBuild(b.kind)) {
              b.hp -= 1;
              g.events.push({ type: 'buildHit', x: b.x, y: b.y });
              if (b.hp <= 0) {
                b.hp = 0;
                b.built = false;
                b.progress = 0;
                b.paid = 0;
                if (b.level) { b.level = 1; b.maxHp = structMaxHp(b.kind, 1); }
                g.buildEpoch = (g.buildEpoch || 0) + 1;
                g.events.push({ type: 'buildDown', x: b.x, y: b.y, kind: b.kind });
              }
            }
            break;
          }
        }
        if (!dead) {
          for (const t of g.towers) {
            if (t.hp <= 0) continue;
            if (dist2(s, t) < (BUILD_RADIUS + (s.radius || SHOT_R)) ** 2) {
              dead = true;
              t.hp -= 1;
              g.events.push({ type: 'buildHit', x: t.x, y: t.y });
              if (t.hp <= 0) towerDown(g, t);
              break;
            }
          }
        }
        // DEV core integrity: shots still die on contact, but the center keeps its hp
        const coreInvuln = !!(g.cheats && g.cheats.coreInvuln);
        if (!dead && g.core && g.core.hp > 0
            && dist2(s, g.core) < (CORE_R + (s.radius || SHOT_R)) ** 2) {
          dead = true;
          if (!coreInvuln) {
            g.core.hp -= 1;
            g.events.push({ type: 'coreHit', x: g.core.x, y: g.core.y, hp: Math.max(0, g.core.hp) });
          }
        }
        if (!dead && g.cores) {
          for (let ci = 0; ci < g.cores.length; ci++) {
            const c = g.cores[ci];
            if (dist2(s, c) < (CORE_R + (s.radius || SHOT_R)) ** 2) {
              dead = true;
              if (c.lit && !coreInvuln) {
                c.hp -= 1;
                g.events.push({ type: 'coreHit', idx: ci, x: c.x, y: c.y, hp: Math.max(0, c.hp) });
                if (c.hp <= 0) {
                  c.hp = 0;
                  c.lit = false;
                  g.events.push({ type: 'beaconDown', idx: ci, x: c.x, y: c.y });
                }
              }
              break;
            }
          }
        }
      }
    }
    // Anchor Siege: player shots hit enemy minions/towers/(exposed)core; tower
    // ('siege') shots hit enemy minions only. Keyed on the shot's stamped team.
    if (!dead && g.siege && s.team != null && (s.who === 'p' || s.who === 'siege')) {
      for (const m of g.siege.minions) {
        if (m.team === s.team || s.hits.includes('m' + m.id)) continue;
        if (dist2(s, m) < (MINION_R + (s.radius || SHOT_R)) ** 2) {
          s.hits.push('m' + m.id);
          damageMinion(g, m, s.dmg, s.ownerPid);
          if (s.pierce > 0) s.pierce--; else dead = true;
          break;
        }
      }
      if (!dead && s.who === 'p') {
        for (const t of g.siegeTowers) {
          if (t.destroyed || t.team === s.team) continue;
          if (dist2(s, t) < (SIEGE_TOWER_R + (s.radius || SHOT_R)) ** 2) {
            damageTower(g, t, s.dmg, s.ownerPid);
            if (s.pierce > 0) s.pierce--; else dead = true;
            break;
          }
        }
        if (!dead) for (const c of g.cores) {
          if (c.team === s.team || c.hp <= 0 || !siegeCoreOpen(g, c.team)) continue;
          if (dist2(s, c) < (SIEGE_CORE_R + (s.radius || SHOT_R)) ** 2) {
            c.hp = Math.max(0, c.hp - s.dmg);
            g.events.push({ type: 'coreHit', x: c.x, y: c.y, team: c.team });
            dead = true; break;
          }
        }
      }
    }
    if (dead) {
      if (s.aoeRadius) explode(g, s);
      g.shots.splice(i, 1);
    }
  }

  g.enemies = g.enemies.filter(e => !e.dead);
  g.crystals = g.crystals.filter(c => c.hp > 0);
  if (g.pillars.length) g.pillars = g.pillars.filter(pl => pl.hp > 0);
  if (g.followers.length) g.followers = g.followers.filter(f => !f.dead);

  // --- end conditions ---
  // Anchor Siege: a team wins the moment the ENEMY core falls.
  if (g.siege) {
    for (const c of g.cores) {
      if (c.hp <= 0) { g.events.push({ type: 'coreDown', x: c.x, y: c.y, team: c.team }); pvpWin(g, siegeFoe(c.team)); return; }
    }
  }
  // Beacon-defense: the mission is lost only when ALL FOUR monoliths are
  // dark at once (single dark beacons are recoverable by day).
  else if (g.cores && g.cores.every(c => !c.lit)) {
    g.status = 'failed';
    g.events.push({ type: 'allDark', x: g.w * TILE / 2, y: g.h * TILE / 2 });
    g.events.push({ type: 'fail', x: g.w * TILE / 2, y: g.h * TILE / 2 });
    return;
  }
  // Bastion: the base core falling loses the mission outright.
  if (g.core && g.core.hp <= 0) {
    g.status = 'failed';
    g.events.push({ type: 'coreDown', x: g.core.x, y: g.core.y });
    g.events.push({ type: 'fail', x: g.core.x, y: g.core.y });
    return;
  }
  // PvP ends on its own terms: BR crowns the last operative standing (a
  // simultaneous wipe goes to the last one eliminated); CTF wins are declared
  // at capture or timer expiry. Neither extracts nor all-out fails.
  if (g.mode === 'ctf' || g.mode === 'br') {
    if (g.mode === 'br') {
      const active = g.players.filter(p => p.state === 'active');
      if (g.players.length >= 2 && active.length <= 1) {
        let w;
        if (active.length) {
          w = active[0].pid;
        } else {
          // simultaneous wipe (the final collapse can burn the last few in
          // one tick): most kills this match wins; ties go to the lower pid
          w = undefined;
          let bk = -1;
          for (const p of g.players) {
            const k = p.kills || 0;
            if (k > bk || (k === bk && (w === undefined || p.pid < w))) { bk = k; w = p.pid; }
          }
        }
        pvpWin(g, w);
      }
    }
    return;
  }
  // Quest maps hold the field open while the MAIN story is unfinished: an
  // incomplete main quest (hidden, active or unsatisfied) blocks the
  // extermination auto-clear — secondaries never block anything. A main
  // 'reach' quest counts complete the moment it trips: the finale fires at
  // the ring, not after a walk back to the giver.
  const mainDone = q => q.state === 'done'
    || (q.kind === 'reach' && q.state === 'active' && q.progress >= q.count);
  const mains = g.quests.filter(q => q.main);
  const mainsLeft = mains.some(q => !mainDone(q));
  // A main chain that carries a 'reach' finale (ch7's helm launch) clears the
  // chapter outright once the whole chain is settled — those maps field no
  // exit tiles and no gate; the reach IS the extraction.
  if (!g.mode && !mainsLeft && mains.some(q => q.kind === 'reach')) {
    for (const p of g.players) if (p.state === 'active') extractPlayer(g, p);
    g.status = 'cleared';
    g.events.push({ type: 'clear', x: g.w * TILE / 2, y: g.h * TILE / 2, points: Math.round(g.score) });
    return;
  }
  // Mode missions (bastion/ctf/br) never auto-clear on an empty field —
  // bastion waits for the final dawn, pvp modes have no AI enemies at all.
  if (g.enemies.length === 0 && !g.mode && !mainsLeft) {
    for (const p of g.players) if (p.state === 'active') extractPlayer(g, p);
    g.status = 'cleared';
    g.events.push({ type: 'clear', x: g.w * TILE / 2, y: g.h * TILE / 2, points: Math.round(g.score) });
    return;
  }
  if (g.players.every(p => p.state === 'extracted' || p.state === 'out')) {
    g.status = g.players.some(p => p.state === 'extracted') ? 'cleared' : 'failed';
    g.events.push({ type: g.status === 'cleared' ? 'clear' : 'fail', x: g.w * TILE / 2, y: g.h * TILE / 2, points: Math.round(g.score) });
  }
}

// Apply a finished level to the campaign roster.
// Cleared: characters left lying on the field are gone for good; rescues join the roster.
// Failed: no permanent losses -- you retry the level with the roster you walked in with.
export function applyResults(roster, g) {
  // PvP matches never touch the campaign roster, win or lose.
  if (g.mode === 'ctf' || g.mode === 'br') return { roster: roster.slice(), gained: [], lost: [] };
  if (g.status !== 'cleared') return { roster: roster.slice(), gained: [], lost: [] };
  const lost = g.captives.filter(c => c.fromPlayer).map(c => c.charId);
  const gained = g.rescued.filter(id => !roster.includes(id));
  const next = roster.filter(id => !lost.includes(id)).concat(gained.filter(id => !lost.includes(id)));
  return { roster: next, gained, lost };
}

// --- save beacons: whole-sim serialization ----------------------------------
// A JSON-safe deep copy of the live game minus the (shared, static) charMap.
// Everything the sim reads while stepping is plain data, so a JSON round-trip
// restores a byte-identical future: run, serialize, restore, step both — the
// snapshot streams match. Keys holding undefined drop in the copy; every
// reader already treats a missing key and undefined alike.
export function serializeGame(g) {
  const { charMap, ...rest } = g;
  return JSON.parse(JSON.stringify(rest));
}

// Rebuild a steppable game from serializeGame data. The copy keeps the
// caller's stored object pristine (resume twice from one beacon).
export function restoreGame(data, charMap) {
  const g = JSON.parse(JSON.stringify(data));
  g.charMap = charMap;
  // legacy beacons (pre power-up drops) carry none of these fields — backfill the
  // always-present gated defaults so the step/snapshot paths stay branch-free.
  if (!g.powerups) g.powerups = [];
  if (g.nextPowerupId === undefined) g.nextPowerupId = 0;
  if (g.powerupKills === undefined) g.powerupKills = 0;
  if (g.fireSaleT === undefined) g.fireSaleT = 0;
  if (g.freeSprintT === undefined) g.freeSprintT = 0;
  // legacy beacons (pre p.lythseal) parked the seal in the item slot —
  // migrate it to its own field so the restored run can't lose it to loot
  for (const p of g.players || []) {
    if (p.item && p.item.kind === 'lythseal') {
      p.lythseal = true;
      p.item = null;
    }
  }
  return g;
}

// --- snapshot float quantization (WIRE OUTPUT ONLY) ------------------------
// These trim float precision in the EMITTED snapshot object so positions ride
// the wire at integer-px / 1-2 decimals instead of full IEEE-754 strings —
// cutting the JSON payload ~30-40% with no visible motion change (the render
// interpolates anyway). They are deterministic (same input -> same output) so
// serialize/restore stays byte-stable, and they NEVER touch g.* — every call
// site reads a sim value and rounds the COPY placed in the snapshot, so sim
// state (and netcode parity) is untouched. Null/undefined pass through so
// gated optional fields stay absent.
const qi = v => (typeof v === 'number' ? Math.round(v) : v);                 // integer px (x/y)
const q1 = v => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);       // 1 decimal (vx/vy, timers)
const q2 = v => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);     // 2 decimals (fx/fy facing)

// Pass full=false to omit the static tile grid (the server sends the grid once
// at levelStart and lite snapshots every tick; clients re-attach the cached grid).
export function snapshot(g, full = true) {
  return {
    name: g.name,
    objective: g.objective,
    ...(full ? { grid: g.grid } : {}), w: g.w, h: g.h,
    ...(g.dark ? { dark: true } : {}),
    // untimed story: the client clock counts UP on elapsed instead of down
    ...(g.untimed ? { untimed: true, elapsed: q1(g.elapsed) } : {}),
    timeLeft: q1(g.timeLeft),
    status: g.status,
    shards: g.shards,
    // ctf only: per-team pools — the client HUD shows the viewer's team pool
    ...(g.teamShards ? { teamShards: g.teamShards.slice() } : {}),
    gate: g.gate ? { need: g.gate.need, after: g.gate.after, built: g.gate.built, open: g.gate.open, charging: !g.gate.open && g.gate.built >= g.gate.need } : null,
    builds: g.builds.map(b => ({
      x: b.x, y: b.y, kind: b.kind, cost: b.cost, progress: b.progress, paid: b.paid, built: b.built, hp: b.hp, maxHp: b.maxHp,
      ...(b.stage !== undefined ? { stage: b.stage, ...(b.trampled ? { trampled: true } : {}) } : {}),
      ...(b.level !== undefined ? { level: b.level } : {}),
      // turret type carousel: ttype rides once confirmed; the select state
      // ships while open (cursor + remaining auto-confirm seconds) so
      // clients can draw the wheel and its countdown
      ...(b.ttype ? { ttype: b.ttype } : {}),
      ...(b.typeSelect ? { typeSelect: true, tsIdx: b.tsIdx || 0, typeSelectT: Math.max(0, TYPE_SELECT_T - (b.selT || 0)) } : {}),
    })),
    // ground patches and combat followers ship only when populated — classic
    // snapshots never gain the keys
    ...(g.patches.length ? { patches: g.patches.map(pa => ({ x: pa.x, y: pa.y, kind: pa.kind, r: pa.r, ttl: pa.ttl, ...(pa.hostile ? { hostile: true } : {}) })) } : {}),
    // frontier III: field weapon pickups, quest items, quest states — all
    // shipped only when populated so classic snapshots never gain a key
    ...(g.pickups.length ? { pickups: g.pickups.map(w => ({ id: w.id, x: w.x, y: w.y, kind: w.kind, ammo: w.ammo })) } : {}),
    ...(g.qitems.length ? { qitems: g.qitems.map(it => ({ id: it.id, x: it.x, y: it.y, kind: it.kind, carrier: it.carrier })) } : {}),
    ...(g.quests.length ? { quests: g.quests.map(q => ({ id: q.id, state: q.state, progress: q.progress, count: q.count, title: q.title, main: q.main, kind: q.kind })) } : {}),
    ...(g.followers.length ? { followers: g.followers.map(f => ({ id: f.id, kind: f.kind, owner: f.owner, x: qi(f.x), y: qi(f.y), hp: f.hp, fx: q2(f.fx), fy: q2(f.fy), slot: f.slot })) } : {}),
    // STRANDED OPERATORS + SCRAP — shipped only when populated (def.stranded
    // levels only), so every other mode's snapshot stays byte-identical.
    // Recruited operators drop out of the wire (they ride 'followers' now).
    ...(g.stranded.length ? { stranded: g.stranded.filter(o => !o.recruited).map(o => ({ id: o.id, x: qi(o.x), y: qi(o.y), carrier: o.carrier })) } : {}),
    ...(g.scrap.length ? { scrap: g.scrap.map(s => ({ id: s.id, x: qi(s.x), y: qi(s.y), carrier: s.carrier })) } : {}),
    // monolythium puzzle systems — shipped only when populated, so classic
    // snapshots never gain a key
    ...(g.switches.length ? { switches: g.switches.map(s => ({ id: s.id, x: s.x, y: s.y, on: s.on, group: s.group })) } : {}),
    ...(g.switchGroups.length ? { switchGroups: g.switchGroups.map(sg => ({ group: sg.group, need: sg.need, of: sg.of, done: sg.done, ...(sg.windowT > 0 ? { windowT: sg.windowT } : {}) })) } : {}),
    ...(g.glyphs.length ? { glyphs: g.glyphs.map(s => ({ id: s.id, x: s.x, y: s.y, symbol: s.symbol, lit: s.lit, group: s.group })) } : {}),
    ...(g.pillars.length ? { pillars: g.pillars.map(pl => ({ id: pl.id, x: pl.x, y: pl.y, hp: pl.hp, maxHp: pl.maxHp })) } : {}),
    ...(g.forges.length ? { forges: g.forges.map(f => ({ x: f.x, y: f.y, ...(f.holdT > 0 ? { holdT: f.holdT } : {}) })) } : {}),
    ...(g.teleports.length ? { teleports: g.teleports.map(t => ({ id: t.id, x: t.x, y: t.y, twin: t.twin })) } : {}),
    ...(g.doors.length ? { doors: g.doors.map(d => ({ id: d.id, x: d.x, y: d.y, w: d.w, h: d.h, open: d.open, ...(d.sealLock ? { sealLock: true } : {}) })) } : {}),
    crystals: g.crystals.map(c => ({ x: c.x, y: c.y, hp: c.hp })),
    drops: g.drops.map(d => ({ x: d.x, y: d.y, amount: d.amount, ttl: d.ttl })),
    // POWER-UP DROPS + effect timers — shipped only when populated/active so
    // every mode that never drops one keeps a byte-identical snapshot. The
    // render pulses each floater by type; the HUD reads the timers for the
    // Fire Sale / free-sprint banners.
    ...(g.powerups.length ? { powerups: g.powerups.map(pu => ({ id: pu.id, x: qi(pu.x), y: qi(pu.y), type: pu.type, ttl: q1(pu.ttl) })) } : {}),
    ...(g.fireSaleT > 0 ? { fireSaleT: q1(g.fireSaleT) } : {}),
    ...(g.freeSprintT > 0 ? { freeSprintT: q1(g.freeSprintT) } : {}),
    npcs: g.npcs.map(n => ({ id: n.id, name: n.name, x: n.x, y: n.y })),
    // New-mode state ships only when present so classic snapshots never gain
    // a key (downstream reads all use ?? / optional chaining).
    ...(g.mode ? { mode: g.mode } : {}),
    ...(g.core ? { core: { x: g.core.x, y: g.core.y, hp: g.core.hp, maxHp: g.core.maxHp } } : {}),
    // beacon-defense: the four monoliths with HUD-ready lit flags, plus the
    // landed Anchorcraft once the all-lit night feat earns it
    ...(g.cores ? { cores: g.cores.map(c => ({ x: c.x, y: c.y, hp: c.hp, maxHp: c.maxHp, lit: c.lit, ...(c.team != null ? { team: c.team } : {}) })) } : {}),
    // Anchor Siege: minions, lane towers, lane polylines, and core-open flags
    ...(g.siege ? { siege: {
      minions: g.siege.minions.map(m => ({ id: m.id, team: m.team, x: qi(m.x), y: qi(m.y), hp: m.hp, maxHp: m.maxHp })),
      towers: g.siegeTowers.map(t => ({ x: t.x, y: t.y, team: t.team, hp: t.hp, maxHp: t.maxHp, level: t.level, destroyed: t.destroyed })),
      lanes: g.siege.lanes.map(l => l.waypoints.map(w => [w.x, w.y])),
      open: [siegeCoreOpen(g, 0), siegeCoreOpen(g, 1)],
    } } : {}),
    // Difficulty: ships only when NOT the default 'normal', so every
    // default-difficulty snapshot stays byte-identical (the HUD shows the badge
    // only when the player chose Easy or Extreme).
    ...(g.difficulty && g.difficulty !== 'normal' ? { difficulty: g.difficulty } : {}),
    // Family Mode: the bright/cheerful render + the shared-lives HUD read these
    ...(g.family ? { family: true, familyLives: g.familyLives } : {}),
    ...(g.ship ? { ship: { x: g.ship.x, y: g.ship.y, landed: true } } : {}),
    // alive world: weather/ambience for the render FX and audio beds; the
    // toxic-air deadline (live flag included) for the EVA banner
    ...(g.weather ? { weather: g.weather } : {}),
    ...(g.ambience ? { ambience: g.ambience } : {}),
    // Map theme name drives the render palette + ambient FX; shipped only when
    // set, so unthemed levels never gain the key (snapshots stay byte-stable).
    ...(g.theme ? { theme: g.theme } : {}),
    ...(g.toxicAir ? { toxicAir: { until: g.toxicAir.until, active: g.elapsed < g.toxicAir.until } } : {}),
    // extended stalls (mask stock) ship their offer list; the standard five
    // stay implicit so classic snapshots never gain the key
    ...(g.shopOffers && g.shopOffers.length !== SHOP_OFFERS.length
      ? { shopOffers: g.shopOffers.map(o => ({ ...o })) } : {}),
    // nextBloodMoon flags the DAY before a blood-moon dusk (gated: the key
    // only appears when true, so classic-bastion snapshots stay byte-stable)
    // — the client's wave countdown reads it for the day-before red styling.
    ...(g.cycle ? { cycle: { phase: g.cycle.phase, nightNo: g.cycle.nightNo, t: g.cycle.t, bloodMoon: g.cycle.bloodMoon, nights: g.bastion.nights,
      ...(g.bastion.endless ? { endless: true } : {}),
      ...(g.cycle.phase === 'day' && (g.bastion.endless
        ? ((g.cycle.nightNo + 1) % (g.bastion.bloodEvery || 3) === 0)
        : g.bastion.bloodMoons.includes(g.cycle.nightNo + 1)) ? { nextBloodMoon: true } : {}) } } : {}),
    ...(g.chests.length ? { chests: g.chests.map(c => ({ x: c.x, y: c.y, opened: c.opened, loot: c.loot })) } : {}),
    ...(g.crackers.length ? { crackers: g.crackers.map(c => ({ x: c.x, y: c.y, landed: c.landed, fuse: c.fuse })) } : {}),
    ...(g.vehicles.length ? { vehicles: g.vehicles.map(v => ({ id: v.id, x: qi(v.x), y: qi(v.y), kind: v.kind, rider: v.rider })) } : {}),
    ...(g.towers.length ? { towers: g.towers.map(t => ({ x: t.x, y: t.y, level: t.level, hp: t.hp, maxHp: t.maxHp, occupant: t.occupant, ...(t.hp <= 0 ? { progress: t.progress || 0 } : {}) })) } : {}),
    ...(g.shops.length ? { shops: g.shops.map(s => ({ x: s.x, y: s.y })) } : {}),
    ...(g.hires.length ? { hires: g.hires.map(h => ({ x: h.x, y: h.y, cost: h.cost, job: h.job, hired: h.hired, name: h.name })) } : {}),
    ...(g.flags.length ? { flags: g.flags.map(f => ({ team: f.team, x: qi(f.x), y: qi(f.y), homeX: qi(f.homeX), homeY: qi(f.homeY), carrier: f.carrier, atBase: f.atBase, dropT: q1(f.dropT) })) } : {}),
    ...(g.caps ? { caps: g.caps.slice() } : {}),
    // ctf overtime: present from the sudden-death horn on (and only then —
    // regulation/classic snapshots never gain the key) so the HUD can read
    // "OVERTIME +n": n is the escalation level, 0 at the horn, capped at 5.
    ...(g.suddenDeath ? { overtime: ctfOvertimeLevel(g) } : {}),
    ...(g.zone ? { zone: { x: g.zone.x, y: g.zone.y, r: g.zone.r, targetR: g.zone.targetR, shrinkT: g.zone.shrinkT } } : {}),
    ...(g.winner !== undefined ? { winner: g.winner } : {}),
    players: g.players.map(p => ({
      pid: p.pid, name: p.name, charId: p.charId, x: qi(p.x), y: qi(p.y), fx: q2(p.fx), fy: q2(p.fy),
      state: p.state, invuln: q1(p.invuln), specialCool: q1(p.specialCool),
      ...(p.maxHp !== undefined ? { hp: p.hp, maxHp: p.maxHp, shield: p.shield } : {}),
      // sprint meter: shipped only once the seat has sprinted (gated), so seats
      // that never sprint — and every mode that never uses it — stay byte-stable
      ...(p.stamina !== undefined ? { stamina: q1(p.stamina), staminaMax: p.staminaMax } : {}),
      ...(p.item ? { item: { kind: p.item.kind, count: p.item.count } } : {}),
      ...(p.team !== undefined ? { team: p.team } : {}),
      ...(p.riding ? { riding: p.riding } : {}),
      ...(p.towerId != null ? { towerId: p.towerId } : {}),
      ...(p.shopping ? { shop: { idx: p.shopIdx || 0 } } : {}),
      ...(p.selecting ? { selecting: true } : {}),
      // inventory + placement (RA2 buy-then-place): both ship only when present,
      // so seats that never bought a placeable keep byte-stable snapshots. The
      // placing seat ships its tile-snapped ghost (and any wall-drag anchor) so
      // every client draws the same ghost/line preview.
      ...(p.inventory ? { inventory: p.inventory.map(s => ({ kind: s.kind, count: s.count })), invIdx: p.invIdx || 0 } : {}),
      ...(p.placing ? {
        placing: p.placing, ghostX: qi(p.ghostX), ghostY: qi(p.ghostY),
        ...(p.wallAnchorX !== undefined ? { wallAnchorX: qi(p.wallAnchorX), wallAnchorY: qi(p.wallAnchorY) } : {}),
      } : {}),
      ...(p.dmgBonus ? { dmgBonus: p.dmgBonus } : {}),
      ...(p.fieldWeapon ? { fieldWeapon: { kind: p.fieldWeapon.kind, ammo: p.fieldWeapon.ammo } } : {}),
      ...(p.stunT > 0 ? { stunT: q1(p.stunT) } : {}),
      // lythseal carrier (own field, never the item slot): opens sealLock
      // doors on touch; the renderer drops Classical Phantom transparency
      // within 6 tiles of this seat and rings the bearer in checkpoint gold
      ...(p.lythseal ? { hasSeal: true, lythseal: true } : {}),
      ...(p.channelT > 0 ? { channelT: q1(p.channelT) } : {}),
      // frontier IV: worn breather mask; aboard the landed Anchorcraft
      ...(p.mask ? { mask: true } : {}),
      ...(p.aboard ? { aboard: true } : {}),
      // on-the-spot leveling (non-arcade seats only; arcade never gains keys)
      ...(p.level !== undefined ? { xp: p.xp, level: p.level } : {}),
      ...(p.state === 'pick' ? { pick: { idx: p.pickIdx, choices: freeChars(g) } } : {}),
    })),
    enemies: g.enemies.map(e => ({
      id: e.id,
      kind: e.kind,
      x: qi(e.x),
      y: qi(e.y),
      hp: e.hp,
      maxHp: e.maxHp,
      fx: q2(e.fx),
      fy: q2(e.fy),
      hurt: q1(e.hurt),
      state: e.state,
      aimT: q1(e.aimT),
      aimX: qi(e.aimX),
      aimY: qi(e.aimY),
      awake: e.awake,
      returning: e.returning,
      ...(e.mutation ? { mutation: e.mutation } : {}),
      ...(e.shielded ? { shielded: true } : {}), // acolyte ward, one absorb
      // status clocks ship as short floats only while live (lite by default)
      ...(e.stunT > 0 ? { stunT: q1(e.stunT) } : {}),
      ...(e.burnT > 0 ? { burnT: q1(e.burnT) } : {}),
      ...(e.toxT > 0 ? { toxT: q1(e.toxT) } : {}),
      ...(e.convertedT > 0 ? { convertedT: q1(e.convertedT) } : {}),
    })),
    captives: g.captives.map(c => ({ charId: c.charId, x: qi(c.x), y: qi(c.y), owner: c.owner, fromPlayer: c.fromPlayer })),
    // ENEMY STRONGHOLDS: shipped only when the map seeded one (gated, so every
    // other mode's snapshot is byte-stable). The renderer pings each keep on the
    // minimap and ring-draws its wall radius; the superweapon phase reads x/y as
    // its natural target. `cleared` is computed live from garrison liveness:
    // true once every stationed enemy is dead, so the HUD can mark a fallen keep.
    ...(g.strongholds && g.strongholds.length ? {
      strongholds: g.strongholds.map(sh => ({
        id: sh.id, x: sh.x, y: sh.y, r: sh.r, aggro: sh.aggro, leash: sh.leash,
        cleared: sh.garrison.every(id => {
          const e = g.enemies.find(en => en.id === id);
          return !e || e.dead;
        }),
      })),
    } : {}),
    // Music Box easter egg: shipped only when enabled (story/stronghold), so
    // every other mode's snapshot is byte-stable. The client reads mode+stem
    // to load the level's track, fragments/altar to draw + ping, assembled +
    // complete to drive the objective HUD and the celebratory banner.
    ...(g.musicBox && g.musicBox.enabled ? {
      musicBox: {
        mode: g.musicBox.mode, stem: g.musicBox.stem,
        altar: { x: g.musicBox.altar.x, y: g.musicBox.altar.y },
        fragments: g.musicBox.fragments.map(f => ({ id: f.id, x: f.x, y: f.y, carrier: f.carrier, placed: f.placed })),
        assembled: g.musicBox.assembled, complete: g.musicBox.complete,
        // stronghold ships the four corner mounts; story omits the key entirely
        ...(g.musicBox.mounts ? { mounts: g.musicBox.mounts.map(m => ({ x: m.x, y: m.y, filled: m.filled })) } : {}),
      },
    } : {}),
    // RELIC AWAKENING: ships ONLY while the event has latched (gated, so every
    // other snapshot is byte-stable). active=false the instant the event ends so
    // the client can swap the survived/failed banner in. remaining + the live
    // bonus drive the HUD readout; the client never recomputes the math.
    ...(g.horde ? {
      horde: {
        active: !g.horde.ended,
        remaining: Math.max(0, g.horde.dur - (g.elapsed - g.horde.startedAt)),
        dur: g.horde.dur,
        hits: g.horde.hits,
        deaths: g.horde.deaths,
        bonus: Math.max(HORDE_FLOOR_BONUS, HORDE_BASE_BONUS - g.horde.hits * HORDE_HIT_PENALTY - g.horde.deaths * HORDE_DEATH_PENALTY),
        ...(g.horde.result ? { result: g.horde.result } : {}),
      },
    } : {}),
    // RELIC SUPERWEAPON: the unlock flag rides only once earned, the device only
    // once built, and the hazard fields only while one is live — every untouched
    // mode's snapshot stays byte-stable (no key appears). The client draws the
    // device (building/charging countdown/ready), the targeting reticle, and the
    // nuke/storm/radiation FX off these. chargeT/buildT are quantized for the HUD.
    ...(g.superweaponUnlocked ? { superweaponUnlocked: true } : {}),
    ...(g.superweapon ? {
      superweapon: {
        type: g.superweapon.type, state: g.superweapon.state,
        x: qi(g.superweapon.x), y: qi(g.superweapon.y),
        hp: g.superweapon.hp, maxHp: g.superweapon.maxHp, ownerPid: g.superweapon.ownerPid,
        ...(g.superweapon.state === 'building' ? { buildT: q1(g.superweapon.buildT), buildTime: SUPER_BUILD_TIME } : {}),
        ...(g.superweapon.state === 'charging' ? { chargeT: q1(g.superweapon.chargeT), chargeMax: SUPER_CHARGE_SECONDS } : {}),
        ...(g.superweapon.targetX !== undefined ? { targetX: qi(g.superweapon.targetX), targetY: qi(g.superweapon.targetY) } : {}),
      },
    } : {}),
    ...(g.hazards.length ? {
      hazards: g.hazards.map(hz => ({ kind: hz.kind, x: qi(hz.x), y: qi(hz.y), radius: hz.radius, ttl: q1(hz.ttl), ...(hz.warnT > 0 ? { warnT: q1(hz.warnT) } : {}) })),
    } : {}),
    // ownerPid lets the renderer dress player shots in their seat's evolution.
    // id rides so the render-side interpolator can match a shot frame-to-frame
    // (sim shots already carry a unique id; it was simply not emitted before).
    shots: g.shots.map(s => ({ id: s.id, x: qi(s.x), y: qi(s.y), vx: q1(s.vx), vy: q1(s.vy), who: s.who, kind: s.kind, ...(s.ownerPid !== undefined ? { ownerPid: s.ownerPid } : {}) })),
    rescued: g.rescued,
    score: Math.round(g.score),
    kills: g.kills,
    combo: g.combo,
    events: g.events.splice(0),
  };
}
