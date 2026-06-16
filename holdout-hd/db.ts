// Database layer for accounts + cloud profiles.
//
// Uses PostgreSQL when DATABASE_URL is set (Railway/Fly/Render provide it),
// otherwise a local JSON-file store so development works with no database at
// all. Both backends implement the same small async interface, so the rest of
// the server never knows which is live. All queries are parameterized.
import fs from 'fs';
import path from 'path';

// --- DB record shapes (auth/profile storage; not part of the sim contracts) ---
interface UserRow { id: number; name: string; pass_hash: string; salt: string; name_lc: string; }
type UserAuth = Pick<UserRow, 'id' | 'name' | 'pass_hash' | 'salt'>;
type UserPublic = Pick<UserRow, 'id' | 'name'>;
interface NewUser { name: string; passHash: string; salt: string; }
type ProfileData = unknown;

interface Backend {
  init(): Promise<void>;
  getUserByName(name: string): Promise<UserAuth | null>;
  getUserById(id: number | string): Promise<UserPublic | null>;
  createUser(u: NewUser): Promise<UserPublic>;
  getProfile(uid: number | string): Promise<ProfileData | null>;
  saveProfile(uid: number | string, data: ProfileData): Promise<void>;
}

interface FileStore { users: UserRow[]; profiles: Record<string, ProfileData>; seq: number; }

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
};

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
  };
}
