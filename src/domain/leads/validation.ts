import { z } from "zod";

export const createLeadSchema = z.object({
  title: z.string().min(2).max(200),
  source: z.string().max(100).optional(),
  ownerUserId: z.string().max(128).optional(),
  initialStageId: z.string().max(64).optional(),
});

export const patchLeadSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  source: z.string().max(100).optional(),
  status: z.enum(["OPEN", "WON", "LOST", "ARCHIVED"]).optional(),
});

export const assignLeadSchema = z.object({
  ownerUserId: z.string().min(1).max(128),
});

export const transitionSchema = z.object({
  toStageId: z.string().min(1).max(64),
  note: z.string().max(2000).optional(),
});

export const activitySchema = z.object({
  type: z.enum(["NOTE", "CALL", "EMAIL", "MEETING", "FOLLOW_UP"]),
  body: z.string().min(1).max(4000),
});
