export type AIEntityType = "lead" | "contact" | "organization" | "opportunity";

export type AIPriority = "hot" | "warm" | "cold";
export type AISentiment = "positive" | "neutral" | "negative";

export type AISuggestedTask = {
  title: string;
  due_in_days: number;
  note: string;
};

export type AIInsightResponse = {
  summary: string;
  priority: AIPriority;
  sentiment: AISentiment;
  confidence: number;
  risk_flags: string[];
  next_best_actions: string[];
  suggested_task: AISuggestedTask | null;
};

export type AIFollowupResponse = {
  subject: string;
  message: string;
  channel: "email" | "whatsapp";
};

export type AISummaryResponse = {
  summary: string;
  key_points: string[];
  recommended_next_step: string;
};
