import { Router } from "express";
import {
  getTallyConnectionHandler,
  getTallySyncErrorsHandler,
  getTallySyncHistoryHandler,
  pullTallyLedgersHandler,
  pullTallyOutstandingsHandler,
  pullTallyPurchaseOrdersHandler,
  pullTallySalesOrdersHandler,
  pullTallyStockItemsHandler,
  saveTallyConnectionHandler,
} from "./tally.service";

const tallyRouter = Router();

tallyRouter.get("/connection", getTallyConnectionHandler);
tallyRouter.post("/connection", saveTallyConnectionHandler);

tallyRouter.post("/pull/ledgers", pullTallyLedgersHandler);
tallyRouter.post("/pull/stock-items", pullTallyStockItemsHandler);
tallyRouter.post("/pull/outstandings", pullTallyOutstandingsHandler);

tallyRouter.post("/pull/purchase-orders", pullTallyPurchaseOrdersHandler);
tallyRouter.post("/pull/sales-orders", pullTallySalesOrdersHandler);

tallyRouter.get("/sync-history", getTallySyncHistoryHandler);
tallyRouter.get("/sync-errors", getTallySyncErrorsHandler);

export default tallyRouter;
