# Phase C Authentication (Clerk)

## Frontend
- Added Clerk provider at app root.
- Dashboard route now requires sign-in.
- Frontend API client attaches Clerk bearer token to API requests.

## Backend
- `/dashboard` now requires bearer auth.
- JWTs are verified against Clerk JWKS using:
  - `CLERK_ISSUER` (required)
  - `CLERK_AUDIENCE` (optional)
- Response includes normalized role: `admin` or `viewer`.

## Invite-only
- Enforced via Clerk dashboard configuration (disable public sign-up, send invites).

## Env vars checklist
### Vercel (Frontend)
- `NEXT_PUBLIC_API_BASE_URL=https://<render-service>.onrender.com`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...`

### Render (Backend)
- `BACKEND_CORS_ORIGINS=https://<vercel-app>.vercel.app`
- `SQLITE_PATH=data/sales_dashboard.db` (temporary until Phase D)
- `CLERK_ISSUER=https://boss-trout-33.clerk.accounts.dev`
- `CLERK_AUDIENCE=` (leave blank unless configured)
- `CLERK_SECRET_KEY=sk_...` (optional for now)
