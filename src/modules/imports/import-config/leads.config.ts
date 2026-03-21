import type { ImportModuleConfig } from "../imports.types";
import {
  mapLeadRowForInsert,
  mapLeadRowForUpdate,
} from "../mappers/leads.mapper";

export const leadsImportConfig: ImportModuleConfig = {
  module: "leads",
  label: "Leads",
  tableName: "leads",
  sampleFileName: "leads_import_sample.csv",

  // direct UUID ya id based duplicate nahi
  uniqueBy: ["mobile"],
  requiredAtLeastOneOf: ["emails", "mobile"],

  fields: [
    {
      key: "first_name",
      label: "First Name",
      required: true,
      type: "string",
      sampleValue: "Amit",
    },
    {
      key: "last_name",
      label: "Last Name",
      type: "string",
      sampleValue: "Sharma",
    },
    {
      key: "emails",
      label: "Emails",
      type: "string",
      sampleValue: "amit@example.com",
    },
    {
      key: "mobile",
      label: "Mobile",
      type: "mobile",
      sampleValue: "9999911111",
    },
    {
      key: "office_phone",
      label: "Office Phone",
      type: "mobile",
      sampleValue: "01145678901",
    },
    {
      key: "organization_name",
      label: "Organization Name",
      type: "string",
      sampleValue: "ABC Pvt Ltd",
    },
    {
      key: "designation",
      label: "Designation",
      type: "string",
      sampleValue: "Manager",
    },
    {
      key: "industry",
      label: "Industry",
      type: "string",
      sampleValue: "Healthcare",
    },
    {
      key: "dealer_organization",
      label: "Dealer Organization",
      type: "string",
      sampleValue: "XYZ Distributors",
    },
    {
      key: "priority",
      label: "Priority",
      type: "enum",
      enumValues: ["low", "medium", "high"],
      sampleValue: "high",
    },
    {
      key: "status",
      label: "Status",
      type: "string",
      sampleValue: "new",
    },
    {
      key: "product_category",
      label: "Product Category",
      type: "string",
      sampleValue: "Software",
    },
    {
      key: "requirements",
      label: "Requirements",
      type: "string",
      sampleValue: "Need CRM demo",
    },
    {
      key: "next_followup",
      label: "Next Followup",
      type: "date",
      sampleValue: "2026-03-31",
    },
    {
      key: "followup",
      label: "Followup",
      type: "string",
      sampleValue: "Call next week",
    },
    {
      key: "followup_type",
      label: "Followup Type",
      type: "string",
      sampleValue: "call",
    },
    {
      key: "lead_source",
      label: "Lead Source",
      type: "string",
      sampleValue: "Facebook",
    },
    {
      key: "add_description",
      label: "Additional Description",
      type: "string",
      sampleValue: "Interested in enterprise plan",
    },
    {
      key: "description",
      label: "Description",
      type: "string",
      sampleValue: "Imported from campaign list",
    },

    // human-friendly lookup field
    {
      key: "assigned_to_email",
      label: "Assigned To Email",
      type: "email",
      sampleValue: "sales@example.com",
    },

    {
      key: "referred_by",
      label: "Referred By",
      type: "string",
      sampleValue: "Rahul",
    },
    {
      key: "opportunity_name",
      label: "Opportunity Name",
      type: "string",
      sampleValue: "Annual CRM Subscription",
    },
    {
      key: "opportunity_amount",
      label: "Opportunity Amount",
      type: "number",
      sampleValue: 50000,
    },
    {
      key: "expected_close_date",
      label: "Expected Close Date",
      type: "date",
      sampleValue: "2026-04-15",
    },
    {
      key: "sales_stage",
      label: "Sales Stage",
      type: "string",
      sampleValue: "proposal",
    },

    {
      key: "primary_address_street",
      label: "Primary Address Street",
      type: "string",
      sampleValue: "MG Road",
    },
    {
      key: "primary_address_area",
      label: "Primary Address Area",
      type: "string",
      sampleValue: "Sector 18",
    },
    {
      key: "primary_address_postalcode",
      label: "Primary Address Postal Code",
      type: "string",
      sampleValue: "122001",
    },
    {
      key: "primary_address_city",
      label: "Primary Address City",
      type: "string",
      sampleValue: "Gurugram",
    },
    {
      key: "primary_address_state",
      label: "Primary Address State",
      type: "string",
      sampleValue: "Haryana",
    },
    {
      key: "primary_address_country",
      label: "Primary Address Country",
      type: "string",
      sampleValue: "India",
    },

    {
      key: "alt_address_street",
      label: "Alt Address Street",
      type: "string",
      sampleValue: "Ring Road",
    },
    {
      key: "alt_address_area",
      label: "Alt Address Area",
      type: "string",
      sampleValue: "Phase 2",
    },
    {
      key: "alt_address_postalcode",
      label: "Alt Address Postal Code",
      type: "string",
      sampleValue: "110001",
    },
    {
      key: "alt_address_city",
      label: "Alt Address City",
      type: "string",
      sampleValue: "Delhi",
    },
    {
      key: "alt_address_state",
      label: "Alt Address State",
      type: "string",
      sampleValue: "Delhi",
    },
    {
      key: "alt_address_country",
      label: "Alt Address Country",
      type: "string",
      sampleValue: "India",
    },
  ],

  mapRowForInsert: mapLeadRowForInsert,
  buildUpdateSet: (
    row: Record<string, any>,
    ctx: { tenantId: string; userId: string },
  ) => mapLeadRowForUpdate(row, { userId: ctx.userId }),
};
