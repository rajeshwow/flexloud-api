import { Router } from "express";
import { requirePermissions } from "../../common/requirePermissions";
import {
  getMyCostCentersHandler,
  getUserCostCentersHandler,
  updateUserCostCentersHandler,
} from "./user-cost-centers.service";

const userCostCentersRouter = Router();

userCostCentersRouter.get(
  "/me/cost-centers",
  requirePermissions(["user-cost-centers.view"]),
  getMyCostCentersHandler,
);

userCostCentersRouter.get(
  "/:userId/cost-centers",
  requirePermissions(["user-cost-centers.view"]),
  getUserCostCentersHandler,
);

userCostCentersRouter.put(
  "/:userId/cost-centers",
  requirePermissions(["user-cost-centers.edit"]),
  updateUserCostCentersHandler,
);

export default userCostCentersRouter;
