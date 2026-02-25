import { Router } from "express";
import { requireAuth } from "../common/auth";
import { resolveTenant } from "../tenancy/tenantContext";

export function meRouter() {
  const r = Router();
  r.get("/", requireAuth, async (req, res) => {
    const tenant = await resolveTenant(req);
    res.json({
      user: {
        id: req.user!.sub,
        email: req.user!.email,
        displayName: req.user!.name,
      },
      tenant: { id: tenant.tenantId, name: tenant.tenantName },
      roles: tenant.roles,
    });
  });
  return r;
}
