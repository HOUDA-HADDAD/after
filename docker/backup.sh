#!/bin/sh
# Nightly database dump with rotation.
#
# Runs as a long-lived sidecar rather than a host cron job, so a deployment carries its own
# backups and there is one thing to start rather than two. It dumps immediately on boot as well —
# a backup schedule whose first run is tomorrow is a backup schedule that has never been tested.
#
# Restoring is documented in docs/09-deployment.md. A backup nobody has restored is a hypothesis.

set -eu

HOST="${POSTGRES_HOST:-postgres}"
USER="${POSTGRES_USER:-aftergame}"
DATABASE="${POSTGRES_DB:-aftergame}"
DESTINATION="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"

mkdir -p "$DESTINATION"

dump() {
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  target="$DESTINATION/aftergame-$stamp.sql.gz"

  # Written to a temporary name and moved into place, so a dump interrupted half way through is
  # never mistaken for a complete one.
  if pg_dump --host="$HOST" --username="$USER" --dbname="$DATABASE" --no-owner --no-privileges \
    | gzip -9 > "$target.partial"; then
    mv "$target.partial" "$target"
    echo "[backup] wrote $target ($(wc -c < "$target") bytes)"
  else
    rm -f "$target.partial"
    echo "[backup] FAILED at $stamp" >&2
    return 1
  fi

  # Rotation runs only after a successful dump: a run of failures should not quietly delete the
  # last good backup as well.
  find "$DESTINATION" -name 'aftergame-*.sql.gz' -type f -mtime "+$KEEP_DAYS" -print -delete
}

echo "[backup] every ${INTERVAL}s, keeping ${KEEP_DAYS} days, into $DESTINATION"

while true; do
  dump || echo '[backup] continuing after a failed dump' >&2
  sleep "$INTERVAL"
done
