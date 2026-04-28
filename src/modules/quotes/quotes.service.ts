import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";

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
      quote_stage,
      organization_id,
      contact_id,
      opportunity_id,
      assigned_to,
      subtotal,
      discount,
      total,
      tax,
      grand_total,
      line_items = [],
      lead_id,
    } = req.body;

    await client.query("BEGIN");

    const quoteId = randomUUID();
    const quoteNumber = `QT-${Date.now()}`;

    await client.query(
      `
      INSERT INTO quotes (
        id, tenant_id, quote_number, title,
        quotation_date, valid_until, quote_stage,
        organization_id, contact_id, opportunity_id, assigned_to, lead_id,
        subtotal, discount, total, tax, grand_total,
        created_by_id, updated_by_id
      )
      VALUES (
        $1,$2,$3,$4,
        $5,$6,$7,
        $8,$9,$10,$11,
        $12,$13,$14,$15,$16,
        $17,$18,$19
      )
      `,
      [
        quoteId,
        tenantId,
        quoteNumber,
        title,
        quotation_date,
        valid_until,
        quote_stage || "draft",
        organization_id,
        contact_id,
        opportunity_id,
        assigned_to,
        lead_id,
        subtotal || 0,
        discount || 0,
        total || 0,
        tax || 0,
        grand_total || 0,
        userId,
        userId,
      ],
    );

    for (const item of line_items) {
      await client.query(
        `
        INSERT INTO quote_line_items (
          id, tenant_id, quote_id,
          item_type, product_name, service_name,
          quantity, sale_price, line_total, sort_order
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `,
        [
          randomUUID(),
          tenantId,
          quoteId,
          item.item_type,
          item.product_name,
          item.service_name,
          item.quantity,
          item.sale_price,
          item.line_total,
          item.sort_order || 0,
        ],
      );
    }

    await client.query("COMMIT");

    res.json({ success: true, id: quoteId });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
}

// ============================
// LIST (🔥 FIXED)
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

    const offset = (Number(page) - 1) * Number(limit);

    const values: any[] = [tenantId];
    let where = `WHERE q.tenant_id = $1 AND q.deleted_at IS NULL`;

    if (search) {
      values.push(`%${search}%`);
      where += ` AND (q.title ILIKE $${values.length} OR q.quote_number ILIKE $${values.length})`;
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
      SELECT q.*
      FROM quotes q
      ${where}
      ORDER BY q.created_at DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM quotes q
      ${where}
    `;

    const dataResult = await pool.query(dataQuery, [...values, limit, offset]);

    const countResult = await pool.query(countQuery, values);

    res.json({
      data: dataResult.rows,
      total: Number(countResult.rows[0].total),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    next(err);
  }
}

// ============================
// DETAILS (🔥 FIXED)
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
      SELECT *
      FROM quote_line_items
      WHERE quote_id = $1
        AND tenant_id = $2
        AND deleted_at IS NULL
      ORDER BY sort_order ASC
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
// UPDATE (🔥 FIXED)
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
      quote_stage,
      organization_id,
      contact_id,
      opportunity_id,
      assigned_to,
      subtotal,
      discount,
      total,
      tax,
      grand_total,
      line_items = [],
      lead_id,
    } = req.body;

    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id FROM quotes WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );

    if (!existing.rowCount) {
      throw new Error("Quote not found");
    }

    await client.query(
      `
      UPDATE quotes
      SET
        title = $1,
        quotation_date = $2,
        valid_until = $3,
        quote_stage = $4,
        organization_id = $5,
        contact_id = $6,
        opportunity_id = $7,
        assigned_to = $8,
        subtotal = $9,
        discount = $10,
        total = $11,
        tax = $12,
        grand_total = $13,
        updated_by_id = $14
      WHERE id = $15 AND tenant_id = $16
      `,
      [
        title,
        quotation_date,
        valid_until,
        quote_stage,
        organization_id,
        contact_id,
        opportunity_id,
        assigned_to,
        subtotal,
        discount,
        total,
        tax,
        grand_total,
        userId,
        id,
        tenantId,
      ],
    );

    // delete old items
    await client.query(
      `DELETE FROM quote_line_items WHERE quote_id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );

    // insert new
    for (const item of line_items) {
      await client.query(
        `
        INSERT INTO quote_line_items (
          id, tenant_id, quote_id,
          item_type, product_name, service_name,
          quantity, sale_price, line_total, sort_order
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `,
        [
          randomUUID(),
          tenantId,
          id,
          item.item_type,
          item.product_name,
          item.service_name,
          item.quantity,
          item.sale_price,
          item.line_total,
          item.sort_order || 0,
        ],
      );
    }

    await client.query("COMMIT");

    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
}
