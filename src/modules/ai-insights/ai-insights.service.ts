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

  if (budget >= 100000) {
    score += 25;
    reasons.push("High budget");
  } else if (budget >= 50000) {
    score += 15;
    reasons.push("Moderate budget");
  }

  if (lastActivityDays <= 2) {
    score += 15;
    reasons.push("Recent activity found");
  } else if (lastActivityDays >= 7) {
    score -= 15;
    reasons.push("No recent activity");
  }

  if (["interested", "qualified", "hot"].includes(status)) {
    score += 20;
    reasons.push("Positive lead status");
  }

  if (openTasksCount > 0) {
    score += 10;
    reasons.push("Follow-up task exists");
  }

  if (totalInteractionsCount >= 3) {
    score += 10;
    reasons.push("Multiple interactions logged");
  }

  if (row.has_quote) {
    score += 10;
    reasons.push("Quote already shared");
  }

  if (noResponseCount >= 3) {
    score -= 20;
    reasons.push("Multiple no responses");
  } else if (noResponseCount > 0) {
    score -= 8;
    reasons.push("Some no response history");
  }

  score = clamp(score, 0, 100);

  let label: LeadTemperature = "Cold";
  if (score >= 80) label = "Hot";
  else if (score >= 50) label = "Warm";

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
  const lastActivityDays = daysBetween(
    row.last_activity_at || row.updated_at || row.created_at,
  );
  const status = getLeadDisplayStatus(row);

  if (lastActivityDays >= 5 && openTasksCount === 0) {
    return {
      title: "Follow up now",
      description: `No activity found in the last ${lastActivityDays} days and no open follow-up task exists.`,
      priority: "high",
    };
  }

  if (budget >= 100000 && noResponseCount > 0) {
    return {
      title: "Call this lead",
      description:
        "This is a high-budget lead with response gaps. A direct call is recommended.",
      priority: "high",
    };
  }

  if (["interested", "qualified"].includes(status) && !row.has_quote) {
    return {
      title: "Send quotation",
      description:
        "Lead looks interested but quotation has not been shared yet.",
      priority: "high",
    };
  }

  if (openTasksCount === 0) {
    return {
      title: "Create follow-up task",
      description: "No active follow-up task exists for this lead.",
      priority: "medium",
    };
  }

  return {
    title: "Keep engagement active",
    description:
      "Lead is being tracked. Continue with the current follow-up process.",
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
      l.status,
      l.created_at,
      l.updated_at
    FROM leads l
    WHERE l.id = $1
      AND l.tenant_id = $2
    LIMIT 1;
  `;

  const { rows } = await pool.query(query, [leadId, tenantId]);

  if (!rows?.length) return null;

  const lead = rows[0];

  // default values attach kar rahe hain (taaki crash na ho)
  return {
    ...lead,
    budget: 0,
    next_followup_at: null,
    last_activity_at: lead.updated_at,
    open_tasks_count: 0,
    closed_tasks_count: 0,
    total_interactions_count: 0,
    no_response_count: 0,
    has_quote: false,
  } as LeadInsightSourceRow;
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
