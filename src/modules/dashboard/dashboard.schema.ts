import { z } from "zod";

export const GetDashboardSummarySchema = z.object({
  period: z.enum(["today", "week", "month", "all"]).optional().default("month"),
});

export type GetDashboardSummaryInput = z.infer<
  typeof GetDashboardSummarySchema
>;
