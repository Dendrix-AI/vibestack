import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Config } from './config.js';

const execFileAsync = promisify(execFile);
const STATUS_DIR = '.vibestack-update';
const STATUS_FILE = 'status.json';

type SelfUpdateState = 'idle' | 'checking' | 'running' | 'succeeded' | 'failed' | 'unavailable';
type UpdateMode = 'version' | 'revision';

export type SelfUpdateStatus = {
  currentVersion: string;
  currentRevision?: string;
  currentTag?: string;
  latestVersion?: string;
  latestRevision?: string;
  latestTag?: string;
  updateAvailable: boolean;
  sourceAvailable: boolean;
  state: SelfUpdateState;
  message?: string;
  startedAt?: string;
  finishedAt?: string;
  repoUrl: string;
  channel: string;
  updateMode: UpdateMode;
};

type PersistedUpdateStatus = {
  state?: SelfUpdateState;
  message?: string;
  startedAt?: string;
  finishedAt?: string;
};

function statusPath(config: Config): string {
  return path.join(config.sourceDir, STATUS_DIR, STATUS_FILE);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function readPersistedStatus(config: Config): Promise<PersistedUpdateStatus> {
  try {
    return JSON.parse(await readFile(statusPath(config), 'utf8')) as PersistedUpdateStatus;
  } catch {
    return {};
  }
}

async function writePersistedStatus(config: Config, status: PersistedUpdateStatus): Promise<void> {
  await mkdir(path.join(config.sourceDir, STATUS_DIR), { recursive: true });
  await writeFile(statusPath(config), `${JSON.stringify(status)}\n`, 'utf8');
}

async function git(config: Config, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', config.sourceDir, ...args], {
    timeout: 60_000,
    maxBuffer: 1024 * 1024
  });
  return stdout.trim();
}

async function optionalGit(config: Config, args: string[]): Promise<string | undefined> {
  try {
    const value = await git(config, args);
    return value || undefined;
  } catch {
    return undefined;
  }
}

async function rootPackageVersion(config: Config, ref = 'HEAD'): Promise<string | undefined> {
  if (ref === 'HEAD') {
    return localPackageVersion(config);
  }

  const raw = await optionalGit(config, ['show', `${ref}:package.json`]);
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as { version?: unknown; vibestackRelease?: unknown };
    if (typeof parsed.vibestackRelease === 'string') return parsed.vibestackRelease;
    return typeof parsed.version === 'string' ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

async function localPackageVersion(config: Config): Promise<string> {
  try {
    const raw = await readFile(path.join(config.sourceDir, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown; vibestackRelease?: unknown };
    if (typeof parsed.vibestackRelease === 'string') return parsed.vibestackRelease;
    if (typeof parsed.version === 'string') return parsed.version;
  } catch {
    // Fall through to the static package version copied into the API image.
  }

  try {
    const raw = await readFile(path.resolve(process.cwd(), '../../package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown; vibestackRelease?: unknown };
    if (typeof parsed.vibestackRelease === 'string') return parsed.vibestackRelease;
    if (typeof parsed.version === 'string') return parsed.version;
  } catch {
    // Fall through to a stable unknown marker.
  }

  return 'unknown';
}

function updateMode(channel: string): UpdateMode {
  return channel === 'nightly' || channel === 'main' ? 'revision' : 'version';
}

function validateChannel(channel: string): string {
  const validRef = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(channel) &&
    !channel.includes('..') &&
    !channel.includes('//') &&
    !channel.endsWith('/') &&
    !channel.endsWith('.lock');
  if (!validRef) {
    throw new Error('Update channel must be a valid Git branch name.');
  }
  return channel;
}

function remoteRef(channel: string): string {
  return `origin/${channel}`;
}

function versionChanged(currentVersion: string, latestVersion?: string): boolean | undefined {
  if (!latestVersion || currentVersion === 'unknown' || latestVersion === 'unknown') return undefined;
  return currentVersion !== latestVersion;
}

export async function getSelfUpdateStatus(config: Config, refresh: boolean, requestedChannel?: string): Promise<SelfUpdateStatus> {
  const persisted = await readPersistedStatus(config);
  const currentVersion = await localPackageVersion(config);
  const repoUrl = config.repoUrl;
  const channel = validateChannel(requestedChannel ?? config.updateChannel);
  const mode = updateMode(channel);

  if (!(await pathExists(path.join(config.sourceDir, '.git')))) {
    return {
      ...persisted,
      currentVersion,
      updateAvailable: false,
      sourceAvailable: false,
      state: 'unavailable',
      message: `${config.sourceDir} is not a git checkout.`,
      repoUrl,
      channel,
      updateMode: mode
    };
  }

  if (refresh) {
    await git(config, ['fetch', '--tags', 'origin']);
  }

  const latestRef = remoteRef(channel);
  const currentRevision = await optionalGit(config, ['rev-parse', 'HEAD']);
  const currentTag =
    (await optionalGit(config, ['describe', '--tags', '--exact-match', 'HEAD'])) ??
    (await optionalGit(config, ['describe', '--tags', '--always', '--dirty']));
  const latestRevision = await optionalGit(config, ['rev-parse', latestRef]);
  const latestTag =
    (await optionalGit(config, ['describe', '--tags', '--exact-match', latestRef])) ??
    (await optionalGit(config, ['describe', '--tags', '--always', latestRef]));
  if (!latestRevision) {
    return {
      currentVersion,
      currentRevision,
      currentTag,
      updateAvailable: false,
      sourceAvailable: false,
      state: 'unavailable',
      message: `Update channel ${latestRef} is not available.`,
      repoUrl,
      channel,
      updateMode: mode
    };
  }
  const latestVersion = latestRevision ? await rootPackageVersion(config, latestRef) : undefined;
  const changedByVersion = versionChanged(currentVersion, latestVersion);
  const changedByRevision = Boolean(currentRevision && latestRevision && currentRevision !== latestRevision);
  const updateAvailable = mode === 'version' ? changedByVersion ?? changedByRevision : changedByRevision;

  return {
    currentVersion,
    currentRevision,
    currentTag,
    latestVersion,
    latestRevision,
    latestTag,
    updateAvailable,
    sourceAvailable: true,
    state: persisted.state ?? 'idle',
    message: persisted.message,
    startedAt: persisted.startedAt,
    finishedAt: persisted.finishedAt,
    repoUrl,
    channel,
    updateMode: mode
  };
}

function shellString(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function updateScript(config: Config, selectedChannel: string): string {
  const channel = shellString(selectedChannel);
  return `set -eu
apk add --no-cache git >/dev/null
mkdir -p ${STATUS_DIR}
status_file=${shellString(path.posix.join(STATUS_DIR, STATUS_FILE))}
json_string() { printf '%s' "$1" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g'; }
write_status() {
  state="$1"
  message="$2"
  finished="$3"
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [ "$finished" = "yes" ]; then
    printf '{"state":"%s","message":"%s","startedAt":"%s","finishedAt":"%s"}\\n' "$state" "$(json_string "$message")" "$started_at" "$now" > "$status_file"
  else
    printf '{"state":"%s","message":"%s","startedAt":"%s"}\\n' "$state" "$(json_string "$message")" "$started_at" > "$status_file"
  fi
}
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
trap 'code=$?; if [ "$code" -ne 0 ]; then write_status failed "Update failed with exit code $code." yes; fi' EXIT
write_status running "Fetching updates." no
git config --global --add safe.directory /workspace
git remote set-url origin ${shellString(config.repoUrl)}
git fetch --tags origin
before="$(git rev-parse --short HEAD)"
write_status running "Applying update from origin/${selectedChannel}." no
git checkout -B ${channel} origin/${selectedChannel}
after="$(git rev-parse --short HEAD)"
write_status running "Rebuilding VibeStack services." no
docker compose --project-directory /workspace pull postgres redis traefik
docker compose --project-directory /workspace up -d --build api worker web
write_status succeeded "Updated from $before to $after." yes
`;
}

export async function startSelfUpdate(config: Config, requestedChannel?: string): Promise<SelfUpdateStatus> {
  const channel = validateChannel(requestedChannel ?? config.updateChannel);
  const current = await getSelfUpdateStatus(config, true, channel);
  if (!current.sourceAvailable) {
    throw new Error(current.message ?? 'VibeStack source checkout is not available.');
  }
  if (current.state === 'running') {
    return current;
  }
  if (!current.updateAvailable) {
    return current;
  }

  const startedAt = new Date().toISOString();
  await writePersistedStatus(config, {
    state: 'running',
    message: 'Update started.',
    startedAt
  });
  const name = `vibestack-self-update-${Date.now()}`;
  try {
    await execFileAsync(
      'docker',
      [
        'run',
        '-d',
        '--rm',
        '--name',
        name,
        '--label',
        'vibestack.role=self-updater',
        '-v',
        '/var/run/docker.sock:/var/run/docker.sock',
        '-v',
        `${config.installDir}:/workspace`,
        '-w',
        '/workspace',
        'docker:29-cli',
        'sh',
        '-lc',
        updateScript(config, channel)
      ],
      { timeout: 60_000, maxBuffer: 1024 * 1024 }
    );
  } catch (error) {
    await writePersistedStatus(config, {
      state: 'failed',
      message: error instanceof Error ? error.message : 'Update failed to start.',
      startedAt,
      finishedAt: new Date().toISOString()
    });
    throw error;
  }

  return {
    ...current,
    state: 'running',
    message: 'Update started.',
    startedAt
  };
}
