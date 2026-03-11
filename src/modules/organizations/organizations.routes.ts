import { Router } from "express";
import {
  createOrganizationHandler,
  getOrganizationsHandler,
} from "./organizations.service";

const organizationsRouter = Router();

organizationsRouter.post("/", createOrganizationHandler);
organizationsRouter.get("/", getOrganizationsHandler);

export default organizationsRouter;
