import { z } from "zod";

export const GetLeadInsightsSchema = z.object({
  params: z.object({
    id: z.string().uuid("Valid lead id is required"),
  }),
});

export type GetLeadInsightsRequest = z.infer<typeof GetLeadInsightsSchema>;
