export type InsightPriority = "low" | "medium" | "high";
export type LeadTemperature = "Hot" | "Warm" | "Cold";

export type NextBestAction = {
  title: string;
  description: string;
  priority: InsightPriority;
};

export type LeadScore = {
  score: number;
  label: LeadTemperature;
  reasons: string[];
};

export type ReminderSuggestion = {
  shouldCreateReminder: boolean;
  dueLabel: string | null;
  reason: string;
};

export type LeadAIInsights = {
  nextBestAction: NextBestAction;
  leadScore: LeadScore;
  reminderSuggestion: ReminderSuggestion;
};

export type LeadInsightSourceRow = {
  id: string;
  tenant_id: string;
  first_name: string | null;
  last_name: string | null;
  status: string | null;
  budget: number | string | null;
  next_followup_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_activity_at: string | null;
  open_tasks_count: number | string | null;
  closed_tasks_count: number | string | null;
  total_interactions_count: number | string | null;
  no_response_count: number | string | null;
  has_quote: boolean | null;
};

export type GetLeadInsightsParams = {
  leadId: string;
  tenantId: string;
};
