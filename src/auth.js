import express from 'express';
import { auth } from 'express-openid-connect';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { pool, queryOne, DEFAULT_DATA } from './db.js';
import { encryptData, hashPassphrase, verifyPassphrase } from './crypto.js';

const JWT_SECRET = process.env.JWT_SECRET || 'cosimo-dev-secret-change-in-prod';
const COOKIE_NAME = 'cosimo_token';

export const authRouter = express.Router();

// Auth0 configuration
const auth0Config = {
  authRequired: false,
  auth0Logout: true,
  secret: process.env.AUTH0_SECRET,
  baseURL: process.env.AUTH0_BASE_URL || 'http://localhost:3000',
  clientID: process.env.AUTH0_CLIENT_ID,
  clientSecret: process.env.AUTH0_CLIENT_SECRET,
  issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
  routes: {
    login: false,
    logout: false,
    callback: '/auth/callback'
  },
  authorizationParams: {
    response_type: 'code',
    scope: 'openid email profile',
    connection: 'google-oauth2'
  },
  afterCallback: async (req, res, session, state) => {
    // Decode the id_token JWT to get user claims
    // The id_token is a JWT string - we need to decode it (verification already done by Auth0)
    const idToken = session.id_token;
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());

    const auth0Id = payload.sub;
    const email = payload.email;
    const name = payload.name || payload.nickname;
    const picture = payload.picture;

    console.log('Decoded claims:', { auth0Id, email, name, picture });

    if (!email) {
      console.error('No email in id_token payload:', payload);
      throw new Error('Email not provided by Auth0. Check your Auth0 settings.');
    }

    try {
      let user = await queryOne('SELECT * FROM users WHERE auth0_id = $1', [auth0Id]);

      if (!user) {
        // New user - create with default unencrypted data
        const apiKey = `csk_${nanoid(32)}`;
        const defaultData = JSON.stringify(DEFAULT_DATA);

        const result = await pool.query(
          `INSERT INTO users (email, auth0_id, name, picture, api_key, data, encryption_enabled)
           VALUES ($1, $2, $3, $4, $5, $6, FALSE)
           ON CONFLICT (email) DO UPDATE SET auth0_id = $2, name = $3, picture = $4
           RETURNING *`,
          [email, auth0Id, name || '', picture || '', apiKey, defaultData]
        );
        user = result.rows[0];
      }

      const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
      res.cookie(COOKIE_NAME, token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });

      return session;
    } catch (err) {
      console.error('Auth callback error:', err);
      throw err;
    }
  }
};

export const auth0Middleware = auth(auth0Config);

// Login - redirects to Auth0 with Google
authRouter.get('/login', (req, res) => {
  res.oidc.login({
    returnTo: '/app',
    authorizationParams: {
      connection: 'google-oauth2'
    }
  });
});

// Logout
authRouter.get('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.oidc.logout({
    returnTo: process.env.AUTH0_BASE_URL || 'http://localhost:3000'
  });
});

authRouter.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ success: true, logoutUrl: '/auth/logout' });
});

// Get current user info
authRouter.get('/me', authMiddleware, async (req, res) => {
  const user = await queryOne(
    'SELECT id, email, name, picture, api_key, encryption_enabled, passphrase_hash, created_at FROM users WHERE id = $1',
    [req.userId]
  );
  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    api_key: user.api_key,
    created_at: user.created_at,
    encryption_enabled: user.encryption_enabled,
    has_passphrase: !!user.passphrase_hash
  });
});

// Enable encryption and set passphrase
authRouter.post('/enable-encryption', authMiddleware, async (req, res) => {
  const { passphrase } = req.body;
  if (!passphrase || passphrase.length < 4) {
    return res.status(400).json({ error: 'Passphrase must be at least 4 characters' });
  }

  try {
    const user = await queryOne('SELECT encryption_enabled, data FROM users WHERE id = $1', [req.userId]);

    if (user.encryption_enabled) {
      return res.status(400).json({ error: 'Encryption already enabled' });
    }

    // Get current data and encrypt it
    let currentData = DEFAULT_DATA;
    if (user.data) {
      try {
        currentData = JSON.parse(user.data);
      } catch {}
    }

    const passphraseHash = hashPassphrase(passphrase);
    const encryptedData = encryptData(currentData, passphrase);

    await pool.query(
      'UPDATE users SET encryption_enabled = TRUE, passphrase_hash = $1, data = $2, updated_at = NOW() WHERE id = $3',
      [passphraseHash, encryptedData, req.userId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Enable encryption error:', err);
    res.status(500).json({ error: 'Failed to enable encryption' });
  }
});

// Verify passphrase (for unlocking in browser)
authRouter.post('/verify-passphrase', authMiddleware, async (req, res) => {
  const { passphrase } = req.body;
  if (!passphrase) {
    return res.status(400).json({ error: 'Passphrase required' });
  }

  try {
    const user = await queryOne('SELECT encryption_enabled, passphrase_hash FROM users WHERE id = $1', [req.userId]);

    if (!user.encryption_enabled) {
      return res.status(400).json({ error: 'Encryption not enabled' });
    }

    if (!user.passphrase_hash) {
      return res.status(400).json({ error: 'No passphrase set' });
    }

    const valid = verifyPassphrase(passphrase, user.passphrase_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid passphrase' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Verify passphrase error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Regenerate API key
authRouter.post('/regenerate-key', authMiddleware, async (req, res) => {
  try {
    const newApiKey = `csk_${nanoid(32)}`;
    await pool.query(
      'UPDATE users SET api_key = $1, updated_at = NOW() WHERE id = $2',
      [newApiKey, req.userId]
    );
    res.json({ apiKey: newApiKey });
  } catch (err) {
    console.error('Regenerate key error:', err);
    res.status(500).json({ error: 'Failed to regenerate key' });
  }
});

// Auth middleware (cookie JWT or Bearer API key)
export async function authMiddleware(req, res, next) {
  let token = req.cookies[COOKIE_NAME];

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const apiKey = authHeader.slice(7);
    const user = await queryOne('SELECT id, api_key FROM users WHERE api_key = $1', [apiKey]);
    if (user) {
      req.userId = user.id;
      req.apiKey = user.api_key;
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

// Optional auth
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
