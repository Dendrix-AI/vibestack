# VibeStack

VibeStack is an open-source, self-hosted platform for hosting AI-generated web applications created by non-technical users. It gives internal teams a controlled place to deploy "vibe coded" apps without exposing creators to Git, Docker, CI/CD, reverse proxies, DNS, or infrastructure.

The platform is designed for companies that want to encourage AI-assisted app creation while keeping deployments centralized, authenticated, auditable, and manageable.

## Core Concept

A non-technical creator builds a web app with an AI coding tool, then asks the tool to "push this to VibeStack." A companion deployment skill packages the project, sends it to the VibeStack API, and polls until deployment completes. VibeStack stores the source in an internal bare Git repository, builds a Docker image, runs the app on a single Docker host, routes traffic through Traefik, provisions a Cloudflare-backed subdomain, and protects the app with VibeStack-managed authentication.

Creators never need to see Git, Docker, Traefik, CI/CD, image registries, or DNS.

## Version 1 Scope

VibeStack v1 targets a single-host Docker Compose installation with:

- Email/password login.
- Platform admins, team admins, creators, and viewers.
- Teams with default-team support.
- Team-owned apps with creator and last-updater attribution.
- Tarball-based deployments through a public API.
- Internal bare Git repositories managed by VibeStack.
- Dockerfile and `vibestack.json` validation.
- Docker BuildKit builds.
- Local Docker images only.
- Traefik routing by managed subdomain.
- Cloudflare DNS provisioning.
- VibeStack-managed app access control.
- Logged-in user access and/or one external password per app.
- App lifecycle controls: deploy, update, start, stop, delete, rollback.
- Latest version plus two previous versions available for rollback.
- App logs, deployment history, audit logs, and lifecycle events.
- App secrets as environment variables, never revealed after creation.
- Optional Postgres per app, using separate databases in the same Postgres server as VibeStack metadata.
- Persistent app volumes.
- Maintenance mode and admin-configurable announcement banner.
- OpenAPI-first API design.

## Deployment Skill

The initial Claude Code companion skill lives in:

- [skills/deploy-to-vibestack/SKILL.md](skills/deploy-to-vibestack/SKILL.md)

It describes how an AI coding agent should prepare a web app for VibeStack, create or validate `vibestack.json`, package the source as a tarball, submit it to the deployment API, and poll for status.

The skill also includes a reference API contract and a helper script:

- [skills/deploy-to-vibestack/references/api.md](skills/deploy-to-vibestack/references/api.md)
- [skills/deploy-to-vibestack/references/manifest.md](skills/deploy-to-vibestack/references/manifest.md)
- [skills/deploy-to-vibestack/scripts/vibestack_deploy.py](skills/deploy-to-vibestack/scripts/vibestack_deploy.py)

## App Creator Onboarding

App creators should not need to clone this repository, read deployment docs, or learn Docker. Give them the VibeStack hostname, hosted app base domain, their team slug, and instructions for creating a personal API token in VibeStack. Then they can paste this prompt into Claude Code once to install the reusable deployment skill:

```text
I want you to install the reusable VibeStack deployment skill in Claude Code.

First, ask me for:
- My VibeStack hostname, for example https://vibestack.example.com
- My hosted app base domain, for example apps.example.com
- My default VibeStack team name or team slug
- Whether future apps should default to VibeStack login access, external-password access, or both
- Whether future apps should default to no database unless I explicitly ask for Postgres
- Whether I already have a VibeStack API token

Do not ask for an app name yet. This skill should be reusable for many different apps. Only ask for an app name later when I explicitly deploy a specific app.

If I provide an API token, do not print it back to me. Do not commit it. Do not store it in any app repository. If Claude Code has a secure local user-level secrets mechanism, use that; otherwise tell me that you will ask for the token at deployment time.

Then install the VibeStack deployment skill for Claude Code:
1. Fetch https://github.com/Dendrix-AI/vibestack
2. Copy the repository folder `skills/deploy-to-vibestack` into the local Claude Code skills directory as `deploy-to-vibestack`.
3. If you are not sure where Claude Code skills are installed on this machine, inspect the local Claude Code configuration and ask me before writing files.
4. Verify that the installed skill contains `SKILL.md`, `scripts/vibestack_deploy.py`, `references/api.md`, and `references/manifest.md`.

After the skill is installed:
1. Create `~/.config/vibestack/deploy.json` with my VibeStack hostname, hosted app base domain, default team, and access defaults. Use this shape:
   `{"apiUrl":"https://vibestack.example.com","baseDomain":"apps.example.com","team":"team-slug","loginAccess":true,"externalPassword":false,"postgres":false}`
2. If I provide an API token and there is no better secure secrets store, create `~/.config/vibestack/credentials.json` with this shape:
   `{"token":"vstk_..."}`
3. Set both files to user-readable only, for example mode `0600`.
4. Do not write either file inside any app repository.
5. Explain how I can deploy any future app by opening that app in Claude Code and saying: "Deploy this app to VibeStack."
6. Do not deploy the current app unless I explicitly ask you to.
```

Administrators should give creators a team slug rather than a database ID when possible. The default bootstrap team is usually `platform-admins`, but production teams should be created per group or department.

## Debian/Ubuntu Server Install

VibeStack includes a Debian/Ubuntu installer that configures Docker, Docker Compose, Traefik, Let's Encrypt, the management host, the app base domain, and the initial platform admin.

```bash
sudo ./scripts/install-linux.sh \
  --domain apps.example.com \
  --host vibestack.example.com \
  --email ops@example.com \
  --admin-email admin@example.com \
  --cloudflare-api-token "$CLOUDFLARE_API_TOKEN" \
  --cloudflare-zone-id "$CLOUDFLARE_ZONE_ID"
```

The Cloudflare token must be able to edit DNS records in the zone used by the hosted app base domain. The installer points the management host, Traefik dashboard host, and hosted-app wildcard at the server, writes `/opt/vibestack/.env`, stores Traefik dashboard basic auth in `/opt/vibestack/secrets`, exposes only ports 80 and 443, redirects HTTP to HTTPS, and routes deployed apps through Traefik's HTTPS entrypoint with Let's Encrypt certificates.

## Current Status

This repository is an initial public release. It includes the VibeStack API, worker, web app, shared package, deployment skill, and sample application fixtures. APIs and operational behavior may change before a 1.0 release.

## Contributing

Community contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution licensing, CLA, and DCO sign-off details.

## License

VibeStack Community Edition is licensed under the GNU Affero General Public License v3.0 or later. See [LICENSE](LICENSE).
