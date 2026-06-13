#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "== Carkus metrics setup =="
echo "Project: $PROJECT_DIR"

if ! command -v npx >/dev/null 2>&1; then
  echo "Error: npx is required."
  exit 1
fi

echo ""
echo "1) Checking Vercel login..."
if ! npx vercel whoami >/dev/null 2>&1; then
  echo "You are not logged in. Opening Vercel login..."
  npx vercel login
fi

echo ""
echo "2) Linking this directory to a Vercel project (if needed)..."
npx vercel link >/dev/null

generate_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
}

set_vercel_env() {
  local key="$1"
  local value="$2"
  local env="$3"

  # Remove old value if it exists (ignore errors).
  npx vercel env rm "$key" "$env" --yes >/dev/null 2>&1 || true
  printf "%s" "$value" | npx vercel env add "$key" "$env" >/dev/null
}

echo ""
echo "3) Setting METRICS_ADMIN_TOKEN..."
METRICS_ADMIN_TOKEN="$(generate_token)"
for target in production preview development; do
  set_vercel_env "METRICS_ADMIN_TOKEN" "$METRICS_ADMIN_TOKEN" "$target"
  echo "  - METRICS_ADMIN_TOKEN set for $target"
done

echo ""
echo "4) Syncing KV_REST_API_* from Upstash integration (if present)..."
npx vercel env pull .env.vercel.tmp --environment=production --yes >/dev/null 2>&1 || true
if [[ -f .env.vercel.tmp ]]; then
  KV_URL="$(grep '^KVRESTAPI_KV_REST_API_URL=' .env.vercel.tmp | sed 's/^KVRESTAPI_KV_REST_API_URL=//' | tr -d '"' || true)"
  KV_TOKEN="$(grep '^KVRESTAPI_KV_REST_API_TOKEN=' .env.vercel.tmp | sed 's/^KVRESTAPI_KV_REST_API_TOKEN=//' | tr -d '"' || true)"
  if [[ -n "${KV_URL}" && -n "${KV_TOKEN}" ]]; then
    for target in production preview development; do
      npx vercel env rm KV_REST_API_URL "$target" --yes >/dev/null 2>&1 || true
      npx vercel env rm KV_REST_API_TOKEN "$target" --yes >/dev/null 2>&1 || true
      if [[ "$target" == "preview" ]]; then
        npx vercel env add KV_REST_API_URL preview --value "$KV_URL" --yes >/dev/null 2>&1 || \
          printf "%s" "$KV_URL" | npx vercel env add KV_REST_API_URL preview --yes >/dev/null 2>&1 || true
        npx vercel env add KV_REST_API_TOKEN preview --value "$KV_TOKEN" --yes >/dev/null 2>&1 || \
          printf "%s" "$KV_TOKEN" | npx vercel env add KV_REST_API_TOKEN preview --yes >/dev/null 2>&1 || true
      else
        printf "%s" "$KV_URL" | npx vercel env add KV_REST_API_URL "$target" --yes >/dev/null
        printf "%s" "$KV_TOKEN" | npx vercel env add KV_REST_API_TOKEN "$target" --yes >/dev/null
      fi
      echo "  - KV_REST_API_* synced for $target"
    done
  else
    echo "  - KVRESTAPI_* not found. Run: npx vercel install upstash"
  fi
  rm -f .env.vercel.tmp
fi

echo ""
echo "Done."
echo "METRICS_ADMIN_TOKEN (save securely):"
echo "  $METRICS_ADMIN_TOKEN"
echo ""
echo "Admin dashboard:"
echo "  https://auto-mobile-camera.vercel.app/admin/metrics"
echo ""
echo "Next:"
echo "  1) Deploy: npx vercel --prod"
echo "  2) Preflight check:"
echo "     curl -H \"x-admin-token: $METRICS_ADMIN_TOKEN\" \"https://auto-mobile-camera.vercel.app/api/admin/metrics?preflight=1\""
