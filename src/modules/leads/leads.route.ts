import { Router } from "express";
import { requirePermissions } from "../../common/requirePermissions";
import { exportLeadsTable } from "../table-export/table-export.service";
import {
  createLeadHandler,
  deleteLeadHandler,
  getLeadByIdHandler,
  getLeadsHandler,
  updateLeadHandler,
} from "./leads.service";

const leadsRouter = Router();
leadsRouter.get(
  "/export",
  requirePermissions(["leads.export"]),
  exportLeadsTable,
);
leadsRouter.post("/", createLeadHandler);
leadsRouter.get("/", getLeadsHandler);
leadsRouter.get("/:id", getLeadByIdHandler);
leadsRouter.patch("/:id", updateLeadHandler);
leadsRouter.delete("/:id", deleteLeadHandler);

export default leadsRouter;
