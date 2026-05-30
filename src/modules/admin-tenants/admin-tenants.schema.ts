import { z } from "zod";

export const createTenantSchema = z.object({
  name: z.string().min(2, "Tenant name is required"),
  slug: z
    .string()
    .min(2, "Slug is required")
    .max(120)
    .regex(
      /^[a-z0-9-]+$/,
      "Slug can contain only lowercase letters, numbers and hyphen",
    ),
});

export const bootstrapTenantSchema = z.object({
  adminEmail: z.string().email("Valid admin email is required"),
  adminName: z.string().min(2, "Admin name is required"),
  adminPassword: z.string().min(2, "Admin password is required"),
});

export const updateTenantStatusSchema = z.object({
  status: z.enum(["active", "inactive", "suspended"]),
});

export const tenantListQuerySchema = z.object({
  search: z.string().optional(),
  status: z.enum(["active", "inactive", "suspended"]).optional(),
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(10),
});
