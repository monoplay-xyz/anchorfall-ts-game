import express from 'express';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createGame, step, snapshot, applyResults, charsById, dailyChallenge, TILE } from './shared/game.js';
// namespace import: wave-6 sim exports (revivePlayer) are probed with typeof
// so the server keeps working while they land
import * as sim from './shared/game.js';
import { initDb } from './db.js';
import { mountAuth } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const TICK = 1 / 30;

// --- public-deploy hardening ---------------------------------------------
// PUBLIC_DEPLOY=1 (Railway/Fly/VPS behind a TLS proxy): hide the LAN URL,
// kill the smoke hooks even if HOLDOUT_SMOKE leaks into the env, trust
// X-Forwarded-For for client IPs, and reap idle lobbies. Without the flag
// the server behaves exactly like the couch/LAN build.
const PUBLIC_DEPLOY = process.env.PUBLIC_DEPLOY === '1';
const SMOKE_HOOK = process.env.HOLDOUT_SMOKE === '1' && !PUBLIC_DEPLOY;
const ROOM_CAP = Math.max(1, Number(process.env.ROOM_CAP) || 200); // global concurrent rooms
const WS_CONN_CAP = 1024; // global concurrent sockets (per-room caps already bound per-IP at 8)
const WS_PER_IP = 8;      // concurrent sockets per client IP
const KEEPALIVE_MS = 30000; // ping interval; two missed pongs = dead TCP, terminate
const LOBBY_TTL_MS = Math.max(1000, Number(process.env.LOBBY_TTL_MS) || 10 * 60000); // public idle-lobby reap

// Trust-boundary name hygiene: drop control / zero-width / bidi-override
// characters, collapse runs of whitespace, keep the 12-char cap. Applied to
// every ws player name and to REST rankings names.
const cleanName = v => {
  const s = String(v ?? '')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 12).trim();
  return s || 'Player';
};

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
// Per-mode room caps (wave 7): pvp fields outgrow the co-op party of 8.
// Prefer the sim's table once it lands so server and sim can never disagree;
// seats-per-connection stays 4 everywhere. CTF team cap = MODE_CAPS.ctf / 2.
const MODE_CAPS = sim.MODE_CAPS || { classic: 8, story: 8, bastion: 8, ctf: 32, br: 16 };
const roomCap = room => MODE_CAPS[room.mode] || 8;
console.log(`Loaded ${levels.length} levels (${classicLevels.length} classic, ${storyLevels.length} story, ${bastionLevels.length} stronghold, ${ctfLevels.length} ctf, ${brLevels.length} br), ${characters.length} characters`);

// SAVES_DIR (default ./saves): every persisted file — campaign saves and
// rankings.json — writes under it, so a deploy can mount a volume (e.g. /data)
const savesDir = process.env.SAVES_DIR ? path.resolve(process.env.SAVES_DIR) : path.join(__dirname, 'saves');
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
// Endless Siege boards: one per stronghold map, under their own 'endless/'
// category so the key registry and the GET :cat/:stem route both accept them.
// They map back to the stronghold def for display names.
const endlessKeyOf = key => 'endless/' + String(key).split('/')[1];
for (const l of bastionLevels) { const ek = endlessKeyOf(l.key); levelKeys.add(ek); levelByKey.set(ek, l); }
const round1 = n => Math.round(n * 10) / 10;

function saveRankings() {
  const tmp = rankingsPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rankings));
  fs.renameSync(tmp, rankingsPath); // atomic: readers never see a torn file
}

// Insert an entry on its board; returns the 1-based rank or null if it missed
// the top 50.
function recordRanking(key, entry) {
  // Fixed catalog/endless boards live in levelKeys; daily boards are dynamic
  // (one per UTC date) and validated by shape instead.
  if (!levelKeys.has(key) && !DAILY_KEY_RE.test(key)) return null;
  const board = rankings[key] || (rankings[key] = []);
  board.push(entry);
  board.sort((a, b) => b.score - a.score || a.timeS - b.timeS);
  if (board.length > RANK_MAX) board.length = RANK_MAX;
  saveRankings();
  const i = board.indexOf(entry);
  return i === -1 ? null : i + 1;
}

// Big-team boards (wave 7, 16v16 ctf): an entry stores at most 8 real names;
// a larger party folds the overflow into one "+N more" tail string (so the
// names array tops out at 9 entries) while `players` keeps the true count.
// Existing <=8 co-op/ctf entries are untouched.
const capNames = names => names.length <= 8 ? names : [...names.slice(0, 8), `+${names.length - 8} more`];

// Online auto-submit: every server-room level CLEAR lands on its board.
// Co-op (classic/story/stronghold): full party names, final score, g.elapsed.
// CTF: the winning team's names; score = caps * 1000 (a capture is worth a
// thousand points of swarm-clearing); timeS = match length — faster
// conversions outrank slow grinds at equal caps.
// BR: the champion's name (players records the field size); score = the
// champion's kills; timeS = match length, so equal-kill champions rank by
// the quicker victory.
function recordOnlineRun(room, def, g) {
  if (!def?.key) return null;
  const stamp = { date: new Date().toISOString(), online: true };
  // Endless Siege ends in defeat, never a clear — rank by nights survived (then
  // in-run score) on a board namespaced off the map so it never mixes with the
  // campaign's clear-time board. score = nights*1e5 + score, so nights dominate.
  if (room.endless) {
    if (g.status !== 'failed') return null;
    const nights = g.cycle?.nightNo || 0;
    if (nights < 1) return null;
    const runScore = Math.round(g.score || 0);
    // daily rooms land on the shared daily/<date> board; free Endless on the map's own board
    const key = room.daily ? `daily/${room.dailyDate}` : endlessKeyOf(def.key);
    return { key, rank: recordRanking(key, { names: capNames(g.players.map(p => p.name)), players: g.players.length, score: nights * 100000 + Math.min(99999, runScore), nights, runScore, timeS: round1(g.elapsed), ...stamp }) };
  }
  if (g.status !== 'cleared') return null;
  if (room.mode === 'ctf') {
    if (g.winner !== 0 && g.winner !== 1) return null;
    const team = g.players.filter(p => p.team === g.winner);
    if (!team.length) return null;
    return { key: def.key, rank: recordRanking(def.key, { names: capNames(team.map(p => p.name)), players: team.length, score: (g.caps?.[g.winner] || 0) * 1000, timeS: round1(g.elapsed), ...stamp }) };
  }
  if (room.mode === 'br') {
    const champ = g.players.find(p => p.pid === g.winner);
    if (!champ) return null;
    return { key: def.key, rank: recordRanking(def.key, { names: [champ.name], players: g.players.length, score: champ.kills || 0, timeS: round1(g.elapsed), ...stamp }) };
  }
  return { key: def.key, rank: recordRanking(def.key, { names: capNames(g.players.map(p => p.name)), players: g.players.length, score: Math.round(g.score), timeS: round1(g.elapsed), ...stamp }) };
}

// Sliding-window rate limit (max hits per windowMs per IP). Each endpoint
// keeps its own log: rankings POST at 10/min, room browser GET at 30/10s
// (the browser polls every 5s — light enough for a few tabs, heavy enough
// to shrug off a hammering loop).
function rateLimited(log, ip, max, windowMs) {
  const now = Date.now();
  if (log.size > 500) { // shed stale IPs so the map can't grow unbounded
    for (const [k, v] of log) if (!v.some(t => now - t < windowMs)) log.delete(k);
  }
  const hits = (log.get(ip) || []).filter(t => now - t < windowMs);
  if (hits.length >= max) { log.set(ip, hits); return true; }
  hits.push(now);
  log.set(ip, hits);
  return false;
}
const rankPostLog = new Map();
const rankDayLog = new Map();
const roomsGetLog = new Map();
const joinFailLog = new Map(); // ws room-code misses (enumeration throttle)
// rankings POST: 10/min plus a 150/day budget per IP (a curl loop can junk
// boards a lot slower that way; real players submit a handful per session)
const rankRateLimited = ip => rateLimited(rankPostLog, ip, 10, 60000) || rateLimited(rankDayLog, ip, 150, 86400000);

// --- http ---
const app = express();
// Behind the deploy platform's HTTP proxy every socket shares the proxy's
// address — trust the first X-Forwarded-For hop so req.ip (and every per-IP
// rate limit above) keys on the real client.
if (PUBLIC_DEPLOY) app.set('trust proxy', 1);
app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.use(express.static(path.join(__dirname, 'public')));

// --- accounts + cloud profiles (optional; anonymous play is unaffected) ------
// Postgres when DATABASE_URL is set (Railway), else a local file store.
await initDb(savesDir);
const authLog = new Map();
mountAuth(app, {
  json: express.json({ limit: '20kb' }),
  rateLimited: (ip) => rateLimited(authLog, ip, 12, 60000), // 12 register/login tries per minute per IP
  cleanName,
  maxProfileBytes: 16 * 1024,
});

app.get('/api/levels', (req, res) => res.json(levels));
// Public room browser (wave 7): JOINABLE public rooms only — lobby-phase
// rooms below cap, plus LIVE ctf rooms below cap (ctf accepts mid-match
// joiners onto the smaller team, so they list with phase 'play'; the client
// tags those LIVE). Private rooms, full rooms, intro cutscenes, finished
// campaigns and mid-level co-op never appear. joinableNow is true on every
// listed entry by construction (the field rides along for the contract /
// future modes that might list-but-lock). No auth — community server.
app.get('/api/rooms', (req, res) => {
  if (rateLimited(roomsGetLog, req.ip || req.socket?.remoteAddress || '?', 30, 10000)) {
    return res.status(429).json({ error: 'rate limited' });
  }
  const out = [];
  for (const room of rooms.values()) {
    if (!room.public || room.players.size >= roomCap(room)) continue;
    const live = room.mode === 'ctf' && room.phase === 'play' && room.game && room.game.status === 'play';
    if (room.phase !== 'lobby' && !live) continue;
    const list = roomLevels(room);
    if (room.levelIdx >= list.length) continue; // campaign finished — nothing left to join
    const def = list[room.levelIdx];
    out.push({
      code: room.code, mode: room.mode,
      levelName: room.daily ? `Daily Challenge` : (def?.name || null), levelTitle: def?.title,
      endless: room.endless || undefined, daily: room.daily || undefined,
      players: room.players.size, cap: roomCap(room),
      phase: room.phase, joinableNow: true,
    });
  }
  res.json(out);
});
// rankings REST: list boards that have entries (levels order = category order),
// fetch one board, or submit a LOCAL run (sessions simmed in the browser but
// served from this server). Online room clears are recorded server-side and
// never POSTed.
const endlessName = def => `${def.stronghold?.name || def.title || def.name} — Endless`;
// Daily Challenge boards are dynamic (one per UTC date), so they aren't in the
// fixed key registry — they're validated by shape instead. A board is READABLE
// if well-formed; only today's (±1.5d for clock skew) is WRITEABLE, so a forger
// can't seed infinite future boards.
const DAILY_KEY_RE = /^daily\/\d{4}-\d{2}-\d{2}$/;
const dailyName = key => `Daily — ${key.slice(6)}`;
function isWriteableDaily(key) {
  if (!DAILY_KEY_RE.test(key)) return false;
  const d = new Date(key.slice(6) + 'T00:00:00Z').getTime();
  if (!Number.isFinite(d)) return false;
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
  return Math.abs(d - today) <= 86400000 * 1.5;
}
app.get('/api/rankings', (req, res) => {
  const out = levels.filter(l => rankings[l.key]?.length)
    .map(l => ({ key: l.key, name: l.title || l.name, count: rankings[l.key].length }));
  // Endless boards (their own category) list alongside the campaign boards.
  for (const l of bastionLevels) {
    const ek = endlessKeyOf(l.key);
    if (rankings[ek]?.length) out.push({ key: ek, name: endlessName(l), count: rankings[ek].length });
  }
  // Daily Challenge boards: whichever dates have recorded runs (newest first).
  Object.keys(rankings).filter(k => DAILY_KEY_RE.test(k) && rankings[k]?.length)
    .sort((a, b) => b.localeCompare(a))
    .forEach(k => out.push({ key: k, name: dailyName(k), count: rankings[k].length }));
  res.json({ levels: out });
});
app.get('/api/rankings/:cat/:stem', (req, res) => {
  const key = `${req.params.cat}/${req.params.stem}`;
  if (DAILY_KEY_RE.test(key)) return res.json({ key, name: dailyName(key), entries: rankings[key] || [] });
  if (!levelKeys.has(key)) return res.status(404).json({ error: 'unknown level' });
  const def = levelByKey.get(key);
  const name = req.params.cat === 'endless' ? endlessName(def) : (def.title || def.name);
  res.json({ key, name, entries: rankings[key] || [] });
});
app.post('/api/rankings', express.json({ limit: '4kb' }), (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || '?';
  if (rankRateLimited(ip)) return res.status(429).json({ error: 'rate limited' });
  const b = req.body || {};
  const key = String(b.key || '');
  if (!levelKeys.has(key) && !isWriteableDaily(key)) return res.status(400).json({ error: 'unknown level key' });
  if (!Array.isArray(b.names) || !b.names.length || b.names.length > 8) return res.status(400).json({ error: 'names must be 1-8 strings' });
  const names = b.names.map(cleanName); // same trust-boundary hygiene as ws names
  const players = Math.min(8, Math.max(1, Math.floor(Number(b.players)) || names.length));
  const score = Math.round(Number(b.score));
  const timeS = round1(Number(b.timeS));
  // 1e7 is far above any real run (a great clear is tens of thousands) and
  // far below the old 1e9 ceiling a forger would pin every board with
  if (!Number.isFinite(score) || score < 0 || score > 1e7) return res.status(400).json({ error: 'bad score' });
  if (!Number.isFinite(timeS) || timeS < 0 || timeS > 604800) return res.status(400).json({ error: 'bad timeS' });
  // an identical (names, score, timeS) row already on the board is a replayed
  // submission, not a new run — acknowledge without inserting
  const dup = (rankings[key] || []).some(e => e.score === score && e.timeS === timeS
    && Array.isArray(e.names) && e.names.join('\n') === names.join('\n'));
  if (dup) return res.json({ ok: true, rank: null });
  const rank = recordRanking(key, { names, players, score, timeS, date: new Date().toISOString(), online: false });
  res.json({ ok: true, rank });
});
const lanIp = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal)?.address;
const lanUrl = lanIp ? `http://${lanIp}:${PORT}` : null;
const server = app.listen(PORT, () => {
  console.log(`MONOLYTHIUM — THE ANCHORFALL running at http://localhost:${PORT}`);
  if (PUBLIC_DEPLOY) console.log(`PUBLIC deploy mode: LAN URL hidden, smoke hooks dead, proxy-forwarded IPs trusted, saves in ${savesDir}`);
  else if (lanUrl) console.log(`LAN: ${lanUrl}`);
});

// --- websocket rooms ---
// maxPayload: inputs are tiny — an oversized frame closes the offending
// socket (ws sends 1009) instead of buffering 100MB into JSON.parse.
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
const rooms = new Map();
let nextPid = 1;

// Client IP at the ws trust boundary: behind the public proxy the socket's
// remoteAddress is the proxy itself, so use the nearest-hop X-Forwarded-For
// entry — the one the platform edge appended; leftmost entries are
// client-spoofable. Mirrors `trust proxy = 1` on the express side.
function clientIp(req) {
  if (PUBLIC_DEPLOY) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) {
      const last = xff.split(',').pop().trim();
      if (last) return last;
    }
  }
  return req.socket?.remoteAddress || '?';
}
const wsPerIp = new Map(); // live socket count per client IP

// Keepalive sweep: ping every KEEPALIVE_MS; a socket that misses two pongs
// in a row is dead TCP (sleeping laptop, vanished phone) — terminate it so
// the close handler runs its room/hold bookkeeping instead of leaking the
// connection (and its room) forever.
const keepaliveTimer = setInterval(() => {
  for (const sock of wss.clients) {
    if ((sock.missedPongs ?? 0) >= 2) { sock.terminate(); continue; }
    sock.missedPongs = (sock.missedPongs ?? 0) + 1;
    try { sock.ping(); } catch { /* socket mid-close */ }
  }
}, KEEPALIVE_MS);
keepaliveTimer.unref?.();

// PUBLIC deploys reap idle lobbies: a lobby/intro room with no sim running
// that has seen no lobby activity for LOBBY_TTL_MS is closed and its members
// freed to host/join again — otherwise idle-but-alive connections (which
// dutifully answer keepalive pings) squat the global room budget and flood
// /api/rooms with dead lobbies. Couch/LAN keeps lobbies open forever.
if (PUBLIC_DEPLOY) {
  const reaper = setInterval(() => {
    const now = Date.now();
    for (const room of [...rooms.values()]) {
      if (room.game || (room.phase !== 'lobby' && room.phase !== 'intro')) continue;
      if (now - (room.lastActivity || now) <= LOBBY_TTL_MS) continue;
      broadcast(room, { t: 'error', error: 'Room closed — idle for too long' });
      for (const p of room.players.values()) p.room = null; // members can host/join again
      destroyRoom(room);
    }
  }, Math.min(30000, LOBBY_TTL_MS));
  reaper.unref?.();
}

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
  // daily online: resolve today's map + twist for the lobby label
  let dailyMap = null, dailyLabel = null;
  if (room.daily) {
    const spec = dailyChallenge(room.dailyDate, bastionLevels.length);
    const m = bastionLevels[spec.mapIdx];
    dailyMap = m?.stronghold?.name || m?.name || null;
    dailyLabel = spec.label;
  }
  return {
    t: 'lobby',
    room: room.code,
    mode: room.mode,
    endless: room.endless || undefined,
    daily: room.daily || undefined,
    dailyLabel: dailyLabel || undefined,
    levelIdx: room.levelIdx,
    levelName: room.daily ? `Daily — ${dailyMap} · ${dailyLabel}` : (def?.name || null),
    levelTitle: def?.title || undefined,
    totalLevels: list.length,
    roster: room.roster,
    lan: PUBLIC_DEPLOY ? undefined : (lanUrl || undefined),
    players: [...room.players.values()].map(p => ({ pid: p.pid, name: p.name, charId: p.charId, isHost: p.pid === room.hostPid, team: p.team })),
  };
}

// lobbyState()'s players array without the assignTeams() side effect — safe
// to ship inside mid-match playerJoined broadcasts (teams must not reshuffle)
function rosterOf(room) {
  return [...room.players.values()].map(p => ({ pid: p.pid, name: p.name, charId: p.charId, isHost: p.pid === room.hostPid, team: p.team }));
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
  if (typeof sim.revivePlayer === 'function') {
    if (sim.revivePlayer(g, pid) || g.mode !== 'ctf') return;
    // ctf falls through: the sim export refuses pvp, but a held ctf seat
    // SHOULD come back (a 16v16 hold that spectates forever is a dead seat).
    // Nudge it through the existing down->redeploy path — ctf redeploys the
    // same operative at the team stand. A seat that never confirmed a pick
    // (mid-match joiner who dropped while choosing) re-enters the pick
    // instead, pickPrev all-held so a carried button can't instantly confirm.
    const q = g.players.find(pl => pl.pid === pid);
    if (!q || q.state !== 'out') return;
    if (q.charId) { q.state = 'down'; q.respawn = 1; }
    else { q.state = 'pick'; q.pickIdx = 0; q.pickPrev = { left: true, right: true, fire: true }; }
    return;
  }
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

// --- ctf mid-match join ---------------------------------------------------
// Live BELOW-CAP ctf rooms accept brand-new joiners straight into the match:
// the joiner lands on the smaller team (tie -> team 0), enters the sim in the
// respawn-pick state at their team stand, gets a levelStart-style full
// snapshot (the rejoin pattern — score/caps/teamShards ride it), and everyone
// else gets an additive playerJoined toast. NEVER a lobby broadcast mid-match
// — a lobby message would stomp live game screens (and re-alternate teams).

// Smaller team counted on the sim's FIELDED seats (anything but 'out'), so
// expired-hold ghosts don't skew the balance. Ties go to team 0.
function smallerTeam(g) {
  const n = [0, 0];
  for (const p of g.players) if (p.state !== 'out' && (p.team === 0 || p.team === 1)) n[p.team]++;
  return n[1] < n[0] ? 1 : 0;
}
function teamHasRoom(room, team) {
  const cap = Math.floor(roomCap(room) / 2); // ctf team cap = MODE_CAPS.ctf / 2
  return room.game.players.filter(p => p.state !== 'out' && p.team === team).length < cap;
}

// CTF ghost purge: a dropped seat is only ever marked 'out' (never spliced),
// but the sim's addPlayerMidGame caps count EVERY seat — so ~32 join/drop
// cycles would permanently lock a live match against all new joiners while
// zero players are fielded. Before a mid-match insert, drop 'out' seats that
// have no live connection and no live hold; they can never come back, and
// the sim already auto-drops any flag held by a non-active carrier.
function purgeDeadCtfSeats(room) {
  const g = room.game;
  if (!g || g.mode !== 'ctf') return;
  const held = new Set();
  for (const h of room.holds) for (const s of h.seats) held.add(s.pid);
  for (let i = g.players.length - 1; i >= 0; i--) {
    const p = g.players[i];
    if (p.state === 'out' && !room.players.has(p.pid) && !held.has(p.pid)) g.players.splice(i, 1);
  }
}

// Insert a live seat into a running ctf sim. Prefers the sim's
// addPlayerMidGame export (this wave's sim work); until it lands, a shim
// mirrors the contract: the seat appears at its team flag stand in the
// respawn-pick state (pickPrev all-held so a button carried through the join
// can't instantly confirm), and the game's roster widens to the full
// character list so pvp picks draw on everything ("free chars in pvp = full
// roster" — safe because applyResults never lets a pvp game touch the lobby
// roster). The shim's literal mirrors the sim's spawnPlayer + survival +
// pvp fields so snapshots/step treat it like any lobby-born seat.
function insertMidGamePlayer(g, seat) {
  if (typeof sim.addPlayerMidGame === 'function') return sim.addPlayerMidGame(g, seat) !== false;
  if (g.status !== 'play' || g.mode !== 'ctf') return false;
  for (const id of Object.keys(charMap)) if (!g.roster.includes(id)) g.roster.push(id);
  const stand = (g.flags || []).find(f => f.team === seat.team);
  const x = stand ? stand.homeX : TILE * 2, y = stand ? stand.homeY : TILE * 2;
  g.players.push({
    pid: seat.pid, name: seat.name, charId: null, x, y, fx: 0, fy: -1, cool: 0,
    state: 'pick', pickIdx: 0, pickPrev: { left: true, right: true, fire: true },
    respawn: 0, invuln: 3, specialCool: 0, dashT: 0, dashFx: 0, dashFy: -1,
    stimT: 0, actPrev: false, specialPrev: false, itemPrev: false,
    hp: 3, maxHp: 3, shield: 0, item: null, xp: 0, level: 1,
    team: seat.team, kills: 0,
  });
  return true;
}

function endLevel(room) {
  clearInterval(room.timer);
  room.timer = null;
  // a room held open EMPTY for a rejoin window dies the moment its level
  // ends — there is no lobby to come back to with nobody in it
  if (!room.players.size) { room.holds = []; room.game = null; return destroyRoom(room); }
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
  room.lastActivity = Date.now(); // fresh idle window for the post-level lobby
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
  // own-property check: a prototype-key charId ('constructor', '__proto__'…)
  // would resolve truthy through charMap in the sim and crash the tick
  const party = [...room.players.values()].filter(p => p.charId && Object.hasOwn(charMap, p.charId)).map(p => ({ pid: p.pid, name: p.name, charId: p.charId, team: p.team }));
  if (!party.length) return;
  if (room.mode === 'br' && party.length < 2) return; // BR is meaningless solo
  for (const p of room.players.values()) p.input = {};
  // Endless Siege: a stronghold room flagged endless plays the same map with no
  // night cap. Clone the def (never mutate the shared catalog) and flip the flag.
  let baseDef = roomLevels(room)[room.levelIdx];
  // Daily online: the server resolves today's map + twist from its own date so
  // every host worldwide runs the same siege (matches the client's local daily).
  let dailyMods = null;
  if (room.daily) {
    const spec = dailyChallenge(room.dailyDate, bastionLevels.length);
    baseDef = bastionLevels[spec.mapIdx] || baseDef;
    dailyMods = spec.mods;
  }
  const gameDef = room.endless && baseDef.mode === 'bastion'
    ? { ...baseDef, bastion: { ...(baseDef.bastion || {}), endless: true, ...(dailyMods || {}) } }
    : baseDef;
  room.game = createGame(gameDef, party, charMap, room.roster);
  room.phase = 'play';
  room.tick = 0;
  room.holds = []; // seat holds are per-level; a fresh level starts clean
  // The static grid rides along once here; per-tick snapshots omit it.
  broadcast(room, { t: 'levelStart', s: snapshot(room.game, true) });
  room.timer = setInterval(() => {
    // EMPTY room held open for a rejoin window (solo online drop): freeze the
    // sim — nobody is watching, and stepping it would fail the level (every
    // seat is 'out') before the player can come back. Destroy at hold expiry.
    if (!room.players.size) {
      pruneHolds(room);
      if (!room.holds.length) destroyRoom(room);
      return;
    }
    const inputs = {};
    for (const p of room.players.values()) inputs[p.pid] = p.input;
    step(room.game, inputs, TICK);
    broadcastState(room);
    if (room.game.status !== 'play') endLevel(room);
  }, TICK * 1000);
}

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  // connection ceilings: per-IP and global. Refuse with a friendly error the
  // client can toast, then close — never accepted, never counted.
  if (wss.clients.size > WS_CONN_CAP || (wsPerIp.get(ip) || 0) >= WS_PER_IP) {
    try { ws.send(JSON.stringify({ t: 'error', error: 'Too many connections — try again shortly' })); } catch { /* mid-close */ }
    ws.close(1013, 'try again later');
    return;
  }
  wsPerIp.set(ip, (wsPerIp.get(ip) || 0) + 1);
  ws.missedPongs = 0;
  ws.on('pong', () => { ws.missedPongs = 0; });
  ws.on('close', () => {
    const n = (wsPerIp.get(ip) || 1) - 1;
    if (n > 0) wsPerIp.set(ip, n); else wsPerIp.delete(ip);
  });
  // without a listener an oversized frame (maxPayload) or protocol error
  // would throw from the emitter and kill the whole process
  ws.on('error', () => {});
  // rejoin secret: rides every 'joined' (additive key) so a client can prove
  // a mid-level seat hold is theirs; see the hold-match logic in 'join'
  const myToken = crypto.randomBytes(9).toString('base64url');

  // Inbound flood guards (token buckets). Over-budget messages are DROPPED —
  // never a disconnect, so a laggy client's burst can't kill its own seat.
  // Lobby mutators (select/addLocal/removeLocal) re-broadcast the whole lobby
  // to every member, so they get a stricter sub-bucket than raw inputs.
  const MSG_RATE = 120, MSG_BURST = 180, LOBBY_RATE = 20, LOBBY_BURST = 30;
  let msgTokens = MSG_BURST, msgStamp = Date.now();
  let lobTokens = LOBBY_BURST, lobStamp = Date.now();
  const takeMsg = () => {
    const now = Date.now();
    msgTokens = Math.min(MSG_BURST, msgTokens + (now - msgStamp) * MSG_RATE / 1000);
    msgStamp = now;
    if (msgTokens < 1) return false;
    msgTokens--;
    return true;
  };
  const takeLobby = () => {
    const now = Date.now();
    lobTokens = Math.min(LOBBY_BURST, lobTokens + (now - lobStamp) * LOBBY_RATE / 1000);
    lobStamp = now;
    if (lobTokens < 1) return false;
    lobTokens--;
    return true;
  };

  // `me` is the connection's PRIMARY player; addLocal grows extra seats on the same ws.
  const me = { pid: nextPid++, ws, name: 'Player', charId: null, input: {}, primary: true, room: null };
  const ownedBy = room => [...room.players.values()].filter(p => p.ws === ws);

  ws.on('message', raw => {
    if (!takeMsg()) return; // over the flood budget: drop, don't kill
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return; // `null`/numbers/arrays parse fine but aren't messages
    const room = me.room;

    if (m.t === 'host') {
      // a connection already seated must not mint another room: the old room
      // would keep this `me` in its players map forever (never empty, never
      // reaped) — the classic orphaned-room leak. Mirrors the `join` guard.
      if (me.room) return sendTo(me, { t: 'error', error: 'Already in a room' });
      if (rooms.size >= ROOM_CAP) return sendTo(me, { t: 'error', error: 'Server is at its room limit — try again in a few minutes' });
      me.name = cleanName(m.name);
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
      // stronghold + ctf: the host's level-select pick rides the host message
      // (narrow levelIdx passthrough, clamped to the mode's own list; unlock
      // gating is client-side by design — the host menu only offers unlocked
      // levels, and ctf simply has two maps to choose from)
      const pickList = mode === 'bastion' ? bastionLevels : mode === 'ctf' ? ctfLevels : null;
      if (pickList && pickList.length && m.levelIdx != null) {
        const li = Math.floor(Number(m.levelIdx));
        if (Number.isFinite(li)) levelIdx = Math.max(0, Math.min(pickList.length - 1, li));
      }
      // stronghold: the host's EARNED roster rides the host message too —
      // validate to known ids, dedupe, and always include every starter
      // (starters first, then the validated extras in client order). An
      // invalid/absent roster falls back to the starters-only default above.
      if (mode === 'bastion' && Array.isArray(m.roster)) {
        // OWN-property check, not truthiness: charMap is a plain object, so
        // charMap['__proto__'] / ['constructor'] / ['toString'] are truthy
        // prototype members — a charId like that reaches the sim, dodges its
        // `if (!ch)` guard, and crashes the 30Hz tick for the whole process.
        const extras = [...new Set(m.roster.map(String))]
          .filter(id => Object.hasOwn(charMap, id) && !startingRoster.includes(id));
        roster = [...startingRoster, ...extras].slice(0, characters.length);
      }
      // room visibility (wave 7): the client sends public:true|false from its
      // Visibility toggle; absent (old clients) defaults versus modes public
      // and co-op private — co-op behavior is exactly the pre-browser world.
      const pub = m.public != null ? !!m.public : (mode === 'ctf' || mode === 'br');
      // Endless Siege: only meaningful for stronghold (bastion) rooms; ignored otherwise.
      // Daily Challenge online: a bastion room flagged daily. The SERVER picks the
      // map+twist from its own UTC date (never trusts the client), and it plays as
      // an endless siege onto the shared daily/<date> board.
      const daily = mode === 'bastion' && !!m.daily;
      const endless = mode === 'bastion' && (!!m.endless || daily);
      const dailyDate = daily ? new Date().toISOString().slice(0, 10) : null;
      const r = { code, mode, public: pub, endless, daily, dailyDate, hostPid: me.pid, players: new Map([[me.pid, me]]), levelIdx, roster, game: null, timer: null, phase: 'lobby', holds: [], tick: 0, lastActivity: Date.now() };
      rooms.set(code, r);
      me.room = r;
      sendTo(me, { t: 'joined', you: me.pid, token: myToken });
      broadcast(r, lobbyState(r));
    }
    else if (m.t === 'join') {
      if (me.room) return;
      const r = rooms.get(String(m.room || '').toUpperCase().trim());
      if (!r) {
        // room-code enumeration throttle: codes are only 4 letters, so too
        // many misses park this IP's join oracle for a minute
        if (rateLimited(joinFailLog, ip, 20, 60000)) return sendTo(me, { t: 'error', error: 'Too many join attempts — wait a minute' });
        return sendTo(me, { t: 'error', error: 'Room not found' });
      }
      me.name = cleanName(m.name);
      if (r.game || r.phase !== 'lobby') {
        // mid-level rejoin: a live held reservation matching the joining name
        // (case-insensitive) re-binds its seats to this connection. Names are
        // broadcast in every lobby, so on PUBLIC deploys a name alone is not
        // proof — the joiner must also present the hold's rejoin token (from
        // their original 'joined') or arrive from the same client IP.
        pruneHolds(r);
        const tok = typeof m.token === 'string' ? m.token : '';
        const hi = r.game ? r.holds.findIndex(h => h.name.toLowerCase() === me.name.toLowerCase()
          && (!PUBLIC_DEPLOY || (tok && h.token === tok) || h.ip === ip)) : -1;
        if (hi === -1) {
          // ctf mid-match join (wave 7): no hold to retake, but a live
          // below-cap ctf room takes the newcomer onto the smaller team
          if (r.mode === 'ctf' && r.phase === 'play' && r.game && r.game.status === 'play'
              && r.players.size < roomCap(r)) {
            purgeDeadCtfSeats(r); // expired drop-outs must not count against the sim caps
            const team = smallerTeam(r.game);
            if (teamHasRoom(r, team) && insertMidGamePlayer(r.game, { pid: me.pid, name: me.name, team })) {
              me.team = team;
              me.room = r;
              r.players.set(me.pid, me);
              sendTo(me, { t: 'joined', you: me.pid, midmatch: true, team, token: myToken });
              // levelStart-style full snapshot (the rejoin pattern) — pending
              // events held aside so the room's tick doesn't lose them
              const pending = r.game.events.splice(0);
              // mode/levelIdx ride along so the joiner's synthesized lobby
              // state names the right map in the mission panel
              sendTo(me, { t: 'levelStart', s: snapshot(r.game, true), mode: r.mode, levelIdx: r.levelIdx });
              r.game.events.push(...pending);
              broadcast(r, { t: 'playerJoined', pid: me.pid, name: me.name, team, players: r.players.size, cap: roomCap(r), roster: rosterOf(r) });
              return;
            }
          }
          return sendTo(me, { t: 'error', error: 'Game in progress, wait for the level to end' });
        }
        const hold = r.holds.splice(hi, 1)[0];
        const prim = hold.seats.find(s => s.primary) || hold.seats[0];
        me.pid = prim.pid; me.name = prim.name; me.charId = prim.charId; me.input = {};
        me.room = r;
        r.players.set(me.pid, me);
        for (const seat of hold.seats) {
          if (seat !== prim) r.players.set(seat.pid, { pid: seat.pid, ws, name: seat.name, charId: seat.charId, input: {}, primary: false });
          reviveSeat(r.game, seat.pid); // held-out seats re-enter via the respawn-pick flow
        }
        sendTo(me, { t: 'joined', you: me.pid, rejoined: true, seats: hold.seats.map(s => s.pid), token: myToken });
        // levelStart-style full snapshot (grid included) — held aside so the
        // tick's pending events aren't drained away from the room
        const pending = r.game.events.splice(0);
        sendTo(me, { t: 'levelStart', s: snapshot(r.game, true), mode: r.mode, levelIdx: r.levelIdx });
        r.game.events.push(...pending);
        return;
      }
      if (r.players.size >= roomCap(r)) return sendTo(me, { t: 'error', error: 'Room is full' });
      r.players.set(me.pid, me);
      me.room = r;
      r.lastActivity = Date.now();
      sendTo(me, { t: 'joined', you: me.pid, token: myToken });
      broadcast(r, lobbyState(r));
    }
    else if (m.t === 'addLocal' && room) {
      if (!takeLobby()) return;
      if (room.players.size >= roomCap(room) || ownedBy(room).length >= 4) return;
      room.lastActivity = Date.now();
      if (room.phase === 'lobby' && !room.game) {
        const p = { pid: nextPid++, ws, name: cleanName(m.name), charId: null, input: {}, primary: false };
        room.players.set(p.pid, p);
        sendTo(p, { t: 'localAdded', tag: m.tag, pid: p.pid });
        broadcast(room, lobbyState(room));
      } else if (room.mode === 'ctf' && room.phase === 'play' && room.game && room.game.status === 'play') {
        // wave 7: splitscreen seats can drop into a live ctf match too —
        // same smaller-team insertion as a mid-match join (the ws already
        // has the game view, so no snapshot replay is needed)
        pruneHolds(room);
        purgeDeadCtfSeats(room); // expired drop-outs must not count against the sim caps
        const team = smallerTeam(room.game);
        if (!teamHasRoom(room, team)) return;
        const p = { pid: nextPid++, ws, name: cleanName(m.name), charId: null, input: {}, primary: false, team };
        if (!insertMidGamePlayer(room.game, { pid: p.pid, name: p.name, team })) return;
        room.players.set(p.pid, p);
        sendTo(p, { t: 'localAdded', tag: m.tag, pid: p.pid, midmatch: true, team });
        broadcast(room, { t: 'playerJoined', pid: p.pid, name: p.name, team, players: room.players.size, cap: roomCap(room), roster: rosterOf(room) });
      }
    }
    else if (m.t === 'removeLocal' && room && room.phase === 'lobby' && !room.game) {
      if (!takeLobby()) return;
      const p = room.players.get(Number(m.pid));
      if (!p || p.ws !== ws || p.primary) return;
      room.players.delete(p.pid);
      room.lastActivity = Date.now();
      broadcast(room, lobbyState(room));
    }
    else if (m.t === 'select' && room && room.phase === 'lobby' && !room.game) {
      if (!takeLobby()) return;
      const target = m.pid == null ? me : room.players.get(Number(m.pid));
      if (!target || target.ws !== ws) return;
      room.lastActivity = Date.now();
      const id = String(m.charId || '');
      if (!id || target.charId === id) target.charId = null; // re-pick / empty = unlock
      else {
        // versus drops uniqueness entirely (wave 7): ctf identity is name +
        // team color, so same-team duplicates are fine at 16v16; br was
        // already all-teams-of-one. Co-op keeps one-operative-per-seat.
        const taken = !isPvp(room) && [...room.players.values()].some(p => p !== target && p.charId === id);
        // Object.hasOwn: belt-and-suspenders against prototype-key charIds
        // reaching the sim even if a hostile id ever lands in room.roster
        if (room.roster.includes(id) && Object.hasOwn(charMap, id) && !taken) target.charId = id;
      }
      broadcast(room, lobbyState(room));
    }
    else if (m.t === 'start' && room && me.pid === room.hostPid && room.phase === 'lobby' && !room.game) {
      room.lastActivity = Date.now();
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
      room.lastActivity = Date.now();
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
    // smoke-harness only (HOLDOUT_SMOKE=1, host-sent): force-clear the running
    // level so raw-ws tests can exercise the endLevel/rankings path without
    // playing a full mission (an optional winner injection lets ctf smoke walk
    // the 16-name capNames board entry). Inert in normal operation, and DEAD
    // on PUBLIC deploys even if HOLDOUT_SMOKE leaks into the env (SMOKE_HOOK
    // folds both checks at boot).
    else if (m.t === 'debugClear' && SMOKE_HOOK && room?.game && me.pid === room.hostPid) {
      if (m.winner === 0 || m.winner === 1) room.game.winner = m.winner;
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
    // mid-level: hold the dropped seats for 120s so the player can rejoin by
    // name (BEFORE the empty check — a solo player's hold must outlive them)
    if (room.game && seats.length) {
      pruneHolds(room);
      const prim = seats.find(p => p.primary) || seats[0];
      room.holds.push({ name: prim.name, token: myToken, ip, until: Date.now() + HOLD_MS, seats: seats.map(p => ({ pid: p.pid, name: p.name, charId: p.charId, primary: p === prim })) });
    }
    // rooms die only when EMPTY — a departing leader hands off instead. One
    // exception keeps online singleplayer rejoinable: an empty room whose
    // LIVE game just banked seat holds stays up for the hold window (the
    // game loop freezes and prunes; expiry or endLevel destroys it).
    if (!room.players.size) {
      if (room.game && room.holds.length) return;
      return destroyRoom(room);
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
