import { z } from "zod";

const OptionalNumberLikeSchema = z
  .union([z.string(), z.number()])
  .nullable()
  .optional();

const OptionalRecordsSchema = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({
    records: z.array(schema).optional().default([]),
  });

export const UpsertTallyConnectionSchema = z.object({
  company_name: z.string().trim().optional(),

  company_guid: z.string().nullable().optional(),
  direction: z.enum(["pull", "push"]).optional(),
  frequency_minutes: z.number().int().positive().optional(),

  // frontend/body me agar base_url aa raha ho to service me map kar sakte ho,
  // schema level par tally_url primary rakha hai
  tally_url: z.string().trim().default("http://localhost:9000"),

  sync_direction: z.enum(["pull", "push", "both"]).default("pull"),
  sync_frequency_minutes: z.number().int().min(1).max(1440).default(10),
  is_active: z.boolean().default(true),
});

const TallyLedgerRecordSchema = z.object({
  guid: z.string().optional(),
  masterId: z.union([z.string(), z.number()]).optional(),
  alterId: z.union([z.string(), z.number()]).optional(),
  name: z.string().trim().min(1),
  parent: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  gstin: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
});

export const PullLedgersSchema = OptionalRecordsSchema(TallyLedgerRecordSchema);

const TallyStockItemRecordSchema = z.object({
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

const TallyVoucherSchema = z.object({
  guid: z.string().nullable().optional(),
  masterId: z.union([z.string(), z.number()]).nullable().optional(),
  alterId: z.union([z.string(), z.number()]).nullable().optional(),

  voucherNumber: z.string().nullable().optional(),
  number: z.string().nullable().optional(),

  date: z.string().nullable().optional(),

  partyName: z.string().nullable().optional(),
  ledgerName: z.string().nullable().optional(),

  referenceNumber: z.string().nullable().optional(),
  referenceDate: z.string().nullable().optional(),

  narration: z.string().nullable().optional(),

  totalAmount: OptionalNumberLikeSchema,
  amount: OptionalNumberLikeSchema,

  status: z.string().nullable().optional(),

  items: z.array(TallyVoucherItemSchema).optional().default([]),

  voucher_date: z.string().nullable().optional(),
  DATE: z.any().optional(),
  VOUCHERDATE: z.any().optional(),
});

export const PullPurchaseOrdersSchema =
  OptionalRecordsSchema(TallyVoucherSchema);

export const PullSalesOrdersSchema = OptionalRecordsSchema(TallyVoucherSchema);

const TallyOutstandingRecordSchema = z.object({
  guid: z.string().nullable().optional(),

  ledgerGuid: z.string().nullable().optional(),
  ledgerName: z.string().trim().nullable().optional(),

  ledger_guid: z.string().nullable().optional(),
  ledger_name: z.string().trim().nullable().optional(),

  billRef: z.string().trim().nullable().optional(),
  bill_ref: z.string().trim().nullable().optional(),

  voucherNo: z.string().nullable().optional(),
  voucher_no: z.string().nullable().optional(),

  voucherType: z.string().nullable().optional(),
  voucher_type: z.string().nullable().optional(),

  voucherDate: z.string().nullable().optional(),
  voucher_date: z.string().nullable().optional(),

  dueDate: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),

  openingAmount: OptionalNumberLikeSchema,
  opening_amount: OptionalNumberLikeSchema,

  pendingAmount: OptionalNumberLikeSchema,
  pending_amount: OptionalNumberLikeSchema,

  overdueDays: OptionalNumberLikeSchema,
  overdue_days: OptionalNumberLikeSchema,

  drCr: z.string().nullable().optional(),
  dr_cr: z.string().nullable().optional(),

  partyType: z.string().nullable().optional(),
  party_type: z.string().nullable().optional(),
});

export const PullOutstandingsSchema = OptionalRecordsSchema(
  TallyOutstandingRecordSchema,
);
