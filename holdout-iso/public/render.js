// Isometric pixel renderer: 2:1 diamond projection drawn at native low res,
// upscaled 2x by CSS with image-rendering: pixelated.
// The sim stays on its orthogonal grid (TILE=48 world px); this module only
// changes how it's drawn. World (x, y) -> tile floats -> iso screen coords.
import { TILE } from '/shared/game.js';

const TW = 80;          // iso tile width  (diamond)
const TH = 40;          // iso tile height (diamond)
const WALL_H = 42;      // wall block height
const CRATE_H = 20;
const VIEW_W = 416;
const VIEW_H = 900;
const SPRITE_SCALE = 2;

let offX = 0, offY = 0; // projection origin, set per-frame from grid size

function isoPt(tx, ty) {
  return [offX + (tx - ty) * (TW / 2), offY + (tx + ty) * (TH / 2)];
}
const isoWorld = (x, y) => isoPt(x / TILE, y / TILE);

const particles = [];   // stored in world coords, projected at draw time
const flashes = [];
const popups = [];
let shake = 0;

const ENEMY_COLORS = {
  grunt: '#d4452f',
  archer: '#8e3fd9',
  charger: '#ef8f2f',
  bulwark: '#607d8b',
  spawner: '#3fa95b',
  sniper: '#d93678',
  skitter: '#ff7043',
  boss: '#9b263b',
};

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (x, y) => mulberry32(x * 374761 + y * 668265)();

// --- 8x10 pixel soldier sprite, palette-swapped (same art as CYBER) ---
const SOLDIER = [
  '..HHHH..',
  '.HHHHHH.',
  '.HVVVVH.',
  '..FFFF..',
  '.BBBBBB.',
  'bBBBBBBb',
  'bBBBBBBb',
  '.bb..bb.',
  '.LL..LL.',
  '.LL..LL.',
];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const cl = v => Math.max(0, Math.min(255, v));
const rgb = (c, amt = 0) => `rgb(${cl(c[0] + amt)},${cl(c[1] + amt)},${cl(c[2] + amt)})`;

function bake(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  fn(ctx);
  return c;
}

function bakeSoldier(color, visor = '#7dfde4') {
  const c = hexToRgb(color);
  const pal = {
    B: rgb(c), b: rgb(c, -55), H: rgb(c, 35), V: visor,
    F: '#c79b73', G: '#3a4a46', L: rgb(c, -80),
  };
  return bake(8, 10, (ctx) => {
    for (let y = 0; y < SOLDIER.length; y++) {
      for (let x = 0; x < 8; x++) {
        const ch = SOLDIER[y][x];
        if (ch === '.') continue;
        ctx.fillStyle = pal[ch];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
}

function bakePortrait(color) {
  const c = hexToRgb(color);
  const rnd = mulberry32(77);
  return bake(24, 24, (ctx) => {
    ctx.fillStyle = '#04211e';
    ctx.fillRect(0, 0, 24, 24);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = `rgba(53,224,210,${0.04 + rnd() * 0.05})`;
      ctx.fillRect(0, (rnd() * 24) | 0, 24, 1);
    }
    ctx.fillStyle = rgb(c, -50);
    ctx.fillRect(3, 19, 18, 5);
    ctx.fillStyle = rgb(c, -25);
    ctx.fillRect(3, 19, 18, 1);
    ctx.fillStyle = '#a9876a';
    ctx.fillRect(10, 16, 4, 3);
    ctx.fillStyle = '#c79b73';
    ctx.fillRect(8, 8, 8, 8);
    ctx.fillStyle = '#a9876a';
    ctx.fillRect(8, 14, 8, 2);
    ctx.fillStyle = rgb(c);
    ctx.fillRect(7, 4, 10, 4);
    ctx.fillRect(6, 6, 2, 6);
    ctx.fillRect(16, 6, 2, 6);
    ctx.fillStyle = rgb(c, 40);
    ctx.fillRect(7, 4, 10, 1);
    ctx.fillStyle = '#7dfde4';
    ctx.fillRect(8, 9, 8, 2);
    ctx.fillStyle = 'rgba(125,253,228,0.35)';
    ctx.fillRect(7, 8, 10, 4);
  });
}

const sprites = {};
const portraits = {};
const enemySprites = {};
const isoTiles = {};
let gruntSprite, archerSprite;

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

async function loadIsoTile(key) {
  try { isoTiles[key] = await loadImage(`/assets/${key}.png`); }
  catch {}
}

export async function initTextures(charMap) {
  for (let i = 0; i < 6; i++) await loadIsoTile('floor' + i);
  for (let i = 0; i < 3; i++) await loadIsoTile('wall' + i);
  await loadIsoTile('coolant');
  await loadIsoTile('crate');
  for (const [kind, color] of Object.entries(ENEMY_COLORS)) {
    try { enemySprites[kind] = await loadImage(`/assets/enemy_${kind}.png`); }
    catch { enemySprites[kind] = bakeSoldier(color, kind === 'archer' || kind === 'sniper' ? '#e2b3ff' : '#ffb199'); }
  }
  gruntSprite = enemySprites.grunt;
  archerSprite = enemySprites.archer;
  for (const [id, ch] of Object.entries(charMap)) {
    sprites[id] = bakeSoldier(ch.color);
    portraits[id] = bakePortrait(ch.color);
  }
}

export function drawPortrait(canvas, ch) {
  canvas.width = 24; canvas.height = 24;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const img = new Image();
  img.onload = () => ctx.drawImage(img, 0, 0, 24, 24);
  img.onerror = () => { if (portraits[ch.id]) ctx.drawImage(portraits[ch.id], 0, 0); };
  img.src = `/assets/portrait_${ch.id}.png`;
}

export function addEventFX(ev) {
  const burst = (n, color, speed = 110, life = 0.4) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      particles.push({ x: ev.x, y: ev.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color });
    }
  };
  if (ev.type === 'shoot') flashes.push({ x: ev.x, y: ev.y, life: 0.06 });
  else if (ev.type === 'hit') burst(4, '#ffe26b');
  else if (ev.type === 'hitWall' || ev.type === 'shield') burst(3, '#6fa39b', 80, 0.2);
  else if (ev.type === 'explode') { burst(14, '#ffb84d', 180, 0.55); shake = Math.max(shake, 4); }
  else if (ev.type === 'die') { burst(10, '#ff7a5c', 150, 0.5); popups.push({ x: ev.x, y: ev.y, text: `+${ev.points || 100}`, life: 0.7, max: 0.7, color: '#ffe26b' }); shake = Math.max(shake, 2); }
  else if (ev.type === 'down') { burst(8, '#ffffff', 130, 0.5); shake = Math.max(shake, 3); }
  else if (ev.type === 'pickup') { burst(6, '#4cf08a', 90, 0.4); popups.push({ x: ev.x, y: ev.y, text: 'RESCUE', life: 0.8, max: 0.8, color: '#4cf08a' }); }
  else if (ev.type === 'extract') { burst(10, '#4cf08a', 140, 0.6); popups.push({ x: ev.x, y: ev.y, text: `+${ev.points || 250}`, life: 0.9, max: 0.9, color: '#4cf08a' }); }
  else if (ev.type === 'spawn') burst(6, '#35e0d2', 100, 0.4);
  else if (ev.type === 'spawnEnemy') burst(5, '#ff7043', 100, 0.4);
  else if (ev.type === 'lowTime') popups.push({ x: ev.x, y: ev.y, text: 'LOW TIME', life: 1, max: 1, color: '#ff7a5c' });
}

function diamond(ctx, cx, cy) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - TH / 2);
  ctx.lineTo(cx + TW / 2, cy);
  ctx.lineTo(cx, cy + TH / 2);
  ctx.lineTo(cx - TW / 2, cy);
  ctx.closePath();
}

// raised block: top diamond at cy-h with left/right side faces
function block(ctx, cx, cy, h, top, left, right, inset = 0) {
  const hw = TW / 2 - inset, hh = TH / 2 - inset * 0.5;
  ctx.fillStyle = left;
  ctx.beginPath();
  ctx.moveTo(cx - hw, cy - h);
  ctx.lineTo(cx, cy + hh - h);
  ctx.lineTo(cx, cy + hh);
  ctx.lineTo(cx - hw, cy);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = right;
  ctx.beginPath();
  ctx.moveTo(cx + hw, cy - h);
  ctx.lineTo(cx, cy + hh - h);
  ctx.lineTo(cx, cy + hh);
  ctx.lineTo(cx + hw, cy);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.moveTo(cx, cy - hh - h);
  ctx.lineTo(cx + hw, cy - h);
  ctx.lineTo(cx, cy + hh - h);
  ctx.lineTo(cx - hw, cy - h);
  ctx.closePath();
  ctx.fill();
}

function drawSpriteAt(ctx, sprite, sx, sy, flip) {
  const w = sprite.width * SPRITE_SCALE;
  const h = sprite.height * SPRITE_SCALE;
  const x = (sx | 0) - Math.floor(w / 2);
  const y = (sy | 0) - h + 3;
  ctx.save();
  if (flip) {
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(sprite, 0, 0, w, h);
  } else {
    ctx.drawImage(sprite, x, y, w, h);
  }
  ctx.restore();
}

// project a world-space facing vector to screen space
function screenFacing(fx, fy) {
  const sx = fx - fy, sy = (fx + fy) / 2;
  const m = Math.hypot(sx, sy) || 1;
  return [sx / m, sy / m];
}

function drawGun(ctx, sx, sy, fx, fy) {
  const [gx, gy] = screenFacing(fx, fy);
  ctx.fillStyle = '#3a4a46';
  ctx.fillRect((sx + gx * 10) | 0, ((sy - 8) + gy * 6) | 0, 5, 3);
  ctx.fillRect((sx + gx * 6) | 0, ((sy - 8) + gy * 4) | 0, 5, 3);
}

export function render(ctx, snap, charMap, myPid, t, dt) {
  shake = Math.max(0, shake - dt * 12);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
  for (let i = flashes.length - 1; i >= 0; i--) {
    flashes[i].life -= dt;
    if (flashes[i].life <= 0) flashes.splice(i, 1);
  }
  for (let i = popups.length - 1; i >= 0; i--) {
    popups[i].y -= 30 * dt;
    popups[i].life -= dt;
    if (popups[i].life <= 0) popups.splice(i, 1);
  }

  offX = VIEW_W / 2 - 84;
  offY = 118;
  const W = VIEW_W;
  const H = VIEW_H;
  if (ctx.canvas.width !== W) { ctx.canvas.width = W; ctx.canvas.height = H; }
  ctx.imageSmoothingEnabled = false;
  const bg = ctx.createRadialGradient(W / 2, H * 0.38, 20, W / 2, H * 0.42, H * 0.8);
  bg.addColorStop(0, '#07302d');
  bg.addColorStop(0.48, '#031817');
  bg.addColorStop(1, '#010b0a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  if (shake > 0) ctx.translate(((Math.random() - 0.5) * shake) | 0, ((Math.random() - 0.5) * shake) | 0);

  // --- floor pass ---
  for (let y = 0; y < snap.h; y++) {
    for (let x = 0; x < snap.w; x++) {
      const c = snap.grid[y][x];
      if (c === '#') continue;
      const [cx, cy] = isoPt(x + 0.5, y + 0.5);
      const r = hash(x, y);
      if (c === '~') {
        if (isoTiles.coolant) ctx.drawImage(isoTiles.coolant, cx - TW / 2, cy - TH / 2, TW, TH);
        else {
          diamond(ctx, cx, cy);
          ctx.fillStyle = '#06181f';
          ctx.fill();
        }
        const ph = ((t * 3 + x + y) | 0) % 3;
        ctx.fillStyle = 'rgba(60,220,230,0.3)';
        ctx.fillRect(cx - 6 + ph * 4, cy - 1 + ((x + y) % 2) * 2, 4, 1);
      } else {
        const floor = isoTiles['floor' + ((x * 7 + y * 13) % 6)];
        if (floor) ctx.drawImage(floor, cx - TW / 2, cy - TH / 2, TW, TH);
        else {
          diamond(ctx, cx, cy);
          ctx.fillStyle = `hsl(${172 + r * 8}, ${16 + r * 8}%, ${10 + r * 4}%)`;
          ctx.fill();
          if (r < 0.15) { // grime patch
            ctx.fillStyle = 'rgba(15,35,28,0.6)';
            ctx.fillRect(cx - 5, cy - 2, 8, 3);
          } else if (r > 0.9) { // vent detail
            ctx.fillStyle = 'rgba(53,224,210,0.13)';
            ctx.fillRect(cx - 5, cy - 1, 10, 1);
          }
        }
      }
      // grid seams; some glow teal like the mock
      ctx.strokeStyle = hash(x * 3 + 1, y * 5 + 2) > 0.72
        ? 'rgba(53,241,232,0.75)'
        : 'rgba(0,0,0,0.42)';
      ctx.lineWidth = 1;
      diamond(ctx, cx, cy);
      ctx.stroke();
      if (hash(x * 9 + 4, y * 7 + 3) > 0.9) {
        ctx.strokeStyle = 'rgba(53,241,232,0.46)';
        ctx.beginPath();
        ctx.moveTo(cx - TW * 0.22, cy);
        ctx.lineTo(cx, cy - TH * 0.22);
        ctx.lineTo(cx + TW * 0.22, cy);
        ctx.stroke();
      }
      if (c === 'E') {
        const pulse = (t * 6 | 0) % 2;
        diamond(ctx, cx, cy);
        ctx.fillStyle = pulse ? 'rgba(76,240,138,0.22)' : 'rgba(76,240,138,0.12)';
        ctx.fill();
        ctx.strokeStyle = pulse ? '#4cf08a' : '#2aa55e';
        diamond(ctx, cx, cy);
        ctx.stroke();
      }
    }
  }

  // --- depth-sorted pass: walls, crates, portal, entities ---
  const drawables = [];
  for (let y = 0; y < snap.h; y++) {
    for (let x = 0; x < snap.w; x++) {
      const c = snap.grid[y][x];
      if (c === '#') {
        const r = hash(x, y);
        drawables.push({
          d: x + y + 1,
          fn: () => {
            const [cx, cy] = isoPt(x + 0.5, y + 0.5);
            const l = 14 + r * 4;
            const wall = isoTiles['wall' + ((x * 5 + y * 11) % 3)];
            if (wall) ctx.drawImage(wall, cx - TW / 2, cy - WALL_H - TH / 2, TW, WALL_H + TH);
            else {
              block(ctx, cx, cy, WALL_H,
                `hsl(176, 13%, ${l + 8}%)`, `hsl(176, 14%, ${l}%)`, `hsl(176, 16%, ${l - 6}%)`);
              ctx.strokeStyle = 'rgba(0,0,0,0.35)';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(cx - TW / 2, cy - WALL_H);
              ctx.lineTo(cx, cy + TH / 2 - WALL_H);
              ctx.lineTo(cx + TW / 2, cy - WALL_H);
              ctx.stroke();
            }
            if (r > 0.55) {
              ctx.fillStyle = 'rgba(53,241,232,0.72)';
              ctx.fillRect(cx - 15, cy - WALL_H + 9, 30, 3);
            }
          },
        });
      } else if (c === 'o') {
        drawables.push({
          d: x + y + 1,
          fn: () => {
            const [cx, cy] = isoPt(x + 0.5, y + 0.5);
            if (isoTiles.crate) ctx.drawImage(isoTiles.crate, cx - TW / 2, cy - CRATE_H - TH / 2, TW, CRATE_H + TH);
            else {
              block(ctx, cx, cy, CRATE_H, '#2f5650', '#23413c', '#16302c', 5);
              ctx.fillStyle = 'rgba(53,224,210,0.5)';
              ctx.fillRect(cx - 1, cy - CRATE_H, 2, 2);
            }
          },
        });
      }
    }
  }

  for (const c of snap.captives) {
    drawables.push({
      d: (c.x + c.y) / TILE + 100,
      fn: () => {
        const [sx, sy] = isoWorld(c.x, c.y);
        const spr = sprites[c.charId] || gruntSprite;
        ctx.globalAlpha = 0.85;
        drawSpriteAt(ctx, spr, sx, sy, false);
        ctx.globalAlpha = 1;
        if (!c.owner && ((t * 2) | 0) % 2) {
          ctx.fillStyle = '#4cf08a';
          ctx.font = 'bold 13px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('!', sx, sy - 26);
        }
      },
    });
  }

  for (const e of snap.enemies) {
    drawables.push({
      d: (e.x + e.y) / TILE + 100,
      fn: () => {
        const [sx, sy] = isoWorld(e.x, e.y);
        const [sfx] = screenFacing(e.fx, e.fy);
        drawSpriteAt(ctx, enemySprites[e.kind] || gruntSprite, sx, sy, sfx < -0.3);
        drawGun(ctx, sx, sy, e.fx, e.fy);
        if (e.kind === 'bulwark') {
          ctx.fillStyle = '#d7eef2';
          ctx.fillRect((sx + sfx * 12) | 0, (sy - 21) | 0, 3, 17);
        } else if (e.kind === 'boss') {
          ctx.strokeStyle = '#ffb84d';
          ctx.strokeRect(sx - 17.5, sy - 32.5, 35, 36);
        }
        const maxHp = e.maxHp || 1;
        if (e.hp < maxHp) {
          ctx.fillStyle = '#330b06';
          ctx.fillRect(sx - 10, sy - 30, 20, 4);
          ctx.fillStyle = '#e85d4a';
          ctx.fillRect(sx - 9, sy - 29, (18 * e.hp / maxHp) | 0, 2);
        }
      },
    });
  }

  for (const p of snap.players) {
    if (p.state !== 'active') continue;
    drawables.push({
      d: (p.x + p.y) / TILE + 100,
      fn: () => {
        const [sx, sy] = isoWorld(p.x, p.y);
        // ground diamond marker in the character's color
        const ch = charMap[p.charId];
        ctx.strokeStyle = ch ? ch.color : '#fff';
        ctx.globalAlpha = p.pid === myPid ? 0.9 : 0.45;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, sy - 8);
        ctx.lineTo(sx + 16, sy);
        ctx.lineTo(sx, sy + 8);
        ctx.lineTo(sx - 16, sy);
        ctx.closePath();
        ctx.stroke();
        ctx.globalAlpha = 1;
        const [sfx] = screenFacing(p.fx, p.fy);
        drawSpriteAt(ctx, sprites[p.charId] || gruntSprite, sx, sy, sfx < -0.3);
        drawGun(ctx, sx, sy, p.fx, p.fy);
        if (p.pid === myPid) {
          const blink = ((t * 3) | 0) % 2;
          ctx.fillStyle = blink ? '#35e0d2' : '#1a7f78';
          ctx.fillRect(sx - 15, sy - 32, 6, 2); ctx.fillRect(sx - 15, sy - 32, 2, 6);
          ctx.fillRect(sx + 9, sy - 32, 6, 2); ctx.fillRect(sx + 13, sy - 32, 2, 6);
        }
      },
    });
  }

  drawables.sort((a, b) => a.d - b.d);
  for (const d of drawables) d.fn();

  // --- enemy telegraphs ---
  for (const e of snap.enemies) {
    if (e.kind === 'sniper' && e.aimT > 0) {
      const [sx, sy] = isoWorld(e.x, e.y);
      const [tx, ty] = isoWorld(e.aimX, e.aimY);
      ctx.strokeStyle = ((t * 12) | 0) % 2 ? '#ff7ab0' : '#7a254b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 6);
      ctx.lineTo(tx, ty - 6);
      ctx.stroke();
    }
  }

  // --- EXIT sign billboard over the portal ---
  const exits = [];
  for (let y = 0; y < snap.h; y++)
    for (let x = 0; x < snap.w; x++)
      if (snap.grid[y][x] === 'E') exits.push({ x, y });
  if (exits.length) {
    const avg = exits.reduce((a, e) => ({ x: a.x + e.x, y: a.y + e.y }), { x: 0, y: 0 });
    const [cx, cy] = isoPt(avg.x / exits.length + 0.5, avg.y / exits.length + 0.5);
    const pulse = 0.5 + 0.5 * Math.sin(t * 5);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(cx, cy - 52, 0, cx, cy - 52, 92);
    glow.addColorStop(0, `rgba(76,240,138,${0.34 + pulse * 0.16})`);
    glow.addColorStop(1, 'rgba(76,240,138,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - 100, cy - 150, 200, 210);
    ctx.restore();

    ctx.fillStyle = '#062b25';
    ctx.strokeStyle = '#35f1e8';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx - 42, cy - 8);
    ctx.lineTo(cx - 42, cy - 82);
    ctx.quadraticCurveTo(cx, cy - 118, cx + 42, cy - 82);
    ctx.lineTo(cx + 42, cy - 8);
    ctx.lineTo(cx + 28, cy + 2);
    ctx.lineTo(cx - 28, cy + 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = `rgba(76,240,138,${0.7 + pulse * 0.3})`;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 48, 26 + pulse * 4, 43, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(76,240,138,${0.38 + pulse * 0.2})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(cx + 6, cy - 48, 13 + pulse * 5, 34, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(76,240,138,${0.22 + pulse * 0.16})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 48, 18, 34, 0, 0, Math.PI * 2);
    ctx.fill();

    const sy = cy - 122;
    ctx.fillStyle = '#063d34';
    ctx.fillRect(cx - 38, sy - 12, 76, 25);
    ctx.strokeStyle = '#4cf08a';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - 37, sy - 11, 74, 23);
    ctx.fillStyle = '#a4fff2';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('EXIT', cx, sy);
    ctx.textBaseline = 'alphabetic';
  }

  // --- shots, flashes, particles (projected, drawn on top) ---
  for (const s of snap.shots) {
    const [sx, sy] = isoWorld(s.x, s.y);
    ctx.fillStyle = s.who === 'p' ? '#ffe9a8' : '#ff7a5c';
    ctx.fillRect((sx | 0) - 2, (sy - 12) | 0, 5, 5);
    const sp = Math.hypot(s.vx, s.vy) || 1;
    const [tx, ty] = isoWorld(s.x - (s.vx / sp) * 12, s.y - (s.vy / sp) * 12);
    ctx.fillStyle = s.who === 'p' ? 'rgba(255,233,168,0.4)' : 'rgba(255,122,92,0.4)';
    ctx.fillRect((tx | 0) - 1, (ty - 12) | 0, 4, 4);
  }
  for (const f of flashes) {
    const [sx, sy] = isoWorld(f.x, f.y);
    ctx.fillStyle = 'rgba(255,236,160,0.9)';
    ctx.fillRect((sx | 0) - 3, (sy | 0) - 16, 7, 7);
  }
  for (const p of particles) {
    if (((p.life * 20) | 0) % 2) continue;
    const [sx, sy] = isoWorld(p.x, p.y);
    ctx.fillStyle = p.color;
    ctx.fillRect(sx | 0, (sy - 10) | 0, 3, 3);
  }
  for (const p of popups) {
    const [sx, sy] = isoWorld(p.x, p.y);
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = ((p.life * 16) | 0) % 2 ? p.color : '#eafffb';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(p.text, sx | 0, (sy - 34) | 0);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
