#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.ci.yml)
LOGIN_HEADERS="$(mktemp)"
DEPLOY_LOG="$(mktemp)"
APP_ID=""
DEPLOYMENT_ID=""

cleanup() {
  set +e
  if [[ -n "$APP_ID" ]]; then
    docker ps -aq --filter "label=com.vibestack.app_id=${APP_ID}" | xargs -r docker rm -f >/dev/null 2>&1
    docker images --format '{{.Repository}}:{{.Tag}}' "vibestack/app-${APP_ID}" | xargs -r docker image rm -f >/dev/null 2>&1
  fi
  rm -f "$LOGIN_HEADERS" "$DEPLOY_LOG"
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1
}
trap cleanup EXIT

export VIBESTACK_INSTALL_DIR="$ROOT"
export POSTGRES_PASSWORD="vibestack-ci-password"
export VIBESTACK_HOST="vibestack.localhost"
export VIBESTACK_PUBLIC_URL="https://vibestack.localhost:8443"
export VIBESTACK_BASE_DOMAIN="apps.localhost"
export VIBESTACK_SESSION_SECRET="ci-session-secret-with-enough-length"
export VIBESTACK_SECRET_KEY="ci-secret-key-with-enough-length"
export TRAEFIK_DASHBOARD_HOST="traefik.localhost"
export LETSENCRYPT_EMAIL="ci@example.com"
export FIRST_ADMIN_EMAIL="admin@example.com"
export FIRST_ADMIN_PASSWORD="vibestack-ci-password"
export CLOUDFLARE_API_TOKEN="unused"
export CLOUDFLARE_ZONE_ID="unused"
export CLOUDFLARE_TARGET_HOSTNAME="unused"

wait_for_url() {
  local url="$1"
  local description="$2"
  local extra_args=("${@:3}")
  local deadline=$((SECONDS + 120))
  until curl -fsS ${extra_args+"${extra_args[@]}"} "$url" >/dev/null; do
    if (( SECONDS >= deadline )); then
      echo "Timed out waiting for ${description}: ${url}" >&2
      "${COMPOSE[@]}" ps >&2 || true
      "${COMPOSE[@]}" logs --tail=120 api worker traefik >&2 || true
      return 1
    fi
    sleep 2
  done
}

json_field() {
  local expression="$1"
  node -e '
const fs = require("node:fs");
const input = fs.readFileSync(0, "utf8");
const data = JSON.parse(input);
const value = Function("data", `return ${process.argv[1]}`)(data);
if (value === undefined || value === null || value === "") process.exit(1);
process.stdout.write(String(value));
' "$expression"
}

echo "Building and starting VibeStack CI stack"
"${COMPOSE[@]}" up -d --build

wait_for_url "http://127.0.0.1:3000/api/v1/health" "API health"
wait_for_url \
  "https://vibestack.localhost:8443/" \
  "web through Traefik" \
  -k --resolve "vibestack.localhost:8443:127.0.0.1"
wait_for_url \
  "https://vibestack.localhost:8443/api/v1/health" \
  "API through Traefik" \
  -k --resolve "vibestack.localhost:8443:127.0.0.1"

echo "Creating session and deployment token"
curl -fsS -k \
  -D "$LOGIN_HEADERS" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"vibestack-ci-password"}' \
  "http://127.0.0.1:3000/api/v1/auth/login" >/dev/null

SESSION_COOKIE="$(awk -F '[=;]' 'tolower($0) ~ /^set-cookie: vibestack_session=/ { print $2; exit }' "$LOGIN_HEADERS")"
if [[ -z "$SESSION_COOKIE" ]]; then
  echo "Login did not produce a vibestack_session cookie." >&2
  exit 1
fi

TOKEN_JSON="$(
  curl -fsS \
    -H "Cookie: vibestack_session=${SESSION_COOKIE}" \
    -H "Content-Type: application/json" \
    -d '{"name":"ci-full-stack-smoke"}' \
    "http://127.0.0.1:3000/api/v1/tokens"
)"
TOKEN="$(printf '%s' "$TOKEN_JSON" | json_field 'data.token.value')"

curl -fsS \
  -X PATCH \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"cloudflare":{"enabled":false}}' \
  "http://127.0.0.1:3000/api/v1/settings" >/dev/null

echo "Deploying sample app through VibeStack API and worker"
python3 skills/deploy-to-vibestack/scripts/vibestack_deploy.py \
  --api-url "http://127.0.0.1:3000" \
  --token "$TOKEN" \
  --team "platform-admins" \
  --source fixtures/sample-apps/node-basic \
  --login-access true \
  --external-password false \
  --postgres false \
  --timeout 180 \
  --poll-interval 2 | tee "$DEPLOY_LOG"

DEPLOYMENT_ID="$(awk '/Deployment started:/ { print $3; exit }' "$DEPLOY_LOG")"
if [[ -z "$DEPLOYMENT_ID" ]]; then
  echo "Deployment helper did not print a deployment id." >&2
  exit 1
fi

DEPLOYMENT_JSON="$(curl -fsS -H "Authorization: Bearer ${TOKEN}" "http://127.0.0.1:3000/api/v1/deployments/${DEPLOYMENT_ID}")"
APP_ID="$(printf '%s' "$DEPLOYMENT_JSON" | json_field 'data.appId')"
APP_URL="$(printf '%s' "$DEPLOYMENT_JSON" | json_field 'data.app.url || data.url')"
APP_HOST="${APP_URL#https://}"
APP_HOST="${APP_HOST#http://}"
APP_HOST="${APP_HOST%%/*}"

echo "Verifying deployed app through Traefik at ${APP_HOST}"
APP_RESPONSE="$(
  curl -fsS -k \
    --resolve "${APP_HOST}:8443:127.0.0.1" \
    -H "Cookie: vibestack_session=${SESSION_COOKIE}" \
    "https://${APP_HOST}:8443/"
)"
printf '%s' "$APP_RESPONSE" | json_field 'data.ok' >/dev/null
printf '%s' "$APP_RESPONSE" | json_field 'data.app' | grep -qx 'vibestack-node-basic'

echo "Verifying deployment history and logs endpoints"
curl -fsS -H "Authorization: Bearer ${TOKEN}" "http://127.0.0.1:3000/api/v1/apps/${APP_ID}/deployments" | json_field 'data.deployments.length' >/dev/null
curl -fsS -H "Authorization: Bearer ${TOKEN}" "http://127.0.0.1:3000/api/v1/apps/${APP_ID}/logs?tail=50" | json_field 'data.logs.length' >/dev/null

echo "Full-stack smoke test passed"
