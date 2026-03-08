import { Router } from "express";
import { z } from "zod";
import { attachUserContext } from "../../auth/attachUserContext";
import { requireAuth } from "../../common/auth";
import { getTenantId } from "../../common/tenant";
import { contactsService } from "./contacts.service";

const contactsRouter = Router();

const CreateContactSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().optional().nullable(),
  mobile: z.string().optional().nullable(),
  email: z
    .string()
    .email("Invalid email")
    .optional()
    .or(z.literal(""))
    .nullable(),

  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  country: z.string().optional().nullable(),

  organization_id: z.string().uuid().optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
});

contactsRouter.post(
  "/contacts",
  requireAuth,
  attachUserContext,
  async (req, res, next) => {
    try {
      const tenantId = getTenantId(req);
      const createdBy = req.user?.sub || null;

      const input = CreateContactSchema.parse(req.body);

      const result = await contactsService.create({
        tenantId,
        createdBy,
        updatedBy: createdBy,
        ...input,
      });

      res.status(201).json({
        message: "Contact created successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },
);

contactsRouter.get(
  "/contacts",
  requireAuth,
  attachUserContext,
  async (req, res, next) => {
    try {
      const tenantId = getTenantId(req);

      const page = Number(req.query.page || 1);
      const limit = Number(req.query.limit || 10);
      const search = String(req.query.search || "").trim();

      const result = await contactsService.getAll({
        tenantId,
        page,
        limit,
        search,
      });

      res.status(200).json({
        message: "Contacts fetched successfully",
        ...result,
      });
    } catch (error) {
      next(error);
    }
  },
);

contactsRouter.get(
  "/contacts/:id",
  requireAuth,
  attachUserContext,
  async (req, res, next) => {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params;

      const result = await contactsService.getById(id, tenantId);

      if (!result) {
        return res.status(404).json({
          message: "Contact not found",
        });
      }

      res.status(200).json({
        message: "Contact fetched successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default contactsRouter;
