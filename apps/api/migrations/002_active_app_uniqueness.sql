ALTER TABLE apps DROP CONSTRAINT IF EXISTS apps_hostname_key;
ALTER TABLE apps DROP CONSTRAINT IF EXISTS apps_team_id_slug_key;

CREATE UNIQUE INDEX IF NOT EXISTS apps_active_hostname_key
  ON apps(hostname)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS apps_active_team_id_slug_key
  ON apps(team_id, slug)
  WHERE deleted_at IS NULL;
