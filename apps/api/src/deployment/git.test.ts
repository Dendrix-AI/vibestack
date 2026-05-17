import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { commitSource, createSourceArchive, sourceSnapshotExists } from './git.js';

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

  it('keeps local-only files out of recoverable source archives', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibestack-git-data-'));
    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibestack-git-source-'));
    const archiveDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibestack-git-archive-'));
    const config = loadConfig({
      DATABASE_URL: 'postgres://vibestack:vibestack@localhost:5432/vibestack',
      VIBESTACK_DATA_DIR: dataDir
    });

    await fs.writeFile(path.join(sourceDir, 'app.js'), 'console.log("hello");');
    await fs.writeFile(path.join(sourceDir, '.env'), 'TOKEN=do-not-store');
    await fs.writeFile(path.join(sourceDir, '.env.local'), 'TOKEN=do-not-store');
    await fs.mkdir(path.join(sourceDir, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'node_modules', 'package.txt'), 'do-not-store');

    const sha = await commitSource(config, 'app-1', sourceDir, 'Deploy with local files');
    const archivePath = path.join(archiveDir, 'editable-files.tar.gz');
    await createSourceArchive(config, 'app-1', sha, archivePath);

    const repoPath = path.join(dataDir, 'repos', 'app-1.git');
    const storedFiles = (await exec('git', ['--git-dir', repoPath, 'ls-tree', '-r', '--name-only', sha])).stdout;
    const archiveFiles = (await exec('tar', ['-tzf', archivePath])).stdout;

    expect(await sourceSnapshotExists(config, 'app-1', sha)).toBe(true);
    expect(storedFiles).toContain('app.js');
    expect(storedFiles).not.toContain('.env');
    expect(storedFiles).not.toContain('.env.local');
    expect(storedFiles).not.toContain('node_modules');
    expect(archiveFiles).toContain('app.js');
    expect(archiveFiles).not.toContain('.env');
    expect(archiveFiles).not.toContain('.env.local');
    expect(archiveFiles).not.toContain('node_modules');
  });
});
