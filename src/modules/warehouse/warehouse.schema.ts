import { z } from "zod";

export const ListWarehouseSchema = z.object({
  type: z.enum(["po", "so"]).optional(),
  status: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(20),
});

export const CreatePoReceiptSchema = z.object({
  purchase_order_id: z.string().uuid(),

  status: z.string().optional().nullable(),

  courier_name: z.string().optional().nullable(),
  awb_number: z.string().optional().nullable(),
  tracking_url: z.string().optional().nullable(),

  received_at: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),

  items: z.array(
    z.object({
      purchase_order_item_id: z.string().uuid(),
      product_id: z.string().uuid().optional().nullable(),

      received_qty: z.coerce.number().default(0),
      damaged_qty: z.coerce.number().default(0),

      remarks: z.string().optional().nullable(),
    }),
  ),
});

export const CreateSoDispatchSchema = z.object({
  sales_order_id: z.string().uuid(),
  courier_name: z.string().min(1, "Courier name is required"),
  awb_number: z.string().min(1, "AWB / Tracking no. is required"),
  tracking_url: z.string().optional().nullable(),
  dispatched_at: z.string().optional().nullable(),
  delivery_expected_at: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  items: z.array(
    z.object({
      sales_order_item_id: z.string().uuid().optional().nullable(),
      product_id: z.string().uuid().optional().nullable(),
      ordered_qty: z.coerce.number().default(0),
      dispatched_qty: z.coerce.number().default(0),
      remarks: z.string().optional().nullable(),
    }),
  ),
});

export const UpdateWarehouseStatusSchema = z.object({
  status: z.string().min(1),
  remarks: z.string().optional().nullable(),
});
