import { z } from 'zod';

export const APP_STATUSES = ['deploying', 'running', 'stopped', 'failed', 'updating', 'deleting'] as const;
export type AppStatus = (typeof APP_STATUSES)[number];

export const DEPLOYMENT_STATUSES = [
  'queued',
  'validating',
  'building',
  'starting',
  'health_checking',
  'routing',
  'succeeded',
  'failed',
  'cancelled'
] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export const TEAM_ROLES = ['team_admin', 'creator', 'viewer'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    agentHint?: string;
    details?: Record<string, unknown>;
    logExcerpt?: string;
  };
};

export type VibeStackManifest = {
  name: string;
  port: number;
  healthCheckPath: string;
  persistent: boolean;
  startCommand?: string | null;
  requiredSecrets?: string[];
  postgres?: boolean;
};

export const VibestackManifestSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/, {
      message: 'name must be lowercase letters, numbers, and hyphens'
    }),
  port: z.number().int().min(1).max(65535),
  healthCheckPath: z.string().min(1).startsWith('/'),
  persistent: z.boolean(),
  startCommand: z.string().min(1).nullable().optional(),
  requiredSecrets: z.array(z.string().regex(/^[A-Z_][A-Z0-9_]*$/)).optional(),
  postgres: z.boolean().optional()
});

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function buildAppHostname(teamSlug: string, appSlug: string, baseDomain: string): string {
  return `${teamSlug}-${appSlug}.${baseDomain}`;
}

export function createApiError(
  code: string,
  message: string,
  agentHint?: string,
  details?: Record<string, unknown>
): ApiErrorBody {
  return {
    error: {
      code,
      message,
      ...(agentHint ? { agentHint } : {}),
      ...(details ? { details } : {})
    }
  };
}
