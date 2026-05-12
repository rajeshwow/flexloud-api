import { z } from "zod";

export const CreateQuoteSchema = z.object({
  body: z.object({
    title: z.string().min(1),

    // 🔥 RELATED FIX
    related_to_type: z
      .enum(["organization", "contact", "lead", "opportunity"])
      .optional()
      .nullable(),

    related_to_id: z.string().uuid().optional().nullable(),

    quotation_date: z.string(),
    valid_until: z.string(),
    validation_period: z.number().optional(),
    organization_branch_id: z.string().uuid().optional().nullable(),

    quote_stage: z.string().optional(),

    organization_id: z.string().uuid().optional().nullable(),
    contact_id: z.string().uuid().optional().nullable(),
    opportunity_id: z.string().uuid().optional().nullable(),

    assigned_to: z.string().uuid().optional(),

    company_name: z.string().optional().nullable(),
    gstin: z.string().optional().nullable(),

    currency: z.string().optional(),

    terms_condition: z.string().optional().nullable(),
    terms_condition_description: z.string().optional().nullable(),

    material_delivery_time: z.string().optional().nullable(),

    payment_terms: z.string().optional().nullable(),
    payment_terms_description: z.string().optional().nullable(),

    description: z.string().optional().nullable(),

    // 🔥 ADDRESS (align with payload)
    billing_street: z.string().optional().nullable(),
    billing_area: z.string().optional().nullable(),
    billing_country: z.string().optional().nullable(),
    billing_state: z.string().optional().nullable(),
    billing_city: z.string().optional().nullable(),
    billing_postal_code: z.string().optional().nullable(),

    shipping_street: z.string().optional().nullable(),
    shipping_area: z.string().optional().nullable(),
    shipping_country: z.string().optional().nullable(),
    shipping_state: z.string().optional().nullable(),
    shipping_city: z.string().optional().nullable(),
    shipping_postal_code: z.string().optional().nullable(),

    // 🔥 AMOUNTS (payload me string aa rahi h → support both)
    subtotal: z.union([z.number(), z.string()]).optional(),
    discount: z.union([z.number(), z.string()]).optional(),
    total: z.union([z.number(), z.string()]).optional(),
    freight_charges: z.union([z.number(), z.string()]).optional(),
    freight_type: z.string().optional().nullable(),
    tax_on_freight: z.union([z.number(), z.string()]).optional(),
    tax: z.union([z.number(), z.string()]).optional(),
    grand_total: z.union([z.number(), z.string()]).optional(),

    // 🔥 LINE ITEMS (full aligned)
    line_items: z
      .array(
        z.object({
          group_name: z.string().optional().nullable(),
          item_type: z.enum(["product", "service"]),

          product_name: z.string().optional().nullable(),
          service_name: z.string().optional().nullable(),

          hsn_code: z.string().optional().nullable(),

          quantity: z.number(),
          list_price: z.number().optional(),
          discount_value: z.number().optional(),
          discount_type: z.string().optional(),

          sale_price: z.number(),
          tax_amount: z.number().optional(),

          tax_type_1: z.string().optional().nullable(),
          tax_type_2: z.string().optional().nullable(),

          description: z.string().optional().nullable(),
          note: z.string().optional().nullable(),

          line_total: z.number(),
          sort_order: z.number().optional(),
        }),
      )
      .optional(),
  }),
});

export const UpdateQuoteSchema = CreateQuoteSchema;

export const GetQuotesSchema = z.object({
  query: z.object({
    search: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
  }),
});

export const GetQuoteByIdSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});
