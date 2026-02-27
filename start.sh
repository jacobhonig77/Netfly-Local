#!/bin/bash
# IQBAR Dashboard — start both servers locally
cd "$(dirname "$0")"

echo "Starting API server on http://127.0.0.1:8000 ..."
.venv/bin/uvicorn api_server:app --host 127.0.0.1 --port 8000 > logs/api.out.log 2>logs/api.err.log &
API_PID=$!

echo "Starting frontend on http://localhost:3000 ..."
cd frontend
PATH="/usr/local/bin:/bin:/usr/bin:$PATH" /usr/local/bin/node node_modules/.bin/next dev --port 3000 > /tmp/next-dev.log 2>&1 &
NEXT_PID=$!

echo ""
echo "✓ API   → http://127.0.0.1:8000  (pid $API_PID)"
echo "✓ App   → http://localhost:3000  (pid $NEXT_PID)"
echo ""
echo "Press Ctrl+C to stop both."

# Wait and forward Ctrl+C to both
trap "kill $API_PID $NEXT_PID 2>/dev/null; echo 'Stopped.'" INT TERM
wait $API_PID $NEXT_PID
