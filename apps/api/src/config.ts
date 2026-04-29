import { z } from 'zod';

const ConfigSchema = z.object({
  nodeEnv: z.string().default('development'),
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  publicUrl: z.string().url().default('http://localhost:3000'),
  baseDomain: z.string().min(1).default('localdomain'),
  cookieDomain: z.string().min(1).optional(),
  installDir: z.string().min(1).default('/opt/vibestack'),
  sourceDir: z.string().min(1).default('/opt/vibestack-source'),
  repoUrl: z.string().min(1).default('https://github.com/dankritz/vibestack.git'),
  updateChannel: z.string().min(1).default('main'),
  dataDir: z.string().min(1).default('.vibestack-data'),
  sessionSecret: z.string().min(16).default('change-me-session-secret'),
  secretKey: z.string().min(8).default('change-me-32-byte-secret'),
  databaseUrl: z.string().min(1),
  appPostgresHost: z.string().min(1).default('postgres'),
  appPostgresPort: z.coerce.number().int().min(1).max(65535).default(5432),
  redisUrl: z.string().min(1).default('redis://localhost:6379'),
  runtimeDriver: z.enum(['mock', 'docker']).default('mock'),
  traefikNetwork: z.string().min(1).default('vibestack_apps'),
  traefikEntrypoint: z.string().min(1).default('websecure'),
  traefikCertResolver: z.string().min(1).default('letsencrypt'),
  gatewayAuthUrl: z.string().url().default('http://api:3000/api/v1/gateway/forward-auth'),
  cloudflareApiToken: z.string().min(1).optional(),
  cloudflareZoneId: z.string().min(1).optional(),
  cloudflareTargetHostname: z.string().min(1).optional(),
  firstAdminEmail: z.string().email().optional(),
  firstAdminPassword: z.string().min(8).optional()
});

export type Config = z.infer<typeof ConfigSchema>;

function assertProductionSecrets(config: Config): void {
  if (config.nodeEnv === 'development' || config.nodeEnv === 'test') {
    return;
  }

  if (config.sessionSecret === 'change-me-session-secret') {
    throw new Error('VIBESTACK_SESSION_SECRET must be set to a generated secret outside development.');
  }

  if (config.secretKey === 'change-me-32-byte-secret') {
    throw new Error('VIBESTACK_SECRET_KEY must be set to a generated secret outside development.');
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl =
    env.DATABASE_URL ??
    `postgres://${env.POSTGRES_USER ?? 'vibestack'}:${env.POSTGRES_PASSWORD ?? 'vibestack'}@${env.POSTGRES_HOST ?? 'localhost'}:${env.POSTGRES_PORT ?? '5432'}/${env.POSTGRES_DB ?? 'vibestack'}`;

  const config = ConfigSchema.parse({
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    publicUrl: env.VIBESTACK_PUBLIC_URL,
    baseDomain: env.VIBESTACK_BASE_DOMAIN,
    cookieDomain: env.VIBESTACK_COOKIE_DOMAIN || undefined,
    installDir: env.VIBESTACK_INSTALL_DIR,
    sourceDir: env.VIBESTACK_SOURCE_DIR,
    repoUrl: env.VIBESTACK_REPO_URL,
    updateChannel: env.VIBESTACK_UPDATE_CHANNEL,
    dataDir: env.VIBESTACK_DATA_DIR,
    sessionSecret: env.VIBESTACK_SESSION_SECRET,
    secretKey: env.VIBESTACK_SECRET_KEY,
    databaseUrl,
    appPostgresHost: env.VIBESTACK_APP_POSTGRES_HOST ?? env.POSTGRES_HOST,
    appPostgresPort: env.VIBESTACK_APP_POSTGRES_PORT ?? env.POSTGRES_PORT,
    redisUrl: env.REDIS_URL,
    runtimeDriver: env.RUNTIME_DRIVER,
    traefikNetwork: env.TRAEFIK_NETWORK,
    traefikEntrypoint: env.TRAEFIK_ENTRYPOINT,
    traefikCertResolver: env.TRAEFIK_CERT_RESOLVER,
    gatewayAuthUrl: env.VIBESTACK_GATEWAY_AUTH_URL,
    cloudflareApiToken: env.CLOUDFLARE_API_TOKEN,
    cloudflareZoneId: env.CLOUDFLARE_ZONE_ID,
    cloudflareTargetHostname: env.CLOUDFLARE_TARGET_HOSTNAME,
    firstAdminEmail: env.FIRST_ADMIN_EMAIL,
    firstAdminPassword: env.FIRST_ADMIN_PASSWORD
  });
  assertProductionSecrets(config);
  return config;
}
