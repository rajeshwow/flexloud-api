import { NextFunction, Request, Response } from "express";
import { pool } from "../../db/pool";
import {
  companyIdParamsSchema,
  getTallyCompaniesQuerySchema,
  updateCostCenterAccessSchema,
} from "./tally-companies.schema";

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

function getUserId(req: AppRequest): string {
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

export async function getTallyCompaniesHandler(
  req: AppRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const query = getTallyCompaniesQuerySchema.parse(req.query);

    const offset = (query.page - 1) * query.limit;

    const conditions: string[] = ["tc.tenant_id = $1", "tc.deleted_at IS NULL"];
    const values: unknown[] = [tenantId];

    if (query.search) {
      values.push(`%${query.search}%`);
      conditions.push(`tc.name ILIKE $${values.length}`);
    }

    if (typeof query.is_active === "boolean") {
      values.push(query.is_active);
      conditions.push(`tc.is_active = $${values.length}`);
    }

    values.push(query.limit);
    const limitIndex = values.length;

    values.push(offset);
    const offsetIndex = values.length;

    const whereClause = conditions.join(" AND ");

    const [listResult, countResult] = await Promise.all([
      pool.query(
        `
        SELECT
          tc.id,
          tc.tenant_id,
          tc.tally_guid,
          tc.name,
          tc.formal_name,
          tc.country,
          tc.state,
          tc.books_from,
          tc.starting_from,
          tc.is_active,
          tc.created_at,
          tc.updated_at,

          COALESCE(cc_map.cost_center_count, 0)::int AS cost_center_count,
          COALESCE(ledger_map.ledger_count, 0)::int AS ledger_count,
          COALESCE(outstanding_map.outstanding_count, 0)::int AS outstanding_count,
          COALESCE(so_map.sales_order_count, 0)::int AS sales_order_count,
          COALESCE(po_map.purchase_order_count, 0)::int AS purchase_order_count

        FROM tally_companies tc

        LEFT JOIN (
          SELECT tenant_id, tally_company_id, COUNT(*) AS cost_center_count
          FROM tally_company_cost_center_access
          WHERE deleted_at IS NULL
            AND is_active = true
          GROUP BY tenant_id, tally_company_id
        ) cc_map
          ON cc_map.tenant_id = tc.tenant_id
         AND cc_map.tally_company_id = tc.id

        LEFT JOIN (
          SELECT tenant_id, tally_company_id, COUNT(*) AS ledger_count
          FROM tally_ledgers
          WHERE tally_company_id IS NOT NULL
          GROUP BY tenant_id, tally_company_id
        ) ledger_map
          ON ledger_map.tenant_id = tc.tenant_id
         AND ledger_map.tally_company_id = tc.id

        LEFT JOIN (
          SELECT tenant_id, tally_company_id, COUNT(*) AS outstanding_count
          FROM tally_outstandings
          WHERE tally_company_id IS NOT NULL
          GROUP BY tenant_id, tally_company_id
        ) outstanding_map
          ON outstanding_map.tenant_id = tc.tenant_id
         AND outstanding_map.tally_company_id = tc.id

        LEFT JOIN (
          SELECT tenant_id, tally_company_id, COUNT(*) AS sales_order_count
          FROM sales_orders
          WHERE tally_company_id IS NOT NULL
            AND deleted_at IS NULL
          GROUP BY tenant_id, tally_company_id
        ) so_map
          ON so_map.tenant_id = tc.tenant_id
         AND so_map.tally_company_id = tc.id

        LEFT JOIN (
          SELECT tenant_id, tally_company_id, COUNT(*) AS purchase_order_count
          FROM purchase_orders
          WHERE tally_company_id IS NOT NULL
            AND deleted_at IS NULL
          GROUP BY tenant_id, tally_company_id
        ) po_map
          ON po_map.tenant_id = tc.tenant_id
         AND po_map.tally_company_id = tc.id

        WHERE ${whereClause}
        ORDER BY tc.created_at DESC
        LIMIT $${limitIndex}
        OFFSET $${offsetIndex}
        `,
        values,
      ),
      pool.query(
        `
        SELECT COUNT(*)::int AS total
        FROM tally_companies tc
        WHERE ${whereClause}
        `,
        values.slice(0, values.length - 2),
      ),
    ]);

    return sendResponse(res, 200, "Tally companies fetched successfully", {
      items: listResult.rows,
      pagination: {
        page: query.page,
        limit: query.limit,
        total: countResult.rows[0]?.total || 0,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getAccessibleTallyCompaniesHandler(
  req: AppRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = getUserId(req);

    const result = await pool.query(
      `
      SELECT DISTINCT
        tc.id,
        tc.tenant_id,
        tc.tally_guid,
        tc.name,
        tc.formal_name,
        tc.country,
        tc.state,
        tc.is_active
      FROM tally_companies tc
      INNER JOIN tally_company_cost_center_access cca
        ON cca.tenant_id = tc.tenant_id
       AND cca.tally_company_id = tc.id
       AND cca.is_active = true
       AND cca.deleted_at IS NULL
      INNER JOIN user_cost_centers ucc
        ON ucc.tenant_id = cca.tenant_id
       AND ucc.cost_center_id = cca.cost_center_id
       AND ucc.user_id = $2
       AND ucc.is_active = true
       AND ucc.deleted_at IS NULL
      WHERE tc.tenant_id = $1
        AND tc.deleted_at IS NULL
        AND tc.is_active = true
      ORDER BY tc.name ASC
      `,
      [tenantId, userId],
    );

    return sendResponse(
      res,
      200,
      "Accessible Tally companies fetched successfully",
      {
        items: result.rows,
      },
    );
  } catch (error) {
    next(error);
  }
}

export async function getCompanyCostCenterAccessHandler(
  req: AppRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const { id } = companyIdParamsSchema.parse(req.params);

    const companyResult = await pool.query(
      `
      SELECT id, name, tally_guid, is_active
      FROM tally_companies
      WHERE tenant_id = $1
        AND id = $2
        AND deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, id],
    );

    if (!companyResult.rowCount) {
      return sendResponse(res, 404, "Tally company not found", null);
    }

    const costCentersResult = await pool.query(
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
          WHEN access.id IS NOT NULL
           AND access.is_active = true
           AND access.deleted_at IS NULL
          THEN true
          ELSE false
        END AS checked,

        access.id AS access_id,
        access.created_at AS access_created_at,
        access.updated_at AS access_updated_at

      FROM cost_centers cc
      LEFT JOIN tally_company_cost_center_access access
        ON access.tenant_id = cc.tenant_id
       AND access.cost_center_id = cc.id
       AND access.tally_company_id = $2
       AND access.deleted_at IS NULL
      WHERE cc.tenant_id = $1
      ORDER BY
        checked DESC,
        cc.name ASC
      `,
      [tenantId, id],
    );

    return sendResponse(
      res,
      200,
      "Tally company cost center access fetched successfully",
      {
        company: companyResult.rows[0],
        cost_centers: costCentersResult.rows,
      },
    );
  } catch (error) {
    next(error);
  }
}

export async function updateCompanyCostCenterAccessHandler(
  req: AppRequest,
  res: Response,
  next: NextFunction,
) {
  const client = await pool.connect();

  try {
    const tenantId = getTenantId(req);
    const userId = getUserId(req);
    const { id } = companyIdParamsSchema.parse(req.params);
    const body = updateCostCenterAccessSchema.parse(req.body);

    await client.query("BEGIN");

    const companyResult = await client.query(
      `
      SELECT id
      FROM tally_companies
      WHERE tenant_id = $1
        AND id = $2
        AND deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, id],
    );

    if (!companyResult.rowCount) {
      await client.query("ROLLBACK");
      return sendResponse(res, 404, "Tally company not found", null);
    }

    const uniqueCostCenterIds = Array.from(new Set(body.cost_center_ids));

    if (uniqueCostCenterIds.length > 0) {
      const validCostCentersResult = await client.query(
        `
        SELECT id
        FROM cost_centers
        WHERE tenant_id = $1
          AND id = ANY($2::uuid[])
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
      UPDATE tally_company_cost_center_access
      SET
        is_active = false,
        deleted_at = now(),
        updated_by = $3,
        updated_at = now()
      WHERE tenant_id = $1
        AND tally_company_id = $2
        AND deleted_at IS NULL
      `,
      [tenantId, id, userId],
    );

    if (uniqueCostCenterIds.length > 0) {
      await client.query(
        `
        INSERT INTO tally_company_cost_center_access (
          tenant_id,
          tally_company_id,
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
        ON CONFLICT (tenant_id, tally_company_id, cost_center_id)
        DO UPDATE SET
          is_active = true,
          deleted_at = NULL,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
        `,
        [tenantId, id, uniqueCostCenterIds, userId],
      );
    }

    const updatedResult = await client.query(
      `
      SELECT
        cc.id,
        cc.name,
        cc.parent_name,
        cc.status,
        true AS checked
      FROM tally_company_cost_center_access access
      INNER JOIN cost_centers cc
        ON cc.tenant_id = access.tenant_id
       AND cc.id = access.cost_center_id
      WHERE access.tenant_id = $1
        AND access.tally_company_id = $2
        AND access.is_active = true
        AND access.deleted_at IS NULL
      ORDER BY cc.name ASC
      `,
      [tenantId, id],
    );

    await client.query("COMMIT");

    return sendResponse(
      res,
      200,
      "Tally company cost center access updated successfully",
      {
        tally_company_id: id,
        selected_count: updatedResult.rowCount,
        cost_centers: updatedResult.rows,
      },
    );
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
}

export async function getAccessibleCostCentersForCompanyHandler(
  req: AppRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = getUserId(req);
    const { id } = companyIdParamsSchema.parse(req.params);

    const companyResult = await pool.query(
      `
      SELECT id
      FROM tally_companies
      WHERE tenant_id = $1
        AND id = $2
        AND is_active = true
        AND deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId, id],
    );

    if (!companyResult.rowCount) {
      return sendResponse(res, 404, "Tally company not found", null);
    }

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
      FROM cost_centers cc
      INNER JOIN tally_company_cost_center_access cca
        ON cca.tenant_id = cc.tenant_id
       AND cca.cost_center_id = cc.id
       AND cca.tally_company_id = $2
       AND cca.is_active = true
       AND cca.deleted_at IS NULL
      INNER JOIN user_cost_centers ucc
        ON ucc.tenant_id = cc.tenant_id
       AND ucc.cost_center_id = cc.id
       AND ucc.user_id = $3
       AND ucc.is_active = true
       AND ucc.deleted_at IS NULL
      WHERE cc.tenant_id = $1
      ORDER BY cc.name ASC
      `,
      [tenantId, id, userId],
    );

    return sendResponse(
      res,
      200,
      "Accessible cost centers fetched successfully",
      {
        items: result.rows,
      },
    );
  } catch (error) {
    next(error);
  }
}
