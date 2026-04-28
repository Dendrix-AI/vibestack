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
        RUNTIME_DRIVER: 'docker',
        TRAEFIK_ENTRYPOINT: 'websecure',
        TRAEFIK_CERT_RESOLVER: 'letsencrypt'
      })
    ).toMatchObject({
      port: 4000,
      publicUrl: 'https://vibestack.local.test',
      databaseUrl: 'postgres://vibestack_user:secret@postgres:5433/vibestack_test',
      runtimeDriver: 'docker',
      traefikEntrypoint: 'websecure',
      traefikCertResolver: 'letsencrypt'
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
