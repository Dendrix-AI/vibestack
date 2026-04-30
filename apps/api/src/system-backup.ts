import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Config } from './config.js';

type CommandOptions = {
  cwd?: string;
  stdinPath?: string;
  stdoutPath?: string;
};

export type BackupArchive = {
  path: string;
  filename: string;
  cleanup: () => Promise<void>;
};

export type RestoreResult = {
  restoredDatabase: boolean;
  restoredEnv: boolean;
  restoredCompose: boolean;
  restoredSecrets: boolean;
  message: string;
};

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function run(command: string, args: string[], options: CommandOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: [
        options.stdinPath ? 'pipe' : 'ignore',
        options.stdoutPath ? 'pipe' : 'ignore',
        'pipe'
      ]
    });
    const stderr: Buffer[] = [];
    let settled = false;
    let outputFinished = Promise.resolve();

    function fail(error: Error): void {
      if (settled) return;
      settled = true;
      reject(error);
    }

    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));

    if (options.stdinPath && child.stdin) {
      createReadStream(options.stdinPath).on('error', fail).pipe(child.stdin);
    }

    if (options.stdoutPath && child.stdout) {
      const output = createWriteStream(options.stdoutPath);
      outputFinished = new Promise((finishResolve, finishReject) => {
        output.on('finish', finishResolve);
        output.on('error', finishReject);
      });
      child.stdout.on('error', fail).pipe(output);
    }

    child.on('error', fail);
    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        fail(new Error(`${command} ${args.join(' ')} failed with exit code ${code}: ${Buffer.concat(stderr).toString('utf8')}`));
        return;
      }

      outputFinished
        .then(() => {
          if (settled) return;
          settled = true;
          resolve();
        })
        .catch((error: Error) => fail(error));
    });
  });
}

async function copyIfExists(source: string, destination: string): Promise<boolean> {
  try {
    await fs.cp(source, destination, { recursive: true, force: true, errorOnExist: false });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function createSystemBackup(config: Config): Promise<BackupArchive> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vibestack-backup-'));
  const backupRoot = path.join(tempRoot, 'backup');
  const archivePath = path.join(tempRoot, `vibestack-backup-${timestamp()}.tar.gz`);
  try {
    await fs.mkdir(backupRoot, { recursive: true });

    const configDir = path.join(backupRoot, 'config');
    await fs.mkdir(configDir, { recursive: true });
    const envCopied = await copyIfExists(path.join(config.sourceDir, '.env'), path.join(configDir, '.env'));
    const composeCopied = await copyIfExists(path.join(config.sourceDir, 'docker-compose.yml'), path.join(configDir, 'docker-compose.yml'));
    const secretsCopied = await copyIfExists(path.join(config.sourceDir, 'secrets'), path.join(configDir, 'secrets'));

    await run('docker', ['compose', '--project-directory', config.sourceDir, 'exec', '-T', 'postgres', 'pg_dump', '-U', 'vibestack', '--clean', '--if-exists', '--no-owner', '--no-privileges', 'vibestack'], {
      stdoutPath: path.join(backupRoot, 'database.sql')
    });

    await fs.writeFile(
      path.join(backupRoot, 'manifest.json'),
      `${JSON.stringify({
        createdAt: new Date().toISOString(),
        format: 'vibestack-system-backup-v1',
        includes: {
          database: true,
          env: envCopied,
          compose: composeCopied,
          secrets: secretsCopied
        }
      }, null, 2)}\n`,
      'utf8'
    );

    await run('tar', ['-czf', archivePath, '-C', backupRoot, '.']);

    return {
      path: archivePath,
      filename: path.basename(archivePath),
      cleanup: () => fs.rm(tempRoot, { recursive: true, force: true })
    };
  } catch (error) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function restoreSystemBackup(config: Config, archivePath: string): Promise<RestoreResult> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vibestack-restore-'));
  const restoreRoot = path.join(tempRoot, 'restore');
  await fs.mkdir(restoreRoot, { recursive: true });

  try {
    await run('tar', ['-xzf', archivePath, '-C', restoreRoot]);
    const manifestRaw = await fs.readFile(path.join(restoreRoot, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw) as { format?: string };
    if (manifest.format !== 'vibestack-system-backup-v1') {
      throw new Error('Backup archive format is not supported.');
    }

    const databasePath = path.join(restoreRoot, 'database.sql');
    await fs.access(databasePath);

    await run('docker', ['compose', '--project-directory', config.sourceDir, 'exec', '-T', 'postgres', 'psql', '-U', 'vibestack', 'vibestack'], {
      stdinPath: databasePath
    });
    const restoredEnv = await copyIfExists(path.join(restoreRoot, 'config', '.env'), path.join(config.sourceDir, '.env'));
    const restoredCompose = await copyIfExists(path.join(restoreRoot, 'config', 'docker-compose.yml'), path.join(config.sourceDir, 'docker-compose.yml'));
    const restoredSecrets = await copyIfExists(path.join(restoreRoot, 'config', 'secrets'), path.join(config.sourceDir, 'secrets'));

    return {
      restoredDatabase: true,
      restoredEnv,
      restoredCompose,
      restoredSecrets,
      message: 'Backup restored. Restart the VibeStack stack so services reload configuration and database state.'
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}
