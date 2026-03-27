import { Router } from "express";
import {
  createInteractionHandler,
  getInteractionByIdHandler,
  getInteractionsHandler,
  updateInteractionHandler,
} from "./interactions.service";

const interactionsRouter = Router();

interactionsRouter.post("/", createInteractionHandler);
interactionsRouter.get("/", getInteractionsHandler);
interactionsRouter.get("/:id", getInteractionByIdHandler);
interactionsRouter.patch("/:id", updateInteractionHandler);

export default interactionsRouter;
