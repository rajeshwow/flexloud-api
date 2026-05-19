import { Router } from "express";
import { requirePermissions } from "../../common/requirePermissions";
import {
  getOutstandingCostCentersHandler,
  getOutstandingsHandler,
  getOutstandingsSummaryHandler,
} from "./outstandings.service";

const outstandingRouter = Router();

outstandingRouter.get(
  "/",
  requirePermissions(["outstandings.view"]),
  getOutstandingsHandler,
);

outstandingRouter.get(
  "/summary",
  requirePermissions(["outstandings.view"]),
  getOutstandingsSummaryHandler,
);

outstandingRouter.get(
  "/cost-centers",
  requirePermissions(["outstandings.view"]),
  getOutstandingCostCentersHandler,
);

export default outstandingRouter;
