#!/usr/bin/env bash
# Build the production image and prove it actually serves the app.
#
# The one command to run on a machine with Docker before trusting a deploy. It builds the image,
# starts a throwaway PostgreSQL, boots the container against it, and then checks the three things
# that distinguish a working deployment from a green build: readiness (which includes the
# database), the API, and the client at the root.
#
# Everything is torn down afterwards, including on failure.

set -euo pipefail

NETWORK=aftergame-check
DB=aftergame-check-db
APP=aftergame-check-app
PORT="${PORT:-3999}"
PASSWORD=check-only-not-a-secret

cleanup() {
  docker rm -f "$APP" "$DB" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[check] building the image…"
docker build -t aftergame:check .

echo "[check] starting PostgreSQL…"
docker network create "$NETWORK" >/dev/null
docker run -d --name "$DB" --network "$NETWORK" \
  -e POSTGRES_USER=aftergame \
  -e POSTGRES_PASSWORD="$PASSWORD" \
  -e POSTGRES_DB=aftergame \
  -e POSTGRES_INITDB_ARGS='--locale=C --encoding=UTF8' \
  --health-cmd 'pg_isready -U aftergame -d aftergame' \
  --health-interval 3s --health-retries 20 \
  postgres:16-alpine >/dev/null

until [ "$(docker inspect -f '{{.State.Health.Status}}' "$DB")" = healthy ]; do sleep 2; done

echo "[check] booting the app…"
# NODE_ENV=production insists on an https origin, which is correct: TLS is terminated by the proxy
# in front. Nothing here speaks TLS, so the check runs with the same posture the app would have
# behind Caddy, minus the certificate.
docker run -d --name "$APP" --network "$NETWORK" -p "$PORT:3000" \
  -e NODE_ENV=production \
  -e APP_ORIGIN="https://aftergame.example" \
  -e DATABASE_URL="postgresql://aftergame:$PASSWORD@$DB:5432/aftergame" \
  -e SESSION_SECRET="$(head -c 48 /dev/urandom | base64 | tr -d '\n')" \
  -e LOG_LEVEL=warn \
  aftergame:check >/dev/null

for attempt in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/readyz" >/dev/null 2>&1; then break; fi
  if [ "$attempt" = 40 ]; then
    echo "[check] the app never became ready. Logs:" >&2
    docker logs "$APP" >&2
    exit 1
  fi
  sleep 2
done

fail() { echo "[check] FAILED: $1" >&2; docker logs "$APP" >&2; exit 1; }

curl -fsS "http://127.0.0.1:$PORT/readyz" >/dev/null || fail 'readiness'
curl -fsS "http://127.0.0.1:$PORT/api/v1/version" | grep -q aftergame || fail 'the API'
curl -fsS "http://127.0.0.1:$PORT/" | grep -qi '<div id="root"' || fail 'the client at the root'
curl -fsS "http://127.0.0.1:$PORT/groups/anything" | grep -qi '<div id="root"' || fail 'the SPA fallback'

# The image must not be running as root, and the migrations must have actually applied.
[ "$(docker exec "$APP" id -u)" != 0 ] || fail 'the container runs as root'
docker exec "$DB" psql -U aftergame -d aftergame -tAc \
  "select count(*) from information_schema.tables where table_name = 'themes'" | grep -q 1 \
  || fail 'migrations did not apply'

echo "[check] image builds, boots, migrates, and serves both halves — as a non-root user."
