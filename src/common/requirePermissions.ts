import { NextFunction, Response } from "express";
import { pool } from "../db/pool";
import { getTenantId } from "./tenant";

export function requirePermissions(
  required: string[],
  mode: "ANY" | "ALL" = "ANY",
) {
  return async function (req: any, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const userId = req.user?.sub;

      if (!tenantId || !userId) {
        return res.status(401).json({
          statusCode: 401,
          message: "Unauthorized",
        });
      }

      const { rows } = await pool.query<{ permission_code: string }>(
        `
        SELECT DISTINCT rp.permission_code
        FROM user_roles ur
        INNER JOIN roles r
          ON r.id = ur.role_id
         AND r.tenant_id = ur.tenant_id
         AND r.is_active = true
        INNER JOIN role_permissions rp
          ON rp.role_id = r.id
        INNER JOIN permissions p
          ON p.code = rp.permission_code
         AND p.is_active = true
        WHERE ur.user_id = $1
          AND ur.tenant_id = $2
        ORDER BY rp.permission_code ASC
        `,
        [userId, tenantId],
      );

      const myPermissions = rows.map((row) => row.permission_code);
      req.permissions = myPermissions;

      const hasAccess =
        mode === "ALL"
          ? required.every((perm) => myPermissions.includes(perm))
          : required.some((perm) => myPermissions.includes(perm));

      if (!hasAccess) {
        return res.status(403).json({
          statusCode: 403,
          message: "Forbidden",
          requiredPermissions: required,
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
