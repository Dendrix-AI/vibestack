import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { commitSource } from './git.js';

const exec = promisify(execFile);

describe('deployment source git commits', () => {
  it('commits update deployments on main and removes deleted source files', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibestack-git-data-'));
    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibestack-git-source-'));
    const config = loadConfig({
      DATABASE_URL: 'postgres://vibestack:vibestack@localhost:5432/vibestack',
      VIBESTACK_DATA_DIR: dataDir
    });

    await fs.writeFile(path.join(sourceDir, 'keep.txt'), 'first');
    await fs.writeFile(path.join(sourceDir, 'remove.txt'), 'remove me');
    const firstSha = await commitSource(config, 'app-1', sourceDir, 'First deploy');

    await fs.writeFile(path.join(sourceDir, 'keep.txt'), 'second');
    await fs.rm(path.join(sourceDir, 'remove.txt'));
    const secondSha = await commitSource(config, 'app-1', sourceDir, 'Second deploy');

    const repoPath = path.join(dataDir, 'repos', 'app-1.git');
    const head = (await exec('git', ['--git-dir', repoPath, 'symbolic-ref', 'HEAD'])).stdout.trim();
    const files = (await exec('git', ['--git-dir', repoPath, 'ls-tree', '-r', '--name-only', 'main'])).stdout;
    const latestSha = (await exec('git', ['--git-dir', repoPath, 'rev-parse', 'main'])).stdout.trim();

    expect(firstSha).not.toBe(secondSha);
    expect(latestSha).toBe(secondSha);
    expect(head).toBe('refs/heads/main');
    expect(files).toContain('keep.txt');
    expect(files).not.toContain('remove.txt');
  });
});
