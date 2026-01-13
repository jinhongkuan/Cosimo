import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { pool, queryOne, initDb, DEFAULT_DATA } from './db.js';
import { authRouter, auth0Middleware, authMiddleware, optionalAuth } from './auth.js';
import { mcpRouter } from './mcp.js';
import { encryptData, decryptData, isEncrypted, verifyPassphrase } from './crypto.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());

// Auth0 middleware must be before static files to handle callback
app.use(auth0Middleware);

app.use(express.static(join(__dirname, '../public')));

app.use('/auth', authRouter);
app.use('/mcp', mcpRouter);

// Helper to get user data (handles both encrypted and unencrypted)
async function getUserData(userId, passphrase = null) {
  const user = await queryOne(
    'SELECT data, encryption_enabled, passphrase_hash FROM users WHERE id = $1',
    [userId]
  );

  if (!user) return null;

  // If encryption enabled, require passphrase
  if (user.encryption_enabled) {
    if (!passphrase) {
      return { error: 'PASSPHRASE_REQUIRED', encryption_enabled: true };
    }
    if (!verifyPassphrase(passphrase, user.passphrase_hash)) {
      return { error: 'INVALID_PASSPHRASE', encryption_enabled: true };
    }
    // Decrypt data
    if (user.data && isEncrypted(user.data)) {
      return { data: decryptData(user.data, passphrase), encryption_enabled: true };
    }
    return { data: { ...DEFAULT_DATA }, encryption_enabled: true };
  }

  // No encryption - return plain data
  if (user.data) {
    try {
      return { data: JSON.parse(user.data), encryption_enabled: false };
    } catch {
      return { data: { ...DEFAULT_DATA }, encryption_enabled: false };
    }
  }
  return { data: { ...DEFAULT_DATA }, encryption_enabled: false };
}

// Helper to save user data
async function saveUserData(userId, data, passphrase = null) {
  const user = await queryOne('SELECT encryption_enabled FROM users WHERE id = $1', [userId]);

  let dataToStore;
  if (user.encryption_enabled) {
    if (!passphrase) throw new Error('Passphrase required for encrypted storage');
    dataToStore = encryptData(data, passphrase);
  } else {
    dataToStore = JSON.stringify(data);
  }

  await pool.query(
    'UPDATE users SET data = $1, updated_at = NOW() WHERE id = $2',
    [dataToStore, userId]
  );
}

// Get user's data
app.get('/api/data', authMiddleware, async (req, res) => {
  const passphrase = req.headers['x-passphrase'] || req.query.passphrase;

  try {
    const result = await getUserData(req.userId, passphrase);

    if (!result) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (result.error === 'PASSPHRASE_REQUIRED') {
      return res.status(400).json({ error: 'Passphrase required', code: 'PASSPHRASE_REQUIRED' });
    }

    if (result.error === 'INVALID_PASSPHRASE') {
      return res.status(401).json({ error: 'Invalid passphrase', code: 'INVALID_PASSPHRASE' });
    }

    res.json(result.data);
  } catch (err) {
    console.error('Get data error:', err);
    res.status(500).json({ error: 'Failed to retrieve data' });
  }
});

// Update data
app.put('/api/data', authMiddleware, async (req, res) => {
  const { data } = req.body;
  const passphrase = req.headers['x-passphrase'] || req.body.passphrase;

  if (!data) return res.status(400).json({ error: 'data required' });

  try {
    const user = await queryOne('SELECT encryption_enabled, passphrase_hash FROM users WHERE id = $1', [req.userId]);

    if (user.encryption_enabled) {
      if (!passphrase) {
        return res.status(400).json({ error: 'Passphrase required', code: 'PASSPHRASE_REQUIRED' });
      }
      if (!verifyPassphrase(passphrase, user.passphrase_hash)) {
        return res.status(401).json({ error: 'Invalid passphrase', code: 'INVALID_PASSPHRASE' });
      }
    }

    await saveUserData(req.userId, data, passphrase);
    res.json({ success: true });
  } catch (err) {
    console.error('Update data error:', err);
    res.status(400).json({ error: 'Invalid data format' });
  }
});

// SSE for real-time updates
app.get('/api/stream', authMiddleware, async (req, res) => {
  const passphrase = req.query.passphrase;

  // Check if encryption is enabled
  const user = await queryOne('SELECT encryption_enabled, passphrase_hash FROM users WHERE id = $1', [req.userId]);

  if (user.encryption_enabled) {
    if (!passphrase) {
      return res.status(400).json({ error: 'Passphrase required', code: 'PASSPHRASE_REQUIRED' });
    }
    if (!verifyPassphrase(passphrase, user.passphrase_hash)) {
      return res.status(401).json({ error: 'Invalid passphrase' });
    }
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendData = async () => {
    try {
      const result = await getUserData(req.userId, passphrase);
      if (result && result.data) {
        const userData = await queryOne('SELECT updated_at FROM users WHERE id = $1', [req.userId]);
        res.write(`data: ${JSON.stringify({ data: result.data, updated_at: userData.updated_at })}\n\n`);
      }
    } catch (err) {
      console.error('Stream error:', err);
    }
  };

  await sendData();
  const interval = setInterval(sendData, 2000);
  req.on('close', () => clearInterval(interval));
});

app.get('/app', optionalAuth, (req, res) => {
  if (!req.userId) return res.redirect('/');
  res.sendFile(join(__dirname, '../public/app.html'));
});

app.get('/dashboard', optionalAuth, (req, res) => {
  if (!req.userId) return res.redirect('/');
  res.sendFile(join(__dirname, '../public/dashboard.html'));
});

// Healthcheck endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start server first, then init DB
app.listen(PORT, () => {
  console.log(`Cosimo running on http://localhost:${PORT}`);
  initDb()
    .then(() => console.log('Database connected'))
    .catch(err => console.error('Database init failed:', err.message));
});
