import express from 'express';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createGame, step, snapshot, applyResults, charsById } from './shared/game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const TICK = 1 / 30;

// --- load data ---
const characters = JSON.parse(fs.readFileSync(path.join(__dirname, 'shared/characters.json'), 'utf8'));
const charMap = charsById(characters);
const startingRoster = characters.filter(c => c.starting).map(c => c.id);

const levelsDir = path.join(__dirname, 'levels');
const levels = fs.readdirSync(levelsDir).filter(f => f.endsWith('.json')).sort()
  .map(f => {
    const def = JSON.parse(fs.readFileSync(path.join(levelsDir, f), 'utf8'));
    const w = def.tiles[0].length;
    if (!def.tiles.every(r => r.length === w)) throw new Error(`Level ${f}: all tile rows must be the same width`);
    return def;
  });
console.log(`Loaded ${levels.length} levels, ${characters.length} characters`);

const savesDir = path.join(__dirname, 'saves');
fs.mkdirSync(savesDir, { recursive: true });
const savePath = code => path.join(savesDir, code.replace(/[^A-Z0-9]/g, '') + '.json');

// --- http ---
const app = express();
app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/levels', (req, res) => res.json(levels));
const server = app.listen(PORT, () => console.log(`HOLDOUT running at http://localhost:${PORT}`));

// --- websocket rooms ---
const wss = new WebSocketServer({ server });
const rooms = new Map();
let nextPid = 1;

function makeCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from(crypto.randomBytes(4)).map(b => chars[b % chars.length]).join('');
  } while (rooms.has(code));
  return code;
}

function sendTo(p, msg) {
  if (p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
}

function broadcast(room, msg) {
  const s = JSON.stringify(msg);
  for (const p of room.players.values()) if (p.ws.readyState === 1) p.ws.send(s);
}

function lobbyState(room) {
  return {
    t: 'lobby',
    room: room.code,
    levelIdx: room.levelIdx,
    levelName: levels[room.levelIdx]?.name || null,
    totalLevels: levels.length,
    roster: room.roster,
    players: [...room.players.values()].map(p => ({ pid: p.pid, name: p.name, charId: p.charId, isHost: p.pid === room.hostPid })),
  };
}

function destroyRoom(room) {
  if (room.timer) clearInterval(room.timer);
  rooms.delete(room.code);
}

function endLevel(room) {
  clearInterval(room.timer);
  room.timer = null;
  const g = room.game;
  const res = applyResults(room.roster, g);
  room.roster = res.roster;
  let victory = false;
  if (g.status === 'cleared') {
    room.levelIdx++;
    victory = room.levelIdx >= levels.length;
    fs.writeFileSync(savePath(room.code), JSON.stringify({ levelIdx: room.levelIdx, roster: room.roster }));
  }
  for (const p of room.players.values()) p.charId = null;
  broadcast(room, { t: 'levelEnd', status: g.status, gained: res.gained, lost: res.lost, roster: room.roster, victory });
  room.game = null;
}

function startLevel(room) {
  const party = [...room.players.values()].filter(p => p.charId).map(p => ({ pid: p.pid, name: p.name, charId: p.charId }));
  if (!party.length) return;
  room.game = createGame(levels[room.levelIdx], party, charMap, room.roster);
  broadcast(room, { t: 'levelStart' });
  room.timer = setInterval(() => {
    const inputs = {};
    for (const p of room.players.values()) inputs[p.pid] = p.input;
    step(room.game, inputs, TICK);
    broadcast(room, { t: 'state', s: snapshot(room.game) });
    if (room.game.status !== 'play') endLevel(room);
  }, TICK * 1000);
}

wss.on('connection', ws => {
  const me = { pid: nextPid++, ws, name: 'Player', charId: null, input: {}, room: null };

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const room = me.room;

    if (m.t === 'host') {
      me.name = String(m.name || 'Player').slice(0, 12);
      let code = makeCode();
      let levelIdx = 0, roster = startingRoster.slice();
      const resume = String(m.resume || '').toUpperCase().trim();
      if (resume && !rooms.has(resume) && fs.existsSync(savePath(resume))) {
        try {
          const save = JSON.parse(fs.readFileSync(savePath(resume), 'utf8'));
          code = resume;
          levelIdx = Math.min(save.levelIdx, levels.length - 1);
          roster = save.roster;
        } catch { /* corrupt save: start fresh */ }
      }
      const r = { code, hostPid: me.pid, players: new Map([[me.pid, me]]), levelIdx, roster, game: null, timer: null };
      rooms.set(code, r);
      me.room = r;
      sendTo(me, { t: 'joined', you: me.pid });
      broadcast(r, lobbyState(r));
    }
    else if (m.t === 'join') {
      const r = rooms.get(String(m.room || '').toUpperCase().trim());
      if (!r) return sendTo(me, { t: 'error', error: 'Room not found' });
      if (r.game) return sendTo(me, { t: 'error', error: 'Game in progress, wait for the level to end' });
      me.name = String(m.name || 'Player').slice(0, 12);
      r.players.set(me.pid, me);
      me.room = r;
      sendTo(me, { t: 'joined', you: me.pid });
      broadcast(r, lobbyState(r));
    }
    else if (m.t === 'select' && room && !room.game) {
      const id = String(m.charId || '');
      const taken = [...room.players.values()].some(p => p !== me && p.charId === id);
      if (room.roster.includes(id) && !taken) me.charId = id;
      broadcast(room, lobbyState(room));
    }
    else if (m.t === 'start' && room && me.pid === room.hostPid && !room.game) {
      if (room.levelIdx >= levels.length) return;
      startLevel(room);
    }
    else if (m.t === 'input' && room) {
      me.input = m.input || {};
    }
  });

  ws.on('close', () => {
    const room = me.room;
    if (!room) return;
    room.players.delete(me.pid);
    if (room.game) {
      const gp = room.game.players.find(p => p.pid === me.pid);
      if (gp && (gp.state === 'active' || gp.state === 'down')) gp.state = 'out';
    }
    if (!room.players.size || me.pid === room.hostPid) {
      broadcast(room, { t: 'error', error: 'Host left — room closed' });
      destroyRoom(room);
    } else {
      broadcast(room, lobbyState(room));
    }
  });
});
