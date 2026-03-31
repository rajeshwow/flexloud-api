import type { Request, Response } from "express";

import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";
import { GetLeadInsightsSchema } from "./ai-insights.schema";
import type {
  GetLeadInsightsParams,
  LeadAIInsights,
  LeadInsightSourceRow,
  LeadScore,
  LeadTemperature,
  NextBestAction,
  ReminderSuggestion,
} from "./ai-insights.types";

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function daysBetween(dateValue?: string | null): number {
  if (!dateValue) return 9999;

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 9999;

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function getLeadDisplayStatus(lead: LeadInsightSourceRow): string {
  return String(lead.status || "")
    .trim()
    .toLowerCase();
}

function getLeadScore(row: LeadInsightSourceRow): LeadScore {
  let score = 0;
  const reasons: string[] = [];

  const budget = toNumber(row.budget, 0);
  const noResponseCount = toNumber(row.no_response_count, 0);
  const openTasksCount = toNumber(row.open_tasks_count, 0);
  const totalInteractionsCount = toNumber(row.total_interactions_count, 0);
  const lastActivityDays = daysBetween(
    row.last_activity_at || row.updated_at || row.created_at,
  );
  const status = getLeadDisplayStatus(row);

  // budget score
  if (budget >= 100000) {
    score += 25;
    reasons.push("High budget");
  } else if (budget >= 50000) {
    score += 15;
    reasons.push("Moderate budget");
  } else if (budget > 0) {
    score += 8;
    reasons.push("Budget captured");
  }

  // recent activity score
  if (lastActivityDays <= 1) {
    score += 15;
    reasons.push("Very recent activity");
  } else if (lastActivityDays <= 3) {
    score += 10;
    reasons.push("Recent activity found");
  } else if (lastActivityDays <= 6) {
    score += 5;
    reasons.push("Some recent engagement");
  } else if (lastActivityDays >= 7) {
    score -= 15;
    reasons.push("No recent activity");
  }

  // status score
  if (["new"].includes(status)) {
    score += 4;
    reasons.push("Lead created");
  } else if (["contacted", "attempted"].includes(status)) {
    score += 8;
    reasons.push("Initial outreach started");
  } else if (["interested"].includes(status)) {
    score += 14;
    reasons.push("Lead is interested");
  } else if (["qualified"].includes(status)) {
    score += 20;
    reasons.push("Lead is qualified");
  } else if (["hot"].includes(status)) {
    score += 24;
    reasons.push("Lead is hot");
  }

  // open tasks score
  if (openTasksCount === 1) {
    score += 6;
    reasons.push("1 follow-up task exists");
  } else if (openTasksCount === 2) {
    score += 8;
    reasons.push("Multiple follow-up tasks planned");
  } else if (openTasksCount >= 3) {
    score += 10;
    reasons.push("Well-tracked with follow-up tasks");
  }

  // interactions score - incremental
  if (totalInteractionsCount === 1) {
    score += 4;
    reasons.push("1 interaction logged");
  } else if (totalInteractionsCount === 2) {
    score += 7;
    reasons.push("2 interactions logged");
  } else if (totalInteractionsCount >= 3) {
    score += 10;
    reasons.push("Multiple interactions logged");
  }

  // quote score
  if (row.has_quote) {
    score += 10;
    reasons.push("Quote already shared");
  }

  // no response penalty - gradual
  if (noResponseCount === 1) {
    score -= 4;
    reasons.push("1 no response recorded");
  } else if (noResponseCount === 2) {
    score -= 8;
    reasons.push("Repeated no response");
  } else if (noResponseCount >= 3) {
    score -= 15;
    reasons.push("Multiple no responses");
  }

  score = clamp(score, 0, 100);

  let label: LeadTemperature = "Cold";
  if (score >= 75) label = "Hot";
  else if (score >= 40) label = "Warm";

  if (!reasons.length) {
    reasons.push("Limited activity data available");
  }

  return {
    score,
    label,
    reasons,
  };
}

function getNextBestAction(row: LeadInsightSourceRow): NextBestAction {
  const budget = toNumber(row.budget, 0);
  const noResponseCount = toNumber(row.no_response_count, 0);
  const openTasksCount = toNumber(row.open_tasks_count, 0);
  const totalInteractionsCount = toNumber(row.total_interactions_count, 0);
  const lastActivityDays = daysBetween(
    row.last_activity_at || row.updated_at || row.created_at,
  );
  const status = getLeadDisplayStatus(row);

  if (noResponseCount >= 3) {
    return {
      title: "Re-engage carefully",
      description:
        "This lead has multiple no-response attempts. Try a new channel or a softer follow-up.",
      priority: "high",
    };
  }

  if (lastActivityDays >= 7 && openTasksCount === 0) {
    return {
      title: "Create urgent follow-up",
      description: `No activity found in the last ${lastActivityDays} days and no open follow-up task exists.`,
      priority: "high",
    };
  }

  if (lastActivityDays >= 4 && openTasksCount > 0) {
    return {
      title: "Execute pending follow-up",
      description:
        "A follow-up task exists, but this lead has still been inactive for a few days.",
      priority: "high",
    };
  }

  if (
    budget >= 100000 &&
    ["interested", "qualified", "hot"].includes(status) &&
    !row.has_quote
  ) {
    return {
      title: "Send quotation",
      description:
        "This is a high-value active lead. Share the quotation to move the deal forward.",
      priority: "high",
    };
  }

  if (openTasksCount === 0 && totalInteractionsCount >= 1) {
    return {
      title: "Create next follow-up task",
      description:
        "Engagement has started, but no active follow-up task is planned yet.",
      priority: "medium",
    };
  }

  if (totalInteractionsCount === 0) {
    return {
      title: "Make first contact",
      description:
        "No interaction is logged yet. Start with a call, message, or introductory follow-up.",
      priority: "medium",
    };
  }

  if (totalInteractionsCount === 1) {
    return {
      title: "Do second touchpoint",
      description:
        "One interaction is already logged. A second touchpoint can improve engagement.",
      priority: "medium",
    };
  }

  if (totalInteractionsCount === 2) {
    return {
      title: "Build momentum",
      description:
        "Two interactions are logged. One more strong touchpoint can improve lead confidence.",
      priority: "medium",
    };
  }

  if (["interested"].includes(status) && !row.has_quote) {
    return {
      title: "Move toward proposal",
      description:
        "Lead is interested. Share pricing, proposal, or a more concrete next step.",
      priority: "medium",
    };
  }

  if (["qualified", "hot"].includes(status) && openTasksCount > 0) {
    return {
      title: "Push toward closure",
      description:
        "Lead is qualified and follow-up is active. Focus on conversion-oriented action.",
      priority: "low",
    };
  }

  if (row.has_quote && openTasksCount === 0) {
    return {
      title: "Schedule quote follow-up",
      description:
        "Quotation is already shared. Add a follow-up task to keep momentum going.",
      priority: "medium",
    };
  }

  return {
    title: "Keep engagement active",
    description:
      "Lead is progressing normally. Continue with the current follow-up process.",
    priority: "low",
  };
}

function getReminderSuggestion(row: LeadInsightSourceRow): ReminderSuggestion {
  const openTasksCount = toNumber(row.open_tasks_count, 0);
  const lastActivityDays = daysBetween(
    row.last_activity_at || row.updated_at || row.created_at,
  );
  const nextFollowupDays = daysBetween(row.next_followup_at);

  if (openTasksCount === 0 && lastActivityDays >= 3) {
    return {
      shouldCreateReminder: true,
      dueLabel: "Today",
      reason: "No open follow-up task exists and recent activity is missing.",
    };
  }

  if (row.next_followup_at && nextFollowupDays > 0) {
    return {
      shouldCreateReminder: true,
      dueLabel: "Today",
      reason: "Next follow-up date has already passed.",
    };
  }

  if (row.has_quote) {
    return {
      shouldCreateReminder: true,
      dueLabel: "In 2 days",
      reason:
        "Quotation has been shared. A follow-up reminder should be planned.",
    };
  }

  return {
    shouldCreateReminder: false,
    dueLabel: null,
    reason: "No immediate reminder is needed.",
  };
}

export function buildLeadInsights(row: LeadInsightSourceRow): LeadAIInsights {
  return {
    nextBestAction: getNextBestAction(row),
    leadScore: getLeadScore(row),
    reminderSuggestion: getReminderSuggestion(row),
  };
}

export async function getLeadInsightSource({
  leadId,
  tenantId,
}: GetLeadInsightsParams): Promise<LeadInsightSourceRow | null> {
  const query = `
    SELECT
      l.id,
      l.tenant_id,
      l.first_name,
      l.last_name,
      COALESCE(status_mv.value, status_mv.label, '') AS status,
      COALESCE(l.opportunity_amount, 0) AS budget,
      l.next_followup AS next_followup_at,
      l.created_at,
      l.updated_at,

      GREATEST(
        COALESCE(l.updated_at, l.created_at),
        COALESCE(task_stats.last_task_activity_at, l.created_at),
        COALESCE(interaction_stats.last_interaction_at, l.created_at)
      ) AS last_activity_at,

      COALESCE(task_stats.open_tasks_count, 0) AS open_tasks_count,
      COALESCE(task_stats.closed_tasks_count, 0) AS closed_tasks_count,
      COALESCE(interaction_stats.total_interactions_count, 0) AS total_interactions_count,
      COALESCE(interaction_stats.no_response_count, 0) AS no_response_count,
      COALESCE(quote_stats.has_quote, false) AS has_quote

    FROM leads l

    LEFT JOIN master_values status_mv
      ON status_mv.id = l.status_id
     AND status_mv.tenant_id = l.tenant_id
     AND status_mv.deleted_at IS NULL

    LEFT JOIN (
      SELECT
        t.related_to_id AS lead_id,
        COUNT(*) FILTER (
          WHERE t.deleted_at IS NULL
            AND COALESCE(t.status, '') NOT IN ('completed', 'cancelled')
        )::int AS open_tasks_count,
        COUNT(*) FILTER (
          WHERE t.deleted_at IS NULL
            AND COALESCE(t.status, '') = 'completed'
        )::int AS closed_tasks_count,
        MAX(COALESCE(t.updated_at, t.created_at)) AS last_task_activity_at
      FROM tasks t
      WHERE t.tenant_id = $2
        AND t.related_to_type = 'lead'
        AND t.related_to_id = $1
      GROUP BY t.related_to_id
    ) task_stats
      ON task_stats.lead_id = l.id

    LEFT JOIN (
      SELECT
        i.related_to_id AS lead_id,
        COUNT(*)::int AS total_interactions_count,
        COUNT(*) FILTER (
          WHERE LOWER(COALESCE(i.call_outcome, '')) IN (
            'no response',
            'no_response',
            'not answered',
            'no answer'
          )
             OR LOWER(COALESCE(i.status, '')) IN (
            'no response',
            'no_response',
            'not answered',
            'no answer'
          )
        )::int AS no_response_count,
        MAX(i.start_at) AS last_interaction_at
      FROM interactions i
      WHERE i.tenant_id = $2
        AND i.related_to_type = 'lead'
        AND i.related_to_id = $1
      GROUP BY i.related_to_id
    ) interaction_stats
      ON interaction_stats.lead_id = l.id

    LEFT JOIN (
  SELECT
    q.lead_id,
    TRUE AS has_quote
  FROM quotes q
  WHERE q.tenant_id = $2
    AND q.deleted_at IS NULL
  GROUP BY q.lead_id
) quote_stats
ON quote_stats.lead_id = l.id

    WHERE l.id = $1
      AND l.tenant_id = $2
      AND l.deleted_at IS NULL
    LIMIT 1;
  `;

  const { rows } = await pool.query(query, [leadId, tenantId]);
  return rows?.[0] || null;
}

export async function getLeadInsightsHandler(req: Request, res: Response) {
  try {
    const parsed = GetLeadInsightsSchema.safeParse({
      params: req.params,
    });

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid lead id",
        errors: parsed.error.flatten(),
      });
    }

    const tenantId = getTenantId(req);
    const leadId = parsed.data.params.id;

    const leadRow = await getLeadInsightSource({
      leadId,
      tenantId,
    });

    if (!leadRow) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    const insights = buildLeadInsights(leadRow);

    return res.status(200).json({
      success: true,
      data: insights,
    });
  } catch (error: any) {
    console.error("getLeadInsightsHandler error", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch AI insights",
      error: error?.message || "Unknown error",
    });
  }
}
