const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'paisa_tracker_secret_2024';

// ── Database setup ─────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'paisa.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    monthly_income REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('inc','exp')),
    category TEXT NOT NULL,
    note TEXT DEFAULT '',
    month TEXT NOT NULL,
    date TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    UNIQUE(user_id, category),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    target REAL NOT NULL,
    saved REAL DEFAULT 0,
    deadline TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS recurring (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    amount REAL NOT NULL,
    category TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

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
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, monthly_income } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email and password are required' });

  const hashed = bcrypt.hashSync(password, 10);
  try {
    const stmt = db.prepare('INSERT INTO users (name,email,password,monthly_income) VALUES (?,?,?,?)');
    const result = stmt.run(name, email, hashed, monthly_income || 0);
    const token = jwt.sign({ id: result.lastInsertRowid, name, email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: result.lastInsertRowid, name, email, monthly_income: monthly_income || 0 } });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid email or password' });
  const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, monthly_income: user.monthly_income } });
});

app.get('/api/auth/me', auth, (req, res) => {
  const user = db.prepare('SELECT id,name,email,monthly_income,created_at FROM users WHERE id=?').get(req.user.id);
  res.json(user);
});

app.put('/api/auth/me', auth, (req, res) => {
  const { name, monthly_income } = req.body;
  db.prepare('UPDATE users SET name=?, monthly_income=? WHERE id=?').run(name, monthly_income, req.user.id);
  res.json({ success: true });
});

// ── Transactions ───────────────────────────────────────────────
app.get('/api/transactions', auth, (req, res) => {
  const { month } = req.query;
  let rows;
  if (month) {
    rows = db.prepare('SELECT * FROM transactions WHERE user_id=? AND month=? ORDER BY created_at DESC').all(req.user.id, month);
  } else {
    rows = db.prepare('SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC').all(req.user.id);
  }
  res.json(rows);
});

app.post('/api/transactions', auth, (req, res) => {
  const { description, amount, type, category, note, month, date } = req.body;
  if (!description || !amount || !type || !category || !month || !date)
    return res.status(400).json({ error: 'Missing required fields' });
  const result = db.prepare(
    'INSERT INTO transactions (user_id,description,amount,type,category,note,month,date) VALUES (?,?,?,?,?,?,?,?)'
  ).run(req.user.id, description, amount, type, category, note || '', month, date);
  res.json({ id: result.lastInsertRowid, description, amount, type, category, note, month, date });
});

app.delete('/api/transactions/:id', auth, (req, res) => {
  const result = db.prepare('DELETE FROM transactions WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

app.get('/api/transactions/summary', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT month,
      SUM(CASE WHEN type='inc' THEN amount ELSE 0 END) as income,
      SUM(CASE WHEN type='exp' THEN amount ELSE 0 END) as expense
    FROM transactions WHERE user_id=?
    GROUP BY month ORDER BY month DESC LIMIT 12
  `).all(req.user.id);
  res.json(rows);
});

// ── Budgets ────────────────────────────────────────────────────
app.get('/api/budgets', auth, (req, res) => {
  const rows = db.prepare('SELECT category, amount FROM budgets WHERE user_id=?').all(req.user.id);
  const obj = {};
  rows.forEach(r => { obj[r.category] = r.amount; });
  res.json(obj);
});

app.post('/api/budgets', auth, (req, res) => {
  const budgets = req.body;
  const upsert = db.prepare('INSERT INTO budgets (user_id,category,amount) VALUES (?,?,?) ON CONFLICT(user_id,category) DO UPDATE SET amount=excluded.amount');
  const del = db.prepare('DELETE FROM budgets WHERE user_id=? AND category=?');
  const tx = db.transaction(() => {
    for (const [cat, amt] of Object.entries(budgets)) {
      if (amt > 0) upsert.run(req.user.id, cat, amt);
      else del.run(req.user.id, cat);
    }
  });
  tx();
  res.json({ success: true });
});

// ── Goals ──────────────────────────────────────────────────────
app.get('/api/goals', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM goals WHERE user_id=? ORDER BY created_at DESC').all(req.user.id));
});

app.post('/api/goals', auth, (req, res) => {
  const { name, target, saved, deadline } = req.body;
  if (!name || !target) return res.status(400).json({ error: 'Name and target required' });
  const result = db.prepare('INSERT INTO goals (user_id,name,target,saved,deadline) VALUES (?,?,?,?,?)').run(
    req.user.id, name, target, saved || 0, deadline || ''
  );
  res.json({ id: result.lastInsertRowid, name, target, saved: saved || 0, deadline: deadline || '' });
});

app.put('/api/goals/:id', auth, (req, res) => {
  const { saved } = req.body;
  const result = db.prepare('UPDATE goals SET saved=? WHERE id=? AND user_id=?').run(saved, req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

app.delete('/api/goals/:id', auth, (req, res) => {
  const result = db.prepare('DELETE FROM goals WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// ── Recurring ──────────────────────────────────────────────────
app.get('/api/recurring', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM recurring WHERE user_id=?').all(req.user.id));
});

app.post('/api/recurring', auth, (req, res) => {
  const { name, amount, category } = req.body;
  if (!name || !amount || !category) return res.status(400).json({ error: 'Missing fields' });
  const result = db.prepare('INSERT INTO recurring (user_id,name,amount,category) VALUES (?,?,?,?)').run(req.user.id, name, amount, category);
  res.json({ id: result.lastInsertRowid, name, amount, category });
});

app.delete('/api/recurring/:id', auth, (req, res) => {
  db.prepare('DELETE FROM recurring WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

// ── Analytics ──────────────────────────────────────────────────
app.get('/api/analytics/category', auth, (req, res) => {
  const { month } = req.query;
  const rows = db.prepare(`
    SELECT category, SUM(amount) as total
    FROM transactions WHERE user_id=? AND month=? AND type='exp'
    GROUP BY category ORDER BY total DESC
  `).all(req.user.id, month);
  res.json(rows);
});

app.get('/api/analytics/streak', auth, (req, res) => {
  const budgets = db.prepare('SELECT category, amount FROM budgets WHERE user_id=?').all(req.user.id);
  if (!budgets.length) return res.json({ streak: 0, message: 'Set budgets to track streak' });

  const months = db.prepare(`SELECT DISTINCT month FROM transactions WHERE user_id=? ORDER BY month DESC LIMIT 6`).all(req.user.id);
  let streak = 0;
  for (const { month } of months) {
    const totals = db.prepare(`SELECT category, SUM(amount) as total FROM transactions WHERE user_id=? AND month=? AND type='exp' GROUP BY category`).all(req.user.id, month);
    const totalMap = {};
    totals.forEach(t => { totalMap[t.category] = t.total; });
    const withinBudget = budgets.every(b => (totalMap[b.category] || 0) <= b.amount);
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
