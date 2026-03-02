import { Router } from "express";
import { pool } from "../db/pool";

export function meRouter() {
  const r = Router();

  r.get("/permissions", async (req, res) => {
    const userId = req.user?.sub;
    const tenantId = (req.user as any)?.tenantId; // must exist from token
    if (!userId || !tenantId) {
      return res.status(401).json({ statusCode: 401, message: "Unauthorized" });
    }

    const { rows } = await pool.query<{ permission_code: string }>(
      `
      SELECT DISTINCT rp.permission_code
      FROM user_roles ur
      JOIN roles ro ON ro.id = ur.role_id AND ro.tenant_id = ur.tenant_id
      JOIN role_permissions rp ON rp.role_id = ro.id
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
  });

  return r;
}
