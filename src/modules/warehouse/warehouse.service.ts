import { Request, Response } from "express";
import { pool } from "../../db/pool";
import {
  CreatePoReceiptSchema,
  CreateSoDispatchSchema,
  ListWarehouseSchema,
  UpdateWarehouseStatusSchema,
} from "./warehouse.schema";

function getTenantId(req: Request) {
  return (req as any).user?.tenantId || (req as any).tenant?.id;
}

function getUserId(req: Request) {
  return (req as any).user?.id;
}

async function generateNumber(
  client: any,
  tenantId: string,
  table: "warehouse_receipts" | "warehouse_dispatches",
  column: "receipt_number" | "dispatch_number",
  prefix: "WR" | "WD",
) {
  const { rows } = await client.query(
    `
    SELECT COUNT(*)::int AS total
    FROM ${table}
    WHERE tenant_id = $1
    `,
    [tenantId],
  );

  const next = Number(rows[0]?.total || 0) + 1;
  return `${prefix}-${String(next).padStart(7, "0")}`;
}

/**
 * Old combined warehouse listing.
 * Safe aliases:
 * - PO number -> purchase_orders.voucher_number
 * - SO number -> sales_orders.voucher_number
 */
export async function listWarehouseHandler(req: Request, res: Response) {
  const tenantId = getTenantId(req);
  const query = ListWarehouseSchema.parse(req.query);

  const page = query.page;
  const limit = query.limit;
  const offset = (page - 1) * limit;

  const params: any[] = [tenantId];
  let where = `WHERE x.tenant_id = $1`;

  if (query.status) {
    params.push(query.status);
    where += ` AND x.status = $${params.length}`;
  }

  if (query.search) {
    params.push(`%${query.search}%`);
    where += ` AND (
      COALESCE(x.number, '') ILIKE $${params.length}
      OR COALESCE(x.party_name, '') ILIKE $${params.length}
      OR COALESCE(x.ref_number, '') ILIKE $${params.length}
    )`;
  }

  const typeFilter =
    query.type === "po"
      ? `SELECT * FROM po_data`
      : query.type === "so"
        ? `SELECT * FROM so_data`
        : `SELECT * FROM po_data UNION ALL SELECT * FROM so_data`;

  const { rows } = await pool.query(
    `
    WITH po_data AS (
      SELECT
        wr.id,
        wr.tenant_id,
        'po' AS type,
        wr.receipt_number AS number,
        wr.status,
        po.supplier_name AS party_name,
        po.voucher_number AS ref_number,
        wr.received_at AS action_at,
        wr.created_at
      FROM warehouse_receipts wr
      LEFT JOIN purchase_orders po ON po.id = wr.purchase_order_id
      WHERE wr.tenant_id = $1
    ),
    so_data AS (
      SELECT
        wd.id,
        wd.tenant_id,
        'so' AS type,
        wd.dispatch_number AS number,
        wd.status,
        so.customer_name AS party_name,
        so.voucher_number AS ref_number,
        wd.dispatched_at AS action_at,
        wd.created_at
      FROM warehouse_dispatches wd
      LEFT JOIN sales_orders so ON so.id = wd.sales_order_id
      WHERE wd.tenant_id = $1
    ),
    x AS (
      ${typeFilter}
    )
    SELECT COUNT(*) OVER()::int AS total, x.*
    FROM x
    ${where}
    ORDER BY x.created_at DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
    `,
    [...params, limit, offset],
  );

  res.json({
    data: rows,
    total: Number(rows[0]?.total || 0),
    page,
    limit,
  });
}

/**
 * Frontend tab: Sales Orders
 * Actual DB columns:
 * sales_orders.voucher_number, voucher_date, customer_name, total_amount
 * sales_order_items.item_name, quantity
 */
export async function listWarehouseSalesOrdersHandler(
  req: Request,
  res: Response,
) {
  const tenantId = getTenantId(req);

  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 10);
  const offset = (page - 1) * limit;

  const search = String(req.query.search || "").trim();
  const status = String(req.query.status || "").trim();
  const dateFrom = String(req.query.date_from || "").trim();
  const dateTo = String(req.query.date_to || "").trim();

  const params: any[] = [tenantId];
  let where = `WHERE so.tenant_id = $1 AND so.deleted_at IS NULL`;

  if (search) {
    params.push(`%${search}%`);
    where += ` AND (
      COALESCE(so.voucher_number, '') ILIKE $${params.length}
      OR COALESCE(so.customer_name, '') ILIKE $${params.length}
      OR COALESCE(so.customer_gst, '') ILIKE $${params.length}
      OR COALESCE(so.reference_number, '') ILIKE $${params.length}
      OR EXISTS (
        SELECT 1
        FROM sales_order_items soi2
        WHERE soi2.sales_order_id = so.id
        AND (
          COALESCE(soi2.item_name, '') ILIKE $${params.length}
          OR COALESCE(soi2.item_code, '') ILIKE $${params.length}
        )
      )
    )`;
  }

  if (status) {
    params.push(status);
    where += ` AND so.status = $${params.length}`;
  }

  if (dateFrom) {
    params.push(dateFrom);
    where += ` AND so.voucher_date >= $${params.length}::date`;
  }

  if (dateTo) {
    params.push(dateTo);
    where += ` AND so.voucher_date <= $${params.length}::date`;
  }

  const { rows } = await pool.query(
    `
    SELECT
      COUNT(*) OVER()::int AS total,

      so.id,
      so.voucher_number,
      so.voucher_number AS so_number,
      so.voucher_date,
      so.voucher_date AS so_date,
      so.customer_name,
      so.customer_gst,
      so.reference_number,
      so.total_amount,
      so.total_amount AS grand_total,
      so.status,
      so.created_at,
      so.updated_at,

      NULL::text AS assigned_to_name,
      NULL::date AS expected_delivery_date,

      latest_dispatch.courier_name,
      latest_dispatch.awb_number,
      latest_dispatch.tracking_url,

      COUNT(soi.id)::int AS items_count,

      COALESCE(
        STRING_AGG(
          COALESCE(soi.item_name, 'Item') || ' × ' || COALESCE(soi.quantity, 0)::text,
          ', '
          ORDER BY soi.item_name
        ),
        ''
      ) AS items_summary,
             COALESCE(
        json_agg(
          json_build_object(
            'id', soi.id,
            'sales_order_item_id', soi.id,
            'item_name', soi.item_name,
            'product_name', COALESCE(soi.item_name, 'Item'),
            'item_code', soi.item_code,
            'sku', soi.item_code,
            'unit', soi.unit,
            'quantity', COALESCE(soi.quantity, 0),
            'ordered_qty', COALESCE(soi.quantity, 0),
            'rate', COALESCE(soi.rate, 0),
            'amount', COALESCE(soi.amount, 0)
          )
          ORDER BY soi.item_name
        ) FILTER (WHERE soi.id IS NOT NULL),
        '[]'::json
      ) AS items

    FROM sales_orders so
    LEFT JOIN sales_order_items soi ON soi.sales_order_id = so.id

    LEFT JOIN LATERAL (
      SELECT
        wd.courier_name,
        wd.awb_number,
        wd.tracking_url
      FROM warehouse_dispatches wd
      WHERE wd.tenant_id = so.tenant_id
        AND wd.sales_order_id = so.id
      ORDER BY wd.created_at DESC
      LIMIT 1
    ) latest_dispatch ON true

    ${where}

    GROUP BY
      so.id,
      latest_dispatch.courier_name,
      latest_dispatch.awb_number,
      latest_dispatch.tracking_url

    ORDER BY so.created_at DESC

    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
    `,
    [...params, limit, offset],
  );

  res.json({
    data: rows,
    total: Number(rows[0]?.total || 0),
    page,
    limit,
  });
}

/**
 * Frontend tab: Purchase Orders
 * Actual DB columns:
 * purchase_orders.voucher_number, voucher_date, supplier_name, total_amount
 * purchase_order_items.item_name, quantity
 */
export async function listWarehousePurchaseOrdersHandler(
  req: Request,
  res: Response,
) {
  const tenantId = getTenantId(req);

  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 10);
  const offset = (page - 1) * limit;

  const search = String(req.query.search || "").trim();
  const status = String(req.query.status || "").trim();
  const dateFrom = String(req.query.date_from || "").trim();
  const dateTo = String(req.query.date_to || "").trim();

  const params: any[] = [tenantId];
  let where = `WHERE po.tenant_id = $1 AND po.deleted_at IS NULL`;

  if (search) {
    params.push(`%${search}%`);
    where += ` AND (
      COALESCE(po.voucher_number, '') ILIKE $${params.length}
      OR COALESCE(po.supplier_name, '') ILIKE $${params.length}
      OR COALESCE(po.supplier_gst, '') ILIKE $${params.length}
      OR COALESCE(po.reference_number, '') ILIKE $${params.length}
      OR EXISTS (
        SELECT 1
        FROM purchase_order_items poi2
        WHERE poi2.purchase_order_id = po.id
        AND (
          COALESCE(poi2.item_name, '') ILIKE $${params.length}
          OR COALESCE(poi2.item_code, '') ILIKE $${params.length}
        )
      )
    )`;
  }

  if (status) {
    params.push(status);
    where += ` AND po.status = $${params.length}`;
  }

  if (dateFrom) {
    params.push(dateFrom);
    where += ` AND po.voucher_date >= $${params.length}::date`;
  }

  if (dateTo) {
    params.push(dateTo);
    where += ` AND po.voucher_date <= $${params.length}::date`;
  }

  const { rows } = await pool.query(
    `
    SELECT
      COUNT(*) OVER()::int AS total,

      po.id,
      po.voucher_number,
      po.voucher_number AS po_number,
      po.voucher_date,
      po.voucher_date AS po_date,
      po.supplier_name,
      po.supplier_name AS vendor_name,
      po.supplier_gst,
      po.reference_number,
      po.total_amount,
      po.total_amount AS grand_total,
      po.status,
      po.created_at,
      po.updated_at,

      NULL::text AS assigned_to_name,
      NULL::date AS expected_delivery_date,

      latest_receipt.courier_name,
      latest_receipt.awb_number,
      latest_receipt.tracking_url,

      COUNT(poi.id)::int AS items_count,

            COALESCE(
        STRING_AGG(
          COALESCE(poi.item_name, 'Item') || ' × ' || COALESCE(poi.quantity, 0)::text,
          ', '
          ORDER BY poi.item_name
        ),
        ''
      ) AS items_summary,

      COALESCE(SUM(ri.received_qty), 0)::numeric AS received_qty,
      COALESCE(SUM(ri.damaged_qty), 0)::numeric AS damaged_qty,
      GREATEST(
        COALESCE(SUM(poi.quantity), 0)
        - COALESCE(SUM(ri.received_qty), 0)
        - COALESCE(SUM(ri.damaged_qty), 0),
        0
      )::numeric AS pending_qty,

      COALESCE(
        json_agg(
          json_build_object(
            'id', poi.id,
            'purchase_order_item_id', poi.id,
            'item_name', poi.item_name,
            'product_name', COALESCE(poi.item_name, 'Item'),
            'item_code', poi.item_code,
            'sku', poi.item_code,
            'unit', poi.unit,

            'quantity', COALESCE(poi.quantity, 0),
            'ordered_qty', COALESCE(poi.quantity, 0),
            'received_qty', COALESCE(ri.received_qty, 0),
            'already_received_qty', COALESCE(ri.received_qty, 0),
            'damaged_qty', COALESCE(ri.damaged_qty, 0),
            'pending_qty', GREATEST(
              COALESCE(poi.quantity, 0)
              - COALESCE(ri.received_qty, 0)
              - COALESCE(ri.damaged_qty, 0),
              0
            ),

            'rate', COALESCE(poi.rate, 0),
            'amount', COALESCE(poi.amount, 0)
          )
          ORDER BY poi.item_name
        ) FILTER (WHERE poi.id IS NOT NULL),
        '[]'::json
      ) AS items

    FROM purchase_orders po
    LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id

        LEFT JOIN (
      SELECT
        purchase_order_item_id,
        COALESCE(SUM(received_qty), 0)::numeric AS received_qty,
        COALESCE(SUM(damaged_qty), 0)::numeric AS damaged_qty
      FROM warehouse_receipt_items
      WHERE tenant_id = $1
      GROUP BY purchase_order_item_id
    ) ri ON ri.purchase_order_item_id = poi.id

    LEFT JOIN LATERAL (
      SELECT
        wr.courier_name,
        wr.awb_number,
        wr.tracking_url
      FROM warehouse_receipts wr
      WHERE wr.tenant_id = po.tenant_id
        AND wr.purchase_order_id = po.id
      ORDER BY wr.created_at DESC
      LIMIT 1
    ) latest_receipt ON true

    ${where}

    GROUP BY
      po.id,
      latest_receipt.courier_name,
      latest_receipt.awb_number,
      latest_receipt.tracking_url

    ORDER BY po.created_at DESC

    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
    `,
    [...params, limit, offset],
  );

  res.json({
    data: rows,
    total: Number(rows[0]?.total || 0),
    page,
    limit,
  });
}

/**
 * PO Receive Modal data
 */
export async function getPoForReceivingHandler(req: Request, res: Response) {
  const tenantId = getTenantId(req);
  const { id } = req.params;

  const { rows } = await pool.query(
    `
    SELECT
      po.*,

      po.voucher_number AS po_number,
      po.voucher_date AS po_date,
      po.supplier_name AS vendor_name,
      po.total_amount AS grand_total,
      NULL::date AS expected_delivery_date,

      latest_receipt.courier_name,
      latest_receipt.awb_number,
      latest_receipt.tracking_url,
      latest_receipt.remarks AS latest_warehouse_remarks,

      COALESCE(
        json_agg(
          json_build_object(
            'purchase_order_item_id', poi.id,
            'product_id', NULL,
            'product_name', COALESCE(poi.item_name, 'Item'),
            'item_name', poi.item_name,
            'item_code', poi.item_code,
            'sku', poi.item_code,
            'unit', poi.unit,
            'rate', COALESCE(poi.rate, 0),
            'amount', COALESCE(poi.amount, 0),
            'ordered_qty', COALESCE(poi.quantity, 0),
            'received_qty', COALESCE(ri.received_qty, 0),
            'already_received_qty', COALESCE(ri.received_qty, 0),
            'damaged_qty', COALESCE(ri.damaged_qty, 0),
            'pending_qty', GREATEST(
              COALESCE(poi.quantity, 0) - COALESCE(ri.received_qty, 0) - COALESCE(ri.damaged_qty, 0),
              0
            )
          )
          ORDER BY poi.item_name
        ) FILTER (WHERE poi.id IS NOT NULL),
        '[]'
      ) AS items

    FROM purchase_orders po

    LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id

    LEFT JOIN (
      SELECT
        purchase_order_item_id,
        SUM(received_qty) AS received_qty,
        SUM(damaged_qty) AS damaged_qty
      FROM warehouse_receipt_items
      WHERE tenant_id = $1
      GROUP BY purchase_order_item_id
    ) ri ON ri.purchase_order_item_id = poi.id

    LEFT JOIN LATERAL (
      SELECT
        wr.courier_name,
        wr.awb_number,
        wr.tracking_url,
        wr.remarks
      FROM warehouse_receipts wr
      WHERE wr.tenant_id = po.tenant_id
        AND wr.purchase_order_id = po.id
      ORDER BY wr.created_at DESC
      LIMIT 1
    ) latest_receipt ON true

    WHERE po.tenant_id = $1
      AND po.id = $2
      AND po.deleted_at IS NULL

    GROUP BY
      po.id,
      latest_receipt.courier_name,
      latest_receipt.awb_number,
      latest_receipt.tracking_url,
      latest_receipt.remarks
    `,
    [tenantId, id],
  );

  if (!rows[0]) {
    return res.status(404).json({ message: "Purchase order not found" });
  }

  res.json(rows[0]);
}

/**
 * SO Dispatch Modal data
 */
export async function getSoForDispatchHandler(req: Request, res: Response) {
  const tenantId = getTenantId(req);
  const { id } = req.params;

  const { rows } = await pool.query(
    `
    SELECT
      so.*,

      so.voucher_number AS so_number,
      so.voucher_date AS so_date,
      so.total_amount AS grand_total,
      NULL::date AS expected_delivery_date,

      latest_dispatch.courier_name,
      latest_dispatch.awb_number,
      latest_dispatch.tracking_url,
      latest_dispatch.remarks AS latest_warehouse_remarks,

      COALESCE(
        json_agg(
          json_build_object(
            'sales_order_item_id', soi.id,
            'product_id', NULL,
            'product_name', COALESCE(soi.item_name, 'Item'),
            'item_name', soi.item_name,
            'item_code', soi.item_code,
            'sku', soi.item_code,
            'unit', soi.unit,
            'rate', COALESCE(soi.rate, 0),
            'amount', COALESCE(soi.amount, 0),
            'ordered_qty', COALESCE(soi.quantity, 0),
            'already_dispatched_qty', COALESCE(di.dispatched_qty, 0),
            'pending_qty', GREATEST(
              COALESCE(soi.quantity, 0) - COALESCE(di.dispatched_qty, 0),
              0
            )
          )
          ORDER BY soi.item_name
        ) FILTER (WHERE soi.id IS NOT NULL),
        '[]'
      ) AS items

    FROM sales_orders so

    LEFT JOIN sales_order_items soi ON soi.sales_order_id = so.id

    LEFT JOIN (
      SELECT
        sales_order_item_id,
        SUM(dispatched_qty) AS dispatched_qty
      FROM warehouse_dispatch_items
      WHERE tenant_id = $1
      GROUP BY sales_order_item_id
    ) di ON di.sales_order_item_id = soi.id

    LEFT JOIN LATERAL (
      SELECT
        wd.courier_name,
        wd.awb_number,
        wd.tracking_url,
        wd.remarks
      FROM warehouse_dispatches wd
      WHERE wd.tenant_id = so.tenant_id
        AND wd.sales_order_id = so.id
      ORDER BY wd.created_at DESC
      LIMIT 1
    ) latest_dispatch ON true

    WHERE so.tenant_id = $1
      AND so.id = $2
      AND so.deleted_at IS NULL

    GROUP BY
      so.id,
      latest_dispatch.courier_name,
      latest_dispatch.awb_number,
      latest_dispatch.tracking_url,
      latest_dispatch.remarks
    `,
    [tenantId, id],
  );

  if (!rows[0]) {
    return res.status(404).json({ message: "Sales order not found" });
  }

  res.json(rows[0]);
}

export async function createPoReceiptHandler(req: Request, res: Response) {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const body = CreatePoReceiptSchema.parse(req.body);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const receiptNumber = await generateNumber(
      client,
      tenantId,
      "warehouse_receipts",
      "receipt_number",
      "WR",
    );

    const receiptStatus = body.status || "received";

    const receiptResult = await client.query(
      `
      INSERT INTO warehouse_receipts
      (
        tenant_id,
        purchase_order_id,
        receipt_number,
        status,
        courier_name,
        awb_number,
        tracking_url,
        received_at,
        received_by,
        remarks
      )
      VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        COALESCE($8::timestamptz, now()),
        $9, $10
      )
      RETURNING *
      `,
      [
        tenantId,
        body.purchase_order_id,
        receiptNumber,
        receiptStatus,
        body.courier_name || null,
        body.awb_number || null,
        body.tracking_url || null,
        body.received_at || null,
        userId,
        body.remarks || null,
      ],
    );

    const receipt = receiptResult.rows[0];

    for (const item of body.items) {
      const poItemResult = await client.query(
        `
  SELECT
    poi.id,
    COALESCE(poi.quantity, 0)::numeric AS ordered_qty
  FROM purchase_order_items poi
  INNER JOIN purchase_orders po
    ON po.id = poi.purchase_order_id
  WHERE po.tenant_id = $1
    AND poi.purchase_order_id = $2
    AND poi.id = $3
  LIMIT 1
  `,
        [tenantId, body.purchase_order_id, item.purchase_order_item_id],
      );

      const poItem = poItemResult.rows[0];

      if (!poItem) {
        throw new Error(
          `Purchase order item not found: ${item.purchase_order_item_id}`,
        );
      }

      const orderedQty = Number(poItem.ordered_qty || 0);
      const receivedQty = Number(item.received_qty || 0);
      const damagedQty = Number(item.damaged_qty || 0);

      const pendingQty = Math.max(orderedQty - receivedQty - damagedQty, 0);

      await client.query(
        `
        INSERT INTO warehouse_receipt_items
(
  tenant_id,
  receipt_id,
  purchase_order_item_id,
  ordered_qty,
  received_qty,
  damaged_qty,
  pending_qty,
  remarks
)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `,
        [
          tenantId,
          receipt.id,
          item.purchase_order_item_id,
          orderedQty,
          receivedQty,
          damagedQty,
          pendingQty,
          item.remarks || null,
        ],
      );
    }

    const totalStatusResult = await client.query(
      `
  SELECT
    COALESCE(SUM(poi.quantity), 0)::numeric AS ordered_qty,
    COALESCE(SUM(wri.received_qty), 0)::numeric AS received_qty,
    COALESCE(SUM(wri.damaged_qty), 0)::numeric AS damaged_qty
  FROM purchase_order_items poi
  INNER JOIN purchase_orders po
    ON po.id = poi.purchase_order_id
  LEFT JOIN (
    SELECT
      purchase_order_item_id,
      SUM(received_qty) AS received_qty,
      SUM(damaged_qty) AS damaged_qty
    FROM warehouse_receipt_items
    WHERE tenant_id = $1
    GROUP BY purchase_order_item_id
  ) wri ON wri.purchase_order_item_id = poi.id
  WHERE po.tenant_id = $1
    AND poi.purchase_order_id = $2
  `,
      [tenantId, body.purchase_order_id],
    );

    const orderedQty = Number(totalStatusResult.rows[0]?.ordered_qty || 0);
    const receivedQty = Number(totalStatusResult.rows[0]?.received_qty || 0);
    const damagedQty = Number(totalStatusResult.rows[0]?.damaged_qty || 0);

    const processedQty = receivedQty + damagedQty;

    const poStatus =
      orderedQty > 0 && processedQty >= orderedQty
        ? "received"
        : processedQty > 0
          ? "partially_received"
          : "pending_receive";

    const poUpdateResult = await client.query(
      `
      UPDATE purchase_orders
      SET status = $1, updated_at = now()
      WHERE tenant_id = $2 AND id = $3
      RETURNING id, status
      `,
      [poStatus, tenantId, body.purchase_order_id],
    );

    if (poUpdateResult.rowCount === 0) {
      throw new Error("Purchase order not found or tenant mismatch");
    }

    const receiptItemsResult = await client.query(
      `
      SELECT *
      FROM warehouse_receipt_items
      WHERE tenant_id = $1
        AND receipt_id = $2
      ORDER BY created_at ASC
      `,
      [tenantId, receipt.id],
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "Purchase order received successfully",
      data: {
        ...receipt,
        items: receiptItemsResult.rows,
        purchase_order_status: poUpdateResult.rows[0]?.status,
      },
      statusCode: 201,
      success: true,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("createPoReceiptHandler error", error);

    res.status(500).json({
      message:
        error instanceof Error
          ? error.message
          : "Failed to receive purchase order",
      statusCode: 500,
      success: false,
    });
  } finally {
    client.release();
  }
}

export async function createSoDispatchHandler(req: Request, res: Response) {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const body = CreateSoDispatchSchema.parse(req.body);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const dispatchNumber = await generateNumber(
      client,
      tenantId,
      "warehouse_dispatches",
      "dispatch_number",
      "WD",
    );

    const dispatchResult = await client.query(
      `
      INSERT INTO warehouse_dispatches
      (
        tenant_id,
        sales_order_id,
        dispatch_number,
        status,
        courier_name,
        awb_number,
        tracking_url,
        dispatched_at,
        dispatched_by,
        delivery_expected_at,
        remarks
      )
      VALUES
      (
        $1, $2, $3, 'dispatched',
        $4, $5, $6,
        COALESCE($7::timestamptz, now()),
        $8,
        $9,
        $10
      )
      RETURNING *
      `,
      [
        tenantId,
        body.sales_order_id,
        dispatchNumber,
        body.courier_name,
        body.awb_number,
        body.tracking_url,
        body.dispatched_at,
        userId,
        body.delivery_expected_at,
        body.remarks,
      ],
    );

    const dispatch = dispatchResult.rows[0];

    for (const item of body.items) {
      const orderedQty = Number(item.ordered_qty || 0);
      const dispatchedQty = Number(item.dispatched_qty || 0);
      const pendingQty = Math.max(orderedQty - dispatchedQty, 0);

      await client.query(
        `
        INSERT INTO warehouse_dispatch_items
        (
          tenant_id,
          dispatch_id,
          sales_order_item_id,
          product_id,
          ordered_qty,
          dispatched_qty,
          pending_qty,
          remarks
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `,
        [
          tenantId,
          dispatch.id,
          item.sales_order_item_id || null,
          item.product_id || null,
          orderedQty,
          dispatchedQty,
          pendingQty,
          item.remarks || null,
        ],
      );
    }

    const totalStatusResult = await client.query(
      `
      SELECT
        COALESCE(SUM(soi.quantity), 0)::numeric AS ordered_qty,
        COALESCE(SUM(wdi.dispatched_qty), 0)::numeric AS dispatched_qty
      FROM sales_order_items soi
      LEFT JOIN (
        SELECT
          sales_order_item_id,
          SUM(dispatched_qty) AS dispatched_qty
        FROM warehouse_dispatch_items
        WHERE tenant_id = $1
        GROUP BY sales_order_item_id
      ) wdi ON wdi.sales_order_item_id = soi.id
      WHERE soi.sales_order_id = $2
      `,
      [tenantId, body.sales_order_id],
    );

    const orderedQty = Number(totalStatusResult.rows[0]?.ordered_qty || 0);
    const dispatchedQty = Number(
      totalStatusResult.rows[0]?.dispatched_qty || 0,
    );

    const soStatus =
      orderedQty > 0 && dispatchedQty >= orderedQty
        ? "dispatched"
        : dispatchedQty > 0
          ? "partially_dispatched"
          : "ready_to_dispatch";

    await client.query(
      `
      UPDATE sales_orders
      SET status = $1, updated_at = now()
      WHERE tenant_id = $2 AND id = $3
      `,
      [soStatus, tenantId, body.sales_order_id],
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "Sales order dispatched successfully",
      data: dispatch,
      success: true,
      statusCode: 201,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("createSoDispatchHandler error", error);
    res.status(500).json({
      message: "Failed to dispatch sales order",
      success: false,
      statusCode: 500,
    });
  } finally {
    client.release();
  }
}

export async function updateReceiptStatusHandler(req: Request, res: Response) {
  const tenantId = getTenantId(req);
  const body = UpdateWarehouseStatusSchema.parse(req.body);

  const { rows } = await pool.query(
    `
    UPDATE warehouse_receipts
    SET
      status = $1,
      remarks = COALESCE($2, remarks),
      updated_at = now()
    WHERE tenant_id = $3 AND id = $4
    RETURNING *
    `,
    [body.status, body.remarks, tenantId, req.params.id],
  );

  if (!rows[0]) {
    return res.status(404).json({ message: "Receipt not found" });
  }

  res.json({ message: "Receipt status updated", data: rows[0] });
}

export async function updateDispatchStatusHandler(req: Request, res: Response) {
  const tenantId = getTenantId(req);
  const body = UpdateWarehouseStatusSchema.parse(req.body);

  const { rows } = await pool.query(
    `
    UPDATE warehouse_dispatches
    SET
      status = $1,
      remarks = COALESCE($2, remarks),
      delivered_at = CASE WHEN $1 = 'delivered' THEN now() ELSE delivered_at END,
      updated_at = now()
    WHERE tenant_id = $3 AND id = $4
    RETURNING *
    `,
    [body.status, body.remarks, tenantId, req.params.id],
  );

  if (!rows[0]) {
    return res.status(404).json({ message: "Dispatch not found" });
  }

  res.json({ message: "Dispatch status updated", data: rows[0] });
}
