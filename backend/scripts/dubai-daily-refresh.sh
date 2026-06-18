#!/usr/bin/env bash
# Daily DLD refresh — re-fetch a rolling recent window (NO duplicates) for
# transactions + rent. Fills late-arriving DLD registrations (recent months keep
# filling in for weeks) and adds new days. Dedup-safe: each run stages the fresh
# window, sanity-checks it, then atomically replaces that window in the table.
#
# Run on the UAE-proxied worker via cron, e.g.:
#   30 3 * * *  /opt/pinzos-worker/backend/scripts/dubai-daily-refresh.sh
# Requires .env with DUBAI_API_BASE_URL=https://apis.data.dubai + proxy + creds.
# See docs/dubai-sync-architecture.md.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1   # -> backend/

export DUBAI_API_BASE_URL="${DUBAI_API_BASE_URL:-https://apis.data.dubai}"
FROM=$(date -u -d '45 days ago' +%Y-%m-%d)
TO=$(date -u -d 'tomorrow' +%Y-%m-%d)
mkdir -p logs
LOG="logs/dubai-refresh-$(date -u +%Y-%m-%d).log"

{
  echo "=== $(date -u) daily refresh window ${FROM}..${TO} ==="
  npx ts-node scripts/dubai-refetch-window.ts transactions "$FROM" "$TO"
  npx ts-node scripts/dubai-refetch-window.ts rent "$FROM" "$TO"
  echo "=== $(date -u) done ==="
} >> "$LOG" 2>&1
