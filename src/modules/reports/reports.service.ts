import { Request, Response } from "express";
import { pool } from "../../db/pool";
import { TallyAnalyticsQuerySchema } from "./reports.schema";

type AnyReq = Request & {
  tenant?: {
    id?: string;
    slug?: string;
  };
  user?: {
    id?: string;
    tenant_id?: string;
  };
};

function sendSuccess(res: Response, message: string, data: unknown) {
  return res.status(200).json({
    statusCode: 200,
    message,
    data,
  });
}

function sendError(
  res: Response,
  error: unknown,
  fallback = "Something went wrong",
) {
  const message = error instanceof Error ? error.message : fallback;

  return res.status(500).json({
    statusCode: 500,
    message,
    data: null,
  });
}

function getTenantId(req: AnyReq) {
  return req.tenant?.id || req.user?.tenant_id;
}

function buildPagination(page: number, limit: number) {
  const safePage = Number(page || 1);
  const safeLimit = Number(limit || 50);
  return {
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
  };
}

function buildBaseFilters(params: {
  tenantId: string;
  from_date?: string;
  to_date?: string;
  category?: string;
  cost_center_guid?: string;
  cost_center_name?: string;
  party_id?: string;
}) {
  const values: unknown[] = [params.tenantId];
  const where: string[] = [
    `tv.tenant_id = $1`,
    `tv.deleted_at IS NULL`,
    `LOWER(COALESCE(tv.voucher_type, '')) IN ('sales', 'sales order', 'sales invoice')`,
  ];

  if (params.from_date) {
    values.push(params.from_date);
    where.push(`tv.voucher_date::date >= $${values.length}::date`);
  }

  if (params.to_date) {
    values.push(params.to_date);
    where.push(`tv.voucher_date::date <= $${values.length}::date`);
  }

  if (params.category) {
    values.push(`%${params.category.toLowerCase()}%`);
    where.push(
      `LOWER(COALESCE(tvi.product_category, tvi.category, '')) LIKE $${values.length}`,
    );
  }

  if (params.cost_center_guid) {
    values.push(params.cost_center_guid);
    where.push(`tv.cost_center_guid = $${values.length}`);
  }

  if (params.cost_center_name) {
    values.push(`%${params.cost_center_name.toLowerCase()}%`);
    where.push(
      `LOWER(COALESCE(tv.cost_center_name, '')) LIKE $${values.length}`,
    );
  }

  if (params.party_id) {
    values.push(params.party_id);
    where.push(`tv.organization_id = $${values.length}`);
  }

  return {
    where,
    values,
  };
}

/**
 * Report 1:
 * Category-wise month-wise Tally sales data for user.
 *
 * Assumption:
 * - Tally voucher has assigned_to OR cost_center_user_id.
 * - If both are missing, report still works by cost_center_name.
 */
export async function getUserCategoryMonthlySalesHandler(
  req: AnyReq,
  res: Response,
) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(400).json({
        statusCode: 400,
        message: "Tenant not resolved",
        data: null,
      });
    }

    const query = TallyAnalyticsQuerySchema.parse(req.query);
    const { limit, offset } = buildPagination(query.page, query.limit);

    const base = buildBaseFilters({
      tenantId,
      from_date: query.from_date,
      to_date: query.to_date,
      category: query.category,
      cost_center_guid: query.cost_center_guid,
      cost_center_name: query.cost_center_name,
      party_id: query.party_id,
    });

    if (query.user_id) {
      base.values.push(query.user_id);
      base.where.push(
        `COALESCE(tv.assigned_to, tv.cost_center_user_id) = $${base.values.length}`,
      );
    }

    base.values.push(limit);
    const limitIndex = base.values.length;

    base.values.push(offset);
    const offsetIndex = base.values.length;

    const sql = `
      SELECT
        COALESCE(tv.assigned_to, tv.cost_center_user_id) AS user_id,
        COALESCE(u.name, u.email, tv.cost_center_name, 'Unmapped') AS user_name,
        DATE_TRUNC('month', tv.voucher_date)::date AS month,
        COALESCE(tvi.product_category, tvi.category, 'Uncategorized') AS category,
        COUNT(DISTINCT tv.id) AS voucher_count,
        COALESCE(SUM(tvi.quantity), 0)::numeric AS total_qty,
        COALESCE(SUM(tvi.amount), 0)::numeric AS total_sales
      FROM tally_vouchers tv
      JOIN tally_voucher_items tvi
        ON tvi.tenant_id = tv.tenant_id
       AND tvi.voucher_id = tv.id
       AND tvi.deleted_at IS NULL
      LEFT JOIN users u
        ON u.tenant_id = tv.tenant_id
       AND u.id = COALESCE(tv.assigned_to, tv.cost_center_user_id)
      WHERE ${base.where.join(" AND ")}
      GROUP BY
        COALESCE(tv.assigned_to, tv.cost_center_user_id),
        COALESCE(u.name, u.email, tv.cost_center_name, 'Unmapped'),
        DATE_TRUNC('month', tv.voucher_date)::date,
        COALESCE(tvi.product_category, tvi.category, 'Uncategorized')
      ORDER BY month DESC, total_sales DESC
      LIMIT $${limitIndex}
      OFFSET $${offsetIndex};
    `;

    const result = await pool.query(sql, base.values);

    return sendSuccess(res, "User category monthly sales fetched", {
      rows: result.rows,
      page: query.page,
      limit: query.limit,
    });
  } catch (error) {
    return sendError(res, error, "Failed to fetch user category monthly sales");
  }
}

/**
 * Report 2:
 * Quarter-wise company sales data.
 */
export async function getCompanyQuarterlySalesHandler(
  req: AnyReq,
  res: Response,
) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(400).json({
        statusCode: 400,
        message: "Tenant not resolved",
        data: null,
      });
    }

    const query = TallyAnalyticsQuerySchema.parse(req.query);

    const base = buildBaseFilters({
      tenantId,
      from_date: query.from_date,
      to_date: query.to_date,
      category: query.category,
      cost_center_guid: query.cost_center_guid,
      cost_center_name: query.cost_center_name,
      party_id: query.party_id,
    });

    if (query.quarter) {
      base.values.push(Number(query.quarter));
      base.where.push(
        `EXTRACT(QUARTER FROM tv.voucher_date)::int = $${base.values.length}`,
      );
    }

    if (query.financial_year) {
      const year = Number(query.financial_year);
      if (!Number.isNaN(year)) {
        base.values.push(`${year}-04-01`);
        base.where.push(
          `tv.voucher_date::date >= $${base.values.length}::date`,
        );

        base.values.push(`${year + 1}-03-31`);
        base.where.push(
          `tv.voucher_date::date <= $${base.values.length}::date`,
        );
      }
    }

    const sql = `
  WITH sales_data AS (
    SELECT
      CASE
        WHEN EXTRACT(MONTH FROM tv.voucher_date)::int BETWEEN 4 AND 6 THEN 1
        WHEN EXTRACT(MONTH FROM tv.voucher_date)::int BETWEEN 7 AND 9 THEN 2
        WHEN EXTRACT(MONTH FROM tv.voucher_date)::int BETWEEN 10 AND 12 THEN 3
        ELSE 4
      END AS financial_quarter,

      CASE
        WHEN EXTRACT(MONTH FROM tv.voucher_date)::int >= 4
          THEN EXTRACT(YEAR FROM tv.voucher_date)::int
        ELSE EXTRACT(YEAR FROM tv.voucher_date)::int - 1
      END AS financial_year_start,

      COALESCE(tvi.product_category, tvi.category, 'Uncategorized') AS category,
      tv.id AS voucher_id,
      COALESCE(tvi.quantity, 0)::numeric AS quantity,
      COALESCE(tvi.amount, 0)::numeric AS amount

    FROM tally_vouchers tv
    JOIN tally_voucher_items tvi
      ON tvi.tenant_id = tv.tenant_id
     AND tvi.voucher_id = tv.id
     AND tvi.deleted_at IS NULL
    WHERE ${base.where.join(" AND ")}
  )
  SELECT
    financial_year_start AS year,
    financial_quarter AS quarter,
    CONCAT(
      'Q',
      financial_quarter,
      ' FY ',
      financial_year_start,
      '-',
      RIGHT((financial_year_start + 1)::text, 2)
    ) AS quarter_label,
    category,
    COUNT(DISTINCT voucher_id)::int AS voucher_count,
    COALESCE(SUM(quantity), 0)::numeric AS total_qty,
    COALESCE(SUM(amount), 0)::numeric AS total_sales
  FROM sales_data
  GROUP BY
    financial_year_start,
    financial_quarter,
    category
  ORDER BY
    financial_year_start DESC,
    financial_quarter ASC,
    total_sales DESC;
`;

    const result = await pool.query(sql, base.values);

    return sendSuccess(res, "Company quarterly sales fetched", {
      rows: result.rows,
    });
  } catch (error) {
    return sendError(res, error, "Failed to fetch company quarterly sales");
  }
}

/**
 * Report 3:
 * User target vs achieved sales.
 *
 * Note:
 * - target_amount users table se aa raha hai.
 * - Since target_amount user-level field hai, category-wise target separate nahi hai.
 * - Category-wise achieved sales show honge, target same user target rahega.
 */
export async function getUserCategoryTargetsHandler(
  req: AnyReq,
  res: Response,
) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(400).json({
        statusCode: 400,
        message: "Tenant not resolved",
        data: null,
      });
    }

    const query = TallyAnalyticsQuerySchema.parse(req.query);
    const values: unknown[] = [tenantId];

    const salesWhere: string[] = [
      `tv.tenant_id = $1`,
      `tv.deleted_at IS NULL`,
      `tvi.deleted_at IS NULL`,
      `LOWER(COALESCE(tv.voucher_type, '')) IN ('sales', 'sales order', 'sales invoice')`,
    ];

    const userWhere: string[] = [`u.tenant_id = $1`];

    if (query.from_date) {
      values.push(query.from_date);
      salesWhere.push(`tv.voucher_date::date >= $${values.length}::date`);
    }

    if (query.to_date) {
      values.push(query.to_date);
      salesWhere.push(`tv.voucher_date::date <= $${values.length}::date`);
    }

    if (query.user_id) {
      values.push(query.user_id);
      userWhere.push(`u.id = $${values.length}`);
      salesWhere.push(`ucc.user_id = $${values.length}`);
    }

    if (query.category) {
      values.push(`%${query.category.toLowerCase()}%`);
      salesWhere.push(
        `LOWER(COALESCE(tvi.product_category, tvi.category, '')) LIKE $${values.length}`,
      );
    }

    if (query.cost_center_name) {
      values.push(`%${query.cost_center_name.toLowerCase()}%`);
      salesWhere.push(
        `LOWER(COALESCE(cc.name, tv.cost_center_name, '')) LIKE $${values.length}`,
      );
    }

    const sql = `
      WITH mapped_users AS (
        SELECT
          u.id AS user_id,
          COALESCE(NULLIF(u.name, ''), NULLIF(u.email, ''), 'Unassigned') AS user_name,
          COALESCE(u.target_amount, 0)::numeric AS target_amount,
          COALESCE(
            STRING_AGG(DISTINCT NULLIF(cc.name, ''), ', '),
            'No Cost Center Mapped'
          ) AS mapped_cost_centers
        FROM users u
        LEFT JOIN user_cost_centers ucc
          ON ucc.tenant_id = u.tenant_id
         AND ucc.user_id = u.id
         AND ucc.deleted_at IS NULL
        LEFT JOIN cost_centers cc
          ON cc.tenant_id = u.tenant_id
         AND cc.id = ucc.cost_center_id
        WHERE ${userWhere.join(" AND ")}
        GROUP BY
          u.id,
          COALESCE(NULLIF(u.name, ''), NULLIF(u.email, ''), 'Unassigned'),
          COALESCE(u.target_amount, 0)
      ),

      achieved_data AS (
        SELECT
          ucc.user_id,
          COALESCE(tvi.product_category, tvi.category, 'Uncategorized') AS category,
          COUNT(DISTINCT tv.id)::int AS voucher_count,
          COALESCE(SUM(tvi.quantity), 0)::numeric AS total_qty,
          COALESCE(SUM(tvi.amount), 0)::numeric AS achieved_amount
        FROM tally_vouchers tv
        JOIN tally_voucher_items tvi
          ON tvi.tenant_id = tv.tenant_id
         AND tvi.voucher_id = tv.id
         AND tvi.deleted_at IS NULL

        LEFT JOIN cost_centers cc
          ON cc.tenant_id = tv.tenant_id
         AND (
              cc.id = tv.cost_center_id
              OR NULLIF(cc.tally_guid, '') = NULLIF(tv.cost_center_guid, '')
              OR LOWER(NULLIF(cc.name, '')) = LOWER(NULLIF(tv.cost_center_name, ''))
         )

        JOIN user_cost_centers ucc
          ON ucc.tenant_id = tv.tenant_id
         AND ucc.cost_center_id = cc.id
         AND ucc.deleted_at IS NULL

        WHERE ${salesWhere.join(" AND ")}
        GROUP BY
          ucc.user_id,
          COALESCE(tvi.product_category, tvi.category, 'Uncategorized')
      )

      SELECT
        mu.user_id,
        mu.user_name,
        mu.mapped_cost_centers,
        COALESCE(ad.category, 'All Categories') AS category,
        mu.target_amount,
        COALESCE(ad.achieved_amount, 0)::numeric AS achieved_amount,
        GREATEST(mu.target_amount - COALESCE(ad.achieved_amount, 0), 0)::numeric AS pending_amount,
        CASE
          WHEN mu.target_amount > 0
            THEN ROUND((COALESCE(ad.achieved_amount, 0) / mu.target_amount) * 100, 2)
          ELSE 0
        END AS achievement_percentage,
        COALESCE(ad.voucher_count, 0)::int AS voucher_count,
        COALESCE(ad.total_qty, 0)::numeric AS total_qty
      FROM mapped_users mu
      LEFT JOIN achieved_data ad
        ON ad.user_id = mu.user_id
      WHERE
        COALESCE(mu.target_amount, 0) > 0
        OR COALESCE(ad.achieved_amount, 0) > 0
      ORDER BY
        mu.user_name ASC,
        COALESCE(ad.category, 'All Categories') ASC;
    `;

    const result = await pool.query(sql, values);

    return sendSuccess(res, "User category targets fetched", {
      rows: result.rows,
    });
  } catch (error) {
    return sendError(res, error, "Failed to fetch user category targets");
  }
}

/**
 * Report 4:
 * Party-wise category-wise sales.
 */
export async function getPartyCategorySalesHandler(req: AnyReq, res: Response) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(400).json({
        statusCode: 400,
        message: "Tenant not resolved",
        data: null,
      });
    }

    const query = TallyAnalyticsQuerySchema.parse(req.query);
    const { limit, offset } = buildPagination(query.page, query.limit);

    const base = buildBaseFilters({
      tenantId,
      from_date: query.from_date,
      to_date: query.to_date,
      category: query.category,
      cost_center_guid: query.cost_center_guid,
      cost_center_name: query.cost_center_name,
      party_id: query.party_id,
    });

    base.values.push(limit);
    const limitIndex = base.values.length;

    base.values.push(offset);
    const offsetIndex = base.values.length;

    const sql = `
      SELECT
        tv.organization_id AS party_id,
        COALESCE(o.name, tv.party_name, tv.ledger_name, 'Unknown Party') AS party_name,
        COALESCE(tvi.product_category, tvi.category, 'Uncategorized') AS category,
        COUNT(DISTINCT tv.id) AS voucher_count,
        COALESCE(SUM(tvi.quantity), 0)::numeric AS total_qty,
        COALESCE(SUM(tvi.amount), 0)::numeric AS total_sales
      FROM tally_vouchers tv
      JOIN tally_voucher_items tvi
        ON tvi.tenant_id = tv.tenant_id
       AND tvi.voucher_id = tv.id
       AND tvi.deleted_at IS NULL
      LEFT JOIN organizations o
        ON o.tenant_id = tv.tenant_id
       AND o.id = tv.organization_id
       AND o.deleted_at IS NULL
      WHERE ${base.where.join(" AND ")}
      GROUP BY
        tv.organization_id,
        COALESCE(o.name, tv.party_name, tv.ledger_name, 'Unknown Party'),
        COALESCE(tvi.product_category, tvi.category, 'Uncategorized')
      ORDER BY total_sales DESC
      LIMIT $${limitIndex}
      OFFSET $${offsetIndex};
    `;

    const result = await pool.query(sql, base.values);

    return sendSuccess(res, "Party category sales fetched", {
      rows: result.rows,
      page: query.page,
      limit: query.limit,
    });
  } catch (error) {
    return sendError(res, error, "Failed to fetch party category sales");
  }
}

/**
 * Report 5:
 * Cost center category-wise sales.
 */
export async function getCostCenterCategorySalesHandler(
  req: AnyReq,
  res: Response,
) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(400).json({
        statusCode: 400,
        message: "Tenant not resolved",
        data: null,
      });
    }

    const query = TallyAnalyticsQuerySchema.parse(req.query);
    const { limit, offset } = buildPagination(query.page, query.limit);

    const base = buildBaseFilters({
      tenantId,
      from_date: query.from_date,
      to_date: query.to_date,
      category: query.category,
      cost_center_guid: query.cost_center_guid,
      cost_center_name: query.cost_center_name,
      party_id: query.party_id,
    });

    base.values.push(limit);
    const limitIndex = base.values.length;

    base.values.push(offset);
    const offsetIndex = base.values.length;

    const sql = `
      SELECT
  cc.id AS cost_center_id,
  cc.tally_guid AS cost_center_guid,

  COALESCE(
    NULLIF(cc.name, ''),
    NULLIF(tv.cost_center_name, ''),
    'Unmapped Cost Center'
  ) AS cost_center_name,

  COALESCE(
    NULLIF(u.name, ''),
    NULLIF(u.email, ''),
    'Unmapped User'
  ) AS mapped_user_name,

  COALESCE(tvi.product_category, tvi.category, 'Uncategorized') AS category,
  COUNT(DISTINCT tv.id) AS voucher_count,
  COALESCE(SUM(tvi.quantity), 0)::numeric AS total_qty,
  COALESCE(SUM(tvi.amount), 0)::numeric AS total_sales

FROM tally_vouchers tv

JOIN tally_voucher_items tvi
  ON tvi.tenant_id = tv.tenant_id
 AND tvi.voucher_id = tv.id
 AND tvi.deleted_at IS NULL

LEFT JOIN cost_centers cc
  ON cc.tenant_id = tv.tenant_id
 AND (
      cc.id = tv.cost_center_id
      OR NULLIF(cc.tally_guid, '') = NULLIF(tv.cost_center_guid, '')
      OR LOWER(NULLIF(cc.name, '')) = LOWER(NULLIF(tv.cost_center_name, ''))
 )

LEFT JOIN user_cost_centers ucc
  ON ucc.tenant_id = tv.tenant_id
 AND ucc.cost_center_id = cc.id
 AND ucc.deleted_at IS NULL

LEFT JOIN users u
  ON u.tenant_id = tv.tenant_id
 AND u.id = ucc.user_id

WHERE ${base.where.join(" AND ")}

GROUP BY
  cc.id,
  cc.tally_guid,
  COALESCE(
    NULLIF(cc.name, ''),
    NULLIF(tv.cost_center_name, ''),
    'Unmapped Cost Center'
  ),
  COALESCE(
    NULLIF(u.name, ''),
    NULLIF(u.email, ''),
    'Unmapped User'
  ),
  COALESCE(tvi.product_category, tvi.category, 'Uncategorized')

ORDER BY total_sales DESC
LIMIT $${limitIndex}
OFFSET $${offsetIndex};
    `;

    const result = await pool.query(sql, base.values);

    return sendSuccess(res, "Cost center category sales fetched", {
      rows: result.rows,
      page: query.page,
      limit: query.limit,
    });
  } catch (error) {
    return sendError(res, error, "Failed to fetch cost center category sales");
  }
}
