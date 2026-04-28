import { describe, expect, it } from 'vitest';
import { buildAppHostname, createApiError, slugify, VibestackManifestSchema } from './index.js';

describe('shared platform helpers', () => {
  it('slugifies names for stable URLs', () => {
    expect(slugify('Sales Dashboard!')).toBe('sales-dashboard');
  });

  it('builds managed app hostnames', () => {
    expect(buildAppHostname('finance', 'sales-dashboard', 'localdomain')).toBe(
      'finance-sales-dashboard.localdomain'
    );
  });

  it('validates VibeStack manifests', () => {
    expect(
      VibestackManifestSchema.parse({
        name: 'sales-dashboard',
        port: 3000,
        healthCheckPath: '/',
        persistent: true
      })
    ).toMatchObject({ name: 'sales-dashboard', port: 3000 });
  });

  it('accepts optional Postgres manifests and required secret names', () => {
    expect(
      VibestackManifestSchema.parse({
        name: 'ops-dashboard',
        port: 8080,
        healthCheckPath: '/health',
        persistent: false,
        requiredSecrets: ['API_TOKEN', 'STRIPE_SECRET_KEY'],
        postgres: true
      })
    ).toMatchObject({
      name: 'ops-dashboard',
      postgres: true,
      requiredSecrets: ['API_TOKEN', 'STRIPE_SECRET_KEY']
    });
  });

  it('rejects invalid manifest names, ports, and secret names', () => {
    const result = VibestackManifestSchema.safeParse({
      name: 'Sales Dashboard',
      port: 70000,
      healthCheckPath: 'health',
      persistent: true,
      requiredSecrets: ['api-token']
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual(
        expect.arrayContaining(['name', 'port', 'healthCheckPath', 'requiredSecrets.0'])
      );
    }
  });

  it('creates stable API error response shapes', () => {
    expect(
      createApiError('INVALID_MANIFEST', 'vibestack.json is invalid.', 'Fix the manifest.', {
        field: 'port'
      })
    ).toEqual({
      error: {
        code: 'INVALID_MANIFEST',
        message: 'vibestack.json is invalid.',
        agentHint: 'Fix the manifest.',
        details: {
          field: 'port'
        }
      }
    });
  });
});
