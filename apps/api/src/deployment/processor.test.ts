import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { appDatabaseUrl } from './processor.js';

describe('deployment processor database environment', () => {
  it('builds app DATABASE_URL with the app-reachable Postgres host', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://vibestack:vibestack@postgres:5432/vibestack',
      VIBESTACK_APP_POSTGRES_HOST: 'postgres',
      VIBESTACK_APP_POSTGRES_PORT: '5432'
    });

    expect(appDatabaseUrl(config, 'app_user', 'p@ss word', 'app_db')).toBe(
      'postgres://app_user:p%40ss%20word@postgres:5432/app_db'
    );
  });
});
