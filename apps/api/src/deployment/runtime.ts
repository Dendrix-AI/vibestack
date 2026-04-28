import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Config } from '../config.js';
import type { VibeStackManifest } from '@vibestack/shared';

const exec = promisify(execFile);

export type RuntimeResult = {
  imageTag: string;
  containerName?: string;
  logExcerpt?: string;
};

export type DockerRunMode = 'candidate' | 'routed';

const DOCKER_LABEL_APP_ID = 'com.vibestack.app_id';
const DOCKER_LABEL_DEPLOYMENT_ID = 'com.vibestack.deployment_id';

export function dockerImageTag(appId: string, deploymentId: string): string {
  return `vibestack/app-${appId}:deploy-${deploymentId}`;
}

export function dockerContainerName(appId: string, deploymentId: string, mode: DockerRunMode = 'routed'): string {
  return `vibestack-app-${appId}-deploy-${deploymentId}${mode === 'candidate' ? '-candidate' : ''}`;
}

export function dockerAppLabel(appId: string): string {
  return `${DOCKER_LABEL_APP_ID}=${appId}`;
}

export function dockerDeploymentLabel(deploymentId: string): string {
  return `${DOCKER_LABEL_DEPLOYMENT_ID}=${deploymentId}`;
}

export function traefikLabels(input: {
  config: Config;
  appId: string;
  deploymentId: string;
  hostname: string;
  port: number;
}): string[] {
  const routerName = `vibestack-${input.appId}-${input.deploymentId}`.replace(/[^a-zA-Z0-9-]/g, '-');
  const middlewareName = `vibestack-auth-${routerName}`;
  return [
    'traefik.enable=true',
    `traefik.docker.network=${input.config.traefikNetwork}`,
    `traefik.http.routers.${routerName}.rule=Host(\`${input.hostname}\`)`,
    `traefik.http.routers.${routerName}.entrypoints=${input.config.traefikEntrypoint}`,
    `traefik.http.routers.${routerName}.tls=true`,
    `traefik.http.routers.${routerName}.tls.certresolver=${input.config.traefikCertResolver}`,
    `traefik.http.routers.${routerName}.middlewares=${middlewareName}@docker`,
    `traefik.http.middlewares.${middlewareName}.forwardauth.address=${input.config.gatewayAuthUrl}`,
    `traefik.http.middlewares.${middlewareName}.forwardauth.trustForwardHeader=true`,
    `traefik.http.services.${routerName}.loadbalancer.server.port=${input.port}`
  ];
}

export async function buildAndRun(input: {
  config: Config;
  appId: string;
  deploymentId: string;
  hostname: string;
  sourceDir: string;
  manifest: VibeStackManifest;
  env: Record<string, string>;
  existingImageTag?: string | null;
  previousDeploymentId?: string | null;
}): Promise<RuntimeResult> {
  const { config } = input;
  if (config.runtimeDriver === 'mock') {
    return {
      imageTag: `mock/vibestack-${input.appId}:${input.deploymentId}`,
      logExcerpt: 'Mock runtime enabled; Docker build/run skipped.'
    };
  }

  const imageTag = input.existingImageTag ?? dockerImageTag(input.appId, input.deploymentId);
  if (!input.existingImageTag) {
    await exec('docker', ['build', '-t', imageTag, input.sourceDir], { maxBuffer: 5 * 1024 * 1024 });
  }

  const candidateName = await startContainer({ ...input, imageTag, mode: 'candidate' });
  try {
    await waitForHealth(candidateName, input.manifest.port, input.manifest.healthCheckPath);
  } catch (error) {
    await removeContainer(candidateName).catch(() => undefined);
    throw error;
  }

  await removeContainer(candidateName).catch(() => undefined);
  const containerName = await startContainer({ ...input, imageTag, mode: 'routed' });
  if (input.previousDeploymentId) {
    await stopAppContainer(config, input.appId, input.previousDeploymentId);
  }

  return { imageTag, containerName };
}

export async function startAppContainer(input: {
  config: Config;
  appId: string;
  deploymentId: string;
  hostname: string;
  imageTag: string;
  manifest: VibeStackManifest;
  env: Record<string, string>;
}): Promise<string | null> {
  if (input.config.runtimeDriver === 'mock') return null;
  return startContainer({ ...input, mode: 'routed' });
}

async function startContainer(input: {
  config: Config;
  appId: string;
  deploymentId: string;
  hostname: string;
  imageTag: string;
  manifest: VibeStackManifest;
  env: Record<string, string>;
  mode: DockerRunMode;
}): Promise<string> {
  const containerName = dockerContainerName(input.appId, input.deploymentId, input.mode);
  await exec('docker', ['rm', '-f', containerName]).catch(() => undefined);
  const envArgs = Object.entries(input.env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
  const dataPath = path.join(input.config.dataDir, 'apps', input.appId, 'data');
  const labelArgs = [
    '--label',
    dockerAppLabel(input.appId),
    '--label',
    dockerDeploymentLabel(input.deploymentId),
    '--label',
    `com.vibestack.mode=${input.mode}`
  ];
  if (input.mode === 'routed') {
    for (const label of traefikLabels({
      config: input.config,
      appId: input.appId,
      deploymentId: input.deploymentId,
      hostname: input.hostname,
      port: input.manifest.port
    })) {
      labelArgs.push('--label', label);
    }
  }

  await exec('docker', [
    'run',
    '-d',
    '--name',
    containerName,
    '--network',
    input.config.traefikNetwork,
    ...envArgs,
    '-v',
    `${dataPath}:/data`,
    ...labelArgs,
    input.imageTag
  ]);
  return containerName;
}

export async function stopAppContainer(config: Config, appId: string, deploymentId: string): Promise<void> {
  if (config.runtimeDriver === 'mock') return;
  await stopContainer(dockerContainerName(appId, deploymentId));
}

export async function startExistingAppContainer(config: Config, appId: string, deploymentId: string): Promise<void> {
  if (config.runtimeDriver === 'mock') return;
  await exec('docker', ['start', dockerContainerName(appId, deploymentId)]);
}

export async function deleteAppContainer(config: Config, appId: string, deploymentId: string): Promise<void> {
  if (config.runtimeDriver === 'mock') return;
  await removeContainer(dockerContainerName(appId, deploymentId));
  await removeContainer(dockerContainerName(appId, deploymentId, 'candidate'));
}

export async function stopContainersForApp(config: Config, appId: string): Promise<void> {
  if (config.runtimeDriver === 'mock') return;
  const names = await containersForApp(appId);
  await Promise.all(names.map((name) => stopContainer(name)));
}

export async function deleteContainersForApp(config: Config, appId: string): Promise<void> {
  if (config.runtimeDriver === 'mock') return;
  const names = await containersForApp(appId);
  await Promise.all(names.map((name) => removeContainer(name)));
}

export async function dockerLogsForDeployment(
  config: Config,
  appId: string,
  deploymentId: string,
  tail = 200
): Promise<string | null> {
  if (config.runtimeDriver === 'mock') return null;
  const containerName = dockerContainerName(appId, deploymentId);
  const exists = await containerExists(containerName);
  if (!exists) return null;
  const result = await exec('docker', ['logs', '--tail', String(tail), containerName], { maxBuffer: 2 * 1024 * 1024 });
  return [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
}

export async function removeDockerImage(imageTag: string): Promise<void> {
  await exec('docker', ['image', 'rm', '-f', imageTag]).catch(() => undefined);
}

export async function pruneDockerImages(imageTagsToDelete: string[]): Promise<void> {
  await Promise.all([...new Set(imageTagsToDelete)].map((imageTag) => removeDockerImage(imageTag)));
}

async function containerExists(containerName: string): Promise<boolean> {
  const result = await exec('docker', ['container', 'inspect', containerName]).catch(() => null);
  return Boolean(result);
}

async function containersForApp(appId: string): Promise<string[]> {
  const result = await exec('docker', [
    'ps',
    '-a',
    '--filter',
    `label=${DOCKER_LABEL_APP_ID}=${appId}`,
    '--format',
    '{{.Names}}'
  ]).catch(() => ({ stdout: '' }));
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

async function stopContainer(containerName: string): Promise<void> {
  await exec('docker', ['stop', containerName]).catch(() => undefined);
}

async function removeContainer(containerName: string): Promise<void> {
  await exec('docker', ['rm', '-f', containerName]).catch(() => undefined);
}

async function waitForHealth(containerName: string, port: number, healthPath: string): Promise<void> {
  const pathOnly = healthPath.startsWith('/') ? healthPath : `/${healthPath}`;
  const command = `node -e "fetch('http://127.0.0.1:${port}${pathOnly}').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const result = await exec('docker', ['exec', containerName, 'sh', '-lc', command]).catch((error) => error);
    if (!('code' in result) || result.code === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Container did not pass health check on port ${port}${pathOnly}`);
}
