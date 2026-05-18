#!/usr/bin/env bash
# 本机探测：挂上任意「UAE 出口」VPN(系统级全局)后跑这个，
# 直接判定能否用这条出口刷新 DLD 数据。不建任何云资源、零成本。
# 用法：bash backend/scripts/probe-local.sh
set -uo pipefail
TXN_URL="https://www.dubaipulse.gov.ae/dataset/3b25a6f5-9077-49d7-8a1e-bc6d5dea88fd/resource/a37511b0-ea36-485d-bccd-2d6cb24507e7/download/transactions.csv"

echo "[1] 出口 IP / 地理位置（确认 VPN 确实是 UAE 出口）"
IPJSON=$(curl -s --max-time 15 https://ipinfo.io/json 2>/dev/null || echo '{}')
echo "    $(echo "$IPJSON" | tr -d '\n' | sed 's/[{}\"]//g' | cut -c1-200)"
echo "    → country 必须是 AE，否则你连的不是 UAE 出口，后面没意义"

echo ""
echo "[2] dubaipulse 主站可达性"
ROOT=$(curl -s -o /dev/null -w '%{http_code} (%{time_total}s)' --max-time 30 -A 'Mozilla/5.0' https://www.dubaipulse.gov.ae/ 2>/dev/null || echo "000")
echo "    https://www.dubaipulse.gov.ae/ → $ROOT"

echo ""
echo "[3] transactions.csv 能否下载（取头部 2MB）+ 最新日期"
TMP="$(mktemp 2>/dev/null || echo ./_probe_head.csv)"
CODE=$(curl -s -o "$TMP" -w '%{http_code}' --max-time 90 -r 0-2000000 -A 'Mozilla/5.0' "$TXN_URL" 2>/dev/null || echo 000)
echo "    csv http = $CODE   size = $(wc -c < "$TMP" 2>/dev/null || echo 0) bytes"
if [ "$CODE" = "200" ] || [ "$CODE" = "206" ]; then
  echo "    表头: $(head -1 "$TMP" | tr -d '\r' | cut -c1-160)"
  # 找日期列里最大的年份月份（粗判数据是否比 2026-02 新）
  MAXD=$(grep -oE '20[0-9]{2}-[0-9]{2}-[0-9]{2}' "$TMP" 2>/dev/null | sort | tail -1)
  echo "    样本中最大日期(头部2MB,粗估): ${MAXD:-未识别}"
  echo ""
  echo "==> RESULT: REACHABLE ✅  这条 UAE 出口可用，可直接跑 import:analytics 刷新数据"
else
  echo ""
  echo "==> RESULT: NOT REACHABLE ❌ (http=$CODE)  这个出口连不上 dubaipulse"
  echo "    可能：该 VPN 不是真 UAE 出口 / 是被封的数据中心段 / 该家不行 —— 换一个再测"
fi
rm -f "$TMP" 2>/dev/null || true
