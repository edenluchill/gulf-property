#!/usr/bin/env bash
# Re-fetch a dataset month-by-month (robust to proxy/network blips — each month is
# an independent atomic staging-swap; a failure costs only that month, re-runnable).
#   bash scripts/dubai-refetch-months.sh <transactions|rent> <YYYY-MM first> <count>
cd "$(dirname "$0")/.." || exit 1
export DUBAI_API_BASE_URL="${DUBAI_API_BASE_URL:-https://apis.data.dubai}"
ds="$1"; first="$2"; n="$3"
ok=0; fail=""
for i in $(seq 0 $((n - 1))); do
  from=$(date -u -d "${first}-01 +${i} month" +%Y-%m-01)
  to=$(date -u -d "${first}-01 +$((i + 1)) month -1 day" +%Y-%m-%d)
  echo "=== [$ds] month ${from} .. ${to} ==="
  if npx ts-node scripts/dubai-refetch-window.ts "$ds" "$from" "$to"; then
    ok=$((ok + 1))
  else
    fail="${fail} ${from}"
  fi
done
echo "DONE [$ds] ok=${ok} failed:${fail:-none}"
