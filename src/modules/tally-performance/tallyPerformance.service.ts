import { Request, Response } from "express";
import { pool } from "../../db/pool";

function getTenantId(req: Request) {
  return (req as any).user?.tenantId || (req as any).user?.tenant_id;
}

function sendError(res: Response, error: any, message: string) {
  console.error(message, error);
  return res.status(500).json({
    success: false,
    message,
    error: error?.message || String(error),
  });
}

function parseLimit(value: any, fallback = 20) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 100);
}

/**
 * GET /:slug/tally-performance/summary
 */
export async function getTallyPerformanceSummaryHandler(
  req: Request,
  res: Response,
) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: "Tenant not found",
      });
    }

    const result = await pool.query(
      `
      WITH mapped_outstandings AS (
        SELECT
          t.*
        FROM tally_outstandings t
        JOIN tally_entity_mappings tem
          ON tem.tenant_id = t.tenant_id
         AND tem.tally_guid = t.ledger_guid
         AND tem.entity_type = 'organization'
        WHERE t.tenant_id = $1
          AND t.pending_amount > 0
      ),
      unmapped_ledgers AS (
        SELECT
          t.ledger_guid
        FROM tally_outstandings t
        LEFT JOIN tally_entity_mappings tem
          ON tem.tenant_id = t.tenant_id
         AND tem.tally_guid = t.ledger_guid
         AND tem.entity_type = 'organization'
        WHERE t.tenant_id = $1
          AND t.pending_amount > 0
          AND tem.id IS NULL
        GROUP BY t.ledger_guid
      ),
      unassigned_orgs AS (
        SELECT
          o.id
        FROM organizations o
        JOIN tally_entity_mappings tem
          ON tem.tenant_id = o.tenant_id
         AND tem.crm_entity_id = o.id
         AND tem.entity_type = 'organization'
        JOIN tally_outstandings t
          ON t.tenant_id = tem.tenant_id
         AND (
  NULLIF(t.ledger_guid, '') = tem.tally_guid
  OR (
    (t.ledger_guid IS NULL OR t.ledger_guid = '')
    AND lower(trim(t.ledger_name)) = lower(trim(tem.tally_name))
  )
)
        WHERE o.tenant_id = $1
          AND o.assigned_to IS NULL
          AND t.pending_amount > 0
        GROUP BY o.id
      )
      SELECT
        COALESCE(SUM(CASE
          WHEN mo.bill_type = 'receivable'
          THEN mo.pending_amount ELSE 0
        END), 0) AS total_receivable,

        COALESCE(SUM(CASE
          WHEN mo.bill_type = 'payable'
          THEN mo.pending_amount ELSE 0
        END), 0) AS total_payable,

        COALESCE(SUM(CASE
          WHEN mo.bill_type = 'receivable'
           AND mo.due_date < CURRENT_DATE
          THEN mo.pending_amount ELSE 0
        END), 0) AS overdue_receivable,

        COALESCE(SUM(CASE
          WHEN mo.bill_type = 'receivable'
           AND CURRENT_DATE - mo.due_date > 90
          THEN mo.pending_amount ELSE 0
        END), 0) AS critical_receivable,

        COUNT(DISTINCT CASE
          WHEN mo.bill_type = 'receivable'
          THEN mo.id
        END) AS receivable_bills,

        COUNT(DISTINCT CASE
          WHEN mo.bill_type = 'payable'
          THEN mo.id
        END) AS payable_bills,

        COUNT(DISTINCT mo.ledger_guid) AS mapped_ledgers_with_outstanding,

        (SELECT COUNT(*) FROM unmapped_ledgers) AS unmapped_ledgers,

        (SELECT COUNT(*) FROM unassigned_orgs) AS unassigned_organizations

      FROM mapped_outstandings mo
      `,
      [tenantId],
    );

    return res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    return sendError(res, error, "Failed to fetch Tally performance summary");
  }
}

/**
 * GET /:slug/tally-performance/employees
 */
export async function getEmployeeTallyPerformanceHandler(
  req: Request,
  res: Response,
) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: "Tenant not found",
      });
    }

    const result = await pool.query(
      `
      SELECT
        u.id AS employee_id,
        COALESCE(u.display_name, u.name, u.email) AS employee_name,
        u.email AS employee_email,
        u.employee_code,
        u.designation,
        u.department,

        COUNT(DISTINCT o.id) AS assigned_organizations,

        COUNT(DISTINCT CASE
          WHEN t.bill_type = 'receivable' THEN t.id
        END) AS receivable_bills,

        COUNT(DISTINCT CASE
          WHEN t.bill_type = 'payable' THEN t.id
        END) AS payable_bills,

        COALESCE(SUM(CASE
          WHEN t.bill_type = 'receivable'
          THEN t.pending_amount ELSE 0
        END), 0) AS total_receivable,

        COALESCE(SUM(CASE
          WHEN t.bill_type = 'payable'
          THEN t.pending_amount ELSE 0
        END), 0) AS total_payable,

        COALESCE(SUM(CASE
          WHEN t.bill_type = 'receivable'
           AND t.due_date < CURRENT_DATE
          THEN t.pending_amount ELSE 0
        END), 0) AS overdue_receivable,

        COALESCE(SUM(CASE
          WHEN t.bill_type = 'receivable'
           AND CURRENT_DATE - t.due_date > 90
          THEN t.pending_amount ELSE 0
        END), 0) AS critical_receivable,

        COUNT(CASE
          WHEN t.bill_type = 'receivable'
           AND t.due_date < CURRENT_DATE
          THEN 1
        END) AS overdue_bills,

        ROUND(
          100
          - LEAST(
              50,
              COALESCE(
                SUM(CASE WHEN t.bill_type = 'receivable' AND t.due_date < CURRENT_DATE THEN t.pending_amount ELSE 0 END)
                / NULLIF(SUM(CASE WHEN t.bill_type = 'receivable' THEN t.pending_amount ELSE 0 END), 0) * 50,
                0
              )
            )
          - LEAST(
              30,
              COALESCE(
                SUM(CASE WHEN t.bill_type = 'receivable' AND CURRENT_DATE - t.due_date > 90 THEN t.pending_amount ELSE 0 END)
                / NULLIF(SUM(CASE WHEN t.bill_type = 'receivable' THEN t.pending_amount ELSE 0 END), 0) * 30,
                0
              )
            )
          - LEAST(
              20,
              COALESCE(
                COUNT(CASE WHEN t.bill_type = 'receivable' AND t.due_date < CURRENT_DATE THEN 1 END)::numeric
                / NULLIF(COUNT(CASE WHEN t.bill_type = 'receivable' THEN 1 END), 0) * 20,
                0
              )
            ),
          2
        ) AS performance_score,

        CASE
          WHEN COALESCE(SUM(CASE WHEN t.bill_type = 'receivable' THEN t.pending_amount ELSE 0 END), 0) = 0
            THEN 'No Outstanding'

          WHEN ROUND(
            100
            - LEAST(50, COALESCE(SUM(CASE WHEN t.bill_type = 'receivable' AND t.due_date < CURRENT_DATE THEN t.pending_amount ELSE 0 END) / NULLIF(SUM(CASE WHEN t.bill_type = 'receivable' THEN t.pending_amount ELSE 0 END), 0) * 50, 0))
            - LEAST(30, COALESCE(SUM(CASE WHEN t.bill_type = 'receivable' AND CURRENT_DATE - t.due_date > 90 THEN t.pending_amount ELSE 0 END) / NULLIF(SUM(CASE WHEN t.bill_type = 'receivable' THEN t.pending_amount ELSE 0 END), 0) * 30, 0))
            - LEAST(20, COALESCE(COUNT(CASE WHEN t.bill_type = 'receivable' AND t.due_date < CURRENT_DATE THEN 1 END)::numeric / NULLIF(COUNT(CASE WHEN t.bill_type = 'receivable' THEN 1 END), 0) * 20, 0)),
            2
          ) >= 80 THEN 'Excellent'

          WHEN ROUND(
            100
            - LEAST(50, COALESCE(SUM(CASE WHEN t.bill_type = 'receivable' AND t.due_date < CURRENT_DATE THEN t.pending_amount ELSE 0 END) / NULLIF(SUM(CASE WHEN t.bill_type = 'receivable' THEN t.pending_amount ELSE 0 END), 0) * 50, 0))
            - LEAST(30, COALESCE(SUM(CASE WHEN t.bill_type = 'receivable' AND CURRENT_DATE - t.due_date > 90 THEN t.pending_amount ELSE 0 END) / NULLIF(SUM(CASE WHEN t.bill_type = 'receivable' THEN t.pending_amount ELSE 0 END), 0) * 30, 0))
            - LEAST(20, COALESCE(COUNT(CASE WHEN t.bill_type = 'receivable' AND t.due_date < CURRENT_DATE THEN 1 END)::numeric / NULLIF(COUNT(CASE WHEN t.bill_type = 'receivable' THEN 1 END), 0) * 20, 0)),
            2
          ) >= 60 THEN 'Good'

          WHEN ROUND(
            100
            - LEAST(50, COALESCE(SUM(CASE WHEN t.bill_type = 'receivable' AND t.due_date < CURRENT_DATE THEN t.pending_amount ELSE 0 END) / NULLIF(SUM(CASE WHEN t.bill_type = 'receivable' THEN t.pending_amount ELSE 0 END), 0) * 50, 0))
            - LEAST(30, COALESCE(SUM(CASE WHEN t.bill_type = 'receivable' AND CURRENT_DATE - t.due_date > 90 THEN t.pending_amount ELSE 0 END) / NULLIF(SUM(CASE WHEN t.bill_type = 'receivable' THEN t.pending_amount ELSE 0 END), 0) * 30, 0))
            - LEAST(20, COALESCE(COUNT(CASE WHEN t.bill_type = 'receivable' AND t.due_date < CURRENT_DATE THEN 1 END)::numeric / NULLIF(COUNT(CASE WHEN t.bill_type = 'receivable' THEN 1 END), 0) * 20, 0)),
            2
          ) >= 40 THEN 'Needs Attention'

          ELSE 'Critical'
        END AS performance_status

      FROM public.users u

      LEFT JOIN organizations o
        ON o.tenant_id = u.tenant_id
       AND o.assigned_to = u.id

      LEFT JOIN tally_entity_mappings tem
        ON tem.tenant_id = o.tenant_id
       AND tem.crm_entity_id = o.id
       AND tem.entity_type = 'organization'

      LEFT JOIN tally_outstandings t
        ON t.tenant_id = tem.tenant_id
       AND (
  NULLIF(t.ledger_guid, '') = tem.tally_guid
  OR (
    (t.ledger_guid IS NULL OR t.ledger_guid = '')
    AND lower(trim(t.ledger_name)) = lower(trim(tem.tally_name))
  )
)
       AND t.pending_amount > 0

      WHERE u.tenant_id = $1
        AND COALESCE(u.is_active, true) = true

      GROUP BY
        u.id,
        u.display_name,
        u.name,
        u.email,
        u.employee_code,
        u.designation,
        u.department

      ORDER BY
        total_receivable DESC,
        overdue_receivable DESC
      `,
      [tenantId],
    );

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    return sendError(res, error, "Failed to fetch employee Tally performance");
  }
}

/**
 * GET /:slug/tally-performance/employees/:userId/outstandings
 */
export async function getEmployeeTallyOutstandingsHandler(
  req: Request,
  res: Response,
) {
  try {
    const tenantId = getTenantId(req);
    const { userId } = req.params;

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: "Tenant not found",
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }

    const result = await pool.query(
      `
      SELECT
        t.id,
        t.ledger_guid,
        t.ledger_name,

        o.id AS organization_id,
        o.name AS organization_name,
        o.email AS organization_email,
        o.gst_number AS organization_gst_number,

        t.voucher_guid,
        t.voucher_number,
        t.voucher_type,
        t.voucher_date,
        t.due_date,
        t.bill_ref,
        t.bill_type,
        t.bill_amount,
        t.pending_amount,

        CASE
          WHEN t.due_date IS NULL THEN 0
          WHEN t.due_date < CURRENT_DATE THEN CURRENT_DATE - t.due_date
          ELSE 0
        END AS overdue_days,

        CASE
          WHEN t.due_date IS NULL THEN 'No Due Date'
          WHEN t.due_date >= CURRENT_DATE THEN 'Not Due'
          WHEN CURRENT_DATE - t.due_date BETWEEN 1 AND 30 THEN '1-30 Days'
          WHEN CURRENT_DATE - t.due_date BETWEEN 31 AND 60 THEN '31-60 Days'
          WHEN CURRENT_DATE - t.due_date BETWEEN 61 AND 90 THEN '61-90 Days'
          ELSE '90+ Days'
        END AS ageing_bucket

      FROM tally_outstandings t

      JOIN tally_entity_mappings tem
        ON tem.tenant_id = t.tenant_id
       AND tem.tally_guid = t.ledger_guid
       AND tem.entity_type = 'organization'

      JOIN organizations o
        ON o.tenant_id = tem.tenant_id
       AND o.id = tem.crm_entity_id

      WHERE t.tenant_id = $1
        AND o.assigned_to = $2
        AND t.bill_type = 'receivable'
        AND t.pending_amount > 0

      ORDER BY
        t.due_date ASC NULLS LAST,
        t.pending_amount DESC
      `,
      [tenantId, userId],
    );

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    return sendError(res, error, "Failed to fetch employee outstandings");
  }
}

/**
 * GET /:slug/tally-performance/ageing
 */
export async function getTallyAgeingReportHandler(req: Request, res: Response) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: "Tenant not found",
      });
    }

    const result = await pool.query(
      `
      SELECT
        u.id AS employee_id,
        COALESCE(u.display_name, u.name, u.email) AS employee_name,

        COALESCE(SUM(CASE
          WHEN t.due_date IS NULL
          THEN t.pending_amount ELSE 0
        END), 0) AS no_due_date,

        COALESCE(SUM(CASE
          WHEN t.due_date >= CURRENT_DATE
          THEN t.pending_amount ELSE 0
        END), 0) AS not_due,

        COALESCE(SUM(CASE
          WHEN CURRENT_DATE - t.due_date BETWEEN 1 AND 30
          THEN t.pending_amount ELSE 0
        END), 0) AS bucket_1_30,

        COALESCE(SUM(CASE
          WHEN CURRENT_DATE - t.due_date BETWEEN 31 AND 60
          THEN t.pending_amount ELSE 0
        END), 0) AS bucket_31_60,

        COALESCE(SUM(CASE
          WHEN CURRENT_DATE - t.due_date BETWEEN 61 AND 90
          THEN t.pending_amount ELSE 0
        END), 0) AS bucket_61_90,

        COALESCE(SUM(CASE
          WHEN CURRENT_DATE - t.due_date > 90
          THEN t.pending_amount ELSE 0
        END), 0) AS bucket_above_90,

        COALESCE(SUM(t.pending_amount), 0) AS total_pending

      FROM public.users u

      JOIN organizations o
        ON o.tenant_id = u.tenant_id
       AND o.assigned_to = u.id

      JOIN tally_entity_mappings tem
        ON tem.tenant_id = o.tenant_id
       AND tem.crm_entity_id = o.id
       AND tem.entity_type = 'organization'

      JOIN tally_outstandings t
        ON t.tenant_id = tem.tenant_id
       AND (
  NULLIF(t.ledger_guid, '') = tem.tally_guid
  OR (
    (t.ledger_guid IS NULL OR t.ledger_guid = '')
    AND lower(trim(t.ledger_name)) = lower(trim(tem.tally_name))
  )
)

      WHERE u.tenant_id = $1
        AND t.bill_type = 'receivable'
        AND t.pending_amount > 0

      GROUP BY
        u.id,
        u.display_name,
        u.name,
        u.email

      ORDER BY total_pending DESC
      `,
      [tenantId],
    );

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    return sendError(res, error, "Failed to fetch ageing report");
  }
}

/**
 * GET /:slug/tally-performance/risky-customers?limit=20
 */
export async function getRiskyCustomersHandler(req: Request, res: Response) {
  try {
    const tenantId = getTenantId(req);
    const limit = parseLimit(req.query.limit, 20);

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: "Tenant not found",
      });
    }

    const result = await pool.query(
      `
      SELECT
        o.id AS organization_id,
        o.name AS organization_name,
        o.email AS organization_email,
        o.gst_number AS organization_gst_number,

        u.id AS assigned_to,
        COALESCE(u.display_name, u.name, u.email) AS assigned_to_name,

        COUNT(t.id) AS overdue_bills,

        COALESCE(SUM(t.pending_amount), 0) AS overdue_amount,

        MAX(CURRENT_DATE - t.due_date) AS max_overdue_days,

        CASE
          WHEN MAX(CURRENT_DATE - t.due_date) > 90 THEN 'Critical'
          WHEN MAX(CURRENT_DATE - t.due_date) > 60 THEN 'High'
          WHEN MAX(CURRENT_DATE - t.due_date) > 30 THEN 'Medium'
          ELSE 'Low'
        END AS risk_level

      FROM tally_outstandings t

      JOIN tally_entity_mappings tem
        ON tem.tenant_id = t.tenant_id
       AND tem.tally_guid = t.ledger_guid
       AND tem.entity_type = 'organization'

      JOIN organizations o
        ON o.tenant_id = tem.tenant_id
       AND o.id = tem.crm_entity_id

      LEFT JOIN users u
        ON u.tenant_id = o.tenant_id
       AND u.id = o.assigned_to

      WHERE t.tenant_id = $1
        AND t.bill_type = 'receivable'
        AND t.pending_amount > 0
        AND t.due_date < CURRENT_DATE

      GROUP BY
        o.id,
        o.name,
        o.email,
        o.gst_number,
        u.id,
        u.display_name,
        u.name,
        u.email

      ORDER BY overdue_amount DESC
      LIMIT $2
      `,
      [tenantId, limit],
    );

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    return sendError(res, error, "Failed to fetch risky customers");
  }
}

/**
 * GET /:slug/tally-performance/unassigned-organizations
 */
export async function getUnassignedOutstandingOrganizationsHandler(
  req: Request,
  res: Response,
) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: "Tenant not found",
      });
    }

    const result = await pool.query(
      `
      SELECT
        o.id AS organization_id,
        o.name AS organization_name,
        o.email,
        o.gst_number,

        tem.tally_guid,
        tem.tally_name,

        COUNT(t.id) AS pending_bills,

        COALESCE(SUM(CASE
          WHEN t.bill_type = 'receivable'
          THEN t.pending_amount ELSE 0
        END), 0) AS receivable_amount,

        COALESCE(SUM(CASE
          WHEN t.bill_type = 'payable'
          THEN t.pending_amount ELSE 0
        END), 0) AS payable_amount,

        COALESCE(SUM(t.pending_amount), 0) AS total_pending

      FROM organizations o

      JOIN tally_entity_mappings tem
        ON tem.tenant_id = o.tenant_id
       AND tem.crm_entity_id = o.id
       AND tem.entity_type = 'organization'

      JOIN tally_outstandings t
        ON t.tenant_id = tem.tenant_id
       AND (
  NULLIF(t.ledger_guid, '') = tem.tally_guid
  OR (
    (t.ledger_guid IS NULL OR t.ledger_guid = '')
    AND lower(trim(t.ledger_name)) = lower(trim(tem.tally_name))
  )
)

      WHERE o.tenant_id = $1
        AND o.assigned_to IS NULL
        AND t.pending_amount > 0

      GROUP BY
        o.id,
        o.name,
        o.email,
        o.gst_number,
        tem.tally_guid,
        tem.tally_name

      ORDER BY total_pending DESC
      `,
      [tenantId],
    );

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    return sendError(
      res,
      error,
      "Failed to fetch unassigned outstanding organizations",
    );
  }
}

/**
 * GET /:slug/tally-performance/unmapped-ledgers
 */
export async function getUnmappedTallyLedgersHandler(
  req: Request,
  res: Response,
) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: "Tenant not found",
      });
    }

    const result = await pool.query(
      `
      SELECT
        tl.id,
        tl.tally_guid,
        tl.name AS tally_ledger_name,
        tl.parent,
        tl.gstin,
        tl.email,
        tl.phone,
        tl.state,
        tl.country,
        tl.opening_balance,
        tl.closing_balance,

        COUNT(to2.id) AS outstanding_bills,

        COALESCE(SUM(CASE
          WHEN to2.bill_type = 'receivable'
          THEN to2.pending_amount ELSE 0
        END), 0) AS receivable_amount,

        COALESCE(SUM(CASE
          WHEN to2.bill_type = 'payable'
          THEN to2.pending_amount ELSE 0
        END), 0) AS payable_amount,

        COALESCE(SUM(to2.pending_amount), 0) AS total_pending

      FROM tally_ledgers tl

      LEFT JOIN tally_entity_mappings tem
        ON tem.tenant_id = tl.tenant_id
       AND tem.tally_guid = tl.tally_guid
       AND tem.entity_type = 'organization'

      LEFT JOIN tally_outstandings to2
        ON to2.tenant_id = tl.tenant_id
       AND to2.ledger_guid = tl.tally_guid
       AND to2.pending_amount > 0

      WHERE tl.tenant_id = $1
        AND tem.id IS NULL

      GROUP BY
        tl.id,
        tl.tally_guid,
        tl.name,
        tl.parent,
        tl.gstin,
        tl.email,
        tl.phone,
        tl.state,
        tl.country,
        tl.opening_balance,
        tl.closing_balance

      ORDER BY total_pending DESC, tl.name ASC
      `,
      [tenantId],
    );

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    return sendError(res, error, "Failed to fetch unmapped Tally ledgers");
  }
}

/**
 * GET /:slug/tally-performance/map-suggestions
 */
export async function getTallyMapSuggestionsHandler(
  req: Request,
  res: Response,
) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(401).json({
        success: false,
        message: "Tenant not found",
      });
    }

    const result = await pool.query(
      `
      WITH unmapped_ledgers AS (
        SELECT
          tl.*
        FROM tally_ledgers tl
        LEFT JOIN tally_entity_mappings tem
          ON tem.tenant_id = tl.tenant_id
         AND tem.tally_guid = tl.tally_guid
         AND tem.entity_type = 'organization'
        WHERE tl.tenant_id = $1
          AND tem.id IS NULL
      )

      SELECT
        ul.id AS tally_ledger_id,
        ul.tally_guid,
        ul.name AS tally_ledger_name,
        ul.gstin AS tally_gstin,
        ul.email AS tally_email,
        ul.phone AS tally_phone,
        ul.parent AS tally_parent,

        o.id AS organization_id,
        o.name AS organization_name,
        o.gst_number AS organization_gst_number,
        o.email AS organization_email,
        o.assigned_to,

        COALESCE(u.display_name, u.name, u.email) AS assigned_to_name,

        CASE
          WHEN ul.gstin IS NOT NULL
           AND ul.gstin <> ''
           AND o.gst_number IS NOT NULL
           AND o.gst_number <> ''
           AND lower(trim(ul.gstin)) = lower(trim(o.gst_number))
            THEN 'GST_MATCH'

          WHEN ul.email IS NOT NULL
           AND ul.email <> ''
           AND o.email IS NOT NULL
           AND o.email <> ''
           AND lower(trim(ul.email)) = lower(trim(o.email))
            THEN 'EMAIL_MATCH'

          WHEN lower(trim(ul.name)) = lower(trim(o.name))
            THEN 'NAME_MATCH'

          ELSE 'POSSIBLE_MATCH'
        END AS match_type,

        CASE
          WHEN ul.gstin IS NOT NULL
           AND ul.gstin <> ''
           AND o.gst_number IS NOT NULL
           AND o.gst_number <> ''
           AND lower(trim(ul.gstin)) = lower(trim(o.gst_number))
            THEN 100

          WHEN ul.email IS NOT NULL
           AND ul.email <> ''
           AND o.email IS NOT NULL
           AND o.email <> ''
           AND lower(trim(ul.email)) = lower(trim(o.email))
            THEN 90

          WHEN lower(trim(ul.name)) = lower(trim(o.name))
            THEN 80

          ELSE 50
        END AS match_score

      FROM unmapped_ledgers ul

      JOIN organizations o
        ON o.tenant_id = ul.tenant_id
       AND (
            (
              ul.gstin IS NOT NULL
              AND ul.gstin <> ''
              AND o.gst_number IS NOT NULL
              AND o.gst_number <> ''
              AND lower(trim(ul.gstin)) = lower(trim(o.gst_number))
            )
            OR
            (
              ul.email IS NOT NULL
              AND ul.email <> ''
              AND o.email IS NOT NULL
              AND o.email <> ''
              AND lower(trim(ul.email)) = lower(trim(o.email))
            )
            OR
            lower(trim(ul.name)) = lower(trim(o.name))
       )

      LEFT JOIN users u
        ON u.tenant_id = o.tenant_id
       AND u.id = o.assigned_to

      ORDER BY
        match_score DESC,
        ul.name ASC,
        o.name ASC
      `,
      [tenantId],
    );

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    return sendError(res, error, "Failed to fetch Tally map suggestions");
  }
}

/**
 * POST /:slug/tally-performance/map-ledger
 *
 * Body:
 * {
 *   "organization_id": "uuid",
 *   "tally_guid": "text",
 *   "tally_name": "optional"
 * }
 */
export async function mapTallyLedgerToOrganizationHandler(
  req: Request,
  res: Response,
) {
  const client = await pool.connect();

  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      client.release();
      return res.status(401).json({
        success: false,
        message: "Tenant not found",
      });
    }

    const { organization_id, tally_guid, tally_name } = req.body || {};

    if (!organization_id) {
      client.release();
      return res.status(400).json({
        success: false,
        message: "organization_id is required",
      });
    }

    if (!tally_guid) {
      client.release();
      return res.status(400).json({
        success: false,
        message: "tally_guid is required",
      });
    }

    await client.query("BEGIN");

    const orgResult = await client.query(
      `
      SELECT
        id,
        name
      FROM organizations
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
      `,
      [tenantId, organization_id],
    );

    if (!orgResult.rowCount) {
      await client.query("ROLLBACK");
      client.release();

      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    const ledgerResult = await client.query(
      `
      SELECT
        tally_guid,
        name
      FROM tally_ledgers
      WHERE tenant_id = $1
        AND tally_guid = $2
      LIMIT 1
      `,
      [tenantId, tally_guid],
    );

    if (!ledgerResult.rowCount) {
      await client.query("ROLLBACK");
      client.release();

      return res.status(404).json({
        success: false,
        message: "Tally ledger not found",
      });
    }

    const ledger = ledgerResult.rows[0];

    const existingByLedger = await client.query(
      `
      SELECT
        id,
        crm_entity_id,
        tally_guid,
        tally_name
      FROM tally_entity_mappings
      WHERE tenant_id = $1
        AND entity_type = 'organization'
        AND tally_guid = $2
      LIMIT 1
      `,
      [tenantId, tally_guid],
    );

    if (existingByLedger.rowCount) {
      await client.query("ROLLBACK");
      client.release();

      return res.status(409).json({
        success: false,
        message:
          "This Tally ledger is already mapped with another organization",
        data: existingByLedger.rows[0],
      });
    }

    const insertResult = await client.query(
      `
      INSERT INTO tally_entity_mappings (
        tenant_id,
        entity_type,
        crm_entity_id,
        tally_guid,
        tally_master_id,
        tally_alter_id,
        tally_name,
        last_synced_at,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        'organization',
        $2,
        $3,
        NULL,
        NULL,
        $4,
        now(),
        now(),
        now()
      )
      RETURNING *
      `,
      [tenantId, organization_id, tally_guid, tally_name || ledger.name],
    );

    await client.query("COMMIT");
    client.release();

    return res.status(201).json({
      success: true,
      message: "Tally ledger mapped successfully",
      data: insertResult.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    client.release();

    return sendError(res, error, "Failed to map Tally ledger");
  }
}
