import { Router } from "express";
import { getTenantId } from "../common/tenant";
import { pool } from "../db/pool";

export function meRouter() {
  const r = Router();

  r.get("/permissions", async (req: any, res, next) => {
    try {
      const userId = req.user?.sub;
      const tenantId = getTenantId(req);

      if (!userId || !tenantId) {
        return res.status(401).json({
          statusCode: 401,
          message: "Unauthorized",
        });
      }

      const { rows } = await pool.query<{ permission_code: string }>(
        `
        SELECT DISTINCT rp.permission_code
        FROM user_roles ur
        INNER JOIN roles ro
          ON ro.id = ur.role_id
         AND ro.tenant_id = ur.tenant_id
        INNER JOIN role_permissions rp
          ON rp.role_id = ro.id
        INNER JOIN permissions p
          ON p.code = rp.permission_code
        WHERE ur.user_id = $1
          AND ur.tenant_id = $2
        ORDER BY rp.permission_code ASC
        `,
        [userId, tenantId],
      );

      return res.json({
        statusCode: 200,
        permissions: rows.map((r) => r.permission_code),
      });
    } catch (error) {
      next(error);
    }
  });

  return r;
}
