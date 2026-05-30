import { Router } from "express";
import { requirePermissions } from "../../common/requirePermissions";
import {
  getCompanyQuarterlySalesHandler,
  getCostCenterCategorySalesHandler,
  getPartyCategorySalesHandler,
  getUserCategoryMonthlySalesHandler,
  getUserCategoryTargetsHandler,
} from "./reports.service";

const reportsRouter = Router();

reportsRouter.get(
  "/tally-analytics/user-category-monthly-sales",
  requirePermissions(["reports.tally_analytics.view"]),
  getUserCategoryMonthlySalesHandler,
);

reportsRouter.get(
  "/tally-analytics/company-quarterly-sales",
  requirePermissions(["reports.tally_analytics.view"]),
  getCompanyQuarterlySalesHandler,
);

reportsRouter.get(
  "/tally-analytics/user-category-targets",
  requirePermissions(["reports.tally_analytics.view"]),
  getUserCategoryTargetsHandler,
);

reportsRouter.get(
  "/tally-analytics/party-category-sales",
  requirePermissions(["reports.tally_analytics.view"]),
  getPartyCategorySalesHandler,
);

reportsRouter.get(
  "/tally-analytics/cost-center-category-sales",
  requirePermissions(["reports.tally_analytics.view"]),
  getCostCenterCategorySalesHandler,
);

export default reportsRouter;
