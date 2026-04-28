import { Router } from "express";
import {
  createSalesOrderHandler,
  deleteSalesOrderHandler,
  getSalesOrderByIdHandler,
  getSalesOrdersHandler,
  updateSalesOrderHandler,
} from "./sales-orders.service";

const salesOrdersRouter = Router();

salesOrdersRouter.get("/", getSalesOrdersHandler);
salesOrdersRouter.get("/:id", getSalesOrderByIdHandler);
salesOrdersRouter.post("/", createSalesOrderHandler);
salesOrdersRouter.patch("/:id", updateSalesOrderHandler);
salesOrdersRouter.delete("/:id", deleteSalesOrderHandler);

export default salesOrdersRouter;
