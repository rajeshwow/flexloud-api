import { Router } from "express";
import { getDashboardSummaryHandler } from "./dashboard.service";

const dashboardRouter = Router();

dashboardRouter.get("/summary", getDashboardSummaryHandler);

export default dashboardRouter;
