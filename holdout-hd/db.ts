// Database layer for accounts + cloud profiles.
//
// Uses PostgreSQL when DATABASE_URL is set (Railway/Fly/Render provide it),
// otherwise a local JSON-file store so development works with no database at
// all. Both backends implement the same small async interface, so the rest of
// the server never knows which is live. All queries are parameterized.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// --- DB record shapes (auth/profile storage; not part of the sim contracts) ---
interface UserRow { id: number; name: string; pass_hash: string; salt: string; name_lc: string; }
type UserAuth = Pick<UserRow, 'id' | 'name' | 'pass_hash' | 'salt'>;
type UserPublic = Pick<UserRow, 'id' | 'name'>;
interface NewUser { name: string; passHash: string; salt: string; }
type ProfileData = unknown;

// --- Community map records (issue #7) ----------------------------------------
// A published, server-validated LevelDef plus the metadata the browse/play UI
// needs. `def` is the raw authored level object the deterministic sim consumes;
// biome/objective/mode are DERIVED server-side from the def (never trusted from
// the client) so the filters can't be spoofed. id/created_at/plays/rating are
// server-owned. The shape is identical across both backends.
type MapDef = unknown; // an opaque, already-validated LevelDef JSON blob
interface MapRow {
  id: string;
  name: string;
  author: string;
  description: string;
  def: MapDef;
  biome: string;
  objective: string;
  mode: string;
  plays: number;
  rating: number | null;
  created_at: string;
}
/** A new map handed to createMap — everything except the server-owned columns. */
interface NewMap {
  name: string;
  author: string;
  description: string;
  def: MapDef;
  biome: string;
  objective: string;
  mode: string;
}
/** Browse summary row: every field EXCEPT the (potentially large) def blob. */
type MapSummary = Omit<MapRow, 'def'>;
type MapSort = 'new' | 'plays' | 'rating';
interface ListMapsOpts {
  biome?: string;
  objective?: string;
  mode?: string;
  sort?: MapSort;
  limit?: number;
  offset?: number;
}

interface Backend {
  init(): Promise<void>;
  getUserByName(name: string): Promise<UserAuth | null>;
  getUserById(id: number | string): Promise<UserPublic | null>;
  createUser(u: NewUser): Promise<UserPublic>;
  getProfile(uid: number | string): Promise<ProfileData | null>;
  saveProfile(uid: number | string, data: ProfileData): Promise<void>;
  // --- community maps (issue #7) ---
  createMap(rec: NewMap): Promise<MapSummary>;
  listMaps(opts: ListMapsOpts): Promise<MapSummary[]>;
  getMap(id: string): Promise<MapRow | null>;
  incrementPlays(id: string): Promise<number | null>;
  rateMap(id: string, rating: number): Promise<number | null>;
  deleteMap(id: string, author: string): Promise<boolean>;
}

interface FileStore { users: UserRow[]; profiles: Record<string, ProfileData>; seq: number; maps?: MapRow[]; }

// summary projection (drop the def blob) shared by both backends
const toSummary = (m: MapRow): MapSummary => {
  const { def: _def, ...rest } = m;
  return rest;
};
// whitelist the sort column -> a fixed ORDER BY clause (never interpolate user
// text into SQL). 'new' = newest first; 'plays' / 'rating' tie-break to newest.
const ORDER_BY: Record<MapSort, string> = {
  new: 'created_at DESC, id DESC',
  plays: 'plays DESC, created_at DESC, id DESC',
  rating: 'rating DESC NULLS LAST, plays DESC, id DESC',
};

let backend: Backend | null = null;

export async function initDb(savesDir: string): Promise<Backend> {
  if (process.env.DATABASE_URL) {
    backend = await pgBackend(process.env.DATABASE_URL);
    console.log('DB: PostgreSQL (DATABASE_URL)');
  } else {
    backend = fileBackend(path.join(savesDir, 'users.json'));
    console.log('DB: local file store (no DATABASE_URL set) — set DATABASE_URL to use Postgres');
  }
  await backend.init();
  return backend;
}

// The interface the server uses. Throws if initDb() hasn't run.
export const db = {
  getUserByName: (name: string) => backend!.getUserByName(name),
  getUserById: (id: number | string) => backend!.getUserById(id),
  createUser: (u: NewUser) => backend!.createUser(u),
  getProfile: (uid: number | string) => backend!.getProfile(uid),
  saveProfile: (uid: number | string, data: ProfileData) => backend!.saveProfile(uid, data),
  // --- community maps (issue #7) ---
  createMap: (rec: NewMap) => backend!.createMap(rec),
  listMaps: (opts: ListMapsOpts) => backend!.listMaps(opts),
  getMap: (id: string) => backend!.getMap(id),
  incrementPlays: (id: string) => backend!.incrementPlays(id),
  rateMap: (id: string, rating: number) => backend!.rateMap(id, rating),
  deleteMap: (id: string, author: string) => backend!.deleteMap(id, author),
};

export type { MapRow, MapSummary, NewMap, ListMapsOpts, MapSort };

// Server-generated map id: short, URL-safe, collision-resistant. Time-prefixed
// so ids sort roughly by creation even without the timestamp column.
function newMapId(): string {
  const t = Date.now().toString(36);
  const r = crypto.randomBytes(6).toString('hex');
  return `${t}-${r}`;
}
// page-size guards shared by both backends (the route also clamps, defence in
// depth): a browse page never returns more than 60 rows.
const clampLimit = (n: number | undefined) => Math.min(60, Math.max(1, Math.floor(Number(n)) || 24));
const clampOffset = (n: number | undefined) => Math.min(100000, Math.max(0, Math.floor(Number(n)) || 0));
const sortKey = (s: MapSort | undefined): MapSort => (s === 'plays' || s === 'rating' ? s : 'new');

// --- PostgreSQL backend ------------------------------------------------------
async function pgBackend(url: string): Promise<Backend> {
  const { default: pg } = await import('pg'); // lazy: only loaded when DATABASE_URL is set
  // managed Postgres almost always requires TLS but with a proxy cert chain the
  // client can't fully verify — accept it (the connection is still encrypted).
  const needSsl = /[?&]sslmode=require/.test(url) || /railway|render|heroku|amazonaws|supabase|neon|fly/.test(url) || process.env.PGSSL === '1';
  const pool = new pg.Pool({ connectionString: url, ssl: needSsl ? { rejectUnauthorized: false } : undefined, max: 8 });
  return {
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        name_lc TEXT UNIQUE NOT NULL,
        pass_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS profiles (
        user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      // Community maps (issue #7). id is the server-generated text id; def is
      // the already-validated LevelDef. biome/objective/mode are derived
      // server-side. Indexes back the browse filters + sorts.
      await pool.query(`CREATE TABLE IF NOT EXISTS maps (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        def JSONB NOT NULL,
        biome TEXT NOT NULL DEFAULT '',
        objective TEXT NOT NULL DEFAULT '',
        mode TEXT NOT NULL DEFAULT '',
        plays BIGINT NOT NULL DEFAULT 0,
        rating REAL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS maps_browse ON maps (biome, objective, mode, created_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS maps_plays ON maps (plays DESC)`);
    },
    async getUserByName(name: string) {
      const r = await pool.query<UserAuth>('SELECT id, name, pass_hash, salt FROM users WHERE name_lc = $1', [String(name).toLowerCase()]);
      return r.rows[0] || null;
    },
    async getUserById(id: number | string) {
      const r = await pool.query<UserPublic>('SELECT id, name FROM users WHERE id = $1', [id]);
      return r.rows[0] || null;
    },
    async createUser({ name, passHash, salt }: NewUser) {
      const r = await pool.query<UserPublic>(
        'INSERT INTO users (name, name_lc, pass_hash, salt) VALUES ($1, $2, $3, $4) RETURNING id, name',
        [name, String(name).toLowerCase(), passHash, salt]);
      return r.rows[0];
    },
    async getProfile(uid: number | string) {
      const r = await pool.query<{ data: ProfileData }>('SELECT data FROM profiles WHERE user_id = $1', [uid]);
      return r.rows[0]?.data || null;
    },
    async saveProfile(uid: number | string, data: ProfileData) {
      await pool.query(
        `INSERT INTO profiles (user_id, data, updated) VALUES ($1, $2, now())
         ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated = now()`,
        [uid, data]);
    },
    // --- community maps (issue #7) -----------------------------------------
    async createMap(rec: NewMap) {
      const id = newMapId();
      const r = await pool.query<MapRow>(
        `INSERT INTO maps (id, name, author, description, def, biome, objective, mode)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, name, author, description, biome, objective, mode,
                   plays::int AS plays, rating, created_at`,
        [id, rec.name, rec.author, rec.description, rec.def, rec.biome, rec.objective, rec.mode]);
      return r.rows[0] as MapSummary;
    },
    async listMaps(opts: ListMapsOpts) {
      // build the WHERE from only the filters that are set; every value is a
      // bound parameter, and the ORDER BY comes from the fixed whitelist.
      const where: string[] = [];
      const args: unknown[] = [];
      const eq = (col: string, v: string | undefined) => {
        if (v) { args.push(v); where.push(`${col} = $${args.length}`); }
      };
      eq('biome', opts.biome); eq('objective', opts.objective); eq('mode', opts.mode);
      const limit = clampLimit(opts.limit), offset = clampOffset(opts.offset);
      args.push(limit); const limIdx = args.length;
      args.push(offset); const offIdx = args.length;
      const r = await pool.query<MapSummary>(
        `SELECT id, name, author, description, biome, objective, mode,
                plays::int AS plays, rating, created_at
           FROM maps
          ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY ${ORDER_BY[sortKey(opts.sort)]}
          LIMIT $${limIdx} OFFSET $${offIdx}`,
        args);
      return r.rows;
    },
    async getMap(id: string) {
      const r = await pool.query<MapRow>(
        `SELECT id, name, author, description, def, biome, objective, mode,
                plays::int AS plays, rating, created_at
           FROM maps WHERE id = $1`,
        [id]);
      return r.rows[0] || null;
    },
    async incrementPlays(id: string) {
      const r = await pool.query<{ plays: number }>(
        'UPDATE maps SET plays = plays + 1 WHERE id = $1 RETURNING plays::int AS plays', [id]);
      return r.rows[0] ? r.rows[0].plays : null;
    },
    async rateMap(id: string, rating: number) {
      const r = await pool.query<{ rating: number }>(
        'UPDATE maps SET rating = $2 WHERE id = $1 RETURNING rating', [id, rating]);
      return r.rows[0] ? r.rows[0].rating : null;
    },
    async deleteMap(id: string, author: string) {
      const r = await pool.query('DELETE FROM maps WHERE id = $1 AND author = $2', [id, author]);
      return (r.rowCount ?? 0) > 0;
    },
  };
}

// --- local file backend (dev only; single process) ---------------------------
function fileBackend(file: string): Backend {
  let store: FileStore = { users: [], profiles: {}, seq: 1 };
  const load = () => { try { store = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {} };
  const save = () => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(store)); fs.renameSync(tmp, file); };
  return {
    async init() { load(); },
    async getUserByName(name: string) { return store.users.find(u => u.name_lc === String(name).toLowerCase()) || null; },
    async getUserById(id: number | string) { const u = store.users.find(u => u.id === Number(id)); return u ? { id: u.id, name: u.name } : null; },
    async createUser({ name, passHash, salt }: NewUser) {
      if (store.users.some(u => u.name_lc === String(name).toLowerCase())) throw new Error('duplicate name');
      const u = { id: store.seq++, name, name_lc: String(name).toLowerCase(), pass_hash: passHash, salt };
      store.users.push(u); save();
      return { id: u.id, name: u.name };
    },
    async getProfile(uid: number | string) { return store.profiles[uid] || null; },
    async saveProfile(uid: number | string, data: ProfileData) { store.profiles[uid] = data; save(); },
    // --- community maps (issue #7) -----------------------------------------
    async createMap(rec: NewMap) {
      const maps = (store.maps ||= []);
      const row: MapRow = {
        id: newMapId(),
        name: rec.name, author: rec.author, description: rec.description,
        def: rec.def, biome: rec.biome, objective: rec.objective, mode: rec.mode,
        plays: 0, rating: null, created_at: new Date().toISOString(),
      };
      maps.push(row); save();
      return toSummary(row);
    },
    async listMaps(opts: ListMapsOpts) {
      let rows = (store.maps || []).slice();
      if (opts.biome) rows = rows.filter(m => m.biome === opts.biome);
      if (opts.objective) rows = rows.filter(m => m.objective === opts.objective);
      if (opts.mode) rows = rows.filter(m => m.mode === opts.mode);
      const sort = sortKey(opts.sort);
      const newest = (a: MapRow, b: MapRow) =>
        (b.created_at < a.created_at ? -1 : b.created_at > a.created_at ? 1 : 0) || (a.id < b.id ? 1 : -1);
      rows.sort((a, b) =>
        sort === 'plays' ? (b.plays - a.plays) || newest(a, b)
        : sort === 'rating' ? ((b.rating ?? -1) - (a.rating ?? -1)) || (b.plays - a.plays) || newest(a, b)
        : newest(a, b));
      const limit = clampLimit(opts.limit), offset = clampOffset(opts.offset);
      return rows.slice(offset, offset + limit).map(toSummary);
    },
    async getMap(id: string) { return (store.maps || []).find(m => m.id === id) || null; },
    async incrementPlays(id: string) {
      const m = (store.maps || []).find(m => m.id === id);
      if (!m) return null;
      m.plays++; save();
      return m.plays;
    },
    async rateMap(id: string, rating: number) {
      const m = (store.maps || []).find(m => m.id === id);
      if (!m) return null;
      m.rating = rating; save();
      return m.rating;
    },
    async deleteMap(id: string, author: string) {
      const maps = store.maps || [];
      const i = maps.findIndex(m => m.id === id && m.author === author);
      if (i === -1) return false;
      maps.splice(i, 1); save();
      return true;
    },
  };
}
