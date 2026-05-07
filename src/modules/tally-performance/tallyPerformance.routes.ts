import { Router } from "express";
import {
  getEmployeeTallyOutstandingsHandler,
  getEmployeeTallyPerformanceHandler,
  getRiskyCustomersHandler,
  getTallyAgeingReportHandler,
  getTallyMapSuggestionsHandler,
  getTallyPerformanceSummaryHandler,
  getUnassignedOutstandingOrganizationsHandler,
  getUnmappedTallyLedgersHandler,
  mapTallyLedgerToOrganizationHandler,
} from "./tallyPerformance.service";

const tallyPerformanceRouter = Router();

tallyPerformanceRouter.get("/summary", getTallyPerformanceSummaryHandler);
tallyPerformanceRouter.get("/employees", getEmployeeTallyPerformanceHandler);
tallyPerformanceRouter.get(
  "/employees/:userId/outstandings",
  getEmployeeTallyOutstandingsHandler,
);
tallyPerformanceRouter.get("/ageing", getTallyAgeingReportHandler);
tallyPerformanceRouter.get("/risky-customers", getRiskyCustomersHandler);
tallyPerformanceRouter.get(
  "/unassigned-organizations",
  getUnassignedOutstandingOrganizationsHandler,
);

tallyPerformanceRouter.get("/unmapped-ledgers", getUnmappedTallyLedgersHandler);
tallyPerformanceRouter.get("/map-suggestions", getTallyMapSuggestionsHandler);
tallyPerformanceRouter.post("/map-ledger", mapTallyLedgerToOrganizationHandler);

export default tallyPerformanceRouter;
