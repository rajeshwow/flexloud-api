import { z } from "zod";

const LeaveTypeEnum = z.enum(["casual", "sick", "paid", "unpaid", "optional"]);
const LeaveStatusEnum = z.enum([
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

export const ApplyLeaveSchema = z
  .object({
    leave_type: LeaveTypeEnum,
    start_date: z.string().trim(),
    end_date: z.string().trim(),
    reason: z.string().trim().max(1000).optional(),
    applied_to_user_id: z.string().uuid().optional().nullable(),
  })
  .refine(
    (data) =>
      new Date(data.end_date).getTime() >= new Date(data.start_date).getTime(),
    {
      message: "End date must be greater than or equal to start date",
      path: ["end_date"],
    },
  );

export const GetMyLeavesSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  status: LeaveStatusEnum.optional(),
  leave_type: LeaveTypeEnum.optional(),
  search: z.string().trim().optional(),
});

export const CancelLeaveSchema = z.object({
  id: z.string().uuid(),
});
