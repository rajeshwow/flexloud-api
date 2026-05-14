import { NextFunction, Request, Response, Router } from "express";
import {
  getTallyConnectionHandler,
  getTallyEmployeesHandler,
  getTallySyncErrorsHandler,
  getTallySyncHistoryHandler,
  pullTallyEmployeesHandler,
  pullTallyLedgersHandler,
  pullTallyOutstandingsHandler,
  pullTallyPurchaseOrdersHandler,
  pullTallySalesOrdersHandler,
  pullTallyStockItemsHandler,
  saveTallyConnectionHandler,
} from "./tally.service";

const tallyRouter = Router();

function requireTallyAgent(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization || "";

  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";

  const expectedToken = process.env.TALLY_AGENT_TOKEN || "";

  if (!expectedToken) {
    return res.status(500).json({
      success: false,
      message: "TALLY_AGENT_TOKEN is not configured in backend",
    });
  }

  if (!token || token !== expectedToken) {
    return res.status(401).json({
      success: false,
      message: "Invalid tally agent token",
    });
  }

  return next();
}

// CRM UI routes
tallyRouter.get("/connection", getTallyConnectionHandler);
tallyRouter.post("/connection", saveTallyConnectionHandler);

tallyRouter.get("/sync-history", getTallySyncHistoryHandler);
tallyRouter.get("/sync-errors", getTallySyncErrorsHandler);
tallyRouter.get("/employees", getTallyEmployeesHandler);

// Tally agent pull routes
tallyRouter.post("/pull/ledgers", requireTallyAgent, pullTallyLedgersHandler);
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

export default tallyRouter;
