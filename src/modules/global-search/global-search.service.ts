import type { Request, Response } from "express";
import { pool } from "../../db/pool";
import { globalSearchQuerySchema } from "./global-search.schema";

const response = (
  res: Response,
  statusCode: number,
  message: string,
  data: any = null,
) => {
  return res.status(statusCode).json({
    statusCode,
    message,
    data,
  });
};

function getTenantId(req: Request) {
  return (
    (req as any).tenant?.id ||
    (req as any).tenantId ||
    (req as any).user?.tenant_id ||
    null
  );
}

function getUserId(req: Request) {
  return (req as any).user?.id || (req as any).userId || null;
}

async function getUserPermissionCodes(tenantId: string, userId: string) {
  const result = await pool.query(
    `
    SELECT DISTINCT rp.permission_code
    FROM user_roles ur
    INNER JOIN role_permissions rp
      ON rp.role_id = ur.role_id
    WHERE ur.tenant_id = $1
      AND ur.user_id = $2
    `,
    [tenantId, userId],
  );

  return new Set<string>(result.rows.map((row) => row.permission_code));
}

function hasPermission(permissions: Set<string>, allowedCodes: string[]) {
  return allowedCodes.some((code) => permissions.has(code));
}

export async function globalSearch(req: Request, res: Response) {
  try {
    const parsed = globalSearchQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      return response(res, 400, "Validation failed", parsed.error.flatten());
    }

    const tenantId = getTenantId(req);
    const userId = getUserId(req);

    if (!tenantId) {
      return response(res, 400, "Tenant context missing");
    }

    if (!userId) {
      return response(res, 401, "Unauthorized");
    }

    const { q, limit } = parsed.data;

    const permissions = await getUserPermissionCodes(tenantId, userId);

    const searchValue = `%${q}%`;
    const values: any[] = [tenantId, searchValue];
    const queries: string[] = [];

    const finalLimit = Math.min(Math.max(Number(limit) || 30, 1), 50);

    const canViewSalesOrders = hasPermission(permissions, [
      "sales-orders.view",
    ]);

    const canViewPurchaseOrders = hasPermission(permissions, [
      "purchase-orders.view",
    ]);

    const canViewQuotes = hasPermission(permissions, ["quotes.view"]);

    const canViewProducts = hasPermission(permissions, ["products.view"]);

    const canViewOrganizations = hasPermission(permissions, [
      "organizations.view",
      "organization.view",
    ]);

    if (canViewSalesOrders) {
      queries.push(`
        SELECT
          so.id::text AS id,
          'sales_order' AS type,
          'Sales Orders' AS module,
          COALESCE(
            so.voucher_number,
            so.tally_voucher_number,
            so.reference_number,
            'Sales Order'
          ) AS title,
          COALESCE(org.name, so.customer_name, '') AS subtitle,
          CONCAT(
            'Customer: ',
            COALESCE(so.customer_name, org.name, '-'),
            ' | Ref: ',
            COALESCE(so.reference_number, '-'),
            ' | Total: ',
            COALESCE(so.total_amount::text, '0')
          ) AS description,
          CONCAT('/sales-orders/', so.id::text) AS "redirectUrl",
          CASE
            WHEN so.voucher_number ILIKE $2 THEN 100
            WHEN so.tally_voucher_number ILIKE $2 THEN 98
            WHEN so.reference_number ILIKE $2 THEN 95
            WHEN so.voucher_guid ILIKE $2 THEN 90
            WHEN so.tally_guid ILIKE $2 THEN 90
            WHEN so.customer_name ILIKE $2 THEN 80
            WHEN org.name ILIKE $2 THEN 75
            ELSE 40
          END AS score
        FROM sales_orders so
        LEFT JOIN organizations org
          ON org.tenant_id = so.tenant_id
         AND org.id = COALESCE(so.organization_id, so.customer_id)
         AND org.deleted_at IS NULL
        WHERE so.tenant_id = $1
          AND so.deleted_at IS NULL
          AND (
            so.voucher_number ILIKE $2
            OR so.tally_voucher_number ILIKE $2
            OR so.reference_number ILIKE $2
            OR so.voucher_guid ILIKE $2
            OR so.tally_guid ILIKE $2
            OR so.customer_name ILIKE $2
            OR so.customer_gst ILIKE $2
            OR so.tally_company_name ILIKE $2
            OR so.cost_center_name ILIKE $2
            OR org.name ILIKE $2
          )
      `);
    }

    if (canViewPurchaseOrders) {
      queries.push(`
        SELECT
          po.id::text AS id,
          'purchase_order' AS type,
          'Purchase Orders' AS module,
          COALESCE(
            po.voucher_number,
            po.tally_voucher_number,
            po.reference_number,
            'Purchase Order'
          ) AS title,
          COALESCE(po.supplier_name, '') AS subtitle,
          CONCAT(
            'Supplier: ',
            COALESCE(po.supplier_name, '-'),
            ' | Ref: ',
            COALESCE(po.reference_number, '-'),
            ' | Total: ',
            COALESCE(po.total_amount::text, '0')
          ) AS description,
          CONCAT('/purchase-orders/', po.id::text) AS "redirectUrl",
          CASE
            WHEN po.voucher_number ILIKE $2 THEN 100
            WHEN po.tally_voucher_number ILIKE $2 THEN 98
            WHEN po.reference_number ILIKE $2 THEN 95
            WHEN po.tally_guid ILIKE $2 THEN 90
            WHEN po.supplier_name ILIKE $2 THEN 80
            ELSE 40
          END AS score
        FROM purchase_orders po
        WHERE po.tenant_id = $1
          AND po.deleted_at IS NULL
          AND (
            po.voucher_number ILIKE $2
            OR po.tally_voucher_number ILIKE $2
            OR po.reference_number ILIKE $2
            OR po.tally_guid ILIKE $2
            OR po.supplier_name ILIKE $2
            OR po.supplier_gst ILIKE $2
            OR po.tally_company_name ILIKE $2
            OR po.cost_center_name ILIKE $2
          )
      `);
    }

    if (canViewQuotes) {
      queries.push(`
        SELECT
          qut.id::text AS id,
          'quote' AS type,
          'Quotes' AS module,
          COALESCE(qut.quote_number, qut.title, 'Quote') AS title,
          COALESCE(org.name, qut.company_name, '') AS subtitle,
          CONCAT(
            'Company: ',
            COALESCE(org.name, qut.company_name, '-'),
            ' | Total: ',
            COALESCE(qut.grand_total::text, '0')
          ) AS description,
          CONCAT('/quotes/', qut.id::text) AS "redirectUrl",
          CASE
            WHEN qut.quote_number ILIKE $2 THEN 100
            WHEN qut.title ILIKE $2 THEN 90
            WHEN qut.company_name ILIKE $2 THEN 85
            WHEN org.name ILIKE $2 THEN 80
            ELSE 40
          END AS score
        FROM quotes qut
        LEFT JOIN organizations org
          ON org.tenant_id = qut.tenant_id
         AND org.id = qut.organization_id
         AND org.deleted_at IS NULL
        WHERE qut.tenant_id = $1
          AND qut.deleted_at IS NULL
          AND (
            qut.quote_number ILIKE $2
            OR qut.title ILIKE $2
            OR qut.company_name ILIKE $2
            OR qut.gstin ILIKE $2
            OR qut.description ILIKE $2
            OR org.name ILIKE $2
          )
      `);
    }

    if (canViewProducts) {
      queries.push(`
        SELECT
          p.id::text AS id,
          'product' AS type,
          'Products' AS module,
          COALESCE(p.name, 'Product') AS title,
          COALESCE(p.part_number, p.hsn_code, '') AS subtitle,
          CONCAT(
            'Part No: ',
            COALESCE(p.part_number, '-'),
            ' | HSN: ',
            COALESCE(p.hsn_code, '-'),
            ' | Price: ',
            COALESCE(p.selling_price::text, '0')
          ) AS description,
          CONCAT('/products/', p.id::text) AS "redirectUrl",
          CASE
            WHEN p.name ILIKE $2 THEN 100
            WHEN p.part_number ILIKE $2 THEN 95
            WHEN p.hsn_code ILIKE $2 THEN 90
            WHEN p.category ILIKE $2 THEN 80
            WHEN p.manufacturer ILIKE $2 THEN 75
            ELSE 40
          END AS score
        FROM products p
        WHERE p.tenant_id = $1
          AND p.deleted_at IS NULL
          AND (
            p.name ILIKE $2
            OR p.part_number ILIKE $2
            OR p.hsn_code ILIKE $2
            OR p.category ILIKE $2
            OR p.manufacturer ILIKE $2
            OR p.description ILIKE $2
            OR p.tally_company_name ILIKE $2
          )
      `);
    }

    if (canViewOrganizations) {
      queries.push(`
        SELECT
          org.id::text AS id,
          'organization' AS type,
          'Organizations' AS module,
          COALESCE(org.name, 'Organization') AS title,
          COALESCE(org.email, org.gst_number, '') AS subtitle,
          CONCAT(
            'GST: ',
            COALESCE(org.gst_number, '-'),
            ' | Email: ',
            COALESCE(org.email, '-'),
            ' | City: ',
            COALESCE(org.registered_city, '-')
          ) AS description,
          CONCAT('/organizations/', org.id::text) AS "redirectUrl",
          CASE
            WHEN org.name ILIKE $2 THEN 100
            WHEN org.email ILIKE $2 THEN 90
            WHEN org.gst_number ILIKE $2 THEN 90
            WHEN org.registered_city ILIKE $2 THEN 70
            ELSE 40
          END AS score
        FROM organizations org
        WHERE org.tenant_id = $1
          AND org.deleted_at IS NULL
          AND (
            org.name ILIKE $2
            OR org.email ILIKE $2
            OR org.gst_number ILIKE $2
            OR org.industry ILIKE $2
            OR org.registered_city ILIKE $2
            OR org.registered_state ILIKE $2
            OR org.registered_country ILIKE $2
            OR org.tally_company_name ILIKE $2
          )
      `);
    }

    if (!queries.length) {
      return response(res, 200, "Search results fetched successfully", {
        query: q,
        results: [],
      });
    }

    const finalQuery = `
      SELECT *
      FROM (
        ${queries.join("\nUNION ALL\n")}
      ) search_results
      ORDER BY score DESC, title ASC
      LIMIT ${finalLimit}
    `;

    const result = await pool.query(finalQuery, values);

    return response(res, 200, "Search results fetched successfully", {
      query: q,
      results: result.rows,
    });
  } catch (error: any) {
    console.error("Global search error:", error);

    return response(res, 500, "Failed to fetch search results", {
      error: error.message,
    });
  }
}
