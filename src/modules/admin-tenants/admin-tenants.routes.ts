import { Router } from "express";
import {
  bootstrapTenant,
  createTenant,
  getPermissionCatalog,
  getTenantBootstrapLogs,
  getTenantById,
  getTenantPermissions,
  getTenants,
  updateTenantPermissions,
  updateTenantStatus,
} from "./admin-tenants.service";

const adminTenantsRouter = Router();

adminTenantsRouter.get("/", getTenants);
adminTenantsRouter.post("/", createTenant);

/**
 * IMPORTANT:
 * Static routes must stay above "/:tenantId",
 * otherwise Express will treat "permissions" as tenantId.
 */
adminTenantsRouter.get("/permissions/catalog", getPermissionCatalog);

adminTenantsRouter.get("/:tenantId/permissions", getTenantPermissions);
adminTenantsRouter.put("/:tenantId/permissions", updateTenantPermissions);

adminTenantsRouter.get("/:tenantId", getTenantById);
adminTenantsRouter.patch("/:tenantId/status", updateTenantStatus);

adminTenantsRouter.post("/:tenantId/bootstrap", bootstrapTenant);
adminTenantsRouter.get("/:tenantId/bootstrap/logs", getTenantBootstrapLogs);

export default adminTenantsRouter;
