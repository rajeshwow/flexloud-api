import { NextFunction, Request, Response, Router } from "express";
import { requireAuth } from "../../common/auth";
import { requirePermissions } from "../../common/requirePermissions";
import { env } from "../../config/env";
import {
  checkTallyConnectionHandler,
  getTallyAgentSyncStateHandler,
  getTallyConnectionHandler,
  getTallyEmployeesHandler,
  getTallyHistoricalSyncStatusHandler,
  getTallySyncErrorsHandler,
  getTallySyncHistoryHandler,
  getTallySyncStatusHandler,
  markHistoricalSyncProgressHandler,
  pullCostCentersHandler,
  pullTallyEmployeesHandler,
  pullTallyLedgersHandler,
  pullTallyOutstandingsHandler,
  pullTallyPurchaseOrdersHandler,
  pullTallySalesOrdersHandler,
  pullTallyStockItemsHandler,
  runTallyHistoricalSyncHandler,
  runTallyManualSyncHandler,
  saveTallyConnectionHandler,
  updateTallyAgentSyncStateHandler,
  updateTallyRunningCompanyHandler,
} from "./tally.service";

const tallyRouter = Router();

function requireTallyAgent(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization || "";

  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";

  const expectedToken = env.TALLY_AGENT_TOKEN || "";

  if (!expectedToken) {
    return res.status(500).json({
      statusCode: 500,
      message: "TALLY_AGENT_TOKEN is not configured in backend",
      data: null,
    });
  }

  if (!token || token !== expectedToken) {
    return res.status(401).json({
      statusCode: 401,
      message: "Invalid tally agent token",
      data: null,
    });
  }

  return next();
}

/**
 * CRM UI routes
 * These routes are called from frontend using normal user JWT.
 */
tallyRouter.get(
  "/connection",
  requireAuth,
  requirePermissions(["tally.view"]),
  getTallyConnectionHandler,
);

tallyRouter.post(
  "/connection",
  requireAuth,
  requirePermissions(["tally.edit"]),
  saveTallyConnectionHandler,
);

tallyRouter.get(
  "/sync-history",
  requireAuth,
  requirePermissions(["tally.view"]),
  getTallySyncHistoryHandler,
);

tallyRouter.get(
  "/sync-errors",
  requireAuth,
  requirePermissions(["tally.view"]),
  getTallySyncErrorsHandler,
);

tallyRouter.get(
  "/employees",
  requireAuth,
  requirePermissions(["tally.view"]),
  getTallyEmployeesHandler,
);

tallyRouter.get(
  "/sync/status",
  requireAuth,
  requirePermissions(["tally.view"]),
  getTallySyncStatusHandler,
);

tallyRouter.get(
  "/sync/check-connection",
  requireAuth,
  requirePermissions(["tally.view"]),
  checkTallyConnectionHandler,
);

tallyRouter.post(
  "/sync/run",
  requireAuth,
  requirePermissions(["tally.sync"]),
  runTallyManualSyncHandler,
);

/**
 * Tally agent pull routes
 * These are not for frontend/browser.
 * Do NOT add requireAuth here.
 */
tallyRouter.post("/pull/ledgers", requireTallyAgent, pullTallyLedgersHandler);

tallyRouter.post(
  "/agent/company",
  requireTallyAgent,
  updateTallyRunningCompanyHandler,
);

tallyRouter.get(
  "/agent/sync-state",
  requireTallyAgent,
  getTallyAgentSyncStateHandler,
);

tallyRouter.post(
  "/agent/sync-state",
  requireTallyAgent,
  updateTallyAgentSyncStateHandler,
);

tallyRouter.post(
  "/agent/historical-sync-progress",
  requireTallyAgent,
  markHistoricalSyncProgressHandler,
);

tallyRouter.post(
  "/pull/stock-items",
  requireTallyAgent,
  pullTallyStockItemsHandler,
);

tallyRouter.post(
  "/pull/outstandings",
  requireTallyAgent,
  pullTallyOutstandingsHandler,
);

tallyRouter.post(
  "/pull/purchase-orders",
  requireTallyAgent,
  pullTallyPurchaseOrdersHandler,
);

tallyRouter.post(
  "/pull/sales-orders",
  requireTallyAgent,
  pullTallySalesOrdersHandler,
);

tallyRouter.post(
  "/pull/employees",
  requireTallyAgent,
  pullTallyEmployeesHandler,
);

tallyRouter.post(
  "/pull/cost-centers",
  requireTallyAgent,
  pullCostCentersHandler,
);

tallyRouter.post(
  "/sync/historical",
  requireAuth,
  requirePermissions(["tally.sync"]),
  runTallyHistoricalSyncHandler,
);

tallyRouter.get(
  "/sync/historical/status",
  requireAuth,
  requirePermissions(["tally.view"]),
  getTallyHistoricalSyncStatusHandler,
);

export default tallyRouter;
