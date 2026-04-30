import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { schemaCompatibilityForRef } from './schema-compatibility.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd, timeout: 60_000 });
}

function testConfig(sourceDir: string): Config {
  return {
    nodeEnv: 'test',
    port: 3000,
    publicUrl: 'http://localhost:3000',
    baseDomain: 'localdomain',
    installDir: sourceDir,
    sourceDir,
    repoUrl: sourceDir,
    updateChannel: 'stable',
    dataDir: path.join(sourceDir, '.vibestack-data'),
    sessionSecret: 'test-session-secret',
    secretKey: 'test-secret-key',
    databaseUrl: 'postgres://vibestack:vibestack@localhost:5432/vibestack',
    appPostgresHost: 'postgres',
    appPostgresPort: 5432,
    redisUrl: 'redis://localhost:6379',
    runtimeDriver: 'mock',
    traefikNetwork: 'vibestack_apps',
    traefikEntrypoint: 'websecure',
    traefikCertResolver: 'letsencrypt',
    gatewayAuthUrl: 'http://api:3000/api/v1/gateway/forward-auth'
  };
}

function dbWithAppliedMigrations(names: string[]): Db {
  return {
    maybeOne: async () => ({ exists: true }),
    query: async () => ({ rows: names.map((name) => ({ name })) })
  } as unknown as Db;
}

async function prepareRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibestack-schema-'));
  const migrationsDir = path.join(root, 'apps/api/migrations');
  await git(root, ['init']);
  await git(root, ['config', 'user.email', 'vibestack@test.local']);
  await git(root, ['config', 'user.name', 'VibeStack Test']);
  await mkdir(migrationsDir, { recursive: true });
  await writeFile(path.join(migrationsDir, '001_initial.sql'), 'SELECT 1;\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'initial schema']);
  await writeFile(path.join(migrationsDir, '002_new_table.sql'), 'SELECT 2;\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'new schema']);

  return {
    root,
    config: testConfig(root),
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}

describe('schema compatibility', () => {
  it('allows updates that include pending migrations and recommends a backup', async () => {
    const repo = await prepareRepo();
    try {
      const result = await schemaCompatibilityForRef(
        dbWithAppliedMigrations(['001_initial.sql']),
        repo.config,
        'HEAD'
      );
      expect(result.compatible).toBe(true);
      expect(result.pendingInTarget).toEqual(['002_new_table.sql']);
      expect(result.backupRecommended).toBe(true);
    } finally {
      await repo.cleanup();
    }
  });

  it('blocks downgrades when the target ref lacks applied migrations', async () => {
    const repo = await prepareRepo();
    try {
      const result = await schemaCompatibilityForRef(
        dbWithAppliedMigrations(['001_initial.sql', '002_new_table.sql']),
        repo.config,
        'HEAD~1'
      );
      expect(result.compatible).toBe(false);
      expect(result.missingInTarget).toEqual(['002_new_table.sql']);
      expect(result.message).toContain('002_new_table.sql');
    } finally {
      await repo.cleanup();
    }
  });
});
