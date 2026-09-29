#!/usr/bin/env bash
# npm run dev:server: the sync server the dev seed talks to (src/dev/devServer.ts), never the production one.
#
# Runs the Python reference server from ../even-server/python on 127.0.0.1:8787, creating its venv with Homebrew's
# Python 3.14 and installing its pinned requirements the first time. Each start begins with an empty database in
# .dev/sync-server/ (git-ignored); phones that synced with an earlier one re-push their groups, as after any
# server-side delete. Rates are raised so seeds can create many groups from one address; the caps are the public
# server's, so Usage lines read as the boards draw them. It logs what the server logs by default: one line per
# request with the route pattern, never a URL, group id, token or body.
#
# The iOS simulator reaches it at http://127.0.0.1:8787, the Android emulator at http://10.0.2.2:8787. For a phone
# on the local network, start it with EVEN_DEV_SERVER_HOST=0.0.0.0 and add &server=http://<this Mac's address>:8787
# to the seed link. Stop it with Ctrl-C.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="${EVEN_SERVER_DIR:-$ROOT/../even-server/python}"
HOST="${EVEN_DEV_SERVER_HOST:-127.0.0.1}"
PORT=8787
DATA="$ROOT/.dev/sync-server"
VENV="$SERVER_DIR/.venv"

fail() {
  echo "dev:server: $*" >&2
  exit 1
}

[ -f "$SERVER_DIR/requirements.txt" ] ||
  fail "no reference server at $SERVER_DIR (clone even-server next to even-app, or set EVEN_SERVER_DIR)"

if [ ! -x "$VENV/bin/even-server" ]; then
  PYTHON=/opt/homebrew/bin/python3.14
  [ -x "$PYTHON" ] || PYTHON="$(command -v python3.14 || true)"
  [ -n "$PYTHON" ] || fail "Python 3.14 is needed: brew install python@3.14"
  if [ ! -x "$VENV/bin/python" ]; then
    echo "dev:server: creating $VENV with $("$PYTHON" --version)"
    "$PYTHON" -m venv "$VENV"
  fi
  echo "dev:server: installing the server's pinned requirements"
  "$VENV/bin/pip" install --quiet -r "$SERVER_DIR/requirements.txt"
  "$VENV/bin/pip" install --quiet --no-deps -e "$SERVER_DIR"
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  info="$(curl -s --max-time 2 "http://127.0.0.1:$PORT/v1/info" || true)"
  if [[ "$info" == *'"requests_per_minute":100000'* && "$info" == *'"max_group_bytes":2097152'* ]]; then
    echo "dev:server: already running on port $PORT"
    exit 0
  fi
  fail "port $PORT is taken by something else (the worker's npm run dev or dev:test uses it too); stop it first"
fi

mkdir -p "$DATA"
rm -f "$DATA/even.db" "$DATA/even.db-wal" "$DATA/even.db-shm"
echo "dev:server: http://$HOST:$PORT (simulator: 127.0.0.1:$PORT, Android emulator: 10.0.2.2:$PORT), database $DATA/even.db"

unset EVEN_TRUST_PROXY_HEADER EVEN_OPERATOR EVEN_TERMS_URL
export EVEN_DB_PATH="$DATA/even.db" EVEN_HOST="$HOST" EVEN_PORT="$PORT"
export EVEN_MAX_EVENT_BYTES=8192 EVEN_MAX_GROUP_BYTES=2097152 EVEN_MAX_GROUP_EVENTS=10000
export EVEN_MAX_BATCH=25 EVEN_MAX_PAGE=500 EVEN_RETENTION_DAYS=365 EVEN_DAILY_WRITE_BUDGET=0
export EVEN_RATE_REQUESTS_PER_MINUTE=100000 EVEN_RATE_WRITES_PER_MINUTE=100000
export EVEN_RATE_GROUP_CREATES_PER_MINUTE=100000
exec "$VENV/bin/even-server" serve
