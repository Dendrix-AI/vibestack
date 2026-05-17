# Creator Onboarding

This guide is for admins onboarding non-technical app creators.

The goal is that creators build apps with an AI coding tool and then say:

```text
Deploy this app to VibeStack.
```

They should not need to learn Git, Docker, Traefik, Cloudflare, image registries, CI/CD, or DNS.

## What The Admin Provides

For each creator, provide:

- VibeStack management URL, for example `https://vibestack.example.com`.
- Hosted app base domain, for example `apps.example.com`.
- Team slug, for example `finance`.
- Personal API token from VibeStack.
- Default app access mode, usually VibeStack login access.
- Default database policy, usually no Postgres unless the app needs persistent structured data.

Do not send database IDs when a team slug is available.

## One-Time Coding Agent Setup Prompt

Use the Onboarding page in the VibeStack admin UI to generate this prompt with the correct management URL, hosted app domain, team slug, access mode, and database default. If you need to do it manually, give the creator this prompt after filling in the values in brackets:

```text
I want you to configure the reusable VibeStack deployment helper for this coding agent.

Use these defaults:
- VibeStack API URL: [https://vibestack.example.com]
- Hosted app base domain: [apps.example.com]
- Default team slug: [team-slug]
- Default access mode: VibeStack login access
- Default database behavior: no Postgres unless I explicitly ask for persistent structured data

Ask me for my VibeStack API token. Do not print the token back to me. Do not commit it. Do not store it in any app repository. If this coding agent has a secure local user-level secrets mechanism, use that; otherwise store it in a user-level config file with permissions set to 0600.

Then install or configure the VibeStack deployment helper:
1. Fetch https://github.com/Dendrix-AI/vibestack.
2. If this agent supports user-level skills or reusable instructions, install `skills/deploy-to-vibestack` there as `deploy-to-vibestack`.
3. If this agent does not support skills, keep the helper files available locally and use `scripts/vibestack_deploy.py` directly when deploying.
4. Verify the helper contains `SKILL.md`, `scripts/vibestack_deploy.py`, `references/api.md`, and `references/manifest.md`.
5. Create `~/.config/vibestack/deploy.json` with the defaults above.
6. Store credentials only in a user-level credentials file or secure local secrets store.
7. Do not deploy the current app unless I explicitly ask you to.

After setup, explain that I can deploy any future app by opening that app in this coding agent and saying: "Deploy this app to VibeStack."
```

## Normal Creator Workflow

After the setup prompt has been run once:

1. Open the app project in your coding agent.
2. Ask the agent to build or modify the app.
3. Say:

```text
Deploy this app to VibeStack.
```

The coding agent should prepare the app, create or update `vibestack.json`, package the source, upload it to VibeStack, poll deployment status, and report the live URL.

## Continuing On Another Computer

If a creator opens the coding agent on another computer and asks about or changes an app that was already deployed to VibeStack, the agent should bring the editable app files onto that computer first.

Creators can say:

```text
Continue editing my todo-notes app from VibeStack.
```

The agent should handle the download and setup behind the scenes. Creators should not need to understand repositories, branches, or source-control commands.

## When To Enable Postgres

Creators should use VibeStack-managed Postgres when the app stores:

- records
- notes
- task lists
- uploaded metadata
- user-generated content
- sessions
- settings
- audit or history data

Creators can say:

```text
Deploy this app to VibeStack with Postgres enabled.
```

The app must use the injected `DATABASE_URL`. It should not create its own database container or hard-code database credentials.

## Token Safety

Creators should never paste API tokens into app source files, `.env` files inside app repositories, README files, screenshots, tickets, or chat logs.

If a token is exposed, revoke it in VibeStack and create a new one.
