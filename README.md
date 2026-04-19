# Paisa Tracker 💰
### Smart Finance App for Indian Students

A full-stack mobile-first web app to help college students track spending, set budgets, manage savings goals, and build healthy money habits.

---

## Features

- **User accounts** — Register/login with JWT auth, secure passwords
- **Transactions** — Log income & expenses with 18 student-specific categories
- **Budget tracking** — Set monthly limits per category, live status with grades
- **Savings goals** — Track goals with deadlines and monthly savings estimates
- **Recurring expenses** — One-tap logging for mess fees, subscriptions etc.
- **Bill splitter** — Split Zomato orders or trip costs with friends
- **Analytics** — Donut chart, 6-month trend, monthly report card (A/B/C/D grade)
- **Budget streak** — Tracks how many months you stayed within budget
- **Money tips** — 8 India-specific student finance tips
- **Mobile-first UI** — Works perfectly on phone browsers

---

## Tech Stack

| Layer    | Tech                     |
|----------|--------------------------|
| Frontend | HTML, CSS, Vanilla JS    |
| Backend  | Node.js + Express        |
| Database | SQLite (via better-sqlite3) |
| Auth     | JWT + bcrypt             |

---

## Setup & Run

### Prerequisites
- Node.js 18+ installed
- npm installed

### Steps

```bash
# 1. Go into backend folder
cd backend

# 2. Install dependencies
npm install

# 3. Start the server
node server.js
```

Then open your browser at: **http://localhost:3000**

For development with auto-reload:
```bash
npm run dev
```

---

## Project Structure

```
paisa-tracker/
├── backend/
│   ├── server.js         # Express API + SQLite DB
│   ├── package.json
│   └── paisa.db          # Auto-created on first run
├── frontend/
│   └── public/
│       └── index.html    # Complete frontend (single file)
├── package.json
└── README.md
```

---

## API Endpoints

| Method | Route                        | Description              |
|--------|------------------------------|--------------------------|
| POST   | /api/auth/register           | Create account           |
| POST   | /api/auth/login              | Login                    |
| GET    | /api/auth/me                 | Get profile              |
| PUT    | /api/auth/me                 | Update profile           |
| GET    | /api/transactions            | Get all transactions     |
| POST   | /api/transactions            | Add transaction          |
| DELETE | /api/transactions/:id        | Delete transaction       |
| GET    | /api/transactions/summary    | Monthly summary          |
| GET    | /api/budgets                 | Get budgets              |
| POST   | /api/budgets                 | Save budgets             |
| GET    | /api/goals                   | Get savings goals        |
| POST   | /api/goals                   | Add goal                 |
| PUT    | /api/goals/:id               | Update goal savings      |
| DELETE | /api/goals/:id               | Delete goal              |
| GET    | /api/recurring               | Get recurring expenses   |
| POST   | /api/recurring               | Add recurring            |
| DELETE | /api/recurring/:id           | Delete recurring         |
| GET    | /api/analytics/category      | Category breakdown       |
| GET    | /api/analytics/streak        | Budget streak            |

---

## Environment Variables (optional)

```env
PORT=3000
JWT_SECRET=your_custom_secret_here
```

---

## Deploy to Production

You can deploy this on any Node.js host:
- **Railway** — drag and drop the backend folder
- **Render** — free tier works fine
- **VPS** — run with `pm2 start server.js`

For production, set a strong `JWT_SECRET` environment variable.

---
## To test 
https://paisa-tracker-69.onrender.com

Made with ❤️ for Indian college students
