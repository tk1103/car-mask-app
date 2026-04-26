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
read -r -p "Do you also want to set KV_REST_API_URL / KV_REST_API_TOKEN now? (y/N): " SET_KV
if [[ "${SET_KV,,}" == "y" ]]; then
  read -r -p "KV_REST_API_URL: " KV_REST_API_URL
  read -r -p "KV_REST_API_TOKEN: " KV_REST_API_TOKEN

  if [[ -n "${KV_REST_API_URL}" && -n "${KV_REST_API_TOKEN}" ]]; then
    for target in production preview development; do
      set_vercel_env "KV_REST_API_URL" "$KV_REST_API_URL" "$target"
      set_vercel_env "KV_REST_API_TOKEN" "$KV_REST_API_TOKEN" "$target"
      echo "  - KV vars set for $target"
    done
  else
    echo "  - KV values were empty, skipped."
  fi
fi

echo ""
echo "Done."
echo "Next:"
echo "  1) Deploy: npx vercel --prod"
echo "  2) Check metrics API:"
echo "     curl -H \"x-admin-token: $METRICS_ADMIN_TOKEN\" \"https://<your-domain>/api/admin/metrics\""
