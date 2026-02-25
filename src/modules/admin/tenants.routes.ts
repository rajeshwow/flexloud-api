import { Request, Response, Router } from "express";
import { z } from "zod";
import { bootstrapTenant, createTenant } from "./tenants.service";

// ✅ simple platform-admin guard (internal key)
function requirePlatformAdmin(req: Request, res: Response, next: any) {
  const key = req.header("x-internal-admin-key");
  if (!key || key !== process.env.INTERNAL_ADMIN_KEY) {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
}

const router = Router();

const CreateTenantSchema = z.object({
  name: z.string().min(2),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase, alphanumeric, hyphen"),
});

router.post("/v1/admin/tenants", requirePlatformAdmin, async (req, res) => {
  const body = CreateTenantSchema.parse(req.body);
  const tenant = await createTenant(body);
  return res.status(201).json({ data: tenant });
});

const BootstrapSchema = z.object({
  adminEmail: z.string().email(),
  adminName: z.string().min(2),
  // optional if you want link with Identity Platform subject
  adminSub: z.string().min(3).optional(),
});

router.post(
  "/v1/admin/tenants/:tenantId/bootstrap",
  requirePlatformAdmin,
  async (req, res) => {
    const tenantId = req.params.tenantId;
    const body = BootstrapSchema.parse(req.body);

    const result = await bootstrapTenant({
      tenantId,
      adminEmail: body.adminEmail,
      adminName: body.adminName,
      adminSub: body.adminSub,
    });

    return res.status(200).json({ data: result });
  },
);

export default router;
