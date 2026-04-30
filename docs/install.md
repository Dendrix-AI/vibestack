# Install VibeStack

This guide is for the sysadmin or platform owner installing VibeStack Community Edition on a fresh server.

VibeStack currently targets a single Debian or Ubuntu host running Docker Compose, Postgres, Redis, Traefik, and locally built app containers. The installer configures Docker, HTTPS, Cloudflare DNS, the management hostname, hosted-app wildcard routing, and the first platform admin.

## Requirements

You need:

- A clean Debian or Ubuntu server with root or sudo access.
- A public IPv4 address reachable on ports `80` and `443`.
- A domain managed in Cloudflare.
- One hostname for VibeStack, for example `vibestack.example.com`.
- One base domain for hosted apps, for example `apps.example.com`.
- A Cloudflare API token that can edit DNS records in the relevant zone.
- The Cloudflare zone ID for that domain.
- An email address for Let's Encrypt certificate registration.

The installer creates or updates these DNS records:

- `vibestack.example.com`
- `traefik.apps.example.com`, unless you pass a custom `--traefik-host`
- `*.apps.example.com`

Cloudflare DNS is required for the current Community Edition installer.

## Fresh Server Install

SSH to the server, then run:

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/Dendrix-AI/vibestack.git
cd vibestack
```

Run the installer:

```bash
sudo ./scripts/install-linux.sh \
  --domain apps.example.com \
  --host vibestack.example.com \
  --email ops@example.com \
  --admin-email admin@example.com \
  --cloudflare-api-token "$CLOUDFLARE_API_TOKEN" \
  --cloudflare-zone-id "$CLOUDFLARE_ZONE_ID"
```

Replace:

- `apps.example.com` with your hosted app base domain.
- `vibestack.example.com` with the VibeStack management hostname.
- `ops@example.com` with the Let's Encrypt account email.
- `admin@example.com` with the first platform admin email.

If you run the installer from a terminal, it prompts for the first admin password and Traefik dashboard password. In non-interactive environments, it generates passwords and prints them once.

## Optional Flags

Common optional flags:

```bash
sudo ./scripts/install-linux.sh \
  --domain apps.example.com \
  --host vibestack.example.com \
  --traefik-host traefik.example.com \
  --email ops@example.com \
  --admin-email admin@example.com \
  --admin-password 'use-a-real-secret' \
  --dashboard-user admin \
  --dashboard-password 'use-another-real-secret' \
  --cloudflare-api-token "$CLOUDFLARE_API_TOKEN" \
  --cloudflare-zone-id "$CLOUDFLARE_ZONE_ID"
```

Use `--skip-dns-check` only when you know DNS propagation is delayed and you want Traefik to retry certificate issuance after the install completes.

## What The Installer Does

The installer:

- Installs required OS packages.
- Installs Docker Engine and Docker Compose if missing.
- Verifies ports `80` and `443` are free.
- Detects the server public IPv4 address.
- Creates or updates Cloudflare DNS records.
- Clones or updates the VibeStack repository into `/opt/vibestack`.
- Writes `/opt/vibestack/.env`.
- Stores Traefik dashboard basic-auth credentials in `/opt/vibestack/secrets`.
- Starts Postgres, Redis, Traefik, the API, the worker, and the web UI with Docker Compose.

Persistent VibeStack data is stored in Docker volumes and `/var/lib/vibestack`.

## Success Checks

After install, verify:

1. Open `https://vibestack.example.com`.
2. Log in with the platform admin email and password.
3. Open `https://traefik.apps.example.com` or your custom Traefik hostname.
4. Create a production team in the VibeStack UI.
5. Create a test user or API token.
6. Deploy the sample app using [deploy-first-app.md](deploy-first-app.md).
7. Confirm the update channel in Settings. New installs default to `stable`.

On the server, useful checks are:

```bash
cd /opt/vibestack
sudo docker compose ps
sudo docker compose logs --tail=100 api
sudo docker compose logs --tail=100 worker
sudo docker compose logs --tail=100 traefik
```

## First Admin Tasks

After logging in:

1. Create teams for real departments or groups.
2. Give creators a team slug, not a database ID.
3. Create users for app creators and viewers.
4. Create API tokens from the VibeStack UI only when needed.
5. Review platform settings, including base domain, update channel, default access mode, maintenance mode, and Cloudflare status.

The bootstrap team is usually `platform-admins`. Use separate teams for production creator groups.

## Troubleshooting

If install fails because ports are busy, stop the existing web server or reverse proxy before retrying.

If Let's Encrypt certificates are not issued immediately, check that Cloudflare records point at the server and that inbound ports `80` and `443` are open.

If the app UI loads but deployments fail, check worker logs first:

```bash
cd /opt/vibestack
sudo docker compose logs --tail=200 worker
```

If DNS was just created, wait for propagation and then retry the failed deployment.
