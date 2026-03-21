export type VisitStatus = "planned" | "in_progress" | "completed" | "cancelled";

export type VisitRegarding =
  | "organization"
  | "contact"
  | "lead"
  | "case"
  | "other";

export type VisitTicketStatus = "open" | "in_progress" | "resolved" | "closed";

export type VisitListItem = {
  id: string;
  tenant_id: string;
  visit_number: string | null;
  name: string;
  status: VisitStatus | null;
  regarding: VisitRegarding | null;
  ticket_status: VisitTicketStatus | null;

  start_date: string | null;
  end_date: string | null;
  next_followup_date: string | null;

  duration: string | null;
  duration_in_minutes: number | null;
  remarks: string | null;

  assigned_to_user_id: string | null;
  organization_id: string | null;
  contact_id: string | null;
  lead_id: string | null;
  case_id: string | null;

  checkin_address: string | null;
  checkout_address: string | null;
  checkin_latitude: number | null;
  checkin_longitude: number | null;
  checkout_latitude: number | null;
  checkout_longitude: number | null;

  spare_cost: number | null;
  employee_cost: number | null;
  travelling_cost: number | null;
  other_cost: number | null;
  total_cost: number | null;

  created_at: string;
  updated_at: string;
  created_by_id: string | null;
  updated_by_id: string | null;
};
