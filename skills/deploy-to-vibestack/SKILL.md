---
name: deploy-to-vibestack
description: Package and deploy AI-generated web applications to a self-hosted VibeStack server. Use when a user asks to push, publish, deploy, update, or roll back a web app to VibeStack from Claude Code or another coding agent, especially when the user should not interact with Git, Docker, CI/CD, DNS, or hosting infrastructure directly.
---

# Deploy To VibeStack

## Overview

Use this skill to deploy a Docker-compatible web application to VibeStack through its API. The workflow is agent-driven: validate the local project, ensure it has a Dockerfile and `vibestack.json`, package it as a tarball, submit it to VibeStack, then poll until the deployment succeeds or fails.

Creators should not be exposed to Git, Docker, Traefik, Cloudflare, or build-system details unless a deployment error requires a code fix.

## Required Inputs

Before deploying, load saved defaults. Check these sources before asking the user:

- Environment variables:
  - `VIBESTACK_API_URL` or `VIBESTACK_URL`
  - `VIBESTACK_TEAM`
  - `VIBESTACK_TOKEN`
  - `VIBESTACK_LOGIN_ACCESS`
  - `VIBESTACK_EXTERNAL_PASSWORD`
  - `VIBESTACK_POSTGRES`
- User config files:
  - `~/.config/vibestack/deploy.json`
  - `~/.vibestack/deploy.json`
- User credential files:
  - `~/.config/vibestack/credentials.json`
  - `~/.vibestack/credentials.json`

Only ask for values that are missing or app-specific. For a normal deployment, determine:

- VibeStack API base URL.
- Personal API token.
- Team ID or team slug. Use the user's default team if the server supports it and the user does not specify one.
- App name. Infer it from `vibestack.json`, `package.json`, or the project directory when possible; ask only if ambiguous.
- Whether this is a new app, update, or rollback. For an update, resolve the existing app ID before submitting source.
- Access mode, using saved defaults when available:
  - logged-in VibeStack users
  - external app password
  - both
- Whether the app needs Postgres, using saved defaults when available.
- Any required secrets.

Never print API tokens or secret values. If external-password access is enabled and the helper generates a new app password, show that password to the user exactly once after deployment succeeds and tell them to save it.

Suggested user-level config:

```json
{
  "apiUrl": "https://vibestack.example.com",
  "baseDomain": "apps.example.com",
  "team": "platform-admins",
  "loginAccess": true,
  "externalPassword": false,
  "postgres": false
}
```

Suggested user-level credentials:

```json
{
  "token": "vstk_..."
}
```

Credentials files must be user-readable only, for example mode `0600`. Never write these files inside an app repository.

## Project Requirements

The project root must contain:

- `Dockerfile`
- `vibestack.json`

If either is missing or invalid, fix the project before deploying. Do not ask the user to manually edit hosting details unless the missing information is genuinely ambiguous.

Read `references/manifest.md` for the manifest contract.

## Deployment Workflow

1. Inspect the project and identify the app type.
2. Ensure the app is web-accessible over HTTP.
3. Create or update `vibestack.json` if the user's project clearly indicates the correct app name, internal port, and health check path.
4. Ensure a Dockerfile exists. If not, create one appropriate for the app stack.
5. Validate locally:
   - manifest JSON parses
   - manifest has `name`, `port`, `healthCheckPath`, and `persistent`
   - Dockerfile exists at project root
   - Dockerfile `EXPOSE`, if present, matches manifest port
6. Package the project as a tarball, excluding local-only and sensitive files.
7. For updates to an existing app, resolve the app ID using saved config, the user's provided ID, or `GET /api/v1/apps`; then submit to `POST /api/v1/apps/{appId}/deployments`. Do not guess the app ID from the app name when more than one app matches.
8. For new apps, submit the tarball and deployment metadata to `POST /api/v1/apps/deploy`.
9. If external-password access is enabled and no password was supplied, let the helper generate one.
10. Poll every 30 seconds until status is terminal.
11. Report the live URL on success.
12. If the helper generated an external app password, relay it to the user exactly once and explain that VibeStack stores only a hash.
13. On failure, use the returned `agentHint`, error code, and details to fix the project and retry when appropriate.

## Helper Script

Use `scripts/vibestack_deploy.py` when possible:

```bash
python3 skills/deploy-to-vibestack/scripts/vibestack_deploy.py \
  --app sales-dashboard \
  --source .
```

For an update deployment, pass the app ID when known:

```bash
python3 skills/deploy-to-vibestack/scripts/vibestack_deploy.py \
  --app-id de52380f-282b-44de-a741-17118f331b01 \
  --source .
```

If the user asks to update an existing app but only gives the name, use `--update`; the helper lists accessible apps and resolves a single unambiguous match:

```bash
python3 skills/deploy-to-vibestack/scripts/vibestack_deploy.py \
  --update \
  --app sales-dashboard \
  --source .
```

The script loads defaults from environment variables and user-level config, performs local validation, creates a tarball, submits it using the VibeStack deployment API, and polls status. If the VibeStack implementation changes, read `references/api.md` and adjust the request shape.

For validation without a live server, add `--dry-run`.

## Local Packaging Rules

Exclude by default:

- `.git/`
- `node_modules/`
- `.env`
- `.env.*`
- `dist/`
- `build/`
- `.next/`
- `.turbo/`
- `.cache/`
- coverage output
- OS/editor files

Do not include local credentials, API tokens, downloaded dependencies, or build artifacts unless the app explicitly requires a checked-in static build.

## Failure Handling

When VibeStack returns a deployment error:

- Preserve the stable error code in your response to the user.
- Prefer fixing project files directly when the fix is clear.
- Retry only after a concrete fix.
- Do not repeatedly resubmit the same broken artifact.

Common fix patterns:

- `MISSING_DOCKERFILE`: create a Dockerfile.
- `MISSING_MANIFEST`: create `vibestack.json`.
- `INVALID_MANIFEST`: repair manifest JSON and required fields.
- `PORT_MISMATCH`: align Dockerfile `EXPOSE`, app server port, and manifest `port`.
- `HEALTH_CHECK_FAILED`: ensure the app binds to `0.0.0.0`, uses the manifest port, and returns HTTP success at `healthCheckPath`.
- `MAINTENANCE_MODE_ACTIVE`: stop and tell the user deployments are paused by the platform.
- `TEAM_DEPLOYMENTS_PAUSED`: stop and tell the user deployments are paused for the team.

## Rollback

For rollback requests, call the VibeStack rollback API instead of packaging source. Ask which previous version to use only if the user did not specify and the API cannot infer a default.

## References

- `references/api.md`: deployment API contract expected by this skill.
- `references/manifest.md`: `vibestack.json` schema and examples.
