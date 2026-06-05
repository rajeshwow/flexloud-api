import { Router } from "express";
import { requirePermissions } from "../../common/requirePermissions";
import { globalSearch } from "./global-search.service";

const globalSearchRouter = Router();

globalSearchRouter.get(
  "/",
  requirePermissions(["global-search.view"]),
  globalSearch,
);

export default globalSearchRouter;
