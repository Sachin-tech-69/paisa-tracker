const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'paisa_tracker_secret_2024';

// ── Database setup ─────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      monthly_income REAL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('inc','exp')),
      category TEXT NOT NULL,
      note TEXT DEFAULT '',
      month TEXT NOT NULL,
      date TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      UNIQUE(user_id, category)
    );

    CREATE TABLE IF NOT EXISTS goals (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      target REAL NOT NULL,
      saved REAL DEFAULT 0,
      deadline TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS recurring (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT NOT NULL
    );
  `);
  console.log('Database initialized');
}

initDB().catch(console.error);

// ── Middleware ─────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend/public')));

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ── Auth routes ────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, monthly_income } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email and password are required' });
  const hashed = bcrypt.hashSync(password, 10);
  try {
    const result = await pool.query(
      'INSERT INTO users (name,email,password,monthly_income) VALUES ($1,$2,$3,$4) RETURNING id',
      [name, email, hashed, monthly_income || 0]
    );
    const id = result.rows[0].id;
    const token = jwt.sign({ id, name, email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id, name, email, monthly_income: monthly_income || 0 } });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
  const user = result.rows[0];
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid email or password' });
  const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, monthly_income: user.monthly_income } });
});

app.get('/api/auth/me', auth, async (req, res) => {
  const result = await pool.query('SELECT id,name,email,monthly_income,created_at FROM users WHERE id=$1', [req.user.id]);
  res.json(result.rows[0]);
});

app.put('/api/auth/me', auth, async (req, res) => {
  const { name, monthly_income } = req.body;
  await pool.query('UPDATE users SET name=$1,monthly_income=$2 WHERE id=$3', [name, monthly_income, req.user.id]);
  res.json({ success: true });
});

// ── Transactions ───────────────────────────────────────────────
app.get('/api/transactions', auth, async (req, res) => {
  const { month } = req.query;
  let result;
  if (month) {
    result = await pool.query('SELECT * FROM transactions WHERE user_id=$1 AND month=$2 ORDER BY created_at DESC', [req.user.id, month]);
  } else {
    result = await pool.query('SELECT * FROM transactions WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
  }
  res.json(result.rows);
});

app.post('/api/transactions', auth, async (req, res) => {
  const { description, amount, type, category, note, month, date } = req.body;
  if (!description || !amount || !type || !category || !month || !date)
    return res.status(400).json({ error: 'Missing required fields' });
  const result = await pool.query(
    'INSERT INTO transactions (user_id,description,amount,type,category,note,month,date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
    [req.user.id, description, amount, type, category, note || '', month, date]
  );
  res.json({ id: result.rows[0].id, description, amount, type, category, note, month, date });
});

app.delete('/api/transactions/:id', auth, async (req, res) => {
  const result = await pool.query('DELETE FROM transactions WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

app.get('/api/transactions/summary', auth, async (req, res) => {
  const result = await pool.query(`
    SELECT month,
      SUM(CASE WHEN type='inc' THEN amount ELSE 0 END) as income,
      SUM(CASE WHEN type='exp' THEN amount ELSE 0 END) as expense
    FROM transactions WHERE user_id=$1
    GROUP BY month ORDER BY month DESC LIMIT 12
  `, [req.user.id]);
  res.json(result.rows);
});

// ── Budgets ────────────────────────────────────────────────────
app.get('/api/budgets', auth, async (req, res) => {
  const result = await pool.query('SELECT category,amount FROM budgets WHERE user_id=$1', [req.user.id]);
  const obj = {};
  result.rows.forEach(r => { obj[r.category] = r.amount; });
  res.json(obj);
});

app.post('/api/budgets', auth, async (req, res) => {
  const budgets = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [cat, amt] of Object.entries(budgets)) {
      if (amt > 0) {
        await client.query(
          'INSERT INTO budgets (user_id,category,amount) VALUES ($1,$2,$3) ON CONFLICT (user_id,category) DO UPDATE SET amount=$3',
          [req.user.id, cat, amt]
        );
      } else {
        await client.query('DELETE FROM budgets WHERE user_id=$1 AND category=$2', [req.user.id, cat]);
      }
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ── Goals ──────────────────────────────────────────────────────
app.get('/api/goals', auth, async (req, res) => {
  const result = await pool.query('SELECT * FROM goals WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
  res.json(result.rows);
});

app.post('/api/goals', auth, async (req, res) => {
  const { name, target, saved, deadline } = req.body;
  if (!name || !target) return res.status(400).json({ error: 'Name and target required' });
  const result = await pool.query(
    'INSERT INTO goals (user_id,name,target,saved,deadline) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [req.user.id, name, target, saved || 0, deadline || '']
  );
  res.json({ id: result.rows[0].id, name, target, saved: saved || 0, deadline: deadline || '' });
});

app.put('/api/goals/:id', auth, async (req, res) => {
  const { saved } = req.body;
  const result = await pool.query('UPDATE goals SET saved=$1 WHERE id=$2 AND user_id=$3', [saved, req.params.id, req.user.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

app.delete('/api/goals/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM goals WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ success: true });
});

// ── Recurring ──────────────────────────────────────────────────
app.get('/api/recurring', auth, async (req, res) => {
  const result = await pool.query('SELECT * FROM recurring WHERE user_id=$1', [req.user.id]);
  res.json(result.rows);
});

app.post('/api/recurring', auth, async (req, res) => {
  const { name, amount, category } = req.body;
  if (!name || !amount || !category) return res.status(400).json({ error: 'Missing fields' });
  const result = await pool.query(
    'INSERT INTO recurring (user_id,name,amount,category) VALUES ($1,$2,$3,$4) RETURNING id',
    [req.user.id, name, amount, category]
  );
  res.json({ id: result.rows[0].id, name, amount, category });
});

app.delete('/api/recurring/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM recurring WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ success: true });
});

// ── Analytics ──────────────────────────────────────────────────
app.get('/api/analytics/category', auth, async (req, res) => {
  const { month } = req.query;
  const result = await pool.query(`
    SELECT category, SUM(amount) as total
    FROM transactions WHERE user_id=$1 AND month=$2 AND type='exp'
    GROUP BY category ORDER BY total DESC
  `, [req.user.id, month]);
  res.json(result.rows);
});

app.get('/api/analytics/streak', auth, async (req, res) => {
  const budgets = await pool.query('SELECT category,amount FROM budgets WHERE user_id=$1', [req.user.id]);
  if (!budgets.rows.length) return res.json({ streak: 0, message: 'Set budgets to track streak' });

  const months = await pool.query(
    `SELECT DISTINCT month FROM transactions WHERE user_id=$1 ORDER BY month DESC LIMIT 6`,
    [req.user.id]
  );
  let streak = 0;
  for (const { month } of months.rows) {
    const totals = await pool.query(
      `SELECT category, SUM(amount) as total FROM transactions WHERE user_id=$1 AND month=$2 AND type='exp' GROUP BY category`,
      [req.user.id, month]
    );
    const totalMap = {};
    totals.rows.forEach(t => { totalMap[t.category] = parseFloat(t.total); });
    const withinBudget = budgets.rows.every(b => (totalMap[b.category] || 0) <= parseFloat(b.amount));
    if (withinBudget) streak++; else break;
  }
  res.json({ streak, message: streak > 0 ? `${streak} month${streak > 1 ? 's' : ''} within budget!` : 'Stay within budget to start a streak' });
});

// ── Serve frontend ─────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

app.listen(PORT, () => {
  console.log(`Paisa Tracker running on http://localhost:${PORT}`);
});