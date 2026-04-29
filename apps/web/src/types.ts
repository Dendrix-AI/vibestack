export type AppStatus = 'deploying' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | 'updating' | 'deleting';

export type DeploymentStatus =
  | 'queued'
  | 'validating'
  | 'building'
  | 'starting'
  | 'health_checking'
  | 'routing'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type TeamRole = 'team_admin' | 'creator' | 'viewer';

export type UserStatus = 'active' | 'disabled' | 'invited';

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    agentHint?: string;
    details?: Record<string, unknown>;
    logExcerpt?: string;
  };
};

export type User = {
  id: string;
  email: string;
  displayName?: string;
  display_name?: string;
  defaultTeamId?: string;
  default_team_id?: string;
  isPlatformAdmin?: boolean;
  is_platform_admin?: boolean;
  status?: UserStatus | string;
  lastLoginAt?: string | null;
  last_login_at?: string | null;
  createdAt?: string;
  created_at?: string;
};

export type TeamMembership = {
  id?: string;
  teamId?: string;
  team_id?: string;
  userId?: string;
  user_id?: string;
  user?: User;
  role: TeamRole;
  createdAt?: string;
  created_at?: string;
};

export type Team = {
  id: string;
  name: string;
  slug: string;
  deploymentsPaused?: boolean;
  deployments_paused?: boolean;
  members?: TeamMembership[];
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
};

export type AppSummary = {
  id: string;
  teamId?: string;
  team_id?: string;
  team?: Team;
  name: string;
  slug: string;
  hostname?: string;
  url?: string;
  status: AppStatus;
  creatorUserId?: string;
  creator_user_id?: string;
  lastUpdatedByUserId?: string;
  last_updated_by_user_id?: string;
  currentDeploymentId?: string | null;
  current_deployment_id?: string | null;
  postgresEnabled?: boolean;
  postgres_enabled?: boolean;
  externalPasswordEnabled?: boolean;
  external_password_enabled?: boolean;
  externalPassword?: string;
  external_password?: string;
  externalPasswordConfigured?: boolean;
  external_password_configured?: boolean;
  loginAccessEnabled?: boolean;
  login_access_enabled?: boolean;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
};

export type Deployment = {
  id: string;
  appId?: string;
  app_id?: string;
  versionNumber?: number;
  version_number?: number;
  type: 'deploy' | 'rollback';
  sourceCommitSha?: string;
  source_commit_sha?: string;
  dockerImageTag?: string;
  docker_image_tag?: string;
  status: DeploymentStatus;
  startedByUserId?: string;
  started_by_user_id?: string;
  rollbackSourceDeploymentId?: string | null;
  rollback_source_deployment_id?: string | null;
  errorCode?: string | null;
  error_code?: string | null;
  errorMessage?: string | null;
  error_message?: string | null;
  startedAt?: string | null;
  started_at?: string | null;
  finishedAt?: string | null;
  finished_at?: string | null;
  createdAt?: string;
  created_at?: string;
};

export type AppSecret = {
  id?: string;
  key: string;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
};

export type LifecycleEvent = {
  id: string;
  eventType?: string;
  event_type?: string;
  message: string;
  createdAt?: string;
  created_at?: string;
};

export type LogLine = {
  id?: string;
  timestamp?: string;
  level?: string;
  message: string;
  stream?: string;
};

export type ApiToken = {
  id: string;
  name: string;
  value?: string;
  lastUsedAt?: string | null;
  last_used_at?: string | null;
  revokedAt?: string | null;
  revoked_at?: string | null;
  createdAt?: string;
  created_at?: string;
};

export type PostgresCredentials = {
  id?: string;
  databaseName?: string;
  database_name?: string;
  databaseUser?: string;
  database_user?: string;
  createdAt?: string;
  created_at?: string;
  deletedAt?: string | null;
  deleted_at?: string | null;
};

export type AuditLog = {
  id: string;
  actorUserId?: string | null;
  actor_user_id?: string | null;
  actorUserEmail?: string | null;
  actor_user_email?: string | null;
  actorUserDisplayName?: string | null;
  actor_user_display_name?: string | null;
  actorType?: 'user' | 'api_token' | 'system' | string;
  actor_type?: 'user' | 'api_token' | 'system' | string;
  action: string;
  targetType?: string;
  target_type?: string;
  targetId?: string;
  target_id?: string;
  targetUserEmail?: string | null;
  target_user_email?: string | null;
  targetUserDisplayName?: string | null;
  target_user_display_name?: string | null;
  targetAppName?: string | null;
  target_app_name?: string | null;
  targetAppHostname?: string | null;
  target_app_hostname?: string | null;
  targetTeamName?: string | null;
  target_team_name?: string | null;
  sourceIp?: string;
  source_ip?: string;
  metadataJson?: Record<string, unknown>;
  metadata_json?: Record<string, unknown>;
  createdAt?: string;
  created_at?: string;
};

export type PlatformSettings = {
  baseDomain?: string;
  base_domain?: string;
  cloudflare?: {
    zoneId?: string;
    zone_id?: string;
    apiToken?: string;
    api_token?: string;
    configured?: boolean;
    apiTokenConfigured?: boolean;
    api_token_configured?: boolean;
  };
  dataDirectory?: string;
  data_directory?: string;
  buildTimeoutSeconds?: number;
  build_timeout_seconds?: number;
  defaultAppAccessMode?: 'login' | 'password' | 'private' | string;
  default_app_access_mode?: 'login' | 'password' | 'private' | string;
  defaultAccessMode?: 'login' | 'password' | 'private' | string;
  default_access_mode?: 'login' | 'password' | 'private' | string;
  maintenanceMode?: boolean;
  maintenance_mode?: boolean;
  announcementBanner?: string;
  announcement_banner?: string;
};

export type SystemUpdate = {
  currentVersion: string;
  currentRevision?: string;
  currentTag?: string;
  latestVersion?: string;
  latestRevision?: string;
  latestTag?: string;
  updateAvailable: boolean;
  sourceAvailable: boolean;
  state: 'idle' | 'checking' | 'running' | 'succeeded' | 'failed' | 'unavailable' | string;
  message?: string;
  startedAt?: string;
  finishedAt?: string;
  repoUrl: string;
  channel: string;
};

export type MeResponse = {
  user: User;
  teams?: Team[];
  memberships?: (Team & { role?: TeamRole })[];
};

export type ApiList<T> = T[] | Record<string, unknown> | { items?: T[]; data?: T[]; results?: T[] };
