import { Router } from "express";
import { requirePermissions } from "../../common/requirePermissions";
import {
  getAccessibleCostCentersForCompanyHandler,
  getAccessibleTallyCompaniesHandler,
  getCompanyCostCenterAccessHandler,
  getTallyCompaniesHandler,
  updateCompanyCostCenterAccessHandler,
} from "./tally-companies.service";

const tallyCompaniesRouter = Router();

tallyCompaniesRouter.get(
  "/",
  requirePermissions(["tally-companies.view"]),
  getTallyCompaniesHandler,
);

tallyCompaniesRouter.get(
  "/accessible",
  requirePermissions(["tally-companies.view"]),
  getAccessibleTallyCompaniesHandler,
);

tallyCompaniesRouter.get(
  "/:id/cost-center-access",
  requirePermissions(["tally-company-access.view"]),
  getCompanyCostCenterAccessHandler,
);

tallyCompaniesRouter.put(
  "/:id/cost-center-access",
  requirePermissions(["tally-company-access.edit"]),
  updateCompanyCostCenterAccessHandler,
);

tallyCompaniesRouter.get(
  "/:id/accessible-cost-centers",
  requirePermissions(["tally-companies.view"]),
  getAccessibleCostCentersForCompanyHandler,
);

export default tallyCompaniesRouter;
