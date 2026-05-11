import type { Config } from './config.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import type { Db } from './db.js';
import type { AppRow, DeploymentRow } from './types.js';

export type DoctorRootCause =
  | 'missing_health_route'
  | 'wrong_bind_host'
  | 'wrong_port'
  | 'missing_env_secret'
  | 'database_connection_localhost'
  | 'missing_table_or_migration'
  | 'build_failure'
  | 'container_start_failure'
  | 'health_check_failure'
  | 'healthy'
  | 'unknown';

export type DoctorEvidence = {
  source: string;
  label: string;
  value: string;
  severity: 'info' | 'warning' | 'error';
};

export type DoctorPacket = {
  summary: string;
  rootCauseCategory: DoctorRootCause;
  evidence: DoctorEvidence[];
  suggestedFixPrompt: string;
  safeToRetry: boolean;
  relatedDeploymentId: string | null;
  healthCheckResult: {
    status: 'failed' | 'passed' | 'unknown';
    checkedUrl?: string;
    port?: number;
    path?: string;
    message?: string;
  };
  postgresHints: {
    enabled: boolean;
    issue?: 'localhost_connection' | 'missing_table_or_migration' | 'unknown';
    evidence: DoctorEvidence[];
  };
  aiEnhancement?: {
    model: string;
    summary: string;
    suggestedFixPrompt: string;
  };
};

type OpenRouterSetting = {
  enabled?: boolean;
  model?: string;
  apiKey?: string;
  encryptedApiKey?: string;
};

type DoctorInput = {
  app: AppRow;
  deployments: DeploymentRow[];
  secrets: string[];
  appLogs: string[];
  postgres: {
    enabled: boolean;
    logs: string[];
  };
};

const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-5.5';

export function publicOpenRouterSetting(setting: OpenRouterSetting): Record<string, unknown> {
  const configured = Boolean(setting.apiKey || setting.encryptedApiKey);
  return {
    enabled: setting.enabled ?? configured,
    model: setting.model ?? DEFAULT_OPENROUTER_MODEL,
    configured,
    apiKeyConfigured: configured
  };
}

export async function normalizeOpenRouterSetting(
  db: Db,
  config: Config,
  value: unknown
): Promise<OpenRouterSetting> {
  const previous = await getStoredOpenRouterSetting(db);
  const input = asRecord(value);
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : undefined;
  const api_key = typeof input.api_key === 'string' ? input.api_key.trim() : undefined;
  const clearApiKey = input.apiKey === null || input.api_key === null;
  const model = typeof input.model === 'string' && input.model.trim() ? input.model.trim() : previous.model;
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : previous.enabled;

  return {
    enabled: enabled ?? Boolean(previous.encryptedApiKey || apiKey || api_key),
    model: model ?? DEFAULT_OPENROUTER_MODEL,
    encryptedApiKey: clearApiKey
      ? undefined
      : apiKey || api_key
        ? encryptSecret(apiKey || api_key || '', config.secretKey)
        : previous.encryptedApiKey
  };
}

export async function getOpenRouterSetting(db: Db, config: Config): Promise<OpenRouterSetting> {
  const stored = await getStoredOpenRouterSetting(db);
  const apiKey = stored.encryptedApiKey ? decryptSecret(stored.encryptedApiKey, config.secretKey) : undefined;
  return {
    enabled: stored.enabled ?? Boolean(apiKey),
    model: stored.model ?? DEFAULT_OPENROUTER_MODEL,
    apiKey,
    encryptedApiKey: stored.encryptedApiKey
  };
}

async function getStoredOpenRouterSetting(db: Db): Promise<OpenRouterSetting> {
  const row = await db.maybeOne<{ value_json: unknown }>("SELECT value_json FROM platform_settings WHERE key = 'openRouter'");
  const stored = asRecord(row?.value_json);
  return {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : undefined,
    model: typeof stored.model === 'string' ? stored.model : undefined,
    encryptedApiKey: typeof stored.encryptedApiKey === 'string' ? stored.encryptedApiKey : undefined
  };
}

export async function buildDoctorPacket(input: DoctorInput): Promise<DoctorPacket> {
  const latestDeployment = input.deployments[0];
  const latestFailed = latestDeployment?.status === 'failed' ? latestDeployment : undefined;
  const historicalFailure =
    latestDeployment?.status === 'succeeded'
      ? input.deployments.find((deployment) => deployment.status === 'failed')
      : undefined;
  const failedDeployment = latestFailed ?? (input.app.status === 'failed' ? latestDeployment : undefined);
  const details = asRecord(failedDeployment?.error_details_json);
  const manifest = asRecord(failedDeployment?.manifest ?? latestDeployment?.manifest);
  const healthPath = stringValue(details.healthCheckPath) ?? stringValue(manifest.healthCheckPath);
  const checkedUrl = stringValue(details.checkedUrl);
  const port = numberValue(details.port) ?? numberValue(manifest.port);
  const text = diagnosticText({
    deployment: failedDeployment,
    details,
    appLogs: input.appLogs,
    postgresLogs: input.postgres.logs
  });
  const evidence: DoctorEvidence[] = [];

  if (latestDeployment?.status === 'succeeded' && input.app.status === 'running') {
    evidence.push({
      source: 'deployment',
      label: 'Current deployment',
      value: `Latest deployment v${latestDeployment.version_number} succeeded.`,
      severity: 'info'
    });
    if (historicalFailure) {
      evidence.push({
        source: 'deployment',
        label: 'Historical failure',
        value: `Older deployment v${historicalFailure.version_number} failed with ${historicalFailure.error_code ?? 'an unknown error'}.`,
        severity: 'info'
      });
    }
    return packetFor({
      app: input.app,
      category: 'healthy',
      evidence,
      relatedDeploymentId: latestDeployment.id,
      healthCheckResult: { status: 'passed', checkedUrl, port, path: healthPath },
      postgresEnabled: input.postgres.enabled
    });
  }

  if (!failedDeployment) {
    evidence.push({
      source: 'app',
      label: 'Status',
      value: `No failed deployment found. Current app status is ${input.app.status}.`,
      severity: 'info'
    });
    return packetFor({
      app: input.app,
      category: 'unknown',
      evidence,
      relatedDeploymentId: null,
      healthCheckResult: { status: 'unknown', checkedUrl, port, path: healthPath },
      postgresEnabled: input.postgres.enabled
    });
  }

  addDeploymentEvidence(evidence, failedDeployment, details);
  addMissingRequiredSecretEvidence(evidence, manifest, input.secrets);

  const category = classifyRootCause({
    deployment: failedDeployment,
    details,
    manifest,
    text,
    evidence
  });
  const postgresEvidence = postgresHints(input.postgres.enabled, input.postgres.logs);
  for (const item of postgresEvidence.evidence) evidence.push(item);

  return packetFor({
    app: input.app,
    category: postgresEvidence.issue === 'localhost_connection' ? 'database_connection_localhost' : postgresEvidence.issue === 'missing_table_or_migration' ? 'missing_table_or_migration' : category,
    evidence,
    relatedDeploymentId: failedDeployment.id,
    healthCheckResult: {
      status: failedDeployment.error_code === 'HEALTH_CHECK_FAILED' ? 'failed' : 'unknown',
      checkedUrl,
      port,
      path: healthPath,
      message: failedDeployment.error_message ?? undefined
    },
    postgresEnabled: input.postgres.enabled,
    postgresIssue: postgresEvidence.issue,
    postgresEvidence: postgresEvidence.evidence
  });
}

export async function enrichDoctorWithOpenRouter(db: Db, config: Config, packet: DoctorPacket): Promise<DoctorPacket> {
  if (!packet.relatedDeploymentId) return packet;
  const setting = await getOpenRouterSetting(db, config);
  if (!setting.enabled || !setting.apiKey) return packet;

  const prompt = [
    'You are VibeStack Doctor. Improve this deployment troubleshooting packet for a coding agent.',
    'Do not invent evidence. Do not include secrets. Keep the result concise and actionable.',
    'Return JSON only with keys summary and suggestedFixPrompt.',
    JSON.stringify({
      summary: packet.summary,
      rootCauseCategory: packet.rootCauseCategory,
      evidence: packet.evidence.slice(0, 12),
      deterministicSuggestedFixPrompt: packet.suggestedFixPrompt,
      healthCheckResult: packet.healthCheckResult,
      postgresHints: packet.postgresHints
    })
  ].join('\n\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${setting.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': config.publicUrl,
        'X-Title': 'VibeStack Doctor'
      },
      body: JSON.stringify({
        model: setting.model ?? DEFAULT_OPENROUTER_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      }),
      signal: controller.signal
    });
    if (!response.ok) return packet;
    const body = asRecord(await response.json());
    const choices = Array.isArray(body.choices) ? body.choices : [];
    const first = asRecord(choices[0]);
    const message = asRecord(first.message);
    const content = typeof message.content === 'string' ? message.content : '';
    const parsed = parseJsonObject(content);
    const summary = typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : undefined;
    const suggestedFixPrompt =
      typeof parsed.suggestedFixPrompt === 'string' && parsed.suggestedFixPrompt.trim()
        ? parsed.suggestedFixPrompt.trim()
        : undefined;
    if (!summary && !suggestedFixPrompt) return packet;
    return {
      ...packet,
      aiEnhancement: {
        model: setting.model ?? DEFAULT_OPENROUTER_MODEL,
        summary: summary ?? packet.summary,
        suggestedFixPrompt: suggestedFixPrompt ?? packet.suggestedFixPrompt
      }
    };
  } catch {
    return packet;
  } finally {
    clearTimeout(timeout);
  }
}

function classifyRootCause(input: {
  deployment: DeploymentRow;
  details: Record<string, unknown>;
  manifest: Record<string, unknown>;
  text: string;
  evidence: DoctorEvidence[];
}): DoctorRootCause {
  const code = input.deployment.error_code ?? '';
  const text = input.text.toLowerCase();

  if (input.evidence.some((item) => item.label === 'Missing required secret')) return 'missing_env_secret';
  if (code === 'PORT_MISMATCH' || input.details.manifestPort || input.details.exposedPorts) return 'wrong_port';
  if (looksLikeBuildFailure(code, text)) return 'build_failure';
  if (/missing|required|not set/.test(text) && /(env|environment|secret|api[_ -]?key|token)/.test(text)) return 'missing_env_secret';
  if (/(localhost|127\.0\.0\.1).{0,80}(5432|postgres|database)|econnrefused.{0,80}(localhost|127\.0\.0\.1)/.test(text)) {
    return 'database_connection_localhost';
  }
  if (/(relation|table).{0,80}(does not exist|not found)|no such table|undefined_table|migration/.test(text)) {
    return 'missing_table_or_migration';
  }
  if (code === 'HEALTH_CHECK_FAILED') {
    if (/(cannot get|404|not found).{0,80}(health|\/health)/.test(text)) return 'missing_health_route';
    if (/(127\.0\.0\.1|localhost).{0,80}(listen|listening|server|local)/.test(text)) return 'wrong_bind_host';
    if (input.details.port || input.manifest.port) return 'health_check_failure';
  }
  if (/docker run|container start|exited|cannot find module|command not found|exec format error/.test(text)) {
    return 'container_start_failure';
  }
  return 'unknown';
}

function packetFor(input: {
  app: AppRow;
  category: DoctorRootCause;
  evidence: DoctorEvidence[];
  relatedDeploymentId: string | null;
  healthCheckResult: DoctorPacket['healthCheckResult'];
  postgresEnabled: boolean;
  postgresIssue?: DoctorPacket['postgresHints']['issue'];
  postgresEvidence?: DoctorEvidence[];
}): DoctorPacket {
  return {
    summary: summaryFor(input.app, input.category),
    rootCauseCategory: input.category,
    evidence: input.evidence.slice(0, 18),
    suggestedFixPrompt: promptFor(input.app, input.category, input.evidence, input.healthCheckResult),
    safeToRetry: input.category === 'unknown',
    relatedDeploymentId: input.relatedDeploymentId,
    healthCheckResult: input.healthCheckResult,
    postgresHints: {
      enabled: input.postgresEnabled,
      issue: input.postgresIssue,
      evidence: input.postgresEvidence ?? []
    }
  };
}

function summaryFor(app: AppRow, category: DoctorRootCause): string {
  const prefix = `${app.name} diagnosis`;
  switch (category) {
    case 'healthy':
      return `${prefix}: current app state looks healthy and the latest deployment succeeded.`;
    case 'missing_health_route':
      return `${prefix}: the configured health check route appears to be missing or returning a non-2xx response.`;
    case 'wrong_bind_host':
      return `${prefix}: the app likely binds to localhost instead of 0.0.0.0 inside the container.`;
    case 'wrong_port':
      return `${prefix}: the app port, Dockerfile EXPOSE, and vibestack.json port appear to disagree.`;
    case 'missing_env_secret':
      return `${prefix}: the app appears to be missing a required environment variable or secret.`;
    case 'database_connection_localhost':
      return `${prefix}: the app appears to connect to Postgres on localhost instead of the injected DATABASE_URL.`;
    case 'missing_table_or_migration':
      return `${prefix}: the app database appears to be missing a table or startup migration.`;
    case 'build_failure':
      return `${prefix}: the Docker image build failed before VibeStack could start the app.`;
    case 'container_start_failure':
      return `${prefix}: the container appears to exit or fail during startup.`;
    case 'health_check_failure':
      return `${prefix}: the app did not pass the configured VibeStack health check.`;
    case 'unknown':
      return `${prefix}: VibeStack found a failure, but it could not classify a deterministic root cause.`;
  }
}

function promptFor(
  app: AppRow,
  category: DoctorRootCause,
  evidence: DoctorEvidence[],
  health: DoctorPacket['healthCheckResult']
): string {
  const evidenceText = evidence
    .slice(0, 8)
    .map((item) => `- ${item.label}: ${item.value}`)
    .join('\n');
  const healthText = health.checkedUrl
    ? `VibeStack checked ${health.checkedUrl} and expected HTTP 2xx.`
    : health.path || health.port
      ? `VibeStack expected health path ${health.path ?? '(unknown)'} on port ${health.port ?? '(unknown)'}.`
      : 'VibeStack could not determine a concrete health-check URL.';
  const instruction = instructionFor(category);
  return [
    `Fix the VibeStack deployment for app "${app.name}".`,
    `Root cause category: ${category}.`,
    healthText,
    'Evidence:',
    evidenceText || '- No concrete evidence was available.',
    '',
    instruction,
    'After fixing, run the local VibeStack deploy helper with --smoke-test, then redeploy only if the smoke test passes.'
  ].join('\n');
}

function instructionFor(category: DoctorRootCause): string {
  switch (category) {
    case 'missing_health_route':
      return 'Add or repair a fast unauthenticated health route that returns HTTP 2xx, then set vibestack.json healthCheckPath to that route.';
    case 'healthy':
      return 'No repair is needed for the current deployment. Ignore older failed deployment attempts unless the current app starts failing again.';
    case 'wrong_bind_host':
      return 'Change the web server to listen on 0.0.0.0 inside the container, not localhost or 127.0.0.1.';
    case 'wrong_port':
      return 'Align the application listen port, Dockerfile EXPOSE, and vibestack.json port.';
    case 'missing_env_secret':
      return 'Identify the missing environment variable, add it as a VibeStack app secret or remove the hard requirement, and make startup errors explicit.';
    case 'database_connection_localhost':
      return 'Use process.env.DATABASE_URL for Postgres. Do not hard-code localhost, database names, users, or passwords.';
    case 'missing_table_or_migration':
      return 'Add idempotent startup migrations or table initialization so the app can boot against a fresh VibeStack-managed database.';
    case 'build_failure':
      return 'Fix the Dockerfile or dependency installation failure so docker build succeeds from a clean packaged context.';
    case 'container_start_failure':
      return 'Fix the container command, missing runtime files, or startup exception so the server process stays in the foreground.';
    case 'health_check_failure':
      return 'Ensure the app starts quickly, listens on the manifest port, binds to 0.0.0.0, and returns HTTP 2xx at the configured health path.';
    case 'unknown':
      return 'Inspect the deployment error and logs, make one concrete fix, and do not retry the same unchanged artifact repeatedly.';
  }
}

function addDeploymentEvidence(
  evidence: DoctorEvidence[],
  deployment: DeploymentRow,
  details: Record<string, unknown>
): void {
  if (deployment.error_code) {
    evidence.push({ source: 'deployment', label: 'Error code', value: deployment.error_code, severity: 'error' });
  }
  if (deployment.error_message) {
    evidence.push({ source: 'deployment', label: 'Error message', value: deployment.error_message, severity: 'error' });
  }
  const checkedUrl = stringValue(details.checkedUrl);
  if (checkedUrl) {
    evidence.push({ source: 'health_check', label: 'Checked URL', value: checkedUrl, severity: 'error' });
  }
  const logExcerpt = stringValue(details.logExcerpt) ?? deployment.log_excerpt;
  if (logExcerpt) {
    evidence.push({ source: 'logs', label: 'Relevant log excerpt', value: trimLines(logExcerpt), severity: 'error' });
  }
}

function addMissingRequiredSecretEvidence(
  evidence: DoctorEvidence[],
  manifest: Record<string, unknown>,
  configuredSecrets: string[]
): void {
  const requiredSecrets = Array.isArray(manifest.requiredSecrets) ? manifest.requiredSecrets : [];
  const configured = new Set(configuredSecrets);
  for (const secret of requiredSecrets) {
    if (typeof secret === 'string' && !configured.has(secret)) {
      evidence.push({ source: 'manifest', label: 'Missing required secret', value: secret, severity: 'error' });
    }
  }
}

function postgresHints(enabled: boolean, logs: string[]): {
  issue?: DoctorPacket['postgresHints']['issue'];
  evidence: DoctorEvidence[];
} {
  if (!enabled || logs.length === 0) return { evidence: [] };
  const text = logs.join('\n').toLowerCase();
  const evidence = logs.slice(-5).map((line) => ({
    source: 'postgres',
    label: 'Postgres log',
    value: line,
    severity: 'warning' as const
  }));
  if (/(localhost|127\.0\.0\.1).{0,80}(5432|postgres|database)|econnrefused/.test(text)) {
    return { issue: 'localhost_connection', evidence };
  }
  if (/(relation|table).{0,80}(does not exist|not found)|no such table|undefined_table|migration/.test(text)) {
    return { issue: 'missing_table_or_migration', evidence };
  }
  return { issue: 'unknown', evidence };
}

function looksLikeBuildFailure(code: string, text: string): boolean {
  return (
    code === 'BUILD_FAILED' ||
    /docker build|failed to solve|npm err!|pnpm|yarn install|pip install|cargo build|go build|dockerfile/.test(text)
  );
}

function diagnosticText(input: {
  deployment?: DeploymentRow;
  details: Record<string, unknown>;
  appLogs: string[];
  postgresLogs: string[];
}): string {
  return [
    input.deployment?.error_code,
    input.deployment?.error_message,
    input.deployment?.log_excerpt,
    JSON.stringify(input.details),
    ...input.appLogs,
    ...input.postgresLogs
  ]
    .filter(Boolean)
    .join('\n');
}

function trimLines(value: string): string {
  const lines = value.split('\n').filter(Boolean).slice(-20);
  const text = lines.join('\n');
  return text.length > 1800 ? text.slice(-1800) : text;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseJsonObject(value: string): Record<string, unknown> {
  const trimmed = value.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    return {};
  }
}
