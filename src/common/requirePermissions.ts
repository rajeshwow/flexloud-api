import { NextFunction, Response } from "express";
import { pool } from "../db/pool";
import { getTenantId } from "./tenant";

function resolvePermissionUserId(req: any) {
  return (
    req.user?.sub ||
    req.user?.id ||
    req.user?.user_id ||
    req.user?.userId ||
    req.auth?.sub ||
    req.auth?.id ||
    req.userId ||
    null
  );
}

export function requirePermissions(
  required: string[],
  mode: "ANY" | "ALL" = "ANY",
) {
  return async function (req: any, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req) || req.tenant?.id || req.tenantId;
      const userId = resolvePermissionUserId(req);

      if (!tenantId || !userId) {
        return res.status(401).json({
          statusCode: 401,
          message: "Unauthorized",
          data: null,
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
          data: {
            requiredPermissions: required,
          },
        });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}
