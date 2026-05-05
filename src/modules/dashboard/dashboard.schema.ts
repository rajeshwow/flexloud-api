import { z } from "zod";

export const GetDashboardSummarySchema = z
  .object({
    period: z
      .enum(["today", "week", "month", "all"])
      .optional()
      .default("month"),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    assigned_to: z.string().uuid().optional(),
    source: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const hasDateRange = Boolean(data.start_date || data.end_date);
    const hasPeriod = Boolean(data.period);

    if (hasDateRange && (!data.start_date || !data.end_date)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Both start_date and end_date are required for date range filter",
        path: ["date_range"],
      });
    }

    if (hasDateRange && hasPeriod && data.period !== "month") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use either period or date range, not both",
        path: ["period"],
      });
    }
  });

export type GetDashboardSummaryInput = z.infer<
  typeof GetDashboardSummarySchema
>;
