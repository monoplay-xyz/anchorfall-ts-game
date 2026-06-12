import express from 'express';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createGame, step, snapshot, applyResults, charsById } from './shared/game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const TICK = 1 / 30;

// --- load data ---
const characters = JSON.parse(fs.readFileSync(path.join(__dirname, 'shared/characters.json'), 'utf8'));
const charMap = charsById(characters);
const startingRoster = characters.filter(c => c.starting).map(c => c.id);

// levels/ is organized by category subdirectory (classic/story/stronghold/ctf/br);
// each def carries its subdir name as def.category, and the mode lists below
// derive from it. /api/levels stays one flat array so the client keeps working.
const levelsDir = path.join(__dirname, 'levels');
const CATEGORY_ORDER = ['classic', 'story', 'stronghold', 'ctf', 'br'];
const catRank = c => { const i = CATEGORY_ORDER.indexOf(c); return i === -1 ? CATEGORY_ORDER.length : i; };
const categories = fs.readdirSync(levelsDir, { withFileTypes: true })
  .filter(d => d.isDirectory()).map(d => d.name)
  .sort((a, b) => catRank(a) - catRank(b) || (a < b ? -1 : a > b ? 1 : 0));
const levels = categories.flatMap(cat =>
  fs.readdirSync(path.join(levelsDir, cat)).filter(f => f.endsWith('.json')).sort()
    .map(f => {
      const def = JSON.parse(fs.readFileSync(path.join(levelsDir, cat, f), 'utf8'));
      const w = def.tiles[0].length;
      if (!def.tiles.every(r => r.length === w)) throw new Error(`Level ${cat}/${f}: all tile rows must be the same width`);
      def.category = cat;
      return def;
    }));
const classicLevels = levels.filter(l => l.category === 'classic');
const storyLevels = levels.filter(l => l.category === 'story').sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0));
const ctfLevels = levels.filter(l => l.category === 'ctf');
const brLevels = levels.filter(l => l.category === 'br');
const bastionLevels = levels.filter(l => l.category === 'stronghold');
const roomLevels = room => room.mode === 'story' ? storyLevels
  : room.mode === 'ctf' ? ctfLevels
  : room.mode === 'br' ? brLevels
  : room.mode === 'bastion' ? bastionLevels
  : classicLevels;
const isPvp = room => room.mode === 'ctf' || room.mode === 'br';
// pvp and bastion rooms are one-shots: never saved, never resumed, never
// advanced — the lobby is the rematch on the same map
const isOneShot = room => isPvp(room) || room.mode === 'bastion';
console.log(`Loaded ${levels.length} levels (${classicLevels.length} classic, ${storyLevels.length} story, ${bastionLevels.length} stronghold, ${ctfLevels.length} ctf, ${brLevels.length} br), ${characters.length} characters`);

const savesDir = path.join(__dirname, 'saves');
fs.mkdirSync(savesDir, { recursive: true });
const savePath = code => path.join(savesDir, code.replace(/[^A-Z0-9]/g, '') + '.json');

// --- http ---
const app = express();
app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/levels', (req, res) => res.json(levels));
const lanIp = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal)?.address;
const lanUrl = lanIp ? `http://${lanIp}:${PORT}` : null;
const server = app.listen(PORT, () => {
  console.log(`HOLDOUT running at http://localhost:${PORT}`);
  if (lanUrl) console.log(`LAN: ${lanUrl}`);
});

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

// CTF teams alternate over join/seat order (Map insertion order — local seats on
// one ws slot in where they were added); leavers cause a clean re-alternation.
function assignTeams(room) {
  if (room.mode !== 'ctf') return;
  let i = 0;
  for (const p of room.players.values()) p.team = i++ % 2;
}

function lobbyState(room) {
  assignTeams(room);
  const list = roomLevels(room);
  const def = list[room.levelIdx];
  return {
    t: 'lobby',
    room: room.code,
    mode: room.mode,
    levelIdx: room.levelIdx,
    levelName: def?.name || null,
    levelTitle: def?.title || undefined,
    totalLevels: list.length,
    roster: room.roster,
    lan: lanUrl || undefined,
    players: [...room.players.values()].map(p => ({ pid: p.pid, name: p.name, charId: p.charId, isHost: p.pid === room.hostPid, team: p.team })),
  };
}

function destroyRoom(room) {
  if (room.timer) clearInterval(room.timer);
  rooms.delete(room.code);
}

function endLevel(room) {
  clearInterval(room.timer);
  room.timer = null;
  const list = roomLevels(room);
  const def = list[room.levelIdx]; // the chapter just played
  const g = room.game;
  const res = applyResults(room.roster, g); // pvp: sim returns the roster untouched
  room.roster = res.roster;
  let victory = false;
  if (g.status === 'cleared' && !isOneShot(room)) {
    room.levelIdx++;
    victory = room.levelIdx >= list.length;
    fs.writeFileSync(savePath(room.code), JSON.stringify({ mode: room.mode, levelIdx: room.levelIdx, roster: room.roster }));
  }
  // pvp/bastion rooms never save and never advance — rematch replays the same map (levelIdx stays 0)
  for (const p of room.players.values()) p.charId = null;
  room.phase = 'lobby';
  const msg = { t: 'levelEnd', status: g.status, gained: res.gained, lost: res.lost, roster: room.roster, victory };
  if (isPvp(room)) {
    if (g.winner !== undefined) msg.winner = g.winner; // ctf: team 0|1, br: pid
    if (g.caps) msg.caps = g.caps.slice();
  }
  if (room.mode === 'story') {
    if (g.status === 'cleared' && def.outro?.length) msg.outro = def.outro;
    const next = list[room.levelIdx];
    if (next?.title) msg.nextTitle = next.title;
  }
  broadcast(room, msg);
  room.game = null;
  // picks were cleared — push the fresh lobby so Deploy can't act on stale state
  broadcast(room, lobbyState(room));
}

function startLevel(room) {
  assignTeams(room); // ctf party entries carry their lobby team into the sim
  const party = [...room.players.values()].filter(p => p.charId).map(p => ({ pid: p.pid, name: p.name, charId: p.charId, team: p.team }));
  if (!party.length) return;
  if (room.mode === 'br' && party.length < 2) return; // BR is meaningless solo
  for (const p of room.players.values()) p.input = {};
  room.game = createGame(roomLevels(room)[room.levelIdx], party, charMap, room.roster);
  room.phase = 'play';
  // The static grid rides along once here; per-tick snapshots omit it.
  broadcast(room, { t: 'levelStart', s: snapshot(room.game, true) });
  room.timer = setInterval(() => {
    const inputs = {};
    for (const p of room.players.values()) inputs[p.pid] = p.input;
    step(room.game, inputs, TICK);
    broadcast(room, { t: 'state', s: snapshot(room.game, false) });
    if (room.game.status !== 'play') endLevel(room);
  }, TICK * 1000);
}

wss.on('connection', ws => {
  // `me` is the connection's PRIMARY player; addLocal grows extra seats on the same ws.
  const me = { pid: nextPid++, ws, name: 'Player', charId: null, input: {}, primary: true, room: null };
  const ownedBy = room => [...room.players.values()].filter(p => p.ws === ws);

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const room = me.room;

    if (m.t === 'host') {
      me.name = String(m.name || 'Player').slice(0, 12);
      let code = makeCode();
      let mode = ['story', 'ctf', 'br', 'bastion'].includes(m.mode) ? m.mode : 'classic';
      let levelIdx = 0, roster = startingRoster.slice();
      // pvp/bastion rooms never save, so they never resume either (the client
      // reuses the join-code field for resume — don't let stray text morph a
      // one-shot room into a campaign)
      const resume = mode === 'ctf' || mode === 'br' || mode === 'bastion' ? '' : String(m.resume || '').toUpperCase().trim();
      if (resume && !rooms.has(resume) && fs.existsSync(savePath(resume))) {
        try {
          const save = JSON.parse(fs.readFileSync(savePath(resume), 'utf8'));
          code = resume;
          mode = save.mode === 'story' ? 'story' : 'classic'; // a save's stored mode wins; old 2-field saves are classic
          levelIdx = Math.min(save.levelIdx ?? 0, (mode === 'story' ? storyLevels : classicLevels).length - 1);
          roster = save.roster;
        } catch { /* corrupt save: start fresh */ }
      }
      // stronghold: the host's level-select pick rides the host message
      // (narrow levelIdx passthrough for 'bastion' rooms, clamped; unlock
      // gating is client-side by design — the host menu only offers unlocked levels)
      if (mode === 'bastion' && m.levelIdx != null && bastionLevels.length) {
        const li = Math.floor(Number(m.levelIdx));
        if (Number.isFinite(li)) levelIdx = Math.max(0, Math.min(bastionLevels.length - 1, li));
      }
      // stronghold: the host's EARNED roster rides the host message too —
      // validate to known ids, dedupe, and always include every starter
      // (starters first, then the validated extras in client order). An
      // invalid/absent roster falls back to the starters-only default above.
      if (mode === 'bastion' && Array.isArray(m.roster)) {
        const extras = [...new Set(m.roster.map(String))]
          .filter(id => charMap[id] && !startingRoster.includes(id));
        roster = [...startingRoster, ...extras].slice(0, characters.length);
      }
      const r = { code, mode, hostPid: me.pid, players: new Map([[me.pid, me]]), levelIdx, roster, game: null, timer: null, phase: 'lobby' };
      rooms.set(code, r);
      me.room = r;
      sendTo(me, { t: 'joined', you: me.pid });
      broadcast(r, lobbyState(r));
    }
    else if (m.t === 'join') {
      const r = rooms.get(String(m.room || '').toUpperCase().trim());
      if (!r) return sendTo(me, { t: 'error', error: 'Room not found' });
      if (r.game || r.phase !== 'lobby') return sendTo(me, { t: 'error', error: 'Game in progress, wait for the level to end' });
      if (r.players.size >= 8) return sendTo(me, { t: 'error', error: 'Room is full' });
      me.name = String(m.name || 'Player').slice(0, 12);
      r.players.set(me.pid, me);
      me.room = r;
      sendTo(me, { t: 'joined', you: me.pid });
      broadcast(r, lobbyState(r));
    }
    else if (m.t === 'addLocal' && room && room.phase === 'lobby' && !room.game) {
      if (room.players.size >= 8 || ownedBy(room).length >= 4) return;
      const p = { pid: nextPid++, ws, name: String(m.name || 'Player').slice(0, 12), charId: null, input: {}, primary: false };
      room.players.set(p.pid, p);
      sendTo(p, { t: 'localAdded', tag: m.tag, pid: p.pid });
      broadcast(room, lobbyState(room));
    }
    else if (m.t === 'removeLocal' && room && room.phase === 'lobby' && !room.game) {
      const p = room.players.get(Number(m.pid));
      if (!p || p.ws !== ws || p.primary) return;
      room.players.delete(p.pid);
      broadcast(room, lobbyState(room));
    }
    else if (m.t === 'select' && room && room.phase === 'lobby' && !room.game) {
      const target = m.pid == null ? me : room.players.get(Number(m.pid));
      if (!target || target.ws !== ws) return;
      const id = String(m.charId || '');
      if (!id || target.charId === id) target.charId = null; // re-pick / empty = unlock
      else {
        assignTeams(room);
        // pvp relaxes uniqueness: ctf allows the same char on opposite teams,
        // br is all-teams-of-one so duplicates are always fine
        const taken = [...room.players.values()].some(p => p !== target && p.charId === id
          && room.mode !== 'br' && (room.mode !== 'ctf' || p.team === target.team));
        if (room.roster.includes(id) && !taken) target.charId = id;
      }
      broadcast(room, lobbyState(room));
    }
    else if (m.t === 'start' && room && me.pid === room.hostPid && room.phase === 'lobby' && !room.game) {
      const list = roomLevels(room);
      if (room.levelIdx >= list.length) return;
      // br needs a real field — the client greys Deploy out too, this is the backstop
      if (room.mode === 'br' && [...room.players.values()].filter(p => p.charId).length < 2) return;
      const def = list[room.levelIdx];
      if ((room.mode === 'story' || room.mode === 'bastion') && def.intro?.length) {
        if (![...room.players.values()].some(p => p.charId)) return; // no party — don't strand the room in intro
        room.phase = 'intro';
        broadcast(room, { t: 'cutscene', slides: def.intro, title: def.stronghold?.name || def.title || def.name });
      } else startLevel(room);
    }
    else if (m.t === 'cutsceneDone' && room && me.pid === room.hostPid && room.phase === 'intro') {
      startLevel(room);
      if (!room.game) { room.phase = 'lobby'; broadcast(room, lobbyState(room)); } // party evaporated mid-cutscene
    }
    else if (m.t === 'input' && room) {
      if (m.inputs && typeof m.inputs === 'object') {
        for (const [k, v] of Object.entries(m.inputs)) {
          const p = room.players.get(Number(k));
          if (p && p.ws === ws && v && typeof v === 'object') p.input = v;
        }
      } else me.input = m.input || {}; // legacy single form drives the primary
    }
  });

  ws.on('close', () => {
    const room = me.room;
    if (!room) return;
    for (const p of ownedBy(room)) {
      if (room.game) {
        const gp = room.game.players.find(g => g.pid === p.pid);
        if (gp && (gp.state === 'active' || gp.state === 'down' || gp.state === 'pick')) gp.state = 'out';
      }
      room.players.delete(p.pid);
    }
    if (!room.players.size || me.pid === room.hostPid) {
      broadcast(room, { t: 'error', error: 'Host left — room closed' });
      destroyRoom(room);
    } else if (!room.game) {
      // mid-level the lobby update waits for levelEnd (don't stomp the game view)
      broadcast(room, lobbyState(room));
    }
  });
});
