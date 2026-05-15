import { z } from "zod";

export const CreateProductSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, "Name is required").max(255),
    part_number: z.string().trim().max(255).optional().nullable(),
    hsn_code: z.string().trim().min(1, "HSN code is required").max(100),
    unit_uqc: z.string().trim().max(100).optional().nullable(),
    category: z.string().trim().max(255).optional().nullable(),
    manufacturer: z.string().trim().max(255).optional().nullable(),
    description: z.string().trim().optional().nullable(),

    assigned_to: z.string().uuid().optional().nullable(),
    status: z.enum(["active", "inactive"]).optional().default("active"),

    cost_price_currency: z.string().trim().max(10).optional().default("INR"),
    cost_price: z.coerce.number().min(0).optional().default(0),

    msp_currency: z.string().trim().max(10).optional().default("INR"),
    msp: z.coerce.number().min(0).optional().default(0),

    selling_price_currency: z.string().trim().max(10).optional().default("INR"),
    selling_price: z.coerce.number().min(0).optional().default(0),

    tax: z.string().trim().max(100).optional().nullable(),

    opening_stock: z.coerce.number().min(0).optional().default(0),
    opening_stock_value: z.coerce.number().min(0).optional().default(0),
    stock_on_hand: z.coerce.number().min(0).optional().default(0),
    committed_stock: z.coerce.number().min(0).optional().default(0),
    available_for_sale: z.coerce.number().min(0).optional().default(0),
    qty_to_be_invoiced_shipped: z.coerce.number().min(0).optional().default(0),
    qty_to_be_received_billed: z.coerce.number().min(0).optional().default(0),
  }),
});

export const GetProductsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(10000).optional().default(10),
    search: z.string().trim().optional(),
    status: z.string().trim().optional(),
    category: z.string().trim().optional(),
    manufacturer: z.string().trim().optional(),
    assigned_to: z.string().uuid().optional(),
  }),
});

export type CreateProductBody = z.infer<typeof CreateProductSchema>["body"];
export type GetProductsQuery = z.infer<typeof GetProductsSchema>["query"];
