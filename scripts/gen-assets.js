import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const variant = pkg.name.includes('iso') ? 'iso' : (pkg.name.includes('cyber') ? 'cyber' : 'hd');
const characters = JSON.parse(fs.readFileSync(path.join(root, 'shared/characters.json'), 'utf8'));
const outDir = path.join(root, 'public/assets');
fs.mkdirSync(outDir, { recursive: true });

const ENEMIES = {
  grunt: '#d4452f',
  archer: '#8e3fd9',
  charger: '#ef8f2f',
  bulwark: '#607d8b',
  spawner: '#3fa95b',
  sniper: '#d93678',
  skitter: '#ff7043',
  boss: '#9b263b',
};

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function img(w, h, fill = null) {
  const p = new PNG({ width: w, height: h });
  if (fill) rect(p, 0, 0, w, h, fill);
  return p;
}

function rgba(c, a = 255) {
  if (Array.isArray(c)) return c;
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

function shade(hex, amt, a = 255) {
  const c = rgba(hex);
  return [clamp(c[0] + amt), clamp(c[1] + amt), clamp(c[2] + amt), a];
}

function clamp(v) { return Math.max(0, Math.min(255, v | 0)); }

function set(p, x, y, c) {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) return;
  const i = (p.width * y + x) << 2;
  const cc = rgba(c);
  p.data[i] = cc[0]; p.data[i + 1] = cc[1]; p.data[i + 2] = cc[2]; p.data[i + 3] = cc[3];
}

function rect(p, x, y, w, h, c) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) set(p, xx, yy, c);
}

function circle(p, cx, cy, r, c) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) set(p, cx + x, cy + y, c);
}

function line(p, x0, y0, x1, y1, c) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    set(p, x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function diamond(p, cx, cy, w, h, c) {
  for (let y = -h / 2; y <= h / 2; y++) {
    const span = Math.floor((w / 2) * (1 - Math.abs(y) / (h / 2)));
    rect(p, cx - span, cy + y, span * 2 + 1, 1, c);
  }
}

function save(p, name) {
  fs.writeFileSync(path.join(outDir, name), PNG.sync.write(p));
}

function terrainHd() {
  for (let i = 0; i < 6; i++) {
    const p = img(48, 48, shade('#25422c', i * 3 - 6));
    const r = rng(100 + i);
    for (let n = 0; n < 110; n++) rect(p, r() * 48, r() * 48, 1 + r() * 3, 1 + r() * 3, shade('#4c7b42', r() * 30 - 18, 180));
    for (let n = 0; n < 10; n++) line(p, r() * 48, r() * 48, r() * 48, r() * 48, shade('#6aa85a', r() * 18, 210));
    save(p, `grass${i}.png`);
  }
  for (let i = 0; i < 3; i++) {
    const p = img(48, 48, shade('#56615e', i * 8 - 5));
    rect(p, 0, 0, 48, 5, shade('#77827d', i * 5));
    line(p, 0, 16 + i * 4, 48, 13 + i * 5, '#2c3431');
    line(p, 16 + i * 6, 0, 14 + i * 8, 48, '#2c3431');
    for (let n = 0, r = rng(200 + i); n < 40; n++) rect(p, r() * 48, r() * 48, 2, 2, shade('#6d7772', r() * 24 - 12, 220));
    save(p, `wall${i}.png`);
  }
  const water = img(48, 48, '#0a2335');
  for (let y = 7; y < 48; y += 9) line(water, 4, y, 44, y + 2, [80, 180, 220, 120]);
  save(water, 'water.png');
  const bags = img(48, 48);
  for (let i = 0; i < 6; i++) circle(bags, 13 + (i % 3) * 11, 35 - Math.floor(i / 3) * 10, 8, shade('#8a744c', i * 3));
  save(bags, 'sandbags.png');
}

function terrainCyber() {
  for (let i = 0; i < 6; i++) {
    const p = img(16, 16, shade('#092521', i * 3));
    rect(p, 0, 0, 16, 1, '#03110f');
    rect(p, 0, 0, 1, 16, '#03110f');
    if (i % 2) { rect(p, 4, 7, 8, 1, [53, 224, 210, 70]); rect(p, 4, 10, 8, 1, [53, 224, 210, 45]); }
    save(p, `floor${i}.png`);
  }
  for (let i = 0; i < 3; i++) {
    const p = img(16, 16, shade('#2f4844', i * 5));
    rect(p, 0, 0, 16, 2, '#66817b');
    rect(p, 0, 14, 16, 2, '#102320');
    line(p, 0, 7 + i, 15, 8, '#102320');
    rect(p, 2 + i * 4, 3, 2, 1, [53, 224, 210, 120]);
    save(p, `wall${i}.png`);
  }
  const coolant = img(16, 16, '#06181f');
  for (let y = 4; y < 14; y += 4) rect(coolant, 2, y, 11, 1, [60, 220, 230, 110]);
  save(coolant, 'coolant.png');
  const crate = img(16, 16);
  rect(crate, 2, 3, 12, 11, '#23413c'); rect(crate, 2, 3, 12, 2, '#2f5650'); rect(crate, 7, 7, 2, 2, '#35e0d2');
  save(crate, 'crate.png');
}

function terrainIso() {
  for (let i = 0; i < 6; i++) {
    const p = img(32, 16);
    diamond(p, 16, 8, 32, 16, shade('#0b2d29', i * 3));
    line(p, 0, 8, 16, 0, '#03110f'); line(p, 16, 0, 31, 8, '#123b36');
    if (i % 2) rect(p, 11, 7, 10, 1, [53, 224, 210, 80]);
    save(p, `floor${i}.png`);
  }
  for (let i = 0; i < 3; i++) {
    const p = img(32, 34);
    diamond(p, 16, 8, 32, 16, shade('#4f6662', i * 5));
    rect(p, 0, 8, 16, 18, shade('#283b37', i * 3));
    rect(p, 16, 8, 16, 18, shade('#1a2f2b', i * 3));
    diamond(p, 16, 8, 32, 16, shade('#58736d', i * 5));
    save(p, `wall${i}.png`);
  }
  const coolant = img(32, 16);
  diamond(coolant, 16, 8, 32, 16, '#06181f');
  rect(coolant, 9, 7, 14, 1, [60, 220, 230, 110]);
  save(coolant, 'coolant.png');
  const crate = img(32, 25);
  diamond(crate, 16, 8, 24, 12, '#2f5650');
  rect(crate, 4, 8, 12, 9, '#23413c'); rect(crate, 16, 8, 12, 9, '#16302c');
  save(crate, 'crate.png');
}

function portrait(ch, size) {
  const p = img(size, size, variant === 'hd' ? '#101c18' : '#04211e');
  const s = size / (variant === 'hd' ? 64 : 24);
  const cx = Math.floor(size / 2);
  const seed = rng(hash(ch.id));
  for (let i = 0; i < size / 2; i++) rect(p, 0, (seed() * size) | 0, size, 1, [53, 224, 210, variant === 'hd' ? 22 : 35]);
  circle(p, cx, Math.floor(size * 0.5), Math.floor(7 * s), '#c79b73');
  rect(p, Math.floor(cx - 4 * s), Math.floor(size * 0.63), Math.floor(8 * s), Math.floor(4 * s), '#a9876a');
  circle(p, cx, Math.floor(size * 0.38), Math.floor(10 * s), ch.color);
  rect(p, Math.floor(cx - 11 * s), Math.floor(size * 0.42), Math.floor(22 * s), Math.max(1, Math.floor(2 * s)), shade(ch.color, 28));
  rect(p, Math.floor(cx - 8 * s), Math.floor(size * 0.49), Math.floor(16 * s), Math.max(1, Math.floor(2 * s)), '#7dfde4');
  rect(p, Math.floor(cx - 16 * s), Math.floor(size * 0.78), Math.floor(32 * s), Math.floor(8 * s), shade(ch.color, -55));
  return p;
}

function weaponIcon(ch, w, h) {
  const p = img(w, h);
  const y = Math.floor(h / 2);
  const col = rgba(ch.color);
  rect(p, 2, y - 1, w - 8, 3, '#9fb3aa');
  rect(p, 8, y + 2, 4, Math.max(3, h / 4), '#5f7068');
  if (ch.weapon.aoeRadius) circle(p, w - 8, y, 4, [255, 183, 77, 210]);
  if (ch.weapon.pierce) line(p, 3, y - 4, w - 4, y - 4, '#7dfde4');
  if (ch.weapon.curve) { circle(p, Math.floor(w * 0.63), y, 5, [col[0], col[1], col[2], 180]); rect(p, Math.floor(w * 0.63), y - 1, 5, 2, '#03110f'); }
  if (ch.weapon.count > 2) for (let i = 0; i < ch.weapon.count && i < 5; i++) set(p, w - 8 + i, y + 5, '#ffe9a8');
  rect(p, Math.floor(w * 0.38), y - 3, 6, 2, '#7dfde4');
  return p;
}

function soldierSprite(color, scale = 1) {
  const w = 8 * scale, h = 10 * scale;
  const p = img(w, h);
  const put = (x, y, c) => rect(p, x * scale, y * scale, scale, scale, c);
  const body = color, dark = shade(color, -55), hi = shade(color, 35);
  const rows = [
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
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) {
    const c = rows[y][x];
    if (c === 'H') put(x, y, hi);
    else if (c === 'V') put(x, y, '#7dfde4');
    else if (c === 'F') put(x, y, '#c79b73');
    else if (c === 'B') put(x, y, body);
    else if (c === 'b' || c === 'L') put(x, y, dark);
  }
  return p;
}

if (variant === 'hd') terrainHd();
else if (variant === 'iso') terrainIso();
else terrainCyber();

for (const ch of characters) {
  save(portrait(ch, variant === 'hd' ? 64 : 24), `portrait_${ch.id}.png`);
  save(weaponIcon(ch, variant === 'hd' ? 128 : 32, variant === 'hd' ? 40 : 12), `weapon_${ch.id}.png`);
}

for (const [kind, color] of Object.entries(ENEMIES)) {
  save(soldierSprite(color, variant === 'hd' ? 4 : 1), `enemy_${kind}.png`);
}

console.log(`Generated ${variant} assets in ${path.relative(root, outDir)}`);
