import crypto from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, type ZodSchema } from 'zod';
import { loadConfig, type Config } from './config.js';
import { createDb, type Db } from './db.js';
import { bootstrapFirstAdmin } from './bootstrap.js';
import {
  clearSessionCookie,
  createSession,
  getActor,
  loginWithPassword,
  requireActor,
  setSessionCookie,
  SESSION_COOKIE
} from './auth.js';
import { requirePlatformAdmin, requireTeamRole, getAuthorizedApp } from './authorization.js';
import { HttpError, notFound, permissionDenied, sendError } from './errors.js';
import { encryptSecret, generateToken, hashPassword, sha256, verifyPassword } from './crypto.js';
import { buildAppHostname, publicUser, requireSecretKeyName, slugify } from './util.js';
import { writeAuditLog } from './audit.js';
import type { Actor, AppRow, DeploymentRow, TeamRow, UserRow } from './types.js';
import { runMigrations } from './migrate.js';
import { deploymentQueue } from './queue.js';
import { hardDeleteApp } from './runtime-cleanup.js';
import { dockerLogsForDeployment, startExistingAppContainer, stopAppContainer } from './deployment/runtime.js';
import { publicCloudflareSetting } from './cloudflare.js';
import { getSelfUpdateStatus, startSelfUpdate } from './updater.js';

type AppContext = {
  config: Config;
  db: Db;
};

function parseBody<T>(schema: ZodSchema<T>, request: FastifyRequest): T {
  return schema.parse(request.body ?? {});
}

function parseParams<T>(schema: ZodSchema<T>, request: FastifyRequest): T {
  return schema.parse(request.params ?? {});
}

function parseQuery<T>(schema: ZodSchema<T>, request: FastifyRequest): T {
  return schema.parse(request.query ?? {});
}

function secureCookies(config: Config): boolean {
  return config.publicUrl.startsWith('https://');
}

async function currentSettings(db: Db, config: Config): Promise<Record<string, unknown>> {
  const rows = await db.query<{ key: string; value_json: unknown; encrypted: boolean }>(
    'SELECT key, value_json, encrypted FROM platform_settings ORDER BY key'
  );
  return Object.fromEntries(
    rows.rows.map((row) => {
      if (row.key === 'cloudflare') {
        const setting = (row.value_json as Record<string, unknown>) ?? {};
        const storedToken = typeof setting.apiToken === 'string' ? setting.apiToken : undefined;
        const storedEnabled = typeof setting.enabled === 'boolean' ? setting.enabled : undefined;
        const storedZoneId = typeof setting.zoneId === 'string' ? setting.zoneId : undefined;
        const storedTargetHostname = typeof setting.targetHostname === 'string' ? setting.targetHostname : undefined;
        return [
          row.key,
          publicCloudflareSetting({
            ...setting,
            enabled: storedEnabled ?? Boolean(config.cloudflareApiToken && config.cloudflareZoneId),
            zoneId: storedZoneId ?? config.cloudflareZoneId,
            apiToken: storedToken ?? config.cloudflareApiToken,
            targetHostname: storedTargetHostname ?? config.cloudflareTargetHostname
          })
        ];
      }
      return [row.key, row.encrypted ? { configured: true } : row.value_json];
    })
  );
}

async function maintenanceMode(db: Db): Promise<boolean> {
  const row = await db.maybeOne<{ value_json: boolean }>(
    "SELECT value_json FROM platform_settings WHERE key = 'maintenanceMode'"
  );
  return row?.value_json === true;
}

async function ensureDeploymentsAllowed(db: Db, actor: Actor, teamId: string): Promise<void> {
  if (await maintenanceMode(db)) {
    throw new HttpError({
      code: 'MAINTENANCE_MODE_ACTIVE',
      message: 'Deployments are currently disabled by platform maintenance mode.',
      statusCode: 503,
      agentHint: 'Wait until a platform administrator disables maintenance mode, then retry the deployment.'
    });
  }

  const team = await db.one<TeamRow>('SELECT * FROM teams WHERE id = $1', [teamId]);
  if (team.deployments_paused && !actor.user.is_platform_admin) {
    throw new HttpError({
      code: 'TEAM_DEPLOYMENTS_PAUSED',
      message: 'Deployments are paused for this team.',
      statusCode: 409,
      agentHint: 'Ask a team administrator to resume deployments for the team, then retry.'
    });
  }
}

function appResponse(row: AppRow & { external_password_hash?: string | null }): Record<string, unknown> {
  return {
    id: row.id,
    teamId: row.team_id,
    name: row.name,
    slug: row.slug,
    hostname: row.hostname,
    url: `https://${row.hostname}`,
    status: row.status,
    creatorUserId: row.creator_user_id,
    lastUpdatedByUserId: row.last_updated_by_user_id,
    currentDeploymentId: row.current_deployment_id,
    postgresEnabled: row.postgres_enabled,
    externalPasswordEnabled: row.external_password_enabled,
    externalPasswordConfigured: Boolean(row.external_password_hash),
    loginAccessEnabled: row.login_access_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function applyDeploymentMetadata(
  db: Db,
  config: Config,
  appId: string,
  actor: Actor,
  metadata: DeployAppMetadataValue
): Promise<void> {
  const externalPasswordHash =
    metadata.access.externalPasswordEnabled && metadata.access.externalPassword
      ? await hashPassword(metadata.access.externalPassword)
      : null;

  for (const [key, value] of Object.entries(metadata.secrets)) {
    const secretKey = requireSecretKeyName(key);
    await db.query(
      `INSERT INTO app_secrets (app_id, key, encrypted_value, created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (app_id, key) DO UPDATE
       SET encrypted_value = EXCLUDED.encrypted_value,
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_at = now()`,
      [appId, secretKey, encryptSecret(value, config.secretKey), actor.user.id]
    );
  }

  await db.query(
    `UPDATE apps
     SET status = 'deploying',
         postgres_enabled = $2,
         updated_at = now(),
         last_updated_by_user_id = $3,
         login_access_enabled = $4,
         external_password_enabled = $5,
         external_password_hash = COALESCE($6, external_password_hash)
     WHERE id = $1`,
    [
      appId,
      metadata.postgres.enabled,
      actor.user.id,
      metadata.access.loginRequired,
      metadata.access.externalPasswordEnabled,
      externalPasswordHash
    ]
  );
}

async function createDeploymentRecord(
  db: Db,
  input: {
    appId: string;
    userId: string;
    type: 'deploy' | 'rollback';
    rollbackSourceDeploymentId?: string;
    manifest?: unknown;
    tarballSha?: string | null;
  }
): Promise<DeploymentRow> {
  return db.one<DeploymentRow>(
    `WITH next_version AS (
       SELECT COALESCE(MAX(version_number), 0) + 1 AS value FROM deployments WHERE app_id = $1
     )
     INSERT INTO deployments (
       app_id, version_number, type, status, started_by_user_id, rollback_source_deployment_id,
       manifest, source_tarball_sha256, started_at
     )
     SELECT $1, value, $2, 'queued', $3, $4, $5, $6, now()
     FROM next_version
     RETURNING *`,
    [
      input.appId,
      input.type,
      input.userId,
      input.rollbackSourceDeploymentId ?? null,
      input.manifest ? JSON.stringify(input.manifest) : null,
      input.tarballSha ?? null
    ]
  );
}

async function readDeploymentUpload(
  request: FastifyRequest,
  config: Config,
  deploymentId: string
): Promise<{ metadata: unknown; tarballSha: string | null }> {
  if (!request.isMultipart()) {
    return { metadata: request.body ?? {}, tarballSha: null };
  }

  const uploadDir = path.join(config.dataDir, 'uploads', deploymentId);
  await fs.mkdir(uploadDir, { recursive: true });
  let metadata: unknown = {};
  let tarballSha: string | null = null;

  for await (const part of request.parts()) {
    if (part.type === 'field' && part.fieldname === 'metadata') {
      if (typeof part.value !== 'string') {
        throw new HttpError({
          code: 'INVALID_DEPLOYMENT_METADATA',
          message: 'Multipart metadata field must be a JSON string.',
          statusCode: 400
        });
      }
      metadata = JSON.parse(part.value);
      continue;
    }

    if (part.type === 'file' && part.fieldname === 'source') {
      const hash = crypto.createHash('sha256');
      part.file.on('data', (chunk: Buffer) => hash.update(chunk));
      await pipeline(part.file, createWriteStream(path.join(uploadDir, 'source.tar.gz')));
      tarballSha = hash.digest('hex');
      continue;
    }
  }

  if (!tarballSha) {
    throw new HttpError({
      code: 'MISSING_SOURCE_TARBALL',
      message: 'No source tarball was included in the deployment request.',
      statusCode: 400,
      agentHint: 'Send multipart form data with metadata JSON and a source file field containing source.tar.gz.'
    });
  }

  return { metadata, tarballSha };
}

async function resolveTeamId(db: Db, actor: Actor, teamId?: string, team?: string): Promise<string> {
  if (teamId) return teamId;
  if (team) {
    const row = await db.maybeOne<{ id: string }>('SELECT id FROM teams WHERE id::text = $1 OR slug = $1', [team]);
    if (row) return row.id;
  }
  if (actor.user.default_team_id) return actor.user.default_team_id;
  throw new HttpError({
    code: 'TEAM_REQUIRED',
    message: 'A team is required for this deployment.',
    statusCode: 400,
    agentHint: 'Send teamId or team in the deployment metadata, or set a default team for the VibeStack user.'
  });
}

async function addAppEvent(
  db: Db,
  input: {
    appId: string;
    deploymentId?: string;
    actorUserId?: string;
    eventType: string;
    message: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO app_events (app_id, deployment_id, actor_user_id, event_type, message, metadata_json)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.appId,
      input.deploymentId ?? null,
      input.actorUserId ?? null,
      input.eventType,
      input.message,
      input.metadata ? JSON.stringify(input.metadata) : null
    ]
  );
}

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });
const CreateUserBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(120).optional(),
  defaultTeamId: z.string().uuid().nullable().optional(),
  isPlatformAdmin: z.boolean().optional()
});
const PatchUserBody = z.object({
  displayName: z.string().min(1).max(120).optional(),
  defaultTeamId: z.string().uuid().nullable().optional(),
  isPlatformAdmin: z.boolean().optional(),
  status: z.enum(['active', 'disabled']).optional(),
  password: z.string().min(8).optional()
});
const CreateTeamBody = z.object({ name: z.string().min(1).max(120), slug: z.string().min(1).max(80).optional() });
const PatchTeamBody = z.object({
  name: z.string().min(1).max(120).optional(),
  deploymentsPaused: z.boolean().optional()
});
const MemberBody = z.object({ userId: z.string().uuid(), role: z.enum(['team_admin', 'creator', 'viewer']) });
const PatchMemberBody = z.object({ role: z.enum(['team_admin', 'creator', 'viewer']) });
const TokenBody = z.object({ name: z.string().min(1).max(120) });
const CreateAppBody = z.object({
  teamId: z.string().uuid(),
  name: z.string().min(1).max(120),
  loginAccessEnabled: z.boolean().optional(),
  externalPasswordEnabled: z.boolean().optional(),
  externalPassword: z.string().min(8).optional(),
  postgresEnabled: z.boolean().optional()
});
const PatchAppBody = z.object({
  name: z.string().min(1).max(120).optional(),
  loginAccessEnabled: z.boolean().optional(),
  externalPasswordEnabled: z.boolean().optional(),
  externalPassword: z.string().min(8).optional()
});
const DeployAppMetadata = z.object({
  team: z.string().optional(),
  teamId: z.string().uuid().optional(),
  appName: z.string().min(1).max(120),
  access: z
    .object({
      loginRequired: z.boolean().default(true),
      externalPasswordEnabled: z.boolean().default(false),
      externalPassword: z.string().min(8).nullable().optional()
    })
    .default({ loginRequired: true, externalPasswordEnabled: false }),
  postgres: z.object({ enabled: z.boolean().default(false) }).default({ enabled: false }),
  secrets: z.record(z.string()).default({})
});
const SecretBody = z.object({ value: z.string().min(1) });
const ExternalPasswordBody = z.object({ password: z.string().min(1), host: z.string().optional(), next: z.string().optional() });
const GatewayPasswordQuery = z.object({ next: z.string().optional(), error: z.string().optional() });
const SettingsPatchBody = z.record(z.unknown());
const IdParam = z.object({ id: z.string().uuid() });
const TeamMemberParam = z.object({ teamId: z.string().uuid(), userId: z.string().uuid() });
const AppSecretParam = z.object({ appId: z.string().uuid(), key: z.string().min(1).max(128) });
const DeploymentQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });
const LogQuery = z.object({ tail: z.coerce.number().int().min(1).max(1000).default(200) });
const UpdateQuery = z.object({ refresh: z.string().optional() });
type DeployAppMetadataValue = z.infer<typeof DeployAppMetadata>;

function appPasswordCookieName(appId: string): string {
  return `vibestack_app_${appId.replace(/[^a-zA-Z0-9]/g, '')}`;
}

function appPasswordCookieValue(appId: string, passwordHash: string): string {
  return sha256(`${appId}:${passwordHash}`);
}

function forwardedHost(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-host'];
  const host = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const [hostname = ''] = String(host ?? request.headers.host ?? '').split(':');
  return hostname;
}

function forwardedUrl(request: FastifyRequest): string {
  const proto = firstHeaderValue(request.headers['x-forwarded-proto']) ?? 'https';
  const host = forwardedHost(request);
  const uri = firstHeaderValue(request.headers['x-forwarded-uri']) ?? '/';
  return `${proto}://${host}${uri.startsWith('/') ? uri : `/${uri}`}`;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function clientIp(request: FastifyRequest): string {
  const cloudflareIp = firstHeaderValue(request.headers['cf-connecting-ip']);
  if (cloudflareIp) return cloudflareIp.trim();

  const trueClientIp = firstHeaderValue(request.headers['true-client-ip']);
  if (trueClientIp) return trueClientIp.trim();

  const realIp = firstHeaderValue(request.headers['x-real-ip']);
  if (realIp) return realIp.trim();

  const forwardedFor = firstHeaderValue(request.headers['x-forwarded-for']);
  const firstForwardedIp = forwardedFor?.split(',')[0]?.trim();
  return firstForwardedIp || request.ip;
}

function htmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function appPasswordNextUrl(appRow: AppRow, next?: string): string {
  if (!next) return `https://${appRow.hostname}/`;

  try {
    const url = new URL(next);
    if (url.hostname === appRow.hostname && ['http:', 'https:'].includes(url.protocol)) {
      return url.toString();
    }
  } catch {
    // Fall through to the app root for invalid or relative values.
  }

  return `https://${appRow.hostname}/`;
}

function appPasswordPage(config: Config, appRow: AppRow, next: string, error?: string): string {
  const action = `${config.publicUrl.replace(/\/$/, '')}/api/v1/gateway/apps/${appRow.id}/password`;
  const title = `Access ${appRow.name}`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${htmlEscape(title)}</title>
    <style>
      :root { color: #17202a; background: #edf1f5; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { align-items: center; display: flex; justify-content: center; margin: 0; min-height: 100vh; padding: 24px; }
      main { background: white; border: 1px solid #d7dee8; border-radius: 8px; box-shadow: 0 16px 40px rgb(28 39 49 / 10%); display: grid; gap: 18px; max-width: 420px; padding: 28px; width: 100%; }
      h1 { font-size: 1.6rem; line-height: 1.1; margin: 0; }
      p { color: #657182; margin: 0; }
      form { display: grid; gap: 14px; }
      label { display: grid; gap: 7px; font-weight: 700; }
      input { border: 1px solid #b9c4d1; border-radius: 7px; font: inherit; min-height: 44px; padding: 0 12px; }
      button { align-items: center; background: #0f7b6c; border: 0; border-radius: 7px; color: white; cursor: pointer; display: inline-flex; font: inherit; font-weight: 800; justify-content: center; min-height: 44px; padding: 0 16px; }
      .error { background: #fff0f0; border: 1px solid #ffc1bd; border-radius: 7px; color: #9f2720; padding: 10px 12px; }
      code { background: #eef3f6; border: 1px solid #d7dee8; border-radius: 5px; color: #2e4e62; padding: 2px 6px; word-break: break-all; }
    </style>
  </head>
  <body>
    <main>
      <div>
        <p>VibeStack protected app</p>
        <h1>${htmlEscape(title)}</h1>
      </div>
      <p><code>${htmlEscape(appRow.hostname)}</code></p>
      ${error ? `<div class="error">${htmlEscape(error)}</div>` : ''}
      <form method="post" action="${htmlEscape(action)}">
        <input type="hidden" name="next" value="${htmlEscape(next)}" />
        <label>App password<input name="password" type="password" autocomplete="current-password" autofocus required /></label>
        <button type="submit">Continue</button>
      </form>
    </main>
  </body>
</html>`;
}

async function registerRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, config } = ctx;

  app.get('/health', async () => ({ ok: true }));
  app.get('/api/v1/health', async () => ({ ok: true }));

  app.post('/api/v1/auth/login', async (request, reply) => {
    const body = parseBody(LoginBody, request);
    const user = await loginWithPassword(db, body.email, body.password);
    if (!user) {
      await writeAuditLog(db, {
        actorType: 'system',
        action: 'auth.login_failed',
        targetType: 'user',
        targetId: body.email.toLowerCase(),
        sourceIp: clientIp(request)
      });
      throw new HttpError({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.', statusCode: 401 });
    }
    const token = await createSession(db, user.id);
    setSessionCookie(reply, token, secureCookies(config), config.cookieDomain);
    await writeAuditLog(db, {
      actorUserId: user.id,
      actorType: 'user',
      action: 'auth.login_success',
      targetType: 'user',
      targetId: user.id,
      sourceIp: clientIp(request)
    });
    return { user: publicUser(user) };
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const cookieValue = request.cookies[SESSION_COOKIE];
    if (cookieValue) {
      const unsigned = request.unsignCookie(cookieValue);
      if (unsigned.valid && unsigned.value) {
        await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(unsigned.value)]);
      }
    }
    clearSessionCookie(reply, secureCookies(config), config.cookieDomain);
    return { ok: true };
  });

  app.get('/api/v1/me', async (request) => {
    const actor = await requireActor(db, request);
    const memberships = await db.query(
      `SELECT teams.id, teams.name, teams.slug, team_memberships.role
       FROM team_memberships
       JOIN teams ON teams.id = team_memberships.team_id
       WHERE team_memberships.user_id = $1
       ORDER BY teams.name`,
      [actor.user.id]
    );
    return { user: publicUser(actor.user), memberships: memberships.rows };
  });

  app.get('/api/v1/auth/me', async (request) => {
    const actor = await requireActor(db, request);
    const memberships = await db.query(
      `SELECT teams.id, teams.name, teams.slug, team_memberships.role
       FROM team_memberships
       JOIN teams ON teams.id = team_memberships.team_id
       WHERE team_memberships.user_id = $1
       ORDER BY teams.name`,
      [actor.user.id]
    );
    return { user: publicUser(actor.user), memberships: memberships.rows };
  });

  app.get('/api/v1/gateway/forward-auth', async (request, reply) => {
    const host = forwardedHost(request);
    const appRow = await db.maybeOne<
      AppRow & { external_password_hash: string | null }
    >('SELECT * FROM apps WHERE hostname = $1 AND deleted_at IS NULL AND status = $2', [host, 'running']);
    if (!appRow) {
      return reply.code(404).send('App not found');
    }

    if (appRow.login_access_enabled) {
      const actor = await getActor(db, request);
      if (actor?.user.is_platform_admin) {
        return reply.code(200).send('OK');
      }
      if (actor) {
        const membership = await db.maybeOne(
          'SELECT 1 FROM team_memberships WHERE team_id = $1 AND user_id = $2',
          [appRow.team_id, actor.user.id]
        );
        if (membership) {
          return reply.code(200).send('OK');
        }
      }
    }

    if (appRow.external_password_enabled && appRow.external_password_hash) {
      const cookie = request.cookies[appPasswordCookieName(appRow.id)];
      if (cookie) {
        const unsigned = request.unsignCookie(cookie);
        if (
          unsigned.valid &&
          unsigned.value === appPasswordCookieValue(appRow.id, appRow.external_password_hash)
        ) {
          return reply.code(200).send('OK');
        }
      }
    }

    await writeAuditLog(db, {
      actorType: 'system',
      action: 'app.access_denied',
      targetType: 'app',
      targetId: appRow.id,
      sourceIp: clientIp(request),
      metadata: { host }
    });
    if (appRow.external_password_enabled && appRow.external_password_hash) {
      const next = encodeURIComponent(forwardedUrl(request));
      return reply.redirect(`${config.publicUrl.replace(/\/$/, '')}/api/v1/gateway/apps/${appRow.id}/password?next=${next}`);
    }

    return reply.code(401).send('Authentication required');
  });

  app.get('/api/v1/gateway/apps/:id/password', async (request, reply) => {
    const { id } = parseParams(IdParam, request);
    const query = parseQuery(GatewayPasswordQuery, request);
    const appRow = await db.maybeOne<AppRow & { external_password_hash: string | null }>(
      'SELECT * FROM apps WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    if (!appRow?.external_password_enabled || !appRow.external_password_hash) {
      throw notFound('External password access is not enabled for this app.');
    }

    const next = appPasswordNextUrl(appRow, query.next);
    const error = query.error === 'invalid' ? 'Invalid app password.' : undefined;
    return reply.type('text/html; charset=utf-8').send(appPasswordPage(config, appRow, next, error));
  });

  app.post('/api/v1/gateway/apps/:id/password', async (request, reply) => {
    const { id } = parseParams(IdParam, request);
    const body = parseBody(ExternalPasswordBody, request);
    const appRow = await db.maybeOne<AppRow & { external_password_hash: string | null }>(
      'SELECT * FROM apps WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    if (!appRow?.external_password_enabled || !appRow.external_password_hash) {
      throw notFound('External password access is not enabled for this app.');
    }
    const ok = await verifyPassword(body.password, appRow.external_password_hash);
    await writeAuditLog(db, {
      actorType: 'system',
      action: ok ? 'app.external_password_success' : 'app.external_password_failed',
      targetType: 'app',
      targetId: appRow.id,
      sourceIp: clientIp(request)
    });
    const next = appPasswordNextUrl(appRow, body.next);
    if (!ok) {
      const acceptsHtml = String(request.headers.accept ?? '').includes('text/html');
      if (acceptsHtml || body.next) {
        return reply.redirect(
          `${config.publicUrl.replace(/\/$/, '')}/api/v1/gateway/apps/${appRow.id}/password?next=${encodeURIComponent(next)}&error=invalid`
        );
      }
      throw new HttpError({ code: 'INVALID_APP_PASSWORD', message: 'Invalid app password.', statusCode: 401 });
    }
    reply.setCookie(appPasswordCookieName(appRow.id), appPasswordCookieValue(appRow.id, appRow.external_password_hash), {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies(config),
      signed: true,
      domain: config.cookieDomain,
      path: '/',
      maxAge: 30 * 24 * 60 * 60
    });
    if (body.next) {
      return reply.redirect(next, 303);
    }
    return { ok: true };
  });

  app.get('/api/v1/users', async (request) => {
    const actor = await requireActor(db, request);
    requirePlatformAdmin(actor);
    const users = await db.query<UserRow>('SELECT * FROM users ORDER BY created_at DESC');
    return { users: users.rows.map(publicUser) };
  });

  app.post('/api/v1/users', async (request, reply) => {
    const actor = await requireActor(db, request);
    requirePlatformAdmin(actor);
    const body = parseBody(CreateUserBody, request);
    const passwordHash = await hashPassword(body.password);
    const user = await db.one<UserRow>(
      `INSERT INTO users (email, password_hash, display_name, default_team_id, is_platform_admin)
       VALUES (lower($1), $2, $3, $4, $5)
       RETURNING *`,
      [
        body.email,
        passwordHash,
        body.displayName ?? body.email.split('@')[0] ?? body.email,
        body.defaultTeamId ?? null,
        body.isPlatformAdmin ?? false
      ]
    );
    await writeAuditLog(db, { actor, action: 'user.created', targetType: 'user', targetId: user.id, sourceIp: clientIp(request) });
    return reply.status(201).send({ user: publicUser(user) });
  });

  app.patch('/api/v1/users/:id', async (request) => {
    const actor = await requireActor(db, request);
    requirePlatformAdmin(actor);
    const { id } = parseParams(IdParam, request);
    const body = parseBody(PatchUserBody, request);
    const current = await db.maybeOne<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    if (!current) throw notFound('User not found.');
    const passwordHash = body.password ? await hashPassword(body.password) : current.password_hash;
    const user = await db.one<UserRow>(
      `UPDATE users
       SET display_name = $2, default_team_id = $3, is_platform_admin = $4, status = $5,
           password_hash = $6, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        body.displayName ?? current.display_name,
        body.defaultTeamId === undefined ? current.default_team_id : body.defaultTeamId,
        body.isPlatformAdmin ?? current.is_platform_admin,
        body.status ?? current.status,
        passwordHash
      ]
    );
    await writeAuditLog(db, { actor, action: 'user.updated', targetType: 'user', targetId: user.id, sourceIp: clientIp(request) });
    return { user: publicUser(user) };
  });

  app.get('/api/v1/teams', async (request) => {
    const actor = await requireActor(db, request);
    const teams = actor.user.is_platform_admin
      ? await db.query<TeamRow>('SELECT * FROM teams ORDER BY name')
      : await db.query<TeamRow>(
          `SELECT teams.*
           FROM teams
           JOIN team_memberships ON team_memberships.team_id = teams.id
           WHERE team_memberships.user_id = $1
           ORDER BY teams.name`,
          [actor.user.id]
        );
    return { teams: teams.rows };
  });

  app.post('/api/v1/teams', async (request, reply) => {
    const actor = await requireActor(db, request);
    requirePlatformAdmin(actor);
    const body = parseBody(CreateTeamBody, request);
    const team = await db.one<TeamRow>(
      'INSERT INTO teams (name, slug) VALUES ($1, $2) RETURNING *',
      [body.name, slugify(body.slug ?? body.name)]
    );
    await writeAuditLog(db, { actor, action: 'team.created', targetType: 'team', targetId: team.id, sourceIp: clientIp(request) });
    return reply.status(201).send({ team });
  });

  app.get('/api/v1/teams/:id', async (request) => {
    const actor = await requireActor(db, request);
    const { id } = parseParams(IdParam, request);
    await requireTeamRole(db, actor, id, 'viewer');
    const team = await db.one<TeamRow>('SELECT * FROM teams WHERE id = $1', [id]);
    const members = await db.query(
      `SELECT users.id, users.email, users.display_name AS "displayName", team_memberships.role
       FROM team_memberships
       JOIN users ON users.id = team_memberships.user_id
       WHERE team_memberships.team_id = $1
       ORDER BY users.email`,
      [id]
    );
    return { team, members: members.rows };
  });

  app.patch('/api/v1/teams/:id', async (request) => {
    const actor = await requireActor(db, request);
    const { id } = parseParams(IdParam, request);
    await requireTeamRole(db, actor, id, 'team_admin');
    const body = parseBody(PatchTeamBody, request);
    const current = await db.maybeOne<TeamRow>('SELECT * FROM teams WHERE id = $1', [id]);
    if (!current) throw notFound('Team not found.');
    if (body.deploymentsPaused !== undefined && !actor.user.is_platform_admin) {
      await requireTeamRole(db, actor, id, 'team_admin');
    }
    const team = await db.one<TeamRow>(
      `UPDATE teams SET name = $2, deployments_paused = $3, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, body.name ?? current.name, body.deploymentsPaused ?? current.deployments_paused]
    );
    await writeAuditLog(db, { actor, action: 'team.updated', targetType: 'team', targetId: team.id, sourceIp: clientIp(request) });
    return { team };
  });

  app.post('/api/v1/teams/:id/members', async (request, reply) => {
    const actor = await requireActor(db, request);
    const { id } = parseParams(IdParam, request);
    await requireTeamRole(db, actor, id, 'team_admin');
    const body = parseBody(MemberBody, request);
    const membership = await db.one(
      `INSERT INTO team_memberships (team_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = now()
       RETURNING *`,
      [id, body.userId, body.role]
    );
    await writeAuditLog(db, {
      actor,
      action: 'team.member_upserted',
      targetType: 'team',
      targetId: id,
      sourceIp: clientIp(request),
      metadata: { userId: body.userId, role: body.role }
    });
    return reply.status(201).send({ membership });
  });

  app.patch('/api/v1/teams/:teamId/members/:userId', async (request) => {
    const actor = await requireActor(db, request);
    const { teamId, userId } = parseParams(TeamMemberParam, request);
    await requireTeamRole(db, actor, teamId, 'team_admin');
    const body = parseBody(PatchMemberBody, request);
    const membership = await db.maybeOne(
      `UPDATE team_memberships SET role = $3, updated_at = now()
       WHERE team_id = $1 AND user_id = $2
       RETURNING *`,
      [teamId, userId, body.role]
    );
    if (!membership) throw notFound('Team membership not found.');
    await writeAuditLog(db, {
      actor,
      action: 'team.member_updated',
      targetType: 'team',
      targetId: teamId,
      sourceIp: clientIp(request),
      metadata: { userId, role: body.role }
    });
    return { membership };
  });

  app.delete('/api/v1/teams/:teamId/members/:userId', async (request) => {
    const actor = await requireActor(db, request);
    const { teamId, userId } = parseParams(TeamMemberParam, request);
    await requireTeamRole(db, actor, teamId, 'team_admin');
    await db.query('DELETE FROM team_memberships WHERE team_id = $1 AND user_id = $2', [teamId, userId]);
    await writeAuditLog(db, {
      actor,
      action: 'team.member_removed',
      targetType: 'team',
      targetId: teamId,
      sourceIp: clientIp(request),
      metadata: { userId }
    });
    return { ok: true };
  });

  app.get('/api/v1/tokens', async (request) => {
    const actor = await requireActor(db, request);
    const tokens = await db.query(
      `SELECT id, name, last_used_at AS "lastUsedAt", revoked_at AS "revokedAt", created_at AS "createdAt"
       FROM api_tokens
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [actor.user.id]
    );
    return { tokens: tokens.rows };
  });

  app.post('/api/v1/tokens', async (request, reply) => {
    const actor = await requireActor(db, request);
    const body = parseBody(TokenBody, request);
    const token = generateToken('vstk');
    const row = await db.one(
      `INSERT INTO api_tokens (user_id, name, token_hash) VALUES ($1, $2, $3)
       RETURNING id, name, created_at AS "createdAt"`,
      [actor.user.id, body.name, sha256(token)]
    );
    await writeAuditLog(db, { actor, action: 'api_token.created', targetType: 'api_token', targetId: row.id, sourceIp: clientIp(request) });
    return reply.status(201).send({ token: { ...row, value: token } });
  });

  app.delete('/api/v1/tokens/:id', async (request) => {
    const actor = await requireActor(db, request);
    const { id } = parseParams(IdParam, request);
    const result = await db.query(
      `UPDATE api_tokens SET revoked_at = now()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [id, actor.user.id]
    );
    if (result.rowCount === 0) throw notFound('API token not found.');
    await writeAuditLog(db, { actor, action: 'api_token.revoked', targetType: 'api_token', targetId: id, sourceIp: clientIp(request) });
    return { ok: true };
  });

  app.get('/api/v1/settings', async (request) => {
    const actor = await requireActor(db, request);
    requirePlatformAdmin(actor);
    return { settings: await currentSettings(db, config) };
  });

  app.patch('/api/v1/settings', async (request) => {
    const actor = await requireActor(db, request);
    requirePlatformAdmin(actor);
    const body = parseBody(SettingsPatchBody, request);
    const allowed = new Set([
      'baseDomain',
      'maintenanceMode',
      'announcementBanner',
      'defaultAppAccessMode',
      'buildTimeoutSeconds',
      'dataDirectory',
      'cloudflare'
    ]);
    for (const [key, value] of Object.entries(body)) {
      if (!allowed.has(key)) {
        throw new HttpError({ code: 'INVALID_SETTING', message: `Setting ${key} is not supported.`, statusCode: 400 });
      }
      await db.query(
        `INSERT INTO platform_settings (key, value_json, encrypted, updated_by_user_id, updated_at)
         VALUES ($1, $2, false, $3, now())
         ON CONFLICT (key) DO UPDATE
         SET value_json = EXCLUDED.value_json, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()`,
        [key, JSON.stringify(value), actor.user.id]
      );
    }
    await writeAuditLog(db, { actor, action: 'settings.updated', targetType: 'settings', sourceIp: clientIp(request), metadata: { keys: Object.keys(body) } });
    return { settings: await currentSettings(db, config) };
  });

  app.get('/api/v1/system/update', async (request) => {
    const actor = await requireActor(db, request);
    requirePlatformAdmin(actor);
    const query = parseQuery(UpdateQuery, request);
    return { update: await getSelfUpdateStatus(config, query.refresh === 'true' || query.refresh === '1') };
  });

  app.post('/api/v1/system/update', async (request, reply) => {
    const actor = await requireActor(db, request);
    requirePlatformAdmin(actor);
    try {
      const update = await startSelfUpdate(config);
      await writeAuditLog(db, {
        actor,
        action: 'system.update_started',
        targetType: 'system',
        sourceIp: clientIp(request),
        metadata: {
          currentRevision: update.currentRevision,
          latestRevision: update.latestRevision,
          channel: update.channel
        }
      });
      return reply.status(202).send({ update });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start update.';
      throw new HttpError({ code: 'UPDATE_FAILED', message, statusCode: 400 });
    }
  });

  app.get('/api/v1/apps', async (request) => {
    const actor = await requireActor(db, request);
    const apps = actor.user.is_platform_admin
      ? await db.query<AppRow>('SELECT * FROM apps WHERE deleted_at IS NULL ORDER BY created_at DESC')
      : await db.query<AppRow>(
          `SELECT apps.*
           FROM apps
           JOIN team_memberships ON team_memberships.team_id = apps.team_id
           WHERE team_memberships.user_id = $1 AND apps.deleted_at IS NULL
           ORDER BY apps.created_at DESC`,
          [actor.user.id]
        );
    return { apps: apps.rows.map(appResponse) };
  });

  app.post('/api/v1/apps', async (request, reply) => {
    const actor = await requireActor(db, request);
    const body = parseBody(CreateAppBody, request);
    await requireTeamRole(db, actor, body.teamId, 'creator');
    const team = await db.one<TeamRow>('SELECT * FROM teams WHERE id = $1', [body.teamId]);
    const appSlug = slugify(body.name);
    const existing = await db.maybeOne('SELECT id FROM apps WHERE team_id = $1 AND slug = $2 AND deleted_at IS NULL', [
      body.teamId,
      appSlug
    ]);
    if (existing) {
      throw new HttpError({
        code: 'DUPLICATE_APP_NAME',
        message: 'An app with this name already exists in the team.',
        statusCode: 409,
        agentHint: 'Choose a different app name or deploy to the existing app.'
      });
    }
    const externalPasswordHash =
      body.externalPasswordEnabled && body.externalPassword ? await hashPassword(body.externalPassword) : null;
    const appRow = await db.one<AppRow>(
      `INSERT INTO apps (
         team_id, name, slug, hostname, creator_user_id, last_updated_by_user_id,
         postgres_enabled, external_password_enabled, external_password_hash, login_access_enabled
       )
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        body.teamId,
        body.name,
        appSlug,
        buildAppHostname(team.slug, appSlug, config.baseDomain),
        actor.user.id,
        body.postgresEnabled ?? false,
        body.externalPasswordEnabled ?? false,
        externalPasswordHash,
        body.loginAccessEnabled ?? true
      ]
    );
    await addAppEvent(db, {
      appId: appRow.id,
      actorUserId: actor.user.id,
      eventType: 'app.created',
      message: 'App created.'
    });
    await writeAuditLog(db, { actor, action: 'app.created', targetType: 'app', targetId: appRow.id, sourceIp: clientIp(request) });
    return reply.status(201).send({ app: appResponse(appRow) });
  });

  app.get('/api/v1/apps/:id', async (request) => {
    const actor = await requireActor(db, request);
    const { id } = parseParams(IdParam, request);
    const appRow = await getAuthorizedApp(db, actor, id, 'viewer');
    return { app: appResponse(appRow) };
  });

  app.patch('/api/v1/apps/:id', async (request) => {
    const actor = await requireActor(db, request);
    const { id } = parseParams(IdParam, request);
    const current = await getAuthorizedApp(db, actor, id, 'creator');
    const body = parseBody(PatchAppBody, request);
    const externalPasswordHash =
      body.externalPassword === undefined ? undefined : await hashPassword(body.externalPassword);
    const appRow = await db.one<AppRow>(
      `UPDATE apps
       SET name = $2,
           login_access_enabled = $3,
           external_password_enabled = $4,
           external_password_hash = COALESCE($5, external_password_hash),
           last_updated_by_user_id = $6,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        body.name ?? current.name,
        body.loginAccessEnabled ?? current.login_access_enabled,
        body.externalPasswordEnabled ?? current.external_password_enabled,
        externalPasswordHash ?? null,
        actor.user.id
      ]
    );
    await addAppEvent(db, {
      appId: id,
      actorUserId: actor.user.id,
      eventType: 'app.updated',
      message: 'App settings updated.'
    });
    await writeAuditLog(db, { actor, action: 'app.updated', targetType: 'app', targetId: id, sourceIp: clientIp(request) });
    return { app: appResponse(appRow) };
  });

  app.delete('/api/v1/apps/:id', async (request) => {
    const actor = await requireActor(db, request);
    const { id } = parseParams(IdParam, request);
    await getAuthorizedApp(db, actor, id, 'team_admin');
    const result = await hardDeleteApp(db, config, id);
    if (!result.deleted) throw notFound('App not found.');
    await writeAuditLog(db, { actor, action: 'app.deleted', targetType: 'app', targetId: id, sourceIp: clientIp(request) });
    return { ok: true };
  });

  app.post('/api/v1/apps/:id/start', async (request) => {
    const actor = await requireActor(db, request);
    const { id } = parseParams(IdParam, request);
    const current = await getAuthorizedApp(db, actor, id, 'creator');
    if (config.runtimeDriver === 'docker' && current.current_deployment_id) {
      await startExistingAppContainer(config, id, current.current_deployment_id);
    }
    const appRow = await db.one<AppRow>("UPDATE apps SET status = 'running', updated_at = now() WHERE id = $1 RETURNING *", [id]);
    await addAppEvent(db, { appId: id, actorUserId: actor.user.id, eventType: 'app.started', message: 'App marked running.' });
    await writeAuditLog(db, { actor, action: 'app.started', targetType: 'app', targetId: id, sourceIp: clientIp(request) });
    return { app: appResponse(appRow) };
  });

  app.post('/api/v1/apps/:id/stop', async (request) => {
    const actor = await requireActor(db, request);
    const { id } = parseParams(IdParam, request);
    const current = await getAuthorizedApp(db, actor, id, 'creator');
    if (config.runtimeDriver === 'docker' && current.current_deployment_id) {
      await stopAppContainer(config, id, current.current_deployment_id);
    }
    const appRow = await db.one<AppRow>("UPDATE apps SET status = 'stopped', updated_at = now() WHERE id = $1 RETURNING *", [id]);
    await addAppEvent(db, { appId: id, actorUserId: actor.user.id, eventType: 'app.stopped', message: 'App marked stopped.' });
    await writeAuditLog(db, { actor, action: 'app.stopped', targetType: 'app', targetId: id, sourceIp: clientIp(request) });
    return { app: appResponse(appRow) };
  });

  app.post('/api/v1/apps/deploy', async (request, reply) => {
    const actor = await requireActor(db, request);
    const tempUploadId = `tmp-${crypto.randomUUID()}`;
    const upload = await readDeploymentUpload(request, config, tempUploadId);
    const metadata = DeployAppMetadata.parse(upload.metadata);
    const teamId = await resolveTeamId(db, actor, metadata.teamId, metadata.team);
    await requireTeamRole(db, actor, teamId, 'creator');
    await ensureDeploymentsAllowed(db, actor, teamId);

    const team = await db.one<TeamRow>('SELECT * FROM teams WHERE id = $1', [teamId]);
    const appSlug = slugify(metadata.appName);
    const existing = await db.maybeOne<AppRow>(
      'SELECT * FROM apps WHERE team_id = $1 AND slug = $2 AND deleted_at IS NULL',
      [teamId, appSlug]
    );
    const externalPasswordHash =
      metadata.access.externalPasswordEnabled && metadata.access.externalPassword
        ? await hashPassword(metadata.access.externalPassword)
        : null;

    const appRow =
      existing ??
      (await db.one<AppRow>(
        `INSERT INTO apps (
           team_id, name, slug, hostname, creator_user_id, last_updated_by_user_id,
           postgres_enabled, external_password_enabled, external_password_hash, login_access_enabled
         )
         VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          teamId,
          metadata.appName,
          appSlug,
          buildAppHostname(team.slug, appSlug, config.baseDomain),
          actor.user.id,
          metadata.postgres.enabled,
          metadata.access.externalPasswordEnabled,
          externalPasswordHash,
          metadata.access.loginRequired
        ]
      ));

    const deployment = await createDeploymentRecord(db, {
      appId: appRow.id,
      userId: actor.user.id,
      type: 'deploy',
      manifest: metadata,
      tarballSha: upload.tarballSha
    });
    await fs.rename(
      path.join(config.dataDir, 'uploads', tempUploadId),
      path.join(config.dataDir, 'uploads', deployment.id)
    );

    await applyDeploymentMetadata(db, config, appRow.id, actor, metadata);
    await addAppEvent(db, {
      appId: appRow.id,
      deploymentId: deployment.id,
      actorUserId: actor.user.id,
      eventType: 'deployment.queued',
      message: 'Deployment queued for worker processing.',
      metadata: { runtimeDriver: config.runtimeDriver }
    });
    await deploymentQueue.add('deployment', { deploymentId: deployment.id });
    await writeAuditLog(db, {
      actor,
      action: existing ? 'deployment.started' : 'app.created_and_deployed',
      targetType: 'deployment',
      targetId: deployment.id,
      sourceIp: clientIp(request)
    });
    return reply.status(202).send({ appId: appRow.id, deploymentId: deployment.id, status: deployment.status });
  });

  app.post('/api/v1/apps/:id/deployments', async (request, reply) => {
    const actor = await requireActor(db, request);
    const { id } = parseParams(IdParam, request);
    const appRow = await getAuthorizedApp(db, actor, id, 'creator');
    await ensureDeploymentsAllowed(db, actor, appRow.team_id);
    const deployment = await createDeploymentRecord(db, {
      appId: id,
      userId: actor.user.id,
      type: 'deploy',
      manifest: {}
    });
    const upload = await readDeploymentUpload(request, config, deployment.id);
    const metadata = DeployAppMetadata.parse(upload.metadata);
    await db.query(
      'UPDATE deployments SET manifest = $2, source_tarball_sha256 = $3 WHERE id = $1',
      [deployment.id, JSON.stringify(metadata), upload.tarballSha]
    );
    await applyDeploymentMetadata(db, config, id, actor, metadata);
    await addAppEvent(db, {
      appId: id,
      deploymentId: deployment.id,
      actorUserId: actor.user.id,
      eventType: 'deployment.queued',
      message: 'Deployment queued for worker processing.',
      metadata: { runtimeDriver: config.runtimeDriver }
    });
    await deploymentQueue.add('deployment', { deploymentId: deployment.id });
    await writeAuditLog(db, { actor, action: 'deployment.started', targetType: 'deployment', targetId: deployment.id, sourceIp: clientIp(request) });
    return reply.status(202).send({ appId: id, deploymentId: deployment.id, status: deployment.status });
  });

  app.get('/api/v1/apps/:id/deployments', async (request) => {
    const actor = await requireActor(db, request);
    const { id } = parseParams(IdParam, request);
    const query = parseQuery(DeploymentQuery, request);
    await getAuthorizedApp(db, actor, id, 'viewer');
    const deployments = await db.query<DeploymentRow>(
      'SELECT * FROM deployments WHERE app_id = $1 ORDER BY created_at DESC LIMIT $2',
      [id, query.limit]
    );
    return { deployments: deployments.rows };
  });

  app.post('/api/v1/apps/:id/rollback', async (request, reply) => {
    const actor = await requireActor(db, request);
    const { id } = parseParams(IdParam, request);
    const body = parseBody(z.object({ deploymentId: z.string().uuid() }), request);
    const appRow = await getAuthorizedApp(db, actor, id, 'creator');
    await ensureDeploymentsAllowed(db, actor, appRow.team_id);
    const source = await db.maybeOne<DeploymentRow>(
      "SELECT * FROM deployments WHERE id = $1 AND app_id = $2 AND status = 'succeeded'",
      [body.deploymentId, id]
    );
    if (!source) throw notFound('Rollback source deployment not found.');
    const deployment = await createDeploymentRecord(db, {
      appId: id,
      userId: actor.user.id,
      type: 'rollback',
      rollbackSourceDeploymentId: source.id,
      manifest: source.manifest
    });
    await addAppEvent(db, {
      appId: id,
      deploymentId: deployment.id,
      actorUserId: actor.user.id,
      eventType: 'deployment.rollback_queued',
      message: 'Rollback queued for worker processing.',
      metadata: { rollbackSourceDeploymentId: source.id }
    });
    await db.query("UPDATE apps SET status = 'deploying', updated_at = now(), last_updated_by_user_id = $2 WHERE id = $1", [
      id,
      actor.user.id
    ]);
    await deploymentQueue.add('deployment', { deploymentId: deployment.id });
    await writeAuditLog(db, { actor, action: 'deployment.rollback', targetType: 'deployment', targetId: deployment.id, sourceIp: clientIp(request) });
    return reply.status(202).send({ appId: id, deploymentId: deployment.id, status: deployment.status });
  });

  app.get('/api/v1/deployments/:id', async (request) => {
    const actor = await requireActor(db, request);
    const { id } = parseParams(IdParam, request);
    const deployment = await db.maybeOne<DeploymentRow>('SELECT * FROM deployments WHERE id = $1', [id]);
    if (!deployment) throw notFound('Deployment not found.');
    const appRow = await getAuthorizedApp(db, actor, deployment.app_id, 'viewer');
    return {
      deploymentId: deployment.id,
      appId: appRow.id,
      deploymentStatus: deployment.status,
      appStatus: appRow.status,
      url: deployment.status === 'succeeded' ? `https://${appRow.hostname}` : null,
      version: deployment.version_number,
      deployment,
      app: {
        id: appRow.id,
        status: appRow.status,
        url: `https://${appRow.hostname}`
      },
      error:
        deployment.error_code || deployment.error_message
          ? {
              code: deployment.error_code,
              message: deployment.error_message,
              details: deployment.error_details_json
            }
          : null
    };
  });

  app.get('/api/v1/apps/:id/secrets', async (request) => {
    const actor = await requireActor(db, request);
    const { id } = parseParams(IdParam, request);
    await getAuthorizedApp(db, actor, id, 'creator');
    const secrets = await db.query(
      `SELECT key, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM app_secrets
       WHERE app_id = $1
       ORDER BY key`,
      [id]
    );
    return { secrets: secrets.rows };
  });

  app.put('/api/v1/apps/:appId/secrets/:key', async (request) => {
    const actor = await requireActor(db, request);
    const { appId, key } = parseParams(AppSecretParam, request);
    const body = parseBody(SecretBody, request);
    await getAuthorizedApp(db, actor, appId, 'creator');
    const secretKey = requireSecretKeyName(key);
    await db.query(
      `INSERT INTO app_secrets (app_id, key, encrypted_value, created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (app_id, key) DO UPDATE
       SET encrypted_value = EXCLUDED.encrypted_value, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()`,
      [appId, secretKey, encryptSecret(body.value, config.secretKey), actor.user.id]
    );
    await addAppEvent(db, { appId, actorUserId: actor.user.id, eventType: 'secret.upserted', message: `Secret ${secretKey} updated.` });
    await writeAuditLog(db, { actor, action: 'secret.upserted', targetType: 'app', targetId: appId, sourceIp: clientIp(request), metadata: { key: secretKey } });
    return { key: secretKey, valueVisible: false };
  });

  app.delete('/api/v1/apps/:appId/secrets/:key', async (request) => {
    const actor = await requireActor(db, request);
    const { appId, key } = parseParams(AppSecretParam, request);
    await getAuthorizedApp(db, actor, appId, 'creator');
    const secretKey = requireSecretKeyName(key);
    await db.query('DELETE FROM app_secrets WHERE app_id = $1 AND key = $2', [appId, secretKey]);
    await addAppEvent(db, { appId, actorUserId: actor.user.id, eventType: 'secret.deleted', message: `Secret ${secretKey} deleted.` });
    await writeAuditLog(db, { actor, action: 'secret.deleted', targetType: 'app', targetId: appId, sourceIp: clientIp(request), metadata: { key: secretKey } });
    return { ok: true };
  });

  app.post('/api/v1/apps/:id/postgres', async (request) => {
    const actor = await requireActor(db, request);
    const { id } = parseParams(IdParam, request);
    await getAuthorizedApp(db, actor, id, 'creator');
    const dbName = `app_${id.replaceAll('-', '_')}`;
    const dbUser = `user_${id.replaceAll('-', '_')}`;
    const password = generateToken('pg');
    const credentials = await db.one(
      `INSERT INTO app_db_credentials (app_id, database_name, database_user, encrypted_database_password, deleted_at)
       VALUES ($1, $2, $3, $4, NULL)
       ON CONFLICT (app_id) DO UPDATE
       SET deleted_at = NULL
       RETURNING id, database_name AS "databaseName", database_user AS "databaseUser", created_at AS "createdAt", deleted_at AS "deletedAt"`,
      [id, dbName, dbUser, encryptSecret(password, config.secretKey)]
    );
    await db.query('UPDATE apps SET postgres_enabled = true, updated_at = now() WHERE id = $1', [id]);
    await writeAuditLog(db, { actor, action: 'postgres.enabled', targetType: 'app', targetId: id, sourceIp: clientIp(request) });
    return { credentials };
  });

  app.delete('/api/v1/apps/:id/postgres', async (request) => {
    const actor = await requireActor(db, request);
    const { id } = parseParams(IdParam, request);
    await getAuthorizedApp(db, actor, id, 'creator');
    await db.query('UPDATE app_db_credentials SET deleted_at = now() WHERE app_id = $1', [id]);
    await db.query('UPDATE apps SET postgres_enabled = false, updated_at = now() WHERE id = $1', [id]);
    await writeAuditLog(db, { actor, action: 'postgres.disabled', targetType: 'app', targetId: id, sourceIp: clientIp(request) });
    return { ok: true };
  });

  app.get('/api/v1/apps/:id/events', async (request) => {
    const actor = await requireActor(db, request);
    const { id } = parseParams(IdParam, request);
    await getAuthorizedApp(db, actor, id, 'viewer');
    const events = await db.query('SELECT * FROM app_events WHERE app_id = $1 ORDER BY created_at DESC LIMIT 100', [id]);
    return { events: events.rows };
  });

  app.get('/api/v1/apps/:id/logs', async (request) => {
    const actor = await requireActor(db, request);
    const { id } = parseParams(IdParam, request);
    const query = parseQuery(LogQuery, request);
    const appRow = await getAuthorizedApp(db, actor, id, 'creator');
    if (config.runtimeDriver === 'docker' && appRow.current_deployment_id) {
      const logs = await dockerLogsForDeployment(config, id, appRow.current_deployment_id, query.tail).catch(() => null);
      if (logs !== null) {
        return { source: 'docker', deploymentId: appRow.current_deployment_id, logs: logs ? logs.split('\n') : [] };
      }
    }
    const excerpts = await db.query<{ id: string; log_excerpt: string | null }>(
      `SELECT id, log_excerpt
       FROM deployments
       WHERE app_id = $1 AND log_excerpt IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 5`,
      [id]
    );
    return {
      source: 'deployment_excerpts',
      logs: excerpts.rows.flatMap((row) => row.log_excerpt?.split('\n').map((line) => `[${row.id}] ${line}`) ?? [])
    };
  });

  app.get('/api/v1/audit-logs', async (request) => {
    const actor = await requireActor(db, request);
    requirePlatformAdmin(actor);
    const query = parseQuery(DeploymentQuery, request);
    const logs = await db.query(
      `SELECT audit_logs.*,
              actor_users.email AS actor_user_email,
              actor_users.display_name AS actor_user_display_name,
              target_users.email AS target_user_email,
              target_users.display_name AS target_user_display_name,
              target_apps.name AS target_app_name,
              target_apps.hostname AS target_app_hostname,
              target_teams.name AS target_team_name
       FROM audit_logs
       LEFT JOIN users actor_users ON actor_users.id = audit_logs.actor_user_id
       LEFT JOIN users target_users ON audit_logs.target_type = 'user' AND target_users.id::text = audit_logs.target_id
       LEFT JOIN apps target_apps ON audit_logs.target_type = 'app' AND target_apps.id::text = audit_logs.target_id
       LEFT JOIN teams target_teams ON audit_logs.target_type = 'team' AND target_teams.id::text = audit_logs.target_id
       ORDER BY audit_logs.created_at DESC
       LIMIT $1`,
      [query.limit]
    );
    return { auditLogs: logs.rows };
  });
}

export async function buildServer(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, trustProxy: true });
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });
  await app.register(cookie, { secret: ctx.config.sessionSecret });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024, files: 1 } });
  await app.register(swagger, {
    openapi: {
      info: { title: 'VibeStack API', version: '0.1.0' },
      openapi: '3.1.0'
    }
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return sendError(reply, error);
    }
    if (error instanceof z.ZodError) {
      return sendError(reply, {
        code: 'VALIDATION_FAILED',
        message: 'The request payload is invalid.',
        statusCode: 400,
        details: { issues: error.issues }
      });
    }
    app.log.error(error);
    return sendError(reply, {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected server error occurred.',
      statusCode: 500
    });
  });

  await registerRoutes(app, ctx);
  return app;
}

export async function start(): Promise<void> {
  const config = loadConfig();
  await runMigrations();
  const db = createDb(config);
  await bootstrapFirstAdmin(db, config);
  const app = await buildServer({ config, db });

  const shutdown = async () => {
    await app.close();
    await db.close();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());

  await app.listen({ host: '0.0.0.0', port: config.port });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
