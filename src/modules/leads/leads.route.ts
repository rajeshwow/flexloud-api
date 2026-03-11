import { Router } from "express";
import {
  createLeadHandler,
  deleteLeadHandler,
  getLeadByIdHandler,
  getLeadsHandler,
  updateLeadHandler,
} from "./leads.service";

const leadsRouter = Router();

leadsRouter.post("/", createLeadHandler);
leadsRouter.get("/", getLeadsHandler);
leadsRouter.get("/:id", getLeadByIdHandler);
leadsRouter.patch("/:id", updateLeadHandler);
leadsRouter.delete("/:id", deleteLeadHandler);

export default leadsRouter;
