import { z } from "zod";

export const GetTaskPerformanceSummarySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  assigned_to: z.string().uuid().optional(),
});

export const RecalculateTaskScoreSchema = z.object({
  task_id: z.string().uuid(),
});

export type GetTaskPerformanceSummaryInput = z.infer<
  typeof GetTaskPerformanceSummarySchema
>;
export type RecalculateTaskScoreInput = z.infer<
  typeof RecalculateTaskScoreSchema
>;
