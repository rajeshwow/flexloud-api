import { randomUUID } from "crypto";
import { Request, Response } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";

type UserContextRequest = Request & {
  user?: {
    userId?: string;
    tenantId?: string;
    role?: string;
  };
};

const optionalNumber = z.coerce.number().optional().nullable();
const optionalString = z.string().optional().nullable();
const optionalUuid = z.string().uuid().optional().nullable();

const lineItemSchema = z.object({
  id: optionalUuid,
  product_id: optionalUuid,

  qty: optionalNumber,
  quantity: optionalNumber,

  product_name: optionalString,
  sku: optionalString,
  part_no: optionalString,

  list_price: optionalNumber,
  price: optionalNumber,

  discount: optionalNumber,
  discount_type: optionalString,

  sale_price: optionalNumber,

  tax_type: optionalString,
  tax_amount: optionalNumber,
  tax: optionalNumber,

  total: optionalNumber,
  amount: optionalNumber,

  cgst: optionalNumber,
  sgst: optionalNumber,
});

function normalizeLineItem(item: z.infer<typeof lineItemSchema>) {
  const qty = Number(item.qty ?? item.quantity ?? 0);
  const listPrice = Number(item.list_price ?? item.price ?? 0);
  const discount = Number(item.discount ?? 0);
  const taxRate = Number(item.tax ?? 0);

  const salePrice = Math.max(qty * listPrice - discount, 0);
  const taxAmount = Number(((salePrice * taxRate) / 100).toFixed(2));
  const total = Number((salePrice + taxAmount).toFixed(2));

  return {
    product_id: item.product_id ?? null,
    qty,
    product_name: item.product_name ?? null,
    part_no: item.part_no ?? item.sku ?? null,
    list_price: listPrice,
    discount,
    discount_type: item.discount_type ?? "Flat",
    sale_price: salePrice,
    tax_type: item.tax_type ?? "GST",
    tax_amount: taxAmount,
    tax: taxRate,
    total,
  };
}

const createOpportunitySchema = z.object({
  opportunity_number: z.string().optional().nullable(),
  name: z.string().min(1, "Opportunity name is required"),

  organization_name: z.string().optional().nullable(),
  contact_name: z.string().optional().nullable(),
  contact_number: z.string().optional().nullable(),
  contact_email: z.string().optional().nullable(),
  lead_source: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  sales_stage: z.string().optional().nullable(),
  type: z.string().optional().nullable(),
  dealer_organization: z.string().optional().nullable(),

  amount: z.number().optional().nullable(),
  currency: z.string().optional().nullable(),

  probability: z.number().optional().nullable(),
  next_step: z.string().optional().nullable(),
  dealer_contact: z.string().optional().nullable(),

  expected_close_date: z.string().optional().nullable(),
  followup_type: z.string().optional().nullable(),
  next_followup: z.string().optional().nullable(),
  close_date: z.string().optional().nullable(),

  add_description: z.string().optional().nullable(),
  description: z.string().optional().nullable(),

  assigned_to: z.string().uuid().optional().nullable(),
  campaign: z.string().optional().nullable(),

  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),

  line_items: z.array(lineItemSchema).optional().default([]),
});

const updateOpportunitySchema = z.object({
  opportunity_number: z.string().optional().nullable(),
  name: z.string().min(1).optional(),

  organization_name: z.string().optional().nullable(),
  contact_name: z.string().optional().nullable(),
  contact_number: z.string().optional().nullable(),
  contact_email: z.string().optional().nullable(),
  lead_source: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  sales_stage: z.string().optional().nullable(),
  type: z.string().optional().nullable(),
  dealer_organization: z.string().optional().nullable(),

  amount: z.number().optional().nullable(),
  currency: z.string().optional().nullable(),

  probability: z.number().optional().nullable(),
  next_step: z.string().optional().nullable(),
  dealer_contact: z.string().optional().nullable(),

  expected_close_date: z.string().optional().nullable(),
  followup_type: z.string().optional().nullable(),
  next_followup: z.string().optional().nullable(),
  close_date: z.string().optional().nullable(),

  add_description: z.string().optional().nullable(),
  description: z.string().optional().nullable(),

  assigned_to: z.string().uuid().optional().nullable(),
  campaign: z.string().optional().nullable(),

  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),

  line_items: z.array(lineItemSchema).optional(),
});

export async function createOpportunityHandler(
  req: UserContextRequest,
  res: Response,
) {
  const parsed = createOpportunitySchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid request body",
      errors: parsed.error.flatten(),
    });
  }

  const tenantId = req.user?.tenantId;
  const userId = req.user?.userId || null;

  if (!tenantId) {
    return res.status(401).json({ message: "Unauthorized: tenantId missing" });
  }

  const input = parsed.data;
  const opportunityId = randomUUID();

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const insertOpportunityQuery = `
      INSERT INTO opportunities (
        id,
        tenant_id,
        opportunity_number,
        name,
        organization_name,
        contact_name,
        contact_number,
        contact_email,
        lead_source,
        company,
        sales_stage,
        type,
        dealer_organization,
        amount,
        currency,
        probability,
        next_step,
        dealer_contact,
        expected_close_date,
        followup_type,
        next_followup,
        close_date,
        add_description,
        description,
        assigned_to,
        campaign,
        created_by,
        updated_by
      )
     VALUES (
  $1, $2, 'OPP-' || LPAD(nextval('opportunity_number_seq')::TEXT, 7, '0'), $3, $4, $5, $6, $7, $8, $9,
  $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
  $20, $21, $22, $23, $24, $25, $26, $27
)
RETURNING *
    `;

    const opportunityResult = await client.query(insertOpportunityQuery, [
      opportunityId,
      tenantId,
      // input.opportunity_number ?? null,
      input.name,
      input.organization_name ?? null,
      input.contact_name ?? null,
      input.contact_number ?? input.phone ?? null,
      input.contact_email ?? input.email ?? null,
      input.lead_source ?? null,
      input.company ?? null,
      input.sales_stage ?? null,
      input.type ?? null,
      input.dealer_organization ?? null,
      input.amount ?? null,
      input.currency ?? null,
      input.probability ?? null,
      input.next_step ?? null,
      input.dealer_contact ?? null,
      input.expected_close_date ?? null,
      input.followup_type ?? null,
      input.next_followup ?? null,
      input.close_date ?? null,
      input.add_description ?? null,
      input.description ?? null,
      input.assigned_to ?? null,
      input.campaign ?? null,
      userId,
      userId,
    ]);

    for (const item of input.line_items || []) {
      const lineItemId = randomUUID();
      const normalizedItem = normalizeLineItem(item);

      await client.query(
        `
      INSERT INTO opportunity_line_items (
        id,
        tenant_id,
        opportunity_id,
        product_id,
        qty,
        product_name,
        part_no,
        list_price,
        discount,
        discount_type,
        sale_price,
        tax_type,
        tax_amount,
        tax,
        total
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15
      )
    `,
        [
          lineItemId,
          tenantId,
          opportunityId,
          normalizedItem.product_id,
          normalizedItem.qty,
          normalizedItem.product_name,
          normalizedItem.part_no,
          normalizedItem.list_price,
          normalizedItem.discount,
          normalizedItem.discount_type,
          normalizedItem.sale_price,
          normalizedItem.tax_type,
          normalizedItem.tax_amount,
          normalizedItem.tax,
          normalizedItem.total,
        ],
      );
    }

    const lineItemsResult = await client.query(
      `
        SELECT *
        FROM opportunity_line_items
        WHERE tenant_id = $1 AND opportunity_id = $2
        ORDER BY created_at ASC
      `,
      [tenantId, opportunityId],
    );

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Opportunity created successfully",
      data: {
        ...opportunityResult.rows[0],
        line_items: lineItemsResult.rows,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("createOpportunityHandler error:", error);
    return res.status(500).json({ message: "Failed to create opportunity" });
  } finally {
    client.release();
  }
}

export async function getOpportunitiesHandler(
  req: UserContextRequest,
  res: Response,
) {
  const tenantId = req.user?.tenantId;

  if (!tenantId) {
    return res.status(401).json({ message: "Unauthorized: tenantId missing" });
  }

  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.max(Number(req.query.limit || 20), 1);
  const offset = (page - 1) * limit;

  const search = String(req.query.search || "").trim();
  const opportunity_number = String(req.query.opportunity_number || "").trim();
  const name = String(req.query.name || "").trim();
  const sales_stage = String(req.query.sales_stage || "").trim();
  const amount = String(req.query.amount || "").trim();
  const close_date = String(req.query.close_date || "").trim();
  const user = String(req.query.user || "").trim();
  const created_at = String(req.query.created_at || "").trim();

  const whereParts: string[] = ["o.tenant_id = $1", "o.deleted_at IS NULL"];
  const values: Array<string | number> = [tenantId];
  let paramIndex = 2;

  if (search) {
    whereParts.push(`(
      o.opportunity_number ILIKE $${paramIndex}
      OR o.name ILIKE $${paramIndex}
      OR o.contact_name ILIKE $${paramIndex}
      OR o.contact_number ILIKE $${paramIndex}
      OR o.contact_email ILIKE $${paramIndex}
      OR o.company ILIKE $${paramIndex}
      OR u.name ILIKE $${paramIndex}
    )`);
    values.push(`%${search}%`);
    paramIndex++;
  }

  if (opportunity_number) {
    whereParts.push(`o.opportunity_number ILIKE $${paramIndex}`);
    values.push(`%${opportunity_number}%`);
    paramIndex++;
  }

  if (name) {
    whereParts.push(`o.name ILIKE $${paramIndex}`);
    values.push(`%${name}%`);
    paramIndex++;
  }

  if (sales_stage) {
    whereParts.push(`o.sales_stage ILIKE $${paramIndex}`);
    values.push(`%${sales_stage}%`);
    paramIndex++;
  }

  if (amount) {
    whereParts.push(`CAST(o.amount AS TEXT) ILIKE $${paramIndex}`);
    values.push(`%${amount}%`);
    paramIndex++;
  }

  if (close_date) {
    whereParts.push(`CAST(o.close_date AS TEXT) ILIKE $${paramIndex}`);
    values.push(`%${close_date}%`);
    paramIndex++;
  }

  if (user) {
    whereParts.push(`(
      CAST(o.assigned_to AS TEXT) ILIKE $${paramIndex}
      OR u.name ILIKE $${paramIndex}
    )`);
    values.push(`%${user}%`);
    paramIndex++;
  }

  if (created_at) {
    whereParts.push(`CAST(o.created_at AS TEXT) ILIKE $${paramIndex}`);
    values.push(`%${created_at}%`);
    paramIndex++;
  }

  const whereClause = whereParts.join(" AND ");

  try {
    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM opportunities o
      LEFT JOIN users u
        ON u.id::text = o.assigned_to::text
       AND u.tenant_id = o.tenant_id
      WHERE ${whereClause}
    `;

    const countResult = await pool.query(countQuery, values);

    const listQuery = `
      SELECT 
        o.*,
        u.name AS assigned_to_name
      FROM opportunities o
      LEFT JOIN users u
        ON u.id::text = o.assigned_to::text
       AND u.tenant_id = o.tenant_id
      WHERE ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const listValues = [...values, limit, offset];
    const listResult = await pool.query(listQuery, listValues);

    return res.json({
      data: listResult.rows,
      total: countResult.rows[0]?.total || 0,
      page,
      limit,
    });
  } catch (error) {
    console.error("getOpportunitiesHandler error:", error);
    return res.status(500).json({ message: "Failed to fetch opportunities" });
  }
}

export async function getOpportunityByIdHandler(
  req: UserContextRequest,
  res: Response,
) {
  const tenantId = req.user?.tenantId;
  const { id } = req.params;

  if (!tenantId) {
    return res.status(401).json({ message: "Unauthorized: tenantId missing" });
  }

  try {
    const opportunityResult = await pool.query(
      `
    SELECT 
      o.*,
      org.name AS organization_display_name,
      TRIM(CONCAT(c.first_name, ' ', c.last_name)) AS contact_display_name,
      CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) AS assigned_to_name
    FROM opportunities o
    LEFT JOIN organizations org 
      ON org.id::text = o.organization_name::text
    LEFT JOIN contacts c 
      ON c.id::text = o.contact_name::text
    LEFT JOIN users u 
      ON u.id::text = o.assigned_to::text
    WHERE o.tenant_id::text = $1::text
      AND o.id::text = $2::text
      AND o.deleted_at IS NULL
    LIMIT 1
  `,
      [tenantId, id],
    );

    if (!opportunityResult.rows.length) {
      return res.status(404).json({ message: "Opportunity not found" });
    }

    const lineItemsResult = await pool.query(
      `
    SELECT
      oli.*,
      oli.product_id,
      COALESCE(p.name, oli.product_name) AS product_name
    FROM opportunity_line_items oli
    LEFT JOIN products p
      ON p.id::text = oli.product_id::text
     AND p.tenant_id::text = oli.tenant_id::text
    WHERE oli.tenant_id::text = $1::text
      AND oli.opportunity_id::text = $2::text
    ORDER BY oli.created_at ASC
  `,
      [tenantId, id],
    );

    return res.json({
      data: {
        ...opportunityResult.rows[0],
        line_items: lineItemsResult.rows,
      },
      message: "Opportunity fetched successfully",
    });
  } catch (error) {
    console.error("getOpportunityByIdHandler error:", error);
    return res.status(500).json({ message: "Failed to fetch opportunity" });
  }
}

export async function updateOpportunityHandler(
  req: UserContextRequest,
  res: Response,
) {
  const dataToParse = req.body.payload || req.body;
  const parsed = updateOpportunitySchema.safeParse(dataToParse) as any;

  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid request body",
      errors: parsed.error.flatten(),
    });
  }

  const tenantId = req.user?.tenantId;
  const userId = req.user?.userId || null;
  const { id } = req.params;

  if (!tenantId) {
    return res.status(401).json({ message: "Unauthorized: tenantId missing" });
  }

  const input = parsed.data;
  const client = await pool.connect();

  const inputLineItems = input.line_items ?? input.line_Items;

  try {
    await client.query("BEGIN");

    const existingResult = await client.query(
      `
        SELECT id
        FROM opportunities
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        LIMIT 1
      `,
      [tenantId, id],
    );

    if (!existingResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Opportunity not found" });
    }

    const updateQuery = `
      UPDATE opportunities
      SET
        opportunity_number = COALESCE($3, opportunity_number),
        name = COALESCE($4, name),
        organization_name = COALESCE($5, organization_name),
        contact_name = COALESCE($6, contact_name),
        contact_number = COALESCE($7, contact_number),
        contact_email = COALESCE($8, contact_email),
        lead_source = COALESCE($9, lead_source),
        company = COALESCE($10, company),
        sales_stage = COALESCE($11, sales_stage),
        type = COALESCE($12, type),
        dealer_organization = COALESCE($13, dealer_organization),
        amount = COALESCE($14, amount),
        currency = COALESCE($15, currency),
        probability = COALESCE($16, probability),
        next_step = COALESCE($17, next_step),
        dealer_contact = COALESCE($18, dealer_contact),
        expected_close_date = COALESCE($19, expected_close_date),
        followup_type = COALESCE($20, followup_type),
        next_followup = COALESCE($21, next_followup),
        close_date = COALESCE($22, close_date),
        add_description = COALESCE($23, add_description),
        description = COALESCE($24, description),
        assigned_to = COALESCE($25, assigned_to),
        campaign = COALESCE($26, campaign),
        updated_by = $27,
        updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2
      RETURNING *
    `;

    const updateResult = await client.query(updateQuery, [
      tenantId,
      id,
      input.opportunity_number ?? null,
      input.name ?? null,
      input.organization_name ?? null,
      input.contact_name ?? null,
      input.contact_number ?? input.phone ?? null,
      input.contact_email ?? input.email ?? null,
      input.lead_source ?? null,
      input.company ?? null,
      input.sales_stage ?? null,
      input.type ?? null,
      input.dealer_organization ?? null,
      input.amount ?? null,
      input.currency ?? null,
      input.probability ?? null,
      input.next_step ?? null,
      input.dealer_contact ?? null,
      input.expected_close_date ?? null,
      input.followup_type ?? null,
      input.next_followup ?? null,
      input.close_date ?? null,
      input.add_description ?? null,
      input.description ?? null,
      input.assigned_to ?? null,
      input.campaign ?? null,
      userId,
    ]);
    if (Array.isArray(inputLineItems)) {
      await client.query(
        `
      DELETE FROM opportunity_line_items
      WHERE tenant_id = $1 AND opportunity_id = $2
    `,
        [tenantId, id],
      );

      for (const item of inputLineItems) {
        const lineItemId = randomUUID();
        const normalizedItem = normalizeLineItem(item);

        await client.query(
          `
        INSERT INTO opportunity_line_items (
          id, tenant_id, opportunity_id, product_id,
          qty, product_name, part_no, list_price,
          discount, discount_type, sale_price,
          tax_type, tax_amount, tax, total
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15
        )
      `,
          [
            lineItemId,
            tenantId,
            id,
            normalizedItem.product_id,
            normalizedItem.qty,
            normalizedItem.product_name,
            normalizedItem.part_no,
            normalizedItem.list_price,
            normalizedItem.discount,
            normalizedItem.discount_type,
            normalizedItem.sale_price,
            normalizedItem.tax_type,
            normalizedItem.tax_amount,
            normalizedItem.tax,
            normalizedItem.total,
          ],
        );
      }
    }

    const lineItemsResult = await client.query(
      `
        SELECT *
        FROM opportunity_line_items
        WHERE tenant_id = $1 AND opportunity_id = $2
        ORDER BY created_at ASC
      `,
      [tenantId, id],
    );

    await client.query("COMMIT");

    return res.json({
      message: "Opportunity updated successfully",
      data: {
        ...updateResult.rows[0],
        line_items: lineItemsResult.rows,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("updateOpportunityHandler error:", error);
    return res.status(500).json({ message: "Failed to update opportunity" });
  } finally {
    client.release();
  }
}
