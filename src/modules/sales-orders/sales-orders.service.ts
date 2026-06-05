import { Request, Response } from "express";
import { getUserIdFromRequest } from "../../common/tallyAccess";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";
import {
  CreateSalesOrderSchema,
  SalesOrderListQuerySchema,
  UpdateSalesOrderSchema,
} from "./sales-orders.schema";

const toNumber = (value: any) => {
  if (value === undefined || value === null || value === "") return 0;

  const cleaned = String(value)
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "");
  const num = Number(cleaned);

  return Number.isFinite(num) ? num : 0;
};

const calculateItemAmount = (item: any) => {
  const qty = toNumber(item.quantity);
  const rate = toNumber(item.price || item.rate);
  return qty * rate;
};

const getRawNumber = (raw: any, keys: string[]) => {
  for (const key of keys) {
    const value = raw?.[key];

    if (value !== undefined && value !== null && value !== "") {
      return toNumber(value);
    }
  }

  return 0;
};

const normalizeSalesOrderNumberDisplay = (value: any) => {
  if (value === undefined || value === null) return value;
  const text = String(value).trim();
  if (!text) return text;

  const normalized = text.toUpperCase();
  const crmStyleMatch = normalized.match(/^SO-(\d+)$/);
  if (crmStyleMatch) {
    return `SO-${crmStyleMatch[1].padStart(7, "0")}`;
  }

  if (/^\d+$/.test(normalized)) {
    return `SO-${normalized.padStart(7, "0")}`;
  }

  return text;
};

const buildSalesOrderTotals = (order: any, items: any[]) => {
  const raw = order.raw_tally_data || {};

  const itemSubtotal = items.reduce((sum, item) => {
    const amount = toNumber(item.amount);

    if (amount) return sum + amount;

    return sum + toNumber(item.quantity) * toNumber(item.rate || item.price);
  }, 0);

  const grandTotal = toNumber(
    order.grand_total ||
      order.total_amount ||
      raw.totalAmount ||
      raw.grandTotal,
  );

  const rawSubtotal = getRawNumber(raw, ["subtotal", "subTotal"]);
  const rawDiscount = getRawNumber(raw, ["discount", "discountAmount"]);
  const rawTax = getRawNumber(raw, ["tax", "taxAmount", "gstAmount"]);
  const rawShipping = getRawNumber(raw, ["shipping", "shippingAmount"]);

  const subtotal = rawSubtotal || itemSubtotal;
  const discount = rawDiscount;
  const shipping = rawShipping;

  // Tally me tax separate nahi aa raha to grand_total - item subtotal se derive karenge
  const derivedTax =
    grandTotal > subtotal ? grandTotal - subtotal + discount - shipping : 0;

  const tax = rawTax || derivedTax;

  return {
    subtotal,
    discount,
    tax,
    shipping,
    grand_total: grandTotal,
    total_payable: grandTotal,
  };
};

const resolveProductForItem = async (
  client: any,
  tenantId: string,
  item: any,
) => {
  if (!item.product_id) {
    return {
      itemName: item.product_name || item.item_name || "",
      itemCode: item.sku || item.item_code || "",
      rate: Number(item.price || item.rate || 0),
    };
  }

  const productResult = await client.query(
    `
    SELECT *
    FROM products
    WHERE id = $1 AND tenant_id = $2
    LIMIT 1
    `,
    [item.product_id, tenantId],
  );

  const product = productResult.rows[0] || {};

  return {
    itemName:
      item.product_name ||
      item.item_name ||
      product.name ||
      product.product_name ||
      product.item_name ||
      "",
    itemCode:
      item.sku ||
      item.item_code ||
      product.sku ||
      product.item_code ||
      product.code ||
      "",
    rate: Number(
      item.price ||
        item.rate ||
        product.price ||
        product.selling_price ||
        product.sales_price ||
        product.rate ||
        0,
    ),
  };
};

const generateSalesOrderNumber = async (client: any) => {
  const result = await client.query(`
    SELECT 'SO-' || LPAD(nextval('sales_order_number_seq')::TEXT, 7, '0') AS voucher_number
  `);

  return result.rows[0].voucher_number;
};

const assertSalesOrderAccess = async (
  client: any,
  input: {
    tenantId: string;
    userId: string;
    salesOrderId: string;
  },
) => {
  const values: any[] = [input.tenantId, input.salesOrderId];

  const where: string[] = [
    "so.tenant_id = $1",
    "so.id = $2",
    "so.deleted_at IS NULL",
  ];

  // addTallyRecordAccessFilter({
  //   where,
  //   values,
  //   userId: input.userId,
  //   recordAlias: "so",
  //   costCenterExpression: "so.cost_center_id",
  //   tallyCompanyId: null,
  // });

  const result = await client.query(
    `
    SELECT so.id
    FROM sales_orders so
    WHERE ${where.join(" AND ")}
    LIMIT 1
    `,
    values,
  );

  return Boolean(result.rowCount);
};

export const getSalesOrdersHandler = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const userId = getUserIdFromRequest(req as any);
    const query = SalesOrderListQuerySchema.parse(req.query);

    const tallyCompanyId = req.query.tally_company_id
      ? String(req.query.tally_company_id)
      : "";

    const costCenterId = req.query.cost_center_id
      ? String(req.query.cost_center_id)
      : "";

    const values: any[] = [tenantId];

    const whereParts: string[] = ["so.tenant_id = $1", "so.deleted_at IS NULL"];

    if (query.search) {
      values.push(`%${query.search}%`);
      whereParts.push(`
        (
          so.voucher_number ILIKE $${values.length}
          OR so.customer_name ILIKE $${values.length}
          OR o.name ILIKE $${values.length}
          OR so.tally_company_name ILIKE $${values.length}
          OR so.cost_center_name ILIKE $${values.length}
        )
      `);
    }

    if (query.status) {
      values.push(query.status);
      whereParts.push(`so.status = $${values.length}`);
    }

    if (query.customer_id) {
      values.push(query.customer_id);
      whereParts.push(`so.organization_id = $${values.length}`);
    }

    if (query.assigned_to) {
      values.push(query.assigned_to);
      whereParts.push(`so.assigned_to = $${values.length}`);
    }

    if (query.from_date) {
      values.push(query.from_date);
      whereParts.push(`so.voucher_date >= $${values.length}`);
    }

    if (query.to_date) {
      values.push(query.to_date);
      whereParts.push(`so.voucher_date <= $${values.length}`);
    }

    if (costCenterId) {
      values.push(costCenterId);
      whereParts.push(`so.cost_center_id = $${values.length}::uuid`);
    }

    // addTallyRecordAccessFilter({
    //   where: whereParts,
    //   values,
    //   userId,
    //   recordAlias: "so",
    //   costCenterExpression: "so.cost_center_id",
    //   tallyCompanyId: tallyCompanyId || null,
    // });

    values.push(query.limit);
    const limitIndex = values.length;

    values.push(query.offset);
    const offsetIndex = values.length;

    const result = await pool.query(
      `
      SELECT
        so.*,
        so.voucher_number AS so_number,
        so.voucher_date AS so_date,
        so.quote_id,
        so.total_amount AS grand_total,
        so.raw_tally_data->>'expected_delivery_date' AS expected_delivery_date,
        COALESCE(o.name, so.customer_name) AS customer_name,
        u.name AS assigned_to_name,
        COUNT(*) OVER()::int AS total_count
      FROM sales_orders so
      LEFT JOIN organizations o
        ON o.id = so.organization_id
       AND o.tenant_id = so.tenant_id
      LEFT JOIN quotes q
        ON q.id = so.quote_id
       AND q.tenant_id = so.tenant_id
      LEFT JOIN users u
        ON u.id = so.assigned_to
      WHERE ${whereParts.join(" AND ")}
      ORDER BY so.created_at DESC
      LIMIT $${limitIndex}
      OFFSET $${offsetIndex}
      `,
      values,
    );

    const rows = result.rows.map((row) => ({
      ...row,
      voucher_number: normalizeSalesOrderNumberDisplay(row.voucher_number),
      so_number: normalizeSalesOrderNumberDisplay(row.so_number),
    }));

    res.json({
      statusCode: 200,
      message: "Sales orders fetched successfully",
      data: rows,
      total: rows[0]?.total_count || 0,
      limit: query.limit,
      offset: query.offset,
      filters: {
        tally_company_id: tallyCompanyId || null,
        cost_center_id: costCenterId || null,
      },
    });
  } catch (error: any) {
    res.status(400).json({
      statusCode: 400,
      message: error.message || "Failed to fetch sales orders",
      data: null,
    });
  }
};

export const getSalesOrderByIdHandler = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const userId = getUserIdFromRequest(req as any);
    const { id } = req.params;

    const values: any[] = [tenantId, id];

    const whereParts: string[] = [
      "so.tenant_id = $1",
      "so.id = $2",
      "so.deleted_at IS NULL",
    ];

    // addTallyRecordAccessFilter({
    //   where: whereParts,
    //   values,
    //   userId,
    //   recordAlias: "so",
    //   costCenterExpression: "so.cost_center_id",
    //   tallyCompanyId: null,
    // });

    const orderResult = await pool.query(
      `
      SELECT
        so.*,
        so.voucher_number AS so_number,
        so.voucher_date AS so_date,
        so.total_amount AS grand_total,
        so.raw_tally_data->>'expected_delivery_date' AS expected_delivery_date,
        COALESCE(o.name, so.customer_name) AS customer_name,
        u.name AS assigned_to_name
      FROM sales_orders so
      LEFT JOIN organizations o
        ON o.id = so.organization_id
       AND o.tenant_id = so.tenant_id
      LEFT JOIN users u
        ON u.id = so.assigned_to
      WHERE ${whereParts.join(" AND ")}
      `,
      values,
    );

    if (!orderResult.rows.length) {
      return res.status(404).json({
        statusCode: 404,
        message: "Sales order not found",
        data: null,
      });
    }

    const itemsResult = await pool.query(
      `
      SELECT
        soi.*,
        soi.item_name AS product_name,
        soi.item_code AS sku,
        soi.rate AS price,
        soi.description AS item_description
      FROM sales_order_items soi
      WHERE soi.sales_order_id = $1
        AND soi.tenant_id = $2
      ORDER BY soi.id ASC
      `,
      [id, tenantId],
    );

    const order = orderResult.rows[0];
    const items = itemsResult.rows;
    const totals = buildSalesOrderTotals(order, items);

    res.json({
      statusCode: 200,
      message: "Sales order fetched successfully",
      data: {
        ...order,
        voucher_number: normalizeSalesOrderNumberDisplay(order.voucher_number),
        so_number: normalizeSalesOrderNumberDisplay(order.so_number),
        ...totals,
        expected_delivery_date:
          order.expected_delivery_date ||
          order.raw_tally_data?.expected_delivery_date ||
          null,
        currency: order.raw_tally_data?.currency || order.currency || "₹",
        notes: order.raw_tally_data?.notes || order.notes || null,
        terms: order.raw_tally_data?.terms || order.terms || null,
        items,
      },
    });
  } catch (error: any) {
    res.status(400).json({
      statusCode: 400,
      message: error.message || "Failed to fetch sales order",
      data: null,
    });
  }
};

export const createSalesOrderHandler = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const tenantId = getTenantId(req);
    const userId = (req as any).user?.sub || (req as any).user?.id || null;
    const payload = CreateSalesOrderSchema.parse(req.body);

    await client.query("BEGIN");

    const voucherNumber = await generateSalesOrderNumber(client);

    const customerResult = await client.query(
      `
      SELECT name, gst_number
      FROM organizations
      WHERE id = $1 AND tenant_id = $2
      `,
      [payload.customer_id, tenantId],
    );

    const customerName = customerResult.rows[0]?.name || null;
    const customerGst = customerResult.rows[0]?.gst_number || null;

    const totalAmount =
      payload.grand_total ??
      payload.items.reduce(
        (sum: number, item: any) => sum + calculateItemAmount(item),
        0,
      );

    const orderResult = await client.query(
      `
      INSERT INTO sales_orders (
  tenant_id,
  voucher_number,
  voucher_date,
  customer_name,
  customer_gst,
  reference_number,
  total_amount,
  status,
  raw_tally_data,
  customer_id,
  organization_id,
  contact_id,
  assigned_to,
  quote_id,
  source,
  sync_status
)
VALUES (
   $1,$2,COALESCE($3::date, CURRENT_DATE),$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13,$14,$15
)
      RETURNING
        *,
        voucher_number AS so_number,
        voucher_date AS so_date,
        total_amount AS grand_total
      `,
      [
        tenantId,
        voucherNumber,
        payload.so_date || null,
        customerName,
        customerGst,
        payload.reference_number || null,
        totalAmount,
        payload.status || "draft",
        JSON.stringify({
          source: "crm",
          expected_delivery_date: payload.expected_delivery_date || null,
          currency: payload.currency || "INR",
          subtotal: payload.subtotal || totalAmount,
          discount: payload.discount || 0,
          tax: payload.tax || 0,
          shipping: payload.shipping || 0,
          notes: payload.notes || null,
          terms: payload.terms || null,
          created_by: userId,
        }),
        payload.customer_id,
        payload.contact_id || null,
        payload.assigned_to || null,
        payload.quote_id || null,
        payload.source || "crm",
        payload.sync_status || "pending",
      ],
    );

    const salesOrder = orderResult.rows[0];

    for (const item of payload.items) {
      const productInfo = await resolveProductForItem(client, tenantId, item);
      const normalizedItem = {
        ...item,
        price: productInfo.rate,
      };

      const amount = calculateItemAmount(normalizedItem);

      await client.query(
        `
    INSERT INTO sales_order_items (
      tenant_id,
      sales_order_id,
      item_name,
      item_code,
      description,
      quantity,
      rate,
      amount,
      unit,
      raw_tally_data
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `,
        [
          tenantId,
          salesOrder.id,
          productInfo.itemName,
          productInfo.itemCode,
          item.description || null,
          item.quantity,
          productInfo.rate,
          amount,
          item.unit || "Nos",
          JSON.stringify({
            source: "crm",
            product_id: item.product_id || null,
            discount: item.discount || 0,
            tax: item.tax || 0,
          }),
        ],
      );
    }

    await client.query("COMMIT");

    res.status(201).json({
      message: "Sales order created successfully",
      data: {
        ...salesOrder,
        voucher_number: normalizeSalesOrderNumberDisplay(
          salesOrder.voucher_number,
        ),
        so_number: normalizeSalesOrderNumberDisplay(salesOrder.so_number),
      },
    });
  } catch (error: any) {
    await client.query("ROLLBACK");

    res.status(400).json({
      message: error.message || "Failed to create sales order",
    });
  } finally {
    client.release();
  }
};

export const updateSalesOrderHandler = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const tenantId = getTenantId(req);
    const userId = (req as any).user?.sub || (req as any).user?.id || null;
    const { id } = req.params;
    const accessUserId = getUserIdFromRequest(req as any);
    const payload = UpdateSalesOrderSchema.parse(req.body);

    await client.query("BEGIN");
    const hasAccess = await assertSalesOrderAccess(client, {
      tenantId,
      userId: accessUserId,
      salesOrderId: id,
    });

    if (!hasAccess) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        statusCode: 404,
        message: "Sales order not found",
        data: null,
      });
    }

    const existingResult = await client.query(
      `
      SELECT *
      FROM sales_orders
      WHERE id = $1
        AND tenant_id = $2
        AND deleted_at IS NULL
      `,
      [id, tenantId],
    );

    if (!existingResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Sales order not found" });
    }

    let customerName = existingResult.rows[0].customer_name;
    let customerGst = existingResult.rows[0].customer_gst;

    if (payload.customer_id) {
      const customerResult = await client.query(
        `
        SELECT name, gst_number
        FROM organizations
        WHERE id = $1 AND tenant_id = $2
        `,
        [payload.customer_id, tenantId],
      );

      customerName = customerResult.rows[0]?.name || customerName;
      customerGst = customerResult.rows[0]?.gst_number || customerGst;
    }

    const totalAmount =
      payload.grand_total ??
      payload.items?.reduce(
        (sum: number, item: any) => sum + calculateItemAmount(item),
        0,
      ) ??
      existingResult.rows[0].total_amount;

    const updatedResult = await client.query(
      `
      UPDATE sales_orders
      SET
        voucher_date = COALESCE($1::date, voucher_date),
        customer_name = COALESCE($2, customer_name),
        customer_gst = COALESCE($3, customer_gst),
        reference_number = $4,
        total_amount = COALESCE($5, total_amount),
        status = COALESCE($6, status),
        raw_tally_data = COALESCE($7::jsonb, raw_tally_data),
        customer_id = COALESCE($8, customer_id),
        organization_id = COALESCE($8, organization_id),
        contact_id = $9,
        assigned_to = $10,
        updated_at = NOW()
      WHERE id = $11 AND tenant_id = $12
      RETURNING
        *,
        voucher_number AS so_number,
        voucher_date AS so_date,
        total_amount AS grand_total
      `,
      [
        payload.so_date || null,
        customerName,
        customerGst,
        payload.reference_number ||
          existingResult.rows[0].reference_number ||
          null,
        totalAmount,
        payload.status || null,
        JSON.stringify({
          ...(existingResult.rows[0].raw_tally_data || {}),
          source: "crm",
          expected_delivery_date: payload.expected_delivery_date || null,
          currency: payload.currency || "INR",
          subtotal: payload.subtotal || totalAmount,
          discount: payload.discount || 0,
          tax: payload.tax || 0,
          shipping: payload.shipping || 0,
          notes: payload.notes || null,
          terms: payload.terms || null,
          updated_by: userId,
        }),
        payload.customer_id || null,
        payload.contact_id ?? null,
        payload.assigned_to ?? null,
        id,
        tenantId,
      ],
    );

    if (payload.items) {
      await client.query(
        `DELETE FROM sales_order_items WHERE sales_order_id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );

      for (const item of payload.items) {
        const productInfo = await resolveProductForItem(client, tenantId, item);
        const normalizedItem = {
          ...item,
          price: productInfo.rate,
        };

        const amount = calculateItemAmount(normalizedItem);

        await client.query(
          `
    INSERT INTO sales_order_items (
      tenant_id,
      sales_order_id,
      item_name,
      item_code,
      description,
      quantity,
      rate,
      amount,
      unit,
      raw_tally_data
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `,
          [
            tenantId,
            id,
            productInfo.itemName,
            productInfo.itemCode,
            item.description || null,
            item.quantity,
            productInfo.rate,
            amount,
            item.unit || "Nos",
            JSON.stringify({
              source: "crm",
              product_id: item.product_id || null,
              discount: item.discount || 0,
              tax: item.tax || 0,
            }),
          ],
        );
      }
    }

    await client.query("COMMIT");

    res.json({
      message: "Sales order updated successfully",
      data: {
        ...updatedResult.rows[0],
        voucher_number: normalizeSalesOrderNumberDisplay(
          updatedResult.rows[0]?.voucher_number,
        ),
        so_number: normalizeSalesOrderNumberDisplay(
          updatedResult.rows[0]?.so_number,
        ),
      },
    });
  } catch (error: any) {
    await client.query("ROLLBACK");

    res.status(400).json({
      message: error.message || "Failed to update sales order",
    });
  } finally {
    client.release();
  }
};

export const deleteSalesOrderHandler = async (req: Request, res: Response) => {
  const client = await pool.connect();

  try {
    const tenantId = getTenantId(req);
    const userId = getUserIdFromRequest(req as any);
    const { id } = req.params;

    await client.query("BEGIN");

    const hasAccess = await assertSalesOrderAccess(client, {
      tenantId,
      userId,
      salesOrderId: id,
    });

    if (!hasAccess) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        statusCode: 404,
        message: "Sales order not found",
        data: null,
      });
    }

    const result = await client.query(
      `
      UPDATE sales_orders
      SET deleted_at = NOW()
      WHERE id = $1
        AND tenant_id = $2
        AND deleted_at IS NULL
      RETURNING id
      `,
      [id, tenantId],
    );

    await client.query("COMMIT");

    if (!result.rows.length) {
      return res.status(404).json({
        statusCode: 404,
        message: "Sales order not found",
        data: null,
      });
    }

    res.json({
      statusCode: 200,
      message: "Sales order deleted successfully",
      data: {
        id,
      },
    });
  } catch (error: any) {
    await client.query("ROLLBACK");

    res.status(400).json({
      statusCode: 400,
      message: error.message || "Failed to delete sales order",
      data: null,
    });
  } finally {
    client.release();
  }
};
