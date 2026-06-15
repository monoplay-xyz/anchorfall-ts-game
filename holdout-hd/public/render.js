// HD renderer — "Monolythium: Anchorfall" night grade.
// Procedural vector/baked art with drop-in PNG overrides: any texture key in
// BAKERS is first looked up as /assets/<key>.png (v2 keys, so the legacy
// placeholder PNGs no longer apply); if missing, a procedural canvas is baked.
// The world reads as cold moonlit frontier; warm LYTH light = safety/value.
import { TILE } from '/shared/game.js';
import { playEvent, setScene } from './audio.js'; // render-detected cues + ambience scene feed

const particles = [];
const flashes = [];
const popups = [];
const rings = [];
const edgePulses = []; // nightwave warnings: violet bleed from a map edge
const crackers = []; // landed lure crackers: 'crackerOut' -> 'crackerBoom'/timeout
const beams = []; // prism tower shots: 'prismBeam' {x,y,tx,ty,dmg,feeders?}
const zaps = []; // tesla chain lightning: 'teslaZap' {x,y,targets:[{x,y}]}
const streaks = []; // blink lines: teleports + phase stalkers {x,y,tx,ty,rgb}
const pendingLevelUps = []; // coordless 'levelUp' events resolved to player pos
const houndMood = new Map(); // follower id -> {engaged,lastBark}: bark on engage edge
let coreAlarmT = 0; // base-core alarm glow, armed by 'coreHit'/'coreDown'
let lightningT = 0; // RELIC AWAKENING white screen-flash (thunder crack), 0..1
let shake = 0;
let punch = 0; // camera zoom-kick on heavy impacts (render-only, networked-safe)
let darkWorld = false; // set per-frame from snap.dark (story night missions)
let familyMode = false; // set per-frame from snap.family: bright child-friendly storybook grade
const tex = {};
const imageCache = {};

// --- Anchorfall palette (see art bible) ---
const PAL = {
  voidNight: '#0B0A14',
  entBlack: '#14091F',
  entViolet: '#5A2E8C',
  glitch: '#8E4FD1',
  eye: '#BFFBFF',
  graphDark: '#1E2028',
  graphPlate: '#2E3140',
  graphMid: '#353A4C',
  steel: '#5E6880',
  moonsteel: '#8A98B8',
  coldHi: '#BFD0E8',
  haze: '#5E6B8C',
  anchor: '#DFF3FF',
  relay: '#6FD8F2',
  pylonBlue: '#3E8FE0',
  lythPale: '#FFEFC2',
  lythGold: '#FFD98A',
  lythAmber: '#F0A93C',
  ember: '#C75B22',
  red: '#E04848',
  blood: '#7A2230',
  teal: '#36A08A',
  dteal: '#174A4A',
};

// --- Family Mode palette: a sunny storybook day (only used when snap.family).
// Soft sky-blue/warm sky fill, a gentle warm sun wash that lights the baked
// grass/sand/water/tree textures brightly, and cheerful flower bloom colors.
const FAM = {
  sky: '#BFE3FF',          // soft daylight sky fill (replaces voidNight)
  sunWash: '255,244,214',  // warm additive sunlight over the world
  skyLift: '210,236,255',  // cool ambient skylight lift
  vignette: '255,236,190', // very light warm sun vignette (not a dark one)
  flowers: ['#FF9EC4', '#FFE08A', '#FFFFFF', '#C9A6F0'], // pink, yellow, white, lavender
  flowerCore: '#FFD46A',   // golden bloom center
  monPastel: '#FFE3F0',    // pastel tint mixed into family monsters
  monBlush: '#FFC2DA',     // soft cheek/round-edge blush
  monEye: '#3A4A6B',       // friendly dark-but-soft eye
};

// --- Map THEME palette (parallel to FAM): keyed by snap.theme. Re-skins the
// whole frame so a level reads as lava / toxic / nuclear / storm / fire / ice.
//   skyFill    : replaces the void-night backdrop fill
//   washRgb    : additive grade over the world ('r,g,b' + alpha applied below)
//   vignetteRgb: themed edge vignette tint
//   ambient    : particle kind for drawHazardAmbient (ember|fallout|fog|snow|
//                rain) — null reuses only the weather layer
// Everything reads through optional lookups so unthemed levels are untouched.
const THEME_PAL = {
  lava:    { skyFill: '#1A0A06', washRgb: '255,96,28',  vignetteRgb: '120,28,8',  ambient: 'ember' },
  fire:    { skyFill: '#1C0C05', washRgb: '255,120,40', vignetteRgb: '130,40,10', ambient: 'ember' },
  toxic:   { skyFill: '#0A140A', washRgb: '120,220,90', vignetteRgb: '24,70,20',  ambient: 'fog' },
  nuclear: { skyFill: '#101404', washRgb: '180,230,70', vignetteRgb: '60,72,12',  ambient: 'fallout' },
  storm:   { skyFill: '#0A0C16', washRgb: '90,120,200', vignetteRgb: '14,18,40',  ambient: 'rain' },
  ice:     { skyFill: '#0E1622', washRgb: '170,210,255', vignetteRgb: '40,70,110', ambient: 'snow' },
};
function themePal(snap) {
  return (snap && typeof snap.theme === 'string') ? (THEME_PAL[snap.theme] || null) : null;
}

// Anchor Siege (MOBA) team palette — team 0 = blue/cyan, team 1 = red/orange.
const SIEGE_TEAM = ['#4f91ff', '#ff6a5a'];
const SIEGE_TEAM_DIM = ['#2a4e8c', '#8c3a32']; // muted body fill / shadow facet
function siegeTeamCol(team) { return SIEGE_TEAM[(team | 0) % 2]; }
function siegeTeamDim(team) { return SIEGE_TEAM_DIM[(team | 0) % 2]; }

// deterministic RNG so baked textures are stable between loads
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bake(w, h, fn, seed = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  fn(c.getContext('2d'), mulberry32(seed));
  return c;
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

function mix(hexA, hexB, t) {
  const a = parseInt(hexA.slice(1), 16), b = parseInt(hexB.slice(1), 16);
  const r = Math.round((a >> 16) + (((b >> 16) & 255) - (a >> 16)) * t);
  const g = Math.round(((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const bl = Math.round((a & 255) + ((b & 255) - (a & 255)) * t);
  return `rgb(${r},${g},${bl})`;
}

function fract(v) { return v - Math.floor(v); }
function flick(n) { return fract(Math.sin(n * 127.1) * 43758.5453); }

// ============================== TILE BAKERS ==============================
// One baker per floor letter; each variant seeded so maps look hand-mottled.

// '.' MEADOW — cool moonlit grass, the only green-leaning ground.
function bakeMeadow(seed) {
  return bake(TILE, TILE, (ctx, rnd) => {
    ctx.fillStyle = '#26323F';
    ctx.fillRect(0, 0, TILE, TILE);
    ctx.fillStyle = 'rgba(22,30,38,0.4)';
    ctx.beginPath();
    ctx.ellipse(rnd() * TILE, rnd() * TILE, 11 + rnd() * 14, 8 + rnd() * 10, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
    const blades = 60 + Math.floor(rnd() * 30);
    for (let i = 0; i < blades; i++) {
      ctx.fillStyle = rnd() < 0.5 ? '#324A40' : '#3D5A4A';
      ctx.fillRect(rnd() * TILE, rnd() * TILE, 1, 2);
    }
    const hi = 6 + Math.floor(rnd() * 4);
    for (let i = 0; i < hi; i++) {
      // moonlit blade highlights biased to the upper-left of clumps
      const x = rnd() * TILE, y = rnd() * TILE;
      ctx.fillStyle = '#6E8F7E';
      ctx.fillRect(x - 1, y - 1, 1, 2);
    }
    if (rnd() < 1 / 6) {
      ctx.fillStyle = '#A9C4CE';
      ctx.fillRect(2 + rnd() * (TILE - 4), 2 + rnd() * (TILE - 4), 2, 2);
    }
  }, seed);
}

// ',' FOREST FLOOR — darker, warmer leaf litter under canopy shade.
function bakeForest(seed) {
  return bake(TILE, TILE, (ctx, rnd) => {
    ctx.fillStyle = '#221C22';
    ctx.fillRect(0, 0, TILE, TILE);
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = rnd() < 0.5 ? '#33282C' : '#3A3026';
      ctx.beginPath();
      ctx.ellipse(rnd() * TILE, rnd() * TILE, 2 + rnd() * 3, 1.5 + rnd() * 2, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#2C3A2C';
    ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      const x = rnd() * TILE, y = rnd() * TILE, a = rnd() * Math.PI;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * 5, y + Math.sin(a) * 5);
      ctx.stroke();
    }
    const flecks = 4 + Math.floor(rnd() * 3);
    for (let i = 0; i < flecks; i++) {
      ctx.fillStyle = '#5A6A55';
      ctx.fillRect(rnd() * TILE, rnd() * TILE, 1.5, 1.5);
    }
  }, seed);
}

// ':' SWAMP MUD — wet olive-brown ground; cold sheen on warm mud = slow.
function bakeSwamp(seed) {
  return bake(TILE, TILE, (ctx, rnd) => {
    ctx.fillStyle = '#2A2820';
    ctx.fillRect(0, 0, TILE, TILE);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = '#36331F';
      ctx.beginPath();
      ctx.ellipse(rnd() * TILE, rnd() * TILE, 8 + rnd() * 11, 6 + rnd() * 8, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 2; i++) {
      const x = rnd() * TILE, y = rnd() * TILE;
      ctx.fillStyle = '#1F1D14';
      ctx.beginPath();
      ctx.ellipse(x, y, 4 + rnd() * 6, 3 + rnd() * 4, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
      // sickly algae specks around the sink-hole rim
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = '#4E5A30';
        const a = rnd() * Math.PI * 2;
        ctx.fillRect(x + Math.cos(a) * (6 + rnd() * 4), y + Math.sin(a) * (4 + rnd() * 3), 1.5, 1.5);
      }
    }
    // wet sheen reflecting cold moonlight
    ctx.fillStyle = 'rgba(74,85,102,0.35)';
    const streaks = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < streaks; i++) {
      ctx.fillRect(rnd() * (TILE - 20), rnd() * TILE, 12 + rnd() * 16, 2);
    }
  }, seed);
}

// ';' WORKED STONE — operator-cut flagstone; man-made and orderly.
function bakeStone(seed) {
  return bake(TILE, TILE, (ctx, rnd) => {
    const gx = 18 + Math.floor(rnd() * 12);
    const gy = 18 + Math.floor(rnd() * 12);
    const slabs = [[0, 0, gx, gy], [gx, 0, TILE - gx, gy], [0, gy, gx, TILE - gy], [gx, gy, TILE - gx, TILE - gy]];
    for (const [sx, sy, sw, sh] of slabs) {
      ctx.fillStyle = mix('#2E3140', '#353A4C', rnd());
      ctx.fillRect(sx, sy, sw, sh);
    }
    ctx.strokeStyle = '#1E2028';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(gx, 0); ctx.lineTo(gx, TILE);
    ctx.moveTo(0, gy); ctx.lineTo(TILE, gy);
    ctx.stroke();
    ctx.strokeRect(0.5, 0.5, TILE - 1, TILE - 1);
    // chipped slab corners
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = '#5E6880';
      ctx.fillRect(rnd() * TILE, rnd() * TILE, 1 + rnd(), 1 + rnd());
    }
    if (rnd() < 0.25) {
      // moon glint along a slab's top edge
      ctx.strokeStyle = 'rgba(138,152,184,0.8)';
      ctx.lineWidth = 1;
      const ex = rnd() < 0.5 ? 2 : gx + 2;
      const ey = rnd() < 0.5 ? 1.5 : gy + 1.5;
      ctx.beginPath();
      ctx.moveTo(ex, ey); ctx.lineTo(ex + 8 + rnd() * 6, ey);
      ctx.stroke();
    }
  }, seed);
}

// '_' SCORCHED ASH — Entropy-burned dead ground; darkest walkable tile.
function bakeAsh(seed) {
  return bake(TILE, TILE, (ctx, rnd) => {
    ctx.fillStyle = '#17141A';
    ctx.fillRect(0, 0, TILE, TILE);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = '#221F26';
      ctx.beginPath();
      ctx.ellipse(rnd() * TILE, rnd() * TILE, 5 + rnd() * 9, 4 + rnd() * 6, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const flecks = 8 + Math.floor(rnd() * 5);
    for (let i = 0; i < flecks; i++) {
      ctx.fillStyle = '#4A4650';
      ctx.fillRect(rnd() * TILE, rnd() * TILE, 1, 1);
    }
    if (rnd() < 1 / 8) {
      // dying ember — rare warm life
      const x = rnd() * TILE, y = rnd() * TILE;
      ctx.fillStyle = '#8C3A22';
      ctx.fillRect(x, y, 2, 2);
      if (rnd() < 0.35) { ctx.fillStyle = '#E07B39'; ctx.fillRect(x, y, 1, 1); }
    }
    if (rnd() < 1 / 10) {
      // hairline crack glowing faint Entropy Violet
      ctx.strokeStyle = 'rgba(58,35,71,0.9)';
      ctx.lineWidth = 1;
      let x = rnd() * TILE, y = rnd() * TILE;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 3; k++) {
        x += (rnd() - 0.5) * 14; y += 4 + rnd() * 6;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, seed);
}

// '~' WATER — deep cold blue-black, the strongest moonlight stage.
function bakeWater(seed) {
  return bake(TILE, TILE, (ctx, rnd) => {
    ctx.fillStyle = '#101A2E';
    ctx.fillRect(0, 0, TILE, TILE);
    for (let i = 0; i < 2; i++) {
      ctx.fillStyle = '#0C1322';
      ctx.beginPath();
      ctx.ellipse(rnd() * TILE, rnd() * TILE, 9 + rnd() * 11, 6 + rnd() * 8, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#2C4A6E';
    ctx.lineWidth = 1;
    const ripples = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < ripples; i++) {
      const x = rnd() * (TILE - 22), y = rnd() * TILE;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + 10 + rnd() * 12, y);
      ctx.stroke();
    }
    if (rnd() < 0.2) {
      ctx.fillStyle = '#BFD0E8';
      ctx.fillRect(rnd() * TILE, rnd() * TILE, 1.5, 1.5);
    }
  }, seed);
}

// '#' ROCK WALL top face — raised blocking graphite rock.
function bakeRock(seed) {
  return bake(TILE, TILE, (ctx, rnd) => {
    ctx.fillStyle = '#3A3F4E';
    ctx.fillRect(0, 0, TILE, TILE);
    // angular facets
    const facets = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < facets; i++) {
      const x = rnd() * TILE, y = rnd() * TILE;
      ctx.fillStyle = 'rgba(38,42,54,0.85)';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 8 + rnd() * 16, y + (rnd() - 0.5) * 10);
      ctx.lineTo(x + (rnd() - 0.5) * 12, y + 8 + rnd() * 14);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = '#14161E';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      let x = rnd() * TILE, y = rnd() * TILE;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 2; k++) {
        x += (rnd() - 0.5) * 20; y += (rnd() - 0.5) * 20;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    if (rnd() < 0.2) {
      // latent LYTH-adjacent mineral vein
      ctx.strokeStyle = '#4A3A66';
      ctx.lineWidth = 1.5;
      let x = rnd() * TILE, y = TILE;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 3; k++) {
        x += (rnd() - 0.5) * 10; y -= 8 + rnd() * 8;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // Moonsteel bevel along top/upper-left
    ctx.fillStyle = 'rgba(110,122,148,0.9)';
    ctx.fillRect(0, 0, TILE, 2.5);
    ctx.fillStyle = 'rgba(110,122,148,0.55)';
    ctx.fillRect(0, 0, 2, TILE);
    ctx.fillStyle = 'rgba(11,10,20,0.5)';
    ctx.fillRect(0, TILE - 2, TILE, 2);
  }, seed);
}

// 'T' TREE — canopy discs over forest floor, baked 64x64 with contact shadow.
function bakeTree(seed) {
  const S = 64;
  return bake(S, S, (ctx, rnd) => {
    ctx.clearRect(0, 0, S, S);
    // soft radial contact shadow sells the top-down depth
    const sg = ctx.createRadialGradient(34, 46, 2, 34, 46, 16);
    sg.addColorStop(0, 'rgba(17,21,15,0.4)');
    sg.addColorStop(1, 'rgba(17,21,15,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(18, 32, 32, 28);
    const discs = 3 + Math.floor(rnd() * 2);
    const lyth = rnd() < 1 / 12;
    for (let i = 0; i < discs; i++) {
      const cx = 30 + (rnd() - 0.5) * 15 - i * 1.5;
      const cy = 27 + (rnd() - 0.5) * 13 - i * 1.5;
      const r = 11 + rnd() * 7;
      ctx.fillStyle = discs > 1 ? mix('#1B2A22', '#25402F', i / (discs - 1)) : '#1B2A22';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      // crescent moonlit rim on the upper-left edge
      ctx.strokeStyle = 'rgba(78,122,90,0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r - 1.5, Math.PI * 0.95, Math.PI * 1.62);
      ctx.stroke();
    }
    if (lyth) {
      ctx.fillStyle = '#F0A93C';
      for (let i = 0; i < 4; i++) ctx.fillRect(22 + rnd() * 16, 18 + rnd() * 16, 2, 2);
    }
  }, seed);
}

// 'o' SANDBAGS — warm khaki defenses against the cold night.
function bakeSandbags(seed) {
  return bake(TILE, TILE, (ctx, rnd) => {
    ctx.clearRect(0, 0, TILE, TILE);
    ctx.fillStyle = 'rgba(21,19,26,0.6)';
    ctx.beginPath();
    ctx.ellipse(TILE / 2, TILE - 8, 21, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    const bag = (x, y, w, h) => {
      ctx.fillStyle = shade('#4A4232', Math.floor((rnd() - 0.4) * 14));
      ctx.beginPath();
      ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#332E20';
      ctx.lineWidth = 1;
      ctx.stroke();
      // seam stitches
      ctx.strokeStyle = '#5E5640';
      ctx.beginPath();
      ctx.moveTo(x - w * 0.6, y); ctx.lineTo(x + w * 0.6, y);
      ctx.stroke();
      // moonlit top crescent
      ctx.strokeStyle = 'rgba(110,103,80,0.9)';
      ctx.beginPath();
      ctx.ellipse(x - 1, y - h * 0.4, w * 0.55, h * 0.3, 0, Math.PI, 0);
      ctx.stroke();
    };
    bag(12, 37, 11, 6.5); bag(35, 37, 11, 6.5); bag(24, 36, 11, 6.5);
    bag(17, 27, 11, 6.5); bag(31, 27, 11, 6.5);
    bag(24, 17, 11, 6.5);
  }, seed);
}

// '*' CAMPFIRE stones + scorch (the flame itself is drawn live each frame).
function bakeFirebase(seed) {
  return bake(TILE, TILE, (ctx, rnd) => {
    ctx.clearRect(0, 0, TILE, TILE);
    ctx.fillStyle = '#17141A';
    ctx.beginPath();
    ctx.ellipse(24, 26, 15, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rnd() * 0.4;
      const x = 24 + Math.cos(a) * 13, y = 26 + Math.sin(a) * 9.5;
      ctx.fillStyle = '#262A36';
      ctx.beginPath();
      ctx.ellipse(x + 0.7, y + 0.9, 3.4, 2.6, a, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3A3F4E';
      ctx.beginPath();
      ctx.ellipse(x, y, 3.2, 2.4, a, 0, Math.PI * 2);
      ctx.fill();
    }
    // a couple of charred sticks
    ctx.strokeStyle = '#221F26';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(18, 30); ctx.lineTo(31, 23);
    ctx.moveTo(19, 22); ctx.lineTo(30, 30);
    ctx.stroke();
  }, seed);
}

// '=' SAND — pale moonlit dunes; the lightest ground in the frontier.
function bakeSand(seed) {
  return bake(TILE, TILE, (ctx, rnd) => {
    ctx.fillStyle = '#5E563E';
    ctx.fillRect(0, 0, TILE, TILE);
    // dune ripple shadows: long shallow arcs
    ctx.strokeStyle = 'rgba(58,50,34,0.7)';
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 4; i++) {
      const ry = 5 + rnd() * (TILE - 10);
      ctx.beginPath();
      ctx.moveTo(-2, ry);
      ctx.quadraticCurveTo(TILE / 2, ry + (rnd() - 0.5) * 9, TILE + 2, ry + (rnd() - 0.5) * 5);
      ctx.stroke();
    }
    // moonlit crest highlights just above the ripples
    ctx.strokeStyle = 'rgba(168,156,120,0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 2; i++) {
      const ry = 6 + rnd() * (TILE - 12);
      ctx.beginPath();
      ctx.moveTo(2 + rnd() * 8, ry);
      ctx.quadraticCurveTo(TILE / 2, ry - 2 - rnd() * 3, TILE - 2 - rnd() * 8, ry);
      ctx.stroke();
    }
    // grain speckle
    const grains = 26 + Math.floor(rnd() * 14);
    for (let i = 0; i < grains; i++) {
      ctx.fillStyle = rnd() < 0.5 ? '#6B6248' : '#4E4834';
      ctx.fillRect(rnd() * TILE, rnd() * TILE, 1, 1);
    }
    if (rnd() < 0.2) { // a half-buried pale stone
      ctx.fillStyle = '#8C8266';
      ctx.beginPath();
      ctx.ellipse(4 + rnd() * (TILE - 8), 4 + rnd() * (TILE - 8), 2.4, 1.6, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, seed);
}

// '!' LAVA — black crust riven by molten channels (glow/shimmer animate live).
function bakeLava(seed) {
  return bake(TILE, TILE, (ctx, rnd) => {
    ctx.fillStyle = '#1E0D07';
    ctx.fillRect(0, 0, TILE, TILE);
    // crust plates
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = rnd() < 0.5 ? '#2A1209' : '#240F08';
      ctx.beginPath();
      ctx.ellipse(rnd() * TILE, rnd() * TILE, 7 + rnd() * 9, 5 + rnd() * 7, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // molten cracks: hot random-walk channels with a soft glow
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      let cx2 = rnd() * TILE, cy2 = rnd() * TILE;
      ctx.strokeStyle = i === 0 ? '#FFC04A' : '#FF7A2A';
      ctx.shadowColor = '#FF7A2A';
      ctx.shadowBlur = 5;
      ctx.lineWidth = i === 0 ? 2.2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(cx2, cy2);
      for (let k2 = 0; k2 < 4; k2++) {
        cx2 += (rnd() - 0.5) * 22; cy2 += (rnd() - 0.5) * 22;
        ctx.lineTo(cx2, cy2);
      }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    // ember pinpricks on the crust
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = rnd() < 0.5 ? '#E05A1E' : '#FFB03A';
      ctx.fillRect(rnd() * TILE, rnd() * TILE, 1.4, 1.4);
    }
  }, seed);
}

// '^' ICE — glacial sheen, pressure cracks and old skid lines.
function bakeIce(seed) {
  return bake(TILE, TILE, (ctx, rnd) => {
    ctx.fillStyle = '#27384C';
    ctx.fillRect(0, 0, TILE, TILE);
    // sheen patches
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(61,90,116,0.8)' : 'rgba(47,70,94,0.8)';
      ctx.beginPath();
      ctx.ellipse(rnd() * TILE, rnd() * TILE, 9 + rnd() * 11, 6 + rnd() * 8, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // hairline pressure cracks
    ctx.strokeStyle = 'rgba(191,251,255,0.30)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 2; i++) {
      let cx2 = rnd() * TILE, cy2 = rnd() * TILE;
      ctx.beginPath();
      ctx.moveTo(cx2, cy2);
      for (let k2 = 0; k2 < 3; k2++) {
        cx2 += (rnd() - 0.5) * 26; cy2 += (rnd() - 0.5) * 26;
        ctx.lineTo(cx2, cy2);
      }
      ctx.stroke();
    }
    // skid lines: two close parallel scratches with a slight curve
    if (rnd() < 0.75) {
      const sx0 = rnd() * TILE, sy0 = rnd() * TILE, a = rnd() * Math.PI;
      const dx2 = Math.cos(a), dy2 = Math.sin(a);
      ctx.strokeStyle = 'rgba(223,243,255,0.18)';
      ctx.lineWidth = 1.2;
      for (const off of [0, 3]) {
        ctx.beginPath();
        ctx.moveTo(sx0 - dy2 * off, sy0 + dx2 * off);
        ctx.quadraticCurveTo(
          sx0 + dx2 * 11 - dy2 * (off + 2.5), sy0 + dy2 * 11 + dx2 * (off + 2.5),
          sx0 + dx2 * 22 - dy2 * off, sy0 + dy2 * 22 + dx2 * off);
        ctx.stroke();
      }
    }
    // cold sparkle
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = '#BFD0E8';
      ctx.fillRect(rnd() * TILE, rnd() * TILE, 1, 1);
    }
    // top-left moon glint
    ctx.fillStyle = 'rgba(223,243,255,0.10)';
    ctx.beginPath();
    ctx.ellipse(10 + rnd() * 6, 9 + rnd() * 5, 8, 4.5, -0.5, 0, Math.PI * 2);
    ctx.fill();
  }, seed);
}

const BAKERS = {
  meadow0: () => bakeMeadow(301), meadow1: () => bakeMeadow(302), meadow2: () => bakeMeadow(303),
  meadow3: () => bakeMeadow(304), meadow4: () => bakeMeadow(305), meadow5: () => bakeMeadow(306),
  forest0: () => bakeForest(311), forest1: () => bakeForest(312), forest2: () => bakeForest(313), forest3: () => bakeForest(314),
  swamp0: () => bakeSwamp(321), swamp1: () => bakeSwamp(322), swamp2: () => bakeSwamp(323), swamp3: () => bakeSwamp(324),
  stone0: () => bakeStone(331), stone1: () => bakeStone(332), stone2: () => bakeStone(333), stone3: () => bakeStone(334),
  ash0: () => bakeAsh(341), ash1: () => bakeAsh(342), ash2: () => bakeAsh(343), ash3: () => bakeAsh(344),
  water0: () => bakeWater(351), water1: () => bakeWater(352), water2: () => bakeWater(353),
  rock0: () => bakeRock(361), rock1: () => bakeRock(362), rock2: () => bakeRock(363),
  tree0: () => bakeTree(371), tree1: () => bakeTree(372), tree2: () => bakeTree(373), tree3: () => bakeTree(374),
  sandbags2: () => bakeSandbags(381),
  firebase: () => bakeFirebase(391),
  sand0: () => bakeSand(401), sand1: () => bakeSand(402), sand2: () => bakeSand(403),
  lava0: () => bakeLava(411), lava1: () => bakeLava(412), lava2: () => bakeLava(413),
  ice0: () => bakeIce(421), ice1: () => bakeIce(422), ice2: () => bakeIce(423),
};

// floor letter -> [texture base name, variant count]
const FLOOR_TEX = {
  '.': ['meadow', 6],
  ',': ['forest', 4],
  ':': ['swamp', 4],
  ';': ['stone', 4],
  '_': ['ash', 4],
  '=': ['sand', 3],
  '^': ['ice', 3],
};

// Unknown letters fall back to meadow so classic maps (and future letters)
// never break. Tall/decor letters pick a fitting ground to sit on.
// ('~' water, '!' lava and '%' void are painted live in the floor pass.)
function floorTex(c, x, y) {
  let f = FLOOR_TEX[c];
  if (!f) {
    if (c === 'T') f = FLOOR_TEX[','];
    else if (c === 'E' || c === 'K') f = FLOOR_TEX[';'];
    else if (c === '*') f = FLOOR_TEX['_'];
    else f = FLOOR_TEX['.'];
  }
  const [name, n] = f;
  return tex[name + ((x * 7 + y * 13) % n)];
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

function loadCached(src) {
  imageCache[src] ||= loadImage(src);
  return imageCache[src];
}

export async function initTextures() {
  await Promise.all(Object.entries(BAKERS).map(async ([key, bakeFn]) => {
    try { tex[key] = await loadImage(`/assets/${key}.png`); }
    catch { tex[key] = bakeFn(); }
  }));
}

// ============================== PORTRAITS & ICONS ==============================
// Cartoon operator busts: big readable human faces, head + shoulders, soft
// 2-tone shading + rim light, the character color as a jacket/collar accent,
// and a small pushed-up visor / earpiece keeping the operator flavor without
// hiding the face. Pure vector — crisp at every size (extra micro-detail
// switches on at >= 80px). Override with /assets/portrait2_<id>.png.

const SKIN_TONES = ['#F4D6B8', '#EBBE96', '#D9A06B', '#B97E4F', '#9A6238', '#7A4A2B'];

// Expression presets: brow tilt (+ = angry inner-down), brow raise, eyelid
// droop 0..1 (1 = closed), iris look offset, mouth style.
const PORTRAIT_EXPR = {
  keen:   { tilt: -0.10, raise: 1.0, lid: 0.05, look: 0.15, mouth: 'smile' },
  stoic:  { tilt: 0.14, raise: 0.0, lid: 0.20, look: 0, mouth: 'flat' },
  grin:   { tilt: -0.06, raise: 1.4, lid: 0.05, look: 0, mouth: 'grin' },
  warm:   { tilt: -0.16, raise: 0.6, lid: 0.18, look: 0, mouth: 'smile' },
  calm:   { tilt: 0.02, raise: -0.2, lid: 0.45, look: 0, mouth: 'flat' },
  wild:   { tilt: 0.26, raise: 1.2, lid: 0.0, look: 0.1, mouth: 'grin' },
  manic:  { tilt: -0.05, raise: 2.0, lid: -0.10, look: 0, mouth: 'grin' },
  stern:  { tilt: 0.30, raise: -0.6, lid: 0.22, look: 0, mouth: 'frown' },
  focus:  { tilt: 0.10, raise: 0.4, lid: 0.15, look: -0.1, mouth: 'smile' },
  smirk:  { tilt: -0.04, raise: 0.6, lid: 0.20, look: 0.2, mouth: 'smirk', asym: true },
  spark:  { tilt: -0.12, raise: 1.8, lid: 0.0, look: 0, mouth: 'open' },
  laugh:  { tilt: -0.10, raise: 1.0, lid: 1.0, look: 0, mouth: 'open' },
  aloof:  { tilt: 0.04, raise: 0.2, lid: 0.32, look: 0.4, mouth: 'flat' },
  curious:{ tilt: -0.08, raise: 1.3, lid: 0.08, look: -0.2, mouth: 'smile', asym: true },
  gentle: { tilt: -0.10, raise: 0.3, lid: 0.26, look: 0, mouth: 'smile' },
  serene: { tilt: -0.06, raise: 0.1, lid: 0.38, look: 0, mouth: 'smile' },
};

// Per-character cast sheet (17 operators): gender presentation, skin tone,
// hair style + color, expression, identity prop. Mix per the casting call.
const PORTRAIT_CAST = {
  scout:     { fem: true, skin: 1, hair: 'pixie', hairCol: '#5A4632', expr: 'keen', prop: 'ear' },
  soldier:   { fem: false, skin: 2, hair: 'buzz', hairCol: '#33291E', expr: 'stoic', prop: 'visor' },
  grenadier: { fem: false, skin: 4, hair: 'mohawk', hairCol: '#1E1812', expr: 'grin', prop: 'ear' },
  medic:     { fem: true, skin: 0, hair: 'bob', hairCol: '#8C5A38', expr: 'warm', prop: 'cross', freckles: true },
  sniper:    { fem: true, skin: 3, hair: 'pony', hairCol: '#241E18', expr: 'calm', prop: 'visor' },
  raider:    { fem: false, skin: 1, hair: 'spikes', hairCol: '#7A2F22', expr: 'wild', prop: 'ear', scar: true },
  pyro:      { fem: true, skin: 0, hair: 'asym', hairCol: '#D9542F', expr: 'manic', prop: 'visor', smudge: true },
  bastion:   { fem: false, skin: 5, hair: 'bald', hairCol: '#2A211A', expr: 'stern', prop: 'ear', beard: 'full' },
  engineer:  { fem: true, skin: 2, hair: 'bun', hairCol: '#6E4A26', expr: 'focus', prop: 'goggles' },
  duelist:   { fem: true, skin: 1, hair: 'sweep', hairCol: '#3A2C4E', expr: 'smirk', prop: 'ear' },
  volt:      { fem: false, skin: 0, hair: 'upspikes', hairCol: '#3FA8C2', expr: 'spark', prop: 'ear' },
  boomer:    { fem: false, skin: 3, hair: 'flattop', hairCol: '#262019', expr: 'laugh', prop: 'ear' },
  warden:    { fem: false, skin: 4, hair: 'crop', hairCol: '#1C1610', expr: 'stoic', prop: 'visor', beard: 'chin' },
  shade:     { fem: true, skin: 0, hair: 'longstraight', hairCol: '#1C1A26', expr: 'aloof', prop: 'ear' },
  helix:     { fem: true, skin: 2, hair: 'buns2', hairCol: '#4A3A5C', expr: 'curious', prop: 'ear' },
  atlas:     { fem: false, skin: 5, hair: 'curls', hairCol: '#1E1812', expr: 'gentle', prop: 'visor' },
  seal:      { fem: true, skin: 3, hair: 'wet', hairCol: '#202E33', expr: 'serene', prop: 'ear' },
  // milestone-unlocked operators (earned via Endless / Daily / mission play)
  ranger:    { fem: true, skin: 2, hair: 'pony', hairCol: '#3B5A2E', expr: 'focus', prop: 'visor' },
  sentinel:  { fem: false, skin: 4, hair: 'crop', hairCol: '#2A3340', expr: 'stern', prop: 'visor', beard: 'chin' },
  tempest:   { fem: true, skin: 1, hair: 'asym', hairCol: '#C9A227', expr: 'spark', prop: 'ear' },
  vandal: { fem: false, skin: 3, hair: 'mohawk', hairCol: '#7A2218', expr: 'wild', prop: 'ear' },
  rampart: { fem: true, skin: 5, hair: 'buzz', hairCol: '#1C1610', expr: 'stern', prop: 'visor' },
  cinder: { fem: false, skin: 1, hair: 'spikes', hairCol: '#C75A1E', expr: 'smirk', prop: 'goggles' },
  vesper: { fem: true, skin: 3, hair: 'pony', hairCol: '#2A3A4E', expr: 'calm', prop: 'visor' },
  howitz: { fem: false, skin: 4, hair: 'flattop', hairCol: '#1E1812', expr: 'stern', prop: 'ear' },
  quill: { fem: true, skin: 1, hair: 'asym', hairCol: '#3B5A3E', expr: 'focus', prop: 'goggles' },
  frost: { fem: true, skin: 1, hair: 'bun', hairCol: '#cfd8ff', expr: 'calm', prop: 'visor' },
  hymn: { fem: true, skin: 3, hair: 'pony', hairCol: '#7a4a2b', expr: 'warm', prop: 'ear' },
  mirage: { fem: false, skin: 4, hair: 'spikes', hairCol: '#2b2b2b', expr: 'smirk', prop: 'goggles' },
  wisp: { fem: true, skin: 1, hair: 'pixie', hairCol: '#5ce0a0', expr: 'spark', prop: 'visor' },
};

// Hair back layers (drawn behind the head) for the long styles.
function portraitHairBack(ctx, style, col, dark) {
  ctx.fillStyle = dark;
  if (style === 'pony') {
    // high tail swinging out left
    ctx.beginPath();
    ctx.moveTo(19, 16);
    ctx.quadraticCurveTo(8, 22, 10, 40);
    ctx.quadraticCurveTo(11.5, 45, 14.5, 43);
    ctx.quadraticCurveTo(13, 30, 21, 22);
    ctx.closePath(); ctx.fill();
  } else if (style === 'longstraight' || style === 'wet') {
    // hair mass falling to both shoulders
    ctx.beginPath();
    ctx.moveTo(16, 17);
    ctx.quadraticCurveTo(12.5, 32, 14, 46);
    ctx.lineTo(42, 46);
    ctx.quadraticCurveTo(43.5, 32, 40, 17);
    ctx.closePath(); ctx.fill();
  } else if (style === 'sweep') {
    // one long side mass over the right shoulder
    ctx.beginPath();
    ctx.moveTo(34, 14);
    ctx.quadraticCurveTo(43, 22, 42.5, 44);
    ctx.quadraticCurveTo(38.5, 47, 35.5, 44);
    ctx.quadraticCurveTo(36.5, 28, 31, 18);
    ctx.closePath(); ctx.fill();
  } else if (style === 'bob') {
    // curtains down to the jawline
    ctx.beginPath();
    ctx.moveTo(15.5, 18);
    ctx.quadraticCurveTo(13.5, 30, 15.5, 36.5);
    ctx.lineTo(40.5, 36.5);
    ctx.quadraticCurveTo(42.5, 30, 40.5, 18);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = col;
}

// Hair front/top layers, drawn over the head. cx=28, head top ~12.5.
function portraitHairFront(ctx, style, col, dark, fine) {
  ctx.fillStyle = col;
  if (style === 'pixie') {
    ctx.beginPath();
    ctx.moveTo(16, 26);
    ctx.quadraticCurveTo(14.5, 13, 28, 11.5);
    ctx.quadraticCurveTo(41.5, 13, 40, 24);
    ctx.quadraticCurveTo(36, 16.5, 30, 16.5); // side sweep notch
    ctx.quadraticCurveTo(22, 17.5, 20.5, 21.5);
    ctx.quadraticCurveTo(18.5, 18.5, 16, 26);
    ctx.closePath(); ctx.fill();
    if (fine) { ctx.strokeStyle = dark; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(24, 14); ctx.quadraticCurveTo(28, 13, 33, 15); ctx.stroke(); }
  } else if (style === 'buzz') {
    ctx.globalAlpha *= 0.88; // tight cut: scalp shows through
    ctx.beginPath();
    ctx.moveTo(16.5, 22);
    ctx.quadraticCurveTo(16, 12.5, 28, 11.8);
    ctx.quadraticCurveTo(40, 12.5, 39.5, 22);
    ctx.quadraticCurveTo(34, 17.5, 28, 17.2);
    ctx.quadraticCurveTo(22, 17.5, 16.5, 22);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha /= 0.88;
  } else if (style === 'mohawk') {
    // shaved sides + a proud central ridge
    ctx.globalAlpha *= 0.45;
    ctx.beginPath();
    ctx.moveTo(17, 21); ctx.quadraticCurveTo(17, 14, 24, 12.6); ctx.lineTo(24, 17.5); ctx.quadraticCurveTo(20, 18.5, 17, 21);
    ctx.moveTo(39, 21); ctx.quadraticCurveTo(39, 14, 32, 12.6); ctx.lineTo(32, 17.5); ctx.quadraticCurveTo(36, 18.5, 39, 21);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha /= 0.45;
    ctx.beginPath();
    ctx.moveTo(24.5, 17);
    ctx.lineTo(24.5, 9.5); ctx.lineTo(27, 6.5); ctx.lineTo(29, 9.2); ctx.lineTo(31.5, 7); ctx.lineTo(31.5, 17);
    ctx.quadraticCurveTo(28, 15.5, 24.5, 17);
    ctx.closePath(); ctx.fill();
  } else if (style === 'bob') {
    ctx.beginPath();
    ctx.moveTo(15.5, 26);
    ctx.quadraticCurveTo(14, 12, 28, 11.5);
    ctx.quadraticCurveTo(42, 12, 40.5, 26);
    ctx.lineTo(38.5, 20.5);
    ctx.quadraticCurveTo(35, 16, 25, 16.8); // straight fringe with a side gap
    ctx.lineTo(19.5, 19.5);
    ctx.lineTo(17.5, 26);
    ctx.closePath(); ctx.fill();
  } else if (style === 'pony') {
    ctx.beginPath();
    ctx.moveTo(16, 24);
    ctx.quadraticCurveTo(14.5, 12.5, 28, 11.8);
    ctx.quadraticCurveTo(41.5, 12.5, 40, 24);
    ctx.quadraticCurveTo(37.5, 16.5, 28, 16.2);
    ctx.quadraticCurveTo(18.5, 16.5, 16, 24);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = dark; // tie band hint at the temple
    ctx.fillRect(17.5, 17.5, 2.6, 1.6);
    ctx.fillStyle = col;
  } else if (style === 'spikes') {
    ctx.beginPath();
    ctx.moveTo(15.5, 24);
    for (const [sx2, sy2, mx, my] of [
      [15.5, 24, 14.5, 14], [21, 16.5, 20, 8.5], [26, 15, 27, 6.8],
      [31, 15, 34.5, 8], [36, 17, 41, 11], [40.5, 24, 40.5, 24],
    ]) { ctx.lineTo(mx, my); ctx.lineTo(sx2 + 3, sy2); }
    ctx.quadraticCurveTo(28, 14.5, 15.5, 24);
    ctx.closePath(); ctx.fill();
  } else if (style === 'bald') {
    // clean dome: just a soft crown highlight
    ctx.fillStyle = 'rgba(223,243,255,0.16)';
    ctx.beginPath(); ctx.ellipse(24, 15.5, 5, 2.6, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col;
  } else if (style === 'bun') {
    ctx.beginPath();
    ctx.moveTo(16, 23.5);
    ctx.quadraticCurveTo(15, 12.5, 28, 11.8);
    ctx.quadraticCurveTo(41, 12.5, 40, 23.5);
    ctx.quadraticCurveTo(36, 16.8, 28, 16.4);
    ctx.quadraticCurveTo(20, 16.8, 16, 23.5);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(28, 9.4, 4.4, 0, Math.PI * 2); ctx.fill(); // topknot
    if (fine) { // loose working strands
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(17, 20); ctx.quadraticCurveTo(15.5, 23, 16.5, 26); ctx.stroke();
    }
  } else if (style === 'sweep') {
    // deep asymmetric fringe covering one brow
    ctx.beginPath();
    ctx.moveTo(15.5, 25);
    ctx.quadraticCurveTo(14.5, 12, 28, 11.5);
    ctx.quadraticCurveTo(42, 12.5, 40.5, 22);
    ctx.quadraticCurveTo(38, 15.5, 30, 15.8);
    ctx.quadraticCurveTo(34, 19.5, 36.5, 25.5); // the sweep dives across
    ctx.quadraticCurveTo(30, 19, 22, 18.4);
    ctx.quadraticCurveTo(17.5, 19.5, 15.5, 25);
    ctx.closePath(); ctx.fill();
  } else if (style === 'upspikes') {
    // static-charged upward flick
    ctx.beginPath();
    ctx.moveTo(16, 22.5);
    ctx.lineTo(15, 11.5); ctx.lineTo(20.5, 15);
    ctx.lineTo(22.5, 7.5); ctx.lineTo(26.5, 13.6);
    ctx.lineTo(31, 6.5); ctx.lineTo(33, 13.4);
    ctx.lineTo(38.5, 8.5); ctx.lineTo(38, 16);
    ctx.lineTo(41, 14); ctx.lineTo(40, 22.5);
    ctx.quadraticCurveTo(28, 15.5, 16, 22.5);
    ctx.closePath(); ctx.fill();
  } else if (style === 'flattop') {
    ctx.beginPath();
    ctx.moveTo(16.5, 22);
    ctx.lineTo(16.5, 10.5); ctx.lineTo(39.5, 10.5); ctx.lineTo(39.5, 22);
    ctx.quadraticCurveTo(34, 16.5, 28, 16.4);
    ctx.quadraticCurveTo(22, 16.5, 16.5, 22);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(223,243,255,0.10)';
    ctx.fillRect(17.5, 10.5, 21, 1.4);
    ctx.fillStyle = col;
  } else if (style === 'crop') {
    ctx.beginPath();
    ctx.moveTo(16.5, 22.5);
    ctx.quadraticCurveTo(16, 12.5, 28, 12);
    ctx.quadraticCurveTo(40, 12.5, 39.5, 22.5);
    ctx.lineTo(38, 18);
    ctx.lineTo(20, 18); // straight military fringe line
    ctx.lineTo(18, 20);
    ctx.closePath(); ctx.fill();
  } else if (style === 'longstraight') {
    ctx.beginPath();
    ctx.moveTo(15, 28);
    ctx.quadraticCurveTo(13.5, 12, 28, 11.5);
    ctx.quadraticCurveTo(42.5, 12, 41, 28);
    ctx.lineTo(39, 21);
    ctx.quadraticCurveTo(37.5, 16.5, 31.5, 16.6); // center-side part
    ctx.lineTo(33.5, 21);
    ctx.quadraticCurveTo(27, 16.8, 21.5, 17.4); // side bangs over one eye
    ctx.quadraticCurveTo(17.5, 19.5, 17, 24);
    ctx.lineTo(15, 28);
    ctx.closePath(); ctx.fill();
  } else if (style === 'buns2') {
    ctx.beginPath();
    ctx.moveTo(16, 23.5);
    ctx.quadraticCurveTo(15, 12.5, 28, 11.8);
    ctx.quadraticCurveTo(41, 12.5, 40, 23.5);
    ctx.quadraticCurveTo(35, 16.5, 28, 16.6);
    ctx.quadraticCurveTo(21, 16.5, 16, 23.5);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(18.5, 10.5, 3.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(37.5, 10.5, 3.8, 0, Math.PI * 2); ctx.fill();
  } else if (style === 'curls') {
    // a cap of tight curl bumps
    ctx.beginPath();
    for (const [bx, by, br] of [[18, 19, 4], [22, 14.5, 4.4], [28, 12.5, 4.8], [34, 14.5, 4.4], [38, 19, 4], [28, 16, 5.5]]) {
      ctx.moveTo(bx + br, by);
      ctx.arc(bx, by, br, 0, Math.PI * 2);
    }
    ctx.fill();
  } else if (style === 'wet') {
    // slicked straight back off the brow — fresh out of the water
    ctx.beginPath();
    ctx.moveTo(16.5, 24);
    ctx.quadraticCurveTo(15.5, 13.5, 28, 12.6);
    ctx.quadraticCurveTo(40.5, 13.5, 39.5, 24);
    ctx.quadraticCurveTo(35.5, 17.2, 28, 17);
    ctx.quadraticCurveTo(20.5, 17.2, 16.5, 24);
    ctx.closePath(); ctx.fill();
    // wet shine streaks raked backward
    ctx.strokeStyle = 'rgba(223,243,255,0.35)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(22, 16.5); ctx.quadraticCurveTo(21, 14, 22.5, 12.6);
    ctx.moveTo(28, 16); ctx.quadraticCurveTo(27.5, 14, 28, 12.4);
    ctx.moveTo(34, 16.5); ctx.quadraticCurveTo(35, 14, 33.5, 12.6);
    ctx.stroke();
    ctx.fillStyle = col;
  }
  if (style === 'asym') {
    // flame-cut asymmetric bob: long on the left, cropped on the right
    ctx.beginPath();
    ctx.moveTo(14.5, 32);
    ctx.quadraticCurveTo(13, 12.5, 28, 11.5);
    ctx.quadraticCurveTo(41.5, 12.5, 40, 21.5);
    ctx.quadraticCurveTo(36.5, 16, 29, 16.4);
    ctx.quadraticCurveTo(21.5, 17, 19, 22);
    ctx.quadraticCurveTo(17, 26.5, 17.5, 31);
    ctx.quadraticCurveTo(16, 32.5, 14.5, 32);
    ctx.closePath(); ctx.fill();
    if (fine) { ctx.strokeStyle = dark; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(16.5, 24); ctx.quadraticCurveTo(15.5, 28, 16.5, 31); ctx.stroke(); }
  }
}

export function drawPortrait(canvas, ch, size = 56) {
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  loadCached(`/assets/portrait2_${ch.id}.png`)
    .then(img => ctx.drawImage(img, 0, 0, size, size))
    .catch(() => {
      const s = size / 56;
      const fine = size >= 80; // extra micro-detail only when it can resolve
      const cfg = PORTRAIT_CAST[ch.id] ?? { fem: false, skin: 2, hair: 'crop', hairCol: '#2A211A', expr: 'stoic', prop: 'ear' };
      const ex = PORTRAIT_EXPR[cfg.expr] ?? PORTRAIT_EXPR.stoic;
      const skin = SKIN_TONES[cfg.skin] ?? SKIN_TONES[2];
      const skinDk = shade(skin, -34);
      const hairDk = shade(cfg.hairCol, -22);
      // --- backdrop: night plate + char-color aura behind the head ---
      const g = ctx.createLinearGradient(0, 0, 0, size);
      g.addColorStop(0, '#141625');
      g.addColorStop(1, '#0B0A14');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      const ag = ctx.createRadialGradient(size * 0.5, size * 0.42, 2, size * 0.5, size * 0.42, size * 0.62);
      ag.addColorStop(0, 'rgba(191,208,232,0.10)');
      ag.addColorStop(0.6, `${ch.color}26`);
      ag.addColorStop(1, 'rgba(11,10,20,0)');
      ctx.fillStyle = ag;
      ctx.fillRect(0, 0, size, size);
      ctx.save();
      ctx.scale(s, s);
      ctx.lineJoin = 'round';
      const cx = 28;
      // --- shoulders + jacket (graphite, char-color collar accent) ---
      const shW = cfg.fem ? 19.5 : 22.5;
      ctx.fillStyle = PAL.graphMid;
      ctx.beginPath();
      ctx.moveTo(cx - shW, 56);
      ctx.quadraticCurveTo(cx - shW + 1, 44.5, cx - 9, 42.5);
      ctx.lineTo(cx + 9, 42.5);
      ctx.quadraticCurveTo(cx + shW - 1, 44.5, cx + shW, 56);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = PAL.graphDark; // jacket zip seam
      ctx.fillRect(cx - 0.8, 46, 1.6, 10);
      // char-color collar: two raised lapel chevrons + glow seam
      ctx.fillStyle = ch.color;
      ctx.save();
      ctx.shadowColor = ch.color;
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.moveTo(cx - 10.5, 43.5); ctx.lineTo(cx - 3, 46.5); ctx.lineTo(cx - 4, 49.5); ctx.lineTo(cx - 12, 46.5);
      ctx.moveTo(cx + 10.5, 43.5); ctx.lineTo(cx + 3, 46.5); ctx.lineTo(cx + 4, 49.5); ctx.lineTo(cx + 12, 46.5);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      if (fine) { // stitch ticks on the shoulder seams
        ctx.strokeStyle = 'rgba(138,152,184,0.4)';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(cx - shW + 2.5, 50); ctx.lineTo(cx - 12, 46.8);
        ctx.moveTo(cx + shW - 2.5, 50); ctx.lineTo(cx + 12, 46.8);
        ctx.stroke();
      }
      // --- neck ---
      ctx.fillStyle = skin;
      ctx.fillRect(cx - 4.2, 34, 8.4, 10.5);
      ctx.fillStyle = 'rgba(11,10,20,0.22)'; // chin shadow on the neck
      ctx.fillRect(cx - 4.2, 34, 8.4, 3.4);
      // --- hair back layer (behind the head) ---
      portraitHairBack(ctx, cfg.hair, cfg.hairCol, hairDk);
      // --- head: soft cartoon oval, gendered jaw ---
      const hr = cfg.fem ? 11.4 : 12.1; // half-width
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.moveTo(cx - hr, 24);
      ctx.quadraticCurveTo(cx - hr - 0.6, 12.5, cx, 12);
      ctx.quadraticCurveTo(cx + hr + 0.6, 12.5, cx + hr, 24);
      if (cfg.fem) { // tapered chin
        ctx.quadraticCurveTo(cx + hr - 1, 32.5, cx, 37);
        ctx.quadraticCurveTo(cx - hr + 1, 32.5, cx - hr, 24);
      } else { // squared jaw
        ctx.quadraticCurveTo(cx + hr, 33, cx + 5.5, 36.6);
        ctx.quadraticCurveTo(cx, 38, cx - 5.5, 36.6);
        ctx.quadraticCurveTo(cx - hr, 33, cx - hr, 24);
      }
      ctx.closePath(); ctx.fill();
      // ears
      ctx.beginPath();
      ctx.ellipse(cx - hr - 0.6, 26, 2.2, 3.1, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + hr + 0.6, 26, 2.2, 3.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = skinDk; // inner ear notch
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(cx - hr - 0.6, 26, 1.1, -0.8, 1.6);
      ctx.moveTo(cx + hr + 1.5, 25);
      ctx.arc(cx + hr + 0.6, 26, 1.1, Math.PI - 1.6, Math.PI + 0.8);
      ctx.stroke();
      // --- 2-tone shading: shaded right side + rim light on the left ---
      ctx.save();
      ctx.beginPath(); // clip to the head oval (slightly generous)
      ctx.ellipse(cx, 25, hr + 0.7, 12.8, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = 'rgba(31,21,38,0.16)';
      ctx.beginPath();
      ctx.ellipse(cx + hr + 3, 25.5, 9.5, 14, 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(223,243,255,0.5)'; // moonlit rim
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx - 0.5, 25, hr + 0.2, Math.PI * 0.78, Math.PI * 1.22);
      ctx.stroke();
      // --- face: big readable cartoon features ---
      const eyeY = 25, eyeDX = 5.1;
      const lid = Math.max(-0.15, Math.min(1, ex.lid));
      for (const side of [-1, 1]) {
        const exx = cx + side * eyeDX + ex.look * 1.6;
        if (lid >= 1) {
          // closed-happy: an upturned arc per eye
          ctx.strokeStyle = '#33271E';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(exx, eyeY + 1.2, 2.8, Math.PI * 1.15, Math.PI * 1.85);
          ctx.stroke();
        } else {
          const ry = 2.5 * (1 - lid * 0.62) + (lid < 0 ? 0.5 : 0);
          ctx.fillStyle = '#F6F3EC';
          ctx.beginPath();
          ctx.ellipse(exx, eyeY, 3.3, ry, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#33271E'; // iris
          ctx.beginPath();
          ctx.arc(exx + ex.look * 1.4, eyeY + 0.3, Math.min(1.9, ry * 0.9), 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#FFFFFF'; // glint
          ctx.fillRect(exx + ex.look * 1.4 - 1.3, eyeY - 1.1, 1, 1);
          if (lid > 0.05) { // upper lid line
            ctx.strokeStyle = skinDk;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(exx - 3.3, eyeY - ry * 0.7);
            ctx.quadraticCurveTo(exx, eyeY - ry - 0.6, exx + 3.3, eyeY - ry * 0.7);
            ctx.stroke();
          }
        }
      }
      // brows: expression carriers (asym raises the right one)
      ctx.strokeStyle = hairDk;
      ctx.lineWidth = cfg.fem ? 1.3 : 1.9;
      for (const side of [-1, 1]) {
        const raise = ex.raise + (ex.asym && side === 1 ? 1.4 : 0);
        const by = eyeY - 4.6 - raise * 0.9;
        const tilt = ex.tilt * side * 3.4;
        ctx.beginPath();
        ctx.moveTo(cx + side * (eyeDX - 3.1), by + tilt);
        ctx.quadraticCurveTo(cx + side * eyeDX, by - 1.1, cx + side * (eyeDX + 3.1), by - tilt * 0.4);
        ctx.stroke();
      }
      // nose: small wedge
      ctx.strokeStyle = skinDk;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(cx + 0.6, 27);
      ctx.quadraticCurveTo(cx + 1.6, 29.6, cx - 0.4, 30.2);
      ctx.stroke();
      // mouth
      const mY = 33;
      if (ex.mouth === 'grin') {
        ctx.fillStyle = '#5A2520';
        ctx.beginPath();
        ctx.moveTo(cx - 4.6, mY - 1);
        ctx.quadraticCurveTo(cx, mY + 3.8, cx + 4.6, mY - 1);
        ctx.quadraticCurveTo(cx, mY + 0.6, cx - 4.6, mY - 1);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#F6F3EC'; // teeth band
        ctx.beginPath();
        ctx.moveTo(cx - 3.9, mY - 0.8);
        ctx.quadraticCurveTo(cx, mY + 0.9, cx + 3.9, mY - 0.8);
        ctx.quadraticCurveTo(cx, mY + 0.1, cx - 3.9, mY - 0.8);
        ctx.closePath(); ctx.fill();
      } else if (ex.mouth === 'open') {
        ctx.fillStyle = '#5A2520';
        ctx.beginPath();
        ctx.ellipse(cx, mY + 0.4, 3.1, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#F6F3EC';
        ctx.fillRect(cx - 2.2, mY - 1.9, 4.4, 1.3);
      } else if (ex.mouth === 'smirk') {
        ctx.strokeStyle = '#7A3B33';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - 3.4, mY + 0.6);
        ctx.quadraticCurveTo(cx + 1.5, mY + 1.6, cx + 4.4, mY - 1.6);
        ctx.stroke();
      } else if (ex.mouth === 'frown') {
        ctx.strokeStyle = '#7A3B33';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - 3.6, mY + 1);
        ctx.quadraticCurveTo(cx, mY - 0.8, cx + 3.6, mY + 1);
        ctx.stroke();
      } else if (ex.mouth === 'flat') {
        ctx.strokeStyle = '#7A3B33';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(cx - 3, mY); ctx.lineTo(cx + 3.2, mY);
        ctx.stroke();
      } else { // smile
        ctx.strokeStyle = '#7A3B33';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - 3.8, mY - 0.6);
        ctx.quadraticCurveTo(cx, mY + 1.9, cx + 3.8, mY - 0.6);
        ctx.stroke();
      }
      // identity marks
      if (cfg.scar) {
        ctx.strokeStyle = 'rgba(150,62,52,0.85)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(cx + 6.5, 20.5); ctx.lineTo(cx + 9.2, 28.5);
        if (fine) { ctx.moveTo(cx + 6.6, 23.5); ctx.lineTo(cx + 8.9, 22.6); }
        ctx.stroke();
      }
      if (cfg.smudge) { // soot streak across one cheekbone
        ctx.fillStyle = 'rgba(40,32,30,0.45)';
        ctx.beginPath();
        ctx.ellipse(cx - 7, 29.5, 3.4, 1.4, 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
      if (cfg.freckles) {
        ctx.fillStyle = 'rgba(160,100,60,0.55)';
        for (const [fx2, fy2] of [[-6.5, 28.6], [-4.8, 29.6], [5.2, 28.8], [6.8, 29.7], [-6, 30.4]]) {
          ctx.fillRect(cx + fx2, fy2, 0.9, 0.9);
        }
      }
      if (cfg.beard === 'full') {
        ctx.fillStyle = cfg.hairCol;
        ctx.beginPath();
        ctx.moveTo(cx - hr + 1, 26.5);
        ctx.quadraticCurveTo(cx - hr + 1, 36, cx, 38.6);
        ctx.quadraticCurveTo(cx + hr - 1, 36, cx + hr - 1, 26.5);
        ctx.quadraticCurveTo(cx + 6, 30.5, cx, 30.5);
        ctx.quadraticCurveTo(cx - 6, 30.5, cx - hr + 1, 26.5);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#5A2520'; // mouth reads through the beard
        ctx.fillRect(cx - 2.6, mY - 0.4, 5.2, 1.3);
      } else if (cfg.beard === 'chin') {
        ctx.strokeStyle = cfg.hairCol;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(cx - 7.5, 31);
        ctx.quadraticCurveTo(cx, 38.2, cx + 7.5, 31);
        ctx.stroke();
      }
      // --- hair front layer ---
      portraitHairFront(ctx, cfg.hair, cfg.hairCol, hairDk, fine);
      // --- operator props (kept small: the face stays the hero) ---
      if (cfg.prop === 'visor') {
        // visor pushed UP onto the hairline
        ctx.fillStyle = PAL.graphPlate;
        ctx.beginPath();
        ctx.moveTo(cx - 10.5, 15.5);
        ctx.quadraticCurveTo(cx, 11.2, cx + 10.5, 15.5);
        ctx.quadraticCurveTo(cx, 13.8, cx - 10.5, 15.5);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = PAL.relay; // parked slit still glows faintly
        ctx.lineWidth = 1;
        ctx.shadowColor = PAL.relay;
        ctx.shadowBlur = 3;
        ctx.beginPath();
        ctx.moveTo(cx - 8, 14.9);
        ctx.quadraticCurveTo(cx, 12.4, cx + 8, 14.9);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = PAL.graphDark; // hinge studs at the temples
        ctx.fillRect(cx - 11.6, 15.2, 1.8, 1.8);
        ctx.fillRect(cx + 9.8, 15.2, 1.8, 1.8);
      } else if (cfg.prop === 'goggles') {
        // work goggles parked ON the forehead, never over the eyes
        ctx.strokeStyle = 'rgba(20,22,31,0.9)'; // strap around the crown
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(cx - hr - 0.5, 18);
        ctx.quadraticCurveTo(cx, 14.2, cx + hr + 0.5, 18);
        ctx.stroke();
        for (const side of [-1, 1]) {
          ctx.fillStyle = '#3E4452';
          ctx.beginPath(); ctx.arc(cx + side * 4.4, 16, 3.3, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#7E97AE';
          ctx.beginPath(); ctx.arc(cx + side * 4.4, 16, 2.1, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.75)'; // lens glint
          ctx.fillRect(cx + side * 4.4 - 1.6, 14.7, 1.1, 1.1);
          ctx.strokeStyle = PAL.graphDark;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(cx + side * 4.4, 16, 3.3, 0, Math.PI * 2); ctx.stroke();
        }
      } else { // 'ear' (default): comms earpiece with a char-color status dot
        ctx.fillStyle = PAL.graphPlate;
        ctx.beginPath();
        ctx.ellipse(cx + hr + 1, 25.6, 1.9, 2.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = PAL.graphPlate; // tiny mic stub
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(cx + hr + 0.6, 27.8);
        ctx.quadraticCurveTo(cx + hr - 1.5, 30.5, cx + hr - 3.6, 31);
        ctx.stroke();
        ctx.fillStyle = ch.color;
        ctx.shadowColor = ch.color;
        ctx.shadowBlur = 3;
        ctx.beginPath();
        ctx.arc(cx + hr + 1.2, 24.6, 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      if (cfg.prop === 'cross') {
        // medic: field-cross pin on the collar (earpiece too — she runs comms)
        ctx.fillStyle = PAL.graphPlate;
        ctx.beginPath(); ctx.ellipse(cx + hr + 1, 25.6, 1.9, 2.6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#E8F4F2';
        ctx.fillRect(cx + 6.4, 45.4, 4.6, 4.6);
        ctx.fillStyle = '#D2554A';
        ctx.fillRect(cx + 8.1, 46.1, 1.2, 3.2);
        ctx.fillRect(cx + 7.1, 47.1, 3.2, 1.2);
      }
      if (cfg.hair === 'wet' && fine) {
        // one droplet tracing the temple
        ctx.fillStyle = 'rgba(191,251,255,0.8)';
        ctx.beginPath();
        ctx.ellipse(cx - 9.4, 22.5, 0.7, 1.1, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      // frame
      ctx.strokeStyle = 'rgba(23,74,74,0.9)';
      ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
    });
}

// Group the weapon kinds into readable held-silhouette classes.
function weaponClass(kind) {
  switch (kind) {
    case 'rail': case 'ghost': return 'long';
    case 'railcannon': return 'long'; // field pickup: heavy pierce rail
    case 'scatter': case 'slug': return 'shotgun';
    case 'mortar': case 'cannon': case 'rivet': case 'comet': return 'tube';
    case 'mortarMk2': return 'tube'; // field pickup: over-wall AoE tube
    case 'twin': case 'blade': return 'blades';
    case 'flame': case 'flamer': return 'thrower'; // flamer = field pickup cone
    case 'disc': case 'helix': return 'arc';
    case 'stormgun': return 'arc'; // field pickup: chain-zap emitter
    case 'harpoon': return 'spear'; // the Selkie's barbed harpoon
    default: return 'smg'; // smg, needle, spark, unknown future kinds
  }
}

// HUD weapon silhouette. Override with /assets/weapon2_<id>.png.
export function drawWeaponIcon(canvas, chOrWeapon) {
  const weapon = chOrWeapon.weapon || chOrWeapon;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (chOrWeapon.id) {
    loadCached(`/assets/weapon2_${chOrWeapon.id}.png`)
      .then(img => { ctx.clearRect(0, 0, W, H); ctx.drawImage(img, 0, 0, W, H); })
      .catch(() => {});
  }
  const cls = weaponClass(weapon.kind);
  const gm = PAL.graphPlate, dk = PAL.graphDark, hi = PAL.moonsteel;
  ctx.save();
  ctx.translate(14, H / 2);
  if (cls === 'long') {
    ctx.fillStyle = dk; ctx.fillRect(0, -3, 132, 5);
    ctx.fillStyle = gm; ctx.fillRect(10, -5, 34, 10);
    ctx.fillStyle = dk;
    ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(-12, 9); ctx.lineTo(-3, 10); ctx.lineTo(6, 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = gm; ctx.fillRect(24, -10, 14, 5); // scope
    ctx.fillStyle = PAL.coldHi; ctx.fillRect(36, -9, 2, 3); // scope glint
    ctx.fillStyle = hi; ctx.fillRect(0, -3, 132, 1.2);
    ctx.fillStyle = PAL.relay; ctx.fillRect(132, -2, 3, 3);
  } else if (cls === 'shotgun') {
    ctx.fillStyle = dk; ctx.fillRect(0, -5, 92, 9);
    ctx.fillStyle = gm; ctx.fillRect(8, -7, 30, 13);
    ctx.fillStyle = gm; ctx.beginPath(); ctx.arc(30, 7, 8, 0, Math.PI * 2); ctx.fill(); // drum
    ctx.strokeStyle = dk; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = dk;
    ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(-13, 9); ctx.lineTo(-4, 10); ctx.lineTo(5, 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = hi; ctx.fillRect(0, -5, 92, 1.4);
    ctx.fillStyle = PAL.relay; ctx.fillRect(92, -3, 3, 4);
  } else if (cls === 'tube') {
    ctx.fillStyle = dk; ctx.fillRect(-8, -8, 116, 16);
    ctx.fillStyle = gm; ctx.fillRect(-8, -8, 116, 6);
    ctx.fillStyle = gm; ctx.fillRect(40, 8, 12, 6); // grip
    ctx.fillStyle = hi; ctx.fillRect(-8, -8, 116, 1.6);
    // warm rear cap — launcher glow
    ctx.fillStyle = PAL.lythAmber;
    ctx.shadowColor = PAL.lythAmber; ctx.shadowBlur = 8;
    ctx.fillRect(-12, -7, 4, 14);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#11131f'; ctx.fillRect(104, -6, 5, 12); // dark muzzle mouth
  } else if (cls === 'blades') {
    for (const k of [-1, 1]) {
      ctx.save();
      ctx.translate(56, 0);
      ctx.rotate(k * 0.32);
      ctx.fillStyle = dk; ctx.fillRect(-44, -2.4, 88, 4.8);
      ctx.fillStyle = PAL.anchor;
      ctx.shadowColor = PAL.relay; ctx.shadowBlur = 7;
      ctx.fillRect(-40, -3.4, 80, 1.6); // energy edge
      ctx.shadowBlur = 0;
      ctx.fillStyle = gm; ctx.fillRect(-8, -4, 16, 8); // guard
      ctx.restore();
    }
  } else if (cls === 'thrower') {
    ctx.fillStyle = dk; ctx.fillRect(0, -8, 56, 16);
    ctx.fillStyle = gm; ctx.fillRect(0, -8, 56, 6);
    ctx.fillStyle = gm; ctx.beginPath(); ctx.arc(14, 10, 7, 0, Math.PI * 2); ctx.fill(); // tank
    ctx.fillStyle = dk; ctx.fillRect(56, -3.5, 26, 7);
    ctx.fillStyle = hi; ctx.fillRect(0, -8, 56, 1.5);
    // warm utility nozzle — warm = utility, cool = combat
    ctx.fillStyle = PAL.lythGold;
    ctx.shadowColor = PAL.lythGold; ctx.shadowBlur = 9;
    ctx.fillRect(82, -3, 4, 6);
    ctx.shadowBlur = 0;
  } else if (cls === 'arc') {
    ctx.fillStyle = dk; ctx.fillRect(0, -5, 52, 9);
    ctx.fillStyle = gm; ctx.fillRect(8, -7, 22, 13);
    ctx.fillStyle = hi; ctx.fillRect(0, -5, 52, 1.4);
    ctx.strokeStyle = PAL.relay;
    ctx.shadowColor = PAL.relay; ctx.shadowBlur = 8;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(74, 0, 11, 0, Math.PI * 2); ctx.stroke(); // loaded disc
    ctx.shadowBlur = 0;
    ctx.strokeStyle = dk; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(74, 0, 6, 0, Math.PI * 2); ctx.stroke();
  } else if (cls === 'spear') {
    // harpoon: long shaft, barbed head, coiled retrieval line at the butt
    ctx.fillStyle = '#4A4232'; ctx.fillRect(0, -1.8, 110, 3.6); // shaft
    ctx.fillStyle = hi; ctx.fillRect(0, -1.8, 110, 1.1);
    ctx.fillStyle = gm; ctx.fillRect(34, -3.5, 18, 7); // grip wrap
    ctx.fillStyle = PAL.anchor; // barbed head
    ctx.shadowColor = PAL.relay; ctx.shadowBlur = 7;
    ctx.beginPath();
    ctx.moveTo(132, 0); ctx.lineTo(110, -5); ctx.lineTo(116, 0); ctx.lineTo(110, 5);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = PAL.coldHi; ctx.lineWidth = 1.4; // back-swept barbs
    ctx.beginPath();
    ctx.moveTo(116, -3); ctx.lineTo(109, -8);
    ctx.moveTo(116, 3); ctx.lineTo(109, 8);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(111,216,242,0.7)'; ctx.lineWidth = 1.5; // line coil
    ctx.beginPath(); ctx.arc(-6, 4, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(-6, 4, 3.2, 0, Math.PI * 2); ctx.stroke();
  } else { // smg / carbine
    ctx.fillStyle = dk; ctx.fillRect(0, -4, 80, 8);
    ctx.fillStyle = gm; ctx.fillRect(10, -6, 28, 11);
    ctx.fillStyle = dk; ctx.fillRect(26, 5, 8, 13); // mag
    ctx.fillStyle = dk;
    ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(-11, 8); ctx.lineTo(-3, 9); ctx.lineTo(5, 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = hi; ctx.fillRect(0, -4, 80, 1.3);
    ctx.fillStyle = PAL.relay; ctx.fillRect(80, -2.5, 3, 3); // muzzle dot
  }
  ctx.restore();
}

// HUD silhouette for a held FIELD weapon (the client probes for this export
// and passes the held kind — a string or a {kind} object). Each of the four
// field kinds reads as its own silhouette (flamer = thrower, railcannon =
// long rail, stormgun = arc emitter, mortarMk2 = launcher tube); the amber
// corner braces mark it as field issue rather than a character's own arm.
export function drawFieldWeaponIcon(canvas, fieldWeapon) {
  const kind = typeof fieldWeapon === 'string' ? fieldWeapon : (fieldWeapon?.kind ?? '');
  drawWeaponIcon(canvas, { kind });
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.save();
  ctx.strokeStyle = PAL.lythAmber;
  ctx.lineWidth = 1.6;
  for (const [cx, cy, dx, dy] of [[3, 3, 1, 1], [W - 3, 3, -1, 1], [3, H - 3, 1, -1], [W - 3, H - 3, -1, -1]]) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * 7, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * 7);
    ctx.stroke();
  }
  ctx.restore();
}

// ============================== EVENT FX ==============================
function burstAt(x, y, n, color, speed = 120, life = 0.4) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.4 + Math.random() * 0.6);
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color });
  }
}

// On-the-spot leveling: gold flare + floating LVL banner at the operator.
function levelUpFX(x, y, level) {
  rings.push({ x, y, r0: 6, r1: 42, life: 0.6, max: 0.6, color: PAL.lythGold, w: 2.5 });
  burstAt(x, y, 14, PAL.lythGold, 160, 0.55);
  burstAt(x, y, 6, PAL.lythPale, 210, 0.4);
  popups.push({ x, y: y - 28, text: `LVL ${level ?? 2}`, life: 1.2, max: 1.2, color: PAL.lythGold });
}

export function addEventFX(ev) {
  const burst = (n, color, speed = 120, life = 0.4) => burstAt(ev.x, ev.y, n, color, speed, life);
  const ring = (r1, color, life = 0.5, w = 3, r0 = 5) =>
    rings.push({ x: ev.x, y: ev.y, r0, r1, life, max: life, color, w });

  // shoot flashes carry the shooter's weapon evolution when the sim ships it
  // (ev.evo); otherwise render() resolves it from the nearest leveled player.
  // ev.weapon rides along so field weapons get their own muzzle FX.
  if (ev.type === 'shoot') flashes.push({ x: ev.x, y: ev.y, life: 0.07, who: ev.who, evo: ev.evo, weapon: ev.weapon });
  else if (ev.type === 'hit') { burst(4, '#ffd9d2', 110, 0.3); burst(3, PAL.red, 90, 0.3); }
  else if (ev.type === 'hitWall' || ev.type === 'shield') burst(5, PAL.steel, 90, 0.25);
  else if (ev.type === 'explode') {
    // scaled by aoe radius so blast-evolved rounds visibly hit harder
    const rk = Math.max(0.8, Math.min(2.2, (ev.radius ?? TILE) / TILE));
    burst(Math.round(22 * rk), PAL.lythAmber, 240 * rk, 0.6);
    burst(Math.round(8 * rk), PAL.ember, 150 * rk, 0.5);
    if (rk > 1.3) rings.push({ x: ev.x, y: ev.y, r0: 6, r1: ev.radius, life: 0.4, max: 0.4, color: PAL.lythAmber, w: 2.5 });
    shake = Math.max(shake, 4 * Math.min(1.4, rk)); // softened: grenadier blasts were jolting the whole couch/lobby
    if (rk > 1.8) punch = Math.max(punch, 0.4); // only the very biggest blasts kick the camera
  }
  else if (ev.type === 'die') {
    // the Entropy unravels: violet static + one cyan eye-spark
    burst(15, PAL.glitch, 180, 0.55); burst(5, PAL.eye, 220, 0.3);
    popups.push({ x: ev.x, y: ev.y - 20, text: `+${ev.points || 100} x${ev.combo || 1}`, life: 0.75, max: 0.75, color: PAL.lythGold });
    shake = Math.max(shake, 4);
  }
  else if (ev.type === 'down') { burst(12, PAL.red, 150, 0.6); burst(6, '#ffffff', 130, 0.4); shake = Math.max(shake, 6); }
  else if (ev.type === 'pickup') { burst(10, '#5fd2b4', 100, 0.5); popups.push({ x: ev.x, y: ev.y - 20, text: 'RESCUE', life: 0.8, max: 0.8, color: '#5fd2b4' }); }
  else if (ev.type === 'extract') { burst(16, PAL.anchor, 170, 0.7); popups.push({ x: ev.x, y: ev.y - 22, text: `+${ev.points || 250}`, life: 0.9, max: 0.9, color: PAL.relay }); }
  // music box: scoop sparkle, deposit chime burst, and the 4/4 fanfare
  else if (ev.type === 'mbPickup') { burst(8, '#c178ff', 90, 0.5); popups.push({ x: ev.x, y: ev.y - 20, text: 'ARTIFACT', life: 0.8, max: 0.8, color: '#d6a8ff' }); }
  else if (ev.type === 'mbPlace') { burst(14, '#c178ff', 130, 0.6); ring(38, 'rgba(198,140,255,0.8)', 0.6, 3); popups.push({ x: ev.x, y: ev.y - 22, text: `${ev.assembled ?? 0}/${ev.of ?? 4}`, life: 0.9, max: 0.9, color: '#d6a8ff' }); }
  else if (ev.type === 'mbComplete') {
    burst(28, '#c178ff', 200, 0.9); burst(12, '#eddbff', 130, 0.7);
    ring(90, 'rgba(214,168,255,0.85)', 0.9, 3); ring(50, 'rgba(237,219,255,0.7)', 0.7, 2.5);
    shake = Math.max(shake, 6);
    popups.push({ screen: true, x: 0, y: 0, text: 'THE RELIC AWAKENS', life: 3.0, max: 3.0, color: '#d6a8ff', size: 28 });
  }
  // --- RELIC AWAKENING horde event ---
  else if (ev.type === 'relicAwaken') {
    // the sky cracks: a white thunder flash, a heavy shake, a violet shock ring,
    // and a dread banner. The instant darken rides snap.dark (sim-driven).
    lightningT = 1;
    shake = Math.max(shake, 14);
    punch = Math.max(punch, 0.9);
    ring(260, 'rgba(160,90,220,0.8)', 1.1, 4);
    burst(28, PAL.glitch, 240, 0.8);
    popups.push({ screen: true, x: 0, y: 0, text: 'THE HORDE RISES', life: 3.4, max: 3.4, color: '#FF5A66', size: 32 });
    for (const edge of ['n', 's', 'e', 'w']) edgePulses.push({ edge, life: 3.0, max: 3.0, rgb: '120,30,40' });
  }
  else if (ev.type === 'horde') {
    // each burst breaches an edge: a crimson edge bleed + a directional pulse
    edgePulses.push({ edge: ev.edge || 'n', life: 1.4, max: 1.4, rgb: '150,30,40' });
    if (ev.x != null) { burst(10, PAL.red, 160, 0.5); burst(4, PAL.glitch, 120, 0.35); }
  }
  else if (ev.type === 'hordeBurst') {
    // periodic lightning through the storm (intensity climbs with progress)
    lightningT = Math.max(lightningT, 0.4 + 0.5 * (ev.progress ?? 0));
    shake = Math.max(shake, 2 + 3 * (ev.progress ?? 0));
  }
  else if (ev.type === 'nightmareDissolve') {
    // a leftover nightmare unravels when the event ends: violet motes, no score
    if (ev.x != null) { burst(12, PAL.glitch, 170, 0.5); burst(4, '#FF6A6A', 120, 0.35); }
  }
  else if (ev.type === 'relicSurvived') {
    lightningT = Math.max(lightningT, 0.6);
    ring(220, PAL.lythGold, 1.1, 4); ring(140, PAL.anchor, 0.8, 3);
    burst(30, PAL.lythGold, 260, 0.9); burst(12, PAL.lythPale, 200, 0.6);
    shake = Math.max(shake, 8);
    popups.push({ screen: true, x: 0, y: 0, text: 'THE RELIC IS QUELLED', life: 3.6, max: 3.6, color: PAL.lythGold, size: 30 });
    if (ev.score != null) {
      popups.push({ screen: true, x: 0, y: 56, text: `+${ev.score} RELIC BONUS`, life: 4.0, max: 4.0, color: PAL.lythGold, size: 22 });
      if ((ev.hits || ev.deaths)) {
        popups.push({
          screen: true, x: 0, y: 92,
          text: `${ev.base ?? 5000} BASE  −${(ev.hits || 0) * (ev.hitPenalty || 0)} HITS  −${(ev.deaths || 0) * (ev.deathPenalty || 0)} DEATHS`,
          life: 4.0, max: 4.0, color: '#d6a8ff', size: 16,
        });
      }
    }
  }
  else if (ev.type === 'relicFailed') {
    shake = Math.max(shake, 10);
    burst(24, PAL.red, 220, 0.8); burst(10, PAL.glitch, 160, 0.6);
    ring(180, PAL.red, 1.0, 4);
    popups.push({ screen: true, x: 0, y: 0, text: 'THE RELIC FALLS DORMANT', life: 3.6, max: 3.6, color: PAL.red, size: 28 });
  }
  else if (ev.type === 'spawn') burst(10, PAL.relay, 120, 0.5);
  else if (ev.type === 'spawnEnemy') { burst(8, PAL.glitch, 110, 0.45); burst(3, PAL.eye, 60, 0.25); }
  else if (ev.type === 'alert') popups.push({ x: ev.x, y: ev.y - 26, text: '!', life: 0.6, max: 0.6, color: PAL.eye });
  else if (ev.type === 'telegraph') { burst(6, PAL.glitch, 70, 0.35); flashes.push({ x: ev.x, y: ev.y, life: 0.12, who: 'e' }); }
  // screen-space: the camera may be anywhere on a big map when time runs low
  else if (ev.type === 'lowTime') popups.push({ screen: true, x: 0, y: 0, text: 'LOW TIME', life: 1.4, max: 1.4, color: '#ff7a6a' });
  // --- Anchorfall events ---
  else if (ev.type === 'shard') {
    burst(7, PAL.lythGold, 110, 0.5);
    popups.push({ x: ev.x, y: ev.y - 18, text: `+${ev.amount ?? 1}◆`, life: 0.8, max: 0.8, color: PAL.lythGold });
  }
  else if (ev.type === 'build') burst(3, '#8d8672', 45, 0.35);
  else if (ev.type === 'built') { ring(46, PAL.relay, 0.5); burst(12, PAL.relay, 130, 0.5); flashes.push({ x: ev.x, y: ev.y, life: 0.1, who: 'p' }); }
  else if (ev.type === 'buildHit') burst(4, '#9aa0b4', 85, 0.25);
  else if (ev.type === 'buildDown') { burst(16, '#8d8672', 170, 0.55); burst(8, PAL.ember, 120, 0.5); shake = Math.max(shake, 5); }
  else if (ev.type === 'gateOpen') {
    ring(230, PAL.anchor, 1.0, 4); ring(150, PAL.relay, 0.7);
    burst(30, PAL.anchor, 270, 0.8);
    shake = Math.max(shake, 12);
    punch = Math.max(punch, 0.9);
    popups.push({ screen: true, x: 0, y: 0, text: 'THE ANCHOR WAKES', life: 2.4, max: 2.4, color: PAL.anchor, size: 30 });
  }
  else if (ev.type === 'talk') ring(26, 'rgba(111,216,242,0.8)', 0.45, 2);
  else if (ev.type === 'crystal') { burst(13, PAL.lythAmber, 160, 0.55); burst(5, PAL.lythPale, 100, 0.4); shake = Math.max(shake, 2); }
  else if (ev.type === 'special') { burst(12, PAL.anchor, 180, 0.5); flashes.push({ x: ev.x, y: ev.y, life: 0.1, who: 'p' }); }
  else if (ev.type === 'dash') burst(8, ev.kind ? PAL.glitch : PAL.relay, 140, 0.3);
  else if (ev.type === 'wave') {
    // a nightwave pours in from one map edge: directional violet pulse + banner
    const dir = { n: 'NORTH', s: 'SOUTH', e: 'EAST', w: 'WEST' }[ev.edge] || '';
    edgePulses.push({ edge: ev.edge || 'n', life: 2.6, max: 2.6 });
    popups.push({
      screen: true, x: 0, y: 0,
      text: dir ? `NIGHTWAVE — ${dir}` : 'NIGHTWAVE',
      life: 2.6, max: 2.6, color: PAL.glitch, size: 28,
    });
    if (ev.x != null && ev.y != null) {
      ring(120, PAL.glitch, 0.9, 4);
      burst(18, PAL.glitch, 200, 0.6);
      burst(6, PAL.eye, 160, 0.35);
    }
    shake = Math.max(shake, 3);
  }
  // --- frontier survival / bastion / versus events ---
  else if (ev.type === 'playerHit') {
    // Hit FX at the spot for everyone, but only jolt the camera when it's MY
    // operator taking the hit — a teammate's hit shouldn't shake your screen.
    if (ev.x != null) { burst(ev.mine ? 6 : 4, PAL.red, 120, 0.35); ring(22, 'rgba(224,72,72,0.85)', 0.35, 2); }
    if (ev.mine) {
      shake = Math.max(shake, 2.2);   // just a tiny bit
      punch = Math.max(punch, 0.55);  // faint zoom-kick reads as "that hurt"
      // a brief, gentle red bleed from the screen edges — the non-shaky hurt cue
      for (const edge of ['n', 's', 'e', 'w']) edgePulses.push({ edge, life: 0.34, max: 0.34, rgb: '210,40,40', peak: 0.55 });
    }
  }
  else if (ev.type === 'crackerOut') {
    if (ev.x != null) {
      burst(5, '#caa46a', 70, 0.3);
      crackers.push({ x: ev.x, y: ev.y, life: 3.0, max: 3.0 });
    }
  }
  else if (ev.type === 'crackerBoom') {
    if (ev.x != null) {
      for (let i = crackers.length - 1; i >= 0; i--) {
        const c = crackers[i];
        if ((c.x - ev.x) ** 2 + (c.y - ev.y) ** 2 < (TILE * 2) ** 2) crackers.splice(i, 1);
      }
      burst(20, PAL.lythAmber, 230, 0.55); burst(10, PAL.ember, 150, 0.5);
      ring(TILE * 1.6, PAL.lythAmber, 0.5);
    }
    shake = Math.max(shake, 7);
  }
  else if (ev.type === 'volatile') {
    // a mutated body detonates in stolen warm light
    if (ev.x != null) { burst(14, PAL.lythAmber, 190, 0.5); burst(6, PAL.glitch, 120, 0.4); ring(TILE * 1.2, PAL.ember, 0.45); }
    shake = Math.max(shake, 4);
  }
  else if (ev.type === 'dusk') {
    popups.push({
      screen: true, x: 0, y: 0,
      text: ev.bloodMoon ? `BLOOD MOON — NIGHT ${ev.nightNo ?? ''}` : `NIGHT ${ev.nightNo ?? ''} FALLS`,
      life: 2.6, max: 2.6, color: ev.bloodMoon ? '#FF5A66' : PAL.glitch, size: 28,
    });
  }
  else if (ev.type === 'dawn') {
    popups.push({
      screen: true, x: 0, y: 0,
      text: `DAWN — NIGHT ${ev.nightNo ?? ''} SURVIVED`,
      life: 2.6, max: 2.6, color: PAL.lythGold, size: 26,
    });
  }
  else if (ev.type === 'bloodWarn') {
    popups.push({ screen: true, x: 0, y: 0, text: 'BLOOD MOON RISING', life: 3.4, max: 3.4, color: '#FF3D4D', size: 30 });
    for (const edge of ['n', 's', 'e', 'w']) edgePulses.push({ edge, life: 3.4, max: 3.4, rgb: '199,34,48' });
  }
  else if (ev.type === 'horn') {
    // the horn calls the night early: a gold shockwave off the horn post
    if (ev.x != null) { ring(140, PAL.lythGold, 1.0, 4); burst(16, PAL.lythGold, 180, 0.6); }
    popups.push({ screen: true, x: 0, y: 0, text: 'THE HORN SOUNDS', life: 2.6, max: 2.6, color: PAL.lythGold, size: 28 });
    shake = Math.max(shake, 3);
  }
  else if (ev.type === 'probe') {
    // a daytime scavenger pack noses in off one edge: a small, paler pulse
    edgePulses.push({ edge: ev.edge || 'n', life: 1.8, max: 1.8, rgb: '142,79,209' });
  }
  else if (ev.type === 'supplyDrop') {
    // the descending crate flare: a long streak falling out of the sky onto
    // the landing tile, then a landing ring + amber dust
    if (ev.x != null) {
      streaks.push({ x: ev.x + 120, y: ev.y - 560, tx: ev.x, ty: ev.y, life: 0.9, max: 0.9, rgb: '255,217,138' });
      ring(60, PAL.lythAmber, 0.9, 3);
      burst(14, PAL.lythAmber, 150, 0.6);
      flashes.push({ x: ev.x, y: ev.y, life: 0.1, who: 'p' });
    }
    popups.push({ screen: true, x: 0, y: 0, text: 'SUPPLY DROP INBOUND', life: 2.4, max: 2.4, color: PAL.lythAmber, size: 24 });
  }
  else if (ev.type === 'coreHit') {
    coreAlarmT = Math.max(coreAlarmT, 1.2);
    if (ev.x != null) burst(6, PAL.red, 110, 0.35);
    shake = Math.max(shake, 3);
  }
  else if (ev.type === 'coreDown') {
    coreAlarmT = Math.max(coreAlarmT, 4);
    if (ev.x != null) { burst(30, PAL.red, 260, 0.8); burst(14, PAL.ember, 180, 0.7); ring(180, PAL.red, 1.0, 4); }
    popups.push({ screen: true, x: 0, y: 0, text: 'THE CORE HAS FALLEN', life: 3, max: 3, color: PAL.red, size: 30 });
    shake = Math.max(shake, 14);
  }
  else if (ev.type === 'trample') { if (ev.x != null) burst(7, '#4E5A30', 90, 0.4); }
  else if (ev.type === 'repair') { if (ev.x != null) burst(4, PAL.teal, 70, 0.3); }
  else if (ev.type === 'buy') {
    const txt = `-${ev.cost ?? ''}◆ ${String(ev.what ?? '').toUpperCase()}`;
    if (ev.x != null) {
      burst(8, PAL.lythGold, 110, 0.5);
      popups.push({ x: ev.x, y: ev.y - 22, text: txt, life: 1, max: 1, color: PAL.lythGold });
    } else popups.push({ screen: true, x: 0, y: 0, text: txt, life: 1.4, max: 1.4, color: PAL.lythGold, size: 18 });
  }
  else if (ev.type === 'hired') {
    const txt = `${String(ev.name ?? '').toUpperCase()} HIRED — ${String(ev.job ?? '').toUpperCase()}`;
    if (ev.x != null) {
      burst(10, PAL.teal, 110, 0.5);
      popups.push({ x: ev.x, y: ev.y - 24, text: txt, life: 1.2, max: 1.2, color: PAL.teal });
    } else popups.push({ screen: true, x: 0, y: 0, text: txt, life: 1.6, max: 1.6, color: PAL.teal, size: 20 });
  }
  else if (ev.type === 'capture') {
    popups.push({ screen: true, x: 0, y: 0, text: 'FLAG CAPTURED', life: 2.2, max: 2.2, color: (ev.team ?? 0) % 2 ? '#FF6A5A' : PAL.relay, size: 30 });
    if (ev.x != null) { ring(90, PAL.anchor, 0.8); burst(20, (ev.team ?? 0) % 2 ? PAL.red : PAL.relay, 200, 0.6); }
    shake = Math.max(shake, 5);
  }
  else if (ev.type === 'flagTaken') {
    popups.push({ screen: true, x: 0, y: 0, text: 'FLAG TAKEN', life: 1.6, max: 1.6, color: (ev.team ?? 0) % 2 ? '#FF6A5A' : PAL.relay, size: 24 });
    if (ev.x != null) ring(40, (ev.team ?? 0) % 2 ? PAL.red : PAL.relay, 0.5);
  }
  else if (ev.type === 'flagReturn') {
    popups.push({ screen: true, x: 0, y: 0, text: 'FLAG RETURNED', life: 1.4, max: 1.4, color: PAL.teal, size: 22 });
    if (ev.x != null) ring(40, PAL.teal, 0.5);
  }
  else if (ev.type === 'eliminated') {
    popups.push({
      screen: true, x: 0, y: 0,
      text: ev.remaining != null ? `ELIMINATED — ${ev.remaining} REMAIN` : 'ELIMINATED',
      life: 2.2, max: 2.2, color: PAL.red, size: 26,
    });
    if (ev.x != null) burst(16, PAL.red, 180, 0.6);
  }
  else if (ev.type === 'matchEnd') {
    popups.push({ screen: true, x: 0, y: 0, text: 'MATCH OVER', life: 2.6, max: 2.6, color: PAL.anchor, size: 30 });
  }
  else if (ev.type === 'zoneShrink') {
    popups.push({ screen: true, x: 0, y: 0, text: 'THE ZONE CLOSES', life: 2, max: 2, color: PAL.relay, size: 24 });
  }
  else if (ev.type === 'chest') { if (ev.x != null) { burst(10, PAL.lythGold, 120, 0.5); ring(26, PAL.lythGold, 0.45, 2); } }
  else if (ev.type === 'heal') { if (ev.x != null) burst(8, '#5fd2b4', 90, 0.45); }
  else if (ev.type === 'mount' || ev.type === 'dismount') { if (ev.x != null) burst(6, PAL.steel, 80, 0.3); }
  // --- combat depth: xp, evolutions, tower types, followers ---
  else if (ev.type === 'levelUp') {
    if (ev.x != null) levelUpFX(ev.x, ev.y, ev.level);
    else if (ev.pid != null) pendingLevelUps.push({ pid: ev.pid, level: ev.level });
  }
  else if (ev.type === 'prismBeam') {
    if (ev.x != null && ev.tx != null) {
      beams.push({
        x: ev.x, y: ev.y, tx: ev.tx, ty: ev.ty, dmg: ev.dmg ?? 2,
        feeders: Array.isArray(ev.feeders) ? ev.feeders.slice(0, 4) : null,
        life: 0.22, max: 0.22,
      });
      burstAt(ev.tx, ev.ty, 6, PAL.anchor, 130, 0.3);
      burstAt(ev.tx, ev.ty, 3, PAL.relay, 90, 0.35);
    }
  }
  else if (ev.type === 'teslaZap') {
    if (ev.x != null) {
      const targets = Array.isArray(ev.targets) ? ev.targets.slice(0, 4) : [];
      zaps.push({ x: ev.x, y: ev.y, targets, life: 0.18, max: 0.18 });
      for (const tg of targets) burstAt(tg.x, tg.y, 4, PAL.eye, 130, 0.25);
      shake = Math.max(shake, 2);
    }
  }
  else if (ev.type === 'converted') {
    if (ev.x != null) {
      ring(30, PAL.relay, 0.6, 2);
      burst(10, PAL.relay, 130, 0.5);
      burst(4, PAL.eye, 170, 0.35);
      popups.push({ x: ev.x, y: ev.y - 22, text: 'CONVERTED', life: 1, max: 1, color: PAL.relay });
    }
  }
  else if (ev.type === 'toxin' || ev.type === 'toxinOut' || ev.type === 'toxinPatch'
    || (ev.type === 'patch' && ev.kind === 'toxin')) {
    // a toxin charge bursts: green splash; the lingering pool rides g.patches
    if (ev.x != null) { burst(12, '#8CC850', 130, 0.5); ring(ev.r ?? TILE * 1.2, 'rgba(150,210,90,0.8)', 0.45, 2); }
  }
  else if (ev.type === 'patch') {
    // a burning enemy falls and its fire pours onto the ground (L4 burn)
    if (ev.x != null) {
      burst(10, PAL.ember, 130, 0.5);
      burst(4, PAL.lythAmber, 90, 0.4);
      ring(ev.r ?? TILE * 1.2, 'rgba(240,169,60,0.8)', 0.45, 2);
    }
  }
  else if (ev.type === 'turretType') {
    // RA2 carousel confirm: the turret comes online wearing its type colors
    if (ev.x != null) {
      const col = { prism: PAL.relay, tesla: PAL.eye, toxin: '#8CC850' }[ev.ttype] || PAL.teal;
      ring(36, col, 0.5, 2.5);
      burst(10, col, 130, 0.45);
      popups.push({ x: ev.x, y: ev.y - 30, text: `${String(ev.ttype || 'gun').toUpperCase()} ONLINE`, life: 1, max: 1, color: col });
    }
  }
  else if (ev.type === 'bark' || ev.type === 'followerEngage') {
    if (ev.x != null) popups.push({ x: ev.x, y: ev.y - 18, text: '!', life: 0.5, max: 0.5, color: PAL.teal });
  }
  else if (ev.type === 'followerHit') { if (ev.x != null) burst(5, '#ffd9d2', 100, 0.3); }
  else if (ev.type === 'followerDown') { if (ev.x != null) { burst(8, PAL.teal, 130, 0.45); burst(4, PAL.steel, 90, 0.35); } }
  // --- frontier III: quests, puzzle systems, field weapons ---
  else if (ev.type === 'switch') {
    // a voice comes online (or resets off): clunk burst at the console
    if (ev.x != null) {
      const col = ev.on === false ? PAL.steel : PAL.lythGold;
      burst(8, col, 110, 0.45);
      ring(26, col, 0.45, 2);
    }
  }
  else if (ev.type === 'glyph' || ev.type === 'glyphLit') {
    if (ev.x != null) { burst(9, PAL.lythGold, 120, 0.5); ring(30, PAL.lythGold, 0.5, 2); }
  }
  else if (ev.type === 'glyphReset') {
    // wrong rune: the ring spins back with a cough of drift-static
    if (ev.x != null) { burst(12, PAL.glitch, 140, 0.5); burst(4, PAL.steel, 90, 0.35); ring(42, PAL.glitch, 0.5, 2); }
    popups.push({ screen: true, x: 0, y: 0, text: 'THE RING SPINS BACK', life: 1.6, max: 1.6, color: PAL.glitch, size: 20 });
  }
  else if (ev.type === 'pillarDown') {
    // a Colonnade pillar falls into curve-segment rubble
    if (ev.x != null) {
      burst(18, PAL.steel, 200, 0.6);
      burst(10, PAL.glitch, 150, 0.5);
      ring(60, PAL.steel, 0.6, 3);
      popups.push({ x: ev.x, y: ev.y - 30, text: 'LET IT REST', life: 1.4, max: 1.4, color: PAL.coldHi });
    }
    shake = Math.max(shake, 7);
  }
  else if (ev.type === 'sealForged') {
    // the Combining: one unbroken hammer-line settles checkpoint gold
    if (ev.x != null) {
      ring(70, PAL.lythGold, 0.9, 3);
      burst(22, PAL.lythGold, 200, 0.7);
      burst(8, PAL.lythPale, 260, 0.5);
    }
    popups.push({ screen: true, x: 0, y: 0, text: 'LYTHSEAL FORGED', life: 2.4, max: 2.4, color: PAL.lythGold, size: 28 });
    shake = Math.max(shake, 4);
  }
  else if (ev.type === 'doorOpen') {
    if (ev.x != null) { burst(10, PAL.steel, 120, 0.45); ring(34, PAL.relay, 0.5, 2); }
  }
  else if (ev.type === 'teleport') {
    // the world agrees you've moved: gold-cyan blink at both pads
    if (ev.x != null) {
      burst(10, PAL.relay, 150, 0.4);
      ring(22, PAL.anchor, 0.4, 2);
      if (ev.tx != null) {
        streaks.push({ x: ev.x, y: ev.y, tx: ev.tx, ty: ev.ty, life: 0.3, max: 0.3, rgb: '111,216,242' });
        burstAt(ev.tx, ev.ty, 10, PAL.relay, 150, 0.4);
      }
    }
  }
  else if (ev.type === 'beacon') {
    // a save beacon settles: progress held past failure
    if (ev.x != null) { ring(60, PAL.lythGold, 0.8, 2.5); burst(12, PAL.lythGold, 140, 0.55); }
    popups.push({ screen: true, x: 0, y: 0, text: 'BEACON SETTLED — PROGRESS HELD', life: 2.2, max: 2.2, color: PAL.lythGold, size: 20 });
  }
  else if (ev.type === 'quest') {
    // objective toasts live in the client panel; a soft ring at the giver
    if (ev.x != null) ring(28, PAL.lythGold, 0.5, 2);
  }
  else if (ev.type === 'fieldEmpty') {
    // the field weapon runs dry and evaporates
    if (ev.x != null) {
      burst(5, PAL.steel, 70, 0.3);
      popups.push({ x: ev.x, y: ev.y - 20, text: 'EMPTY', life: 0.8, max: 0.8, color: '#8A98B8' });
    }
  }
  else if (ev.type === 'fieldPickup' || ev.type === 'pickupWeapon' || ev.type === 'weaponPickup') {
    if (ev.x != null) {
      burst(9, PAL.lythGold, 110, 0.45);
      popups.push({ x: ev.x, y: ev.y - 20, text: String(ev.kind ?? 'WEAPON').toUpperCase(), life: 0.9, max: 0.9, color: PAL.lythGold });
    }
  }
  else if (ev.type === 'fieldDrop' || ev.type === 'dropWeapon') { if (ev.x != null) burst(5, PAL.steel, 80, 0.3); }
  else if (ev.type === 'qitem' || ev.type === 'questItem') {
    if (ev.x != null) { burst(8, PAL.lythGold, 100, 0.45); ring(20, PAL.lythGold, 0.4, 2); }
  }
  else if (ev.type === 'shielded' || ev.type === 'enemyShield') {
    // a Null Acolyte wraps a ward in one absorb charge
    if (ev.x != null) ring(20, PAL.glitch, 0.4, 2);
  }
  else if (ev.type === 'blink') {
    // phase stalker blink: violet streak between the two footprints
    if (ev.x != null) {
      burst(8, PAL.glitch, 140, 0.35);
      if (ev.tx != null) streaks.push({ x: ev.x, y: ev.y, tx: ev.tx, ty: ev.ty, life: 0.22, max: 0.22, rgb: '142,79,209' });
    }
  }
  else if (ev.type === 'zap' || ev.type === 'chainZap' || ev.type === 'voltZap') {
    // volt wraith chain-zap on a player (zaps draw from y-27, so offset back)
    if (ev.x != null) {
      zaps.push({ x: ev.x, y: ev.y + 27, targets: [{ x: ev.tx ?? ev.x, y: ev.ty ?? ev.y }], life: 0.18, max: 0.18 });
    }
  }
  else if (ev.type === 'shockArc') {
    // a stormgun round (or L4 arc) leaps to the next enemy
    if (ev.x != null && ev.tx != null) {
      zaps.push({ x: ev.x, y: ev.y + 27, targets: [{ x: ev.tx, y: ev.ty }], life: 0.16, max: 0.16 });
      burstAt(ev.tx, ev.ty, 4, PAL.eye, 120, 0.25);
    }
  }
  else if (ev.type === 'shieldPop') {
    // an acolyte ward shatters: violet shards, the absorb is spent
    if (ev.x != null) { burst(9, PAL.glitch, 150, 0.4); ring(22, PAL.glitch, 0.35, 2); }
  }
  else if (ev.type === 'pyreBurst') {
    // a pyre beetle goes up: warm pop + the burn patch rides g.patches
    if (ev.x != null) {
      burst(14, PAL.lythAmber, 190, 0.5);
      burst(6, PAL.ember, 130, 0.45);
      ring(ev.radius ?? TILE * 1.2, PAL.ember, 0.45, 2.5);
    }
    shake = Math.max(shake, 4);
  }
  else if (ev.type === 'questProgress') {
    // the ledger ticks over: small gold count at the deed
    if (ev.x) {
      popups.push({
        x: ev.x, y: ev.y - 24,
        text: `${ev.progress ?? ''}/${ev.count ?? ''}`,
        life: 0.9, max: 0.9, color: PAL.lythGold,
      });
    }
  }
  else if (ev.type === 'harvest') {
    if (ev.x != null) { burst(8, '#8CC850', 100, 0.45); burst(4, PAL.lythGold, 80, 0.4); }
  }
  else if (ev.type === 'slotFull') {
    if (ev.x != null) popups.push({ x: ev.x, y: ev.y - 24, text: 'FULL', life: 0.7, max: 0.7, color: '#8A98B8' });
  }
  else if (ev.type === 'restock') {
    if (ev.x != null) { burst(7, PAL.teal, 90, 0.4); ring(20, PAL.teal, 0.4, 2); }
  }
  else if (ev.type === 'shieldUp') {
    if (ev.x != null) ring(24, PAL.relay, 0.5, 2);
  }
  else if (ev.type === 'aim') {
    // a ranged telegraph with a known mark: faint warning thread
    if (ev.x != null && ev.tx != null) {
      streaks.push({ x: ev.x, y: ev.y, tx: ev.tx, ty: ev.ty, life: 0.25, max: 0.5, rgb: '142,79,209' });
    }
  }
  // --- stronghold: beacon-defense variant + early extraction ---
  else if (ev.type === 'beaconDown') {
    coreAlarmT = Math.max(coreAlarmT, 3);
    if (ev.x != null) { burst(22, PAL.red, 220, 0.7); burst(10, PAL.glitch, 150, 0.6); ring(110, PAL.red, 0.8, 3.5); }
    popups.push({ screen: true, x: 0, y: 0, text: 'A BEACON GOES DARK', life: 2.6, max: 2.6, color: PAL.red, size: 28 });
    shake = Math.max(shake, 9);
  }
  else if (ev.type === 'beaconLit' || ev.type === 'beaconRelit') {
    if (ev.x != null) { ring(70, PAL.lythGold, 0.8, 3); burst(16, PAL.lythGold, 160, 0.6); burst(6, PAL.lythPale, 220, 0.4); }
    popups.push({ screen: true, x: 0, y: 0, text: 'BEACON RELIT', life: 2.2, max: 2.2, color: PAL.lythGold, size: 26 });
  }
  else if (ev.type === 'shipDown') {
    if (ev.x != null) { ring(160, PAL.relay, 1.1, 4); ring(90, PAL.anchor, 0.8, 3); burst(26, PAL.anchor, 240, 0.8); }
    popups.push({ screen: true, x: 0, y: 0, text: 'THE ANCHORCRAFT DESCENDS — ALL ABOARD', life: 3.2, max: 3.2, color: PAL.anchor, size: 26 });
    shake = Math.max(shake, 10);
  }
  else if (ev.type === 'shipLaunch') {
    if (ev.x != null) { ring(200, PAL.anchor, 1.2, 4.5); burst(32, PAL.anchor, 280, 0.9); burst(12, PAL.lythGold, 200, 0.7); }
    popups.push({ screen: true, x: 0, y: 0, text: 'ANCHORCRAFT AWAY — FULL CLEAR', life: 3.2, max: 3.2, color: PAL.lythGold, size: 30 });
    shake = Math.max(shake, 12);
  }
  else if (ev.type === 'aboard') {
    if (ev.x != null) { burst(8, PAL.relay, 110, 0.4); popups.push({ x: ev.x, y: ev.y - 24, text: 'ABOARD', life: 0.9, max: 0.9, color: PAL.relay }); }
  }
  // unknown event types are ignored gracefully
}

// ============================== POSE / WALK CYCLE ==============================
// Module-level memory of previous positions: walk cycles are driven purely by
// how far an entity actually moved (works for local sim AND net snapshots).
// Splitscreen: each viewport advances its own namespaced ledger ('p3' drawn
// in two cells = two independent states), so multi-pass frames can't double-
// step or decay anyone's stride. '' = the shared single camera (today's keys).
const pose = new Map();
let poseNs = '';
function poseFor(key, x, y, dt) {
  if (!key) return { ph: 0, amp: 0, fx: 0, fy: 1 };
  if (poseNs) key = poseNs + key;
  if (pose.size > 900) pose.clear(); // long expeditions: ids keep growing
  let st = pose.get(key);
  if (!st) { st = { x, y, ph: 0, sp: 0, fx: 0, fy: 1 }; pose.set(key, st); }
  const d = Math.hypot(x - st.x, y - st.y);
  const v = dt > 0 ? Math.min(400, d / dt) : 0;
  st.sp += (v - st.sp) * 0.25;
  st.ph += d * 0.22;
  if (d > 0.4) { st.fx = (x - st.x) / d; st.fy = (y - st.y) / d; } // movement facing
  st.x = x; st.y = y;
  return { ph: st.ph, amp: Math.max(0, Math.min(1, st.sp / 70)), fx: st.fx, fy: st.fy };
}

// Standard Moonsteel rim light, cast from the upper-left, screen-fixed.
function rimArc(ctx, x, y, r, alpha = 0.5, lw = 1.5) {
  ctx.save();
  ctx.strokeStyle = PAL.moonsteel;
  ctx.globalAlpha *= alpha;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(x, y, r, -2.75, -1.15);
  ctx.stroke();
  ctx.restore();
}

function shadowBlob(ctx, x, y, rx, ry) {
  ctx.fillStyle = 'rgba(11,10,20,0.5)';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

// Held weapon silhouettes in rotated space (facing = -y), gunmetal.
function drawHeldWeapon(ctx, cls) {
  const gm = PAL.graphPlate, dk = PAL.graphDark, hi = PAL.moonsteel;
  ctx.save();
  if (cls === 'long') {
    // the longest line on screen: barrel reaches half a body past the silhouette
    ctx.fillStyle = dk; ctx.fillRect(4, -31, 3, 27);
    ctx.fillStyle = gm; ctx.fillRect(3.2, -16, 4.6, 10);
    ctx.fillStyle = hi; ctx.fillRect(4, -31, 1, 27);
    ctx.fillStyle = PAL.coldHi; ctx.fillRect(3.6, -21, 1.8, 1.8); // scope glint
  } else if (cls === 'shotgun') {
    ctx.fillStyle = dk; ctx.fillRect(3, -19, 5.6, 15);
    ctx.fillStyle = gm; ctx.fillRect(2.2, -12, 7.4, 7); // drum
    ctx.fillStyle = hi; ctx.fillRect(3, -19, 1.4, 15);
    ctx.fillStyle = PAL.relay; ctx.fillRect(4.4, -20.4, 2.6, 1.6);
  } else if (cls === 'tube') {
    // shoulder-mounted tube angled up-back, warm rear cap
    ctx.rotate(0.2);
    ctx.fillStyle = dk; ctx.fillRect(2, -20, 6.5, 30);
    ctx.fillStyle = gm; ctx.fillRect(2, -20, 6.5, 8);
    ctx.fillStyle = hi; ctx.fillRect(2, -20, 1.5, 30);
    ctx.fillStyle = PAL.lythAmber;
    ctx.shadowColor = PAL.lythAmber; ctx.shadowBlur = 5;
    ctx.fillRect(2.6, 8.4, 5.4, 2.4);
    ctx.shadowBlur = 0;
  } else if (cls === 'blades') {
    for (const sx of [-8, 8]) {
      ctx.fillStyle = dk; ctx.fillRect(sx - 1.2, -16, 2.4, 11);
      ctx.fillStyle = PAL.anchor;
      ctx.shadowColor = PAL.relay; ctx.shadowBlur = 4;
      ctx.fillRect(sx - 0.6, -17, 1.2, 12);
      ctx.shadowBlur = 0;
    }
  } else if (cls === 'thrower') {
    // boxy emitter held low with two hands; warm = utility
    ctx.fillStyle = dk; ctx.fillRect(1.5, -14, 8, 10);
    ctx.fillStyle = gm; ctx.fillRect(1.5, -14, 8, 4);
    ctx.fillStyle = PAL.lythGold;
    ctx.shadowColor = PAL.lythGold; ctx.shadowBlur = 6;
    ctx.fillRect(3.5, -16.6, 4, 2.6);
    ctx.shadowBlur = 0;
  } else if (cls === 'arc') {
    ctx.fillStyle = dk; ctx.fillRect(4, -12, 3.4, 8);
    ctx.strokeStyle = PAL.relay;
    ctx.shadowColor = PAL.relay; ctx.shadowBlur = 5;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(5.6, -15.5, 4.4, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
  } else if (cls === 'spear') {
    // harpoon held at the shoulder: the longest thin line after the rail
    ctx.fillStyle = '#4A4232'; ctx.fillRect(4.4, -26, 2.2, 30); // shaft
    ctx.fillStyle = hi; ctx.fillRect(4.4, -26, 0.9, 30);
    ctx.fillStyle = PAL.anchor; // barbed head
    ctx.shadowColor = PAL.relay; ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(5.5, -31); ctx.lineTo(3.2, -25); ctx.lineTo(5.5, -26.6); ctx.lineTo(7.8, -25);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(111,216,242,0.6)'; ctx.lineWidth = 1; // line coil at hip
    ctx.beginPath(); ctx.arc(7.4, 2.5, 2.6, 0, Math.PI * 2); ctx.stroke();
  } else { // smg / compact carbine
    ctx.fillStyle = dk; ctx.fillRect(3.6, -18, 3.6, 13);
    ctx.fillStyle = gm; ctx.fillRect(2.8, -11, 5, 6);
    ctx.fillStyle = dk; ctx.fillRect(4.4, -7.5, 2.4, 4.5);
    ctx.fillStyle = hi; ctx.fillRect(3.6, -18, 1, 13);
    ctx.fillStyle = PAL.relay; ctx.fillRect(4.4, -19.3, 2, 1.4);
  }
  ctx.restore();
}

// ============================== OPERATORS ==============================
// Monolythium frontier operators: graphite plate over dark underlayer, boxy
// backpack rig, relay-cyan visor, char-color energy trim, teal squad markings.
function drawSoldier(ctx, x, y, fx, fy, color, t, isMe, invuln, opts = {}) {
  const ang = Math.atan2(fy, fx);
  const { ph, amp } = poseFor(opts.key, x, y, opts.dt || 0.016);
  const swim = !!opts.swim; // half-submerged crawl: the Selkie crossing water
  if (swim) y += Math.sin(t * 2.3 + x * 0.05) * 1.2; // gentle bob on the swell
  ctx.save();
  // compose with the caller's alpha (sleeping enemies arrive dimmed)
  const base = ctx.globalAlpha;
  const blink = invuln > 0 ? 0.5 + 0.3 * Math.sin(t * 16) : 1;
  ctx.globalAlpha = base * blink;
  if (!swim) shadowBlob(ctx, x, y + 11, 12, 5); // no ground shadow on water
  // focus ring
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha *= (isMe ? 0.95 : 0.5) * (swim ? 0.6 : 1);
  ctx.lineWidth = isMe ? 2.5 : 1.2;
  ctx.shadowColor = color;
  ctx.shadowBlur = isMe ? 10 : 4;
  ctx.beginPath();
  ctx.ellipse(x, y + 9, 16, 7.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  ctx.translate(x, y);
  ctx.rotate(ang + Math.PI / 2);
  if (!swim) {
    // animated boots (walk cycle from position deltas)
    const lo = Math.sin(ph) * 4 * amp;
    ctx.fillStyle = '#232533';
    ctx.fillRect(-6.5, -2 + lo, 5, 7);
    ctx.fillRect(1.5, -2 - lo, 5, 7);
    ctx.fillStyle = PAL.teal; // squad boot caps
    ctx.fillRect(-6.5, 3.6 + lo, 5, 1.5);
    ctx.fillRect(1.5, 3.6 - lo, 5, 1.5);
    // backpack rig with char-color stripe
    ctx.fillStyle = PAL.graphDark;
    ctx.fillRect(-6, 4.5, 12, 7.5);
    ctx.fillStyle = color;
    ctx.fillRect(-1.2, 5, 2.4, 6.5);
  } else {
    // kick splash where the boots would be
    const ko = Math.sin(ph * 1.3) * 3 * Math.max(0.25, amp);
    ctx.fillStyle = 'rgba(191,208,232,0.35)';
    ctx.fillRect(-5 + ko, 8, 3.5, 2);
    ctx.fillRect(2 - ko, 9, 3.5, 2);
  }
  // torso: dark underlayer + graphite plate
  ctx.fillStyle = '#232533';
  ctx.beginPath(); ctx.ellipse(0, 0, 10, 11.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PAL.graphMid;
  ctx.beginPath(); ctx.ellipse(0, -0.5, 8.5, 9.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PAL.graphDark;
  ctx.fillRect(-8, -0.5, 16, 1); // chest panel line
  // shoulders
  ctx.fillStyle = PAL.graphPlate;
  ctx.beginPath(); ctx.arc(-8, -1, 4.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(8, -1, 4.2, 0, Math.PI * 2); ctx.fill();
  // char-color energy trim: two thin lines across the shoulders
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.shadowColor = color;
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.moveTo(-10.5, -1.5); ctx.lineTo(-4, -3.4);
  ctx.moveTo(4, -3.4); ctx.lineTo(10.5, -1.5);
  ctx.stroke();
  ctx.shadowBlur = 0;
  // teal belt
  ctx.fillStyle = PAL.teal;
  ctx.fillRect(-5, 3, 10, 1.5);
  // held weapon silhouette
  drawHeldWeapon(ctx, weaponClass(opts.weapon));
  // helmet dome
  ctx.fillStyle = '#3A4050';
  ctx.beginPath(); ctx.arc(0, -3, 5.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(11,10,20,0.45)';
  ctx.beginPath(); ctx.arc(0, -3, 5.6, Math.PI * 0.15, Math.PI * 0.85); ctx.fill();
  // relay-cyan visor slit at the facing edge
  ctx.fillStyle = PAL.relay;
  ctx.shadowColor = PAL.relay;
  ctx.shadowBlur = 5;
  ctx.fillRect(-3, -7.6, 6, 1.8);
  ctx.shadowBlur = 0;
  // char-color crown dot
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 4;
  ctx.beginPath(); ctx.arc(0, -1.4, 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  if (swim) {
    // cold water swallows the trailing half of the body; foam at the line
    ctx.fillStyle = 'rgba(16,26,46,0.78)';
    ctx.fillRect(-13, 3, 26, 12);
    ctx.fillStyle = 'rgba(191,208,232,0.35)';
    ctx.fillRect(-11, 3, 22, 1.4);
  }
  ctx.rotate(-(ang + Math.PI / 2));
  // screen-fixed Moonsteel rim light from the upper-left
  rimArc(ctx, 0, -1, 9.5);
  ctx.restore();
}

// Ripple wake peeling off a swimmer; drawn under the operator.
function drawSwimWake(ctx, p, t) {
  ctx.save();
  const base = ctx.globalAlpha;
  ctx.strokeStyle = 'rgba(94,107,140,0.55)';
  ctx.lineWidth = 1.4;
  const ba = Math.atan2(-p.fy, -p.fx); // arcs open behind the swimmer
  for (let i = 0; i < 3; i++) {
    const pr = fract(t * 0.7 + i / 3 + (p.x + p.y) * 0.003);
    ctx.globalAlpha = base * (1 - pr * 0.6);
    ctx.beginPath();
    ctx.arc(p.x - p.fx * 5, p.y - p.fy * 5, 8 + pr * 15, ba - 0.75, ba + 0.75);
    ctx.stroke();
  }
  // stray foam flecks
  ctx.fillStyle = 'rgba(191,208,232,0.4)';
  for (let i = 0; i < 2; i++) {
    const pr = fract(t * 0.9 + i * 0.5 + p.x * 0.01);
    ctx.globalAlpha = base * (1 - pr);
    ctx.fillRect(p.x - p.fx * (12 + pr * 16) + (flick(i * 7.7 + Math.floor(t)) - 0.5) * 8,
      p.y - p.fy * (12 + pr * 16) + (flick(i * 3.1 + Math.floor(t)) - 0.5) * 8, 1.6, 1.6);
  }
  ctx.restore();
}

// Downed operator: slumped on the ground, faint life-sign visor pulse.
function drawCaptive(ctx, c, color, t) {
  const { x, y } = c;
  ctx.save();
  shadowBlob(ctx, x, y + 8, 13, 5);
  ctx.globalAlpha *= 0.92;
  ctx.translate(x, y + 4);
  ctx.rotate(0.85);
  // body lying on its side
  ctx.fillStyle = '#232533';
  ctx.beginPath(); ctx.ellipse(0, 0, 11, 6.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PAL.graphMid;
  ctx.beginPath(); ctx.ellipse(-1, -0.5, 9, 5, 0, 0, Math.PI * 2); ctx.fill();
  // char-color trim hint on the chest
  ctx.strokeStyle = color;
  ctx.globalAlpha *= 0.8;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-6, -2); ctx.lineTo(2, -3); ctx.stroke();
  ctx.globalAlpha /= 0.8;
  // helmet rolled to the side
  ctx.fillStyle = '#3A4050';
  ctx.beginPath(); ctx.arc(10, -2, 5, 0, Math.PI * 2); ctx.fill();
  const ls = 0.3 + 0.25 * Math.sin(t * 3 + x * 0.1);
  ctx.fillStyle = `rgba(111,216,242,${ls})`;
  ctx.fillRect(7.4, -3.4, 5, 1.6);
  ctx.restore();
  rimArc(ctx, x, y + 2, 10, 0.35);
}

// ============================== THE ENTROPY ==============================
// Purple-black glitch bodies, one cyan-white eye each, era-debris skins.
const KIND_R = { grunt: 13, archer: 10, charger: 16, bulwark: 13, spawner: 13, sniper: 9, skitter: 7, boss: 26 };
// RELIC AWAKENING nightmares (relic event only) — draw/glow radii.
Object.assign(KIND_R, { spider: 8, ghost: 13, reaper: 16, skeleton: 10, zombie: 11, hellhound: 12, banshee: 12 });

// Frontier III kinds (letters z f q v x u) may ship under a few names while
// the sim wave lands; normalize for drawing and register their radii.
const KIND_ALIAS = {
  z: 'husk', husk: 'husk',
  f: 'forkalpha', fork: 'forkalpha', forkalpha: 'forkalpha', forkAlpha: 'forkalpha', alpha: 'forkalpha',
  q: 'acolyte', acolyte: 'acolyte', nullacolyte: 'acolyte', nullAcolyte: 'acolyte',
  v: 'voltwraith', volt: 'voltwraith', wraith: 'voltwraith', voltwraith: 'voltwraith', voltWraith: 'voltwraith',
  x: 'phasestalker', phase: 'phasestalker', stalker: 'phasestalker', phasestalker: 'phasestalker', phaseStalker: 'phasestalker',
  u: 'pyrebeetle', pyre: 'pyrebeetle', beetle: 'pyrebeetle', pyrebeetle: 'pyrebeetle', pyreBeetle: 'pyrebeetle',
};
const KIND_R_NEW = { husk: 10, forkalpha: 13, acolyte: 11, voltwraith: 11, phasestalker: 12, pyrebeetle: 11 };
for (const [k, canon] of Object.entries(KIND_ALIAS)) KIND_R[k] = KIND_R_NEW[canon];

function drawEye(ctx, x, y, r, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.shadowColor = PAL.relay;
  // on dark missions the eyes are the brightest thing in the night
  ctx.shadowBlur = darkWorld ? 11 : 6;
  ctx.fillStyle = PAL.eye;
  ctx.beginPath();
  ctx.arc(x, y, darkWorld ? r * 1.25 : r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// --- RELIC AWAKENING nightmares: glowing dread eyes + motion trail -----------
// A pair of burning eyes (red by default, violet for the ghost) with a strong
// bloom, sized up so they read through the event's darkness like the night
// hunters' eyes. Used by the nightmare drawEnemy branches below.
function drawDreadEyes(ctx, e, ahead = 7, r = 2.2, rgb = '255,60,60', spread = 3.2) {
  const fx = e.fx || 1, fy = e.fy || 0;
  const px = -fy, py = fx; // perpendicular for the two-eye spacing
  const cx = e.x + fx * ahead, cy = e.y + fy * ahead;
  ctx.save();
  ctx.shadowColor = `rgb(${rgb})`;
  ctx.shadowBlur = 12;
  ctx.fillStyle = `rgb(${rgb})`;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + px * spread * s, cy + py * spread * s, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
// A short violet/grey wake dragged opposite the heading — every nightmare leaves
// a brief motion trail so the swarm reads as fast and unnatural.
function drawNightmareTrail(ctx, e, len = 14, rgb = '90,46,140') {
  const fx = e.fx || 0, fy = e.fy || 1;
  ctx.save();
  const tg = ctx.createLinearGradient(e.x, e.y, e.x - fx * len, e.y - fy * len);
  tg.addColorStop(0, `rgba(${rgb},0.35)`);
  tg.addColorStop(1, `rgba(${rgb},0)`);
  ctx.strokeStyle = tg;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(e.x, e.y);
  ctx.lineTo(e.x - fx * len, e.y - fy * len);
  ctx.stroke();
  ctx.restore();
}

// --- Family Mode monster softeners (visual only; gated by the caller) ---
// A round pastel cushion drawn UNDER the normal monster art: it rounds the
// spiky silhouette and washes the whole shape toward a cuddly pastel.
function drawFamilyMonsterBase(ctx, e, t) {
  const r = KIND_R[e.kind] || 13; // caller already applies the ~1.3x family scale
  const bob = Math.sin(t * 2 + e.id * 1.3) * 1.2; // gentle idle breathing
  ctx.save();
  // soft outer glow halo
  const hg = ctx.createRadialGradient(e.x, e.y + bob, r * 0.3, e.x, e.y + bob, r * 1.55);
  hg.addColorStop(0, 'rgba(255,255,255,0.30)');
  hg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.arc(e.x, e.y + bob, r * 1.55, 0, Math.PI * 2);
  ctx.fill();
  // rounded pastel cushion body
  ctx.fillStyle = FAM.monPastel;
  ctx.beginPath();
  ctx.ellipse(e.x, e.y + bob, r * 1.12, r * 1.18, 0, 0, Math.PI * 2);
  ctx.fill();
  // soft blush belly
  ctx.fillStyle = FAM.monBlush;
  ctx.beginPath();
  ctx.ellipse(e.x, e.y + bob + r * 0.35, r * 0.62, r * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Big friendly eyes + a little smile drawn OVER the body, facing the enemy's
// heading so the cuddly face leads its movement.
function drawFamilyMonsterFace(ctx, e, t) {
  const r = KIND_R[e.kind] || 13; // caller already applies the ~1.3x family scale
  const bob = Math.sin(t * 2 + e.id * 1.3) * 1.2;
  const fx = e.fx || 1, fy = e.fy || 0;
  const fl = Math.hypot(fx, fy) || 1;
  const dx = fx / fl, dy = fy / fl;
  const cx = e.x + dx * r * 0.35;
  const cy = e.y + bob + dy * r * 0.35 - r * 0.15;
  // eye spacing perpendicular to heading
  const px = -dy, py = dx;
  const sp = r * 0.42, er = Math.max(2.4, r * 0.32);
  const blink = (fract(t * 0.5 + e.id * 0.21) > 0.94) ? 0.18 : 1; // occasional blink
  ctx.save();
  for (const s of [-1, 1]) {
    const ex = cx + px * sp * s, ey = cy + py * sp * s;
    // white of the eye
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.ellipse(ex, ey, er, er * blink, 0, 0, Math.PI * 2);
    ctx.fill();
    // big soft pupil looking forward
    ctx.fillStyle = FAM.monEye;
    ctx.beginPath();
    ctx.ellipse(ex + dx * er * 0.35, ey + dy * er * 0.35, er * 0.55, er * 0.55 * blink, 0, 0, Math.PI * 2);
    ctx.fill();
    // sparkle
    if (blink > 0.5) {
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.arc(ex - er * 0.2, ey - er * 0.25, er * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // little smile below the eyes
  ctx.strokeStyle = 'rgba(90,60,80,0.7)';
  ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.lineCap = 'round';
  ctx.beginPath();
  const mx = cx + dx * r * 0.5, my = cy + dy * r * 0.5 + r * 0.55;
  ctx.arc(mx, my, r * 0.28, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

function drawEnemy(ctx, e, t, dt) {
  const a = Math.atan2(e.fy, e.fx);
  const { ph } = poseFor('e' + e.id, e.x, e.y, dt);
  const kind = KIND_ALIAS[e.kind] || e.kind; // frontier III aliases

  if (e.kind === 'grunt') {
    // ENTROPY CRAWLER — low six-limbed tick of static, wider than tall
    shadowBlob(ctx, e.x, e.y + 7, 13, 5);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(a + Math.PI / 2);
    for (let i = -1; i <= 1; i++) {
      const sway = Math.sin(ph + i * 1.7) * 3;
      // stuttering ghost copies of the legs
      ctx.strokeStyle = 'rgba(142,79,209,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-6, i * 5); ctx.lineTo(-12.5 + 1.5, i * 5 + sway + 1);
      ctx.moveTo(6, i * 5); ctx.lineTo(12.5 + 1.5, i * 5 - sway + 1);
      ctx.stroke();
      ctx.strokeStyle = '#241433';
      ctx.beginPath();
      ctx.moveTo(-6, i * 5); ctx.lineTo(-12.5, i * 5 + sway);
      ctx.moveTo(6, i * 5); ctx.lineTo(12.5, i * 5 - sway);
      ctx.stroke();
    }
    ctx.fillStyle = PAL.entBlack;
    ctx.beginPath(); ctx.ellipse(0, 0, 11.5, 8.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2A1638';
    ctx.beginPath(); ctx.moveTo(-7, 4); ctx.lineTo(0, -6); ctx.lineTo(7, 4); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = PAL.entViolet;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-8, -2); ctx.lineTo(-3, 1); ctx.lineTo(-5, 5);
    ctx.moveTo(8, -1); ctx.lineTo(3, 2);
    ctx.stroke();
    ctx.fillStyle = '#5A4A42'; // rusted-iron era flake
    ctx.fillRect(1, 3, 3.5, 2.5);
    ctx.restore();
    drawEye(ctx, e.x + e.fx * 7, e.y + e.fy * 7, 2.2);
    return;
  }

  if (e.kind === 'archer') {
    // NULL PRIEST — tall hooded hover, hem dissolving into violet motes
    const bob = Math.sin(t * 2 + e.id) * 1.5;
    ctx.save();
    ctx.globalAlpha *= 0.7;
    shadowBlob(ctx, e.x, e.y + 10, 8, 3);
    ctx.restore();
    ctx.save();
    ctx.translate(e.x, e.y + bob);
    ctx.fillStyle = '#1A0E26';
    ctx.beginPath();
    ctx.moveTo(0, -17);
    ctx.quadraticCurveTo(8, -8, 8.5, 8);
    ctx.lineTo(-8.5, 8);
    ctx.quadraticCurveTo(-8, -8, 0, -17);
    ctx.fill();
    ctx.strokeStyle = '#3A2347';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-3, -9); ctx.lineTo(-4, 7);
    ctx.moveTo(3, -9); ctx.lineTo(4, 7);
    ctx.stroke();
    // hem dissolving into falling particles
    ctx.fillStyle = PAL.entViolet;
    for (let i = 0; i < 3; i++) {
      const pr = fract(t * 0.8 + i * 0.37 + e.id * 0.13);
      ctx.globalAlpha = (1 - pr) * 0.8;
      ctx.fillRect(-6 + i * 5 + Math.sin(t + i) * 1.5, 8 + pr * 8, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;
    // corroded bronze collar — era hint
    ctx.fillStyle = '#6E5A3A';
    ctx.fillRect(-4, -8.5, 8, 1.6);
    // crooked stave with null orb
    ctx.strokeStyle = '#3A2347';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(7, 6); ctx.lineTo(10, -8); ctx.lineTo(11.5, -13);
    ctx.stroke();
    ctx.fillStyle = '#6E5A3A';
    ctx.fillRect(9, -9.5, 3.5, 1.4);
    ctx.fillStyle = PAL.voidNight;
    ctx.beginPath(); ctx.arc(11.5, -15.5, 3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = PAL.glitch;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // hood + vertical slit-eye
    ctx.fillStyle = '#1A0E26';
    ctx.beginPath(); ctx.arc(0, -12, 5.2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3A2347';
    ctx.stroke();
    ctx.save();
    ctx.shadowColor = PAL.relay;
    ctx.shadowBlur = 6;
    ctx.fillStyle = PAL.eye;
    ctx.fillRect(-0.8, -15, 1.6, 5);
    ctx.restore();
    ctx.restore();
    return;
  }

  if (e.kind === 'charger') {
    // RIFT BRUTE — front-loaded wedge; seam flare IS the charge telegraph
    const flare = e.state === 'windup' ? 0.5 + 0.5 * Math.sin(t * 30) : 0;
    shadowBlob(ctx, e.x, e.y + 9, 16, 6);
    if (e.state === 'dash') {
      // glitch-dust wake
      for (let i = 1; i <= 2; i++) {
        ctx.save();
        ctx.globalAlpha *= 0.28 / i;
        ctx.fillStyle = PAL.glitch;
        ctx.beginPath();
        ctx.ellipse(e.x - e.fx * 10 * i, e.y - e.fy * 10 * i, 12, 9, a, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = PAL.entBlack;
    ctx.beginPath(); ctx.ellipse(0, 7, 8, 6, 0, 0, Math.PI * 2); ctx.fill(); // vestigial rear
    ctx.beginPath();
    ctx.moveTo(-14, 3); ctx.lineTo(14, 3); ctx.lineTo(9, -9); ctx.lineTo(-9, -9);
    ctx.closePath(); ctx.fill();
    // huge shoulders
    ctx.fillStyle = '#2A1638';
    ctx.beginPath(); ctx.arc(-11.5, -1, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(11.5, -1, 5.5, 0, Math.PI * 2); ctx.fill();
    // ram-plates of stolen-era masonry and iron
    ctx.fillStyle = '#262A36';
    ctx.fillRect(-12.5, -13.5, 10, 5.5);
    ctx.fillRect(2.5, -13.5, 10, 5.5);
    ctx.strokeStyle = '#5A4A42'; // rust streaks
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-9, -13); ctx.lineTo(-8, -8.5);
    ctx.moveTo(7, -13); ctx.lineTo(8, -8.5);
    ctx.stroke();
    // fault-line seams flare to magenta during windup
    ctx.strokeStyle = flare ? mix('#5A2E8C', '#8E4FD1', flare) : PAL.entViolet;
    ctx.lineWidth = 1.5 + flare * 1.5;
    if (flare) { ctx.shadowColor = PAL.glitch; ctx.shadowBlur = 8 * flare; }
    ctx.beginPath();
    ctx.moveTo(-10, 1); ctx.lineTo(-4, -4); ctx.lineTo(-6, -8);
    ctx.moveTo(10, 1); ctx.lineTo(4, -4); ctx.lineTo(6, -8);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
    // eye buried under the brow ridge — only visible head-on
    drawEye(ctx, e.x + e.fx * 9, e.y + e.fy * 9, 1.8, 0.5 + flare * 0.5);
    return;
  }

  if (e.kind === 'bulwark') {
    // LYTH LEECH — armored dome carrying stolen warm light in its belly
    const dmg = 1 - Math.max(0, Math.min(1, e.hp / (e.maxHp || 1)));
    shadowBlob(ctx, e.x, e.y + 8, 14, 5.5);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(a + Math.PI / 2);
    // stubby legs
    ctx.strokeStyle = '#241433';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 3; i++) {
      const sway = Math.sin(ph + i * 2.1) * 2;
      ctx.beginPath();
      ctx.moveTo(-10, -4 + i * 5); ctx.lineTo(-14, -4 + i * 5 + sway);
      ctx.moveTo(10, -4 + i * 5); ctx.lineTo(14, -4 + i * 5 - sway);
      ctx.stroke();
    }
    // belly glow — the ONLY enemy carrying warm light; brightens with damage
    const bg = ctx.createRadialGradient(0, 2, 0, 0, 2, 10 + dmg * 4);
    bg.addColorStop(0, `rgba(255,217,138,${0.5 + dmg * 0.45})`);
    bg.addColorStop(0.55, `rgba(240,169,60,${0.3 + dmg * 0.35})`);
    bg.addColorStop(1, 'rgba(240,169,60,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(-15, -13, 30, 30);
    // carapace dome
    ctx.fillStyle = '#1E1430';
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
    // warm seep between the plates
    ctx.fillStyle = `rgba(240,169,60,${0.25 + dmg * 0.55})`;
    ctx.beginPath(); ctx.arc(0, 2, 4.5 + dmg * 2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = PAL.entViolet;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 11.5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -11.5); ctx.lineTo(0, -8);
    ctx.moveTo(-10, 5); ctx.lineTo(-7, 3.5);
    ctx.moveTo(10, 5); ctx.lineTo(7, 3.5);
    ctx.stroke();
    // proboscis spike
    ctx.fillStyle = '#2A1638';
    ctx.beginPath();
    ctx.moveTo(-2.5, -10); ctx.lineTo(0, -18); ctx.lineTo(2.5, -10);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    // shield-facing read: bright carapace rim toward its facing
    ctx.strokeStyle = `rgba(142,79,209,0.8)`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(e.x, e.y, 14, a - 0.9, a + 0.9);
    ctx.stroke();
    drawEye(ctx, e.x - e.fx * 3, e.y - e.fy * 3, 1.8);
    return;
  }

  if (e.kind === 'spawner') {
    // SWARM CARRIER — backlit membrane sack on stilted legs
    const sway = Math.sin(t * 1.6 + e.id) * 2;
    shadowBlob(ctx, e.x, e.y + 10, 12, 4.5);
    ctx.save();
    ctx.translate(e.x, e.y);
    // stilted legs
    ctx.strokeStyle = '#241433';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-5, -2); ctx.lineTo(-11, 10);
    ctx.moveTo(5, -2); ctx.lineTo(11, 10);
    ctx.moveTo(-4, 0); ctx.lineTo(-7, 11);
    ctx.moveTo(4, 0); ctx.lineTo(7, 11);
    ctx.stroke();
    // lashed-on rusted plates — scavenged howdah
    ctx.fillStyle = '#5A4A42';
    ctx.fillRect(-10, -6, 4, 6);
    ctx.fillRect(7, -4, 3.5, 5);
    // membrane pod-sack, backlit from within
    ctx.save();
    ctx.translate(sway * 0.6, -8);
    ctx.fillStyle = '#2A1638';
    ctx.beginPath(); ctx.ellipse(0, 0, 10.5, 13, sway * 0.02, 0, Math.PI * 2); ctx.fill();
    const ig = ctx.createRadialGradient(0, 1, 0, 0, 1, 10);
    ig.addColorStop(0, 'rgba(142,79,209,0.5)');
    ig.addColorStop(1, 'rgba(142,79,209,0)');
    ctx.fillStyle = ig;
    ctx.fillRect(-11, -13, 22, 26);
    // unborn crawlers squirming in silhouette
    ctx.fillStyle = PAL.entBlack;
    for (let i = 0; i < 3; i++) {
      const ox = Math.sin(t * 2 + i * 2.1) * 4;
      const oy = Math.cos(t * 1.7 + i * 1.3) * 5;
      ctx.beginPath(); ctx.ellipse(ox, oy, 3, 2.2, i, 0, Math.PI * 2); ctx.fill();
    }
    // belly seam
    ctx.strokeStyle = PAL.entViolet;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, -12); ctx.quadraticCurveTo(1.5, 0, 0, 12);
    ctx.stroke();
    ctx.restore();
    // bent-neck head
    ctx.fillStyle = '#1A0E26';
    ctx.beginPath(); ctx.arc(sway, -22, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    drawEye(ctx, e.x + sway + 1, e.y - 22, 1.6);
    return;
  }

  if (e.kind === 'sniper') {
    // CLASSICAL PHANTOM — semi-transparent ghost of an old operator coat.
    // Inside a carried LythiumSeal's light (6 tiles) the forged cover boils
    // away: full opacity, no flicker, curve-segments peeling off mid-stride.
    let revealed = false;
    for (const sc of sealCarriers) {
      if ((sc.x - e.x) ** 2 + (sc.y - e.y) ** 2 < (TILE * 6) ** 2) { revealed = true; break; }
    }
    if (revealed) {
      ctx.save();
      const seed = e.id * 5.17;
      for (let i = 0; i < 4; i++) {
        // glowing fragments of the forged classical aggregate, shed upward
        const pr = fract(t * 0.9 + i * 0.27 + flick(seed + i * 3.3));
        const ox = (flick(seed + i * 7.1) - 0.5) * 22;
        ctx.globalAlpha = (1 - pr) * 0.8;
        ctx.strokeStyle = i % 2 ? PAL.lythGold : PAL.relay;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(e.x + ox, e.y - 4 - pr * 22, 3 + flick(seed + i) * 2.5, i, i + 1.5 + pr);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha *= revealed ? 1 : 0.6 + 0.08 * Math.sin(t * 9 + e.id);
    ctx.translate(e.x, e.y);
    // legless wisp tail (fading circles)
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = `rgba(94,107,140,${0.3 - i * 0.09})`;
      ctx.beginPath(); ctx.arc(0, 8 + i * 4, 4 - i, 0, Math.PI * 2); ctx.fill();
    }
    // spectral coat over a dark core
    ctx.fillStyle = PAL.haze;
    ctx.globalAlpha *= 0.55;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.quadraticCurveTo(7, -10, 6, 6);
    ctx.lineTo(-6, 6);
    ctx.quadraticCurveTo(-7, -10, 0, -16);
    ctx.fill();
    ctx.globalAlpha /= 0.55;
    ctx.fillStyle = '#1A0E26';
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.quadraticCurveTo(4.5, -9, 4, 5);
    ctx.lineTo(-4, 5);
    ctx.quadraticCurveTo(-4.5, -9, 0, -14);
    ctx.fill();
    // coat collar glint
    ctx.strokeStyle = 'rgba(191,208,232,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-4, -10); ctx.lineTo(4, -10); ctx.stroke();
    // single eye; long horizontal lens-flare while aiming
    if (e.aimT > 0) {
      ctx.strokeStyle = `rgba(191,251,255,${0.3 + 0.3 * Math.sin(t * 22)})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-13, -12); ctx.lineTo(13, -12); ctx.stroke();
    }
    ctx.restore();
    drawEye(ctx, e.x, e.y - 12, 2, e.aimT > 0 ? 1 : 0.85);
    return;
  }

  if (e.kind === 'skitter') {
    // FORKLING — tiny darting wedge with a literal split tail + afterimages
    for (let i = 1; i <= 2; i++) {
      ctx.save();
      ctx.globalAlpha *= i === 1 ? 0.3 : 0.15;
      ctx.translate(e.x - e.fx * 6 * i, e.y - e.fy * 6 * i);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = PAL.glitch;
      ctx.beginPath();
      ctx.moveTo(0, -7); ctx.lineTo(5, 3); ctx.lineTo(-5, 3);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    shadowBlob(ctx, e.x, e.y + 5, 7, 3);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = '#1A0E26';
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 3); ctx.lineTo(-5, 3);
    ctx.closePath(); ctx.fill();
    // tuning-fork tail prongs
    ctx.strokeStyle = '#1A0E26';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-2, 3); ctx.lineTo(-4.5, 9);
    ctx.moveTo(2, 3); ctx.lineTo(4.5, 9);
    ctx.stroke();
    ctx.strokeStyle = PAL.entViolet;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-4.5, 9); ctx.lineTo(-5, 11);
    ctx.moveTo(4.5, 9); ctx.lineTo(5, 11);
    ctx.stroke();
    ctx.restore();
    drawEye(ctx, e.x + e.fx * 2, e.y + e.fy * 2, 2.6); // oversized eye
    return;
  }

  if (kind === 'husk') {
    // HUSK — ragged horde fodder of ash-grey static; the cheap shamble.
    const lurch = Math.sin(ph * 0.9) * 2.4; // dragging, uneven gait
    shadowBlob(ctx, e.x, e.y + 8, 9, 3.6);
    ctx.save();
    // husks never square up to their target — they just face the camera
    ctx.translate(e.x, e.y + Math.abs(Math.sin(ph * 0.45)) * 1.4);
    // dangling arms, out of phase with the lurch
    ctx.strokeStyle = '#241433';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-6, -4); ctx.lineTo(-8 - lurch * 0.4, 6);
    ctx.moveTo(6, -4); ctx.lineTo(8 + lurch * 0.4, 7);
    ctx.stroke();
    // hunched ragged body — hem torn into static
    ctx.fillStyle = PAL.entBlack;
    ctx.beginPath();
    ctx.moveTo(-7, 7 + lurch * 0.2);
    ctx.quadraticCurveTo(-8.5, -4, -3 + lurch * 0.3, -9);
    ctx.quadraticCurveTo(2, -11, 5.5, -7);
    ctx.quadraticCurveTo(8.5, -2, 7, 7 - lurch * 0.2);
    ctx.closePath(); ctx.fill();
    // torn hem teeth
    ctx.fillStyle = '#1A0E26';
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 3 - 1.4, 6); ctx.lineTo(i * 3, 9.5 + flick(e.id + i) * 2); ctx.lineTo(i * 3 + 1.4, 6);
      ctx.closePath(); ctx.fill();
    }
    // one faint violet seam — barely held together
    ctx.strokeStyle = 'rgba(90,46,140,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-2 + lurch * 0.3, -8); ctx.lineTo(0, -1); ctx.lineTo(-2, 5);
    ctx.stroke();
    // drooped head
    ctx.fillStyle = '#1A0E26';
    ctx.beginPath(); ctx.arc(1.5 + lurch * 0.3, -10, 3.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    drawEye(ctx, e.x + 1.5 + e.fx * 3, e.y - 10 + e.fy * 2, 1.6, 0.7); // dim eye
    return;
  }

  if (kind === 'forkalpha') {
    // FORK ALPHA — the twin-tail brute: a forkling grown wrong, luminous seam
    // crown to belly, two half-faces that don't quite agree. Splits on death.
    const hurtK = 1 - Math.max(0, Math.min(1, e.hp / (e.maxHp || 3)));
    const seam = 0.45 + 0.4 * Math.sin(t * (3 + hurtK * 7) + e.id) + hurtK * 0.3;
    // stutter-step double exposure
    const stut = flick(Math.floor(t * 11) + e.id) < 0.3 ? 3 : 0;
    if (stut) {
      ctx.save();
      ctx.globalAlpha *= 0.3;
      ctx.translate(e.x - e.fy * stut, e.y + e.fx * stut);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = '#8C2A3A'; // corrupt-red ghost
      ctx.beginPath();
      ctx.moveTo(0, -11); ctx.lineTo(9, 6); ctx.lineTo(-9, 6);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    shadowBlob(ctx, e.x, e.y + 8, 11, 4.5);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(a + Math.PI / 2);
    // hunched wedge body, knuckles down
    ctx.strokeStyle = '#241433';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-7, -2); ctx.lineTo(-11, 5 + Math.sin(ph) * 2);
    ctx.moveTo(7, -2); ctx.lineTo(11, 5 - Math.sin(ph) * 2);
    ctx.stroke();
    ctx.fillStyle = '#2A1020'; // red-shifted entropy flesh
    ctx.beginPath();
    ctx.moveTo(0, -12); ctx.lineTo(9.5, 4); ctx.lineTo(5, 8); ctx.lineTo(-5, 8); ctx.lineTo(-9.5, 4);
    ctx.closePath(); ctx.fill();
    // THE SEAM — crown to belly, flaring white before the split
    ctx.save();
    ctx.strokeStyle = `rgba(255,${190 + Math.round(seam * 60)},${200 + Math.round(seam * 55)},${0.5 + seam * 0.5})`;
    ctx.lineWidth = 1.4 + seam * 1.4;
    ctx.shadowColor = '#FF96A8';
    ctx.shadowBlur = 4 + seam * 7;
    ctx.beginPath();
    ctx.moveTo(0, -12); ctx.lineTo(0.8, -4); ctx.lineTo(-0.6, 2); ctx.lineTo(0.4, 8);
    ctx.stroke();
    ctx.restore();
    // twin tuning-fork tails — already two of everything
    ctx.strokeStyle = '#2A1020';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-3, 8); ctx.lineTo(-6.5, 14);
    ctx.moveTo(3, 8); ctx.lineTo(6.5, 14);
    ctx.stroke();
    ctx.strokeStyle = PAL.entViolet;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-6.5, 14); ctx.lineTo(-7.5, 17);
    ctx.moveTo(6.5, 14); ctx.lineTo(7.5, 17);
    ctx.stroke();
    ctx.restore();
    // two half-faces: paired eyes either side of the seam, disagreeing
    drawEye(ctx, e.x + e.fx * 6 - e.fy * 3.2, e.y + e.fy * 6 + e.fx * 3.2, 2);
    drawEye(ctx, e.x + e.fx * 5 + e.fy * 3.2, e.y + e.fy * 5 - e.fx * 3.2, 1.5, 0.85);
    return;
  }

  if (kind === 'acolyte') {
    // NULL ACOLYTE — robed support caster; shields and mends the swarm.
    // Never attacks. Priority-kill read: the rotating zero halo.
    const bob = Math.sin(t * 1.8 + e.id) * 1.2;
    ctx.save();
    ctx.globalAlpha *= 0.7;
    shadowBlob(ctx, e.x, e.y + 10, 8, 3);
    ctx.restore();
    ctx.save();
    ctx.translate(e.x, e.y + bob);
    // ash-grey robe (paler than the Null Priest — a lesser order)
    ctx.fillStyle = '#241B2E';
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.quadraticCurveTo(8, -7, 8, 9);
    ctx.lineTo(-8, 9);
    ctx.quadraticCurveTo(-8, -7, 0, -15);
    ctx.fill();
    ctx.strokeStyle = '#3A3147';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-3, -8); ctx.lineTo(-3.6, 8);
    ctx.moveTo(3, -8); ctx.lineTo(3.6, 8);
    ctx.stroke();
    // inverted-anchor sigil on the chest, dull violet
    ctx.strokeStyle = 'rgba(142,79,209,0.85)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(0, -1.5);
    ctx.moveTo(-2.6, -4.5); ctx.quadraticCurveTo(0, -8.5, 2.6, -4.5); // flukes UP
    ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -0.4, 1.1, 0, Math.PI * 2); ctx.stroke();
    // raised palms, mid-mending
    ctx.fillStyle = '#3A3147';
    ctx.beginPath(); ctx.arc(-7.5, -9 + Math.sin(t * 2.4) * 0.8, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(7.5, -9 + Math.cos(t * 2.4) * 0.8, 2, 0, Math.PI * 2); ctx.fill();
    // cowl + faceless dark
    ctx.fillStyle = '#241B2E';
    ctx.beginPath(); ctx.arc(0, -13, 4.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PAL.voidNight;
    ctx.beginPath(); ctx.arc(0, -12.6, 3, 0, Math.PI * 2); ctx.fill();
    // the slowly rotating ZERO of dull-violet static, haloing the head
    ctx.strokeStyle = `rgba(142,79,209,${0.55 + 0.2 * Math.sin(t * 2)})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(0, -20, 6.5, 6.5 * Math.abs(Math.sin(t * 0.9 + e.id * 0.5)) + 1.2, 0, 0, Math.PI * 2);
    ctx.stroke();
    // static motes shed off the halo
    ctx.fillStyle = PAL.entViolet;
    for (let i = 0; i < 2; i++) {
      const pr = fract(t * 0.7 + i * 0.5 + e.id * 0.17);
      ctx.globalAlpha = (1 - pr) * 0.7;
      ctx.fillRect(Math.sin(t + i * 3) * 7, -20 - pr * 7, 1.4, 1.4);
    }
    ctx.restore();
    drawEye(ctx, e.x, e.y + bob - 13, 1.7, 0.8);
    return;
  }

  if (kind === 'voltwraith') {
    // VOLT WRAITH — hovering tatter crowned in live arcs; chain-zap elite.
    const bob = Math.sin(t * 2.6 + e.id) * 1.8;
    const frame = Math.floor(t * 18) + e.id;
    ctx.save();
    ctx.globalAlpha *= 0.6;
    shadowBlob(ctx, e.x, e.y + 10, 7, 2.8);
    ctx.restore();
    ctx.save();
    ctx.translate(e.x, e.y + bob);
    // legless tatter body, hem strips streaming
    ctx.fillStyle = '#141B2E'; // storm-blue dark, not violet — reads electric
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.quadraticCurveTo(7, -6, 5.5, 4);
    ctx.lineTo(2.5, 9 + Math.sin(t * 5 + 1) * 1.5);
    ctx.lineTo(0, 5);
    ctx.lineTo(-2.5, 10 + Math.sin(t * 5) * 1.5);
    ctx.lineTo(-5.5, 4);
    ctx.quadraticCurveTo(-7, -6, 0, -14);
    ctx.fill();
    // capacitor ribs glowing faint cyan
    ctx.strokeStyle = `rgba(111,216,242,${0.3 + 0.25 * flick(frame)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-4, -6); ctx.lineTo(4, -6);
    ctx.moveTo(-4.5, -2); ctx.lineTo(4.5, -2);
    ctx.moveTo(-4, 2); ctx.lineTo(4, 2);
    ctx.stroke();
    // head knot
    ctx.fillStyle = '#141B2E';
    ctx.beginPath(); ctx.arc(0, -13, 4, 0, Math.PI * 2); ctx.fill();
    // THE ARC CROWN — live micro-bolts dancing above the head
    ctx.strokeStyle = `rgba(191,251,255,${0.5 + 0.4 * flick(frame * 3.1)})`;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const aa = flick(frame + i * 7.7) * Math.PI * 2;
      jagPath(ctx, 0, -16, Math.cos(aa) * 8, -16 - 3 - Math.abs(Math.sin(aa)) * 5, 3, 2.5, frame + i * 31);
    }
    ctx.stroke();
    ctx.restore();
    drawEye(ctx, e.x + e.fx * 2, e.y + bob - 13, 2);
    return;
  }

  if (kind === 'phasestalker') {
    // PHASE STALKER — lean blink predator; afterimages where it has been,
    // a converging shimmer just before it is somewhere else.
    // pre-blink telegraph if the sim ships a countdown (blinkT/teleT)
    const blinkT = e.blinkT ?? e.teleT ?? null;
    const charging = blinkT != null && blinkT < 0.6 ? 1 - blinkT / 0.6 : 0;
    // ghosting: two trailing afterimages along its wake
    for (let i = 1; i <= 2; i++) {
      ctx.save();
      ctx.globalAlpha *= i === 1 ? 0.28 : 0.13;
      ctx.translate(e.x - e.fx * 9 * i, e.y - e.fy * 9 * i);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = PAL.glitch;
      ctx.beginPath();
      ctx.moveTo(0, -10); ctx.lineTo(6, 6); ctx.lineTo(0, 3); ctx.lineTo(-6, 6);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    shadowBlob(ctx, e.x, e.y + 7, 9, 3.6);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(a + Math.PI / 2);
    // sliced body: three horizontal bands, each slightly out of register
    for (const [sy0, sy1, k2] of [[-11, -4, 0], [-4, 2, 1], [2, 8, 2]]) {
      const off = (flick(Math.floor(t * 13) + e.id + k2 * 7) - 0.5) * (1.5 + charging * 4);
      ctx.fillStyle = k2 === 1 ? '#221233' : '#1A0E26';
      ctx.beginPath();
      ctx.moveTo(off, sy0);
      ctx.lineTo(off + 6 - k2, sy1);
      ctx.lineTo(off, sy1 - 1.5);
      ctx.lineTo(off - 6 + k2, sy1);
      ctx.closePath(); ctx.fill();
    }
    // long scythe forelimbs
    ctx.strokeStyle = '#2A1638';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-4, -6); ctx.quadraticCurveTo(-10, -10, -8, -15);
    ctx.moveTo(4, -6); ctx.quadraticCurveTo(10, -10, 8, -15);
    ctx.stroke();
    ctx.restore();
    if (charging > 0) {
      // the world starts agreeing it has moved: converging ring + brighten
      ctx.save();
      ctx.strokeStyle = `rgba(142,79,209,${0.35 + 0.5 * charging})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 18 * (1 - charging) + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    drawEye(ctx, e.x + e.fx * 7, e.y + e.fy * 7, 2.2, 0.8 + charging * 0.2);
    return;
  }

  if (kind === 'pyrebeetle') {
    // PYRE BEETLE — squat walking bomb; the warm belly glow is the warning.
    // Explodes on death into a burn patch: back away from the light.
    const hurtK = 1 - Math.max(0, Math.min(1, e.hp / (e.maxHp || 2)));
    const pulse = 0.5 + 0.5 * Math.sin(t * (5 + hurtK * 8) + e.id * 1.3);
    shadowBlob(ctx, e.x, e.y + 7, 11, 4.2);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(a + Math.PI / 2);
    // six scuttling legs
    ctx.strokeStyle = '#241433';
    ctx.lineWidth = 1.8;
    for (let i = -1; i <= 1; i++) {
      const sway = Math.sin(ph * 1.2 + i * 2.1) * 2.5;
      ctx.beginPath();
      ctx.moveTo(-7, i * 4.5); ctx.lineTo(-11.5, i * 4.5 + sway);
      ctx.moveTo(7, i * 4.5); ctx.lineTo(11.5, i * 4.5 - sway);
      ctx.stroke();
    }
    // underglow leaking onto the ground — the belly furnace
    const ug = ctx.createRadialGradient(0, 2, 0, 0, 2, 12 + pulse * 3);
    ug.addColorStop(0, `rgba(240,169,60,${0.35 + pulse * 0.3 + hurtK * 0.2})`);
    ug.addColorStop(1, 'rgba(240,169,60,0)');
    ctx.fillStyle = ug;
    ctx.fillRect(-15, -13, 30, 30);
    // dark carapace shell
    ctx.fillStyle = '#1E1018';
    ctx.beginPath(); ctx.ellipse(0, 0, 9.5, 11.5, 0, 0, Math.PI * 2); ctx.fill();
    // ember seams between the plates, brightening with damage
    ctx.strokeStyle = `rgba(240,169,60,${0.45 + pulse * 0.35 + hurtK * 0.2})`;
    ctx.lineWidth = 1.2 + hurtK;
    ctx.beginPath();
    ctx.moveTo(0, -11); ctx.lineTo(0, 11); // elytra split
    ctx.moveTo(-8, -3); ctx.lineTo(-3, -1);
    ctx.moveTo(8, -3); ctx.lineTo(3, -1);
    ctx.moveTo(-7, 5); ctx.lineTo(-3, 4);
    ctx.moveTo(7, 5); ctx.lineTo(3, 4);
    ctx.stroke();
    // fuse sparks popping off the shell when hurt
    if (hurtK > 0.3) {
      ctx.fillStyle = PAL.lythPale;
      for (let i = 0; i < 2; i++) {
        const pr = fract(t * 1.4 + i * 0.5 + e.id * 0.21);
        ctx.globalAlpha = (1 - pr) * 0.9;
        ctx.fillRect((flick(e.id + i * 7) - 0.5) * 12, -4 - pr * 9, 1.5, 1.5);
      }
      ctx.globalAlpha = 1;
    }
    // blunt head plate
    ctx.fillStyle = '#2A1638';
    ctx.beginPath(); ctx.ellipse(0, -11, 4.5, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    drawEye(ctx, e.x + e.fx * 9, e.y + e.fy * 9, 1.6, 0.8);
    return;
  }

  // ===================== RELIC AWAKENING — NIGHTMARES ======================
  // Drawn only during the horde event (these kinds never appear otherwise).
  // Each carries glowing red/violet eyes + a motion trail; the ghost is
  // translucent and phases; deaths dissolve via the 'nightmareDissolve' FX.
  if (e.kind === 'spider') {
    // DREAD SPIDER — a skittering knot of black legs, eyes a cluster of red.
    drawNightmareTrail(ctx, e, 12, '120,30,30');
    shadowBlob(ctx, e.x, e.y + 6, 9, 3);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(a + Math.PI / 2);
    ctx.strokeStyle = '#0E0810';
    ctx.lineWidth = 1.8;
    for (let i = 0; i < 4; i++) {
      const sk = Math.sin(ph * 1.6 + i * 1.3) * 4;
      const yy = -6 + i * 4;
      ctx.beginPath();
      ctx.moveTo(-2, yy); ctx.lineTo(-9 - Math.abs(sk) * 0.4, yy + sk * 0.5 + 1);
      ctx.moveTo(2, yy); ctx.lineTo(9 + Math.abs(sk) * 0.4, yy - sk * 0.5 + 1);
      ctx.stroke();
    }
    ctx.fillStyle = '#160812';
    ctx.beginPath(); ctx.ellipse(0, 0, 5.5, 6.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    drawDreadEyes(ctx, e, 5, 1.3, '255,40,40', 1.8);
    return;
  }

  if (e.kind === 'ghost') {
    // PALE GHOST — a translucent shroud that phases through walls; lower hp
    // reads as a thinner veil. Violet dread eyes through the haze.
    const bob = Math.sin(t * 2 + e.id) * 2.2;
    ctx.save();
    ctx.globalAlpha *= 0.42; // translucency — you can see the world through it
    drawNightmareTrail(ctx, e, 18, '150,120,210');
    ctx.translate(e.x, e.y + bob);
    const grd = ctx.createRadialGradient(0, -2, 2, 0, 2, 16);
    grd.addColorStop(0, 'rgba(214,200,255,0.9)');
    grd.addColorStop(1, 'rgba(120,90,170,0.05)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.quadraticCurveTo(11, -8, 11, 6);
    // tattered wavy hem
    for (let i = 3; i >= -3; i--) {
      ctx.lineTo(i * 3.4, 8 + Math.sin(t * 4 + i + e.id) * 3);
    }
    ctx.quadraticCurveTo(-11, -8, 0, -15);
    ctx.fill();
    ctx.restore();
    drawDreadEyes(ctx, e, 4, 1.8, '186,120,255', 3);
    return;
  }

  if (e.kind === 'reaper') {
    // REAPER — a tall hooded dread with a scythe and a low crimson aura.
    const aura = 0.3 + 0.2 * Math.sin(t * 1.6 + e.id);
    ctx.save();
    ctx.strokeStyle = `rgba(180,20,30,${aura})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(e.x, e.y + 6, 22 + Math.sin(t * 2) * 2, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    shadowBlob(ctx, e.x, e.y + 14, 13, 5);
    const bob = Math.sin(t * 1.4 + e.id) * 1.6;
    ctx.save();
    ctx.translate(e.x, e.y + bob);
    // robe
    ctx.fillStyle = '#0C0710';
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.quadraticCurveTo(13, -8, 11, 16);
    ctx.lineTo(-11, 16);
    ctx.quadraticCurveTo(-13, -8, 0, -22);
    ctx.fill();
    // hood shadow
    ctx.fillStyle = '#050308';
    ctx.beginPath(); ctx.ellipse(0, -15, 6.5, 7.5, 0, 0, Math.PI * 2); ctx.fill();
    // scythe haft + blade
    ctx.strokeStyle = '#2A1014';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(11, 14); ctx.lineTo(15, -20); ctx.stroke();
    ctx.strokeStyle = 'rgba(220,60,70,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(15, -20); ctx.quadraticCurveTo(26, -18, 23, -7); ctx.stroke();
    ctx.restore();
    drawDreadEyes(ctx, e, -e.fx * 4 + 0, 2, '255,40,40', 2);
    // eyes set in the hood, facing forward
    drawDreadEyes(ctx, { x: e.x, y: e.y - 15 + bob, fx: e.fx, fy: e.fy }, 0, 1.7, '255,50,50', 2.4);
    return;
  }

  if (e.kind === 'skeleton') {
    // RATTLE SKELETON — a jittery bone-thrower; a small double-exposure shiver.
    const shiver = Math.sin(t * 22 + e.id) * 1.1;
    drawNightmareTrail(ctx, e, 8, '120,120,130');
    shadowBlob(ctx, e.x, e.y + 9, 8, 3);
    ctx.save();
    ctx.translate(e.x + shiver, e.y);
    // ribcage
    ctx.strokeStyle = '#D8D2C2';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(0, -2 + i * 3, 5 - i * 0.6, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.stroke();
    }
    // spine + skull
    ctx.strokeStyle = '#C9C2B0';
    ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(0, -8); ctx.stroke();
    ctx.fillStyle = '#E6E0D0';
    ctx.beginPath(); ctx.arc(0, -11, 4.2, 0, Math.PI * 2); ctx.fill();
    // jaw
    ctx.fillStyle = '#B8B2A0';
    ctx.fillRect(-3, -8.5, 6, 1.6);
    ctx.restore();
    // hollow red eye-sockets
    drawDreadEyes(ctx, { x: e.x + shiver, y: e.y - 11, fx: e.fx, fy: e.fy }, 0, 1.2, '255,70,40', 1.7);
    return;
  }

  if (e.kind === 'zombie') {
    // GHOUL — a slow, lopsided shamble; one arm dragging, sickly green tinge.
    const lurch = Math.sin(ph * 0.7) * 2.6;
    drawNightmareTrail(ctx, e, 8, '60,90,50');
    shadowBlob(ctx, e.x, e.y + 9, 9, 3.6);
    ctx.save();
    ctx.translate(e.x, e.y + Math.abs(Math.sin(ph * 0.4)) * 1.2);
    ctx.strokeStyle = '#23301E';
    ctx.lineWidth = 2.6;
    // reaching arms
    ctx.beginPath();
    ctx.moveTo(-4, -3); ctx.lineTo(-9 + lurch * 0.3, 2 - Math.abs(lurch));
    ctx.moveTo(4, -3); ctx.lineTo(9 - lurch * 0.3, 1 - Math.abs(lurch));
    ctx.stroke();
    ctx.fillStyle = '#1C2A18';
    ctx.beginPath();
    ctx.moveTo(-6, 8); ctx.quadraticCurveTo(-8, -5, -2 + lurch * 0.3, -9);
    ctx.quadraticCurveTo(3, -11, 6, -6);
    ctx.quadraticCurveTo(8, -2, 6, 8);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#16210F';
    ctx.beginPath(); ctx.arc(1 + lurch * 0.25, -10, 3.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    drawDreadEyes(ctx, { x: e.x + lurch * 0.25, y: e.y - 10, fx: e.fx, fy: e.fy }, 2, 1.3, '170,255,90', 1.7);
    return;
  }

  if (e.kind === 'hellhound') {
    // HELLHOUND — a low, fast quadruped lunger streaming embers; a long trail.
    drawNightmareTrail(ctx, e, 22, '200,60,20');
    shadowBlob(ctx, e.x, e.y + 7, 12, 4);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(a);
    // body wedge, nose forward (+x after rotate)
    ctx.fillStyle = '#160807';
    ctx.beginPath();
    ctx.moveTo(11, 0); ctx.lineTo(2, -6); ctx.lineTo(-10, -4);
    ctx.lineTo(-12, 0); ctx.lineTo(-10, 4); ctx.lineTo(2, 6);
    ctx.closePath(); ctx.fill();
    // running legs
    ctx.strokeStyle = '#0E0605';
    ctx.lineWidth = 2;
    const gait = Math.sin(ph * 1.8) * 3;
    ctx.beginPath();
    ctx.moveTo(4, 5); ctx.lineTo(6 + gait, 9);
    ctx.moveTo(-6, 5); ctx.lineTo(-4 - gait, 9);
    ctx.moveTo(4, -5); ctx.lineTo(6 - gait, -9);
    ctx.moveTo(-6, -5); ctx.lineTo(-4 + gait, -9);
    ctx.stroke();
    // ember spine
    ctx.fillStyle = `rgba(240,120,40,${0.6 + 0.3 * Math.sin(t * 8 + e.id)})`;
    for (const ex of [-6, -2, 2]) { ctx.beginPath(); ctx.arc(ex, 0, 1.4, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    drawDreadEyes(ctx, e, 9, 1.5, '255,90,30', 2);
    return;
  }

  if (e.kind === 'banshee') {
    // BANSHEE — a wailing drifter; a thin shrieking veil with violet eyes and
    // a faint sonic ring that pulses as it wails.
    const bob = Math.sin(t * 2.4 + e.id) * 2.5;
    const wail = 0.3 + 0.3 * Math.sin(t * 5 + e.id);
    ctx.save();
    ctx.strokeStyle = `rgba(160,90,220,${wail * 0.5})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(e.x, e.y + bob, 16 + wail * 6, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    drawNightmareTrail(ctx, e, 14, '150,90,210');
    ctx.save();
    ctx.globalAlpha *= 0.7;
    ctx.translate(e.x, e.y + bob);
    const grd = ctx.createLinearGradient(0, -14, 0, 12);
    grd.addColorStop(0, 'rgba(210,180,255,0.85)');
    grd.addColorStop(1, 'rgba(110,70,160,0.1)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.quadraticCurveTo(9, -6, 8, 6);
    for (let i = 2; i >= -2; i--) ctx.lineTo(i * 4, 10 + Math.sin(t * 6 + i) * 3);
    ctx.quadraticCurveTo(-9, -6, 0, -14);
    ctx.fill();
    // a gaping wailing mouth
    ctx.fillStyle = 'rgba(40,10,60,0.8)';
    ctx.beginPath(); ctx.ellipse(0, -2 + bob * 0.1, 1.6, 3 + wail * 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    drawDreadEyes(ctx, { x: e.x, y: e.y - 6 + bob, fx: e.fx, fy: e.fy }, 2, 1.6, '200,130,255', 2.6);
    return;
  }

  // BOSS: ANCHOR EATER — colossal devourer armored in eaten Anchor fragments
  const phase2 = e.hp <= (e.maxHp || 1) * 0.5;
  const flare = phase2 ? 0.5 + 0.5 * Math.sin(t * 6) : 0.25 + 0.25 * Math.sin(t * 2);
  shadowBlob(ctx, e.x, e.y + 14, 28, 11);
  // low violet glitch aura
  ctx.save();
  ctx.strokeStyle = `rgba(90,46,140,${0.3 + flare * 0.2})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(e.x, e.y + 4, 30 + Math.sin(t * 5) * 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(a + Math.PI / 2);
  // four legs
  ctx.strokeStyle = '#241433';
  ctx.lineWidth = 5;
  for (const [sx, sy] of [[-16, -8], [16, -8], [-14, 10], [14, 10]]) {
    const sway = Math.sin(ph * 0.6 + sx) * 3;
    ctx.beginPath();
    ctx.moveTo(sx * 0.7, sy * 0.7);
    ctx.lineTo(sx + sway * Math.sign(sx) * 0.3, sy + 5);
    ctx.stroke();
  }
  // body
  ctx.fillStyle = PAL.entBlack;
  ctx.beginPath(); ctx.ellipse(0, 2, 23, 19, 0, 0, Math.PI * 2); ctx.fill();
  // spined back: obelisk shards of eaten Anchors, dead grooves still visible
  for (const [ox, oy, w, h] of [[-10, 6, 8, 13], [2, 9, 7, 11], [-2, 14, 9, 9]]) {
    ctx.fillStyle = PAL.graphMid;
    ctx.beginPath();
    ctx.moveTo(ox - w / 2, oy + h / 2);
    ctx.lineTo(ox, oy - h / 2);
    ctx.lineTo(ox + w / 2, oy + h / 2);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = PAL.graphDark;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = '#3E4A66'; // dead groove lines — unmade finality
    ctx.beginPath();
    ctx.moveTo(ox, oy - h / 2 + 2); ctx.lineTo(ox, oy + h / 2 - 1);
    ctx.stroke();
  }
  // body seams flare by attack phase
  ctx.strokeStyle = mix('#5A2E8C', '#8E4FD1', flare);
  ctx.lineWidth = 1.5 + flare;
  if (phase2) { ctx.shadowColor = PAL.glitch; ctx.shadowBlur = 6 * flare; }
  ctx.beginPath();
  ctx.moveTo(-18, 4); ctx.lineTo(-10, -4); ctx.lineTo(-13, -12);
  ctx.moveTo(18, 4); ctx.lineTo(10, -4); ctx.lineTo(13, -12);
  ctx.stroke();
  ctx.shadowBlur = 0;
  // maw of concentric grinding jaw-rings at the front
  const bite = 0.5 + 0.5 * Math.sin(t * (phase2 ? 5 : 2.6));
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = i % 2 ? PAL.entBlack : '#262A36';
    ctx.lineWidth = 3.5 - i;
    ctx.beginPath();
    ctx.arc(0, -13, 9 - i * 2.6 - bite * 1.2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  // the one huge eye sits in the throat of the maw — weakpoint mid-bite
  drawEye(ctx, e.x + e.fx * 13, e.y + e.fy * 13, 2.6, 0.25 + bite * 0.75);
}

// ============================== WORLD SET PIECES ==============================
function tear(ctx, x, y, w, h) {
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.quadraticCurveTo(x + w, y - h * 0.35, x, y + h * 0.28);
  ctx.quadraticCurveTo(x - w, y - h * 0.35, x, y - h);
  ctx.fill();
}

// Live campfire flame over a baked stone ring. Warmth = safety.
function drawCampfire(ctx, px, py, gx, gy, t, lights) {
  const cx = px + TILE / 2, cy = py + TILE / 2 + 2;
  const jt = Math.floor(t * 8) + gx * 13.37 + gy * 7.77;
  const j = flick(jt), j2 = flick(jt + 5);
  const fl = 0.88 + j * 0.24;
  ctx.fillStyle = PAL.ember;
  tear(ctx, cx - 3.5, cy + 1, 3.2 * fl, 6.5 * fl);
  tear(ctx, cx + 3.5, cy + 1, 2.8 * fl, 6 * (0.9 + j2 * 0.2));
  ctx.fillStyle = PAL.lythAmber;
  tear(ctx, cx, cy, 5.2 * fl, 12.5 * fl);
  ctx.fillStyle = PAL.lythGold;
  tear(ctx, cx, cy + 1, 3.5 * fl, 8.5 * (0.9 + j2 * 0.2));
  ctx.fillStyle = PAL.lythPale;
  tear(ctx, cx, cy + 2, 2 * fl, 5.2);
  // drifting spark motes
  ctx.fillStyle = '#E07B39';
  for (let i = 0; i < 3; i++) {
    const pr = fract(t * 0.55 + i * 0.33 + flick(gx * 31 + gy * 17 + i));
    ctx.globalAlpha = (1 - pr) * 0.9;
    ctx.fillRect(cx + Math.sin(pr * 6 + i * 2.1) * 4, cy - 6 - pr * 26, 1.6, 1.6);
  }
  ctx.globalAlpha = 1;
  // warm pool locally overrides the cold grade
  lights.push({ x: cx, y: cy - 2, r: TILE * 1.6, rgb: '240,169,60', a: 0.12 + j * 0.035 });
}

// LYTH crystal node — warm landmark; shards shrink as it takes damage.
function drawCrystal(ctx, c, t, lights) {
  const { x, y } = c;
  ctx.save();
  ctx.strokeStyle = '#14161E';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(x, y + 6, 14, 6, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = PAL.ember;
  ctx.fillRect(x - 11, y + 8, 2, 2);
  ctx.fillRect(x + 9, y + 4, 2, 2);
  const n = 2 + Math.max(1, Math.min(3, c.hp ?? 3));
  for (let i = 0; i < n; i++) {
    const h0 = flick(x * 0.37 + y * 0.61 + i * 7.3);
    const ox = (h0 - 0.5) * 18;
    const hh = 12 + flick(h0 * 91) * 10;
    const ww = 3 + flick(h0 * 53) * 2.5;
    ctx.save();
    ctx.translate(x + ox, y + 6);
    ctx.rotate((flick(h0 * 17) - 0.5) * 0.5);
    const grad = ctx.createLinearGradient(0, 0, 0, -hh);
    grad.addColorStop(0, PAL.ember);
    grad.addColorStop(0.55, PAL.lythAmber);
    grad.addColorStop(1, PAL.lythGold);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-ww, 0); ctx.lineTo(0, -hh); ctx.lineTo(ww, 0);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = PAL.lythPale; // inner core line
    ctx.globalAlpha *= 0.8;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -2); ctx.lineTo(0, -hh + 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
  lights.push({ x, y, r: TILE * 1.5, rgb: '240,169,60', a: 0.09 + 0.03 * Math.sin(t * 2 + x * 0.05) });
}

// Shard pickup — the signature warm LYTH glow; must read at full-screen range.
// Drops may carry a kind ('medkit'/'shield'/'cracker'/'token'); plain shards
// (no kind) render exactly as before.
function drawDrop(ctx, d, t, lights) {
  if (d.kind && d.kind !== 'shards' && d.kind !== 'shard') { drawItemDrop(ctx, d, t, lights); return; }
  const bob = Math.sin(t * (Math.PI * 2 / 1.2) + (d.x + d.y) * 0.07) * 2;
  const y = d.y - 5 + bob;
  let a = 1;
  if (d.ttl != null && d.ttl < 3) a = (d.ttl % 0.4) < 0.2 ? 0.45 : 1; // expiry blink
  ctx.save();
  ctx.globalAlpha *= a;
  ctx.fillStyle = 'rgba(11,10,20,0.35)';
  ctx.beginPath();
  ctx.ellipse(d.x, d.y + 6, 5, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(d.x, y);
  ctx.fillStyle = PAL.lythGold;
  ctx.strokeStyle = PAL.lythAmber;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -6); ctx.lineTo(4.5, 0); ctx.lineTo(0, 6); ctx.lineTo(-4.5, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = PAL.lythPale; // diagonal specular
  ctx.beginPath();
  ctx.moveTo(-1.6, -2.6); ctx.lineTo(1.4, 0.4);
  ctx.stroke();
  // 4-point sparkle ping every ~2s so shards are findable in grass
  const ph2 = fract(t / 2 + flick(d.x * 0.13 + d.y * 0.29));
  if (ph2 < 0.12) {
    const sa = 1 - ph2 / 0.12;
    ctx.strokeStyle = `rgba(255,239,194,${sa})`;
    ctx.beginPath();
    ctx.moveTo(0, -10); ctx.lineTo(0, -13);
    ctx.moveTo(8, 0); ctx.lineTo(11, 0);
    ctx.moveTo(0, 10); ctx.lineTo(0, 13);
    ctx.moveTo(-8, 0); ctx.lineTo(-11, 0);
    ctx.stroke();
  }
  ctx.restore();
  lights.push({ x: d.x, y, r: 22, rgb: '255,217,138', a: 0.12 * a });
}

// Stranded operator — hooded indigo cloak, lantern, face never shown.
function drawNpc(ctx, n, t, lights) {
  const bob = Math.sin(t * 1.4 + (n.x || 0) * 0.05) * 0.8;
  const x = n.x, y = n.y + bob;
  shadowBlob(ctx, x, n.y + 10, 11, 4.5);
  // bedroll/pack set dressing
  ctx.fillStyle = '#4A4232';
  ctx.fillRect(x + 8, n.y + 3, 13, 6);
  ctx.strokeStyle = '#5E5640';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 8.5, n.y + 3.5, 12, 5);
  // cloak
  ctx.fillStyle = '#2C3148';
  ctx.beginPath();
  ctx.moveTo(x, y - 13);
  ctx.quadraticCurveTo(x + 9, y - 4, x + 9, y + 9);
  ctx.lineTo(x - 9, y + 9);
  ctx.quadraticCurveTo(x - 9, y - 4, x, y - 13);
  ctx.fill();
  ctx.fillStyle = 'rgba(26,29,44,0.9)'; // lower shading
  ctx.beginPath();
  ctx.moveTo(x - 9, y + 9); ctx.lineTo(x + 9, y + 9); ctx.lineTo(x + 7, y + 2); ctx.lineTo(x - 7, y + 2);
  ctx.closePath(); ctx.fill();
  // hood; interior in shadow except one faint visor glint
  ctx.fillStyle = '#2C3148';
  ctx.beginPath(); ctx.arc(x, y - 8, 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#1A1D2C';
  ctx.stroke();
  ctx.fillStyle = PAL.voidNight;
  ctx.beginPath(); ctx.arc(x, y - 7, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(191,208,232,0.8)';
  ctx.fillRect(x - 1.5, y - 8, 3, 1.2);
  rimArc(ctx, x, y - 6, 7, 0.4);
  // hand lantern with warm pool — keep the signal alive
  const lx = x - 10, ly = y + 2;
  ctx.strokeStyle = PAL.steel;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(lx, ly - 5); ctx.lineTo(lx, ly - 2); ctx.stroke();
  ctx.save();
  ctx.fillStyle = PAL.lythGold;
  ctx.shadowColor = PAL.lythAmber;
  ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.arc(lx, ly, 2.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  lights.push({ x: lx, y: ly, r: 48, rgb: '255,217,138', a: 0.12 });
  // name tag
  if (n.name) {
    ctx.save();
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    const label = n.name.toUpperCase();
    const w = ctx.measureText(label).width + 8;
    ctx.fillStyle = 'rgba(11,10,20,0.75)';
    ctx.fillRect(x - w / 2, y - 27, w, 12);
    ctx.fillStyle = PAL.coldHi;
    ctx.fillText(label, x, y - 18);
    ctx.restore();
  }
}

// ============================== FRONTIER ENTITIES ==============================
// Bastion-era set pieces: caches, mounts, watchtowers, the base core, shops,
// hire posts, farms, ctf flags, lure crackers. Every field is optional —
// classic snapshots carry none of these and render exactly as before.

const TEAM_COL = ['#6FD8F2', '#E04848']; // ctf: team 0 relay-cyan, team 1 breach-red
const TEAM_RGB = ['111,216,242', '224,72,72'];

const SHOP_OFFERS = [
  ['WEAPON TOKEN +1', 20],
  ['SHIELD +2', 12],
  ['CRACKER ×2', 8],
  ['MEDKIT', 10],
];

// 'C' — supply cache. Closed: graphite chest with LYTH-gold banding and a
// winking latch so it reads at range. Opened: lid thrown back, looted dark.
function drawChest(ctx, c, t, lights) {
  const { x, y } = c;
  shadowBlob(ctx, x, y + 7, 12, 4.5);
  ctx.save();
  ctx.translate(x, y);
  if (c.opened) {
    ctx.fillStyle = PAL.graphDark; // lid thrown back
    ctx.fillRect(-10, -15, 20, 7);
    ctx.fillStyle = PAL.graphPlate;
    ctx.fillRect(-10, -15, 20, 2.5);
    ctx.fillStyle = '#2E3140'; // body
    ctx.fillRect(-10, -7, 20, 12);
    ctx.strokeStyle = '#4A4650';
    ctx.lineWidth = 1;
    ctx.strokeRect(-10, -7, 20, 12);
    ctx.fillStyle = PAL.voidNight; // looted interior
    ctx.fillRect(-8, -6, 16, 7);
  } else {
    ctx.fillStyle = '#2E3140'; // body
    ctx.fillRect(-10, -4, 20, 9);
    ctx.fillStyle = '#3A3F4E'; // domed lid
    ctx.beginPath();
    ctx.moveTo(-10, -4);
    ctx.quadraticCurveTo(0, -13, 10, -4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = PAL.lythAmber; // gold banding
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-6, -9.6); ctx.lineTo(-6, 5);
    ctx.moveTo(6, -9.6); ctx.lineTo(6, 5);
    ctx.stroke();
    ctx.fillStyle = PAL.moonsteel; // moonlit lid rim
    ctx.fillRect(-9, -5.5, 18, 1.2);
    // latch — winks every couple of seconds so caches are findable in grass
    const wink = fract(t / 2.2 + flick(x * 0.31 + y * 0.17)) < 0.12;
    ctx.save();
    if (wink) { ctx.shadowColor = PAL.lythGold; ctx.shadowBlur = 8; }
    ctx.fillStyle = wink ? PAL.lythPale : PAL.lythGold;
    ctx.fillRect(-2, -5, 4, 5);
    ctx.restore();
    lights.push({ x, y: y - 3, r: 24, rgb: '255,217,138', a: wink ? 0.14 : 0.06 });
  }
  ctx.restore();
  rimArc(ctx, x, y - 4, 9, 0.35);
}

// 'V' — shared mounts. Stag: antlered land mount saddled in Frontier Teal.
// Skiff: flat-bottomed boat; wake ripples peel off the stern underway.
function drawVehicle(ctx, v, t, dt, lights) {
  const { x, y } = v;
  const ridden = (v.rider ?? null) != null;
  const { ph, amp } = poseFor('v' + (v.id ?? `${v.kind}:${x}`), x, y, dt);
  if (v.kind === 'skiff') {
    if (amp > 0.12) {
      ctx.save();
      ctx.strokeStyle = `rgba(94,107,140,${0.35 * amp})`;
      ctx.lineWidth = 1.5;
      for (let i = 1; i <= 3; i++) {
        ctx.globalAlpha *= 0.8;
        ctx.beginPath();
        ctx.arc(x, y + 4, 6 + i * 7 + fract(t * 1.6) * 6, Math.PI * 0.25, Math.PI * 0.75);
        ctx.stroke();
      }
      ctx.restore();
    }
    const bob = Math.sin(t * 1.7 + x * 0.05) * 1.2;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.fillStyle = 'rgba(11,10,20,0.4)'; // hull shadow on the water
    ctx.beginPath(); ctx.ellipse(0, 5, 17, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2A2418'; // tarred hull
    ctx.beginPath();
    ctx.moveTo(-17, -2);
    ctx.quadraticCurveTo(0, -9, 19, -3); // gunwale sweep to the bow
    ctx.lineTo(15, 5);
    ctx.quadraticCurveTo(0, 9, -13, 5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#4A4232'; // plank lines
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-13, 0); ctx.lineTo(15, -1);
    ctx.moveTo(-12, 3); ctx.lineTo(13, 2.5);
    ctx.stroke();
    ctx.fillStyle = PAL.graphDark; // rowing bench
    ctx.fillRect(-4, -5.5, 8, 4);
    ctx.strokeStyle = PAL.moonsteel; // moonlit gunwale
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-16, -2.4);
    ctx.quadraticCurveTo(0, -9.2, 18, -3.4);
    ctx.stroke();
    // stern lantern — find your way back from the islands
    ctx.strokeStyle = PAL.steel;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-14, -3); ctx.lineTo(-14, -10); ctx.stroke();
    ctx.save();
    ctx.fillStyle = PAL.lythGold;
    ctx.shadowColor = PAL.lythAmber;
    ctx.shadowBlur = 7;
    ctx.beginPath(); ctx.arc(-14, -11.5, 1.9, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.restore();
    lights.push({ x: x - 14, y: y - 11, r: 36, rgb: '255,217,138', a: 0.09 });
  } else {
    // stag
    const bob = Math.sin(t * (ridden ? 2.4 : 1.2) + x * 0.03) * 1.2;
    shadowBlob(ctx, x, y + 10, 14, 5);
    ctx.save();
    ctx.translate(x, y + bob * 0.4);
    ctx.strokeStyle = '#232533'; // legs
    ctx.lineWidth = 2.5;
    for (const [lx, dir] of [[-9, 1], [-4, -1], [5, 1], [10, -1]]) {
      const sway = Math.sin(ph * 0.9 + lx) * 3 * amp;
      ctx.beginPath();
      ctx.moveTo(lx, 2);
      ctx.lineTo(lx + sway * dir, 11);
      ctx.stroke();
    }
    ctx.fillStyle = '#3A3A46'; // body
    ctx.beginPath(); ctx.ellipse(0, -2, 13, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(11,10,20,0.35)'; // belly shade
    ctx.beginPath(); ctx.ellipse(0, 1, 11, 4, 0, 0, Math.PI); ctx.fill();
    ctx.fillStyle = '#3A3A46'; // neck + head
    ctx.beginPath();
    ctx.moveTo(9, -5);
    ctx.quadraticCurveTo(14, -12, 14, -16);
    ctx.lineTo(18, -16);
    ctx.quadraticCurveTo(15, -8, 13, -3);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath(); ctx.ellipse(16.5, -17, 4.5, 3, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = PAL.coldHi; // moonlit antlers
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(15, -19.5); ctx.lineTo(12, -26); ctx.lineTo(9, -28);
    ctx.moveTo(12, -26); ctx.lineTo(13, -30);
    ctx.moveTo(18, -19.5); ctx.lineTo(20, -27); ctx.lineTo(24, -29);
    ctx.moveTo(20, -27); ctx.lineTo(18, -31);
    ctx.stroke();
    ctx.fillStyle = PAL.coldHi; // eye
    ctx.fillRect(17.5, -18, 1.5, 1.5);
    ctx.strokeStyle = '#2A2A36'; // tail flick
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-13, -4);
    ctx.lineTo(-16, -7 + Math.sin(t * 3 + x) * 1.5);
    ctx.stroke();
    // saddle: teal blanket + gold cinch — anyone may take a free mount
    ctx.fillStyle = PAL.teal;
    ctx.fillRect(-6, -8.5, 11, 5);
    ctx.fillStyle = PAL.graphDark;
    ctx.fillRect(-6, -4, 11, 1.6);
    ctx.fillStyle = PAL.lythAmber;
    ctx.fillRect(-1.5, -8.5, 1.6, 6);
    ctx.restore();
    rimArc(ctx, x + 2, y - 6, 11, 0.4);
  }
}

// 'W' — watchtower: stilted graphite platform. Destroyed towers leave
// splintered stilts and a rebuild hologram, like a fresh job site.
function drawTower(ctx, tw, t, lights) {
  const { x, y } = tw;
  const lvl = Math.max(1, Math.min(3, tw.level ?? 1));
  if ((tw.hp ?? 1) <= 0) {
    shadowBlob(ctx, x, y + 7, 14, 5);
    ctx.strokeStyle = '#2A2830';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 10, y + 6); ctx.lineTo(x - 5, y - 6);
    ctx.moveTo(x + 9, y + 6); ctx.lineTo(x + 13, y - 2);
    ctx.stroke();
    ctx.fillStyle = PAL.graphDark; // fallen platform plank
    ctx.fillRect(x - 12, y - 2, 22, 5);
    ctx.save();
    ctx.globalAlpha *= 0.25 + 0.08 * Math.sin(t * 2.3 + x * 0.05);
    ctx.strokeStyle = PAL.pylonBlue;
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 12, y - 36, 24, 30); // ghost of the tower to come
    ctx.setLineDash([]);
    ctx.restore();
    return;
  }
  shadowBlob(ctx, x, y + 9, 14, 5);
  ctx.strokeStyle = PAL.graphPlate; // stilts
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - 9, y - 24); ctx.lineTo(x - 12, y + 8);
  ctx.moveTo(x + 9, y - 24); ctx.lineTo(x + 12, y + 8);
  ctx.stroke();
  ctx.strokeStyle = PAL.graphDark; // cross-brace
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 11, y + 4); ctx.lineTo(x + 10, y - 14);
  ctx.moveTo(x + 11, y + 4); ctx.lineTo(x - 10, y - 14);
  ctx.stroke();
  ctx.strokeStyle = '#4A4650'; // ladder
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x - 2.5, y + 8); ctx.lineTo(x - 2.5, y - 22);
  ctx.moveTo(x + 2.5, y + 8); ctx.lineTo(x + 2.5, y - 22);
  for (let ry = y + 5; ry > y - 22; ry -= 4) { ctx.moveTo(x - 2.5, ry); ctx.lineTo(x + 2.5, ry); }
  ctx.stroke();
  // platform + parapet
  ctx.fillStyle = PAL.graphDark;
  ctx.fillRect(x - 14, y - 26, 28, 6);
  ctx.fillStyle = PAL.graphMid;
  ctx.fillRect(x - 14, y - 30, 28, 5);
  ctx.fillStyle = PAL.moonsteel;
  ctx.fillRect(x - 14, y - 30, 28, 1.2);
  ctx.fillStyle = PAL.graphPlate; // parapet posts
  ctx.fillRect(x - 14, y - 36, 2.5, 7);
  ctx.fillRect(x + 11.5, y - 36, 2.5, 7);
  // level trim: gold service stripes on the platform face
  ctx.fillStyle = PAL.lythAmber;
  for (let i = 0; i < lvl; i++) ctx.fillRect(x - 12 + i * 6, y - 25, 4, 2);
  // watch lamp — relay cyan, brighter when manned
  const manned = (tw.occupant ?? null) != null;
  ctx.save();
  ctx.fillStyle = PAL.relay;
  ctx.shadowColor = PAL.relay;
  ctx.shadowBlur = manned ? 9 : 5;
  ctx.beginPath(); ctx.arc(x, y - 34, manned ? 2.4 : 1.8, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  lights.push({ x, y: y - 30, r: manned ? 52 : 30, rgb: '111,216,242', a: manned ? 0.1 : 0.06 });
  if (tw.maxHp && tw.hp != null && tw.hp < tw.maxHp) drawHpPips(ctx, x, y - 44, tw.hp / tw.maxHp);
}

// ===================== ANCHOR SIEGE (MOBA) WORLD PIECES =====================
// Pure-additive draws, gated on snap.mode === 'siege' at the call site. World
// space inside the camera transform; same inView() culling as everything else.

// Faint, team-neutral dashed polylines so players can read the two lanes.
// Drawn FIRST (under everything) — the call site sits right after terrain.
function drawSiegeLanes(ctx, lanes, inView, t) {
  if (!lanes || !lanes.length) return;
  ctx.save();
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([10, 12]);
  ctx.lineDashOffset = -(t * 14) % 22; // a slow crawl toward the enemy core
  ctx.strokeStyle = 'rgba(143,156,184,0.16)';
  for (const lane of lanes) {
    if (!lane || lane.length < 2) continue;
    // cull whole lane if no waypoint is anywhere near the view
    let any = false;
    for (const wp of lane) { if (inView(wp[0], wp[1], 240)) { any = true; break; } }
    if (!any) continue;
    ctx.beginPath();
    ctx.moveTo(lane[0][0], lane[0][1]);
    for (let i = 1; i < lane.length; i++) ctx.lineTo(lane[i][0], lane[i][1]);
    ctx.stroke();
  }
  ctx.restore();
}

// A team-colored turret glyph (diamond tower) with a thin hp pip bar above it.
// Destroyed towers read as grey rubble with no bar. Level 2/3 sit a touch bigger.
function drawSiegeTower(ctx, tw, t, lights) {
  const { x, y } = tw;
  const lvl = Math.max(1, tw.level | 0 || 1);
  const s = 0.6 * TILE * (1 + (Math.min(3, lvl) - 1) * 0.12); // ~0.6*TILE, +12%/lvl
  const destroyed = !!tw.destroyed;
  shadowBlob(ctx, x, y + s * 0.55, s * 0.7, s * 0.3);
  if (destroyed) {
    // rubble: a squat grey heap, no hp bar
    ctx.save();
    ctx.fillStyle = '#33363f';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.6, y + s * 0.5);
    ctx.lineTo(x - s * 0.25, y - s * 0.1);
    ctx.lineTo(x + s * 0.15, y + s * 0.15);
    ctx.lineTo(x + s * 0.55, y - s * 0.05);
    ctx.lineTo(x + s * 0.6, y + s * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#23252c';
    ctx.fillRect(x - s * 0.6, y + s * 0.4, s * 1.2, s * 0.14);
    ctx.restore();
    return;
  }
  const col = siegeTeamCol(tw.team);
  const dim = siegeTeamDim(tw.team);
  const frac = Math.max(0, Math.min(1, (tw.hp ?? 1) / (tw.maxHp || 1)));
  const pulse = 0.5 + 0.5 * Math.sin(t * 3 + x * 0.03);
  // base plinth
  ctx.fillStyle = PAL.graphDark;
  ctx.fillRect(x - s * 0.5, y + s * 0.35, s, s * 0.28);
  // turret diamond body
  ctx.save();
  ctx.fillStyle = dim;
  ctx.beginPath();
  ctx.moveTo(x, y - s * 0.85); ctx.lineTo(x + s * 0.6, y);
  ctx.lineTo(x, y + s * 0.45); ctx.lineTo(x - s * 0.6, y);
  ctx.closePath();
  ctx.fill();
  // lit team-colored inner core
  ctx.fillStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur = 6 + 3 * pulse;
  ctx.beginPath();
  ctx.moveTo(x, y - s * 0.5); ctx.lineTo(x + s * 0.32, y);
  ctx.lineTo(x, y + s * 0.22); ctx.lineTo(x - s * 0.32, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // level pips: a tiny stack of ticks at the tip for lvl 2/3
  if (lvl > 1) {
    ctx.fillStyle = PAL.lythGold;
    for (let i = 0; i < Math.min(3, lvl); i++) ctx.fillRect(x - 3.5 + i * 3, y - s * 0.85 - 4, 1.8, 2.4);
  }
  // thin hp pip bar above it (hp / maxHp)
  const bw = s * 1.1, bx = x - bw / 2, by = y - s * 0.85 - 9;
  ctx.fillStyle = 'rgba(20,22,30,0.85)';
  ctx.fillRect(bx - 1, by - 1, bw + 2, 4);
  ctx.fillStyle = col;
  ctx.fillRect(bx, by, bw * frac, 2);
  lights.push({ x, y: y - 4, r: 34, rgb: hexRgb(col), a: 0.07 + 0.04 * pulse });
}

// Cheap team-colored minion dots (~0.3*TILE) with a tiny hp tick when hurt.
function drawSiegeMinion(ctx, m, t) {
  const r = 0.3 * TILE;
  const col = siegeTeamCol(m.team);
  shadowBlob(ctx, m.x, m.y + r * 0.5, r * 0.7, r * 0.3);
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(m.x, m.y - r); ctx.lineTo(m.x + r * 0.78, m.y);
  ctx.lineTo(m.x, m.y + r); ctx.lineTo(m.x - r * 0.78, m.y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; // small highlight
  ctx.fillRect(m.x - 1, m.y - r * 0.5, 2, 2);
  if (m.maxHp && m.hp != null && m.hp < m.maxHp) {
    const frac = Math.max(0, Math.min(1, m.hp / m.maxHp));
    const bw = r * 1.6, bx = m.x - bw / 2, by = m.y - r - 4;
    ctx.fillStyle = 'rgba(20,22,30,0.8)';
    ctx.fillRect(bx - 0.5, by - 0.5, bw + 1, 2.5);
    ctx.fillStyle = col;
    ctx.fillRect(bx, by, bw * frac, 1.5);
  }
}

// '#rrggbb' -> 'r,g,b' for the lights pool (rgb strings, not hex).
function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

// Prominent screen-space hp bars per team: team 0 top-left, team 1 top-right.
// Pulses when that team's core is open (towers down → vulnerable). Screen space.
function drawSiegeCoreBars(ctx, VW, cores, siege, t) {
  const open = siege?.open ?? [];
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  for (const c of cores) {
    const team = (c.team | 0) % 2;
    const col = siegeTeamCol(team);
    const frac = Math.max(0, Math.min(1, (c.hp ?? 0) / (c.maxHp || 1)));
    const bw = 188, bh = 16;
    const x = team === 0 ? 16 : VW - 16 - bw;
    const y = 16;
    const vuln = !!open[team];
    const pulse = vuln ? 0.5 + 0.5 * Math.sin(t * 6) : 0;
    // frame
    ctx.fillStyle = 'rgba(13,14,24,0.9)';
    ctx.fillRect(x - 2, y - 2, bw + 4, bh + 4);
    ctx.strokeStyle = vuln ? `rgba(255,255,255,${0.45 + 0.45 * pulse})` : 'rgba(143,156,184,0.5)';
    ctx.lineWidth = vuln ? 2 : 1;
    ctx.strokeRect(x - 2, y - 2, bw + 4, bh + 4);
    // depleted track + fill
    ctx.fillStyle = 'rgba(30,32,40,0.95)';
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = col;
    if (vuln) { ctx.shadowColor = col; ctx.shadowBlur = 8 + 6 * pulse; }
    const fw = bw * frac;
    ctx.fillRect(team === 0 ? x : x + bw - fw, y, fw, bh);
    ctx.shadowBlur = 0;
    // label
    ctx.fillStyle = '#0B0A14';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = team === 0 ? 'left' : 'right';
    const lx = team === 0 ? x + 5 : x + bw - 5;
    const label = `${vuln ? 'OPEN  ' : ''}CORE ${Math.max(0, Math.round(c.hp ?? 0))}/${c.maxHp || 0}`;
    ctx.fillText(label, lx, y + bh - 4);
  }
  ctx.restore();
}

// Team allegiance ring drawn UNDER a siege operative so allies (blue, team 0)
// vs enemies (red, team 1) read at a glance. The LOCAL player(s) get a brighter,
// thicker double ring plus a "YOU" caret bobbing overhead. World space; the
// call site already culls by inView and gates on snap.mode === 'siege'.
function drawSiegeTeamRing(ctx, x, y, team, isMe, t) {
  const col = siegeTeamCol(team);
  ctx.save();
  // flat ground disc + ring, a touch larger than the operative's focus ellipse
  ctx.fillStyle = `rgba(${hexRgb(col)},${isMe ? 0.26 : 0.16})`;
  ctx.beginPath();
  ctx.ellipse(x, y + 9, isMe ? 19 : 16.5, isMe ? 9 : 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.shadowColor = col;
  if (isMe) {
    // local operative: bright, pulsing, double-stroked
    const pulse = 0.7 + 0.3 * Math.sin(t * 5);
    ctx.globalAlpha = 0.55 + 0.4 * pulse;
    ctx.lineWidth = 2.6;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.ellipse(x, y + 9, 19, 9, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(x, y + 9, 22.5, 10.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    // a "YOU" caret bobbing above the head
    const bob = Math.sin(t * 4) * 1.5;
    ctx.globalAlpha = 0.92;
    ctx.shadowBlur = 6;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x, y - 30 + bob);
    ctx.lineTo(x - 5, y - 37 + bob);
    ctx.lineTo(x + 5, y - 37 + bob);
    ctx.closePath();
    ctx.fill();
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 3;
    ctx.fillText('YOU', x, y - 40 + bob);
  } else {
    ctx.globalAlpha = 0.62;
    ctx.lineWidth = 1.8;
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.ellipse(x, y + 9, 16.5, 8, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// Screen-space objective marker for siege: for each local operative the ENEMY
// core is the goal. Off-screen → an edge chevron in the enemy team color labeled
// "ANCHOR" (pulsing brighter when that core is OPEN/vulnerable); on-screen → a
// faint target reticle on the core itself. Gated on snap.mode === 'siege' at the
// call site; drawn outside the camera transform alongside the other HUD markers.
function drawSiegeEnemyAnchor(ctx, camera, cores, siege, localTeams, t) {
  const open = siege?.open ?? [];
  ctx.save();
  for (const team of localTeams) {
    const enemyTeam = (team | 0) % 2 === 0 ? 1 : 0;
    const core = cores.find(c => ((c.team | 0) % 2) === enemyTeam);
    if (!core || core.x == null) continue;
    const col = siegeTeamCol(enemyTeam);
    const vuln = !!open[enemyTeam];
    const pulse = vuln ? 0.55 + 0.45 * Math.sin(t * 6) : 0;
    const onScreen = camInView(camera, core.x, core.y, -10);
    if (onScreen) {
      // faint target reticle on the visible core
      const [sx, sy] = camToScreen(camera, core.x, core.y);
      const r = 26 + (vuln ? 3 * pulse : 0);
      ctx.globalAlpha = (vuln ? 0.5 + 0.4 * pulse : 0.32);
      ctx.strokeStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = vuln ? 10 : 4;
      ctx.lineWidth = vuln ? 2 : 1.4;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.stroke();
      // four corner ticks
      ctx.beginPath();
      for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        ctx.moveTo(sx + Math.cos(a) * (r - 5), sy + Math.sin(a) * (r - 5));
        ctx.lineTo(sx + Math.cos(a) * (r + 5), sy + Math.sin(a) * (r + 5));
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = col;
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(vuln ? 'ANCHOR · OPEN' : 'ANCHOR', sx, sy - r - 6);
    } else {
      // edge chevron pointing at the off-screen enemy core
      const VW = camera.vw, VH = camera.vh, M = 46;
      let [sx, sy] = camToScreen(camera, core.x, core.y);
      const cx = VW / 2, cy = VH / 2;
      const dx = sx - cx, dy = sy - cy;
      const fx = dx ? (dx > 0 ? (VW - M - cx) / dx : (M - cx) / dx) : Infinity;
      const fy = dy ? (dy > 0 ? (VH - M - cy) / dy : (M - cy) / dy) : Infinity;
      const f = Math.min(fx, fy);
      sx = cx + dx * f; sy = cy + dy * f;
      const a = Math.atan2(dy, dx);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(a);
      ctx.fillStyle = col;
      ctx.globalAlpha = vuln ? 0.8 + 0.2 * pulse : 0.85;
      ctx.shadowColor = col;
      ctx.shadowBlur = vuln ? 10 + 8 * pulse : 8;
      const sc = vuln ? 1 + 0.18 * pulse : 1; // the open core's chevron breathes
      // a double-chevron (>>) so it reads as "objective" not a teammate ping
      ctx.beginPath();
      ctx.moveTo(13 * sc, 0); ctx.lineTo(-2 * sc, -9 * sc); ctx.lineTo(-2 * sc, 9 * sc);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha *= 0.7;
      ctx.beginPath();
      ctx.moveTo(4 * sc, 0); ctx.lineTo(-11 * sc, -9 * sc); ctx.lineTo(-11 * sc, 9 * sc);
      ctx.closePath(); ctx.fill();
      ctx.rotate(-a);
      ctx.globalAlpha = 0.95;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.shadowBlur = 3;
      ctx.fillText(vuln ? 'ANCHOR · OPEN' : 'ANCHOR', 0, dy > 0 ? -16 : 24);
      ctx.restore();
    }
  }
  ctx.restore();
}

// 'K' — the base core: a monolith heart of warm LYTH. Lose it, lose the night.
function drawCore(ctx, core, t, lights) {
  const { x, y } = core;
  const frac = Math.max(0, Math.min(1, (core.hp ?? 30) / (core.maxHp || 30)));
  const alarm = Math.min(1, coreAlarmT);
  const beat = 0.6 + 0.4 * Math.sin(t * (2 + (1 - frac) * 5));
  shadowBlob(ctx, x + 2, y + 7, 17, 6);
  ctx.fillStyle = PAL.graphDark; // plinth
  ctx.fillRect(x - 15, y + 2, 30, 6);
  ctx.fillStyle = PAL.graphPlate;
  ctx.fillRect(x - 13, y - 2, 26, 5);
  ctx.fillStyle = PAL.graphMid; // monolith body
  ctx.beginPath();
  ctx.moveTo(x - 10, y + 2); ctx.lineTo(x - 6.5, y - 42);
  ctx.lineTo(x + 6.5, y - 42); ctx.lineTo(x + 10, y + 2);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = PAL.graphDark; // right facet in shadow
  ctx.beginPath();
  ctx.moveTo(x + 4, y + 2); ctx.lineTo(x + 3, y - 42);
  ctx.lineTo(x + 6.5, y - 42); ctx.lineTo(x + 10, y + 2);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = PAL.moonsteel; // moonlit left bevel
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x - 9, y + 2); ctx.lineTo(x - 5.5, y - 42);
  ctx.stroke();
  // the warm heart seam — dims and beats faster as the core fails
  ctx.save();
  const hg = ctx.createLinearGradient(0, y, 0, y - 38);
  hg.addColorStop(0, PAL.ember);
  hg.addColorStop(0.5, PAL.lythAmber);
  hg.addColorStop(1, PAL.lythGold);
  ctx.fillStyle = hg;
  ctx.shadowColor = PAL.lythAmber;
  ctx.shadowBlur = 10 * beat * (0.4 + 0.6 * frac);
  ctx.globalAlpha *= (0.45 + 0.55 * frac) * (0.6 + 0.4 * beat);
  ctx.fillRect(x - 1.8, y - 38, 3.6, 36);
  ctx.restore();
  // hp ring around the plinth
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(30,32,40,0.9)';
  ctx.beginPath(); ctx.arc(x, y + 4, 20, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = frac > 0.5 ? PAL.teal : frac > 0.25 ? PAL.lythAmber : PAL.red;
  ctx.beginPath(); ctx.arc(x, y + 4, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
  ctx.stroke();
  ctx.restore();
  // alarm: breach-red flare while the Entropy grinds at the heart
  if (alarm > 0) {
    const fa = Math.max(0, alarm * (0.4 + 0.4 * Math.sin(t * 18)));
    ctx.save();
    ctx.strokeStyle = `rgba(224,72,72,${fa})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 10, y + 2); ctx.lineTo(x - 6.5, y - 42);
    ctx.lineTo(x + 6.5, y - 42); ctx.lineTo(x + 10, y + 2);
    ctx.closePath(); ctx.stroke();
    ctx.restore();
    lights.push({ x, y: y - 16, r: 80, rgb: '224,72,72', a: 0.12 * alarm });
  }
  lights.push({ x, y: y - 18, r: 76, rgb: '240,169,60', a: (0.07 + 0.05 * beat) * (0.3 + 0.7 * frac) });
}

// 'S' — trader stall: lantern-lit counter; the carousel appears while in use.
function drawShop(ctx, s, t, snap, lights) {
  const { x, y } = s;
  shadowBlob(ctx, x, y + 8, 16, 5.5);
  ctx.fillStyle = PAL.graphDark; // counter
  ctx.fillRect(x - 16, y - 2, 32, 9);
  ctx.fillStyle = '#3A3F4E';
  ctx.fillRect(x - 16, y - 5, 32, 4);
  ctx.fillStyle = PAL.moonsteel;
  ctx.fillRect(x - 16, y - 5, 32, 1);
  ctx.strokeStyle = '#4A4650'; // canopy posts
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 14, y - 5); ctx.lineTo(x - 15, y - 24);
  ctx.moveTo(x + 14, y - 5); ctx.lineTo(x + 15, y - 24);
  ctx.stroke();
  for (let i = 0; i < 5; i++) { // teal-striped awning
    ctx.fillStyle = i % 2 ? PAL.dteal : PAL.teal;
    ctx.beginPath();
    ctx.moveTo(x - 18 + i * 7.2, y - 24);
    ctx.lineTo(x - 18 + (i + 1) * 7.2, y - 24);
    ctx.lineTo(x - 18 + i * 7.2 + 3.6, y - 19);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = PAL.lythGold; // wares on the counter
  ctx.fillRect(x - 10, y - 8, 3.5, 3);
  ctx.fillStyle = PAL.relay;
  ctx.fillRect(x - 2, y - 8.5, 4, 3.5);
  ctx.fillStyle = '#d8e2ee';
  ctx.fillRect(x + 6, y - 8, 4, 3);
  // hanging lantern — the warm trade light
  const j = flick(Math.floor(t * 7) + x);
  ctx.strokeStyle = PAL.steel;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 11, y - 24); ctx.lineTo(x + 11, y - 18); ctx.stroke();
  ctx.save();
  ctx.fillStyle = PAL.lythGold;
  ctx.shadowColor = PAL.lythAmber;
  ctx.shadowBlur = 8;
  ctx.fillRect(x + 9, y - 18, 4, 5);
  ctx.restore();
  lights.push({ x: x + 11, y: y - 15, r: 52, rgb: '255,217,138', a: 0.12 + j * 0.03 });
  // world-space carousel only while an operator is actually browsing (the
  // sim ships p.shop on the shopper). Players driving a turret typeSelect
  // never count — the two panels must not stack.
  let shopper = null;
  for (const p of snap.players ?? []) {
    if (p.state !== 'active' || p.selecting || !p.shop) continue;
    if ((p.x - x) ** 2 + (p.y - y) ** 2 < (TILE * 1.5) ** 2) { shopper = p; break; }
  }
  if (!shopper) return;
  const sel = Math.max(0, Math.min(SHOP_OFFERS.length - 1, shopper.shop.idx ?? 0));
  const pw = 172, phh = 16 + SHOP_OFFERS.length * 14 + 14;
  const px = x - pw / 2, py = y - 36 - phh;
  ctx.save();
  ctx.fillStyle = 'rgba(13,14,24,0.92)';
  ctx.strokeStyle = 'rgba(23,74,74,0.9)';
  ctx.lineWidth = 1.5;
  ctx.fillRect(px, py, pw, phh);
  ctx.strokeRect(px, py, pw, phh);
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = PAL.teal;
  ctx.fillText('FRONTIER TRADER', px + 8, py + 11);
  SHOP_OFFERS.forEach(([label, cost], i) => {
    const ry = py + 16 + i * 14;
    if (i === sel) {
      ctx.fillStyle = 'rgba(111,216,242,0.14)';
      ctx.fillRect(px + 3, ry - 2, pw - 6, 13);
      ctx.fillStyle = PAL.relay;
      ctx.fillText('▶', px + 6, ry + 8);
    }
    ctx.fillStyle = i === sel ? PAL.anchor : 'rgba(191,208,232,0.75)';
    ctx.fillText(label, px + 16, ry + 8);
    ctx.textAlign = 'right';
    ctx.fillStyle = PAL.lythGold;
    ctx.fillText(`${cost}◆`, px + pw - 8, ry + 8);
    ctx.textAlign = 'left';
  });
  ctx.fillStyle = 'rgba(94,107,140,0.9)';
  ctx.fillText('◄ ► BROWSE · FIRE = BUY', px + 8, py + phh - 5);
  ctx.restore();
}

// 'H' — hire post: an operator warms their hands by a signal fire until paid.
// Post jobs work their station on the field (farmer/engineer/smith). Combat
// jobs (hound/archer/caster) leave the post and render as g.followers instead,
// so a 'hired' combat post stays an empty signpost until it restocks.
const POST_JOBS = new Set(['farmer', 'engineer', 'smith']);

// The hired hand standing at their post, working. One body per post job so a
// hired farmer/engineer/smith reads on the field (the unhired hooded recruit
// is drawn separately, below). Pure render — the sim already runs the effect.
function drawHiredWorker(ctx, h, t, lights) {
  const { x, y } = h;
  const job = String(h.job ?? '');
  // worker stands just left of the signal fire; a slow work-cycle drives props
  const wx = x - 1, wy = y;
  const cyc = t * 2.2 + x * 0.11;          // the swing/till/strike cadence
  const swing = Math.sin(cyc);
  const bob = Math.abs(Math.cos(cyc)) * 0.9;
  shadowBlob(ctx, wx, wy + 7, 6.5, 3);
  // legs (a small planted stance)
  ctx.fillStyle = '#232533';
  ctx.fillRect(wx - 3.4, wy + 1, 2.8, 5);
  ctx.fillRect(wx + 0.6, wy + 1, 2.8, 5);
  // torso — work tunic, owner-neutral earth tones so it reads as a townsfolk
  ctx.fillStyle = '#5A4A34';
  ctx.beginPath(); ctx.ellipse(wx, wy - 2 + bob, 5, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(11,10,20,0.3)';
  ctx.beginPath(); ctx.ellipse(wx, wy + 1 + bob, 3.6, 3.4, 0, 0, Math.PI); ctx.fill();
  // head
  ctx.fillStyle = '#C79A6E';
  ctx.beginPath(); ctx.arc(wx, wy - 9 + bob, 3.4, 0, Math.PI * 2); ctx.fill();
  if (job === 'farmer') {
    // straw hat
    ctx.fillStyle = '#C9A24B';
    ctx.beginPath(); ctx.ellipse(wx, wy - 10 + bob, 5.4, 1.9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(wx, wy - 11.6 + bob, 2.8, 2.4, 0, 0, Math.PI * 2); ctx.fill();
    // hoe: shaft swings down toward the soil
    const ang = -0.5 + swing * 0.5;
    ctx.save(); ctx.translate(wx + 3, wy - 4 + bob); ctx.rotate(ang);
    ctx.strokeStyle = '#6E5A3A'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(0, 8); ctx.stroke();
    ctx.fillStyle = '#8A98B8'; ctx.fillRect(-2.4, 7.5, 4.5, 2);
    ctx.restore();
    // a sprig of LYTH-gold grain by the worker's feet
    ctx.strokeStyle = PAL.lythGold; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(wx + 6, wy + 6); ctx.lineTo(wx + 6, wy + 1); ctx.stroke();
  } else if (job === 'engineer') {
    // goggled cap
    ctx.fillStyle = '#3A4258';
    ctx.beginPath(); ctx.arc(wx, wy - 10 + bob, 3.6, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PAL.teal;
    ctx.fillRect(wx - 3, wy - 9.4 + bob, 6, 1.4);
    // wrench raised and turning
    const ang = 0.4 + swing * 0.7;
    ctx.save(); ctx.translate(wx + 3.5, wy - 5 + bob); ctx.rotate(ang);
    ctx.strokeStyle = '#8A98B8'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(0, -5); ctx.stroke();
    ctx.fillStyle = '#8A98B8';
    ctx.beginPath(); ctx.arc(0, -6, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PAL.voidNight;
    ctx.beginPath(); ctx.arc(0, -6, 1, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // a wrench-glint spark on the turn
    if (swing > 0.6) {
      ctx.fillStyle = PAL.lythPale;
      ctx.fillRect(wx + 5, wy - 11 + bob, 1.4, 1.4);
    }
  } else { // smith
    // leather apron
    ctx.fillStyle = '#4A2E1E';
    ctx.beginPath(); ctx.moveTo(wx - 3.4, wy - 4 + bob); ctx.lineTo(wx + 3.4, wy - 4 + bob);
    ctx.lineTo(wx + 2.6, wy + 4 + bob); ctx.lineTo(wx - 2.6, wy + 4 + bob); ctx.closePath(); ctx.fill();
    // small anvil at the worker's side, faint forge glow on the strike
    ctx.fillStyle = '#3A3A44';
    ctx.fillRect(wx + 4, wy + 1, 6, 2.4);
    ctx.fillRect(wx + 5.5, wy + 3, 2.6, 3);
    // hammer comes down on the upbeat
    const lift = swing > 0 ? swing : 0;
    const ang = -1.1 + (1 - lift) * 1.0;
    ctx.save(); ctx.translate(wx + 4.5, wy - 5 + bob); ctx.rotate(ang);
    ctx.strokeStyle = '#6E5A3A'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(0, -5); ctx.stroke();
    ctx.fillStyle = '#5E6880'; ctx.fillRect(-2.6, -7, 5.2, 3);
    ctx.restore();
    if (swing < -0.6) { // sparks fly when the hammer lands
      ctx.fillStyle = PAL.lythAmber;
      ctx.fillRect(wx + 6, wy + 0.5, 1.4, 1.4);
      ctx.fillStyle = PAL.lythGold;
      ctx.fillRect(wx + 8, wy - 0.5, 1, 1);
      lights.push({ x: wx + 6, y: wy + 1, r: 22, rgb: '240,169,60', a: 0.18 });
    }
  }
  rimArc(ctx, wx, wy - 6 + bob, 6, 0.3);
}

function drawHirePost(ctx, h, t, lights) {
  const { x, y } = h;
  shadowBlob(ctx, x, y + 8, 13, 4.5);
  ctx.strokeStyle = '#4A4232'; // signpost
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(x - 10, y + 6); ctx.lineTo(x - 10, y - 18); ctx.stroke();
  ctx.fillStyle = '#4A4232';
  ctx.fillRect(x - 17, y - 18, 15, 8);
  ctx.strokeStyle = '#332E20';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 17, y - 18, 15, 8);
  ctx.save();
  ctx.fillStyle = h.hired ? PAL.teal : PAL.lythGold; // job tag on the plank
  ctx.font = 'bold 7px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(String(h.job ?? 'hand').slice(0, 5).toUpperCase(), x - 9.5, y - 12);
  ctx.restore();
  // signal fire
  const j = flick(Math.floor(t * 8) + x * 1.7);
  ctx.fillStyle = '#17141A';
  ctx.beginPath(); ctx.ellipse(x + 8, y + 5, 7, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  const fl = 0.85 + j * 0.3;
  ctx.fillStyle = PAL.lythAmber;
  tear(ctx, x + 8, y + 3, 3 * fl, 7 * fl);
  ctx.fillStyle = PAL.lythGold;
  tear(ctx, x + 8, y + 4, 1.9 * fl, 4.5);
  lights.push({ x: x + 8, y: y + 2, r: 40, rgb: '240,169,60', a: 0.1 + j * 0.03 });
  if (!h.hired) {
    // the waiting operator — hooded, face never shown
    const bob = Math.sin(t * 1.3 + x * 0.07) * 0.8;
    ctx.fillStyle = '#2C3148';
    ctx.beginPath();
    ctx.moveTo(x - 1, y - 10 + bob);
    ctx.quadraticCurveTo(x + 6, y - 4, x + 5.5, y + 6);
    ctx.lineTo(x - 7.5, y + 6);
    ctx.quadraticCurveTo(x - 8, y - 4, x - 1, y - 10 + bob);
    ctx.fill();
    ctx.beginPath(); ctx.arc(x - 1, y - 7 + bob, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PAL.voidNight;
    ctx.beginPath(); ctx.arc(x - 1, y - 6.5 + bob, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(255,217,138,${0.55 + j * 0.3})`; // firelit visor glint
    ctx.fillRect(x - 2.4, y - 7.4 + bob, 3, 1.1);
    drawPrompt(ctx, x, y - 30, `[E/X] HIRE ${h.cost ?? ''}◆ ${String(h.job ?? '').toUpperCase()}`, t);
  } else if (POST_JOBS.has(String(h.job ?? ''))) {
    // hired post worker is on station, doing their job. Combat hires (hound/
    // archer/caster) leave the post for the field and render as followers, so
    // their hired post stays an empty signpost until it restocks — unchanged.
    drawHiredWorker(ctx, h, t, lights);
  }
}

// Built 'farm' plot — four visual growth stages; LYTH-gold grain at stage 3.
function drawFarm(ctx, b, t, lights) {
  const { x, y } = b;
  const stage = Math.max(0, Math.min(3, b.stage ?? 0));
  ctx.fillStyle = '#2A2218'; // tilled plot
  ctx.fillRect(x - 18, y - 12, 36, 24);
  ctx.strokeStyle = '#3A301E';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x - 18, y - 12, 36, 24);
  ctx.strokeStyle = 'rgba(11,10,20,0.5)'; // furrows
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const fy of [-6, 0, 6]) { ctx.moveTo(x - 15, y + fy); ctx.lineTo(x + 15, y + fy); }
  ctx.stroke();
  ctx.fillStyle = '#4A4232'; // corner stakes
  for (const [sx2, sy2] of [[-17, -11], [14, -11], [-17, 8], [14, 8]]) ctx.fillRect(x + sx2, y + sy2, 3, 3);
  if (stage === 0) {
    ctx.fillStyle = '#5E5640'; // fresh seed specks
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(x - 13 + (i % 3) * 11 + flick(x + i * 3.1) * 4, y - 7 + Math.floor(i / 3) * 11, 1.5, 1.5);
    }
    return;
  }
  for (let i = 0; i < 9; i++) {
    const px2 = x - 12 + (i % 3) * 12 + (flick(x + i * 2.7) - 0.5) * 4;
    const py2 = y - 6 + Math.floor(i / 3) * 8;
    const sway = Math.sin(t * 1.8 + i * 1.9) * (stage === 3 ? 1.2 : 0.5);
    if (stage === 1) {
      ctx.strokeStyle = '#3D5A4A';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(px2, py2 + 2); ctx.lineTo(px2 + sway, py2 - 2); ctx.stroke();
    } else {
      const hh = stage === 2 ? 6 : 9;
      ctx.strokeStyle = stage === 3 ? '#4E6A3A' : '#3D5A4A';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(px2, py2 + 3);
      ctx.quadraticCurveTo(px2 + sway, py2 - hh * 0.5, px2 + sway, py2 - hh);
      ctx.stroke();
      ctx.beginPath(); // leaves
      ctx.moveTo(px2 + sway * 0.5, py2 - hh * 0.45); ctx.lineTo(px2 + sway * 0.5 - 2.5, py2 - hh * 0.45 - 1.5);
      ctx.moveTo(px2 + sway * 0.6, py2 - hh * 0.7); ctx.lineTo(px2 + sway * 0.6 + 2.5, py2 - hh * 0.7 - 1.5);
      ctx.stroke();
      if (stage === 3) {
        ctx.fillStyle = PAL.lythGold; // ripe grain head
        ctx.fillRect(px2 + sway - 1.2, py2 - hh - 3, 2.4, 3.6);
      }
    }
  }
  if (stage === 3) lights.push({ x, y: y - 4, r: 34, rgb: '255,217,138', a: 0.07 + 0.02 * Math.sin(t * 2 + x * 0.1) });
}

// 'D' — ctf flag. At base: banner flying from its stone stand. Dropped:
// leaning where it fell, with a return-timer pulse. Carried: see the
// player pass (drawCarriedFlag).
function drawFlag(ctx, f, t, lights) {
  const { x, y } = f;
  const team = (f.team ?? 0) % 2;
  const col = TEAM_COL[team], rgb = TEAM_RGB[team];
  const atBase = f.atBase ?? true;
  if (atBase) {
    ctx.fillStyle = PAL.graphDark; // stand: stone ring base
    ctx.beginPath(); ctx.ellipse(x, y + 6, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = PAL.graphPlate;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, y + 5, 9, 3.8, 0, 0, Math.PI * 2); ctx.stroke();
  }
  shadowBlob(ctx, x + 2, y + 6, 7, 3);
  ctx.save();
  ctx.translate(x, y);
  if (!atBase) ctx.rotate(0.45); // leaning where it fell
  ctx.strokeStyle = PAL.moonsteel; // pole
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(0, -26); ctx.stroke();
  ctx.fillStyle = PAL.coldHi;
  ctx.beginPath(); ctx.arc(0, -27, 1.6, 0, Math.PI * 2); ctx.fill();
  const wv = Math.sin(t * 5 + x * 0.1) * 2; // waving banner
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(0, -26);
  ctx.quadraticCurveTo(8, -25 + wv, 15, -23 + wv);
  ctx.lineTo(13, -18 + wv * 0.6);
  ctx.quadraticCurveTo(7, -19, 0, -17);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(11,10,20,0.55)'; // sigil notch
  ctx.fillRect(4, -23 + wv * 0.5, 3, 3);
  ctx.restore();
  if (!atBase) {
    // dropped: return pulse — the sim sends it home after 8s
    const pr = fract(t * 0.9);
    ctx.strokeStyle = `rgba(${rgb},${(1 - pr) * 0.5})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 8 + pr * 16, 0, Math.PI * 2); ctx.stroke();
  }
  lights.push({ x, y: y - 18, r: 34, rgb, a: 0.08 });
}

// Banner strapped to a flag carrier, streaming behind them.
function drawCarriedFlag(ctx, x, y, f, t) {
  const team = (f.team ?? 0) % 2;
  const col = TEAM_COL[team];
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = PAL.moonsteel;
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-3, 2); ctx.lineTo(6, -30); ctx.stroke();
  const wv = Math.sin(t * 7) * 2.5;
  ctx.fillStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(6, -30);
  ctx.quadraticCurveTo(14, -28 + wv, 21, -25 + wv);
  ctx.lineTo(18, -20 + wv * 0.5);
  ctx.quadraticCurveTo(12, -23, 5, -22);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = `rgba(${TEAM_RGB[team]},0.35)`; // streamer trail
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(5, -24);
  ctx.quadraticCurveTo(-6, -22 + wv, -14, -18 - wv);
  ctx.stroke();
  ctx.restore();
}

// A lure cracker mid-lob: tumbling red charge on its overWalls arc.
function drawCrackerFlight(ctx, c, t) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(t * 9);
  ctx.fillStyle = '#8C2A22';
  ctx.fillRect(-4, -2.5, 8, 5);
  ctx.fillStyle = '#C75B22';
  ctx.fillRect(-4, -2.5, 8, 1.7);
  if (Math.floor(t * 12) % 2 === 0) {
    ctx.fillStyle = PAL.lythPale;
    ctx.shadowColor = PAL.lythGold;
    ctx.shadowBlur = 7;
    ctx.fillRect(3.4, -4.4, 2, 2);
  }
  ctx.restore();
}

// A landed lure cracker: blinking charge + attract-radius pulse out to the
// 9-tile lure range. The boom FX arrives via the 'crackerBoom' event.
function drawCrackerCharge(ctx, c, t, lights) {
  const k = 1 - c.life / c.max; // 0 fresh -> 1 about to blow
  const on = Math.floor(t * (4 + k * 14)) % 2 === 0;
  shadowBlob(ctx, c.x, c.y + 3, 5, 2);
  const pr = fract(t * 0.8 + c.max - c.life);
  ctx.strokeStyle = `rgba(240,169,60,${(1 - pr) * 0.22})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(c.x, c.y, 10 + pr * (TILE * 9 - 10), 0, Math.PI * 2); ctx.stroke();
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(0.5);
  ctx.fillStyle = '#8C2A22'; // stubby red shell
  ctx.fillRect(-5, -3, 10, 6);
  ctx.fillStyle = '#C75B22';
  ctx.fillRect(-5, -3, 10, 2);
  ctx.fillStyle = PAL.graphDark; // crimped caps
  ctx.fillRect(-6, -3, 1.6, 6);
  ctx.fillRect(4.4, -3, 1.6, 6);
  ctx.restore();
  if (on) {
    ctx.save();
    ctx.fillStyle = PAL.lythPale; // fuse spark
    ctx.shadowColor = PAL.lythGold;
    ctx.shadowBlur = 9;
    ctx.beginPath(); ctx.arc(c.x + 4, c.y - 5, 1.6 + k, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    lights.push({ x: c.x, y: c.y, r: 26 + k * 14, rgb: '240,169,60', a: 0.14 });
  }
}

// Night-wave mutation reads: each mutation gets one unmistakable overlay.
function drawMutation(ctx, e, t, lights) {
  const r = (KIND_R[e.kind] || 13) * (e.mutation === 'bulk' ? 1.22 : 1);
  if (e.mutation === 'feral') {
    // speed streaks shedding off the body
    ctx.save();
    ctx.strokeStyle = `rgba(191,251,255,${0.3 + 0.25 * flick(Math.floor(t * 14) + e.id)})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = -1; i <= 1; i++) {
      const ox = -e.fy * i * 5, oy = e.fx * i * 5;
      const len = r + 10 + flick(i * 3 + Math.floor(t * 10) + e.id) * 8;
      ctx.moveTo(e.x - e.fx * (r + 1) + ox, e.y - e.fy * (r + 1) + oy);
      ctx.lineTo(e.x - e.fx * len + ox, e.y - e.fy * len + oy);
    }
    ctx.stroke();
    ctx.restore();
  } else if (e.mutation === 'bulk') {
    // lashed-on armor plates over the swollen body
    ctx.save();
    ctx.fillStyle = PAL.graphPlate;
    ctx.strokeStyle = PAL.graphDark;
    ctx.lineWidth = 1;
    for (const [ox, oy, w, h2] of [[-r * 0.5, -r * 0.45, 8, 5], [r * 0.4, -r * 0.2, 7, 5], [-r * 0.1, r * 0.4, 8, 4.5]]) {
      ctx.fillRect(e.x + ox - w / 2, e.y + oy - h2 / 2, w, h2);
      ctx.strokeRect(e.x + ox - w / 2, e.y + oy - h2 / 2, w, h2);
    }
    ctx.fillStyle = '#5A4A42'; // rust rivets
    ctx.fillRect(e.x - r * 0.5 - 1, e.y - r * 0.45 - 1, 2, 2);
    ctx.fillRect(e.x + r * 0.4 + 1, e.y - r * 0.2, 2, 2);
    ctx.restore();
  } else if (e.mutation === 'volatile') {
    // pulsing orange core — back away before it pops
    const pulse = 0.5 + 0.5 * Math.sin(t * 9 + e.id * 1.7);
    const og = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r * (0.7 + 0.35 * pulse));
    og.addColorStop(0, `rgba(240,169,60,${0.4 + 0.35 * pulse})`);
    og.addColorStop(0.6, `rgba(199,91,34,${0.2 + 0.2 * pulse})`);
    og.addColorStop(1, 'rgba(240,169,60,0)');
    ctx.fillStyle = og;
    ctx.fillRect(e.x - r * 1.1, e.y - r * 1.1, r * 2.2, r * 2.2);
    lights.push({ x: e.x, y: e.y, r: 30, rgb: '240,169,60', a: 0.08 + 0.08 * pulse });
  } else if (e.mutation === 'split') {
    // twin-tail glitch: two ghost forklings already trying to peel off
    const a = Math.atan2(e.fy, e.fx);
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.globalAlpha *= 0.35 + 0.2 * flick(Math.floor(t * 12) + side + e.id);
      ctx.translate(e.x - e.fx * (r + 3) - e.fy * side * 7, e.y - e.fy * (r + 3) + e.fx * side * 7);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = PAL.glitch;
      ctx.beginPath();
      ctx.moveTo(0, -5); ctx.lineTo(4, 3); ctx.lineTo(-4, 3);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
}

// ============================== STATUS EFFECTS ==============================
// Reads enemy status from named timers (stunT/burnT/toxT/convertedT), lite
// booleans (stun/burn/tox/conv[erted]) or a packed numeric e.st
// (1 stun | 2 burn | 4 tox | 8 converted). All optional — classic snapshots
// carry none of these and skip the overlay entirely.
function enemyStatus(e) {
  const packed = typeof e.st === 'number' ? e.st : 0;
  return {
    stun: (e.stunT ?? 0) > 0 || !!e.stun || !!(packed & 1),
    burn: (e.burnT ?? 0) > 0 || !!e.burn || !!(packed & 2),
    tox: (e.toxT ?? 0) > 0 || !!e.tox || !!(packed & 4),
    conv: (e.convertedT ?? 0) > 0 || !!e.converted || !!e.conv || !!(packed & 8),
  };
}

function drawStatusFX(ctx, e, st, t, lights) {
  const r = KIND_R[e.kind] || 13;
  const seed = e.id * 7.31;
  if (st.burn) {
    // aflame: tongues licking off the body + rising embers
    const j = flick(Math.floor(t * 9) + seed);
    for (let i = 0; i < 3; i++) {
      const ox = (flick(seed + i * 2.7) - 0.5) * r * 1.3;
      const oy = (flick(seed + i * 4.3) - 0.5) * r * 0.9 - 2;
      const fl = 0.7 + flick(Math.floor(t * 8) + seed + i * 13) * 0.5;
      ctx.fillStyle = PAL.ember;
      tear(ctx, e.x + ox, e.y + oy, 2.6 * fl, 6.5 * fl);
      ctx.fillStyle = PAL.lythAmber;
      tear(ctx, e.x + ox, e.y + oy + 1, 1.7 * fl, 4.4 * fl);
      if (i === 1) { ctx.fillStyle = PAL.lythGold; tear(ctx, e.x + ox, e.y + oy + 1.6, 1 * fl, 2.6); }
    }
    ctx.save();
    const ba = ctx.globalAlpha;
    ctx.fillStyle = '#E07B39';
    for (let i = 0; i < 3; i++) {
      const pr = fract(t * 0.8 + i * 0.33 + flick(seed + i * 9.1));
      ctx.globalAlpha = ba * (1 - pr) * 0.9;
      ctx.fillRect(e.x + (flick(seed + i * 3.7) - 0.5) * r + Math.sin(pr * 6 + i) * 3, e.y - 4 - pr * (r + 16), 1.6, 1.6);
    }
    ctx.restore();
    lights.push({ x: e.x, y: e.y - 2, r: r + 22, rgb: '240,169,60', a: 0.1 + j * 0.04 });
  }
  if (st.tox) {
    // poisoned: sickly green sheen + drips sliding off the carapace
    ctx.save();
    const ba = ctx.globalAlpha;
    ctx.fillStyle = 'rgba(120,180,70,0.18)';
    ctx.beginPath(); ctx.ellipse(e.x, e.y, r + 1, r * 0.85, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8CC850';
    for (let i = 0; i < 3; i++) {
      const pr = fract(t * 1.1 + i * 0.37 + flick(seed + i * 5.3));
      const dx = e.x + (flick(seed + i * 1.9) - 0.5) * r * 1.5;
      ctx.globalAlpha = ba * (1 - pr) * 0.85;
      ctx.beginPath();
      ctx.ellipse(dx, e.y + r * 0.4 + pr * 9, 1.2, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  if (st.stun) {
    // stunned: white-gold sparks orbiting where a head would be
    const oy = e.y - r - 7;
    ctx.save();
    ctx.strokeStyle = `rgba(255,239,194,${0.65 + 0.3 * Math.sin(t * 14 + seed)})`;
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) {
      const a = t * 5 + (i / 3) * Math.PI * 2;
      const sx = e.x + Math.cos(a) * 8, sy = oy + Math.sin(a) * 3;
      ctx.beginPath();
      ctx.moveTo(sx - 2.4, sy); ctx.lineTo(sx + 2.4, sy);
      ctx.moveTo(sx, sy - 2.4); ctx.lineTo(sx, sy + 2.4);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (st.conv) {
    // mind-controlled: friendly-cyan eye + teal leash ring while it fights for us
    const pulse = 0.5 + 0.5 * Math.sin(t * 6 + seed);
    ctx.save();
    ctx.strokeStyle = `rgba(54,160,138,${0.35 + 0.35 * pulse})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(e.x, e.y, r + 4 + pulse * 2, 0, Math.PI * 2); ctx.stroke();
    // the eye reads ally: relay-cyan, overdrawn at the facing point
    ctx.fillStyle = PAL.relay;
    ctx.shadowColor = PAL.relay;
    ctx.shadowBlur = 9;
    ctx.beginPath();
    ctx.arc(e.x + (e.fx || 0) * 7, e.y + (e.fy || 0) * 7, 2.6, 0, Math.PI * 2);
    ctx.fill();
    // control diamond hovering above
    ctx.fillStyle = `rgba(111,216,242,${0.6 + 0.4 * pulse})`;
    ctx.translate(e.x, e.y - r - 10 + Math.sin(t * 3) * 1.2);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-2.2, -2.2, 4.4, 4.4);
    ctx.restore();
    lights.push({ x: e.x, y: e.y, r: r + 18, rgb: '111,216,242', a: 0.07 + 0.05 * pulse });
  }
}

// ============================== GROUND PATCHES ==============================
// g.patches [{x,y,kind:'burn'|'toxin',r(px),ttl}] — lingering area effects.
// Burn: flickering flame pool. Toxin: bubbling green slick that slows.
function drawPatch(ctx, pa, t, lights) {
  const r = pa.r || TILE * 1.2;
  const fade = pa.ttl != null ? Math.max(0, Math.min(1, pa.ttl / 0.8)) : 1;
  if (fade <= 0) return;
  const seed = pa.x * 0.37 + pa.y * 0.61;
  ctx.save();
  ctx.globalAlpha *= fade;
  if (pa.kind === 'toxin') {
    // bubbling slick
    const g = ctx.createRadialGradient(pa.x, pa.y, 0, pa.x, pa.y, r);
    g.addColorStop(0, 'rgba(86,122,46,0.42)');
    g.addColorStop(0.65, 'rgba(64,94,36,0.3)');
    g.addColorStop(1, 'rgba(52,80,32,0)');
    ctx.fillStyle = g;
    ctx.fillRect(pa.x - r, pa.y - r, r * 2, r * 2);
    ctx.fillStyle = 'rgba(46,66,28,0.5)';
    ctx.beginPath(); ctx.ellipse(pa.x, pa.y, r * 0.85, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(140,200,80,${0.3 + 0.18 * Math.sin(t * 2.2 + seed)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(pa.x, pa.y, r * 0.85, r * 0.6, 0, 0, Math.PI * 2); ctx.stroke();
    // bubbles swell then pop into little rings
    for (let i = 0; i < 7; i++) {
      const bx = pa.x + (flick(seed + i * 3.1) - 0.5) * r * 1.3;
      const by = pa.y + (flick(seed + i * 5.7) - 0.5) * r * 0.85;
      const cyc = fract(t * (0.45 + flick(seed + i) * 0.6) + flick(seed + i * 7.7));
      if (cyc < 0.75) {
        const br = 1 + (cyc / 0.75) * 3;
        ctx.fillStyle = 'rgba(150,210,90,0.5)';
        ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(220,255,180,0.55)';
        ctx.fillRect(bx - br * 0.4, by - br * 0.5, 1.2, 1.2);
      } else {
        const k = (cyc - 0.75) / 0.25;
        ctx.strokeStyle = `rgba(170,230,110,${(1 - k) * 0.55})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(bx, by, 3 + k * 4, 0, Math.PI * 2); ctx.stroke();
      }
    }
    lights.push({ x: pa.x, y: pa.y, r: r * 1.25, rgb: '120,190,70', a: 0.07 * fade });
  } else {
    // burn pool: scorched ground under a low carpet of flame
    ctx.fillStyle = 'rgba(23,20,26,0.6)';
    ctx.beginPath(); ctx.ellipse(pa.x, pa.y, r * 0.9, r * 0.65, 0, 0, Math.PI * 2); ctx.fill();
    const j = flick(Math.floor(t * 9) + seed);
    const eg = ctx.createRadialGradient(pa.x, pa.y, 0, pa.x, pa.y, r * 0.7);
    eg.addColorStop(0, `rgba(199,91,34,${0.34 + j * 0.12})`);
    eg.addColorStop(1, 'rgba(199,91,34,0)');
    ctx.fillStyle = eg;
    ctx.fillRect(pa.x - r, pa.y - r, r * 2, r * 2);
    for (let i = 0; i < 6; i++) {
      const fx2 = pa.x + (flick(seed + i * 2.3) - 0.5) * r * 1.25;
      const fy2 = pa.y + (flick(seed + i * 4.9) - 0.5) * r * 0.8;
      const fl = 0.7 + flick(Math.floor(t * 8) + seed + i * 13) * 0.5;
      ctx.fillStyle = PAL.ember;
      tear(ctx, fx2, fy2, 2.6 * fl, 6 * fl);
      ctx.fillStyle = PAL.lythAmber;
      tear(ctx, fx2, fy2 + 0.5, 1.7 * fl, 4 * fl);
      if (i % 2 === 0) { ctx.fillStyle = PAL.lythGold; tear(ctx, fx2, fy2 + 1, 1 * fl, 2.6); }
    }
    // sparks lifting off the pool
    const sb = ctx.globalAlpha;
    ctx.fillStyle = '#E07B39';
    for (let i = 0; i < 4; i++) {
      const pr = fract(t * 0.7 + i * 0.25 + flick(seed + i * 9.1));
      ctx.globalAlpha = sb * (1 - pr) * 0.9;
      ctx.fillRect(pa.x + (flick(seed + i * 3.7) - 0.5) * r + Math.sin(pr * 6 + i) * 3, pa.y - pr * 22, 1.6, 1.6);
    }
    ctx.globalAlpha = sb;
    lights.push({ x: pa.x, y: pa.y, r: r * 1.5, rgb: '240,169,60', a: (0.1 + j * 0.04) * fade });
  }
  ctx.restore();
}

// ============================== FOLLOWERS ==============================
// Combat hires bound to an operator: hound / archer / caster. They wear one
// strip of their owner's char color so squads can tell whose dog that is.

function drawHound(ctx, fo, t, dt, col) {
  const { ph, amp, fx, fy } = poseFor('f' + fo.id, fo.x, fo.y, dt);
  const a = Math.atan2(fy, fx);
  shadowBlob(ctx, fo.x, fo.y + 6, 10, 4);
  ctx.save();
  ctx.translate(fo.x, fo.y);
  ctx.rotate(a + Math.PI / 2);
  // four legs, diagonal pairs in phase (a real trot)
  ctx.strokeStyle = '#241F1C';
  ctx.lineWidth = 2;
  for (const [lx, ly, phs] of [[-4, -4, 0], [4, -4, Math.PI], [-4, 5, Math.PI], [4, 5, 0]]) {
    const stride = Math.sin(ph * 1.4 + phs) * 4.5 * Math.max(0.15, amp);
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(lx * 1.6, ly + stride);
    ctx.stroke();
  }
  // lean body
  ctx.fillStyle = '#3A332C';
  ctx.beginPath(); ctx.ellipse(0, 0.5, 5.5, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2A2520'; // saddle shading along the spine
  ctx.beginPath(); ctx.ellipse(0, 2.5, 3.4, 5.5, 0, 0, Math.PI * 2); ctx.fill();
  // tail wag (faster when running)
  ctx.strokeStyle = '#2A2520';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(0, 9);
  ctx.lineTo(Math.sin(t * (6 + amp * 8)) * 3, 13.5);
  ctx.stroke();
  // head + snout + pricked ears
  ctx.fillStyle = '#3A332C';
  ctx.beginPath(); ctx.ellipse(0, -10, 4.4, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2A2520';
  ctx.beginPath(); ctx.ellipse(0, -14.2, 2.2, 2.8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#241F1C';
  ctx.beginPath();
  ctx.moveTo(-3.6, -11.5); ctx.lineTo(-2.2, -7.5); ctx.lineTo(-4.8, -8);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(3.6, -11.5); ctx.lineTo(2.2, -7.5); ctx.lineTo(4.8, -8);
  ctx.closePath(); ctx.fill();
  // owner-color collar
  ctx.fillStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur = 4;
  ctx.fillRect(-4, -7.2, 8, 1.8);
  ctx.shadowBlur = 0;
  // hunting eyes
  ctx.fillStyle = PAL.eye;
  ctx.fillRect(-2.2, -12.2, 1.3, 1.3);
  ctx.fillRect(0.9, -12.2, 1.3, 1.3);
  ctx.restore();
  rimArc(ctx, fo.x, fo.y - 3, 7, 0.35);
}

function drawArcherFollower(ctx, fo, t, dt, col) {
  const { ph, amp, fx, fy } = poseFor('f' + fo.id, fo.x, fo.y, dt);
  const a = Math.atan2(fy, fx);
  shadowBlob(ctx, fo.x, fo.y + 8, 9, 3.6);
  ctx.save();
  ctx.translate(fo.x, fo.y);
  ctx.rotate(a + Math.PI / 2);
  // small boots
  const lo = Math.sin(ph) * 3 * amp;
  ctx.fillStyle = '#232533';
  ctx.fillRect(-4.6, -1 + lo, 3.6, 5);
  ctx.fillRect(1, -1 - lo, 3.6, 5);
  // quiver across the back, fletching showing
  ctx.fillStyle = '#4A4232';
  ctx.fillRect(-5.4, 3, 4, 7);
  ctx.strokeStyle = PAL.lythGold;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-4.4, 3); ctx.lineTo(-4.4, 1);
  ctx.moveTo(-2.6, 3); ctx.lineTo(-2.6, 1.4);
  ctx.stroke();
  // hooded cloak body
  ctx.fillStyle = '#2C3148';
  ctx.beginPath(); ctx.ellipse(0, 0.5, 6.6, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(11,10,20,0.35)';
  ctx.beginPath(); ctx.ellipse(0, 3.5, 5.4, 4.4, 0, 0, Math.PI); ctx.fill();
  // bow held ahead: stave crescent + string
  ctx.strokeStyle = '#6E5A3A';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, -8.5, 7, Math.PI * 1.18, Math.PI * 1.82); ctx.stroke();
  ctx.strokeStyle = 'rgba(191,208,232,0.65)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(Math.cos(Math.PI * 1.18) * 7, -8.5 + Math.sin(Math.PI * 1.18) * 7);
  ctx.lineTo(Math.cos(Math.PI * 1.82) * 7, -8.5 + Math.sin(Math.PI * 1.82) * 7);
  ctx.stroke();
  // owner-color armband
  ctx.fillStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur = 4;
  ctx.fillRect(-7.4, -1.6, 2.4, 3.2);
  ctx.shadowBlur = 0;
  // hood, interior dark, one visor glint
  ctx.fillStyle = '#2C3148';
  ctx.beginPath(); ctx.arc(0, -3.5, 4.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PAL.voidNight;
  ctx.beginPath(); ctx.arc(0, -4, 2.8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(191,208,232,0.8)';
  ctx.fillRect(-1.6, -5.4, 3.2, 1.1);
  ctx.restore();
  rimArc(ctx, fo.x, fo.y - 4, 6.5, 0.35);
}

function drawCasterFollower(ctx, fo, t, dt, col, lights) {
  const { ph, amp, fx, fy } = poseFor('f' + fo.id, fo.x, fo.y, dt);
  const a = Math.atan2(fy, fx);
  const bob = Math.sin(t * 1.7 + fo.id) * 0.8;
  shadowBlob(ctx, fo.x, fo.y + 8, 9, 3.6);
  ctx.save();
  ctx.translate(fo.x, fo.y + bob);
  ctx.rotate(a + Math.PI / 2);
  // robe hem swishes with the stride
  const sw = Math.sin(ph * 0.8) * 1.6 * amp;
  ctx.fillStyle = '#243A40'; // deep-teal weather robe
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.quadraticCurveTo(7, -2, 6 + sw, 9);
  ctx.lineTo(-6 + sw, 9);
  ctx.quadraticCurveTo(-7, -2, 0, -9);
  ctx.fill();
  ctx.strokeStyle = '#17282c';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-2.5, -4); ctx.lineTo(-3 + sw, 8);
  ctx.moveTo(2.5, -4); ctx.lineTo(3 + sw, 8);
  ctx.stroke();
  // owner-color sash
  ctx.fillStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur = 4;
  ctx.fillRect(-4.5, -1, 9, 1.8);
  ctx.shadowBlur = 0;
  // storm staff out to the right, swirl charging at its tip
  ctx.strokeStyle = '#4A4232';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(6, 5); ctx.lineTo(9.5, -10); ctx.stroke();
  // hood
  ctx.fillStyle = '#243A40';
  ctx.beginPath(); ctx.arc(0, -7, 4.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PAL.voidNight;
  ctx.beginPath(); ctx.arc(0, -7.5, 2.8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(111,216,242,0.85)';
  ctx.fillRect(-1.6, -8.6, 3.2, 1.1);
  // wind spiral around the staff head
  ctx.strokeStyle = `rgba(138,152,184,${0.5 + 0.3 * Math.sin(t * 5)})`;
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 2; i++) {
    const sa = t * 4 + i * Math.PI;
    ctx.beginPath();
    ctx.ellipse(9.5, -12, 4 - i, 1.6 - i * 0.4, 0, sa, sa + Math.PI * 1.4);
    ctx.stroke();
  }
  ctx.restore();
  rimArc(ctx, fo.x, fo.y - 4, 6.5, 0.35);
  lights.push({ x: fo.x, y: fo.y - 10, r: 18, rgb: '138,152,184', a: 0.05 });
}

function drawFollower(ctx, fo, t, dt, col, lights) {
  if (fo.kind === 'hound') drawHound(ctx, fo, t, dt, col);
  else if (fo.kind === 'caster') drawCasterFollower(ctx, fo, t, dt, col, lights);
  else drawArcherFollower(ctx, fo, t, dt, col); // archer + unknown future hires
  const maxHp = fo.maxHp ?? 2;
  if (fo.hp != null && fo.hp < maxHp) drawHeartPips(ctx, fo.x, fo.y - 22, fo.hp, maxHp);
}

// ============================== DEEP WORLD (FRONTIER III) ==============================
// Quest items, field weapons, puzzle systems, doors, teleports, beacons.
// Every snapshot field here is optional: classic and pre-frontier snapshots
// carry none of them and render exactly as before.

let sealCarriers = []; // active players carrying a lythseal, set per frame

// The eight Monolythium runes, indexed by glyph symbol 0-7.
const GLYPH_RUNES = ['ANCHOR', 'WAVE', 'VERTEX', 'SEAL', 'FORK', 'BURN', 'QUORUM', 'DRIFT'];

// The Classical Colonnade: pillar names + inscriptions, picked by id.
const PILLAR_NAMES = ['CURVE', 'PAIRING', 'AGGREGATE', 'INTERPOLATION'];

// Field weapon pickups: each kind gets an unmistakable ground glow.
const PICKUP_STYLE = {
  flamer: { rgb: '240,169,60', col: '#F0A93C', label: 'FLAMER' },
  railcannon: { rgb: '111,216,242', col: '#6FD8F2', label: 'RAILCANNON' },
  stormgun: { rgb: '191,251,255', col: '#BFFBFF', label: 'STORMGUN' },
  mortarMk2: { rgb: '224,123,57', col: '#E07B39', label: 'MORTAR MK2' },
};

// Teleport pad pair colors, keyed by the lower id of the pair.
const TP_PAIR_RGB = ['111,216,242', '255,217,138', '95,210,180', '142,79,209', '191,251,255', '224,123,57'];

const doorAnim = new Map(); // door id -> slide 0 (closed) .. 1 (open)

// One vector rune per symbol, drawn around the current origin at scale s.
// Caller sets strokeStyle/fillStyle (lit gold vs engraved graphite).
function drawRune(ctx, sym, s) {
  ctx.lineWidth = Math.max(1.1, s * 0.2);
  ctx.lineCap = 'round';
  ctx.beginPath();
  switch (((Math.round(sym ?? 0) % 8) + 8) % 8) {
    case 0: // ANCHOR — the mark that cannot be unsaid
      ctx.moveTo(0, -s * 0.4); ctx.lineTo(0, s * 0.7);
      ctx.moveTo(-s * 0.6, s * 0.2); ctx.quadraticCurveTo(0, s * 1.0, s * 0.6, s * 0.2);
      ctx.moveTo(-s * 0.45, -s * 0.05); ctx.lineTo(s * 0.45, -s * 0.05);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -s * 0.6, s * 0.22, 0, Math.PI * 2); ctx.stroke();
      return;
    case 1: // WAVE — the breath the field takes together
      ctx.moveTo(-s * 0.8, 0);
      ctx.quadraticCurveTo(-s * 0.4, -s * 0.85, 0, 0);
      ctx.quadraticCurveTo(s * 0.4, s * 0.85, s * 0.8, 0);
      ctx.stroke();
      return;
    case 2: // VERTEX — one voice, once, and only once
      ctx.moveTo(0, -s * 0.75); ctx.lineTo(s * 0.7, s * 0.55); ctx.lineTo(-s * 0.7, s * 0.55);
      ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, s * 0.08, s * 0.15, 0, Math.PI * 2); ctx.fill();
      return;
    case 3: // SEAL — what is read only at inclusion
      ctx.arc(0, 0, s * 0.65, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, s * 0.26, 0, Math.PI * 2); ctx.fill();
      return;
    case 4: // FORK — the path that became two paths
      ctx.moveTo(0, s * 0.75); ctx.lineTo(0, -s * 0.05);
      ctx.moveTo(0, -s * 0.05); ctx.lineTo(-s * 0.5, -s * 0.7);
      ctx.moveTo(0, -s * 0.05); ctx.lineTo(s * 0.5, -s * 0.7);
      ctx.stroke();
      return;
    case 5: // BURN — the name that was spent to be kept honest
      ctx.moveTo(0, -s * 0.75);
      ctx.quadraticCurveTo(s * 0.75, -s * 0.1, s * 0.18, s * 0.7);
      ctx.quadraticCurveTo(-s * 0.5, s * 0.45, -s * 0.28, -s * 0.05);
      ctx.quadraticCurveTo(-s * 0.08, -s * 0.4, 0, -s * 0.75);
      ctx.stroke();
      return;
    case 6: // QUORUM — seven of ten, and not six: the bottom line is short
      ctx.moveTo(-s * 0.7, -s * 0.5); ctx.lineTo(s * 0.7, -s * 0.5);
      ctx.moveTo(-s * 0.7, 0); ctx.lineTo(s * 0.7, 0);
      ctx.moveTo(-s * 0.7, s * 0.5); ctx.lineTo(s * 0.12, s * 0.5);
      ctx.stroke();
      return;
    default: // DRIFT — what waits for all who are not anchored
      for (const ry of [-0.45, 0.1, 0.65]) {
        ctx.moveTo(-s * 0.7, ry * s);
        ctx.quadraticCurveTo(-s * 0.25, (ry - 0.4) * s, s * 0.02, ry * s);
        ctx.quadraticCurveTo(s * 0.38, (ry + 0.4) * s, s * 0.7, ry * s);
      }
      ctx.stroke();
      return;
  }
}

// One absorb charge from a Null Acolyte: a glitch-violet shell, clearly NOT
// the relay-cyan of a friendly shield. Pops via the 'shield' hit event.
function drawEnemyShield(ctx, e, t) {
  const r = (KIND_R[e.kind] || 13) + 5;
  ctx.save();
  const a = 0.32 + 0.14 * Math.sin(t * 4 + e.id);
  ctx.strokeStyle = `rgba(142,79,209,${a + 0.2})`;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = PAL.glitch;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  // three plate segments crawling around the shell
  ctx.strokeStyle = `rgba(191,251,255,${a})`;
  ctx.lineWidth = 2.2;
  for (let i = 0; i < 3; i++) {
    const ga = t * 1.8 + (i / 3) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, ga, ga + 0.7);
    ctx.stroke();
  }
  ctx.restore();
}

// Mini ground silhouette for a field weapon pickup, drawn around the origin.
function drawPickupShape(ctx, kind) {
  const dk = PAL.graphDark, gm = PAL.graphPlate;
  if (kind === 'flamer') {
    ctx.fillStyle = dk; ctx.fillRect(-8, -3.5, 12, 7);
    ctx.fillStyle = gm; ctx.fillRect(-8, -3.5, 12, 2.6);
    ctx.fillStyle = gm; ctx.beginPath(); ctx.arc(-5, 5, 3.4, 0, Math.PI * 2); ctx.fill(); // fuel tank
    ctx.fillStyle = '#F0A93C';
    ctx.shadowColor = '#F0A93C'; ctx.shadowBlur = 5;
    ctx.fillRect(4, -2.2, 5, 4.4); // hot nozzle
    ctx.shadowBlur = 0;
  } else if (kind === 'railcannon') {
    ctx.fillStyle = dk; ctx.fillRect(-12, -1.8, 24, 3.6);
    ctx.fillStyle = gm; ctx.fillRect(-7, -3.6, 8, 7.2);
    ctx.strokeStyle = PAL.relay; // accelerator coils
    ctx.shadowColor = PAL.relay; ctx.shadowBlur = 4;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const cx of [3, 6.5, 10]) { ctx.moveTo(cx, -3); ctx.lineTo(cx, 3); }
    ctx.stroke();
    ctx.shadowBlur = 0;
  } else if (kind === 'stormgun') {
    ctx.fillStyle = dk; ctx.fillRect(-8, -2.6, 12, 5.2);
    ctx.fillStyle = gm; ctx.fillRect(-8, -4, 7, 8);
    ctx.strokeStyle = PAL.eye; // storm orb emitter
    ctx.shadowColor = PAL.eye; ctx.shadowBlur = 5;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(7.5, 0, 3.4, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
  } else { // mortarMk2 + future kinds: the fat tube
    ctx.fillStyle = dk; ctx.fillRect(-10, -4, 20, 8);
    ctx.fillStyle = gm; ctx.fillRect(-10, -4, 20, 3);
    ctx.fillStyle = '#11131f'; ctx.fillRect(8, -3, 3, 6); // dark muzzle mouth
    ctx.fillStyle = '#E07B39';
    ctx.shadowColor = '#E07B39'; ctx.shadowBlur = 5;
    ctx.fillRect(-12, -3.2, 2.4, 6.4); // hot breech cap
    ctx.shadowBlur = 0;
  }
}

// 'A' — field weapon pickup on the ground: bobbing silhouette over a kind-
// colored glow ring. Teammates can grab dropped ones (ammo rides the sim).
function drawFieldPickup(ctx, pk, t, lights) {
  const st = PICKUP_STYLE[pk.kind] || { rgb: '255,217,138', col: '#FFD98A', label: String(pk.kind || 'WEAPON').toUpperCase() };
  const bob = Math.sin(t * (Math.PI * 2 / 1.6) + (pk.x + pk.y) * 0.05) * 2;
  ctx.save();
  ctx.fillStyle = 'rgba(11,10,20,0.35)';
  ctx.beginPath(); ctx.ellipse(pk.x, pk.y + 6, 8, 3, 0, 0, Math.PI * 2); ctx.fill();
  // slow-turning claim ring on the ground
  ctx.strokeStyle = `rgba(${st.rgb},${0.4 + 0.2 * Math.sin(t * 2.4 + pk.x * 0.05)})`;
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 3; i++) {
    const ga = t * 0.9 + (i / 3) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(pk.x, pk.y + 5, 11, 4.5, 0, ga, ga + 1.3);
    ctx.stroke();
  }
  ctx.translate(pk.x, pk.y - 6 + bob);
  ctx.rotate(-0.22);
  drawPickupShape(ctx, pk.kind);
  ctx.restore();
  lights.push({ x: pk.x, y: pk.y - 4, r: 30, rgb: st.rgb, a: 0.12 });
}

// 'I' — quest item: a proof fragment / relic. Carried, it trails its bearer
// in warm motes; on the ground it pings like treasure.
function drawQuestItem(ctx, q, t, lights) {
  const carried = (q.carrier ?? null) != null;
  const bob = carried ? 0 : Math.sin(t * (Math.PI * 2 / 1.3) + (q.x + q.y) * 0.06) * 2;
  const y = q.y - 6 + bob;
  // a stable per-item identity even when ids ship as strings ('qi0'...)
  const qid = typeof q.id === 'number' ? q.id
    : String(q.id ?? '').split('').reduce((s2, c2) => s2 + c2.charCodeAt(0), 0);
  ctx.save();
  if (!carried) {
    ctx.fillStyle = 'rgba(11,10,20,0.35)';
    ctx.beginPath(); ctx.ellipse(q.x, q.y + 5, 6, 2.4, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    // warm mote trail streaming off the relic as it travels
    ctx.fillStyle = PAL.lythGold;
    for (let i = 0; i < 3; i++) {
      const pr = fract(t * 1.3 + i * 0.33 + qid * 0.17);
      ctx.globalAlpha = (1 - pr) * 0.7;
      ctx.fillRect(q.x + (flick(qid + i * 3.7 + Math.floor(t * 4)) - 0.5) * 8, y + 4 + pr * 10, 1.8, 1.8);
    }
    ctx.globalAlpha = 1;
  }
  // the fragment: an angular gold tablet showing its partial glyph
  ctx.translate(q.x, y);
  ctx.rotate(0.18 + Math.sin(t * 1.1 + qid) * 0.06);
  ctx.fillStyle = '#7A5A1E';
  ctx.beginPath();
  ctx.moveTo(-5.5, -6); ctx.lineTo(4.5, -7); ctx.lineTo(6, 5); ctx.lineTo(-3.5, 7); ctx.lineTo(-6.5, 1);
  ctx.closePath(); ctx.fill();
  const fg = ctx.createLinearGradient(0, -7, 0, 7);
  fg.addColorStop(0, PAL.lythGold);
  fg.addColorStop(1, PAL.lythAmber);
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(-4.5, -5); ctx.lineTo(3.6, -5.8); ctx.lineTo(5, 4); ctx.lineTo(-2.8, 5.6); ctx.lineTo(-5.4, 0.8);
  ctx.closePath(); ctx.fill();
  // the partial glyph: half a rune, the rest sheared off at the break
  ctx.strokeStyle = 'rgba(122,90,30,0.95)';
  ctx.save();
  ctx.beginPath(); ctx.rect(-5, -6, 6.5, 12); ctx.clip(); // sheared
  drawRune(ctx, q.symbol ?? qid, 4);
  ctx.restore();
  ctx.restore();
  // findable ping
  const ph2 = fract(t / 2.1 + flick(q.x * 0.11 + q.y * 0.23));
  if (!carried && ph2 < 0.12) {
    const sa = 1 - ph2 / 0.12;
    ctx.strokeStyle = `rgba(255,239,194,${sa})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(q.x, y - 11); ctx.lineTo(q.x, y - 15);
    ctx.moveTo(q.x + 9, y); ctx.lineTo(q.x + 13, y);
    ctx.moveTo(q.x - 9, y); ctx.lineTo(q.x - 13, y);
    ctx.stroke();
  }
  lights.push({ x: q.x, y, r: 26, rgb: '255,217,138', a: 0.13 });
}

// Quest marker over an NPC: gold '!' = quests waiting, relay '?' = come talk,
// something is ready to settle. Reads several optional snapshot spellings.
function npcQuestMark(n, quests) {
  // explicit flags on the npc win
  const qs = n.questState ?? n.qstate ?? n.quest;
  if (qs === 'done' || qs === 'complete' || qs === 'ready' || n.questDone || n.questReady) return '?';
  if (qs === 'avail' || qs === 'available' || qs === true || n.hasQuest) return '!';
  // otherwise derive from the quest list when it names this npc as giver
  if (Array.isArray(quests) && n.id != null) {
    let mark = null;
    for (const q of quests) {
      if (q.giver !== n.id) continue;
      if (q.state === 'active' && (q.count == null || (q.progress ?? 0) >= q.count)) return '?';
      if (q.state === 'hidden') mark = '!';
    }
    return mark;
  }
  return null;
}

function drawQuestMark(ctx, x, y, mark, t) {
  const bob = Math.sin(t * 2.6 + x * 0.05) * 1.6;
  const col = mark === '?' ? PAL.relay : PAL.lythGold;
  ctx.save();
  ctx.font = 'bold 15px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur = 8;
  ctx.fillText(mark, x, y + bob);
  ctx.restore();
}

// 'Q' — relay switch console: one fallen operator's "voice" in the Count.
// Off: grey-green gutter lamp. On: steady checkpoint gold. A burned console
// (sw.burned) is fused black — an exiled equivocator; it never counts again.
function drawSwitch(ctx, sw, t, lights) {
  const { x, y } = sw;
  const burned = !!(sw.burned || sw.dead);
  const on = !!sw.on && !burned;
  shadowBlob(ctx, x, y + 7, 11, 4);
  // breaker pedestal
  ctx.fillStyle = PAL.graphDark;
  ctx.fillRect(x - 9, y - 1, 18, 8);
  ctx.fillStyle = burned ? '#15121A' : PAL.graphPlate;
  ctx.fillRect(x - 8, y - 9, 16, 8);
  ctx.fillStyle = burned ? '#0E0C12' : PAL.graphMid;
  ctx.fillRect(x - 8, y - 9, 16, 2.2);
  if (burned) {
    // fused black: scorch streaks, a dead socket, no lever throw left
    ctx.strokeStyle = '#060509';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x - 5, y - 9); ctx.lineTo(x - 3, y - 3); ctx.lineTo(x - 6, y + 2);
    ctx.moveTo(x + 4, y - 8); ctx.lineTo(x + 5, y - 2);
    ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(x, y - 5, 2.2, 0, Math.PI * 2); ctx.fill();
    rimArc(ctx, x, y - 8, 8, 0.2);
    return;
  }
  // the operator's sigil etched on the face
  ctx.strokeStyle = 'rgba(138,152,184,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 5.5, y - 4); ctx.lineTo(x - 3, y - 7); ctx.lineTo(x - 3, y - 3);
  ctx.stroke();
  // the lever: thrown left = off, right = on
  const la = on ? 0.65 : -0.65;
  const px2 = x + 2.5, py2 = y - 5;
  ctx.strokeStyle = PAL.steel;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(px2, py2);
  ctx.lineTo(px2 + Math.sin(la) * 9, py2 - Math.cos(la) * 9);
  ctx.stroke();
  ctx.fillStyle = on ? PAL.lythGold : '#4E5A50';
  ctx.beginPath();
  ctx.arc(px2 + Math.sin(la) * 9, py2 - Math.cos(la) * 9, 2.2, 0, Math.PI * 2);
  ctx.fill();
  // the voice lamp: gutters grey-green until it counts, then steady gold
  ctx.save();
  if (on) {
    ctx.fillStyle = PAL.lythGold;
    ctx.shadowColor = PAL.lythGold;
    ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(x - 4.5, y - 12, 2.2, 0, Math.PI * 2); ctx.fill();
  } else {
    const gut = 0.35 + 0.25 * flick(Math.floor(t * 6) + x);
    ctx.fillStyle = `rgba(110,140,110,${gut})`;
    ctx.beginPath(); ctx.arc(x - 4.5, y - 12, 1.8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  rimArc(ctx, x, y - 8, 8, 0.35);
  if (on) lights.push({ x, y: y - 10, r: 30, rgb: '255,217,138', a: 0.1 });
}

// 'J' — glyph stone: a standing stone bearing one of the eight runes.
// Lit stones burn checkpoint gold; the wrong order spins the whole ring back.
function drawGlyphStone(ctx, gl, t, lights) {
  const { x, y } = gl;
  const lit = !!gl.lit;
  shadowBlob(ctx, x, y + 7, 10, 4);
  // weathered standing stone
  ctx.fillStyle = '#2E3140';
  ctx.beginPath();
  ctx.moveTo(x - 8, y + 6);
  ctx.lineTo(x - 7, y - 12);
  ctx.quadraticCurveTo(x, y - 18, x + 7, y - 12);
  ctx.lineTo(x + 8, y + 6);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(11,10,20,0.35)'; // right face shade
  ctx.beginPath();
  ctx.moveTo(x + 3, y + 6); ctx.lineTo(x + 3, y - 13.5); ctx.lineTo(x + 7, y - 12); ctx.lineTo(x + 8, y + 6);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = PAL.moonsteel; // moonlit left edge
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x - 7.5, y + 5); ctx.lineTo(x - 6.6, y - 11.5);
  ctx.stroke();
  // the rune
  ctx.save();
  ctx.translate(x, y - 4);
  if (lit) {
    ctx.strokeStyle = PAL.lythGold;
    ctx.fillStyle = PAL.lythGold;
    ctx.shadowColor = PAL.lythGold;
    ctx.shadowBlur = 7 + 2 * Math.sin(t * 2.2 + x * 0.05);
  } else {
    ctx.strokeStyle = '#4A5060';
    ctx.fillStyle = '#4A5060';
  }
  drawRune(ctx, gl.symbol, 5.5);
  ctx.restore();
  if (lit) lights.push({ x, y: y - 4, r: 30, rgb: '255,217,138', a: 0.1 + 0.03 * Math.sin(t * 2 + x * 0.07) });
}

// 'X' — BLS pillar: pre-Fall classical cryptography. Beautiful, tiny, fast —
// and forgeable now. Cracks open in stages under player fire; while one
// stands, the field still honors the old curve.
function drawPillar(ctx, pi, t, lights) {
  const { x, y } = pi;
  const maxHp = pi.maxHp ?? 12;
  const frac = Math.max(0, Math.min(1, (pi.hp ?? maxHp) / maxHp));
  if ((pi.hp ?? 1) <= 0) {
    // felled: a rubble heap glowing along its cracks, going dark
    shadowBlob(ctx, x, y + 6, 14, 5);
    ctx.fillStyle = '#4A5060';
    for (const [ox, oy, w, h] of [[-8, 2, 9, 6], [2, 3, 10, 5], [-3, -2, 8, 5], [7, -1, 6, 4]]) {
      ctx.fillRect(x + ox - w / 2, y + oy - h / 2, w, h);
    }
    ctx.strokeStyle = `rgba(142,79,209,${0.25 + 0.15 * Math.sin(t * 1.6 + x * 0.05)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 9, y + 2); ctx.lineTo(x - 3, y + 1); ctx.lineTo(x + 3, y + 4);
    ctx.stroke();
    return;
  }
  const idx = Math.abs(Math.round(pi.id ?? 0)) % 4;
  shadowBlob(ctx, x + 2, y + 6, 14, 5);
  // marble plinth + tall fluted column — paler than anything Entropy-made
  ctx.fillStyle = '#4A5060';
  ctx.fillRect(x - 12, y, 24, 6);
  ctx.fillStyle = '#5E6880';
  ctx.fillRect(x - 8, y - 40, 16, 41);
  ctx.fillStyle = 'rgba(11,10,20,0.3)'; // right shade
  ctx.fillRect(x + 3, y - 40, 5, 41);
  ctx.fillStyle = '#6E7A94'; // capital
  ctx.fillRect(x - 10, y - 44, 20, 5);
  ctx.fillStyle = PAL.moonsteel;
  ctx.fillRect(x - 10, y - 44, 20, 1.2);
  // fluting
  ctx.strokeStyle = 'rgba(30,32,40,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const fx of [-4.5, 0, 4.5]) { ctx.moveTo(x + fx, y - 39); ctx.lineTo(x + fx, y - 1); }
  ctx.stroke();
  // the old curve, carved and still proud: ellipse + tangent chord
  ctx.strokeStyle = 'rgba(191,208,232,0.7)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(x - 0.5, y - 26, 4.6, 6.2, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 6, y - 18); ctx.lineTo(x + 5.5, y - 33);
  ctx.stroke();
  // its name, etched into the plinth
  ctx.save();
  ctx.font = 'bold 6px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(191,208,232,0.65)';
  ctx.fillText(PILLAR_NAMES[idx], x, y + 4.5);
  ctx.restore();
  // while it stands the field honors the curve: a faint violet breath
  const honor = 0.06 + 0.04 * Math.sin(t * 1.1 + idx * 1.7);
  lights.push({ x, y: y - 22, r: 44, rgb: '142,79,209', a: honor * frac + 0.03 });
  // crack stages: wounded, then failing with drift seeping out
  if (frac < 0.66) {
    ctx.strokeStyle = '#1E2028';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x - 6, y - 38); ctx.lineTo(x - 3, y - 30); ctx.lineTo(x - 6.5, y - 22);
    ctx.moveTo(x + 5, y - 14); ctx.lineTo(x + 2, y - 8);
    ctx.stroke();
  }
  if (frac < 0.33) {
    ctx.strokeStyle = `rgba(142,79,209,${0.5 + 0.3 * Math.sin(t * 6 + x)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 3, y - 30); ctx.lineTo(x + 1, y - 24); ctx.lineTo(x - 2, y - 16); ctx.lineTo(x + 3, y - 10);
    ctx.stroke();
  }
  rimArc(ctx, x - 1, y - 38, 9, 0.45);
  if (pi.hp != null && pi.hp < maxHp) drawHpPips(ctx, x, y - 52, frac);
}

// 'Z' — the seal forge: Hask's threshold crucible. Seven fragment slots ring
// the basin; fewer than seven melt to slag, so the rim says so in fire.
function drawForge(ctx, fo, t, lights) {
  const { x, y } = fo;
  const j = flick(Math.floor(t * 8) + x * 1.3);
  shadowBlob(ctx, x, y + 8, 15, 5.5);
  // anvil block
  ctx.fillStyle = PAL.graphDark;
  ctx.fillRect(x + 7, y - 4, 12, 9);
  ctx.fillStyle = PAL.graphPlate;
  ctx.fillRect(x + 5, y - 8, 16, 5);
  ctx.fillStyle = PAL.moonsteel;
  ctx.fillRect(x + 5, y - 8, 16, 1.2);
  // crucible: stone basin holding molten checkpoint-gold
  ctx.fillStyle = '#3A3F4E';
  ctx.beginPath(); ctx.ellipse(x - 4, y - 2, 11, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#262A36';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const mg = ctx.createRadialGradient(x - 4, y - 3, 0, x - 4, y - 3, 8);
  mg.addColorStop(0, PAL.lythPale);
  mg.addColorStop(0.5, PAL.lythGold);
  mg.addColorStop(1, PAL.lythAmber);
  ctx.fillStyle = mg;
  ctx.beginPath(); ctx.ellipse(x - 4, y - 3, 7.5, 4.4, 0, 0, Math.PI * 2); ctx.fill();
  // the seven slots around the rim — the Combining wants seven, not six
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 - Math.PI / 2;
    ctx.fillStyle = 'rgba(255,217,138,0.8)';
    ctx.fillRect(x - 4 + Math.cos(a) * 10 - 1, y - 2 + Math.sin(a) * 6.4 - 1, 2, 2);
  }
  // sparks lifting off the melt
  ctx.save();
  ctx.fillStyle = '#E07B39';
  for (let i = 0; i < 3; i++) {
    const pr = fract(t * 0.7 + i * 0.33 + flick(x + i * 9.1));
    ctx.globalAlpha *= (1 - pr);
    ctx.fillRect(x - 4 + (flick(x + i * 3.7) - 0.5) * 10 + Math.sin(pr * 6 + i) * 3, y - 6 - pr * 22, 1.6, 1.6);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  // the long hammer resting against the anvil
  ctx.strokeStyle = '#4A4232';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x + 16, y + 4); ctx.lineTo(x + 22, y - 12); ctx.stroke();
  ctx.fillStyle = PAL.graphPlate;
  ctx.fillRect(x + 19, y - 16, 7, 5);
  lights.push({ x: x - 4, y: y - 3, r: 52, rgb: '240,169,60', a: 0.14 + j * 0.04 });
}

// MUSIC BOX easter egg art -------------------------------------------------
// The ruin altar: a broken stone plinth. Each restored fragment seats a small
// amethyst chip in its rim, so the plinth visibly fills as the squad delivers;
// at 4/4 the whole altar glows and a soft note-glyph hovers over it.
function drawMusicAltar(ctx, a, mb, t, lights) {
  const { x, y } = a;
  const done = !!mb.complete;
  shadowBlob(ctx, x, y + 9, 16, 6);
  // cracked stone base
  ctx.fillStyle = '#2C2F3B';
  ctx.beginPath(); ctx.ellipse(x, y + 4, 15, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3A3F4E';
  ctx.fillRect(x - 11, y - 8, 22, 12);
  ctx.fillStyle = '#474D60';
  ctx.fillRect(x - 11, y - 9, 22, 2);
  // a fracture line down the column
  ctx.strokeStyle = '#21242F';
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(x + 2, y - 8); ctx.lineTo(x - 1, y + 3); ctx.stroke();
  // seated amethyst chips: one per restored fragment, around the top rim
  const seated = mb.assembled ?? 0;
  const pulse = 0.5 + 0.5 * Math.sin(t * 3);
  for (let i = 0; i < 4; i++) {
    const cx = x - 9 + i * 6;
    if (i < seated) {
      ctx.save();
      ctx.shadowColor = '#c178ff';
      ctx.shadowBlur = 6 + 3 * pulse;
      ctx.fillStyle = `rgba(198,140,255,${0.8 + 0.2 * pulse})`;
      ctx.beginPath();
      ctx.moveTo(cx, y - 13); ctx.lineTo(cx + 2.4, y - 9); ctx.lineTo(cx, y - 5); ctx.lineTo(cx - 2.4, y - 9);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    } else {
      // empty socket
      ctx.fillStyle = '#23262F';
      ctx.beginPath(); ctx.ellipse(cx, y - 9, 2.2, 1.6, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Always glow so the relic reads clearly against the tiles, and brighten with
  // every shard restored — base findable glow at 0/4, full blaze + beam + note
  // at 4/4. Additive ('lighter') so it pops regardless of ground colour.
  const frac = seated / 4;                              // 0..1
  const glowR = 30 + 18 * frac + (done ? 12 : 0) + 5 * pulse;
  const aIn = (0.22 + 0.34 * frac + (done ? 0.20 : 0)) * (0.75 + 0.25 * pulse);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const og = ctx.createRadialGradient(x, y - 6, 0, x, y - 6, glowR);
  og.addColorStop(0, `rgba(198,140,255,${aIn})`);
  og.addColorStop(1, 'rgba(198,140,255,0)');
  ctx.fillStyle = og;
  ctx.fillRect(x - glowR - 8, y - glowR - 8, (glowR + 8) * 2, (glowR + 8) * 2);
  // a vertical beacon beam — taller + brighter as it fills, a pillar at 4/4
  const beamH = 24 + 44 * frac + (done ? 26 : 0);
  const bg = ctx.createLinearGradient(x, y - 4, x, y - 4 - beamH);
  bg.addColorStop(0, `rgba(214,168,255,${0.18 + 0.26 * frac + (done ? 0.22 : 0)})`);
  bg.addColorStop(1, 'rgba(214,168,255,0)');
  ctx.fillStyle = bg;
  ctx.fillRect(x - 3 - frac * 2, y - 4 - beamH, 6 + frac * 4, beamH);
  ctx.restore();
  if (done) {
    ctx.save();
    ctx.fillStyle = `rgba(231,210,255,${0.7 + 0.3 * pulse})`;
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('♫', x, y - 28 - 3 * pulse);
    ctx.restore();
  }
  lights.push({ x, y: y - 6, r: 34 + 32 * frac + (done ? 20 : 0), rgb: '198,140,255', a: 0.10 + 0.16 * frac + (done ? 0.08 : 0) + 0.04 * pulse });
}

// A loose music-box fragment: a small floating amethyst shard with a soft
// glow and a "▼ FRAGMENT" prompt, mirroring the captive RESCUE marker.
function drawMusicFragment(ctx, f, t, lights, loose = true) {
  const { x, y } = f;
  const bob = Math.sin(t * 2.4 + (x + y) * 0.02) * 2.5;
  const pulse = 0.5 + 0.5 * Math.sin(t * 4 + x * 0.05);
  const fy = y + bob;
  shadowBlob(ctx, x, y + 8, 8, 3);
  // glow halo
  const g = ctx.createRadialGradient(x, fy, 0, x, fy, 16 + 4 * pulse);
  g.addColorStop(0, `rgba(198,140,255,${0.45 + 0.25 * pulse})`);
  g.addColorStop(1, 'rgba(198,140,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - 22, fy - 22, 44, 44);
  // the shard (a faceted diamond)
  ctx.save();
  ctx.shadowColor = '#c178ff';
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#b07cf0';
  ctx.beginPath();
  ctx.moveTo(x, fy - 8); ctx.lineTo(x + 5, fy); ctx.lineTo(x, fy + 8); ctx.lineTo(x - 5, fy);
  ctx.closePath(); ctx.fill();
  // bright inner facet
  ctx.fillStyle = `rgba(237,219,255,${0.7 + 0.3 * pulse})`;
  ctx.beginPath();
  ctx.moveTo(x, fy - 5); ctx.lineTo(x + 2.4, fy - 1); ctx.lineTo(x, fy + 3); ctx.lineTo(x - 2.4, fy - 1);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  // pickup prompt — only for fragments still loose on the ground
  if (loose) {
    ctx.save();
    ctx.shadowColor = '#c178ff';
    ctx.shadowBlur = 8;
    ctx.fillStyle = `rgba(214,168,255,${0.6 + 0.4 * pulse})`;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('▼ ARTIFACT', x, fy - 18 - pulse * 2);
    ctx.restore();
  }
  lights.push({ x, y: fy, r: 30, rgb: '198,140,255', a: 0.08 + 0.06 * pulse });
}

// Doors: closed bulkheads read as walls (they block movement, sight, shots).
// Open ones slide their two panels apart along the door's long axis.
function drawDoor(ctx, d, t, dt, lights) {
  const id = d.id ?? `${d.x},${d.y}`;
  const target = d.open ? 1 : 0;
  let k = doorAnim.get(id);
  if (k == null) k = target; // first sight: no animation pop
  else if (k !== target) k = Math.max(0, Math.min(1, k + (target > k ? 1 : -1) * dt / 0.55));
  doorAnim.set(id, k);
  const px = d.x * TILE, py = d.y * TILE;
  const w = (d.w ?? 1) * TILE, h = (d.h ?? 1) * TILE;
  const horiz = w >= h;
  // recessed track, always visible
  ctx.fillStyle = '#0E0F16';
  ctx.fillRect(px, py, w, h);
  ctx.strokeStyle = '#262A36';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(px + 1, py + 1, w - 2, h - 2);
  if (k < 1) {
    // the two bulkhead panels, sliding apart as k rises
    ctx.save();
    ctx.beginPath(); ctx.rect(px, py, w, h); ctx.clip();
    const slide = (horiz ? w : h) / 2 * k;
    for (const side of [-1, 1]) {
      const ox = horiz ? side * slide : 0;
      const oy = horiz ? 0 : side * slide;
      const hx = horiz ? px + (side < 0 ? 0 : w / 2) : px;
      const hy = horiz ? py : py + (side < 0 ? 0 : h / 2);
      const hw = horiz ? w / 2 : w;
      const hh = horiz ? h : h / 2;
      ctx.fillStyle = PAL.graphPlate;
      ctx.fillRect(hx + ox, hy + oy, hw, hh);
      ctx.fillStyle = PAL.graphMid;
      ctx.fillRect(hx + ox + 2, hy + oy + 2, hw - 4, hh - 4);
      // diagonal brace + rivets
      ctx.strokeStyle = PAL.graphDark;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hx + ox + 3, hy + oy + 3);
      ctx.lineTo(hx + ox + hw - 3, hy + oy + hh - 3);
      ctx.stroke();
      ctx.fillStyle = '#6E7A94';
      ctx.fillRect(hx + ox + 3, hy + oy + 3, 2, 2);
      ctx.fillRect(hx + ox + hw - 5, hy + oy + hh - 5, 2, 2);
      // moonsteel bevel on the panel's leading edge (the meeting seam)
      ctx.fillStyle = PAL.moonsteel;
      if (horiz) ctx.fillRect(hx + ox + (side < 0 ? hw - 2 : 0), hy + oy, 2, hh);
      else ctx.fillRect(hx + ox, hy + oy + (side < 0 ? hh - 2 : 0), w, 2);
    }
    ctx.restore();
    const cx = px + w / 2, cy = py + h / 2;
    if (d.sealLock) {
      // sealed: the lock answers only a carried LythiumSeal
      ctx.save();
      ctx.translate(cx, cy);
      ctx.strokeStyle = PAL.lythGold;
      ctx.fillStyle = PAL.lythGold;
      ctx.shadowColor = PAL.lythGold;
      ctx.shadowBlur = 6 + 3 * Math.sin(t * 2.2 + cx * 0.03);
      drawRune(ctx, 3, 6); // the SEAL rune
      ctx.restore();
      lights.push({ x: cx, y: cy, r: 26, rgb: '255,217,138', a: 0.08 });
    } else {
      // plain lock lamp: breach-red until something opens it
      ctx.fillStyle = `rgba(224,72,72,${0.5 + 0.3 * Math.sin(t * 2 + cx * 0.05)})`;
      ctx.beginPath(); ctx.arc(cx, cy, 2.2, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    // open: idle relay lamps at the jambs
    const lx0 = horiz ? px + 3 : px + w / 2;
    const ly0 = horiz ? py + h / 2 : py + 3;
    const lx1 = horiz ? px + w - 3 : px + w / 2;
    const ly1 = horiz ? py + h / 2 : py + h - 3;
    ctx.fillStyle = 'rgba(111,216,242,0.7)';
    ctx.fillRect(lx0 - 1.2, ly0 - 1.2, 2.4, 2.4);
    ctx.fillRect(lx1 - 1.2, ly1 - 1.2, 2.4, 2.4);
  }
}

// 'O' — settled corridor pad: two anchor-gates sharing one settled state.
// Stand on it and the world agrees you've moved. Pair color by lower id.
function drawTeleportPad(ctx, tp, t, snap, lights) {
  const { x, y } = tp;
  const pair = Math.min(tp.id ?? 0, tp.twin ?? tp.id ?? 0);
  const rgb = TP_PAIR_RGB[((pair % TP_PAIR_RGB.length) + TP_PAIR_RGB.length) % TP_PAIR_RGB.length];
  // is someone channeling? (any active player standing on the pad)
  let chan = 0;
  for (const p of snap.players ?? []) {
    if (p.state !== 'active') continue;
    if ((p.x - x) ** 2 + (p.y - y) ** 2 < (TILE * 0.55) ** 2) {
      // sim may ship the channel countdown on the player (teleT: 0.8 -> 0)
      chan = p.teleT != null ? Math.max(0.2, 1 - p.teleT / 0.8) : 1;
      break;
    }
  }
  ctx.save();
  // base plate
  ctx.fillStyle = 'rgba(30,32,40,0.9)';
  ctx.beginPath(); ctx.ellipse(x, y, 15, 8.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = PAL.graphDark;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // paired rune ring, rotating; channel spins it up hard
  const spin = t * (0.6 + chan * 4.5);
  ctx.strokeStyle = `rgba(${rgb},${0.55 + chan * 0.4})`;
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 4; i++) {
    const ga = spin + (i / 4) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(x, y, 11.5, 6.2, 0, ga, ga + 0.9);
    ctx.stroke();
  }
  // glyph ticks around the rim
  ctx.fillStyle = `rgba(${rgb},${0.7 + chan * 0.3})`;
  for (let i = 0; i < 6; i++) {
    const ga = -spin * 0.6 + (i / 6) * Math.PI * 2;
    ctx.fillRect(x + Math.cos(ga) * 13.5 - 1, y + Math.sin(ga) * 7.4 - 1, 2, 2);
  }
  // settled center: a soft core that breathes; channel raises a mote column
  const breath = 0.5 + 0.5 * Math.sin(t * 1.8 + x * 0.05);
  const cg = ctx.createRadialGradient(x, y, 0, x, y, 7 + chan * 3);
  cg.addColorStop(0, `rgba(${rgb},${0.35 + 0.2 * breath + chan * 0.3})`);
  cg.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = cg;
  ctx.fillRect(x - 10, y - 10, 20, 20);
  if (chan > 0) {
    ctx.fillStyle = `rgba(${rgb},0.9)`;
    for (let i = 0; i < 4; i++) {
      const pr = fract(t * 1.8 + i * 0.25);
      ctx.globalAlpha = (1 - pr) * chan;
      ctx.fillRect(x + (flick(i * 7.7 + Math.floor(t * 6)) - 0.5) * 14, y - pr * 30, 1.8, 1.8);
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  lights.push({ x, y, r: 30 + chan * 18, rgb, a: 0.08 + chan * 0.1 });
}

// Built 'beacon' — the save point: a settled-light pylon. Checkpoint gold,
// perfectly steady; a slow settled ring breathes off it every few seconds.
function drawBeacon(ctx, b, t, lights) {
  const { x, y } = b;
  shadowBlob(ctx, x, y + 8, 10, 4);
  // squat tapered pylon, gold-trimmed
  ctx.fillStyle = PAL.graphMid;
  ctx.beginPath();
  ctx.moveTo(x - 6.5, y + 8); ctx.lineTo(x - 3, y - 16); ctx.lineTo(x + 3, y - 16); ctx.lineTo(x + 6.5, y + 8);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = PAL.graphDark;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, y + 7); ctx.lineTo(x, y - 15); ctx.stroke();
  ctx.fillStyle = PAL.lythAmber; // service bands
  ctx.fillRect(x - 5, y + 1, 10, 1.8);
  ctx.fillRect(x - 4, y - 7, 8, 1.8);
  // the settled lamp: steady, not blinking — finality holds
  ctx.save();
  ctx.fillStyle = PAL.lythGold;
  ctx.shadowColor = PAL.lythGold;
  ctx.shadowBlur = 9;
  ctx.beginPath(); ctx.ellipse(x, y - 20, 3.6, 4.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PAL.lythPale;
  ctx.beginPath(); ctx.arc(x, y - 21, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // the slow settled ring — what is anchored cannot be unsaid
  const pr = fract(t / 2.6 + flick(x * 0.17));
  if (pr < 0.4) {
    ctx.strokeStyle = `rgba(255,217,138,${(1 - pr / 0.4) * 0.4})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(x, y + 4, 8 + pr * 50, (8 + pr * 50) * 0.45, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  rimArc(ctx, x - 1, y - 6, 7, 0.5);
  lights.push({ x, y: y - 18, r: 46, rgb: '255,217,138', a: 0.12 });
}

// The carried LythiumSeal: a checkpoint you bring with you. A gold lantern
// ring orbits the bearer; Phantoms inside it cannot hold their disguise.
function drawSealAura(ctx, x, y, t, lights) {
  ctx.save();
  const breath = 0.5 + 0.5 * Math.sin(t * 1.6);
  ctx.strokeStyle = `rgba(255,217,138,${0.3 + 0.18 * breath})`;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.ellipse(x, y + 6, 24, 11, 0, 0, Math.PI * 2);
  ctx.stroke();
  // seal-rune ticks riding the ring
  ctx.fillStyle = `rgba(255,239,194,${0.55 + 0.3 * breath})`;
  for (let i = 0; i < 4; i++) {
    const ga = t * 0.9 + (i / 4) * Math.PI * 2;
    ctx.fillRect(x + Math.cos(ga) * 24 - 1.2, y + 6 + Math.sin(ga) * 11 - 1.2, 2.4, 2.4);
  }
  // the lantern-sigil itself, riding at the shoulder
  ctx.translate(x + 10, y - 14 + Math.sin(t * 2.1) * 1.2);
  ctx.strokeStyle = PAL.lythGold;
  ctx.fillStyle = PAL.lythGold;
  ctx.shadowColor = PAL.lythGold;
  ctx.shadowBlur = 7;
  drawRune(ctx, 3, 3.6); // SEAL
  ctx.restore();
  lights.push({ x, y, r: 70, rgb: '255,217,138', a: 0.1 + 0.04 * breath });
}

// Jagged lightning path appended to the current path (no stroke here).
function jagPath(ctx, x0, y0, x1, y1, segs, mag, seed) {
  ctx.moveTo(x0, y0);
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len, py = dx / len; // perpendicular
  for (let i = 1; i < segs; i++) {
    const k = i / segs;
    const off = (flick(seed + i * 7.3) - 0.5) * 2 * mag;
    ctx.lineTo(x0 + dx * k + px * off, y0 + dy * k + py * off);
  }
  ctx.lineTo(x1, y1);
}

// Gold service chevrons under an upgraded structure (level 2-3).
function drawLevelPips(ctx, x, y, level) {
  const lvl = level ?? 1;
  if (lvl <= 1) return;
  ctx.save();
  ctx.fillStyle = PAL.lythGold;
  for (let i = 0; i < lvl; i++) {
    const cx = x - (lvl - 1) * 4.5 + i * 9;
    ctx.beginPath();
    ctx.moveTo(cx - 3, y + 2); ctx.lineTo(cx, y - 2.5); ctx.lineTo(cx + 3, y + 2);
    ctx.lineTo(cx, y + 0.5);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

// Survival reads on operators: tiny hearts shown only while hurt.
function drawHeartPips(ctx, x, y, hp, maxHp) {
  ctx.save();
  const w = 7;
  const x0 = x - (maxHp * w) / 2 + w / 2;
  for (let i = 0; i < maxHp; i++) {
    const cx = x0 + i * w;
    ctx.fillStyle = i < hp ? PAL.red : 'rgba(30,32,40,0.9)';
    ctx.beginPath();
    ctx.arc(cx - 1.2, y - 0.8, 1.5, 0, Math.PI * 2);
    ctx.arc(cx + 1.2, y - 0.8, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 2.6, y - 0.2); ctx.lineTo(cx, y + 2.8); ctx.lineTo(cx + 2.6, y - 0.2);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

// Mission-XP level pips: one small gold diamond per level-up (levels 2-4),
// drawn beside the operator's name. Absent on classic snapshots (no p.level).
function drawLevelDiamonds(ctx, x, y, level) {
  const n = Math.max(0, Math.min(4, level ?? 1) - 1);
  if (!n) return;
  ctx.save();
  ctx.fillStyle = PAL.lythGold;
  ctx.shadowColor = PAL.lythGold;
  ctx.shadowBlur = 3;
  for (let i = 0; i < n; i++) {
    const cx = x + i * 7;
    ctx.beginPath();
    ctx.moveTo(cx, y - 3); ctx.lineTo(cx + 2.6, y); ctx.lineTo(cx, y + 3); ctx.lineTo(cx - 2.6, y);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

// Relay-cyan shield bubble: thin at 1 charge, doubled-bright at 2.
function drawShieldBubble(ctx, x, y, shield, t) {
  ctx.save();
  const a = 0.3 + 0.12 * Math.sin(t * 3.2 + x * 0.05);
  ctx.strokeStyle = `rgba(111,216,242,${a + (shield >= 2 ? 0.25 : 0)})`;
  ctx.lineWidth = shield >= 2 ? 2.2 : 1.4;
  ctx.shadowColor = PAL.relay;
  ctx.shadowBlur = 7;
  ctx.beginPath();
  ctx.ellipse(x, y - 2, 16, 17, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = `rgba(191,251,255,${a})`; // glints sliding around the shell
  for (let i = 0; i < (shield >= 2 ? 3 : 2); i++) {
    const ga = t * 1.4 + i * (Math.PI * 2 / 3);
    ctx.fillRect(x + Math.cos(ga) * 15 - 1, y - 2 + Math.sin(ga) * 16 - 1, 2, 2);
  }
  ctx.restore();
}

// Item drops (chest loot): medkit / shield / cracker / weapon token.
function drawItemDrop(ctx, d, t, lights) {
  const bob = Math.sin(t * (Math.PI * 2 / 1.4) + (d.x + d.y) * 0.07) * 2;
  const y = d.y - 5 + bob;
  let a2 = 1;
  if (d.ttl != null && d.ttl < 3) a2 = (d.ttl % 0.4) < 0.2 ? 0.45 : 1; // expiry blink
  ctx.save();
  ctx.globalAlpha *= a2;
  ctx.fillStyle = 'rgba(11,10,20,0.35)';
  ctx.beginPath(); ctx.ellipse(d.x, d.y + 6, 5, 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.translate(d.x, y);
  if (d.kind === 'medkit') {
    ctx.fillStyle = '#d8e2ee';
    ctx.fillRect(-5, -4, 10, 8);
    ctx.strokeStyle = '#8A98B8';
    ctx.lineWidth = 1;
    ctx.strokeRect(-5, -4, 10, 8);
    ctx.fillStyle = PAL.teal;
    ctx.fillRect(-1.2, -3, 2.4, 6);
    ctx.fillRect(-3.5, -1.2, 7, 2.4);
    lights.push({ x: d.x, y, r: 18, rgb: '95,210,180', a: 0.1 * a2 });
  } else if (d.kind === 'shield') {
    ctx.strokeStyle = PAL.relay;
    ctx.lineWidth = 1.6;
    ctx.shadowColor = PAL.relay;
    ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(111,216,242,0.35)';
    ctx.beginPath(); ctx.arc(0, 0, 3.4, 0, Math.PI * 2); ctx.fill();
    lights.push({ x: d.x, y, r: 18, rgb: '111,216,242', a: 0.1 * a2 });
  } else if (d.kind === 'cracker') {
    ctx.rotate(0.4);
    ctx.fillStyle = '#8C2A22';
    ctx.fillRect(-4.5, -2.6, 9, 5.2);
    ctx.fillStyle = '#C75B22';
    ctx.fillRect(-4.5, -2.6, 9, 1.8);
    ctx.fillStyle = PAL.graphDark;
    ctx.fillRect(-5.4, -2.6, 1.4, 5.2);
    ctx.fillRect(4, -2.6, 1.4, 5.2);
  } else if (d.kind === 'toxin') {
    // stoppered flask of green sludge (desolator vintage)
    ctx.fillStyle = '#26301A'; // glass body
    ctx.beginPath();
    ctx.moveTo(-1.6, -5); ctx.lineTo(-1.6, -1.5);
    ctx.quadraticCurveTo(-4.5, 0, -4.5, 2.2);
    ctx.quadraticCurveTo(-4.5, 5, 0, 5);
    ctx.quadraticCurveTo(4.5, 5, 4.5, 2.2);
    ctx.quadraticCurveTo(4.5, 0, 1.6, -1.5);
    ctx.lineTo(1.6, -5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(150,210,90,0.85)'; // sludge fill, lapping
    ctx.beginPath();
    ctx.ellipse(0, 2.4 + Math.sin(t * 2.4 + d.x * 0.05) * 0.4, 3.6, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(220,255,180,0.7)'; // rising bubble
    const bpr = fract(t * 0.8 + d.x * 0.03);
    if (bpr < 0.6) ctx.fillRect(-0.8, 3 - bpr * 4, 1.2, 1.2);
    ctx.fillStyle = '#4A4232'; // cork
    ctx.fillRect(-2.2, -6.6, 4.4, 2.2);
    lights.push({ x: d.x, y, r: 18, rgb: '120,190,70', a: 0.1 * a2 });
  } else if (d.kind === 'controller') {
    // mind-control orb: a dark sphere with one waking relay iris
    ctx.fillStyle = PAL.voidNight;
    ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = PAL.relay;
    ctx.lineWidth = 1.2;
    ctx.shadowColor = PAL.relay;
    ctx.shadowBlur = 7;
    ctx.stroke();
    ctx.shadowBlur = 0;
    const ip = 0.5 + 0.5 * Math.sin(t * 4 + d.x * 0.07);
    ctx.fillStyle = `rgba(191,251,255,${0.5 + 0.5 * ip})`; // the iris
    ctx.beginPath(); ctx.arc(0, 0, 1.6 + ip * 0.8, 0, Math.PI * 2); ctx.fill();
    ctx.save(); // psychic orbit ring
    ctx.rotate(t * 1.2);
    ctx.strokeStyle = 'rgba(111,216,242,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, 0, 7.4, 2.4, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    lights.push({ x: d.x, y, r: 20, rgb: '111,216,242', a: 0.12 * a2 });
  } else { // weapon token + future kinds — a slowly turning gold cog
    ctx.fillStyle = PAL.lythGold;
    ctx.strokeStyle = PAL.lythAmber;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, 4.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const ga = (i / 6) * Math.PI * 2 + t * 0.6;
      ctx.fillRect(Math.cos(ga) * 5.4 - 1, Math.sin(ga) * 5.4 - 1, 2, 2);
    }
    ctx.fillStyle = '#7A5A1E';
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('+1', 0, 2);
    lights.push({ x: d.x, y, r: 20, rgb: '255,217,138', a: 0.12 * a2 });
  }
  ctx.restore();
}

// Screen-space moon glyph for bastion nights; crimson on blood moons.
function drawMoonGlyph(ctx, VW, nightK, blood, t) {
  const x = VW - 58, y = 56, r = 14;
  ctx.save();
  ctx.globalAlpha = Math.min(1, nightK * 1.4);
  if (blood) {
    ctx.shadowColor = '#E04848';
    ctx.shadowBlur = 18 + 6 * Math.sin(t * 2.4);
    ctx.fillStyle = '#A1242F';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.save(); // maria, clipped to the disc
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgba(90,12,20,0.8)';
    ctx.beginPath(); ctx.arc(x - 4, y - 3, 3.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 4, y + 4, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = `rgba(255,90,102,${0.5 + 0.3 * Math.sin(t * 3)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.stroke();
  } else {
    ctx.fillStyle = PAL.coldHi;
    ctx.shadowColor = PAL.coldHi;
    ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.save(); // crescent bite, clipped to the disc
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgba(11,10,20,0.85)';
    ctx.beginPath(); ctx.arc(x + 5, y - 3, r - 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// ============================== BUILD SITES ==============================
function holoShape(ctx, kind, x, y) {
  if (kind === 'pylon') {
    ctx.beginPath();
    ctx.moveTo(x - 7, y + 8); ctx.lineTo(x - 3.5, y - 22); ctx.lineTo(x + 3.5, y - 22); ctx.lineTo(x + 7, y + 8);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - 26, 5, 0, Math.PI * 2); ctx.stroke();
  } else if (kind === 'turret') {
    ctx.beginPath();
    ctx.moveTo(x, y - 4); ctx.lineTo(x - 12, y + 10); ctx.lineTo(x + 12, y + 10);
    ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - 4, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else if (kind === 'farm') {
    ctx.strokeRect(x - 16, y - 9, 32, 18);
    ctx.beginPath();
    for (const ry of [-4, 1, 6]) { ctx.moveTo(x - 12, y + ry); ctx.lineTo(x + 12, y + ry); }
    ctx.stroke();
  } else if (kind === 'beacon') {
    // squat settled-light pylon with its lamp capsule
    ctx.beginPath();
    ctx.moveTo(x - 6.5, y + 8); ctx.lineTo(x - 3, y - 16); ctx.lineTo(x + 3, y - 16); ctx.lineTo(x + 6.5, y + 8);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x, y - 20, 3.6, 4.6, 0, 0, Math.PI * 2); ctx.stroke();
  } else if (kind === 'wall') {
    // crenellated wall segment outline
    ctx.fillRect(x - 21, y - 12, 42, 22);
    ctx.strokeRect(x - 21, y - 12, 42, 22);
    ctx.beginPath();
    for (const mx of [-16, -2, 12]) ctx.rect(x + mx, y - 17, 8, 5);
    ctx.stroke();
  } else if (kind === 'comm') {
    // comm mast + dish outline
    ctx.beginPath();
    ctx.moveTo(x - 6, y + 8); ctx.lineTo(x - 2, y - 26); ctx.lineTo(x + 2, y - 26); ctx.lineTo(x + 6, y + 8);
    ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + 5, y - 22, 5.5, -1.2, 1.6); ctx.stroke();
  } else { // barricade
    ctx.fillRect(x - 18, y - 10, 36, 18);
    ctx.strokeRect(x - 18, y - 10, 36, 18);
  }
}

function drawHpPips(ctx, x, y, frac) {
  const n = 7, lit = Math.max(1, Math.ceil(n * frac));
  ctx.save();
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i < lit ? PAL.teal : 'rgba(30,32,40,0.9)';
    ctx.fillRect(x - (n * 5) / 2 + i * 5, y, 3.5, 3.5);
  }
  ctx.restore();
}

function drawBarricade(ctx, b, t) {
  const { x, y } = b;
  const hpf = Math.max(0, Math.min(1, (b.hp ?? 14) / (b.maxHp || 14)));
  // side face below the plate (pseudo-3D)
  ctx.fillStyle = PAL.graphDark;
  ctx.fillRect(x - 18, y + 2, 36, 7);
  // ore-built plate face
  ctx.fillStyle = '#3A3F4E';
  ctx.fillRect(x - 18, y - 11, 36, 13);
  ctx.strokeStyle = PAL.graphPlate; // diagonal cross-brace
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - 14, y - 9); ctx.lineTo(x + 14, y);
  ctx.moveTo(x + 14, y - 9); ctx.lineTo(x - 14, y);
  ctx.stroke();
  ctx.fillStyle = '#6E7A94'; // rivets
  for (const [rx, ry] of [[-16, -9], [16, -9], [-16, -1], [16, -1]]) ctx.fillRect(x + rx - 1, y + ry, 2, 2);
  ctx.fillStyle = PAL.moonsteel; // moonlit top rim
  ctx.fillRect(x - 18, y - 11, 36, 1.5);
  ctx.fillStyle = PAL.teal; // operator-built tag
  ctx.fillRect(x + 11, y - 6, 5, 3);
  if (hpf < 0.6) {
    ctx.strokeStyle = '#14161E';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x - 10, y - 11); ctx.lineTo(x - 7, y - 5); ctx.lineTo(x - 11, y + 1);
    ctx.moveTo(x + 6, y - 11); ctx.lineTo(x + 4, y - 4);
    ctx.stroke();
    if (hpf < 0.25) {
      // weld-glow from inside: about to fail
      ctx.save();
      ctx.strokeStyle = PAL.lythAmber;
      ctx.shadowColor = PAL.lythAmber;
      ctx.shadowBlur = 6;
      ctx.globalAlpha *= 0.5 + 0.4 * Math.sin(t * 7);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 10, y - 11); ctx.lineTo(x - 7, y - 5); ctx.lineTo(x - 11, y + 1);
      ctx.moveTo(x + 6, y - 11); ctx.lineTo(x + 4, y - 4);
      ctx.stroke();
      ctx.restore();
    }
  }
}

// ---- FORTIFIED WALLS: tile-aligned segments that read as one connected
// run (joint seams toward built neighbors, end caps where the run stops,
// level trims, damage cracks). Bases built from these are damageable,
// repairable, upgradable — never indestructible '#' grid.
let wallIdx = { list: null, set: null };
function wallSetFor(snap) {
  const list = snap?.builds ?? [];
  if (wallIdx.list !== list) {
    const set = new Set();
    for (const b of list) {
      if (b.kind === 'wall' && b.built) set.add(`${Math.floor(b.x / TILE)},${Math.floor(b.y / TILE)}`);
    }
    wallIdx = { list, set };
  }
  return wallIdx.set;
}

function drawWallSegment(ctx, b, t, snap) {
  const set = wallSetFor(snap);
  const gx = Math.floor(b.x / TILE), gy = Math.floor(b.y / TILE);
  const px = gx * TILE, py = gy * TILE;
  const nN = set.has(`${gx},${gy - 1}`), nS = set.has(`${gx},${gy + 1}`);
  const nW = set.has(`${gx - 1},${gy}`), nE = set.has(`${gx + 1},${gy}`);
  const lvl = b.level ?? 1;
  const hpf = Math.max(0, Math.min(1, (b.hp ?? 20) / (b.maxHp || 20)));
  const top = py - 6; // raised plate, same elevation read as '#' rock
  // drop shadow
  ctx.fillStyle = 'rgba(11,10,20,0.45)';
  ctx.fillRect(px + 4, py + 6, TILE, TILE);
  // ore-built plate body
  ctx.fillStyle = lvl >= 3 ? '#3E4452' : lvl >= 2 ? '#3A3F4E' : '#363B4A';
  ctx.fillRect(px, top, TILE, TILE);
  // deterministic plate mottling
  ctx.fillStyle = 'rgba(20,22,30,0.32)';
  if ((gx + gy) % 2) ctx.fillRect(px + 6, top + 9, 15, 10);
  else ctx.fillRect(px + 22, top + 21, 17, 9);
  // front face: elevation read where the run ends below
  if (!nS) {
    ctx.fillStyle = '#23262F';
    ctx.fillRect(px, py + TILE - 6, TILE, 6);
    ctx.fillStyle = 'rgba(138,152,184,0.14)';
    ctx.fillRect(px, py + TILE - 6, TILE, 1);
  }
  // moonlit top rim where the run ends above
  if (!nN) {
    ctx.fillStyle = 'rgba(138,152,184,0.35)';
    ctx.fillRect(px, top, TILE, 2);
  }
  // joints toward neighbors, caps where the run stops
  ctx.strokeStyle = 'rgba(17,19,28,0.8)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  if (nW) { ctx.moveTo(px + 0.6, top + 4); ctx.lineTo(px + 0.6, top + TILE - 4); }
  if (nE) { ctx.moveTo(px + TILE - 0.6, top + 4); ctx.lineTo(px + TILE - 0.6, top + TILE - 4); }
  if (nN) { ctx.moveTo(px + 4, top + 0.6); ctx.lineTo(px + TILE - 4, top + 0.6); }
  if (nS) { ctx.moveTo(px + 4, top + TILE - 0.6); ctx.lineTo(px + TILE - 4, top + TILE - 0.6); }
  ctx.stroke();
  if (!nW) { // west end cap pillar
    ctx.fillStyle = '#2A2E3A';
    ctx.fillRect(px, top, 5, TILE);
    ctx.fillStyle = 'rgba(138,152,184,0.3)';
    ctx.fillRect(px, top, 1.4, TILE);
  }
  if (!nE) { // east end cap pillar
    ctx.fillStyle = '#2A2E3A';
    ctx.fillRect(px + TILE - 5, top, 5, TILE);
    ctx.fillStyle = 'rgba(11,10,20,0.4)';
    ctx.fillRect(px + TILE - 1.4, top, 1.4, TILE);
  }
  // level trims: L2 steel band + rivets, L3 moonsteel crenellation
  if (lvl >= 2) {
    ctx.fillStyle = PAL.steel;
    ctx.fillRect(px + 2, top + TILE * 0.56, TILE - 4, 2.4);
    ctx.fillStyle = '#6E7A94';
    for (const rx of [8, 24, 40]) ctx.fillRect(px + rx - 1, top + TILE * 0.56 + 0.4, 1.8, 1.8);
  }
  if (lvl >= 3) {
    for (let i = 0; i < 3; i++) {
      const mx = px + 5 + i * 15;
      ctx.fillStyle = '#3E4452';
      ctx.fillRect(mx, top - 5, 9, 6);
      ctx.fillStyle = PAL.moonsteel;
      ctx.fillRect(mx, top - 5, 9, 1.4);
    }
  }
  // operator-built teal tag, one segment in five
  if ((gx * 7 + gy * 13) % 5 === 0) {
    ctx.fillStyle = PAL.teal;
    ctx.fillRect(px + TILE - 12, top + TILE - 12, 5, 3);
  }
  // damage cracks + failing weld glow (shoot a wall to demolish it — direct
  // hits from your own fire are the official way out of a self-lock-in)
  if (hpf < 0.6) {
    ctx.strokeStyle = '#14161E';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(px + 12, top + 2); ctx.lineTo(px + 17, top + 14); ctx.lineTo(px + 10, top + 26);
    ctx.moveTo(px + 33, top + 6); ctx.lineTo(px + 29, top + 19);
    if (hpf < 0.4) { ctx.moveTo(px + 40, top + 14); ctx.lineTo(px + 34, top + 30); ctx.lineTo(px + 40, top + 41); }
    ctx.stroke();
    if (hpf < 0.25) {
      ctx.save();
      ctx.strokeStyle = PAL.lythAmber;
      ctx.shadowColor = PAL.lythAmber;
      ctx.shadowBlur = 6;
      ctx.globalAlpha *= 0.5 + 0.4 * Math.sin(t * 7 + gx);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + 12, top + 2); ctx.lineTo(px + 17, top + 14); ctx.lineTo(px + 10, top + 26);
      ctx.stroke();
      ctx.restore();
    }
  }
}

// ---- COMM TOWER ('comm' build): mission-prep structure. Unbuilt sites read
// as a BROKEN tower (leaning lattice, fallen dish, dying sparks); repaired,
// it stands straight with a blinking beacon and rising signal rings.
function drawCommTower(ctx, b, t, broken, lights) {
  const { x, y } = b;
  shadowBlob(ctx, x + 2, y + 7, 14, 5);
  ctx.save();
  if (broken) {
    ctx.translate(x, y + 6);
    ctx.rotate(0.16);
    ctx.translate(-x, -(y + 6));
  }
  // lattice mast
  ctx.strokeStyle = PAL.graphPlate;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(x - 6, y + 7); ctx.lineTo(x - 1.5, y - 34);
  ctx.moveTo(x + 6, y + 7); ctx.lineTo(x + 1.5, y - 34);
  ctx.stroke();
  ctx.strokeStyle = PAL.graphDark; // cross-bracing
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const k = i / 4, k2 = (i + 1) / 4;
    const w0 = 6 - k * 4.5, w1 = 6 - k2 * 4.5;
    const y0 = y + 7 - k * 41, y1 = y + 7 - k2 * 41;
    ctx.moveTo(x - w0, y0); ctx.lineTo(x + w1, y1);
    ctx.moveTo(x + w0, y0); ctx.lineTo(x - w1, y1);
  }
  ctx.stroke();
  ctx.fillStyle = PAL.moonsteel;
  ctx.fillRect(x - 2, y - 36, 4, 3); // mast head
  if (broken) {
    ctx.restore();
    // the dish lies dead at the base
    ctx.fillStyle = PAL.graphMid;
    ctx.beginPath();
    ctx.ellipse(x + 12, y + 5, 7, 3.2, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PAL.graphDark;
    ctx.lineWidth = 1;
    ctx.stroke();
    // a sheared feed cable, sparking now and then
    ctx.strokeStyle = '#2A2E3A';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x + 2, y - 20);
    ctx.quadraticCurveTo(x + 9, y - 10, x + 10, y + 2);
    ctx.stroke();
    if (fract(t * 0.7 + x * 0.013) < 0.12) {
      ctx.save();
      ctx.strokeStyle = PAL.eye;
      ctx.shadowColor = PAL.relay;
      ctx.shadowBlur = 6;
      ctx.lineWidth = 1;
      ctx.beginPath();
      jagPath(ctx, x + 10, y + 2, x + 14, y + 6, 3, 3, Math.floor(t * 30) + x);
      ctx.stroke();
      ctx.restore();
    }
  } else {
    ctx.restore();
    // dish locked skyward + red aircraft lamp + signal rings
    ctx.fillStyle = PAL.graphMid;
    ctx.beginPath();
    ctx.ellipse(x + 5.5, y - 29, 5.5, 3.4, -0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PAL.moonsteel;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = PAL.anchor;
    ctx.fillRect(x + 7.5, y - 32.5, 1.6, 1.6); // feed horn
    const blink = Math.floor(t * 1.4) % 2 === 0;
    ctx.fillStyle = blink ? PAL.red : '#5A2230';
    if (blink) { ctx.shadowColor = PAL.red; ctx.shadowBlur = 6; }
    ctx.beginPath(); ctx.arc(x, y - 38, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    // signal ring rising every 2s
    const sp = fract(t * 0.5 + x * 0.01);
    ctx.save();
    ctx.globalAlpha *= (1 - sp) * 0.7;
    ctx.strokeStyle = PAL.relay;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y - 38, 3 + sp * 12, -Math.PI * 0.85, -Math.PI * 0.15);
    ctx.stroke();
    ctx.restore();
    lights.push({ x, y: y - 32, r: 36, rgb: '111,216,242', a: 0.07 });
  }
}

// ---- THE ANCHORCRAFT, LANDED (stronghold early extraction): all four
// beacons lit under wave pressure and the vessel comes down by the base.
// Boarding glow marks the hatch; she waits — boarding stays optional.
function drawShip(ctx, ship, t, lights) {
  const { x, y } = ship;
  const breath = 0.7 + 0.3 * Math.sin(t * 1.6);
  // scorched landing ground
  ctx.fillStyle = 'rgba(11,10,20,0.5)';
  ctx.beginPath();
  ctx.ellipse(x, y + 16, 58, 17, 0, 0, Math.PI * 2);
  ctx.fill();
  // boarding glow ring at the hatch (under everything else)
  ctx.save();
  ctx.strokeStyle = `rgba(255,217,138,${0.35 + 0.35 * breath})`;
  ctx.shadowColor = PAL.lythGold;
  ctx.shadowBlur = 10;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(x, y + 16, 30 + breath * 3, 10 + breath, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  // landing legs + skids
  ctx.strokeStyle = PAL.graphDark;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - 30, y - 4); ctx.lineTo(x - 38, y + 13);
  ctx.moveTo(x + 30, y - 4); ctx.lineTo(x + 38, y + 13);
  ctx.stroke();
  ctx.fillStyle = PAL.graphPlate;
  ctx.fillRect(x - 45, y + 12, 15, 3);
  ctx.fillRect(x + 30, y + 12, 15, 3);
  // hull: long graphite lifting body, nose left
  ctx.fillStyle = PAL.graphMid;
  ctx.beginPath();
  ctx.moveTo(x - 52, y - 2);
  ctx.quadraticCurveTo(x - 50, y - 16, x - 22, y - 19);
  ctx.lineTo(x + 30, y - 19);
  ctx.quadraticCurveTo(x + 52, y - 16, x + 50, y - 3);
  ctx.quadraticCurveTo(x + 30, y + 5, x, y + 5);
  ctx.quadraticCurveTo(x - 40, y + 5, x - 52, y - 2);
  ctx.closePath(); ctx.fill();
  // belly shadow
  ctx.fillStyle = PAL.graphDark;
  ctx.beginPath();
  ctx.moveTo(x - 48, y - 1);
  ctx.quadraticCurveTo(x, y + 6, x + 48, y - 2);
  ctx.quadraticCurveTo(x + 30, y + 5, x, y + 5);
  ctx.quadraticCurveTo(x - 40, y + 5, x - 48, y - 1);
  ctx.closePath(); ctx.fill();
  // tail fin
  ctx.fillStyle = PAL.graphPlate;
  ctx.beginPath();
  ctx.moveTo(x + 30, y - 18);
  ctx.lineTo(x + 38, y - 34);
  ctx.lineTo(x + 44, y - 18);
  ctx.closePath(); ctx.fill();
  // moonsteel dorsal rim
  ctx.strokeStyle = PAL.moonsteel;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x - 49, y - 7);
  ctx.quadraticCurveTo(x - 46, y - 16.5, x - 22, y - 18.4);
  ctx.lineTo(x + 28, y - 18.4);
  ctx.stroke();
  // cockpit glow strip on the nose
  ctx.save();
  ctx.fillStyle = PAL.relay;
  ctx.shadowColor = PAL.relay;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(x - 46, y - 9);
  ctx.quadraticCurveTo(x - 42, y - 14, x - 30, y - 14.5);
  ctx.lineTo(x - 30, y - 11.5);
  ctx.quadraticCurveTo(x - 40, y - 11, x - 46, y - 9);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  // engine pods idling cold-blue
  for (const ex2 of [-12, 14]) {
    ctx.fillStyle = PAL.graphPlate;
    ctx.beginPath();
    ctx.ellipse(x + ex2, y - 21, 7, 3.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.fillStyle = `rgba(111,216,242,${0.25 + 0.2 * breath})`;
    ctx.shadowColor = PAL.relay;
    ctx.shadowBlur = 5;
    ctx.fillRect(x + ex2 - 4.5, y - 22.2, 9, 2.2);
    ctx.restore();
  }
  // open boarding hatch: warm light spilling down the ramp
  ctx.fillStyle = '#11131F';
  ctx.fillRect(x - 7, y - 13, 14, 16);
  const hg = ctx.createLinearGradient(0, y - 13, 0, y + 14);
  hg.addColorStop(0, `rgba(255,217,138,${0.55 * breath + 0.25})`);
  hg.addColorStop(1, 'rgba(255,217,138,0)');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.moveTo(x - 6, y - 12);
  ctx.lineTo(x + 6, y - 12);
  ctx.lineTo(x + 13, y + 14);
  ctx.lineTo(x - 13, y + 14);
  ctx.closePath(); ctx.fill();
  // tail beacon blink
  if (Math.floor(t * 2.2) % 2 === 0) {
    ctx.save();
    ctx.fillStyle = PAL.lythGold;
    ctx.shadowColor = PAL.lythGold;
    ctx.shadowBlur = 7;
    ctx.beginPath(); ctx.arc(x + 38, y - 35, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  lights.push({ x, y: y + 4, r: 80, rgb: '255,217,138', a: 0.1 * breath + 0.05 });
  lights.push({ x: x - 38, y: y - 11, r: 46, rgb: '111,216,242', a: 0.08 });
}

// Shared tripod + ring base for every turret type.
function turretBase(ctx, x, y) {
  ctx.strokeStyle = PAL.graphPlate;
  ctx.lineWidth = 3;
  for (const la of [-Math.PI / 2, Math.PI / 6, Math.PI * 5 / 6]) {
    ctx.beginPath();
    ctx.moveTo(x, y + 2);
    ctx.lineTo(x + Math.cos(la) * 13, y + 4 + Math.abs(Math.sin(la)) * 8);
    ctx.stroke();
  }
  ctx.fillStyle = PAL.graphPlate;
  ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = PAL.graphDark;
  ctx.lineWidth = 1;
  ctx.stroke();
}

// Visual target: nearest awake enemy within `tiles` of the turret.
function turretAim(snap, x, y, t, tiles = 5) {
  let ta = t * 0.6, best = (TILE * tiles) ** 2;
  for (const e of snap.enemies || []) {
    if (e.awake === false) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d < best) { best = d; ta = Math.atan2(e.y - y, e.x - x); }
  }
  return ta;
}

// PRISM — faceted crystal head; nearby prisms feed it charge (RA2 homage).
// The killing beam itself arrives via the 'prismBeam' event.
function drawPrismTower(ctx, b, t, snap, lights) {
  const { x, y } = b;
  turretBase(ctx, x, y);
  // feeder filaments from other built prisms within 4 tiles (cap 3, like the sim)
  let nLinks = 0;
  for (const o of snap.builds ?? []) {
    if (o === b || !o.built || o.kind !== 'turret' || (o.ttype || 'gun') !== 'prism') continue;
    if ((o.x - x) ** 2 + (o.y - y) ** 2 > (TILE * 4) ** 2) continue;
    nLinks++;
    ctx.save();
    ctx.strokeStyle = `rgba(111,216,242,${0.22 + 0.16 * Math.sin(t * 3 + nLinks * 2.1)})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.lineDashOffset = -t * 16;
    ctx.beginPath();
    ctx.moveTo(o.x, o.y - 14); ctx.lineTo(x, y - 14);
    ctx.stroke();
    ctx.restore();
    if (nLinks >= 3) break;
  }
  // mount post
  ctx.fillStyle = PAL.graphDark;
  ctx.fillRect(x - 2, y - 9, 4, 9);
  // crystal: tall diamond, charge shimmer scales with feeders
  const chg = 0.55 + 0.45 * Math.sin(t * (2 + nLinks * 1.5) + x * 0.05);
  ctx.save();
  ctx.translate(x, y - 16);
  ctx.shadowColor = PAL.relay;
  ctx.shadowBlur = (4 + nLinks * 3) * chg + 3;
  const cg = ctx.createLinearGradient(0, 9, 0, -9);
  cg.addColorStop(0, PAL.pylonBlue);
  cg.addColorStop(0.55, PAL.relay);
  cg.addColorStop(1, PAL.anchor);
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.moveTo(0, -9); ctx.lineTo(5.5, 0); ctx.lineTo(0, 9); ctx.lineTo(-5.5, 0);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = `rgba(223,243,255,${0.5 + 0.4 * chg})`; // facet lines
  ctx.lineWidth = 1;
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.moveTo(0, -9); ctx.lineTo(0, 9);
  ctx.moveTo(-5.5, 0); ctx.lineTo(5.5, 0);
  ctx.stroke();
  ctx.restore();
  rimArc(ctx, x, y - 16, 8, 0.45);
  lights.push({ x, y: y - 16, r: 28 + nLinks * 8, rgb: '111,216,242', a: 0.08 + nLinks * 0.025 });
}

// TESLA — graphite coil stack, relay orb crawling with idle arcs.
// Chain zaps arrive via the 'teslaZap' event.
function drawTeslaTower(ctx, b, t, lights) {
  const { x, y } = b;
  turretBase(ctx, x, y);
  for (let i = 0; i < 4; i++) {
    const w = 12 - i * 2.2;
    ctx.fillStyle = i % 2 ? PAL.graphDark : '#4A5060';
    ctx.fillRect(x - w / 2, y - 8 - i * 4.4, w, 3.4);
  }
  ctx.strokeStyle = '#6E5A3A'; // copper winding hints
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 5, y - 10); ctx.lineTo(x + 5, y - 11.5);
  ctx.moveTo(x - 4, y - 19); ctx.lineTo(x + 4, y - 20.2);
  ctx.stroke();
  const frame = Math.floor(t * 16);
  const live = flick(frame + x * 0.7) > 0.45;
  ctx.save();
  ctx.fillStyle = PAL.relay;
  ctx.shadowColor = PAL.relay;
  ctx.shadowBlur = live ? 12 : 6;
  ctx.beginPath(); ctx.arc(x, y - 27, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PAL.eye;
  ctx.beginPath(); ctx.arc(x, y - 27, 1.8, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (live) {
    // idle micro-arcs licking off the orb
    ctx.save();
    ctx.strokeStyle = `rgba(191,251,255,${0.45 + 0.3 * flick(frame * 3.1)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 2; i++) {
      const aa = flick(frame + i * 7.7) * Math.PI * 2;
      jagPath(ctx, x, y - 27, x + Math.cos(aa) * 9, y - 27 + Math.sin(aa) * 7, 3, 2.5, frame + i * 31);
    }
    ctx.stroke();
    ctx.restore();
  }
  rimArc(ctx, x, y - 18, 8, 0.5);
  lights.push({ x, y: y - 26, r: 30, rgb: '111,216,242', a: live ? 0.12 : 0.07 });
}

// TOXIN — squat sludge vat with a sprayer nozzle; lobs globs at the swarm.
function drawToxinTurret(ctx, b, t, snap, lights) {
  const { x, y } = b;
  turretBase(ctx, x, y);
  // vat dome with a sludge window
  ctx.fillStyle = '#2E3A22';
  ctx.beginPath(); ctx.ellipse(x, y - 6, 8.5, 6.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#4E5A30';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  const slosh = Math.sin(t * 2.1 + x * 0.04) * 0.6;
  ctx.fillStyle = 'rgba(140,200,80,0.55)';
  ctx.beginPath(); ctx.ellipse(x, y - 5 + slosh * 0.4, 4.6, 2.6 + slosh, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(220,255,180,0.5)'; // bubble winking in the window
  if (fract(t * 0.8 + x * 0.02) < 0.4) ctx.fillRect(x - 1 + slosh, y - 6, 1.4, 1.4);
  // hazard ticks on the rim
  ctx.fillStyle = PAL.lythAmber;
  ctx.fillRect(x - 7.5, y - 1.5, 3, 1.6);
  ctx.fillRect(x + 4.5, y - 1.5, 3, 1.6);
  // sprayer tracks the nearest enemy in its 5-tile pool range
  const ta = turretAim(snap, x, y, t, 5);
  ctx.save();
  ctx.translate(x, y - 9);
  ctx.rotate(ta);
  ctx.fillStyle = PAL.graphDark;
  ctx.fillRect(3, -1.7, 9.5, 3.4);
  ctx.fillStyle = '#8CC850'; // dripping tip
  ctx.fillRect(12, -2.3, 2.4, 4.6);
  ctx.restore();
  // slow drip off the nozzle
  const pr = fract(t * 0.9 + x * 0.013);
  ctx.fillStyle = `rgba(150,210,90,${0.8 * (1 - pr)})`;
  ctx.fillRect(x + Math.cos(ta) * 13 - 1, y - 9 + Math.sin(ta) * 13 + pr * 8, 2, 3);
  rimArc(ctx, x, y - 8, 8, 0.45);
  lights.push({ x, y: y - 6, r: 24, rgb: '120,190,70', a: 0.08 });
}

function drawTurret(ctx, b, t, snap, lights) {
  // RA2-style type selection: b.ttype rides the snapshot ('gun' when absent,
  // so pre-combat-depth snapshots keep the classic gun turret).
  const ttype = b.ttype || 'gun';
  if (ttype === 'prism') return drawPrismTower(ctx, b, t, snap, lights);
  if (ttype === 'tesla') return drawTeslaTower(ctx, b, t, lights);
  if (ttype === 'toxin') return drawToxinTurret(ctx, b, t, snap, lights);
  const { x, y } = b;
  const ta = turretAim(snap, x, y, t, 5);
  turretBase(ctx, x, y);
  // rotating head capsule
  ctx.save();
  ctx.translate(x, y - 3);
  ctx.rotate(ta);
  ctx.fillStyle = '#4A5060';
  ctx.fillRect(-6, -4.5, 13, 9);
  ctx.fillStyle = PAL.teal; // ident stripe
  ctx.fillRect(-6, -4.5, 2.5, 9);
  ctx.fillStyle = PAL.graphDark; // barrel
  ctx.fillRect(7, -1.8, 8, 3.6);
  ctx.save();
  ctx.fillStyle = PAL.relay; // single friendly-cyan lens
  ctx.shadowColor = PAL.relay;
  ctx.shadowBlur = 6;
  ctx.beginPath(); ctx.arc(5, 0, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.restore();
  rimArc(ctx, x, y - 4, 7, 0.6);
  lights.push({ x, y: y - 3, r: 26, rgb: '111,216,242', a: 0.07 });
}

// Turret type carousel: shown while a fresh turret waits in typeSelect.
// Mirrors the shop UX — left/right cycles, fire confirms, gun auto-confirms.
const TTYPE_OFFERS = [
  ['gun', 'GUN — LEAD SLINGER'],
  ['prism', 'PRISM — CHAINED BEAM'],
  ['tesla', 'TESLA — CHAIN STUN'],
  ['toxin', 'TOXIN — AREA DENIAL'],
];
function drawTypeSelect(ctx, b, t) {
  const { x, y } = b;
  // the live carousel cursor ships as tsIdx (ttype only exists once confirmed)
  const selIdx = Math.max(0, Math.min(TTYPE_OFFERS.length - 1, b.tsIdx ?? 0));
  // typeSelect may be a boolean or the remaining auto-confirm seconds
  const cd = typeof b.typeSelect === 'number' ? Math.ceil(b.typeSelect)
    : typeof b.typeSelectT === 'number' ? Math.ceil(b.typeSelectT) : null;
  const pw = 196, phh = 16 + TTYPE_OFFERS.length * 14 + 14;
  const px = x - pw / 2, py = y - 34 - phh;
  ctx.save();
  ctx.fillStyle = 'rgba(13,14,24,0.92)';
  ctx.strokeStyle = 'rgba(23,74,74,0.9)';
  ctx.lineWidth = 1.5;
  ctx.fillRect(px, py, pw, phh);
  ctx.strokeRect(px, py, pw, phh);
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = PAL.teal;
  ctx.fillText(cd != null ? `TURRET TYPE — ${cd}s` : 'TURRET TYPE', px + 8, py + 11);
  TTYPE_OFFERS.forEach(([, label], i) => {
    const ry = py + 16 + i * 14;
    if (i === selIdx) {
      ctx.fillStyle = 'rgba(111,216,242,0.14)';
      ctx.fillRect(px + 3, ry - 2, pw - 6, 13);
      ctx.fillStyle = PAL.relay;
      ctx.fillText('▶', px + 6, ry + 8);
    }
    ctx.fillStyle = i === selIdx ? PAL.anchor : 'rgba(191,208,232,0.75)';
    ctx.fillText(label, px + 16, ry + 8);
  });
  ctx.fillStyle = 'rgba(94,107,140,0.9)';
  ctx.fillText('◄ ► CYCLE · FIRE = CONFIRM', px + 8, py + phh - 5);
  // relay marker over the waiting turret
  ctx.fillStyle = `rgba(111,216,242,${0.5 + 0.4 * Math.sin(t * 4)})`;
  ctx.beginPath();
  ctx.moveTo(x, y - 30); ctx.lineTo(x - 4, y - 37); ctx.lineTo(x + 4, y - 37);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawPylon(ctx, b, t, lights) {
  const { x, y } = b;
  shadowBlob(ctx, x, y + 8, 10, 4);
  // tapered graphite mast
  ctx.fillStyle = PAL.graphMid;
  ctx.beginPath();
  ctx.moveTo(x - 7, y + 8); ctx.lineTo(x - 3.5, y - 22); ctx.lineTo(x + 3.5, y - 22); ctx.lineTo(x + 7, y + 8);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = PAL.graphDark;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, y + 7); ctx.lineTo(x, y - 21); ctx.stroke();
  // three insulator rings
  ctx.fillStyle = PAL.steel;
  for (let i = 0; i < 3; i++) ctx.fillRect(x - 6 + i * 0.8, y - i * 8, 12 - i * 1.6, 2);
  // emitter capsule + hot point
  ctx.save();
  ctx.fillStyle = PAL.relay;
  ctx.shadowColor = PAL.relay;
  ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.ellipse(x, y - 26, 4.5, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PAL.anchor;
  ctx.beginPath(); ctx.arc(x, y - 27, 1.8, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // energy filament ticks upward every ~3s
  const fp = (t + x * 0.013) % 3;
  if (fp < 0.3) {
    ctx.save();
    ctx.globalAlpha *= 1 - fp / 0.3;
    ctx.strokeStyle = PAL.anchor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - 33); ctx.lineTo(x, y - 44 - fp * 10);
    ctx.stroke();
    ctx.restore();
  }
  // quorum status lamp — Frontier Teal when counted
  ctx.save();
  ctx.fillStyle = PAL.teal;
  ctx.shadowColor = PAL.teal;
  ctx.shadowBlur = 4;
  ctx.beginPath(); ctx.arc(x + 6, y + 6, 2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  rimArc(ctx, x - 1, y - 8, 8, 0.5);
  lights.push({ x, y: y - 24, r: 42, rgb: '111,216,242', a: 0.1 });
}

function drawBuild(ctx, b, t, snap, lights) {
  const { x, y } = b;
  if (b.built) {
    if (b.kind === 'barricade') drawBarricade(ctx, b, t);
    else if (b.kind === 'wall') drawWallSegment(ctx, b, t, snap);
    else if (b.kind === 'comm') drawCommTower(ctx, b, t, false, lights);
    else if (b.kind === 'turret') drawTurret(ctx, b, t, snap, lights);
    else if (b.kind === 'farm') drawFarm(ctx, b, t, lights);
    else if (b.kind === 'beacon') drawBeacon(ctx, b, t, lights);
    else drawPylon(ctx, b, t, lights);
    if (b.maxHp && b.hp != null && b.hp < b.maxHp) drawHpPips(ctx, x, y - 28, b.hp / b.maxHp);
    if (b.kind !== 'farm' && b.kind !== 'wall') drawLevelPips(ctx, x, y + 14, b.level);
    // fresh turret awaiting its type pick (builder holds act + cycles)
    if (b.kind === 'turret' && b.typeSelect) drawTypeSelect(ctx, b, t);
    // upgrade underway: same relay progress ring as a fresh build
    if (b.progress != null && b.progress > 0 && b.progress < 1) {
      ctx.save();
      ctx.strokeStyle = PAL.relay;
      ctx.shadowColor = PAL.relay;
      ctx.shadowBlur = 6;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, b.progress));
      ctx.stroke();
      ctx.restore();
    }
    return;
  }
  // job site: base plate + hazard chevrons
  ctx.fillStyle = 'rgba(46,49,64,0.85)';
  ctx.beginPath(); ctx.ellipse(x, y + 5, 17, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = PAL.graphDark;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = PAL.lythAmber;
  for (const cxs of [-12, 12]) {
    ctx.beginPath();
    ctx.moveTo(x + cxs - 2.5, y + 11); ctx.lineTo(x + cxs, y + 8); ctx.lineTo(x + cxs + 2.5, y + 11);
    ctx.closePath(); ctx.fill();
  }
  if (b.kind === 'comm') {
    // a comm tower site is no hologram — it is the BROKEN tower itself,
    // leaning and sparking until somebody repairs it
    drawCommTower(ctx, b, t, true, lights);
  } else {
    // ghost hologram of the finished shape, flickering
    let vis = 0.22 + 0.08 * Math.sin(t * 2.1 + x * 0.05);
    if (flick(Math.floor(t * 1.3) + x) < 0.18) vis *= 0.35;
    ctx.save();
    ctx.globalAlpha *= vis;
    ctx.strokeStyle = PAL.pylonBlue;
    ctx.fillStyle = 'rgba(62,143,224,0.18)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    holoShape(ctx, b.kind, x, y);
    ctx.restore();
  }
  // scaffold truss + progress ring once work is underway
  if ((b.progress || 0) > 0) {
    ctx.strokeStyle = '#2A2830';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 11, y + 7); ctx.lineTo(x - 9, y - 9);
    ctx.moveTo(x + 13, y + 7); ctx.lineTo(x + 11, y - 9);
    ctx.stroke();
    ctx.strokeStyle = '#4A4650';
    ctx.beginPath();
    ctx.moveTo(x - 12, y + 6); ctx.lineTo(x - 10, y - 10);
    ctx.moveTo(x + 12, y + 6); ctx.lineTo(x + 10, y - 10);
    ctx.moveTo(x - 11, y - 9); ctx.lineTo(x + 11, y + 5);
    ctx.moveTo(x + 11, y - 9); ctx.lineTo(x - 11, y + 5);
    ctx.stroke();
    ctx.save();
    ctx.strokeStyle = PAL.relay;
    ctx.shadowColor = PAL.relay;
    ctx.shadowBlur = 6;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, b.progress));
    ctx.stroke();
    ctx.restore();
  }
  // kind + cost tag on the site itself
  ctx.save();
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(191,208,232,0.8)';
  ctx.fillText((b.kind || '').toUpperCase(), x, y + 23);
  ctx.fillStyle = PAL.lythGold;
  ctx.fillText(`${b.cost ?? ''}◆`, x, y + 33);
  ctx.restore();
}

// ============================== THE ANCHOR ==============================
// 2-tile graphite monolith; dormant until the relay quorum is met.
function drawAnchor(ctx, cx, baseY, gate, t, lights) {
  const open = !gate || gate.open;
  const need = gate?.need || 0;
  const built = gate?.built || 0;
  const breath = 0.8 + 0.2 * Math.sin(t * (Math.PI * 2 / 1.5));
  const H = 84, Wb = 15, Wt = 11;
  // ground ring of quorum glyphs
  const litFrac = open ? 1 : (need ? built / need : 0);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const gx = cx + Math.cos(a) * 33, gy = baseY + 2 + Math.sin(a) * 13;
    const lit = i < Math.round(litFrac * 10);
    ctx.save();
    if (lit) { ctx.shadowColor = PAL.relay; ctx.shadowBlur = 5; }
    ctx.fillStyle = lit ? PAL.relay : '#3E4A66';
    ctx.translate(gx, gy);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-1.7, -1.7, 3.4, 3.4);
    ctx.restore();
  }
  shadowBlob(ctx, cx + 4, baseY + 3, 20, 7);
  // monolith body, slightly tapered
  ctx.fillStyle = PAL.graphPlate;
  ctx.beginPath();
  ctx.moveTo(cx - Wb, baseY); ctx.lineTo(cx - Wt, baseY - H);
  ctx.lineTo(cx + Wt, baseY - H); ctx.lineTo(cx + Wb, baseY);
  ctx.closePath(); ctx.fill();
  // right facet in shadow
  ctx.fillStyle = PAL.graphDark;
  ctx.beginPath();
  ctx.moveTo(cx + Wb * 0.45, baseY); ctx.lineTo(cx + Wt * 0.5, baseY - H);
  ctx.lineTo(cx + Wt, baseY - H); ctx.lineTo(cx + Wb, baseY);
  ctx.closePath(); ctx.fill();
  // moonsteel bevel on the moonlit left edge
  ctx.strokeStyle = PAL.moonsteel;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx - Wb + 1, baseY); ctx.lineTo(cx - Wt + 1, baseY - H);
  ctx.stroke();
  ctx.strokeStyle = PAL.coldHi;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - Wt + 1, baseY - H + 0.5); ctx.lineTo(cx + Wt, baseY - H + 0.5);
  ctx.stroke();
  // engraved circuit grooves
  const grooves = [-6, 0, 6];
  if (!open) {
    ctx.strokeStyle = '#3E4A66';
    ctx.lineWidth = 1.4;
    for (const g of grooves) {
      ctx.beginPath();
      ctx.moveTo(cx + g, baseY - 5); ctx.lineTo(cx + g * 0.75, baseY - H + 8);
      ctx.stroke();
    }
    // one slow blue pulse — asleep, not dead
    const pp = (t % 2) / 2;
    const py = baseY - 5 - (H - 13) * pp;
    ctx.save();
    ctx.globalAlpha *= 0.35 + 0.35 * Math.sin(pp * Math.PI);
    ctx.strokeStyle = PAL.pylonBlue;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 1, py); ctx.lineTo(cx - 1, py - 7);
    ctx.stroke();
    ctx.restore();
    // hairline Entropy cracks creep up from the base while uncleansed
    ctx.strokeStyle = 'rgba(90,46,140,0.75)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 9, baseY); ctx.lineTo(cx - 6, baseY - 9); ctx.lineTo(cx - 8, baseY - 16);
    ctx.moveTo(cx + 7, baseY); ctx.lineTo(cx + 5, baseY - 11);
    ctx.stroke();
  } else {
    // fully awake: lit grooves + portal seam
    ctx.save();
    ctx.shadowColor = PAL.relay;
    ctx.shadowBlur = 8 * breath;
    ctx.strokeStyle = PAL.anchor;
    ctx.lineWidth = 1.4;
    for (const g of grooves) {
      if (g === 0) continue;
      ctx.beginPath();
      ctx.moveTo(cx + g, baseY - 5); ctx.lineTo(cx + g * 0.75, baseY - H + 8);
      ctx.stroke();
    }
    // vertical seam splits the front face: portal gradient
    const sw = 4.5 + 1.5 * breath;
    const pg = ctx.createLinearGradient(cx - sw, 0, cx + sw, 0);
    pg.addColorStop(0, '#101A2E');
    pg.addColorStop(0.35, PAL.pylonBlue);
    pg.addColorStop(0.5, PAL.anchor);
    pg.addColorStop(0.65, PAL.pylonBlue);
    pg.addColorStop(1, '#101A2E');
    ctx.fillStyle = pg;
    ctx.fillRect(cx - sw, baseY - H + 10, sw * 2, H - 14);
    ctx.restore();
    // rising mote particles
    ctx.fillStyle = PAL.anchor;
    for (let k = 0; k < 2; k++) {
      const pr = fract(t * 0.5 + k * 0.5);
      ctx.save();
      ctx.globalAlpha *= (1 - pr) * 0.9;
      ctx.fillRect(cx - 2 + Math.sin(pr * 9 + k * 3) * 4, baseY - 16 - pr * (H - 4), 2, 2);
      ctx.restore();
    }
    lights.push({ x: cx, y: baseY - H / 2, r: 110, rgb: '111,216,242', a: 0.1 * breath });
    lights.push({ x: cx, y: baseY - 6, r: 60, rgb: '223,243,255', a: 0.08 * breath });
  }
  // label plate
  const label = open ? 'ANCHOR' : `ANCHOR DORMANT — PYLONS ${built}/${need}`;
  ctx.save();
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lw = ctx.measureText(label).width + 16;
  const ly = baseY - H - 16;
  ctx.fillStyle = 'rgba(11,10,20,0.88)';
  ctx.strokeStyle = open ? `rgba(111,216,242,${0.5 + 0.4 * breath})` : 'rgba(90,46,140,0.8)';
  ctx.lineWidth = 1.5;
  if (open) { ctx.shadowColor = PAL.relay; ctx.shadowBlur = 10; }
  ctx.fillRect(cx - lw / 2, ly - 9, lw, 18);
  ctx.strokeRect(cx - lw / 2, ly - 9, lw, 18);
  ctx.shadowBlur = 0;
  ctx.fillStyle = open ? PAL.anchor : '#9a8fc0';
  ctx.fillText(label, cx, ly + 0.5);
  ctx.restore();
}

// --- adaptive prompt glyphs --------------------------------------------------
// Every in-world prompt is written as '[E/X] ...' / '[hold E/X] ...' where E is
// the keyboard ACT key and X is the generic gamepad face button. The displayed
// pair adapts to the ACTIVE controller: a keyboard shows only its key (E), an
// Xbox pad shows X, a PlayStation pad shows the square glyph □, a Switch pad
// shows Y, and anything generic falls back to X. client.js owns controller
// detection + the manual Settings override and pushes the resolved glyphs here
// via setPromptGlyphContext(); the substitution itself lives in one place
// (rewritePromptGlyph, called from drawPrompt) so every prompt stays in sync.

// type -> the gamepad face-button glyph for the game's ACT/interact button.
// (ACT maps to pad button 2: Xbox 'X', PlayStation square, Switch 'Y'.) Pure
// and side-effect-free so it can be unit-exercised from a node stub.
export function glyphForType(type) {
  switch (type) {
    case 'xbox': return 'X';
    case 'ps4':
    case 'ps5': return '□'; // □ — the PlayStation square face button
    case 'switch': return 'Y';
    case 'keyboard': return null; // keyboard-only: no pad glyph in the prompt
    default: return 'X'; // generic / unknown
  }
}

// Active glyph context, set by client.js each time the active device or the
// manual override changes. kb = the keyboard ACT key label ('E' by default,
// remap-aware); pad = the gamepad glyph for the active pad type; isPad marks
// that the ACTIVE controller is a pad (so the prompt shows only the pad glyph,
// per "Xbox selected -> the prompt shows the Xbox button").
let promptKbGlyph = 'E';
let promptPadGlyph = 'X';
let promptIsPad = false;
let promptCtxSet = false; // false until client.js first pushes a context

// type: 'keyboard'|'xbox'|'ps4'|'ps5'|'switch'|'generic'. kbLabel: the live
// keyboard ACT key (defaults to 'E'). Computes both glyphs and stores them.
export function setPromptGlyphContext(type, kbLabel) {
  promptKbGlyph = (kbLabel == null || kbLabel === '') ? 'E' : String(kbLabel);
  promptPadGlyph = glyphForType(type) ?? 'X';
  promptIsPad = type != null && type !== 'keyboard';
  promptCtxSet = true;
}

// Build the '[...]' button tag for the active controller: a single glyph that
// matches the active device — keyboard shows its key (E), an Xbox pad shows X,
// a PlayStation pad □, a Switch pad Y. Before client.js pushes any context
// (boot, no controller detected yet) we keep the classic 'E/X' dual readout so
// nothing regresses.
export function promptButton() {
  if (!promptCtxSet) return `${promptKbGlyph || 'E'}/${promptPadGlyph}`;
  if (promptIsPad) return promptPadGlyph;
  return promptKbGlyph || 'E';
}

// Swap the literal 'E/X' token any prompt string carries for the active pair.
// Matches the exact 'E/X' the prompt sources are authored with so unrelated
// glyphs in a label are never touched.
function rewritePromptGlyph(text) {
  return typeof text === 'string' ? text.replace(/E\/X/g, promptButton()) : text;
}

// World-space interaction prompt ('[E/X] TALK', '[hold E/X] BUILD ...').
function drawPrompt(ctx, x, y, text, t) {
  text = rewritePromptGlyph(text);
  ctx.save();
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 12;
  const py = y + Math.sin(t * 3) * 1.5;
  ctx.fillStyle = 'rgba(11,10,20,0.85)';
  ctx.strokeStyle = 'rgba(111,216,242,0.55)';
  ctx.lineWidth = 1;
  ctx.fillRect(x - w / 2, py - 8, w, 16);
  ctx.strokeRect(x - w / 2, py - 8, w, 16);
  ctx.fillStyle = PAL.anchor;
  ctx.fillText(text, x, py + 0.5);
  ctx.restore();
}

// --- camera (the couch camera, evolved: one camera object per viewport) ---
// `cam` stays the shared/primary camera: the classic single fullscreen view
// renders through it, and the minimap + full-map camera rects read it. Split
// viewports each own a camera in `viewCams`, keyed by the view id, with the
// exact same follow/zoom/smoothing rules — just sized to their cell.
const cam = { x: 0, y: 0, z: 1, key: null, vw: 1280, vh: 720 };
const viewCams = new Map(); // view id ('p<pid>') -> camera object
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.15;
// Settings > Game zoom (100/115/130/150%): one factor scaling every camera's
// zoom bounds — ZOOM_MIN/ZOOM_MAX and the whole-map-fit threshold — so the
// world renders larger for readability. computeCamera serves the shared
// camera AND every split-view camera, so all of them inherit it; a level that
// no longer "fits whole" at the scaled threshold falls into the follow
// branch, whose map clamps (and the never-wider-than-the-map zoom floor)
// keep zoomed views inside the map exactly as before.
let viewZoom = 1;
export function setViewZoom(factor) {
  const f = +factor;
  viewZoom = Number.isFinite(f) ? Math.min(2, Math.max(1, f)) : 1;
}

function computeCamera(camera, snap, focus, dt) {
  const VW = camera.vw, VH = camera.vh;
  const W = snap.w * TILE, H = snap.h * TILE;
  const fitZ = Math.min(VW / W, VH / H);
  let tx, ty, tz;
  if (fitZ >= 0.8 * viewZoom) {
    // Classic single-screen levels: frame the whole map, centered.
    tx = W / 2; ty = H / 2; tz = Math.min(fitZ, ZOOM_MAX * viewZoom);
  } else {
    let pts = snap.players.filter(p => p.state === 'active' && focus.has(p.pid));
    if (!pts.length) pts = snap.players.filter(p => p.state === 'active');
    if (!pts.length) pts = [{ x: camera.x, y: camera.y }];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    // the 4.5-tile breathing room stays constant in SCREEN pixels as the Game
    // zoom rises (i.e. shrinks in world px), so 150% really renders ~1.5x
    // larger instead of being capped by the solo padding fit; the focus
    // group itself is always framed (spread dominates bw/bh when it matters)
    const pad = TILE * 4.5 / viewZoom;
    const bw = maxX - minX + pad * 2, bh = maxY - minY + pad * 2;
    tz = Math.max(ZOOM_MIN * viewZoom, Math.min(ZOOM_MAX * viewZoom, VW / bw, VH / bh));
    tz = Math.max(tz, fitZ); // never zoom wider than the whole map
    const hw = VW / 2 / tz, hh = VH / 2 / tz;
    tx = (minX + maxX) / 2;
    ty = (minY + maxY) / 2;
    tx = W <= hw * 2 ? W / 2 : Math.max(hw, Math.min(W - hw, tx));
    ty = H <= hh * 2 ? H / 2 : Math.max(hh, Math.min(H - hh, ty));
  }
  const key = snap.grid || snap.name;
  if (camera.key !== key) {
    camera.key = key;
    camera.x = tx; camera.y = ty; camera.z = tz;
  } else {
    const k = 1 - Math.exp(-dt * 6);
    const kz = 1 - Math.exp(-dt * 3.5);
    camera.x += (tx - camera.x) * k;
    camera.y += (ty - camera.y) * k;
    camera.z += (tz - camera.z) * kz;
  }
}

// A fresh viewport camera opens exactly where the shared camera was looking,
// then glides to its own target — so the split transition reads as one motion.
function viewCamFor(id, rect) {
  let c = viewCams.get(id);
  if (!c) {
    c = { x: cam.x, y: cam.y, z: cam.z, key: cam.key, vw: rect.w, vh: rect.h };
    viewCams.set(id, c);
  }
  c.vw = Math.max(1, rect.w);
  c.vh = Math.max(1, rect.h);
  return c;
}

function camInView(camera, x, y, m = 70) {
  return Math.abs(x - camera.x) < camera.vw / 2 / camera.z + m
    && Math.abs(y - camera.y) < camera.vh / 2 / camera.z + m;
}

function camToScreen(camera, x, y) {
  return [(x - camera.x) * camera.z + camera.vw / 2, (y - camera.y) * camera.z + camera.vh / 2];
}

// Exit tiles never move; scan the grid once per level.
let exitCache = { key: null, cols: [] };
function exitTiles(snap) {
  const key = snap.grid || snap.name;
  if (exitCache.key === key) return exitCache.cols;
  const cols = [];
  for (let y = 0; y < snap.h; y++)
    for (let x = 0; x < snap.w; x++)
      if (snap.grid[y][x] === 'E') cols.push({ x, y });
  exitCache = { key, cols };
  return cols;
}

function drawEdgeArrowFor(ctx, camera, wx, wy, color, label) {
  const VW = camera.vw, VH = camera.vh, M = 30;
  let [sx, sy] = camToScreen(camera, wx, wy);
  const cx = VW / 2, cy = VH / 2;
  const dx = sx - cx, dy = sy - cy;
  // scale the offscreen point back onto the screen edge rectangle
  const fx = dx ? (dx > 0 ? (VW - M - cx) / dx : (M - cx) / dx) : Infinity;
  const fy = dy ? (dy > 0 ? (VH - M - cy) / dy : (M - cy) / dy) : Infinity;
  const f = Math.min(fx, fy);
  sx = cx + dx * f; sy = cy + dy * f;
  const a = Math.atan2(dy, dx);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(a);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(10, 0); ctx.lineTo(-6, -7); ctx.lineTo(-6, 7);
  ctx.closePath();
  ctx.fill();
  ctx.rotate(-a);
  if (label) {
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 3;
    ctx.fillText(label, 0, dy > 0 ? -14 : 22);
  }
  ctx.restore();
}

// ============================== FOG OF WAR ==============================
// Exploration is pure client math from player positions in every snapshot —
// identical on every machine, no sim involvement. ~10-tile reveal radius,
// accumulated per mission, reset whenever the level (grid) changes. Maps
// small enough to frame whole-screen are considered fully scouted.
const explore = { key: null, w: 0, h: 0, mask: null, count: 0, fogCanvas: null, fogCount: -1 };

// Mode gate, set by the client each frame (story/stronghold/expedition fog
// it; versus + classic arcade don't). Disabled: the minimap skips the fog
// layer, seenAt says everything is scouted and drawFullMap's internal mask
// path shows the whole field. The ledger itself keeps accumulating, so
// re-enabling fog mid-mission picks up where exploration left off.
let fogEnabled = true;
export function setFogEnabled(on) { fogEnabled = !!on; }

function updateExplore(snap) {
  const key = snap.grid || snap.name;
  if (explore.key !== key) {
    explore.key = key;
    explore.w = snap.w; explore.h = snap.h;
    explore.mask = new Uint8Array(snap.w * snap.h);
    explore.count = 0;
    explore.fogCount = -1;
  }
  const total = explore.w * explore.h;
  if (explore.count >= total) return;
  // single-screen maps: everything is on camera, so everything is known
  const fitZ = Math.min(cam.vw / (snap.w * TILE), cam.vh / (snap.h * TILE));
  if (fitZ >= 0.8) {
    explore.mask.fill(1);
    explore.count = total;
    return;
  }
  const R = 10;
  for (const p of snap.players ?? []) {
    if (p.state === 'out' || p.x == null) continue; // any live presence scouts
    const cx2 = Math.floor(p.x / TILE), cy2 = Math.floor(p.y / TILE);
    for (let dy = -R; dy <= R; dy++) {
      const yy = cy2 + dy;
      if (yy < 0 || yy >= explore.h) continue;
      const span = Math.floor(Math.sqrt(R * R - dy * dy));
      const row = yy * explore.w;
      for (let dx = -span; dx <= span; dx++) {
        const xx = cx2 + dx;
        if (xx < 0 || xx >= explore.w) continue;
        if (!explore.mask[row + xx]) { explore.mask[row + xx] = 1; explore.count++; }
      }
    }
  }
}

// The client may grab the live mask (e.g. to pass into drawFullMap).
export function exploreMask(snap) {
  if (snap?.grid) updateExplore(snap);
  return explore.mask;
}

// has a world-space point been scouted? (no mask / fog disabled: show all)
function seenAt(wx, wy) {
  if (!fogEnabled) return true;
  const m = explore.mask;
  if (!m) return true;
  const x = Math.max(0, Math.min(explore.w - 1, Math.floor(wx / TILE)));
  const y = Math.max(0, Math.min(explore.h - 1, Math.floor(wy / TILE)));
  return m[y * explore.w + x] === 1;
}

// 1px-per-tile fog overlay, rebuilt only when new ground is revealed; the
// scaled draw (smoothing on) gives the soft frontier edge for free.
function fogLayer() {
  if (!explore.mask) return null;
  if (explore.count >= explore.w * explore.h) return null; // fully scouted
  if (explore.fogCanvas && explore.fogCount === explore.count
    && explore.fogCanvas.width === explore.w) return explore.fogCanvas;
  let c = explore.fogCanvas;
  if (!c || c.width !== explore.w || c.height !== explore.h) {
    c = document.createElement('canvas');
    c.width = explore.w; c.height = explore.h;
    explore.fogCanvas = c;
  }
  const fctx = c.getContext('2d');
  const img = fctx.createImageData(explore.w, explore.h);
  const data = img.data;
  for (let i = 0; i < explore.mask.length; i++) {
    if (explore.mask[i]) continue;
    const o = i * 4;
    data[o] = 4; data[o + 1] = 4; data[o + 2] = 9; data[o + 3] = 243;
  }
  fctx.putImageData(img, 0, 0);
  explore.fogCount = explore.count;
  return c;
}

// ============================== WEATHER FX ==============================
// Screen-space weather layers driven by snap.weather ('rain'|'snow'|
// 'ashstorm'|'fog'). Pure functions of t — deterministic drift, no state.
function drawWeather(ctx, VW, VH, weather, t) {
  if (!weather || weather === 'clear') return;
  ctx.save();
  if (weather === 'thunderstorm') {
    // RELIC AWAKENING storm: a heavier, faster, more crimson-lit downpour with
    // a deep storm tint. The thunder flashes themselves draw in the global pass.
    ctx.fillStyle = 'rgba(20,12,30,0.18)';
    ctx.fillRect(0, 0, VW, VH);
    for (const [n, sp, ln, al, seed] of [[80, 1250, 16, 0.34, 23], [50, 1700, 24, 0.5, 91]]) {
      ctx.strokeStyle = `rgba(170,150,200,${al})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const rx = flick(i * 7.3 + seed), ry = flick(i * 13.7 + seed * 3);
        const px2 = ((rx * VW + t * sp * 0.18) % (VW + 40)) - 20;
        const py2 = ((ry * VH + t * sp) % (VH + 60)) - 30;
        ctx.moveTo(px2, py2);
        ctx.lineTo(px2 - ln * 0.22, py2 + ln);
      }
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  if (weather === 'rain') {
    // two parallax layers of slanted streaks + a cold sheen on the world
    ctx.fillStyle = 'rgba(60,80,110,0.05)';
    ctx.fillRect(0, 0, VW, VH);
    for (const [n, sp, ln, al, seed] of [[54, 950, 13, 0.30, 11], [34, 1350, 19, 0.42, 77]]) {
      ctx.strokeStyle = `rgba(150,180,215,${al})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const rx = flick(i * 7.3 + seed), ry = flick(i * 13.7 + seed * 3);
        const px2 = ((rx * VW + t * sp * 0.22) % (VW + 40)) - 20;
        const py2 = ((ry * VH + t * sp) % (VH + 60)) - 30;
        ctx.moveTo(px2, py2);
        ctx.lineTo(px2 - ln * 0.28, py2 + ln);
      }
      ctx.stroke();
    }
    // puddle shimmer: brief twinkles low in the frame
    for (let i = 0; i < 7; i++) {
      const ph = fract(t * 1.7 + i * 0.143);
      if (ph > 0.2) continue;
      const cyc2 = Math.floor(t * 1.7 + i * 0.143);
      const rx = flick(i * 31.7 + cyc2);
      const ry = flick(i * 17.3 + cyc2 * 3);
      ctx.fillStyle = `rgba(190,215,240,${(1 - ph / 0.2) * 0.5})`;
      ctx.fillRect(rx * VW, VH * (0.62 + ry * 0.36), 3 + ph * 9, 1.2);
    }
  } else if (weather === 'snow') {
    // drifting flakes, two depths, with sinuous sway + a pale world tint
    ctx.fillStyle = 'rgba(200,220,240,0.05)';
    ctx.fillRect(0, 0, VW, VH);
    for (const [n, fall, r, al, seed] of [[44, 34, 1.4, 0.5, 5], [26, 62, 2.2, 0.75, 51]]) {
      ctx.fillStyle = `rgba(228,238,250,${al})`;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const rx = flick(i * 7.9 + seed), ry = flick(i * 12.3 + seed * 2);
        const py2 = ((ry * VH + t * fall) % (VH + 20)) - 10;
        const px2 = ((rx * VW + Math.sin(t * 0.8 + i) * 22 + t * 9) % (VW + 20)) - 10;
        ctx.moveTo(px2 + r, py2);
        ctx.arc(px2, py2, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    // accumulation: a faint frost line creeping up the bottom of the frame
    const fg2 = ctx.createLinearGradient(0, VH - 60, 0, VH);
    fg2.addColorStop(0, 'rgba(225,238,250,0)');
    fg2.addColorStop(1, 'rgba(225,238,250,0.10)');
    ctx.fillStyle = fg2;
    ctx.fillRect(0, VH - 60, VW, 60);
  } else if (weather === 'ashstorm') {
    // hot grey wind: swirling ash flakes + rising ember motes + dust veil
    ctx.fillStyle = 'rgba(60,48,44,0.10)';
    ctx.fillRect(0, 0, VW, VH);
    ctx.fillStyle = 'rgba(150,140,135,0.45)';
    for (let i = 0; i < 56; i++) {
      const rx = flick(i * 9.1 + 3), ry = flick(i * 15.7 + 9);
      const px2 = ((rx * VW - t * (160 + ry * 130)) % (VW + 30) + VW + 30) % (VW + 30) - 15;
      const py2 = ((ry * VH + Math.sin(t * 1.3 + i * 1.7) * 30 + t * 26) % (VH + 20)) - 10;
      ctx.fillRect(px2, py2, 2 + ry * 1.6, 1.4);
    }
    for (let i = 0; i < 9; i++) {
      const ph = fract(t * 0.4 + i * 0.111);
      const rx = flick(i * 23.3 + Math.floor(t * 0.4 + i * 0.111));
      ctx.fillStyle = `rgba(240,140,60,${Math.sin(ph * Math.PI) * 0.7})`;
      ctx.fillRect(rx * VW + Math.sin(t * 2 + i * 2.3) * 14, VH * (1 - ph), 1.8, 1.8);
    }
  } else if (weather === 'fog') {
    // rolling banks: big soft blobs sliding across + an even haze
    ctx.fillStyle = 'rgba(94,107,140,0.13)';
    ctx.fillRect(0, 0, VW, VH);
    for (let i = 0; i < 5; i++) {
      const ry = flick(i * 13.1 + 4);
      const px2 = ((flick(i * 7.7) * VW + t * (14 + i * 7)) % (VW + 600)) - 300;
      const py2 = ry * VH;
      const rr = VW * (0.16 + ry * 0.14);
      const bg2 = ctx.createRadialGradient(px2, py2, rr * 0.2, px2, py2, rr);
      bg2.addColorStop(0, 'rgba(150,164,196,0.13)');
      bg2.addColorStop(1, 'rgba(150,164,196,0)');
      ctx.fillStyle = bg2;
      ctx.fillRect(px2 - rr, py2 - rr, rr * 2, rr * 2);
    }
  }
  ctx.restore();
}

// Themed full-screen ambient particles driven by snap.theme (THEME_PAL.ambient).
// Cheap, deterministic (pure functions of t — same flick/fract drift as the
// weather layers), and a no-op for unthemed levels (the caller only invokes it
// with a theme palette). Snow/rain themes just lean on drawWeather, so this
// only paints the non-weather kinds: rising embers, drifting fallout, toxic fog.
function drawHazardAmbient(ctx, snap, t, VW, VH, tpal) {
  if (!tpal || !tpal.ambient) return;
  const kind = tpal.ambient;
  // snow/rain are handled by the weather layer the theme already implies
  if (kind === 'snow' || kind === 'rain') return;
  ctx.save();
  if (kind === 'ember') {
    // rising embers: warm motes that float up the frame and twinkle out, two
    // depths, with a faint heat-shimmer veil low in the world (lava/fire)
    ctx.globalCompositeOperation = 'lighter';
    for (const [n, rise, sz, seed] of [[40, 46, 1.4, 7], [22, 78, 2.2, 53]]) {
      for (let i = 0; i < n; i++) {
        const rx = flick(i * 8.3 + seed), ry = flick(i * 14.9 + seed * 2);
        const py2 = ((ry * VH - t * rise) % (VH + 24) + VH + 24) % (VH + 24) - 12;
        const px2 = ((rx * VW + Math.sin(t * 1.1 + i * 1.7) * 16) % (VW + 20)) - 10;
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 2.3 + i));
        ctx.fillStyle = `rgba(255,${120 + Math.floor(ry * 90)},40,${0.55 * tw})`;
        ctx.fillRect(px2, py2, sz, sz);
      }
    }
  } else if (kind === 'fallout') {
    // drifting fallout flecks slanting down + a faint geiger speckle that
    // flashes random-looking specks on a deterministic clock (nuclear)
    ctx.fillStyle = 'rgba(180,210,70,0.40)';
    for (let i = 0; i < 46; i++) {
      const rx = flick(i * 9.7 + 2), ry = flick(i * 15.3 + 8);
      const py2 = ((ry * VH + t * (24 + ry * 30)) % (VH + 20)) - 10;
      const px2 = ((rx * VW + Math.sin(t * 0.6 + i) * 18 + t * 12) % (VW + 20)) - 10;
      ctx.fillRect(px2, py2, 1.6, 1.6);
    }
    // geiger speckle: brief bright pinpricks gated by a stepping cycle index
    for (let i = 0; i < 10; i++) {
      const ph = fract(t * 3 + i * 0.137);
      if (ph > 0.25) continue;
      const cyc = Math.floor(t * 3 + i * 0.137);
      const rx = flick(i * 27.1 + cyc), ry = flick(i * 19.7 + cyc * 3);
      ctx.fillStyle = `rgba(220,255,120,${(1 - ph / 0.25) * 0.6})`;
      ctx.fillRect(rx * VW, ry * VH, 2, 2);
    }
  } else if (kind === 'fog') {
    // green toxic fog drift: soft sickly blobs sliding across + an even haze
    ctx.fillStyle = 'rgba(70,150,60,0.12)';
    ctx.fillRect(0, 0, VW, VH);
    for (let i = 0; i < 5; i++) {
      const ry = flick(i * 11.9 + 5);
      const px2 = ((flick(i * 6.7) * VW + t * (10 + i * 6)) % (VW + 600)) - 300;
      const py2 = ry * VH;
      const rr = VW * (0.16 + ry * 0.16);
      const bg2 = ctx.createRadialGradient(px2, py2, rr * 0.2, px2, py2, rr);
      bg2.addColorStop(0, 'rgba(120,200,90,0.14)');
      bg2.addColorStop(1, 'rgba(120,200,90,0)');
      ctx.fillStyle = bg2;
      ctx.fillRect(px2 - rr, py2 - rr, rr * 2, rr * 2);
    }
  }
  ctx.restore();
}

// ============================== ALARM HUD ==============================
// Big blinking countdown banner: dusk/nightwave inbound (<15s on the day
// clock), BR zone about to shrink, CTF sudden death. Center-top, unmissable.
function drawCountdownBanner(ctx, VW, snap, t) {
  let secs = null, label = '', col = PAL.glitch;
  const cyc = snap.cycle;
  if (cyc && cyc.phase === 'day' && cyc.t != null && cyc.t <= 15 && cyc.t > 0) {
    secs = cyc.t;
    label = 'NIGHTWAVE IN';
    col = PAL.glitch;
  } else if (snap.zone && snap.zone.shrinkT != null && snap.zone.shrinkT > 0 && snap.zone.shrinkT <= 15
    && (snap.zone.targetR == null || snap.zone.targetR < snap.zone.r - 1)) {
    secs = snap.zone.shrinkT;
    label = 'ZONE SHRINKS IN';
    col = PAL.relay;
  } else if ((snap.flags?.length ?? 0) > 0 && snap.timeLeft != null && snap.timeLeft > 0 && snap.timeLeft <= 15) {
    secs = snap.timeLeft;
    label = 'SUDDEN DEATH IN';
    col = '#FF6A5A';
  }
  if (secs == null) return;
  const n = Math.max(1, Math.ceil(secs));
  const blink = 0.55 + 0.45 * Math.sin(t * (secs < 5 ? 11 : 6));
  ctx.save();
  ctx.globalAlpha = blink;
  ctx.font = 'bold 34px monospace';
  ctx.textAlign = 'center';
  ctx.shadowColor = col;
  ctx.shadowBlur = 16;
  ctx.fillStyle = col;
  ctx.fillText(`${label} ${n}`, VW / 2, 116);
  ctx.restore();
}

// RELIC AWAKENING HUD: a compact center-top readout of the survival timer and
// the live bonus (which bleeds with hits + deaths). Pulses red near the end.
function drawRelicHud(ctx, VW, horde, t) {
  const rem = Math.max(0, horde.remaining ?? 0);
  const mm = Math.floor(rem / 60), ss = Math.floor(rem % 60);
  const timer = `${mm}:${String(ss).padStart(2, '0')}`;
  const near = rem <= 12;
  const pulse = near ? 0.6 + 0.4 * Math.sin(t * 9) : 1;
  ctx.save();
  ctx.textAlign = 'center';
  // panel
  const w = 230, h = 46, x = VW / 2 - w / 2, y = 150;
  ctx.fillStyle = 'rgba(13,8,18,0.82)';
  ctx.strokeStyle = `rgba(255,90,102,${0.5 * pulse})`;
  ctx.lineWidth = 1.5;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  // title
  ctx.font = 'bold 11px monospace';
  ctx.fillStyle = '#FF8A94';
  ctx.fillText('SURVIVE THE RELIC', VW / 2, y + 15);
  // timer + bonus row
  ctx.font = 'bold 20px monospace';
  ctx.shadowColor = near ? '#FF5A66' : '#d6a8ff';
  ctx.shadowBlur = 10;
  ctx.globalAlpha = pulse;
  ctx.fillStyle = near ? '#FF5A66' : PAL.anchor;
  ctx.textAlign = 'left';
  ctx.fillText(timer, x + 14, y + 37);
  ctx.textAlign = 'right';
  ctx.fillStyle = PAL.lythGold;
  ctx.fillText(`+${horde.bonus ?? 0}`, x + w - 14, y + 37);
  ctx.restore();
}

// Beacon pips: stronghold beacon-defense HUD — one monolith pip per beacon,
// gold while lit, cracked violet-grey while dark. Lose only if ALL go dark.
function drawBeaconPips(ctx, VW, cores, t) {
  const n = cores.length;
  const w = 22, x0 = VW / 2 - (n * w) / 2 + w / 2;
  ctx.save();
  for (let i = 0; i < n; i++) {
    const c = cores[i];
    const lit = (c.hp ?? 0) > 0;
    const x = x0 + i * w, y = 26;
    ctx.fillStyle = lit ? PAL.lythAmber : '#3A3344';
    if (lit) { ctx.shadowColor = PAL.lythAmber; ctx.shadowBlur = 6 + 2 * Math.sin(t * 3 + i); }
    ctx.beginPath();
    ctx.moveTo(x - 4.5, y + 7); ctx.lineTo(x - 3, y - 7); ctx.lineTo(x + 3, y - 7); ctx.lineTo(x + 4.5, y + 7);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    if (!lit) { // dark beacon: a violet fault line through the pip
      ctx.strokeStyle = 'rgba(142,79,209,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 2, y - 5); ctx.lineTo(x + 1, y); ctx.lineTo(x - 1, y + 6);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ============================== MAIN RENDER ==============================
// render(): the classic single-view entry point — a thin wrapper over
// renderViews with one full-canvas view through the shared camera. Byte-for-
// byte today's output: same camera object, same op order, no clip/chip pass.
export function render(ctx, snap, charMap, focusPids, t, dt) {
  renderViews(ctx, snap, charMap, [{
    id: 'shared', kind: 'player', pid: null, focus: focusPids,
    rect: { x: 0, y: 0, w: ctx.canvas.width, h: ctx.canvas.height },
  }], t, dt);
}

function toPidSet(f) {
  return f instanceof Set ? f : new Set(Array.isArray(f) ? f : f != null ? [f] : []);
}

// renderViews(): dynamic splitscreen. views = [{ id, kind: 'player'|'map',
// pid, rect{x,y,w,h}, seat, name, color, mask, focus }] (see client.js).
// Each 'player' view renders the full world + screen-space pass into its
// rect through its own camera; a 'map' view reuses drawFullMap (fog-aware)
// inside its cell. Global alerts (banners, wave countdown, beacon pips) and
// the seam dividers draw once, full-canvas, after the cells.
export function renderViews(ctx, snap, charMap, views, t, dt) {
  setScene(snap); // ambience beds/music/weather follow the live snapshot
  // a lite snapshot can arrive before levelStart re-attaches the cached grid
  if (!snap.grid || !Array.isArray(views) || !views.length) return;
  const CW = ctx.canvas.width, CH = ctx.canvas.height;
  advanceFrameFx(snap, dt); // FX/anim ledgers tick ONCE per frame, not per view
  cam.vw = CW; cam.vh = CH; // the shared camera always spans the full canvas
  // union of local seats: focus rings + prompts read the same in every cell
  const union = new Set();
  for (const v of views) {
    if (v.pid != null) union.add(v.pid);
    if (v.focus != null) for (const pid of toPidSet(v.focus)) union.add(pid);
  }
  const r0 = views[0].rect;
  const single = views.length === 1 && views[0].kind !== 'map'
    && r0 && r0.x === 0 && r0.y === 0 && r0.w === CW && r0.h === CH;
  // split: keep the shared camera warm (minimap rect + a seamless merge back)
  if (!single) {
    computeCamera(cam, snap, union, dt);
    // mid-transition the 3P/4P cells grow in from corner anchors, so the view
    // rects need not tile the canvas — flood the frame first so any gap reads
    // as intentional letterboxing instead of stale previous-frame pixels.
    ctx.fillStyle = PAL.voidNight;
    ctx.fillRect(0, 0, CW, CH);
  }
  updateExplore(snap); // fog-of-war ledger: shared by minimap + full map
  if (viewCams.size) { // prune cameras of views that vanished (re-split re-seeds)
    const live = new Set(views.map(v => String(v.id ?? (v.pid != null ? 'p' + v.pid : 'shared'))));
    for (const k of viewCams.keys()) if (!live.has(k)) viewCams.delete(k);
  }
  let first = true;
  for (const view of views) {
    const rect = view.rect;
    if (!rect || rect.w < 1 || rect.h < 1) continue; // transition slivers
    // merging cells under 200px: skip the world/map pass entirely (perf
    // budget) — they only exist for a beat mid-transition before the layout
    // settles. Sits ABOVE the map branch so a map-cell sliver skips too.
    if (!single && (rect.w < 200 || rect.h < 200)) {
      ctx.save();
      ctx.fillStyle = PAL.voidNight;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
      continue;
    }
    if (view.kind === 'map') {
      drawMapCell(ctx, snap, view, rect);
      continue;
    }
    const id = String(view.id ?? (view.pid != null ? 'p' + view.pid : 'shared'));
    const focus = single ? toPidSet(view.focus ?? view.pid) : union;
    renderWorldView(ctx, snap, charMap, t, dt, {
      view, rect,
      camera: single ? cam : viewCamFor(id, rect),
      // each cell's camera follows its own seat (solo zoom rules); shared
      // and merged views frame the whole focus group exactly as today
      camFocus: view.pid != null && !single ? new Set([view.pid]) : focus,
      focus,
      stateDt: first ? dt : 0, // dt-stateful draws (doors) advance once/frame
      clipped: !single,
      globalUi: single, // split: banners/countdown/pips move to the global pass
      ns: single ? '' : id + '|',
    });
    first = false;
  }
  if (!single) {
    drawGlobalScreenFx(ctx, snap, t, CW, CH);
    drawDividers(ctx, views, CW, CH);
  }
}

// FX particles, flashes, popups, rings, door/level ledgers: shared world
// state, decayed once per frame and then drawn per viewport with that
// viewport's culling. (Hoisted out of the old render() body verbatim.)
function advanceFrameFx(snap, dt) {
  shake = Math.max(0, shake - dt * 18);
  punch = Math.max(0, punch - dt * 1.1); // settle the zoom-kick back over ~0.4s
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.92; p.vy *= 0.92;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
  for (let i = flashes.length - 1; i >= 0; i--) {
    flashes[i].life -= dt;
    if (flashes[i].life <= 0) flashes.splice(i, 1);
  }
  for (let i = popups.length - 1; i >= 0; i--) {
    popups[i].y -= popups[i].screen ? 0 : 24 * dt;
    popups[i].life -= dt;
    if (popups[i].life <= 0) popups.splice(i, 1);
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    rings[i].life -= dt;
    if (rings[i].life <= 0) rings.splice(i, 1);
  }
  for (let i = edgePulses.length - 1; i >= 0; i--) {
    edgePulses[i].life -= dt;
    if (edgePulses[i].life <= 0) edgePulses.splice(i, 1);
  }
  coreAlarmT = Math.max(0, coreAlarmT - dt);
  lightningT = Math.max(0, lightningT - dt * 3.2); // quick white flash decay
  for (let i = crackers.length - 1; i >= 0; i--) {
    crackers[i].life -= dt;
    if (crackers[i].life <= 0) crackers.splice(i, 1); // boom event missed: time out
  }
  for (let i = beams.length - 1; i >= 0; i--) {
    beams[i].life -= dt;
    if (beams[i].life <= 0) beams.splice(i, 1);
  }
  for (let i = zaps.length - 1; i >= 0; i--) {
    zaps[i].life -= dt;
    if (zaps[i].life <= 0) zaps.splice(i, 1);
  }
  for (let i = streaks.length - 1; i >= 0; i--) {
    streaks[i].life -= dt;
    if (streaks[i].life <= 0) streaks.splice(i, 1);
  }
  if (doorAnim.size > 300) doorAnim.clear(); // long campaigns: ids keep growing
  // coordless levelUp events: anchor the flare to the player this frame
  while (pendingLevelUps.length) {
    const lu = pendingLevelUps.pop();
    const p = snap.players.find(pl => pl.pid === lu.pid && pl.state === 'active');
    if (p) levelUpFX(p.x, p.y, lu.level);
  }
}

// One world + screen-space pass into a viewport rect through its camera.
function renderWorldView(ctx, snap, charMap, t, dt, opts) {
  const { view, rect, camera, clipped, globalUi, stateDt } = opts;
  const focus = opts.focus;
  if (clipped) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    ctx.translate(rect.x, rect.y);
  }
  poseNs = opts.ns || '';
  // camera-space helpers, bound to THIS viewport's camera
  const inView = (x, y, m = 70) => camInView(camera, x, y, m);
  const drawEdgeArrow = (ectx, wx, wy, color, label) => drawEdgeArrowFor(ectx, camera, wx, wy, color, label);
  // new snapshot fields are optional: classic levels must keep rendering
  const builds = snap.builds ?? [];
  const crystals = snap.crystals ?? [];
  const drops = snap.drops ?? [];
  const npcs = snap.npcs ?? [];
  const gate = snap.gate ?? null;
  const chests = snap.chests ?? [];
  const vehicles = snap.vehicles ?? [];
  const towers = snap.towers ?? [];
  const shops = snap.shops ?? [];
  const hires = snap.hires ?? [];
  const flags = snap.flags ?? [];
  const core = snap.core ?? null;
  const cycle = snap.cycle ?? null;
  const zone = snap.zone ?? null;
  const patches = snap.patches ?? []; // burn/toxin ground pools
  const followers = snap.followers ?? []; // combat hires (hound/archer/caster)
  // --- frontier III (all optional) ---
  const pickups = snap.pickups ?? []; // field weapons on the ground
  const qitems = snap.qitems ?? []; // quest items / proof fragments
  const switches = snap.switches ?? []; // relay switch consoles
  const glyphs = snap.glyphs ?? []; // rune stones
  const pillars = snap.pillars ?? []; // BLS colonnade pillars
  const forges = snap.forges ?? []; // seal forges
  const doors = snap.doors ?? []; // sliding bulkheads
  const teleports = snap.teleports ?? []; // settled corridor pads
  const quests = snap.quests ?? null; // for npc quest markers
  // lythseal bearers light up Classical Phantoms within 6 tiles (drawEnemy);
  // the seal rides its own snapshot field now (hasSeal/lythseal), never the
  // item slot — every alias is honored for older snapshots
  sealCarriers = (snap.players ?? []).filter(p => p.state === 'active' && (p.hasSeal || p.lythseal || p.seal));
  const lights = []; // per-frame light pools (campfires, LYTH, pylons...)
  // night grade: story dark missions are full night; bastion maps breathe
  // through a smooth dusk/dawn tint driven by the cycle clock (last 6s).
  familyMode = snap.family === true; // bright child-friendly storybook grade
  // Map theme palette (lava/toxic/nuclear/storm/fire/ice). Null on unthemed
  // levels and suppressed in family mode (the storybook day always wins), so
  // those frames render exactly as before.
  const tpal = familyMode ? null : themePal(snap);
  let nightK = snap.dark ? 1 : 0;
  if (cycle) {
    if (cycle.phase === 'night') nightK = Math.max(nightK, Math.min(1, (cycle.t ?? 0) / 6));
    else nightK = Math.max(nightK, 1 - Math.min(1, (cycle.t ?? 1e9) / 6));
  }
  let bloodK = cycle?.bloodMoon && cycle.phase === 'night' ? nightK : 0;
  // Family mode forces a sunny day regardless of the cycle: no night, no
  // blood moon, no dark grade — every gate below reads day.
  if (familyMode) { nightK = 0; bloodK = 0; }
  darkWorld = nightK > 0.55; // full night = the existing dark treatment

  // viewport camera: sized to this cell, following this cell's seats
  // (FX decay + the explore ledger already ticked once in renderViews)
  camera.vw = rect.w;
  camera.vh = rect.h;
  const VW = camera.vw, VH = camera.vh;
  computeCamera(camera, snap, opts.camFocus, dt);
  const z = camera.z;

  // Family mode trades the near-black void backdrop for a soft daylight sky;
  // a map theme swaps in its own sky tint. Plain levels keep the void night.
  ctx.fillStyle = familyMode ? FAM.sky : (tpal ? tpal.skyFill : PAL.voidNight);
  ctx.fillRect(0, 0, VW, VH);
  ctx.save();
  ctx.translate(VW / 2, VH / 2);
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  // zoom-kick: heavy hits punch the camera in a hair, then it eases back out.
  const pz = z * (1 + Math.min(0.05, punch * 0.05));
  ctx.scale(pz, pz);
  ctx.translate(-camera.x, -camera.y);

  // visible tile range (per-viewport camera culling)
  const tx0 = Math.max(0, Math.floor((camera.x - VW / 2 / z) / TILE) - 1);
  const tx1 = Math.min(snap.w - 1, Math.ceil((camera.x + VW / 2 / z) / TILE) + 1);
  const ty0 = Math.max(0, Math.floor((camera.y - VH / 2 / z) / TILE) - 1);
  const ty1 = Math.min(snap.h - 1, Math.ceil((camera.y + VH / 2 / z) / TILE) + 1);

  // --- terrain (one distinct baked look per floor letter) ---
  const gateOpen = !gate || gate.open;
  for (let y = ty0; y <= ty1; y++) {
    for (let x = tx0; x <= tx1; x++) {
      const c = snap.grid[y][x];
      const px = x * TILE, py = y * TILE;
      if (c === '~') {
        ctx.drawImage(tex['water' + ((x * 7 + y * 13) % 3)], px, py);
        // moving moonlight shimmer
        ctx.fillStyle = 'rgba(191,208,232,0.08)';
        const wob = Math.sin(t * 1.8 + x * 1.1 + y * 0.6) * 5;
        ctx.fillRect(px + 5, py + TILE / 2 + wob, TILE - 10, 1.6);
        // foam/lap edge where water meets land
        ctx.strokeStyle = 'rgba(68,97,127,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        if ((snap.grid[y - 1]?.[x] ?? '~') !== '~') { ctx.moveTo(px + 2, py + 1.5); ctx.lineTo(px + TILE - 2, py + 1.5); }
        if ((snap.grid[y + 1]?.[x] ?? '~') !== '~') { ctx.moveTo(px + 2, py + TILE - 1.5); ctx.lineTo(px + TILE - 2, py + TILE - 1.5); }
        if ((snap.grid[y][x - 1] ?? '~') !== '~') { ctx.moveTo(px + 1.5, py + 2); ctx.lineTo(px + 1.5, py + TILE - 2); }
        if ((snap.grid[y][x + 1] ?? '~') !== '~') { ctx.moveTo(px + TILE - 1.5, py + 2); ctx.lineTo(px + TILE - 1.5, py + TILE - 2); }
        ctx.stroke();
        continue;
      }
      if (c === '!') {
        // LAVA — molten channels breathe; crust edges against solid ground
        ctx.drawImage(tex['lava' + ((x * 7 + y * 13) % 3)], px, py);
        const fl = Math.sin(t * 2.1 + x * 1.3 + y * 0.9);
        ctx.fillStyle = `rgba(255,140,40,${0.10 + 0.06 * fl})`;
        ctx.fillRect(px, py, TILE, TILE);
        // heat shimmer: a wavering bright vein
        const wob = Math.sin(t * 3.1 + x * 0.9 + y * 1.4) * 7;
        ctx.fillStyle = 'rgba(255,200,120,0.12)';
        ctx.fillRect(px + 5, py + TILE / 2 + wob, TILE - 10, 1.6);
        // dark crust lip where lava meets land
        ctx.strokeStyle = 'rgba(30,12,6,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        if ((snap.grid[y - 1]?.[x] ?? '!') !== '!') { ctx.moveTo(px + 1, py + 1.2); ctx.lineTo(px + TILE - 1, py + 1.2); }
        if ((snap.grid[y + 1]?.[x] ?? '!') !== '!') { ctx.moveTo(px + 1, py + TILE - 1.2); ctx.lineTo(px + TILE - 1, py + TILE - 1.2); }
        if ((snap.grid[y][x - 1] ?? '!') !== '!') { ctx.moveTo(px + 1.2, py + 1); ctx.lineTo(px + 1.2, py + TILE - 1); }
        if ((snap.grid[y][x + 1] ?? '!') !== '!') { ctx.moveTo(px + TILE - 1.2, py + 1); ctx.lineTo(px + TILE - 1.2, py + TILE - 1); }
        ctx.stroke();
        // a rising ember mote on some tiles
        if (flick(x * 3.1 + y * 9.7) > 0.62) {
          const ph = fract(t * 0.55 + flick(x * 13.7 + y * 7.1));
          ctx.fillStyle = `rgba(255,176,58,${(1 - ph) * 0.85})`;
          ctx.fillRect(px + 8 + flick(x + y * 3) * (TILE - 16), py + TILE - 6 - ph * (TILE + 8), 1.8, 1.8);
        }
        // sparse light pools keep the flow glowing without flooding the pass
        if ((x * 31 + y * 17) % 9 === 0) {
          lights.push({ x: px + TILE / 2, y: py + TILE / 2, r: 58, rgb: '255,120,30', a: 0.10 + 0.04 * fl });
        }
        continue;
      }
      if (c === '%') {
        // VOID — a starry abyss where the shard simply ends
        ctx.fillStyle = '#05060C';
        ctx.fillRect(px, py, TILE, TILE);
        for (let i = 0; i < 3; i++) {
          const sxr = flick(x * 12.9 + y * 78.2 + i * 37.7);
          const syr = flick(x * 39.4 + y * 11.8 + i * 53.3);
          const tw = 0.2 + 0.55 * flick(Math.floor(t * 1.5) + x * 7 + y * 5 + i);
          ctx.fillStyle = `rgba(191,208,232,${tw})`;
          ctx.fillRect(px + 2 + sxr * (TILE - 5), py + 2 + syr * (TILE - 5), i === 0 ? 1.7 : 1, i === 0 ? 1.7 : 1);
        }
        // entropy-violet rim where the world's edge crumbles into the void
        ctx.strokeStyle = `rgba(90,46,140,${0.4 + 0.15 * Math.sin(t * 1.6 + x + y)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if ((snap.grid[y - 1]?.[x] ?? '%') !== '%') { ctx.moveTo(px + 1, py + 1); ctx.lineTo(px + TILE - 1, py + 1); }
        if ((snap.grid[y + 1]?.[x] ?? '%') !== '%') { ctx.moveTo(px + 1, py + TILE - 1); ctx.lineTo(px + TILE - 1, py + TILE - 1); }
        if ((snap.grid[y][x - 1] ?? '%') !== '%') { ctx.moveTo(px + 1, py + 1); ctx.lineTo(px + 1, py + TILE - 1); }
        if ((snap.grid[y][x + 1] ?? '%') !== '%') { ctx.moveTo(px + TILE - 1, py + 1); ctx.lineTo(px + TILE - 1, py + TILE - 1); }
        ctx.stroke();
        continue;
      }
      ctx.drawImage(floorTex(c, x, y), px, py);
      if (c === '^') {
        // ICE — a slow gleam slides across the glassy sheet
        const gl = fract(t * 0.1 + x * 0.23 + y * 0.31);
        ctx.fillStyle = 'rgba(191,251,255,0.07)';
        ctx.fillRect(px + gl * (TILE - 6), py + 2, 4.5, TILE - 4);
        if (flick(x * 5.3 + y * 8.9) > 0.8 && fract(t * 0.7 + flick(x + y * 17)) < 0.12) {
          ctx.fillStyle = 'rgba(223,243,255,0.8)'; // cold sparkle blink
          ctx.fillRect(px + 6 + flick(x * 9 + y) * (TILE - 12), py + 6 + flick(x + y * 9) * (TILE - 12), 1.6, 1.6);
        }
      }
      if (c === 'E') {
        if (gateOpen) {
          // settled ground: cold sheen breathing under the open Anchor
          ctx.fillStyle = `rgba(111,216,242,${0.05 + 0.035 * Math.sin(t * 2 + x)})`;
          ctx.fillRect(px, py, TILE, TILE);
        } else {
          // dormant: faint Entropy veins across the pad
          ctx.strokeStyle = 'rgba(90,46,140,0.4)';
          ctx.lineWidth = 1;
          const vx = px + 8 + flick(x * 3 + y) * 24;
          ctx.beginPath();
          ctx.moveTo(vx, py + TILE - 4);
          ctx.lineTo(vx + 6, py + TILE / 2);
          ctx.lineTo(vx + 2, py + 10);
          ctx.stroke();
        }
      } else if (c === 'o') {
        ctx.drawImage(tex.sandbags2, px, py);
      } else if (c === '*') {
        ctx.drawImage(tex.firebase, px, py);
        drawCampfire(ctx, px, py, x, y, t, lights);
      } else if (c === ';' && doors.length) {
        // INTERIOR MOOD — door-heavy maps build compartments from worked
        // stone: pull the floor down a notch so the sparse service lamps
        // (and door light) carry the room. No def flag; ';' + doors is the cue.
        ctx.fillStyle = 'rgba(11,10,20,0.16)';
        ctx.fillRect(px, py, TILE, TILE);
        if ((x * 31 + y * 17) % 23 === 0) {
          // a ceiling service lamp's warm pool on the deck
          ctx.fillStyle = `rgba(255,217,138,${0.045 + 0.015 * Math.sin(t * 1.7 + x * 2.3)})`;
          ctx.beginPath();
          ctx.ellipse(px + TILE / 2, py + TILE / 2, 14, 9, 0, 0, Math.PI * 2);
          ctx.fill();
          lights.push({ x: px + TILE / 2, y: py + TILE / 2, r: 40, rgb: '255,217,138', a: 0.06 });
        }
      }
    }
  }

  // --- Family Mode: cheerful flowers scattered across grass tiles. World
  // space, inside the camera transform, after terrain and under entities.
  // Positions/colors derive from a hash of (x,y) so blooms never shimmer
  // frame to frame. Same cull range as the terrain pass. ---
  if (familyMode) {
    for (let y = ty0; y <= ty1; y++) {
      for (let x = tx0; x <= tx1; x++) {
        const c = snap.grid[y][x];
        if (c !== '.' && c !== ',') continue; // grass / forest floor only
        // modest density: a few blooms per few tiles, deterministic per tile
        const seed = x * 73856.093 + y * 19349.663;
        const n = flick(seed) < 0.55 ? (flick(seed + 4.1) < 0.35 ? 2 : 1) : 0;
        for (let i = 0; i < n; i++) {
          const hx = flick(seed + i * 7.31 + 1.7);
          const hy = flick(seed + i * 11.9 + 3.3);
          const fx = x * TILE + 4 + hx * (TILE - 8);
          const fy = y * TILE + 4 + hy * (TILE - 8);
          const col = FAM.flowers[Math.floor(flick(seed + i * 5.7 + 9.2) * FAM.flowers.length) % FAM.flowers.length];
          const petals = flick(seed + i * 3.3 + 2.2) < 0.5 ? 4 : 5;
          const r = 1.9 + flick(seed + i * 2.1 + 6.6) * 1.0; // little blooms
          const rot = flick(seed + i * 8.8 + 0.4) * Math.PI * 2;
          // soft green stem dot under the bloom
          ctx.fillStyle = 'rgba(96,168,86,0.55)';
          ctx.fillRect(fx - 0.6, fy, 1.2, 2.6);
          // petals
          ctx.fillStyle = col;
          for (let p = 0; p < petals; p++) {
            const ang = rot + (p / petals) * Math.PI * 2;
            ctx.beginPath();
            ctx.ellipse(fx + Math.cos(ang) * r, fy + Math.sin(ang) * r, r * 0.78, r * 0.52, ang, 0, Math.PI * 2);
            ctx.fill();
          }
          // golden center
          ctx.fillStyle = FAM.flowerCore;
          ctx.beginPath();
          ctx.arc(fx, fy, r * 0.55, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // --- anchor siege lanes: faint dashed guides, drawn under everything ---
  if (snap.mode === 'siege' && snap.siege) drawSiegeLanes(ctx, snap.siege.lanes, inView, t);

  // --- ground patches: lingering burn pools / toxin slicks on the floor ---
  for (const pa of patches) {
    if (inView(pa.x, pa.y, (pa.r || TILE) + 24)) drawPatch(ctx, pa, t, lights);
  }

  // --- tall pass: rock walls + trees (pseudo-3D, painter's order by row) ---
  for (let y = ty0; y <= ty1; y++) {
    for (let x = tx0; x <= tx1; x++) {
      const c = snap.grid[y][x];
      const px = x * TILE, py = y * TILE;
      if (c === '#') {
        const v = (x * 5 + y * 11) % 3;
        const below = y + 1 < snap.h ? snap.grid[y + 1][x] : '#';
        ctx.fillStyle = 'rgba(11,10,20,0.5)';
        ctx.fillRect(px + 4, py + 6, TILE, TILE);
        ctx.drawImage(tex['rock' + v], px, py - 6, TILE, TILE);
        if (below !== '#') {
          // dark side face reads as elevation
          ctx.fillStyle = '#23262f';
          ctx.fillRect(px, py + TILE - 6, TILE, 6);
          ctx.fillStyle = 'rgba(138,152,184,0.12)';
          ctx.fillRect(px, py + TILE - 6, TILE, 1);
        } else if ((snap.grid[y - 1]?.[x] ?? '#') === '#'
          && (snap.grid[y][x - 1] ?? '#') === '#' && (snap.grid[y][x + 1] ?? '#') === '#'
          && (x * 13 + y * 7) % 4 === 0) {
          // deep range interior: a mountain peak rises off the rock band
          const apex = px + TILE / 2 + (flick(x * 3 + y * 5) - 0.5) * 10;
          ctx.fillStyle = '#3E4452';
          ctx.beginPath();
          ctx.moveTo(px + 5, py + TILE - 10);
          ctx.lineTo(apex, py - 16);
          ctx.lineTo(px + TILE - 5, py + TILE - 10);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#2A2E3A'; // shadowed east face
          ctx.beginPath();
          ctx.moveTo(apex, py - 16);
          ctx.lineTo(px + TILE - 5, py + TILE - 10);
          ctx.lineTo(apex + 4, py + TILE - 10);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#9FB2CC'; // moonlit snowcap
          ctx.beginPath();
          ctx.moveTo(apex, py - 16);
          ctx.lineTo(apex + 6, py - 5);
          ctx.lineTo(apex + 1, py - 7);
          ctx.lineTo(apex - 3, py - 3);
          ctx.lineTo(apex - 6, py - 6);
          ctx.closePath(); ctx.fill();
        }
      } else if (c === 'T') {
        const v = (x * 5 + y * 11) % 4;
        ctx.drawImage(tex['tree' + v], px - 8, py - 14);
      }
    }
  }

  // --- doors: closed bulkheads read as walls; open ones slide aside ---
  for (const d of doors) {
    const dw = (d.w ?? 1) * TILE, dh = (d.h ?? 1) * TILE;
    if (inView(d.x * TILE + dw / 2, d.y * TILE + dh / 2, Math.max(dw, dh) / 2 + 60)) {
      drawDoor(ctx, d, t, stateDt, lights); // slide ledger advances once/frame
    }
  }

  // --- the Anchor (exit gate) ---
  const exitCols = exitTiles(snap);
  if (exitCols.length) {
    let sx = 0, sy = 0;
    for (const e of exitCols) { sx += e.x + 0.5; sy += e.y + 0.5; }
    const acx = (sx / exitCols.length) * TILE;
    const acy = (sy / exitCols.length) * TILE;
    if (inView(acx, acy, 220)) drawAnchor(ctx, acx, acy + 14, gate, t, lights);
  }

  // --- LYTH crystals, build sites, shard drops, stranded NPCs ---
  for (const c of crystals) if (inView(c.x, c.y)) drawCrystal(ctx, c, t, lights);
  for (const b of builds) if (inView(b.x, b.y)) drawBuild(ctx, b, t, snap, lights);
  for (const d of drops) if (inView(d.x, d.y)) drawDrop(ctx, d, t, lights);
  for (const n of npcs) {
    if (!inView(n.x, n.y)) continue;
    drawNpc(ctx, n, t, lights);
    // quest giver markers: '!' = quests waiting, '?' = ready to settle
    const mark = npcQuestMark(n, quests);
    if (mark) drawQuestMark(ctx, n.x, n.y - 36, mark, t);
  }

  // --- frontier III world pieces (puzzles, pickups, quest items) ---
  for (const tp of teleports) if (inView(tp.x, tp.y, 60)) drawTeleportPad(ctx, tp, t, snap, lights);
  for (const sw of switches) if (inView(sw.x, sw.y, 60)) drawSwitch(ctx, sw, t, lights);
  for (const gl of glyphs) if (inView(gl.x, gl.y, 60)) drawGlyphStone(ctx, gl, t, lights);
  for (const pi of pillars) if (inView(pi.x, pi.y, 90)) drawPillar(ctx, pi, t, lights);
  for (const fo2 of forges) if (inView(fo2.x, fo2.y, 80)) drawForge(ctx, fo2, t, lights);
  for (const pk of pickups) if (inView(pk.x, pk.y, 60)) drawFieldPickup(ctx, pk, t, lights);
  for (const q of qitems) if (inView(q.x, q.y, 60)) drawQuestItem(ctx, q, t, lights);

  // --- frontier entities (all optional; absent on classic snapshots) ---
  const activePids = new Set();
  for (const p of snap.players) if (p.state === 'active') activePids.add(p.pid);
  for (const c of chests) if (inView(c.x, c.y)) drawChest(ctx, c, t, lights);
  for (const f of flags) {
    const carried = (f.carrier ?? null) != null && activePids.has(f.carrier);
    if (!carried && inView(f.x, f.y, 80)) drawFlag(ctx, f, t, lights);
  }
  for (const s of shops) if (inView(s.x, s.y, 130)) drawShop(ctx, s, t, snap, lights);
  for (const h of hires) if (inView(h.x, h.y, 80)) drawHirePost(ctx, h, t, lights);
  for (const tw of towers) if (inView(tw.x, tw.y, 90)) drawTower(ctx, tw, t, lights);
  if (core && inView(core.x, core.y, 120)) drawCore(ctx, core, t, lights);
  // beacon-defense variant: FOUR beacon monoliths instead of one core. A
  // beacon at 0 hp goes DARK, not destroyed — relight it during the day.
  const cores = snap.cores ?? [];
  for (const c2 of cores) {
    if (!inView(c2.x, c2.y, 120)) continue;
    drawCore(ctx, c2, t, lights);
    if ((c2.hp ?? 0) <= 0) {
      // gone dark: entropy veins crawl the dead monolith
      ctx.save();
      ctx.strokeStyle = `rgba(142,79,209,${0.5 + 0.25 * Math.sin(t * 2.4 + c2.x)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(c2.x - 6, c2.y); ctx.lineTo(c2.x - 3, c2.y - 14); ctx.lineTo(c2.x - 5, c2.y - 26);
      ctx.moveTo(c2.x + 5, c2.y - 4); ctx.lineTo(c2.x + 3, c2.y - 20); ctx.lineTo(c2.x + 5.5, c2.y - 32);
      ctx.stroke();
      ctx.fillStyle = 'rgba(154,143,192,0.9)';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('DARK', c2.x, c2.y - 50);
      ctx.restore();
    }
  }
  // --- anchor siege (MOBA): towers, minions, and a vulnerable-core pulse ---
  if (snap.mode === 'siege' && snap.siege) {
    const sg = snap.siege;
    const open = sg.open ?? [];
    // siege cores echo beacon monoliths (already drawn above via the cores
    // loop) — overlay a team-colored ring, pulsed bright when now attackable
    for (const c2 of cores) {
      if (!inView(c2.x, c2.y, 120)) continue;
      const team = (c2.team | 0) % 2;
      const col = siegeTeamCol(team);
      const vuln = !!open[team];
      const pulse = vuln ? 0.5 + 0.5 * Math.sin(t * 6 + team) : 0;
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = vuln ? 2 + 1.5 * pulse : 1.6;
      ctx.globalAlpha = vuln ? 0.5 + 0.5 * pulse : 0.5;
      if (vuln) { ctx.shadowColor = col; ctx.shadowBlur = 10 + 8 * pulse; }
      ctx.beginPath();
      ctx.arc(c2.x, c2.y + 4, vuln ? 26 + 4 * pulse : 24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      if (vuln) lights.push({ x: c2.x, y: c2.y - 16, r: 90, rgb: hexRgb(col), a: 0.1 + 0.08 * pulse });
    }
    for (const tw of (sg.towers ?? [])) {
      if (inView(tw.x, tw.y, 90)) drawSiegeTower(ctx, tw, t, lights);
    }
    for (const m of (sg.minions ?? [])) {
      if (inView(m.x, m.y, 60)) drawSiegeMinion(ctx, m, t);
    }
  }
  // early extraction: the landed Anchorcraft waits by the base once all four
  // beacons burned together through a night (boarding stays optional)
  const ship = snap.ship ?? null;
  if (ship && inView(ship.x, ship.y, 180)) drawShip(ctx, ship, t, lights);
  for (const v of vehicles) if (inView(v.x, v.y, 80)) drawVehicle(ctx, v, t, dt, lights);
  // lure crackers: the sim snapshot is authoritative when it ships them
  // ([{x,y,landed,fuse}]); otherwise fall back to the event-driven list.
  if (snap.crackers) {
    for (const c of snap.crackers) {
      if (!inView(c.x, c.y, TILE * 9)) continue;
      if (c.landed === false) drawCrackerFlight(ctx, c, t);
      else drawCrackerCharge(ctx, { x: c.x, y: c.y, life: Math.max(0.01, c.fuse ?? 1.5), max: 3.0 }, t, lights);
    }
  } else {
    for (const c of crackers) if (inView(c.x, c.y, TILE * 9)) drawCrackerCharge(ctx, c, t, lights);
  }

  // --- music box easter egg: the ruin altar + its glowing fragments ---
  if (snap.musicBox) {
    const mb = snap.musicBox;
    if (inView(mb.altar.x, mb.altar.y, 60)) drawMusicAltar(ctx, mb.altar, mb, t, lights);
    for (const f of mb.fragments ?? []) {
      // placed fragments rest on the altar (drawn as part of it); carried ones
      // trail their carrier; only loose-on-the-ground fragments draw here
      if (f.placed) continue;
      if (!inView(f.x, f.y, 60)) continue;
      drawMusicFragment(ctx, f, t, lights, f.carrier == null);
    }
  }

  // --- downed captives (slumped, awaiting rescue) ---
  for (const c of snap.captives) {
    if (!inView(c.x, c.y)) continue;
    const col = charMap[c.charId]?.color || '#fff';
    // towed across water by a swimmer: they float, rings spreading
    if (snap.grid?.[Math.floor(c.y / TILE)]?.[Math.floor(c.x / TILE)] === '~') {
      ctx.save();
      ctx.strokeStyle = 'rgba(94,107,140,0.45)';
      ctx.lineWidth = 1.2;
      const pr = fract(t * 0.8 + (c.x + c.y) * 0.01);
      ctx.globalAlpha *= 1 - pr;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y + 4, 10 + pr * 10, (10 + pr * 10) * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    drawCaptive(ctx, c, col, t);
    if (!c.owner) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 4);
      ctx.save();
      ctx.shadowColor = '#5fd2b4';
      ctx.shadowBlur = 8;
      ctx.fillStyle = `rgba(95,210,180,${0.6 + 0.4 * pulse})`;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('▼ RESCUE', c.x, c.y - 22 - pulse * 2);
      ctx.restore();
    }
  }

  // --- enemy telegraphs (the Phantom impersonates friendly energy colors) ---
  for (const e of snap.enemies) {
    if (e.kind === 'sniper' && e.aimT > 0 && e.awake !== false && (inView(e.x, e.y, 800) || inView(e.aimX, e.aimY, 100))) {
      ctx.save();
      ctx.strokeStyle = `rgba(111,216,242,${0.3 + 0.2 * Math.sin(t * 24)})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.aimX, e.aimY);
      ctx.stroke();
      ctx.restore();
    }
  }

  // --- the Entropy ---
  for (const e of snap.enemies) {
    if (!inView(e.x, e.y, e.kind === 'boss' ? 110 : 70)) continue;
    const asleep = e.awake === false;
    ctx.save();
    ctx.globalAlpha = (asleep ? 0.78 : 1) * (e.returning ? 0.75 : 1);
    if (e.returning) ctx.filter = 'saturate(0.4) brightness(0.9)'; // leashed: heading home
    if (e.mutation === 'bulk') {
      // swollen: the whole body reads ~25% bigger
      ctx.translate(e.x, e.y);
      ctx.scale(1.22, 1.22);
      ctx.translate(-e.x, -e.y);
    }
    // Family Mode: cuddly monsters — soft pastel halo under a slightly
    // LARGER (~1.3x), gentler-toned body. Visual only: scale is applied to
    // the draw transform, never to e.x/e.y or any hitbox. ---
    if (familyMode) {
      // scale centered on the enemy center: e.x/e.y map to themselves so the
      // cushion, body and face all stay registered while reading ~1.3x bigger
      ctx.translate(e.x, e.y);
      ctx.scale(1.3, 1.3);
      ctx.translate(-e.x, -e.y);
      drawFamilyMonsterBase(ctx, e, t); // soft pastel cushion UNDER the art
      // pastel-soften the baked/vector silhouette so it reads friendly
      ctx.filter = (e.returning ? 'saturate(0.4) brightness(0.9) ' : '') + 'saturate(0.7) brightness(1.18)';
    }
    drawEnemy(ctx, e, t, dt);
    if (familyMode) { ctx.filter = 'none'; drawFamilyMonsterFace(ctx, e, t); } // big cute eyes + smile on top
    ctx.restore();
    if (e.mutation) drawMutation(ctx, e, t, lights);
    if (e.hurt > 0) {
      // breach-red damage flash
      ctx.save();
      ctx.globalAlpha = Math.min(1, e.hurt / 0.14) * 0.4;
      ctx.fillStyle = PAL.red;
      ctx.beginPath();
      ctx.arc(e.x, e.y, (KIND_R[e.kind] || 13) + 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    const maxHp = e.maxHp || 1;
    if (e.hp < maxHp) {
      const w = e.kind === 'boss' ? 44 : 26;
      const yo = e.kind === 'boss' ? 38 : 24;
      ctx.fillStyle = 'rgba(11,10,20,0.7)';
      ctx.fillRect(e.x - w / 2, e.y - yo, w, 4);
      ctx.fillStyle = PAL.red;
      ctx.fillRect(e.x - w / 2 + 1, e.y - yo + 1, (w - 2) * (e.hp / maxHp), 2);
    }
    // status overlays: stun sparks / flame / toxin drip / mind-control read
    const st = enemyStatus(e);
    if (st.stun || st.burn || st.tox || st.conv) drawStatusFX(ctx, e, st, t, lights);
    // an acolyte's absorb charge: violet shell, popped by one hit
    if (e.shielded) drawEnemyShield(ctx, e, t);
  }

  // --- acolyte shield-threads: each Null Acolyte tends its nearest ward ---
  for (const e of snap.enemies) {
    if ((KIND_ALIAS[e.kind] || e.kind) !== 'acolyte' || e.awake === false || !inView(e.x, e.y, 300)) continue;
    let ward = null, best = (TILE * 6) ** 2;
    for (const o of snap.enemies) {
      if (o === e || !o.shielded) continue;
      const d = (o.x - e.x) ** 2 + (o.y - e.y) ** 2;
      if (d < best) { best = d; ward = o; }
    }
    if (!ward) continue;
    ctx.save();
    ctx.strokeStyle = `rgba(142,79,209,${0.3 + 0.2 * Math.sin(t * 4 + e.id)})`;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 5]);
    ctx.lineDashOffset = -t * 22; // the mend flows acolyte -> ward
    ctx.beginPath();
    ctx.moveTo(e.x, e.y - 9);
    ctx.lineTo(ward.x, ward.y);
    ctx.stroke();
    ctx.restore();
  }

  // --- followers: hired hounds, archers, casters trailing their operators ---
  if (followers.length) {
    const ownerCol = new Map();
    for (const p of snap.players) ownerCol.set(p.pid, charMap[p.charId]?.color || PAL.teal);
    if (houndMood.size > 200) houndMood.clear(); // ids keep growing on long runs
    for (const fo of followers) {
      // the sim ships no engage event: detect the hound closing on prey here
      // (rising edge of an awake, unconverted enemy within 3 tiles) and bark.
      if (fo.kind === 'hound') {
        let near = false;
        const r2 = (TILE * 3) ** 2;
        for (const e of snap.enemies) {
          if (e.awake === false || enemyStatus(e).conv) continue;
          if ((e.x - fo.x) ** 2 + (e.y - fo.y) ** 2 < r2) { near = true; break; }
        }
        const key = fo.id ?? `${fo.owner}:${fo.slot ?? 0}`;
        let hm = houndMood.get(key);
        if (!hm) { hm = { engaged: near, lastBark: -10 }; houndMood.set(key, hm); }
        else if (near && !hm.engaged && t - hm.lastBark > 2.5) {
          hm.lastBark = t;
          addEventFX({ type: 'bark', x: fo.x, y: fo.y });
          playEvent({ type: 'bark' });
        }
        hm.engaged = near;
      }
      if (!inView(fo.x, fo.y)) continue;
      drawFollower(ctx, fo, t, dt, ownerCol.get(fo.owner) ?? PAL.teal, lights);
    }
  }

  // --- operators ---
  const flagByCarrier = new Map();
  for (const f of flags) if ((f.carrier ?? null) != null) flagByCarrier.set(f.carrier, f);
  for (const p of snap.players) {
    if (p.state !== 'active') continue;
    // per-view cull (margin covers the name/hearts/aura overdraw). Safe in
    // single view: the shared camera pads the focus bbox by 4.5 tiles, so a
    // focused operator is always in view.
    if (!inView(p.x, p.y, 90)) continue;
    const ch = charMap[p.charId];
    const col = ch?.color || '#fff';
    // raised when manning a tower platform or in the saddle
    const yOff = p.towerId != null ? -24 : (p.riding != null ? -7 : 0);
    // swimmers (char.swims, e.g. the Selkie) half-submerge on water tiles
    const swim = !!ch?.swims && yOff === 0
      && snap.grid?.[Math.floor(p.y / TILE)]?.[Math.floor(p.x / TILE)] === '~';
    if (swim) drawSwimWake(ctx, p, t);
    // a carried lythseal rings the bearer in checkpoint gold (under the body)
    if (p.hasSeal || p.lythseal || p.seal) drawSealAura(ctx, p.x, p.y + yOff, t, lights);
    // siege: a team-colored ring UNDER the operative (blue team 0 / red team 1)
    // so allies vs enemies read instantly; local seats get a brighter "YOU" ring
    if (snap.mode === 'siege' && p.team != null)
      drawSiegeTeamRing(ctx, p.x, p.y + yOff, p.team, focus.has(p.pid), t);
    // a picked-up field weapon overrides the character silhouette for FIRE
    drawSoldier(ctx, p.x, p.y + yOff, p.fx, p.fy, col, t, focus.has(p.pid), p.invuln,
      { key: 'p' + p.pid, dt, weapon: p.fieldWeapon?.kind ?? ch?.weapon?.kind, swim });
    const fcar = flagByCarrier.get(p.pid);
    if (fcar) drawCarriedFlag(ctx, p.x, p.y + yOff, fcar, t);
    if ((p.shield ?? 0) > 0) drawShieldBubble(ctx, p.x, p.y + yOff, p.shield, t);
    // ctf: names read in team colors; everywhere else, anchor white
    ctx.fillStyle = flags.length && p.team != null
      ? TEAM_COL[p.team % 2] : (familyMode ? '#FFFFFF' : 'rgba(223,243,255,0.85)');
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    const label = p.name.toUpperCase();
    // bright daylight washes light text out: give names a soft dark outline
    if (familyMode) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = 3; }
    ctx.fillText(label, p.x, p.y + yOff - 26);
    if (familyMode) ctx.restore();
    // mission level pips beside the name (one gold diamond per level-up)
    if ((p.level ?? 1) > 1) {
      const nw = ctx.measureText(label).width;
      drawLevelDiamonds(ctx, p.x + nw / 2 + 8, p.y + yOff - 29.5, p.level);
    }
    // survival hearts, shown only while hurt
    if (p.maxHp != null && p.hp != null && p.hp < p.maxHp) {
      drawHeartPips(ctx, p.x, p.y + yOff - 37, p.hp, p.maxHp);
    }
    // volt-zap root: the same spark cross the Entropy wears when stunned
    if ((p.stunT ?? 0) > 0) {
      ctx.save();
      ctx.strokeStyle = `rgba(255,239,194,${0.65 + 0.3 * Math.sin(t * 14 + p.pid)})`;
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i++) {
        const sa = t * 5 + (i / 3) * Math.PI * 2;
        const sx = p.x + Math.cos(sa) * 9, sy = p.y + yOff - 16 + Math.sin(sa) * 3;
        ctx.beginPath();
        ctx.moveTo(sx - 2.4, sy); ctx.lineTo(sx + 2.4, sy);
        ctx.moveTo(sx, sy - 2.4); ctx.lineTo(sx, sy + 2.4);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // --- BR shrink zone: cyan wall closing in, the outside dimmed ---
  if (zone && (zone.r ?? 0) > 0) {
    const vx0 = (tx0 - 1) * TILE, vy0 = (ty0 - 1) * TILE;
    const vw2 = (tx1 - tx0 + 3) * TILE, vh2 = (ty1 - ty0 + 3) * TILE;
    ctx.save();
    ctx.beginPath();
    ctx.rect(vx0, vy0, vw2, vh2);
    ctx.arc(zone.x, zone.y, zone.r, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(8,12,24,0.45)';
    ctx.fill('evenodd');
    // where the wall will stop (mid-shrink)
    if (zone.targetR != null && zone.targetR < zone.r - 1) {
      ctx.setLineDash([8, 8]);
      ctx.strokeStyle = 'rgba(111,216,242,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(zone.x, zone.y, zone.targetR, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    // the wall itself
    const zp = 0.6 + 0.3 * Math.sin(t * 2.2);
    ctx.strokeStyle = `rgba(111,216,242,${0.25 + 0.55 * zp})`;
    ctx.lineWidth = 3.5;
    ctx.shadowColor = PAL.relay;
    ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(zone.x, zone.y, zone.r, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    // energy ticks rising off the wall
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2 + t * 0.08;
      const wx = zone.x + Math.cos(a) * zone.r, wy = zone.y + Math.sin(a) * zone.r;
      if (!inView(wx, wy, 30)) continue;
      const hgt = 8 + 6 * flick(i * 3.7 + Math.floor(t * 3));
      ctx.strokeStyle = `rgba(111,216,242,${0.25 + 0.35 * flick(i + Math.floor(t * 5))})`;
      ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx, wy - hgt); ctx.stroke();
    }
    ctx.restore();
  }

  // --- night: darkness falls over the world; warm light punches through.
  // nightK ramps smoothly through dusk/dawn on bastion maps; story dark
  // missions pin it at 1, exactly the old treatment. ---
  if (nightK > 0) {
    ctx.fillStyle = `rgba(6,6,15,${0.32 * nightK})`;
    ctx.fillRect((tx0 - 1) * TILE, (ty0 - 1) * TILE, (tx1 - tx0 + 3) * TILE, (ty1 - ty0 + 3) * TILE);
    if (bloodK > 0) {
      // blood moon: a deep red wash bleeds into the dark
      ctx.fillStyle = `rgba(122,18,30,${0.16 * bloodK})`;
      ctx.fillRect((tx0 - 1) * TILE, (ty0 - 1) * TILE, (tx1 - tx0 + 3) * TILE, (ty1 - ty0 + 3) * TILE);
    }
  }
  if (darkWorld) {
    // operators carry a faint cool aura so the squad stays readable
    for (const p of snap.players) {
      if (p.state !== 'active') continue;
      lights.push({ x: p.x, y: p.y, r: 95, rgb: '140,170,210', a: 0.09 });
    }
    // hunting eyes glow through the dark
    for (const e of snap.enemies) {
      if (e.awake === false || !inView(e.x, e.y)) continue;
      lights.push({ x: e.x + e.fx * 7, y: e.y + e.fy * 7, r: 13, rgb: bloodK > 0 ? '255,120,120' : '191,251,255', a: 0.3 });
    }
  }

  // --- interaction prompts near focus players (build sites take priority) ---
  const R2 = (TILE * 1.5) ** 2;
  const focusActive = snap.players.filter(p => p.state === 'active' && focus.has(p.pid));
  const promptSites = new Set();
  const busyPids = new Set();
  for (const fp of focusActive) {
    let bestB = null, bd = R2;
    for (const b of builds) {
      if (b.built) continue;
      const d = (b.x - fp.x) ** 2 + (b.y - fp.y) ** 2;
      if (d < bd) { bd = d; bestB = b; }
    }
    if (bestB) { promptSites.add(bestB); busyPids.add(fp.pid); }
  }
  // everything else that answers the act button gets one nearest prompt
  const cands = [];
  for (const n of npcs) cands.push({ x: n.x, y: n.y, py: n.y - 36, text: '[E/X] TALK' });
  for (const c of chests) if (!c.opened) cands.push({ x: c.x, y: c.y, py: c.y - 26, text: '[E/X] OPEN CACHE' });
  for (const v of vehicles) {
    if ((v.rider ?? null) != null) continue;
    cands.push({ x: v.x, y: v.y, py: v.y - (v.kind === 'skiff' ? 26 : 42), text: v.kind === 'skiff' ? '[E/X] BOARD SKIFF' : '[E/X] MOUNT STAG' });
  }
  for (const tw of towers) {
    if ((tw.hp ?? 1) <= 0) cands.push({ x: tw.x, y: tw.y, py: tw.y - 48, text: '[hold E/X] REBUILD TOWER 10◆' });
    else if ((tw.occupant ?? null) == null) cands.push({ x: tw.x, y: tw.y, py: tw.y - 48, text: '[E/X] MAN TOWER' });
  }
  for (const b of builds) {
    if (!b.built) continue;
    if (b.kind === 'farm') {
      if ((b.stage ?? 0) >= 3) cands.push({ x: b.x, y: b.y, py: b.y - 26, text: '[E/X] HARVEST' });
      continue;
    }
    if (b.kind === 'pylon' || b.level == null) continue; // pylons keep classic semantics
    if (b.typeSelect) continue; // the carousel owns this turret's prompt space
    if (b.hp != null && b.maxHp && b.hp < b.maxHp) cands.push({ x: b.x, y: b.y, py: b.y - 30, text: '[hold E/X] REPAIR 1◆/3HP' });
    else if (b.level < 3) cands.push({ x: b.x, y: b.y, py: b.y - 30, text: `[hold E/X] UPGRADE ${b.level * 8}◆` });
    else cands.push({ x: b.x, y: b.y, py: b.y - 30, text: '[hold E/X] DISMANTLE' });
  }
  // frontier III interactables join the same one-nearest-prompt chain
  for (const pk of pickups) {
    const st2 = PICKUP_STYLE[pk.kind];
    cands.push({ x: pk.x, y: pk.y, py: pk.y - 24, text: `[E/X] TAKE ${st2?.label ?? String(pk.kind || 'WEAPON').toUpperCase()}` });
  }
  for (const fo2 of forges) cands.push({ x: fo2.x, y: fo2.y, py: fo2.y - 28, text: '[hold E/X] FORGE LYTHSEAL 20◆ + FRAGMENT' });
  for (const sw of switches) {
    if (!sw.on && !sw.burned && !sw.dead) cands.push({ x: sw.x, y: sw.y, py: sw.y - 26, text: '[E/X] THROW SWITCH' });
  }
  for (const gl of glyphs) {
    if (!gl.lit) cands.push({ x: gl.x, y: gl.y, py: gl.y - 30, text: `[E/X] LIGHT ${GLYPH_RUNES[((Math.round(gl.symbol ?? 0) % 8) + 8) % 8]}` });
  }
  for (const s of shops) {
    // once someone is BROWSING (p.shop ships from the sim) the carousel takes
    // over; anyone merely standing near still gets the hold prompt
    let busy = false;
    for (const p of snap.players) {
      if (p.state === 'active' && p.shop && !p.selecting
        && (p.x - s.x) ** 2 + (p.y - s.y) ** 2 < R2) { busy = true; break; }
    }
    if (!busy) cands.push({ x: s.x, y: s.y, py: s.y - 40, text: '[hold E/X] SHOP' });
  }
  // stronghold: dark beacons take a hold-act relight; the landed ship boards
  for (const c2 of cores) {
    if ((c2.hp ?? 0) <= 0) cands.push({ x: c2.x, y: c2.y, py: c2.y - 62, text: '[hold E/X] RELIGHT BEACON 8◆' });
  }
  // THE HORN: by day the base core (or any LIT beacon) offers the early
  // nightfall call — mirror of the sim's stepHorn gate (never in a day's
  // last 5s, never while a blood-moon warning sounds)
  if (cycle && cycle.phase === 'day' && cycle.t > 5 && !(cycle.nextBloodMoon && cycle.t <= 30)) {
    for (const c2 of cores) {
      if (c2.lit ?? (c2.hp ?? 0) > 0) cands.push({ x: c2.x, y: c2.y, py: c2.y - 62, text: '[hold E/X] SOUND THE HORN' });
    }
    if (core) cands.push({ x: core.x, y: core.y, py: core.y - 62, text: '[hold E/X] SOUND THE HORN' });
  }
  if (ship?.landed) cands.push({ x: ship.x, y: ship.y, py: ship.y - 46, text: '[E/X] BOARD THE ANCHORCRAFT' });
  const promptOthers = new Set();
  for (const fp of focusActive) {
    if (busyPids.has(fp.pid)) continue;
    let bestC = null, cd = R2;
    for (const c of cands) {
      const d = (c.x - fp.x) ** 2 + (c.y - fp.y) ** 2;
      if (d < cd) { cd = d; bestC = c; }
    }
    if (bestC) promptOthers.add(bestC);
  }
  // prompts anchor to union-focus seats, so cull per view: another cell's
  // seat may be far outside this cell's camera
  for (const b of promptSites) if (inView(b.x, b.y, 90)) drawPrompt(ctx, b.x, b.y - 34, `[hold E/X] BUILD ${(b.kind || '').toUpperCase()} ${b.cost ?? ''}◆`, t);
  for (const c of promptOthers) if (inView(c.x, c.py, 90)) drawPrompt(ctx, c.x, c.py, c.text, t);

  // --- shots ---
  // weapon evolutions (L3+): per-pid lookup so shot trails read evolved.
  // Shots may also carry an explicit s.evo / s.ownerPid from the sim.
  let pidEvo = null;
  for (const p of snap.players) {
    if ((p.level ?? 1) < 3) continue;
    const evo = charMap[p.charId]?.evolution;
    if (evo) (pidEvo ??= new Map()).set(p.pid, evo);
  }
  for (const s of snap.shots) {
    if (!inView(s.x, s.y)) continue;
    const sp = Math.hypot(s.vx, s.vy) || 1;
    const nx = s.vx / sp, ny = s.vy / sp;
    const evo = s.evo ?? (s.who === 'p' && pidEvo ? pidEvo.get(s.ownerPid ?? s.pid) : null);
    ctx.save();
    if (s.kind === 'cracker') {
      // a lobbed lure mid-arc: tumbling red charge, fuse sparking
      ctx.translate(s.x, s.y);
      ctx.rotate(t * 9);
      ctx.fillStyle = '#8C2A22';
      ctx.fillRect(-4, -2.5, 8, 5);
      ctx.fillStyle = '#C75B22';
      ctx.fillRect(-4, -2.5, 8, 1.7);
      if (Math.floor(t * 12) % 2 === 0) {
        ctx.fillStyle = PAL.lythPale;
        ctx.shadowColor = PAL.lythGold;
        ctx.shadowBlur = 7;
        ctx.fillRect(3.4, -4.4, 2, 2);
      }
    } else if (s.kind === 'harpoon') {
      // the Selkie's barbed harpoon: a thrown spear, line trailing
      ctx.translate(s.x, s.y);
      ctx.rotate(Math.atan2(ny, nx));
      ctx.strokeStyle = 'rgba(191,208,232,0.25)'; // retrieval line
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-28, 0); ctx.stroke();
      ctx.fillStyle = '#4A4232'; // shaft
      ctx.fillRect(-14, -1.1, 16, 2.2);
      ctx.fillStyle = PAL.moonsteel;
      ctx.fillRect(-14, -1.1, 16, 0.8);
      ctx.fillStyle = PAL.anchor; // barbed head
      ctx.shadowColor = PAL.relay;
      ctx.shadowBlur = 7;
      ctx.beginPath();
      ctx.moveTo(8, 0); ctx.lineTo(1, -3); ctx.lineTo(3, 0); ctx.lineTo(1, 3);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = PAL.coldHi; // back-swept barbs
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(2, -2.4); ctx.lineTo(-2, -4.6);
      ctx.moveTo(2, 2.4); ctx.lineTo(-2, 4.6);
      ctx.stroke();
    } else if (s.kind === 'riptide') {
      // riptide nova droplet: cold water ring + froth
      const rg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 7);
      rg.addColorStop(0, 'rgba(223,243,255,0.9)');
      rg.addColorStop(0.5, 'rgba(111,216,242,0.55)');
      rg.addColorStop(1, 'rgba(62,143,224,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(s.x - 7, s.y - 7, 14, 14);
      ctx.strokeStyle = 'rgba(111,216,242,0.6)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(s.x - nx * 6, s.y - ny * 6, 4 + fract(t * 2 + s.x * 0.05) * 3, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.kind === 'tornado') {
      // the caster's pocket storm: stacked swirling rings + flung debris
      ctx.translate(s.x, s.y);
      for (let i = 0; i < 3; i++) {
        const wob = Math.sin(t * 9 + i * 1.7) * 1.3;
        ctx.strokeStyle = `rgba(138,152,184,${0.8 - i * 0.18})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(wob, -i * 4.2, 3 + i * 2.6, (3 + i * 2.6) * 0.45, 0, t * 7 + i, t * 7 + i + Math.PI * 1.5);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(191,208,232,0.7)'; // debris caught in the funnel
      for (let i = 0; i < 2; i++) {
        const da = t * 8 + i * Math.PI;
        ctx.fillRect(Math.cos(da) * 6 - 1, -4 + Math.sin(da) * 2.4 - 1, 2, 2);
      }
    } else if (s.kind === 'toxin') {
      // lobbed toxin glob, dripping as it tumbles
      ctx.strokeStyle = 'rgba(140,200,80,0.4)'; // drip trail
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(s.x - nx * 6, s.y - ny * 6);
      ctx.lineTo(s.x - nx * 16, s.y - ny * 16);
      ctx.stroke();
      ctx.translate(s.x, s.y);
      ctx.rotate(t * 7);
      ctx.fillStyle = '#3E5A22';
      ctx.shadowColor = '#8CC850';
      ctx.shadowBlur = 7;
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(190,240,120,0.85)';
      ctx.fillRect(-1.6, -2.2, 1.6, 1.6);
    } else if (s.kind === 'flamer' || s.kind === 'flame') {
      // a short burning gout: stacked flame tears wobbling along the path
      const seed = s.x * 0.7 + s.y * 1.1;
      const j = 0.8 + flick(Math.floor(t * 10) + seed) * 0.4;
      ctx.translate(s.x, s.y);
      ctx.rotate(Math.atan2(ny, nx) + Math.PI / 2);
      ctx.fillStyle = PAL.ember;
      tear(ctx, 0, 2, 4.2 * j, 9 * j);
      ctx.fillStyle = PAL.lythAmber;
      tear(ctx, (flick(seed) - 0.5) * 2, 1, 2.8 * j, 6.5 * j);
      ctx.fillStyle = PAL.lythGold;
      tear(ctx, 0, 0.5, 1.6 * j, 4);
    } else if (s.kind === 'railcannon') {
      // a piercing lance: the longest, hottest line in the game
      ctx.strokeStyle = 'rgba(111,216,242,0.5)';
      ctx.shadowColor = PAL.relay;
      ctx.shadowBlur = 12;
      ctx.lineCap = 'round';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(s.x - nx * 30, s.y - ny * 30);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
      ctx.strokeStyle = PAL.anchor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x - nx * 34, s.y - ny * 34);
      ctx.lineTo(s.x + nx * 3, s.y + ny * 3);
      ctx.stroke();
      ctx.shadowBlur = 0;
      // rail sparks shedding sideways
      ctx.fillStyle = 'rgba(191,251,255,0.8)';
      const sd = Math.floor(t * 30) + s.x;
      for (let i = 1; i <= 2; i++) {
        ctx.fillRect(s.x - nx * i * 12 - ny * (flick(sd + i) - 0.5) * 10,
          s.y - ny * i * 12 + nx * (flick(sd + i * 3) - 0.5) * 10, 1.6, 1.6);
      }
    } else if (s.kind === 'stormgun' || s.kind === 'zap') {
      // a crawling storm bolt (stormgun round / volt wraith zap):
      // jagged core, re-rolled every frame
      const frame = Math.floor(t * 30) + (s.x | 0);
      ctx.lineCap = 'round';
      for (const [w2, col2] of [[3.5, 'rgba(111,216,242,0.45)'], [1.4, PAL.eye]]) {
        ctx.strokeStyle = col2;
        ctx.shadowColor = PAL.relay;
        ctx.shadowBlur = w2 > 2 ? 8 : 0;
        ctx.lineWidth = w2;
        ctx.beginPath();
        jagPath(ctx, s.x - nx * 16, s.y - ny * 16, s.x, s.y, 4, 4, frame + w2);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    } else if (s.kind === 'mortarMk2') {
      // tumbling heavy shell on its over-wall arc, breech-glow trailing
      ctx.strokeStyle = 'rgba(224,123,57,0.4)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(s.x - nx * 7, s.y - ny * 7);
      ctx.lineTo(s.x - nx * 18, s.y - ny * 18);
      ctx.stroke();
      ctx.translate(s.x, s.y);
      ctx.rotate(t * 7);
      ctx.fillStyle = PAL.graphPlate;
      ctx.fillRect(-5, -3, 10, 6);
      ctx.fillStyle = PAL.graphDark;
      ctx.fillRect(-5, -3, 10, 2);
      ctx.fillStyle = '#E07B39'; // hot band
      ctx.shadowColor = '#E07B39';
      ctx.shadowBlur = 6;
      ctx.fillRect(-1.2, -3, 2.4, 6);
      ctx.shadowBlur = 0;
    } else if (s.who === 'e' && s.kind !== 'sniper') {
      // dark Entropy bolt trailed in violet
      ctx.strokeStyle = 'rgba(142,79,209,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x - nx * 14, s.y - ny * 14);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
      ctx.fillStyle = PAL.voidNight;
      ctx.strokeStyle = PAL.glitch;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = PAL.glitch;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      // blue-white energy tracer (player fire — and the Phantom's fake)
      const hairline = s.who === 'e';
      ctx.strokeStyle = PAL.anchor;
      ctx.shadowColor = hairline ? PAL.coldHi : PAL.relay;
      ctx.shadowBlur = 9;
      ctx.lineWidth = hairline ? 1.5 : 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s.x - nx * (hairline ? 20 : 12), s.y - ny * (hairline ? 20 : 12));
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
      // evolved rounds wear their element on the trail
      if (s.who === 'p' && evo === 'burn') {
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(240,169,60,0.85)';
        const seed = s.x * 0.7 + s.y * 1.3;
        for (let i = 1; i <= 3; i++) {
          ctx.globalAlpha = 0.75 - i * 0.18;
          ctx.fillRect(
            s.x - nx * (8 + i * 7) + (flick(seed + i * 5.1) - 0.5) * 5,
            s.y - ny * (8 + i * 7) + (flick(seed + i * 8.7) - 0.5) * 5, 2, 2);
        }
      } else if (s.who === 'p' && evo === 'shock') {
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(191,251,255,0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        jagPath(ctx, s.x - nx * 14 - ny * 4, s.y - ny * 14 + nx * 4,
          s.x - ny * -3, s.y + nx * -3, 4, 3.5, Math.floor(t * 30) + s.x);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // --- prism beams + tesla chain lightning (event-driven, short-lived) ---
  for (const bm of beams) {
    if (!inView(bm.x, bm.y, 600) && !inView(bm.tx, bm.ty, 100)) continue;
    const k = Math.max(0, bm.life / bm.max);
    const sy = bm.y - 16; // beam leaves the crystal head
    ctx.save();
    ctx.globalAlpha = k;
    // feeder flashes from contributing prisms
    for (const fd of bm.feeders ?? []) {
      ctx.strokeStyle = 'rgba(111,216,242,0.65)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(fd.x, (fd.y ?? bm.y) - 16);
      ctx.lineTo(bm.x, sy);
      ctx.stroke();
    }
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(111,216,242,0.55)'; // wide glow pass
    ctx.shadowColor = PAL.relay;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 5.5 + (bm.dmg - 2) * 1.2; // chained prisms hit visibly harder
    ctx.beginPath(); ctx.moveTo(bm.x, sy); ctx.lineTo(bm.tx, bm.ty); ctx.stroke();
    ctx.strokeStyle = PAL.anchor; // hot core
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bm.x, sy); ctx.lineTo(bm.tx, bm.ty); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(223,243,255,${0.85 * k})`; // impact flare
    ctx.beginPath(); ctx.arc(bm.tx, bm.ty, 4 + (1 - k) * 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  for (const zp of zaps) {
    if (!inView(zp.x, zp.y, 300)) continue;
    const k = Math.max(0, zp.life / zp.max);
    const frame = Math.floor(t * 30);
    ctx.save();
    ctx.globalAlpha = k;
    ctx.lineCap = 'round';
    // glow pass then hot core, both jagged, chaining target to target
    for (const [w2, col2, mag] of [[4, 'rgba(111,216,242,0.5)', 8], [1.6, PAL.eye, 7]]) {
      ctx.strokeStyle = col2;
      ctx.shadowColor = PAL.relay;
      ctx.shadowBlur = w2 > 2 ? 10 : 0;
      ctx.lineWidth = w2;
      let sx0 = zp.x, sy0 = zp.y - 27; // arcs leap from the coil orb
      ctx.beginPath();
      for (let i = 0; i < zp.targets.length; i++) {
        const tg = zp.targets[i];
        jagPath(ctx, sx0, sy0, tg.x, tg.y, 5, mag, frame + i * 13 + w2);
        sx0 = tg.x; sy0 = tg.y;
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- blink streaks: teleports + phase stalker hops (one missed heartbeat,
  // then a fading after-image of the wave that carried you) ---
  for (const sk of streaks) {
    if (!inView(sk.x, sk.y, 400) && !inView(sk.tx, sk.ty, 100)) continue;
    const k = Math.max(0, sk.life / sk.max);
    const rgb = sk.rgb ?? '111,216,242';
    ctx.save();
    ctx.globalAlpha = k;
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(${rgb},0.5)`;
    ctx.shadowColor = `rgb(${rgb})`;
    ctx.shadowBlur = 10;
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(sk.x, sk.y); ctx.lineTo(sk.tx, sk.ty); ctx.stroke();
    ctx.strokeStyle = PAL.anchor;
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(sk.x, sk.y); ctx.lineTo(sk.tx, sk.ty); ctx.stroke();
    ctx.shadowBlur = 0;
    // the traveler, mid-agreement
    const pr = 1 - k;
    ctx.fillStyle = `rgba(${rgb},0.9)`;
    ctx.beginPath();
    ctx.arc(sk.x + (sk.tx - sk.x) * pr, sk.y + (sk.ty - sk.y) * pr, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // --- particles (shared state, culled per viewport) ---
  for (const p of particles) {
    if (!inView(p.x, p.y, 10)) continue;
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // --- expanding rings (built / gateOpen / talk) ---
  for (const r of rings) {
    if (!inView(r.x, r.y, r.r1)) continue;
    const k = 1 - r.life / r.max;
    const rad = r.r0 + (r.r1 - r.r0) * (1 - (1 - k) * (1 - k));
    ctx.globalAlpha = Math.max(0, r.life / r.max) * 0.9;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = r.w || 3;
    ctx.beginPath();
    ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (const p of popups) {
    if (p.screen || !inView(p.x, p.y, 80)) continue;
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;

  // --- additive glows: muzzle flashes + warm/cold light pools ---
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const f of flashes) {
    if (!inView(f.x, f.y)) continue;
    const a = Math.max(0, f.life / 0.07);
    // evolved muzzle (L3+): resolve from the nearest leveled operator once,
    // unless the shoot event already carried ev.evo from the sim.
    if (f.evo === undefined && f.who === 'p') {
      f.evo = null;
      for (const p of snap.players) {
        if (p.state !== 'active' || (p.level ?? 1) < 3) continue;
        if ((p.x - f.x) ** 2 + (p.y - f.y) ** 2 < 30 ** 2) {
          f.evo = charMap[p.charId]?.evolution ?? null;
          break;
        }
      }
    }
    let rgb = f.who === 'p' ? '223,243,255' : '142,79,209';
    let rad = 32;
    // field weapons carry their own muzzle signature (evolutions don't apply)
    if (f.weapon === 'flamer') { rad = 50; rgb = '240,169,60'; }
    else if (f.weapon === 'railcannon') { rad = 56; rgb = '191,251,255'; }
    else if (f.weapon === 'stormgun') { rad = 40; rgb = '191,251,255'; }
    else if (f.weapon === 'mortarMk2') { rad = 46; rgb = '255,217,138'; }
    else if (f.evo === 'multi') rad = 48; // wider fan flash
    else if (f.evo === 'blast') { rad = 44; rgb = '255,217,138'; } // heavy warm muzzle
    else if (f.evo === 'burn') rgb = '240,169,60'; // ember-hot muzzle
    const fg = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, rad);
    fg.addColorStop(0, `rgba(${rgb},${0.45 * Math.min(1, a)})`);
    fg.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = fg;
    ctx.fillRect(f.x - rad, f.y - rad, rad * 2, rad * 2);
    if (f.weapon === 'flamer') {
      // THE CONE: a wedge of fire down the shooter's facing
      if (f.dir === undefined) {
        f.dir = null;
        for (const p of snap.players) {
          if (p.state !== 'active') continue;
          if ((p.x - f.x) ** 2 + (p.y - f.y) ** 2 < 34 ** 2) { f.dir = Math.atan2(p.fy, p.fx); break; }
        }
      }
      if (f.dir != null) {
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.dir);
        const cone = ctx.createLinearGradient(0, 0, 56, 0);
        cone.addColorStop(0, `rgba(255,239,194,${0.5 * Math.min(1, a)})`);
        cone.addColorStop(0.5, `rgba(240,169,60,${0.35 * Math.min(1, a)})`);
        cone.addColorStop(1, 'rgba(199,91,34,0)');
        ctx.fillStyle = cone;
        ctx.beginPath();
        ctx.moveTo(4, 0);
        ctx.lineTo(56, -19);
        ctx.quadraticCurveTo(64, 0, 56, 19);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    } else if (f.weapon === 'stormgun') {
      // coil crackle forking off the emitter orb
      const frame = Math.floor(t * 40);
      ctx.save();
      ctx.strokeStyle = `rgba(191,251,255,${0.75 * Math.min(1, a)})`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const aa = flick(frame + i * 9.3 + f.x) * Math.PI * 2;
        jagPath(ctx, f.x, f.y, f.x + Math.cos(aa) * 16, f.y + Math.sin(aa) * 16, 3, 3.5, frame + i * 17);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (f.evo === 'shock' && !PICKUP_STYLE[f.weapon]) { // field weapons skip evos
      // blue crackle forking off the muzzle
      const frame = Math.floor(t * 40);
      ctx.save();
      ctx.strokeStyle = `rgba(191,251,255,${0.7 * Math.min(1, a)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const aa = flick(frame + i * 9.3 + f.x) * Math.PI * 2;
        jagPath(ctx, f.x, f.y, f.x + Math.cos(aa) * 14, f.y + Math.sin(aa) * 14, 3, 3, frame + i * 17);
      }
      ctx.stroke();
      ctx.restore();
    }
  }
  for (const L of lights) {
    if (!inView(L.x, L.y, L.r)) continue;
    let la = L.a, lr = L.r;
    if (darkWorld) {
      // night missions: warm pools (fires, LYTH, lanterns) bloom brighter
      const [cr, , cb] = L.rgb.split(',').map(Number);
      const warm = cr > cb;
      la = Math.min(0.85, la * (warm ? 1.8 : 1.35));
      lr = lr * (warm ? 1.25 : 1.1);
    }
    const lg = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, lr);
    lg.addColorStop(0, `rgba(${L.rgb},${la})`);
    lg.addColorStop(1, `rgba(${L.rgb},0)`);
    ctx.fillStyle = lg;
    ctx.fillRect(L.x - lr, L.y - lr, lr * 2, lr * 2);
  }
  ctx.restore();
  ctx.restore();

  // --- bastion daylight: day must read unmistakably sunlit — a warm
  // additive sun wash plus a cool skylight lift over the whole frame.
  // Night and blood moon keep their full grade untouched; the dusk/dawn
  // ramp (nightK) blends day out smoothly over the cycle's last 6s. ---
  // Family mode forces a sunny day wash regardless of any cycle clock.
  const dayK = familyMode ? 1 : (cycle ? 1 - nightK : 0);
  if (familyMode) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(${FAM.sunWash},0.16)`; // bright warm sunlight
    ctx.fillRect(0, 0, VW, VH);
    ctx.fillStyle = `rgba(${FAM.skyLift},0.10)`; // cheerful sky lift
    ctx.fillRect(0, 0, VW, VH);
    ctx.restore();
  } else if (dayK > 0.01) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,209,130,${0.13 * dayK})`; // warm sun tone
    ctx.fillRect(0, 0, VW, VH);
    ctx.fillStyle = `rgba(126,150,184,${0.07 * dayK})`; // ambient sky lift
    ctx.fillRect(0, 0, VW, VH);
    ctx.restore();
  }

  // --- theme grade: an additive color wash over the whole frame so a lava
  // map glows orange, a toxic map sickly green, etc. Gentle, slow breathing
  // pulse keeps it alive. Skipped entirely on unthemed levels. ---
  if (tpal) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.11 + 0.025 * Math.sin(t * 0.7);
    ctx.fillStyle = `rgba(${tpal.washRgb},${pulse})`;
    ctx.fillRect(0, 0, VW, VH);
    ctx.restore();
  }

  // --- weather: full-screen FX layers riding snap.weather ---
  drawWeather(ctx, VW, VH, snap.weather, t);

  // --- theme ambient particles: cheap full-screen motes keyed to the theme
  // (embers / fallout / fog / snow). Pure functions of t, deterministic. ---
  if (tpal) drawHazardAmbient(ctx, snap, t, VW, VH, tpal);

  // --- vignette (screen space, Void Night; deeper on dark missions, pulled
  // far back under the bastion's daylight). Family mode swaps the dark void
  // vignette for a barely-there warm sun glow at the edges. ---
  if (familyMode) {
    const vg = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.55, VW / 2, VH / 2, VH * 0.95);
    vg.addColorStop(0, `rgba(${FAM.vignette},0)`);
    vg.addColorStop(1, `rgba(${FAM.vignette},0.10)`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VW, VH);
  } else {
    const vg = ctx.createRadialGradient(VW / 2, VH / 2, VH * (darkWorld ? 0.24 : 0.32 + 0.18 * dayK), VW / 2, VH / 2, VH * 0.85);
    vg.addColorStop(0, 'rgba(11,10,20,0)');
    vg.addColorStop(1, `rgba(11,10,20,${darkWorld ? 0.8 : 0.62 - 0.38 * dayK})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VW, VH);
    // themed vignette tint riding on top of the void one (lava reds, toxic
    // greens...). Only on themed levels — plain frames keep the void vignette.
    if (tpal) {
      const tv = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.45, VW / 2, VH / 2, VH * 0.9);
      tv.addColorStop(0, `rgba(${tpal.vignetteRgb},0)`);
      tv.addColorStop(1, `rgba(${tpal.vignetteRgb},0.34)`);
      ctx.fillStyle = tv;
      ctx.fillRect(0, 0, VW, VH);
    }
  }

  // --- bastion sky: the moon climbs as night takes hold ---
  if (cycle && nightK > 0.15) drawMoonGlyph(ctx, VW, nightK, bloodK > 0, t);

  // --- nightwave warning: violet pulse bleeding in from the breached edge
  // (blood moons reuse the pulse in crimson via ep.rgb) ---
  for (const ep of edgePulses) {
    const k = Math.max(0, ep.life / ep.max);
    const a = Math.max(0, k * (0.26 + 0.16 * Math.sin(t * 9))) * (ep.peak ?? 1);
    const th = Math.min(VW, VH) * 0.18;
    const rgb = ep.rgb ?? '142,79,209';
    let eg;
    if (ep.edge === 'n') eg = ctx.createLinearGradient(0, 0, 0, th);
    else if (ep.edge === 's') eg = ctx.createLinearGradient(0, VH, 0, VH - th);
    else if (ep.edge === 'w') eg = ctx.createLinearGradient(0, 0, th, 0);
    else eg = ctx.createLinearGradient(VW, 0, VW - th, 0);
    eg.addColorStop(0, `rgba(${rgb},${a})`);
    eg.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = eg;
    if (ep.edge === 'n') ctx.fillRect(0, 0, VW, th);
    else if (ep.edge === 's') ctx.fillRect(0, VH - th, VW, th);
    else if (ep.edge === 'w') ctx.fillRect(0, 0, th, VH);
    else ctx.fillRect(VW - th, 0, th, VH);
  }

  // --- RELIC AWAKENING thunder flash: a full-screen white crack over the
  // darkened world (drawn before the banners so text stays readable). Driven by
  // lightningT (armed by relicAwaken/hordeBurst, decays fast). ---
  if (lightningT > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(220,225,255,${0.5 * lightningT})`;
    ctx.fillRect(0, 0, VW, VH);
    ctx.restore();
  }

  // --- global screen alerts: single view draws them here (today's op
  // order); splitscreen defers them to the full-canvas pass after the cells ---
  if (globalUi) {
    // screen-space banners (LOW TIME / THE ANCHOR WAKES); p.y stacks extra rows
    for (const p of popups) {
      if (!p.screen) continue;
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.font = `bold ${p.size || 26}px monospace`;
      ctx.textAlign = 'center';
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 14;
      ctx.fillText(p.text, VW / 2, 64 + (p.y || 0));
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;

    // RELIC AWAKENING HUD: the wave timer + the live bonus, center-top
    if (snap.horde && snap.horde.active) drawRelicHud(ctx, VW, snap.horde, t);

    // big blinking countdown (wave inbound / zone shrink / sudden death)
    drawCountdownBanner(ctx, VW, snap, t);

    // beacon pips: the four monoliths' state, always on screen
    if (cores.length > 1) drawBeaconPips(ctx, VW, cores, t);

    // anchor siege: prominent per-team core hp bars (team 0 left, team 1 right)
    if (snap.mode === 'siege' && snap.siege && cores.length) drawSiegeCoreBars(ctx, VW, cores, snap.siege, t);
  }

  // --- offscreen pointers: teammates, stranded captives, the Anchor ---
  for (const p of snap.players) {
    if (p.state !== 'active' || inView(p.x, p.y, -20)) continue;
    const col = charMap[p.charId]?.color || '#fff';
    drawEdgeArrow(ctx, p.x, p.y, col, p.name.toUpperCase().slice(0, 6));
  }
  const farCaptives = snap.captives
    .filter(c => !c.owner && !inView(c.x, c.y, -20))
    .map(c => ({ c, d: (c.x - camera.x) ** 2 + (c.y - camera.y) ** 2 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 6);
  for (const { c } of farCaptives) drawEdgeArrow(ctx, c.x, c.y, '#5fd2b4', 'RESCUE');
  if (exitCols.length) {
    let near = null, best = Infinity;
    for (const e of exitCols) {
      const px = (e.x + 0.5) * TILE, py = (e.y + 0.5) * TILE;
      const d = (px - camera.x) ** 2 + (py - camera.y) ** 2;
      if (d < best) { best = d; near = { px, py }; }
    }
    if (near && !inView(near.px, near.py, -20)) {
      drawEdgeArrow(ctx, near.px, near.py, gateOpen ? PAL.relay : PAL.glitch, 'ANCHOR');
    }
  }
  if (ship?.landed && !inView(ship.x, ship.y, -20)) {
    drawEdgeArrow(ctx, ship.x, ship.y, PAL.lythGold, 'SHIP');
  }

  // siege: point each local seat at the ENEMY anchor (off-screen → edge chevron,
  // on-screen → faint reticle), brighter when that core is OPEN/vulnerable
  if (snap.mode === 'siege' && cores.length) {
    const localTeams = new Set();
    for (const p of snap.players) if (focus.has(p.pid) && p.team != null) localTeams.add((p.team | 0) % 2);
    if (localTeams.size) drawSiegeEnemyAnchor(ctx, camera, cores, snap.siege, localTeams, t);
  }

  // --- respawn pick bars: fallen players choose their next operative
  // (splitscreen: each cell only carries its own seat's pick bar) ---
  let pickRow = 0;
  for (const p of snap.players) {
    if (p.state !== 'pick' || !p.pick?.choices?.length) continue;
    if (!globalUi && view.pid != null && p.pid !== view.pid) continue;
    const ch = charMap[p.pick.choices[Math.min(p.pick.idx, p.pick.choices.length - 1)]];
    if (!ch) continue;
    const label = `${p.name.toUpperCase()}   ◄  ${ch.name.toUpperCase()}  ►   FIRE TO DEPLOY`;
    ctx.font = 'bold 15px monospace';
    const w = ctx.measureText(label).width + 40;
    const y = VH - 56 - pickRow * 40;
    ctx.fillStyle = 'rgba(13,14,24,0.92)';
    ctx.strokeStyle = 'rgba(111,216,242,0.55)';
    ctx.lineWidth = 1;
    ctx.fillRect(VW / 2 - w / 2, y - 21, w, 30);
    ctx.strokeRect(VW / 2 - w / 2, y - 21, w, 30);
    ctx.fillStyle = ch.color;
    ctx.textAlign = 'center';
    ctx.shadowColor = ch.color;
    ctx.shadowBlur = 6;
    ctx.fillText(label, VW / 2, y);
    ctx.shadowBlur = 0;
    pickRow++;
  }

  // --- seat chip: the cell owner's name + hearts, pinned in-cell ---
  if (!globalUi) drawViewChip(ctx, snap, charMap, view, rect);
  poseNs = '';
  if (clipped) ctx.restore();
}

// Name + hearts chip in the lower-left corner of a splitscreen cell, in the
// seat's color (drawn in view-local coords — the cell clip/translate is live).
function drawViewChip(ctx, snap, charMap, view, rect) {
  if (view.pid == null) return;
  const p = (snap.players ?? []).find(pl => pl.pid === view.pid);
  const name = (String(view.name ?? p?.name ?? '').toUpperCase()
    || 'P' + ((view.seat ?? 0) + 1)).slice(0, 10);
  const col = view.color || (p && charMap[p.charId]?.color) || PAL.relay;
  const hearts = p && p.maxHp != null && p.hp != null;
  ctx.save();
  if (p && p.state !== 'active') ctx.globalAlpha = 0.6; // down/picking: dimmed
  ctx.font = 'bold 10px monospace';
  const tw = ctx.measureText(name).width;
  const hw = hearts ? p.maxHp * 7 + 6 : 0;
  const w = tw + hw + 16, h = 18;
  const x = 8, y = rect.h - h - 8;
  ctx.fillStyle = 'rgba(11,10,20,0.82)';
  ctx.strokeStyle = 'rgba(111,216,242,0.45)';
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = col;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, x + 8, y + h / 2 + 0.5);
  if (hearts) drawHeartPips(ctx, x + 8 + tw + 6 + (p.maxHp * 7) / 2, y + h / 2 - 1, p.hp, p.maxHp);
  ctx.restore();
}

// The 3-seat layout's 4th cell: the live field map (fog-aware, objectives),
// reusing drawFullMap with the client-passed fog mask. A ctx proxy narrows
// the perceived canvas to the cell so drawFullMap's own layout math fits.
function drawMapCell(ctx, snap, view, rect) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.translate(rect.x, rect.y);
  ctx.fillStyle = PAL.voidNight;
  ctx.fillRect(0, 0, rect.w, rect.h);
  drawFullMap(viewportCtx(ctx, rect.w, rect.h), snap, view.mask ?? null, view.focus,
    { hint: false, camRect: false }); // a persistent cell: no 'release' hint
  ctx.restore();
}

// A pass-through ctx whose .canvas reports the viewport's size — lets
// full-canvas painters (drawFullMap) render inside a cell unmodified.
function viewportCtx(ctx, w, h) {
  const fakeCanvas = { width: w, height: h };
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop === 'canvas') return fakeCanvas;
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
    set(target, prop, value) { target[prop] = value; return true; },
  });
}

// Splitscreen global pass: screen alerts that belong to the whole couch, not
// a cell — banners (LOW TIME / THE ANCHOR WAKES), the blinking countdown,
// beacon pips. Drawn once, full-canvas, after every viewport has rendered.
function drawGlobalScreenFx(ctx, snap, t, VW, VH) {
  ctx.save();
  // RELIC AWAKENING thunder flash across the whole couch
  if (lightningT > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(220,225,255,${0.5 * lightningT})`;
    ctx.fillRect(0, 0, VW, VH);
    ctx.restore();
  }
  for (const p of popups) {
    if (!p.screen) continue;
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.font = `bold ${p.size || 26}px monospace`;
    ctx.textAlign = 'center';
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 14;
    ctx.fillText(p.text, VW / 2, 64 + (p.y || 0));
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
  if (snap.horde && snap.horde.active) drawRelicHud(ctx, VW, snap.horde, t);
  drawCountdownBanner(ctx, VW, snap, t);
  const cores = snap.cores ?? [];
  if (cores.length > 1) drawBeaconPips(ctx, VW, cores, t);
  if (snap.mode === 'siege' && snap.siege && cores.length) drawSiegeCoreBars(ctx, VW, cores, snap.siege, t);
  ctx.restore();
}

// Thin seam lines over the viewport edges: a 2px Void Night core with a teal
// energy edge on each side. Drawn from the live rects, so the dividers track
// the 0.25s split/merge transition exactly.
function drawDividers(ctx, views, CW, CH) {
  ctx.save();
  for (const v of views) {
    const r = v.rect;
    if (!r || r.w < 1 || r.h < 1) continue;
    if (r.x > 0.5 && r.x < CW - 0.5) { // seam on this cell's left edge
      ctx.fillStyle = PAL.voidNight;
      ctx.fillRect(r.x - 1, r.y, 2, r.h);
      ctx.fillStyle = 'rgba(111,216,242,0.4)';
      ctx.fillRect(r.x - 2, r.y, 1, r.h);
      ctx.fillRect(r.x + 1, r.y, 1, r.h);
    }
    if (r.y > 0.5 && r.y < CH - 0.5) { // seam on this cell's top edge
      ctx.fillStyle = PAL.voidNight;
      ctx.fillRect(r.x, r.y - 1, r.w, 2);
      ctx.fillStyle = 'rgba(111,216,242,0.4)';
      ctx.fillRect(r.x, r.y - 2, r.w, 1);
      ctx.fillRect(r.x, r.y + 1, r.w, 1);
    }
  }
  ctx.restore();
}

// Static minimap backdrop is baked once per level and reused every frame.
const MM_TILE = {
  '.': '#1c242b', ',': '#221C22', ':': '#2A2820', ';': '#272b38', '_': '#15121a',
  '#': '#343A48', 'T': '#23392b', '~': '#101A2E', 'o': '#4A4232', '*': '#F0A93C',
  '=': '#3E3829', '!': '#5A2210', '^': '#243648', '%': '#04040A', 'K': '#3A3F4E',
};
let mmCache = { key: null, canvas: null };
export function renderMinimap(ctx, snap, focusPids) {
  if (!snap.grid) return;
  const focus = focusPids instanceof Set ? focusPids
    : new Set(Array.isArray(focusPids) ? focusPids : [focusPids]);
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const sx = W / (snap.w * TILE), sy = H / (snap.h * TILE);
  const key = snap.grid || snap.name;
  if (mmCache.key !== key) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const mctx = c.getContext('2d');
    mctx.fillStyle = PAL.voidNight;
    mctx.fillRect(0, 0, W, H);
    for (let y = 0; y < snap.h; y++) {
      for (let x = 0; x < snap.w; x++) {
        const col = MM_TILE[snap.grid[y][x]] ?? MM_TILE['.']; // 'E' stays dynamic
        if (!col || snap.grid[y][x] === 'E') continue;
        mctx.fillStyle = col;
        mctx.fillRect(x * TILE * sx, y * TILE * sy, TILE * sx + 0.5, TILE * sy + 0.5);
      }
    }
    mmCache = { key, canvas: c };
  }
  updateExplore(snap); // keep the fog ledger fresh even between renders
  ctx.drawImage(mmCache.canvas, 0, 0);
  // fortified wall segments read as wall pixels (they ARE the base now)
  for (const b of snap.builds ?? []) {
    if (b.kind !== 'wall' || !b.built) continue;
    ctx.fillStyle = '#3E4452';
    ctx.fillRect(Math.floor(b.x / TILE) * TILE * sx, Math.floor(b.y / TILE) * TILE * sy, TILE * sx + 0.5, TILE * sy + 0.5);
  }
  // doors read as wall/gap (terrain-like: under the fog)
  for (const d of snap.doors ?? []) {
    ctx.fillStyle = d.open ? '#1E2028' : (d.sealLock ? '#7A5A1E' : '#343A48');
    ctx.fillRect(d.x * TILE * sx, d.y * TILE * sy, (d.w ?? 1) * TILE * sx + 0.5, (d.h ?? 1) * TILE * sy + 0.5);
  }
  // FOG OF WAR: unexplored ground reads near-black; entity dots only show
  // on scouted tiles (players + mission objectives always show).
  const fog = fogEnabled ? fogLayer() : null;
  if (fog) ctx.drawImage(fog, 0, 0, W, H);
  const dot = (x, y, col, r = 2.5) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x * sx, y * sy, r, 0, Math.PI * 2);
    ctx.fill();
  };
  // the Anchor: live color by gate state (objective: never fogged)
  const gOpen = !snap.gate || snap.gate.open;
  ctx.fillStyle = gOpen ? PAL.relay : PAL.glitch;
  for (const e of exitTiles(snap)) {
    ctx.fillRect(e.x * TILE * sx, e.y * TILE * sy, TILE * sx + 0.5, TILE * sy + 0.5);
  }
  for (const c of snap.crystals ?? []) if (seenAt(c.x, c.y)) dot(c.x, c.y, PAL.lythAmber, 2);
  for (const d of snap.drops ?? []) if (seenAt(d.x, d.y)) dot(d.x, d.y, PAL.lythGold, 1.5);
  for (const b of snap.builds ?? []) {
    if (b.kind === 'wall' && b.built) continue; // already drawn as wall pixels
    if (!seenAt(b.x, b.y)) continue;
    ctx.fillStyle = b.built ? PAL.teal : 'rgba(62,143,224,0.6)';
    ctx.fillRect(b.x * sx - 1.5, b.y * sy - 1.5, 3, 3);
  }
  for (const n of snap.npcs ?? []) if (seenAt(n.x, n.y)) dot(n.x, n.y, PAL.coldHi, 2);
  for (const e of snap.enemies) {
    if (!seenAt(e.x, e.y)) continue;
    if (e.awake === false) ctx.globalAlpha = 0.45;
    dot(e.x, e.y, PAL.red, 2);
    ctx.globalAlpha = 1;
  }
  // frontier entities (all optional)
  for (const pa of snap.patches ?? []) {
    if (!seenAt(pa.x, pa.y)) continue;
    ctx.fillStyle = pa.kind === 'toxin' ? 'rgba(140,200,80,0.45)' : 'rgba(240,140,40,0.45)';
    ctx.beginPath();
    ctx.arc(pa.x * sx, pa.y * sy, Math.max(1.5, (pa.r || TILE) * sx), 0, Math.PI * 2);
    ctx.fill();
  }
  for (const fo of snap.followers ?? []) if (seenAt(fo.x, fo.y)) dot(fo.x, fo.y, PAL.teal, 1.6);
  for (const c of snap.chests ?? []) if (!c.opened && seenAt(c.x, c.y)) dot(c.x, c.y, PAL.lythGold, 1.8);
  for (const tp of snap.teleports ?? []) {
    if (!seenAt(tp.x, tp.y)) continue;
    ctx.strokeStyle = 'rgba(111,216,242,0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(tp.x * sx, tp.y * sy, 2.6, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const sw of snap.switches ?? []) {
    if (!seenAt(sw.x, sw.y)) continue;
    ctx.fillStyle = sw.burned || sw.dead ? '#15121A' : sw.on ? PAL.lythGold : '#5E6B8C';
    ctx.fillRect(sw.x * sx - 1.5, sw.y * sy - 1.5, 3, 3);
  }
  for (const gl of snap.glyphs ?? []) if (seenAt(gl.x, gl.y)) dot(gl.x, gl.y, gl.lit ? PAL.lythGold : '#4A4650', 1.5);
  for (const pi of snap.pillars ?? []) {
    if ((pi.hp ?? 1) <= 0 || !seenAt(pi.x, pi.y)) continue;
    ctx.fillStyle = PAL.moonsteel;
    ctx.fillRect(pi.x * sx - 1.5, pi.y * sy - 2, 3, 4);
  }
  for (const fo2 of snap.forges ?? []) if (seenAt(fo2.x, fo2.y)) dot(fo2.x, fo2.y, PAL.lythAmber, 2.4);
  for (const pk of snap.pickups ?? []) if (seenAt(pk.x, pk.y)) dot(pk.x, pk.y, (PICKUP_STYLE[pk.kind] || {}).col || PAL.lythGold, 2);
  for (const q of snap.qitems ?? []) if (seenAt(q.x, q.y)) dot(q.x, q.y, '#FFEFC2', 2.2);
  for (const tw of snap.towers ?? []) if ((tw.hp ?? 1) > 0 && seenAt(tw.x, tw.y)) dot(tw.x, tw.y, PAL.moonsteel, 2);
  for (const v of snap.vehicles ?? []) if (seenAt(v.x, v.y)) dot(v.x, v.y, '#A9C4CE', 2);
  // objectives: flags, core(s), the landed ship — always visible
  for (const f of snap.flags ?? []) dot(f.x, f.y, TEAM_COL[(f.team ?? 0) % 2], 3);
  if (snap.core) dot(snap.core.x, snap.core.y, PAL.lythAmber, 3.5);
  for (const c2 of snap.cores ?? []) dot(c2.x, c2.y, (c2.hp ?? 0) > 0 ? PAL.lythAmber : '#4A3A5A', 3);
  if (snap.ship) dot(snap.ship.x, snap.ship.y, PAL.anchor, 3.2);
  if (snap.zone?.r) {
    ctx.strokeStyle = 'rgba(111,216,242,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(snap.zone.x * sx, snap.zone.y * sy, snap.zone.r * sx, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const c of snap.captives) if (!c.owner && seenAt(c.x, c.y)) dot(c.x, c.y, '#5fd2b4');
  // music box: the altar (gold) and every still-loose fragment (amethyst);
  // carried + placed fragments clear, matching the captive-ping precedent
  if (snap.musicBox) {
    if (seenAt(snap.musicBox.altar.x, snap.musicBox.altar.y)) dot(snap.musicBox.altar.x, snap.musicBox.altar.y, '#d6a8ff', 3);
    for (const f of snap.musicBox.fragments ?? []) {
      if (!f.placed && f.carrier == null && seenAt(f.x, f.y)) dot(f.x, f.y, '#be78ff', 2.5);
    }
  }
  for (const p of snap.players) if (p.state === 'active') dot(p.x, p.y, focus.has(p.pid) ? '#ffffff' : PAL.relay, 3);
  // camera viewport rectangle
  ctx.strokeStyle = 'rgba(191,208,232,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(
    (cam.x - cam.vw / 2 / cam.z) * sx,
    (cam.y - cam.vh / 2 / cam.z) * sy,
    (cam.vw / cam.z) * sx,
    (cam.vh / cam.z) * sy
  );
  ctx.strokeStyle = 'rgba(54,160,138,0.35)';
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
}

// ============================== FULL MAP OVERLAY ==============================
// Held-map view ('map' input: pad Select, Tab/M): a large centered field map
// over the dimmed game — terrain, fog, entities, objectives, camera rect.
// The client calls this on top of its normal frame while the button is held;
// pass mask=null to use the renderer's own exploration ledger.
let fmCache = { key: null, canvas: null };
export function drawFullMap(ctx, snap, mask, focus, opts = {}) {
  if (!snap?.grid) return;
  updateExplore(snap);
  const m = mask ?? (fogEnabled ? explore.mask : null); // fog off: internal path shows all
  const seen2 = (wx, wy) => {
    if (!m) return true;
    const x = Math.max(0, Math.min(snap.w - 1, Math.floor(wx / TILE)));
    const y = Math.max(0, Math.min(snap.h - 1, Math.floor(wy / TILE)));
    return m[y * snap.w + x] === 1;
  };
  const fset = focus instanceof Set ? focus
    : new Set(Array.isArray(focus) ? focus : focus != null ? [focus] : []);
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.save();
  // dim the live game beneath
  ctx.fillStyle = 'rgba(6,7,14,0.78)';
  ctx.fillRect(0, 0, W, H);
  // centered map rect, aspect preserved
  const sc = Math.min((W * 0.86) / (snap.w * TILE), (H * 0.78) / (snap.h * TILE));
  const mw = snap.w * TILE * sc, mh = snap.h * TILE * sc;
  const ox = (W - mw) / 2, oy = (H - mh) / 2 + H * 0.015;
  const px = (wx) => ox + wx * sc, py = (wy) => oy + wy * sc;
  // frame plate
  ctx.fillStyle = 'rgba(13,14,24,0.95)';
  ctx.fillRect(ox - 10, oy - 10, mw + 20, mh + 20);
  ctx.strokeStyle = 'rgba(111,216,242,0.5)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(ox - 10, oy - 10, mw + 20, mh + 20);
  // terrain backdrop, baked once per level at 1px/tile and scaled crisp
  const key = snap.grid || snap.name;
  if (fmCache.key !== key) {
    const c = document.createElement('canvas');
    c.width = snap.w; c.height = snap.h;
    const fctx = c.getContext('2d');
    fctx.fillStyle = PAL.voidNight;
    fctx.fillRect(0, 0, snap.w, snap.h);
    for (let y = 0; y < snap.h; y++) {
      for (let x = 0; x < snap.w; x++) {
        const ch2 = snap.grid[y][x];
        if (ch2 === 'E') continue;
        fctx.fillStyle = MM_TILE[ch2] ?? MM_TILE['.'];
        fctx.fillRect(x, y, 1, 1);
      }
    }
    fmCache = { key, canvas: c };
  }
  const smoothWas = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false; // chunky cartographic tiles
  ctx.drawImage(fmCache.canvas, ox, oy, mw, mh);
  // walls + doors over the terrain
  const cell = TILE * sc;
  for (const b of snap.builds ?? []) {
    if (b.kind !== 'wall' || !b.built) continue;
    ctx.fillStyle = '#3E4452';
    ctx.fillRect(px(Math.floor(b.x / TILE) * TILE), py(Math.floor(b.y / TILE) * TILE), cell + 0.5, cell + 0.5);
  }
  for (const d of snap.doors ?? []) {
    ctx.fillStyle = d.open ? '#1E2028' : (d.sealLock ? '#7A5A1E' : '#343A48');
    ctx.fillRect(px(d.x * TILE), py(d.y * TILE), (d.w ?? 1) * cell + 0.5, (d.h ?? 1) * cell + 0.5);
  }
  // fog over everything terrain-like
  if (m && explore.mask === m) {
    const fog = fogLayer();
    if (fog) { ctx.imageSmoothingEnabled = true; ctx.drawImage(fog, ox, oy, mw, mh); }
  } else if (m) {
    // explicit external mask: cover unexplored tiles directly
    ctx.fillStyle = 'rgba(4,4,9,0.95)';
    for (let y = 0; y < snap.h; y++) {
      for (let x = 0; x < snap.w; x++) {
        if (!m[y * snap.w + x]) ctx.fillRect(px(x * TILE), py(y * TILE), cell + 0.6, cell + 0.6);
      }
    }
  }
  ctx.imageSmoothingEnabled = smoothWas;
  const ds = Math.max(2, cell * 0.42); // dot scale
  const dot = (wx, wy, col, k = 1) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(px(wx), py(wy), ds * k, 0, Math.PI * 2);
    ctx.fill();
  };
  // scouted entities
  for (const c of snap.crystals ?? []) if (seen2(c.x, c.y)) dot(c.x, c.y, PAL.lythAmber, 0.7);
  for (const b of snap.builds ?? []) {
    if ((b.kind === 'wall' && b.built) || !seen2(b.x, b.y)) continue;
    ctx.fillStyle = b.built ? PAL.teal : 'rgba(62,143,224,0.6)';
    ctx.fillRect(px(b.x) - ds * 0.6, py(b.y) - ds * 0.6, ds * 1.2, ds * 1.2);
  }
  for (const n of snap.npcs ?? []) if (seen2(n.x, n.y)) dot(n.x, n.y, PAL.coldHi, 0.7);
  for (const c of snap.chests ?? []) if (!c.opened && seen2(c.x, c.y)) dot(c.x, c.y, PAL.lythGold, 0.6);
  for (const tw of snap.towers ?? []) if ((tw.hp ?? 1) > 0 && seen2(tw.x, tw.y)) dot(tw.x, tw.y, PAL.moonsteel, 0.7);
  for (const pk of snap.pickups ?? []) if (seen2(pk.x, pk.y)) dot(pk.x, pk.y, (PICKUP_STYLE[pk.kind] || {}).col || PAL.lythGold, 0.7);
  for (const q of snap.qitems ?? []) if (seen2(q.x, q.y)) dot(q.x, q.y, '#FFEFC2', 0.7);
  for (const tp of snap.teleports ?? []) {
    if (!seen2(tp.x, tp.y)) continue;
    ctx.strokeStyle = 'rgba(111,216,242,0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(px(tp.x), py(tp.y), ds, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const e of snap.enemies ?? []) {
    if (!seen2(e.x, e.y)) continue;
    ctx.globalAlpha = e.awake === false ? 0.45 : 1;
    dot(e.x, e.y, PAL.red, e.kind === 'boss' ? 1.1 : 0.6);
    ctx.globalAlpha = 1;
  }
  for (const c of snap.captives ?? []) if (!c.owner && seen2(c.x, c.y)) dot(c.x, c.y, '#5fd2b4', 0.9);
  // objective markers, labeled — these never fog out
  ctx.font = `bold ${Math.max(9, Math.round(H / 64))}px monospace`;
  ctx.textAlign = 'center';
  const exits = exitTiles(snap);
  if (exits.length) {
    let ax = 0, ay = 0;
    for (const e of exits) { ax += (e.x + 0.5) * TILE; ay += (e.y + 0.5) * TILE; }
    ax /= exits.length; ay /= exits.length;
    const open = !snap.gate || snap.gate.open;
    ctx.save();
    ctx.translate(px(ax), py(ay));
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = open ? PAL.relay : PAL.glitch;
    ctx.fillRect(-ds, -ds, ds * 2, ds * 2);
    ctx.restore();
    ctx.fillStyle = open ? PAL.relay : PAL.glitch;
    ctx.fillText('ANCHOR', px(ax), py(ay) - ds - 4);
  }
  const allCores = snap.cores ?? (snap.core ? [snap.core] : []);
  for (const c2 of allCores) {
    const lit = (c2.hp ?? 0) > 0;
    ctx.fillStyle = lit ? PAL.lythAmber : '#4A3A5A';
    ctx.fillRect(px(c2.x) - ds * 0.8, py(c2.y) - ds * 1.3, ds * 1.6, ds * 2.6);
    if (!lit) {
      ctx.fillStyle = 'rgba(142,79,209,0.9)';
      ctx.fillText('DARK', px(c2.x), py(c2.y) - ds * 1.3 - 3);
    }
  }
  for (const f of snap.flags ?? []) {
    ctx.fillStyle = TEAM_COL[(f.team ?? 0) % 2];
    ctx.beginPath();
    ctx.moveTo(px(f.x), py(f.y) - ds * 1.6);
    ctx.lineTo(px(f.x) + ds * 1.4, py(f.y) - ds * 0.8);
    ctx.lineTo(px(f.x), py(f.y));
    ctx.closePath(); ctx.fill();
  }
  if (snap.ship) {
    dot(snap.ship.x, snap.ship.y, PAL.anchor, 1.2);
    ctx.fillStyle = PAL.anchor;
    ctx.fillText('SHIP', px(snap.ship.x), py(snap.ship.y) - ds - 4);
  }
  if (snap.zone?.r) {
    ctx.strokeStyle = 'rgba(111,216,242,0.8)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(px(snap.zone.x), py(snap.zone.y), snap.zone.r * sc, 0, Math.PI * 2);
    ctx.stroke();
  }
  // players: focus seats in white, squadmates in relay cyan, named
  for (const p of snap.players ?? []) {
    if (p.state !== 'active') continue;
    const isFocus = fset.has(p.pid);
    dot(p.x, p.y, isFocus ? '#FFFFFF' : PAL.relay, isFocus ? 1.1 : 0.9);
    ctx.fillStyle = isFocus ? '#FFFFFF' : 'rgba(191,208,232,0.85)';
    ctx.fillText(String(p.name ?? '').toUpperCase().slice(0, 8), px(p.x), py(p.y) - ds - 4);
  }
  // camera rect (suppressed in a splitscreen map cell: no single camera)
  if (opts.camRect !== false) {
    ctx.strokeStyle = 'rgba(191,208,232,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      px(cam.x - cam.vw / 2 / cam.z), py(cam.y - cam.vh / 2 / cam.z),
      (cam.vw / cam.z) * sc, (cam.vh / cam.z) * sc);
  }
  // header + hint (the hold-to-view hint is dropped for persistent map cells)
  ctx.font = `bold ${Math.max(13, Math.round(H / 38))}px monospace`;
  ctx.fillStyle = PAL.anchor;
  ctx.fillText(`${String(snap.name ?? 'FIELD').toUpperCase()} — FIELD MAP`, W / 2, oy - 20);
  if (opts.hint !== false) {
    ctx.font = `bold ${Math.max(9, Math.round(H / 60))}px monospace`;
    ctx.fillStyle = 'rgba(138,152,184,0.85)';
    ctx.fillText('RELEASE TO CLOSE', W / 2, oy + mh + 18);
  }
  ctx.restore();
}

// ============================== STORY CUTSCENES ==============================
// Full-canvas vector story art, one scene per ART_KEY, all in the Monolythium
// palette. Everything is a pure function of (W, H, t) — deterministic layouts
// from flick(), subtle drift/pulse animation from t. The client owns the slide
// state machine; we only paint.

function csSky(ctx, W, H, top, bottom, end = 1) {
  const g = ctx.createLinearGradient(0, 0, 0, H * end);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H * end + 1);
}

function csStars(ctx, W, H, n, t, hMax = 0.6, seed = 0) {
  for (let i = 0; i < n; i++) {
    const tw = 0.5 + 0.5 * Math.sin(t * (0.4 + flick(seed + i * 4.9) * 1.1) + i * 2.4);
    ctx.fillStyle = `rgba(223,243,255,${(0.08 + 0.4 * flick(seed + i * 3.3)) * tw})`;
    const s = flick(seed + i * 5.1) < 0.1 ? 2 : 1.3;
    ctx.fillRect(flick(seed + i * 1.37) * W, flick(seed + i * 2.11) * H * hMax, s, s);
  }
}

function csMotes(ctx, W, H, n, rgb, t, drift = 10, rise = 5, seed = 0) {
  for (let i = 0; i < n; i++) {
    const sp = 0.4 + flick(seed + i * 2.3);
    const x = (((flick(seed + i * 1.7) * (W + 60) + t * drift * sp) % (W + 60)) + W + 60) % (W + 60) - 30;
    const y = (((flick(seed + i * 3.1) * (H + 60) - t * rise * sp) % (H + 60)) + H + 60) % (H + 60) - 30;
    const a = (0.08 + 0.22 * flick(seed + i * 6.7)) * (0.7 + 0.3 * Math.sin(t * 1.3 + i));
    ctx.fillStyle = `rgba(${rgb},${a})`;
    ctx.beginPath();
    ctx.arc(x, y, 1 + flick(seed + i * 8.9) * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function csRidge(ctx, W, H, baseY, amp, color, seed) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-10, H + 10);
  ctx.lineTo(-10, baseY);
  const steps = 26;
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * (W + 20) - 10;
    const y = baseY - amp * (0.25 + 0.75 * flick(seed + i * 0.73)) * (0.6 + 0.4 * Math.sin(i * 1.9 + seed));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W + 10, H + 10);
  ctx.closePath();
  ctx.fill();
}

function csGlow(ctx, x, y, r, rgb, a) {
  if (r <= 0 || a <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function csMonolith(ctx, x, baseY, w, h, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, baseY);
  ctx.lineTo(x - w * 0.36, baseY - h);
  ctx.lineTo(x + w * 0.36, baseY - h);
  ctx.lineTo(x + w / 2, baseY);
  ctx.closePath();
  ctx.fill();
}

// ANCHORCRAFT — the crew's vessel hanging over the dark frontier.
function artAnchorcraft(ctx, W, H, t) {
  csSky(ctx, W, H, '#0B0A14', '#10131F');
  csStars(ctx, W, H, 90, t, 0.75);
  csGlow(ctx, W * 0.18, H * 0.16, H * 0.3, '94,107,140', 0.16); // moon haze
  csRidge(ctx, W, H, H * 0.78, H * 0.07, '#11141D', 31);
  csRidge(ctx, W, H, H * 0.86, H * 0.05, '#0D0F17', 47);
  ctx.fillStyle = '#0B0C12';
  ctx.fillRect(0, H * 0.92, W, H * 0.08);
  // far settlement embers on the dark land
  for (let i = 0; i < 5; i++) {
    const fx = W * (0.1 + 0.8 * flick(61 + i * 3.7));
    ctx.fillStyle = `rgba(240,169,60,${0.25 + 0.3 * flick(i * 9.1) * (0.6 + 0.4 * Math.sin(t * 2 + i))})`;
    ctx.fillRect(fx, H * (0.83 + 0.06 * flick(62 + i * 5.3)), 2, 2);
  }
  // the vessel, riding the night wind
  const cx = W * 0.52, cy = H * 0.34 + Math.sin(t * 0.8) * H * 0.012;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.sin(t * 0.5) * 0.015);
  const s = Math.min(W, H) / 720;
  ctx.scale(s, s);
  csGlow(ctx, 0, 150, 190, '111,216,242', 0.05); // downwash
  ctx.fillStyle = PAL.graphDark;
  ctx.beginPath();
  ctx.moveTo(-170, 6); ctx.lineTo(-120, -34); ctx.lineTo(120, -34);
  ctx.lineTo(178, 2); ctx.lineTo(120, 30); ctx.lineTo(-120, 30);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PAL.graphPlate;
  ctx.beginPath();
  ctx.moveTo(-170, 6); ctx.lineTo(-120, -34); ctx.lineTo(120, -34);
  ctx.lineTo(178, 2); ctx.lineTo(120, -6); ctx.lineTo(-120, -6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#3A4050';
  ctx.fillRect(-58, -58, 116, 28); // cabin
  ctx.strokeStyle = 'rgba(138,152,184,0.7)'; // moonsteel rim
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-168, 4); ctx.lineTo(-120, -33); ctx.lineTo(120, -33);
  ctx.stroke();
  ctx.fillStyle = PAL.relay; // window strip
  ctx.shadowColor = PAL.relay;
  ctx.shadowBlur = 12;
  ctx.fillRect(-48, -48, 96, 5);
  ctx.shadowBlur = 0;
  for (const ex of [-96, 96]) { // engine pods
    ctx.fillStyle = PAL.graphDark;
    ctx.fillRect(ex - 18, 26, 36, 14);
    const fa = 0.5 + 0.4 * flick(Math.floor(t * 14) + ex);
    ctx.fillStyle = `rgba(223,243,255,${fa})`;
    ctx.shadowColor = PAL.relay;
    ctx.shadowBlur = 16;
    ctx.fillRect(ex - 12, 40, 24, 5);
    ctx.shadowBlur = 0;
    csGlow(ctx, ex, 58, 60, '111,216,242', 0.12 * fa);
  }
  if (fract(t * 0.7) < 0.12) { // gold nav beacon blink
    ctx.fillStyle = PAL.lythGold;
    ctx.shadowColor = PAL.lythGold;
    ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(172, 0, 3, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
  csMotes(ctx, W, H, 24, '94,107,140', t, 14, 4, 5);
}

// CROSSING — the meadow road toward a distant dormant monolith.
function artCrossing(ctx, W, H, t) {
  csSky(ctx, W, H, '#0B0A14', '#141B28', 0.55);
  csStars(ctx, W, H, 70, t, 0.5);
  const horizon = H * 0.52;
  const mg = ctx.createLinearGradient(0, horizon, 0, H);
  mg.addColorStop(0, '#1B2530');
  mg.addColorStop(1, '#10161D');
  ctx.fillStyle = mg;
  ctx.fillRect(0, horizon, W, H - horizon);
  // the dormant monolith on the horizon
  const mx = W * 0.62;
  csGlow(ctx, mx, horizon - H * 0.13, H * 0.2, '90,46,140', 0.08);
  csMonolith(ctx, mx, horizon + 2, W * 0.05, H * 0.26, '#101321');
  ctx.strokeStyle = `rgba(90,46,140,${0.25 + 0.18 * Math.sin(t * 1.1)})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mx - W * 0.008, horizon - H * 0.24);
  ctx.lineTo(mx - W * 0.002, horizon - H * 0.17);
  ctx.lineTo(mx - W * 0.012, horizon - H * 0.1);
  ctx.stroke();
  // the road, converging on the monolith's feet
  ctx.fillStyle = '#232936';
  ctx.beginPath();
  ctx.moveTo(W * 0.18, H + 4);
  ctx.quadraticCurveTo(W * 0.42, H * 0.78, mx - W * 0.01, horizon + 2);
  ctx.lineTo(mx + W * 0.012, horizon + 2);
  ctx.quadraticCurveTo(W * 0.62, H * 0.8, W * 0.58, H + 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(11,10,20,0.55)'; // wheel rut
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W * 0.27, H + 4);
  ctx.quadraticCurveTo(W * 0.46, H * 0.8, mx, horizon + 3);
  ctx.stroke();
  // grass tufts, denser up close
  for (let i = 0; i < 60; i++) {
    const gx = flick(i * 1.9) * W;
    const gy = horizon + flick(i * 3.7) * (H - horizon);
    const sc = (gy - horizon) / (H - horizon);
    ctx.fillStyle = flick(i * 5.3) < 0.5 ? 'rgba(50,74,64,0.8)' : 'rgba(61,90,74,0.8)';
    ctx.fillRect(gx, gy, 1.5, 2 + sc * 5);
  }
  // fireflies low over the meadow
  for (let i = 0; i < 12; i++) {
    const fx = W * fract(flick(i * 7.7) + t * 0.01 * (0.5 + flick(i)));
    const fy = horizon + (H - horizon) * (0.25 + 0.6 * flick(i * 4.1)) + Math.sin(t * 1.6 + i * 2.2) * 6;
    const fa = Math.max(0, Math.sin(t * (0.8 + flick(i * 9.3)) + i * 5)) * 0.5;
    if (fa > 0.04) csGlow(ctx, fx, fy, 9, '255,217,138', fa * 0.5);
    ctx.fillStyle = `rgba(255,239,194,${fa})`;
    ctx.fillRect(fx, fy, 1.6, 1.6);
  }
  csMotes(ctx, W, H, 14, '94,107,140', t, 9, 3, 11);
}

// BASIN — drowned LYTH refinery, warm crystal light in black water.
function artBasin(ctx, W, H, t) {
  csSky(ctx, W, H, '#0B0A14', '#0E1420', 0.46);
  csStars(ctx, W, H, 40, t, 0.4);
  const wl = H * 0.46; // waterline
  const towers = [
    [0.12, 0.3, 0.05], [0.2, 0.18, 0.035], [0.34, 0.36, 0.06],
    [0.55, 0.24, 0.04], [0.7, 0.42, 0.07], [0.84, 0.2, 0.045],
  ];
  ctx.fillStyle = '#13151F';
  for (const [fx, fh, fw] of towers) ctx.fillRect(W * fx, wl - H * fh, W * fw, H * fh + 4);
  ctx.strokeStyle = '#181B28'; // gantry truss
  ctx.lineWidth = Math.max(2, H * 0.008);
  ctx.beginPath();
  ctx.moveTo(W * 0.145, wl - H * 0.22); ctx.lineTo(W * 0.37, wl - H * 0.27);
  ctx.moveTo(W * 0.59, wl - H * 0.18); ctx.lineTo(W * 0.73, wl - H * 0.3);
  ctx.stroke();
  ctx.strokeStyle = '#161926'; // broken pipe arcing into the water
  ctx.lineWidth = Math.max(3, H * 0.012);
  ctx.beginPath();
  ctx.arc(W * 0.47, wl, H * 0.13, Math.PI, Math.PI * 1.85);
  ctx.stroke();
  // black water
  const wg = ctx.createLinearGradient(0, wl, 0, H);
  wg.addColorStop(0, '#0A111E');
  wg.addColorStop(1, '#06090F');
  ctx.fillStyle = wg;
  ctx.fillRect(0, wl, W, H - wl);
  ctx.fillStyle = 'rgba(19,21,31,0.55)'; // tower reflections
  for (const [fx, fh, fw] of towers) ctx.fillRect(W * fx, wl, W * fw, H * fh * 0.5);
  // crystal clusters glowing under the surface
  const nodes = [[0.28, 0.62], [0.5, 0.74], [0.66, 0.58], [0.81, 0.7]];
  nodes.forEach(([fx, fy], i) => {
    const cx = W * fx, cy = H * fy;
    const pulse = 0.8 + 0.2 * Math.sin(t * 1.4 + i * 2.1);
    csGlow(ctx, cx, cy, H * 0.09 * pulse, '240,169,60', 0.22);
    for (let k = 0; k < 3; k++) {
      const ox = (flick(i * 13 + k * 7) - 0.5) * H * 0.05;
      const hh = H * (0.02 + 0.025 * flick(i * 17 + k * 3));
      ctx.fillStyle = k === 1 ? PAL.lythGold : PAL.lythAmber;
      ctx.beginPath();
      ctx.moveTo(cx + ox - hh * 0.3, cy + 4);
      ctx.lineTo(cx + ox, cy - hh);
      ctx.lineTo(cx + ox + hh * 0.3, cy + 4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = `rgba(255,217,138,${0.1 + 0.05 * Math.sin(t * 2.3 + i)})`;
    for (let k = 0; k < 4; k++) {
      const sy = cy + 10 + k * 9 + Math.sin(t * 1.8 + k + i) * 2;
      ctx.fillRect(cx - 14 + flick(i + k * 5) * 8, sy, 22, 1.5);
    }
  });
  // waterline sheen + slow laps
  ctx.fillStyle = 'rgba(94,107,140,0.18)';
  ctx.fillRect(0, wl - 1, W, 1.5);
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = `rgba(94,107,140,${0.05 + 0.05 * Math.sin(t * 1.2 + i * 1.7)})`;
    ctx.fillRect(flick(i * 3.3) * W, wl + 4 + flick(i * 7.1) * (H - wl) * 0.8, 30 + flick(i) * 50, 1.2);
  }
  csGlow(ctx, W * 0.5, wl + H * 0.06, W * 0.42, '94,107,140', 0.05); // low mist
  csMotes(ctx, W, H, 16, '255,217,138', t, 6, 7, 23);
}

// QUORUM — a field of dead relay pylons; one still answers.
function artQuorum(ctx, W, H, t) {
  csSky(ctx, W, H, '#0B0A14', '#10131D', 0.6);
  csStars(ctx, W, H, 60, t, 0.55);
  const horizon = H * 0.58;
  const gg = ctx.createLinearGradient(0, horizon, 0, H);
  gg.addColorStop(0, '#141622');
  gg.addColorStop(1, '#0D0E16');
  ctx.fillStyle = gg;
  ctx.fillRect(0, horizon, W, H - horizon);
  let live = null;
  for (let row = 0; row < 5; row++) {
    const depth = row / 4; // 0 = far, 1 = near
    const py = horizon + (H - horizon) * (0.06 + 0.9 * depth * depth);
    const ph = H * (0.05 + 0.2 * depth);
    const n = 7 - row;
    const c = mix('#1B1E2B', '#12141E', depth);
    for (let i = 0; i < n; i++) {
      const px = W * ((i + 0.5) / n + (flick(row * 11 + i * 3.1) - 0.5) * 0.06);
      ctx.strokeStyle = c;
      ctx.lineWidth = Math.max(1, 3 * depth);
      ctx.beginPath();
      ctx.moveTo(px, py); ctx.lineTo(px, py - ph);
      ctx.moveTo(px - ph * 0.16, py - ph * 0.78); ctx.lineTo(px + ph * 0.16, py - ph * 0.78);
      ctx.stroke();
      ctx.fillStyle = c; // dead head
      ctx.beginPath();
      ctx.arc(px, py - ph, Math.max(1.5, ph * 0.05), 0, Math.PI * 2);
      ctx.fill();
      if (row === 2 && i === 2) live = { x: px, y: py - ph, py };
    }
  }
  // the one that still answers — flickering relay cyan
  if (live) {
    const on = flick(Math.floor(t * 9)) > 0.35;
    ctx.fillStyle = `rgba(111,216,242,${on ? 0.85 : 0.12})`;
    ctx.shadowColor = PAL.relay;
    ctx.shadowBlur = on ? 16 : 4;
    ctx.beginPath(); ctx.arc(live.x, live.y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    if (on) {
      csGlow(ctx, live.x, live.y, H * 0.09, '111,216,242', 0.2);
      csGlow(ctx, live.x, live.py, H * 0.05, '111,216,242', 0.1); // ground catch
    }
  }
  // entropy haze creeping at the field's edges
  csGlow(ctx, W * 0.03, H * 0.8, H * 0.25, '90,46,140', 0.07);
  csGlow(ctx, W * 0.97, H * 0.75, H * 0.22, '90,46,140', 0.06);
  csMotes(ctx, W, H, 18, '94,107,140', t, 8, 4, 31);
}

// FORKFALL — a city skyline duplicated and mirrored, split by a glitch seam.
function artForkfall(ctx, W, H, t) {
  csSky(ctx, W, H, '#0B0A14', '#131022', 0.75);
  csStars(ctx, W, H, 46, t, 0.45);
  const base = H * 0.66;
  const frame = Math.floor(t * 8);
  // deterministic building strip
  const bld = [];
  let bx0 = -W * 0.02, bi = 0;
  while (bx0 < W * 1.02) {
    const bw = W * (0.025 + 0.05 * flick(bi * 3.7 + 1));
    const bh = H * (0.08 + 0.3 * flick(bi * 2.9 + 2));
    bld.push([bx0, bw, bh, bi]);
    bx0 += bw + W * 0.008;
    bi++;
  }
  // the phantom duplicate, hanging mirrored from the sky
  ctx.save();
  ctx.globalAlpha = 0.45;
  const joff = (flick(frame * 1.7) - 0.5) * W * 0.012 + W * 0.012;
  ctx.fillStyle = '#1B1430';
  for (const [bx, bw, bh] of bld) ctx.fillRect(bx + joff, H * 0.06, bw, bh * 0.8);
  ctx.restore();
  csGlow(ctx, W * 0.5, H * 0.3, H * 0.3, '90,46,140', 0.06); // haze between the forks
  // the real city
  for (const [bx, bw, bh, k] of bld) {
    const gl = bx > W * 0.56; // beyond the seam, reality stutters
    const ox = gl ? (flick(k * 7 + frame) - 0.5) * 7 : 0;
    ctx.fillStyle = gl ? '#171229' : '#14161F';
    ctx.fillRect(bx + ox, base - bh, bw, bh);
    if (flick(k * 5.1) < 0.5) {
      const wn = 1 + Math.floor(flick(k * 8.3) * 3);
      for (let wI = 0; wI < wn; wI++) {
        const wx = bx + ox + bw * (0.2 + 0.6 * flick(k * 11 + wI * 3));
        const wy = base - bh * (0.15 + 0.7 * flick(k * 13 + wI * 5));
        ctx.fillStyle = flick(k + wI) < 0.7 ? 'rgba(255,217,138,0.7)' : 'rgba(111,216,242,0.7)';
        ctx.fillRect(wx, wy, 2, 2.5);
      }
    }
  }
  ctx.fillStyle = '#0D0E16';
  ctx.fillRect(0, base, W, H - base);
  // THE SEAM — a vertical violet tear with static shards
  const sx = W * 0.56 + Math.sin(t * 0.7) * 2;
  csGlow(ctx, sx, H * 0.45, H * 0.34, '142,79,209', 0.16);
  ctx.strokeStyle = `rgba(142,79,209,${0.5 + 0.3 * flick(frame)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  let yy = H * 0.06;
  ctx.moveTo(sx, yy);
  while (yy < H * 0.95) {
    yy += H * 0.07;
    ctx.lineTo(sx + (flick(Math.floor(yy) + frame) - 0.5) * 10, yy);
  }
  ctx.stroke();
  for (let k = 0; k < 26; k++) {
    const by = H * (0.08 + 0.85 * flick(k * 3.3 + frame * 0.13));
    const bw2 = 3 + flick(k * 7.7 + frame) * 16;
    const off = (flick(k * 1.9 + frame) - 0.5) * 36;
    const colr = flick(k + frame) < 0.18 ? '191,251,255' : '142,79,209';
    ctx.fillStyle = `rgba(${colr},${0.12 + 0.3 * flick(k * 5.1 + frame)})`;
    ctx.fillRect(sx + off, by, bw2, 2 + flick(k) * 3);
  }
  csMotes(ctx, W, H, 14, '142,79,209', t, 7, 6, 41);
}

// SIEGE — torchlight on the palisade against a violet tide.
function artSiege(ctx, W, H, t) {
  csSky(ctx, W, H, '#0B0A14', '#160D24', 0.65);
  csStars(ctx, W, H, 30, t, 0.35);
  const horizon = H * 0.52;
  const tg = ctx.createLinearGradient(0, horizon - H * 0.16, 0, horizon + H * 0.1);
  tg.addColorStop(0, 'rgba(20,9,31,0)');
  tg.addColorStop(1, 'rgba(90,46,140,0.5)');
  ctx.fillStyle = tg;
  ctx.fillRect(0, horizon - H * 0.16, W, H * 0.26);
  ctx.fillStyle = '#14091F';
  ctx.fillRect(0, horizon, W, H * 0.12);
  // a hundred watching eyes, shifting with the tide
  for (let i = 0; i < 70; i++) {
    if (flick(i * 3.7 + Math.floor(t * 2.5)) < 0.35) continue;
    const ex = W * flick(i * 1.31);
    const ey = horizon - H * 0.02 + H * 0.1 * flick(i * 2.17);
    ctx.fillStyle = `rgba(191,251,255,${0.25 + 0.6 * flick(i * 5.3)})`;
    const es = 1 + flick(i * 7.7);
    ctx.fillRect(ex, ey, es, es);
    if (flick(i * 9.1) < 0.12) ctx.fillRect(ex + es + 1.5, ey, es, es); // paired eyes
  }
  // trampled dark field between tide and wall
  const fg = ctx.createLinearGradient(0, horizon + H * 0.1, 0, H);
  fg.addColorStop(0, '#171522');
  fg.addColorStop(1, '#100E16');
  ctx.fillStyle = fg;
  ctx.fillRect(0, horizon + H * 0.1, W, H);
  // defenders' helmets just above the wall line
  for (const fx of [0.3, 0.62]) {
    const hx = W * fx, hy = H * 0.815;
    ctx.fillStyle = '#232533';
    ctx.beginPath(); ctx.arc(hx, hy, H * 0.014, Math.PI, 0); ctx.fill();
    ctx.fillStyle = PAL.relay;
    ctx.fillRect(hx - H * 0.008, hy - H * 0.004, H * 0.016, 2);
  }
  // the palisade across the foreground
  const py = H * 0.86;
  ctx.fillStyle = '#100D0B';
  ctx.fillRect(0, py - H * 0.02, W, H);
  for (let i = 0; i < 42; i++) {
    const sxp = (i / 41) * W + (flick(i * 1.7) - 0.5) * 6;
    const sh = H * (0.13 + 0.05 * flick(i * 2.3));
    const sw = W * 0.012;
    ctx.fillStyle = i % 2 ? '#1A140F' : '#15110D';
    ctx.beginPath();
    ctx.moveTo(sxp - sw, py);
    ctx.lineTo(sxp - sw, py - sh);
    ctx.lineTo(sxp, py - sh - H * 0.02);
    ctx.lineTo(sxp + sw, py - sh);
    ctx.lineTo(sxp + sw, py);
    ctx.closePath();
    ctx.fill();
  }
  // torches along the wall — warm light against the violet
  for (const fx of [0.16, 0.5, 0.84]) {
    const tx = W * fx, ty = py - H * 0.17;
    ctx.strokeStyle = '#221C12';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(tx, py - H * 0.05); ctx.lineTo(tx, ty); ctx.stroke();
    const j = flick(Math.floor(t * 9) + tx);
    ctx.fillStyle = PAL.lythAmber;
    tear(ctx, tx, ty - 6, 4 + j * 2, 11 + j * 5);
    ctx.fillStyle = PAL.lythGold;
    tear(ctx, tx, ty - 5, 2.6, 7 + j * 3);
    csGlow(ctx, tx, ty - 6, H * 0.1 * (0.9 + j * 0.2), '240,169,60', 0.22);
  }
  csMotes(ctx, W, H, 16, '142,79,209', t, 10, 6, 53);
}

// SETTLEMENT — the last great Anchor, half-lit over its town.
function artSettlement(ctx, W, H, t) {
  csSky(ctx, W, H, '#0B0A14', '#11131F', 0.8);
  csStars(ctx, W, H, 80, t, 0.7);
  const baseY = H * 0.82;
  const mx = W * 0.5, mw = W * 0.13, mh = H * 0.62;
  csGlow(ctx, mx - mw * 0.4, baseY - mh * 0.7, mh * 0.55, '111,216,242', 0.07);
  csMonolith(ctx, mx, baseY, mw, mh, '#171A26');
  // the lit western face
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(mx - mw / 2, baseY);
  ctx.lineTo(mx - mw * 0.36, baseY - mh);
  ctx.lineTo(mx + mw * 0.36, baseY - mh);
  ctx.lineTo(mx + mw / 2, baseY);
  ctx.closePath();
  ctx.clip();
  const lg = ctx.createLinearGradient(mx - mw / 2, 0, mx + mw * 0.1, 0);
  lg.addColorStop(0, 'rgba(223,243,255,0.2)');
  lg.addColorStop(1, 'rgba(223,243,255,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(mx - mw, baseY - mh, mw * 2, mh);
  // carved relay bands — half awake
  for (let i = 0; i < 5; i++) {
    const by = baseY - mh * (0.2 + i * 0.16);
    const pa = 0.18 + 0.3 * Math.max(0, Math.sin(t * 0.9 + i * 1.3));
    ctx.fillStyle = `rgba(111,216,242,${i < 3 ? pa : pa * 0.25})`;
    ctx.fillRect(mx - mw * 0.42, by, mw * (0.38 - i * 0.04), Math.max(2, mh * 0.008));
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(138,152,184,0.6)'; // moonsteel rim on the lit edge
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(mx - mw / 2, baseY);
  ctx.lineTo(mx - mw * 0.36, baseY - mh);
  ctx.lineTo(mx + mw * 0.36, baseY - mh);
  ctx.stroke();
  // crown beacon — slow waking pulse
  const bp = 0.4 + 0.6 * Math.max(0, Math.sin(t * 0.6));
  csGlow(ctx, mx, baseY - mh, H * 0.06 * bp + 6, '223,243,255', 0.25 * bp);
  ctx.fillStyle = `rgba(223,243,255,${0.5 + 0.5 * bp})`;
  ctx.fillRect(mx - 2, baseY - mh - 4, 4, 4);
  // ground
  const gg = ctx.createLinearGradient(0, baseY, 0, H);
  gg.addColorStop(0, '#12141E');
  gg.addColorStop(1, '#0C0D14');
  ctx.fillStyle = gg;
  ctx.fillRect(0, baseY, W, H - baseY);
  // the settlement at its feet: hut silhouettes + warm windows
  for (let i = 0; i < 9; i++) {
    const hx = W * (0.16 + 0.68 * flick(i * 3.1));
    if (Math.abs(hx - mx) < mw * 0.6) continue;
    const hw = W * (0.022 + 0.02 * flick(i * 5.7));
    const hh = H * (0.02 + 0.015 * flick(i * 7.3));
    ctx.fillStyle = '#10121A';
    ctx.fillRect(hx, baseY - hh, hw, hh + 3);
    ctx.beginPath();
    ctx.moveTo(hx - 2, baseY - hh);
    ctx.lineTo(hx + hw / 2, baseY - hh - H * 0.012);
    ctx.lineTo(hx + hw + 2, baseY - hh);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `rgba(255,217,138,${0.4 + 0.3 * Math.sin(t * 1.8 + i * 2.4)})`;
    ctx.fillRect(hx + hw * 0.3, baseY - hh * 0.6, 2.4, 2.8);
    csGlow(ctx, hx + hw * 0.4, baseY - hh * 0.4, 16, '240,169,60', 0.1);
  }
  csGlow(ctx, mx, baseY, mh * 0.3, '94,107,140', 0.08); // base haze
  csMotes(ctx, W, H, 20, '111,216,242', t, 5, 9, 67);
}

// CAMPFIRE — operators resting in the warm light.
function artCampfire(ctx, W, H, t) {
  csSky(ctx, W, H, '#0B0A14', '#0F1119', 0.5);
  csStars(ctx, W, H, 55, t, 0.45);
  csRidge(ctx, W, H, H * 0.55, H * 0.06, '#0F121A', 71);
  for (let i = 0; i < 14; i++) { // tree wall
    const tx = W * flick(i * 2.3);
    const th = H * (0.1 + 0.12 * flick(i * 3.7));
    const ty = H * (0.5 + 0.1 * flick(i * 5.1));
    ctx.fillStyle = i % 2 ? '#0D1410' : '#0B1110';
    ctx.beginPath();
    ctx.moveTo(tx - th * 0.3, ty);
    ctx.lineTo(tx, ty - th);
    ctx.lineTo(tx + th * 0.3, ty);
    ctx.closePath();
    ctx.fill();
  }
  const gg = ctx.createLinearGradient(0, H * 0.58, 0, H);
  gg.addColorStop(0, '#15131C');
  gg.addColorStop(1, '#0E0C12');
  ctx.fillStyle = gg;
  ctx.fillRect(0, H * 0.56, W, H * 0.44);
  const cx = W * 0.5, cy = H * 0.74;
  const j = flick(Math.floor(t * 8));
  csGlow(ctx, cx, cy, H * 0.3 * (0.95 + j * 0.1), '240,169,60', 0.2);
  csGlow(ctx, cx, cy, H * 0.12, '255,217,138', 0.25);
  // operators resting — silhouettes rimmed in firelight
  const crew = [[-0.16, 0.02, 1], [0.17, 0.015, -1], [0.04, 0.07, -1]];
  crew.forEach(([ox, oy, side], i) => {
    const px = cx + W * ox, py2 = cy + H * oy;
    const s = (H / 720) * (1 + i * 0.06);
    const a0 = side > 0 ? -0.9 : Math.PI - 0.9;
    ctx.save();
    ctx.translate(px, py2);
    ctx.scale(s, s);
    ctx.fillStyle = '#191B26'; // seated body
    ctx.beginPath();
    ctx.ellipse(0, 0, 26, 30, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(-26, 0, 52, 12);
    ctx.fillStyle = '#15161F'; // legs folded toward the fire
    ctx.beginPath();
    ctx.ellipse(side * -14, 12, 20, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1D202C'; // helmet
    ctx.beginPath(); ctx.arc(0, -36, 13, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(240,169,60,${0.5 + j * 0.3})`; // firelit rim
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, -36, 12, a0, a0 + 1.8); ctx.stroke();
    ctx.strokeStyle = `rgba(240,169,60,${0.35 + j * 0.2})`;
    ctx.beginPath(); ctx.arc(0, -2, 25, a0 + 0.2, a0 + 1.6); ctx.stroke();
    ctx.fillStyle = 'rgba(111,216,242,0.8)'; // visor catching the fire
    ctx.fillRect(side > 0 ? 2 : -10, -38, 8, 2.5);
    ctx.restore();
  });
  // the fire itself
  ctx.fillStyle = '#17141A';
  ctx.beginPath(); ctx.ellipse(cx, cy + 6, 26, 10, 0, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 7; i++) { // stone ring
    const a = (i / 7) * Math.PI * 2;
    ctx.fillStyle = '#262A36';
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * 24, cy + 6 + Math.sin(a) * 8, 5, 3.6, a, 0, Math.PI * 2);
    ctx.fill();
  }
  const fl = 0.9 + j * 0.25;
  ctx.fillStyle = PAL.ember;
  tear(ctx, cx - 6, cy + 2, 6 * fl, 13 * fl);
  tear(ctx, cx + 6, cy + 2, 5 * fl, 11);
  ctx.fillStyle = PAL.lythAmber;
  tear(ctx, cx, cy, 9 * fl, 24 * fl);
  ctx.fillStyle = PAL.lythGold;
  tear(ctx, cx, cy + 2, 6 * fl, 16);
  ctx.fillStyle = PAL.lythPale;
  tear(ctx, cx, cy + 3, 3.2, 9);
  for (let i = 0; i < 8; i++) { // rising sparks
    const pr = fract(t * 0.45 + i * 0.125 + flick(i * 7.7));
    ctx.fillStyle = `rgba(224,123,57,${0.85 * (1 - pr)})`;
    ctx.fillRect(cx + Math.sin(pr * 7 + i * 2.3) * (8 + pr * 18), cy - 10 - pr * H * 0.3, 2, 2);
  }
  csMotes(ctx, W, H, 10, '94,107,140', t, 6, 3, 83);
}

// ENTROPY — a wall of violet static unwriting the terrain.
function artEntropy(ctx, W, H, t) {
  csSky(ctx, W, H, '#0B0A14', '#10141D', 0.6);
  csStars(ctx, W, H, 50, t, 0.5);
  csRidge(ctx, W, H, H * 0.6, H * 0.08, '#131720', 91);
  const gg = ctx.createLinearGradient(0, H * 0.6, 0, H);
  gg.addColorStop(0, '#1A222C');
  gg.addColorStop(1, '#10151C');
  ctx.fillStyle = gg;
  ctx.fillRect(0, H * 0.58, W, H * 0.42);
  // the living side
  for (let i = 0; i < 8; i++) {
    const tx = W * (0.04 + 0.5 * flick(i * 2.9));
    const ty = H * (0.62 + 0.3 * flick(i * 4.3));
    const th = H * (0.05 + 0.06 * flick(i * 6.1));
    ctx.fillStyle = '#16241C';
    ctx.beginPath();
    ctx.arc(tx, ty - th, th * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#10181A';
    ctx.fillRect(tx - 1.5, ty - th, 3, th);
  }
  // ...being unwritten on the right
  const frame = Math.floor(t * 10);
  const bx = W * (0.6 + 0.012 * Math.sin(t * 0.5)); // the wall creeps
  const ng = ctx.createLinearGradient(bx, 0, W, 0);
  ng.addColorStop(0, '#14091F');
  ng.addColorStop(1, '#0B0512');
  ctx.fillStyle = ng;
  ctx.fillRect(bx, 0, W - bx + 1, H);
  // torn edge — a vertical static curtain
  const cell = Math.max(4, Math.round(H / 90));
  for (let gy = 0; gy < H; gy += cell) {
    const row = gy / cell;
    const reach = (flick(row * 3.7 + frame) - 0.2) * W * 0.08;
    ctx.fillStyle = `rgba(142,79,209,${0.25 + 0.45 * flick(row * 1.3 + frame * 1.7)})`;
    ctx.fillRect(bx - Math.max(0, reach), gy, Math.abs(reach) + cell, cell - 1);
  }
  // static cells inside the null
  for (let k = 0; k < 130; k++) {
    const zx = bx + flick(k * 1.7 + frame * 0.31) ** 2 * (W - bx);
    const zy = H * flick(k * 2.3 + frame * 0.17);
    const r = flick(k * 5.1 + frame);
    const colr = r < 0.06 ? '191,251,255' : r < 0.5 ? '142,79,209' : '90,46,140';
    ctx.fillStyle = `rgba(${colr},${0.1 + 0.4 * flick(k * 3.3 + frame)})`;
    const zs = cell * (0.4 + flick(k * 7.7));
    ctx.fillRect(zx, zy, zs, zs * 0.8);
  }
  // a tree caught mid-unwrite at the boundary
  const ux = bx - W * 0.045, uy = H * 0.7, uh = H * 0.1;
  ctx.fillStyle = '#16241C';
  ctx.beginPath(); ctx.arc(ux, uy - uh, uh * 0.5, Math.PI * 0.5, Math.PI * 1.5); ctx.fill();
  for (let k = 0; k < 14; k++) {
    ctx.fillStyle = `rgba(142,79,209,${0.3 + 0.5 * flick(k * 3.1 + frame)})`;
    ctx.fillRect(ux + flick(k * 1.9 + frame * 0.4) * W * 0.07, uy - uh * 1.5 + flick(k * 4.7) * uh, 3, 3);
  }
  csGlow(ctx, bx, H * 0.5, H * 0.4, '142,79,209', 0.1); // boundary glow
  csMotes(ctx, W, H, 14, '142,79,209', t, -12, 5, 97); // motes pulled toward the wall
}

// DAWN — the anchored frontier at first light. The one warm sky.
function artDawn(ctx, W, H, t) {
  const sg = ctx.createLinearGradient(0, 0, 0, H * 0.62);
  sg.addColorStop(0, '#0B0A14');
  sg.addColorStop(0.45, '#222338');
  sg.addColorStop(0.8, '#7A4A33');
  sg.addColorStop(1, '#F0A93C');
  ctx.fillStyle = sg;
  ctx.fillRect(0, 0, W, H * 0.62);
  csStars(ctx, W, H, 24, t, 0.25);
  const horizon = H * 0.62;
  csGlow(ctx, W * 0.42, horizon, H * 0.3, '255,217,138', 0.4); // sun about to crest
  csGlow(ctx, W * 0.42, horizon, H * 0.12, '255,239,194', 0.5);
  csRidge(ctx, W, H, horizon + 2, H * 0.05, '#241A20', 101);
  csRidge(ctx, W, H, H * 0.72, H * 0.06, '#191219', 113);
  const gg = ctx.createLinearGradient(0, H * 0.72, 0, H);
  gg.addColorStop(0, '#150F16');
  gg.addColorStop(1, '#0E0A10');
  ctx.fillStyle = gg;
  ctx.fillRect(0, H * 0.78, W, H * 0.22);
  // anchored monoliths, beacons steady at last
  const ms = [[0.2, 0.3, 0.05, 0.7], [0.66, 0.46, 0.075, 0.74], [0.88, 0.22, 0.04, 0.68]];
  ms.forEach(([fx, fh, fw, fy], i) => {
    const mx = W * fx, baseY = H * fy, mh = H * fh, mw = W * fw;
    csMonolith(ctx, mx, baseY, mw, mh, '#16121C');
    ctx.strokeStyle = 'rgba(240,169,60,0.55)'; // dawn-lit eastern edge
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mx - mw / 2, baseY);
    ctx.lineTo(mx - mw * 0.36, baseY - mh);
    ctx.stroke();
    ctx.fillStyle = PAL.relay; // steady relay beacon
    ctx.shadowColor = PAL.relay;
    ctx.shadowBlur = 10;
    ctx.fillRect(mx - 1.5, baseY - mh - 4, 3, 4);
    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(111,216,242,${0.1 + 0.04 * Math.sin(t * 1.1 + i * 2)})`;
    ctx.fillRect(mx - 1, 0, 2, baseY - mh); // thin anchor-light beam
    csGlow(ctx, mx, baseY - mh, 18, '111,216,242', 0.3);
  });
  // chimney smoke from a waking settlement
  for (let i = 0; i < 3; i++) {
    const hx = W * (0.32 + i * 0.09), hy = H * 0.8;
    ctx.fillStyle = '#0D0A0F';
    ctx.fillRect(hx, hy - H * 0.025, W * 0.03, H * 0.03);
    ctx.fillStyle = 'rgba(255,217,138,0.65)';
    ctx.fillRect(hx + W * 0.008, hy - H * 0.012, 2.4, 2.8);
    for (let k = 0; k < 5; k++) {
      const pr = fract(t * 0.12 + k * 0.2 + i * 0.37);
      ctx.fillStyle = `rgba(138,152,184,${0.2 * (1 - pr)})`;
      ctx.beginPath();
      ctx.arc(hx + W * 0.014 + Math.sin(pr * 5 + i) * 8, hy - H * 0.03 - pr * H * 0.12, 2 + pr * 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // birds crossing the dawn
  for (let i = 0; i < 5; i++) {
    const bx = ((flick(i * 3.3) * W + t * (6 + flick(i) * 8)) % (W + 40)) - 20;
    const by = H * (0.2 + 0.18 * flick(i * 5.7)) + Math.sin(t * 2 + i) * 4;
    const fl2 = Math.sin(t * 7 + i * 2.7) * 3;
    ctx.strokeStyle = 'rgba(20,16,24,0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx - 5, by + fl2);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx + 5, by + fl2);
    ctx.stroke();
  }
  csMotes(ctx, W, H, 18, '255,217,138', t, 9, 4, 131);
}

const CUTSCENE_ART = {
  anchorcraft: artAnchorcraft,
  crossing: artCrossing,
  basin: artBasin,
  quorum: artQuorum,
  forkfall: artForkfall,
  siege: artSiege,
  settlement: artSettlement,
  campfire: artCampfire,
  entropy: artEntropy,
  dawn: artDawn,
};

// Full-canvas story slide: art scene + title + typewriter lines + FIRE hint.
// The client owns timing; slideElapsed is seconds since this slide appeared.
export function drawCutscene(ctx, slide, t, slideElapsed, holdT = 0, holdThreshold = 3) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = PAL.voidNight;
  ctx.fillRect(0, 0, W, H);
  (CUTSCENE_ART[slide?.art] || artCrossing)(ctx, W, H, t);
  // cinematic letterbox
  const lb = Math.round(H * 0.04);
  ctx.fillStyle = 'rgba(7,6,12,0.9)';
  ctx.fillRect(0, 0, W, lb);
  ctx.fillRect(0, H - lb, W, lb);
  // text scrim
  const sg = ctx.createLinearGradient(0, H * 0.5, 0, H);
  sg.addColorStop(0, 'rgba(11,10,20,0)');
  sg.addColorStop(0.55, 'rgba(11,10,20,0.62)');
  sg.addColorStop(1, 'rgba(11,10,20,0.88)');
  ctx.fillStyle = sg;
  ctx.fillRect(0, H * 0.5, W, H * 0.5);
  const x0 = Math.round(W * 0.09);
  const ty = Math.round(H * 0.66);
  const ts = Math.max(24, Math.round(H * 0.052));
  // title — fades in fast
  ctx.globalAlpha = Math.min(1, slideElapsed / 0.5);
  ctx.font = `800 ${ts}px "Avenir Next", "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = PAL.anchor;
  ctx.shadowColor = 'rgba(111,216,242,0.55)';
  ctx.shadowBlur = 16;
  ctx.fillText(slide?.title || '', x0, ty);
  ctx.shadowBlur = 0;
  ctx.fillStyle = PAL.relay;
  ctx.fillRect(x0 + 1, ty + ts * 0.35, Math.min(W * 0.26, 240), 2);
  ctx.globalAlpha = 1;
  // body lines — typewriter reveal over ~2.5s
  const lines = (slide?.lines || []).map(l => String(l ?? ''));
  const totalChars = Math.max(1, lines.reduce((s, l) => s + l.length, 0));
  const shown = Math.floor(totalChars * Math.max(0, Math.min(1, (slideElapsed - 0.35) / 2.5)));
  const ls = Math.max(14, Math.round(H * 0.026));
  ctx.font = `${ls}px ui-monospace, Menlo, monospace`;
  let used = 0;
  for (let i = 0; i < lines.length; i++) {
    const take = Math.max(0, Math.min(lines[i].length, shown - used));
    used += lines[i].length;
    if (take <= 0) break;
    const ly = ty + ts * 0.62 + (i + 1) * ls * 1.6;
    const txt = lines[i].slice(0, take);
    ctx.fillStyle = 'rgba(200,212,230,0.95)';
    ctx.fillText(txt, x0, ly);
    // blinking caret while this line types
    if (take < lines[i].length && Math.floor(t * 2.6) % 2 === 0) {
      ctx.fillStyle = PAL.relay;
      ctx.fillRect(x0 + ctx.measureText(txt).width + 3, ly - ls * 0.8, Math.max(2, ls * 0.12), ls * 0.95);
    }
  }
  // advance hint + hold-to-skip progress ring
  if (holdT > 0.05) {
    // FIRE/START is being held — fill a ring; at holdThreshold the whole
    // cutscene is skipped (client side)
    const prog = Math.min(1, holdT / holdThreshold);
    const hx = W - Math.round(W * 0.07), hy = H - lb - Math.round(H * 0.032);
    const r = Math.max(14, H * 0.028);
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(3, H * 0.005);
    ctx.strokeStyle = 'rgba(111,216,242,0.18)';
    ctx.beginPath(); ctx.arc(hx, hy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = PAL.relay; ctx.shadowColor = PAL.relay; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(hx, hy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillStyle = PAL.relay;
    ctx.font = `bold ${Math.max(11, Math.round(H * 0.017))}px ui-monospace, Menlo, monospace`;
    ctx.fillText('SKIPPING', hx - r - 10, hy);
    ctx.textBaseline = 'alphabetic';
  } else if (slideElapsed > 1) {
    const ha = Math.min(1, (slideElapsed - 1) / 0.4) * (0.55 + 0.35 * Math.sin(t * 3.4));
    ctx.globalAlpha = Math.max(0, ha);
    ctx.font = `bold ${Math.max(13, Math.round(H * 0.021))}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'right';
    ctx.fillStyle = PAL.relay;
    ctx.shadowColor = PAL.relay;
    ctx.shadowBlur = 8;
    ctx.fillText('▸ FIRE  ·  HOLD TO SKIP', W - Math.round(W * 0.045), H - lb - Math.round(H * 0.028));
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// Cheap animated backdrop behind the DOM menu: dark field, a distant dormant
// monolith, drifting motes. Called every frame while no session exists.
export function drawMenuBackdrop(ctx, t) {
  setScene(null); // menus: fade mission ambience back to the quiet base bed
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.save();
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0B0A14');
  g.addColorStop(0.7, '#0E1019');
  g.addColorStop(1, '#0B0C13');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  csStars(ctx, W, H, 70, t, 0.8, 7);
  csGlow(ctx, W * 0.2, H * 0.14, H * 0.26, '94,107,140', 0.1); // moon haze
  csRidge(ctx, W, H, H * 0.8, H * 0.05, '#10121B', 17);
  csRidge(ctx, W, H, H * 0.88, H * 0.045, '#0C0D15', 29);
  // the distant dormant monolith
  const mx = W * 0.72, baseY = H * 0.84, mh = H * 0.34, mw = W * 0.045;
  csGlow(ctx, mx, baseY - mh * 0.55, mh * 0.5, '90,46,140', 0.05 + 0.02 * Math.sin(t * 0.7));
  csMonolith(ctx, mx, baseY, mw, mh, '#10121D');
  ctx.strokeStyle = 'rgba(138,152,184,0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(mx - mw / 2, baseY);
  ctx.lineTo(mx - mw * 0.36, baseY - mh);
  ctx.stroke();
  // a single dormant vein, barely breathing
  ctx.strokeStyle = `rgba(142,79,209,${0.12 + 0.1 * Math.max(0, Math.sin(t * 0.5))})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mx - mw * 0.1, baseY - mh * 0.9);
  ctx.lineTo(mx + mw * 0.05, baseY - mh * 0.6);
  ctx.lineTo(mx - mw * 0.12, baseY - mh * 0.3);
  ctx.stroke();
  csGlow(ctx, W * 0.5, H * 0.95, W * 0.4, '30,40,60', 0.18); // ground haze
  csMotes(ctx, W, H, 22, '94,107,140', t, 7, 3, 19);
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.9);
  vg.addColorStop(0, 'rgba(11,10,20,0)');
  vg.addColorStop(1, 'rgba(11,10,20,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ---------- ability preview (lobby character carousel) ----------
// A small, self-contained looping demo of a character's weapon — faithful to its
// count / spread / curve / range / pierce / aoe / over-walls, WITHOUT touching the
// sim. Driven from client's frame() loop each frame with t in seconds.
const _ap = { id: null, shots: [], fx: [], cd: 0, last: 0 };
export function drawAbilityPreview(ctx, char, t) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!char) return;
  if (char.id !== _ap.id) { _ap.id = char.id; _ap.shots.length = 0; _ap.fx.length = 0; _ap.cd = 0.2; }
  let dt = t - _ap.last; _ap.last = t;
  if (!(dt > 0) || dt > 0.1) dt = 0.016;

  const w = char.weapon || {};
  const col = char.color || '#6FD8F2';
  const sx = W * 0.16, sy = H * 0.5;
  const scale = (W * 0.62) / Math.max(3, w.range || 6);
  const speed = (w.projSpeed || 10) * scale;
  const maxDist = (w.range || 6) * scale;
  const overWalls = !!w.overWalls;
  const aoe = (w.aoeRadius || 0) * scale;
  const pierce = w.pierce === true ? 99 : (w.pierce || 0);
  const count = Math.max(1, w.count || 1);
  const spread = (w.spreadDeg || 0) * Math.PI / 180;
  const curve = (w.curve || 0);

  ctx.save();
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, 'rgba(16,20,30,0.92)'); bg.addColorStop(1, 'rgba(8,10,18,0.96)');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(54,160,138,0.16)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, sy + H * 0.30); ctx.lineTo(W, sy + H * 0.30); ctx.stroke();

  const targets = [];
  if (spread >= Math.PI && count > 1) {
    const n = Math.min(6, count);
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; targets.push([sx + Math.cos(a) * maxDist * 0.66, sy + Math.sin(a) * maxDist * 0.66]); }
  } else {
    targets.push([sx + maxDist * 0.82, sy]);
    if (count > 1 && spread > 0.05) { targets.push([sx + maxDist * 0.82, sy - H * 0.17]); targets.push([sx + maxDist * 0.82, sy + H * 0.17]); }
  }
  for (const [tx, ty] of targets) {
    ctx.strokeStyle = 'rgba(224,72,72,0.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(tx, ty, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(224,72,72,0.10)'; ctx.fill();
  }

  if (overWalls) {
    const wx = sx + maxDist * 0.42;
    ctx.fillStyle = 'rgba(94,107,140,0.55)'; ctx.fillRect(wx - 6, sy + 4, 12, H * 0.24);
    ctx.fillStyle = 'rgba(94,107,140,0.28)'; ctx.fillRect(wx - 6, sy, 12, 5);
  }

  _ap.cd -= dt;
  if (_ap.cd <= 0) {
    _ap.cd = Math.max(0.7, Math.min(2.2, (w.cooldown || 0.4) * 2.2));
    for (let i = 0; i < count; i++) {
      let a;
      if (spread >= Math.PI * 1.9) a = i / count * Math.PI * 2;
      else if (count > 1) a = -spread / 2 + spread * (i / (count - 1));
      else a = 0;
      _ap.shots.push({ x: sx, y: sy, a, dist: 0, pierce });
    }
  }

  ctx.lineCap = 'round';
  for (let i = _ap.shots.length - 1; i >= 0; i--) {
    const s = _ap.shots[i];
    s.a += curve * dt;
    const vx = Math.cos(s.a) * speed, vy = Math.sin(s.a) * speed;
    s.x += vx * dt; s.y += vy * dt;
    const yArc = overWalls ? -Math.sin(Math.min(1, s.dist / maxDist) * Math.PI) * H * 0.20 : 0;
    s.dist += speed * dt;
    const px = s.x, py = s.y + yArc;
    ctx.strokeStyle = col; ctx.globalAlpha = 0.45; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(px - vx * 0.02, py - vy * 0.02); ctx.lineTo(px, py); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(px, py, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    let hit = false;
    for (const [tx, ty] of targets) { if (Math.hypot(px - tx, py - ty) < 11) { hit = true; break; } }
    if (hit && s.pierce > 0) { s.pierce--; }
    else if (hit || s.dist >= maxDist || px > W + 12 || py < -12 || py > H + 12) {
      if (aoe > 0) _ap.fx.push({ x: px, y: py, r: 0, max: Math.min(aoe, W * 0.22), t: 0 });
      _ap.shots.splice(i, 1);
    }
  }

  for (let i = _ap.fx.length - 1; i >= 0; i--) {
    const f = _ap.fx[i]; f.t += dt; f.r = f.max * Math.min(1, f.t / 0.35);
    const al = Math.max(0, 1 - f.t / 0.45);
    ctx.strokeStyle = `rgba(255,217,138,${al})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = `rgba(255,170,90,${al * 0.22})`; ctx.fill();
    if (f.t > 0.45) _ap.fx.splice(i, 1);
  }

  ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
  ctx.fillStyle = '#0b121a'; ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(54,160,138,0.4)'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  ctx.restore();
}

// human-readable behavior tags for a weapon (carousel caption)
export function weaponTags(w) {
  if (!w) return [];
  const tags = [];
  if (w.pierce === true || w.pierce > 0) tags.push('PIERCE');
  if (w.aoeRadius > 0) tags.push('AoE');
  if (w.curve) tags.push('CURVE');
  if (w.overWalls) tags.push('OVER-WALLS');
  if ((w.count || 1) > 1) tags.push(w.spreadDeg >= 180 ? 'RING' : (w.spreadDeg > 12 ? 'SPREAD' : 'MULTI'));
  return tags;
}
