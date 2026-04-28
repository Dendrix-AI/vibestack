export function slugify(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug || 'app';
}

export function buildAppHostname(teamSlug: string, appSlug: string, baseDomain: string): string {
  return `${teamSlug}-${appSlug}.${baseDomain}`;
}

export function publicUser(row: {
  id: string;
  email: string;
  display_name: string;
  default_team_id: string | null;
  is_platform_admin: boolean;
  status: string;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
}): Record<string, unknown> {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    defaultTeamId: row.default_team_id,
    isPlatformAdmin: row.is_platform_admin,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at
  };
}

export function requireSecretKeyName(key: string): string {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
    throw new Error('Secret keys must use uppercase letters, numbers, and underscores, and must not start with a number.');
  }
  return key;
}
