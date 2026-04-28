import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { AppRow } from './types.js';
import { deleteCloudflareDnsRecord } from './cloudflare.js';
import { deleteContainersForApp, pruneDockerImages } from './deployment/runtime.js';

export async function pruneAppDockerImages(db: Db, config: Config, appId: string): Promise<string[]> {
  if (config.runtimeDriver !== 'docker') return [];
  const rows = await db.query<{ docker_image_tag: string }>(
    `SELECT docker_image_tag
     FROM deployments
     WHERE app_id = $1 AND status = 'succeeded' AND docker_image_tag IS NOT NULL
     ORDER BY version_number DESC`,
    [appId]
  );
  const tags = rows.rows.map((row) => row.docker_image_tag);
  const retainedTags = new Set(tags.slice(0, 3));
  const deleteTags = tags.slice(3).filter((tag) => !retainedTags.has(tag));
  await pruneDockerImages(deleteTags);
  return deleteTags;
}

export async function hardDeleteApp(db: Db, config: Config, appId: string): Promise<{ deleted: boolean }> {
  const app = await db.maybeOne<AppRow>('SELECT * FROM apps WHERE id = $1', [appId]);
  if (!app) return { deleted: false };

  await db.query("UPDATE apps SET status = 'deleting', updated_at = now() WHERE id = $1", [appId]);

  const deploymentIds = (
    await db.query<{ id: string }>('SELECT id FROM deployments WHERE app_id = $1', [appId])
  ).rows.map((row) => row.id);

  await deleteCloudflareDnsRecord({ db, config, hostname: app.hostname }).catch(() => undefined);

  if (config.runtimeDriver === 'docker') {
    await deleteContainersForApp(config, appId);
    const imageRows = await db.query<{ docker_image_tag: string }>(
      'SELECT DISTINCT docker_image_tag FROM deployments WHERE app_id = $1 AND docker_image_tag IS NOT NULL',
      [appId]
    );
    await pruneDockerImages(imageRows.rows.map((row) => row.docker_image_tag));
  }

  await Promise.all([
    fs.rm(path.join(config.dataDir, 'apps', appId), { recursive: true, force: true }),
    fs.rm(path.join(config.dataDir, 'repos', `${appId}.git`), { recursive: true, force: true }),
    removeAppWorktrees(config, appId)
  ]);
  await Promise.all(
    deploymentIds.flatMap((deploymentId) => [
      fs.rm(path.join(config.dataDir, 'uploads', deploymentId), { recursive: true, force: true }),
      fs.rm(path.join(config.dataDir, 'builds', deploymentId), { recursive: true, force: true })
    ])
  );

  await db.transaction(async (client) => {
    await client.query('DELETE FROM app_secrets WHERE app_id = $1', [appId]);
    await client.query('DELETE FROM app_db_credentials WHERE app_id = $1', [appId]);
    await client.query(
      `UPDATE apps
       SET status = 'deleting',
           current_deployment_id = NULL,
           deleted_at = COALESCE(deleted_at, now()),
           updated_at = now()
       WHERE id = $1`,
      [appId]
    );
  });

  return { deleted: true };
}

async function removeAppWorktrees(config: Config, appId: string): Promise<void> {
  const worktreeRoot = path.join(config.dataDir, 'git-worktrees');
  const entries = await fs.readdir(worktreeRoot, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${appId}-`))
      .map((entry) => fs.rm(path.join(worktreeRoot, entry.name), { recursive: true, force: true }))
  );
}
