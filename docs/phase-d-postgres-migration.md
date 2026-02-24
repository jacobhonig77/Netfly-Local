# Phase D: SQLite -> Postgres (Supabase)

## What this phase implements
- Inspected existing SQLite schema (`data/sales_dashboard.db`).
- Added Postgres schema SQL: `backend/sql/postgres_schema.sql`.
- Added one-time migration script: `backend/scripts/migrate_sqlite_to_postgres.py`.
- Added backend runtime DB mode switch:
  - `DB_BACKEND=sqlite` (current default)
  - `DB_BACKEND=postgres` (uses `DATABASE_URL`)
- Added local Postgres dev compose file: `backend/docker-compose.postgres.yml`.

## Local migration run
```bash
cd /Users/jakehonig/Documents/New\ project
source .venv/bin/activate
pip install -r backend/requirements.txt
python backend/scripts/migrate_sqlite_to_postgres.py \
  --sqlite data/sales_dashboard.db \
  --database-url "$DATABASE_URL"
```

## Runtime switch (local test)
Set in `backend/.env`:
```bash
DB_BACKEND=postgres
DATABASE_URL=postgresql://.../postgres?sslmode=require
```

Then run backend:
```bash
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000
```

## Notes
- Current production stays on sqlite until you explicitly set `DB_BACKEND=postgres` in Render.
- This phase introduces migration + runtime toggle safely; rollout can be done after validation.
