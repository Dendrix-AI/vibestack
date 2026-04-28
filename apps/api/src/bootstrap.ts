import { slugify } from './util.js';
import { hashPassword } from './crypto.js';
import type { Config } from './config.js';
import type { Db } from './db.js';

export async function bootstrapFirstAdmin(db: Db, config: Config): Promise<void> {
  const firstAdminEmail = config.firstAdminEmail;
  const firstAdminPassword = config.firstAdminPassword;
  if (!firstAdminEmail || !firstAdminPassword) {
    return;
  }

  await db.transaction(async (client) => {
    const existing = await client.query<{ id: string }>('SELECT id FROM users WHERE lower(email) = lower($1)', [
      firstAdminEmail
    ]);
    if (existing.rows[0]) {
      await client.query(
        `UPDATE users
         SET is_platform_admin = true, status = 'active', updated_at = now()
         WHERE id = $1`,
        [existing.rows[0].id]
      );
      return;
    }

    const teamName = 'Platform Admins';
    const teamSlug = slugify(teamName);
    const team = await client.query<{ id: string }>(
      `INSERT INTO teams (name, slug)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [teamName, teamSlug]
    );
    const passwordHash = await hashPassword(firstAdminPassword);
    const displayName = firstAdminEmail.split('@')[0] ?? firstAdminEmail;
    const user = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, display_name, default_team_id, is_platform_admin)
       VALUES (lower($1), $2, $3, $4, true)
       RETURNING id`,
      [firstAdminEmail, passwordHash, displayName, team.rows[0]?.id]
    );
    await client.query(
      `INSERT INTO team_memberships (team_id, user_id, role)
       VALUES ($1, $2, 'team_admin')
       ON CONFLICT (team_id, user_id) DO UPDATE SET role = 'team_admin', updated_at = now()`,
      [team.rows[0]?.id, user.rows[0]?.id]
    );
  });
}
