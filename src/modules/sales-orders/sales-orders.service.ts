import { Request, Response } from "express";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";
import {
  CreateSalesOrderSchema,
  SalesOrderListQuerySchema,
  UpdateSalesOrderSchema,
} from "./sales-orders.schema";

const toNumber = (value: any) => Number(value || 0);

const calculateItemAmount = (item: any) => {
  const qty = toNumber(item.quantity);
  const rate = toNumber(item.price || item.rate);
  return qty * rate;
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

export const getSalesOrdersHandler = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const query = SalesOrderListQuerySchema.parse(req.query);

    const values: any[] = [tenantId];
    let index = 2;

    let where = `WHERE so.tenant_id = $1 AND so.deleted_at IS NULL`;

    if (query.search) {
      values.push(`%${query.search}%`);
      where += ` AND (
        so.voucher_number ILIKE $${index}
        OR so.customer_name ILIKE $${index}
        OR o.name ILIKE $${index}
      )`;
      index++;
    }

    if (query.status) {
      values.push(query.status);
      where += ` AND so.status = $${index}`;
      index++;
    }

    if (query.customer_id) {
      values.push(query.customer_id);
      where += ` AND so.organization_id = $${index}`;
      index++;
    }

    if (query.assigned_to) {
      values.push(query.assigned_to);
      where += ` AND so.assigned_to = $${index}`;
      index++;
    }

    if (query.from_date) {
      values.push(query.from_date);
      where += ` AND so.voucher_date >= $${index}`;
      index++;
    }

    if (query.to_date) {
      values.push(query.to_date);
      where += ` AND so.voucher_date <= $${index}`;
      index++;
    }

    values.push(query.limit);
    const limitIndex = index++;

    values.push(query.offset);
    const offsetIndex = index;

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
      LEFT JOIN organizations o ON o.id = so.organization_id AND o.tenant_id = so.tenant_id
      LEFT JOIN quotes q ON q.id = so.quote_id AND q.tenant_id = so.tenant_id
      LEFT JOIN users u ON u.id = so.assigned_to
      ${where}
      ORDER BY so.created_at DESC
      LIMIT $${limitIndex}
      OFFSET $${offsetIndex}
      `,
      values,
    );

    res.json({
      message: "Sales orders fetched successfully",
      data: result.rows,
      total: result.rows[0]?.total_count || 0,
      limit: query.limit,
      offset: query.offset,
    });
  } catch (error: any) {
    res.status(400).json({
      message: error.message || "Failed to fetch sales orders",
    });
  }
};

export const getSalesOrderByIdHandler = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;

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
      LEFT JOIN organizations o ON o.id = so.organization_id AND o.tenant_id = so.tenant_id
      LEFT JOIN users u ON u.id = so.assigned_to
      WHERE so.id = $1
        AND so.tenant_id = $2
        AND so.deleted_at IS NULL
      `,
      [id, tenantId],
    );

    if (!orderResult.rows.length) {
      return res.status(404).json({ message: "Sales order not found" });
    }

    const itemsResult = await pool.query(
      `
      SELECT
        soi.*,
        soi.item_name AS product_name,
        soi.item_code AS sku,
        soi.rate AS price
      FROM sales_order_items soi
      WHERE soi.sales_order_id = $1
        AND soi.tenant_id = $2
      ORDER BY soi.id ASC
      `,
      [id, tenantId],
    );

    res.json({
      message: "Sales order fetched successfully",
      data: {
        ...orderResult.rows[0],
        items: itemsResult.rows,
      },
    });
  } catch (error: any) {
    res.status(400).json({
      message: error.message || "Failed to fetch sales order",
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
  quote_id
)
VALUES (
  $1,$2,COALESCE($3::date, CURRENT_DATE),$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13
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
      quantity,
      rate,
      amount,
      unit,
      raw_tally_data
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `,
        [
          tenantId,
          salesOrder.id,
          productInfo.itemName,
          productInfo.itemCode,
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
      data: salesOrder,
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
    const payload = UpdateSalesOrderSchema.parse(req.body);

    await client.query("BEGIN");

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
      quantity,
      rate,
      amount,
      unit,
      raw_tally_data
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `,
          [
            tenantId,
            id,
            productInfo.itemName,
            productInfo.itemCode,
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
      data: updatedResult.rows[0],
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
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;

    const result = await pool.query(
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

    if (!result.rows.length) {
      return res.status(404).json({ message: "Sales order not found" });
    }

    res.json({
      message: "Sales order deleted successfully",
    });
  } catch (error: any) {
    res.status(400).json({
      message: error.message || "Failed to delete sales order",
    });
  }
};
