import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { pool, queryOne } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'cosimo-dev-secret-change-in-prod';
const COOKIE_NAME = 'cosimo_token';

export const authRouter = express.Router();

// Register
authRouter.post('/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const apiKey = `csk_${nanoid(32)}`;

    const result = await pool.query(
      'INSERT INTO users (email, password, api_key) VALUES ($1, $2, $3) RETURNING id',
      [email, hash, apiKey]
    );

    const token = jwt.sign({ userId: result.rows[0].id }, JWT_SECRET, { expiresIn: '30d' });
    res.cookie(COOKIE_NAME, token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, apiKey });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Email already registered' });
    }
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = await queryOne('SELECT * FROM users WHERE email = $1', [email]);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie(COOKIE_NAME, token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
  res.json({ success: true });
});

// Logout
authRouter.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ success: true });
});

// Get current user info
authRouter.get('/me', authMiddleware, async (req, res) => {
  const user = await queryOne('SELECT id, email, api_key, created_at FROM users WHERE id = $1', [req.userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// Regenerate API key
authRouter.post('/regenerate-key', authMiddleware, async (req, res) => {
  const apiKey = `csk_${nanoid(32)}`;
  await pool.query('UPDATE users SET api_key = $1 WHERE id = $2', [apiKey, req.userId]);
  res.json({ apiKey });
});

// Auth middleware (cookie or Bearer token)
export async function authMiddleware(req, res, next) {
  let token = req.cookies[COOKIE_NAME];

  // Check Authorization header for API access
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const apiKey = authHeader.slice(7);
    const user = await queryOne('SELECT id FROM users WHERE api_key = $1', [apiKey]);
    if (user) {
      req.userId = user.id;
      return next();
    }
  }

  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Optional auth (doesn't fail, just sets userId if valid)
export function optionalAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.userId = decoded.userId;
    } catch {}
  }
  next();
}
