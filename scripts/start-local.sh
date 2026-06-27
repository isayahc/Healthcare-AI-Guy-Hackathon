#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PORT="${PORT:-8787}"
BUILD="${BUILD:-1}"

if [[ "$BUILD" != "0" ]]; then
  npm run build
fi

existing_pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [[ -n "$existing_pids" ]]; then
  echo "Stopping existing process on port $PORT: $existing_pids"
  kill $existing_pids
  sleep 1
fi

export PORT
echo "Clinical App Studio local server:"
echo "  http://localhost:$PORT"
echo
exec npm run preview
