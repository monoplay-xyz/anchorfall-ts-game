// HD renderer: procedural placeholder art with drop-in PNG overrides.
// Any texture key listed in TEXTURES is first looked up as /assets/<key>.png;
// if the file is missing, a procedural canvas is baked instead.
import { TILE } from '/shared/game.js';

const particles = [];
const flashes = [];
const popups = [];
let shake = 0;
const tex = {};
const imageCache = {};

const ENEMY_STYLE = {
  grunt: '#d4452f',
  archer: '#8e3fd9',
  charger: '#ef8f2f',
  bulwark: '#607d8b',
  spawner: '#3fa95b',
  sniper: '#d93678',
  skitter: '#ff7043',
  boss: '#9b263b',
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

function bakeGrass(seed) {
  return bake(TILE, TILE, (ctx, rnd) => {
    ctx.fillStyle = `hsl(${100 + rnd() * 18}, ${30 + rnd() * 10}%, ${13 + rnd() * 4}%)`;
    ctx.fillRect(0, 0, TILE, TILE);
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = `hsla(${90 + rnd() * 40}, ${30 + rnd() * 25}%, ${12 + rnd() * 14}%, ${0.4 + rnd() * 0.5})`;
      ctx.fillRect(rnd() * TILE, rnd() * TILE, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
    }
    for (let i = 0; i < 9; i++) {
      const x = rnd() * TILE, y = rnd() * TILE;
      ctx.strokeStyle = `hsla(${95 + rnd() * 30}, 40%, ${22 + rnd() * 14}%, .7)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.5) * 4, y - 3 - rnd() * 4);
      ctx.stroke();
    }
    // occasional dirt patch
    if (rnd() < 0.35) {
      ctx.fillStyle = 'rgba(80, 62, 38, 0.25)';
      ctx.beginPath();
      ctx.ellipse(rnd() * TILE, rnd() * TILE, 8 + rnd() * 10, 5 + rnd() * 7, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, seed);
}

function bakeWallTop(seed) {
  return bake(TILE, TILE, (ctx, rnd) => {
    ctx.fillStyle = `hsl(${130 + rnd() * 15}, 9%, ${26 + rnd() * 5}%)`;
    ctx.fillRect(0, 0, TILE, TILE);
    // stone block seams
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    const mid = 14 + rnd() * 20;
    ctx.beginPath();
    ctx.moveTo(0, mid); ctx.lineTo(TILE, mid);
    ctx.moveTo(TILE * (0.3 + rnd() * 0.4), 0); ctx.lineTo(TILE * (0.3 + rnd() * 0.4), mid);
    ctx.moveTo(TILE * (0.3 + rnd() * 0.4), mid); ctx.lineTo(TILE * (0.3 + rnd() * 0.4), TILE);
    ctx.stroke();
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `hsla(${120 + rnd() * 30}, ${8 + rnd() * 10}%, ${20 + rnd() * 18}%, .5)`;
      ctx.fillRect(rnd() * TILE, rnd() * TILE, 2, 2);
    }
    // moss creeping from edges
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = `hsla(${100 + rnd() * 25}, 35%, ${16 + rnd() * 10}%, ${0.35 + rnd() * 0.3})`;
      const edge = rnd();
      const x = edge < 0.5 ? rnd() * TILE : (rnd() < 0.5 ? 0 : TILE);
      const y = edge < 0.5 ? (rnd() < 0.5 ? 0 : TILE) : rnd() * TILE;
      ctx.beginPath();
      ctx.ellipse(x, y, 5 + rnd() * 9, 4 + rnd() * 6, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(0, 0, TILE, 3);
  }, seed);
}

function bakeWater() {
  return bake(TILE, TILE, (ctx, rnd) => {
    const g = ctx.createLinearGradient(0, 0, 0, TILE);
    g.addColorStop(0, '#0d2a3d');
    g.addColorStop(1, '#0a2030');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, TILE, TILE);
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(90, 160, 200, ${0.04 + rnd() * 0.07})`;
      ctx.fillRect(rnd() * TILE, rnd() * TILE, 6 + rnd() * 14, 1.5);
    }
  }, 7);
}

function bakeSandbags() {
  return bake(TILE, TILE, (ctx, rnd) => {
    ctx.clearRect(0, 0, TILE, TILE);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(TILE / 2, TILE - 7, 20, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    const bag = (x, y, w, h, hue) => {
      ctx.fillStyle = `hsl(${hue}, 26%, ${30 + rnd() * 7}%)`;
      ctx.beginPath();
      ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.ellipse(x - 1, y - h * 0.35, w * 0.6, h * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    bag(13, 36, 11, 7, 42); bag(34, 36, 11, 7, 38);
    bag(24, 36, 11, 7, 40);
    bag(18, 26, 11, 7, 44); bag(31, 26, 11, 7, 41);
    bag(24, 17, 11, 7, 39);
  }, 11);
}

const BAKERS = {
  grass0: () => bakeGrass(101), grass1: () => bakeGrass(102), grass2: () => bakeGrass(103),
  grass3: () => bakeGrass(104), grass4: () => bakeGrass(105), grass5: () => bakeGrass(106),
  wall0: () => bakeWallTop(201), wall1: () => bakeWallTop(202), wall2: () => bakeWallTop(203),
  water: bakeWater,
  sandbags: bakeSandbags,
};

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

// stylized helmet-and-visor portrait; replace with /assets/portrait_<id>.png
export function drawPortrait(canvas, ch, size = 56) {
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  loadImage(`/assets/portrait_${ch.id}.png`)
    .then(img => ctx.drawImage(img, 0, 0, size, size))
    .catch(() => {
      const s = size / 56;
      const g = ctx.createLinearGradient(0, 0, 0, size);
      g.addColorStop(0, '#15241e');
      g.addColorStop(1, '#0a120e');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = 'rgba(110,220,190,0.25)';
      ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
      ctx.save();
      ctx.scale(s, s);
      // shoulders
      ctx.fillStyle = shade(ch.color, -45);
      ctx.beginPath();
      ctx.ellipse(28, 56, 22, 14, 0, Math.PI, 0);
      ctx.fill();
      // neck + head
      ctx.fillStyle = '#a9876a';
      ctx.fillRect(24, 36, 8, 8);
      ctx.beginPath();
      ctx.ellipse(28, 28, 11, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      // helmet
      ctx.fillStyle = ch.color;
      ctx.beginPath();
      ctx.arc(28, 24, 13, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(15, 23, 26, 4);
      // glowing visor
      ctx.fillStyle = 'rgba(140,255,235,0.95)';
      ctx.shadowColor = '#7dfde4';
      ctx.shadowBlur = 6;
      ctx.fillRect(18, 29, 20, 3.5);
      ctx.restore();
    });
}

export function drawWeaponIcon(canvas, chOrWeapon) {
  const weapon = chOrWeapon.weapon || chOrWeapon;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (chOrWeapon.id) {
    loadCached(`/assets/weapon_${chOrWeapon.id}.png`)
      .then(img => ctx.drawImage(img, 0, 0, W, H))
      .catch(() => {});
  }
  ctx.save();
  ctx.translate(20, H / 2);
  ctx.fillStyle = '#9fb3aa';
  ctx.strokeStyle = '#5f7068';
  // generic rifle silhouette, scaled by range
  const len = 70 + Math.min(50, weapon.range * 5);
  ctx.fillRect(0, -3, len, 6);                    // barrel/receiver
  ctx.fillRect(len - 14, -6, 14, 4);              // muzzle
  ctx.fillRect(18, 3, 8, 12);                     // grip
  ctx.beginPath();                                // stock
  ctx.moveTo(0, -4); ctx.lineTo(-13, 8); ctx.lineTo(-4, 9); ctx.lineTo(4, 3);
  ctx.closePath(); ctx.fill();
  if (weapon.count > 1) { ctx.fillRect(34, 3, 6, 9); }   // extra mag for spread guns
  ctx.fillStyle = 'rgba(140,255,235,0.8)';
  ctx.fillRect(len * 0.45, -6, 10, 3);            // sight glow
  ctx.restore();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

export function addEventFX(ev) {
  const burst = (n, color, speed = 120, life = 0.4) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      particles.push({ x: ev.x, y: ev.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color });
    }
  };
  if (ev.type === 'shoot') flashes.push({ x: ev.x, y: ev.y, life: 0.07, who: ev.who });
  else if (ev.type === 'hit') burst(6, '#ffd54f');
  else if (ev.type === 'hitWall' || ev.type === 'shield') burst(5, '#9aa89f', 90, 0.25);
  else if (ev.type === 'explode') { burst(28, '#ffb74d', 240, 0.65); shake = Math.max(shake, 8); }
  else if (ev.type === 'die') { burst(20, '#ff8a65', 190, 0.6); popups.push({ x: ev.x, y: ev.y - 20, text: `+${ev.points || 100} x${ev.combo || 1}`, life: 0.75, max: 0.75, color: '#ffc54d' }); shake = Math.max(shake, 4); }
  else if (ev.type === 'down') { burst(14, '#ffffff', 150, 0.6); shake = Math.max(shake, 6); }
  else if (ev.type === 'pickup') { burst(10, '#80ffd0', 100, 0.5); popups.push({ x: ev.x, y: ev.y - 20, text: 'RESCUE', life: 0.8, max: 0.8, color: '#80ffd0' }); }
  else if (ev.type === 'extract') { burst(18, '#69f0ae', 170, 0.7); popups.push({ x: ev.x, y: ev.y - 22, text: `+${ev.points || 250}`, life: 0.9, max: 0.9, color: '#69f0ae' }); }
  else if (ev.type === 'spawn') burst(10, '#3fd9c0', 120, 0.5);
  else if (ev.type === 'spawnEnemy') burst(8, '#ff7043', 110, 0.45);
  else if (ev.type === 'alert') popups.push({ x: ev.x, y: ev.y - 26, text: '!', life: 0.6, max: 0.6, color: '#ff6e5a' });
  // screen-space: the camera may be anywhere on a big map when time runs low
  else if (ev.type === 'lowTime') popups.push({ screen: true, x: 0, y: 0, text: 'LOW TIME', life: 1.4, max: 1.4, color: '#ff7a6a' });
}

function drawSoldier(ctx, x, y, fx, fy, color, t, isMe, invuln) {
  const ang = Math.atan2(fy, fx);
  ctx.save();
  // compose with the caller's alpha (sleeping enemies are drawn dimmed)
  const base = ctx.globalAlpha;
  if (invuln > 0) ctx.globalAlpha = base * (0.5 + 0.3 * Math.sin(t * 16));
  // drop shadow
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(x, y + 12, 13, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // selection ring (like the screenshot's colored circles)
  ctx.strokeStyle = color;
  ctx.globalAlpha *= isMe ? 1 : 0.65;
  ctx.lineWidth = isMe ? 2.5 : 1.5;
  ctx.shadowColor = color;
  ctx.shadowBlur = isMe ? 10 : 5;
  ctx.beginPath();
  ctx.ellipse(x, y + 9, 17, 8, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = base * (invuln > 0 ? 0.5 + 0.3 * Math.sin(t * 16) : 1);
  ctx.shadowBlur = 0;
  ctx.translate(x, y);
  ctx.rotate(ang + Math.PI / 2);
  // body / armor
  ctx.fillStyle = shade(color, -60);
  ctx.beginPath();
  ctx.ellipse(0, 0, 10, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, -1, 8, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  // shoulder pads
  ctx.fillStyle = shade(color, -35);
  ctx.beginPath(); ctx.arc(-8, 0, 4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(8, 0, 4, 0, Math.PI * 2); ctx.fill();
  // rifle held forward-right
  ctx.fillStyle = '#3b3f3d';
  ctx.fillRect(4, -18, 3.5, 16);
  ctx.fillStyle = '#565d59';
  ctx.fillRect(4, -10, 3.5, 5);
  // helmet
  ctx.fillStyle = shade(color, 25);
  ctx.beginPath();
  ctx.arc(0, -3, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.arc(0, -3, 5.5, Math.PI * 0.15, Math.PI * 0.85);
  ctx.fill();
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

export function render(ctx, snap, charMap, focusPids, t, dt) {
  const focus = focusPids instanceof Set ? focusPids
    : new Set(Array.isArray(focusPids) ? focusPids : [focusPids]);
  // particles & muzzle flashes
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
    popups[i].y -= 24 * dt;
    popups[i].life -= dt;
    if (popups[i].life <= 0) popups.splice(i, 1);
  }

  cam.vw = ctx.canvas.width;
  cam.vh = ctx.canvas.height;
  const VW = cam.vw, VH = cam.vh;
  computeCamera(snap, focus, dt);
  const z = cam.z;

  ctx.fillStyle = '#0a0f0b';
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

  // --- terrain ---
  for (let y = ty0; y <= ty1; y++) {
    for (let x = tx0; x <= tx1; x++) {
      const c = snap.grid[y][x];
      const px = x * TILE, py = y * TILE;
      const v = (x * 7 + y * 13) % 6;
      if (c === '~') {
        ctx.drawImage(tex.water, px, py);
        ctx.fillStyle = 'rgba(140, 200, 255, 0.10)';
        const wob = Math.sin(t * 1.8 + x * 1.1 + y * 0.6) * 5;
        ctx.fillRect(px + 5, py + TILE / 2 + wob, TILE - 10, 2);
      } else {
        ctx.drawImage(tex['grass' + v], px, py);
      }
      if (c === 'E') {
        ctx.fillStyle = 'rgba(8, 20, 12, 0.75)';
        ctx.fillRect(px, py, TILE, TILE);
        const pulse = 0.5 + 0.5 * Math.sin(t * 3);
        ctx.save();
        ctx.shadowColor = '#69f0ae';
        ctx.shadowBlur = 16 + pulse * 12;
        ctx.strokeStyle = `rgba(105,240,174,${0.55 + 0.4 * pulse})`;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(px + 7, py + 7, TILE - 14, TILE - 14);
        ctx.strokeRect(px + 14, py + 14, TILE - 28, TILE - 28);
        ctx.restore();
      }
      if (c === 'o') ctx.drawImage(tex.sandbags, px, py);
    }
  }

  // --- walls (pseudo-3D: dark side face below the top face) ---
  for (let y = ty0; y <= ty1; y++) {
    for (let x = tx0; x <= tx1; x++) {
      if (snap.grid[y][x] !== '#') continue;
      const px = x * TILE, py = y * TILE;
      const v = (x * 5 + y * 11) % 3;
      const below = y + 1 < snap.h ? snap.grid[y + 1][x] : '#';
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(px + 4, py + 6, TILE, TILE);
      ctx.drawImage(tex['wall' + v], px, py - 6, TILE, TILE);
      if (below !== '#') {
        ctx.fillStyle = '#1b231d';
        ctx.fillRect(px, py + TILE - 6, TILE, 6);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(px, py + TILE - 6, TILE, 1);
      }
    }
  }

  // --- EXIT gate sign above exit tiles ---
  const exitCols = exitTiles(snap);
  if (exitCols.length) {
    const minX = Math.min(...exitCols.map(e => e.x)), maxX = Math.max(...exitCols.map(e => e.x));
    const y0 = Math.min(...exitCols.map(e => e.y));
    const cx = ((minX + maxX + 1) / 2) * TILE;
    const sy = y0 * TILE - 14;
    if (inView(cx, sy, 120)) {
      const pulse = 0.6 + 0.4 * Math.sin(t * 2.5);
      ctx.save();
      ctx.fillStyle = 'rgba(6, 14, 9, 0.92)';
      ctx.strokeStyle = `rgba(105,240,174,${pulse})`;
      ctx.lineWidth = 2;
      ctx.shadowColor = '#69f0ae';
      ctx.shadowBlur = 18;
      ctx.fillRect(cx - 42, sy - 13, 84, 24);
      ctx.strokeRect(cx - 42, sy - 13, 84, 24);
      ctx.shadowBlur = 8;
      ctx.fillStyle = `rgba(120,255,180,${0.75 + 0.25 * pulse})`;
      ctx.font = 'bold 15px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('EXIT', cx, sy);
      ctx.restore();
    }
  }

  // --- captives ---
  for (const c of snap.captives) {
    if (!inView(c.x, c.y)) continue;
    const col = charMap[c.charId]?.color || '#fff';
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    drawSoldier(ctx, c.x, c.y, 0, 1, col, t, false, 0);
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.arc(c.x, c.y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (!c.owner) {
      ctx.save();
      ctx.shadowColor = '#69f0ae';
      ctx.shadowBlur = 8;
      ctx.fillStyle = `rgba(140,255,190,${0.6 + 0.4 * pulse})`;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('▼ RESCUE', c.x, c.y - 24 - pulse * 2);
      ctx.restore();
    }
  }

  // --- enemy telegraphs ---
  for (const e of snap.enemies) {
    // margin covers the longest possible aim segment (range + target drift)
    if (e.kind === 'sniper' && e.aimT > 0 && (inView(e.x, e.y, 800) || inView(e.aimX, e.aimY, 100))) {
      ctx.save();
      ctx.strokeStyle = `rgba(255,120,180,${0.35 + 0.2 * Math.sin(t * 24)})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.aimX, e.aimY);
      ctx.stroke();
      ctx.restore();
    }
  }

  // --- enemies (red team, health bars like the screenshot) ---
  for (const e of snap.enemies) {
    if (!inView(e.x, e.y)) continue;
    const color = ENEMY_STYLE[e.kind] || ENEMY_STYLE.grunt;
    const asleep = e.awake === false;
    if (asleep) ctx.globalAlpha = 0.78;
    drawSoldier(ctx, e.x, e.y, e.fx, e.fy, color, t, false, e.hurt > 0 ? 0.12 : 0);
    if (asleep) ctx.globalAlpha = 1;
    if (e.kind === 'bulwark') {
      ctx.strokeStyle = 'rgba(220,245,255,0.75)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 21, Math.atan2(e.fy, e.fx) - 0.9, Math.atan2(e.fy, e.fx) + 0.9);
      ctx.stroke();
    } else if (e.kind === 'boss') {
      ctx.strokeStyle = 'rgba(255,190,120,0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(e.x, e.y + 4, 26 + Math.sin(t * 5) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    const maxHp = e.maxHp || 1;
    if (e.hp < maxHp) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(e.x - 13, e.y - 24, 26, 4);
      ctx.fillStyle = '#e53935';
      ctx.fillRect(e.x - 12, e.y - 23, 24 * (e.hp / maxHp), 2);
    }
  }

  // --- players ---
  for (const p of snap.players) {
    if (p.state !== 'active') continue;
    const col = charMap[p.charId]?.color || '#fff';
    drawSoldier(ctx, p.x, p.y, p.fx, p.fy, col, t, focus.has(p.pid), p.invuln);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(p.name.toUpperCase(), p.x, p.y - 26);
  }

  // --- tracer shots ---
  for (const s of snap.shots) {
    if (!inView(s.x, s.y)) continue;
    const sp = Math.hypot(s.vx, s.vy) || 1;
    const nx = s.vx / sp, ny = s.vy / sp;
    const col = s.who === 'p' ? '#ffe9a8' : '#ff8a80';
    ctx.save();
    ctx.strokeStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 10;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x - nx * 12, s.y - ny * 12);
    ctx.lineTo(s.x, s.y);
    ctx.stroke();
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

  for (const p of popups) {
    if (p.screen) continue;
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;

  // --- additive glows (world space) ---
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const f of flashes) {
    if (!inView(f.x, f.y)) continue;
    const a = f.life / 0.07;
    const fg = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 34);
    fg.addColorStop(0, `rgba(255,220,140,${0.5 * a})`);
    fg.addColorStop(1, 'rgba(255,220,140,0)');
    ctx.fillStyle = fg;
    ctx.fillRect(f.x - 34, f.y - 34, 68, 68);
  }
  for (const e of exitCols) {
    const px = (e.x + 0.5) * TILE, py = (e.y + 0.5) * TILE;
    if (!inView(px, py, 120)) continue;
    const eg = ctx.createRadialGradient(px, py, 0, px, py, 60);
    eg.addColorStop(0, 'rgba(60,200,120,0.12)');
    eg.addColorStop(1, 'rgba(60,200,120,0)');
    ctx.fillStyle = eg;
    ctx.fillRect(px - 60, py - 60, 120, 120);
  }
  ctx.restore();
  ctx.restore();

  // --- vignette (screen space) ---
  const vg = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.32, VW / 2, VH / 2, VH * 0.85);
  vg.addColorStop(0, 'rgba(4,8,5,0)');
  vg.addColorStop(1, 'rgba(2,5,3,0.6)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, VW, VH);

  // --- screen-space banners (e.g. LOW TIME) ---
  for (const p of popups) {
    if (!p.screen) continue;
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.font = 'bold 26px monospace';
    ctx.textAlign = 'center';
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 12;
    ctx.fillText(p.text, VW / 2, 64);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;

  // --- offscreen pointers: teammates, stranded captives, the exit ---
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
  for (const { c } of farCaptives) drawEdgeArrow(ctx, c.x, c.y, '#69f0ae', 'RESCUE');
  if (exitCols.length) {
    let near = null, best = Infinity;
    for (const e of exitCols) {
      const px = (e.x + 0.5) * TILE, py = (e.y + 0.5) * TILE;
      const d = (px - cam.x) ** 2 + (py - cam.y) ** 2;
      if (d < best) { best = d; near = { px, py }; }
    }
    if (near && !inView(near.px, near.py, -20)) drawEdgeArrow(ctx, near.px, near.py, '#ffc54d', 'EXIT');
  }
}

// Static minimap backdrop is baked once per level and reused every frame.
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
    mctx.fillStyle = '#06110c';
    mctx.fillRect(0, 0, W, H);
    for (let y = 0; y < snap.h; y++) {
      for (let x = 0; x < snap.w; x++) {
        const ch = snap.grid[y][x];
        if (ch === '#') mctx.fillStyle = '#27332a';
        else if (ch === '~') mctx.fillStyle = '#0e2738';
        else if (ch === 'E') mctx.fillStyle = '#2e7d4f';
        else if (ch === 'o') mctx.fillStyle = '#4a4232';
        else continue;
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
  for (const e of snap.enemies) {
    if (e.awake === false) ctx.globalAlpha = 0.45;
    dot(e.x, e.y, '#e53935', 2);
    ctx.globalAlpha = 1;
  }
  for (const c of snap.captives) if (!c.owner) dot(c.x, c.y, '#69f0ae');
  for (const p of snap.players) if (p.state === 'active') dot(p.x, p.y, focus.has(p.pid) ? '#ffffff' : '#3fd9c0', 3);
  // camera viewport rectangle
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(
    (cam.x - cam.vw / 2 / cam.z) * sx,
    (cam.y - cam.vh / 2 / cam.z) * sy,
    (cam.vw / cam.z) * sx,
    (cam.vh / cam.z) * sy
  );
  ctx.strokeStyle = 'rgba(110,220,190,0.3)';
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
}
