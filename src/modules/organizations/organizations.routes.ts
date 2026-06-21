import { Router } from "express";
import { requirePermissions } from "../../common/requirePermissions";
import { exportOrganizationsTable } from "../table-export/table-export.service";
import {
  createOrganizationHandler,
  getOrganizationByIdHandler,
  getOrganizationsHandler,
  updateOrganizationHandler,
} from "./organizations.service";

const organizationsRouter = Router();

organizationsRouter.get(
  "/export",
  requirePermissions(["org.export"]),
  exportOrganizationsTable,
);

organizationsRouter.post("/", createOrganizationHandler);
organizationsRouter.get("/", getOrganizationsHandler);
organizationsRouter.get("/:id", getOrganizationByIdHandler);
organizationsRouter.patch("/:id", updateOrganizationHandler);

export default organizationsRouter;
