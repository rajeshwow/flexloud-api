import { Router } from "express";
import { attachUserContext } from "../../auth/attachUserContext";
import { requireAuth } from "../../common/auth";
import {
  createOpportunityHandler,
  getOpportunitiesHandler,
  getOpportunityByIdHandler,
  updateOpportunityHandler,
} from "./opportunities.service";

const opportunitiesRouter = Router();

opportunitiesRouter.use(requireAuth, attachUserContext);

opportunitiesRouter.post("/", createOpportunityHandler);
opportunitiesRouter.get("/", getOpportunitiesHandler);
opportunitiesRouter.get("/:id", getOpportunityByIdHandler);
opportunitiesRouter.patch("/:id", updateOpportunityHandler);

export default opportunitiesRouter;
