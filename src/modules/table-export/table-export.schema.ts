import { z } from "zod";

const emptyToUndefined = (value: unknown) => {
  if (value === "" || value === null || value === undefined) return undefined;
  return value;
};

export const exportQuerySchema = z
  .object({
    q: z.preprocess(emptyToUndefined, z.string().optional()),

    from_date: z.preprocess(emptyToUndefined, z.string().optional()),
    to_date: z.preprocess(emptyToUndefined, z.string().optional()),

    date_from: z.preprocess(emptyToUndefined, z.string().optional()),
    date_to: z.preprocess(emptyToUndefined, z.string().optional()),

    status: z.preprocess(emptyToUndefined, z.string().optional()),
    assigned_to: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
    created_by: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
    updated_by: z.preprocess(emptyToUndefined, z.string().uuid().optional()),

    organization_id: z.preprocess(
      emptyToUndefined,
      z.string().uuid().optional(),
    ),
    contact_id: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
    customer_id: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
    quote_id: z.preprocess(emptyToUndefined, z.string().uuid().optional()),

    status_id: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
    priority_id: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
    source_id: z.preprocess(emptyToUndefined, z.string().uuid().optional()),

    limit: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(100000).optional(),
    ),
  })
  .passthrough();

export type ExportQuery = z.infer<typeof exportQuerySchema>;
