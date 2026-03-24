import { z } from "zod";

export const CreateLeadSchema = z.object({
  lead_number: z.string().optional().nullable(),
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().optional().nullable(),
  designation: z.string().optional().nullable(),
  industry: z.string().optional().nullable(),
  emails: z
    .array(
      z.object({
        email: z.string().email("Invalid email"),
        primary: z.boolean().optional(),
        opt_out: z.boolean().optional(),
        invalid: z.boolean().optional(),
      }),
    )
    .optional()
    .nullable(),
  mobile: z.string().min(1, "Mobile is required"),
  office_phone: z.string().optional().nullable(),

  organization_name: z.string().optional().nullable(),
  dealer_organization: z.string().optional().nullable(),

  status_id: z.string().uuid().optional(),
  product_category: z.string().min(1, "Product category is required"),
  priority_id: z.string().uuid().optional(),

  requirements: z.string().optional().nullable(),

  next_followup: z.string().optional().nullable(),
  followup: z.string().optional().nullable(),
  followup_type: z.string().optional().nullable(),
  source_id: z.string().uuid().optional(),
  add_description: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  referred_by: z.string().optional().nullable(),

  assigned_to: z.string().uuid().optional().nullable(),

  opportunity_name: z.string().optional().nullable(),
  opportunity_amount: z.number().optional().nullable(),
  expected_close_date: z.string().optional().nullable(),
  sales_stage: z.string().optional().nullable(),

  primary_address_street: z.string().optional().nullable(),
  primary_address_area: z.string().optional().nullable(),
  primary_address_postal_code: z.string().optional().nullable(),
  primary_address_city: z.string().optional().nullable(),
  primary_address_state: z.string().optional().nullable(),
  primary_address_country: z.string().optional().nullable(),

  alternate_address_street: z.string().optional().nullable(),
  alternate_address_area: z.string().optional().nullable(),
  alternate_address_postal_code: z.string().optional().nullable(),
  alternate_address_city: z.string().optional().nullable(),
  alternate_address_state: z.string().optional().nullable(),
  alternate_address_country: z.string().optional().nullable(),
});

export const UpdateLeadSchema = CreateLeadSchema.partial();

export const GetLeadsSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  search: z.string().optional(),
  status_id: z.string().uuid().optional(),
  assigned_to: z.string().uuid().optional(),
});
