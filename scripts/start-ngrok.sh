#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PORT="${PORT:-8787}"
BUILD="${BUILD:-1}"
NGROK_BIN="${NGROK_BIN:-ngrok}"
API_LOG="${API_LOG:-/tmp/clinical-app-api.log}"
NGROK_LOG="${NGROK_LOG:-/tmp/clinical-app-ngrok.log}"

cleanup() {
  if [[ -n "${API_PID:-}" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
  fi
  if [[ -n "${NGROK_PID:-}" ]] && kill -0 "$NGROK_PID" 2>/dev/null; then
    kill "$NGROK_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [[ "$BUILD" != "0" ]]; then
  npm run build
fi

existing_pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [[ -n "$existing_pids" ]]; then
  echo "Stopping existing process on port $PORT: $existing_pids"
  kill $existing_pids
  sleep 1
fi

existing_ngrok_pids="$(pgrep -f "[n]grok http $PORT" || true)"
if [[ -n "$existing_ngrok_pids" ]]; then
  echo "Stopping existing ngrok tunnel for port $PORT: $existing_ngrok_pids"
  kill $existing_ngrok_pids
  sleep 1
fi

export PORT
npm run preview >"$API_LOG" 2>&1 &
API_PID="$!"

for _ in {1..30}; do
  if curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if ! curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
  echo "Server did not become healthy on http://localhost:$PORT"
  echo "API log: $API_LOG"
  exit 1
fi

"$NGROK_BIN" http "$PORT" --log stdout >"$NGROK_LOG" 2>&1 &
NGROK_PID="$!"

public_url=""
for _ in {1..30}; do
  public_url="$(
    node -e '
      fetch("http://127.0.0.1:4040/api/tunnels")
        .then((response) => response.json())
        .then((data) => {
          const tunnel = (data.tunnels || []).find((item) => item.proto === "https") || (data.tunnels || [])[0];
          process.stdout.write(tunnel?.public_url || "");
        })
        .catch(() => {});
    '
  )"
  if [[ -n "$public_url" ]]; then
    break
  fi
  sleep 0.5
done

if [[ -z "$public_url" ]]; then
  echo "ngrok started, but no public URL was reported."
  echo "ngrok log: $NGROK_LOG"
  exit 1
fi

echo "Clinical App Studio local server:"
echo "  http://localhost:$PORT"
echo
echo "Clinical App Studio public ngrok URL:"
echo "  $public_url"
echo
echo "Logs:"
echo "  API:   $API_LOG"
echo "  ngrok: $NGROK_LOG"
echo
echo "Press Ctrl+C to stop both the server and ngrok."

wait "$API_PID" "$NGROK_PID"
