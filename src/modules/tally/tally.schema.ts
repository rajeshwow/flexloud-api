import { z } from "zod";

const OptionalNumberLikeSchema = z
  .union([z.string(), z.number()])
  .nullable()
  .optional();

const OptionalRecordsSchema = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({
    records: z.array(schema).optional().default([]),
  });

const TallyCompanyFieldsSchema = z.object({
  tallyCompanyName: z.string().trim().nullable().optional(),
  tallyCompanyGuid: z.string().trim().nullable().optional(),

  tally_company_name: z.string().trim().nullable().optional(),
  tally_company_guid: z.string().trim().nullable().optional(),

  companyName: z.string().trim().nullable().optional(),
  companyGuid: z.string().trim().nullable().optional(),

  company_name: z.string().trim().nullable().optional(),
  company_guid: z.string().trim().nullable().optional(),
});

export const UpsertTallyConnectionSchema = z.object({
  company_name: z.string().trim().optional(),
  company_guid: z.string().nullable().optional(),
  direction: z.enum(["pull", "push"]).optional(),
  frequency_minutes: z.number().int().positive().optional(),
  tally_url: z.string().trim().default("http://localhost:9000"),
  sync_direction: z.enum(["pull", "push", "both"]).default("pull"),
  sync_frequency_minutes: z.number().int().min(1).max(1440).default(10),
  is_active: z.boolean().default(true),
});

const TallyLedgerRecordSchema = TallyCompanyFieldsSchema.extend({
  guid: z.string().optional(),
  masterId: z.union([z.string(), z.number()]).optional(),
  alterId: z.union([z.string(), z.number()]).optional(),
  name: z.string().trim().min(1),
  parent: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  gstin: z.string().optional(),
  gstNumber: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  openingBalance: OptionalNumberLikeSchema,
  closingBalance: OptionalNumberLikeSchema,
  opening_balance: OptionalNumberLikeSchema,
  closing_balance: OptionalNumberLikeSchema,
});

export const PullLedgersSchema = OptionalRecordsSchema(TallyLedgerRecordSchema);

const TallyStockItemRecordSchema = TallyCompanyFieldsSchema.extend({
  guid: z.string().optional(),
  masterId: z.union([z.string(), z.number()]).optional(),
  alterId: z.union([z.string(), z.number()]).optional(),
  name: z.string().trim().min(1),
  parent: z.string().optional(),
  baseUnit: z.string().optional(),
  hsnCode: z.string().optional(),
  openingBalance: OptionalNumberLikeSchema,
  openingRate: OptionalNumberLikeSchema,
  openingValue: OptionalNumberLikeSchema,
  closingBalance: OptionalNumberLikeSchema,
  closingValue: OptionalNumberLikeSchema,
  stockOnHand: OptionalNumberLikeSchema,
  availableForSale: OptionalNumberLikeSchema,
});

export const PullStockItemsSchema = OptionalRecordsSchema(
  TallyStockItemRecordSchema,
);

const TallyVoucherItemSchema = z.object({
  itemName: z.string().optional(),
  stockItemName: z.string().optional(),
  description: z.string().optional(),
  quantity: OptionalNumberLikeSchema,
  rate: OptionalNumberLikeSchema,
  amount: OptionalNumberLikeSchema,
  unit: z.string().nullable().optional(),
});

const TallyVoucherSchema = TallyCompanyFieldsSchema.extend({
  guid: z.string().nullable().optional(),
  masterId: z.union([z.string(), z.number()]).nullable().optional(),
  alterId: z.union([z.string(), z.number()]).nullable().optional(),

  voucherNumber: z.string().nullable().optional(),
  number: z.string().nullable().optional(),

  date: z.string().nullable().optional(),
  voucherDate: z.string().nullable().optional(),
  voucher_date: z.string().nullable().optional(),

  partyName: z.string().nullable().optional(),
  ledgerName: z.string().nullable().optional(),

  referenceNumber: z.string().nullable().optional(),
  referenceDate: z.string().nullable().optional(),

  narration: z.string().nullable().optional(),

  totalAmount: OptionalNumberLikeSchema,
  amount: OptionalNumberLikeSchema,

  status: z.string().nullable().optional(),

  items: z.array(TallyVoucherItemSchema).optional().default([]),

  DATE: z.any().optional(),
  VOUCHERDATE: z.any().optional(),

  costCenterGuid: z.string().nullable().optional(),
  costCenterName: z.string().nullable().optional(),
  costCategory: z.string().nullable().optional(),
  costCenterAmount: OptionalNumberLikeSchema,

  cost_center_guid: z.string().nullable().optional(),
  cost_center_name: z.string().nullable().optional(),
  cost_category: z.string().nullable().optional(),
  cost_center_amount: OptionalNumberLikeSchema,

  cost_center_allocations: z.array(z.any()).optional().default([]),
  costCenterAllocations: z.array(z.any()).optional().default([]),
});

export const PullPurchaseOrdersSchema =
  OptionalRecordsSchema(TallyVoucherSchema);

export const PullSalesOrdersSchema = OptionalRecordsSchema(TallyVoucherSchema);

const TallyOutstandingRecordSchema = TallyCompanyFieldsSchema.extend({
  guid: z.string().nullable().optional(),
  tallyGuid: z.string().nullable().optional(),

  ledgerGuid: z.string().nullable().optional(),
  ledgerName: z.string().trim().nullable().optional(),

  ledger_guid: z.string().nullable().optional(),
  ledger_name: z.string().trim().nullable().optional(),

  partyName: z.string().nullable().optional(),
  party_name: z.string().nullable().optional(),

  voucherGuid: z.string().nullable().optional(),
  voucher_guid: z.string().nullable().optional(),

  billRef: z.string().trim().nullable().optional(),
  bill_ref: z.string().trim().nullable().optional(),
  reference: z.string().trim().nullable().optional(),

  voucherNo: z.string().nullable().optional(),
  voucher_no: z.string().nullable().optional(),
  voucherNumber: z.string().nullable().optional(),
  voucher_number: z.string().nullable().optional(),

  voucherType: z.string().nullable().optional(),
  voucher_type: z.string().nullable().optional(),

  voucherDate: z.string().nullable().optional(),
  voucher_date: z.string().nullable().optional(),

  dueDate: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),

  billType: z.string().nullable().optional(),
  bill_type: z.string().nullable().optional(),

  billAmount: OptionalNumberLikeSchema,
  bill_amount: OptionalNumberLikeSchema,

  openingAmount: OptionalNumberLikeSchema,
  opening_amount: OptionalNumberLikeSchema,

  pendingAmount: OptionalNumberLikeSchema,
  pending_amount: OptionalNumberLikeSchema,

  outstandingAmount: OptionalNumberLikeSchema,
  outstanding_amount: OptionalNumberLikeSchema,

  overdueDays: OptionalNumberLikeSchema,
  overdue_days: OptionalNumberLikeSchema,

  drCr: z.string().nullable().optional(),
  dr_cr: z.string().nullable().optional(),

  partyType: z.string().nullable().optional(),
  party_type: z.string().nullable().optional(),

  costCenterGuid: z.string().nullable().optional(),
  costCenterName: z.string().nullable().optional(),
  costCategory: z.string().nullable().optional(),
  costCenterAmount: OptionalNumberLikeSchema,

  cost_center_guid: z.string().nullable().optional(),
  cost_center_name: z.string().nullable().optional(),
  cost_category: z.string().nullable().optional(),
  cost_center_amount: OptionalNumberLikeSchema,
});

export const PullOutstandingsSchema = OptionalRecordsSchema(
  TallyOutstandingRecordSchema,
);
