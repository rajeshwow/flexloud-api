import { z } from "zod";
import {
  VISIT_REGARDING_OPTIONS,
  VISIT_STATUSES,
  VISIT_TICKET_STATUSES,
} from "./visits.constants";

export const CreateVisitSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),

  status: z.enum(VISIT_STATUSES).optional(),
  regarding: z.enum(VISIT_REGARDING_OPTIONS, {
    required_error: "Regarding is required",
  }),
  ticket_status: z.enum(VISIT_TICKET_STATUSES).optional(),

  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  next_followup_date: z.string().datetime().optional(),

  checkin_captured_at: z.string().datetime().nullable().optional(),
  checkout_captured_at: z.string().datetime().nullable().optional(),

  remarks: z.string().trim().min(1, "Remarks is required"),

  assigned_to_user_id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  contact_id: z.string().uuid().nullable().optional(),
  lead_id: z.string().uuid().nullable().optional(),
  case_id: z.string().uuid().nullable().optional(),

  checkin_address: z.string().trim().optional(),
  checkout_address: z.string().trim().optional(),

  checkin_latitude: z.coerce.number().nullable().optional(),
  checkin_longitude: z.coerce.number().nullable().optional(),
  checkout_latitude: z.coerce.number().nullable().optional(),
  checkout_longitude: z.coerce.number().nullable().optional(),

  spare_cost: z.coerce.number().min(0).optional().default(0),
  employee_cost: z.coerce.number().min(0).optional().default(0),
  travelling_cost: z.coerce.number().min(0).optional().default(0),
  other_cost: z.coerce.number().min(0).optional().default(0),
});

export const UpdateVisitSchema = CreateVisitSchema.partial();

export const GetVisitsListSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  search: z.string().trim().optional(),
  status: z.enum(VISIT_STATUSES).optional(),
  regarding: z.enum(VISIT_REGARDING_OPTIONS).optional(),
  assigned_to_user_id: z.string().uuid().optional(),
});

export type CreateVisitInput = z.infer<typeof CreateVisitSchema>;
export type UpdateVisitInput = z.infer<typeof UpdateVisitSchema>;
export type GetVisitsListInput = z.infer<typeof GetVisitsListSchema>;
