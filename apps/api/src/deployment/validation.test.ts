import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { c } from 'tar';
import { describe, expect, it } from 'vitest';
import { extractAndValidate } from './validation.js';

const fixturesRoot = path.resolve(process.cwd(), '../../fixtures/sample-apps');

describe('deployment source validation', () => {
  it('accepts a valid Docker-compatible VibeStack app', async () => {
    const result = await validateFixture('node-basic');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.name).toBe('node-basic');
      expect(result.manifest.port).toBe(3000);
    }
  });

  it('accepts a manifest that requests app Postgres', async () => {
    const result = await validateFixture('postgres-basic');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest).toMatchObject({
        name: 'postgres-basic',
        port: 3000,
        postgres: true
      });
    }
  });

  it('returns MISSING_DOCKERFILE when the source root has no Dockerfile', async () => {
    const result = await validateFixture('missing-dockerfile');

    expect(result).toMatchObject({
      ok: false,
      code: 'MISSING_DOCKERFILE'
    });
  });

  it('returns MISSING_MANIFEST when the source root has no vibestack.json', async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vibestack-validation-'));
    const tarball = path.join(temp, 'source.tar.gz');
    const extractDir = path.join(temp, 'extract');
    const source = path.join(temp, 'source');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'Dockerfile'), 'FROM node:20-alpine\nEXPOSE 3000\n');
    await c({ gzip: true, file: tarball, cwd: source }, ['.']);

    const result = await extractAndValidate(tarball, extractDir);

    expect(result).toMatchObject({
      ok: false,
      code: 'MISSING_MANIFEST'
    });
  });

  it('returns INVALID_MANIFEST for schema validation failures', async () => {
    const result = await validateFixture('invalid-manifest');

    expect(result).toMatchObject({
      ok: false,
      code: 'INVALID_MANIFEST'
    });
    if (!result.ok) {
      expect(result.details?.reason).toContain('name must be lowercase');
    }
  });

  it('returns PORT_MISMATCH when Dockerfile EXPOSE conflicts with the manifest port', async () => {
    const result = await validateFixture('port-mismatch');

    expect(result).toMatchObject({
      ok: false,
      code: 'PORT_MISMATCH',
      details: {
        manifestPort: 3000,
        exposedPorts: [4000]
      }
    });
  });

  it('returns INVALID_SOURCE_ARCHIVE when the tarball cannot be extracted', async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vibestack-validation-'));
    const tarball = path.join(temp, 'source.tar.gz');
    const extractDir = path.join(temp, 'extract');
    await fs.writeFile(tarball, 'not a tarball');

    const result = await extractAndValidate(tarball, extractDir);

    expect(result).toMatchObject({
      ok: false,
      code: 'INVALID_SOURCE_ARCHIVE'
    });
  });
});

async function validateFixture(name: string) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vibestack-validation-'));
  const tarball = path.join(temp, 'source.tar.gz');
  const extractDir = path.join(temp, 'extract');
  await c({ gzip: true, file: tarball, cwd: path.join(fixturesRoot, name) }, ['.']);

  return extractAndValidate(tarball, extractDir);
}
