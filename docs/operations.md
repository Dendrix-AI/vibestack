# Operations

This guide covers common operational tasks for a self-hosted VibeStack Community Edition server.

## Service Status

On the server:

```bash
cd /opt/vibestack
sudo docker compose ps
```

Logs:

```bash
sudo docker compose logs --tail=100 api
sudo docker compose logs --tail=100 worker
sudo docker compose logs --tail=100 web
sudo docker compose logs --tail=100 traefik
sudo docker compose logs --tail=100 postgres
sudo docker compose logs --tail=100 redis
```

## Upgrade

Before upgrading, take a backup.

```bash
cd /opt/vibestack
sudo git fetch --tags origin
sudo git pull --ff-only
sudo docker compose pull postgres redis traefik
sudo docker compose up -d --build
sudo docker compose ps
```

VibeStack tracks the `stable` update channel by default. Platform admins can switch the tracked branch from Settings to `stable`, `beta`, `nightly`, or `main`.

- `stable` and `beta` are version-tracked channels. VibeStack offers an update when the branch's `vibestackRelease` value changes.
- `nightly` and `main` are revision-tracked channels. VibeStack offers an update whenever the tracked branch moves.

For production servers, track `stable`. Track `beta` for prerelease validation and `nightly` for development snapshots. Avoid tracking `main` on production servers; `main` is the integration branch for pull requests and may include changes that have not been published as a release.

VibeStack checks database migration compatibility before applying an update. Moving to a channel that contains new migrations is allowed, but the UI recommends taking a backup first. Moving back to an older channel is blocked when the installed database contains migrations that do not exist on the target channel. Restore a backup from before the newer migration, or move to a channel that contains the applied migrations.

For maintainer release workflow details, see [release-process.md](release-process.md).

## Backup

Platform admins can download a system backup from Settings. The generated archive contains:

- a Postgres dump for the VibeStack database
- `.env`
- `docker-compose.yml`
- `secrets`, when present
- a backup manifest

Create a system backup before switching to `beta`, `nightly`, or any update that includes database migrations. Store downloaded backups somewhere other than the VibeStack server.

Back up:

- `/opt/vibestack/.env`
- `/opt/vibestack/secrets`
- `/var/lib/vibestack`
- Docker volume `vibestack_postgres_data`
- Docker volume `vibestack_vibestack_data`
- Docker volume `vibestack_letsencrypt`

Example Postgres dump:

```bash
cd /opt/vibestack
sudo docker compose exec -T postgres pg_dump -U vibestack vibestack > vibestack-postgres.sql
```

Example archive of config and local data:

```bash
sudo tar -czf vibestack-config-data.tgz \
  /opt/vibestack/.env \
  /opt/vibestack/secrets \
  /var/lib/vibestack
```

Store backups somewhere other than the VibeStack server.

## Restore

Platform admins can restore a VibeStack system backup from Settings by uploading the downloaded archive. Restore replaces the VibeStack database and restores the archived config files. Restart the stack after restore so services reload the restored configuration and database state.

A basic restore flow is:

1. Install the same or compatible VibeStack version on a new server.
2. Stop the stack.
3. Restore `/opt/vibestack/.env`, `/opt/vibestack/secrets`, and `/var/lib/vibestack`.
4. Restore the Postgres dump.
5. Start the stack.
6. Verify login and app routing.

Example Postgres restore:

```bash
cd /opt/vibestack
sudo docker compose up -d postgres
cat vibestack-postgres.sql | sudo docker compose exec -T postgres psql -U vibestack vibestack
sudo docker compose up -d --build
```

Use a maintenance window for production restores.

## Maintenance Mode

Use maintenance mode before planned operational work that should block new deployments. Existing running apps may continue to serve traffic, but creators should not expect new deployments during maintenance.

## Deployment Failure Triage

Start with the VibeStack UI. Deployment errors include a stable code and an agent hint when available.

Then check server logs:

```bash
cd /opt/vibestack
sudo docker compose logs --tail=200 worker
sudo docker compose logs --tail=200 api
sudo docker compose logs --tail=200 traefik
```

Common causes:

- App health route does not return HTTP 2xx.
- App listens on `127.0.0.1` instead of `0.0.0.0`.
- App listens on a different port than `vibestack.json`.
- Required secrets were not provided.
- Cloudflare DNS has not propagated.
- Docker build fails because the app project is incomplete.

## Security Notes

Keep `/opt/vibestack/.env` and `/opt/vibestack/secrets` readable only by root.

Revoke creator API tokens when people leave or devices are lost.

Do not publish server backups, `.env` files, logs containing secrets, or generated external app passwords.
