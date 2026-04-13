export type WorkQueueItemType =
  | "task"
  | "lead_followup"
  | "quote_expiry"
  | "visit"
  | "stale_lead";

export type WorkQueuePriority = "low" | "medium" | "high" | "urgent";

export type WorkQueueSectionStatus =
  | "today"
  | "overdue"
  | "upcoming"
  | "needs_attention";

export type GetMyDayInput = {
  tenantId: string;
  userId?: string;
  view?: "today" | "overdue" | "upcoming" | "all";
  assigned?: "me" | "all";
};

export type WorkQueueItem = {
  id: string;
  type: WorkQueueItemType;
  entity_id: string;
  entity_number?: string | null;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  due_at?: string | null;
  priority: WorkQueuePriority;
  section: WorkQueueSectionStatus;
  assigned_to_user_id?: string | null;
  assigned_to_name?: string | null;
  related_to_type?: string | null;
  related_to_id?: string | null;
  related_to_label?: string | null;
  route: string;
  action_label?: string | null;
  meta?: Record<string, any>;
};

export type MyDaySummary = {
  total_today: number;
  total_overdue: number;
  total_upcoming: number;
  total_needs_attention: number;
};

export type MyDayResponse = {
  summary: MyDaySummary;
  sections: {
    overdue: WorkQueueItem[];
    today: WorkQueueItem[];
    upcoming: WorkQueueItem[];
    needs_attention: WorkQueueItem[];
  };
};

export type MyDayCountsResponse = {
  total: number;
  overdue: number;
  today: number;
  upcoming: number;
  needs_attention: number;
};
