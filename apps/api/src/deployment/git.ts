import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Config } from '../config.js';

const exec = promisify(execFile);

export async function commitSource(config: Config, appId: string, sourceDir: string, message: string): Promise<string> {
  const repoPath = path.join(config.dataDir, 'repos', `${appId}.git`);
  await fs.mkdir(path.dirname(repoPath), { recursive: true });
  try {
    await fs.access(repoPath);
  } catch {
    await exec('git', ['init', '--bare', repoPath]);
  }

  const workTree = path.join(config.dataDir, 'git-worktrees', `${appId}-${Date.now()}`);
  await fs.rm(workTree, { recursive: true, force: true });
  await fs.mkdir(path.dirname(workTree), { recursive: true });
  await exec('git', ['clone', repoPath, workTree]);
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
  const sha = (await exec('git', ['-C', workTree, 'rev-parse', 'HEAD'])).stdout.trim();
  await fs.rm(workTree, { recursive: true, force: true });
  return sha;
}

async function copyDir(source: string, destination: string): Promise<void> {
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.name === '.git') continue;
    if (entry.isDirectory()) {
      await fs.mkdir(to, { recursive: true });
      await copyDir(from, to);
    } else if (entry.isFile()) {
      await fs.copyFile(from, to);
    }
  }
}
