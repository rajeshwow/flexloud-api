import { PoolClient } from "pg";

export async function insertOutbox(
  c: PoolClient,
  e: { id: string; tenantId: string; type: string; payload: unknown },
) {
  await c.query(
    `insert into outbox (id, tenant_id, type, payload, processed, created_at)
     values ($1,$2,$3,$4,false,now())`,
    [e.id, e.tenantId, e.type, JSON.stringify(e.payload)],
  );
}
