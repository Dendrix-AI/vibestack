export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  default_team_id: string | null;
  is_platform_admin: boolean;
  status: 'active' | 'disabled';
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
};

export type TeamRole = 'team_admin' | 'creator' | 'viewer';

export type TeamRow = {
  id: string;
  name: string;
  slug: string;
  deployments_paused: boolean;
  created_at: Date;
  updated_at: Date;
};

export type Actor = {
  user: UserRow;
  actorType: 'user' | 'api_token';
  tokenId?: string;
};

export type AppRow = {
  id: string;
  team_id: string;
  name: string;
  slug: string;
  hostname: string;
  status: 'deploying' | 'running' | 'stopped' | 'failed' | 'updating' | 'deleting';
  creator_user_id: string;
  last_updated_by_user_id: string | null;
  current_deployment_id: string | null;
  postgres_enabled: boolean;
  external_password_enabled: boolean;
  login_access_enabled: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
};

export type DeploymentRow = {
  id: string;
  app_id: string;
  version_number: number;
  type: 'deploy' | 'rollback';
  source_commit_sha: string | null;
  source_tarball_sha256: string | null;
  docker_image_tag: string | null;
  manifest: unknown;
  status:
    | 'queued'
    | 'validating'
    | 'building'
    | 'starting'
    | 'health_checking'
    | 'routing'
    | 'succeeded'
    | 'failed'
    | 'cancelled';
  started_by_user_id: string | null;
  rollback_source_deployment_id: string | null;
  error_code: string | null;
  error_message: string | null;
  error_details_json: unknown;
  log_excerpt: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
};
