import type { Request, Response } from "express";
import { pool } from "../../db/pool";

function sendSuccess(res: Response, message: string, data: any) {
  return res.status(200).json({
    statusCode: 200,
    message,
    data,
  });
}

function sendError(res: Response, error: any) {
  console.error("[OUTSTANDINGS_ERROR]", error);

  return res.status(500).json({
    statusCode: 500,
    message: error?.message || "Something went wrong",
    data: null,
  });
}

function getTenantId(req: Request) {
  const tenantId =
    (req as any).tenant?.id ||
    (req as any).tenant_id ||
    (req as any).tenantId ||
    req.headers["x-tenant-id"];

  if (!tenantId) {
    throw new Error("Tenant not resolved");
  }

  return String(tenantId);
}

function toInt(value: any, fallback: number) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function normalizeType(type?: any) {
  const value = String(type || "receivable").toLowerCase();

  if (["receivable", "payable", "all"].includes(value)) {
    return value;
  }

  return "receivable";
}

function normalizeSortBy(sortBy?: any) {
  const value = String(sortBy || "pending_amount").toLowerCase();

  const allowed: Record<string, string> = {
    pending_amount: "pending_amount",
    bill_amount: "bill_amount",
    voucher_date: "voucher_date",
    due_date: "due_date",
    ledger_name: "ledger_name",
    ageing_days: "ageing_days",
  };

  return allowed[value] || "pending_amount";
}

function normalizeSortOrder(sortOrder?: any) {
  const value = String(sortOrder || "desc").toLowerCase();
  return value === "asc" ? "ASC" : "DESC";
}

function buildWhere(input: {
  tenantId: string;
  type?: string;
  costCenterId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}) {
  const values: any[] = [input.tenantId];

  const where: string[] = [`o.tenant_id = $1`];

  if (input.type && input.type !== "all") {
    values.push(input.type);
    where.push(`LOWER(COALESCE(o.bill_type, '')) = LOWER($${values.length})`);
  }

  if (input.costCenterId) {
    values.push(input.costCenterId);
    where.push(`
    (
      tally_cc.id = $${values.length}
      OR org_cc.id = $${values.length}
    )
  `);
  }

  if (input.dateFrom) {
    values.push(input.dateFrom);
    where.push(`o.voucher_date::date >= $${values.length}::date`);
  }

  if (input.dateTo) {
    values.push(input.dateTo);
    where.push(`o.voucher_date::date <= $${values.length}::date`);
  }

  if (input.search) {
    values.push(`%${String(input.search).trim()}%`);
    where.push(`
      (
        o.ledger_name ILIKE $${values.length}
        OR o.bill_ref ILIKE $${values.length}
        OR o.voucher_number ILIKE $${values.length}
        OR org.name ILIKE $${values.length}
        OR o.cost_center_name ILIKE $${values.length}
        OR tally_cc.name ILIKE $${values.length}
        OR org_cc.name ILIKE $${values.length}
      )
    `);
  }

  return {
    whereSql: where.join(" AND "),
    values,
  };
}

/**
 * Important:
 * organizations table me tally_guid column nahi hai.
 * Isliye yaha org mapping ledger_name -> organization.name se ho rahi hai.
 *
 * Outstanding source:
 * tally_outstandings o
 *
 * Organization mapping:
 * LOWER(TRIM(o.ledger_name)) = LOWER(TRIM(org.name))
 *
 * Cost center mapping:
 * organizations -> organization_cost_centers -> cost_centers
 */
const baseFromSql = `
  FROM tally_outstandings o

  LEFT JOIN organizations org
    ON org.tenant_id = o.tenant_id
    AND LOWER(TRIM(org.name)) = LOWER(TRIM(o.ledger_name))

  LEFT JOIN organization_cost_centers occ
    ON occ.tenant_id = o.tenant_id
    AND occ.organization_id = org.id

  LEFT JOIN cost_centers org_cc
    ON org_cc.tenant_id = o.tenant_id
    AND org_cc.id = occ.cost_center_id

  LEFT JOIN cost_centers tally_cc
    ON tally_cc.tenant_id = o.tenant_id
    AND (
      tally_cc.id = o.cost_center_id
      OR (
        o.cost_center_name IS NOT NULL
        AND LOWER(TRIM(tally_cc.name)) = LOWER(TRIM(o.cost_center_name))
      )
      OR (
        o.cost_center_guid IS NOT NULL
        AND tally_cc.tally_guid = o.cost_center_guid
      )
    )
`;

export async function getOutstandingsHandler(req: Request, res: Response) {
  try {
    const tenantId = getTenantId(req);

    const page = toInt(req.query.page, 1);
    const limit = Math.min(toInt(req.query.limit, 20), 100);
    const offset = (page - 1) * limit;

    const type = normalizeType(req.query.type);
    const costCenterId = req.query.cost_center_id
      ? String(req.query.cost_center_id)
      : "";
    const dateFrom = req.query.date_from ? String(req.query.date_from) : "";
    const dateTo = req.query.date_to ? String(req.query.date_to) : "";
    const search = req.query.search ? String(req.query.search).trim() : "";

    const sortBy = normalizeSortBy(req.query.sort_by);
    const sortOrder = normalizeSortOrder(req.query.sort_order);

    const sortColumnMap: Record<string, string> = {
      pending_amount: `ABS(COALESCE(o.pending_amount, 0))`,
      bill_amount: `ABS(COALESCE(o.bill_amount, 0))`,
      voucher_date: `o.voucher_date`,
      due_date: `o.due_date`,
      ledger_name: `o.ledger_name`,
      ageing_days: `
        CASE
          WHEN o.due_date IS NOT NULL THEN GREATEST(0, CURRENT_DATE - o.due_date::date)
          WHEN o.voucher_date IS NOT NULL THEN GREATEST(0, CURRENT_DATE - o.voucher_date::date)
          ELSE 0
        END
      `,
    };

    const { whereSql, values } = buildWhere({
      tenantId,
      type,
      costCenterId,
      dateFrom,
      dateTo,
      search,
    });

    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT o.id
        ${baseFromSql}
        WHERE ${whereSql}
        GROUP BY o.id
      ) x
    `;

    const countResult = await pool.query(countSql, values);
    const total = Number(countResult.rows?.[0]?.total || 0);

    const dataValues = [...values, limit, offset];

    const dataSql = `
      SELECT
        o.id,
        o.tenant_id,
        o.tally_guid,
        o.ledger_guid,
        o.ledger_name,
        o.voucher_guid,
        o.voucher_number,
        o.voucher_type,
        o.voucher_date,
        o.due_date,
        o.bill_ref,
        o.bill_type,

        COALESCE(o.bill_amount, 0)::numeric AS bill_amount,
        COALESCE(o.pending_amount, 0)::numeric AS pending_amount,
        ABS(COALESCE(o.pending_amount, 0))::numeric AS pending_amount_abs,
        o.synced_at,

        MIN(org.id::text) AS organization_id,
        COALESCE(MIN(org.name), o.ledger_name) AS organization_name,

        COALESCE(
  MIN(tally_cc.id::text),
  MIN(org_cc.id::text)
) AS cost_center_id,

COALESCE(
  NULLIF(STRING_AGG(DISTINCT tally_cc.name, ', '), ''),
  NULLIF(o.cost_center_name, ''),
  NULLIF(STRING_AGG(DISTINCT org_cc.name, ', '), '')
) AS cost_center_name,

        CASE
          WHEN o.due_date IS NOT NULL THEN GREATEST(0, CURRENT_DATE - o.due_date::date)
          WHEN o.voucher_date IS NOT NULL THEN GREATEST(0, CURRENT_DATE - o.voucher_date::date)
          ELSE 0
        END::int AS ageing_days

      ${baseFromSql}
      WHERE ${whereSql}
      GROUP BY
        o.id,
        o.tenant_id,
        o.tally_guid,
        o.ledger_guid,
        o.ledger_name,
        o.voucher_guid,
        o.voucher_number,
        o.voucher_type,
        o.voucher_date,
        o.due_date,
        o.bill_ref,
        o.bill_type,
        o.bill_amount,
        o.pending_amount,
        o.synced_at,
        o.cost_center_name
      ORDER BY ${sortColumnMap[sortBy]} ${sortOrder} NULLS LAST
      LIMIT $${dataValues.length - 1}
      OFFSET $${dataValues.length}
    `;

    const result = await pool.query(dataSql, dataValues);

    return sendSuccess(res, "Outstandings fetched successfully", {
      rows: result.rows.map((row) => ({
        ...row,
        bill_amount: Number(row.bill_amount || 0),
        pending_amount: Number(row.pending_amount || 0),
        pending_amount_abs: Number(row.pending_amount_abs || 0),
        ageing_days: Number(row.ageing_days || 0),
      })),
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
      filters: {
        type,
        cost_center_id: costCenterId || null,
        date_from: dateFrom || null,
        date_to: dateTo || null,
        search: search || null,
        sort_by: sortBy,
        sort_order: sortOrder.toLowerCase(),
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function getOutstandingsSummaryHandler(
  req: Request,
  res: Response,
) {
  try {
    const tenantId = getTenantId(req);

    const type = normalizeType(req.query.type || "all");
    const costCenterId = req.query.cost_center_id
      ? String(req.query.cost_center_id)
      : "";
    const dateFrom = req.query.date_from ? String(req.query.date_from) : "";
    const dateTo = req.query.date_to ? String(req.query.date_to) : "";
    const search = req.query.search ? String(req.query.search).trim() : "";

    const { whereSql, values } = buildWhere({
      tenantId,
      type,
      costCenterId,
      dateFrom,
      dateTo,
      search,
    });

    const sql = `
      SELECT
        COALESCE(SUM(
          CASE
            WHEN LOWER(COALESCE(o.bill_type, '')) = 'receivable'
            THEN ABS(COALESCE(o.pending_amount, 0))
            ELSE 0
          END
        ), 0)::numeric AS total_receivable,

        COALESCE(SUM(
          CASE
            WHEN LOWER(COALESCE(o.bill_type, '')) = 'payable'
            THEN ABS(COALESCE(o.pending_amount, 0))
            ELSE 0
          END
        ), 0)::numeric AS total_payable,

        (
          COALESCE(SUM(
            CASE
              WHEN LOWER(COALESCE(o.bill_type, '')) = 'receivable'
              THEN ABS(COALESCE(o.pending_amount, 0))
              ELSE 0
            END
          ), 0)
          -
          COALESCE(SUM(
            CASE
              WHEN LOWER(COALESCE(o.bill_type, '')) = 'payable'
              THEN ABS(COALESCE(o.pending_amount, 0))
              ELSE 0
            END
          ), 0)
        )::numeric AS net_outstanding,

        COUNT(DISTINCT o.id)::int AS total_bills,
        COUNT(DISTINCT LOWER(TRIM(o.ledger_name)))::int AS total_ledgers,
        COUNT(DISTINCT COALESCE(tally_cc.id, org_cc.id))::int AS total_cost_centers
      ${baseFromSql}
      WHERE ${whereSql}
    `;

    const result = await pool.query(sql, values);
    const row = result.rows?.[0] || {};

    return sendSuccess(res, "Outstandings summary fetched successfully", {
      total_receivable: Number(row.total_receivable || 0),
      total_payable: Number(row.total_payable || 0),
      net_outstanding: Number(row.net_outstanding || 0),
      total_bills: Number(row.total_bills || 0),
      total_ledgers: Number(row.total_ledgers || 0),
      total_cost_centers: Number(row.total_cost_centers || 0),
    });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function getOutstandingCostCentersHandler(
  req: Request,
  res: Response,
) {
  try {
    const tenantId = getTenantId(req);

    const sql = `
  SELECT
    COALESCE(tally_cc.id, org_cc.id) AS id,
    COALESCE(tally_cc.name, org_cc.name, o.cost_center_name) AS name,
    COUNT(DISTINCT o.id)::int AS outstanding_count,

    COALESCE(SUM(
      CASE
        WHEN LOWER(COALESCE(o.bill_type, '')) = 'receivable'
        THEN ABS(COALESCE(o.pending_amount, 0))
        ELSE 0
      END
    ), 0)::numeric AS receivable,

    COALESCE(SUM(
      CASE
        WHEN LOWER(COALESCE(o.bill_type, '')) = 'payable'
        THEN ABS(COALESCE(o.pending_amount, 0))
        ELSE 0
      END
    ), 0)::numeric AS payable

  ${baseFromSql}
  WHERE o.tenant_id = $1
    AND COALESCE(tally_cc.id::text, org_cc.id::text, NULLIF(o.cost_center_name, '')) IS NOT NULL
  GROUP BY
    COALESCE(tally_cc.id, org_cc.id),
    COALESCE(tally_cc.name, org_cc.name, o.cost_center_name)
  ORDER BY name ASC
`;

    const result = await pool.query(sql, [tenantId]);

    return sendSuccess(
      res,
      "Outstanding cost centers fetched successfully",
      result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        outstanding_count: Number(row.outstanding_count || 0),
        receivable: Number(row.receivable || 0),
        payable: Number(row.payable || 0),
      })),
    );
  } catch (error) {
    return sendError(res, error);
  }
}
