import { z } from "zod";

export const userIdParamsSchema = z.object({
  userId: z.string().uuid("Invalid user id"),
});

export const updateUserCostCentersSchema = z.object({
  cost_center_ids: z
    .array(z.string().uuid("Invalid cost center id"))
    .default([]),
});

export type UpdateUserCostCentersBody = z.infer<
  typeof updateUserCostCentersSchema
>;
