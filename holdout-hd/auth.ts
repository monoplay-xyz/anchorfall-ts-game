// @ts-nocheck — TS migration (issue #4): runtime-migrated to .ts, types pending.
// Account auth: register / login / logout / me, plus cloud profile sync.
//
// Security:
// - Passwords hashed with scrypt (Node built-in, memory-hard) + a per-user
//   random 16-byte salt; verified in constant time. No plaintext, ever.
// - Sessions are stateless signed tokens: base64url(payload).HMAC-SHA256, keyed
//   by SESSION_SECRET, carried in an HttpOnly, SameSite=Lax (Secure in prod)
//   cookie. Tampering fails the HMAC check; tokens expire.
// - All inputs validated; register/login are rate limited; user-enumeration
//   timing is blunted by always hashing on login.
// - DB access is parameterized (see db.js).
import crypto from 'crypto';
import { db } from './db.js';

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('AUTH: SESSION_SECRET not set — using an ephemeral secret (all sessions drop on restart). Set SESSION_SECRET in production.');
}
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000; // 30 days
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const SCRYPT_LEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_LEN).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, hash, salt) {
  let stored;
  try { stored = Buffer.from(String(hash), 'hex'); } catch { return false; }
  const got = crypto.scryptSync(password, String(salt), SCRYPT_LEN);
  return stored.length === got.length && crypto.timingSafeEqual(got, stored);
}

function signToken(uid, name) {
  const payload = Buffer.from(JSON.stringify({ uid, name, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot), sig = token.slice(dot + 1);
  const expect = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { uid, name, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!uid || !exp || Date.now() > exp) return null;
    return { uid, name };
  } catch { return null; }
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      // a malformed value (e.g. "sid=hello%") makes decodeURIComponent throw —
      // never let a crafted Cookie header bubble an exception up a route
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
      catch { /* skip malformed cookie */ }
    }
  }
  return out;
}
function setSession(res, token) {
  const secure = process.env.NODE_ENV === 'production' || process.env.PUBLIC_DEPLOY === '1';
  res.setHeader('Set-Cookie',
    `sid=${token}; HttpOnly; Path=/; Max-Age=${Math.floor(TOKEN_TTL_MS / 1000)}; SameSite=Lax${secure ? '; Secure' : ''}`);
}
function clearSession(res) {
  const secure = process.env.NODE_ENV === 'production' || process.env.PUBLIC_DEPLOY === '1';
  res.setHeader('Set-Cookie', `sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure ? '; Secure' : ''}`);
}

// The authenticated identity for a request, or null. { uid, name }
export function currentUser(req) { return verifyToken(parseCookies(req).sid); }

// Mount the auth + profile routes. opts: { json, rateLimited(ip), cleanName, maxProfileBytes }
export function mountAuth(app, opts = {}) {
  const json = opts.json; // an express.json({limit}) middleware
  const limited = opts.rateLimited || (() => false);
  const MAXP = opts.maxProfileBytes || 16 * 1024;

  app.post('/api/auth/register', json, async (req, res) => {
    const ip = req.ip || req.socket?.remoteAddress || '?';
    if (limited(ip)) return res.status(429).json({ error: 'too many attempts — wait a minute' });
    const name = String(req.body?.name ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!NAME_RE.test(name)) return res.status(400).json({ error: 'name must be 3–16 letters, numbers or _' });
    if (password.length < 8 || password.length > 200) return res.status(400).json({ error: 'password must be 8–200 characters' });
    try {
      if (await db.getUserByName(name)) return res.status(409).json({ error: 'that name is taken' });
      const { salt, hash } = hashPassword(password);
      const u = await db.createUser({ name, passHash: hash, salt });
      setSession(res, signToken(u.id, u.name));
      res.json({ ok: true, user: { id: u.id, name: u.name } });
    } catch (e) {
      if (/duplicate/i.test(e.message)) return res.status(409).json({ error: 'that name is taken' });
      console.error('register error:', e.message);
      res.status(500).json({ error: 'server error' });
    }
  });

  app.post('/api/auth/login', json, async (req, res) => {
    const ip = req.ip || req.socket?.remoteAddress || '?';
    if (limited(ip)) return res.status(429).json({ error: 'too many attempts — wait a minute' });
    const name = String(req.body?.name ?? '').trim();
    const password = String(req.body?.password ?? '');
    try {
      const u = await db.getUserByName(name);
      if (!u) { hashPassword(password); return res.status(401).json({ error: 'wrong name or password' }); } // blunt enumeration timing
      if (!verifyPassword(password, u.pass_hash, u.salt)) return res.status(401).json({ error: 'wrong name or password' });
      setSession(res, signToken(u.id, u.name));
      res.json({ ok: true, user: { id: u.id, name: u.name } });
    } catch (e) {
      console.error('login error:', e.message);
      res.status(500).json({ error: 'server error' });
    }
  });

  app.post('/api/auth/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

  app.get('/api/auth/me', (req, res) => {
    const me = currentUser(req);
    res.json({ user: me ? { id: me.uid, name: me.name } : null });
  });

  // Cloud profile (milestone stats + unlocks). Only the owner can read/write.
  app.get('/api/profile', async (req, res) => {
    const me = currentUser(req);
    if (!me) return res.status(401).json({ error: 'not signed in' });
    try { res.json({ profile: (await db.getProfile(me.uid)) || null }); }
    catch (e) { console.error('getProfile error:', e.message); res.status(500).json({ error: 'server error' }); }
  });
  app.put('/api/profile', json, async (req, res) => {
    const me = currentUser(req);
    if (!me) return res.status(401).json({ error: 'not signed in' });
    const data = req.body?.profile;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return res.status(400).json({ error: 'bad profile' });
    if (Buffer.byteLength(JSON.stringify(data)) > MAXP) return res.status(413).json({ error: 'profile too large' });
    try { await db.saveProfile(me.uid, data); res.json({ ok: true }); }
    catch (e) { console.error('saveProfile error:', e.message); res.status(500).json({ error: 'server error' }); }
  });
}
