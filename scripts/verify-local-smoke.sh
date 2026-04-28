#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

npm run test --workspace @vibestack/shared
npm run test --workspace @vibestack/api
python3 -m unittest skills/deploy-to-vibestack/scripts/vibestack_deploy_test.py

python3 skills/deploy-to-vibestack/scripts/vibestack_deploy.py \
  --api-url "${VIBESTACK_API_URL:-https://vibestack.local.test}" \
  --token "${VIBESTACK_TOKEN:-dry-run-token}" \
  --team "${VIBESTACK_TEAM:-dry-run-team}" \
  --source fixtures/sample-apps/node-basic \
  --dry-run

if [[ -n "${VIBESTACK_API_URL:-}" && -n "${VIBESTACK_TOKEN:-}" && -n "${VIBESTACK_TEAM:-}" ]]; then
  python3 skills/deploy-to-vibestack/scripts/vibestack_deploy.py \
    --api-url "$VIBESTACK_API_URL" \
    --token "$VIBESTACK_TOKEN" \
    --team "$VIBESTACK_TEAM" \
    --source fixtures/sample-apps/node-basic \
    --login-access true \
    --external-password false \
    --postgres false
fi
