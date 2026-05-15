import { Router } from "express";
import { requireAuth } from "../../common/auth";
import {
  createProductHandler,
  getProductCategoriesHandler,
  getProductsHandler,
} from "./products.service";

const productsRouter = Router({ mergeParams: true });

productsRouter.use(requireAuth);

productsRouter.get("/", getProductsHandler);
productsRouter.post("/", createProductHandler);
productsRouter.get("/categories", getProductCategoriesHandler);

export default productsRouter;
