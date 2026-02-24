# Backend (Phase A)

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

## Endpoints
- `GET /health`
- `GET /dashboard`

`/dashboard` supports:
- `channel`, `preset`, `start_date`, `end_date`
- `compare_mode`, `granularity`, `product_line`, `product_tag`
- `w7`, `w30`, `w60`, `w90`, `target_wos`
- forecast assumption params (`recent_weight`, `mom_weight`, etc.)
- `include_data` (for lightweight bootstrap)
