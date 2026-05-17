import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Config } from '../config.js';

const exec = promisify(execFile);

const EXCLUDED_SOURCE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  'env',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache'
]);

const EXCLUDED_SOURCE_FILES = new Set(['.DS_Store', '.env']);

export function sourceRepoPath(config: Config, appId: string): string {
  return path.join(config.dataDir, 'repos', `${appId}.git`);
}

export async function commitSource(config: Config, appId: string, sourceDir: string, message: string): Promise<string> {
  const repoPath = sourceRepoPath(config, appId);
  await fs.mkdir(path.dirname(repoPath), { recursive: true });
  try {
    await fs.access(repoPath);
  } catch {
    await exec('git', ['init', '--bare', repoPath]);
    await exec('git', ['--git-dir', repoPath, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  }

  const workTree = path.join(config.dataDir, 'git-worktrees', `${appId}-${Date.now()}`);
  await fs.rm(workTree, { recursive: true, force: true });
  await fs.mkdir(path.dirname(workTree), { recursive: true });
  await exec('git', ['clone', '--branch', 'main', repoPath, workTree]).catch(async () => {
    await fs.rm(workTree, { recursive: true, force: true });
    await exec('git', ['clone', repoPath, workTree]);
    await exec('git', ['-C', workTree, 'checkout', '--orphan', 'main']);
  });
  await emptyWorkTree(workTree);
  await copyDir(sourceDir, workTree);
  await exec('git', ['-C', workTree, 'add', '.']);

  const status = await exec('git', ['-C', workTree, 'status', '--porcelain']);
  if (!status.stdout.trim()) {
    const current = await exec('git', ['-C', workTree, 'rev-parse', 'HEAD']).catch(() => ({ stdout: '' }));
    await fs.rm(workTree, { recursive: true, force: true });
    return current.stdout.trim();
  }

  await exec('git', ['-C', workTree, 'config', 'user.email', 'vibestack@local']);
  await exec('git', ['-C', workTree, 'config', 'user.name', 'VibeStack']);
  await exec('git', ['-C', workTree, 'commit', '-m', message]);
  await exec('git', ['-C', workTree, 'push', 'origin', 'HEAD:main']);
  await exec('git', ['--git-dir', repoPath, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  const sha = (await exec('git', ['-C', workTree, 'rev-parse', 'HEAD'])).stdout.trim();
  await fs.rm(workTree, { recursive: true, force: true });
  return sha;
}

export async function sourceSnapshotExists(config: Config, appId: string, commitSha?: string | null): Promise<boolean> {
  const repoPath = sourceRepoPath(config, appId);
  try {
    await fs.access(repoPath);
    if (commitSha) {
      await exec('git', ['--git-dir', repoPath, 'rev-parse', '--verify', `${commitSha}^{commit}`]);
    }
    return true;
  } catch {
    return false;
  }
}

export async function createSourceArchive(
  config: Config,
  appId: string,
  commitSha: string,
  outputPath: string
): Promise<void> {
  const repoPath = sourceRepoPath(config, appId);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await exec('git', ['--git-dir', repoPath, 'archive', '--format=tar.gz', `--output=${outputPath}`, commitSha]);
}

async function emptyWorkTree(workTree: string): Promise<void> {
  for (const entry of await fs.readdir(workTree, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    await fs.rm(path.join(workTree, entry.name), { recursive: true, force: true });
  }
}

async function copyDir(source: string, destination: string): Promise<void> {
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (shouldExcludeSourceEntry(entry.name)) continue;
    if (entry.isDirectory()) {
      await fs.mkdir(to, { recursive: true });
      await copyDir(from, to);
    } else if (entry.isFile()) {
      await fs.copyFile(from, to);
    }
  }
}

function shouldExcludeSourceEntry(name: string): boolean {
  if (EXCLUDED_SOURCE_DIRS.has(name) || EXCLUDED_SOURCE_FILES.has(name)) {
    return true;
  }
  return name.startsWith('.env.');
}
