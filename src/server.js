import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { pool, queryOne, initDb } from './db.js';
import { authRouter, authMiddleware, optionalAuth } from './auth.js';
import { mcpRouter } from './mcp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(join(__dirname, '../public')));

app.use('/auth', authRouter);
app.use('/mcp', mcpRouter);

// Get user's data
app.get('/api/data', authMiddleware, async (req, res) => {
  const user = await queryOne('SELECT data FROM users WHERE id = $1', [req.userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user.data);
});

// Direct data update
app.put('/api/data', authMiddleware, async (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'data required' });

  try {
    await pool.query(
      'UPDATE users SET data = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(data), req.userId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: 'Invalid data format' });
  }
});

// SSE for real-time updates
app.get('/api/stream', authMiddleware, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendData = async () => {
    const user = await queryOne('SELECT data, updated_at FROM users WHERE id = $1', [req.userId]);
    if (user) {
      res.write(`data: ${JSON.stringify({ data: user.data, updated_at: user.updated_at })}\n\n`);
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

initDb().then(() => {
  app.listen(PORT, () => console.log(`Cosimo running on http://localhost:${PORT}`));
});
