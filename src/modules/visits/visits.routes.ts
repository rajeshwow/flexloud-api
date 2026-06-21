import { Router } from "express";
import { requireAuth } from "../../common/auth";
import { requirePermissions } from "../../common/requirePermissions";
import { exportVisitsTable } from "../table-export/table-export.service";
import {
  createVisitHandler,
  getVisitByIdHandler,
  getVisitsListHandler,
  updateVisitHandler,
} from "./visits.service";

const visitsRouter = Router();

visitsRouter.use(requireAuth);

visitsRouter.get(
  "/export",
  requirePermissions(["visits.export"]),
  exportVisitsTable,
);

visitsRouter.get("/", getVisitsListHandler);
visitsRouter.get("/:id", getVisitByIdHandler);
visitsRouter.post("/", createVisitHandler);
visitsRouter.patch("/:id", updateVisitHandler);

export default visitsRouter;
