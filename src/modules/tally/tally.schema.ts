import { z } from "zod";

const OptionalNumberLikeSchema = z
  .union([z.string(), z.number()])
  .nullable()
  .optional();

export const UpsertTallyConnectionSchema = z.object({
  company_name: z.string().trim().optional(),
  tally_url: z.string().trim().default("http://localhost:9000"),
  sync_direction: z.enum(["pull", "push", "both"]).default("pull"),
  sync_frequency_minutes: z.number().int().min(1).max(1440).default(10),
  is_active: z.boolean().default(true),
});

export const PullLedgersSchema = z.object({
  records: z.array(
    z.object({
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
    }),
  ),
});

export const PullStockItemsSchema = z.object({
  records: z.array(
    z.object({
      guid: z.string().optional(),
      masterId: z.union([z.string(), z.number()]).optional(),
      alterId: z.union([z.string(), z.number()]).optional(),
      name: z.string().trim().min(1),
      parent: z.string().optional(),
      baseUnit: z.string().optional(),
      openingBalance: OptionalNumberLikeSchema,
      openingRate: OptionalNumberLikeSchema,
      openingValue: OptionalNumberLikeSchema,
    }),
  ),
});

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
});

export const PullPurchaseOrdersSchema = z.object({
  records: z.array(TallyVoucherSchema),
});

export const PullSalesOrdersSchema = z.object({
  records: z.array(TallyVoucherSchema),
});
