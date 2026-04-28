import { z } from "zod";

const SalesOrderItemSchema = z.object({
  product_id: z.string().uuid("Product is required"),
  sku: z.string().optional().nullable(),
  product_name: z.string().optional().nullable(),
  unit: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  item_code: z.string().optional().nullable(),
  item_name: z.string().optional().nullable(),
  rate: z.coerce.number().min(0).default(0),
  amount: z.coerce.number().min(0).default(0),

  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  price: z.coerce.number().min(0).default(0),
  discount: z.coerce.number().min(0).default(0),
  tax: z.coerce.number().min(0).default(0),
});

export const CreateSalesOrderSchema = z.object({
  so_date: z.string().optional(),
  expected_delivery_date: z.string().optional().nullable(),

  customer_id: z.string().uuid("Customer is required"),
  contact_id: z.string().uuid().optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),

  currency: z.string().default("INR"),
  status: z.string().default("draft"),

  subtotal: z.coerce.number().min(0).default(0),
  discount: z.coerce.number().min(0).default(0),
  tax: z.coerce.number().min(0).default(0),
  shipping: z.coerce.number().min(0).default(0),
  grand_total: z.coerce.number().min(0).default(0),

  notes: z.string().optional().nullable(),
  terms: z.string().optional().nullable(),
  reference_number: z.string().optional().nullable(),

  items: z.array(SalesOrderItemSchema).min(1, "At least one item is required"),
});

export const UpdateSalesOrderSchema = CreateSalesOrderSchema.partial().extend({
  items: z.array(SalesOrderItemSchema).optional(),
});

export const SalesOrderListQuerySchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  customer_id: z.string().uuid().optional(),
  assigned_to: z.string().uuid().optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});
