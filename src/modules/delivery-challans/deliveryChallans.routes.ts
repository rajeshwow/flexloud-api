import { Router } from "express";
import {
  createDeliveryChallanHandler,
  deleteDeliveryChallanHandler,
  getDeliveryChallanByIdHandler,
  listDeliveryChallansHandler,
  updateDeliveryChallanHandler,
} from "./deliveryChallans.service";

const deliveryChallansRouter = Router();

deliveryChallansRouter.get("/", listDeliveryChallansHandler);
deliveryChallansRouter.get("/:id", getDeliveryChallanByIdHandler);
deliveryChallansRouter.post("/", createDeliveryChallanHandler);
deliveryChallansRouter.patch("/:id", updateDeliveryChallanHandler);
deliveryChallansRouter.delete("/:id", deleteDeliveryChallanHandler);

export default deliveryChallansRouter;
