import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config.js';
import { decryptSecret, encryptSecret } from '../crypto.js';
import type { Db } from '../db.js';
import { buildAndRun, DeploymentRuntimeError } from './runtime.js';
import { commitSource } from './git.js';
import { extractAndValidate } from './validation.js';
import { upsertCloudflareDnsRecord } from '../cloudflare.js';
import { pruneAppDockerImages } from '../runtime-cleanup.js';

export async function processDeployment(db: Db, config: Config, deploymentId: string): Promise<void> {
  const deployment = await db.query(
    `SELECT d.*,
            a.id AS app_id,
            a.hostname,
            a.postgres_enabled,
            a.current_deployment_id,
            source.docker_image_tag AS rollback_image_tag
     FROM deployments d
     JOIN apps a ON a.id = d.app_id
     LEFT JOIN deployments source ON source.id = d.rollback_source_deployment_id
     WHERE d.id = $1`,
    [deploymentId]
  );
  const row = deployment.rows[0];
  if (!row) throw new Error(`Deployment ${deploymentId} not found`);

  try {
    await setStatus(db, deploymentId, 'validating');
    const uploadPath = path.join(config.dataDir, 'uploads', deploymentId, 'source.tar.gz');
    const sourceDir = path.join(config.dataDir, 'builds', deploymentId);

    let manifest = row.manifest;
    let sourceCommitSha = row.source_commit_sha as string | null;

    if (row.type === 'deploy') {
      const validation = await extractAndValidate(uploadPath, sourceDir);
      if (!validation.ok) {
        await fail(db, deploymentId, row.app_id, validation.code, validation.message, validation.details);
        return;
      }
      manifest = validation.manifest;
      sourceCommitSha = await commitSource(config, row.app_id, sourceDir, `Deploy ${deploymentId}`);
    } else if (!row.rollback_image_tag) {
      await fail(db, deploymentId, row.app_id, 'ROLLBACK_IMAGE_MISSING', 'Rollback source image is not available.', {
        rollbackSourceDeploymentId: row.rollback_source_deployment_id
      });
      return;
    }

    await setStatus(db, deploymentId, 'building');
    await fs.mkdir(path.join(config.dataDir, 'apps', row.app_id, 'data'), { recursive: true });
    const env = await buildEnv(db, config, row.app_id, Boolean(row.postgres_enabled));
    const runtime = await buildAndRun({
      config,
      appId: row.app_id,
      deploymentId,
      hostname: row.hostname,
      sourceDir,
      manifest,
      env,
      existingImageTag: row.type === 'rollback' ? row.rollback_image_tag : null,
      previousDeploymentId: row.current_deployment_id
    });

    await setStatus(db, deploymentId, 'routing');
    await db.transaction(async (client) => {
      await client.query(
        `UPDATE deployments
         SET status = 'succeeded',
             source_commit_sha = $2,
             docker_image_tag = $3,
             manifest = $4,
             log_excerpt = $5,
             finished_at = now()
         WHERE id = $1`,
        [
          deploymentId,
          sourceCommitSha,
          runtime.imageTag,
          JSON.stringify(manifest),
          runtime.logExcerpt ?? null
        ]
      );
      await client.query(
        `UPDATE apps
         SET status = 'running', current_deployment_id = $2, updated_at = now()
         WHERE id = $1`,
        [row.app_id, deploymentId]
      );
      await client.query(
        `INSERT INTO app_events (app_id, deployment_id, event_type, message)
         VALUES ($1, $2, $3, $4)`,
        [row.app_id, deploymentId, 'deployment.succeeded', `Deployment ${deploymentId} succeeded.`]
      );
    });
    await afterSuccessfulDeployment(db, config, row.app_id, row.hostname);
  } catch (error) {
    if (error instanceof DeploymentRuntimeError) {
      await fail(db, deploymentId, row.app_id, error.code, error.message, error.details);
      return;
    }
    await fail(db, deploymentId, row.app_id, 'DEPLOYMENT_FAILED', 'Deployment failed.', {
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

async function afterSuccessfulDeployment(db: Db, config: Config, appId: string, hostname: string): Promise<void> {
  await upsertCloudflareDnsRecord({ db, config, hostname })
    .then(async (result) => {
      if (result.skipped) return;
      await db.query(
        `INSERT INTO app_events (app_id, event_type, message, metadata_json)
         VALUES ($1, 'dns.updated', $2, $3)`,
        [appId, `Cloudflare DNS record ${result.action}.`, JSON.stringify(result)]
      );
    })
    .catch(async (error) => {
      await db.query(
        `INSERT INTO app_events (app_id, event_type, message, metadata_json)
         VALUES ($1, 'dns.update_failed', $2, $3)`,
        [
          appId,
          'Cloudflare DNS update failed.',
          JSON.stringify({ reason: error instanceof Error ? error.message : String(error) })
        ]
      );
    });
  await pruneAppDockerImages(db, config, appId)
    .then(async (deletedImageTags) => {
      if (deletedImageTags.length === 0) return;
      await db.query(
        `INSERT INTO app_events (app_id, event_type, message, metadata_json)
         VALUES ($1, 'runtime.images_pruned', $2, $3)`,
        [
          appId,
          `Pruned ${deletedImageTags.length} old Docker image${deletedImageTags.length === 1 ? '' : 's'}.`,
          JSON.stringify({ imageTags: deletedImageTags })
        ]
      );
    })
    .catch(async (error) => {
      await db.query(
        `INSERT INTO app_events (app_id, event_type, message, metadata_json)
         VALUES ($1, 'runtime.image_prune_failed', $2, $3)`,
        [
          appId,
          'Docker image pruning failed.',
          JSON.stringify({ reason: error instanceof Error ? error.message : String(error) })
        ]
      );
    });
}

async function setStatus(db: Db, deploymentId: string, status: string): Promise<void> {
  await db.query('UPDATE deployments SET status = $2 WHERE id = $1', [deploymentId, status]);
}

async function fail(
  db: Db,
  deploymentId: string,
  appId: string,
  code: string,
  message: string,
  details?: Record<string, unknown>
): Promise<void> {
  await db.transaction(async (client) => {
    await client.query(
      `UPDATE deployments
       SET status = 'failed', error_code = $2, error_message = $3,
           error_details_json = $4, finished_at = now()
       WHERE id = $1`,
      [deploymentId, code, message, JSON.stringify(details ?? {})]
    );
    const current = await client.query('SELECT current_deployment_id FROM apps WHERE id = $1', [appId]);
    await client.query("UPDATE apps SET status = $2, updated_at = now() WHERE id = $1", [
      appId,
      current.rows[0]?.current_deployment_id ? 'running' : 'failed'
    ]);
    await client.query(
      `INSERT INTO app_events (app_id, deployment_id, event_type, message, metadata_json)
       VALUES ($1, $2, 'deployment.failed', $3, $4)`,
      [appId, deploymentId, message, JSON.stringify({ code, details })]
    );
  });
}

async function buildEnv(db: Db, config: Config, appId: string, postgresEnabled: boolean): Promise<Record<string, string>> {
  const env: Record<string, string> = {
    VIBESTACK_APP_ID: appId,
    VIBESTACK_DATA_DIR: '/data'
  };
  const secrets = await db.query<{ key: string; encrypted_value: string }>(
    'SELECT key, encrypted_value FROM app_secrets WHERE app_id = $1',
    [appId]
  );
  for (const secret of secrets.rows) {
    env[secret.key] = decryptSecret(secret.encrypted_value, config.secretKey);
  }
  if (postgresEnabled) {
    const database = await ensureAppDatabase(db, config, appId);
    env.DATABASE_URL = database.url;
  }
  return env;
}

async function ensureAppDatabase(db: Db, config: Config, appId: string): Promise<{ url: string }> {
  const existing = await db.query<{
    database_name: string;
    database_user: string;
    encrypted_database_password: string;
  }>(
    'SELECT database_name, database_user, encrypted_database_password FROM app_db_credentials WHERE app_id = $1 AND deleted_at IS NULL',
    [appId]
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    return {
      url: `postgres://${row.database_user}:${encodeURIComponent(
        decryptSecret(row.encrypted_database_password, config.secretKey)
      )}@localhost:5432/${row.database_name}`
    };
  }

  const safeId = appId.replace(/[^a-zA-Z0-9]/g, '_');
  const databaseName = `app_${safeId}`;
  const databaseUser = `user_${safeId}`;
  const password = crypto.randomUUID().replaceAll('-', '');
  await db.query(`CREATE DATABASE ${databaseName}`);
  await db.query(`CREATE USER ${databaseUser} WITH PASSWORD '${password.replaceAll("'", "''")}'`);
  await db.query(`GRANT ALL PRIVILEGES ON DATABASE ${databaseName} TO ${databaseUser}`);
  await db.query(
    `INSERT INTO app_db_credentials (app_id, database_name, database_user, encrypted_database_password)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (app_id) DO UPDATE SET deleted_at = NULL
     RETURNING id`,
    [appId, databaseName, databaseUser, encryptSecret(password, config.secretKey)]
  );
  return {
    url: `postgres://${databaseUser}:${encodeURIComponent(password)}@localhost:5432/${databaseName}`
  };
}
