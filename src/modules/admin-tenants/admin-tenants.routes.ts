import { Router } from "express";
import {
  bootstrapTenant,
  createTenant,
  getTenantBootstrapLogs,
  getTenantById,
  getTenants,
  updateTenantStatus,
} from "./admin-tenants.service";

const adminTenantsRouter = Router();

adminTenantsRouter.get("/", getTenants);
adminTenantsRouter.post("/", createTenant);

adminTenantsRouter.get("/:tenantId", getTenantById);
adminTenantsRouter.patch("/:tenantId/status", updateTenantStatus);

adminTenantsRouter.post("/:tenantId/bootstrap", bootstrapTenant);
adminTenantsRouter.get("/:tenantId/bootstrap/logs", getTenantBootstrapLogs);

export default adminTenantsRouter;
