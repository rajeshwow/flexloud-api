import { z } from "zod";

export const getTallyCompaniesQuerySchema = z.object({
  search: z.string().trim().optional(),
  is_active: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => {
      if (value === "true") return true;
      if (value === "false") return false;
      return undefined;
    }),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const companyIdParamsSchema = z.object({
  id: z.string().uuid("Invalid tally company id"),
});

export const updateCostCenterAccessSchema = z.object({
  cost_center_ids: z
    .array(z.string().uuid("Invalid cost center id"))
    .default([]),
});

export type GetTallyCompaniesQuery = z.infer<
  typeof getTallyCompaniesQuerySchema
>;
export type UpdateCostCenterAccessBody = z.infer<
  typeof updateCostCenterAccessSchema
>;
