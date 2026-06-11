// HD renderer — "Monolythium: Anchorfall" night grade.
// Procedural vector/baked art with drop-in PNG overrides: any texture key in
// BAKERS is first looked up as /assets/<key>.png (v2 keys, so the legacy
// placeholder PNGs no longer apply); if missing, a procedural canvas is baked.
// The world reads as cold moonlit frontier; warm LYTH light = safety/value.
import { TILE } from '/shared/game.js';

const particles = [];
const flashes = [];
const popups = [];
const rings = [];
let shake = 0;
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
};

// floor letter -> [texture base name, variant count]
const FLOOR_TEX = {
  '.': ['meadow', 6],
  ',': ['forest', 4],
  ':': ['swamp', 4],
  ';': ['stone', 4],
  '_': ['ash', 4],
};

// Unknown letters fall back to meadow so classic maps (and future letters)
// never break. Tall/decor letters pick a fitting ground to sit on.
function floorTex(c, x, y) {
  let f = FLOOR_TEX[c];
  if (!f) {
    if (c === 'T') f = FLOOR_TEX[','];
    else if (c === 'E') f = FLOOR_TEX[';'];
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
// Operator bust: graphite plate, cyan visor slit, char-color energy trim.
// Override with /assets/portrait2_<id>.png.
export function drawPortrait(canvas, ch, size = 56) {
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  loadCached(`/assets/portrait2_${ch.id}.png`)
    .then(img => ctx.drawImage(img, 0, 0, size, size))
    .catch(() => {
      const s = size / 56;
      const g = ctx.createLinearGradient(0, 0, 0, size);
      g.addColorStop(0, '#141625');
      g.addColorStop(1, '#0B0A14');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      // faint moonlight from the upper-left
      const mg = ctx.createRadialGradient(size * 0.2, size * 0.1, 2, size * 0.2, size * 0.1, size * 0.9);
      mg.addColorStop(0, 'rgba(191,208,232,0.12)');
      mg.addColorStop(1, 'rgba(191,208,232,0)');
      ctx.fillStyle = mg;
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = 'rgba(23,74,74,0.9)';
      ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
      ctx.save();
      ctx.scale(s, s);
      // shoulder plate
      ctx.fillStyle = PAL.graphMid;
      ctx.beginPath();
      ctx.ellipse(28, 57, 23, 16, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = PAL.graphDark;
      ctx.fillRect(8, 52, 40, 2);
      // char-color energy trim across the shoulders
      ctx.strokeStyle = ch.color;
      ctx.lineWidth = 2;
      ctx.shadowColor = ch.color;
      ctx.shadowBlur = 5;
      ctx.beginPath();
      ctx.moveTo(7, 49); ctx.lineTo(20, 45);
      ctx.moveTo(36, 45); ctx.lineTo(49, 49);
      ctx.stroke();
      ctx.shadowBlur = 0;
      // teal collar tick — squad marking
      ctx.fillStyle = PAL.teal;
      ctx.fillRect(24, 42, 8, 2);
      // helmet dome + chin guard, no face shown
      ctx.fillStyle = '#3A4050';
      ctx.beginPath();
      ctx.arc(28, 27, 13.5, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = PAL.graphPlate;
      ctx.fillRect(14.5, 26, 27, 13);
      ctx.fillStyle = 'rgba(11,10,20,0.4)';
      ctx.fillRect(14.5, 35, 27, 4);
      // moonsteel rim from the upper-left
      ctx.strokeStyle = PAL.moonsteel;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(28, 27, 12.6, Math.PI * 1.02, Math.PI * 1.55);
      ctx.stroke();
      // relay-cyan visor slit
      ctx.fillStyle = PAL.relay;
      ctx.shadowColor = PAL.relay;
      ctx.shadowBlur = 7;
      ctx.fillRect(18, 29.5, 20, 3.6);
      ctx.shadowBlur = 0;
      ctx.fillStyle = PAL.anchor;
      ctx.fillRect(20, 30.4, 7, 1.2);
      // char-color crown dot
      ctx.fillStyle = ch.color;
      ctx.shadowColor = ch.color;
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(28, 17.5, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
}

// Group the weapon kinds into readable held-silhouette classes.
function weaponClass(kind) {
  switch (kind) {
    case 'rail': case 'ghost': return 'long';
    case 'scatter': case 'slug': return 'shotgun';
    case 'mortar': case 'cannon': case 'rivet': case 'comet': return 'tube';
    case 'twin': case 'blade': return 'blades';
    case 'flame': return 'thrower';
    case 'disc': case 'helix': return 'arc';
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

// ============================== EVENT FX ==============================
export function addEventFX(ev) {
  const burst = (n, color, speed = 120, life = 0.4) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      particles.push({ x: ev.x, y: ev.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color });
    }
  };
  const ring = (r1, color, life = 0.5, w = 3, r0 = 5) =>
    rings.push({ x: ev.x, y: ev.y, r0, r1, life, max: life, color, w });

  if (ev.type === 'shoot') flashes.push({ x: ev.x, y: ev.y, life: 0.07, who: ev.who });
  else if (ev.type === 'hit') { burst(4, '#ffd9d2', 110, 0.3); burst(3, PAL.red, 90, 0.3); }
  else if (ev.type === 'hitWall' || ev.type === 'shield') burst(5, PAL.steel, 90, 0.25);
  else if (ev.type === 'explode') { burst(22, PAL.lythAmber, 240, 0.6); burst(8, PAL.ember, 150, 0.5); shake = Math.max(shake, 8); }
  else if (ev.type === 'die') {
    // the Entropy unravels: violet static + one cyan eye-spark
    burst(15, PAL.glitch, 180, 0.55); burst(5, PAL.eye, 220, 0.3);
    popups.push({ x: ev.x, y: ev.y - 20, text: `+${ev.points || 100} x${ev.combo || 1}`, life: 0.75, max: 0.75, color: PAL.lythGold });
    shake = Math.max(shake, 4);
  }
  else if (ev.type === 'down') { burst(12, PAL.red, 150, 0.6); burst(6, '#ffffff', 130, 0.4); shake = Math.max(shake, 6); }
  else if (ev.type === 'pickup') { burst(10, '#5fd2b4', 100, 0.5); popups.push({ x: ev.x, y: ev.y - 20, text: 'RESCUE', life: 0.8, max: 0.8, color: '#5fd2b4' }); }
  else if (ev.type === 'extract') { burst(16, PAL.anchor, 170, 0.7); popups.push({ x: ev.x, y: ev.y - 22, text: `+${ev.points || 250}`, life: 0.9, max: 0.9, color: PAL.relay }); }
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
    popups.push({ screen: true, x: 0, y: 0, text: 'THE ANCHOR WAKES', life: 2.4, max: 2.4, color: PAL.anchor, size: 30 });
  }
  else if (ev.type === 'talk') ring(26, 'rgba(111,216,242,0.8)', 0.45, 2);
  else if (ev.type === 'crystal') { burst(13, PAL.lythAmber, 160, 0.55); burst(5, PAL.lythPale, 100, 0.4); shake = Math.max(shake, 2); }
  else if (ev.type === 'special') { burst(12, PAL.anchor, 180, 0.5); flashes.push({ x: ev.x, y: ev.y, life: 0.1, who: 'p' }); }
  else if (ev.type === 'dash') burst(8, ev.kind ? PAL.glitch : PAL.relay, 140, 0.3);
  // unknown event types are ignored gracefully
}

// ============================== POSE / WALK CYCLE ==============================
// Module-level memory of previous positions: walk cycles are driven purely by
// how far an entity actually moved (works for local sim AND net snapshots).
const pose = new Map();
function poseFor(key, x, y, dt) {
  if (!key) return { ph: 0, amp: 0 };
  if (pose.size > 900) pose.clear(); // long expeditions: ids keep growing
  let st = pose.get(key);
  if (!st) { st = { x, y, ph: 0, sp: 0 }; pose.set(key, st); }
  const d = Math.hypot(x - st.x, y - st.y);
  const v = dt > 0 ? Math.min(400, d / dt) : 0;
  st.sp += (v - st.sp) * 0.25;
  st.ph += d * 0.22;
  st.x = x; st.y = y;
  return { ph: st.ph, amp: Math.max(0, Math.min(1, st.sp / 70)) };
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
  ctx.save();
  // compose with the caller's alpha (sleeping enemies arrive dimmed)
  const base = ctx.globalAlpha;
  const blink = invuln > 0 ? 0.5 + 0.3 * Math.sin(t * 16) : 1;
  ctx.globalAlpha = base * blink;
  shadowBlob(ctx, x, y + 11, 12, 5);
  // focus ring
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha *= isMe ? 0.95 : 0.5;
  ctx.lineWidth = isMe ? 2.5 : 1.2;
  ctx.shadowColor = color;
  ctx.shadowBlur = isMe ? 10 : 4;
  ctx.beginPath();
  ctx.ellipse(x, y + 9, 16, 7.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  ctx.translate(x, y);
  ctx.rotate(ang + Math.PI / 2);
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
  ctx.rotate(-(ang + Math.PI / 2));
  // screen-fixed Moonsteel rim light from the upper-left
  rimArc(ctx, 0, -1, 9.5);
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

function drawEye(ctx, x, y, r, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.shadowColor = PAL.relay;
  ctx.shadowBlur = 6;
  ctx.fillStyle = PAL.eye;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawEnemy(ctx, e, t, dt) {
  const a = Math.atan2(e.fy, e.fx);
  const { ph } = poseFor('e' + e.id, e.x, e.y, dt);

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
    // CLASSICAL PHANTOM — semi-transparent ghost of an old operator coat
    ctx.save();
    ctx.globalAlpha *= 0.6 + 0.08 * Math.sin(t * 9 + e.id);
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
function drawDrop(ctx, d, t, lights) {
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

function drawTurret(ctx, b, t, snap, lights) {
  const { x, y } = b;
  // pick a visual target: nearest awake enemy within 5 tiles
  let ta = t * 0.6, best = (TILE * 5) ** 2;
  for (const e of snap.enemies || []) {
    if (e.awake === false) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d < best) { best = d; ta = Math.atan2(e.y - y, e.x - x); }
  }
  // tripod
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
    else if (b.kind === 'turret') drawTurret(ctx, b, t, snap, lights);
    else drawPylon(ctx, b, t, lights);
    if (b.maxHp && b.hp != null && b.hp < b.maxHp) drawHpPips(ctx, x, y - 28, b.hp / b.maxHp);
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

// World-space interaction prompt ('[E/X] TALK', '[hold E/X] BUILD ...').
function drawPrompt(ctx, x, y, text, t) {
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

// --- camera (shared couch camera: follows the focus players, zooms to fit) ---
const cam = { x: 0, y: 0, z: 1, key: null, vw: 1280, vh: 720 };
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.15;

function computeCamera(snap, focus, dt) {
  const VW = cam.vw, VH = cam.vh;
  const W = snap.w * TILE, H = snap.h * TILE;
  const fitZ = Math.min(VW / W, VH / H);
  let tx, ty, tz;
  if (fitZ >= 0.8) {
    // Classic single-screen levels: frame the whole map, centered.
    tx = W / 2; ty = H / 2; tz = Math.min(fitZ, ZOOM_MAX);
  } else {
    let pts = snap.players.filter(p => p.state === 'active' && focus.has(p.pid));
    if (!pts.length) pts = snap.players.filter(p => p.state === 'active');
    if (!pts.length) pts = [{ x: cam.x, y: cam.y }];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const pad = TILE * 4.5;
    const bw = maxX - minX + pad * 2, bh = maxY - minY + pad * 2;
    tz = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, VW / bw, VH / bh));
    tz = Math.max(tz, fitZ); // never zoom wider than the whole map
    const hw = VW / 2 / tz, hh = VH / 2 / tz;
    tx = (minX + maxX) / 2;
    ty = (minY + maxY) / 2;
    tx = W <= hw * 2 ? W / 2 : Math.max(hw, Math.min(W - hw, tx));
    ty = H <= hh * 2 ? H / 2 : Math.max(hh, Math.min(H - hh, ty));
  }
  const key = snap.grid || snap.name;
  if (cam.key !== key) {
    cam.key = key;
    cam.x = tx; cam.y = ty; cam.z = tz;
  } else {
    const k = 1 - Math.exp(-dt * 6);
    const kz = 1 - Math.exp(-dt * 3.5);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    cam.z += (tz - cam.z) * kz;
  }
}

function inView(x, y, m = 70) {
  return Math.abs(x - cam.x) < cam.vw / 2 / cam.z + m && Math.abs(y - cam.y) < cam.vh / 2 / cam.z + m;
}

function toScreen(x, y) {
  return [(x - cam.x) * cam.z + cam.vw / 2, (y - cam.y) * cam.z + cam.vh / 2];
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

function drawEdgeArrow(ctx, wx, wy, color, label) {
  const VW = cam.vw, VH = cam.vh, M = 30;
  let [sx, sy] = toScreen(wx, wy);
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

// ============================== MAIN RENDER ==============================
export function render(ctx, snap, charMap, focusPids, t, dt) {
  const focus = focusPids instanceof Set ? focusPids
    : new Set(Array.isArray(focusPids) ? focusPids : [focusPids]);
  // new snapshot fields are optional: classic levels must keep rendering
  const builds = snap.builds ?? [];
  const crystals = snap.crystals ?? [];
  const drops = snap.drops ?? [];
  const npcs = snap.npcs ?? [];
  const gate = snap.gate ?? null;
  const lights = []; // per-frame light pools (campfires, LYTH, pylons...)

  // particles, flashes, popups, rings
  shake = Math.max(0, shake - dt * 18);
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

  cam.vw = ctx.canvas.width;
  cam.vh = ctx.canvas.height;
  const VW = cam.vw, VH = cam.vh;
  computeCamera(snap, focus, dt);
  const z = cam.z;

  ctx.fillStyle = PAL.voidNight;
  ctx.fillRect(0, 0, VW, VH);
  ctx.save();
  ctx.translate(VW / 2, VH / 2);
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  ctx.scale(z, z);
  ctx.translate(-cam.x, -cam.y);

  // visible tile range (camera culling)
  const tx0 = Math.max(0, Math.floor((cam.x - VW / 2 / z) / TILE) - 1);
  const tx1 = Math.min(snap.w - 1, Math.ceil((cam.x + VW / 2 / z) / TILE) + 1);
  const ty0 = Math.max(0, Math.floor((cam.y - VH / 2 / z) / TILE) - 1);
  const ty1 = Math.min(snap.h - 1, Math.ceil((cam.y + VH / 2 / z) / TILE) + 1);

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
      ctx.drawImage(floorTex(c, x, y), px, py);
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
      }
    }
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
        }
      } else if (c === 'T') {
        const v = (x * 5 + y * 11) % 4;
        ctx.drawImage(tex['tree' + v], px - 8, py - 14);
      }
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
  for (const n of npcs) if (inView(n.x, n.y)) drawNpc(ctx, n, t, lights);

  // --- downed captives (slumped, awaiting rescue) ---
  for (const c of snap.captives) {
    if (!inView(c.x, c.y)) continue;
    const col = charMap[c.charId]?.color || '#fff';
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
    drawEnemy(ctx, e, t, dt);
    ctx.restore();
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
  }

  // --- operators ---
  for (const p of snap.players) {
    if (p.state !== 'active') continue;
    const ch = charMap[p.charId];
    const col = ch?.color || '#fff';
    drawSoldier(ctx, p.x, p.y, p.fx, p.fy, col, t, focus.has(p.pid), p.invuln,
      { key: 'p' + p.pid, dt, weapon: ch?.weapon?.kind });
    ctx.fillStyle = 'rgba(223,243,255,0.85)';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(p.name.toUpperCase(), p.x, p.y - 26);
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
  const promptNpcs = new Set();
  for (const fp of focusActive) {
    if (busyPids.has(fp.pid)) continue;
    let bestN = null, nd = R2;
    for (const n of npcs) {
      const d = (n.x - fp.x) ** 2 + (n.y - fp.y) ** 2;
      if (d < nd) { nd = d; bestN = n; }
    }
    if (bestN) promptNpcs.add(bestN);
  }
  for (const b of promptSites) drawPrompt(ctx, b.x, b.y - 34, `[hold E/X] BUILD ${(b.kind || '').toUpperCase()} ${b.cost ?? ''}◆`, t);
  for (const n of promptNpcs) drawPrompt(ctx, n.x, n.y - 36, '[E/X] TALK', t);

  // --- shots ---
  for (const s of snap.shots) {
    if (!inView(s.x, s.y)) continue;
    const sp = Math.hypot(s.vx, s.vy) || 1;
    const nx = s.vx / sp, ny = s.vy / sp;
    ctx.save();
    if (s.who === 'e' && s.kind !== 'sniper') {
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
    }
    ctx.restore();
  }

  // --- particles ---
  for (const p of particles) {
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
    if (p.screen) continue;
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
    const rgb = f.who === 'p' ? '223,243,255' : '142,79,209';
    const fg = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 32);
    fg.addColorStop(0, `rgba(${rgb},${0.45 * Math.min(1, a)})`);
    fg.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = fg;
    ctx.fillRect(f.x - 32, f.y - 32, 64, 64);
  }
  for (const L of lights) {
    if (!inView(L.x, L.y, L.r)) continue;
    const lg = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
    lg.addColorStop(0, `rgba(${L.rgb},${L.a})`);
    lg.addColorStop(1, `rgba(${L.rgb},0)`);
    ctx.fillStyle = lg;
    ctx.fillRect(L.x - L.r, L.y - L.r, L.r * 2, L.r * 2);
  }
  ctx.restore();
  ctx.restore();

  // --- vignette (screen space, Void Night) ---
  const vg = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.32, VW / 2, VH / 2, VH * 0.85);
  vg.addColorStop(0, 'rgba(11,10,20,0)');
  vg.addColorStop(1, 'rgba(11,10,20,0.62)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, VW, VH);

  // --- screen-space banners (LOW TIME / THE ANCHOR WAKES) ---
  for (const p of popups) {
    if (!p.screen) continue;
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.font = `bold ${p.size || 26}px monospace`;
    ctx.textAlign = 'center';
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 14;
    ctx.fillText(p.text, VW / 2, 64);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;

  // --- offscreen pointers: teammates, stranded captives, the Anchor ---
  for (const p of snap.players) {
    if (p.state !== 'active' || inView(p.x, p.y, -20)) continue;
    const col = charMap[p.charId]?.color || '#fff';
    drawEdgeArrow(ctx, p.x, p.y, col, p.name.toUpperCase().slice(0, 6));
  }
  const farCaptives = snap.captives
    .filter(c => !c.owner && !inView(c.x, c.y, -20))
    .map(c => ({ c, d: (c.x - cam.x) ** 2 + (c.y - cam.y) ** 2 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 6);
  for (const { c } of farCaptives) drawEdgeArrow(ctx, c.x, c.y, '#5fd2b4', 'RESCUE');
  if (exitCols.length) {
    let near = null, best = Infinity;
    for (const e of exitCols) {
      const px = (e.x + 0.5) * TILE, py = (e.y + 0.5) * TILE;
      const d = (px - cam.x) ** 2 + (py - cam.y) ** 2;
      if (d < best) { best = d; near = { px, py }; }
    }
    if (near && !inView(near.px, near.py, -20)) {
      drawEdgeArrow(ctx, near.px, near.py, gateOpen ? PAL.relay : PAL.glitch, 'ANCHOR');
    }
  }

  // --- respawn pick bars: fallen players choose their next operative ---
  let pickRow = 0;
  for (const p of snap.players) {
    if (p.state !== 'pick' || !p.pick?.choices?.length) continue;
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
}

// Static minimap backdrop is baked once per level and reused every frame.
const MM_TILE = {
  '.': '#1c242b', ',': '#221C22', ':': '#2A2820', ';': '#272b38', '_': '#15121a',
  '#': '#343A48', 'T': '#23392b', '~': '#101A2E', 'o': '#4A4232', '*': '#F0A93C',
};
let mmCache = { key: null, canvas: null };
export function renderMinimap(ctx, snap, focusPids) {
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
  ctx.drawImage(mmCache.canvas, 0, 0);
  const dot = (x, y, col, r = 2.5) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x * sx, y * sy, r, 0, Math.PI * 2);
    ctx.fill();
  };
  // the Anchor: live color by gate state
  const gOpen = !snap.gate || snap.gate.open;
  ctx.fillStyle = gOpen ? PAL.relay : PAL.glitch;
  for (const e of exitTiles(snap)) {
    ctx.fillRect(e.x * TILE * sx, e.y * TILE * sy, TILE * sx + 0.5, TILE * sy + 0.5);
  }
  for (const c of snap.crystals ?? []) dot(c.x, c.y, PAL.lythAmber, 2);
  for (const d of snap.drops ?? []) dot(d.x, d.y, PAL.lythGold, 1.5);
  for (const b of snap.builds ?? []) {
    ctx.fillStyle = b.built ? PAL.teal : 'rgba(62,143,224,0.6)';
    ctx.fillRect(b.x * sx - 1.5, b.y * sy - 1.5, 3, 3);
  }
  for (const n of snap.npcs ?? []) dot(n.x, n.y, PAL.coldHi, 2);
  for (const e of snap.enemies) {
    if (e.awake === false) ctx.globalAlpha = 0.45;
    dot(e.x, e.y, PAL.red, 2);
    ctx.globalAlpha = 1;
  }
  for (const c of snap.captives) if (!c.owner) dot(c.x, c.y, '#5fd2b4');
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
