# Backend (Phase B-ready)

## Local run
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

## Render run command
```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```

## Environment variables
Copy `/Users/jakehonig/Documents/New project/backend/.env.example` to `.env` for local development.

- `PORT` (default `8000`)
- `BACKEND_CORS_ORIGINS` (default `*`)
- `DB_BACKEND` (`sqlite` default, or `postgres`)
- `SQLITE_PATH` (default `data/sales_dashboard.db`, used in sqlite mode)
- `DATABASE_URL` (required in postgres mode)
- `CLERK_ISSUER` (required in Phase C)
- `CLERK_AUDIENCE` (optional)
- `CLERK_SECRET_KEY` (optional, not required for JWT verification flow)

## Render deployment (backend)
1. Create a new Web Service in Render from the GitHub repo.
2. Root directory: `backend`
3. Build command:
   - `pip install -r requirements.txt`
4. Start command:
   - `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Set env vars in Render:
   - `BACKEND_CORS_ORIGINS=https://<your-vercel-app>.vercel.app`
   - `DB_BACKEND=sqlite` (current production mode)
   - `SQLITE_PATH=data/sales_dashboard.db`
6. Verify:
   - `GET /health` returns `{"ok": true}`
   - `GET /dashboard?...` returns JSON

## Phase D migration commands (SQLite -> Postgres)
1. Ensure `DATABASE_URL` is set in your shell or `backend/.env`.
2. Apply schema + migrate data:
   ```bash
   cd /Users/jakehonig/Documents/New\ project
   python3 backend/scripts/migrate_sqlite_to_postgres.py \
     --sqlite data/sales_dashboard.db \
     --database-url "$DATABASE_URL"
   ```
3. Switch runtime to postgres (local test):
   - `DB_BACKEND=postgres`
   - `DATABASE_URL=postgresql://...`

## Endpoints
- `GET /health`
- `GET /dashboard`

In Phase C, `/dashboard` requires a valid Clerk bearer token.

`/dashboard` supports:
- `channel`, `preset`, `start_date`, `end_date`
- `compare_mode`, `granularity`, `product_line`, `product_tag`
- `w7`, `w30`, `w60`, `w90`, `target_wos`
- forecast assumption params (`recent_weight`, `mom_weight`, etc.)
- `include_data` (for lightweight bootstrap)
