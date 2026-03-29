import { Router } from "express";
import {
  checkOutGeoVisitHandler,
  createGeoVisitHandler,
  getGeoVisitByIdHandler,
  getGeoVisitsHandler,
} from "./geo-visits.service";

const geoVisitsRouter = Router();

geoVisitsRouter.post("/", createGeoVisitHandler);
geoVisitsRouter.get("/", getGeoVisitsHandler);
geoVisitsRouter.get("/:id", getGeoVisitByIdHandler);
geoVisitsRouter.patch("/:id/check-out", checkOutGeoVisitHandler);

export default geoVisitsRouter;
