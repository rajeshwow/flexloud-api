import cron from "node-cron";
import { pool } from "../../db/pool";
import { sendNotificationEmail } from "./notifications.mailer";

type JobResult = {
  name: string;
  ok: boolean;
  error?: string;
};

let schedulerStarted = false;

function esc(value: any) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
      'New Lead Assigned: ' || COALESCE(l.name, l.company_name, 'Lead'),
      '<p>Hello ' || COALESCE(u.name, u.full_name, u.email) || ',</p>' ||
      '<p>A new lead has been assigned to you.</p>' ||
      '<p><b>Lead:</b> ' || COALESCE(l.name, l.company_name, 'Lead') || '</p>' ||
      '<p><b>Status:</b> ' || COALESCE(l.status::text, '-') || '</p>',
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
      'Lead Follow-up Due: ' || COALESCE(l.name, l.company_name, 'Lead'),
      '<p>Hello ' || COALESCE(u.name, u.full_name, u.email) || ',</p>' ||
      '<p>A lead follow-up is due.</p>' ||
      '<p><b>Lead:</b> ' || COALESCE(l.name, l.company_name, 'Lead') || '</p>' ||
      '<p><b>Follow-up Date:</b> ' || COALESCE(l.next_followup_at::text, '-') || '</p>',
      'lead-followup:' || l.tenant_id || ':' || l.id || ':' || CURRENT_DATE
    FROM leads l
    JOIN users u
      ON u.tenant_id = l.tenant_id
     AND u.id = l.assigned_to
    WHERE l.deleted_at IS NULL
      AND l.assigned_to IS NOT NULL
      AND l.next_followup_at IS NOT NULL
      AND l.next_followup_at <= now()
      AND COALESCE(l.status::text, '') NOT IN ('closed', 'converted', 'lost', 'cancelled')
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
      '<p>Hello ' || COALESCE(u.name, u.full_name, u.email) || ',</p>' ||
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
      '<p>Hello ' || COALESCE(u.name, u.full_name, u.email) || ',</p>' ||
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
      '<p>Hello ' || COALESCE(u.name, u.full_name, u.email) || ',</p>' ||
      '<p>A quote has been assigned to you.</p>' ||
      '<p><b>Quote:</b> ' || COALESCE(q.quote_number, q.id::text) || '</p>' ||
      '<p><b>Amount:</b> ' || COALESCE(q.grand_total::text, q.total_amount::text, '-') || '</p>',
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
      '<p>Hello ' || COALESCE(u.name, u.full_name, u.email) || ',</p>' ||
      '<p>Quote expiry attention required.</p>' ||
      '<p><b>Quote:</b> ' || COALESCE(q.quote_number, q.id::text) || '</p>' ||
      '<p><b>Valid Until:</b> ' || COALESCE(q.valid_until::text, '-') || '</p>' ||
      '<p><b>Amount:</b> ' || COALESCE(q.grand_total::text, q.total_amount::text, '-') || '</p>',
      'quote-expiry:' || q.tenant_id || ':' || q.id || ':' || CURRENT_DATE
    FROM quotes q
    JOIN users u
      ON u.tenant_id = q.tenant_id
     AND u.id = q.assigned_to
    WHERE q.deleted_at IS NULL
      AND q.assigned_to IS NOT NULL
      AND q.valid_until IS NOT NULL
      AND q.valid_until::date <= CURRENT_DATE + INTERVAL '2 days'
      AND COALESCE(q.stage::text, q.status::text, '') NOT IN ('accepted', 'rejected', 'cancelled', 'converted', 'won', 'lost')
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
      'Opportunity Assigned: ' || COALESCE(op.name, op.title, op.opportunity_number, op.id::text),
      '<p>Hello ' || COALESCE(u.name, u.full_name, u.email) || ',</p>' ||
      '<p>An opportunity has been assigned to you.</p>' ||
      '<p><b>Opportunity:</b> ' || COALESCE(op.name, op.title, op.opportunity_number, op.id::text) || '</p>' ||
      '<p><b>Amount:</b> ' || COALESCE(op.amount::text, op.expected_value::text, '-') || '</p>',
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
      'Opportunity Follow-up Due: ' || COALESCE(op.name, op.title, op.opportunity_number, op.id::text),
      '<p>Hello ' || COALESCE(u.name, u.full_name, u.email) || ',</p>' ||
      '<p>An opportunity follow-up is due.</p>' ||
      '<p><b>Opportunity:</b> ' || COALESCE(op.name, op.title, op.opportunity_number, op.id::text) || '</p>' ||
      '<p><b>Follow-up Date:</b> ' || COALESCE(op.next_followup_at::text, '-') || '</p>',
      'opportunity-followup:' || op.tenant_id || ':' || op.id || ':' || CURRENT_DATE
    FROM opportunities op
    JOIN users u
      ON u.tenant_id = op.tenant_id
     AND u.id = op.assigned_to
    WHERE op.deleted_at IS NULL
      AND op.assigned_to IS NOT NULL
      AND op.next_followup_at IS NOT NULL
      AND op.next_followup_at <= now()
      AND COALESCE(op.status::text, op.stage::text, '') NOT IN ('closed', 'won', 'lost', 'cancelled')
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
      'Task Assigned: ' || COALESCE(t.title, t.name, t.id::text),
      '<p>Hello ' || COALESCE(u.name, u.full_name, u.email) || ',</p>' ||
      '<p>A task has been assigned to you.</p>' ||
      '<p><b>Task:</b> ' || COALESCE(t.title, t.name, t.id::text) || '</p>' ||
      '<p><b>Due:</b> ' || COALESCE(t.due_date::text, t.due_at::text, '-') || '</p>',
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
        WHEN COALESCE(t.due_date, t.due_at)::date < CURRENT_DATE THEN 'task_overdue'
        ELSE 'task_due'
      END,
      'task',
      t.id,
      u.id,
      u.email,
      CASE
        WHEN COALESCE(t.due_date, t.due_at)::date < CURRENT_DATE
          THEN 'Task Overdue: ' || COALESCE(t.title, t.name, t.id::text)
        ELSE 'Task Due: ' || COALESCE(t.title, t.name, t.id::text)
      END,
      '<p>Hello ' || COALESCE(u.name, u.full_name, u.email) || ',</p>' ||
      '<p>A task requires your attention.</p>' ||
      '<p><b>Task:</b> ' || COALESCE(t.title, t.name, t.id::text) || '</p>' ||
      '<p><b>Due:</b> ' || COALESCE(t.due_date::text, t.due_at::text, '-') || '</p>',
      'task-due:' || t.tenant_id || ':' || t.id || ':' || CURRENT_DATE
    FROM tasks t
    JOIN users u
      ON u.tenant_id = t.tenant_id
     AND u.id = t.assigned_to
    WHERE t.deleted_at IS NULL
      AND t.assigned_to IS NOT NULL
      AND COALESCE(t.due_date, t.due_at) IS NOT NULL
      AND COALESCE(t.due_date, t.due_at) <= now()
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
      'Visit Reminder: ' || COALESCE(v.title, v.name, v.id::text),
      '<p>Hello ' || COALESCE(u.name, u.full_name, u.email) || ',</p>' ||
      '<p>A visit is scheduled.</p>' ||
      '<p><b>Visit:</b> ' || COALESCE(v.title, v.name, v.id::text) || '</p>' ||
      '<p><b>Time:</b> ' || COALESCE(v.scheduled_at::text, v.visit_date::text, '-') || '</p>',
      'visit-due:' || v.tenant_id || ':' || v.id || ':' || CURRENT_DATE
    FROM visits v
    JOIN users u
      ON u.tenant_id = v.tenant_id
     AND u.id = v.assigned_to
    WHERE v.deleted_at IS NULL
      AND v.assigned_to IS NOT NULL
      AND COALESCE(v.scheduled_at, v.visit_date) IS NOT NULL
      AND COALESCE(v.scheduled_at, v.visit_date) <= now() + INTERVAL '1 hour'
      AND COALESCE(v.status::text, '') NOT IN ('completed', 'done', 'cancelled')
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
      'Sales Order Assigned: ' || COALESCE(so.sales_order_number, so.order_number, so.id::text),
      '<p>Hello ' || COALESCE(u.name, u.full_name, u.email) || ',</p>' ||
      '<p>A sales order has been assigned to you.</p>' ||
      '<p><b>Sales Order:</b> ' || COALESCE(so.sales_order_number, so.order_number, so.id::text) || '</p>' ||
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
      'Sales Order Dispatch Pending: ' || COALESCE(so.sales_order_number, so.order_number, so.id::text),
      '<p>Hello ' || COALESCE(u.name, u.full_name, u.email) || ',</p>' ||
      '<p>A sales order is pending for dispatch.</p>' ||
      '<p><b>Sales Order:</b> ' || COALESCE(so.sales_order_number, so.order_number, so.id::text) || '</p>' ||
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
      'Purchase Order Assigned: ' || COALESCE(po.purchase_order_number, po.po_number, po.id::text),
      '<p>Hello ' || COALESCE(u.name, u.full_name, u.email) || ',</p>' ||
      '<p>A purchase order has been assigned to you.</p>' ||
      '<p><b>Purchase Order:</b> ' || COALESCE(po.purchase_order_number, po.po_number, po.id::text) || '</p>' ||
      '<p><b>Amount:</b> ' || COALESCE(po.grand_total::text, po.total_amount::text, '-') || '</p>',
      'purchase-order-assigned:' || po.tenant_id || ':' || po.id || ':' || po.assigned_to
    FROM purchase_orders po
    JOIN users u
      ON u.tenant_id = po.tenant_id
     AND u.id = po.assigned_to
    WHERE po.deleted_at IS NULL
      AND po.assigned_to IS NOT NULL
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
      'Purchase Order Receive Pending: ' || COALESCE(po.purchase_order_number, po.po_number, po.id::text),
      '<p>Hello ' || COALESCE(u.name, u.full_name, u.email) || ',</p>' ||
      '<p>A purchase order is pending for receiving.</p>' ||
      '<p><b>Purchase Order:</b> ' || COALESCE(po.purchase_order_number, po.po_number, po.id::text) || '</p>' ||
      '<p><b>Status:</b> ' || COALESCE(po.status::text, '-') || '</p>',
      'purchase-order-receive-pending:' || po.tenant_id || ':' || po.id || ':' || CURRENT_DATE
    FROM purchase_orders po
    JOIN users u
      ON u.tenant_id = po.tenant_id
     AND u.id = po.assigned_to
    WHERE po.deleted_at IS NULL
      AND po.assigned_to IS NOT NULL
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
      '<p>Hello ' || COALESCE(u.name, u.full_name, u.email) || ',</p>' ||
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
       (
         o.ledger_guid IS NOT NULL
         AND o.ledger_guid <> ''
         AND org.tally_guid IS NOT NULL
         AND org.tally_guid = o.ledger_guid
       )
       OR (
         COALESCE(o.ledger_guid, '') = ''
         AND o.ledger_name IS NOT NULL
         AND lower(org.name) = lower(o.ledger_name)
       )
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
      '<p>Hello ' || COALESCE(u.name, u.full_name, u.email) || ',</p>' ||
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

  console.log("[Notification Scheduler] started");
}
