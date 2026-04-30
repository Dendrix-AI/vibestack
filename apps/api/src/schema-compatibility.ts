import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Config } from './config.js';
import type { Db } from './db.js';

const execFileAsync = promisify(execFile);

export type SchemaCompatibility = {
  compatible: boolean;
  currentMigrations: string[];
  targetMigrations: string[];
  missingInTarget: string[];
  pendingInTarget: string[];
  backupRecommended: boolean;
  message?: string;
};

async function git(config: Config, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', config.sourceDir, ...args], {
    timeout: 60_000,
    maxBuffer: 1024 * 1024
  });
  return stdout.trim();
}

export async function appliedMigrations(db: Db): Promise<string[]> {
  const exists = await db.maybeOne<{ exists: boolean }>(
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists"
  );
  if (!exists?.exists) return [];

  const rows = await db.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
  return rows.rows.map((row) => row.name);
}

export async function migrationsForRef(config: Config, ref: string): Promise<string[]> {
  const output = await git(config, ['ls-tree', '-r', '--name-only', ref, 'apps/api/migrations']);
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.sql'))
    .map((line) => line.split('/').pop())
    .filter((name): name is string => Boolean(name))
    .sort();
}

export async function schemaCompatibilityForRef(db: Db, config: Config, ref: string): Promise<SchemaCompatibility> {
  const currentMigrations = await appliedMigrations(db);
  const targetMigrations = await migrationsForRef(config, ref);
  const targetSet = new Set(targetMigrations);
  const currentSet = new Set(currentMigrations);
  const missingInTarget = currentMigrations.filter((name) => !targetSet.has(name));
  const pendingInTarget = targetMigrations.filter((name) => !currentSet.has(name));
  const compatible = missingInTarget.length === 0;

  return {
    compatible,
    currentMigrations,
    targetMigrations,
    missingInTarget,
    pendingInTarget,
    backupRecommended: pendingInTarget.length > 0,
    message: compatible
      ? pendingInTarget.length > 0
        ? 'The target version includes database migrations. Create a backup before updating.'
        : undefined
      : `The database has migrations that are not present in ${ref}: ${missingInTarget.join(', ')}.`
  };
}
