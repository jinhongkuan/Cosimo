import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const DEFAULT_DATA = {
  objectives: [],
  deliverables: [],
  relationships: {},
  lastUpdated: new Date().toISOString()
};

export { DEFAULT_DATA };

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      auth0_id TEXT UNIQUE,
      name TEXT,
      picture TEXT,
      api_key TEXT UNIQUE NOT NULL,
      encryption_enabled BOOLEAN DEFAULT FALSE,
      passphrase_hash TEXT,
      data TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Migration for existing databases
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='auth0_id') THEN
        ALTER TABLE users ADD COLUMN auth0_id TEXT UNIQUE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='name') THEN
        ALTER TABLE users ADD COLUMN name TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='picture') THEN
        ALTER TABLE users ADD COLUMN picture TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='passphrase_hash') THEN
        ALTER TABLE users ADD COLUMN passphrase_hash TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='encryption_enabled') THEN
        ALTER TABLE users ADD COLUMN encryption_enabled BOOLEAN DEFAULT FALSE;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='password') THEN
        ALTER TABLE users ALTER COLUMN password DROP NOT NULL;
      END IF;
    END $$;
  `);

  console.log('Database initialized');
}

// Helper for sync-style queries (returns first row)
export async function queryOne(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows[0];
}

export async function query(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}
