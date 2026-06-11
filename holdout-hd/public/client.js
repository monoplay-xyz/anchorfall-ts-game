import { TILE, createGame, step, snapshot, applyResults, charsById } from '/shared/game.js';
import { render, renderMinimap, addEventFX, initTextures, drawPortrait, drawWeaponIcon } from './render.js';
import { playEvent, playUi, setupAudioToggle } from './audio.js';

const characters = await (await fetch('/shared/characters.json')).json();
const charMap = charsById(characters);
const levels = await (await fetch('/api/levels')).json();
// Expedition maps live outside the campaign rotation (menu shortcut only).
const campaign = levels.filter(l => !l.expedition);
const expeditions = levels.filter(l => l.expedition);
const startingRoster = characters.filter(c => c.starting).map(c => c.id);
await initTextures();

const mod = (a, n) => ((a % n) + n) % n;

const $ = id => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const mmCtx = $('minimap').getContext('2d');
const SAVE_KEY = 'holdout-hd.save';
const PCOLORS = ['#4fc3f7', '#ffb74d', '#f06292', '#aed581'];

let session = null;
setupAudioToggle($('btnAudio'));
// ?demo=1 -> 4-bot attract mode; ?demo=2 -> same but pacifist (never fires)
const demoMode = +(new URLSearchParams(location.search).get('demo') || 0);

// ---------- input devices ----------
// Couch co-op input model: the keyboard is split into two devices and up to
// four gamepads are polled. A device "joins" the local lobby by pressing fire.
const keys = {};
addEventListener('keydown', e => {
  if (e.target?.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Slash') e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });

const KB1 = { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], fire: ['Space'], special: ['KeyE'], act: ['KeyF'], start: ['Escape'] };
const KB2 = { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], fire: ['Enter'], special: ['ShiftRight'], act: ['Slash'], start: ['Escape'] };
const DEVICES = ['kb1', 'kb2', 'gp0', 'gp1', 'gp2', 'gp3'];
const DEVICE_LABEL = { kb1: 'Keyboard WASD', kb2: 'Keyboard Arrows', gp0: 'Pad 1', gp1: 'Pad 2', gp2: 'Pad 3', gp3: 'Pad 4' };

function readKeys(map) {
  const o = {};
  for (const k in map) o[k] = map[k].some(c => keys[c]);
  return o;
}

function readPad(i) {
  const gp = navigator.getGamepads?.()[i];
  if (!gp || !gp.connected) return null;
  const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
  const b = j => !!gp.buttons[j]?.pressed;
  const DZ = 0.35;
  return {
    up: ay < -DZ || b(12),
    down: ay > DZ || b(13),
    left: ax < -DZ || b(14),
    right: ax > DZ || b(15),
    fire: b(0) || b(7),
    special: b(1) || b(5),
    act: b(2),
    start: b(9),
  };
}

function readDevice(id) {
  if (id === 'kb1') return readKeys(KB1);
  if (id === 'kb2') return readKeys(KB2);
  return readPad(+id.slice(2));
}

const prevDev = {};
function pollDevices() {
  const out = {};
  for (const id of DEVICES) {
    const cur = readDevice(id);
    if (!cur) { prevDev[id] = null; continue; }
    const prev = prevDev[id] || {};
    out[id] = {
      ...cur,
      fireJust: cur.fire && !prev.fire,
      leftJust: cur.left && !prev.left,
      rightJust: cur.right && !prev.right,
      upJust: cur.up && !prev.up,
      downJust: cur.down && !prev.down,
      startJust: cur.start && !prev.start,
      specialJust: cur.special && !prev.special,
      actJust: cur.act && !prev.act,
    };
    prevDev[id] = cur;
  }
  return out;
}

// Online play: one player per machine, so any device drives them.
function mergedInput() {
  const o = { up: false, down: false, left: false, right: false, fire: false, special: false, act: false };
  for (const id of DEVICES) {
    const c = readDevice(id);
    if (!c) continue;
    o.up ||= c.up; o.down ||= c.down; o.left ||= c.left; o.right ||= c.right;
    o.fire ||= c.fire; o.special ||= c.special; o.act ||= c.act;
  }
  return o;
}

// ---------- dialogue box (NPC talk lines; game keeps running) ----------
let dlgTimer = 0;
function showDialogue(ev) {
  const box = $('dialogueBox');
  // 'talk' carries the gift amount on the first conversation; tolerate either
  // a plain number or a {shards} object so classic/newer sims both work.
  const gift = typeof ev.gift === 'object' ? (ev.gift?.shards ?? 0) : (ev.gift ?? 0);
  box.querySelector('.dname').textContent = ev.name ?? '';
  box.querySelector('.dtext').textContent = (ev.line ?? '') + (gift ? ` (+${gift}◆)` : '');
  box.hidden = false;
  clearTimeout(dlgTimer);
  dlgTimer = setTimeout(() => { box.hidden = true; }, 4500);
}
function hideDialogue() {
  clearTimeout(dlgTimer);
  $('dialogueBox').hidden = true;
}
// One funnel for sim events: FX + audio + the DOM dialogue box.
function handleEvent(ev) {
  addEventFX(ev);
  playEvent(ev);
  if (ev.type === 'talk') showDialogue(ev);
}

// ---------- screens ----------
function show(id) {
  hideDialogue();
  for (const s of ['menu', 'lobby', 'msg']) $(s).hidden = s !== id;
}
function hideAll() {
  for (const s of ['menu', 'lobby', 'msg']) $(s).hidden = true;
}
function showMsg(title, body, btnLabel, onOk) {
  $('msgTitle').textContent = title;
  $('msgBody').textContent = body;
  $('btnMsgOk').textContent = btnLabel || 'Continue';
  $('btnMsgOk').onclick = e => { e.currentTarget.blur(); onOk(); };
  show('msg');
}
function resultText(res) {
  let s = '';
  if (res.gained?.length) s += `Recruited: ${res.gained.map(id => charMap[id].name).join(', ')}\n`;
  if (res.lost?.length) s += `Lost in the field: ${res.lost.map(id => charMap[id].name).join(', ')}\n`;
  return s;
}

function renderLobby({ title, info, hint, players, roster, canStart, cursors = [], onCard }) {
  $('lobbyTitle').textContent = title;
  $('roomInfo').innerHTML = info;
  $('lobbyHint').textContent = hint || '';
  const pl = $('playerList');
  pl.innerHTML = '';
  for (const p of players) {
    const chip = document.createElement('span');
    chip.className = 'pchip';
    const col = p.charId ? charMap[p.charId].color : (p.color || '#555');
    chip.innerHTML = `<span class="dot" style="background:${col}"></span>${p.badge ? p.badge + ' · ' : ''}${p.name}${p.isHost ? ' ★' : ''}${p.charId ? ' — ' + charMap[p.charId].name : ''}`;
    pl.appendChild(chip);
  }
  const grid = $('charGrid');
  grid.innerHTML = '';
  const takenBy = {};
  for (const p of players) if (p.charId) takenBy[p.charId] = p;
  roster.forEach((id, idx) => {
    const ch = charMap[id];
    const card = document.createElement('div');
    card.className = 'card';
    const pc = document.createElement('canvas');
    drawPortrait(pc, ch, 56);
    card.appendChild(pc);
    const meta = document.createElement('div');
    meta.innerHTML = `<div class="cname" style="color:${ch.color}">${ch.name.toUpperCase()}</div>
      <div class="cstats">${ch.weapon.name}<br>SPD ${ch.speed} · DMG ${ch.weapon.damage} · RNG ${ch.weapon.range}</div>`;
    card.appendChild(meta);
    const owner = takenBy[id];
    let blocked = false;
    if (owner) {
      if (owner.me) card.classList.add('selected');
      else if (owner.badge) {
        card.classList.add('claimed');
        card.style.borderColor = owner.color || '#3fd9c0';
      } else {
        card.classList.add('taken');
        blocked = true;
      }
      const b = document.createElement('div');
      b.className = 'pbadge';
      b.textContent = owner.badge || '✓';
      b.style.background = owner.color || charMap[id].color;
      card.appendChild(b);
    }
    for (const cur of cursors) {
      if (cur.idx === idx && !cur.picked) {
        const b = document.createElement('div');
        b.className = 'pbadge hoverb';
        b.textContent = cur.badge;
        b.style.background = cur.color;
        card.appendChild(b);
        card.style.outline = `2px dashed ${cur.color}`;
      }
    }
    if (!blocked && onCard) card.onclick = () => onCard(id);
    grid.appendChild(card);
  });
  $('btnStart').disabled = !canStart;
  show('lobby');
  buildSquadPanels(roster);
  updateMissionPanel();
}

// ---------- HUD ----------
const squadCards = {};
function buildSquadPanels(roster) {
  const host = $('squadPanels');
  host.innerHTML = '';
  for (const k of Object.keys(squadCards)) delete squadCards[k];
  for (const id of roster.slice(0, 5)) {
    const ch = charMap[id];
    const card = document.createElement('div');
    card.className = 'squadcard';
    const pc = document.createElement('canvas');
    drawPortrait(pc, ch, 48);
    card.appendChild(pc);
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = `<div class="nm" style="color:${ch.color}">${ch.name.toUpperCase()}</div>
      <div class="rl">${ch.weapon.name}</div>
      <div class="bar"><i style="width:100%"></i></div>
      <div class="st">READY</div>`;
    card.appendChild(info);
    host.appendChild(card);
    squadCards[id] = card;
  }
}

function updateMissionPanel() {
  const idx = session?.levelIdxView?.() ?? 0;
  const list = session?.levelList?.() ?? campaign;
  const lvl = list[Math.min(idx, list.length - 1)];
  $('missionNo').textContent = `MISSION ${String(idx + 1).padStart(2, '0')}`;
  $('missionName').textContent = lvl?.name?.toUpperCase() || '—';
  $('missionObj').textContent = lvl?.objective || 'Reach the exit gate';
}

function charStatus(id, snap) {
  for (const p of snap.players) if (p.charId === id && p.state === 'active') return ['IN FIELD', 'infield', 100];
  for (const c of snap.captives) if (c.charId === id) return [c.owner != null ? 'CARRIED' : 'DOWN', 'down', 30];
  if (snap.rescued.includes(id)) return ['EXTRACTED', '', 100];
  return ['READY', '', 100];
}

function updateHUD(snap) {
  $('hScore').textContent = (snap.score ?? 0).toLocaleString();
  const tl = Math.max(0, snap.timeLeft);
  $('hTime').textContent = `${String(Math.floor(tl / 60)).padStart(2, '0')}:${String(Math.floor(tl % 60)).padStart(2, '0')}`;
  $('hTime').style.color = tl < 15 ? '#ff7a6a' : '';
  $('hKills').textContent = snap.kills ?? 0;
  $('hCombo').textContent = 'x' + (snap.combo ?? 1);
  $('hShards').textContent = '◆' + Math.floor(snap.shards ?? 0);

  const gateEl = $('missionGate');
  if (snap.gate) {
    gateEl.hidden = false;
    gateEl.textContent = snap.gate.open
      ? 'ANCHOR OPEN'
      : `PYLONS ${snap.gate.built ?? 0}/${snap.gate.need ?? 0}`;
    gateEl.style.color = snap.gate.open ? 'var(--green)' : '';
  } else {
    gateEl.hidden = true;
  }

  for (const [id, card] of Object.entries(squadCards)) {
    const [label, cls, pct] = charStatus(id, snap);
    card.className = 'squadcard' + (cls ? ' ' + cls : '');
    card.querySelector('.st').textContent = label;
    card.querySelector('.bar i').style.width = pct + '%';
  }
  const sleeping = snap.enemies.filter(e => e.awake === false).length;
  $('squadStatusBody').textContent =
    `Hostiles: ${snap.enemies.length}${sleeping ? ` (${sleeping} unaware)` : ''} · Rescued: ${snap.rescued.length}`;

  const focus = session?.focusPids() ?? new Set();
  const me = snap.players.find(p => focus.has(p.pid) && p.state === 'active' && p.charId)
    || snap.players.find(p => p.pid === session?.primaryPid());
  const ch = me?.charId ? charMap[me.charId] : null;
  if (ch) {
    $('wName').textContent = ch.weapon.name.toUpperCase();
    drawWeaponIcon($('wIcon'), ch);
    $('wStats').textContent = `DMG ${ch.weapon.damage} · RNG ${ch.weapon.range} · ROF ${(1 / ch.weapon.cooldown).toFixed(1)}/s`;
  }
  const sp = ch?.special;
  if (sp) {
    $('wSpecial').hidden = false;
    $('wSpecialName').textContent = (sp.name ?? sp.kind ?? 'SPECIAL').toUpperCase();
    const cool = Math.max(0, me?.specialCool ?? 0);
    const pct = Math.max(0, Math.min(1, 1 - cool / (sp.cooldown || 1)));
    $('wSpecialFill').style.width = Math.round(pct * 100) + '%';
  } else {
    $('wSpecial').hidden = true;
  }
  renderMinimap(mmCtx, snap, session?.focusPids() ?? new Set());
}

// ---------- local couch session (1-4 players, one screen) ----------
class LocalSession {
  constructor(save, opts = {}) {
    this.expedition = !!opts.expedition;
    this.levels = this.expedition ? expeditions : campaign;
    this.levelIdx = this.expedition ? 0 : (save?.levelIdx ?? 0);
    this.roster = save?.roster ?? startingRoster.slice();
    this.players = []; // { pid, name, device, charId, cursor }
    this.game = null;
    this.snap = null;
    this.paused = false;
    this.inLobby = false;
  }
  focusPids() { return new Set(this.players.map(p => p.pid)); }
  primaryPid() { return 0; }
  levelIdxView() { return this.levelIdx; }
  levelList() { return this.levels; }
  canStart() { return this.players.length > 0 && this.players.every(p => p.charId); }

  lobby() {
    if (this.levelIdx >= this.levels.length) return this.victory();
    this.inLobby = true;
    this.renderLobby();
  }
  renderLobby() {
    const lvl = this.levels[this.levelIdx];
    renderLobby({
      title: this.expedition
        ? `Expedition — ${lvl.name}`
        : `Mission ${this.levelIdx + 1} / ${this.levels.length} — ${lvl.name}`,
      info: this.expedition ? 'One huge map. No autosave — bring everyone home.' : 'Local campaign · progress autosaves',
      hint: 'Press FIRE to join: gamepad (A) · keyboard WASD+Space · keyboard Arrows+Enter — up to 4 players. Move your cursor with LEFT/RIGHT, FIRE to lock in. '
        + 'In the field — SPECIAL: E / RShift / B·RB · ACT: F / Slash / X. '
        + 'Hold ACT on a build site to construct — LYTH shards drop from fallen Entropy.',
      players: this.players.map(p => ({
        name: p.name, charId: p.charId, isHost: p.pid === 0, me: false,
        badge: 'P' + (p.pid + 1), color: PCOLORS[p.pid],
      })),
      roster: this.roster,
      canStart: this.canStart(),
      cursors: this.players.map(p => ({ idx: p.cursor, color: PCOLORS[p.pid], badge: 'P' + (p.pid + 1), picked: !!p.charId })),
      onCard: id => this.clickChar(id),
    });
  }
  deviceOf(id) { return this.players.find(p => p.device === id); }
  join(device) {
    if (this.players.length >= 4 || this.deviceOf(device)) return;
    const pid = this.players.length;
    const name = pid === 0
      ? ($('nameInput').value.trim() || 'P1').slice(0, 12)
      : 'P' + (pid + 1);
    this.players.push({ pid, name, device, charId: null, cursor: 0, missingT: 0 });
    this.renderLobby();
  }
  unjoin(p) {
    const i = this.players.indexOf(p);
    if (i < 0) return;
    this.players.splice(i, 1);
    this.players.forEach((q, idx) => {
      q.pid = idx;
      if (/^P[1-4]$/.test(q.name)) q.name = 'P' + (idx + 1);
    });
    this.renderLobby();
  }
  clickChar(id) {
    if (!this.players.length) this.join('kb1');
    this.pick(this.players[0], id);
  }
  pick(p, id) {
    if (p.charId === id) {
      p.charId = null;
    } else {
      const taken = this.players.some(o => o !== p && o.charId === id);
      if (taken || !this.roster.includes(id)) return;
      p.charId = id;
      p.cursor = this.roster.indexOf(id);
    }
    this.renderLobby();
  }
  lobbyTick(polled, dt) {
    let moved = false;
    // a joined gamepad that vanished before picking (battery died) would
    // block Deploy forever — drop it after a grace period
    for (let i = this.players.length - 1; i >= 0; i--) {
      const p = this.players[i];
      if (p.device.startsWith('gp') && !polled[p.device] && !p.charId) {
        p.missingT += dt;
        if (p.missingT > 3) this.unjoin(p);
      } else p.missingT = 0;
    }
    for (const [dev, st] of Object.entries(polled)) {
      const p = this.deviceOf(dev);
      if (!p) {
        if (st.fireJust) this.join(dev);
        continue;
      }
      if (st.startJust) {
        if (p.pid === 0 && this.canStart()) return this.start();
        if (!p.charId) { this.unjoin(p); continue; }
      }
      const n = this.roster.length;
      if (!p.charId) {
        if (st.leftJust) { p.cursor = mod(p.cursor - 1, n); moved = true; }
        if (st.rightJust) { p.cursor = mod(p.cursor + 1, n); moved = true; }
        if (st.upJust) { p.cursor = mod(p.cursor - 5, n); moved = true; }
        if (st.downJust) { p.cursor = mod(p.cursor + 5, n); moved = true; }
      }
      if (st.fireJust) this.pick(p, p.charId ?? this.roster[p.cursor]);
    }
    if (moved) this.renderLobby();
  }
  start() {
    if (!this.inLobby || !this.canStart()) return;
    this.inLobby = false;
    this.game = createGame(
      this.levels[this.levelIdx],
      this.players.map(p => ({ pid: p.pid, name: p.name, charId: p.charId })),
      charMap,
      this.roster
    );
    this.snap = null;
    this.paused = false;
    hideAll();
  }
  togglePause() {
    if (!this.game || this.game.status !== 'play') return;
    this.paused = !this.paused;
    if (this.paused) showMsg('Paused', 'The frontier waits.', 'Resume', () => this.togglePause());
    else hideAll();
  }
  tick(polled, dt) {
    if (this.inLobby) return this.lobbyTick(polled, dt);
    if (!this.game) {
      // a mission-end dialog is up: fire/start on any device clicks through,
      // so a controller-only couch never needs the mouse
      for (const st of Object.values(polled)) {
        if (st.fireJust || st.startJust) { $('btnMsgOk').click(); break; }
      }
      return;
    }
    for (const [dev, st] of Object.entries(polled)) {
      if (st.startJust && this.deviceOf(dev)) { this.togglePause(); break; }
    }
    if (this.paused || this.game.status !== 'play') return;
    const inputs = {};
    for (const p of this.players) {
      if (p.device.startsWith('bot')) { inputs[p.pid] = this.botInput(p, dt); continue; }
      const st = polled[p.device];
      inputs[p.pid] = st
        ? { up: st.up, down: st.down, left: st.left, right: st.right, fire: st.fire, special: st.special, act: st.act }
        : {};
    }
    step(this.game, inputs, dt);
    this.snap = snapshot(this.game);
    for (const ev of this.snap.events) handleEvent(ev);
    if (this.snap.status !== 'play') this.finish();
  }
  // Attract-mode bot (?demo=1): walks east toward the exit, shoots what gets
  // close, holds ACT at build sites/NPCs. Reads only snapshot state, so it is
  // safe on classic maps where builds/npcs do not exist.
  botInput(p, dt) {
    const inp = { up: false, down: false, left: false, right: false, fire: false, special: false, act: false };
    const snap = this.snap;
    const me = snap?.players?.find(q => q.pid === p.pid);
    if (!me) return inp;
    const b = p.bot ??= { bias: p.pid % 2 ? 1 : -1, lastX: me.x, t: 0, pulse: 0 };
    if (me.state === 'pick') {
      // pulse fire so the respawn pick confirms (edges need release+press)
      b.pulse += dt;
      inp.fire = Math.floor(b.pulse * 4) % 2 === 0;
      return inp;
    }
    if (me.state !== 'active') return inp;

    // march east; flip the vertical bias every ~2s while x-progress stalls
    b.t += dt;
    if (b.t >= 2) {
      if (me.x - b.lastX < 0.4 * TILE) b.bias = -b.bias;
      b.lastX = me.x;
      b.t = 0;
    }
    inp.right = true;
    if (b.bias < 0) inp.up = true; else inp.down = true;

    const steerTo = (tx, ty) => {
      inp.up = inp.down = inp.left = inp.right = false;
      if (tx - me.x > 0.25 * TILE) inp.right = true; else if (me.x - tx > 0.25 * TILE) inp.left = true;
      if (ty - me.y > 0.25 * TILE) inp.down = true; else if (me.y - ty > 0.25 * TILE) inp.up = true;
    };

    // hold ACT at an unbuilt build site (nudging to stay in range) or near an NPC
    const dist = o => Math.hypot(o.x - me.x, o.y - me.y);
    const site = (snap.builds ?? []).find(s => !s.built && dist(s) <= 1.4 * TILE);
    if (site) {
      inp.act = true;
      steerTo(site.x, site.y);
      return inp;
    }
    if ((snap.npcs ?? []).some(n => dist(n) <= 1.4 * TILE)) inp.act = true;

    // engage AWAKE enemies within ~5 tiles (sleeping ones may be unreachable
    // behind walls — chasing them deadlocks the eastward march)
    if (demoMode !== 2) {
      let tgt = null, best = 5 * TILE;
      for (const e of snap.enemies ?? []) {
        if (e.awake === false) continue;
        const d = dist(e);
        if (d < best) { best = d; tgt = e; }
      }
      if (tgt) {
        inp.fire = true;
        steerTo(tgt.x, tgt.y);
      }
    }
    return inp;
  }
  finish() {
    const res = applyResults(this.roster, this.game);
    const cleared = this.game.status === 'cleared';
    const score = Math.round(this.game.score);
    this.game = null;
    this.paused = false;
    for (const p of this.players) { p.charId = null; p.cursor = 0; p.bot = null; }
    if (cleared) {
      this.roster = res.roster;
      if (this.expedition) {
        playUi('victory');
        showMsg('Expedition Complete!', (resultText(res) || 'The crossing is yours.') + `\nScore: ${score.toLocaleString()}`, 'Main Menu', () => this.leave());
        return;
      }
      this.levelIdx++;
      localStorage.setItem(SAVE_KEY, JSON.stringify({ levelIdx: this.levelIdx, roster: this.roster }));
      showMsg('Mission Cleared', (resultText(res) || 'Nicely done.') + `\nScore: ${score.toLocaleString()}`, 'Continue', () => this.lobby());
    } else {
      showMsg('Mission Failed', 'Time ran out or the whole squad went down.\nNo one is lost on a failed run — try again.', 'Retry', () => this.lobby());
    }
  }
  victory() {
    localStorage.removeItem(SAVE_KEY);
    playUi('victory');
    showMsg('Campaign Complete!', `You held out to the end.\nFinal roster: ${this.roster.map(id => charMap[id].name).join(', ')}`, 'Main Menu', () => this.leave());
  }
  leave() { session = null; show('menu'); refreshContinue(); }
}

// ---------- online co-op session ----------
class NetSession {
  constructor(mode, code) {
    this.myPid = null;
    this.myPick = null;
    this.snap = null;
    this.grid = null;
    this.lobbyData = null;
    this.name = $('nameInput').value.trim() || 'Player';
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}`);
    this.ws.onopen = () => {
      if (mode === 'host') this.ws.send(JSON.stringify({ t: 'host', name: this.name, resume: code }));
      else this.ws.send(JSON.stringify({ t: 'join', room: code, name: this.name }));
    };
    this.ws.onmessage = e => this.onMsg(JSON.parse(e.data));
    this.ws.onclose = () => {
      clearInterval(this.inputTimer);
      if (session === this) {
        session = null;
        showMsg('Disconnected', 'Lost connection to the server.', 'Main Menu', () => { show('menu'); refreshContinue(); });
      }
    };
    this.inputTimer = setInterval(() => {
      if (this.ws.readyState === 1 && this.snap?.status === 'play') {
        this.ws.send(JSON.stringify({ t: 'input', input: mergedInput() }));
      }
    }, 50);
  }
  focusPids() { return new Set([this.myPid]); }
  primaryPid() { return this.myPid; }
  levelIdxView() { return this.lobbyData?.levelIdx ?? 0; }
  levelList() { return campaign; }
  onMsg(m) {
    if (m.t === 'joined') this.myPid = m.you;
    else if (m.t === 'lobby') {
      this.lobbyData = m;
      const me = m.players.find(p => p.pid === this.myPid);
      this.myPick = me?.charId || null;
      // never stomp a live game or an open dialog — renderLobby runs on dismiss
      if (this.snap?.status === 'play' || !$('msg').hidden) return;
      this.renderLobby();
    }
    else if (m.t === 'levelStart') {
      // Full snapshot rides along once; later 'state' ticks omit the grid.
      if (m.s?.grid) this.grid = m.s.grid;
      this.snap = m.s || null;
      hideAll();
    }
    else if (m.t === 'state') {
      if (!m.s.grid) m.s.grid = this.grid;
      else this.grid = m.s.grid;
      const prev = this.snap;
      this.snap = m.s;
      for (const ev of m.s.events) handleEvent(ev);
      if (!prev) hideAll();
    }
    else if (m.t === 'levelEnd') {
      this.myPick = null;
      if (this.lobbyData) this.lobbyData.roster = m.roster;
      if (m.victory) {
        showMsg('Campaign Complete!', resultText(m) + `Final roster: ${m.roster.map(id => charMap[id].name).join(', ')}`, 'OK', () => this.leave());
      } else if (m.status === 'cleared') {
        if (this.lobbyData) this.lobbyData.levelIdx++;
        showMsg('Mission Cleared', resultText(m) || 'Nicely done.', 'To Lobby', () => this.renderLobby());
      } else {
        showMsg('Mission Failed', 'No one is lost on a failed run — regroup and retry.', 'To Lobby', () => this.renderLobby());
      }
    }
    else if (m.t === 'error') {
      this.close();
      showMsg('Co-op', m.error, 'Main Menu', () => { show('menu'); refreshContinue(); });
    }
  }
  renderLobby() {
    const m = this.lobbyData;
    if (!m) return;
    const isHost = m.players.find(p => p.pid === this.myPid)?.isHost;
    const allPicked = m.players.every(p => p.charId);
    renderLobby({
      title: `Mission ${m.levelIdx + 1} / ${m.totalLevels} — ${m.levelName || ''}`,
      info: `Room code: <b>${m.room}</b> — friends join with this code`,
      hint: 'Online co-op: one player per machine. Any controller or keyboard works in the field.',
      players: m.players.map(p => ({ ...p, me: p.pid === this.myPid })),
      roster: m.roster,
      canStart: isHost && allPicked,
      onCard: id => this.pickChar(id),
    });
  }
  pickChar(id) { this.ws.send(JSON.stringify({ t: 'select', charId: id })); }
  start() { this.ws.send(JSON.stringify({ t: 'start' })); }
  tick(polled) {
    if (!$('msg').hidden) {
      for (const st of Object.values(polled)) {
        if (st.fireJust || st.startJust) { $('btnMsgOk').click(); break; }
      }
    }
  }
  close() {
    clearInterval(this.inputTimer);
    this.ws.onclose = null;
    this.ws.close();
    session = null;
  }
  leave() { this.close(); show('menu'); refreshContinue(); }
}

// ---------- menu wiring ----------
function refreshContinue() {
  $('btnContinue').hidden = !localStorage.getItem(SAVE_KEY);
}
refreshContinue();
$('nameInput').value = localStorage.getItem('holdout.name') || '';
$('nameInput').onchange = () => localStorage.setItem('holdout.name', $('nameInput').value);

$('btnSolo').onclick = e => {
  e.currentTarget.blur();
  localStorage.removeItem(SAVE_KEY);
  session = new LocalSession();
  session.lobby();
};
$('btnContinue').onclick = e => {
  e.currentTarget.blur();
  let save = null;
  try { save = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch {}
  session = new LocalSession(save);
  session.lobby();
};
$('btnExpedition').hidden = !expeditions.length;
$('btnExpedition').onclick = e => {
  e.currentTarget.blur();
  if (!expeditions.length || session) return;
  session = new LocalSession(null, { expedition: true });
  session.lobby();
};
$('btnHost').onclick = e => {
  e.currentTarget.blur();
  if (session) return;
  session = new NetSession('host', $('joinCode').value.trim().toUpperCase());
};
$('btnJoin').onclick = e => {
  e.currentTarget.blur();
  if (session) return;
  const code = $('joinCode').value.trim().toUpperCase();
  if (code.length !== 4) return showMsg('Co-op', 'Enter the 4-letter room code first.', 'OK', () => show('menu'));
  session = new NetSession('join', code);
};
$('btnStart').onclick = e => { e.currentTarget.blur(); session?.start(); };
$('btnLeave').onclick = () => session?.leave();

// ---------- demo / attract mode ----------
if (demoMode) {
  session = new LocalSession(null, { expedition: expeditions.length > 0 });
  session.roster.slice(0, 4).forEach((charId, i) => {
    session.players.push({ pid: i, name: 'BOT' + (i + 1), device: 'bot' + i, charId, cursor: 0, missingT: 0 });
  });
  session.inLobby = true;
  session.start();
  // dev: ?demo=1&warp=54,32 drops the squad at a tile for screenshots/testing
  const warp = new URLSearchParams(location.search).get('warp');
  if (warp && session.game) {
    const [wx, wy] = warp.split(',').map(Number);
    if (Number.isFinite(wx) && Number.isFinite(wy)) {
      const grid = session.game.grid;
      const open = (x, y) => grid[y]?.[x] && !'#T~o'.includes(grid[y][x]);
      // ring-scan to the nearest passable tile so a warp can't trap the squad
      let tx = wx, ty = wy;
      outer: for (let r = 0; r < 8; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            if (open(wx + dx, wy + dy)) { tx = wx + dx; ty = wy + dy; break outer; }
          }
        }
      }
      session.game.players.forEach((p, i) => {
        p.x = (tx + 0.5) * TILE + (i % 2) * 20;
        p.y = (ty + 0.5) * TILE + (i >> 1) * 20;
      });
    }
  }
}

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const polled = pollDevices();
  if (session) {
    session.tick?.(polled, dt);
    const snap = session.snap;
    if (snap) {
      render(ctx, snap, charMap, session.focusPids(), now / 1000, dt);
      updateHUD(snap);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
