import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { Config } from './config.js';
import { getSelfUpdateStatus } from './updater.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd, timeout: 60_000 });
}

function testConfig(sourceDir: string, repoUrl: string, channel: string): Config {
  return {
    nodeEnv: 'test',
    port: 3000,
    publicUrl: 'http://localhost:3000',
    baseDomain: 'localdomain',
    installDir: sourceDir,
    sourceDir,
    repoUrl,
    updateChannel: channel,
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

async function prepareCheckout(channel: string, currentRelease: string, latestRelease: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibestack-updater-'));
  const upstream = path.join(root, 'upstream');
  const origin = path.join(root, 'origin.git');
  const install = path.join(root, 'install');

  await git(root, ['init', upstream]);
  await git(upstream, ['config', 'user.email', 'vibestack@test.local']);
  await git(upstream, ['config', 'user.name', 'VibeStack Test']);
  await writeFile(path.join(upstream, 'package.json'), `${JSON.stringify({ vibestackRelease: currentRelease })}\n`);
  await git(upstream, ['add', 'package.json']);
  await git(upstream, ['commit', '-m', 'initial release']);
  await git(upstream, ['branch', '-M', channel]);
  await git(root, ['init', '--bare', origin]);
  await git(upstream, ['remote', 'add', 'origin', origin]);
  await git(upstream, ['push', '-u', 'origin', channel]);
  await git(root, ['clone', '--branch', channel, origin, install]);

  await writeFile(path.join(upstream, 'package.json'), `${JSON.stringify({ vibestackRelease: latestRelease })}\n`);
  await writeFile(path.join(upstream, 'README.md'), '# Updated\n');
  await git(upstream, ['add', 'package.json', 'README.md']);
  await git(upstream, ['commit', '-m', 'move channel']);
  await git(upstream, ['push', 'origin', channel]);

  return {
    config: testConfig(install, origin, channel),
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}

describe('self updater release channels', () => {
  it('does not offer stable updates when only the branch revision changed', async () => {
    const checkout = await prepareCheckout('stable', '0.2a', '0.2a');
    try {
      const status = await getSelfUpdateStatus(checkout.config, true);
      expect(status.updateMode).toBe('version');
      expect(status.currentVersion).toBe('0.2a');
      expect(status.latestVersion).toBe('0.2a');
      expect(status.currentRevision).not.toBe(status.latestRevision);
      expect(status.updateAvailable).toBe(false);
    } finally {
      await checkout.cleanup();
    }
  });

  it('offers stable updates when the release version changed', async () => {
    const checkout = await prepareCheckout('stable', '0.2a', '0.2b');
    try {
      const status = await getSelfUpdateStatus(checkout.config, true);
      expect(status.updateMode).toBe('version');
      expect(status.latestVersion).toBe('0.2b');
      expect(status.updateAvailable).toBe(true);
    } finally {
      await checkout.cleanup();
    }
  });

  it('offers nightly updates when the branch revision changed', async () => {
    const checkout = await prepareCheckout('nightly', '0.2a', '0.2a');
    try {
      const status = await getSelfUpdateStatus(checkout.config, true);
      expect(status.updateMode).toBe('revision');
      expect(status.currentVersion).toBe('0.2a');
      expect(status.latestVersion).toBe('0.2a');
      expect(status.currentRevision).not.toBe(status.latestRevision);
      expect(status.updateAvailable).toBe(true);
    } finally {
      await checkout.cleanup();
    }
  });

  it('marks missing update channels unavailable instead of up to date', async () => {
    const checkout = await prepareCheckout('stable', '0.2a', '0.2a');
    try {
      const status = await getSelfUpdateStatus(checkout.config, true, 'beta');
      expect(status.updateMode).toBe('version');
      expect(status.sourceAvailable).toBe(false);
      expect(status.state).toBe('unavailable');
      expect(status.updateAvailable).toBe(false);
      expect(status.latestVersion).toBeUndefined();
      expect(status.message).toContain('origin/beta');
    } finally {
      await checkout.cleanup();
    }
  });
});
