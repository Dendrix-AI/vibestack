import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { bootstrapFirstAdmin } from './bootstrap.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations(): Promise<void> {
  const config = loadConfig();
  const db = createDb(config);
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.query('SELECT set_config($1, $2, false)', ['vibestack.base_domain', config.baseDomain]);

    const migrationsDir = path.resolve(dirname, '../migrations');
    const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
    const knownMigrations = new Set(files);
    const applied = await db.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
    const unsupported = applied.rows.map((row) => row.name).filter((name) => !knownMigrations.has(name));
    if (unsupported.length > 0) {
      throw new Error(
        `Database schema is newer than this VibeStack build. Unsupported migrations: ${unsupported.join(', ')}`
      );
    }

    for (const file of files) {
      const existing = await db.maybeOne<{ name: string }>('SELECT name FROM schema_migrations WHERE name = $1', [file]);
      if (existing) {
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      await db.transaction(async (client) => {
        await client.query('SELECT set_config($1, $2, true)', ['vibestack.base_domain', config.baseDomain]);
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      });
      console.log(`Applied migration ${file}`);
    }

    await bootstrapFirstAdmin(db, config);
  } finally {
    await db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
