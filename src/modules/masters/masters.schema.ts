import { z } from "zod";

export const CreateMasterTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9_]+$/, "Code must be snake_case"),
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(1000).nullable().optional(),
  module_name: z.string().trim().max(100).nullable().optional(),
  is_active: z.boolean().optional(),
});

export const UpdateMasterTypeSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  module_name: z.string().trim().max(100).nullable().optional(),
  is_active: z.boolean().optional(),
});

export const GetMasterTypesSchema = z.object({
  search: z.string().trim().optional(),
  module_name: z.string().trim().optional(),
  is_active: z.union([z.literal("true"), z.literal("false")]).optional(),
});

export const CreateMasterValueSchema = z
  .object({
    master_type_id: z.string().uuid().optional(),
    type_code: z.string().trim().min(2).max(100).optional(),

    label: z.string().trim().min(1).max(150),
    value: z
      .string()
      .trim()
      .min(1)
      .max(150)
      .regex(/^[a-z0-9_:-]+$/, "Value must be slug/snake-case compatible"),
    description: z.string().trim().max(1000).nullable().optional(),
    color: z.string().trim().max(30).nullable().optional(),
    parent_id: z.string().uuid().nullable().optional(),

    is_default: z.boolean().optional(),
    is_active: z.boolean().optional(),
    sort_order: z.number().int().min(0).optional(),
    metadata: z.record(z.any()).optional(),
  })
  .refine((data) => !!data.master_type_id || !!data.type_code, {
    message: "Either master_type_id or type_code is required",
    path: ["master_type_id"],
  });

export const UpdateMasterValueSchema = z.object({
  label: z.string().trim().min(1).max(150).optional(),
  value: z
    .string()
    .trim()
    .min(1)
    .max(150)
    .regex(/^[a-z0-9_:-]+$/, "Value must be slug/snake-case compatible")
    .optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  color: z.string().trim().max(30).nullable().optional(),
  parent_id: z.string().uuid().nullable().optional(),
  is_default: z.boolean().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(0).optional(),
  metadata: z.record(z.any()).optional(),
});

export const GetMasterValuesSchema = z
  .object({
    type_code: z.string().trim().optional(),
    master_type_id: z.string().uuid().optional(),
    search: z.string().trim().optional(),
    parent_id: z.string().uuid().optional(),
    parent_value: z.string().trim().optional(),
    is_active: z.union([z.literal("true"), z.literal("false")]).optional(),
  })
  .refine((data) => !!data.type_code || !!data.master_type_id, {
    message: "Either type_code or master_type_id is required",
    path: ["type_code"],
  });
