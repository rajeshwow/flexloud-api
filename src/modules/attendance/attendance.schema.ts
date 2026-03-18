import { z } from "zod";

export const ClockInSchema = z.object({
  remarks: z.string().trim().max(500).optional(),
  source: z.enum(["web", "mobile", "admin"]).optional().default("web"),
});

export const ClockOutSchema = z.object({
  remarks: z.string().trim().max(500).optional(),
});

export const GetAttendanceHistorySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  from: z.string().optional(),
  to: z.string().optional(),
  user_id: z.string().uuid().optional(),
});
