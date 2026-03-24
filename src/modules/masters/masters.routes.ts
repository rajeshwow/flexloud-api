import { Router } from "express";
import {
  createMasterTypeHandler,
  createMasterValueHandler,
  deleteMasterValueHandler,
  getMasterTypesHandler,
  getMasterValuesHandler,
  updateMasterTypeHandler,
  updateMasterValueHandler,
} from "./masters.service";

const masterRouter = Router();

masterRouter.get("/types", getMasterTypesHandler);
masterRouter.post("/types", createMasterTypeHandler);
masterRouter.patch("/types/:id", updateMasterTypeHandler);

masterRouter.get("/values", getMasterValuesHandler);
masterRouter.post("/values", createMasterValueHandler);
masterRouter.patch("/values/:id", updateMasterValueHandler);
masterRouter.delete("/values/:id", deleteMasterValueHandler);

export default masterRouter;
