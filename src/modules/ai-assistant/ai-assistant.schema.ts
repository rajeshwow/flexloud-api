import { z } from "zod";

export const GetAIInsightsSchema = z.object({
  entity_type: z.enum(["lead", "contact", "organization", "opportunity"]),
  entity_id: z.string().uuid(),
  force_refresh: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => {
      if (typeof value === "boolean") return value;
      if (typeof value === "string") return value === "true";
      return false;
    }),
});

export const GenerateAIFollowupSchema = z.object({
  entity_type: z.enum(["lead", "contact", "organization", "opportunity"]),
  entity_id: z.string().uuid(),
  channel: z.enum(["email", "whatsapp"]).default("email"),
});

export const SummarizeActivitiesSchema = z.object({
  entity_type: z.enum(["lead", "contact", "organization", "opportunity"]),
  entity_id: z.string().uuid(),
});

export type GetAIInsightsInput = z.infer<typeof GetAIInsightsSchema>;
export type GenerateAIFollowupInput = z.infer<typeof GenerateAIFollowupSchema>;
export type SummarizeActivitiesInput = z.infer<
  typeof SummarizeActivitiesSchema
>;
