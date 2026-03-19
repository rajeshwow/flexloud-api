import { Router } from "express";
import { requireAuth } from "../../common/auth";
import {
  applyLeaveHandler,
  cancelLeaveHandler,
  getMyLeavesHandler,
} from "./leave.service";

const leaveRouter = Router();

leaveRouter.use(requireAuth);

leaveRouter.post("/me/apply", applyLeaveHandler);
leaveRouter.get("/me", getMyLeavesHandler);
leaveRouter.patch("/me/:id/cancel", cancelLeaveHandler);

export default leaveRouter;
