import { Router } from "express";
import { z } from "zod";
import { attachUserContext } from "../../auth/attachUserContext";
import { requireAuth } from "../../common/auth";
import * as tenantsService from "./tenants.service";

const tenantRouter = Router();

const CreateTenantSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2),
});

tenantRouter.post(
  "/tenants",
  requireAuth,
  attachUserContext,
  async (req, res, next) => {
    try {
      const body = CreateTenantSchema.parse(req.body);

      const tenant = await tenantsService.createTenant({
        name: body.name.trim(),
        slug: body.slug.trim().toLowerCase(),
      });

      return res.status(201).json({
        statusCode: 201,
        message: "Tenant created",
        data: tenant,
      });
    } catch (e) {
      next(e);
    }
  },
);

const BootstrapSchema = z.object({
  tenantId: z.string().min(5),
  adminEmail: z.string().email(),
  adminName: z.string().min(2),
  adminSub: z.string().min(3).optional(),
});

tenantRouter.post("/bootstrap", async (req, res, next) => {
  try {
    const body = BootstrapSchema.parse(req.body);
    const result = await tenantsService.bootstrapTenant(body);

    return res.status(200).json({
      statusCode: 200,
      message: "Tenant bootstrapped",
      data: result,
    });
  } catch (e) {
    next(e);
  }
});

export default tenantRouter;
