import { z } from "zod";

export const GetMyDaySchema = z.object({
  view: z.enum(["today", "overdue", "upcoming", "all"]).optional(),
  assigned: z.enum(["me", "all"]).optional(),
});

export type GetMyDayQuery = z.infer<typeof GetMyDaySchema>;
