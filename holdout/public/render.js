// Canvas renderer: clean modern 2D look — soft shadows, glow, particles.
import { TILE } from '/shared/game.js';

const particles = [];
const flashes = [];
const popups = [];
let shake = 0;

const ENEMY_STYLE = {
  grunt: ['#c62828', '#ffcdd2', 14],
  archer: ['#6a3fb5', '#d1b3ff', 14],
  charger: ['#ef6c00', '#ffe0b2', 15],
  bulwark: ['#546e7a', '#cfd8dc', 16],
  spawner: ['#2e7d32', '#b9f6ca', 16],
  sniper: ['#ad1457', '#f8bbd0', 14],
  skitter: ['#ff7043', '#ffccbc', 10],
  boss: ['#8e2434', '#ffd180', 24],
};

export function addEventFX(ev) {
  const burst = (n, color, speed = 120, life = 0.4) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      particles.push({ x: ev.x, y: ev.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color });
    }
  };
  if (ev.type === 'shoot') flashes.push({ x: ev.x, y: ev.y, life: 0.08, max: 0.08, who: ev.who });
  else if (ev.type === 'hit') burst(6, '#ffd54f');
  else if (ev.type === 'hitWall' || ev.type === 'shield') burst(5, '#8b9ab8', 90, 0.25);
  else if (ev.type === 'explode') { burst(24, '#ffb74d', 230, 0.6); shake = Math.max(shake, 8); }
  else if (ev.type === 'die') { burst(18, '#ff8a80', 180, 0.6); popups.push({ x: ev.x, y: ev.y - 18, text: `+${ev.points || 100} x${ev.combo || 1}`, life: 0.75, max: 0.75, color: '#ffd54f' }); shake = Math.max(shake, 4); }
  else if (ev.type === 'down') { burst(14, '#ffffff', 150, 0.6); shake = Math.max(shake, 6); }
  else if (ev.type === 'pickup') { burst(10, '#80ffd0', 100, 0.5); popups.push({ x: ev.x, y: ev.y - 18, text: 'RESCUE', life: 0.8, max: 0.8, color: '#80ffd0' }); }
  else if (ev.type === 'extract') { burst(16, '#69f0ae', 160, 0.7); popups.push({ x: ev.x, y: ev.y - 20, text: `+${ev.points || 250}`, life: 0.9, max: 0.9, color: '#69f0ae' }); }
  else if (ev.type === 'spawn') burst(10, '#4fc3f7', 120, 0.5);
  else if (ev.type === 'spawnEnemy') burst(8, '#ff7043', 110, 0.45);
  else if (ev.type === 'lowTime') popups.push({ x: ev.x, y: ev.y + 20, text: 'LOW TIME', life: 1, max: 1, color: '#ff8a80' });
}

function updateFX(dt) {
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
    const p = popups[i];
    p.y -= 22 * dt;
    p.life -= dt;
    if (p.life <= 0) popups.splice(i, 1);
  }
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function render(ctx, snap, charMap, myPid, t, dt) {
  updateFX(dt);
  const W = snap.w * TILE, H = snap.h * TILE;
  ctx.canvas.width = W;
  ctx.canvas.height = H;

  ctx.fillStyle = '#080a12';
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

  // floor base
  ctx.fillStyle = '#161a26';
  ctx.fillRect(0, 0, W, H);

  for (let y = 0; y < snap.h; y++) {
    for (let x = 0; x < snap.w; x++) {
      const c = snap.grid[y][x];
      const px = x * TILE, py = y * TILE;
      if (c === '.') {
        ctx.fillStyle = (x + y) % 2 ? '#1a1f2e' : '#181d2a';
        ctx.fillRect(px, py, TILE, TILE);
      } else if (c === '~') {
        ctx.fillStyle = '#13304e';
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = 'rgba(120,190,255,0.12)';
        const wob = Math.sin(t * 2 + x * 1.3 + y * 0.7) * 4;
        ctx.fillRect(px + 6, py + TILE / 2 + wob, TILE - 12, 3);
      } else if (c === 'E') {
        ctx.fillStyle = '#15241c';
        ctx.fillRect(px, py, TILE, TILE);
        const pulse = 0.5 + 0.5 * Math.sin(t * 3);
        ctx.save();
        ctx.shadowColor = '#69f0ae';
        ctx.shadowBlur = 18 + pulse * 14;
        ctx.strokeStyle = `rgba(105,240,174,${0.6 + 0.4 * pulse})`;
        ctx.lineWidth = 3;
        rr(ctx, px + 8, py + 8, TILE - 16, TILE - 16, 8);
        ctx.stroke();
        ctx.restore();
      }
    }
  }
  // walls drawn after floor so their shadow overlaps it
  for (let y = 0; y < snap.h; y++) {
    for (let x = 0; x < snap.w; x++) {
      if (snap.grid[y][x] !== '#') continue;
      const px = x * TILE, py = y * TILE;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(px + 3, py + 5, TILE, TILE);
      ctx.fillStyle = '#39415a';
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = '#465070';
      ctx.fillRect(px, py, TILE, 8);
    }
  }

  // captives — pulsing rings in their character color
  for (const c of snap.captives) {
    const col = charMap[c.charId]?.color || '#fff';
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 12 + pulse * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (!c.owner) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('HELP', c.x, c.y - 20 - pulse * 2);
    }
  }

  // enemy telegraphs
  for (const e of snap.enemies) {
    if (e.kind === 'sniper' && e.aimT > 0) {
      ctx.save();
      ctx.strokeStyle = `rgba(255,128,171,${0.35 + Math.sin(t * 24) * 0.15})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.aimX, e.aimY);
      ctx.stroke();
      ctx.restore();
    }
  }

  // enemies
  for (const e of snap.enemies) {
    const [body, accent, radius] = ENEMY_STYLE[e.kind] || ENEMY_STYLE.grunt;
    ctx.save();
    if (e.hurt > 0) ctx.globalAlpha = 0.45 + 0.55 * Math.sin(t * 60) ** 2;
    if (e.kind === 'archer' || e.kind === 'sniper') {
      ctx.shadowColor = body;
      ctx.shadowBlur = 10;
      ctx.fillStyle = body;
      ctx.translate(e.x, e.y);
      ctx.rotate(Math.atan2(e.fy, e.fx) + Math.PI / 4);
      rr(ctx, -11, -11, 22, 22, 5);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.shadowColor = body;
      ctx.shadowBlur = 10;
      ctx.fillStyle = body;
      ctx.beginPath();
      if (e.kind === 'spawner') {
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 6 + i * Math.PI / 3;
          const x = e.x + Math.cos(a) * radius;
          const y = e.y + Math.sin(a) * radius;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
      } else {
        ctx.arc(e.x, e.y, radius, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      if (e.kind === 'bulwark') {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(e.x, e.y, radius + 4, Math.atan2(e.fy, e.fx) - 0.9, Math.atan2(e.fy, e.fx) + 0.9);
        ctx.stroke();
      }
      ctx.fillStyle = accent;
      const ex = e.x + e.fx * 6, ey = e.y + e.fy * 6;
      ctx.beginPath(); ctx.arc(ex - 4, ey, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(ex + 4, ey, 2.5, 0, Math.PI * 2); ctx.fill();
      if (e.maxHp > 1 && e.hp < e.maxHp) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(e.x - 16, e.y - radius - 12, 32, 4);
        ctx.fillStyle = '#ff5252';
        ctx.fillRect(e.x - 15, e.y - radius - 11, 30 * Math.max(0, e.hp / e.maxHp), 2);
      }
    }
    ctx.restore();
  }

  // muzzle flashes
  for (const f of flashes) {
    const a = Math.max(0, f.life / f.max);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.shadowColor = f.who === 'p' ? '#ffe082' : '#ff8a80';
    ctx.shadowBlur = 18;
    ctx.fillStyle = f.who === 'p' ? '#fff8c4' : '#ff8a80';
    ctx.beginPath();
    ctx.arc(f.x, f.y, 8 + 8 * a, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // players
  for (const p of snap.players) {
    if (p.state !== 'active') continue;
    const col = charMap[p.charId]?.color || '#fff';
    ctx.save();
    if (p.invuln > 0) ctx.globalAlpha = 0.45 + 0.35 * Math.sin(t * 16);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 11, 13, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = col;
    ctx.shadowBlur = 14;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // facing wedge
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(p.fy, p.fx));
    ctx.beginPath();
    ctx.moveTo(15, 0); ctx.lineTo(5, -6); ctx.lineTo(5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    if (p.pid === myPid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 18, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, p.x, p.y - 24);
  }

  // shots
  for (const s of snap.shots) {
    ctx.save();
    const col = s.who === 'p' ? '#9ad8ff' : '#ff8a80';
    ctx.shadowColor = col;
    ctx.shadowBlur = 12;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // particles
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const p of popups) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;

  // HUD
  ctx.fillStyle = 'rgba(8,10,16,0.72)';
  rr(ctx, 12, 10, W - 24, 36, 9);
  ctx.fill();
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#c9d4e8';
  ctx.fillText(snap.name, 26, 28);
  ctx.textAlign = 'center';
  const tl = Math.max(0, snap.timeLeft);
  if (tl < 15) {
    ctx.fillStyle = `rgba(255,138,128,${0.12 + 0.1 * Math.sin(t * 10)})`;
    ctx.fillRect(W / 2 - 42, 12, 84, 32);
  }
  ctx.fillStyle = tl < 15 ? '#ff8a80' : '#ffd54f';
  ctx.fillText(`${Math.floor(tl / 60)}:${String(Math.floor(tl % 60)).padStart(2, '0')}`, W / 2, 28);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ff8a80';
  ctx.fillText(`Enemies: ${snap.enemies.length}`, W - 130, 28);
  ctx.fillStyle = '#69f0ae';
  ctx.fillText(`Rescued: ${snap.rescued.length}`, W - 26, 28);
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}
