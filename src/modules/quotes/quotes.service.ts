import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";

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
    } = req.body;

    await client.query("BEGIN");

    const quoteId = randomUUID();

    const quoteNumber = `QT-${Date.now()}`;

    await client.query(
      `
      INSERT INTO quotes (
        id, tenant_id, quote_number, title,
        quotation_date, valid_until, quote_stage,
        organization_id, contact_id, opportunity_id, assigned_to,
        subtotal, discount, total, tax, grand_total,
        created_by_id, updated_by_id
      )
      VALUES (
        $1,$2,$3,$4,
        $5,$6,$7,
        $8,$9,$10,$11,
        $12,$13,$14,$15,$16,
        $17,$18
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
          quantity, sale_price, line_total
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
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

export async function getQuotesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);

    const result = await pool.query(
      `
      SELECT *
      FROM quotes
      WHERE tenant_id = $1
        AND deleted_at IS NULL
      ORDER BY created_at DESC
      `,
      [tenantId],
    );

    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
}

export async function getQuoteByIdHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;

    const quote = await pool.query(
      `
      SELECT *
      FROM quotes
      WHERE id = $1 AND tenant_id = $2
      `,
      [id, tenantId],
    );

    const items = await pool.query(
      `
      SELECT *
      FROM quote_line_items
      WHERE quote_id = $1 AND tenant_id = $2
      `,
      [id, tenantId],
    );

    res.json({
      ...quote.rows[0],
      line_items: items.rows,
    });
  } catch (err) {
    next(err);
  }
}

export async function updateQuoteHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const client = await pool.connect();

  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;

    const {
      title,
      subtotal,
      discount,
      total,
      tax,
      grand_total,
      line_items = [],
    } = req.body;

    await client.query("BEGIN");

    await client.query(
      `
      UPDATE quotes
      SET title = $1,
          subtotal = $2,
          discount = $3,
          total = $4,
          tax = $5,
          grand_total = $6
      WHERE id = $7 AND tenant_id = $8
      `,
      [title, subtotal, discount, total, tax, grand_total, id, tenantId],
    );

    await client.query(
      `DELETE FROM quote_line_items WHERE quote_id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );

    for (const item of line_items) {
      await client.query(
        `
        INSERT INTO quote_line_items (
          id, tenant_id, quote_id,
          item_type, product_name, service_name,
          quantity, sale_price, line_total
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
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
