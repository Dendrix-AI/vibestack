import type { Db } from './db.js';
import { notFound, permissionDenied } from './errors.js';
import type { Actor, AppRow, TeamRole } from './types.js';

const roleRank: Record<TeamRole, number> = {
  viewer: 1,
  creator: 2,
  team_admin: 3
};

export async function getTeamRole(db: Db, userId: string, teamId: string): Promise<TeamRole | null> {
  const row = await db.maybeOne<{ role: TeamRole }>(
    'SELECT role FROM team_memberships WHERE team_id = $1 AND user_id = $2',
    [teamId, userId]
  );
  return row?.role ?? null;
}

export function requirePlatformAdmin(actor: Actor): void {
  if (!actor.user.is_platform_admin) {
    throw permissionDenied('Platform administrator permission is required.');
  }
}

export async function requireTeamRole(
  db: Db,
  actor: Actor,
  teamId: string,
  minimumRole: TeamRole
): Promise<TeamRole | 'platform_admin'> {
  if (actor.user.is_platform_admin) {
    return 'platform_admin';
  }

  const role = await getTeamRole(db, actor.user.id, teamId);
  if (!role || roleRank[role] < roleRank[minimumRole]) {
    throw permissionDenied(`Team role ${minimumRole} or higher is required.`);
  }
  return role;
}

export async function getAuthorizedApp(
  db: Db,
  actor: Actor,
  appId: string,
  minimumRole: TeamRole = 'viewer'
): Promise<AppRow> {
  const app = await db.maybeOne<AppRow>('SELECT * FROM apps WHERE id = $1 AND deleted_at IS NULL', [appId]);
  if (!app) {
    throw notFound('App not found.');
  }
  await requireTeamRole(db, actor, app.team_id, minimumRole);
  return app;
}
