import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('API configuration parsing', () => {
  it('builds a database URL from Postgres settings and coerces numeric ports', () => {
    expect(
      loadConfig({
        POSTGRES_USER: 'vibestack_user',
        POSTGRES_PASSWORD: 'secret',
        POSTGRES_HOST: 'postgres',
        POSTGRES_PORT: '5433',
        POSTGRES_DB: 'vibestack_test',
        PORT: '4000',
        VIBESTACK_PUBLIC_URL: 'https://vibestack.local.test',
        VIBESTACK_COOKIE_DOMAIN: 'local.test',
        VIBESTACK_INSTALL_DIR: '/opt/vibestack',
        VIBESTACK_SOURCE_DIR: '/opt/vibestack-source',
        VIBESTACK_REPO_URL: 'https://github.com/example/vibestack.git',
        VIBESTACK_UPDATE_CHANNEL: 'stable',
        RUNTIME_DRIVER: 'docker',
        TRAEFIK_ENTRYPOINT: 'websecure',
        TRAEFIK_CERT_RESOLVER: 'letsencrypt',
        CLOUDFLARE_API_TOKEN: 'cf-token',
        CLOUDFLARE_ZONE_ID: 'cf-zone',
        CLOUDFLARE_TARGET_HOSTNAME: 'vibestack.local.test'
      })
    ).toMatchObject({
      port: 4000,
      publicUrl: 'https://vibestack.local.test',
      cookieDomain: 'local.test',
      installDir: '/opt/vibestack',
      sourceDir: '/opt/vibestack-source',
      repoUrl: 'https://github.com/example/vibestack.git',
      updateChannel: 'stable',
      databaseUrl: 'postgres://vibestack_user:secret@postgres:5433/vibestack_test',
      appPostgresHost: 'postgres',
      appPostgresPort: 5433,
      runtimeDriver: 'docker',
      traefikEntrypoint: 'websecure',
      traefikCertResolver: 'letsencrypt',
      cloudflareApiToken: 'cf-token',
      cloudflareZoneId: 'cf-zone',
      cloudflareTargetHostname: 'vibestack.local.test'
    });
  });

  it('rejects invalid runtime settings', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://vibestack:vibestack@localhost:5432/vibestack',
        RUNTIME_DRIVER: 'dry-run'
      })
    ).toThrow();
  });

  it('rejects placeholder secrets outside development', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://vibestack:vibestack@localhost:5432/vibestack'
      })
    ).toThrow(/VIBESTACK_SESSION_SECRET/);
  });
});
