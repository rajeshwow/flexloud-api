import { Router } from "express";
import {
  createPurchaseOrderHandler,
  getPurchaseOrderByIdHandler,
  getPurchaseOrdersHandler,
  updatePurchaseOrderHandler,
} from "./purchase-orders.service";

const purchaseOrderRouter = Router();

purchaseOrderRouter.get("/", getPurchaseOrdersHandler);
purchaseOrderRouter.get("/:id", getPurchaseOrderByIdHandler);
purchaseOrderRouter.post("/", createPurchaseOrderHandler);
purchaseOrderRouter.patch("/:id", updatePurchaseOrderHandler);

export default purchaseOrderRouter;
