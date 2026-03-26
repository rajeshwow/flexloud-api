import { z } from "zod";

export const CreateQuoteSchema = z.object({
  body: z.object({
    title: z.string().min(1),
    quotation_date: z.string(),
    valid_until: z.string(),
    validation_period: z.number().optional(),

    quote_stage: z.string().optional(),

    organization_id: z.string().uuid().optional(),
    contact_id: z.string().uuid().optional(),
    opportunity_id: z.string().uuid().optional(),
    assigned_to: z.string().uuid().optional(),

    company_name: z.string().optional(),
    gstin: z.string().optional(),

    currency: z.string().optional(),

    terms_condition: z.string().optional(),
    terms_condition_description: z.string().optional(),

    material_delivery_time: z.string().optional(),

    payment_terms: z.string().optional(),
    payment_terms_description: z.string().optional(),

    description: z.string().optional(),

    billing_address: z.any().optional(),
    shipping_address: z.any().optional(),

    subtotal: z.number().optional(),
    discount: z.number().optional(),
    total: z.number().optional(),
    freight_charges: z.number().optional(),
    tax: z.number().optional(),
    grand_total: z.number().optional(),

    line_items: z
      .array(
        z.object({
          group_name: z.string().optional(),
          item_type: z.enum(["product", "service"]),
          product_name: z.string().optional(),
          service_name: z.string().optional(),
          quantity: z.number(),
          sale_price: z.number(),
          line_total: z.number(),
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
