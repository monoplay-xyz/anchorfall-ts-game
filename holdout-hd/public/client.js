import { createGame, step, snapshot, applyResults, charsById } from '/shared/game.js';
import { render, renderMinimap, addEventFX, initTextures, drawPortrait, drawWeaponIcon } from './render.js';
import { playEvent, playUi, setupAudioToggle } from './audio.js';

const characters = await (await fetch('/shared/characters.json')).json();
const charMap = charsById(characters);
const levels = await (await fetch('/api/levels')).json();
const startingRoster = characters.filter(c => c.starting).map(c => c.id);
await initTextures();

const $ = id => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const mmCtx = $('minimap').getContext('2d');
const SAVE_KEY = 'holdout-hd.save';

let session = null;
let myCharPick = null;
setupAudioToggle($('btnAudio'));

// ---------- input ----------
const keys = {};
const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Space: 'fire', KeyJ: 'fire',
};
addEventListener('keydown', e => {
  const k = KEYMAP[e.code];
  if (k) { keys[k] = true; e.preventDefault(); }
});
addEventListener('keyup', e => {
  const k = KEYMAP[e.code];
  if (k) keys[k] = false;
});
const currentInput = () => ({ up: !!keys.up, down: !!keys.down, left: !!keys.left, right: !!keys.right, fire: !!keys.fire });

// ---------- screens ----------
function show(id) {
  for (const s of ['menu', 'lobby', 'msg']) $(s).hidden = s !== id;
}
function hideAll() {
  for (const s of ['menu', 'lobby', 'msg']) $(s).hidden = true;
}
function showMsg(title, body, btnLabel, onOk) {
  $('msgTitle').textContent = title;
  $('msgBody').textContent = body;
  $('btnMsgOk').textContent = btnLabel || 'Continue';
  $('btnMsgOk').onclick = onOk;
  show('msg');
}
function resultText(res) {
  let s = '';
  if (res.gained?.length) s += `Recruited: ${res.gained.map(id => charMap[id].name).join(', ')}\n`;
  if (res.lost?.length) s += `Lost in the field: ${res.lost.map(id => charMap[id].name).join(', ')}\n`;
  return s;
}

function renderLobby({ title, info, players, roster, canStart }) {
  $('lobbyTitle').textContent = title;
  $('roomInfo').innerHTML = info;
  const pl = $('playerList');
  pl.innerHTML = '';
  for (const p of players) {
    const chip = document.createElement('span');
    chip.className = 'pchip';
    const col = p.charId ? charMap[p.charId].color : '#555';
    chip.innerHTML = `<span class="dot" style="background:${col}"></span>${p.name}${p.isHost ? ' ★' : ''}${p.charId ? ' — ' + charMap[p.charId].name : ''}`;
    pl.appendChild(chip);
  }
  const grid = $('charGrid');
  grid.innerHTML = '';
  const takenBy = {};
  for (const p of players) if (p.charId) takenBy[p.charId] = p;
  for (const id of roster) {
    const ch = charMap[id];
    const card = document.createElement('div');
    const taken = takenBy[id] && !takenBy[id].me;
    card.className = 'card' + (myCharPick === id ? ' selected' : '') + (taken ? ' taken' : '');
    const pc = document.createElement('canvas');
    drawPortrait(pc, ch, 56);
    card.appendChild(pc);
    const meta = document.createElement('div');
    meta.innerHTML = `<div class="cname" style="color:${ch.color}">${ch.name.toUpperCase()}</div>
      <div class="cstats">${ch.weapon.name}<br>SPD ${ch.speed} · DMG ${ch.weapon.damage} · RNG ${ch.weapon.range}</div>`;
    card.appendChild(meta);
    if (!taken) card.onclick = () => session.pickChar(id);
    grid.appendChild(card);
  }
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
  const lvl = levels[Math.min(idx, levels.length - 1)];
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

  for (const [id, card] of Object.entries(squadCards)) {
    const [label, cls, pct] = charStatus(id, snap);
    card.className = 'squadcard' + (cls ? ' ' + cls : '');
    card.querySelector('.st').textContent = label;
    card.querySelector('.bar i').style.width = pct + '%';
  }
  $('squadStatusBody').textContent = `Hostiles: ${snap.enemies.length} · Rescued: ${snap.rescued.length}`;

  const me = snap.players.find(p => p.pid === session?.myPid);
  const ch = me?.charId ? charMap[me.charId] : null;
  if (ch) {
    $('wName').textContent = ch.weapon.name.toUpperCase();
    drawWeaponIcon($('wIcon'), ch);
    $('wStats').textContent = `DMG ${ch.weapon.damage} · RNG ${ch.weapon.range} · ROF ${(1 / ch.weapon.cooldown).toFixed(1)}/s`;
  }
  renderMinimap(mmCtx, snap, session?.myPid);
}

// ---------- solo session ----------
class LocalSession {
  constructor(save) {
    this.levelIdx = save?.levelIdx ?? 0;
    this.roster = save?.roster ?? startingRoster.slice();
    this.myPid = 0;
    this.game = null;
    this.snap = null;
    this.name = $('nameInput').value.trim() || 'You';
  }
  levelIdxView() { return this.levelIdx; }
  lobby() {
    if (this.levelIdx >= levels.length) return this.victory();
    renderLobby({
      title: `Mission ${this.levelIdx + 1} / ${levels.length} — ${levels[this.levelIdx].name}`,
      info: 'Solo campaign · progress autosaves',
      players: [{ name: this.name, charId: myCharPick, isHost: true, me: true }],
      roster: this.roster,
      canStart: !!myCharPick,
    });
  }
  pickChar(id) { myCharPick = id; this.lobby(); }
  start() {
    if (!myCharPick) return;
    this.game = createGame(levels[this.levelIdx], [{ pid: 0, name: this.name, charId: myCharPick }], charMap, this.roster);
    this.snap = null;
    hideAll();
  }
  update(dt) {
    if (!this.game || this.game.status !== 'play') return;
    step(this.game, { 0: currentInput() }, dt);
    this.snap = snapshot(this.game);
    for (const ev of this.snap.events) { addEventFX(ev); playEvent(ev); }
    if (this.snap.status !== 'play') this.finish();
  }
  finish() {
    const res = applyResults(this.roster, this.game);
    const cleared = this.game.status === 'cleared';
    const score = Math.round(this.game.score);
    this.game = null;
    myCharPick = null;
    if (cleared) {
      this.roster = res.roster;
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
    showMsg('Campaign Complete!', `You held out to the end.\nFinal roster: ${this.roster.map(id => charMap[id].name).join(', ')}`, 'Main Menu', () => { session = null; show('menu'); refreshContinue(); });
  }
  leave() { session = null; show('menu'); refreshContinue(); }
}

// ---------- co-op session ----------
class NetSession {
  constructor(mode, code) {
    this.myPid = null;
    this.snap = null;
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
      if (session === this) {
        session = null;
        showMsg('Disconnected', 'Lost connection to the server.', 'Main Menu', () => { show('menu'); refreshContinue(); });
      }
    };
    this.inputTimer = setInterval(() => {
      if (this.ws.readyState === 1 && this.snap?.status === 'play') {
        this.ws.send(JSON.stringify({ t: 'input', input: currentInput() }));
      }
    }, 50);
  }
  levelIdxView() { return this.lobbyData?.levelIdx ?? 0; }
  onMsg(m) {
    if (m.t === 'joined') this.myPid = m.you;
    else if (m.t === 'lobby') {
      this.lobbyData = m;
      const me = m.players.find(p => p.pid === this.myPid);
      myCharPick = me?.charId || null;
      this.renderLobby();
    }
    else if (m.t === 'levelStart') { this.snap = null; hideAll(); }
    else if (m.t === 'state') {
      const prev = this.snap;
      this.snap = m.s;
      for (const ev of m.s.events) { addEventFX(ev); playEvent(ev); }
      if (!prev) hideAll();
    }
    else if (m.t === 'levelEnd') {
      myCharPick = null;
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
      players: m.players.map(p => ({ ...p, me: p.pid === this.myPid })),
      roster: m.roster,
      canStart: isHost && allPicked,
    });
  }
  pickChar(id) { this.ws.send(JSON.stringify({ t: 'select', charId: id })); }
  start() { this.ws.send(JSON.stringify({ t: 'start' })); }
  update() {}
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

$('btnSolo').onclick = () => { localStorage.removeItem(SAVE_KEY); session = new LocalSession(); session.lobby(); };
$('btnContinue').onclick = () => {
  let save = null;
  try { save = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch {}
  session = new LocalSession(save);
  session.lobby();
};
$('btnHost').onclick = () => { session = new NetSession('host', $('joinCode').value.trim().toUpperCase()); };
$('btnJoin').onclick = () => {
  const code = $('joinCode').value.trim().toUpperCase();
  if (code.length !== 4) return showMsg('Co-op', 'Enter the 4-letter room code first.', 'OK', () => show('menu'));
  session = new NetSession('join', code);
};
$('btnStart').onclick = () => session?.start();
$('btnLeave').onclick = () => session?.leave();

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (session) {
    session.update(dt);
    const snap = session.snap;
    if (snap) {
      render(ctx, snap, charMap, session.myPid, now / 1000, dt);
      updateHUD(snap);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
