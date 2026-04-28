import type { Config } from './config.js';
import type { Db } from './db.js';

type CloudflareSetting = {
  enabled?: boolean;
  zoneId?: string | null;
  apiToken?: string | null;
  apiTokenConfigured?: boolean;
  recordType?: 'CNAME' | 'A';
  targetHostname?: string | null;
  proxied?: boolean;
  ttl?: number;
};

type CloudflareRecord = {
  id: string;
  name: string;
  type: string;
  content: string;
};

type CloudflareResponse<T> = {
  success: boolean;
  result: T;
  errors?: Array<{ message?: string }>;
};

export type CloudflareDnsResult =
  | { skipped: true; reason: string }
  | { skipped: false; recordId: string; action: 'created' | 'updated' | 'deleted' };

export async function getCloudflareSetting(db: Db, config: Config): Promise<CloudflareSetting> {
  const row = await db.maybeOne<{ value_json: CloudflareSetting }>(
    "SELECT value_json FROM platform_settings WHERE key = 'cloudflare'"
  );
  const stored = row?.value_json ?? {};
  return {
    ...stored,
    enabled: stored.enabled ?? Boolean(config.cloudflareApiToken && config.cloudflareZoneId),
    zoneId: stored.zoneId ?? config.cloudflareZoneId ?? null,
    apiToken: stored.apiToken ?? config.cloudflareApiToken ?? null,
    recordType: stored.recordType ?? 'CNAME',
    targetHostname: stored.targetHostname ?? config.cloudflareTargetHostname ?? null
  };
}

export function publicCloudflareSetting(setting: CloudflareSetting): Record<string, unknown> {
  const { apiToken: _apiToken, ...rest } = setting;
  return {
    ...rest,
    apiTokenConfigured: Boolean(setting.apiToken || setting.apiTokenConfigured)
  };
}

export async function upsertCloudflareDnsRecord(input: {
  db: Db;
  config: Config;
  hostname: string;
}): Promise<CloudflareDnsResult> {
  const setting = await getCloudflareSetting(input.db, input.config);
  const client = cloudflareClient(setting);
  if (!client) return { skipped: true, reason: 'Cloudflare DNS is disabled or not configured.' };

  const type = setting.recordType ?? 'CNAME';
  const content = setting.targetHostname?.trim();
  if (!content) return { skipped: true, reason: 'Cloudflare targetHostname is not configured.' };

  const existing = await findDnsRecord(client, input.hostname, type);
  const payload = {
    type,
    name: input.hostname,
    content,
    proxied: setting.proxied ?? true,
    ttl: setting.proxied === false ? setting.ttl ?? 300 : 1
  };

  if (existing) {
    const record = await cloudflareRequest<CloudflareRecord>(
      client,
      `/dns_records/${existing.id}`,
      'PUT',
      payload
    );
    return { skipped: false, recordId: record.id, action: 'updated' };
  }

  const record = await cloudflareRequest<CloudflareRecord>(client, '/dns_records', 'POST', payload);
  return { skipped: false, recordId: record.id, action: 'created' };
}

export async function deleteCloudflareDnsRecord(input: {
  db: Db;
  config: Config;
  hostname: string;
}): Promise<CloudflareDnsResult> {
  const setting = await getCloudflareSetting(input.db, input.config);
  const client = cloudflareClient(setting);
  if (!client) return { skipped: true, reason: 'Cloudflare DNS is disabled or not configured.' };

  const type = setting.recordType ?? 'CNAME';
  const existing = await findDnsRecord(client, input.hostname, type);
  if (!existing) return { skipped: true, reason: 'Cloudflare DNS record was not found.' };

  await cloudflareRequest<{ id: string }>(client, `/dns_records/${existing.id}`, 'DELETE');
  return { skipped: false, recordId: existing.id, action: 'deleted' };
}

function cloudflareClient(setting: CloudflareSetting): { token: string; zoneId: string } | null {
  if (setting.enabled !== true) return null;
  if (!setting.zoneId || !setting.apiToken) return null;
  return { token: setting.apiToken, zoneId: setting.zoneId };
}

async function findDnsRecord(
  client: { token: string; zoneId: string },
  hostname: string,
  type: string
): Promise<CloudflareRecord | null> {
  const params = new URLSearchParams({ name: hostname, type, per_page: '1' });
  const records = await cloudflareRequest<CloudflareRecord[]>(client, `/dns_records?${params.toString()}`, 'GET');
  return records[0] ?? null;
}

async function cloudflareRequest<T>(
  client: { token: string; zoneId: string },
  path: string,
  method: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${client.zoneId}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${client.token}`,
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = (await response.json()) as CloudflareResponse<T>;
  if (!response.ok || !payload.success) {
    const message = payload.errors?.map((error) => error.message).filter(Boolean).join('; ');
    throw new Error(`Cloudflare DNS request failed${message ? `: ${message}` : ''}`);
  }
  return payload.result;
}
