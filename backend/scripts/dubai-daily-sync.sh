#!/usr/bin/env bash
# Daily incremental sync of data.dubai → Postgres.
# Runs on the German worker (routes API via UAE proxy) OR on the UAE box directly.
# Requires backend/.env with DUBAI_API_* (+ DUBAI_API_PROXY_URL if on German worker) + DB_* + R2_*.
#
# Install (German worker), once a day at 03:30 UTC:
#   crontab -e
#   30 3 * * *  /path/to/backend/scripts/dubai-daily-sync.sh
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p logs
LOG="logs/dubai-sync-$(date -u +%F).log"

{
  echo "===== $(date -u +'%F %T') UTC  dubai sync start ====="
  npx ts-node src/sync/dubai/cli.ts sync-all --incremental
  # Refresh derived matviews (net yield + apartment invest summary) so the map
  # endpoint and the find-home calculator serve fresh, fast data.
  npx ts-node scripts/refresh-derived.ts
  echo "===== $(date -u +'%F %T') UTC  done ====="
} >> "$LOG" 2>&1

# Surface failures via exit code (cron mail / monitoring picks it up).
tail -n 3 "$LOG"
