import { Request, Response } from "express";
import nodemailer from "nodemailer";
import puppeteer from "puppeteer";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";

type UserContextRequest = Request & {
  user?: {
    id?: string;
    tenantId?: string;
    email?: string;
    name?: string;
    full_name?: string;
  };
};

function money(value: any) {
  const num = Number(value || 0);

  return num.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  });
}

function safe(value: any) {
  return value ?? "";
}

function formatDate(value: any) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN");
}

function buildRegisteredAddress(quote: any) {
  return [
    quote.org_registered_street,
    quote.org_registered_area,
    quote.org_registered_city,
    quote.org_registered_state,
    quote.org_registered_country,
    quote.org_registered_postal_code,
  ]
    .filter(Boolean)
    .join(", ");
}

async function getQuoteFullDetails(tenantId: string, quoteId: string) {
  const quoteRes = await pool.query(
    `
    SELECT 
      q.*,

      org.name AS organization_name_display,
      org.email AS organization_email,
      org.gst_number AS organization_gst_number,
      org.type AS organization_type,
      org.industry AS organization_industry,

      org.registered_street AS org_registered_street,
      org.registered_area AS org_registered_area,
      org.registered_postal_code AS org_registered_postal_code,
      org.registered_city AS org_registered_city,
      org.registered_state AS org_registered_state,
      org.registered_country AS org_registered_country,

      org.registered_city_id AS org_registered_city_id,
      org.registered_state_id AS org_registered_state_id,
      org.registered_country_id AS org_registered_country_id,

      TRIM(CONCAT(c.first_name, ' ', c.last_name)) AS contact_name_display,
      c.email AS contact_email,
      c.mobile AS contact_mobile,

      COALESCE(u.name, u.name, u.email) AS assigned_to_name,
      u.email AS assigned_to_email

    FROM quotes q
    LEFT JOIN organizations org 
      ON org.id = q.organization_id
      AND org.tenant_id = q.tenant_id
    LEFT JOIN contacts c 
      ON c.id = q.contact_id
      AND c.tenant_id = q.tenant_id
    LEFT JOIN users u 
      ON u.id = q.assigned_to
    WHERE q.tenant_id = $1
      AND q.id = $2
      AND q.deleted_at IS NULL
    LIMIT 1
    `,
    [tenantId, quoteId],
  );

  if (!quoteRes.rows.length) return null;

  const quote = quoteRes.rows[0];

  const itemsRes = await pool.query(
    `
    SELECT 
      qi.*,

      COALESCE(p.name, qi.product_name, qi.service_name) AS product_name,
      p.name AS product_master_name,
      p.part_number,
      COALESCE(p.hsn_code, qi.hsn_code) AS hsn_code

    FROM quote_line_items qi
    LEFT JOIN products p 
      ON p.id = qi.product_id
      AND p.tenant_id = qi.tenant_id
    WHERE qi.tenant_id = $1
      AND qi.quote_id = $2
      AND qi.deleted_at IS NULL
    ORDER BY qi.sort_order ASC, qi.created_at ASC
    `,
    [tenantId, quoteId],
  );

  return {
    ...quote,
    items: itemsRes.rows,
  };
}

function getItemsTaxTotal(items: any[] = []) {
  return items.reduce((sum, item) => {
    return (
      sum + Number(item.tax_amount || item.cgst || 0) + Number(item.sgst || 0)
    );
  }, 0);
}

function buildQuotePdfHtml(quote: any) {
  const quoteNo =
    quote.quote_number || quote.quote_no || quote.quote_display_id || quote.id;

  const address = buildRegisteredAddress(quote);

  const rows = (quote.items || [])
    .map((item: any, index: number) => {
      const productName =
        item.product_name ||
        item.product_display_name ||
        item.product_master_name ||
        item.service_name ||
        item.description ||
        item.name ||
        "-";

      const qty = item.quantity || item.qty || 0;
      const rate =
        item.sale_price || item.list_price || item.unit_price || item.rate || 0;
      const discount = item.discount_value || item.discount || 0;
      const tax = item.tax_rate || item.tax || 0;
      const total = item.line_total || item.total || 0;

      return `
      <tr>
        <td>${index + 1}</td>
        <td>
          <b>${safe(productName)}</b>
          ${item.part_number ? `<br/><small>Part No: ${safe(item.part_number)}</small>` : ""}
          ${item.hsn_code ? `<br/><small>HSN: ${safe(item.hsn_code)}</small>` : ""}
          ${item.description ? `<br/><small>${safe(item.description)}</small>` : ""}
        </td>
        <td class="right">${safe(qty)}</td>
        <td class="right">${money(rate)}</td>
        <td class="right">${safe(discount)}</td>
        <td class="right">${safe(tax)}%</td>
        <td class="right">${money(total)}</td>
      </tr>
    `;
    })
    .join("");

  return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Quote ${quoteNo}</title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      font-family: Arial, sans-serif;
      color: #172033;
      padding: 28px;
      font-size: 13px;
    }

    .header {
      display: flex;
      justify-content: space-between;
      border-bottom: 2px solid #2563eb;
      padding-bottom: 18px;
      margin-bottom: 24px;
    }

    .brand {
      font-size: 24px;
      font-weight: 700;
      color: #2563eb;
    }

    .quote-title {
      text-align: right;
    }

    .quote-title h1 {
      margin: 0;
      font-size: 26px;
      color: #111827;
    }

    .quote-title p {
      margin: 6px 0 0;
      color: #6b7280;
    }

    .section {
      margin-bottom: 22px;
    }

    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
    }

    .box {
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      padding: 14px;
      background: #fafafa;
    }

    .box-title {
      font-weight: 700;
      margin-bottom: 8px;
      color: #111827;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
    }

    th {
      background: #eff6ff;
      color: #1e3a8a;
      text-align: left;
      padding: 10px;
      border: 1px solid #dbeafe;
      font-size: 12px;
    }

    td {
      padding: 10px;
      border: 1px solid #e5e7eb;
      vertical-align: top;
    }

    .right {
      text-align: right;
    }

    .totals {
      margin-left: auto;
      width: 320px;
      margin-top: 22px;
    }

    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 9px 0;
      border-bottom: 1px solid #e5e7eb;
    }

    .grand {
      font-size: 18px;
      font-weight: 700;
      color: #dc2626;
    }

    .footer {
      margin-top: 40px;
      color: #6b7280;
      font-size: 12px;
      border-top: 1px solid #e5e7eb;
      padding-top: 12px;
    }
  </style>
</head>

<body>
  <div class="header">
    <div>
      <div class="brand">FlexLoud</div>
      <div>Quote Document</div>
    </div>

    <div class="quote-title">
      <h1>Quote #${safe(quoteNo)}</h1>
      <p>Date: ${formatDate(quote.quotation_date)}</p>
      <p>Valid Until: ${formatDate(quote.valid_until)}</p>
    </div>
  </div>

  <div class="section grid">
    <div class="box">
      <div class="box-title">Customer Details</div>
      <div><b>${safe(quote.organization_name_display || quote.contact_name_display || "Customer")}</b></div>
      <div>${safe(quote.contact_name_display)}</div>
      <div>${safe(quote.contact_email || quote.organization_email)}</div>
      <div>${safe(quote.contact_mobile)}</div>
      ${
        quote.organization_gst_number
          ? `<div><b>GST:</b> ${safe(quote.organization_gst_number)}</div>`
          : ""
      }
      <div style="margin-top: 8px;">${safe(address)}</div>
    </div>

    <div class="box">
      <div class="box-title">Quote Info</div>
      <div><b>Quote No:</b> ${safe(quoteNo)}</div>
      <div><b>Subject:</b> ${safe(quote.title || quote.subject)}</div>
      <div><b>Status:</b> ${safe(quote.status || quote.quote_stage)}</div>
      <div><b>Assigned To:</b> ${safe(quote.assigned_to_name)}</div>
    </div>
  </div>

  <div class="section">
    <div class="box-title">Selected Products</div>

    <table>
      <thead>
        <tr>
          <th style="width:40px;">#</th>
          <th>Product</th>
          <th class="right">Qty</th>
          <th class="right">Rate</th>
          <th class="right">Discount</th>
          <th class="right">Tax</th>
          <th class="right">Total</th>
        </tr>
      </thead>

      <tbody>
        ${
          rows ||
          `
          <tr>
            <td colspan="7" style="text-align:center;">No products found</td>
          </tr>
        `
        }
      </tbody>
    </table>

    <div class="totals">
      <div class="totals-row">
        <span>Sub Total</span>
        <b>${money(quote.subtotal)}</b>
      </div>

      <div class="totals-row">
        <span>Discount</span>
        <b>${money(quote.discount_amount || quote?.discount)}</b>
      </div>

      <div class="totals-row">
        <span>Tax</span>
    <b>${money(quote.tax || quote.tax_amount || getItemsTaxTotal(quote.items))}</b>
      </div>

      <div class="totals-row grand">
        <span>Grand Total</span>
        <span>${money(quote.grand_total || quote.total_amount || quote.amount)}</span>
      </div>
    </div>
  </div>

  ${
    quote.terms_and_conditions || quote.terms
      ? `
      <div class="section">
        <div class="box-title">Terms & Conditions</div>
        <div>${safe(quote.terms_and_conditions || quote.terms)}</div>
      </div>
    `
      : ""
  }

  <div class="footer">
    This quote was generated from FlexLoud CRM.
  </div>
</body>
</html>
`;
}

export async function previewQuotePdfHandler(
  req: UserContextRequest,
  res: Response,
) {
  const tenantId = getTenantId(req);
  const { id } = req.params;

  if (!tenantId) {
    return res.status(401).json({ message: "Unauthorized: tenant missing" });
  }

  if (!id) {
    return res.status(400).json({ message: "Quote id is required" });
  }

  try {
    const quote = await getQuoteFullDetails(tenantId, id);

    if (!quote) {
      return res.status(404).json({ message: "Quote not found" });
    }

    const quoteNo =
      quote.quote_number ||
      quote.quote_no ||
      quote.quote_display_id ||
      quote.id;

    const pdfBuffer = await generateQuotePdfBuffer(quote);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${quoteNo}.pdf"`);

    return res.send(pdfBuffer);
  } catch (error: any) {
    console.error("previewQuotePdfHandler error:", error);

    return res.status(500).json({
      message: error?.message || "Failed to preview quote PDF",
    });
  }
}

async function generateQuotePdfBuffer(quote: any) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    await page.setContent(buildQuotePdfHtml(quote), {
      waitUntil: "domcontentloaded",
    });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "12mm",
        right: "10mm",
        bottom: "12mm",
        left: "10mm",
      },
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

function buildEmailHtml(body: string, quote: any) {
  const quoteNo =
    quote.quote_number || quote.quote_no || quote.quote_display_id || quote.id;

  const quoteAmount = money(
    quote.grand_total || quote.total_amount || quote.amount,
  );

  return `
  <div style="font-family: Arial, sans-serif; color:#172033; line-height:1.6;">
    ${body || ""}

    <div style="margin-top:24px; padding:18px; border:1px solid #e5e7eb; border-radius:12px; background:#fffef2;">
      <div style="font-size:13px; color:#6b7280;">Quote Amount</div>
      <div style="font-size:24px; font-weight:700; color:#dc2626;">${quoteAmount}</div>

      <div style="margin-top:16px;">
        <b>Quote No:</b> ${safe(quoteNo)}<br/>
        <b>Quote Date:</b> ${formatDate(quote.quotation_date)}
      </div>
    </div>

    <p style="margin-top:24px;">
      Regards,<br/>
      ${safe(quote.assigned_to_name || "FlexLoud Team")}<br/>
      FlexLoud
    </p>
  </div>
  `;
}

export async function sendQuoteEmailHandler(
  req: UserContextRequest,
  res: Response,
) {
  const tenantId = getTenantId(req);
  const { id } = req.params;

  const { to, cc, bcc, subject, body, attachPdf = true } = req.body || {};

  if (!tenantId) {
    return res.status(401).json({ message: "Unauthorized: tenant missing" });
  }

  if (!id) {
    return res.status(400).json({ message: "Quote id is required" });
  }

  if (!to || !String(to).trim()) {
    return res.status(400).json({ message: "Send To email is required" });
  }

  try {
    const quote = await getQuoteFullDetails(tenantId, id);

    if (!quote) {
      return res.status(404).json({ message: "Quote not found" });
    }

    const quoteNo =
      quote.quote_number ||
      quote.quote_no ||
      quote.quote_display_id ||
      quote.id;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const attachments: nodemailer.SendMailOptions["attachments"] = [];

    if (attachPdf) {
      const pdfBuffer = await generateQuotePdfBuffer(quote);

      attachments.push({
        filename: `${quoteNo}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      });
    }

    await transporter.sendMail({
      from: `"${process.env.SMTP_FROM_NAME || "FlexLoud"}" <${
        process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER
      }>`,
      to,
      cc,
      bcc,
      subject: subject || `Quote - ${quoteNo} is awaiting your approval`,
      html: buildEmailHtml(body, quote),
      attachments,
    });

    await pool
      .query(
        `
        INSERT INTO quote_timeline (
          tenant_id,
          quote_id,
          event_type,
          title,
          description,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          tenantId,
          id,
          "email_sent",
          "Quote email sent",
          `Quote email sent to ${to}`,
          req.user?.id || null,
        ],
      )
      .catch(() => null);

    return res.json({
      success: true,
      message: "Quote email sent successfully",
    });
  } catch (error: any) {
    console.error("sendQuoteEmailHandler error:", error);

    return res.status(500).json({
      message: error?.message || "Failed to send quote email",
    });
  }
}
