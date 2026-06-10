import { createGame, step, snapshot, applyResults, charsById } from '/shared/game.js';
import { render, addEventFX, initTextures, drawPortrait } from './render.js';
import { playEvent, playUi, setupAudioToggle } from './audio.js';

const characters = await (await fetch('/shared/characters.json')).json();
const charMap = charsById(characters);
const levels = await (await fetch('/api/levels')).json();
const startingRoster = characters.filter(c => c.starting).map(c => c.id);
await initTextures(charMap);

const $ = id => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const SAVE_KEY = 'holdout-iso.save';
const MONO_KEY = 'holdout-iso.mono';

let session = null;
let myCharPick = null;
let monoEarned = parseInt(localStorage.getItem(MONO_KEY) || '0', 10);
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
// Rotate screen-relative keys 45° into world axes so "up" walks up-screen
// in the iso projection (screen dir s maps to world dir w = (sx+sy, sy-sx)).
const currentInput = () => {
  const kx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const ky = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  const wx = kx + ky, wy = ky - kx;
  return { up: wy < -0.5, down: wy > 0.5, left: wx < -0.5, right: wx > 0.5, fire: !!keys.fire };
};

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
  $('btnMsgOk').textContent = btnLabel || 'CONTINUE';
  $('btnMsgOk').onclick = onOk;
  show('msg');
}
function resultText(res) {
  let s = '';
  if (res.gained?.length) s += `RECRUITED: ${res.gained.map(id => charMap[id].name).join(', ')}\n`;
  if (res.lost?.length) s += `LOST IN THE FIELD: ${res.lost.map(id => charMap[id].name).join(', ')}\n`;
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
    drawPortrait(pc, ch);
    card.appendChild(pc);
    const meta = document.createElement('div');
    meta.innerHTML = `<div class="cname" style="color:${ch.color}">${ch.name.toUpperCase()}</div>
      <div class="cstats">${ch.weapon.name.toUpperCase()}<br>SPD ${ch.speed} · DMG ${ch.weapon.damage} · RNG ${ch.weapon.range}</div>`;
    card.appendChild(meta);
    if (!taken) card.onclick = () => session.pickChar(id);
    grid.appendChild(card);
  }
  $('btnStart').disabled = !canStart;
  show('lobby');
  buildSquadPool(roster);
  updateOperativePanel(myCharPick);
  updateRoundPanel();
}

// ---------- HUD ----------
const SLOTS = 24;
const poolSlots = [];
let poolRoster = [];

function buildSquadPool(roster) {
  const host = $('squadPool');
  host.innerHTML = '';
  poolSlots.length = 0;
  poolRoster = roster.slice(0, SLOTS);
  for (let i = 0; i < SLOTS; i++) {
    const slot = document.createElement('div');
    const id = poolRoster[i];
    if (id) {
      slot.className = 'slot';
      const pc = document.createElement('canvas');
      drawPortrait(pc, charMap[id]);
      slot.appendChild(pc);
      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.textContent = 'READY';
      slot.appendChild(tag);
    } else {
      slot.className = 'slot empty';
    }
    host.appendChild(slot);
    poolSlots.push(slot);
  }
}

function charStatus(id, snap) {
  for (const p of snap.players) if (p.charId === id && p.state === 'active') return ['FIELD', 'infield'];
  for (const c of snap.captives) if (c.charId === id) return [c.owner != null ? 'CARRY' : 'DOWN', 'down'];
  if (snap.rescued.includes(id)) return ['OUT', ''];
  return ['READY', ''];
}

function updateOperativePanel(charId) {
  const ch = charId ? charMap[charId] : null;
  $('opName').textContent = ch ? ch.name.toUpperCase() : '—';
  $('opWeapon').textContent = ch ? ch.weapon.name.toUpperCase() : '—';
  if (ch) {
    const mag = Math.max(24, Math.round((ch.weapon.count || 1) * 24 + ch.weapon.damage * 22));
    const reserve = Math.max(mag * 2, Math.round(mag + ch.weapon.range * 34));
    $('opAmmo').textContent = `${mag}/${reserve}`;
  } else {
    $('opAmmo').textContent = '—';
  }
  $('opHealth').style.width = ch ? '100%' : '0%';
  $('opSpeed').style.width = ch ? Math.min(100, ch.speed / 5 * 100) + '%' : '0%';
  $('opRange').style.width = ch ? Math.min(100, ch.weapon.range / 12 * 100) + '%' : '0%';
  if (ch) drawPortrait($('opPortrait'), ch);
}

function updateRoundPanel() {
  const idx = session?.levelIdxView?.() ?? 0;
  const lvl = levels[Math.min(idx, levels.length - 1)];
  $('hRoundNo').textContent = `ROUND 1-${idx + 1}:`;
  $('hRoundName').textContent = (lvl?.name || '—').toUpperCase();
}

let lastMyChar = null;
function updateHUD(snap) {
  $('hScore').textContent = (snap.score ?? 0).toLocaleString();
  const tl = Math.max(0, snap.timeLeft);
  const timeEl = $('hTime');
  timeEl.textContent = `${String(Math.floor(tl / 60)).padStart(2, '0')}:${String(Math.floor(tl % 60)).padStart(2, '0')}`;
  timeEl.className = tl < 15 ? 'warn' : '';
  $('hKills').textContent = snap.kills ?? 0;
  $('wMono').textContent = (monoEarned + Math.floor((snap.score ?? 0) / 10)).toLocaleString();

  for (let i = 0; i < poolRoster.length; i++) {
    const id = poolRoster[i];
    if (!id) continue;
    const [label, cls] = charStatus(id, snap);
    poolSlots[i].className = 'slot' + (cls ? ' ' + cls : '');
    poolSlots[i].querySelector('.tag').textContent = label;
  }

  const me = snap.players.find(p => p.pid === session?.myPid);
  if (me?.charId && me.charId !== lastMyChar) {
    lastMyChar = me.charId;
    updateOperativePanel(me.charId);
  }
}

function bankScore(score) {
  monoEarned += Math.floor(score / 10);
  localStorage.setItem(MONO_KEY, String(monoEarned));
}

// ---------- solo session ----------
class LocalSession {
  constructor(save) {
    this.levelIdx = save?.levelIdx ?? 0;
    this.roster = save?.roster ?? startingRoster.slice();
    this.myPid = 0;
    this.partyPids = [0];
    this.game = null;
    this.snap = null;
    this.name = $('nameInput').value.trim() || 'You';
  }
  levelIdxView() { return this.levelIdx; }
  lobby() {
    if (this.levelIdx >= levels.length) return this.victory();
    renderLobby({
      title: `ROUND 1-${this.levelIdx + 1} // ${levels[this.levelIdx].name.toUpperCase()}`,
      info: 'SOLO CAMPAIGN · PROGRESS AUTOSAVES',
      players: [{ name: this.name, charId: myCharPick, isHost: true, me: true }],
      roster: this.roster,
      canStart: !!myCharPick,
    });
  }
  pickChar(id) { myCharPick = id; this.lobby(); }
  start() {
    if (!myCharPick) return;
    const squadIds = [myCharPick, ...this.roster.filter(id => id !== myCharPick)].slice(0, 4);
    const party = squadIds.map((charId, i) => ({
      pid: i,
      name: i === 0 ? this.name : charMap[charId].name,
      charId,
    }));
    this.partyPids = party.map(p => p.pid);
    this.game = createGame(levels[this.levelIdx], party, charMap, this.roster);
    this.snap = null;
    lastMyChar = null;
    hideAll();
  }
  update(dt) {
    if (!this.game || this.game.status !== 'play') return;
    const input = currentInput();
    const inputs = {};
    for (const pid of this.partyPids) inputs[pid] = input;
    step(this.game, inputs, dt);
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
      bankScore(score);
      this.roster = res.roster;
      this.levelIdx++;
      localStorage.setItem(SAVE_KEY, JSON.stringify({ levelIdx: this.levelIdx, roster: this.roster }));
      showMsg('ROUND CLEARED', (resultText(res) || 'NICELY DONE.') + `\nSCORE: ${score.toLocaleString()} · +${Math.floor(score / 10)} $MONO`, 'CONTINUE', () => this.lobby());
    } else {
      showMsg('ROUND FAILED', 'TIME RAN OUT OR THE SQUAD WENT DOWN.\nNO ONE IS LOST ON A FAILED RUN — TRY AGAIN.', 'RETRY', () => this.lobby());
    }
  }
  victory() {
    localStorage.removeItem(SAVE_KEY);
    playUi('victory');
    showMsg('CAMPAIGN COMPLETE', `YOU HELD OUT TO THE END.\nFINAL ROSTER: ${this.roster.map(id => charMap[id].name).join(', ').toUpperCase()}`, 'MAIN MENU', () => { session = null; show('menu'); refreshContinue(); });
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
        showMsg('DISCONNECTED', 'LOST CONNECTION TO THE SERVER.', 'MAIN MENU', () => { show('menu'); refreshContinue(); });
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
    else if (m.t === 'levelStart') { this.snap = null; lastMyChar = null; hideAll(); }
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
        showMsg('CAMPAIGN COMPLETE', resultText(m) + `FINAL ROSTER: ${m.roster.map(id => charMap[id].name).join(', ').toUpperCase()}`, 'OK', () => this.leave());
      } else if (m.status === 'cleared') {
        if (this.lobbyData) this.lobbyData.levelIdx++;
        showMsg('ROUND CLEARED', resultText(m) || 'NICELY DONE.', 'TO LOBBY', () => this.renderLobby());
      } else {
        showMsg('ROUND FAILED', 'NO ONE IS LOST ON A FAILED RUN — REGROUP AND RETRY.', 'TO LOBBY', () => this.renderLobby());
      }
    }
    else if (m.t === 'error') {
      this.close();
      showMsg('CO-OP', m.error, 'MAIN MENU', () => { show('menu'); refreshContinue(); });
    }
  }
  renderLobby() {
    const m = this.lobbyData;
    if (!m) return;
    const isHost = m.players.find(p => p.pid === this.myPid)?.isHost;
    const allPicked = m.players.every(p => p.charId);
    renderLobby({
      title: `ROUND 1-${m.levelIdx + 1} // ${(m.levelName || '').toUpperCase()}`,
      info: `ROOM CODE: <b>${m.room}</b> — FRIENDS JOIN WITH THIS CODE`,
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
$('wMono').textContent = monoEarned.toLocaleString();
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
  if (code.length !== 4) return showMsg('CO-OP', 'ENTER THE 4-LETTER ROOM CODE FIRST.', 'OK', () => show('menu'));
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
