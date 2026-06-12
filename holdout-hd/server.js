import express from 'express';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createGame, step, snapshot, applyResults, charsById, TILE } from './shared/game.js';
// namespace import: wave-6 sim exports (revivePlayer) are probed with typeof
// so the server keeps working while they land
import * as sim from './shared/game.js';

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
      def.key = `${cat}/${f.replace(/\.json$/, '')}`; // rankings board key
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

// --- rankings ----------------------------------------------------------------
// Boards keyed by level key ("<category>/<filename-stem>", e.g. story/ch01),
// each holding up to 50 entries { names, players, score, timeS, date, online }
// sorted by score desc, ties to the faster run. Persisted to
// saves/rankings.json with atomic tmp+rename writes.
const RANK_MAX = 50;
const rankingsPath = path.join(savesDir, 'rankings.json');
let rankings = {};
try { rankings = JSON.parse(fs.readFileSync(rankingsPath, 'utf8')) || {}; } catch { rankings = {}; }
const levelKeys = new Set(levels.map(l => l.key));
const levelByKey = new Map(levels.map(l => [l.key, l]));
const round1 = n => Math.round(n * 10) / 10;

function saveRankings() {
  const tmp = rankingsPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rankings));
  fs.renameSync(tmp, rankingsPath); // atomic: readers never see a torn file
}

// Insert an entry on its board; returns the 1-based rank or null if it missed
// the top 50.
function recordRanking(key, entry) {
  if (!levelKeys.has(key)) return null;
  const board = rankings[key] || (rankings[key] = []);
  board.push(entry);
  board.sort((a, b) => b.score - a.score || a.timeS - b.timeS);
  if (board.length > RANK_MAX) board.length = RANK_MAX;
  saveRankings();
  const i = board.indexOf(entry);
  return i === -1 ? null : i + 1;
}

// Online auto-submit: every server-room level CLEAR lands on its board.
// Co-op (classic/story/stronghold): full party names, final score, g.elapsed.
// CTF: the winning team's names; score = caps * 1000 (a capture is worth a
// thousand points of swarm-clearing); timeS = match length — faster
// conversions outrank slow grinds at equal caps.
// BR: the champion's name (players records the field size); score = the
// champion's kills; timeS = match length, so equal-kill champions rank by
// the quicker victory.
function recordOnlineRun(room, def, g) {
  if (!def?.key || g.status !== 'cleared') return null;
  const stamp = { date: new Date().toISOString(), online: true };
  if (room.mode === 'ctf') {
    if (g.winner !== 0 && g.winner !== 1) return null;
    const team = g.players.filter(p => p.team === g.winner);
    if (!team.length) return null;
    return { key: def.key, rank: recordRanking(def.key, { names: team.map(p => p.name), players: team.length, score: (g.caps?.[g.winner] || 0) * 1000, timeS: round1(g.elapsed), ...stamp }) };
  }
  if (room.mode === 'br') {
    const champ = g.players.find(p => p.pid === g.winner);
    if (!champ) return null;
    return { key: def.key, rank: recordRanking(def.key, { names: [champ.name], players: g.players.length, score: champ.kills || 0, timeS: round1(g.elapsed), ...stamp }) };
  }
  return { key: def.key, rank: recordRanking(def.key, { names: g.players.map(p => p.name), players: g.players.length, score: Math.round(g.score), timeS: round1(g.elapsed), ...stamp }) };
}

// POST rate limit: 10/min per IP, sliding window.
const rankPostLog = new Map();
function rankRateLimited(ip) {
  const now = Date.now();
  if (rankPostLog.size > 500) { // shed stale IPs so the map can't grow unbounded
    for (const [k, v] of rankPostLog) if (!v.some(t => now - t < 60000)) rankPostLog.delete(k);
  }
  const log = (rankPostLog.get(ip) || []).filter(t => now - t < 60000);
  if (log.length >= 10) { rankPostLog.set(ip, log); return true; }
  log.push(now);
  rankPostLog.set(ip, log);
  return false;
}

// --- http ---
const app = express();
app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/levels', (req, res) => res.json(levels));
// rankings REST: list boards that have entries (levels order = category order),
// fetch one board, or submit a LOCAL run (sessions simmed in the browser but
// served from this server). Online room clears are recorded server-side and
// never POSTed.
app.get('/api/rankings', (req, res) => res.json({
  levels: levels.filter(l => rankings[l.key]?.length)
    .map(l => ({ key: l.key, name: l.title || l.name, count: rankings[l.key].length })),
}));
app.get('/api/rankings/:cat/:stem', (req, res) => {
  const key = `${req.params.cat}/${req.params.stem}`;
  if (!levelKeys.has(key)) return res.status(404).json({ error: 'unknown level' });
  const def = levelByKey.get(key);
  res.json({ key, name: def.title || def.name, entries: rankings[key] || [] });
});
app.post('/api/rankings', express.json({ limit: '4kb' }), (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || '?';
  if (rankRateLimited(ip)) return res.status(429).json({ error: 'rate limited' });
  const b = req.body || {};
  const key = String(b.key || '');
  if (!levelKeys.has(key)) return res.status(400).json({ error: 'unknown level key' });
  if (!Array.isArray(b.names) || !b.names.length || b.names.length > 8) return res.status(400).json({ error: 'names must be 1-8 strings' });
  const names = b.names.map(n => String(n).slice(0, 12).trim() || 'Player');
  const players = Math.min(8, Math.max(1, Math.floor(Number(b.players)) || names.length));
  const score = Math.round(Number(b.score));
  const timeS = round1(Number(b.timeS));
  if (!Number.isFinite(score) || score < 0 || score > 1e9) return res.status(400).json({ error: 'bad score' });
  if (!Number.isFinite(timeS) || timeS < 0 || timeS > 604800) return res.status(400).json({ error: 'bad timeS' });
  const rank = recordRanking(key, { names, players, score, timeS, date: new Date().toISOString(), online: false });
  res.json({ ok: true, rank });
});
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

// --- interest management ------------------------------------------------------
// Per-connection lite snapshots: the bulk swarms (enemies/shots/drops/patches/
// crackers) trim to a 26-tile box around any of the connection's seats;
// everything small and gameplay-critical (players, flags, builds, cores,
// towers, vehicles, npcs, chests, teleports, doors, switches, glyphs, pillars,
// forges, qitems, ship...) always ships whole. Full snapshots (levelStart)
// are untouched. A connection with no seats on the field sees everything.
const AOI_TILES = 26;
const AOI_PX = AOI_TILES * TILE;
const BACKPRESSURE_MAX = 256 * 1024; // skip state ticks while a socket is this far behind

function aoiView(base, pids) {
  const anchors = base.players.filter(p => pids.includes(p.pid));
  if (!anchors.length) return base;
  const near = (x, y) => {
    for (const a of anchors) if (Math.abs(x - a.x) <= AOI_PX && Math.abs(y - a.y) <= AOI_PX) return true;
    return false;
  };
  const s = {
    ...base,
    enemies: base.enemies.filter(e => near(e.x, e.y)),
    shots: base.shots.filter(sh => near(sh.x, sh.y)),
    drops: base.drops.filter(d => near(d.x, d.y)),
  };
  if (base.patches) s.patches = base.patches.filter(pa => near(pa.x, pa.y));
  if (base.crackers) s.crackers = base.crackers.filter(c => near(c.x, c.y));
  return s;
}

// One sim snapshot per tick (events drain once), serialized per connection
// through the AOI filter. Every 3rd tick carries `mini` — tile-rounded [x,y]
// pairs for ALL enemies — so the minimap keeps working beyond the AOI.
// Backpressure: a connection whose socket buffer is over the threshold skips
// this state tick and catches up on the next under-threshold one; levelStart/
// levelEnd/lobby/cutscene are never skipped (they go through broadcast/sendTo).
function broadcastState(room) {
  const base = snapshot(room.game, false);
  room.tick++;
  if (room.tick % 3 === 0) base.mini = base.enemies.map(e => [Math.round(e.x / TILE), Math.round(e.y / TILE)]);
  const byWs = new Map();
  for (const p of room.players.values()) {
    const arr = byWs.get(p.ws);
    if (arr) arr.push(p.pid); else byWs.set(p.ws, [p.pid]);
  }
  for (const [ws, pids] of byWs) {
    if (ws.readyState !== 1) continue;
    if (ws.bufferedAmount > BACKPRESSURE_MAX) continue;
    ws.send(JSON.stringify({ t: 'state', s: aoiView(base, pids) }));
  }
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

// --- seat holds + mid-level rejoin --------------------------------------------
// A connection that drops mid-level leaves a 120s reservation (its primary's
// name + all its seats). Joining the room code with that name (case-
// insensitive) while the level is still running re-binds the seats; expired
// holds free them; lobby-phase rejoins are just normal joins.
const HOLD_MS = 120000;
function pruneHolds(room) {
  const now = Date.now();
  if (room.holds.length) room.holds = room.holds.filter(h => h.until > now);
}

// Re-enter a held-out seat via the sim's respawn-pick flow. revivePlayer ships
// with this wave's sim work — until it lands, fall back to nudging the seat
// through the existing down->pick path (mirroring downPlayer's bookkeeping:
// a held operative returns to the field as a rescuable captive; CTF redeploys
// the same operative at the stand; BR stays out — eliminated is eliminated).
function reviveSeat(g, pid) {
  if (typeof sim.revivePlayer === 'function') return sim.revivePlayer(g, pid);
  if (g.mode === 'br') return;
  const p = g.players.find(pl => pl.pid === pid);
  if (!p || p.state !== 'out') return;
  if (g.mode !== 'ctf' && p.charId) {
    g.captives.push({ id: 'c' + g.nextCaptiveId++, charId: p.charId, x: p.x, y: p.y, owner: null, fromPlayer: true });
    p.charId = null;
  }
  p.state = 'down';
  p.respawn = 1;
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
  room.holds = []; // back in the lobby, rejoins are just normal joins
  const msg = { t: 'levelEnd', status: g.status, gained: res.gained, lost: res.lost, roster: room.roster, victory };
  // online rankings auto-submit: clears land on the level's board; the rank
  // rides levelEnd (additive keys) so clients can toast the placement
  const rec = recordOnlineRun(room, def, g);
  if (rec?.rank) { msg.rank = rec.rank; msg.rankKey = rec.key; }
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
  room.tick = 0;
  room.holds = []; // seat holds are per-level; a fresh level starts clean
  // The static grid rides along once here; per-tick snapshots omit it.
  broadcast(room, { t: 'levelStart', s: snapshot(room.game, true) });
  room.timer = setInterval(() => {
    const inputs = {};
    for (const p of room.players.values()) inputs[p.pid] = p.input;
    step(room.game, inputs, TICK);
    broadcastState(room);
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
      const r = { code, mode, hostPid: me.pid, players: new Map([[me.pid, me]]), levelIdx, roster, game: null, timer: null, phase: 'lobby', holds: [], tick: 0 };
      rooms.set(code, r);
      me.room = r;
      sendTo(me, { t: 'joined', you: me.pid });
      broadcast(r, lobbyState(r));
    }
    else if (m.t === 'join') {
      if (me.room) return;
      const r = rooms.get(String(m.room || '').toUpperCase().trim());
      if (!r) return sendTo(me, { t: 'error', error: 'Room not found' });
      me.name = String(m.name || 'Player').slice(0, 12);
      if (r.game || r.phase !== 'lobby') {
        // mid-level rejoin: a live held reservation matching the joining name
        // (case-insensitive) re-binds its seats to this connection
        pruneHolds(r);
        const hi = r.game ? r.holds.findIndex(h => h.name.toLowerCase() === me.name.toLowerCase()) : -1;
        if (hi === -1) return sendTo(me, { t: 'error', error: 'Game in progress, wait for the level to end' });
        const hold = r.holds.splice(hi, 1)[0];
        const prim = hold.seats.find(s => s.primary) || hold.seats[0];
        me.pid = prim.pid; me.name = prim.name; me.charId = prim.charId; me.input = {};
        me.room = r;
        r.players.set(me.pid, me);
        for (const seat of hold.seats) {
          if (seat !== prim) r.players.set(seat.pid, { pid: seat.pid, ws, name: seat.name, charId: seat.charId, input: {}, primary: false });
          reviveSeat(r.game, seat.pid); // held-out seats re-enter via the respawn-pick flow
        }
        sendTo(me, { t: 'joined', you: me.pid, rejoined: true, seats: hold.seats.map(s => s.pid) });
        // levelStart-style full snapshot (grid included) — held aside so the
        // tick's pending events aren't drained away from the room
        const pending = r.game.events.splice(0);
        sendTo(me, { t: 'levelStart', s: snapshot(r.game, true) });
        r.game.events.push(...pending);
        return;
      }
      if (r.players.size >= 8) return sendTo(me, { t: 'error', error: 'Room is full' });
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
    // smoke-harness only (HOLDOUT_SMOKE=1): force-clear the running level so
    // raw-ws tests can exercise the endLevel/rankings path without playing
    // a full mission. Inert in normal operation.
    else if (m.t === 'debugClear' && process.env.HOLDOUT_SMOKE === '1' && room?.game) {
      room.game.status = 'cleared';
    }
  });

  ws.on('close', () => {
    const room = me.room;
    if (!room) return;
    const seats = ownedBy(room);
    for (const p of seats) {
      if (room.game) {
        const gp = room.game.players.find(g => g.pid === p.pid);
        if (gp && (gp.state === 'active' || gp.state === 'down' || gp.state === 'pick')) gp.state = 'out';
      }
      room.players.delete(p.pid);
    }
    // rooms die only when EMPTY — a departing leader hands off instead
    if (!room.players.size) return destroyRoom(room);
    // mid-level: hold the dropped seats for 120s so the player can rejoin by name
    if (room.game && seats.length) {
      pruneHolds(room);
      const prim = seats.find(p => p.primary) || seats[0];
      room.holds.push({ name: prim.name, until: Date.now() + HOLD_MS, seats: seats.map(p => ({ pid: p.pid, name: p.name, charId: p.charId, primary: p === prim })) });
    }
    // leader migration: the oldest remaining connection's primary takes over
    if (me.pid === room.hostPid) {
      const heir = [...room.players.values()].filter(p => p.primary).sort((a, b) => a.pid - b.pid)[0]
        || [...room.players.values()][0];
      room.hostPid = heir.pid;
      broadcast(room, { t: 'hostMigrated', hostPid: heir.pid, name: heir.name });
    }
    // mid-level the lobby update waits for levelEnd (don't stomp the game view)
    if (!room.game) broadcast(room, lobbyState(room));
  });
});
