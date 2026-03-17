import { Router } from "express";
import { requireAuth } from "../../common/auth";
import { createProductHandler, getProductsHandler } from "./products.service";

const productsRouter = Router({ mergeParams: true });

productsRouter.use(requireAuth);

productsRouter.get("/", getProductsHandler);
productsRouter.post("/", createProductHandler);

export default productsRouter;
