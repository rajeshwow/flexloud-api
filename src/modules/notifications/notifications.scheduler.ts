import cron from "node-cron";
import { env } from "../../config/env";
import { pool } from "../../db/pool";
import { sendNotificationEmail } from "./notifications.mailer";

type JobResult = {
  name: string;
  ok: boolean;
  error?: string;
};

let schedulerStarted = false;
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

type AttendanceDistanceRow = {
  tenant_id: string;
  tenant_name: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  attendance_date: string | Date;
  session_no: number | string | null;
  clock_in_at: string | Date | null;
  clock_out_at: string | Date | null;
  clock_in_lat: number | string | null;
  clock_in_lng: number | string | null;
  clock_in_address: string | null;
  clock_out_lat: number | string | null;
  clock_out_lng: number | string | null;
  clock_out_address: string | null;
};

type AttendanceDistanceViolation = {
  tenantId: string;
  tenantName: string;
  userId: string;
  userName: string;
  userEmail: string;
  attendanceDate: string;
  weekday: string;
  sessionNo: number;
  clockInAt: string | null;
  clockOutAt: string | null;
  clockInLat: number;
  clockInLng: number;
  clockInAddress: string | null;
  clockOutLat: number;
  clockOutLng: number;
  clockOutAddress: string | null;
  distanceKm: number;
};

type VisitDistanceRow = {
  tenant_id: string;
  tenant_name: string;
  visit_id: string;
  visit_name: string | null;
  assigned_to_user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  start_date: string | Date | null;
  end_date: string | Date | null;
  checkin_captured_at: string | Date | null;
  checkout_captured_at: string | Date | null;
  checkin_latitude: number | string | null;
  checkin_longitude: number | string | null;
  checkin_address: string | null;
  checkout_latitude: number | string | null;
  checkout_longitude: number | string | null;
  checkout_address: string | null;
};

type VisitDistanceViolation = {
  tenantId: string;
  tenantName: string;
  visitId: string;
  visitName: string;
  userId: string;
  userName: string;
  userEmail: string;
  visitDate: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  clockInLat: number;
  clockInLng: number;
  clockInAddress: string | null;
  clockOutLat: number;
  clockOutLng: number;
  clockOutAddress: string | null;
  distanceKm: number;
};

function esc(value: any) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDateOnly(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateTime(value: string | Date | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleString("en-IN", {
    timeZone: env.ATTENDANCE_DISTANCE_REPORT_TIMEZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function getPreviousWeekRange(referenceDate = new Date()) {
  const end = new Date(referenceDate);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() - 1);

  const start = new Date(end);
  start.setDate(end.getDate() - 6);
  start.setHours(0, 0, 0, 0);

  return {
    startDate: formatDateOnly(start),
    endDate: formatDateOnly(end),
  };
}

function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
) {
  const earthRadiusKm = 6371;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latDiff = toRadians(lat2 - lat1);
  const lngDiff = toRadians(lng2 - lng1);
  const a =
    Math.sin(latDiff / 2) * Math.sin(latDiff / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(lngDiff / 2) *
      Math.sin(lngDiff / 2);

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildAttendanceDistanceReportHtml(params: {
  tenantName: string;
  rangeStart: string;
  rangeEnd: string;
  thresholdKm: number;
  rows: AttendanceDistanceViolation[];
  visitRows?: VisitDistanceViolation[];
}) {
  const tableRows = params.rows
    .map(
      (row) => `
        <tr>
          <td style="padding:8px;border:1px solid #d1d5db;">${esc(row.userName)}</td>
          <td style="padding:8px;border:1px solid #d1d5db;">${esc(row.userEmail)}</td>
          <td style="padding:8px;border:1px solid #d1d5db;">${esc(row.attendanceDate)} (${esc(row.weekday)})</td>
          <td style="padding:8px;border:1px solid #d1d5db;">${esc(row.sessionNo)}</td>
          <td style="padding:8px;border:1px solid #d1d5db;">${esc(row.clockInAt || "-")}</td>
          <td style="padding:8px;border:1px solid #d1d5db;">${esc(row.clockOutAt || "-")}</td>
          <td style="padding:8px;border:1px solid #d1d5db;">
            <div><b>Lat/Lng:</b> ${esc(row.clockInLat.toFixed(6))}, ${esc(row.clockInLng.toFixed(6))}</div>
            <div><b>Address:</b> ${esc(row.clockInAddress || "-")}</div>
          </td>
          <td style="padding:8px;border:1px solid #d1d5db;">
            <div><b>Lat/Lng:</b> ${esc(row.clockOutLat.toFixed(6))}, ${esc(row.clockOutLng.toFixed(6))}</div>
            <div><b>Address:</b> ${esc(row.clockOutAddress || "-")}</div>
          </td>
          <td style="padding:8px;border:1px solid #d1d5db;text-align:right;">${esc(row.distanceKm.toFixed(2))}</td>
        </tr>
      `,
    )
    .join("");

  const visitTableRows = (params.visitRows || [])
    .map(
      (row) => `
        <tr>
          <td style="padding:8px;border:1px solid #d1d5db;">${esc(row.visitName)}</td>
          <td style="padding:8px;border:1px solid #d1d5db;">${esc(row.userName)}</td>
          <td style="padding:8px;border:1px solid #d1d5db;">${esc(row.userEmail)}</td>
          <td style="padding:8px;border:1px solid #d1d5db;">${esc(row.visitDate)}</td>
          <td style="padding:8px;border:1px solid #d1d5db;">${esc(row.clockInAt || "-")}</td>
          <td style="padding:8px;border:1px solid #d1d5db;">${esc(row.clockOutAt || "-")}</td>
          <td style="padding:8px;border:1px solid #d1d5db;">
            <div><b>Lat/Lng:</b> ${esc(row.clockInLat.toFixed(6))}, ${esc(row.clockInLng.toFixed(6))}</div>
            <div><b>Address:</b> ${esc(row.clockInAddress || "-")}</div>
          </td>
          <td style="padding:8px;border:1px solid #d1d5db;">
            <div><b>Lat/Lng:</b> ${esc(row.clockOutLat.toFixed(6))}, ${esc(row.clockOutLng.toFixed(6))}</div>
            <div><b>Address:</b> ${esc(row.clockOutAddress || "-")}</div>
          </td>
          <td style="padding:8px;border:1px solid #d1d5db;text-align:right;">${esc(row.distanceKm.toFixed(2))}</td>
        </tr>
      `,
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;color:#111827;">
      <p>Hello Admin,</p>
      <p>
        Weekly location distance report for <b>${esc(params.tenantName)}</b>.
        This report includes attendance sessions and visits where the distance between
        check-in and check-out coordinates was more than
        <b>${esc(params.thresholdKm)} km</b>.
      </p>
      <p><b>Period:</b> ${esc(params.rangeStart)} to ${esc(params.rangeEnd)}</p>
      <p><b>Flagged attendance sessions:</b> ${esc(params.rows.length)}</p>
      <p><b>Flagged visits:</b> ${esc((params.visitRows || []).length)}</p>
      <h3 style="margin-top:24px;">Attendance</h3>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <thead>
          <tr style="background:#f3f4f6;text-align:left;">
            <th style="padding:8px;border:1px solid #d1d5db;">User</th>
            <th style="padding:8px;border:1px solid #d1d5db;">Email</th>
            <th style="padding:8px;border:1px solid #d1d5db;">Date</th>
            <th style="padding:8px;border:1px solid #d1d5db;">Session</th>
            <th style="padding:8px;border:1px solid #d1d5db;">Check-in Time</th>
            <th style="padding:8px;border:1px solid #d1d5db;">Check-out Time</th>
            <th style="padding:8px;border:1px solid #d1d5db;">Check-in Location</th>
            <th style="padding:8px;border:1px solid #d1d5db;">Check-out Location</th>
            <th style="padding:8px;border:1px solid #d1d5db;">Distance (km)</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
      <h3 style="margin-top:24px;">Visits</h3>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <thead>
          <tr style="background:#f3f4f6;text-align:left;">
            <th style="padding:8px;border:1px solid #d1d5db;">Visit</th>
            <th style="padding:8px;border:1px solid #d1d5db;">User</th>
            <th style="padding:8px;border:1px solid #d1d5db;">Email</th>
            <th style="padding:8px;border:1px solid #d1d5db;">Visit Date</th>
            <th style="padding:8px;border:1px solid #d1d5db;">Check-in Time</th>
            <th style="padding:8px;border:1px solid #d1d5db;">Check-out Time</th>
            <th style="padding:8px;border:1px solid #d1d5db;">Check-in Location</th>
            <th style="padding:8px;border:1px solid #d1d5db;">Check-out Location</th>
            <th style="padding:8px;border:1px solid #d1d5db;">Distance (km)</th>
          </tr>
        </thead>
        <tbody>${visitTableRows || '<tr><td colspan="9" style="padding:8px;border:1px solid #d1d5db;">No flagged visits</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

async function runSafely(
  name: string,
  fn: () => Promise<void>,
): Promise<JobResult> {
  try {
    await fn();
    return { name, ok: true };
  } catch (error: any) {
    console.error(
      `[Notification Scheduler] ${name} failed:`,
      error?.message || error,
    );
    return {
      name,
      ok: false,
      error: error?.message || "Unknown error",
    };
  }
}

async function insertLeadAssignmentJobs() {
  await pool.query(`
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
    SELECT
      l.tenant_id,
      'leads',
      'lead_assigned',
      'lead',
      l.id,
      u.id,
      u.email,
      'New Lead Assigned: ' || COALESCE(
        NULLIF(TRIM(CONCAT(COALESCE(l.first_name, ''), ' ', COALESCE(l.last_name, ''))), ''),
        l.organization_name,
        l.lead_display_id,
        l.lead_number,
        'Lead'
      ),
      '<p>Hello ' || COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.name, u.email) || ',</p>' ||
      '<p>A new lead has been assigned to you.</p>' ||
      '<p><b>Lead:</b> ' || COALESCE(
        NULLIF(TRIM(CONCAT(COALESCE(l.first_name, ''), ' ', COALESCE(l.last_name, ''))), ''),
        l.organization_name,
        l.lead_display_id,
        l.lead_number,
        'Lead'
      ) || '</p>' ||
      '<p><b>Status:</b> ' || COALESCE(l.status_id::text, '-') || '</p>',
      'lead-assigned:' || l.tenant_id || ':' || l.id || ':' || l.assigned_to
    FROM leads l
    JOIN users u
      ON u.tenant_id = l.tenant_id
     AND u.id = l.assigned_to
    WHERE l.deleted_at IS NULL
      AND l.assigned_to IS NOT NULL
      AND u.email IS NOT NULL
      AND l.created_at >= now() - INTERVAL '2 days'
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;
  `);
}

async function insertLeadFollowupJobs() {
  await pool.query(`
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
    SELECT
      l.tenant_id,
      'leads',
      'lead_followup_due',
      'lead',
      l.id,
      u.id,
      u.email,
      'Lead Follow-up Due: ' || COALESCE(
        NULLIF(TRIM(CONCAT(COALESCE(l.first_name, ''), ' ', COALESCE(l.last_name, ''))), ''),
        l.organization_name,
        l.lead_display_id,
        l.lead_number,
        'Lead'
      ),
      '<p>Hello ' || COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.name, u.email) || ',</p>' ||
      '<p>A lead follow-up is due.</p>' ||
      '<p><b>Lead:</b> ' || COALESCE(
        NULLIF(TRIM(CONCAT(COALESCE(l.first_name, ''), ' ', COALESCE(l.last_name, ''))), ''),
        l.organization_name,
        l.lead_display_id,
        l.lead_number,
        'Lead'
      ) || '</p>' ||
      '<p><b>Follow-up Date:</b> ' || COALESCE(l.next_followup::text, '-') || '</p>',
      'lead-followup:' || l.tenant_id || ':' || l.id || ':' || CURRENT_DATE
    FROM leads l
    JOIN users u
      ON u.tenant_id = l.tenant_id
     AND u.id = l.assigned_to
    WHERE l.deleted_at IS NULL
      AND l.assigned_to IS NOT NULL
      AND l.next_followup IS NOT NULL
      AND l.next_followup <= now()
      AND u.email IS NOT NULL
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;
  `);
}

async function insertOrganizationFollowupJobs() {
  await pool.query(`
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
    SELECT
      o.tenant_id,
      'organizations',
      'organization_followup_due',
      'organization',
      o.id,
      u.id,
      u.email,
      'Organization Follow-up Due: ' || COALESCE(o.name, 'Organization'),
      '<p>Hello ' || COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.name, u.email) || ',</p>' ||
      '<p>An organization follow-up is due.</p>' ||
      '<p><b>Organization:</b> ' || COALESCE(o.name, '-') || '</p>' ||
      '<p><b>Follow-up Date:</b> ' || COALESCE(o.next_followup_at::text, '-') || '</p>',
      'organization-followup:' || o.tenant_id || ':' || o.id || ':' || CURRENT_DATE
    FROM organizations o
    JOIN users u
      ON u.tenant_id = o.tenant_id
     AND u.id = o.assigned_to
    WHERE o.deleted_at IS NULL
      AND o.assigned_to IS NOT NULL
      AND o.next_followup_at IS NOT NULL
      AND o.next_followup_at <= now()
      AND u.email IS NOT NULL
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;
  `);
}

async function insertOrganizationAssignmentJobs() {
  await pool.query(`
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
    SELECT
      o.tenant_id,
      'organizations',
      'organization_assigned',
      'organization',
      o.id,
      u.id,
      u.email,
      'Organization Assigned: ' || COALESCE(o.name, 'Organization'),
      '<p>Hello ' || COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.name, u.email) || ',</p>' ||
      '<p>An organization has been assigned to you.</p>' ||
      '<p><b>Organization:</b> ' || COALESCE(o.name, '-') || '</p>',
      'organization-assigned:' || o.tenant_id || ':' || o.id || ':' || o.assigned_to
    FROM organizations o
    JOIN users u
      ON u.tenant_id = o.tenant_id
     AND u.id = o.assigned_to
    WHERE o.deleted_at IS NULL
      AND o.assigned_to IS NOT NULL
      AND u.email IS NOT NULL
      AND o.created_at >= now() - INTERVAL '2 days'
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;
  `);
}

async function insertQuoteAssignmentJobs() {
  await pool.query(`
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
    SELECT
      q.tenant_id,
      'quotes',
      'quote_assigned',
      'quote',
      q.id,
      u.id,
      u.email,
      'Quote Assigned: ' || COALESCE(q.quote_number, q.id::text),
      '<p>Hello ' || COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.name, u.email) || ',</p>' ||
      '<p>A quote has been assigned to you.</p>' ||
      '<p><b>Quote:</b> ' || COALESCE(q.quote_number, q.id::text) || '</p>' ||
      '<p><b>Amount:</b> ' || COALESCE(q.grand_total::text, '-') || '</p>',
      'quote-assigned:' || q.tenant_id || ':' || q.id || ':' || q.assigned_to
    FROM quotes q
    JOIN users u
      ON u.tenant_id = q.tenant_id
     AND u.id = q.assigned_to
    WHERE q.deleted_at IS NULL
      AND q.assigned_to IS NOT NULL
      AND u.email IS NOT NULL
      AND q.created_at >= now() - INTERVAL '2 days'
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;
  `);
}

async function insertQuoteExpiryJobs() {
  await pool.query(`
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
    SELECT
      q.tenant_id,
      'quotes',
      CASE
        WHEN q.valid_until::date = CURRENT_DATE THEN 'quote_expiring_today'
        WHEN q.valid_until::date < CURRENT_DATE THEN 'quote_expired'
        ELSE 'quote_expiring_soon'
      END,
      'quote',
      q.id,
      u.id,
      u.email,
      CASE
        WHEN q.valid_until::date < CURRENT_DATE
          THEN 'Quote Expired: ' || COALESCE(q.quote_number, q.id::text)
        ELSE 'Quote Expiry Alert: ' || COALESCE(q.quote_number, q.id::text)
      END,
      '<p>Hello ' || COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.name, u.email) || ',</p>' ||
      '<p>Quote expiry attention required.</p>' ||
      '<p><b>Quote:</b> ' || COALESCE(q.quote_number, q.id::text) || '</p>' ||
      '<p><b>Valid Until:</b> ' || COALESCE(q.valid_until::text, '-') || '</p>' ||
      '<p><b>Amount:</b> ' || COALESCE(q.grand_total::text, '-') || '</p>',
      'quote-expiry:' || q.tenant_id || ':' || q.id || ':' || CURRENT_DATE
    FROM quotes q
    JOIN users u
      ON u.tenant_id = q.tenant_id
     AND u.id = q.assigned_to
    WHERE q.deleted_at IS NULL
      AND q.assigned_to IS NOT NULL
      AND q.valid_until IS NOT NULL
      AND q.valid_until::date <= CURRENT_DATE + INTERVAL '2 days'
      AND COALESCE(q.quote_stage::text, '') NOT IN ('accepted', 'rejected', 'cancelled', 'converted', 'won', 'lost')
      AND u.email IS NOT NULL
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;
  `);
}

async function insertOpportunityAssignmentJobs() {
  await pool.query(`
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
    SELECT
      op.tenant_id,
      'opportunities',
      'opportunity_assigned',
      'opportunity',
      op.id,
      u.id,
      u.email,
      'Opportunity Assigned: ' || COALESCE(op.name, op.opportunity_number, op.id::text),
      '<p>Hello ' || COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.name, u.email) || ',</p>' ||
      '<p>An opportunity has been assigned to you.</p>' ||
      '<p><b>Opportunity:</b> ' || COALESCE(op.name, op.opportunity_number, op.id::text) || '</p>' ||
      '<p><b>Amount:</b> ' || COALESCE(op.amount::text, '-') || '</p>',
      'opportunity-assigned:' || op.tenant_id || ':' || op.id || ':' || op.assigned_to
    FROM opportunities op
    JOIN users u
      ON u.tenant_id = op.tenant_id
     AND u.id = op.assigned_to
    WHERE op.deleted_at IS NULL
      AND op.assigned_to IS NOT NULL
      AND u.email IS NOT NULL
      AND op.created_at >= now() - INTERVAL '2 days'
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;
  `);
}

async function insertOpportunityFollowupJobs() {
  await pool.query(`
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
    SELECT
      op.tenant_id,
      'opportunities',
      'opportunity_followup_due',
      'opportunity',
      op.id,
      u.id,
      u.email,
      'Opportunity Follow-up Due: ' || COALESCE(op.name, op.opportunity_number, op.id::text),
      '<p>Hello ' || COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.name, u.email) || ',</p>' ||
      '<p>An opportunity follow-up is due.</p>' ||
      '<p><b>Opportunity:</b> ' || COALESCE(op.name, op.opportunity_number, op.id::text) || '</p>' ||
      '<p><b>Follow-up Date:</b> ' || COALESCE(op.next_followup::text, '-') || '</p>',
      'opportunity-followup:' || op.tenant_id || ':' || op.id || ':' || CURRENT_DATE
    FROM opportunities op
    JOIN users u
      ON u.tenant_id = op.tenant_id
     AND u.id = op.assigned_to
    WHERE op.deleted_at IS NULL
      AND op.assigned_to IS NOT NULL
      AND op.next_followup IS NOT NULL
      AND op.next_followup <= now()
      AND u.email IS NOT NULL
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;
  `);
}

async function insertTaskAssignmentJobs() {
  await pool.query(`
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
    SELECT
      t.tenant_id,
      'tasks',
      'task_assigned',
      'task',
      t.id,
      u.id,
      u.email,
      'Task Assigned: ' || COALESCE(t.subject, t.task_number, t.id::text),
      '<p>Hello ' || COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.name, u.email) || ',</p>' ||
      '<p>A task has been assigned to you.</p>' ||
      '<p><b>Task:</b> ' || COALESCE(t.subject, t.task_number, t.id::text) || '</p>' ||
      '<p><b>Due:</b> ' || COALESCE(t.end_date::text, '-') || '</p>',
      'task-assigned:' || t.tenant_id || ':' || t.id || ':' || t.assigned_to
    FROM tasks t
    JOIN users u
      ON u.tenant_id = t.tenant_id
     AND u.id = t.assigned_to
    WHERE t.deleted_at IS NULL
      AND t.assigned_to IS NOT NULL
      AND u.email IS NOT NULL
      AND t.created_at >= now() - INTERVAL '2 days'
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;
  `);
}

async function insertTaskDueJobs() {
  await pool.query(`
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
    SELECT
      t.tenant_id,
      'tasks',
      CASE
        WHEN t.end_date::date < CURRENT_DATE THEN 'task_overdue'
        ELSE 'task_due'
      END,
      'task',
      t.id,
      u.id,
      u.email,
      CASE
        WHEN t.end_date::date < CURRENT_DATE
          THEN 'Task Overdue: ' || COALESCE(t.subject, t.task_number, t.id::text)
        ELSE 'Task Due: ' || COALESCE(t.subject, t.task_number, t.id::text)
      END,
      '<p>Hello ' || COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.name, u.email) || ',</p>' ||
      '<p>A task requires your attention.</p>' ||
      '<p><b>Task:</b> ' || COALESCE(t.subject, t.task_number, t.id::text) || '</p>' ||
      '<p><b>Due:</b> ' || COALESCE(t.end_date::text, '-') || '</p>',
      'task-due:' || t.tenant_id || ':' || t.id || ':' || CURRENT_DATE
    FROM tasks t
    JOIN users u
      ON u.tenant_id = t.tenant_id
     AND u.id = t.assigned_to
    WHERE t.deleted_at IS NULL
      AND t.assigned_to IS NOT NULL
      AND t.end_date IS NOT NULL
      AND t.end_date <= now()
      AND COALESCE(t.status::text, '') NOT IN ('completed', 'done', 'closed', 'cancelled')
      AND u.email IS NOT NULL
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;
  `);
}

async function insertVisitReminderJobs() {
  await pool.query(`
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
    SELECT
      v.tenant_id,
      'visits',
      'visit_due',
      'visit',
      v.id,
      u.id,
      u.email,
      'Visit Reminder: ' || COALESCE(v.name, v.id::text),
      '<p>Hello ' || COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.name, u.email) || ',</p>' ||
      '<p>A visit is scheduled.</p>' ||
      '<p><b>Visit:</b> ' || COALESCE(v.name, v.id::text) || '</p>' ||
      '<p><b>Time:</b> ' || COALESCE(v.start_date::text, v.checkin_captured_at::text, '-') || '</p>',
      'visit-due:' || v.tenant_id || ':' || v.id || ':' || CURRENT_DATE
    FROM visits v
    JOIN users u
      ON u.tenant_id = v.tenant_id
     AND u.id = v.assigned_to_user_id
    WHERE v.deleted_at IS NULL
      AND v.assigned_to_user_id IS NOT NULL
      AND COALESCE(v.start_date, v.checkin_captured_at) IS NOT NULL
      AND COALESCE(v.start_date, v.checkin_captured_at) <= now() + INTERVAL '1 hour'
      AND COALESCE(v.status::text, '') NOT IN ('completed', 'cancelled')
      AND u.email IS NOT NULL
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;
  `);
}

async function insertSalesOrderAssignmentJobs() {
  await pool.query(`
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
    SELECT
      so.tenant_id,
      'sales_orders',
      'sales_order_assigned',
      'sales_order',
      so.id,
      u.id,
      u.email,
      'Sales Order Assigned: ' || COALESCE(so.voucher_number, so.id::text),
      '<p>Hello ' || COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.name, u.email) || ',</p>' ||
      '<p>A sales order has been assigned to you.</p>' ||
      '<p><b>Sales Order:</b> ' || COALESCE(so.voucher_number, so.id::text) || '</p>' ||
      '<p><b>Amount:</b> ' || COALESCE(so.grand_total::text, so.total_amount::text, '-') || '</p>',
      'sales-order-assigned:' || so.tenant_id || ':' || so.id || ':' || so.assigned_to
    FROM sales_orders so
    JOIN users u
      ON u.tenant_id = so.tenant_id
     AND u.id = so.assigned_to
    WHERE so.deleted_at IS NULL
      AND so.assigned_to IS NOT NULL
      AND u.email IS NOT NULL
      AND so.created_at >= now() - INTERVAL '2 days'
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;
  `);
}

async function insertSalesOrderDispatchPendingJobs() {
  await pool.query(`
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
    SELECT
      so.tenant_id,
      'warehouse',
      'sales_order_dispatch_pending',
      'sales_order',
      so.id,
      u.id,
      u.email,
      'Sales Order Dispatch Pending: ' || COALESCE(so.voucher_number, so.id::text),
      '<p>Hello ' || COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.name, u.email) || ',</p>' ||
      '<p>A sales order is pending for dispatch.</p>' ||
      '<p><b>Sales Order:</b> ' || COALESCE(so.voucher_number, so.id::text) || '</p>' ||
      '<p><b>Status:</b> ' || COALESCE(so.status::text, '-') || '</p>',
      'sales-order-dispatch-pending:' || so.tenant_id || ':' || so.id || ':' || CURRENT_DATE
    FROM sales_orders so
    JOIN users u
      ON u.tenant_id = so.tenant_id
     AND u.id = so.assigned_to
    WHERE so.deleted_at IS NULL
      AND so.assigned_to IS NOT NULL
      AND COALESCE(so.status::text, '') IN ('ready_to_dispatch', 'packed', 'partially_dispatched')
      AND u.email IS NOT NULL
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;
  `);
}

async function insertPurchaseOrderAssignmentJobs() {
  await pool.query(`
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
    SELECT
      po.tenant_id,
      'purchase_orders',
      'purchase_order_assigned',
      'purchase_order',
      po.id,
      u.id,
      u.email,
      'Purchase Order Assigned: ' || COALESCE(po.voucher_number, po.id::text),
      '<p>Hello ' || COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.name, u.email) || ',</p>' ||
      '<p>A purchase order has been assigned to you.</p>' ||
      '<p><b>Purchase Order:</b> ' || COALESCE(po.voucher_number, po.id::text) || '</p>' ||
      '<p><b>Amount:</b> ' || COALESCE(po.total_amount::text, '-') || '</p>',
      'purchase-order-assigned:' || po.tenant_id || ':' || po.id || ':' || (po.raw_tally_data->>'assigned_to')
    FROM purchase_orders po
    JOIN users u
      ON u.tenant_id = po.tenant_id
     AND u.id::text = po.raw_tally_data->>'assigned_to'
    WHERE po.deleted_at IS NULL
      AND COALESCE(po.raw_tally_data->>'assigned_to', '') <> ''
      AND u.email IS NOT NULL
      AND po.created_at >= now() - INTERVAL '2 days'
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;
  `);
}

async function insertPurchaseOrderReceivePendingJobs() {
  await pool.query(`
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
    SELECT
      po.tenant_id,
      'warehouse',
      'purchase_order_receive_pending',
      'purchase_order',
      po.id,
      u.id,
      u.email,
      'Purchase Order Receive Pending: ' || COALESCE(po.voucher_number, po.id::text),
      '<p>Hello ' || COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.name, u.email) || ',</p>' ||
      '<p>A purchase order is pending for receiving.</p>' ||
      '<p><b>Purchase Order:</b> ' || COALESCE(po.voucher_number, po.id::text) || '</p>' ||
      '<p><b>Status:</b> ' || COALESCE(po.status::text, '-') || '</p>',
      'purchase-order-receive-pending:' || po.tenant_id || ':' || po.id || ':' || CURRENT_DATE
    FROM purchase_orders po
    JOIN users u
      ON u.tenant_id = po.tenant_id
     AND u.id::text = po.raw_tally_data->>'assigned_to'
    WHERE po.deleted_at IS NULL
      AND COALESCE(po.raw_tally_data->>'assigned_to', '') <> ''
      AND COALESCE(po.status::text, '') IN ('sent', 'pending_receive', 'partially_received')
      AND u.email IS NOT NULL
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;
  `);
}

async function insertOutstandingDueJobs() {
  await pool.query(`
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
    SELECT
      o.tenant_id,
      'tally',
      CASE
        WHEN o.due_date::date < CURRENT_DATE THEN 'outstanding_overdue'
        ELSE 'outstanding_due'
      END,
      'tally_outstanding',
      o.id,
      u.id,
      u.email,
      CASE
        WHEN o.due_date::date < CURRENT_DATE
          THEN 'Outstanding Overdue: ' || COALESCE(o.ledger_name, 'Ledger')
        ELSE 'Outstanding Due: ' || COALESCE(o.ledger_name, 'Ledger')
      END,
      '<p>Hello ' || COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.name, u.email) || ',</p>' ||
      '<p>An outstanding amount needs attention.</p>' ||
      '<p><b>Party:</b> ' || COALESCE(o.ledger_name, '-') || '</p>' ||
      '<p><b>Voucher:</b> ' || COALESCE(o.voucher_number, o.bill_ref, '-') || '</p>' ||
      '<p><b>Pending Amount:</b> ' || COALESCE(o.pending_amount::text, '0') || '</p>' ||
      '<p><b>Due Date:</b> ' || COALESCE(o.due_date::text, '-') || '</p>',
      'outstanding-due:' || o.tenant_id || ':' || o.id || ':' || CURRENT_DATE
    FROM tally_outstandings o
    LEFT JOIN organizations org
      ON org.tenant_id = o.tenant_id
     AND org.deleted_at IS NULL
     AND (
       o.ledger_name IS NOT NULL
       AND lower(trim(org.name)) = lower(trim(o.ledger_name))
     )
    JOIN users u
      ON u.tenant_id = o.tenant_id
     AND u.id = org.assigned_to
    WHERE o.deleted_at IS NULL
      AND COALESCE(o.pending_amount, 0) > 0
      AND o.due_date IS NOT NULL
      AND o.due_date::date <= CURRENT_DATE
      AND u.email IS NOT NULL
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;
  `);
}

async function insertManagerDailySummaryJobs() {
  await pool.query(`
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
    SELECT
      t.id,
      'summary',
      'daily_manager_summary',
      'tenant',
      t.id,
      u.id,
      u.email,
      'Daily CRM Summary',
      '<p>Hello ' || COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.name, u.email) || ',</p>' ||
      '<p>Here is today''s CRM attention summary.</p>' ||
      '<ul>' ||
      '<li><b>Pending notification jobs:</b> ' ||
        (
          SELECT COUNT(*)::text
          FROM notification_jobs nj
          WHERE nj.tenant_id = t.id
            AND nj.status = 'pending'
        ) ||
      '</li>' ||
      '<li><b>Failed notification jobs:</b> ' ||
        (
          SELECT COUNT(*)::text
          FROM notification_jobs nj
          WHERE nj.tenant_id = t.id
            AND nj.status = 'failed'
        ) ||
      '</li>' ||
      '</ul>',
      'daily-manager-summary:' || t.id || ':' || CURRENT_DATE
    FROM tenants t
    JOIN user_roles ur
      ON ur.tenant_id = t.id
    JOIN role_permissions rp
      ON rp.role_id = ur.role_id
     AND rp.permission_code = 'notifications.view'
    JOIN users u
      ON u.tenant_id = t.id
     AND u.id = ur.user_id
    WHERE u.email IS NOT NULL
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;
  `);
}

async function getAttendanceDistanceViolations(params: {
  rangeStart: string;
  rangeEnd: string;
  thresholdKm: number;
}) {
  const result = await pool.query<AttendanceDistanceRow>(
    `
    SELECT
      s.tenant_id,
      COALESCE(t.name, s.tenant_id) AS tenant_name,
      s.user_id,
      COALESCE(NULLIF(u.name, ''), NULLIF(u.display_name, ''), NULLIF(u.email, ''), s.user_id) AS user_name,
      u.email AS user_email,
      s.attendance_date,
      s.session_no,
      s.clock_in_at,
      s.clock_out_at,
      s.clock_in_lat,
      s.clock_in_lng,
      s.clock_in_address,
      s.clock_out_lat,
      s.clock_out_lng,
      s.clock_out_address
    FROM attendance_sessions s
    LEFT JOIN users u
      ON u.tenant_id = s.tenant_id
     AND u.id = s.user_id
    LEFT JOIN tenants t
      ON t.id = s.tenant_id
    WHERE s.deleted_at IS NULL
      AND s.clock_out_at IS NOT NULL
      AND s.attendance_date BETWEEN $1 AND $2
      AND s.clock_in_lat IS NOT NULL
      AND s.clock_in_lng IS NOT NULL
      AND s.clock_out_lat IS NOT NULL
      AND s.clock_out_lng IS NOT NULL
    ORDER BY s.tenant_id, s.attendance_date ASC, s.session_no ASC
    `,
    [params.rangeStart, params.rangeEnd],
  );

  return result.rows.reduce<AttendanceDistanceViolation[]>((acc, row) => {
    const clockInLat = toNumber(row.clock_in_lat);
    const clockInLng = toNumber(row.clock_in_lng);
    const clockOutLat = toNumber(row.clock_out_lat);
    const clockOutLng = toNumber(row.clock_out_lng);

    if (
      clockInLat === null ||
      clockInLng === null ||
      clockOutLat === null ||
      clockOutLng === null
    ) {
      return acc;
    }

    const distanceKm = haversineDistanceKm(
      clockInLat,
      clockInLng,
      clockOutLat,
      clockOutLng,
    );

    if (distanceKm <= params.thresholdKm) {
      return acc;
    }

    const attendanceDateValue =
      row.attendance_date instanceof Date
        ? row.attendance_date
        : new Date(`${row.attendance_date}T00:00:00`);

    const weekday =
      WEEKDAY_NAMES[
        Number.isNaN(attendanceDateValue.getTime())
          ? 0
          : attendanceDateValue.getDay()
      ];

    acc.push({
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      userId: row.user_id,
      userName: row.user_name || row.user_email || row.user_id,
      userEmail: row.user_email || "-",
      attendanceDate:
        row.attendance_date instanceof Date
          ? formatDateOnly(row.attendance_date)
          : String(row.attendance_date),
      weekday,
      sessionNo: Number(row.session_no || 1),
      clockInAt: formatDateTime(row.clock_in_at),
      clockOutAt: formatDateTime(row.clock_out_at),
      clockInLat,
      clockInLng,
      clockInAddress: row.clock_in_address,
      clockOutLat,
      clockOutLng,
      clockOutAddress: row.clock_out_address,
      distanceKm,
    });

    return acc;
  }, []);
}

async function getVisitDistanceViolations(params: {
  rangeStart: string;
  rangeEnd: string;
  thresholdKm: number;
}) {
  const result = await pool.query<VisitDistanceRow>(
    `
    SELECT
      v.tenant_id,
      COALESCE(t.name, v.tenant_id) AS tenant_name,
      v.id AS visit_id,
      v.name AS visit_name,
      v.assigned_to_user_id,
      COALESCE(NULLIF(u.name, ''), NULLIF(u.display_name, ''), NULLIF(u.email, ''), v.assigned_to_user_id, v.created_by_id) AS user_name,
      u.email AS user_email,
      v.start_date,
      v.end_date,
      v.checkin_captured_at,
      v.checkout_captured_at,
      v.checkin_latitude,
      v.checkin_longitude,
      v.checkin_address,
      v.checkout_latitude,
      v.checkout_longitude,
      v.checkout_address
    FROM visits v
    LEFT JOIN users u
      ON u.tenant_id = v.tenant_id
     AND u.id = v.assigned_to_user_id
    LEFT JOIN tenants t
      ON t.id = v.tenant_id
    WHERE v.deleted_at IS NULL
      AND COALESCE(v.start_date::date, v.created_at::date) BETWEEN $1 AND $2
      AND v.checkin_latitude IS NOT NULL
      AND v.checkin_longitude IS NOT NULL
      AND v.checkout_latitude IS NOT NULL
      AND v.checkout_longitude IS NOT NULL
    ORDER BY v.tenant_id, COALESCE(v.start_date, v.created_at) ASC, v.created_at ASC
    `,
    [params.rangeStart, params.rangeEnd],
  );

  return result.rows.reduce<VisitDistanceViolation[]>((acc, row) => {
    const clockInLat = toNumber(row.checkin_latitude);
    const clockInLng = toNumber(row.checkin_longitude);
    const clockOutLat = toNumber(row.checkout_latitude);
    const clockOutLng = toNumber(row.checkout_longitude);

    if (
      clockInLat === null ||
      clockInLng === null ||
      clockOutLat === null ||
      clockOutLng === null
    ) {
      return acc;
    }

    const distanceKm = haversineDistanceKm(
      clockInLat,
      clockInLng,
      clockOutLat,
      clockOutLng,
    );

    if (distanceKm <= params.thresholdKm) {
      return acc;
    }

    const dateSource =
      row.start_date ||
      row.checkin_captured_at ||
      row.checkout_captured_at ||
      null;
    const dateValue = dateSource
      ? dateSource instanceof Date
        ? dateSource
        : new Date(dateSource)
      : null;

    acc.push({
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      visitId: row.visit_id,
      visitName: row.visit_name || row.visit_id,
      userId: row.assigned_to_user_id || "-",
      userName: row.user_name || row.user_email || "-",
      userEmail: row.user_email || "-",
      visitDate:
        dateValue && !Number.isNaN(dateValue.getTime())
          ? formatDateOnly(dateValue)
          : "-",
      clockInAt: formatDateTime(row.checkin_captured_at),
      clockOutAt: formatDateTime(row.checkout_captured_at),
      clockInLat,
      clockInLng,
      clockInAddress: row.checkin_address,
      clockOutLat,
      clockOutLng,
      clockOutAddress: row.checkout_address,
      distanceKm,
    });

    return acc;
  }, []);
}

async function getTenantAdminRecipients(tenantId: string) {
  const result = await pool.query<{ user_id: string; email: string }>(
    `
    SELECT DISTINCT u.id AS user_id, u.email
    FROM public.users u
    LEFT JOIN user_roles ur
      ON ur.tenant_id = u.tenant_id
     AND ur.user_id = u.id
    LEFT JOIN roles r
      ON r.tenant_id = ur.tenant_id
     AND r.id = ur.role_id
    WHERE u.tenant_id = $1
      AND u.deleted_at IS NULL
      AND u.is_active = true
      AND u.email IS NOT NULL
      AND u.email <> ''
      AND (
        lower(COALESCE(r.code, '')) = 'tenant_admin'
        OR lower(COALESCE(u.role, '')) IN ('admin', 'tenant_admin')
        OR u.is_owner = true
      )
    `,
    [tenantId],
  );

  return result.rows.filter((row) => row.user_id && row.email);
}

export async function sendWeeklyAttendanceDistanceReport() {
  const thresholdKm = env.ATTENDANCE_DISTANCE_THRESHOLD_KM;
  const { startDate, endDate } = getPreviousWeekRange();
  const [violations, visitViolations] = await Promise.all([
    getAttendanceDistanceViolations({
      rangeStart: startDate,
      rangeEnd: endDate,
      thresholdKm,
    }),
    getVisitDistanceViolations({
      rangeStart: startDate,
      rangeEnd: endDate,
      thresholdKm,
    }),
  ]);

  if (!violations.length && !visitViolations.length) {
    console.log(
      `[Notification Scheduler] No attendance or visit distance violations for ${startDate} to ${endDate}`,
    );
    return;
  }

  const violationsByTenant = new Map<string, AttendanceDistanceViolation[]>();
  const visitViolationsByTenant = new Map<string, VisitDistanceViolation[]>();

  for (const item of violations) {
    const list = violationsByTenant.get(item.tenantId) || [];
    list.push(item);
    violationsByTenant.set(item.tenantId, list);
  }

  for (const item of visitViolations) {
    const list = visitViolationsByTenant.get(item.tenantId) || [];
    list.push(item);
    visitViolationsByTenant.set(item.tenantId, list);
  }

  const tenantIds = new Set<string>([
    ...violationsByTenant.keys(),
    ...visitViolationsByTenant.keys(),
  ]);

  for (const tenantId of tenantIds) {
    const tenantRows = violationsByTenant.get(tenantId) || [];
    const tenantVisitRows = visitViolationsByTenant.get(tenantId) || [];
    const recipients = await getTenantAdminRecipients(tenantId);

    if (!recipients.length) {
      console.warn(
        `[Notification Scheduler] No admin recipients for attendance distance report. tenant=${tenantId}`,
      );
      continue;
    }

    const tenantName =
      tenantRows[0]?.tenantName || tenantVisitRows[0]?.tenantName || tenantId;
    const subject = `Weekly Location Distance Report | ${tenantName} | ${startDate} to ${endDate}`;
    const html = buildAttendanceDistanceReportHtml({
      tenantName,
      rangeStart: startDate,
      rangeEnd: endDate,
      thresholdKm,
      rows: tenantRows,
      visitRows: tenantVisitRows,
    });

    for (const recipient of recipients) {
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
          'attendance',
          'weekly_distance_report',
          'attendance_report',
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
          tenantId,
          recipient.user_id,
          recipient.email,
          subject,
          html,
          `attendance-distance-report:${tenantId}:${recipient.user_id}:${startDate}:${endDate}`,
        ],
      );
    }
  }
}

export async function createAllDueNotificationJobs() {
  const results: JobResult[] = [];

  results.push(await runSafely("lead assignment", insertLeadAssignmentJobs));
  results.push(await runSafely("lead followup", insertLeadFollowupJobs));

  results.push(
    await runSafely(
      "organization assignment",
      insertOrganizationAssignmentJobs,
    ),
  );
  results.push(
    await runSafely("organization followup", insertOrganizationFollowupJobs),
  );

  results.push(await runSafely("quote assignment", insertQuoteAssignmentJobs));
  results.push(await runSafely("quote expiry", insertQuoteExpiryJobs));

  results.push(
    await runSafely("opportunity assignment", insertOpportunityAssignmentJobs),
  );
  results.push(
    await runSafely("opportunity followup", insertOpportunityFollowupJobs),
  );

  results.push(await runSafely("task assignment", insertTaskAssignmentJobs));
  results.push(await runSafely("task due", insertTaskDueJobs));

  results.push(await runSafely("visit reminder", insertVisitReminderJobs));

  results.push(
    await runSafely("sales order assignment", insertSalesOrderAssignmentJobs),
  );
  results.push(
    await runSafely(
      "sales order dispatch pending",
      insertSalesOrderDispatchPendingJobs,
    ),
  );

  results.push(
    await runSafely(
      "purchase order assignment",
      insertPurchaseOrderAssignmentJobs,
    ),
  );
  results.push(
    await runSafely(
      "purchase order receive pending",
      insertPurchaseOrderReceivePendingJobs,
    ),
  );

  results.push(await runSafely("outstanding due", insertOutstandingDueJobs));

  const failed = results.filter((item) => !item.ok);

  if (failed.length) {
    console.warn("[Notification Scheduler] Some jobs failed:", failed);
  }

  return results;
}

export async function createDailySummaryNotificationJobs() {
  return runSafely("manager daily summary", insertManagerDailySummaryJobs);
}

export async function processPendingNotificationJobs() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(`
      SELECT *
      FROM notification_jobs
      WHERE status = 'pending'
        AND scheduled_at <= now()
      ORDER BY scheduled_at ASC
      LIMIT 25
      FOR UPDATE SKIP LOCKED
    `);

    for (const job of rows) {
      try {
        await client.query(
          `
          UPDATE notification_jobs
          SET status = 'processing',
              updated_at = now()
          WHERE tenant_id = $1
            AND id = $2
          `,
          [job.tenant_id, job.id],
        );

        await sendNotificationEmail({
          to: job.recipient_email,
          subject: job.subject,
          html: job.body,
        });

        await client.query(
          `
          UPDATE notification_jobs
          SET status = 'sent',
              sent_at = now(),
              updated_at = now(),
              last_error = NULL
          WHERE tenant_id = $1
            AND id = $2
          `,
          [job.tenant_id, job.id],
        );
      } catch (error: any) {
        await client.query(
          `
          UPDATE notification_jobs
          SET status = CASE
                WHEN retry_count + 1 >= 3 THEN 'failed'
                ELSE 'pending'
              END,
              retry_count = retry_count + 1,
              last_error = $3,
              scheduled_at = now() + INTERVAL '10 minutes',
              updated_at = now()
          WHERE tenant_id = $1
            AND id = $2
          `,
          [
            job.tenant_id,
            job.id,
            esc(error?.message || "Email sending failed"),
          ],
        );
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[Notification Scheduler] processing failed:", error);
  } finally {
    client.release();
  }
}

export function startNotificationSchedulers() {
  if (schedulerStarted) {
    return;
  }

  schedulerStarted = true;

  cron.schedule("*/15 * * * *", async () => {
    await createAllDueNotificationJobs();
  });

  cron.schedule("*/10 * * * *", async () => {
    await processPendingNotificationJobs();
  });

  cron.schedule("0 9 * * *", async () => {
    await runSafely("daily outstanding due", insertOutstandingDueJobs);
    await createDailySummaryNotificationJobs();
  });

  cron.schedule(
    env.ATTENDANCE_DISTANCE_REPORT_CRON,
    async () => {
      await runSafely(
        "weekly attendance distance report",
        sendWeeklyAttendanceDistanceReport,
      );
    },
    {
      timezone: env.ATTENDANCE_DISTANCE_REPORT_TIMEZONE,
    },
  );

  // console.log("[Notification Scheduler] started");
}
