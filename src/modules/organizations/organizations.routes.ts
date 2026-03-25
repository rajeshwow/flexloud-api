import { Router } from "express";
import {
  createOrganizationHandler,
  getOrganizationByIdHandler,
  getOrganizationsHandler,
  updateOrganizationHandler,
} from "./organizations.service";

const organizationsRouter = Router();

organizationsRouter.post("/", createOrganizationHandler);
organizationsRouter.get("/", getOrganizationsHandler);
organizationsRouter.get("/:id", getOrganizationByIdHandler);
organizationsRouter.patch("/:id", updateOrganizationHandler);

export default organizationsRouter;
