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

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      api_key TEXT UNIQUE NOT NULL,
      data JSONB DEFAULT '${JSON.stringify(DEFAULT_DATA)}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
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
