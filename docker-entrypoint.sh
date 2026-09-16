#!/bin/bash
# Starts the API and the Next.js server in one container.
# If either exits, the container exits so Coolify restarts the whole thing.
set -euo pipefail

cd /app/backend

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  echo "[entrypoint] applying database migrations…"
  node dist/db/migrate.js
fi

if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] seeding database…"
  node dist/db/seed.js
fi

echo "[entrypoint] starting API on 127.0.0.1:${PORT:-4000}"
node dist/server.js &
api_pid=$!

cd /app/frontend
echo "[entrypoint] starting web on 0.0.0.0:${WEB_PORT:-3000}"
PORT="${WEB_PORT:-3000}" HOSTNAME=0.0.0.0 node server.js &
web_pid=$!

term() {
  echo "[entrypoint] shutting down"
  kill -TERM "$api_pid" "$web_pid" 2>/dev/null || true
  wait "$api_pid" "$web_pid" 2>/dev/null || true
  exit 0
}
trap term TERM INT

wait -n
code=$?
echo "[entrypoint] a process exited (status ${code}); stopping container"
kill -TERM "$api_pid" "$web_pid" 2>/dev/null || true
exit "$code"
