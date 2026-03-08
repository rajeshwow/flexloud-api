import { Router } from "express";
import { z } from "zod";
import { attachUserContext } from "../../auth/attachUserContext";
import { requireAuth } from "../../common/auth";
import { getTenantId } from "../../common/tenant";
import { organizationsService } from "./organizations.service";

const organizationsRouter = Router();

const CreateOrganizationSchema = z.object({
  name: z.string().min(2, "Name is required"),
  gst_number: z.string().optional().nullable(),
  email: z
    .string()
    .email("Invalid email")
    .optional()
    .or(z.literal(""))
    .nullable(),
  next_followup_at: z.string().datetime().optional().nullable(),

  type: z.string().optional().nullable(),
  industry: z.string().optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),

  billing_street: z.string().min(1, "Billing street is required"),
  billing_area: z.string().min(1, "Billing area is required"),
  billing_postal_code: z.string().min(1, "Billing postal code is required"),
  billing_city: z.string().min(1, "Billing city is required"),
  billing_state: z.string().min(1, "Billing state is required"),
  billing_country: z.string().min(1, "Billing country is required"),

  shipping_street: z.string().optional().nullable(),
  shipping_area: z.string().optional().nullable(),
  shipping_postal_code: z.string().optional().nullable(),
  shipping_city: z.string().optional().nullable(),
  shipping_state: z.string().optional().nullable(),
  shipping_country: z.string().optional().nullable(),

  is_shipping_same_as_billing: z.boolean().optional().default(false),
});

organizationsRouter.post(
  "/organizations",
  requireAuth,
  attachUserContext,
  async (req, res, next) => {
    try {
      const tenantId = getTenantId(req);
      const createdBy = req.user?.sub;

      const input = CreateOrganizationSchema.parse(req.body);

      const result = await organizationsService.create({
        tenantId,
        createdBy: createdBy || null,
        updatedBy: createdBy || null,
        ...input,
      });

      res.status(201).json({
        message: "Organization created successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },
);

organizationsRouter.get(
  "/organizations",
  requireAuth,
  attachUserContext,
  async (req, res, next) => {
    try {
      const tenantId = getTenantId(req);

      const page = Number(req.query.page || 1);
      const limit = Number(req.query.limit || 10);
      const search = String(req.query.search || "").trim();

      const result = await organizationsService.getAll({
        tenantId,
        page,
        limit,
        search,
      });

      res.status(200).json({
        message: "Organizations fetched successfully",
        ...result,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default organizationsRouter;
