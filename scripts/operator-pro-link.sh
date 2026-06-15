#!/usr/bin/env bash
# スマホで開く運営 Pro 登録 URL を出力（.metrics-admin-token.local から読み取り）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOKEN_FILE="$ROOT/.metrics-admin-token.local"
SITE="${NEXT_PUBLIC_SITE_URL:-https://auto-mobile-camera.vercel.app}"

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "Error: $TOKEN_FILE がありません。" >&2
  echo "  scripts/setup-metrics.sh を実行するか、Vercel の METRICS_ADMIN_TOKEN を手動で設定してください。" >&2
  exit 1
fi

TOKEN="$(grep -E '^ADMIN_TOKEN=' "$TOKEN_FILE" | head -1 | cut -d= -f2- | tr -d '\r\n ')"
if [[ -z "$TOKEN" ]]; then
  echo "Error: ADMIN_TOKEN が $TOKEN_FILE に見つかりません。" >&2
  exit 1
fi

ENCODED="$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$TOKEN")"
URL="${SITE%/}/admin/metrics?token=${ENCODED}&auto=pro"

echo "$URL"
echo ""
echo "↑ スマホの Safari / Chrome に貼って開く → 自動で Pro 登録されます。" >&2
echo "※ ホーム画面の Carkus から撮影する場合は、その Carkus 内の「運営者: Pro設定」から登録してください。" >&2
