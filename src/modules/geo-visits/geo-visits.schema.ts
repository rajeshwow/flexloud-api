import { z } from "zod";

export const GeoVisitModuleEnum = z.enum([
  "lead",
  "contact",
  "organization",
  "task",
  "interaction",
  "attendance",
]);

export const CreateGeoVisitSchema = z.object({
  module_name: GeoVisitModuleEnum,
  record_id: z.string().uuid(),
  check_in_lat: z.number().min(-90).max(90),
  check_in_lng: z.number().min(-180).max(180),
  check_in_address: z.string().trim().optional().nullable(),
  target_lat: z.number().min(-90).max(90).optional().nullable(),
  target_lng: z.number().min(-180).max(180).optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  geo_photo_url: z.string().trim().optional().nullable(),
  metadata: z.record(z.any()).optional(),
});

export const UpdateGeoVisitCheckOutSchema = z.object({
  check_out_lat: z.number().min(-90).max(90),
  check_out_lng: z.number().min(-180).max(180),
  check_out_address: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

export const GetGeoVisitsSchema = z.object({
  module_name: GeoVisitModuleEnum.optional(),
  record_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  status: z.enum(["checked_in", "checked_out", "cancelled"]).optional(),
  limit: z.coerce.number().min(1).max(200).default(20),
  offset: z.coerce.number().min(0).default(0),
});
