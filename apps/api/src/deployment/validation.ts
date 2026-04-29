import fs from 'node:fs/promises';
import path from 'node:path';
import { x } from 'tar';
import { VibestackManifestSchema, type VibeStackManifest } from '@vibestack/shared';

const IGNORED_SOURCE_DIRS = new Set([
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

export type ValidationResult =
  | { ok: true; manifest: VibeStackManifest }
  | { ok: false; code: string; message: string; details?: Record<string, unknown> };

export async function extractAndValidate(tarballPath: string, destination: string): Promise<ValidationResult> {
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });

  let rejectedArchiveReason: string | undefined;

  try {
    await x({
      file: tarballPath,
      cwd: destination,
      filter: (entryPath: string, entry: any) => {
        const parts = archivePathParts(entryPath);
        const normalizedPath = parts.join('/');
        if (path.isAbsolute(entryPath) || path.win32.isAbsolute(entryPath) || parts.includes('..')) {
          rejectedArchiveReason = `unsafe path ${entryPath}`;
          return false;
        }
        if (parts.some((part) => IGNORED_SOURCE_DIRS.has(part))) {
          return false;
        }
        if (entry.type === 'SymbolicLink' || entry.type === 'Link' || entry.type === 'CharacterDevice' || entry.type === 'BlockDevice') {
          rejectedArchiveReason = `unsupported tar entry ${normalizedPath}`;
          return false;
        }
        return true;
      }
    });
  } catch (error) {
    return {
      ok: false,
      code: 'INVALID_SOURCE_ARCHIVE',
      message: 'The source tarball could not be safely extracted.',
      details: { reason: error instanceof Error ? error.message : String(error) }
    };
  }

  if (rejectedArchiveReason) {
    return {
      ok: false,
      code: 'INVALID_SOURCE_ARCHIVE',
      message: 'The source tarball could not be safely extracted.',
      details: { reason: rejectedArchiveReason }
    };
  }

  const dockerfile = path.join(destination, 'Dockerfile');
  const manifestPath = path.join(destination, 'vibestack.json');
  if (!(await exists(dockerfile))) {
    return { ok: false, code: 'MISSING_DOCKERFILE', message: 'No Dockerfile was found at the project root.' };
  }
  if (!(await exists(manifestPath))) {
    return { ok: false, code: 'MISSING_MANIFEST', message: 'No vibestack.json was found at the project root.' };
  }

  let manifest: VibeStackManifest;
  try {
    manifest = VibestackManifestSchema.parse(JSON.parse(await fs.readFile(manifestPath, 'utf8')));
  } catch (error) {
    return {
      ok: false,
      code: 'INVALID_MANIFEST',
      message: 'vibestack.json is invalid.',
      details: { reason: error instanceof Error ? error.message : String(error) }
    };
  }

  const dockerfileText = await fs.readFile(dockerfile, 'utf8');
  const exposedPorts = [...dockerfileText.matchAll(/^\s*EXPOSE\s+(.+)$/gim)].flatMap((match) =>
    String(match[1])
      .split(/\s+/)
      .map((port) => Number(port.split('/')[0]))
      .filter(Number.isInteger)
  );
  if (exposedPorts.length && !exposedPorts.includes(manifest.port)) {
    return {
      ok: false,
      code: 'PORT_MISMATCH',
      message: 'Dockerfile EXPOSE does not match vibestack.json port.',
      details: { manifestPort: manifest.port, exposedPorts }
    };
  }

  return { ok: true, manifest };
}

function archivePathParts(entryPath: string): string[] {
  return entryPath
    .replaceAll('\\', '/')
    .split('/')
    .filter((part) => part && part !== '.');
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
