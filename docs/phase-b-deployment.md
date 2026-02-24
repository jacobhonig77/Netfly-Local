# Phase B Deployment Prep

## Backend (Render)
- Root directory: `backend`
- Build: `pip install -r requirements.txt`
- Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Required env vars:
  - `BACKEND_CORS_ORIGINS=https://<your-vercel-app>.vercel.app`
  - `SQLITE_PATH=data/sales_dashboard.db` (temporary until Postgres migration)

Health checks:
- `GET /health`
- `GET /dashboard?channel=Amazon&preset=MTD&include_data=false`

## Frontend (Vercel)
- Root directory: `next-frontend`
- Build: `npm run build`
- Required env vars:
  - `NEXT_PUBLIC_API_BASE_URL=https://<your-render-backend>.onrender.com`

## Notes
- Frontend reads dashboard data only via backend API.
- SQLite remains temporary for Phase B and will be replaced in Phase D.
