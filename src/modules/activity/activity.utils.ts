import { PoolClient } from "pg";

type CreateActivityLogParams = {
  tenantId: string;
  entityType: string;
  entityId: string;
  actionType: string;
  title?: string | null;
  description?: string | null;
  metadata?: Record<string, any> | null;
  createdById?: string | null;
  client: PoolClient;
};

export async function createActivityLog({
  tenantId,
  entityType,
  entityId,
  actionType,
  title = null,
  description = null,
  metadata = null,
  createdById = null,
  client,
}: CreateActivityLogParams) {
  await client.query(
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
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
    `,
    [
      tenantId,
      entityType,
      entityId,
      actionType,
      title,
      description,
      metadata ? JSON.stringify(metadata) : null,
      createdById,
    ],
  );
}
