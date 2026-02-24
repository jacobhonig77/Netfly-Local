# IQBAR Backend (FastAPI)

This service is the only data access layer for the dashboard.

- Frontend (Vercel) calls backend JSON APIs.
- Backend handles auth, imports, processing, and DB reads/writes.
- Database mode is configurable: `sqlite` (local) or `postgres` (Supabase).

## Local run

```bash
cd /Users/jakehonig/Documents/New\ project/backend
source /Users/jakehonig/Documents/New\ project/.venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

## Render start command

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```

## Environment variables

Copy `/Users/jakehonig/Documents/New project/backend/.env.example` to `backend/.env` for local use.

- `BACKEND_CORS_ORIGINS`: allowed frontend origins (comma-separated)
- `DB_BACKEND`: `sqlite` or `postgres`
- `SQLITE_PATH`: local sqlite path if `DB_BACKEND=sqlite`
- `DATABASE_URL`: Postgres URL if `DB_BACKEND=postgres`
- `CLERK_ISSUER`: Clerk issuer URL
- `CLERK_AUDIENCE`: optional audience
- `CLERK_SECRET_KEY`: optional; useful for future Clerk admin APIs
- `ADMIN_USER_IDS`: optional CSV of Clerk user IDs forced to admin
- `ADMIN_EMAILS`: optional CSV of emails forced to admin
- `SUPABASE_URL`: Supabase project URL (for Storage upload)
- `SUPABASE_SERVICE_ROLE_KEY`: service role key (server-side only)
- `SUPABASE_STORAGE_BUCKET`: raw file bucket name (default: `raw-uploads`)
- `SUPABASE_STORAGE_PREFIX`: path prefix in bucket (default: `iqbar`)
- `RAW_UPLOAD_DIR`: local fallback directory for raw files
- `LOG_LEVEL`: logging level (`INFO` default)
- `DASHBOARD_CACHE_TTL_SECONDS`: server cache TTL for `/dashboard` (default `30`)

## Health/readiness

- `GET /health` → process alive
- `GET /ready` → DB connectivity status (`200` if DB ready, `503` if not)

## Core endpoints

- `GET /dashboard`
- `GET /api/meta/date-range`
- `GET /api/goals`
- `POST /api/goals/upsert` (admin)
- `GET /api/settings`
- `POST /api/settings` (admin)
- `GET /api/import/history`
- `GET /api/import/date-coverage`
- `POST /api/import/payments` (admin)
- `DELETE /api/import/payments` (admin)
- `POST /api/import/shopify-line` (admin)
- `POST /api/import/inventory` (admin)
- `POST /api/import/ntb` (admin)
- `POST /api/import/cogs-fees` (admin)

## Phase D migration command (SQLite -> Postgres)

```bash
cd /Users/jakehonig/Documents/New\ project
python3 backend/scripts/migrate_sqlite_to_postgres.py \
  --sqlite data/sales_dashboard.db \
  --database-url "$DATABASE_URL"
```
