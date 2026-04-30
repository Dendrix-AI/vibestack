import { describe, expect, it } from 'vitest';
import {
  DeploymentRuntimeError,
  dockerAppLabel,
  dockerContainerName,
  dockerDeploymentLabel,
  dockerImageTag,
  traefikLabels
} from './runtime.js';
import { loadConfig } from '../config.js';

describe('docker runtime helpers', () => {
  it('uses predictable names and labels', () => {
    expect(dockerImageTag('app-1', 'dep-2')).toBe('vibestack/app-app-1:deploy-dep-2');
    expect(dockerContainerName('app-1', 'dep-2')).toBe('vstk-app1-dep2');
    expect(dockerContainerName('app-1', 'dep-2', 'candidate')).toBe('vstk-app1-dep2-cand');
    expect(
      dockerContainerName(
        '166cf8a0-ba7b-49d8-b813-bf4c732af6b8',
        '8b6a014b-716a-4961-b6f5-17e8a15c5a7f',
        'candidate'
      ).length
    ).toBeLessThanOrEqual(63);
    expect(dockerAppLabel('app-1')).toBe('com.vibestack.app_id=app-1');
    expect(dockerDeploymentLabel('dep-2')).toBe('com.vibestack.deployment_id=dep-2');
  });

  it('attaches public Traefik labels with forward auth middleware', () => {
    const labels = traefikLabels({
      config: loadConfig({ DATABASE_URL: 'postgres://vibestack:vibestack@localhost:5432/vibestack' }),
      appId: 'app-1',
      deploymentId: 'dep-2',
      hostname: 'demo.example.com',
      port: 3000
    });

    expect(labels).toContain('traefik.enable=true');
    expect(labels).toContain('traefik.docker.network=vibestack_apps');
    expect(labels).toContain('traefik.http.routers.vibestack-app-1-dep-2.rule=Host(`demo.example.com`)');
    expect(labels).toContain('traefik.http.routers.vibestack-app-1-dep-2.entrypoints=websecure');
    expect(labels).toContain('traefik.http.routers.vibestack-app-1-dep-2.tls=true');
    expect(labels).toContain('traefik.http.routers.vibestack-app-1-dep-2.tls.certresolver=letsencrypt');
    expect(labels).toContain('traefik.http.routers.vibestack-app-1-dep-2.middlewares=vibestack-auth-vibestack-app-1-dep-2@docker');
    expect(labels).toContain(
      'traefik.http.middlewares.vibestack-auth-vibestack-app-1-dep-2.forwardauth.address=http://api:3000/api/v1/gateway/forward-auth'
    );
    expect(labels).toContain('traefik.http.services.vibestack-app-1-dep-2.loadbalancer.server.port=3000');
  });

  it('carries stable deployment runtime error details', () => {
    const error = new DeploymentRuntimeError('HEALTH_CHECK_FAILED', 'Health check failed.', {
      port: 3000,
      healthCheckPath: '/health',
      agentHint: 'Fix the health route.'
    });

    expect(error.code).toBe('HEALTH_CHECK_FAILED');
    expect(error.message).toBe('Health check failed.');
    expect(error.details).toMatchObject({
      port: 3000,
      healthCheckPath: '/health',
      agentHint: 'Fix the health route.'
    });
  });
});
