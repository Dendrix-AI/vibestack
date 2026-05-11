import { describe, expect, it } from 'vitest';
import { buildDoctorPacket, normalizeOpenRouterSetting, publicOpenRouterSetting } from './doctor.js';
import { loadConfig } from './config.js';
import { decryptSecret } from './crypto.js';
import type { Db } from './db.js';
import type { AppRow, DeploymentRow } from './types.js';

const app: AppRow = {
  id: 'de52380f-282b-44de-a741-17118f331b01',
  team_id: '8f90c863-78f2-4837-a98b-02b812ef765d',
  name: 'okr-dashboard',
  slug: 'okr-dashboard',
  hostname: 'platform-admins-okr-dashboard.example.com',
  status: 'failed',
  creator_user_id: 'b2f2f26f-3a5c-4226-844f-b54808bd7baf',
  last_updated_by_user_id: null,
  current_deployment_id: null,
  postgres_enabled: false,
  external_password_enabled: false,
  login_access_enabled: true,
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null
};

function deployment(overrides: Partial<DeploymentRow>): DeploymentRow {
  return {
    id: 'f5c483c3-9466-4eef-8854-cab7de56c657',
    app_id: app.id,
    version_number: 1,
    type: 'deploy',
    source_commit_sha: null,
    source_tarball_sha256: null,
    docker_image_tag: null,
    manifest: { name: 'okr-dashboard', port: 3000, healthCheckPath: '/health', requiredSecrets: [] },
    status: 'failed',
    started_by_user_id: app.creator_user_id,
    rollback_source_deployment_id: null,
    error_code: null,
    error_message: null,
    error_details_json: null,
    log_excerpt: null,
    started_at: new Date(),
    finished_at: new Date(),
    created_at: new Date(),
    ...overrides
  };
}

describe('VibeStack Doctor', () => {
  it('reports a healthy current state when a newer successful deployment supersedes an older failure', async () => {
    const packet = await buildDoctorPacket({
      app: { ...app, status: 'running', current_deployment_id: 'succeeded-deployment' },
      deployments: [
        deployment({
          id: 'succeeded-deployment',
          version_number: 3,
          status: 'succeeded',
          error_code: null,
          error_message: null,
          error_details_json: null
        }),
        deployment({
          id: 'failed-deployment',
          version_number: 2,
          status: 'failed',
          error_code: 'HEALTH_CHECK_FAILED',
          error_message: 'Old failure',
          error_details_json: {
            checkedUrl: 'http://127.0.0.1:49152/health',
            port: 3000,
            healthCheckPath: '/health',
            logExcerpt: 'Cannot GET /health'
          }
        })
      ],
      secrets: [],
      appLogs: ['Listening on 3000', 'DB ready'],
      postgres: { enabled: true, logs: [] }
    });

    expect(packet.rootCauseCategory).toBe('healthy');
    expect(packet.relatedDeploymentId).toBe('succeeded-deployment');
    expect(packet.healthCheckResult.status).toBe('passed');
    expect(packet.summary).toContain('latest deployment succeeded');
    expect(packet.suggestedFixPrompt).toContain('No repair is needed');
    expect(packet.evidence.some((item) => item.label === 'Historical failure')).toBe(true);
  });

  it('classifies missing health routes from failed health checks', async () => {
    const packet = await buildDoctorPacket({
      app,
      deployments: [
        deployment({
          error_code: 'HEALTH_CHECK_FAILED',
          error_message: 'The container did not return a successful response.',
          error_details_json: {
            checkedUrl: 'http://127.0.0.1:49152/health',
            port: 3000,
            healthCheckPath: '/health',
            logExcerpt: 'GET /health 404\nCannot GET /health'
          }
        })
      ],
      secrets: [],
      appLogs: [],
      postgres: { enabled: false, logs: [] }
    });

    expect(packet.rootCauseCategory).toBe('missing_health_route');
    expect(packet.healthCheckResult.status).toBe('failed');
    expect(packet.suggestedFixPrompt).toContain('health route');
  });

  it('classifies missing manifest required secrets', async () => {
    const packet = await buildDoctorPacket({
      app,
      deployments: [
        deployment({
          manifest: { name: 'okr-dashboard', port: 3000, healthCheckPath: '/health', requiredSecrets: ['OPENAI_API_KEY'] },
          error_code: 'HEALTH_CHECK_FAILED'
        })
      ],
      secrets: [],
      appLogs: [],
      postgres: { enabled: false, logs: [] }
    });

    expect(packet.rootCauseCategory).toBe('missing_env_secret');
    expect(packet.evidence.some((item) => item.value === 'OPENAI_API_KEY')).toBe(true);
  });

  it('classifies localhost database connections from logs', async () => {
    const packet = await buildDoctorPacket({
      app: { ...app, postgres_enabled: true },
      deployments: [deployment({ error_code: 'HEALTH_CHECK_FAILED' })],
      secrets: [],
      appLogs: ['Error: connect ECONNREFUSED 127.0.0.1:5432'],
      postgres: { enabled: true, logs: [] }
    });

    expect(packet.rootCauseCategory).toBe('database_connection_localhost');
    expect(packet.suggestedFixPrompt).toContain('DATABASE_URL');
  });

  it('stores OpenRouter API keys encrypted and exposes only configured flags', async () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://vibestack:vibestack@localhost:5432/vibestack',
      VIBESTACK_SECRET_KEY: 'test-secret-key-for-doctor-settings'
    });
    const rows = new Map<string, unknown>();
    const db = {
      maybeOne: async () => {
        const value = rows.get('openRouter');
        return value ? { value_json: value } : null;
      }
    } as unknown as Db;

    const setting = await normalizeOpenRouterSetting(db, config, {
      enabled: true,
      model: 'openai/gpt-5.5',
      apiKey: 'sk-or-test'
    });
    rows.set('openRouter', setting);

    expect(setting.encryptedApiKey).toMatch(/^v1:/);
    expect(decryptSecret(setting.encryptedApiKey ?? '', config.secretKey)).toBe('sk-or-test');
    expect(publicOpenRouterSetting(setting)).toEqual({
      enabled: true,
      model: 'openai/gpt-5.5',
      configured: true,
      apiKeyConfigured: true
    });
  });
});
