import { Router } from "express";
import { requirePermissions } from "../../common/requirePermissions";
import {
  createPoReceiptHandler,
  createSoDispatchHandler,
  getPoForReceivingHandler,
  getSoForDispatchHandler,
  listWarehouseHandler,
  listWarehousePurchaseOrdersHandler,
  listWarehouseSalesOrdersHandler,
  updateDispatchStatusHandler,
  updateReceiptStatusHandler,
} from "./warehouse.service";

const warehouseRouter = Router();

warehouseRouter.get(
  "/",
  requirePermissions(["warehouse.view"]),
  listWarehouseHandler,
);

warehouseRouter.get(
  "/po/:id/receive",
  requirePermissions(["warehouse.view"]),
  getPoForReceivingHandler,
);

warehouseRouter.post(
  "/po/receive",
  requirePermissions(["warehouse.receive"]),
  createPoReceiptHandler,
);

warehouseRouter.patch(
  "/po/receipts/:id/status",
  requirePermissions(["warehouse.update"]),
  updateReceiptStatusHandler,
);

warehouseRouter.get(
  "/so/:id/dispatch",
  requirePermissions(["warehouse.view"]),
  getSoForDispatchHandler,
);

warehouseRouter.post(
  "/so/dispatch",
  requirePermissions(["warehouse.dispatch"]),
  createSoDispatchHandler,
);

warehouseRouter.patch(
  "/so/dispatches/:id/status",
  requirePermissions(["warehouse.update"]),
  updateDispatchStatusHandler,
);

warehouseRouter.get(
  "/sales-orders",
  requirePermissions(["warehouse.view"]),
  listWarehouseSalesOrdersHandler,
);

warehouseRouter.get(
  "/purchase-orders",
  requirePermissions(["warehouse.view"]),
  listWarehousePurchaseOrdersHandler,
);

export default warehouseRouter;
