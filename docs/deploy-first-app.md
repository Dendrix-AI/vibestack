# Deploy Your First App

This guide verifies that a new VibeStack installation can deploy and route an app.

## Before You Start

You need:

- A running VibeStack server.
- A VibeStack API token.
- A team slug.
- Python 3 on the machine running the deploy helper.
- Docker if you want to run the helper's local `--smoke-test`.

Set local environment variables:

```bash
export VIBESTACK_API_URL="https://vibestack.example.com"
export VIBESTACK_TEAM="platform-admins"
export VIBESTACK_TOKEN="vstk_replace_this"
```

## Dry Run The Sample App

From a VibeStack repository checkout:

```bash
python3 skills/deploy-to-vibestack/scripts/vibestack_deploy.py \
  --source fixtures/sample-apps/node-basic \
  --dry-run
```

This validates packaging without contacting the server.

## Optional Local Smoke Test

If Docker is available locally:

```bash
python3 skills/deploy-to-vibestack/scripts/vibestack_deploy.py \
  --source fixtures/sample-apps/node-basic \
  --dry-run \
  --smoke-test
```

This builds the packaged app container and verifies the configured health path before upload.

## Deploy To VibeStack

Deploy the sample app:

```bash
python3 skills/deploy-to-vibestack/scripts/vibestack_deploy.py \
  --source fixtures/sample-apps/node-basic \
  --login-access true \
  --external-password false \
  --postgres false
```

The helper prints the deployment status and final app URL when deployment succeeds.

## Verify In The UI

In the VibeStack management UI:

1. Open Apps.
2. Confirm the sample app is listed as running.
3. Open the app URL.
4. Check the deployment history and logs.

## Deploy From Claude Code

After a creator has installed the deployment skill, they should be able to open an app project and say:

```text
Deploy this app to VibeStack.
```

For apps that need persistent structured data:

```text
Deploy this app to VibeStack with Postgres enabled.
```

## Common First-App Failures

If deployment fails with a health check error, the app usually is not listening on the manifest port, is binding to `127.0.0.1` instead of `0.0.0.0`, exits after startup, or protects the health route behind login.

If deployment succeeds but the URL does not load, check DNS, Traefik logs, and whether the app hostname exists in the VibeStack UI.

If the app needs secrets, pass them during deployment or add them in the VibeStack UI before retrying.
