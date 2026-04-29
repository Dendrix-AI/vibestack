---
name: deploy-to-vibestack
description: Package and deploy AI-generated web applications to a self-hosted VibeStack server. Use when a user asks to push, publish, deploy, update, or roll back a web app to VibeStack from Claude Code or another coding agent, especially when the user should not interact with Git, Docker, CI/CD, DNS, or hosting infrastructure directly. Also use when the user asks to update, refresh, or reinstall their VibeStack deployment skill.
---

# Deploy To VibeStack

## Overview

Use this skill to deploy a Docker-compatible web application to VibeStack through its API. The workflow is agent-driven: validate the local project, ensure it has a Dockerfile and `vibestack.json`, package it as a tarball, submit it to VibeStack, then poll until the deployment succeeds or fails.

Creators should not be exposed to Git, Docker, Traefik, Cloudflare, or build-system details unless a deployment error requires a code fix.

## Updating This Skill

If the user asks to update, refresh, or reinstall the VibeStack deployment skill, fetch the latest skill from:

<https://github.com/dankritz/vibestack/tree/main/skills/deploy-to-vibestack>

Update only the installed user-level skill copy, not the current app repository. Preserve user-level VibeStack config and credentials such as `~/.config/vibestack/deploy.json`, `~/.config/vibestack/credentials.json`, `~/.vibestack/deploy.json`, and `~/.vibestack/credentials.json`.

Preferred update flow:

1. Locate the installed skill directory that contains this `SKILL.md`.
2. Download or clone `https://github.com/dankritz/vibestack`.
3. Replace the installed skill directory with `skills/deploy-to-vibestack` from the downloaded repository.
4. Verify the installed copy contains `SKILL.md`, `scripts/vibestack_deploy.py`, `references/api.md`, and `references/manifest.md`.
5. Do not deploy any app as part of a skill update unless the user explicitly asks for deployment afterward.

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

## Storage Policy

VibeStack creators are usually not expected to make infrastructure decisions. If an app needs persistent structured data, use VibeStack-managed Postgres. Do not add or deploy app-owned database containers such as MySQL, MariaDB, MongoDB, Redis, Postgres sidecars, or SQLite databases embedded in the image. Do not hard-code database hosts, users, passwords, or database names.

When the app needs persistent records, user-generated content, task lists, notes, settings, uploaded metadata, sessions, or audit/history data:

- set `postgres` to `true` in `vibestack.json`
- deploy with `--postgres true` or equivalent metadata
- write app code to read the injected `DATABASE_URL`
- initialize required tables idempotently on startup or through app-managed migrations

Use `/data` only for simple file/blob persistence that is intentionally local to the app, such as uploaded files or generated artifacts. If the app stores queryable business data, use VibeStack-managed Postgres instead.

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
4. Decide storage before writing deployment files. If the app needs persistent structured data, enable VibeStack-managed Postgres and use `DATABASE_URL`. Remove unmanaged database services or local embedded database assumptions before deploying.
5. Ensure a Dockerfile exists. If not, create one appropriate for the app stack.
6. Ensure the app's server code explicitly satisfies VibeStack runtime requirements:
   - listens on `0.0.0.0`, not only `localhost` or `127.0.0.1`
   - listens on the same port as `vibestack.json` and Dockerfile `EXPOSE`
   - returns HTTP 2xx at `healthCheckPath`; add a small unauthenticated `/health` route when the app does not already have a reliable route
   - does not redirect the health path to login, require cookies, call external APIs, perform database writes, or depend on browser JavaScript
   - keeps the server process in the foreground as the container command
7. Validate locally:
   - manifest JSON parses
   - manifest has `name`, `port`, `healthCheckPath`, and `persistent`
   - Dockerfile exists at project root
   - Dockerfile `EXPOSE`, if present, matches manifest port
   - when Docker is available, run the helper with `--smoke-test` before uploading so the packaged container is built and the manifest health path is probed through Docker port mapping
8. Package the project as a tarball, excluding local-only and sensitive files.
9. For updates to an existing app, resolve the app ID using saved config, the user's provided ID, or `GET /api/v1/apps`; then submit to `POST /api/v1/apps/{appId}/deployments`. Do not guess the app ID from the app name when more than one app matches.
10. For new apps, submit the tarball and deployment metadata to `POST /api/v1/apps/deploy`.
11. If external-password access is enabled and no password was supplied, let the helper generate one.
12. Poll every 30 seconds until status is terminal.
13. Report the live URL on success.
14. If the helper generated an external app password, relay it to the user exactly once and explain that VibeStack stores only a hash.
15. On failure, use the returned `agentHint`, error code, and details to fix the project and retry when appropriate.

## Runtime Diagnostics

When a deployed app behaves incorrectly after a successful deployment, do not guess from the UI error alone. Fetch VibeStack diagnostics first:

```bash
python3 skills/deploy-to-vibestack/scripts/vibestack_deploy.py \
  --diagnostics \
  --app-id de52380f-282b-44de-a741-17118f331b01
```

If the app ID is not known, pass `--app` and the helper will resolve one accessible app:

```bash
python3 skills/deploy-to-vibestack/scripts/vibestack_deploy.py \
  --diagnostics \
  --app todo-notes
```

Diagnostics include the current deployment, recent deployments, app container logs, and VibeStack-managed Postgres metadata plus matching Postgres log lines. Use them to identify failing routes, uncaught exceptions, database connection problems, missing tables, failed migrations, and hard-coded credentials. If Postgres is enabled, the app must use the injected `DATABASE_URL`; do not hard-code `localhost`, `127.0.0.1`, database names, usernames, or passwords. Do not print secrets or full logs back to the user; summarize the relevant error lines and fix the app code directly.

## Helper Script

Use `scripts/vibestack_deploy.py` when possible:

```bash
python3 skills/deploy-to-vibestack/scripts/vibestack_deploy.py \
  --smoke-test \
  --app sales-dashboard \
  --source .
```

For an update deployment, pass the app ID when known:

```bash
python3 skills/deploy-to-vibestack/scripts/vibestack_deploy.py \
  --smoke-test \
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

The script loads defaults from environment variables and user-level config, performs local validation, optionally smoke-tests the packaged Docker context, creates a tarball, submits it using the VibeStack deployment API, and polls status. If the VibeStack implementation changes, read `references/api.md` and adjust the request shape.

For validation without a live server, add `--dry-run`. For a stronger preflight, combine `--dry-run --smoke-test`.

The smoke test builds the same packaged context that will be uploaded, starts the container with any `--secret KEY=VALUE` environment variables provided to the helper, publishes the manifest port to localhost, and requires the configured health path to return HTTP 2xx without following redirects. If the app needs secrets to start, pass them to the helper before smoke testing. Do not install Node.js, curl, wget, or other tools into the app image solely to satisfy health checks; fix the application route, port, bind address, or startup command instead.

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
- Python virtual environments and caches such as `.venv/`, `venv/`, `env/`, `__pycache__/`, `.pytest_cache/`, `.mypy_cache/`, and `.ruff_cache/`
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
- `HEALTH_CHECK_FAILED`: inspect `details.agentHint`, `details.logExcerpt`, `details.checkedUrl`, `details.port`, and `details.healthCheckPath`; ensure the app binds to `0.0.0.0`, uses the manifest port, keeps running, and returns HTTP success at `healthCheckPath`.
- `MAINTENANCE_MODE_ACTIVE`: stop and tell the user deployments are paused by the platform.
- `TEAM_DEPLOYMENTS_PAUSED`: stop and tell the user deployments are paused for the team.

## Rollback

For rollback requests, call the VibeStack rollback API instead of packaging source. Ask which previous version to use only if the user did not specify and the API cannot infer a default.

## References

- `references/api.md`: deployment API contract expected by this skill.
- `references/manifest.md`: `vibestack.json` schema and examples.
