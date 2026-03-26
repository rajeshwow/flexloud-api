import { Router } from "express";
import {
  createQuoteHandler,
  getQuoteByIdHandler,
  getQuotesHandler,
  updateQuoteHandler,
} from "./quotes.service";

const quotesRouter = Router();

quotesRouter.post("/", createQuoteHandler);
quotesRouter.get("/", getQuotesHandler);
quotesRouter.get("/:id", getQuoteByIdHandler);
quotesRouter.patch("/:id", updateQuoteHandler);

export default quotesRouter;
