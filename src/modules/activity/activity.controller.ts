import { NextFunction, Request, Response } from "express";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";

export async function getActivityLogsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const { entityType, entityId } = req.params;

    const result = await pool.query(
      `
  SELECT
    a.*,
    u.name as user_name
  FROM activity_logs a
  LEFT JOIN users u ON u.id = a.created_by_id
  WHERE a.tenant_id = $1
    AND a.entity_type = $2
    AND a.entity_id = $3
  ORDER BY a.created_at DESC
  `,
      [tenantId, entityType, entityId], // ✅ FIXED
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (err) {
    next(err);
  }
}
