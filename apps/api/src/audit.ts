import type { Db } from './db.js';
import type { Actor } from './types.js';

export async function writeAuditLog(
  db: Db,
  input: {
    actor?: Actor;
    actorUserId?: string | null;
    actorType?: 'user' | 'api_token' | 'system';
    action: string;
    targetType: string;
    targetId?: string | null;
    sourceIp?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const actorUserId = input.actor?.user.id ?? input.actorUserId ?? null;
  const actorType = input.actor?.actorType ?? input.actorType ?? 'system';
  await db.query(
    `INSERT INTO audit_logs (actor_user_id, actor_type, action, target_type, target_id, source_ip, metadata_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      actorUserId,
      actorType,
      input.action,
      input.targetType,
      input.targetId ?? null,
      input.sourceIp ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null
    ]
  );
}
