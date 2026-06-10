import { createGame, step, snapshot, applyResults, charsById } from '/shared/game.js';
import { render, addEventFX } from './render.js';
import { playEvent, playUi, setupAudioToggle } from './audio.js';

const characters = await (await fetch('/shared/characters.json')).json();
const charMap = charsById(characters);
const levels = await (await fetch('/api/levels')).json();
const startingRoster = characters.filter(c => c.starting).map(c => c.id);

const $ = id => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const SAVE_KEY = 'holdout.save';

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
    card.innerHTML = `<div class="swatch" style="background:${ch.color};color:${ch.color}"></div>
      <div class="cname">${ch.name}</div>
      <div class="cstats">${ch.weapon.name}<br>SPD ${ch.speed} · DMG ${ch.weapon.damage}<br>RNG ${ch.weapon.range} · ${ch.weapon.count > 1 ? ch.weapon.count + '-shot' : 'single'}</div>`;
    if (!taken) card.onclick = () => session.pickChar(id);
    grid.appendChild(card);
  }
  $('btnStart').disabled = !canStart;
  show('lobby');
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
  lobby() {
    if (this.levelIdx >= levels.length) return this.victory();
    renderLobby({
      title: `Level ${this.levelIdx + 1} / ${levels.length} — ${levels[this.levelIdx].name}`,
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
    this.game = null;
    myCharPick = null;
    if (cleared) {
      this.roster = res.roster;
      this.levelIdx++;
      localStorage.setItem(SAVE_KEY, JSON.stringify({ levelIdx: this.levelIdx, roster: this.roster }));
      showMsg('Level Cleared', resultText(res) || 'Nicely done.', 'Continue', () => this.lobby());
    } else {
      showMsg('Level Failed', 'Time ran out or the whole squad went down.\nNo one is lost on a failed run — try again.', 'Retry', () => this.lobby());
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
      if (m.victory) {
        showMsg('Campaign Complete!', resultText(m) + `Final roster: ${m.roster.map(id => charMap[id].name).join(', ')}`, 'OK', () => this.leave());
      } else if (m.status === 'cleared') {
        showMsg('Level Cleared', resultText(m) || 'Nicely done.', 'To Lobby', () => this.renderLobby());
      } else {
        showMsg('Level Failed', 'No one is lost on a failed run — regroup and retry.', 'To Lobby', () => this.renderLobby());
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
      title: `Level ${m.levelIdx + 1} / ${m.totalLevels} — ${m.levelName || ''}`,
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
    if (snap) render(ctx, snap, charMap, session.myPid, now / 1000, dt);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
