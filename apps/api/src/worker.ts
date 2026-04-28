import { Worker } from 'bullmq';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { runMigrations } from './migrate.js';
import { processDeployment } from './deployment/processor.js';
import { redisConnection } from './queue.js';

async function startWorker(): Promise<void> {
  await runMigrations();
  const config = loadConfig();
  const db = createDb(config);

  const worker = new Worker(
    'deployments',
    async (job) => {
      await processDeployment(db, config, job.data.deploymentId);
    },
    { connection: redisConnection, concurrency: 2 }
  );

  worker.on('completed', (job) => {
    console.log(`Deployment job ${job.id} completed`);
  });
  worker.on('failed', (job, error) => {
    console.error(`Deployment job ${job?.id} failed`, error);
  });

  const shutdown = async () => {
    await worker.close();
    await db.close();
    await redisConnection.quit();
  };

  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  console.log(`VibeStack worker started with ${config.runtimeDriver} runtime driver.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
