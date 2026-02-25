import { Request } from "express";
import { db } from "../db/pool";
import { requestContext } from "../observability/requestContext";

export async function resolveTenant(req: Request) {
  if (!req.user)
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });

  const r = await db.query(
    `select ut.tenant_id, t.name as tenant_name, ut.roles
     from user_tenants ut
     join tenants t on t.id = ut.tenant_id
     where ut.user_id = $1
     limit 1`,
    [req.user.sub],
  );

  if (r.rowCount === 0)
    throw Object.assign(new Error("No tenant access"), { statusCode: 403 });

  const row = r.rows[0] as {
    tenant_id: string;
    tenant_name: string;
    roles: string[];
  };

  const ctx = requestContext.getStore();
  if (ctx) {
    ctx.tenantId = row.tenant_id;
    ctx.roles = row.roles ?? [];
  }

  return {
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    roles: row.roles ?? [],
  };
}
