import { NextFunction, Response } from "express";
import { pool } from "../../db/pool";

import {
  addCostCenterMasterAccessFilter,
  addTallyRecordAccessFilter,
  getTenantIdFromRequest,
  getUserIdFromRequest,
} from "../../common/tallyAccess";

export async function getCostCentersHandler(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantIdFromRequest(req);
    const userId = getUserIdFromRequest(req);

    const tallyCompanyId = req.query.tally_company_id
      ? String(req.query.tally_company_id)
      : "";

    const values: any[] = [tenantId];

    const where: string[] = ["cc.tenant_id = $1", "cc.status = 'active'"];

    addCostCenterMasterAccessFilter({
      where,
      values,
      tenantAlias: "cc",
      costCenterAlias: "cc",
      userId,
      tallyCompanyId: tallyCompanyId || null,
    });

    const { rows } = await pool.query(
      `
      SELECT
        cc.id,
        cc.name,
        cc.parent_name,
        cc.description,
        cc.status,
        cc.created_at,
        cc.updated_at
      FROM cost_centers cc
      WHERE ${where.join(" AND ")}
      ORDER BY cc.name ASC
      `,
      values,
    );

    return res.json({
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
    const tenantId = getTenantIdFromRequest(req);
    const userId = getUserIdFromRequest(req);

    const tallyCompanyId = req.query.tally_company_id
      ? String(req.query.tally_company_id)
      : "";

    const params: any[] = [tenantId, userId];
    const companyFilter = tallyCompanyId
      ? "AND cca.tally_company_id = $3::uuid"
      : "";

    if (tallyCompanyId) {
      params.push(tallyCompanyId);
    }

    const { rows } = await pool.query(
      `
      WITH accessible_cost_centers AS (
        SELECT DISTINCT
          cc.id,
          cc.tenant_id,
          cc.name,
          cc.parent_name
        FROM cost_centers cc
        INNER JOIN user_cost_centers ucc
          ON ucc.tenant_id = cc.tenant_id
         AND ucc.cost_center_id = cc.id
         AND ucc.user_id = $2::uuid
         AND ucc.is_active = true
         AND ucc.deleted_at IS NULL
        INNER JOIN tally_company_cost_center_access cca
          ON cca.tenant_id = cc.tenant_id
         AND cca.cost_center_id = cc.id
         AND cca.is_active = true
         AND cca.deleted_at IS NULL
         ${companyFilter}
        WHERE cc.tenant_id = $1
          AND cc.status = 'active'
      ),

      org_stats AS (
        SELECT
          acc.id AS cost_center_id,
          COUNT(DISTINCT o.id) AS total_organizations,
          COUNT(DISTINCT CASE WHEN o.type = 'customer' THEN o.id END) AS total_customers,
          COUNT(DISTINCT CASE WHEN o.type = 'vendor' THEN o.id END) AS total_vendors
        FROM accessible_cost_centers acc
        LEFT JOIN organizations o
          ON o.tenant_id = acc.tenant_id
         AND o.cost_center_id = acc.id
         AND o.deleted_at IS NULL
        GROUP BY acc.id
      ),

      outstanding_stats AS (
        SELECT
          acc.id AS cost_center_id,

          SUM(CASE
            WHEN LOWER(COALESCE(tout.bill_type, '')) = 'receivable'
            THEN ABS(COALESCE(tout.pending_amount, 0))
            ELSE 0
          END) AS total_receivable,

          SUM(CASE
            WHEN LOWER(COALESCE(tout.bill_type, '')) = 'payable'
            THEN ABS(COALESCE(tout.pending_amount, 0))
            ELSE 0
          END) AS total_payable,

          SUM(CASE
            WHEN LOWER(COALESCE(tout.bill_type, '')) = 'receivable'
            THEN ABS(COALESCE(tout.pending_amount, 0))
            WHEN LOWER(COALESCE(tout.bill_type, '')) = 'payable'
            THEN -ABS(COALESCE(tout.pending_amount, 0))
            ELSE 0
          END) AS net_outstanding,

          SUM(CASE
            WHEN LOWER(COALESCE(tout.bill_type, '')) = 'receivable'
             AND COALESCE(tout.due_date, tout.voucher_date, now()::date) >= now()::date - interval '30 days'
            THEN ABS(COALESCE(tout.pending_amount, 0))
            ELSE 0
          END) AS aging_0_30,

          SUM(CASE
            WHEN LOWER(COALESCE(tout.bill_type, '')) = 'receivable'
             AND COALESCE(tout.due_date, tout.voucher_date, now()::date) < now()::date - interval '30 days'
             AND COALESCE(tout.due_date, tout.voucher_date, now()::date) >= now()::date - interval '60 days'
            THEN ABS(COALESCE(tout.pending_amount, 0))
            ELSE 0
          END) AS aging_31_60,

          SUM(CASE
            WHEN LOWER(COALESCE(tout.bill_type, '')) = 'receivable'
             AND COALESCE(tout.due_date, tout.voucher_date, now()::date) < now()::date - interval '60 days'
             AND COALESCE(tout.due_date, tout.voucher_date, now()::date) >= now()::date - interval '90 days'
            THEN ABS(COALESCE(tout.pending_amount, 0))
            ELSE 0
          END) AS aging_61_90,

          SUM(CASE
            WHEN LOWER(COALESCE(tout.bill_type, '')) = 'receivable'
             AND COALESCE(tout.due_date, tout.voucher_date, now()::date) < now()::date - interval '90 days'
            THEN ABS(COALESCE(tout.pending_amount, 0))
            ELSE 0
          END) AS aging_90_plus

        FROM accessible_cost_centers acc
        LEFT JOIN tally_outstandings tout
          ON tout.tenant_id = acc.tenant_id
         AND tout.cost_center_id = acc.id
         AND tout.tally_company_id IS NOT NULL
         ${tallyCompanyId ? "AND tout.tally_company_id = $3::uuid" : ""}
        GROUP BY acc.id
      ),

      sales_stats AS (
        SELECT
          acc.id AS cost_center_id,
          SUM(COALESCE(so.total_amount, 0)) AS total_sales_amount
        FROM accessible_cost_centers acc
        LEFT JOIN sales_orders so
          ON so.tenant_id = acc.tenant_id
         AND so.cost_center_id = acc.id
         AND so.deleted_at IS NULL
         ${tallyCompanyId ? "AND so.tally_company_id = $3::uuid" : ""}
        GROUP BY acc.id
      ),

      purchase_stats AS (
        SELECT
          acc.id AS cost_center_id,
          SUM(COALESCE(po.total_amount, 0)) AS total_purchase_amount
        FROM accessible_cost_centers acc
        LEFT JOIN purchase_orders po
          ON po.tenant_id = acc.tenant_id
         AND po.cost_center_id = acc.id
         AND po.deleted_at IS NULL
         ${tallyCompanyId ? "AND po.tally_company_id = $3::uuid" : ""}
        GROUP BY acc.id
      )

      SELECT
        acc.id,
        acc.name,
        acc.parent_name,

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

      FROM accessible_cost_centers acc
      LEFT JOIN org_stats os ON os.cost_center_id = acc.id
      LEFT JOIN outstanding_stats outs ON outs.cost_center_id = acc.id
      LEFT JOIN sales_stats ss ON ss.cost_center_id = acc.id
      LEFT JOIN purchase_stats ps ON ps.cost_center_id = acc.id
      ORDER BY net_outstanding DESC, acc.name ASC
      `,
      params,
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

    return res.json({
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
    const tenantId = getTenantIdFromRequest(req);
    const userId = getUserIdFromRequest(req);

    const { id } = req.params;

    const tallyCompanyId = req.query.tally_company_id
      ? String(req.query.tally_company_id)
      : "";

    const values: any[] = [tenantId, id];

    const where: string[] = [
      "tout.tenant_id = $1",
      "tout.cost_center_id = $2::uuid",
    ];

    addTallyRecordAccessFilter({
      where,
      values,
      userId,
      recordAlias: "tout",
      costCenterExpression: "tout.cost_center_id",
      tallyCompanyId: tallyCompanyId || null,
    });

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
        tout.tally_company_id,
        tout.tally_company_name,
        tout.synced_at
      FROM tally_outstandings tout
      WHERE ${where.join(" AND ")}
      ORDER BY tout.pending_amount DESC, tout.voucher_date DESC NULLS LAST
      `,
      values,
    );

    return res.json({
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
    const tenantId = getTenantIdFromRequest(req);
    const userId = getUserIdFromRequest(req);
    const { id } = req.params;

    const tallyCompanyId = req.query.tally_company_id
      ? String(req.query.tally_company_id)
      : "";

    const params: any[] = [tenantId, id, userId];

    if (tallyCompanyId) {
      params.push(tallyCompanyId);
    }

    const { rows } = await pool.query(
      `
      WITH accessible_cost_center AS (
        SELECT cc.id, cc.tenant_id
        FROM cost_centers cc
        INNER JOIN user_cost_centers ucc
          ON ucc.tenant_id = cc.tenant_id
         AND ucc.cost_center_id = cc.id
         AND ucc.user_id = $3::uuid
         AND ucc.is_active = true
         AND ucc.deleted_at IS NULL
        INNER JOIN tally_company_cost_center_access cca
          ON cca.tenant_id = cc.tenant_id
         AND cca.cost_center_id = cc.id
         AND cca.is_active = true
         AND cca.deleted_at IS NULL
         ${tallyCompanyId ? "AND cca.tally_company_id = $4::uuid" : ""}
        WHERE cc.tenant_id = $1
          AND cc.id = $2::uuid
      ),

      mapped_orgs AS (
        SELECT DISTINCT
          o.id,
          o.name,
          o.type,
          o.email,
          o.gst_number,
          100::numeric AS allocation_percent
        FROM accessible_cost_center acc
        INNER JOIN organizations o
          ON o.tenant_id = acc.tenant_id
         AND o.cost_center_id = acc.id
         AND o.deleted_at IS NULL

        UNION

        SELECT DISTINCT
          o.id,
          o.name,
          o.type,
          o.email,
          o.gst_number,
          occ.allocation_percent
        FROM accessible_cost_center acc
        INNER JOIN organization_cost_centers occ
          ON occ.tenant_id = acc.tenant_id
         AND occ.cost_center_id = acc.id
        INNER JOIN organizations o
          ON o.id = occ.organization_id
         AND o.tenant_id = occ.tenant_id
         AND o.deleted_at IS NULL
      )

      SELECT *
      FROM mapped_orgs
      ORDER BY name ASC
      `,
      params,
    );

    return res.json({
      statusCode: 200,
      message: "Cost center organizations fetched successfully",
      data: rows,
    });
  } catch (error) {
    next(error);
  }
}

function cleanLikeValue(value?: string) {
  return String(value || "").trim();
}

export async function getCostCenterPerformanceHandler(req: any, res: Response) {
  try {
    const tenantId = getTenantIdFromRequest(req);
    const userId = getUserIdFromRequest(req);

    const {
      tally_company_id,
      cost_center_id,
      ledger_name,
      min_amount,
      max_amount,
      start_date,
      end_date,
      from_date,
      to_date,
    } = req.query;
    const effectiveStartDate = start_date || from_date;
    const effectiveEndDate = end_date || to_date;

    const params: any[] = [tenantId];

    const filters: string[] = [
      `tout.tenant_id = $1`,
      `COALESCE(tout.cost_center_id::text, tout.cost_center_name, '') <> ''`,
    ];

    if (cost_center_id) {
      params.push(cost_center_id);
      filters.push(`tout.cost_center_id::text = $${params.length}`);
    }

    if (ledger_name) {
      params.push(`%${cleanLikeValue(String(ledger_name))}%`);
      filters.push(`tout.ledger_name ILIKE $${params.length}`);
    }

    filters.push(
      ...buildDateFilter(
        { start_date: effectiveStartDate, end_date: effectiveEndDate },
        params,
        "tout",
      ),
    );

    addTallyRecordAccessFilter({
      where: filters,
      values: params,
      userId,
      recordAlias: "tout",
      costCenterExpression: "tout.cost_center_id",
      tallyCompanyId: tally_company_id ? String(tally_company_id) : null,
    });

    const havingFilters: string[] = [];

    if (min_amount) {
      params.push(Number(min_amount));
      havingFilters.push(`
        SUM(
          CASE 
            WHEN LOWER(COALESCE(tout.bill_type, '')) = 'receivable'
            THEN ABS(COALESCE(tout.cost_center_amount, tout.pending_amount, tout.bill_amount, 0))
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
            WHEN LOWER(COALESCE(tout.bill_type, '')) = 'receivable'
            THEN ABS(COALESCE(tout.cost_center_amount, tout.pending_amount, tout.bill_amount, 0))
            ELSE 0
          END
        ) <= $${params.length}
      `);
    }

    const sql = `
      SELECT
        COALESCE(tout.cost_center_id::text, tout.cost_center_name) AS id,
        MAX(tout.cost_center_id::text) AS cost_center_id,
        tout.cost_center_name,

        COUNT(DISTINCT tout.ledger_name) AS ledger_count,
        COUNT(*) AS bill_count,

        SUM(
          CASE 
            WHEN LOWER(COALESCE(tout.bill_type, '')) = 'receivable'
            THEN ABS(COALESCE(tout.cost_center_amount, tout.pending_amount, tout.bill_amount, 0))
            ELSE 0
          END
        ) AS total_business,

        SUM(
          CASE 
            WHEN LOWER(COALESCE(tout.bill_type, '')) = 'payable'
            THEN ABS(COALESCE(tout.cost_center_amount, tout.pending_amount, tout.bill_amount, 0))
            ELSE 0
          END
        ) AS total_purchase,

        SUM(ABS(COALESCE(tout.cost_center_amount, tout.pending_amount, tout.bill_amount, 0))) AS total_activity,

        SUM(
          CASE 
            WHEN LOWER(COALESCE(tout.bill_type, '')) = 'receivable'
            THEN ABS(COALESCE(tout.pending_amount, 0))
            ELSE 0
          END
        ) AS receivable,

        SUM(
          CASE 
            WHEN LOWER(COALESCE(tout.bill_type, '')) = 'payable'
            THEN ABS(COALESCE(tout.pending_amount, 0))
            ELSE 0
          END
        ) AS payable,

        SUM(
  CASE 
    WHEN LOWER(COALESCE(tout.bill_type, '')) = 'receivable'
    THEN ABS(COALESCE(tout.cost_center_amount, tout.pending_amount, tout.bill_amount, 0))
    WHEN LOWER(COALESCE(tout.bill_type, '')) = 'payable'
    THEN -ABS(COALESCE(tout.cost_center_amount, tout.pending_amount, tout.bill_amount, 0))
    ELSE 0
  END
) AS net_business,

SUM(
  CASE 
    WHEN LOWER(COALESCE(tout.bill_type, '')) = 'receivable'
    THEN ABS(COALESCE(tout.pending_amount, 0))
    WHEN LOWER(COALESCE(tout.bill_type, '')) = 'payable'
    THEN -ABS(COALESCE(tout.pending_amount, 0))
    ELSE 0
  END
) AS net_outstanding,

MAX(tout.synced_at) AS last_synced_at

      FROM tally_outstandings tout
      WHERE ${filters.join(" AND ")}
      GROUP BY COALESCE(tout.cost_center_id::text, tout.cost_center_name), tout.cost_center_name
      ${havingFilters.length ? `HAVING ${havingFilters.join(" AND ")}` : ""}
      ORDER BY total_business DESC, tout.cost_center_name ASC
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
        net_outstanding: toNumber(row.net_outstanding),
        last_synced_at: row.last_synced_at,
      })),
    });
  } catch (error: any) {
    return res.status(500).json({
      statusCode: 500,
      message: error?.message || "Failed to fetch cost center performance",
      data: null,
    });
  }
}

export async function getCostCenterPerformanceFiltersHandler(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantIdFromRequest(req);
    const userId = getUserIdFromRequest(req);

    const tallyCompanyId = req.query.tally_company_id
      ? String(req.query.tally_company_id)
      : "";

    const costCenterParams: any[] = [tenantId];
    const costCenterWhere: string[] = ["cc.tenant_id = $1"];

    addCostCenterMasterAccessFilter({
      where: costCenterWhere,
      values: costCenterParams,
      tenantAlias: "cc",
      costCenterAlias: "cc",
      userId,
      tallyCompanyId: tallyCompanyId || null,
    });

    const ledgerParams: any[] = [tenantId];
    const ledgerWhere: string[] = [
      "tout.tenant_id = $1",
      "COALESCE(NULLIF(TRIM(tout.ledger_name), ''), '') <> ''",
    ];

    addTallyRecordAccessFilter({
      where: ledgerWhere,
      values: ledgerParams,
      userId,
      recordAlias: "tout",
      costCenterExpression: "tout.cost_center_id",
      tallyCompanyId: tallyCompanyId || null,
    });

    const [costCentersResult, ledgersResult] = await Promise.all([
      pool.query(
        `
        SELECT DISTINCT
          cc.id,
          cc.name
        FROM cost_centers cc
        WHERE ${costCenterWhere.join(" AND ")}
        ORDER BY cc.name ASC
        LIMIT 500
        `,
        costCenterParams,
      ),

      pool.query(
        `
        SELECT DISTINCT tout.ledger_name AS name
        FROM tally_outstandings tout
        WHERE ${ledgerWhere.join(" AND ")}
        ORDER BY tout.ledger_name ASC
        LIMIT 500
        `,
        ledgerParams,
      ),
    ]);

    return res.json({
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

function buildDateFilter(query: any, params: any[], alias = "") {
  const filters: string[] = [];
  const prefix = alias ? `${alias}.` : "";

  if (query.start_date) {
    params.push(query.start_date);
    filters.push(`${prefix}voucher_date >= $${params.length}`);
  }

  if (query.end_date) {
    params.push(query.end_date);
    filters.push(`${prefix}voucher_date <= $${params.length}`);
  }

  return filters;
}

export async function getCostCenterPerformanceLedgersHandler(
  req: any,
  res: Response,
) {
  try {
    const tenantId = getTenantIdFromRequest(req);
    const userId = getUserIdFromRequest(req);
    const { id } = req.params;

    const {
      tally_company_id,
      cost_center_id,
      ledger_name,
      min_amount,
      max_amount,
      start_date,
      end_date,
      from_date,
      to_date,
    } = req.query;
    const effectiveStartDate = start_date || from_date;
    const effectiveEndDate = end_date || to_date;

    const params: any[] = [tenantId, id];

    const filters: string[] = [
      `tout.tenant_id = $1`,
      `(
    tout.cost_center_id = $2::uuid
    OR LOWER(TRIM(COALESCE(tout.cost_center_name, ''))) = LOWER(TRIM($2::text))
  )`,
    ];

    filters.push(
      ...buildDateFilter(
        { start_date: effectiveStartDate, end_date: effectiveEndDate },
        params,
        "tout",
      ),
    );
    addTallyRecordAccessFilter({
      where: filters,
      values: params,
      userId,
      recordAlias: "tout",
      costCenterExpression: "tout.cost_center_id",
      tallyCompanyId: tally_company_id ? String(tally_company_id) : null,
    });

    const sql = `
      SELECT
        tout.ledger_name,

        COUNT(*) AS bill_count,

        SUM(
          CASE 
            WHEN LOWER(COALESCE(tout.bill_type, '')) = 'receivable'
            THEN ABS(COALESCE(tout.cost_center_amount, tout.pending_amount, tout.bill_amount, 0))
            ELSE 0
          END
        ) AS total_business,

        SUM(
          CASE 
            WHEN LOWER(COALESCE(tout.bill_type, '')) = 'payable'
            THEN ABS(COALESCE(tout.cost_center_amount, tout.pending_amount, tout.bill_amount, 0))
            ELSE 0
          END
        ) AS total_purchase,

        SUM(
          CASE 
            WHEN LOWER(COALESCE(tout.bill_type, '')) = 'receivable'
            THEN ABS(COALESCE(tout.pending_amount, 0))
            ELSE 0
          END
        ) AS receivable,

        SUM(
          CASE 
            WHEN LOWER(COALESCE(tout.bill_type, '')) = 'payable'
            THEN ABS(COALESCE(tout.pending_amount, 0))
            ELSE 0
          END
        ) AS payable,

        SUM(
  CASE 
    WHEN LOWER(COALESCE(tout.bill_type, '')) = 'receivable'
    THEN ABS(COALESCE(tout.cost_center_amount, tout.pending_amount, tout.bill_amount, 0))
    WHEN LOWER(COALESCE(tout.bill_type, '')) = 'payable'
    THEN -ABS(COALESCE(tout.cost_center_amount, tout.pending_amount, tout.bill_amount, 0))
    ELSE 0
  END
) AS net_business,

SUM(
  CASE 
    WHEN LOWER(COALESCE(tout.bill_type, '')) = 'receivable'
    THEN ABS(COALESCE(tout.pending_amount, 0))
    WHEN LOWER(COALESCE(tout.bill_type, '')) = 'payable'
    THEN -ABS(COALESCE(tout.pending_amount, 0))
    ELSE 0
  END
) AS net_outstanding

      FROM tally_outstandings tout
      WHERE ${filters.join(" AND ")}
      GROUP BY tout.ledger_name
      ORDER BY total_business DESC, tout.ledger_name ASC
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
        net_outstanding: toNumber(row.net_outstanding),
      })),
    });
  } catch (error: any) {
    return res.status(500).json({
      statusCode: 500,
      message:
        error?.message || "Failed to fetch cost center ledger performance",
      data: null,
    });
  }
}
