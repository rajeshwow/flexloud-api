import { NextFunction, Request, Response } from "express";
import { pool } from "../../db/pool";
import {
  updateUserCostCentersSchema,
  userIdParamsSchema,
} from "./user-cost-centers.schema";

type AppRequest = Request & {
  tenant?: {
    id?: string;
    tenant_id?: string;
  };
  user?: {
    id?: string;
    user_id?: string;
    sub?: string;
  };
};

function sendResponse(
  res: Response,
  statusCode: number,
  message: string,
  data: unknown,
) {
  return res.status(statusCode).json({
    statusCode,
    message,
    data,
  });
}

function getTenantId(req: AppRequest): string {
  const tenantId =
    req.tenant?.id ||
    req.tenant?.tenant_id ||
    (req as any).tenantId ||
    (req as any).tenant_id;

  if (!tenantId) {
    throw new Error(
      "Tenant context missing. Make sure resolveTenant middleware runs before this route.",
    );
  }

  return tenantId;
}

function getCurrentUserId(req: AppRequest): string {
  const userId =
    req.user?.id ||
    req.user?.user_id ||
    req.user?.sub ||
    (req as any).userId ||
    (req as any).user_id;

  if (!userId) {
    throw new Error(
      "User context missing. Make sure requireAuth middleware runs before this route.",
    );
  }

  return userId;
}

async function assertUserBelongsToTenant(
  tenantId: string,
  userId: string,
): Promise<boolean> {
  const result = await pool.query(
    `
    SELECT 1
    FROM user_roles ur
    WHERE ur.tenant_id = $1
      AND ur.user_id = $2
    LIMIT 1
    `,
    [tenantId, userId],
  );

  return Boolean(result.rowCount);
}

export async function getUserCostCentersHandler(
  req: AppRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const { userId } = userIdParamsSchema.parse(req.params);

    const userExists = await assertUserBelongsToTenant(tenantId, userId);

    if (!userExists) {
      return sendResponse(res, 404, "User not found in this tenant", null);
    }

    const result = await pool.query(
      `
      SELECT
        cc.id,
        cc.tenant_id,
        cc.tally_guid,
        cc.name,
        cc.parent_name,
        cc.description,
        cc.status,

        CASE
          WHEN ucc.id IS NOT NULL
           AND ucc.is_active = true
           AND ucc.deleted_at IS NULL
          THEN true
          ELSE false
        END AS checked,

        ucc.id AS assignment_id,
        ucc.created_at AS assigned_at,
        ucc.updated_at AS updated_at

      FROM cost_centers cc
      LEFT JOIN user_cost_centers ucc
        ON ucc.tenant_id = cc.tenant_id
       AND ucc.cost_center_id = cc.id
       AND ucc.user_id = $2
       AND ucc.deleted_at IS NULL

      WHERE cc.tenant_id = $1
      ORDER BY
        checked DESC,
        cc.name ASC
      `,
      [tenantId, userId],
    );

    return sendResponse(res, 200, "User cost centers fetched successfully", {
      user_id: userId,
      cost_centers: result.rows,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateUserCostCentersHandler(
  req: AppRequest,
  res: Response,
  next: NextFunction,
) {
  const client = await pool.connect();

  try {
    const tenantId = getTenantId(req);
    const currentUserId = getCurrentUserId(req);
    const { userId } = userIdParamsSchema.parse(req.params);
    const body = updateUserCostCentersSchema.parse(req.body);

    const uniqueCostCenterIds = Array.from(new Set(body.cost_center_ids));

    await client.query("BEGIN");

    const userResult = await client.query(
      `
      SELECT 1
      FROM user_roles ur
      WHERE ur.tenant_id = $1
        AND ur.user_id = $2
      LIMIT 1
      `,
      [tenantId, userId],
    );

    if (!userResult.rowCount) {
      await client.query("ROLLBACK");
      return sendResponse(res, 404, "User not found in this tenant", null);
    }

    if (uniqueCostCenterIds.length > 0) {
      const validCostCentersResult = await client.query(
        `
  SELECT DISTINCT cc.id
  FROM cost_centers cc
  WHERE cc.tenant_id = $1
    AND cc.id = ANY($2::uuid[])
    AND cc.status = 'active'
  `,
        [tenantId, uniqueCostCenterIds],
      );

      if (validCostCentersResult.rowCount !== uniqueCostCenterIds.length) {
        await client.query("ROLLBACK");
        return sendResponse(
          res,
          400,
          "One or more cost centers are invalid for this tenant",
          null,
        );
      }
    }

    await client.query(
      `
      UPDATE user_cost_centers
      SET
        is_active = false,
        deleted_at = now(),
        updated_by = $4,
        updated_at = now()
      WHERE tenant_id = $1
        AND user_id = $2
        AND deleted_at IS NULL
        AND (
          cardinality($3::uuid[]) = 0
          OR cost_center_id <> ALL($3::uuid[])
        )
      `,
      [tenantId, userId, uniqueCostCenterIds, currentUserId],
    );

    if (uniqueCostCenterIds.length > 0) {
      await client.query(
        `
        INSERT INTO user_cost_centers (
          tenant_id,
          user_id,
          cost_center_id,
          is_active,
          created_by,
          updated_by,
          created_at,
          updated_at,
          deleted_at
        )
        SELECT
          $1::uuid,
          $2::uuid,
          input_cost_center_id,
          true,
          $4::uuid,
          $4::uuid,
          now(),
          now(),
          NULL
        FROM unnest($3::uuid[]) AS input_cost_center_id
        ON CONFLICT (tenant_id, user_id, cost_center_id)
        DO UPDATE SET
          is_active = true,
          deleted_at = NULL,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
        `,
        [tenantId, userId, uniqueCostCenterIds, currentUserId],
      );
    }

    const updatedResult = await client.query(
      `
      SELECT
        cc.id,
        cc.tenant_id,
        cc.tally_guid,
        cc.name,
        cc.parent_name,
        cc.description,
        cc.status,
        true AS checked,
        ucc.id AS assignment_id,
        ucc.created_at AS assigned_at,
        ucc.updated_at AS updated_at
      FROM user_cost_centers ucc
      INNER JOIN cost_centers cc
        ON cc.tenant_id = ucc.tenant_id
       AND cc.id = ucc.cost_center_id
      WHERE ucc.tenant_id = $1
        AND ucc.user_id = $2
        AND ucc.is_active = true
        AND ucc.deleted_at IS NULL
      ORDER BY cc.name ASC
      `,
      [tenantId, userId],
    );

    await client.query("COMMIT");

    return sendResponse(res, 200, "User cost centers updated successfully", {
      user_id: userId,
      selected_count: updatedResult.rowCount,
      cost_centers: updatedResult.rows,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
}

export async function getMyCostCentersHandler(
  req: AppRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const currentUserId = getCurrentUserId(req);

    const result = await pool.query(
      `
      SELECT DISTINCT
        cc.id,
        cc.tenant_id,
        cc.tally_guid,
        cc.name,
        cc.parent_name,
        cc.description,
        cc.status
      FROM user_cost_centers ucc
      INNER JOIN cost_centers cc
        ON cc.tenant_id = ucc.tenant_id
       AND cc.id = ucc.cost_center_id
      WHERE ucc.tenant_id = $1
        AND ucc.user_id = $2
        AND ucc.is_active = true
        AND ucc.deleted_at IS NULL
      ORDER BY cc.name ASC
      `,
      [tenantId, currentUserId],
    );

    return sendResponse(res, 200, "My cost centers fetched successfully", {
      items: result.rows,
    });
  } catch (error) {
    next(error);
  }
}
