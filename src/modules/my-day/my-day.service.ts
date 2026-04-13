import { pool } from "../../db/pool";
import type {
  GetMyDayInput,
  MyDayCountsResponse,
  MyDayResponse,
  WorkQueueItem,
  WorkQueuePriority,
} from "./my-day.types";

type RawRow = {
  id: string;
  type: WorkQueueItem["type"];
  entity_id: string;
  entity_number: string | null;
  title: string;
  subtitle: string | null;
  description: string | null;
  due_at: string | null;
  priority: string | null;
  section: WorkQueueItem["section"];
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  related_to_type: string | null;
  related_to_id: string | null;
  related_to_label: string | null;
  route: string;
  action_label: string | null;
  meta: Record<string, any> | null;
};

function normalizePriority(priority?: string | null): WorkQueuePriority {
  const p = String(priority || "").toLowerCase();

  if (p.includes("urgent")) return "urgent";
  if (p.includes("high")) return "high";
  if (p.includes("medium")) return "medium";
  return "low";
}

function sortItems(items: WorkQueueItem[]) {
  const priorityRank: Record<WorkQueuePriority, number> = {
    urgent: 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  return [...items].sort((a, b) => {
    const aDue = a.due_at
      ? new Date(a.due_at).getTime()
      : Number.MAX_SAFE_INTEGER;
    const bDue = b.due_at
      ? new Date(b.due_at).getTime()
      : Number.MAX_SAFE_INTEGER;

    if (a.section === "overdue" && b.section === "overdue") {
      return aDue - bDue;
    }

    if (a.section === "today" && b.section === "today") {
      return aDue - bDue;
    }

    if (a.section === "upcoming" && b.section === "upcoming") {
      return aDue - bDue;
    }

    return priorityRank[b.priority] - priorityRank[a.priority];
  });
}

function mapRows(rows: RawRow[]): WorkQueueItem[] {
  return rows.map((row: any) => ({
    id: `${row.type}:${row.entity_id}`,
    type: row.type,
    entity_id: row.entity_id,
    entity_number: row.entity_number,
    title: row.title,
    subtitle: row.subtitle,
    description: row.description,
    due_at: row.due_at,
    priority: normalizePriority(row.priority),
    section: row.section,
    assigned_to_user_id: row.assigned_to_user_id,
    assigned_to_name: row.assigned_to_name,
    related_to_type: row.related_to_type,
    related_to_id: row.related_to_id,
    related_to_label: row.related_to_label,
    route: row.route,
    action_label: row.action_label,
    meta: row.meta || {},
  }));
}

function buildAssignmentFilter(
  assigned: "me" | "all" | undefined,
  userField: string,
  values: Array<string>,
  userId?: string,
) {
  if (assigned === "me" && userId) {
    values.push(userId);
    return ` AND ${userField} = $${values.length}`;
  }

  return "";
}

function userDisplaySql(alias: string) {
  return `COALESCE(NULLIF(${alias}.display_name, ''), NULLIF(${alias}.name, ''), NULLIF(TRIM(CONCAT(COALESCE(${alias}.first_name, ''), ' ', COALESCE(${alias}.last_name, ''))), ''), ${alias}.email)`;
}

async function getTaskRows(input: GetMyDayInput): Promise<RawRow[]> {
  const values: string[] = [input.tenantId];
  const assignmentFilter = buildAssignmentFilter(
    input.assigned,
    "t.assigned_to",
    values,
    input.userId,
  );

  const query = `
    SELECT
      t.id,
      'task' AS type,
      t.id AS entity_id,
      t.task_number AS entity_number,
      COALESCE(t.subject, 'Untitled Task') AS title,
      NULL::text AS subtitle,
      t.description,
      COALESCE(t.end_date, t.start_date) AS due_at,
      CASE
        WHEN t.end_date IS NOT NULL AND t.end_date < NOW() - INTERVAL '3 days' THEN 'urgent'
        WHEN t.end_date IS NOT NULL AND t.end_date < NOW() THEN 'high'
        WHEN DATE(COALESCE(t.end_date, t.start_date)) = CURRENT_DATE THEN COALESCE(LOWER(mp.value), LOWER(mp.label), 'medium')
        ELSE COALESCE(LOWER(mp.value), LOWER(mp.label), 'low')
      END AS priority,
      CASE
        WHEN LOWER(COALESCE(t.status, '')) = 'completed' OR t.completed_at IS NOT NULL THEN NULL
        WHEN t.end_date IS NOT NULL AND t.end_date < NOW() THEN 'overdue'
        WHEN DATE(COALESCE(t.end_date, t.start_date)) = CURRENT_DATE THEN 'today'
        WHEN COALESCE(t.end_date, t.start_date) > NOW() THEN 'upcoming'
        WHEN LOWER(COALESCE(t.status, 'not_started')) = 'not_started' AND t.end_date IS NULL THEN 'needs_attention'
        ELSE NULL
      END AS section,
      t.assigned_to AS assigned_to_user_id,
      ${userDisplaySql("u")} AS assigned_to_name,
      t.related_to_type,
      t.related_to_id,
      CASE
        WHEN t.related_to_type = 'lead' THEN 'Lead'
        WHEN t.related_to_type = 'contact' THEN 'Contact'
        WHEN t.related_to_type = 'organization' THEN 'Organization'
        WHEN t.related_to_type = 'opportunity' THEN 'Opportunity'
        ELSE NULL
      END AS related_to_label,
      '/tasks/' || t.id AS route,
      'Open Task' AS action_label,
      jsonb_build_object(
        'status', t.status,
        'priority_id', t.priority_id,
        'priority_label', mp.label,
        'start_date', t.start_date,
        'end_date', t.end_date,
        'completed_at', t.completed_at
      ) AS meta
    FROM tasks t
    LEFT JOIN users u
      ON u.id = t.assigned_to
    LEFT JOIN master_values mp
      ON mp.id = t.priority_id
      AND mp.tenant_id = t.tenant_id
      AND mp.deleted_at IS NULL
      AND mp.is_active = true
    WHERE t.tenant_id = $1
      AND t.deleted_at IS NULL
      AND (LOWER(COALESCE(t.status, '')) <> 'completed' AND t.completed_at IS NULL)
      ${assignmentFilter}
  `;

  const { rows } = await pool.query(query, values);
  return rows.filter((row: any) => row.section);
}

async function getLeadFollowupRows(input: GetMyDayInput): Promise<RawRow[]> {
  const values: string[] = [input.tenantId];
  const assignmentFilter = buildAssignmentFilter(
    input.assigned,
    "l.assigned_to",
    values,
    input.userId,
  );

  const query = `
    SELECT
      l.id,
      'lead_followup' AS type,
      l.id AS entity_id,
      l.lead_display_id AS entity_number,
      COALESCE(
        NULLIF(TRIM(CONCAT(COALESCE(l.first_name, ''), ' ', COALESCE(l.last_name, ''))), ''),
        l.organization_name,
        'Lead'
      ) AS title,
      l.organization_name AS subtitle,
      l.description,
      l.next_followup AS due_at,
      CASE
        WHEN l.next_followup < NOW() - INTERVAL '3 days' THEN 'urgent'
        WHEN l.next_followup < NOW() THEN 'high'
        WHEN DATE(l.next_followup) = CURRENT_DATE THEN COALESCE(LOWER(mp.value), LOWER(mp.label), 'medium')
        ELSE COALESCE(LOWER(mp.value), LOWER(mp.label), 'low')
      END AS priority,
      CASE
        WHEN l.next_followup < NOW() THEN 'overdue'
        WHEN DATE(l.next_followup) = CURRENT_DATE THEN 'today'
        WHEN l.next_followup > NOW()
          AND l.next_followup <= NOW() + INTERVAL '3 days' THEN 'upcoming'
        ELSE NULL
      END AS section,
      l.assigned_to AS assigned_to_user_id,
      ${userDisplaySql("u")} AS assigned_to_name,
      'lead' AS related_to_type,
      l.id AS related_to_id,
      COALESCE(l.organization_name, l.lead_display_id) AS related_to_label,
      '/leads/' || l.id AS route,
      'Open Lead' AS action_label,
      jsonb_build_object(
        'lead_display_id', l.lead_display_id,
        'status_id', l.status_id,
        'status_label', ms.label,
        'priority_id', l.priority_id,
        'priority_label', mp.label,
        'next_followup', l.next_followup
      ) AS meta
    FROM leads l
    LEFT JOIN users u
      ON u.id = l.assigned_to
    LEFT JOIN master_values ms
      ON ms.id = l.status_id
      AND ms.tenant_id = l.tenant_id
      AND ms.deleted_at IS NULL
      AND ms.is_active = true
    LEFT JOIN master_values mp
      ON mp.id = l.priority_id
      AND mp.tenant_id = l.tenant_id
      AND mp.deleted_at IS NULL
      AND mp.is_active = true
    WHERE l.tenant_id = $1
      AND l.deleted_at IS NULL
      AND l.next_followup IS NOT NULL
      ${assignmentFilter}
  `;

  const { rows } = await pool.query(query, values);
  return rows.filter((row: any) => row.section);
}

async function getVisitRows(input: GetMyDayInput): Promise<RawRow[]> {
  const values: string[] = [input.tenantId];
  const assignmentFilter = buildAssignmentFilter(
    input.assigned,
    "v.assigned_to_user_id",
    values,
    input.userId,
  );

  const query = `
    SELECT
      v.id,
      'visit' AS type,
      v.id AS entity_id,
      v.visit_number AS entity_number,
      COALESCE(v.name, 'Visit') AS title,
      v.remarks AS subtitle,
      v.remarks AS description,
      COALESCE(v.start_date, v.next_followup_date, v.end_date) AS due_at,
      CASE
        WHEN COALESCE(v.start_date, v.next_followup_date, v.end_date) < NOW() - INTERVAL '3 days' THEN 'urgent'
        WHEN COALESCE(v.start_date, v.next_followup_date, v.end_date) < NOW() THEN 'high'
        WHEN DATE(COALESCE(v.start_date, v.next_followup_date, v.end_date)) = CURRENT_DATE THEN 'medium'
        ELSE 'low'
      END AS priority,
      CASE
        WHEN LOWER(COALESCE(v.status, '')) IN ('completed', 'closed') THEN NULL
        WHEN COALESCE(v.start_date, v.next_followup_date, v.end_date) < NOW() THEN 'overdue'
        WHEN DATE(COALESCE(v.start_date, v.next_followup_date, v.end_date)) = CURRENT_DATE THEN 'today'
        WHEN COALESCE(v.start_date, v.next_followup_date, v.end_date) > NOW()
          AND COALESCE(v.start_date, v.next_followup_date, v.end_date) <= NOW() + INTERVAL '3 days' THEN 'upcoming'
        ELSE NULL
      END AS section,
      v.assigned_to_user_id AS assigned_to_user_id,
      ${userDisplaySql("u")} AS assigned_to_name,
      v.regarding AS related_to_type,
      COALESCE(v.organization_id, v.contact_id, v.lead_id, v.case_id) AS related_to_id,
      CASE
        WHEN v.regarding = 'organization' THEN 'Organization'
        WHEN v.regarding = 'contact' THEN 'Contact'
        WHEN v.regarding = 'lead' THEN 'Lead'
        WHEN v.regarding = 'case' THEN 'Case'
        ELSE NULL
      END AS related_to_label,
      '/visits/' || v.id AS route,
      'Open Visit' AS action_label,
      jsonb_build_object(
        'status', v.status,
        'regarding', v.regarding,
        'start_date', v.start_date,
        'end_date', v.end_date,
        'next_followup_date', v.next_followup_date
      ) AS meta
    FROM visits v
    LEFT JOIN users u
      ON u.id = v.assigned_to_user_id
    WHERE v.tenant_id = $1
      AND v.deleted_at IS NULL
      ${assignmentFilter}
  `;

  const { rows } = await pool.query(query, values);
  return rows.filter((row: any) => row.section);
}

async function getQuoteRows(input: GetMyDayInput): Promise<RawRow[]> {
  const values: string[] = [input.tenantId];
  const assignmentFilter = buildAssignmentFilter(
    input.assigned,
    "q.assigned_to",
    values,
    input.userId,
  );

  const query = `
    SELECT
      q.id,
      'quote_expiry' AS type,
      q.id AS entity_id,
      q.quote_number AS entity_number,
      COALESCE(q.title, 'Quote') AS title,
      q.company_name AS subtitle,
      q.description,
      q.valid_until::timestamp AS due_at,
      CASE
        WHEN q.valid_until < CURRENT_DATE - 3 THEN 'urgent'
        WHEN q.valid_until < CURRENT_DATE THEN 'high'
        WHEN q.valid_until = CURRENT_DATE THEN 'medium'
        WHEN q.valid_until <= CURRENT_DATE + 3 THEN 'medium'
        ELSE 'low'
      END AS priority,
      CASE
        WHEN LOWER(COALESCE(q.quote_stage, 'draft')) IN ('won', 'lost', 'closed', 'accepted', 'rejected') THEN NULL
        WHEN q.valid_until < CURRENT_DATE THEN 'overdue'
        WHEN q.valid_until = CURRENT_DATE THEN 'today'
        WHEN q.valid_until <= CURRENT_DATE + 3 THEN 'upcoming'
        ELSE NULL
      END AS section,
      q.assigned_to AS assigned_to_user_id,
      ${userDisplaySql("u")} AS assigned_to_name,
      'quote' AS related_to_type,
      q.id AS related_to_id,
      COALESCE(q.company_name, q.quote_number) AS related_to_label,
      '/quotes/' || q.id AS route,
      'Open Quote' AS action_label,
      jsonb_build_object(
        'quote_stage', q.quote_stage,
        'valid_until', q.valid_until,
        'company_name', q.company_name,
        'organization_id', q.organization_id,
        'contact_id', q.contact_id,
        'opportunity_id', q.opportunity_id
      ) AS meta
    FROM quotes q
    LEFT JOIN users u
      ON u.id = q.assigned_to
    WHERE q.tenant_id = $1
      AND q.deleted_at IS NULL
      AND q.valid_until IS NOT NULL
      ${assignmentFilter}
  `;

  const { rows } = await pool.query(query, values);
  return rows.filter((row: any) => row.section);
}

async function getStaleLeadRows(input: GetMyDayInput): Promise<RawRow[]> {
  const values: string[] = [input.tenantId];
  const assignmentFilter = buildAssignmentFilter(
    input.assigned,
    "l.assigned_to",
    values,
    input.userId,
  );

  const query = `
    SELECT
      l.id,
      'stale_lead' AS type,
      l.id AS entity_id,
      l.lead_display_id AS entity_number,
      COALESCE(
        NULLIF(TRIM(CONCAT(COALESCE(l.first_name, ''), ' ', COALESCE(l.last_name, ''))), ''),
        l.organization_name,
        'Lead'
      ) AS title,
      l.organization_name AS subtitle,
      'No recent activity detected' AS description,
      l.next_followup AS due_at,
      COALESCE(LOWER(mp.value), LOWER(mp.label), 'high') AS priority,
      'needs_attention' AS section,
      l.assigned_to AS assigned_to_user_id,
      ${userDisplaySql("u")} AS assigned_to_name,
      'lead' AS related_to_type,
      l.id AS related_to_id,
      COALESCE(l.organization_name, l.lead_display_id) AS related_to_label,
      '/leads/' || l.id AS route,
      'Review Lead' AS action_label,
      jsonb_build_object(
        'updated_at', l.updated_at,
        'next_followup', l.next_followup,
        'status_id', l.status_id,
        'status_label', ms.label,
        'priority_id', l.priority_id,
        'priority_label', mp.label
      ) AS meta
    FROM leads l
    LEFT JOIN users u
      ON u.id = l.assigned_to
    LEFT JOIN master_values ms
      ON ms.id = l.status_id
      AND ms.tenant_id = l.tenant_id
      AND ms.deleted_at IS NULL
      AND ms.is_active = true
    LEFT JOIN master_values mp
      ON mp.id = l.priority_id
      AND mp.tenant_id = l.tenant_id
      AND mp.deleted_at IS NULL
      AND mp.is_active = true
    WHERE l.tenant_id = $1
      AND l.deleted_at IS NULL
      AND l.assigned_to IS NOT NULL
      AND COALESCE(l.updated_at, l.created_at) < NOW() - INTERVAL '7 days'
      AND (
        l.next_followup IS NULL
        OR l.next_followup < NOW() - INTERVAL '3 days'
      )
      AND LOWER(COALESCE(ms.value, ms.label, l.status, 'open')) NOT IN ('won', 'lost', 'closed')
      ${assignmentFilter}
  `;

  const { rows } = await pool.query(query, values);
  return rows;
}

function applyViewFilter(
  items: WorkQueueItem[],
  view?: "today" | "overdue" | "upcoming" | "all",
) {
  if (!view || view === "all") return items;
  return items.filter((item) => item.section === view);
}

export const myDayService = {
  async getMyDay(input: GetMyDayInput): Promise<MyDayResponse> {
    const [taskRows, followupRows, visitRows, quoteRows, staleRows] =
      await Promise.all([
        getTaskRows(input),
        getLeadFollowupRows(input),
        getVisitRows(input),
        getQuoteRows(input),
        getStaleLeadRows(input),
      ]);

    const allItems = mapRows([
      ...taskRows,
      ...followupRows,
      ...visitRows,
      ...quoteRows,
      ...staleRows,
    ]);

    const filtered = applyViewFilter(allItems, input.view);

    const overdue = sortItems(
      filtered.filter((item) => item.section === "overdue"),
    );
    const today = sortItems(
      filtered.filter((item) => item.section === "today"),
    );
    const upcoming = sortItems(
      filtered.filter((item) => item.section === "upcoming"),
    );
    const needsAttention = sortItems(
      filtered.filter((item) => item.section === "needs_attention"),
    );

    return {
      summary: {
        total_today: today.length,
        total_overdue: overdue.length,
        total_upcoming: upcoming.length,
        total_needs_attention: needsAttention.length,
      },
      sections: {
        overdue,
        today,
        upcoming,
        needs_attention: needsAttention,
      },
    };
  },

  async getCounts(input: GetMyDayInput): Promise<MyDayCountsResponse> {
    const data = await this.getMyDay({ ...input, view: "all" });

    const overdue = data.sections.overdue.length;
    const today = data.sections.today.length;
    const upcoming = data.sections.upcoming.length;
    const needs_attention = data.sections.needs_attention.length;

    return {
      total: overdue + today + upcoming + needs_attention,
      overdue,
      today,
      upcoming,
      needs_attention,
    };
  },
};
