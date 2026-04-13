import { Router } from "express";
import { requirePermissions } from "../../common/requirePermissions";
import { GetMyDaySchema } from "./my-day.schema";
import { myDayService } from "./my-day.service";

const myDayRouter = Router();

myDayRouter.get(
  "/",
  requirePermissions(["dashboard.view", "tasks.view", "leads.view"]),
  async (req: any, res, next) => {
    try {
      const parsed = GetMyDaySchema.parse(req.query);
      const tenantId =
        req.tenantId || req.user?.tenant_id || req.user?.tenantId;
      const userId = req.user?.id;

      const data = await myDayService.getMyDay({
        tenantId,
        userId,
        view: parsed.view || "all",
        assigned: parsed.assigned || "me",
      });

      res.json({
        success: true,
        message: "My Day fetched successfully",
        data,
      });
    } catch (error) {
      next(error);
    }
  },
);

myDayRouter.get(
  "/counts",
  requirePermissions(["dashboard.view", "tasks.view", "leads.view"]),
  async (req: any, res, next) => {
    try {
      const parsed = GetMyDaySchema.parse(req.query);
      const tenantId =
        req.tenantId || req.user?.tenant_id || req.user?.tenantId;
      const userId = req.user?.id;

      const data = await myDayService.getCounts({
        tenantId,
        userId,
        view: parsed.view || "all",
        assigned: parsed.assigned || "me",
      });

      res.json({
        success: true,
        message: "My Day counts fetched successfully",
        data,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default myDayRouter;
