// Pixel-art renderer: 16px tiles drawn at native resolution onto a 320x224
// canvas, upscaled 3x by CSS with image-rendering: pixelated.
// World coords from the sim are in 48px tiles; everything here divides by 3.
import { TILE } from '/shared/game.js';

const PX = TILE / 3;       // 16 — on-screen tile size
const S = 1 / 3;           // world -> pixel scale
const particles = [];
const flashes = [];
const popups = [];
let shake = 0;
const tiles = {};

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

function bake(w, h, fn, seed = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  fn(ctx, mulberry32(seed));
  return c;
}

// --- 16x16 sci-fi floor/wall tiles ---
function bakeFloor(seed) {
  return bake(PX, PX, (ctx, rnd) => {
    ctx.fillStyle = `hsl(${172 + rnd() * 8}, ${18 + rnd() * 8}%, ${10 + rnd() * 3}%)`;
    ctx.fillRect(0, 0, PX, PX);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, PX, 1);
    ctx.fillRect(0, 0, 1, PX);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = `hsla(${170 + rnd() * 12}, 20%, ${8 + rnd() * 12}%, .8)`;
      ctx.fillRect((rnd() * PX) | 0, (rnd() * PX) | 0, 1, 1);
    }
    if (rnd() < 0.18) { // vent/panel detail
      ctx.fillStyle = 'rgba(53,224,210,0.12)';
      ctx.fillRect(4, 7, 8, 1);
      ctx.fillRect(4, 10, 8, 1);
    }
    if (rnd() < 0.1) { // grime
      ctx.fillStyle = 'rgba(20,40,30,0.5)';
      ctx.fillRect((rnd() * 10) | 0, (rnd() * 10) | 0, 4, 3);
    }
  }, seed);
}

function bakeWall(seed) {
  return bake(PX, PX, (ctx, rnd) => {
    ctx.fillStyle = `hsl(${175 + rnd() * 8}, 14%, ${17 + rnd() * 3}%)`;
    ctx.fillRect(0, 0, PX, PX);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, 0, PX, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, PX - 2, PX, 2);
    ctx.fillRect(PX - 1, 0, 1, PX);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, 7 + ((rnd() * 3) | 0), PX, 1);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = `hsla(168, 20%, ${22 + rnd() * 10}%, .6)`;
      ctx.fillRect((rnd() * PX) | 0, (rnd() * PX) | 0, 2, 1);
    }
    if (rnd() < 0.25) { // warning stripe / light
      ctx.fillStyle = 'rgba(53,224,210,0.35)';
      ctx.fillRect(2, 3, 2, 1);
    }
  }, seed);
}

function bakeCoolant() {
  return bake(PX, PX, (ctx, rnd) => {
    ctx.fillStyle = '#06181f';
    ctx.fillRect(0, 0, PX, PX);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `rgba(40, 180, 200, ${0.1 + rnd() * 0.15})`;
      ctx.fillRect((rnd() * PX) | 0, (rnd() * PX) | 0, 2 + ((rnd() * 4) | 0), 1);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, PX, 1);
  }, 31);
}

function bakeCrate() {
  return bake(PX, PX, (ctx) => {
    ctx.clearRect(0, 0, PX, PX);
    ctx.fillStyle = '#23413c';
    ctx.fillRect(2, 3, 12, 11);
    ctx.fillStyle = '#2f5650';
    ctx.fillRect(2, 3, 12, 2);
    ctx.fillStyle = '#16302c';
    ctx.fillRect(2, 12, 12, 2);
    ctx.strokeStyle = '#0c211e';
    ctx.lineWidth = 1;
    ctx.strokeRect(2.5, 3.5, 11, 10);
    ctx.fillStyle = 'rgba(53,224,210,0.5)';
    ctx.fillRect(7, 7, 2, 2);
  }, 41);
}

// --- 8x10 pixel soldier sprite, palette-swapped per character ---
// B body, b body-dark, H helmet, V visor, F skin, G gun, L legs
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

// --- 24x24 pixel portrait: helmeted bust on dark backdrop ---
function bakePortrait(color) {
  const c = hexToRgb(color);
  return bake(24, 24, (ctx, rnd) => {
    ctx.fillStyle = '#04211e';
    ctx.fillRect(0, 0, 24, 24);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = `rgba(53,224,210,${0.04 + rnd() * 0.05})`;
      ctx.fillRect(0, (rnd() * 24) | 0, 24, 1);
    }
    // shoulders
    ctx.fillStyle = rgb(c, -50);
    ctx.fillRect(3, 19, 18, 5);
    ctx.fillStyle = rgb(c, -25);
    ctx.fillRect(3, 19, 18, 1);
    // neck + face
    ctx.fillStyle = '#a9876a';
    ctx.fillRect(10, 16, 4, 3);
    ctx.fillStyle = '#c79b73';
    ctx.fillRect(8, 8, 8, 8);
    // jaw shadow
    ctx.fillStyle = '#a9876a';
    ctx.fillRect(8, 14, 8, 2);
    // helmet
    ctx.fillStyle = rgb(c);
    ctx.fillRect(7, 4, 10, 4);
    ctx.fillRect(6, 6, 2, 6);
    ctx.fillRect(16, 6, 2, 6);
    ctx.fillStyle = rgb(c, 40);
    ctx.fillRect(7, 4, 10, 1);
    // visor glow band
    ctx.fillStyle = '#7dfde4';
    ctx.fillRect(8, 9, 8, 2);
    ctx.fillStyle = 'rgba(125,253,228,0.35)';
    ctx.fillRect(7, 8, 10, 4);
  }, 77);
}

const sprites = {};   // charId -> soldier sprite
const portraits = {}; // charId -> 24x24 portrait

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

async function loadOrBake(key, bakeFn) {
  try { tiles[key] = await loadImage(`/assets/${key}.png`); }
  catch { tiles[key] = bakeFn(); }
}

export async function initTextures(charMap) {
  for (let i = 0; i < 6; i++) await loadOrBake('floor' + i, () => bakeFloor(300 + i));
  for (let i = 0; i < 3; i++) await loadOrBake('wall' + i, () => bakeWall(400 + i));
  await loadOrBake('coolant', bakeCoolant);
  await loadOrBake('crate', bakeCrate);
  for (const [kind, color] of Object.entries(ENEMY_COLORS)) {
    try { tiles[kind] = await loadImage(`/assets/enemy_${kind}.png`); }
    catch { tiles[kind] = bakeSoldier(color, kind === 'archer' || kind === 'sniper' ? '#e2b3ff' : '#ffb199'); }
  }
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
  const burst = (n, color, speed = 40, life = 0.4) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      particles.push({ x: ev.x * S, y: ev.y * S, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color });
    }
  };
  if (ev.type === 'shoot') flashes.push({ x: ev.x * S, y: ev.y * S, life: 0.06 });
  else if (ev.type === 'hit') burst(4, '#ffe26b');
  else if (ev.type === 'hitWall' || ev.type === 'shield') burst(3, '#6fa39b', 28, 0.2);
  else if (ev.type === 'explode') { burst(14, '#ffb84d', 70, 0.55); shake = Math.max(shake, 4); }
  else if (ev.type === 'die') { burst(10, '#ff7a5c', 55, 0.5); popups.push({ x: ev.x * S, y: ev.y * S - 7, text: `+${ev.points || 100}`, life: 0.7, max: 0.7, color: '#ffe26b' }); shake = Math.max(shake, 2); }
  else if (ev.type === 'down') { burst(8, '#ffffff', 45, 0.5); shake = Math.max(shake, 3); }
  else if (ev.type === 'pickup') { burst(6, '#4cf08a', 30, 0.4); popups.push({ x: ev.x * S, y: ev.y * S - 7, text: 'RESCUE', life: 0.8, max: 0.8, color: '#4cf08a' }); }
  else if (ev.type === 'extract') { burst(10, '#4cf08a', 50, 0.6); popups.push({ x: ev.x * S, y: ev.y * S - 8, text: `+${ev.points || 250}`, life: 0.9, max: 0.9, color: '#4cf08a' }); }
  else if (ev.type === 'spawn') burst(6, '#35e0d2', 35, 0.4);
  else if (ev.type === 'spawnEnemy') burst(5, '#ff7043', 35, 0.4);
  else if (ev.type === 'lowTime') popups.push({ x: ev.x * S, y: ev.y * S + 8, text: 'LOW TIME', life: 1, max: 1, color: '#ff7a5c' });
}

function drawSprite(ctx, sprite, wx, wy, fx) {
  const x = ((wx * S) | 0) - 4;
  const y = ((wy * S) | 0) - 6;
  ctx.save();
  if (fx < -0.3) { // flip when facing left
    ctx.translate(x + 8, y);
    ctx.scale(-1, 1);
    ctx.drawImage(sprite, 0, 0);
  } else {
    ctx.drawImage(sprite, x, y);
  }
  ctx.restore();
  return [x + 4, y + 5]; // sprite center
}

function drawGun(ctx, cx, cy, fx, fy) {
  // quantize facing to 8 directions, draw a 4px gun barrel
  const a = Math.round(Math.atan2(fy, fx) / (Math.PI / 4)) * (Math.PI / 4);
  const gx = Math.round(Math.cos(a) * 5), gy = Math.round(Math.sin(a) * 5);
  ctx.fillStyle = '#3a4a46';
  ctx.fillRect(cx + (gx > 0 ? 1 : gx < 0 ? -4 : -1) + (gx ? gx - Math.sign(gx) : 0),
    cy + (gy > 0 ? 1 : gy < 0 ? -4 : -1) + (gy ? gy - Math.sign(gy) : 0),
    gx ? 4 : 2, gy ? 4 : 2);
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
    popups[i].y -= 8 * dt;
    popups[i].life -= dt;
    if (popups[i].life <= 0) popups.splice(i, 1);
  }

  const W = snap.w * PX, H = snap.h * PX;
  if (ctx.canvas.width !== W) { ctx.canvas.width = W; ctx.canvas.height = H; }
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  if (shake > 0) ctx.translate(((Math.random() - 0.5) * shake) | 0, ((Math.random() - 0.5) * shake) | 0);

  // --- tiles ---
  for (let y = 0; y < snap.h; y++) {
    for (let x = 0; x < snap.w; x++) {
      const c = snap.grid[y][x];
      const px = x * PX, py = y * PX;
      if (c === '#') {
        ctx.drawImage(tiles['wall' + ((x * 5 + y * 11) % 3)], px, py);
      } else if (c === '~') {
        ctx.drawImage(tiles.coolant, px, py);
        const ph = ((t * 4 + x + y) | 0) % 4;
        ctx.fillStyle = 'rgba(60, 220, 230, 0.25)';
        ctx.fillRect(px + 2 + ph * 3, py + 6 + ((x + y) % 2) * 4, 3, 1);
      } else {
        ctx.drawImage(tiles['floor' + ((x * 7 + y * 13) % 6)], px, py);
        if (c === 'o') ctx.drawImage(tiles.crate, px, py);
        if (c === 'E') {
          // green portal
          const pulse = (t * 6 | 0) % 2;
          ctx.fillStyle = '#04211a';
          ctx.fillRect(px + 1, py + 1, PX - 2, PX - 2);
          ctx.strokeStyle = pulse ? '#4cf08a' : '#2aa55e';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 2.5, py + 2.5, PX - 5, PX - 5);
          ctx.fillStyle = pulse ? 'rgba(76,240,138,0.5)' : 'rgba(76,240,138,0.3)';
          ctx.fillRect(px + 6, py + 6, 4, 4);
        }
      }
    }
  }

  // --- EXIT sign over exit tiles ---
  const exits = [];
  for (let y = 0; y < snap.h; y++)
    for (let x = 0; x < snap.w; x++)
      if (snap.grid[y][x] === 'E') exits.push({ x, y });
  if (exits.length) {
    const minX = Math.min(...exits.map(e => e.x)), maxX = Math.max(...exits.map(e => e.x));
    const y0 = Math.min(...exits.map(e => e.y));
    const cx = (((minX + maxX + 1) / 2) * PX) | 0;
    const sy = y0 * PX - 8;
    ctx.fillStyle = '#04211a';
    ctx.fillRect(cx - 14, sy - 4, 28, 9);
    ctx.strokeStyle = '#4cf08a';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - 13.5, sy - 3.5, 27, 8);
    ctx.fillStyle = '#4cf08a';
    ctx.font = '6px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('EXIT', cx, sy + 1);
  }

  // --- captives ---
  for (const c of snap.captives) {
    const spr = sprites[c.charId] || tiles.grunt;
    ctx.globalAlpha = 0.85;
    const [cx, cy] = drawSprite(ctx, spr, c.x, c.y, 0);
    ctx.globalAlpha = 1;
    if (!c.owner) {
      const blink = ((t * 2) | 0) % 2;
      if (blink) {
        ctx.fillStyle = '#4cf08a';
        ctx.font = '7px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('!', cx, cy - 9);
      }
    }
  }

  // --- enemy telegraphs ---
  for (const e of snap.enemies) {
    if (e.kind === 'sniper' && e.aimT > 0) {
      ctx.strokeStyle = ((t * 12) | 0) % 2 ? '#ff7ab0' : '#7a254b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo((e.x * S) | 0, (e.y * S) | 0);
      ctx.lineTo((e.aimX * S) | 0, (e.aimY * S) | 0);
      ctx.stroke();
    }
  }

  // --- enemies ---
  for (const e of snap.enemies) {
    const [cx, cy] = drawSprite(ctx, tiles[e.kind] || tiles.grunt, e.x, e.y, e.fx);
    drawGun(ctx, cx, cy, e.fx, e.fy);
    if (e.kind === 'bulwark') {
      ctx.fillStyle = '#d7eef2';
      ctx.fillRect(cx + Math.sign(e.fx || 1) * 5, cy - 5, 1, 8);
    } else if (e.kind === 'boss') {
      ctx.strokeStyle = '#ffb84d';
      ctx.strokeRect(cx - 7.5, cy - 9.5, 15, 17);
    }
    const maxHp = e.maxHp || 1;
    if (e.hp < maxHp) {
      ctx.fillStyle = '#330b06';
      ctx.fillRect(cx - 4, cy - 10, 8, 2);
      ctx.fillStyle = '#e85d4a';
      ctx.fillRect(cx - 4, cy - 10, (8 * e.hp / maxHp) | 0, 2);
    }
  }

  // --- players ---
  for (const p of snap.players) {
    if (p.state !== 'active') continue;
    const blinking = p.invuln > 0 && ((t * 8) | 0) % 2;
    if (blinking) continue;
    const spr = sprites[p.charId] || tiles.grunt;
    const [cx, cy] = drawSprite(ctx, spr, p.x, p.y, p.fx);
    drawGun(ctx, cx, cy, p.fx, p.fy);
    if (p.pid === myPid) {
      // selection brackets like the mock
      const blink = ((t * 3) | 0) % 2;
      ctx.fillStyle = blink ? '#35e0d2' : '#1a7f78';
      ctx.fillRect(cx - 7, cy - 8, 3, 1); ctx.fillRect(cx - 7, cy - 8, 1, 3);
      ctx.fillRect(cx + 5, cy - 8, 3, 1); ctx.fillRect(cx + 7, cy - 8, 1, 3);
      ctx.fillRect(cx - 7, cy + 7, 3, 1); ctx.fillRect(cx - 7, cy + 5, 1, 3);
      ctx.fillRect(cx + 5, cy + 7, 3, 1); ctx.fillRect(cx + 7, cy + 5, 1, 3);
    }
  }

  // --- shots: 1px tracers ---
  for (const s of snap.shots) {
    ctx.fillStyle = s.who === 'p' ? '#ffe9a8' : '#ff7a5c';
    ctx.fillRect((s.x * S) | 0, (s.y * S) | 0, 2, 2);
    ctx.fillStyle = s.who === 'p' ? 'rgba(255,233,168,0.4)' : 'rgba(255,122,92,0.4)';
    const sp = Math.hypot(s.vx, s.vy) || 1;
    ctx.fillRect(((s.x - s.vx / sp * 4) * S) | 0, ((s.y - s.vy / sp * 4) * S) | 0, 2, 2);
  }

  // --- muzzle flashes ---
  for (const f of flashes) {
    ctx.fillStyle = 'rgba(255,236,160,0.9)';
    ctx.fillRect((f.x | 0) - 1, (f.y | 0) - 1, 3, 3);
  }

  // --- particles ---
  for (const p of particles) {
    if (((p.life * 20) | 0) % 2) continue; // pixel flicker
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x | 0, p.y | 0, 1, 1);
  }

  for (const p of popups) {
    if (((p.life * 16) | 0) % 2) ctx.fillStyle = p.color;
    else ctx.fillStyle = '#eafffb';
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.font = '6px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(p.text, p.x | 0, p.y | 0);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
