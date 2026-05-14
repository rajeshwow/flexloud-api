import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";

function toNumber(value: any, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toNull(value: any) {
  return value === undefined || value === "" ? null : value;
}

function mapQuoteItem(
  item: any,
  tenantId: string,
  quoteId: string,
  index: number,
) {
  const quantity = toNumber(item.quantity);
  const listPrice = toNumber(item.list_price ?? item.price ?? item.sale_price);
  const salePrice = toNumber(item.sale_price ?? item.price ?? item.list_price);
  const discountValue = toNumber(item.discount_value ?? item.discount);
  const taxRate = toNumber(item.tax_rate ?? item.tax);
  const taxAmount = toNumber(item.tax_amount);
  const taxType1 = toNumber(item.tax_type_1 ?? item.cgst);
  const taxType2 = toNumber(item.tax_type_2 ?? item.sgst);
  const lineTotal = toNumber(item.line_total ?? item.amount);

  return {
    id: randomUUID(),
    tenant_id: tenantId,
    quote_id: quoteId,

    product_id: toNull(item.product_id),
    group_name: toNull(item.group_name),
    sort_order: toNumber(item.sort_order, index + 1),
    item_type: item.item_type || "product",

    product_name: toNull(item.product_name),
    service_name: toNull(item.service_name),
    hsn_code: toNull(item.hsn_code),

    quantity,
    list_price: listPrice,
    discount_value: discountValue,
    discount_type:
      item.discount_type === "flat" ? "amount" : item.discount_type || "amount",
    sale_price: salePrice,

    tax_rate: taxRate,
    tax_amount: taxAmount,
    tax_type_1: taxType1,
    tax_type_2: taxType2,

    description: toNull(item.description),
    note: toNull(item.note),
    line_total: lineTotal,
  };
}

async function insertQuoteActivity(
  client: any,
  params: {
    tenantId: string;
    entityId: string;
    actionType: string;
    title: string;
    description?: string | null;
    createdBy?: string | null;
    metadata?: Record<string, any>;
  },
) {
  const {
    tenantId,
    entityId,
    actionType,
    title,
    description = null,
    createdBy = null,
    metadata = {},
  } = params;

  await client.query(
    `
    INSERT INTO activity_logs (
      id,
      tenant_id,
      entity_type,
      entity_id,
      action_type,
      title,
      description,
      metadata,
      created_by_id,
      created_at,
      updated_at
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW()
    )
    `,
    [
      randomUUID(),
      tenantId,
      "quote",
      entityId,
      actionType,
      title,
      description,
      JSON.stringify(metadata),
      createdBy,
    ],
  );
}

async function insertQuoteItems(
  client: any,
  tenantId: string,
  quoteId: string,
  lineItems: any[],
) {
  for (const [index, rawItem] of lineItems.entries()) {
    const item = mapQuoteItem(rawItem, tenantId, quoteId, index);

    await client.query(
      `
      INSERT INTO quote_line_items (
        id,
        tenant_id,
        quote_id,

        product_id,
        group_name,
        sort_order,
        item_type,

        product_name,
        service_name,
        hsn_code,

        quantity,
        list_price,
        discount_value,
        discount_type,
        sale_price,

        tax_rate,
        tax_amount,
        tax_type_1,
        tax_type_2,

        description,
        note,
        line_total
      )
      VALUES (
        $1,$2,$3,
        $4,$5,$6,$7,
        $8,$9,$10,
        $11,$12,$13,$14,$15,
        $16,$17,$18,$19,
        $20,$21,$22
      )
      `,
      [
        item.id,
        item.tenant_id,
        item.quote_id,

        item.product_id,
        item.group_name,
        item.sort_order,
        item.item_type,

        item.product_name,
        item.service_name,
        item.hsn_code,

        item.quantity,
        item.list_price,
        item.discount_value,
        item.discount_type,
        item.sale_price,

        item.tax_rate,
        item.tax_amount,
        item.tax_type_1,
        item.tax_type_2,

        item.description,
        item.note,
        item.line_total,
      ],
    );
  }
}

// ============================
// CREATE
// ============================
export async function createQuoteHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const client = await pool.connect();

  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.sub;

    const {
      title,
      quotation_date,
      valid_until,
      validation_period,
      quote_stage,

      related_to_type,
      related_to_id,

      organization_id,
      contact_id,
      opportunity_id,
      assigned_to,
      lead_id,

      company_name,
      gstin,
      currency,

      terms_condition,
      terms_condition_description,
      material_delivery_time,
      payment_terms,
      payment_terms_description,
      description,

      billing_street,
      billing_area,
      billing_city,
      billing_state,
      billing_country,
      billing_postal_code,

      shipping_street,
      shipping_area,
      shipping_city,
      shipping_state,
      shipping_country,
      shipping_postal_code,

      subtotal,
      discount,
      total,
      freight_charges,
      freight_type,
      tax_on_freight,
      tax,
      grand_total,

      line_items = [],
    } = req.body;

    await client.query("BEGIN");

    const quoteId = randomUUID();
    const quoteNumber = `QT-${Date.now()}`;

    await client.query(
      `
      INSERT INTO quotes (
        id,
        tenant_id,
        quote_number,
        title,

        quotation_date,
        valid_until,
        validation_period,
        quote_stage,

        related_to_type,
        related_to_id,

        organization_id,
        contact_id,
        opportunity_id,
        assigned_to,
        lead_id,

        company_name,
        gstin,
        currency,

        terms_condition,
        terms_condition_description,
        material_delivery_time,
        payment_terms,
        payment_terms_description,
        description,

        billing_street,
        billing_area,
        billing_city,
        billing_state,
        billing_country,
        billing_postal_code,

        shipping_street,
        shipping_area,
        shipping_city,
        shipping_state,
        shipping_country,
        shipping_postal_code,

        subtotal,
        discount,
        total,
        freight_charges,
        freight_type,
        tax_on_freight,
        tax,
        grand_total,

        created_by_id,
        updated_by_id
      )
      VALUES (
        $1,$2,$3,$4,
        $5,$6,$7,$8,
        $9,$10,
        $11,$12,$13,$14,$15,
        $16,$17,$18,
        $19,$20,$21,$22,$23,$24,
        $25,$26,$27,$28,$29,$30,
        $31,$32,$33,$34,$35,$36,
        $37,$38,$39,$40,$41,$42,$43,$44,
        $45,$46
      )
      `,
      [
        quoteId,
        tenantId,
        quoteNumber,
        title,

        toNull(quotation_date),
        toNull(valid_until),
        toNull(validation_period),
        quote_stage || "draft",

        toNull(related_to_type),
        toNull(related_to_id),

        toNull(organization_id),
        toNull(contact_id),
        toNull(opportunity_id),
        toNull(assigned_to),
        toNull(lead_id),

        toNull(company_name),
        toNull(gstin),
        currency || "INR",

        toNull(terms_condition),
        toNull(terms_condition_description),
        toNull(material_delivery_time),
        toNull(payment_terms),
        toNull(payment_terms_description),
        toNull(description),

        toNull(billing_street),
        toNull(billing_area),
        toNull(billing_city),
        toNull(billing_state),
        toNull(billing_country),
        toNull(billing_postal_code),

        toNull(shipping_street),
        toNull(shipping_area),
        toNull(shipping_city),
        toNull(shipping_state),
        toNull(shipping_country),
        toNull(shipping_postal_code),

        toNumber(subtotal),
        toNumber(discount),
        toNumber(total),
        toNumber(freight_charges),
        toNull(freight_type),
        toNumber(tax_on_freight),
        toNumber(tax),
        toNumber(grand_total),

        userId,
        userId,
      ],
    );

    async function getQuoteDetailsForResponse(
      client: any,
      tenantId: string,
      quoteId: string,
    ) {
      const quoteResult = await client.query(
        `
    SELECT
      q.*,

      au.name AS assigned_to_name,
      au.email AS assigned_to_email,

      o.id AS organization_id,
      o.name AS organization_name,
      o.email AS organization_email,
      o.gst_number AS organization_gst_number,
      o.type AS organization_type,
      o.industry AS organization_industry,

      o.registered_street AS organization_registered_street,
      o.registered_area AS organization_registered_area,
      o.registered_postal_code AS organization_registered_postal_code,
      o.registered_city AS organization_registered_city,
      o.registered_state AS organization_registered_state,
      o.registered_country AS organization_registered_country,

      o.registered_city_id AS organization_registered_city_id,
      o.registered_state_id AS organization_registered_state_id,
      o.registered_country_id AS organization_registered_country_id,

      c.id AS contact_id,
      c.first_name AS contact_first_name,
      c.last_name AS contact_last_name,
      CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name,
      c.email AS contact_email,
      c.mobile AS contact_mobile,

      l.id AS lead_id,
      CONCAT_WS(' ', l.first_name, l.last_name) AS lead_name,

      op.id AS opportunity_id,
      op.name AS opportunity_name

    FROM quotes q
    LEFT JOIN users au
      ON au.id = q.assigned_to
    LEFT JOIN organizations o
      ON o.id = q.organization_id
      AND o.tenant_id = q.tenant_id
    LEFT JOIN contacts c
      ON c.id = q.contact_id
      AND c.tenant_id = q.tenant_id
    LEFT JOIN leads l
      ON l.id = q.lead_id
      AND l.tenant_id = q.tenant_id
    LEFT JOIN opportunities op
      ON op.id = q.opportunity_id
      AND op.tenant_id = q.tenant_id
    WHERE q.id = $1
      AND q.tenant_id = $2
      AND q.deleted_at IS NULL
    LIMIT 1
    `,
        [quoteId, tenantId],
      );

      if (!quoteResult.rowCount) return null;

      const itemsResult = await client.query(
        `
    SELECT
      qi.*,
      p.name AS product_display_name,
      p.part_number,
      p.hsn_code AS product_hsn_code
    FROM quote_line_items qi
    LEFT JOIN products p
      ON p.id = qi.product_id
      AND p.tenant_id = qi.tenant_id
    WHERE qi.quote_id = $1
      AND qi.tenant_id = $2
      AND qi.deleted_at IS NULL
    ORDER BY qi.sort_order ASC, qi.created_at ASC
    `,
        [quoteId, tenantId],
      );

      const quote = quoteResult.rows[0];

      return {
        ...quote,

        organization: quote.organization_id
          ? {
              id: quote.organization_id,
              name: quote.organization_name,
              email: quote.organization_email,
              gst_number: quote.organization_gst_number,
              type: quote.organization_type,
              industry: quote.organization_industry,

              registered_address: {
                street: quote.organization_registered_street,
                area: quote.organization_registered_area,
                postal_code: quote.organization_registered_postal_code,
                city: quote.organization_registered_city,
                state: quote.organization_registered_state,
                country: quote.organization_registered_country,
                city_id: quote.organization_registered_city_id,
                state_id: quote.organization_registered_state_id,
                country_id: quote.organization_registered_country_id,
              },
            }
          : null,

        contact: quote.contact_id
          ? {
              id: quote.contact_id,
              first_name: quote.contact_first_name,
              last_name: quote.contact_last_name,
              name: quote.contact_name,
              email: quote.contact_email,
              mobile: quote.contact_mobile,
            }
          : null,

        opportunity: quote.opportunity_id
          ? {
              id: quote.opportunity_id,
              name: quote.opportunity_name,
            }
          : null,

        lead: quote.lead_id
          ? {
              id: quote.lead_id,
              name: quote.lead_name,
            }
          : null,

        assigned_user: quote.assigned_to
          ? {
              id: quote.assigned_to,
              name: quote.assigned_to_name,
              email: quote.assigned_to_email,
            }
          : null,

        line_items: itemsResult.rows,
      };
    }

    await insertQuoteItems(client, tenantId, quoteId, line_items);

    await insertQuoteActivity(client, {
      tenantId,
      entityId: quoteId,
      actionType: "created",
      title: "Quote created",
      description: `Quote ${quoteNumber} created`,
      createdBy: userId,
      metadata: {
        quote_number: quoteNumber,
        title,
        quote_stage: quote_stage || "draft",
        organization_id,
        contact_id,
        assigned_to,
        grand_total: toNumber(grand_total),
      },
    });

    const createdQuote = await getQuoteDetailsForResponse(
      client,
      tenantId,
      quoteId,
    );

    await client.query("COMMIT");

    res.status(201).json({
      data: {
        message: "Quote created successfully",
        id: quoteId,
        quote_number: quoteNumber,
        data: createdQuote,
      },
      success: true,
      statusCode: 201,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
}

// ============================
// LIST
// ============================
export async function getQuotesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);

    const {
      search,
      page = 1,
      limit = 10,
      stage,
      organization_id,
      assigned_to,
    } = req.query as any;

    const safePage = Math.max(Number(page) || 1, 1);
    const safeLimit = Math.max(Number(limit) || 10, 1);
    const offset = (safePage - 1) * safeLimit;

    const values: any[] = [tenantId];
    let where = `WHERE q.tenant_id = $1 AND q.deleted_at IS NULL`;

    if (search) {
      values.push(`%${search}%`);
      where += ` AND (
        q.title ILIKE $${values.length}
        OR q.quote_number ILIKE $${values.length}
        OR o.name ILIKE $${values.length}
        OR CONCAT_WS(' ', c.first_name, c.last_name) ILIKE $${values.length}
      )`;
    }

    if (stage) {
      values.push(stage);
      where += ` AND q.quote_stage = $${values.length}`;
    }

    if (organization_id) {
      values.push(organization_id);
      where += ` AND q.organization_id = $${values.length}`;
    }

    if (assigned_to) {
      values.push(assigned_to);
      where += ` AND q.assigned_to = $${values.length}`;
    }

    const dataQuery = `
      SELECT
        q.*,

        au.name AS assigned_to_name,
        au.email AS assigned_to_email,

        o.name AS organization_name,
        MAX(so.id::text) AS sales_order_id,
        c.first_name AS contact_first_name,
        c.last_name AS contact_last_name,
        CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name,

        op.name AS opportunity_name,

        COUNT(qi.id)::int AS items_count
      FROM quotes q
      LEFT JOIN users au
        ON au.id = q.assigned_to
      LEFT JOIN organizations o
        ON o.id = q.organization_id
        AND o.tenant_id = q.tenant_id
      LEFT JOIN contacts c
        ON c.id = q.contact_id
        AND c.tenant_id = q.tenant_id
      LEFT JOIN opportunities op
        ON op.id = q.opportunity_id
        AND op.tenant_id = q.tenant_id
      LEFT JOIN sales_orders so
        ON so.quote_id = q.id
        AND so.tenant_id = q.tenant_id
      LEFT JOIN quote_line_items qi
        ON qi.quote_id = q.id
        AND qi.tenant_id = q.tenant_id
        AND qi.deleted_at IS NULL
      ${where}
      GROUP BY q.id, au.id, o.id, c.id, op.id
      ORDER BY q.created_at DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM quotes q
      LEFT JOIN organizations o
        ON o.id = q.organization_id
        AND o.tenant_id = q.tenant_id
      LEFT JOIN contacts c
        ON c.id = q.contact_id
        AND c.tenant_id = q.tenant_id
      ${where}
    `;

    const dataResult = await pool.query(dataQuery, [
      ...values,
      safeLimit,
      offset,
    ]);
    const countResult = await pool.query(countQuery, values);

    res.json({
      data: dataResult.rows,
      total: Number(countResult.rows[0]?.total || 0),
      page: safePage,
      limit: safeLimit,
    });
  } catch (err) {
    next(err);
  }
}

// ============================
// DETAILS
// ============================
export async function getQuoteByIdHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;

    const quoteResult = await pool.query(
      `
      SELECT
        q.*,

        au.name AS assigned_to_name,
        au.email AS assigned_to_email,

        o.name AS organization_name,

        c.first_name AS contact_first_name,
        c.last_name AS contact_last_name,
        CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name,

        l.first_name AS lead_first_name,
        l.last_name AS lead_last_name,
        CONCAT_WS(' ', l.first_name, l.last_name) AS lead_name,

        op.name AS opportunity_name

      FROM quotes q
      LEFT JOIN users au
        ON au.id = q.assigned_to
      LEFT JOIN organizations o
        ON o.id = q.organization_id
        AND o.tenant_id = q.tenant_id
      LEFT JOIN contacts c
        ON c.id = q.contact_id
        AND c.tenant_id = q.tenant_id
      LEFT JOIN leads l
        ON l.id = q.lead_id
        AND l.tenant_id = q.tenant_id
      LEFT JOIN opportunities op
        ON op.id = q.opportunity_id
        AND op.tenant_id = q.tenant_id
      WHERE q.id = $1
        AND q.tenant_id = $2
        AND q.deleted_at IS NULL
      LIMIT 1
      `,
      [id, tenantId],
    );

    if (!quoteResult.rowCount) {
      return res.status(404).json({
        message: "Quote not found",
      });
    }

    const itemsResult = await pool.query(
      `
      SELECT
        qi.id,
        qi.tenant_id,
        qi.quote_id,

        qi.product_id,
        qi.group_name,
        qi.sort_order,
        qi.item_type,

        qi.product_name,
        COALESCE(p.name, qi.product_name) AS product_display_name,
        qi.service_name,
        qi.hsn_code,

        qi.quantity,
        qi.list_price,
        qi.discount_value,
        qi.discount_type,
        qi.sale_price,

        qi.tax_rate,
        qi.tax_amount,
        qi.tax_type_1,
        qi.tax_type_2,

        qi.description,
        qi.note,
        qi.line_total,

        qi.created_at,
        qi.updated_at,
        qi.deleted_at
      FROM quote_line_items qi
      LEFT JOIN products p
        ON p.id = qi.product_id
        AND p.tenant_id = qi.tenant_id
      WHERE qi.quote_id = $1
        AND qi.tenant_id = $2
        AND qi.deleted_at IS NULL
      ORDER BY qi.sort_order ASC, qi.created_at ASC
      `,
      [id, tenantId],
    );

    res.json({
      ...quoteResult.rows[0],
      line_items: itemsResult.rows,
    });
  } catch (err) {
    next(err);
  }
}

// ============================
// UPDATE
// ============================
export async function updateQuoteHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const client = await pool.connect();

  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.sub;
    const { id } = req.params;

    const {
      title,
      quotation_date,
      valid_until,
      validation_period,
      quote_stage,

      related_to_type,
      related_to_id,

      organization_id,
      contact_id,
      opportunity_id,
      assigned_to,
      lead_id,

      company_name,
      gstin,
      currency,

      terms_condition,
      terms_condition_description,
      material_delivery_time,
      payment_terms,
      payment_terms_description,
      description,

      billing_street,
      billing_area,
      billing_city,
      billing_state,
      billing_country,
      billing_postal_code,

      shipping_street,
      shipping_area,
      shipping_city,
      shipping_state,
      shipping_country,
      shipping_postal_code,

      subtotal,
      discount,
      total,
      freight_charges,
      freight_type,
      tax_on_freight,
      tax,
      grand_total,

      line_items = [],
    } = req.body;

    await client.query("BEGIN");

    const existing = await client.query(
      `
  SELECT
    id,
    title,
    quote_stage,
    assigned_to,
    grand_total,
    valid_until,
    quotation_date
  FROM quotes
  WHERE id = $1
    AND tenant_id = $2
    AND deleted_at IS NULL
  LIMIT 1
  `,
      [id, tenantId],
    );

    if (!existing.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        message: "Quote not found",
      });
    }

    await client.query(
      `
      UPDATE quotes
      SET
        title = $1,

        quotation_date = $2,
        valid_until = $3,
        validation_period = $4,
        quote_stage = $5,

        related_to_type = $6,
        related_to_id = $7,

        organization_id = $8,
        contact_id = $9,
        opportunity_id = $10,
        assigned_to = $11,
        lead_id = $12,

        company_name = $13,
        gstin = $14,
        currency = $15,

        terms_condition = $16,
        terms_condition_description = $17,
        material_delivery_time = $18,
        payment_terms = $19,
        payment_terms_description = $20,
        description = $21,

        billing_street = $22,
        billing_area = $23,
        billing_city = $24,
        billing_state = $25,
        billing_country = $26,
        billing_postal_code = $27,

        shipping_street = $28,
        shipping_area = $29,
        shipping_city = $30,
        shipping_state = $31,
        shipping_country = $32,
        shipping_postal_code = $33,

        subtotal = $34,
        discount = $35,
        total = $36,
        freight_charges = $37,
        freight_type = $38,
        tax_on_freight = $39,
        tax = $40,
        grand_total = $41,

        updated_by_id = $42,
        updated_at = NOW()
      WHERE id = $43
        AND tenant_id = $44
      `,
      [
        title,

        toNull(quotation_date),
        toNull(valid_until),
        toNull(validation_period),
        quote_stage || "draft",

        toNull(related_to_type),
        toNull(related_to_id),

        toNull(organization_id),
        toNull(contact_id),
        toNull(opportunity_id),
        toNull(assigned_to),
        toNull(lead_id),

        toNull(company_name),
        toNull(gstin),
        currency || "INR",

        toNull(terms_condition),
        toNull(terms_condition_description),
        toNull(material_delivery_time),
        toNull(payment_terms),
        toNull(payment_terms_description),
        toNull(description),

        toNull(billing_street),
        toNull(billing_area),
        toNull(billing_city),
        toNull(billing_state),
        toNull(billing_country),
        toNull(billing_postal_code),

        toNull(shipping_street),
        toNull(shipping_area),
        toNull(shipping_city),
        toNull(shipping_state),
        toNull(shipping_country),
        toNull(shipping_postal_code),

        toNumber(subtotal),
        toNumber(discount),
        toNumber(total),
        toNumber(freight_charges),
        toNull(freight_type),
        toNumber(tax_on_freight),
        toNumber(tax),
        toNumber(grand_total),

        userId,
        id,
        tenantId,
      ],
    );

    await client.query(
      `
      DELETE FROM quote_line_items
      WHERE quote_id = $1
        AND tenant_id = $2
      `,
      [id, tenantId],
    );

    await insertQuoteItems(client, tenantId, id, line_items);

    const oldQuote = existing.rows[0];

    const changes: any[] = [];
    if (oldQuote.title !== title) {
      changes.push({
        field: "title",
        label: "Title",
        old_value: oldQuote.title,
        new_value: title,
        old_display: oldQuote.title || "-",
        new_display: title || "-",
      });
    }

    if (oldQuote.quote_stage !== quote_stage) {
      changes.push({
        field: "quote_stage",
        label: "Stage",
        old_value: oldQuote.quote_stage,
        new_value: quote_stage || "draft",
        old_display: oldQuote.quote_stage || "-",
        new_display: quote_stage || "draft",
      });
    }

    if (oldQuote.assigned_to !== assigned_to) {
      changes.push({
        field: "assigned_to",
        label: "Assigned To",
        old_value: oldQuote.assigned_to,
        new_value: assigned_to,
        old_display: oldQuote.assigned_to || "-",
        new_display: assigned_to || "-",
      });
    }

    if (Number(oldQuote.grand_total || 0) !== toNumber(grand_total)) {
      changes.push({
        field: "grand_total",
        label: "Grand Total",
        old_value: Number(oldQuote.grand_total || 0),
        new_value: toNumber(grand_total),
        old_display: String(Number(oldQuote.grand_total || 0)),
        new_display: String(toNumber(grand_total)),
      });
    }

    await insertQuoteActivity(client, {
      tenantId,
      entityId: id,
      actionType: changes.length ? "updated" : "items_updated",
      title: changes.length ? "Quote updated" : "Quote items updated",
      description: changes.length
        ? "Quote details updated"
        : "Quote items recalculated",
      createdBy: userId,
      metadata: {
        changes,
        line_items_count: Array.isArray(line_items) ? line_items.length : 0,
        subtotal: toNumber(subtotal),
        tax: toNumber(tax),
        grand_total: toNumber(grand_total),
      },
    });

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Quote updated successfully",
      id,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
}
