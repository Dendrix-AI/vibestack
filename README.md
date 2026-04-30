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

## Quickstart Paths

Choose the path that matches what you are trying to do:

- Install VibeStack on a server: [docs/install.md](docs/install.md)
- Configure teams, users, tokens, and platform settings: [docs/admin-guide.md](docs/admin-guide.md)
- Onboard non-technical app creators: [docs/creator-onboarding.md](docs/creator-onboarding.md)
- Deploy a first sample app: [docs/deploy-first-app.md](docs/deploy-first-app.md)
- Operate, upgrade, back up, and restore VibeStack: [docs/operations.md](docs/operations.md)
- Understand branches, versions, and release channels: [docs/release-process.md](docs/release-process.md)

## Deployment Skill

The initial Claude Code companion skill lives in:

- [skills/deploy-to-vibestack/SKILL.md](skills/deploy-to-vibestack/SKILL.md)

It describes how an AI coding agent should prepare a web app for VibeStack, create or validate `vibestack.json`, package the source as a tarball, submit it to the deployment API, and poll for status.

The skill also includes a reference API contract and a helper script:

- [skills/deploy-to-vibestack/references/api.md](skills/deploy-to-vibestack/references/api.md)
- [skills/deploy-to-vibestack/references/manifest.md](skills/deploy-to-vibestack/references/manifest.md)
- [skills/deploy-to-vibestack/scripts/vibestack_deploy.py](skills/deploy-to-vibestack/scripts/vibestack_deploy.py)

## App Creator Workflow

App creators should not need to clone this repository, read deployment docs, or learn Docker. An administrator gives each creator:

- the VibeStack management URL
- the hosted app base domain
- their team slug
- an API token created from VibeStack
- the setup prompt in [docs/creator-onboarding.md](docs/creator-onboarding.md)

After the deployment skill is installed once, the normal creator workflow is:

```text
Deploy this app to VibeStack.
```

## Debian/Ubuntu Server Install

VibeStack includes a Debian/Ubuntu installer that configures Docker, Docker Compose, Traefik, Let's Encrypt, the management host, the app base domain, and the initial platform admin.

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/Dendrix-AI/vibestack.git
cd vibestack

sudo ./scripts/install-linux.sh \
  --domain apps.example.com \
  --host vibestack.example.com \
  --email ops@example.com \
  --admin-email admin@example.com \
  --cloudflare-api-token "$CLOUDFLARE_API_TOKEN" \
  --cloudflare-zone-id "$CLOUDFLARE_ZONE_ID"
```

The Cloudflare token must be able to edit DNS records in the zone used by the hosted app base domain. See [docs/install.md](docs/install.md) for prerequisites, DNS requirements, success checks, and troubleshooting.

## Current Status

This repository is an initial public release. It includes the VibeStack API, worker, web app, shared package, deployment skill, and sample application fixtures. APIs and operational behavior may change before a 1.0 release.

## Contributing

Community contributions are welcome. Normal pull requests target `main`; installed servers track release channels such as `stable`, `beta`, and `nightly`. See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution licensing, CLA, DCO sign-off details, and branch guidance.

## License

VibeStack Community Edition is licensed under the GNU Affero General Public License v3.0 or later. See [LICENSE](LICENSE).
