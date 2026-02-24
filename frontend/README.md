# Frontend (Next.js / Vercel)

## Local run
```bash
cd next-frontend
cp .env.local.example .env.local
npm install
npm run dev
```

`/Users/jakehonig/Documents/New project/next-frontend/.env.local`:
```bash
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxx
```

## Vercel deployment (frontend)
1. Import this repo into Vercel.
2. Set project root to `next-frontend`.
3. Build command: `npm run build`.
4. Output: default Next.js output.
5. Set environment variable in Vercel:
   - `NEXT_PUBLIC_API_BASE_URL=https://<your-render-backend>.onrender.com`
6. Deploy and verify page loads dashboard data from backend API.

## API contract
Frontend only calls backend APIs and does not read local files or SQLite directly.
Primary aggregated endpoint:
- `GET /dashboard`

In Phase C, dashboard page requires Clerk login.
