import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer, deploymentResponse } from './server.js';
import { loadConfig } from './config.js';
import { hashPassword } from './crypto.js';
import type { Db } from './db.js';
import type { AppRow, DeploymentRow } from './types.js';

const appId = 'de52380f-282b-44de-a741-17118f331b01';
const teamId = '8f90c863-78f2-4837-a98b-02b812ef765d';
const userId = 'b2f2f26f-3a5c-4226-844f-b54808bd7baf';

const appRow: AppRow & { external_password_hash: string } = {
  id: appId,
  team_id: teamId,
  name: 'okr-dashboard',
  slug: 'okr-dashboard',
  hostname: 'platform-admins-okr-dashboard.example.com',
  status: 'running',
  creator_user_id: userId,
  last_updated_by_user_id: null,
  current_deployment_id: null,
  postgres_enabled: false,
  external_password_enabled: true,
  external_password_hash: '',
  login_access_enabled: true,
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null
};

let servers: FastifyInstance[] = [];

describe('gateway external password flow', () => {
  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
    servers = [];
  });

  it('redirects unauthenticated external-password apps to a password page', async () => {
    const server = await testServer({ ...appRow, external_password_hash: await hashPassword('external-pass') });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/gateway/forward-auth',
      headers: {
        'x-forwarded-host': appRow.hostname,
        'x-forwarded-proto': 'https',
        'x-forwarded-uri': '/reports?quarter=q2'
      }
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain(`/api/v1/gateway/apps/${appId}/password`);
    expect(response.headers.location).toContain(encodeURIComponent(`https://${appRow.hostname}/reports?quarter=q2`));
  });

  it('sets the external password cookie and redirects back to the app', async () => {
    const server = await testServer({ ...appRow, external_password_hash: await hashPassword('external-pass') });

    const next = `https://${appRow.hostname}/reports`;
    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/gateway/apps/${appId}/password`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ password: 'external-pass', next }).toString()
    });

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe(next);
    expect(response.headers['set-cookie']).toContain('Domain=example.com');
  });

  it('renders a branded external password page', async () => {
    const server = await testServer({ ...appRow, external_password_hash: await hashPassword('external-pass') });

    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/gateway/apps/${appId}/password?next=${encodeURIComponent(`https://${appRow.hostname}/reports`)}`
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Dendrix AI logo');
    expect(response.body).toContain('/api/v1/brand/dendrix-logo.png');
    expect(response.body).toContain('Learn about Dendrix AI');
    expect(response.body).toContain('https://dendrix.ai');
    expect(response.body).toContain('background: var(--accent)');
  });
});

describe('deployment response serialization', () => {
  it('redacts secret values from stored deployment manifests', () => {
    const deployment: DeploymentRow = {
      id: 'deployment-1',
      app_id: appId,
      version_number: 1,
      type: 'deploy',
      source_commit_sha: null,
      source_tarball_sha256: null,
      docker_image_tag: null,
      manifest: {
        appName: 'security-tv-dashboard',
        access: {
          loginRequired: true,
          externalPasswordEnabled: true,
          externalPassword: 'plain-password'
        },
        secrets: {
          ELASTIC_API_KEY: 'elastic-secret',
          JIRA_API_TOKEN: 'jira-secret'
        }
      },
      status: 'queued',
      started_by_user_id: userId,
      rollback_source_deployment_id: null,
      error_code: null,
      error_message: null,
      error_details_json: null,
      log_excerpt: null,
      started_at: new Date(),
      finished_at: null,
      created_at: new Date()
    };

    expect(deploymentResponse(deployment).manifest).toEqual({
      appName: 'security-tv-dashboard',
      access: {
        loginRequired: true,
        externalPasswordEnabled: true,
        externalPassword: '[redacted]'
      },
      secrets: {
        ELASTIC_API_KEY: '[redacted]',
        JIRA_API_TOKEN: '[redacted]'
      }
    });
  });
});

async function testServer(row: AppRow & { external_password_hash: string }): Promise<FastifyInstance> {
  const db = {
    maybeOne: async () => row,
    query: async () => ({ rows: [], rowCount: 1 })
  } as unknown as Db;
  const server = await buildServer({
    config: loadConfig({
      DATABASE_URL: 'postgres://vibestack:vibestack@localhost:5432/vibestack',
      VIBESTACK_PUBLIC_URL: 'https://vibestack.example.com',
      VIBESTACK_COOKIE_DOMAIN: 'example.com'
    }),
    db
  });
  servers.push(server);
  return server;
}
