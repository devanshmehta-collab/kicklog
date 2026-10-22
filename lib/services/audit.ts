import { auditLogs } from "../db/schema";
import type { DB } from "../db";

export async function audit(
  db: DB,
  entry: { userId?: string | null; action: string; entity?: string; entityId?: string; detail?: unknown; ip?: string | null },
) {
  await db.insert(auditLogs).values({
    userId: entry.userId ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    detail: entry.detail ?? null,
    ip: entry.ip ?? null,
  });
}
