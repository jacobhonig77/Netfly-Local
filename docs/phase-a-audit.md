# Phase A Audit (Local Refactor)

## Frontend framework and runtime
- Framework: Next.js 14 (App Router) in `/Users/jakehonig/Documents/New project/next-frontend`.
- Start command: `npm run dev`.
- Build command: `npm run build`.
- Frontend API client: `/Users/jakehonig/Documents/New project/next-frontend/lib/api.js`.

## Python entry points and data dependencies
- Legacy API: `/Users/jakehonig/Documents/New project/api_server.py` (FastAPI).
- New backend wrapper: `/Users/jakehonig/Documents/New project/backend/main.py`.
- Legacy Streamlit apps: `/Users/jakehonig/Documents/New project/app.py`, `/Users/jakehonig/Documents/New project/local_sales_dashboard.py`, `/Users/jakehonig/Documents/New project/keepa_category_app.py`, `/Users/jakehonig/Documents/New project/asin_listing_reviewer.py`.
- SQLite path currently used by backend logic: `/Users/jakehonig/Documents/New project/data/sales_dashboard.db`.
- Upload/data parsing paths are backend-only (`api_server.py`, `local_sales_dashboard.py`) via pandas CSV/XLSX parsing.

## Direct frontend data access audit
- No direct SQLite or local file reads from frontend were found.
- Frontend data access is API-based (`apiGet(...)` and `fetch(...)` to backend endpoints).
- Local browser storage is used for UI state only (`window.localStorage`), not as a data source of record.

## Architecture plan (Phase A)
1. Add a backend service entrypoint under `/backend` with:
   - `GET /health`
   - `GET /dashboard` returning a consolidated payload for dashboard state.
2. Reuse existing analytics functions from `api_server.py` behind `/dashboard`.
3. Update frontend initial/bootstrap and main dashboard loading to use `/dashboard` via API base env var.
4. Keep uploads and other specialized actions routed through backend APIs.

## TODO checklist
- [x] Audit framework, start/build commands, entry points, data dependencies.
- [x] Add `/backend/main.py` FastAPI service with `/health` and `/dashboard`.
- [x] Add `/backend/requirements.txt`.
- [x] Update frontend to load dashboard data from backend `/dashboard`.
- [x] Keep frontend strictly API-driven (no direct DB/file access).
- [ ] Phase B (auth) after approval.
- [ ] Phase C (Postgres migration + storage migration) after approval.
