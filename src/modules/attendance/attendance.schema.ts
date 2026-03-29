import { z } from "zod";

const GeoLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().trim().max(1000).optional().nullable(),
  accuracy_meters: z.number().min(0).max(100000).optional().nullable(),
});

export const ClockInSchema = z.object({
  remarks: z.string().trim().max(500).optional(),
  source: z.enum(["web", "mobile", "admin"]).optional().default("web"),
  location: GeoLocationSchema,
});

export const ClockOutSchema = z.object({
  remarks: z.string().trim().max(500).optional(),
  location: GeoLocationSchema,
});

export const GetAttendanceHistorySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  from: z.string().optional(),
  to: z.string().optional(),
  user_id: z.string().uuid().optional(),
});

export const GetAttendanceCalendarSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});

export const GetAttendanceMetricsSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});

export const CreateAttendanceRequestSchema = z
  .object({
    request_type: z.enum([
      "leave",
      "adjustment",
      "out_duty",
      "shift_change",
      "clockin",
    ]),
    leave_type: z.enum(["casual", "sick", "earned", "unpaid"]).optional(),
    from_date: z.string(),
    to_date: z.string(),
    reason: z.string().trim().min(2).max(1000),
  })
  .superRefine((data, ctx) => {
    if (data.request_type === "leave" && !data.leave_type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["leave_type"],
        message: "Leave type is required for leave requests",
      });
    }

    if (new Date(data.from_date) > new Date(data.to_date)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to_date"],
        message: "to_date must be greater than or equal to from_date",
      });
    }
  });
