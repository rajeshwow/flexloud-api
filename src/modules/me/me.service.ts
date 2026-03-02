import { Request, Response } from "express";
import { pool } from "../../db/pool";

export async function getMyPermissions(req: Request, res: Response) {
  const userId = req.user?.sub; // JWT sub
  const tenantId = (req.user as any)?.tenantId; // you already store tenantId in JWT
  if (!userId || !tenantId) {
    return res.status(401).json({ statusCode: 401, message: "Unauthorized" });
  }

  // ✅ Bulletproof: permissions are derived ONLY through user_roles for same tenant,
  // and roles are also checked for same tenant.
  const { rows } = await pool.query<{ permission_code: string }>(
    `
    SELECT DISTINCT rp.permission_code
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id
    JOIN role_permissions rp ON rp.role_id = r.id
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
}
