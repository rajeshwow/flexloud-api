import { PoolClient } from "pg";

export async function getDefaultStageId(
  c: PoolClient,
  tenantId: string,
): Promise<string | null> {
  const r = await c.query(
    `select id from lead_stage_definitions
     where tenant_id = $1
     order by order_index asc
     limit 1`,
    [tenantId],
  );
  return r.rowCount ? String(r.rows[0].id) : null;
}

export async function getLead(c: PoolClient, tenantId: string, leadId: string) {
  const r = await c.query(
    `select id, tenant_id as "tenantId", title, source, status,
            owner_user_id as "ownerUserId",
            current_stage_id as "currentStageId",
            created_at as "createdAt", updated_at as "updatedAt"
     from leads
     where tenant_id=$1 and id=$2`,
    [tenantId, leadId],
  );
  return r.rowCount ? r.rows[0] : null;
}

export async function listLeadsForOwnerOrTeam(
  c: PoolClient,
  tenantId: string,
  userId: string,
  canSeeTeam: boolean,
) {
  if (!canSeeTeam) {
    const r = await c.query(
      `select id, title, status, owner_user_id as "ownerUserId", current_stage_id as "currentStageId",
              created_at as "createdAt", updated_at as "updatedAt"
       from leads
       where tenant_id=$1 and owner_user_id=$2
       order by updated_at desc
       limit 200`,
      [tenantId, userId],
    );
    return r.rows;
  }

  const r = await c.query(
    `select l.id, l.title, l.status, l.owner_user_id as "ownerUserId", l.current_stage_id as "currentStageId",
            l.created_at as "createdAt", l.updated_at as "updatedAt"
     from leads l
     where l.tenant_id=$1
       and l.owner_user_id in (
         select tm.user_id
         from team_members tm
         join teams t on t.id = tm.team_id
         where t.tenant_id=$1 and t.manager_user_id=$2
         union
         select $2
       )
     order by l.updated_at desc
     limit 200`,
    [tenantId, userId],
  );
  return r.rows;
}
