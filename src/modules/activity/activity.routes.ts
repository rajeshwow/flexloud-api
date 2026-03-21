import { Router } from "express";
import { requireAuth } from "../../common/auth";
import { getActivityLogsHandler } from "./activity.controller";

const activityRouter = Router();

activityRouter.use(requireAuth);

activityRouter.get("/:entityType/:entityId", getActivityLogsHandler);

export default activityRouter;
