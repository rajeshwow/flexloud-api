import { Router } from "express";
import {
  createDeliveryChallanHandler,
  deleteDeliveryChallanHandler,
  getDeliveryChallanByIdHandler,
  listDeliveryChallansHandler,
  sendDeliveryChallanEmailHandler,
  updateDeliveryChallanHandler,
} from "./deliveryChallans.service";

const deliveryChallansRouter = Router();

deliveryChallansRouter.get("/", listDeliveryChallansHandler);
deliveryChallansRouter.get("/:id", getDeliveryChallanByIdHandler);
deliveryChallansRouter.post("/", createDeliveryChallanHandler);
deliveryChallansRouter.patch("/:id", updateDeliveryChallanHandler);
deliveryChallansRouter.delete("/:id", deleteDeliveryChallanHandler);
deliveryChallansRouter.post("/:id/send-email", sendDeliveryChallanEmailHandler);

export default deliveryChallansRouter;
