import { Request, Response } from "express";
import { pool } from "../../db/pool";
import {
  CreateDeliveryChallanSchema,
  ListDeliveryChallansQuerySchema,
  UpdateDeliveryChallanSchema,
} from "./deliveryChallans.schema";

type UserContextRequest = Request & {
  user?: {
    id?: string;
    tenantId?: string;
  };
};

function getTenantId(req: UserContextRequest) {
  return req.user?.tenantId || req.headers["x-tenant-id"]?.toString();
}

function getUserId(req: UserContextRequest) {
  return req.user?.id || null;
}

function toNumber(value: any) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

async function generateDeliveryChallanNumber(client: any, tenantId: string) {
  const result = await client.query(
    `SELECT nextval('delivery_challan_number_seq') AS seq`,
  );
  const seq = String(result.rows[0].seq).padStart(5, "0");
  return `DC-${seq}`;
}

function calculateTotals(items: any[], discountPercent = 0, adjustment = 0) {
  const subtotal = items.reduce((sum, item) => {
    const quantity = toNumber(item.quantity);
    const rate = toNumber(item.rate);
    const discount = toNumber(item.discount);
    return sum + Math.max(quantity * rate - discount, 0);
  }, 0);

  const taxAmount = items.reduce((sum, item) => {
    return sum + toNumber(item.cgst) + toNumber(item.sgst);
  }, 0);

  const discountAmount = (subtotal * toNumber(discountPercent)) / 100;
  const total = subtotal + taxAmount - discountAmount + toNumber(adjustment);

  return {
    subtotal,
    discount_amount: discountAmount,
    total,
  };
}

function calculateItem(item: any) {
  const quantity = toNumber(item.quantity);
  const rate = toNumber(item.rate);
  const discount = toNumber(item.discount);
  const tax = toNumber(item.tax);

  const taxableAmount = Math.max(quantity * rate - discount, 0);
  const gstAmount = (taxableAmount * tax) / 100;

  return {
    ...item,
    quantity,
    rate,
    discount,
    tax,
    cgst: gstAmount / 2,
    sgst: gstAmount / 2,
    amount: taxableAmount + gstAmount,
  };
}

export async function listDeliveryChallansHandler(
  req: UserContextRequest,
  res: Response,
) {
  const tenantId = getTenantId(req);

  if (!tenantId) {
    return res.status(401).json({ message: "Unauthorized: tenantId missing" });
  }

  const query = ListDeliveryChallansQuerySchema.parse(req.query);
  const offset = (query.page - 1) * query.limit;

  const params: any[] = [tenantId];
  let where = `dc.tenant_id = $1 AND dc.deleted_at IS NULL`;

  if (query.search) {
    params.push(`%${query.search}%`);
    where += ` AND (
      dc.challan_number ILIKE $${params.length}
      OR dc.customer_name ILIKE $${params.length}
      OR dc.reference_no ILIKE $${params.length}
    )`;
  }

  if (query.status) {
    params.push(query.status);
    where += ` AND dc.status = $${params.length}`;
  }

  const countResult = await pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM delivery_challans dc
      WHERE ${where}
    `,
    params,
  );

  params.push(query.limit);
  params.push(offset);

  const result = await pool.query(
    `
      SELECT
        dc.id,
        dc.challan_number,
        dc.reference_no,
        dc.customer_id,
        dc.customer_name,
        dc.customer_email,
        dc.customer_phone,
        dc.challan_date,
        dc.challan_type,
        dc.subtotal,
        dc.discount_percent,
        dc.discount_amount,
        dc.adjustment,
        dc.total,
        dc.status,
        dc.created_at,
        dc.updated_at
      FROM delivery_challans dc
      WHERE ${where}
      ORDER BY dc.created_at DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `,
    params,
  );

  return res.json({
    data: result.rows,
    meta: {
      page: query.page,
      limit: query.limit,
      total: countResult.rows[0]?.total || 0,
    },
  });
}

export async function getDeliveryChallanByIdHandler(
  req: UserContextRequest,
  res: Response,
) {
  const tenantId = getTenantId(req);
  const { id } = req.params;

  if (!tenantId) {
    return res.status(401).json({ message: "Unauthorized: tenantId missing" });
  }

  const challanResult = await pool.query(
    `
      SELECT *
      FROM delivery_challans
      WHERE tenant_id = $1
        AND id = $2
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [tenantId, id],
  );

  if (!challanResult.rows.length) {
    return res.status(404).json({ message: "Delivery challan not found" });
  }

  const itemsResult = await pool.query(
    `
      SELECT *
      FROM delivery_challan_items
      WHERE tenant_id = $1
        AND delivery_challan_id = $2
      ORDER BY created_at ASC
    `,
    [tenantId, id],
  );

  return res.json({
    data: {
      ...challanResult.rows[0],
      items: itemsResult.rows,
    },
  });
}

export async function createDeliveryChallanHandler(
  req: UserContextRequest,
  res: Response,
) {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);

  if (!tenantId) {
    return res.status(401).json({ message: "Unauthorized: tenantId missing" });
  }

  const payload = CreateDeliveryChallanSchema.parse(req.body);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const challanNumber = await generateDeliveryChallanNumber(client, tenantId);
    const calculatedItems = payload.items.map(calculateItem);

    const totals = calculateTotals(
      calculatedItems,
      payload.discount_percent,
      payload.adjustment,
    );

    const challanResult = await client.query(
      `
        INSERT INTO delivery_challans (
          tenant_id,
          challan_number,
          reference_no,
          customer_id,
          customer_name,
          customer_email,
          customer_phone,
          challan_date,
          challan_type,
          notes,
          subtotal,
          discount_percent,
          discount_amount,
          adjustment,
          total,
          status,
          created_by,
          updated_by
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17,$18
        )
        RETURNING *
      `,
      [
        tenantId,
        challanNumber,
        payload.reference_no,
        payload.customer_id,
        payload.customer_name,
        payload.customer_email,
        payload.customer_phone,
        payload.challan_date,
        payload.challan_type,
        payload.notes,
        totals.subtotal,
        payload.discount_percent,
        totals.discount_amount,
        payload.adjustment,
        totals.total,
        payload.status || "draft",
        userId,
        userId,
      ],
    );

    const challan = challanResult.rows[0];

    for (const item of calculatedItems) {
      await client.query(
        `
          INSERT INTO delivery_challan_items (
            tenant_id,
            delivery_challan_id,
            product_id,
            item_name,
            sku,
            quantity,
            rate,
            discount,
            tax,
            cgst,
            sgst,
            amount
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        `,
        [
          tenantId,
          challan.id,
          item.product_id || null,
          item.item_name,
          item.sku || null,
          item.quantity,
          item.rate,
          item.discount,
          item.tax,
          item.cgst,
          item.sgst,
          item.amount,
        ],
      );
    }

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Delivery challan created successfully",
      data: challan,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Create delivery challan error:", error);
    return res
      .status(500)
      .json({ message: "Failed to create delivery challan" });
  } finally {
    client.release();
  }
}

export async function updateDeliveryChallanHandler(
  req: UserContextRequest,
  res: Response,
) {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const { id } = req.params;

  if (!tenantId) {
    return res.status(401).json({ message: "Unauthorized: tenantId missing" });
  }

  const payload = UpdateDeliveryChallanSchema.parse(req.body);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingResult = await client.query(
      `
        SELECT id
        FROM delivery_challans
        WHERE tenant_id = $1
          AND id = $2
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [tenantId, id],
    );

    if (!existingResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Delivery challan not found" });
    }

    const calculatedItems = (payload.items || []).map(calculateItem);

    const totals = calculateTotals(
      calculatedItems,
      payload.discount_percent || 0,
      payload.adjustment || 0,
    );

    const challanResult = await client.query(
      `
        UPDATE delivery_challans
        SET
          reference_no = $3,
          customer_id = $4,
          customer_name = $5,
          customer_email = $6,
          customer_phone = $7,
          challan_date = $8,
          challan_type = $9,
          notes = $10,
          subtotal = $11,
          discount_percent = $12,
          discount_amount = $13,
          adjustment = $14,
          total = $15,
          status = $16,
          updated_by = $17,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
          AND deleted_at IS NULL
        RETURNING *
      `,
      [
        tenantId,
        id,
        payload.reference_no || null,
        payload.customer_id || null,
        payload.customer_name || "",
        payload.customer_email || null,
        payload.customer_phone || null,
        payload.challan_date,
        payload.challan_type || "Delivery Challan",
        payload.notes || null,
        totals.subtotal,
        payload.discount_percent || 0,
        totals.discount_amount,
        payload.adjustment || 0,
        totals.total,
        payload.status || "draft",
        userId,
      ],
    );

    if (payload.items) {
      await client.query(
        `
          DELETE FROM delivery_challan_items
          WHERE tenant_id = $1
            AND delivery_challan_id = $2
        `,
        [tenantId, id],
      );

      for (const item of calculatedItems) {
        await client.query(
          `
            INSERT INTO delivery_challan_items (
              tenant_id,
              delivery_challan_id,
              product_id,
              item_name,
              sku,
              quantity,
              rate,
              discount,
              tax,
              cgst,
              sgst,
              amount
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          `,
          [
            tenantId,
            id,
            item.product_id || null,
            item.item_name,
            item.sku || null,
            item.quantity,
            item.rate,
            item.discount,
            item.tax,
            item.cgst,
            item.sgst,
            item.amount,
          ],
        );
      }
    }

    await client.query("COMMIT");

    return res.json({
      message: "Delivery challan updated successfully",
      data: challanResult.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Update delivery challan error:", error);
    return res
      .status(500)
      .json({ message: "Failed to update delivery challan" });
  } finally {
    client.release();
  }
}

export async function deleteDeliveryChallanHandler(
  req: UserContextRequest,
  res: Response,
) {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const { id } = req.params;

  if (!tenantId) {
    return res.status(401).json({ message: "Unauthorized: tenantId missing" });
  }

  const result = await pool.query(
    `
      UPDATE delivery_challans
      SET
        deleted_at = now(),
        updated_by = $3,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
        AND deleted_at IS NULL
      RETURNING id
    `,
    [tenantId, id, userId],
  );

  if (!result.rows.length) {
    return res.status(404).json({ message: "Delivery challan not found" });
  }

  return res.json({ message: "Delivery challan deleted successfully" });
}
