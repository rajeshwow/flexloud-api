import { z } from "zod";

const ReminderSchema = z.object({
  minutes_before: z.number().int().min(0),
});

const InviteeSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().email().optional(),
  linked_contact_id: z.string().uuid().optional(),
  linked_lead_id: z.string().uuid().optional(),
});

export const CreateInteractionSchema = z.object({
  body: z.object({
    type: z.enum(["meeting", "call"]),
    subject: z.string().min(1, "Subject is required"),
    status: z
      .enum(["planned", "held", "not_held", "completed", "cancelled"])
      .optional(),

    related_to_type: z
      .enum(["lead", "contact", "organization", "opportunity"])
      .optional(),
    related_to_id: z.string().uuid().optional(),

    start_at: z.string().min(1, "Start date/time is required"),
    end_at: z.string().min(1, "End date/time is required"),
    duration_minutes: z.number().int().min(0).optional(),

    location: z.string().optional(),
    description: z.string().optional(),

    assigned_to: z.string().uuid().optional(),

    call_purpose: z.string().optional(),
    call_outcome: z.string().optional(),

    reminders: z.array(ReminderSchema).optional(),
    invitees: z.array(InviteeSchema).optional(),
  }),
});

export const UpdateInteractionSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    type: z.enum(["meeting", "call"]),
    subject: z.string().min(1, "Subject is required"),
    status: z
      .enum(["planned", "held", "not_held", "completed", "cancelled"])
      .optional(),

    related_to_type: z
      .enum(["lead", "contact", "organization", "opportunity"])
      .optional(),
    related_to_id: z.string().uuid().optional(),

    start_at: z.string().min(1, "Start date/time is required"),
    end_at: z.string().min(1, "End date/time is required"),
    duration_minutes: z.number().int().min(0).optional(),

    location: z.string().optional(),
    description: z.string().optional(),

    assigned_to: z.string().uuid().optional(),

    call_purpose: z.string().optional(),
    call_outcome: z.string().optional(),

    reminders: z.array(ReminderSchema).optional(),
    invitees: z.array(InviteeSchema).optional(),
  }),
});

export const GetInteractionsSchema = z.object({
  query: z.object({
    search: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
    type: z.enum(["meeting", "call"]).optional(),
    status: z
      .enum(["planned", "held", "not_held", "completed", "cancelled"])
      .optional(),
    assigned_to: z.string().uuid().optional(),
    related_to_type: z
      .enum(["lead", "contact", "organization", "opportunity"])
      .optional(),
    related_to_id: z.string().uuid().optional(),
  }),
});

export const GetInteractionByIdSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});
