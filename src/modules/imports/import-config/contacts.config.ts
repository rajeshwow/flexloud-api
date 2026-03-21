import type { ImportModuleConfig } from "../imports.types";
import {
  mapContactRowForInsert,
  mapContactRowForUpdate,
} from "../mappers/contacts.mapper";

export const contactsImportConfig: ImportModuleConfig = {
  module: "contacts",
  label: "Contacts",
  tableName: "contacts",
  sampleFileName: "contacts_import_sample.xlsx",
  uniqueBy: ["email", "mobile"],
  requiredAtLeastOneOf: ["email", "mobile"],
  fields: [
    {
      key: "first_name",
      label: "First Name",
      required: true,
      type: "string",
      sampleValue: "Raju",
    },
    {
      key: "last_name",
      label: "Last Name",
      required: false,
      type: "string",
      sampleValue: "Kumar",
    },
    {
      key: "mobile",
      label: "Mobile",
      required: false,
      type: "string",
      sampleValue: "9876543210",
    },
    {
      key: "email",
      label: "Email",
      required: false,
      type: "string",
      sampleValue: "raju@example.com",
    },
    {
      key: "country",
      label: "Country",
      required: false,
      type: "string",
      sampleValue: "India",
    },
    {
      key: "city",
      label: "City",
      required: false,
      type: "string",
      sampleValue: "Jodhpur",
    },
    {
      key: "state",
      label: "State",
      required: false,
      type: "string",
      sampleValue: "Rajasthan",
    },
    {
      key: "organization_name",
      label: "Organization Name",
      required: false,
      type: "string",
      sampleValue: "Flexloud",
    },
    {
      key: "assigned_to_email",
      label: "Assigned To Email",
      required: false,
      type: "string",
      sampleValue: "agent@flexloud.com",
    },
  ],
  mapRowForInsert: mapContactRowForInsert,
  buildUpdateSet: (
    row: Record<string, any>,
    ctx: { tenantId: string; userId: string },
  ) => mapContactRowForUpdate(row, { userId: ctx.userId }),
};
