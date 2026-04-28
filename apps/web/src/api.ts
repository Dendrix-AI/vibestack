import type {
  ApiErrorBody,
  ApiList,
  ApiToken,
  AppSecret,
  AppSummary,
  AuditLog,
  Deployment,
  LifecycleEvent,
  LogLine,
  MeResponse,
  PlatformSettings,
  PostgresCredentials,
  SystemUpdate,
  Team,
  TeamMembership,
  User
} from './types';

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
};

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly agentHint?: string;
  readonly details?: Record<string, unknown>;
  readonly logExcerpt?: string;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error.code;
    this.agentHint = body.error.agentHint;
    this.details = body.error.details;
    this.logExcerpt = body.error.logExcerpt;
  }
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findList<T>(value: unknown, keys: string[]): T[] | undefined {
  if (Array.isArray(value)) {
    return value;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  for (const key of keys) {
    if (Array.isArray(value[key])) {
      return value[key] as T[];
    }
  }

  for (const key of ['items', 'data', 'results']) {
    const nested = findList<T>(value[key], keys);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function normalizeList<T>(value: ApiList<T>, keys: string[] = []): T[] {
  return findList<T>(value, ['items', 'data', 'results', ...keys]) ?? [];
}

function unwrap<T>(value: unknown, key: string, fallbackKeys: string[] = []): T {
  if (isRecord(value)) {
    for (const candidate of [key, ...fallbackKeys]) {
      if (candidate in value) {
        return value[candidate] as T;
      }
    }

    if (isRecord(value.data)) {
      return unwrap<T>(value.data, key, fallbackKeys);
    }
  }
  return value as T;
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  let body: BodyInit | undefined;

  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    body,
    credentials: 'include'
  });
  const parsed = await parseResponse(response);

  if (!response.ok) {
    if (isRecord(parsed) && isRecord(parsed.error)) {
      throw new ApiError(response.status, parsed as ApiErrorBody);
    }

    throw new Error(`Request failed with status ${response.status}`);
  }

  return parsed as T;
}

export const api = {
  async login(email: string, password: string): Promise<MeResponse> {
    return request<MeResponse>('/auth/login', {
      method: 'POST',
      body: { email, password }
    });
  },

  async logout(): Promise<void> {
    await request<void>('/auth/logout', { method: 'POST' });
  },

  me(): Promise<MeResponse> {
    return request<MeResponse>('/me');
  },

  async listApps(): Promise<AppSummary[]> {
    return normalizeList(await request<ApiList<AppSummary>>('/apps'), ['apps']);
  },

  getApp(appId: string): Promise<AppSummary> {
    return request<unknown>(`/apps/${appId}`).then((value) => unwrap<AppSummary>(value, 'app'));
  },

  updateApp(appId: string, payload: Partial<AppSummary>): Promise<AppSummary> {
    return request<unknown>(`/apps/${appId}`, {
      method: 'PATCH',
      body: payload
    }).then((value) => unwrap<AppSummary>(value, 'app'));
  },

  deleteApp(appId: string): Promise<void> {
    return request<void>(`/apps/${appId}`, { method: 'DELETE' });
  },

  startApp(appId: string): Promise<AppSummary> {
    return request<unknown>(`/apps/${appId}/start`, { method: 'POST' }).then((value) =>
      unwrap<AppSummary>(value, 'app')
    );
  },

  stopApp(appId: string): Promise<AppSummary> {
    return request<unknown>(`/apps/${appId}/stop`, { method: 'POST' }).then((value) =>
      unwrap<AppSummary>(value, 'app')
    );
  },

  rollback(appId: string, deploymentId: string): Promise<unknown> {
    return request<unknown>(`/apps/${appId}/rollback`, {
      method: 'POST',
      body: { deploymentId }
    });
  },

  async listDeployments(appId: string): Promise<Deployment[]> {
    return normalizeList(await request<ApiList<Deployment>>(`/apps/${appId}/deployments`), ['deployments']);
  },

  getDeployment(deploymentId: string): Promise<Deployment> {
    return request<unknown>(`/deployments/${deploymentId}`).then((value) =>
      unwrap<Deployment>(value, 'deployment')
    );
  },

  async listLogs(appId: string): Promise<LogLine[]> {
    const response = await request<ApiList<LogLine> | string>(`/apps/${appId}/logs`);
    if (typeof response === 'string') {
      return response.split('\n').filter(Boolean).map((message) => ({ message }));
    }

    return normalizeList(response, ['logs']);
  },

  async listEvents(appId: string): Promise<LifecycleEvent[]> {
    return normalizeList(await request<ApiList<LifecycleEvent>>(`/apps/${appId}/events`), ['events']);
  },

  async listSecrets(appId: string): Promise<AppSecret[]> {
    return normalizeList(await request<ApiList<AppSecret>>(`/apps/${appId}/secrets`), ['secrets']);
  },

  upsertSecret(appId: string, key: string, value: string): Promise<AppSecret> {
    return request<unknown>(`/apps/${appId}/secrets/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: { value }
    }).then((response) => unwrap<AppSecret>(response, 'secret'));
  },

  deleteSecret(appId: string, key: string): Promise<void> {
    return request<void>(`/apps/${appId}/secrets/${encodeURIComponent(key)}`, { method: 'DELETE' });
  },

  createPostgres(appId: string): Promise<PostgresCredentials | null> {
    return request<unknown>(`/apps/${appId}/postgres`, { method: 'POST' }).then((value) =>
      unwrap<PostgresCredentials | null>(value, 'credentials')
    );
  },

  async deletePostgres(appId: string): Promise<void> {
    await request<unknown>(`/apps/${appId}/postgres`, { method: 'DELETE' });
  },

  async listUsers(): Promise<User[]> {
    return normalizeList(await request<ApiList<User>>('/users'), ['users']);
  },

  createUser(payload: Partial<User> & { email: string; password: string }): Promise<User> {
    return request<unknown>('/users', { method: 'POST', body: payload }).then((value) =>
      unwrap<User>(value, 'user')
    );
  },

  updateUser(userId: string, payload: Partial<User>): Promise<User> {
    return request<unknown>(`/users/${userId}`, { method: 'PATCH', body: payload }).then((value) =>
      unwrap<User>(value, 'user')
    );
  },

  async listTeams(): Promise<Team[]> {
    return normalizeList(await request<ApiList<Team>>('/teams'), ['teams', 'memberships']);
  },

  createTeam(payload: Pick<Team, 'name' | 'slug'>): Promise<Team> {
    return request<unknown>('/teams', { method: 'POST', body: payload }).then((value) =>
      unwrap<Team>(value, 'team')
    );
  },

  updateTeam(teamId: string, payload: Partial<Team>): Promise<Team> {
    return request<unknown>(`/teams/${teamId}`, { method: 'PATCH', body: payload }).then((value) =>
      unwrap<Team>(value, 'team')
    );
  },

  addTeamMember(teamId: string, payload: { userId: string; role: TeamMembership['role'] }): Promise<TeamMembership> {
    return request<unknown>(`/teams/${teamId}/members`, { method: 'POST', body: payload }).then((value) =>
      unwrap<TeamMembership>(value, 'membership')
    );
  },

  updateTeamMember(teamId: string, userId: string, role: TeamMembership['role']): Promise<TeamMembership> {
    return request<unknown>(`/teams/${teamId}/members/${userId}`, { method: 'PATCH', body: { role } }).then(
      (value) => unwrap<TeamMembership>(value, 'membership')
    );
  },

  removeTeamMember(teamId: string, userId: string): Promise<void> {
    return request<void>(`/teams/${teamId}/members/${userId}`, { method: 'DELETE' });
  },

  getSettings(): Promise<PlatformSettings> {
    return request<unknown>('/settings').then((value) => unwrap<PlatformSettings>(value, 'settings'));
  },

  updateSettings(payload: Partial<PlatformSettings>): Promise<PlatformSettings> {
    return request<unknown>('/settings', { method: 'PATCH', body: payload }).then((value) =>
      unwrap<PlatformSettings>(value, 'settings')
    );
  },

  getSystemUpdate(refresh = false): Promise<SystemUpdate> {
    return request<unknown>(`/system/update${refresh ? '?refresh=true' : ''}`).then((value) =>
      unwrap<SystemUpdate>(value, 'update')
    );
  },

  startSystemUpdate(): Promise<SystemUpdate> {
    return request<unknown>('/system/update', { method: 'POST' }).then((value) =>
      unwrap<SystemUpdate>(value, 'update')
    );
  },

  async listTokens(): Promise<ApiToken[]> {
    return normalizeList(await request<ApiList<ApiToken>>('/tokens'), ['tokens']);
  },

  createToken(name: string): Promise<ApiToken> {
    return request<unknown>('/tokens', { method: 'POST', body: { name } }).then((value) =>
      unwrap<ApiToken>(value, 'token')
    );
  },

  async revokeToken(tokenId: string): Promise<void> {
    await request<unknown>(`/tokens/${tokenId}`, { method: 'DELETE' });
  },

  async listAuditLogs(): Promise<AuditLog[]> {
    return normalizeList(await request<ApiList<AuditLog>>('/audit-logs'), ['auditLogs', 'audit_logs', 'logs']);
  }
};

export function formatApiError(error: unknown): string {
  if (error instanceof ApiError) {
    return `${error.code}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unexpected API error';
}
