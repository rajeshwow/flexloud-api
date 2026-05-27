import { pool } from "../../db/pool";
import { processPendingNotificationJobs } from "./notifications.scheduler";

function escapeHtml(value: any) {
  if (value === null || value === undefined) return "";

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function enqueueQuoteAssignedNotification(params: {
  tenantId: string;
  quoteId: string;
  assignedTo: string;
  title?: string | null;
  quoteNumber?: string | null;
  companyName?: string | null;
  grandTotal?: string | number | null;
  assignedBy?: string | null;
  sendInstantly?: boolean;
}) {
  const {
    tenantId,
    quoteId,
    assignedTo,
    title,
    quoteNumber,
    companyName,
    grandTotal,
    assignedBy,
    sendInstantly = true,
  } = params;

  if (!tenantId || !quoteId || !assignedTo) {
    return;
  }

  const quoteLabel = quoteNumber || title || quoteId;

  const metaResult = await pool.query(
    `
  SELECT
    u.id AS recipient_user_id,
    u.email AS recipient_email,

    COALESCE(
      NULLIF(u.name, ''),
      u.email
    ) AS recipient_name,

    COALESCE(
      NULLIF(assigned_by_user.name, ''),
      assigned_by_user.email,
      'System'
    ) AS assigned_by_name,

    t.slug AS tenant_slug,

    q.quote_number AS db_quote_number,
    q.title AS db_title,
    q.grand_total AS db_grand_total,
    q.company_name AS db_company_name,
    q.quote_stage AS quote_stage_text

  FROM users u

  LEFT JOIN users assigned_by_user
    ON assigned_by_user.tenant_id = u.tenant_id
   AND assigned_by_user.id = $3

  LEFT JOIN tenants t
    ON t.id = u.tenant_id

  LEFT JOIN quotes q
    ON q.tenant_id = u.tenant_id
   AND q.id = $4
   AND q.deleted_at IS NULL

  WHERE u.tenant_id = $1
    AND u.id = $2
    AND u.email IS NOT NULL
  LIMIT 1
  `,
    [tenantId, assignedTo, assignedBy || null, quoteId],
  );
  const meta = metaResult.rows[0];

  if (!meta?.recipient_email) {
    return;
  }

  const finalQuoteNumber = quoteNumber || meta.db_quote_number || "-";
  const finalTitle = title || meta.db_title || "-";
  const finalCompanyName = companyName || meta.db_company_name || "-";
  const finalGrandTotal = grandTotal ?? meta.db_grand_total ?? "-";
  const finalStage = meta.quote_stage_text || "-";
  const assignedByText = meta.assigned_by_name || "System";

  const frontendBaseUrl = String(process.env.FRONTEND_URL || "").replace(
    /\/$/,
    "",
  );
  const tenantSlug = meta.tenant_slug || "";

  const quoteUrl =
    frontendBaseUrl && tenantSlug
      ? `${frontendBaseUrl}/${tenantSlug}/quotes/${quoteId}`
      : "";

  const formattedAmount =
    finalGrandTotal === "-"
      ? "-"
      : `₹ ${Number(finalGrandTotal || 0).toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;

  const emailBody = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>

      <body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:28px 12px;">
          <tr>
            <td align="center">
              <table width="100%" cellpadding="0" cellspacing="0" style="max-width:660px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e5e7eb;box-shadow:0 14px 35px rgba(15,23,42,0.10);">

                <tr>
                  <td style="background:linear-gradient(135deg,#312e81,#4f46e5);padding:28px 30px;color:#ffffff;">
                    <div style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.85;">
                      CRM Quote Notification
                    </div>

                    <h1 style="margin:10px 0 0;font-size:26px;line-height:1.25;font-weight:700;">
                      Quote Assigned
                    </h1>

                    <p style="margin:10px 0 0;font-size:15px;line-height:1.6;opacity:0.95;">
                      A quote has been assigned to you. Please review the quote details and take the next action.
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding:30px;">
                    <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#374151;">
                      Hi ${escapeHtml(meta.recipient_name || "there")},
                    </p>

                    <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
                      You have received a new quote assignment in CRM. Below are the important details:
                    </p>

                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
                      <tr>
                        <td width="50%" style="padding-right:8px;">
                          <div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:14px;padding:16px;">
                            <div style="font-size:12px;color:#4338ca;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">
                              Quote Amount
                            </div>
                            <div style="margin-top:8px;font-size:24px;font-weight:800;color:#111827;">
                              ${escapeHtml(formattedAmount)}
                            </div>
                          </div>
                        </td>

                        <td width="50%" style="padding-left:8px;">
                          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:16px;">
                            <div style="font-size:12px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">
                              Current Stage
                            </div>
                            <div style="margin-top:10px;">
                              <span style="display:inline-block;background:#dcfce7;color:#166534;border-radius:999px;padding:7px 13px;font-size:12px;font-weight:800;">
                                ${escapeHtml(finalStage)}
                              </span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    </table>

                    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
                      <tr>
                        <td style="padding:16px 18px;border-bottom:1px solid #e5e7eb;width:38%;font-size:13px;color:#6b7280;font-weight:600;">
                          Quote Number
                        </td>
                        <td style="padding:16px 18px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;font-weight:700;">
                          ${escapeHtml(finalQuoteNumber)}
                        </td>
                      </tr>

                      <tr>
                        <td style="padding:16px 18px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280;font-weight:600;">
                          Title
                        </td>
                        <td style="padding:16px 18px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">
                          ${escapeHtml(finalTitle)}
                        </td>
                      </tr>

                      <tr>
                        <td style="padding:16px 18px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280;font-weight:600;">
                          Company
                        </td>
                        <td style="padding:16px 18px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">
                          ${escapeHtml(finalCompanyName)}
                        </td>
                      </tr>

                      <tr>
                        <td style="padding:16px 18px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280;font-weight:600;">
                          Assigned By
                        </td>
                        <td style="padding:16px 18px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">
                          ${escapeHtml(assignedByText)}
                        </td>
                      </tr>

                      <tr>
                        <td style="padding:16px 18px;font-size:13px;color:#6b7280;font-weight:600;">
                          Assignment Type
                        </td>
                        <td style="padding:16px 18px;font-size:14px;color:#111827;">
                          Quote Assignment
                        </td>
                      </tr>
                    </table>

                    ${
                      quoteUrl
                        ? `
                          <div style="text-align:center;margin:30px 0 12px;">
                            <a href="${escapeHtml(quoteUrl)}"
                               style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:13px 24px;border-radius:10px;font-size:14px;font-weight:700;box-shadow:0 8px 18px rgba(79,70,229,0.28);">
                              Open Quote in CRM
                            </a>
                          </div>

                          <p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#6b7280;text-align:center;">
                            If the button does not work, copy and open this link:<br/>
                            <a href="${escapeHtml(quoteUrl)}" style="color:#4f46e5;text-decoration:none;word-break:break-all;">
                              ${escapeHtml(quoteUrl)}
                            </a>
                          </p>
                        `
                        : `
                          <div style="margin:26px 0 0;padding:14px 16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;color:#9a3412;font-size:13px;line-height:1.6;">
                            Quote URL could not be generated because FRONTEND_URL or tenant slug is missing.
                          </div>
                        `
                    }

                    <div style="margin-top:28px;padding:16px;background:#f8fafc;border-radius:12px;border:1px solid #e5e7eb;">
                      <p style="margin:0;font-size:13px;line-height:1.7;color:#475569;">
                        Suggested next step: review the quote, verify pricing and terms, then follow up with the customer or move the quote to the next stage.
                      </p>
                    </div>
                  </td>
                </tr>

                <tr>
                  <td style="padding:18px 30px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
                    <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7280;">
                      This is an automated notification from your CRM. Please do not reply to this email.
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  await pool.query(
    `
    INSERT INTO notification_jobs (
      tenant_id,
      module_key,
      event_key,
      entity_type,
      entity_id,
      recipient_user_id,
      recipient_email,
      subject,
      body,
      dedupe_key
    )
    VALUES (
      $1,
      'quotes',
      'quote_assigned',
      'quote',
      $2,
      $3,
      $4,
      $5,
      $6,
      $7
    )
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING
    `,
    [
      tenantId,
      quoteId,
      meta.recipient_user_id,
      meta.recipient_email,
      `Quote Assigned: ${quoteLabel}`,
      emailBody,
      `quote-assigned:${tenantId}:${quoteId}:${assignedTo}:${Date.now()}`,
    ],
  );

  if (sendInstantly) {
    await processPendingNotificationJobs();
  }
}

export async function enqueueLeadAssignedNotification(params: {
  tenantId: string;
  leadId: string;
  assignedTo: string;
  leadName?: string | null;
  companyName?: string | null;
  status?: string | null;
  assignedBy?: string | null;
  isReassigned?: boolean;
  sendInstantly?: boolean;
}) {
  const {
    tenantId,
    leadId,
    assignedTo,
    leadName,
    companyName,
    status,
    assignedBy,
    isReassigned = false,
    sendInstantly = true,
  } = params;

  if (!tenantId || !leadId || !assignedTo) {
    return;
  }

  const leadLabel = leadName || companyName || leadId;
  const eventKey = isReassigned ? "lead_reassigned" : "lead_assigned";
  const subjectPrefix = isReassigned ? "Lead Reassigned" : "New Lead Assigned";

  const metaResult = await pool.query(
    `
  SELECT
    u.id AS recipient_user_id,
    u.email AS recipient_email,
    COALESCE(
      NULLIF(u.name, ''),
      NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''),
      u.email
    ) AS recipient_name,

    COALESCE(
      NULLIF(assigned_by_user.name, ''),
      NULLIF(TRIM(CONCAT(COALESCE(assigned_by_user.first_name, ''), ' ', COALESCE(assigned_by_user.last_name, ''))), ''),
      assigned_by_user.email
    ) AS assigned_by_name,

    t.slug AS tenant_slug,

    COALESCE(
      NULLIF(status_mv.label, ''),
      NULLIF(status_mv.value, '')
    ) AS lead_status_text

  FROM users u

  LEFT JOIN users assigned_by_user
    ON assigned_by_user.tenant_id = u.tenant_id
   AND assigned_by_user.id = $3

  LEFT JOIN tenants t
    ON t.id = u.tenant_id

  LEFT JOIN leads l
    ON l.tenant_id = u.tenant_id
   AND l.id = $4
   AND l.deleted_at IS NULL

  LEFT JOIN master_values status_mv
    ON status_mv.id = l.status_id
   AND status_mv.tenant_id = l.tenant_id
   AND status_mv.deleted_at IS NULL

  WHERE u.tenant_id = $1
    AND u.id = $2
    AND u.email IS NOT NULL
  LIMIT 1
  `,
    [tenantId, assignedTo, assignedBy || null, leadId],
  );

  const meta = metaResult.rows[0];

  if (!meta?.recipient_email) {
    return;
  }

  const frontendBaseUrl = String(process.env.FRONTEND_URL || "").replace(
    /\/$/,
    "",
  );
  const tenantSlug = meta.tenant_slug || "";
  const leadUrl =
    frontendBaseUrl && tenantSlug
      ? `${frontendBaseUrl}/${tenantSlug}/leads/${leadId}`
      : "";

  const actionText = isReassigned ? "reassigned to you" : "assigned to you";
  const assignedByText = meta.assigned_by_name || "System";
  const currentStatus = status || meta.lead_status_text || "-";

  const emailBody = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:28px 12px;">
          <tr>
            <td align="center">
              <table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e5e7eb;box-shadow:0 14px 35px rgba(15,23,42,0.10);">
                
                <tr>
                  <td style="background:linear-gradient(135deg,#1e3a8a,#2563eb);padding:28px 30px;color:#ffffff;">
                    <div style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.85;">
                      CRM Lead Notification
                    </div>
                    <h1 style="margin:10px 0 0;font-size:26px;line-height:1.25;font-weight:700;">
                      ${escapeHtml(subjectPrefix)}
                    </h1>
                    <p style="margin:10px 0 0;font-size:15px;line-height:1.6;opacity:0.95;">
                      A lead has been ${escapeHtml(actionText)}. Please review the lead details and take the next action.
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding:30px;">
                    <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#374151;">
                      Hi ${escapeHtml(meta.recipient_name || "there")},
                    </p>

                    <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
                      You have received a lead assignment in CRM. Below are the important details:
                    </p>

                    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
                      <tr>
                        <td style="padding:16px 18px;border-bottom:1px solid #e5e7eb;width:38%;font-size:13px;color:#6b7280;font-weight:600;">
                          Lead
                        </td>
                        <td style="padding:16px 18px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;font-weight:700;">
                          ${escapeHtml(leadLabel)}
                        </td>
                      </tr>

                      <tr>
                        <td style="padding:16px 18px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280;font-weight:600;">
                          Company
                        </td>
                        <td style="padding:16px 18px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">
                          ${escapeHtml(companyName || "-")}
                        </td>
                      </tr>

                      <tr>
                        <td style="padding:16px 18px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280;font-weight:600;">
                          Current Status
                        </td>
                        <td style="padding:16px 18px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">
                          <span style="display:inline-block;background:#e0f2fe;color:#075985;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:700;">
                           ${escapeHtml(currentStatus)}
                          </span>
                        </td>
                      </tr>

                      <tr>
                        <td style="padding:16px 18px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280;font-weight:600;">
                          Assigned By
                        </td>
                        <td style="padding:16px 18px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">
                          ${escapeHtml(assignedByText)}
                        </td>
                      </tr>

                      <tr>
                        <td style="padding:16px 18px;font-size:13px;color:#6b7280;font-weight:600;">
                          Assignment Type
                        </td>
                        <td style="padding:16px 18px;font-size:14px;color:#111827;">
                          ${isReassigned ? "Reassignment" : "New Assignment"}
                        </td>
                      </tr>
                    </table>

                    ${
                      leadUrl
                        ? `
                          <div style="text-align:center;margin:30px 0 12px;">
                            <a href="${escapeHtml(leadUrl)}"
                               style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:13px 24px;border-radius:10px;font-size:14px;font-weight:700;box-shadow:0 8px 18px rgba(37,99,235,0.28);">
                              Open Lead in CRM
                            </a>
                          </div>

                          <p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#6b7280;text-align:center;">
                            If the button does not work, copy and open this link:<br/>
                            <a href="${escapeHtml(leadUrl)}" style="color:#2563eb;text-decoration:none;word-break:break-all;">
                              ${escapeHtml(leadUrl)}
                            </a>
                          </p>
                        `
                        : `
                          <div style="margin:26px 0 0;padding:14px 16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;color:#9a3412;font-size:13px;line-height:1.6;">
                            Lead URL could not be generated because FRONTEND_URL or tenant slug is missing.
                          </div>
                        `
                    }

                    <div style="margin-top:28px;padding:16px;background:#f8fafc;border-radius:12px;border:1px solid #e5e7eb;">
                      <p style="margin:0;font-size:13px;line-height:1.7;color:#475569;">
                        Suggested next step: review the lead profile, update follow-up details, and contact the customer as soon as possible.
                      </p>
                    </div>
                  </td>
                </tr>

                <tr>
                  <td style="padding:18px 30px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
                    <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7280;">
                      This is an automated notification from your CRM. Please do not reply to this email.
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  await pool.query(
    `
    INSERT INTO notification_jobs (
      tenant_id,
      module_key,
      event_key,
      entity_type,
      entity_id,
      recipient_user_id,
      recipient_email,
      subject,
      body,
      dedupe_key
    )
    VALUES (
      $1,
      'leads',
      $2,
      'lead',
      $3,
      $4,
      $5,
      $6,
      $7,
      $8
    )
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING
    `,
    [
      tenantId,
      eventKey,
      leadId,
      meta.recipient_user_id,
      meta.recipient_email,
      `${subjectPrefix}: ${leadLabel}`,
      emailBody,
      `lead-${isReassigned ? "reassigned" : "assigned"}:${tenantId}:${leadId}:${assignedTo}:${Date.now()}`,
    ],
  );

  if (sendInstantly) {
    await processPendingNotificationJobs();
  }
}
