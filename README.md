# Lead Tracker — Professional CRM Dashboard

A clean, modern, responsive Lead Management / CRM web application built with **Flask + SQLite + Vanilla JS**.

## Features

- **Dashboard statistics** — Total Leads, Overdue Follow-ups, Pipeline Value (dynamic)
- **Full CRUD** — Add, View, Edit, Delete leads
- **Search** — Instant search by name, contact number, source
- **Filters** — Status + Priority filters with live counts
- **Sorting** — Needs Attention (default), Newest, Oldest, Deal Value, Follow-up, Priority
- **Automatic calculations**
  - Days since last contact
  - Overdue follow-up detection (highlighted in red)
- **Notes** support
- **Professional UI** — responsive table on desktop, cards on mobile
- **Toast notifications**, form validation, delete confirmation
- **Demo data** seeded automatically on first run
- **Easy local development** + Vercel-ready structure

## Tech Stack

| Layer     | Technology                          |
|-----------|-------------------------------------|
| Frontend  | HTML5, CSS3, Vanilla JavaScript     |
| Backend   | Python 3 + Flask                    |
| Database  | SQLite (local)                      |
| Deploy    | Vercel (serverless)                 |

## Project Structure

```text
lead-tracker/
├── api/
│   └── index.py          # Flask app + all API routes
├── static/
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── app.js
├── templates/
│   └── index.html
├── requirements.txt
├── vercel.json
├── .env.example
├── .gitignore
└── README.md
```

## Local Development

### 1. Prerequisites
- Python 3.9+
- pip

### 2. Setup

```bash
cd lead-tracker

# Create virtual environment
python -m venv venv

# Activate (Windows)
venv\Scripts\activate

# Activate (macOS / Linux)
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Run

```bash
# From the lead-tracker directory
python api/index.py
```

Open **http://127.0.0.1:5000** in your browser.

On first run the SQLite database (`leads.db`) is created automatically and seeded with realistic demo leads.

### 4. Environment Variables (optional)

Copy `.env.example` to `.env` if you want to override the database path:

```bash
cp .env.example .env
```

## API Endpoints

| Method | Endpoint              | Description              |
|--------|-----------------------|--------------------------|
| GET    | `/api/leads`          | List leads (supports filters, search, sort) |
| POST   | `/api/leads`          | Create lead              |
| GET    | `/api/leads/<id>`     | Get single lead          |
| PUT    | `/api/leads/<id>`     | Update lead              |
| DELETE | `/api/leads/<id>`     | Delete lead              |
| GET    | `/api/stats`          | Dashboard statistics     |

Query parameters for `GET /api/leads`:
- `status` — New | Contacted | Converted | Lost | All
- `priority` — Hot | Warm | Cold | All
- `search` — free text
- `sort` — attention | newest | oldest | value_high | value_low | followup | priority

## Testing Checklist

After starting the app:

1. **Dashboard** — Total Leads, Overdue, Pipeline Value show real numbers
2. **Add Lead** — fill form, save → appears in list + stats update
3. **Edit Lead** — change status/priority/dates → list & stats refresh
4. **Delete Lead** — confirmation dialog → lead removed
5. **View Lead** — full details modal with notes and computed fields
6. **Search** — type name/phone/source → instant filter
7. **Status filters** — counts update, list filters correctly
8. **Priority filters** — combine with status
9. **Sorting** — switch options, order changes
10. **Overdue** — leads with past follow-up date show red highlight + OVERDUE badge
11. **Days since contact** — calculated automatically
12. **Empty state** — clear all leads (or use filters that return nothing)
13. **Responsive** — resize browser or open on phone

## Vercel Deployment

### Important note about the database

SQLite on Vercel is **ephemeral** (the filesystem is read-only or reset between invocations).  
For a real production deployment you should use a hosted database (Neon, Supabase, Railway Postgres, etc.).

For demos / portfolio the current SQLite setup still works for short sessions.

### Steps to deploy

1. Push the `lead-tracker` folder to a GitHub repository.

2. Go to [vercel.com](https://vercel.com) → **Add New Project** → Import the repository.

3. Configure:
   - **Framework Preset**: Other
   - **Root Directory**: `lead-tracker` (if the repo root is the parent)
   - **Build Command**: leave empty (or `pip install -r requirements.txt`)
   - **Output Directory**: leave empty

4. Add environment variables (optional):
   - `DATABASE_PATH` = `/tmp/leads.db` (recommended on Vercel so the DB lives in writable `/tmp`)

5. Click **Deploy**.

6. After deploy, visit the URL. The first request will create the database and seed demo data.

### Production database (recommended)

To keep data permanently:

1. Create a free Postgres database on [Neon](https://neon.tech) or [Supabase](https://supabase.com).
2. Install an extra dependency: `psycopg2-binary` (or use SQLAlchemy).
3. Replace the SQLite connection logic in `api/index.py` with a Postgres connection using the `DATABASE_URL` environment variable.
4. Add `DATABASE_URL` in the Vercel project settings.

(The current code is deliberately kept simple with SQLite so you can run and demo immediately.)

## Currency Formatting

Deal values are stored as numbers and displayed in Indian format:

- `850000` → ₹8.50L
- `1250000` → ₹12.50L
- `2100000` → ₹21L

## License

MIT — feel free to use and modify for your projects.










# Optional: custom database path (defaults to leads.db in project root)
# DATABASE_PATH=/tmp/leads.db

# For production on Vercel with a hosted Postgres (recommended for persistence):
# DATABASE_URL=postgresql://user:password@host:5432/dbname

# Flask
# FLASK_ENV=production
# PORT=5000


