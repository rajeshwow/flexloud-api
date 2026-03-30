import { z } from "zod";

export const CreateRoleSchema = z.object({
  name: z.string().min(2),
  code: z.string().optional(),
  description: z.string().optional().nullable(),
  is_active: z.boolean().optional().default(true),
  permissions: z.array(z.string()).default([]),
});

export const UpdateRoleSchema = z.object({
  name: z.string().min(2).optional(),
  code: z.string().optional(),
  description: z.string().optional().nullable(),
  is_active: z.boolean().optional(),
  permissions: z.array(z.string()).optional(),
});

export const CloneRoleSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional().nullable(),
});

export const UpdateUserRolesSchema = z.object({
  role_ids: z.array(z.string().uuid()).default([]),
});
