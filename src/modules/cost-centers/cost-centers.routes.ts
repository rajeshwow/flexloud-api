import { Router } from "express";
import { requirePermissions } from "../../common/requirePermissions";
import {
  getCostCenterOrganizationsHandler,
  getCostCenterOutstandingsHandler,
  getCostCentersHandler,
  getCostCenterSummaryHandler,
} from "./cost-centers.service";

const costCentersRouter = Router();

costCentersRouter.get(
  "/",
  requirePermissions(["cost-centers.view"]),
  getCostCentersHandler,
);

costCentersRouter.get(
  "/summary",
  requirePermissions(["cost-centers.analytics"]),
  getCostCenterSummaryHandler,
);

costCentersRouter.get(
  "/:id/outstandings",
  requirePermissions(["cost-centers.view"]),
  getCostCenterOutstandingsHandler,
);

costCentersRouter.get(
  "/:id/organizations",
  requirePermissions(["cost-centers.view"]),
  getCostCenterOrganizationsHandler,
);

export default costCentersRouter;
