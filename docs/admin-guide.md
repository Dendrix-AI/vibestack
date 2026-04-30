# Admin Guide

This guide is for platform admins running VibeStack for app creators.

## Admin Responsibilities

Platform admins own:

- Server installation and upgrades.
- Cloudflare DNS configuration.
- Team creation.
- User creation and deactivation.
- API token policy.
- Maintenance mode and platform announcements.
- Operational checks when deployments fail.

Creators should not need to understand Docker, Traefik, DNS, Git, or CI/CD.

## Initial Setup Checklist

After installing VibeStack:

1. Log in at the management URL.
2. Create one team per department, project group, or access boundary.
3. Create creator accounts and assign them to the right teams.
4. Create viewer accounts for people who only need to use deployed apps.
5. Confirm the hosted app base domain and Cloudflare settings.
6. Decide the default access mode for new apps.
7. Send creators the onboarding instructions from [creator-onboarding.md](creator-onboarding.md).

Use readable team slugs such as `finance`, `ops`, or `people-team`. Creators and deployment agents can use slugs without seeing internal database IDs.

## User Roles

VibeStack supports:

- Platform admins: manage platform settings, teams, users, apps, and operational controls.
- Team admins: manage team-level app activity where supported.
- Creators: deploy and update apps for their team.
- Viewers: access apps they are allowed to use.

Use platform admin access sparingly. Most people should be creators or viewers.

## API Tokens

Creators need a personal API token for the deployment skill.

Recommended policy:

- Create tokens from the VibeStack UI.
- Copy a token only once.
- Store tokens in the creator's local user-level config or secure secrets store.
- Never store tokens inside app repositories.
- Revoke tokens when people leave the team or lose a machine.

The creator onboarding prompt tells the coding agent not to print, commit, or store tokens in app repositories.

## App Access Defaults

For internal apps, default to VibeStack login access unless a specific app needs external password access.

Use external-password access for demos, contractors, or temporary sharing where full VibeStack user accounts are not appropriate. If a generated external app password is created during deployment, it is shown once.

## Cloudflare

The current Community Edition installer expects Cloudflare DNS. The Cloudflare token must be able to edit DNS records in the relevant zone.

Keep the token scoped as narrowly as possible:

- Zone: the specific DNS zone.
- Permissions: DNS edit.

Do not reuse a broad personal Cloudflare token when a scoped token can do the job.

## Onboarding Creators

For each creator, provide:

- VibeStack management URL.
- Hosted app base domain.
- Team slug.
- API token.
- The setup prompt from [creator-onboarding.md](creator-onboarding.md).

The VibeStack UI includes an Onboarding page that generates the Claude Code setup prompt from your current base domain and team list. Use that page when possible so admins do not have to assemble the prompt by hand.

After setup, tell creators to open any app project in Claude Code and say:

```text
Deploy this app to VibeStack.
```

## Operational Checks

For platform health:

```bash
cd /opt/vibestack
sudo docker compose ps
sudo docker compose logs --tail=100 api
sudo docker compose logs --tail=100 worker
sudo docker compose logs --tail=100 traefik
```

For deployment failures, check:

1. The deployment error and agent hint in the VibeStack UI.
2. Worker logs.
3. App logs and diagnostics in the app detail view.
4. DNS and Traefik logs if the app builds but does not route.

For ongoing server operations, see [operations.md](operations.md).
