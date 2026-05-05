import { z } from "zod";

const OptionalNumberSchema = z
  .union([z.string(), z.number()])
  .optional()
  .nullable()
  .transform((value) => {
    if (value === "" || value === null || value === undefined) return 0;
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  });

const OptionalStringSchema = z
  .string()
  .optional()
  .nullable()
  .transform((value) => value || null);

export const DeliveryChallanItemSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  product_id: z.string().uuid().optional().nullable(),
  item_name: z.string().trim().min(1, "Item name is required"),
  sku: OptionalStringSchema,

  quantity: OptionalNumberSchema,
  rate: OptionalNumberSchema,
  discount: OptionalNumberSchema,

  tax: OptionalNumberSchema,
  cgst: OptionalNumberSchema,
  sgst: OptionalNumberSchema,
  amount: OptionalNumberSchema,
});

export const CreateDeliveryChallanSchema = z.object({
  customer_id: z.string().uuid().optional().nullable(),
  customer_name: z.string().trim().min(1, "Customer name is required"),
  customer_email: OptionalStringSchema,
  customer_phone: OptionalStringSchema,

  reference_no: OptionalStringSchema,
  challan_date: z.string().min(1, "Challan date is required"),
  challan_type: z.string().trim().min(1, "Challan type is required"),

  notes: OptionalStringSchema,

  subtotal: OptionalNumberSchema,
  discount_percent: OptionalNumberSchema,
  discount_amount: OptionalNumberSchema,
  adjustment: OptionalNumberSchema,
  total: OptionalNumberSchema,

  status: z.string().optional().default("draft"),

  items: z
    .array(DeliveryChallanItemSchema)
    .min(1, "At least one item is required"),
});

export const UpdateDeliveryChallanSchema =
  CreateDeliveryChallanSchema.partial().extend({
    items: z.array(DeliveryChallanItemSchema).optional(),
  });

export const ListDeliveryChallansQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().optional().default(""),
  status: z.string().optional().default(""),
});
