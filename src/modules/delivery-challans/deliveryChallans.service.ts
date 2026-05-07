import { Request, Response } from "express";
import nodemailer from "nodemailer";
import puppeteer from "puppeteer";

import dayjs from "dayjs";
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

  return res.status(200).json({
    statusCode: 200,
    message: "Delivery challans fetched successfully",
    data: {
      list: result.rows,
      meta: {
        page: query.page,
        limit: query.limit,
        total: countResult.rows[0]?.total || 0,
      },
    },
  });
}

async function generatePdfBufferFromHtml(html: string) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "12mm",
        right: "12mm",
        bottom: "12mm",
        left: "12mm",
      },
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

export async function sendDeliveryChallanEmailHandler(
  req: UserContextRequest,
  res: Response,
) {
  const tenantId = getTenantId(req);
  const { id } = req.params;

  const { to, cc, bcc, subject, body, attachPdf = true } = req.body || {};

  if (!tenantId) {
    return res.status(401).json({
      statusCode: 401,
      message: "Unauthorized: tenantId missing",
      data: null,
    });
  }

  try {
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
      return res.status(404).json({
        statusCode: 404,
        message: "Delivery challan not found",
        data: null,
      });
    }

    const challan = challanResult.rows[0];
    const sendTo = to || challan.customer_email;

    if (!sendTo) {
      return res.status(400).json({
        statusCode: 400,
        message: "Customer email not found",
        data: null,
      });
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

    const items = itemsResult.rows;

    const taxAmount = items.reduce((sum: number, item: any) => {
      return sum + Number(item.cgst || 0) + Number(item.sgst || 0);
    }, 0);

    const discountAmount = Number(
      challan.discount_amount || challan.discount || 0,
    );

    const itemsRowsHtml = items
      .map(
        (item: any, index: number) => `
          <tr>
            <td class="center">${index + 1}</td>
            <td>
              <b>${item.item_name || item.product_name || "-"}</b>
              ${item.sku ? `<br/><small>SKU: ${item.sku}</small>` : ""}
            </td>
            <td class="right">${Number(item.quantity || 0).toFixed(2)}</td>
            <td class="right">${Number(item.rate || 0).toFixed(2)}</td>
            <td class="right">${Number(item.amount || 0).toFixed(2)}</td>
          </tr>
        `,
      )
      .join("");

    let pdfBuffer: Buffer | null = null;

    if (attachPdf) {
      const pdfHtml = `
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <style>
              * {
                box-sizing: border-box;
              }

              body {
                margin: 0;
                padding: 28px;
                font-family: Arial, Helvetica, sans-serif;
                color: #111827;
                font-size: 13px;
              }

              .top {
                display: flex;
                justify-content: space-between;
                gap: 24px;
                margin-bottom: 30px;
              }

              .company-name {
                font-size: 22px;
                font-weight: 800;
                margin-bottom: 6px;
              }

              .title {
                text-align: right;
                font-size: 34px;
                font-weight: 800;
                line-height: 1.05;
                letter-spacing: 1px;
              }

              .doc-no {
                text-align: right;
                margin-top: 12px;
                font-size: 14px;
              }

              .info {
                display: flex;
                justify-content: space-between;
                gap: 24px;
                margin-bottom: 26px;
              }

              .label {
                color: #6b7280;
                font-size: 12px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: .5px;
                margin-bottom: 8px;
              }

              .meta-line {
                margin-bottom: 7px;
              }

              table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 12px;
              }

              th {
                background: #111827;
                color: #ffffff;
                padding: 10px;
                font-size: 12px;
                text-align: left;
                border: 1px solid #111827;
              }

              td {
                border: 1px solid #e5e7eb;
                padding: 10px;
                vertical-align: top;
              }

              .right {
                text-align: right;
              }

              .center {
                text-align: center;
              }

              .summary {
                width: 320px;
                margin-left: auto;
                margin-top: 26px;
              }

              .summary-row {
                display: flex;
                justify-content: space-between;
                border-bottom: 1px solid #e5e7eb;
                padding: 8px 0;
              }

              .total {
                font-size: 17px;
                font-weight: 800;
                border-top: 2px solid #111827;
                margin-top: 8px;
                padding-top: 12px;
              }

              .signature {
                margin-top: 90px;
                text-align: right;
                font-weight: 700;
              }
            </style>
          </head>

          <body>
            <div class="top">
              <div>
                <div class="company-name">FlexLoud</div>
                <div>Rajasthan</div>
                <div>India</div>
                <div>rajesh007prajapati@gmail.com</div>
              </div>

              <div>
                <div class="title">DELIVERY<br/>CHALLAN</div>
                <div class="doc-no">
                  Delivery Challan# <b>${challan.challan_number || "-"}</b>
                </div>
              </div>
            </div>

            <div class="info">
              <div>
                <div class="label">Deliver To</div>
                <b>${challan.customer_name || "-"}</b>
                ${challan.customer_email ? `<div>${challan.customer_email}</div>` : ""}
                ${challan.customer_phone ? `<div>${challan.customer_phone}</div>` : ""}
              </div>

              <div>
                <div class="meta-line">
                  Challan Date : <b>${dayjs(challan.challan_date).format("DD-MM-YYYY HH:mm:ss A") || "-"}</b>
                </div>
                <div class="meta-line">
                  Challan Type : <b>${challan.challan_type || "-"}</b>
                </div>
                <div class="meta-line">
                  Reference : <b>${challan.reference_no || "-"}</b>
                </div>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th style="width:50px;" class="center">#</th>
                  <th>Item & Description</th>
                  <th class="right">Qty</th>
                  <th class="right">Rate</th>
                  <th class="right">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${
                  itemsRowsHtml ||
                  `<tr><td colspan="5" class="center">No items added</td></tr>`
                }
              </tbody>
            </table>

            <div class="summary">
              <div class="summary-row">
                <span>Sub Total</span>
                <b>₹${Number(challan.subtotal || 0).toFixed(2)}</b>
              </div>

              <div class="summary-row">
                <span>Tax</span>
                <b> (+) ₹${taxAmount.toFixed(2)}</b>
              </div>
              ${
                discountAmount > 0
                  ? `
      <div class="summary-row">
        <span>Discount</span>
        <b>(-) ₹${discountAmount.toFixed(2)}</b>
      </div>
    `
                  : ""
              }

              <div class="summary-row total">
                <span>Total</span>
                <span>₹${Number(challan.total || 0).toFixed(2)}</span>
              </div>
            </div>

            <div class="signature">Authorized Signature</div>
          </body>
        </html>
      `;

      const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });

      try {
        const page = await browser.newPage();
        await page.setContent(pdfHtml, { waitUntil: "networkidle0" });

        const pdf = await page.pdf({
          format: "A4",
          printBackground: true,
          margin: {
            top: "12mm",
            right: "12mm",
            bottom: "12mm",
            left: "12mm",
          },
        });

        pdfBuffer = Buffer.from(pdf);
      } finally {
        await browser.close();
      }
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: sendTo,
      cc: cc || undefined,
      bcc: bcc || undefined,
      subject: subject || `Delivery Challan ${challan.challan_number}`,
      html:
        body ||
        `
          <div style="font-family:Arial,sans-serif;color:#111827;">
            <h2>Delivery Challan</h2>
            <p>Hello ${challan.customer_name || "Customer"},</p>
            <p>Please find attached your delivery challan.</p>
            <p>Regards,<br/>FlexLoud</p>
          </div>
        `,
      attachments: pdfBuffer
        ? [
            {
              filename: `${challan.challan_number || "delivery-challan"}.pdf`,
              content: pdfBuffer,
              contentType: "application/pdf",
            },
          ]
        : [],
    });

    return res.status(200).json({
      statusCode: 200,
      message: "Delivery challan email sent successfully",
      data: {
        id: challan.id,
        challan_number: challan.challan_number,
        sent_to: sendTo,
        pdf_attached: Boolean(pdfBuffer),
      },
    });
  } catch (error) {
    console.error("Send delivery challan email error:", error);

    return res.status(500).json({
      statusCode: 500,
      message: "Failed to send delivery challan email",
      data: null,
    });
  }
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
