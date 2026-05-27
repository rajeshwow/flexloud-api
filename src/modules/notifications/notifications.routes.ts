import { Router } from "express";
import { requirePermissions } from "../../common/requirePermissions";
import {
  listNotificationJobsHandler,
  retryNotificationJobHandler,
  runNotificationSchedulerNowHandler,
} from "./notifications.service";

const notificationsRouter = Router();

notificationsRouter.get(
  "/jobs",
  requirePermissions(["notifications.view"]),
  listNotificationJobsHandler,
);

notificationsRouter.post(
  "/jobs/:id/retry",
  requirePermissions(["notifications.retry"]),
  retryNotificationJobHandler,
);

notificationsRouter.post(
  "/run-now",
  requirePermissions(["notifications.run"]),
  runNotificationSchedulerNowHandler,
);

export default notificationsRouter;
