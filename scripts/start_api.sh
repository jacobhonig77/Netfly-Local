#!/bin/zsh
set -euo pipefail
cd "/Users/jakehonig/Documents/PAYMENTS LOCAL"
source .venv/bin/activate
exec .venv/bin/uvicorn api_server:app --host 127.0.0.1 --port 8000
