import { z } from "zod";

export const GetPurchaseOrdersQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.string().trim().optional(),
  vendor_id: z.string().uuid().optional(),

  // filters from UI
  assigned_to: z.string().trim().optional(),
  vendor: z.string().trim().optional(),

  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export const PurchaseOrderIdParamSchema = z.object({
  id: z.string().uuid("Invalid purchase order id"),
});

export const CreatePurchaseOrderSchema = z.object({
  po_number: z.string().trim().optional(),
  po_date: z.string().min(1),

  expected_delivery_date: z.string().optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),

  vendor_id: z.string().uuid().optional().nullable(),
  vendor_name: z.string().optional().nullable(),

  currency: z.string().default("INR"),

  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        product_name: z.string().optional().nullable(),
        quantity: z.coerce.number().min(1),
        price: z.coerce.number().min(0),
        discount: z.coerce.number().min(0).default(0),
        unit: z.string().optional().nullable(),
        description: z.string().optional().nullable(),
      }),
    )
    .min(1),

  subtotal: z.coerce.number().min(0),
  discount: z.coerce.number().min(0).default(0),
  shipping: z.coerce.number().min(0).default(0),
  tax: z.coerce.number().min(0).default(0),
  total: z.coerce.number().min(0),
  grand_total: z.coerce.number().min(0),

  status: z.string().optional().default("draft"),
});
