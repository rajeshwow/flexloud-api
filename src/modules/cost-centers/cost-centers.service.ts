import { NextFunction, Response } from "express";
import { pool } from "../../db/pool";

export async function getCostCentersHandler(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = req.tenant?.id || req.tenantId;

    const { rows } = await pool.query(
      `
      SELECT
        id,
        name,
        parent_name,
        description,
        status,
        created_at,
        updated_at
      FROM cost_centers
      WHERE tenant_id = $1
        AND status = 'active'
      ORDER BY name ASC
      `,
      [tenantId],
    );

    res.json({
      statusCode: 200,
      message: "Cost centers fetched successfully",
      data: rows,
    });
  } catch (error) {
    next(error);
  }
}

export async function getCostCenterSummaryHandler(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = req.tenant?.id || req.tenantId;

    const { rows } = await pool.query(
      `
  WITH cost_center_orgs AS (
    SELECT DISTINCT
      cc.id AS cost_center_id,
      cc.tenant_id,
      o.id AS organization_id,
      o.name AS organization_name,
      o.type AS organization_type
    FROM cost_centers cc
    JOIN organizations o
      ON o.tenant_id = cc.tenant_id
     AND o.cost_center_id = cc.id
    WHERE cc.tenant_id = $1

    UNION

    SELECT DISTINCT
      occ.cost_center_id,
      occ.tenant_id,
      o.id AS organization_id,
      o.name AS organization_name,
      o.type AS organization_type
    FROM organization_cost_centers occ
    JOIN organizations o
      ON o.id = occ.organization_id
     AND o.tenant_id = occ.tenant_id
    WHERE occ.tenant_id = $1
  ),

  org_stats AS (
    SELECT
      cost_center_id,
      COUNT(DISTINCT organization_id) AS total_organizations,
      COUNT(DISTINCT CASE WHEN organization_type = 'customer' THEN organization_id END) AS total_customers,
      COUNT(DISTINCT CASE WHEN organization_type = 'vendor' THEN organization_id END) AS total_vendors
    FROM cost_center_orgs
    GROUP BY cost_center_id
  ),

  outstanding_stats AS (
    SELECT
      cco.cost_center_id,

      SUM(CASE
        WHEN tout.bill_type = 'receivable'
        THEN COALESCE(tout.pending_amount, 0)
        ELSE 0
      END) AS total_receivable,

      SUM(CASE
        WHEN tout.bill_type = 'payable'
        THEN COALESCE(tout.pending_amount, 0)
        ELSE 0
      END) AS total_payable,

      SUM(CASE
        WHEN tout.bill_type = 'receivable' THEN COALESCE(tout.pending_amount, 0)
        WHEN tout.bill_type = 'payable' THEN -COALESCE(tout.pending_amount, 0)
        ELSE 0
      END) AS net_outstanding,

      SUM(CASE
        WHEN tout.bill_type = 'receivable'
         AND COALESCE(tout.due_date, tout.voucher_date, now()::date) >= now()::date - interval '30 days'
        THEN COALESCE(tout.pending_amount, 0)
        ELSE 0
      END) AS aging_0_30,

      SUM(CASE
        WHEN tout.bill_type = 'receivable'
         AND COALESCE(tout.due_date, tout.voucher_date, now()::date) < now()::date - interval '30 days'
         AND COALESCE(tout.due_date, tout.voucher_date, now()::date) >= now()::date - interval '60 days'
        THEN COALESCE(tout.pending_amount, 0)
        ELSE 0
      END) AS aging_31_60,

      SUM(CASE
        WHEN tout.bill_type = 'receivable'
         AND COALESCE(tout.due_date, tout.voucher_date, now()::date) < now()::date - interval '60 days'
         AND COALESCE(tout.due_date, tout.voucher_date, now()::date) >= now()::date - interval '90 days'
        THEN COALESCE(tout.pending_amount, 0)
        ELSE 0
      END) AS aging_61_90,

      SUM(CASE
        WHEN tout.bill_type = 'receivable'
         AND COALESCE(tout.due_date, tout.voucher_date, now()::date) < now()::date - interval '90 days'
        THEN COALESCE(tout.pending_amount, 0)
        ELSE 0
      END) AS aging_90_plus

    FROM cost_center_orgs cco
    JOIN tally_outstandings tout
      ON tout.tenant_id = cco.tenant_id
     AND LOWER(TRIM(tout.ledger_name)) = LOWER(TRIM(cco.organization_name))
    GROUP BY cco.cost_center_id
  ),

  sales_stats AS (
  SELECT
    cco.cost_center_id,
    SUM(COALESCE(so.total_amount, 0)) AS total_sales_amount
  FROM cost_center_orgs cco
  JOIN sales_orders so
    ON so.tenant_id = cco.tenant_id
   AND (
     so.organization_id = cco.organization_id
     OR LOWER(TRIM(so.customer_name)) = LOWER(TRIM(cco.organization_name))
   )
  GROUP BY cco.cost_center_id
),

 purchase_stats AS (
  SELECT
    cco.cost_center_id,
    SUM(COALESCE(po.total_amount, 0)) AS total_purchase_amount
  FROM cost_center_orgs cco
  JOIN purchase_orders po
    ON po.tenant_id = cco.tenant_id
   AND LOWER(TRIM(po.supplier_name)) = LOWER(TRIM(cco.organization_name))
  GROUP BY cco.cost_center_id
)

  SELECT
    cc.id,
    cc.name,
    cc.parent_name,

    COALESCE(os.total_organizations, 0) AS total_organizations,
    COALESCE(os.total_customers, 0) AS total_customers,
    COALESCE(os.total_vendors, 0) AS total_vendors,

    COALESCE(ss.total_sales_amount, 0) AS total_sales_amount,
    COALESCE(ps.total_purchase_amount, 0) AS total_purchase_amount,
    COALESCE(ss.total_sales_amount, 0) - COALESCE(ps.total_purchase_amount, 0) AS total_work_value,

    COALESCE(outs.total_receivable, 0) AS total_receivable,
    COALESCE(outs.total_payable, 0) AS total_payable,
    COALESCE(outs.net_outstanding, 0) AS net_outstanding,

    COALESCE(outs.aging_0_30, 0) AS aging_0_30,
    COALESCE(outs.aging_31_60, 0) AS aging_31_60,
    COALESCE(outs.aging_61_90, 0) AS aging_61_90,
    COALESCE(outs.aging_90_plus, 0) AS aging_90_plus

  FROM cost_centers cc
  LEFT JOIN org_stats os ON os.cost_center_id = cc.id
  LEFT JOIN outstanding_stats outs ON outs.cost_center_id = cc.id
  LEFT JOIN sales_stats ss ON ss.cost_center_id = cc.id
  LEFT JOIN purchase_stats ps ON ps.cost_center_id = cc.id

  WHERE cc.tenant_id = $1
    AND cc.status = 'active'

  ORDER BY net_outstanding DESC, cc.name ASC
  `,
      [tenantId],
    );

    const totals = rows.reduce(
      (acc, row) => {
        acc.total_cost_centers += 1;
        acc.total_organizations += Number(row.total_organizations || 0);
        acc.total_sales_amount += Number(row.total_sales_amount || 0);
        acc.total_purchase_amount += Number(row.total_purchase_amount || 0);
        acc.total_work_value += Number(row.total_work_value || 0);
        acc.total_receivable += Number(row.total_receivable || 0);
        acc.total_payable += Number(row.total_payable || 0);
        acc.net_outstanding += Number(row.net_outstanding || 0);
        return acc;
      },
      {
        total_cost_centers: 0,
        total_organizations: 0,
        total_sales_amount: 0,
        total_purchase_amount: 0,
        total_work_value: 0,
        total_receivable: 0,
        total_payable: 0,
        net_outstanding: 0,
      },
    );

    res.json({
      statusCode: 200,
      message: "Cost center summary fetched successfully",
      data: {
        totals,
        rows,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getCostCenterOutstandingsHandler(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = req.tenant?.id || req.tenantId;
    const { id } = req.params;

    const { rows } = await pool.query(
      `
      SELECT
        tout.id,
        tout.ledger_name,
        tout.voucher_number,
        tout.voucher_type,
        tout.voucher_date,
        tout.due_date,
        tout.bill_ref,
        tout.bill_type,
        tout.bill_amount,
        tout.pending_amount,
        tout.cost_center_name,
        tout.synced_at
      FROM tally_outstandings tout
      WHERE tout.tenant_id = $1
        AND tout.cost_center_id = $2
      ORDER BY tout.pending_amount DESC, tout.voucher_date DESC NULLS LAST
      `,
      [tenantId, id],
    );

    res.json({
      statusCode: 200,
      message: "Cost center outstandings fetched successfully",
      data: rows,
    });
  } catch (error) {
    next(error);
  }
}

export async function getCostCenterOrganizationsHandler(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = req.tenant?.id || req.tenantId;
    const { id } = req.params;

    const { rows } = await pool.query(
      `
      WITH mapped_orgs AS (
        SELECT DISTINCT
          o.id,
          o.name,
          o.type,
          o.email,
          o.phone,
          o.gst_number,
          100::numeric AS allocation_percent
        FROM organizations o
        WHERE o.tenant_id = $1
          AND o.cost_center_id = $2

        UNION

        SELECT DISTINCT
          o.id,
          o.name,
          o.type,
          o.email,
          o.phone,
          o.gst_number,
          occ.allocation_percent
        FROM organization_cost_centers occ
        JOIN organizations o
          ON o.id = occ.organization_id
         AND o.tenant_id = occ.tenant_id
        WHERE occ.tenant_id = $1
          AND occ.cost_center_id = $2
      )
      SELECT *
      FROM mapped_orgs
      ORDER BY name ASC
      `,
      [tenantId, id],
    );

    res.json({
      statusCode: 200,
      message: "Cost center organizations fetched successfully",
      data: rows,
    });
  } catch (error) {
    next(error);
  }
}

function toSafeNumber(value: any) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function cleanLikeValue(value?: string) {
  return String(value || "").trim();
}

export async function getCostCenterPerformanceHandler(req: any, res: Response) {
  const tenantId = req.user?.tenant_id || req.tenant?.id;

  const {
    cost_center_id,
    ledger_name,
    min_amount,
    max_amount,
    start_date,
    end_date,
  } = req.query;

  const params: any[] = [tenantId];

  const filters: string[] = [
    `tenant_id = $1`,
    `COALESCE(cost_center_id::text, cost_center_name, '') <> ''`,
  ];

  if (cost_center_id) {
    params.push(cost_center_id);
    filters.push(`cost_center_id::text = $${params.length}`);
  }

  if (ledger_name) {
    params.push(`%${ledger_name}%`);
    filters.push(`ledger_name ILIKE $${params.length}`);
  }

  filters.push(...buildDateFilter({ start_date, end_date }, params));

  const havingFilters: string[] = [];

  if (min_amount) {
    params.push(Number(min_amount));
    havingFilters.push(`
      SUM(
        CASE 
          WHEN LOWER(COALESCE(bill_type, '')) = 'receivable'
          THEN ABS(COALESCE(cost_center_amount, pending_amount, bill_amount, 0))
          ELSE 0
        END
      ) >= $${params.length}
    `);
  }

  if (max_amount) {
    params.push(Number(max_amount));
    havingFilters.push(`
      SUM(
        CASE 
          WHEN LOWER(COALESCE(bill_type, '')) = 'receivable'
          THEN ABS(COALESCE(cost_center_amount, pending_amount, bill_amount, 0))
          ELSE 0
        END
      ) <= $${params.length}
    `);
  }

  const sql = `
    SELECT
      COALESCE(cost_center_id::text, cost_center_name) AS id,
      MAX(cost_center_id::text) AS cost_center_id,
      cost_center_name,

      COUNT(DISTINCT ledger_name) AS ledger_count,
      COUNT(*) AS bill_count,

      SUM(
        CASE 
          WHEN LOWER(COALESCE(bill_type, '')) = 'receivable'
          THEN ABS(COALESCE(cost_center_amount, pending_amount, bill_amount, 0))
          ELSE 0
        END
      ) AS total_business,

      SUM(
        CASE 
          WHEN LOWER(COALESCE(bill_type, '')) = 'payable'
          THEN ABS(COALESCE(cost_center_amount, pending_amount, bill_amount, 0))
          ELSE 0
        END
      ) AS total_purchase,

      SUM(ABS(COALESCE(cost_center_amount, pending_amount, bill_amount, 0))) AS total_activity,

      SUM(
        CASE 
          WHEN LOWER(COALESCE(bill_type, '')) = 'receivable'
          THEN ABS(COALESCE(pending_amount, 0))
          ELSE 0
        END
      ) AS receivable,

      SUM(
        CASE 
          WHEN LOWER(COALESCE(bill_type, '')) = 'payable'
          THEN ABS(COALESCE(pending_amount, 0))
          ELSE 0
        END
      ) AS payable,

      SUM(
        CASE 
          WHEN LOWER(COALESCE(bill_type, '')) = 'receivable'
          THEN ABS(COALESCE(cost_center_amount, pending_amount, bill_amount, 0))
          WHEN LOWER(COALESCE(bill_type, '')) = 'payable'
          THEN -ABS(COALESCE(cost_center_amount, pending_amount, bill_amount, 0))
          ELSE 0
        END
      ) AS net_business,

      MAX(synced_at) AS last_synced_at

    FROM tally_outstandings
    WHERE ${filters.join(" AND ")}
    GROUP BY COALESCE(cost_center_id::text, cost_center_name), cost_center_name
    ${havingFilters.length ? `HAVING ${havingFilters.join(" AND ")}` : ""}
    ORDER BY total_business DESC, cost_center_name ASC
  `;

  const { rows } = await pool.query(sql, params);

  return res.json({
    statusCode: 200,
    message: "Cost center performance fetched successfully",
    data: rows.map((row) => ({
      id: row.id,
      cost_center_id: row.cost_center_id,
      cost_center_name: row.cost_center_name,
      ledger_count: toNumber(row.ledger_count),
      bill_count: toNumber(row.bill_count),
      total_business: toNumber(row.total_business),
      total_purchase: toNumber(row.total_purchase),
      total_activity: toNumber(row.total_activity),
      receivable: toNumber(row.receivable),
      payable: toNumber(row.payable),
      net_business: toNumber(row.net_business),
      last_synced_at: row.last_synced_at,
    })),
  });
}

export async function getCostCenterPerformanceFiltersHandler(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = req.tenant?.id || req.tenantId;

    const [costCentersResult, ledgersResult] = await Promise.all([
      pool.query(
        `
        SELECT DISTINCT
          COALESCE(tout.cost_center_id, cc.id) AS id,
          COALESCE(NULLIF(TRIM(tout.cost_center_name), ''), cc.name) AS name
        FROM tally_outstandings tout
        LEFT JOIN cost_centers cc
          ON cc.tenant_id = tout.tenant_id
         AND (
            cc.id = tout.cost_center_id
            OR LOWER(TRIM(cc.name)) = LOWER(TRIM(tout.cost_center_name))
         )
        WHERE tout.tenant_id = $1
          AND COALESCE(NULLIF(TRIM(tout.cost_center_name), ''), cc.name) IS NOT NULL
        ORDER BY name ASC
        LIMIT 500
        `,
        [tenantId],
      ),

      pool.query(
        `
        SELECT DISTINCT ledger_name AS name
        FROM tally_outstandings
        WHERE tenant_id = $1
          AND COALESCE(NULLIF(TRIM(ledger_name), ''), '') <> ''
        ORDER BY ledger_name ASC
        LIMIT 500
        `,
        [tenantId],
      ),
    ]);

    res.json({
      statusCode: 200,
      message: "Cost center performance filters fetched successfully",
      data: {
        cost_centers: costCentersResult.rows,
        ledgers: ledgersResult.rows,
        bill_types: [
          { label: "Receivable", value: "receivable" },
          { label: "Payable", value: "payable" },
        ],
      },
    });
  } catch (error) {
    next(error);
  }
}

function toNumber(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function buildDateFilter(query: any, params: any[]) {
  const filters: string[] = [];

  if (query.start_date) {
    params.push(query.start_date);
    filters.push(`voucher_date >= $${params.length}`);
  }

  if (query.end_date) {
    params.push(query.end_date);
    filters.push(`voucher_date <= $${params.length}`);
  }

  return filters;
}

export async function getCostCenterPerformanceLedgersHandler(
  req: any,
  res: Response,
) {
  const tenantId = req.user?.tenant_id || req.tenant?.id;
  const { id } = req.params;

  const { start_date, end_date } = req.query;

  const params: any[] = [tenantId, id];

  const filters: string[] = [
    `tenant_id = $1`,
    `COALESCE(cost_center_id::text, cost_center_name) = $2`,
  ];

  filters.push(...buildDateFilter({ start_date, end_date }, params));

  const sql = `
    SELECT
      ledger_name,

      COUNT(*) AS bill_count,

      SUM(
        CASE 
          WHEN LOWER(COALESCE(bill_type, '')) = 'receivable'
          THEN ABS(COALESCE(cost_center_amount, pending_amount, bill_amount, 0))
          ELSE 0
        END
      ) AS total_business,

      SUM(
        CASE 
          WHEN LOWER(COALESCE(bill_type, '')) = 'payable'
          THEN ABS(COALESCE(cost_center_amount, pending_amount, bill_amount, 0))
          ELSE 0
        END
      ) AS total_purchase,

      SUM(
        CASE 
          WHEN LOWER(COALESCE(bill_type, '')) = 'receivable'
          THEN ABS(COALESCE(pending_amount, 0))
          ELSE 0
        END
      ) AS receivable,

      SUM(
        CASE 
          WHEN LOWER(COALESCE(bill_type, '')) = 'payable'
          THEN ABS(COALESCE(pending_amount, 0))
          ELSE 0
        END
      ) AS payable,

      SUM(
        CASE 
          WHEN LOWER(COALESCE(bill_type, '')) = 'receivable'
          THEN ABS(COALESCE(cost_center_amount, pending_amount, bill_amount, 0))
          WHEN LOWER(COALESCE(bill_type, '')) = 'payable'
          THEN -ABS(COALESCE(cost_center_amount, pending_amount, bill_amount, 0))
          ELSE 0
        END
      ) AS net_business

    FROM tally_outstandings
    WHERE ${filters.join(" AND ")}
    GROUP BY ledger_name
    ORDER BY total_business DESC, ledger_name ASC
  `;

  const { rows } = await pool.query(sql, params);

  return res.json({
    statusCode: 200,
    message: "Cost center ledger performance fetched successfully",
    data: rows.map((row) => ({
      ledger_name: row.ledger_name,
      bill_count: toNumber(row.bill_count),
      total_business: toNumber(row.total_business),
      total_purchase: toNumber(row.total_purchase),
      receivable: toNumber(row.receivable),
      payable: toNumber(row.payable),
      net_business: toNumber(row.net_business),
    })),
  });
}
