import type { Request, Response } from "express";
import { pool } from "../../db/pool";
import { CreatePurchaseOrderSchema } from "./purchase-orders.schema";

import {
  GetPurchaseOrdersQuerySchema,
  PurchaseOrderIdParamSchema,
} from "./purchase-orders.schema";

const getTenantId = (req: Request) => {
  return req.params?.slug || req.headers["x-tenant-id"];
};

// 🔹 LISTING
export const getPurchaseOrdersHandler = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(400).json({ message: "Tenant is required" });
    }

    const query = GetPurchaseOrdersQuerySchema.parse(req.query);

    const where: string[] = [`po.tenant_id = $1`, `po.deleted_at IS NULL`];

    const values: any[] = [tenantId];

    if (query.search) {
      values.push(`%${query.search}%`);
      where.push(`
        (
          po.voucher_number ILIKE $${values.length}
          OR po.supplier_name ILIKE $${values.length}
          OR po.reference_number ILIKE $${values.length}
        )
      `);
    }

    if (query.status) {
      values.push(query.status);
      where.push(`po.status = $${values.length}`);
    }

    if (query.assigned_to) {
      values.push(query.assigned_to);
      where.push(`po.raw_tally_data->>'assigned_to' = $${values.length}`);
    }

    if (query.vendor) {
      values.push(query.vendor);
      where.push(`po.raw_tally_data->>'vendor_id' = $${values.length}`);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM purchase_orders po
      ${whereSql}
    `;

    const countResult = await pool.query(countSql, values);
    const total = countResult.rows?.[0]?.total || 0;

    values.push(query.limit);
    const limitIndex = values.length;

    values.push(query.offset);
    const offsetIndex = values.length;

    const listSql = `
      SELECT
        po.id,
        po.tenant_id,
        po.voucher_number AS po_number,
        po.supplier_name,
        po.supplier_gst,
        po.voucher_date,
        po.reference_number,
        po.total_amount,
        po.status,
        po.created_at,

        po.raw_tally_data->>'expected_delivery_date' AS expected_delivery_date,
        po.raw_tally_data->>'assigned_to' AS assigned_to,
        po.raw_tally_data->>'vendor_id' AS vendor_id,

        COALESCE(u.name, u.email) AS assigned_to_name,

        COALESCE(items.items_count, 0)::int AS items_count,
        COALESCE(items.items, '[]'::json) AS items

      FROM purchase_orders po

      LEFT JOIN users u
        ON u.id::text = po.raw_tally_data->>'assigned_to'
       AND u.tenant_id = po.tenant_id

      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS items_count,
          json_agg(
            json_build_object(
              'id', poi.id,
              'item_name', poi.item_name,
              'item_code', poi.item_code,
              'quantity', poi.quantity,
              'rate', poi.rate,
              'amount', poi.amount,
              'unit', poi.unit,
              'raw_tally_data', poi.raw_tally_data
            )
            ORDER BY poi.id
          ) AS items
        FROM purchase_order_items poi
        WHERE poi.purchase_order_id = po.id
      ) items ON true

      ${whereSql}
      ORDER BY po.created_at DESC
      LIMIT $${limitIndex}
      OFFSET $${offsetIndex}
    `;

    const listResult = await pool.query(listSql, values);

    return res.status(200).json({
      message: "Purchase orders fetched successfully",
      data: listResult.rows,
      total,
      offset: query.offset,
      limit: query.limit,
    });
  } catch (error: any) {
    console.error("getPurchaseOrdersHandler error:", error);

    return res.status(500).json({
      message: "Failed to fetch purchase orders",
      error: error?.message,
    });
  }
};

// 🔹 DETAILS
export const getPurchaseOrderByIdHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(400).json({ message: "Tenant is required" });
    }

    const params = PurchaseOrderIdParamSchema.parse(req.params);

    const sql = `
  SELECT
    po.*,

    po.voucher_number AS po_number,
    po.raw_tally_data->>'expected_delivery_date' AS expected_delivery_date,
    po.raw_tally_data->>'assigned_to' AS assigned_to,

    COALESCE(u.name, u.email) AS assigned_to_name,

    COALESCE(items.items_count, 0)::int AS items_count,
    COALESCE(items.items, '[]'::json) AS items

  FROM purchase_orders po

  LEFT JOIN users u
    ON u.id::text = po.raw_tally_data->>'assigned_to'
   AND u.tenant_id = po.tenant_id

  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::int AS items_count,
      json_agg(
        json_build_object(
          'id', poi.id,
          'item_name', poi.item_name,
          'item_code', poi.item_code,
          'quantity', poi.quantity,
          'rate', poi.rate,
          'amount', poi.amount,
          'unit', poi.unit,
          'raw_tally_data', poi.raw_tally_data
        )
        ORDER BY poi.id
      ) AS items
    FROM purchase_order_items poi
    WHERE poi.purchase_order_id = po.id
  ) items ON true

  WHERE po.id = $1
    AND po.tenant_id = $2
    AND po.deleted_at IS NULL
  LIMIT 1
`;

    const result = await pool.query(sql, [params.id, tenantId]);

    if (!result.rows.length) {
      return res.status(404).json({
        message: "Purchase order not found",
      });
    }

    return res.status(200).json({
      message: "Purchase order fetched successfully",
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error("getPurchaseOrderByIdHandler error:", error);

    return res.status(500).json({
      message: "Failed to fetch purchase order",
      error: error?.message,
    });
  }
};

const generatePONumber = async (client: any, tenantId: string) => {
  const result = await client.query(
    `
    SELECT voucher_number
    FROM purchase_orders
    WHERE tenant_id = $1
      AND voucher_number LIKE 'PO-%'
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [tenantId],
  );

  let nextNumber = 1;

  if (result.rows.length) {
    const last = result.rows[0].voucher_number; // PO-0000123
    const num = parseInt(last.replace("PO-", ""), 10);

    if (!isNaN(num)) {
      nextNumber = num + 1;
    }
  }

  return `PO-${String(nextNumber).padStart(7, "0")}`;
};

// 🔹 CREATE
export const createPurchaseOrderHandler = async (
  req: Request,
  res: Response,
) => {
  const client = await pool.connect();

  try {
    const tenantId = getTenantId(req) as string;

    if (!tenantId) {
      return res.status(400).json({ message: "Tenant is required" });
    }

    const body = CreatePurchaseOrderSchema.parse(req.body);

    await client.query("BEGIN");

    let supplierName = body.vendor_name || null;

    if (!supplierName && body.vendor_id) {
      const vendorResult = await client.query(
        `
        SELECT name
        FROM organizations
        WHERE id = $1
          AND tenant_id = $2
        LIMIT 1
        `,
        [body.vendor_id, tenantId],
      );

      supplierName = vendorResult.rows?.[0]?.name || null;
    }

    if (!supplierName) {
      supplierName = "Unknown Supplier";
    }

    const poNumber = await generatePONumber(client, tenantId);

    const poResult = await client.query(
      `
      INSERT INTO purchase_orders (
        tenant_id,
        voucher_number,
        voucher_date,
        supplier_name,
        supplier_gst,
        reference_number,
        total_amount,
        status,
        raw_tally_data,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()
      )
      RETURNING *
      `,
      [
        tenantId,
        poNumber, // 👈 AUTO GENERATED
        body.po_date,
        supplierName,
        null,
        body.po_number || null,
        body.grand_total,
        body.status || "draft",
        body,
      ],
    );

    const purchaseOrder = poResult.rows[0];

    for (const item of body.items) {
      const quantity = Number(item.quantity || 0);
      const rate = Number(item.price || 0);
      const discount = Number(item.discount || 0);
      const amount = quantity * rate - discount;

      const productResult = await client.query(
        `
    SELECT
      name,
      part_number,
      unit_uqc
    FROM products
    WHERE id = $1
      AND tenant_id = $2
    LIMIT 1
    `,
        [item.product_id, tenantId],
      );

      const product = productResult.rows?.[0];

      await client.query(
        `
    INSERT INTO purchase_order_items (
      purchase_order_id,
      item_name,
      item_code,
      quantity,
      rate,
      amount,
      unit,
      raw_tally_data
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8
    )
    `,
        [
          purchaseOrder.id,
          product?.name || null, // ✅ FIXED
          product?.part_number || item.product_id, // ✅ FIXED
          quantity,
          rate,
          amount,
          product?.unit || null, // ✅ FIXED
          {
            ...item,
            product_name: product?.name,
            product_code: product?.part_number,
            unit: product?.unit,
            discount,
          },
        ],
      );
    }

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Purchase order created successfully",
      data: purchaseOrder,
      statusCode: 201,
      success: true,
    });
  } catch (error: any) {
    await client.query("ROLLBACK");

    console.error("createPurchaseOrderHandler error:", error);

    return res.status(500).json({
      message: "Failed to create purchase order",
      error: error?.message,
      statusCode: 500,
      success: false,
    });
  } finally {
    client.release();
  }
};

export const updatePurchaseOrderHandler = async (
  req: Request,
  res: Response,
) => {
  const client = await pool.connect();

  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;
    const body = req.body;

    await client.query("BEGIN");

    await client.query(
      `
      UPDATE purchase_orders
      SET
        voucher_number = $1,
        voucher_date = $2,
        total_amount = $3,
        raw_tally_data = $4,
        updated_at = NOW()
      WHERE id = $5 AND tenant_id = $6
      `,
      [body.po_number, body.po_date, body.grand_total, body, id, tenantId],
    );

    // 🔥 Items delete + reinsert (simple & safe)
    await client.query(
      `DELETE FROM purchase_order_items WHERE purchase_order_id = $1`,
      [id],
    );

    for (const item of body.items || []) {
      const amount =
        Number(item.quantity) * Number(item.price) - Number(item.discount || 0);

      await client.query(
        `
        INSERT INTO purchase_order_items (
          purchase_order_id,
          item_name,
          item_code,
          quantity,
          rate,
          amount,
          raw_tally_data
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        `,
        [
          id,
          item.product_name,
          item.product_id,
          item.quantity,
          item.price,
          amount,
          item,
        ],
      );
    }

    await client.query("COMMIT");

    return res.json({ message: "Updated successfully" });
  } catch (err: any) {
    await client.query("ROLLBACK");
    return res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
};
