import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { loadConfig } from './config.js';

const config = loadConfig();

export const redisConnection = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null
});

export const deploymentQueue = new Queue('deployments', {
  connection: redisConnection
});

export type DeploymentJob = {
  deploymentId: string;
};
