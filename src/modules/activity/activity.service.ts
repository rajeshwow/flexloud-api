import { PoolClient } from "pg";
import { pool } from "../../db/pool";

export type CreateActivityLogPayload = {
  tenantId: string;
  entityType: string;
  entityId: string;
  actionType: string;
  title?: string | null;
  description?: string | null;
  metadata?: Record<string, any> | null;
  createdById?: string | null;
};

export async function createActivityLog(
  payload: CreateActivityLogPayload,
  client?: PoolClient,
) {
  const executor = client ?? pool;

  await executor.query(
    `
    INSERT INTO activity_logs (
      tenant_id,
      entity_type,
      entity_id,
      action_type,
      title,
      description,
      metadata,
      created_by_id,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, NOW(), NOW())
    `,
    [
      payload.tenantId,
      payload.entityType,
      payload.entityId,
      payload.actionType,
      payload.title ?? null,
      payload.description ?? null,
      payload.metadata ? JSON.stringify(payload.metadata) : null,
      payload.createdById ?? null,
    ],
  );
}
