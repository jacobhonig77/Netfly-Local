# IQBAR Internal Analytics Platform

Team-accessible analytics stack:

- Frontend: Next.js (`/next-frontend`) on Vercel
- Backend: FastAPI (`/backend/main.py`) on Render
- Auth: Clerk (invite-only)
- Database: SQLite (local) or Supabase Postgres (`DB_BACKEND=postgres`)
- Raw uploads: handled by backend only (local fallback or Supabase Storage)

## Architecture Overview

1. Browser authenticates with Clerk.
2. Frontend requests data from backend using bearer token.
3. Backend verifies token + role.
4. Backend reads/writes DB, processes metrics, returns JSON.
5. Import endpoints parse files server-side and persist to DB.

Frontend does **not** read SQLite/files directly.

## Local Development

### Backend
```bash
cd /Users/jakehonig/Documents/New\ project/backend
source /Users/jakehonig/Documents/New\ project/.venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

### Frontend
```bash
cd /Users/jakehonig/Documents/New\ project/next-frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deployment Flow

### Render (backend)
- Root directory: `backend`
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Set env vars from `backend/.env.example`

### Vercel (frontend)
- Root directory: `next-frontend`
- Framework: Next.js
- Env vars:
  - `NEXT_PUBLIC_API_BASE_URL=https://<render-service>.onrender.com`
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...`

## Database Migration (Phase D)

```bash
cd /Users/jakehonig/Documents/New\ project
python3 backend/scripts/migrate_sqlite_to_postgres.py \
  --sqlite data/sales_dashboard.db \
  --database-url "$DATABASE_URL"
```

Then run backend with:
- `DB_BACKEND=postgres`
- `DATABASE_URL=postgresql://...`

## Legacy Apps

Legacy Streamlit apps remain in repository for reference:
- `local_sales_dashboard.py`
- `app.py`
