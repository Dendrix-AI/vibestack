CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  deployments_paused boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  default_team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  is_platform_admin boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE IF NOT EXISTS team_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('team_admin', 'creator', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  hostname text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'stopped' CHECK (status IN ('deploying', 'running', 'stopped', 'failed', 'updating', 'deleting')),
  creator_user_id uuid NOT NULL REFERENCES users(id),
  last_updated_by_user_id uuid REFERENCES users(id),
  current_deployment_id uuid,
  postgres_enabled boolean NOT NULL DEFAULT false,
  external_password_enabled boolean NOT NULL DEFAULT false,
  external_password_hash text,
  login_access_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (team_id, slug)
);

CREATE TABLE IF NOT EXISTS deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  type text NOT NULL DEFAULT 'deploy' CHECK (type IN ('deploy', 'rollback')),
  source_commit_sha text,
  source_tarball_sha256 text,
  docker_image_tag text,
  manifest jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'validating', 'building', 'starting', 'health_checking', 'routing', 'succeeded', 'failed', 'cancelled')),
  started_by_user_id uuid REFERENCES users(id),
  rollback_source_deployment_id uuid REFERENCES deployments(id),
  error_code text,
  error_message text,
  error_details_json jsonb,
  log_excerpt text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, version_number)
);

ALTER TABLE apps
  ADD CONSTRAINT apps_current_deployment_id_fkey
  FOREIGN KEY (current_deployment_id) REFERENCES deployments(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS app_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  key text NOT NULL,
  encrypted_value text NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  updated_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, key)
);

CREATE TABLE IF NOT EXISTS app_db_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL UNIQUE REFERENCES apps(id) ON DELETE CASCADE,
  database_name text NOT NULL UNIQUE,
  database_user text NOT NULL UNIQUE,
  encrypted_database_password text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS app_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  deployment_id uuid REFERENCES deployments(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  message text NOT NULL,
  metadata_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'api_token', 'system')),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  source_ip text,
  metadata_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_settings (
  key text PRIMARY KEY,
  value_json jsonb NOT NULL,
  encrypted boolean NOT NULL DEFAULT false,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_settings (key, value_json)
VALUES
  ('baseDomain', to_jsonb(COALESCE(NULLIF(current_setting('vibestack.base_domain', true), ''), 'localdomain'))),
  ('maintenanceMode', 'false'::jsonb),
  ('announcementBanner', 'null'::jsonb),
  ('defaultAppAccessMode', '"login"'::jsonb),
  ('buildTimeoutSeconds', '600'::jsonb),
  ('dataDirectory', '"/var/lib/vibestack"'::jsonb),
  ('cloudflare', '{"apiTokenConfigured": false, "zoneId": null}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_team_memberships_user_id ON team_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_apps_team_id ON apps(team_id);
CREATE INDEX IF NOT EXISTS idx_apps_deleted_at ON apps(deleted_at);
CREATE INDEX IF NOT EXISTS idx_deployments_app_id ON deployments(app_id);
CREATE INDEX IF NOT EXISTS idx_app_events_app_id ON app_events(app_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
