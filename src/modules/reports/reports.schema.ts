import { z } from "zod";

export const TallyAnalyticsQuerySchema = z.object({
  from_date: z.string().trim().optional(),
  to_date: z.string().trim().optional(),

  user_id: z.string().uuid().optional(),
  party_id: z.string().uuid().optional(),

  category: z.string().trim().optional(),
  cost_center_guid: z.string().trim().optional(),
  cost_center_name: z.string().trim().optional(),

  quarter: z.string().trim().optional(),
  financial_year: z.string().trim().optional(),

  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export type TallyAnalyticsQuery = z.infer<typeof TallyAnalyticsQuerySchema>;
